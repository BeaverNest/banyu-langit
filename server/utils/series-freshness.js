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
// ═══════════════════════════════════════════════════════════════════════════

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

/**
 * Bangun konteks kesegaran sekali per request (2 query + 1 kalender sesi).
 * @param {import('better-sqlite3').Database} db
 */
function buildContext(db) {
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

  return {
    ref_date: ref,
    ref_source,
    rail_frontier: rail,
    idx_frontier: idx,
    sessions,
    expected_lag,
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
 * Mesin keadaan (urut, yang pertama cocok menang), kanban t_b234606a:
 *   tak dideklarasikan / expected NULL -> 'na'       (stale null)
 *   tidak ada bar                      -> 'no_series' (stale null)
 *   lag 0                              -> 'fresh'     (stale false)
 *   0 < lag <= expected                -> 'by_source' (stale false)  sumber memang lambat
 *   lag > expected                     -> 'excess'    (stale true)   di luar kebiasaan sumber
 *
 * @returns {{ref_date:string|null,last_date:string|null,lag_sessions:number|null,
 *   lag_capped:boolean,expected_lag_sessions:number|null,lag_basis:string|null,
 *   excess_sessions:number|null,state:string,stale:boolean|null}}
 */
function seriesFreshness(ctx, lastDate, code) {
  const decl = (ctx && ctx.expected_lag && code) ? ctx.expected_lag[code] : null;
  const expected = decl && decl.expected_lag_sessions != null ? Number(decl.expected_lag_sessions) : null;
  const basis = decl ? decl.lag_basis : null;

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
  };
}

module.exports = {
  MIN_EXCESS_SESSIONS,
  STALE_LAG_SESSIONS,
  SESSION_LOOKBACK,
  REGULAR_SESSION,
  buildContext,
  seriesFreshness,
  isSameSessionBar,
  lastRegularBarDate,
  summarize,
};
