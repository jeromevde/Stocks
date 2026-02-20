/**
 * UI rendering and interactions
 */
let tableUpdateTimeout = null;
let currentNotesStockIndex = null;

function debouncedUpdateTable() {
    clearTimeout(tableUpdateTimeout);
    tableUpdateTimeout = setTimeout(updatePortfolioTable, 100);
}

function showStatus(msg, type = 'info') {
    const el = document.getElementById('save-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `status-message ${type}`;
    el.style.display = 'block';
    if (type === 'success' || type === 'info') setTimeout(() => el.style.display = 'none', 5000);
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
    const status = document.getElementById('github-status');
    const info = document.getElementById('github-info');
    const auth = window.githubClient?.isAuthenticated();
    if (status) status.style.display = auth ? 'block' : 'none';
    if (info && auth) info.textContent = `✅ ${window.githubClient.repoOwner}/${window.githubClient.repoName}`;
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
    if (!val || val === 'N/A' || val === 'Error' || val === '...') return `<span style="color:#666">${val}</span>`;
    const n = parseFloat(val);
    return `<span style="color:${n >= 0 ? '#4caf50' : '#f44336'}">${val}%</span>`;
}

/** Main table render */
function updatePortfolioTable() {
    const tbody = document.getElementById('portfolio-tbody');
    if (!tbody || !window.Portfolio) return;
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

    const stars = [1,2,3,4,5].map(i => `<span class="rating-star" data-r="${i}" style="cursor:pointer;font-size:1.1em;color:${i <= r ? '#f5b301' : '#ddd'}">${i <= r ? '★' : '☆'}</span>`).join('');
    const labels = stock.labels.map(l => `<span style="background:#e3f2fd;color:#1976d2;padding:2px 6px;margin:1px;border-radius:3px;font-size:11px;display:inline-block">${l}<span class="rm-label" data-l="${l}" style="margin-left:4px;cursor:pointer;font-weight:bold">×</span></span>`).join('');
    const notesShort = stock.notes?.length > 20 ? stock.notes.slice(0, 20) + '…' : (stock.notes || '');
    const priceDisplay = stock.loading ? '...' : (stock.nowPrice !== 'N/A' && stock.nowPrice !== 'Loading...' ? '$' + stock.nowPrice : stock.nowPrice);

    tr.innerHTML = `
        <td style="text-align:center">${stars}</td>
        <td style="text-align:center"><div class="ticker-cell" style="cursor:pointer" data-t="${stock.ticker}"><b style="color:#0066cc">${stock.ticker}</b><div style="font-size:11px;color:#888">${stock.name || ''}</div></div></td>
        <td style="text-align:center"><div class="date-disp" style="cursor:pointer"><div style="font-size:12px">${d.formatted}</div><div style="font-size:10px;color:#999">${d.timeAgo}</div></div><input type="date" value="${stock.date}" class="edit-date" style="display:none;width:130px;padding:4px;font-size:12px;border:1px solid #ddd;border-radius:4px"></td>
        <td style="text-align:center"><div class="labels-box" style="min-width:80px;padding:4px">${labels}<span class="add-label-btn" style="background:#f0f0f0;color:#666;padding:2px 6px;margin:1px;border-radius:3px;font-size:11px;cursor:pointer;display:inline-block">+</span></div></td>
        <td style="text-align:center"><span class="notes-btn" style="cursor:pointer;padding:8px;background:#f9f9f9;color:#666;border-radius:3px;display:inline-block;min-width:80px">${notesShort}</span></td>
        <td style="text-align:right">${priceDisplay}</td>
        <td style="text-align:right">${colorReturn(stock.return3m)}</td>
        <td style="text-align:right">${colorReturn(stock.cumulativeReturn)}</td>
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

    tr.querySelector('.add-label-btn').addEventListener('click', e => {
        e.stopPropagation();
        const label = prompt('Label:');
        if (label) window.Portfolio.addLabel(idx, label.trim());
    });
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
    return clone.textContent.trim();
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

// Make globally available
window.UI = { closeNotesPopup, confirmAutosave: () => window.Portfolio?.save(), cancelAutosave: () => {} };
window.debouncedUpdateTable = debouncedUpdateTable;
window.showStatus = showStatus;
window.updateSaveButtonState = updateSaveButtonState;
window.updateGitHubUI = updateGitHubUI;
window.updatePortfolioTable = updatePortfolioTable;
window.closeTradingViewPopup = closeChart;
