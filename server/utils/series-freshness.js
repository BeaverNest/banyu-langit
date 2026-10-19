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
//   basi      = lag_sesi >= STALE_LAG_SESSIONS (1)
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

// Ambang = 1 sesi (keputusan kartu t_61ccbdbe): seri yang bar terakhirnya bukan
// sesi terakhir dianggap tertinggal. ALUMINIUM/NICKEL/WTI (19 Okt) tidak tertandai,
// TIN (15 Okt) dan COAL (16 Okt) tertandai.
const STALE_LAG_SESSIONS = 1;

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

  return {
    ref_date: ref,
    ref_source,
    rail_frontier: rail,
    idx_frontier: idx,
    sessions,
    // true bila last_date seri lebih tua dari jendela kalender -> lag hanya batas bawah
    window_from: sessions.length ? sessions[0] : '',
  };
}

/**
 * Kesegaran satu seri. `lastDate` = tanggal bar terakhir seri ('' / null bila tak ada bar).
 * @returns {{ref_date:string|null,last_date:string|null,lag_sessions:number|null,stale:boolean|null,lag_capped:boolean}}
 */
function seriesFreshness(ctx, lastDate) {
  if (!ctx || !ctx.ref_date) {
    return { ref_date: null, last_date: lastDate || null, lag_sessions: null, stale: null, lag_capped: false };
  }
  if (!lastDate) {
    // tanpa bar sama sekali: bukan "basi", tapi "tidak ada seri" — dibedakan pemanggil (no_series).
    return { ref_date: ctx.ref_date, last_date: null, lag_sessions: null, stale: null, lag_capped: false };
  }
  let lag = 0;
  for (const s of ctx.sessions) if (s > lastDate && s <= ctx.ref_date) lag++;
  const capped = !!ctx.window_from && lastDate < ctx.window_from;
  return {
    ref_date: ctx.ref_date,
    last_date: lastDate,
    lag_sessions: lag,
    stale: lag >= STALE_LAG_SESSIONS,
    lag_capped: capped,
  };
}

/**
 * Ringkasan untuk satu respons panel: kode mana yang tertinggal, dirujuk ke sesi mana.
 * @param {{ref_date:string,ref_source:string}} ctx
 * @param {Array<{code:string,freshness:object}>} entries
 */
function summarize(ctx, entries) {
  const stale_codes = [];
  for (const e of entries) {
    if (e && e.freshness && e.freshness.stale && e.code && stale_codes.indexOf(e.code) === -1) stale_codes.push(e.code);
  }
  stale_codes.sort();
  return {
    ref_date: ctx ? ctx.ref_date : null,
    ref_source: ctx ? ctx.ref_source : null,
    threshold_sessions: STALE_LAG_SESSIONS,
    stale_codes,
  };
}

module.exports = {
  STALE_LAG_SESSIONS,
  SESSION_LOOKBACK,
  REGULAR_SESSION,
  buildContext,
  seriesFreshness,
  lastRegularBarDate,
  summarize,
};
