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
  const ctx = { ref_date: '2026-10-19', ref_source: 'test', sessions, window_from: sessions[0] };

  const f0 = fresh.seriesFreshness(ctx, '2026-10-19');
  check('last = sesi terakhir -> lag 0, tidak basi', f0.lag_sessions === 0 && f0.stale === false, JSON.stringify(f0));

  const f1 = fresh.seriesFreshness(ctx, '2026-10-16');
  check('last = 1 sesi di belakang -> lag 1, BASI', f1.lag_sessions === 1 && f1.stale === true, JSON.stringify(f1));

  const f2 = fresh.seriesFreshness(ctx, '2026-10-15');
  check('last = 2 sesi di belakang (TIN) -> lag 2, BASI', f2.lag_sessions === 2 && f2.stale === true, JSON.stringify(f2));
  check('TIN: ref_date ikut dikirim untuk ditulis di UI', f2.ref_date === '2026-10-19', String(f2.ref_date));

  const fx = fresh.seriesFreshness(ctx, '2026-08-01');
  check('last di luar jendela kalender -> lag_capped=true (bukan lag palsu yang kecil)', fx.lag_capped === true && fx.lag_sessions === sessions.length, JSON.stringify(fx));

  const fn = fresh.seriesFreshness(ctx, null);
  check('tanpa bar -> stale=null (no_series, bukan basi)', fn.stale === null && fn.lag_sessions === null, JSON.stringify(fn));

  const noCtx = fresh.seriesFreshness(null, '2026-10-15');
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
    fresh.seriesFreshness(ctx, fresh.lastRegularBarDate(weekendRows)).lag_sessions === 1,
    JSON.stringify(fresh.seriesFreshness(ctx, fresh.lastRegularBarDate(weekendRows))));

  // ── [2] penanda tidak menempel ──────────────────────────────────────────
  console.log('\n[2] penanda hilang sendiri saat bar seri datang (= DoD-3)');
  const ctxLater = { ref_date: '2026-10-20', ref_source: 'test', sessions: sessions.concat(['2026-10-20']), window_from: sessions[0] };
  const before = fresh.seriesFreshness(ctxLater, '2026-10-15');
  const after = fresh.seriesFreshness(ctxLater, '2026-10-20'); // TIN akhirnya terbit
  check('sebelum terbit: 15 Okt vs sesi 20 Okt -> masih basi', before.stale === true && before.lag_sessions === 3, JSON.stringify(before));
  check('setelah bar 20 Okt masuk -> stale=false tanpa intervensi', after.stale === false && after.lag_sessions === 0, JSON.stringify(after));

  // ── [3] live DB vs endpoint ─────────────────────────────────────────────
  console.log('\n[3] endpoint live vs hitungan SQL independen');
  const railMax = (db.prepare(`SELECT MAX(trade_date) d FROM custom_ohlc WHERE ${fresh.REGULAR_SESSION}`).get() || {}).d || '';
  const idxMax = (db.prepare('SELECT MAX(trade_date) d FROM idx_daily').get() || {}).d || '';
  const ref = railMax > idxMax ? railMax : idxMax;
  const lagSql = db.prepare('SELECT COUNT(DISTINCT trade_date) c FROM idx_daily WHERE trade_date > ? AND trade_date <= ?');
  const lastSql = db.prepare(`SELECT MAX(trade_date) d FROM custom_ohlc WHERE code=? AND ${fresh.REGULAR_SESSION}`);

  return Promise.all([getJson('/api/commodities'), getJson('/api/idx/market-regime'), getJson('/api/market/overview')]).then(([cmd, mr, ov]) => {
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
      if (s.stale == null) { mismatched.push(`${s.code}: stale null padahal ada bar (${s.date})`); continue; }
      const expectLast = (lastSql.get(s.code) || {}).d || '';
      const expectLag = (lagSql.get(s.date, ref) || {}).c;
      if (String(s.date) !== String(expectLast)) mismatched.push(`${s.code}: date ${s.date} != DB ${expectLast}`);
      if (Number(s.lag_sessions) !== Number(expectLag)) mismatched.push(`${s.code}: lag ${s.lag_sessions} != SQL ${expectLag}`);
      if (Boolean(s.stale) !== (Number(expectLag) >= fresh.STALE_LAG_SESSIONS)) mismatched.push(`${s.code}: stale ${s.stale} tidak konsisten dengan lag ${expectLag}`);
    }
    check('setiap seri: date + lag_sessions + stale konsisten dengan DB', mismatched.length === 0, mismatched.join(' | '));

    // Bukti per-seri (bukan ambang global): dua seri di rail yang sama bisa berbeda hasil.
    // Asersinya TIDAK mengunci tanggal pengamatan — kalau TIN akhirnya terbit (DoD-3),
    // test ini tetap hijau karena yang diuji hubungan stale==(lag>=ambang), bukan "TIN basi selamanya".
    const byCode = {};
    for (const s of cmdSeries.concat(mrSeries)) byCode[s.code] = s;
    const tin = byCode['TIN'], nickel = byCode['NICKEL'], coal = byCode['COAL'];
    const lagOf = s => Number((lagSql.get(s.date, ref) || {}).c);
    check('TIN: stale == (lag DB >= ambang), tanpa tanggal yang di-hardcode',
      !!tin && Boolean(tin.stale) === (lagOf(tin) >= fresh.STALE_LAG_SESSIONS), JSON.stringify(tin || null));
    check('NICKEL (rail & jam tarik sama) segar: lag 0, stale false',
      !!nickel && nickel.stale === false && lagOf(nickel) === 0, JSON.stringify(nickel || null));
    check('COAL: stale == (lag DB >= ambang)',
      !!coal && Boolean(coal.stale) === (lagOf(coal) >= fresh.STALE_LAG_SESSIONS), JSON.stringify(coal || null));
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
      if (Boolean(i.stale) !== (expectLag >= fresh.STALE_LAG_SESSIONS)) ovMismatch.push(`${i.code}: stale ${i.stale} vs lag ${expectLag}`);
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

    // ── ringkasan ─────────────────────────────────────────────────────────
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
