/**
 * Main entry point - initializes app and event listeners
 */

function tryAutoLogin() {
    try {
        const t = window.TokenStore?.get('github_token');
        const o = window.TokenStore?.get('github_repo_owner') || localStorage.getItem('github_owner');
        const r = window.TokenStore?.get('github_repo_name') || localStorage.getItem('github_repo');
        if (t && o && r && window.githubClient) {
            window.githubClient.authenticate(t, o, r);
            updateGitHubUI();
            showStatus('Auto-logged in to GitHub', 'success');
        }
    } catch (e) { console.warn('Auto-login failed:', e); }
}

const LLM_GUIDE_CACHE_KEY = 'llm_guide_markdown_v2';
let llmMode = 'preview';

function setLlmMode(mode) {
    llmMode = mode;
    const ta = document.getElementById('llm-guide-text');
    const pv = document.getElementById('llm-guide-preview');
    const bPrev = document.getElementById('llm-mode-preview');
    const bEdit = document.getElementById('llm-mode-edit');
    if (!ta || !pv) return;
    const isPreview = mode === 'preview';
    ta.style.display = isPreview ? 'none' : 'block';
    pv.style.display = isPreview ? 'block' : 'none';
    if (bPrev) bPrev.style.opacity = isPreview ? '1' : '0.7';
    if (bEdit) bEdit.style.opacity = isPreview ? '0.7' : '1';
}

function updateLlmPreview() {
    const ta = document.getElementById('llm-guide-text');
    const pv = document.getElementById('llm-guide-preview');
    if (!ta || !pv) return;
    if (window.marked?.parse) pv.innerHTML = window.marked.parse(ta.value || '');
    else pv.textContent = ta.value || '';
}

async function loadLlmPrompt() {
    const stored = localStorage.getItem(LLM_GUIDE_CACHE_KEY);
    if (stored) return stored;
    try {
        const res = await fetch('llm-prompt.md?v=__BUILD_HASH__');
        if (res.ok) return await res.text();
    } catch (e) {
        console.warn('Could not load llm-prompt.md:', e);
    }
    return '(Could not load llm-prompt.md. Check that the file is served alongside index.html.)';
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

    // Close auth modal
    document.getElementById('close-auth-modal')?.addEventListener('click', () => {
        document.getElementById('github-auth-modal').style.display = 'none';
    });

    // GitHub disconnect from modal
    document.getElementById('github-disconnect')?.addEventListener('click', e => {
        e.preventDefault();
        window.githubClient?.logout();
        updateGitHubUI();
        showStatus('Disconnected from GitHub', 'info');
        document.getElementById('github-auth-modal').style.display = 'none';
    });

    // API key tiles
    document.getElementById('github-key-tile')?.addEventListener('click', () => {
        document.getElementById('github-auth-modal').style.display = 'flex';
        const t = window.TokenStore?.get('github_token') || '';
        const owner = window.githubClient?.repoOwner || 'jeromevde';
        const repo = window.githubClient?.repoName || 'Stocks';
        const tokenInput = document.getElementById('github-token');
        if (tokenInput) tokenInput.value = t || '';
        const ownerInput = document.getElementById('repo-owner');
        const repoInput = document.getElementById('repo-name');
        if (ownerInput) ownerInput.value = owner;
        if (repoInput) repoInput.value = repo;
    });

    // Save
    document.getElementById('save-portfolio')?.addEventListener('click', e => {
        e.preventDefault();
        window.Portfolio?.save().catch(err => console.error('Save error:', err));
    });

    // LLM guide modal
    const llmModal = document.getElementById('llm-guide-modal');
    const llmText = document.getElementById('llm-guide-text');
    loadLlmPrompt().then(guide => {
        if (llmText) llmText.value = guide;
        updateLlmPreview();
        setLlmMode('preview');
    });

    document.getElementById('llm-guide-btn')?.addEventListener('click', () => {
        if (!llmModal) return;
        llmModal.style.display = 'flex';
        updateLlmPreview();
        setLlmMode('preview');
    });
    document.getElementById('llm-guide-close')?.addEventListener('click', () => {
        if (llmModal) llmModal.style.display = 'none';
    });
    document.getElementById('llm-mode-preview')?.addEventListener('click', () => setLlmMode('preview'));
    document.getElementById('llm-mode-edit')?.addEventListener('click', () => setLlmMode('edit'));
    llmText?.addEventListener('input', updateLlmPreview);

    document.getElementById('llm-guide-copy')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(llmText?.value || '');
            showStatus('LLM instructions copied', 'success');
        } catch {
            showStatus('Copy failed', 'error');
        }
    });
    document.getElementById('llm-guide-save')?.addEventListener('click', async () => {
        const content = llmText?.value || '';
        localStorage.setItem(LLM_GUIDE_CACHE_KEY, content);
        try {
            if (!window.githubClient?.isAuthenticated || !window.githubClient.isAuthenticated()) {
                showStatus('Connect GitHub first to save llm-prompt.md', 'error');
                return;
            }
            await window.githubClient.saveFile(content, 'Update llm-prompt.md instructions', 'llm-prompt.md');
            showStatus('LLM instructions saved to GitHub (llm-prompt.md)', 'success');
        } catch (e) {
            console.error(e);
            showStatus('GitHub save failed, kept local draft', 'error');
        }
    });

    // Add stock button → open modal
    document.getElementById('add-stock-btn')?.addEventListener('click', () => window.openAddStockModal?.());

    // Label filter dropdown
    const labelHeader = document.getElementById('label-header');
    const dropdown = document.getElementById('label-filter-dropdown');
    if (labelHeader && dropdown) {
        labelHeader.addEventListener('click', e => {
            e.stopPropagation();
            const labels = window.Portfolio?.getOrderedLabels ? window.Portfolio.getOrderedLabels() : [];
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
    document.getElementById('sort-rating')?.addEventListener('click', () => {
        window.Portfolio?.setSortMode?.('rating');
        updatePortfolioTable();
    });
    document.getElementById('sort-rating')?.addEventListener('dblclick', () => {
        window.Portfolio?.setSortMode?.('rating');
        window.Portfolio?.invertSort?.('rating');
        updatePortfolioTable();
    });

    document.getElementById('sort-cumret')?.addEventListener('click', () => {
        window.Portfolio?.setSortMode?.('cumulative');
        updatePortfolioTable();
    });
    document.getElementById('sort-cumret')?.addEventListener('dblclick', () => {
        window.Portfolio?.setSortMode?.('cumulative');
        window.Portfolio?.invertSort?.('cumulative');
        updatePortfolioTable();
    });

    document.getElementById('sort-3m-return')?.addEventListener('click', () => {
        window.Portfolio?.setSortMode?.('return3m');
        updatePortfolioTable();
    });
    document.getElementById('sort-3m-return')?.addEventListener('dblclick', () => {
        window.Portfolio?.setSortMode?.('return3m');
        window.Portfolio?.invertSort?.('return3m');
        updatePortfolioTable();
    });

    // Notes popup
    document.getElementById('notes-popup-overlay')?.addEventListener('click', e => {
        if (e.target.id === 'notes-popup-overlay') window.UI?.closeNotesPopup();
    });
    document.getElementById('notes-popup-close')?.addEventListener('click', () => window.UI?.closeNotesPopup());
    document.getElementById('llm-guide-modal')?.addEventListener('click', e => {
        if (e.target?.id === 'llm-guide-modal') e.currentTarget.style.display = 'none';
    });

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
            document.getElementById('add-stock-overlay')?.classList.remove('show');
            closeTradingViewPopup();
        }

        const notesOverlay = document.getElementById('notes-popup-overlay');
        const notesOpen = notesOverlay && notesOverlay.style.display !== 'none';
        if (notesOpen && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
            e.preventDefault();
            window.UI?.navigateNotesPopup?.(-1);
        }
        if (notesOpen && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
            e.preventDefault();
            window.UI?.navigateNotesPopup?.(1);
        }
    });

    // Warn before leaving with unsaved changes
    window.addEventListener('beforeunload', e => {
        if (window.Portfolio?.hasUnsavedChanges) { e.preventDefault(); e.returnValue = 'Unsaved changes'; }
    });

    // Initial render & load
    updatePortfolioTable();
    updateApiKeyTiles();
    setTimeout(() => window.Portfolio?.refresh(), 100);
    console.log('Stock Tracker initialized!');
});
