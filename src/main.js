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

const DEFAULT_LLM_GUIDE = `# STOCK NOTES COPILOT (BRUTALLY HONEST)

## Mission
Populate each stock note with decision-grade analysis, not vibes.
If evidence is weak, say it clearly.
If thesis is broken, say SELL / AVOID clearly.
No cheerleading.

## Output format (compact)
1. Thesis in 1-2 lines
2. What market is pricing in
3. Latest catalysts (last 90 days)
4. Moat + risks (most likely failure modes)
5. Financial quality snapshot (5Y where possible)
6. Valuation sanity check
7. Red flags checklist
8. What must happen next (3 measurable checkpoints)
9. Verdict: Buy / Watch / Avoid + confidence (0-100)

## Markdown table standard (mandatory)
Use exactly one compact markdown table for key metrics to keep output consistent and easy to scan:
| Metric | Latest | 5Y context | Signal |
|---|---:|---:|---|
| Revenue growth | ... | ... | improving / flat / deteriorating |
| Operating margin | ... | ... | ... |
| FCF margin | ... | ... | ... |
| ROIC | ... | ... | ... |
| Net debt / EBITDA | ... | ... | ... |
| Valuation (EV/EBIT or P/E) | ... | ... | rich / fair / cheap |

## Data discipline
- Use primary sources first: latest 10-K/20-F, 10-Q, earnings transcript, investor deck.
- If source is older than 120 days, flag STALE.
- Distinguish facts vs assumptions.
- No ratio without formula context.

## Conventions for AI-readable site docs
- Prefer publishing /llms.txt and optional /llms-full.txt (emerging convention, not universal yet).
- Also keep this markdown in-app and in repo for agent grounding.
- Keep sections stable and machine-parseable.

## Fundamental checklist (definitions included)
### Profitability
- Gross margin = (Revenue-COGS)/Revenue: pricing power + unit economics.
- Operating margin (EBIT margin): operating efficiency.
- FCF margin = FCF/Revenue: cash conversion quality.
- ROIC = NOPAT/Invested Capital: value creation vs cost of capital.

### Growth quality
- Revenue growth: organic vs M&A split.
- EPS growth: check if real or buyback-driven.
- SBC % revenue: dilution risk.

### Balance sheet & solvency
- Net debt = Debt - Cash.
- Net debt / EBITDA: leverage stress.
- Interest coverage = EBIT/Interest.
- Current ratio = Current assets / Current liabilities.

### Cash flow quality
- CFO vs Net income: earnings quality.
- Capex intensity = Capex/Revenue.
- FCF trend and cyclicality.

### Working capital
- DSO / DIO / DPO and trend.
- Inventory growth vs revenue growth divergence.

### Valuation
- EV/Sales (early growth), EV/EBIT, P/E, FCF yield.
- Compare vs own 5Y range + peers.
- State implied growth the multiple assumes.

## Annual report / filing red flags
- Frequent KPI definition changes.
- “Adjusted” earnings widening from GAAP repeatedly.
- Large unexplained goodwill/intangibles growth.
- Related-party transactions growth.
- Customer concentration >20%.
- Rising receivables while revenue accelerates.
- Insider selling clusters without clear reason.

## 2025-2026 macro context to include in notes
- AI capex boom can inflate near-term narratives: test ROI, not buzzwords.
- Higher-for-longer rate risk still matters for long-duration multiples.
- Earnings quality > headline growth in expensive names.
- Energy/power constraints for AI infra are non-trivial for some themes.

## Writing style
- Short bullets, hard claims, clear uncertainty tags.
- Use: FACT / INFERENCE / RISK labels where useful.
- End with: “What would make this thesis wrong?”
`;

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
    const storedGuide = localStorage.getItem('llm_guide_markdown') || DEFAULT_LLM_GUIDE;
    if (llmText) llmText.value = storedGuide;

    document.getElementById('llm-guide-btn')?.addEventListener('click', () => {
        if (!llmModal) return;
        llmModal.style.display = 'flex';
    });
    document.getElementById('llm-guide-close')?.addEventListener('click', () => {
        if (llmModal) llmModal.style.display = 'none';
    });
    document.getElementById('llm-guide-copy')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(llmText?.value || '');
            showStatus('LLM instructions copied', 'success');
        } catch {
            showStatus('Copy failed', 'error');
        }
    });
    document.getElementById('llm-guide-save')?.addEventListener('click', () => {
        localStorage.setItem('llm_guide_markdown', llmText?.value || '');
        showStatus('LLM instructions saved locally', 'success');
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
