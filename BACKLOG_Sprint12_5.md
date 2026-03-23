# Banyu Langit — Sprint 12.5 Backlog
# Updated 22 Maret 2026 (post Sprint 12 session)

---

## Sprint 12 Recap (done this session)

### P0: Market Regime Tab ✅
- 5-level top-down: Global Sentiment → Commodity Cycle → IDX Market → Sector Ranking → Decision Matrix
- Endpoint: `/api/idx/market-regime` (aggregates custom_ohlc, idx_indices, foreign_trading, sectoral_movement, company_profiles)
- Sector name mapping: English (sectoral_movement) → Indonesian (company_profiles) via SECTOR_MAP
- F.Net per sector via JOIN idx_daily + company_profiles
- Top Stocks per sector by composite score (fallback: by value)
- Market Breadth: % above MA20/MA50/MA200, new high/low count
- Decision Matrix: bull/bear point scoring → TRADE/SELECTIVE/SIDELINE verdict
- Sector clickable → opens Screener (pending: Sector variable support)
- Top Stocks clickable → opens Stock Detail
- File: NEW `market-regime.js`, endpoint in `idx.js`

### P1: Data Explorer (was Compare) ✅
- Renamed Compare → Data Explorer
- Correlation toggle: snapshot cards only show when ρ Corr button active
- Dual Y-axis: absolute price mode for exactly 2 items, auto-fallback to normalized for 3+
- Step interpolation for sparse monthly data (inflation, GDP)
- Autocomplete ticker input
- Chart height increased to 450px base
- Tooltip shows absolute value alongside % change
- Timeframe button highlight fix
- File: `compare.js` V3

### P3: DB Migration ✅
- Added `role` and `linked_sector` columns to `custom_tickers`
- Auto-migration in `db.js`
- CSV upload saves role + linked_sector

### EOD Fetcher Tab ✅
- New Settings tab: 🌐 EOD Fetcher
- Yahoo Finance: US stocks, indices, commodities, forex (no API key, full history)
- CoinGecko: crypto (no API key, 365 days)
- Quick Add buttons: popular US stocks, crypto, forex
- Per-ticker 🔄 Sync button + bulk "Sync Stale" (>7 days)
- Stale indicator (⚠ red) in table
- Yahoo symbol mapping: SPX→^GSPC, XAUUSD→GC=F, etc.
- Files: NEW `eod-fetcher.js` (server module), `settings.js` updated, `idx.js` endpoints

### Other Fixes
- Custom Tickers: stale data warning (⚠ Xd ago / ✓ Fresh)
- index.html: Market Regime as first Analysis tab, EOD Fetcher nav in Settings

---

## Sprint 12.5 — Next Session Priority Items

### 🔴 P0: Screener Redesign + String Variables
**Goal:** Modern screener UI (popup formula modal) + support Sector/Industry string filtering

**Part A: Server-side (routes/screener.js)**
1. Tokenizer: add STRING token type for `"quoted text"`
2. Evaluator: handle string `==`/`!=` comparison (keep existing toNum for numbers)
3. Add to ctx: `Sector` (from fund.sector), `Industry` (from fund.industry), `Board` (from company_profiles)
4. detectNeeds: add `needs.fund` flag when Sector/Industry used

**Part B: Frontend (screener.js)**
1. Formula button → popup modal overlay
2. Modal contains: textarea (formula input) + variable reference grid (categorized)
3. Variable grid: clickable to insert into formula
4. Templates as buttons inside modal
5. Run button in modal → close modal + show results
6. Results table stays in main view (not in modal)
7. Reference: Stockbit-style layout (screenshot provided)

**Files needed:**
- `server/routes/screener.js` (uploaded, 1094 lines — AFL parser + evaluator)
- `public/screener.js` (in project files, 500 lines — frontend UI)
- `public/components.css` (uploaded — for modal styling)

**Key code locations:**
- Tokenizer: `routes/screener.js` line 438-484
- Evaluator: `routes/screener.js` line 487-560
- Context (ctx): `routes/screener.js` line 398-423
- Frontend aflRun: `public/screener.js` line 449-467
- Variable list: `public/screener.js` ~line 210-260

---

### 🟡 P1: Market Regime Polish
1. Sector 20D change display (data already computed, verify rendering)
2. Market Intelligence Stock List: fix sector filter (idx_daily has no sector column — need JOIN or different approach)
3. Commodity linked_sector: UI to set linked_sector per custom ticker
4. Breadth history chart (currently empty — need pre-computed data or compute on-the-fly for last 20 days)

### 🟡 P2: Backtest Freq Vars
- Patch `routes/backtest.js` with freq computation from `routes/screener.js`
- Variables: TickRatio, isBlockTrade, isRetailFrenzy, isSmartAccum, isDryUp, RelFreq

### 🟢 P3: Morning Signal Dashboard
- Depends on Market Regime (done) + Screener Sector support
- Landing page: top scores, fired alerts, watchlist signals, regime verdict
- 1-click to Stock Detail

### 🟢 P4: Unified Variable Registry
- Server endpoint `/api/variables` returning all AFL variables with metadata
- Frontend consumes for reference panels in screener + backtest

---

## Known Issues
| Issue | Impact | Status |
|-------|--------|--------|
| Screener: `Sector == "X"` fails (Unknown variable) | Functional | **Fix in P0** |
| Screener: tokenizer doesn't handle quoted strings | Functional | **Fix in P0** |
| Market Regime: sector click → Screener but Sector var not supported | UX | **Fix in P0** |
| sectoral_movement latest date (Feb 27) behind idx_daily (Mar 17) | Data gap | Need sync |
| Market Intelligence Stock List: sector filter 0 results | Bug | idx_daily has no sector column |
| Breadth history chart empty | Visual | Need computation |
| Backtest freq vars not evaluated | Functional | P2 |
| EOD Fetcher: Yahoo Finance may rate limit from Docker | Reliability | Monitor |

---

## Data Status
| Source | Latest Date | Notes |
|--------|-------------|-------|
| idx_daily | 2026-03-17 | Primary IDX data |
| sectoral_movement | 2026-02-27 | 3 weeks behind — needs sync |
| daily_scores | Needs check (calc_date column) | May need recalc |
| custom_ohlc (API) | 2026-03-20~22 | AAPL, SPY, MSFT, BTC via EOD Fetcher |
| custom_ohlc (CSV) | Varies | XAUUSD, commodities from Investing.com CSV |

---

## Files Changed in Sprint 12 (for git commit)
```
NEW:
  server/routes/eod-fetcher.js    — Yahoo Finance + CoinGecko EOD fetcher
  public/market-regime.js         — Market Regime 5-level top-down

MODIFIED:
  server/db.js                    — custom_tickers migration (role, linked_sector)
  server/routes/idx.js            — market-regime + fetch-eod + sync-stale endpoints
  public/compare.js               — V3 Data Explorer
  public/settings.js              — EOD Fetcher tab
  public/app.js                   — Market Regime routing
  public/index.html               — Market Regime tab + EOD nav + Data Explorer label
```

---

## Recommended Sprint 12.5 Execution Order

1. **Screener string variables** (server-side) — 15 min, unblocks sector drill-down
2. **Screener UI redesign** (frontend) — 30-45 min, modal + variable grid
3. **Market Regime polish** — breadth chart, linked_sector UI
4. **Backtest freq vars** — sync with screener
5. **Morning Signal** — aggregator dashboard

---

*Sprint 12 = P0+P1+P3+EOD (8 major items). Sprint 12.5 focus: Screener modernization.*
