/**
 * Market data
 *  - Prices:        Yahoo Finance v8  (free, no API key)
 *  - Ticker search: Yahoo Finance search endpoint (free, no API key)
 * Transport:        Puter `puter.net.fetch` (no custom proxy)
 */

const apiCache = new Map();
const CACHE_TTL = { search: 600_000, quote: 180_000, historical: 86_400_000 };

const YF_BASE = 'https://query1.finance.yahoo.com';
const PUTER_MAX_CONCURRENCY = 6;

// Enable with: localStorage.setItem('debug_market_data', '1')
const DEBUG_MARKET = localStorage.getItem('debug_market_data') === '1';
function mdLog(...args) {
    if (DEBUG_MARKET) console.log('[MarketData]', ...args);
}
function mdWarn(...args) {
    if (DEBUG_MARKET) console.warn('[MarketData]', ...args);
}

let puterReadyPromise = null;
let puterInFlight = 0;
const puterWaiters = [];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isPuterTransient(err) {
    const msg = String(err?.message || err || '');
    return msg.includes('Still in CONNECTING state')
        || msg.includes('InvalidStateError')
        || msg.includes('WebSocket')
        || msg.includes('NetworkError');
}

async function getPuterFetch() {
    if (puterReadyPromise) return puterReadyPromise;

    puterReadyPromise = (async () => {
        const started = Date.now();
        while (Date.now() - started < 12000) {
            const fn = globalThis?.puter?.net?.fetch;
            if (typeof fn === 'function') return fn;
            await sleep(100);
        }
        throw new Error('Puter SDK not ready');
    })();

    return puterReadyPromise;
}

async function acquirePuterSlot() {
    if (puterInFlight < PUTER_MAX_CONCURRENCY) {
        puterInFlight += 1;
        return;
    }
    await new Promise(resolve => puterWaiters.push(resolve));
    puterInFlight += 1;
}

function releasePuterSlot() {
    puterInFlight = Math.max(0, puterInFlight - 1);
    const next = puterWaiters.shift();
    if (next) next();
}

async function fetchJsonViaPuter(url, label = 'request') {
    const puterFetch = await getPuterFetch();
    await acquirePuterSlot();
    try {
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                const res = await puterFetch(url, { headers: { Accept: 'application/json' } });
                mdLog(`${label} puter`, { attempt: attempt + 1, status: res?.status, ok: !!res?.ok, inFlight: puterInFlight });
                if (!res?.ok) throw new Error(`Puter ${res?.status ?? 'error'}`);
                return await res.json();
            } catch (err) {
                if (isPuterTransient(err) && attempt < 4) {
                    const delayMs = 250 * (attempt + 1);
                    mdWarn(`${label} transient puter error, retrying`, { attempt: attempt + 1, delayMs, message: String(err?.message || err) });
                    await sleep(delayMs);
                    continue;
                }
                throw err;
            }
        }
        throw new Error('Puter retries exhausted');
    } finally {
        releasePuterSlot();
    }
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function setCache(k, v) { apiCache.set(k, { ts: Date.now(), v }); }
function getCache(k, ttl) {
    const e = apiCache.get(k);
    const hit = !!(e && Date.now() - e.ts < ttl);
    if (DEBUG_MARKET) mdLog('cache', hit ? 'hit' : 'miss', k);
    return hit ? e.v : undefined;
}
function clearCache() {
    mdLog('cache clear');
    apiCache.clear();
}

// ── Yahoo Finance ─────────────────────────────────────────────────────────────

async function yfFetch(ticker, period1, period2) {
    const qs  = new URLSearchParams({ period1, period2, interval: '1d' });
    const url = `${YF_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?${qs}`;
    mdLog('fetch', { ticker, period1, period2, url });
    const data = await fetchJsonViaPuter(url, `chart:${ticker}`);
    mdLog('fetch response', { ticker, ok: !!data?.chart });
    return data;
}

/**
 * Single Yahoo call: 94-day chart → current price + 3-month return.
 */
async function yfPriceAndReturn(ticker) {
    const ck = `quote:${ticker}`;
    const cached = getCache(ck, CACHE_TTL.quote);
    if (cached !== undefined) {
        mdLog('quote cached', { ticker, entry: cached });
        return cached;
    }

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
    mdLog('quote computed', { ticker, price: entry.price, ret3m: entry.ret3m, bars: valid.length });
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
    mdLog('batch start', { count: unique.length, tickers: unique });

    await Promise.all(unique.map(async ticker => {
        try {
            const entry  = await yfPriceAndReturn(ticker);
            map[ticker]  = entry;
            onEach?.(ticker, entry);
            mdLog('batch ticker done', { ticker, price: entry.price, ret3m: entry.ret3m });
        } catch (e) {
            mdWarn('batch ticker failed', { ticker, message: e.message });
            const entry = { price: null, ret3m: null };
            map[ticker] = entry;
            onEach?.(ticker, entry);
        }
    }));

    mdLog('batch done', { resolved: Object.keys(map).length });

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
    if (cached !== undefined) {
        mdLog('historical cached', { ticker, date, price: cached });
        return cached;
    }

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
        mdLog('historical computed', { ticker, date, price: best, bars: closes.filter(v => v != null).length });
        return best;
    } catch (e) {
        mdWarn('historical failed', { ticker, date, message: e.message });
        return null;
    }
}

/** Ticker autocomplete — Yahoo Finance search (no API key required). */
async function fetchTickerSuggestions(query) {
    if (!query?.trim()) return [];
    const ck     = `search:${query.toLowerCase()}`;
    const cached = getCache(ck, CACHE_TTL.search);
    if (cached !== undefined) {
        mdLog('search cached', { query, count: cached.length });
        return cached;
    }

    try {
        const url = `${YF_BASE}/v1/finance/search?q=${encodeURIComponent(query.trim())}&lang=en-US&region=US&quotesCount=10&newsCount=0`;
        mdLog('search fetch', { query, url });
        const data    = await fetchJsonViaPuter(url, `search:${query}`);
        const results = (data?.quotes || [])
            .filter(r => (r.quoteType === 'EQUITY' || r.quoteType === 'ETF') && r.symbol)
            .map(r => ({ symbol: String(r.symbol).toUpperCase(), name: r.shortname || r.longname || r.symbol }))
            .slice(0, 10);
        setCache(ck, results);
        mdLog('search results', { query, count: results.length, symbols: results.map(r => r.symbol) });
        return results;
    } catch (e) {
        mdWarn('search failed', { query, message: e.message });
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
