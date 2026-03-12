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