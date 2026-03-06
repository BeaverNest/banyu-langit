# 🌊 Banyu Langit — Feature Backlog

## ✅ Done
- [x] Diary (trade journal, replies, images, tags)
- [x] Watchlist + Price Alerts
- [x] Market Data (indices, commodities, currencies, news)
- [x] IDX Daily (rankings, foreign flow, anomaly, daily digest)
- [x] Screener V2 (rule-based, MA/MACD/Stoch, saved configs, sortable columns)
- [x] Insider Ownership (network graph, tags, investor groups)
- [x] Global Search + Unified Ticker Page
- [x] TradingView chart embed
- [x] Rebranding (Banyu Langit, color scheme)
- [x] Keyboard shortcuts
- [x] Skeleton loaders
- [x] Phase 0 refactor (split files)
- [x] Corporate Action auto-detect + confirm/dismiss + adjusted OHLC
- [x] Screener pakai adjusted price (MA/MACD/Stoch)
- [x] Settings modal popup (Upload, Database, Corp Actions, Export, Preferences)
- [x] Export CSV (IDX Daily, Foreign Flow, Fundamental, Corporate Actions)
- [x] Database stats + gap detection
- [x] Light mode default + chart hidden on startup
- [x] IDX Daily redesign (sector/industry dropdown filter, compact digest cards)
- [x] Screener as top-level tab
- [x] Sector Overview (drill-down sector → industry → ticker list)
- [x] Ticker Comparison chart (normalized % change, range 1M-ALL, summary cards)
- [x] Market Overview (Index + Commodities + Currencies merged 1 tab)
- [x] Dev mode (docker-compose.dev.yml + nodemon)
- [x] BEI Fundamental data upload
- [x] Indonesian month name support
- [x] Bulk upload limit 500 files

---

## 🔧 Backend / Data Engine

### Corporate Action — Remaining
- [ ] Ticker page pakai adjusted chart

### Data Quality
- [ ] Duplicate detection saat upload
- [ ] Format validation (warning header tidak dikenali)
- [ ] Upload progress indicator
- [ ] Upload history log viewer

---

## 📊 Screener & Analysis

### Screener Enhancement
- [ ] OR logic (selain AND)
- [ ] Preset templates (Asing Akumulasi, Breakout, Oversold Bounce)
- [ ] Screener alert — notify saham baru masuk criteria

### Comparison — Phase 2
- [ ] **Sector vs Sector comparison**
- [ ] **Industry vs Industry comparison**
- [ ] **Konglomerat vs Konglomerat comparison**
- [ ] Foreign flow overlay on comparison chart

### Sector Analysis
- [ ] Sector rotation heatmap (asing masuk sektor mana per minggu)
- [ ] Sector-level foreign flow aggregation timeline

### Other Analysis
- [ ] Correlation detection — saham yang gerak bareng
- [ ] Date picker — view historical date, compare 2 dates
- [ ] Multi-timeframe MA (daily, weekly)

---

## 🔍 Insider Enhancement

- [ ] **Konglomerat network — cross-ticker ownership + politik mapping**
- [ ] Insider + price overlay
- [ ] Foreign flow vs insider comparison
- [ ] Insider change alert (ownership change > X%)

---

## 📱 UX / UI

- [ ] Morning dashboard (digest, watchlist, alerts, screener matches)
- [ ] Diary ↔ data integration (tag ticker, auto-embed snapshot)
- [ ] Watchlist V2 (inline flow, groups, drag reorder)
- [ ] Visual redesign polish (all pages consistent)
- [ ] Notification center

---

## 📥 Export & Reporting

- [x] Screener results → CSV ✅
- [x] Foreign flow → CSV ✅
- [x] Fundamental → CSV ✅
- [x] Corporate actions → CSV ✅
- [ ] Ticker detail → PDF report
- [ ] Insider ownership → CSV (needs API endpoint)
- [ ] Scheduled reports (daily digest as HTML)

---

## 🤖 Automation

- [ ] Telegram Bot (digest, alerts, query)
- [ ] Auto-fetch BEI data (cron)
- [ ] API V2 + Webhook

---

## 🏗 Technical Debt

- [ ] Split insider.js (566 baris)
- [ ] Split idx.js frontend (500+ baris)
- [ ] app.js sekarang 530+ baris — split kalau nambah lagi
- [ ] `.env` file support
- [ ] Database migration system
- [ ] Unit tests for indicators
- [ ] Error handling improvement

---

*Last updated: 2026-03-07*