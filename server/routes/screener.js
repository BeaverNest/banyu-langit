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

    const results = [];
    for (const stock of stocks) {
      let pass = true;
      let tech = {};

      if (needTech) {
        const hist = db.prepare('SELECT close,high,low,volume FROM idx_daily WHERE code=? ORDER BY trade_date').all(stock.code);
        if (hist.length >= 5) {
          const closes = hist.map(h => h.close), highs = hist.map(h => h.high || h.close), lows = hist.map(h => h.low || h.close), vols = hist.map(h => h.volume);
          tech.ma5 = calcMA(closes, 5); tech.ma10 = calcMA(closes, 10); tech.ma20 = calcMA(closes, 20);
          tech.ma50 = calcMA(closes, 50); tech.ma100 = calcMA(closes, 100); tech.ma200 = calcMA(closes, 200);
          if (closes.length >= 26) tech.macd = calcMACD(closes);
          if (closes.length >= 14) tech.stoch = calcStochastic(highs, lows, closes);
          const avgVol = vols.slice(-20, -1);
          if (avgVol.length) tech.vol_ratio = Math.round(stock.volume / (avgVol.reduce((s, v) => s + v, 0) / avgVol.length) * 10) / 10;
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
    res.json({ data: results.slice(0, limit), total: results.length, trade_date: td });
  } catch (e) { res.json({ data: [], error: e.message }); }
});

router.get('/configs', (req, res) => { try { const c = db.prepare('SELECT * FROM screener_configs ORDER BY updated_at DESC').all(); c.forEach(x => { try { x.filters = JSON.parse(x.filters); } catch { x.filters = {}; } }); res.json(c); } catch { res.json([]); } });
router.post('/configs', (req, res) => { try { const { name, filters } = req.body; if (!name) return res.status(400).json({ error: 'Name required' }); const r = db.prepare('INSERT INTO screener_configs(name,filters) VALUES(?,?)').run(name, JSON.stringify(filters || {})); res.json({ success: true, id: r.lastInsertRowid }); } catch (e) { res.json({ error: e.message }); } });
router.put('/configs/:id', (req, res) => { try { const { name, filters } = req.body; db.prepare("UPDATE screener_configs SET name=?,filters=?,updated_at=datetime('now') WHERE id=?").run(name, JSON.stringify(filters || {}), req.params.id); res.json({ success: true }); } catch (e) { res.json({ error: e.message }); } });
router.delete('/configs/:id', (req, res) => { try { db.prepare('DELETE FROM screener_configs WHERE id=?').run(req.params.id); res.json({ success: true }); } catch (e) { res.json({ error: e.message }); } });

module.exports = router;
