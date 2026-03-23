const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

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
    UNIQUE(trade_date, code)
  );
  CREATE INDEX IF NOT EXISTS idx_cohlc_code ON custom_ohlc(code);
  CREATE INDEX IF NOT EXISTS idx_cohlc_date ON custom_ohlc(trade_date);

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

  CREATE TABLE IF NOT EXISTS foreign_trading (
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

  CREATE TABLE IF NOT EXISTS sectoral_movement (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date TEXT NOT NULL,
    sector_name TEXT NOT NULL,
    change_pct REAL DEFAULT 0,
    UNIQUE(trade_date, sector_name)
  );
  CREATE INDEX IF NOT EXISTS idx_sm_date ON sectoral_movement(trade_date);

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

// Auto-migrate daily_scores for new demand/supply + foreign columns
try {
  const dsCols = db.prepare("PRAGMA table_info(daily_scores)").all().map(c => c.name);
  const newCols = [
    ['bid_offer_ratio','REAL DEFAULT 0'],['bid_offer_5d','REAL DEFAULT 0'],
    ['rel_vol','REAL DEFAULT 0'],['freq_spike','REAL DEFAULT 0'],['val_spike','REAL DEFAULT 0'],
    ['fnet_10d','REAL DEFAULT 0'],['fnet_20d','REAL DEFAULT 0'],
    ['foreign_pct_val','REAL DEFAULT 0'],['foreign_accum_streak','INTEGER DEFAULT 0'],['fnet_vs_avg','REAL DEFAULT 0'],
    ['score_demand','REAL DEFAULT 0'],['score_foreign','REAL DEFAULT 0'],
    ['w_demand','REAL DEFAULT 0'],['w_foreign','REAL DEFAULT 0']
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