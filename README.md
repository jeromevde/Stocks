

# Stock Tracker

![](example.png)

A full HTML/JavaScript stock tracker that uses the Eulerpool Data API (free tier) for fast batch price lookups. Manage your portfolio with date-based cumulative return calculations, customizable labels for filtering, personal notes for each stock, clickable tickers that open Yahoo Finance, and GitHub integration for portfolio persistence.

## How to use
1. **Fork** this repo
2. Activate **GitHub Pages** deployment from GitHub Actions in the repo settings (the workflow deploys every branch: `main` to `/`, other branches to `/{branch}`)
3. Use the small tiles in the top-right of the app to add your GitHub token and Eulerpool API key (stored locally)

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

### Eulerpool Data API
- Uses Eulerpool Data API (free tier) for batch quotes and 3M returns
- Enter your API key via the **Eulerpool** tile (top-right); the key is kept in cookies only
- Batch fetching speeds up portfolio loads; individual add/edit flows reuse the same data
