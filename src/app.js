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

// DOM Elements
const stockInput = document.getElementById('stock-input');
const stockForm = document.getElementById('stock-form');
const portfolioTableBody = document.getElementById('portfolio-tbody');
const filterInput = document.getElementById('filter-input');


let portfolio = [];
let sortByCumulativeReturn = false;
let labelFilterSet = new Set();

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
stockForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ticker = stockInput.value.trim().toUpperCase();
    // Only ticker is entered, set default values for others
    if (!ticker) {
        alert('Ticker is required.');
        return;
    }
    // Validate ticker exists on Yahoo
    const suggestions = await fetchTickerSuggestions(ticker);
    if (!suggestions.some(s => s.symbol.toUpperCase() === ticker)) {
        alert('Ticker not found on Yahoo Finance.');
        return;
    }
    // Set default start date to today, label and notes empty
    const date = new Date().toISOString().slice(0,10);
    const label = '';
    const notes = '';
    const startPrice = await fetchHistoricalPrice(ticker, date);
    const nowPrice = await fetchHistoricalPrice(ticker, new Date().toISOString().slice(0,10));
    if (startPrice == null || nowPrice == null) {
        alert('Could not fetch price data.');
        return;
    }
    const cumulativeReturn = ((nowPrice - startPrice) / startPrice * 100).toFixed(2);
    const stock = {ticker, date, label, notes, nowPrice: Number(nowPrice).toFixed(2), cumulativeReturn, star: false};
    portfolio.push(stock);
    updatePortfolioTable();
    await savePortfolioToMarkdown();
    stockForm.reset();
});

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

// Render portfolio
function updatePortfolioTable() {
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
        filtered = sorted.filter(stock => labelFilterSet.has(stock.label));
    }
    filtered.forEach((stock, idx) => {
        const tr = document.createElement('tr');
        const notesShort = stock.notes && stock.notes.length > 20 ? stock.notes.slice(0, 20) + '…' : stock.notes;
        tr.innerHTML = `
            <td style="text-align:center;"><button class="star-btn" data-idx="${portfolio.indexOf(stock)}">${stock.star ? '★' : '☆'}</button></td>
            <td style="text-align:center;">${stock.ticker}</td>
            <td style="text-align:center;"><input type="date" value="${stock.date}" data-idx="${portfolio.indexOf(stock)}" class="edit-date" style="width:130px;"></td>
            <td style="text-align:center;">
                <span class="label-value">${stock.label}</span>
                <input type="text" value="${stock.label}" data-idx="${portfolio.indexOf(stock)}" class="edit-label" style="width:100px; display:none;">
            </td>
            <td style="text-align:center;">
                <span class="notes-popup" data-full="${encodeURIComponent(stock.notes)}">${notesShort}</span>
                <input type="text" value="${stock.notes}" data-idx="${portfolio.indexOf(stock)}" class="edit-notes" style="display:none;width:120px;">
            </td>
            <td style="text-align:right;">${stock.nowPrice != null ? '$' + stock.nowPrice : ''}</td>
            <td class="cumulative-return" style="text-align:right;">${stock.cumulativeReturn}</td>
            <td style="text-align:center;"><button class="yahoo-btn" data-ticker="${stock.ticker}">Yahoo</button></td>
        `;
        portfolioTableBody.appendChild(tr);
    });
    // Star button
    document.querySelectorAll('.star-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const idx = btn.getAttribute('data-idx');
            portfolio[idx].star = !portfolio[idx].star;
            updatePortfolioTable();
            await savePortfolioToMarkdown();
        });
    });
    // Add event listeners for editing
    document.querySelectorAll('.edit-date').forEach(input => {
        input.addEventListener('change', async (e) => {
            const idx = e.target.getAttribute('data-idx');
            const newDate = e.target.value;
            portfolio[idx].date = newDate;
            // Re-fetch start price and cumulative return
            const ticker = portfolio[idx].ticker;
            const startPrice = await fetchHistoricalPrice(ticker, newDate);
            const nowPrice = await fetchHistoricalPrice(ticker, new Date().toISOString().slice(0,10));
            portfolio[idx].nowPrice = Number(nowPrice).toFixed(2);
            portfolio[idx].cumulativeReturn = (startPrice && nowPrice) ? ((nowPrice - startPrice) / startPrice * 100).toFixed(2) : '';
            updatePortfolioTable();
            await savePortfolioToMarkdown();
        });
    });
    // Label click-to-edit
    document.querySelectorAll('.label-value').forEach(span => {
        span.addEventListener('click', (e) => {
            span.style.display = 'none';
            const input = span.parentElement.querySelector('.edit-label');
            input.style.display = '';
            input.focus();
        });
    });
    document.querySelectorAll('.edit-label').forEach(input => {
        input.addEventListener('blur', async (e) => {
            const idx = e.target.getAttribute('data-idx');
            portfolio[idx].label = e.target.value;
            updatePortfolioTable();
            await savePortfolioToMarkdown();
        });
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.target.blur();
            }
        });
    });
    // Notes popup and edit
    document.querySelectorAll('.notes-popup').forEach(span => {
        span.addEventListener('mouseenter', (e) => {
            const full = decodeURIComponent(span.getAttribute('data-full'));
            const popup = document.createElement('div');
            popup.className = 'notes-tooltip';
            popup.innerText = full;
            document.body.appendChild(popup);
            const rect = span.getBoundingClientRect();
            popup.style.position = 'absolute';
            popup.style.left = (rect.left + window.scrollX) + 'px';
            popup.style.top = (rect.bottom + window.scrollY + 5) + 'px';
            popup.style.zIndex = 1000;
            popup.style.background = '#fff';
            popup.style.border = '1px solid #888';
            popup.style.padding = '8px';
            popup.style.borderRadius = '6px';
            popup.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
            popup.style.maxWidth = '300px';
            popup.style.whiteSpace = 'pre-wrap';
            span._popup = popup;
        });
        span.addEventListener('mouseleave', (e) => {
            if (span._popup) {
                document.body.removeChild(span._popup);
                span._popup = null;
            }
        });
        // Click to edit
        span.addEventListener('click', (e) => {
            span.style.display = 'none';
            const input = span.parentElement.querySelector('.edit-notes');
            input.style.display = '';
            input.focus();
        });
    });
    document.querySelectorAll('.edit-notes').forEach(input => {
        input.addEventListener('blur', async (e) => {
            const idx = e.target.getAttribute('data-idx');
            portfolio[idx].notes = e.target.value;
            updatePortfolioTable();
            await savePortfolioToMarkdown();
        });
        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.target.blur();
            }
        });
    });
    document.querySelectorAll('.yahoo-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const ticker = btn.getAttribute('data-ticker');
            window.open(`https://finance.yahoo.com/quote/${ticker}`, '_blank');
        });
    });
// Label filter dropdown logic
document.addEventListener('DOMContentLoaded', () => {
    const labelHeader = document.getElementById('label-header');
    const dropdown = document.getElementById('label-filter-dropdown');
    if (labelHeader && dropdown) {
        labelHeader.addEventListener('click', (e) => {
            // Get unique labels
            const labels = Array.from(new Set(portfolio.map(s => s.label).filter(l => l)));
            dropdown.innerHTML = '';
            labels.forEach(label => {
                const id = 'label-filter-' + label;
                const div = document.createElement('div');
                div.innerHTML = `<label><input type="checkbox" id="${id}" value="${label}" ${labelFilterSet.has(label) ? 'checked' : ''}> ${label}</label>`;
                dropdown.appendChild(div);
                div.querySelector('input').addEventListener('change', (ev) => {
                    if (ev.target.checked) labelFilterSet.add(label);
                    else labelFilterSet.delete(label);
                    updatePortfolioTable();
                });
            });
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
            e.stopPropagation();
        });
        document.body.addEventListener('click', () => {
            dropdown.style.display = 'none';
        });
        dropdown.addEventListener('click', (e) => e.stopPropagation());
    }
});
    // Star button
    document.querySelectorAll('.star-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const idx = btn.getAttribute('data-idx');
            portfolio[idx].star = !portfolio[idx].star;
            updatePortfolioTable();
            await savePortfolioToMarkdown();
        });
    });
    // Add event listeners for editing
    document.querySelectorAll('.edit-date').forEach(input => {
        input.addEventListener('change', async (e) => {
            const idx = e.target.getAttribute('data-idx');
            const newDate = e.target.value;
            portfolio[idx].date = newDate;
            // Re-fetch start price and cumulative return
            const ticker = portfolio[idx].ticker;
            const startPrice = await fetchHistoricalPrice(ticker, newDate);
            const nowPrice = await fetchHistoricalPrice(ticker, new Date().toISOString().slice(0,10));
            portfolio[idx].nowPrice = nowPrice;
            portfolio[idx].cumulativeReturn = (startPrice && nowPrice) ? ((nowPrice - startPrice) / startPrice * 100).toFixed(2) : '';
            updatePortfolioTable();
            await savePortfolioToMarkdown();
        });
    });
    document.querySelectorAll('.edit-label').forEach(input => {
        input.addEventListener('input', async (e) => {
            const idx = e.target.getAttribute('data-idx');
            portfolio[idx].label = e.target.value;
            await savePortfolioToMarkdown();
        });
    });
    document.querySelectorAll('.edit-notes').forEach(input => {
        input.addEventListener('input', async (e) => {
            const idx = e.target.getAttribute('data-idx');
            portfolio[idx].notes = e.target.value;
            await savePortfolioToMarkdown();
        });
    });
    document.querySelectorAll('.yahoo-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const ticker = btn.getAttribute('data-ticker');
            window.open(`https://finance.yahoo.com/quote/${ticker}`, '_blank');
        });
    });
}
// Add sort event listener after DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    const sortHeader = document.getElementById('sort-cumret');
    if (sortHeader) {
        sortHeader.addEventListener('click', () => {
            sortByCumulativeReturn = !sortByCumulativeReturn;
            updatePortfolioTable();
        });
    }
});

// No longer needed: openYahooFinance (iframe embedding is blocked by Yahoo)

// Filter
filterInput.addEventListener('input', () => {
    // Optionally implement filtering in the table if desired
    updatePortfolioTable();
});

// Save portfolio to markdown and upload to GitHub
async function savePortfolioToMarkdown() {
    let md = '# Portfolio\n\n';
    md += '| Ticker | Date | Label | Notes | Current Price | Return (%) |\n';
    md += '|--------|------|-------|-------|---------------|------------|\n';
    portfolio.forEach(s => {
        md += `| ${s.ticker} | ${s.date} | ${s.label} | ${s.notes} | $${s.nowPrice} | ${s.cumulativeReturn} |\n`;
    });
    // Use github.js to upload
    if (window.uploadToGitHub) {
        window.uploadToGitHub('portfolio.md', md);
    }
}