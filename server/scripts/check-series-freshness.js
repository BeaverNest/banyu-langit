#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Uji regresi kanban t_61ccbdbe — kesegaran per seri komoditas.
//
// Latar: investing berhenti menerbitkan bar timah (TIN / pin 959209) di 2026-10-15
// sementara NICKEL 959208 (rail & jam tarik sama) sudah 2026-10-19. Panel komoditas
// menampilkan level bar lama tanpa tanggal -> pembaca menyimpulkan instrumennya datar.
//
// Yang diuji:
//  [1] aritmetika lag di kalender sesi (sintetis, deterministik — tanpa DB):
//      sesi terakhir = lag 0; 1 sesi di belakang = basi; 2 sesi = basi;
//      jendela kalender dilampaui -> lag_capped=true (lag hanya batas bawah);
//      seri tanpa bar -> stale=null (dibedakan dari basi oleh no_series).
//  [2] penanda TIDAK menempel: dengan last_date = ref_date, seri yang sama berhenti
//      basi. Ini bukti DoD-3 tanpa perlu menunggu TIN terbit kembali.
//  [3] live DB vs endpoint: /api/commodities[].commodity dan
//      /api/idx/market-regime[].commodities harus membawa stale/lag_sessions/ref_date,
//      dan lag-nya harus sama dengan hitungan SQL INDEPENDEN
//      (COUNT(DISTINCT trade_date) idx_daily dalam (last_date, ref_date]).
//  [4] harga seri basi TIDAK dihapus dari JSON (chart/rail masih butuh), tapi
//      divergence yang membandingkannya dengan sesi saham hari ini harus null.
//  [5] surface KETIGA: /api/market/overview (rework pasca-review t_b36a83b4). Baris
//      komoditas di Market Overview harus membawa stale/stale_date/lag_sessions/ref_date
//      yang sama dengan hitungan SQL independen — pembaca tab default tidak boleh melihat
//      level TIN 15 Okt sebagai harga terkini. Sekaligus mengunci CAKUPAN yang disengaja:
//      baris non-komoditas (SPX/US10Y/BI_RATE…) TIDAK membawa field kesegaran, karena
//      kalender sesi di sini = sesi IDX dan seri pasar luar memang tertinggal satu sesi
//      pada Senin (penutupan Jumat) — menandainya basi = positif palsu.
//      Asersi di sini sengaja TIDAK mengunci tanggal: begitu TIN terbit lagi, hijau.
//  [6] surface KEEMPAT: /api/idx/stock-detail/<code>.commodity_context (rework ronde 3,
//      review sena t_b36a83b4). Tab Analysis menampilkan level komoditas emiten tanpa
//      tanggal; field kesegaran + tanggal wajib ikut, dan untuk seri basi levelnya tetap
//      dikirim (hitungan lain memakainya) sementara UI menulis "—" + tanggal.
//  [7] ekspektasi lag PER SERI (kanban t_e821ac7e, kontrak t_b234606a): mesin keadaan
//      sintetis 5 keadaan, pemeriksaan lintas surface, dan asersi anti-perbaikan-palsu
//      (TIN expected 0 & menyala, CPO expected 2 & tidak menyala pada hari yang sama).
//      Nomor [7] dipakai karena [6] sudah terisi stock-detail — jangan menimpa [6].
//  [8] penjaga DIVERGENSI (koreksi review t_fb5135a3 pada kartu yang sama): divergensi
//      komoditas-vs-saham hanya sah bila barnya dari SESI RUJUKAN. Dua sisi yang harus
//      dikunci bersamaan: grup 'by_source' (COAL/CPO/RUBBER/STEEL_HRC — lag = kebiasaan
//      sumbernya, stale false) WAJIB tetap tertahan, sedangkan seri 'na' yang barnya justru
//      di sesi rujukan (KRAFT_PULP) WAJIB tetap menerbitkan angkanya. Nomor [8] dipakai
//      karena [6]/[7] sudah terisi — jangan menimpa salah satunya.
//  [10] kalender sesi TERDEKLARASI + sinyal "pipeline data berhenti" (kanban t_c6c01360,
//      keputusan t_243d21ae §D2/§D3/§D5). Yang dikunci: (1) kalender ↔ 60 sesi terakhir
//      idx_daily DUA ARAH, (2) jumlah libur per tahun 15-30, (3) valid_through >= hari ini+45
//      (peringatan, bukan gagal), (4) lima kasus §D5 dengan `now` DISUNTIKKAN, (5) kontrak
//      degradasi 'na' untuk stopped/calendar_stale — termasuk bukti bahwa seri yang sekarang
//      'fresh' turun ke na/pipeline_stopped saat `now` disuntik, TANPA menulis DB.
//      Catatan: saat pipeline degraded, asersi lag/stale per-seri di [3]-[8] otomatis dialihkan
//      ke kontrak degradasi (bukan dilewati) — lihat `degraded`/`naOk` di awal blok live.
//
// Jalankan di dalam container (DB tidak ada di host):
//   docker exec -w /app banyu-langit node server/scripts/check-series-freshness.js
// Env: BL_URL (default http://127.0.0.1:3000 — port di dalam container)
// Exit 0 = lulus, 1 = ada asersi gagal.
// ═══════════════════════════════════════════════════════════════════════════

const Database = require('/app/node_modules/better-sqlite3');
const fresh = require('/app/server/utils/series-freshness');
const pullLog = require('/app/server/utils/pull-log');

const BL = process.env.BL_URL || 'http://127.0.0.1:3000';
const db = new Database('/app/data/trading.db', { readonly: true });

const failures = [];
let pass = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// Retry: container ini nodemon + ./server bind-mount, jadi request bisa dijawab
// "connection reset" saat tetangga menyimpan file dan app restart.
async function getJson(path, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BL + path);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      lastErr = e;
      await new Promise(res => setTimeout(res, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

// Berkas statis yang DISAJIKAN (bukan working tree): untuk membuktikan UI yang dilayani container
// sudah memuat perubahan, bukan hanya berkas di host.
async function getText(path, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BL + path);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      lastErr = e;
      await new Promise(res => setTimeout(res, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

function main() {
  // ── [1] aritmetika lag, sintetis ────────────────────────────────────────
  console.log('\n[1] seriesFreshness — kalender sesi sintetis');
  // Senin 12 Okt .. Senin 19 Okt (Sabtu/Minggu bukan sesi).
  const sessions = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19'];
  // expected_lag sintetis: TIN dideklarasikan 0 (harus menyala saat lag 1-2), CPO 2
  // (sumber memang tidak menerbitkan bar Jumat). Keduanya sengaja dibawa ke sini supaya
  // [1]/[2] tetap menguji ARITMETIKA, bukan nilai deklarasi yang ada di DB.
  const ctx = {
    ref_date: '2026-10-19', ref_source: 'test', sessions, window_from: sessions[0],
    expected_lag: {
      TIN: { expected_lag_sessions: 0, lag_basis: 'declared' },
      CPO: { expected_lag_sessions: 2, lag_basis: 'declared' },
    },
  };

  const f0 = fresh.seriesFreshness(ctx, '2026-10-19', 'TIN');
  check('last = sesi terakhir -> lag 0, tidak basi', f0.lag_sessions === 0 && f0.stale === false, JSON.stringify(f0));

  const f1 = fresh.seriesFreshness(ctx, '2026-10-16', 'TIN');
  check('last = 1 sesi di belakang -> lag 1, BASI', f1.lag_sessions === 1 && f1.stale === true, JSON.stringify(f1));

  const f2 = fresh.seriesFreshness(ctx, '2026-10-15', 'TIN');
  check('last = 2 sesi di belakang (TIN) -> lag 2, BASI', f2.lag_sessions === 2 && f2.stale === true, JSON.stringify(f2));
  check('TIN: ref_date ikut dikirim untuk ditulis di UI', f2.ref_date === '2026-10-19', String(f2.ref_date));

  const fx = fresh.seriesFreshness(ctx, '2026-08-01', 'TIN');
  check('last di luar jendela kalender -> lag_capped=true (bukan lag palsu yang kecil)', fx.lag_capped === true && fx.lag_sessions === sessions.length, JSON.stringify(fx));

  const fn = fresh.seriesFreshness(ctx, null, 'TIN');
  check('tanpa bar -> stale=null (no_series, bukan basi)', fn.stale === null && fn.lag_sessions === null, JSON.stringify(fn));

  const noCtx = fresh.seriesFreshness(null, '2026-10-15', 'TIN');
  check('tanpa konteks (kalender kosong) -> stale=null, tidak menebak', noCtx.stale === null, JSON.stringify(noCtx));

  // Bar Sabtu/Minggu bukan sesi: tanggal bar yang dipakai aturan harus sesi terakhir.
  const weekendRows = [
    { trade_date: '2026-10-18', close: 1 },   // Minggu (bar weekend)
    { trade_date: '2026-10-16', close: 2 },
    { trade_date: '2026-10-15', close: 3 },
  ];
  check('lastRegularBarDate melewati bar Minggu', fresh.lastRegularBarDate(weekendRows) === '2026-10-16',
    String(fresh.lastRegularBarDate(weekendRows)));
  check('lastRegularBarDate: semua weekend -> pakai yang ada (tidak mengarang)',
    fresh.lastRegularBarDate([{ trade_date: '2026-10-18' }]) === '2026-10-18',
    String(fresh.lastRegularBarDate([{ trade_date: '2026-10-18' }])));
  check('lastRegularBarDate: daftar kosong -> null', fresh.lastRegularBarDate([]) === null, String(fresh.lastRegularBarDate([])));
  check('seri ber-bar Minggu tidak jadi "basi" palsu: 16 Okt vs sesi 19 Okt = lag 1',
    fresh.seriesFreshness(ctx, fresh.lastRegularBarDate(weekendRows), 'TIN').lag_sessions === 1,
    JSON.stringify(fresh.seriesFreshness(ctx, fresh.lastRegularBarDate(weekendRows), 'TIN')));

  // ── [2] penanda tidak menempel ──────────────────────────────────────────
  console.log('\n[2] penanda hilang sendiri saat bar seri datang (= DoD-3)');
  const ctxLater = { ref_date: '2026-10-20', ref_source: 'test', sessions: sessions.concat(['2026-10-20']), window_from: sessions[0], expected_lag: ctx.expected_lag };
  const before = fresh.seriesFreshness(ctxLater, '2026-10-15', 'TIN');
  const after = fresh.seriesFreshness(ctxLater, '2026-10-20', 'TIN'); // TIN akhirnya terbit
  check('sebelum terbit: 15 Okt vs sesi 20 Okt -> masih basi', before.stale === true && before.lag_sessions === 3, JSON.stringify(before));
  check('setelah bar 20 Okt masuk -> stale=false tanpa intervensi', after.stale === false && after.lag_sessions === 0, JSON.stringify(after));

  // ── [3] live DB vs endpoint ─────────────────────────────────────────────
  console.log('\n[3] endpoint live vs hitungan SQL independen');
  const railMax = (db.prepare(`SELECT MAX(trade_date) d FROM custom_ohlc WHERE ${fresh.REGULAR_SESSION}`).get() || {}).d || '';
  const idxMax = (db.prepare('SELECT MAX(trade_date) d FROM idx_daily').get() || {}).d || '';
  const ref = railMax > idxMax ? railMax : idxMax;
  const lagSql = db.prepare('SELECT COUNT(DISTINCT trade_date) c FROM idx_daily WHERE trade_date > ? AND trade_date <= ?');
  const lastSql = db.prepare(`SELECT MAX(trade_date) d FROM custom_ohlc WHERE code=? AND ${fresh.REGULAR_SESSION}`);
  // Ekspektasi per seri dibaca lewat SQL SENDIRI (bukan dari modul yang diuji) — kalau
  // dibaca dari ctx yang dibangun util, asersinya cuma mengulang implementasinya.
  const expSql = db.prepare('SELECT expected_lag_sessions e, lag_basis b FROM custom_tickers WHERE code=?');
  const expectedOf = code => { const r = expSql.get(code); return !r || r.e == null ? null : Number(r.e); };
  const basisOf = code => { const r = expSql.get(code); return r ? (r.b || null) : null; };
  // stale == lag MELEBIHI ekspektasi seri itu. expected NULL (na) / lag NULL (no_series)
  // -> stale null (tidak pernah alarm) — bukan false, itu keadaan yang berbeda.
  const staleOk = (code, lag, stale) => {
    const e = expectedOf(code);
    if (e == null || lag == null) return stale === null;
    return stale === (Number(lag) > e);
  };

  return Promise.all([
    getJson('/api/commodities'),
    getJson('/api/idx/market-regime'),
    getJson('/api/market/overview'),
    getJson('/api/idx/stock-detail/TINS'),
    getJson('/api/idx/stock-detail/ANTM'),
  ]).then(async ([cmd, mr, ov, sdTins, sdAntm]) => {
    // ── Keadaan pipeline (kanban t_c6c01360) ──────────────────────────────
    // Saat pipeline 'stopped'/'calendar_stale' server SENGAJA berhenti mengukur lag (state 'na',
    // lag null, stale false). Asersi di bawah yang membandingkan lag/stale dengan SQL — yang tetap
    // mengukur terhadap `ref_date` BEKU — memang tidak berlaku saat itu, jadi dialihkan ke kontrak
    // degradasi. Tidak ada asersi yang dilewati diam-diam: kondisinya diganti, bukan dimatikan.
    const pipeNow = fresh.buildContext(db).pipeline;
    const degraded = !!(pipeNow && (pipeNow.state === 'stopped' || pipeNow.state === 'calendar_stale'));
    if (degraded) {
      console.log('\n[i] CATATAN: pipeline DEGRADASI (' + pipeNow.state + ', elapsed=' + pipeNow.elapsed_sessions + ')');
      console.log('    Asersi lag/stale per-seri dialihkan ke kontrak degradasi: state na, lag null, stale false.');
    }
    const naOk = (s) => !!s && s.state === 'na' && s.lag_sessions === null && s.stale === false;
    check('ref_date endpoint = max(frontier rail, idx_daily)', cmd.freshness && cmd.freshness.ref_date === ref,
      `endpoint=${cmd.freshness && cmd.freshness.ref_date} sql=${ref} rail=${railMax} idx=${idxMax}`);

    const cmdSeries = (cmd.commodities || []).map(g => g.commodity).filter(Boolean);
    const mrSeries = mr.commodities || [];
    check('panel komoditas mengirim seri ber-harga', cmdSeries.length > 0, String(cmdSeries.length));
    check('market-regime mengirim seri komoditas', mrSeries.length > 0, String(mrSeries.length));
    check('setiap seri membawa stale_date (tanggal yang dipakai gerbang, bar sesi terakhir)',
      cmdSeries.concat(mrSeries).every(s => s.stale_date === s.date || (s.stale_date && s.date)),
      JSON.stringify(cmdSeries.concat(mrSeries).filter(s => !s.stale_date).map(s => s.code)));

    let mismatched = [];
    for (const s of cmdSeries.concat(mrSeries)) {
      if (degraded) {
        // Kontrak degradasi: tidak ada angka lag, tidak ada tuduhan basi, sebabnya disebut.
        if (!naOk(s)) mismatched.push(`${s.code}: degraded tapi state=${s.state} lag=${s.lag_sessions} stale=${s.stale}`);
        else if (s.expected_lag_sessions != null && s.lag_basis !== 'pipeline_stopped' && s.lag_basis !== 'calendar_stale') {
          mismatched.push(`${s.code}: degraded tapi lag_basis=${s.lag_basis}`);
        }
        continue;
      }
      // 'na' (lag_basis='na', expected_lag_sessions NULL) = tidak pernah alarm: stale-nya
      // memang null walau bar-nya ada. Itu keadaan tersendiri, bukan "lupa menandai" —
      // memberi stale true/false pada seri na justru pelanggaran (kanban t_b234606a).
      if (s.expected_lag_sessions == null) {
        if (s.state !== 'na' || s.stale !== null) mismatched.push(`${s.code}: expected NULL tapi state=${s.state} stale=${s.stale}`);
        continue;
      }
      if (s.stale == null) { mismatched.push(`${s.code}: stale null padahal ada bar (${s.date})`); continue; }
      const expectLast = (lastSql.get(s.code) || {}).d || '';
      const expectLag = (lagSql.get(s.date, ref) || {}).c;
      if (String(s.date) !== String(expectLast)) mismatched.push(`${s.code}: date ${s.date} != DB ${expectLast}`);
      if (Number(s.lag_sessions) !== Number(expectLag)) mismatched.push(`${s.code}: lag ${s.lag_sessions} != SQL ${expectLag}`);
      if (Boolean(s.stale) !== (Number(expectLag) > expectedOf(s.code))) mismatched.push(`${s.code}: stale ${s.stale} tidak konsisten dengan lag ${expectLag} > expected ${expectedOf(s.code)}`);
    }
    check('setiap seri: date + lag_sessions + stale konsisten dengan DB (seri na: stale null)', mismatched.length === 0, mismatched.join(' | '));

    // Bukti per-seri (bukan ambang global): dua seri di rail yang sama bisa berbeda hasil.
    // Asersinya TIDAK mengunci tanggal pengamatan — kalau TIN akhirnya terbit (DoD-3),
    // test ini tetap hijau karena yang diuji hubungan stale==(lag>ekspektasi), bukan "TIN basi selamanya".
    const byCode = {};
    for (const s of cmdSeries.concat(mrSeries)) byCode[s.code] = s;
    const tin = byCode['TIN'], nickel = byCode['NICKEL'], coal = byCode['COAL'];
    const lagOf = s => Number((lagSql.get(s.date, ref) || {}).c);
    check('TIN: stale == (lag DB > ekspektasi seri), tanpa tanggal yang di-hardcode',
      degraded ? naOk(tin) : (!!tin && Boolean(tin.stale) === (lagOf(tin) > expectedOf('TIN'))), JSON.stringify(tin || null));
    check('NICKEL (rail & jam tarik sama) segar: lag 0, stale false',
      !!nickel && nickel.stale === false && lagOf(nickel) === 0, JSON.stringify(nickel || null));
    check('COAL: stale == (lag DB > ekspektasi seri)',
      degraded ? naOk(coal) : (!!coal && Boolean(coal.stale) === (lagOf(coal) > expectedOf('COAL'))), JSON.stringify(coal || null));
    check('per seri, bukan ambang global: TIN dan NICKEL bisa berbeda hasil pada satu tarikan',
      !!tin && !!nickel && (Number(tin.lag_sessions) !== Number(nickel.lag_sessions)
        || (tin.stale === false && nickel.stale === false)),
      `TIN lag=${tin && tin.lag_sessions} NICKEL lag=${nickel && nickel.lag_sessions}`);
    check('seri basi tetap mengirim level (chart/rail masih memakainya)',
      !!tin && typeof tin.close === 'number' && tin.close > 0 || !!tin && typeof tin.price === 'number' && tin.price > 0,
      JSON.stringify(tin || null));

    // ── [4] divergensi tidak diterbitkan dari seri basi ───────────────────
    console.log('\n[4] divergence: hanya dari dua seri pada sesi yang sama');
    const staleGroups = (cmd.commodities || []).filter(g => g.commodity && g.commodity.stale);
    const bad = staleGroups.filter(g => g.divergence != null);
    check('semua grup ber-komoditas basi -> divergence null', bad.length === 0, bad.map(g => g.id + '=' + g.divergence).join(','));
    check('grup ber-komoditas basi menyebut alasannya', staleGroups.every(g => g.divergence_reason === 'commodity_stale'),
      staleGroups.map(g => g.id + ':' + g.divergence_reason).join(','));
    const freshGroups = (cmd.commodities || []).filter(g => g.commodity && !g.commodity.stale);
    check('grup dengan komoditas segar tetap punya divergence',
      freshGroups.length > 0 && freshGroups.some(g => g.divergence != null),
      freshGroups.map(g => g.id + '=' + g.divergence).join(','));

    // ── [5] Market Overview: surface ketiga ──────────────────────────────
    console.log('\n[5] /api/market/overview — baris komoditas bertanda, sisanya tidak');
    const ovSections = ov.sections || [];
    const ovComm = (ovSections.find(s => s.id === 'commodities') || {}).items || [];
    const ovOther = ovSections.filter(s => s.id !== 'commodities')
      .reduce((acc, s) => acc.concat(s.items || []), []);
    check('overview: bagian komoditas mengirim item', ovComm.length > 0, String(ovComm.length));
    check('overview: setiap item komoditas membawa field kesegaran lengkap',
      ovComm.length > 0 && ovComm.every(i => 'stale' in i && 'stale_date' in i && 'lag_sessions' in i && 'ref_date' in i),
      JSON.stringify(ovComm.filter(i => !('stale' in i)).map(i => i.code)));

    const ovMismatch = [];
    for (const i of ovComm) {
      const expectLast = (lastSql.get(i.code) || {}).d || '';
      const expectLag = Number((lagSql.get(expectLast, ref) || {}).c);
      // Tanggal bar tetap wajib jujur walau pipeline degraded; yang dialihkan hanya lag/stale.
      if (String(i.stale_date) !== String(expectLast)) ovMismatch.push(`${i.code}: stale_date ${i.stale_date} != DB ${expectLast}`);
      if (degraded) {
        if (!naOk(i)) ovMismatch.push(`${i.code}: degraded tapi lag=${i.lag_sessions} stale=${i.stale} state=${i.state}`);
        continue;
      }
      if (Number(i.lag_sessions) !== expectLag) ovMismatch.push(`${i.code}: lag ${i.lag_sessions} != SQL ${expectLag}`);
      if (Boolean(i.stale) !== (expectLag > expectedOf(i.code))) ovMismatch.push(`${i.code}: stale ${i.stale} vs lag ${expectLag} > expected ${expectedOf(i.code)}`);
    }
    check('overview: stale/stale_date/lag tiap item = hitungan SQL independen', ovMismatch.length === 0, ovMismatch.join(' | '));

    check('overview: baris NON-komoditas tidak membawa field kesegaran (cakupan disengaja)',
      ovOther.length > 0 && ovOther.every(i => !('stale' in i)),
      ovOther.filter(i => 'stale' in i).map(i => i.code).join(','));

    const ovStale = ov.freshness && ov.freshness.stale_codes;
    check('overview: ringkasan freshness menyebut cakupannya', ov.freshness && ov.freshness.scope === 'commodities',
      JSON.stringify(ov.freshness || null));
    check('overview: stale_codes == daftar item komoditas yang stale',
      Array.isArray(ovStale) && ovStale.join(',') === ovComm.filter(i => i.stale).map(i => i.code).sort().join(','),
      `endpoint=${JSON.stringify(ovStale)} items=${JSON.stringify(ovComm.filter(i => i.stale).map(i => i.code))}`);
    check('overview: ref_date sama dengan dua panel lain (satu aturan, bukan disalin)',
      !!ov.freshness && ov.freshness.ref_date === ref && ov.freshness.ref_date === (cmd.freshness && cmd.freshness.ref_date),
      `overview=${ov.freshness && ov.freshness.ref_date} cmd=${cmd.freshness && cmd.freshness.ref_date} sql=${ref}`);

    // Dua surface harus sepakat untuk seri yang sama: overview tidak boleh lebih longgar
    // maupun lebih ketat. Yang dibandingkan hanya kode yang ADA di kedua surface —
    // WTI/ALUMINIUM hanya tampil di overview (tidak punya kartu grup), jadi tidak
    // bisa "berbeda pendapat" dengan panel komoditas.
    const cmdStaleSet = new Set((cmd.freshness && cmd.freshness.stale_codes) || []);
    const ovStaleSet = new Set(ovStale || []);
    const cmdCodes = new Set(cmdSeries.map(s => s.code));
    const ovCmpSet = new Set(ovComm.filter(i => cmdCodes.has(i.code)).map(i => i.code));
    const disagree = [];
    for (const code of ovStaleSet) if (ovCmpSet.has(code) && !cmdStaleSet.has(code)) disagree.push(code + ' basi di overview tapi tidak di /api/commodities');
    for (const code of cmdStaleSet) if (ovCmpSet.has(code) && !ovStaleSet.has(code)) disagree.push(code + ' basi di /api/commodities tapi tidak di overview');
    check('overview & panel komoditas tidak berbeda pendapat soal seri yang sama',
      ovCmpSet.size > 0 && disagree.length === 0,
      `irisan=${ovCmpSet.size} beda=${disagree.join(', ') || '-'}`);

    // ── [6] Stock detail → Analysis: commodity_context ikut bertanda ──────
    // Rekor ronde 3 (review sena t_b36a83b4): `commodity_context` dulu mengirim
    // {price, chg_5d, chg_20d} tanpa `date`/`stale` untuk TINS → level bar 15 Okt
    // terbaca sebagai harga hari ini di tab Analysis. Asersi di sini TIDAK mengunci
    // tanggal: yang diuji hubungan stale == (lag DB >= ambang) terhadap SQL independen.
    console.log('\n[6] /api/idx/stock-detail — commodity_context bertanda basi per seri');
    const sdOf = d => (d && d.commodity_context) || null;
    const tins = sdOf(sdTins), antm = sdOf(sdAntm);
    check('TINS: commodity_context ada (emiten ber-komoditas)', !!tins, JSON.stringify(Object.keys(sdTins || {}).slice(0, 6)));
    check('TINS: commodity_context membawa date + field kesegaran lengkap',
      !!tins && 'date' in tins && 'stale' in tins && 'stale_date' in tins && 'lag_sessions' in tins && 'ref_date' in tins,
      JSON.stringify(tins || null));
    if (tins) {
      const expectLast = (lastSql.get(tins.code) || {}).d || '';
      const expectLag = Number((lagSql.get(expectLast, ref) || {}).c);
      check('TINS: date & stale_date = MAX(custom_ohlc sesi reguler) dari DB, bukan tanggal karangan',
        String(tins.date) === String(expectLast) && String(tins.stale_date) === String(expectLast),
        `endpoint date=${tins.date} stale_date=${tins.stale_date} sql=${expectLast}`);
      check('TINS: lag_sessions = COUNT(DISTINCT sesi) SQL independen', degraded ? naOk(tins) : Number(tins.lag_sessions) === expectLag,
        `endpoint=${tins.lag_sessions} sql=${expectLag}`);
      check('TINS: stale == (lag DB > ekspektasi seri)', degraded ? (tins.stale === false && tins.lag_basis === 'pipeline_stopped') : Boolean(tins.stale) === (expectLag > expectedOf(tins.code)),
        `stale=${tins.stale} lag=${expectLag} expected=${expectedOf(tins.code)}`);
      check('TINS: level bar lama tetap dikirim (chart/hitungan lain memakainya)',
        typeof tins.price === 'number' && tins.price > 0, JSON.stringify(tins && tins.price));
      check('TINS: ref_date sama dengan panel lain (satu aturan)',
        tins.ref_date === ref && tins.ref_date === (cmd.freshness && cmd.freshness.ref_date),
        `sd=${tins.ref_date} cmd=${cmd.freshness && cmd.freshness.ref_date} sql=${ref}`);
      // Dua surface tidak boleh berbeda pendapat untuk seri yang sama.
      const cmdSame = cmdSeries.find(s => s.code === tins.code);
      check('TINS: stock-detail & /api/commodities sepakat soal status basi seri yang sama',
        !cmdSame || Boolean(cmdSame.stale) === Boolean(tins.stale),
        `sd stale=${tins.stale} cmd stale=${cmdSame && cmdSame.stale}`);
    }
    check('ANTM (seri nikel yang jalan): stale false, lag 0 — penanda tidak menular ke seri segar',
      !!antm && antm.stale === false && Number(antm.lag_sessions) === 0,
      JSON.stringify(antm || null));

    // ── [7] ekspektasi lag PER SERI (t_e821ac7e, kontrak t_b234606a) ──────
    // [6] sudah dipakai stock-detail; bagian ini sengaja bernomor [7].
    console.log('\n[7] expected_lag_sessions per seri — alarm hanya saat lag MELEBIHI kebiasaan sumber');

    // (a) mesin keadaan, sintetis & deterministik (tanpa DB)
    const ectx = {
      ref_date: '2026-10-19', ref_source: 'test',
      sessions: ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19'],
      window_from: '2026-10-13',
      expected_lag: {
        Z0: { expected_lag_sessions: 0, lag_basis: 'declared' },
        Z2: { expected_lag_sessions: 2, lag_basis: 'declared' },
        NADE: { expected_lag_sessions: null, lag_basis: 'na' },
      },
    };
    const sf = (date, code) => fresh.seriesFreshness(ectx, date, code);
    const sEx = sf('2026-10-15', 'Z0');        // lag 2 (15 -> 16, 19), expected 0
    check('sintetis: expected 0 / lag 2 -> excess_sessions 2, state excess, stale TRUE',
      sEx.lag_sessions === 2 && sEx.excess_sessions === 2 && sEx.state === 'excess' && sEx.stale === true, JSON.stringify(sEx));
    const sBy = sf('2026-10-15', 'Z2');        // lag 2, expected 2
    check('sintetis: expected 2 / lag 2 -> state by_source, stale FALSE (masih dalam kebiasaan sumber)',
      sBy.lag_sessions === 2 && sBy.excess_sessions === 0 && sBy.state === 'by_source' && sBy.stale === false, JSON.stringify(sBy));
    const sNa = sf('2026-10-15', 'NADE');
    check('sintetis: expected NULL -> state na, stale null (tidak pernah alarm)',
      sNa.state === 'na' && sNa.stale === null && sNa.expected_lag_sessions === null, JSON.stringify(sNa));
    const sFr = sf('2026-10-19', 'Z2');
    check('sintetis: lag 0 -> state fresh, stale false', sFr.state === 'fresh' && sFr.stale === false, JSON.stringify(sFr));
    const sEx1 = sf('2026-10-14', 'Z2');       // lag 3 (14 -> 15, 16, 19), expected 2
    check('sintetis: expected 2 / lag 3 -> excess_sessions 1, state excess, stale TRUE',
      sEx1.lag_sessions === 3 && sEx1.excess_sessions === 1 && sEx1.state === 'excess' && sEx1.stale === true, JSON.stringify(sEx1));
    const sUnknown = sf('2026-10-15', 'TIDAK_ADA');
    check('sintetis: kode tanpa deklarasi -> state na (bukan fresh), stale null',
      sUnknown.state === 'na' && sUnknown.stale === null, JSON.stringify(sUnknown));
    const sNoCode = fresh.seriesFreshness(ectx, '2026-10-15');
    check('pemanggil lupa `code` -> state na, BUKAN fresh (seri tak dikenal tidak boleh terbaca segar)',
      sNoCode.state === 'na' && sNoCode.stale === null, JSON.stringify(sNoCode));
    check('konstanta: MIN_EXCESS_SESSIONS 1 + alias STALE_LAG_SESSIONS (ambang global TIDAK dinaikkan ke 2)',
      fresh.MIN_EXCESS_SESSIONS === 1 && fresh.STALE_LAG_SESSIONS === fresh.MIN_EXCESS_SESSIONS,
      `MIN_EXCESS=${fresh.MIN_EXCESS_SESSIONS} alias=${fresh.STALE_LAG_SESSIONS}`);
    check('ringkasan: alias threshold_sessions masih dikirim, dengan arti baru (kelebihan minimum)',
      cmd.freshness.threshold_sessions === 1 && cmd.freshness.min_excess_sessions === 1
        && cmd.freshness.min_excess_alias === 'threshold_sessions', JSON.stringify(cmd.freshness));

    // (b) live vs SQL independen: expected per seri, excess, dan hubungan stale == (lag > expected)
    const allComm = cmdSeries.concat(mrSeries).concat(ovComm);
    const noExp = allComm.filter(s => !('expected_lag_sessions' in s)).map(s => s.code);
    check('live: SETIAP entri komoditas membawa expected_lag_sessions (drift deklarasi terlihat tanpa alarm)',
      allComm.length > 0 && noExp.length === 0, JSON.stringify(noExp));
    const expBad = [];
    for (const s of allComm) {
      const e = expectedOf(s.code);
      const got = s.expected_lag_sessions == null ? null : Number(s.expected_lag_sessions);
      if (got !== e) expBad.push(`${s.code}: expected ${got} != DB ${e}`);
      if (degraded ? !naOk(s) : !staleOk(s.code, s.lag_sessions, s.stale)) expBad.push(`${s.code}: stale ${s.stale} vs lag ${s.lag_sessions} & expected ${e}`);
      if (e != null && s.lag_sessions != null && Number(s.excess_sessions) !== Number(s.lag_sessions) - e) expBad.push(`${s.code}: excess ${s.excess_sessions} != lag-expected`);
    }
    check('live: (expected, excess, stale) tiap seri = hitungan SQL independen terhadap custom_tickers', expBad.length === 0, expBad.join(' | '));

    // (c) cakupan deklarasi
    const und = [];
    for (const [name, fr] of [['/api/commodities', cmd.freshness], ['/api/idx/market-regime', mr.commodity_freshness], ['/api/market/overview', ov.freshness]]) {
      const u = (fr && fr.undeclared_codes) || [];
      if (u.length) und.push(name + ': ' + u.join(','));
    }
    check('live: undeclared_codes kosong di tiga surface (tidak ada seri komoditas yang belum diputuskan)', und.length === 0, und.join(' | '));
    const naBad = allComm.filter(s => s.state === 'na' && !(degraded
      ? (s.lag_basis === 'pipeline_stopped' || s.lag_basis === 'calendar_stale')
      : basisOf(s.code) === 'na')).map(s => s.code);
    check('live: state na hanya untuk seri yang lag_basis-nya memang na (sisanya ' + 'fresh/by_source/excess)',
      naBad.length === 0, JSON.stringify(naBad));

    // (d) anti-perbaikan-palsu: asersi ini GAGAL kalau ada yang "menyelesaikan" kartu ini
    //     dengan menaikkan ambang global ke 2 (TIN lag 2 -> tidak menyala, CPO ikut menyala).
    //     Saat pipeline degraded, kontraknya berbeda: TIDAK ada yang menyala, deklarasinya tetap.
    check('anti-perbaikan-palsu: TIN expected 0 & stale TRUE, CPO expected 2 & stale FALSE pada hari yang sama',
      degraded
        ? (!!tin && tin.expected_lag_sessions === 0 && naOk(tin)
            && !!byCode['CPO'] && Number(byCode['CPO'].expected_lag_sessions) === 2 && naOk(byCode['CPO']))
        : (!!tin && Number(tin.expected_lag_sessions) === 0 && tin.stale === true
            && !!byCode['CPO'] && Number(byCode['CPO'].expected_lag_sessions) === 2 && byCode['CPO'].stale === false),
      `TIN exp=${tin && tin.expected_lag_sessions} stale=${tin && tin.stale} | CPO exp=${byCode['CPO'] && byCode['CPO'].expected_lag_sessions} stale=${byCode['CPO'] && byCode['CPO'].stale}`);

    // (e) satu implementasi, bukan tiga salinan: kode di >=2 surface wajib sepakat.
    const perCode = {};
    const addSurface = (s) => {
      perCode[s.code] = perCode[s.code] || [];
      perCode[s.code].push([s.lag_sessions, s.expected_lag_sessions == null ? null : Number(s.expected_lag_sessions), s.excess_sessions, s.state]);
    };
    cmdSeries.forEach(addSurface); mrSeries.forEach(addSurface); ovComm.forEach(addSurface);
    const crossBad = [];
    for (const code of Object.keys(perCode)) {
      const arr = perCode[code];
      if (arr.length < 2) continue;
      const sig = JSON.stringify(arr[0]);
      if (!arr.every(a => JSON.stringify(a) === sig)) crossBad.push(code + ' ' + JSON.stringify(arr));
    }
    const multi = Object.keys(perCode).filter(c => perCode[c].length >= 2);
    check('lintas surface: (lag, expected, excess, state) identik untuk seri yang muncul di >=2 surface',
      multi.length > 0 && crossBad.length === 0, `irisan=${multi.length} beda=${crossBad.join(' | ') || '-'}`);


    // ── [8] divergensi hanya dari bar SESI RUJUKAN (koreksi review t_fb5135a3) ─────
    // Ronde review menemukan penjaga `lag_sessions === 0` (a) menolak seri 'na' yang barnya
    // justru se-sesi — KRAFT_PULP: bar & tape 2026-10-19, chg_1d −0.71 vs avg −4.06, angka
    // +3.35 pp hilang dengan alasan 'insufficient' — dan (b) tidak dijaga apa pun untuk grup
    // 'by_source', padahal sejak ambang jadi per-seri merekalah yang berhenti 'stale'
    // sementara barnya tetap dari sesi lain. Keduanya dikunci di sini.
    console.log('\n[8] divergensi: bar wajib dari sesi rujukan (by_source tertahan, na se-sesi terbit)');

    // (a) fungsi penjaganya sendiri, sintetis, tanpa DB
    const sm = fresh.isSameSessionBar;
    check('sintetis: lag 0 -> se-sesi',
      sm({ ref_date: '2026-10-19', lag_sessions: 0, stale_date: '2026-10-19' }) === true);
    check('sintetis: lag 1 (grup by_source) -> BUKAN se-sesi, walau stale false',
      sm({ ref_date: '2026-10-19', lag_sessions: 1, stale_date: '2026-10-16', stale: false }) === false);
    check('sintetis: state na tapi bar sesi-reguler == rujukan -> se-sesi (kasus KRAFT_PULP)',
      sm({ ref_date: '2026-10-19', lag_sessions: null, stale_date: '2026-10-19', stale: null }) === true);
    check('sintetis: state na & bar lebih tua -> BUKAN se-sesi',
      sm({ ref_date: '2026-10-19', lag_sessions: null, stale_date: '2026-10-16', stale: null }) === false);
    check('sintetis: tanpa rujukan / tanpa komoditas -> false (tidak menebak, tidak crash)',
      sm({ ref_date: null, lag_sessions: null, stale_date: '2026-10-19' }) === false && sm(null) === false && sm({}) === false);
    // `date` bisa bar Sabtu/Minggu: yang menentukan sesi adalah stale_date, bukan date.
    check('sintetis: bar weekend terakhir (date < ref) tapi bar sesinya se-sesi -> tetap se-sesi',
      sm({ ref_date: '2026-10-19', lag_sessions: null, date: '2026-10-18', stale_date: '2026-10-19', stale: null }) === true);

    // (b) live: per grup komoditas, terbit/tidaknya angka = kontrak yang disepakati dengan
    //     reviewer (dinyatakan dari field yang terlihat di payload, bukan salinan kode).
    const divGroups = (cmd.commodities || []).filter(g => g.commodity);
    const divBad = [];
    for (const g of divGroups) {
      const c = g.commodity;
      const same = fresh.isSameSessionBar(c);
      const can = same && c.chg_1d != null && g.avg_chg != null;
      if (can && g.divergence == null) divBad.push(g.id + ': se-sesi + angka lengkap tapi divergence null (' + g.divergence_reason + ')');
      if (!can && g.divergence != null) divBad.push(g.id + ': divergence ' + g.divergence + ' padahal sesi/angka tidak sah');
      if (g.divergence != null && Math.abs(g.divergence - Math.round((c.chg_1d - g.avg_chg) * 100) / 100) > 1e-9) divBad.push(g.id + ': nilai ' + g.divergence + ' != chg_1d - avg_chg');
      const wantReason = g.divergence != null ? null
        : (c.ref_date && c.state !== 'no_series' && !same ? 'commodity_stale' : 'insufficient');
      if (g.divergence_reason !== wantReason) divBad.push(g.id + ': alasan ' + g.divergence_reason + ' != ' + wantReason);
    }
    check('live: tiap grup komoditas sesuai kontrak (angka, nilainya, dan alasan bercerita sama)',
      divGroups.length > 0 && divBad.length === 0, divBad.join(' | '));
    const noCmdGroups = (cmd.commodities || []).filter(g => !g.commodity);
    check('live: grup tanpa seri komoditas tetap null + insufficient (tidak ikut berubah)',
      noCmdGroups.every(g => g.divergence == null && g.divergence_reason === 'insufficient'),
      noCmdGroups.map(g => g.id + ':' + g.divergence + '/' + g.divergence_reason).join(','));

    // (c) dua sisi yang dikunci bersamaan
    const bySourceGroups = divGroups.filter(g => g.commodity.state === 'by_source');
    const offSessionGroups = divGroups.filter(g => !fresh.isSameSessionBar(g.commodity));
    check('live: grup by_source (stale false sejak ambang per-seri) tetap tertahan -> divergence null + commodity_stale',
      degraded
        // Degradasi tidak menyisakan kelompok 'by_source' (semua 'na'); yang setara: grup yang barnya
        // BUKAN dari sesi rujukan tetap tertahan, walau status kesegarannya 'na'.
        ? (offSessionGroups.length > 0 && offSessionGroups.every(g => g.divergence == null && g.divergence_reason === 'commodity_stale'))
        : (bySourceGroups.length > 0 && bySourceGroups.every(g => g.divergence == null && g.divergence_reason === 'commodity_stale')),
      (degraded ? offSessionGroups : bySourceGroups).map(g => g.id + ':' + g.divergence + '/' + g.divergence_reason).join(','));
    const naSameGroups = divGroups.filter(g => g.commodity.state === 'na' && fresh.isSameSessionBar(g.commodity));
    check('live: seri na yang barnya di sesi rujukan tetap menerbitkan divergensi (kasus KRAFT_PULP)',
      naSameGroups.every(g => g.divergence != null && g.divergence_reason === null),
      naSameGroups.map(g => g.id + ':' + g.divergence + '/' + g.divergence_reason).join(',') || 'tidak ada grup na se-sesi');
    check('live: cakupan (c) terisi — tanpa grup na se-sesi, asersi di atas kosong & revert diam-diam lolos',
      naSameGroups.length > 0, divGroups.map(g => g.id + ':' + g.commodity.state).join(','));

    // (d) tidak ada jalur kedua yang menerbitkan divergensi tanpa penjaga yang sama
    const strayDiv = [];
    for (const pair of [['/api/idx/market-regime', mr], ['/api/market/overview', ov]]) {
      if (JSON.stringify(pair[1]).indexOf('"divergence"') !== -1) strayDiv.push(pair[0]);
    }
    check('live: hanya /api/commodities yang menerbitkan `divergence` (tidak ada surface kedua yang tak dijaga)',
      strayDiv.length === 0, strayDiv.join(','));

    // ── [9] telemetri tarikan: pull_behind vs source_stalled (kanban t_57252454) ─────
    // Yang dikunci: (a) frontier beku N HARI TARIK sukses = sumber berhenti (satuannya HARI,
    // dedupe per tanggal WIB — burst/retry dalam satu hari bukan bukti sumber berhenti;
    // kanban t_be770638), (a2) riwayat hari tarik < ambang -> `stall_evaluable=false` DAN kode
    // itu terbit di `stall_unevaluable_codes` (belum bisa dinilai != sumber sehat), (b) satu tarikan
    // HILANG (error) tidak boleh menghitung sebagai tarikan sukses, (c) lag kita sendiri
    // (last_date < frontier) dipisahkan dari lag sumber, (d) ambang snapshot 7 bukan 3,
    // (e) ringkasan panel menerbitkan keduanya tanpa mengubah aturan stale/excess,
    // (f) angka p50/p95 dihitung dari frontier + ref_date yang TERSIMPAN saat tarik.
    console.log('\n[9] telemetri tarikan — frontier sumber per tarikan (pull_behind / source_stalled)');

    // (a) DB tiruan: pullContext hanya memakai 2 query (HARI TARIK terakhir per kode +
    // custom_tickers), jadi perilakunya bisa diuji tanpa menulis satu baris pun ke DB asli.
    // `dayWib` di sini SENGAJA ditulis ulang (bukan impor dari util) supaya asersi tidak ikut
    // salah kalau batas hari di util berubah tanpa sengaja.
    const dayWib = (ts) => {
      const s = String(ts || '');
      const ms = Date.parse(/Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z');
      return new Date(ms + 7 * 3600000).toISOString().slice(0, 10);   // WIB = UTC+7
    };
    const mockDb = (pullRows, tickers) => ({
      prepare(sql) {
        const s = String(sql);
        if (s.indexOf('custom_pull_log') !== -1) {
          return {
            all: (n) => {
              // Tiru jendela SQL: `pull_day_rank <= n`, yaitu n TANGGAL WIB terakhir per kode
              // (semua baris pada tanggal itu ikut), bukan n baris.
              const by = {}, out = [];
              for (const r of pullRows.slice().sort((x, y) => y.id - x.id)) (by[r.code] = by[r.code] || []).push(r);
              for (const k of Object.keys(by)) {
                const keep = new Set();
                for (const r of by[k]) {
                  const d = dayWib(r.pulled_at);
                  if (!keep.has(d)) {
                    if (keep.size >= (n || pullLog.SCAN_PULL_DAYS)) continue;
                    keep.add(d);
                  }
                }
                for (const r of by[k]) if (keep.has(dayWib(r.pulled_at))) out.push(r);
              }
              return out;
            },
          };
        }
        if (s.indexOf('custom_tickers') !== -1) {
          return { all: () => Object.keys(tickers || {}).map(c => ({ code: c, last_date: tickers[c] })) };
        }
        throw new Error('mockDb: SQL tak dikenal: ' + s.slice(0, 60));
      },
    });
    const pr = (code, id, at, frontier, status, source) => ({
      id, code, source: source || 'investing/959209', pulled_at: at,
      ref_date: '2026-10-19', source_frontier_date: frontier, status: status || 'ok', rows: 1, written: 1,
    });

    const frozen3 = [pr('ZZF', 1, '2026-10-17T10:00:00Z', '2026-10-15'),
                     pr('ZZF', 2, '2026-10-18T10:00:00Z', '2026-10-15'),
                     pr('ZZF', 3, '2026-10-19T10:00:00Z', '2026-10-15')];
    const pFrozen = pullLog.pullContext(mockDb(frozen3, { ZZF: '2026-10-15' })).by_code.ZZF;
    check('sintetis: frontier beku 3 tarikan sukses -> source_stalled TRUE (ambang rail sesi = 3)',
      pFrozen.source_stalled === true && pFrozen.frontier_frozen_pulls === 3 && pFrozen.stall_threshold === 3,
      JSON.stringify(pFrozen));

    // satu tarikan HILANG (error) di antara tiga: hanya 2 tarikan sukses -> belum stalled.
    const withHole = [pr('ZZH', 1, '2026-10-17T10:00:00Z', '2026-10-15'),
                      pr('ZZH', 2, '2026-10-18T10:00:00Z', null, 'error'),
                      pr('ZZH', 3, '2026-10-19T10:00:00Z', '2026-10-15')];
    const pHole = pullLog.pullContext(mockDb(withHole, { ZZH: '2026-10-15' })).by_code.ZZH;
    check('sintetis: satu tarikan HILANG (error) -> TIDAK stalled (2 tarikan sukses < 3)',
      pHole.source_stalled === false && pHole.frontier_frozen_pulls === 2 && pHole.last_status === 'ok',
      JSON.stringify(pHole));

    const advancing = [pr('ZZA', 1, '2026-10-15T10:00:00Z', '2026-10-14'),
                       pr('ZZA', 2, '2026-10-16T10:00:00Z', '2026-10-15'),
                       pr('ZZA', 3, '2026-10-19T10:00:00Z', '2026-10-16')];
    const pAdv = pullLog.pullContext(mockDb(advancing, { ZZA: '2026-10-16' })).by_code.ZZA;
    check('sintetis: frontier MAJU tiap tarikan -> tidak stalled (frozen_pulls 1)',
      pAdv.source_stalled === false && pAdv.frontier_frozen_pulls === 1, JSON.stringify(pAdv));

    // rail snapshot: ritmenya beda -> ambang 7, jadi 3 tarikan beku BUKAN temuan.
    const snap3 = [pr('ZZS', 1, '2026-10-17T10:00:00Z', '2026-10-16', 'ok', 'tradingeconomics/snapshot'),
                   pr('ZZS', 2, '2026-10-18T10:00:00Z', '2026-10-16', 'ok', 'tradingeconomics/snapshot'),
                   pr('ZZS', 3, '2026-10-19T10:00:00Z', '2026-10-16', 'ok', 'tradingeconomics/snapshot')];
    const pSnap3 = pullLog.pullContext(mockDb(snap3, { ZZS: '2026-10-16' })).by_code.ZZS;
    check('sintetis: rail snapshot (tradingeconomics/snapshot) 3 tarikan beku -> BELUM stalled (ambang 7)',
      pSnap3.source_stalled === false && pSnap3.stall_threshold === 7 && pSnap3.frontier_frozen_pulls === 3,
      JSON.stringify(pSnap3));
    const snap7 = [];
    for (let i = 1; i <= 7; i++) snap7.push(pr('ZZS', i, '2026-10-1' + i + 'T10:00:00Z', '2026-10-16', 'ok', 'tradingeconomics/snapshot'));
    const pSnap7 = pullLog.pullContext(mockDb(snap7, { ZZS: '2026-10-16' })).by_code.ZZS;
    check('sintetis: rail snapshot 7 tarikan beku -> source_stalled TRUE',
      pSnap7.source_stalled === true && pSnap7.frontier_frozen_pulls === 7, JSON.stringify(pSnap7));

    // jendela pindai terbatas (SCAN_PULL_DAYS hari tarik): deret beku yang lebih panjang dari
    // jendela dilaporkan sebagai BATAS BAWAH + frozen_capped, bukan angka palsu yang terpotong.
    const longFreeze = [];
    for (let i = 1; i <= 9; i++) longFreeze.push(pr('ZZW', i, '2026-10-0' + i + 'T10:00:00Z', '2026-10-01'));
    const pLong = pullLog.pullContext(mockDb(longFreeze, { ZZW: '2026-10-01' })).by_code.ZZW;
    check('sintetis: deret beku lebih panjang dari jendela -> frozen = SCAN_PULL_DAYS + frozen_capped true (batas bawah jujur)',
      pLong.frontier_frozen_pulls === pullLog.SCAN_PULL_DAYS && pLong.frozen_capped === true && pLong.source_stalled === true,
      JSON.stringify(pLong));

    // ── SATUAN DERET = HARI TARIK (kanban t_be770638, temuan R6 sena) ──────────────────
    // Pengunci perilaku baru: burst/retry dalam satu hari TIDAK boleh menuduh sumber sehat,
    // sementara sumber yang benar-benar beku lintas hari HARUS tetap menyala.
    const burstOneDay = [];
    for (let i = 1; i <= 10; i++) {
      burstOneDay.push(pr('ZZQ', i, '2026-10-19T02:40:' + String(40 + i).padStart(2, '0') + 'Z', '2026-10-15'));
    }
    const pBurst = pullLog.pullContext(mockDb(burstOneDay, { ZZQ: '2026-10-15' })).by_code.ZZQ;
    check('sintetis: 10 tarikan dalam <1 menit (SATU hari tarik) frontier sama -> frozen 1, TIDAK stalled',
      pBurst.frontier_frozen_pulls === 1 && pBurst.source_stalled === false
        && pBurst.frozen_pull_days === 1 && pBurst.ok_pulls_scanned === 10 && pBurst.frozen_unit === 'pull_day',
      JSON.stringify(pBurst));

    // burst di hari yang sama TIDAK menambah deret: 1 hari beku kemarin + 10 baris hari ini
    // dengan frontier sama = 2 HARI beku (bukan 11), jadi masih di bawah ambang rail 3.
    const burstPlusYesterday = burstOneDay.slice();
    burstPlusYesterday.push(pr('ZZQ', 11, '2026-10-18T12:40:00Z', '2026-10-15'));
    const pBurst2 = pullLog.pullContext(mockDb(burstPlusYesterday, { ZZQ: '2026-10-15' })).by_code.ZZQ;
    check('sintetis: burst 10 baris hari ini + 1 hari beku kemarin -> frozen 2 (bukan 11), belum stalled',
      pBurst2.frontier_frozen_pulls === 2 && pBurst2.source_stalled === false && pBurst2.frozen_pull_days === 2,
      JSON.stringify(pBurst2));

    // dan pengunci arah sebaliknya: 3 hari tarik BERBEDA dengan frontier sama = STALL.
    const threeDays = [pr('ZZD', 1, '2026-10-17T12:40:00Z', '2026-10-15'),
                       pr('ZZD', 2, '2026-10-18T12:40:00Z', '2026-10-15'),
                       pr('ZZD', 3, '2026-10-19T12:40:00Z', '2026-10-15')];
    const pThree = pullLog.pullContext(mockDb(threeDays, { ZZD: '2026-10-15' })).by_code.ZZD;
    check('sintetis: 3 tarikan pada 3 HARI TARIK berbeda, frontier sama -> source_stalled TRUE (pengunci)',
      pThree.source_stalled === true && pThree.frontier_frozen_pulls === 3 && pThree.stall_threshold === 3,
      JSON.stringify(pThree));

    // jebakan terukur (COAL 20 Okt): baris TERBARU satu hari adalah `no_data`. Dedupe per hari
    // tidak boleh menghapus frontier `ok` — pull_behind/frontier harus tetap terbaca.
    const noDataLatest = [pr('ZZN', 1, '2026-10-18T12:40:00Z', '2026-10-16'),
                          pr('ZZN', 2, '2026-10-19T12:40:00Z', '2026-10-16'),
                          pr('ZZN', 3, '2026-10-20T04:38:00Z', null, 'no_data')];
    const pNoData = pullLog.pullContext(mockDb(noDataLatest, { ZZN: '2026-10-15' })).by_code.ZZN;
    check('sintetis: baris terbaru `no_data` TIDAK menghapus frontier ok -> frontier 2026-10-16, frozen 2, last_status no_data',
      pNoData.last_frontier_date === '2026-10-16' && pNoData.frontier_frozen_pulls === 2
        && pNoData.pull_behind === true && pNoData.last_status === 'no_data',
      JSON.stringify(pNoData));

    // batas hari = WIB (bukan UTC): 19:40 WIB 19 Okt (12:40Z) dan 02:41 WIB 20 Okt (19:41Z 19 Okt)
    // adalah DUA hari tarik walau tanggal UTC-nya sama.
    const wibBoundary = [pr('ZZT', 1, '2026-10-19T12:40:00Z', '2026-10-15'),
                         pr('ZZT', 2, '2026-10-19T19:41:00Z', '2026-10-15')];
    const pWib = pullLog.pullContext(mockDb(wibBoundary, { ZZT: '2026-10-15' })).by_code.ZZT;
    check('sintetis: batas hari tarik = WIB (19:40 WIB & 02:41 WIB besoknya = 2 hari, bukan 1)',
      pullLog.pullDayOf('2026-10-19T12:40:00Z') === '2026-10-19'
        && pullLog.pullDayOf('2026-10-19T19:41:00Z') === '2026-10-20'
        && pWib.frozen_pull_days === 2 && pWib.frontier_frozen_pulls === 2,
      JSON.stringify({ d1: pullLog.pullDayOf('2026-10-19T12:40:00Z'), d2: pullLog.pullDayOf('2026-10-19T19:41:00Z'), p: pWib }));

    // jendela per-hari: burst satu hari tidak boleh menghabiskan jendela sampai hari
    // sebelumnya (yang punya baris ok pembanding) hilang dari pindaian.
    const manyRowsOneDay = [];
    for (let i = 1; i <= 20; i++) manyRowsOneDay.push(pr('ZZM', 100 + i, '2026-10-19T02:4' + (i % 10) + ':00Z', '2026-10-16'));
    manyRowsOneDay.push(pr('ZZM', 1, '2026-10-18T12:40:00Z', '2026-10-16'));
    manyRowsOneDay.push(pr('ZZM', 2, '2026-10-17T12:40:00Z', '2026-10-15'));
    const pMany = pullLog.pullContext(mockDb(manyRowsOneDay, { ZZM: '2026-10-16' })).by_code.ZZM;
    check('sintetis: 20 baris di satu hari tidak menghabiskan jendela -> hari sebelumnya tetap dipindai (frozen 2, bukan 21)',
      pMany.frontier_frozen_pulls === 2 && pMany.frozen_pull_days === 2 && pMany.pull_days_observed === 3
        && pMany.source_stalled === false,
      JSON.stringify(pMany));

    // ── EVALUABILITAS (keputusan Toku t_be770638 butir 4-5) ────────────────────────────
    // Pengunci: "belum bisa dinilai" TIDAK boleh terbaca sebagai "sumber sehat". Dengan
    // 2 HARI TARIK < ambang 3, `source_stalled` memang tidak bisa true (bukan salah hitung),
    // jadi satu-satunya cara membedakannya dari sumber sehat adalah field evaluabilitas ini.
    const twoDays = [pr('ZZV', 1, '2026-10-18T12:40:00Z', '2026-10-15'),
                     pr('ZZV', 2, '2026-10-19T12:40:00Z', '2026-10-15')];
    const pTwo = pullLog.pullContext(mockDb(twoDays, { ZZV: '2026-10-15' })).by_code.ZZV;
    check('sintetis: pull_days_observed=2 -> stall_evaluable FALSE (riwayat < ambang, bukan "sehat")',
      pTwo.pull_days_observed === 2 && pTwo.stall_evaluable === false && pTwo.source_stalled === false
        && pTwo.stall_threshold_days === 3 && pTwo.frozen_pull_days === 2,
      JSON.stringify(pTwo));
    check('sintetis: 3 HARI TARIK -> stall_evaluable TRUE (evaluabilitas mengikuti satuan hari)',
      pThree.pull_days_observed === 3 && pThree.stall_evaluable === true, JSON.stringify(pThree));
    check('sintetis: rail snapshot (ambang 7 hari) -> 3 hari belum bisa dinilai, 7 hari bisa',
      pSnap3.stall_evaluable === false && pSnap3.stall_threshold_days === 7
        && pSnap7.stall_evaluable === true && pSnap7.pull_days_observed === 7,
      JSON.stringify({ snap3: [pSnap3.pull_days_observed, pSnap3.stall_evaluable], snap7: [pSnap7.pull_days_observed, pSnap7.stall_evaluable] }));
    // Deret beku TETAP dihitung dari hari `ok`; hari yang isinya cuma error/no_data menambah
    // pull_days_observed tapi TIDAK boleh menaikkan evaluabilitas... kecuali hari `ok` cukup.
    const mixedDays = [pr('ZZU', 1, '2026-10-17T12:40:00Z', '2026-10-15'),
                       pr('ZZU', 2, '2026-10-18T12:40:00Z', '2026-10-15'),
                       pr('ZZU', 3, '2026-10-19T12:40:00Z', null, 'error'),
                       pr('ZZU', 4, '2026-10-20T12:40:00Z', null, 'no_data')];
    const pMixed = pullLog.pullContext(mockDb(mixedDays, { ZZU: '2026-10-14' })).by_code.ZZU;
    check('sintetis: hari tanpa tarikan ok tidak menopang evaluabilitas (ok 2 hari < ambang -> evaluable false)',
      pMixed.pull_days_observed === 2 && pMixed.stall_evaluable === false && pMixed.source_stalled === false
        && pMixed.frozen_pull_days === 2 && pMixed.pull_behind === true,
      JSON.stringify(pMixed));

    // (b) pull_behind: cacat KITA vs lag sumber
    const behind = [pr('ZZB', 1, '2026-10-19T10:00:00Z', '2026-10-16')];
    check('sintetis: last_date (15 Okt) < frontier (16 Okt) -> pull_behind TRUE (cacat kita)',
      pullLog.pullContext(mockDb(behind, { ZZB: '2026-10-15' })).by_code.ZZB.pull_behind === true);
    check('sintetis: last_date == frontier -> pull_behind FALSE (tidak ada lag di sisi kita)',
      pullLog.pullContext(mockDb(behind, { ZZB: '2026-10-16' })).by_code.ZZB.pull_behind === false);
    check('sintetis: last_date > frontier (bar dari sumber lain lebih baru) -> pull_behind FALSE',
      pullLog.pullContext(mockDb(behind, { ZZB: '2026-10-19' })).by_code.ZZB.pull_behind === false);
    check('sintetis: tarikan tanpa frontier (error/no_data) -> pull_behind FALSE (tidak menuduh tanpa dasar)',
      pullLog.pullContext(mockDb([pr('ZZC', 1, '2026-10-19T10:00:00Z', null, 'error')], { ZZC: '2026-10-10' })).by_code.ZZC.pull_behind === false);

    // (c) frontierOf: MAX(payload), bukan MAX(DB); baris tak layak simpan tidak jadi frontier.
    check('sintetis: frontierOf = MAX(trade_date) payload (urutan acak, bar lama tetap frontier bila terbesar)',
      pullLog.frontierOf([{ date: '2026-10-15', close: 9 }, { date: '2026-10-16', close: 8 }, { date: '2026-10-14', close: 7 }]) === '2026-10-16');
    check('sintetis: frontierOf melewati baris tanpa tanggal / close<=0 (bukan bukti sumber terbit)',
      pullLog.frontierOf([{ date: '2026-10-15', close: 9 }, { date: '', close: 9 }, { date: '2026-10-17', close: 0 }]) === '2026-10-15');
    check('sintetis: frontierOf payload kosong -> null', pullLog.frontierOf([]) === null && pullLog.frontierOf(null) === null);

    // (d) ringkasan: dua kelas diterbitkan TERPISAH, dan aturan stale/excess tidak ikut berubah.
    const sctx = {
      ref_date: '2026-10-19', ref_source: 'test', sessions,
      window_from: sessions[0], expected_lag: ctx.expected_lag,
      pull: { available: true, thresholds: { session_rail: 3, snapshot_rail: 7 },
              by_code: { TIN: { pull_behind: true, source_stalled: true }, STALLED: { pull_behind: false, source_stalled: true } } },
    };
    const sEnt = [
      { code: 'TIN', freshness: fresh.seriesFreshness(sctx, '2026-10-15', 'TIN') },
      { code: 'STALLED', freshness: fresh.seriesFreshness(sctx, '2026-10-19', 'CPO') },
      { code: 'CPO', freshness: fresh.seriesFreshness(sctx, '2026-10-15', 'CPO') },
    ];
    const sSum = fresh.summarize(sctx, sEnt);
    check('ringkasan: pull_behind_codes & source_stalled_codes terbit terpisah (tidak menumpang stale_codes)',
      sSum.pull_behind_codes.join(',') === 'TIN' && sSum.source_stalled_codes.join(',') === 'STALLED,TIN'
        && sSum.stale_codes.join(',') === 'TIN' && sSum.delayed_codes.join(',') === 'CPO',
      JSON.stringify({ stale: sSum.stale_codes, delayed: sSum.delayed_codes, behind: sSum.pull_behind_codes, stalled: sSum.source_stalled_codes }));
    // Addendum Toku (18:12) butir 1 — KOMPATIBEL KE BELAKANG: fixture di atas sengaja TIDAK
    // punya field stall_* sama sekali, dan hasilnya harus tetap persis seperti sebelumnya.
    // Absen = evaluable, jadi tidak boleh ada kode yang "dituduh" belum bisa dinilai.
    check('ringkasan: by_code tanpa field stall_* (util lama) -> stall_unevaluable_codes KOSONG (absen = evaluable, asersi lama tetap hijau)',
      Array.isArray(sSum.stall_unevaluable_codes) && sSum.stall_unevaluable_codes.length === 0,
      JSON.stringify(sSum.stall_unevaluable_codes));

    // Fixture KEDUA (terpisah, bukan menumpang yang lama) untuk pengunci DoD tambahan Toku:
    // 2 hari tarik -> stall_evaluable=false DAN kode itu muncul di stall_unevaluable_codes.
    const sctx2 = {
      ref_date: '2026-10-19', ref_source: 'test', sessions,
      window_from: sessions[0], expected_lag: ctx.expected_lag,
      pull: { available: true, thresholds: { session_rail: 3, snapshot_rail: 7 },
              by_code: {
                // kasus nyata 20 Okt 2026: kelima seri punya 2 hari tarik < ambang 3.
                YOUNG: { pull_behind: false, source_stalled: false, stall_evaluable: false, pull_days_observed: 2 },
                // sumber sehat yang SUDAH bisa dinilai: tidak boleh masuk daftar mana pun.
                HEALTHY: { pull_behind: false, source_stalled: false, stall_evaluable: true, pull_days_observed: 9 },
              } },
    };
    const sEnt2 = [
      { code: 'YOUNG', freshness: fresh.seriesFreshness(sctx2, '2026-10-19', 'CPO') },
      { code: 'HEALTHY', freshness: fresh.seriesFreshness(sctx2, '2026-10-19', 'CPO') },
    ];
    const sSum2 = fresh.summarize(sctx2, sEnt2);
    check('ringkasan: pull_days_observed=2 (stall_evaluable=false) -> kode TERBIT di stall_unevaluable_codes, bukan di source_stalled_codes',
      sSum2.stall_unevaluable_codes.join(',') === 'YOUNG'
        && sSum2.source_stalled_codes.length === 0
        && sSum2.stall_unevaluable_codes.indexOf('HEALTHY') === -1,
      JSON.stringify({ unevaluable: sSum2.stall_unevaluable_codes, stalled: sSum2.source_stalled_codes }));
    check('ringkasan: pull_log.thresholds ikut terkirim (angka N terbaca, bukan sihir di kode)',
      sSum.pull_log.available === true && sSum.pull_log.thresholds.session_rail === 3 && sSum.pull_log.thresholds.snapshot_rail === 7);
    const sumNoPull = fresh.summarize(ctx, sEnt);
    check('ringkasan: ctx tanpa telemetri (DB lama) -> array kosong, tidak crash, stale/excess tetap',
      Array.isArray(sumNoPull.pull_behind_codes) && sumNoPull.pull_behind_codes.length === 0
        && sumNoPull.pull_log.available === false && sumNoPull.stale_codes.join(',') === 'TIN');

    // (e) live: telemetri dibaca dari tabel asli, dan flag-nya cocok dengan SQL INDEPENDEN
    const liveCtx = fresh.buildContext(db);
    check('live: buildContext membawa pull.available=true (tabel custom_pull_log ada)',
      !!(liveCtx.pull && liveCtx.pull.available === true), JSON.stringify(liveCtx.pull && liveCtx.pull.thresholds));
    const pullRows = db.prepare(
      'SELECT id, code, source, pulled_at, ref_date, source_frontier_date, status FROM custom_pull_log ORDER BY code, id DESC').all();
    const liveBad = [];
    const grouped = {};
    for (const r of pullRows) (grouped[r.code] = grouped[r.code] || []).push(r);
    const tickers = {};
    for (const t of db.prepare('SELECT code, last_date FROM custom_tickers').all()) tickers[t.code] = t.last_date || '';
    const liveReport = pullLog.pullReport(db);
    // Deret beku dihitung ulang DI SINI (bukan dari util): tarikan sukses dirapatkan jadi SATU
    // titik per HARI TARIK (tanggal WIB), baris non-ok dilewati, lalu deret terdepan dengan
    // frontier sama dihitung. Jendela = HARI TARIK yang benar-benar dipindai pullContext.
    const okDaysOf = (list, dayLimit) => {
      const seen = new Set(), days = [];
      for (const r of list) {
        if (r.status !== 'ok' || !r.source_frontier_date) continue;
        const d = dayWib(r.pulled_at);
        if (seen.has(d)) continue;
        seen.add(d);
        days.push(r.source_frontier_date);
        if (dayLimit && days.length >= dayLimit) break;
      }
      return days;
    };
    const streakOf = (list, dayLimit) => {
      let streak = 0, front = null;
      for (const f of okDaysOf(list, dayLimit)) {
        if (front === null) front = f;
        if (f !== front) break;
        streak++;
      }
      return streak;
    };
    // Jumlah HARI TARIK (semua status) yang masuk jendela pullContext.
    const windowDaysOf = (list, dayLimit) => {
      const seen = new Set();
      for (const r of list) {
        if (seen.size >= dayLimit) break;
        seen.add(dayWib(r.pulled_at));
      }
      return seen.size;
    };
    // HARI TARIK yang punya tarikan `ok` DI DALAM jendela pullContext — pembagi deret beku.
    // Hari di luar jendela tidak boleh ikut: kalau ikut, `pull_days_observed` jadi lebih besar
    // dari yang benar-benar dipindai util, dan evaluabilitasnya dibandingkan dengan angka lain.
    const okDaysInWindow = (list, dayLimit) => {
      const days = [], ok = new Set();
      for (const r of list) {
        const d = dayWib(r.pulled_at);
        if (days.indexOf(d) === -1) {
          if (days.length >= dayLimit) continue;      // sudah di luar jendela
          days.push(d);
        }
        if (r.status === 'ok' && r.source_frontier_date) ok.add(d);
      }
      return ok.size;
    };
    for (const code of Object.keys(grouped)) {
      const list = grouped[code];                        // id DESC = terbaru dulu
      const flags = liveCtx.pull.by_code[code] || {};
      const rep = liveReport.by_code[code] || {};
      const lastFrontier = (list.find(r => r.source_frontier_date) || {}).source_frontier_date || null;
      const streakWindow = streakOf(list, pullLog.SCAN_PULL_DAYS);
      const streakFull = streakOf(list, 0);
      const windowDays = windowDaysOf(list, pullLog.SCAN_PULL_DAYS);
      const okDaysWindow = okDaysInWindow(list, pullLog.SCAN_PULL_DAYS);
      const okDaysFull = okDaysOf(list, 0).length;
      const thr = pullLog.stallThresholdFor((list.find(r => r.source_frontier_date) || {}).source || '');
      if (flags.last_frontier_date !== lastFrontier) liveBad.push(code + ': frontier ' + flags.last_frontier_date + ' != ' + lastFrontier);
      if (flags.frontier_frozen_pulls !== streakWindow) liveBad.push(code + ': frozen window ' + flags.frontier_frozen_pulls + ' != ' + streakWindow);
      if (flags.frozen_pull_days !== streakWindow) liveBad.push(code + ': frozen_pull_days ' + flags.frozen_pull_days + ' != ' + streakWindow);
      if (flags.pull_days_observed !== okDaysWindow) liveBad.push(code + ': pull_days_observed ' + flags.pull_days_observed + ' != ' + okDaysWindow);
      if (flags.stall_threshold_days !== thr) liveBad.push(code + ': threshold_days ' + flags.stall_threshold_days + ' != ' + thr);
      if (flags.stall_evaluable !== (okDaysWindow >= thr)) liveBad.push(code + ': evaluable ' + flags.stall_evaluable + ' != ' + (okDaysWindow >= thr));
      // Invarian yang menutup silent false-negative: stalled HANYA boleh true bila bisa dinilai.
      if (flags.source_stalled === true && flags.stall_evaluable !== true) liveBad.push(code + ': stalled tanpa evaluable');
      if (flags.frozen_capped !== (okDaysWindow >= pullLog.SCAN_PULL_DAYS && streakWindow >= pullLog.SCAN_PULL_DAYS)) {
        liveBad.push(code + ': frozen_capped ' + flags.frozen_capped + ' != ' + (okDaysWindow >= pullLog.SCAN_PULL_DAYS && streakWindow >= pullLog.SCAN_PULL_DAYS));
      }
      if (flags.frozen_scan_days !== okDaysWindow) liveBad.push(code + ': frozen_scan_days ' + flags.frozen_scan_days + ' != ' + okDaysWindow);
      if (flags.source_stalled !== (streakFull >= thr)) liveBad.push(code + ': stalled ' + flags.source_stalled + ' != ' + (streakFull >= thr));
      if (flags.stall_threshold !== thr) liveBad.push(code + ': threshold ' + flags.stall_threshold + ' != ' + thr);
      // Laporan (seluruh riwayat) tidak boleh terpotong jendela request.
      if (rep.frontier_frozen_pulls !== streakFull) liveBad.push(code + ': report frozen ' + rep.frontier_frozen_pulls + ' != ' + streakFull);
      if (rep.frozen_pull_days !== streakFull) liveBad.push(code + ': report frozen_pull_days ' + rep.frozen_pull_days + ' != ' + streakFull);
      if (rep.pull_days_observed !== okDaysFull) liveBad.push(code + ': report pull_days_observed ' + rep.pull_days_observed + ' != ' + okDaysFull);
      if (rep.stall_evaluable !== (okDaysFull >= thr)) liveBad.push(code + ': report evaluable ' + rep.stall_evaluable + ' != ' + (okDaysFull >= thr));
      if (rep.frozen_capped !== false) liveBad.push(code + ': report frozen_capped harus false (laporan penuh)');
      const wantBehind = !!(lastFrontier && Object.prototype.hasOwnProperty.call(tickers, code)
        && (!tickers[code] || tickers[code] < lastFrontier));
      if (flags.pull_behind !== wantBehind) liveBad.push(code + ': behind ' + flags.pull_behind + ' != ' + wantBehind);
      if (rep.pull_behind !== wantBehind) liveBad.push(code + ': report behind ' + rep.pull_behind + ' != ' + wantBehind);
      if (rep.last_frontier_date !== lastFrontier) liveBad.push(code + ': report frontier ' + rep.last_frontier_date + ' != ' + lastFrontier);
    }
    check('live: tiap flag (frontier, frozen, stalled, threshold, behind) = hitungan SQL independen',
      pullRows.length > 0 && liveBad.length === 0,
      pullRows.length ? liveBad.join(' | ') : 'custom_pull_log masih kosong — tarik satu seri dulu');
    check('live: deret beku laporan >= deret beku jendela request (laporan tidak boleh lebih pendek)',
      Object.keys(liveReport.by_code).every(c => {
        const comp = (Object.keys(grouped).indexOf(c) === -1);   // kode di luar jendela? tidak mungkin, laporkan apa adanya
        return comp || liveReport.by_code[c].frontier_frozen_pulls >= ((liveCtx.pull.by_code[c] || {}).frontier_frozen_pulls || 0);
      }), Object.keys(liveReport.by_code).join(','));

    // (e2) live: "belum bisa dinilai" terbit di PAYLOAD panel, bukan hanya di util.
    // DoD Toku: kode dengan stall_evaluable=false wajib terlihat di /api/market/overview.
    // Yang diuji bukan "array tidak kosong" (itu bisa lolos dengan isi karangan), melainkan
    // kesamaan himpunan dengan pullContext untuk seri yang memang ada di surface itu.
    // Surface overview membatasi ringkasannya ke section `commodities` (9 seri), jadi himpunan
    // pembandingnya diambil dari section itu — bukan seluruh custom_pull_log, dan tanpa duplikat
    // (allComm memuat beberapa kontrak per kode).
    const ovSection = ((ov && Array.isArray(ov.sections)) ? ov.sections : [])
      .filter(s => s && s.id === 'commodities')[0] || null;
    const ovCodes = Array.from(new Set(((ovSection && ovSection.items) || []).map(i => i && i.code).filter(Boolean))).sort();
    const unevalWant = ovCodes.filter(c => liveCtx.pull.by_code[c] && liveCtx.pull.by_code[c].stall_evaluable === false).sort();
    const unevalGot = ((ov && ov.freshness && ov.freshness.stall_unevaluable_codes) || []).slice().sort();
    const unevalBad = [];
    if (!ov || !ov.freshness || !Array.isArray(ov.freshness.stall_unevaluable_codes)) {
      unevalBad.push('field stall_unevaluable_codes tidak ada di /api/market/overview.freshness');
    }
    if (ovCodes.length === 0) unevalBad.push('section commodities kosong — asersi ini tidak menguji apa pun');
    for (const c of unevalGot) {
      const p = liveCtx.pull.by_code[c];
      if (!p) unevalBad.push(c + ': tidak ada di pullContext');
      else if (p.stall_evaluable !== false) unevalBad.push(c + ': evaluable=true tapi masuk unevaluable');
      else if (p.source_stalled) unevalBad.push(c + ': stalled=true tapi masuk unevaluable (kontradiktif)');
    }
    if (unevalWant.join(',') !== unevalGot.join(',')) {
      unevalBad.push('panel [' + unevalGot.join(',') + '] != pullContext [' + unevalWant.join(',') + ']');
    }
    check('live: freshness.stall_unevaluable_codes = kode ber-`stall_evaluable=false` di pullContext (bukan daftar karangan)',
      unevalBad.length === 0, unevalBad.join(' | ') || ('unevaluable=' + unevalGot.join(',')));

    // (f) live: lag frontier MAKS (sesi) vs nilai deklaratif — angka yang menggantikan deklarasi
    const report = pullLog.pullReport(db);
    const lagBad = [];
    for (const code of Object.keys(report.by_code)) {
      const r = report.by_code[code];
      if (r.ok_pulls > 0 && r.frontier_lag_samples === 0 && r.frontier_lag_na === 0) lagBad.push(code + ': tarikan ok tanpa sampel lag');
      for (const k of ['frontier_lag_p50', 'frontier_lag_p95']) {
        const v = r[k];
        if (v !== null && (typeof v !== 'number' || v < 0 || v > 200)) lagBad.push(code + ' ' + k + '=' + v);
      }
      if (r.frontier_lag_p50 !== null && r.frontier_lag_p95 !== null && r.frontier_lag_p50 > r.frontier_lag_p95) lagBad.push(code + ': p50 > p95');
      const decl = liveCtx.expected_lag[code];
      const exp = decl && decl.expected_lag_sessions != null ? Number(decl.expected_lag_sessions) : null;
      if (r.frontier_lag_p50 !== null && exp !== null && r.frontier_lag_samples >= 5 && r.frontier_lag_p50 !== exp) {
        // Bukan kegagalan: telemetri MELAPORKAN, manusia yang mendeklarasikan ulang.
        console.log(`  note ${code}: frontier_lag_p50=${r.frontier_lag_p50} vs expected_lag_sessions=${exp} (deklarasi perlu ditinjau, bukan di-ratchet otomatis)`);
      }
    }
    check('live: laporan lag frontier konsisten (p50 <= p95, 0..200 sesi, tiap tarikan ok punya sampel)',
      lagBad.length === 0, lagBad.join(' | '));
    const lagRows = Object.keys(report.by_code).filter(c => report.by_code[c].frontier_lag_samples > 0);
    console.log('  lag frontier per kode (sesi, pada jam tarik; n = tarikan sukses bersampel):');
    if (!lagRows.length) console.log('    (belum ada tarikan yang tercatat — tabel baru, lihat DoD-1)');
    for (const c of lagRows.sort()) {
      const r = report.by_code[c];
      console.log(`    ${c.padEnd(14)} pulls=${String(r.pulls).padStart(3)} ok=${String(r.ok_pulls).padStart(3)}`
        + ` err=${String(r.error_pulls).padStart(2)} n=${String(r.frontier_lag_samples).padStart(2)}`
        + ` lag p50=${r.frontier_lag_p50} p95=${r.frontier_lag_p95} (min ${r.frontier_lag_min}, max ${r.frontier_lag_max})`
        + ` frontier=${r.last_frontier_date} last_date=${r.last_date}`
        + (r.pull_behind ? ' PULL_BEHIND' : '') + (r.source_stalled ? ' SOURCE_STALLED' : ''));
    }

    // ── [10] kalender sesi terdeklarasi + sinyal "pipeline data berhenti" (t_c6c01360) ──
    // Yang dikunci: (1) kalender ↔ 60 sesi idx_daily DUA ARAH, (2) jumlah libur per tahun 15-30,
    // (3) valid_through >= hari ini+45 (peringatan, bukan gagal), (4) lima kasus §D5 dengan `now`
    // DISUNTIKKAN, (5) kontrak degradasi 'na' untuk stopped & calendar_stale TANPA menyentuh DB.
    console.log('\n[10] kalender sesi terdeklarasi + ctx.pipeline (jam dinding WIB vs kalender)');
    const ISO = /^\d{4}-\d{2}-\d{2}$/;
    const cal = fresh.loadCalendar();
    const wibToday = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const wibNowIso = new Date(Date.now() + 7 * 3600000).toISOString();
    const wibMinute = Number(wibNowIso.slice(11, 13)) * 60 + Number(wibNowIso.slice(14, 16));
    // Dipakai blok [1]/[2] DAN blok bukti (elapsed independen) di bawah.
    const holSet = new Set(cal ? cal.holidays.map(String) : []);
    const extrasSet = new Set(cal && Array.isArray(cal.extra_sessions) ? cal.extra_sessions.map(String) : []);
    check('kalender: berkas terbaca', !!cal, fresh.CALENDAR_PATH);

    if (cal) {
      check('kalender: bentuk wajib (version, valid_through, source_url, fetched_at, holidays[], extra_sessions[])',
        'version' in cal && 'valid_through' in cal && 'source_url' in cal && 'fetched_at' in cal
          && Array.isArray(cal.holidays) && Array.isArray(cal.extra_sessions), Object.keys(cal).join(','));
      check('kalender: valid_through + semua holidays berupa tanggal ISO',
        ISO.test(String(cal.valid_through)) && cal.holidays.length > 0 && cal.holidays.every(h => ISO.test(String(h))),
        JSON.stringify(cal.holidays.filter(h => !ISO.test(String(h)))));
      check('kalender: source_url menunjuk berkas/SK resmi (bisa diaudit manusia)',
        /^https?:\/\//.test(String(cal.source_url)), String(cal.source_url));

      // (2) jumlah libur per tahun penuh 15-30 (IDX historis ~19-25/tahun)
      const perYear = {};
      for (const h of cal.holidays) { const y = String(h).slice(0, 4); perYear[y] = (perYear[y] || 0) + 1; }
      const badYear = Object.keys(perYear).filter(y => perYear[y] < 15 || perYear[y] > 30);
      check('kalender: jumlah libur per tahun dalam 15-30', badYear.length === 0,
        badYear.map(y => y + '=' + perYear[y]).join(',') || JSON.stringify(perYear));

      // (3) valid_through >= hari ini + 45 hari -> PERINGATAN, bukan FAIL (sinyal akan
      // calendar_stale sendiri di UI, dan itu memang terlihat)
      const plus45 = new Date(Date.now() + 7 * 3600000 + 45 * 86400000).toISOString().slice(0, 10);
      if (String(cal.valid_through) < plus45) {
        console.log('  note kalender: valid_through=' + cal.valid_through + ' < hari ini+45 (' + plus45
          + ') — perbarui dari SK libur bursa; sinyal akan jadi calendar_stale (terlihat, bukan alarm)');
      }

      // (1) + (2) konsistensi DUA ARAH terhadap 60 sesi terakhir idx_daily. Turunan sesi di bawah
      // DITULIS TANGAN (bukan memanggil modul) supaya kalau calendarSessions() salah, asersinya
      // tidak ikut salah. Ini VALIDASI, bukan sumber kalender: libur tetap dari berkas.
      const last60 = db.prepare('SELECT DISTINCT trade_date d FROM idx_daily ORDER BY trade_date DESC LIMIT 60')
        .all().map(r => r.d).reverse();
      const idxSet = new Set(last60);
      const from = last60[0], to = last60[last60.length - 1];
      const handSessions = [];
      for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) {
        const iso = new Date(t).toISOString().slice(0, 10);
        const wd = new Date(t).getUTCDay();
        if (holSet.has(iso)) continue;
        if ((wd === 0 || wd === 6) && !extrasSet.has(iso)) continue;
        handSessions.push(iso);
      }
      const missingRows = handSessions.filter(d => d <= wibToday && !idxSet.has(d));
      check('[1] tiap sesi terdeklarasi (dalam cakupan 60 sesi idx_daily, <= hari ini) ADA barisnya di idx_daily',
        handSessions.length > 0 && missingRows.length === 0,
        'jendela ' + from + '..' + to + ' hilang: ' + (missingRows.join(',') || '-'));
      const holidayWithData = last60.filter(d => holSet.has(d));
      check('[2] tidak ada trade_date idx_daily (60 sesi terakhir) yang dideklarasikan libur',
        holidayWithData.length === 0, holidayWithData.join(','));
      const modSessions = (fresh.calendarSessions(cal) || []).filter(d => d >= from && d <= to);
      check('kalender: calendarSessions() = turunan tangan untuk jendela yang sama (modul tidak menambah/mengurangi sesi)',
        modSessions.join(',') === handSessions.join(','),
        'modul=' + modSessions.length + ' tangan=' + handSessions.length);

      // (4) LIMA kasus §D5 — fungsi murni, `now` disuntikkan
      console.log('  -- unit test pipelineSignal (now disuntikkan, tanpa DB) --');
      const sig = (o) => fresh.pipelineSignal(Object.assign({ calendar: cal }, o));
      const uA = sig({ refDate: '2026-03-17', now: '2026-03-25T01:00:00Z' });   // 25 Mar 08:00 WIB
      check('(a) klaster libur 18-24 Mar 2026 -> elapsed 0, state ok (tanpa kalender: 5 hari kerja = 5 alarm palsu)',
        uA.elapsed_sessions === 0 && uA.state === 'ok', JSON.stringify(uA));
      const uB = sig({ refDate: '2026-03-17', now: '2026-03-30T02:00:00Z' });   // 30 Mar 09:00 WIB
      check('(b) outage sintetis 3 sesi (25,26,27 Mar) -> elapsed 3, state stopped, cause pipeline_stopped',
        uB.elapsed_sessions === 3 && uB.state === 'stopped' && uB.cause === 'pipeline_stopped', JSON.stringify(uB));
      const uC1 = sig({ refDate: '2026-10-19', now: '2026-10-20T13:59:00Z' });  // 20 Okt 20:59 WIB
      const uC2 = sig({ refDate: '2026-10-19', now: '2026-10-20T14:00:00Z' });  // 20 Okt 21:00 WIB
      check('(c) sebelum cutoff 21:00 WIB -> sesi hari itu TIDAK dihitung (elapsed 0)',
        uC1.elapsed_sessions === 0 && uC1.state === 'ok', JSON.stringify(uC1));
      check('(c) tepat 21:00 WIB -> sesi hari itu mulai dituntut (elapsed 1, lag1 netral)',
        uC2.elapsed_sessions === 1 && uC2.state === 'lag1' && uC2.cause === null, JSON.stringify(uC2));
      const uD = sig({ refDate: '2026-10-19', now: '2027-01-05T05:00:00Z' });
      check('(d) hari ini > valid_through -> calendar_stale TANPA alarm (elapsed null, cause calendar_stale)',
        uD.state === 'calendar_stale' && uD.cause === 'calendar_stale' && uD.elapsed_sessions === null, JSON.stringify(uD));
      const uD2 = sig({ refDate: '2026-10-19', now: '2026-10-28T03:00:00Z' });  // kontrol: kalender masih valid
      check('(d) kontrol: kalender valid + 6 sesi belum masuk -> stopped (bukan calendar_stale)',
        uD2.state === 'stopped' && uD2.elapsed_sessions === 6, JSON.stringify(uD2));
      const calW = { version: 99, valid_through: '2026-12-31', source_url: 'inline-test', holidays: ['2026-10-19'], extra_sessions: [] };
      // 20 Okt 21:00 WIB. Sesi terdeklarasi di (16 Okt, 20 Okt] = 20 Okt saja (19 Okt libur, 17/18
      // weekend) -> elapsed 1. Hitungan HARI KERJA akan memberi 2 (19 + 20) = alarm palsu.
      const uE = fresh.pipelineSignal({ refDate: '2026-10-16', now: '2026-10-20T14:00:00Z', calendar: calW });
      const uE0 = fresh.pipelineSignal({ refDate: '2026-10-16', now: '2026-10-20T13:59:00Z', calendar: calW });
      check('(e) weekend panjang (Jum 16 -> Sen 19 libur): hanya sesi TERDEKLARASI dihitung -> elapsed 1, lag1',
        uE.elapsed_sessions === 1 && uE.state === 'lag1', JSON.stringify(uE));
      check('(e) kontrol sebelum cutoff: Sen 19 libur + 20 Okt belum cutoff -> elapsed 0 (bukan 2/3)',
        uE0.elapsed_sessions === 0 && uE0.state === 'ok', JSON.stringify(uE0));
      const calX = { version: 98, valid_through: '2026-12-31', source_url: 'inline-test', holidays: [], extra_sessions: ['2026-10-17'] };
      const uX = fresh.pipelineSignal({ refDate: '2026-10-16', now: '2026-10-19T02:00:00Z', calendar: calX });
      check('kalender: extra_sessions (sesi Sabtu khusus) ikut dituntut -> elapsed 1',
        uX.elapsed_sessions === 1, JSON.stringify(uX));
      check('pipelineSignal: tanpa ref_date -> no_ref (tidak mengarang keadaan)',
        sig({ refDate: null, now: '2026-10-20T05:00:00Z' }).state === 'no_ref');
      check('pipelineSignal: kalender tak terpakai -> calendar_stale (fail-visible), BUKAN ok',
        fresh.pipelineSignal({ refDate: '2026-10-19', now: '2026-10-20T05:00:00Z', calendar: null }).state === 'calendar_stale');
    } else {
      check('kalender: berkas hilang -> ctx.pipeline calendar_stale (semua seri na), bukan diam-diam segar', false, 'berkas tidak terbaca');
    }

    // ── bukti LIVE: keadaan sekarang + degradasi tanpa menyentuh DB ──────
    const livePipeCtx = fresh.buildContext(db);
    const stopPipeCtx = fresh.buildContext(db, { now: '2026-10-28T03:00:00Z' });   // 28 Okt 2026 10:00 WIB
    const stalePipeCtx = fresh.buildContext(db, { now: '2027-01-05T05:00:00Z' });  // kalender 2026 sudah lewat
    check('live: buildContext().pipeline ada dan state sekarang = ok (ref 19 Okt, cutoff 20 Okt 21:00 belum lewat)',
      !!livePipeCtx.pipeline && livePipeCtx.pipeline.state === 'ok', JSON.stringify(livePipeCtx.pipeline));
    check('live: pipeline.calendar = berkas kalender (version, valid_through, source_url)',
      !!livePipeCtx.pipeline.calendar && !!cal
        && String(livePipeCtx.pipeline.calendar.valid_through) === String(cal.valid_through)
        && livePipeCtx.pipeline.calendar.version === cal.version
        && livePipeCtx.pipeline.calendar.source_url === cal.source_url,
      JSON.stringify(livePipeCtx.pipeline.calendar));
    check('live: cutoff_wib = 21:00 (jam yang diputuskan, bukan angka lokal di UI)',
      livePipeCtx.pipeline.cutoff_wib === '21:00', String(livePipeCtx.pipeline.cutoff_wib));
    check('live: last_pull hanya METADATA (hint manual, umur hari terjumlah) — bukan alarm',
      !!livePipeCtx.pipeline.last_pull && livePipeCtx.pipeline.last_pull.hint === 'manual'
        && (livePipeCtx.pipeline.last_pull.age_days === null || typeof livePipeCtx.pipeline.last_pull.age_days === 'number'),
      JSON.stringify(livePipeCtx.pipeline.last_pull));

    // Elapsed dihitung ULANG di sini (bukan dari modul) dari kalender + jam dinding WIB.
    if (cal && wibToday <= String(cal.valid_through)) {
      let elapsedLocal = 0;
      const refMs = Date.parse((ref || '1970-01-01') + 'T00:00:00Z');
      for (let t = refMs + 86400000; t <= Date.parse(wibToday + 'T00:00:00Z'); t += 86400000) {
        const iso = new Date(t).toISOString().slice(0, 10);
        const wd = new Date(t).getUTCDay();
        if (holSet.has(iso)) continue;
        if ((wd === 0 || wd === 6) && !extrasSet.has(iso)) continue;
        const passed = iso < wibToday || (iso === wibToday && wibMinute >= 21 * 60);
        if (passed) elapsedLocal++;
      }
      check('live: elapsed_sessions = turunan independen (kalender + jam dinding WIB), di-clamp >= 0',
        livePipeCtx.pipeline.elapsed_sessions === elapsedLocal,
        'modul=' + livePipeCtx.pipeline.elapsed_sessions + ' lokal=' + elapsedLocal + ' today=' + wibToday + ' ' + wibNowIso.slice(11, 16));
    }

    // DoD: seri yang SEKARANG 'fresh' harus turun ke 'na'/pipeline_stopped saat `now` disuntik.
    // DB tidak disentuh: ref_date dibaca dari DB yang sama, hanya jam + kalender yang disuntikkan.
    const freshSeriesNow = (cmdSeries.find(s => s.state === 'fresh') || null);
    const proveCode = (freshSeriesNow && freshSeriesNow.code) || 'ID10Y';
    const proveLast = (freshSeriesNow && (freshSeriesNow.stale_date || freshSeriesNow.date)) || ref;
    const fLive = fresh.seriesFreshness(livePipeCtx, proveLast, proveCode);
    const fStop = fresh.seriesFreshness(stopPipeCtx, proveLast, proveCode);
    const fStale = fresh.seriesFreshness(stalePipeCtx, proveLast, proveCode);
    check('bukti stopped: seri yang sekarang fresh (' + proveCode + ' @' + proveLast + ') -> na/pipeline_stopped, lag & excess NULL, stale false',
      fLive.state === 'fresh' && fStop.state === 'na' && fStop.lag_basis === 'pipeline_stopped'
        && fStop.lag_sessions === null && fStop.excess_sessions === null && fStop.stale === false,
      JSON.stringify({ live: fLive, stopped: fStop }));
    check('bukti stopped: ctx.pipeline.state = stopped + elapsed 6 pada suntikan 28 Okt 10:00 WIB',
      stopPipeCtx.pipeline.state === 'stopped' && stopPipeCtx.pipeline.elapsed_sessions === 6,
      JSON.stringify(stopPipeCtx.pipeline));
    check('bukti calendar_stale: valid_through lewat -> na/calendar_stale, TANPA alarm (bukan excess, stale false)',
      stalePipeCtx.pipeline.state === 'calendar_stale' && fStale.state === 'na'
        && fStale.lag_basis === 'calendar_stale' && fStale.stale === false,
      JSON.stringify({ pipe: stalePipeCtx.pipeline.state, f: fStale }));
    check('bukti: menyuntik now TIDAK mengubah ref_date (jalur baca tetap, DB tidak ditulis)',
      stopPipeCtx.ref_date === livePipeCtx.ref_date && stalePipeCtx.ref_date === livePipeCtx.ref_date,
      `live=${livePipeCtx.ref_date} stopped=${stopPipeCtx.ref_date} stale=${stalePipeCtx.ref_date}`);
    check('bukti: kurva SUN tidak lagi mengaku "tenor belum dideklarasikan" saat pipeline berhenti (lag_basis diteruskan)',
      (function () {
        const yc = require('/app/server/utils/yield-curve');
        const f = yc.curveFreshness(stopPipeCtx, (typeof ref === 'string' ? ref : null), ['ID10Y']);
        return f.state === 'na' && f.lag_basis === 'pipeline_stopped';
      })(), 'curveFreshness(stopPipeCtx)');

    // Ringkasan mewariskan sinyal (D1) + tidak ada panel yang bisa mencetak "basi" saat stopped.
    check('ringkasan: summarize() meneruskan pipeline di KETIGA surface (satu sinyal, bukan tiga salinan)',
      !!(cmd.freshness && cmd.freshness.pipeline && mr.commodity_freshness && mr.commodity_freshness.pipeline
        && ov.freshness && ov.freshness.pipeline)
        && cmd.freshness.pipeline.state === livePipeCtx.pipeline.state
        && mr.commodity_freshness.pipeline.state === livePipeCtx.pipeline.state
        && ov.freshness.pipeline.state === livePipeCtx.pipeline.state,
      JSON.stringify([cmd.freshness && cmd.freshness.pipeline && cmd.freshness.pipeline.state,
        mr.commodity_freshness && mr.commodity_freshness.pipeline && mr.commodity_freshness.pipeline.state,
        ov.freshness && ov.freshness.pipeline && ov.freshness.pipeline.state]));
    check('ringkasan: ctx lama tanpa pipeline -> pipeline null (pemanggil lain tidak pecah)',
      fresh.summarize(ctx, []).pipeline === null);
    const stopSumCtx = Object.assign({}, livePipeCtx, { pipeline: stopPipeCtx.pipeline });
    const stopEnt = [{ code: 'TIN', freshness: fresh.seriesFreshness(stopSumCtx, '2026-10-15', 'TIN') }];
    const stopSum = fresh.summarize(stopSumCtx, stopEnt);
    check('ringkasan: saat stopped, stale_codes KOSONG dan seri masuk na_codes (tidak ada panel yang mencetak "basi")',
      stopSum.stale_codes.length === 0 && stopSum.na_codes.indexOf('TIN') >= 0
        && stopSum.pipeline.state === 'stopped', JSON.stringify({ stale: stopSum.stale_codes, na: stopSum.na_codes }));

    // UI: berkas yang DISAJIKAN, bukan hanya working tree.
    const servedMrJs = await getText('/js/market-regime.js');
    check('UI: market-regime.js yang disajikan memuat badge pipeline (bukan hanya working tree)',
      servedMrJs.indexOf('mr-pipeline-badge') !== -1 && servedMrJs.indexOf('mr-pipeline-note') !== -1
        && servedMrJs.indexOf("fr.lag_basis === 'pipeline_stopped'") !== -1,
      'panjang=' + servedMrJs.length);
    const servedCmdJs = await getText('/js/commodities.js');
    check('UI: commodities.js yang disajikan memuat catatan netral pipeline (teks yang sama)',
      servedCmdJs.indexOf('cmd-pipeline-note') !== -1, 'panjang=' + servedCmdJs.length);

    console.log(`\n${pass} lulus, ${failures.length} gagal`);
    if (failures.length) { failures.forEach(f => console.log(' - ' + f)); process.exitCode = 1; }
    db.close();
  }).catch(e => {
    console.log('  FAIL endpoint tidak bisa dibaca: ' + e.message);
    process.exitCode = 1;
    db.close();
  });
}

main().catch(e => { console.error(e); process.exitCode = 1; db.close(); });
