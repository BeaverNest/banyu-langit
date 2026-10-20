'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Telemetri TARIKAN per seri (kanban t_57252454).
//
// Masalah yang ditutup: lag terhadap kalender sesi IDX mencampur TIGA hal yang
// berbeda dan menuntut tindakan yang berbeda:
//
//   1. KITA gagal menyimpan bar yang sumbernya sudah terbitkan  -> bisa kita perbaiki
//   2. SUMBER memang terbit lambat (TOCOM/ICE/CME sering H+1)   -> normal, jangan alarm
//   3. SUMBER berhenti terbit (TIN sejak 2026-10-15)            -> ini yang harus menyalak
//
// Yang membedakannya hanya satu besaran yang dulu tidak pernah direkam: apa frontier
// SUMBER ITU SENDIRI pada setiap tarikan. Karena itu setiap jalur tulis custom_ohlc
// mencatat satu baris di custom_pull_log — dari endpoint (POST /custom/upsert,
// /custom/fetch-eod, /custom/fetch-all, /custom/sync-stale), BUKAN dari skrip host,
// supaya keempat sumber (investing/yahoo/fred/tradingeconomics) terekam di satu tempat.
//
// Dua kelas temuan yang dilaporkan:
//
//   pull_behind     custom_tickers.last_date < frontier terakhir tarikan  -> cacat kita
//   source_stalled  frontier tidak maju N HARI TARIK SUKSES berturut-turut -> sumber berhenti
//                   (satuannya HARI, bukan baris: retry/burst di hari yang sama bukan bukti
//                    sumber berhenti — lihat PULL_DAY_SHIFT_HOURS di bawah; kanban t_be770638)
//
// Tabel ini MELAPORKAN. Ia TIDAK PERNAH menulis ulang expected_lag_sessions: expectation
// yang menyesuaikan diri sendiri adalah ratchet, dan pada hari sumber berhenti lag barunya
// justru jadi "normal baru" sehingga alarmnya mati tepat saat dibutuhkan (kontrak
// t_b234606a §1.2). Deklarasi ulang = keputusan manusia, dengan laporan ini sebagai lampiran.
//
// Aturan status:
//   ok       ada bar yang benar-benar tersimpan DAN frontier-nya terbaca
//   no_data  tarikan berjalan tapi tidak ada bar layak simpan (payload kosong / close<=0)
//   error    tarikan gagal (curl gagal, vendor menolak, exception di jalur tulis)
// Hanya baris 'ok' yang dihitung sebagai tarikan sukses: error/no_data TIDAK memajukan
// frontier dan TIDAK dihitung dalam deret N — jadi jalur tarik yang rusak tidak pernah
// menyamar sebagai "sumber berhenti" (dan sebaliknya tidak mematahkan deteksi).
//
// BATAS RIWAYAT — jangan dikarang (kanban t_ff3ca45f)
// Tabel ini baru terisi sejak 2026-10-19T14:23Z (baris pertamanya; kodenya sendiri masuk
// commit 3d45efe pada 21:31 WIB hari yang sama). Tarikan SEBELUM itu tidak bisa
// direkonstruksi, dan alasannya bukan "belum sempat":
//   1. `source_frontier_date` hanya terbaca dari payload PADA SAAT tarikan; payload historis
//      tidak diarsipkan di mana pun (rail menarik jendela lebar lalu membuang payload-nya).
//   2. `custom_ohlc` menyimpan HASIL tulisan, bukan apa yang sumber terbitkan pada tanggal X.
//      Vendor juga menulis ulang bar lama saat roll (WTI 2026-10-15 97,97 -> 96,50), jadi bar
//      yang hari ini terlihat "terbit 15 Okt" tidak membuktikan frontier tarikan 15 Okt.
//   3. `custom_ohlc_archive` (penggantian sumber) dan `custom_ohlc_rewrites` (t_7be29126)
//      mencatat PENULISAN, bukan TARIKAN — tidak ada tanggal tarik di dalamnya.
// Konsekuensi yang harus ikut dibaca siapa pun memakai angka di bawah: `frontier_lag_*`,
// `frontier_frozen_pulls`, dan `source_stalled` TIDAK punya riwayat sebelum 2026-10-19; sampel
// `n` kecil artinya sampel kecil, bukan distribusi. Backfill sintetis DILARANG: angka karangan
// pada tabel bukti lebih mahal daripada tidak punya angka sama sekali (kontrak t_b234606a).
// Riwayat tumbuh +16..40 baris per HARI BURSA sejak penjadwal rail dipasang
// (market-rails/scripts/daily-rails.sh, t_ff3ca45f; hari non-bursa sengaja tidak menulis baris).
// ═══════════════════════════════════════════════════════════════════════════

const STATUSES = ['ok', 'no_data', 'error'];

// Jumlah tarikan SUKSES berturut-turut dengan frontier yang tidak maju sebelum
// "sumber berhenti" dinyatakan. Rail sesi harian: 3 tarikan (~3 hari bursa).
// Rail snapshot (tradingeconomics/snapshot — dua titik per hari, bukan seri sesi):
// 7, karena satu titik yang tidak bertambah di sana jauh lebih sering normal.
// Nilai ini KONSTANTA BERNAMA, bukan angka sihir di tengah kode.
const PULL_STALL_DAILY = 3;
const PULL_STALL_SNAPSHOT = 7;

// Sumber yang tidak diukur dengan ritme sesi harian.
const SNAPSHOT_SOURCE = /^tradingeconomics\//i;

// ─── SATUAN DERET BEKU = HARI TARIK, BUKAN BARIS (kanban t_be770638, temuan R6 sena) ───
//
// Kenapa: retry/burst menulis banyak baris `ok` dengan frontier yang sama dalam hitungan
// detik (terukur 50 baris / 27 detik pada 2026-10-20). Kalau deret beku dihitung per baris,
// satu loop retry menuduh sumber sehat "berhenti menerbitkan". Yang diukur alarm ini adalah
// "sumber tidak menerbitkan apa pun yang baru selama N hari tarik", jadi satuannya hari.
//
// Definisi hari tarik = tanggal WIB (pulled_at + 7 jam), bukan tanggal UTC: jendela rail
// didefinisikan dalam WIB (RAIL_WINDOW_START 18:30, batas 21:20) dan tarikan 19:40 WIB +
// retry dini hari berikutnya tetap satu malam bursa. Tanggal harus SAMA di SQL (jendela
// pindai pullContext) dan di JS (dedupe deret), karena itu shift-nya satu konstanta.
//
// Yang TIDAK berubah: `pull_behind`/`last_frontier_date` tetap dibaca dari baris mentah
// terbaru (satu baris, bukan deret) — dedupe hanya menyentuh DERET beku.
const PULL_DAY_SHIFT_HOURS = 7;
// SQLite: date() menerima sufiks 'Z' (ISO-8601) dan mengonversi ke UTC dulu, jadi
// date('2026-10-20T02:41:16Z','+7 hours') = '2026-10-20'.
const PULL_DAY_SQL = "date(pulled_at, '+7 hours')";

// Berapa HARI TARIK terakhir per kode yang dipindai untuk menilai "frontier beku".
// Basisnya ambang tertinggi (snapshot 7) + 1 hari pembanding, sama seperti sebelumnya
// saat satuannya masih baris. Jendela per-hari ini yang membuat burst satu hari tidak
// bisa menghabiskan seluruh jendela (jebakan terukur: COAL kehilangan baris `ok`).
const SCAN_PULL_DAYS = PULL_STALL_SNAPSHOT + 1;

/** Tanggal WIB sebuah tarikan (yyyy-mm-dd) — cermin JS dari PULL_DAY_SQL. */
function pullDayOf(pulledAt) {
  const s = String(pulledAt || '');
  if (!s) return null;
  const hasTz = /Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
  const ms = Date.parse(hasTz ? s : s.replace(' ', 'T') + 'Z');
  if (!isFinite(ms)) return s.slice(0, 10) || null;      // format asing: jangan menebak zaman
  return new Date(ms + PULL_DAY_SHIFT_HOURS * 3600000).toISOString().slice(0, 10);
}


function stallThresholdFor(source) {
  return SNAPSHOT_SOURCE.test(String(source || '').trim()) ? PULL_STALL_SNAPSHOT : PULL_STALL_DAILY;
}

/**
 * Frontier satu payload sumber = MAX(trade_date) dari PAYLOAD (bukan dari DB kita).
 *
 * Terlepas dari bar itu baru atau lama: bar lama yang dikirim ulang karena rollover
 * tetap frontier yang sama, dan justru itu tandanya sumber belum menerbitkan yang baru.
 * Hanya baris yang layak ditulis (ada tanggal + close > 0) yang dihitung — kalau tidak,
 * satu baris sampah ber-close 0 di ujung payload akan membuat kita terbaca "tertinggal
 * dari sumber" padahal sumbernya sendiri tidak menerbitkan bar yang bisa dipakai.
 * Tanggal dibandingkan sebagai teks ISO (format yang dipakai seluruh app ini).
 */
function frontierOf(rows) {
  let best = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = r && r.date;
    if (!d || !(Number(r.close) > 0)) continue;
    const s = String(d);
    if (!best || s > best) best = s;
  }
  return best;
}

/**
 * Rapatkan daftar tarikan (TERBARU DULU) menjadi SATU titik per HARI TARIK.
 *
 * Yang dipakai per hari = tarikan `ok` TERAKHIR hari itu (frontier yang berlaku saat hari
 * itu berakhir) — bukan rata-rata dan bukan MAX sepanjang hari: kalau sumber sempat maju
 * lalu retry di jam yang sama, frontier terakhirnya yang benar. Hari tanpa tarikan `ok`
 * (hanya error/no_data) TIDAK menyumbang titik: tarikan yang gagal tidak boleh terbaca
 * sebagai "sumber berhenti" (kontrak lama, tetap berlaku).
 *
 * @returns {Array<{day:string, frontier:string, pulled_at:string}>} terbaru dulu
 */
function frozenDays(list) {
  const seen = new Set();
  const days = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || r.status !== 'ok' || !r.source_frontier_date) continue;
    const day = pullDayOf(r.pulled_at);
    if (!day || seen.has(day)) continue;
    seen.add(day);
    days.push({ day, frontier: String(r.source_frontier_date).slice(0, 10), pulled_at: r.pulled_at });
  }
  return days;
}

/**
 * Catat SATU baris telemetri untuk satu seri pada satu tarikan.
 *
 * Sengaja tidak pernah melempar: telemetri tidak boleh menggagalkan penulisan DATA.
 * Kalau tabelnya rusak/belum ada, kegagalannya cukup jadi peringatan di log kontainer.
 * @returns {string|null} status yang tercatat (null bila gagal mencatat)
 */
function logPull(db, entry) {
  const e = entry || {};
  const code = String(e.code || '').toUpperCase().trim();
  if (!db || !code) return null;
  let status = STATUSES.indexOf(e.status) === -1 ? null : e.status;
  if (!status) status = Number(e.written) > 0 ? 'ok' : 'no_data';
  const frontier = e.frontier ? String(e.frontier).slice(0, 10) : null;
  // 'ok' berarti "sumber menerbitkan sesuatu yang tersimpan"; tanpa frontier itu tidak
  // bisa dibuktikan, jadi jangan biarkan baris tanpa frontier masuk deret tarikan sukses.
  if (status === 'ok' && !frontier) status = 'no_data';
  try {
    db.prepare(
      `INSERT INTO custom_pull_log
       (code, source, pulled_at, ref_date, source_frontier_date, rows, written, endpoint, status, error)
       VALUES (?,?,strftime('%Y-%m-%dT%H:%M:%SZ','now'),?,?,?,?,?,?,?)`)
      .run(code,
        e.source ? String(e.source).slice(0, 64) : null,
        e.refDate ? String(e.refDate).slice(0, 10) : null,
        frontier,
        Number.isFinite(Number(e.rows)) ? Number(e.rows) : 0,
        Number.isFinite(Number(e.written)) ? Number(e.written) : 0,
        e.endpoint ? String(e.endpoint).slice(0, 64) : null,
        status,
        e.error ? String(e.error).slice(0, 300) : null);
    return status;
  } catch (err) {
    console.warn('[pull-log] gagal mencatat tarikan ' + code + ': ' + err.message);
    return null;
  }
}

/**
 * Klasifikasi satu seri dari daftar tarikannya (TERBARU DULU) + last_date tabel kita.
 *
 * Dipakai DUA kali dengan jendela berbeda supaya algoritmanya cuma satu:
 *   - pullContext (jalur request panel) : SCAN_PULL_DAYS HARI TARIK terakhir (murah)
 *   - pullReport  (endpoint/laporan)    : seluruh riwayat kode itu
 * Kalau jendelanya terpotong, `frozen_capped` menandainya: frontier_frozen_pulls saat itu
 * adalah BATAS BAWAH, dan itu cukup untuk memutuskan stalled (yang dibandingkan selalu >= N).
 *
 * Kedua surface memanggil fungsi ini — bukan salinan. Dedupe per-hari ADA DI SINI, jadi
 * mustahil satu surface memakainya dan yang lain tidak (kesalahan patch 6812747).
 */
function classifyCode(list, lastDate, hasTicker) {
  const last = list[0] || {};
  // Frontier terakhir = frontier dari baris tarikan TERBARU yang punya frontier.
  // Bukan MAX() sepanjang sejarah: high-water mark bisa lebih tinggi dari frontier
  // tarikan terakhir, dan itu justru menghilangkan pull_behind saat perlu muncul.
  // Tetap dari BARIS MENTAH (bukan hasil dedupe): satu tarikan `no_data` di hari yang
  // sama tidak boleh menghapus frontier yang sudah terbaca hari itu.
  const withFrontier = list.find(r => r.source_frontier_date);
  const frontier = withFrontier ? withFrontier.source_frontier_date : null;
  const source = (withFrontier && withFrontier.source) || last.source || null;

  // Deret tarikan SUKSES berturut-turut dengan frontier yang sama — dihitung per HARI
  // TARIK (satu titik per hari), bukan per baris: burst/retry di hari yang sama bukan bukti
  // sumber berhenti menerbitkan. Baris non-'ok' (error/no_data) DILEWATI, bukan mematahkan:
  // "N tarikan sukses berturut-turut" mengukur tarikan yang benar-benar berhasil.
  let okSeen = 0;
  for (const r of list) if (r.status === 'ok' && r.source_frontier_date) okSeen++;
  const days = frozenDays(list);
  let frozen = 0, frozenSince = null, frozenFrontier = null;
  for (const d of days) {
    if (frozenFrontier === null) { frozenFrontier = d.frontier; frozen = 0; }
    if (d.frontier !== frozenFrontier) break;
    frozen++;
    frozenSince = d.pulled_at;
  }

  const ld = hasTicker ? (lastDate || '') : null;
  // pull_behind = cacat KITA: sumber sudah menerbitkan bar yang belum ada di tabel kita.
  // Hanya dinilai bila kedua sisi ada; seri tanpa baris custom_tickers tidak dituduh.
  const behind = !!(frontier && ld !== null && (!ld || ld < frontier));
  const threshold = stallThresholdFor(source);
  // EVALUABILITAS (keputusan Toku t_be770638 butir 4-5): ambang 3 HARI tidak bisa diputuskan
  // dari 2 hari riwayat. `source_stalled=false` pada riwayat muda BUKAN "sumber sehat", jadi
  // itu harus terbaca dari payload — kalau tidak, TIN (beku sejak 15 Okt) hilang diam-diam
  // dan hanya tersisa lewat sinyal `stale`. Dasar: HARI TARIK `ok` yang benar-benar dipindai,
  // karena hanya hari itulah yang bisa menopang deret beku.
  const evaluable = days.length >= threshold;

  return {
    source,
    last_pulled_at: last.pulled_at || null,
    last_status: last.status || null,
    last_ref_date: last.ref_date || null,
    last_frontier_date: frontier,
    last_date: ld,
    pull_behind: behind,
    // Nama field lama DIPERTAHANKAN (kontrak response), tetapi satuannya sekarang HARI
    // TARIK. `frozen_unit` + `frozen_pull_days` menerbitkan arti barunya secara eksplisit.
    frontier_frozen_pulls: frozen,
    frozen_unit: 'pull_day',
    frozen_pull_days: frozen,
    // Pembagi yang menopang angka di atas: berapa HARI TARIK `ok` yang benar-benar terpindai.
    pull_days_observed: days.length,
    frozen_frontier_date: frozenFrontier,
    frozen_since: frozen >= 2 ? frozenSince : null,
    stall_threshold: threshold,
    // Ambang yang sama, dinyatakan dalam satuan yang sekarang dipakai deretnya. Untuk rail
    // sesi nilainya 3 (nilai yang dikutip keputusan); rail snapshot tetap 7 — angka 7 itu
    // memang sudah "hari" sejak dulu karena rail snapshot menarik sekali sehari.
    stall_threshold_days: threshold,
    stall_evaluable: evaluable,
    source_stalled: frozen >= threshold,
    ok_pulls_scanned: okSeen,
  };
}

/**
 * Potret telemetri per kode untuk SATU request panel (dipakai buildContext/summarize).
 *
 * Hanya dua query: (1) SCAN_PULL_DAYS HARI TARIK terakhir per kode, (2) last_date tiap seri
 * dari custom_tickers. Tabel ini tumbuh ~40 baris/hari, jadi jangan pernah membaca
 * seluruhnya di jalur request.
 *
 * Jendela dihitung per HARI (DENSE_RANK atas tanggal WIB), bukan per baris: dengan jendela
 * per-baris, satu burst 50 baris di hari yang sama menghabiskan seluruh jendela dan hari
 * sebelumnya (yang punya baris `ok` pembanding) ikut terbuang — terukur pada COAL 20 Okt,
 * `last_frontier_date` jadi null. Sekalian: dedupe deret memakai tanggal yang SAMA, supaya
 * SQL dan JS tidak bisa berbeda pendapat soal batas hari.
 *
 * @returns {{available:boolean, thresholds:object, scan_pull_days:number, by_code:object}}
 */
function pullContext(db) {
  const out = {
    available: false,
    thresholds: { session_rail: PULL_STALL_DAILY, snapshot_rail: PULL_STALL_SNAPSHOT },
    scan_pull_days: SCAN_PULL_DAYS,
    by_code: {},
  };
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT code, source, pulled_at, ref_date, source_frontier_date, rows, written, status, id, pull_day
         FROM (
           SELECT code, source, pulled_at, ref_date, source_frontier_date, rows, written, status, id,
                  ${PULL_DAY_SQL} AS pull_day,
                  DENSE_RANK() OVER (PARTITION BY code ORDER BY ${PULL_DAY_SQL} DESC) AS pull_day_rank
           FROM custom_pull_log
         ) WHERE pull_day_rank <= ?`).all(SCAN_PULL_DAYS);
  } catch (e) {
    return out;                                   // tabel belum ada (DB lebih tua dari kode)
  }
  out.available = true;

  const byCode = {};
  for (const r of rows) {
    (byCode[r.code] = byCode[r.code] || []).push(r);
  }
  // Terbaru dulu. `id` monoton naik -> tie-break yang pasti, tidak bergantung presisi detik.
  for (const k of Object.keys(byCode)) {
    byCode[k].sort((a, b) => (a.pulled_at === b.pulled_at ? b.id - a.id : (a.pulled_at < b.pulled_at ? 1 : -1)));
  }

  const lastDate = {};
  try {
    for (const t of db.prepare('SELECT code, last_date FROM custom_tickers').all()) {
      lastDate[t.code] = t.last_date || '';
    }
  } catch (e) { /* tabel/kolom belum ada -> pull_behind tak punya pembanding, jangan menebak */ }

  for (const code of Object.keys(byCode)) {
    const list = byCode[code];
    const hasTicker = Object.prototype.hasOwnProperty.call(lastDate, code);
    const info = classifyCode(list, hasTicker ? lastDate[code] : null, hasTicker);
    info.frozen_scan_rows = list.length;
    // Jendela pindai diukur dalam HARI, bukan baris. `frozen_scan_days` = hari tarik `ok` yang
    // benar-benar masuk jendela (pembagi deret), `frozen_scan_rows` = baris mentahnya.
    // `frozen_capped` menandai deret yang mentok di batas jendela: angkanya BATAS BAWAH.
    info.frozen_scan_days = info.pull_days_observed;
    info.frozen_capped = info.pull_days_observed >= SCAN_PULL_DAYS && info.frontier_frozen_pulls >= SCAN_PULL_DAYS;
    out.by_code[code] = info;
  }
  return out;
}

// Persentil nearest-rank (tanpa interpolasi): dengan n kecil angka ini harus terbaca
// apa adanya — p50/p95 dari 1 tarikan memang sama dengan tarikan itu, dan itu bukan
// distribusi. `lag_samples` selalu ikut dikirim supaya pembaca bisa menilainya sendiri.
function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[i];
}

/**
 * Laporan per kode: jumlah tarikan, sebaran lag frontier (dalam SESI, dihitung pada jam
 * tarik), plus flag pull_behind/source_stalled.
 *
 * lag = jumlah sesi IDX di antara frontier sumber dan `ref_date` yang direkam SAAT TARIK.
 * Dipakai untuk menggantikan nilai `expected_lag_sessions` yang dideklarasikan dari satu
 * pengamatan (kontrak t_b234606a §3 "batas kejujuran") — tapi menggantinya adalah keputusan
 * manusia; fungsi ini hanya menyediakan angkanya.
 */
function pullReport(db, opts) {
  const code = opts && opts.code ? String(opts.code).toUpperCase().trim() : null;
  const thresholds = { session_rail: PULL_STALL_DAILY, snapshot_rail: PULL_STALL_SNAPSHOT };
  const report = { thresholds, codes: 0, by_code: {} };

  let rows = [];
  try {
    // `id` WAJIB ikut di SELECT ini. classifyCode() menerima daftar "TERBARU DULU" dan
    // mengurutkannya lewat `b.id - a.id`; tanpa kolom ini comparator bernilai NaN, sort tidak
    // berbuat apa-apa, dan yang masuk adalah urutan ASC (`pulled_at, id`). Akibatnya TERTUKAR:
    // last_status/last_ref_date/last_frontier_date dibaca dari tarikan TERTUA, pull_behind
    // dibandingkan dengan frontier tertua, dan deret beku dihitung dari ujung yang salah.
    // Bug ini tidak terlihat selama tabel hanya punya satu hari riwayat; ia muncul begitu ada
    // >=2 hari dengan frontier berbeda (terukur 20 Okt 2026 setelah penjadwal rail hidup:
    // STEEL_HRC 2026-10-16 vs 2026-10-19 -> asersi harness check-series-freshness [9e] merah).
    // Baris request (pullContext) sudah benar karena ia memang memilih `id`.
    rows = db.prepare(
      `SELECT code, source, pulled_at, ref_date, source_frontier_date, status, id
         FROM custom_pull_log ${code ? 'WHERE code=?' : ''}
        ORDER BY code, pulled_at, id`).all(...(code ? [code] : []));
  } catch (e) { return report; }

  let sessions = [];
  try {
    sessions = db.prepare('SELECT DISTINCT trade_date AS d FROM idx_daily ORDER BY trade_date').all().map(r => r.d);
  } catch (e) { /* tanpa kalender: lag sesi null, tarikan tetap dilaporkan */ }

  const per = {};
  const seq = {};
  for (const r of rows) {
    const p = per[r.code] = per[r.code] || {
      source: null, pulls: 0, ok_pulls: 0, no_data_pulls: 0, error_pulls: 0,
      first_pulled_at: null, last_pulled_at: null, last_status: null,
      last_frontier_date: null, max_frontier_date: null,
      lag_samples: 0, lag_na: 0, lags: [],
    };
    p.pulls++;
    if (r.status === 'ok') p.ok_pulls++;
    else if (r.status === 'no_data') p.no_data_pulls++;
    else p.error_pulls++;
    p.first_pulled_at = p.first_pulled_at || r.pulled_at;
    p.last_pulled_at = r.pulled_at;
    p.last_status = r.status;
    if (r.source) p.source = p.source || r.source;
    if (r.source_frontier_date) p.last_frontier_date = r.source_frontier_date;
    if (r.source_frontier_date && (!p.max_frontier_date || r.source_frontier_date > p.max_frontier_date)) {
      p.max_frontier_date = r.source_frontier_date;
    }
    if (r.status === 'ok' && r.source_frontier_date) {
      if (!r.ref_date) { p.lag_na++; continue; }
      let lag = 0;
      for (const s of sessions) if (s > r.source_frontier_date && s <= r.ref_date) lag++;
      p.lags.push(lag);
    }
    (seq[r.code] = seq[r.code] || []).push(r);
  }

  const lastDate = {};
  try {
    for (const t of db.prepare('SELECT code, last_date FROM custom_tickers').all()) lastDate[t.code] = t.last_date || '';
  } catch (e) { /* tanpa custom_tickers: pull_behind tidak dinilai, jangan menebak */ }

  for (const c of Object.keys(per)) {
    const p = per[c];
    const hasTicker = Object.prototype.hasOwnProperty.call(lastDate, c);
    // Laporan ini membaca SELURUH riwayat kode, jadi deret beku & pull_behind di sini tidak
    // terpotong jendela SCAN_PULL_DAYS milik pullContext (yang dibaca tiap request panel).
    // Satu algoritma (classifyCode, dedupe per hari tarik), dua jendela: hanya kecepatan
    // yang berbeda, bukan artinya.
    const flags = classifyCode((seq[c] || []).slice().sort((a, b) => b.id - a.id),
      hasTicker ? lastDate[c] : null, hasTicker);
    const sorted = p.lags.slice().sort((a, b) => a - b);
    report.by_code[c] = {
      source: p.source,
      pulls: p.pulls,
      ok_pulls: p.ok_pulls,
      no_data_pulls: p.no_data_pulls,
      error_pulls: p.error_pulls,
      first_pulled_at: p.first_pulled_at,
      last_pulled_at: p.last_pulled_at,
      last_status: p.last_status,
      last_frontier_date: flags.last_frontier_date,
      max_frontier_date: p.max_frontier_date,
      last_date: flags.last_date,
      frontier_lag_samples: sorted.length,
      frontier_lag_na: p.lag_na,
      frontier_lag_min: sorted.length ? sorted[0] : null,
      frontier_lag_max: sorted.length ? sorted[sorted.length - 1] : null,
      frontier_lag_p50: percentile(sorted, 0.5),
      frontier_lag_p95: percentile(sorted, 0.95),
      frontier_frozen_pulls: flags.frontier_frozen_pulls,
      frozen_unit: flags.frozen_unit,
      frozen_pull_days: flags.frozen_pull_days,
      pull_days_observed: flags.pull_days_observed,
      frozen_capped: false,                       // laporan memakai seluruh riwayat, tidak dipotong
      frozen_frontier_date: flags.frozen_frontier_date,
      frozen_since: flags.frozen_since,
      stall_threshold: flags.stall_threshold,
      stall_threshold_days: flags.stall_threshold_days,
      stall_evaluable: flags.stall_evaluable,
      source_stalled: flags.source_stalled,
      pull_behind: flags.pull_behind,
    };
  }
  report.codes = Object.keys(report.by_code).length;
  return report;
}

module.exports = {
  PULL_STALL_DAILY,
  PULL_STALL_SNAPSHOT,
  SNAPSHOT_SOURCE,
  PULL_DAY_SHIFT_HOURS,
  SCAN_PULL_DAYS,
  STATUSES,
  stallThresholdFor,
  pullDayOf,
  frozenDays,
  frontierOf,
  logPull,
  pullContext,
  pullReport,
};
