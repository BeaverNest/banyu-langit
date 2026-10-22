/**
 * build_signals.js — hitung indikator + flag untuk seluruh universe (IDX + US)
 * dan simpan ke tabel signals_daily. Backend-only, idempoten.
 *
 * Jalankan di kontainer:
 *   docker cp build_signals.js banyu-langit:/tmp/bs.js
 *   docker exec -e NODE_PATH=/app/node_modules banyu-langit node --max-old-space-size=2048 /tmp/bs.js [sessions]
 *
 * Desain:
 * - Hanya menyimpan N sesi terakhir (default 260) supaya tabel tetap ringan.
 * - Satu baris per (market, code, trade_date). Delete-then-insert per rentang.
 * - Kolom indikator dihitung dari harga DISESUAIKAN (US) dan harga mentah IDX apa adanya.
 */
const D = require('better-sqlite3');
const db = new D('/app/data/trading.db');
const SESSIONS = parseInt(process.argv[2] || '500', 10);  // jumlah sesi yang DISIMPAN
const LOOKBACK = 200;                                     // bar untuk MA200

db.exec(`
CREATE TABLE IF NOT EXISTS signals_daily (
  market TEXT NOT NULL,
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  close REAL,
  sma10 REAL, sma20 REAL, sma50 REAL, sma100 REAL, sma200 REAL,
  ma200_slope REAL,
  macd REAL, macd_signal REAL, macd_hist REAL,
  rsi14 REAL,
  atr14 REAL,
  vol_ma20 REAL, vol_ratio REAL,
  ret_1d REAL, ret_5d REAL, ret_20d REAL,
  hi20 REAL, lo20 REAL,
  dist_ma200 REAL,
  f_trend_up INTEGER, f_cross200_up INTEGER, f_vol_spike INTEGER,
  f_break20 INTEGER, f_oversold INTEGER, f_overbought INTEGER,
  built_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (market, code, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_signals_date ON signals_daily(trade_date, market);
CREATE INDEX IF NOT EXISTS idx_signals_flags ON signals_daily(f_trend_up, f_cross200_up);
`);

const ins = db.prepare(`INSERT OR REPLACE INTO signals_daily
 (market,code,trade_date,close,sma10,sma20,sma50,sma100,sma200,ma200_slope,
  macd,macd_signal,macd_hist,rsi14,atr14,vol_ma20,vol_ratio,ret_1d,ret_5d,ret_20d,
  hi20,lo20,dist_ma200,f_trend_up,f_cross200_up,f_vol_spike,f_break20,f_oversold,f_overbought)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

const ema = (arr, n) => { const k = 2 / (n + 1); let p = arr[0]; return arr.map((x, i) => (p = i === 0 ? x : x * k + p * (1 - k))); };

function seriesOf(market, code, tailN) {
  const table = market === 'US' ? 'us_daily' : 'idx_daily';
  const rows = db.prepare(`SELECT trade_date d, high h, low l, close c, volume v FROM ${table}
    WHERE code=? AND close>0 ORDER BY trade_date DESC LIMIT ?`).all(code, tailN);
  return rows.reverse();
}

function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= n) { gain += g; loss += l; if (i === n) { gain /= n; loss /= n; out[i] = 100 - 100 / (1 + gain / (loss || 1e-9)); } }
    else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; out[i] = 100 - 100 / (1 + gain / (loss || 1e-9)); }
  }
  return out;
}

function atr(highs, lows, closes, n = 14) {
  const tr = highs.map((h, i) => i === 0 ? h - lows[i] : Math.max(h - lows[i], Math.abs(h - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  const out = new Array(tr.length).fill(null);
  let a = null;
  for (let i = 0; i < tr.length; i++) {
    if (i < n - 1) continue;
    if (a === null) { a = tr.slice(0, n).reduce((s, x) => s + x, 0) / n; }
    else a = (a * (n - 1) + tr[i]) / n;
    out[i] = a;
  }
  return out;
}

function processUniverse(market, codes, tailN) {
  let rowsWritten = 0, skipped = 0;
  const start = Date.now();
  const tx = db.transaction(() => {
    for (const code of codes) {
      const rows = seriesOf(market, code, tailN + LOOKBACK);
      if (rows.length < 220) { skipped++; continue; }
      const c = rows.map(x => x.c), h = rows.map(x => x.h), l = rows.map(x => x.l), v = rows.map(x => x.v || 0);
      const sma = n => c.map((_, i) => { if (i < n - 1) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += c[k]; return s / n; });
      const s10 = sma(10), s20 = sma(20), s50 = sma(50), s100 = sma(100), s200 = sma(200);
      const e12 = ema(c, 12), e26 = ema(c, 26);
      const macd = c.map((_, i) => e12[i] - e26[i]);
      const msig = ema(macd, 9);
      const rsi14 = rsi(c), atr14 = atr(h, l, c);
      const volMA = v.map((_, i) => { if (i < 19) return null; let s = 0; for (let k = i - 19; k <= i; k++) s += v[k]; return s / 20; });

      for (let i = 200; i < c.length; i++) {
        const sma200 = s200[i], prev200 = s200[i - 20];
        if (sma200 == null || prev200 == null) continue;
        let vsum = 0, ok = true;
        for (let k = i - 19; k <= i; k++) { if (!v[k]) ok = false; vsum += v[k]; }
        const vox = ok && vsum > 0 ? v[i] / (vsum / 20) : null;
        let hi20 = -Infinity, lo20 = Infinity;
        for (let k = i - 19; k <= i; k++) { if (h[k] > hi20) hi20 = h[k]; if (l[k] < lo20) lo20 = l[k]; }
        const ret1 = i >= 1 ? (c[i] / c[i - 1] - 1) * 100 : null;
        const ret5 = i >= 5 ? (c[i] / c[i - 5] - 1) * 100 : null;
        const ret20 = i >= 20 ? (c[i] / c[i - 20] - 1) * 100 : null;

        const trendUp = c[i] > s50[i] && s50[i] > sma200 ? 1 : 0;
        const cross200 = c[i] > sma200 && c[i - 1] <= s200[i - 1] ? 1 : 0;
        const volSpike = vox != null && vox > 1.5 ? 1 : 0;
        const break20 = c[i] >= hi20 * 0.999 ? 1 : 0;
        const rsiVal = rsi14[i];
        const oversold = rsiVal != null && rsiVal < 30 ? 1 : 0;
        const overbought = rsiVal != null && rsiVal > 70 ? 1 : 0;

        ins.run(market, code, rows[i].d, c[i], s10[i], s20[i], s50[i], s100[i], sma200,
          (sma200 / prev200 - 1) * 100, macd[i], msig[i], macd[i] - msig[i],
          rsi14[i], atr14[i], volMA[i], vox, ret1, ret5, ret20,
          hi20, lo20, (c[i] / sma200 - 1) * 100,
          trendUp, cross200, volSpike, break20, oversold, overbought);
        rowsWritten++;
      }
    }
  });
  tx();
  console.log(`${market}: kode ${codes.length}, baris ${rowsWritten}, dilewati ${skipped}, ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

const codesIdx = db.prepare("SELECT DISTINCT code FROM idx_daily WHERE close>0").all().map(r => r.code);
const codesUs = db.prepare("SELECT DISTINCT code FROM us_daily WHERE close>0").all().map(r => r.code);

// bersihkan rentang yang akan ditulis ulang (idempoten)
db.prepare('DELETE FROM signals_daily').run();

processUniverse('IDX', codesIdx, SESSIONS);
processUniverse('US', codesUs, SESSIONS);

const s = db.prepare('SELECT market, COUNT(*) n, COUNT(DISTINCT code) c, MIN(trade_date) a, MAX(trade_date) b FROM signals_daily GROUP BY market').all();
console.log(JSON.stringify(s));
console.log('db MB:', (db.prepare('pragma page_count').get().page_count * db.prepare('pragma page_size').get().page_size / 1e6).toFixed(0));
db.close();
