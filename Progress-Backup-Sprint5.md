# 🌊 Banyu Langit — Progress Backup & Next Targets
## Session: March 8-9, 2026

---

## 📊 Progress Summary

### Sprint 5 — Complete (16 items delivered)
| # | Feature | Status |
|---|---------|--------|
| 1 | 5-tab layout (Market \| IDX Daily \| Diary \| Analysis \| Insider) | ✅ |
| 2 | Watchlist → topbar dropdown (always accessible) | ✅ |
| 3 | IDX Daily V2: Rankings + Digest + Flow unified | ✅ |
| 4 | Digest dashboard (Top Gainer/Loser, Sector, Most Active, Foreign, Spikes) | ✅ |
| 5 | Column toggle + drag-reorder (Rankings + Flow) | ✅ |
| 6 | Flow table: sortable, clickable, no limit, own col toggle | ✅ |
| 7 | Activity Spike merged into IDX Daily | ✅ |
| 8 | Analysis tab: Screener \| Sectors \| Compare \| Correlation | ✅ |
| 9 | Screener V5: Rule Groups (AND/OR mixed logic) | ✅ |
| 10 | Screener popup larger (900px) | ✅ |
| 11 | Screener config persistence (localStorage + SQLite fix) | ✅ |
| 12 | New indicators: Activity Score, Val/Freq/FNet Spike | ✅ |
| 13 | New fields: EPS, Dividend Yield, Free Float %, Industry | ✅ |
| 14 | Backend: groups evaluation + activity spike in /run | ✅ |
| 15 | TradingView: clean look + SMA indicator | ✅ |
| 16 | Diary popup: proportional images (contain, 90vh) | ✅ |

### Codebase Stats
```
Total files:        48
Frontend JS:        14 files (was 12)
Backend routes:     6 files
SQLite tables:      11
Done items:         58 (was 42)

Key file sizes:
  app.js:                136 lines (was 968!)
  idx-daily-v2.js:       608 lines (NEW)
  screener.js frontend:  495 lines (was 403)
  screener.js backend:   739 lines (was 678)
  sector-intelligence:   627 lines
  gsearch.js:            517 lines
```

### Files Modified This Session
```
NEW:
  public/js/idx-daily-v2.js

MODIFIED:
  public/index.html
  public/js/app.js
  public/js/screener.js (frontend)
  public/js/compare.js
  public/js/gsearch.js
  public/js/watchlist.js
  public/js/sector-intelligence.js
  public/js/init.js
  public/css/components.css
  server/routes/idx.js
  server/routes/screener.js

REMOVED (replaced):
  public/js/idx.js → idx-daily-v2.js
  public/js/activity-spike.js → merged into idx-daily-v2.js
```

---

## 🎯 Next Targets — Prioritized

### Tier 1: Quick Wins (1-2 hours each)
| Feature | Value | Notes |
|---------|-------|-------|
| **Screener Presets** | High | 1-click templates: Asing Akumulasi, Breakout, Oversold Bounce, Value Picks. Just pre-defined rule groups. |
| **Filter bar di Flow** | Quick | Ticker filter + sector dropdown already works, just needs better UX polish |
| **IDX Daily ticker search autocomplete** | Medium | Like global search but inline in filter bar |

### Tier 2: High Impact Features (half day each)
| Feature | Value | Notes |
|---------|-------|-------|
| **Morning Dashboard** | Very High | Landing page saat buka app: digest hari ini, watchlist prices, fired alerts, top screener matches. Bisa jadi default tab atau popup. |
| **Screener Alert** | High | Auto-run saved screener, notify kalau ada saham baru masuk criteria. Cron job + notification. |
| **Insider Activity Alert** | High | Compare 2 monthly snapshots, detect accumulation/distribution per investor. |

### Tier 3: Power Features (1+ day each)
| Feature | Value | Notes |
|---------|-------|-------|
| **Konglomerat Network V2** | Medium | Full-screen D3 force graph, cross-ticker ownership, group clustering. Visual wow factor. |
| **Diary ↔ Data Integration** | Medium | Tag ticker in diary entry, auto-embed price snapshot, link to ticker page. |
| **Telegram Bot** | Medium | /digest, /alert, /screen commands. Remote monitoring. Needs external hosting or ngrok. |
| **Portfolio Tracker** | High | Track buy/sell entries, P&L calculation, cost basis. New table needed. |

### Tier 4: Infrastructure
| Feature | Value | Notes |
|---------|-------|-------|
| **Smoke tests** | Medium | Script that hits all endpoints, catches regressions |
| **API caching** | Medium | In-memory cache for /screener/run (expensive), /idx/unified |
| **Error boundaries** | Medium | Global try/catch frontend, structured error responses |
| **Database migration** | Low | Version-based schema upgrades |

---

## 🔮 Explorasi Kemungkinan Baru

### 1. 📱 PWA (Progressive Web App)
Banyu Langit bisa jadi installable app di desktop/mobile:
- Add `manifest.json` + service worker
- Offline support untuk data yang sudah di-cache
- Push notifications untuk alerts
- **Effort**: Low (2-3 hours), **Impact**: Medium

### 2. 🤖 AI-Powered Analysis
Integrate Claude API untuk:
- **Auto-generate trade thesis** dari screener results ("BBCA: uptrend, MACD golden cross, foreign accumulation 5 hari")
- **Diary auto-tag** — AI reads diary text, suggests ticker tags
- **Market commentary** — daily AI-generated digest
- **Effort**: Medium, **Impact**: High (differentiator)

### 3. 📊 Backtesting Engine
Test screener strategies on historical data:
- "Kalau saya beli semua stocks yang match screener ini 3 bulan lalu, berapa return-nya?"
- Win rate, average return, max drawdown
- Uses existing idx_daily historical data
- **Effort**: High (2-3 days), **Impact**: Very High

### 4. 🔔 Real-time Price via WebSocket
Replace Yahoo Finance polling with WebSocket:
- IDX doesn't have public WebSocket, but bisa pakai TradingView data
- Or scrape from RTI/Investing.com
- **Effort**: High, **Impact**: Medium (data delay acceptable for daily trader)

### 5. 📈 Multi-timeframe Analysis
Screener currently uses daily data. Could add:
- Weekly aggregation (for swing traders)
- Monthly aggregation (for position traders)
- Timeframe comparison ("daily bullish BUT weekly bearish")
- **Effort**: Medium, **Impact**: Medium

### 6. 🗺 Sector Money Flow Map
Visual treemap (like finviz.com map):
- Rectangles sized by market cap
- Colored by daily change or foreign flow
- Clickable to ticker page
- D3.js treemap layout
- **Effort**: Medium (1 day), **Impact**: High (very visual, great for quick overview)

### 7. 📋 Watchlist Groups
Instead of flat list:
- "Bluechip", "Speculative", "Monitoring"
- Each group with own alert thresholds
- Quick switch between groups
- **Effort**: Low, **Impact**: Medium

### 8. 🔄 Auto-Import Pipeline
Reduce manual work:
- **File watcher**: monitor folder for new XLSX, auto-upload
- **BEI scraper**: cron job to download daily data from IDX website
- **Amibroker bridge**: read directly from Amibroker database
- **Effort**: Medium-High, **Impact**: High (removes daily friction)

---

## 🏗 Recommended Sprint 6 Plan

**Focus: Stability + Quick Wins**

| Phase | Items | Time |
|-------|-------|------|
| A | Test all Sprint 5 features thoroughly | 1-2 hours |
| B | Screener Presets (3-4 templates) | 1 hour |
| C | Morning Dashboard (basic version) | 2-3 hours |
| D | Sector Money Flow Map (treemap) | 2-3 hours |
| E | Bug fixes from testing | varies |

**Why this order:**
- Testing first ensures Sprint 5 is solid
- Presets are trivial but high-value (most asked-for)
- Morning Dashboard gives daily utility
- Treemap is visually impressive and uses existing data

---

## 💾 Git Backup Commands

```powershell
cd C:\Project\banyu-langit
git add .
git commit -m "Sprint 5 complete: 5-tab redesign, Screener V5, IDX Daily unified, indicators"

# Tag this version
git tag v2.5-sprint5

# Verify
git log --oneline -5
```

---

*Generated: March 9, 2026*
