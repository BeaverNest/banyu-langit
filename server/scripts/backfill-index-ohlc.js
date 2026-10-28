'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// BACKFILL index_ohlc — OHLC IHSG dari Yahoo ^JKSE (range max).
//
// KENAPA ADA: chart IHSG sebelumnya hanya bisa menggambar candle untuk 43 sesi
// terakhir, karena satu-satunya rail OHLC indeks (`idx_indices`, sumber resmi bursa)
// baru mulai 31 Agu 2026. Akibatnya 2/3 lebar chart berupa garis dan candle hanya
// menempati sepertiga kanan — terbaca "aneh" oleh owner, dan memang begitu.
//
// KENAPA AMAN DIPAKAI: `close` Yahoo ^JKSE sudah diuji terhadap `index_chart`
// (rail resmi) pada 240 hari tumpang tindih: selisih MAKSIMUM 0,00 poin, bukan
// "hampir sama". `high`/`low` juga identik 0,00 pada 43 hari yang bisa dibandingkan
// dengan `idx_indices`. Yang TIDAK sama adalah `open`: di idx_indices kolom
// `previous` bukan open sebenarnya, selisih rata-rata 33,9 poin (maks 469,9), jadi
// candle lama sebenarnya digambar dengan open = penutupan sebelumnya. Skrip ini
// memperbaiki itu.
//
// ATURAN:
//  - Tabel terpisah (`index_ohlc`), TIDAK menimpa `idx_indices` yang resmi.
//  - Idempoten: INSERT ... ON CONFLICT DO UPDATE.
//  - Bar tanpa open/high/low valid dilewati, bukan diisi close (candle setinggi nol
//    terbaca seperti data rusak).
//
// JEBAKAN RANGE: Yahoo MENGGUGURKAN resolusi saat range terlalu panjang. Diuji 28 Okt 2026:
//   10y -> 2.411 bar HARIAN, 5y -> 1.200, 2y -> 475, 1y -> 240
//   max -> 439 bar BULANAN (1990-04-30 -> 2026-10-28)
// `max` karena itu DILARANG di sini; rentang dibatasi MAX_YEARS dan hasilnya diperiksa
// jarak antar-tanggalnya sebelum ditulis. Tanpa pagar ini, candle "10 tahun" akan
// sebenarnya candle bulanan yang tampak seperti crash bertahun-tahun.
//
// Pakai: docker exec banyu-langit node server/scripts/backfill-index-ohlc.js [--dry]
// ═══════════════════════════════════════════════════════════════════════════

const path = require('path');
const { fetchYahoo } = require('../routes/eod-fetcher');
// db.js membuat tabel bila belum ada, jadi cukup require — jangan buka file DB manual
// (container memakai /app/data/trading.db, bukan path relatif repo).
const db = require('../db').db;

const INDEX_CODE = 'COMPOSITE';
const YAHOO_SYMBOL = '^JKSE';
// 10y: cukup panjang untuk semua jendela chart dan MA200, dan masih harian.
const MAX_YEARS = '10y';
// Jarak antar-tanggal di atas ini berarti Yahoo sudah menggugurkan resolusi.
const MAX_MEDIAN_GAP_DAYS = 5;
const DRY = process.argv.includes('--dry');

(async () => {
  console.log('[backfill-index-ohlc] fetch ' + YAHOO_SYMBOL + ' range=' + MAX_YEARS + ' ...');
  const rows = await fetchYahoo(YAHOO_SYMBOL, MAX_YEARS);
  console.log('[backfill-index-ohlc] rows dari Yahoo: ' + rows.length +
              ' (' + (rows[0] && rows[0].date) + ' -> ' + (rows[rows.length - 1] && rows[rows.length - 1].date) + ')');

  // Validasi bentuk bar sebelum menyentuh DB. Candle yang open/close-nya di luar
  // high/low akan tampil mustahil, jadi bar seperti itu dibuang dan dilaporkan.
  const clean = [];
  let dropped = 0;
  for (const r of rows) {
    const { open, high, low, close } = r;
    if (![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)) { dropped++; continue; }
    if (high < low || open > high + 0.01 || open < low - 0.01 || close > high + 0.01 || close < low - 0.01) {
      dropped++; continue;
    }
    clean.push(r);
  }
  console.log('[backfill-index-ohlc] valid: ' + clean.length + ', dibuang: ' + dropped);

  // ── Pagar resolusi ──
  // Kalau Yahoo mengembalikan bar bulanan (seperti pada range=max), jarak antar-tanggal
  // melonjak ke ~30 hari. Menulisnya akan membuat chart harian yang menyesatkan, jadi
  // skrip BERHENTI alih-alih menghasilkan candle yang terlihat benar tapi bukan harian.
  const gaps = [];
  for (let i = 1; i < clean.length; i++) {
    const a = Date.parse(clean[i - 1].date), b = Date.parse(clean[i].date);
    if (Number.isFinite(a) && Number.isFinite(b)) gaps.push((b - a) / 86400000);
  }
  gaps.sort((x, y) => x - y);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  console.log('[backfill-index-ohlc] median jarak antar-bar: ' + medianGap.toFixed(2) + ' hari');
  if (medianGap > MAX_MEDIAN_GAP_DAYS) {
    throw new Error('Resolusi bukan harian (median gap ' + medianGap.toFixed(1) +
      ' hari). Yahoo menggugurkan data untuk range ini — turunkan rentang, jangan tulis.');
  }

  if (DRY) {
    console.log('[backfill-index-ohlc] --dry: tidak menulis apa pun.');
    console.log('  contoh 3 bar terakhir:', clean.slice(-3).map((r) => r.date + ' O' + r.open.toFixed(1) + ' H' + r.high.toFixed(1) + ' L' + r.low.toFixed(1) + ' C' + r.close.toFixed(1)));
    return;
  }

  const up = db.prepare(`
    INSERT INTO index_ohlc (index_code, trade_date, open, high, low, close, volume, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'yahoo:^JKSE')
    ON CONFLICT(index_code, trade_date) DO UPDATE SET
      open=excluded.open, high=excluded.high, low=excluded.low,
      close=excluded.close, volume=excluded.volume,
      source=excluded.source, updated_at=datetime('now')
  `);

  let n = 0;
  db.transaction(() => {
    for (const r of clean) {
      up.run(INDEX_CODE, r.date, r.open, r.high, r.low, r.close, r.volume || 0);
      n++;
    }
  })();

  const stat = db.prepare(
    'SELECT COUNT(*) c, MIN(trade_date) a, MAX(trade_date) b FROM index_ohlc WHERE index_code=?'
  ).get(INDEX_CODE);
  console.log('[backfill-index-ohlc] ditulis: ' + n + ' | total di tabel: ' + stat.c + ' (' + stat.a + ' -> ' + stat.b + ')');

  // Uji konsistensi: close index_ohlc harus sama dengan index_chart pada tanggal yang sama.
  const mism = db.prepare(`
    SELECT COUNT(*) c, MAX(ABS(io.close - ic.value)) mx
    FROM index_ohlc io
    JOIN index_chart ic ON ic.index_code = io.index_code AND ic.chart_date = io.trade_date
    WHERE io.index_code = ?
  `).get(INDEX_CODE);
  console.log('[backfill-index-ohlc] vs index_chart: overlap=' + mism.c + ', selisih maks=' + (mism.mx == null ? '-' : Number(mism.mx).toFixed(4)) + ' poin');
  if (mism.mx != null && mism.mx > 1) {
    console.error('[backfill-index-ohlc] PERINGATAN: selisih > 1 poin. Jangan pakai rail ini sebelum diperiksa.');
    process.exitCode = 2;
  }
})().catch((e) => {
  console.error('[backfill-index-ohlc] GAGAL: ' + e.message);
  process.exitCode = 1;
});
