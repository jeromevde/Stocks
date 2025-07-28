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
            <td style="text-align:center;">${stock.ticker}</td>
            <td style="text-align:center;"><input type="date" value="${stock.date}" data-idx="${stockIdx}" class="edit-date" style="width:130px;"></td>
            <td style="text-align:center;">
                <span class="label-value" data-idx="${stockIdx}" style="cursor:pointer; display:inline-block; min-width:80px; padding:4px; border:1px solid transparent;">${stock.labels.join(', ') || 'Click to add'}</span>
                <input type="text" value="${stock.labels.join(', ')}" data-idx="${stockIdx}" class="edit-label" style="width:100px; display:none;">
            </td>
            <td style="text-align:center;">
                <span class="notes-popup" data-full="${encodeURIComponent(stock.notes)}" data-idx="${stockIdx}" style="cursor:pointer; display:inline-block; min-width:80px; padding:4px; border:1px solid transparent;">${notesShort || 'Click to add'}</span>
                <input type="text" value="${stock.notes}" data-idx="${stockIdx}" class="edit-notes" style="display:none;width:120px;">
            </td>
            <td style="text-align:right;">${stock.nowPrice != null ? '$' + stock.nowPrice : ''}</td>
            <td class="cumulative-return" style="text-align:right;">${stock.cumulativeReturn}</td>
            <td style="text-align:center;"><button class="yahoo-btn" data-ticker="${stock.ticker}">Yahoo</button></td>
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
        
        // Label editing
        const labelSpan = tr.querySelector('.label-value');
        const labelInput = tr.querySelector('.edit-label');
        
        labelSpan.addEventListener('click', () => {
            labelSpan.style.display = 'none';
            labelInput.style.display = 'inline-block';
            labelInput.focus();
            labelInput.select();
        });
        
        labelInput.addEventListener('blur', async () => {
            portfolio[stockIdx].labels = labelInput.value.split(',').map(s => s.trim()).filter(Boolean);
            labelSpan.style.display = 'inline-block';
            labelInput.style.display = 'none';
            updatePortfolioTable();
            await savePortfolioToMarkdown();
        });
        
        labelInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                labelInput.blur();
            }
            if (e.key === 'Escape') {
                labelInput.value = stock.labels.join(', ');
                labelInput.blur();
            }
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
        
        // Yahoo button
        const yahooBtn = tr.querySelector('.yahoo-btn');
        yahooBtn.addEventListener('click', () => {
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
        // Validate ticker exists on Yahoo before adding
        const suggestions = await fetchTickerSuggestions(ticker);
        if (!suggestions.some(s => s.symbol.toUpperCase() === ticker)) {
            return; // Do nothing if not a valid ticker
        }
        
        const date = new Date().toISOString().slice(0,10);
        const startPrice = await fetchHistoricalPrice(ticker, date);
        const nowPrice = await fetchHistoricalPrice(ticker, new Date().toISOString().slice(0,10));
        if (startPrice == null || nowPrice == null) {
            alert('Could not fetch price data for the selected date.');
            return;
        }
        const cumulativeReturn = ((nowPrice - startPrice) / startPrice * 100).toFixed(2);
        const stock = {
            ticker, 
            date, 
            labels: [], 
            notes: '',
            nowPrice: Number(nowPrice).toFixed(2),
            cumulativeReturn, 
            star: false
        };
        portfolio.push(stock);
        updatePortfolioTable();
        await savePortfolioToMarkdown();
        stockInput.value = ''; // Clear input after adding
    });
    
    // Label filter dropdown logic
    const labelHeader = document.getElementById('label-header');
    const dropdown = document.getElementById('label-filter-dropdown');
    
    if (labelHeader && dropdown) {
        labelHeader.addEventListener('click', (e) => {
            // Get unique labels
            const labels = Array.from(new Set(portfolio.flatMap(s => s.labels).filter(l => l)));
            
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
