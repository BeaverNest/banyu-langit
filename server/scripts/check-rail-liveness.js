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
// JENDELA TARIK (`--window-start`, bawaan 18:30 WIB / env RAIL_WINDOW_START)
//   Hanya baris yang ditarik PADA ATAU SETELAH jendela tarik yang dihitung sebagai bukti
//   "penjadwal jalan hari ini". Alasannya terukur: pada 2026-10-20 tarikan 00:57-01:00
//   menulis 16 baris `ok` yang SEMUANYA ber-`source_frontier_date` 2026-10-19 (sumber
//   belum menerbitkan bar hari itu). Baris pra-jendela SAH sebagai telemetri, tetapi bila
//   dipakai sebagai bukti ia menyembunyikan persis kegagalan yang penjaga ini cari:
//   penjadwal 19:00/19:40 tidak jalan padahal "ada baris hari ini".
//   Ambang yang sama dipakai `market-rails/scripts/daily-rails.sh` untuk dedupe, jadi
//   penjadwal dan penjaga tidak bisa berbeda pendapat soal "hari D sudah ditarik?".
//   Bila tanggal yang dinilai = HARI INI dan jam WIB masih < jendela tarik, verdict-nya
//   `not_yet` (rc 0): belum ada yang bisa dinilai, dan penjaga yang berteriak sebelum
//   jadwalnya tiba akan diabaikan orang. Baris pra-jendela tetap dilaporkan (`early_pulls`).
//
// CAKUPAN PER-RAIL (`--codes` / `--codes-file`) — WAJIB untuk kesimpulan
//   Ada DUA rail yang sama-sama menulis dengan sumber `investing/<pin>`: rail komoditas
//   (`investing_push_bl.py`, 16 seri) dan rail kurva SUN (`bi_curve_push_bl.py`, 11 tenor
//   ID1M..ID30Y). Filter lama `source LIKE 'investing/%'` tidak bisa membedakan keduanya,
//   sehingga sejak rail SUN dijadwalkan (kanban t_b2c644a0) rail SUN yang jalan akan
//   MEMENUHI syarat "ada tarikan rail hari ini" untuk penjadwal komoditas yang mati —
//   penjaga ini berhenti membuktikan apa pun.
//   Karena itu cakupan dinyatakan sebagai DAFTAR KODE rail (bukan pola sumber): penjadwal
//   meneruskan kode rail-nya (`--codes "$(rail --list-codes)"`, lihat scripts/daily-rails.sh)
//   dan pembungkus penjaga mengulang per rail (scripts/rail-liveness.sh).
//   Tanpa `--codes`, skrip ini tetap jalan untuk DIAGNOSA tetapi menyebut dirinya
//   `all-investing` + `mixed_rails: true` di keluaran teks maupun JSON — jawabannya TIDAK
//   memisahkan rail, dan tidak boleh dipakai untuk menyimpulkan "penjadwal X jalan".
//
// Kode keluar:
//   0  = sehat (hari bursa & ada tarikan dalam jendela), hari non-bursa, atau `not_yet`
//        (jam WIB belum melewati jendela tarik — belum ada yang dinilai)
//   1  = hari bursa TAPI tidak ada satu pun baris tarikan rail dalam jendela tarik
//        -> penjadwal tidak jalan
//   3  = ada baris tarikan, tetapi tidak ada satu pun ber-status 'ok' -> rail jalan, gagal
//   2  = tidak bisa menilai (argumen/DB/kalender)
//
// Pakai (di dalam container):
//   docker exec -w /app banyu-langit node server/scripts/check-rail-liveness.js
//   ... --date 2026-10-24      # nilai tanggal lain (uji, tanpa menulis apa pun)
//   ... --window-start 00:00   # hitung juga tarikan pra-jendela (uji/diagnosa)
//   ... --codes COAL,WTI       # cakupan PER RAIL (wajib untuk kesimpulan; lihat bawah)
//   ... --codes-file /tmp/k    # daftar kode dari berkas (satu per baris / dipisah koma)
//   ... --codes COAL,WTI --codes-ok   # kode rail ini yang sudah `ok` sejak jendela tarik
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
// Cakupan per-rail = daftar kode (lihat kepala berkas). Divalidasi ketat karena nilainya
// masuk ke teks SQL; kode yang tidak valid membuat skrip berhenti (rc 2), bukan diabaikan.
const CODES_ARG = arg('codes', null);
const CODES_FILE = arg('codes-file', null);
const CODE_RE = /^[A-Za-z0-9_]{1,32}$/;

function readCodes() {
  if (CODES_ARG === true) return { error: '--codes butuh daftar kode (mis. --codes COAL,WTI)' };
  if (CODES_FILE === true) return { error: '--codes-file butuh path' };
  const out = [];
  const push = (v) => String(v || '').split(/[,\s]+/).forEach(t => { if (t) out.push(t.toUpperCase()); });
  if (typeof CODES_ARG === 'string' && CODES_ARG.trim()) push(CODES_ARG);
  if (typeof CODES_FILE === 'string') {
    let raw;
    try { raw = fs.readFileSync(CODES_FILE, 'utf8'); }
    catch (e) { return { error: 'codes-file tidak terbaca: ' + e.message }; }
    push(raw);
  }
  const uniq = [...new Set(out)];
  const bad = uniq.filter(c => !CODE_RE.test(c));
  if (bad.length) return { error: 'kode tidak valid: ' + bad.slice(0, 5).join(',') };
  return { codes: uniq };
}

/** Cakupan query: daftar kode (per-rail) atau seluruh `investing/%` (diagnosa, campur rail). */
function scopeOf() {
  const r = readCodes();
  if (r.error) return { error: r.error };
  const codes = r.codes || [];
  if (!codes.length) return { mode: 'all-investing', codes: [], mixed: true, sql: '' };
  const list = codes.map(c => "'" + c + "'").join(',');
  return { mode: 'codes', codes, mixed: false, sql: ' AND code IN (' + list + ')' };
}
// Ambang jendela tarik — HARUS sama dengan market-rails/scripts/daily-rails.sh (env yang sama).
const WINDOW_START = arg('window-start', process.env.RAIL_WINDOW_START || '18:30');
const WINDOW_OK = typeof WINDOW_START === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(WINDOW_START);

// WIB selalu UTC+7 (tanpa DST) — jangan bergantung pada TZ proses container (container UTC).
function todayWib() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function nowWibHm() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(11, 16);
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
  if (!WINDOW_OK) {
    console.error('GAGAL: --window-start/RAIL_WINDOW_START harus HH:MM (00:00-23:59), diterima: ' + WINDOW_START);
    return 2;
  }
  const SCOPE = scopeOf();
  if (SCOPE.error) {
    console.error('GAGAL: ' + SCOPE.error);
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

  // "Rail investing" = baris yang sumbernya pin investing, DIBATASI ke kode rail pemanggil
  // bila `--codes` diberikan (dua rail berbagi pola sumber yang sama — lihat kepala berkas).
  // Derived table tidak dipakai: SQL-nya harus jelas di sini, bukan di lapisan lain.
  const WIB_TS = "datetime(substr(pulled_at,1,19),'+7 hours')";
  const WIB_DAY = "date(" + WIB_TS + ")";
  const WIB_HM = "strftime('%H:%M'," + WIB_TS + ")";
  const SCOPE_SQL = SCOPE.sql;
  let rail, early, all, recent;
  try {
    rail = db.prepare(
      `SELECT COUNT(*) pulls, COUNT(DISTINCT code) codes,
              SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) ok_pulls,
              SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) error_pulls,
              SUM(CASE WHEN status='no_data' THEN 1 ELSE 0 END) no_data_pulls,
              MIN(pulled_at) first_pull, MAX(pulled_at) last_pull,
              GROUP_CONCAT(DISTINCT endpoint) endpoints
         FROM custom_pull_log WHERE ${WIB_DAY}=@date AND source LIKE 'investing/%'${SCOPE_SQL}
          AND ${WIB_HM} >= @since`).get({ date, since: WINDOW_START });
    // Baris pra-jendela dihitung terpisah: sah sebagai telemetri, TIDAK sah sebagai bukti
    // "hari ini ditarik" (lihat kepala berkas).
    early = db.prepare(
      `SELECT COUNT(*) pulls, SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) ok_pulls,
              MIN(pulled_at) first_pull, MAX(pulled_at) last_pull
         FROM custom_pull_log WHERE ${WIB_DAY}=@date AND source LIKE 'investing/%'${SCOPE_SQL}
          AND ${WIB_HM} < @since`).get({ date, since: WINDOW_START });
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

  // Mode mesin untuk penjadwal: daftar kode yang sudah `ok` pada tanggal itu SEJAK jendela
  // tarik — ambang yang sama dengan yang dipakai menilai kelengkapan hari.
  if (CODES_ONLY) {
    try {
      const rows = db.prepare(
        `SELECT DISTINCT code FROM custom_pull_log
          WHERE ${WIB_DAY}=@date AND source LIKE 'investing/%' AND status='ok'${SCOPE_SQL}
            AND ${WIB_HM} >= @since
          ORDER BY code`).all({ date, since: WINDOW_START });
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
  const earlyPulls = Number(early.pulls || 0);
  const earlyOk = Number(early.ok_pulls || 0);
  const nowHm = nowWibHm();
  const isToday = date === todayWib();
  const beforeWindow = isToday && nowHm < WINDOW_START;
  const earlyNote = earlyPulls
    ? ' [' + earlyPulls + ' tarikan pra-jendela (' + earlyOk + ' ok) diabaikan: ditarik sebelum ' + WINDOW_START + ' WIB]'
    : '';
  // Cakupan ikut DICETAK di setiap putusan: tanpa ini, jawaban "ok" dari cakupan campuran
  // mudah dibaca sebagai "rail X jalan" padahal yang terbukti cuma "ada rail yang jalan".
  const scopeNote = SCOPE.mode === 'codes'
    ? ' [cakupan: ' + SCOPE.codes.length + ' kode rail]'
    : ' [cakupan: SELURUH investing/% — TIDAK memisahkan rail; rail komoditas & rail SUN saling menutupi]';
  let code = 0, verdict, detail;
  if (!s.session) {
    verdict = 'not_expected';
    detail = 'hari non-bursa (' + s.reason + ') — penjadwal tidak diharapkan menarik' + earlyNote + scopeNote;
  } else if (beforeWindow) {
    verdict = 'not_yet';
    detail = 'jendela tarik belum tiba (sekarang ' + nowHm + ' WIB < ' + WINDOW_START + ' WIB) — belum ada yang dinilai' + earlyNote + scopeNote;
  } else if (railPulls === 0) {
    verdict = 'scheduler_silent';
    detail = 'HARI BURSA tetapi 0 baris tarikan rail dalam cakupan ini di ' + date + ' WIB sejak ' + WINDOW_START + ' WIB'
      + earlyNote + scopeNote
      + (Number(all.pulls || 0) ? ' (ada ' + all.pulls + ' baris sumber lain hari itu, jadi hanya cakupan ini yang diam)' : '');
    code = 1;
  } else if (railOk === 0) {
    verdict = 'rail_failed';
    detail = railPulls + ' baris tarikan ada tetapi 0 ber-status ok (error=' + Number(rail.error_pulls || 0)
      + ', no_data=' + Number(rail.no_data_pulls || 0) + ')' + earlyNote + scopeNote;
    code = 3;
  } else {
    verdict = 'ok';
    detail = railOk + '/' + railPulls + ' tarikan ok, ' + Number(rail.codes) + ' kode' + earlyNote + scopeNote;
  }

  if (WANT_JSON) {
    console.log(JSON.stringify({
      date_wib: date, verdict, exit_code: code, detail,
      window_start_wib: WINDOW_START, now_wib: nowHm,
      scope: { mode: SCOPE.mode, code_count: SCOPE.codes.length,
               codes: SCOPE.codes, mixed_rails: SCOPE.mixed },
      session: { is_session: s.session, basis: s.basis, reason: s.reason, warn: s.warn || null },
      calendar: CALENDAR,
      rail: { pulls: railPulls, ok_pulls: railOk, codes: Number(rail.codes || 0),
              first_pull_utc: rail.first_pull || null, last_pull_utc: rail.last_pull || null,
              endpoints: rail.endpoints || null,
              early_pulls: earlyPulls, early_ok: earlyOk,
              early_first_pull_utc: early.first_pull || null, early_last_pull_utc: early.last_pull || null },
      all_sources: { pulls: Number(all.pulls || 0), codes: Number(all.codes || 0) },
      recent_days_wib: recent,
    }, null, 1));
  } else {
    console.log('rail-liveness date=' + date + ' session=' + (s.session ? 'ya' : 'TIDAK')
      + ' basis=' + s.basis + ' reason=' + s.reason
      + ' window_start=' + WINDOW_START + ' now=' + nowHm
      + ' scope=' + (SCOPE.mode === 'codes' ? SCOPE.codes.length + 'kode' : 'ALL-investing'));
    if (SCOPE.mixed) {
      console.log('  CAKUPAN CAMPURAN: filter ini menghitung SEMUA investing/% — rail komoditas dan'
        + ' rail kurva SUN saling menutupi. Pakai --codes untuk putusan per rail.');
    }
    console.log('  verdict=' + verdict + ' exit=' + code + ' — ' + detail);
    if (railPulls) {
      console.log('  rail investing: pulls=' + railPulls + ' ok=' + railOk + ' codes=' + Number(rail.codes)
        + ' window=' + rail.first_pull + '..' + rail.last_pull);
    }
    if (earlyPulls) {
      console.log('  pra-jendela: pulls=' + earlyPulls + ' ok=' + earlyOk + ' window=' + early.first_pull + '..' + early.last_pull);
    }
    console.log('  semua sumber hari itu: pulls=' + Number(all.pulls || 0) + ' codes=' + Number(all.codes || 0));
    console.log('  riwayat (WIB, terbaru dulu): ' + recent.map(r => r.day + '=' + r.pulls + '/' + r.codes + 'kode').join(' '));
    if (s.warn) console.log('  WARN ' + s.warn);
  }
  return code;
}

process.exitCode = main();
