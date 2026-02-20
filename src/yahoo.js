/**
 * Yahoo Finance API via Puter.js (with CORS-proxy fallback)
 */

const apiCache = new Map();
const CACHE_TTL = { search: 600000, price: 120000, historical: 86400000, threeMonth: 300000 };

let puterReady = null;

/** Wait for Puter.js WebSocket (up to 30s). Resolves true/false. */
function waitForPuter() {
    if (puterReady) return puterReady;
    puterReady = new Promise(async (resolve) => {
        for (let i = 0; i < 150; i++) { // up to ~30s
            if (typeof puter !== 'undefined' && typeof puter?.net?.fetch === 'function') {
                try {
                    await puter.net.fetch(
                        'https://query1.finance.yahoo.com/v1/finance/search?q=test&quotesCount=1&newsCount=0',
                        { headers: { Accept: 'application/json' } }
                    );
                    console.log('Puter.js ready');
                    resolve(true);
                    return;
                } catch (e) {
                    if (e?.message?.includes('CONNECTING') || e?.name === 'InvalidStateError') {
                        await new Promise(r => setTimeout(r, 200));
                        continue;
                    }
                    // Other errors — puter exists but request failed; still usable
                    console.log('Puter ready (with initial error):', e.message);
                    resolve(true);
                    return;
                }
            }
            await new Promise(r => setTimeout(r, 200));
        }
        console.warn('Puter.js did not become ready in time, will use CORS proxy fallback');
        resolve(false);
    });
    return puterReady;
}

/** Fetch JSON — tries Puter first, falls back to CORS proxy */
async function apiFetch(url, cacheKey, ttl) {
    const cached = apiCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ttl) return cached.data;

    const ok = await waitForPuter();
    let data;

    if (ok && typeof puter?.net?.fetch === 'function') {
        try {
            const res = await puter.net.fetch(url, { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error(`Yahoo ${res.status}`);
            data = await res.json();
        } catch (e) {
            console.warn('Puter fetch failed, trying CORS proxy:', e.message);
            data = await corsProxyFetch(url);
        }
    } else {
        data = await corsProxyFetch(url);
    }

    apiCache.set(cacheKey, { data, ts: Date.now() });
    return data;
}

/** CORS proxy fallback */
async function corsProxyFetch(url) {
    const proxy = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxy, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Proxy ${res.status}`);
    return res.json();
}

/**
 * Fetch current price AND 3-month return for a ticker in ONE chart request.
 * Yahoo v8/finance/chart with a 3mo range gives us both the latest close (current price)
 * and enough history to compute the 3M return.
 */
async function fetchPriceAndReturn(ticker) {
    try {
        const now = new Date();
        const ago = new Date(); ago.setMonth(ago.getMonth() - 3);
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${Math.floor(ago / 1000)}&period2=${Math.floor(now / 1000)}&interval=1d`;
        const data = await apiFetch(url, `par_${ticker}`, CACHE_TTL.threeMonth);
        const result = data?.chart?.result?.[0];
        const closes = result?.indicators?.quote?.[0]?.close?.filter(p => p != null) || [];
        const price = result?.meta?.regularMarketPrice ?? (closes.length ? closes[closes.length - 1] : null);
        const ret3m = closes.length >= 2
            ? (((closes[closes.length - 1] - closes[0]) / closes[0]) * 100).toFixed(2)
            : null;
        return { price, ret3m };
    } catch (e) {
        console.warn(`fetchPriceAndReturn failed for ${ticker}:`, e.message);
        return { price: null, ret3m: null };
    }
}

/** Search tickers */
async function fetchTickerSuggestions(query) {
    if (!query) return [];
    for (let host of ['query1', 'query2']) {
        try {
            const url = `https://${host}.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
            const data = await apiFetch(url, `search_${query}_${host}`, CACHE_TTL.search);
            const quotes = data?.quotes || [];
            if (quotes.length) return quotes.slice(0, 8).map(q => ({ symbol: q.symbol, name: q.shortname || q.longname || q.symbol }));
        } catch (e) {
            console.warn(`Search ${host} failed:`, e.message);
        }
    }
    return [];
}

/** Historical price closest to date (separate call — needed for cumulative return from discovery date) */
async function fetchHistoricalPrice(ticker, date) {
    try {
        const t = Math.floor(new Date(date).getTime() / 1000);
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${t - 604800}&period2=${t + 604800}&interval=1d`;
        const data = await apiFetch(url, `hist_${ticker}_${date}`, CACHE_TTL.historical);
        const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(p => p != null);
        return closes?.length ? closes[0] : null;
    } catch (e) { console.warn(`Historical fetch failed for ${ticker}:`, e.message); return null; }
}

/** Convenience: current price only (for single-stock add) */
async function fetchCurrentPrice(ticker) {
    return (await fetchPriceAndReturn(ticker)).price;
}

function clearCache() { apiCache.clear(); }

window.YahooFinance = {
    waitForPuter,
    fetchTickerSuggestions,
    fetchCurrentPrice,
    fetchHistoricalPrice,
    fetchPriceAndReturn,
    clearCache
};
