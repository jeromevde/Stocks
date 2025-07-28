// Helper: Fetch ticker suggestions from Yahoo Finance
async function fetchTickerSuggestions(query) {
    if (!query) return [];
    const CORS_PROXY = 'https://corsproxy.io/?';
    const url = CORS_PROXY + `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=5&newsCount=0`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        return (data.quotes || []).map(q => ({symbol: q.symbol, name: q.shortname || q.longname || q.symbol}));
    } catch (e) {
        return [];
    }
}

// Global variables
let portfolio = [];
let sortByCumulativeReturn = false;
let labelFilterSet = new Set();

// Fetch historical price from Yahoo
async function fetchHistoricalPrice(ticker, date) {
    const start = Math.floor(new Date(date).getTime() / 1000);
    const end = start + 86400; // 1 day
    const CORS_PROXY = 'https://corsproxy.io/?';
    const url = CORS_PROXY + `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${start}&period2=${end}&interval=1d`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        // Defensive checks for missing data
        if (
            !data.chart ||
            !data.chart.result ||
            !data.chart.result[0] ||
            !data.chart.result[0].indicators ||
            !data.chart.result[0].indicators.quote[0] ||
            !data.chart.result[0].indicators.quote[0].close ||
            data.chart.result[0].indicators.quote[0].close[0] == null
        ) {
            return null;
        }
        return data.chart.result[0].indicators.quote[0].close[0];
    } catch (e) {
        return null;
    }
}

// Save portfolio to markdown and upload to GitHub
async function savePortfolioToMarkdown() {
    let md = '# Portfolio\n\n';
    md += '| Ticker | Date | Labels | Notes | Current Price | Return (%) |\n';
    md += '|--------|------|--------|-------|---------------|------------|\n';
    portfolio.forEach(s => {
        md += `| ${s.ticker} | ${s.date} | ${s.labels.join(', ')} | ${s.notes} | $${s.nowPrice} | ${s.cumulativeReturn} |\n`;
    });
    // Use github.js to upload
    if (window.uploadToGitHub) {
        window.uploadToGitHub('portfolio.md', md);
    }
}

// Render portfolio
function updatePortfolioTable() {
    const portfolioTableBody = document.getElementById('portfolio-tbody');
    if (!portfolioTableBody) return;

    // Clear the table
    portfolioTableBody.innerHTML = '';
    
    // Sort: starred first, then by cumulative return if requested
    let sorted = [...portfolio];
    sorted.sort((a, b) => {
        if (a.star && !b.star) return -1;
        if (!a.star && b.star) return 1;
        if (sortByCumulativeReturn) {
            const aVal = parseFloat(a.cumulativeReturn) || -Infinity;
            const bVal = parseFloat(b.cumulativeReturn) || -Infinity;
            return bVal - aVal;
        }
        return 0;
    });
    
    // Filter by label if any selected
    let filtered = sorted;
    if (labelFilterSet.size > 0) {
        filtered = sorted.filter(stock => stock.labels.some(label => labelFilterSet.has(label)));
    }
    
    // Create and append rows with event listeners
    filtered.forEach(stock => {
        const tr = document.createElement('tr');
        const notesShort = stock.notes && stock.notes.length > 20 ? stock.notes.slice(0, 20) + '…' : stock.notes;
        const stockIdx = portfolio.indexOf(stock);
        
        tr.innerHTML = `
            <td style="text-align:center;"><button class="star-btn" data-idx="${stockIdx}">${stock.star ? '★' : '☆'}</button></td>
            <td style="text-align:center;">
                <div class="ticker-cell" style="cursor:pointer;" data-ticker="${stock.ticker}">
                    <div style="font-weight:bold; color:#0066cc;">${stock.ticker}</div>
                    <div style="font-size:11px; color:#666; margin-top:2px;">${stock.name || ''}</div>
                </div>
            </td>
            <td style="text-align:center;"><input type="date" value="${stock.date}" data-idx="${stockIdx}" class="edit-date" style="width:130px;"></td>
            <td style="text-align:center;">
                <div class="labels-container" data-idx="${stockIdx}" style="cursor:pointer; min-width:80px; padding:4px; border:1px solid transparent;">
                    ${stock.labels.map(label => `<span class="label-tag" style="display:inline-block; background:#e3f2fd; color:#1976d2; padding:2px 6px; margin:1px; border-radius:3px; font-size:11px;">${label}<span class="remove-label" data-label="${label}" style="margin-left:4px; cursor:pointer; font-weight:bold;">×</span></span>`).join('')}
                    ${stock.labels.length === 0 ? '<span class="add-label-prompt" style="color:#888;">Click to add</span>' : ''}
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
                <span class="notes-popup" data-full="${encodeURIComponent(stock.notes)}" data-idx="${stockIdx}" style="cursor:pointer; display:inline-block; min-width:80px; padding:4px; border:1px solid transparent;">${notesShort || 'Click to add'}</span>
                <input type="text" value="${stock.notes}" data-idx="${stockIdx}" class="edit-notes" style="display:none;width:120px;">
            </td>
            <td style="text-align:right;">${stock.nowPrice != null ? (stock.loading ? '...' : '$' + stock.nowPrice) : ''}</td>
            <td class="cumulative-return" style="text-align:right;">${stock.loading ? '...' : stock.cumulativeReturn}</td>
        `;
        
        // Star button event listener
        const starBtn = tr.querySelector('.star-btn');
        starBtn.addEventListener('click', async () => {
            portfolio[stockIdx].star = !portfolio[stockIdx].star;
            updatePortfolioTable();
            await savePortfolioToMarkdown();
        });
        
        // Date input event listener
        const dateInput = tr.querySelector('.edit-date');
        dateInput.addEventListener('change', async (e) => {
            const newDate = e.target.value;
            portfolio[stockIdx].date = newDate;
            
            // Re-fetch start price and cumulative return
            const ticker = portfolio[stockIdx].ticker;
            const startPrice = await fetchHistoricalPrice(ticker, newDate);
            const nowPrice = await fetchHistoricalPrice(ticker, new Date().toISOString().slice(0,10));
            portfolio[stockIdx].nowPrice = Number(nowPrice).toFixed(2);
            portfolio[stockIdx].cumulativeReturn = (startPrice && nowPrice) ? 
                ((nowPrice - startPrice) / startPrice * 100).toFixed(2) : '';
                
            updatePortfolioTable();
            await savePortfolioToMarkdown();
        });
        
        // Label management
        const labelsContainer = tr.querySelector('.labels-container');
        const labelPopup = tr.querySelector('.label-popup');
        const labelInput = tr.querySelector('.label-input');
        const addLabelBtn = tr.querySelector('.add-label-btn');
        const addLabelPrompt = tr.querySelector('.add-label-prompt');
        const confirmBtn = tr.querySelector('.add-label-confirm');
        const cancelBtn = tr.querySelector('.cancel-label');
        
        // Show popup when clicking container or + button
        const showLabelPopup = (e) => {
            e.stopPropagation();
            const rect = labelsContainer.getBoundingClientRect();
            labelPopup.style.display = 'block';
            labelPopup.style.position = 'absolute';
            labelPopup.style.left = (rect.left + window.scrollX) + 'px';
            labelPopup.style.top = (rect.bottom + window.scrollY + 2) + 'px';
            labelInput.focus();
        };
        
        if (addLabelPrompt) addLabelPrompt.addEventListener('click', showLabelPopup);
        addLabelBtn.addEventListener('click', showLabelPopup);
        
        // Hide popup when clicking outside
        document.addEventListener('click', (e) => {
            if (!labelPopup.contains(e.target) && !labelsContainer.contains(e.target)) {
                labelPopup.style.display = 'none';
                labelInput.value = '';
            }
        });
        
        // Add label
        const addLabel = async () => {
            const newLabel = labelInput.value.trim();
            if (newLabel && !portfolio[stockIdx].labels.includes(newLabel)) {
                portfolio[stockIdx].labels.push(newLabel);
                updatePortfolioTable();
                await savePortfolioToMarkdown();
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
            removeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const labelToRemove = removeBtn.getAttribute('data-label');
                portfolio[stockIdx].labels = portfolio[stockIdx].labels.filter(l => l !== labelToRemove);
                updatePortfolioTable();
                await savePortfolioToMarkdown();
            });
        });
        
        // Notes editing with popup
        const notesSpan = tr.querySelector('.notes-popup');
        const notesInput = tr.querySelector('.edit-notes');


        notesSpan.addEventListener('click', () => {
            notesSpan.style.display = 'none';
            notesInput.style.display = 'inline-block';
            notesInput.focus();
            notesInput.select();
        });
        
        notesInput.addEventListener('blur', async () => {
            portfolio[stockIdx].notes = notesInput.value;
            notesSpan.style.display = 'inline-block';
            notesInput.style.display = 'none';
            updatePortfolioTable();
            await savePortfolioToMarkdown();
        });
        
        notesInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                notesInput.blur();
            }
            if (e.key === 'Escape') {
                notesInput.value = stock.notes;
                notesInput.blur();
            }
        });
        
        // Ticker click to open Yahoo Finance
        const tickerCell = tr.querySelector('.ticker-cell');
        tickerCell.addEventListener('click', () => {
            window.open(`https://finance.yahoo.com/quote/${stock.ticker}`, '_blank');
        });
        
        portfolioTableBody.appendChild(tr);
    });
}

// Initialize everything after DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
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
    stockInput.addEventListener('change', async (e) => {
        const ticker = stockInput.value.trim().toUpperCase();
        if (!ticker) {
            return;
        }
        
        // Clear input immediately for better UX
        stockInput.value = '';
        
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
            star: false,
            loading: true
        };
        portfolio.push(stock);
        updatePortfolioTable();
        
        // Then fetch prices asynchronously
        try {
            const startPrice = await fetchHistoricalPrice(ticker, date);
            const nowPrice = await fetchHistoricalPrice(ticker, new Date().toISOString().slice(0,10));
            
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
                portfolio[stockIndex].loading = false;
                updatePortfolioTable();
                await savePortfolioToMarkdown();
            }
        } catch (error) {
            // Find the stock and mark as error
            const stockIndex = portfolio.findIndex(s => s.ticker === ticker && s.loading);
            if (stockIndex !== -1) {
                portfolio[stockIndex].nowPrice = 'Error';
                portfolio[stockIndex].cumulativeReturn = 'Error';
                portfolio[stockIndex].loading = false;
                updatePortfolioTable();
            }
        }
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
    
    // Add sort event listener
    const sortHeader = document.getElementById('sort-cumret');
    if (sortHeader) {
        sortHeader.addEventListener('click', () => {
            sortByCumulativeReturn = !sortByCumulativeReturn;
            updatePortfolioTable();
        });
    }

    // Initial render of portfolio
    updatePortfolioTable();
});
