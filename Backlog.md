# 🌊 Banyu Langit — Feature Backlog

## ✅ Done (42 items)

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

---

## 📋 Remaining Backlog

### 🔧 Data Quality
- [ ] Gap detection: exclude weekends
- [ ] Upload progress indicator (frontend)

### 📊 Screener Enhancement
- [ ] OR logic (selain AND)
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
- [ ] Watchlist V2 (inline flow, groups, drag reorder)
- [ ] Notification center

### 📥 Export & Reporting
- [ ] Ticker detail → PDF report
- [ ] Insider ownership → CSV
- [ ] Scheduled reports (daily digest HTML)

### 🤖 Automation
- [ ] Telegram Bot (digest, alerts, query)
- [ ] Auto-fetch BEI data (cron)
- [ ] API V2 + Webhook

### 🏗 Technical Debt
- [ ] Split app.js further (968 lines → settings.js, compare.js, tags-editor.js)
- [ ] Split insider.js (566 lines), idx.js (500+ lines) frontend
- [ ] `.env` file support
- [ ] Database migration system
- [ ] Unit tests for indicators
- [ ] Error handling + structured logging
- [ ] API response caching

---

*Last updated: 2026-03-08*
