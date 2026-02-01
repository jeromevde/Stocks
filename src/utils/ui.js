/**
 * UI module
 * Handles all user interface interactions and rendering
 */

// Debounce timeout for table updates
let tableUpdateTimeout = null;

// Autosave state
let autosaveTimerId = null;
let autosavePopupVisible = false;

// Notes popup state
let currentNotesStockIndex = null;
let imageDataMap = {};

/**
 * Debounced table update to prevent excessive re-renders
 */
function debouncedUpdateTable() {
    if (tableUpdateTimeout) {
        clearTimeout(tableUpdateTimeout);
    }
    tableUpdateTimeout = setTimeout(() => {
        updatePortfolioTable();
    }, 100);
}

/**
 * Show status message
 */
function showStatus(message, type = 'info') {
    const statusElement = document.getElementById('save-status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = `status-message ${type}`;
        statusElement.style.display = 'block';
        
        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                statusElement.style.display = 'none';
            }, 5000);
        }
    }
}

/**
 * Update save button state
 */
function updateSaveButtonState() {
    const saveButton = document.getElementById('save-portfolio');
    if (!saveButton) return;
    
    const hasChanges = window.Portfolio?.hasUnsavedChanges;
    
    if (hasChanges) {
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

/**
 * Update GitHub UI elements
 */
function updateGitHubUI() {
    const statusSection = document.getElementById('github-status');
    const saveButton = document.getElementById('save-portfolio');
    const githubInfo = document.getElementById('github-info');
    
    if (window.githubClient && window.githubClient.isAuthenticated()) {
        if (statusSection) statusSection.style.display = 'block';
        if (saveButton) saveButton.disabled = false;
        
        if (githubInfo) {
            githubInfo.textContent = `✅ Connected to ${window.githubClient.repoOwner}/${window.githubClient.repoName}`;
        }
    } else {
        if (statusSection) statusSection.style.display = 'none';
        if (saveButton) saveButton.disabled = false;
    }
}

/**
 * Format date for display
 */
function formatDateDisplay(dateStr) {
    if (!dateStr) return { formatted: '', timeAgo: '', diffDays: 0 };
    
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

/**
 * Update portfolio table
 */
function updatePortfolioTable() {
    const portfolioTableBody = document.getElementById('portfolio-tbody');
    if (!portfolioTableBody || !window.Portfolio) return;

    portfolioTableBody.innerHTML = '';
    
    const sorted = window.Portfolio.getSortedFiltered();
    
    // Separate by rating
    const ratedStocks = sorted.filter(stock => (stock.rating || 0) > 0);
    const zeroStarStocks = sorted.filter(stock => (stock.rating || 0) === 0);
    
    // Render rated stocks
    ratedStocks.forEach(stock => renderStockRow(portfolioTableBody, stock));
    
    // Render toggle for zero-star stocks
    if (zeroStarStocks.length > 0) {
        const toggleRow = document.createElement('tr');
        toggleRow.className = 'zero-star-toggle-row';
        toggleRow.innerHTML = `
            <td colspan="9" style="text-align:center; background:#f5f5f5; cursor:pointer; padding:12px; border-top:2px solid #ddd;">
                <span style="color:#666; font-size:14px;">
                    <span class="zero-star-arrow" style="display:inline-block; transition:transform 0.2s; margin-right:8px;">${window.Portfolio.showZeroStarStocks ? '▼' : '▶'}</span>
                    ${zeroStarStocks.length} unrated stock${zeroStarStocks.length > 1 ? 's' : ''} 
                    <span style="color:#999; font-size:12px;">(click to ${window.Portfolio.showZeroStarStocks ? 'hide' : 'show'})</span>
                </span>
            </td>
        `;
        toggleRow.addEventListener('click', () => {
            window.Portfolio.showZeroStarStocks = !window.Portfolio.showZeroStarStocks;
            updatePortfolioTable();
        });
        portfolioTableBody.appendChild(toggleRow);
        
        if (window.Portfolio.showZeroStarStocks) {
            zeroStarStocks.forEach(stock => renderStockRow(portfolioTableBody, stock));
        }
    }
}

/**
 * Render a single stock row
 */
function renderStockRow(tableBody, stock) {
    const portfolio = window.Portfolio.data;
    const tr = document.createElement('tr');
    const notesShort = stock.notes && stock.notes.length > 20 ? stock.notes.slice(0, 20) + '…' : stock.notes;
    const stockIdx = portfolio.indexOf(stock);
    const rating = stock.rating || 0;
    const dateInfo = formatDateDisplay(stock.date);
    
    // Generate 5-star rating display
    const ratingHtml = [1,2,3,4,5].map(i => 
        `<span class="rating-star" data-rating="${i}" style="cursor:pointer; font-size:1.1em; color:${i <= rating ? '#f5b301' : '#ddd'};">${i <= rating ? '★' : '☆'}</span>`
    ).join('');
    
    // Notes preview
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
    
    // Attach event listeners
    attachRowEventListeners(tr, stockIdx, stock);
    tableBody.appendChild(tr);
}

/**
 * Attach event listeners to a stock row
 */
function attachRowEventListeners(tr, stockIdx, stock) {
    // Rating stars
    tr.querySelectorAll('.rating-star').forEach(star => {
        star.addEventListener('click', (e) => {
            e.stopPropagation();
            const newRating = parseInt(star.getAttribute('data-rating'));
            window.Portfolio.updateRating(stockIdx, newRating);
        });
    });
    
    // Remove button
    tr.querySelector('.remove-btn').addEventListener('click', () => {
        window.Portfolio.remove(stockIdx);
    });
    
    // Date display/edit
    const dateDisplay = tr.querySelector('.date-display');
    const dateInput = tr.querySelector('.edit-date');
    
    dateDisplay.addEventListener('click', () => {
        dateDisplay.style.display = 'none';
        dateInput.style.display = 'block';
        dateInput.focus();
    });
    
    dateInput.addEventListener('change', (e) => {
        window.Portfolio.updateDate(stockIdx, e.target.value);
    });
    
    dateInput.addEventListener('blur', () => {
        dateDisplay.style.display = 'block';
        dateInput.style.display = 'none';
    });
    
    // Labels
    const labelsContainer = tr.querySelector('.labels-container');
    const labelPopup = tr.querySelector('.label-popup');
    const labelInput = tr.querySelector('.label-input');
    const addLabelBtn = tr.querySelector('.add-label-btn');
    const confirmBtn = tr.querySelector('.add-label-confirm');
    const cancelBtn = tr.querySelector('.cancel-label');
    
    const showLabelPopup = (e) => {
        e.stopPropagation();
        const rect = labelsContainer.getBoundingClientRect();
        labelPopup.style.display = 'block';
        labelPopup.style.left = (rect.left + window.scrollX) + 'px';
        labelPopup.style.top = (rect.bottom + window.scrollY + 2) + 'px';
        labelInput.focus();
    };
    
    addLabelBtn.addEventListener('click', showLabelPopup);
    
    const addLabel = () => {
        const newLabel = labelInput.value.trim();
        if (newLabel) {
            window.Portfolio.addLabel(stockIdx, newLabel);
        }
        labelPopup.style.display = 'none';
        labelInput.value = '';
    };
    
    confirmBtn.addEventListener('click', addLabel);
    labelInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addLabel(); }
        if (e.key === 'Escape') { labelPopup.style.display = 'none'; labelInput.value = ''; }
    });
    cancelBtn.addEventListener('click', () => { labelPopup.style.display = 'none'; labelInput.value = ''; });
    
    // Remove labels
    tr.querySelectorAll('.remove-label').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.Portfolio.removeLabel(stockIdx, btn.getAttribute('data-label'));
        });
    });
    
    // Notes
    tr.querySelector('.notes-display').addEventListener('click', () => openNotesPopup(stockIdx));
    
    // Ticker click
    tr.querySelector('.ticker-cell').addEventListener('click', () => {
        window.open(`https://finance.yahoo.com/quote/${stock.ticker}`, '_blank');
    });
}

// Autosave functions
function startAutosaveTimer() {
    if (autosaveTimerId) clearTimeout(autosaveTimerId);
    
    if (window.Portfolio?.hasUnsavedChanges && window.githubClient?.isAuthenticated()) {
        autosaveTimerId = setTimeout(showAutosavePopup, 5 * 60 * 1000);
    }
}

function showAutosavePopup() {
    if (!window.Portfolio?.hasUnsavedChanges || autosavePopupVisible) return;
    
    autosavePopupVisible = true;
    const popup = document.getElementById('autosave-popup');
    if (!popup) return;
    
    popup.style.display = 'flex';
    
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
    
    popup.dataset.countdownInterval = countdownInterval;
}

function confirmAutosave() {
    const popup = document.getElementById('autosave-popup');
    if (popup) {
        clearInterval(parseInt(popup.dataset.countdownInterval));
        popup.style.display = 'none';
    }
    autosavePopupVisible = false;
    
    window.Portfolio?.save().catch(error => {
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
    startAutosaveTimer();
}

// Notes popup functions
function storeAndShortenImages(text) {
    if (!text) return '';
    imageDataMap = {};
    
    return text.replace(/!\[([^\]]*)\]\((data:image\/[^;]+;base64,)([A-Za-z0-9+/=]{50,})\)/g, (match, alt, prefix, base64) => {
        const shortKey = base64.substring(0, 20);
        imageDataMap[shortKey] = base64;
        return `![${alt}](${prefix}${shortKey}...)`;
    });
}

function restoreFullImageUrls(text) {
    if (!text) return '';
    return text.replace(/!\[([^\]]*)\]\((data:image\/[^;]+;base64,)([A-Za-z0-9+/=]{20})\.\.\.\)/g, (match, alt, prefix, shortKey) => {
        const fullBase64 = imageDataMap[shortKey];
        return fullBase64 ? `![${alt}](${prefix}${fullBase64})` : match;
    });
}

function openNotesPopup(stockIndex) {
    currentNotesStockIndex = stockIndex;
    const stock = window.Portfolio.data[stockIndex];
    
    const overlay = document.getElementById('notes-popup-overlay');
    const stockTitle = document.getElementById('notes-popup-stock');
    const textarea = document.getElementById('notes-textarea');
    
    if (stockTitle) stockTitle.textContent = stock.ticker || '';
    if (textarea) textarea.value = storeAndShortenImages(stock.notes || '');
    
    overlay.style.display = 'flex';
    setTimeout(() => {
        overlay.classList.add('show');
        if (textarea) textarea.focus();
    }, 10);
}

function closeNotesPopup() {
    const textarea = document.getElementById('notes-textarea');
    if (textarea && currentNotesStockIndex !== null) {
        window.Portfolio.updateNotes(currentNotesStockIndex, restoreFullImageUrls(textarea.value));
    }
    
    const overlay = document.getElementById('notes-popup-overlay');
    overlay.classList.remove('show');
    
    setTimeout(() => {
        overlay.style.display = 'none';
        currentNotesStockIndex = null;
        imageDataMap = {};
    }, 300);
}

function insertImageIntoTextarea(textarea, base64, altText) {
    if (!textarea) return;
    
    const cursorPos = textarea.selectionStart;
    const textBefore = textarea.value.substring(0, cursorPos);
    const textAfter = textarea.value.substring(cursorPos);
    
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
    
    if (currentNotesStockIndex !== null) {
        window.Portfolio.markChanged();
    }
}

// Export functions
window.UI = {
    debouncedUpdateTable,
    showStatus,
    updateSaveButtonState,
    updateGitHubUI,
    updatePortfolioTable,
    openNotesPopup,
    closeNotesPopup,
    startAutosaveTimer,
    confirmAutosave,
    cancelAutosave,
    insertImageIntoTextarea
};

// Make some functions globally available for compatibility
window.debouncedUpdateTable = debouncedUpdateTable;
window.showStatus = showStatus;
window.updateSaveButtonState = updateSaveButtonState;
window.updateGitHubUI = updateGitHubUI;
window.updatePortfolioTable = updatePortfolioTable;
window.startAutosaveTimer = startAutosaveTimer;
