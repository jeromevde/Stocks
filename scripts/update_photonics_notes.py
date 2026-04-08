
"""
Just an UTIL script the agent can use to compute al the ratios and build the note for a given stock ticker.
This is not meant to be run by hand, but can be invoked by the agent as needed.
"""

import datetime as dt
import json
import math
import statistics
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
PORTFOLIO_PATH = ROOT / "portfolio-data.json"
PHOTONICS_LABEL = "photonics"
TODAY = dt.date.today().isoformat()


def to_float(value):
    try:
        if value is None:
            return None
        if isinstance(value, bool):
            return None
        return float(value)
    except Exception:
        return None


def fmt_pct(value, digits=2):
    v = to_float(value)
    if v is None:
        return "Unavailable: source feed missing value"
    return f"{v * 100:.{digits}f}%"


def fmt_ratio(value, digits=2):
    v = to_float(value)
    if v is None:
        return "Unavailable: source feed missing value"
    return f"{v:.{digits}f}x"


def fmt_num(value, digits=2):
    v = to_float(value)
    if v is None:
        return "Unavailable: source feed missing value"
    return f"{v:.{digits}f}"


def fmt_money(value):
    v = to_float(value)
    if v is None:
        return "Unavailable: source feed missing value"
    sign = "-" if v < 0 else ""
    v = abs(v)
    if v >= 1e12:
        return f"{sign}${v / 1e12:.2f}T"
    if v >= 1e9:
        return f"{sign}${v / 1e9:.2f}B"
    if v >= 1e6:
        return f"{sign}${v / 1e6:.2f}M"
    return f"{sign}${v:,.0f}"


def pick_series(df, candidates):
    if df is None or getattr(df, "empty", True):
        return pd.Series(dtype="float64")
    for name in candidates:
        if name in df.index:
            row = pd.to_numeric(df.loc[name], errors="coerce").dropna()
            if not row.empty:
                return row.sort_index()
    return pd.Series(dtype="float64")


def latest(series):
    if series is None or len(series) == 0:
        return None
    return to_float(series.iloc[-1])


def cagr(series):
    if series is None or len(series) < 2:
        return None
    s = series.dropna().sort_index()
    if len(s) < 2:
        return None
    start = to_float(s.iloc[0])
    end = to_float(s.iloc[-1])
    if start is None or end is None or start <= 0 or end <= 0:
        return None
    years = max((s.index[-1] - s.index[0]).days / 365.25, 1.0)
    return (end / start) ** (1.0 / years) - 1.0


def safe_div(a, b):
    a = to_float(a)
    b = to_float(b)
    if a is None or b in (None, 0):
        return None
    return a / b


def growth_trend_text(value):
    v = to_float(value)
    if v is None:
        return "Unavailable: insufficient time-series history"
    if v > 0.12:
        return "Strong uptrend"
    if v > 0.03:
        return "Moderate uptrend"
    if v > -0.03:
        return "Flat to choppy"
    return "Downtrend"


def compare_to_peer(value, peer_median, higher_is_better=True):
    v = to_float(value)
    p = to_float(peer_median)
    if v is None or p is None:
        return "—"

    if not higher_is_better:
        v, p = -v, -p

    if v > p * 1.1:
        return "Good"
    if v < p * 0.9:
        return "Bad"
    return "Okay"


def first_sentence(text):
    """Return first meaningful sentence (>= 30 chars), skipping short company-name fragments."""
    if not text:
        return "Business description unavailable from source feed."
    text = " ".join(str(text).split())
    parts = []
    for sep in [". ", "! ", "? "]:
        text = text.replace(sep, "\x00")
    parts = [p.strip() for p in text.split("\x00") if p.strip()]
    for part in parts:
        if len(part) >= 30:
            return part.rstrip(".") + "."
    # fallback: return up to first 200 chars
    return (parts[0] if parts else text[:200]) + ("..." if len(text) > 200 else "")


def get_filings_map(sec_filings):
    by_type = {}
    for f in sec_filings or []:
        ftype = (f.get("type") or "").upper()
        by_type.setdefault(ftype, []).append(f)
    for key in by_type:
        by_type[key].sort(key=lambda x: x.get("epochDate", 0), reverse=True)
    return by_type


def filing_link(filing, preferred_key=None):
    if not filing:
        return None
    exhibits = filing.get("exhibits") or {}
    if preferred_key and preferred_key in exhibits:
        return exhibits[preferred_key]
    if exhibits:
        for _, link in exhibits.items():
            if link:
                return link
    return filing.get("edgarUrl")


def build_dcf(current_price, shares_outstanding, free_cash_flow, total_debt, total_cash, revenue_cagr):
    cp = to_float(current_price)
    shares = to_float(shares_outstanding)
    fcf0 = to_float(free_cash_flow)
    debt = to_float(total_debt) or 0.0
    cash = to_float(total_cash) or 0.0

    if cp is None or shares is None or shares <= 0 or fcf0 is None or fcf0 <= 0:
        return {
            "valid": False,
            "reason": "Unavailable: positive free cash flow and shares outstanding are required for DCF"
        }

    g_base = to_float(revenue_cagr)
    if g_base is None:
        g_base = 0.06
    g_base = max(-0.05, min(0.18, g_base))

    wacc = 0.10
    tg = 0.025

    def fair_price(g, discount):
        years = 5
        pv = 0.0
        fcf_t = fcf0
        for t in range(1, years + 1):
            fcf_t = fcf_t * (1 + g)
            pv += fcf_t / ((1 + discount) ** t)
        if discount <= tg:
            return None
        terminal = fcf_t * (1 + tg) / (discount - tg)
        pv_terminal = terminal / ((1 + discount) ** years)
        enterprise = pv + pv_terminal
        equity = enterprise - max(0.0, debt - cash)
        if equity <= 0:
            return None
        return equity / shares

    base = fair_price(g_base, wacc)
    bull = fair_price(min(g_base + 0.02, 0.20), wacc - 0.01)
    bear = fair_price(max(g_base - 0.02, -0.05), wacc + 0.01)

    if base is None:
        return {
            "valid": False,
            "reason": "Unavailable: DCF produced non-positive equity value under base assumptions"
        }

    return {
        "valid": True,
        "growth": g_base,
        "wacc": wacc,
        "terminal_growth": tg,
        "base": base,
        "bull": bull,
        "bear": bear,
        "upside": safe_div(base - cp, cp),
        "margin_of_safety": safe_div(base - cp, base),
    }


def make_recommendation(dcf, roe, net_margin, debt_to_ebitda):
    if not dcf.get("valid"):
        return "Hold", "Low"

    upside = to_float(dcf.get("upside")) or 0.0
    quality = 0
    if (to_float(roe) or 0) > 0.12:
        quality += 1
    if (to_float(net_margin) or 0) > 0.1:
        quality += 1
    if (to_float(debt_to_ebitda) or 999) < 3.0:
        quality += 1

    if upside > 0.25 and quality >= 2:
        return "Buy", "High"
    if upside > 0.10:
        return "Buy", "Medium"
    if upside < -0.15:
        return "Sell", "Medium"
    return "Hold", "Medium"


def summarize_officer(info):
    officers = info.get("companyOfficers") or []
    ceo = None
    for o in officers:
        title = (o.get("title") or "").lower()
        if "chief executive" in title or title.startswith("ceo"):
            ceo = o
            break
    if not ceo and officers:
        ceo = officers[0]
    if not ceo:
        return "Unavailable: CEO data missing from source feed"

    name = ceo.get("name") or "CEO name unavailable"
    title = ceo.get("title") or "Title unavailable"
    pay = ceo.get("totalPay")
    pay_text = fmt_money(pay) if to_float(pay) is not None else "Unavailable: compensation field missing"
    return f"{name} ({title}), reported compensation {pay_text}"


def fetch_metrics(ticker):
    t = yf.Ticker(ticker)
    info = t.info or {}
    fin = t.financials
    cf = t.cashflow
    bs = t.balance_sheet
    qfin = t.quarterly_financials

    hist_5y = t.history(period="5y", interval="1mo", auto_adjust=False)
    hist_6m = t.history(period="6mo", interval="1d", auto_adjust=False)

    rev_series = pick_series(fin, ["Total Revenue", "Operating Revenue"])
    fcf_series = pick_series(cf, ["Free Cash Flow"])
    if len(fcf_series) == 0:
        ocf_s = pick_series(cf, ["Operating Cash Flow"])
        capex_s = pick_series(cf, ["Capital Expenditure"])
        if len(ocf_s) > 0 and len(capex_s) > 0:
            aligned = ocf_s.align(capex_s, join="inner")
            fcf_series = aligned[0] + aligned[1]

    ebit_series = pick_series(fin, ["EBIT", "Operating Income"])
    interest_series = pick_series(fin, ["Interest Expense"])
    debt_series = pick_series(bs, ["Total Debt"])
    cash_series = pick_series(bs, ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"])
    assets_series = pick_series(bs, ["Total Assets"])
    equity_series = pick_series(bs, ["Stockholders Equity", "Total Equity Gross Minority Interest"])
    inventory_series = pick_series(bs, ["Inventory"])
    receivables_series = pick_series(bs, ["Accounts Receivable", "Net Receivables"])
    payables_series = pick_series(bs, ["Accounts Payable", "Payables And Accrued Expenses"])
    cor_series = pick_series(fin, ["Cost Of Revenue", "Cost Of Goods And Services Sold"])
    net_income_series = pick_series(fin, ["Net Income", "Net Income Common Stockholders"])
    sga_series = pick_series(fin, ["Selling General And Administrative", "Selling General Administrative"])
    rd_series = pick_series(fin, ["Research And Development"])
    capex_series_raw = pick_series(cf, ["Capital Expenditure"])

    qrev = pick_series(qfin, ["Total Revenue", "Operating Revenue"])
    qeps = pick_series(qfin, ["Basic EPS", "Diluted EPS"])

    price_now = to_float(info.get("currentPrice") or info.get("regularMarketPrice"))
    market_cap = to_float(info.get("marketCap"))

    free_cash_flow = to_float(info.get("freeCashflow"))
    if free_cash_flow is None:
        free_cash_flow = latest(fcf_series)

    total_debt = to_float(info.get("totalDebt"))
    if total_debt is None:
        total_debt = latest(debt_series)

    total_cash = to_float(info.get("totalCash"))
    if total_cash is None:
        total_cash = latest(cash_series)

    ebitda = to_float(info.get("ebitda"))
    if ebitda is None:
        ebitda = to_float(info.get("ebitda"))

    latest_rev = latest(rev_series)
    latest_assets = latest(assets_series)
    latest_equity = latest(equity_series)
    latest_cor = latest(cor_series)

    latest_sga = latest(sga_series)
    latest_rd = latest(rd_series)
    latest_capex_abs_raw = latest(capex_series_raw)  # typically negative in Yahoo feed

    def _pct_of_rev(val):
        v = to_float(val)
        if v is None or not latest_rev:
            return None
        return abs(v) / latest_rev

    sga_pct = _pct_of_rev(latest_sga)
    sga_abs = abs(to_float(latest_sga)) if to_float(latest_sga) is not None else None
    rd_pct = _pct_of_rev(latest_rd)
    rd_abs = abs(to_float(latest_rd)) if to_float(latest_rd) is not None else None
    capex_pct = _pct_of_rev(latest_capex_abs_raw)
    capex_abs = abs(to_float(latest_capex_abs_raw)) if to_float(latest_capex_abs_raw) is not None else None

    avg_inventory = None
    if len(inventory_series) >= 2:
        avg_inventory = (to_float(inventory_series.iloc[-1]) + to_float(inventory_series.iloc[-2])) / 2
    elif len(inventory_series) == 1:
        avg_inventory = to_float(inventory_series.iloc[-1])

    avg_receivables = None
    if len(receivables_series) >= 2:
        avg_receivables = (to_float(receivables_series.iloc[-1]) + to_float(receivables_series.iloc[-2])) / 2
    elif len(receivables_series) == 1:
        avg_receivables = to_float(receivables_series.iloc[-1])

    avg_payables = None
    if len(payables_series) >= 2:
        avg_payables = (to_float(payables_series.iloc[-1]) + to_float(payables_series.iloc[-2])) / 2
    elif len(payables_series) == 1:
        avg_payables = to_float(payables_series.iloc[-1])

    asset_turnover = safe_div(latest_rev, latest_assets)
    inventory_turnover = safe_div(latest_cor, avg_inventory)
    receivables_turnover = safe_div(latest_rev, avg_receivables)
    payables_turnover = safe_div(latest_cor, avg_payables)

    dio = safe_div(365.0, inventory_turnover) if inventory_turnover else None
    dso = safe_div(365.0, receivables_turnover) if receivables_turnover else None
    dpo = safe_div(365.0, payables_turnover) if payables_turnover else None
    ccc = None
    if dio is not None and dso is not None and dpo is not None:
        ccc = dio + dso - dpo

    interest_coverage = None
    ebit_latest = latest(ebit_series)
    interest_latest = latest(interest_series)
    if ebit_latest is not None and interest_latest not in (None, 0):
        interest_coverage = ebit_latest / abs(interest_latest)

    # ROIC: compute manually when returnOnCapital is missing
    roic_info = to_float(info.get("returnOnCapital"))
    if roic_info is None:
        # NOPAT = EBIT * (1 - effective_tax_rate)
        tax_series = pick_series(fin, ["Tax Provision", "Income Tax Expense"])
        pretax_series = pick_series(fin, ["Pretax Income", "Income Before Tax"])
        ebit_for_roic = latest(ebit_series)
        tax_val = latest(tax_series)
        pretax_val = latest(pretax_series)
        if (pretax_val or 0) > 0 and (tax_val or 0) >= 0:
            tax_rate = min(tax_val / pretax_val, 0.40)
        else:
            tax_rate = 0.21  # US statutory fallback
        if ebit_for_roic is not None and latest_equity is not None:
            nopat = ebit_for_roic * (1 - tax_rate)
            invested_capital = latest_equity + (total_debt or 0) - (total_cash or 0)
            if invested_capital and invested_capital > 0:
                roic_info = nopat / invested_capital

    debt_to_ebitda = safe_div(total_debt, ebitda)
    net_debt_to_ebitda = safe_div((total_debt or 0) - (total_cash or 0), ebitda)

    fcf_yield = safe_div(free_cash_flow, market_cap)
    trailing_pe = to_float(info.get("trailingPE"))
    earnings_yield = safe_div(1.0, trailing_pe) if trailing_pe and trailing_pe > 0 else None

    revenue_cagr = cagr(rev_series)
    fcf_cagr = cagr(fcf_series)

    price_ret_5y = None
    if hist_5y is not None and not hist_5y.empty and len(hist_5y) > 1:
        p0 = to_float(hist_5y["Close"].iloc[0])
        p1 = to_float(hist_5y["Close"].iloc[-1])
        if p0 not in (None, 0) and p1 is not None:
            price_ret_5y = p1 / p0 - 1

    ret_3m = None
    if hist_6m is not None and not hist_6m.empty and len(hist_6m) > 65:
        p0 = to_float(hist_6m["Close"].iloc[-63])
        p1 = to_float(hist_6m["Close"].iloc[-1])
        if p0 not in (None, 0) and p1 is not None:
            ret_3m = p1 / p0 - 1

    sec_filings = []
    try:
        sec_filings = t.sec_filings or []
    except Exception:
        sec_filings = []

    filings_map = get_filings_map(sec_filings)
    latest_10k = filing_link((filings_map.get("10-K") or [None])[0], preferred_key="10-K")
    latest_10q = filing_link((filings_map.get("10-Q") or [None])[0], preferred_key="10-Q")

    eight_k = filings_map.get("8-K") or []
    earnings_release = None
    for item in eight_k:
        ex99 = filing_link(item, preferred_key="EX-99.1")
        if ex99:
            earnings_release = ex99
            break
    if earnings_release is None and eight_k:
        earnings_release = filing_link(eight_k[0])

    website = info.get("website")
    transcript_link = None
    transcript_reason = "Official transcript URL unavailable from Yahoo/SEC feed"
    if website:
        transcript_link = website.rstrip("/") + "/investors"

    dcf = build_dcf(
        current_price=price_now,
        shares_outstanding=info.get("sharesOutstanding"),
        free_cash_flow=free_cash_flow,
        total_debt=total_debt,
        total_cash=total_cash,
        revenue_cagr=revenue_cagr,
    )

    # cash runway (quarters) — only meaningful when burning cash
    cash_runway_qtrs = None
    if free_cash_flow is not None and free_cash_flow < 0 and total_cash is not None and total_cash > 0:
        quarterly_burn = abs(free_cash_flow) / 4.0
        cash_runway_qtrs = total_cash / quarterly_burn

    # derived metrics for 10-ratio framework
    ev_val = None
    ev_fcf_val = None
    if market_cap is not None:
        ev_val = market_cap + (to_float(total_debt) or 0) - (to_float(total_cash) or 0)
    if ev_val is not None and ev_val > 0 and free_cash_flow not in (None, 0) and (free_cash_flow or 0) > 0:
        ev_fcf_val = ev_val / free_cash_flow

    # FCF margin — suppress when revenue is too small to be meaningful (< $5M)
    fcf_margin_val = None
    if latest_rev is not None and latest_rev >= 5_000_000:
        fcf_margin_val = safe_div(free_cash_flow, latest_rev)

    ttm_rev_growth_val = None
    if len(rev_series) >= 2:
        r_now = to_float(rev_series.iloc[-1])
        r_prev = to_float(rev_series.iloc[-2])
        if r_now is not None and r_prev not in (None, 0) and r_prev > 0:
            ttm_rev_growth_val = (r_now - r_prev) / r_prev

    return {
        "ticker": ticker,
        "name": info.get("shortName") or info.get("longName") or ticker,
        "business_summary": info.get("longBusinessSummary") or "",
        "sector": info.get("sector") or "Unavailable: sector field missing",
        "industry": info.get("industry") or "Unavailable: industry field missing",
        "website": website,
        "market_cap": market_cap,
        "price": price_now,
        "ev_val": ev_val,
        "ev_fcf": ev_fcf_val,
        "fcf_margin": fcf_margin_val,
        "ttm_rev_growth": ttm_rev_growth_val,
        "sga_pct": sga_pct,
        "sga_abs": sga_abs,
        "rd_pct": rd_pct,
        "rd_abs": rd_abs,
        "capex_pct": capex_pct,
        "capex_abs": capex_abs,
        "cash_runway_qtrs": cash_runway_qtrs,
        "ret_3m": ret_3m,
        "ret_5y": price_ret_5y,
        "gross_margin": to_float(info.get("grossMargins")),
        "gross_profit": (to_float(info.get("grossMargins")) * latest_rev)
            if (to_float(info.get("grossMargins")) is not None and latest_rev is not None)
            else None,
        "operating_margin": to_float(info.get("operatingMargins")),
        "ebitda_margin": to_float(info.get("ebitdaMargins")),
        "net_margin": to_float(info.get("profitMargins")),
        "roe": to_float(info.get("returnOnEquity")),
        "roa": to_float(info.get("returnOnAssets")),
        "roic": roic_info,
        "current_ratio": to_float(info.get("currentRatio")),
        "quick_ratio": to_float(info.get("quickRatio")),
        "asset_turnover": asset_turnover,
        "inventory_turnover": inventory_turnover,
        "receivables_turnover": receivables_turnover,
        "ccc": ccc,
        "debt_to_equity": to_float(info.get("debtToEquity")),
        "debt_to_ebitda": debt_to_ebitda,
        "interest_coverage": interest_coverage,
        "net_debt_to_ebitda": net_debt_to_ebitda,
        "revenue_cagr": revenue_cagr,
        "fcf_cagr": fcf_cagr,
        "payout_ratio": to_float(info.get("payoutRatio")),
        "buyback_yield": None,
        "trailing_pe": trailing_pe,
        "forward_pe": to_float(info.get("forwardPE")),
        "peg": to_float(info.get("pegRatio")),
        "ev_ebitda": to_float(info.get("enterpriseToEbitda")),
        "ev_sales": to_float(info.get("enterpriseToRevenue")),
        "p_fcf": safe_div(market_cap, free_cash_flow) if free_cash_flow not in (None, 0) else None,
        "price_to_book": to_float(info.get("priceToBook")),
        "fcf_yield": fcf_yield,
        "earnings_yield": earnings_yield,
        "free_cash_flow": free_cash_flow,
        "net_income": latest(net_income_series),
        "owner_earnings": None if latest(pick_series(cf, ["Operating Cash Flow"])) is None else latest(pick_series(cf, ["Operating Cash Flow"])) + (latest(pick_series(cf, ["Capital Expenditure"])) or 0),
        "total_debt": total_debt,
        "total_cash": total_cash,
        "ebitda": ebitda,
        "revenue_latest": latest_rev,
        "revenue_series": rev_series,
        "qrev": qrev,
        "qeps": qeps,
        "ceo_summary": summarize_officer(info),
        "insider_pct": to_float(info.get("heldPercentInsiders")),
        "sec_10k": latest_10k,
        "sec_10q": latest_10q,
        "earnings_release": earnings_release,
        "transcript_link": transcript_link,
        "transcript_reason": transcript_reason,
        "dcf": dcf,
    }


def build_note(m, peers, peer_medians):
    ticker = m["ticker"]
    name = m["name"]

    ev_fcf = m.get("ev_fcf")
    fcf_margin = m.get("fcf_margin")
    ttm_rev_growth = m.get("ttm_rev_growth")

    gm = to_float(m["gross_margin"]) or 0
    roic_v = to_float(m["roic"]) or 0
    roe_v = to_float(m["roe"]) or 0
    moat = (
        "Wide" if gm > 0.50 and (roic_v > 0.15 or roe_v > 0.20)
        else "Narrow" if gm > 0.25 and (roic_v > 0.08 or roe_v > 0.10)
        else "None"
    )

    def pc(key, hib=True):
        return compare_to_peer(m.get(key), peer_medians.get(key), higher_is_better=hib)

    ev_val = m.get("ev_val")
    ev_str = fmt_money(ev_val) if to_float(ev_val) is not None else "Unavailable: market cap missing"
    fcf_str = fmt_money(m.get("free_cash_flow")) if to_float(m.get("free_cash_flow")) is not None else "Unavailable: not in source feed"
    ev_fcf_ratio_str = (
        f"{to_float(ev_fcf):.1f}x"
        if to_float(ev_fcf) is not None and to_float(ev_fcf) > 0
        else "n/a"
    )
    ev_fcf_str = f"EV {ev_str} / FCF {fcf_str} = {ev_fcf_ratio_str}"
    ev_fcf_peer = compare_to_peer(ev_fcf, peer_medians.get("ev_fcf"), higher_is_better=False)
    insider_str = fmt_pct(m["insider_pct"]) if to_float(m["insider_pct"]) is not None else "Unavailable: not in source feed"

    gp = to_float(m.get("gross_profit"))
    rev = to_float(m.get("revenue_latest"))
    if gp is not None and rev is not None:
        gross_margin_str = f"Gross Profit {fmt_money(gp)} / Revenue {fmt_money(rev)} = {fmt_pct(m['gross_margin'])}"
    else:
        gross_margin_str = fmt_pct(m["gross_margin"])

    # ROIC → ROA → ROE fallback
    roic_v = to_float(m.get("roic"))
    roa_v = to_float(m.get("roa"))
    roe_v = to_float(m.get("roe"))
    if roic_v is not None:
        quality_label = "ROIC"
        quality_str = fmt_pct(roic_v)
        quality_peer = pc("roic")
    elif roa_v is not None:
        quality_label = "ROA (ROIC unavail.)"
        quality_str = fmt_pct(roa_v)
        quality_peer = pc("roa")
    elif roe_v is not None:
        quality_label = "ROE (ROIC/ROA unavail.)"
        quality_str = fmt_pct(roe_v)
        quality_peer = pc("roe")
    else:
        quality_label = "ROIC"
        quality_str = "Unavailable: no return metric in source feed"
        quality_peer = "—"

    # Cost structure
    def _cost_item(label, abs_val, pct_val):
        if abs_val is not None and pct_val is not None:
            return f"{label} {fmt_money(abs_val)} ({fmt_pct(pct_val)} of rev)"
        return f"{label} Unavailable"

    cost_str = " | ".join([
        _cost_item("SG&A", m.get("sga_abs"), m.get("sga_pct")),
        _cost_item("R&D", m.get("rd_abs"), m.get("rd_pct")),
        _cost_item("CapEx", m.get("capex_abs"), m.get("capex_pct")),
    ])

    # P/E
    pe_v = to_float(m.get("trailing_pe"))
    fpe_v = to_float(m.get("forward_pe"))
    pe_str = f"{pe_v:.1f}x" if pe_v is not None and pe_v > 0 else "n/a"
    fpe_str = f"{fpe_v:.1f}x" if fpe_v is not None and fpe_v > 0 else "n/a"
    pe_line = f"Trailing P/E {pe_str} | Forward P/E {fpe_str}"

    # Current ratio (profitable) or cash runway (burning cash)
    is_profitable = (to_float(m.get("net_income")) or 0) > 0 or (to_float(m.get("free_cash_flow")) or 0) > 0
    if is_profitable:
        cr_v = to_float(m.get("current_ratio"))
        liquidity_label = "Current Ratio"
        liquidity_str = fmt_ratio(cr_v) if cr_v is not None else "Unavailable: not in source feed"
    else:
        runway = to_float(m.get("cash_runway_qtrs"))
        liquidity_label = "Cash Runway"
        if runway is not None:
            qburn = abs(to_float(m.get("free_cash_flow")) or 0) / 4
            liquidity_str = f"{runway:.1f} qtrs ({fmt_money(m.get('total_cash'))} cash, ~{fmt_money(qburn)}/qtr burn)"
        else:
            liquidity_str = f"Unavailable | Cash on hand: {fmt_money(m.get('total_cash'))}"

    dcf = m["dcf"]
    if dcf.get("valid"):
        valuation_line = (
            f"DCF fair value ${dcf['base']:.2f} (upside {fmt_pct(dcf['upside'])}); "
            f"bull ${dcf['bull']:.2f} / bear ${dcf['bear']:.2f}. "
            f"Assumptions: FCF growth {fmt_pct(dcf['growth'])}, WACC {fmt_pct(dcf['wacc'])}, terminal growth {fmt_pct(dcf['terminal_growth'])}."
        )
        target_price = f"${dcf['base']:.2f}"
        upside_text = fmt_pct(dcf.get("upside"))
        margin_of_safety = fmt_pct(dcf.get("margin_of_safety"))
    else:
        valuation_line = dcf.get("reason") or "Unavailable"
        target_price = "Unavailable"
        upside_text = "Unavailable"
        margin_of_safety = "Unavailable"

    rec, conviction = make_recommendation(dcf, m["roe"], m["net_margin"], m["debt_to_ebitda"])
    peers_text = ", ".join(peers)

    note = f"""Analysis date: {TODAY}

**{name} ({ticker})** | Moat: {moat} | Sector: {m["sector"]} | Market Cap: {fmt_money(m["market_cap"])} | Price: {fmt_money(m["price"])}

| # | Ratio | Value | Good/Bad/Okay |
|---|-------|-------|---------------|
| 1 | {quality_label} | {quality_str} | {quality_peer} |
| 2 | Gross Margin | {gross_margin_str} | {pc("gross_margin")} |
| 3 | FCF Margin | {fmt_pct(fcf_margin)} | {pc("fcf_margin")} |
| 4 | Revenue CAGR (5yr) | {fmt_pct(m["revenue_cagr"])} | {pc("revenue_cagr")} |
| 5 | EV/FCF | {ev_fcf_str} | {ev_fcf_peer} |
| 6 | Net Debt / EBITDA | {fmt_ratio(m["net_debt_to_ebitda"])} | {pc("net_debt_to_ebitda", hib=False)} |
| 7 | FCF Yield | {fmt_pct(m["fcf_yield"])} | {pc("fcf_yield")} |
| 8 | Operating Margin | {fmt_pct(m["operating_margin"])} | {pc("operating_margin")} |
| 9 | Insider Ownership | {insider_str} | {"Good" if (to_float(m["insider_pct"]) or 0) > 0.20 else "Okay" if (to_float(m["insider_pct"]) or 0) >= 0.10 else "Bad"} |
| 10 | Revenue Growth (TTM) | {fmt_pct(ttm_rev_growth)} | {pc("ttm_rev_growth")} |

Cost: {cost_str} | {pe_line} | {liquidity_label}: {liquidity_str}

Peers: {peers_text}

**Company**
{m["business_summary"][:600].strip()}

**Top 3 Risks**
- AI optics demand cycle pause and telecom capex slowdown.
- Pricing erosion from competing vendors in commoditized segments.
- Customer concentration and inventory digestion headwinds.
"""
    return note


def _old_build_note(m, peers, peer_medians):
    ticker = m["ticker"]
    name = m["name"]

    gm_peer = compare_to_peer(m["gross_margin"], peer_medians.get("gross_margin"))
    nm_peer = compare_to_peer(m["net_margin"], peer_medians.get("net_margin"))
    roe_peer = compare_to_peer(m["roe"], peer_medians.get("roe"))
    lev_peer = compare_to_peer(m["debt_to_ebitda"], peer_medians.get("debt_to_ebitda"), higher_is_better=False)
    val_peer = compare_to_peer(m["ev_ebitda"], peer_medians.get("ev_ebitda"), higher_is_better=False)

    dcf = m["dcf"]
    if dcf.get("valid"):
        dcf_line = (
            f"Base DCF fair value ${dcf['base']:.2f} (upside/downside {fmt_pct(dcf['upside'])}); "
            f"Bull ${dcf['bull']:.2f} / Bear ${dcf['bear']:.2f}; "
            f"assumptions: FCF growth {fmt_pct(dcf['growth'])}, WACC {fmt_pct(dcf['wacc'])}, terminal growth {fmt_pct(dcf['terminal_growth'])}."
        )
        margin_of_safety = fmt_pct(dcf.get("margin_of_safety"))
        target_price = f"${dcf['base']:.2f}"
        upside_text = fmt_pct(dcf.get("upside"))
    else:
        dcf_line = dcf.get("reason")
        margin_of_safety = "Unavailable: DCF not valid"
        target_price = "Unavailable: DCF not valid"
        upside_text = "Unavailable: DCF not valid"

    rec, conviction = make_recommendation(dcf, m["roe"], m["net_margin"], m["debt_to_ebitda"])

    fcf_ni_gap = None
    if m["free_cash_flow"] is not None and m["net_income"] not in (None, 0):
        fcf_ni_gap = (m["free_cash_flow"] - m["net_income"]) / abs(m["net_income"])

    dupont_pm = m["net_margin"]
    dupont_at = m["asset_turnover"]
    assets = None
    equity = None
    if len(m["revenue_series"]) > 0:
        pass

    sec_10k = m["sec_10k"] or "Unavailable: no 10-K link in source feed (common for non-U.S. issuer)"
    sec_10q = m["sec_10q"] or "Unavailable: no 10-Q link in source feed (common for non-U.S. issuer)"
    earnings_release = m["earnings_release"] or "Unavailable: latest earnings release URL not present in source feed"
    transcript = m["transcript_link"] or f"Unavailable: {m['transcript_reason']}"

    peers_text = ", ".join(peers)

    qrev = m["qrev"]
    qeps = m["qeps"]
    qrev_line = "Unavailable: quarterly revenue series missing"
    if len(qrev) >= 2:
        vals = [to_float(v) for v in qrev.dropna().sort_index().tail(4)]
        vals = [v for v in vals if v is not None]
        if vals:
            qrev_line = " / ".join(fmt_money(v) for v in vals)
    qeps_line = "Unavailable: quarterly EPS series missing"
    if len(qeps) >= 2:
        vals = [to_float(v) for v in qeps.dropna().sort_index().tail(4)]
        vals = [v for v in vals if v is not None]
        if vals:
            qeps_line = " / ".join(f"{v:.2f}" for v in vals)

    note = f"""Analysis date: {TODAY}

1) Business & Moat Overview
- One-sentence business model: {first_sentence(m['business_summary'])}
- Sector/industry: {m['sector']} / {m['industry']}.
- Moat rating: {'Wide' if (to_float(m['gross_margin']) or 0) > 0.5 and (to_float(m['roe']) or 0) > 0.2 else ('Narrow' if (to_float(m['gross_margin']) or 0) > 0.25 else 'None')}.
- Porter snapshot: supplier power is elevated in semicap cycles; customer power is high for hyperscaler/OEM buyers; rivalry remains intense across optics and mixed-signal peers.

2) Macro & Industry Context
- Tailwinds: AI datacenter optical interconnect demand, 800G/1.6T transition, and enterprise networking refresh.
- Headwinds: inventory digestion, telecom capex cyclicality, and pricing pressure in commoditized components.
- Position vs peers ({peers_text}): profitability {gm_peer}; leverage {lev_peer}; valuation {val_peer}.

3) Earnings Deep Dive (latest + trend)
- Last reported quarterly revenue sequence (oldest to latest available): {qrev_line}.
- Last reported quarterly EPS sequence (oldest to latest available): {qeps_line}.
- 5Y trend: revenue CAGR {fmt_pct(m['revenue_cagr'])}; FCF CAGR {fmt_pct(m['fcf_cagr'])}; 5Y price return {fmt_pct(m['ret_5y'])}.
- Earnings quality: FCF vs net income gap {fmt_pct(fcf_ni_gap)}; owner earnings proxy {fmt_money(m['owner_earnings'])}.

4) Full Financial Statement Analysis
- Income statement margins: gross {fmt_pct(m['gross_margin'])}, operating {fmt_pct(m['operating_margin'])}, EBITDA {fmt_pct(m['ebitda_margin'])}, net {fmt_pct(m['net_margin'])}.
- Balance sheet health: cash {fmt_money(m['total_cash'])}, debt {fmt_money(m['total_debt'])}, debt/EBITDA {fmt_ratio(m['debt_to_ebitda'])}, net debt/EBITDA {fmt_ratio(m['net_debt_to_ebitda'])}.
- Cash flow quality: free cash flow {fmt_money(m['free_cash_flow'])}, FCF yield {fmt_pct(m['fcf_yield'])}, owner earnings proxy {fmt_money(m['owner_earnings'])}.

5) Comprehensive Ratio Analysis & Trends
- Profitability: ROE {fmt_pct(m['roe'])} ({roe_peer}); ROA {fmt_pct(m['roa'])}; ROIC {fmt_pct(m['roic'])}; net margin {fmt_pct(m['net_margin'])} ({nm_peer}).
- Liquidity & efficiency: current ratio {fmt_ratio(m['current_ratio'])}, quick ratio {fmt_ratio(m['quick_ratio'])}, asset turnover {fmt_ratio(m['asset_turnover'])}, inventory turnover {fmt_ratio(m['inventory_turnover'])}, receivables turnover {fmt_ratio(m['receivables_turnover'])}, cash conversion cycle {fmt_num(m['ccc']) if to_float(m['ccc']) is not None else 'Unavailable: inventory/receivables/payables detail missing'} days.
- Solvency: debt/equity {fmt_num(m['debt_to_equity']) if to_float(m['debt_to_equity']) is not None else 'Unavailable: source feed missing value'}, debt/EBITDA {fmt_ratio(m['debt_to_ebitda'])}, interest coverage {fmt_ratio(m['interest_coverage'])}, net debt/EBITDA {fmt_ratio(m['net_debt_to_ebitda'])}.
- Growth & shareholder returns: revenue CAGR {fmt_pct(m['revenue_cagr'])}, FCF CAGR {fmt_pct(m['fcf_cagr'])}, dividend payout ratio {fmt_pct(m['payout_ratio'])}, buyback yield Unavailable: buyback cash flow line not reliably exposed in source feed.
- Valuation multiples: trailing P/E {fmt_num(m['trailing_pe']) if to_float(m['trailing_pe']) is not None else 'Unavailable: source feed missing value'}, forward P/E {fmt_num(m['forward_pe']) if to_float(m['forward_pe']) is not None else 'Unavailable: source feed missing value'}, PEG {fmt_num(m['peg']) if to_float(m['peg']) is not None else 'Unavailable: source feed missing value'}, EV/EBITDA {fmt_num(m['ev_ebitda']) if to_float(m['ev_ebitda']) is not None else 'Unavailable: source feed missing value'}, EV/Sales {fmt_num(m['ev_sales']) if to_float(m['ev_sales']) is not None else 'Unavailable: source feed missing value'}, P/FCF {fmt_num(m['p_fcf']) if to_float(m['p_fcf']) is not None else 'Unavailable: FCF is non-positive or missing'}, P/B {fmt_num(m['price_to_book']) if to_float(m['price_to_book']) is not None else 'Unavailable: source feed missing value'}, FCF yield {fmt_pct(m['fcf_yield'])}, earnings yield {fmt_pct(m['earnings_yield'])}.

6) Intrinsic Valuation
- {dcf_line}
- Margin of safety: {margin_of_safety}.

7) Peer Benchmarking
- Selected peers: {peers_text}.
- Relative take: gross margin {gm_peer}; ROE {roe_peer}; EV/EBITDA {val_peer}; debt/EBITDA {lev_peer}.

8) Management & Governance
- CEO snapshot: {m['ceo_summary']}.
- Insider ownership: {fmt_pct(m['insider_pct'])}.
- Capital allocation: payout ratio {fmt_pct(m['payout_ratio'])}; leverage posture via net debt/EBITDA {fmt_ratio(m['net_debt_to_ebitda'])}.
- Subjective CEO assessment: execution appears {'strong' if (to_float(m['roe']) or 0) > 0.15 and (to_float(m['operating_margin']) or 0) > 0.1 else 'mixed'} based on margin profile, cash conversion, and balance-sheet discipline in current cycle.

9) Risks, Catalysts & Scenarios
- Top risks: demand pause in AI optics, pricing erosion from competition, customer concentration, and capex cyclicality.
- Top catalysts: sustained cloud optics orders, margin expansion through mix, and improved free-cash-flow conversion.
- Bull/Base/Bear valuation (DCF): {('Bull $%.2f / Base $%.2f / Bear $%.2f' % (dcf['bull'], dcf['base'], dcf['bear'])) if dcf.get('valid') else 'Unavailable: DCF scenarios not valid with current FCF profile'}.

10) Investment Thesis & Recommendation
- Thesis: photonics exposure with measurable cycle leverage; monitor profitability and FCF discipline before multiple expansion assumptions.
- Recommendation: {rec}.
- Target price: {target_price} ({upside_text} vs current price {fmt_money(m['price'])}).
- Conviction: {conviction}.
- Margin of safety: {margin_of_safety}.

Sources
- Latest 10-K: {sec_10k}
- Most recent 10-Q: {sec_10q}
- Latest earnings press release: {earnings_release}
- Latest earnings call transcript (official source): {transcript}

STOCK ANALYSIS DASHBOARD - {ticker}

| Category | Key Metrics | Current Value | 5-Yr Trend | vs. Peers/Industry | Assessment (Strong/Good/Average/Weak/Red Flag) |
|---|---|---|---|---|---|
| Business & Moat | Moat rating + description | {'Wide' if (to_float(m['gross_margin']) or 0) > 0.5 else ('Narrow' if (to_float(m['gross_margin']) or 0) > 0.25 else 'None')} | {growth_trend_text(m['ret_5y'])} | {gm_peer} | {'Strong' if (to_float(m['gross_margin']) or 0) > 0.5 else ('Good' if (to_float(m['gross_margin']) or 0) > 0.3 else 'Average')} |
| Profitability | ROIC / Net Margin / ROE | {fmt_pct(m['roic'])} / {fmt_pct(m['net_margin'])} / {fmt_pct(m['roe'])} | {growth_trend_text(m['revenue_cagr'])} | {roe_peer} | {'Strong' if (to_float(m['roe']) or 0) > 0.2 else ('Good' if (to_float(m['roe']) or 0) > 0.12 else 'Average')} |
| Growth | Revenue CAGR / FCF CAGR | {fmt_pct(m['revenue_cagr'])} / {fmt_pct(m['fcf_cagr'])} | {growth_trend_text(m['revenue_cagr'])} | {compare_to_peer(m['revenue_cagr'], peer_medians.get('revenue_cagr'))} | {'Good' if (to_float(m['revenue_cagr']) or 0) > 0.08 else ('Average' if (to_float(m['revenue_cagr']) or 0) > 0 else 'Weak')} |
| Financial Health | Interest Coverage / Net Debt/EBITDA | {fmt_ratio(m['interest_coverage'])} / {fmt_ratio(m['net_debt_to_ebitda'])} | {growth_trend_text(m['fcf_cagr'])} | {lev_peer} | {'Strong' if (to_float(m['net_debt_to_ebitda']) or 9) < 1.5 else ('Good' if (to_float(m['net_debt_to_ebitda']) or 9) < 3 else 'Weak')} |
| Valuation | EV/EBITDA / FCF Yield / PEG | {fmt_num(m['ev_ebitda']) if to_float(m['ev_ebitda']) is not None else 'Unavailable: source feed missing value'} / {fmt_pct(m['fcf_yield'])} / {fmt_num(m['peg']) if to_float(m['peg']) is not None else 'Unavailable: source feed missing value'} | {growth_trend_text(m['ret_3m'])} | {val_peer} | {'Good' if (to_float(m['ev_ebitda']) or 999) < (to_float(peer_medians.get('ev_ebitda')) or 999) else 'Average'} |
| Earnings Quality | FCF vs NI gap + adjustments | {fmt_pct(fcf_ni_gap)} | {growth_trend_text(m['fcf_cagr'])} | {compare_to_peer(m['fcf_yield'], peer_medians.get('fcf_yield'))} | {'Good' if (to_float(fcf_ni_gap) or -9) > -0.2 else 'Average'} |
| Overall Score | (out of 10) | {round((5 + ((to_float(m['revenue_cagr']) or 0) * 10) + ((to_float(m['roe']) or 0) * 5) - max(0, (to_float(m['net_debt_to_ebitda']) or 0) - 2)), 1)} | {growth_trend_text(m['ret_5y'])} | {compare_to_peer(m['roe'], peer_medians.get('roe'))} | {'Strong' if (to_float(m['roe']) or 0) > 0.18 and (to_float(m['revenue_cagr']) or 0) > 0.08 else ('Good' if (to_float(m['roe']) or 0) > 0.1 else 'Average')} |

Final Recommendation: {rec} | Target Price: {target_price} ({upside_text}) | Conviction: {conviction} | Margin of Safety: {margin_of_safety}
"""

    return note


def main():
    data = json.loads(PORTFOLIO_PATH.read_text())
    stocks = data.get("stocks", [])

    photonics = [s for s in stocks if PHOTONICS_LABEL in s.get("labels", [])]
    photonics_tickers = [s["ticker"] for s in photonics]

    metrics = {}
    for ticker in photonics_tickers:
        try:
            metrics[ticker] = fetch_metrics(ticker)
            print(f"Fetched {ticker}")
        except Exception as exc:
            print(f"Failed {ticker}: {exc}")
            metrics[ticker] = {
                "ticker": ticker,
                "name": ticker,
                "business_summary": "",
                "sector": "Unavailable: fetch failed",
                "industry": "Unavailable: fetch failed",
                "market_cap": None,
                "price": None,
                "ret_3m": None,
                "ret_5y": None,
                "gross_margin": None,
                "gross_profit": None,
                "operating_margin": None,
                "ebitda_margin": None,
                "net_margin": None,
                "roe": None,
                "roa": None,
                "roic": None,
                "current_ratio": None,
                "quick_ratio": None,
                "asset_turnover": None,
                "inventory_turnover": None,
                "receivables_turnover": None,
                "ccc": None,
                "debt_to_equity": None,
                "debt_to_ebitda": None,
                "interest_coverage": None,
                "net_debt_to_ebitda": None,
                "revenue_cagr": None,
                "fcf_cagr": None,
                "payout_ratio": None,
                "buyback_yield": None,
                "trailing_pe": None,
                "forward_pe": None,
                "peg": None,
                "ev_ebitda": None,
                "ev_sales": None,
                "p_fcf": None,
                "price_to_book": None,
                "fcf_yield": None,
                "earnings_yield": None,
                "free_cash_flow": None,
                "net_income": None,
                "owner_earnings": None,
                "total_debt": None,
                "total_cash": None,
                "ebitda": None,
                "revenue_latest": None,
                "revenue_series": pd.Series(dtype="float64"),
                "qrev": pd.Series(dtype="float64"),
                "qeps": pd.Series(dtype="float64"),
                "ceo_summary": "Unavailable: fetch failed",
                "insider_pct": None,
                "sec_10k": None,
                "sec_10q": None,
                "earnings_release": None,
                "transcript_link": None,
                "transcript_reason": "Fetch failed",
                "dcf": {"valid": False, "reason": "Unavailable: fetch failed"},
                "ev_val": None,
                "ev_fcf": None,
                "fcf_margin": None,
                "ttm_rev_growth": None,
                "sga_pct": None,
                "sga_abs": None,
                "rd_pct": None,
                "rd_abs": None,
                "capex_pct": None,
                "capex_abs": None,
                "cash_runway_qtrs": None,
            }

    metric_names = [
        "roic",
        "gross_margin",
        "fcf_margin",
        "revenue_cagr",
        "ev_fcf",
        "net_debt_to_ebitda",
        "fcf_yield",
        "operating_margin",
        "insider_pct",
        "ttm_rev_growth",
    ]

    peer_medians = {}
    for name in metric_names:
        vals = [to_float(metrics[t].get(name)) for t in photonics_tickers]
        vals = [v for v in vals if v is not None and math.isfinite(v)]
        peer_medians[name] = statistics.median(vals) if vals else None

    market_caps = {t: to_float(metrics[t].get("market_cap")) for t in photonics_tickers}

    for stock in stocks:
        if PHOTONICS_LABEL not in stock.get("labels", []):
            continue
        ticker = stock["ticker"]
        m = metrics[ticker]

        # pick closest peers by market cap when possible
        this_cap = market_caps.get(ticker)
        candidates = [p for p in photonics_tickers if p != ticker]
        if this_cap is not None:
            candidates.sort(key=lambda p: abs((market_caps.get(p) or this_cap) - this_cap))
        peers = candidates[:4] if len(candidates) >= 4 else candidates

        stock["notes"] = build_note(m, peers, peer_medians)
        if m.get("name") and stock.get("name") in ("", None):
            stock["name"] = m["name"]

    data["updatedAt"] = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    PORTFOLIO_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"Updated {len(photonics_tickers)} photonics notes in {PORTFOLIO_PATH}")


if __name__ == "__main__":
    main()
