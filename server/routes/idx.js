const express = require('express');
const { db, latestIdxDate } = require('../db');
const { parseTradeDate } = require('../utils/normalize');
const { toIsoDate } = require('../utils/iso-date');
const { getCodeVersion } = require('../utils/code-version');
const { loadFactors, adjustRows, factorAt, factorForRow, fallbackRatioActions, registerSqlAdjust } = require('../utils/price-adjust');
const freshnessUtil = require('../utils/series-freshness');
const pullLog = require('../utils/pull-log');
const { allowsNonPositive, strictNum } = require('../utils/series-sign');

// Provenance stamp written into every daily_scores row (agent rail contract):
// names the variant of each derived indicator, so a stored number stays auditable
// after the formula source is edited. Keep in sync with utils/indicators.js.
const SCORE_VARIANT = 'rsi=cutler;ma=sma;macd=ema9_standard';

// ca_adj(close, code, trade_date): satu-satunya jalur untuk query agregat (AVG/GROUP BY)
// yang tidak bisa memakai adjustRows() di JS. Definisinya di utils/price-adjust.js.
registerSqlAdjust(db);

const router = express.Router();

module.exports = function(upload) {
  // Quote
  router.get('/quote', (req, res) => {
    const code = (req.query.code || '').toUpperCase().trim();
    if (!code) return res.json({ error: 'No code' });
    const td = latestIdxDate(); if (!td) return res.json({ error: 'No data' });
    const row = db.prepare('SELECT * FROM idx_daily WHERE trade_date=? AND code=?').get(td, code);
    if (!row) return res.json({ error: 'Not found' });
    const chgPct = row.prev_close ? ((row.close - row.prev_close) / row.prev_close * 100) : 0;
    // Check suspend status
    const isSuspended = getSuspendedSet().has(code);
    res.json({ ...row, change_pct: Math.round(chgPct * 100) / 100, foreign_net: row.foreign_buy - row.foreign_sell, foreign_buy_val: row.foreign_buy * row.close, foreign_sell_val: row.foreign_sell * row.close, foreign_net_val: (row.foreign_buy - row.foreign_sell) * row.close, market_cap: row.close * row.listed_shares, suspended: isSuspended });
  });

  // ═══ Suspended stocks — currently suspended (latest event per code is "Suspend") ═══
  let _suspendedCache = { set: null, ts: 0 };
  function getSuspendedSet() {
    if (_suspendedCache.set && Date.now() - _suspendedCache.ts < 300000) return _suspendedCache.set;
    try {
      // Get latest suspend/unsuspend event per code
      const rows = db.prepare(`
        SELECT code, type, suspend_date FROM company_suspends
        WHERE (code, suspend_date) IN (
          SELECT code, MAX(suspend_date) FROM company_suspends GROUP BY code
        )
      `).all();
      const suspended = new Set();
      rows.forEach(r => { if (r.type === 'Suspend' || r.type === 'suspend') suspended.add(r.code); });
      _suspendedCache = { set: suspended, ts: Date.now() };
      return suspended;
    } catch { return new Set(); }
  }

  router.get('/suspended', (req, res) => {
    try {
      const suspended = getSuspendedSet();
      const list = [...suspended].sort();
      res.json({ count: list.length, codes: list });
    } catch (e) { res.json({ count: 0, codes: [], error: e.message }); }
  });

  // ═══ Point-in-time snapshot helpers (IC Staleness) ═══
  function getFundSnapshotMonths() {
    try {
      return db.prepare('SELECT DISTINCT snapshot_month FROM idx_fundamental ORDER BY snapshot_month').all().map(r => r.snapshot_month);
    } catch { return []; }
  }
  function getPointInTimeSnapshot(scoringDate, snapshotMonths) {
    const scoringMonth = scoringDate.substring(0, 7);
    for (let i = snapshotMonths.length - 1; i >= 0; i--) {
      if (snapshotMonths[i] <= scoringMonth) return snapshotMonths[i];
    }
    return snapshotMonths.length ? snapshotMonths[0] : null;
  }
  function calcDataAgeMonths(scoringDate, snapshotMonth) {
    if (!scoringDate || !snapshotMonth) return null;
    const sd = new Date(scoringDate + 'T00:00:00');
    const sm = new Date(snapshotMonth + '-01T00:00:00');
    return (sd.getFullYear() - sm.getFullYear()) * 12 + (sd.getMonth() - sm.getMonth());
  }
  // Normalize fs_date from MM/DD/YYYY or YYYY-MM-DD to YYYY-MM-DD
  function normalizeFsDateGlobal(fd) {
    if (!fd) return null;
    if (/^\d{4}-\d{2}/.test(fd)) return fd.substring(0, 10);
    var parts = fd.split('/');
    if (parts.length === 3) return parts[2] + '-' + parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0');
    return null;
  }
  // Compute data age in months: scoring_date vs fs_date (fiscal period end)
  // This is per-stock — each company has different fs_date
  function calcFsAge(scoringDate, fsDateRaw) {
    const fd = normalizeFsDateGlobal(fsDateRaw);
    if (!fd || !scoringDate) return null;
    const sd = new Date(scoringDate + 'T00:00:00');
    const fs = new Date(fd + 'T00:00:00');
    if (isNaN(fs.getTime())) return null;
    return (sd.getFullYear() - fs.getFullYear()) * 12 + (sd.getMonth() - fs.getMonth());
  }

  // ═══ PIT fundamental source #2 — IDX-API `financial_ratios` (quarterly reports) ═══
  // Sits NEXT TO getPITFundMap (which reads the monthly screener snapshot
  // `idx_fundamental`). Neither replaces the other; the caller picks with a parameter.
  //
  // Why a second source: `idx_fundamental` carries ratios only — `assets`,
  // `liabilities`, `equity`, `sales`, `profit`, `ebt` are 0 on every row and `fs_date`
  // is '' — so no stored ratio can be reproduced or audited from the table itself.
  // `financial_ratios` carries the absolute fields, so ROE/ROA/NPM can be rebuilt under
  // a definition we own and can test.
  //
  // Rules enforced here — each is a decision with a reason, not an accident:
  //  • availability: `available_from = quarter_end + lagDays`. The quarter end is NEVER
  //    itself the availability date; BEI publishes the report after the period closes,
  //    so treating the quarter end as known is look-ahead. Default 45 days, overridable.
  //  • `sales`/`profit` are YTD cumulative. They are de-cumulated into single quarters
  //    (Qn = YTDn − YTDn−1, Q1 = YTD1) and four quarters are summed to build TTM before
  //    any ratio is derived.
  //  • the stored `roe`/`roa`/`npm` columns are NOT used for interim periods: they are
  //    quarter-annualised upstream (BBCA Q1-25 npm = 221.9, i.e. ~4x its H1 value), not
  //    TTM, and they do not reproduce profit/sales, profit/equity, profit/assets. Our own
  //    TTM figures are used instead. `der` IS taken as-is (it reproduces
  //    liabilities/equity on 99.35% of the 18,316 rows that have equity > 0).
  //  • a code whose 4-quarter window is incomplete is EXCLUDED, never approximated.
  const RATIO_LAG_DAYS_DEFAULT = 45;
  const _ratioNum = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
  const RATIO_QUARTER_END_RE = /^\d{4}-(03-31|06-30|09-30|12-31)$/;
  function isoAddDays(iso, days) {
    return new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  }
  let _ratioSeries = { fp: null, quarters: [], byCode: {}, periods: new Set(), codes: [] };
  function loadRatioSeries() {
    // Rebuild only when the table actually changed — a cheap fingerprint beats a TTL guess.
    const f = db.prepare("SELECT COUNT(*) c, IFNULL(MAX(period),'') mx FROM financial_ratios").get();
    const fp = f.c + '|' + f.mx;
    if (_ratioSeries.fp === fp) return _ratioSeries;
    const rows = db.prepare('SELECT code, period, name, sector, industry, assets, liabilities, equity, sales, ebt, profit, eps, book_value, per, pbv, der FROM financial_ratios').all();
    const byCode = {}, periods = new Set();
    rows.forEach(r => {
      if (!r.period || !RATIO_QUARTER_END_RE.test(r.period)) return; // non quarter-end rows exist (46 of them) — ignored
      periods.add(r.period);
      (byCode[r.code] = byCode[r.code] || {})[r.period] = r;
    });
    _ratioSeries = { fp, quarters: [...periods].sort(), byCode, periods, codes: Object.keys(byCode) };
    return _ratioSeries;
  }
  // Single-quarter figures for `code` at `q`. null when the prior quarter needed to
  // de-cumulate is absent — the caller treats that as "incomplete window".
  function ratioSingleQuarter(series, code, q, qi) {
    const row = series.byCode[code][q];
    if (!row) return null;
    if (q.substring(5, 7) === '03') return { sales: _ratioNum(row.sales), profit: _ratioNum(row.profit) };
    const prev = qi > 0 ? series.quarters[qi - 1] : null;
    const prow = prev ? series.byCode[code][prev] : null;
    if (!prow) return null;
    return { sales: _ratioNum(row.sales) - _ratioNum(prow.sales), profit: _ratioNum(row.profit) - _ratioNum(prow.profit) };
  }
  // TTM block for `code` ending at quarter `q`. null => incomplete window => excluded.
  function ratioTTMBlock(series, code, q) {
    const qi = series.quarters.indexOf(q);
    if (qi < 3) return null;
    const win = [series.quarters[qi - 3], series.quarters[qi - 2], series.quarters[qi - 1], q];
    let ttmSales = 0, ttmProfit = 0;
    for (let i = 0; i < 4; i++) {
      const sq = ratioSingleQuarter(series, code, win[i], qi - 3 + i);
      if (!sq) return null;
      ttmSales += sq.sales; ttmProfit += sq.profit;
    }
    const row = series.byCode[code][q];
    return {
      quarter: q, window: win, ttm_sales: ttmSales, ttm_profit: ttmProfit,
      equity: _ratioNum(row.equity), assets: _ratioNum(row.assets), liabilities: _ratioNum(row.liabilities),
      book_value: _ratioNum(row.book_value), der: _ratioNum(row.der),
      per: _ratioNum(row.per), pbv: _ratioNum(row.pbv),
      name: row.name || '', sector: row.sector || '', industry: row.industry || ''
    };
  }
  // Freshest quarter whose availability date has passed at `scoringDate`.
  function ratioPITSnapshot(series, scoringDate, lagDays) {
    const lag = Number.isFinite(lagDays) ? lagDays : RATIO_LAG_DAYS_DEFAULT;
    const sd = Date.parse(scoringDate + 'T00:00:00Z');
    if (!isFinite(sd)) return null;
    let best = null;
    for (const q of series.quarters) {
      if (Date.parse(q + 'T00:00:00Z') + lag * 86400000 <= sd) best = q; else break;
    }
    return best;
  }
  let _ratioMapCache = { fp: null, maps: {} };
  // code → factor block for one quarter, built from OUR TTM, never from the stored
  // annualised columns. Codes with an incomplete 4-quarter window are absent from the map
  // (excluded, not approximated). Single implementation shared by the backfill path
  // (getPITFundMapFromRatio) and by /ic-fund-source, so the study cannot drift from the
  // production path it is supposed to be measuring.
  function ratioFactorMap(quarter) {
    const series = loadRatioSeries();
    if (_ratioMapCache.fp !== series.fp) _ratioMapCache = { fp: series.fp, maps: {} };
    if (_ratioMapCache.maps[quarter]) return _ratioMapCache.maps[quarter];
    const map = {};
    series.codes.forEach(code => {
      const t = ratioTTMBlock(series, code, quarter);
      if (!t) return;
      const shares = (t.equity > 0 && t.book_value > 0) ? t.equity / t.book_value : 0;
      map[code] = {
        code, name: t.name, sector: t.sector, industry: t.industry,
        roe: t.equity > 0 ? t.ttm_profit / t.equity * 100 : 0,
        roa: t.assets > 0 ? t.ttm_profit / t.assets * 100 : 0,
        npm: t.ttm_sales > 0 ? t.ttm_profit / t.ttm_sales * 100 : 0,
        der: t.der,
        per: t.per, pbv: t.pbv,                 // as reported at the quarter end (stale price)
        book_value: t.book_value, eps_ttm: shares > 0 ? t.ttm_profit / shares : 0,
        ttm_profit: t.ttm_profit, ttm_sales: t.ttm_sales, equity: t.equity, assets: t.assets,
        fs_date: quarter,                       // fiscal period end drives data_age_months
        ttm_window: t.window.join(',')
      };
    });
    _ratioMapCache.maps[quarter] = map;
    return map;
  }
  // PIT map from financial_ratios. Mirrors getPITFundMap's return shape so callers can
  // swap sources without touching anything else.
  function getPITFundMapFromRatio(tradeDate, opts) {
    const o = opts || {};
    const lag = Number.isFinite(o.lagDays) ? o.lagDays : RATIO_LAG_DAYS_DEFAULT;
    const series = loadRatioSeries();
    const snap = ratioPITSnapshot(series, tradeDate, lag);
    if (!snap) return { map: {}, snapshot: null, available_from: null, lag_days: lag, source: 'financial_ratios', considered: series.codes.length, ttm_complete: 0, excluded: series.codes.length };
    const map = ratioFactorMap(snap);
    return {
      map, snapshot: snap, available_from: isoAddDays(snap, lag), lag_days: lag,
      source: 'financial_ratios', considered: series.codes.length,
      ttm_complete: Object.keys(map).length, excluded: series.codes.length - Object.keys(map).length
    };
  }

  // Top rankings
  router.get('/top', (req, res) => {
    const sort = req.query.sort || 'foreign_net';
    const dir = req.query.dir || 'desc';
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const td = latestIdxDate(); if (!td) return res.json([]);
    let orderExpr = 'value DESC';
    if (sort === 'foreign_net') orderExpr = `(foreign_buy-foreign_sell)*close ${dir === 'asc' ? 'ASC' : 'DESC'}`;
    else if (sort === 'change_pct') orderExpr = `CASE WHEN prev_close>0 THEN CAST((close-prev_close)AS REAL)/prev_close ELSE 0 END ${dir === 'asc' ? 'ASC' : 'DESC'}`;
    else if (sort === 'market_cap') orderExpr = `(close*listed_shares) ${dir === 'asc' ? 'ASC' : 'DESC'}`;
    else if (['value', 'volume', 'frequency'].includes(sort)) orderExpr = `${sort} ${dir === 'asc' ? 'ASC' : 'DESC'}`;
    const rows = db.prepare(`SELECT *, (foreign_buy-foreign_sell) as foreign_net, (foreign_buy*close) as foreign_buy_val, (foreign_sell*close) as foreign_sell_val, ((foreign_buy-foreign_sell)*close) as foreign_net_val, CASE WHEN prev_close>0 THEN ROUND(CAST((close-prev_close)AS REAL)/prev_close*100,2) ELSE 0 END as change_pct, (close*listed_shares) as market_cap FROM idx_daily WHERE trade_date=? AND close>0 ORDER BY ${orderExpr} LIMIT ?`).all(td, limit);
    res.json({ trade_date: td, data: rows });
  });

  // ═══ AUTOCOMPLETE — ticker search for chart panel / global search ═══
  router.get('/autocomplete', (req, res) => {
    try {
      const q = (req.query.q || '').toUpperCase().trim();
      const limit = Math.min(parseInt(req.query.limit) || 10, 20);
      if (!q) return res.json([]);
      const td = latestIdxDate();
      if (!td) return res.json([]);
      // Stock tickers
      const stocks = db.prepare(
        `SELECT DISTINCT code, name, 'stock' as type FROM idx_daily
         WHERE trade_date=? AND close>0 AND (code LIKE ? OR name LIKE ?)
         ORDER BY CASE WHEN code LIKE ? THEN 0 ELSE 1 END, value DESC
         LIMIT ?`
      ).all(td, q + '%', '%' + q + '%', q + '%', limit);
      // Index tickers from idx_indices
      let indices = [];
      try {
        indices = db.prepare(
          `SELECT DISTINCT index_code as code, index_code as name, 'index' as type FROM idx_indices
           WHERE index_code LIKE ? GROUP BY index_code ORDER BY index_code LIMIT 5`
        ).all('%' + q + '%');
      } catch(e) {}
      // Custom tickers
      let customs = [];
      try {
        customs = db.prepare(
          `SELECT code, name, 'custom' as type FROM custom_tickers
           WHERE code LIKE ? OR name LIKE ? ORDER BY code LIMIT 5`
        ).all(q + '%', '%' + q + '%');
      } catch(e) {}
      // Merge: indices first, then stocks, then custom
      const merged = [...indices, ...stocks, ...customs].slice(0, limit);
      res.json(merged.map(r => ({ code: r.code, name: r.name || '', type: r.type || 'stock' })));
    } catch (e) { res.json([]); }
  });

  // Summary
  router.get('/summary', (req, res) => {
    try {
      const td = latestIdxDate(); if (!td) return res.json({ error: 'No data' });
      const s = db.prepare(`SELECT COUNT(*)as total_stocks, SUM(CASE WHEN close>prev_close THEN 1 ELSE 0 END)as advancers, SUM(CASE WHEN close<prev_close THEN 1 ELSE 0 END)as decliners, SUM(CASE WHEN close=prev_close THEN 1 ELSE 0 END)as unchanged, SUM(value)as total_value, SUM(volume)as total_volume, SUM(frequency)as total_freq, SUM(foreign_buy*close)as total_fbuy_val, SUM(foreign_sell*close)as total_fsell_val, SUM((foreign_buy-foreign_sell)*close)as total_fnet_val, SUM(CASE WHEN (foreign_buy-foreign_sell)>0 THEN 1 ELSE 0 END)as foreign_buy_stocks, SUM(CASE WHEN (foreign_buy-foreign_sell)<0 THEN 1 ELSE 0 END)as foreign_sell_stocks FROM idx_daily WHERE trade_date=? AND close>0`).get(td);
      res.json({ trade_date: td, ...s });
    } catch (e) { res.json({ error: e.message }); }
  });

  // Daily Digest
  router.get('/digest', (req, res) => {
    try {
      const td = latestIdxDate(); if (!td) return res.json({ error: 'No data' });
      const allDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT 5').all().map(r => r.trade_date);
      const prevDate = allDates.length > 1 ? allDates[1] : null;
      const today = db.prepare(`SELECT COUNT(*)as total, SUM(CASE WHEN close>prev_close THEN 1 ELSE 0 END)as advancers, SUM(CASE WHEN close<prev_close THEN 1 ELSE 0 END)as decliners, SUM(value)as total_value, SUM(foreign_buy*close)as fbuy, SUM(foreign_sell*close)as fsell, SUM((foreign_buy-foreign_sell)*close)as fnet, SUM(CASE WHEN (foreign_buy-foreign_sell)>0 THEN 1 ELSE 0 END)as fbuy_stocks, SUM(CASE WHEN (foreign_buy-foreign_sell)<0 THEN 1 ELSE 0 END)as fsell_stocks FROM idx_daily WHERE trade_date=? AND close>0`).get(td);
      let prevNet = 0, fnetDelta = 0;
      if (prevDate) {
        const prev = db.prepare(`SELECT SUM((foreign_buy-foreign_sell)*close)as fnet FROM idx_daily WHERE trade_date=? AND close>0`).get(prevDate);
        prevNet = prev?.fnet || 0;
        fnetDelta = (today.fnet || 0) - prevNet;
      }
      const topBuy = db.prepare(`SELECT code, name, ((foreign_buy-foreign_sell)*close) as fnet_val, CASE WHEN prev_close>0 THEN ROUND(CAST((close-prev_close)AS REAL)/prev_close*100,2) ELSE 0 END as chg FROM idx_daily WHERE trade_date=? AND close>0 AND (foreign_buy-foreign_sell)>0 ORDER BY (foreign_buy-foreign_sell)*close DESC LIMIT 3`).all(td);
      const topSell = db.prepare(`SELECT code, name, ((foreign_buy-foreign_sell)*close) as fnet_val, CASE WHEN prev_close>0 THEN ROUND(CAST((close-prev_close)AS REAL)/prev_close*100,2) ELSE 0 END as chg FROM idx_daily WHERE trade_date=? AND close>0 AND (foreign_buy-foreign_sell)<0 ORDER BY (foreign_buy-foreign_sell)*close ASC LIMIT 3`).all(td);
      let spikes = [];
      const prevDates = allDates.filter(d => d < td).slice(0, 4);
      if (prevDates.length >= 2) {
        const ph = prevDates.map(() => '?').join(',');
        spikes = db.prepare(`SELECT t.code, t.name, t.volume, t.frequency, a.avg_vol, ROUND(CAST(t.volume AS REAL)/a.avg_vol,1) as ratio, CASE WHEN t.prev_close>0 THEN ROUND(CAST((t.close-t.prev_close)AS REAL)/t.prev_close*100,2) ELSE 0 END as chg FROM idx_daily t JOIN (SELECT code, AVG(volume)as avg_vol FROM idx_daily WHERE trade_date IN (${ph}) AND volume>0 GROUP BY code) a ON t.code=a.code WHERE t.trade_date=? AND t.close>0 AND t.volume>0 AND a.avg_vol>0 AND CAST(t.volume AS REAL)/a.avg_vol>3 ORDER BY CAST(t.volume AS REAL)/a.avg_vol DESC LIMIT 3`).all(...prevDates, td);
      }
      let streaks = [];
      if (allDates.length >= 3) {
        const last3 = allDates.slice(0, 3);
        const ph = last3.map(() => '?').join(',');
        streaks = db.prepare(`SELECT code, name, COUNT(*)as days, SUM(CASE WHEN (foreign_buy-foreign_sell)>0 THEN 1 ELSE 0 END)as buy_days, SUM((foreign_buy-foreign_sell)*close)as total_fnet FROM idx_daily WHERE trade_date IN (${ph}) AND close>0 GROUP BY code HAVING days=${last3.length} AND (buy_days=${last3.length} OR buy_days=0) ORDER BY ABS(total_fnet) DESC LIMIT 5`).all(...last3);
      }
      res.json({ trade_date: td, prev_date: prevDate, market: today, fnet_delta: fnetDelta, prev_fnet: prevNet, top_buy: topBuy, top_sell: topSell, spikes, streaks });
    } catch (e) { res.json({ error: e.message }); }
  });

  // Stats
  router.get('/stats', (req, res) => {
    try {
      const total = db.prepare('SELECT COUNT(*)as c FROM idx_daily').get().c;
      const tickers = db.prepare('SELECT COUNT(DISTINCT code)as c FROM idx_daily').get().c;
      const dates = db.prepare('SELECT COUNT(DISTINCT trade_date)as c FROM idx_daily').get().c;
      const latest = latestIdxDate();
      const oldest = db.prepare('SELECT MIN(trade_date)as d FROM idx_daily').get()?.d || '';
      const allDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
      res.json({ total, tickers, dates, latest, oldest, all_dates: allDates });
    } catch { res.json({ total: 0 }); }
  });

  // Flow history
  router.get('/flow', (req, res) => {
    const code = (req.query.code || '').toUpperCase().trim();
    if (!code) return res.json({ error: 'No code' });
    const rows = db.prepare('SELECT * FROM idx_daily WHERE code=? ORDER BY trade_date').all(code);
    if (rows.length) {
      let acc = 0, accVal = 0;
      rows.forEach(r => {
        r.foreign_net = r.foreign_buy - r.foreign_sell;
        r.foreign_buy_val = r.foreign_buy * r.close;
        r.foreign_sell_val = r.foreign_sell * r.close;
        r.foreign_net_val = r.foreign_net * r.close;
        acc += r.foreign_net; r.foreign_acc = acc;
        accVal += r.foreign_net_val; r.foreign_acc_val = accVal;
      });
      return res.json({ code, data: rows });
    }
    // Fallback: custom_ohlc (for custom tickers like XAUUSD, commodities, etc.)
    try {
      const custom = db.prepare(`SELECT trade_date, code, open as open_price, high, low, close, volume, session,
              0 as prev_close, 0 as value, 0 as frequency, 0 as foreign_buy, 0 as foreign_sell,
              0 as bid_vol, 0 as offer_vol, 0 as listed_shares, 0 as tradeable_shares
        FROM custom_ohlc WHERE code=? AND ${REGULAR_SESSION} ORDER BY trade_date`).all(code);
      if (custom.length) {
        custom.forEach((r, i) => {
          r.prev_close = i > 0 ? custom[i - 1].close : r.close;
          r.change = r.close - r.prev_close;
          r.foreign_net = 0; r.foreign_buy_val = 0; r.foreign_sell_val = 0;
          r.foreign_net_val = 0; r.foreign_acc = 0; r.foreign_acc_val = 0;
          r.name = '';
        });
        return res.json({ code, data: custom, custom: true });
      }
    } catch (e) { /* custom_ohlc table might not exist */ }
    // Also check idx_indices for index codes
    try {
      const idxRows = db.prepare('SELECT trade_date, index_code as code, previous as prev_close, close, highest as high, lowest as low, volume, value, frequency, 0 as foreign_buy, 0 as foreign_sell, 0 as open_price, 0 as bid_vol, 0 as offer_vol, 0 as listed_shares, 0 as tradeable_shares FROM idx_indices WHERE index_code=? ORDER BY trade_date').all(code);
      if (idxRows.length) {
        idxRows.forEach(r => {
          r.change = r.close - (r.prev_close || 0);
          r.foreign_net = 0; r.foreign_buy_val = 0; r.foreign_sell_val = 0;
          r.foreign_net_val = 0; r.foreign_acc = 0; r.foreign_acc_val = 0;
          r.name = code;
        });
        return res.json({ code, data: idxRows, index: true });
      }
    } catch (e) { /* idx_indices might not have this code */ }
    res.json({ code, data: [] });
  });

  // Foreign accumulation ranking
  router.get('/foreign', (req, res) => {
    const days = parseInt(req.query.days) || 5;
    const dir = req.query.dir || 'desc';
    const limit = Math.min(parseInt(req.query.limit) || 30, 9999);
    const dates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT ?').all(days).map(r => r.trade_date);
    if (!dates.length) return res.json({ data: [], dates: [] });
    const ph = dates.map(() => '?').join(',');
    const rows = db.prepare(`SELECT code, name, SUM(foreign_buy*close)as total_buy_val, SUM(foreign_sell*close)as total_sell_val, SUM((foreign_buy-foreign_sell)*close)as net_flow_val, SUM(foreign_buy)as total_buy_shares, SUM(foreign_sell)as total_sell_shares, SUM(foreign_buy-foreign_sell)as net_flow_shares, COUNT(*)as trade_days, SUM(CASE WHEN (foreign_buy-foreign_sell)>0 THEN 1 ELSE 0 END)as buy_days, MAX(close)as last_close FROM idx_daily WHERE trade_date IN (${ph}) AND close>0 GROUP BY code HAVING net_flow_val!=0 ORDER BY net_flow_val ${dir === 'asc' ? 'ASC' : 'DESC'} LIMIT ?`).all(...dates, limit);
    res.json({ data: rows, dates, days_actual: dates.length });
  });

  // Anomaly detection
  router.get('/anomaly', (req, res) => {
    const type = req.query.type || 'block';
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const td = latestIdxDate(); if (!td) return res.json({ data: [] });
    const allDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC').all().map(r => r.trade_date);
    const prevDates = allDates.filter(d => d < td);

    if (type === 'block') {
      const rows = db.prepare(`SELECT *, (foreign_buy-foreign_sell)as foreign_net, (foreign_buy*close)as foreign_buy_val, (foreign_sell*close)as foreign_sell_val, ((foreign_buy-foreign_sell)*close)as foreign_net_val, CASE WHEN prev_close>0 THEN ROUND(CAST((close-prev_close)AS REAL)/prev_close*100,2) ELSE 0 END as change_pct, CASE WHEN frequency>0 THEN ROUND(CAST(volume AS REAL)/frequency,0) ELSE 0 END as avg_lot FROM idx_daily WHERE trade_date=? AND close>0 AND frequency>0 AND volume>0 ORDER BY CASE WHEN frequency>0 THEN CAST(volume AS REAL)/frequency ELSE 0 END DESC LIMIT ?`).all(td, limit);
      return res.json({ trade_date: td, type: 'block', data: rows });
    }

    if (type === 'volume_spike' && prevDates.length >= 2) {
      const avgDates = prevDates.slice(0, Math.min(prevDates.length, 10));
      const ph = avgDates.map(() => '?').join(',');
      const rows = db.prepare(`SELECT t.code, t.name, t.close, t.volume, t.value, t.frequency, (t.foreign_buy-t.foreign_sell)as foreign_net, (t.foreign_buy*t.close)as foreign_buy_val, (t.foreign_sell*t.close)as foreign_sell_val, ((t.foreign_buy-t.foreign_sell)*t.close)as foreign_net_val, CASE WHEN t.prev_close>0 THEN ROUND(CAST((t.close-t.prev_close)AS REAL)/t.prev_close*100,2) ELSE 0 END as change_pct, a.avg_vol, CASE WHEN a.avg_vol>0 THEN ROUND(CAST(t.volume AS REAL)/a.avg_vol,1) ELSE 0 END as vol_ratio FROM idx_daily t JOIN (SELECT code, AVG(volume)as avg_vol FROM idx_daily WHERE trade_date IN (${ph}) AND volume>0 GROUP BY code) a ON t.code=a.code WHERE t.trade_date=? AND t.close>0 AND t.volume>0 AND a.avg_vol>0 ORDER BY CAST(t.volume AS REAL)/a.avg_vol DESC LIMIT ?`).all(...avgDates, td, limit);
      return res.json({ trade_date: td, type: 'volume_spike', avg_days: avgDates.length, data: rows });
    }

    if (type === 'freq_spike' && prevDates.length >= 2) {
      const avgDates = prevDates.slice(0, Math.min(prevDates.length, 10));
      const ph = avgDates.map(() => '?').join(',');
      const rows = db.prepare(`SELECT t.code, t.name, t.close, t.volume, t.value, t.frequency, (t.foreign_buy-t.foreign_sell)as foreign_net, (t.foreign_buy*t.close)as foreign_buy_val, (t.foreign_sell*t.close)as foreign_sell_val, ((t.foreign_buy-t.foreign_sell)*t.close)as foreign_net_val, CASE WHEN t.prev_close>0 THEN ROUND(CAST((t.close-t.prev_close)AS REAL)/t.prev_close*100,2) ELSE 0 END as change_pct, a.avg_freq, CASE WHEN a.avg_freq>0 THEN ROUND(CAST(t.frequency AS REAL)/a.avg_freq,1) ELSE 0 END as freq_ratio FROM idx_daily t JOIN (SELECT code, AVG(frequency)as avg_freq FROM idx_daily WHERE trade_date IN (${ph}) AND frequency>0 GROUP BY code) a ON t.code=a.code WHERE t.trade_date=? AND t.close>0 AND t.frequency>0 AND a.avg_freq>0 ORDER BY CAST(t.frequency AS REAL)/a.avg_freq DESC LIMIT ?`).all(...avgDates, td, limit);
      return res.json({ trade_date: td, type: 'freq_spike', avg_days: avgDates.length, data: rows });
    }

    const rows = db.prepare(`SELECT *, (foreign_buy-foreign_sell)as foreign_net, CASE WHEN frequency>0 THEN ROUND(CAST(volume AS REAL)/frequency,0) ELSE 0 END as avg_lot FROM idx_daily WHERE trade_date=? AND close>0 AND frequency>0 ORDER BY CASE WHEN frequency>0 THEN CAST(volume AS REAL)/frequency ELSE 0 END DESC LIMIT ?`).all(td, limit);
    res.json({ trade_date: td, type: 'block', data: rows });
  });

  // Delete
  router.delete('/', (req, res) => {
    const date = req.query.date;
    if (date) db.prepare('DELETE FROM idx_daily WHERE trade_date=?').run(date);
    else db.prepare('DELETE FROM idx_daily').run();
    res.json({ success: true });
  });

  // ═══ Fundamental Data (BEI Screener XLSX) ═══
  router.get('/fundamental', (req, res) => {
    try {
      const code = (req.query.code || '').toUpperCase().trim();
      const { latestFundDate } = require('../db');
      const sm = latestFundDate(); if (!sm) return res.json({ error: 'No data' });
      if (code) {
        const row = db.prepare('SELECT * FROM idx_fundamental WHERE snapshot_month=? AND code=?').get(sm, code);
        return res.json(row || { error: 'Not found' });
      }
      return res.json({ snapshot_month: sm, total: db.prepare('SELECT COUNT(*)as c FROM idx_fundamental WHERE snapshot_month=?').get(sm).c });
    } catch (e) { res.json({ error: e.message }); }
  });

  router.get('/fundamental/stats', (req, res) => {
    try {
      const { latestFundDate } = require('../db');
      const sm = latestFundDate();
      const total = sm ? db.prepare('SELECT COUNT(*)as c FROM idx_fundamental WHERE snapshot_month=?').get(sm).c : 0;
      const sectors = sm ? db.prepare('SELECT DISTINCT sector FROM idx_fundamental WHERE snapshot_month=? AND sector!="" ORDER BY sector').all(sm).map(r => r.sector) : [];
      const industries = sm ? db.prepare('SELECT DISTINCT industry FROM idx_fundamental WHERE snapshot_month=? AND industry!="" ORDER BY industry').all(sm).map(r => r.industry) : [];
      // Sector → industry mapping for cascading dropdown
      const sectorIndustryMap = {};
      if (sm) {
        const pairs = db.prepare('SELECT DISTINCT sector, industry FROM idx_fundamental WHERE snapshot_month=? AND sector!="" AND industry!="" ORDER BY sector, industry').all(sm);
        pairs.forEach(p => {
          if (!sectorIndustryMap[p.sector]) sectorIndustryMap[p.sector] = [];
          if (!sectorIndustryMap[p.sector].includes(p.industry)) sectorIndustryMap[p.sector].push(p.industry);
        });
      }
      res.json({ snapshot_month: sm, total, sectors, industries, sector_industry_map: sectorIndustryMap });
    } catch { res.json({ total: 0 }); }
  });

  // ═══════════════════════════════════════════════════════════════════
  // ═══ CORPORATE ACTIONS — auto-detect, confirm/dismiss, adjust OHLC
  // ═══════════════════════════════════════════════════════════════════

  // Auto-detect: scan consecutive date pairs for listed_shares jumps
  // Threshold: ratio >= 1.5x or <= 0.67x → likely split/reverse/rights
  // Inserts as status='pending' for user review
  function detectCorporateActions() {
    const dates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
    if (dates.length < 2) return [];

    const insCA = db.prepare(`INSERT OR IGNORE INTO corporate_actions(code, ex_date, action_type, ratio, old_shares, new_shares, old_close, new_close, status, notes)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    const detected = [];

    db.transaction(() => {
      for (let i = 1; i < dates.length; i++) {
        const prevD = dates[i - 1], currD = dates[i];
        const changes = db.prepare(`
          SELECT c.code, c.name, c.listed_shares as new_shares, c.close as new_close,
                 p.listed_shares as old_shares, p.close as old_close
          FROM idx_daily c
          JOIN idx_daily p ON c.code = p.code AND p.trade_date = ?
          WHERE c.trade_date = ?
            AND p.listed_shares > 0 AND c.listed_shares > 0
            AND c.listed_shares != p.listed_shares
            AND (CAST(c.listed_shares AS REAL) / p.listed_shares >= 1.5
              OR CAST(c.listed_shares AS REAL) / p.listed_shares <= 0.67)
        `).all(prevD, currD);

        for (const ch of changes) {
          const sharesRatio = ch.new_shares / ch.old_shares;
          let actionType = 'unknown', notes = '';

          // Price change ratio — for true split, price should move inversely
          const priceRatio = ch.old_close > 0 ? ch.new_close / ch.old_close : 1;
          // Expected price ratio for a split: 1/sharesRatio (e.g. 2x shares = 0.5x price)
          const expectedPriceRatio = 1 / sharesRatio;
          // Tolerance: price should be within 30% of expected
          const priceTolerance = 0.30;
          const priceMatchesSplit = Math.abs(priceRatio - expectedPriceRatio) / expectedPriceRatio <= priceTolerance;

          if (sharesRatio >= 1.5) {
            const roundRatio = Math.round(sharesRatio);
            const isCleanRatio = Math.abs(sharesRatio - roundRatio) < 0.05; // 2x, 3x, 5x etc

            if (priceMatchesSplit && isCleanRatio) {
              // Shares doubled/tripled AND price halved/thirded AND clean ratio → split or bonus shares
              // Both need adjustment — label as split_or_bonus, user confirms which
              actionType = 'split_or_bonus';
              notes = `Shares ${roundRatio}x, price ${(priceRatio * 100).toFixed(0)}% → likely Stock Split or Saham Bonus. Needs price adjustment.`;
            } else if (priceMatchesSplit && !isCleanRatio) {
              // Price matches but odd ratio → likely bonus shares with non-standard ratio
              actionType = 'bonus_shares';
              notes = `Shares ${sharesRatio.toFixed(2)}x, price ${(priceRatio * 100).toFixed(0)}% → likely Saham Bonus. Needs price adjustment.`;
            } else if (!priceMatchesSplit && priceRatio > 0.8) {
              // Shares up but price barely moved → right issue / HMETD / tanpa HMETD
              actionType = 'right_issue';
              notes = `Shares ${sharesRatio.toFixed(2)}x but price ${(priceRatio * 100).toFixed(0)}% (barely changed) → likely Right Issue/HMETD/PP. NO price adjustment needed.`;
            } else if (!priceMatchesSplit && priceRatio <= 0.8) {
              // Shares up AND price down but not proportional → could be rights + dilution
              actionType = 'dilution';
              notes = `Shares ${sharesRatio.toFixed(2)}x, price ${(priceRatio * 100).toFixed(0)}% → shares increased with price decline. Review manually.`;
            } else {
              actionType = 'unknown';
              notes = `Shares ${sharesRatio.toFixed(2)}x, price ${(priceRatio * 100).toFixed(0)}%. Review manually.`;
            }
          } else {
            // Shares decreased
            const invRatio = Math.round(1 / sharesRatio);
            if (priceMatchesSplit) {
              actionType = 'reverse_split';
              notes = `${invRatio}:1 reverse split. Shares ${ch.old_shares.toLocaleString()} → ${ch.new_shares.toLocaleString()}, price ${ch.old_close} → ${ch.new_close}. Needs price adjustment.`;
            } else {
              actionType = 'shares_reduction';
              notes = `Shares reduced ${sharesRatio.toFixed(2)}x but price ${(priceRatio * 100).toFixed(0)}%. Review manually — could be buyback/delisting.`;
            }
          }

          // Only auto-confirm real splits/reverses. Rights issue stays pending.
          const status = (actionType === 'split' || actionType === 'reverse') ? 'pending' : 'pending';

          const r = insCA.run(ch.code, currD, actionType, sharesRatio, ch.old_shares, ch.new_shares, ch.old_close, ch.new_close, status, notes);
          if (r.changes > 0) {
            detected.push({ code: ch.code, ex_date: currD, action_type: actionType, ratio: Math.round(sharesRatio * 10000) / 10000, old_shares: ch.old_shares, new_shares: ch.new_shares, notes });
          }
        }
      }
    })();

    return detected;
  }

  // Re-run detection manually
  router.post('/ca/detect', (req, res) => {
    try {
      const detected = detectCorporateActions();
      res.json({ success: true, detected, total: detected.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // List corporate actions
  router.get('/ca', (req, res) => {
    try {
      const status = req.query.status || '';
      const code = (req.query.code || '').toUpperCase().trim();
      let sql = 'SELECT * FROM corporate_actions WHERE 1=1';
      const params = [];
      if (status) { sql += ' AND status=?'; params.push(status); }
      if (code) { sql += ' AND code=?'; params.push(code); }
      sql += ' ORDER BY ex_date DESC, code';
      const rows = db.prepare(sql).all(...params);
      res.json({ data: rows, total: rows.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // CA stats
  router.get('/ca/stats', (req, res) => {
    try {
      const total = db.prepare('SELECT COUNT(*) as c FROM corporate_actions').get().c;
      const pending = db.prepare(`SELECT COUNT(*) as c FROM corporate_actions WHERE status='pending'`).get().c;
      const confirmed = db.prepare(`SELECT COUNT(*) as c FROM corporate_actions WHERE status='confirmed'`).get().c;
      res.json({ total, pending, confirmed });
    } catch (e) { res.json({ total: 0, pending: 0, confirmed: 0 }); }
  });

  // Confirm a pending CA (user can edit type/ratio)
  router.put('/ca/:id/confirm', (req, res) => {
    try {
      const row = db.prepare('SELECT * FROM corporate_actions WHERE id=?').get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });
      const { action_type, ratio, notes } = req.body;
      db.prepare(`UPDATE corporate_actions SET status='confirmed',
        action_type=COALESCE(?,action_type), ratio=COALESCE(?,ratio), notes=COALESCE(?,notes)
        WHERE id=?`).run(action_type || null, ratio || null, notes || null, req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Dismiss (false positive)
  router.put('/ca/:id/dismiss', (req, res) => {
    try {
      db.prepare(`UPDATE corporate_actions SET status='dismissed' WHERE id=?`).run(req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Add manual CA
  router.post('/ca', (req, res) => {
    try {
      const { code, ex_date, action_type, ratio, notes } = req.body;
      if (!code || !ex_date || !ratio) return res.status(400).json({ error: 'code, ex_date, ratio required' });
      const prevRow = db.prepare('SELECT close, listed_shares FROM idx_daily WHERE code=? AND trade_date<? ORDER BY trade_date DESC LIMIT 1')
        .get(code.toUpperCase(), ex_date);
      const currRow = db.prepare('SELECT close, listed_shares FROM idx_daily WHERE code=? AND trade_date>=? ORDER BY trade_date ASC LIMIT 1')
        .get(code.toUpperCase(), ex_date);
      db.prepare(`INSERT INTO corporate_actions(code, ex_date, action_type, ratio, old_shares, new_shares, old_close, new_close, status, notes)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(code, ex_date) DO UPDATE SET action_type=excluded.action_type, ratio=excluded.ratio, notes=excluded.notes, status=excluded.status`)
        .run(code.toUpperCase(), ex_date, action_type || 'manual', parseFloat(ratio),
          prevRow?.listed_shares || 0, currRow?.listed_shares || 0,
          prevRow?.close || 0, currRow?.close || 0,
          'confirmed', notes || 'manual entry');
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Delete CA
  router.delete('/ca/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM corporate_actions WHERE id=?').run(req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Bulk confirm all pending
  router.post('/ca/confirm-all', (req, res) => {
    try {
      const r = db.prepare(`UPDATE corporate_actions SET status='confirmed' WHERE status='pending'`).run();
      res.json({ success: true, confirmed: r.changes });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Bulk dismiss all pending
  router.post('/ca/dismiss-all', (req, res) => {
    try {
      const r = db.prepare(`UPDATE corporate_actions SET status='dismissed' WHERE status='pending'`).run();
      res.json({ success: true, dismissed: r.changes });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ ADJUSTED OHLC — backward adjust using confirmed CAs ═══
  router.get('/adjusted/:code', (req, res) => {
    try {
      const code = req.params.code.toUpperCase().trim();
      if (!code) return res.status(400).json({ error: 'No code' });

      const actions = db.prepare(
        `SELECT * FROM corporate_actions WHERE code=? AND status='confirmed' ORDER BY ex_date DESC`
      ).all(code);

      // Sumber faktor resmi = ca_factors (diturunkan dari prev_close IDX, 217 event /
      // 173 kode). corporate_actions hanya 5 baris dan MLPT ex_date-nya salah
      // (2026-07-29 vs 2026-07-21 yang cocok dengan langkah harga), jadi tabel itu
      // hanya FALLBACK untuk kode yang belum ada di ca_factors. Tanpa ca_factors,
      // chart (chart-panel.js) menampilkan harga mentah: split tampak -80%.
      const caF = loadFactors(db)[code] || [];
      // Yang benar-benar dipakai (kosong kalau ca_factors sudah mengisi kode ini).
      const effActions = fallbackRatioActions(caF, actions);

      const ohlc = db.prepare(
        `SELECT trade_date, code, name, open_price, high, low, close, volume, prev_close,
                value, frequency, foreign_buy, foreign_sell, listed_shares, bid_vol, offer_vol
         FROM idx_daily WHERE code=? ORDER BY trade_date`
      ).all(code);

      if (!ohlc.length) {
        // Fallback: check custom_ohlc table
        try {
          const custom = db.prepare(
            `SELECT trade_date, code, open as open_price, high, low, close, volume, session, 0 as prev_close,
                    0 as value, 0 as frequency, 0 as foreign_buy, 0 as foreign_sell,
                    0 as listed_shares, 0 as bid_vol, 0 as offer_vol
             FROM custom_ohlc WHERE code=? AND ${REGULAR_SESSION} ORDER BY trade_date`
          ).all(code);
          if (custom.length) {
            // ohlc_mode seri (t_565e76fd) ikut dikirim: 'price_only' = O/H/L NULL memang
            // disengaja (seri beku/mustahil di sumber) -> gambar garis, jangan candle kosong.
            let mode = null;
            try { mode = (db.prepare('SELECT ohlc_mode FROM custom_tickers WHERE code=?').get(code) || {}).ohlc_mode || null; } catch (e3) {}
            // Add prev_close
            const data = custom.map((r, i) => {
              const pc = i > 0 ? custom[i-1].close : r.open_price || r.close;
              return { ...r, prev_close: pc, name: '', change: 0,
                adj_open: r.open_price, adj_high: r.high, adj_low: r.low, adj_close: r.close,
                adj_volume: r.volume, cum_factor: 1, _custom: true };
            });
            return res.json({ code, data, actions: [], custom: true, ohlc_mode: mode });
          }
        } catch(e2) { /* custom table might not exist yet */ }
        return res.json({ code, data: [], actions: [] });
      }

      // ── Fix bad OHLC data from IDX API ──
      // Some rows have open_price=0 or close=0. Fix: fallback to prev_close/close.
      // Filter out rows where close=0 (completely invalid).
      const cleaned = ohlc.filter(r => r.close > 0).map(r => {
        // If open_price is 0 or missing, use prev_close (or close as last resort)
        if (!r.open_price || r.open_price <= 0) r.open_price = r.prev_close || r.close;
        // If high is 0 or less than close, fix it
        if (!r.high || r.high <= 0) r.high = Math.max(r.open_price, r.close);
        // If low is 0 or greater than close, fix it
        if (!r.low || r.low <= 0) r.low = Math.min(r.open_price, r.close);
        // Ensure high >= max(open, close) and low <= min(open, close)
        r.high = Math.max(r.high, r.open_price, r.close);
        r.low = Math.min(r.low, r.open_price, r.close);
        return r;
      });

      if (!actions.length && !caF.length) {
        const data = cleaned.map(r => ({
          ...r, adj_open: r.open_price, adj_high: r.high, adj_low: r.low, adj_close: r.close,
          adj_volume: r.volume, cum_factor: 1
        }));
        return res.json({ code, data, actions: [], ca_factors: [] });
      }

      // Backward: dates BEFORE ex_date get factor applied
      // factor = 1/ratio (ratio = new_shares/old_shares)
      // Split 1:5 → ratio=5, factor=0.2 → old prices shrink
      // Reverse 10:1 → ratio=0.1, factor=10 → old prices grow
      // Faktor dihitung SEKALI per baris (factorForRow): ca_factors kalau kode itu
      // punya entri, corporate_actions hanya kalau tidak ada. Menjumlahkan keduanya
      // = satu event dihitung dua kali (RAJA 0,2×0,2=0,04; DSSA 0,004×0,04).
      const data = cleaned.map(r => {
        let cumFactor = factorForRow(caF, actions, r.trade_date);

        if (cumFactor === 1) {
          return { ...r, adj_open: r.open_price, adj_high: r.high, adj_low: r.low, adj_close: r.close, adj_volume: r.volume, cum_factor: 1 };
        }

        return {
          ...r,
          adj_open: Math.round(r.open_price * cumFactor),
          adj_high: Math.round(r.high * cumFactor),
          adj_low: Math.round(r.low * cumFactor),
          adj_close: Math.round(r.close * cumFactor),
          adj_volume: Math.round(r.volume / cumFactor),
          cum_factor: Math.round(cumFactor * 1000000) / 1000000
        };
      });

      // `actions` = daftar yang BENAR-BENAR dipakai (kosong bila ca_factors menang),
      // supaya klien melihat basis yang sama dengan angka adj_* di atas.
      res.json({ code, data, actions: effActions, ca_factors: caF.map(f => ({ ex_date: f.ex_date, factor: f.factor, source: f.source || 'ca_factors' })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ COMPARE GROUP — time series for sector/industry/konglomerat ═══
  // Returns: { group_name, data: [{trade_date, avg_close, count, total_fnet_val}] }
  // Used by Comparison Phase 2
  router.get('/compare-group', (req, res) => {
    try {
      const mode = req.query.mode || 'sector'; // sector | industry | konglo
      const groups = (req.query.groups || '').split(',').filter(Boolean).map(g => g.trim());
      if (!groups.length) return res.json({ error: 'No groups specified' });

      const { latestFundDate } = require('../db');
      const fm = latestFundDate();

      // Build ticker lists per group
      const groupTickers = {};

      if (mode === 'sector' || mode === 'industry') {
        if (!fm) return res.json({ error: 'No fundamental data' });
        const field = mode === 'sector' ? 'sector' : 'industry';
        for (const g of groups) {
          const rows = db.prepare(`SELECT code FROM idx_fundamental WHERE snapshot_month=? AND ${field}=?`).all(fm, g);
          groupTickers[g] = rows.map(r => r.code);
        }
      } else if (mode === 'konglo') {
        for (const g of groups) {
          const rows = db.prepare('SELECT ticker FROM ticker_groups WHERE group_name=?').all(g);
          groupTickers[g] = rows.map(r => r.ticker);
        }
      } else {
        return res.json({ error: 'Invalid mode' });
      }

      // Check all groups have tickers
      for (const g of groups) {
        if (!groupTickers[g] || !groupTickers[g].length) {
          groupTickers[g] = [];
        }
      }

      // Get all trade dates
      const allDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
      if (!allDates.length) return res.json({ error: 'No IDX data' });

      // For each group, compute daily aggregate metrics
      const result = {};
      for (const g of groups) {
        const tickers = groupTickers[g];
        if (!tickers.length) { result[g] = { name: g, tickers: 0, data: [] }; continue; }

        const ph = tickers.map(() => '?').join(',');

        // Get daily data: avg close per date across tickers in this group
        // We normalize by computing average % change from first available date
        // ca_adj: deret AVG(close) mentah patah di setiap ex-date CA.
        const rows = db.prepare(`
          SELECT trade_date,
                 AVG(ca_adj(close, code, trade_date)) as avg_close,
                 COUNT(*) as count,
                 SUM((foreign_buy - foreign_sell) * close) as total_fnet_val,
                 SUM(value) as total_value
          FROM idx_daily
          WHERE code IN (${ph}) AND close > 0
          GROUP BY trade_date
          ORDER BY trade_date
        `).all(...tickers);

        result[g] = { name: g, tickers: tickers.length, ticker_list: tickers.slice(0, 20), data: rows };
      }

      res.json({ mode, groups: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ LIST AVAILABLE GROUPS — for dropdown selectors ═══
  router.get('/compare-groups', (req, res) => {
    try {
      const mode = req.query.mode || 'sector';
      const { latestFundDate } = require('../db');
      const fm = latestFundDate();

      if (mode === 'sector') {
        if (!fm) return res.json({ items: [] });
        const rows = db.prepare(`SELECT sector as name, COUNT(*) as count FROM idx_fundamental WHERE snapshot_month=? AND sector!='' GROUP BY sector ORDER BY COUNT(*) DESC`).all(fm);
        return res.json({ items: rows });
      }
      if (mode === 'industry') {
        if (!fm) return res.json({ items: [] });
        const sector = req.query.sector || '';
        let sql = `SELECT industry as name, sector, COUNT(*) as count FROM idx_fundamental WHERE snapshot_month=? AND industry!=''`;
        const params = [fm];
        if (sector) { sql += ' AND sector=?'; params.push(sector); }
        sql += ' GROUP BY industry ORDER BY COUNT(*) DESC';
        const rows = db.prepare(sql).all(...params);
        return res.json({ items: rows });
      }
      if (mode === 'konglo') {
        const rows = db.prepare(`SELECT g.name, g.category, g.key_person, COUNT(t.ticker) as count
          FROM investor_groups g LEFT JOIN ticker_groups t ON g.name = t.group_name
          GROUP BY g.name ORDER BY count DESC`).all();
        return res.json({ items: rows });
      }
      res.json({ items: [] });
    } catch (e) { res.json({ items: [], error: e.message }); }
  });

  // ═══ UNIFIED IDX DAILY — combines rankings + activity spike + digest + MA ═══
  router.get('/unified', (req, res) => {
    try {
      const td = latestIdxDate();
      if (!td) return res.json({ data: [], trade_date: null });
      const avgDays = parseInt(req.query.avg) || 20;
      const minFreq = parseInt(req.query.min_freq) || 5;

      const todayStocks = db.prepare(`SELECT *, 
        (foreign_buy-foreign_sell) as foreign_net,
        ((foreign_buy-foreign_sell)*close) as fnet_val,
        (foreign_buy*close) as foreign_buy_val,
        (foreign_sell*close) as foreign_sell_val,
        CASE WHEN prev_close>0 THEN ROUND(CAST((close-prev_close)AS REAL)/prev_close*100,2) ELSE 0 END as change_pct,
        (close*listed_shares) as market_cap
        FROM idx_daily WHERE trade_date=? AND close>0`).all(td);

      const dates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT ?').all(avgDays + 1).map(r => r.trade_date);
      const avgDates = dates.slice(1);
      const avgMap = {};
      if (avgDates.length >= 3) {
        const ph = avgDates.map(() => '?').join(',');
        db.prepare(`SELECT code, AVG(volume) as avg_vol, AVG(value) as avg_val, AVG(frequency) as avg_freq,
          AVG(ABS((foreign_buy-foreign_sell)*close)) as avg_fnet_abs
          FROM idx_daily WHERE trade_date IN (${ph}) AND close>0
          GROUP BY code HAVING AVG(frequency)>=?`).all(...avgDates, minFreq)
          .forEach(r => { avgMap[r.code] = r; });
      }

      // Batch MA calculation — single query instead of per-stock queries
      // ca_adj: MA20/MA200 di sini dipakai UI "IDX Daily"; AVG(close) mentah
      // membuat MA nama pasca-CA melompat (mis. RAJA 5x terlalu tinggi).
      const maMap = {};
      const maDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT 200').all().map(r => r.trade_date);
      if (maDates.length >= 20) {
        const ma20Dates = maDates.slice(0, 20);
        const ph20 = ma20Dates.map(() => '?').join(',');
        db.prepare(`SELECT code, ROUND(AVG(ca_adj(close, code, trade_date))) as ma20 FROM idx_daily WHERE trade_date IN (${ph20}) AND close>0 GROUP BY code`).all(...ma20Dates)
          .forEach(r => { maMap[r.code] = { ma20: r.ma20, ma200: 0 }; });
      }
      if (maDates.length >= 200) {
        const ph200 = maDates.map(() => '?').join(',');
        db.prepare(`SELECT code, ROUND(AVG(ca_adj(close, code, trade_date))) as ma200 FROM idx_daily WHERE trade_date IN (${ph200}) AND close>0 GROUP BY code`).all(...maDates)
          .forEach(r => { if (maMap[r.code]) maMap[r.code].ma200 = r.ma200; else maMap[r.code] = { ma20: 0, ma200: r.ma200 }; });
      }

      const { latestFundDate } = require('../db');
      const fm = latestFundDate();
      const fundMap = {};
      const sectors = new Set();
      if (fm) {
        db.prepare('SELECT code, sector, industry FROM idx_fundamental WHERE snapshot_month=?').all(fm)
          .forEach(f => { fundMap[f.code] = f; if (f.sector) sectors.add(f.sector); });
      }

      const data = todayStocks.map(s => {
        const a = avgMap[s.code];
        const ma = maMap[s.code] || {};
        const fund = fundMap[s.code] || {};
        let score = 0, val_spike = 0, freq_spike = 0, vol_spike = 0, fnet_spike = 0;
        if (a) {
          val_spike = a.avg_val > 0 ? Math.round(s.value / a.avg_val * 10) / 10 : 0;
          freq_spike = a.avg_freq > 0 ? Math.round(s.frequency / a.avg_freq * 10) / 10 : 0;
          vol_spike = a.avg_vol > 0 ? Math.round(s.volume / a.avg_vol * 10) / 10 : 0;
          fnet_spike = a.avg_fnet_abs > 0 ? Math.round(Math.abs(s.fnet_val) / a.avg_fnet_abs * 10) / 10 : 0;
          score = Math.round((val_spike * 0.3 + freq_spike * 0.3 + vol_spike * 0.2 + fnet_spike * 0.2) * 10) / 10;
        }
        return {
          code: s.code, name: s.name, close: s.close, prev_close: s.prev_close,
          change_pct: s.change_pct, value: s.value, volume: s.volume, frequency: s.frequency,
          foreign_buy: s.foreign_buy, foreign_sell: s.foreign_sell,
          fnet_val: s.fnet_val, foreign_buy_val: s.foreign_buy_val, foreign_sell_val: s.foreign_sell_val,
          bid_vol: s.bid_vol || 0, offer_vol: s.offer_vol || 0,
          market_cap: s.market_cap, score, val_spike, freq_spike, vol_spike, fnet_spike,
          ma20: ma.ma20 || 0, ma200: ma.ma200 || 0,
          sector: fund.sector || '', industry: fund.industry || ''
        };
      });
      data.sort((a, b) => (b.value || 0) - (a.value || 0));

      const summary = {
        total_stocks: data.length,
        advancers: data.filter(r => r.change_pct > 0).length,
        decliners: data.filter(r => r.change_pct < 0).length,
        unchanged: data.filter(r => r.change_pct === 0).length,
        total_value: data.reduce((s, r) => s + (r.value || 0), 0),
        total_fnet_val: data.reduce((s, r) => s + (r.fnet_val || 0), 0),
        foreign_buy_stocks: data.filter(r => (r.fnet_val || 0) > 0).length,
        foreign_sell_stocks: data.filter(r => (r.fnet_val || 0) < 0).length
      };

      const topBuy = data.filter(r => r.fnet_val > 0).sort((a, b) => b.fnet_val - a.fnet_val).slice(0, 5).map(r => ({ code: r.code, fnet_val: r.fnet_val, chg: r.change_pct }));
      const topSell = data.filter(r => r.fnet_val < 0).sort((a, b) => a.fnet_val - b.fnet_val).slice(0, 5).map(r => ({ code: r.code, fnet_val: r.fnet_val, chg: r.change_pct }));
      const spikes = data.filter(r => r.vol_spike >= 3).sort((a, b) => b.vol_spike - a.vol_spike).slice(0, 5).map(r => ({ code: r.code, ratio: r.vol_spike, chg: r.change_pct }));

      const sectorSpikes = {};
      data.forEach(r => {
        if (!r.sector || !r.score) return;
        if (!sectorSpikes[r.sector]) sectorSpikes[r.sector] = { sector: r.sector, total_score: 0, count: 0, top_spike: null };
        sectorSpikes[r.sector].total_score += r.score;
        sectorSpikes[r.sector].count++;
        if (!sectorSpikes[r.sector].top_spike || r.score > sectorSpikes[r.sector].top_spike.score)
          sectorSpikes[r.sector].top_spike = { code: r.code, score: r.score };
      });
      Object.values(sectorSpikes).forEach(s => { s.avg_score = Math.round(s.total_score / s.count * 10) / 10; });

      const dormant = data.filter(r => { var a = avgMap[r.code]; return a && a.avg_freq < 30 && r.freq_spike >= 3; })
        .sort((a, b) => b.freq_spike - a.freq_spike).slice(0, 20);

      res.json({
        trade_date: td, avg_days: avgDays, total: data.length, data, summary,
        digest: { top_buy: topBuy, top_sell: topSell, spikes },
        sector_spikes: Object.values(sectorSpikes).sort((a, b) => b.avg_score - a.avg_score),
        dormant, sectors: Array.from(sectors).sort()
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ MACRO FOREIGN vs DOMESTIC FLOW — from idx_daily aggregate ═══
  router.get('/macro-flow', (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days) || 60, 500);
      // True foreign net from per-stock data (matches Digest summary)
      const rows = db.prepare(`
        SELECT trade_date,
          SUM((foreign_buy - foreign_sell) * close) as f_net,
          SUM(foreign_buy * close) as f_buy_val,
          SUM(foreign_sell * close) as f_sell_val,
          SUM(value) as total_value,
          COUNT(*) as stocks
        FROM idx_daily WHERE close > 0
        GROUP BY trade_date
        ORDER BY trade_date DESC LIMIT ?
      `).all(days);
      rows.reverse();
      const data = rows.map(r => ({
        date: r.trade_date,
        f_net: r.f_net || 0,
        f_buy: r.f_buy_val || 0,
        f_sell: r.f_sell_val || 0,
        total_value: r.total_value || 0,
        stocks: r.stocks || 0
      }));
      res.json({ data, days: data.length });
    } catch (e) { res.json({ data: [], error: e.message }); }
  });

  // ═══ GAP DETECTION — with market_calendar holiday filter ═══
  router.get('/gap-detection', (req, res) => {
    try {
      const allDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
      // Get holidays from market_calendar
      const holidays = new Set();
      try {
        db.prepare("SELECT DISTINCT cal_date FROM market_calendar WHERE type LIKE '%holiday%' OR type LIKE '%libur%' OR type LIKE '%Holiday%' OR description LIKE '%libur%' OR description LIKE '%holiday%' OR description LIKE '%cuti%'").all()
          .forEach(r => { if (r.cal_date) holidays.add(r.cal_date.substring(0, 10)); });
      } catch {}
      // Also add weekends
      const gaps = [];
      for (let i = 1; i < allDates.length; i++) {
        const prev = new Date(allDates[i - 1]);
        const curr = new Date(allDates[i]);
        const diffDays = Math.round((curr - prev) / 86400000);
        if (diffDays <= 1) continue; // consecutive
        // Check each missing day
        const missing = [];
        for (let d = 1; d < diffDays; d++) {
          const check = new Date(prev.getTime() + d * 86400000);
          const iso = check.toISOString().split('T')[0];
          const dow = check.getDay();
          if (dow === 0 || dow === 6) continue; // weekend
          if (holidays.has(iso)) continue; // holiday
          missing.push(iso);
        }
        if (missing.length > 0) {
          gaps.push({ after: allDates[i - 1], before: allDates[i], missing, count: missing.length });
        }
      }
      res.json({ total_gaps: gaps.length, total_missing_days: gaps.reduce((s, g) => s + g.count, 0), holidays_loaded: holidays.size, trade_dates: allDates.length, gaps: gaps.slice(0, 50) });
    } catch (e) { res.json({ total_gaps: 0, error: e.message }); }
  });

  // ═══ KSEI BULANAN — kepemilikan efek (Balancepos) + master (StatisEfek) ═══
  // Sumber: web.ksei.co.id/archive_download (gratis, bulanan, tanpa login).
  // Catatan: header Balancepos punya DUA kolom "Total" (lokal & asing) ->
  // parser WAJIB positional; berbasis nama akan menimpa yang pertama.
  const KSEI_TYPES = ['IS','CP','PF','IB','ID','MF','SC','FD','OT'];

  // Tanggal bursa terakhir per bulan — dipakai pipeline KSEI untuk menyusun
  // nama file (BalanceposEfekYYYYMMDD). Jauh lebih cepat daripada probe HTTP.
  router.get('/trade-dates', (req, res) => {
    try {
      const months = Math.min(parseInt(req.query.months) || 120, 400);
      const rows = db.prepare(`
        SELECT substr(trade_date,1,7) AS ym, MAX(trade_date) AS last_date
        FROM idx_daily GROUP BY ym ORDER BY ym DESC LIMIT ?
      `).all(months);
      res.json(rows.reverse());
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ KSEI CA TAHUNAN — List of CA Activities (XLS, HTML-table) ═══
  // Sumber: /data/download-data-and-user-guide -> div_YYYY.xls, prox/right/mconv/
  // schedule_ca_keseluruhan_YYYY.xls. Semua punya 9 kolom identik.
  const CA_MONTHS = { JAN:'01', FEB:'02', MAR:'03', APR:'04', MAY:'05', JUN:'06',
                      JUL:'07', AUG:'08', SEP:'09', OCT:'10', NOV:'11', DEC:'12' };
  function caDate(v) {
    if (!v) return null;
    const m = String(v).trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (!m) return null;
    const mm = CA_MONTHS[m[2].toUpperCase()];
    if (!mm) return null;
    return `${m[3]}-${mm}-${String(m[1]).padStart(2, '0')}`;
  }

  router.post('/ksei/ca', (req, res) => {
    try {
      const year = parseInt(req.body.year);
      const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
      if (!year || year < 2000 || year > 2100) return res.status(400).json({ error: 'year wajib' });
      if (!rows.length) return res.status(400).json({ error: 'rows kosong' });

      const insA = db.prepare(`INSERT INTO bei_corporate_actions(
        code,issuer,security_name,ca_type,cum_date,recording_date,dist_date,
        exercise_ratio,exercise_instr,proceed_ratio,proceed_instr,description,ref_no,letter_date,year
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const insD = db.prepare(`INSERT INTO bei_dividends(code,div_type,cum_date,recording_date,payment_date,dps,year)
                               VALUES (?,?,?,?,?,?,?)`);
      let nA = 0, nD = 0;
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM bei_corporate_actions WHERE year=?').run(year);
        db.prepare('DELETE FROM bei_dividends WHERE year=?').run(year);
        const seen = new Set();
        for (const r of rows) {
          const code = String(r.code || '').toUpperCase().trim();
          const type = String(r.ca_type || '').toUpperCase().trim();
          if (!code || !type) continue;
          const cum = caDate(r.cum_date), rec = caDate(r.recording_date), dist = caDate(r.dist_date);
          const key = code + '|' + type + '|' + (cum || '') + '|' + (rec || '');
          if (seen.has(key)) continue;               // file bisa tumpang tindih antar-sumber
          seen.add(key);
          // Nominal dividen ADA di kolom "Proceed Ratio" (15 kolom, bukan 9).
          const procRaw = r.proceed_ratio == null ? '' : String(r.proceed_ratio).trim();
          const procNum = procRaw === '' ? null : parseFloat(procRaw.replace(/,/g, ''));
          const procOk = procNum != null && isFinite(procNum);
          insA.run(code, r.issuer || '', r.security_name || '', type, cum, rec, dist,
                   r.exercise_ratio != null ? String(r.exercise_ratio) : null,
                   r.exercise_instr || '', procOk ? procNum : null, r.proceed_instr || '',
                   '', '', '', year);
          nA++;
          // dps = Proceed Ratio (nominal per saham). 0 hanya bila sumber kosong.
          if (type === 'CASH DIVIDEND' && cum) {
            insD.run(code, 'CASH', cum, rec, dist, procOk ? procNum : 0, year);
            nD++;
          }
        }
      });
      tx();
      res.json({ ok: true, year, actions: nA, dividends: nD });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/ksei/status', (req, res) => {
    try {
      const bp = db.prepare('SELECT COUNT(*) n, MAX(snapshot_date) d, COUNT(DISTINCT code) c FROM balance_position').get();
      const hd = db.prepare('SELECT COUNT(*) n, MAX(snapshot_date) d FROM holdings').get();
      res.json({ balance_position: bp, holdings: hd });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/ksei/import', (req, res) => {
    try {
      const snap = String(req.body.snapshot_date || '').slice(0, 10);
      const bal = Array.isArray(req.body.balance) ? req.body.balance : [];
      const master = Array.isArray(req.body.master) ? req.body.master : [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(snap)) return res.status(400).json({ error: 'snapshot_date YYYY-MM-DD wajib' });
      if (!bal.length) return res.status(400).json({ error: 'balance kosong' });
      if (req.body.force !== true) {
        const ex = db.prepare('SELECT COUNT(*) n FROM balance_position WHERE snapshot_date=?').get(snap);
        if (ex.n > 0) return res.json({ ok: true, skipped: true, reason: 'snapshot sudah ada', snapshot_date: snap, rows: ex.n });
      }

      const delB = db.prepare('DELETE FROM balance_position WHERE snapshot_date=?');
      const insB = db.prepare(`INSERT INTO balance_position(
        snapshot_date,code,sec_num,price,
        local_is,local_cp,local_pf,local_ib,local_id,local_mf,local_sc,local_fd,local_ot,local_total,
        foreign_is,foreign_cp,foreign_pf,foreign_ib,foreign_id,foreign_mf,foreign_sc,foreign_fd,foreign_ot,foreign_total
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const delH = db.prepare('DELETE FROM holdings WHERE snapshot_date=?');
      const insH = db.prepare(`INSERT INTO holdings(
        snapshot_date,code,issuer,investor,investor_norm,type,lf,nationality,domicile,holdings,pct
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      const insI = db.prepare(`INSERT OR REPLACE INTO issued_history(code,issue_date,type,shares,total_shares)
                               VALUES (?,?,?,?,?)`);
      const mByCode = {};
      for (const m of master) mByCode[String(m.code || '').toUpperCase()] = m;

      let nB = 0, nH = 0, nI = 0;
      const tx = db.transaction(() => {
        delB.run(snap); delH.run(snap);
        for (const r of bal) {
          const code = String(r.code || '').toUpperCase();
          if (!code) continue;
          const L = Array.isArray(r.local) ? r.local : [];
          const F = Array.isArray(r.foreign) ? r.foreign : [];
          if (L.length !== 9 || F.length !== 9) continue;
          const lt = r.local_total != null ? r.local_total : L.reduce((a, b) => a + (b || 0), 0);
          const ft = r.foreign_total != null ? r.foreign_total : F.reduce((a, b) => a + (b || 0), 0);
          insB.run(snap, code, r.sec_num || 0, r.price || 0,
            ...L.map(v => v || 0), lt, ...F.map(v => v || 0), ft);
          nB++;
          const issuer = (mByCode[code] && mByCode[code].issuer) || '';
          // pct = pangsa terhadap saham yang TERCATAT di KSEI (scripless),
          // bukan listed_shares: banyak emiten lama baru sebagian scripless
          // (ADCP 10%, AALI 20%), sehingga basis sec_num menyesatkan.
          const base = (lt + ft) || r.sec_num || 0;
          for (let i = 0; i < 9; i++) {
            for (const [vals, lf, nat] of [[L, 'L', 'LOCAL'], [F, 'F', 'FOREIGN']]) {
              const v = vals[i] || 0;
              if (!v) continue;
              // investor harus unik per (code, tipe, nasionalitas) -> beri prefiks LOKAL/ASING
              const invName = (lf === 'L' ? 'LOCAL ' : 'FOREIGN ') + KSEI_TYPES[i];
              insH.run(snap, code, issuer, invName, KSEI_TYPES[i], 'EQUITY', lf, nat, '', v,
                base > 0 ? Math.round(v / base * 1000000) / 10000 : 0);
              nH++;
            }
          }
        }
        for (const m of master) {
          const code = String(m.code || '').toUpperCase();
          if (!code || !m.shares) continue;
          // Listing Date di file master KSEI berformat DD-MMM-YYYY ("01-APR-2024").
          // Disimpan mentah, kolom ini tidak bisa diurutkan/di-MIN-MAX: teks itu
          // membandingkan hari lebih dulu, sehingga MIN() bisa > MAX() (kanban
          // t_b00757f3). Normalisasi ke ISO di sini; bentuk tak dikenal -> pakai snap.
          const dt = toIsoDate(m.listing_date) || snap;
          insI.run(code, dt, 'LISTED', m.shares, m.shares);
          nI++;
        }
      });
      tx();
      res.json({ ok: true, snapshot_date: snap, balance_rows: nB, holdings_rows: nH, issued_rows: nI });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ SECTORAL MOVEMENT — return harian sektor, dihitung dari idx_daily ═══
  // Sumber lama (sectoral_movement) berhenti 2026-09-30 DAN menyimpan change_pct
  // kumulatif; kode lama lalu menghitung persen-dari-persen -> angka tak bermakna.
  router.get('/sectoral', (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days) || 60, 500);
      const dates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT ?')
        .all(days).map(r => r.trade_date).reverse();
      if (dates.length < 2) return res.json({ sectors: [], dates: [], data: {}, total: 0 });
      const rows = db.prepare(`
        SELECT d.trade_date AS dt, cp.sector AS sector,
               AVG((d.close - d.prev_close) * 1.0 / d.prev_close * 100) AS chg,
               COUNT(*) AS n
        FROM idx_daily d
        JOIN company_profiles cp ON d.code = cp.code
        WHERE d.trade_date >= ? AND d.close > 0 AND d.prev_close > 0
          AND cp.sector IS NOT NULL AND cp.sector != ''
        GROUP BY d.trade_date, cp.sector
      `).all(dates[0]);
      const dateMap = {};
      const sectorSet = new Set();
      for (const r of rows) {
        sectorSet.add(r.sector);
        (dateMap[r.dt] = dateMap[r.dt] || {})[r.sector] = Math.round(r.chg * 100) / 100;
      }
      res.json({
        sectors: Array.from(sectorSet).sort(),
        dates: dates.filter(d => dateMap[d]),
        data: dateMap,
        total: rows.length,
        method: 'equal_weight',
        source: 'idx_daily'
      });
    } catch (e) { res.json({ sectors: [], dates: [], data: {}, error: e.message }); }
  });

  // ═══ INDUSTRY TRADING — PER/PBV/value per industry over time ═══
  router.get('/industry-overview', (req, res) => {
    try {
      // Latest date's industry stats
      const latestDate = db.prepare('SELECT MAX(trade_date) as d FROM industry_trading').get()?.d;
      if (!latestDate) return res.json({ data: [], trade_date: null });
      const rows = db.prepare('SELECT * FROM industry_trading WHERE trade_date=? ORDER BY value DESC').all(latestDate);
      res.json({ data: rows, trade_date: latestDate });
    } catch (e) { res.json({ data: [], error: e.message }); }
  });

  // ═══ COMPOSITE SCORE — Multi-factor ranking engine ═══
  router.post('/composite-score', (req, res) => {
    return res.status(410).json({ ok:false, error:'composite-score sudah dipensiunkan (UI dan pemakainya dihapus)' });
    try {
      const { w_fundamental, w_valuation, w_momentum, w_demand, w_foreign } = req.body || {};
      const wF = parseFloat(w_fundamental) || 25;
      const wV = parseFloat(w_valuation) || 20;
      const wM = parseFloat(w_momentum) || 20;
      const wD = parseFloat(w_demand) || 20;
      const wFR = parseFloat(w_foreign) || 15;
      const wTotal = wF + wV + wM + wD + wFR || 100;

      const td = latestIdxDate();
      if (!td) return res.json({ error: 'No trade data' });

      // ── 1. Get all stocks with today's data ──
      const allDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT 210').all().map(r => r.trade_date);
      const stocks = db.prepare(`SELECT *, (foreign_buy-foreign_sell) as foreign_net,
        ((foreign_buy-foreign_sell)*close) as fnet_val,
        CASE WHEN prev_close>0 THEN ROUND(CAST((close-prev_close)AS REAL)/prev_close*100,2) ELSE 0 END as change_pct,
        (close*listed_shares) as market_cap
        FROM idx_daily WHERE trade_date=? AND close>0`).all(td);

      // ── 2. Liquidity filter: avg freq >= 10 ──
      const avgDates = allDates.slice(1, 21);
      const freqMap = {};
      if (avgDates.length >= 5) {
        const ph = avgDates.map(() => '?').join(',');
        db.prepare(`SELECT code, AVG(frequency) as avg_freq, AVG(volume) as avg_vol FROM idx_daily WHERE trade_date IN (${ph}) AND close>0 GROUP BY code`).all(...avgDates)
          .forEach(r => { freqMap[r.code] = r; });
      }
      const liquid = stocks.filter(s => {
        const af = freqMap[s.code];
        return af && af.avg_freq >= 10 && s.market_cap > 50e9;
      });

      // ── 3. Fundamental data ──
      const { latestFundDate } = require('../db');
      const fm = latestFundDate();
      const fundMap = {};
      if (fm) {
        db.prepare('SELECT code, name, sector, industry, per, pbv, roe, roa, der, npm FROM idx_fundamental WHERE snapshot_month=?').all(fm)
          .forEach(f => { fundMap[f.code] = f; });
      }

      // ── 4. Industry medians ──
      const indMedian = {};
      if (fm) {
        const inds = db.prepare(`SELECT industry, 
          AVG(per) as avg_per, AVG(pbv) as avg_pbv
          FROM idx_fundamental WHERE snapshot_month=? AND per>0 AND per<200 AND pbv>0 AND pbv<50
          GROUP BY industry`).all(fm);
        inds.forEach(r => { indMedian[r.industry] = r; });
      }

      // ── 5. Dividend yield ──
      const divMap = {};
      try {
        db.prepare('SELECT code, cash_dividend FROM bei_dividends WHERE (code, ex_date) IN (SELECT code, MAX(ex_date) FROM bei_dividends GROUP BY code)').all()
          .forEach(r => { divMap[r.code] = r.cash_dividend; });
      } catch {}

      // ── 6. Compute MA + RSI + MACD per stock ──
      // Batch: get last 210 days of closes for each liquid stock
      const codes = liquid.map(s => s.code);
      const histMap = {};
      if (codes.length && allDates.length >= 20) {
        const ph = codes.map(() => '?').join(',');
        const rows = db.prepare(`SELECT code, trade_date, close, foreign_buy, foreign_sell, bid_vol, offer_vol, value, frequency, volume FROM idx_daily WHERE code IN (${ph}) ORDER BY code, trade_date`).all(...codes);
        rows.forEach(r => {
          if (!histMap[r.code]) histMap[r.code] = [];
          histMap[r.code].push(r);
        });
      }

      // Aksi korporasi (ca_factors): harga SEBELUM ex_date dikalikan faktor supaya
      // MA/RSI/MACD/ret dihitung dari deret yang kontinu. Tanpa ini, split 1:5 di
      // dalam jendela 200 hari merusak 5 dari 50 fitur (dan 25% bobot score_momentum).
      // `close` mentah sengaja tetap dipakai untuk nilai UANG (fnet, div_yield,
      // market_cap, bid/offer) — itu harga x lembar pada hari itu, bukan deret.
      const caFactors = loadFactors(db);
      Object.keys(histMap).forEach(c => adjustRows(histMap[c], caFactors[c], { volumeFields: { volume: 'avol' } }));

      function calcMA(closes, n) {
        if (closes.length < n) return 0;
        return closes.slice(-n).reduce((s, v) => s + v, 0) / n;
      }

      function calcRSI(closes, period) {
        if (closes.length < period + 1) return 50;
        let gainSum = 0, lossSum = 0;
        for (let i = closes.length - period; i < closes.length; i++) {
          const d = closes[i] - closes[i - 1];
          if (d > 0) gainSum += d; else lossSum += Math.abs(d);
        }
        const avgGain = gainSum / period;
        const avgLoss = lossSum / period;
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
      }

      // MACD 12/26/9 — signal = TRUE 9-period EMA of the full MACD line (SMA-9
      // seed, then recursive). Same math as screener.js / backtest.js so one code
      // gets one MACD answer everywhere. Replaces the old slice-based approximation
      // whose signal only saw the last 10 windows (kanban t_3578a0b7, 2026-09-11).
      function calcMACD(closes) {
        if (closes.length < 26) return { macd: 0, signal: 0, hist: 0 };
        const k12 = 2 / 13, k26 = 2 / 27;
        let e12 = closes.slice(0, 12).reduce((s, v) => s + v, 0) / 12;
        let e26 = closes.slice(0, 26).reduce((s, v) => s + v, 0) / 26;
        const macdLine = [];
        for (let i = 0; i < closes.length; i++) {
          if (i < 12) e12 = closes.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1);
          else e12 = closes[i] * k12 + e12 * (1 - k12);
          if (i < 26) e26 = closes.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1);
          else e26 = closes[i] * k26 + e26 * (1 - k26);
          macdLine.push(e12 - e26);
        }
        const k9 = 2 / 10;
        let sig = macdLine.slice(0, 9).reduce((s, v) => s + v, 0) / 9;
        for (let i = 0; i < macdLine.length; i++) {
          if (i < 9) sig = macdLine.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1);
          else sig = macdLine[i] * k9 + sig * (1 - k9);
        }
        const macdVal = macdLine[macdLine.length - 1];
        return { macd: Math.round(macdVal * 100) / 100, signal: Math.round(sig * 100) / 100, hist: Math.round((macdVal - sig) * 100) / 100 };
      }

      // ── 6b. Commodity momentum bonus ──
      const COMMODITY_TICKER_MAP = {
        'AALI':'CPO','LSIP':'CPO','SIMP':'CPO','TBLA':'CPO','SSMS':'CPO','DSNG':'CPO','SGRO':'CPO',
        'ADRO':'COAL','PTBA':'COAL','ITMG':'COAL','BUMI':'COAL','HRUM':'COAL','BYAN':'COAL','DSSA':'COAL','MBAP':'COAL','GEMS':'COAL','ABMM':'COAL',
        'INCO':'NICKEL','ANTM':'NICKEL','NCKL':'NICKEL','MBMA':'NICKEL',
        'MDKA':'GOLD','ARCI':'GOLD','BRMS':'GOLD','PSAB':'GOLD',
        'TINS':'TIN',
        'MEDC':'OIL','ELSA':'OIL','AKRA':'OIL'
      };
      const COMMODITY_OHLC_MAP = {
        'CPO':['CPO'],'COAL':['COAL','NCF'],'NICKEL':['NICKEL','HGK6'],
        'GOLD':['XAUUSD'],'TIN':['TIN'],'OIL':['BRENT','CRUDE']
      };
      function getCommodityCode(code, sector, industry) {
        if (COMMODITY_TICKER_MAP[code]) return COMMODITY_TICKER_MAP[code];
        const kw = ((sector||'')+ ' '+(industry||'')).toLowerCase();
        if (kw.includes('palm')||kw.includes('plantation')||kw.includes('sawit')) return 'CPO';
        if (kw.includes('coal')||kw.includes('batubara')) return 'COAL';
        if (kw.includes('nickel')||kw.includes('nikel')) return 'NICKEL';
        if (kw.includes('gold')||kw.includes('emas')) return 'GOLD';
        if (kw.includes('tin')||kw.includes('timah')) return 'TIN';
        if (kw.includes('oil')||kw.includes('gas')||kw.includes('minyak')) return 'OIL';
        return null;
      }
      const commodityMomentum = {};
      try {
        [...new Set(Object.values(COMMODITY_TICKER_MAP))].forEach(cmdCode => {
          const ohlcCodes = COMMODITY_OHLC_MAP[cmdCode] || [cmdCode];
          for (const oc of ohlcCodes) {
            const rows = db.prepare(`SELECT trade_date, close FROM custom_ohlc WHERE code=? AND ${REGULAR_SESSION} ORDER BY trade_date DESC LIMIT 30`).all(oc);
            if (rows.length >= 6) {
              const now = rows[0].close, d5 = rows[5]?.close || now, d20 = rows[Math.min(20, rows.length-1)]?.close || now;
              commodityMomentum[cmdCode] = { code: oc, price: now,
                ret5d: d5>0 ? (now-d5)/d5*100 : 0, ret20d: d20>0 ? (now-d20)/d20*100 : 0 };
              break;
            }
          }
        });
      } catch(e) {}

      // ── 7. Score each stock ──
      const results = [];

      // Collect raw values for percentile ranking
      const rawFund = [], rawVal = [], rawMom = [];

      liquid.forEach(s => {
        const fund = fundMap[s.code] || {};
        const hist = histMap[s.code] || [];
        // closes = deret TERKOREKSI aksi korporasi (ac); baris terakhir = hari skoring
        // sehingga ac == close mentah di situ dan ma*_pct tetap apple-to-apple.
        const closes = hist.map(r => r.ac != null ? r.ac : r.close);
        const lastPx = closes.length ? closes[closes.length - 1] : s.close;
        const fnets = hist.map(r => (r.foreign_buy - r.foreign_sell) * r.close);

        // MAs
        const ma5 = Math.round(calcMA(closes, 5));
        const ma10 = Math.round(calcMA(closes, 10));
        const ma20 = Math.round(calcMA(closes, 20));
        const ma50 = Math.round(calcMA(closes, 50));
        const ma200 = Math.round(calcMA(closes, 200));
        const ma5_pct = ma5 > 0 ? Math.round((lastPx - ma5) / ma5 * 10000) / 100 : 0;
        const ma10_pct = ma10 > 0 ? Math.round((lastPx - ma10) / ma10 * 10000) / 100 : 0;
        const ma20_pct = ma20 > 0 ? Math.round((lastPx - ma20) / ma20 * 10000) / 100 : 0;
        const ma50_pct = ma50 > 0 ? Math.round((lastPx - ma50) / ma50 * 10000) / 100 : 0;
        const ma200_pct = ma200 > 0 ? Math.round((lastPx - ma200) / ma200 * 10000) / 100 : 0;
        const rsi14 = calcRSI(closes, 14);
        const macd = calcMACD(closes);

        // Returns (deret terkoreksi: split di dalam jendela tidak lagi dihitung sebagai -80%)
        const ret_5d = closes.length >= 6 ? Math.round((lastPx - closes[closes.length - 6]) / closes[closes.length - 6] * 10000) / 100 : 0;
        const ret_20d = closes.length >= 21 ? Math.round((lastPx - closes[closes.length - 21]) / closes[closes.length - 21] * 10000) / 100 : 0;

        // Foreign 5d net
        const fnet5 = fnets.slice(-5).reduce((a, b) => a + b, 0);
        const fnet5d = fnets.slice(-5);
        const fnetBuyDays = fnet5d.filter(v => v > 0).length;
        const fnetDir = fnetBuyDays >= 4 ? 'strong_buy' : fnetBuyDays >= 3 ? 'buy' : fnetBuyDays <= 1 ? 'strong_sell' : fnetBuyDays <= 2 ? 'sell' : 'neutral';

        // ── NEW: Demand/Supply metrics ──
        const bidVols = hist.map(r => r.bid_vol || 0);
        const offerVols = hist.map(r => r.offer_vol || 0);
        const volumes = hist.map(r => r.volume || 0);
        const values = hist.map(r => r.value || 0);
        const freqs = hist.map(r => r.frequency || 0);

        // Bid/Offer ratio (today)
        const todayBid = bidVols.length > 0 ? bidVols[bidVols.length - 1] : 0;
        const todayOffer = offerVols.length > 0 ? offerVols[offerVols.length - 1] : 0;
        const totalBO = todayBid + todayOffer;
        const bidOfferRatio = totalBO > 0 ? Math.round(todayBid / totalBO * 1000) / 1000 : 0.5;

        // Bid/Offer 5d avg ratio
        const bo5d = bidVols.slice(-5).map((b, i) => {
          const o = offerVols.slice(-5)[i] || 0;
          return (b + o) > 0 ? b / (b + o) : 0.5;
        });
        const bidOffer5d = bo5d.length > 0 ? Math.round(bo5d.reduce((a, b) => a + b, 0) / bo5d.length * 1000) / 1000 : 0.5;

        // RelVol (volume vs 20d avg)
        const avgVol20 = volumes.length >= 21 ? volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20 : 0;
        const relVol = avgVol20 > 0 ? Math.round(volumes[volumes.length - 1] / avgVol20 * 100) / 100 : 1;

        // Freq spike (frequency vs 20d avg)
        const avgFreq20 = freqs.length >= 21 ? freqs.slice(-21, -1).reduce((a, b) => a + b, 0) / 20 : 0;
        const freqSpike = avgFreq20 > 0 ? Math.round(freqs[freqs.length - 1] / avgFreq20 * 100) / 100 : 1;

        // Value spike (value vs 20d avg)
        const avgVal20 = values.length >= 21 ? values.slice(-21, -1).reduce((a, b) => a + b, 0) / 20 : 0;
        const valSpike = avgVal20 > 0 ? Math.round(values[values.length - 1] / avgVal20 * 100) / 100 : 1;

        // ── NEW: Foreign Smart Money metrics ──
        // FNet 10d & 20d
        const fnet10 = fnets.slice(-10).reduce((a, b) => a + b, 0);
        const fnet20 = fnets.slice(-20).reduce((a, b) => a + b, 0);

        // Foreign % of value (proxy: abs foreign activity / total value, last 5 days)
        const fBuys5 = hist.slice(-5).map(r => (r.foreign_buy || 0) * r.close);
        const fSells5 = hist.slice(-5).map(r => (r.foreign_sell || 0) * r.close);
        const vals5 = hist.slice(-5).map(r => r.value || 0);
        const totForeign5 = fBuys5.reduce((a, b) => a + b, 0) + fSells5.reduce((a, b) => a + b, 0);
        const totVal5 = vals5.reduce((a, b) => a + b, 0);
        const foreignPctVal = totVal5 > 0 ? Math.round(totForeign5 / totVal5 * 1000) / 10 : 0;

        // Foreign accumulation streak (consecutive days net buy)
        let accumStreak = 0;
        for (let fi = fnets.length - 1; fi >= 0; fi--) {
          if (fnets[fi] > 0) accumStreak++; else break;
        }

        // FNet vs 20d average (spike detection)
        const avgFnet20 = fnets.length >= 21 ? fnets.slice(-21, -1).reduce((a, b) => a + Math.abs(b), 0) / 20 : 0;
        const fnetVsAvg = avgFnet20 > 0 ? Math.round(fnets[fnets.length - 1] / avgFnet20 * 100) / 100 : 0;

        // Valuation vs industry
        const indM = fund.industry ? (indMedian[fund.industry] || {}) : {};
        const per_vs = fund.per > 0 && indM.avg_per > 0 ? Math.round((fund.per / indM.avg_per - 1) * 10000) / 100 : 0;
        const pbv_vs = fund.pbv > 0 && indM.avg_pbv > 0 ? Math.round((fund.pbv / indM.avg_pbv - 1) * 10000) / 100 : 0;
        const divYield = divMap[s.code] && s.close > 0 ? Math.round(divMap[s.code] / s.close * 10000) / 100 : 0;

        results.push({
          code: s.code, name: s.name || fund.name || '', close: s.close, change_pct: s.change_pct,
          sector: fund.sector || '', industry: fund.industry || '', market_cap: s.market_cap,
          // Fundamental raw
          roe: fund.roe || 0, roa: fund.roa || 0, npm: fund.npm || 0, der: fund.der || 0,
          // Valuation raw
          per: fund.per || 0, pbv: fund.pbv || 0, per_vs_ind: per_vs, pbv_vs_ind: pbv_vs, div_yield: divYield,
          // Momentum raw
          ma5, ma10, ma20, ma50, ma200,
          ma5_pct, ma10_pct, ma20_pct, ma50_pct, ma200_pct,
          rsi14, macd: macd.macd, macd_signal: macd.signal, macd_hist: macd.hist,
          ret_5d, ret_20d, fnet_5d: fnet5, fnet_dir: fnetDir,
          // Demand/Supply raw (NEW)
          bid_offer_ratio: bidOfferRatio, bid_offer_5d: bidOffer5d,
          rel_vol: relVol, freq_spike: freqSpike, val_spike: valSpike,
          // Foreign Smart Money raw (NEW)
          fnet_10d: fnet10, fnet_20d: fnet20,
          foreign_pct_val: foreignPctVal, foreign_accum_streak: accumStreak, fnet_vs_avg: fnetVsAvg
        });
      });

      // ── 8. Percentile ranking (0-100) ──
      function rankPercentile(arr, key, higherIsBetter) {
        const valid = arr.filter(r => r[key] !== 0 && r[key] !== undefined && !isNaN(r[key]));
        const sorted = valid.slice().sort((a, b) => higherIsBetter ? a[key] - b[key] : b[key] - a[key]);
        const rankMap = {};
        sorted.forEach((r, i) => { rankMap[r.code] = Math.round(i / (sorted.length - 1 || 1) * 100); });
        arr.forEach(r => { r['_r_' + key] = rankMap[r.code] || 50; });
      }

      // Fundamental ranks (higher = better, except DER lower = better)
      rankPercentile(results, 'roe', true);
      rankPercentile(results, 'roa', true);
      rankPercentile(results, 'npm', true);
      rankPercentile(results, 'der', false);

      // Valuation ranks (lower = cheaper = better)
      rankPercentile(results, 'per_vs_ind', false);
      rankPercentile(results, 'pbv_vs_ind', false);
      rankPercentile(results, 'div_yield', true);

      // Momentum ranks
      rankPercentile(results, 'ma20_pct', true);
      rankPercentile(results, 'ma200_pct', true);
      rankPercentile(results, 'ret_20d', true);
      rankPercentile(results, 'rsi14', true); // higher RSI = stronger momentum
      rankPercentile(results, 'fnet_5d', true);

      // Demand/Supply ranks (NEW)
      rankPercentile(results, 'bid_offer_ratio', true);  // higher bid ratio = more demand
      rankPercentile(results, 'bid_offer_5d', true);
      rankPercentile(results, 'rel_vol', true);           // higher relative volume = unusual activity
      rankPercentile(results, 'freq_spike', true);
      rankPercentile(results, 'val_spike', true);

      // Foreign Smart Money ranks (NEW)
      rankPercentile(results, 'fnet_10d', true);
      rankPercentile(results, 'fnet_20d', true);
      rankPercentile(results, 'foreign_pct_val', true);   // higher = more foreign driven
      rankPercentile(results, 'foreign_accum_streak', true);
      rankPercentile(results, 'fnet_vs_avg', true);       // positive spike = bullish

      // ── 9. Compute sub-scores and composite ──
      results.forEach(r => {
        r.score_fundamental = Math.round((r._r_roe * 0.3 + r._r_roa * 0.2 + r._r_npm * 0.3 + r._r_der * 0.2) * 10) / 10;
        r.score_valuation = Math.round((r._r_per_vs_ind * 0.35 + r._r_pbv_vs_ind * 0.35 + r._r_div_yield * 0.3) * 10) / 10;
        r.score_momentum = Math.round((r._r_ma20_pct * 0.2 + r._r_ma200_pct * 0.15 + r._r_ret_20d * 0.25 + r._r_rsi14 * 0.15 + r._r_fnet_5d * 0.25) * 10) / 10;
        r.score_demand = Math.round((r._r_bid_offer_ratio * 0.25 + r._r_bid_offer_5d * 0.25 + r._r_rel_vol * 0.2 + r._r_freq_spike * 0.15 + r._r_val_spike * 0.15) * 10) / 10;
        r.score_foreign = Math.round((r._r_fnet_10d * 0.2 + r._r_fnet_20d * 0.2 + r._r_foreign_pct_val * 0.2 + r._r_foreign_accum_streak * 0.2 + r._r_fnet_vs_avg * 0.2) * 10) / 10;
        // Commodity momentum bonus (-10 to +10) for commodity-linked stocks
        const cmdCode = getCommodityCode(r.code, r.sector, r.industry);
        const cmdMom = cmdCode ? commodityMomentum[cmdCode] : null;
        let commodity_bonus = 0;
        if (cmdMom) {
          const rawMom = cmdMom.ret5d * 0.4 + cmdMom.ret20d * 0.6;
          commodity_bonus = Math.round(Math.max(-10, Math.min(10, rawMom)) * 10) / 10;
        }
        r.commodity_code = cmdCode || null;
        r.commodity_bonus = commodity_bonus;
        r.score_composite = Math.round(Math.max(0, Math.min(100,
          (r.score_fundamental * wF + r.score_valuation * wV + r.score_momentum * wM + r.score_demand * wD + r.score_foreign * wFR) / wTotal + commodity_bonus
        )) * 10) / 10;
        // Cleanup rank keys
        Object.keys(r).filter(k => k.startsWith('_r_')).forEach(k => delete r[k]);
      });

      // Sort by composite desc, take top 100
      results.sort((a, b) => b.score_composite - a.score_composite);
      const top = results.slice(0, 100);

      // ── 10. Save to daily_scores ──
      const insScore = db.prepare(`INSERT OR REPLACE INTO daily_scores(calc_date,code,name,close,change_pct,sector,industry,market_cap,
        score_fundamental,score_valuation,score_momentum,score_demand,score_foreign,score_composite,
        roe,roa,npm,der,per,pbv,per_vs_ind,pbv_vs_ind,div_yield,
        ma5,ma10,ma20,ma50,ma200,ma5_pct,ma10_pct,ma20_pct,ma50_pct,ma200_pct,
        rsi14,macd,macd_signal,macd_hist,ret_5d,ret_20d,fnet_5d,fnet_dir,
        bid_offer_ratio,bid_offer_5d,rel_vol,freq_spike,val_spike,
        fnet_10d,fnet_20d,foreign_pct_val,foreign_accum_streak,fnet_vs_avg,
        w_fundamental,w_valuation,w_momentum,w_demand,w_foreign,
        variant,code_version)
        VALUES(${Array(58).fill('?').join(',')})`);
      db.transaction(() => {
        top.forEach(r => {
          insScore.run(td, r.code, r.name, r.close, r.change_pct, r.sector, r.industry, r.market_cap,
            r.score_fundamental, r.score_valuation, r.score_momentum, r.score_demand, r.score_foreign, r.score_composite,
            r.roe, r.roa, r.npm, r.der, r.per, r.pbv, r.per_vs_ind, r.pbv_vs_ind, r.div_yield,
            r.ma5, r.ma10, r.ma20, r.ma50, r.ma200, r.ma5_pct, r.ma10_pct, r.ma20_pct, r.ma50_pct, r.ma200_pct,
            r.rsi14, r.macd, r.macd_signal, r.macd_hist, r.ret_5d, r.ret_20d, r.fnet_5d, r.fnet_dir,
            r.bid_offer_ratio, r.bid_offer_5d, r.rel_vol, r.freq_spike, r.val_spike,
            r.fnet_10d, r.fnet_20d, r.foreign_pct_val, r.foreign_accum_streak, r.fnet_vs_avg,
            wF, wV, wM, wD, wFR,
            SCORE_VARIANT, getCodeVersion());
        });
      })();

      res.json({
        ok: true, trade_date: td, total_liquid: liquid.length, total_scored: top.length,
        weights: { fundamental: wF, valuation: wV, momentum: wM, demand: wD, foreign: wFR },
        commodity_data: commodityMomentum,
        data: top
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET latest scores (no recalculation)
  router.get('/composite-score', (req, res) => {
    return res.status(410).json({ ok:false, error:'composite-score sudah dipensiunkan (UI dan pemakainya dihapus)' });
    try {
      const td = req.query.date || latestIdxDate();
      if (!td) return res.json({ data: [], trade_date: null });
      const rows = db.prepare('SELECT * FROM daily_scores WHERE calc_date=? ORDER BY score_composite DESC LIMIT 100').all(td);
      const w = rows.length ? { fundamental: rows[0].w_fundamental, valuation: rows[0].w_valuation, momentum: rows[0].w_momentum } : { fundamental: 30, valuation: 25, momentum: 30 };
      res.json({ data: rows, trade_date: td, weights: w });
    } catch (e) { res.json({ data: [], error: e.message }); }
  });

  // ═══ BACKFILL SCORES — calculate for historical dates ═══
  router.post('/composite-score/backfill', (req, res) => {
    return res.status(410).json({ ok:false, error:'composite-score sudah dipensiunkan (UI dan pemakainya dihapus)' });
    try {
      const { from, to, w_fundamental, w_valuation, w_momentum, w_demand, w_foreign, point_in_time, fund_source, fund_lag_days } = req.body || {};
      if (!from || !to) return res.status(400).json({ error: 'from and to required (YYYY-MM-DD)' });
      // Fundamental PIT source: 'idx_fundamental' (default, unchanged) or 'ratio_ttm'
      // (= IDX-API financial_ratios, own TTM normalisation, availability = quarter end + lag).
      const fundSource = (fund_source === 'ratio_ttm') ? 'ratio_ttm' : 'idx_fundamental';
      const fundLagDays = Number.isFinite(parseFloat(fund_lag_days)) ? parseFloat(fund_lag_days) : RATIO_LAG_DAYS_DEFAULT;
      const wF = parseFloat(w_fundamental) || 25;
      const wV = parseFloat(w_valuation) || 20;
      const wM = parseFloat(w_momentum) || 20;
      const wD = parseFloat(w_demand) || 20;
      const wFR = parseFloat(w_foreign) || 15;
      const wTotal = wF + wV + wM + wD + wFR || 100;

      // Get all trade dates in range
      const tradeDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily WHERE trade_date>=? AND trade_date<=? ORDER BY trade_date').all(from, to).map(r => r.trade_date);
      if (!tradeDates.length) return res.json({ ok: false, error: 'No trade dates in range' });

      // Point-in-time mode: get all available snapshot months
      const snapshotMonths = point_in_time ? getFundSnapshotMonths() : [];
      const usePIT = point_in_time && snapshotMonths.length > 1;

      // Fundamental data — either point-in-time or latest snapshot
      let fundMapGlobal = null; // will be set once if NOT PIT mode
      let globalSnapshot = null;
      if (!usePIT) {
        const { latestFundDate } = require('../db');
        const fm = latestFundDate();
        globalSnapshot = fm;
        if (fm) {
          fundMapGlobal = {};
          db.prepare('SELECT code, name, sector, industry, per, pbv, roe, roa, der, npm, fs_date FROM idx_fundamental WHERE snapshot_month=?').all(fm)
            .forEach(f => { fundMapGlobal[f.code] = f; });
        }
      }

      // Cache for PIT mode: snapshot_month → fundMap
      const pitCache = {};
      function getPITFundMap(tradeDate) {
        if (!usePIT) return { map: fundMapGlobal || {}, snapshot: globalSnapshot };
        const snap = getPointInTimeSnapshot(tradeDate, snapshotMonths);
        if (!snap) return { map: {}, snapshot: null };
        if (!pitCache[snap]) {
          pitCache[snap] = {};
          db.prepare('SELECT code, name, sector, industry, per, pbv, roe, roa, der, npm, fs_date FROM idx_fundamental WHERE snapshot_month=?').all(snap)
            .forEach(f => { pitCache[snap][f.code] = f; });
        }
        return { map: pitCache[snap], snapshot: snap };
      }
      // Source switch — identical contract to getPITFundMap, so nothing downstream of the
      // call site changes when ratio_ttm is selected.
      function getPITFundMapSelected(tradeDate) {
        if (fundSource === 'ratio_ttm') return getPITFundMapFromRatio(tradeDate, { lagDays: fundLagDays });
        return getPITFundMap(tradeDate);
      }
      // Industry medians — also per-snapshot for PIT mode
      const indMedianCache = {};
      function getIndMedian(snapshot) {
        if (!snapshot) return {};
        if (indMedianCache[snapshot]) return indMedianCache[snapshot];
        indMedianCache[snapshot] = {};
        try {
          db.prepare('SELECT industry, AVG(per) as avg_per, AVG(pbv) as avg_pbv FROM idx_fundamental WHERE snapshot_month=? AND per>0 AND per<200 AND pbv>0 AND pbv<50 GROUP BY industry').all(snapshot)
            .forEach(r => { indMedianCache[snapshot][r.industry] = r; });
        } catch(e) {}
        return indMedianCache[snapshot];
      }
      // Ratio-source medians (same filter/aggregate as above, but from financial_ratios at
      // the quarter end). NOTE: financial_ratios.per/pbv are as-of the quarter end, so this
      // valuation side lags the score date — /ic-fund-source quantifies that separately.
      const indMedianRatioCache = {};
      function getIndMedianFromRatio(snapshot) {
        if (!snapshot) return {};
        if (indMedianRatioCache[snapshot]) return indMedianRatioCache[snapshot];
        indMedianRatioCache[snapshot] = {};
        try {
          db.prepare('SELECT industry, AVG(per) as avg_per, AVG(pbv) as avg_pbv FROM financial_ratios WHERE period=? AND per>0 AND per<200 AND pbv>0 AND pbv<50 GROUP BY industry').all(snapshot)
            .forEach(r => { indMedianRatioCache[snapshot][r.industry] = r; });
        } catch(e) {}
        return indMedianRatioCache[snapshot];
      }
      const divMap = {};
      try {
        db.prepare('SELECT code, cash_dividend FROM bei_dividends WHERE (code, ex_date) IN (SELECT code, MAX(ex_date) FROM bei_dividends GROUP BY code)').all()
          .forEach(r => { divMap[r.code] = r.cash_dividend; });
      } catch {}

      // Commodity helpers (duplicated from composite-score handler for scope access)
      const COMMODITY_TICKER_MAP_BF = {
        'ADRO':'COAL','PTBA':'COAL','ITMG':'COAL','BUMI':'COAL','HRUM':'COAL','MBAP':'COAL','GEMS':'COAL',
        'AALI':'CPO','LSIP':'CPO','SIMP':'CPO','SSMS':'CPO','TBLA':'CPO','SGRO':'CPO','DSNG':'CPO',
        'ANTM':'NICKEL','INCO':'NICKEL','MDKA':'NICKEL','NCKL':'NICKEL',
        'TINS':'TIN','BRMS':'GOLD','ARCI':'GOLD','PSAB':'GOLD',
        'MEDC':'OIL','ELSA':'OIL','AKRA':'OIL','ESSA':'OIL'
      };
      const COMMODITY_OHLC_MAP_BF = {
        'CPO':['CPO'],'COAL':['COAL','NCF'],'NICKEL':['NICKEL','HGK6'],
        'GOLD':['XAUUSD'],'TIN':['TIN'],'OIL':['BRENT','CRUDE']
      };
      function getCommodityCode(code, sector, industry) {
        if (COMMODITY_TICKER_MAP_BF[code]) return COMMODITY_TICKER_MAP_BF[code];
        const kw = ((sector||'')+' '+(industry||'')).toLowerCase();
        if (kw.includes('palm')||kw.includes('plantation')||kw.includes('sawit')) return 'CPO';
        if (kw.includes('coal')||kw.includes('batubara')) return 'COAL';
        if (kw.includes('nickel')||kw.includes('nikel')) return 'NICKEL';
        if (kw.includes('gold')||kw.includes('emas')) return 'GOLD';
        if (kw.includes('tin')||kw.includes('timah')) return 'TIN';
        if (kw.includes('oil')||kw.includes('gas')||kw.includes('minyak')) return 'OIL';
        return null;
      }
      const commodityMomentum = {};
      try {
        [...new Set(Object.values(COMMODITY_TICKER_MAP_BF))].forEach(cmdCode => {
          const ohlcCodes = COMMODITY_OHLC_MAP_BF[cmdCode] || [cmdCode];
          for (const oc of ohlcCodes) {
            const rows = db.prepare(`SELECT trade_date, close FROM custom_ohlc WHERE code=? AND ${REGULAR_SESSION} ORDER BY trade_date DESC LIMIT 30`).all(oc);
            if (rows.length >= 6) {
              const now = rows[0].close, d5 = rows[5]?.close || now, d20 = rows[Math.min(20, rows.length-1)]?.close || now;
              commodityMomentum[cmdCode] = { code: oc, price: now,
                ret5d: d5>0 ? (now-d5)/d5*100 : 0, ret20d: d20>0 ? (now-d20)/d20*100 : 0 };
              break;
            }
          }
        });
      } catch(e) {}

      // Helper functions (same as single-day calc)
      function calcMA(closes, n) { if (closes.length < n) return 0; return closes.slice(-n).reduce((s, v) => s + v, 0) / n; }
      function calcRSI(closes, period) {
        if (closes.length < period + 1) return 50;
        let gainSum = 0, lossSum = 0;
        for (let i = closes.length - period; i < closes.length; i++) {
          const d = closes[i] - closes[i - 1];
          if (d > 0) gainSum += d; else lossSum += Math.abs(d);
        }
        const ag = gainSum / period, al = lossSum / period;
        if (al === 0) return 100;
        return Math.round((100 - 100 / (1 + ag / al)) * 10) / 10;
      }
      // MACD 12/26/9 — signal = true 9-period EMA of the full MACD line.
      // Identical math to the calcMACD above / screener.js / backtest.js.
      function calcMACD(closes) {
        if (closes.length < 26) return { macd: 0, signal: 0, hist: 0 };
        const k12 = 2 / 13, k26 = 2 / 27;
        let e12 = closes.slice(0, 12).reduce((s, v) => s + v, 0) / 12;
        let e26 = closes.slice(0, 26).reduce((s, v) => s + v, 0) / 26;
        const ml = [];
        for (let i = 0; i < closes.length; i++) {
          if (i < 12) e12 = closes.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1);
          else e12 = closes[i] * k12 + e12 * (1 - k12);
          if (i < 26) e26 = closes.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1);
          else e26 = closes[i] * k26 + e26 * (1 - k26);
          ml.push(e12 - e26);
        }
        const k9 = 2 / 10;
        let sig = ml.slice(0, 9).reduce((s, v) => s + v, 0) / 9;
        for (let i = 0; i < ml.length; i++) {
          if (i < 9) sig = ml.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1);
          else sig = ml[i] * k9 + sig * (1 - k9);
        }
        const m = ml[ml.length - 1];
        return { macd: Math.round(m * 100) / 100, signal: Math.round(sig * 100) / 100, hist: Math.round((m - sig) * 100) / 100 };
      }
      function rankPercentile(arr, key, higherIsBetter) {
        const valid = arr.filter(r => r[key] !== 0 && !isNaN(r[key]));
        const sorted = valid.slice().sort((a, b) => higherIsBetter ? a[key] - b[key] : b[key] - a[key]);
        const rm = {}; sorted.forEach((r, i) => { rm[r.code] = Math.round(i / (sorted.length - 1 || 1) * 100); });
        arr.forEach(r => { r['_r_' + key] = rm[r.code] || 50; });
      }

      // Pre-load ALL historical data for efficiency
      const allHist = {};
      const histRows = db.prepare('SELECT code, trade_date, close, prev_close, foreign_buy, foreign_sell, listed_shares, frequency, bid_vol, offer_vol, value, volume FROM idx_daily WHERE trade_date>=? ORDER BY code, trade_date')
        .all(tradeDates.length > 210 ? tradeDates[0] : from);
      histRows.forEach(r => { if (!allHist[r.code]) allHist[r.code] = []; allHist[r.code].push(r); });

      // Also load data before range for MA lookback
      const lookbackDate = new Date(new Date(from).getTime() - 220 * 86400000).toISOString().split('T')[0];
      const preRows = db.prepare('SELECT code, trade_date, close, foreign_buy, foreign_sell, bid_vol, offer_vol, value, volume, frequency FROM idx_daily WHERE trade_date>=? AND trade_date<? ORDER BY code, trade_date').all(lookbackDate, from);
      const preHist = {};
      preRows.forEach(r => { if (!preHist[r.code]) preHist[r.code] = []; preHist[r.code].push(r); });

      // Aksi korporasi (ca_factors): koreksi SEKALI di depan, bukan per tanggal hitung.
      // Semua deret yang dipakai MA/RSI/MACD/ret harus lewat ac; `close` mentah tetap
      // dipakai untuk uang (fnet, div_yield, market_cap) dan untuk change_pct, yang
      // sudah aman karena prev_close dari ingest juga basis terkoreksi.
      const caFactors = loadFactors(db);
      Object.keys(allHist).forEach(c => adjustRows(allHist[c], caFactors[c], { volumeFields: { volume: 'avol' } }));
      Object.keys(preHist).forEach(c => adjustRows(preHist[c], caFactors[c], { volumeFields: { volume: 'avol' } }));

      const insScore = db.prepare(`INSERT OR REPLACE INTO daily_scores(calc_date,code,name,close,change_pct,sector,industry,market_cap,
        score_fundamental,score_valuation,score_momentum,score_demand,score_foreign,score_composite,
        roe,roa,npm,der,per,pbv,per_vs_ind,pbv_vs_ind,div_yield,
        ma5,ma10,ma20,ma50,ma200,ma5_pct,ma10_pct,ma20_pct,ma50_pct,ma200_pct,
        rsi14,macd,macd_signal,macd_hist,ret_5d,ret_20d,fnet_5d,fnet_dir,
        bid_offer_ratio,bid_offer_5d,rel_vol,freq_spike,val_spike,
        fnet_10d,fnet_20d,foreign_pct_val,foreign_accum_streak,fnet_vs_avg,
        w_fundamental,w_valuation,w_momentum,w_demand,w_foreign,
        fund_snapshot_month,data_age_months,
        variant,code_version)
        VALUES(${Array(60).fill('?').join(',')})`);

      let totalScored = 0;

      db.transaction(() => {
        tradeDates.forEach(td => {
          // Get PIT or global fundamental data for this trade date
          const { map: fundMap, snapshot: usedSnap } = getPITFundMapSelected(td);
          const indMedian = (fundSource === 'ratio_ttm') ? getIndMedianFromRatio(usedSnap) : getIndMedian(usedSnap);
          // dataAge computed per-stock below using fs_date

          // Get stocks for this date
          const dayStocks = [];
          Object.keys(allHist).forEach(code => {
            const series = allHist[code];
            const idx = series.findIndex(r => r.trade_date === td);
            if (idx < 0) return;
            const r = series[idx];
            if (r.close <= 0) return;
            // Check liquidity (avg freq last 20 days)
            const recent = series.slice(Math.max(0, idx - 20), idx);
            const avgFreq = recent.length > 0 ? recent.reduce((s, x) => s + (x.frequency || 0), 0) / recent.length : 0;
            const mktCap = r.close * (r.listed_shares || 0);
            if (avgFreq < 10 || mktCap < 50e9) return;

            // Build close array (pre + current up to this date).
            // Faktor dihitung PER TANGGAL (factorAt) pada array gabungan: preHist dan
            // series adalah dua array terpisah, jadi koreksi per-array (adjustRows)
            // akan melewatkan event yang ex_date-nya di luar array itu — nyata:
            // preHist berakhir 2026-08-03, CA PBSA 2026-10-14 tidak mengoreksinya,
            // sementara cur terkoreksi -> deret melompat -50% di tengah.
            const pre = preHist[code] || [];
            const cur = series.slice(0, idx + 1);
            const allCloses = [...pre, ...cur].map(x => x.close * factorAt(caFactors[code], x.trade_date));
            const lastPx = allCloses.length ? allCloses[allCloses.length - 1] : r.close;
            const allFnets = [...pre.map(x => (x.foreign_buy - x.foreign_sell) * x.close), ...cur.map(x => (x.foreign_buy - x.foreign_sell) * x.close)];
            const allBidVols = [...pre.map(x => x.bid_vol || 0), ...cur.map(x => x.bid_vol || 0)];
            const allOfferVols = [...pre.map(x => x.offer_vol || 0), ...cur.map(x => x.offer_vol || 0)];
            const allVolumes = [...pre.map(x => x.volume || 0), ...cur.map(x => x.volume || 0)];
            const allValues = [...pre.map(x => x.value || 0), ...cur.map(x => x.value || 0)];
            const allFreqs = [...pre.map(x => x.frequency || 0), ...cur.map(x => x.frequency || 0)];
            const allFBuys = [...pre.map(x => (x.foreign_buy || 0) * x.close), ...cur.map(x => (x.foreign_buy || 0) * x.close)];
            const allFSells = [...pre.map(x => (x.foreign_sell || 0) * x.close), ...cur.map(x => (x.foreign_sell || 0) * x.close)];

            const fund = fundMap[code] || {};
            // ratio_ttm source: a code whose 4-quarter window is incomplete is NOT in the
            // map. Scoring it with zeroed fundamentals would hand it the neutral rank 50,
            // i.e. it would be approximated rather than excluded. Drop it from the day.
            // Guarded by the source flag so the legacy idx_fundamental path is untouched.
            if (fundSource === 'ratio_ttm' && !fundMap[code]) return;
            // Per-stock data age: scoring_date vs fiscal period end (fs_date)
            const stockFsAge = calcFsAge(td, fund.fs_date);
            const chgPct = r.prev_close > 0 ? Math.round((r.close - r.prev_close) / r.prev_close * 10000) / 100 : 0;
            const ma5 = Math.round(calcMA(allCloses, 5));
            const ma10 = Math.round(calcMA(allCloses, 10));
            const ma20 = Math.round(calcMA(allCloses, 20));
            const ma50 = Math.round(calcMA(allCloses, 50));
            const ma200 = Math.round(calcMA(allCloses, 200));
            const rsi14 = calcRSI(allCloses, 14);
            const macd = calcMACD(allCloses);
            const ret5 = allCloses.length >= 6 ? Math.round((lastPx - allCloses[allCloses.length - 6]) / allCloses[allCloses.length - 6] * 10000) / 100 : 0;
            const ret20 = allCloses.length >= 21 ? Math.round((lastPx - allCloses[allCloses.length - 21]) / allCloses[allCloses.length - 21] * 10000) / 100 : 0;
            const fnet5 = allFnets.slice(-5).reduce((a, b) => a + b, 0);
            const fnet5d = allFnets.slice(-5);
            const fnetBuyDays = fnet5d.filter(v => v > 0).length;
            const fnetDir = fnetBuyDays >= 4 ? 'strong_buy' : fnetBuyDays >= 3 ? 'buy' : fnetBuyDays <= 1 ? 'strong_sell' : fnetBuyDays <= 2 ? 'sell' : 'neutral';
            const indM = fund.industry ? (indMedian[fund.industry] || {}) : {};
            const perVs = fund.per > 0 && indM.avg_per > 0 ? Math.round((fund.per / indM.avg_per - 1) * 10000) / 100 : 0;
            const pbvVs = fund.pbv > 0 && indM.avg_pbv > 0 ? Math.round((fund.pbv / indM.avg_pbv - 1) * 10000) / 100 : 0;
            const divYield = divMap[code] && r.close > 0 ? Math.round(divMap[code] / r.close * 10000) / 100 : 0;

            // ── Demand/Supply metrics ──
            const tBid = allBidVols.length > 0 ? allBidVols[allBidVols.length - 1] : 0;
            const tOff = allOfferVols.length > 0 ? allOfferVols[allOfferVols.length - 1] : 0;
            const tBO = tBid + tOff;
            const bidOfferRatio = tBO > 0 ? Math.round(tBid / tBO * 1000) / 1000 : 0.5;
            const bo5 = allBidVols.slice(-5).map((b, bi) => { const o = allOfferVols.slice(-5)[bi] || 0; return (b + o) > 0 ? b / (b + o) : 0.5; });
            const bidOffer5d = bo5.length > 0 ? Math.round(bo5.reduce((a, b) => a + b, 0) / bo5.length * 1000) / 1000 : 0.5;
            const avgV20 = allVolumes.length >= 21 ? allVolumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20 : 0;
            const relVol = avgV20 > 0 ? Math.round(allVolumes[allVolumes.length - 1] / avgV20 * 100) / 100 : 1;
            const avgF20 = allFreqs.length >= 21 ? allFreqs.slice(-21, -1).reduce((a, b) => a + b, 0) / 20 : 0;
            const freqSpike = avgF20 > 0 ? Math.round(allFreqs[allFreqs.length - 1] / avgF20 * 100) / 100 : 1;
            const avgVl20 = allValues.length >= 21 ? allValues.slice(-21, -1).reduce((a, b) => a + b, 0) / 20 : 0;
            const valSpike = avgVl20 > 0 ? Math.round(allValues[allValues.length - 1] / avgVl20 * 100) / 100 : 1;

            // ── Foreign Smart Money metrics ──
            const fnet10 = allFnets.slice(-10).reduce((a, b) => a + b, 0);
            const fnet20 = allFnets.slice(-20).reduce((a, b) => a + b, 0);
            const fb5 = allFBuys.slice(-5).reduce((a, b) => a + b, 0);
            const fs5 = allFSells.slice(-5).reduce((a, b) => a + b, 0);
            const tv5 = allValues.slice(-5).reduce((a, b) => a + b, 0);
            const foreignPctVal = tv5 > 0 ? Math.round((fb5 + fs5) / tv5 * 1000) / 10 : 0;
            let accumStreak = 0;
            for (let fi2 = allFnets.length - 1; fi2 >= 0; fi2--) { if (allFnets[fi2] > 0) accumStreak++; else break; }
            const avgFn20 = allFnets.length >= 21 ? allFnets.slice(-21, -1).reduce((a, b) => a + Math.abs(b), 0) / 20 : 0;
            const fnetVsAvg = avgFn20 > 0 ? Math.round(allFnets[allFnets.length - 1] / avgFn20 * 100) / 100 : 0;

            dayStocks.push({
              code, name: r.name || fund.name || '', close: r.close, change_pct: chgPct,
              sector: fund.sector || '', industry: fund.industry || '', market_cap: mktCap,
              roe: fund.roe || 0, roa: fund.roa || 0, npm: fund.npm || 0, der: fund.der || 0,
              per: fund.per || 0, pbv: fund.pbv || 0, per_vs_ind: perVs, pbv_vs_ind: pbvVs, div_yield: divYield,
              ma5, ma10, ma20, ma50, ma200,
              ma5_pct: ma5 > 0 ? Math.round((lastPx - ma5) / ma5 * 10000) / 100 : 0,
              ma10_pct: ma10 > 0 ? Math.round((lastPx - ma10) / ma10 * 10000) / 100 : 0,
              ma20_pct: ma20 > 0 ? Math.round((lastPx - ma20) / ma20 * 10000) / 100 : 0,
              ma50_pct: ma50 > 0 ? Math.round((lastPx - ma50) / ma50 * 10000) / 100 : 0,
              ma200_pct: ma200 > 0 ? Math.round((lastPx - ma200) / ma200 * 10000) / 100 : 0,
              rsi14, macd: macd.macd, macd_signal: macd.signal, macd_hist: macd.hist,
              ret_5d: ret5, ret_20d: ret20, fnet_5d: fnet5, fnet_dir: fnetDir,
              bid_offer_ratio: bidOfferRatio, bid_offer_5d: bidOffer5d,
              rel_vol: relVol, freq_spike: freqSpike, val_spike: valSpike,
              fnet_10d: fnet10, fnet_20d: fnet20,
              foreign_pct_val: foreignPctVal, foreign_accum_streak: accumStreak, fnet_vs_avg: fnetVsAvg,
              _fs_age: stockFsAge
            });
          });

          if (dayStocks.length < 10) return; // skip days with too few stocks

          // Rank & score
          rankPercentile(dayStocks, 'roe', true); rankPercentile(dayStocks, 'roa', true);
          rankPercentile(dayStocks, 'npm', true); rankPercentile(dayStocks, 'der', false);
          rankPercentile(dayStocks, 'per_vs_ind', false); rankPercentile(dayStocks, 'pbv_vs_ind', false);
          rankPercentile(dayStocks, 'div_yield', true);
          rankPercentile(dayStocks, 'ma20_pct', true); rankPercentile(dayStocks, 'ma200_pct', true);
          rankPercentile(dayStocks, 'ret_20d', true); rankPercentile(dayStocks, 'rsi14', true);
          rankPercentile(dayStocks, 'fnet_5d', true);
          // Demand/Supply ranks
          rankPercentile(dayStocks, 'bid_offer_ratio', true); rankPercentile(dayStocks, 'bid_offer_5d', true);
          rankPercentile(dayStocks, 'rel_vol', true); rankPercentile(dayStocks, 'freq_spike', true);
          rankPercentile(dayStocks, 'val_spike', true);
          // Foreign Smart Money ranks
          rankPercentile(dayStocks, 'fnet_10d', true); rankPercentile(dayStocks, 'fnet_20d', true);
          rankPercentile(dayStocks, 'foreign_pct_val', true); rankPercentile(dayStocks, 'foreign_accum_streak', true);
          rankPercentile(dayStocks, 'fnet_vs_avg', true);

          dayStocks.forEach(r => {
            r.score_fundamental = Math.round((r._r_roe * 0.3 + r._r_roa * 0.2 + r._r_npm * 0.3 + r._r_der * 0.2) * 10) / 10;
            r.score_valuation = Math.round((r._r_per_vs_ind * 0.35 + r._r_pbv_vs_ind * 0.35 + r._r_div_yield * 0.3) * 10) / 10;
            r.score_momentum = Math.round((r._r_ma20_pct * 0.2 + r._r_ma200_pct * 0.15 + r._r_ret_20d * 0.25 + r._r_rsi14 * 0.15 + r._r_fnet_5d * 0.25) * 10) / 10;
            r.score_demand = Math.round((r._r_bid_offer_ratio * 0.25 + r._r_bid_offer_5d * 0.25 + r._r_rel_vol * 0.2 + r._r_freq_spike * 0.15 + r._r_val_spike * 0.15) * 10) / 10;
            r.score_foreign = Math.round((r._r_fnet_10d * 0.2 + r._r_fnet_20d * 0.2 + r._r_foreign_pct_val * 0.2 + r._r_foreign_accum_streak * 0.2 + r._r_fnet_vs_avg * 0.2) * 10) / 10;
            // Commodity bonus (backfill uses same logic — note: commodity data is latest, not historical)
            const cmdCode = getCommodityCode(r.code, r.sector, r.industry);
            const cmdMom = cmdCode ? commodityMomentum[cmdCode] : null;
            let cb = 0;
            if (cmdMom) { const rm = cmdMom.ret5d*0.4+cmdMom.ret20d*0.6; cb = Math.round(Math.max(-10,Math.min(10,rm))*10)/10; }
            r.commodity_bonus = cb;
            r.score_composite = Math.round(Math.max(0, Math.min(100,
              (r.score_fundamental * wF + r.score_valuation * wV + r.score_momentum * wM + r.score_demand * wD + r.score_foreign * wFR) / wTotal + cb
            )) * 10) / 10;
          });

          dayStocks.sort((a, b) => b.score_composite - a.score_composite);
          const top = dayStocks.slice(0, 100);
          top.forEach(r => {
            insScore.run(td, r.code, r.name, r.close, r.change_pct, r.sector, r.industry, r.market_cap,
              r.score_fundamental, r.score_valuation, r.score_momentum, r.score_demand, r.score_foreign, r.score_composite,
              r.roe, r.roa, r.npm, r.der, r.per, r.pbv, r.per_vs_ind, r.pbv_vs_ind, r.div_yield,
              r.ma5, r.ma10, r.ma20, r.ma50, r.ma200, r.ma5_pct, r.ma10_pct, r.ma20_pct, r.ma50_pct, r.ma200_pct,
              r.rsi14, r.macd, r.macd_signal, r.macd_hist, r.ret_5d, r.ret_20d, r.fnet_5d, r.fnet_dir,
              r.bid_offer_ratio, r.bid_offer_5d, r.rel_vol, r.freq_spike, r.val_spike,
              r.fnet_10d, r.fnet_20d, r.foreign_pct_val, r.foreign_accum_streak, r.fnet_vs_avg,
              wF, wV, wM, wD, wFR,
              usedSnap, r._fs_age,
              SCORE_VARIANT, getCodeVersion());
          });
          totalScored += top.length;
        });
      })();

      res.json({
        ok: true, dates_processed: tradeDates.length, total_scored: totalScored,
        from: tradeDates[0], to: tradeDates[tradeDates.length - 1],
        fund_source: fundSource, fund_lag_days: fundSource === 'ratio_ttm' ? fundLagDays : null,
        // ratio_ttm stores the QUARTER-END date (e.g. 2026-06-30) in fund_snapshot_month,
        // not a publication month. Existing rows for a (calc_date, code) are replaced because
        // daily_scores is UNIQUE(calc_date, code) — do not mix sources over the same dates
        // without snapshotting fund_snapshot_month first.
        note: fundSource === 'ratio_ttm'
          ? 'fund_snapshot_month holds the quarter end; availability = quarter end + ' + fundLagDays + ' days'
          : 'unchanged legacy path (idx_fundamental publication month)'
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ IC TRACKING — measure prediction quality ═══
  router.get('/ic-tracking', (req, res) => {
    try {
      const horizon = parseInt(req.query.horizon) || 5; // forward days
      const limit = Math.min(parseInt(req.query.limit) || 60, 250);

      // Get all scored dates
      const scoreDates = db.prepare('SELECT DISTINCT calc_date FROM daily_scores ORDER BY calc_date DESC LIMIT ?').all(limit).map(r => r.calc_date);
      if (scoreDates.length < 2) return res.json({ error: 'Need at least 2 days of scores', data: [] });
      scoreDates.reverse();

      // Get all trade dates for forward return lookup
      const allTradeDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
      const tdIndex = {};
      allTradeDates.forEach((d, i) => { tdIndex[d] = i; });

      const icData = [];

      scoreDates.forEach(sd => {
        const fwdIdx = (tdIndex[sd] || 0) + horizon;
        if (fwdIdx >= allTradeDates.length) return; // no forward data yet
        const fwdDate = allTradeDates[fwdIdx];

        // Get scores for this date
        const scores = db.prepare('SELECT code, score_composite, score_fundamental, score_valuation, score_momentum, score_demand, score_foreign, close FROM daily_scores WHERE calc_date=?').all(sd);
        if (scores.length < 20) return;

        // Get forward prices
        // ca_adj: return IC harus memakai harga terkoreksi — tanpa itu, satu split
        // dalam jendela horizon tercatat sebagai "return" -80% dan merusak IC.
        const fwdPrices = {};
        const codes = scores.map(s => s.code);
        const ph = codes.map(() => '?').join(',');
        db.prepare(`SELECT code, ca_adj(close, code, trade_date) AS ac FROM idx_daily WHERE trade_date=? AND code IN (${ph})`).all(fwdDate, ...codes)
          .forEach(r => { fwdPrices[r.code] = r.ac; });

        // Compute returns and rank correlation (Spearman)
        const caF = loadFactors(db);
        const pairs = [];
        scores.forEach(s => {
          const fwdClose = fwdPrices[s.code];
          const base = s.close > 0 ? s.close * factorAt(caF[s.code], sd) : 0;
          if (!fwdClose || !base) return;
          const ret = (fwdClose - base) / base * 100;
          pairs.push({ code: s.code, score: s.score_composite, scoreFund: s.score_fundamental, scoreVal: s.score_valuation, scoreMom: s.score_momentum, scoreDem: s.score_demand || 0, scoreFor: s.score_foreign || 0, ret });
        });

        if (pairs.length < 15) return;

        function spearmanIC(arr, scoreKey) {
          const n = arr.length;
          const byScore = arr.slice().sort((a, b) => a[scoreKey] - b[scoreKey]);
          const byRet = arr.slice().sort((a, b) => a.ret - b.ret);
          const scoreRank = {}; byScore.forEach((r, i) => { scoreRank[r.code] = i + 1; });
          const retRank = {}; byRet.forEach((r, i) => { retRank[r.code] = i + 1; });
          let d2sum = 0;
          arr.forEach(r => { const d = (scoreRank[r.code] || 0) - (retRank[r.code] || 0); d2sum += d * d; });
          return Math.round((1 - 6 * d2sum / (n * (n * n - 1))) * 10000) / 10000;
        }

        // Hit rate: top 20 score → how many actually positive return?
        const top20 = pairs.slice().sort((a, b) => b.score - a.score).slice(0, 20);
        const hitRate = Math.round(top20.filter(r => r.ret > 0).length / top20.length * 1000) / 10;
        const avgRetTop20 = Math.round(top20.reduce((s, r) => s + r.ret, 0) / top20.length * 100) / 100;
        const bot20 = pairs.slice().sort((a, b) => a.score - b.score).slice(0, 20);
        const avgRetBot20 = Math.round(bot20.reduce((s, r) => s + r.ret, 0) / bot20.length * 100) / 100;

        icData.push({
          date: sd, fwd_date: fwdDate, n: pairs.length,
          ic_composite: spearmanIC(pairs, 'score'),
          ic_fundamental: spearmanIC(pairs, 'scoreFund'),
          ic_valuation: spearmanIC(pairs, 'scoreVal'),
          ic_momentum: spearmanIC(pairs, 'scoreMom'),
          ic_demand: spearmanIC(pairs, 'scoreDem'),
          ic_foreign: spearmanIC(pairs, 'scoreFor'),
          hit_rate: hitRate,
          avg_ret_top20: avgRetTop20,
          avg_ret_bot20: avgRetBot20,
          spread: Math.round((avgRetTop20 - avgRetBot20) * 100) / 100
        });
      });

      // Summary stats
      const avgIC = icData.length ? Math.round(icData.reduce((s, r) => s + r.ic_composite, 0) / icData.length * 10000) / 10000 : 0;
      const avgHitRate = icData.length ? Math.round(icData.reduce((s, r) => s + r.hit_rate, 0) / icData.length * 10) / 10 : 0;
      const avgSpread = icData.length ? Math.round(icData.reduce((s, r) => s + r.spread, 0) / icData.length * 100) / 100 : 0;

      res.json({
        horizon, total_dates: icData.length,
        summary: { avg_ic: avgIC, avg_hit_rate: avgHitRate, avg_spread: avgSpread },
        data: icData
      });
    } catch (e) { res.json({ error: e.message, data: [] }); }
  });

  // Scored dates list
  router.get('/composite-score/dates', (req, res) => {
    return res.status(410).json({ ok:false, error:'composite-score sudah dipensiunkan (UI dan pemakainya dihapus)' });
    try {
      const rows = db.prepare('SELECT calc_date, COUNT(*) as stocks, ROUND(AVG(score_composite),1) as avg_score FROM daily_scores GROUP BY calc_date ORDER BY calc_date DESC LIMIT 250').all();
      res.json({ dates: rows });
    } catch (e) { res.json({ dates: [] }); }
  });

  // ═══ CLEAR BACKFILL DATA ═══
  router.post('/composite-score/clear', (req, res) => {
    return res.status(410).json({ ok:false, error:'composite-score sudah dipensiunkan (UI dan pemakainya dihapus)' });
    try {
      const { from, to, all } = req.body || {};
      let deleted = 0;
      if (all) {
        const info = db.prepare('DELETE FROM daily_scores').run();
        deleted = info.changes;
        try { db.prepare('DELETE FROM ic_staleness_results').run(); } catch(e) {}
      } else if (from && to) {
        const info = db.prepare('DELETE FROM daily_scores WHERE calc_date >= ? AND calc_date <= ?').run(from, to);
        deleted = info.changes;
      } else {
        return res.status(400).json({ error: 'Specify from/to range or all:true' });
      }
      res.json({ ok: true, deleted });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ IC DECAY + INFORMATION RATIO ═══
  // Computes IC at multiple horizons to show signal decay curve
  router.get('/ic-decay', (req, res) => {
    try {
      const horizons = [1, 2, 3, 5, 7, 10, 15, 20, 30];
      const limit = Math.min(parseInt(req.query.limit) || 60, 250);

      const scoreDates = db.prepare('SELECT DISTINCT calc_date FROM daily_scores ORDER BY calc_date DESC LIMIT ?').all(limit).map(r => r.calc_date);
      if (scoreDates.length < 5) return res.json({ error: 'Need at least 5 days of scores', data: [] });
      scoreDates.reverse();

      const allTradeDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
      const tdIndex = {};
      allTradeDates.forEach((d, i) => { tdIndex[d] = i; });

      // Faktor CA: `close` di daily_scores tersimpan MENTAH, jadi basis harga di
      // tanggal skor harus dikoreksi manual sebelum dibandingkan harga forward.
      const caF = loadFactors(db);

      // Spearman rank correlation
      function spearmanIC(pairs, scoreKey) {
        const n = pairs.length;
        if (n < 10) return null;
        const byScore = pairs.slice().sort((a, b) => a[scoreKey] - b[scoreKey]);
        const byRet = pairs.slice().sort((a, b) => a.ret - b.ret);
        const scoreRank = {}; byScore.forEach((r, i) => { scoreRank[r.code] = i + 1; });
        const retRank = {}; byRet.forEach((r, i) => { retRank[r.code] = i + 1; });
        let d2sum = 0;
        pairs.forEach(r => { const d = (scoreRank[r.code] || 0) - (retRank[r.code] || 0); d2sum += d * d; });
        return Math.round((1 - 6 * d2sum / (n * (n * n - 1))) * 10000) / 10000;
      }

      // For each horizon, compute IC across all scored dates
      const decayCurve = horizons.map(h => {
        const ics = { composite: [], fundamental: [], valuation: [], momentum: [], demand: [], foreign: [] };

        for (const sd of scoreDates) {
          const fwdIdx = (tdIndex[sd] || 0) + h;
          if (fwdIdx >= allTradeDates.length) continue;
          const fwdDate = allTradeDates[fwdIdx];

          const scores = db.prepare('SELECT code, score_composite, score_fundamental, score_valuation, score_momentum, score_demand, score_foreign, close FROM daily_scores WHERE calc_date=?').all(sd);
          if (scores.length < 20) continue;

          const fwdPrices = {};
          const codes = scores.map(s => s.code);
          const ph = codes.map(() => '?').join(',');
          db.prepare(`SELECT code, ca_adj(close, code, trade_date) AS ac FROM idx_daily WHERE trade_date=? AND code IN (${ph})`).all(fwdDate, ...codes)
            .forEach(r => { fwdPrices[r.code] = r.ac; });

          const pairs = [];
          scores.forEach(s => {
            const fp = fwdPrices[s.code];
            const base = s.close > 0 ? s.close * factorAt(caF[s.code], sd) : 0;
            if (!fp || !base) return;
            pairs.push({ code: s.code, ret: (fp - base) / base * 100,
              composite: s.score_composite, fundamental: s.score_fundamental,
              valuation: s.score_valuation, momentum: s.score_momentum,
              demand: s.score_demand || 0, foreign: s.score_foreign || 0 });
          });

          if (pairs.length < 15) continue;

          for (const key of Object.keys(ics)) {
            const ic = spearmanIC(pairs, key);
            if (ic !== null) ics[key].push(ic);
          }
        }

        // Compute avg IC, std IC, IR for each factor
        const result = { horizon: h };
        for (const [key, arr] of Object.entries(ics)) {
          if (arr.length < 3) {
            result[key] = { avg_ic: 0, std_ic: 0, ir: 0, n: 0 };
            continue;
          }
          const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
          const variance = arr.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / arr.length;
          const std = Math.sqrt(variance);
          const ir = std > 0 ? avg / std : 0; // Information Ratio = avg IC / std IC
          result[key] = {
            avg_ic: Math.round(avg * 10000) / 10000,
            std_ic: Math.round(std * 10000) / 10000,
            ir: Math.round(ir * 1000) / 1000,
            n: arr.length
          };
        }
        return result;
      });

      // Find optimal horizon (highest IR for composite)
      let bestHorizon = 5, bestIR = 0;
      decayCurve.forEach(d => {
        if (d.composite.ir > bestIR) { bestIR = d.composite.ir; bestHorizon = d.horizon; }
      });

      res.json({
        decay: decayCurve,
        best_horizon: bestHorizon,
        best_ir: bestIR,
        scored_dates: scoreDates.length,
        factors: ['composite', 'fundamental', 'valuation', 'momentum', 'demand', 'foreign']
      });
    } catch (e) { res.json({ error: e.message, data: [] }); }
  });

  // ═══ IC STALENESS DECAY — simulated fundamental data age vs predictiveness ═══
  // Works with continuous monthly snapshots: for each scoring date, re-computes
  // fundamental score using progressively older snapshots (0, 1, 2, 3, 6 months back)
  // and measures how IC decays as snapshot gets older.
  router.get('/ic-staleness', (req, res) => {
    try {
      const horizon = parseInt(req.query.horizon) || 5;
      const limit = Math.min(parseInt(req.query.limit) || 120, 250);

      const snapshots = getFundSnapshotMonths();
      if (snapshots.length < 3) {
        return res.json({ error: 'Need at least 3 fundamental snapshots. Currently have ' + snapshots.length + '. Upload more monthly BEI XLSX files.' });
      }

      // Get scored dates (need PIT backfill data)
      const scoredDates = db.prepare('SELECT DISTINCT calc_date FROM daily_scores WHERE fund_snapshot_month IS NOT NULL ORDER BY calc_date DESC LIMIT ?').all(limit).map(r => r.calc_date);
      if (scoredDates.length < 10) {
        return res.json({ error: 'Need at least 10 scored dates with point-in-time data (' + scoredDates.length + ' found). Run Backfill with PIT enabled.' });
      }
      scoredDates.reverse();

      const allTradeDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
      const tdIndex = {};
      allTradeDates.forEach((d, i) => { tdIndex[d] = i; });

      function spearmanIC(pairs) {
        const n = pairs.length; if (n < 10) return null;
        const byS = pairs.slice().sort((a, b) => a.s - b.s);
        const byR = pairs.slice().sort((a, b) => a.r - b.r);
        const rankS = {}, rankR = {};
        byS.forEach((p, i) => { rankS[p.code] = i + 1; });
        byR.forEach((p, i) => { rankR[p.code] = i + 1; });
        let d2 = 0;
        pairs.forEach(p => { const d = (rankS[p.code] || 0) - (rankR[p.code] || 0); d2 += d * d; });
        return Math.round((1 - 6 * d2 / (n * (n * n - 1))) * 10000) / 10000;
      }

      // Staleness offsets to test: "what if data was N months older?"
      const offsets = [0, 1, 2, 3, 6];

      // For each offset, collect IC values across all scored dates
      const offsetICs = {};
      offsets.forEach(o => { offsetICs[o] = { fund: [], val: [], comp: [], nPairs: 0 }; });

      // Cache: snapshot_month → { code → { per, pbv, roe, roa, der, npm } }
      const fundCache = {};
      function loadFundSnap(sm) {
        if (fundCache[sm]) return fundCache[sm];
        fundCache[sm] = {};
        try {
          db.prepare('SELECT code, per, pbv, roe, roa, der, npm FROM idx_fundamental WHERE snapshot_month=?').all(sm)
            .forEach(r => { fundCache[sm][r.code] = r; });
        } catch(e) {}
        return fundCache[sm];
      }

      // Industry medians per snapshot
      const indMedCache = {};
      function loadIndMedian(sm) {
        if (indMedCache[sm]) return indMedCache[sm];
        indMedCache[sm] = {};
        try {
          db.prepare('SELECT industry, AVG(per) as avg_per, AVG(pbv) as avg_pbv FROM idx_fundamental WHERE snapshot_month=? AND per>0 AND per<200 AND pbv>0 AND pbv<50 GROUP BY industry').all(sm)
            .forEach(r => { indMedCache[sm][r.industry] = r; });
        } catch(e) {}
        return indMedCache[sm];
      }

      // Re-score fundamental + valuation using a specific snapshot
      function reScoreFundVal(code, industry, snapshot) {
        const fm = loadFundSnap(snapshot);
        const fund = fm[code];
        if (!fund) return null;
        const im = loadIndMedian(snapshot);
        const indM = industry ? (im[industry] || {}) : {};
        return {
          roe: fund.roe || 0, roa: fund.roa || 0, npm: fund.npm || 0, der: fund.der || 0,
          per: fund.per || 0, pbv: fund.pbv || 0,
          per_vs_ind: fund.per > 0 && indM.avg_per > 0 ? (fund.per / indM.avg_per - 1) * 100 : 0,
          pbv_vs_ind: fund.pbv > 0 && indM.avg_pbv > 0 ? (fund.pbv / indM.avg_pbv - 1) * 100 : 0
        };
      }

      // Go month back from snapshot_month
      function monthsBack(sm, n) {
        const [y, m] = sm.split('-').map(Number);
        const d = new Date(y, m - 1 - n, 1);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      }

      for (const calcDate of scoredDates) {
        const fwdIdx = (tdIndex[calcDate] || 0) + horizon;
        if (fwdIdx >= allTradeDates.length) continue;
        const fwdDate = allTradeDates[fwdIdx];

        // Get scores + the snapshot that was used
        const scores = db.prepare('SELECT code, score_composite, score_fundamental, score_valuation, score_momentum, score_demand, score_foreign, close, fund_snapshot_month, industry FROM daily_scores WHERE calc_date=? AND fund_snapshot_month IS NOT NULL').all(calcDate);
        if (scores.length < 20) continue;

        // Forward returns
        const codes = scores.map(s => s.code);
        const ph = codes.map(() => '?').join(',');
        const fwdMap = {};
        db.prepare(`SELECT code, ca_adj(close, code, trade_date) AS ac FROM idx_daily WHERE trade_date=? AND code IN (${ph})`).all(fwdDate, ...codes)
          .forEach(r => { fwdMap[r.code] = r.ac; });

        // Build return map (basis harga di daily_scores mentah -> dikoreksi faktor CA)
        const caF = loadFactors(db);
        const retMap = {};
        scores.forEach(s => {
          const base = s.close > 0 ? s.close * factorAt(caF[s.code], calcDate) : 0;
          if (fwdMap[s.code] && base > 0) retMap[s.code] = (fwdMap[s.code] - base) / base * 100;
        });
        if (Object.keys(retMap).length < 15) continue;

        // For each staleness offset, re-score using older snapshot
        for (const offset of offsets) {
          const pairs = [];
          for (const s of scores) {
            if (retMap[s.code] == null) continue;

            if (offset === 0) {
              // Use actual scores (fresh snapshot)
              pairs.push({ code: s.code, sf: s.score_fundamental || 0, sv: s.score_valuation || 0, sc: s.score_composite || 0, r: retMap[s.code] });
            } else {
              // Re-score with older snapshot
              const olderSnap = monthsBack(s.fund_snapshot_month, offset);
              if (snapshots.indexOf(olderSnap) < 0) continue; // snapshot doesn't exist
              const fs = reScoreFundVal(s.code, s.industry, olderSnap);
              if (!fs) continue;
              // Rough fundamental score: average of rankings (can't rank without all stocks, use raw values as proxy)
              const fundProxy = Math.max(0, Math.min(100, (fs.roe > 0 ? 50 + fs.roe : 20) * 0.3 + (fs.roa > 0 ? 50 + fs.roa * 3 : 20) * 0.2 + (fs.npm > 0 ? 50 + fs.npm : 20) * 0.3 + (fs.der < 1 ? 70 : fs.der < 2 ? 50 : 20) * 0.2));
              const valProxy = Math.max(0, Math.min(100, (fs.per_vs_ind < 0 ? 60 - fs.per_vs_ind * 0.3 : 40 - fs.per_vs_ind * 0.3) * 0.5 + (fs.pbv_vs_ind < 0 ? 60 - fs.pbv_vs_ind * 0.3 : 40 - fs.pbv_vs_ind * 0.3) * 0.5));
              // Keep momentum/demand/foreign from original (they're price-based, not affected by fundamental staleness)
              const compProxy = (fundProxy * 0.25 + valProxy * 0.20 + (s.score_momentum || 50) * 0.20 + (s.score_demand || 50) * 0.20 + (s.score_foreign || 50) * 0.15);
              pairs.push({ code: s.code, sf: fundProxy, sv: valProxy, sc: compProxy, r: retMap[s.code] });
            }
          }

          if (pairs.length >= 15) {
            const icF = spearmanIC(pairs.map(p => ({ code: p.code, s: p.sf, r: p.r })));
            const icV = spearmanIC(pairs.map(p => ({ code: p.code, s: p.sv, r: p.r })));
            const icC = spearmanIC(pairs.map(p => ({ code: p.code, s: p.sc, r: p.r })));
            if (icF != null) offsetICs[offset].fund.push(icF);
            if (icV != null) offsetICs[offset].val.push(icV);
            if (icC != null) offsetICs[offset].comp.push(icC);
            offsetICs[offset].nPairs += pairs.length;
          }
        }
      }

      // Compute average IC per offset
      const buckets = [];
      const labels = { 0: 'Fresh (0mo)', 1: '1 month old', 2: '2 months old', 3: '3 months old', 6: '6 months old' };
      offsets.forEach(o => {
        const d = offsetICs[o];
        if (d.fund.length < 3) return;
        const avgF = d.fund.reduce((a, v) => a + v, 0) / d.fund.length;
        const avgV = d.val.reduce((a, v) => a + v, 0) / d.val.length;
        const avgC = d.comp.reduce((a, v) => a + v, 0) / d.comp.length;
        const stdC = d.comp.length >= 2 ? Math.sqrt(d.comp.reduce((a, v) => a + (v - avgC) * (v - avgC), 0) / (d.comp.length - 1)) : 0;
        const ir = stdC > 0 ? avgC / stdC : 0;
        // Hit rate from composite
        const hitRate = d.comp.filter(ic => ic > 0).length / d.comp.length * 100;
        buckets.push({
          key: String(o), label: labels[o] || o + ' mo old', n: d.nPairs, dates: d.fund.length,
          ic_fundamental: Math.round(avgF * 10000) / 10000,
          ic_valuation: Math.round(avgV * 10000) / 10000,
          ic_composite: Math.round(avgC * 10000) / 10000,
          std_ic: Math.round(stdC * 10000) / 10000,
          ir: Math.round(ir * 1000) / 1000,
          hit_rate: Math.round(hitRate * 10) / 10
        });
      });

      if (buckets.length < 2) {
        return res.json({ error: 'Could not compute staleness for enough offsets. Need snapshots going back at least 2 months from your scored dates. You have ' + snapshots.length + ' snapshots: ' + snapshots[0] + ' to ' + snapshots[snapshots.length - 1] });
      }

      // Summary
      const freshB = buckets[0];
      const freshIC = freshB ? freshB.ic_fundamental : 0;
      const staleB = buckets.length >= 3 ? buckets[buckets.length - 1] : buckets[1];
      const staleIC = staleB ? staleB.ic_fundamental : 0;
      const icDropPct = freshIC > 0 ? Math.round((freshIC - staleIC) / Math.abs(freshIC) * 1000) / 10 : 0;
      let recommendedMaxAge = 6;
      for (const b of buckets) {
        const o = parseInt(b.key);
        if (o > 0 && freshIC > 0 && b.ic_fundamental < freshIC * 0.5) { recommendedMaxAge = o; break; }
      }

      const discountSchedule = buckets.map(b => ({
        label: b.label,
        multiplier: freshIC > 0 ? Math.round(Math.max(0, Math.min(1, b.ic_fundamental / freshIC)) * 100) / 100 : 1
      }));

      // Cache results
      try {
        const ins = db.prepare('INSERT OR REPLACE INTO ic_staleness_results(horizon,age_bucket,age_label,n_samples,ic_fundamental,ic_valuation,ic_composite,std_ic,ir,hit_rate) VALUES(?,?,?,?,?,?,?,?,?,?)');
        db.transaction(() => {
          db.prepare('DELETE FROM ic_staleness_results WHERE horizon=?').run(horizon);
          buckets.forEach(b => { ins.run(horizon, b.key, b.label, b.n, b.ic_fundamental, b.ic_valuation, b.ic_composite, b.std_ic, b.ir, b.hit_rate); });
        })();
      } catch (e) { console.error('Staleness cache error:', e.message); }

      res.json({
        horizon, snapshot_count: snapshots.length, scored_dates: scoredDates.length,
        buckets,
        summary: { fresh_ic: freshIC, stale_ic: Math.round(staleIC * 10000) / 10000, ic_drop_pct: icDropPct, recommended_max_age: recommendedMaxAge },
        discount_schedule: discountSchedule
      });
    } catch (e) { console.error('IC Staleness error:', e); res.json({ error: e.message }); }
  });

  // ═══ IC BY FUNDAMENTAL SOURCE — idx_fundamental vs financial_ratios (own TTM) ═══
  // READ-ONLY study. It never writes: daily_scores is UNIQUE(calc_date, code), so a
  // ratio-sourced backfill would overwrite the idx_fundamental-sourced rows instead of
  // sitting next to them. Comparing in memory is the only way to see both at once.
  //
  // Method (each choice is load-bearing):
  //  • Universe = the gate the scorer itself uses — close > 0, listed_shares > 0,
  //    close*listed_shares >= 50e9, average 20-session frequency >= 10 — rebuilt from
  //    idx_daily, NOT taken from daily_scores. daily_scores keeps only the top 100 by
  //    composite, and composite CONTAINS the fundamental score, so using it would truncate
  //    the sample on the variable under test.
  //  • Both sources are scored by the SAME function on the SAME names for each date
  //    (percentile ranks, 0.3 roe / 0.2 roa / 0.3 npm / 0.2 der inverted — literally the
  //    production score_fundamental weights). No source gets a different universe or formula.
  //  • IC = Spearman rank correlation of score vs forward return over `horizon` sessions.
  //  • naive      = mean IC per staleness offset, pooled across dates.
  //  • controlled = the same offsets compared WITHIN each score date (paired on the same
  //    names), then averaged. With quarterly snapshots "older" also means "a different
  //    quarter/market regime"; pairing per date is what removes that.
  //  • availability follows each source's own rule. financial_ratios:
  //    quarter_end + lag_days (never the quarter end itself — that is look-ahead).
  //    idx_fundamental: its publication month, because it has no fiscal date at all
  //    (`fs_date` is '' on every row) — the two rules are NOT the same and the freshness
  //    they yield is reported per date.
  //  • a per-offset sample requires the codes to exist at offset 0 AND offset k, so the
  //    staleness curve is always anchored on one fixed sample per date; the offset-0 IC is
  //    recomputed on that same sample. Otherwise the curve would measure sample changes.
  router.get('/ic-fund-source', (req, res) => {
    try {
      const horizon = Math.max(1, Math.min(60, parseInt(req.query.horizon) || 5));
      const lagDays = Number.isFinite(parseFloat(req.query.lag_days)) ? parseFloat(req.query.lag_days) : RATIO_LAG_DAYS_DEFAULT;
      const offsets = [...new Set(String(req.query.offsets || '0,1,2,3').split(',').map(s => parseInt(s.trim())).filter(n => Number.isFinite(n) && n >= 0 && n <= 8))].sort((a, b) => a - b);
      if (!offsets.length) offsets.push(0);

      const allDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
      if (allDates.length < horizon + 2) return res.json({ error: 'Not enough trade dates in idx_daily' });
      const tdIndex = {}; allDates.forEach((d, i) => { tdIndex[d] = i; });
      const lastDate = allDates[allDates.length - 1];
      const to = req.query.to || lastDate;
      const from = req.query.from || isoAddDays(to, -120);

      const usable = allDates.filter(d => d >= from && d <= to && (tdIndex[d] + horizon) < allDates.length);
      const maxDates = Math.min(parseInt(req.query.max_dates) || 120, 400);
      const scoreDates = usable.slice(-maxDates);
      if (!scoreDates.length) return res.json({ error: 'No score date with a forward observation between ' + from + ' and ' + to });

      // ── snapshot dictionaries ──
      const series = loadRatioSeries();
      const monthsA = db.prepare('SELECT DISTINCT snapshot_month FROM idx_fundamental ORDER BY snapshot_month').all().map(r => r.snapshot_month);
      const calendar = [];
      series.quarters.forEach((q, qi) => {
        if (qi < 3) return;
        let complete = 0, withRow = 0;
        series.codes.forEach(code => {
          if (series.byCode[code][q]) withRow++;
          if (ratioTTMBlock(series, code, q)) complete++;
        });
        calendar.push({
          quarter_end: q, available_from: isoAddDays(q, lagDays),
          codes_with_row: withRow, codes_ttm_complete: complete, codes_excluded: series.codes.length - complete
        });
      });

      // ── preload prices once ──
      // ac = harga terkoreksi CA (untuk return / PBV-PER point-in-time), close mentah
      // tetap dipakai untuk gerbang market cap (harga x lembar pada hari itu).
      const priceRows = db.prepare('SELECT code, trade_date, close, listed_shares, frequency, ca_adj(close, code, trade_date) AS ac FROM idx_daily WHERE trade_date>=? AND trade_date<=? ORDER BY code, trade_date')
        .all(isoAddDays(from, -60), isoAddDays(to, 30));
      const pxByCode = {};
      priceRows.forEach(r => { (pxByCode[r.code] = pxByCode[r.code] || []).push(r); });
      const fwdCloseCache = {};
      const closesOn = d => {
        if (!fwdCloseCache[d]) { const m = {}; db.prepare('SELECT code, ca_adj(close, code, trade_date) AS ac FROM idx_daily WHERE trade_date=?').all(d).forEach(r => { m[r.code] = r.ac; }); fwdCloseCache[d] = m; }
        return fwdCloseCache[d];
      };
      function universeAt(d) {
        const out = [];
        Object.keys(pxByCode).forEach(code => {
          const s = pxByCode[code];
          const i = s.findIndex(r => r.trade_date === d);
          if (i < 0) return;
          const r = s[i];
          if (!(r.close > 0) || !(r.listed_shares > 0)) return;
          if (r.close * r.listed_shares < 50e9) return;
          const recent = s.slice(Math.max(0, i - 20), i);
          if (!recent.length) return;
          if (recent.reduce((a, x) => a + (x.frequency || 0), 0) / recent.length < 10) return;
          out.push({ code, close: r.close, ac: r.ac });
        });
        return out;
      }

      // ── scoring primitives, copied verbatim from the production scorer ──
      function rankPct(arr, key, higherIsBetter) {
        const valid = arr.filter(r => r[key] !== 0 && !isNaN(r[key]));
        const sorted = valid.slice().sort((a, b) => higherIsBetter ? a[key] - b[key] : b[key] - a[key]);
        const rm = {}; sorted.forEach((r, i) => { rm[r.code] = Math.round(i / (sorted.length - 1 || 1) * 100); });
        arr.forEach(r => { r['_r_' + key] = rm[r.code] || 50; });
      }
      function spearman(pairs) {
        const n = pairs.length; if (n < 10) return null;
        const byA = pairs.slice().sort((a, b) => a.s - b.s);
        const byB = pairs.slice().sort((a, b) => a.r - b.r);
        const ra = {}, rb = {};
        byA.forEach((p, i) => { ra[p.code] = i + 1; });
        byB.forEach((p, i) => { rb[p.code] = i + 1; });
        let d2 = 0; pairs.forEach(p => { const d = (ra[p.code] || 0) - (rb[p.code] || 0); d2 += d * d; });
        return Math.round((1 - 6 * d2 / (n * (n * n - 1))) * 10000) / 10000;
      }

      // ── per-snapshot loaders ──
      const fundAcache = {};
      function fundAMap(month) {
        if (month in fundAcache) return fundAcache[month];
        const m = {};
        try { db.prepare('SELECT code, roe, roa, npm, der, per, pbv, industry FROM idx_fundamental WHERE snapshot_month=?').all(month).forEach(r => { m[r.code] = r; }); } catch (e) {}
        fundAcache[month] = m; return m;
      }
      const indAcache = {};
      function indAMap(month) {
        if (month in indAcache) return indAcache[month];
        const m = {};
        try { db.prepare('SELECT industry, AVG(per) avg_per, AVG(pbv) avg_pbv FROM idx_fundamental WHERE snapshot_month=? AND per>0 AND per<200 AND pbv>0 AND pbv<50 GROUP BY industry').all(month).forEach(r => { m[r.industry] = r; }); } catch (e) {}
        indAcache[month] = m; return m;
      }
      const indRcache = {};
      function indRMap(quarter) {
        if (quarter in indRcache) return indRcache[quarter];
        const m = {};
        try { db.prepare('SELECT industry, AVG(per) avg_per, AVG(pbv) avg_pbv FROM financial_ratios WHERE period=? AND per>0 AND per<200 AND pbv>0 AND pbv<50 GROUP BY industry').all(quarter).forEach(r => { m[r.industry] = r; }); } catch (e) {}
        indRcache[quarter] = m; return m;
      }
      // freshest legal snapshot per source at a score date, then k snapshots further back
      function snapA(d, offset) {
        const sm = d.substring(0, 7);
        let idx = -1;
        for (let i = monthsA.length - 1; i >= 0; i--) { if (monthsA[i] <= sm) { idx = i; break; } }
        if (idx < 0) return null;
        return monthsA[idx - offset] || null;
      }
      function snapB(d, offset) {
        const q = ratioPITSnapshot(series, d, lagDays);
        if (!q) return null;
        const qi = series.quarters.indexOf(q);
        return qi - offset >= 0 ? series.quarters[qi - offset] : null;
      }

      const AGE_BUCKETS = [[0, 91, '0-3mo'], [91, 183, '3-6mo'], [183, 274, '6-9mo'], [274, 366, '9-12mo'], [366, 99999, '12mo+']];
      const ageBucketOf = days => (AGE_BUCKETS.find(b => days >= b[0] && days < b[1]) || [0, 0, '?'])[2];
      const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

      const perDate = [];
      const ageHist = {};
      const naive = {};   // source → offset → [ic...]
      const anchor = {};  // source → offset → [offset0 ic on that sample]
      const paired = {};  // source → offset → [icK - ic0]
      const sideBySide = { A: [], B: [] }; // offset-0 IC per date, matched sample
      ['A', 'B'].forEach(s => {
        naive[s] = {}; anchor[s] = {}; paired[s] = {};
        offsets.forEach(o => { naive[s][o] = []; anchor[s][o] = []; paired[s][o] = []; });
      });
      const valIcs = { A_stored: [], B_stored: [], B_pit: [] };

      for (const d of scoreDates) {
        const fwdDate = allDates[tdIndex[d] + horizon];
        const uni = universeAt(d);
        if (uni.length < 30) continue;
        const fwd = closesOn(fwdDate);
        const snapA0 = snapA(d, 0), snapB0 = snapB(d, 0);
        if (!snapA0 || !snapB0) continue;
        const A0 = fundAMap(snapA0), B0 = ratioFactorMap(snapB0);
        // base sample: gate universe ∩ forward price ∩ present in both sources at offset 0
        const base = uni.filter(u => {
          const fc = fwd[u.code];
          return fc > 0 && u.ac > 0 && A0[u.code] && B0[u.code];
        });
        if (base.length < 30) continue;
        const ret = {};
        base.forEach(u => { ret[u.code] = (fwd[u.code] - u.ac) / u.ac * 100; });

        // offset-0 fundamental scores, by source, on the base sample
        const rowsA0 = base.map(u => { const f = A0[u.code]; return { code: u.code, roe: f.roe || 0, roa: f.roa || 0, npm: f.npm || 0, der: f.der || 0, per: f.per || 0, pbv: f.pbv || 0, industry: f.industry || '' }; });
        const rowsB0 = base.map(u => { const f = B0[u.code]; return { code: u.code, roe: f.roe || 0, roa: f.roa || 0, npm: f.npm || 0, der: f.der || 0, per: f.per || 0, pbv: f.pbv || 0, industry: f.industry || '', book_value: f.book_value || 0, eps_ttm: f.eps_ttm || 0, close: u.ac }; });
        const fundScoreOn = arr => {
          rankPct(arr, 'roe', true); rankPct(arr, 'roa', true); rankPct(arr, 'npm', true); rankPct(arr, 'der', false);
          arr.forEach(r => { r.sf = Math.round((r._r_roe * 0.3 + r._r_roa * 0.2 + r._r_npm * 0.3 + r._r_der * 0.2) * 10) / 10; });
        };
        fundScoreOn(rowsA0); fundScoreOn(rowsB0);
        const sfA0 = {}, sfB0 = {};
        rowsA0.forEach(r => { sfA0[r.code] = r.sf; });
        rowsB0.forEach(r => { sfB0[r.code] = r.sf; });
        const icA0 = spearman(base.map(u => ({ code: u.code, s: sfA0[u.code], r: ret[u.code] })));
        const icB0 = spearman(base.map(u => ({ code: u.code, s: sfB0[u.code], r: ret[u.code] })));
        if (icA0 != null) sideBySide.A.push(icA0);
        if (icB0 != null) sideBySide.B.push(icB0);

        // valuation, offset 0 — industry-median-relative; div_yield deliberately excluded
        const indA = indAMap(snapA0), indB = indRMap(snapB0);
        const rowsAV = rowsA0.map(r => { const m = indA[r.industry] || {}; return Object.assign({}, r, { per_vs_ind: (r.per > 0 && m.avg_per > 0) ? (r.per / m.avg_per - 1) * 100 : 0, pbv_vs_ind: (r.pbv > 0 && m.avg_pbv > 0) ? (r.pbv / m.avg_pbv - 1) * 100 : 0 }); });
        const rowsBV = rowsB0.map(r => { const m = indB[r.industry] || {}; return Object.assign({}, r, { per_vs_ind: (r.per > 0 && m.avg_per > 0) ? (r.per / m.avg_per - 1) * 100 : 0, pbv_vs_ind: (r.pbv > 0 && m.avg_pbv > 0) ? (r.pbv / m.avg_pbv - 1) * 100 : 0 }); });
        const valScoreOn = arr => { rankPct(arr, 'per_vs_ind', false); rankPct(arr, 'pbv_vs_ind', false); arr.forEach(r => { r.sv = Math.round((r._r_per_vs_ind * 0.5 + r._r_pbv_vs_ind * 0.5) * 10) / 10; }); };
        valScoreOn(rowsAV); valScoreOn(rowsBV);
        const vA = {}, vB = {};
        rowsAV.forEach(r => { vA[r.code] = r.sv; }); rowsBV.forEach(r => { vB[r.code] = r.sv; });
        const icVA = spearman(base.map(u => ({ code: u.code, s: vA[u.code], r: ret[u.code] })));
        const icVB = spearman(base.map(u => ({ code: u.code, s: vB[u.code], r: ret[u.code] })));
        if (icVA != null) valIcs.A_stored.push(icVA);
        if (icVB != null) valIcs.B_stored.push(icVB);
        // PIT-price valuation from the ratio source: pbv = close/book_value, per = close/eps_ttm
        const rowsBP = rowsB0.filter(r => r.book_value > 0 && r.eps_ttm > 0).map(r => ({ code: r.code, pbv: r.close / r.book_value, per: r.close / r.eps_ttm }));
        let icVBP = null;
        if (rowsBP.length >= 30) { rankPct(rowsBP, 'pbv', false); rankPct(rowsBP, 'per', false); const vp = {}; rowsBP.forEach(r => { vp[r.code] = Math.round((r._r_pbv * 0.5 + r._r_per * 0.5) * 10) / 10; }); icVBP = spearman(rowsBP.map(r => ({ code: r.code, s: vp[r.code], r: ret[r.code] }))); }
        if (icVBP != null) valIcs.B_pit.push(icVBP);

        // ── staleness sweep, anchored per date and per offset ──
        const offRows = {};
        for (const k of offsets) {
          if (k === 0) { offRows[0] = { n: base.length, icA: icA0, icB: icB0 }; continue; }
          const sA = snapA(d, k), sB = snapB(d, k);
          if (!sA && !sB) continue;
          const Ak = sA ? fundAMap(sA) : null, Bk = sB ? ratioFactorMap(sB) : null;
          // a source that has no snapshot this far back is skipped, not silently zero-filled
          const sub = base.filter(u => (!Ak || Ak[u.code]) && (!Bk || Bk[u.code]));
          if (sub.length < 30) continue;
          let icAk = null, icBk = null, icA0s = null, icB0s = null;
          if (Ak) {
            const rA = sub.map(u => { const f = Ak[u.code]; return { code: u.code, roe: (f.roe || 0), roa: (f.roa || 0), npm: (f.npm || 0), der: (f.der || 0) }; });
            const rA0 = sub.map(u => { const f = A0[u.code]; return { code: u.code, roe: (f.roe || 0), roa: (f.roa || 0), npm: (f.npm || 0), der: (f.der || 0) }; });
            fundScoreOn(rA); fundScoreOn(rA0);
            const fsA = {}, a0 = {};
            rA.forEach(r => { fsA[r.code] = r.sf; }); rA0.forEach(r => { a0[r.code] = r.sf; });
            icAk = spearman(sub.map(u => ({ code: u.code, s: fsA[u.code], r: ret[u.code] })));
            icA0s = spearman(sub.map(u => ({ code: u.code, s: a0[u.code], r: ret[u.code] })));
          }
          if (Bk) {
            const rB = sub.map(u => { const f = Bk[u.code]; return { code: u.code, roe: (f.roe || 0), roa: (f.roa || 0), npm: (f.npm || 0), der: (f.der || 0) }; });
            const rB0 = sub.map(u => { const f = B0[u.code]; return { code: u.code, roe: (f.roe || 0), roa: (f.roa || 0), npm: (f.npm || 0), der: (f.der || 0) }; });
            fundScoreOn(rB); fundScoreOn(rB0);
            const fsB = {}, b0 = {};
            rB.forEach(r => { fsB[r.code] = r.sf; }); rB0.forEach(r => { b0[r.code] = r.sf; });
            icBk = spearman(sub.map(u => ({ code: u.code, s: fsB[u.code], r: ret[u.code] })));
            icB0s = spearman(sub.map(u => ({ code: u.code, s: b0[u.code], r: ret[u.code] })));
          }
          offRows[k] = { n: sub.length, snapA: sA, snapB: sB, icA: icAk, icB: icBk, icA0_same_sample: icA0s, icB0_same_sample: icB0s };
          if (icAk != null && icA0s != null) { naive.A[k].push(icAk); anchor.A[k].push(icA0s); paired.A[k].push(icAk - icA0s); }
          if (icBk != null && icB0s != null) { naive.B[k].push(icBk); anchor.B[k].push(icB0s); paired.B[k].push(icBk - icB0s); }
        }
        if (icA0 != null) { naive.A[0].push(icA0); }
        if (icB0 != null) { naive.B[0].push(icB0); }

        const ageA = daysBetween(snapA0 + '-01', d);
        const ageB = daysBetween(snapB0, d);
        const ab = ageBucketOf(ageB);
        ageHist[ab] = (ageHist[ab] || 0) + 1;
        perDate.push({
          calc_date: d, fwd_date: fwdDate, universe: uni.length, sample: base.length,
          snap_idx_fundamental: snapA0, age_days_idx_fundamental: ageA,
          snap_ratio: snapB0, age_days_ratio: ageB, age_bucket_ratio: ab,
          ic_fundamental_idx_fundamental: icA0, ic_fundamental_ratio_ttm: icB0,
          ic_val_idx_fundamental: icVA, ic_val_ratio_stored: icVB, ic_val_ratio_pit_price: icVBP,
          offsets: offRows
        });
      }

      if (perDate.length < 2) return res.json({ error: 'Only ' + perDate.length + ' usable score dates — nothing to compare yet', from: from, to: to });

      const mean = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10000) / 10000 : null;
      const sd = a => a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - a.reduce((p, q) => p + q, 0) / a.length) ** 2, 0) / (a.length - 1)) : 0;
      const stat = a => {
        if (!a.length) return { n_dates: 0 };
        const m = a.reduce((x, y) => x + y, 0) / a.length, s = sd(a);
        return {
          n_dates: a.length, mean: Math.round(m * 10000) / 10000,
          sd: Math.round(s * 10000) / 10000,
          t: s > 0 ? Math.round(m / (s / Math.sqrt(a.length)) * 100) / 100 : null,
          win_rate: Math.round(a.filter(v => v > 0).length / a.length * 1000) / 10
        };
      };
      const sweep = {};
      ['A', 'B'].forEach(s => {
        sweep[s === 'A' ? 'idx_fundamental' : 'ratio_ttm'] = offsets.map(k => ({
          offset_snapshots_back: k,
          label: k === 0 ? 'freshest legally available snapshot' : k + ' snapshot(s) older',
          naive_ic_at_offset: mean(naive[s][k]),
          n_dates_naive: naive[s][k].length,
          anchor_ic_offset0_same_sample: k === 0 ? mean(naive[s][0]) : mean(anchor[s][k]),
          controlled_paired_delta: k === 0 ? null : mean(paired[s][k]),
          controlled: k === 0 ? null : stat(paired[s][k])
        }));
      });

      // Optional per-code audit of the TTM normalisation, so nobody has to trust the code path.
      let debugCode = null;
      if (req.query.code) {
        const code = String(req.query.code).toUpperCase();
        const asOf = req.query.as_of || to;
        const snap = ratioPITSnapshot(series, asOf, lagDays);
        if (snap) {
          const qi = series.quarters.indexOf(snap);
          const win = [series.quarters[qi - 3], series.quarters[qi - 2], series.quarters[qi - 1], snap];
          const quarters = win.map((q, i) => {
            const row = series.byCode[code] ? series.byCode[code][q] : null;
            const sq = ratioSingleQuarter(series, code, q, qi - 3 + i);
            const head = i === 0 ? series.quarters[qi - 4] : win[i - 1];
            const hrow = (head && series.byCode[code]) ? series.byCode[code][head] : null;
            return {
              period: q, has_row: !!row,
              ytd_sales: row ? _ratioNum(row.sales) : null, ytd_profit: row ? _ratioNum(row.profit) : null,
              decumulation_base: q.substring(5, 7) === '03' ? 'Q1 (YTD as-is)' : (head + ' YTD'),
              base_sales: hrow ? _ratioNum(hrow.sales) : null, base_profit: hrow ? _ratioNum(hrow.profit) : null,
              single_sales: sq ? sq.sales : null, single_profit: sq ? sq.profit : null
            };
          });
          const t = ratioTTMBlock(series, code, snap);
          debugCode = {
            code, as_of: asOf, lag_days: lagDays, snapshot_used: snap, available_from: isoAddDays(snap, lagDays),
            window: win, quarters,
            ttm_sales: t ? t.ttm_sales : null, ttm_profit: t ? t.ttm_profit : null,
            engine_profit_ttm: t ? t.ttm_profit : null, engine_sales_ttm: t ? t.ttm_sales : null,
            equity_at_snapshot: t ? t.equity : null, assets_at_snapshot: t ? t.assets : null,
            roe_ttm_pct: t && t.equity > 0 ? Math.round(t.ttm_profit / t.equity * 10000) / 100 : null,
            roa_ttm_pct: t && t.assets > 0 ? Math.round(t.ttm_profit / t.assets * 10000) / 100 : null,
            npm_ttm_pct: t && t.ttm_sales > 0 ? Math.round(t.ttm_profit / t.ttm_sales * 10000) / 100 : null,
            der_stored: t ? t.der : null,
            excluded: !t, excluded_reason: t ? null : 'incomplete 4-quarter window — code is dropped, not approximated',
            stored_columns_not_used: (() => { try { const r = db.prepare('SELECT roe, roa, npm, per, pbv FROM financial_ratios WHERE code=? AND period=?').get(code, snap); return r ? { note: 'upstream quarter-annualised, deliberately NOT used', stored_roe: r.roe, stored_roa: r.roa, stored_npm: r.npm, stored_per: r.per, stored_pbv: r.pbv } : null; } catch (e) { return null; } })()
          };
        }
      }

      res.json({
        ok: true,
        method: {
          horizon_sessions: horizon, lag_days_ratio: lagDays, offsets,
          date_range: [scoreDates[0], scoreDates[scoreDates.length - 1]],
          universe: 'gate: close>0 & listed_shares>0 & close*listed_shares>=50e9 & avg20d frequency>=10 (rebuilt from idx_daily, not read from daily_scores)',
          scoring: 'production score_fundamental weights 0.3 roe / 0.2 roa / 0.3 npm / 0.2 der(inverted); percentile ranks; zero treated as missing -> rank 50',
          valuation: 'per_vs_ind & pbv_vs_ind vs source snapshot industry mean, 0.5/0.5; div_yield EXCLUDED here (identical input to both sources)',
          availability_idx_fundamental: 'publication month (snapshot_month); table has no fiscal date (fs_date is empty on every row)',
          availability_ratio: 'quarter_end + ' + lagDays + ' days',
          this_route_writes: 'nothing'
        },
        snapshot_dictionary: {
          idx_fundamental_months: monthsA.map(m => ({ snapshot_month: m, codes: Object.keys(fundAMap(m)).length })),
          financial_ratios_calendar: calendar
        },
        ttm_window_check: {
          note: 'a code is excluded, never approximated, when any of the 4 consecutive quarters is missing',
          latest_window: calendar.length ? calendar[calendar.length - 1] : null,
          codes_total_in_table_for_ratio_source: series.codes.length
        },
        age_distribution_over_score_dates: {
          basis: 'days between the ratio snapshot quarter end and the score date, realisable dates only (no simulation)',
          buckets: Object.keys(ageHist).sort().map(k => ({ bucket: k, dates: ageHist[k] })),
          score_dates_measured: perDate.length
        },
        ic_side_by_side_offset0: {
          note: 'both sources scored by the same function on the same names, same date, freshest legally available snapshot each',
          ic_fundamental_idx_fundamental: stat(sideBySide.A),
          ic_fundamental_ratio_ttm: stat(sideBySide.B),
          paired_delta_ratio_minus_idxfund: stat(sideBySide.B.map((v, i) => (sideBySide.A[i] == null ? null : v - sideBySide.A[i])).filter(v => v != null)),
          ic_val_idx_fundamental: stat(valIcs.A_stored),
          ic_val_ratio_stored_price: stat(valIcs.B_stored),
          ic_val_ratio_pit_price: stat(valIcs.B_pit)
        },
        ic_staleness_naive_vs_controlled: sweep,
        debug_code: debugCode,
        per_date: perDate,
        limitations: [
          'Window is short: ' + perDate.length + ' score dates inside ' + scoreDates[0] + '..' + scoreDates[scoreDates.length - 1] + ', one market regime, overlapping ' + horizon + '-session forward windows — the paired t-stats are optimistic, treat them as descriptive.',
          'The gate (close*listed_shares) only exists for the last ~51 sessions (idx_daily.listed_shares comes from stock_summary); earlier dates produce an empty universe, so this study cannot reach back to the 2021-2025 snapshots that financial_ratios does contain.',
          'idx_fundamental has only ' + monthsA.length + ' snapshots (' + monthsA.join(', ') + '), so its staleness sweep has at most ' + (monthsA.length - 1) + ' usable offsets.',
          'Realised staleness across the score dates is only ' + Object.keys(ageHist).sort().join('/') + '; the deeper offsets in the sweep are SIMULATED (older snapshot shown to a date that did not have it).',
          'financial_ratios contains out-of-calendar dates (46 rows) that are ignored by the quarter-end filter, and 191 distinct period dates of which only 39 are quarter ends.'
        ]
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ OPTIMIZE WEIGHTS — Grid Search ═══
  // Exhaustive search over all weight combinations (step=5, sum=100)
  // For each combo, compute weighted composite score → Spearman IC vs forward return → IR
  router.get('/optimize-weights', (req, res) => {
    try {
      const horizon = parseInt(req.query.horizon) || 5;
      const step = parseInt(req.query.step) || 5;
      const limit = Math.min(parseInt(req.query.limit) || 60, 250);

      // Get scored dates
      const scoreDates = db.prepare('SELECT DISTINCT calc_date FROM daily_scores ORDER BY calc_date DESC LIMIT ?').all(limit).map(r => r.calc_date);
      if (scoreDates.length < 5) return res.json({ error: 'Need at least 5 scored dates. Run Backfill first.' });
      scoreDates.reverse();

      // Trade date index for forward lookup
      const allTradeDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
      const tdIndex = {};
      allTradeDates.forEach((d, i) => { tdIndex[d] = i; });

      // Faktor CA (harga di daily_scores mentah) — dipakai untuk mengoreksi basis
      // harga di tanggal skor sebelum menghitung return forward.
      const caF = loadFactors(db);

      // Pre-load all score data + forward returns per date
      const dateData = []; // [{scores: [{code, fund, val, mom, dem, for, fwdRet}], ...}]
      for (const sd of scoreDates) {
        const fwdIdx = (tdIndex[sd] || 0) + horizon;
        if (fwdIdx >= allTradeDates.length) continue;
        const fwdDate = allTradeDates[fwdIdx];

        const scores = db.prepare('SELECT code, score_fundamental, score_valuation, score_momentum, score_demand, score_foreign, close FROM daily_scores WHERE calc_date=?').all(sd);
        if (scores.length < 20) continue;

        const fwdPrices = {};
        const codes = scores.map(s => s.code);
        const ph = codes.map(() => '?').join(',');
        db.prepare(`SELECT code, ca_adj(close, code, trade_date) AS ac FROM idx_daily WHERE trade_date=? AND code IN (${ph})`).all(fwdDate, ...codes)
          .forEach(r => { fwdPrices[r.code] = r.ac; });

        const pairs = [];
        for (const s of scores) {
          const fp = fwdPrices[s.code];
          // basis di daily_scores mentah -> koreksi faktor CA sebelum dibanding forward
          const base = s.close > 0 ? s.close * factorAt(caF[s.code], sd) : 0;
          if (!fp || !base) continue;
          pairs.push({
            code: s.code,
            f: s.score_fundamental || 0,
            v: s.score_valuation || 0,
            m: s.score_momentum || 0,
            d: s.score_demand || 0,
            r: s.score_foreign || 0,
            ret: (fp - base) / base * 100
          });
        }
        if (pairs.length >= 15) dateData.push(pairs);
      }

      if (dateData.length < 3) return res.json({ error: 'Not enough valid date data (' + dateData.length + '). Need 3+ dates with forward returns.' });

      // Spearman IC helper
      function spearmanIC(pairs, compositeScores) {
        const n = pairs.length;
        const indexed = pairs.map((p, i) => ({ i, score: compositeScores[i], ret: p.ret }));
        const byScore = indexed.slice().sort((a, b) => a.score - b.score);
        const byRet = indexed.slice().sort((a, b) => a.ret - b.ret);
        const scoreRank = new Array(n);
        const retRank = new Array(n);
        byScore.forEach((r, rank) => { scoreRank[r.i] = rank + 1; });
        byRet.forEach((r, rank) => { retRank[r.i] = rank + 1; });
        let d2sum = 0;
        for (let i = 0; i < n; i++) { const dd = scoreRank[i] - retRank[i]; d2sum += dd * dd; }
        return 1 - 6 * d2sum / (n * (n * n - 1));
      }

      // Generate all weight combinations (step%, sum=100%)
      const combos = [];
      for (let wF = 0; wF <= 100; wF += step) {
        for (let wV = 0; wV <= 100 - wF; wV += step) {
          for (let wM = 0; wM <= 100 - wF - wV; wM += step) {
            for (let wD = 0; wD <= 100 - wF - wV - wM; wD += step) {
              const wR = 100 - wF - wV - wM - wD;
              combos.push([wF, wV, wM, wD, wR]);
            }
          }
        }
      }

      // Evaluate each combo
      let bestCombo = [20, 20, 20, 20, 20], bestIR = -999, bestAvgIC = 0;
      const topResults = [];

      for (const [wF, wV, wM, wD, wR] of combos) {
        const ics = [];
        for (const pairs of dateData) {
          const composites = pairs.map(p => p.f * wF + p.v * wV + p.m * wM + p.d * wD + p.r * wR);
          const ic = spearmanIC(pairs, composites);
          if (!isNaN(ic)) ics.push(ic);
        }
        if (ics.length < 3) continue;
        const avg = ics.reduce((s, v) => s + v, 0) / ics.length;
        const variance = ics.reduce((s, v) => s + (v - avg) ** 2, 0) / ics.length;
        const std = Math.sqrt(variance);
        const ir = std > 0 ? avg / std : 0;

        if (ir > bestIR) {
          bestIR = ir;
          bestCombo = [wF, wV, wM, wD, wR];
          bestAvgIC = avg;
        }
        topResults.push({ w: [wF, wV, wM, wD, wR], ir: Math.round(ir * 1000) / 1000, ic: Math.round(avg * 10000) / 10000 });
      }

      // Sort top results and return top 10
      topResults.sort((a, b) => b.ir - a.ir);

      res.json({
        best: {
          fundamental: bestCombo[0], valuation: bestCombo[1], momentum: bestCombo[2],
          demand: bestCombo[3], foreign: bestCombo[4],
          ir: Math.round(bestIR * 1000) / 1000,
          avg_ic: Math.round(bestAvgIC * 10000) / 10000
        },
        horizon,
        step,
        combos_tested: combos.length,
        dates_used: dateData.length,
        top10: topResults.slice(0, 10).map(r => ({
          fundamental: r.w[0], valuation: r.w[1], momentum: r.w[2], demand: r.w[3], foreign: r.w[4],
          ir: r.ir, avg_ic: r.ic
        }))
      });
    } catch (e) { res.json({ error: e.message }); }
  });

  // ═══ INDEX SUMMARY (BEI Index Data) ═══
  // Index summary stats
  router.get('/indices/stats', (req, res) => {
    try {
      const total = db.prepare('SELECT COUNT(*)as c FROM idx_indices').get().c;
      const indices = db.prepare('SELECT COUNT(DISTINCT index_code)as c FROM idx_indices').get().c;
      const dates = db.prepare('SELECT COUNT(DISTINCT trade_date)as c FROM idx_indices').get().c;
      const latest = db.prepare('SELECT MAX(trade_date)as d FROM idx_indices').get()?.d || '';
      const oldest = db.prepare('SELECT MIN(trade_date)as d FROM idx_indices').get()?.d || '';
      res.json({ total, indices, dates, latest, oldest });
    } catch { res.json({ total: 0 }); }
  });

  // Latest index data (all indices for latest date)
  router.get('/indices/latest', (req, res) => {
    try {
      const { latestIndexDate } = require('../db');
      const td = req.query.date || latestIndexDate();
      if (!td) return res.json({ data: [], trade_date: '' });
      const rows = db.prepare('SELECT * FROM idx_indices WHERE trade_date=? ORDER BY index_code').all(td);
      res.json({ data: rows, trade_date: td });
    } catch (e) { res.json({ data: [], error: e.message }); }
  });

  // Index history (single index over time — for backtesting benchmark)
  router.get('/indices/history', (req, res) => {
    try {
      const code = (req.query.code || 'COMPOSITE').toUpperCase().trim();
      const days = Math.min(parseInt(req.query.days) || 500, 5000);
      const rows = db.prepare('SELECT trade_date,index_code,previous,highest,lowest,close,change_val,volume,value,frequency,market_cap FROM idx_indices WHERE index_code=? ORDER BY trade_date DESC LIMIT ?').all(code, days);
      rows.reverse();
      // Calculate change_pct
      rows.forEach(r => {
        r.change_pct = r.previous > 0 ? Math.round((r.close - r.previous) / r.previous * 10000) / 100 : 0;
      });
      res.json({ code, data: rows, total: rows.length });
    } catch (e) { res.json({ code: req.query.code, data: [], error: e.message }); }
  });

  // List available indices
  router.get('/indices/list', (req, res) => {
    try {
      const rows = db.prepare(`SELECT index_code, COUNT(*)as days, MIN(trade_date)as first_date, MAX(trade_date)as last_date,
        (SELECT close FROM idx_indices i2 WHERE i2.index_code=idx_indices.index_code ORDER BY i2.trade_date DESC LIMIT 1) as last_close
        FROM idx_indices GROUP BY index_code ORDER BY index_code`).all();
      res.json({ indices: rows });
    } catch (e) { res.json({ indices: [], error: e.message }); }
  });

  // ═══════════════════════════════════════════
  // IDX API Bridge Import (reads from Deno IDX-API SQLite)
  // ═══════════════════════════════════════════

  const idxBridge = require('../utils/idx-api-bridge');

  // Helper: log sync result
  function logSync(type, date, rows, status, message) {
    try {
      db.prepare(`INSERT INTO sync_logs(sync_type,sync_date,rows_synced,status,message,finished_at)
        VALUES(?,?,?,?,?,datetime('now'))`).run(type, date || '', rows, status, message || '');
    } catch (e) { console.error('sync_log error:', e.message); }
  }

  // --- Bridge Status ---
  router.get('/sync/bridge-status', (req, res) => {
    try {
      const status = idxBridge.getIdxApiStatus();
      res.json(status);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Import Stock Summary (from IDX-API DB) ---
  router.post('/sync/stock-summary', (req, res) => {
    const { date } = req.body;
    try {
      const result = idxBridge.importStockSummary(db, { date: date || '' });
      logSync('stock_summary', date || '', result.rows, 'ok', 'bridge: ' + result.rows + ' rows');
      res.json({ ok: true, ...result });
    } catch (e) {
      logSync('stock_summary', date || '', 0, 'error', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // --- Import Index Summary ---
  router.post('/sync/index-summary', (req, res) => {
    const { date } = req.body;
    try {
      const result = idxBridge.importIndexSummary(db, { date: date || '' });
      logSync('index_summary', date || '', result.rows, 'ok', 'bridge: ' + result.rows + ' rows');
      res.json({ ok: true, ...result });
    } catch (e) {
      logSync('index_summary', date || '', 0, 'error', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // --- Import Financial Ratios (quarterly → financial_ratios, keyed (code, period)) ---
  // This endpoint used to call idxBridge.importFinancialRatios(), which wrote to
  // idx_fundamental keyed (snapshot_month, code) and read r.year/r.month — columns that do
  // not exist in IDX-API's financial_ratio table. Every row therefore got the CURRENT month,
  // so 19,373 quarterly rows collapsed onto ~1,000 (snapshot_month, code) keys and clobbered
  // the stock_screener snapshot for that month. Its `rows` counted rows PROCESSED, so
  // {"ok":true,"rows":19373} was a false success signal.
  // importFinancialRatiosFull() is the correct path: target financial_ratios, keyed
  // (code, period), period = epochToDate(r.period). The response separates the three
  // numbers that used to be conflated: rows processed / persisted (rows written) / inserted
  // (rows actually added), plus `total` (target table size after the run).
  // A healthy idempotent re-run: rows≈19373, persisted≈19373, inserted=0, total=19373.
  router.post('/sync/financial-ratios', (req, res) => {
    try {
      const result = idxBridge.importFinancialRatiosFull(db);
      logSync('financial_ratios', '', result.rows, 'ok',
        `bridge: rows=${result.rows} persisted=${result.persisted} inserted=${result.inserted} total=${result.total}`);
      res.json({ ok: true, ...result });
    } catch (e) {
      logSync('financial_ratios', '', 0, 'error', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // --- Import Stock Screener ---
  router.post('/sync/screener', (req, res) => {
    try {
      const result = idxBridge.importStockScreener(db);
      logSync('screener', result.snapshot_month || '', result.rows, 'ok', 'bridge');
      res.json({ ok: true, ...result });
    } catch (e) {
      logSync('screener', '', 0, 'error', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // --- Import Dividends ---
  router.post('/sync/dividends', (req, res) => {
    try {
      const result = idxBridge.importDividends(db);
      logSync('dividends', '', result.rows, 'ok', 'bridge');
      res.json({ ok: true, ...result });
    } catch (e) {
      logSync('dividends', '', 0, 'error', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // --- Import Stock Splits ---
  router.post('/sync/stock-splits', (req, res) => {
    try {
      const result = idxBridge.importStockSplits(db);
      logSync('stock_splits', '', result.rows, 'ok', 'bridge');
      res.json({ ok: true, ...result });
    } catch (e) {
      logSync('stock_splits', '', 0, 'error', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // --- Batch Import: stock summary for date range ---
  router.post('/sync/batch-stock', (req, res) => {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    try {
      const result = idxBridge.importStockSummary(db, { from, to });
      logSync('batch_stock', from + ' to ' + to, result.rows, 'ok', 'bridge: ' + (result.dates ? result.dates.length : 0) + ' dates');
      res.json({ ok: true, total_rows: result.rows, dates: result.dates });
    } catch (e) {
      logSync('batch_stock', from + '-' + to, 0, 'error', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // --- Batch Import: index summary for date range ---
  router.post('/sync/batch-index', (req, res) => {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    try {
      const result = idxBridge.importIndexSummary(db, { from, to });
      logSync('batch_index', from + ' to ' + to, result.rows, 'ok', 'bridge');
      res.json({ ok: true, total_rows: result.rows });
    } catch (e) {
      logSync('batch_index', from + '-' + to, 0, 'error', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // --- Import Stock Price History (daily OHLCV series → idx_daily) ---
  // Why this route exists: importStockPriceHistory() had exactly ONE caller, in
  // deno-proxy's runBridgeImport — which sits behind the dead Deno path (:3456
  // refuses connections). So the 2020→2026 series was importable only by a manual
  // `docker exec node -e`, and idx_daily silently stopped at 2025-01-02 while
  // IDX-API held data back to 2020-01-02. scripts/check-bridge-parity.py caught it.
  //
  // Default is a BOUNDED incremental window (target frontier − overlap), NOT the
  // full series: {full:true} re-upserts all 1,382,240 rows (~18s) and, because
  // better-sqlite3 is synchronous, blocks every other request for that time.
  // Body: { from, to } | { date } | { overlap_days } | { full: true }
  router.post('/sync/price-history', (req, res) => {
    const { from, to, date, full, overlap_days } = req.body || {};
    const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (from && !isDay(from)) return res.status(400).json({ ok: false, error: 'from must be YYYY-MM-DD' });
    if (to && !isDay(to)) return res.status(400).json({ ok: false, error: 'to must be YYYY-MM-DD' });
    if (date && !isDay(date)) return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' });
    if (from && to && from > to) return res.status(400).json({ ok: false, error: 'from must not be after to' });
    if (full && (from || to || date)) return res.status(400).json({ ok: false, error: 'full cannot be combined with from/to/date' });
    if (overlap_days !== undefined && (!Number.isFinite(Number(overlap_days)) || Number(overlap_days) < 0)) {
      return res.status(400).json({ ok: false, error: 'overlap_days must be a number >= 0' });
    }
    try {
      const result = idxBridge.importStockPriceHistory(db, {
        from, to, date, full: full === true || full === 'true', overlapDays: overlap_days
      });
      logSync('price_history', `${result.from || ''}..${result.to || ''}`, result.rows, 'ok',
        `mode=${result.mode} rows=${result.rows} inserted=${result.inserted} total=${result.total}`);
      res.json({ ok: true, ...result });
    } catch (e) {
      logSync('price_history', date || `${from || ''}..${to || ''}`, 0, 'error', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // --- Import All (one-click) ---
  // ── Post-sync score refresh ─────────────────────────────────────────────
  // A sync that fills idx_daily but leaves daily_scores empty makes the agent
  // rail's /scores endpoint useless ("nothing is stored" was the original gap).
  // The scoring handler already exists and is idempotent (INSERT OR REPLACE on
  // (calc_date, code)), so drive it over HTTP instead of duplicating its logic.
  // Failures are reported back in the caller's payload, never swallowed.
  async function refreshScores(afterDate) {
    return { attempted: false, skipped: 'composite-score sudah dipensiunkan' };
    const port = parseInt(process.env.PORT) || 3000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 180000);
    const out = { attempted: true };
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/idx/composite-score`, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' },
          process.env.API_KEY ? { 'x-api-key': process.env.API_KEY } : {}),
        body: JSON.stringify({}),
        signal: ctrl.signal,
      });
      const j = await r.json().catch(() => ({}));
      out.http = r.status;
      out.trade_date = j.trade_date || null;
      out.scored = typeof j.total_scored === 'number' ? j.total_scored : null;
      if (!r.ok) out.error = j.error || ('HTTP ' + r.status);
      logSync('score_refresh', afterDate || '', out.scored || 0, r.ok ? 'ok' : 'error', JSON.stringify(out));
    } catch (e) {
      out.error = e.name === 'AbortError' ? 'timeout after 180s' : e.message;
      out.scored = null;
      logSync('score_refresh', afterDate || '', 0, 'error', JSON.stringify(out));
    } finally {
      clearTimeout(timer);
    }
    return out;
  }

  router.post('/sync/import-all', async (req, res) => {
    try {
      const results = {};
      // Original 8
      results.stock = idxBridge.importStockSummary(db, {});
      results.index = idxBridge.importIndexSummary(db, {});
      results.fundamental = idxBridge.importFinancialRatios(db);
      results.screener = idxBridge.importStockScreener(db);
      results.dividends = idxBridge.importDividends(db);
      results.splits = idxBridge.importStockSplits(db);
      results.profiles = idxBridge.importCompanyProfiles(db);
      results.details = idxBridge.importCompanyDetails(db);
      // All 39 tables — safe call with fallback
      const extras = [
        ['broker', 'importBrokerSummary'], ['calendar', 'importMarketCalendar'],
        ['announcement', 'importCompanyAnnouncement'],
        ['domestic', 'importDomesticTrading'], ['industry', 'importIndustryTrading'],
        ['daily_index', 'importDailyIndex'],
        ['top_movers', 'importTopMovers'], ['active', 'importActiveStocks'],
        ['suspend', 'importCompanySuspend'], ['rights', 'importRightOfferings'],
        ['participants', 'importParticipantBrokers'], ['trading_ss', 'importTradingSS'],
        ['trading_daily', 'importTradingDaily'], ['index_chart', 'importIndexChart'],
        ['index_list', 'importIndexList'], ['fin_reports', 'importFinancialReports'],
        ['issued', 'importIssuedHistory'], ['add_listing', 'importAdditionalListings'],
        ['new_listing', 'importNewListings'], ['security', 'importSecurityStocks'],
        ['delisting', 'importCompanyDelistings'], ['relisting', 'importCompanyRelistings'],
        ['prof_ann', 'importProfileAnnouncements'], ['dealers', 'importParticipantDealers'],
        ['prof_part', 'importParticipantProfiles'], ['trade_sum', 'importTradeSummary'],
        ['fin_ratios', 'importFinancialRatiosFull'],
        // Bounded incremental top-up (the default mode of importStockPriceHistory),
        // NOT the 1.38M-row 2020→2026 backfill. Without this step idx_daily drifts
        // away from IDX-API again — which is exactly the drift the parity guard
        // caught on 2026-10-14, because the only caller lived in the dead Deno path.
        // Runs last on purpose: stock_summary already wrote the same (trade_date, code)
        // rows for the last ~51 sessions, and both sources were verified identical
        // there (49,113 pairs, 0 close/volume mismatches), so the order cannot make a
        // daily close flap between the two writers.
        ['price_hist', 'importStockPriceHistory']
      ];
      for (const [key, fn] of extras) {
        try { if (typeof idxBridge[fn] === 'function') results[key] = idxBridge[fn](db); } catch (e) { results[key] = { rows: 0, error: e.message }; }
      }
      const totalRows = Object.values(results).reduce((s, r) => s + (r?.rows || 0), 0);
      logSync('import_all', '', totalRows, 'ok', JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v?.rows || 0]))));
      const scores = await refreshScores('');
      res.json({ ok: true, total_rows: totalRows, scores, detail: results });
    } catch (e) {
      logSync('import_all', '', 0, 'error', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // --- Import Company Profiles + Details ---
  router.post('/sync/company-profiles', (req, res) => {
    try {
      const r1 = idxBridge.importCompanyProfiles(db);
      const r2 = idxBridge.importCompanyDetails(db);
      logSync('company_profiles', '', r1.rows + r2.rows, 'ok', 'profiles=' + r1.rows + ' details=' + r2.rows);
      res.json({ ok: true, profiles: r1.rows, details: r2.rows });
    } catch (e) {
      logSync('company_profiles', '', 0, 'error', e.message);
      res.status(500).json({ error: e.message });
    }
  });
  router.get('/sync/status', (req, res) => {
    try {
      const latestStock = db.prepare('SELECT MAX(trade_date) as d FROM idx_daily').get()?.d || '';
      const latestIndex = db.prepare('SELECT MAX(trade_date) as d FROM idx_indices').get()?.d || '';
      const latestFund = db.prepare('SELECT MAX(snapshot_month) as d FROM idx_fundamental').get()?.d || '';
      const stockCount = db.prepare('SELECT COUNT(DISTINCT trade_date) as c FROM idx_daily').get()?.c || 0;
      const indexCount = db.prepare('SELECT COUNT(DISTINCT trade_date) as c FROM idx_indices').get()?.c || 0;
      const tickerCount = db.prepare('SELECT COUNT(DISTINCT code) as c FROM idx_daily').get()?.c || 0;
      const recentLogs = db.prepare('SELECT * FROM sync_logs ORDER BY id DESC LIMIT 20').all();
      // ── Data availability boundary (0 ≠ zero, but "tidak tersedia") ──
      // idx_daily.bid/bid_vol/offer/offer_vol/listed_shares/tradeable_shares are filled
      // only as far as IDX-API `stock_summary` carries them (51 sessions on 2026-10-14).
      // Outside that window they hold the column DEFAULT 0, which means NOT AVAILABLE —
      // it is not a real zero. Verified 2026-10-14: 977,749/977,749 rows before 2025 and
      // 355,378/404,491 rows of 2025+ carried listed_shares=0 BEFORE the price backfill
      // too, so this is a pre-existing table-wide condition, not a backfill artefact.
      // Not recoverable either: IDX-API `issued_history` is empty (0 rows) and
      // `additional_listing` holds 165 rows, so there is no historical share-count series.
      // Ramification: (close*listed_shares) is a FAKE market cap of 0 there, and the
      // liquidity gate `market_cap > 50e9` in /composite-score/backfill therefore
      // excludes 100% of stocks on any date before that window (counted and reported).
      const sharesWindow = db.prepare('SELECT MIN(trade_date) as f, MAX(trade_date) as t, COUNT(*) as r FROM idx_daily WHERE listed_shares > 0').get() || {};
      const priceWindow = db.prepare('SELECT MIN(trade_date) as f, MAX(trade_date) as t, COUNT(*) as r FROM idx_daily WHERE close > 0').get() || {};
      let bridgeStatus = { ok: false };
      try { bridgeStatus = idxBridge.getIdxApiStatus(); } catch (e) { bridgeStatus = { ok: false, error: e.message }; }
      res.json({
        latest: { stock: latestStock, index: latestIndex, fundamental: latestFund },
        counts: { stock_dates: stockCount, index_dates: indexCount, tickers: tickerCount },
        recent_syncs: recentLogs,
        bridge: bridgeStatus,
        data_availability: {
          price_history: { from: priceWindow.f || '', to: priceWindow.t || '', rows: priceWindow.r || 0, zero_means: 'no_session' },
          shares_bid_offer: {
            from: sharesWindow.f || '', to: sharesWindow.t || '', rows: sharesWindow.r || 0,
            zero_means: 'not_available',
            note: 'listed_shares/tradeable_shares/bid/offer: 0 = tidak tersedia outside this window; market_cap derived from them is not a real value there'
          }
        }
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Sync Status ---
  router.post('/sync/today', async (req, res) => {
    const today = new Date();
    const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    try {
      const stockResult = idxBridge.importStockSummary(db, { date: dateStr });
      const indexResult = idxBridge.importIndexSummary(db, { date: dateStr });
      logSync('today', dateStr, stockResult.rows + indexResult.rows, 'ok', 'stock=' + stockResult.rows + ' index=' + indexResult.rows);
      const scores = await refreshScores(dateStr);
      res.json({ ok: true, date: dateStr, stock_rows: stockResult.rows, index_rows: indexResult.rows, scores });
    } catch (e) {
      logSync('today', dateStr, 0, 'error', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // --- Compat stubs ---
  router.get('/sync/index-list', (req, res) => {
    res.json({ ok: true, count: 0, message: 'Use Deno: deno run --allow-all sync-all.ts' });
  });

  // ═══ 1-Click Sync via Deno Server ═══
  try {
    const setupDenoProxy = require('../utils/deno-proxy');
    setupDenoProxy(router, db, idxBridge, logSync);
    console.log('[IDX] Deno proxy routes registered' + (process.env.DENO_SYNC_URL
      ? ` (live -> ${process.env.DENO_SYNC_URL})`
      : ' (DISABLED - 501 shims; upstream fetch is owned by IDX-API daily-sync.sh)'));
  } catch (e) {
    console.warn('[IDX] Deno proxy not loaded:', e.message);
  }

  // ═══════════════════════════════════════════════
  // CUSTOM TICKERS — Add/Update/Delete external data
  // ═══════════════════════════════════════════════

  // ─── Sumber baris: satu seri = satu sumber (aturan migrasi t_11e74460) ───
  // custom_ohlc.source menyimpan asal tiap baris ('investing/8849', 'yahoo', 'fred/DFII10', …).
  // Label ini yang membuat pencampuran sumber KETAHUAN, bukan tersembunyi di dalam satu deret.
  // Rail non-Yahoo: nilainya tidak boleh ditimpa /custom/fetch-all (fetch-all memakai Yahoo),
  // karena pada tanggal yang sama keduanya menulis baris yang sama.
  const NON_YAHOO_RAIL = /^(investing|fred|tradingeconomics|te|rates|external|archive|csv)/i;
  const SOURCE_RE = /^[A-Za-z0-9_.:\/-]{1,64}$/;
  const isYahooOwned = (src) => !src || !NON_YAHOO_RAIL.test(String(src).trim());

  // ─── Sesi bursa: bar Sabtu/Minggu (kanban t_4acc7bf7) ───
  // Kolom `session` (generated di db.js dari trade_date) menandai bar 'weekend'. Jendela harga —
  // ret_5d/ret_20d, chg_5d/chg_20d, MA, seri untuk chart — memakai predikat ini supaya
  // "5 hari"/"20 hari" berarti 5/20 SESI bursa, bukan 5/20 baris. Tanpa ini, satu-dua bar Minggu
  // (sesi elektronik futures / artefak agregasi sumber) memendekkan jendela secara diam-diam.
  // Bar-nya TIDAK dihapus: itu tetap kutipan sumber (mis. CL/HG/NG sungguh diperdagangkan Minggu
  // malam), jadi tetap tersimpan + tetap bisa dibaca utuh lewat `?sessions=all`.
  const REGULAR_SESSION = "COALESCE(session,'regular')<>'weekend'";

  function existingSources(code) {
    return db.prepare(
      `SELECT COALESCE(source,'') AS source, COUNT(*) AS n FROM custom_ohlc
       WHERE code=? GROUP BY COALESCE(source,'') ORDER BY n DESC`).all(code);
  }

  /** Sesi rujukan saat tarik DIMULAI — dipakai telemetri tarikan (kanban t_57252454) untuk
   *  menghitung lag frontier. Dibaca sekali per request supaya semua kode dalam satu run
   *  (fetch-all/fetch-eod loop) diukur terhadap sesi yang sama, bukan terhadap sesi yang
   *  bergeser di tengah loop gara-gara kode pertama sudah menulis bar hari ini.
   *  Kegagalannya tidak boleh menggagalkan penulisan data: null = lag tidak dihitung. */
  function pullRefDate() {
    try { return freshnessUtil.buildContext(db).ref_date || null; } catch (e) { return null; }
  }

  /** Salin baris yang sumbernya bukan keepSource ke arsip, lalu hapus dari tabel hidup.
   *  Arsip = janji "jangan hapus seri lama"; tanpa salinan, klaim itu kosong. */
  function archiveForeignRows(code, keepSource, reason) {
    const keep = keepSource == null ? '' : String(keepSource);
    const rows = db.prepare(
      `SELECT trade_date, open, high, low, close, volume, COALESCE(source,'') AS source
       FROM custom_ohlc WHERE code=? AND COALESCE(source,'') <> ?`).all(code, keep);
    const bySource = {};
    if (!rows.length) return { archived: 0, by_source: bySource };
    const ins = db.prepare(
      `INSERT OR REPLACE INTO custom_ohlc_archive
       (code, trade_date, open, high, low, close, volume, source, archived_at, reason)
       VALUES (?,?,?,?,?,?,?,?, datetime('now'), ?)`);
    for (const r of rows) {
      const label = r.source || 'unlabeled';
      ins.run(code, r.trade_date, r.open, r.high, r.low, r.close, r.volume, label, reason);
      bySource[label] = (bySource[label] || 0) + 1;
    }
    db.prepare(`DELETE FROM custom_ohlc WHERE code=? AND COALESCE(source,'') <> ?`).run(code, keep);
    return { archived: rows.length, by_source: bySource };
  }

  // `name` diperbarui HANYA kalau pemanggil mengirim nama sungguhan (bukan sekadar mengulang kode) —
  // aturan yang SAMA dengan /custom/upsert. Sebelum ini /custom/replace menulis seri baru tetapi
  // label lama menempel (ON CONFLICT tidak memuat name), sehingga label bisa menyebut sumber/bursa
  // yang sudah tidak benar: terukur pada migrasi 19 Okt 2026 (ALUMINIUM berlabel "COMEX" padahal
  // serinya LME cash 49768; RUBBER berlabel "TE" padahal serinya investing TSR20 1013412).
  function touchTicker(code, name, category, source) {
    const dr = db.prepare('SELECT MIN(trade_date) f, MAX(trade_date) l FROM custom_ohlc WHERE code=?').get(code);
    const cnt = db.prepare('SELECT COUNT(*) c FROM custom_ohlc WHERE code=?').get(code).c;
    db.prepare(
      `INSERT INTO custom_tickers(code, name, category, source, rows, first_date, last_date, updated_at)
       VALUES(?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(code) DO UPDATE SET
       rows=excluded.rows, first_date=excluded.first_date, last_date=excluded.last_date,
       category=excluded.category, source=excluded.source,
       name=CASE WHEN excluded.name IS NOT NULL AND excluded.name<>''
                  AND excluded.name<>excluded.code THEN excluded.name ELSE name END,
       updated_at=datetime('now')`
    ).run(code, name, category, source, cnt, dr.f, dr.l);
    return { total_rows: cnt, date_range: { first: dr.f, last: dr.l } };
  }

  // ─── Gerbang integritas OHLC (kanban t_565e76fd; keputusan gerbang = t_6348afbd §3) ───
  // PER-BAR (semua seri): bar yang MUSTAHIL — invarian low <= min(o,c) <= max(o,c) <= high
  // dilanggar — tidak bisa digambar sebagai candle. Yang disimpan cuma `close`; O/H/L jadi NULL.
  // `high = max(o,c)` TIDAK diisi: itu mengarang angka yang tidak pernah dikutip sumber
  // (aturan t_2bda3126 R1). Ditaruh di jalur tulis, bukan di satu rail, supaya berlaku juga
  // untuk penulis lain (yahoo/`fetch-all`, TE, CSV) — bukan hanya investing_push_bl.py.
  // PER-SERI: >=50% bar beku (o=h=l=c) ATAU mustahil -> price_only: SELURUH O/H/L seri NULL,
  // chart = garis. Ambang 50% diputuskan t_6348afbd §3; di angka nyata HRC 39,6% tetap candle.
  //
  // ohlc_state menyimpan ALASAN per bar supaya NULL tidak menghapus perbedaan
  // "sumber sendiri bilang beku" vs "kita yang buang":
  //   ok                 sumber beri O/H/L yang lolos invarian
  //   source_flat        sumber sendiri kirim o=h=l=c (bukan buatan kita)
  //   invariant_fail     O/H/L ada tapi mustahil -> dibuang
  //   missing_source     sumber tidak beri O/H/L (nilai terisi legacy fill_missing=true)
  //   dropped_price_only bar sah, tapi serinya price_only -> dibuang demi konsistensi seri
  const OHLC_PRICE_ONLY_PCT = 50;
  const OHLC_MODES = ['candle', 'price_only'];
  const OHLC_STATES = ['ok', 'source_flat', 'invariant_fail', 'missing_source', 'dropped_price_only'];

  const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;

  /** Gerbang per-bar: nilai yang boleh disimpan + alasannya. */
  function gateBar(r, fillMissing) {
    const c = numOrNull(r.close);
    const o = numOrNull(r.open), h = numOrNull(r.high), l = numOrNull(r.low);
    const vol = numOrNull(r.volume);
    const volOut = vol !== null ? vol : (fillMissing ? 0 : null);
    if (o === null || h === null || l === null) {
      // Sumber tidak menawarkan candle tiga kaki. Perilaku lama (fill_missing) DIPERTAHANKAN
      // apa adanya untuk pemanggil legacy (fred_push_bl.py kirim date+close saja), tapi
      // sekarang ada jejaknya: ohlc_state='missing_source'.
      return { open: o !== null ? o : (fillMissing ? c : null),
               high: h !== null ? h : (fillMissing ? c : null),
               low: l !== null ? l : (fillMissing ? c : null),
               close: c, volume: volOut, ohlc_state: 'missing_source' };
    }
    if (h < l || h < Math.max(o, c) || l > Math.min(o, c)) {
      return { open: null, high: null, low: null, close: c, volume: volOut,
               ohlc_state: 'invariant_fail' };
    }
    const flat = (o === h && h === l && l === c);
    return { open: o, high: h, low: l, close: c, volume: volOut,
             ohlc_state: flat ? 'source_flat' : 'ok' };
  }

  /** Gerbang per-seri dari payload. null = payload tidak menilai (tanpa O/H/L sama sekali). */
  function seriesVerdict(gated) {
    const seen = gated.filter(g => g.ohlc_state !== 'missing_source');
    if (!seen.length) return null;
    const flatOrFail = seen.filter(g => g.ohlc_state !== 'ok').length;
    return (flatOrFail * 100 / seen.length) >= OHLC_PRICE_ONLY_PCT ? 'price_only' : 'candle';
  }

  /** Gerbang BARIS untuk jalur tulis berbasis payload (/custom/upsert, /custom/replace,
   *  /custom/upload). Satu aturan untuk ketiga jalur — kalau tidak, JSON menolak apa yang
   *  diterima CSV (review sena t_a3832847 R3).
   *
   *  Boleh ≤ 0 hanya kalau SERI-nya dideklarasikan di utils/series-sign.js. `category`
   *  dari payload TIDAK dipakai lagi: fred_push_bl.py mengirim category='macro' untuk
   *  DXY/VIX/US10Y/USDCNY, jadi guard harga dulu ikut longgar untuk 17 seri level (R2).
   *
   *  Baris yang ditolak DIHITUNG dan dikembalikan, bukan hilang diam-diam: bug aslinya
   *  membuang 204 baris sementara API menjawab ok:true, sehingga pemanggil tidak tahu.
   *  close diambil lewat strictNum(): null/'' tidak lagi jadi 0 yang lolos gerbang (R4). */
  function gateRows(code, rows, fillMissing) {
    const signed = allowsNonPositive(code);
    const gated = [];
    const rejected = { nonpositive: 0, invalid: 0, missing_date: 0 };
    for (const r of rows) {
      if (!r || !r.date) { rejected.missing_date++; continue; }
      const close = strictNum(r.close);
      if (close === null) { rejected.invalid++; continue; }
      if (!signed && !(close > 0)) { rejected.nonpositive++; continue; }
      gated.push({ date: r.date, ...gateBar({
        close,
        open: strictNum(r.open), high: strictNum(r.high),
        low: strictNum(r.low), volume: strictNum(r.volume),
      }, fillMissing) });
    }
    return { gated, rejected, signed };
  }

  /** Ringkasan penolakan untuk respons + pesan saat SEMUA baris ditolak. */
  function rejectInfo(code, sent, rejected, signed) {
    const total = rejected.nonpositive + rejected.invalid + rejected.missing_date;
    const parts = [];
    if (rejected.nonpositive) parts.push(`${rejected.nonpositive} baris close<=0 (seri harga wajib >0)`);
    if (rejected.invalid) parts.push(`${rejected.invalid} baris close bukan angka (null/NaN)`);
    if (rejected.missing_date) parts.push(`${rejected.missing_date} baris tanpa date`);
    return {
      rows_sent: sent, rows_dropped: total, rejected,
      allow_nonpositive: signed,
      message: total ? `ditolak gerbang: ${parts.join('; ')}` : null,
      hint: (rejected.nonpositive && !signed)
        ? `kalau ${code} memang seri bertanda (deflasi/defisit/kontraksi), deklarasikan di server/utils/series-sign.js`
        : undefined,
    };
  }

  function getTickerMode(code) {
    try {
      const r = db.prepare('SELECT ohlc_mode FROM custom_tickers WHERE code=?').get(code);
      return r ? (r.ohlc_mode || null) : null;
    } catch (e) { return null; }
  }

  /** price_only adalah pernyataan TENTANG SERI, bukan tentang satu potongan jendela:
   *  bar lama di luar jendela payload ikut dinull-kan, kalau tidak chart masih bercampur
   *  candle (bar lama) + garis (bar baru). Idempotent: jalan kedua = 0 baris berubah. */
  function normalizePriceOnly(code) {
    // Turun ke price_only itu DESTRUKTIF: O/H/L seri dibuang. Baris yang masih punya O/H/L
    // disalin dulu ke custom_ohlc_archive (reason 'price_only downgrade') — konvensi yang sama
    // dengan /custom/replace ("arsip dulu, baru timpa"), supaya pembuangan punya jejak dan
    // NULL tidak berarti "hilang tanpa bukti". Idempotent: jalan kedua = 0 baris tersalin.
    const doomed = db.prepare(
      `SELECT trade_date, open, high, low, close, volume, COALESCE(source,'') AS source
       FROM custom_ohlc WHERE code=? AND (open IS NOT NULL OR high IS NOT NULL OR low IS NOT NULL)`).all(code);
    if (doomed.length) {
      const ins = db.prepare(
        `INSERT OR REPLACE INTO custom_ohlc_archive
         (code, trade_date, open, high, low, close, volume, source, archived_at, reason)
         VALUES (?,?,?,?,?,?,?,?, datetime('now'), ?)`);
      for (const r of doomed) {
        ins.run(code, r.trade_date, r.open, r.high, r.low, r.close, r.volume,
                r.source || 'unlabeled', 'price_only downgrade (t_565e76fd)');
      }
    }
    const r = db.prepare(
      `UPDATE custom_ohlc SET open=NULL, high=NULL, low=NULL,
         ohlc_state=CASE WHEN ohlc_state='ok' THEN 'dropped_price_only' ELSE ohlc_state END
       WHERE code=? AND (open IS NOT NULL OR high IS NOT NULL OR low IS NOT NULL)`).run(code);
    return r.changes;
  }

  /** Label state yang DISIMPAN untuk satu bar di jalur tulis.
   *  Kenapa bukan langsung `g.ohlc_state`: untuk seri price_only, rail BERHENTI mengirim O/H/L
   *  (keputusan t_6348afbd §3), jadi gateBar cuma bisa bilang "tidak ada O/H/L" = missing_source —
   *  padahal sumbernya PUNYA O/H/L dan kita yang membuangnya. Kalau labelnya dibiarkan
   *  missing_source, kolom penanda malah menghapus perbedaan yang mau dijaga
   *  (DoD t_565e76fd no.3: "sumber bilang beku" vs "kita buang").
   *  Bukti "kita yang buang" = pemanggil MENYATAKAN ohlc_mode=price_only di payload. Kalau
   *  price_only cuma hasil hitungan server, payload memang tak pernah punya O/H/L sejak awal
   *  (mis. fred_push_bl.py kirim date+close saja) -> missing_source tetap benar. */
  function writeState(g, priceOnly, declaredPriceOnly) {
    if (!priceOnly) return g.ohlc_state;
    if (g.ohlc_state === 'ok') return 'dropped_price_only';
    if (g.ohlc_state === 'missing_source' && declaredPriceOnly) return 'dropped_price_only';
    return g.ohlc_state;
  }

  /** Statement upsert yang MEMAKAI gerbang per-bar, plus penulisan satu bar lewat gerbang itu.
   *  Dipakai penulis NON-rail (fetch-all / fetch-eod / sync-stale / unggah CSV). Aturan
   *  "bar mustahil tidak pernah disimpan sebagai candle" harus berlaku untuk SEMUA seri
   *  (keputusan t_6348afbd §3) — kalau hanya /custom/upsert & /custom/replace yang memakainya,
   *  seri Yahoo/CSV tetap menyajikan candle mustahil karena ditulis jalur lain.
   *  fill_missing=false: O/H/L yang tidak dikirim sumber disimpan NULL, bukan diisi close. */
  function gatedUpsertStmt() {
    return db.prepare(
      `INSERT INTO custom_ohlc(trade_date, code, open, high, low, close, volume, source, ohlc_state)
       VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(trade_date, code) DO UPDATE SET
       open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close,
       volume=excluded.volume, source=excluded.source, ohlc_state=excluded.ohlc_state`);
  }

  /** Tulis satu bar dari penulis non-rail lewat gerbang per-bar yang sama. Mengembalikan ohlc_state. */
  function writeBarGated(up, code, row, source) {
    const g = gateBar(row, false);
    up.run(row.date, code, g.open, g.high, g.low, g.close, g.volume, source, g.ohlc_state);
    return g.ohlc_state;
  }

  function stateCounts(code) {
    try {
      return db.prepare(
        `SELECT COALESCE(ohlc_state,'<null>') AS state, COUNT(*) AS n
         FROM custom_ohlc WHERE code=? GROUP BY COALESCE(ohlc_state,'<null>')`).all(code);
    } catch (e) { return []; }
  }

  // ─── Jejak PENULISAN ULANG bar yang sudah tersimpan (kanban t_7be29126) ───
  // Seri pin berkelanjutan (investing 8849 CL · 961730 HRCc1 · 992745 FCPOc1) BUKAN harga satu
  // kontrak sepanjang sejarah: ketika pin pindah bulan, vendor menulis ULANG bar yang sudah terbit.
  // Terukur 19 Okt 2026: bar WTI 2026-10-15 tersimpan 97,97 (NOV-26) lalu menjadi 96,50 (DEC-26)
  // setelah re-pull. Kunci barisnya UNIQUE(trade_date, code), jadi re-pull menimpa nilai lama dan
  // angka lamanya hilang tanpa bekas — custom_ohlc_archive TIDAK menolong karena arsip itu hanya
  // untuk baris yang SUMBERNYA diganti, bukan untuk nilai yang ditulis ulang sumber yang sama.
  // Fungsi ini TIDAK mengubah nilai yang disimpan: seri tidak dibuat immutable dan tiap bar tidak
  // dilabeli bulan kontrak — keduanya keputusan produk (a/b di kartu). Yang dicatat hanya fakta
  // "bar ini sudah ada, nilainya berubah dari X ke Y pada waktu Z, umur bar saat itu N hari".
  // age_days dipisahkan supaya revisi sesi berjalan (0-1 hari, vendor menyempurnakan bar sebelum
  // settle) tidak tertukar dengan penulisan ulang bar lama (>= 2 hari, pola roll).
  const REWRITE_FIELDS = ['open', 'high', 'low', 'close', 'volume'];

  function sameNum(a, b) {
    if (a === null || a === undefined) return b === null || b === undefined;
    if (b === null || b === undefined) return false;
    const x = Number(a), y = Number(b);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return Math.abs(x - y) <= 1e-9;
  }

  /** Catat bar yang SUDAH ada lalu ditulis dengan nilai berbeda.
   *  Mengembalikan {count, max_age_days}: umur tertua yang berubah itu yang membedakan
   *  "revisi sesi berjalan" (0-1 hari) dari "bar lama ditulis ulang" (>= 2 hari, pola roll). */
  function logRewrites(code, gated, source, priceOnly, endpoint) {
    // Untuk seri price_only, O/H/L sengaja dinull-kan lebih dulu (normalizePriceOnly). Kalau ikut
    // dibandingkan, setiap run akan mencatat "O/H/L hilang" sebagai penulisan ulang — bukan roll.
    const fields = priceOnly ? ['close', 'volume'] : REWRITE_FIELDS;
    const sel = db.prepare(
      `SELECT open, high, low, close, volume, COALESCE(source,'') AS src
       FROM custom_ohlc WHERE code=? AND trade_date=?`);
    const ins = db.prepare(
      `INSERT INTO custom_ohlc_rewrites
       (code, trade_date, source, old_source, age_days,
        old_open, old_high, old_low, old_close, old_volume,
        new_open, new_high, new_low, new_close, new_volume, detected_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    // Umur bar dihitung di SQL dengan +7 jam (WIB), konvensi yang sama dengan epochToDate() di app
    // ini. Kalau dihitung dari `new Date()` di Node, container berjalan di UTC dan bar "hari ini"
    // (WIB) akan terbaca 1 hari lebih tua antara 00:00-07:00 WIB — cukup untuk membuat ambang
    // "bar lama" (>=2 hari) salah pada bar kemarin. tanggal tak valid -> julianday NULL -> age NULL.
    const ageStmt = db.prepare(
      "SELECT CAST(julianday(date('now','+7 hours')) - julianday(?) AS INTEGER) AS age");
    let count = 0, maxAge = null;
    for (const g of gated) {
      const cur = sel.get(code, g.date);
      if (!cur) continue;                                      // bar baru = INSERT, bukan tulis ulang
      if (!fields.some(f => !sameNum(cur[f], g[f]))) continue;  // identik = bukan tulis ulang
      const age = ageStmt.get(g.date).age;
      ins.run(code, g.date, source, cur.src || null, age,
              cur.open, cur.high, cur.low, cur.close, cur.volume,
              g.open, g.high, g.low, g.close, g.volume, endpoint);
      count++;
      if (age !== null && (maxAge === null || age > maxAge)) maxAge = age;
    }
    return { count, max_age_days: maxAge };
  }

  // List all custom tickers
  router.get('/custom/tickers', (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM custom_tickers ORDER BY code').all();
      res.json(rows);
    } catch (e) { res.json([]); }
  });

  // Riwayat penulisan ulang bar (kanban t_7be29126) — baca-saja, tanpa mengubah seri apa pun.
  //   ?code=WTI            batasi satu seri
  //   ?min_age_days=2      hanya bar LAMA yang ditulis ulang (pola roll); revisi sesi berjalan = 0-1
  //   ?limit=200           maks 2000
  // close_pct dihitung di sini (old_close 0/NULL -> null, bukan 0 palsu).
  router.get('/custom/rewrites', (req, res) => {
    try {
      const code = String(req.query.code || '').toUpperCase().trim();
      const limit = Math.min(2000, Math.max(1, Number.parseInt(req.query.limit, 10) || 200));
      const minAgeRaw = req.query.min_age_days;
      const minAge = (minAgeRaw === undefined || minAgeRaw === '' || !Number.isFinite(Number(minAgeRaw)))
        ? null : Number(minAgeRaw);
      const where = [], args = [];
      if (code) { where.push('code=?'); args.push(code); }
      if (minAge !== null) { where.push('age_days >= ?'); args.push(minAge); }
      const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
      const rows = db.prepare(`SELECT * FROM custom_ohlc_rewrites${clause} ORDER BY id DESC LIMIT ?`)
        .all(...args, limit);
      const total = db.prepare(`SELECT COUNT(*) c FROM custom_ohlc_rewrites${clause}`).get(...args).c;
      for (const r of rows) {
        r.close_pct = (r.old_close === null || r.new_close === null || !r.old_close) ? null
          : Number((((r.new_close - r.old_close) / r.old_close) * 100).toFixed(4));
      }
      res.json({ ok: true, code: code || null, min_age_days: minAge, total, count: rows.length,
                 rewrites: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Telemetri TARIKAN per seri (kanban t_57252454) — baca-saja, tidak menulis apa pun.
  //   ?code=CPO     batasi satu seri
  //   ?limit=200    baris mentah terbaru (maks 2000)
  // Ringkasan per kode yang menjawab "kenapa seri ini tertinggal?":
  //   pull_behind    true  = sumber sudah terbit, tabel kita belum punya barnya -> CACAT KITA
  //   source_stalled true  = frontier tidak maju N HARI TARIK sukses -> SUMBER berhenti terbit
  //   stall_evaluable false = riwayat hari tarik < ambang -> BELUM BISA DINILAI (bukan "sehat").
  //                          Kode seperti ini juga muncul di freshness.stall_unevaluable_codes.
  //   frontier_lag_p50/p95 = lag (SESI) antara frontier sumber dan sesi rujukan PADA JAM TARIK.
  // Angka-angka ini MELAPORKAN; ia tidak dipakai menulis ulang expected_lag_sessions (lihat
  // catatan di utils/pull-log.js: ratchet otomatis = cara mematikan alarm).
  router.get('/custom/pull-log', (req, res) => {
    try {
      const code = String(req.query.code || '').toUpperCase().trim();
      const limit = Math.min(2000, Math.max(1, Number.parseInt(req.query.limit, 10) || 200));
      const where = code ? ' WHERE code=?' : '';
      const args = code ? [code] : [];
      const rows = db.prepare(`SELECT * FROM custom_pull_log${where} ORDER BY id DESC LIMIT ?`)
        .all(...args, limit);
      const total = db.prepare(`SELECT COUNT(*) c FROM custom_pull_log${where}`).get(...args).c;
      const report = pullLog.pullReport(db, { code: code || null });
      res.json({ ok: true, code: code || null, total, count: rows.length,
                 thresholds: report.thresholds, by_code: report.by_code, rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Delete custom ticker + its OHLC data — tapi barisnya diarsipkan dulu (bukan hilang).
  router.delete('/custom/tickers/:code', (req, res) => {
    try {
      const code = req.params.code.toUpperCase().trim();
      const reason = String(req.query.reason || req.body?.reason || 'delete via API').slice(0, 200);
      let arch = { archived: 0, by_source: {} };
      db.transaction(() => {
        arch = archiveForeignRows(code, null, reason);
        db.prepare('DELETE FROM custom_ohlc WHERE code=?').run(code);
        db.prepare('DELETE FROM custom_tickers WHERE code=?').run(code);
      })();
      res.json({ ok: true, deleted: code, archived: arch.archived, archived_by_source: arch.by_source });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ EOD AUTO-FETCH — Alpha Vantage + CoinGecko ═══
  let eodFetcher;
  try { eodFetcher = require('./eod-fetcher'); } catch (e) { /* module not available */ }

  // ═══ UPSERT CUSTOM OHLC (jalur kedua: sumber non-Yahoo, mis. investing/TE) ═══
  // Body: {code, name?, category?, source?, rows:[{date, close, open?, high?, low?, volume?}]}
  // Dipakai skrip host yang punya akses ke rail lain (investing pinned ids, Trading Economics).
  //
  // GUARD "satu seri = satu sumber": kalau baris yang sudah ada berlabel sumber LAIN, upsert
  // menjawab 409 dan tidak menulis apa pun. Dulu nilai rail berbeda bisa saling menimpa pada
  // tanggal yang sama tanpa jejak (deret tercampur). Untuk sengaja mengganti sumber satu seri,
  // pakai POST /custom/replace — jalur itu mengarsipkan baris lama lebih dulu.
  router.post('/custom/upsert', (req, res) => {
    try {
      const code = String(req.body.code || '').toUpperCase().trim();
      const category = String(req.body.category || 'custom').trim();
      const name = String(req.body.name || code);
      const source = String(req.body.source || 'external').trim();
      const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
      // fill_missing=false -> kolom yang TIDAK tersedia disimpan NULL, bukan diisi nilai lain.
      // Default true = perilaku lama (pemanggil lama: fred_push_bl.py mengirim hanya date+close).
      // Kenapa perlu: rail investing (kanban t_a10cc35c) tidak punya volume untuk beberapa seri;
      // dulu nilai kosong diisi `close` sehingga volume tersimpan = harga (285/493 baris di TIN_LME)
      // dan tidak bisa dibedakan dari volume asli. Lihat t_2bda3126 (review sena) R1/R2.
      const fillMissing = req.body.fill_missing !== false;
      // Pemanggil boleh MENYATAKAN mode seri (rail sudah tahu serinya price_only dan berhenti
      // mengirim O/H/L). Kalau tidak dikirim, gerbang per-seri menghitungnya dari payload ini.
      const explicitMode = OHLC_MODES.includes(String(req.body.ohlc_mode || '')) ? String(req.body.ohlc_mode) : null;
      if (!code) return res.status(400).json({ error: 'code required' });
      if (!rows.length) return res.status(400).json({ error: 'rows required' });
      if (!SOURCE_RE.test(source)) return res.status(400).json({ error: 'source tidak valid (maks 64 karakter, [A-Za-z0-9_.:/-])' });
      // Penanda PENULIS (kanban t_b7a0fdb1). Divalidasi SEBELUM menulis apa pun: nilai tidak
      // sah dijawab 400, bukan disimpan sebagai NULL diam-diam — penulis yang salah ketik
      // harus tahu bahwa barisnya tidak akan dihitung penjaga penjadwal sebagai bukti.
      // Tidak dikirim = null (perilaku lama, sah untuk fred/yahoo/idx-api yang bukan rail).
      const writerRaw = req.body.writer;
      const writer = pullLog.normalizeWriter(writerRaw);
      if (writerRaw !== undefined && writerRaw !== null && String(writerRaw).trim() !== '' && !writer) {
        return res.status(400).json({ ok: false, error: 'writer tidak valid (huruf kecil/angka, maks 48, [a-z0-9_.:-])',
          writer_received: String(writerRaw).slice(0, 48) });
      }

      const g = gateRows(code, rows, fillMissing);
      const gated = g.gated;
      const rejection = rejectInfo(code, rows.length, g.rejected, g.signed);
      // Semua baris ditolak = kehilangan total, bukan "tidak ada data baru". Dulu dijawab
      // ok:true dan pemanggil tidak pernah tahu barisnya hilang (204 baris, t_0e4e2cba).
      if (!gated.length) return res.status(422).json({ ok: false, code,
        error: 'semua baris ditolak gerbang — tidak ada yang ditulis', ...rejection });
      const verdict = explicitMode || seriesVerdict(gated);
      const priceOnly = verdict === 'price_only';
      // Pemanggil menyatakan sendiri serinya price_only -> ketiadaan O/H/L di payload berarti
      // "kita yang buang", bukan "sumber tidak punya" (lihat writeState).
      const declaredPriceOnly = explicitMode === 'price_only';

      const foreign = existingSources(code).filter(s => s.source !== source);
      if (foreign.length && req.body.allow_mix !== true) {
        return res.status(409).json({
          ok: false, error: 'seri ini sudah bersumber lain — upsert tidak menulis apa pun',
          code, incoming_source: source, existing_sources: foreign,
          hint: 'pindah sumber = POST /custom/replace (mengarsipkan baris lama lebih dulu); ' +
                'allow_mix:true hanya untuk penggabungan yang memang disengaja',
        });
      }

      let written = 0;
      let normalized = 0;
      let rewrites = { count: 0, max_age_days: null };
      const droppedByState = {};
      // Telemetri tarikan (t_57252454): sesi rujukan dibaca SEBELUM menulis.
      const pullRef = pullRefDate();
      db.transaction(() => {
        // Seri price_only: arsipkan + null-kan O/H/L LAMA lebih dulu, SEBELUM payload menimpa
        // baris yang sama (payload price_only menulis NULL) — kalau urutannya dibalik, nilai
        // yang dibuang hilang tanpa jejak (lihat normalizePriceOnly).
        if (priceOnly) normalized = normalizePriceOnly(code);
        // HARUS sebelum loop upsert: pembandingnya adalah nilai yang SEKARANG tersimpan. Kalau
        // dipanggil sesudahnya, yang dibandingkan adalah nilai baru dengan nilai baru (= tidak
        // pernah ada penulisan ulang yang tercatat). Satu transaksi dengan penulisannya, jadi
        // catatan dan perubahan baris batal bersama kalau ada error.
        rewrites = logRewrites(code, gated, source, priceOnly, 'POST /custom/upsert');
        const up = db.prepare(
          `INSERT INTO custom_ohlc(trade_date, code, open, high, low, close, volume, source, ohlc_state)
           VALUES(?,?,?,?,?,?,?,?,?)
           ON CONFLICT(trade_date, code) DO UPDATE SET
           open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close,
           volume=excluded.volume, source=excluded.source, ohlc_state=excluded.ohlc_state`);
        for (const g of gated) {
          const st = writeState(g, priceOnly, declaredPriceOnly);
          droppedByState[st] = (droppedByState[st] || 0) + 1;
          up.run(g.date, code,
            priceOnly ? null : g.open,
            priceOnly ? null : g.high,
            priceOnly ? null : g.low,
            g.close, g.volume, source, st);
          written++;
        }
      })();

      const dr = db.prepare('SELECT MIN(trade_date) f, MAX(trade_date) l FROM custom_ohlc WHERE code=?').get(code);
      const cnt = db.prepare('SELECT COUNT(*) c FROM custom_ohlc WHERE code=?').get(code).c;
      if (written > 0) {
        db.prepare(
          `INSERT INTO custom_tickers(code, name, category, source, rows, first_date, last_date, updated_at)
           VALUES(?,?,?,?,?,?,?,datetime('now'))
           ON CONFLICT(code) DO UPDATE SET
           rows=excluded.rows, first_date=excluded.first_date, last_date=excluded.last_date,
           category=excluded.category, source=excluded.source,
           -- Nama tayang ikut diperbarui HANYA kalau pemanggil mengirim nama sungguhan
           -- (bukan sekadar mengulang kode). Tanpa ini, rail investing tidak bisa memberi
           -- label seri (mis. catatan rollover HRCc1) kecuali lewat UPDATE manual ke DB.
           name=CASE WHEN excluded.name IS NOT NULL AND excluded.name<>''
                      AND excluded.name<>excluded.code THEN excluded.name ELSE name END,
           updated_at=datetime('now')`
        ).run(code, name, category, source, cnt, dr.f, dr.l);
        if (verdict) db.prepare('UPDATE custom_tickers SET ohlc_mode=? WHERE code=?').run(verdict, code);
      }
      // Telemetri tarikan (t_57252454): frontier = MAX(trade_date) dari PAYLOAD, bukan dari DB
      // kita. Ditulis SESUDAH data + custom_tickers, dan logPull tidak pernah melempar, jadi
      // kegagalan mencatat tidak bisa membatalkan penulisan yang sudah sah.
      const frontier = pullLog.frontierOf(gated);
      const pullStatus = pullLog.logPull(db, {
        code, source, frontier, rows: gated.length, written,
        endpoint: 'POST /custom/upsert', refDate: pullRef, writer,
        status: written > 0 ? 'ok' : 'no_data',
      });
      res.json({ ok: true, code, source, written,
                 // `writer` di ECHO di tingkat atas (bukan hanya di dalam `pull`): skrip rail
                 // memverifikasinya seperti `fill_missing` — server lama yang mengabaikan kunci
                 // ini harus terbaca GAGAL oleh penulis, bukan diam-diam menulis tanpa penanda.
                 writer,
                 rows_sent: rejection.rows_sent, rows_dropped: rejection.rows_dropped,
                 rejected: rejection.rejected, allow_nonpositive: rejection.allow_nonpositive,
                 gate_warning: rejection.message, gate_hint: rejection.hint,
                 rewrites_logged: rewrites.count, rewrites_max_age_days: rewrites.max_age_days,
                 total_rows: cnt, fill_missing: fillMissing,
                 ohlc_mode: verdict || getTickerMode(code), price_only: priceOnly,
                 nulled_ohlc_rows: normalized, bar_states: droppedByState, states_in_table: stateCounts(code),
                 pull: { status: pullStatus, source_frontier_date: frontier, ref_date: pullRef, writer },
                 date_range: { first: dr.f, last: dr.l } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ REPLACE CUSTOM SERIES — pindah sumber satu seri secara utuh ═══
  // Body: {code, name?, category?, source, rows:[{date,open,high,low,close,volume}],
  //        fill_missing?, archive_previous, archive_reason?}
  //
  // Bedanya dengan /custom/upsert: baris lama yang bersumber lain DIARSIPKAN ke
  // custom_ohlc_archive lebih dulu (bukan ditimpa / dihapus tanpa jejak), baru seri baru ditulis.
  // `archive_previous: true` wajib kalau seri sudah punya baris berlabel sumber lain — tanpa itu
  // permintaan dijawab 409, supaya pencampuran dua basis tidak pernah terjadi "kecelakaan".
  // fill_missing default FALSE di sini: jalur baru, jadi jangan warisi kebiasaan mengisi nilai
  // hilang dengan close (itu mengarang angka — temuan review t_2bda3126).

  router.post('/custom/replace', (req, res) => {
    try {
      const code = String(req.body.code || '').toUpperCase().trim();
      const source = String(req.body.source || '').trim();
      const name = String(req.body.name || code);
      const category = String(req.body.category || 'custom').trim();
      const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
      const fillMissing = req.body.fill_missing === true;
      const explicitMode = OHLC_MODES.includes(String(req.body.ohlc_mode || '')) ? String(req.body.ohlc_mode) : null;
      const reason = String(req.body.archive_reason || '').slice(0, 200)
        || `replace source -> ${source || '?'}`;

      if (!code) return res.status(400).json({ error: 'code required' });
      if (!SOURCE_RE.test(source)) return res.status(400).json({ error: 'source required (maks 64 karakter, [A-Za-z0-9_.:/-])' });
      if (!rows.length) return res.status(400).json({ error: 'rows required' });

      // Gerbang OHLC yang sama seperti /custom/upsert — jalur tulis tidak boleh berbeda aturan.
      const g = gateRows(code, rows, fillMissing);
      const gated = g.gated;
      const rejection = rejectInfo(code, rows.length, g.rejected, g.signed);
      if (!gated.length) return res.status(422).json({ ok: false, code,
        error: 'semua baris ditolak gerbang — tidak ada yang ditulis', ...rejection });
      const verdict = explicitMode || seriesVerdict(gated);
      const priceOnly = verdict === 'price_only';
      const declaredPriceOnly = explicitMode === 'price_only';

      // Satu permintaan, satu sumber: baris tidak boleh membawa label sendiri yang berbeda.
      const rowSources = new Set(rows.map(r => r && r.source).filter(Boolean));
      if (rowSources.size > 1 || (rowSources.size === 1 && !rowSources.has(source))) {
        return res.status(400).json({ error: 'rows ikut membawa source berbeda dari body.source',
                                      row_sources: [...rowSources] });
      }

      const existing = existingSources(code);
      const foreign = existing.filter(s => s.source !== source);
      if (foreign.length && req.body.archive_previous !== true) {
        return res.status(409).json({
          ok: false, error: 'seri ini sudah punya baris bersumber lain; kirim archive_previous:true ' +
                            'supaya baris lama diarsipkan lebih dulu',
          code, incoming_source: source, existing_sources: foreign,
        });
      }

      let arch = { archived: 0, by_source: {} };
      let written = 0;
      let normalized = 0;
      let rewrites = { count: 0, max_age_days: null };
      const droppedByState = {};
      db.transaction(() => {
        if (foreign.length) arch = archiveForeignRows(code, source, reason);
        // Sama seperti /custom/upsert: arsipkan + null-kan O/H/L lama SEBELUM payload menimpanya.
        if (priceOnly) normalized = normalizePriceOnly(code);
        // Setelah baris sumber lain diarsipkan (jadi yang tersisa = sumber yang sama) dan SEBELUM
        // upsert: catat bar yang nilainya berubah. Lihat catatan di /custom/upsert (t_7be29126).
        rewrites = logRewrites(code, gated, source, priceOnly, 'POST /custom/replace');
        const up = db.prepare(
          `INSERT INTO custom_ohlc(trade_date, code, open, high, low, close, volume, source, ohlc_state)
           VALUES(?,?,?,?,?,?,?,?,?)
           ON CONFLICT(trade_date, code) DO UPDATE SET
           open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close,
           volume=excluded.volume, source=excluded.source, ohlc_state=excluded.ohlc_state`);
        for (const g of gated) {
          const st = writeState(g, priceOnly, declaredPriceOnly);
          droppedByState[st] = (droppedByState[st] || 0) + 1;
          up.run(g.date, code,
            priceOnly ? null : g.open,
            priceOnly ? null : g.high,
            priceOnly ? null : g.low,
            g.close, g.volume, source, st);
          written++;
        }
      })();

      const meta = touchTicker(code, name, category, source);
      if (verdict) db.prepare('UPDATE custom_tickers SET ohlc_mode=? WHERE code=?').run(verdict, code);
      const after = existingSources(code);
      const okSingle = after.length === 1 && after[0].source === source;
      res.status(okSingle ? 200 : 500).json({
        ok: okSingle, code, source, written,
        rows_sent: rejection.rows_sent, rows_dropped: rejection.rows_dropped,
        rejected: rejection.rejected, allow_nonpositive: rejection.allow_nonpositive,
        gate_warning: rejection.message, gate_hint: rejection.hint,
        rewrites_logged: rewrites.count, rewrites_max_age_days: rewrites.max_age_days,
        archived: arch.archived, archived_by_source: arch.by_source,
        total_rows: meta.total_rows, date_range: meta.date_range, fill_missing: fillMissing,
        ohlc_mode: verdict || getTickerMode(code), price_only: priceOnly,
        nulled_ohlc_rows: normalized, bar_states: droppedByState, states_in_table: stateCounts(code),
        sources_in_table: after,
        error: okSingle ? undefined : 'gagal: tabel masih memuat lebih dari satu sumber untuk kode ini',
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ EOD REFRESH SEMUA CUSTOM TICKER (untuk dijadwalkan, mis. harian) ═══
  // Seri yang sumbernya rail PIN (investing/fred/te/rates/external) DILEWATI: EOD fetcher hanya
  // tahu Yahoo/CoinGecko, jadi menjalankannya berarti menulis bar Yahoo ke seri yang dibangun dari
  // konvensi lain (LME/Newcastle/HRC) — deret terputus tanpa penanda (t_6d027516 r2, diperluas di
  // t_11e74460 jadi semua rail, bukan hanya investing). Rail itu menyegarkan serinya sendiri
  // setelah blok CUSTOM-EOD di daily-sync.sh.
  // Baris yang MEMANG ditulis fetch-all diberi label 'yahoo' (per baris, bukan hanya di metadata):
  // itu yang membuat pencampuran sumber berikutnya bisa dideteksi, bukan ditebak.
  router.post('/custom/fetch-all', async (req, res) => {
    if (!eodFetcher) return res.status(500).json({ error: 'eod-fetcher module not found' });
    try {
      const tickers = db.prepare('SELECT code, name, category, source FROM custom_tickers ORDER BY code').all();
      const detail = [];
      let skipped = 0;
      // Telemetri tarikan (t_57252454): satu sesi rujukan untuk seluruh run, supaya seri pertama
      // yang menulis bar hari ini tidak menggeser pembanding seri berikutnya di run yang sama.
      const pullRef = pullRefDate();
      for (const t of tickers) {
        if (!isYahooOwned(t.source)) {
          skipped++;
          detail.push({ code: t.code, ok: true, skipped: 'rail-owned', source: t.source });
          continue;
        }
        try {
          const r = await eodFetcher.fetchEOD(t.code, t.category, process.env.ALPHA_VANTAGE_KEY || '', false);
          let written = 0;
          const barStates = {};
          db.transaction(() => {
            const up = gatedUpsertStmt();
            for (const row of (r.rows || [])) {
              if (!row.date || !(strictNum(row.close) > 0)) continue;  // seri harga: close<=0 = cetakan rusak
              const st = writeBarGated(up, t.code, row, r.source || 'yahoo');
              barStates[st] = (barStates[st] || 0) + 1;
              written++;
            }
          })();
          const dr = db.prepare('SELECT MIN(trade_date) f, MAX(trade_date) l FROM custom_ohlc WHERE code=?').get(t.code);
          const cnt = db.prepare('SELECT COUNT(*) c FROM custom_ohlc WHERE code=?').get(t.code).c;
          db.prepare(`UPDATE custom_tickers SET rows=?, first_date=?, last_date=?, updated_at=datetime('now') WHERE code=?`)
            .run(cnt, dr.f, dr.l, t.code);
          const pullFrontier = pullLog.frontierOf(r.rows || []);
          const pullStatus = pullLog.logPull(db, {
            code: t.code, source: String(r.source || 'yahoo'), frontier: pullFrontier,
            rows: (r.rows || []).length, written,
            endpoint: 'POST /custom/fetch-all', refDate: pullRef,
            status: written > 0 ? 'ok' : 'no_data',
          });
          detail.push({ code: t.code, ok: true, written, last: dr.l, bar_states: barStates,
                        pull: { status: pullStatus, source_frontier_date: pullFrontier } });
        } catch (e) {
          pullLog.logPull(db, { code: t.code, source: 'yahoo', frontier: null, rows: 0, written: 0,
            endpoint: 'POST /custom/fetch-all', refDate: pullRef, status: 'error', error: e.message });
          detail.push({ code: t.code, ok: false, error: e.message });
        }
      }
      res.json({
        ok: true,
        refreshed: detail.filter(x => x.ok && !x.skipped).length,
        failed: detail.filter(x => !x.ok).length,
        skipped,
        detail,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/custom/fetch-eod', async (req, res) => {
    if (!eodFetcher) return res.status(500).json({ error: 'eod-fetcher module not found. Place eod-fetcher.js in server/routes/' });
    // Telemetri tarikan (t_57252454) butuh kode + sumber juga saat tarikan GAGAL: tanpa baris
    // 'error', jalur tarik yang rusak tidak bisa dibedakan dari sumber yang berhenti terbit.
    let pullCode = '', pullSource = '', pullRef = null;
    try {
      const code = (req.body.code || '').toUpperCase().trim();
      const category = (req.body.category || '').trim();
      const fullHistory = !!req.body.full_history;
      if (!code) return res.status(400).json({ error: 'Missing code' });

      const apiKey = process.env.ALPHA_VANTAGE_KEY || '';
      const det = eodFetcher.detectSource(code, category);
      pullCode = code;
      pullSource = String(det.source || 'external');
      pullRef = pullRefDate();

      const result = await eodFetcher.fetchEOD(code, category, apiKey, fullHistory);
      const rows = result.rows;
      pullSource = String(result.source || pullSource);
      if (!rows.length) {
        const st = pullLog.logPull(db, { code, source: pullSource, frontier: null, rows: 0, written: 0,
          endpoint: 'POST /custom/fetch-eod', refDate: pullRef, status: 'no_data', error: 'no rows from vendor' });
        return res.json({ ok: true, code, inserted: 0, updated: 0, message: 'No data returned',
                          pull: { status: st, source_frontier_date: null, ref_date: pullRef } });
      }

      const upsert = gatedUpsertStmt();
      const barStates = {};
      let inserted = 0, updated = 0;
      db.transaction(() => {
        for (const r of rows) {
          if (!r.date || !(strictNum(r.close) > 0)) continue;  // seri harga: close<=0 = cetakan rusak
          const existing = db.prepare('SELECT id FROM custom_ohlc WHERE trade_date=? AND code=?').get(r.date, code);
          const st = writeBarGated(upsert, code, r, result.source || 'external');
          barStates[st] = (barStates[st] || 0) + 1;
          if (existing) updated++; else inserted++;
        }
      })();

      const totalRows = db.prepare('SELECT COUNT(*) as c FROM custom_ohlc WHERE code=?').get(code)?.c || 0;
      const dateRange = db.prepare('SELECT MIN(trade_date) as first, MAX(trade_date) as last FROM custom_ohlc WHERE code=?').get(code);
      const name = req.body.name || code;
      db.prepare(
        `INSERT INTO custom_tickers(code, name, category, source, rows, first_date, last_date, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(code) DO UPDATE SET
         rows=excluded.rows, first_date=excluded.first_date, last_date=excluded.last_date,
         source=excluded.source, updated_at=datetime('now')`
      ).run(code, name, category || 'custom', result.source, totalRows, dateRange?.first || '', dateRange?.last || '');

      // Telemetri tarikan (t_57252454): frontier payload, bukan MAX(custom_ohlc).
      const pullFrontier = pullLog.frontierOf(rows);
      const pullStatus = pullLog.logPull(db, {
        code, source: pullSource, frontier: pullFrontier, rows: rows.length, written: inserted + updated,
        endpoint: 'POST /custom/fetch-eod', refDate: pullRef,
        status: (inserted + updated) > 0 ? 'ok' : 'no_data',
      });
      res.json({ ok: true, code, source: result.source, inserted, updated, total_rows: totalRows,
        bar_states: barStates,
        pull: { status: pullStatus, source_frontier_date: pullFrontier, ref_date: pullRef },
        date_range: { first: dateRange?.first, last: dateRange?.last } });
    } catch (e) {
      if (pullCode) {
        pullLog.logPull(db, { code: pullCode, source: pullSource || null, frontier: null, rows: 0, written: 0,
          endpoint: 'POST /custom/fetch-eod', refDate: pullRef, status: 'error', error: e.message });
      }
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/custom/sync-stale', async (req, res) => {
    if (!eodFetcher) return res.status(500).json({ error: 'eod-fetcher module not found' });
    try {
      const apiKey = process.env.ALPHA_VANTAGE_KEY || '';
      const staleDays = parseInt(req.body.stale_days) || 7;
      const today = new Date().toISOString().split('T')[0];
      const all = db.prepare('SELECT code, name, category, source, last_date FROM custom_tickers ORDER BY code').all();
      // Sumber sama dengan fetch-all: jangan pernah menulis bar Yahoo ke seri rail (investing/fred/…).
      const stale = all.filter(r => {
        if (!isYahooOwned(r.source)) return false;
        if (!r.last_date) return true;
        return Math.floor((new Date(today) - new Date(r.last_date)) / 86400000) > staleDays;
      });
      if (!stale.length) return res.json({ ok: true, synced: 0, message: 'All tickers up to date' });

      const results = [];
      // Telemetri tarikan (t_57252454): satu sesi rujukan untuk seluruh run (lihat fetch-all).
      const pullRef = pullRefDate();
      for (const ticker of stale) {
        try {
          const det = eodFetcher.detectSource(ticker.code, ticker.category);

          const data = await eodFetcher.fetchEOD(ticker.code, ticker.category, apiKey, false);
          let inserted = 0, updated = 0;
          const upsert = gatedUpsertStmt();
          const barStates = {};
          db.transaction(() => {
            for (const r of data.rows) {
              if (!r.date || !(strictNum(r.close) > 0)) continue;  // seri harga: close<=0 = cetakan rusak
              const existing = db.prepare('SELECT id FROM custom_ohlc WHERE trade_date=? AND code=?').get(r.date, ticker.code);
              const st = writeBarGated(upsert, ticker.code, r, data.source || 'external');
              barStates[st] = (barStates[st] || 0) + 1;
              if (existing) updated++; else inserted++;
            }
          })();

          const totalRows = db.prepare('SELECT COUNT(*) as c FROM custom_ohlc WHERE code=?').get(ticker.code)?.c || 0;
          const dateRange = db.prepare('SELECT MIN(trade_date) as first, MAX(trade_date) as last FROM custom_ohlc WHERE code=?').get(ticker.code);
          db.prepare('UPDATE custom_tickers SET rows=?, first_date=?, last_date=?, updated_at=datetime(\'now\') WHERE code=?')
            .run(totalRows, dateRange?.first || '', dateRange?.last || '', ticker.code);
          const pullFrontier = pullLog.frontierOf(data.rows || []);
          const pullStatus = pullLog.logPull(db, {
            code: ticker.code, source: String(data.source || 'external'), frontier: pullFrontier,
            rows: (data.rows || []).length, written: inserted + updated,
            endpoint: 'POST /custom/sync-stale', refDate: pullRef,
            status: (inserted + updated) > 0 ? 'ok' : 'no_data',
          });
          results.push({ code: ticker.code, inserted, updated, source: data.source, bar_states: barStates,
                         pull: { status: pullStatus, source_frontier_date: pullFrontier } });

          // Rate limit: 2s between requests
          await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
          pullLog.logPull(db, { code: ticker.code, source: null, frontier: null, rows: 0, written: 0,
            endpoint: 'POST /custom/sync-stale', refDate: pullRef, status: 'error', error: e.message });
          results.push({ code: ticker.code, error: e.message });
        }
      }
      res.json({ ok: true, synced: results.length, results });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Upload CSV — auto-detect Investing.com / Yahoo / generic format
  const multer = require('multer');
  const csvUpload = multer({ dest: '/tmp/csv-uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

  router.post('/custom/upload', csvUpload.single('file'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const code = (req.body.code || '').toUpperCase().trim();
      const name = (req.body.name || code).trim();
      const category = (req.body.category || 'custom').trim();
      const linkedSector = (req.body.linked_sector || '').trim();
      // Sama dengan /custom/upsert & /custom/replace: boleh ≤ 0 hanya untuk seri yang
      // dideklarasikan di utils/series-sign.js — upload CSV dulu membuang negatif tanpa
      // pengecualian (review sena R3), jadi seri makro lewat CSV kehilangan barisnya diam-diam.
      const signed = allowsNonPositive(code);
      let skippedNonpositive = 0, skippedInvalid = 0;

      if (!code) return res.status(400).json({ error: 'Ticker code required' });

      // Read file
      const fs = require('fs');
      let raw = fs.readFileSync(req.file.path, 'utf-8');
      fs.unlinkSync(req.file.path); // cleanup

      // Strip BOM
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      if (raw.startsWith('\xEF\xBB\xBF')) raw = raw.slice(3);

      // Check if frontend sent column mapping
      let colMap = null;
      try { colMap = JSON.parse(req.body.col_map || 'null'); } catch(e) {}
      const userSep = req.body.separator || null;
      const skipLines = parseInt(req.body.skip_lines) || 0;

      // Determine separator
      const sep = userSep === '\\t' ? '\t' : (userSep || null);

      const allLines = raw.split(/\r?\n/).filter(l => l.trim());
      const lines = allLines.slice(skipLines);
      if (lines.length < 2) return res.status(400).json({ error: 'File too short (after skipping ' + skipLines + ' lines)' });

      let rows = [];

      if (colMap && colMap.length && colMap.includes('Date') && colMap.includes('Close')) {
        // ── MODE: User-defined column mapping (AmiBroker-style) ──
        const dateIdx = colMap.indexOf('Date');
        const closeIdx = colMap.indexOf('Close');
        const openIdx = colMap.indexOf('Open');
        const highIdx = colMap.indexOf('High');
        const lowIdx = colMap.indexOf('Low');
        const volIdx = colMap.indexOf('Volume');

        // Parse numbers (handle various formats + strip % suffix)
        // null = bukan angka. Dulu mengembalikan 0, sehingga '-' dan sel kosong tidak bisa
        // dibedakan dari nilai 0 sungguhan (seri makro boleh 0, tapi bukan karena sel kosong).
        // Tanda minus ikut diterima, termasuk format ID "-1.234,56".
        function parseNum(s) {
          if (s === null || s === undefined) return null;
          s = String(s).replace(/"/g, '').replace(/%/g, '').trim();
          if (!s || s === '-' || s.toLowerCase() === 'null') return null;
          if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
          else s = s.replace(/,/g, '');
          const n = parseFloat(s);
          return Number.isFinite(n) ? n : null;
        }
        function parseVol(s) {
          if (!s || s === '-' || s === 'null') return 0;
          s = String(s).replace(/"/g, '').replace(/%/g, '').trim();
          let mult = 1;
          if (s.endsWith('B') || s.endsWith('b')) { mult = 1e9; s = s.slice(0, -1); }
          else if (s.endsWith('M') || s.endsWith('m')) { mult = 1e6; s = s.slice(0, -1); }
          else if (s.endsWith('K') || s.endsWith('k')) { mult = 1e3; s = s.slice(0, -1); }
          return parseNum(s) * mult;
        }
        function parseDate(d) {
          d = d.replace(/"/g, '').trim();
          // DD/MM/YYYY
          if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(d)) { const [dd, mm, yyyy] = d.split('/'); return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`; }
          // YYYY-MM-DD
          if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.substring(0, 10);
          // YYYY/MM/DD
          if (/^\d{4}\/\d{2}\/\d{2}/.test(d)) return d.substring(0, 10).replace(/\//g, '-');
          // DD-MM-YYYY
          if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(d)) { const [dd, mm, yyyy] = d.split('-'); return `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`; }
          // "Februari 2026" / "March 2025" (month name + year)
          const monthMap = {januari:'01',februari:'02',maret:'03',april:'04',mei:'05',juni:'06',juli:'07',agustus:'08',september:'09',oktober:'10',november:'11',desember:'12',
            january:'01',february:'02',march:'03',may:'05',june:'06',july:'07',august:'08',october:'10',december:'12'};
          const mMatch = d.match(/^(\w+)\s+(\d{4})$/i);
          if (mMatch) {
            const mKey = mMatch[1].toLowerCase();
            const mm = monthMap[mKey];
            if (mm) return `${mMatch[2]}-${mm}-01`;
          }
          // "Q1 2025", "Q2 2026" (quarterly)
          const qMatch = d.match(/^Q(\d)\s+(\d{4})$/i);
          if (qMatch) {
            const qm = {'1':'01','2':'04','3':'07','4':'10'}[qMatch[1]] || '01';
            return `${qMatch[2]}-${qm}-01`;
          }
          // "2025" (year only)
          if (/^\d{4}$/.test(d)) return `${d}-01-01`;
          // Fallback: JS Date parse
          const dt = new Date(d); if (!isNaN(dt)) return dt.toISOString().slice(0, 10);
          return '';
        }

        // Quote-aware CSV line splitter for specific separator
        function splitCSV(line, s) {
          const result = []; let current = '', inQ = false;
          for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') { inQ = !inQ; continue; }
            if (c === s && !inQ) { result.push(current.trim()); current = ''; continue; }
            current += c;
          }
          result.push(current.trim());
          return result;
        }

        // Skip header row if it looks like text
        const startRow = /[a-zA-Z]/.test(splitCSV(lines[0], sep || ',')[dateIdx] || '') ? 1 : 0;

        for (let i = startRow; i < lines.length; i++) {
          const cols = splitCSV(lines[i], sep || ',');
          if (cols.length <= Math.max(dateIdx, closeIdx)) continue;
          const date = parseDate(cols[dateIdx] || '');
          const close = parseNum(cols[closeIdx] !== undefined ? cols[closeIdx] : '');
          // close <= 0 ditolak HANYA untuk seri harga. Seri bertanda (deflasi/defisit/
          // kontraksi, lihat utils/series-sign.js) menyimpannya apa adanya (review sena R3).
          if (!date || close === null) { skippedInvalid++; continue; }
          if (!signed && !(close > 0)) { skippedNonpositive++; continue; }
          rows.push({
            date,
            open: openIdx >= 0 ? parseNum(cols[openIdx] || '') : close,
            high: highIdx >= 0 ? parseNum(cols[highIdx] || '') : close,
            low: lowIdx >= 0 ? parseNum(cols[lowIdx] || '') : close,
            close,
            volume: volIdx >= 0 ? parseVol(cols[volIdx] || '') : 0
          });
        }
      } else {
        // ── MODE: Legacy auto-detect (existing behavior) ──
        const header = parseCSVLine(lines[0]).map(h => h.replace(/[^\x20-\x7E]/g, '').replace(/"/g, '').trim().toLowerCase());
        const fmt = detectCSVFormat(header);
        if (!fmt) return res.status(400).json({
          error: 'Cannot detect CSV format. Use the column mapper to assign columns manually.',
          headers: header
        });

        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i]);
          if (cols.length < 4) continue;
          const parsed = parseRow(cols, fmt, header);
          if (!parsed || !parsed.date || parsed.close === null || parsed.close === undefined) { skippedInvalid++; continue; }
          if (!signed && !(parsed.close > 0)) { skippedNonpositive++; continue; }
          rows.push(parsed);
        }
      }

      if (!rows.length) return res.status(400).json({ ok: false,
        error: 'No valid rows parsed',
        rows_dropped: skippedNonpositive + skippedInvalid,
        rejected: { nonpositive: skippedNonpositive, invalid: skippedInvalid },
        allow_nonpositive: signed,
        hint: (!signed && skippedNonpositive)
          ? `semua baris close<=0; kalau ${code} seri bertanda, deklarasikan di server/utils/series-sign.js`
          : undefined });

      // Sort by date ascending
      rows.sort((a, b) => a.date.localeCompare(b.date));

      // Upsert into custom_ohlc — baris CSV berlabel 'csv' (satu seri satu sumber: kalau seri ini
      // nanti diisi rail lain, /custom/upsert menolak tanpa arsip, bukan mencampur diam-diam).
      const upsert = gatedUpsertStmt();
      const barStates = {};

      let inserted = 0, updated = 0;
      db.transaction(() => {
        for (const r of rows) {
          const existing = db.prepare('SELECT id FROM custom_ohlc WHERE trade_date=? AND code=?').get(r.date, code);
          const st = writeBarGated(upsert, code, r, 'csv');
          barStates[st] = (barStates[st] || 0) + 1;
          if (existing) updated++; else inserted++;
        }
      })();

      // Update custom_tickers metadata (with linked_sector)
      const totalRows = db.prepare('SELECT COUNT(*) as c FROM custom_ohlc WHERE code=?').get(code)?.c || 0;
      const dateRange = db.prepare('SELECT MIN(trade_date) as first, MAX(trade_date) as last FROM custom_ohlc WHERE code=?').get(code);

      db.prepare(
        `INSERT INTO custom_tickers(code, name, category, source, rows, first_date, last_date, role, linked_sector, updated_at)
         VALUES(?, ?, ?, 'csv', ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(code) DO UPDATE SET
         name=excluded.name, category=excluded.category, rows=excluded.rows,
         first_date=excluded.first_date, last_date=excluded.last_date,
         role=CASE WHEN excluded.role!='' THEN excluded.role ELSE role END,
         linked_sector=CASE WHEN excluded.linked_sector!='' THEN excluded.linked_sector ELSE linked_sector END,
         updated_at=datetime('now')`
      ).run(code, name, category, totalRows, dateRange?.first || '', dateRange?.last || '', (req.body.role || '').trim(), linkedSector);

      res.json({
        ok: true, code, name, category,
        format: colMap ? 'custom_mapped' : 'auto_detect',
        inserted, updated,
        rows_parsed: rows.length,
        rows_dropped: skippedNonpositive + skippedInvalid,
        rejected: { nonpositive: skippedNonpositive, invalid: skippedInvalid },
        allow_nonpositive: signed,
        gate_warning: (skippedNonpositive + skippedInvalid)
          ? `ditolak gerbang: ${skippedNonpositive} baris close<=0 (seri harga wajib >0); ${skippedInvalid} baris bukan angka`
          : null,
        bar_states: barStates,
        total_rows: totalRows,
        date_range: { first: dateRange?.first, last: dateRange?.last }
      });

    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Get custom ticker OHLC data (for preview)
  // `?sessions=regular` = sesi bursa saja (bar Sabtu/Minggu dibuang — kolom `session` generated).
  // Default `all` disengaja: pembaca lama (rail yang memverifikasi jumlah bar hasil tulis)
  // harus tetap melihat SELURUH baris tersimpan, bukan subset.
  router.get('/custom/ohlc/:code', (req, res) => {
    try {
      const code = req.params.code.toUpperCase().trim();
      const limit = parseInt(req.query.limit) || 0;
      const sessions = String(req.query.sessions || 'all').toLowerCase();
      let sql = 'SELECT * FROM custom_ohlc WHERE code=?';
      if (sessions === 'regular') sql += ` AND ${REGULAR_SESSION}`;
      sql += ' ORDER BY trade_date';
      if (limit) sql += ' LIMIT ' + limit;
      const rows = db.prepare(sql).all(code);
      res.json(rows);
    } catch (e) { res.json([]); }
  });

  // ── CSV Format Detection ──
  function detectCSVFormat(header) {
    const h = header.join('|');
    // Investing.com (Indonesian): Tanggal, Terakhir, Pembukaan, Tertinggi, Terendah, Vol.
    if (h.includes('tanggal') && h.includes('terakhir')) {
      return { type: 'investing_id',
        date: header.indexOf('tanggal'), close: header.indexOf('terakhir'),
        open: header.indexOf('pembukaan'), high: header.indexOf('tertinggi'),
        low: header.indexOf('terendah'), vol: header.findIndex(h => h.startsWith('vol')) };
    }
    // Investing.com (English): Date, Price, Open, High, Low, Vol.
    if (h.includes('date') && h.includes('price') && h.includes('open')) {
      return { type: 'investing_en',
        date: header.indexOf('date'), close: header.indexOf('price'),
        open: header.indexOf('open'), high: header.indexOf('high'),
        low: header.indexOf('low'), vol: header.findIndex(h => h.startsWith('vol')) };
    }
    // Yahoo Finance: Date, Open, High, Low, Close, Adj Close, Volume
    if (h.includes('date') && h.includes('close') && h.includes('adj close')) {
      return { type: 'yahoo',
        date: header.indexOf('date'), close: header.indexOf('adj close') >= 0 ? header.indexOf('adj close') : header.indexOf('close'),
        open: header.indexOf('open'), high: header.indexOf('high'),
        low: header.indexOf('low'), vol: header.indexOf('volume') };
    }
    // Generic: Date, Open, High, Low, Close, Volume
    if (h.includes('date') && h.includes('close')) {
      return { type: 'generic',
        date: header.indexOf('date'), close: header.indexOf('close'),
        open: header.indexOf('open'), high: header.indexOf('high'),
        low: header.indexOf('low'), vol: header.indexOf('volume') >= 0 ? header.indexOf('volume') : header.findIndex(h => h.startsWith('vol')) };
    }
    return null;
  }

  // ── Parse CSV line (handle quoted fields) ──
  function parseCSVLine(line) {
    const result = [];
    let current = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuote = !inQuote; continue; }
      if ((c === ',' || c === ';' || c === '\t') && !inQuote) { result.push(current.trim()); current = ''; continue; }
      current += c;
    }
    result.push(current.trim());
    return result;
  }

  // ── Parse row based on format ──
  function parseRow(cols, fmt, header) {
    try {
      const raw = {
        date: cols[fmt.date] || '',
        open: cols[fmt.open] || '',
        high: cols[fmt.high] || '',
        low: cols[fmt.low] || '',
        close: cols[fmt.close] || '',
        vol: fmt.vol >= 0 ? (cols[fmt.vol] || '0') : '0'
      };

      // Parse date
      let date = '';
      const d = raw.date.replace(/"/g, '').trim();
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(d)) {
        // DD/MM/YYYY (Investing.com)
        const [dd, mm, yyyy] = d.split('/');
        date = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      } else if (/^\d{4}-\d{2}-\d{2}/.test(d)) {
        // YYYY-MM-DD (Yahoo, generic)
        date = d.substring(0, 10);
      } else if (/^\w+ \d{1,2}, \d{4}$/.test(d)) {
        // "Mar 13, 2026" (Investing English)
        const dt = new Date(d);
        if (!isNaN(dt)) date = dt.toISOString().slice(0, 10);
      } else {
        // Try Date parse
        const dt = new Date(d);
        if (!isNaN(dt)) date = dt.toISOString().slice(0, 10);
      }

      if (!date) return null;

      // Parse numbers (handle "1.234,56" Investing ID format + "1,234.56" EN format)
      // null = bukan angka; lihat catatan di parseNum jalur col_map. Minus ikut diterima.
      function parseNum(s) {
        if (s === null || s === undefined) return null;
        s = String(s).replace(/"/g, '').trim();
        if (!s || s === '-' || s.toLowerCase() === 'null') return null;
        // Detect Investing ID format: dot as thousand sep, comma as decimal
        // "15.690,50" or "15,52"
        if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) {
          // European/ID format: 1.234.567,89
          s = s.replace(/\./g, '').replace(',', '.');
        } else {
          // EN format: 1,234,567.89
          s = s.replace(/,/g, '');
        }
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : null;
      }

      // Parse volume (handle "1,03M", "870,54K", "1.03M", "870.54K")
      function parseVol(s) {
        if (!s || s === '-' || s === 'null') return 0;
        s = String(s).replace(/"/g, '').trim();
        let mult = 1;
        if (s.endsWith('B') || s.endsWith('b')) { mult = 1e9; s = s.slice(0, -1); }
        else if (s.endsWith('M') || s.endsWith('m')) { mult = 1e6; s = s.slice(0, -1); }
        else if (s.endsWith('K') || s.endsWith('k')) { mult = 1e3; s = s.slice(0, -1); }
        return parseNum(s) * mult;
      }

      return {
        date,
        open: parseNum(raw.open),
        high: parseNum(raw.high),
        low: parseNum(raw.low),
        close: parseNum(raw.close),
        volume: parseVol(raw.vol)
      };
    } catch (e) { return null; }
  }

  // ═══ MARKET REGIME — Top-Down Framework ═══
  router.get('/market-regime', (req, res) => {
    try {
      const today = latestIdxDate();

      // ── Level 1: Global Sentiment (custom_tickers with category=global_index) ──
      let global = [];
      try {
        const globalTickers = db.prepare("SELECT code, name, category, linked_sector FROM custom_tickers WHERE category='global_index' ORDER BY code").all();
        global = globalTickers.map(t => {
          const rows = db.prepare(`SELECT trade_date, close FROM custom_ohlc WHERE code=? AND ${REGULAR_SESSION} ORDER BY trade_date DESC LIMIT 60`).all(t.code);
          if (!rows.length) return { code: t.code, name: t.name || t.code };
          const now = rows[0].close;
          const d1 = rows[1] ? rows[1].close : now;
          // rows[0] = bar terbaru, jadi "N sesi lalu" = rows[N]. Sebelumnya rows[4]/rows[19]
          // = 4/19 sesi tapi dilabeli "5D"/"20D" (off-by-one, temuan review t_c3d94014).
          // Konvensi mayoritas berkas ini + market.js (back(5)=asc[n-6]) = 5/20 sesi.
          const d5 = rows[5] ? rows[5].close : now;
          const d20 = rows[20] ? rows[20].close : now;
          return {
            code: t.code, name: t.name || t.code, close: now, date: rows[0].trade_date,
            chg_pct: d1 > 0 ? Math.round((now - d1) / d1 * 10000) / 100 : 0,
            chg_5d: d5 > 0 ? Math.round((now - d5) / d5 * 10000) / 100 : 0,
            chg_20d: d20 > 0 ? Math.round((now - d20) / d20 * 10000) / 100 : 0
          };
        });
      } catch (e) {}

      // ── Level 2: Commodity Cycle (custom_tickers with category=commodity) ──
      let commodities = [];
      let commodityFreshCtx = null;
      try {
        const cmdTickers = db.prepare("SELECT code, name, category, linked_sector, ohlc_mode FROM custom_tickers WHERE category='commodity' ORDER BY code").all();
        // Kesegaran per seri (kanban t_61ccbdbe) — satu implementasi dengan /api/commodities.
        const freshCtx = freshnessUtil.buildContext(db);
        commodityFreshCtx = freshCtx;
        commodities = cmdTickers.map(t => {
          const rows = db.prepare(`SELECT trade_date, close FROM custom_ohlc WHERE code=? AND ${REGULAR_SESSION} ORDER BY trade_date DESC LIMIT 60`).all(t.code);
          // no_series: tidak ada seri harga (≤1 observasi). Dipakai UI untuk menulis
          // "tanpa seri harga" alih-alih menampilkan level tunggal/0 seolah tren
          // (COKING_COAL & KRAFT_PULP: tidak ada kandidat di investing, t_6d027516 r5).
          // Tanpa bar: keadaan 'no_series' dihitung util yang sama, bukan ditebak pemanggil.
          if (!rows.length) {
            const nf = freshnessUtil.seriesFreshness(freshCtx, null, t.code);
            return { code: t.code, name: t.name || t.code, linked_sector: t.linked_sector || '', points: 0, no_series: true, ohlc_mode: t.ohlc_mode || null, stale: nf.stale, lag_sessions: nf.lag_sessions, lag_capped: nf.lag_capped, ref_date: nf.ref_date, stale_date: nf.last_date, expected_lag_sessions: nf.expected_lag_sessions, excess_sessions: nf.excess_sessions, state: nf.state };
          }
          const now = rows[0].close;
          // rows[0] = bar terbaru -> "5/20 sesi lalu" = rows[5]/rows[20] (off-by-one t_c3d94014).
          const d5 = rows[5] ? rows[5].close : now;
          const d20 = rows[20] ? rows[20].close : now;
          const fresh = freshnessUtil.seriesFreshness(freshCtx, freshnessUtil.lastRegularBarDate(rows), t.code);
          return {
            code: t.code, name: t.name || t.code, close: now, points: rows.length,
            no_series: rows.length < 2,
            // ohlc_mode: hasil gerbang per-seri (t_565e76fd). 'price_only' = O/H/L seri
            // sengaja NULL (>=50% bar beku/mustahil di sumber) -> UI gambar GARIS, bukan candle.
            // null = belum dinilai (baris lama) -> UI boleh jatuh ke aturan lamanya.
            ohlc_mode: t.ohlc_mode || null,
            date: rows[0].trade_date,
            // stale=true: `close` di atas milik bar LAMA (TIN 15 Okt saat sesi terakhir 19 Okt).
            // Nilainya TETAP dikirim (chart/rail memakainya), tapi UI wajib menampilkan "—"
            // + tanggal, bukan level itu sebagai harga terkini.
            stale: fresh.stale,
            lag_sessions: fresh.lag_sessions,
            lag_capped: fresh.lag_capped,
            ref_date: fresh.ref_date,
            stale_date: fresh.last_date,
            // Ekspektasi per seri (t_b234606a): 'excess' = alarm, 'by_source' = sumber memang
            // lambat (tampil netral, tanpa kata "basi"), 'na' = tidak dideklarasikan.
            expected_lag_sessions: fresh.expected_lag_sessions,
            excess_sessions: fresh.excess_sessions,
            state: fresh.state,
            chg_5d: d5 > 0 ? Math.round((now - d5) / d5 * 10000) / 100 : 0,
            chg_20d: d20 > 0 ? Math.round((now - d20) / d20 * 10000) / 100 : 0,
            linked_sector: t.linked_sector || ''
          };
        });
      } catch (e) {}

      // ── Level 3: IDX Market ──
      let idx = { ihsg: null, foreign_flow: null, breadth: null, breadth_history: [] };

      // IHSG
      try {
        const ihsgRows = db.prepare("SELECT trade_date, close FROM idx_indices WHERE index_code='COMPOSITE' ORDER BY trade_date DESC LIMIT 61").all();
        if (ihsgRows.length >= 21) {
          const now = ihsgRows[0].close;
          const d1 = ihsgRows[1] ? ihsgRows[1].close : now;
          // rows[0] = bar terbaru -> "N sesi lalu" = rows[N] (off-by-one t_c3d94014).
          const d5 = ihsgRows[5] ? ihsgRows[5].close : now;
          const d20 = ihsgRows[20] ? ihsgRows[20].close : now;
          const chg1d = d1 > 0 ? Math.round((now - d1) / d1 * 10000) / 100 : 0;
          const chg20 = d20 > 0 ? Math.round((now - d20) / d20 * 10000) / 100 : 0;
          let regime = 'sideways';
          if (chg20 > 5) regime = 'bull';
          else if (chg20 < -5) regime = 'bear';
          else if (chg20 > 2) regime = 'mild_bull';
          else if (chg20 < -2) regime = 'mild_bear';
          idx.ihsg = {
            level: now, regime, date: ihsgRows[0].trade_date,
            chg_1d: chg1d,
            chg_5d: d5 > 0 ? Math.round((now - d5) / d5 * 10000) / 100 : 0,
            chg_20d: chg20
          };
        }
      } catch (e) {}

      // Foreign flow aggregate — dari idx_daily (per saham), BUKAN foreign_trading.
      // foreign_trading berhenti 2026-09-30 sehingga angka 30 Sep tampil sebagai "hari ini".
      try {
        const ffDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT 20').all().map(r => r.trade_date);
        if (ffDates.length) {
          const rows = db.prepare(`SELECT trade_date, SUM((foreign_buy-foreign_sell)*close) AS net
                                   FROM idx_daily WHERE trade_date >= ? AND close>0 GROUP BY trade_date`)
                           .all(ffDates[ffDates.length - 1]);
          const netByDate = {};
          rows.forEach(r => { netByDate[r.trade_date] = r.net || 0; });
          const ordered = ffDates.filter(d => netByDate[d] !== undefined);
          if (ordered.length) {
            idx.foreign_flow = {
              as_of: ordered[0],
              net_today: netByDate[ordered[0]] || 0,
              net_5d: ordered.slice(0, 5).reduce((a, d) => a + netByDate[d], 0),
              net_20d: ordered.slice(0, 20).reduce((a, d) => a + netByDate[d], 0)
            };
          }
        }
      } catch (e) {}

      // ── Tape: likuiditas & ekstremitas (ARA/ARB) — dihitung dari idx_daily ──
      try {
        const tDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT 21').all().map(r => r.trade_date);
        if (tDates.length >= 21) {
          const vals = {};
          db.prepare(`SELECT trade_date, SUM(value) AS v, COUNT(*) AS n FROM idx_daily
                      WHERE trade_date >= ? AND close > 0 GROUP BY trade_date`)
            .all(tDates[tDates.length - 1]).forEach(r => { vals[r.trade_date] = r.v || 0; });
          const ordered = tDates.filter(d => vals[d] !== undefined);
          const vToday = vals[ordered[0]] || 0;
          const prev20 = ordered.slice(1, 21).map(d => vals[d]).filter(v => v > 0);
          const vMa20 = prev20.length ? prev20.reduce((a, b) => a + b, 0) / prev20.length : 0;

          // ARA/ARB memakai tangga IDX yang sama dengan mesin backtest.
          const rows = db.prepare(`SELECT close, prev_close FROM idx_daily
                                   WHERE trade_date=? AND close>0 AND prev_close>0`).all(ordered[0]);
          let ara = 0, arb = 0, adv = 0, dec = 0;
          for (const r of rows) {
            const chg = (r.close - r.prev_close) * 1.0 / r.prev_close;
            if (chg > 0) adv++; else if (chg < 0) dec++;
            // Batas tier ARA: 200 / 5.000 (diverifikasi dari tape 23 Okt 2026, lihat
            // server/routes/backtest.js::araPct). Kode lama memakai 500 sehingga band
            // 200-500 dihitung memakai plafon 35% dan statistik ARA terlalu kecil.
            const araPct = r.prev_close < 200 ? 0.35 : r.prev_close <= 5000 ? 0.25 : 0.20;
            if (chg >= araPct * 0.995) ara++;
            if (chg <= -0.15 * 0.995) arb++;
          }
          idx.tape = {
            as_of: ordered[0],
            value_today: vToday,
            value_ma20: vMa20,
            value_ratio: vMa20 > 0 ? Math.round((vToday / vMa20) * 100) / 100 : null,
            advancers: adv, decliners: dec,
            ara: ara, arb: arb
          };
        }
      } catch (e) {}

      // Market breadth
      try {
        if (today) {
          // Harus sama dengan aturan breadth_history: close>0, minimal 50 bar.
          // Sebelumnya volume>0 + 20 bar -> total 834 vs 964 di histori (persen tak sebanding).
          const stocks = db.prepare('SELECT code, close FROM idx_daily WHERE trade_date=? AND close > 0').all(today);
          let aboveMA20 = 0, aboveMA50 = 0, aboveMA200 = 0, total = 0, newHigh = 0, newLow = 0;

          for (const s of stocks) {
            // ca_adj: harga terkoreksi CA — breadth "di atas MA" tidak boleh berubah
            // hanya karena split. Ahli: MA200 butuh deret kontinu.
            const hist = db.prepare('SELECT ca_adj(close, code, trade_date) AS ac FROM idx_daily WHERE code=? AND close>0 ORDER BY trade_date DESC LIMIT 200').all(s.code);
            if (hist.length < 50) continue;
            total++;
            const closes = hist.map(r => r.ac).reverse();
            const n = closes.length;
            const price = closes[n - 1];
            const ma20 = n >= 20 ? closes.slice(n - 20).reduce((a, b) => a + b, 0) / 20 : null;
            const ma50 = n >= 50 ? closes.slice(n - 50).reduce((a, b) => a + b, 0) / 50 : null;
            const ma200 = n >= 200 ? closes.slice(n - 200).reduce((a, b) => a + b, 0) / 200 : null;
            if (ma20 && price > ma20) aboveMA20++;
            if (ma50 && price > ma50) aboveMA50++;
            if (ma200 && price > ma200) aboveMA200++;
            const lookback = Math.min(n, 250);
            const maxP = Math.max(...closes.slice(n - lookback));
            const minP = Math.min(...closes.slice(n - lookback));
            if (price >= maxP * 0.98) newHigh++;
            if (price <= minP * 1.02) newLow++;
          }

          idx.breadth = {
            total,
            pct_above_ma20: total > 0 ? Math.round(aboveMA20 / total * 100) : 0,
            pct_above_ma50: total > 0 ? Math.round(aboveMA50 / total * 100) : 0,
            pct_above_ma200: total > 0 ? Math.round(aboveMA200 / total * 100) : 0,
            new_high: newHigh, new_low: newLow
          };
        }
      } catch (e) {}

      // ── Breadth history 30 sesi (sebelumnya selalu [] — tidak pernah diisi) ──
      // Dihitung dari idx_daily dengan rolling sum, bukan N+1 query per saham.
      try {
        const dates230 = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT 231').all().map(r => r.trade_date);
        if (dates230.length >= 60) {
          const from = dates230[dates230.length - 1];
          const rows = db.prepare('SELECT code, trade_date, ca_adj(close, code, trade_date) AS ac FROM idx_daily WHERE trade_date >= ? AND close > 0 ORDER BY code, trade_date').all(from);
          const byCode = {};
          for (const r of rows) (byCode[r.code] = byCode[r.code] || []).push(r);
          const agg = {};
          for (const code of Object.keys(byCode)) {
            const arr = byCode[code];
            let s20 = 0, s50 = 0;
            for (let i = 0; i < arr.length; i++) {
              s20 += arr[i].ac; if (i >= 20) s20 -= arr[i - 20].ac;
              s50 += arr[i].ac; if (i >= 50) s50 -= arr[i - 50].ac;
              if (i < 50) continue;                       // butuh MA50 lebih dulu
              const d = arr[i].trade_date;
              if (!agg[d]) agg[d] = { a20: 0, a50: 0, n: 0 };
              agg[d].n++;
              if (arr[i].ac > s20 / 20) agg[d].a20++;
              if (arr[i].ac > s50 / 50) agg[d].a50++;
            }
          }
          idx.breadth_history = Object.keys(agg).sort().slice(-30).map(d => ({
            date: d,
            pct_above_ma20: agg[d].n ? Math.round(agg[d].a20 / agg[d].n * 100) : 0,
            pct_above_ma50: agg[d].n ? Math.round(agg[d].a50 / agg[d].n * 100) : 0,
            total: agg[d].n,
          }));
        }
      } catch (e) { }

      // ── Level 4: Sector Ranking ──
      let sectors = [];
      try {
        // Dihitung dari idx_daily + company_profiles.sector.
        // Sumber lama (sectoral_movement) punya DUA cacat: berhenti 2026-09-30, dan
        // change_pct-nya kumulatif (Technology -44%, Composite -24,7%) bukan harian.
        // Blok lama lalu menghitung persen-dari-persen -> mis. "+104,26% sehari".
        const SECTOR_MAP = {
          'IDX Sector Basic Materials': 'Barang Baku',
          'IDX Sector Industrials': 'Perindustrian',
          'IDX Sector Consumer Cyclicals': 'Barang Konsumen Non-Primer',
          'IDX Sector Consumer Non-Cyclicals': 'Barang Konsumen Primer',
          'IDX Sector Energy': 'Energi',
          'IDX Sector Financials': 'Keuangan',
          'IDX Sector Healthcare': 'Kesehatan',
          'IDX Sector Infrastructures': 'Infrastruktur',
          'IDX Sector Properties & Real Estate': 'Properti & Real Estat',
          'IDX Sector Technology': 'Teknologi',
          'IDX Sector Transportation & Logistic': 'Transportasi & Logistik'
        };
        const INV = {};
        Object.keys(SECTOR_MAP).forEach(k => { INV[SECTOR_MAP[k]] = k; });
        const ihsgDailyChg = idx.ihsg ? idx.ihsg.chg_1d : 0;

        const sDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT 21').all().map(r => r.trade_date);
        const d20 = sDates.length >= 21 ? sDates[20] : null;

        if (today) {
          const perfRows = db.prepare(`
            SELECT cp.sector AS sector, d.code, d.close, d.prev_close, d.value AS val,
                   p.close AS close20,
                   ca_adj(d.close, d.code, d.trade_date) AS ac,
                   ca_adj(p.close, p.code, p.trade_date) AS ac20,
                   ((d.foreign_buy - d.foreign_sell) * d.close) AS fnet_day
            FROM idx_daily d
            JOIN company_profiles cp ON d.code = cp.code
            LEFT JOIN idx_daily p ON p.code = d.code AND p.trade_date = ?
            WHERE d.trade_date = ? AND d.close > 0
              AND cp.sector IS NOT NULL AND cp.sector != ''
          `).all(d20, today);

          // Foreign net 20 sesi per sektor (satu query, bukan per sektor).
          const fnet20 = {};
          if (d20) {
            db.prepare(`SELECT cp.sector AS sector, SUM((d.foreign_buy-d.foreign_sell)*d.close) AS fnet
                        FROM idx_daily d JOIN company_profiles cp ON d.code=cp.code
                        WHERE d.trade_date >= ? AND d.close > 0
                        GROUP BY cp.sector`).all(d20)
              .forEach(r => { fnet20[r.sector] = r.fnet || 0; });
          }

          const byS = {};
          for (const r of perfRows) {
            const b = byS[r.sector] || (byS[r.sector] = { n: 0, d1: 0, d20: 0, n20: 0, top: [] });
            b.n++;
            if (r.prev_close > 0) b.d1 += (r.close - r.prev_close) * 1.0 / r.prev_close * 100;
            if (r.ac20 > 0 && r.ac > 0) { b.d20 += (r.ac - r.ac20) * 1.0 / r.ac20 * 100; b.n20++; }
            b.top.push({ code: r.code, val: r.val || 0 });
          }

          sectors = Object.keys(byS).map(name => {
            const b = byS[name];
            b.top.sort((x, y) => y.val - x.val);
            const chg = b.n ? b.d1 / b.n : 0;
            const c20 = b.n20 ? b.d20 / b.n20 : 0;
            return {
              sector: INV[name] || name,
              cp_sector: name,
              chg_pct: Math.round(chg * 100) / 100,
              chg_20d: Math.round(c20 * 100) / 100,
              rs_vs_ihsg: Math.round((chg - ihsgDailyChg) * 100) / 100,
              fnet_20d: fnet20[name] || 0,
              top_stocks: b.top.slice(0, 5).map(x => x.code),
              members: b.n,
              method: 'equal_weight'
            };
          }).sort((a, b) => (b.rs_vs_ihsg || 0) - (a.rs_vs_ihsg || 0));
        }
      } catch (e) {}

      // ── Level 1.5: Macro Signals (VIX, DXY, US10Y, BDI, USDIDR) ──
      let macro_signals = null;
      try {
        const macroTickers = db.prepare("SELECT code, name, category FROM custom_tickers WHERE category IN ('macro','currency') ORDER BY code").all();
        if (macroTickers.length) {
          const signals = [];
          let bullPoints = 0, bearPoints = 0;

          // Macro interpretation rules
          const MACRO_RULES = {
            'VIX':    { emoji: '😨', high: 25, low: 15, label: 'Fear Index',      highBear: true },
            'DXY':    { emoji: '💵', high: 105, low: 100, label: 'Dollar Strength', highBear: true },
            'US10Y':  { emoji: '📈', high: 4.5, low: 3.5, label: '10Y Yield',      highBear: true },
            'BDI':    { emoji: '🚢', high: 2000, low: 1000, label: 'Baltic Dry',   highBear: false },
            'BAID':   { emoji: '🚢', high: 2000, low: 1000, label: 'Baltic Dirty', highBear: false },
            'USDIDR': { emoji: '💱', high: 16500, low: 15500, label: 'USD/IDR',    highBear: true },
            // Ambang di bawah ini DIPATOK, bukan diturunkan dari jendela data 4 bulan.
            // Tanpa ini, rule default memakai now*1.1/now*0.9 sehingga label berubah
            // mengikuti rentangnya sendiri (narrative fitting).
            'REAL10Y':    { emoji: '🏦', high: 2.0,  low: 0.5,  label: 'Real Yield 10Y',  highBear: true },
            'SLOPE10Y2Y': { emoji: '📐', high: 1.5,  low: 0.0,  label: '10Y-2Y Spread',   highBear: false },
            'HYOAS':      { emoji: '🧯', high: 5.0,  low: 3.5,  label: 'HY OAS',          highBear: true },
            'USDCNY':     { emoji: '🇨🇳', high: 7.3,  low: 6.9,  label: 'USD/CNY',         highBear: true }
          };

          macroTickers.forEach(t => {
            // Blok ini dulu membaca custom_ohlc TANPA filter sesi, jadi USDIDR/USDCNY
            // (31 bar Minggu masing-masing) menggeser jendela 5D/20D. Disamakan dengan
            // jalur lain: sesi reguler saja. Indeks juga rows[5]/rows[20], bukan rows[4]/rows[19].
            const rows = db.prepare(`SELECT trade_date, close FROM custom_ohlc WHERE code=? AND ${REGULAR_SESSION} ORDER BY trade_date DESC LIMIT 30`).all(t.code);
            if (!rows.length) return;
            const now = rows[0].close;
            const d5 = rows[5] ? rows[5].close : now;
            const d20 = rows[20] ? rows[20].close : now;
            const chg5 = d5 > 0 ? Math.round((now - d5) / d5 * 10000) / 100 : 0;
            const chg20 = d20 > 0 ? Math.round((now - d20) / d20 * 10000) / 100 : 0;
            const rule = MACRO_RULES[t.code] || { emoji: '📊', high: now * 1.1, low: now * 0.9, label: t.name || t.code, highBear: false };
            // Semua angka di teks sinyal ditulis 2 desimal (jangan biarkan float mentah
            // seperti 556.887465-680.6402350000001 bocor ke UI).
            const f2 = (v) => Number(v).toFixed(2);

            let bull = 0, bear = 0, detail = '';
            if (rule.highBear) {
              // High = bearish (VIX, DXY, US10Y, USDIDR)
              if (now > rule.high) { bear = 1; detail = 'Above ' + f2(rule.high) + ' — bearish'; }
              else if (now < rule.low) { bull = 1; detail = 'Below ' + f2(rule.low) + ' — bullish'; }
              else { detail = 'Neutral range (' + f2(rule.low) + '-' + f2(rule.high) + ')'; }
              // Momentum hanya MENENTUKAN arah bila level netral; tidak boleh menambah
              // arah berlawanan (dulu HYOAS bisa bull=1 DAN bear=1 sekaligus).
              if (chg5 > 3) { if (!bull && !bear) bear = 1; detail += ', rising fast'; }
              else if (chg5 < -3) { if (!bull && !bear) bull = 1; detail += ', falling fast'; }
            } else {
              // High = bullish (BDI)
              if (now > rule.high) { bull = 1; detail = 'Above ' + f2(rule.high) + ' — bullish'; }
              else if (now < rule.low) { bear = 1; detail = 'Below ' + f2(rule.low) + ' — bearish'; }
              else { detail = 'Neutral range (' + f2(rule.low) + '-' + f2(rule.high) + ')'; }
              if (chg5 > 3) { if (!bull && !bear) bull = 1; detail += ', rising'; }
              else if (chg5 < -3) { if (!bull && !bear) bear = 1; detail += ', falling'; }
            }

            bullPoints += bull;
            bearPoints += bear;
            signals.push({ code: t.code, emoji: rule.emoji, value: now, detail: rule.label + ': ' + detail, bull, bear, chg_5d: chg5, chg_20d: chg20 });
          });

          macro_signals = { signals, bull_points: bullPoints, bear_points: bearPoints };
        }
      } catch (e) {}

      // Ringkasan kesegaran per seri (kanban t_61ccbdbe) — klien bisa membaca siapa yang
      // tertinggal tanpa menebak dari tanggal. `commodities[].stale` tetap sumber detailnya.
      const commodityFreshness = freshnessUtil.summarize(commodityFreshCtx, commodities.map(c => ({ code: c.code, freshness: c })));

      res.json({ date: today, global, commodities, idx, sectors, macro_signals, commodity_freshness: commodityFreshness });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ YIELD CURVE — kurva imbal hasil SUN, 11 tenor (kanban t_b042b106) ═══
  // Sebelum ini hanya ID10Y yang pernah dibaca dari custom_ohlc; 10 tenor lain tersimpan
  // tanpa route. Modulnya murni baca (tidak menulis baris, tidak menyimpan slope) dan
  // menegakkan "satu tanggal untuk satu kurva" — lihat server/utils/yield-curve.js.
  router.get('/yield-curve', (req, res) => {
    try {
      const yieldCurve = require('../utils/yield-curve');
      res.json(yieldCurve.buildYieldCurve(db));
    } catch (e) { res.json({ error: e.message }); }
  });

  // ═══ REGIME-WEIGHTS — return weight profile based on current market regime ═══
  router.get('/regime-weights', (req, res) => {
    try {
      // Detect IHSG regime
      let regime = 'sideways';
      let chg20 = 0;
      try {
        const ihsgRows = db.prepare("SELECT close FROM idx_indices WHERE index_code='COMPOSITE' ORDER BY trade_date DESC LIMIT 25").all();
        if (ihsgRows.length >= 20) {
          const now = ihsgRows[0].close;
          const d20 = ihsgRows[19].close;
          chg20 = d20 > 0 ? Math.round((now - d20) / d20 * 10000) / 100 : 0;
          if (chg20 > 5) regime = 'bull';
          else if (chg20 < -5) regime = 'bear';
          else if (chg20 > 2) regime = 'mild_bull';
          else if (chg20 < -2) regime = 'mild_bear';
        }
      } catch (e) {}

      // Macro shift: check VIX/DXY for additional context
      let macroShift = 0;
      try {
        const vixRows = db.prepare(`SELECT close FROM custom_ohlc WHERE code='VIX' AND ${REGULAR_SESSION} ORDER BY trade_date DESC LIMIT 1`).all();
        if (vixRows.length && vixRows[0].close > 25) macroShift -= 1; // high fear
        if (vixRows.length && vixRows[0].close < 15) macroShift += 1; // low fear
      } catch (e) {}

      // Weight profiles per regime (heuristic — to be validated via Walk Forward)
      const REGIME_WEIGHTS = {
        bull:      { fundamental: 25, valuation: 15, momentum: 30, demand: 15, foreign: 15 },
        mild_bull: { fundamental: 25, valuation: 20, momentum: 25, demand: 15, foreign: 15 },
        sideways:  { fundamental: 25, valuation: 25, momentum: 15, demand: 20, foreign: 15 },
        mild_bear: { fundamental: 30, valuation: 25, momentum: 5,  demand: 20, foreign: 20 },
        bear:      { fundamental: 30, valuation: 30, momentum: 0,  demand: 15, foreign: 25 }
      };

      const weights = REGIME_WEIGHTS[regime] || REGIME_WEIGHTS.sideways;

      res.json({
        ok: true,
        regime,
        ihsg_chg_20d: chg20,
        macro_shift: macroShift,
        weights
      });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });
  // financial_ratios mencampur satuan: sebelum 2024 roe/roa disimpan sebagai
  // pecahan (0.15), sesudahnya persen (21.45). npm juga tidak konsisten
  // (laba disetahunkan dibagi sales YTD), jadi dihitung ulang dari profit/sales.
  const sdNormPct = v => (v == null ? null : (Math.abs(v) <= 1 ? Math.round(v * 10000) / 100 : v));

  router.get('/stock-detail/:code', (req, res) => {
    try {
      const code = req.params.code.toUpperCase().trim();
      if (!code) return res.status(400).json({ error: 'No code' });

      // Get full price history (adjusted)
      const cas = db.prepare(`SELECT * FROM corporate_actions WHERE code=? AND status='confirmed' ORDER BY ex_date DESC`).all(code);
      const raw = db.prepare('SELECT trade_date,code,name,open_price,high,low,close,prev_close,volume,value,frequency,foreign_buy,foreign_sell,bid,bid_vol,offer,offer_vol,listed_shares,tradeable_shares FROM idx_daily WHERE code=? AND close>0 ORDER BY trade_date').all(code);
      if (!raw.length) return res.json({ error: 'No data for ' + code, code });

      // Penyesuaian aksi korporasi: SATU implementasi untuk chart dan backtest
      // (server/utils/price-adjust.js, sumber data tabel ca_factors).
      const caFactors = loadFactors(db);
      const data = raw.map(r => ({ ...r, fnet: (r.foreign_buy - r.foreign_sell) * r.close, fnet_shares: r.foreign_buy - r.foreign_sell }));
      adjustRows(data, caFactors[code], { volumeFields: { volume: 'avol' } });
      // corporate_actions hanya fallback kalau kode ini belum ada di ca_factors —
      // memakai keduanya = event yang sama dihitung dua kali (RAJA 0,2×0,2=0,04).
      const effCas = fallbackRatioActions(caFactors[code], cas);
      for (const r of data) {
        let f = 1;
        for (const ca of effCas) { if (r.trade_date < ca.ex_date) f *= (1 / ca.ratio); }
        if (f !== 1) { r.ac = Math.round(r.ac * f); r.ao = Math.round(r.ao * f); r.ah = Math.round(r.ah * f); r.al = Math.round(r.al * f); }
      }
      const detectedCA = (caFactors[code] || []).map(f => ({ ex_date: f.ex_date, factor: f.factor, basis: 'ca_factors' }));

      const closes = data.map(r => r.ac);
      const n = data.length;

      // ── 1. AD Line (Chaikin Accumulation/Distribution) ──
      const adLine = [];
      let adCum = 0;
      data.forEach(r => {
        const hl = r.ah - r.al;
        const mfm = hl > 0 ? ((r.ac - r.al) - (r.ah - r.ac)) / hl : 0;
        const mfv = mfm * (r.volume || 0);
        adCum += mfv;
        adLine.push({ date: r.trade_date, ad: Math.round(adCum), mfv: Math.round(mfv) });
      });

      // ── 2. Phase Detection (5-factor) ──
      // Factors: price slope, AD line slope, volume ratio, frequency ratio, foreign flow direction
      const phases = [];
      let currentPhase = null;

      for (let i = 20; i < n; i++) {
        const slice = data.slice(i - 20, i + 1);
        const c20 = slice.map(r => r.ac);
        const v20 = slice.map(r => r.volume || 0);
        const f20 = slice.map(r => r.frequency || 0);
        const fn20 = slice.map(r => r.fnet || 0);
        const ad20 = adLine.slice(i - 20, i + 1).map(r => r.ad);

        // 1. Price slope (first 5 vs last 5 avg)
        const priceFirst5 = c20.slice(0, 5).reduce((s, v) => s + v, 0) / 5;
        const priceLast5 = c20.slice(-5).reduce((s, v) => s + v, 0) / 5;
        const priceSlope = priceFirst5 > 0 ? priceLast5 / priceFirst5 - 1 : 0;

        // 2. AD line slope
        const adFirst5 = ad20.slice(0, 5).reduce((s, v) => s + v, 0) / 5;
        const adLast5 = ad20.slice(-5).reduce((s, v) => s + v, 0) / 5;
        const adSlope = adFirst5 !== 0 ? (adLast5 - adFirst5) / Math.abs(adFirst5) : (adLast5 > 0 ? 0.1 : -0.1);

        // 3. Volume ratio (recent 5d vs prior 15d)
        const avgVol = v20.slice(0, 15).reduce((s, v) => s + v, 0) / 15;
        const recentVol = v20.slice(-5).reduce((s, v) => s + v, 0) / 5;
        const volRatio = avgVol > 0 ? recentVol / avgVol : 1;

        // 4. Frequency ratio (recent 5d vs prior 15d)
        const avgFreq = f20.slice(0, 15).reduce((s, v) => s + v, 0) / 15;
        const recentFreq = f20.slice(-5).reduce((s, v) => s + v, 0) / 5;
        const freqRatio = avgFreq > 0 ? recentFreq / avgFreq : 1;

        // 5. Foreign flow direction (last 10 days)
        const fnet10 = fn20.slice(-10).reduce((s, v) => s + v, 0);
        const fnetBuyDays = fn20.slice(-10).filter(v => v > 0).length;
        const fnetDir = fnetBuyDays >= 7 ? 1 : fnetBuyDays <= 3 ? -1 : 0; // 1=buying, -1=selling, 0=neutral

        // ── Scoring system: each signal votes ──
        // Positive score = bullish (markup/accumulation), negative = bearish (markdown/distribution)
        let bullScore = 0, bearScore = 0;
        let isSideways = Math.abs(priceSlope) <= 0.02;

        // Price direction (strongest weight)
        if (priceSlope > 0.02) bullScore += 3;
        else if (priceSlope < -0.02) bearScore += 3;

        // AD line (accumulation signal)
        if (adSlope > 0.03) bullScore += 2;
        else if (adSlope < -0.03) bearScore += 2;

        // Volume surge confirms direction
        if (volRatio > 1.3) { if (priceSlope > 0) bullScore += 1; else if (priceSlope < 0) bearScore += 1; }

        // Frequency surge (institutional activity)
        if (freqRatio > 1.3) { if (isSideways) bullScore += 1; else if (priceSlope > 0) bullScore += 1; else bearScore += 1; }
        if (freqRatio > 2.0 && isSideways) bullScore += 1; // strong accumulation signal

        // Foreign flow
        if (fnetDir > 0) bullScore += 1;
        else if (fnetDir < 0) bearScore += 1;

        // ── Determine phase ──
        let phase;
        const totalSignals = bullScore + bearScore;
        if (isSideways) {
          // Sideways: accumulation vs distribution based on AD + freq + foreign
          phase = bullScore > bearScore ? 'accumulation' : bearScore > bullScore ? 'distribution' : 'accumulation';
        } else if (priceSlope > 0.02) {
          phase = 'markup';
        } else {
          phase = 'markdown';
        }

        // Confidence: how many signals agree (0-100%)
        const maxScore = Math.max(bullScore, bearScore);
        const confidence = totalSignals > 0 ? Math.round(maxScore / totalSignals * 100) : 50;

        // Track phase transitions
        if (!currentPhase || currentPhase.phase !== phase) {
          if (currentPhase) currentPhase.end_idx = i - 1;
          currentPhase = { phase, start_idx: i, end_idx: i, start_date: data[i].trade_date, confidence };
          phases.push(currentPhase);
        } else {
          currentPhase.end_idx = i;
          // Update confidence with running average
          currentPhase.confidence = Math.round((currentPhase.confidence + confidence) / 2);
        }
      }

      // Enrich phases with stats (minimum 5 days)
      const phaseResult = phases.filter(p => (p.end_idx - p.start_idx) >= 4).map(p => {
        const sd = data[p.start_idx], ed = data[p.end_idx];
        const days = p.end_idx - p.start_idx + 1;
        const chg = sd.ac > 0 ? Math.round((ed.ac - sd.ac) / sd.ac * 10000) / 100 : 0;
        const phaseSlice = data.slice(p.start_idx, p.end_idx + 1);
        const hi = Math.max(...phaseSlice.map(r => r.ah));
        const lo = Math.min(...phaseSlice.map(r => r.al));
        const totalFnet = phaseSlice.reduce((s, r) => s + r.fnet, 0);
        const avgVol = Math.round(phaseSlice.reduce((s, r) => s + (r.volume || 0), 0) / days);
        const avgFreq = Math.round(phaseSlice.reduce((s, r) => s + (r.frequency || 0), 0) / days);
        return {
          phase: p.phase, start: sd.trade_date, end: ed.trade_date, days,
          open: sd.ac, close: ed.ac, high: hi, low: lo, change_pct: chg,
          range: lo + ' - ' + hi, fnet: totalFnet, avg_vol: avgVol, avg_freq: avgFreq,
          confidence: p.confidence || 50
        };
      });

      // Current phase
      const lastPhase = phaseResult.length ? phaseResult[phaseResult.length - 1] : null;

      // ── 3. Key Statistics ──
      const last = data[n - 1];
      const peak52w = Math.max(...closes.slice(-252));
      const low52w = Math.min(...closes.slice(-252));
      const drawdownFromPeak = peak52w > 0 ? Math.round((last.ac - peak52w) / peak52w * 10000) / 100 : 0;
      const pctFromLow = low52w > 0 ? Math.round((last.ac - low52w) / low52w * 10000) / 100 : 0;

      // ATR 14
      let atr = 0;
      if (n >= 15) {
        const trs = [];
        for (let i = n - 14; i < n; i++) {
          trs.push(Math.max(data[i].ah - data[i].al, Math.abs(data[i].ah - data[i - 1].ac), Math.abs(data[i].al - data[i - 1].ac)));
        }
        atr = Math.round(trs.reduce((s, v) => s + v, 0) / trs.length);
      }

      // Volatility (20d std dev of returns)
      let volatility = 0;
      if (n >= 21) {
        const rets = [];
        for (let i = n - 20; i < n; i++) rets.push((data[i].ac - data[i - 1].ac) / data[i - 1].ac);
        const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
        const variance = rets.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / rets.length;
        volatility = Math.round(Math.sqrt(variance) * Math.sqrt(252) * 10000) / 100; // annualized %
      }

      // RS vs IHSG (relative strength)
      let rsVsIhsg = null;
      try {
        const ihsg = db.prepare('SELECT trade_date, close FROM idx_indices WHERE index_code=? ORDER BY trade_date').all('COMPOSITE');
        if (ihsg.length >= 20 && n >= 20) {
          const ihsgMap = {};
          ihsg.forEach(r => { ihsgMap[r.trade_date] = r.close; });
          const last20 = data.slice(-20);
          const stockRet = last20.length >= 2 ? (last20[last20.length - 1].ac - last20[0].ac) / last20[0].ac : 0;
          const ihsgStart = ihsgMap[last20[0].trade_date], ihsgEnd = ihsgMap[last20[last20.length - 1].trade_date];
          const ihsgRet = ihsgStart && ihsgEnd ? (ihsgEnd - ihsgStart) / ihsgStart : 0;
          rsVsIhsg = Math.round((stockRet - ihsgRet) * 10000) / 100;
        }
      } catch (e) {}

      // ── 4. Bid/Offer Analysis ──
      const bo20 = data.slice(-20);
      const boData = bo20.map(r => ({
        date: r.trade_date,
        bid: r.bid_vol || 0, offer: r.offer_vol || 0,
        ratio: (r.bid_vol || 0) + (r.offer_vol || 0) > 0 ? Math.round((r.bid_vol || 0) / ((r.bid_vol || 0) + (r.offer_vol || 0)) * 1000) / 10 : 50
      }));
      const avgBidRatio = boData.length ? Math.round(boData.reduce((s, r) => s + r.ratio, 0) / boData.length * 10) / 10 : 50;

      // ── 5. Foreign Flow Summary ──
      const fnet5 = data.slice(-5).reduce((s, r) => s + r.fnet, 0);
      const fnet10 = data.slice(-10).reduce((s, r) => s + r.fnet, 0);
      const fnet20 = data.slice(-20).reduce((s, r) => s + r.fnet, 0);
      const fnetTotal = data.reduce((s, r) => s + r.fnet, 0);
      let accumStreak = 0;
      for (let i = n - 1; i >= 0; i--) { if (data[i].fnet > 0) accumStreak++; else break; }
      let distribStreak = 0;
      for (let i = n - 1; i >= 0; i--) { if (data[i].fnet < 0) distribStreak++; else break; }

      // ── 6. Scoring Breakdown (from daily_scores) ──
      let scoring = null;
      try {
        const latestScore = db.prepare('SELECT * FROM daily_scores WHERE code=? ORDER BY calc_date DESC LIMIT 1').get(code);
        if (latestScore) scoring = latestScore;
        // Score history (last 20 dates)
        var scoreHist = db.prepare('SELECT calc_date, score_composite, score_fundamental, score_valuation, score_momentum, score_demand, score_foreign FROM daily_scores WHERE code=? ORDER BY calc_date DESC LIMIT 30').all(code);
        if (scoreHist.length) scoreHist.reverse();
      } catch (e) {}

      // ── 7. Fundamental snapshot — dari financial_ratios (PIT) ──
      // idx_fundamental hanya menyimpan 3 snapshot dan kolom sales/profit/assets/
      // eps-nya 0 untuk banyak emiten, sehingga Financials & Fundachart kosong.
      let fundamental = null;
      try {
        const fr = db.prepare(`SELECT period, sector, sales, ebt, profit, assets, liabilities, equity,
             eps, book_value, per, pbv, der, roa, roe, npm
             FROM financial_ratios WHERE code=? ORDER BY period DESC LIMIT 1`).get(code);
        if (fr) {
          fundamental = {
            ...fr,
            eps_trailing: fr.eps,                       // nama field yang dipakai UI
            snapshot_month: String(fr.period).slice(0, 7),
            fs_date: fr.period,
            fiscal_year: String(fr.period).slice(0, 4),
            fs_type: 'QUARTERLY'
          };
          // NPM bank tidak sebanding: `sales` = pendapatan bunga bersih, sementara
          // `profit` termasuk pendapatan non-operasional -> rasio bisa >100%.
          fundamental.roe = sdNormPct(fr.roe);
          fundamental.roa = sdNormPct(fr.roa);
          // npm dihitung ulang: profit/sales (YTD), bukan kolom npm yang
          // mencampur laba disetahunkan dengan sales YTD.
          fundamental.npm = fr.sales > 0 ? Math.round(fr.profit / fr.sales * 10000) / 100 : null;
          if (/financial/i.test(fr.sector || '')) {
            fundamental.npm = null;
            fundamental.npm_note = 'Bank: NPM tidak sebanding (sales = pendapatan bunga bersih)';
          }
        }
      } catch (e) {}

      // ── 7b. Ownership from balance_position ──
      let ownership = null;
      try {
        const bpRow = db.prepare('SELECT * FROM balance_position WHERE code=? ORDER BY snapshot_date DESC LIMIT 1').get(code);
        if (bpRow) {
          const totalShares = (bpRow.local_total || 0) + (bpRow.foreign_total || 0);
          // Basis persen = saham beredar (sec_num), bukan hanya yang tercatat scripless,
          // supaya kartu dan riwayat memakai penyebut yang sama.
          const secNum = bpRow.sec_num || last.listed_shares || 0;
          const pcListed = v => secNum > 0 ? Math.round(v / secNum * 10000) / 100 : 0;
          ownership = {
            snapshot_date: bpRow.snapshot_date,
            local_total: bpRow.local_total || 0,
            foreign_total: bpRow.foreign_total || 0,
            total: totalShares,
            listed_shares: secNum,
            foreign_pct: pcListed(bpRow.foreign_total || 0),
            local_pct: pcListed(bpRow.local_total || 0),
            basis: 'listed_shares',
            scripless_pct: secNum > 0 ? Math.round(totalShares / secNum * 10000) / 100 : null,
            pct_breakdown: (function () {
              const keys = ['is','cp','pf','ib','id','mf','sc','fd','ot'];
              const out = { local: {}, foreign: {} };
              keys.forEach(k => {
                out.local[k] = pcListed(bpRow['local_' + k] || 0);
                out.foreign[k] = pcListed(bpRow['foreign_' + k] || 0);
              });
              return out;
            })(),
            breakdown: {
              local: { is: bpRow.local_is||0, cp: bpRow.local_cp||0, pf: bpRow.local_pf||0, ib: bpRow.local_ib||0, id: bpRow.local_id||0, mf: bpRow.local_mf||0, sc: bpRow.local_sc||0, fd: bpRow.local_fd||0, ot: bpRow.local_ot||0 },
              foreign: { is: bpRow.foreign_is||0, cp: bpRow.foreign_cp||0, pf: bpRow.foreign_pf||0, ib: bpRow.foreign_ib||0, id: bpRow.foreign_id||0, mf: bpRow.foreign_mf||0, sc: bpRow.foreign_sc||0, fd: bpRow.foreign_fd||0, ot: bpRow.foreign_ot||0 }
            },
            // Riwayat 2022-01 .. sekarang (snapshot bulanan KSEI)
            history: (function () {
              try {
                const rows = db.prepare('SELECT * FROM balance_position WHERE code=? ORDER BY snapshot_date').all(code);
                const keys = ['is', 'cp', 'pf', 'ib', 'id', 'mf', 'sc', 'fd', 'ot'];
                return rows.map(r => {
                  const tot = r.sec_num || 0;
                  const pc = v => tot > 0 ? Math.round(v / tot * 10000) / 100 : 0;
                  const local = {}, foreign = {}, cats = {};
                  keys.forEach(k => {
                    local[k] = pc(r['local_' + k] || 0);
                    foreign[k] = pc(r['foreign_' + k] || 0);
                    cats[k] = pc((r['local_' + k] || 0) + (r['foreign_' + k] || 0));
                  });
                  return {
                    date: r.snapshot_date, total: tot,
                    local_pct: pc(r.local_total || 0), foreign_pct: pc(r.foreign_total || 0),
                    local, foreign, cats
                  };
                });
              } catch (e) { return []; }
            })()
          };
        }
      } catch (e) {}

      // ── 7c. Dividend History from bei_dividends ──
      let dividendHistory = [];
      try {
        dividendHistory = db.prepare('SELECT * FROM bei_dividends WHERE code=? ORDER BY cum_date DESC').all(code);
      } catch (e) {}

      // ── 7d. CA Timeline from bei_corporate_actions ──
      let caTimeline = [];
      try {
        caTimeline = db.prepare('SELECT * FROM bei_corporate_actions WHERE code=? ORDER BY cum_date DESC LIMIT 30').all(code);
      } catch (e) {}

      // ── 7e. Live PER/PBV + Derived Ratios ──
      if (fundamental) {
        const liveClose = last.ac;
        const fu = fundamental;
        // Live valuation
        if (fu.eps_trailing && fu.eps_trailing !== 0) {
          fu.live_per = Math.round(liveClose / fu.eps_trailing * 100) / 100;
        }
        if (fu.book_value && fu.book_value !== 0) {
          fu.live_pbv = Math.round(liveClose / fu.book_value * 100) / 100;
        }
        // Earnings Yield = EPS / Close × 100
        if (fu.eps_trailing && liveClose > 0) {
          fu.earnings_yield = Math.round(fu.eps_trailing / liveClose * 10000) / 100;
        }
        // Price to Sales = Market Cap / Sales (both in billions)
        const mktCapB = liveClose * (last.listed_shares || 0);
        if (fu.sales && fu.sales > 0 && mktCapB > 0) {
          fu.price_to_sales = Math.round(mktCapB / (fu.sales * 1e9) * 100) / 100; // sales in billions from BEI
        }
        // DAR = Liabilities / Assets
        if (fu.assets && fu.assets > 0) {
          fu.dar = Math.round(fu.liabilities / fu.assets * 10000) / 100;
        }
        // Equity Ratio = Equity / Assets
        if (fu.assets && fu.assets > 0 && fu.equity) {
          fu.equity_ratio = Math.round(fu.equity / fu.assets * 10000) / 100;
        }
        // Asset Turnover = Sales / Assets
        if (fu.assets && fu.assets > 0 && fu.sales) {
          fu.asset_turnover = Math.round(fu.sales / fu.assets * 10000) / 100;
        }
        // Equity Multiplier = Assets / Equity
        if (fu.equity && fu.equity > 0 && fu.assets) {
          fu.equity_multiplier = Math.round(fu.assets / fu.equity * 100) / 100;
        }
        // DuPont: ROE = NPM × Asset Turnover × Equity Multiplier
        if (fu.npm && fu.asset_turnover && fu.equity_multiplier) {
          fu.dupont = {
            npm: fu.npm,
            asset_turnover: fu.asset_turnover,
            equity_multiplier: fu.equity_multiplier,
            roe_check: Math.round(fu.npm / 100 * fu.asset_turnover / 100 * fu.equity_multiplier * 10000) / 100
          };
        }
      }

      // ── 7f. YoY Growth (compare same month 1 year ago) ──
      let fundGrowth = null;
      try {
        if (fundamental && fundamental.period) {
          const curPeriod = fundamental.period;                 // YYYY-MM-DD
          const yParts = curPeriod.split('-');
          const yoyPeriod = (parseInt(yParts[0]) - 1) + '-' + yParts.slice(1).join('-');
          const prev = db.prepare(`SELECT period, sales, profit, eps AS eps_trailing, equity, assets
                                   FROM financial_ratios WHERE code=? AND period=?`).get(code, yoyPeriod);
          if (prev) {
            const pctChg = (cur, prv) => (prv && prv !== 0) ? Math.round((cur - prv) / Math.abs(prv) * 10000) / 100 : null;
            fundGrowth = {
              period: yoyPeriod + ' → ' + curPeriod,
              revenue_growth: pctChg(fundamental.sales, prev.sales),
              profit_growth: pctChg(fundamental.profit, prev.profit),
              eps_growth: pctChg(fundamental.eps_trailing, prev.eps_trailing),
              equity_growth: pctChg(fundamental.equity, prev.equity),
              assets_growth: pctChg(fundamental.assets, prev.assets),
              prev_snapshot: yoyPeriod.slice(0, 7)
            };
          }
        }
      } catch (e) {}

      // ── 7g. Fund History — quarterly deduplicated + daily live valuation ──
      let fundHistory = [];
      let dailyValuation = [];
      try {
        // Helper: parse fs_date from MM/DD/YYYY or YYYY-MM-DD to ISO YYYY-MM-DD
        function normalizeFsDate(fd) {
          if (!fd) return '';
          // Already YYYY-MM-DD?
          if (/^\d{4}-\d{2}/.test(fd)) return fd;
          // MM/DD/YYYY format
          var parts = fd.split('/');
          if (parts.length === 3) return parts[2] + '-' + parts[0].padStart(2,'0') + '-' + parts[1].padStart(2,'0');
          return fd;
        }

        const rows = db.prepare(`SELECT period, sector, sales, ebt, profit, assets, liabilities, equity,
             eps, book_value, per, pbv, der, roa, roe, npm
             FROM financial_ratios WHERE code=?
               AND (period LIKE '%-03-31' OR period LIKE '%-06-30'
                    OR period LIKE '%-09-30' OR period LIKE '%-12-31')
             ORDER BY period`).all(code);
        fundHistory = rows.map(r => {
          const m = parseInt(String(r.period).slice(5, 7) || '0');
          const ql = m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'FY';
          return {
            ...r,
            eps_trailing: r.eps,
            snapshot_month: String(r.period).slice(0, 7),
            fs_date: r.period,
            _norm_fs_date: r.period,
            quarter_label: ql,
            period_label: String(r.period).slice(2, 4) + ' ' + ql,
            roe: sdNormPct(r.roe),
            roa: sdNormPct(r.roa),
            npm: (/financial/i.test(r.sector || '') || !(r.sales > 0))
              ? null : Math.round(r.profit / r.sales * 10000) / 100
          };
        });
      } catch (e) {}

      try {
        // Daily live PER/PBV from idx_daily close / latest EPS & BV/S
        if (fundamental && (fundamental.eps_trailing || fundamental.book_value)) {
          const epsT = fundamental.eps_trailing || 0;
          const bvS = fundamental.book_value || 0;
          // ca_adj: seri PER/PBV 250 sesi harus memakai harga terkoreksi, kalau tidak
          // satu split membuat PER "turun 80%" padahal EPS-nya belum berubah.
          const dailyRows = db.prepare('SELECT trade_date, close, ca_adj(close, code, trade_date) AS ac FROM idx_daily WHERE code=? AND close>0 ORDER BY trade_date DESC LIMIT 250').all(code).reverse();
          dailyValuation = dailyRows.map(r => ({
            date: r.trade_date,
            close: r.close,
            live_per: epsT !== 0 ? Math.round(r.ac / epsT * 100) / 100 : null,
            live_pbv: bvS !== 0 ? Math.round(r.ac / bvS * 100) / 100 : null
          }));
        }
      } catch (e) {}

      // ── 8. MA Stage Detection ──
      // Calculate MAs from adjusted close
      function calcMA(period) {
        if (n < period) return null;
        return Math.round(closes.slice(-period).reduce((s, v) => s + v, 0) / period);
      }
      const mas = { ma5: calcMA(5), ma10: calcMA(10), ma20: calcMA(20), ma50: calcMA(50), ma100: calcMA(100), ma200: calcMA(200) };
      const price = last.ac;

      // Stage: count how many MAs price is above (short to long)
      const maLevels = [
        { key: 'ma5', val: mas.ma5 },
        { key: 'ma10', val: mas.ma10 },
        { key: 'ma20', val: mas.ma20 },
        { key: 'ma50', val: mas.ma50 },
        { key: 'ma200', val: mas.ma200 }
      ].filter(m => m.val !== null);

      let maAbove = 0, maBelow = 0;
      const maDetail = [];
      maLevels.forEach(m => {
        const above = price >= m.val;
        if (above) maAbove++; else maBelow++;
        const dist = m.val > 0 ? Math.round((price - m.val) / m.val * 10000) / 100 : 0;
        maDetail.push({ key: m.key, value: m.val, above, dist_pct: dist });
      });

      // Check MA alignment (bullish stacking: MA5 > MA10 > MA20 > MA50 > MA200)
      let bullishStack = true, bearishStack = true;
      for (let i = 0; i < maLevels.length - 1; i++) {
        if (maLevels[i].val <= maLevels[i + 1].val) bullishStack = false;
        if (maLevels[i].val >= maLevels[i + 1].val) bearishStack = false;
      }

      const stage = {
        level: maAbove, // 0-5
        total: maLevels.length,
        label: maAbove === 0 ? 'Full Downtrend' :
               maAbove === 1 ? 'First Bounce' :
               maAbove === 2 ? 'Building Momentum' :
               maAbove === 3 ? 'Swing Reversal' :
               maAbove === 4 ? 'Trend Change' :
               'Full Uptrend',
        bullish_stack: bullishStack,
        bearish_stack: bearishStack,
        ma: maDetail,
        mas: mas
      };

      // ── 8b. MA Respect Rate — historical bounce analysis ──
      const maRespect = [];
      try {
        const touchThreshold = 0.025; // within 2.5% of MA = "approaching"
        const bounceThreshold = 0.02; // 2% move after touch = bounce/breakdown
        const lookForward = 5; // check 5 days after touch

        [{ period: 20, label: 'MA20' }, { period: 50, label: 'MA50' }, { period: 100, label: 'MA100' }, { period: 200, label: 'MA200' }].forEach(maConf => {
          if (n < maConf.period + 30) return; // need enough data

          // Compute rolling MA for entire history
          const maValues = [];
          for (let i = 0; i < n; i++) {
            if (i < maConf.period - 1) { maValues.push(null); continue; }
            let sum = 0;
            for (let j = i - maConf.period + 1; j <= i; j++) sum += closes[j];
            maValues.push(sum / maConf.period);
          }

          // Scan for touch events from above
          let touches = 0, bounces = 0, breakdowns = 0;
          let lastTouchIdx = -10; // avoid double-counting nearby touches

          for (let i = maConf.period + 5; i < n - lookForward; i++) {
            const ma = maValues[i];
            if (!ma || ma <= 0) continue;

            const distPct = (closes[i] - ma) / ma;

            // Touch from above: price was above MA recently, now within threshold
            if (distPct >= -0.005 && distPct <= touchThreshold) {
              // Verify was above MA in prior 5 days
              let wasAbove = false;
              for (let j = Math.max(0, i - 5); j < i; j++) {
                if (maValues[j] && closes[j] > maValues[j] * 1.01) { wasAbove = true; break; }
              }
              if (!wasAbove) continue;
              if (i - lastTouchIdx < 8) continue; // skip if too close to previous touch

              lastTouchIdx = i;
              touches++;

              // Check outcome in next lookForward days
              const touchPrice = closes[i];
              let maxUp = 0, maxDown = 0;
              for (let j = i + 1; j <= Math.min(i + lookForward, n - 1); j++) {
                const chg = (closes[j] - touchPrice) / touchPrice;
                if (chg > maxUp) maxUp = chg;
                if (chg < maxDown) maxDown = chg;
              }

              if (maxUp >= bounceThreshold && maxUp > Math.abs(maxDown)) bounces++;
              else if (Math.abs(maxDown) >= bounceThreshold) breakdowns++;
              // else: inconclusive (small move), counted in touches but neither bounce nor breakdown
            }
          }

          if (touches >= 3) { // minimum 3 events to be meaningful
            const respectRate = Math.round(bounces / touches * 100);
            const currentDist = maValues[n - 1] ? Math.round((closes[n - 1] - maValues[n - 1]) / maValues[n - 1] * 10000) / 100 : null;
            const isNearNow = currentDist !== null && currentDist >= -1 && currentDist <= 3;
            maRespect.push({
              label: maConf.label, period: maConf.period,
              touches, bounces, breakdowns,
              inconclusive: touches - bounces - breakdowns,
              respect_rate: respectRate,
              current_dist: currentDist,
              near_now: isNearNow
            });
          }
        });
      } catch (e) {}

      // ── 9. Sector Context ──
      let sectorContext = null;
      try {
        const sector = fundamental?.sector || raw[raw.length - 1]?.sector || '';
        if (sector) {
          const sectorFlow = db.prepare(`
            SELECT SUM(CASE WHEN (foreign_buy - foreign_sell) * close > 0 THEN (foreign_buy - foreign_sell) * close ELSE 0 END) as inflow,
                   SUM(CASE WHEN (foreign_buy - foreign_sell) * close < 0 THEN (foreign_buy - foreign_sell) * close ELSE 0 END) as outflow,
                   SUM((foreign_buy - foreign_sell) * close) as net
            FROM idx_daily WHERE sector=? AND trade_date >= date(?, '-20 days')
          `).get(sector, last.trade_date);
          sectorContext = { sector, fnet_20d: sectorFlow?.net || 0 };
        }
      } catch (e) {}

      // ── 9b. Market Regime (IHSG trend) ──
      let marketRegime = null;
      try {
        const ihsgRows = db.prepare('SELECT trade_date, close FROM idx_indices WHERE index_code=? ORDER BY trade_date DESC LIMIT 61').all('COMPOSITE');
        if (ihsgRows.length >= 21) {
          const ihsgNow = ihsgRows[0].close;
          // rows[0] = bar terbaru -> "N sesi lalu" = rows[N] (off-by-one t_c3d94014).
          const ihsg5d = ihsgRows[5] ? ihsgRows[5].close : ihsgNow;
          const ihsg20d = ihsgRows[20] ? ihsgRows[20].close : ihsgNow;
          const ihsg60d = ihsgRows[ihsgRows.length - 1] ? ihsgRows[ihsgRows.length - 1].close : ihsgNow;
          const chg5d = ihsg5d > 0 ? Math.round((ihsgNow - ihsg5d) / ihsg5d * 10000) / 100 : 0;
          const chg20d = ihsg20d > 0 ? Math.round((ihsgNow - ihsg20d) / ihsg20d * 10000) / 100 : 0;
          const chg60d = ihsg60d > 0 ? Math.round((ihsgNow - ihsg60d) / ihsg60d * 10000) / 100 : 0;
          let regime = 'sideways';
          if (chg20d > 5) regime = 'bull';
          else if (chg20d < -5) regime = 'bear';
          else if (chg20d > 2) regime = 'mild_bull';
          else if (chg20d < -2) regime = 'mild_bear';
          marketRegime = { level: ihsgNow, chg_5d: chg5d, chg_20d: chg20d, chg_60d: chg60d, regime, date: ihsgRows[0].trade_date };
        }
      } catch (e) {}

      // ── 9c. Recent Announcements for this ticker ──
      let announcements = [];
      try {
        announcements = db.prepare('SELECT ann_date, title, type, subject, attachments FROM company_announcements WHERE company_code=? ORDER BY ann_date DESC LIMIT 10').all(code);
      } catch (e) {}

      // ── 9d. Commodity Context (for commodity-linked stocks) ──
      let commodityContext = null;
      try {
        const sector = fundamental?.sector || '';
        const industry = fundamental?.industry || '';
        const sectorLower = (sector + ' ' + industry).toLowerCase();
        // Map sector/industry to commodity
        let commodityCode = null, commodityLabel = null;
        if (sectorLower.includes('palm') || sectorLower.includes('plantation') || sectorLower.includes('sawit')) { commodityCode = 'CPO'; commodityLabel = 'CPO (Crude Palm Oil)'; }
        else if (sectorLower.includes('coal') || sectorLower.includes('batubara') || sectorLower.includes('mining') && sectorLower.includes('coal')) { commodityCode = 'COAL'; commodityLabel = 'Coal'; }
        else if (sectorLower.includes('nickel') || sectorLower.includes('nikel')) { commodityCode = 'NICKEL'; commodityLabel = 'Nickel'; }
        else if (sectorLower.includes('gold') || sectorLower.includes('emas')) { commodityCode = 'GOLD'; commodityLabel = 'Gold'; }
        else if (sectorLower.includes('tin') || sectorLower.includes('timah')) { commodityCode = 'TIN'; commodityLabel = 'Tin'; }
        else if (sectorLower.includes('oil') || sectorLower.includes('gas') || sectorLower.includes('minyak')) { commodityCode = 'OIL'; commodityLabel = 'Crude Oil'; }
        // Also check by well-known ticker codes
        const codeUpper = code.toUpperCase();
        if (['AALI','LSIP','SIMP','TBLA','SSMS','DSNG','SGRO'].includes(codeUpper)) { commodityCode = 'CPO'; commodityLabel = 'CPO'; }
        else if (['ADRO','PTBA','ITMG','BUMI','HRUM','BYAN','DSSA'].includes(codeUpper)) { commodityCode = 'COAL'; commodityLabel = 'Coal'; }
        else if (['INCO','ANTM','NCKL','MBMA'].includes(codeUpper)) { commodityCode = 'NICKEL'; commodityLabel = 'Nickel'; }
        else if (['MDKA','ARCI','BRMS','PSAB'].includes(codeUpper)) { commodityCode = 'GOLD'; commodityLabel = 'Gold'; }
        else if (['TINS'].includes(codeUpper)) { commodityCode = 'TIN'; commodityLabel = 'Tin'; }
        else if (['MEDC','ELSA'].includes(codeUpper)) { commodityCode = 'OIL'; commodityLabel = 'Crude Oil'; }

        if (commodityCode) {
          // Try custom_ohlc first, then commodities table
          const cmdRows = db.prepare(`SELECT trade_date, close FROM custom_ohlc WHERE code=? AND ${REGULAR_SESSION} ORDER BY trade_date DESC LIMIT 30`).all(commodityCode);
          if (cmdRows.length >= 5) {
            const now = cmdRows[0].close;
            const d5 = cmdRows[5] ? cmdRows[5].close : now;
            const d20 = cmdRows[Math.min(20, cmdRows.length - 1)] ? cmdRows[Math.min(20, cmdRows.length - 1)].close : now;
            // Kesegaran seri di tab Analysis (kanban t_61ccbdbe, rework ronde 3): TIN beku di
            // 15 Okt sementara sesi sudah jalan. Tanpa field ini, `price` di bawah terbaca
            // sebagai harga hari ini. Level + persen TETAP dikirim (dipakai hitungan lain),
            // tapi `stale=true` mewajibkan UI menulis "—" + tanggal — satu aturan dengan
            // /api/commodities, /api/idx/market-regime, /api/market/overview.
            const fresh = freshnessUtil.seriesFreshness(freshnessUtil.buildContext(db), freshnessUtil.lastRegularBarDate(cmdRows), commodityCode);
            commodityContext = {
              code: commodityCode, label: commodityLabel, price: now,
              date: cmdRows[0].trade_date,
              stale: fresh.stale, stale_date: fresh.last_date,
              lag_sessions: fresh.lag_sessions, lag_capped: fresh.lag_capped,
              ref_date: fresh.ref_date,
              expected_lag_sessions: fresh.expected_lag_sessions,
              excess_sessions: fresh.excess_sessions,
              state: fresh.state,
              chg_5d: d5 > 0 ? Math.round((now - d5) / d5 * 10000) / 100 : 0,
              chg_20d: d20 > 0 ? Math.round((now - d20) / d20 * 10000) / 100 : 0
            };
          }
        }
      } catch (e) {}

      // ── 9e. Frequency Analysis — Block Trade / Retail Frenzy / Smart Accum / Dry Up ──
      const freqAnalysis = [];
      try {
        if (n >= 40) {
          const lookback = 20;
          for (let i = lookback; i < n; i++) {
            const d_i = data[i];
            const slice = data.slice(i - lookback, i);
            const avgVol = slice.reduce((s, r) => s + (r.volume || 0), 0) / lookback;
            const avgFreq = slice.reduce((s, r) => s + (r.frequency || 0), 0) / lookback;
            const avgVal = slice.reduce((s, r) => s + (r.value || 0), 0) / lookback;

            const vol = d_i.volume || 0;
            const freq = d_i.frequency || 0;
            const val = d_i.value || 0;
            const relVol = avgVol > 0 ? vol / avgVol : 1;
            const relFreq = avgFreq > 0 ? freq / avgFreq : 1;
            const avgTickSize = freq > 0 ? val / freq : 0;
            const avgTickSizeHist = avgFreq > 0 ? avgVal / avgFreq : 0;
            const tickRatio = avgTickSizeHist > 0 ? avgTickSize / avgTickSizeHist : 1;
            const fnet = d_i.fnet || 0;

            const isBlock = tickRatio > 2.5 && relVol > 1.5 && relFreq < 1.5;
            const isRetailFrenzy = relFreq > 2.0 && tickRatio < 0.6 && relVol > 1.2;
            const priceChg = d_i.ac && data[i - 1].ac > 0 ? (d_i.ac - data[i - 1].ac) / data[i - 1].ac : 0;
            const isSmartAccum = relVol > 1.2 && relVol < 3.0 && relFreq >= 0.8 && relFreq <= 1.8 &&
                                 Math.abs(priceChg) < 0.03 && fnet > 0 && tickRatio > 1.2;
            const isDryUp = relVol < 0.4 && relFreq < 0.5;

            if (isBlock || isRetailFrenzy || isSmartAccum || isDryUp) {
              freqAnalysis.push({
                date: d_i.trade_date,
                type: isBlock ? 'block_trade' : isRetailFrenzy ? 'retail_frenzy' : isSmartAccum ? 'smart_accum' : 'dry_up',
                vol, freq, val, relVol: Math.round(relVol * 100) / 100,
                relFreq: Math.round(relFreq * 100) / 100,
                tickRatio: Math.round(tickRatio * 100) / 100,
                fnet, priceChg: Math.round(priceChg * 10000) / 100
              });
            }
          }
        }
      } catch (e) {}

      const freqRecent = freqAnalysis.filter(f => {
        const d20ago = data[Math.max(0, n - 21)]?.trade_date || '';
        return f.date >= d20ago;
      });
      const freqSummary = {
        block_trade: freqRecent.filter(f => f.type === 'block_trade').length,
        retail_frenzy: freqRecent.filter(f => f.type === 'retail_frenzy').length,
        smart_accum: freqRecent.filter(f => f.type === 'smart_accum').length,
        dry_up: freqRecent.filter(f => f.type === 'dry_up').length,
        events: freqRecent.length,
        recent: freqRecent.slice(-10)
      };

      // ── 10. Unified Verdict ──
      // Helper for short value format
      function fmtValShort(v) {
        if (Math.abs(v) >= 1e12) return (v / 1e12).toFixed(1) + 'T';
        if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
        if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
        return Math.round(v).toLocaleString();
      }
      // Score each signal dimension (0-2: bearish, neutral, bullish)
      const signals = [];
      let bullSignals = 0, bearSignals = 0, totalSignals = 0;

      function addSignal(name, icon, value, isBull, isBear, detail) {
        const direction = isBull ? 'bullish' : isBear ? 'bearish' : 'neutral';
        signals.push({ name, icon, value, direction, detail });
        totalSignals++;
        if (isBull) bullSignals++;
        if (isBear) bearSignals++;
      }

      // Phase
      if (lastPhase) {
        const p = lastPhase.phase;
        addSignal('Phase', '🔄', lastPhase.phase,
          p === 'accumulation' || p === 'markup',
          p === 'distribution' || p === 'markdown',
          lastPhase.days + 'd ' + (lastPhase.confidence || 50) + '%');
      }

      // MA Stage
      addSignal('MA Stage', '📊', 'Stage ' + stage.level,
        stage.level >= 4, stage.level <= 1,
        stage.label + (stage.bullish_stack ? ' (aligned)' : ''));

      // Composite Score
      if (scoring && scoring.score_composite != null) {
        addSignal('Score', '⭐', Math.round(scoring.score_composite),
          scoring.score_composite >= 70, scoring.score_composite <= 30,
          'F:' + Math.round(scoring.score_fundamental || 0) + ' V:' + Math.round(scoring.score_valuation || 0) + ' M:' + Math.round(scoring.score_momentum || 0));
      }

      // Foreign Flow
      addSignal('Foreign', '🌍', fmtValShort(fnet20),
        fnet20 > 0 && accumStreak >= 3, fnet20 < 0 && distribStreak >= 3,
        accumStreak > 0 ? 'Accum ' + accumStreak + 'd' : distribStreak > 0 ? 'Dist ' + distribStreak + 'd' : 'Neutral');

      // AD Line trend (last 10d)
      if (adLine.length >= 10) {
        const ad10ago = adLine[adLine.length - 10].ad;
        const adNow = adLine[adLine.length - 1].ad;
        const adTrend = adNow > ad10ago ? 'Rising' : adNow < ad10ago ? 'Falling' : 'Flat';
        addSignal('AD Line', '📈', adTrend,
          adTrend === 'Rising', adTrend === 'Falling', '');
      }

      // Bid/Offer Ratio
      addSignal('Bid Ratio', '📊', avgBidRatio.toFixed(1) + '%',
        avgBidRatio >= 55, avgBidRatio <= 40,
        avgBidRatio >= 55 ? 'Buyers dominant' : avgBidRatio <= 40 ? 'Sellers dominant' : 'Balanced');

      // Sector
      if (sectorContext) {
        addSignal('Sector', '🏢', sectorContext.sector,
          sectorContext.fnet_20d > 0, sectorContext.fnet_20d < 0,
          'F.Net 20d: ' + fmtValShort(sectorContext.fnet_20d));
      }

      // RS vs IHSG
      if (rsVsIhsg !== null) {
        addSignal('RS vs IHSG', '💪', (rsVsIhsg > 0 ? '+' : '') + rsVsIhsg + '%',
          rsVsIhsg > 2, rsVsIhsg < -2,
          rsVsIhsg > 0 ? 'Outperform' : 'Underperform');
      }

      // Freq Analysis signal
      if (freqSummary.events > 0) {
        const hasSmartAccum = freqSummary.smart_accum > 0;
        const hasBlock = freqSummary.block_trade > 0;
        const hasDryUp = freqSummary.dry_up > 0 && freqSummary.block_trade === 0 && freqSummary.smart_accum === 0;
        const hasRetail = freqSummary.retail_frenzy > 0;
        let freqLabel = hasSmartAccum ? 'Smart Accum' : hasBlock ? 'Block Trade' : hasDryUp ? 'Dry Up' : hasRetail ? 'Retail Frenzy' : 'Mixed';
        let freqDetail = freqSummary.events + ' events (B:' + freqSummary.block_trade + ' R:' + freqSummary.retail_frenzy + ' S:' + freqSummary.smart_accum + ' D:' + freqSummary.dry_up + ')';
        addSignal('Freq', '📊', freqLabel,
          hasSmartAccum || hasBlock, hasDryUp || (hasRetail && !hasBlock),
          freqDetail);
      }

      // Build verdict
      const verdictScore = totalSignals > 0 ? Math.round(bullSignals / totalSignals * 100) : 50;
      let verdictLabel, verdictColor;
      if (verdictScore >= 75) { verdictLabel = 'STRONG BUY'; verdictColor = '#22c55e'; }
      else if (verdictScore >= 60) { verdictLabel = 'BUY'; verdictColor = '#22c55e'; }
      else if (verdictScore >= 45) { verdictLabel = 'NEUTRAL'; verdictColor = '#f59e0b'; }
      else if (verdictScore >= 30) { verdictLabel = 'SELL'; verdictColor = '#ef4444'; }
      else { verdictLabel = 'STRONG SELL'; verdictColor = '#ef4444'; }

      // Warnings (conflicting signals)
      const warnings = [];
      if (stage.level >= 4 && lastPhase && lastPhase.phase === 'distribution') warnings.push('Price above MAs but distribution detected');
      if (stage.level <= 1 && fnet20 > 0) warnings.push('Downtrend but foreign accumulating — watch for reversal');
      if (avgBidRatio < 40 && lastPhase && lastPhase.phase === 'accumulation') warnings.push('Accumulation phase but bid ratio weak');
      if (scoring && scoring.score_composite >= 70 && stage.level <= 2) warnings.push('High score but price still below key MAs');

      const verdict = { score: verdictScore, label: verdictLabel, color: verdictColor, bull: bullSignals, bear: bearSignals, total: totalSignals, signals, warnings };

      // ── Build chart data: full history (idx_daily sejak 2020) ──
      // Hari TANPA transaksi (suspensi/iliquid) tetap ditampilkan di chart — jangan dihapus —
      // tapi OHLC-nya dinormalkan ke close supaya low=0 tidak menarik sumbu ke nol.
      // Fakta "tidak diperdagangkan" disimpan di no_trade untuk label/legenda.
      // Catatan: setelah perbaikan price-adjust (23 Okt 2026) `ao` benar-benar berisi
      // open_price dan bisa 0 untuk saham tipis yang tidak melaporkan open, jadi chart
      // butuh fallback sendiri — mesin backtest sengaja TIDAK diberi fallback agar
      // fillBlocked menolak bar seperti itu.
      const chartData = data.map((r) => {
        const noTrade = Number(r.volume || 0) === 0 && (!r.al || r.al <= 0);
        const px = r.ac;
        const ao = r.ao > 0 ? r.ao : px;
        return {
          date: r.trade_date,
          open: noTrade ? px : ao,
          high: noTrade ? px : r.ah,
          low: noTrade ? px : r.al,
          close: r.ac,
          no_trade: noTrade,
          volume: r.volume, frequency: r.frequency || 0, fnet: r.fnet, bid_vol: r.bid_vol || 0, offer_vol: r.offer_vol || 0,
          value: r.value || null, fbuy: r.foreign_buy || 0, fsell: r.foreign_sell || 0,
          tradeable: r.tradeable_shares || 0, bid_price: r.bid || 0, offer_price: r.offer || 0
        };
      });

      const adChartData = adLine.slice(-500).map(r => ({ date: r.date, ad: r.ad }));

      // ── 7h. Financials v2: kuartalan (de-cumulated), band valuasi, peer ──
      // ── TTM profit (basis sama dengan EPS) ──
      // Supaya tidak membandingkan laba kuartalan dengan EPS TTM seperti sebelumnya.
      let ttmProfit = null;
      try {
        const ttmAt = (list, i) => {
          const cur = list[i];
          if (!cur) return null;
          const m = String(cur.period).slice(5, 7);
          if (m === '12') return cur.profit;
          const prevY = String(parseInt(String(cur.period).slice(0, 4)) - 1);
          const fy = list.filter(x => x.period === prevY + '-12-31')[0];
          const prevSame = list.filter(x => x.period === prevY + String(cur.period).slice(4))[0];
          if (!fy) return null;
          return fy.profit + cur.profit - (prevSame ? prevSame.profit : 0);
        };
        const li2 = fundHistory.length - 1;
        const now = ttmAt(fundHistory, li2);
        const prev = li2 >= 4 ? ttmAt(fundHistory, li2 - 4) : null;
        if (now != null) {
          ttmProfit = {
            value: Math.round(now * 100) / 100,
            yoy: (prev && prev !== 0) ? Math.round((now - prev) / Math.abs(prev) * 10000) / 100 : null
          };
        }
      } catch (e) {}

      let quarterlySeries = [];
      let annualSeries = [];
      let valuationBand = [];
      let peerMedian = null;
      try {
        const byYear = {};
        fundHistory.forEach(r => {
          const y = String(r.period).slice(0, 4), m = parseInt(String(r.period).slice(5, 7));
          (byYear[y] = byYear[y] || []).push({ ...r, m });
        });
        const qname = m => (m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'Q4');
        Object.keys(byYear).sort().forEach(y => {
          const yr = byYear[y].sort((a, b) => a.m - b.m);
          // Basis FY bisa beda PER FIELD: ADRO 2024 punya sales FY standalone
          // (33.593 < YTD Q3 67.416) tapi profit FY kumulatif (25.148 > 20.076).
          const fyr = yr.filter(r => r.m === 12)[0];
          const q3r = yr.filter(r => r.m === 9)[0];
          const cum = (k) => !(fyr && q3r && fyr[k] < q3r[k] * 0.95);
          const cumS = cum('sales'), cumP = cum('profit'), cumE = cum('ebt');
          let prevS = 0, prevP = 0, prevE = 0;
          yr.forEach(r => {
            const qS = (!cumS && r.m === 12) ? r.sales : (r.sales || 0) - prevS;
            const qP = (!cumP && r.m === 12) ? r.profit : (r.profit || 0) - prevP;
            const qE = (!cumE && r.m === 12) ? r.ebt : (r.ebt || 0) - prevE;
            quarterlySeries.push({
              period: r.period, label: y.slice(2) + ' ' + qname(r.m),
              sales: qS > 0 ? qS : null, profit: qP, ebt: qE,
              assets: r.assets, equity: r.equity, liabilities: r.liabilities,
              sales_ytd: r.sales, profit_ytd: r.profit,
              eps: r.eps, roe: r.roe, roa: r.roa, der: r.der,
              npm: qS > 0 ? Math.round(qP / qS * 10000) / 100 : null
            });
            prevS = r.sales || 0; prevP = r.profit || 0; prevE = r.ebt || 0;
          });
        });
        // Seri TAHUNAN = jumlah kuartalan (bukan baris FY, yang basisnya campur)
        const qAll = quarterlySeries.slice();
        quarterlySeries = quarterlySeries.slice(-12);
        const byYr = {};
        qAll.forEach(x => { const y = x.period.slice(0, 4); (byYr[y] = byYr[y] || []).push(x); });
        annualSeries = Object.keys(byYr).sort().slice(-6).map(y => {
          const rows = byYr[y];
          const lastR = rows[rows.length - 1];
          return {
            year: y, label: y,
            sales: Math.round(rows.reduce((a, r) => a + (r.sales || 0), 0) * 100) / 100,
            profit: Math.round(rows.reduce((a, r) => a + (r.profit || 0), 0) * 100) / 100,
            eps: lastR.eps, roe: lastR.roe,
            assets: lastR.assets, equity: lastR.equity, liabilities: lastR.liabilities,
            quarters: rows.length
          };
        });
      } catch (e) {}

      try {
        valuationBand = fundHistory.map(r => {
          const px = db.prepare('SELECT close FROM idx_daily WHERE code=? AND trade_date<=? AND close>0 ORDER BY trade_date DESC LIMIT 1').get(code, r.period);
          const close = px ? px.close : null;
          return {
            period: r.period,
            label: r.period_label,
            close,
            eps: r.eps,
            book_value: r.book_value,
            per: close && r.eps > 0 ? Math.round(close / r.eps * 100) / 100 : null,
            pbv: close && r.book_value > 0 ? Math.round(close / r.book_value * 100) / 100 : null
          };
        }).filter(x => x.per != null || x.pbv != null);
      } catch (e) {}

      try {
        if (fundamental && fundamental.sector) {
          const rows = db.prepare(`SELECT per, pbv, roe,
                 (CASE WHEN sales > 0 THEN profit * 100.0 / sales END) AS npm
                 FROM financial_ratios WHERE sector=? AND period=?`).all(fundamental.sector, fundamental.period);
          rows.forEach(r => { r.roe = sdNormPct(r.roe); });
          const med = (arr) => {
            const v = arr.filter(x => x != null && x !== 0).sort((a, b) => a - b);
            if (!v.length) return null;
            const m = Math.floor(v.length / 2);
            return Math.round((v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) * 100) / 100;
          };
          peerMedian = {
            sector: fundamental.sector, period: fundamental.period, n: rows.length,
            per: med(rows.map(r => r.per)), pbv: med(rows.map(r => r.pbv)),
            roe: med(rows.map(r => r.roe)), npm: med(rows.map(r => r.npm))
          };
        }
      } catch (e) {}

      res.json({
        code, name: last.name || '',
        current: { close: last.ac, prev_close: last.prev_close, change: last.ac - (data[n - 2]?.ac || last.ac), trade_date: last.trade_date, volume: last.volume, value: last.value, market_cap: last.ac * (last.listed_shares || 0) },
        phase: lastPhase,
        phases: phaseResult.slice(-60),
        stage,
        ma_respect: maRespect,
        verdict,
        sector_context: sectorContext,
        market_regime: marketRegime,
        announcements: announcements,
        commodity_context: commodityContext,
        freq_analysis: freqSummary,
        freq_events: freqAnalysis.slice(-100),
        stats: { peak_52w: peak52w, low_52w: low52w, drawdown_from_peak: drawdownFromPeak, pct_from_low: pctFromLow, atr, volatility_ann: volatility, rs_vs_ihsg: rsVsIhsg, total_days: n },
        foreign: { fnet_5d: fnet5, fnet_10d: fnet10, fnet_20d: fnet20, fnet_total: fnetTotal,
                   fnet_total_since: data.length ? data[0].trade_date : null,
                   fnet_total_days: data.length,
                   accum_streak: accumStreak, distrib_streak: distribStreak },
        bid_offer: { data: boData, avg_ratio: avgBidRatio },
        scoring, score_history: scoreHist || [],
        fundamental,
        ownership,
        dividend_history: dividendHistory,
        ca_timeline: caTimeline,

        fund_growth: fundGrowth,
        fund_history: fundHistory,
        quarterly: quarterlySeries,
        annual_series: annualSeries,
        dps_by_year: (function () {
          const m = {};
          (dividendHistory || []).forEach(x => {
            if (x.dps > 0 && x.cum_date) {
              const y = String(x.cum_date).slice(0, 4);
              m[y] = Math.round(((m[y] || 0) + x.dps) * 100) / 100;
            }
          });
          return Object.keys(m).sort().map(y => ({ year: y, dps: m[y] }));
        })(),
        ttm_profit: ttmProfit,
        valuation_band: valuationBand,
        peers: peerMedian,
        shares_outstanding: last.listed_shares || null,
        provenance: {
          period: fundamental ? fundamental.period : null,
          quarters: fundHistory.length,
          source: 'financial_ratios',
          sales_profit_basis: 'YTD kumulatif',
          eps_roe_basis: 'TTM / annualized'
        },
        daily_valuation: dailyValuation,
        corporate_adjustments: detectedCA,
        chart: chartData,
        ad_line: adChartData
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ Market News — Hot headlines for Market Regime ═══
  router.get('/market-news', async (req, res) => {
    try {
      const { gNews } = require('../utils/news');
      
      const queries = [
        { q: 'IHSG bursa saham when:3d', label: 'IDX Market', icon: '📊' },
        { q: 'Bank Indonesia ekonomi rupiah when:3d', label: 'Ekonomi & BI', icon: '🏛' },
        { q: 'coal oil nickel gold commodity price when:3d', label: 'Komoditas', icon: '⛏' },
        { q: 'geopolitik perang tarif dagang when:7d', label: 'Geopolitik', icon: '🌍' },
        { q: 'Fed Wall Street S&P 500 stock market when:3d', label: 'Global Markets', icon: '🇺🇸' },
      ];

      const results = await Promise.all(queries.map(async (cat) => {
        try {
          const items = await gNews(cat.q);
          return { ...cat, items: items.slice(0, 8) };
        } catch (e) {
          return { ...cat, items: [] };
        }
      }));
      
      const now = Math.floor(Date.now() / 1000);
      const categories = results.map(r => ({
        label: r.label,
        icon: r.icon,
        items: r.items
          .filter(item => !item.datetime || (now - item.datetime) < 7 * 86400)
          .map(item => ({
            headline: item.headline,
            source: item.source,
            url: item.url,
            datetime: item.datetime,
            age: item.datetime > 0 ? _fmtAge(now - item.datetime) : ''
          }))
      }));

      res.json({ categories, fetched_at: new Date().toISOString() });
    } catch (e) {
      res.json({ categories: [], error: e.message });
    }
  });

  function _fmtAge(seconds) {
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago';
    return Math.floor(seconds / 604800) + 'w ago';
  }

  // ═══════════════════════════════════════════════════════════════════
  // BEI DATA UPLOAD — Auto-detect + Preview + Commit
  // ═══════════════════════════════════════════════════════════════════

  const path=require('path');
  const beiUpload = require('multer')({
    dest: '/tmp/bei-uploads/',
    limits: { fileSize: 100 * 1024 * 1024 }
  });

  // ── Table migrations (individual statements to avoid SQLite multi-exec issues) ──
  db.exec("CREATE TABLE IF NOT EXISTS _bei_upload_log (id INTEGER PRIMARY KEY AUTOINCREMENT, uploaded_at TEXT DEFAULT (datetime('now')), file_type TEXT NOT NULL, file_name TEXT DEFAULT '', snapshot TEXT DEFAULT '', rows_inserted INTEGER DEFAULT 0, rows_skipped INTEGER DEFAULT 0, rows_updated INTEGER DEFAULT 0)");
  db.exec("CREATE TABLE IF NOT EXISTS balance_position (snapshot_date TEXT NOT NULL, code TEXT NOT NULL, sec_num INTEGER DEFAULT 0, price REAL DEFAULT 0, local_is INTEGER DEFAULT 0, local_cp INTEGER DEFAULT 0, local_pf INTEGER DEFAULT 0, local_ib INTEGER DEFAULT 0, local_id INTEGER DEFAULT 0, local_mf INTEGER DEFAULT 0, local_sc INTEGER DEFAULT 0, local_fd INTEGER DEFAULT 0, local_ot INTEGER DEFAULT 0, local_total INTEGER DEFAULT 0, foreign_is INTEGER DEFAULT 0, foreign_cp INTEGER DEFAULT 0, foreign_pf INTEGER DEFAULT 0, foreign_ib INTEGER DEFAULT 0, foreign_id INTEGER DEFAULT 0, foreign_mf INTEGER DEFAULT 0, foreign_sc INTEGER DEFAULT 0, foreign_fd INTEGER DEFAULT 0, foreign_ot INTEGER DEFAULT 0, foreign_total INTEGER DEFAULT 0, PRIMARY KEY (snapshot_date, code))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_bp_code ON balance_position(code)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_bp_date ON balance_position(snapshot_date)");
  db.exec("CREATE TABLE IF NOT EXISTS bei_corporate_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, issuer TEXT DEFAULT '', security_name TEXT DEFAULT '', ca_type TEXT NOT NULL, cum_date TEXT DEFAULT '', recording_date TEXT DEFAULT '', dist_date TEXT DEFAULT '', exercise_ratio REAL DEFAULT 0, exercise_instr TEXT DEFAULT '', proceed_ratio REAL DEFAULT 0, proceed_instr TEXT DEFAULT '', description TEXT DEFAULT '', ref_no TEXT DEFAULT '', letter_date TEXT DEFAULT '', year INTEGER DEFAULT 0, UNIQUE(code, ca_type, cum_date))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_bca_code ON bei_corporate_actions(code)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_bca_type ON bei_corporate_actions(ca_type)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_bca_cum ON bei_corporate_actions(cum_date)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_bca_year ON bei_corporate_actions(year)");
  db.exec("CREATE TABLE IF NOT EXISTS bei_dividends (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, div_type TEXT DEFAULT 'final', cum_date TEXT NOT NULL, recording_date TEXT DEFAULT '', payment_date TEXT DEFAULT '', dps REAL NOT NULL DEFAULT 0, year INTEGER DEFAULT 0, UNIQUE(code, cum_date))");
  db.exec("CREATE INDEX IF NOT EXISTS idx_bdiv_code ON bei_dividends(code)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_bdiv_year ON bei_dividends(year)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_bdiv_cum ON bei_dividends(cum_date)");

  // Migrate idx_fundamental — add new columns if missing
  (function() {
    try {
      const cols = db.pragma('table_info(idx_fundamental)').map(c => c.name);
      const adds = [
        ['sub_ind_code','TEXT DEFAULT ""'],['sharia','INTEGER DEFAULT 0'],
        ['fs_date','TEXT DEFAULT ""'],['fiscal_year','TEXT DEFAULT ""'],
        ['fs_type','TEXT DEFAULT ""'],['auditor_opinion','TEXT DEFAULT ""'],
        ['assets','REAL DEFAULT 0'],['liabilities','REAL DEFAULT 0'],
        ['equity','REAL DEFAULT 0'],['sales','REAL DEFAULT 0'],
        ['ebt','REAL DEFAULT 0'],['profit','REAL DEFAULT 0'],
        ['profit_attr','REAL DEFAULT 0'],['eps_trailing','REAL DEFAULT 0'],
        ['book_value','REAL DEFAULT 0']
      ];
      for (const [col, def] of adds) {
        if (!cols.includes(col)) {
          try { db.exec(`ALTER TABLE idx_fundamental ADD COLUMN ${col} ${def}`); } catch(_) {}
        }
      }
    } catch(_) {}
  })();

  // ── Helpers ──
  const BEI_MONTHS = {
    JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
    JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12',
    JANUARY:'01',FEBRUARY:'02',MARCH:'03',APRIL:'04',JUNE:'06',
    JULY:'07',AUGUST:'08',SEPTEMBER:'09',OCTOBER:'10',NOVEMBER:'11',DECEMBER:'12'
  };

  function parseBeiDate(s) {
    if (!s) return '';
    // Excel serial date number (e.g., 46020 = 2025-12-29)
    if (typeof s === 'number' && s > 30000 && s < 60000) {
      const d = new Date((s - 25569) * 86400000);
      return d.toISOString().split('T')[0];
    }
    if (typeof s !== 'string') s = String(s);
    s = s.trim();
    const m = s.match(/^(\d{1,2})-([A-Z]+)-(\d{4})$/i);
    if (m) { const mm = BEI_MONTHS[m[2].toUpperCase()]; if (mm) return `${m[3]}-${mm}-${m[1].padStart(2,'0')}`; }
    const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m2) return `${m2[3]}-${m2[1]}-${m2[2]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return s;
  }

  function beiSnapshotFromFilename(fn) {
    const m = fn.match(/[_-]\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[_\s]*(\d{4})/i);
    if (m) { const mm = BEI_MONTHS[m[1].toUpperCase().substring(0,3)]; return `${m[2]}-${mm}`; }
    const y = fn.match(/(\d{4})/); return y ? y[1] : '';
  }

  function detectBeiFileType(firstLine, fn) {
    const fl = (firstLine||'').toLowerCase();
    const f = (fn||'').toLowerCase();
    if (/financial data and ratio/i.test(firstLine)) return {type:'financial_data',label:'Financial Data & Ratio'};
    if (firstLine.includes('|') && /sec\. num/i.test(firstLine)) return {type:'balance_position',label:'Balance Position'};
    if (/cash dividend/i.test(firstLine)) return {type:'ca_dividend',label:'Cash Dividend'};
    if (/right distribution/i.test(firstLine)) return {type:'ca_rights',label:'Rights Issue (HMETD)'};
    if (/stock split/i.test(firstLine)) return {type:'ca_split',label:'Stock Split'};
    if (/reverse stock/i.test(firstLine)) return {type:'ca_reverse',label:'Reverse Stock'};
    if (/bonus/i.test(firstLine) && !/obligasi/i.test(firstLine)) return {type:'ca_bonus',label:'Bonus Shares'};
    if (/merger/i.test(firstLine) && f.includes('merger')) return {type:'ca_merger',label:'Merger'};
    if (/proxy voting/i.test(firstLine)) return {type:'ca_proxy',label:'Proxy Voting (RUPS)'};
    if (/interest recording/i.test(firstLine)) return {type:'ca_interest',label:'Interest / Coupon'};
    if (/mandatory conversion/i.test(firstLine)) return {type:'ca_conversion',label:'Mandatory Conversion'};
    if (/schedule of corporate action/i.test(firstLine)) return {type:'ca_master',label:'Corporate Action (Master)'};
    if (f.includes('balancepos')) return {type:'balance_position',label:'Balance Position'};
    if (f.includes('div_')) return {type:'ca_dividend',label:'Cash Dividend'};
    if (f.includes('right_')) return {type:'ca_rights',label:'Rights Issue (HMETD)'};
    if (f.includes('bonu_')) return {type:'ca_bonus',label:'Bonus Shares'};
    if (f.includes('prox_')) return {type:'ca_proxy',label:'Proxy Voting (RUPS)'};
    if (f.includes('int_')) return {type:'ca_interest',label:'Interest / Coupon'};
    if (f.includes('mconv_')) return {type:'ca_conversion',label:'Mandatory Conversion'};
    if (f.includes('merger')) return {type:'ca_merger',label:'Merger'};
    return null;
  }

  // ── Parsers ──
  function parseFinancialData(filePath, filename) {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const allRows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
    let dataStart = -1;
    for (let i=0; i<Math.min(10,allRows.length); i++) {
      if (/^[A-Z]{4,5}$/.test(String(allRows[i][4]||'').trim())) { dataStart=i; break; }
    }
    if (dataStart<0) return {error:'Cannot find data rows — no stock codes detected'};
    const snapshot = beiSnapshotFromFilename(filename);
    if (!snapshot) return {error:'Cannot determine snapshot month from filename'};
    const parsed=[], skipped=[];
    for (let i=dataStart; i<allRows.length; i++) {
      const r=allRows[i]; const code=String(r[4]||'').trim().toUpperCase();
      if (!code || !/^[A-Z]{4,5}$/.test(code)) { if(code)skipped.push('Row '+(i+1)+': invalid code "'+code+'"'); continue; }
      parsed.push({
        snapshot_month:snapshot, code, name:String(r[5]||'').trim(),
        sector:String(r[1]||'').trim(), sub_ind_code:String(r[2]||'').trim(),
        industry:String(r[3]||'').trim(), sharia:String(r[6]||'').trim().toUpperCase()==='S'?1:0,
        fs_date:String(r[7]||'').trim(), fiscal_year:String(r[8]||'').trim(),
        fs_type:String(r[9]||'').trim(), auditor_opinion:String(r[10]||'').replace(/^-$/,'').trim(),
        assets:parseFloat(r[11])||0, liabilities:parseFloat(r[12])||0, equity:parseFloat(r[13])||0,
        sales:parseFloat(r[14])||0, ebt:parseFloat(r[15])||0, profit:parseFloat(r[16])||0,
        profit_attr:parseFloat(r[17])||0, eps_trailing:parseFloat(r[18])||0, book_value:parseFloat(r[19])||0,
        per:parseFloat(r[20])||0, pbv:parseFloat(r[21])||0, der:parseFloat(r[22])||0,
        roa:parseFloat(r[23])||0, roe:parseFloat(r[24])||0, npm:parseFloat(r[25])||0
      });
    }
    let conflicts=0;
    try { conflicts=db.prepare('SELECT COUNT(*)as c FROM idx_fundamental WHERE snapshot_month=?').get(snapshot)?.c||0; } catch(_){}
    return {
      type:'financial_data', label:'Financial Data & Ratio', snapshot,
      total_rows:parsed.length, skipped_rows:skipped.length, conflicts,
      warnings:[...skipped.slice(0,5),...(conflicts>0?[conflicts+' existing rows for '+snapshot+' will be overwritten']:[])],
      columns:['code','name','sector','industry','assets','equity','eps_trailing','roe','npm'],
      sample:parsed.slice(0,10).map(r=>({code:r.code,name:r.name.substring(0,30),sector:r.sector,industry:r.industry,assets:r.assets,equity:r.equity,eps_trailing:r.eps_trailing,roe:r.roe,npm:r.npm})),
      _data:parsed
    };
  }

  function parseBalancePosition(filePath) {
    const raw = require('fs').readFileSync(filePath,'utf-8');
    const lines = raw.replace(/\r/g,'').split('\n').filter(l=>l.trim());
    if (!lines.length) return {error:'Empty file'};
    const parsed=[], skipped=[]; let snapshotDate='';
    for (let i=1; i<lines.length; i++) {
      const cols=lines[i].split('|');
      if (cols.length<25) { skipped.push('Row '+(i+1)+': insufficient columns'); continue; }
      if (cols[2]!=='EQUITY') continue;
      const code=(cols[1]||'').trim().toUpperCase();
      if (!code||!/^[A-Z]{4,5}$/.test(code)) { skipped.push('Row '+(i+1)+': invalid code "'+code+'"'); continue; }
      const dateStr=parseBeiDate(cols[0]||'');
      if (!snapshotDate && dateStr) snapshotDate=dateStr;
      parsed.push({
        snapshot_date:dateStr, code, sec_num:parseInt(cols[3])||0, price:parseFloat(cols[4])||0,
        local_is:parseInt(cols[5])||0, local_cp:parseInt(cols[6])||0, local_pf:parseInt(cols[7])||0,
        local_ib:parseInt(cols[8])||0, local_id:parseInt(cols[9])||0, local_mf:parseInt(cols[10])||0,
        local_sc:parseInt(cols[11])||0, local_fd:parseInt(cols[12])||0, local_ot:parseInt(cols[13])||0,
        local_total:parseInt(cols[14])||0,
        foreign_is:parseInt(cols[15])||0, foreign_cp:parseInt(cols[16])||0, foreign_pf:parseInt(cols[17])||0,
        foreign_ib:parseInt(cols[18])||0, foreign_id:parseInt(cols[19])||0, foreign_mf:parseInt(cols[20])||0,
        foreign_sc:parseInt(cols[21])||0, foreign_fd:parseInt(cols[22])||0, foreign_ot:parseInt(cols[23])||0,
        foreign_total:parseInt(cols[24])||0
      });
    }
    let conflicts=0;
    try { conflicts=db.prepare('SELECT COUNT(*)as c FROM balance_position WHERE snapshot_date=?').get(snapshotDate)?.c||0; } catch(_){}
    return {
      type:'balance_position', label:'Balance Position', snapshot:snapshotDate,
      total_rows:parsed.length, skipped_rows:skipped.length, conflicts,
      warnings:[(lines.length-1-parsed.length-skipped.length)+' non-EQUITY rows filtered out',...skipped.slice(0,5),...(conflicts>0?[conflicts+' existing rows for '+snapshotDate+' will be overwritten']:[])],
      columns:['code','sec_num','price','local_total','foreign_total','local_id','local_mf','foreign_mf'],
      sample:parsed.slice(0,10).map(r=>({code:r.code,sec_num:r.sec_num,price:r.price,local_total:r.local_total,foreign_total:r.foreign_total,local_id:r.local_id,local_mf:r.local_mf,foreign_mf:r.foreign_mf})),
      _data:parsed
    };
  }

  function parseCorporateAction(filePath, detectedType, filename) {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const allRows = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
    let headerIdx=-1;
    for (let i=0;i<Math.min(5,allRows.length);i++) {
      if (allRows[i].some(c=>String(c).toLowerCase().includes('security code')||String(c).toLowerCase().includes('no.'))) { headerIdx=i; break; }
    }
    if (headerIdx<0) {
      return { type:detectedType, label:detectBeiFileType('',filename)?.label||detectedType,
        snapshot:beiSnapshotFromFilename(filename), total_rows:0, skipped_rows:0, conflicts:0,
        warnings:['File is empty — no data rows found'], columns:[], sample:[], _data:[], _dividends:[] };
    }
    const TYPE_MAP={ca_dividend:'CASH DIVIDEND',ca_rights:'RIGHT DISTRIBUTION',ca_split:'STOCK SPLIT',ca_reverse:'REVERSE STOCK',ca_bonus:'BONUS SHARES',ca_merger:'MERGER',ca_proxy:'PROXY VOTING',ca_interest:'INTEREST',ca_conversion:'MANDATORY CONVERSION',ca_master:null};
    const forcedType=TYPE_MAP[detectedType]||null;
    const parsed=[], dividends=[], skipped=[];
    const yearFromFilename=filename.match(/(\d{4})/)?.[1]||'';
    for (let i=headerIdx+1;i<allRows.length;i++) {
      const r=allRows[i]; if(!r||r.length<10) continue;
      const code=String(r[2]||'').trim().toUpperCase();
      if (!code||code.length>5||/\d/.test(code)) { if(code)skipped.push('Row '+(i+1)+': skipped "'+code+'" (non-equity)'); continue; }
      const caType=forcedType||String(r[4]||'').trim().toUpperCase();
      if (!caType) continue;
      const cumDate=parseBeiDate(r[5]||''); const recDate=parseBeiDate(r[6]||'');
      const distDate=parseBeiDate(r[7]||''); const exRatio=parseFloat(r[8])||0;
      const procRatio=parseFloat(r[10])||0; const desc=String(r[12]||'').trim();
      const year=cumDate?parseInt(cumDate.substring(0,4)):parseInt(yearFromFilename)||0;
      const row={code, issuer:String(r[1]||'').trim(), security_name:String(r[3]||'').trim(),
        ca_type:caType, cum_date:cumDate, recording_date:recDate, dist_date:distDate,
        exercise_ratio:exRatio, exercise_instr:String(r[9]||'').trim(),
        proceed_ratio:procRatio, proceed_instr:String(r[11]||'').trim(),
        description:desc, ref_no:String(r[13]||'').trim(), letter_date:String(r[14]||'').trim(), year};
      parsed.push(row);
      if (caType==='CASH DIVIDEND' && procRatio>0) {
        dividends.push({code, div_type:/interim/i.test(desc)?'interim':/special/i.test(desc)?'special':'final',
          cum_date:cumDate, recording_date:recDate, payment_date:distDate, dps:procRatio, year});
      }
    }
    return {
      type:detectedType, label:detectBeiFileType('',filename)?.label||detectedType,
      snapshot:yearFromFilename, total_rows:parsed.length, skipped_rows:skipped.length, conflicts:0,
      warnings:[...skipped.slice(0,5),...(skipped.length>5?['... and '+(skipped.length-5)+' more skipped']:[]),
        ...(dividends.length>0?[dividends.length+' dividend records will also be added']:[])],
      columns:['code','ca_type','cum_date','exercise_ratio','proceed_ratio','proceed_instr'],
      sample:parsed.slice(0,10).map(r=>({code:r.code,ca_type:r.ca_type,cum_date:r.cum_date,exercise_ratio:r.exercise_ratio,proceed_ratio:r.proceed_ratio,proceed_instr:r.proceed_instr})),
      _data:parsed, _dividends:dividends
    };
  }

  // ── Commit functions ──
  function commitFinancialData(data) {
    const stmt=db.prepare(`INSERT OR REPLACE INTO idx_fundamental(snapshot_month,code,name,sector,sub_ind_code,industry,sharia,fs_date,fiscal_year,fs_type,auditor_opinion,assets,liabilities,equity,sales,ebt,profit,profit_attr,eps_trailing,book_value,per,pbv,der,roa,roe,npm)VALUES(@snapshot_month,@code,@name,@sector,@sub_ind_code,@industry,@sharia,@fs_date,@fiscal_year,@fs_type,@auditor_opinion,@assets,@liabilities,@equity,@sales,@ebt,@profit,@profit_attr,@eps_trailing,@book_value,@per,@pbv,@der,@roa,@roe,@npm)`);
    let n=0; db.transaction(()=>{for(const r of data){stmt.run(r);n++;}})(); return n;
  }
  function commitBalancePosition(data) {
    const stmt=db.prepare(`INSERT OR REPLACE INTO balance_position(snapshot_date,code,sec_num,price,local_is,local_cp,local_pf,local_ib,local_id,local_mf,local_sc,local_fd,local_ot,local_total,foreign_is,foreign_cp,foreign_pf,foreign_ib,foreign_id,foreign_mf,foreign_sc,foreign_fd,foreign_ot,foreign_total)VALUES(@snapshot_date,@code,@sec_num,@price,@local_is,@local_cp,@local_pf,@local_ib,@local_id,@local_mf,@local_sc,@local_fd,@local_ot,@local_total,@foreign_is,@foreign_cp,@foreign_pf,@foreign_ib,@foreign_id,@foreign_mf,@foreign_sc,@foreign_fd,@foreign_ot,@foreign_total)`);
    let n=0; db.transaction(()=>{for(const r of data){stmt.run(r);n++;}})(); return n;
  }
  function commitCorporateActions(data, divData) {
    const caStmt=db.prepare(`INSERT OR REPLACE INTO bei_corporate_actions(code,issuer,security_name,ca_type,cum_date,recording_date,dist_date,exercise_ratio,exercise_instr,proceed_ratio,proceed_instr,description,ref_no,letter_date,year)VALUES(@code,@issuer,@security_name,@ca_type,@cum_date,@recording_date,@dist_date,@exercise_ratio,@exercise_instr,@proceed_ratio,@proceed_instr,@description,@ref_no,@letter_date,@year)`);
    const divStmt=db.prepare(`INSERT OR REPLACE INTO bei_dividends(code,div_type,cum_date,recording_date,payment_date,dps,year)VALUES(@code,@div_type,@cum_date,@recording_date,@payment_date,@dps,@year)`);
    let ca=0,dv=0;
    db.transaction(()=>{for(const r of data){caStmt.run(r);ca++;} if(divData){for(const r of divData){divStmt.run(r);dv++;}}})();
    return {ca,div:dv};
  }

  // ── API: Preview ──
  router.post('/bei/upload/preview', beiUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({error:'No file uploaded'});
    const fs=require('fs'); const filePath=req.file.path; const filename=req.file.originalname||'';
    try {
      let firstLine=''; const ext=path.extname(filename).toLowerCase();
      if (ext==='.txt'||ext==='.csv') {
        firstLine=fs.readFileSync(filePath,'utf-8').split(/\r?\n/)[0]||'';
      } else {
        const XLSX=require('xlsx'); const wb=XLSX.readFile(filePath);
        const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''});
        firstLine=(rows[0]||[]).join(',');
      }
      const detected=detectBeiFileType(firstLine,filename);
      if (!detected) { fs.unlinkSync(filePath); return res.status(400).json({error:'Cannot auto-detect file type',hint:'Supported: Financial Data XLSX, Balance Position TXT, Corporate Action XLS'}); }
      let result;
      if (detected.type==='financial_data') result=parseFinancialData(filePath,filename);
      else if (detected.type==='balance_position') result=parseBalancePosition(filePath);
      else if (detected.type.startsWith('ca_')) result=parseCorporateAction(filePath,detected.type,filename);
      else { fs.unlinkSync(filePath); return res.status(400).json({error:'Unsupported type: '+detected.type}); }
      if (result.error) { fs.unlinkSync(filePath); return res.status(400).json({error:result.error}); }
      const tmpId='bei_'+Date.now()+'_'+Math.random().toString(36).substring(2,8);
      fs.writeFileSync('/tmp/'+tmpId+'.json', JSON.stringify({type:result.type,label:result.label,snapshot:result.snapshot,filename,data:result._data,dividends:result._dividends||null}));
      fs.unlinkSync(filePath);
      const {_data,_dividends,...preview}=result; preview.file_id=tmpId; preview.source_file=filename;
      res.json(preview);
    } catch(e) { try{fs.unlinkSync(filePath);}catch(_){} res.status(500).json({error:e.message}); }
  });

  // ── API: Commit ──
  router.post('/bei/upload/commit', (req, res) => {
    const {file_id}=req.body; if(!file_id) return res.status(400).json({error:'file_id required'});
    const fs=require('fs'); const tmpPath='/tmp/'+file_id+'.json';
    if (!fs.existsSync(tmpPath)) return res.status(404).json({error:'Preview expired or not found. Please re-upload.'});
    try {
      const payload=JSON.parse(fs.readFileSync(tmpPath,'utf-8')); let result;
      if (payload.type==='financial_data') {
        const n=commitFinancialData(payload.data);
        result={success:true,type:payload.type,label:payload.label,snapshot:payload.snapshot,rows_inserted:n};
      } else if (payload.type==='balance_position') {
        const n=commitBalancePosition(payload.data);
        result={success:true,type:payload.type,label:payload.label,snapshot:payload.snapshot,rows_inserted:n};
      } else if (payload.type.startsWith('ca_')) {
        const r=commitCorporateActions(payload.data,payload.dividends);
        result={success:true,type:payload.type,label:payload.label,snapshot:payload.snapshot,rows_inserted:r.ca,dividends_inserted:r.div};
      } else { return res.status(400).json({error:'Unknown type: '+payload.type}); }
      db.prepare('INSERT INTO _bei_upload_log(file_type,file_name,snapshot,rows_inserted)VALUES(?,?,?,?)').run(payload.type,payload.filename||'',payload.snapshot||'',result.rows_inserted||0);
      fs.unlinkSync(tmpPath);
      res.json(result);
    } catch(e) { res.status(500).json({error:e.message}); }
  });

  // ── API: History + Stats ──
  router.get('/bei/upload/history', (req, res) => {
    try { res.json(db.prepare('SELECT * FROM _bei_upload_log ORDER BY uploaded_at DESC LIMIT 50').all()); }
    catch(e) { res.json([]); }
  });

  router.get('/bei/upload/stats', (req, res) => {
    try {
      const fund=db.prepare('SELECT COUNT(DISTINCT snapshot_month)as snapshots,COUNT(*)as total FROM idx_fundamental').get();
      const bp=db.prepare('SELECT COUNT(DISTINCT snapshot_date)as snapshots,COUNT(*)as total FROM balance_position').get();
      const ca=db.prepare('SELECT COUNT(*)as total FROM bei_corporate_actions').get();
      const div=db.prepare('SELECT COUNT(*)as total,COUNT(DISTINCT code)as tickers FROM bei_dividends').get();
      const fundR=db.prepare('SELECT MIN(snapshot_month)as first,MAX(snapshot_month)as last FROM idx_fundamental').get();
      const bpR=db.prepare('SELECT MIN(snapshot_date)as first,MAX(snapshot_date)as last FROM balance_position').get();
      const caR=db.prepare('SELECT MIN(year)as first,MAX(year)as last FROM bei_corporate_actions WHERE year>0').get();
      res.json({fundamental:{...fund,...fundR},balance_position:{...bp,...bpR},corporate_actions:{...ca,...caR},dividends:div});
    } catch(e) { res.json({error:e.message}); }
  });

  return router;
};