/**
 * UI rendering and interactions
 */
let tableUpdateTimeout = null;
let currentNotesStockIndex = null;
const NOTES_PREVIEW_MAX_CHARS = 100;
const LABEL_TAB_COOKIE = 'labelTab';

function setLabelTabCookie(value) {
    document.cookie = `${LABEL_TAB_COOKIE}=${encodeURIComponent(value || '')}; path=/; max-age=2592000`;
}

function getLabelTabCookie() {
    const m = document.cookie.match(new RegExp(`(?:^|; )${LABEL_TAB_COOKIE}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : null;
}

function debouncedUpdateTable() {
    clearTimeout(tableUpdateTimeout);
    tableUpdateTimeout = setTimeout(updatePortfolioTable, 100);
}

function showStatus(msg, type = 'info') {
    const el = document.getElementById('save-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `status-message ${type} show`;
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('show'), type === 'error' ? 6000 : 4000);
}

function updateSaveButtonState() {
    const btn = document.getElementById('save-portfolio');
    if (!btn) return;
    const changed = window.Portfolio?.hasUnsavedChanges;
    btn.disabled = !changed;
    btn.textContent = changed ? '💾 Save to GitHub' : '💾 Saved';
    btn.style.opacity = changed ? '1' : '0.5';
}

function updateGitHubUI() {
    if (typeof updateApiKeyTiles === 'function') updateApiKeyTiles();
}

function formatDate(dateStr) {
    if (!dateStr) return { formatted: '', timeAgo: '' };
    const d = new Date(dateStr);
    const days = Math.floor((Date.now() - d) / 86400000);
    const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    let timeAgo = days === 0 ? 'Today' : days === 1 ? '1 day ago' : days < 30 ? `${days}d ago` : days < 365 ? `${Math.floor(days / 30)}mo ago` : `${Math.floor(days / 365)}y ago`;
    return { formatted, timeAgo };
}

function colorReturn(val) {
    if (!val || val === 'N/A' || val === 'Error' || val === '...') return `<span style="color:#666;display:inline-block;min-width:50px">${val}</span>`;
    const n = parseFloat(val);
    return `<span style="color:${n >= 0 ? '#4caf50' : '#f44336'};display:inline-block;min-width:50px">${val}%</span>`;
}

function getNotesPreview(notes) {
    if (!notes) return '';
    // Normalize whitespace but preserve single spaces and newlines
    const text = notes.replace(/\s+/g, ' ').trim();
    if (!text) return '';
    // Limit to NOTES_PREVIEW_MAX_CHARS characters
    if (text.length <= NOTES_PREVIEW_MAX_CHARS) return text;
    return text.slice(0, NOTES_PREVIEW_MAX_CHARS) + '…';
}

function animateLabelReflow(container, mutateDom) {
    const tabs = [...container.querySelectorAll('.label-tab-draggable')];
    const first = new Map(tabs.map(el => [el.dataset.label, el.getBoundingClientRect()]));
    mutateDom();
    const secondTabs = [...container.querySelectorAll('.label-tab-draggable')];
    secondTabs.forEach(el => {
        const prev = first.get(el.dataset.label);
        if (!prev) return;
        const next = el.getBoundingClientRect();
        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        if (!dx && !dy) return;
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
            el.style.transition = 'transform 180ms ease';
            el.style.transform = '';
        });
    });
}

function updateLabelTabs() {
    const container = document.getElementById('label-tabs');
    if (!container || !window.Portfolio) return;
    const labels = window.Portfolio.getOrderedLabels ? window.Portfolio.getOrderedLabels() : [];
    const filterSet = window.Portfolio.labelFilterSet || new Set();
    const savedTab = getLabelTabCookie();
    if (filterSet.size === 0 && savedTab) {
        if (savedTab !== 'All' && labels.includes(savedTab)) filterSet.add(savedTab);
    }
    let active = 'All';
    if (filterSet.size === 1) active = [...filterSet][0];
    else if (filterSet.size > 1) active = null;
    container.innerHTML = '';

    const makeTab = (label) => {
        const btn = document.createElement('button');
        const isActive = active === label;
        btn.className = `label-tab${isActive ? ' active' : ''}`;
        btn.textContent = label;
        btn.addEventListener('click', e => {
            e.preventDefault();
            filterSet.clear();
            if (label !== 'All') filterSet.add(label);
            setLabelTabCookie(label);
            updatePortfolioTable();
        });
        return btn;
    };

    container.appendChild(makeTab('All'));

    let draggedLabel = null;
    let draggedEl = null;

    labels.forEach((l) => {
        const tab = makeTab(l);
        tab.draggable = true;
        tab.dataset.label = l;
        tab.classList.add('label-tab-draggable');
        tab.addEventListener('dragstart', e => {
            draggedLabel = l;
            draggedEl = tab;
            e.dataTransfer.setData('text/plain', l);
            e.dataTransfer.effectAllowed = 'move';
            tab.classList.add('dragging');
            container.classList.add('drag-active');
        });
        tab.addEventListener('dragend', () => {
            const finalTabs = [...container.querySelectorAll('.label-tab-draggable')];
            finalTabs.forEach((el, idx) => window.Portfolio.moveLabel?.(el.dataset.label, idx));
            draggedLabel = null;
            draggedEl = null;
            tab.classList.remove('dragging');
            container.classList.remove('drag-active');
            container.querySelectorAll('.label-tab').forEach(el => el.classList.remove('drop-target-left', 'drop-target-right'));
            updatePortfolioTable();
        });
        tab.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!draggedLabel || draggedLabel === l || !draggedEl) return;
            const rect = tab.getBoundingClientRect();
            const before = (e.clientX - rect.left) < rect.width / 2;
            tab.classList.toggle('drop-target-left', before);
            tab.classList.toggle('drop-target-right', !before);

            animateLabelReflow(container, () => {
                if (before) container.insertBefore(draggedEl, tab);
                else container.insertBefore(draggedEl, tab.nextSibling);
            });
        });
        tab.addEventListener('dragleave', () => {
            tab.classList.remove('drop-target-left', 'drop-target-right');
        });
        tab.addEventListener('drop', e => {
            e.preventDefault();
            tab.classList.remove('drop-target-left', 'drop-target-right');
        });
        container.appendChild(tab);
    });

    const createWrap = document.createElement('div');
    createWrap.className = 'label-create-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'New label';
    input.className = 'label-create-input';

    const addBtn = document.createElement('button');
    addBtn.className = 'label-create-btn';
    addBtn.type = 'button';
    addBtn.textContent = '+';
    addBtn.title = 'Add label';
    addBtn.addEventListener('click', () => {
        const name = (input.value || '').trim();
        if (!name) return;
        window.Portfolio.addGlobalLabel?.(name);
        input.value = '';
        updatePortfolioTable();
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addBtn.click();
        }
    });

    createWrap.appendChild(input);
    createWrap.appendChild(addBtn);
    container.appendChild(createWrap);

    container.style.display = 'flex';
}

/** Main table render */
function updatePortfolioTable() {
    const tbody = document.getElementById('portfolio-tbody');
    if (!tbody || !window.Portfolio) return;
    updateLabelTabs();
    tbody.innerHTML = '';
    const sorted = window.Portfolio.getSortedFiltered();
    const rated = sorted.filter(s => (s.rating || 0) > 0);
    const unrated = sorted.filter(s => (s.rating || 0) === 0);

    rated.forEach(s => renderRow(tbody, s));

    if (unrated.length > 0) {
        const tr = document.createElement('tr');
        const show = window.Portfolio.showZeroStarStocks;
        tr.innerHTML = `<td colspan="9" style="text-align:center;background:#f5f5f5;cursor:pointer;padding:10px;border-top:2px solid #ddd;color:#666;font-size:14px;">${show ? '▼' : '▶'} ${unrated.length} unrated stock${unrated.length > 1 ? 's' : ''}</td>`;
        tr.addEventListener('click', () => { window.Portfolio.showZeroStarStocks = !show; updatePortfolioTable(); });
        tbody.appendChild(tr);
        if (show) unrated.forEach(s => renderRow(tbody, s));
    }
}

function renderRow(tbody, stock) {
    const data = window.Portfolio.data;
    const idx = data.indexOf(stock);
    const r = stock.rating || 0;
    const d = formatDate(stock.date);
    const tr = document.createElement('tr');
    tr.dataset.ticker = stock.ticker;
    tr.dataset.priceLoaded = stock.nowPrice !== 'Loading...' && stock.nowPrice !== 'N/A' ? 'true' : 'false';

    const stars = [1,2,3,4,5].map(i => `<span class="rating-star" data-r="${i}" style="cursor:pointer;font-size:1.1em;color:${i <= r ? '#f5b301' : '#ddd'}">${i <= r ? '★' : '☆'}</span>`).join('');
    const labels = stock.labels.map(l => `<span style="background:#e3f2fd;color:#1976d2;padding:2px 6px;margin:1px;border-radius:3px;font-size:11px;display:inline-block">${l}<span class="rm-label" data-l="${l}" style="margin-left:4px;cursor:pointer;font-weight:bold">×</span></span>`).join('');
    const orderedLabels = window.Portfolio.getOrderedLabels ? window.Portfolio.getOrderedLabels() : [];
    const availableLabels = orderedLabels.filter(l => !stock.labels.includes(l));
    const addLabelDropdown = availableLabels.length
        ? `<select class="add-label-select" style="margin-left:4px;padding:2px 4px;font-size:11px;border:1px solid #ddd;border-radius:4px;background:#fff;color:#555;max-width:120px;"><option value="">+ label</option>${availableLabels.map(l => `<option value="${l}">${l}</option>`).join('')}</select>`
        : '';
    const notesShort = getNotesPreview(stock.notes);
    const priceDisplay = stock.loading ? '...' : (stock.nowPrice !== 'N/A' && stock.nowPrice !== 'Loading...' ? '$' + stock.nowPrice : stock.nowPrice);

    tr.innerHTML = `
        <td style="text-align:center">${stars}</td>
        <td style="text-align:center"><div class="ticker-cell" style="cursor:pointer" data-t="${stock.ticker}"><b style="color:#0066cc">${stock.ticker}</b><div style="font-size:11px;color:#888">${stock.name || ''}</div></div></td>
        <td style="text-align:center"><div class="date-disp" style="cursor:pointer"><div style="font-size:12px">${d.formatted}</div><div style="font-size:10px;color:#999">${d.timeAgo}</div></div><input type="date" value="${stock.date}" class="edit-date" style="display:none;width:130px;padding:4px;font-size:12px;border:1px solid #ddd;border-radius:4px"></td>
        <td style="text-align:center"><div class="labels-box" style="min-width:80px;padding:4px">${labels}${addLabelDropdown}</div></td>
        <td style="text-align:center"><span class="notes-btn" style="cursor:pointer;padding:8px;background:#f9f9f9;color:#666;border-radius:3px;display:inline-block;min-width:80px">${notesShort}</span></td>
        <td class="price-cell" style="text-align:right;font-variant-numeric:tabular-nums;min-width:80px">${priceDisplay}</td>
        <td class="return3m-cell" style="text-align:right;font-variant-numeric:tabular-nums;min-width:60px">${colorReturn(stock.return3m)}</td>
        <td class="cumret-cell" style="text-align:right;font-variant-numeric:tabular-nums;min-width:60px">${colorReturn(stock.cumulativeReturn)}</td>
        <td style="text-align:center;width:30px"><button class="rm-stock" style="background:none;color:#ccc;border:none;cursor:pointer;font-size:16px">×</button></td>`;

    // Event listeners
    tr.querySelectorAll('.rating-star').forEach(s => s.addEventListener('click', e => { e.stopPropagation(); window.Portfolio.updateRating(idx, parseInt(s.dataset.r)); }));
    tr.querySelector('.rm-stock').addEventListener('click', () => window.Portfolio.remove(idx));
    tr.querySelector('.ticker-cell').addEventListener('click', () => openChart(stock.ticker, stock.name));
    tr.querySelector('.notes-btn').addEventListener('click', () => openNotesPopup(idx));

    const dateDisp = tr.querySelector('.date-disp');
    const dateInput = tr.querySelector('.edit-date');
    dateDisp.addEventListener('click', () => { dateDisp.style.display = 'none'; dateInput.style.display = 'block'; dateInput.focus(); });
    dateInput.addEventListener('change', e => window.Portfolio.updateDate(idx, e.target.value));
    dateInput.addEventListener('blur', () => { dateDisp.style.display = 'block'; dateInput.style.display = 'none'; });

    const addLabelSelect = tr.querySelector('.add-label-select');
    if (addLabelSelect) {
        addLabelSelect.addEventListener('click', e => e.stopPropagation());
        addLabelSelect.addEventListener('change', e => {
            const picked = (e.target.value || '').trim();
            if (!picked) return;
            window.Portfolio.addLabel(idx, picked);
        });
    }
    tr.querySelectorAll('.rm-label').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); window.Portfolio.removeLabel(idx, b.dataset.l); }));

    tbody.appendChild(tr);
}

/** TradingView chart popup */
function openChart(ticker, name) {
    const popup = document.getElementById('tradingview-popup');
    const container = document.getElementById('tradingview-container');
    if (!popup || !container) { window.open(`https://finance.yahoo.com/quote/${ticker}`, '_blank'); return; }

    const tvSymbol = convertToTradingViewSymbol(ticker);
    document.getElementById('tradingview-title').textContent = `${ticker} - ${name || ''}`;
    container.innerHTML = '';
    popup.style.display = 'flex';

    if (typeof TradingView !== 'undefined') {
        new TradingView.widget({
            autosize: true,
            symbol: tvSymbol,
            interval: 'W',
            timezone: 'Etc/UTC',
            theme: 'light',
            style: '2',
            locale: 'en',
            enable_publishing: false,
            allow_symbol_change: true,
            container_id: 'tradingview-container',
            hide_top_toolbar: false,
            hide_side_toolbar: true,
            hide_legend: false,
            range: '12M',
            show_popup_button: false,
            studies: [],
            withdateranges: true,
            disabled_features: ['header_compare', 'header_undo_redo', 'header_screenshot', 'header_fullscreen_button', 'left_toolbar', 'header_resolutions', 'header_interval_dialog_button']
        });
    } else {
        container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#666"><a href="https://www.tradingview.com/chart/?symbol=${tvSymbol}" target="_blank">Open in TradingView →</a></div>`;
    }
}

function closeChart() {
    const p = document.getElementById('tradingview-popup');
    const c = document.getElementById('tradingview-container');
    if (p) p.style.display = 'none';
    if (c) c.innerHTML = '';
}

function convertToTradingViewSymbol(ticker) {
    const exchangeMap = {
        '.MC': 'BME:', '.HK': 'HKEX:', '.L': 'LSE:', '.PA': 'EURONEXT:', '.AS': 'EURONEXT:', '.BR': 'EURONEXT:', '.DE': 'XETR:', '.F': 'FWB:', '.SW': 'SIX:', '.TO': 'TSX:', '.AX': 'ASX:'
    };
    for (const [suffix, prefix] of Object.entries(exchangeMap)) {
        if (ticker.endsWith(suffix)) return prefix + ticker.slice(0, -suffix.length);
    }
    return ticker;
}

function parseMedia(text) {
    if (!text) return '';
    // Work on plain text - split lines, process each
    const lines = text.split('\n');
    return lines.map(line => {
        const trimmed = line.trim();
        // YouTube - full URL
        const ytMatch = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
        if (ytMatch) {
            return `<a href="https://www.youtube.com/watch?v=${ytMatch[1]}" target="_blank" style="display:block;position:relative;margin:8px 0;border-radius:8px;overflow:hidden;text-decoration:none;">
                <img src="https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg" style="width:100%;display:block;border-radius:8px;" />
                <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:64px;height:64px;background:rgba(0,0,0,0.7);border-radius:50%;display:flex;align-items:center;justify-content:center;">
                    <div style="width:0;height:0;border-top:14px solid transparent;border-bottom:14px solid transparent;border-left:24px solid white;margin-left:4px;"></div>
                </div>
            </a>`;
        }
        // Image URL
        const imgMatch = trimmed.match(/^(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|bmp|webp|heic|heif|tiff|svg))(?:\?[^\s]*)?$/i);
        if (imgMatch) {
            return `<img src="${imgMatch[1]}" style="max-width:100%; height:auto; border-radius:8px; margin:8px 0;" loading="lazy" />`;
        }
        return line;
    }).join('\n');
}

function serializeNotes(editorEl) {
    // Get the plain text, converting <img> and <iframe> back to URLs
    const clone = editorEl.cloneNode(true);
    clone.querySelectorAll('a').forEach(a => {
        const href = a.href || '';
        const m = href.match(/youtube\.com\/watch\?v=([\w-]{11})/);
        if (m) {
            a.replaceWith(`https://www.youtube.com/watch?v=${m[1]}\n`);
        }
    });
    clone.querySelectorAll('img').forEach(img => {
        img.replaceWith(img.src + '\n');
    });
    let html = clone.innerHTML;
    // Preserve line breaks - convert divs and brs to newlines
    html = html.replace(/<div><br><\/div>/gi, '\n');
    html = html.replace(/<div>/gi, '\n').replace(/<\/div>/gi, '');
    html = html.replace(/<br\s*\/?>/gi, '\n');
    // Keep spaces but decode HTML entities properly
    html = html.replace(/&nbsp;/g, ' ');
    // Don't strip leading newlines - preserve formatting
    const decoder = document.createElement('textarea');
    decoder.innerHTML = html;
    return decoder.value;
}

/** Notes popup */
function openNotesPopup(idx) {
    currentNotesStockIndex = idx;
    const stock = window.Portfolio.data[idx];
    const overlay = document.getElementById('notes-popup-overlay');
    document.getElementById('notes-popup-stock').textContent = stock.ticker;
    const editor = document.getElementById('notes-editor');
    editor.innerHTML = parseMedia(stock.notes || '');
    overlay.style.display = 'flex';
    setTimeout(() => { overlay.classList.add('show'); editor.focus(); }, 10);
}

function closeNotesPopup() {
    const editor = document.getElementById('notes-editor');
    if (editor && currentNotesStockIndex !== null) {
        window.Portfolio.updateNotes(currentNotesStockIndex, serializeNotes(editor));
    }
    const overlay = document.getElementById('notes-popup-overlay');
    overlay.classList.remove('show');
    setTimeout(() => { overlay.style.display = 'none'; currentNotesStockIndex = null; }, 200);
}

/** Add-Stock modal */
let addStockDebounce = null;
let warnedMissingMarketKey = false;

function openAddStockModal() {
    const overlay = document.getElementById('add-stock-overlay');
    const input = document.getElementById('add-stock-input');
    const dateEl = document.getElementById('add-stock-date');
    const suggestions = document.getElementById('add-stock-suggestions');
    const confirmBtn = document.getElementById('add-stock-confirm');
    const nameEl = document.getElementById('add-stock-name');

    if (!overlay) return;
    // Reset
    input.value = '';
    dateEl.value = new Date().toISOString().slice(0, 10);
    suggestions.innerHTML = '';
    nameEl.textContent = '';
    confirmBtn.disabled = true;
    confirmBtn.dataset.ticker = '';
    confirmBtn.dataset.name = '';

    overlay.classList.add('show');
    warnedMissingMarketKey = false;
    setTimeout(() => input.focus(), 50);
}

function closeAddStockModal() {
    document.getElementById('add-stock-overlay')?.classList.remove('show');
}

function wireAddStockModal() {
    const overlay = document.getElementById('add-stock-overlay');
    if (!overlay) return;

    const input = document.getElementById('add-stock-input');
    const dateEl = document.getElementById('add-stock-date');
    const suggestions = document.getElementById('add-stock-suggestions');
    const confirmBtn = document.getElementById('add-stock-confirm');
    const nameEl = document.getElementById('add-stock-name');

    function selectTicker(symbol, name) {
        input.value = symbol;
        nameEl.textContent = name ? `${name}` : '';
        confirmBtn.dataset.ticker = symbol;
        confirmBtn.dataset.name = name || '';
        confirmBtn.disabled = false;
        suggestions.innerHTML = '';
    }

    input.addEventListener('input', () => {
        clearTimeout(addStockDebounce);
        const q = input.value.trim();
        confirmBtn.disabled = true;
        confirmBtn.dataset.ticker = '';
        nameEl.textContent = '';
        if (!q) { suggestions.innerHTML = ''; return; }

        addStockDebounce = setTimeout(async () => {
            const results = await window.MarketData?.fetchTickerSuggestions(q) || [];
            suggestions.innerHTML = '';
            results.forEach(r => {
                const div = document.createElement('div');
                div.className = 'add-stock-suggestion';
                div.innerHTML = `<strong>${r.symbol}</strong><span>${r.name}</span>`;
                div.addEventListener('click', () => selectTicker(r.symbol, r.name));
                suggestions.appendChild(div);
            });
            // If input exactly matches a symbol, auto-select it
            const exact = results.find(r => r.symbol.toUpperCase() === q.toUpperCase());
            if (exact) selectTicker(exact.symbol, exact.name);
        }, 250);
    });

    confirmBtn.addEventListener('click', async () => {
        const ticker = confirmBtn.dataset.ticker || input.value.trim().toUpperCase();
        const name = confirmBtn.dataset.name || '';
        const date = dateEl.value;
        if (!ticker) return;

        const filterSet = window.Portfolio?.labelFilterSet || new Set();
        const activeLabel = filterSet.size === 1 ? [...filterSet][0] : '';

        closeAddStockModal();
        await window.Portfolio?.add(ticker, name, date, activeLabel);
    });

    // Close on overlay click
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAddStockModal(); });
    document.getElementById('add-stock-close')?.addEventListener('click', closeAddStockModal);

    // Enter key in input
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            const first = suggestions.querySelector('.add-stock-suggestion');
            if (first) first.click();
            else if (input.value.trim()) {
                selectTicker(input.value.trim().toUpperCase(), '');
            }
        }
        if (e.key === 'Escape') closeAddStockModal();
    });
}

// Wire modal after DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireAddStockModal);
} else {
    wireAddStockModal();
}

window.UI = { closeNotesPopup, confirmAutosave: () => window.Portfolio?.save(), cancelAutosave: () => {} };
window.openAddStockModal = openAddStockModal;
window.debouncedUpdateTable = debouncedUpdateTable;
window.showStatus = showStatus;
window.updateSaveButtonState = updateSaveButtonState;
window.updateGitHubUI = updateGitHubUI;
window.updatePortfolioTable = updatePortfolioTable;
window.closeTradingViewPopup = closeChart;
window.updateApiKeyTiles = updateApiKeyTiles;

/** Update only the price cells for a single stock row (avoids full table rebuild) */
function updatePriceCells(stock) {
    const tr = document.querySelector(`#portfolio-tbody tr[data-ticker="${CSS.escape(stock.ticker)}"]`);
    if (!tr) return;

    const priceDisplay = stock.loading ? '...' : (stock.nowPrice !== 'N/A' && stock.nowPrice !== 'Loading...' ? '$' + stock.nowPrice : stock.nowPrice);
    const priceCell = tr.querySelector('.price-cell');
    const ret3mCell = tr.querySelector('.return3m-cell');
    const cumretCell = tr.querySelector('.cumret-cell');

    if (priceCell) priceCell.innerHTML = priceDisplay;
    if (ret3mCell) ret3mCell.innerHTML = colorReturn(stock.return3m);
    if (cumretCell) cumretCell.innerHTML = colorReturn(stock.cumulativeReturn);
}
window.updatePriceCells = updatePriceCells;

function updateApiKeyTiles() {
    const ghTile = document.getElementById('github-key-tile');
    const hasGitHub = !!(window.TokenStore?.get('github_token'));

    if (ghTile) {
        ghTile.classList.toggle('inactive', !hasGitHub);
        const status = ghTile.querySelector('.key-status');
        const repoLabel = hasGitHub && window.githubClient ? `${window.githubClient.repoOwner}/${window.githubClient.repoName}` : 'Set key';
        if (status) status.textContent = repoLabel;
    }
}

// Lazy loading for prices - only load when row is visible
const priceObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const tr = entry.target;
            const ticker = tr.dataset.ticker;
            const isLoaded = tr.dataset.priceLoaded === 'true';
            
            if (ticker && !isLoaded) {
                loadPriceLazy(ticker);
            }
        }
    });
}, {
    root: null,
    rootMargin: '50px',
    threshold: 0
});

async function loadPriceLazy(ticker) {
    const api = window.MarketData;
    const portfolio = window.Portfolio;
    if (!api || !portfolio) return;
    
    const stock = portfolio.data.find(s => s.ticker === ticker);
    if (!stock || stock.nowPrice !== 'Loading...') return;
    
    try {
        const [{ price, ret3m }, hist] = await Promise.all([
            api.fetchPriceAndReturn(ticker),
            api.fetchHistoricalPrice(ticker, stock.date)
        ]);
        
        stock.nowPrice = price != null ? Number(price).toFixed(2) : 'N/A';
        stock.return3m = ret3m != null ? ret3m : 'N/A';
        stock.cumulativeReturn = (price != null && hist != null)
            ? (((price - hist) / hist) * 100).toFixed(2) : 'N/A';
        
        const tr = document.querySelector(`#portfolio-tbody tr[data-ticker="${CSS.escape(ticker)}"]`);
        if (tr) tr.dataset.priceLoaded = 'true';
        
        if (window.updatePriceCells) window.updatePriceCells(stock);
    } catch (err) {
        stock.nowPrice = 'N/A';
        stock.return3m = 'N/A';
        stock.cumulativeReturn = 'N/A';
        const tr = document.querySelector(`#portfolio-tbody tr[data-ticker="${CSS.escape(ticker)}"]`);
        if (tr) tr.dataset.priceLoaded = 'true';
        if (window.updatePriceCells) window.updatePriceCells(stock);
    }
}

// Hook into table updates to observe new rows
const originalUpdatePortfolioTable = updatePortfolioTable;
window.updatePortfolioTable = function() {
    originalUpdatePortfolioTable();
    
    // Observe all rows for lazy loading
    document.querySelectorAll('#portfolio-tbody tr[data-ticker]').forEach(row => {
        if (row.dataset.priceLoaded !== 'true') {
            priceObserver.observe(row);
        }
    });
};
