# 🌊 Banyu Langit — Execution Roadmap
# Handover per 12 Maret 2026

---

## ⚡ TL;DR Buat Yang Baru Join

Banyu Langit = **Bloomberg Terminal mini untuk IDX**. Docker, localhost:3003. Solo project.

**Hari ini (Sprint 6) yang dikerjakan:**
1. Bangun **Backtesting Engine dari nol** — sekarang bisa test formula trading di data historis, hasilnya lengkap kayak AmiBroker (equity curve, Monte Carlo, MAE/MFE, monthly returns, dll)
2. Tambah **Index Summary upload** (data 45 indeks BEI) buat benchmark backtesting
3. Temukan **IDX API** yang bisa automate semua data upload — belum diimplementasi

**Next (Sprint 7):**
1. **Integrasi IDX API** — hapus semua manual upload, data masuk otomatis
2. **Redesign UI** — Bloomberg Terminal style (dark, data-dense, monospace)

---

## Apa Yang Barusan Dikerjakan (Sprint 6)

### Backtesting Engine V7
Dari nol sampai production dalam 1 session. Ini **fitur paling complex** di app ini.

**Cara kerja:**
1. User tulis formula entry (kapan beli) + exit (kapan jual) pakai AFL-style syntax
2. Engine scan semua saham di setiap hari trading historis
3. Kalau formula match → simulasi beli, hold, cek exit formula tiap hari
4. Kumpulkan semua trades → hitung stats, gambar chart

**File yang terlibat:**
- `server/routes/backtest.js` (~400 baris) — simulation engine, Monte Carlo, stats
- `public/js/backtest.js` (~300 baris) — UI, charts (SVG), tables

**Iterasi yang dilalui:**
- V1: Basic engine, 0 trades bug (position sizing salah)
- V2: Fix position sizing, tambah debug endpoint
- V3: Tambah exit formula, MAE/MFE, exposure, consecutive stats
- V4: Scope filter, formula reference, flexible benchmark
- V5: Fix SQL `!=""` bug, autocomplete
- V6: Fix autocomplete click handler (mousedown vs onclick)
- **V7 (final)**: Force cutloss toggle, open positions tracking, MC equity band chart, AmiBroker-complete stats, fixed-width trade table columns

**Bugs yang sudah difix:**
- `idx < 50` skip semua saham → dihapus, pakai null check
- Position sizing `Math.floor(capital / (maxPos * price / 100)) * 100` → overflow → rewrite ke `allocation / price` approach
- SQLite `!=""` → `!=''` (double quote = column identifier di SQLite)
- `/scopes` endpoint 500 error → sama SQL bug + missing try/catch
- Autocomplete dropdown tidak bisa diklik → inline onclick string tidak capture closure → pakai `addEventListener('mousedown')`

**Yang masih perlu diperhatikan:**
- Monte Carlo semua percentile hasilnya sama kalau trades sedikit (< 20)
- Autocomplete kadang tidak responsive — perlu debounce
- Trade table column width mungkin perlu fine-tune tergantung data

### Index Summary Upload
- Tabel baru `idx_indices` di `server/db.js`
- 5 endpoint di `server/routes/idx.js`: upload, stats, latest, history, list
- Upload handler di `public/js/settings.js`
- Format: XLSX dari idx.co.id → Historical → Download
- Auto-detect tanggal dari filename `Index_Summary-YYYYMMDD.xlsx`

### Perubahan Lain
- Logo watermark dihapus → bull/bear logo jadi site logo + favicon
- `public/index.html`: Backtest sub-tab, script tag, logo
- `public/js/app.js`: Backtest routing di `anaSubTab()`
- `server/index.js`: Mount `/api/backtest` route

---

## Kondisi App Sekarang

### Yang Stabil ✅
| Area | Catatan |
|------|---------|
| Diary, Watchlist, Alerts | Production-ready, tidak disentuh session ini |
| Screener V5 | Rule groups + formula, stable |
| Insider Ownership | Network graph, tags, CRUD, stable |
| Corporate Action | Auto-detect, confirm/dismiss, stable |
| Settings 7 tab | Semua upload type working |
| Portfolio + Kelly | Stable |
| IDX Daily V2 | Stable setelah Sprint 5 |
| Market + Commodities | Stable (tapi Yahoo Finance kadang rate limit) |
| Index Summary upload | Baru, tapi simple — harusnya stable |

### Yang Perlu Diawasi 🟡
| Area | Kenapa |
|------|--------|
| Backtesting Engine | Baru, complex, banyak edge case |
| Backtest autocomplete | Working tapi UX bisa lebih smooth |
| Backtest trade table | Column width sudah di-fix tapi mungkin perlu adjust |

### Yang Bermasalah 🔴
| Area | Masalah |
|------|---------|
| Yahoo Finance | Rate limit dari Docker, kadang timeout |
| Commodities tab | Kadang stuck loading |
| insider.js | 566 baris, perlu di-split |
| Error boundary | Tidak ada — JS error = blank page |

---

## Database Schema (13+ tabel)

Tabel utama yang sering dipakai:
- `idx_daily` — OHLCV harian, UNIQUE(trade_date, code)
- `idx_indices` — index summary, UNIQUE(trade_date, index_code)  ← **BARU**
- `idx_fundamental` — PER/PBV/ROE, UNIQUE(snapshot_month, code)
- `holdings` — insider ownership, UNIQUE(snapshot_date, code, investor)
- `corporate_actions` — split/bonus, UNIQUE(code, ex_date)
- `portfolio_trades` — trade tracker
- `screener_configs` — saved screener configs
- `investor_groups/rules/overrides` — tagging system

Data storage: `data/trading.db` (SQLite, WAL mode)
Diary + watchlist + alerts: JSON files di `data/`

---

## Arsitektur File

```
banyu-langit/
├── public/
│   ├── index.html          ← 6 tab layout, semua script tags
│   ├── logo-watermark.png  ← bull/bear logo
│   ├── css/ (6 files)      ← base, components, diary, insider, market, watchlist
│   └── js/ (17 files)      ← app, backtest, commodities, compare, diary, 
│                               fund-upload, gsearch, idx-daily-v2, init,
│                               insider, portfolio, screener, sector-intelligence,
│                               settings, tags-editor, utils, watchlist
├── server/
│   ├── index.js            ← Express server, route mounting, ticker API, auth
│   ├── db.js               ← SQLite schema, 13+ tabel, helpers
│   ├── routes/             ← backtest, diary, idx, insider, market, portfolio,
│   │                          screener, watchlist
│   └── utils/              ← yahoo.js, news.js, normalize.js
├── docker-compose.yml      ← production
├── docker-compose.dev.yml  ← dev mode (nodemon + bind mount)
└── Dockerfile
```

---

## Sprint 7 Plan (Next)

### Phase A: IDX API (prioritas 1)

**Context:** IDX API wrapper (github.com/NeaByteLab/IDX-API) pakai Deno. Kita perlu extract HTTP endpoint URLs dari source code-nya, lalu buat Node.js fetcher sendiri. README-nya sudah di-upload session ini.

**Endpoints yang dibutuhkan:**
| API Call | Data | Target Tabel |
|----------|------|-------------|
| `getStockSummary(YYYYMMDD)` | OHLCV + foreign flow semua saham | `idx_daily` |
| `getIndexSummary(YYYYMMDD)` | 45 indeks BEI | `idx_indices` |
| `syncFinancialRatio(year, month)` | PER, PBV, ROE, DER | `idx_fundamental` |
| `syncStockSplit(year, month)` | Split ratio + tanggal | `corporate_actions` |
| `syncCompanyDividend(year, month)` | Dividend per share | `quarterly_financials` / baru |
| `getIndexList()` | Real-time index prices | Replace Yahoo Finance |
| `syncCompanyProfile()` | Company metadata | Enrich ticker page |

**Strategy:**
1. Data XLSX lama (2021-2026) tetap di database — tidak dihapus
2. API data UPSERT — update yang ada, insert yang baru
3. Backfill: loop tanggal-tanggal yang missing
4. Daily: cron atau on-startup sync

**Risk:**
- idx.co.id API bisa berubah tanpa notice
- Rate limiting (perlu delay antar request)
- Data format mungkin beda dari XLSX

### Phase B: Bloomberg Redesign (prioritas 2)

**Scope:**
- Dark theme default (sekarang light)
- Data-dense: kurangi padding/margin, compact cards
- Monospace semua angka
- Lazy load: tab hanya render saat diklik (sekarang semua sekaligus)
- Reduce DOM: less HTML elements, lighter

**Constraint:** Semua feature yang ada HARUS tetap berfungsi. Ini redesign visual, bukan feature removal.

---

## Decision Log (Session Ini)

| Keputusan | Alasan |
|-----------|--------|
| Backtest pakai formula-only (hapus SL/TP/hold days param) | Lebih fleksibel, AmiBroker approach — semua logic di formula |
| Force cutloss sebagai toggle terpisah | Safety net independent dari exit formula |
| Open positions tidak di-force close | User mau lihat floating P&L |
| IDX API untuk data pipeline | Hapus friction manual upload harian |
| Bloomberg Terminal style redesign | Data-dense, dark, monospace — match quant workflow |
| Index Summary sebagai benchmark | Local data, tidak tergantung Yahoo Finance |
| Logo watermark dihapus → jadi site logo | Cleaner layout |

---

## Git Backup

```powershell
cd C:\Project\banyu-langit
git add .
git commit -m "Sprint 6: Backtesting V7 + Index Summary + Logo"
git tag v2.6-sprint6
```

---

*Sprint 6 selesai. Next: IDX API + Bloomberg Redesign.*
*Kalau ada yang nanya kenapa backtest 0 trades → cek formula + date range + data availability.*
*Kalau error "no such column" → cek SQL quoting, SQLite pakai '' bukan "" untuk string.*
