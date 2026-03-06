# 🌊 Banyu Langit — Execution Roadmap

## Current State (March 2026)
- V2 deployed, 27 files, all features working
- Data: IDX daily (42+ days), insider ownership, investor tags
- Pain points: no adjusted OHLC, settings masih dropdown, no export, no automation

---

## Sprint 1: Infrastructure & Stability
> Goal: Foundation yang solid sebelum tambah fitur baru

### 1A. Error Handling & Logging
- [ ] Try-catch di semua route handlers (beberapa masih bisa crash)
- [ ] Request logging middleware (endpoint, duration, errors)
- [ ] Frontend error boundary (catch JS errors, show toast instead of blank page)
- [ ] API response format standardization: `{success, data, error, meta}`

### 1B. Dev Mode Setup
- [ ] Docker volume mount `./public:/app/public` for frontend hot-reload
- [ ] Docker volume mount `./server:/app/server` + nodemon for backend hot-reload
- [ ] `docker-compose.dev.yml` (dev) vs `docker-compose.yml` (prod)
- [ ] `.env` file support (PORT, API_KEY, DEBUG)

### 1C. Database Migrations
- [ ] Version tracking table (`schema_version`)
- [ ] Migration runner di `db.js` — auto-apply new tables/columns saat startup
- [ ] Backup before migration

### 1D. Test Infrastructure
- [ ] Unit test for technical indicators (MA, MACD, Stochastic) — validate against known values
- [ ] Test for parseTradeDate with all month formats
- [ ] API endpoint smoke test script

**Deliverable:** Dev workflow yang smooth, app tidak crash, data aman.

---

## Sprint 2: Data Engine
> Goal: Data quality & corporate action handling

### 2A. Corporate Action System
- [ ] Auto-detect dari listed_shares change saat upload
- [ ] Tabel `corporate_actions` (code, date, type, ratio, confirmed)
- [ ] Confirm/reject flow di frontend
- [ ] Adjust historical OHLC after confirm
- [ ] Screener & ticker page pakai adjusted data

### 2B. Settings Redesign
- [ ] Full page settings (bukan dropdown)
- [ ] Tab: Data Upload | Database | Corporate Actions | System
- [ ] Database stats & gap detection
- [ ] Delete data by date range
- [ ] Export database as CSV/SQLite backup

### 2C. Upload Improvements
- [ ] Duplicate detection feedback ("2026-03-05 sudah ada, di-update")
- [ ] Upload progress indicator (per file)
- [ ] Header validation warning
- [ ] Upload history log viewer

**Deliverable:** Data bersih & reliable, settings yang proper.

---

## Sprint 3: User Experience
> Goal: Daily workflow yang efisien

### 3A. Morning Dashboard
- [ ] New tab atau landing page saat buka app
- [ ] Sections: Daily Digest, Watchlist Updates, Triggered Alerts, Screener Matches
- [ ] Auto-refresh on interval
- [ ] Configurable (pilih sections mana yang muncul)

### 3B. Watchlist V2
- [ ] Inline data per ticker: close, chg%, foreign net, volume anomaly
- [ ] Mini sparkline foreign flow (7D)
- [ ] Watchlist groups/categories
- [ ] Sort & filter

### 3C. Diary Integration
- [ ] Tag ticker di diary entry (auto-link)
- [ ] Auto-embed price & foreign flow snapshot saat post
- [ ] Filter diary by ticker
- [ ] Diary entries muncul di Ticker Page

### 3D. Compare Mode
- [ ] Pilih 2-3 ticker, side by side
- [ ] Compare: price, foreign flow, insider ownership
- [ ] Useful for sector analysis (BBCA vs BMRI vs BBRI)

**Deliverable:** App jadi daily driver, bukan cuma data viewer.

---

## Sprint 4: Export & Reporting
> Goal: Data bisa dibawa keluar

### 4A. Export
- [ ] Screener results → CSV/XLSX
- [ ] Foreign flow data → CSV
- [ ] Ticker detail → PDF report
- [ ] Insider ownership → CSV

### 4B. Scheduled Reports
- [ ] Daily digest auto-generate as markdown/HTML
- [ ] Weekly summary report
- [ ] Configurable email/file output

**Deliverable:** Data bisa di-share, di-archive, di-analyze di luar app.

---

## Sprint 5: Automation & Integration
> Goal: Reduce manual work

### 5A. Telegram Bot
- [ ] Push daily digest
- [ ] Push triggered alerts
- [ ] Query: "foreign BBCA", "pemegang TLKM"
- [ ] Screener results push

### 5B. Auto-fetch
- [ ] Cron job download Ringkasan Saham dari BEI (kalau server 24/7)
- [ ] Or: reminder notification "Data belum di-update hari ini"

### 5C. API V2
- [ ] Structured REST API for semua endpoint
- [ ] API documentation (Swagger/OpenAPI)
- [ ] Webhook support for alerts

**Deliverable:** App jalan sendiri, minimal manual intervention.

---

## Sprint 6: Advanced Analysis
> Goal: Deeper market intelligence

### 6A. Sector Analysis
- [ ] Classify tickers by sector (dari data BEI atau manual mapping)
- [ ] Sector rotation chart (which sectors getting foreign inflow)
- [ ] Sector-level screener

### 6B. Pattern Detection
- [ ] Accumulation/distribution pattern (consecutive foreign buy + volume increase)
- [ ] Breakout detection (price above resistance + volume spike)
- [ ] Divergence alert (price up but foreign sell, or vice versa)

### 6C. Multi-timeframe
- [ ] Weekly aggregation dari daily data
- [ ] Monthly summary
- [ ] YTD performance tracking

**Deliverable:** Actionable insights, bukan cuma raw data.

---

## Infrastructure Rules

### Before Each Sprint:
1. Backup database
2. Create git branch (kalau pakai git)
3. Test existing features still work after update

### File Update Rules:
| Change scope | Files to update | Rebuild needed? |
|---|---|---|
| CSS only | `public/css/*.css` | Yes (Docker) or No (dev mode) |
| Frontend JS only | `public/js/*.js` | Yes (Docker) or No (dev mode) |
| Backend route | `server/routes/*.js` | Yes |
| Database schema | `server/db.js` | Yes + check migration |
| New feature | Multiple files | Yes + full test |

### Naming Convention:
- CSS: `public/css/{module}.css`
- Frontend JS: `public/js/{module}.js`
- Backend routes: `server/routes/{module}.js`
- Backend utils: `server/utils/{function}.js`
- Max 300 lines per file, split kalau lebih

---

*Last updated: 2026-03-06*