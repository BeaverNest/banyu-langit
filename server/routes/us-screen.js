'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/us/screen — penyaring saham AS (server-side, berpaginasi).
//
// Kenapa ada: route lama /api/idx/us-daily mengunci universe di 60 kode dan
// tidak punya pencarian/filter/urutan. Panel jadi hanya menampilkan 4% katalog.
//
// Sumber: signals_daily (market='US', sesi terakhir) JOIN us_symbols_meta.
// Semua angka dihitung/diformat di server; UI tidak menghitung apa pun.
//
// Parameter:
//   q        teks bebas (kode atau nama)
//   sector   nama sektor persis (Technology, Healthcare, ...)
//   industry teks bebas dalam industri
//   min_mcap / max_mcap   dalam miliar USD
//   sort     last|ret_1d|ret_5d|ret_20d|mcap|vol_ratio|dist_ma200  (default ret_20d)
//   order    desc|asc (default desc)
//   limit    1..200 (default 50) · offset >= 0
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const { db } = require('../db');
const router = express.Router();

const SORTS = {
  last: 's.close', ret_1d: 's.ret_1d', ret_5d: 's.ret_5d', ret_20d: 's.ret_20d',
  mcap: 'm.market_cap', vol_ratio: 's.vol_ratio', dist_ma200: 's.dist_ma200',
};
const f2 = v => (v === null || v === undefined || Number.isNaN(v)) ? null : Math.round(v * 100) / 100;

router.get('/screen', (req, res) => {
  const t0 = Date.now();

  const sortKey = String(req.query.sort || 'ret_20d');
  if (!SORTS[sortKey]) return res.status(400).json({ ok: false, error: `sort tidak dikenal: ${sortKey}`, allowed: Object.keys(SORTS) });
  const order = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  // sesi terakhir yang benar-benar ada isinya
  const refDate = db.prepare("SELECT MAX(trade_date) d FROM signals_daily WHERE market='US'").get()?.d;
  if (!refDate) return res.json({ ok: true, as_of: null, rows: [], total: 0 });

  const where = ["s.market='US'", 's.trade_date=?'];
  const args = [refDate];

  if (req.query.q) {
    where.push('(s.code LIKE ? OR m.name LIKE ?)');
    const q = `%${String(req.query.q).trim().toUpperCase()}%`;
    args.push(q, q);
  }
  if (req.query.sector) { where.push('m.sector = ?'); args.push(String(req.query.sector)); }
  if (req.query.industry) { where.push('m.industry LIKE ?'); args.push(`%${String(req.query.industry)}%`); }
  if (req.query.min_mcap) { where.push('m.market_cap >= ?'); args.push(Number(req.query.min_mcap) * 1e9); }
  if (req.query.max_mcap) { where.push('m.market_cap <= ?'); args.push(Number(req.query.max_mcap) * 1e9); }

  const whereSql = where.join(' AND ');
  const base = `FROM signals_daily s LEFT JOIN us_symbols_meta m ON m.code = s.code WHERE ${whereSql}`;

  const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(...args).n;
  const rows = db.prepare(`SELECT s.code, m.name, m.sector, m.industry, m.market_cap, s.close,
      s.ret_1d, s.ret_5d, s.ret_20d, s.vol_ratio, s.dist_ma200, s.rsi14,
      s.f_trend_up, s.f_cross200_up, s.f_vol_spike, s.f_break20
    ${base} ORDER BY ${SORTS[sortKey]} ${order} NULLS LAST LIMIT ? OFFSET ?`).all(...args, limit, offset);

  res.json({
    ok: true, generated_at: new Date().toISOString(), ms: Date.now() - t0,
    as_of: refDate, market: 'US', total, limit, offset,
    sort: sortKey, order: order.toLowerCase(),
    params: { q: req.query.q || null, sector: req.query.sector || null, industry: req.query.industry || null,
      min_mcap: req.query.min_mcap || null, max_mcap: req.query.max_mcap || null },
    sectors: db.prepare("SELECT sector, COUNT(*) n FROM us_symbols_meta WHERE sector<>'' GROUP BY sector ORDER BY n DESC").all(),
    rows: rows.map(r => ({
      code: r.code, name: r.name || null, sector: r.sector || null, industry: r.industry || null,
      last: f2(r.close), ret_1d: f2(r.ret_1d), ret_5d: f2(r.ret_5d), ret_20d: f2(r.ret_20d),
      mcap_b: r.market_cap ? f2(r.market_cap / 1e9) : null,
      vol_ratio: f2(r.vol_ratio), dist_ma200: f2(r.dist_ma200), rsi14: f2(r.rsi14),
      flags: { trend_up: !!r.f_trend_up, cross200_up: !!r.f_cross200_up, vol_spike: !!r.f_vol_spike, break20: !!r.f_break20 },
    })),
    note: 'angka sudah diformat server (2 desimal); harga = adjusted close',
  });
});

module.exports = router;

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/us/history/:code — OHLC satu ticker AS (pasar eksplisit di path).
// Ada supaya tidak pernah ada endpoint yang menerima `code` tanpa pasar:
// 22 ticker ada di IDX dan US sekaligus (AGRO, CBRE, COIN, FAST, ...).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/history/:code', (req, res) => {
  const t0 = Date.now();
  const code = String(req.params.code || '').toUpperCase().trim();
  if (!code) return res.status(400).json({ ok: false, error: 'code wajib' });
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 250, 5), 1300);

  const bars = db.prepare(`SELECT trade_date, open, high, low, close, volume
    FROM us_daily WHERE code=? ORDER BY trade_date DESC LIMIT ?`).all(code, days).reverse();
  if (!bars.length) return res.status(404).json({ ok: false, error: `tidak ada data US untuk ${code}` });

  const meta = db.prepare('SELECT name, sector, industry, market_cap FROM us_symbols_meta WHERE code=?').get(code) || {};
  res.json({
    ok: true, market: 'US', code, ms: Date.now() - t0, days,
    as_of: bars[bars.length - 1].trade_date, meta,
    basis: 'adjusted close (yahoo/yfinance:adj)',
    bars: bars.map(b => ({
      date: b.trade_date,
      open: f2(b.open), high: f2(b.high), low: f2(b.low), close: f2(b.close),
      volume: b.volume,
    })),
  });
});
