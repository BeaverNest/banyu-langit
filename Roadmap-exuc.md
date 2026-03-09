# 🌊 Banyu Langit — Execution Roadmap

## Current State (March 8, 2026 — Evening)

### Stats
- **48 files** total, 11 modified/new this session
- **14 JS frontend files** (was 12, added idx-daily-v2.js, removed idx.js + activity-spike.js)
- **739 lines** screener.js backend (was 573, added groups + spike + new fields)
- **136 lines** app.js (was 968 — massive reduction via redesign)
- **608 lines** idx-daily-v2.js (new, replaces idx.js 500+ lines + activity-spike.js 200+ lines)
- **495 lines** screener.js frontend (was 403, V5 with rule groups)
- **11 SQLite tables** + auto-migration for schema changes

### What's New This Session (Sprint 5)
- **Full tab redesign**: 5 tabs (Market | IDX Daily | Diary | Analysis | Insider)
- **Watchlist moved to topbar** dropdown (always accessible)
- **IDX Daily V2**: unified Rankings + Digest + Flow with column toggle + drag-reorder
- **Digest dashboard**: mockup-style cards (Top Gainer/Loser, Sector Activity, Most Active, Foreign Buy/Sell, Volume Spikes, Dormant→Active)
- **Screener V5**: Rule Groups (AND/OR mixed), bigger popup, localStorage persistence
- **New indicators**: Activity Score, Val/Freq/FNet Spike, EPS, Free Float %, Industry
- **Backend**: groups evaluation, activity spike in /run, unified endpoint /api/idx/unified

---

## ⚠️ Stability Assessment

### 🟢 Solid & Stable
| Area | Status |
|------|--------|
| Diary, Watchlist, Alerts | Production-ready, moved to dropdown |
| Screener V5 engine | Rule groups working, configs persist |
| Insider Ownership + Tags | Stable, CRUD working |
| Corporate Action system | Stable, auto-detect reliable |
| Settings modal (6 tabs) | Stable |
| Export CSV (4 types) | Stable |
| Global Search + Ticker Page | Stable, tab refs updated |
| Market Overview + News | Stable |
| Comparison (mixed mode) | Stable, moved to Analysis tab |

### 🟡 Working but Needs Testing
| Area | Issue | Risk |
|------|-------|------|
| IDX Daily V2 (new) | New unified code, drag-reorder | Medium — needs user testing |
| Screener Rule Groups (new) | Backend groups eval new | Medium — test multi-group combos |
| Watchlist dropdown (new) | Moved from tab to dropdown | Low — simpler UI |
| Analysis tab routing (new) | 4 sub-tabs, new routing | Low — mostly wiring |
| Correlation standalone tab | Wrapper function added | Low — existing code |

### 🟢 Technical Debt — Resolved
| Item | Status |
|------|--------|
| **app.js split** | ✅ Done — 136 lines (was 968) |
| **idx.js frontend split** | ✅ Replaced by idx-daily-v2.js |
| **activity-spike.js** | ✅ Merged into idx-daily-v2.js |
| **Screener OR logic** | ✅ Done — Rule Groups (AND/OR mixed) |

### 🔴 Technical Debt — Remaining
| Item | Impact | Effort |
|------|--------|--------|
| **insider.js split** | Medium — 566 lines | Medium |
| **No error boundary** | Medium — unhandled errors crash page | Medium |
| **No caching** | Medium — screener/run is heavy (computes all indicators) | Medium |
| **No tests** | Low now, High later | High effort |

---

## Sprint History

| Sprint | Focus | Status |
|--------|-------|--------|
| Sprint 1 | Infrastructure | ⏸ Partial (dev mode done, rest deferred) |
| Sprint 2 | Data Engine | ✅ Complete |
| Sprint 3 | Analysis & UX | ✅ Complete |
| Sprint 4 | Sector Intelligence & Polish | ✅ Complete |
| **Sprint 5** | **Full Tab Redesign + Screener V5** | **✅ Complete** |
| Sprint 6 | Testing + Stability | 🔜 Recommended next |
| Sprint 7 | Morning Dashboard + Presets | Planned |
| Sprint 8 | Insider Intelligence | Planned |
| Sprint 9 | Automation (Telegram, cron) | Planned |

---

## After Testing: Feature Priorities

| Priority | Feature | Value |
|----------|---------|-------|
| 1 | Screener Presets | 1-click templates (Asing Akumulasi, Breakout, Oversold Bounce) |
| 2 | Morning Dashboard | Daily landing page — digest + watchlist + alerts + screener |
| 3 | Insider Activity Alerts | Detect accumulation/distribution between snapshots |
| 4 | Konglomerat Network V2 | Full-screen D3 visualization |
| 5 | Telegram Bot | Remote monitoring |

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-05 | Skip Sprint 1, jump to Sprint 2 | Features > infra for solo project |
| 2026-03-07 | Backward CA adjustment | Industry standard |
| 2026-03-07 | Settings as modal popup | Cleaner UX |
| 2026-03-07 | Mixed comparison mode | More flexible than per-mode |
| 2026-03-07 | Tags CRUD in browser | Less friction than Excel |
| 2026-03-08 | Monthly aggregation for heatmap | Weekly too granular, unreadable |
| 2026-03-08 | Correlation 3 modes | More meaningful than top-N by value |
| 2026-03-08 | Extract sector-intelligence.js | app.js was 1072 lines, too large |
| 2026-03-08 | **5-tab redesign** | Reduce overlap, cleaner UX — Market/IDX/Diary/Analysis/Insider |
| 2026-03-08 | **Watchlist → topbar dropdown** | Always accessible, saves tab space |
| 2026-03-08 | **IDX Daily = unified** | Rankings + Activity Spike + Digest + Flow in 1 tab |
| 2026-03-08 | **Activity Spike merged** | Was standalone sub-tab, now columns in IDX Daily |
| 2026-03-08 | **Digest as default view** | Dashboard-first, detail second |
| 2026-03-08 | **Drag-drop column reorder** | More intuitive than dropdown selector |
| 2026-03-08 | **Rule Groups (AND/OR)** | `(Group1 AND) OR (Group2 AND)` — powerful screening |
| 2026-03-08 | **Config persist in localStorage** | Survives Docker rebuild — screener state not lost |
| 2026-03-08 | **Skip Dividend Yield data** | No reliable source yet, field ready when data available |

---

## File Changes — Sprint 5

### New Files
| File | Lines | Purpose |
|------|-------|---------|
| `public/js/idx-daily-v2.js` | 608 | Unified IDX Daily (replaces idx.js + activity-spike.js) |

### Modified Files
| File | Lines | Changes |
|------|-------|---------|
| `public/index.html` | 189 | 5-tab layout + watchlist dropdown |
| `public/js/app.js` | 136 | New routing, watchlist toggle (was 968!) |
| `public/js/screener.js` | 495 | V5: rule groups, persistence, new indicators |
| `public/js/compare.js` | 342 | Sub-tab routing fix |
| `public/js/gsearch.js` | 517 | Tab reference fixes |
| `public/js/watchlist.js` | 37 | Dropdown mode |
| `public/js/sector-intelligence.js` | 627 | Correlation wrapper |
| `public/js/init.js` | 3 | Updated init calls |
| `server/routes/idx.js` | 750 | Unified endpoint + no limit |
| `server/routes/screener.js` | 739 | Groups logic + spike calc + new fields |

### Removed Files
| File | Reason |
|------|--------|
| `public/js/idx.js` | Replaced by idx-daily-v2.js |
| `public/js/activity-spike.js` | Merged into idx-daily-v2.js |

---

*Last updated: 2026-03-08*
