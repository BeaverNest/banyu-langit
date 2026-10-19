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
//  4. `is_latest` TIDAK cukup (t_4648c065): ia hanya bilang "tidak ada bar lebih baru di DB".
//     Kalau rail berhenti total, kurva ikut tua tanpa satu pun penanda. `freshness` mengukur
//     umur tanggal kurva dengan aturan seri lain (series-freshness.js) — lihat curveFreshness().

const freshnessUtil = require('./series-freshness');

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
 * Kesegaran TANGGAL KURVA (kanban t_4648c065).
 *
 * `is_latest` hanya bilang "tidak ada bar yang lebih baru di DB". Kalau rail berhenti total,
 * SEMUA 11 tenor basi bersamaan, `latest_date` ikut basi, `is_latest` tetap true, dan pembaca
 * tidak dapat sinyal apa pun selain tanggal. Jadi umur sesi kurva dibandingkan dengan aturan
 * yang SUDAH ADA untuk seri lain — tidak ada definisi kesegaran baru di sini:
 *
 *   ref_date    = max(frontier rail custom_ohlc sesi reguler, MAX(idx_daily))
 *                 (series-freshness.buildContext)
 *   lag_sesi    = jumlah sesi kalender IDX dengan as_of < sesi <= ref_date
 *                 (series-freshness.seriesFreshness)
 *   ambang      = expected_lag_sessions PER SERI di custom_tickers
 *                 (deklarasi manual: scripts/seed_expected_lag.js)
 *   basi        = lag_sesi > ambang  (MIN_EXCESS_SESSIONS = 1 di series-freshness)
 *
 * Aturan tambahan khusus kurva, dan alasannya: dipakai ambang PALING KETAT di antara tenor yang
 * PUNYA deklarasi. Kurva tidak boleh terbaca lebih tua dari kebiasaan sumber tenor mana pun yang
 * sudah kita deklarasikan; memakai yang paling longgar akan menenggelamkan alarm. Tenor tanpa
 * deklarasi (expected NULL -> state 'na') tidak boleh menghidupkan alarm, persis seperti seri
 * lain; bila TIDAK ADA tenor yang dideklarasikan, kurva juga 'na' dan hanya tanggalnya yang
 * ditampilkan (jangan menuduh basi tanpa dasar).
 *
 * Fungsi ini murni: `ctx` = keluaran buildContext (atau tiruannya di harness), tidak menyentuh DB.
 *
 * Keadaan "pipeline data berhenti" (dulu ditulis TIDAK DITANGANI di sini, kartu t_063a1800)
 * SUDAH ditangani di tingkat sistem sejak kanban t_c6c01360: kalau SEMUA frontier beku —
 * pipeline mati total, bukan hanya rail investing — `ref_date` ikut beku dan `lag_sesi` dulu
 * terbaca 0. Sekarang `buildContext` membawa `ctx.pipeline` (jam dinding WIB vs kalender sesi
 * terdeklarasi `server/data/idx-sessions.json`) dan `seriesFreshness` menurunkan setiap seri ke
 * state 'na' + `lag_sessions:null` + `lag_basis:'pipeline_stopped'|'calendar_stale'` saat itu
 * terjadi. Karena curveFreshness() memilih tenor lewat seriesFreshness(), kurva ikut turun ke
 * 'na' dengan lag_basis yang sama — panel TIDAK boleh lagi menulis "tenor belum dideklarasikan"
 * untuk keadaan ini. JANGAN menambal ambang lokal di sini: satu implementasi untuk semua surface
 * ada di server/utils/series-freshness.js.
 *
 * @param {object|null} ctx   konteks kesegaran {ref_date, ref_source, sessions, expected_lag, ...}
 * @param {string|null} asOf  tanggal kurva (YYYY-MM-DD)
 * @param {string[]} codes    kode tenor yang membentuk kurva
 * @returns {{state:string, lag_sessions:number|null, expected_lag_sessions:number|null,
 *   excess_sessions:number|null, lag_basis:string|null, lag_capped:boolean,
 *   ref_date:string|null, ref_source:string|null, threshold_code:string|null,
 *   declared_codes:string[]}}
 */
function curveFreshness(ctx, asOf, codes) {
  const base = {
    state: 'na',
    lag_sessions: null,
    expected_lag_sessions: null,
    excess_sessions: null,
    lag_basis: null,
    lag_capped: false,
    ref_date: (ctx && ctx.ref_date) || null,
    ref_source: (ctx && ctx.ref_source) || null,
    threshold_code: null,
    declared_codes: [],
  };
  if (!ctx || !ctx.ref_date || !asOf) return base;

  const declared = [];
  for (const code of (codes || [])) {
    const f = freshnessUtil.seriesFreshness(ctx, asOf, code);
    if (f.expected_lag_sessions != null) declared.push({ code, f });
  }
  if (!declared.length) return base;
  // Stabil: expected terkecil menang; seri tanpa deklarasi sudah dibuang di atas.
  declared.sort((a, b) => a.f.expected_lag_sessions - b.f.expected_lag_sessions);
  const pick = declared[0];
  return {
    state: pick.f.state,
    lag_sessions: pick.f.lag_sessions,
    expected_lag_sessions: pick.f.expected_lag_sessions,
    excess_sessions: pick.f.excess_sessions,
    lag_basis: pick.f.lag_basis,
    lag_capped: !!pick.f.lag_capped,
    ref_date: pick.f.ref_date,
    ref_source: (ctx && ctx.ref_source) || null,
    threshold_code: pick.code,
    declared_codes: declared.map(d => d.code),
  };
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
      freshness: null,
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

  // Kesegaran tanggal kurva: hanya bila pemanggil mengirim konteks kesegaran (route selalu
  // mengirim; harness boleh tidak, dan `null` berarti "tidak diukur", bukan "segar").
  const freshness = o.freshnessCtx ? curveFreshness(o.freshnessCtx, asOf, codes) : null;

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
    freshness,
    available: present > 1,
  };
}

/**
 * Entry point untuk route: baca DB lalu rakit.
 *
 * Konteks kesegaran dibangun SEKALI di sini (3 query: dua frontier + kalender sesi) supaya
 * panel bisa membandingkan umur tanggal kurva dengan sesi rujukan yang sama seperti seri lain.
 * Jalur baca tetap murni: tidak ada retry/fetch ke sumber, tidak ada tulis ke DB
 * (DoD kartu t_4648c065 butir 3).
 */
function buildYieldCurve(db, opts) {
  const o = opts || {};
  const series = readSeries(db, o);
  let freshnessCtx = o.freshnessCtx || null;
  if (!freshnessCtx) {
    try { freshnessCtx = freshnessUtil.buildContext(db); }
    catch (e) { freshnessCtx = null; }   // tanpa kalender -> state 'na', kurva tetap dikirim
  }
  return assembleCurve(series, Object.assign({}, o, { freshnessCtx }));
}

module.exports = { TENORS, SLOPES, assembleCurve, readSeries, buildYieldCurve, chooseAnchor, curveFreshness };
