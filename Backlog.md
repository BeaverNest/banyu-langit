# 🌊 Banyu Langit — Feature Backlog
# Per 12 Maret 2026

---

## Konteks Singkat

Banyu Langit = **personal analytics platform saham IDX**, semacam Bloomberg Terminal mini. Self-hosted Docker, localhost:3003. Solo developer (Aldiansyah). Stack: Node.js + Express + SQLite + vanilla JS.

Data masuk dari **BEI XLSX files** (manual upload). Sudah temukan **IDX API** (NeaByteLab/IDX-API) yang bisa automate semua — belum diimplementasi, target Sprint 7.

Arah: **reverse-engineer AmiBroker** → semua trading analysis self-hosted, zero dependency.

---

## ✅ Done (72 items, 6 Sprint)

### Data Layer
- IDX Daily OHLCV + foreign flow (~1156 hari, 2021-2026)
- Index Summary 45 indeks BEI (tabel `idx_indices`, baru Sprint 6)
- Fundamental: PER, PBV, ROE, sector/industry
- Insider Ownership: holdings, normalization, group tagging
- Corporate Actions: auto-detect split/bonus, backward adjustment
- Quarterly Financials: revenue, EPS, cash flow

### Frontend (6 tab)
- **Market**: Yahoo Finance indices/commodities/currencies, news, commodity→stock mapping
- **IDX Daily**: Rankings + Digest + Flow unified, drag-reorder, filter
- **Diary**: Trade journal, replies, images, tags
- **Analysis** (5 sub-tab): Screener V5 | Sectors | Compare | Correlation | **Backtest V7**
- **Portfolio**: Trade tracker, Kelly Criterion, open P&L
- **Insider**: Network graph D3, search, cross-ownership

### Backtesting Engine V7 ⭐ (Sprint 6 — session ini)
Fitur terbesar yang baru dibangun. Full AmiBroker-style:
- AFL formula entry + exit (recursive descent parser, 40+ variabel)
- Scope: all / single stock / sector / industry
- Force cutloss toggle + open positions tracking
- Equity curve + drawdown + benchmark overlay (SVG)
- Monthly return heatmap, P&L distribution, MAE/MFE scatter
- Monte Carlo 500 runs + equity band chart
- Stats: Sharpe, Max DD, CAR/MaxDD, Recovery Factor, Profit Factor, Exposure %, dll
- Sortable trade history 15 kolom, Top Winners/Losers
- Formula reference + autocomplete scope/benchmark

### Lainnya
- Settings 7 tab (Upload, DB, CA, Tags, Export, IDX Download, Prefs)
- Screener V5: Rule Groups AND/OR, AFL formula, 40+ indicators
- Global Search, Ticker Page, Keyboard shortcuts
- Logo bull/bear sebagai site logo + favicon

---

## 📋 Remaining — Diprioritaskan

### 🔴 URGENT (Sprint 7)

**1. IDX API Integration**
Sekarang data manual upload XLSX tiap hari → friction tinggi. IDX API bisa automate:
- `getStockSummary(date)` → ganti upload Ringkasan Saham
- `getIndexSummary(date)` → ganti upload Index Summary
- `syncFinancialRatio(year,month)` → ganti upload Fundamental
- `syncStockSplit` + `syncCompanyDividend` → CA + dividend data accurate
- Perlu: reverse-engineer endpoints, buat fetcher, scheduler, backfill gaps
- **Risk**: API bisa berubah/rate limit. Perlu retry + error handling.

**2. Bloomberg Terminal Redesign**
User minta: data-dense, dark, monospace, less clutter, lazy load. Semua feature tetap.
- **Risk**: Regresi visual. Test semua tab setelah redesign.

### 🟡 MEDIUM (Post Sprint 7)

3. **Signal Scoring** — screener sekarang pass/fail, perlu ranking/score
4. **Screener Presets** — 1-click templates
5. **Screener Alert** — notify saham baru masuk criteria
6. **Insider Enhancement** — network V2, price overlay, activity alerts
7. **Morning Dashboard** — landing page harian

### 🟢 LOW (Backlog)

8. Backtest V2: transaction costs, multi-timeframe, walk-forward
9. Export: backtest PDF/CSV, ticker report, scheduled digest
10. Telegram Bot
11. Risk model (portfolio-level)
12. Technical debt: split insider.js, error boundary, caching, tests

---

## ⚠️ Known Issues

| Issue | Impact | Workaround |
|-------|--------|-----------|
| Yahoo Finance rate limit Docker | Market tab gagal load | Akan diganti IDX API |
| Commodities loading stuck | Kadang "Loading..." | Belum debug |
| Backtest MC same percentile | Kalau trades < 20 | Edge case |
| insider.js 566 lines | Hard to maintain | Perlu split |
| No error boundary | JS error = blank page | Medium risk |

---

*72 done · Sprint 7 next: IDX API + Redesign*
