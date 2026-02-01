/**
 * Yahoo Finance API utilities
 * Handles fetching stock data with CORS proxy fallback
 */

// CORS Proxy configuration - using multiple reliable proxies with fallback
// These proxies are tested to work from GitHub Pages
const CORS_PROXIES = [
    // Primary: corsproxy.io - most reliable, works from any origin
    { 
        url: 'https://corsproxy.io/?',
        encode: true 
    },
    // Fallback: allorigins (returns wrapped JSON, need raw endpoint)
    { 
        url: 'https://api.allorigins.win/raw?url=',
        encode: true 
    },
    // Fallback: codetabs proxy
    {
        url: 'https://api.codetabs.com/v1/proxy?quest=',
        encode: true
    }
];

// Cache for API responses to reduce requests
const apiCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch JSON data through CORS proxy with fallback
 */
async function fetchWithCorsProxy(targetUrl) {
    // Check cache first
    const cached = apiCache.get(targetUrl);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    let lastError = null;
    
    for (const proxy of CORS_PROXIES) {
        try {
            const proxyUrl = proxy.encode 
                ? proxy.url + encodeURIComponent(targetUrl)
                : proxy.url + targetUrl;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
            
            const response = await fetch(proxyUrl, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            // Cache successful response
            apiCache.set(targetUrl, { data, timestamp: Date.now() });
            
            return data;
        } catch (error) {
            lastError = error;
            console.warn(`CORS proxy failed (${proxy.url}):`, error.message);
            continue;
        }
    }
    
    throw lastError || new Error('All CORS proxies failed');
}

/**
 * Fetch ticker suggestions from Yahoo Finance search
 */
async function fetchTickerSuggestions(query) {
    if (!query || query.length < 1) return [];
    
    const targetUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
    
    try {
        const data = await fetchWithCorsProxy(targetUrl);
        return (data.quotes || []).map(q => ({
            symbol: q.symbol,
            name: q.shortname || q.longname || q.symbol,
            type: q.quoteType,
            exchange: q.exchange
        }));
    } catch (error) {
        console.error('Failed to fetch ticker suggestions:', error);
        return [];
    }
}

/**
 * Fetch current price for a stock
 */
async function fetchCurrentPrice(ticker) {
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1m`;
    
    try {
        const data = await fetchWithCorsProxy(targetUrl);
        
        if (data?.chart?.result?.[0]?.meta?.regularMarketPrice) {
            return data.chart.result[0].meta.regularMarketPrice;
        }
        return null;
    } catch (error) {
        console.error(`Failed to fetch current price for ${ticker}:`, error);
        return null;
    }
}

/**
 * Fetch historical price for a specific date
 */
async function fetchHistoricalPrice(ticker, date) {
    const targetDate = new Date(date);
    const start = Math.floor(targetDate.getTime() / 1000);
    
    // Look ahead 7 days to handle weekends/holidays
    const endDate = new Date(targetDate.getTime() + (7 * 24 * 60 * 60 * 1000));
    const end = Math.floor(endDate.getTime() / 1000);
    
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=1d`;
    
    try {
        const data = await fetchWithCorsProxy(targetUrl);
        
        const result = data?.chart?.result?.[0];
        if (!result?.indicators?.quote?.[0]?.close || !result?.timestamp) {
            return null;
        }
        
        const prices = result.indicators.quote[0].close;
        const timestamps = result.timestamp;
        
        // Find first valid price on or after target date
        for (let i = 0; i < timestamps.length; i++) {
            const priceDate = new Date(timestamps[i] * 1000);
            if (priceDate >= targetDate && prices[i] != null) {
                return prices[i];
            }
        }
        
        // Fallback: use last available price
        for (let i = prices.length - 1; i >= 0; i--) {
            if (prices[i] != null) {
                return prices[i];
            }
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
    
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${start}&period2=${end}&interval=1d`;
    
    try {
        const data = await fetchWithCorsProxy(targetUrl);
        
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

// Export functions for use in other modules
window.YahooFinance = {
    fetchTickerSuggestions,
    fetchCurrentPrice,
    fetchHistoricalPrice,
    fetch3MonthReturn,
    clearCache: clearYahooCache
};
