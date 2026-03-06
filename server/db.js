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
    tickers INTEGER DEFAULT 0, uploaded_at TEXT DEFAULT (datetime('now'))
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

// ═══ Helper functions ═══
function latestSnap() {
  const r = db.prepare('SELECT MAX(snapshot_date) as d FROM holdings').get();
  return r?.d || '';
}

function latestIdxDate() {
  const r = db.prepare('SELECT MAX(trade_date) as d FROM idx_daily').get();
  return r?.d || '';
}

module.exports = { db, dataDir, latestSnap, latestIdxDate };
