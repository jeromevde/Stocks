/**
 * Eulerpool Data API wrapper (replaces Yahoo Finance)
 */

const apiCache = new Map();
const CACHE_TTL = { search: 600000, quote: 180000, historical: 86400000 };
const EULERPOOL_BASE = 'https://api.eulerpool.com';

function getApiKey() {
    return (window.TokenStore?.get('eulerpool_api_key')) || localStorage.getItem('eulerpool_api_key') || '';
}

function buildHeaders() {
    return { Accept: 'application/json' };
}

function withApiKey(url, apiKey) {
    const u = new URL(url);
    if (apiKey) {
        if (!u.searchParams.has('apikey')) u.searchParams.set('apikey', apiKey);
    }
    return u.toString();
}

async function fetchJsonWithFallback(urls, apiKey) {
    let lastErr = null;
    for (const url of urls) {
        try {
            const res = await fetch(withApiKey(url, apiKey), { headers: buildHeaders() });
            if (!res.ok) {
                lastErr = new Error(`HTTP ${res.status}`);
                continue;
            }
            return await res.json();
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error('Eulerpool request failed');
}

function setCache(key, data) { apiCache.set(key, { ts: Date.now(), data }); }
function getCache(key, ttl) {
    const entry = apiCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > ttl) return null;
    return entry.data;
}

function buildQuoteUrl(ticker) {
    const t = encodeURIComponent(ticker);
    return `${EULERPOOL_BASE}/api/1/equity/quotes/${t}`;
}

function buildSearchUrls(query) {
    const q = encodeURIComponent(query);
    return [
        `${EULERPOOL_BASE}/api/1/equity/search?query=${q}`,
        `${EULERPOOL_BASE}/api/search?q=${q}`,
        `${EULERPOOL_BASE}/search?q=${q}`
    ];
}

function buildHistoricalUrls(ticker, date) {
    const t = encodeURIComponent(ticker);
    const d = encodeURIComponent(date);
    const dt = new Date(`${date}T00:00:00Z`);
    const start = Number.isNaN(dt.getTime()) ? null : new Date(dt.getTime() - (7 * 24 * 60 * 60 * 1000));
    const end = Number.isNaN(dt.getTime()) ? null : new Date(dt.getTime() + (7 * 24 * 60 * 60 * 1000));
    const fmt = value => value.toISOString().slice(0, 10);
    return [
        `${EULERPOOL_BASE}/api/1/equity/candles/${t}?from=${d}&to=${d}`,
        start && end ? `${EULERPOOL_BASE}/api/1/equity/candles/${t}?from=${encodeURIComponent(fmt(start))}&to=${encodeURIComponent(fmt(end))}` : null,
        `${EULERPOOL_BASE}/api/historical/${t}?from=${d}&to=${d}`,
        `${EULERPOOL_BASE}/api/stock/${t}/history?date=${d}`
    ].filter(Boolean);
}

function normalizeSymbol(item) {
    return (item?.symbol || item?.ticker || item?.code || item?.id || '').toUpperCase();
}
function normalizePrice(item) {
    const price = item?.price ?? item?.last ?? item?.lastPrice ?? item?.close ?? item?.latestPrice ?? item?.regularMarketPrice;
    return typeof price === 'number' ? price : (price != null ? parseFloat(price) : null);
}
function normalize3mReturn(item) {
    const perf = item?.performance || item?.perf || {};
    const candidate = item?.ret3m ?? item?.return3m ?? item?.threeMonthReturn ?? item?.three_month_return ?? perf?.threeMonth ?? perf?.threeMonths ?? perf?.['3m'] ?? perf?.['3M'] ?? item?.['3m'];
    if (candidate == null) return null;
    const n = parseFloat(candidate);
    return isNaN(n) ? null : n.toFixed(2);
}

function extractQuoteItems(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.results)) return payload.results;
    if (Array.isArray(payload?.quotes)) return payload.quotes;
    if (payload?.quotes && typeof payload.quotes === 'object') {
        return Object.entries(payload.quotes).map(([symbol, rest]) => ({ symbol, ...rest }));
    }
    if (payload?.data && typeof payload.data === 'object') {
        return Object.entries(payload.data).map(([symbol, rest]) => ({ symbol, ...rest }));
    }
    return [];
}

function extractHistoryPrices(payload) {
    if (!payload) return [];
    const candidates = [];
    const addValue = v => {
        const num = typeof v === 'number' ? v : parseFloat(v);
        if (!isNaN(num)) candidates.push(num);
    };
    const arrs = [
        payload?.prices, payload?.data, payload?.results, payload?.candles, payload?.history
    ].filter(Boolean);
    arrs.forEach(arr => {
        if (Array.isArray(arr)) arr.forEach(entry => {
            if (typeof entry === 'number') addValue(entry);
            else if (entry && typeof entry === 'object') {
                addValue(entry.close ?? entry.price ?? entry.adjClose ?? entry.c);
            }
        });
    });
    if (Array.isArray(payload)) payload.forEach(addValue);
    return candidates;
}

async function fetchBatchPriceAndReturn(tickers) {
    if (!tickers?.length) return {};
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('Eulerpool API key missing');

    const cacheKey = `batch_${tickers.sort().join(',')}`;
    const cached = getCache(cacheKey, CACHE_TTL.quote);
    if (cached) return cached;

    // Fetch each ticker individually since there's no batch endpoint
    const map = {};
    const results = await Promise.allSettled(
        tickers.map(async ticker => {
            const url = buildQuoteUrl(ticker);
            const res = await fetch(withApiKey(url, apiKey), { headers: buildHeaders() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return { ticker, data };
        })
    );

    results.forEach(result => {
        if (result.status === 'fulfilled') {
            const { ticker, data } = result.value;
            const symbol = ticker.toUpperCase();
            map[symbol] = map[symbol] || {};
            const price = normalizePrice(data);
            const ret3m = normalize3mReturn(data);
            if (price != null) map[symbol].price = price;
            if (ret3m != null) map[symbol].ret3m = ret3m;
        }
    });

    setCache(cacheKey, map);
    return map;
}

async function fetchPriceAndReturn(ticker) {
    const map = await fetchBatchPriceAndReturn([ticker]);
    return map[ticker.toUpperCase()] || { price: null, ret3m: null };
}

async function fetchTickerSuggestions(query) {
    if (!query) return [];
    const apiKey = getApiKey();
    if (!apiKey) return [];
    const cacheKey = `search_${query.toLowerCase()}`;
    const cached = getCache(cacheKey, CACHE_TTL.search);
    if (cached) return cached;
    try {
        const data = await fetchJsonWithFallback(buildSearchUrls(query), apiKey);
        const items = extractQuoteItems(data);
        const results = items.map(i => {
            const symbol = normalizeSymbol(i);
            const name = i?.name || i?.companyName || i?.shortName || i?.longName || symbol;
            return symbol ? { symbol, name } : null;
        }).filter(Boolean).slice(0, 8);
        setCache(cacheKey, results);
        return results;
    } catch (e) {
        console.warn('Eulerpool search failed:', e.message);
        return [];
    }
}

async function fetchHistoricalPrice(ticker, date) {
    const apiKey = getApiKey();
    if (!apiKey) return null;
    const cacheKey = `hist_${ticker}_${date}`;
    const cached = getCache(cacheKey, CACHE_TTL.historical);
    if (cached != null) return cached;
    try {
        const data = await fetchJsonWithFallback(buildHistoricalUrls(ticker, date), apiKey);
        const prices = extractHistoryPrices(data);
        const price = prices.length ? prices[0] : null;
        if (price != null) setCache(cacheKey, price);
        return price;
    } catch (e) {
        console.warn(`Eulerpool historical fetch failed for ${ticker}:`, e.message);
        return null;
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
