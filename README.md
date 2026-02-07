

# Stock Tracker

![](example.png)

A full HTML/JavaScript stock tracker that allows you to search Yahoo Finance stocks and manage your portfolio with date-based cumulative return calculations, customizable labels for filtering, personal notes for each stock, clickable tickers that open Yahoo Finance, GitHub integration for portfolio persistence

## How to use
1. **Fork** this repo
2. Activate **github pages** deployment from github actions in the repo settings

## Development & Testing

### DEV Environment
This repository has a `dev` branch that automatically deploys to a separate GitHub Pages environment for testing:
- **Production**: Deploys from `main` branch
- **Development**: Deploys from `dev` branch to test changes before merging

To set up the DEV environment:
1. Create a `dev` branch: `git checkout -b dev`
2. Push to GitHub: `git push -u origin dev`
3. In GitHub Settings → Pages:
   - You may need to configure a separate deployment for the `dev` branch
   - Or use GitHub Environments to create a `github-pages-dev` environment
4. The DEV workflow (`.github/workflows/deploy-dev.yml`) will automatically deploy changes

### Local testing

```
npx live-server src --port=8080 
```

## API Features

### Hybrid Yahoo Finance Integration with Puter.js
The app uses a smart multi-layered approach to fetch stock data, ensuring maximum reliability:
1. **Direct API access first** - Tries Yahoo Finance API directly (when the host allows CORS)
2. **Puter.js pFetch** - Uses Puter's network infrastructure to bypass CORS restrictions (no proxy needed!)
3. **Batch fetching** - Can fetch multiple stocks in parallel with staggered delays

**Why Puter.js?**
- 🚀 Fast and reliable CORS bypass using WISP protocol
- 🔒 Secure network tunneling through Puter's infrastructure
- 🆓 Free to use with no rate limits
- 🎯 Works consistently across all browsers
- ⚡ No need to depend on third-party CORS proxies

### Batch API Functions
For improved performance when loading portfolios:
- `YahooFinance.fetchBatchCurrentPrices(tickers)` - Fetch prices for multiple tickers at once
- `YahooFinance.fetchBatch3MonthReturns(tickers)` - Fetch 3M returns for multiple tickers

Example:
```javascript
const tickers = ['AAPL', 'MSFT', 'GOOGL'];
const prices = await YahooFinance.fetchBatchCurrentPrices(tickers);
// { 'AAPL': 150.25, 'MSFT': 310.50, 'GOOGL': 125.75 }
```

