/**
 * Eulerpool Data API wrapper
 *
 * Uses the real Eulerpool v1 REST API:
 *   GET /v1/equities/{ticker}/price          → current quote
 *   GET /v1/equities/{ticker}/history        → OHLCV bars (params: from, to, interval)
 *   GET /v1/equities/search?query=…          → symbol search
 *
 * Authentication: Authorization: Bearer <key>
 */

const apiCache = new Map();
const CACHE_TTL = { search: 600000, quote: 180000, historical: 86400000 };
const EULERPOOL_BASE = 'https://api.eulerpool.com';

// ─── API key ──────────────────────────────────────────────────────────────────

function getApiKey() {
    return (window.TokenStore?.get('eulerpool_api_key')) || localStorage.getItem('eulerpool_api_key') || '';
}

function buildHeaders(apiKey) {
    const h = { Accept: 'application/json' };
    if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;
    return h;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function setCache(key, data) { apiCache.set(key, { ts: Date.now(), data }); }
function getCache(key, ttl) {
    const entry = apiCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > ttl) return null;
    return entry.data;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function epFetch(path, apiKey) {
    const res = await fetch(`${EULERPOOL_BASE}${path}`, { headers: buildHeaders(apiKey) });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Eulerpool ${res.status}: ${body.slice(0, 120)}`);
    }
    return res.json();
}

// ─── Price response normalisation ─────────────────────────────────────────────
// Response shape: { ticker, price, change, changePct, volume, timestamp }

function normalisePriceResponse(data, ticker) {
    const p = typeof data?.price === 'number' ? data.price : parseFloat(data?.price);
    return {
        price: Number.isFinite(p) ? p : null,
        ret3m: null   // Eulerpool price endpoint doesn't include 3-month return
    };
}

// ─── History response normalisation ──────────────────────────────────────────
// Response shape: array of OHLCV bars OR { bars: [...] } OR { data: [...] }
// Each bar: { open, high, low, close, volume, timestamp }

function extractClosestClose(payload, targetDate) {
    let bars = null;
    if (Array.isArray(payload)) bars = payload;
    else if (Array.isArray(payload?.bars)) bars = payload.bars;
    else if (Array.isArray(payload?.data)) bars = payload.data;
    else if (Array.isArray(payload?.history)) bars = payload.history;
    if (!bars || !bars.length) return null;

    // Look for an exact date match first, then nearest bar before or on the date
    bars.sort((a, b) => (a.timestamp || a.date || '').localeCompare(b.timestamp || b.date || ''));
    let best = null;
    for (const bar of bars) {
        const barDate = (bar.timestamp || bar.date || '').slice(0, 10);
        if (barDate <= targetDate) best = bar;
        else break;
    }
    if (!best) best = bars[0];
    const close = best?.close ?? best?.c ?? best?.price;
    const num = typeof close === 'number' ? close : parseFloat(close);
    return Number.isFinite(num) ? num : null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch current prices for multiple tickers concurrently (parallel batch).
 * Returns { TICKER: { price, ret3m }, … }
 */
async function fetchBatchPriceAndReturn(tickers) {
    if (!tickers?.length) return {};
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('Eulerpool API key missing');

    const uniqueTickers = [...new Set(tickers.map(t => String(t).toUpperCase()))];
    const cacheKey = `batch_${[...uniqueTickers].sort().join(',')}`;
    const cached = getCache(cacheKey, CACHE_TTL.quote);
    if (cached) return cached;

    const results = await Promise.allSettled(
        uniqueTickers.map(async ticker => {
            const data = await epFetch(`/v1/equities/${encodeURIComponent(ticker)}/price`, apiKey);
            return { ticker, data };
        })
    );

    const map = {};
    results.forEach(r => {
        if (r.status === 'fulfilled') {
            const { ticker, data } = r.value;
            map[ticker] = normalisePriceResponse(data, ticker);
        } else {
            console.warn(`Eulerpool price fetch failed for ticker:`, r.reason?.message);
        }
    });

    setCache(cacheKey, map);
    return map;
}

async function fetchPriceAndReturn(ticker) {
    const map = await fetchBatchPriceAndReturn([ticker]);
    return map[ticker.toUpperCase()] || { price: null, ret3m: null };
}

/**
 * Fetch the closing price on or just before `date` (YYYY-MM-DD).
 * Uses a ±7-day window so weekends/holidays don't return empty bars.
 */
async function fetchHistoricalPrice(ticker, date) {
    const apiKey = getApiKey();
    if (!apiKey) return null;

    const cacheKey = `hist_${ticker}_${date}`;
    const cached = getCache(cacheKey, CACHE_TTL.historical);
    if (cached != null) return cached;

    // Widen window by 7 days each side to cover non-trading dates
    const dt = new Date(`${date}T00:00:00Z`);
    const from = new Date(dt.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const to   = new Date(dt.getTime() + 7 * 86400000).toISOString().slice(0, 10);

    try {
        const t = encodeURIComponent(ticker);
        const data = await epFetch(
            `/v1/equities/${t}/history?from=${from}&to=${to}&interval=1d`,
            apiKey
        );
        const price = extractClosestClose(data, date);
        if (price != null) setCache(cacheKey, price);
        return price;
    } catch (e) {
        console.warn(`Eulerpool historical fetch failed for ${ticker}:`, e.message);
        return null;
    }
}

/**
 * Search for ticker symbols / company names.
 * Returns [{ symbol, name }, …]
 */
async function fetchTickerSuggestions(query) {
    if (!query) return [];
    const apiKey = getApiKey();
    if (!apiKey) return [];

    const cacheKey = `search_${query.toLowerCase()}`;
    const cached = getCache(cacheKey, CACHE_TTL.search);
    if (cached) return cached;

    try {
        const data = await epFetch(`/v1/equities/search?query=${encodeURIComponent(query)}`, apiKey);
        const rows = Array.isArray(data) ? data
            : Array.isArray(data?.results) ? data.results
            : Array.isArray(data?.data) ? data.data
            : [];

        const results = rows.map(item => {
            const symbol = (item?.ticker || item?.symbol || item?.code || '').toUpperCase();
            const name = item?.name || item?.companyName || item?.shortName || symbol;
            return symbol ? { symbol, name } : null;
        }).filter(Boolean).slice(0, 8);

        setCache(cacheKey, results);
        return results;
    } catch (e) {
        console.warn('Eulerpool search failed:', e.message);
        return [];
    }
}

function clearCache() { apiCache.clear(); }

window.MarketData = {
    getApiKey,
    fetchBatchPriceAndReturn,
    fetchPriceAndReturn,
    fetchHistoricalPrice,
    fetchTickerSuggestions,
    clearCache
};
window.YahooFinance = window.MarketData;
