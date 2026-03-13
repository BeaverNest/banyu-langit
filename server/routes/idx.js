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
    let acc = 0, accVal = 0;
    rows.forEach(r => {
      r.foreign_net = r.foreign_buy - r.foreign_sell;
      r.foreign_buy_val = r.foreign_buy * r.close;
      r.foreign_sell_val = r.foreign_sell * r.close;
      r.foreign_net_val = r.foreign_net * r.close;
      acc += r.foreign_net; r.foreign_acc = acc;
      accVal += r.foreign_net_val; r.foreign_acc_val = accVal;
    });
    res.json({ code, data: rows });
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
                value, frequency, foreign_buy, foreign_sell, listed_shares
         FROM idx_daily WHERE code=? ORDER BY trade_date`
      ).all(code);

      if (!ohlc.length) return res.json({ code, data: [], actions: [] });

      if (!actions.length) {
        const data = ohlc.map(r => ({
          ...r, adj_open: r.open_price, adj_high: r.high, adj_low: r.low, adj_close: r.close,
          adj_volume: r.volume, cum_factor: 1
        }));
        return res.json({ code, data, actions: [] });
      }

      // Backward: dates BEFORE ex_date get factor applied
      // factor = 1/ratio (ratio = new_shares/old_shares)
      // Split 1:5 → ratio=5, factor=0.2 → old prices shrink
      // Reverse 10:1 → ratio=0.1, factor=10 → old prices grow
      const data = ohlc.map(r => {
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

  return router;
};
