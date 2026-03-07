# 🌊 Banyu Langit — Execution Roadmap

## Current State (March 8, 2026)

### Stats
- **48 files** (was 35), all features working
- **12 JS frontend files** (was 9, added sector-intelligence.js)
- **573 lines** screener.js backend (was 292, added sector-intel + correlation + fundamental-lists)
- **968 lines** app.js (was 1072, extracted sector code)
- **588 lines** sector-intelligence.js (new)
- **10 SQLite tables** + auto-migration for schema changes

### What's New This Session
- Sector Intelligence: Rotation Heatmap, Flow Timeline, Correlation (3 modes)
- Font consistency fix across all 6 CSS files
- Ticker Page flow table proportional layout
- Stock table: sortable + column toggle
- Correlation: ownership-based, industry-based, custom + common owners
- README.md comprehensive documentation

---

## ⚠️ Stability Assessment

### 🟢 Solid & Stable
| Area | Status |
|------|--------|
| Diary, Watchlist, Alerts | Production-ready, rarely touched |
| IDX Daily (rankings, flow, anomaly, digest) | Stable, well-tested |
| Screener engine | Stable, 292 lines backend |
| Insider Ownership + Tags | Stable, CRUD working |
| Corporate Action system | Stable, auto-detect reliable |
| Settings modal (6 tabs) | Stable |
| Export CSV (4 types) | Stable |
| Global Search + Ticker Page | Stable |
| Market Overview | Stable (depends on Yahoo Finance) |

### 🟡 Working but Needs Polish
| Area | Issue | Risk |
|------|-------|------|
| Sector Intelligence (new) | New code, lightly tested | Medium — complex SQL queries |
| Correlation (new) | Ownership mode can be slow for large datasets | Medium — O(n²) pair comparison |
| Upload logs/duplicate detect | Backend ready, frontend deploy issue | Low — just deployment |
| app.js (968 lines) | Still large, mixes settings + compare + misc | Low — works but hard to modify |

### 🔴 Technical Debt — Priority
| Item | Impact | Effort |
|------|--------|--------|
| **app.js split** | High — 968 lines is hard to maintain | Medium — 2-3 new files |
| **No `.env` support** | Medium — PORT, DB_PATH hardcoded | Low — 30 min |
| **No error boundary** | Medium — unhandled errors crash page | Medium |
| **No caching** | Medium — screener/run recalculates every time | Medium |
| **No tests** | Low now, High later — regressions possible | High effort |

---

## Recommended Next: Stability Sprint

Before adding new features, I recommend a **stability sprint** to:

### Phase A: Code Organization (reduce maintenance risk)
1. **Split app.js** → `settings.js` (~300 lines), `compare.js` (~200 lines), `tags-editor.js` (~200 lines), keep `app.js` as router (~250 lines)
2. **`.env` support** → PORT, DB_PATH, LOG_LEVEL configurable
3. **Fix deploy pipeline** → ensure all frontend changes actually reach container (the recurring `--no-cache` rebuild issue)

### Phase B: Performance & Resilience
4. **In-memory cache** for heavy endpoints: `/screener/run`, `/screener/sector-intelligence`, `/screener/correlation`
5. **Error boundaries** — global try/catch in frontend, structured error responses
6. **Correlation optimization** — pre-compute common owners map once, not per-pair

### Phase C: Testing & Validation
7. **Smoke tests** — script that hits every API endpoint and checks 200
8. **Indicator unit tests** — MA, MACD, Stochastic calculation correctness

---

## After Stability: Feature Priorities

| Priority | Feature | Value |
|----------|---------|-------|
| 1 | Morning Dashboard | Daily landing page — digest + watchlist + alerts + screener |
| 2 | Screener Presets | 1-click templates for common strategies |
| 3 | Insider Activity Alerts | Detect accumulation/distribution between snapshots |
| 4 | Konglomerat Network V2 | Full-screen D3 visualization |
| 5 | Telegram Bot | Remote monitoring |

---

## Sprint History

| Sprint | Focus | Status |
|--------|-------|--------|
| Sprint 1 | Infrastructure | ⏸ Partial (dev mode done, rest deferred) |
| Sprint 2 | Data Engine | ✅ Complete |
| Sprint 3 | Analysis & UX | ✅ Complete |
| Sprint 4 | Sector Intelligence & Polish | ✅ Complete |
| **Sprint 5** | **Stability & Refactor** | **🔜 Recommended next** |
| Sprint 6 | Morning Dashboard + Presets | Planned |
| Sprint 7 | Insider Intelligence | Planned |
| Sprint 8 | Automation (Telegram, cron) | Planned |

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
| 2026-03-08 | Correlation 3 modes (ownership/industry/custom) | More meaningful than top-N by value |
| 2026-03-08 | Extract sector-intelligence.js | app.js was 1072 lines, too large |
| 2026-03-08 | table-layout:auto over fixed | Fixed widths cause gaps |
| 2026-03-08 | **Recommend stability sprint before new features** | Code growing fast, need foundation |

---

*Last updated: 2026-03-08*
