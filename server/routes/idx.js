const express = require('express');
const { db, latestIdxDate } = require('../db');
const { parseTradeDate } = require('../utils/normalize');

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
      const custom = db.prepare('SELECT trade_date, code, open as open_price, high, low, close, volume, 0 as prev_close, 0 as value, 0 as frequency, 0 as foreign_buy, 0 as foreign_sell, 0 as bid_vol, 0 as offer_vol, 0 as listed_shares, 0 as tradeable_shares FROM custom_ohlc WHERE code=? ORDER BY trade_date').all(code);
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

      const ohlc = db.prepare(
        `SELECT trade_date, code, name, open_price, high, low, close, volume, prev_close,
                value, frequency, foreign_buy, foreign_sell, listed_shares, bid_vol, offer_vol
         FROM idx_daily WHERE code=? ORDER BY trade_date`
      ).all(code);

      if (!ohlc.length) {
        // Fallback: check custom_ohlc table
        try {
          const custom = db.prepare(
            `SELECT trade_date, code, open as open_price, high, low, close, volume, 0 as prev_close,
                    0 as value, 0 as frequency, 0 as foreign_buy, 0 as foreign_sell,
                    0 as listed_shares, 0 as bid_vol, 0 as offer_vol
             FROM custom_ohlc WHERE code=? ORDER BY trade_date`
          ).all(code);
          if (custom.length) {
            // Add prev_close
            const data = custom.map((r, i) => {
              const pc = i > 0 ? custom[i-1].close : r.open_price || r.close;
              return { ...r, prev_close: pc, name: '', change: 0,
                adj_open: r.open_price, adj_high: r.high, adj_low: r.low, adj_close: r.close,
                adj_volume: r.volume, cum_factor: 1, _custom: true };
            });
            return res.json({ code, data, actions: [], custom: true });
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

      if (!actions.length) {
        const data = cleaned.map(r => ({
          ...r, adj_open: r.open_price, adj_high: r.high, adj_low: r.low, adj_close: r.close,
          adj_volume: r.volume, cum_factor: 1
        }));
        return res.json({ code, data, actions: [] });
      }

      // Backward: dates BEFORE ex_date get factor applied
      // factor = 1/ratio (ratio = new_shares/old_shares)
      // Split 1:5 → ratio=5, factor=0.2 → old prices shrink
      // Reverse 10:1 → ratio=0.1, factor=10 → old prices grow
      const data = cleaned.map(r => {
        let cumFactor = 1;
        for (const ca of actions) {
          if (r.trade_date < ca.ex_date && ca.ratio > 0 && ca.ratio !== 1) {
            cumFactor *= (1 / ca.ratio);
          }
        }

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

      res.json({ code, data, actions });
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
        const rows = db.prepare(`
          SELECT trade_date,
                 AVG(close) as avg_close,
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
      const maMap = {};
      const maDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT 200').all().map(r => r.trade_date);
      if (maDates.length >= 20) {
        const ma20Dates = maDates.slice(0, 20);
        const ph20 = ma20Dates.map(() => '?').join(',');
        db.prepare(`SELECT code, ROUND(AVG(close)) as ma20 FROM idx_daily WHERE trade_date IN (${ph20}) AND close>0 GROUP BY code`).all(...ma20Dates)
          .forEach(r => { maMap[r.code] = { ma20: r.ma20, ma200: 0 }; });
      }
      if (maDates.length >= 200) {
        const ph200 = maDates.map(() => '?').join(',');
        db.prepare(`SELECT code, ROUND(AVG(close)) as ma200 FROM idx_daily WHERE trade_date IN (${ph200}) AND close>0 GROUP BY code`).all(...maDates)
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

  // ═══ SECTORAL MOVEMENT — historical sector performance from BEI ═══
  router.get('/sectoral', (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days) || 60, 500);
      const rows = db.prepare(`
        SELECT trade_date, sector_name, change_pct FROM sectoral_movement
        WHERE trade_date IN (SELECT DISTINCT trade_date FROM sectoral_movement ORDER BY trade_date DESC LIMIT ?)
        ORDER BY trade_date, sector_name
      `).all(days);
      // Group by sector → time series to compute % change
      const bySector = {};
      rows.forEach(r => {
        if (!bySector[r.sector_name]) bySector[r.sector_name] = [];
        bySector[r.sector_name].push({ date: r.trade_date, val: r.change_pct || 0 });
      });
      // Sort each sector by date, compute daily pct change
      const dateMap = {};
      const sectors = Object.keys(bySector).sort();
      sectors.forEach(sec => {
        const ts = bySector[sec].sort((a, b) => a.date.localeCompare(b.date));
        for (let i = 0; i < ts.length; i++) {
          const dt = ts[i].date;
          if (!dateMap[dt]) dateMap[dt] = {};
          if (i > 0 && ts[i - 1].val > 0) {
            dateMap[dt][sec] = Math.round((ts[i].val - ts[i - 1].val) / ts[i - 1].val * 10000) / 100;
          } else {
            dateMap[dt][sec] = 0;
          }
        }
      });
      const dates = Object.keys(dateMap).sort();
      // Remove first date (no prev to compare)
      if (dates.length > 1) {
        delete dateMap[dates[0]];
        dates.shift();
      }
      res.json({ sectors, dates, data: dateMap, total: rows.length });
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

      function calcMACD(closes) {
        if (closes.length < 26) return { macd: 0, signal: 0, hist: 0 };
        function ema(data, period) {
          const k = 2 / (period + 1);
          let val = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
          for (let i = period; i < data.length; i++) val = data[i] * k + val * (1 - k);
          return val;
        }
        const ema12 = ema(closes, 12);
        const ema26 = ema(closes, 26);
        const macdVal = ema12 - ema26;
        // Approximate signal (9-period EMA of MACD line)
        // For simplicity, compute MACD for last 9 points
        const macdLine = [];
        for (let i = Math.max(26, closes.length - 9); i <= closes.length; i++) {
          const sub = closes.slice(0, i);
          const e12 = ema(sub, 12);
          const e26 = ema(sub, 26);
          macdLine.push(e12 - e26);
        }
        const signal = macdLine.length >= 9 ? ema(macdLine, Math.min(9, macdLine.length)) : macdVal;
        return { macd: Math.round(macdVal * 100) / 100, signal: Math.round(signal * 100) / 100, hist: Math.round((macdVal - signal) * 100) / 100 };
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
            const rows = db.prepare('SELECT trade_date, close FROM custom_ohlc WHERE code=? ORDER BY trade_date DESC LIMIT 30').all(oc);
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
        const closes = hist.map(r => r.close);
        const fnets = hist.map(r => (r.foreign_buy - r.foreign_sell) * r.close);

        // MAs
        const ma5 = Math.round(calcMA(closes, 5));
        const ma10 = Math.round(calcMA(closes, 10));
        const ma20 = Math.round(calcMA(closes, 20));
        const ma50 = Math.round(calcMA(closes, 50));
        const ma200 = Math.round(calcMA(closes, 200));
        const ma5_pct = ma5 > 0 ? Math.round((s.close - ma5) / ma5 * 10000) / 100 : 0;
        const ma10_pct = ma10 > 0 ? Math.round((s.close - ma10) / ma10 * 10000) / 100 : 0;
        const ma20_pct = ma20 > 0 ? Math.round((s.close - ma20) / ma20 * 10000) / 100 : 0;
        const ma50_pct = ma50 > 0 ? Math.round((s.close - ma50) / ma50 * 10000) / 100 : 0;
        const ma200_pct = ma200 > 0 ? Math.round((s.close - ma200) / ma200 * 10000) / 100 : 0;
        const rsi14 = calcRSI(closes, 14);
        const macd = calcMACD(closes);

        // Returns
        const ret_5d = closes.length >= 6 ? Math.round((s.close - closes[closes.length - 6]) / closes[closes.length - 6] * 10000) / 100 : 0;
        const ret_20d = closes.length >= 21 ? Math.round((s.close - closes[closes.length - 21]) / closes[closes.length - 21] * 10000) / 100 : 0;

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
        w_fundamental,w_valuation,w_momentum,w_demand,w_foreign)
        VALUES(${Array(56).fill('?').join(',')})`);
      db.transaction(() => {
        top.forEach(r => {
          insScore.run(td, r.code, r.name, r.close, r.change_pct, r.sector, r.industry, r.market_cap,
            r.score_fundamental, r.score_valuation, r.score_momentum, r.score_demand, r.score_foreign, r.score_composite,
            r.roe, r.roa, r.npm, r.der, r.per, r.pbv, r.per_vs_ind, r.pbv_vs_ind, r.div_yield,
            r.ma5, r.ma10, r.ma20, r.ma50, r.ma200, r.ma5_pct, r.ma10_pct, r.ma20_pct, r.ma50_pct, r.ma200_pct,
            r.rsi14, r.macd, r.macd_signal, r.macd_hist, r.ret_5d, r.ret_20d, r.fnet_5d, r.fnet_dir,
            r.bid_offer_ratio, r.bid_offer_5d, r.rel_vol, r.freq_spike, r.val_spike,
            r.fnet_10d, r.fnet_20d, r.foreign_pct_val, r.foreign_accum_streak, r.fnet_vs_avg,
            wF, wV, wM, wD, wFR);
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
    try {
      const { from, to, w_fundamental, w_valuation, w_momentum, w_demand, w_foreign, point_in_time } = req.body || {};
      if (!from || !to) return res.status(400).json({ error: 'from and to required (YYYY-MM-DD)' });
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
      // Industry medians — also per-snapshot for PIT mode
      const indMedianCache = {};
      function getIndMedian(snapshot) {
        if (!snapshot) return {};
        if (indMedianCache[snapshot]) return indMedianCache[snapshot];
        indMedianCache[snapshot] = {};
        db.prepare('SELECT industry, AVG(per) as avg_per, AVG(pbv) as avg_pbv FROM idx_fundamental WHERE snapshot_month=? AND per>0 AND per<200 AND pbv>0 AND pbv<50 GROUP BY industry').all(snapshot)
          .forEach(r => { indMedianCache[snapshot][r.industry] = r; });
        return indMedianCache[snapshot];
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
            const rows = db.prepare('SELECT trade_date, close FROM custom_ohlc WHERE code=? ORDER BY trade_date DESC LIMIT 30').all(oc);
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
      function calcMACD(closes) {
        if (closes.length < 26) return { macd: 0, signal: 0, hist: 0 };
        function ema(data, p) { const k = 2 / (p + 1); let v = data.slice(0, p).reduce((s, x) => s + x, 0) / p; for (let i = p; i < data.length; i++) v = data[i] * k + v * (1 - k); return v; }
        const m = ema(closes, 12) - ema(closes, 26);
        const ml = []; for (let i = Math.max(26, closes.length - 9); i <= closes.length; i++) { const sub = closes.slice(0, i); ml.push(ema(sub, 12) - ema(sub, 26)); }
        const sig = ml.length >= 9 ? ema(ml, Math.min(9, ml.length)) : m;
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

      const insScore = db.prepare(`INSERT OR REPLACE INTO daily_scores(calc_date,code,name,close,change_pct,sector,industry,market_cap,
        score_fundamental,score_valuation,score_momentum,score_demand,score_foreign,score_composite,
        roe,roa,npm,der,per,pbv,per_vs_ind,pbv_vs_ind,div_yield,
        ma5,ma10,ma20,ma50,ma200,ma5_pct,ma10_pct,ma20_pct,ma50_pct,ma200_pct,
        rsi14,macd,macd_signal,macd_hist,ret_5d,ret_20d,fnet_5d,fnet_dir,
        bid_offer_ratio,bid_offer_5d,rel_vol,freq_spike,val_spike,
        fnet_10d,fnet_20d,foreign_pct_val,foreign_accum_streak,fnet_vs_avg,
        w_fundamental,w_valuation,w_momentum,w_demand,w_foreign,
        fund_snapshot_month,data_age_months)
        VALUES(${Array(58).fill('?').join(',')})`);

      let totalScored = 0;

      db.transaction(() => {
        tradeDates.forEach(td => {
          // Get PIT or global fundamental data for this trade date
          const { map: fundMap, snapshot: usedSnap } = getPITFundMap(td);
          const indMedian = getIndMedian(usedSnap);
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

            // Build close array (pre + current up to this date)
            const pre = preHist[code] || [];
            const cur = series.slice(0, idx + 1);
            const allCloses = [...pre.map(x => x.close), ...cur.map(x => x.close)];
            const allFnets = [...pre.map(x => (x.foreign_buy - x.foreign_sell) * x.close), ...cur.map(x => (x.foreign_buy - x.foreign_sell) * x.close)];
            const allBidVols = [...pre.map(x => x.bid_vol || 0), ...cur.map(x => x.bid_vol || 0)];
            const allOfferVols = [...pre.map(x => x.offer_vol || 0), ...cur.map(x => x.offer_vol || 0)];
            const allVolumes = [...pre.map(x => x.volume || 0), ...cur.map(x => x.volume || 0)];
            const allValues = [...pre.map(x => x.value || 0), ...cur.map(x => x.value || 0)];
            const allFreqs = [...pre.map(x => x.frequency || 0), ...cur.map(x => x.frequency || 0)];
            const allFBuys = [...pre.map(x => (x.foreign_buy || 0) * x.close), ...cur.map(x => (x.foreign_buy || 0) * x.close)];
            const allFSells = [...pre.map(x => (x.foreign_sell || 0) * x.close), ...cur.map(x => (x.foreign_sell || 0) * x.close)];

            const fund = fundMap[code] || {};
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
            const ret5 = allCloses.length >= 6 ? Math.round((r.close - allCloses[allCloses.length - 6]) / allCloses[allCloses.length - 6] * 10000) / 100 : 0;
            const ret20 = allCloses.length >= 21 ? Math.round((r.close - allCloses[allCloses.length - 21]) / allCloses[allCloses.length - 21] * 10000) / 100 : 0;
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
              ma5_pct: ma5 > 0 ? Math.round((r.close - ma5) / ma5 * 10000) / 100 : 0,
              ma10_pct: ma10 > 0 ? Math.round((r.close - ma10) / ma10 * 10000) / 100 : 0,
              ma20_pct: ma20 > 0 ? Math.round((r.close - ma20) / ma20 * 10000) / 100 : 0,
              ma50_pct: ma50 > 0 ? Math.round((r.close - ma50) / ma50 * 10000) / 100 : 0,
              ma200_pct: ma200 > 0 ? Math.round((r.close - ma200) / ma200 * 10000) / 100 : 0,
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
              usedSnap, r._fs_age);
          });
          totalScored += top.length;
        });
      })();

      res.json({ ok: true, dates_processed: tradeDates.length, total_scored: totalScored, from: tradeDates[0], to: tradeDates[tradeDates.length - 1] });
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
        const fwdPrices = {};
        const codes = scores.map(s => s.code);
        const ph = codes.map(() => '?').join(',');
        db.prepare(`SELECT code, close FROM idx_daily WHERE trade_date=? AND code IN (${ph})`).all(fwdDate, ...codes)
          .forEach(r => { fwdPrices[r.code] = r.close; });

        // Compute returns and rank correlation (Spearman)
        const pairs = [];
        scores.forEach(s => {
          const fwdClose = fwdPrices[s.code];
          if (!fwdClose || !s.close) return;
          const ret = (fwdClose - s.close) / s.close * 100;
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
    try {
      const rows = db.prepare('SELECT calc_date, COUNT(*) as stocks, ROUND(AVG(score_composite),1) as avg_score FROM daily_scores GROUP BY calc_date ORDER BY calc_date DESC LIMIT 250').all();
      res.json({ dates: rows });
    } catch (e) { res.json({ dates: [] }); }
  });

  // ═══ CLEAR BACKFILL DATA ═══
  router.post('/composite-score/clear', (req, res) => {
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
          db.prepare(`SELECT code, close FROM idx_daily WHERE trade_date=? AND code IN (${ph})`).all(fwdDate, ...codes)
            .forEach(r => { fwdPrices[r.code] = r.close; });

          const pairs = [];
          scores.forEach(s => {
            const fp = fwdPrices[s.code];
            if (!fp || !s.close) return;
            pairs.push({ code: s.code, ret: (fp - s.close) / s.close * 100,
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
        db.prepare(`SELECT code, close FROM idx_daily WHERE trade_date=? AND code IN (${ph})`).all(fwdDate, ...codes)
          .forEach(r => { fwdMap[r.code] = r.close; });

        // Build return map
        const retMap = {};
        scores.forEach(s => {
          if (fwdMap[s.code] && s.close > 0) retMap[s.code] = (fwdMap[s.code] - s.close) / s.close * 100;
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
        db.prepare(`SELECT code, close FROM idx_daily WHERE trade_date=? AND code IN (${ph})`).all(fwdDate, ...codes)
          .forEach(r => { fwdPrices[r.code] = r.close; });

        const pairs = [];
        for (const s of scores) {
          const fp = fwdPrices[s.code];
          if (!fp || !s.close || s.close <= 0) continue;
          pairs.push({
            code: s.code,
            f: s.score_fundamental || 0,
            v: s.score_valuation || 0,
            m: s.score_momentum || 0,
            d: s.score_demand || 0,
            r: s.score_foreign || 0,
            ret: (fp - s.close) / s.close * 100
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

  // --- Import Financial Ratios ---
  router.post('/sync/financial-ratios', (req, res) => {
    try {
      const result = idxBridge.importFinancialRatios(db);
      logSync('financial_ratios', '', result.rows, 'ok', 'bridge');
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

  // --- Import All (one-click) ---
  router.post('/sync/import-all', (req, res) => {
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
        ['announcement', 'importCompanyAnnouncement'], ['foreign', 'importForeignTrading'],
        ['domestic', 'importDomesticTrading'], ['industry', 'importIndustryTrading'],
        ['sectoral', 'importSectoralMovement'], ['daily_index', 'importDailyIndex'],
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
        ['fin_ratios', 'importFinancialRatiosFull']
      ];
      for (const [key, fn] of extras) {
        try { if (typeof idxBridge[fn] === 'function') results[key] = idxBridge[fn](db); } catch (e) { results[key] = { rows: 0, error: e.message }; }
      }
      const totalRows = Object.values(results).reduce((s, r) => s + (r?.rows || 0), 0);
      logSync('import_all', '', totalRows, 'ok', JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v?.rows || 0]))));
      res.json({ ok: true, total_rows: totalRows, detail: results });
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
      let bridgeStatus = { ok: false };
      try { bridgeStatus = idxBridge.getIdxApiStatus(); } catch (e) { bridgeStatus = { ok: false, error: e.message }; }
      res.json({
        latest: { stock: latestStock, index: latestIndex, fundamental: latestFund },
        counts: { stock_dates: stockCount, index_dates: indexCount, tickers: tickerCount },
        recent_syncs: recentLogs,
        bridge: bridgeStatus
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- Sync Status ---
  router.post('/sync/today', (req, res) => {
    const today = new Date();
    const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    try {
      const stockResult = idxBridge.importStockSummary(db, { date: dateStr });
      const indexResult = idxBridge.importIndexSummary(db, { date: dateStr });
      logSync('today', dateStr, stockResult.rows + indexResult.rows, 'ok', 'stock=' + stockResult.rows + ' index=' + indexResult.rows);
      res.json({ ok: true, date: dateStr, stock_rows: stockResult.rows, index_rows: indexResult.rows });
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
    console.log('[IDX] Deno proxy routes registered');
  } catch (e) {
    console.warn('[IDX] Deno proxy not loaded:', e.message);
  }

  // ═══════════════════════════════════════════════
  // CUSTOM TICKERS — Add/Update/Delete external data
  // ═══════════════════════════════════════════════

  // List all custom tickers
  router.get('/custom/tickers', (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM custom_tickers ORDER BY code').all();
      res.json(rows);
    } catch (e) { res.json([]); }
  });

  // Delete custom ticker + its OHLC data
  router.delete('/custom/tickers/:code', (req, res) => {
    try {
      const code = req.params.code.toUpperCase().trim();
      db.prepare('DELETE FROM custom_ohlc WHERE code=?').run(code);
      db.prepare('DELETE FROM custom_tickers WHERE code=?').run(code);
      res.json({ ok: true, deleted: code });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ EOD AUTO-FETCH — Alpha Vantage + CoinGecko ═══
  let eodFetcher;
  try { eodFetcher = require('./eod-fetcher'); } catch (e) { /* module not available */ }

  // ═══ EOD REFRESH SEMUA CUSTOM TICKER (untuk dijadwalkan, mis. harian) ═══
  router.post('/custom/fetch-all', async (req, res) => {
    if (!eodFetcher) return res.status(500).json({ error: 'eod-fetcher module not found' });
    try {
      const tickers = db.prepare('SELECT code, name, category FROM custom_tickers ORDER BY code').all();
      const detail = [];
      for (const t of tickers) {
        try {
          const r = await eodFetcher.fetchEOD(t.code, t.category, process.env.ALPHA_VANTAGE_KEY || '', false);
          let written = 0;
          db.transaction(() => {
            const up = db.prepare(
              `INSERT INTO custom_ohlc(trade_date, code, open, high, low, close, volume) VALUES(?,?,?,?,?,?,?)
               ON CONFLICT(trade_date, code) DO UPDATE SET
               open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume`);
            for (const row of (r.rows || [])) {
              if (!row.date || !row.close) continue;
              up.run(row.date, t.code, row.open, row.high, row.low, row.close, row.volume);
              written++;
            }
          })();
          const dr = db.prepare('SELECT MIN(trade_date) f, MAX(trade_date) l FROM custom_ohlc WHERE code=?').get(t.code);
          const cnt = db.prepare('SELECT COUNT(*) c FROM custom_ohlc WHERE code=?').get(t.code).c;
          db.prepare(`UPDATE custom_tickers SET rows=?, first_date=?, last_date=?, updated_at=datetime('now') WHERE code=?`)
            .run(cnt, dr.f, dr.l, t.code);
          detail.push({ code: t.code, ok: true, written, last: dr.l });
        } catch (e) {
          detail.push({ code: t.code, ok: false, error: e.message });
        }
      }
      res.json({
        ok: true,
        refreshed: detail.filter(x => x.ok).length,
        failed: detail.filter(x => !x.ok).length,
        detail,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/custom/fetch-eod', async (req, res) => {
    if (!eodFetcher) return res.status(500).json({ error: 'eod-fetcher module not found. Place eod-fetcher.js in server/routes/' });
    try {
      const code = (req.body.code || '').toUpperCase().trim();
      const category = (req.body.category || '').trim();
      const fullHistory = !!req.body.full_history;
      if (!code) return res.status(400).json({ error: 'Missing code' });

      const apiKey = process.env.ALPHA_VANTAGE_KEY || '';
      const det = eodFetcher.detectSource(code, category);

      const result = await eodFetcher.fetchEOD(code, category, apiKey, fullHistory);
      const rows = result.rows;
      if (!rows.length) return res.json({ ok: true, code, inserted: 0, updated: 0, message: 'No data returned' });

      const upsert = db.prepare(
        `INSERT INTO custom_ohlc(trade_date, code, open, high, low, close, volume)
         VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(trade_date, code) DO UPDATE SET
         open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume`
      );
      let inserted = 0, updated = 0;
      db.transaction(() => {
        for (const r of rows) {
          if (!r.date || !r.close) continue;
          const existing = db.prepare('SELECT id FROM custom_ohlc WHERE trade_date=? AND code=?').get(r.date, code);
          upsert.run(r.date, code, r.open, r.high, r.low, r.close, r.volume);
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

      res.json({ ok: true, code, source: result.source, inserted, updated, total_rows: totalRows,
        date_range: { first: dateRange?.first, last: dateRange?.last } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/custom/sync-stale', async (req, res) => {
    if (!eodFetcher) return res.status(500).json({ error: 'eod-fetcher module not found' });
    try {
      const apiKey = process.env.ALPHA_VANTAGE_KEY || '';
      const staleDays = parseInt(req.body.stale_days) || 7;
      const today = new Date().toISOString().split('T')[0];
      const all = db.prepare('SELECT code, name, category, last_date FROM custom_tickers ORDER BY code').all();
      const stale = all.filter(r => {
        if (!r.last_date) return true;
        return Math.floor((new Date(today) - new Date(r.last_date)) / 86400000) > staleDays;
      });
      if (!stale.length) return res.json({ ok: true, synced: 0, message: 'All tickers up to date' });

      const results = [];
      for (const ticker of stale) {
        try {
          const det = eodFetcher.detectSource(ticker.code, ticker.category);

          const data = await eodFetcher.fetchEOD(ticker.code, ticker.category, apiKey, false);
          let inserted = 0, updated = 0;
          const upsert = db.prepare(
            `INSERT INTO custom_ohlc(trade_date, code, open, high, low, close, volume)
             VALUES(?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(trade_date, code) DO UPDATE SET
             open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume`
          );
          db.transaction(() => {
            for (const r of data.rows) {
              if (!r.date || !r.close) continue;
              const existing = db.prepare('SELECT id FROM custom_ohlc WHERE trade_date=? AND code=?').get(r.date, ticker.code);
              upsert.run(r.date, ticker.code, r.open, r.high, r.low, r.close, r.volume);
              if (existing) updated++; else inserted++;
            }
          })();

          const totalRows = db.prepare('SELECT COUNT(*) as c FROM custom_ohlc WHERE code=?').get(ticker.code)?.c || 0;
          const dateRange = db.prepare('SELECT MIN(trade_date) as first, MAX(trade_date) as last FROM custom_ohlc WHERE code=?').get(ticker.code);
          db.prepare('UPDATE custom_tickers SET rows=?, first_date=?, last_date=?, updated_at=datetime(\'now\') WHERE code=?')
            .run(totalRows, dateRange?.first || '', dateRange?.last || '', ticker.code);
          results.push({ code: ticker.code, inserted, updated, source: data.source });

          // Rate limit: 2s between requests
          await new Promise(r => setTimeout(r, 2000));
        } catch (e) { results.push({ code: ticker.code, error: e.message }); }
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
        function parseNum(s) {
          if (!s || s === '-' || s === 'null') return 0;
          s = String(s).replace(/"/g, '').replace(/%/g, '').trim();
          if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
          else s = s.replace(/,/g, '');
          return parseFloat(s) || 0;
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
          const close = parseNum(cols[closeIdx] || '');
          if (!date || close <= 0) continue;
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
          if (parsed && parsed.date && parsed.close > 0) rows.push(parsed);
        }
      }

      if (!rows.length) return res.status(400).json({ error: 'No valid rows parsed' });

      // Sort by date ascending
      rows.sort((a, b) => a.date.localeCompare(b.date));

      // Upsert into custom_ohlc
      const upsert = db.prepare(
        `INSERT INTO custom_ohlc(trade_date, code, open, high, low, close, volume)
         VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(trade_date, code) DO UPDATE SET
         open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume`
      );

      let inserted = 0, updated = 0;
      db.transaction(() => {
        for (const r of rows) {
          const existing = db.prepare('SELECT id FROM custom_ohlc WHERE trade_date=? AND code=?').get(r.date, code);
          upsert.run(r.date, code, r.open, r.high, r.low, r.close, r.volume);
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
        total_rows: totalRows,
        date_range: { first: dateRange?.first, last: dateRange?.last }
      });

    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Get custom ticker OHLC data (for preview)
  router.get('/custom/ohlc/:code', (req, res) => {
    try {
      const code = req.params.code.toUpperCase().trim();
      const limit = parseInt(req.query.limit) || 0;
      let sql = 'SELECT * FROM custom_ohlc WHERE code=? ORDER BY trade_date';
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
      function parseNum(s) {
        if (!s || s === '-' || s === 'null') return 0;
        s = String(s).replace(/"/g, '').trim();
        // Detect Investing ID format: dot as thousand sep, comma as decimal
        // "15.690,50" or "15,52"
        if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) {
          // European/ID format: 1.234.567,89
          s = s.replace(/\./g, '').replace(',', '.');
        } else {
          // EN format: 1,234,567.89
          s = s.replace(/,/g, '');
        }
        return parseFloat(s) || 0;
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
          const rows = db.prepare('SELECT trade_date, close FROM custom_ohlc WHERE code=? ORDER BY trade_date DESC LIMIT 60').all(t.code);
          if (!rows.length) return { code: t.code, name: t.name || t.code };
          const now = rows[0].close;
          const d1 = rows[1] ? rows[1].close : now;
          const d5 = rows[4] ? rows[4].close : now;
          const d20 = rows[19] ? rows[19].close : now;
          return {
            code: t.code, name: t.name || t.code, close: now,
            chg_pct: d1 > 0 ? Math.round((now - d1) / d1 * 10000) / 100 : 0,
            chg_5d: d5 > 0 ? Math.round((now - d5) / d5 * 10000) / 100 : 0,
            chg_20d: d20 > 0 ? Math.round((now - d20) / d20 * 10000) / 100 : 0
          };
        });
      } catch (e) {}

      // ── Level 2: Commodity Cycle (custom_tickers with category=commodity) ──
      let commodities = [];
      try {
        const cmdTickers = db.prepare("SELECT code, name, category, linked_sector FROM custom_tickers WHERE category='commodity' ORDER BY code").all();
        commodities = cmdTickers.map(t => {
          const rows = db.prepare('SELECT trade_date, close FROM custom_ohlc WHERE code=? ORDER BY trade_date DESC LIMIT 60').all(t.code);
          if (!rows.length) return { code: t.code, name: t.name || t.code, linked_sector: t.linked_sector || '' };
          const now = rows[0].close;
          const d5 = rows[4] ? rows[4].close : now;
          const d20 = rows[19] ? rows[19].close : now;
          return {
            code: t.code, name: t.name || t.code, close: now,
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
        const ihsgRows = db.prepare("SELECT trade_date, close FROM idx_indices WHERE index_code='COMPOSITE' ORDER BY trade_date DESC LIMIT 60").all();
        if (ihsgRows.length >= 20) {
          const now = ihsgRows[0].close;
          const d1 = ihsgRows[1] ? ihsgRows[1].close : now;
          const d5 = ihsgRows[4] ? ihsgRows[4].close : now;
          const d20 = ihsgRows[19] ? ihsgRows[19].close : now;
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

      // Foreign flow aggregate
      try {
        const ffRows = db.prepare('SELECT trade_date, buy_value, sell_value FROM foreign_trading ORDER BY trade_date DESC LIMIT 20').all();
        if (ffRows.length) {
          const netToday = ffRows[0] ? (ffRows[0].buy_value - ffRows[0].sell_value) : 0;
          const net5d = ffRows.slice(0, 5).reduce((s, r) => s + (r.buy_value - r.sell_value), 0);
          const net20d = ffRows.reduce((s, r) => s + (r.buy_value - r.sell_value), 0);
          idx.foreign_flow = { net_today: netToday, net_5d: net5d, net_20d: net20d };
        }
      } catch (e) {}

      // Market breadth
      try {
        if (today) {
          const stocks = db.prepare('SELECT code, close FROM idx_daily WHERE trade_date=? AND close > 0 AND volume > 0').all(today);
          let aboveMA20 = 0, aboveMA50 = 0, aboveMA200 = 0, total = 0, newHigh = 0, newLow = 0;

          for (const s of stocks) {
            const hist = db.prepare('SELECT close FROM idx_daily WHERE code=? AND close>0 ORDER BY trade_date DESC LIMIT 200').all(s.code);
            if (hist.length < 20) continue;
            total++;
            const closes = hist.map(r => r.close).reverse();
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
          const rows = db.prepare('SELECT code, trade_date, close FROM idx_daily WHERE trade_date >= ? AND close > 0 ORDER BY code, trade_date').all(from);
          const byCode = {};
          for (const r of rows) (byCode[r.code] = byCode[r.code] || []).push(r);
          const agg = {};
          for (const code of Object.keys(byCode)) {
            const arr = byCode[code];
            let s20 = 0, s50 = 0;
            for (let i = 0; i < arr.length; i++) {
              s20 += arr[i].close; if (i >= 20) s20 -= arr[i - 20].close;
              s50 += arr[i].close; if (i >= 50) s50 -= arr[i - 50].close;
              if (i < 50) continue;                       // butuh MA50 lebih dulu
              const d = arr[i].trade_date;
              if (!agg[d]) agg[d] = { a20: 0, a50: 0, n: 0 };
              agg[d].n++;
              if (arr[i].close > s20 / 20) agg[d].a20++;
              if (arr[i].close > s50 / 50) agg[d].a50++;
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
        // Get last 2 dates from sectoral_movement to compute daily change
        const smDates = db.prepare('SELECT DISTINCT trade_date FROM sectoral_movement ORDER BY trade_date DESC LIMIT 2').all();
        // Also get ~20 trading days ago for 20D change
        const smDates20 = db.prepare('SELECT DISTINCT trade_date FROM sectoral_movement ORDER BY trade_date DESC LIMIT 22').all();
        const sm20Date = smDates20.length >= 20 ? smDates20[19].trade_date : (smDates20.length ? smDates20[smDates20.length - 1].trade_date : null);
        const sm20 = {};
        if (sm20Date) {
          db.prepare('SELECT sector_name, change_pct FROM sectoral_movement WHERE trade_date=?').all(sm20Date)
            .forEach(r => { sm20[r.sector_name] = r.change_pct || 0; });
        }

        if (smDates.length >= 2) {
          const latestSM = smDates[0].trade_date;
          const prevSM = smDates[1].trade_date;
          const smLatest = db.prepare('SELECT sector_name, change_pct FROM sectoral_movement WHERE trade_date=?').all(latestSM);
          const smPrev = {};
          db.prepare('SELECT sector_name, change_pct FROM sectoral_movement WHERE trade_date=?').all(prevSM)
            .forEach(r => { smPrev[r.sector_name] = r.change_pct || 0; });

          // Map: sectoral_movement (English) → company_profiles.sector (Indonesian)
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

          const ihsgDailyChg = idx.ihsg ? idx.ihsg.chg_1d : 0;

          sectors = smLatest.filter(sm => sm.sector_name !== 'Composite Index').map(sm => {
            const todayVal = sm.change_pct || 0;
            const prevVal = smPrev[sm.sector_name] || 0;
            const dailyChg = prevVal > 0 ? Math.round((todayVal - prevVal) / prevVal * 10000) / 100 : 0;

            // Map to Indonesian sector name in company_profiles
            const cpSector = SECTOR_MAP[sm.sector_name] || '';

            // Foreign flow per sector (last 20 days) — JOIN idx_daily with company_profiles
            let fnet20d = 0;
            if (cpSector) {
              try {
                const sfRow = db.prepare(
                  `SELECT SUM((d.foreign_buy - d.foreign_sell) * d.close) as fnet
                   FROM idx_daily d JOIN company_profiles cp ON d.code=cp.code
                   WHERE cp.sector=? AND d.trade_date >= date(?, '-30 days') AND d.close > 0`
                ).get(cpSector, latestSM);
                fnet20d = sfRow?.fnet || 0;
              } catch (e) {}
            }

            // Top stocks — by composite score if available, else by value
            let topStocks = [];
            if (cpSector) {
              try {
                // Try with scores first
                let top = [];
                try {
                  top = db.prepare(
                    `SELECT d.code FROM idx_daily d
                     JOIN company_profiles cp ON d.code=cp.code
                     LEFT JOIN daily_scores s ON d.code=s.code AND s.calc_date=(SELECT MAX(calc_date) FROM daily_scores)
                     WHERE d.trade_date=? AND cp.sector=? AND d.close > 0
                     ORDER BY COALESCE(s.score_composite, 0) DESC LIMIT 5`
                  ).all(today, cpSector);
                } catch (e) {}
                // Fallback: order by trading value
                if (!top.length) {
                  top = db.prepare(
                    `SELECT d.code FROM idx_daily d
                     JOIN company_profiles cp ON d.code=cp.code
                     WHERE d.trade_date=? AND cp.sector=? AND d.close > 0
                     ORDER BY d.value DESC LIMIT 5`
                  ).all(today, cpSector);
                }
                topStocks = top.map(r => r.code);
              } catch (e) {}
            }

            // 20D change from sectoral_movement
            const val20ago = sm20[sm.sector_name] || 0;
            const chg20d = val20ago > 0 ? Math.round((todayVal - val20ago) / val20ago * 10000) / 100 : 0;

            return {
              sector: sm.sector_name, cp_sector: cpSector, chg_pct: dailyChg, chg_20d: chg20d,
              rs_vs_ihsg: dailyChg - ihsgDailyChg,
              fnet_20d: fnet20d, top_stocks: topStocks
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
            'USDIDR': { emoji: '💱', high: 16500, low: 15500, label: 'USD/IDR',    highBear: true }
          };

          macroTickers.forEach(t => {
            const rows = db.prepare('SELECT trade_date, close FROM custom_ohlc WHERE code=? ORDER BY trade_date DESC LIMIT 30').all(t.code);
            if (!rows.length) return;
            const now = rows[0].close;
            const d5 = rows[4] ? rows[4].close : now;
            const d20 = rows[19] ? rows[19].close : now;
            const chg5 = d5 > 0 ? Math.round((now - d5) / d5 * 10000) / 100 : 0;
            const chg20 = d20 > 0 ? Math.round((now - d20) / d20 * 10000) / 100 : 0;
            const rule = MACRO_RULES[t.code] || { emoji: '📊', high: now * 1.1, low: now * 0.9, label: t.name || t.code, highBear: false };

            let bull = 0, bear = 0, detail = '';
            if (rule.highBear) {
              // High = bearish (VIX, DXY, US10Y, USDIDR)
              if (now > rule.high) { bear += 1; detail = 'Above ' + rule.high + ' — bearish'; }
              else if (now < rule.low) { bull += 1; detail = 'Below ' + rule.low + ' — bullish'; }
              else { detail = 'Neutral range (' + rule.low + '-' + rule.high + ')'; }
              if (chg5 > 3) { bear += 1; detail += ', rising fast'; }
              else if (chg5 < -3) { bull += 1; detail += ', falling fast'; }
            } else {
              // High = bullish (BDI)
              if (now > rule.high) { bull += 1; detail = 'Above ' + rule.high + ' — bullish'; }
              else if (now < rule.low) { bear += 1; detail = 'Below ' + rule.low + ' — bearish'; }
              else { detail = 'Neutral range (' + rule.low + '-' + rule.high + ')'; }
              if (chg5 > 3) { bull += 1; detail += ', rising'; }
              else if (chg5 < -3) { bear += 1; detail += ', falling'; }
            }

            bullPoints += bull;
            bearPoints += bear;
            signals.push({ code: t.code, emoji: rule.emoji, value: now, detail: rule.label + ': ' + detail, bull, bear, chg_5d: chg5, chg_20d: chg20 });
          });

          macro_signals = { signals, bull_points: bullPoints, bear_points: bearPoints };
        }
      } catch (e) {}

      res.json({ date: today, global, commodities, idx, sectors, macro_signals });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
        const vixRows = db.prepare("SELECT close FROM custom_ohlc WHERE code='VIX' ORDER BY trade_date DESC LIMIT 1").all();
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
  router.get('/stock-detail/:code', (req, res) => {
    try {
      const code = req.params.code.toUpperCase().trim();
      if (!code) return res.status(400).json({ error: 'No code' });

      // Get full price history (adjusted)
      const cas = db.prepare(`SELECT * FROM corporate_actions WHERE code=? AND status='confirmed' ORDER BY ex_date DESC`).all(code);
      const raw = db.prepare('SELECT trade_date,code,name,open_price,high,low,close,prev_close,volume,value,frequency,foreign_buy,foreign_sell,bid_vol,offer_vol,listed_shares FROM idx_daily WHERE code=? AND close>0 ORDER BY trade_date').all(code);
      if (!raw.length) return res.json({ error: 'No data for ' + code, code });

      // Adjust for corporate actions
      const data = raw.map(r => {
        let f = 1;
        for (const ca of cas) { if (r.trade_date < ca.ex_date && ca.ratio > 0 && ca.ratio !== 1) f *= (1 / ca.ratio); }
        const ac = Math.round(r.close * f), ah = Math.round((r.high || r.close) * f), al = Math.round((r.low || r.close) * f), ao = Math.round((r.open_price || r.close) * f);
        return { ...r, ac, ah, al, ao, fnet: (r.foreign_buy - r.foreign_sell) * r.close, fnet_shares: r.foreign_buy - r.foreign_sell };
      });

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

      // ── 7. Fundamental snapshot ──
      let fundamental = null;
      try {
        const { latestFundDate } = require('../db');
        const fm = latestFundDate();
        if (fm) fundamental = db.prepare('SELECT * FROM idx_fundamental WHERE snapshot_month=? AND code=?').get(fm, code);
      } catch (e) {}

      // ── 7b. Ownership from balance_position ──
      let ownership = null;
      try {
        const bpRow = db.prepare('SELECT * FROM balance_position WHERE code=? ORDER BY snapshot_date DESC LIMIT 1').get(code);
        if (bpRow) {
          const totalShares = (bpRow.local_total || 0) + (bpRow.foreign_total || 0);
          ownership = {
            snapshot_date: bpRow.snapshot_date,
            local_total: bpRow.local_total || 0,
            foreign_total: bpRow.foreign_total || 0,
            total: totalShares,
            foreign_pct: totalShares > 0 ? Math.round(bpRow.foreign_total / totalShares * 10000) / 100 : 0,
            local_pct: totalShares > 0 ? Math.round(bpRow.local_total / totalShares * 10000) / 100 : 0,
            breakdown: {
              local: { is: bpRow.local_is||0, cp: bpRow.local_cp||0, pf: bpRow.local_pf||0, ib: bpRow.local_ib||0, id: bpRow.local_id||0, mf: bpRow.local_mf||0, sc: bpRow.local_sc||0, fd: bpRow.local_fd||0, ot: bpRow.local_ot||0 },
              foreign: { is: bpRow.foreign_is||0, cp: bpRow.foreign_cp||0, pf: bpRow.foreign_pf||0, ib: bpRow.foreign_ib||0, id: bpRow.foreign_id||0, mf: bpRow.foreign_mf||0, sc: bpRow.foreign_sc||0, fd: bpRow.foreign_fd||0, ot: bpRow.foreign_ot||0 }
            }
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
        if (fundamental && fundamental.snapshot_month) {
          const curMonth = fundamental.snapshot_month; // e.g. "2026-02"
          const yParts = curMonth.split('-');
          const yoyMonth = (parseInt(yParts[0]) - 1) + '-' + yParts[1]; // e.g. "2025-02"
          const prev = db.prepare('SELECT * FROM idx_fundamental WHERE snapshot_month=? AND code=?').get(yoyMonth, code);
          if (prev) {
            const pctChg = (cur, prv) => (prv && prv !== 0) ? Math.round((cur - prv) / Math.abs(prv) * 10000) / 100 : null;
            fundGrowth = {
              period: yoyMonth + ' → ' + curMonth,
              revenue_growth: pctChg(fundamental.sales, prev.sales),
              profit_growth: pctChg(fundamental.profit, prev.profit),
              eps_growth: pctChg(fundamental.eps_trailing, prev.eps_trailing),
              equity_growth: pctChg(fundamental.equity, prev.equity),
              assets_growth: pctChg(fundamental.assets, prev.assets),
              prev_snapshot: yoyMonth
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

        const allSnaps = db.prepare('SELECT snapshot_month, fs_date, fiscal_year, fs_type, sales, ebt, profit, profit_attr, eps_trailing, book_value, assets, liabilities, equity, roe, roa, npm, per, pbv, der FROM idx_fundamental WHERE code=? ORDER BY snapshot_month').all(code);
        // Normalize fs_date and snap to nearest quarter end
        function snapToQuarterEnd(nfd) {
          // Given YYYY-MM-DD, snap to nearest standard quarter end: 03-31, 06-30, 09-30, 12-31
          var parts = nfd.split('-');
          var y = parts[0], m = parseInt(parts[1] || '1');
          if (m <= 3) return y + '-03-31';
          if (m <= 6) return y + '-06-30';
          if (m <= 9) return y + '-09-30';
          return y + '-12-31';
        }

        const byQtr = {};
        allSnaps.forEach(s => {
          const nfd = normalizeFsDate(s.fs_date) || s.snapshot_month;
          const qKey = snapToQuarterEnd(nfd);
          s._norm_fs_date = qKey;
          // Keep latest snapshot per quarter-end key
          if (!byQtr[qKey] || s.snapshot_month > byQtr[qKey].snapshot_month) byQtr[qKey] = s;
        });
        fundHistory = Object.values(byQtr).sort((a, b) => a._norm_fs_date.localeCompare(b._norm_fs_date));

        // Remove content-duplicate entries (same sales+profit as previous = stale data)
        var cleaned = [];
        for (var fi = 0; fi < fundHistory.length; fi++) {
          var cur = fundHistory[fi];
          if (fi > 0) {
            var prev = fundHistory[fi - 1];
            if (Math.abs((cur.sales || 0) - (prev.sales || 0)) < 0.01 && Math.abs((cur.profit || 0) - (prev.profit || 0)) < 0.01) continue;
          }
          cleaned.push(cur);
        }
        fundHistory = cleaned;

        // Label quarters from snapped date
        fundHistory.forEach(fh => {
          const fd = fh._norm_fs_date || '';
          const parts = fd.split('-');
          const year = parts[0] || '';
          const m = parseInt(parts[1] || '0');
          fh.quarter_label = m <= 3 ? 'Q1' : m <= 6 ? 'Q2' : m <= 9 ? 'Q3' : 'FY';
          fh.period_label = year.slice(2) + ' ' + fh.quarter_label;
        });
      } catch (e) {}

      try {
        // Daily live PER/PBV from idx_daily close / latest EPS & BV/S
        if (fundamental && (fundamental.eps_trailing || fundamental.book_value)) {
          const epsT = fundamental.eps_trailing || 0;
          const bvS = fundamental.book_value || 0;
          const dailyRows = db.prepare('SELECT trade_date, close FROM idx_daily WHERE code=? AND close>0 ORDER BY trade_date DESC LIMIT 250').all(code).reverse();
          dailyValuation = dailyRows.map(r => ({
            date: r.trade_date,
            close: r.close,
            live_per: epsT !== 0 ? Math.round(r.close / epsT * 100) / 100 : null,
            live_pbv: bvS !== 0 ? Math.round(r.close / bvS * 100) / 100 : null
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
        const ihsgRows = db.prepare('SELECT trade_date, close FROM idx_indices WHERE index_code=? ORDER BY trade_date DESC LIMIT 60').all('COMPOSITE');
        if (ihsgRows.length >= 20) {
          const ihsgNow = ihsgRows[0].close;
          const ihsg5d = ihsgRows[4] ? ihsgRows[4].close : ihsgNow;
          const ihsg20d = ihsgRows[19] ? ihsgRows[19].close : ihsgNow;
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
          const cmdRows = db.prepare('SELECT trade_date, close FROM custom_ohlc WHERE code=? ORDER BY trade_date DESC LIMIT 30').all(commodityCode);
          if (cmdRows.length >= 5) {
            const now = cmdRows[0].close;
            const d5 = cmdRows[4] ? cmdRows[4].close : now;
            const d20 = cmdRows[Math.min(19, cmdRows.length - 1)] ? cmdRows[Math.min(19, cmdRows.length - 1)].close : now;
            commodityContext = {
              code: commodityCode, label: commodityLabel, price: now,
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

      // ── Build chart data (last 500 for performance) ──
      const chartData = data.slice(-500).map((r, i, arr) => ({
        date: r.trade_date, open: r.ao, high: r.ah, low: r.al, close: r.ac,
        volume: r.volume, frequency: r.frequency || 0, fnet: r.fnet, bid_vol: r.bid_vol || 0, offer_vol: r.offer_vol || 0
      }));

      const adChartData = adLine.slice(-500).map(r => ({ date: r.date, ad: r.ad }));

      res.json({
        code, name: last.name || '',
        current: { close: last.ac, prev_close: last.prev_close, change: last.ac - (data[n - 2]?.ac || last.ac), trade_date: last.trade_date, volume: last.volume, value: last.value, market_cap: last.ac * (last.listed_shares || 0) },
        phase: lastPhase,
        phases: phaseResult.slice(-30),
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
        foreign: { fnet_5d: fnet5, fnet_10d: fnet10, fnet_20d: fnet20, fnet_total: fnetTotal, accum_streak: accumStreak, distrib_streak: distribStreak },
        bid_offer: { data: boData, avg_ratio: avgBidRatio },
        scoring, score_history: scoreHist || [],
        fundamental,
        ownership,
        dividend_history: dividendHistory,
        ca_timeline: caTimeline,
        fund_growth: fundGrowth,
        fund_history: fundHistory,
        daily_valuation: dailyValuation,
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