/**
 * Stock Finance API - Finnhub only (CORS enabled, no proxy needed)
 */

const FINNHUB_API_KEY = 'd5vl98hr01qihi8ms730d5vl98hr01qihi8ms73g';
const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// Cache for API responses
const apiCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch from Finnhub API (direct, no proxy needed)
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
 * Fetch historical price (using candles endpoint)
 * Note: Finnhub free tier has limited historical data
 */
async function fetchHistoricalPrice(ticker, date) {
    try {
        const targetDate = new Date(date);
        const from = Math.floor(targetDate.getTime() / 1000);
        const to = from + (7 * 24 * 60 * 60); // 7 days range
        
        const data = await finnhubFetch(
            `/stock/candle?symbol=${encodeURIComponent(ticker)}&resolution=D&from=${from}&to=${to}`,
            `hist_${ticker}_${date}`
        );
        
        if (data && data.c && data.c.length > 0) {
            // Return first available close price
            return data.c[0];
        }
        
        // If no historical data, use current price as fallback
        const currentPrice = await fetchCurrentPrice(ticker);
        return currentPrice;
    } catch (error) {
        console.error(`Failed to fetch historical price for ${ticker}:`, error);
        // Fallback to current price
        return await fetchCurrentPrice(ticker);
    }
}

/**
 * Fetch 3-month trailing return
 */
async function fetch3MonthReturn(ticker) {
    try {
        const now = Math.floor(Date.now() / 1000);
        const threeMonthsAgo = now - (90 * 24 * 60 * 60);
        
        const data = await finnhubFetch(
            `/stock/candle?symbol=${encodeURIComponent(ticker)}&resolution=D&from=${threeMonthsAgo}&to=${now}`,
            `3m_${ticker}`
        );
        
        if (data && data.c && data.c.length >= 2) {
            const oldPrice = data.c[0];
            const newPrice = data.c[data.c.length - 1];
            return ((newPrice - oldPrice) / oldPrice * 100).toFixed(2);
        }
        return null;
    } catch (error) {
        console.error(`Failed to fetch 3-month return for ${ticker}:`, error);
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
