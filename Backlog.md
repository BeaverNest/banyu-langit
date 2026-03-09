# 🌊 Banyu Langit — Feature Backlog

## ✅ Done (58 items)

### Core Features
- [x] Diary (trade journal, replies, images, tags)
- [x] Watchlist + Price Alerts
- [x] Market Data (indices, commodities, currencies, news)
- [x] IDX Daily (rankings, foreign flow, anomaly, daily digest)
- [x] Screener V2 (rule-based, MA/MACD/Stoch, saved configs)
- [x] Insider Ownership (network graph, tags, investor groups)
- [x] Global Search + Unified Ticker Page
- [x] TradingView chart embed
- [x] Keyboard shortcuts + Skeleton loaders

### Sprint 2 — Data Engine
- [x] Corporate Action auto-detect + confirm/dismiss + adjusted OHLC
- [x] Screener pakai adjusted price
- [x] Settings modal 6 tabs (Upload, Database, CA, Tags, Export, Preferences)
- [x] Export CSV (4 types), Database stats + gap detection
- [x] Light mode default, chart hidden on startup
- [x] BEI Fundamental data upload, Indonesian month name support
- [x] Bulk upload limit 500 files

### Sprint 3 — Analysis & UX
- [x] IDX Daily redesign (sector/industry filter, compact digest)
- [x] Screener as top-level tab
- [x] Sector Overview (drill-down sector → industry → ticker list)
- [x] Ticker Comparison + Mixed Mode (ticker/sector/industry/konglo)
- [x] Market Overview (merged Index/Commodities/Currencies)
- [x] Dev mode (docker-compose.dev.yml + nodemon)

### Sprint 4 — Sector Intelligence & Polish
- [x] Ticker Page adjusted price chart + timeframe (1M-ALL) + CA markers
- [x] Investor Tags CRUD editor (4 sub-tabs in Settings)
- [x] Font consistency fix (monospace for numbers only)
- [x] Ticker Page flow table symmetric layout
- [x] Sector Rotation Heatmap (monthly, 3 metrics, sortable, clickable)
- [x] Sector Flow Timeline (multi-line SVG, toggle visibility, Top 3/5)
- [x] Correlation 3 modes (Ownership / Industry / Custom) + common owners
- [x] Sector stock table: sortable headers + column toggle
- [x] Code split: sector-intelligence.js extracted from app.js
- [x] Upload duplicate detection + format validation (backend)
- [x] Upload history log viewer (backend)
- [x] README.md documentation

### Sprint 5 — Full Tab Redesign & Screener V5
- [x] **5-tab layout**: Market | IDX Daily | Diary | Analysis | Insider
- [x] **Watchlist → topbar dropdown** (always accessible, like notifications)
- [x] **IDX Daily V2 unified**: Rankings + Digest + Flow in 1 tab
- [x] **Digest dashboard**: Top Gainer/Loser, Sector Activity, Most Active/Freq, Foreign Buy/Sell, Volume Spikes, Dormant→Active — all clickable
- [x] **Column toggle + drag-reorder** on Rankings table headers
- [x] **Flow table**: draggable columns, sortable, clickable rows, no stock limit
- [x] **Activity Spike merged** into IDX Daily (was separate tab)
- [x] **Analysis tab**: Screener + Sectors + Compare + Correlation (4 sub-tabs)
- [x] **Screener V5**: Rule Groups (AND/OR mixed logic), bigger popup (900px)
- [x] **Screener config persistence** via localStorage (survives reload/rebuild)
- [x] **New screener indicators**: Activity Score, Val/Freq/FNet Spike
- [x] **New screener fields**: EPS, Dividend Yield, Free Float %, Industry
- [x] **Backend groups logic**: `(Group1 AND) OR (Group2 AND)` evaluation
- [x] **Backend activity spike** computed in /screener/run endpoint
- [x] **Unified endpoint** `/api/idx/unified` (rankings + spike + digest + MA + sector)
- [x] **Keyboard shortcut W** → open watchlist dropdown

---

## 📋 Remaining Backlog

### 🔧 Data Quality
- [ ] Gap detection: exclude weekends + holidays
- [ ] Upload progress indicator (frontend)
- [ ] Dividend yield data source (BEI/manual upload)

### 📊 Screener Enhancement
- [x] ~~OR logic (selain AND)~~ → Done: Rule Groups (AND/OR mixed)
- [ ] Preset templates (Asing Akumulasi, Breakout, Oversold Bounce)
- [ ] Screener alert — notify saham baru masuk criteria
- [ ] Foreign flow overlay on comparison chart

### 🔍 Insider Enhancement
- [ ] Konglomerat network V2 (cross-ticker ownership + politik mapping)
- [ ] Insider + price overlay (ownership timeline vs price chart)
- [ ] Insider change alert (ownership change > X%)

### 📱 UX / UI
- [ ] Morning dashboard (digest, watchlist, alerts, screener matches)
- [ ] Diary ↔ data integration (tag ticker, auto-embed snapshot)
- [x] ~~Watchlist V2 (inline flow, groups, drag reorder)~~ → Moved to topbar dropdown
- [ ] Notification center improvements

### 📥 Export & Reporting
- [ ] Ticker detail → PDF report
- [ ] Insider ownership → CSV
- [ ] Scheduled reports (daily digest HTML)

### 🤖 Automation
- [ ] Telegram Bot (digest, alerts, query)
- [ ] Auto-fetch BEI data (cron)
- [ ] API V2 + Webhook

### 🏗 Technical Debt
- [x] ~~Split app.js further~~ → Done: app.js now 136 lines (was 968)
- [x] ~~Split idx.js frontend~~ → Replaced by idx-daily-v2.js
- [ ] Split insider.js (566 lines) frontend
- [ ] `.env` file support (partially done — server reads .env)
- [ ] Database migration system
- [ ] Unit tests for indicators
- [ ] Error handling + structured logging
- [ ] API response caching

---

*Last updated: 2026-03-08*
