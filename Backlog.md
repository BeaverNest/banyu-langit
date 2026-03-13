# Banyu Langit — Feature Backlog
# Updated 13 Maret 2026 (post Sprint 8)

---

## Konteks Singkat

Banyu Langit = **personal analytics platform saham IDX**, Bloomberg Terminal mini. Self-hosted Docker, localhost:3003. Solo developer (Aldiansyah).

Stack: Node.js + Express + SQLite + vanilla JS + **Deno bridge** untuk IDX API.

Data pipeline: **Deno server (port 3456)** ← 1-click dari browser → fetch idx.co.id → database.sqlite → bridge import (37 functions) → trading.db (39 tabel, 1.3M rows).

Arah: **quantitative trading platform** — scoring, backtesting, forward testing, self-hosted, zero dependency.

---

## Done (Sprint 1-7, ~80 items)

### Data Layer
- IDX Daily OHLCV + foreign flow (~1157 hari, 2021-2026)
- Index Summary 45 indeks BEI
- Fundamental: PER, PBV, ROE, sector/industry (via stock_screener API)
- Insider Ownership: holdings, normalization, group tagging (manual XLSX)
- Corporate Actions: auto-detect + API data
- Quarterly Financials
- Company Profiles + Details (sector, industry, board, address)
- Dividends (from API)

### IDX API Integration (Sprint 7)
- Deno bridge: fetch dari idx.co.id tanpa Cloudflare block
- Bridge import: database.sqlite → trading.db (7902 rows tested)
- `daily-sync.ps1`: 1-click daily automation
- `full-sync.ps1`: backfill + monthly data
- Settings UI simplified, "Import All" button
- Cron.ts: full sync semua 39 tabel IDX-API

### Frontend (6 tab, sidebar layout)
- **Market**: indices/commodities/currencies, news, commodity-to-stock mapping
- **IDX Daily**: Rankings + Digest + Flow unified, drag-reorder, filter
- **Diary**: Trade journal, replies, images, tags
- **Analysis** (5 sub-tab): Screener V5 | Sectors | Compare | Correlation | Backtest V7
- **Portfolio**: Trade tracker, Kelly Criterion, open P&L
- **Insider**: Network graph D3, search, cross-ownership

### Backtesting Engine V7
- AFL formula entry + exit (recursive descent parser, 40+ variables)
- Scope: all / single stock / sector / industry
- Force cutloss + open positions tracking
- Equity curve + drawdown + benchmark overlay (SVG)
- Monthly return heatmap, P&L distribution, MAE/MFE scatter
- Monte Carlo 500 runs + equity band chart
- Full AmiBroker-style stats

### Infrastructure
- Docker + docker-compose (dev mode with nodemon + bind mounts)
- Git workflow with rollback
- Bloomberg Terminal CSS deployed (dark, monospace, sidebar)
- Keyboard shortcuts (/, 1-6, S, T, D, W, C, ?)

---

## Done (Sprint 8) — 14 items

### 8.1 Deno 1-Click Sync ✅
- `deno-server.ts` — HTTP server port 3456, 38 sync functions
- `deno-proxy.js` — Node.js proxy: forward to Deno, poll progress, auto bridge
- `start-deno.ps1` — 1x start, biarkan running
- 3 sync modes dari browser: Daily (~8s) | Full (~12min) | Cron All (~16min)
- Sync Center UI di Settings — progress polling, status dashboard, sync log

### 8.2 Bridge Expansion (39 Tabel) ✅
- `idx-api-bridge.js` — 37 import functions (from 8)
- `db.js` — 30 tabel di trading.db (from 15)
- Total: **1,329,078 rows** imported
- Key new tables: broker_summary (25K), company_announcements (77K), market_calendar (11.5K), sectoral_movement (5.8K), trading_ss (879K), daily_index (12K), financial_ratios (139), index_list (45)

### 8.3 Bloomberg Terminal Redesign ✅
- Color palette: black bg, amber/orange accent, red topbar
- Topbar: "BANYU LANGIT" full text, centered search, white icons
- Badge: yellow notification on red bar

### 8.4 Data Utilization ✅
- **Replace Yahoo indices** → index_list dari database (45 IDX indices, instant load)
- **BEI Announcements feed** — 77K rows, search by ticker/keyword, popup with PDF attachment links
- **Suspend badge** — ⚠ di Rankings table + ⚠ SUSPEND di ticker page header
- **Dividend History + Yield** — di Fundamental tab, dengan yield calculation
- **Financial Ratios enrichment** — EPS, book value, assets, equity per quarter
- **Announcements count + link** — di ticker page, click to view filtered announcements

### 8.5 Ticker Page Redesign (Partial) ✅
- Wider: 860px → 1100px
- Tabs: Overview | Foreign | Insider | Fundamental (merged +Quarterly) | News (new)
- Overview: + Bid Vol/Offer Vol stats + ratio bar + dividend alert card
- Bid vs Offer volume chart (stacked bars, synced with price chart range)
- News tab: BEI announcements per ticker with inline PDF links

### 8.6 Cleanup ✅
- Deleted: daily-sync.ps1, full-sync.ps1, check.js
- Renamed: docker-compose.dev.yml → docker-compose.yml (default)

---

## Sprint 8.5 — Ticker Page Polish (Next)

### Fundamental Tab Proper Redesign
**Priority: HIGH**
Current state: data asal ditempel, belum informatif secara analitis.
- Fix financial_ratios unit (K vs M vs B — data dalam miliar, display salah)
- Remove duplikasi antara Financial Statements section dan Quarterly table
- Redesign flow informasi dari sudut pandang analis:
  - Valuation snapshot (PER/PBV/ROE/DER)
  - Quarterly trend chart (Revenue/NI bar chart)
  - Quarterly data table
  - Dividend history + yield
  - Classification + Index membership
- Satu scrollable page, tidak ada redundansi

### Remaining Data Utilization
- **Macro Foreign vs Domestic flow chart** — bar chart dari `foreign_trading` + `domestic_trading` di IDX Daily
- **market_calendar fix gap detection** — 414 gaps → 0 (distinguish libur nasional)
- **Sector enrichment** — `sectoral_movement` data resmi BEI ke Sectors tab
- **industry_trading** PER/PBV per industry → Sectors Overview

---

## Sprint 9 — Quant Foundation

### 9.1 Composite Score System
**Priority: HIGH**
Multi-factor ranking per saham per hari:
- Momentum factor (MA position, price change, relative strength)
- Value factor (PER, PBV, ROE)
- Flow factor (foreign net, broker accumulation)
- Activity factor (volume spike, frequency spike)
- Configurable weights
- Daily auto-calculate atau on-demand

### 9.2 Morning Signal Dashboard
**Priority: HIGH**
Landing page harian:
- Top composite scores hari ini
- Fired screener alerts
- Watchlist prices + signals
- Foreign flow summary
- Sector rotation heatmap
- 1-click dari sini ke detail saham

### 9.3 Information Coefficient (IC) Tracking
**Priority: MEDIUM**
Validasi apakah composite score benar-benar prediktif:
- Simpan daily scores ke tabel baru
- Setelah N hari, hitung correlation score vs actual return
- IC time series chart
- Hit rate per factor

### 9.4 Signal Alerts
**Priority: MEDIUM**
- Auto-run screener/scoring daily
- Notify kalau saham baru masuk top score
- Notify kalau saham watchlist dapat sinyal
- Browser notification atau Telegram (future)

---

## Sprint 10 — Advanced Analytics

### 10.1 PineTS Integration
Pine Script transpiler di JavaScript — jalankan TradingView indicators.

### 10.2 QFChart Upgrade
Replace Lightweight Charts dengan QFChart (drawing tools, multi-pane).

### 10.3 Backtest V3
- Transaction costs (broker fee, slippage)
- Walk-forward optimization
- Portfolio-level backtest
- Integration dengan composite score

### 10.4 Forward Testing
- Paper trading mode
- Real-time signal tracking
- Equity curve paper portfolio

---

## Sprint 11+ — Platform

### 11.1 Export & Reporting
- Backtest PDF report, daily/weekly digest

### 11.2 Telegram Bot
- /digest, /alert, /screen, /score

### 11.3 Risk Model
- Portfolio-level risk, position sizing, drawdown probability

### 11.4 PWA / Mobile
- Installable web app, offline cache, push notifications

---

## Known Issues

| Issue | Impact | Status |
|-------|--------|--------|
| Yahoo Finance rate limit Docker | Commodities/currencies fallback | **Indices FIXED** (pakai index_list) |
| Backtest MC same percentile | Kalau trades < 20 | Edge case |
| insider.js 566 lines | Hard to maintain | Perlu split |
| No error boundary | JS error = blank page | Medium risk |
| Gap detection 414 gaps | Tidak tahu libur nasional | **market_calendar data ready**, fix pending |
| Financial Ratios unit display | Assets "7K" harusnya "7T" | **Fix di Sprint 8.5** |
| Fundamental tab duplikasi | Financial Statements + Quarterly overlap | **Redesign di Sprint 8.5** |
| Price Performance 0% | Screener chg_4w/13w/26w/52w kosong | Data issue dari BEI API |

---

## Architecture

```
User Browser (localhost:3003)
    │
    ├── 1-Click Sync buttons
    │       │
    │       ▼
Docker Container (Node.js + Express)
    │       │
    │       ├── deno-proxy.js → HTTP → Deno Server (:3456) → idx.co.id
    │       │                                │
    │       │                                ▼
    │       │                          database.sqlite (39 tabel)
    │       │                                │
    │       ├── idx-api-bridge.js ◄──────────┘  (volume mount)
    │       │       │
    │       │       ▼
    │       ├── trading.db (SQLite, 30 tabel, 1.3M rows)
    │       │
    │       ├── server/index.js (Express, ticker endpoint)
    │       ├── server/routes/ (8 route files)
    │       └── server/utils/ (bridge, proxy, yahoo, news, normalize)
    │
    └── public/ (HTML + 6 CSS + 18 JS)
```

### Key Files
```
banyu-langit/
├── public/              (frontend: HTML, CSS, JS)
├── server/
│   ├── index.js         (Express server + ticker endpoint)
│   ├── db.js            (SQLite schema, 30 tables)
│   ├── routes/          (8 route files)
│   └── utils/
│       ├── idx-api-bridge.js  (37 import functions)
│       ├── deno-proxy.js      (1-click sync proxy)
│       ├── yahoo.js, news.js, normalize.js
├── IDX-API-main/        (Deno project, 39 tables)
│   └── deno-server.ts   (HTTP sync server, 38 functions)
├── docker-compose.yml   (dev mode, bind mounts + IDX-API data)
├── start-deno.ps1       (start Deno server)
├── Dockerfile
└── package.json
```

### Data Sources
| Source | Method | Data | Status |
|--------|--------|------|--------|
| IDX API (via Deno) | 1-click browser sync | 39 tabel, 1.3M rows | **Primary** |
| BEI XLSX | Manual upload | Insider Ownership only | Active |
| Yahoo Finance | Fallback | Commodities, currencies, global indices | Fallback only |
| Google News | Auto RSS | Market news | Active, supplemented by BEI announcements |

---

## Decision Log (Sprint 8)

| Keputusan | Alasan |
|-----------|--------|
| Deno HTTP server (not Deno-in-Docker) | Cloudflare blocks from Docker; Deno on Windows host works |
| deno-proxy.js (Node→Deno HTTP) | Clean separation, Docker doesn't need Deno installed |
| Async poll for Full/Cron sync | These take 12-16 min, can't block HTTP response |
| Replace Yahoo for IDX indices | Reliability + instant load from database |
| Full 39-table bridge | "Bloomberg mini" needs all data, one-time setup |
| Merge Fundamental + Quarterly tabs | Same theme, reduce tab clutter |
| Bid/Offer chart replace foreign flow in Overview | Foreign has own tab, bid/offer more actionable for Overview |

---

*~95 items done. Sprint 8.5: Fundamental tab redesign + remaining data utilization.*
*Sprint 9: Quant foundation — composite score + morning signal dashboard.*
