/**
 * Market data — Twelve Data, batched ≤ 120 symbols per call.
 * Cookie: `twelvedata_api_key`
 */

const apiCache = new Map();
const CACHE_TTL = { search: 600_000, quote: 180_000, historical: 86_400_000 };

const TD_BASE    = 'https://api.twelvedata.com';
const BATCH_SIZE = 120;  // Twelve Data max symbols per call

// ── Key ───────────────────────────────────────────────────────────────────────

function readCookie(name) {
    const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : '';
}

function getApiKey()  { return readCookie('twelvedata_api_key'); }
function hasApiKey()  { return !!getApiKey(); }

// ── Cache helpers ─────────────────────────────────────────────────────────────

function setCache(k, v) { apiCache.set(k, { ts: Date.now(), v }); }
function getCache(k, ttl) {
    const e = apiCache.get(k);
    return (e && Date.now() - e.ts < ttl) ? e.v : undefined;
}
function clearCache() { apiCache.clear(); }

function toYmd(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

function addDaysYmd(ymd, days) {
    const dt = new Date(`${ymd}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + days);
    return toYmd(dt);
}

// ── Twelve Data ───────────────────────────────────────────────────────────────

/**
 * Two cheap calls for up to 120 tickers:
 *  1. /quote          — current price, 1 credit/symbol
 *  2. /time_series    — 1 day window 92 days ago, ~1 credit/symbol
 * Total: ~2 credits/symbol instead of 92.
 */
async function tdBatchChunk(tickers, key) {
    const symbolParam = tickers.join(',');

    // ── 1. Current quotes ──────────────────────────────────────────────────
    const quoteUrl = `${TD_BASE}/quote?symbol=${symbolParam}&apikey=${encodeURIComponent(key)}`;
    const quoteRes = await fetch(quoteUrl, { headers: { Accept: 'application/json' } });
    const quoteData = await quoteRes.json();

    if (!quoteRes.ok || quoteData?.status === 'error') {
        throw new Error(`Twelve Data quote ${quoteRes.status}: ${quoteData?.message || ''}`);
    }

    // ── 2. Historical close ~92 days ago ───────────────────────────────────
    const anchor    = addDaysYmd(toYmd(new Date()), -92);
    const histStart = addDaysYmd(anchor, -4);   // 4-day window to catch weekends/holidays
    const histEnd   = addDaysYmd(anchor, 1);
    const histUrl   = `${TD_BASE}/time_series?symbol=${symbolParam}&interval=1day`
                    + `&start_date=${histStart}&end_date=${histEnd}&apikey=${encodeURIComponent(key)}`;
    const histRes  = await fetch(histUrl, { headers: { Accept: 'application/json' } });
    const histData = await histRes.json();

    if (!histRes.ok || histData?.status === 'error') {
        throw new Error(`Twelve Data history ${histRes.status}: ${histData?.message || ''}`);
    }

    // ── Parse ──────────────────────────────────────────────────────────────
    const out = {};
    for (const ticker of tickers) {
        // /quote: multi → data[ticker], single → data directly
        const q     = tickers.length === 1 ? quoteData : quoteData[ticker];
        const price = q ? parseFloat(q.close ?? q.price) : null;

        // /time_series: multi → data[ticker].values, single → data.values
        const series  = tickers.length === 1 ? histData : histData[ticker];
        const values  = series?.values || [];
        const oldVal  = values.length ? parseFloat(values[0].close) : null;   // newest in window = closest to anchor

        const ret3m = Number.isFinite(price) && Number.isFinite(oldVal) && oldVal > 0
            ? (((price - oldVal) / oldVal) * 100).toFixed(2)
            : null;

        out[ticker] = { price: Number.isFinite(price) ? price : null, ret3m };
    }
    return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch current price + 3-month return for a list of tickers via Twelve Data (batches of 120). */
async function fetchBatchPriceAndReturn(tickers) {
    if (!tickers?.length) return {};
    const unique = [...new Set(tickers.map(t => String(t).trim().toUpperCase()))].filter(Boolean);
    const map    = {};
    const key    = getApiKey();
    if (!key) { console.warn('No Twelve Data API key — enter it via the Twelve Data tile.'); return {}; }

    try {
        for (let i = 0; i < unique.length; i += BATCH_SIZE) {
            const chunk   = unique.slice(i, i + BATCH_SIZE);
            const results = await tdBatchChunk(chunk, key);
            Object.assign(map, results);
        }
        for (const [ticker, entry] of Object.entries(map)) setCache(`quote:${ticker}`, entry);
    } catch (e) {
        console.error('fetchBatchPriceAndReturn failed:', e.message);
    }
    return map;
}

/** Convenience wrapper — single ticker. */
async function fetchPriceAndReturn(ticker) {
    const map = await fetchBatchPriceAndReturn([ticker]);
    return map[String(ticker).toUpperCase()] || { price: null, ret3m: null };
}

/** Closing price on or nearest to date (YYYY-MM-DD). */
async function fetchHistoricalPrice(ticker, date) {
    const ck     = `hist:${ticker}:${date}`;
    const cached = getCache(ck, CACHE_TTL.historical);
    if (cached !== undefined) return cached;

    const key = getApiKey();
    if (!key) return null;

    try {
        const url = `${TD_BASE}/time_series?symbol=${encodeURIComponent(ticker)}&interval=1day`
                  + `&start_date=${addDaysYmd(date, -5)}&end_date=${addDaysYmd(date, 3)}`
                  + `&apikey=${encodeURIComponent(key)}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`Twelve Data ${res.status}`);
        const data   = await res.json();
        const values = data?.values || [];
        const price  = values.length ? parseFloat(values[0].close) : null;
        setCache(ck, Number.isFinite(price) ? price : null);
        return Number.isFinite(price) ? price : null;
    } catch (e) {
        console.warn('fetchHistoricalPrice:', ticker, date, e.message);
        return null;
    }
}

/** Ticker autocomplete via Twelve Data symbol_search. */
async function fetchTickerSuggestions(query) {
    if (!query?.trim()) return [];
    const ck     = `search:${query.toLowerCase()}`;
    const cached = getCache(ck, CACHE_TTL.search);
    if (cached !== undefined) return cached;

    const key = getApiKey();
    if (!key) return [];

    try {
        const url = `${TD_BASE}/symbol_search?symbol=${encodeURIComponent(query.trim())}&apikey=${encodeURIComponent(key)}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`TD search ${res.status}`);
        const data    = await res.json();
        const results = (data?.data || [])
            .filter(r => r.instrument_type === 'Common Stock')
            .map(r => ({ symbol: r.symbol, name: r.instrument_name }))
            .slice(0, 10);
        setCache(ck, results);
        return results;
    } catch (e) {
        console.warn('fetchTickerSuggestions:', e.message);
        return [];
    }
}

// ── Export ────────────────────────────────────────────────────────────────────

window.MarketData = {
    getApiKey,
    hasApiKey,
    fetchBatchPriceAndReturn,
    fetchPriceAndReturn,
    fetchHistoricalPrice,
    fetchTickerSuggestions,
    clearCache,
};

window.YahooFinance = window.MarketData; // backwards-compat alias kept for any existing callers
