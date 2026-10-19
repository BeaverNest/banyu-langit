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
//
// Jalankan di dalam container (DB tidak ada di host):
//   docker exec -w /app banyu-langit node server/scripts/check-series-freshness.js
// Env: BL_URL (default http://127.0.0.1:3000 — port di dalam container)
// Exit 0 = lulus, 1 = ada asersi gagal.
// ═══════════════════════════════════════════════════════════════════════════

const Database = require('/app/node_modules/better-sqlite3');
const fresh = require('/app/server/utils/series-freshness');

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
  ]).then(([cmd, mr, ov, sdTins, sdAntm]) => {
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
      !!tin && Boolean(tin.stale) === (lagOf(tin) > expectedOf('TIN')), JSON.stringify(tin || null));
    check('NICKEL (rail & jam tarik sama) segar: lag 0, stale false',
      !!nickel && nickel.stale === false && lagOf(nickel) === 0, JSON.stringify(nickel || null));
    check('COAL: stale == (lag DB > ekspektasi seri)',
      !!coal && Boolean(coal.stale) === (lagOf(coal) > expectedOf('COAL')), JSON.stringify(coal || null));
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
      if (String(i.stale_date) !== String(expectLast)) ovMismatch.push(`${i.code}: stale_date ${i.stale_date} != DB ${expectLast}`);
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
      check('TINS: lag_sessions = COUNT(DISTINCT sesi) SQL independen', Number(tins.lag_sessions) === expectLag,
        `endpoint=${tins.lag_sessions} sql=${expectLag}`);
      check('TINS: stale == (lag DB > ekspektasi seri)', Boolean(tins.stale) === (expectLag > expectedOf(tins.code)),
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
      if (!staleOk(s.code, s.lag_sessions, s.stale)) expBad.push(`${s.code}: stale ${s.stale} vs lag ${s.lag_sessions} & expected ${e}`);
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
    const naBad = allComm.filter(s => s.state === 'na' && basisOf(s.code) !== 'na').map(s => s.code);
    check('live: state na hanya untuk seri yang lag_basis-nya memang na (sisanya ' + 'fresh/by_source/excess)',
      naBad.length === 0, JSON.stringify(naBad));

    // (d) anti-perbaikan-palsu: asersi ini GAGAL kalau ada yang "menyelesaikan" kartu ini
    //     dengan menaikkan ambang global ke 2 (TIN lag 2 -> tidak menyala, CPO ikut menyala).
    check('anti-perbaikan-palsu: TIN expected 0 & stale TRUE, CPO expected 2 & stale FALSE pada hari yang sama',
      !!tin && Number(tin.expected_lag_sessions) === 0 && tin.stale === true
        && !!byCode['CPO'] && Number(byCode['CPO'].expected_lag_sessions) === 2 && byCode['CPO'].stale === false,
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
    check('live: grup by_source (stale false sejak ambang per-seri) tetap tertahan -> divergence null + commodity_stale',
      bySourceGroups.length > 0 && bySourceGroups.every(g => g.divergence == null && g.divergence_reason === 'commodity_stale'),
      bySourceGroups.map(g => g.id + ':' + g.divergence + '/' + g.divergence_reason).join(','));
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
