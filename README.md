# Stock Tracker

**Live app:** https://jeromevde.github.io/Stocks/

## Quick start

1. Open: https://jeromevde.github.io/Stocks/
2. Enable CORS (choose one):

### Firefox

1. Open [about:config](about:config)
2. Search `content.cors.disable`
3. Set to `true`
4. When done, set it back to `false`

### Chromium / Edge (separate instance)

```bash
open -n "/Applications/Google Chrome.app" --args --disable-web-security
open -n "/Applications/Microsoft Edge.app" --args --disable-web-security
```

## GitHub token

Create token: https://github.com/settings/tokens

## Portfolio storage

- Canonical portfolio data is saved in `portfolio-data.json`.
- `portfolio.html` is no longer used for persistence.

## Stock analysis framework

Notes for each stock follow a structured format defined in `src/llm-prompt.md`.
The 10 ratios that drive every analysis:

| # | Ratio | Why it matters |
|---|-------|----------------|
| 1 | ROIC (→ ROA → ROE fallback) | Best moat proxy — earns above cost of capital? |
| 2 | Gross Margin (Gross Profit / Revenue) | Pricing power; shows business scale |
| 3 | FCF Margin | Real cash per revenue dollar |
| 4 | Revenue CAGR (5yr) | Compounding engine |
| 5 | EV/FCF (EV / FCF) | What you pay for owner earnings |
| 6 | Net Debt / EBITDA | Leverage and survivability (>4x = red flag) |
| 7 | FCF Yield | Owner's return today |
| 8 | Operating Margin | Scalability |
| 9 | Insider Ownership | Skin in the game |
| 10 | Revenue Growth (TTM) | Momentum now |

Each note also includes:
- **Cost structure**: SG&A, R&D, and CapEx as % of revenue
- **Multiples**: Trailing P/E and Forward P/E
- **Liquidity**: Current Ratio (if profitable) or Cash Runway in quarters (if burning cash)
- **Valuation**: 2-stage DCF with bull/base/bear scenarios

To regenerate photonics notes: `conda run -n almicm python scripts/update_photonics_notes.py`
