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
//   source_stalled  frontier tidak maju N tarikan SUKSES berturut-turut   -> sumber berhenti
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

// Berapa baris terakhir per kode yang dipindai untuk menilai "frontier beku".
const SCAN_ROWS = PULL_STALL_SNAPSHOT + 1;

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
 *   - pullContext (jalur request panel) : baris TERAKHIR per kode saja (murah)
 *   - pullReport  (endpoint/laporan)    : seluruh riwayat kode itu
 * Kalau jendelanya terpotong, `frozen_capped` menandainya: frontier_frozen_pulls saat itu
 * adalah BATAS BAWAH, dan itu cukup untuk memutuskan stalled (yang dibandingkan selalu >= N).
 */
function classifyCode(list, lastDate, hasTicker) {
  const last = list[0] || {};
  // Frontier terakhir = frontier dari baris tarikan TERBARU yang punya frontier.
  // Bukan MAX() sepanjang sejarah: high-water mark bisa lebih tinggi dari frontier
  // tarikan terakhir, dan itu justru menghilangkan pull_behind saat perlu muncul.
  const withFrontier = list.find(r => r.source_frontier_date);
  const frontier = withFrontier ? withFrontier.source_frontier_date : null;
  const source = (withFrontier && withFrontier.source) || last.source || null;

  // Deret tarikan SUKSES berturut-turut dengan frontier yang sama. Baris non-'ok'
  // (error/no_data) DILEWATI, bukan mematahkan: "N tarikan sukses berturut-turut" mengukur
  // tarikan yang benar-benar berhasil, jadi satu tarikan yang hilang mengurangi hitungan —
  // dan jalur tarik yang rusak tidak boleh terbaca sebagai "sumber berhenti".
  let frozen = 0, frozenSince = null, frozenFrontier = null, okSeen = 0;
  for (const r of list) {
    const ok = r.status === 'ok' && !!r.source_frontier_date;
    if (!ok) continue;
    okSeen++;
    if (frozenFrontier === null) { frozenFrontier = r.source_frontier_date; frozen = 0; }
    if (r.source_frontier_date !== frozenFrontier) break;
    frozen++;
    frozenSince = r.pulled_at;
  }

  const ld = hasTicker ? (lastDate || '') : null;
  // pull_behind = cacat KITA: sumber sudah menerbitkan bar yang belum ada di tabel kita.
  // Hanya dinilai bila kedua sisi ada; seri tanpa baris custom_tickers tidak dituduh.
  const behind = !!(frontier && ld !== null && (!ld || ld < frontier));
  const threshold = stallThresholdFor(source);

  return {
    source,
    last_pulled_at: last.pulled_at || null,
    last_status: last.status || null,
    last_ref_date: last.ref_date || null,
    last_frontier_date: frontier,
    last_date: ld,
    pull_behind: behind,
    frontier_frozen_pulls: frozen,
    frozen_frontier_date: frozenFrontier,
    frozen_since: frozen >= 2 ? frozenSince : null,
    stall_threshold: threshold,
    source_stalled: frozen >= threshold,
    ok_pulls_scanned: okSeen,
  };
}

/**
 * Potret telemetri per kode untuk SATU request panel (dipakai buildContext/summarize).
 *
 * Hanya dua query: (1) SCAN_ROWS baris terakhir per kode, (2) last_date tiap seri dari
 * custom_tickers. Tabel ini tumbuh ~40 baris/hari, jadi jangan pernah membaca seluruhnya
 * di jalur request.
 *
 * @returns {{available:boolean, thresholds:object, by_code:object}}
 */
function pullContext(db) {
  const out = {
    available: false,
    thresholds: { session_rail: PULL_STALL_DAILY, snapshot_rail: PULL_STALL_SNAPSHOT },
    by_code: {},
  };
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT code, source, pulled_at, ref_date, source_frontier_date, rows, written, status, id
         FROM (
           SELECT code, source, pulled_at, ref_date, source_frontier_date, rows, written, status, id,
                  ROW_NUMBER() OVER (PARTITION BY code ORDER BY id DESC) AS rn
           FROM custom_pull_log
         ) WHERE rn <= ?`).all(SCAN_ROWS);
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
    info.frozen_capped = list.length >= SCAN_ROWS && info.frontier_frozen_pulls >= SCAN_ROWS;
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
    rows = db.prepare(
      `SELECT code, source, pulled_at, ref_date, source_frontier_date, status
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
    // terpotong jendela SCAN_ROWS milik pullContext (yang dibaca tiap request panel). Satu
    // algoritma (classifyCode), dua jendela: hanya kecepatannya yang berbeda, bukan artinya.
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
      frozen_capped: false,                       // laporan memakai seluruh riwayat, tidak dipotong
      frozen_frontier_date: flags.frozen_frontier_date,
      frozen_since: flags.frozen_since,
      stall_threshold: flags.stall_threshold,
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
  SCAN_ROWS,
  STATUSES,
  stallThresholdFor,
  frontierOf,
  logPull,
  pullContext,
  pullReport,
};
