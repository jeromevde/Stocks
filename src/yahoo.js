/**
 * Yahoo Finance API via Puter.js
 * Puter.js SDK bypasses CORS using its network infrastructure.
 */

const apiCache = new Map();
const CACHE_TTL = { search: 600000, price: 120000, historical: 86400000, threeMonth: 300000 };

let puterReady = null; // resolved promise once puter.net.fetch works

/** Wait for Puter.js WebSocket to be ready (called once) */
function waitForPuter() {
    if (puterReady) return puterReady;
    puterReady = new Promise(async (resolve) => {
        for (let i = 0; i < 50; i++) { // up to ~10s
            if (typeof puter !== 'undefined' && typeof puter?.net?.fetch === 'function') {
                // Test with a tiny request to force WS open
                try {
                    await puter.net.fetch('https://query1.finance.yahoo.com/v1/finance/search?q=test&quotesCount=1&newsCount=0', {
                        headers: { Accept: 'application/json' }
                    });
                    console.log('Puter.js ready');
                    resolve(true);
                    return;
                } catch (e) {
                    if (e?.message?.includes('CONNECTING') || e?.name === 'InvalidStateError') {
                        await new Promise(r => setTimeout(r, 200));
                        continue;
                    }
                }
            }
            await new Promise(r => setTimeout(r, 200));
        }
        console.warn('Puter.js did not become ready in time');
        resolve(false);
    });
    return puterReady;
}

/** Fetch JSON via Puter with cache */
async function puterFetch(url, cacheKey, ttl) {
    const cached = apiCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ttl) return cached.data;

    await waitForPuter();

    if (typeof puter === 'undefined' || typeof puter?.net?.fetch !== 'function') {
        throw new Error('Puter.js not available');
    }

    const res = await puter.net.fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);
    const data = await res.json();
    apiCache.set(cacheKey, { data, ts: Date.now() });
    return data;
}

/** Extract price from Yahoo chart response */
function extractPrice(data) {
    const result = data?.chart?.result?.[0];
    if (result?.meta?.regularMarketPrice) return result.meta.regularMarketPrice;
    const closes = result?.indicators?.quote?.[0]?.close?.filter(p => p != null);
    return closes?.length ? closes[closes.length - 1] : null;
}

/** Search tickers */
async function fetchTickerSuggestions(query) {
    if (!query) return [];
    try {
        const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
        const data = await puterFetch(url, `search_${query}`, CACHE_TTL.search);
        return (data?.quotes || []).slice(0, 8).map(q => ({
            symbol: q.symbol,
            name: q.shortname || q.longname || q.symbol
        }));
    } catch { return []; }
}

/** Current price */
async function fetchCurrentPrice(ticker) {
    try {
        const now = Math.floor(Date.now() / 1000);
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${now - 172800}&period2=${now}&interval=1d`;
        return extractPrice(await puterFetch(url, `price_${ticker}`, CACHE_TTL.price));
    } catch (e) {
        console.warn(`Price fetch failed for ${ticker}:`, e.message);
        return null;
    }
}

/** Historical price closest to date */
async function fetchHistoricalPrice(ticker, date) {
    try {
        const t = Math.floor(new Date(date).getTime() / 1000);
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${t - 604800}&period2=${t + 604800}&interval=1d`;
        const data = await puterFetch(url, `hist_${ticker}_${date}`, CACHE_TTL.historical);
        const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(p => p != null);
        return closes?.length ? closes[0] : null;
    } catch (e) {
        console.warn(`Historical fetch failed for ${ticker}:`, e.message);
        return null;
    }
}

/** 3-month return */
async function fetch3MonthReturn(ticker) {
    try {
        const now = new Date();
        const ago = new Date(); ago.setMonth(ago.getMonth() - 3);
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${Math.floor(ago / 1000)}&period2=${Math.floor(now / 1000)}&interval=1d`;
        const data = await puterFetch(url, `3m_${ticker}`, CACHE_TTL.threeMonth);
        const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(p => p != null);
        if (closes?.length >= 2) {
            return (((closes[closes.length - 1] - closes[0]) / closes[0]) * 100).toFixed(2);
        }
        return null;
    } catch (e) {
        console.warn(`3M return fetch failed for ${ticker}:`, e.message);
        return null;
    }
}

function clearCache() { apiCache.clear(); }

window.YahooFinance = {
    waitForPuter,
    fetchTickerSuggestions,
    fetchCurrentPrice,
    fetchHistoricalPrice,
    fetch3MonthReturn,
    clearCache
};
