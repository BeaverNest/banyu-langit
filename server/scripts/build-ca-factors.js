// Bangun tabel ca_factors dari perpindahan basis harga di idx_daily.
// Metode: prev_close(resmi, sudah disesuaikan bursa) / close sesi sebelumnya.
// Faktor < 1 = split/bonus, > 1 = reverse split.
// Jalankan: node server/scripts/build-ca-factors.js [threshold]
const path = require('path');
const Database = require('better-sqlite3');
const DB_PATH = process.env.DB_PATH || '/app/data/trading.db';
const db = new Database(DB_PATH);

const THRESHOLD = parseFloat(process.argv[2]) || 0.01;

db.exec(`
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
`);

const codes = db.prepare('SELECT DISTINCT code FROM idx_daily WHERE close>0').all().map(r => r.code);
const q = db.prepare('SELECT trade_date,close,prev_close FROM idx_daily WHERE code=? AND close>0 ORDER BY trade_date');
const ins = db.prepare(`INSERT INTO ca_factors (code, ex_date, factor, cum_close, ref_close, basis, source)
  VALUES (?,?,?,?,?,'prev_close','derived')
  ON CONFLICT(code, ex_date) DO UPDATE SET factor=excluded.factor, cum_close=excluded.cum_close,
    ref_close=excluded.ref_close, created_at=datetime('now')`);

let n = 0, codesHit = 0;
const tx = db.transaction(() => {
  for (const c of codes) {
    const rows = q.all(c);
    let hit = 0;
    for (let i = 1; i < rows.length; i++) {
      const pRaw = rows[i - 1].close, pAdj = rows[i].prev_close;
      if (!(pRaw > 0 && pAdj > 0)) continue;
      const f = pAdj / pRaw;
      if (Math.abs(f - 1) > THRESHOLD) {
        ins.run(c, rows[i].trade_date, Math.round(f * 1e6) / 1e6, pRaw, pAdj);
        n++; hit++;
      }
    }
    if (hit) codesHit++;
  }
});
tx();
const tot = db.prepare('SELECT COUNT(*) n, COUNT(DISTINCT code) c FROM ca_factors').get();
console.log(JSON.stringify({ inserted: n, codes_hit: codesHit, table_total: tot }));
