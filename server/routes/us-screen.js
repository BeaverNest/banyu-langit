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
  rsi14: 's.rsi14', ret_1d: 's.ret_1d', ret_5d: 's.ret_5d',
};
const f2 = v => (v === null || v === undefined || Number.isNaN(v)) ? null : Math.round(v * 100) / 100;

router.get('/screen', (req, res) => {
  const t0 = Date.now();

  const sortKey = String(req.query.sort || 'ret_20d');
  if (!SORTS[sortKey]) return res.status(400).json({ ok: false, error: `sort tidak dikenal: ${sortKey}`, allowed: Object.keys(SORTS) });
  const order = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  // sesi terakhir yang benar-benar ada isinya
  const refDate = db.prepare("SELECT MAX(trade_date) d FROM signals_daily WHERE market='US'").get()?.d;
  if (!refDate) return res.json({ ok: true, as_of: null, rows: [], total: 0 });

  const num = k => (req.query[k] === undefined || req.query[k] === '' || Number.isNaN(Number(req.query[k]))) ? null : Number(req.query[k]);
  const inclEtf = String(req.query.incl_etf || '') === '1';
  const minPrice = num('min_price');

  // ── Universe ──────────────────────────────────────────────────────────────
  // Default: hanya EQUITY yang punya metadata. ETF dibuang bukan karena "tidak
  // menarik" tapi karena definisinya beda: ETF tidak punya sektor/industri,
  // harganya turunan dari isi keranjang, dan ETF leveraged (SOXS 3x bear)
  // memuncaki daftar return dengan angka yang bukan pergerakan emiten.
  const baseWhere = ["s.market='US'", 's.trade_date=?'];
  const baseArgs = [refDate];
  if (!inclEtf) {
    baseWhere.push("m.code IS NOT NULL");
    baseWhere.push("COALESCE(m.quote_type,'EQUITY') <> 'ETF'");
  }
  const baseSql = `FROM signals_daily s LEFT JOIN us_symbols_meta m ON m.code = s.code WHERE ${baseWhere.join(' AND ')}`;
  const universe = db.prepare(`SELECT COUNT(*) n ${baseSql}`).get(...baseArgs).n;

  // ── Filter ────────────────────────────────────────────────────────────────
  const where = baseWhere.slice();
  const args = baseArgs.slice();

  if (req.query.q) {
    where.push('(s.code LIKE ? OR m.name LIKE ?)');
    const q = `%${String(req.query.q).trim().toUpperCase()}%`;
    args.push(q, q);
  }
  if (req.query.sector) { where.push('m.sector = ?'); args.push(String(req.query.sector)); }
  if (req.query.industry) { where.push('m.industry LIKE ?'); args.push(`%${String(req.query.industry)}%`); }
  if (minPrice !== null) { where.push('s.close >= ?'); args.push(minPrice); }
  if (num('max_price') !== null) { where.push('s.close <= ?'); args.push(num('max_price')); }
  if (num('min_mcap') !== null) { where.push('m.market_cap >= ?'); args.push(num('min_mcap') * 1e9); }
  if (num('max_mcap') !== null) { where.push('m.market_cap <= ?'); args.push(num('max_mcap') * 1e9); }
  if (num('min_rsi') !== null) { where.push('s.rsi14 >= ?'); args.push(num('min_rsi')); }
  if (num('max_rsi') !== null) { where.push('s.rsi14 <= ?'); args.push(num('max_rsi')); }
  if (num('min_dist200') !== null) { where.push('s.dist_ma200 >= ?'); args.push(num('min_dist200')); }
  if (num('max_dist200') !== null) { where.push('s.dist_ma200 <= ?'); args.push(num('max_dist200')); }
  if (num('min_ret20') !== null) { where.push('s.ret_20d >= ?'); args.push(num('min_ret20')); }
  if (num('max_ret20') !== null) { where.push('s.ret_20d <= ?'); args.push(num('max_ret20')); }
  if (num('min_ret1') !== null) { where.push('s.ret_1d >= ?'); args.push(num('min_ret1')); }
  ['trend_up', 'cross200_up', 'vol_spike', 'break20'].forEach(f => {
    if (String(req.query['f_' + f] || '') === '1') where.push(`s.f_${f} = 1`);
  });

  const whereSql = where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) n ${baseSql.replace(baseWhere.join(' AND '), whereSql)}`).get(...args).n;

  const rows = db.prepare(`SELECT s.code, m.name, m.sector, m.industry, m.market_cap, m.quote_type, s.close,
      s.ret_1d, s.ret_5d, s.ret_20d, s.vol_ratio, s.dist_ma200, s.rsi14, s.macd_hist,
      s.f_trend_up, s.f_cross200_up, s.f_vol_spike, s.f_break20
    ${baseSql.replace(baseWhere.join(' AND '), whereSql)}
    ORDER BY ${SORTS[sortKey]} ${order} NULLS LAST LIMIT ? OFFSET ?`).all(...args, limit, offset);

  // ── Apa yang dibuang, supaya angkanya tidak terlihat "pasar = 1.135" padahal
  // signals_daily berisi 1.399 baris. Dihitung terpisah, bukan ditebak di UI.
  const allN = db.prepare("SELECT COUNT(*) n FROM signals_daily WHERE market='US' AND trade_date=?").get(refDate).n;
  const etfN = db.prepare(`SELECT COUNT(*) n FROM signals_daily s JOIN us_symbols_meta m ON m.code=s.code
      WHERE s.market='US' AND s.trade_date=? AND m.quote_type='ETF'`).get(refDate).n;
  const noMetaN = allN - db.prepare(`SELECT COUNT(*) n FROM signals_daily s JOIN us_symbols_meta m ON m.code=s.code
      WHERE s.market='US' AND s.trade_date=?`).get(refDate).n;
  const sub1N = db.prepare("SELECT COUNT(*) n FROM signals_daily WHERE market='US' AND trade_date=? AND close < 1").get(refDate).n;

  res.json({
    ok: true, generated_at: new Date().toISOString(), ms: Date.now() - t0,
    as_of: refDate, market: 'US', total, universe, limit, offset,
    sort: sortKey, order: order.toLowerCase(),
    incl_etf: inclEtf,
    excluded: { all: allN, etf: etfN, no_meta: noMetaN, below_1usd: sub1N },
    params: {
      q: req.query.q || null, sector: req.query.sector || null, industry: req.query.industry || null,
      min_price: minPrice, max_price: num('max_price'),
      min_mcap: num('min_mcap'), max_mcap: num('max_mcap'),
      min_rsi: num('min_rsi'), max_rsi: num('max_rsi'),
      min_dist200: num('min_dist200'), max_dist200: num('max_dist200'),
      min_ret20: num('min_ret20'), max_ret20: num('max_ret20'), min_ret1: num('min_ret1'),
      flags: ['trend_up', 'cross200_up', 'vol_spike', 'break20'].filter(f => String(req.query['f_' + f] || '') === '1'),
    },
    sectors: db.prepare("SELECT sector, COUNT(*) n FROM us_symbols_meta WHERE sector<>'' AND COALESCE(quote_type,'EQUITY')<>'ETF' GROUP BY sector ORDER BY n DESC").all(),
    rows: rows.map(r => ({
      code: r.code, name: r.name || null, sector: r.sector || null, industry: r.industry || null,
      quote_type: r.quote_type || null,
      last: f2(r.close), ret_1d: f2(r.ret_1d), ret_5d: f2(r.ret_5d), ret_20d: f2(r.ret_20d),
      mcap_b: r.market_cap ? f2(r.market_cap / 1e9) : null,
      vol_ratio: f2(r.vol_ratio), dist_ma200: f2(r.dist_ma200), rsi14: f2(r.rsi14), macd_hist: f2(r.macd_hist),
      flags: { trend_up: !!r.f_trend_up, cross200_up: !!r.f_cross200_up, vol_spike: !!r.f_vol_spike, break20: !!r.f_break20 },
    })),
    note: 'harga = adjusted close; mcap dalam miliar USD',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/us/market — payload menu US Market (indeks proxy + breadth + sektor +
// movers). Logika di server/utils/us-market.js supaya definisi return/median sama
// dengan tabel lain.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/market', (req, res) => {
  try {
    const { buildUsMarket } = require('../utils/us-market');
    const out = buildUsMarket(db, { days: req.query.days });
    if (!out.ok) return res.status(404).json(out);
    res.json(out);
  } catch (e) {
    console.error('[us-market]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
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
