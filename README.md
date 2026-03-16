# 📈 Stock Tracker

A clean, fast stock portfolio tracker with lazy loading.

## Features

- ✨ **Super fast** - Lazy loading loads prices only when visible
- 🚀 **No backend** - Direct Yahoo Finance API calls
- 💾 **Local storage** - Your data stays on your device
- 🎯 **Simple** - Just tickers, dates, and returns

## Setup

1. **Install a CORS extension** (required for Yahoo Finance API):
   - Chrome: [Allow CORS](https://chrome.google.com/webstore/detail/allow-cors-access-control/lhobafahddgcelffkeicbaginigeejlf)
   - Firefox: [CORS Everywhere](https://addons.mozilla.org/en-US/firefox/addon/cors-everywhere/)

2. **Open `src/index.html`** in your browser

3. **Add stocks**:
   - Enter ticker (e.g., AAPL)
   - Select discovery date
   - Click "Add Stock"

## How It Works

- **Lazy Loading**: Stock prices only load when rows scroll into view
- **Caching**: Prices cached for 3 minutes to reduce API calls
- **Local Storage**: Click "Save" to persist, "Load" to restore

## Tech

- Pure vanilla JavaScript
- Yahoo Finance API (free, no key needed)
- Intersection Observer for lazy loading
- LocalStorage for persistence

---

**Note**: This requires a CORS-allowing browser extension since Yahoo Finance doesn't allow direct browser calls. The extension is only needed when viewing the page - no server/proxy required.
