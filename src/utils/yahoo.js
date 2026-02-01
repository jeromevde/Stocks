/**
 * Stock Finance API - Finnhub + Yahoo Finance via CORS proxy
 * Finnhub: quote + search (US stocks)
 * Yahoo Finance: historical data for 3M return (via proxy)
 */

const FINNHUB_API_KEY = 'd5vl98hr01qihi8ms730d5vl98hr01qihi8ms73g';
const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// CORS proxies for Yahoo Finance (fallback chain)
const CORS_PROXIES = [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url='
];

// Cache for API responses
const apiCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch from Finnhub API (direct, no proxy needed)
 * Note: Finnhub free tier only supports US stocks
 */
async function finnhubFetch(endpoint, cacheKey) {
    const fullCacheKey = cacheKey || endpoint;
    
    // Check cache
    const cached = apiCache.get(fullCacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data; 
    }
    
    const url = `${FINNHUB_BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}token=${FINNHUB_API_KEY}`;
    
    const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
        // 403 typically means the ticker is not supported (non-US stock)
        if (response.status === 403) {
            console.warn(`Ticker not supported by Finnhub free tier (non-US stock?)`);
            return null;
        }
        throw new Error(`Finnhub API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Cache response
    apiCache.set(fullCacheKey, { data, timestamp: Date.now() });
    
    return data;
}

/**
 * Fetch ticker suggestions
 */
async function fetchTickerSuggestions(query) {
    if (!query || query.length < 1) return [];
    
    try {
        const data = await finnhubFetch(`/search?q=${encodeURIComponent(query)}`, `search_${query}`);
        
        if (data?.result?.length > 0) {
            return data.result.slice(0, 8).map(item => ({
                symbol: item.symbol,
                name: item.description,
                type: item.type
            }));
        }
        return [];
    } catch (error) {
        console.error('Failed to fetch suggestions:', error);
        return [];
    }
}

/**
 * Fetch current price for a stock
 */
async function fetchCurrentPrice(ticker) {
    try {
        const data = await finnhubFetch(`/quote?symbol=${encodeURIComponent(ticker)}`, `price_${ticker}`);
        
        if (data && data.c && data.c > 0) {
            return data.c; // Current price
        }
        return null;
    } catch (error) {
        console.error(`Failed to fetch price for ${ticker}:`, error);
        return null;
    }
}

/**
 * Fetch historical price - Uses Yahoo Finance via CORS proxy
 */
async function fetchHistoricalPrice(ticker, date) {
    try {
        const targetDate = new Date(date);
        const now = new Date();
        
        // Calculate period for Yahoo Finance (need data around the target date)
        const period1 = Math.floor(targetDate.getTime() / 1000) - 86400 * 7; // 1 week before
        const period2 = Math.floor(targetDate.getTime() / 1000) + 86400 * 7; // 1 week after
        
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;
        
        const data = await fetchWithCorsProxy(yahooUrl, `hist_${ticker}_${date}`);
        
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
 * Fetch 3-month trailing return - Uses Yahoo Finance via CORS proxy
 */
async function fetch3MonthReturn(ticker) {
    try {
        const now = new Date();
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        
        const period1 = Math.floor(threeMonthsAgo.getTime() / 1000);
        const period2 = Math.floor(now.getTime() / 1000);
        
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;
        
        const data = await fetchWithCorsProxy(yahooUrl, `3m_${ticker}`);
        
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
 * Fetch data using CORS proxy with fallback
 */
async function fetchWithCorsProxy(url, cacheKey) {
    // Check cache first
    const cached = apiCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    
    // Try each proxy in order
    for (const proxy of CORS_PROXIES) {
        try {
            const proxyUrl = proxy + encodeURIComponent(url);
            const response = await fetch(proxyUrl, {
                headers: { 'Accept': 'application/json' }
            });
            
            if (response.ok) {
                const data = await response.json();
                // Cache successful response
                apiCache.set(cacheKey, { data, timestamp: Date.now() });
                return data;
            }
        } catch (e) {
            // Try next proxy
            continue;
        }
    }
    
    throw new Error('All CORS proxies failed');
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
