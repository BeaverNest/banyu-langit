# Banyu Langit — Sprint 12 Backlog
# Updated 22 Maret 2026 (post Sprint 11)

---

## Sprint 11 Recap (13 items done)

1. Screener → Stock Detail link (sdOpenTicker)
2. Freq Analysis full stack (Block Trade/Retail Frenzy/Smart Accum/Dry Up)
3. Stock Detail Bloomberg redesign (compact header, signal table, chart full-width, 3-col tables, 2-col commentary+news)
4. News & Announcements panel per ticker (BEI + Google News)
5. Autocomplete ticker search in Stock Detail
6. IC Decay + Information Ratio (9 horizons × 6 factors)
7. Server-side screener freq vars (isBlockTrade, isSmartAccum, isDryUp, TickRatio, RelFreq, BidRatio)
8. Auto-Optimize Weights (grid search 10K+ combos, maximize IR)
9. Scoring weight persist fix (no reset on tab switch)
10. Backtest variable sync with screener
11. Custom Tickers AmiBroker-style column mapper
12. Settings modal enlarged (1600px)
13. CSV quoted field parser + Indonesian date formats (Februari 2026, Q1 2025, etc.)

---

## Sprint 12 — Priority Items

### 🔴 P0: Market Regime Tab (Top-Down Framework)
**Goal:** Before stock picking, user should see macro picture first.

**Architecture:**
```
Level 1: GLOBAL SENTIMENT
├── Custom tickers tagged as global_index (SPX, EIDO, Nikkei, HSI)
├── USD/IDR currency
├── Traffic light: 🟢 Risk-On / 🟡 Caution / 🔴 Risk-Off

Level 2: COMMODITY CYCLE
├── Custom tickers tagged as commodity (CPO, Coal, Nickel, Gold, Oil)
├── Each linked to IDX sector
├── Trend direction + 5D/20D change

Level 3: IDX MARKET REGIME
├── IHSG trend + foreign flow aggregate (foreign_trading table)
├── Market breadth: % stocks above MA20/MA50/MA200
├── New high vs new low count

Level 4: SECTOR RANKING
├── Sector relative strength vs IHSG
├── Foreign flow per sector (20D)
├── Click sector → drill down to top stocks

Level 5: DECISION MATRIX
├── Summary: Global/Commodity/IHSG/Sector signals
├── Final verdict: TRADE sector X,Y or SIDELINE
```

**Implementation:**
- New sub-tab in Analysis: "Market Regime"
- New server endpoint: `/api/idx/market-regime` (aggregate all data)
- Frontend: `market-regime.js` (new file)
- DB migration: add `role` and `linked_sector` fields to `custom_tickers`
- Consume custom tickers by category (global_index, commodity, currency, macro)

**Data already available:**
- `custom_ohlc` → SPX, commodities, EIDO, inflation
- `idx_indices` → IHSG composite
- `idx_daily` → breadth calculation
- `foreign_trading` → aggregate foreign flow
- `sectoral_movement` → sector performance
- `idx_fundamental` → sector/industry mapping

---

### 🔴 P1: Compare Tab → "Data Explorer" Rename + Enhancement
**Goal:** Support comparing any data type (stocks, commodities, macro, custom series)

**Items:**
1. Rename "Compare" → "Data Explorer" (or similar — decide name)
2. Correlation box: only show when ρ Corr button is clicked (toggle)
3. Dual Y-axis support for different scale data (e.g., inflation 2-5% vs IHSG 6000-7000)
4. Normalize mode toggle (% change from start) — already exists but verify works with custom tickers
5. Monthly data (macro) overlay on daily data — interpolation or step chart
6. File: `compare.js` (uploaded, ready to patch)

---

### 🟡 P2: Server-side Backtest Freq Vars
**Goal:** Freq analysis variables (isBlockTrade, isSmartAccum, etc.) should work in backtest formulas.

**Implementation:**
- Patch `routes/backtest.js` with same freq computation as `routes/screener.js`
- Variables: TickRatio, isBlockTrade, isRetailFrenzy, isSmartAccum, isDryUp, RelFreq
- Need to upload `routes/backtest.js`

---

### 🟡 P3: DB Migration — custom_tickers fields
**Goal:** Support `role` and `linked_sector` in custom_tickers for Market Regime tab.

**Implementation:**
- Add columns to `custom_tickers`: `role TEXT DEFAULT ''`, `linked_sector TEXT DEFAULT ''`
- Auto-migration in `db.js`
- Update Custom Tickers UI to save these fields (frontend already sends them)
- Update Custom Tickers table display to show linked_sector

---

### 🟡 P4: Morning Signal Dashboard
**Goal:** Landing page harian aggregating all signals.

**Content:**
- Top composite scores hari ini
- Fired screener alerts (new entries in top 20)
- Watchlist signals
- Foreign flow summary (market-wide)
- Sector rotation heatmap
- Market regime verdict
- 1-click to Stock Detail

**Depends on:** Market Regime tab (P0) for regime data

---

### 🟢 P5: Stock Detail Chart Fix
**Issue:** Chart sometimes renders half-width (needs resize after DOM settles)
**Current fix:** setTimeout 100ms + resize 300ms — may need better approach (ResizeObserver)

---

### 🟢 P6: Unified Variable Registry
**Goal:** Single source of truth for AFL variables across screener, backtest, stock detail.
**Current state:** Each maintains its own list — error-prone and out of sync.
**Implementation:** Server endpoint `/api/variables` that returns all available variables with metadata. Frontend consumes for reference panels.

---

### 🟢 P7: Accurate OHLC Re-import
**Issue:** Historical open_price approximated from prev_close.
**Fix:** Re-download via IDX-API Deno bridge (files: idx-api-bridge.js, StockSummary.ts, TradingDaily.ts)

---

### 🟢 P8: QFChart + PineTS Integration
- QFChart: Apache ECharts-based charting with drawing tools
- PineTS: Pine Script v5/v6 transpiler as unified indicator engine
- Both from QuantForge, need local download to `public/lib/`

---

### 🟢 P9: MCP Server for Claude Desktop
- Zero extra cost (uses Pro subscription)
- Exposes tools: stock data, scoring, phase, flow, fundamentals, search, sync
- Decision pending

---

## Known Issues
| Issue | Impact | Status |
|-------|--------|--------|
| Stock Detail chart half-width | Visual | Workaround (setTimeout resize) |
| Backtest freq vars not evaluated | Functional | Need routes/backtest.js patch |
| custom_tickers missing role/linked_sector columns | DB | Need migration |
| Backlog.md and Roadmap-exuc.md outdated (still Sprint 8) | Docs | Update needed |
| Compare tab correlation always visible | UX | Toggle needed |
| Monthly macro data overlay on daily chart | UX | Need dual Y-axis or interpolation |

---

## Recommended Sprint 12 Execution Order

1. **DB Migration** (P3) — 5 min, unblocks P0
2. **Market Regime Tab** (P0) — main feature, 1-2 sessions
3. **Compare Enhancement** (P1) — rename + correlation toggle + dual axis
4. **Backtest Freq Vars** (P2) — sync with screener
5. **Morning Signal** (P4) — aggregator, after Market Regime done

---

*Sprint 11 = 13 items. Sprint 12 focus: Top-Down Framework + Data Explorer.*
