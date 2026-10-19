#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Penjaga PENJADWAL rail pasar (kanban t_ff3ca45f).
//
// Pertanyaan yang dijawab skrip ini HANYA satu:
//   "Pada hari bursa ini, apakah penjadwal rail benar-benar menarik sesuatu?"
//
// Ini BUKAN pengganti sinyal `ctx.pipeline` (kartu t_243d21ae / t_c6c01360). Bedanya:
//   - `ctx.pipeline`  menjawab "data yang seharusnya ada sudah ada?" (dari dua frontier)
//   - skrip ini       menjawab "mesin penariknya hidup?" (dari baris custom_pull_log)
// Kegagalan yang ditangkap di sini adalah kegagalan yang TIDAK terlihat oleh frontier:
// timer dimatikan, unit gagal start, mesin mati malam itu, atau kalender salah ditembak.
// Pada semua kasus itu frontier memang tidak maju dan `ref_date` ikut beku, sehingga
// pembanding kesegaran bisa ikut diam.
//
// Sumber kebenaran = `custom_pull_log` (diisi jalur tulis server, bukan skrip host, jadi
// ia tidak bisa "mengaku jalan" sendiri). Zona waktu: `pulled_at` disimpan UTC
// (strftime('%Y-%m-%dT%H:%M:%SZ','now')), sedangkan "hari bursa" adalah hari WIB — jadi
// pengelompokan memakai date(pulled_at, '+7 hours'), BUKAN substr(pulled_at,1,10).
// Tanpa konversi itu, run pukul 00:00-06:59 WIB akan dihitung sebagai "kemarin".
//
// Aturan sesi = SALINAN dari `market-rails/scripts/is_session.py` (kalender
// `server/data/idx-sessions.json`). Dua salinan disengaja: yang satu berjalan di host
// (Bash/Python) dan yang satu di dalam container (Node, tanpa akses ke market-rails).
// Kalau aturannya berubah, ubah KEDUANYA — jangan menambah salinan ketiga.
//
// Kode keluar:
//   0  = sehat: hari bursa & ada tarikan rail, atau hari non-bursa (tidak diharapkan)
//   1  = hari bursa TAPI tidak ada satu pun baris tarikan rail  -> penjadwal tidak jalan
//   3  = ada baris tarikan, tetapi tidak ada satu pun ber-status 'ok' -> rail jalan, gagal
//   2  = tidak bisa menilai (argumen/DB/kalender)
//
// Pakai (di dalam container):
//   docker exec -w /app banyu-langit node server/scripts/check-rail-liveness.js
//   ... --date 2026-10-24      # nilai tanggal lain (uji, tanpa menulis apa pun)
//   ... --json                 # keluaran mesin
// Hanya membaca DB (readonly) — tidak menulis satu baris pun.
// ═══════════════════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const Database = require('/app/node_modules/better-sqlite3');

const DB_PATH = process.env.BL_DB || '/app/data/trading.db';
const CALENDAR = process.env.RAIL_CALENDAR || path.join(__dirname, '..', 'data', 'idx-sessions.json');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const WANT_JSON = process.argv.indexOf('--json') !== -1;
// --codes-ok: cetak HANYA kode yang sudah punya tarikan 'ok' pada tanggal itu (satu per baris,
// tidak ada prosa) — dipakai market-rails/scripts/daily-rails.sh untuk menghitung subset retry.
// Kontraknya mesin: stdout bersih, exit 0 walau kosong; kegagalan DB tetap exit 2.
const CODES_ONLY = process.argv.indexOf('--codes-ok') !== -1;
const DATE_ARG = arg('date', null);

// WIB selalu UTC+7 (tanpa DST) — jangan bergantung pada TZ proses container (container UTC).
function todayWib() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function loadCalendar(file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return { ok: false, why: e.code === 'ENOENT' ? 'tidak-ada' : String(e.message).slice(0, 80) }; }
  if (!raw || typeof raw !== 'object') return { ok: false, why: 'bukan-objek' };
  const norm = (items) => new Set((Array.isArray(items) ? items : [])
    .map(it => (typeof it === 'string' ? it : (it && (it.date || it.trade_date)) || ''))
    .map(s => String(s).slice(0, 10))
    .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)));
  const holidays = norm(raw.holidays);
  const extra = norm(raw.extra_sessions);
  if (!holidays.size && !extra.size) return { ok: false, why: 'tanpa-daftar-libur' };
  return { ok: true, holidays, extra, valid_through: raw.valid_through ? String(raw.valid_through).slice(0, 10) : null };
}

function sessionOf(date, file) {
  const day = new Date(date + 'T00:00:00Z');
  const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
  const cal = loadCalendar(file);
  if (!cal.ok) {
    return { session: !weekend, basis: 'weekday_fallback', reason: 'kalender-' + cal.why,
             warn: 'kalender sesi ' + cal.why + ' -> hanya aturan hari kerja; libur bursa di tengah minggu tidak dikenali' };
  }
  if (cal.valid_through && date > cal.valid_through) {
    return { session: !weekend, basis: 'calendar_expired', reason: 'valid_through=' + cal.valid_through,
             warn: 'kalender kedaluwarsa (valid_through=' + cal.valid_through + ') -> hanya aturan hari kerja' };
  }
  if (cal.extra.has(date)) return { session: true, basis: 'calendar', reason: 'extra_session' };
  if (cal.holidays.has(date)) return { session: false, basis: 'calendar', reason: 'libur_bursa' };
  return { session: !weekend, basis: 'calendar', reason: weekend ? 'akhir_pekan' : 'hari_bursa' };
}

function main() {
  const date = DATE_ARG && DATE_ARG !== true ? String(DATE_ARG).slice(0, 10) : todayWib();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('GAGAL: --date harus YYYY-MM-DD');
    return 2;
  }
  const s = sessionOf(date, CALENDAR);

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.error('GAGAL buka DB readonly: ' + e.message);
    return 2;
  }

  // "Rail investing" = baris yang sumbernya pin investing (rail komoditas + kurva SUN).
  // Derived table tidak dipakai: SQL-nya harus jelas di sini, bukan di lapisan lain.
  const WIB_DAY = "date(substr(pulled_at,1,19),'+7 hours')";
  let rail, all, recent;
  try {
    rail = db.prepare(
      `SELECT COUNT(*) pulls, COUNT(DISTINCT code) codes,
              SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) ok_pulls,
              SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) error_pulls,
              SUM(CASE WHEN status='no_data' THEN 1 ELSE 0 END) no_data_pulls,
              MIN(pulled_at) first_pull, MAX(pulled_at) last_pull,
              GROUP_CONCAT(DISTINCT endpoint) endpoints
         FROM custom_pull_log WHERE ${WIB_DAY}=? AND source LIKE 'investing/%'`).get(date);
    all = db.prepare(
      `SELECT COUNT(*) pulls, COUNT(DISTINCT code) codes FROM custom_pull_log WHERE ${WIB_DAY}=?`).get(date);
    recent = db.prepare(
      `SELECT ${WIB_DAY} AS day, COUNT(*) pulls, COUNT(DISTINCT code) codes
         FROM custom_pull_log GROUP BY 1 ORDER BY 1 DESC LIMIT 8`).all();
  } catch (e) {
    console.error('GAGAL query custom_pull_log: ' + e.message);
    db.close();
    return 2;
  }

  // Mode mesin untuk penjadwal: daftar kode yang sudah `ok` pada tanggal itu.
  if (CODES_ONLY) {
    try {
      const rows = db.prepare(
        `SELECT DISTINCT code FROM custom_pull_log
          WHERE ${WIB_DAY}=? AND source LIKE 'investing/%' AND status='ok'
          ORDER BY code`).all(date);
      db.close();
      for (const r of rows) console.log(r.code);
      return 0;
    } catch (e) {
      console.error('GAGAL query kode ok: ' + e.message);
      db.close();
      return 2;
    }
  }
  db.close();

  const railPulls = Number(rail.pulls || 0);
  const railOk = Number(rail.ok_pulls || 0);
  let code = 0, verdict, detail;
  if (!s.session) {
    verdict = 'not_expected';
    detail = 'hari non-bursa (' + s.reason + ') — penjadwal tidak diharapkan menarik';
  } else if (railPulls === 0) {
    verdict = 'scheduler_silent';
    detail = 'HARI BURSA tetapi 0 baris tarikan rail investing di ' + date + ' WIB'
      + (Number(all.pulls || 0) ? ' (ada ' + all.pulls + ' baris sumber lain, jadi hanya rail ini yang diam)' : '');
    code = 1;
  } else if (railOk === 0) {
    verdict = 'rail_failed';
    detail = railPulls + ' baris tarikan ada tetapi 0 ber-status ok (error=' + Number(rail.error_pulls || 0)
      + ', no_data=' + Number(rail.no_data_pulls || 0) + ')';
    code = 3;
  } else {
    verdict = 'ok';
    detail = railOk + '/' + railPulls + ' tarikan ok, ' + Number(rail.codes) + ' kode';
  }

  if (WANT_JSON) {
    console.log(JSON.stringify({
      date_wib: date, verdict, exit_code: code, detail,
      session: { is_session: s.session, basis: s.basis, reason: s.reason, warn: s.warn || null },
      calendar: CALENDAR,
      rail: { pulls: railPulls, ok_pulls: railOk, codes: Number(rail.codes || 0),
              first_pull_utc: rail.first_pull || null, last_pull_utc: rail.last_pull || null,
              endpoints: rail.endpoints || null },
      all_sources: { pulls: Number(all.pulls || 0), codes: Number(all.codes || 0) },
      recent_days_wib: recent,
    }, null, 1));
  } else {
    console.log('rail-liveness date=' + date + ' session=' + (s.session ? 'ya' : 'TIDAK')
      + ' basis=' + s.basis + ' reason=' + s.reason);
    console.log('  verdict=' + verdict + ' exit=' + code + ' — ' + detail);
    if (railPulls) {
      console.log('  rail investing: pulls=' + railPulls + ' ok=' + railOk + ' codes=' + Number(rail.codes)
        + ' window=' + rail.first_pull + '..' + rail.last_pull);
    }
    console.log('  semua sumber hari itu: pulls=' + Number(all.pulls || 0) + ' codes=' + Number(all.codes || 0));
    console.log('  riwayat (WIB, terbaru dulu): ' + recent.map(r => r.day + '=' + r.pulls + '/' + r.codes + 'kode').join(' '));
    if (s.warn) console.log('  WARN ' + s.warn);
  }
  return code;
}

process.exitCode = main();
