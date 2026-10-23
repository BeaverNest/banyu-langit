'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/idx/metrics — metrik eksplisit untuk layar Screening (pengganti skor).
//
// Kenapa: skor komposit menyembunyikan asumsi (bobot manual + komponen yang tidak
// tersedia di pasar lain). Layar ini menampilkan besaran yang bisa dihitung ulang
// dari data mentah: return, posisi terhadap MA, RSI, rasio volume, arus asing,
// dan rasio valuasi. Tidak ada angka gabungan.
//
// Parameter: sort, order, limit (<=500), offset, sector, q
// Sumber: signals_daily (IDX, sesi terakhir) + idx_fundamental (snapshot terakhir)
//         + arus asing 5 sesi dari idx_daily.
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const { db } = require('../db');
const router = express.Router();

const SORTS = {
  code: 's.code', chg: 's.ret_1d', ret_5d: 's.ret_5d', ret_20d: 's.ret_20d',
  ma20_pct: 'ma20_pct', ma200_pct: 's.dist_ma200', rsi14: 's.rsi14',
  rel_vol: 's.vol_ratio', fnet_5d: 'fnet_5d', per: 'f.per', pbv: 'f.pbv',
  roe: 'f.roe', mcap: 'f.mkt_cap',
};
const f2 = v => (v === null || v === undefined || Number.isNaN(v)) ? null : Math.round(v * 100) / 100;

router.get('/metrics', (req, res) => {
  const t0 = Date.now();
  const sortKey = String(req.query.sort || 'ret_20d');
  if (!SORTS[sortKey]) return res.status(400).json({ ok: false, error: `sort tidak dikenal: ${sortKey}`, allowed: Object.keys(SORTS) });
  const order = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const refDate = db.prepare("SELECT MAX(trade_date) d FROM signals_daily WHERE market='IDX'").get()?.d;
  if (!refDate) return res.json({ ok: true, as_of: null, rows: [], total: 0 });
  const fundMonth = db.prepare('SELECT MAX(snapshot_month) m FROM idx_fundamental').get()?.m;

  // 5 sesi terakhir untuk arus asing per saham
  const last5 = db.prepare('SELECT DISTINCT trade_date d FROM idx_daily ORDER BY d DESC LIMIT 5').all().map(r => r.d);
  const fromDate = last5[last5.length - 1];
  const fnet = new Map();
  if (fromDate) {
    for (const r of db.prepare(`SELECT code, SUM((foreign_buy - foreign_sell) * close) v
      FROM idx_daily WHERE trade_date >= ? GROUP BY code`).all(fromDate)) fnet.set(r.code, r.v / 1e9);
  }

  const where = ["s.market='IDX'", 's.trade_date=?'];
  const args = [refDate];
  if (req.query.sector) { where.push('f.sector = ?'); args.push(String(req.query.sector)); }
  if (req.query.q) { where.push('(s.code LIKE ? OR f.name LIKE ?)'); const q = `%${String(req.query.q).trim().toUpperCase()}%`; args.push(q, q); }
  const whereSql = where.join(' AND ');

  const rows = db.prepare(`SELECT s.code, s.close, s.ret_1d, s.ret_5d, s.ret_20d, s.sma20, s.dist_ma200,
      s.rsi14, s.vol_ratio, f.name, f.sector, f.per, f.pbv, f.roe, f.mkt_cap,
      (s.close / s.sma20 - 1) * 100 AS ma20_pct
    FROM signals_daily s LEFT JOIN idx_fundamental f
      ON f.code = s.code AND f.snapshot_month = ?
    WHERE ${whereSql}`).all(fundMonth, ...args);

  for (const r of rows) r.fnet_5d = fnet.get(r.code) ?? null;

  const total = rows.length;
  rows.sort((a, b) => {
    const k = SORTS[sortKey].replace(/^[sf]\./, '');
    const av = a[k], bv = b[k];
    if (av == null) return 1; if (bv == null) return -1;
    if (typeof av === 'string') return (order === 'ASC' ? 1 : -1) * av.localeCompare(bv);
    return (order === 'ASC' ? 1 : -1) * (av - bv);
  });

  res.json({
    ok: true, generated_at: new Date().toISOString(), ms: Date.now() - t0,
    as_of: refDate, fund_snapshot: fundMonth, total, limit, offset,
    sort: sortKey, order: order.toLowerCase(),
    sectors: db.prepare("SELECT sector, COUNT(*) n FROM idx_fundamental WHERE snapshot_month=? AND sector<>'' GROUP BY sector ORDER BY n DESC").all(fundMonth),
    note: 'metrik eksplisit; tidak ada skor komposit. fnet_5d dalam miliar rupiah',
    rows: rows.slice(offset, offset + limit).map(r => ({
      code: r.code, name: r.name || null, sector: r.sector || null,
      close: f2(r.close), chg: f2(r.ret_1d), ret_5d: f2(r.ret_5d), ret_20d: f2(r.ret_20d),
      ma20_pct: f2(r.ma20_pct), ma200_pct: f2(r.dist_ma200),
      rsi14: f2(r.rsi14), rel_vol: f2(r.vol_ratio),
      fnet_5d: f2(r.fnet_5d), per: f2(r.per), pbv: f2(r.pbv), roe: f2(r.roe),
      mcap_t: r.mkt_cap ? f2(r.mkt_cap / 1e12) : null,
    })),
  });
});

module.exports = router;
