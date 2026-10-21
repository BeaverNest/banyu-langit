'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/idx/us-daily — saham AS dari tabel `us_daily` (kanban t_2c5e0fbb).
//
// Tabel diisi backfill yfinance (source `yahoo/yfinance:adj`, artinya CLOSE SUDAH
// DIADJUST untuk split + dividen; volume tidak diadjust). Karena itu semua persentase
// di route ini adalah total return harga-teradjust, bukan return harga mentah. Kalau
// nanti ada sumber lain masuk ke tabel yang sama, `source` per baris ikut dikirim
// supaya pembaca tahu baris mana yang basisnya beda.
//
// ATURAN: UI TIDAK MENGHITUNG. Last / 1D / 5D / 20D / YTD / persentil 52w semuanya
// dihitung di sini, sekali, dari satu jalur baca (us_daily). Panel Market Regime
// memakai aturan yang sama (server = satu sumber angka); dua implementasi persentase
// di UI+server adalah cacat yang sudah pernah terjadi di repo ini.
//
// Kontrak default (kartu): 20 kode, 250 bar. 20 kode default dipilih dari turnover
// 20 sesi terakhir (close*volume), bukan alfabetis — daftar alfabetis membuat panel
// menampilkan 20 nama acak. `?codes=all` mengambil seluruh isi tabel (<=60).
//
// Kesegaran: TIDAK ada ambang basi lokal di sini. `as_of` = max(trade_date) dan
// `lag_sessions` per baris = jumlah sesi (tanggal unik di tabel) setelah bar terakhir
// kode itu. Bila pipeline berhenti, lag membesar dan itu terlihat — tidak ada klaim
// "segar" dari route ini.
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const { db } = require('../db');

const router = express.Router();

const TABLE = 'us_daily';
const MAX_CODES = 40;        // daftar eksplisit ?codes=A,B,C
const MAX_CODES_ALL = 60;    // ?codes=all
const DEFAULT_CODES = 20;    // kartu: default 20 kode
const DEFAULT_DAYS = 250;    // kartu: default 250 bar
const MIN_DAYS = 5;
const MAX_DAYS = 1300;       // 5 tahun bursa AS ~1254 sesi; batas atas supaya payload tidak meledak
const PCTILE_WINDOW = 252;   // 52 minggu bursa AS
const CODE_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;   // BRK.B / BF-B sah, "aapl" di-uppercase dulu

function fail(res, status, message, extra) {
  return res.status(status).json(Object.assign({ ok: false, error: message }, extra || {}));
}

function r2(v) {
  return (v === null || v === undefined || !isFinite(v)) ? null : Math.round(v * 100) / 100;
}

// (last/base - 1) * 100; null bila basis tidak ada atau nol (bar hilang / seri baru).
function pctChange(last, base) {
  if (last === null || last === undefined || base === null || base === undefined) return null;
  if (!isFinite(last) || !isFinite(base) || base === 0) return null;
  return r2((last / base - 1) * 100);
}

function availableCodes() {
  return db.prepare('SELECT DISTINCT code FROM ' + TABLE + ' ORDER BY code').all().map(r => r.code);
}

// Default 20 = turnover 20 sesi terakhir terbesar. Deterministik: ORDER BY turnover DESC, code ASC.
function topByTurnover(n) {
  return db.prepare(
    'SELECT code, SUM(close*volume) AS turnover FROM (' +
    '  SELECT code, close, volume, ROW_NUMBER() OVER (PARTITION BY code ORDER BY trade_date DESC) rn' +
    '  FROM ' + TABLE +
    ') WHERE rn <= 20 GROUP BY code ORDER BY turnover DESC, code ASC LIMIT ' + Number(n)
  ).all().map(r => r.code);
}

// Seluruh baris untuk kode terpilih, ASC per kode. 36 kode x ~1254 bar ~ 45k baris:
// cukup kecil untuk dibaca sekaligus, dan YTD + 52w butuh riwayat lebih panjang dari
// `days` (jendela spark) — satu query lebih jujur daripada dua jendela berbeda.
function loadSeries(codes) {
  if (!codes.length) return new Map();
  const sql = 'SELECT code, trade_date, close, volume, source FROM ' + TABLE +
    ' WHERE code IN (' + codes.map(() => '?').join(',') + ') ORDER BY code ASC, trade_date ASC';
  const byCode = new Map();
  for (const r of db.prepare(sql).all(...codes)) {
    if (r.close === null || r.close === undefined || !isFinite(r.close) || r.close <= 0) continue;
    if (!byCode.has(r.code)) byCode.set(r.code, []);
    byCode.get(r.code).push(r);
  }
  return byCode;
}

router.get('/us-daily', (req, res) => {
  const t0 = Date.now();
  try {
    // ── validasi `days` ────────────────────────────────────────────────────
    let days = DEFAULT_DAYS;
    const daysRaw = req.query.days;
    if (daysRaw !== undefined && String(daysRaw).trim() !== '') {
      const n = Number(String(daysRaw).trim());
      if (!Number.isInteger(n) || n < MIN_DAYS || n > MAX_DAYS) {
        return fail(res, 400, 'days must be an integer between ' + MIN_DAYS + ' and ' + MAX_DAYS +
          ', got ' + JSON.stringify(daysRaw));
      }
      days = n;
    }

    // ── validasi `codes` ───────────────────────────────────────────────────
    const codesRaw = req.query.codes === undefined ? '' : String(req.query.codes).trim();
    let codes, codesSource, codesTruncated = false;

    if (!codesRaw) {
      codesSource = 'default_top' + DEFAULT_CODES + '_by_turnover';
      codes = topByTurnover(DEFAULT_CODES);
    } else if (codesRaw.toLowerCase() === 'all') {
      codesSource = 'all';
      const all = availableCodes();
      codes = all.slice(0, MAX_CODES_ALL);
      codesTruncated = all.length > MAX_CODES_ALL;
    } else {
      codesSource = 'explicit';
      codes = codesRaw.split(',').map(c => c.toUpperCase().trim()).filter(Boolean);
      if (!codes.length || codes.length > MAX_CODES) {
        return fail(res, 400, 'codes must be 1..' + MAX_CODES + ' comma-separated tickers (or "all")',
          { got: req.query.codes });
      }
      const bad = codes.find(c => !CODE_RE.test(c));
      if (bad) return fail(res, 400, 'code must match ' + String(CODE_RE) + ', got ' + JSON.stringify(bad));
      codes = Array.from(new Set(codes));   // duplikat tidak menghasilkan baris ganda
    }

    if (!codes.length) {
      return res.json({
        ok: true, generated_at: new Date().toISOString(), ms: Date.now() - t0,
        source_table: TABLE, as_of: null, ref_date: null,
        params: { codes_source: codesSource, codes: [], days, pctile_window_52w: PCTILE_WINDOW },
        rows: [], missing: [],
        note: TABLE + ' is empty — run the yfinance backfill before reading this route',
      });
    }

    const series = loadSeries(codes);

    // Sesi rujukan = max(trade_date) di seluruh tabel, dan daftar tanggal unik untuk lag per baris.
    const allDates = db.prepare('SELECT DISTINCT trade_date FROM ' + TABLE + ' ORDER BY trade_date').all().map(r => r.trade_date);
    const refDate = allDates.length ? allDates[allDates.length - 1] : null;
    const dateIndex = new Map(allDates.map((d, i) => [d, i]));

    const rows = [];
    const missing = [];
    for (const code of codes) {
      const bars = series.get(code);
      if (!bars || !bars.length) { missing.push(code); continue; }

      const closes = bars.map(b => b.close);
      const n = closes.length;
      const lastBar = bars[n - 1];
      const last = lastBar.close;

      // YTD: bar terakhir SEBELUM 1 Jan tahun berjalan (bukan "252 bar lalu").
      const year = String(lastBar.trade_date).slice(0, 4);
      const ytdCut = year + '-01-01';
      let ytdBase = null, ytdBaseDate = null;
      for (let i = n - 1; i >= 0; i--) {
        if (bars[i].trade_date < ytdCut) { ytdBase = bars[i].close; ytdBaseDate = bars[i].trade_date; break; }
      }

      // Persentil 52w: peringkat close terakhir di antara (n-1) close sebelumnya dalam
      // jendela 252 sesi. 0 = terendah di jendela, 100 = tertinggi. Basisnya peringkat,
      // bukan interpolasi — angkanya bisa dibaca ulang dari data mentah.
      const win = bars.slice(Math.max(0, n - PCTILE_WINDOW));
      const wCloses = win.map(b => b.close);
      const wLast = wCloses[wCloses.length - 1];
      let pctile = null;
      if (wCloses.length >= 2) {
        const prev = wCloses.slice(0, wCloses.length - 1);
        let below = 0;
        for (const v of prev) if (v < wLast) below++;
        pctile = r2((below / prev.length) * 100);
      }
      const wLow = wCloses.length ? Math.min.apply(null, wCloses) : null;
      const wHigh = wCloses.length ? Math.max.apply(null, wCloses) : null;

      // Spark = `days` bar terakhir (jendela tampilan), 2 desimal.
      const sparkBars = bars.slice(Math.max(0, n - days));
      const lagIdx = dateIndex.has(lastBar.trade_date) ? dateIndex.get(lastBar.trade_date) : null;

      rows.push({
        code,
        name: null,                             // us_daily belum menyimpan nama emiten
        as_of: lastBar.trade_date,
        source: lastBar.source,
        last: r2(last),
        chg_1d_pct: n >= 2 ? pctChange(last, closes[n - 2]) : null,
        chg_5d_pct: n >= 6 ? pctChange(last, closes[n - 6]) : null,
        chg_20d_pct: n >= 21 ? pctChange(last, closes[n - 21]) : null,
        chg_ytd_pct: pctChange(last, ytdBase),
        ytd_base_date: ytdBaseDate,
        pctile_52w: pctile,
        low_52w: r2(wLow),
        high_52w: r2(wHigh),
        n_bars: n,
        n_bars_window: win.length,
        first_date: bars[0].trade_date,
        // Sesi setelah bar terakhir kode ini (0 = ikut sesi rujukan).
        lag_sessions: lagIdx === null ? null : (allDates.length - 1 - lagIdx),
        spark: sparkBars.map(b => r2(b.close)),
        spark_dates: sparkBars.map(b => b.trade_date),
      });
    }

    // Urutan baris: eksplisit = urutan permintaan; all = kode; default = turnover (sudah urut dari SQL).
    if (codesSource === 'explicit') {
      const order = new Map(codes.map((c, i) => [c, i]));
      rows.sort((a, b) => order.get(a.code) - order.get(b.code));
    } else if (codesSource === 'all') {
      rows.sort((a, b) => a.code.localeCompare(b.code));
    }

    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      ms: Date.now() - t0,
      source_table: TABLE,
      as_of: refDate,
      ref_date: refDate,
      params: {
        codes_source: codesSource,
        codes,
        codes_n: codes.length,
        codes_truncated: codesTruncated,
        days,
        pctile_window_52w: PCTILE_WINDOW,
        codes_missing_n: missing.length,
      },
      basis: {
        price: 'adjusted close (yahoo/yfinance:adj — split + dividend adjusted)',
        chg_1d: 'last close vs previous bar',
        chg_5d: 'last close vs close 5 bars earlier (null bila riwayat < 6 bar)',
        chg_20d: 'last close vs close 20 bars earlier (null bila riwayat < 21 bar)',
        chg_ytd: 'last close vs last close before 1 Jan of the last bar year (null bila tidak ada bar tahun lalu)',
        pctile_52w: 'rank of last close among the previous closes in the trailing ' + PCTILE_WINDOW +
          ' sessions; 0 = window low, 100 = window high',
        lag_sessions: 'distinct trade_date rows in ' + TABLE + ' after this code last bar (0 = current)',
      },
      rows,
      missing,
    });
  } catch (e) {
    return fail(res, 500, 'us-daily read failed: ' + String(e && e.message ? e.message : e));
  }
});

// Tidak ada catch-all 404 di router ini: ia dipasang di /api/idx bersama router lain
// (idx.js, cross-asset.js), jadi menangkap semua path tak dikenal akan menelan route
// milik router yang dipasang SETELAHNYA. Path asing cukup jatuh ke handler berikutnya.

module.exports = router;
