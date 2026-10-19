// Penyesuaian harga untuk aksi korporasi — SATU implementasi untuk chart,
// backtest, dan analisis. Sumber faktor: tabel ca_factors (diturunkan dari
// prev_close resmi IDX; diverifikasi terhadap IDX-API /trading/price-adjustments).
//
// Aturan: harga baris SEBELUM ex_date dikalikan faktor kumulatif.
// Contoh: BBCA split 1:5 ex 2021-10-13 -> faktor 0.20014 (harga lama 36.600 -> 7.325).

function loadFactors(db) {
  const map = {};
  try {
    const rows = db.prepare('SELECT code, ex_date, factor FROM ca_factors ORDER BY ex_date DESC').all();
    for (const r of rows) {
      if (!r.factor || r.factor <= 0 || r.factor === 1) continue;
      (map[r.code] = map[r.code] || []).push(r);
    }
  } catch (e) { /* tabel belum ada -> tanpa penyesuaian */ }
  return map;
}

// Faktor kumulatif per indeks baris: factorAt[i] berlaku untuk baris i.
// rows harus urut naik menurut trade_date.
function cumulativeFactors(rows, factors, dateKey) {
  const n = rows.length;
  const out = new Array(n).fill(1);
  if (!factors || !factors.length) return out;
  // faktor diurutkan naik agar presisi penjumlahan konsisten
  const fs = factors.slice().sort((a, b) => (a.ex_date < b.ex_date ? -1 : 1));
  let cum = 1;
  for (let i = n - 1; i >= 1; i--) {
    const d = rows[i][dateKey || 'trade_date'];
    for (const f of fs) {
      if (f.ex_date === d) { cum *= f.factor; }
    }
    out[i - 1] = cum;
  }
  return out;
}

// Faktor untuk SATU bar bertanggal `date` (produk semua event dengan ex_date > date).
// Identik dengan elemen cumulativeFactors(rows)[i] untuk baris bertanggal `date`,
// jadi pemakaian di jalur SQL/JS memberi angka yang sama dengan adjustRows().
function factorAt(factors, date) {
  let f = 1;
  if (!factors || !factors.length || !date) return f;
  for (const e of factors) if (e.ex_date > date) f *= e.factor;
  return f;
}

// Terapkan ke field harga (ac/ao/ah/al) dan volume (disesuaikan ke basis terbaru).
// Volume lama dikali 1/faktor agar setara lembar hari ini (split menambah lembar).
function adjustRows(rows, factors, opts) {
  const o = opts || {};
  const dateKey = o.dateKey || 'trade_date';
  const priceFields = o.priceFields || { close: 'ac', open: 'ao', high: 'ah', low: 'al' };
  const volFields = o.volumeFields || { volume: 'avol' };
  const cf = cumulativeFactors(rows, factors, dateKey);
  for (let i = 0; i < rows.length; i++) {
    const f = cf[i];
    const r = rows[i];
    for (const src of Object.keys(priceFields)) {
      const raw = r[src] != null ? r[src] : r.close;
      r[priceFields[src]] = f === 1 ? raw : Math.round(raw * f);
    }
    for (const src of Object.keys(volFields)) {
      if (r[src] == null) continue;
      r[volFields[src]] = f === 1 ? r[src] : Math.round(r[src] / f);
    }
    r.__adjFactor = f;
  }
  return rows;
}

// Daftarkan `ca_adj(close, code, trade_date)` sebagai fungsi SQL. Satu-satunya
// cara jalur SQL (AVG/GROUP BY) memakai basis harga yang sama dengan chart,
// backtest, dan skoring — jangan duplikasi rumus faktor di query lain.
// Faktor di-cache ttlMs (default 60s) karena ca_factors dibangun ulang oleh
// scripts/build-ca-factors.js, bukan per-request; panggil nilai balik untuk refresh manual.
function registerSqlAdjust(db, opts) {
  const o = opts || {};
  const ttlMs = Number.isFinite(o.ttlMs) ? o.ttlMs : 60000;
  let cache = { at: 0, map: null };
  const fresh = () => {
    const now = Date.now();
    if (!cache.map || now - cache.at > ttlMs) cache = { at: now, map: loadFactors(db) };
    return cache.map;
  };
  db.function('ca_adj', function (close, code, date) {
    if (close == null || !code || !date) return close;
    const f = factorAt(fresh()[code], date);
    return f === 1 ? close : close * f;
  });
  return fresh;
}

module.exports = { loadFactors, cumulativeFactors, adjustRows, factorAt, registerSqlAdjust };
