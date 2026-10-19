#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Uji regresi kanban t_b042b106 — kurva imbal hasil SUN 11 tenor.
//
// Latar: 11 tenor SUN sudah tersimpan di custom_ohlc (investing/<pair_id>) tetapi hanya
// ID10Y yang pernah dibaca route/UI mana pun. Kartu ini menambah /api/idx/yield-curve +
// panel Kurva Imbal Hasil di Market Regime.
//
// Yang diuji:
//  [1] kurva lengkap: 11 titik pada SATU tanggal, slope dihitung dari titik tanggal itu
//      (10Y-3Y, 10Y-1Y, 30Y-10Y), Δ1d/Δ20d dari bar seri tenor itu sendiri.
//  [2] tenor TERTINGGAL (tidak punya bar di tanggal kurva): titik itu close=null +
//      on_curve=false + tanggal bar terakhirnya sendiri — bukan bar terdekat, bukan
//      tanggal tetangga. Ini DoD-2 tanpa menyentuh data produksi.
//  [3] tenor yang bar-nya LEBIH BARU dari yang lain: tanggal kurva tidak boleh jadi
//      kurva 1 titik; kurva mundur ke sesi yang cukup lengkap dan tenor itu masuk `behind`.
//  [4] tenor mati di hulu (5 sesi) tetap di-dash dan tanggalnya disebut, sementara
//      tanggal kurva tetap sesi terbaru (cakupan 10/11 = toleransi 1 tenor).
//  [5] tanda slope: inversi (negatif) harus terbaca `inverted=true`, bukan harga mutlak.
//  [6] tidak ada seri sama sekali -> available=false, tidak melempar.
//  [7] endpoint hidup vs SQL INDEPENDEN: tanggal kurva = tanggal bar terbaru yang dipakai,
//      dan nilai tiap tenor di tanggal itu harus sama dengan query langsung ke custom_ohlc
//      (DoD-3: satu tenor diuji manual — ID10Y + ID3Y, pembentuk slope utama).
//  [8] penjaga sumber panel: anotasi chart 10Y/3Y lewat LABEL tenor (bukan `months`, yang
//      satuannya bulan) + kolom Δ20 disebut "sesi". Cacat review r1 yang dulu lolos. 
//
// Jalankan di dalam container (DB tidak ada di host):
//   docker exec -w /app banyu-langit node server/scripts/check-yield-curve.js
// Env: BL_URL (default http://127.0.0.1:3000 — port di dalam container)
// Exit 0 = lulus, 1 = ada asersi gagal.
// ═══════════════════════════════════════════════════════════════════════════

const Database = require('/app/node_modules/better-sqlite3');
const fs = require('fs');
const yc = require('/app/server/utils/yield-curve');

const BL = process.env.BL_URL || 'http://127.0.0.1:3000';
const db = new Database('/app/data/trading.db', { readonly: true });

const failures = [];
let pass = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// Container ini nodemon + ./server bind-mount: request bisa dijawab "connection reset"
// saat tetangga menyimpan file dan app restart. Retry, jangan simpulkan data hilang.
async function getJson(path, tries = 5) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BL + path);
      return await r.json();
    } catch (e) { lastErr = e; await new Promise(res => setTimeout(res, 1500 + i * 1000)); }
  }
  throw lastErr;
}

// ── pembangun seri sintetis: n sesi tanggal, nilai bebas per tenor ───────────
const DATES = ['2026-10-19', '2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12', '2026-10-09'];
function mkSeries(overrides) {
  const o = overrides || {};
  const out = {};
  for (const t of yc.TENORS) {
    const base = 6 + t.months / 100;           // level naik pelan per tenor
    const rows = DATES.map((d, i) => ({ date: d, close: Math.round((base + i * 0.01) * 1000) / 1000, source: 'investing/test' }));
    out[t.code] = rows;
  }
  if (o.drop) for (const [code, n] of Object.entries(o.drop)) out[code] = out[code].slice(n);
  if (o.only) for (const [code, rows] of Object.entries(o.only)) out[code] = rows;
  if (o.scale) for (const [code, f] of Object.entries(o.scale)) out[code] = out[code].map(r => ({ ...r, close: Math.round(r.close * f * 1000) / 1000 }));
  return out;
}

(async function main() {
  // ── [1] kurva lengkap ────────────────────────────────────────────────────
  console.log('[1] kurva lengkap — satu tanggal, slope dari titik tanggal itu');
  {
    const c = yc.assembleCurve(mkSeries());
    check('as_of = tanggal terbaru', c.as_of === '2026-10-19', c.as_of);
    check('11/11 tenor on_curve', c.coverage.present === 11 && c.coverage.total === 11, JSON.stringify(c.coverage));
    check('tidak ada tenor hilang', c.missing.length === 0, c.missing.join(','));
    check('setiap titik memakai tanggal kurva', c.tenors.every(t => t.on_curve === true && t.date === c.as_of));
    check('own_latest_date tidak lebih baru dari kurva', c.behind.length === 0);
    const s = c.slopes.find(x => x.id === '10Y-3Y');
    const d10 = c.tenors.find(t => t.code === 'ID10Y'), d3 = c.tenors.find(t => t.code === 'ID3Y');
    const expect = Math.round((d10.close - d3.close) * 1000) / 10;
    check('slope 10Y-3Y = (10Y − 3Y) * 100 bp', s.bp === expect, s.bp + ' vs ' + expect);
    check('slope punya pp + tanda inverted', typeof s.pp === 'number' && s.inverted === (s.bp < 0), JSON.stringify(s));
    check('3 slope diminta ada', ['10Y-3Y', '10Y-1Y', '30Y-10Y'].every(id => c.slopes.some(x => x.id === id)));
    const t10 = c.tenors.find(t => t.code === 'ID10Y');
    // Δ1d untuk ID10Y: close hari ini vs i=1 -> seri sintetis naik 0.01/sesi, jadi -1.0 bp
    check('Δ1d sintetis = -1.0 bp (bar sekarang lebih kecil dari bar sebelumnya)', t10.chg_1d_bp === -1, String(t10.chg_1d_bp));
    check('Δ20d null bila histori < 21 bar', t10.chg_20d_bp === null, String(t10.chg_20d_bp));
  }

  // ── [2] tenor tertinggal ─────────────────────────────────────────────────
  console.log('[2] satu tenor tertinggal — titik itu "—", tanggalnya sendiri, tidak mencampur sesi');
  {
    const c = yc.assembleCurve(mkSeries({ drop: { ID25Y: 1 } }));   // ID25Y tanpa bar 19 Okt
    check('tanggal kurva tetap sesi terbaru', c.as_of === '2026-10-19', c.as_of);
    check('cakupan 10/11', c.coverage.present === 10, JSON.stringify(c.coverage));
    check('ID25Y masuk missing', c.missing.indexOf('ID25Y') >= 0, c.missing.join(','));
    const t = c.tenors.find(x => x.code === 'ID25Y');
    check('ID25Y.close = null', t.close === null, String(t.close));
    check('ID25Y.on_curve = false', t.on_curve === false);
    check('ID25Y.date = bar terakhirnya (16 Okt), bukan 19 Okt', t.date === '2026-10-16', t.date);
    check('Δ tidak dikarang dari bar tetangga', t.chg_1d_bp === null && t.chg_20d_bp === null);
    // 25Y tidak dipakai slope mana pun -> ketiga slope harus tetap bisa dihitung.
    check('slope yang tidak memakai 25Y tetap terhitung', c.slopes.every(s => s.bp !== null), JSON.stringify(c.slopes));
    // Kalau yang hilang adalah tenor PEMBENTUK slope (10Y), slope itu wajib null —
    // bukan digeser ke tanggal lain milik 10Y.
    const c2 = yc.assembleCurve(mkSeries({ drop: { ID10Y: 1 } }));
    const bad = c2.slopes.filter(s => s.bp === null).map(s => s.id).sort();
    check('3 slope yang memakai 10Y jadi null', bad.join(',') === '10Y-1Y,10Y-3Y,30Y-10Y', bad.join(','));
  }

  // ── [3] ada tenor yang lebih baru ────────────────────────────────────────
  console.log('[3] satu tenor lebih baru dari yang lain — kurva tidak jadi 1 titik');
  {
    const s = mkSeries();
    s.ID30Y = [{ date: '2026-10-20', close: 7.5, source: 'investing/test' }].concat(s.ID30Y);
    const c = yc.assembleCurve(s);
    check('tanggal kurva = sesi yang cukup lengkap (19 Okt)', c.as_of === '2026-10-19', c.as_of);
    check('kurva tetap 11/11', c.coverage.present === 11, JSON.stringify(c.coverage));
    check('is_latest=false (ada bar lebih baru)', c.is_latest === false);
    check('ID30Y dilaporkan di behind', c.behind.some(b => b.code === 'ID30Y' && b.date === '2026-10-20'), JSON.stringify(c.behind));
  }

  // ── [4] tenor mati di hulu ───────────────────────────────────────────────
  console.log('[4] tenor berhenti 3 sesi di hulu — dash + tanggal, kurva tetap sesi terbaru');
  {
    const c = yc.assembleCurve(mkSeries({ drop: { ID15Y: 3 } }));
    const t = c.tenors.find(x => x.code === 'ID15Y');
    check('tanggal kurva = sesi terbaru (cakupan 10/11 ditoleransi)', c.as_of === '2026-10-19', c.as_of);
    check('ID15Y on_curve=false + tanggal 14 Okt', t.on_curve === false && t.date === '2026-10-14', String(t.date));
    check('10 titik lain tetap di tanggal kurva', c.tenors.filter(x => x.on_curve).every(x => x.date === '2026-10-19'));
  }

  // ── [5] inversi ──────────────────────────────────────────────────────────
  console.log('[5] inversi — slope negatif dipertahankan tandanya');
  {
    const c = yc.assembleCurve(mkSeries({ scale: { ID10Y: 1.5 } }));   // 10Y dinaikkan di atas 30Y
    const s = c.slopes.find(x => x.id === '10Y-3Y');
    const s2 = c.slopes.find(x => x.id === '30Y-10Y');
    check('10Y-3Y positif', s.bp > 0, String(s.bp));
    check('30Y-10Y negatif = inversi', s2.bp < 0 && s2.inverted === true, JSON.stringify(s2));
    check('nilai bp = pp * 100 (tanda ikut)', Math.abs(s2.bp - s2.pp * 100) < 1e-6, s2.bp + ' / ' + s2.pp);
  }

  // ── [6] kosong ───────────────────────────────────────────────────────────
  console.log('[6] tidak ada seri — available=false, tidak melempar');
  {
    const c = yc.assembleCurve({});
    check('as_of null', c.as_of === null);
    check('available=false', c.available === false);
    check('missing = 11 kode', c.missing.length === 11, String(c.missing.length));
  }

  // ── [7] endpoint hidup vs SQL independen ─────────────────────────────────
  console.log('[7] /api/idx/yield-curve vs custom_ohlc (SQL independen)');
  {
    let d = null;
    try { d = await getJson('/api/idx/yield-curve'); } catch (e) { check('endpoint menjawab', false, e.message); }
    if (d) {
      check('tidak ada error', !d.error, d.error);
      check('11 tenor dikirim', Array.isArray(d.tenors) && d.tenors.length === 11);
      check('sumber disebut', d.source === 'investing', d.source);
      check('tanggal kurva ada', typeof d.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.as_of), d.as_of);
      check('semua titik di tanggal kurva ATAU bertanda on_curve=false',
        d.tenors.every(t => t.on_curve === false || t.date === d.as_of));
      // Bar terbaru tiap tenor (kalender sesi reguler) = tanggal kurva pada data sekarang.
      const latest = db.prepare(
        `SELECT MAX(trade_date) d FROM custom_ohlc WHERE code IN
         ('ID1M','ID3M','ID6M','ID1Y','ID3Y','ID5Y','ID10Y','ID15Y','ID20Y','ID25Y','ID30Y')
         AND COALESCE(session,'regular')<>'weekend' AND close>0`).get().d;
      check('tanggal kurva = sesi terbaru seri tenor', d.as_of === latest, d.as_of + ' vs ' + latest);
      for (const code of ['ID10Y', 'ID3Y']) {
        const row = db.prepare("SELECT close FROM custom_ohlc WHERE code=? AND trade_date=?").get(code, d.as_of);
        const t = d.tenors.find(x => x.code === code);
        check(code + ' cocok dengan DB di ' + d.as_of, row && t && row.close === t.close, JSON.stringify({ db: row && row.close, api: t && t.close }));
      }
      const s = (d.slopes || []).find(x => x.id === '10Y-3Y');
      const t10 = d.tenors.find(x => x.code === 'ID10Y'), t3 = d.tenors.find(x => x.code === 'ID3Y');
      const expect = Math.round((t10.close - t3.close) * 1000) / 10;
      check('slope 10Y-3Y di endpoint = hitungan dari dua titik itu', s && s.bp === expect, JSON.stringify(s) + ' vs ' + expect);
      check('slope tidak disimpan sebagai seri baru (tidak ada kode 10Y-3Y/10Y-1Y/30Y-10Y di custom_tickers)',
        db.prepare("SELECT COUNT(*) c FROM custom_tickers WHERE code IN ('10Y-3Y','10Y-1Y','30Y-10Y')").get().c === 0);

      // Kesegaran live (t_4648c065): lag di endpoint harus sama dengan hitungan INDEPENDEN
      // dari kalender sesi, dan ambangnya harus deklarasi yang sudah ada di custom_tickers.
      const railD = db.prepare(`SELECT MAX(trade_date) d FROM custom_ohlc WHERE COALESCE(session,'regular')<>'weekend'`).get().d || '';
      const idxD = db.prepare('SELECT MAX(trade_date) d FROM idx_daily').get().d || '';
      const refD = railD > idxD ? railD : idxD;
      const cal = db.prepare('SELECT DISTINCT trade_date d FROM idx_daily ORDER BY trade_date DESC LIMIT 120').all().map(r => r.d);
      if (refD && cal.indexOf(refD) === -1) cal.push(refD);
      const lagIndep = cal.filter(s => s > d.as_of && s <= refD).length;
      const declLive = db.prepare("SELECT code, expected_lag_sessions e FROM custom_tickers WHERE code=? AND expected_lag_sessions IS NOT NULL").get(d.freshness && d.freshness.threshold_code || 'ID10Y');
      check('endpoint mengirim freshness', !!d.freshness, JSON.stringify(d.freshness));
      check('lag endpoint = hitungan independen dari kalender sesi',
        d.freshness && d.freshness.lag_sessions === lagIndep,
        JSON.stringify({ api: d.freshness && d.freshness.lag_sessions, sql: lagIndep, ref: refD, as_of: d.as_of }));
      check('sesi rujukan endpoint = max(frontier rail, idx_daily)',
        d.freshness && d.freshness.ref_date === refD, JSON.stringify({ api: d.freshness && d.freshness.ref_date, sql: refD }));
      check('ambang = expected_lag_sessions dari custom_tickers (bukan angka baru)',
        d.freshness && declLive && d.freshness.expected_lag_sessions === declLive.e && d.freshness.threshold_code === declLive.code,
        JSON.stringify({ api: d.freshness, db: declLive }));
      check('state konsisten dengan lag vs ambang (fresh bila lag 0)',
        d.freshness && d.freshness.state === (lagIndep === 0 ? 'fresh' : (lagIndep > d.freshness.expected_lag_sessions ? 'excess' : 'by_source')),
        JSON.stringify({ state: d.freshness && d.freshness.state, lag: lagIndep }));
    }
  }

  // ── [8] penjaga sumber UI: anotasi chart + label Δ20 ─────────────────────
  // Dua cacat UI dari review r1 tidak tertangkap harness karena tidak ada asersi UI.
  // Yang dijaga: (a) markPoint memilih tenor lewat LABEL, bukan `months` (10Y=120 bulan,
  // 3Y=36 — kode lama `[10, 3]` menempel di 3M dan 10Y tak pernah dapat anotasi);
  // (b) kolom Δ20 disebut "sesi", bukan "d".
  console.log('[8] sumber panel market-regime.js: anotasi 10Y/3Y + label Δ20 sesi');
  {
    let src = '';
    try { src = fs.readFileSync('/app/public/js/market-regime.js', 'utf8'); }
    catch (e) { check('market-regime.js terbaca', false, e.message); }
    if (src) {
      check('markPoint memilih tenor lewat label [10Y, 3Y]', src.indexOf("data: ['10Y', '3Y'].map") >= 0);
      check('tidak ada lagi seleksi anotasi lewat months', !/months === tenorMonths/.test(src));
      check('tidak ada lagi angka tahun sihir [10, 3]', !/\[10,\s*3\]/.test(src));
      // Buktikan kenapa kode lama salah: tidak ada tenor ber-months 10 di daftar resmi,
      // dan months 3 milik 3M (bukan 3Y).
      check('months 10 tidak ada di TENORS (kode lama tak mungkin cocok 10Y)', !yc.TENORS.some(t => t.months === 10));
      check('months 3 = 3M, bukan 3Y', (yc.TENORS.find(t => t.months === 3) || {}).tenor === '3M');
      check('10Y ber-months 120 dan 3Y ber-months 36', (yc.TENORS.find(t => t.tenor === '10Y') || {}).months === 120
        && (yc.TENORS.find(t => t.tenor === '3Y') || {}).months === 36);
      check('header kolom memakai "Δ20 sesi (bp)"', src.indexOf("'Δ20 sesi (bp)'") >= 0);
      check('label lama "Δ20d (bp)" hilang', src.indexOf("'Δ20d (bp)'") < 0);
      check('tidak ada sisa "Δ20d" di panel', src.indexOf('Δ20d') < 0);
    }
  }

  // ── [9] kesegaran tanggal kurva (kanban t_4648c065) ──────────────────────
  // Cacat yang ditutup: `is_latest` hanya membandingkan tanggal kurva dengan bar terbaru DI DB.
  // Kalau rail berhenti total, semua 11 tenor basi bersamaan -> is_latest tetap true, tanpa
  // penanda. Semua kasus di bawah memakai payload SINTETIS di memori: tidak ada tulisan ke DB.
  console.log('[9] kesegaran kurva — ambang memakai expected_lag_sessions yang sudah ada');
  {
    const rowsBefore = db.prepare('SELECT COUNT(*) c FROM custom_ohlc').get().c;
    const maxBefore = db.prepare('SELECT MAX(trade_date) d FROM custom_ohlc').get().d;

    // Konteks kesegaran tiruan — bentuknya sama dengan buildContext (series-freshness.js).
    function mkFresh(o) {
      const opt = o || {};
      const sessions = (opt.sessions || ['2026-10-19', '2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13']).slice().sort();
      return {
        ref_date: opt.ref_date || sessions[sessions.length - 1],
        ref_source: 'rail+idx_daily',
        sessions,
        expected_lag: opt.expected_lag === undefined
          ? { ID10Y: { expected_lag_sessions: 0, lag_basis: 'declared' } }
          : opt.expected_lag,
        window_from: opt.window_from !== undefined ? opt.window_from : sessions[0],
      };
    }
    const DECL0 = { ID10Y: { expected_lag_sessions: 0, lag_basis: 'declared' } };
    void DECL0;

    // (a) NORMAL: tanggal kurva = sesi rujukan -> lag 0, tidak ada penanda.
    const normal = yc.assembleCurve(mkSeries(), { freshnessCtx: mkFresh() });
    check('normal: freshness terkirim', !!normal.freshness, JSON.stringify(normal.freshness));
    check('normal: state=fresh, lag 0', normal.freshness.state === 'fresh' && normal.freshness.lag_sessions === 0,
      JSON.stringify(normal.freshness));
    check('normal: ambang = expected_lag_sessions ID10Y (0) yang sudah ada',
      normal.freshness.expected_lag_sessions === 0 && normal.freshness.threshold_code === 'ID10Y',
      JSON.stringify(normal.freshness));
    check('normal: is_latest true DAN fresh (dua hal berbeda, dua-duanya benar di sini)',
      normal.is_latest === true && normal.freshness.state === 'fresh');

    // (b) RAIL BERHENTI TOTAL: kurva 2 sesi lebih tua sementara rujukan sudah 19 Okt.
    //     is_latest TETAP true (bar terbaru di DB = tanggal kurva) — inilah cacatnya.
    const STALE_SERIES = mkSeries();
    const staleAsOf = '2026-10-15';
    for (const t of yc.TENORS) STALE_SERIES[t.code] = STALE_SERIES[t.code].filter(r => r.date <= staleAsOf);
    const stale = yc.assembleCurve(STALE_SERIES, { freshnessCtx: mkFresh({ sessions: ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19'] }) });
    check('basi: tanggal kurva 15 Okt', stale.as_of === staleAsOf, stale.as_of);
    check('basi: is_latest tetap true (bar terbaru DB = tanggal kurva) — cacat yang ditutup',
      stale.is_latest === true && stale.latest_date === staleAsOf, stale.is_latest + ' / ' + stale.latest_date);
    check('basi: state=excess', stale.freshness.state === 'excess', JSON.stringify(stale.freshness));
    check('basi: lag_sessions = 2 (16 & 19 Okt dihitung, 15 Okt tidak)', stale.freshness.lag_sessions === 2,
      String(stale.freshness.lag_sessions));
    check('basi: excess_sessions = 2 di atas ambang 0', stale.freshness.excess_sessions === 2,
      String(stale.freshness.excess_sessions));
    check('basi: sesi rujukan dilaporkan (bukan angka tanpa rujukan)', stale.freshness.ref_date === '2026-10-19',
      String(stale.freshness.ref_date));

    // (c) Masih di dalam kebiasaan sumber: expected 2, lag 2 -> 'by_source', BUKAN basi.
    const slowSeries = mkSeries();
    for (const t of yc.TENORS) slowSeries[t.code] = slowSeries[t.code].filter(r => r.date <= '2026-10-15');
    const slow = yc.assembleCurve(slowSeries, { freshnessCtx: mkFresh({
      sessions: ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19'],
      expected_lag: { ID10Y: { expected_lag_sessions: 2, lag_basis: 'declared' } },
    }) });
    check('by_source: lag 2 dengan ambang 2 tidak dituduh basi', slow.freshness.state === 'by_source',
      JSON.stringify(slow.freshness));

    // (d) Tanpa deklarasi: tidak ada dasar menuduh -> 'na', tanpa angka lag palsu.
    const undecl = yc.assembleCurve(slowSeries, { freshnessCtx: mkFresh({
      sessions: ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19'], expected_lag: {},
    }) });
    check('na: tanpa expected_lag_sessions -> state na, lag null',
      undecl.freshness.state === 'na' && undecl.freshness.lag_sessions === null, JSON.stringify(undecl.freshness));
    // 'na' harus BISA DIBEDAKAN dari 'fresh' oleh pembaca panel (kanban t_063a1800): angka lag
    // tetap null (tidak ada dasar mengukur), tapi sebab dan sesi rujukannya harus terbaca.
    check('na: declared_codes kosong + threshold_code null (tidak ada dasar ambang)',
      undecl.freshness.declared_codes.length === 0 && undecl.freshness.threshold_code === null,
      JSON.stringify(undecl.freshness));
    check('na: ref_date tetap dilaporkan walau lag tidak diukur',
      undecl.freshness.ref_date === '2026-10-19', String(undecl.freshness.ref_date));
    check('na: idem bila ctx tidak dikirim (freshness null, bukan "segar")',
      yc.assembleCurve(slowSeries).freshness === null);
    // (d2) Konteks ada tapi ref_date hilang (kalender gagal dibangun): juga 'na', BUKAN 'fresh'.
    const noRef = yc.assembleCurve(slowSeries, { freshnessCtx: {
      ref_date: null, ref_source: null, sessions: [],
      expected_lag: { ID10Y: { expected_lag_sessions: 0, lag_basis: 'declared' } },
    } });
    check("na: ctx tanpa ref_date -> 'na' (jangan terbaca segar karena lag 0)",
      noRef.freshness.state === 'na' && noRef.freshness.lag_sessions === null, JSON.stringify(noRef.freshness));

    // (e) Ambang PALING KETAT yang menang di antara tenor yang dideklarasikan.
    const two = yc.assembleCurve(slowSeries, { freshnessCtx: mkFresh({
      sessions: ['2026-10-15', '2026-10-16', '2026-10-19'],
      expected_lag: { ID10Y: { expected_lag_sessions: 2, lag_basis: 'declared' }, ID3Y: { expected_lag_sessions: 0, lag_basis: 'declared' } },
    }) });
    check('dua deklarasi: ambang ketat (0) dipakai, threshold_code=ID3Y',
      two.freshness.expected_lag_sessions === 0 && two.freshness.threshold_code === 'ID3Y',
      JSON.stringify(two.freshness));
    check('dua deklarasi: lag 2 -> excess 2', two.freshness.state === 'excess' && two.freshness.excess_sessions === 2,
      JSON.stringify(two.freshness));

    // (f) Lag lebih tua dari jendela kalender: lag cuma batas bawah -> lag_capped.
    const capped = yc.assembleCurve(slowSeries, { freshnessCtx: mkFresh({
      sessions: ['2026-10-16', '2026-10-19'], window_from: '2026-10-16',
    }) });
    check('lag_capped=true bila bar lebih tua dari jendela kalender', capped.freshness.lag_capped === true,
      JSON.stringify(capped.freshness));

    // (g) Jalur baca tetap murni: tidak ada tulisan ke DB selama seluruh uji di atas.
    const rowsAfter = db.prepare('SELECT COUNT(*) c FROM custom_ohlc').get().c;
    const maxAfter = db.prepare('SELECT MAX(trade_date) d FROM custom_ohlc').get().d;
    check('custom_ohlc tidak berubah (payload sintetis tidak ditulis ke DB)', rowsBefore === rowsAfter && maxBefore === maxAfter,
      rowsBefore + '->' + rowsAfter + ' / ' + maxBefore + '->' + maxAfter);

    // (h) Penjaga sumber: util tidak menulis & tidak menarik data dari sumber.
    let ycSrc = '';
    try { ycSrc = fs.readFileSync('/app/server/utils/yield-curve.js', 'utf8'); } catch (e) { check('yield-curve.js terbaca', false, e.message); }
    if (ycSrc) {
      check('yield-curve.js tidak menulis DB (tanpa INSERT/UPDATE/DELETE)',
        !/INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+custom_ohlc/i.test(ycSrc));
      check('yield-curve.js tidak fetch ke sumber di jalur baca',
        !/\bfetch\s*\(|require\(['"](axios|node-fetch)/.test(ycSrc));
      check('yield-curve.js memakai util kesegaran yang sudah ada',
        ycSrc.indexOf("require('./series-freshness')") >= 0);
    }
    let mrSrc = '';
    try { mrSrc = fs.readFileSync('/app/public/js/market-regime.js', 'utf8'); } catch (e) { check('market-regime.js terbaca', false, e.message); }
    if (mrSrc) {
      check('panel punya badge basi (id mr-curve-stale + jumlah sesi)',
        mrSrc.indexOf('id="mr-curve-stale"') >= 0 || mrSrc.indexOf("id=\\'mr-curve-stale\\'") >= 0);
      check('panel menyebut ambang expected_lag_sessions', mrSrc.indexOf('expected_lag_sessions') >= 0);
      check('panel membedakan by_source dari excess', mrSrc.indexOf("state === 'by_source'") >= 0);
      // Keadaan 'na' (kanban t_063a1800): dulu panel DIAM, sehingga "tidak diukur" tak bisa
      // dibedakan dari "segar". Sekarang harus ada catatan netralnya sendiri.
      const naAt = mrSrc.indexOf('mr-curve-untracked');
      const naSpan = naAt < 0 ? '' : mrSrc.slice(naAt, mrSrc.indexOf('</span>', naAt) + 7);
      check("panel punya catatan sendiri untuk state 'na' (#mr-curve-untracked)", naAt >= 0, String(naAt));
      check("catatan 'na': data-state=na + teks 'tidak diukur' (panel tidak diam lagi)",
        /data-state="na"/.test(naSpan) && /naTxt/.test(naSpan) && mrSrc.indexOf('tidak diukur') >= 0, naSpan);
      check("catatan 'na' netral var(--t3), BUKAN merah/amber",
        /var\(--t3\)/.test(naSpan) && !/var\(--rd\)/.test(naSpan) && !/var\(--am\)/.test(naSpan), naSpan);
      check("catatan 'na' juga muncul bila freshness tidak terkirim (!fr)",
        /!\s*fr\s*\|\|\s*fr\.state === 'na'/.test(mrSrc));
      // Keadaan 2 (semua frontier beku -> lag 0 -> 'fresh'): sengaja TIDAK ditutup di util kurva.
      // Kuncinya komentar alasannya, supaya tidak "hilang" tanpa jejak di ronde berikutnya.
      check('keadaan 2 (semua frontier beku) didokumentasikan di curveFreshness, bukan didiamkan',
        /SEMUA frontier beku/.test(ycSrc) && ycSrc.indexOf('t_063a1800') >= 0);
    }
  }

  console.log('');
  if (failures.length) {
    console.log('GAGAL ' + failures.length + ' / ' + (pass + failures.length) + ' asersi');
    failures.forEach(f => console.log('  - ' + f));
    db.close();
    process.exit(1);
  }
  console.log('LULUS ' + pass + ' asersi');
  db.close();
})();
