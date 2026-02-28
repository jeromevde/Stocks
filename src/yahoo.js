/**
 * Eulerpool Data API wrapper (replaces Yahoo Finance)
 */

const apiCache = new Map();
const CACHE_TTL = { search: 600000, quote: 180000, historical: 86400000 };
const EULERPOOL_BASE = 'https://api.eulerpool.com';

function getApiKey() {
    return (window.TokenStore?.get('eulerpool_api_key')) || localStorage.getItem('eulerpool_api_key') || '';
}

function buildHeaders(apiKey) {
    const headers = { Accept: 'application/json' };
    if (apiKey) {
        headers['X-API-KEY'] = apiKey;
        headers['x-api-key'] = apiKey;
        headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
}

function withApiKey(url, apiKey) {
    const u = new URL(url);
    if (apiKey) {
        if (!u.searchParams.has('apikey')) u.searchParams.set('apikey', apiKey);
        if (!u.searchParams.has('apiKey')) u.searchParams.set('apiKey', apiKey);
        if (!u.searchParams.has('token')) u.searchParams.set('token', apiKey);
    }
    return u.toString();
}

async function fetchJsonWithFallback(urls, apiKey) {
    let lastErr = null;
    for (const url of urls) {
        try {
            const res = await fetch(withApiKey(url, apiKey), { headers: buildHeaders(apiKey) });
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

function buildBatchUrls(tickers) {
    const list = encodeURIComponent(tickers.join(','));
    return [
        `${EULERPOOL_BASE}/data-api/batch/quote?tickers=${list}`,
        `${EULERPOOL_BASE}/data-api/batch/quotes?tickers=${list}`,
        `${EULERPOOL_BASE}/api/quote/batch?tickers=${list}`,
        `${EULERPOOL_BASE}/api/stock/batch?tickers=${list}`,
        `${EULERPOOL_BASE}/api/batch/quote?symbols=${list}`
    ];
}

function buildSearchUrls(query) {
    const q = encodeURIComponent(query);
    return [
        `${EULERPOOL_BASE}/data-api/search?q=${q}`,
        `${EULERPOOL_BASE}/data-api/search?query=${q}`,
        `${EULERPOOL_BASE}/api/search?q=${q}`,
        `${EULERPOOL_BASE}/search?q=${q}`
    ];
}

function buildHistoricalUrls(ticker, date) {
    const t = encodeURIComponent(ticker);
    const d = encodeURIComponent(date);
    return [
        `${EULERPOOL_BASE}/data-api/historical/${t}?from=${d}&to=${d}`,
        `${EULERPOOL_BASE}/data-api/stock/${t}/history?from=${d}&to=${d}`,
        `${EULERPOOL_BASE}/api/historical/${t}?from=${d}&to=${d}`,
        `${EULERPOOL_BASE}/api/stock/${t}/history?date=${d}`
    ];
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

    const data = await fetchJsonWithFallback(buildBatchUrls(tickers), apiKey);
    const items = extractQuoteItems(data);
    const map = {};
    items.forEach(item => {
        const symbol = normalizeSymbol(item);
        if (!symbol) return;
        map[symbol] = map[symbol] || {};
        const price = normalizePrice(item);
        const ret3m = normalize3mReturn(item);
        if (price != null) map[symbol].price = price;
        if (ret3m != null) map[symbol].ret3m = ret3m;
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
