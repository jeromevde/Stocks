/**
 * Market data wrapper
 *
 * Prices (preferred): Massive grouped daily bars (free-tier friendly, near-batch via date snapshots).
 * Prices (fallback):  Yahoo Finance v8 chart API — free, no API key required.
 * Ticker search / autocomplete:  Massive /v3/reference/tickers?search=...
 *
 * Key storage for market data is cookie-only (`massive_api_key`).
 */

const apiCache = new Map();
const CACHE_TTL = { search: 600_000, quote: 180_000, historical: 86_400_000 };

const MASSIVE_BASE   = 'https://api.massive.com';
const YF_BASE        = 'https://query1.finance.yahoo.com';

// ── Key management ────────────────────────────────────────────────────────────

function readCookie(name) {
    const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : '';
}

function getMassiveApiKey() {
    return readCookie('massive_api_key') || readCookie('polygon_api_key') || '';
}

function hasMassiveApiKey() {
    return !!getMassiveApiKey();
}

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

function parseMassiveGrouped(json) {
    const out = new Map();
    const rows = json?.results || [];
    for (const row of rows) {
        const symbol = (row?.T || row?.ticker || '').toUpperCase();
        const close = row?.c;
        if (!symbol) continue;
        out.set(symbol, Number.isFinite(close) ? close : null);
    }
    return out;
}

async function massiveFetch(path, apiKey) {
    const url = `${MASSIVE_BASE}${path}${path.includes('?') ? '&' : '?'}apiKey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Massive ${res.status}: ${body.slice(0, 140)}`);
    }
    return res.json();
}

async function massiveGroupedForDate(dateYmd, apiKey) {
    const ck = `massive_grouped:${dateYmd}`;
    const cached = getCache(ck, CACHE_TTL.historical);
    if (cached !== undefined) return cached;

    const json = await massiveFetch(`/v2/aggs/grouped/locale/us/market/stocks/${dateYmd}?adjusted=true`, apiKey);
    const parsed = {
        date: dateYmd,
        count: Number(json?.resultsCount || 0),
        byTicker: parseMassiveGrouped(json),
    };
    setCache(ck, parsed);
    return parsed;
}


async function massiveNearestTradingDay(anchorDateYmd, apiKey, maxBacktrackDays = 10) {
    for (let i = 0; i <= maxBacktrackDays; i++) {
        const probeDate = addDaysYmd(anchorDateYmd, -i);
        try {
            const grouped = await massiveGroupedForDate(probeDate, apiKey);
            if (grouped.count > 0 && grouped.byTicker.size > 0) return grouped;
        } catch (e) {
            if (!String(e?.message || '').includes('429')) {
                continue;
            }
        }
    }
    return null;
}

// ── Yahoo Finance v8 chart ────────────────────────────────────────────────────

/** Low-level fetch from Yahoo Finance v8 /chart/{ticker}. */
async function yfChart(ticker, params) {
    const qs  = new URLSearchParams({ corsDomain: 'finance.yahoo.com', ...params }).toString();
    const url = `${YF_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?${qs}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Yahoo Finance ${res.status} ${ticker}: ${body.slice(0, 100)}`);
    }
    return res.json();
}

/** Pull current market price from a v8 chart response. */
function yfCurrentPrice(json) {
    const meta = json?.chart?.result?.[0]?.meta ?? {};
    const p = meta.regularMarketPrice ?? meta.chartPreviousClose ?? meta.previousClose;
    return typeof p === 'number' ? p : null;
}

/** Pull the close price closest to targetDate (YYYY-MM-DD) from a v8 chart response. */
function yfClosestClose(json, targetDate) {
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const timestamps = result.timestamp || [];
    const closes     = result.indicators?.quote?.[0]?.close || [];
    const targetSec  = Date.parse(targetDate + 'T12:00:00Z') / 1000;
    let best = null, bestDiff = Infinity;
    for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] == null) continue;
        const diff = Math.abs(timestamps[i] - targetSec);
        if (diff < bestDiff) { bestDiff = diff; best = closes[i]; }
    }
    return best;
}

// ── Public: prices ────────────────────────────────────────────────────────────

/**
 * Fetch current price + 3-month return for a list of tickers in parallel.
 *
 * @param {string[]} tickers
 * @returns {Promise<{ [ticker: string]: { price: number|null, ret3m: string|null } }>}
 */
async function fetchBatchPriceAndReturn(tickers) {
    if (!tickers?.length) return {};
    const unique = [...new Set(tickers.map(t => String(t).trim().toUpperCase()))].filter(Boolean);
    const map    = {};

    const massiveKey = getMassiveApiKey();
    if (massiveKey) {
        try {
            const anchorToday = toYmd(new Date());
            const latest = await massiveNearestTradingDay(anchorToday, massiveKey, 10);
            if (latest) {
                const threeMonthsBackAnchor = addDaysYmd(latest.date, -92);
                const old = await massiveNearestTradingDay(threeMonthsBackAnchor, massiveKey, 10);
                if (old) {
                    unique.forEach(ticker => {
                        const now = latest.byTicker.get(ticker);
                        const then = old.byTicker.get(ticker);
                        let ret3m = null;
                        if (Number.isFinite(now) && Number.isFinite(then) && then > 0) {
                            ret3m = (((now - then) / then) * 100).toFixed(2);
                        }
                        const entry = {
                            price: Number.isFinite(now) ? now : null,
                            ret3m,
                        };
                        setCache(`quote:${ticker}`, entry);
                        map[ticker] = entry;
                    });

                    if (Object.values(map).some(v => Number.isFinite(v?.price))) {
                        return map;
                    }
                }
            }
        } catch (e) {
            console.warn('Massive batch strategy failed, falling back to Yahoo:', e.message);
        }
    }

    await Promise.all(unique.map(async ticker => {
        const ck = `quote:${ticker}`;
        const cached = getCache(ck, CACHE_TTL.quote);
        if (cached !== undefined) { map[ticker] = cached; return; }

        try {
            // Fetch ~92 days of daily bars — gives current price AND 3-month return
            const now = Math.floor(Date.now() / 1000);
            const p1  = now - 92 * 86400;
            const json = await yfChart(ticker, { period1: p1, period2: now, interval: '1d' });

            const price = yfCurrentPrice(json);

            let ret3m = null;
            const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
            const valid  = closes.filter(c => c != null);
            if (valid.length >= 2) {
                const first = valid[0], last = valid[valid.length - 1];
                if (first > 0) ret3m = (((last - first) / first) * 100).toFixed(2);
            }

            const entry = { price, ret3m };
            setCache(ck, entry);
            map[ticker] = entry;
        } catch (e) {
            console.warn('fetchBatchPriceAndReturn:', ticker, e.message);
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

/**
 * Fetch the closing price on or nearest to date (YYYY-MM-DD).
 *
 * @param {string} ticker
 * @param {string} date  YYYY-MM-DD
 * @returns {Promise<number|null>}
 */
async function fetchHistoricalPrice(ticker, date) {
    const ck     = `hist:${ticker}:${date}`;
    const cached = getCache(ck, CACHE_TTL.historical);
    if (cached !== undefined) return cached;

    const massiveKey = getMassiveApiKey();
    if (massiveKey) {
        try {
            const grouped = await massiveNearestTradingDay(date, massiveKey, 10);
            const close = grouped?.byTicker?.get(String(ticker).toUpperCase());
            if (Number.isFinite(close)) {
                setCache(ck, close);
                return close;
            }
        } catch (e) {
            console.warn('fetchHistoricalPrice Massive fallback:', ticker, date, e.message);
        }
    }

    try {
        const targetSec = Date.parse(date + 'T12:00:00Z') / 1000;
        const p1 = Math.floor(targetSec - 10 * 86400);   // 10 days before
        const p2 = Math.floor(targetSec +  5 * 86400);   //  5 days after
        const json  = await yfChart(ticker, { period1: p1, period2: p2, interval: '1d' });
        const price = yfClosestClose(json, date);
        setCache(ck, price);
        return price;
    } catch (e) {
        console.warn('fetchHistoricalPrice:', ticker, date, e.message);
        return null;
    }
}

/** Return Massive ticker suggestions. */
async function fetchTickerSuggestions(query) {
    if (!query?.trim()) return [];

    const ck     = `search:${query.toLowerCase()}`;
    const cached = getCache(ck, CACHE_TTL.search);
    if (cached !== undefined) return cached;

    const key = getMassiveApiKey();
    if (!key) return [];

    try {
        const url = `${MASSIVE_BASE}/v3/reference/tickers`
            + `?search=${encodeURIComponent(query.trim())}`
            + `&market=stocks&active=true&limit=10`
            + `&apiKey=${encodeURIComponent(key)}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`Massive search ${res.status}`);
        const data    = await res.json();
        const results = (data?.results || [])
            .map(r => ({
                symbol: (r.ticker || '').toUpperCase(),
                name: r.name || r.ticker || '',
            }))
            .filter(r => r.symbol)
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
    getMassiveApiKey,
    hasMassiveApiKey,
    fetchBatchPriceAndReturn,
    fetchPriceAndReturn,
    fetchHistoricalPrice,
    fetchTickerSuggestions,
    clearCache,
};

window.YahooFinance = window.MarketData; // backwards-compat alias
