const express = require('express');
const { db, latestIdxDate } = require('../db');

const router = express.Router();

function calcMA(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function calcEMA(data, period) {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < data.length; i++) ema = data[i] * k + ema * (1 - k);
  return ema;
}

function calcMACD(closes) {
  if (closes.length < 26) return null;
  let e12 = closes.slice(0, 12).reduce((s, v) => s + v, 0) / 12;
  let e26 = closes.slice(0, 26).reduce((s, v) => s + v, 0) / 26;
  const k12 = 2 / 13, k26 = 2 / 27;
  const ema12 = [], ema26 = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 12) e12 = closes.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1);
    else e12 = closes[i] * k12 + e12 * (1 - k12);
    if (i < 26) e26 = closes.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1);
    else e26 = closes[i] * k26 + e26 * (1 - k26);
    ema12.push(e12); ema26.push(e26);
  }
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  let sig = macdLine.slice(0, 9).reduce((s, v) => s + v, 0) / 9;
  const k9 = 2 / 10, signals = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (i < 9) sig = macdLine.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1);
    else sig = macdLine[i] * k9 + sig * (1 - k9);
    signals.push(sig);
  }
  const last = macdLine.length - 1, prev = last - 1;
  return { macd: Math.round(macdLine[last] * 100) / 100, signal: Math.round(signals[last] * 100) / 100, histogram: Math.round((macdLine[last] - signals[last]) * 100) / 100, cross: prev >= 0 && macdLine[prev] <= signals[prev] && macdLine[last] > signals[last] ? 'golden' : prev >= 0 && macdLine[prev] >= signals[prev] && macdLine[last] < signals[last] ? 'death' : null };
}

function calcStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  if (closes.length < kPeriod) return null;
  const kValues = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    kValues.push(hh === ll ? 50 : (closes[i] - ll) / (hh - ll) * 100);
  }
  const dValues = [];
  for (let i = dPeriod - 1; i < kValues.length; i++) dValues.push(kValues.slice(i - dPeriod + 1, i + 1).reduce((s, v) => s + v, 0) / dPeriod);
  return { k: Math.round(kValues[kValues.length - 1] * 100) / 100, d: dValues.length ? Math.round(dValues[dValues.length - 1] * 100) / 100 : null, zone: kValues[kValues.length - 1] > 80 ? 'overbought' : kValues[kValues.length - 1] < 20 ? 'oversold' : 'neutral' };
}

function applyOp(val, op, target) {
  target = parseFloat(target); if (isNaN(target)) return true;
  if (op === '>') return val > target; if (op === '>=') return val >= target;
  if (op === '<') return val < target; if (op === '<=') return val <= target;
  return true;
}

// ═══ Load confirmed CAs and build adjustment lookup ═══
// Returns { CODE: [ {ex_date, ratio}, ... ] } sorted ex_date DESC
function loadConfirmedCAs() {
  const rows = db.prepare(`SELECT code, ex_date, ratio FROM corporate_actions WHERE status='confirmed' ORDER BY ex_date DESC`).all();
  const map = {};
  for (const r of rows) {
    if (!map[r.code]) map[r.code] = [];
    map[r.code].push(r);
  }
  return map;
}

// Apply backward adjustment to a single row's OHLC
// actions = array of {ex_date, ratio} for this ticker, sorted DESC
function adjustRow(row, actions) {
  if (!actions || !actions.length) return row;
  let cumFactor = 1;
  for (const ca of actions) {
    if (row.trade_date < ca.ex_date && ca.ratio > 0 && ca.ratio !== 1) {
      cumFactor *= (1 / ca.ratio);
    }
  }
  if (cumFactor === 1) return row;
  return {
    ...row,
    close: Math.round(row.close * cumFactor),
    high: Math.round(row.high * cumFactor),
    low: Math.round(row.low * cumFactor),
    volume: Math.round(row.volume / cumFactor)
  };
}

router.post('/run', (req, res) => {
  try {
    const rules = req.body.rules || [];
    const limit = Math.min(parseInt(req.body.limit) || 50, 200);
    const td = latestIdxDate();
    if (!td) return res.json({ data: [], trade_date: null });

    let stocks = db.prepare(`SELECT *, (foreign_buy-foreign_sell) as foreign_net, ((foreign_buy-foreign_sell)*close) as foreign_net_val, CASE WHEN prev_close>0 THEN ROUND(CAST((close-prev_close)AS REAL)/prev_close*100,2) ELSE 0 END as change_pct FROM idx_daily WHERE trade_date=? AND close>0`).all(td);

    // Join fundamental data
    const { latestFundDate } = require('../db');
    const fm = latestFundDate();
    const fundMap = {};
    if (fm) { db.prepare('SELECT * FROM idx_fundamental WHERE snapshot_month=?').all(fm).forEach(f => { fundMap[f.code] = f; }); }
    stocks = stocks.map(s => ({ ...s, fund: fundMap[s.code] || null }));

    if (!rules.length) {
      stocks.sort((a, b) => Math.abs(b.foreign_net_val) - Math.abs(a.foreign_net_val));
      return res.json({ data: stocks.slice(0, limit), total: stocks.length, trade_date: td });
    }

    const techFields = ['close_vs_ma','ma5','ma10','ma20','ma50','ma100','ma200','macd','stoch','vol_spike'];
    const needTech = rules.some(r => techFields.some(tf => (r.field || '').includes(tf)));

    // Pre-load all confirmed CAs once (not per-ticker)
    const caMap = needTech ? loadConfirmedCAs() : {};

    const results = [];
    for (const stock of stocks) {
      let pass = true;
      let tech = {};

      if (needTech) {
        const hist = db.prepare('SELECT trade_date,close,high,low,volume FROM idx_daily WHERE code=? ORDER BY trade_date').all(stock.code);
        if (hist.length >= 5) {
          // Apply adjustment if this ticker has confirmed CAs
          const actions = caMap[stock.code];
          const adjusted = actions ? hist.map(h => adjustRow(h, actions)) : hist;

          const closes = adjusted.map(h => h.close), highs = adjusted.map(h => h.high || h.close), lows = adjusted.map(h => h.low || h.close), vols = adjusted.map(h => h.volume);
          tech.ma5 = calcMA(closes, 5); tech.ma10 = calcMA(closes, 10); tech.ma20 = calcMA(closes, 20);
          tech.ma50 = calcMA(closes, 50); tech.ma100 = calcMA(closes, 100); tech.ma200 = calcMA(closes, 200);
          if (closes.length >= 26) tech.macd = calcMACD(closes);
          if (closes.length >= 14) tech.stoch = calcStochastic(highs, lows, closes);
          const avgVol = vols.slice(-20, -1);
          if (avgVol.length) tech.vol_ratio = Math.round(stock.volume / (avgVol.reduce((s, v) => s + v, 0) / avgVol.length) * 10) / 10;
          // Flag if adjusted
          if (actions && actions.length) tech.adjusted = true;
        }
      }

      for (const rule of rules) {
        if (!rule.field) continue;
        const f = rule.field;
        const isCompare = f.startsWith('close_vs_') || f === 'macd_signal';
        const op = rule.op || (isCompare ? 'above' : '>');
        const val = rule.val;
        const fund = stock.fund || {};

        if (f === 'close') { if (!applyOp(stock.close, op, val)) pass = false; }
        else if (f === 'change_pct') { if (!applyOp(stock.change_pct, op, val)) pass = false; }
        else if (f === 'volume_lot') { if (!applyOp(stock.volume / 100, op, val)) pass = false; }
        else if (f === 'value') { if (!applyOp(stock.value, op, val)) pass = false; }
        else if (f === 'frequency') { if (!applyOp(stock.frequency, op, val)) pass = false; }
        else if (f === 'foreign_net_val') { if (!applyOp(stock.foreign_net_val, op, val)) pass = false; }
        else if (f === 'vol_spike') { if (!tech.vol_ratio || !applyOp(tech.vol_ratio, op, val)) pass = false; }
        // Fundamental filters
        else if (f === 'per') { if (!fund.per || !applyOp(fund.per, op, val)) pass = false; }
        else if (f === 'pbv') { if (!fund.pbv || !applyOp(fund.pbv, op, val)) pass = false; }
        else if (f === 'roe') { if (!applyOp(fund.roe || 0, op, val)) pass = false; }
        else if (f === 'roa') { if (!applyOp(fund.roa || 0, op, val)) pass = false; }
        else if (f === 'der') { if (!applyOp(fund.der || 0, op, val)) pass = false; }
        else if (f === 'npm') { if (!applyOp(fund.npm || 0, op, val)) pass = false; }
        else if (f === 'mkt_cap') { if (!applyOp(fund.mkt_cap || 0, op, val)) pass = false; }
        else if (f === 'total_rev') { if (!applyOp(fund.total_rev || 0, op, val)) pass = false; }
        else if (f === 'ytd') { if (!applyOp(fund.ytd || 0, op, val)) pass = false; }
        // Sector filter
        else if (f === 'sector') { if (!fund.sector || fund.sector !== val) pass = false; }
        // Index membership
        else if (f === 'idx_index') { if (!fund.idx_index || !fund.idx_index.includes(val)) pass = false; }
        // MA compare
        else if (f.startsWith('close_vs_ma')) { const p = parseInt(f.replace('close_vs_ma', '')); const ma = tech['ma' + p]; if (!ma) pass = false; else if (op === 'above' && stock.close <= ma) pass = false; else if (op === 'below' && stock.close >= ma) pass = false; }
        // MACD
        else if (f === 'macd_hist') { if (!tech.macd || !applyOp(tech.macd.histogram, op, val)) pass = false; }
        else if (f === 'macd_cross') { if (!tech.macd || tech.macd.cross !== val) pass = false; }
        else if (f === 'macd_signal') { if (!tech.macd) pass = false; else if (op === 'above' && tech.macd.macd <= tech.macd.signal) pass = false; else if (op === 'below' && tech.macd.macd >= tech.macd.signal) pass = false; }
        // Stochastic
        else if (f === 'stoch_k') { if (!tech.stoch || !applyOp(tech.stoch.k, op, val)) pass = false; }
        else if (f === 'stoch_d') { if (!tech.stoch || !tech.stoch.d || !applyOp(tech.stoch.d, op, val)) pass = false; }
        else if (f === 'stoch_zone') { if (!tech.stoch || tech.stoch.zone !== val) pass = false; }
        // Foreign streak
        else if (f === 'fnet_streak') { const days = Math.abs(parseInt(val) || 3); const dir = (parseFloat(val) || 0) >= 0 ? 'buy' : 'sell'; const recent = db.prepare('SELECT (foreign_buy-foreign_sell) as fn FROM idx_daily WHERE code=? ORDER BY trade_date DESC LIMIT ?').all(stock.code, days); if (recent.length < days) pass = false; else if (dir === 'buy' && !recent.every(r => r.fn > 0)) pass = false; else if (dir === 'sell' && !recent.every(r => r.fn < 0)) pass = false; }

        if (!pass) break;
      }
      if (pass) results.push({ ...stock, tech });
    }

    results.sort((a, b) => Math.abs(b.foreign_net_val || 0) - Math.abs(a.foreign_net_val || 0));
    res.json({ data: results.slice(0, limit), total: results.length, trade_date: td, adjusted: Object.keys(caMap).length > 0 });
  } catch (e) { res.json({ data: [], error: e.message }); }
});

// ═══ Sector Overview — aggregate fundamental + daily data by sector/industry ═══
router.get('/sectors', (req, res) => {
  try {
    const { latestFundDate } = require('../db');
    const td = latestIdxDate();
    const sm = latestFundDate();
    if (!sm || !td) return res.json({ sectors: [], industries: [] });

    // Join fundamental with latest daily for foreign flow
    const rows = db.prepare(`
      SELECT f.code, f.sector, f.industry, f.per, f.pbv, f.roe, f.roa, f.der, f.npm, f.mkt_cap, f.ytd,
             d.close, d.value, d.volume, d.foreign_buy, d.foreign_sell,
             ((d.foreign_buy - d.foreign_sell) * d.close) as fnet_val,
             CASE WHEN d.prev_close > 0 THEN ROUND(CAST((d.close - d.prev_close) AS REAL) / d.prev_close * 100, 2) ELSE 0 END as chg_pct
      FROM idx_fundamental f
      LEFT JOIN idx_daily d ON f.code = d.code AND d.trade_date = ?
      WHERE f.snapshot_month = ? AND f.sector != ''
    `).all(td, sm);

    // Aggregate by sector
    const sectorMap = {};
    rows.forEach(r => {
      if (!sectorMap[r.sector]) sectorMap[r.sector] = { sector: r.sector, stocks: [], total_mcap: 0, total_fnet: 0, per_sum: 0, per_cnt: 0, roe_sum: 0, roe_cnt: 0, ytd_sum: 0, ytd_cnt: 0 };
      const s = sectorMap[r.sector];
      s.stocks.push(r);
      if (r.mkt_cap) s.total_mcap += r.mkt_cap;
      if (r.fnet_val) s.total_fnet += r.fnet_val;
      if (r.per && r.per > 0 && r.per < 500) { s.per_sum += r.per; s.per_cnt++; }
      if (r.roe) { s.roe_sum += r.roe; s.roe_cnt++; }
      if (r.ytd) { s.ytd_sum += r.ytd; s.ytd_cnt++; }
    });

    const sectors = Object.values(sectorMap).map(s => ({
      sector: s.sector,
      count: s.stocks.length,
      total_mcap: s.total_mcap,
      total_fnet: s.total_fnet,
      avg_per: s.per_cnt ? Math.round(s.per_sum / s.per_cnt * 10) / 10 : 0,
      avg_roe: s.roe_cnt ? Math.round(s.roe_sum / s.roe_cnt * 10) / 10 : 0,
      avg_ytd: s.ytd_cnt ? Math.round(s.ytd_sum / s.ytd_cnt * 10) / 10 : 0,
    })).sort((a, b) => b.total_mcap - a.total_mcap);

    // Aggregate by industry (within optional sector filter)
    const sectorFilter = (req.query.sector || '').trim();
    const indRows = sectorFilter ? rows.filter(r => r.sector === sectorFilter) : rows;
    const indMap = {};
    indRows.forEach(r => {
      if (!r.industry) return;
      if (!indMap[r.industry]) indMap[r.industry] = { industry: r.industry, sector: r.sector, stocks: [], total_mcap: 0, total_fnet: 0, per_sum: 0, per_cnt: 0, roe_sum: 0, roe_cnt: 0, ytd_sum: 0, ytd_cnt: 0 };
      const s = indMap[r.industry];
      s.stocks.push(r);
      if (r.mkt_cap) s.total_mcap += r.mkt_cap;
      if (r.fnet_val) s.total_fnet += r.fnet_val;
      if (r.per && r.per > 0 && r.per < 500) { s.per_sum += r.per; s.per_cnt++; }
      if (r.roe) { s.roe_sum += r.roe; s.roe_cnt++; }
      if (r.ytd) { s.ytd_sum += r.ytd; s.ytd_cnt++; }
    });

    const industries = Object.values(indMap).map(s => ({
      industry: s.industry,
      sector: s.sector,
      count: s.stocks.length,
      total_mcap: s.total_mcap,
      total_fnet: s.total_fnet,
      avg_per: s.per_cnt ? Math.round(s.per_sum / s.per_cnt * 10) / 10 : 0,
      avg_roe: s.roe_cnt ? Math.round(s.roe_sum / s.roe_cnt * 10) / 10 : 0,
      avg_ytd: s.ytd_cnt ? Math.round(s.ytd_sum / s.ytd_cnt * 10) / 10 : 0,
    })).sort((a, b) => b.total_mcap - a.total_mcap);

    // Stocks for drill-down (optional industry filter)
    const indFilter = (req.query.industry || '').trim();
    let stockList = [];
    if (indFilter) {
      stockList = rows.filter(r => r.industry === indFilter)
        .sort((a, b) => (b.mkt_cap || 0) - (a.mkt_cap || 0))
        .map(r => ({ code: r.code, sector: r.sector, industry: r.industry, close: r.close, chg_pct: r.chg_pct, mkt_cap: r.mkt_cap, per: r.per, roe: r.roe, ytd: r.ytd, fnet_val: r.fnet_val, volume: r.volume }));
    } else if (sectorFilter) {
      stockList = rows.filter(r => r.sector === sectorFilter)
        .sort((a, b) => (b.mkt_cap || 0) - (a.mkt_cap || 0))
        .slice(0, 30)
        .map(r => ({ code: r.code, sector: r.sector, industry: r.industry, close: r.close, chg_pct: r.chg_pct, mkt_cap: r.mkt_cap, per: r.per, roe: r.roe, ytd: r.ytd, fnet_val: r.fnet_val, volume: r.volume }));
    }

    res.json({ trade_date: td, snapshot_month: sm, sectors, industries, stocks: stockList });
  } catch (e) { res.json({ error: e.message }); }
});

router.get('/configs', (req, res) => { try { const c = db.prepare('SELECT * FROM screener_configs ORDER BY updated_at DESC').all(); c.forEach(x => { try { x.filters = JSON.parse(x.filters); } catch { x.filters = {}; } }); res.json(c); } catch { res.json([]); } });
router.post('/configs', (req, res) => { try { const { name, filters } = req.body; if (!name) return res.status(400).json({ error: 'Name required' }); const r = db.prepare('INSERT INTO screener_configs(name,filters) VALUES(?,?)').run(name, JSON.stringify(filters || {})); res.json({ success: true, id: r.lastInsertRowid }); } catch (e) { res.json({ error: e.message }); } });
router.put('/configs/:id', (req, res) => { try { const { name, filters } = req.body; db.prepare("UPDATE screener_configs SET name=?,filters=?,updated_at=datetime('now') WHERE id=?").run(name, JSON.stringify(filters || {}), req.params.id); res.json({ success: true }); } catch (e) { res.json({ error: e.message }); } });
router.delete('/configs/:id', (req, res) => { try { db.prepare('DELETE FROM screener_configs WHERE id=?').run(req.params.id); res.json({ success: true }); } catch (e) { res.json({ error: e.message }); } });


// ═══ Sector Intelligence — rotation heatmap, flow timeline, correlation ═══

// Weekly aggregated sector/industry data
router.get('/sector-intelligence', (req, res) => {
  try {
    const { latestFundDate } = require('../db');
    const td = latestIdxDate();
    const sm = latestFundDate();
    if (!sm || !td) return res.json({ error: 'No data' });
    const weeks = parseInt(req.query.weeks) || 12;
    const level = req.query.level || 'sector'; // sector | industry

    // Get all trade dates
    const allDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
    if (allDates.length < 5) return res.json({ error: 'Need more data' });

    // Build week buckets (Mon-Fri groups)
    const weekBuckets = [];
    let currentWeek = [];
    for (const d of allDates) {
      const dow = new Date(d + 'T00:00:00').getDay();
      if (dow === 1 && currentWeek.length > 0) { // Monday = new week
        weekBuckets.push(currentWeek);
        currentWeek = [];
      }
      currentWeek.push(d);
    }
    if (currentWeek.length) weekBuckets.push(currentWeek);

    // Take last N weeks
    const recentWeeks = weekBuckets.slice(-weeks);

    // Build ticker → sector/industry map
    const fundMap = {};
    db.prepare("SELECT code, sector, industry FROM idx_fundamental WHERE snapshot_month=? AND sector!=''").all(sm)
      .forEach(f => { fundMap[f.code] = { sector: f.sector, industry: f.industry }; });

    // For each week, aggregate by sector/industry
    const weeklyData = [];
    for (const wDates of recentWeeks) {
      if (!wDates.length) continue;
      const ph = wDates.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT code, 
               SUM((foreign_buy - foreign_sell) * close) as fnet_val,
               SUM(value) as total_value,
               SUM(volume) as total_volume,
               MIN(close) as week_low, MAX(close) as week_high
        FROM idx_daily WHERE trade_date IN (${ph}) AND close > 0
        GROUP BY code
      `).all(...wDates);

      // Get first/last close for price change calc
      const firstDate = wDates[0], lastDate = wDates[wDates.length - 1];
      const firstCloses = {};
      const lastCloses = {};
      db.prepare('SELECT code, close FROM idx_daily WHERE trade_date=? AND close>0').all(firstDate)
        .forEach(r => { firstCloses[r.code] = r.close; });
      db.prepare('SELECT code, close FROM idx_daily WHERE trade_date=? AND close>0').all(lastDate)
        .forEach(r => { lastCloses[r.code] = r.close; });

      const groups = {};
      for (const r of rows) {
        const f = fundMap[r.code];
        if (!f) continue;
        const key = level === 'industry' ? f.industry : f.sector;
        if (!key) continue;
        if (!groups[key]) groups[key] = { name: key, sector: f.sector, fnet: 0, value: 0, volume: 0, stocks: 0, chg_sum: 0, chg_count: 0 };
        const g = groups[key];
        g.fnet += r.fnet_val || 0;
        g.value += r.total_value || 0;
        g.volume += r.total_volume || 0;
        g.stocks++;
        // Price change for this stock this week
        const fc = firstCloses[r.code], lc = lastCloses[r.code];
        if (fc && lc && fc > 0) {
          g.chg_sum += (lc - fc) / fc * 100;
          g.chg_count++;
        }
      }

      weeklyData.push({
        week_start: firstDate,
        week_end: lastDate,
        days: wDates.length,
        groups: Object.values(groups).map(g => ({
          name: g.name,
          sector: g.sector,
          fnet: g.fnet,
          value: g.value,
          volume: g.volume,
          stocks: g.stocks,
          avg_chg: g.chg_count ? Math.round(g.chg_sum / g.chg_count * 100) / 100 : 0
        }))
      });
    }

    // Get unique group names for consistent ordering
    const groupNames = [...new Set(weeklyData.flatMap(w => w.groups.map(g => g.name)))].sort();

    res.json({ level, weeks: weeklyData, group_names: groupNames, trade_date: td, snapshot_month: sm });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ═══ Correlation — price movement correlation between stocks ═══
router.get('/correlation', (req, res) => {
  try {
    const { latestFundDate, latestSnap } = require('../db');
    const sm = latestFundDate();
    const sd = latestSnap();
    const mode = (req.query.mode || 'ownership').trim();
    const sector = (req.query.sector || '').trim();
    const industry = (req.query.industry || '').trim();
    const days = parseInt(req.query.days) || 65;
    const minCorr = parseFloat(req.query.min) || 0.7;

    let tickerPairs = [];
    let tickers = [];

    const fundInfo = {};
    if (sm) {
      db.prepare("SELECT code, sector, industry, name FROM idx_fundamental WHERE snapshot_month=? AND sector!=''").all(sm)
        .forEach(f => { fundInfo[f.code] = f; });
    }

    if (mode === 'ownership') {
      if (!sd) return res.json({ pairs: [], error: 'No holdings data', mode });
      const invMap = {};
      db.prepare('SELECT code, investor_norm FROM holdings WHERE snapshot_date=? AND pct>=1').all(sd)
        .forEach(r => {
          if (!invMap[r.investor_norm]) invMap[r.investor_norm] = new Set();
          invMap[r.investor_norm].add(r.code);
        });
      const pairSet = new Set();
      for (const [inv, codes] of Object.entries(invMap)) {
        if (codes.size < 2 || codes.size > 50) continue;
        const arr = [...codes];
        for (let i = 0; i < arr.length && i < 20; i++) {
          for (let j = i + 1; j < arr.length && j < 20; j++) {
            const key = [arr[i], arr[j]].sort().join('|');
            pairSet.add(key);
          }
        }
      }
      tickerPairs = [...pairSet].map(k => { const [a, b] = k.split('|'); return { a, b }; });
      tickers = [...new Set(tickerPairs.flatMap(p => [p.a, p.b]))];

    } else if (mode === 'industry') {
      const indMap = {};
      for (const [code, f] of Object.entries(fundInfo)) {
        if (!f.industry) continue;
        if (!indMap[f.industry]) indMap[f.industry] = [];
        indMap[f.industry].push(code);
      }
      for (const [ind, codes] of Object.entries(indMap)) {
        if (codes.length < 2) continue;
        const limited = codes.slice(0, 30);
        for (let i = 0; i < limited.length; i++) {
          for (let j = i + 1; j < limited.length; j++) {
            tickerPairs.push({ a: limited[i], b: limited[j] });
          }
        }
      }
      tickers = [...new Set(tickerPairs.flatMap(p => [p.a, p.b]))];

    } else {
      if (industry) {
        tickers = Object.keys(fundInfo).filter(c => fundInfo[c].industry === industry);
      } else if (sector) {
        tickers = Object.keys(fundInfo).filter(c => fundInfo[c].sector === sector);
      } else {
        const td = latestIdxDate();
        tickers = db.prepare('SELECT code FROM idx_daily WHERE trade_date=? AND close>0 ORDER BY value DESC LIMIT 150').all(td).map(r => r.code);
      }
    }

    if (tickers.length < 2) return res.json({ pairs: [], tickers: tickers.length, mode });

    const dates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT ?').all(days).map(r => r.trade_date).reverse();
    if (dates.length < 10) return res.json({ pairs: [], error: 'Need more data' });

    const returns = {};
    for (const code of tickers) {
      const rows = db.prepare('SELECT trade_date, close FROM idx_daily WHERE code=? AND trade_date>=? ORDER BY trade_date')
        .all(code, dates[0]);
      if (rows.length < dates.length * 0.7) continue;
      const dailyRet = [];
      for (let i = 1; i < rows.length; i++) {
        if (rows[i - 1].close > 0) dailyRet.push((rows[i].close - rows[i - 1].close) / rows[i - 1].close);
      }
      if (dailyRet.length >= 10) returns[code] = dailyRet;
    }

    const pairs = [];
    const calcCorr = (codeA, codeB) => {
      const a = returns[codeA], b = returns[codeB];
      if (!a || !b) return null;
      const n = Math.min(a.length, b.length);
      if (n < 10) return null;
      const ax = a.slice(-n), bx = b.slice(-n);
      const ma = ax.reduce((s, v) => s + v, 0) / n;
      const mb = bx.reduce((s, v) => s + v, 0) / n;
      let num = 0, da = 0, db2 = 0;
      for (let k = 0; k < n; k++) {
        num += (ax[k] - ma) * (bx[k] - mb);
        da += (ax[k] - ma) ** 2;
        db2 += (bx[k] - mb) ** 2;
      }
      return (da > 0 && db2 > 0) ? num / Math.sqrt(da * db2) : 0;
    };

    if (tickerPairs.length > 0) {
      for (const { a, b } of tickerPairs) {
        const corr = calcCorr(a, b);
        if (corr !== null && Math.abs(corr) >= minCorr) {
          pairs.push({ a, b, corr: Math.round(corr * 1000) / 1000 });
        }
      }
    } else {
      const codes = Object.keys(returns);
      for (let i = 0; i < codes.length; i++) {
        for (let j = i + 1; j < codes.length; j++) {
          const corr = calcCorr(codes[i], codes[j]);
          if (corr !== null && Math.abs(corr) >= minCorr) {
            pairs.push({ a: codes[i], b: codes[j], corr: Math.round(corr * 1000) / 1000 });
          }
        }
      }
    }

    pairs.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));

    const holdingsCache = {};
    function getHolders(code) {
      if (!holdingsCache[code] && sd) {
        holdingsCache[code] = db.prepare('SELECT investor_norm, investor, pct FROM holdings WHERE snapshot_date=? AND code=? AND pct>=1 ORDER BY pct DESC').all(sd, code);
      }
      return holdingsCache[code] || [];
    }

    const enriched = pairs.slice(0, 50).map(p => {
      const holdersA = getHolders(p.a);
      const holdersB = getHolders(p.b);
      const aSet = new Set(holdersA.map(h => h.investor_norm));
      const common = holdersB.filter(h => aSet.has(h.investor_norm)).map(h => h.investor.substring(0, 30));
      return {
        ...p,
        a_sector: fundInfo[p.a]?.sector || '',
        a_industry: fundInfo[p.a]?.industry || '',
        b_sector: fundInfo[p.b]?.sector || '',
        b_industry: fundInfo[p.b]?.industry || '',
        common_owners: common.slice(0, 5)
      };
    });

    res.json({ pairs: enriched, tickers: Object.keys(returns).length, days: dates.length, min_corr: minCorr, mode, sector, industry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ Fundamental lists — sector/industry dropdowns ═══
router.get('/fundamental-lists', (req, res) => {
  try {
    const { latestFundDate } = require('../db');
    const sm = latestFundDate();
    if (!sm) return res.json({ sectors: [], industries: [], sector_industry_map: {} });
    const rows = db.prepare("SELECT DISTINCT sector, industry FROM idx_fundamental WHERE snapshot_month=? AND sector!='' AND industry!=''").all(sm);
    const sectors = [...new Set(rows.map(r => r.sector))].sort();
    const industries = [...new Set(rows.map(r => r.industry))].sort();
    const sim = {};
    rows.forEach(r => {
      if (!sim[r.sector]) sim[r.sector] = [];
      if (!sim[r.sector].includes(r.industry)) sim[r.sector].push(r.industry);
    });
    for (const k of Object.keys(sim)) sim[k].sort();
    res.json({ sectors, industries, sector_industry_map: sim });
  } catch (e) { res.json({ sectors: [], industries: [] }); }
});

module.exports = router;