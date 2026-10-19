// ═══ KURVA IMBAL HASIL SUN — satu tanggal untuk satu kurva (kanban t_b042b106) ═══
//
// 11 tenor SUN sudah lama tersimpan di custom_ohlc (category='rates',
// source='investing/<pair_id>') tetapi tidak ada satu pun route yang membacanya: hanya ID10Y
// yang pernah dibaca (OV_LABEL di market.js, rateItems di market-sebelumnya). Modul ini
// membangun kurva dari bar yang SUDAH ADA — tidak menulis apa pun, tidak menyimpan slope.
//
// Aturan yang dijaga di sini (DoD kartu):
//  1. SATU tanggal untuk satu kurva. Semua titik diambil dari `trade_date` yang sama; tidak ada
//     tenor yang diam-diam memakai sesi lain. Titik yang tidak punya bar di tanggal kurva
//     dikirim `close: null` + `on_curve:false` + `date` (bar terakhir seri itu) supaya UI
//     menuliskan "—" beserta tanggalnya, bukan mencampur dua sesi.
//  2. Slope dihitung di server dari dua titik TANGGAL SAMA, tidak pernah dari seri tersimpan.
//     Satuan basis poin (1 bp = 0.01 pp): selisih 7.169 − 7.142 = 2.7 bp, dibulatkan 1 desimal.
//  3. Tanggal kurva = tanggal TERBARU yang memuat paling sedikit (jumlah tenor − 1) tenor.
//     Kenapa bukan sekadar MAX(tanggal): kalau satu tenor sudah menerbitkan bar sesi berjalan
//     sementara sepuluh lainnya belum, MAX() akan menghasilkan kurva 1 titik. Kenapa bukan
//     tanggal dengan cakupan maksimum: itu membekukan kurva selamanya begitu satu tenor mati
//     di hulu (kasus TIN, t_61ccbdbe). Toleransi 1 tenor yang hilang + penanda eksplisit
//     (`coverage`, `behind[]`) adalah kompromi yang bisa dibaca pembaca panel.

const TENORS = [
  { code: 'ID1M',  tenor: '1M',  months: 1 },
  { code: 'ID3M',  tenor: '3M',  months: 3 },
  { code: 'ID6M',  tenor: '6M',  months: 6 },
  { code: 'ID1Y',  tenor: '1Y',  months: 12 },
  { code: 'ID3Y',  tenor: '3Y',  months: 36 },
  { code: 'ID5Y',  tenor: '5Y',  months: 60 },
  { code: 'ID10Y', tenor: '10Y', months: 120 },
  { code: 'ID15Y', tenor: '15Y', months: 180 },
  { code: 'ID20Y', tenor: '20Y', months: 240 },
  { code: 'ID25Y', tenor: '25Y', months: 300 },
  { code: 'ID30Y', tenor: '30Y', months: 360 },
];

// Slope yang diminta kartu. `pp` = selisih level (persen poin), `bp` = pp * 100.
// Negatif = inversi (tenor pendek lebih mahal dari tenor panjang).
const SLOPES = [
  { id: '10Y-3Y',  long: 'ID10Y', short: 'ID3Y' },
  { id: '10Y-1Y',  long: 'ID10Y', short: 'ID1Y' },
  { id: '30Y-10Y', long: 'ID30Y', short: 'ID10Y' },
];

const REGULAR_SESSION = "COALESCE(session,'regular')<>'weekend'";
const LOOKBACK_DATES = 60;   // jendela pencarian tanggal kurva (sesi)
const SERIES_LIMIT = 90;     // bar per tenor: cukup untuk Δ1d, Δ20d, dan anchor yang mundur
const DENOM = 100;           // persen -> basis poin

const r1 = (v) => (v == null || !Number.isFinite(v)) ? null : Math.round(v * 10) / 10;

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Baca 11 seri tenor dari custom_ohlc. Satu query per tenor (11 × ≤90 baris), urut DESC. */
function readSeries(db, opts) {
  const o = opts || {};
  const limit = o.limit || SERIES_LIMIT;
  const pred = o.sessionPredicate || REGULAR_SESSION;
  const out = {};
  for (const t of TENORS) {
    out[t.code] = db.prepare(
      `SELECT trade_date AS date, close, source FROM custom_ohlc
       WHERE code=? AND ${pred} AND close IS NOT NULL AND close > 0
       ORDER BY trade_date DESC LIMIT ?`).all(t.code, limit);
  }
  return out;
}

/** Tanggal kurva: yang terbaru dengan cakupan >= (jumlah tenor − allowMissing). */
function chooseAnchor(seriesByCode, codes, allowMissing) {
  const miss = allowMissing == null ? 1 : allowMissing;
  const union = new Set();
  for (const c of codes) for (const r of (seriesByCode[c] || [])) union.add(r.date);
  const dates = Array.from(union).sort().reverse().slice(0, LOOKBACK_DATES);
  if (!dates.length) return null;

  const has = {};
  for (const c of codes) has[c] = new Set((seriesByCode[c] || []).map(r => r.date));
  const cov = new Map(dates.map(d => [d, codes.filter(c => has[c].has(d)).length]));

  const minCov = Math.max(1, codes.length - miss);
  for (const d of dates) {
    if (cov.get(d) >= minCov) return { date: d, coverage: cov.get(d), min_coverage: minCov, fallback: false };
  }
  // Tidak ada tanggal yang cukup lengkap di jendela: pakai cakupan terbaik (tanggal terbaru
  // di antara yang seri), dan tandai `fallback` supaya panel bisa menyebutnya.
  let best = null;
  for (const d of dates) {
    const n = cov.get(d);
    if (!best || n > best.coverage) best = { date: d, coverage: n, min_coverage: minCov, fallback: true };
  }
  return best;
}

/**
 * Rakit kurva dari seri mentah. Fungsi murni (tanpa DB) supaya kasus "tenor tertinggal"
 * bisa diuji tanpa menulis data palsu ke tabel produksi.
 * @param {Object} seriesByCode  { CODE: [{date:'YYYY-MM-DD', close:number, source?:string}] } urut DESC
 * @param {Object} [opts]        { allowMissing?:number, now?:string }
 */
function assembleCurve(seriesByCode, opts) {
  const o = opts || {};
  const codes = TENORS.map(t => t.code);
  const anchor = chooseAnchor(seriesByCode, codes, o.allowMissing);
  if (!anchor) {
    return {
      as_of: null, source: 'investing', tenors: [], slopes: [],
      coverage: { present: 0, total: codes.length }, missing: codes.slice(),
      latest_date: null, is_latest: false, behind: [], available: false,
    };
  }
  const asOf = anchor.date;
  const latestDate = codes.reduce((mx, c) => {
    const d = (seriesByCode[c] && seriesByCode[c].length) ? seriesByCode[c][0].date : null;
    return (d && (!mx || d > mx)) ? d : mx;
  }, null);

  const tenors = TENORS.map(t => {
    const rows = seriesByCode[t.code] || [];
    const idx = rows.findIndex(r => r.date === asOf);
    const ownLatest = rows.length ? rows[0].date : null;
    if (idx < 0) {
      // Tidak ada bar di tanggal kurva: JANGAN pakai bar terdekat. UI wajib menulis "—"
      // dan menyebut `date` (bar terakhir seri ini) di sebelahnya.
      return {
        code: t.code, tenor: t.tenor, months: t.months,
        close: null, date: ownLatest, on_curve: false,
        chg_1d_bp: null, chg_20d_bp: null,
        points: rows.length, own_latest_date: ownLatest,
        source: rows.length ? (rows[0].source || null) : null,
      };
    }
    const cur = rows[idx];
    const prev = rows[idx + 1];
    const back20 = rows[idx + 20];
    return {
      code: t.code, tenor: t.tenor, months: t.months,
      close: isNum(cur.close) ? cur.close : null,
      date: cur.date, on_curve: true,
      // Δ dihitung dari bar SERI ITU SENDIRI (prev/20 bar sebelum tanggal kurva), bukan dari
      // bar tetangga yang tanggalnya berbeda.
      chg_1d_bp: (prev && isNum(prev.close) && isNum(cur.close)) ? r1((cur.close - prev.close) * DENOM) : null,
      chg_20d_bp: (back20 && isNum(back20.close) && isNum(cur.close)) ? r1((cur.close - back20.close) * DENOM) : null,
      points: rows.length, own_latest_date: ownLatest,
      source: cur.source || null,
    };
  });

  const byCode = {};
  for (const t of tenors) byCode[t.code] = t;
  const slopes = SLOPES.map(s => {
    const a = byCode[s.long], b = byCode[s.short];
    const ok = a && b && isNum(a.close) && isNum(b.close);
    const pp = ok ? Math.round((a.close - b.close) * 1000) / 1000 : null;
    return {
      id: s.id, long: s.long, short: s.short,
      long_tenor: a ? a.tenor : null, short_tenor: b ? b.tenor : null,
      pp, bp: ok ? r1((a.close - b.close) * DENOM) : null,
      // inversi = negatif; null = tidak bisa dihitung (bukan "tidak inversi")
      inverted: ok ? (a.close - b.close) < 0 : null,
    };
  });

  const present = tenors.filter(t => t.on_curve).length;
  const missing = tenors.filter(t => !t.on_curve).map(t => t.code);
  // Tenor yang bar terakhirnya lebih baru dari tanggal kurva (tidak ikut tergambar).
  const behind = tenors.filter(t => t.own_latest_date && t.own_latest_date > asOf)
    .map(t => ({ code: t.code, tenor: t.tenor, date: t.own_latest_date }));

  return {
    as_of: asOf,
    source: 'investing',
    tenors,
    slopes,
    coverage: { present, total: codes.length },
    missing,
    latest_date: latestDate,
    is_latest: !!(latestDate && latestDate === asOf),
    anchor_fallback: !!anchor.fallback,
    min_coverage: anchor.min_coverage,
    behind,
    available: present > 1,
  };
}

/** Entry point untuk route: baca DB lalu rakit. */
function buildYieldCurve(db, opts) {
  const o = opts || {};
  const series = readSeries(db, o);
  return assembleCurve(series, o);
}

module.exports = { TENORS, SLOPES, assembleCurve, readSeries, buildYieldCurve, chooseAnchor };
