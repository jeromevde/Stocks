/**
 * Stock Finance API - Yahoo Finance only (via CORS proxy)
 * Supports all markets: US, EU, Asia, etc.
 * Provides: search, current prices, historical prices, 3M return
 */

// CORS proxies for Yahoo Finance (fallback chain with more alternatives)
const CORS_PROXIES = [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest='  // Note: quest is the correct parameter
];

// Cache for API responses with different TTLs
const apiCache = new Map();
const CACHE_TTL = {
    search: 10 * 60 * 1000,      // 10 minutes for search results
    price: 2 * 60 * 1000,         // 2 minutes for current prices
    historical: 24 * 60 * 60 * 1000,  // 24 hours for historical prices (they don't change)
    threeMonth: 5 * 60 * 1000     // 5 minutes for 3-month returns
};

// Request throttling
const MIN_REQUEST_INTERVAL = 500; // 500ms between requests
let lastRequestTime = 0;

/**
 * Throttle requests to avoid overwhelming proxies
 */
async function throttleRequest() {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        const delay = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    lastRequestTime = Date.now();
}

/**
 * Fetch data using CORS proxy with fallback and exponential backoff
 */
async function fetchWithCorsProxy(url, cacheKey, cacheTTL = CACHE_TTL.price) {
    // Check cache first 
    const cached = apiCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheTTL) {
        return cached.data;
    }
    
    // Throttle the request
    await throttleRequest();
    
    let lastError = null;
    
    // Try each proxy in order with exponential backoff
    for (let proxyIndex = 0; proxyIndex < CORS_PROXIES.length; proxyIndex++) {
        const proxy = CORS_PROXIES[proxyIndex];
        
        // Try with exponential backoff (3 attempts per proxy)
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const proxyUrl = proxy + encodeURIComponent(url);
                const response = await fetch(proxyUrl, {
                    headers: { 'Accept': 'application/json' },
                    signal: AbortSignal.timeout(10000) // 10 second timeout
                });
                
                if (response.ok) {
                    const data = await response.json();
                    // Cache successful response
                    apiCache.set(cacheKey, { data, timestamp: Date.now() });
                    return data;
                }
                
                // If rate limited (429) or server error (5xx), retry with backoff
                if (response.status === 429 || response.status >= 500) {
                    const backoffDelay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                    lastError = new Error(`Proxy returned ${response.status}`);
                    continue;
                }
                
                // For other errors, try next proxy immediately
                lastError = new Error(`Proxy returned ${response.status}`);
                break;
            } catch (e) {
                lastError = e;
                
                // If timeout or network error, retry with backoff
                if (attempt < 2) {
                    const backoffDelay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                } else {
                    // Move to next proxy after 3 failed attempts
                    break;
                }
            }
        }
    }
    
    // If we have cached data (even if expired), return it as fallback
    if (cached) {
        console.warn(`Using expired cache for ${cacheKey} due to proxy failures`);
        return cached.data;
    }
    
    throw lastError || new Error('All CORS proxies failed');
}

/**
 * Fetch ticker suggestions from Yahoo Finance
 */
async function fetchTickerSuggestions(query) {
    if (!query || query.length < 1) return [];
    
    try {
        const yahooUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
        const data = await fetchWithCorsProxy(yahooUrl, `search_${query}`, CACHE_TTL.search);
        
        if (data?.quotes?.length > 0) {
            return data.quotes.slice(0, 8).map(item => ({
                symbol: item.symbol,
                name: item.shortname || item.longname || item.symbol,
                type: item.quoteType,
                exchange: item.exchange
            }));
        }
        return [];
    } catch (error) {
        console.error('Failed to fetch suggestions:', error);
        return [];
    }
}

/**
 * Fetch current price for a stock from Yahoo Finance
 */
async function fetchCurrentPrice(ticker) {
    try {
        const now = Math.floor(Date.now() / 1000);
        const oneDayAgo = now - 86400 * 2; // 2 days back to ensure we get data
        
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${oneDayAgo}&period2=${now}&interval=1d`;
        const data = await fetchWithCorsProxy(yahooUrl, `price_${ticker}`, CACHE_TTL.price);
        
        // Try to get the current market price from meta
        if (data?.chart?.result?.[0]?.meta?.regularMarketPrice) {
            return data.chart.result[0].meta.regularMarketPrice;
        }
        
        // Fallback: get the last close price
        if (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close) {
            const closes = data.chart.result[0].indicators.quote[0].close.filter(p => p != null);
            if (closes.length > 0) {
                return closes[closes.length - 1];
            }
        }
        
        return null;
    } catch (error) {
        console.warn(`Failed to fetch price for ${ticker}:`, error.message);
        return null;
    }
}

/**
 * Fetch historical price from Yahoo Finance
 */
async function fetchHistoricalPrice(ticker, date) {
    try {
        const targetDate = new Date(date);
        
        // Calculate period for Yahoo Finance (need data around the target date)
        const period1 = Math.floor(targetDate.getTime() / 1000) - 86400 * 7; // 1 week before
        const period2 = Math.floor(targetDate.getTime() / 1000) + 86400 * 7; // 1 week after
        
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;
        
        const data = await fetchWithCorsProxy(yahooUrl, `hist_${ticker}_${date}`, CACHE_TTL.historical);
        
        if (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close) {
            const closes = data.chart.result[0].indicators.quote[0].close.filter(p => p != null);
            if (closes.length > 0) {
                return closes[0]; // Return first available close price
            }
        }
        return null;
    } catch (error) {
        console.warn(`Failed to fetch historical price for ${ticker}:`, error.message);
        return null;
    }
}

/**
 * Fetch 3-month trailing return from Yahoo Finance
 */
async function fetch3MonthReturn(ticker) {
    try {
        const now = new Date();
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        
        const period1 = Math.floor(threeMonthsAgo.getTime() / 1000);
        const period2 = Math.floor(now.getTime() / 1000);
        
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;
        
        const data = await fetchWithCorsProxy(yahooUrl, `3m_${ticker}`, CACHE_TTL.threeMonth);
        
        if (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close) {
            const closes = data.chart.result[0].indicators.quote[0].close.filter(p => p != null);
            if (closes.length >= 2) {
                const oldPrice = closes[0];
                const newPrice = closes[closes.length - 1];
                const returnPercent = ((newPrice - oldPrice) / oldPrice * 100);
                return returnPercent.toFixed(2);
            }
        }
        return null;
    } catch (error) {
        console.warn(`Failed to fetch 3M return for ${ticker}:`, error.message);
        return null;
    }
}

/**
 * Clear the API cache
 */
function clearCache() {
    apiCache.clear();
}

// Export functions
window.YahooFinance = {
    fetchTickerSuggestions,
    fetchCurrentPrice,
    fetchHistoricalPrice,
    fetch3MonthReturn,
    clearCache
};
