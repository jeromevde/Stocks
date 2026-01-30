// Initialize GitHub integration: setup login, logout, save, refresh knoppen
function initializeGitHubIntegration() {
    // Try automatic login from stored credentials
    tryAutoLogin();
    
    // Voorkom reload bij submit van het GitHub-authenticatieformulier
    const githubAuthForm = document.getElementById('github-auth-form');
    if (githubAuthForm) {
        githubAuthForm.addEventListener('submit', (e) => {
            e.preventDefault();
            // Sla portfolio tijdelijk op vóór authenticatie
            try {
                localStorage.setItem('portfolio_temp', JSON.stringify(portfolio));
            } catch (e) {}
            const tokenInput = document.getElementById('github-token');
            const ownerInput = document.getElementById('repo-owner');
            const repoInput = document.getElementById('repo-name');
            const token = tokenInput ? tokenInput.value : '';
            const owner = ownerInput ? ownerInput.value : '';
            const repo = repoInput ? repoInput.value : '';
            if (token && owner && repo) {
                // Save credentials for auto-login
                saveGitHubCredentials(token, owner, repo);
                window.githubClient.authenticate(token, owner, repo);
                updateGitHubUI();
                showStatus('Authenticated with GitHub!', 'success');
                // Close the modal
                const authModal = document.getElementById('github-auth-modal');
                if (authModal) authModal.style.display = 'none';
                // Herstel portfolio na authenticatie
                try {
                    const temp = localStorage.getItem('portfolio_temp');
                    if (temp) {
                        portfolio = JSON.parse(temp);
                        localStorage.removeItem('portfolio_temp');
                        debouncedUpdateTable();
                        hasUnsavedChanges = true;
                        updateSaveButtonState();
                    }
                } catch (e) {}
            } else {
                showStatus('Please enter all GitHub credentials.', 'error');
            }
        });
    }

    // GitHub logout
    const logoutButton = document.getElementById('github-logout');
    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            clearGitHubCredentials();
            window.githubClient.logout();
            updateGitHubUI();
            showStatus('Disconnected from GitHub', 'info');
        });
    }

    // Save button
    const saveButton = document.getElementById('save-portfolio');
    if (saveButton) {
        saveButton.addEventListener('click', (e) => {
            e.preventDefault();
            setTimeout(() => {
                savePortfolioToMarkdown()
                    .catch(error => console.error('Save error:', error));
            }, 0);
        });
    }

    // Refresh button
    const refreshButton = document.getElementById('refresh-portfolio');
    if (refreshButton) {
        refreshButton.addEventListener('click', (e) => {
            e.preventDefault();
            forceRefreshFromGitHub();
        });
    }
    
    // Close modal button
    const closeModalBtn = document.getElementById('close-auth-modal');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            const authModal = document.getElementById('github-auth-modal');
            if (authModal) authModal.style.display = 'none';
        });
    }
}

// Auto-login functions for GitHub
function saveGitHubCredentials(token, owner, repo) {
    try {
        localStorage.setItem('github_token', token);
        localStorage.setItem('github_owner', owner);
        localStorage.setItem('github_repo', repo);
    } catch (e) {
        console.warn('Could not save GitHub credentials:', e);
    }
}

function clearGitHubCredentials() {
    try {
        localStorage.removeItem('github_token');
        localStorage.removeItem('github_owner');
        localStorage.removeItem('github_repo');
    } catch (e) {
        console.warn('Could not clear GitHub credentials:', e);
    }
}

function tryAutoLogin() {
    try {
        const token = localStorage.getItem('github_token');
        const owner = localStorage.getItem('github_owner');
        const repo = localStorage.getItem('github_repo');
        
        if (token && owner && repo && window.githubClient) {
            window.githubClient.authenticate(token, owner, repo);
            updateGitHubUI();
            showStatus('Auto-logged in to GitHub', 'success');
            return true;
        }
    } catch (e) {
        console.warn('Auto-login failed:', e);
    }
    return false;
}

// CORS Proxy fallback system - tries multiple proxies until one works
const CORS_PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest='
];

async function fetchWithCorsProxy(targetUrl) {
    let lastError = null;
    for (const proxy of CORS_PROXIES) {
        try {
            const res = await fetch(proxy + encodeURIComponent(targetUrl));
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {
            lastError = e;
            continue; // Try next proxy
        }
    }
    throw lastError || new Error('All CORS proxies failed');
}

// Helper: Fetch ticker suggestions from Yahoo Finance
async function fetchTickerSuggestions(query) {
    if (!query) return [];
    const targetUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=5&newsCount=0`;
    try {
        const data = await fetchWithCorsProxy(targetUrl);
        return (data.quotes || []).map(q => ({symbol: q.symbol, name: q.shortname || q.longname || q.symbol}));
    } catch (e) {
        return [];
    }
}

// Global variables
let portfolio = [];
let sortByCumulativeReturn = false;
let sortBy3MonthReturn = false;
let labelFilterSet = new Set();
let tableUpdateTimeout = null;
let hasUnsavedChanges = false;
let initialPortfolioHash = null;
let showZeroStarStocks = false; // Collapsible zero-star stocks
let autosaveTimerId = null; // Autosave timer
let autosavePopupVisible = false; // Autosave popup state

// Portfolio change tracking functions
function calculatePortfolioHash() {
    const portfolioString = JSON.stringify(portfolio.map(stock => ({
        ticker: stock.ticker,
        date: stock.date,
        labels: stock.labels.slice().sort(), // Sort labels for consistent hashing
        notes: stock.notes,
        rating: stock.rating || 0
    })).sort((a, b) => a.ticker.localeCompare(b.ticker))); // Sort by ticker for consistency
    
    let hash = 0;
    for (let i = 0; i < portfolioString.length; i++) {
        const char = portfolioString.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
}

function markPortfolioChanged() {
    hasUnsavedChanges = true;
    updateSaveButtonState();
    
    // Update page title to indicate unsaved changes
    if (!document.title.includes('*')) {
        document.title = '* Stock Tracker';
    }
    
    // Start/restart autosave timer (5 minutes = 300000ms)
    startAutosaveTimer();
}

// Autosave timer functions
function startAutosaveTimer() {
    // Clear existing timer
    if (autosaveTimerId) {
        clearTimeout(autosaveTimerId);
    }
    
    // Only start timer if there are unsaved changes and user is authenticated
    if (hasUnsavedChanges && window.githubClient && window.githubClient.isAuthenticated()) {
        autosaveTimerId = setTimeout(() => {
            showAutosavePopup();
        }, 5 * 60 * 1000); // 5 minutes
    }
}

function showAutosavePopup() {
    if (!hasUnsavedChanges || autosavePopupVisible) return;
    
    autosavePopupVisible = true;
    const popup = document.getElementById('autosave-popup');
    if (popup) {
        popup.style.display = 'flex';
        
        // Auto-save countdown (10 seconds)
        let countdown = 10;
        const countdownEl = document.getElementById('autosave-countdown');
        if (countdownEl) countdownEl.textContent = countdown;
        
        const countdownInterval = setInterval(() => {
            countdown--;
            if (countdownEl) countdownEl.textContent = countdown;
            
            if (countdown <= 0) {
                clearInterval(countdownInterval);
                confirmAutosave();
            }
        }, 1000);
        
        // Store interval for cancellation
        popup.dataset.countdownInterval = countdownInterval;
    }
}

function confirmAutosave() {
    const popup = document.getElementById('autosave-popup');
    if (popup) {
        clearInterval(parseInt(popup.dataset.countdownInterval));
        popup.style.display = 'none';
    }
    autosavePopupVisible = false;
    
    // Perform save
    savePortfolioToMarkdown().catch(error => {
        console.error('Autosave error:', error);
        showStatus('Autosave failed: ' + error.message, 'error');
    });
}

function cancelAutosave() {
    const popup = document.getElementById('autosave-popup');
    if (popup) {
        clearInterval(parseInt(popup.dataset.countdownInterval));
        popup.style.display = 'none';
    }
    autosavePopupVisible = false;
    
    // Restart timer for another 5 minutes
    startAutosaveTimer();
}

function markPortfolioSaved() {
    hasUnsavedChanges = false;
    initialPortfolioHash = calculatePortfolioHash();
    updateSaveButtonState();
    
    // Remove unsaved indicator from title
    document.title = 'Stock Tracker';
    
    // Clear autosave timer
    if (autosaveTimerId) {
        clearTimeout(autosaveTimerId);
        autosaveTimerId = null;
    }
    
    // Update GitHub client's saved state
    if (window.githubClient) {
        const htmlContent = generateHtmlContent();
        window.githubClient.markAsSaved(htmlContent);
    }
}

function updateSaveButtonState() {
    const saveButton = document.getElementById('save-portfolio');
    if (saveButton) {
        if (hasUnsavedChanges) {
            saveButton.disabled = false;
            saveButton.textContent = '💾 Save to GitHub';
            saveButton.style.opacity = '1';
            saveButton.style.cursor = 'pointer';
            saveButton.title = 'Save changes to GitHub';
            saveButton.classList.add('has-changes');
        } else {
            saveButton.disabled = true;
            saveButton.textContent = '💾 No changes to save';
            saveButton.style.opacity = '0.5';
            saveButton.style.cursor = 'not-allowed';
            saveButton.title = 'No changes to save';
            saveButton.classList.remove('has-changes');
        }
    }
}

function generateHtmlContent() {
    let html = `<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <title>Portfolio</title>\n  <style>\n    body { font-family: Arial, sans-serif; margin: 2em; }\n    table { border-collapse: collapse; width: 100%; }\n    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }\n    th { background: #f4f4f4; }\n    tr:nth-child(even) { background: #fafafa; }\n    .star { color: gold; font-size: 1.2em; }\n  </style>\n</head>\n<body>\n  <h1>Portfolio</h1>\n  <p><em>Last updated: ${new Date().toISOString()}</em></p>\n  <table>\n    <thead>\n      <tr>\n        <th>Ticker</th>\n        <th>Name</th>\n        <th>Date</th>\n        <th>Labels</th>\n        <th>Notes</th>\n        <th>Rating</th>\n      </tr>\n    </thead>\n    <tbody>\n`;
    portfolio.forEach(s => {
        const labels = s.labels.join(', ');
        const notes = s.notes.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const rating = s.rating || 0;
        const ratingStars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
        const name = (s.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += `      <tr><td>${s.ticker}</td><td>${name}</td><td>${s.date}</td><td>${labels}</td><td>${notes}</td><td><span class="star">${ratingStars}</span> (${rating})</td></tr>\n`;
    });
    html += `    </tbody>\n  </table>\n  <p><small>Generated by Stock Tracker - ${portfolio.length} stocks tracked</small></p>\n</body>\n</html>\n`;
    return html;
}

// Debounced table update to prevent excessive re-renders
function debouncedUpdateTable() {
    if (tableUpdateTimeout) {
        clearTimeout(tableUpdateTimeout);
    }
    tableUpdateTimeout = setTimeout(() => {
        updatePortfolioTable();
    }, 100);
}

// Fetch historical price from Yahoo
async function fetchHistoricalPrice(ticker, date) {
    const targetDate = new Date(date);
    const start = Math.floor(targetDate.getTime() / 1000);
    
    // Add extra days to handle weekends and holidays - look back up to 7 days
    const endDate = new Date(targetDate.getTime() + (7 * 24 * 60 * 60 * 1000)); // 7 days later
    const end = Math.floor(endDate.getTime() / 1000);
    
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${start}&period2=${end}&interval=1d`;
    try {
        const data = await fetchWithCorsProxy(targetUrl);
        
        // Defensive checks for missing data
        if (
            !data.chart ||
            !data.chart.result ||
            !data.chart.result[0] ||
            !data.chart.result[0].indicators ||
            !data.chart.result[0].indicators.quote[0] ||
            !data.chart.result[0].indicators.quote[0].close
        ) {
            return null;
        }
        
        const prices = data.chart.result[0].indicators.quote[0].close;
        const timestamps = data.chart.result[0].timestamp;
        
        if (!prices || !timestamps || prices.length === 0) {
            return null;
        }
        
        // Find the first valid price on or after the target date
        for (let i = 0; i < timestamps.length; i++) {
            const priceDate = new Date(timestamps[i] * 1000);
            if (priceDate >= targetDate && prices[i] != null) {
                return prices[i];
            }
        }
        
        // If no price found on or after target date, use the last available price
        for (let i = prices.length - 1; i >= 0; i--) {
            if (prices[i] != null) {
                return prices[i];
            }
        }
        
        return null;
    } catch (e) {
        return null;
    }
}

// Fetch current price from Yahoo Finance
async function fetchCurrentPrice(ticker) {
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1m`;
    try {
        const data = await fetchWithCorsProxy(targetUrl);
        // Get the most recent price
        if (
            data.chart &&
            data.chart.result &&
            data.chart.result[0] &&
            data.chart.result[0].meta &&
            data.chart.result[0].meta.regularMarketPrice
        ) {
            return data.chart.result[0].meta.regularMarketPrice;
        }
        return null;
    } catch (e) {
        return null;
    }
}

// Fetch 3-month trailing return from Yahoo Finance
async function fetch3MonthReturn(ticker) {
    const now = new Date();
    const threeMonthsAgo = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
    const start = Math.floor(threeMonthsAgo.getTime() / 1000);
    const end = Math.floor(now.getTime() / 1000);
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${start}&period2=${end}&interval=1d`;
    try {
        const data = await fetchWithCorsProxy(targetUrl);
        if (
            data.chart &&
            data.chart.result &&
            data.chart.result[0] &&
            data.chart.result[0].indicators &&
            data.chart.result[0].indicators.quote[0] &&
            data.chart.result[0].indicators.quote[0].close
        ) {
            const prices = data.chart.result[0].indicators.quote[0].close.filter(p => p != null);
            if (prices.length >= 2) {
                const oldPrice = prices[0];
                const newPrice = prices[prices.length - 1];
                return ((newPrice - oldPrice) / oldPrice * 100).toFixed(2);
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

// Format date for improved display
function formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    const formatted = date.toLocaleDateString('en-US', options);
    
    let timeAgo = '';
    if (diffDays === 0) {
        timeAgo = 'Today';
    } else if (diffDays === 1) {
        timeAgo = '1 day ago';
    } else if (diffDays < 7) {
        timeAgo = `${diffDays} days ago`;
    } else if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        timeAgo = weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
    } else if (diffDays < 365) {
        const months = Math.floor(diffDays / 30);
        timeAgo = months === 1 ? '1 month ago' : `${months} months ago`;
    } else {
        const years = Math.floor(diffDays / 365);
        timeAgo = years === 1 ? '1 year ago' : `${years} years ago`;
    }
    
    return { formatted, timeAgo, diffDays };
}

// Save portfolio to markdown and upload to GitHub
async function savePortfolioToMarkdown() {
    const saveButton = document.getElementById('save-portfolio');
    if (!saveButton || saveButton.disabled) return;

    try {
        // Check if authenticated
        if (!window.githubClient || !window.githubClient.isAuthenticated()) {
            // Show authentication modal
            const authModal = document.getElementById('github-auth-modal');
            if (authModal) {
                authModal.style.display = 'flex';
                const tokenInput = document.getElementById('github-token');
                if (tokenInput) {
                    setTimeout(() => tokenInput.focus(), 100);
                }
            }
            showStatus('Please authenticate with GitHub to save your portfolio', 'error');
            return;
        }

        saveButton.disabled = true;
        saveButton.textContent = '💾 Saving...';
        showStatus('Saving to GitHub...', 'info');

    const content = generateHtmlContent();
    const stockCount = portfolio.length;
    const message = `Update portfolio (HTML) - ${stockCount} stock${stockCount !== 1 ? 's' : ''}`;

    const result = await window.githubClient.saveFile(content, message);
        
    markPortfolioSaved(); // Mark as saved
    showStatus(`✅ Portfolio saved to GitHub (${stockCount} stocks, HTML)`, 'success');
        
    } catch (error) {
        console.error('Save error:', error);
        showStatus(`❌ Save failed: ${error.message}`, 'error');
        updateSaveButtonState(); // Reset button state
    }
}

// Load portfolio from GitHub
async function loadPortfolioFromGitHub() {
    try {
        showStatus('Loading portfolio from GitHub...', 'info');
        
        // Break up the work - first get the file
        const result = await window.githubClient.loadFile();
        
        if (!result.exists) {
            showStatus('No portfolio file found on GitHub. Start by adding some stocks!', 'info');
            initialPortfolioHash = calculatePortfolioHash(); // Set initial hash for empty portfolio
            markPortfolioSaved();
            return;
        }
        
        // Allow UI to update
        await new Promise(resolve => setTimeout(resolve, 0));
        
        showStatus('Parsing portfolio data...', 'info');
        
    // Parse the HTML content
    const portfolioData = await parseHtmlContent(result.content);
        
        // Allow UI to update
        await new Promise(resolve => setTimeout(resolve, 0));
        
        // Merge with existing portfolio (keep starred status from loaded data, not local)
        portfolio.length = 0; // Clear existing portfolio
        portfolio.push(...portfolioData);
        
        // Set initial hash and mark as saved since we just loaded
        initialPortfolioHash = calculatePortfolioHash();
        markPortfolioSaved();
        
        // Refresh the table immediately with the loaded data
        updatePortfolioTable();
        
        showStatus(`Portfolio loaded: ${portfolio.length} stocks. Updating prices...`, 'success');
        
        // Allow UI to update before starting price updates
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Fetch fresh data for all stocks asynchronously to avoid blocking
        updateAllStockDataAsync(portfolio);
        
    } catch (error) {
        console.error('Load error:', error);
        showStatus(`Load failed: ${error.message}`, 'error');
        // Set initial hash even on error
        initialPortfolioHash = calculatePortfolioHash();
        markPortfolioSaved();
    }
}

// Separate function to parse markdown content
async function parseMarkdownContent(content) {
    console.log('Parsing markdown content...');
    
    const lines = content.split('\n');
    const portfolioData = [];
    let inTable = false;
    
    for (const line of lines) {
        // Find table header
        if (line.startsWith('|') && line.includes('Ticker')) {
            console.log('Found table header');
            inTable = true;
            continue;
        }
        
        // Skip separator line
        if (line.startsWith('|-----')) {
            continue;
        }
        
        // Process data rows
        if (inTable && line.startsWith('|')) {
            // Split by | but preserve escaped \| characters
            const columns = [];
            let currentCol = '';
            let i = 1; // Start after first |
            
            while (i < line.length - 1) { // End before last |
                if (line[i] === '\\' && line[i + 1] === '|') {
                    // Escaped pipe - add literal pipe to current column
                    currentCol += '|';
                    i += 2;
                } else if (line[i] === '|') {
                    // Column separator - finish current column
                    columns.push(currentCol.trim());
                    currentCol = '';
                    i += 1;
                } else {
                    // Regular character
                    currentCol += line[i];
                    i += 1;
                }
            }
            // Add the last column
            if (currentCol || columns.length > 0) {
                columns.push(currentCol.trim());
            }
            
            // Skip empty rows
            if (columns.every(col => col === '' || /^[\s-]*$/.test(col))) {
                continue;
            }
            
            // Handle different formats: old (4-5 columns) and new (6 columns with name)
            if (columns.length >= 4) {
                let ticker, name, date, labels, notes, starred;
                
                if (columns.length >= 6) {
                    // New format: Ticker | Name | Date | Labels | Notes | Starred
                    [ticker, name, date, labels, notes, starred] = columns;
                } else {
                    // Old format: Ticker | Date | Labels | Notes | [Starred]
                    [ticker, date, labels, notes, starred] = columns;
                    name = ''; // No name in old format
                }
                
                if (ticker && date && ticker !== 'Ticker' && date !== 'Date') {
                    portfolioData.push({
                        ticker: ticker.trim(),
                        name: name ? name.trim() : '', // No need to replace \\| anymore since we handled it during splitting
                        date: date.trim(),
                        labels: labels ? labels.split(',').map(l => l.trim()).filter(l => l) : [],
                        notes: notes ? notes.trim() : '', // No need to replace \\| anymore
                        starred: starred ? starred.trim() === 'true' : false,
                        nowPrice: 'Loading...',
                        cumulativeReturn: 'Calculating...'
                    });
                }
            }
        }
        
        // End of table
        if (inTable && !line.startsWith('|')) {
            break;
        }
    }
    
    console.log(`Portfolio data parsed: ${portfolioData.length} stocks`);
    return portfolioData;
}

// Asynchronously update all stock data with progress feedback
async function updateAllStockDataAsync(stocks) {
    if (!stocks || stocks.length === 0) return;
    
    let completed = 0;
    const total = stocks.length;
    
    // Process stocks in batches to avoid overwhelming the API
    const batchSize = 3;
    
    for (let i = 0; i < stocks.length; i += batchSize) {
        const batch = stocks.slice(i, i + batchSize);
        
        // Process batch in parallel
        const promises = batch.map(async (stock) => {
            try {
                await updateStockData(stock);
                completed++;
                
                // Update status occasionally
                if (completed % 3 === 0 || completed === total) {
                    showStatus(`Updated ${completed}/${total} stocks...`, 'info');
                }
            } catch (error) {
                console.error(`Error updating ${stock.ticker}:`, error);
                completed++;
            }
        });
        
        await Promise.all(promises);
        
        // Small delay between batches
        if (i + batchSize < stocks.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
    
    showStatus(`All ${total} stocks updated!`, 'success');
}

// Render portfolio
function updatePortfolioTable() {
    const portfolioTableBody = document.getElementById('portfolio-tbody');
    if (!portfolioTableBody) return;

    // Clear the table
    portfolioTableBody.innerHTML = '';
    
    // Sort: by rating (highest first), then by return metrics if requested
    let sorted = [...portfolio];
    sorted.sort((a, b) => {
        const aRating = a.rating || 0;
        const bRating = b.rating || 0;
        if (aRating !== bRating) return bRating - aRating;
        if (sortByCumulativeReturn) {
            const aVal = parseFloat(a.cumulativeReturn) || -Infinity;
            const bVal = parseFloat(b.cumulativeReturn) || -Infinity;
            return bVal - aVal;
        }
        if (sortBy3MonthReturn) {
            const aVal = parseFloat(a.return3m) || -Infinity;
            const bVal = parseFloat(b.return3m) || -Infinity;
            return bVal - aVal;
        }
        return 0;
    });
    
    // Filter by label if any selected
    let filtered = sorted;
    if (labelFilterSet.size > 0) {
        filtered = sorted.filter(stock => stock.labels.some(label => labelFilterSet.has(label)));
    }
    
    // Separate zero-star and rated stocks
    const ratedStocks = filtered.filter(stock => (stock.rating || 0) > 0);
    const zeroStarStocks = filtered.filter(stock => (stock.rating || 0) === 0);
    
    // Render rated stocks first
    ratedStocks.forEach(stock => renderStockRow(portfolioTableBody, stock));
    
    // Render zero-star stocks toggle row if there are any
    if (zeroStarStocks.length > 0) {
        const toggleRow = document.createElement('tr');
        toggleRow.className = 'zero-star-toggle-row';
        toggleRow.innerHTML = `
            <td colspan="9" style="text-align:center; background:#f5f5f5; cursor:pointer; padding:12px; border-top:2px solid #ddd;">
                <span style="color:#666; font-size:14px;">
                    <span class="zero-star-arrow" style="display:inline-block; transition:transform 0.2s; margin-right:8px;">${showZeroStarStocks ? '▼' : '▶'}</span>
                    ${zeroStarStocks.length} unrated stock${zeroStarStocks.length > 1 ? 's' : ''} 
                    <span style="color:#999; font-size:12px;">(click to ${showZeroStarStocks ? 'hide' : 'show'})</span>
                </span>
            </td>
        `;
        toggleRow.addEventListener('click', () => {
            showZeroStarStocks = !showZeroStarStocks;
            updatePortfolioTable();
        });
        portfolioTableBody.appendChild(toggleRow);
        
        // Render zero-star stocks if expanded
        if (showZeroStarStocks) {
            zeroStarStocks.forEach(stock => renderStockRow(portfolioTableBody, stock));
        }
    }
}

function renderStockRow(tableBody, stock) {
        const tr = document.createElement('tr');
        const notesShort = stock.notes && stock.notes.length > 20 ? stock.notes.slice(0, 20) + '…' : stock.notes;
        const stockIdx = portfolio.indexOf(stock);
        const rating = stock.rating || 0;
        const dateInfo = formatDateDisplay(stock.date);
        
        // Generate 5-star rating display
        const ratingHtml = [1,2,3,4,5].map(i => 
            `<span class="rating-star" data-rating="${i}" style="cursor:pointer; font-size:1.1em; color:${i <= rating ? '#f5b301' : '#ddd'};">${i <= rating ? '★' : '☆'}</span>`
        ).join('');
        
        // Notes preview with markdown indicator
        const hasImages = stock.notes && stock.notes.includes('![');
        const notesPreview = hasImages ? '🖼️ ' + (notesShort || 'Image') : (notesShort || '');
        
        // 3-month return display
        const return3m = stock.return3m;
        const return3mDisplay = return3m != null && return3m !== 'N/A' && return3m !== 'Error' ? 
            `<span style="color:${parseFloat(return3m) >= 0 ? '#4caf50' : '#f44336'}">${return3m}%</span>` : 
            (stock.loading ? '...' : 'N/A');
        
        tr.innerHTML = `
            <td style="text-align:center;">
                <div class="rating-container" data-idx="${stockIdx}">${ratingHtml}</div>
            </td>
            <td style="text-align:center;">
                <div class="ticker-cell" style="cursor:pointer;" data-ticker="${stock.ticker}">
                    <div style="font-weight:bold; color:#0066cc;">${stock.ticker}</div>
                    <div style="font-size:11px; color:#888; margin-top:2px;">${stock.name || ''}</div>
                </div>
            </td>
            <td style="text-align:center;">
                <div class="date-display" style="cursor:pointer;" data-idx="${stockIdx}">
                    <div style="font-size:12px; color:#333;">${dateInfo.formatted}</div>
                    <div style="font-size:10px; color:#999;">${dateInfo.timeAgo}</div>
                </div>
                <input type="date" value="${stock.date}" data-idx="${stockIdx}" class="edit-date" style="display:none; width:130px; border:1px solid #ddd; border-radius:4px; padding:4px; font-size:12px;">
            </td>
            <td style="text-align:center;">
                <div class="labels-container" data-idx="${stockIdx}" style="cursor:pointer; min-width:80px; padding:4px; border:1px solid transparent;">
                    ${stock.labels.map(label => `<span class="label-tag" style="display:inline-block; background:#e3f2fd; color:#1976d2; padding:2px 6px; margin:1px; border-radius:3px; font-size:11px;">${label}<span class="remove-label" data-label="${label}" style="margin-left:4px; cursor:pointer; font-weight:bold;">×</span></span>`).join('')}
                    <span class="add-label-btn" style="display:inline-block; background:#f0f0f0; color:#666; padding:2px 6px; margin:1px; border-radius:3px; font-size:11px; cursor:pointer;">+</span>
                </div>
                <div class="label-popup" data-idx="${stockIdx}" style="display:none; position:absolute; background:white; border:1px solid #ccc; border-radius:4px; padding:8px; box-shadow:0 2px 8px rgba(0,0,0,0.15); z-index:1000;">
                    <input type="text" class="label-input" placeholder="Add label" style="width:120px; padding:4px; margin-bottom:8px; border:1px solid #ccc; border-radius:3px;">
                    <div>
                        <button class="add-label-confirm" style="padding:4px 8px; margin-right:4px; background:#4caf50; color:white; border:none; border-radius:3px; cursor:pointer; font-size:11px;">Add</button>
                        <button class="cancel-label" style="padding:4px 8px; background:#f44336; color:white; border:none; border-radius:3px; cursor:pointer; font-size:11px;">Cancel</button>
                    </div>
                </div>
            </td>
            <td style="text-align:center;">
                <span class="notes-display" data-idx="${stockIdx}" style="cursor:pointer; display:inline-block; min-width:80px; padding:8px; border:1px solid transparent; background:#f9f9f9; color:#666; border-radius:3px; min-height:16px;">${notesPreview}</span>
            </td>
            <td style="text-align:right;">${stock.nowPrice != null ? (stock.loading ? '...' : '$' + stock.nowPrice) : ''}</td>
            <td class="return-3m" style="text-align:right;">${return3mDisplay}</td>
            <td class="cumulative-return" style="text-align:right; color: ${stock.loading || !stock.cumulativeReturn || stock.cumulativeReturn === 'N/A' || stock.cumulativeReturn === 'Error' ? '#666' : (parseFloat(stock.cumulativeReturn) >= 0 ? '#4caf50' : '#f44336')};">${stock.loading ? '...' : (stock.cumulativeReturn !== 'N/A' && stock.cumulativeReturn !== 'Error' ? stock.cumulativeReturn + '%' : stock.cumulativeReturn)}</td>
            <td style="text-align:center; width:30px;"><button class="remove-btn" data-idx="${stockIdx}" style="background:none; color:#ccc; border:none; cursor:pointer; padding:2px; font-size:16px; transition:color 0.2s; line-height:1;">×</button></td>
        `;
        
        // Rating star click handlers
        tr.querySelectorAll('.rating-star').forEach(star => {
            star.addEventListener('click', (e) => {
                e.stopPropagation();
                const newRating = parseInt(star.getAttribute('data-rating'));
                // Toggle: if clicking same rating, set to 0
                portfolio[stockIdx].rating = (portfolio[stockIdx].rating === newRating) ? 0 : newRating;
                markPortfolioChanged();
                updatePortfolioTable();
            });
        });
        
        // Remove button event listener
        const removeBtn = tr.querySelector('.remove-btn');
        removeBtn.addEventListener('click', () => {
            const stock = portfolio[stockIdx];
            const confirmMessage = `Are you sure you want to remove ${stock.ticker} from your portfolio?`;
            
            if (confirm(confirmMessage)) {
                portfolio.splice(stockIdx, 1);
                markPortfolioChanged(); // Mark as changed
                updatePortfolioTable();
                showStatus(`${stock.ticker} removed from portfolio`, 'info');
            }
        });
        
        // Date display click to show date picker
        const dateDisplay = tr.querySelector('.date-display');
        const dateInput = tr.querySelector('.edit-date');
        dateDisplay.addEventListener('click', () => {
            dateDisplay.style.display = 'none';
            dateInput.style.display = 'block';
            dateInput.focus();
        });
        
        // Date input event listener
        dateInput.addEventListener('change', (e) => {
            const newDate = e.target.value;
            portfolio[stockIdx].date = newDate;
            markPortfolioChanged(); // Mark as changed
            
            // Update prices asynchronously without blocking
            const ticker = portfolio[stockIdx].ticker;
            updateStockPricesAsync(ticker, newDate, stockIdx);
            
            updatePortfolioTable();
        });
        
        dateInput.addEventListener('blur', () => {
            dateDisplay.style.display = 'block';
            dateInput.style.display = 'none';
        });
        
        // Label management
        const labelsContainer = tr.querySelector('.labels-container');
        const labelPopup = tr.querySelector('.label-popup');
        const labelInput = tr.querySelector('.label-input');
        const addLabelBtn = tr.querySelector('.add-label-btn');
        const confirmBtn = tr.querySelector('.add-label-confirm');
        const cancelBtn = tr.querySelector('.cancel-label');
        
        // Show popup when clicking + button
        const showLabelPopup = (e) => {
            e.stopPropagation();
            const rect = labelsContainer.getBoundingClientRect();
            labelPopup.style.display = 'block';
            labelPopup.style.position = 'absolute';
            labelPopup.style.left = (rect.left + window.scrollX) + 'px';
            labelPopup.style.top = (rect.bottom + window.scrollY + 2) + 'px';
            labelInput.focus();
        };
        
        addLabelBtn.addEventListener('click', showLabelPopup);
        
        // Hide popup when clicking outside
        document.addEventListener('click', (e) => {
            if (!labelPopup.contains(e.target) && !labelsContainer.contains(e.target)) {
                labelPopup.style.display = 'none';
                labelInput.value = '';
            }
        });
        
        // Add label
        const addLabel = () => {
            const newLabel = labelInput.value.trim();
            if (newLabel && !portfolio[stockIdx].labels.includes(newLabel)) {
                portfolio[stockIdx].labels.push(newLabel);
                markPortfolioChanged(); // Mark as changed
                updatePortfolioTable();
            }
            labelPopup.style.display = 'none';
            labelInput.value = '';
        };
        
        confirmBtn.addEventListener('click', addLabel);
        labelInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addLabel();
            }
            if (e.key === 'Escape') {
                labelPopup.style.display = 'none';
                labelInput.value = '';
            }
        });
        
        // Cancel
        cancelBtn.addEventListener('click', () => {
            labelPopup.style.display = 'none';
            labelInput.value = '';
        });
        
        // Remove labels
        tr.querySelectorAll('.remove-label').forEach(removeBtn => {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const labelToRemove = removeBtn.getAttribute('data-label');
                portfolio[stockIdx].labels = portfolio[stockIdx].labels.filter(l => l !== labelToRemove);
                markPortfolioChanged(); // Mark as changed
                updatePortfolioTable();
            });
        });
        
        // Notes editing with popup
        const notesDisplay = tr.querySelector('.notes-display');
        notesDisplay.addEventListener('click', () => {
            openNotesPopup(stockIdx);
        });
        
        // Ticker click to open Yahoo Finance
        const tickerCell = tr.querySelector('.ticker-cell');
        tickerCell.addEventListener('click', () => {
            window.open(`https://finance.yahoo.com/quote/${stock.ticker}`, '_blank');
        });
        
        tableBody.appendChild(tr);
}

// Initialize everything after DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Direct refresh bij laden
    forceRefreshFromGitHub();
    const stockInput = document.getElementById('stock-input');
    const portfolioTableBody = document.getElementById('portfolio-tbody');
    
    if (!stockInput || !portfolioTableBody) {
        console.error('Required DOM elements not found');
        return;
    }
    
    // Ticker autocomplete
    stockInput.addEventListener('input', async (e) => {
        const val = e.target.value;
        if (val.length < 1) return;
        const suggestions = await fetchTickerSuggestions(val);
        const datalist = document.getElementById('ticker-list');
        datalist.innerHTML = '';
        suggestions.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.symbol;
            opt.label = s.name;
            datalist.appendChild(opt);
        });
    });
    
    // Add stock
    stockInput.addEventListener('change', (e) => {
        const ticker = stockInput.value.trim().toUpperCase();
        if (!ticker) {
            return;
        }
        
        // Clear input immediately for better UX
        stockInput.value = '';
        
        // Handle stock addition asynchronously without blocking
        addStockAsync(ticker);
    });
    
    // Label filter dropdown logic
    const labelHeader = document.getElementById('label-header');
    const dropdown = document.getElementById('label-filter-dropdown');
    
    if (labelHeader && dropdown) {
        labelHeader.addEventListener('click', (e) => {
            // Get unique labels
            const labels = Array.from(new Set(portfolio.flatMap(s => s.labels).filter(l => l)));
            
            // Position dropdown properly
            const rect = labelHeader.getBoundingClientRect();
            dropdown.style.left = rect.left + 'px';
            dropdown.style.top = (rect.bottom + 5) + 'px';
            
            dropdown.innerHTML = '';
            
            // Add "Select All" checkbox
            const selectAllDiv = document.createElement('div');
            selectAllDiv.style.marginBottom = '8px';
            selectAllDiv.style.borderBottom = '1px solid #ccc';
            selectAllDiv.style.paddingBottom = '5px';
            
            const selectAllId = 'label-filter-select-all';
            const allChecked = labels.length > 0 && labels.every(label => labelFilterSet.has(label));
            
            selectAllDiv.innerHTML = `<label><input type="checkbox" id="${selectAllId}" ${allChecked ? 'checked' : ''}> <strong>Select All</strong></label>`;
            dropdown.appendChild(selectAllDiv);
            
            // Add event listener for Select All
            selectAllDiv.querySelector('input').addEventListener('change', (ev) => {
                if (ev.target.checked) {
                    // Add all labels to filter set
                    labels.forEach(label => labelFilterSet.add(label));
                    // Check all checkboxes
                    dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                        cb.checked = true;
                    });
                } else {
                    // Clear filter set
                    labelFilterSet.clear();
                    // Uncheck all checkboxes
                    dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                        cb.checked = false;
                    });
                }
                updatePortfolioTable();
            });
            
            // Add individual label checkboxes
            labels.forEach(label => {
                const id = 'label-filter-' + label.replace(/\s+/g, '-');
                const div = document.createElement('div');
                div.innerHTML = `<label><input type="checkbox" id="${id}" value="${label}" ${labelFilterSet.has(label) ? 'checked' : ''}> ${label}</label>`;
                dropdown.appendChild(div);
                
                div.querySelector('input').addEventListener('change', (ev) => {
                    if (ev.target.checked) {
                        labelFilterSet.add(label);
                    } else {
                        labelFilterSet.delete(label);
                    }
                    
                    // Update Select All checkbox state
                    const allChecked = labels.length > 0 && labels.every(l => labelFilterSet.has(l));
                    const selectAllCheckbox = document.getElementById(selectAllId);
                    if (selectAllCheckbox) {
                        selectAllCheckbox.checked = allChecked;
                    }
                    
                    updatePortfolioTable();
                });
            });
            
            // Add Clear All button
            if (labels.length > 0) {
                const clearAllDiv = document.createElement('div');
                clearAllDiv.style.marginTop = '8px';
                clearAllDiv.style.borderTop = '1px solid #ccc';
                clearAllDiv.style.paddingTop = '5px';
                
                const clearButton = document.createElement('button');
                clearButton.innerText = 'Clear All';
                clearButton.style.padding = '3px 8px';
                clearButton.style.fontSize = '12px';
                
                clearButton.addEventListener('click', () => {
                    labelFilterSet.clear();
                    dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                        cb.checked = false;
                    });
                    updatePortfolioTable();
                });
                
                clearAllDiv.appendChild(clearButton);
                dropdown.appendChild(clearAllDiv);
            }
            
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
            e.stopPropagation();
        });
        
        document.body.addEventListener('click', () => {
            dropdown.style.display = 'none';
        });
        
        dropdown.addEventListener('click', (e) => e.stopPropagation());
    }
    
    // Add sort event listener for cumulative return
    const sortHeader = document.getElementById('sort-cumret');
    if (sortHeader) {
        sortHeader.addEventListener('click', () => {
            sortByCumulativeReturn = !sortByCumulativeReturn;
            sortBy3MonthReturn = false;
            updatePortfolioTable();
        });
    }
    
    // Add sort event listener for 3-month return
    const sort3MHeader = document.getElementById('sort-3m-return');
    if (sort3MHeader) {
        sort3MHeader.addEventListener('click', () => {
            sortBy3MonthReturn = !sortBy3MonthReturn;
            sortByCumulativeReturn = false;
            updatePortfolioTable();
        });
    }

    // Initialize GitHub integration with a small delay to ensure DOM is ready
    setTimeout(() => {
        initializeGitHubIntegration();
    }, 100);

    // Initial render of portfolio
    updatePortfolioTable();
});

// Add before page unload warning
window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
        const message = 'You have unsaved changes to your portfolio. Are you sure you want to leave?';
        e.preventDefault();
        e.returnValue = message;
        return message;
    }
});

// Add keyboard shortcut for force refresh (Ctrl+Shift+R or Cmd+Shift+R)
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        forceRefreshFromGitHub();
    }
});

// Force refresh from GitHub (clears cache)
async function forceRefreshFromGitHub() {
    try {
        showStatus('🔄 Force refreshing from GitHub (clearing cache)...', 'info');
        
        // Clear all caches
        if (window.githubClient) {
            window.githubClient.clearCache();
        }
        
        // Also clear browser cache for the current page
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames.map(cacheName => caches.delete(cacheName))
            );
        }
        
        // Force reload from GitHub
        await loadPortfolioFromGitHub();
        
    } catch (error) {
        console.error('Force refresh error:', error);
        showStatus(`❌ Force refresh failed: ${error.message}`, 'error');
    }
}

// GitHub Integration Functions
function showStatus(message, type = 'info') {
    const statusElement = document.getElementById('save-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = `status-message ${type}`;
        
        // Auto-hide success/info messages after 5 seconds
        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                statusElement.style.display = 'none';
            }, 5000);
        }
    }
}

function updateGitHubUI() {
    const statusSection = document.getElementById('github-status');
    const saveButton = document.getElementById('save-portfolio');
    const githubInfo = document.getElementById('github-info');
    
    if (window.githubClient && window.githubClient.isAuthenticated()) {
        // Show status section when authenticated
        statusSection.style.display = 'block';
        saveButton.disabled = false;
        
        if (githubInfo) {
            githubInfo.textContent = `✅ Connected to ${window.githubClient.repoOwner}/${window.githubClient.repoName}`;
        }
    } else {
        // Hide status section when not authenticated
        statusSection.style.display = 'none';
        saveButton.disabled = false; // Enable save button to allow triggering auth flow
    }
}

// Parse HTML content to portfolio data
async function parseHtmlContent(content) {
    console.log('Parsing HTML content...');
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const rows = doc.querySelectorAll('table tbody tr');
    const portfolioData = [];
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length === 6) {
            const labels = cells[3].textContent.split(',').map(l => l.trim()).filter(Boolean);
            const notes = cells[4].textContent;
            // Parse rating from content like "★★★☆☆ (3)" or just count stars
            const ratingText = cells[5].textContent;
            let rating = 0;
            const ratingMatch = ratingText.match(/\((\d)\)/);
            if (ratingMatch) {
                rating = parseInt(ratingMatch[1]);
            } else {
                // Count filled stars
                rating = (ratingText.match(/★/g) || []).length;
            }
            // Backwards compatibility: if it just says "true" or has a single star, treat as starred (rating 5)
            if (ratingText.includes('true') || (rating === 0 && ratingText.includes('★'))) {
                rating = 5;
            }
            portfolioData.push({
                ticker: cells[0].textContent,
                name: cells[1].textContent,
                date: cells[2].textContent,
                labels,
                notes,
                rating,
                nowPrice: 'Loading...',
                cumulativeReturn: 'Calculating...',
                return3m: 'Loading...'
            });
        }
    });
    console.log(`Portfolio data parsed: ${portfolioData.length} stocks`);
    return portfolioData;
}

// Helper function to update individual stock data
async function updateStockData(stock) {
    try {
        // Fetch current price
        const currentPrice = await fetchCurrentPrice(stock.ticker);
        if (currentPrice !== null) {
            stock.nowPrice = currentPrice.toFixed(2);
        }
        
        // Fetch historical price and calculate return
        const historicalPrice = await fetchHistoricalPrice(stock.ticker, stock.date);
        if (historicalPrice !== null && currentPrice !== null) {
            const returnPercent = ((currentPrice - historicalPrice) / historicalPrice * 100);
            stock.cumulativeReturn = returnPercent.toFixed(2);
        }
        
        // Fetch 3-month trailing return
        const return3m = await fetch3MonthReturn(stock.ticker);
        if (return3m !== null) {
            stock.return3m = return3m;
        } else {
            stock.return3m = 'N/A';
        }
        
        // Update the table (use debounced update to avoid excessive re-renders)
        debouncedUpdateTable();
        
    } catch (error) {
        console.error(`Error updating ${stock.ticker}:`, error);
        // Set fallback values on error
        if (!stock.nowPrice || stock.nowPrice === 'Loading...') {
            stock.nowPrice = 'Error';
        }
        if (!stock.cumulativeReturn || stock.cumulativeReturn === 'Calculating...') {
            stock.cumulativeReturn = 'Error';
        }
        if (!stock.return3m) {
            stock.return3m = 'Error';
        }
    }
}

// Async helper for adding stocks without blocking the event handler
async function addStockAsync(ticker) {
    try {
        // Validate ticker exists on Yahoo before adding
        const suggestions = await fetchTickerSuggestions(ticker);
        const matchedStock = suggestions.find(s => s.symbol.toUpperCase() === ticker);
        if (!matchedStock) {
            alert('Stock ticker not found. Please try again.');
            return;
        }
        
        const date = new Date().toISOString().slice(0,10);
        
        // Add stock immediately with loading state
        const stock = {
            ticker, 
            name: matchedStock.name || ticker,
            date, 
            labels: [], 
            notes: '',
            nowPrice: '...',
            cumulativeReturn: '...',
            return3m: '...',
            rating: 0,
            loading: true
        };
        portfolio.push(stock);
        markPortfolioChanged(); // Mark as changed
        updatePortfolioTable();
        
        // Then fetch prices asynchronously
        try {
            const startPrice = await fetchHistoricalPrice(ticker, date);
            const nowPrice = await fetchHistoricalPrice(ticker, new Date().toISOString().slice(0,10));
            const return3m = await fetch3MonthReturn(ticker);
            
            // Find the stock again (in case portfolio changed)
            const stockIndex = portfolio.findIndex(s => s.ticker === ticker && s.loading);
            if (stockIndex !== -1) {
                if (startPrice != null && nowPrice != null) {
                    const cumulativeReturn = ((nowPrice - startPrice) / startPrice * 100).toFixed(2);
                    portfolio[stockIndex].nowPrice = Number(nowPrice).toFixed(2);
                    portfolio[stockIndex].cumulativeReturn = cumulativeReturn;
                } else {
                    portfolio[stockIndex].nowPrice = 'N/A';
                    portfolio[stockIndex].cumulativeReturn = 'N/A';
                }
                portfolio[stockIndex].return3m = return3m || 'N/A';
                portfolio[stockIndex].loading = false;
                updatePortfolioTable();
                // Auto-save is disabled - user saves manually
            }
        } catch (error) {
            // Find the stock and mark as error
            const stockIndex = portfolio.findIndex(s => s.ticker === ticker && s.loading);
            if (stockIndex !== -1) {
                portfolio[stockIndex].nowPrice = 'Error';
                portfolio[stockIndex].cumulativeReturn = 'Error';
                portfolio[stockIndex].return3m = 'Error';
                portfolio[stockIndex].loading = false;
                updatePortfolioTable();
            }
        }
    } catch (error) {
        console.error('Error adding stock:', error);
        alert('Error adding stock. Please try again.');
    }
}

// Async helper for updating stock prices without blocking the event handler
function updateStockPricesAsync(ticker, newDate, stockIdx) {
    // Fire and forget - update prices in background
    Promise.all([
        fetchHistoricalPrice(ticker, newDate),
        fetchHistoricalPrice(ticker, new Date().toISOString().slice(0,10))
    ]).then(([startPrice, nowPrice]) => {
        if (portfolio[stockIdx]) {
            portfolio[stockIdx].nowPrice = nowPrice ? Number(nowPrice).toFixed(2) : 'N/A';
            portfolio[stockIdx].cumulativeReturn = (startPrice && nowPrice) ? 
                ((nowPrice - startPrice) / startPrice * 100).toFixed(2) : 'N/A';
            updatePortfolioTable();
        }
    }).catch(error => {
        console.error(`Error updating prices for ${ticker}:`, error);
        if (portfolio[stockIdx]) {
            portfolio[stockIdx].nowPrice = 'Error';
            portfolio[stockIdx].cumulativeReturn = 'Error';
            updatePortfolioTable();
        }
    });
}

// Notes popup functionality
let currentNotesStockIndex = null;

// Helper: Shorten base64 image URLs for display in textarea
function shortenImageUrlsForDisplay(text) {
    if (!text) return '';
    // Match markdown images with base64 data URLs and shorten them
    return text.replace(/!\[([^\]]*)\]\((data:image\/[^;]+;base64,)([A-Za-z0-9+/=]{50,})\)/g, (match, alt, prefix, base64) => {
        // Keep first 20 chars of base64 for identification
        const shortBase64 = base64.substring(0, 20) + '...';
        return `![${alt}](${prefix}${shortBase64})`;
    });
}

// Helper: Restore shortened base64 URLs back to full data
// We store a map of shortened URLs to full URLs
let imageDataMap = {};

function storeAndShortenImages(text) {
    if (!text) return '';
    imageDataMap = {}; // Reset map
    
    return text.replace(/!\[([^\]]*)\]\((data:image\/[^;]+;base64,)([A-Za-z0-9+/=]{50,})\)/g, (match, alt, prefix, base64) => {
        const shortKey = base64.substring(0, 20);
        imageDataMap[shortKey] = base64; // Store full base64
        return `![${alt}](${prefix}${shortKey}...)`;
    });
}

function restoreFullImageUrls(text) {
    if (!text) return '';
    // Restore shortened base64 URLs to full data
    return text.replace(/!\[([^\]]*)\]\((data:image\/[^;]+;base64,)([A-Za-z0-9+/=]{20})\.\.\.\)/g, (match, alt, prefix, shortKey) => {
        const fullBase64 = imageDataMap[shortKey];
        if (fullBase64) {
            return `![${alt}](${prefix}${fullBase64})`;
        }
        return match; // Return original if no match found
    });
}

function openNotesPopup(stockIndex) {
    currentNotesStockIndex = stockIndex;
    const stock = portfolio[stockIndex];
    
    // Update popup content
    const overlay = document.getElementById('notes-popup-overlay');
    const stockTitle = document.getElementById('notes-popup-stock');
    const textarea = document.getElementById('notes-textarea');
    
    if (stockTitle) stockTitle.textContent = stock.ticker || '';
    
    // Store and shorten images for editing
    if (textarea) {
        textarea.value = storeAndShortenImages(stock.notes || '');
    }
    
    // Show popup with animation
    overlay.style.display = 'flex';
    setTimeout(() => {
        overlay.classList.add('show');
        if (textarea) {
            textarea.focus();
        }
    }, 10);
}

function closeNotesPopup() {
    // Save notes before closing
    const textarea = document.getElementById('notes-textarea');
    if (textarea && currentNotesStockIndex !== null) {
        portfolio[currentNotesStockIndex].notes = restoreFullImageUrls(textarea.value);
        markPortfolioChanged();
        updatePortfolioTable();
    }
    
    const overlay = document.getElementById('notes-popup-overlay');
    overlay.classList.remove('show');
    
    setTimeout(() => {
        overlay.style.display = 'none';
        currentNotesStockIndex = null;
        imageDataMap = {}; // Clear image map
    }, 300);
}

// Initialize notes popup event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Autosave popup handlers
    const autosaveConfirm = document.getElementById('autosave-confirm');
    const autosaveCancel = document.getElementById('autosave-cancel');
    
    if (autosaveConfirm) {
        autosaveConfirm.addEventListener('click', confirmAutosave);
    }
    if (autosaveCancel) {
        autosaveCancel.addEventListener('click', cancelAutosave);
    }

    // Notes popup event listeners
    const notesOverlay = document.getElementById('notes-popup-overlay');
    const notesCloseBtn = document.getElementById('notes-popup-close');
    const notesTextarea = document.getElementById('notes-textarea');
    
    // Close popup when clicking overlay
    notesOverlay.addEventListener('click', (e) => {
        if (e.target === notesOverlay) {
            closeNotesPopup();
        }
    });
    
    // Close button
    notesCloseBtn.addEventListener('click', closeNotesPopup);
    
    // Image upload
    const addImageBtn = document.getElementById('add-image-btn');
    const imageUpload = document.getElementById('image-upload');
    
    if (addImageBtn && imageUpload) {
        addImageBtn.addEventListener('click', () => {
            imageUpload.click();
        });
        
        imageUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            // Convert to base64 and add to textarea
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result;
                insertImageIntoTextarea(notesTextarea, base64, file.name);
            };
            reader.readAsDataURL(file);
            
            // Reset input
            imageUpload.value = '';
        });
    }
    
    // Paste image from clipboard (Cmd+V / Ctrl+V)
    if (notesTextarea) {
        notesTextarea.addEventListener('paste', (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (!file) return;
                    
                    const reader = new FileReader();
                    reader.onload = () => {
                        const base64 = reader.result;
                        insertImageIntoTextarea(notesTextarea, base64, 'pasted-image');
                    };
                    reader.readAsDataURL(file);
                    break;
                }
            }
        });
    }
    
    // Escape key to close popup
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('notes-popup-overlay');
            if (overlay && overlay.style.display !== 'none') {
                closeNotesPopup();
            }
        }
    });
});

// Insert image into textarea with shortened URL
function insertImageIntoTextarea(textarea, base64, altText) {
    if (!textarea) return;
    
    const cursorPos = textarea.selectionStart;
    const textBefore = textarea.value.substring(0, cursorPos);
    const textAfter = textarea.value.substring(cursorPos);
    
    // Extract the base64 data part and shorten for display
    const base64Match = base64.match(/^(data:image\/[^;]+;base64,)(.+)$/);
    let imageMarkdown;
    if (base64Match) {
        const prefix = base64Match[1];
        const data = base64Match[2];
        const shortKey = data.substring(0, 20);
        imageDataMap[shortKey] = data;
        imageMarkdown = `\n![${altText}](${prefix}${shortKey}...)\n`;
    } else {
        imageMarkdown = `\n![${altText}](${base64})\n`;
    }
    
    textarea.value = textBefore + imageMarkdown + textAfter;
    textarea.selectionStart = textarea.selectionEnd = cursorPos + imageMarkdown.length;
    textarea.focus();
    
    // Mark as changed
    if (currentNotesStockIndex !== null) {
        markPortfolioChanged();
    }
}

// Simple markdown renderer with heading support
function renderMarkdown(text) {
    if (!text) return '<p style="color: #999;">No notes yet...</p>';
    
    // Process line by line for headings
    const lines = text.split('\n');
    const processedLines = lines.map(line => {
        // Escape HTML first
        let escaped = line
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        // Headings (must be at start of line)
        if (escaped.match(/^### /)) {
            return `<h4 style="margin:12px 0 8px 0; font-size:1.1em;">${escaped.substring(4)}</h4>`;
        }
        if (escaped.match(/^## /)) {
            return `<h3 style="margin:14px 0 10px 0; font-size:1.25em;">${escaped.substring(3)}</h3>`;
        }
        if (escaped.match(/^# /)) {
            return `<h2 style="margin:16px 0 12px 0; font-size:1.4em;">${escaped.substring(2)}</h2>`;
        }
        
        // Bullet points
        if (escaped.match(/^- /)) {
            return `<li style="margin-left:20px;">${escaped.substring(2)}</li>`;
        }
        if (escaped.match(/^\* /)) {
            return `<li style="margin-left:20px;">${escaped.substring(2)}</li>`;
        }
        
        // Numbered lists
        const numberedMatch = escaped.match(/^(\d+)\. /);
        if (numberedMatch) {
            return `<li style="margin-left:20px; list-style-type:decimal;">${escaped.substring(numberedMatch[0].length)}</li>`;
        }
        
        return escaped;
    });
    
    let html = processedLines.join('\n')
        // Images (must be before links) - support base64 images
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%; border-radius:4px; margin:8px 0;">')
        // Bold
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Italic (but not in URLs or already processed)
        .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code style="background:#f0f0f0; padding:2px 6px; border-radius:3px; font-family:monospace;">$1</code>')
        // Links
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#1976d2;">$1</a>')
        // Horizontal rule
        .replace(/^---$/gm, '<hr style="border:none; border-top:1px solid #ddd; margin:16px 0;">')
        // Line breaks (only for non-heading lines)
        .replace(/\n/g, '<br>');
    
    return html;
}
