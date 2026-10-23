'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/idx/cross-asset — satu payload untuk halaman Market Regime (kanban t_19f4f0d4).
//
// Halaman lama menyusun diri dari kartu per kategori: menambah seri = menambah blok UI. Route
// ini mengirim SATU kontrak: baris = instrumen, dikelompokkan per kelas aset, plus empat skor
// regime, kurva SUN, likuiditas (SRBI/JISDOR), internals IDX, dan strip coverage.
//
// Endpoint TERPISAH dari /api/idx/market-regime dengan sengaja:
//  - market-regime dipakai panel lama (kompatibilitas tidak diubah di kartu ini), dan
//  - hitungan beratnya (breadth) di sana N+1 per saham (~2 s). Di sini satu query bulk.
// Semua aturan kesegaran tetap SATU sumber: series-freshness.js (tidak ada ambang lokal).
//
// Tidak ada tombol refresh di UI; payload memuat `generated_at` supaya pembaca tahu kapan
// server membaca DB. Bila pipeline berhenti, `pipeline.state` + setiap baris turun ke 'na'
// dengan sebabnya (kontrak t_c6c01360) — halaman TIDAK boleh mengaku segar.
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const { db } = require('../db');
const freshnessUtil = require('../utils/series-freshness');
const crossAsset = require('../utils/cross-asset');
const idxInternals = require('../utils/idx-internals');
const regimeScore = require('../utils/regime-score');
const yieldCurve = require('../utils/yield-curve');
const { registerSqlAdjust } = require('../utils/price-adjust');

const router = express.Router();

// ca_adj() didaftarkan routes/idx.js saat modul dimuat. Route ini bisa dimuat lebih dulu
// (urutan require di index.js), jadi dipastikan di sini SEBELUM query bulk internals —
// tanpa ca_adj, breadth diam-diam memakai harga mentah (split = "turun").
function ensureSqlAdjust() {
  try {
    db.prepare("SELECT ca_adj(1, 'PROBE', '2000-01-01') AS v").get();
    return true;
  } catch (e) {
    try { registerSqlAdjust(db); return true; } catch (e2) { return false; }
  }
}

const LIQUIDITY_CODES = [
  { code: 'SRBI_TOTAL', label: 'SRBI total', unit: 'Rp tn' },
  { code: 'SRBI_NONRES', label: 'SRBI non-resident', unit: 'Rp tn' },
  { code: 'SRBI_OTHERS', label: 'SRBI others (repo ke BI)', unit: 'Rp tn' },
  { code: 'SRBI_JISDOR', label: 'JISDOR', unit: 'IDR/USD' },
];

router.get('/cross-asset', (req, res) => {
  const t0 = Date.now();
  try {
    ensureSqlAdjust();

    // Konteks kesegaran dibangun SEKALI, dipakai monitor + kurva + skor.
    const ctx = freshnessUtil.buildContext(db);
    const monitor = crossAsset.buildMonitor(db, ctx);
    const internals = idxInternals.buildInternals(db, { sessions: 201 });

    let curve = null;
    try { curve = yieldCurve.buildYieldCurve(db, { freshnessCtx: ctx }); }
    catch (e) { curve = { error: String(e.message || e), tenors: [], slopes: [], available: false }; }

    // Likuiditas: SRBI/JISDOR dari baris monitor yang sama (tidak ada jalur baca kedua).
    const byCode = new Map(monitor.series.map(s => [s.code, s]));
    const liquidity = {
      as_of: null,
      items: LIQUIDITY_CODES.map(spec => {
        const s = byCode.get(spec.code);
        if (!s) return { code: spec.code, label: spec.label, missing: true };
        return {
          code: spec.code, label: spec.label,
          unit: s.unit || spec.unit,
          last: s.last,                 // null bila 'excess' (bukan level terkini)
          last_bar_value: s.last_bar_value,
          as_of: s.as_of, age_days: s.age_days,
          chg_1: s.chg_1,               // perubahan 1 PERIODE seri (bulanan untuk SRBI) — bukan 3 bulan
          chg_1_unit: s.kind === 'price' ? '%' : (s.unit || null),
          period_1: s.window ? s.window.lags[0] + ' ' + s.window.unit : null,
          // `status` diteruskan apa adanya: tabel likuiditas tidak boleh punya aturan kesegaran
          // sendiri (dulu ia menyimpulkan 'stale/na/fresh' dari `state` dan itu menyembunyikan
          // seri SRBI yang umurnya lewat kadens).
          status: s.status,
          state: s.state, stale: s.stale, aged: s.aged,
          lag_sessions: s.lag_sessions, expected_lag_sessions: s.expected_lag_sessions,
          // Riwayat 30 titik untuk chart blok likuiditas. Diteruskan apa adanya dari seri monitor
          // (bukan query kedua): SRBI bulanan, jadi 30 titik = 2,5 tahun, bukan 30 hari.
          spark: Array.isArray(s.spark) ? s.spark : null,
          spark_dates: Array.isArray(s.spark_dates) ? s.spark_dates : null,
        };
      }),
    };
    liquidity.as_of = liquidity.items.map(i => i.as_of).filter(Boolean).sort()[0] || null;
    liquidity.note = 'SRBI & JISDOR terbit bulanan (bi.go.id/srbi). Umur data adalah bagian dari '
      + 'informasi: level tidak pernah ditulis sebagai angka hari ini.';

    const regime = regimeScore.buildRegimeScores(monitor.series, internals);
    const changed = crossAsset.changedToday(monitor.series, internals);
    const coverage = crossAsset.coverageOf(monitor, ctx, {
      extras: {
        curve: {
          as_of: curve ? curve.as_of : null,
          coverage: curve ? curve.coverage : null,
          state: curve && curve.freshness ? curve.freshness.state : null,
          lag_sessions: curve && curve.freshness ? curve.freshness.lag_sessions : null,
        },
        ownership: internals.ownership ? { period_date: internals.ownership.period_date, age_days: internals.ownership.age_days } : null,
        pipeline: ctx.pipeline || null,
      },
    });

    res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      ms: Date.now() - t0,
      as_of: internals.as_of || (curve && curve.as_of) || null,
      ref_date: ctx.ref_date || null,
      ref_source: ctx.ref_source || null,
      pipeline: ctx.pipeline || null,
      regime,
      monitor: {
        total_tickers: monitor.tickers_n,
        total_rows: monitor.series_n,
        groups: monitor.groups,
        columns: ['code', 'last', 'chg_1', 'chg_5', 'chg_20', 'chg_ytd', 'pctile_1y', 'as_of', 'source'],
        note: 'Baris = instrumen dari custom_tickers (bukan daftar tetap di UI). Jendela 1/5/20 '
          + 'mengikuti kadens seri: harian = sesi, bulanan = bulan. Perubahan = % untuk seri harga, '
          + 'pp/satuan untuk seri rate/level.',
      },
      changed_today: changed,
      liquidity,
      curve,
      internals: {
        as_of: internals.as_of,
        sessions: internals.sessions,
        window_from: internals.window_from,
        ihsg: internals.ihsg,
        ihsg_history: internals.ihsg_history || null,
        breadth: internals.breadth,
        foreign_flow: internals.foreign_flow,
        tape: internals.tape,
        sectors: internals.sectors ? {
          as_of: internals.sectors.as_of, method: internals.sectors.method, count: internals.sectors.count,
          top: internals.sectors.top, bottom: internals.sectors.bottom,
        } : null,
        ownership: internals.ownership,
      },
      coverage,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

  // ═══ /api/idx/suspensions — emiten yang TIDAK DIPERDAGANGKAN ═══
  // Bukti utama = data perdagangan, bukan pengumuman: bar dengan volume 0 (dan low 0) berarti
  // tidak ada transaksi. Terukur 20 Okt 2026: 203 kode punya low=0 sepanjang Agu-Okt dan
  // TIDAK SATU pun punya volume>0; hanya 51 yang punya pengumuman suspensi di tabel kita —
  // sisanya disuspend sebelum jendela pengumuman (data kita mulai 2025-01-01).
  // Pengumuman dipakai sebagai ALASAN/tanggal, bukan sebagai penentu status.
  router.get('/suspensions', (req, res) => {
    try {
      const minSessions = Number(req.query.sessions || 5);
      // sesi tanpa transaksi berturut-turut dari belakang, per kode
      const rows = db.prepare(`
        SELECT code, trade_date, volume, close, prev_close
          FROM idx_daily
         WHERE trade_date >= date('now', '-120 day')
         ORDER BY code, trade_date DESC`).all();
      const byCode = new Map();
      for (const r of rows) {
        if (!byCode.has(r.code)) byCode.set(r.code, []);
        byCode.get(r.code).push(r);
      }
      const active = [];
      for (const [code, list] of byCode) {
        let zero = 0, since = null;
        for (const b of list) {                       // list sudah terbaru dulu
          if (Number(b.volume) === 0) { zero++; since = b.trade_date; } else break;
        }
        if (zero < minSessions) continue;
        const ann = db.prepare(`SELECT suspend_date, title FROM company_suspends
                                 WHERE code=? ORDER BY suspend_date DESC LIMIT 1`).get(code);
        active.push({
          code, zero_sessions: zero, since,
          last_close: list[0].close,
          announced: ann ? ann.suspend_date : null,
          reason: ann ? String(ann.title || '').slice(0, 160) : null,
        });
      }
      active.sort((a, b) => b.zero_sessions - a.zero_sessions);
      res.json({
        ok: true,
        sessions_threshold: minSessions,
        counts: {
          halted: active.length,
          with_announcement: active.filter(x => x.announced).length,
          without_announcement: active.filter(x => !x.announced).length,
        },
        halted: active,
        rule: 'tidak ada transaksi (volume 0) minimal N sesi terakhir; pengumuman hanya memberi tanggal/alasan',
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  });

module.exports = router;
