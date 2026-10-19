'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Kesegaran per seri (kanban t_61ccbdbe).
//
// Temuan 19 Okt 2026: investing berhenti menerbitkan bar timah (TIN / pin 959209)
// di 2026-10-15, sementara instrumen kembarnya di rail yang sama (NICKEL 959208,
// jam tarik identik) sudah sampai 2026-10-19 — diverifikasi ulang langsung dari
// sumber lewat CLI investing pada jam yang sama, jadi ini BUKAN kegagalan push
// kita. Retry tidak akan menolong; yang berhenti ada di hulu (vendor).
//
// Masalahnya ada di panel: kolom timah menampilkan 50.127 tanpa tanggal, jadi
// pembaca menyimpulkan timah tidak bergerak dua hari — padahal kita tidak punya
// datanya. Ini kelas yang sama dengan "data berhenti tapi terlihat segar".
// Karena itu kesegaran DIHITUNG, tidak dipersistensi: penanda harus hilang
// sendiri begitu bar seri datang, bukan menempel selamanya.
//
// ATURAN (satu implementasi untuk semua panel yang menampilkan harga seri):
//
//   ref_date  = sesi terakhir yang kita anggap "sekarang"
//               = max(frontier rail custom_ohlc sesi reguler, MAX(idx_daily.trade_date))
//   lag_sesi  = jumlah tanggal sesi di kalender IDX yang > last_date dan <= ref_date
//   ekspektasi= expected_lag_sessions PER SERI (custom_tickers), dideklarasikan manual
//   basi      = lag_sesi > expected_lag_sessions  (kelebihan minimum 1 sesi)
//
// Ambang global DIHAPUS pada kanban t_b234606a. Sebelumnya basi = lag >= 1 untuk semua seri;
// akibatnya seri yang sumbernya memang tidak menerbitkan bar tiap sesi (CPO/RSS3: nol bar
// Jumat) menyalak tiap Senin, sementara alarm yang benar (TIN berhenti di hulu) tenggelam di
// antara alarm palsu. Sekarang tiap seri membawa kebiasaannya sendiri: TIN=0 dan CPO=2,
// sehingga pada hari yang sama TIN tetap menyala dan CPO tidak.
//
// Deklarasi TIDAK di-update otomatis oleh pull. Expectation yang menyesuaikan diri sendiri
// adalah ratchet: pada hari seri berhenti, lag barunya jadi "normal baru" dan alarmnya mati
// justru saat dibutuhkan. Nilainya keputusan eksplisit di scripts/seed_expected_lag.js.
//
// Dua catatan yang menentukan hasilnya:
//
// - `ref_date` = max DUA frontier, sengaja. Kalau rail beku seluruhnya sementara
//   idx_daily jalan -> seluruh seri terbaca basi (memang begitu keadaannya).
//   Kalau rail sudah punya bar hari ini untuk sebagian seri sementara idx_daily
//   tertinggal -> seri yang tertinggal tetap terbaca basi. Mengambil hanya salah
//   satu frontier membuat salah satu dari dua kasus itu lolos tanpa penanda.
// - `lag_sesi` dihitung dari KALENDER SESI yang kita punya (distinct idx_daily),
//   bukan dari jumlah hari kerja. Menghitung hari kerja akan menuduh "1 sesi
//   tertinggal" setiap kali sehari sebelumnya libur bursa.
//
// KEADAAN 2 — "pipeline data berhenti" — DITANGANI di sini sejak kanban t_c6c01360
// (keputusan produk: t_243d21ae). Dulu lubang ini ditulis sebagai "tidak ditangani":
// kalau KEDUA frontier beku (`custom_ohlc` dan `idx_daily`), `ref_date` ikut beku, jadi
// `lag_sesi = 0` dan SEMUA panel mengaku 'fresh' untuk data yang bisa berhenti berhari-hari.
// Penutupnya BUKAN ambang baru per panel, melainkan pembanding eksternal di konteks:
//
//   ctx.pipeline = pipelineSignal({refDate, now, calendar})   <- lihat fungsi di bawah
//   calendar     = server/data/idx-sessions.json (SK libur bursa IDX; SENGAJA bukan
//                  turunan gap riwayat idx_daily — itu ratchet, sama dengan larangan
//                  expected_lag_sessions otomatis)
//   sesi D "seharusnya sudah ada" sejak D 21:00 WIB (sync idx_daily 19:00 + margin)
//
// Saat `pipeline.state ∈ {stopped, calendar_stale}` setiap seri turun ke state 'na' dengan
// `lag_basis='pipeline_stopped'|'calendar_stale'` dan `lag_sessions=null` — TIDAK BOLEH ada
// panel yang mencetak 'fresh', "basi", atau angka lag. Jangan menambal lubang ini lagi di
// tingkat panel (mis. kurva SUN): satu implementasi untuk semua surface ada di berkas ini.
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

// Kelebihan MINIMUM di atas ekspektasi per seri yang membuat alarm menyala
// (kartu t_b234606a). Satuannya "sesi di atas kebiasaan sumber", BUKAN "lag minimum".
// Namanya sengaja TIDAK dinaikkan jadi 2: menaikkan ambang global adalah gerakan yang
// justru dilarang kartu ini (TIN lag 2 harus tetap menyala).
const pullLog = require('./pull-log');

const MIN_EXCESS_SESSIONS = 1;
// Alias lama supaya pemanggil/uji lama tidak pecah — artinya sudah bergeser (lihat di atas).
const STALE_LAG_SESSIONS = MIN_EXCESS_SESSIONS;

// Jendela kalender sesi yang dibaca sekali per request (6ms dengan idx_daily_date).
// 120 sesi ~ 5,5 bulan; cukup jauh di belakang lag terbesar yang masuk akal.
const SESSION_LOOKBACK = 120;

const REGULAR_SESSION = "COALESCE(session,'regular')<>'weekend'";

/**
 * Tanggal bar SESI terakhir dari daftar baris {trade_date, close}.
 *
 * Ada karena aturan kesegaran tidak boleh bergantung pada klausa SQL pemanggil: sebagian
 * pemanggil mengirim bar Sabtu/Minggu juga (kolom generated `session` menandainya), dan
 * tanggal bar weekend bukan sesi bursa — memakainya sebagai `last_date` membuat seri
 * terbaca "tertinggal 1 sesi" hanya karena bar Minggu-nya yang terakhir, atau sebaliknya
 * menyembunyikan lag nyata. Urutannya tidak diandalkan: diambil yang terbesar.
 * Bentuk tanggal tak dikenal dibiarkan lewat (tidak dibuang) — jangan menebak.
 */
function lastRegularBarDate(rows) {
  let best = null, fallback = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = r && r.trade_date;
    if (!d) continue;
    if (!fallback || d > fallback) fallback = d;
    if (isWeekday(d) && (!best || d > best)) best = d;
  }
  return best || fallback;
}

function isWeekday(iso) {
  const d = new Date(String(iso) + 'T00:00:00Z');
  if (isNaN(d.getTime())) return true;                 // tak dikenal -> jangan buang baris
  const wd = d.getUTCDay();
  return wd !== 0 && wd !== 6;
}

// ═══════════════════════════════════════════════════════════════════════════
// Kalender sesi TERDEKLARASI + sinyal "pipeline data berhenti" (kanban t_c6c01360,
// keputusan t_243d21ae §D2/§D3). Semua fungsi di blok ini MURNI: `now` dan `calendar`
// disuntikkan, jadi bisa diuji tanpa DB dan tanpa menunggu jam dinding.
// ═══════════════════════════════════════════════════════════════════════════

// Berkas artefak manusia (di-commit), bukan hasil turunan DB. Lihat catatan di kepala berkas.
const CALENDAR_PATH = path.join(__dirname, '..', 'data', 'idx-sessions.json');
// Sesi tanggal D dianggap "seharusnya sudah ada" sejak D 21:00 WIB. Sync idx_daily = timer
// harian 19:00 WIB (idx-api-sync-month.timer), jadi 21:00 memberi margin 2 jam.
const PIPELINE_CUTOFF_WIB = '21:00';
const PIPELINE_CUTOFF_MINUTES = 21 * 60;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
// Ambang yang SUDAH DIPUTUSKAN (jangan diubah tanpa keputusan baru, §D3):
//   elapsed 1  -> 'lag1'  catatan netral, status seri TIDAK diturunkan
//   elapsed >=2-> 'stopped'  badge amber + semua seri 'na'
//   elapsed >=5-> 'stopped'  badge merah (outage > sepekan) — warna di UI, bukan state baru
const PIPELINE_STOPPED_SESSIONS = 2;
const PIPELINE_RED_SESSIONS = 5;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// generate daftar sesi dibatasi supaya `valid_through` yang salah ketik (mis. 9999-12-31)
// tidak membuat loop tahunan tanpa ujung.
const CALENDAR_MAX_DAYS = 2200;

// Cache kalender: dibaca dari disk sekali, dibaca ulang hanya bila mtime berubah. `./server`
// bind-mount + nodemon, jadi berkas ini bisa diperbarui tanpa deploy; jangan menahan salinan
// lama di memori sampai proses mati.
const CALENDAR_CACHE = { mtime_ms: null, calendar: null, path: null };

/**
 * Baca server/data/idx-sessions.json (atau `file` lain di harness).
 * Berkas tidak ada / JSON rusak -> null. Pemanggil memperlakukannya sebagai kalender TIDAK
 * TERPAKAI (pipeline 'calendar_stale' -> semua seri 'na'), bukan sebagai "segar".
 */
function loadCalendar(file) {
  const p = file || CALENDAR_PATH;
  try {
    const st = fs.statSync(p);
    if (CALENDAR_CACHE.path === p && CALENDAR_CACHE.mtime_ms === st.mtimeMs) return CALENDAR_CACHE.calendar;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    CALENDAR_CACHE.path = p;
    CALENDAR_CACHE.mtime_ms = st.mtimeMs;
    CALENDAR_CACHE.calendar = parsed;
    return parsed;
  } catch (e) {
    CALENDAR_CACHE.path = p;
    CALENDAR_CACHE.mtime_ms = null;
    CALENDAR_CACHE.calendar = null;
    return null;
  }
}

function toDate(value) {
  if (value == null) return new Date();
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Tanggal + menit-dalam-hari menurut jam dinding WIB (container berjalan UTC). */
function wibClock(date) {
  const u = new Date(date.getTime() + WIB_OFFSET_MS);
  return {
    date: u.toISOString().slice(0, 10),
    minutes: u.getUTCHours() * 60 + u.getUTCMinutes(),
  };
}

function cutoffPassed(sessionDate, clock) {
  if (!clock) return false;
  if (sessionDate < clock.date) return true;
  if (sessionDate > clock.date) return false;
  return clock.minutes >= PIPELINE_CUTOFF_MINUTES;
}

/**
 * Daftar sesi terdeklarasi: Senin-Jumat minus `holidays`, plus `extra_sessions`.
 * Rentang = 1 Jan tahun paling awal yang muncul di `holidays`/`valid_through` .. `valid_through`.
 *
 * `holidays` MENANG atas `extra_sessions` bila tanggal itu ada di keduanya: mengecilkan jumlah
 * sesi yang dituntut = arah yang aman (tidak menuduh pipeline berhenti karena kalender salah).
 *
 * @returns {string[]|null} null = kalender tidak terpakai (bentuk salah / rentang tak masuk akal)
 */
function calendarSessions(calendar) {
  const cal = calendar;
  if (!cal || !Array.isArray(cal.holidays) || !ISO_DATE_RE.test(String(cal.valid_through || ''))) return null;
  const holidays = new Set(cal.holidays.filter(h => ISO_DATE_RE.test(String(h))).map(String));
  const extras = new Set((Array.isArray(cal.extra_sessions) ? cal.extra_sessions : [])
    .filter(h => ISO_DATE_RE.test(String(h))).map(String));
  let y0 = Number(String(cal.valid_through).slice(0, 4));
  for (const h of holidays) {
    const y = Number(h.slice(0, 4));
    if (Number.isFinite(y) && y < y0) y0 = y;
  }
  const t0 = Date.UTC(y0, 0, 1);
  const t1 = Date.parse(String(cal.valid_through) + 'T00:00:00Z');
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0 || (t1 - t0) / 86400000 > CALENDAR_MAX_DAYS) return null;
  const out = [];
  for (let t = t0; t <= t1; t += 86400000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (holidays.has(iso)) continue;
    const wd = new Date(t).getUTCDay();
    const weekend = wd === 0 || wd === 6;
    if (weekend && !extras.has(iso)) continue;
    out.push(iso);
  }
  return out;
}

/**
 * Sinyal "pipeline data berhenti" — FUNGSI MURNI, lihat kepala berkas "KEADAAN 2".
 *
 * `elapsed_sessions` = jumlah sesi TERDEKLARASI di dalam (ref_date, now] yang cutoff 21:00 WIB-nya
 * sudah lewat, di-clamp >= 0 (ref_date boleh lebih baru dari kalender, mis. sesi khusus rail).
 * Yang dibandingkan adalah JAM DINDING vs KALENDER, bukan frontier kita sendiri: itulah bedanya
 * dengan `lag_sessions`, yang tidak bisa melihat frontier yang beku.
 *
 * Keadaan (urut, yang pertama cocok menang):
 *   kalender tidak terpakai / hari ini > valid_through -> 'calendar_stale' (fail-visible, TANPA alarm)
 *   tanpa ref_date                                     -> 'no_ref'
 *   elapsed >= 2                                       -> 'stopped'   (semua seri 'na')
 *   elapsed == 1                                       -> 'lag1'      (catatan netral)
 *   selain itu                                         -> 'ok'
 *
 * @param {{refDate?:string|null, now?:Date|string|null, calendar?:object|null, lastPull?:object|null}} opts
 * @returns {{state:string, elapsed_sessions:number|null, ref_date:string|null,
 *   last_expected_session:string|null, cutoff_wib:string,
 *   calendar:{version:*,valid_through:string|null,source_url:string|null}|null,
 *   last_pull:object|null, cause:string|null}}
 */
function pipelineSignal(opts) {
  const o = opts || {};
  const cal = o.calendar || null;
  const ref = o.refDate || null;
  const calendarMeta = cal
    ? { version: cal.version == null ? null : cal.version, valid_through: cal.valid_through || null, source_url: cal.source_url || null }
    : null;
  const out = {
    state: 'no_ref',
    elapsed_sessions: null,
    ref_date: ref,
    last_expected_session: null,
    cutoff_wib: PIPELINE_CUTOFF_WIB,
    calendar: calendarMeta,
    // METADATA NETRAL, bukan alarm: umur tarikan mengukur "kapan manusia terakhir menarik",
    // dan rail investing belum punya penjadwal (§D4). Isinya diisi buildContext.
    last_pull: o.lastPull || null,
    cause: null,
  };
  const now = toDate(o.now == null ? new Date() : o.now);
  if (!now) return out;                                    // `now` tak bisa dibaca -> tidak mengukur
  const clock = wibClock(now);

  const sessions = calendarSessions(cal);
  if (!sessions) { out.state = 'calendar_stale'; out.cause = 'calendar_stale'; return out; }

  let lastExpected = null;
  for (const s of sessions) if (cutoffPassed(s, clock)) lastExpected = s;
  out.last_expected_session = lastExpected;

  const expired = !calendarMeta || !calendarMeta.valid_through || clock.date > calendarMeta.valid_through;
  if (expired) { out.state = 'calendar_stale'; out.cause = 'calendar_stale'; return out; }
  if (!ref) { out.state = 'no_ref'; return out; }

  let elapsed = 0;
  for (const s of sessions) if (s > ref && cutoffPassed(s, clock)) elapsed++;
  out.elapsed_sessions = elapsed;
  out.state = elapsed >= PIPELINE_STOPPED_SESSIONS ? 'stopped' : (elapsed === 1 ? 'lag1' : 'ok');
  if (out.state === 'stopped') out.cause = 'pipeline_stopped';
  return out;
}

/**
 * Umur tarikan terakhir = metadata netral `ctx.pipeline.last_pull` (§D4).
 * SENGAJA tidak dipakai memicu alarm: rail investing belum punya penjadwal, jadi "2 hari tanpa
 * tarikan" bukan bukti data berhenti. Satu query, hanya MAX(pulled_at).
 */
function lastPullMeta(db, now) {
  let at = null;
  try { at = (db.prepare('SELECT MAX(pulled_at) AS t FROM custom_pull_log').get() || {}).t || null; }
  catch (e) { return { at: null, age_days: null, hint: 'manual' }; }
  let age = null;
  const t = at ? Date.parse(at) : NaN;
  if (!isNaN(t)) {
    const pulled = wibClock(new Date(t)).date;
    const today = wibClock(now).date;
    age = Math.max(0, Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(pulled + 'T00:00:00Z')) / 86400000));
  }
  return { at, age_days: age, hint: 'manual' };
}

/**
 * Bangun konteks kesegaran sekali per request (2 query + 1 kalender sesi).
 *
 * `opts.now` / `opts.calendar` / `opts.calendarFile` HANYA untuk pengujian & bukti (menyuntik
 * jam dinding / kalender tiruan tanpa menyentuh DB). Jalur produksi memanggilnya tanpa argumen.
 * @param {import('better-sqlite3').Database} db
 * @param {{now?:Date|string, calendar?:object|null, calendarFile?:string}} [opts]
 */
function buildContext(db, opts) {
  const o = opts || {};
  const now = toDate(o.now == null ? new Date() : o.now) || new Date();
  let rail = '', idx = '';
  try {
    rail = (db.prepare(`SELECT MAX(trade_date) AS d FROM custom_ohlc WHERE ${REGULAR_SESSION}`).get() || {}).d || '';
  } catch (e) { /* tabel belum ada -> biarkan kosong */ }
  try {
    idx = (db.prepare('SELECT MAX(trade_date) AS d FROM idx_daily').get() || {}).d || '';
  } catch (e) { /* idem */ }

  const ref = rail > idx ? rail : idx;
  const ref_source = !ref ? 'none'
    : rail === idx ? 'rail+idx_daily'
    : rail > idx ? 'rail:custom_ohlc' : 'idx_daily';

  let sessions = [];
  try {
    sessions = db.prepare('SELECT DISTINCT trade_date AS d FROM idx_daily ORDER BY trade_date DESC LIMIT ?')
      .all(SESSION_LOOKBACK).map(r => r.d);
  } catch (e) { /* kalender kosong -> lag null, pemanggil menampilkan apa adanya */ }
  // ref dari rail bisa lebih baru dari idx_daily; sesi itu tetap sesi.
  if (ref && sessions.indexOf(ref) === -1) sessions.push(ref);
  sessions.sort();

  // Ekspektasi per seri: satu query, dibaca sekali per request. Sumbernya keputusan manual
  // (scripts/seed_expected_lag.js), bukan hasil turunan pull — lihat komentar di kepala berkas.
  const expected_lag = {};
  try {
    for (const r of db.prepare('SELECT code, expected_lag_sessions, lag_basis FROM custom_tickers').all()) {
      expected_lag[r.code] = {
        expected_lag_sessions: r.expected_lag_sessions == null ? null : Number(r.expected_lag_sessions),
        lag_basis: r.lag_basis || null,
      };
    }
  } catch (e) { /* tabel/kolom belum ada -> tidak ada yang dideklarasikan, semua seri 'na' */ }

  // Telemetri tarikan (kartu t_57252454): apa frontier SUMBER pada tiap tarikan, dibaca
  // sekali per request (2 query, SCAN_ROWS baris terakhir per kode). Dipakai summarize()
  // untuk memisahkan "kita tertinggal" (pull_behind) dari "sumber berhenti" (source_stalled).
  // Kalau tabelnya belum ada, ctx.pull.available=false dan kedua kelas itu kosong — bukan
  // dianggap "tidak ada temuan".
  const pull = pullLog.pullContext(db);

  // Sinyal "pipeline data berhenti" (kanban t_c6c01360). Dihitung SEKALI per request di konteks
  // supaya semua panel mewarisinya lewat summarize() — bukan ambang lokal per panel.
  // Kalender dibaca dari berkas terdeklarasi; bila berkas hilang/kedaluwarsa, state =
  // 'calendar_stale' (terlihat, tanpa alarm) dan semua seri turun ke 'na'.
  const calendar = Object.prototype.hasOwnProperty.call(o, 'calendar')
    ? o.calendar
    : loadCalendar(o.calendarFile);
  const pipeline = pipelineSignal({
    refDate: ref || null,
    now,
    calendar,
    lastPull: lastPullMeta(db, now),
  });

  return {
    ref_date: ref,
    ref_source,
    rail_frontier: rail,
    idx_frontier: idx,
    sessions,
    expected_lag,
    pull,
    pipeline,
    // true bila last_date seri lebih tua dari jendela kalender -> lag hanya batas bawah
    window_from: sessions.length ? sessions[0] : '',
  };
}

/**
 * Kesegaran satu seri. `lastDate` = tanggal bar terakhir seri ('' / null bila tak ada bar).
 * `code` WAJIB: ekspektasi lag melekat pada seri (custom_tickers.expected_lag_sessions).
 * Pemanggil yang lupa mengirim `code` jatuh ke keadaan 'na' (tidak pernah alarm), BUKAN
 * 'fresh' — seri yang tidak dikenal tidak boleh terbaca segar hanya karena argumennya lupa.
 *
 * Mesin keadaan (urut, yang pertama cocok menang):
 *   pipeline stopped/calendar_stale    -> 'na'       (stale FALSE, lag null, lag_basis sebabnya)
 *   tak dideklarasikan / expected NULL -> 'na'       (stale null)
 *   tidak ada bar                      -> 'no_series' (stale null)
 *   lag 0                              -> 'fresh'     (stale false)
 *   0 < lag <= expected                -> 'by_source' (stale false)  sumber memang lambat
 *   lag > expected                     -> 'excess'    (stale true)   di luar kebiasaan sumber
 * (dua keadaan pertama kanban t_b234606a; yang pertama t_c6c01360)
 *
 * @returns {{ref_date:string|null,last_date:string|null,lag_sessions:number|null,
 *   lag_capped:boolean,expected_lag_sessions:number|null,lag_basis:string|null,
 *   excess_sessions:number|null,state:string,stale:boolean|null}}
 */
function seriesFreshness(ctx, lastDate, code) {
  const decl = (ctx && ctx.expected_lag && code) ? ctx.expected_lag[code] : null;
  const expected = decl && decl.expected_lag_sessions != null ? Number(decl.expected_lag_sessions) : null;
  const basis = decl ? decl.lag_basis : null;
  const pipe = (ctx && ctx.pipeline) || null;

  // PIPA BERHENTI / KALENDER KEDALUWARSA (kanban t_c6c01360, §D3 keputusan t_243d21ae).
  // `lag_sessions` di mesin keadaan di bawah diukur terhadap `ref_date`; kalau KEDUA frontier
  // beku, ref_date ikut beku dan lag-nya 0 — panel akan mencetak 'fresh' untuk data yang bisa
  // berhenti berhari-hari. Saat pipeline berhenti kita TIDAK TAHU lag-nya, jadi jangan
  // mengarang angka: state 'na', lag NULL, `stale:false` (bukan null — kontrak §D3), dan
  // `lag_basis` menyebut SEBABNYA supaya UI bisa menulis catatan netral yang benar.
  // `expected_lag_sessions` tetap dikirim: itu deklarasi, bukan hasil pengukuran.
  if (pipe && (pipe.state === 'stopped' || pipe.state === 'calendar_stale')) {
    return {
      ref_date: ctx.ref_date || null,
      last_date: lastDate || null,
      lag_sessions: null,
      lag_capped: false,
      expected_lag_sessions: expected,
      lag_basis: pipe.state === 'stopped' ? 'pipeline_stopped' : 'calendar_stale',
      excess_sessions: null,
      state: 'na',
      stale: false,
    };
  }

  // Tanpa deklarasi (termasuk kode asing / kalender kosong): tidak ada dasar untuk bilang
  // "terlalu lambat". Tanggalnya tetap ditampilkan pemanggil; jangan diberi angka palsu.
  if (!ctx || !ctx.ref_date || expected === null) {
    return {
      ref_date: ctx ? ctx.ref_date : null,
      last_date: lastDate || null,
      lag_sessions: null,
      lag_capped: false,
      expected_lag_sessions: expected,
      lag_basis: basis,
      excess_sessions: null,
      state: 'na',
      stale: null,
    };
  }
  if (!lastDate) {
    // tanpa bar sama sekali: bukan "basi", tapi "tidak ada seri" — dibedakan pemanggil (no_series).
    return {
      ref_date: ctx.ref_date,
      last_date: null,
      lag_sessions: null,
      lag_capped: false,
      expected_lag_sessions: expected,
      lag_basis: basis,
      excess_sessions: null,
      state: 'no_series',
      stale: null,
    };
  }
  let lag = 0;
  for (const s of ctx.sessions) if (s > lastDate && s <= ctx.ref_date) lag++;
  const capped = !!ctx.window_from && lastDate < ctx.window_from;
  const excessive = lag > expected;
  return {
    ref_date: ctx.ref_date,
    last_date: lastDate,
    lag_sessions: lag,
    lag_capped: capped,
    expected_lag_sessions: expected,
    lag_basis: basis,
    excess_sessions: lag - expected,
    state: lag === 0 ? 'fresh' : (excessive ? 'excess' : 'by_source'),
    stale: excessive,
  };
}

/**
 * Apakah bar seri ini berasal dari SESI YANG SAMA dengan sesi rujukan?
 *
 * Dipakai penjaga divergensi (routes/market.js, koreksi review t_fb5135a3): membandingkan
 * chg_1d komoditas dengan rata-rata chg_1d saham hanya sah bila keduanya dari sesi yang sama.
 *
 * - seri terdeklarasi : `lag_sessions === 0` — lag dihitung terhadap kalender sesi.
 * - seri 'na'         : kontrak ini TIDAK menghitung lag untuk seri tanpa deklarasi
 *                       (expected NULL, mis. KRAFT_PULP). Yang dibandingkan adalah tanggal bar
 *                       SESI REGULER — `stale_date`, BUKAN `date`: `date` bisa bar Sabtu/Minggu
 *                       sementara bar sesinya justru di hari rujukan. Bar sesi reguler yang
 *                       tidak lebih tua dari rujukan = satu sesi.
 * - tanpa rujukan (`ref_date` null) atau tanpa bar -> false.
 *
 * `stale` sengaja TIDAK dipakai di sini. Sejak ambang jadi per-seri, 'by_source' berarti
 * "sumber memang lambat", bukan "se-sesi": memakai `!stale` menerbitkan divergensi lintas sesi,
 * sedangkan memakai `stale` menolak seri 'na' yang barnya justru se-sesi (dua-duanya salah).
 */
function isSameSessionBar(c) {
  if (!c || !c.ref_date) return false;
  if (c.lag_sessions != null) return Number(c.lag_sessions) === 0;
  return !!c.stale_date && String(c.stale_date) >= String(c.ref_date);
}

/**
 * Ringkasan untuk satu respons panel: kode mana yang tertinggal, dirujuk ke sesi mana.
 *
 * Dua kelas temuan tambahan (kartu t_57252454) — SENGAJA terpisah dari stale_codes/delayed_codes,
 * karena artinya beda dan yang bisa kita perbaiki hanya yang pertama:
 *   pull_behind_codes    custom_tickers.last_date < frontier terakhir tarikan = CACAT KITA
 *   source_stalled_codes frontier tidak maju N tarikan sukses = SUMBER berhenti menerbitkan
 * Keduanya dibatasi pada kode yang muncul di `entries` permukaan ini (ringkasan ini per-surface),
 * dan tidak pernah mengubah aturan stale/excess per seri. Gambaran penuh per kode ada di
 * GET /api/idx/custom/pull-log (pullReport).
 * @param {{ref_date:string,ref_source:string,pull?:object}} ctx
 * @param {Array<{code:string,freshness:object}>} entries
 */
function summarize(ctx, entries) {
  const stale_codes = [], delayed_codes = [], na_codes = [], undeclared_codes = [];
  const pull_behind_codes = [], source_stalled_codes = [];
  const push = (arr, code) => { if (code && arr.indexOf(code) === -1) arr.push(code); };
  for (const e of entries) {
    const f = e && e.freshness;
    if (!e || !f) continue;
    if (f.state === 'excess') push(stale_codes, e.code);
    else if (f.state === 'by_source') push(delayed_codes, e.code);
    else if (f.state === 'na') {
      push(na_codes, e.code);
      // 'na' bisa berarti "sengaja tidak berlaku" (lag_basis='na') atau "belum diputuskan"
      // (lag_basis NULL). Yang kedua harus terlihat: itu drift deklarasi, bukan keadaan.
      const decl = ctx && ctx.expected_lag ? ctx.expected_lag[e.code] : null;
      if (!decl || !decl.lag_basis) push(undeclared_codes, e.code);
    }
    const p = ctx && ctx.pull && ctx.pull.by_code ? ctx.pull.by_code[e.code] : null;
    if (p && p.pull_behind) push(pull_behind_codes, e.code);
    if (p && p.source_stalled) push(source_stalled_codes, e.code);
  }
  stale_codes.sort(); delayed_codes.sort(); na_codes.sort(); undeclared_codes.sort();
  pull_behind_codes.sort(); source_stalled_codes.sort();
  const pullCtx = (ctx && ctx.pull) || null;
  return {
    ref_date: ctx ? ctx.ref_date : null,
    ref_source: ctx ? ctx.ref_source : null,
    // Alias lama dengan arti baru: kelebihan minimum di atas ekspektasi per seri.
    threshold_sessions: MIN_EXCESS_SESSIONS,
    min_excess_sessions: MIN_EXCESS_SESSIONS,
    min_excess_alias: 'threshold_sessions',
    stale_codes,
    delayed_codes,
    na_codes,
    undeclared_codes,
    // Telemetri tarikan: dua kelas yang DULU tidak bisa dibedakan dari lag sesi.
    pull_behind_codes,
    source_stalled_codes,
    pull_log: {
      available: !!(pullCtx && pullCtx.available),
      thresholds: pullCtx ? pullCtx.thresholds : null,
      scanned_codes: pullCtx ? Object.keys(pullCtx.by_code || {}).length : 0,
    },
    // Sinyal sistem "pipeline data berhenti" (kanban t_c6c01360, §D1 keputusan t_243d21ae):
    // diteruskan apa adanya supaya SEMUA panel yang memakai ringkasan ini mewarisi sinyalnya
    // tanpa kode sendiri. Null hanya bila pemanggil mengirim ctx lama/tiruan tanpa pipeline.
    pipeline: (ctx && ctx.pipeline) || null,
  };
}

module.exports = {
  MIN_EXCESS_SESSIONS,
  STALE_LAG_SESSIONS,
  SESSION_LOOKBACK,
  REGULAR_SESSION,
  PIPELINE_CUTOFF_WIB,
  PIPELINE_STOPPED_SESSIONS,
  PIPELINE_RED_SESSIONS,
  CALENDAR_PATH,
  buildContext,
  seriesFreshness,
  isSameSessionBar,
  lastRegularBarDate,
  summarize,
  loadCalendar,
  calendarSessions,
  pipelineSignal,
  lastPullMeta,
};
