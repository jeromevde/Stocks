/**
 * Stock Finance API - Yahoo Finance (direct or via Puter.js)
 * Supports all markets: US, EU, Asia, etc.
 * Provides: search, current prices, historical prices, 3M return
 * 
 * Fetch strategy (in order):
 * 1. Direct API access (when host allows CORS)
 * 2. Puter.js pFetch (bypasses CORS using Puter's network infrastructure)
 */

// Cache for API responses with different TTLs
const apiCache = new Map();
const CACHE_TTL = {
    search: 10 * 60 * 1000,      // 10 minutes for search results
    price: 2 * 60 * 1000,         // 2 minutes for current prices
    historical: 24 * 60 * 60 * 1000,  // 24 hours for historical prices (they don't change)
    threeMonth: 5 * 60 * 1000     // 5 minutes for 3-month returns
};

// Environments like Codespaces/github.dev always block direct Yahoo fetches; skip to Puter there
function shouldSkipDirectFetch() {
    if (typeof window === 'undefined') return false;
    const host = window.location?.hostname || '';
    return host.endsWith('.github.dev') || host.endsWith('.githubpreview.dev');
}

/**
 * Global puter object provided by Puter.js SDK (loaded via CDN in index.html)
 * @external puter
 * @see {@link https://js.puter.com/v2/}
 */

/**
 * Try direct fetch to Yahoo Finance first, then Puter.js
 */
async function fetchWithHybridApproach(url, cacheKey, cacheTTL = CACHE_TTL.price) {
    // Check cache first
    const cached = apiCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheTTL) {
        return cached.data;
    }
    
    const skipDirect = shouldSkipDirectFetch();
    
    // Try direct access first (no CORS proxy) unless we know it will be blocked (github.dev, etc.)
    if (!skipDirect) {
        try {
            // Create abort controller for timeout (better browser compatibility)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(url, {
                headers: { 'Accept': 'application/json' },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const data = await response.json();
                apiCache.set(cacheKey, { data, timestamp: Date.now() });
                console.log(`✓ Direct access succeeded for ${cacheKey}`);
                return data;
            } else {
                console.log(`Direct access returned ${response.status} for ${cacheKey}`);
            }
        } catch (error) {
            // Direct access failed, try Puter.js next
            console.log(`Direct access failed for ${cacheKey}, trying Puter.js...`);
        }
    } else {
        console.log(`Skipping direct Yahoo fetch for ${cacheKey} (host blocks CORS), trying Puter.js...`);
    }
    
    // Try Puter.js pFetch (bypasses CORS)
    // Only require the fetch function so we don't skip valid SDK versions that lack APIOrigin
    const hasPuterFetch = typeof puter !== 'undefined' && typeof puter?.net?.fetch === 'function';
    if (hasPuterFetch) {
        // Retry more times if Puter websocket is still connecting; this improves first-load reliability
        for (let attempt = 0; attempt < 10; attempt++) {
            try {
                const response = await puter.net.fetch(url, {
                    headers: { 'Accept': 'application/json' }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    apiCache.set(cacheKey, { data, timestamp: Date.now() });
                    console.log(`✓ Puter.js fetch succeeded for ${cacheKey}`);
                    return data;
                } else {
                    const text = await response.text().catch(() => '<no body>');
                    console.log(`Puter.js fetch non-OK ${response.status} for ${cacheKey}`, text?.slice(0,200));
                }
            } catch (error) {
                const connecting = error?.message?.includes('CONNECTING state') || error?.name === 'InvalidStateError';
                if (connecting && attempt < 9) {
                    // Give the websocket time to finish connecting (progressively longer)
                    await new Promise(resolve => setTimeout(resolve, 300 + attempt * 150));
                    continue;
                }
                console.log(`Puter.js fetch failed for ${cacheKey}:`, {
                    url,
                    error: error.message,
                    stack: error.stack
                });
                break;
            }
        }
    } else if (typeof puter === 'undefined') {
        console.log(`Puter.js not loaded (may be blocked by ad blocker), direct request likely blocked.`);
    } else {
        console.log(`Puter.js loaded but puter.net.fetch not available.`);
    }
    
    throw new Error('All Yahoo fetch strategies failed (direct blocked and Puter unavailable)');
}

/**
 * Fetch ticker suggestions from Yahoo Finance
 */
async function fetchTickerSuggestions(query) {
    if (!query || query.length < 1) return [];
    
    try {
        const yahooUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
        const data = await fetchWithHybridApproach(yahooUrl, `search_${query}`, CACHE_TTL.search);
        
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
 * Batch fetch current prices for multiple tickers
 * Uses parallel requests with staggered delays to avoid rate limiting
 */
async function fetchBatchCurrentPrices(tickers) {
    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
        return {};
    }
    
    console.log(`Batch fetching prices for ${tickers.length} tickers...`);
    
    const fetchWithDelay = async (ticker, index) => {
        // Staggered delay to be polite to the endpoint
        await new Promise(resolve => setTimeout(resolve, index * 50));
        
        try {
            const now = Math.floor(Date.now() / 1000);
            const oneDayAgo = now - 86400 * 2;
            
            const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${oneDayAgo}&period2=${now}&interval=1d`;
            const data = await fetchWithHybridApproach(yahooUrl, `price_${ticker}`, CACHE_TTL.price);
            
            // Extract price
            let price = null;
            if (data?.chart?.result?.[0]?.meta?.regularMarketPrice) {
                price = data.chart.result[0].meta.regularMarketPrice;
            } else if (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close) {
                const closes = data.chart.result[0].indicators.quote[0].close.filter(p => p != null);
                if (closes.length > 0) {
                    price = closes[closes.length - 1];
                }
            }
            
            return [ticker, price];
        } catch (error) {
            console.warn(`Batch fetch failed for ${ticker}:`, error.message);
            return [ticker, null];
        }
    };
    
    // Execute all requests in parallel with staggered delays
    const results = await Promise.all(tickers.map((ticker, i) => fetchWithDelay(ticker, i)));
    return Object.fromEntries(results);
}

/**
 * Batch fetch 3-month returns for multiple tickers
 */
async function fetchBatch3MonthReturns(tickers) {
    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
        return {};
    }
    
    console.log(`Batch fetching 3M returns for ${tickers.length} tickers...`);
    
    const fetchWithDelay = async (ticker, index) => {
        await new Promise(resolve => setTimeout(resolve, index * 50));
        
        try {
            const now = new Date();
            const threeMonthsAgo = new Date();
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
            
            const period1 = Math.floor(threeMonthsAgo.getTime() / 1000);
            const period2 = Math.floor(now.getTime() / 1000);
            
            const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;
            const data = await fetchWithHybridApproach(yahooUrl, `3m_${ticker}`, CACHE_TTL.threeMonth);
            
            let returnPercent = null;
            if (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close) {
                const closes = data.chart.result[0].indicators.quote[0].close.filter(p => p != null);
                if (closes.length >= 2) {
                    const oldPrice = closes[0];
                    const newPrice = closes[closes.length - 1];
                    returnPercent = ((newPrice - oldPrice) / oldPrice * 100).toFixed(2);
                }
            }
            
            return [ticker, returnPercent];
        } catch (error) {
            console.warn(`Batch 3M fetch failed for ${ticker}:`, error.message);
            return [ticker, null];
        }
    };
    
    const results = await Promise.all(tickers.map((ticker, i) => fetchWithDelay(ticker, i)));
    return Object.fromEntries(results);
}

/**
 * Fetch current price for a stock from Yahoo Finance
 */
async function fetchCurrentPrice(ticker) {
    try {
        const now = Math.floor(Date.now() / 1000);
        const oneDayAgo = now - 86400 * 2; // 2 days back to ensure we get data
        
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${oneDayAgo}&period2=${now}&interval=1d`;
        const data = await fetchWithHybridApproach(yahooUrl, `price_${ticker}`, CACHE_TTL.price);
        
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
        console.warn(`Price parse failed for ${ticker}`, { meta: data?.chart?.result?.[0]?.meta, closes: data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close });
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
        
        const data = await fetchWithHybridApproach(yahooUrl, `hist_${ticker}_${date}`, CACHE_TTL.historical);
        
        if (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close) {
            const closes = data.chart.result[0].indicators.quote[0].close.filter(p => p != null);
            if (closes.length > 0) {
                return closes[0]; // Return first available close price
            }
        }
        console.warn(`Historical price parse failed for ${ticker} on ${date}`, { closes: data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close });
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
        
        const data = await fetchWithHybridApproach(yahooUrl, `3m_${ticker}`, CACHE_TTL.threeMonth);
        
        if (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close) {
            const closes = data.chart.result[0].indicators.quote[0].close.filter(p => p != null);
            if (closes.length >= 2) {
                const oldPrice = closes[0];
                const newPrice = closes[closes.length - 1];
                const returnPercent = ((newPrice - oldPrice) / oldPrice * 100);
                return returnPercent.toFixed(2);
            }
        }
        console.warn(`3M return parse failed for ${ticker}`, { closes: data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close });
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
    fetchBatchCurrentPrices,
    fetchBatch3MonthReturns,
    clearCache
};
