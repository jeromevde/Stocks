/**
 * Market data — Twelve Data (primary, batched ≤ 120 symbols) + Yahoo Finance v8 (fallback)
 * Cookie: `twelvedata_api_key`
 */

const apiCache = new Map();
const CACHE_TTL = { search: 600_000, quote: 180_000, historical: 86_400_000 };

const TD_BASE    = 'https://api.twelvedata.com';
const YF_BASE    = 'https://query1.finance.yahoo.com';
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
 * One batch call for up to 120 tickers.
 * Returns { [TICKER]: { price, ret3m } }
 */
async function tdBatchChunk(tickers, key) {
    const endDate   = toYmd(new Date());
    const startDate = addDaysYmd(endDate, -92);   // ~3 months of daily bars

    const url = `${TD_BASE}/time_series?symbol=${tickers.join(',')}&interval=1day`
              + `&start_date=${startDate}&end_date=${endDate}&apikey=${encodeURIComponent(key)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Twelve Data ${res.status}`);
    const data = await res.json();

    const out = {};
    for (const ticker of tickers) {
        // Twelve Data returns data[ticker] for multi-symbol, data directly for single-symbol
        const series = tickers.length === 1 ? data : data[ticker];
        if (!series?.values?.length) { out[ticker] = { price: null, ret3m: null }; continue; }

        const values = series.values;         // newest first
        const latest = parseFloat(values[0].close);
        const oldest = parseFloat(values[values.length - 1].close);
        const ret3m  = Number.isFinite(oldest) && oldest > 0
            ? (((latest - oldest) / oldest) * 100).toFixed(2)
            : null;
        out[ticker] = { price: Number.isFinite(latest) ? latest : null, ret3m };
    }
    return out;
}

// ── Yahoo Finance fallback ────────────────────────────────────────────────────

async function yfChart(ticker, params) {
    const qs  = new URLSearchParams({ corsDomain: 'finance.yahoo.com', ...params }).toString();
    const url = `${YF_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?${qs}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Yahoo Finance ${res.status} ${ticker}`);
    return res.json();
}

function yfCurrentPrice(json) {
    const meta = json?.chart?.result?.[0]?.meta ?? {};
    const p = meta.regularMarketPrice ?? meta.chartPreviousClose ?? meta.previousClose;
    return typeof p === 'number' ? p : null;
}

async function yfPriceAndReturn(ticker) {
    const now = Math.floor(Date.now() / 1000);
    const p1  = now - 92 * 86400;
    const json   = await yfChart(ticker, { period1: p1, period2: now, interval: '1d' });
    const price  = yfCurrentPrice(json);
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    const valid  = closes.filter(c => c != null);
    let ret3m = null;
    if (valid.length >= 2) {
        const first = valid[0], last = valid[valid.length - 1];
        if (first > 0) ret3m = (((last - first) / first) * 100).toFixed(2);
    }
    return { price, ret3m };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch current price + 3-month return for a list of tickers.
 * Primary: Twelve Data in batches of 120. Fallback: Yahoo Finance per-ticker.
 */
async function fetchBatchPriceAndReturn(tickers) {
    if (!tickers?.length) return {};
    const unique = [...new Set(tickers.map(t => String(t).trim().toUpperCase()))].filter(Boolean);
    const map    = {};
    const key    = getApiKey();

    if (key) {
        try {
            // Split into chunks of at most BATCH_SIZE (120)
            for (let i = 0; i < unique.length; i += BATCH_SIZE) {
                const chunk   = unique.slice(i, i + BATCH_SIZE);
                const results = await tdBatchChunk(chunk, key);
                Object.assign(map, results);
            }
            for (const [ticker, entry] of Object.entries(map)) setCache(`quote:${ticker}`, entry);
            if (Object.values(map).some(v => v?.price != null)) return map;
        } catch (e) {
            console.warn('Twelve Data batch failed, falling back to Yahoo:', e.message);
        }
    }

    // Yahoo Finance fallback — parallel per-ticker
    await Promise.all(unique.map(async ticker => {
        const ck = `quote:${ticker}`;
        const cached = getCache(ck, CACHE_TTL.quote);
        if (cached !== undefined) { map[ticker] = cached; return; }
        try {
            const entry = await yfPriceAndReturn(ticker);
            setCache(ck, entry);
            map[ticker] = entry;
        } catch (e) {
            console.warn('Yahoo fallback:', ticker, e.message);
            map[ticker] = { price: null, ret3m: null };
        }
    }));

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
    if (key) {
        try {
            const url = `${TD_BASE}/time_series?symbol=${encodeURIComponent(ticker)}&interval=1day`
                      + `&start_date=${addDaysYmd(date, -5)}&end_date=${addDaysYmd(date, 3)}`
                      + `&apikey=${encodeURIComponent(key)}`;
            const res = await fetch(url, { headers: { Accept: 'application/json' } });
            if (res.ok) {
                const data   = await res.json();
                const values = data?.values || [];
                if (values.length) {
                    const price = parseFloat(values[0].close);
                    if (Number.isFinite(price)) { setCache(ck, price); return price; }
                }
            }
        } catch (e) {
            console.warn('fetchHistoricalPrice TD:', ticker, date, e.message);
        }
    }

    // Yahoo fallback
    try {
        const targetSec  = Date.parse(date + 'T12:00:00Z') / 1000;
        const p1 = Math.floor(targetSec - 10 * 86400);
        const p2 = Math.floor(targetSec +  5 * 86400);
        const json       = await yfChart(ticker, { period1: p1, period2: p2, interval: '1d' });
        const result     = json?.chart?.result?.[0];
        const timestamps = result?.timestamp || [];
        const closes     = result?.indicators?.quote?.[0]?.close || [];
        let best = null, bestDiff = Infinity;
        for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] == null) continue;
            const diff = Math.abs(timestamps[i] - targetSec);
            if (diff < bestDiff) { bestDiff = diff; best = closes[i]; }
        }
        setCache(ck, best);
        return best;
    } catch (e) {
        console.warn('fetchHistoricalPrice YF:', ticker, date, e.message);
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

window.YahooFinance = window.MarketData; // backwards-compat alias
