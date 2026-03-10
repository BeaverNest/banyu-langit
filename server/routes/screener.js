const express = require('express');
const { db, latestIdxDate } = require('../db');

const router = express.Router();

function calcMA(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return Math.round(slice.reduce((s, v) => s + v, 0) / period);
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
    const groups = req.body.groups || null; // [[rule1,rule2],[rule3]] — groups of AND, connected by OR
    const ruleLogic = req.body.logic || 'AND';
    const limit = Math.min(parseInt(req.body.limit) || 50, 9999);
    const alwaysTech = req.body.always_tech !== false;
    const td = latestIdxDate();
    if (!td) return res.json({ data: [], trade_date: null });

    let stocks = db.prepare(`SELECT *, (foreign_buy-foreign_sell) as foreign_net, ((foreign_buy-foreign_sell)*close) as foreign_net_val, CASE WHEN prev_close>0 THEN ROUND(CAST((close-prev_close)AS REAL)/prev_close*100,2) ELSE 0 END as change_pct FROM idx_daily WHERE trade_date=? AND close>0`).all(td);

    // Join fundamental data
    const { latestFundDate } = require('../db');
    const fm = latestFundDate();
    const fundMap = {};
    if (fm) { db.prepare('SELECT * FROM idx_fundamental WHERE snapshot_month=?').all(fm).forEach(f => { fundMap[f.code] = f; }); }
    stocks = stocks.map(s => ({ ...s, fund: fundMap[s.code] || null }));

    // ── Pre-compute activity spike averages ──
    const avgDays = 20;
    const dates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT ?').all(avgDays + 1).map(r => r.trade_date);
    const avgDates = dates.slice(1);
    const avgMap = {};
    if (avgDates.length >= 3) {
      const ph = avgDates.map(() => '?').join(',');
      db.prepare(`SELECT code, AVG(volume) as avg_vol, AVG(value) as avg_val, AVG(frequency) as avg_freq,
        AVG(ABS((foreign_buy-foreign_sell)*close)) as avg_fnet_abs
        FROM idx_daily WHERE trade_date IN (${ph}) AND close>0
        GROUP BY code`).all(...avgDates)
        .forEach(r => { avgMap[r.code] = r; });
    }

    // ── Quarterly data for EPS/dividend ──
    const qtrMap = {};
    try {
      db.prepare('SELECT code, eps, dividend_per_share FROM quarterly_financials WHERE period_type=? ORDER BY period DESC').all('quarterly')
        .forEach(r => { if (!qtrMap[r.code]) qtrMap[r.code] = r; }); // latest per code
    } catch(e) {}

    const hasRules = (groups && groups.some(g => g && g.length > 0)) || rules.length > 0;

    if (!hasRules && !alwaysTech) {
      stocks.sort((a, b) => Math.abs(b.foreign_net_val) - Math.abs(a.foreign_net_val));
      return res.json({ data: stocks.slice(0, limit), total: stocks.length, trade_date: td });
    }

    const caMap = loadConfirmedCAs();
    const results = [];

    for (const stock of stocks) {
      let tech = {};

      // ── Tech indicators ──
      const hist = db.prepare('SELECT trade_date,close,high,low,volume,value,frequency,foreign_buy,foreign_sell FROM idx_daily WHERE code=? ORDER BY trade_date').all(stock.code);
      if (hist.length >= 5) {
        const actions = caMap[stock.code];
        const adjusted = actions ? hist.map(h => adjustRow(h, actions)) : hist;
        const closes = adjusted.map(h => h.close), highs = adjusted.map(h => h.high || h.close), lows = adjusted.map(h => h.low || h.close), vols = adjusted.map(h => h.volume);
        tech.ma5 = calcMA(closes, 5); tech.ma10 = calcMA(closes, 10); tech.ma20 = calcMA(closes, 20);
        tech.ma50 = calcMA(closes, 50); tech.ma100 = calcMA(closes, 100); tech.ma200 = calcMA(closes, 200);
        if (closes.length >= 26) tech.macd = calcMACD(closes);
        if (closes.length >= 14) tech.stoch = calcStochastic(highs, lows, closes);
        const avgVol = vols.slice(-20, -1);
        if (avgVol.length) tech.vol_ratio = Math.round(stock.volume / (avgVol.reduce((s, v) => s + v, 0) / avgVol.length) * 10) / 10;
        if (actions && actions.length) tech.adjusted = true;
      }

      // ── Activity spike ──
      const avg = avgMap[stock.code];
      if (avg) {
        tech.val_spike = avg.avg_val > 0 ? Math.round(stock.value / avg.avg_val * 10) / 10 : 0;
        tech.freq_spike = avg.avg_freq > 0 ? Math.round(stock.frequency / avg.avg_freq * 10) / 10 : 0;
        tech.fnet_spike = avg.avg_fnet_abs > 0 ? Math.round(Math.abs(stock.foreign_net_val) / avg.avg_fnet_abs * 10) / 10 : 0;
        tech.activity_score = Math.round(((tech.val_spike || 0) * 0.3 + (tech.freq_spike || 0) * 0.3 + (tech.vol_ratio || 0) * 0.2 + (tech.fnet_spike || 0) * 0.2) * 10) / 10;
      }

      // ── EPS / Dividend from quarterly ──
      const qtr = qtrMap[stock.code];
      if (qtr) {
        if (!stock.fund) stock.fund = {};
        if (qtr.eps) stock.fund.eps = qtr.eps;
        if (qtr.dividend_per_share && stock.close) stock.fund.div_yield = Math.round(qtr.dividend_per_share / stock.close * 10000) / 100;
      }

      // ── Free float ──
      if (stock.tradeable_shares && stock.listed_shares) {
        if (!stock.fund) stock.fund = {};
        stock.fund.free_float = Math.round(stock.tradeable_shares / stock.listed_shares * 1000) / 10;
      }

      // ── Apply rules: groups mode or legacy ──
      if (groups && groups.some(g => g && g.length > 0)) {
        // Groups: (group1 AND) OR (group2 AND) OR ...
        const pass = groups.some(group => {
          if (!group || !group.length) return true;
          return group.every(rule => evalRule(rule, stock, tech));
        });
        if (!pass) continue;
      } else if (rules.length) {
        let pass;
        if (ruleLogic === 'OR') {
          pass = rules.some(rule => evalRule(rule, stock, tech));
        } else {
          pass = rules.every(rule => evalRule(rule, stock, tech));
        }
        if (!pass) continue;
      }

      results.push({ ...stock, tech });
    }

    results.sort((a, b) => Math.abs(b.foreign_net_val || 0) - Math.abs(a.foreign_net_val || 0));
    res.json({ data: results.slice(0, limit), total: results.length, trade_date: td, adjusted: Object.keys(caMap).length > 0 });
  } catch (e) { res.json({ data: [], error: e.message }); }
});


// ═══ AFL-STYLE FORMULA SCREENER — OPTIMIZED ═══
// Key optimization: bulk-load all history in ONE query, then split per code in memory

// In-memory cache for bulk history (cleared on new trade date)
let _histCache = { td: null, data: null };

function bulkLoadHistory(td) {
  if (_histCache.td === td && _histCache.data) return _histCache.data;
  // Single query: load last 210 days of history for ALL tickers
  const allDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT 210').all().map(r => r.trade_date);
  if (!allDates.length) return {};
  const minDate = allDates[allDates.length - 1];
  const rows = db.prepare('SELECT code,trade_date,close,high,low,volume,value,frequency,foreign_buy,foreign_sell FROM idx_daily WHERE trade_date>=? ORDER BY code,trade_date').all(minDate);
  
  // Group by code
  const map = {};
  for (const r of rows) {
    if (!map[r.code]) map[r.code] = [];
    map[r.code].push(r);
  }
  _histCache = { td, data: map };
  return map;
}

// Detect which variable categories the formula needs
function detectNeeds(formula) {
  const f = formula.toUpperCase();
  return {
    ma: /MA\d|DISTMA|UP_MA|SHORTTREND|INTERMEDIATE|LONGTREND/i.test(formula),
    macd: /MACD|SIGNAL|BULLISH|BEARISH|DEATHCROSS/i.test(formula),
    stoch: /STOCH|^K\b|^D\b|\bK\s|K\s*[<>=]|D\s*[<>=]/i.test(formula),
    hhv: /HHV|LLV|ISBASE|ISNEARLOW|ISBREAKOUT|PREVHHV/i.test(formula),
    foreign: /FOREIGN|F0|F1|F2|F3|F4|FOREIGN_5D|FOREIGNNET|FOREIGNBUY|FOREIGNSELL/i.test(formula),
    relvol: /RELVOL/i.test(formula),
  };
}

router.post('/formula', (req, res) => {
  const startTime = Date.now();
  try {
    const formula = (req.body.formula || '').trim();
    const limit = Math.min(parseInt(req.body.limit) || 200, 9999);
    if (!formula) return res.json({ error: 'No formula provided' });

    const td = latestIdxDate();
    if (!td) return res.json({ data: [], error: 'No data' });

    const tokens = tokenizeFormula(formula);
    if (tokens.error) return res.json({ error: 'Parse error: ' + tokens.error });

    // Detect what the formula needs
    const needs = detectNeeds(formula);

    // Get today's stocks
    let stocks = db.prepare(`SELECT *, (foreign_buy-foreign_sell) as foreign_net, ((foreign_buy-foreign_sell)*close) as foreign_net_val, CASE WHEN prev_close>0 THEN ROUND(CAST((close-prev_close)AS REAL)/prev_close*100,2) ELSE 0 END as change_pct FROM idx_daily WHERE trade_date=? AND close>0`).all(td);

    // Fundamental (single query)
    const { latestFundDate } = require('../db');
    const fm = latestFundDate();
    const fundMap = {};
    if (fm) db.prepare('SELECT * FROM idx_fundamental WHERE snapshot_month=?').all(fm).forEach(f => { fundMap[f.code] = f; });

    // Bulk load history ONCE (the key optimization)
    const histMap = (needs.ma || needs.macd || needs.stoch || needs.hhv || needs.foreign || needs.relvol) ? bulkLoadHistory(td) : {};
    const caMap = (needs.ma || needs.macd || needs.stoch) ? loadConfirmedCAs() : {};
    
    const results = [];

    for (const stock of stocks) {
      const fund = fundMap[stock.code] || {};
      const hist = histMap[stock.code] || [];
      let tech = {};
      let extraCtx = {};

      if (hist.length >= 5) {
        const actions = caMap[stock.code];
        const adjusted = actions ? hist.map(h => adjustRow(h, actions)) : hist;
        const closes = adjusted.map(h => h.close);
        
        // Only compute what's needed
        if (needs.ma) {
          const highs = adjusted.map(h => h.high || h.close);
          const lows = adjusted.map(h => h.low || h.close);
          tech.ma3 = calcMA(closes, 3); tech.ma5 = calcMA(closes, 5); tech.ma10 = calcMA(closes, 10);
          tech.ma20 = calcMA(closes, 20); tech.ma30 = calcMA(closes, 30); tech.ma50 = calcMA(closes, 50);
          tech.ma100 = calcMA(closes, 100); tech.ma200 = calcMA(closes, 200);
          
          // Composite trends
          const c = stock.close;
          extraCtx.ShortTrend = (c > (tech.ma10||0) && c > (tech.ma20||0)) ? 1 : 0;
          extraCtx.Intermediate = (c > (tech.ma20||0) && c > (tech.ma50||0)) ? 1 : 0;
          extraCtx.LongTrend = (c > (tech.ma20||0) && c > (tech.ma50||0) && c > (tech.ma200||0)) ? 1 : 0;
          extraCtx.Up_MA5 = c > (tech.ma5||0) ? 1 : 0;
          extraCtx.Up_MA10 = c > (tech.ma10||0) ? 1 : 0;
          extraCtx.Up_MA20 = c > (tech.ma20||0) ? 1 : 0;
          extraCtx.Up_MA50 = c > (tech.ma50||0) ? 1 : 0;
          extraCtx.Up_MA100 = c > (tech.ma100||0) ? 1 : 0;
          extraCtx.Up_MA200 = c > (tech.ma200||0) ? 1 : 0;
        }
        
        if (needs.macd && closes.length >= 26) {
          tech.macd = calcMACD(closes);
          const mv = tech.macd ? tech.macd.macd : 0, sv = tech.macd ? tech.macd.signal : 0, hv = tech.macd ? tech.macd.histogram : 0;
          extraCtx.Bullish_MACD = (mv > sv && hv > 0) ? 1 : 0;
          extraCtx.BullishWeak_MACD = (mv > sv && hv < 0) ? 1 : 0;
          extraCtx.Bearish_MACD = (mv < sv && hv < 0) ? 1 : 0;
          extraCtx.BearishWeak_MACD = (mv < sv && hv > 0) ? 1 : 0;
          extraCtx.MACD_Status = extraCtx.Bullish_MACD ? 2 : extraCtx.BullishWeak_MACD ? 1 : extraCtx.Bearish_MACD ? -2 : extraCtx.BearishWeak_MACD ? -1 : 0;
          extraCtx.MACDCross = tech.macd && tech.macd.cross === 'golden' ? 1 : 0;
          extraCtx.MACDDeathCross = tech.macd && tech.macd.cross === 'death' ? 1 : 0;
        }
        
        if (needs.stoch && closes.length >= 14) {
          const highs = adjusted.map(h => h.high || h.close);
          const lows = adjusted.map(h => h.low || h.close);
          tech.stoch = calcStochastic(highs, lows, closes);
          extraCtx.StochCrossUp = (tech.stoch && tech.stoch.k > (tech.stoch.d || 50)) ? 1 : 0;
          extraCtx.StochTrend = (tech.stoch && tech.stoch.k > (tech.stoch.d || 50)) ? 1 : 0;
        }
        
        if (needs.relvol) {
          const vols = adjusted.map(h => h.volume);
          const volMa20 = vols.length >= 20 ? vols.slice(-20).reduce((s,v)=>s+v,0)/20 : 0;
          extraCtx.RelVol = volMa20 > 0 ? Math.round(stock.volume / volMa20 * 10) / 10 : 0;
          tech.vol_ratio = extraCtx.RelVol;
        }
        
        if (needs.hhv) {
          const c20 = closes.slice(-20);
          const highs20 = adjusted.slice(-20).map(h => h.high || h.close);
          const lows20 = adjusted.slice(-20).map(h => h.low || h.close);
          extraCtx.HHV20 = c20.length ? Math.max(...highs20) : 0;
          extraCtx.LLV20 = c20.length ? Math.min(...lows20) : 0;
          extraCtx.HHV_C20 = c20.length ? Math.max(...c20) : 0;
          extraCtx.LLV_C20 = c20.length ? Math.min(...c20) : 0;
          const c21 = closes.slice(-21, -1);
          extraCtx.PrevHHV20 = c21.length >= 20 ? Math.max(...c21) : extraCtx.HHV_C20;
          const range20 = extraCtx.HHV_C20 - extraCtx.LLV_C20;
          const prevClose20 = closes.length >= 21 ? closes[closes.length - 21] : stock.close;
          extraCtx.isBase = prevClose20 > 0 ? (range20 / prevClose20 < 0.1 ? 1 : 0) : 0;
          extraCtx.isNearLow = extraCtx.LLV_C20 > 0 ? (stock.close <= extraCtx.LLV_C20 * 1.1 ? 1 : 0) : 0;
          extraCtx.isBreakout = stock.close > extraCtx.PrevHHV20 ? 1 : 0;
        }
        
        if (needs.foreign) {
          const recent5 = hist.slice(-5);
          extraCtx.Foreign_5D = recent5.reduce((s,r) => s + ((r.foreign_buy||0) - (r.foreign_sell||0)) * (r.close||0), 0);
          for (let fi = 0; fi < 5; fi++) {
            const ri = hist.length - 1 - fi;
            if (ri >= 0) {
              const fr = hist[ri];
              extraCtx['F' + fi] = ((fr.foreign_buy||0) - (fr.foreign_sell||0)) * (fr.close||0);
            } else extraCtx['F' + fi] = 0;
          }
        }
      }

      // Build variable context
      const distMA = (ma) => ma ? Math.round((stock.close - ma) / ma * 10000) / 100 : 0;
      const ctx = {
        C: stock.close, O: stock.open_price, H: stock.high, L: stock.low,
        Close: stock.close, Open: stock.open_price, High: stock.high, Low: stock.low,
        Chg: stock.change_pct || 0,
        V: stock.volume, Volume: stock.volume, Val: stock.value, Value: stock.value,
        Freq: stock.frequency, DVMil: (stock.value || 0) / 1e6,
        MA3: tech.ma3||0, MA5: tech.ma5||0, MA10: tech.ma10||0, MA20: tech.ma20||0,
        MA30: tech.ma30||0, MA50: tech.ma50||0, MA100: tech.ma100||0, MA200: tech.ma200||0,
        DistMA3: distMA(tech.ma3), DistMA5: distMA(tech.ma5), DistMA10: distMA(tech.ma10),
        DistMA20: distMA(tech.ma20), DistMA30: distMA(tech.ma30), DistMA50: distMA(tech.ma50),
        DistMA100: distMA(tech.ma100), DistMA200: distMA(tech.ma200),
        MACD: tech.macd ? tech.macd.macd : 0, Signal: tech.macd ? tech.macd.signal : 0,
        MACD_Hist: tech.macd ? tech.macd.histogram : 0,
        K: tech.stoch ? tech.stoch.k : 50, StochK: tech.stoch ? tech.stoch.k : 50,
        D: tech.stoch ? (tech.stoch.d||50) : 50, StochD: tech.stoch ? (tech.stoch.d||50) : 50,
        ForeignNet: stock.foreign_net_val || 0,
        ForeignBuy: (stock.foreign_buy||0) * stock.close,
        ForeignSell: (stock.foreign_sell||0) * stock.close,
        PER: fund.per||0, PBV: fund.pbv||0, ROE: fund.roe||0, ROA: fund.roa||0,
        DER: fund.der||0, NPM: fund.npm||0, MktCap: fund.mkt_cap||0, YTD: fund.ytd||0,
        ...extraCtx,
      };

      try {
        const pass = evalFormula(tokens, ctx);
        if (pass) results.push({ ...stock, tech, fund, extra: extraCtx });
      } catch (e) {
        return res.json({ error: 'Eval error on ' + stock.code + ': ' + e.message });
      }
    }

    results.sort((a, b) => Math.abs(b.foreign_net_val || 0) - Math.abs(a.foreign_net_val || 0));
    res.json({ data: results.slice(0, limit), total: results.length, trade_date: td, parse_time: Date.now() - startTime });
  } catch (e) { res.json({ error: e.message }); }
});

// ═══ FORMULA TOKENIZER ═══
function tokenizeFormula(formula) {
  const tokens = [];
  let i = 0;
  const s = formula.replace(/\s+/g, ' ').trim();

  while (i < s.length) {
    // Skip whitespace
    if (s[i] === ' ') { i++; continue; }

    // Parentheses
    if (s[i] === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
    if (s[i] === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }

    // Operators: >=, <=, ==, !=, >, <
    if (s[i] === '>' && s[i+1] === '=') { tokens.push({ type: 'OP', value: '>=' }); i += 2; continue; }
    if (s[i] === '<' && s[i+1] === '=') { tokens.push({ type: 'OP', value: '<=' }); i += 2; continue; }
    if (s[i] === '=' && s[i+1] === '=') { tokens.push({ type: 'OP', value: '==' }); i += 2; continue; }
    if (s[i] === '!' && s[i+1] === '=') { tokens.push({ type: 'OP', value: '!=' }); i += 2; continue; }
    if (s[i] === '>') { tokens.push({ type: 'OP', value: '>' }); i++; continue; }
    if (s[i] === '<') { tokens.push({ type: 'OP', value: '<' }); i++; continue; }

    // Numbers (including negative and scientific notation)
    if (s[i] === '-' && i + 1 < s.length && (s[i+1] >= '0' && s[i+1] <= '9') && (tokens.length === 0 || tokens[tokens.length-1].type === 'LPAREN' || tokens[tokens.length-1].type === 'LOGIC' || tokens[tokens.length-1].type === 'OP')) {
      let num = '-'; i++;
      while (i < s.length && (s[i] >= '0' && s[i] <= '9' || s[i] === '.' || s[i] === 'e' || s[i] === 'E')) { num += s[i]; i++; }
      tokens.push({ type: 'NUM', value: parseFloat(num) }); continue;
    }
    if (s[i] >= '0' && s[i] <= '9') {
      let num = '';
      while (i < s.length && (s[i] >= '0' && s[i] <= '9' || s[i] === '.' || s[i] === 'e' || s[i] === 'E')) { num += s[i]; i++; }
      tokens.push({ type: 'NUM', value: parseFloat(num) }); continue;
    }

    // Words: AND, OR, variable names
    if ((s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= 'a' && s[i] <= 'z') || s[i] === '_') {
      let word = '';
      while (i < s.length && ((s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= 'a' && s[i] <= 'z') || (s[i] >= '0' && s[i] <= '9') || s[i] === '_')) { word += s[i]; i++; }
      if (word.toUpperCase() === 'AND') tokens.push({ type: 'LOGIC', value: 'AND' });
      else if (word.toUpperCase() === 'OR') tokens.push({ type: 'LOGIC', value: 'OR' });
      else tokens.push({ type: 'VAR', value: word });
      continue;
    }

    return { error: 'Unexpected character: "' + s[i] + '" at position ' + i };
  }
  return tokens;
}

// ═══ FORMULA EVALUATOR (recursive descent parser) ═══
function evalFormula(tokens, ctx) {
  let pos = 0;

  function peek() { return pos < tokens.length ? tokens[pos] : null; }
  function consume() { return tokens[pos++]; }
  function expect(type) {
    const t = peek();
    if (!t || t.type !== type) throw new Error('Expected ' + type + ' but got ' + (t ? t.type + ':' + (t.value||'') : 'EOF'));
    return consume();
  }

  // Grammar (left-to-right, AND/OR same priority):
  // expr     = factor ((AND|OR) factor)*
  // factor   = atom (OP atom)?
  // atom     = NUM | VAR | LPAREN expr RPAREN

  function parseExpr() {
    let result = parseFactor();
    while (peek() && peek().type === 'LOGIC') {
      const logic = consume().value;
      const right = parseFactor();
      if (logic === 'AND') result = (toNum(result) && toNum(right)) ? 1 : 0;
      else result = (toNum(result) || toNum(right)) ? 1 : 0;
    }
    return result;
  }

  function parseFactor() {
    let left = parseAtom();
    // Check if followed by comparison operator
    if (peek() && peek().type === 'OP') {
      const op = consume().value;
      const right = parseAtom();
      const l = toNum(left), r = toNum(right);
      if (op === '>') return l > r ? 1 : 0;
      if (op === '<') return l < r ? 1 : 0;
      if (op === '>=') return l >= r ? 1 : 0;
      if (op === '<=') return l <= r ? 1 : 0;
      if (op === '==') return l === r ? 1 : 0;
      if (op === '!=') return l !== r ? 1 : 0;
    }
    return left; // standalone var or number — returned as-is
  }

  function parseAtom() {
    const t = peek();
    if (!t) throw new Error('Unexpected end of formula');

    if (t.type === 'NUM') { consume(); return t.value; }

    if (t.type === 'VAR') {
      consume();
      if (ctx.hasOwnProperty(t.value)) return ctx[t.value];
      // Try case-insensitive lookup
      const lower = t.value.toLowerCase();
      for (const k of Object.keys(ctx)) { if (k.toLowerCase() === lower) return ctx[k]; }
      throw new Error('Unknown variable: ' + t.value);
    }

    if (t.type === 'LPAREN') {
      consume(); // eat (
      const result = parseExpr();
      expect('RPAREN'); // eat )
      return result;
    }

    throw new Error('Unexpected: ' + t.type + (t.value ? ':' + t.value : ''));
  }

  // Convert to number for comparisons (boolean true=1, false=0)
  function toNum(v) {
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v || 0;
  }

  const result = parseExpr();
  return !!toNum(result);
}

// ═══ Rule evaluation helper ═══
function evalRule(rule, stock, tech) {
  if (!rule.field) return true;
  const f = rule.field;
  const isCompare = f.startsWith('close_vs_') || f === 'macd_signal';
  const op = rule.op || (isCompare ? 'above' : '>');
  const val = rule.val;
  const fund = stock.fund || {};

  if (f === 'close') return applyOp(stock.close, op, val);
  if (f === 'change_pct') return applyOp(stock.change_pct, op, val);
  if (f === 'volume_lot') return applyOp(stock.volume / 100, op, val);
  if (f === 'value') return applyOp(stock.value, op, val);
  if (f === 'frequency') return applyOp(stock.frequency, op, val);
  if (f === 'foreign_net_val') return applyOp(stock.foreign_net_val, op, val);
  if (f === 'vol_spike') return tech.vol_ratio ? applyOp(tech.vol_ratio, op, val) : false;
  if (f === 'val_spike') return tech.val_spike ? applyOp(tech.val_spike, op, val) : false;
  if (f === 'freq_spike') return tech.freq_spike ? applyOp(tech.freq_spike, op, val) : false;
  if (f === 'fnet_spike') return tech.fnet_spike ? applyOp(tech.fnet_spike, op, val) : false;
  if (f === 'activity_score') return tech.activity_score ? applyOp(tech.activity_score, op, val) : false;
  // Fundamental
  if (f === 'per') return fund.per ? applyOp(fund.per, op, val) : false;
  if (f === 'pbv') return fund.pbv ? applyOp(fund.pbv, op, val) : false;
  if (f === 'roe') return applyOp(fund.roe || 0, op, val);
  if (f === 'roa') return applyOp(fund.roa || 0, op, val);
  if (f === 'der') return applyOp(fund.der || 0, op, val);
  if (f === 'npm') return applyOp(fund.npm || 0, op, val);
  if (f === 'mkt_cap') return applyOp(fund.mkt_cap || 0, op, val);
  if (f === 'total_rev') return applyOp(fund.total_rev || 0, op, val);
  if (f === 'ytd') return applyOp(fund.ytd || 0, op, val);
  if (f === 'eps') return fund.eps ? applyOp(fund.eps, op, val) : false;
  if (f === 'div_yield') return fund.div_yield ? applyOp(fund.div_yield, op, val) : false;
  if (f === 'free_float') return fund.free_float ? applyOp(fund.free_float, op, val) : false;
  if (f === 'sector') return fund.sector === val;
  if (f === 'industry') return fund.industry ? fund.industry.toUpperCase().includes((val || '').toUpperCase()) : false;
  if (f === 'idx_index') return fund.idx_index && fund.idx_index.includes(val);
  // MA compare
  if (f.startsWith('close_vs_ma')) { const p = parseInt(f.replace('close_vs_ma', '')); const ma = tech['ma' + p]; if (!ma) return false; return op === 'above' ? stock.close > ma : stock.close < ma; }
  // MACD
  if (f === 'macd_hist') return tech.macd ? applyOp(tech.macd.histogram, op, val) : false;
  if (f === 'macd_cross') return tech.macd ? tech.macd.cross === val : false;
  if (f === 'macd_signal') { if (!tech.macd) return false; return op === 'above' ? tech.macd.macd > tech.macd.signal : tech.macd.macd < tech.macd.signal; }
  // Stochastic
  if (f === 'stoch_k') return tech.stoch ? applyOp(tech.stoch.k, op, val) : false;
  if (f === 'stoch_d') return tech.stoch && tech.stoch.d ? applyOp(tech.stoch.d, op, val) : false;
  if (f === 'stoch_zone') return tech.stoch ? tech.stoch.zone === val : false;
  // Foreign streak
  if (f === 'fnet_streak') { const days = Math.abs(parseInt(val) || 3); const dir = (parseFloat(val) || 0) >= 0 ? 'buy' : 'sell'; const recent = db.prepare('SELECT (foreign_buy-foreign_sell) as fn FROM idx_daily WHERE code=? ORDER BY trade_date DESC LIMIT ?').all(stock.code, days); if (recent.length < days) return false; return dir === 'buy' ? recent.every(r => r.fn > 0) : recent.every(r => r.fn < 0); }
  return true;
}

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
             d.close, d.value, d.volume, d.frequency, d.foreign_buy, d.foreign_sell,
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

    res.json({ trade_date: td, snapshot_month: sm, sectors, industries, stocks: stockList,
      ...(req.query.treemap ? { treemap: rows.map(r => ({ code: r.code, sector: r.sector, industry: r.industry, close: r.close, chg_pct: r.chg_pct || 0, mkt_cap: r.mkt_cap || 0, value: r.value || 0, volume: r.volume || 0, frequency: r.frequency || 0, fnet_val: r.fnet_val || 0, fbuy_val: (r.foreign_buy || 0) * (r.close || 0), fsell_val: (r.foreign_sell || 0) * (r.close || 0) })) } : {})
    });
  } catch (e) { res.json({ error: e.message }); }
});

router.get('/configs', (req, res) => { try { const c = db.prepare('SELECT * FROM screener_configs ORDER BY updated_at DESC').all(); c.forEach(x => { try { x.filters = JSON.parse(x.filters); } catch { x.filters = {}; } }); res.json(c); } catch { res.json([]); } });
router.post('/configs', (req, res) => { try { const { name, filters } = req.body; if (!name) return res.status(400).json({ error: 'Name required' }); const r = db.prepare('INSERT INTO screener_configs(name,filters) VALUES(?,?)').run(name, JSON.stringify(filters || {})); res.json({ success: true, id: r.lastInsertRowid }); } catch (e) { res.json({ error: e.message }); } });
router.put('/configs/:id', (req, res) => { try { const { name, filters } = req.body; if (name) { db.prepare("UPDATE screener_configs SET name=?,filters=?,updated_at=datetime('now') WHERE id=?").run(name, JSON.stringify(filters || {}), req.params.id); } else { db.prepare("UPDATE screener_configs SET filters=?,updated_at=datetime('now') WHERE id=?").run(JSON.stringify(filters || {}), req.params.id); } res.json({ success: true }); } catch (e) { res.json({ error: e.message }); } });
router.delete('/configs/:id', (req, res) => { try { db.prepare('DELETE FROM screener_configs WHERE id=?').run(req.params.id); res.json({ success: true }); } catch (e) { res.json({ error: e.message }); } });

// ═══ Activity Spike Detection ═══
router.get('/activity-spike', (req, res) => {
  try {
    const td = latestIdxDate();
    if (!td) return res.json({ data: [], trade_date: null });
    const avgDays = parseInt(req.query.avg) || 20;
    const minFreq = parseInt(req.query.min_freq) || 10; // min avg frequency to avoid penny stocks

    // Get all dates for avg period
    const dates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT ?').all(avgDays + 1).map(r => r.trade_date);
    if (dates.length < 5) return res.json({ data: [], error: 'Need more data' });

    const today = dates[0];
    const avgDates = dates.slice(1);
    const ph = avgDates.map(() => '?').join(',');

    // Today's data
    const todayData = {};
    db.prepare('SELECT code,name,close,volume,value,frequency,foreign_buy,foreign_sell FROM idx_daily WHERE trade_date=? AND close>0').all(today)
      .forEach(r => { todayData[r.code] = r; });

    // Average over past N days
    const avgData = {};
    db.prepare(`SELECT code, AVG(volume) as avg_vol, AVG(value) as avg_val, AVG(frequency) as avg_freq,
      AVG(ABS((foreign_buy-foreign_sell)*close)) as avg_fnet_abs
      FROM idx_daily WHERE trade_date IN (${ph}) AND close>0
      GROUP BY code HAVING AVG(frequency)>=?`).all(...avgDates, minFreq)
      .forEach(r => { avgData[r.code] = r; });

    // Calculate spikes
    const results = [];
    for (const [code, t] of Object.entries(todayData)) {
      const a = avgData[code];
      if (!a) continue;

      const valSpike = a.avg_val > 0 ? Math.round(t.value / a.avg_val * 10) / 10 : 0;
      const freqSpike = a.avg_freq > 0 ? Math.round(t.frequency / a.avg_freq * 10) / 10 : 0;
      const volSpike = a.avg_vol > 0 ? Math.round(t.volume / a.avg_vol * 10) / 10 : 0;
      const fnet = (t.foreign_buy - t.foreign_sell) * t.close;
      const fnetSpike = a.avg_fnet_abs > 0 ? Math.round(Math.abs(fnet) / a.avg_fnet_abs * 10) / 10 : 0;

      // Combined score — weighted
      const score = Math.round((valSpike * 0.3 + freqSpike * 0.3 + volSpike * 0.2 + fnetSpike * 0.2) * 10) / 10;

      results.push({
        code, name: t.name, close: t.close,
        volume: t.volume, value: t.value, frequency: t.frequency,
        fnet, fnet_val: fnet,
        avg_vol: Math.round(a.avg_vol), avg_val: Math.round(a.avg_val), avg_freq: Math.round(a.avg_freq),
        val_spike: valSpike, freq_spike: freqSpike, vol_spike: volSpike, fnet_spike: fnetSpike,
        score
      });
    }

    results.sort((a, b) => b.score - a.score);

    // Sector spike aggregation
    const { latestFundDate } = require('../db');
    const fm = latestFundDate();
    const sectorSpikes = {};
    if (fm) {
      const fundMap = {};
      db.prepare("SELECT code, sector FROM idx_fundamental WHERE snapshot_month=? AND sector!=''").all(fm)
        .forEach(f => { fundMap[f.code] = f.sector; });

      for (const r of results) {
        const sec = fundMap[r.code];
        if (!sec) continue;
        if (!sectorSpikes[sec]) sectorSpikes[sec] = { sector: sec, total_score: 0, count: 0, top_spike: null };
        sectorSpikes[sec].total_score += r.score;
        sectorSpikes[sec].count++;
        if (!sectorSpikes[sec].top_spike || r.score > sectorSpikes[sec].top_spike.score) {
          sectorSpikes[sec].top_spike = { code: r.code, score: r.score };
        }
      }
      for (const k of Object.keys(sectorSpikes)) {
        sectorSpikes[k].avg_score = Math.round(sectorSpikes[k].total_score / sectorSpikes[k].count * 10) / 10;
      }
    }

    // Dormant → Active: low avg freq (<30) but today freq spike > 3x
    const dormant = results.filter(r => r.avg_freq < 30 && r.freq_spike >= 3).sort((a, b) => b.freq_spike - a.freq_spike);

    res.json({
      data: results,
      dormant: dormant.slice(0, 30),
      sector_spikes: Object.values(sectorSpikes).sort((a, b) => b.avg_score - a.avg_score),
      trade_date: today, avg_days: avgDays, total: results.length
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Activity history for a single ticker (for chart)
router.get('/activity-history/:code', (req, res) => {
  try {
    const code = req.params.code.toUpperCase().trim();
    const days = parseInt(req.query.days) || 60;
    const rows = db.prepare('SELECT trade_date,close,volume,value,frequency,foreign_buy,foreign_sell FROM idx_daily WHERE code=? ORDER BY trade_date DESC LIMIT ?').all(code, days);
    rows.reverse();
    res.json({ code, data: rows.map(r => ({ ...r, fnet_val: (r.foreign_buy - r.foreign_sell) * r.close })) });
  } catch (e) { res.json({ code: req.params.code, data: [] }); }
});


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