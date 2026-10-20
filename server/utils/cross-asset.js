'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// MONITOR LINTAS ASET (kanban t_19f4f0d4).
//
// Masalah yang diselesaikan: Market Regime tumbuh dengan MENAMBAH KARTU (L1 global, L1.5
// makro, L2 komoditas, L3 IDX, kurva, SRBI). Setiap seri baru = blok UI baru, jadi halaman
// makin panjang dan makin sulit dibaca. Di sini SEMUA seri di `custom_tickers` dibaca lewat
// SATU jalur dan diterbitkan sebagai BARIS di satu tabel. Menambah seri (IndONIA, SBN baru,
// kredit bank) = satu baris baru; TIDAK ADA kode UI yang perlu diubah.
//
// Aturan yang dijaga (DoD kartu):
//  1. TIDAK ada daftar kode yang di-hardcode di sini. Sumber kebenaran = tabel custom_tickers
//     (kode, nama, kategori, sumber, unit, value_kind) + custom_ohlc. Seri yang tidak punya
//     bar tetap MUNCUL (dengan `no_series`) supaya hilangnya data terlihat, bukan tersembunyi.
//  2. Perubahan dihitung menurut JENIS NILAI seri (`value_kind`), bukan satu rumus untuk semua:
//       price -> % (perkalian bermakna: US10Y 5,0 -> 5,5 bukan "+10%", itu +50 bp)
//       rate  -> percentage point (pp), ADDITIF
//       level -> selisih dalam `unit` (mis. cadangan devisa USD bn)
//       null  -> belum dideklarasikan: dikirim `kind:null`, UI menampilkan selisih absolut
//                + penanda "satuan?", dan seri masuk daftar coverage. TIDAK ditebak.
//     Menghitung persen-dari-persen untuk suku bunga/inflasi adalah kesalahan yang sudah ada di
//     panel lama (MACRO_CAR_YOY terbaca "-48,91%" karena 5 bar bulanan dipakai sebagai "5D").
//  3. Jendela 1/5/20 mengikuti KADENS seri: harian 1/5/20 sesi, mingguan 1/4/12 minggu,
//     bulanan 1/3/12 bulan. Angka cadence diturunkan dari jarak median bar seri itu sendiri
//     (bukan dideklarasikan) — deklarasi kadens akan basi setiap kali jadwal rilis berubah,
//     sementara jarak bar adalah fakta yang teramati.
//  4. Kesegaran TIDAK dihitung ulang di sini: `seriesFreshness()` dari series-freshness.js
//     dipakai apa adanya (ambang expected_lag_sessions per seri). Seri 'excess' -> level
//     TIDAK dikirim sebagai `last` (null) karena bar terakhirnya bukan sesi terkini.
//     Seri 'by_source'/'na' mengirim level + tanggal + umur; UI wajib menampilkan tanggalnya.
//  5. Semua angka dibulatkan 2 desimal di server (r2) supaya format konsisten lintas blok.
// ═══════════════════════════════════════════════════════════════════════════

const freshnessUtil = require('./series-freshness');

const REGULAR_SESSION = freshnessUtil.REGULAR_SESSION;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLASH_RE = /^(\d{4})\/(\d{2})\/(\d{2})$/;

// Urutan kelas aset dari yang paling "luar" (dunia) ke paling "dalam" (domestik/makro).
const CATEGORY_ORDER = ['global_index', 'currency', 'commodity', 'commodity_unverified', 'rates', 'macro', 'custom'];
const CATEGORY_LABELS = {
  global_index: 'Indeks Global',
  currency: 'Valuta',
  commodity: 'Komoditas',
  commodity_unverified: 'Komoditas (belum terverifikasi)',
  rates: 'Rates & SUN',
  macro: 'Makro',
  custom: 'Custom',
};

// Jendela per kadens. Satuan = PERIODE seri itu sendiri, dan UI menuliskan legendanya.
const WINDOWS = {
  D: { lags: [1, 5, 20], unit: 'sesi' },
  W: { lags: [1, 4, 12], unit: 'minggu' },
  M: { lags: [1, 3, 12], unit: 'bulan' },
  Q: { lags: [1, 2, 4], unit: 'kuartal' },
  Y: { lags: [1, 2, 5], unit: 'tahun' },
};

const r2 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Tanggal ISO dari 'YYYY-MM-DD' atau 'YYYY/MM/DD'. Kosong/tak dikenal -> null (bukan ditebak). */
function toIso(d) {
  const s = String(d == null ? '' : d).trim();
  if (ISO_RE.test(s)) return s;
  const m = SLASH_RE.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function dayDiff(aIso, bIso) {
  const a = Date.parse(aIso + 'T00:00:00Z');
  const b = Date.parse(bIso + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** Kadens dari jarak median hari antar-bar. Ambang dipilih dari praktik sumber yang kita punya. */
function deriveFrequency(datesAsc) {
  const gaps = [];
  for (let i = 1; i < datesAsc.length; i++) {
    const g = dayDiff(datesAsc[i - 1], datesAsc[i]);
    if (g != null && g > 0) gaps.push(g);
  }
  if (!gaps.length) return { freq: 'D', median_gap_days: null, freq_basis: 'no_gap' };
  gaps.sort((a, b) => a - b);
  const med = gaps[Math.floor(gaps.length / 2)];
  const freq = med <= 4 ? 'D' : med <= 10 ? 'W' : med <= 35 ? 'M' : med <= 100 ? 'Q' : 'Y';
  return { freq, median_gap_days: med, freq_basis: 'derived' };
}

function windowsFor(freq) {
  const w = WINDOWS[freq] || WINDOWS.D;
  return { lags: w.lags, unit: w.unit, label: `${w.lags[0]}/${w.lags[1]}/${w.lags[2]} ${w.unit}` };
}

/**
 * Satu baris monitor untuk satu seri.
 * @param {{code:string,name:string,category:string,source:string,unit:string|null,value_kind:string|null}} t
 * @param {Array<{trade_date:string, close:number}>} rawRows  urut ASC (belum dinormalisasi)
 * @param {object} ctx  konteks series-freshness.buildContext
 */
function buildRow(t, rawRows, ctx) {
  // Normalisasi tanggal ke ISO dan buang bar yang tanggalnya tak bisa dibaca — jangan menebak.
  const rows = [];
  for (const r of (rawRows || [])) {
    const iso = toIso(r.trade_date);
    if (!iso || !isNum(r.close)) continue;
    rows.push({ date: iso, close: r.close });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const n = rows.length;
  const lastRow = n ? rows[n - 1] : null;
  const kind = t.value_kind || null;                  // 'price' | 'rate' | 'level' | null
  const unit = t.unit || null;

  // ── Kesegaran: SATU implementasi (series-freshness.js), bukan ambang lokal ──
  // `lastRegularBarDate` membaca properti `trade_date`; baris di sini sudah DINORMALISASI ke
  // `date`, jadi dipetakan ulang — kalau tidak, util menerima null dan setiap seri jatuh ke
  // 'no_series' (bug yang membuat 78 seri tampil "tanpa seri" pada versi pertama modul ini).
  const probeRows = rows.map(r => ({ trade_date: r.date }));
  const fresh = freshnessUtil.seriesFreshness(ctx, freshnessUtil.lastRegularBarDate(probeRows), t.code);
  const refDate = fresh.ref_date || null;
  const ageDays = lastRow && refDate ? dayDiff(lastRow.date, refDate) : null;

  const freqInfo = deriveFrequency(rows.map(r => r.date));
  const win = windowsFor(freqInfo.freq);

  // ── Perubahan: tergantung `value_kind` ──
  const changeAt = (lag) => {
    if (!n) return null;
    const base = rows[n - 1 - lag];
    if (!base) return null;
    if (kind === 'price') return base.close > 0 ? r2((lastRow.close / base.close - 1) * 100) : null;
    if (kind === 'rate' || kind === 'level') return r2(lastRow.close - base.close);
    // kind tidak dideklarasikan: selisih absolut dikirim, UI memberi penanda "satuan?".
    return r2(lastRow.close - base.close);
  };

  // ── YTD: bar pertama tahun berjalan. Seri yang baru mulai tahun ini diberi `inception`. ──
  let ytd = null, ytdBasis = null, ytdFrom = null;
  if (n) {
    const y = lastRow.date.slice(0, 4);
    const base = rows.find(r => r.date.slice(0, 4) === y);
    if (base) {
      ytdFrom = base.date;
      ytdBasis = base === rows[0] ? 'inception' : 'first_bar_of_year';
      if (kind === 'price') ytd = base.close > 0 ? r2((lastRow.close / base.close - 1) * 100) : null;
      else ytd = r2(lastRow.close - base.close);
    }
  }

  // ── Persentil 1 tahun: pangsa bar 365 hari terakhir yang <= level sekarang (mid-rank). ──
  let pctile = null, winN = 0;
  if (lastRow) {
    const cut = new Date(Date.parse(lastRow.date + 'T00:00:00Z') - 365 * 86400000).toISOString().slice(0, 10);
    const w = rows.filter(r => r.date >= cut).map(r => r.close);
    winN = w.length;
    if (winN >= 21) {
      let below = 0, equal = 0;
      for (const v of w) { if (v < lastRow.close) below++; else if (v === lastRow.close) equal++; }
      pctile = r2(((below + 0.5 * equal) / winN) * 100);
    }
  }

  // Level TIDAK boleh tampil sebagai "terkini" bila seri di luar kebiasaan sumbernya (excess).
  // Nilainya tetap dikirim terpisah (last_bar_value) untuk drill-down/tooltip, dengan tanggalnya.
  const stale = fresh.state === 'excess';
  const levelCurrent = stale ? null : (lastRow ? lastRow.close : null);

  // 'na' = umurnya tidak diukur. Bila umurnya sudah jauh lebih panjang dari kadensnya, itu
  // bukan "segar" — diberi tanda `aged` supaya masuk coverage (tanpa menyebutnya basi).
  // Ambang = kelonggaran rilis normal per kadens (data bulanan memang terbit ~1 bulan kemudian;
  // data kuartalan ~1 kuartal). Bukan ambang "basi" — seri ber-deklarasi memakai
  // expected_lag_sessions, ini hanya untuk seri yang umurnya TIDAK diukur.
  const AGED_DAYS = { D: 5, W: 21, M: 60, Q: 130, Y: 400 };
  const agedDays = AGED_DAYS[freqInfo.freq] || AGED_DAYS.D;
  const aged = !stale && ageDays != null && ageDays > agedDays;

  return {
    code: t.code,
    name: t.name || t.code,
    category: t.category || 'custom',
    category_label: CATEGORY_LABELS[t.category] || t.category || 'Custom',
    source: t.source || null,
    unit,
    kind,
    unit_declared: !!(t.unit || t.value_kind),
    freq: freqInfo.freq,
    freq_basis: freqInfo.freq_basis,
    median_gap_days: freqInfo.median_gap_days,
    window: win,
    last: r2(levelCurrent),
    last_bar_value: lastRow ? r2(lastRow.close) : null,
    as_of: lastRow ? lastRow.date : null,
    age_days: ageDays,
    n_bars: n,
    first_date: n ? rows[0].date : null,
    chg_1: changeAt(win.lags[0]),
    chg_5: changeAt(win.lags[1]),
    chg_20: changeAt(win.lags[2]),
    chg_ytd: ytd,
    ytd_basis: ytdBasis,
    ytd_from: ytdFrom,
    pctile_1y: pctile,
    pctile_n: winN,
    // min/max jendela 1 tahun untuk drill-down (posisi level dalam rentangnya)
    win_1y_min: winN ? r2(Math.min.apply(null, rows.filter(r => r.date >= new Date(Date.parse(lastRow.date + 'T00:00:00Z') - 365 * 86400000).toISOString().slice(0, 10)).map(r => r.close))) : null,
    win_1y_max: winN ? r2(Math.max.apply(null, rows.filter(r => r.date >= new Date(Date.parse(lastRow.date + 'T00:00:00Z') - 365 * 86400000).toISOString().slice(0, 10)).map(r => r.close))) : null,
    no_series: n === 0,
    // ---- kesegaran (kontrak series-freshness.js, diteruskan apa adanya) ----
    state: fresh.state,
    stale,
    aged,
    lag_sessions: fresh.lag_sessions,
    lag_capped: !!fresh.lag_capped,
    expected_lag_sessions: fresh.expected_lag_sessions,
    excess_sessions: fresh.excess_sessions,
    lag_basis: fresh.lag_basis,
    ref_date: refDate,
    // 30 bar terakhir untuk sparkline drill-down (dibulatkan 2 desimal: aturan format payload)
    spark: rows.slice(-30).map(r => r2(r.close)),
  };
}

/** Baca SEMUA seri + metriknya. Satu query custom_ohlc (bukan satu per kode). */
function buildMonitor(db, ctx) {
  const tickers = db.prepare(
    `SELECT code, name, category, source, unit, value_kind, expected_lag_sessions, lag_basis
     FROM custom_tickers ORDER BY code`).all();
  const byCode = {};
  let rows = [];
  try {
    rows = db.prepare(`SELECT code, trade_date, close FROM custom_ohlc
                       WHERE ${REGULAR_SESSION} ORDER BY code, trade_date`).all();
  } catch (e) { rows = []; }
  // Bar weekend yang TIDAK difilter di atas (sesi 'regular' sudah difilter SQL) tetap
  // dinormalisasi tanggalnya di buildRow; urutan ASC per kode sudah dijamin ORDER BY.

  for (const r of rows) (byCode[r.code] = byCode[r.code] || []).push(r);

  const series = tickers.map(t => buildRow(t, byCode[t.code] || [], ctx));

  const groups = [];
  const seen = {};
  for (const s of series) (seen[s.category] = seen[s.category] || []).push(s);
  const order = CATEGORY_ORDER.concat(Object.keys(seen).filter(k => CATEGORY_ORDER.indexOf(k) === -1));
  for (const cat of order) {
    if (!seen[cat]) continue;
    const items = seen[cat].slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const fresh = items.filter(i => i.state === 'fresh').length;
    const dates = items.map(i => i.as_of).filter(Boolean).sort();
    groups.push({
      category: cat,
      label: CATEGORY_LABELS[cat] || cat,
      count: items.length,
      fresh_count: fresh,
      unmeasured_count: items.filter(i => i.state === 'na').length,
      stale_count: items.filter(i => i.state === 'excess').length,
      delayed_count: items.filter(i => i.state === 'by_source').length,
      no_series_count: items.filter(i => i.no_series).length,
      as_of_min: dates.length ? dates[0] : null,
      as_of_max: dates.length ? dates[dates.length - 1] : null,
      stale_codes: items.filter(i => i.state === 'excess').map(i => i.code),
      // legend jendela: satu group bisa memuat seri harian dan bulanan
      windows: Array.from(new Set(items.map(i => i.freq))).sort().join('/'),
      items,
    });
  }
  return { series, groups, tickers_n: tickers.length, series_n: series.length };
}

/**
 * Coverage: apa yang TIDAK kita punya / tidak bisa diklaim. Menggantikan tombol refresh:
 * halaman harus jujur soal lubangnya, bukan menawarkan "coba lagi".
 */
function coverageOf(monitor, ctx, extras) {
  const e = extras || {};
  const stale = [], delayed = [], unmeasured = [], undeclared_lag = [], unit_missing = [], unit_unknown = [], thin = [], no_series = [], aged = [];
  for (const s of monitor.series) {
    const item = { code: s.code, name: s.name, category: s.category, as_of: s.as_of, age_days: s.age_days, state: s.state, lag_sessions: s.lag_sessions, expected_lag_sessions: s.expected_lag_sessions };
    if (s.no_series) { no_series.push(item); continue; }
    if (s.state === 'excess') stale.push(item);
    else if (s.state === 'by_source') delayed.push(item);
    else if (s.state === 'na') unmeasured.push(Object.assign({ lag_basis: s.lag_basis, aged: s.aged }, item));
    if (s.state !== 'excess' && s.aged) aged.push(item);
    if (!s.lag_basis) undeclared_lag.push(item);
    // Dua kelas satuan yang berbeda dan TIDAK boleh dicampur:
    //   unit_missing = value_kind belum dideklarasikan -> perubahan tidak bisa ditafsirkan
    //   unit_unknown = kind sudah jelas (price/rate/level) tapi satuan level belum, mis.
    //                  STEEL_HRC (USD/t? USD/st?) — level tampil tanpa satuan, jangan dikarang.
    if (!s.kind) unit_missing.push(item);
    else if (!s.unit) unit_unknown.push(Object.assign({ kind: s.kind }, item));
    if (s.n_bars < 21) thin.push(Object.assign({ n_bars: s.n_bars, pctile_1y: s.pctile_1y }, item));
  }
  const byAge = (a, b) => (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days);
  stale.sort(byAge); unmeasured.sort(byAge); thin.sort(byAge); delayed.sort(byAge); aged.sort(byAge);
  return {
    ref_date: ctx ? ctx.ref_date : null,
    ref_source: ctx ? ctx.ref_source : null,
    pipeline: (ctx && ctx.pipeline) || null,
    counts: {
      series: monitor.series.length,
      fresh: monitor.series.filter(s => s.state === 'fresh').length,
      stale: stale.length,
      delayed: delayed.length,
      unmeasured: unmeasured.length,
      aged: aged.length,
      undeclared_lag: undeclared_lag.length,
      unit_missing: unit_missing.length,
      unit_unknown: unit_unknown.length,
      thin: thin.length,
      no_series: no_series.length,
    },
    stale, delayed, unmeasured, aged, undeclared_lag, unit_missing, unit_unknown, thin, no_series,
    extras: e.extras || null,
  };
}

/**
 * "Berubah hari ini": 3-5 baris narasi harian. Dihitung dari seri harian yang SEGAR saja —
 * memasukkan seri basi akan menarasikan pergerakan yang bukan hari ini.
 * @param {Array} series keluaran buildMonitor().series
 * @param {object|null} internals blok internals IDX (boleh null)
 */
function changedToday(series, internals) {
  const daily = series.filter(s => s.freq === 'D' && s.state === 'fresh' && isNum(s.chg_1) && s.kind === 'price');
  const out = [];
  const push = (o) => { if (o && o.text) out.push(o); };

  const ihsg = internals && internals.ihsg;
  if (ihsg && isNum(ihsg.chg_1d)) {
    out.push({ kind: 'idx', label: 'IHSG', value: r2(ihsg.level), delta: r2(ihsg.chg_1d), unit: 'pct', as_of: ihsg.date, tone: ihsg.chg_1d > 0 ? 'up' : ihsg.chg_1d < 0 ? 'down' : 'flat' });
  }
  const ff = internals && internals.foreign_flow;
  if (ff && isNum(ff.net_today)) {
    out.push({ kind: 'flow', label: 'Foreign net 1D', value: r2(ff.net_today / 1e12), delta: null, unit: 'Rp tn', as_of: ff.as_of, tone: ff.net_today > 0 ? 'up' : ff.net_today < 0 ? 'down' : 'flat' });
  }
  const tape = internals && internals.tape;
  if (tape && isNum(tape.value_ratio)) {
    out.push({ kind: 'tape', label: 'Nilai transaksi vs MA20', value: r2(tape.value_ratio), delta: null, unit: 'x', as_of: tape.as_of, tone: tape.value_ratio > 1 ? 'up' : 'down' });
  }
  // Pergerakan terbesar hari ini per kelas aset (hanya seri segar berjenis price)
  for (const cat of ['commodity', 'global_index', 'currency']) {
    const pool = daily.filter(s => s.category === cat);
    if (!pool.length) continue;
    pool.sort((a, b) => Math.abs(b.chg_1) - Math.abs(a.chg_1));
    const top = pool[0];
    out.push({ kind: 'move', label: top.name, code: top.code, value: top.last, delta: top.chg_1, unit: 'pct', as_of: top.as_of, tone: top.chg_1 > 0 ? 'up' : 'down' });
  }
  // Rasio breadth (bila ada) — deskriptif, bukan sinyal beli
  const br = internals && internals.breadth;
  if (br && isNum(br.pct_above_ma50)) {
    out.push({ kind: 'breadth', label: '% saham di atas MA50', value: r2(br.pct_above_ma50), delta: null, unit: 'pct', as_of: internals.as_of, tone: br.pct_above_ma50 > 50 ? 'up' : 'down' });
  }
  return out.slice(0, 6);
}

module.exports = {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  WINDOWS,
  toIso,
  deriveFrequency,
  windowsFor,
  buildRow,
  buildMonitor,
  coverageOf,
  changedToday,
  r2,
};
