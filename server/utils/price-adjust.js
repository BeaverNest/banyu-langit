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

// Aksi korporasi dari tabel `corporate_actions` HANYA dipakai kalau kode itu
// belum punya entri `ca_factors`. Kalau keduanya dipakai, satu event dihitung
// DUA KALI: RAJA 1:5 (ex 2026-07-16) jadi 0,2 x 0,2 = 0,04, DSSA 25x jadi 625x.
// Selain itu `corporate_actions` hanya 5 baris dan ex_date-nya bisa salah
// (MLPT: 2026-07-29 di tabel itu vs 2026-07-21 di ca_factors, yang cocok dengan
// langkah harga), jadi tabel itu tidak boleh jadi sumber kedua.
function fallbackRatioActions(factors, actions) {
  if (factors && factors.length) return [];
  return (actions || []).filter(ca => ca && ca.ratio > 0 && ca.ratio !== 1);
}

// Faktor kumulatif satu baris untuk kode: `ca_factors` kalau ada, selain itu
// (dan hanya selain itu) ratio dari `corporate_actions`. Angka ini yang dipakai
// chart, /stock-detail, dan screener supaya ketiganya sama dengan adjustRows().
function factorForRow(factors, actions, date) {
  let f = factorAt(factors, date);
  for (const ca of fallbackRatioActions(factors, actions)) {
    if (date < ca.ex_date) f *= (1 / ca.ratio);
  }
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
//
// PENTING (bug nyata 19 Okt 2026): better-sqlite3 TIDAK mengizinkan statement lain
// dijalankan dari dalam user-defined function — callback-nya berjalan saat statement
// masih aktif, `db.prepare(...).all()` di situ gagal, dan try/catch di loadFactors()
// menelan error itu sehingga map-nya {} -> ca_adj diam-diam mengembalikan harga MENTAH.
// Jadi faktor dibaca HANYA di luar callback: sekali saat registrasi, lalu di-refresh
// deferred (setImmediate) kalau TTL lewat. Nilai balik = fungsi refresh manual.
function registerSqlAdjust(db, opts) {
  const o = opts || {};
  const ttlMs = Number.isFinite(o.ttlMs) ? o.ttlMs : 60000;
  let map = {};
  let at = 0;
  let pending = false;
  const load = () => { map = loadFactors(db); at = Date.now(); return map; };
  // Aman dipanggil dari route/handler (di luar eksekusi statement).
  const refresh = () => load();
  // Dipanggil dari dalam callback: jangan menyentuh koneksi sekarang, tunda ke tick berikutnya.
  const refreshDeferred = () => {
    if (pending) return;
    pending = true;
    setImmediate(() => { pending = false; try { load(); } catch (e) { /* tetap pakai map lama */ } });
  };
  load();
  db.function('ca_adj', function (close, code, date) {
    if (close == null || !code || !date) return close;
    if (Date.now() - at > ttlMs) refreshDeferred();
    const f = factorAt(map[code], date);
    return f === 1 ? close : close * f;
  });
  return refresh;
}

module.exports = { loadFactors, cumulativeFactors, adjustRows, factorAt, fallbackRatioActions, factorForRow, registerSqlAdjust };
