# Banyu Langit — Execution Roadmap
# Updated 13 Maret 2026 (post Sprint 8)

---

## TL;DR

Banyu Langit = **Bloomberg Terminal mini untuk IDX**. Docker, localhost:3003. Solo project.

**Sprint 8 (selesai):**
- **1-Click Sync** dari browser — Deno HTTP server (:3456) + proxy, 3 modes (Daily/Full/Cron)
- **39 tabel bridge** — 1.3M rows di trading.db, dari 8 tabel jadi 30
- **Bloomberg redesign** — black/amber/red palette, red topbar, wider ticker page
- **Data utilization** — IDX indices replace Yahoo, BEI announcements (77K), suspend badges, dividends, bid/offer chart

**Sprint 8.5 (next):**
1. Fundamental tab proper redesign (fix units, remove duplikasi, analytical flow)
2. Macro foreign/domestic flow chart
3. market_calendar fix gap detection
4. Sector enrichment dari data baru

---

## Sprint 8 — Completed

### 1-Click Sync System
Dari 4-step manual process jadi 1 tombol di browser.

**Sebelum:** PowerShell → Deno script → browser → Import All (4 steps, 2 tools)
**Sesudah:** Browser → Settings → Sync Center → Daily Sync (1 click)

**Files:**
- `IDX-API-main/deno-server.ts` — Deno HTTP server, 38 sync functions, port 3456
- `server/utils/deno-proxy.js` — Node.js proxy: forward to Deno, poll progress, auto bridge import
- `start-deno.ps1` — Start Deno server (1x, biarkan running)

**3 Sync Modes:**
| Mode | Duration | What |
|------|----------|------|
| Daily | ~8s | Stock + Index hari ini |
| Full | ~12min | 5 hari + screener + profiles + monthly |
| Cron All | ~16min | Semua 38 Deno sync functions |

**Catatan:** `docker-compose.yml` perlu `extra_hosts: host.docker.internal:host-gateway` supaya Docker bisa reach Deno di Windows. Sudah ada di current compose.

### Bridge Expansion (39 Tabel)
`idx-api-bridge.js` sekarang punya 37 import functions. `db.js` punya 30 tabel.

**Total: 1,329,078 rows** di trading.db:

| Tabel | Rows | Source |
|-------|------|--------|
| idx_daily (stock_summary) | 270,897 | OHLCV + foreign flow |
| trading_ss | 879,591 | Historical OHLCV 2021+ |
| company_announcements | ~77,000 | BEI news feed |
| broker_summary | 25,814 | Broker trading activity |
| idx_indices (index_summary) | 12,754 | 45 index time series |
| daily_index | 12,349 | Index close per day |
| market_calendar | 11,537 | BEI calendar (holidays) |
| index_chart | 10,620 | Index chart data |
| sectoral_movement | 5,880 | Sector performance |
| company_suspends | 2,848 | Suspend/unsuspend |
| issued_history | 1,645 | Share issuance |
| idx_fundamental | 958 | Screener snapshot |
| company_profiles | 957 | Company master |
| security_stocks | 956 | Security master |
| + 16 smaller tables | ~3,500 | Various reference data |

### Bloomberg Redesign
- **Dark theme:** `--bg0:#000000` (true black), `--bl:#ff9800` (amber accent)
- **Red topbar:** `--topbar-bg:#b71c1c`, white text, centered search
- **Logo:** "BANYU LANGIT" full text (was "BL")
- **Ticker page:** widened 860px → 1100px

### Data Utilization
| Feature | Data Source | Impact |
|---------|-----------|--------|
| IDX Indices in Market Overview | index_list (45 indices) | Replace Yahoo, instant load |
| BEI Announcements tab | company_announcements (77K) | Replace Google News dependency |
| Announcement popup + PDF links | attachments JSON | Direct access to BEI filings |
| Suspend badge ⚠ | company_suspends | Visual warning in Rankings + ticker page |
| Dividend History + Yield | dividends (111 rows) | Fundamental tab enrichment |
| Financial Statements | financial_ratios (139 rows) | EPS, book value, assets, equity |
| Bid/Offer Volume chart | idx_daily bid_vol/offer_vol | Replace foreign flow in Overview |
| Bid/Offer ratio bar | idx_daily | Quick visual sentiment |
| News tab per ticker | company_announcements filtered | Ticker-specific BEI filings |

---

## Kondisi App Sekarang

### Stabil & Production-Ready
| Area | Status |
|------|--------|
| 1-Click Sync (Daily/Full/Cron) | ✅ Tested, all 38 functions pass |
| Bridge Import (37 functions) | ✅ 1.3M rows |
| Sync Center UI | ✅ Deno health, progress, log |
| Market Overview (IDX indices) | ✅ From database, no Yahoo |
| BEI Announcements | ✅ 77K rows, search, popup, PDF |
| Suspend badges | ✅ Rankings + ticker page |
| Dividend History | ✅ Yield calculation |
| IDX Daily (Digest/Rankings/Flow) | ✅ Stable |
| Screener V5 + AFL | ✅ Stable |
| Backtesting V7 | ✅ Stable |
| Sector Intelligence | ✅ Stable |
| Portfolio + Kelly | ✅ Stable |
| Insider Ownership | ✅ Stable |
| Diary | ✅ Stable |

### Perlu Polish
| Area | Issue |
|------|-------|
| Fundamental tab | Data asal ditempel, unit salah (K vs T), duplikasi dengan Quarterly |
| Financial Ratios display | "Assets: 7K" harusnya "7T" — unit mismatch |
| Price Performance | 4W/13W/26W/52W = 0% dari screener |
| Gap detection | 414 gaps, market_calendar data ready tapi belum dipakai |
| Yahoo fallback | Commodities/currencies masih Yahoo (no IDX equivalent) |

### Known Issues
| Issue | Impact | Fix |
|-------|--------|-----|
| Financial ratios unit | Display salah | Sprint 8.5 |
| Fund + Quarterly duplikasi | Confusing UX | Sprint 8.5 redesign |
| insider.js 566 lines | Hard to maintain | Future split |
| No error boundary | JS error = blank page | Future |

---

## Sprint 8.5 Plan — Ticker Page Polish

### Phase A: Fundamental Tab Redesign
- Fix financial_ratios unit scaling
- Merge Financial Statements + Quarterly into one coherent section
- Design analytical flow: Valuation → Trend → Dividends → Classification
- Remove redundancy

### Phase B: Data Utilization
- Macro Foreign vs Domestic flow chart (IDX Daily header)
- market_calendar → fix 414 gap detection
- sectoral_movement → enrich Sectors tab
- industry_trading PER/PBV → Sectors Overview

---

## Quant Trading Roadmap (Sprint 9+)

### Architecture
```
Data (39 tabel, 1.3M rows)
    │
    ▼
Composite Score (multi-factor ranking)
    │
    ▼
Backtest (simulate trading based on score)
    │
    ▼
Monte Carlo (stress test robustness)
    │
    ▼
IC Tracking (validate prediction quality)
    │
    ▼
Forward Test (paper trading)
    │
    ▼
Live Trading (manual execution with signals)
```

### Composite Score Factors
- **Momentum**: MA position, price change %, relative strength vs sector
- **Value**: PER, PBV, ROE relative to sector
- **Flow**: Foreign net accumulation, broker pattern
- **Activity**: Volume/frequency spike, bid-offer imbalance
- **Weights**: Configurable, default equal

### Technology Candidates
- **PineTS** — Pine Script transpiler, run TradingView indicators di JS
- **QFChart** — Financial charting with drawing tools, multi-pane indicators

---

## Daily Workflow

```
1. Start Deno server (1x saja):
   .\start-deno.ps1

2. Start Docker (1x saja):
   docker compose up -d

3. Daily routine:
   - Buka localhost:3003
   - Settings → Sync Center → Daily Sync
   - Browse: IDX Daily, Analysis, Portfolio
   
4. Weekly/Monthly:
   - Settings → Sync Center → Full Sync (atau Cron All)
   - Check BEI Announcements
   - Review Sector Rotation
```

---

## Git Backup

```powershell
cd C:\Project\banyu-langit
git add .
git commit -m "Sprint 8: 1-click sync + 39 tables + Bloomberg redesign + data utilization"
git tag v3.0-sprint8
```

---

*Sprint 8 done (14 items). Sprint 8.5: Fundamental redesign + data polish.*
*Sprint 9: Quant foundation — composite score + morning signal dashboard.*
