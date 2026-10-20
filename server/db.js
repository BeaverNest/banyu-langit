const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { toIsoDate } = require('./utils/iso-date');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'trading.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ═══ Schema ═══
db.exec(`
  CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT NOT NULL,
    code TEXT NOT NULL,
    issuer TEXT DEFAULT '',
    investor TEXT NOT NULL,
    investor_norm TEXT DEFAULT '',
    type TEXT DEFAULT '',
    lf TEXT DEFAULT '',
    nationality TEXT DEFAULT '',
    domicile TEXT DEFAULT '',
    holdings INTEGER DEFAULT 0,
    pct REAL DEFAULT 0,
    UNIQUE(snapshot_date, code, investor)
  );
  CREATE INDEX IF NOT EXISTS idx_h_code ON holdings(code);
  CREATE INDEX IF NOT EXISTS idx_h_inv ON holdings(investor_norm);
  CREATE INDEX IF NOT EXISTS idx_h_snap ON holdings(snapshot_date);

  CREATE TABLE IF NOT EXISTS upload_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT, snapshot_date TEXT, rows_total INTEGER DEFAULT 0,
    rows_new INTEGER DEFAULT 0, rows_updated INTEGER DEFAULT 0,
    tickers INTEGER DEFAULT 0, upload_type TEXT DEFAULT '',
    warnings TEXT DEFAULT '',
    uploaded_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS header_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_header TEXT UNIQUE NOT NULL, target_field TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS investor_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    category TEXT DEFAULT '',
    key_person TEXT DEFAULT '',
    tickers TEXT DEFAULT '',
    description TEXT DEFAULT '',
    color TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS investor_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    match_type TEXT DEFAULT 'contains',
    group_name TEXT NOT NULL,
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS investor_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investor_name TEXT UNIQUE NOT NULL,
    group_name TEXT NOT NULL,
    notes TEXT DEFAULT ''
  );

  -- Grup komoditas -> emiten IDX (bisa diubah tanpa deploy)
  CREATE TABLE IF NOT EXISTS commodity_groups (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    tv TEXT DEFAULT '',
    descr TEXT DEFAULT '',
    icon TEXT DEFAULT '',
    color TEXT DEFAULT '',
    commodity_code TEXT DEFAULT '',
    tickers TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS ticker_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    group_name TEXT NOT NULL,
    category TEXT DEFAULT '',
    UNIQUE(ticker, group_name)
  );

  CREATE TABLE IF NOT EXISTS idx_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT DEFAULT '',
    prev_close INTEGER DEFAULT 0,
    open_price INTEGER DEFAULT 0,
    high INTEGER DEFAULT 0,
    low INTEGER DEFAULT 0,
    close INTEGER DEFAULT 0,
    change INTEGER DEFAULT 0,
    volume INTEGER DEFAULT 0,
    value INTEGER DEFAULT 0,
    frequency INTEGER DEFAULT 0,
    bid INTEGER DEFAULT 0,
    bid_vol INTEGER DEFAULT 0,
    offer INTEGER DEFAULT 0,
    offer_vol INTEGER DEFAULT 0,
    listed_shares INTEGER DEFAULT 0,
    tradeable_shares INTEGER DEFAULT 0,
    foreign_buy INTEGER DEFAULT 0,
    foreign_sell INTEGER DEFAULT 0,
    UNIQUE(trade_date, code)
  );
  CREATE INDEX IF NOT EXISTS idx_daily_code ON idx_daily(code);
  CREATE INDEX IF NOT EXISTS idx_daily_date ON idx_daily(trade_date);

  CREATE TABLE IF NOT EXISTS screener_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    filters TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS idx_fundamental (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_month TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT DEFAULT '',
    sector TEXT DEFAULT '',
    subsector TEXT DEFAULT '',
    industry TEXT DEFAULT '',
    subindustry TEXT DEFAULT '',
    idx_index TEXT DEFAULT '',
    per REAL DEFAULT 0,
    pbv REAL DEFAULT 0,
    roe REAL DEFAULT 0,
    roa REAL DEFAULT 0,
    der REAL DEFAULT 0,
    npm REAL DEFAULT 0,
    mkt_cap REAL DEFAULT 0,
    total_rev REAL DEFAULT 0,
    chg_4w REAL DEFAULT 0,
    chg_13w REAL DEFAULT 0,
    chg_26w REAL DEFAULT 0,
    chg_52w REAL DEFAULT 0,
    mtd REAL DEFAULT 0,
    ytd REAL DEFAULT 0,
    UNIQUE(snapshot_month, code)
  );
  CREATE INDEX IF NOT EXISTS idx_fund_code ON idx_fundamental(code);
  CREATE INDEX IF NOT EXISTS idx_fund_snap ON idx_fundamental(snapshot_month);

  -- Faktor penyesuaian aksi korporasi (diturunkan dari prev_close bursa).
  -- Sumber tunggal untuk chart (stock-detail) dan mesin backtest.
  CREATE TABLE IF NOT EXISTS ca_factors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    ex_date TEXT NOT NULL,
    factor REAL NOT NULL,
    cum_close INTEGER DEFAULT 0,
    ref_close INTEGER DEFAULT 0,
    basis TEXT DEFAULT 'prev_close',
    source TEXT DEFAULT 'derived',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(code, ex_date)
  );
  CREATE INDEX IF NOT EXISTS idx_ca_factors_code ON ca_factors(code);

  -- Benchmark pasar (equal-weighted berantai) — dipakai bila IHSG resmi tidak
  -- mencakup jendela backtest.
  CREATE TABLE IF NOT EXISTS market_index_constructed (
    trade_date TEXT PRIMARY KEY,
    close REAL NOT NULL,
    r_pct REAL,
    n_stocks INTEGER,
    basis TEXT DEFAULT 'equal_weighted_chainlinked',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS corporate_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    ex_date TEXT NOT NULL,
    action_type TEXT NOT NULL DEFAULT 'auto',
    ratio REAL NOT NULL DEFAULT 1,
    old_shares INTEGER DEFAULT 0,
    new_shares INTEGER DEFAULT 0,
    old_close INTEGER DEFAULT 0,
    new_close INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(code, ex_date)
  );
  CREATE INDEX IF NOT EXISTS idx_ca_code ON corporate_actions(code);
  CREATE INDEX IF NOT EXISTS idx_ca_date ON corporate_actions(ex_date);

  CREATE TABLE IF NOT EXISTS custom_tickers (
    code TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    category TEXT DEFAULT 'custom',
    source TEXT DEFAULT 'manual',
    rows INTEGER DEFAULT 0,
    first_date TEXT DEFAULT '',
    last_date TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS custom_ohlc (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date TEXT NOT NULL,
    code TEXT NOT NULL,
    open REAL DEFAULT 0,
    high REAL DEFAULT 0,
    low REAL DEFAULT 0,
    close REAL DEFAULT 0,
    volume REAL DEFAULT 0,
    -- Asal baris, mis. 'investing/8849', 'yahoo', 'fred/DFII10', 'tradingeconomics/snapshot'.
    -- Satu code = satu sumber: label ini yang membuat pencampuran sumber terdeteksi,
    -- bukan tersembunyi (lihat POST /custom/replace).
    source TEXT,
    UNIQUE(trade_date, code)
  );
  CREATE INDEX IF NOT EXISTS idx_cohlc_code ON custom_ohlc(code);
  CREATE INDEX IF NOT EXISTS idx_cohlc_date ON custom_ohlc(trade_date);

  -- Arsip baris custom_ohlc yang sumbernya DIGANTI — disalin, bukan dihapus.
  -- Alasan: baris Yahoo/TE tetap berguna sebagai pembanding setelah seri pindah agregator,
  -- dan "jangan hapus seri lama" hanya bisa dijanjikan kalau barisnya benar-benar ada.
  CREATE TABLE IF NOT EXISTS custom_ohlc_archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    open REAL, high REAL, low REAL, close REAL, volume REAL,
    source TEXT,
    archived_at TEXT DEFAULT (datetime('now')),
    reason TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_cohlc_arc_code ON custom_ohlc_archive(code);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_cohlc_arc_row ON custom_ohlc_archive(code, trade_date, source);

  -- Jejak PENULISAN ULANG bar yang SUDAH tersimpan (kanban t_7be29126).
  -- Sebelum tabel ini, re-pull seri pin berkelanjutan (investing 8849 / 961730 / 992745) menimpa
  -- bar lama di custom_ohlc tanpa bekas sama sekali: UNIQUE(trade_date, code) + ON CONFLICT DO
  -- UPDATE membuat 2026-10-15 WTI berubah 97,97 (NOV-26) -> 96,50 (DEC-26) saat roll, dan angka
  -- lamanya hilang (bukan di custom_ohlc_archive — arsip itu hanya untuk baris yang SUMBERNYA
  -- diganti, bukan untuk nilai yang ditulis ulang sumber yang sama).
  -- Sengaja APPEND-ONLY dan tanpa UNIQUE(code, trade_date, source): satu bar bisa ditulis ulang
  -- berkali-kali (bar sesi berjalan direvisi vendor sebelum settle), dan setiap revisi adalah
  -- fakta tersendiri. age_days = umur bar saat ditulis ulang, supaya "revisi sesi berjalan"
  -- (0-1 hari) bisa dibedakan dari "penulisan ulang bar lama" (>= 2 hari) tanpa menebak.
  -- CATATAN: komentar di dalam db.exec(...) ini TIDAK boleh memuat backtick — backtick menutup
  -- template literal-nya dan file gagal di-parse (pernah terjadi saat tabel ini ditambahkan).
  CREATE TABLE IF NOT EXISTS custom_ohlc_rewrites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    source TEXT,
    old_source TEXT,
    age_days INTEGER,
    old_open REAL, old_high REAL, old_low REAL, old_close REAL, old_volume REAL,
    new_open REAL, new_high REAL, new_low REAL, new_close REAL, new_volume REAL,
    detected_by TEXT DEFAULT '',
    detected_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cohlc_rw_code_date ON custom_ohlc_rewrites(code, trade_date);
  CREATE INDEX IF NOT EXISTS idx_cohlc_rw_at ON custom_ohlc_rewrites(detected_at);

  -- Telemetri TARIKAN per seri (kanban t_57252454). Satu baris per seri per tarikan.
  -- Kenapa perlu: lag terhadap kalender sesi IDX mencampur tiga hal yang berbeda --
  -- kita gagal menyimpan, sumber memang terbit lambat, dan sumber BERHENTI terbit.
  -- Pembeda satu-satunya adalah frontier SUMBER pada tiap tarikan, yang dulu tidak direkam.
  -- Kolom source_frontier_date = MAX(trade_date) dari PAYLOAD sumber (bukan dari DB kita),
  -- ditulis oleh jalur tulis /custom/upsert, /custom/fetch-eod, /custom/fetch-all,
  -- /custom/sync-stale -- bukan oleh skrip host, supaya investing/yahoo/fred/tradingeconomics
  -- terekam di satu tempat.
  -- Sengaja APPEND-ONLY dan tanpa UNIQUE: tiap tarikan adalah fakta tersendiri (termasuk
  -- yang gagal), dan ukurannya dijaga oleh ritme tarik (~40 baris/hari), bukan oleh update.
  -- Tabel ini MELAPORKAN; ia tidak pernah menulis ulang custom_tickers.expected_lag_sessions
  -- (expectation yang menyesuaikan diri = ratchet, dan itu cara mematikan alarm).
  CREATE TABLE IF NOT EXISTS custom_pull_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    source TEXT,
    pulled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    ref_date TEXT,
    source_frontier_date TEXT,
    rows INTEGER DEFAULT 0,
    written INTEGER DEFAULT 0,
    endpoint TEXT,
    -- writer = SIAPA yang menulis baris ini (kanban t_b7a0fdb1). Berbeda dari kolom endpoint
    -- (nama ROUTE HTTP, dipakai semua pemanggil: terukur 20 Okt 2026, rail dan cron eko
    -- sama-sama 'POST /custom/upsert' — jadi endpoint tidak bisa membedakan penulis).
    -- Nilai sekarang: 'rail:investing' | 'rail:sun' (dipasang scripts/daily-rails.sh
    -- sebagai env RAIL_WRITER). NULL = penulis tidak menyatakan identitasnya (cron eko,
    -- idx-api, tarikan manual) — dan itu artinya TIDAK dihitung sebagai bukti penjadwal.
    writer TEXT,
    status TEXT NOT NULL DEFAULT 'ok',
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_cpull_code_at ON custom_pull_log(code, pulled_at);
  CREATE INDEX IF NOT EXISTS idx_cpull_at ON custom_pull_log(pulled_at);

  CREATE TABLE IF NOT EXISTS quarterly_financials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    period TEXT NOT NULL,
    period_type TEXT DEFAULT 'quarterly',
    revenue REAL DEFAULT 0,
    net_income REAL DEFAULT 0,
    operating_income REAL DEFAULT 0,
    gross_profit REAL DEFAULT 0,
    eps REAL DEFAULT 0,
    total_assets REAL DEFAULT 0,
    total_equity REAL DEFAULT 0,
    total_debt REAL DEFAULT 0,
    total_cash REAL DEFAULT 0,
    operating_cashflow REAL DEFAULT 0,
    free_cashflow REAL DEFAULT 0,
    capex REAL DEFAULT 0,
    dividend_per_share REAL DEFAULT 0,
    shares_outstanding REAL DEFAULT 0,
    UNIQUE(code, period, period_type)
  );
  CREATE INDEX IF NOT EXISTS idx_qf_code ON quarterly_financials(code);
  CREATE INDEX IF NOT EXISTS idx_qf_period ON quarterly_financials(period);

  CREATE TABLE IF NOT EXISTS idx_indices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date TEXT NOT NULL,
    index_code TEXT NOT NULL,
    previous REAL DEFAULT 0,
    highest REAL DEFAULT 0,
    lowest REAL DEFAULT 0,
    close REAL DEFAULT 0,
    change_val REAL DEFAULT 0,
    num_stocks INTEGER DEFAULT 0,
    volume INTEGER DEFAULT 0,
    value INTEGER DEFAULT 0,
    frequency INTEGER DEFAULT 0,
    market_cap REAL DEFAULT 0,
    UNIQUE(trade_date, index_code)
  );
  CREATE INDEX IF NOT EXISTS idx_indices_date ON idx_indices(trade_date);
  CREATE INDEX IF NOT EXISTS idx_indices_code ON idx_indices(index_code);

  CREATE TABLE IF NOT EXISTS dividends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    ex_date TEXT NOT NULL DEFAULT '',
    cash_dividend REAL DEFAULT 0,
    cum_date TEXT DEFAULT '',
    record_date TEXT DEFAULT '',
    payment_date TEXT DEFAULT '',
    name TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    UNIQUE(code, ex_date)
  );
  CREATE INDEX IF NOT EXISTS idx_div_code ON dividends(code);
  CREATE INDEX IF NOT EXISTS idx_div_date ON dividends(ex_date);

  CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_type TEXT NOT NULL,
    sync_date TEXT DEFAULT '',
    rows_synced INTEGER DEFAULT 0,
    status TEXT DEFAULT 'ok',
    message TEXT DEFAULT '',
    started_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_sync_type ON sync_logs(sync_type);

  CREATE TABLE IF NOT EXISTS company_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    sector TEXT DEFAULT '',
    sub_sector TEXT DEFAULT '',
    industry TEXT DEFAULT '',
    sub_industry TEXT DEFAULT '',
    board TEXT DEFAULT '',
    listing_date TEXT DEFAULT '',
    address TEXT DEFAULT '',
    website TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    status TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cp_code ON company_profiles(code);

  -- ═══ Sprint 8.2: New tables from IDX-API bridge expansion ═══

  CREATE TABLE IF NOT EXISTS broker_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date TEXT NOT NULL,
    broker_code TEXT NOT NULL,
    broker_name TEXT DEFAULT '',
    total_value REAL DEFAULT 0,
    volume INTEGER DEFAULT 0,
    frequency INTEGER DEFAULT 0,
    UNIQUE(trade_date, broker_code)
  );
  CREATE INDEX IF NOT EXISTS idx_bs_date ON broker_summary(trade_date);
  CREATE INDEX IF NOT EXISTS idx_bs_broker ON broker_summary(broker_code);

  CREATE TABLE IF NOT EXISTS market_calendar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cal_date TEXT NOT NULL,
    code TEXT DEFAULT '',
    type TEXT DEFAULT '',
    description TEXT DEFAULT '',
    UNIQUE(cal_date, code, description)
  );
  CREATE INDEX IF NOT EXISTS idx_mc_date ON market_calendar(cal_date);

  CREATE TABLE IF NOT EXISTS company_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ann_id TEXT UNIQUE NOT NULL,
    ann_date TEXT NOT NULL,
    title TEXT DEFAULT '',
    type TEXT DEFAULT '',
    company_code TEXT DEFAULT '',
    subject TEXT DEFAULT '',
    is_stock INTEGER DEFAULT 0,
    is_bond INTEGER DEFAULT 0,
    attachments TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_ca2_date ON company_announcements(ann_date);
  CREATE INDEX IF NOT EXISTS idx_ca2_code ON company_announcements(company_code);

  CREATE TABLE IF NOT EXISTS domestic_trading (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date TEXT NOT NULL,
    buy_volume INTEGER DEFAULT 0,
    buy_value REAL DEFAULT 0,
    buy_frequency INTEGER DEFAULT 0,
    sell_volume INTEGER DEFAULT 0,
    sell_value REAL DEFAULT 0,
    sell_frequency INTEGER DEFAULT 0,
    UNIQUE(trade_date)
  );

  CREATE TABLE IF NOT EXISTS industry_trading (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date TEXT NOT NULL,
    industry TEXT NOT NULL,
    members INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    market_cap REAL DEFAULT 0,
    volume INTEGER DEFAULT 0,
    value REAL DEFAULT 0,
    frequency INTEGER DEFAULT 0,
    per REAL DEFAULT 0,
    pbv REAL DEFAULT 0,
    UNIQUE(trade_date, industry)
  );
  CREATE INDEX IF NOT EXISTS idx_it_date ON industry_trading(trade_date);

  CREATE TABLE IF NOT EXISTS daily_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date TEXT NOT NULL,
    index_name TEXT NOT NULL,
    close REAL DEFAULT 0,
    UNIQUE(trade_date, index_name)
  );
  CREATE INDEX IF NOT EXISTS idx_di_date ON daily_index(trade_date);

  CREATE TABLE IF NOT EXISTS top_movers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT NOT NULL,
    mover_type TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT DEFAULT '',
    previous REAL DEFAULT 0,
    close REAL DEFAULT 0,
    change REAL DEFAULT 0,
    percentage REAL DEFAULT 0,
    UNIQUE(period, mover_type, code)
  );

  CREATE TABLE IF NOT EXISTS active_stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT NOT NULL,
    active_type TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT DEFAULT '',
    volume INTEGER DEFAULT 0,
    value REAL DEFAULT 0,
    frequency INTEGER DEFAULT 0,
    volume_pct REAL DEFAULT 0,
    value_pct REAL DEFAULT 0,
    frequency_pct REAL DEFAULT 0,
    UNIQUE(period, active_type, code)
  );

  CREATE TABLE IF NOT EXISTS company_suspends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    title TEXT DEFAULT '',
    suspend_date TEXT NOT NULL,
    type TEXT DEFAULT '',
    UNIQUE(code, suspend_date, type)
  );
  CREATE INDEX IF NOT EXISTS idx_cs_code ON company_suspends(code);

  CREATE TABLE IF NOT EXISTS right_offerings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    name TEXT DEFAULT '',
    ratio TEXT DEFAULT '',
    exercise_price REAL DEFAULT 0,
    fund_raised REAL DEFAULT 0,
    exercise_date TEXT DEFAULT '',
    recording_date TEXT DEFAULT '',
    trading_period TEXT DEFAULT '',
    period TEXT DEFAULT '',
    UNIQUE(code, recording_date)
  );

  CREATE TABLE IF NOT EXISTS participant_brokers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    license TEXT DEFAULT ''
  );

  -- ═══ Remaining tables for full 39-table coverage ═══

  CREATE TABLE IF NOT EXISTS trading_ss (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT DEFAULT '',
    previous INTEGER DEFAULT 0,
    open_price INTEGER DEFAULT 0,
    high INTEGER DEFAULT 0,
    low INTEGER DEFAULT 0,
    close INTEGER DEFAULT 0,
    change INTEGER DEFAULT 0,
    volume INTEGER DEFAULT 0,
    value INTEGER DEFAULT 0,
    frequency INTEGER DEFAULT 0,
    listed_shares INTEGER DEFAULT 0,
    tradeable_shares INTEGER DEFAULT 0,
    UNIQUE(trade_date, code)
  );
  CREATE INDEX IF NOT EXISTS idx_tss_date ON trading_ss(trade_date);
  CREATE INDEX IF NOT EXISTS idx_tss_code ON trading_ss(code);

  CREATE TABLE IF NOT EXISTS trading_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    board TEXT DEFAULT '',
    previous INTEGER DEFAULT 0,
    open_price INTEGER DEFAULT 0,
    high INTEGER DEFAULT 0,
    low INTEGER DEFAULT 0,
    close INTEGER DEFAULT 0,
    change INTEGER DEFAULT 0,
    volume INTEGER DEFAULT 0,
    value INTEGER DEFAULT 0,
    frequency INTEGER DEFAULT 0,
    foreign_shares INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT '',
    UNIQUE(code, board)
  );

  CREATE TABLE IF NOT EXISTS index_chart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    index_code TEXT NOT NULL,
    chart_date TEXT NOT NULL,
    value REAL DEFAULT 0,
    UNIQUE(index_code, chart_date)
  );
  CREATE INDEX IF NOT EXISTS idx_ic_code ON index_chart(index_code);

  CREATE TABLE IF NOT EXISTS index_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    close TEXT DEFAULT '',
    change TEXT DEFAULT '',
    percent TEXT DEFAULT '',
    current TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS financial_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    name TEXT DEFAULT '',
    year INTEGER DEFAULT 0,
    period TEXT DEFAULT '',
    attachments TEXT DEFAULT '',
    UNIQUE(code, year, period)
  );

  CREATE TABLE IF NOT EXISTS issued_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    issue_date TEXT DEFAULT '',
    type TEXT DEFAULT '',
    shares INTEGER DEFAULT 0,
    total_shares INTEGER DEFAULT 0,
    UNIQUE(code, issue_date, type)
  );
  CREATE INDEX IF NOT EXISTS idx_ih_code ON issued_history(code);

  CREATE TABLE IF NOT EXISTS additional_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    name TEXT DEFAULT '',
    shares INTEGER DEFAULT 0,
    type TEXT DEFAULT '',
    start_date TEXT DEFAULT '',
    last_date TEXT DEFAULT '',
    period TEXT DEFAULT '',
    UNIQUE(code, start_date, type)
  );

  CREATE TABLE IF NOT EXISTS new_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    listed_shares INTEGER DEFAULT 0,
    offering_shares INTEGER DEFAULT 0,
    offering_price REAL DEFAULT 0,
    fund_raised REAL DEFAULT 0,
    listing_date TEXT DEFAULT '',
    period TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS security_stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    shares INTEGER DEFAULT 0,
    listing_board TEXT DEFAULT '',
    listing_date TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS company_delistings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    name TEXT DEFAULT '',
    listed_shares INTEGER DEFAULT 0,
    market_cap REAL DEFAULT 0,
    regular_price REAL DEFAULT 0,
    listing_date TEXT DEFAULT '',
    delisting_date TEXT DEFAULT '',
    UNIQUE(code, delisting_date)
  );

  CREATE TABLE IF NOT EXISTS company_relistings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    listing_date TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS profile_announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ann_id TEXT UNIQUE NOT NULL,
    ann_date TEXT DEFAULT '',
    title TEXT DEFAULT '',
    attachments TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS participant_dealers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    license TEXT DEFAULT '',
    is_primary INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS participant_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    license TEXT DEFAULT '',
    is_primary INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS trade_summary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    summary_id TEXT DEFAULT '',
    trade_date TEXT NOT NULL,
    volume INTEGER DEFAULT 0,
    value REAL DEFAULT 0,
    frequency INTEGER DEFAULT 0,
    UNIQUE(trade_date, summary_id)
  );

  CREATE TABLE IF NOT EXISTS financial_ratios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    name TEXT DEFAULT '',
    sector TEXT DEFAULT '',
    sub_sector TEXT DEFAULT '',
    industry TEXT DEFAULT '',
    sub_industry TEXT DEFAULT '',
    period TEXT DEFAULT '',
    assets REAL DEFAULT 0,
    liabilities REAL DEFAULT 0,
    equity REAL DEFAULT 0,
    sales REAL DEFAULT 0,
    ebt REAL DEFAULT 0,
    profit REAL DEFAULT 0,
    eps REAL DEFAULT 0,
    book_value REAL DEFAULT 0,
    per REAL DEFAULT 0,
    pbv REAL DEFAULT 0,
    der REAL DEFAULT 0,
    roa REAL DEFAULT 0,
    roe REAL DEFAULT 0,
    npm REAL DEFAULT 0,
    UNIQUE(code, period)
  );
  CREATE INDEX IF NOT EXISTS idx_fr_code ON financial_ratios(code);

  CREATE TABLE IF NOT EXISTS daily_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    calc_date TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT DEFAULT '',
    close REAL DEFAULT 0,
    change_pct REAL DEFAULT 0,
    sector TEXT DEFAULT '',
    industry TEXT DEFAULT '',
    market_cap REAL DEFAULT 0,
    -- Sub-scores (0-100)
    score_fundamental REAL DEFAULT 0,
    score_valuation REAL DEFAULT 0,
    score_momentum REAL DEFAULT 0,
    score_composite REAL DEFAULT 0,
    -- Fundamental raw
    roe REAL DEFAULT 0,
    roa REAL DEFAULT 0,
    npm REAL DEFAULT 0,
    der REAL DEFAULT 0,
    -- Valuation raw
    per REAL DEFAULT 0,
    pbv REAL DEFAULT 0,
    per_vs_ind REAL DEFAULT 0,
    pbv_vs_ind REAL DEFAULT 0,
    div_yield REAL DEFAULT 0,
    -- Momentum raw
    ma5 REAL DEFAULT 0,
    ma10 REAL DEFAULT 0,
    ma20 REAL DEFAULT 0,
    ma50 REAL DEFAULT 0,
    ma200 REAL DEFAULT 0,
    ma5_pct REAL DEFAULT 0,
    ma10_pct REAL DEFAULT 0,
    ma20_pct REAL DEFAULT 0,
    ma50_pct REAL DEFAULT 0,
    ma200_pct REAL DEFAULT 0,
    rsi14 REAL DEFAULT 0,
    macd REAL DEFAULT 0,
    macd_signal REAL DEFAULT 0,
    macd_hist REAL DEFAULT 0,
    ret_5d REAL DEFAULT 0,
    ret_20d REAL DEFAULT 0,
    fnet_5d REAL DEFAULT 0,
    fnet_dir TEXT DEFAULT '',
    -- Demand/Supply raw (NEW)
    bid_offer_ratio REAL DEFAULT 0,
    bid_offer_5d REAL DEFAULT 0,
    rel_vol REAL DEFAULT 0,
    freq_spike REAL DEFAULT 0,
    val_spike REAL DEFAULT 0,
    -- Foreign Smart Money raw (NEW)
    fnet_10d REAL DEFAULT 0,
    fnet_20d REAL DEFAULT 0,
    foreign_pct_val REAL DEFAULT 0,
    foreign_accum_streak INTEGER DEFAULT 0,
    fnet_vs_avg REAL DEFAULT 0,
    -- Sub-scores (NEW)
    score_demand REAL DEFAULT 0,
    score_foreign REAL DEFAULT 0,
    -- Weights used
    w_fundamental REAL DEFAULT 30,
    w_valuation REAL DEFAULT 25,
    w_momentum REAL DEFAULT 30,
    w_demand REAL DEFAULT 0,
    w_foreign REAL DEFAULT 0,
    -- Provenance (agent rail): which indicator variants + which build produced this row
    variant TEXT DEFAULT '',
    code_version TEXT DEFAULT '',
    UNIQUE(calc_date, code)
  );
  CREATE INDEX IF NOT EXISTS idx_ds_date ON daily_scores(calc_date);
  CREATE INDEX IF NOT EXISTS idx_ds_code ON daily_scores(code);
  CREATE INDEX IF NOT EXISTS idx_ds_composite ON daily_scores(calc_date, score_composite);
`);

// ═══ Default header mappings ═══
const defaultMappings = {
  DATE:'date',TANGGAL:'date',TGL:'date',
  SHARE_CODE:'code',KODE_SAHAM:'code',TICKER:'code',CODE:'code',KODE:'code',
  ISSUER_NAME:'issuer',NAMA_EMITEN:'issuer',EMITEN:'issuer',COMPANY:'issuer',
  INVESTOR_NAME:'investor',NAMA_INVESTOR:'investor',PEMEGANG:'investor',SHAREHOLDER:'investor',
  INVESTOR_TYPE:'type',TIPE:'type',TYPE:'type',
  LOCAL_FOREIGN:'lf',L_F:'lf',LOKAL_ASING:'lf',
  NATIONALITY:'nationality',KEWARGANEGARAAN:'nationality',
  DOMICILE:'domicile',DOMISILI:'domicile',
  TOTAL_HOLDING_SHARES:'holdings',HOLDINGS_SCRIPLESS:'holdings',HOLDINGS:'holdings',JUMLAH_SAHAM:'holdings',SHARES:'holdings',
  PERCENTAGE:'pct',PCT:'pct',PERSENTASE:'pct',
};
const insM = db.prepare('INSERT OR IGNORE INTO header_mappings(source_header,target_field)VALUES(?,?)');
db.transaction(() => { for (const [s, t] of Object.entries(defaultMappings)) insM.run(s, t); })();

// ═══ Auto-migrate: add columns if missing ═══
try {
  const cols = db.prepare("PRAGMA table_info(upload_logs)").all().map(c => c.name);
  if (!cols.includes('upload_type')) db.exec("ALTER TABLE upload_logs ADD COLUMN upload_type TEXT DEFAULT ''");
  if (!cols.includes('warnings')) db.exec("ALTER TABLE upload_logs ADD COLUMN warnings TEXT DEFAULT ''");
} catch (e) { console.error('Migration:', e.message); }

// ═══ Auto-migrate (data): issued_history.issue_date → ISO YYYY-MM-DD ═══
// /ksei/import menyimpan "Listing Date" dari file master KSEI apa adanya
// (DD-MMM-YYYY), sehingga kolom ini CAMPURAN: sebagian ISO (fallback snapshot),
// sebagian teks hari-dulu. Di kolom campuran MIN(issue_date) = '01-APR-2024' dan
// MAX(issue_date) = '31-OCT-2023' — min > max — sehingga setiap filter rentang,
// urutan, atau "snapshot terakhir" di atasnya salah TANPA error (kanban t_b00757f3).
// Idempoten: setelah bersih, WHERE-nya tidak cocok lagi. Baris berbentuk tak dikenal
// dibiarkan apa adanya (tidak ditebak); bila hasil normalisasi bentrok dengan baris
// ISO yang sudah ada di UNIQUE(code, issue_date, type), baris teks itulah duplikatnya.
try {
  const dirty = db.prepare("SELECT id, code, issue_date, type FROM issued_history WHERE issue_date IS NOT NULL AND issue_date <> '' AND issue_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'").all();
  if (dirty.length) {
    const exists = db.prepare('SELECT id FROM issued_history WHERE code=? AND issue_date=? AND type=? AND id<>?');
    const upd = db.prepare('UPDATE issued_history SET issue_date=? WHERE id=?');
    const del = db.prepare('DELETE FROM issued_history WHERE id=?');
    let fixed = 0, duplicates = 0, skipped = 0;
    db.transaction(() => {
      for (const r of dirty) {
        const iso = toIsoDate(r.issue_date);
        if (!iso) { skipped++; continue; }
        if (exists.get(r.code, iso, r.type, r.id)) { del.run(r.id); duplicates++; continue; }
        upd.run(iso, r.id); fixed++;
      }
    })();
    console.log('[migrate] issued_history.issue_date -> ISO: fixed=' + fixed + ' duplicates_removed=' + duplicates + ' skipped=' + skipped);
  }
} catch (e) { console.error('Migration issued_history.issue_date:', e.message); }

// Auto-migrate daily_scores for new demand/supply + foreign columns
try {
  const dsCols = db.prepare("PRAGMA table_info(daily_scores)").all().map(c => c.name);
  const newCols = [
    ['bid_offer_ratio','REAL DEFAULT 0'],['bid_offer_5d','REAL DEFAULT 0'],
    ['rel_vol','REAL DEFAULT 0'],['freq_spike','REAL DEFAULT 0'],['val_spike','REAL DEFAULT 0'],
    ['fnet_10d','REAL DEFAULT 0'],['fnet_20d','REAL DEFAULT 0'],
    ['foreign_pct_val','REAL DEFAULT 0'],['foreign_accum_streak','INTEGER DEFAULT 0'],['fnet_vs_avg','REAL DEFAULT 0'],
    ['score_demand','REAL DEFAULT 0'],['score_foreign','REAL DEFAULT 0'],
    ['w_demand','REAL DEFAULT 0'],['w_foreign','REAL DEFAULT 0'],
    ['variant',"TEXT DEFAULT ''"],['code_version',"TEXT DEFAULT ''"],
    // IC staleness provenance — deliberately NO DEFAULT so pre-existing rows stay NULL
    // (the IC queries filter on `fund_snapshot_month IS NOT NULL`; a DEFAULT would
    // silently promote old non-PIT rows into the staleness sample).
    ['fund_snapshot_month','TEXT'],['data_age_months','INTEGER']
  ];
  newCols.forEach(([col, type]) => {
    if (!dsCols.includes(col)) {
      try { db.exec(`ALTER TABLE daily_scores ADD COLUMN ${col} ${type}`); } catch(e2) {}
    }
  });
} catch (e) { console.error('Migration daily_scores:', e.message); }

// Auto-migrate custom_tickers for Market Regime (role + linked_sector)
try {
  const ctCols = db.prepare("PRAGMA table_info(custom_tickers)").all().map(c => c.name);
  if (!ctCols.includes('role')) db.exec("ALTER TABLE custom_tickers ADD COLUMN role TEXT DEFAULT ''");
  if (!ctCols.includes('linked_sector')) db.exec("ALTER TABLE custom_tickers ADD COLUMN linked_sector TEXT DEFAULT ''");
} catch (e) { console.error('Migration custom_tickers:', e.message); }

// Auto-migrate custom_ohlc: label sumber per baris.
// Tanpa DEFAULT: baris lama sengaja tetap NULL supaya "belum berlabel" bisa dibedakan
// dari "berlabel yahoo" (backfill-nya dari custom_tickers.source, sekali, terukur).
try {
  const coCols = db.prepare("PRAGMA table_info(custom_ohlc)").all().map(c => c.name);
  if (!coCols.includes('source')) db.exec("ALTER TABLE custom_ohlc ADD COLUMN source TEXT");
  // ohlc_state = ALASAN per bar (kanban t_565e76fd). Tanpa DEFAULT: baris lama tetap NULL
  // ("belum dinilai"), supaya baris yang sengaja tidak dinilai bisa dibedakan dari 'ok'.
  // Nilai: ok | source_flat | invariant_fail | missing_source | dropped_price_only.
  if (!coCols.includes('ohlc_state')) db.exec("ALTER TABLE custom_ohlc ADD COLUMN ohlc_state TEXT");
  // session = penanda SESI BURSA per bar (kanban t_4acc7bf7). Nilai: 'regular' | 'weekend'.
  // Bar Sabtu/Minggu memang ada di data: sumber (investing/yahoo) menerbitkan bar Minggu untuk
  // sesi elektronik futures (CL/HG/NG) dan kadang bar Minggu untuk indeks/valas sebagai artefak
  // agregasi. Sisi baca yang menghitung jendela (ret_5d/ret_20d, chg_5d/chg_20d, MA) memakai
  // sesi REGULER saja supaya "5 hari" = 5 sesi bursa, bukan 5 baris — bar akhir pekan pernah
  // menggeser jendela itu (temuan eko t_b4e96142).
  // VIRTUAL + GENERATED dari trade_date: selalu konsisten dengan barisnya, tak bisa lupa diisi
  // oleh penulis baru (rail/yahoo/CSV), dan tidak menambah byte per baris.
  // Cek pakai table_xinfo: kolom generated TIDAK muncul di table_info (hidden=2), jadi cek
  // dengan table_info membuat ALTER dicoba ulang tiap boot ("duplicate column name").
  const coXCols = db.prepare("PRAGMA table_xinfo(custom_ohlc)").all().map(c => c.name);
  if (!coXCols.includes('session')) {
    db.exec("ALTER TABLE custom_ohlc ADD COLUMN session TEXT GENERATED ALWAYS AS " +
            "(CASE WHEN strftime('%w', trade_date) IN ('0','6') THEN 'weekend' ELSE 'regular' END) VIRTUAL");
  }
} catch (e) { console.error('Migration:', e.message); }

// ohlc_mode = mode render seri (candle | price_only) — hasil gerbang per-seri,
// dibaca UI supaya garis/candle tidak ditebak per halaman. NULL = belum dinilai.
try {
  const ctCols2 = db.prepare("PRAGMA table_info(custom_tickers)").all().map(c => c.name);
  if (!ctCols2.includes('ohlc_mode')) db.exec("ALTER TABLE custom_tickers ADD COLUMN ohlc_mode TEXT");
} catch (e) { console.error('Migration custom_tickers.ohlc_mode:', e.message); }

// Ekspektasi lag per seri (kanban t_b234606a, keputusan eko). Menggantikan ambang global
// "lag >= 1 sesi = basi": alarm hanya menyala bila lag melebihi kebiasaan SUMBER seri itu.
//   expected_lag_sessions = lag yang WAJAR (satuan: sesi IDX). NULL = belum/tidak
//                           dideklarasikan -> status 'na', tidak pernah alarm. 0 = sumber
//                           seharusnya menerbitkan bar sesi berjalan.
//   lag_basis             = asal nilai: 'declared' | 'na' | NULL (belum diisi).
//   lag_declared_at       = kapan dideklarasikan (ISO). Deklarasi tua = sinyal review.
// Nilainya SENGAJA tidak di-seed di sini: nilai di berkas ini akan menimpa deklarasi manual
// setiap restart, dan expectation yang menyesuaikan diri sendiri mematikan alarm tepat saat
// dibutuhkan. Seed-nya lewat server/scripts/seed_expected_lag.js (idempotent).
try {
  const ctCols3 = db.prepare('PRAGMA table_info(custom_tickers)').all().map(c => c.name);
  if (!ctCols3.includes('expected_lag_sessions')) db.exec('ALTER TABLE custom_tickers ADD COLUMN expected_lag_sessions INTEGER');
  if (!ctCols3.includes('lag_basis')) db.exec("ALTER TABLE custom_tickers ADD COLUMN lag_basis TEXT");
  if (!ctCols3.includes('lag_declared_at')) db.exec('ALTER TABLE custom_tickers ADD COLUMN lag_declared_at TEXT');
} catch (e) { console.error('Migration custom_tickers.lag:', e.message); }

// writer = penulis baris tarikan (kanban t_b7a0fdb1).
// Kenapa perlu kolom baru, bukan kolom `endpoint` yang sudah ada: `endpoint` mencatat ROUTE
// HTTP, dan SEMUA pemanggil /custom/upsert menulis string yang sama ('POST /custom/upsert').
// Terukur 2026-10-20: rail SUN (19:03 WIB) dan cron eko `eko-rates-daily` (19:20 WIB) menulis
// kode ID1M..ID30Y dengan endpoint identik, sehingga penjaga liveness tidak bisa membedakan
// penjadwal dari penulis lain — cron eko memenuhi 12 dari 23 tarikan "rail SUN" malam itu.
// Tanpa DEFAULT: baris lama tetap NULL ("penulis tidak menyatakan identitas"), dan penjaga
// memperlakukan NULL sebagai BUKAN bukti penjadwal. Backfill sengaja tidak dilakukan: kita
// tidak tahu siapa yang menulis baris lama, dan menebaknya persis kesalahan yang ditutup.
try {
  const cpCols = db.prepare('PRAGMA table_info(custom_pull_log)').all().map(c => c.name);
  if (!cpCols.includes('writer')) db.exec('ALTER TABLE custom_pull_log ADD COLUMN writer TEXT');
} catch (e) { console.error('Migration custom_pull_log.writer:', e.message); }

// Metadata satuan per seri (kanban t_19f4f0d4). Dipakai monitor lintas aset: satu tabel untuk
// SEMUA seri, jadi blok UI tidak boleh menebak apakah perubahan harga masuk akal dihitung
// sebagai persen.
//   unit       = satuan LEVEL seri ('%', 'pp', 'USD', 'index', 'Rp tn', 'USD bn', 'USD/t', ...).
//   value_kind = bagaimana perubahan dihitung:
//                'price' -> perubahan relatif (%), level > 0, perkalian bermakna
//                'rate'  -> perubahan ADDITIF dalam percentage point (pp): 5,75% -> 6,00% = +0,25 pp.
//                           Persen-dari-persen pada suku bunga/inflasi adalah angka tanpa arti.
//                'level' -> perubahan additif dalam `unit` (mis. cadangan devisa USD bn).
//                NULL    -> belum dideklarasikan: UI menampilkan perubahan absolut + penanda
//                           "satuan?" dan seri itu MASUK daftar coverage. Tidak ditebak.
// Nilainya TIDAK di-seed di sini (alasan sama dengan expected_lag_sessions: deklarasi manual
// harus terlihat di review, bukan menyesuaikan diri sendiri). Seed: server/scripts/seed_series_meta.js
try {
  const ctCols4 = db.prepare('PRAGMA table_info(custom_tickers)').all().map(c => c.name);
  if (!ctCols4.includes('unit')) db.exec('ALTER TABLE custom_tickers ADD COLUMN unit TEXT');
  if (!ctCols4.includes('value_kind')) db.exec('ALTER TABLE custom_tickers ADD COLUMN value_kind TEXT');
} catch (e) { console.error('Migration custom_tickers.unit:', e.message); }

// ═══ Helper functions ═══
function latestSnap() {
  const r = db.prepare('SELECT MAX(snapshot_date) as d FROM holdings').get();
  return r?.d || '';
}

function latestIdxDate() {
  const r = db.prepare('SELECT MAX(trade_date) as d FROM idx_daily').get();
  return r?.d || '';
}

function latestFundDate() {
  const r = db.prepare('SELECT MAX(snapshot_month) as d FROM idx_fundamental').get();
  return r?.d || '';
}

function latestIndexDate() {
  const r = db.prepare('SELECT MAX(trade_date) as d FROM idx_indices').get();
  return r?.d || '';
}

module.exports = { db, dataDir, latestSnap, latestIdxDate, latestFundDate, latestIndexDate };