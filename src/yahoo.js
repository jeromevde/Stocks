/**
 * Market data
 *  - Prices:        Yahoo Finance v8  (free, no API key)
 *  - Ticker search: Yahoo Finance search endpoint (free, no API key)
 */

const apiCache = new Map();
const CACHE_TTL = { search: 600_000, quote: 180_000, historical: 86_400_000 };

const YF_BASE = 'https://query1.finance.yahoo.com';

// ── Cache ─────────────────────────────────────────────────────────────────────

function setCache(k, v) { apiCache.set(k, { ts: Date.now(), v }); }
function getCache(k, ttl) {
    const e = apiCache.get(k);
    return (e && Date.now() - e.ts < ttl) ? e.v : undefined;
}
function clearCache() { apiCache.clear(); }

// ── Yahoo Finance ─────────────────────────────────────────────────────────────

async function yfFetch(ticker, period1, period2) {
    const qs  = new URLSearchParams({ period1, period2, interval: '1d', corsDomain: 'finance.yahoo.com' });
    const url = `${YF_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?${qs}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Yahoo ${res.status} ${ticker}`);
    return res.json();
}

/**
 * Single Yahoo call: 94-day chart → current price + 3-month return.
 */
async function yfPriceAndReturn(ticker) {
    const ck = `quote:${ticker}`;
    const cached = getCache(ck, CACHE_TTL.quote);
    if (cached !== undefined) return cached;

    const now = Math.floor(Date.now() / 1000);
    const p1  = now - 94 * 86400;
    const json   = await yfFetch(ticker, p1, now);
    const meta   = json?.chart?.result?.[0]?.meta ?? {};
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const valid  = closes.filter(c => c != null);

    const price = meta.regularMarketPrice ?? meta.chartPreviousClose ?? (valid.length ? valid[valid.length - 1] : null);
    let ret3m = null;
    if (valid.length >= 2) {
        const first = valid[0], last = valid[valid.length - 1];
        if (first > 0) ret3m = (((last - first) / first) * 100).toFixed(2);
    }

    const entry = { price: typeof price === 'number' ? price : null, ret3m };
    setCache(ck, entry);
    return entry;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fire one Yahoo request per ticker in parallel.
 * `onEach(ticker, {price, ret3m})` is called as each request resolves (lazy row updates).
 */
async function fetchBatchPriceAndReturn(tickers, onEach) {
    if (!tickers?.length) return {};
    const unique = [...new Set(tickers.map(t => String(t).trim().toUpperCase()))].filter(Boolean);
    const map    = {};

    await Promise.all(unique.map(async ticker => {
        try {
            const entry  = await yfPriceAndReturn(ticker);
            map[ticker]  = entry;
            onEach?.(ticker, entry);
        } catch (e) {
            console.warn('Yahoo price:', ticker, e.message);
            const entry = { price: null, ret3m: null };
            map[ticker] = entry;
            onEach?.(ticker, entry);
        }
    }));

    return map;
}

/** Single-ticker convenience wrapper. */
async function fetchPriceAndReturn(ticker) {
    return yfPriceAndReturn(String(ticker).toUpperCase());
}

/** Closing price on or nearest to `date` (YYYY-MM-DD). */
async function fetchHistoricalPrice(ticker, date) {
    const ck     = `hist:${ticker}:${date}`;
    const cached = getCache(ck, CACHE_TTL.historical);
    if (cached !== undefined) return cached;

    try {
        const targetSec = Date.parse(`${date}T12:00:00Z`) / 1000;
        const p1 = Math.floor(targetSec - 10 * 86400);
        const p2 = Math.floor(targetSec +  5 * 86400);
        const json       = await yfFetch(ticker, p1, p2);
        const result     = json?.chart?.result?.[0];
        const timestamps = result?.timestamp ?? [];
        const closes     = result?.indicators?.quote?.[0]?.close ?? [];
        let best = null, bestDiff = Infinity;
        for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] == null) continue;
            const diff = Math.abs(timestamps[i] - targetSec);
            if (diff < bestDiff) { bestDiff = diff; best = closes[i]; }
        }
        setCache(ck, best);
        return best;
    } catch (e) {
        console.warn('fetchHistoricalPrice:', ticker, date, e.message);
        return null;
    }
}

/** Ticker autocomplete — Yahoo Finance search (no API key required). */
async function fetchTickerSuggestions(query) {
    if (!query?.trim()) return [];
    const ck     = `search:${query.toLowerCase()}`;
    const cached = getCache(ck, CACHE_TTL.search);
    if (cached !== undefined) return cached;

    try {
        const url = `${YF_BASE}/v1/finance/search?q=${encodeURIComponent(query.trim())}&lang=en-US&region=US&quotesCount=10&newsCount=0`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`Yahoo search ${res.status}`);
        const data    = await res.json();
        const results = (data?.quotes || [])
            .filter(r => (r.quoteType === 'EQUITY' || r.quoteType === 'ETF') && r.symbol)
            .map(r => ({ symbol: String(r.symbol).toUpperCase(), name: r.shortname || r.longname || r.symbol }))
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
    getApiKey: () => '',
    hasApiKey: () => true,
    fetchBatchPriceAndReturn,
    fetchPriceAndReturn,
    fetchHistoricalPrice,
    fetchTickerSuggestions,
    clearCache,
};

window.YahooFinance = window.MarketData; // backwards-compat alias
