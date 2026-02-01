/**
 * Main entry point
 * Initializes the application and sets up event listeners
 */

// GitHub credentials management
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

/**
 * Initialize GitHub integration
 */
function initializeGitHubIntegration() {
    tryAutoLogin();
    
    // GitHub auth form
    const githubAuthForm = document.getElementById('github-auth-form');
    if (githubAuthForm) {
        githubAuthForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const token = document.getElementById('github-token')?.value || '';
            const owner = document.getElementById('repo-owner')?.value || '';
            const repo = document.getElementById('repo-name')?.value || '';
            
            if (token && owner && repo) {
                saveGitHubCredentials(token, owner, repo);
                window.githubClient.authenticate(token, owner, repo);
                updateGitHubUI();
                showStatus('Authenticated with GitHub!', 'success');
                
                const authModal = document.getElementById('github-auth-modal');
                if (authModal) authModal.style.display = 'none';
            } else {
                showStatus('Please enter all GitHub credentials.', 'error');
            }
        });
    }

    // Logout button
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
            window.Portfolio?.save().catch(error => console.error('Save error:', error));
        });
    }

    // Refresh button
    const refreshButton = document.getElementById('refresh-portfolio');
    if (refreshButton) {
        refreshButton.addEventListener('click', (e) => {
            e.preventDefault();
            window.Portfolio?.refresh();
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

/**
 * Initialize stock input with autocomplete
 */
function initializeStockInput() {
    const stockInput = document.getElementById('stock-input');
    if (!stockInput) return;
    
    // Ticker autocomplete
    stockInput.addEventListener('input', async (e) => {
        const val = e.target.value;
        if (val.length < 1) return;
        
        const suggestions = await window.YahooFinance?.fetchTickerSuggestions(val) || [];
        const datalist = document.getElementById('ticker-list');
        if (datalist) {
            datalist.innerHTML = '';
            suggestions.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.symbol;
                opt.label = s.name;
                datalist.appendChild(opt);
            });
        }
    });
    
    // Add stock on change
    stockInput.addEventListener('change', async (e) => {
        const ticker = stockInput.value.trim().toUpperCase();
        if (!ticker) return;
        
        stockInput.value = '';
        await window.Portfolio?.add(ticker);
    });
}

/**
 * Initialize label filter dropdown
 */
function initializeLabelFilter() {
    const labelHeader = document.getElementById('label-header');
    const dropdown = document.getElementById('label-filter-dropdown');
    
    if (!labelHeader || !dropdown) return;
    
    labelHeader.addEventListener('click', (e) => {
        e.stopPropagation();
        
        const portfolio = window.Portfolio?.data || [];
        const labels = Array.from(new Set(portfolio.flatMap(s => s.labels).filter(l => l)));
        const labelFilterSet = window.Portfolio?.labelFilterSet || new Set();
        
        const rect = labelHeader.getBoundingClientRect();
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = (rect.bottom + 5) + 'px';
        
        dropdown.innerHTML = '';
        
        // Select All checkbox
        const selectAllDiv = document.createElement('div');
        selectAllDiv.style.cssText = 'margin-bottom:8px; border-bottom:1px solid #ccc; padding-bottom:5px;';
        const allChecked = labels.length > 0 && labels.every(label => labelFilterSet.has(label));
        selectAllDiv.innerHTML = `<label><input type="checkbox" id="label-filter-select-all" ${allChecked ? 'checked' : ''}> <strong>Select All</strong></label>`;
        dropdown.appendChild(selectAllDiv);
        
        selectAllDiv.querySelector('input').addEventListener('change', (ev) => {
            if (ev.target.checked) {
                labels.forEach(label => labelFilterSet.add(label));
            } else {
                labelFilterSet.clear();
            }
            dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = ev.target.checked);
            updatePortfolioTable();
        });
        
        // Individual labels
        labels.forEach(label => {
            const div = document.createElement('div');
            div.innerHTML = `<label><input type="checkbox" value="${label}" ${labelFilterSet.has(label) ? 'checked' : ''}> ${label}</label>`;
            dropdown.appendChild(div);
            
            div.querySelector('input').addEventListener('change', (ev) => {
                if (ev.target.checked) {
                    labelFilterSet.add(label);
                } else {
                    labelFilterSet.delete(label);
                }
                
                const allChecked = labels.every(l => labelFilterSet.has(l));
                const selectAllCb = document.getElementById('label-filter-select-all');
                if (selectAllCb) selectAllCb.checked = allChecked;
                
                updatePortfolioTable();
            });
        });
        
        // Clear All button
        if (labels.length > 0) {
            const clearDiv = document.createElement('div');
            clearDiv.style.cssText = 'margin-top:8px; border-top:1px solid #ccc; padding-top:5px;';
            const clearBtn = document.createElement('button');
            clearBtn.innerText = 'Clear All';
            clearBtn.style.cssText = 'padding:3px 8px; font-size:12px;';
            clearBtn.addEventListener('click', () => {
                labelFilterSet.clear();
                dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
                updatePortfolioTable();
            });
            clearDiv.appendChild(clearBtn);
            dropdown.appendChild(clearDiv);
        }
        
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    });
    
    document.body.addEventListener('click', () => dropdown.style.display = 'none');
    dropdown.addEventListener('click', (e) => e.stopPropagation());
}

/**
 * Initialize sorting headers
 */
function initializeSortHeaders() {
    const sortHeader = document.getElementById('sort-cumret');
    if (sortHeader) {
        sortHeader.addEventListener('click', () => {
            if (window.Portfolio) {
                window.Portfolio.sortByCumulativeReturn = !window.Portfolio.sortByCumulativeReturn;
            }
            updatePortfolioTable();
        });
    }
    
    const sort3MHeader = document.getElementById('sort-3m-return');
    if (sort3MHeader) {
        sort3MHeader.addEventListener('click', () => {
            if (window.Portfolio) {
                window.Portfolio.sortBy3MonthReturn = !window.Portfolio.sortBy3MonthReturn;
            }
            updatePortfolioTable();
        });
    }
}

/**
 * Initialize notes popup
 */
function initializeNotesPopup() {
    const notesOverlay = document.getElementById('notes-popup-overlay');
    const notesCloseBtn = document.getElementById('notes-popup-close');
    const notesTextarea = document.getElementById('notes-textarea');
    
    if (notesOverlay) {
        notesOverlay.addEventListener('click', (e) => {
            if (e.target === notesOverlay) window.UI?.closeNotesPopup();
        });
    }
    
    if (notesCloseBtn) {
        notesCloseBtn.addEventListener('click', () => window.UI?.closeNotesPopup());
    }
    
    // Image upload
    const addImageBtn = document.getElementById('add-image-btn');
    const imageUpload = document.getElementById('image-upload');
    
    if (addImageBtn && imageUpload) {
        addImageBtn.addEventListener('click', () => imageUpload.click());
        
        imageUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = () => {
                window.UI?.insertImageIntoTextarea(notesTextarea, reader.result, file.name);
            };
            reader.readAsDataURL(file);
            imageUpload.value = '';
        });
    }
    
    // Paste image from clipboard
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
                        window.UI?.insertImageIntoTextarea(notesTextarea, reader.result, 'pasted-image');
                    };
                    reader.readAsDataURL(file);
                    break;
                }
            }
        });
    }
}

/**
 * Initialize autosave popup
 */
function initializeAutosavePopup() {
    const autosaveConfirm = document.getElementById('autosave-confirm');
    const autosaveCancel = document.getElementById('autosave-cancel');
    
    if (autosaveConfirm) {
        autosaveConfirm.addEventListener('click', () => window.UI?.confirmAutosave());
    }
    if (autosaveCancel) {
        autosaveCancel.addEventListener('click', () => window.UI?.cancelAutosave());
    }
}

/**
 * Initialize keyboard shortcuts
 */
function initializeKeyboardShortcuts() {
    // Force refresh: Ctrl+Shift+R or Cmd+Shift+R
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
            e.preventDefault();
            window.Portfolio?.refresh();
        }
        
        // Escape to close notes popup
        if (e.key === 'Escape') {
            const overlay = document.getElementById('notes-popup-overlay');
            if (overlay && overlay.style.display !== 'none') {
                window.UI?.closeNotesPopup();
            }
        }
    });
    
    // Warn before leaving with unsaved changes
    window.addEventListener('beforeunload', (e) => {
        if (window.Portfolio?.hasUnsavedChanges) {
            const message = 'You have unsaved changes. Are you sure you want to leave?';
            e.preventDefault();
            e.returnValue = message;
            return message;
        }
    });
}

/**
 * Update TradingView ticker tape widget with portfolio stocks
 */
function updateTradingViewWidget() {
    const container = document.getElementById('tradingview-ticker-container');
    if (!container || !window.Portfolio?.data) return;
    
    const portfolio = window.Portfolio.data;
    if (portfolio.length === 0) return;
    
    // Map tickers to TradingView format
    const symbols = portfolio.slice(0, 20).map(stock => {
        // Try to determine exchange (default to NASDAQ for tech stocks)
        const ticker = stock.ticker.toUpperCase();
        let exchange = 'NASDAQ';
        
        // Common NYSE stocks
        if (['NIO', 'XPEV', 'LI', 'BABA', 'JD', 'PDD', 'WMT', 'DIS', 'BA', 'GE', 'F', 'GM'].includes(ticker)) {
            exchange = 'NYSE';
        }
        
        return {
            proName: `${exchange}:${ticker}`,
            title: stock.name || ticker
        };
    });
    
    // Create new widget HTML
    container.innerHTML = `
        <div class="tradingview-widget-container">
            <div class="tradingview-widget-container__widget"></div>
            <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js" async>
            ${JSON.stringify({
                symbols: symbols,
                showSymbolLogo: true,
                isTransparent: false,
                displayMode: "adaptive",
                colorTheme: "light",
                locale: "en"
            })}
            </script>
        </div>
    `;
}

/**
 * Main initialization
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Stock Tracker...');
    
    // Initialize all modules
    initializeGitHubIntegration();
    initializeStockInput();
    initializeLabelFilter();
    initializeSortHeaders();
    initializeNotesPopup();
    initializeAutosavePopup();
    initializeKeyboardShortcuts();
    
    // Initial table render
    updatePortfolioTable();
    
    // Load portfolio from GitHub
    setTimeout(() => {
        window.Portfolio?.refresh();
    }, 100);
    
    console.log('Stock Tracker initialized!');
});

// Update TradingView widget when portfolio changes
const originalUpdateTable = window.updatePortfolioTable;
window.updatePortfolioTable = function() {
    if (originalUpdateTable) originalUpdateTable();
    updateTradingViewWidget();
};
