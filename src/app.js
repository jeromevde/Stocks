// Stock Tracker - Clean & Fast with Lazy Loading
// Uses Yahoo Finance API directly (requires CORS extension)

const YF_BASE = 'https://query1.finance.yahoo.com';
const CACHE_TTL = 180_000; // 3 minutes

let stocks = [];
let priceCache = new Map();
let observer = null;
let githubToken = localStorage.getItem('github_token') || '';
let githubOwner = localStorage.getItem('github_owner') || 'jeromevde';
let githubRepo = localStorage.getItem('github_repo') || 'Stocks';

// ===== YAHOO FINANCE API =====

async function fetchYahoo(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function getCurrentPrice(ticker) {
    const cacheKey = `price:${ticker}`;
    const cached = priceCache.get(cacheKey);
    
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.price;
    }

    const url = `${YF_BASE}/v8/finance/chart/${ticker}?interval=1d&range=1d`;
    const data = await fetchYahoo(url);
    const meta = data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    
    if (price) {
        priceCache.set(cacheKey, { price, time: Date.now() });
    }
    
    return price || null;
}

async function getHistoricalPrice(ticker, date) {
    const targetTime = new Date(date).getTime() / 1000;
    const startTime = targetTime - (10 * 86400);
    const endTime = targetTime + (5 * 86400);
    
    const url = `${YF_BASE}/v8/finance/chart/${ticker}?period1=${Math.floor(startTime)}&period2=${Math.floor(endTime)}&interval=1d`;
    const data = await fetchYahoo(url);
    
    const result = data?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    
    let closestPrice = null;
    let closestDiff = Infinity;
    
    for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] == null) continue;
        const diff = Math.abs(timestamps[i] - targetTime);
        if (diff < closestDiff) {
            closestDiff = diff;
            closestPrice = closes[i];
        }
    }
    
    return closestPrice;
}

// ===== GITHUB INTEGRATION =====

function isGitHubConfigured() {
    return !!(githubToken && githubOwner && githubRepo);
}

function setupGitHub() {
    const token = prompt('Enter your GitHub token (ghp_...):', githubToken);
    if (!token) return false;
    
    const owner = prompt('Repository owner:', githubOwner) || githubOwner;
    const repo = prompt('Repository name:', githubRepo) || githubRepo;
    
    githubToken = token;
    githubOwner = owner;
    githubRepo = repo;
    
    localStorage.setItem('github_token', token);
    localStorage.setItem('github_owner', owner);
    localStorage.setItem('github_repo', repo);
    
    showStatus('GitHub configured!', 'success');
    return true;
}

async function saveToGitHub() {
    if (!isGitHubConfigured() && !setupGitHub()) {
        return;
    }
    
    showStatus('Uploading to GitHub...', 'info');
    
    try {
        // Generate HTML content
        const html = generatePortfolioHTML();
        
        // Get current file SHA if it exists
        let sha = null;
        try {
            const getUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/portfolio.html`;
            const getRes = await fetch(getUrl, {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            if (getRes.ok) {
                const data = await getRes.json();
                sha = data.sha;
            }
        } catch (e) {
            // File doesn't exist yet, that's ok
        }
        
        // Upload/update file
        const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/portfolio.html`;
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Update portfolio - ${stocks.length} stocks`,
                content: btoa(unescape(encodeURIComponent(html))),
                sha: sha
            })
        });
        
        if (!response.ok) {
            throw new Error(`GitHub API returned ${response.status}`);
        }
        
        showStatus('Saved to GitHub!', 'success');
    } catch (err) {
        console.error('GitHub save failed:', err);
        showStatus(`GitHub save failed: ${err.message}`, 'error');
    }
}

async function loadFromGitHub() {
    if (!isGitHubConfigured() && !setupGitHub()) {
        return;
    }
    
    showStatus('Loading from GitHub...', 'info');
    
    try {
        const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/portfolio.html`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!response.ok) {
            if (response.status === 404) {
                showStatus('No portfolio found on GitHub', 'error');
                return;
            }
            throw new Error(`GitHub API returned ${response.status}`);
        }
        
        const data = await response.json();
        const html = decodeURIComponent(escape(atob(data.content)));
        
        // Parse HTML to extract stocks
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const rows = doc.querySelectorAll('table tbody tr');
        
        stocks = [];
        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 3) {
                stocks.push({
                    ticker: cells[0].textContent.trim(),
                    date: cells[1].textContent.trim(),
                    discoveryPrice: parseFloat(cells[2].textContent.replace('$', ''))
                });
            }
        });
        
        renderTable();
        saveToLocalStorage(); // Also save locally
        showStatus(`Loaded ${stocks.length} stocks from GitHub`, 'success');
    } catch (err) {
        console.error('GitHub load failed:', err);
        showStatus(`GitHub load failed: ${err.message}`, 'error');
    }
}

function generatePortfolioHTML() {
    const timestamp = new Date().toISOString();
    const rows = stocks.map(s => {
        return `      <tr>
        <td>${s.ticker}</td>
        <td>${s.date}</td>
        <td>$${s.discoveryPrice?.toFixed(2) || 'N/A'}</td>
      </tr>`;
    }).join('\n');
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Stock Portfolio</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 2em; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background: #f4f4f4; font-weight: bold; }
        tr:hover { background: #f9f9f9; }
    </style>
</head>
<body>
    <h1>📈 Stock Portfolio</h1>
    <p><em>Last updated: ${timestamp}</em></p>
    <p><strong>${stocks.length} stocks</strong></p>
    
    <table>
        <thead>
            <tr>
                <th>Ticker</th>
                <th>Discovery Date</th>
                <th>Discovery Price</th>
            </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
    </table>
    
    <p><small>Generated by Stock Tracker</small></p>
</body>
</html>`;
}

// ===== LAZY LOADING =====

function createIntersectionObserver() {
    if (observer) observer.disconnect();
    
    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const row = entry.target;
                const ticker = row.dataset.ticker;
                loadRowData(ticker, row);
                observer.unobserve(row);
            }
        });
    }, {
        root: null,
        rootMargin: '100px',
        threshold: 0
    });
}

async function loadRowData(ticker, row) {
    const stock = stocks.find(s => s.ticker === ticker);
    if (!stock) return;
    
    const currentPriceCell = row.querySelector('.current-price');
    const returnCell = row.querySelector('.return');
    
    try {
        currentPriceCell.textContent = 'Loading...';
        currentPriceCell.className = 'current-price loading';
        
        const currentPrice = await getCurrentPrice(ticker);
        
        if (currentPrice) {
            currentPriceCell.textContent = `$${currentPrice.toFixed(2)}`;
            currentPriceCell.className = 'current-price';
            
            if (stock.discoveryPrice) {
                const returnPct = ((currentPrice - stock.discoveryPrice) / stock.discoveryPrice) * 100;
                returnCell.textContent = `${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}%`;
                returnCell.className = `return ${returnPct >= 0 ? 'positive' : 'negative'}`;
            } else {
                returnCell.textContent = 'N/A';
                returnCell.className = 'return';
            }
        } else {
            currentPriceCell.textContent = 'Error';
            currentPriceCell.className = 'current-price';
        }
    } catch (err) {
        console.error(`Failed to load ${ticker}:`, err);
        currentPriceCell.textContent = 'Error';
        currentPriceCell.className = 'current-price';
    }
}

// ===== LOCAL STORAGE =====

function saveToLocalStorage() {
    localStorage.setItem('stocks', JSON.stringify(stocks));
}

function loadFromLocalStorage() {
    const saved = localStorage.getItem('stocks');
    if (saved) {
        stocks = JSON.parse(saved);
        renderTable();
        showStatus(`Loaded ${stocks.length} stocks`, 'success');
    } else {
        showStatus('No saved data found', 'error');
    }
}

// ===== UI =====

function renderTable() {
    const tbody = document.getElementById('stock-tbody');
    tbody.innerHTML = '';
    
    if (stocks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;padding:24px;">No stocks added yet</td></tr>';
        return;
    }
    
    createIntersectionObserver();
    
    stocks.forEach(stock => {
        const row = document.createElement('tr');
        row.dataset.ticker = stock.ticker;
        
        row.innerHTML = `
            <td><strong>${stock.ticker}</strong></td>
            <td>${stock.date}</td>
            <td>${stock.discoveryPrice ? `$${stock.discoveryPrice.toFixed(2)}` : 'Loading...'}</td>
            <td class="current-price loading">Pending...</td>
            <td class="return">—</td>
            <td><button class="delete-btn" onclick="deleteStock('${stock.ticker}')">🗑️</button></td>
        `;
        
        tbody.appendChild(row);
        observer.observe(row);
    });
}

async function addStock() {
    const tickerInput = document.getElementById('ticker-input');
    const dateInput = document.getElementById('date-input');
    
    const ticker = tickerInput.value.trim().toUpperCase();
    const date = dateInput.value;
    
    if (!ticker) {
        showStatus('Enter a ticker symbol', 'error');
        return;
    }
    
    if (!date) {
        showStatus('Select a discovery date', 'error');
        return;
    }
    
    if (stocks.some(s => s.ticker === ticker)) {
        showStatus(`${ticker} already exists`, 'error');
        return;
    }
    
    showStatus(`Adding ${ticker}...`, 'info');
    
    try {
        const discoveryPrice = await getHistoricalPrice(ticker, date);
        
        const stock = { ticker, date, discoveryPrice };
        
        stocks.push(stock);
        stocks.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        renderTable();
        saveToLocalStorage();
        
        tickerInput.value = '';
        dateInput.value = '';
        
        showStatus(`Added ${ticker}!`, 'success');
    } catch (err) {
        console.error('Failed to add stock:', err);
        showStatus(`Failed to add ${ticker}: ${err.message}`, 'error');
    }
}

function deleteStock(ticker) {
    if (!confirm(`Delete ${ticker}?`)) return;
    
    stocks = stocks.filter(s => s.ticker !== ticker);
    renderTable();
    saveToLocalStorage();
    showStatus(`Deleted ${ticker}`, 'success');
}

function showStatus(message, type = 'info') {
    let status = document.querySelector('.status');
    if (!status) {
        status = document.createElement('div');
        status.className = 'status';
        document.body.appendChild(status);
    }
    
    status.textContent = message;
    status.className = `status ${type} show`;
    
    setTimeout(() => {
        status.classList.remove('show');
    }, 3000);
}

// ===== EVENT LISTENERS =====

document.getElementById('add-btn').addEventListener('click', addStock);
document.getElementById('save-btn').addEventListener('click', () => {
    saveToLocalStorage();
    saveToGitHub();
});
document.getElementById('load-btn').addEventListener('click', loadFromGitHub);

document.getElementById('ticker-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addStock();
});

document.getElementById('date-input').valueAsDate = new Date();

// Auto-load on startup
const saved = localStorage.getItem('stocks');
if (saved) {
    stocks = JSON.parse(saved);
    renderTable();
}
