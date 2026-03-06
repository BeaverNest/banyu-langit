# 🌊 Banyu Langit — Execution Roadmap

## Current State (March 2026)
- V2 deployed, ~35 files, all features working
- Light mode default, chart hidden on startup
- Corporate Action system live (auto-detect, confirm, adjusted OHLC, screener integrated)
- Settings modal (5 tabs: Upload, Database, CA, Export, Preferences)
- IDX Daily redesigned (sector/industry filter, compact digest)
- Screener = top tab with Sector Overview + Ticker Comparison
- Market Overview = merged Index/Commodities/Currencies
- Export CSV available (4 types)
- Next: Comparison Phase 2 (sector/industry/konglomerat), Morning Dashboard, Konglomerat Network

---

## Sprint 1: Infrastructure ⏸ Partial
- [x] Dev mode (docker-compose.dev.yml + nodemon)
- [ ] Error handling & logging
- [ ] Database migrations
- [ ] `.env` support
- [ ] Unit tests

---

## Sprint 2: Data Engine ✅ Complete
- [x] Corporate Action auto-detect + confirm/dismiss
- [x] Adjusted OHLC (backward adjustment)
- [x] Screener uses adjusted price
- [x] Settings modal redesign (full popup, 5 tabs)
- [x] Database stats + gap detection
- [x] Export CSV (4 types)
- [x] App preferences (theme, chart default)
- [x] Light mode + chart hidden default

---

## Sprint 3: Analysis & UX ✅ Mostly Complete
- [x] IDX Daily redesign (filter bar, compact digest, sector/industry dropdown)
- [x] Screener as top-level tab
- [x] Sector Overview with drill-down (sector → industry → ticker)
- [x] Ticker Comparison chart (normalized %, range 1M-ALL, summary cards)
- [x] Market Overview (merged 3 categories into 1 scrollable tab)
- [ ] **Comparison Phase 2** — sector vs sector, industry vs industry, konglomerat vs konglomerat
- [ ] Morning Dashboard
- [ ] Compare mode foreign flow overlay

---

## Sprint 4: Konglomerat & Relationships 🔜 Next
> Goal: Map Indonesian conglomerate ownership + political connections

### 4A. Konglomerat Network
- [ ] Visualize: konglomerat group → owned tickers → foreign flow
- [ ] Data: investor_groups + ticker_groups already in DB
- [ ] Cross-reference ownership connections
- [ ] Interactive D3 network diagram

### 4B. Comparison Phase 2
- [ ] Sector vs Sector (aggregate % change)
- [ ] Industry vs Industry
- [ ] Konglomerat vs Konglomerat (portfolio performance)

### 4C. Morning Dashboard
- [ ] Landing page: digest, watchlist, alerts, screener matches
- [ ] Auto-refresh

---

## Sprint 5: Export & Reporting
- [x] CSV export (4 types) ✅
- [ ] Ticker detail → PDF report
- [ ] Insider ownership → CSV
- [ ] Scheduled reports (daily digest HTML)

---

## Sprint 6: Automation
- [ ] Telegram Bot
- [ ] Auto-fetch BEI data
- [ ] API V2 + Webhooks

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-05 | Skip Sprint 1, jump to Sprint 2 | Features > infra for solo project |
| 2026-03-06 | CA via listed_shares auto-detect | Data already in idx_daily, reliable |
| 2026-03-07 | Backward adjustment (not forward) | Industry standard |
| 2026-03-07 | CA endpoints inside idx.js | Tight coupling, no index.js changes |
| 2026-03-07 | Settings as modal popup | Cleaner UX than dropdown |
| 2026-03-07 | Light mode + chart hidden default | Cleaner first impression |
| 2026-03-07 | Export CSV client-side (Blob) | No backend changes, instant download |
| 2026-03-07 | Screener as top-level tab | Most used feature, deserves prominence |
| 2026-03-07 | Sector Overview inside Screener | Related to screening workflow |
| 2026-03-07 | Comparison uses /api/idx/flow | Reuse existing endpoint, no new backend |
| 2026-03-07 | Market categories merged | Less tabs, better overview |

---

*Last updated: 2026-03-07*