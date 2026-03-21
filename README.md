# Stock Tracker

Track your stock portfolio with ratings, notes, labels, and private notes backed up to your own GitHub repo.

**Live app:** https://jeromevde.github.io/Stocks/

---

## Quick start

1. Open the app: https://jeromevde.github.io/Stocks/
2. Enable CORS for Yahoo Finance requests (one-time browser setup)
3. (Optional) Connect GitHub to save/load your portfolio

---

## CORS setup (required)

The app calls Yahoo Finance directly from your browser. Yahoo blocks normal cross-origin browser requests, so you need to temporarily allow them in your browser.

### Recommended: Firefox

1. Open `about:config` in Firefox (click: [about:config](about:config))
2. Search for `content.cors.disable`
3. Set it to `true`
4. Use the Stock Tracker app
5. **Important:** switch it back to `false` when done

### Alternative: Chromium/Edge launch flag

You can launch a separate browser instance with web security disabled:

```bash
open -n "/Applications/Microsoft Edge.app" --args --disable-web-security
```

Use this only for local/trusted browsing sessions.

### Alternative: extensions

- Chrome: [Allow CORS](https://chrome.google.com/webstore/detail/allow-cors-access-control/lhobafahddgcelffkeicbaginigeejlf)
- Firefox: [CORS Everywhere](https://addons.mozilla.org/en-US/firefox/addon/cors-everywhere/)

---

## GitHub backup (optional)

Use GitHub backup if you want your portfolio JSON persisted in your own repository.

### 1) Create a personal access token

Create it here: https://github.com/settings/tokens

Classic token scopes needed:

- `repo` (private repos) **or** `public_repo` (public-only)

### 2) Connect in the app

1. Click the **GitHub** tile
2. Paste your token
3. Save/load portfolio state

### Security notes

- Prefer a dedicated token for this app
- Store it like a password
- Revoke it anytime from GitHub settings

---

## Features

- 📊 Stock tracking with discovery dates
- ⭐ 5-star rating system
- 🏷️ Custom labels (AI, robotics, energy, ...)
- 📝 Rich notes with markdown + media links
- 📈 TradingView charts
- 💾 GitHub backup
- 🚀 Direct Yahoo Finance API

## Tech stack

- Vanilla JavaScript
- Yahoo Finance API
- GitHub API (backup)
- TradingView embeds
