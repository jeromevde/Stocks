/**
 * Main entry point - initializes app and event listeners
 */

function tryAutoLogin() {
    try {
        const t = localStorage.getItem('github_token');
        const o = localStorage.getItem('github_owner');
        const r = localStorage.getItem('github_repo');
        if (t && o && r && window.githubClient) {
            window.githubClient.authenticate(t, o, r);
            updateGitHubUI();
            showStatus('Auto-logged in to GitHub', 'success');
        }
    } catch (e) { console.warn('Auto-login failed:', e); }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Stock Tracker...');
    tryAutoLogin();

    // GitHub auth form
    document.getElementById('github-auth-form')?.addEventListener('submit', e => {
        e.preventDefault();
        const token = document.getElementById('github-token')?.value || '';
        const owner = document.getElementById('repo-owner')?.value || '';
        const repo = document.getElementById('repo-name')?.value || '';
        if (token && owner && repo) {
            localStorage.setItem('github_token', token);
            localStorage.setItem('github_owner', owner);
            localStorage.setItem('github_repo', repo);
            window.githubClient.authenticate(token, owner, repo);
            updateGitHubUI();
            showStatus('Authenticated with GitHub!', 'success');
            document.getElementById('github-auth-modal').style.display = 'none';
        } else {
            showStatus('Please enter all GitHub credentials.', 'error');
        }
    });

    // GitHub logout
    document.getElementById('github-logout')?.addEventListener('click', () => {
        localStorage.removeItem('github_token');
        localStorage.removeItem('github_owner');
        localStorage.removeItem('github_repo');
        window.githubClient.logout();
        updateGitHubUI();
        showStatus('Disconnected from GitHub', 'info');
    });

    // Close auth modal
    document.getElementById('close-auth-modal')?.addEventListener('click', () => {
        document.getElementById('github-auth-modal').style.display = 'none';
    });

    // Save & refresh
    document.getElementById('save-portfolio')?.addEventListener('click', e => {
        e.preventDefault();
        window.Portfolio?.save().catch(err => console.error('Save error:', err));
    });
    document.getElementById('refresh-portfolio')?.addEventListener('click', e => {
        e.preventDefault();
        window.Portfolio?.refresh();
    });

    // Stock input with autocomplete
    const stockInput = document.getElementById('stock-input');
    if (stockInput) {
        let debounce = null;
        stockInput.addEventListener('input', e => {
            clearTimeout(debounce);
            if (e.target.value.length < 1) { document.getElementById('ticker-list').innerHTML = ''; return; }
            debounce = setTimeout(async () => {
                const suggestions = await window.YahooFinance?.fetchTickerSuggestions(e.target.value) || [];
                const dl = document.getElementById('ticker-list');
                dl.innerHTML = '';
                suggestions.forEach(s => { const o = document.createElement('option'); o.value = s.symbol; o.label = s.name; dl.appendChild(o); });
            }, 300);
        });
        stockInput.addEventListener('change', async () => {
            const ticker = stockInput.value.trim().toUpperCase();
            if (!ticker) return;
            stockInput.value = '';
            await window.Portfolio?.add(ticker);
        });
    }

    // Label filter dropdown
    const labelHeader = document.getElementById('label-header');
    const dropdown = document.getElementById('label-filter-dropdown');
    if (labelHeader && dropdown) {
        labelHeader.addEventListener('click', e => {
            e.stopPropagation();
            const labels = Array.from(new Set((window.Portfolio?.data || []).flatMap(s => s.labels).filter(Boolean)));
            const filterSet = window.Portfolio?.labelFilterSet || new Set();
            const rect = labelHeader.getBoundingClientRect();
            dropdown.style.left = rect.left + 'px';
            dropdown.style.top = (rect.bottom + 5) + 'px';
            dropdown.innerHTML = '';

            // Select All
            const allDiv = document.createElement('div');
            allDiv.style.cssText = 'margin-bottom:8px;border-bottom:1px solid #ccc;padding-bottom:5px';
            allDiv.innerHTML = `<label><input type="checkbox" id="label-filter-all" ${labels.every(l => filterSet.has(l)) ? 'checked' : ''}> <strong>Select All</strong></label>`;
            dropdown.appendChild(allDiv);
            allDiv.querySelector('input').addEventListener('change', ev => {
                labels.forEach(l => ev.target.checked ? filterSet.add(l) : filterSet.delete(l));
                dropdown.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = ev.target.checked);
                updatePortfolioTable();
            });

            labels.forEach(label => {
                const div = document.createElement('div');
                div.innerHTML = `<label><input type="checkbox" value="${label}" ${filterSet.has(label) ? 'checked' : ''}> ${label}</label>`;
                dropdown.appendChild(div);
                div.querySelector('input').addEventListener('change', ev => {
                    ev.target.checked ? filterSet.add(label) : filterSet.delete(label);
                    const allCb = document.getElementById('label-filter-all');
                    if (allCb) allCb.checked = labels.every(l => filterSet.has(l));
                    updatePortfolioTable();
                });
            });

            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        });
        document.body.addEventListener('click', () => dropdown.style.display = 'none');
        dropdown.addEventListener('click', e => e.stopPropagation());
    }

    // Sort headers
    document.getElementById('sort-cumret')?.addEventListener('click', () => {
        if (window.Portfolio) window.Portfolio.sortByCumulativeReturn = !window.Portfolio.sortByCumulativeReturn;
        updatePortfolioTable();
    });
    document.getElementById('sort-3m-return')?.addEventListener('click', () => {
        if (window.Portfolio) window.Portfolio.sortBy3MonthReturn = !window.Portfolio.sortBy3MonthReturn;
        updatePortfolioTable();
    });

    // Notes popup
    document.getElementById('notes-popup-overlay')?.addEventListener('click', e => {
        if (e.target.id === 'notes-popup-overlay') window.UI?.closeNotesPopup();
    });
    document.getElementById('notes-popup-close')?.addEventListener('click', () => window.UI?.closeNotesPopup());

    // Autosave
    document.getElementById('autosave-confirm')?.addEventListener('click', () => window.UI?.confirmAutosave());
    document.getElementById('autosave-cancel')?.addEventListener('click', () => window.UI?.cancelAutosave());

    // TradingView popup
    document.getElementById('tradingview-close')?.addEventListener('click', () => closeTradingViewPopup());
    document.getElementById('tradingview-popup')?.addEventListener('click', e => {
        if (e.target.id === 'tradingview-popup') closeTradingViewPopup();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') { e.preventDefault(); window.Portfolio?.refresh(); }
        if (e.key === 'Escape') {
            const overlay = document.getElementById('notes-popup-overlay');
            if (overlay && overlay.style.display !== 'none') window.UI?.closeNotesPopup();
            closeTradingViewPopup();
        }
    });

    // Warn before leaving with unsaved changes
    window.addEventListener('beforeunload', e => {
        if (window.Portfolio?.hasUnsavedChanges) { e.preventDefault(); e.returnValue = 'Unsaved changes'; }
    });

    // Initial render & load
    updatePortfolioTable();
    setTimeout(() => window.Portfolio?.refresh(), 100);
    console.log('Stock Tracker initialized!');
});
