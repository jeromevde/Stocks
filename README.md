

# Stock Tracker

![](example.png)

A full HTML/JavaScript stock tracker that uses the Twelve Data API for fast batch price lookups. Manage your portfolio with date-based cumulative return calculations, customizable labels for filtering, personal notes for each stock, clickable tickers that open TradingView charts, and GitHub integration for portfolio persistence.

## How to use
1. **Fork** this repo
2. Activate **GitHub Pages** deployment from GitHub Actions in the repo settings (the workflow deploys every branch: `main` to `/`, other branches to `/{branch}`)
3. Use the small tiles in the top-right of the app to add your GitHub token and Twelve Data API key (stored in cookie only)

## Development & Testing

### DEV Environment
GitHub Pages now deploys every branch automatically:
- **Production**: `main` branch publishes to the site root
- **Previews**: any other branch publishes under `/branch-name`

### Local testing

```
npx live-server src --port=8080 
```

## API Features

### Twelve Data API
- Uses [Twelve Data](https://twelvedata.com) for batch quotes and 3M returns (up to 120 symbols per call)
- Enter your API key via the **Twelve Data** tile (top-right); the key is kept in a cookie only
- Batch fetching speeds up portfolio loads; ticker search uses the `symbol_search` endpoint
