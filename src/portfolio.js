/**
 * Portfolio data management
 */
const REQUEST_DELAY_MS = 0;

let portfolio = [];
let hasUnsavedChanges = false;
let sortMode = 'rating'; // rating | cumulative | return3m
let ratingDirection = -1;     // -1 desc, 1 asc
let cumulativeDirection = -1; // -1 desc, 1 asc
let return3mDirection = -1;   // -1 desc, 1 asc
let labelFilterSet = new Set();
let showZeroStarStocks = true;
let labelOrder = [];

function markChanged() {
    hasUnsavedChanges = true;
    updateSaveButtonState();
    if (!document.title.startsWith('*')) document.title = '* Stock Tracker';
}

function markSaved() {
    hasUnsavedChanges = false;
    updateSaveButtonState();
    document.title = 'Stock Tracker';
}

const PORTFOLIO_DATA_VERSION = 1;

function getExistingLabels() {
    return Array.from(new Set(portfolio.flatMap(s => s.labels).filter(Boolean)));
}

function getOrderedLabels() {
    const existing = getExistingLabels();
    const merged = [...labelOrder, ...existing];
    return Array.from(new Set(merged.map(l => (l || '').trim()).filter(Boolean)));
}

function addGlobalLabel(label) {
    const clean = (label || '').trim();
    if (!clean) return false;
    // Preserve current visible order, then append new labels at the end.
    labelOrder = getOrderedLabels();
    if (!labelOrder.includes(clean)) labelOrder.push(clean);
    markChanged();
    return true;
}

function moveLabel(label, targetIndex) {
    const ordered = getOrderedLabels();
    const from = ordered.indexOf(label);
    if (from === -1) return;
    const to = Math.max(0, Math.min(targetIndex, ordered.length - 1));
    if (from === to) return;
    ordered.splice(from, 1);
    ordered.splice(to, 0, label);
    labelOrder = ordered;
    markChanged();
}

function normalizeLabels(labels) {
    if (!Array.isArray(labels)) return [];
    return Array.from(new Set(labels.map(l => String(l || '').trim()).filter(Boolean)));
}

function toStorageStock(stock) {
    const ratingNumber = parseInt(stock?.rating, 10);
    const rating = Number.isFinite(ratingNumber) ? Math.max(0, Math.min(5, ratingNumber)) : 0;
    return {
        ticker: String(stock?.ticker || '').trim().toUpperCase(),
        name: String(stock?.name || '').trim(),
        date: String(stock?.date || '').trim(),
        labels: normalizeLabels(stock?.labels),
        notes: String(stock?.notes || ''),
        rating
    };
}

function toRuntimeStock(rawStock) {
    const normalized = toStorageStock(rawStock);
    if (!normalized.ticker) return null;
    return {
        ...normalized,
        nowPrice: 'Loading...',
        cumulativeReturn: 'Calculating...',
        return3m: 'Loading...',
        marketCap: null
    };
}

function generatePortfolioDataJson() {
    const payload = {
        version: PORTFOLIO_DATA_VERSION,
        updatedAt: new Date().toISOString(),
        labelOrder: getOrderedLabels(),
        stocks: portfolio.map(toStorageStock).filter(s => s.ticker)
    };
    return JSON.stringify(payload, null, 2);
}

function parsePortfolioDataJson(content) {
    let parsed;
    try {
        parsed = JSON.parse(content);
    } catch {
        throw new Error('Invalid portfolio-data.json: not valid JSON');
    }

    const rawStocks = Array.isArray(parsed) ? parsed : parsed?.stocks;
    if (!Array.isArray(rawStocks)) {
        throw new Error('Invalid portfolio-data.json: missing stocks array');
    }

    const parsedOrder = Array.isArray(parsed?.labelOrder)
        ? parsed.labelOrder.map(v => String(v || '').trim()).filter(Boolean)
        : [];
    labelOrder = Array.from(new Set(parsedOrder));

    return rawStocks.map(toRuntimeStock).filter(Boolean);
}

/** Save portfolio to GitHub */
async function save() {
    if (!window.githubClient?.isAuthenticated()) {
        document.getElementById('github-auth-modal').style.display = 'flex';
        showStatus('Please authenticate with GitHub first', 'error');
        return;
    }
    showStatus('Saving...', 'info');
    try {
        await window.githubClient.savePortfolioData(
            generatePortfolioDataJson(),
            `Update portfolio data - ${portfolio.length} stocks`
        );
        markSaved();
        showStatus(`Saved ${portfolio.length} stocks to GitHub`, 'success');
    } catch (e) {
        showStatus(`Save failed: ${e.message}`, 'error');
    }
}

/** Load portfolio from GitHub */
async function load() {
    try {
        showStatus('Loading from GitHub...', 'info');
        const result = await window.githubClient.loadPortfolioData();
        if (!result.exists) {
            labelOrder = [];
            showStatus('No portfolio found. Add some stocks!', 'info');
            markSaved();
            return;
        }

        const loadedStocks = parsePortfolioDataJson(result.content);
        if (!loadedStocks.length) {
            labelOrder = [];
            showStatus('No portfolio found. Add some stocks!', 'info');
            markSaved();
            return;
        }

        portfolio.length = 0;
        portfolio.push(...loadedStocks);
        // Always reset to default (star sorting) after reload
        sortMode = 'rating';
        ratingDirection = -1;
        markSaved();
        updatePortfolioTable();
        showStatus(`Loaded ${portfolio.length} stocks.`, 'success');
        // Prices load lazily via Intersection Observer
    } catch (e) {
        showStatus(`Load failed: ${e.message}`, 'error');
    }
}

/** Refresh: clear cache and reload */
async function refresh() {
    window.githubClient?.clearCache();
    window.MarketData?.clearCache();
    await load();
}

const delay = ms => new Promise(r => setTimeout(r, ms));

/** Update prices lazily — each row updates the instant its Yahoo request resolves */
async function updateAllPrices() {
    const api = window.MarketData;
    if (!api || !portfolio.length) return;

    let done = 0;
    showStatus(`Fetching prices… 0 / ${portfolio.length}`, 'info');

    // Kick off all historical price requests in parallel
    const histPromises = portfolio.map(s =>
        api.fetchHistoricalPrice(s.ticker, s.date).catch(() => null)
    );

    // Kick off all price+return requests; onEach fires as each resolves
    await api.fetchBatchPriceAndReturn(
        portfolio.map(s => s.ticker.toUpperCase()),
        async (ticker, { price, ret3m, marketCap }) => {
            const idx = portfolio.findIndex(s => s.ticker.toUpperCase() === ticker);
            if (idx === -1) return;
            const stock = portfolio[idx];
            const hist  = await histPromises[idx];

            stock.nowPrice         = price != null ? Number(price).toFixed(2) : 'N/A';
            stock.return3m         = ret3m != null ? ret3m : 'N/A';
            stock.marketCap        = marketCap ?? stock.marketCap ?? null;
            stock.cumulativeReturn = (price != null && hist != null)
                ? (((price - hist) / hist) * 100).toFixed(2) : 'N/A';

            if (window.updatePriceCells) window.updatePriceCells(stock);
            done++;
            if (done === portfolio.length)
                showStatus(`${portfolio.length} stocks updated!`, 'success');
            else
                showStatus(`Fetching prices… ${done} / ${portfolio.length}`, 'info');
        }
    );
}

/** Add a new stock (called after user confirms in modal) */
async function addStock(ticker, name, date, initialLabel = '') {
    const api = window.MarketData;
    if (!api) return;
    const t = ticker.toUpperCase();
    if (portfolio.some(s => s.ticker === t)) { showStatus(`${t} is already in your portfolio`, 'error'); return; }

    const discoveryDate = date || new Date().toISOString().slice(0, 10);
    const normalizedInitialLabel = (initialLabel || '').trim();
    const stock = {
        ticker: t, name: name || t, date: discoveryDate,
        labels: normalizedInitialLabel ? [normalizedInitialLabel] : [], notes: '', rating: 0,
        nowPrice: '...', cumulativeReturn: '...', return3m: '...', marketCap: null, loading: true
    };
    portfolio.push(stock);
    markChanged();
    updatePortfolioTable();
    showStatus(`Adding ${t}\u2026`, 'info');

    try {
        const [{ price, ret3m, marketCap }, hist] = await Promise.all([
            api.fetchPriceAndReturn(t),
            api.fetchHistoricalPrice(t, discoveryDate)
        ]);
        stock.nowPrice = price != null ? price.toFixed(2) : 'N/A';
        stock.return3m = ret3m || 'N/A';
        stock.marketCap = marketCap ?? stock.marketCap ?? null;
        stock.cumulativeReturn = (price != null && hist != null)
            ? (((price - hist) / hist) * 100).toFixed(2) : 'N/A';
    } catch (err) {
        stock.nowPrice = 'N/A';
        stock.cumulativeReturn = 'N/A';
        stock.return3m = 'N/A';
        showStatus((err && err.message) ? err.message : 'Price lookup failed', 'error');
    }
    stock.loading = false;
    if (window.updatePriceCells) window.updatePriceCells(stock);
    showStatus(`${t} added!`, 'success');
}

function removeStock(idx) {
    if (!portfolio[idx]) return;
    if (confirm(`Remove ${portfolio[idx].ticker}?`)) {
        portfolio.splice(idx, 1);
        markChanged();
        updatePortfolioTable();
    }
}

function updateRating(idx, r) {
    if (!portfolio[idx]) return;
    portfolio[idx].rating = portfolio[idx].rating === r ? 0 : r;
    markChanged();
    updatePortfolioTable();
}

async function updateDate(idx, date) {
    if (!portfolio[idx]) return;
    portfolio[idx].date = date;
    markChanged();
    const api = window.MarketData;
    try {
        const [{ price, marketCap }, hist] = await Promise.all([
            api.fetchPriceAndReturn(portfolio[idx].ticker),
            api.fetchHistoricalPrice(portfolio[idx].ticker, date)
        ]);
        portfolio[idx].nowPrice = price ? price.toFixed(2) : 'N/A';
        portfolio[idx].marketCap = marketCap ?? portfolio[idx].marketCap ?? null;
        portfolio[idx].cumulativeReturn = (hist && price) ? (((price - hist) / hist) * 100).toFixed(2) : 'N/A';
        if (window.updatePriceCells) window.updatePriceCells(portfolio[idx]);
    } catch {}
}

function addLabel(idx, label) {
    if (!portfolio[idx]) return;
    const clean = (label || '').trim();
    if (!clean) return;
    const existing = getOrderedLabels();
    if (!existing.includes(clean)) return;
    if (!portfolio[idx].labels.includes(clean)) {
        portfolio[idx].labels.push(clean);
        markChanged(); updatePortfolioTable();
    }
}

function removeLabel(idx, label) {
    if (portfolio[idx]) {
        portfolio[idx].labels = portfolio[idx].labels.filter(l => l !== label);
        markChanged(); updatePortfolioTable();
    }
}

function updateNotes(idx, notes) {
    if (portfolio[idx]) { portfolio[idx].notes = notes; markChanged(); }
}

function metricValue(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : -Infinity;
}

function cmpByDirection(aVal, bVal, direction) {
    return direction * (aVal - bVal);
}

function setSortMode(mode) {
    if (['rating', 'cumulative', 'return3m'].includes(mode)) sortMode = mode;
}

function invertSort(mode = sortMode) {
    if (mode === 'rating') ratingDirection *= -1;
    if (mode === 'cumulative') cumulativeDirection *= -1;
    if (mode === 'return3m') return3mDirection *= -1;
}

function getSortedFiltered() {
    let sorted = [...portfolio].sort((a, b) => {
        if (sortMode === 'cumulative') {
            const m = cmpByDirection(metricValue(a.cumulativeReturn), metricValue(b.cumulativeReturn), cumulativeDirection);
            if (m !== 0) return m;
            return cmpByDirection((a.rating || 0), (b.rating || 0), ratingDirection);
        }
        if (sortMode === 'return3m') {
            const m = cmpByDirection(metricValue(a.return3m), metricValue(b.return3m), return3mDirection);
            if (m !== 0) return m;
            return cmpByDirection((a.rating || 0), (b.rating || 0), ratingDirection);
        }
        return cmpByDirection((a.rating || 0), (b.rating || 0), ratingDirection);
    });
    if (labelFilterSet.size > 0) sorted = sorted.filter(s => s.labels.some(l => labelFilterSet.has(l)));
    return sorted;
}

window.Portfolio = {
    get data() { return portfolio; },
    getOrderedLabels, addGlobalLabel, moveLabel,
    get hasUnsavedChanges() { return hasUnsavedChanges; },
    get sortMode() { return sortMode; },
    get sortByCumulativeReturn() { return sortMode === 'cumulative'; },
    set sortByCumulativeReturn(v) { if (v) sortMode = 'cumulative'; else if (sortMode === 'cumulative') sortMode = 'rating'; },
    get sortBy3MonthReturn() { return sortMode === 'return3m'; },
    set sortBy3MonthReturn(v) { if (v) sortMode = 'return3m'; else if (sortMode === 'return3m') sortMode = 'rating'; },
    get labelFilterSet() { return labelFilterSet; },
    get showZeroStarStocks() { return showZeroStarStocks; },
    set showZeroStarStocks(v) { showZeroStarStocks = v; },
    save, load, refresh, add: addStock, remove: removeStock,
    updateRating, updateDate, addLabel, removeLabel, updateNotes,
    getSortedFiltered, setSortMode, invertSort, markChanged, markSaved, generatePortfolioDataJson
};
