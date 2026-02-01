/**
 * Stock Finance API utilities
 * Uses Finnhub (free, CORS-enabled) with Yahoo Finance fallback via proxy
 */

// Finnhub API - free tier, 60 calls/minute, native CORS support!
const FINNHUB_API_KEY = 'd5vl98hr01qihi8ms730d5vl98hr01qihi8ms73g';

// CORS Proxy fallback for Yahoo Finance (backup)
const CORS_PROXIES = [
    { url: 'https://thingproxy.freeboard.io/fetch/', encode: false },
    { url: 'https://corsproxy.io/?', encode: true },
    { url: 'https://api.allorigins.win/raw?url=', encode: true }
];

// Cache for API responses to reduce requests
const apiCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Track if we should use direct API or proxy
let useDirectApi = true;

/**
 * Try direct fetch first (works if CORS is disabled or API supports it)
 */
async function fetchDirect(url, timeout = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}

/**
 * Fetch with CORS proxy fallback
 */
async function fetchWithProxy(targetUrl) {
    for (const proxy of CORS_PROXIES) {
        try {
            const proxyUrl = proxy.encode 
                ? proxy.url + encodeURIComponent(targetUrl)
                : proxy.url + targetUrl;
            
            const data = await fetchDirect(proxyUrl, 15000);
            return data;
        } catch (error) {
            console.warn(`Proxy failed (${proxy.url}):`, error.message);
            continue;
        }
    }
    throw new Error('All proxies failed');
}

/**
 * Smart fetch - tries direct first, then proxies
 */
async function smartFetch(url, cacheKey) {
    // Check cache
    const cached = apiCache.get(cacheKey || url);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    
    let data;
    
    // Try direct fetch first (works with CORS disabled or Finnhub)
    if (useDirectApi) {
        try {
            data = await fetchDirect(url);
            apiCache.set(cacheKey || url, { data, timestamp: Date.now() });
            return data;
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.log('Direct API failed, trying proxies...');
            }
        }
    }
    
    // Fallback to proxy
    data = await fetchWithProxy(url);
    apiCache.set(cacheKey || url, { data, timestamp: Date.now() });
    return data;
}

/**
 * Fetch current price using Finnhub (CORS enabled!)
 */
async function fetchCurrentPrice(ticker) {
    try {
        // Finnhub quote endpoint - native CORS support!
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_API_KEY}`;
        const data = await smartFetch(url, `price_${ticker}`);
        
        if (data && data.c) {
            return data.c; // Current price
        }
        
        // Fallback to Yahoo
        return await fetchCurrentPriceYahoo(ticker);
    } catch (error) {
        console.warn(`Finnhub failed for ${ticker}, trying Yahoo...`);
        return await fetchCurrentPriceYahoo(ticker);
    }
}

/**
 * Yahoo Finance fallback for current price
 */
async function fetchCurrentPriceYahoo(ticker) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1m`;
    try {
        const data = await smartFetch(url, `yahoo_price_${ticker}`);
        return data?.chart?.result?.[0]?.meta?.regularMarketPrice || null;
    } catch (error) {
        console.error(`Failed to fetch price for ${ticker}:`, error);
        return null;
    }
}

/**
 * Fetch ticker suggestions - try Finnhub first, then Yahoo
 */
async function fetchTickerSuggestions(query) {
    if (!query || query.length < 1) return [];
    
    try {
        // Finnhub symbol search
        const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${FINNHUB_API_KEY}`;
        const data = await smartFetch(url, `search_${query}`);
        
        if (data?.result?.length > 0) {
            return data.result.slice(0, 8).map(item => ({
                symbol: item.symbol,
                name: item.description,
                type: item.type
            }));
        }
    } catch (e) {
        console.warn('Finnhub search failed, trying Yahoo...');
    }
    
    // Fallback to Yahoo
    const yahooUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
    try {
        const data = await smartFetch(yahooUrl, `yahoo_search_${query}`);
        return (data.quotes || []).map(q => ({
            symbol: q.symbol,
            name: q.shortname || q.longname || q.symbol,
            type: q.quoteType,
            exchange: q.exchange
        }));
    } catch (error) {
        console.error('Failed to fetch suggestions:', error);
        return [];
    }
}

/**
 * Fetch historical price for a specific date
 */
async function fetchHistoricalPrice(ticker, date) {
    const targetDate = new Date(date);
    const start = Math.floor(targetDate.getTime() / 1000);
    const endDate = new Date(targetDate.getTime() + (7 * 24 * 60 * 60 * 1000));
    const end = Math.floor(endDate.getTime() / 1000);
    
    // Use Yahoo for historical data (Finnhub needs premium for this)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=1d`;
    
    try {
        const data = await smartFetch(url, `hist_${ticker}_${date}`);
        
        const result = data?.chart?.result?.[0];
        if (!result?.indicators?.quote?.[0]?.close || !result?.timestamp) {
            return null;
        }
        
        const prices = result.indicators.quote[0].close;
        const timestamps = result.timestamp;
        
        for (let i = 0; i < timestamps.length; i++) {
            const priceDate = new Date(timestamps[i] * 1000);
            if (priceDate >= targetDate && prices[i] != null) {
                return prices[i];
            }
        }
        
        for (let i = prices.length - 1; i >= 0; i--) {
            if (prices[i] != null) return prices[i];
        }
        
        return null;
    } catch (error) {
        console.error(`Failed to fetch historical price for ${ticker}:`, error);
        return null;
    }
}

/**
 * Fetch 3-month trailing return
 */
async function fetch3MonthReturn(ticker) {
    const now = new Date();
    const threeMonthsAgo = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
    const start = Math.floor(threeMonthsAgo.getTime() / 1000);
    const end = Math.floor(now.getTime() / 1000);
    
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=1d`;
    
    try {
        const data = await smartFetch(url, `3m_${ticker}`);
        
        const prices = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
        if (!prices) return null;
        
        const validPrices = prices.filter(p => p != null);
        if (validPrices.length < 2) return null;
        
        const oldPrice = validPrices[0];
        const newPrice = validPrices[validPrices.length - 1];
        
        return ((newPrice - oldPrice) / oldPrice * 100).toFixed(2);
    } catch (error) {
        console.error(`Failed to fetch 3-month return for ${ticker}:`, error);
        return null;
    }
}

/**
 * Clear the API cache
 */
function clearYahooCache() {
    apiCache.clear();
}

/**
 * Set direct API mode (for when CORS is disabled in browser)
 */
function setDirectMode(enabled) {
    useDirectApi = enabled;
    console.log(`Direct API mode: ${enabled ? 'enabled' : 'disabled'}`);
}

// Export functions
window.YahooFinance = {
    fetchTickerSuggestions,
    fetchCurrentPrice,
    fetchHistoricalPrice,
    fetch3MonthReturn,
    clearCache: clearYahooCache,
    setDirectMode
};
