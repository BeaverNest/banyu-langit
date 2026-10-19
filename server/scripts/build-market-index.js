// Bangun benchmark pasar dari idx_daily: indeks EQUAL-WEIGHTED berantai.
// Kenapa bukan kapitalisasi: kolom listed_shares nol untuk seluruh baris
// sebelum 2026 (2020-2025: 0 dari 1.203.620 baris), jadi bobot kapitalisasi
// tidak bisa dihitung mundur. Equal weight konsisten sepanjang 2020-2026.
// Diverifikasi terhadap IHSG resmi 35 sesi terakhir: -20,09% vs -20,54%.
// Dipakai backtest sebagai benchmark ketika IHSG resmi tidak tersedia untuk periode itu.
// Return per saham memakai close/prev_close — prev_close bursa SUDAH disesuaikan
// untuk aksi korporasi, jadi split tidak menciptakan lonjakan.
// Jalankan: node server/scripts/build-market-index.js
const Database = require('better-sqlite3');
const DB_PATH = process.env.DB_PATH || '/app/data/trading.db';
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS market_index_constructed (
    trade_date TEXT PRIMARY KEY,
    close REAL NOT NULL,
    r_pct REAL,
    n_stocks INTEGER,
    basis TEXT DEFAULT 'equal_weighted_chainlinked',
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// Hanya saham yang likuid (median nilai transaksi 20 sesi >= ambang) supaya
// benchmark tidak didominasi mikro-cap dan tidak kena premi rebalancing
// equal-weight. Ambang default Rp1 miliar, sama dengan lantai universe strategi.
const LIQ_MIN = parseFloat(process.argv[2] || '1000000000');
const rows = db.prepare(`SELECT trade_date, code, close, prev_close, value,
  COALESCE(listed_shares,0) AS listed_shares
  FROM idx_daily WHERE close>0 ORDER BY trade_date, code`).all();

const liqQ = new Map();
function median(a) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const ins = db.prepare(`INSERT INTO market_index_constructed (trade_date, close, r_pct, n_stocks, basis)
  VALUES (?,?,?,?,'equal_weighted_liquid') ON CONFLICT(trade_date) DO UPDATE SET close=excluded.close,
  r_pct=excluded.r_pct, n_stocks=excluded.n_stocks, basis=excluded.basis, updated_at=datetime('now')`);

let prevMap = new Map();      // code -> {close, shares}
const valueHist = new Map();  // code -> median nilai transaksi 20 sesi (likuiditas)
let idxLevel = 1000;
let curDate = null;
let bucket = [];
let days = 0;

function flush() {
  if (!bucket.length) return;
  // total mcap sesi sebelumnya untuk kode yang ada di kedua sesi
  let n = 0, sum = 0;
  for (const r of bucket) {
    const p = prevMap.get(r.code);
    if (!p || !(r.prev_close > 0)) continue;
    if (valueHist.get(r.code) == null) continue;      // belum punya histori likuiditas
    if (valueHist.get(r.code) < LIQ_MIN) continue;    // di bawah lantai likuiditas
    sum += (r.close / r.prev_close - 1);
    n++;
  }
  const r_t = n > 0 ? sum / n : 0;
  idxLevel = idxLevel * (1 + r_t);
  ins.run(curDate, Math.round(idxLevel * 1000) / 1000, Math.round(r_t * 1e6) / 1e6, bucket.length);
  days++;
  // sesi ini menjadi acuan sesi berikutnya
  prevMap = new Map();
  for (const r of bucket) {
    prevMap.set(r.code, { close: r.close, shares: r.listed_shares || 0 });
    const q = liqQ.get(r.code) || [];
    q.push(r.value || 0);
    if (q.length > 20) q.shift();
    liqQ.set(r.code, q);
    valueHist.set(r.code, median(q));
  }
  bucket = [];
}

for (const r of rows) {
  if (curDate === null) curDate = r.trade_date;
  if (r.trade_date !== curDate) { flush(); curDate = r.trade_date; }
  bucket.push(r);
}
flush();

const s = db.prepare('SELECT COUNT(*) n, MIN(trade_date) a, MAX(trade_date) b FROM market_index_constructed').get();
const tail = db.prepare('SELECT trade_date, close FROM market_index_constructed ORDER BY trade_date DESC LIMIT 3').all();
console.log(JSON.stringify({ days, range: s, tail }));
