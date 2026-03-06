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
- [x] Corporate Action auto-detect (listed_shares change ≥1.5x/≤0.67x)
- [x] Tabel `corporate_actions` (code, ex_date, type, ratio, status)
- [x] User confirm/dismiss flow di IDX Daily panel
- [x] Adjusted OHLC endpoint (backward adjustment)
- [x] CA notification saat upload IDX Daily
- [x] Manual CA add via API
- [x] Dev mode setup (docker-compose.dev.yml + nodemon)
- [x] Indonesian month name support (Mei, Agt, Okt, Des, etc)
- [x] Bulk upload limit 500 files
- [x] BEI Fundamental data upload (PER/PBV/ROE/ROA/DER/NPM/Sector)

---

## 🔧 Backend / Data Engine

### Corporate Action — Remaining
- [ ] Screener pakai adjusted price untuk indikator teknikal (MA/MACD/Stoch)
- [ ] Ticker page pakai adjusted chart
- [ ] CA history log (siapa confirm, kapan)

### Settings / System Management
- [ ] Redesign settings jadi full page (bukan dropdown)
- [ ] Tab: Data Upload | Database | Corporate Actions | System
- [ ] Database Stats: total records, disk usage, date range, gap detection
- [ ] Data Cleanup: delete by date range, delete snapshot, clear all
- [ ] Export/backup database (download SQLite atau CSV)
- [ ] API key management
- [x] Corporate Action manager (view, add manual, confirm, dismiss, delete) ✅

### Data Quality
- [ ] Duplicate detection saat upload (feedback "sudah pernah upload tanggal X")
- [ ] Format validation (warning kalau header tidak dikenali)
- [ ] Upload progress indicator (per file)
- [ ] Upload history log viewer

---

## 📊 IDX Daily Enhancement

### Screener
- [ ] OR logic (selain AND)
- [ ] Preset templates (Asing Akumulasi, Breakout, Oversold Bounce, etc)
- [ ] Screener alert — notify kalau ada saham baru masuk criteria
- [ ] Lookback period setting per indikator
- [ ] Screener pakai adjusted price (dari confirmed CA)

### Analysis
- [ ] Sector analysis — classify tickers, show sector rotation
- [ ] Correlation detection — saham yang gerak bareng
- [ ] Broker summary (kalau data broker tersedia)
- [ ] Date picker — view historical date, compare 2 dates
- [ ] Multi-timeframe MA (daily, weekly)

### Export
- [ ] Download screener results as CSV/XLSX
- [ ] Download foreign flow data as CSV
- [ ] Download ticker detail as PDF report

---

## 🔍 Insider Enhancement

### Integration
- [ ] Insider + price overlay — ownership changes alongside price chart
- [ ] Foreign flow vs insider ownership comparison
- [ ] Insider change alert — notify ownership change > X%
- [ ] Link diary entries to insider events

---

## 📱 UX / UI

### Daily Workflow
- [ ] Morning dashboard — 1 page: digest, watchlist update, alerts triggered, screener matches
- [ ] Diary connected to data — tag ticker, auto-embed price/flow snapshot
- [ ] Compare mode — 2 tickers side by side (foreign flow, price, insider)

### Watchlist
- [ ] Inline foreign flow, change%, volume anomaly per ticker
- [ ] Watchlist groups / categories
- [ ] Drag reorder

### Global Search
- [ ] Search across diary entries (not just tickers)
- [ ] Recent searches history
- [ ] TradingView mini chart in ticker page

### Polish
- [ ] Breadcrumb navigation
- [ ] Better loading states (progressive, not blocking)
- [ ] Notification center (unified: alerts, upload status, CA detected)
- [ ] Keyboard shortcut help overlay (?)

---

## 🤖 Automation & Integration

### Telegram Bot
- [ ] Push daily digest ke Telegram
- [ ] Push alert triggered
- [ ] Query dari Telegram: "siapa pemegang BBCA", "foreign flow TLKM"
- [ ] Screener results push

### Auto-fetch
- [ ] Cron job download Ringkasan Saham dari BEI (kalau server 24/7)
- [ ] Auto-upload on schedule

### API V2
- [ ] Structured API for all endpoints
- [ ] Webhook support for alerts
- [ ] Rate limiting

---

## 🏗 Technical Debt

- [ ] insider.js masih 566 baris — split jadi insider-view.js + insider-network.js
- [ ] idx.js frontend sekarang 500+ baris — split kalau nambah lagi
- [ ] CSS naming consistency (BEM-lite: `.bl-*`)
- [ ] Error handling improvement (retry, timeout)
- [ ] Unit tests for technical indicators (MA, MACD, Stochastic)
- [x] Docker volume mount for dev mode ✅ (docker-compose.dev.yml)
- [ ] `.env` file support (PORT, API_KEY, DEBUG)
- [ ] Database migration system (schema_version tracking)

---

*Last updated: 2026-03-07*