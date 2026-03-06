# 🌊 Banyu Langit — Execution Roadmap

## Current State (March 2026)
- V2 deployed, 31 files, all features working
- Data: IDX daily (42+ days), insider ownership, investor tags, BEI fundamental
- Corporate Action system live: auto-detect, confirm/dismiss, adjusted OHLC
- Dev mode available (docker-compose.dev.yml)
- Next priority: finish Sprint 2A (screener adjusted), then Sprint 2B (settings) or Sprint 3 (UX)

---

## Sprint 1: Infrastructure & Stability ⏸ (partial)
> Goal: Foundation yang solid sebelum tambah fitur baru

### 1A. Error Handling & Logging
- [ ] Try-catch di semua route handlers (beberapa masih bisa crash)
- [ ] Request logging middleware (endpoint, duration, errors)
- [ ] Frontend error boundary (catch JS errors, show toast instead of blank page)
- [ ] API response format standardization: `{success, data, error, meta}`

### 1B. Dev Mode Setup ✅ Done
- [x] Docker volume mount `./public:/app/public` for frontend hot-reload
- [x] Docker volume mount `./server:/app/server` + nodemon for backend hot-reload
- [x] `docker-compose.dev.yml` (dev) vs `docker-compose.yml` (prod)
- [ ] `.env` file support (PORT, API_KEY, DEBUG)

### 1C. Database Migrations
- [ ] Version tracking table (`schema_version`)
- [ ] Migration runner di `db.js` — auto-apply new tables/columns saat startup
- [ ] Backup before migration

### 1D. Test Infrastructure
- [ ] Unit test for technical indicators (MA, MACD, Stochastic)
- [ ] Test for parseTradeDate with all month formats
- [ ] API endpoint smoke test script

**Status:** Dev mode done, rest deferred — moving fast on features first.

---

## Sprint 2: Data Engine 🔄 In Progress
> Goal: Data quality & corporate action handling

### 2A. Corporate Action System ✅ Done (core)
- [x] Auto-detect dari listed_shares change saat upload
- [x] Tabel `corporate_actions` (code, ex_date, type, ratio, status)
- [x] Confirm/dismiss flow di frontend (IDX Daily → Corp Action tab)
- [x] Adjust historical OHLC after confirm (backward adjustment)
- [x] CA notification banner + toast saat upload
- [x] Manual CA add via API (`POST /api/idx/ca`)
- [x] Bulk confirm/dismiss all pending
- [x] Re-detect trigger (`POST /api/idx/ca/detect`)
- [ ] **Screener pakai adjusted price** ← next
- [ ] **Ticker page pakai adjusted chart** ← next

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

**Status:** 2A core done. Screener adjusted + ticker page adjusted remaining.

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

**Status:** Not started.

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

**Status:** Not started.

---

## Sprint 5: Automation & Integration
> Goal: Reduce manual work

### 5A. Telegram Bot
- [ ] Push daily digest
- [ ] Push triggered alerts
- [ ] Query: "foreign BBCA", "pemegang TLKM"
- [ ] Screener results push

### 5B. Auto-fetch
- [ ] Cron job download Ringkasan Saham dari BEI
- [ ] Or: reminder notification "Data belum di-update hari ini"

### 5C. API V2
- [ ] Structured REST API
- [ ] API documentation (Swagger/OpenAPI)
- [ ] Webhook support for alerts

**Status:** Not started.

---

## Sprint 6: Advanced Analysis
> Goal: Deeper market intelligence

### 6A. Sector Analysis
- [ ] Classify tickers by sector (data BEI fundamental sudah ada)
- [ ] Sector rotation chart (foreign inflow per sector)
- [ ] Sector-level screener

### 6B. Pattern Detection
- [ ] Accumulation/distribution pattern
- [ ] Breakout detection (price above resistance + volume spike)
- [ ] Divergence alert (price up but foreign sell)

### 6C. Multi-timeframe
- [ ] Weekly aggregation dari daily data
- [ ] Monthly summary
- [ ] YTD performance tracking

**Status:** Not started. Sector data available from BEI fundamental upload.

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-05 | Skip Sprint 1 (infra), jump to Sprint 2 | Features > infra for solo project |
| 2026-03-06 | Corporate Action via listed_shares auto-detect | More reliable than manual input, data already in idx_daily |
| 2026-03-07 | Backward adjustment (not forward) | Industry standard, latest price = actual market price |
| 2026-03-07 | CA endpoints inside idx.js (not separate route) | Tight coupling with IDX data, no extra index.js changes needed |

---

## Infrastructure Rules

### Before Each Sprint:
1. `git add . && git commit -m "backup before [feature]"`
2. Test existing features still work after update
3. Rollback: `git checkout . && docker compose up -d --build`

### File Update Rules:
| Change scope | Files to update | Rebuild needed? |
|---|---|---|
| CSS only | `public/css/*.css` | Yes (prod) / No (dev mode) |
| Frontend JS only | `public/js/*.js` | Yes (prod) / No (dev mode) |
| Backend route | `server/routes/*.js` | Yes (prod) / nodemon auto (dev) |
| Database schema | `server/db.js` | Yes + verify table created |
| New feature | Multiple files | Yes + full test |

### Naming Convention:
- CSS: `public/css/{module}.css`
- Frontend JS: `public/js/{module}.js`
- Backend routes: `server/routes/{module}.js`
- Backend utils: `server/utils/{function}.js`
- Max 300 lines per file, split kalau lebih

---

*Last updated: 2026-03-07*