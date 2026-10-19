#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Uji regresi untuk kanban t_b00757f3:
//
//  1. issued_history.issue_date harus ISO YYYY-MM-DD yang bisa diurutkan
//     (MIN < MAX, urutan leksikografis == urutan kronologis). Sebelum perbaikan,
//     kolomnya campuran teks DD-MMM-YYYY: MIN('01-APR-2024') > MAX('31-OCT-2023').
//  2. /api/v1/idx/freshness harus memberi as_of + lag_days untuk holdings,
//     balance_position, issued_history (sebelumnya ketiganya kosong dan masuk
//     daftar `missing`), dan as_of financial_ratios = periode bercakupan terluas.
//  3. Helper normalisasi tanggal tidak lagi memotong nama bulan yang mengandung
//     huruf "T" (OCT/SEPT) — bug nyata yang membuat 67 baris gagal dinormalisasi.
//
// Jalankan di dalam container (DB tidak ada di host):
//   docker exec -w /app banyu-langit node server/scripts/check-issued-history-iso.js
// Opsi:
//   --write-test   sekaligus menguji jalur impor POST /api/idx/ksei/import dengan
//                  snapshot sentinel 1999-01-31 + kode ZZTEST, lalu membersihkannya
//                  dan membuktikan jumlah baris snapshot nyata tidak berubah.
// Env: BL_URL (default http://127.0.0.1:3000 — port di dalam container)
// Exit code 0 = lulus, 1 = ada asersi yang gagal.
// ═══════════════════════════════════════════════════════════════════════════

const Database = require('/app/node_modules/better-sqlite3');
const { toIsoDate, isIsoDate } = require('/app/server/utils/iso-date');

const BL = process.env.BL_URL || 'http://127.0.0.1:3000';
const WRITE_TEST = process.argv.includes('--write-test');
const SENTINEL_SNAP = '1999-01-31';
const SENTINEL_CODE = 'ZZTEST';

const db = new Database('/app/data/trading.db', WRITE_TEST ? {} : { readonly: true });
const failures = [];
let pass = 0;

function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

async function main() {
  // ── 1. unit: helper normalisasi ─────────────────────────────────────────
  console.log('\n[1] utils/iso-date.toIsoDate — format yang dipakai KSEI/BEI + bug huruf T');
  const cases = [
    ['01-OCT-1993', '1993-10-01', 'OCT mengandung T: pemotongan buta menghasilkan 01-OC'],
    ['31-OCT-2023', '2023-10-31', ''],
    ['01-APR-2024', '2024-04-01', ''],
    ['01-SEPT-2024', '2024-09-01', 'singkatan 4 huruf'],
    ['1-MAR-2020', '2020-03-01', 'hari tanpa leading zero'],
    ['2026-09-30', '2026-09-30', 'sudah ISO'],
    ['2026-09-30T00:00:00Z', '2026-09-30', 'datetime ISO'],
    ['30/09/2026', '2026-09-30', 'DD/MM/YYYY'],
    ['', '', 'kosong -> kosong'],
    ['bukan-tanggal', '', 'teks tak dikenal jangan ditebak'],
    ['31-FEB-2024', '', 'kalender tidak nyata'],
  ];
  for (const [input, want, why] of cases) {
    const got = toIsoDate(input);
    check('toIsoDate(' + JSON.stringify(input) + ') = ' + JSON.stringify(want), got === want,
      'got ' + JSON.stringify(got) + (why ? ' (' + why + ')' : ''));
  }

  // ── 2. kolom issued_history bersih + terurut ────────────────────────────
  console.log('\n[2] issued_history.issue_date — ISO, terurut, utuh');
  const total = db.prepare('SELECT COUNT(*) n FROM issued_history').get().n;
  const dirty = db.prepare("SELECT COUNT(*) n FROM issued_history WHERE issue_date IS NOT NULL AND issue_date <> '' AND issue_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'").get().n;
  check('tidak ada issue_date non-ISO', dirty === 0, dirty + ' baris masih non-ISO');

  const distinct = db.prepare("SELECT DISTINCT issue_date d FROM issued_history WHERE issue_date <> ''").all().map(r => r.d);
  const invalid = distinct.filter(d => !isIsoDate(d));
  check('setiap nilai distinct adalah tanggal kalender nyata', invalid.length === 0, invalid.slice(0, 5).join(', '));

  const mm = db.prepare('SELECT MIN(issue_date) mn, MAX(issue_date) mx, COUNT(*) n FROM issued_history').get();
  check('MIN(issue_date) < MAX(issue_date)', mm.mn < mm.mx, 'min=' + mm.mn + ' max=' + mm.mx);

  const lex = distinct.slice().sort();
  const chrono = distinct.slice().sort((a, b) => Date.parse(a) - Date.parse(b));
  check('urutan leksikografis == urutan kronologis', lex.join('|') === chrono.join('|'),
    'contoh beda: ' + lex.filter((v, i) => v !== chrono[i]).slice(0, 3).join(','));
  check('kolom tidak kosong (regresi "tabel tidak sengaja dikosongkan")', total > 0, 'rows=' + total);
  const isoRows = db.prepare("SELECT COUNT(*) n FROM issued_history WHERE issue_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'").get().n;
  check('seluruh baris berformat ISO', isoRows === total, isoRows + '/' + total);

  // ── 3. rail freshness ───────────────────────────────────────────────────
  console.log('\n[3] GET /api/v1/idx/freshness');
  const expectHoldings = db.prepare('SELECT MAX(snapshot_date) m, COUNT(*) n FROM holdings').get();
  const expectBalance = db.prepare('SELECT MAX(snapshot_date) m, COUNT(*) n FROM balance_position').get();
  const modeRow = db.prepare(`SELECT p AS period, c AS codes FROM (
    SELECT p AS p, COUNT(*) AS c FROM (SELECT code, MAX(period) AS p FROM financial_ratios GROUP BY code)
    GROUP BY p) ORDER BY c DESC, period DESC LIMIT 1`).get();
  const rawRatio = db.prepare('SELECT MAX(period) p FROM financial_ratios').get().p;
  const rawRatioRows = db.prepare('SELECT COUNT(*) n FROM financial_ratios WHERE period=?').get(rawRatio).n;

  let fr = null;
  try {
    const res = await fetch(BL + '/api/v1/idx/freshness', { signal: AbortSignal.timeout(20000) });
    fr = await res.json();
    check('HTTP 200 + ok=true', res.status === 200 && fr.ok === true, 'status=' + res.status);
  } catch (e) {
    check('freshness bisa dihubungi di ' + BL, false, e.message);
  }

  if (fr) {
    const row = t => (fr.rows || []).find(r => r.table === t);
    for (const [t, want] of [['holdings', expectHoldings.m], ['balance_position', expectBalance.m]]) {
      const r = row(t);
      check(t + ': as_of = MAX(snapshot_date) = ' + want, !!r && r.as_of === want,
        r ? ('got ' + JSON.stringify(r.as_of) + ' date_col=' + r.date_col) : 'tabel tidak ada di rows[]');
      check(t + ': lag_days terisi + is_month_complete boolean',
        !!r && Number.isFinite(r.lag_days) && typeof r.is_month_complete === 'boolean',
        r ? ('lag_days=' + JSON.stringify(r.lag_days)) : '');
      check(t + ': tidak ada di missing[]', !(fr.missing || []).includes(t));
    }

    const rih = row('issued_history');
    check('issued_history: as_of = MAX(issue_date) = ' + mm.mx, !!rih && rih.as_of === mm.mx,
      rih ? ('got ' + JSON.stringify(rih.as_of)) : 'tabel tidak ada di rows[]');
    check('issued_history: lag_days terisi', !!rih && Number.isFinite(rih.lag_days), rih ? ('lag_days=' + JSON.stringify(rih.lag_days)) : '');
    check('issued_history: tidak ada di missing[]', !(fr.missing || []).includes('issued_history'));
    check('issued_history: as_of_raw tetap menampilkan nilai mentah kolom',
      !!rih && typeof rih.as_of_raw === 'string' && rih.as_of_raw !== '', rih ? JSON.stringify(rih.as_of_raw) : '');

    const rfr = row('financial_ratios');
    check('financial_ratios: as_of = mode(MAX(period) per kode) = ' + (modeRow && modeRow.period),
      !!rfr && rfr.as_of === (modeRow && modeRow.period),
      rfr ? ('got ' + JSON.stringify(rfr.as_of) + ' raw=' + JSON.stringify(rfr.as_of_raw)) : 'tabel tidak ada di rows[]');
    check('financial_ratios: as_of bukan periode kerangka ' + rawRatio + ' (' + rawRatioRows + ' baris)',
      !!rfr && (modeRow.period === rawRatio || rfr.as_of !== rawRatio));
    check('financial_ratios: as_of_raw tetap = MAX(period) mentah', !!rfr && rfr.as_of_raw === rawRatio, rfr ? JSON.stringify(rfr.as_of_raw) : '');
    check('financial_ratios: as_of_rows = jumlah baris periode itu',
      !!rfr && rfr.as_of_rows === db.prepare('SELECT COUNT(*) n FROM financial_ratios WHERE period=?').get(rfr.as_of).n,
      rfr ? ('as_of_rows=' + rfr.as_of_rows) : '');
  }

  // ── 4. opsional: jalur impor menulis ISO ────────────────────────────────
  if (WRITE_TEST) {
    console.log('\n[4] --write-test: POST /api/idx/ksei/import menulis issue_date ISO');
    const counts = () => ({
      ih: db.prepare('SELECT COUNT(*) n FROM issued_history').get().n,
      h: db.prepare('SELECT COUNT(*) n FROM holdings').get().n,
      bp: db.prepare('SELECT COUNT(*) n FROM balance_position').get().n,
    });
    const before = counts();
    const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    try {
      const res = await fetch(BL + '/api/idx/ksei/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot_date: SENTINEL_SNAP,
          balance: [{ code: SENTINEL_CODE, sec_num: 900, price: 1000, local: nine, foreign: nine }],
          master: [{ code: SENTINEL_CODE, issuer: 'ZZ TEST', shares: 1000000, listing_date: '01-OCT-1993' }],
          force: true,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await res.json();
      check('impor sentinel dijawab ok', res.status === 200 && body.ok === true, JSON.stringify(body).slice(0, 200));
      const row = db.prepare('SELECT issue_date FROM issued_history WHERE code=?').get(SENTINEL_CODE);
      check('listing_date 01-OCT-1993 tersimpan sebagai 1993-10-01', !!row && row.issue_date === '1993-10-01', row ? row.issue_date : 'baris tidak ada');
    } catch (e) {
      check('jalur impor bisa diuji', false, e.message);
    } finally {
      db.prepare('DELETE FROM issued_history WHERE code=?').run(SENTINEL_CODE);
      db.prepare('DELETE FROM holdings WHERE snapshot_date=?').run(SENTINEL_SNAP);
      db.prepare('DELETE FROM balance_position WHERE snapshot_date=?').run(SENTINEL_SNAP);
      const after = counts();
      check('bersih: issued_history kembali ke ' + before.ih, after.ih === before.ih, 'got ' + after.ih);
      check('bersih: holdings kembali ke ' + before.h, after.h === before.h, 'got ' + after.h);
      check('bersih: balance_position kembali ke ' + before.bp, after.bp === before.bp, 'got ' + after.bp);
    }
  }
}

main().then(() => {
  db.close();
  console.log('\n' + (failures.length ? 'GAGAL ' + failures.length + ' asersi' : 'LULUS ' + pass + ' asersi'));
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = failures.length ? 1 : 0;
}).catch(e => {
  try { db.close(); } catch (_) {}
  console.error('ERROR tak terduga:', e && e.stack || e);
  process.exitCode = 1;
});
