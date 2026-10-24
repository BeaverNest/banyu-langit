const express = require('express');

// ═══ INDIKATOR TAMBAHAN (RSI, ATR, ADX, Bollinger) ═════════════════════════
function calcRSI(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const ch = closes[i] - closes[i - 1]; if (ch > 0) g += ch; else l -= ch; }
  g /= n; l /= n;
  let rsi = 100 - 100 / (1 + g / (l || 1e-9));
  for (let i = n + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    g = (g * (n - 1) + Math.max(ch, 0)) / n;
    l = (l * (n - 1) + Math.max(-ch, 0)) / n;
    rsi = 100 - 100 / (1 + g / (l || 1e-9));
  }
  return Math.round(rsi * 100) / 100;
}

function calcATR(highs, lows, closes, n = 14) {
  if (closes.length < n + 1) return null;
  const tr = [];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  let atr = tr.slice(0, n).reduce((a, x) => a + x, 0) / n;
  for (let i = n; i < tr.length; i++) atr = (atr * (n - 1) + tr[i]) / n;
  return Math.round(atr * 100) / 100;
}

function calcADX(highs, lows, closes, n = 14) {
  const len = closes.length;
  if (len < n * 2) return null;
  const tr = [], pdm = [], ndm = [];
  for (let i = 1; i < len; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    const up = highs[i] - highs[i - 1], dn = lows[i - 1] - lows[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
  }
  let atr = tr.slice(0, n).reduce((a, x) => a + x, 0);
  let sp = pdm.slice(0, n).reduce((a, x) => a + x, 0);
  let sn = ndm.slice(0, n).reduce((a, x) => a + x, 0);
  const dx = [];
  for (let i = n; i < tr.length; i++) {
    atr = atr - atr / n + tr[i];
    sp = sp - sp / n + pdm[i];
    sn = sn - sn / n + ndm[i];
    const pdi = atr > 0 ? 100 * sp / atr : 0;
    const ndi = atr > 0 ? 100 * sn / atr : 0;
    dx.push(pdi + ndi > 0 ? 100 * Math.abs(pdi - ndi) / (pdi + ndi) : 0);
  }
  if (dx.length < n) return null;
  let adx = dx.slice(0, n).reduce((a, x) => a + x, 0) / n;
  for (let i = n; i < dx.length; i++) adx = (adx * (n - 1) + dx[i]) / n;
  const lastAtr = atr / n;
  return {
    adx: Math.round(adx * 100) / 100,
    pdi: Math.round((lastAtr > 0 ? 100 * (sp / n) / lastAtr : 0) * 100) / 100,
    ndi: Math.round((lastAtr > 0 ? 100 * (sn / n) / lastAtr : 0) * 100) / 100,
  };
}
const { db, latestIdxDate } = require('../db');
const { loadFactors, adjustRows, fallbackRatioActions } = require('../utils/price-adjust');

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
function loadConfirmedCAs() {
  const rows = db.prepare(`SELECT code, ex_date, ratio FROM corporate_actions WHERE status='confirmed' ORDER BY ex_date DESC`).all();
  const map = {};
  for (const r of rows) {
    if (!map[r.code]) map[r.code] = [];
    map[r.code].push(r);
  }
  return map;
}

// Faktor resmi = ca_factors (217 event / 173 kode, diturunkan dari prev_close IDX,
// sudah diverifikasi terhadap /trading/price-adjustments). Tabel corporate_actions
// hanya 5 baris, ex_date-nya bisa salah (MLPT), dan hanya dipakai sebagai FALLBACK
// kalau kode itu belum ada di ca_factors — kalau dipakai bersamaan, event yang sama
// dihitung dua kali (RAJA 1:5 jadi 0,04 bukan 0,2). Hasil: kolom ac/ah/al/avol di deret.
// `close` mentah sengaja TIDAK diubah: nilai uang (fnet, value) memakai harga hari itu.
function adjustSeries(hist, factors, actions) {
  adjustRows(hist, factors, { volumeFields: { volume: 'avol' } });
  const effActions = fallbackRatioActions(factors, actions);
  if (effActions.length) {
    for (const r of hist) {
      let f = 1;
      for (const ca of effActions) {
        if (r.trade_date < ca.ex_date) f *= (1 / ca.ratio);
      }
      if (f !== 1) {
        r.ac = Math.round(r.ac * f);
        r.ah = Math.round(r.ah * f);
        r.al = Math.round(r.al * f);
        r.avol = Math.round(r.avol / f);
      }
    }
  }
  return hist;
}

// high/low hasil penyesuaian; baris dengan high/low 0 (cacat upstream) jatuh ke ac.
const adjHigh = r => (r.ah > 0 ? r.ah : r.ac);
const adjLow = r => (r.al > 0 ? r.al : r.ac);

router.post('/run', (req, res) => {
  try {
    const rules = req.body.rules || [];
    const groups = req.body.groups || null;
    const ruleLogic = req.body.logic || 'AND';
    const limit = Math.min(parseInt(req.body.limit) || 50, 9999);
    const alwaysTech = req.body.always_tech !== false;
    const td = latestIdxDate();
    if (!td) return res.json({ data: [], trade_date: null });

    let stocks = db.prepare(`SELECT *, (foreign_buy-foreign_sell) as foreign_net, ((foreign_buy-foreign_sell)*close) as foreign_net_val, CASE WHEN prev_close>0 THEN ROUND(CAST((close-prev_close)AS REAL)/prev_close*100,2) ELSE 0 END as change_pct FROM idx_daily WHERE trade_date=? AND close>0`).all(td);

    const { latestFundDate } = require('../db');
    const fm = latestFundDate();
    const fundMap = {};
    if (fm) { db.prepare('SELECT * FROM idx_fundamental WHERE snapshot_month=?').all(fm).forEach(f => { fundMap[f.code] = f; }); }
    stocks = stocks.map(s => ({ ...s, fund: fundMap[s.code] || null }));

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

    const qtrMap = {};
    try {
      db.prepare('SELECT code, eps, dividend_per_share FROM quarterly_financials WHERE period_type=? ORDER BY period DESC').all('quarterly')
        .forEach(r => { if (!qtrMap[r.code]) qtrMap[r.code] = r; });
    } catch(e) {}

    const hasRules = (groups && groups.some(g => g && g.length > 0)) || rules.length > 0;

    if (!hasRules && !alwaysTech) {
      stocks.sort((a, b) => Math.abs(b.foreign_net_val) - Math.abs(a.foreign_net_val));
      return res.json({ data: stocks.slice(0, limit), total: stocks.length, trade_date: td });
    }

    const caMap = loadConfirmedCAs();
    const caFactors = loadFactors(db);
    const results = [];
    let ihsgRet20 = 0;
    try {
      const im = db.prepare("SELECT close FROM market_index_constructed ORDER BY trade_date DESC LIMIT 21").all().map(r => r.close);
      if (im.length >= 21 && im[im.length - 1] > 0) ihsgRet20 = (im[0] / im[im.length - 1] - 1) * 100;
    } catch (e) {}

    for (const stock of stocks) {
      let tech = {};

      const hist = db.prepare('SELECT trade_date,close,high,low,volume,value,frequency,foreign_buy,foreign_sell FROM idx_daily WHERE code=? ORDER BY trade_date').all(stock.code);
      if (hist.length >= 5) {
        const adjusted = adjustSeries(hist, caFactors[stock.code], caMap[stock.code]);
        const closes = adjusted.map(h => h.ac), highs = adjusted.map(adjHigh), lows = adjusted.map(adjLow), vols = adjusted.map(h => (h.avol != null ? h.avol : h.volume));
        tech.ma5 = calcMA(closes, 5); tech.ma10 = calcMA(closes, 10); tech.ma20 = calcMA(closes, 20);
        tech.ma50 = calcMA(closes, 50); tech.ma100 = calcMA(closes, 100); tech.ma200 = calcMA(closes, 200);
        if (closes.length >= 26) tech.macd = calcMACD(closes);
        if (closes.length >= 14) tech.stoch = calcStochastic(highs, lows, closes);
        const avgVol = vols.slice(-20, -1);
        if (avgVol.length) tech.vol_ratio = Math.round(stock.volume / (avgVol.reduce((s, v) => s + v, 0) / avgVol.length) * 10) / 10;
        if ((caMap[stock.code] && caMap[stock.code].length) || (caFactors[stock.code] && caFactors[stock.code].length)) tech.adjusted = true;
      }

      const avg = avgMap[stock.code];
      if (avg) {
        tech.val_spike = avg.avg_val > 0 ? Math.round(stock.value / avg.avg_val * 10) / 10 : 0;
        tech.freq_spike = avg.avg_freq > 0 ? Math.round(stock.frequency / avg.avg_freq * 10) / 10 : 0;
        tech.fnet_spike = avg.avg_fnet_abs > 0 ? Math.round(Math.abs(stock.foreign_net_val) / avg.avg_fnet_abs * 10) / 10 : 0;
        tech.activity_score = Math.round(((tech.val_spike || 0) * 0.3 + (tech.freq_spike || 0) * 0.3 + (tech.vol_ratio || 0) * 0.2 + (tech.fnet_spike || 0) * 0.2) * 10) / 10;
      }

      const qtr = qtrMap[stock.code];
      if (qtr) {
        if (!stock.fund) stock.fund = {};
        if (qtr.eps) stock.fund.eps = qtr.eps;
        if (qtr.dividend_per_share && stock.close) stock.fund.div_yield = Math.round(qtr.dividend_per_share / stock.close * 10000) / 100;
      }

      if (stock.tradeable_shares && stock.listed_shares) {
        if (!stock.fund) stock.fund = {};
        stock.fund.free_float = Math.round(stock.tradeable_shares / stock.listed_shares * 1000) / 10;
      }

      if (groups && groups.some(g => g && g.length > 0)) {
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
let _histCache = { td: null, data: null };

function bulkLoadHistory(td) {
  if (_histCache.td === td && _histCache.data) return _histCache.data;
  const allDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT 210').all().map(r => r.trade_date);
  if (!allDates.length) return {};
  const minDate = allDates[allDates.length - 1];
  const rows = db.prepare('SELECT code,trade_date,close,high,low,volume,value,frequency,foreign_buy,foreign_sell FROM idx_daily WHERE trade_date>=? ORDER BY code,trade_date').all(minDate);
  const map = {};
  for (const r of rows) {
    if (!map[r.code]) map[r.code] = [];
    map[r.code].push(r);
  }
  _histCache = { td, data: map };
  return map;
}

// [PATCH 5] detectNeeds — added fund flag
// Dynamic reverse map: company_profiles (Indonesian) → idx_fundamental (English)
// Built from DB by JOINing company_profiles with idx_fundamental on code
let _nameMapCache = null;
function buildNameMap() {
  if (_nameMapCache) return _nameMapCache;
  const map = {};
  try {
    // Sector mapping: company_profiles.sector (ID) → idx_fundamental.sector (EN)
    const sectorRows = db.prepare(`
      SELECT DISTINCT cp.sector as id_name, f.sector as en_name 
      FROM company_profiles cp 
      JOIN idx_fundamental f ON cp.code = f.code 
      WHERE cp.sector != '' AND f.sector != '' AND f.snapshot_month = (SELECT MAX(snapshot_month) FROM idx_fundamental)
    `).all();
    sectorRows.forEach(r => { if (r.id_name && r.en_name) map[r.id_name.toLowerCase()] = r.en_name; });

    // Industry mapping: company_profiles.sub_sector (ID) → idx_fundamental.industry (EN)
    const indRows = db.prepare(`
      SELECT DISTINCT cp.sub_sector as id_name, f.industry as en_name 
      FROM company_profiles cp 
      JOIN idx_fundamental f ON cp.code = f.code 
      WHERE cp.sub_sector != '' AND f.industry != '' AND f.snapshot_month = (SELECT MAX(snapshot_month) FROM idx_fundamental)
    `).all();
    indRows.forEach(r => { if (r.id_name && r.en_name) map[r.id_name.toLowerCase()] = r.en_name; });
  } catch (e) { /* tables may not exist yet */ }
  
  // Hardcoded fallbacks (in case JOIN misses some)
  const fallbacks = {
    'energi':'Energy','keuangan':'Financials','teknologi':'Technology','kesehatan':'Healthcare',
    'perindustrian':'Industrials','barang baku':'Basic Materials',
    'barang konsumen non-primer':'Consumer Cyclicals','barang konsumen primer':'Consumer Non-Cyclicals',
    'properti & real estat':'Properties & Real Estate','infrastruktur':'Infrastructures',
    'transportasi & logistik':'Transportation & Logistic',
  };
  for (const [k, v] of Object.entries(fallbacks)) { if (!map[k]) map[k] = v; }
  
  _nameMapCache = map;
  return map;
}

function normalizeSector(val) {
  if (!val) return val;
  const map = buildNameMap();
  const lower = val.toLowerCase();
  return map[lower] || val;
}

function detectNeeds(formula) {
  const f = formula.toUpperCase();
  return {
    ma: /MA\d|DISTMA|UP_MA|SHORTTREND|INTERMEDIATE|LONGTREND/i.test(formula),
    macd: /MACD|SIGNAL|BULLISH|BEARISH|DEATHCROSS/i.test(formula),
    stoch: /STOCH|^K\b|^D\b|\bK\s|K\s*[<>=]|D\s*[<>=]/i.test(formula),
    hhv: /HHV|LLV|ISBASE|ISNEARLOW|ISBREAKOUT|PREVHHV/i.test(formula),
    foreign: /FOREIGN|F0|F1|F2|F3|F4|FOREIGN_5D|FOREIGNNET|FOREIGNBUY|FOREIGNSELL/i.test(formula),
    relvol: /RELVOL/i.test(formula),
    freq: /TICKRATIO|ISBLOCK|ISRETAIL|ISSMART|ISDRYUP|BLOCKTRADE|RETAILFRENZY|SMARTACCUM|DRYUP|RELFREQ/i.test(formula),
    fund: /SECTOR|INDUSTRY|BOARD/i.test(formula),
    divown: /DIVYIELD|DIVCOUNT|RICOUNT|FOREIGNPCT|LIVEPER|LIVEPBV|EPS\b|BOOKVAL/i.test(formula),
    ind: /RSI14|ATR14|ATRPCT|ADX14|DIPLUS|DIMINUS|RET5\b|RET20\b|RET60\b|RS_IHSG|POS52|BB_PCTB|BB_WIDTH|GAPPCT|RANGEPCT/i.test(formula),
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

    const needs = detectNeeds(formula);

    let stocks = db.prepare(`SELECT *, (foreign_buy-foreign_sell) as foreign_net, ((foreign_buy-foreign_sell)*close) as foreign_net_val, CASE WHEN prev_close>0 THEN ROUND(CAST((close-prev_close)AS REAL)/prev_close*100,2) ELSE 0 END as change_pct FROM idx_daily WHERE trade_date=? AND close>0`).all(td);

    const { latestFundDate } = require('../db');
    const fm = latestFundDate();
    const fundMap = {};
    if (fm) db.prepare('SELECT * FROM idx_fundamental WHERE snapshot_month=?').all(fm).forEach(f => { fundMap[f.code] = f; });

    const histMap = (needs.ma || needs.macd || needs.stoch || needs.hhv || needs.foreign || needs.relvol || needs.freq || needs.ind) ? bulkLoadHistory(td) : {};
    const caMap = (needs.ma || needs.macd || needs.stoch || needs.ind) ? loadConfirmedCAs() : {};
    const caFactors = (needs.ma || needs.macd || needs.stoch || needs.ind) ? loadFactors(db) : {};

    // ── Bulk-load dividend, ownership, CA data for new variables ──
    let divMap = {}, bpMap = {}, riMap = {};
    if (needs.divown) {
      try {
        // DivYield: latest DPS per code; DivCount: count in last 3 years
        db.prepare('SELECT code, dps, cum_date FROM bei_dividends ORDER BY cum_date DESC').all().forEach(r => {
          if (!divMap[r.code]) divMap[r.code] = { latest_dps: r.dps, count: 0 };
          // Count dividends in last ~3 years
          if (r.cum_date >= new Date(Date.now() - 3*365*86400000).toISOString().slice(0,10)) divMap[r.code].count++;
        });
      } catch (e) {}
      try {
        // ForeignPct: from latest balance_position
        const latestBpDate = db.prepare('SELECT MAX(snapshot_date) as d FROM balance_position').get();
        if (latestBpDate && latestBpDate.d) {
          db.prepare('SELECT code, local_total, foreign_total FROM balance_position WHERE snapshot_date=?').all(latestBpDate.d).forEach(r => {
            const total = (r.local_total||0) + (r.foreign_total||0);
            bpMap[r.code] = total > 0 ? Math.round(r.foreign_total / total * 10000) / 100 : 0;
          });
        }
      } catch (e) {}
      try {
        // RICount: count of rights issues per code
        db.prepare("SELECT code, COUNT(*) as cnt FROM bei_corporate_actions WHERE ca_type IN ('rights','hmetd','right') GROUP BY code").all().forEach(r => {
          riMap[r.code] = r.cnt;
        });
      } catch (e) {}
    }
    
    const results = [];

    let ihsgRet20 = 0;
    try {
      const im = db.prepare("SELECT close FROM market_index_constructed ORDER BY trade_date DESC LIMIT 21").all().map(r => r.close);
      if (im.length >= 21 && im[im.length - 1] > 0) ihsgRet20 = (im[0] / im[im.length - 1] - 1) * 100;
    } catch (e) {}

    for (const stock of stocks) {
      const fund = fundMap[stock.code] || {};
      const hist = histMap[stock.code] || [];
      let tech = {};
      let extraCtx = {};

      if (hist.length >= 5) {
        const adjusted = adjustSeries(hist, caFactors[stock.code], caMap[stock.code]);
        const closes = adjusted.map(h => h.ac);
        const highsA = adjusted.map(adjHigh);
        const lowsA = adjusted.map(adjLow);
        {
          const last = closes[closes.length - 1];
          const rsi = calcRSI(closes, 14);
          const atr = calcATR(highsA, lowsA, closes, 14);
          const adx = calcADX(highsA, lowsA, closes, 14);
          if (rsi != null) { extraCtx.RSI14 = rsi; tech.RSI14 = rsi; }
          if (atr != null) { extraCtx.ATR14 = atr; tech.ATR14 = atr; extraCtx.ATRpct = last > 0 ? Math.round(atr / last * 10000) / 100 : 0; tech.ATRpct = extraCtx.ATRpct; }
          if (adx) { extraCtx.ADX14 = adx.adx; extraCtx.DIplus = adx.pdi; extraCtx.DIminus = adx.ndi; }
          const ret = (k) => closes.length > k && closes[closes.length - 1 - k] > 0
            ? Math.round((last / closes[closes.length - 1 - k] - 1) * 10000) / 100 : 0;
          extraCtx.Ret5 = ret(5); extraCtx.Ret20 = ret(20); extraCtx.Ret60 = ret(60);
          extraCtx.RS_IHSG = Math.round((extraCtx.Ret20 - ihsgRet20) * 100) / 100;
          const w52 = closes.slice(-252);
          if (w52.length >= 60) {
            const hi = Math.max(...w52), lo = Math.min(...w52);
            extraCtx.Pos52 = hi > lo ? Math.round((last - lo) / (hi - lo) * 10000) / 100 : 50;
          }
          if (closes.length >= 20) {
            const w = closes.slice(-20);
            const ma = w.reduce((a, x) => a + x, 0) / 20;
            const sd = Math.sqrt(w.reduce((a, x) => a + (x - ma) * (x - ma), 0) / 20);
            const up = ma + 2 * sd, lo2 = ma - 2 * sd;
            extraCtx.BB_PctB = up > lo2 ? Math.round((last - lo2) / (up - lo2) * 10000) / 100 : 50;
            extraCtx.BB_Width = ma > 0 ? Math.round((up - lo2) / ma * 10000) / 100 : 0;
          }
          const prevC = closes.length >= 2 ? closes[closes.length - 2] : 0;
          if (prevC > 0 && stock.open_price > 0) extraCtx.GapPct = Math.round((stock.open_price / prevC - 1) * 10000) / 100;
          if (stock.high > 0 && stock.low > 0 && stock.close > 0) extraCtx.RangePct = Math.round((stock.high - stock.low) / stock.close * 10000) / 100;
        }
        
        if (needs.ma) {
          const highs = adjusted.map(adjHigh);
          const lows = adjusted.map(adjLow);
          tech.ma3 = calcMA(closes, 3); tech.ma5 = calcMA(closes, 5); tech.ma10 = calcMA(closes, 10);
          tech.ma20 = calcMA(closes, 20); tech.ma30 = calcMA(closes, 30); tech.ma50 = calcMA(closes, 50);
          tech.ma100 = calcMA(closes, 100); tech.ma200 = calcMA(closes, 200);
          
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
          const highs = adjusted.map(adjHigh);
          const lows = adjusted.map(adjLow);
          tech.stoch = calcStochastic(highs, lows, closes);
          extraCtx.StochCrossUp = (tech.stoch && tech.stoch.k > (tech.stoch.d || 50)) ? 1 : 0;
          extraCtx.StochTrend = (tech.stoch && tech.stoch.k > (tech.stoch.d || 50)) ? 1 : 0;
        }
        
        if (needs.relvol) {
          const vols = adjusted.map(h => (h.avol != null ? h.avol : h.volume));
          const volMa20 = vols.length >= 20 ? vols.slice(-20).reduce((s,v)=>s+v,0)/20 : 0;
          extraCtx.RelVol = volMa20 > 0 ? Math.round(stock.volume / volMa20 * 10) / 10 : 0;
          tech.vol_ratio = extraCtx.RelVol;
        }
        
        if (needs.hhv) {
          const c20 = closes.slice(-20);
          const highs20 = adjusted.slice(-20).map(adjHigh);
          const lows20 = adjusted.slice(-20).map(adjLow);
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

        if (needs.freq && hist.length >= 21) {
          const h20 = hist.slice(-21, -1);
          const today = hist[hist.length - 1];
          const avgVol = h20.reduce((s, r) => s + (r.volume || 0), 0) / 20;
          const avgFreq = h20.reduce((s, r) => s + (r.frequency || 0), 0) / 20;
          const avgVal = h20.reduce((s, r) => s + (r.value || 0), 0) / 20;
          const vol = today.volume || 0;
          const freq = today.frequency || 0;
          const val = today.value || 0;
          const relVol = avgVol > 0 ? Math.round(vol / avgVol * 100) / 100 : 1;
          const relFreq = avgFreq > 0 ? Math.round(freq / avgFreq * 100) / 100 : 1;
          const avgTickHist = avgFreq > 0 ? avgVal / avgFreq : 0;
          const tickSize = freq > 0 ? val / freq : 0;
          const tickRatio = avgTickHist > 0 ? Math.round(tickSize / avgTickHist * 100) / 100 : 1;
          const fnet = ((today.foreign_buy || 0) - (today.foreign_sell || 0)) * (today.close || 0);
          const priceChg = closes.length >= 2 && closes[closes.length - 2] > 0 ? (closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2] : 0;

          extraCtx.TickRatio = tickRatio;
          extraCtx.RelFreq = relFreq;
          extraCtx.isBlockTrade = (tickRatio > 2.5 && relVol > 1.5 && relFreq < 1.5) ? 1 : 0;
          extraCtx.isRetailFrenzy = (relFreq > 2.0 && tickRatio < 0.6 && relVol > 1.2) ? 1 : 0;
          extraCtx.isSmartAccum = (relVol > 1.2 && relVol < 3.0 && relFreq >= 0.8 && relFreq <= 1.8 && Math.abs(priceChg) < 0.03 && fnet > 0 && tickRatio > 1.2) ? 1 : 0;
          extraCtx.isDryUp = (relVol < 0.4 && relFreq < 0.5) ? 1 : 0;
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
        BidVol: stock.bid_vol || 0, OfferVol: stock.offer_vol || 0,
        BidRatio: (stock.bid_vol||0) + (stock.offer_vol||0) > 0 ? Math.round((stock.bid_vol||0) / ((stock.bid_vol||0) + (stock.offer_vol||0)) * 100 * 10) / 10 : 50,
        PER: fund.per||0, PBV: fund.pbv||0, ROE: fund.roe||0, ROA: fund.roa||0,
        DER: fund.der||0, NPM: fund.npm||0, MktCap: fund.mkt_cap||0, YTD: fund.ytd||0,
        // [PATCH 4] String variables for sector/industry filtering
        Sector: fund.sector || '', Industry: fund.industry || '', Board: fund.board || '',
        // [Sprint 16] New variables from BEI upload data
        EPS: fund.eps_trailing || 0,
        BookVal: fund.book_value || 0,
        LivePER: (fund.eps_trailing && fund.eps_trailing > 0) ? Math.round(stock.close / fund.eps_trailing * 100) / 100 : 0,
        LivePBV: (fund.book_value && fund.book_value > 0) ? Math.round(stock.close / fund.book_value * 100) / 100 : 0,
        DivYield: (divMap[stock.code] && divMap[stock.code].latest_dps && stock.close > 0) ? Math.round(divMap[stock.code].latest_dps / stock.close * 10000) / 100 : 0,
        DivCount: divMap[stock.code] ? divMap[stock.code].count : 0,
        RICount: riMap[stock.code] || 0,
        ForeignPct: bpMap[stock.code] || 0,
        RSI14: extraCtx.RSI14 ?? 0, ATR14: extraCtx.ATR14 ?? 0, ATRpct: extraCtx.ATRpct ?? 0,
        ADX14: extraCtx.ADX14 ?? 0, DIplus: extraCtx.DIplus ?? 0, DIminus: extraCtx.DIminus ?? 0,
        Ret5: extraCtx.Ret5 ?? 0, Ret20: extraCtx.Ret20 ?? 0, Ret60: extraCtx.Ret60 ?? 0,
        RS_IHSG: extraCtx.RS_IHSG ?? 0, Pos52: extraCtx.Pos52 ?? 0,
        BB_PctB: extraCtx.BB_PctB ?? 0, BB_Width: extraCtx.BB_Width ?? 0,
        GapPct: extraCtx.GapPct ?? 0, RangePct: extraCtx.RangePct ?? 0,
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
    if (s[i] === ' ') { i++; continue; }

    if (s[i] === '(') { tokens.push({ type: 'LPAREN' }); i++; continue; }
    if (s[i] === ')') { tokens.push({ type: 'RPAREN' }); i++; continue; }

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

    // [PATCH 1] Quoted strings: "text" or 'text'
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i]; i++;
      let str = '';
      while (i < s.length && s[i] !== quote) { str += s[i]; i++; }
      if (i >= s.length) return { error: 'Unterminated string at position ' + (i - str.length - 1) };
      i++; // skip closing quote
      tokens.push({ type: 'STRING', value: str }); continue;
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

  // [PATCH 3] String-aware comparison in parseFactor
  function parseFactor() {
    let left = parseAtom();
    if (peek() && peek().type === 'OP') {
      const op = consume().value;
      const right = parseAtom();
      // String comparison: if either side is a string, compare as strings (case-insensitive)
      // Also normalize sector names (Indonesian → English via SECTOR_REVERSE)
      if (typeof left === 'string' || typeof right === 'string') {
        const ls = normalizeSector(String(left)).toLowerCase();
        const rs = normalizeSector(String(right)).toLowerCase();
        if (op === '==') return ls === rs ? 1 : 0;
        if (op === '!=') return ls !== rs ? 1 : 0;
        if (op === '>') return ls > rs ? 1 : 0;
        if (op === '<') return ls < rs ? 1 : 0;
        if (op === '>=') return ls >= rs ? 1 : 0;
        if (op === '<=') return ls <= rs ? 1 : 0;
      }
      const l = toNum(left), r = toNum(right);
      if (op === '>') return l > r ? 1 : 0;
      if (op === '<') return l < r ? 1 : 0;
      if (op === '>=') return l >= r ? 1 : 0;
      if (op === '<=') return l <= r ? 1 : 0;
      if (op === '==') return l === r ? 1 : 0;
      if (op === '!=') return l !== r ? 1 : 0;
    }
    return left;
  }

  function parseAtom() {
    const t = peek();
    if (!t) throw new Error('Unexpected end of formula');

    if (t.type === 'NUM') { consume(); return t.value; }

    // [PATCH 2] Handle STRING token
    if (t.type === 'STRING') { consume(); return t.value; }

    if (t.type === 'VAR') {
      consume();
      if (ctx.hasOwnProperty(t.value)) return ctx[t.value];
      const lower = t.value.toLowerCase();
      for (const k of Object.keys(ctx)) { if (k.toLowerCase() === lower) return ctx[k]; }
      throw new Error('Unknown variable: ' + t.value);
    }

    if (t.type === 'LPAREN') {
      consume();
      const result = parseExpr();
      expect('RPAREN');
      return result;
    }

    throw new Error('Unexpected: ' + t.type + (t.value ? ':' + t.value : ''));
  }

  function toNum(v) {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') return v.length > 0 ? 1 : 0; // non-empty string = truthy
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
  if (f.startsWith('close_vs_ma')) { const p = parseInt(f.replace('close_vs_ma', '')); const ma = tech['ma' + p]; if (!ma) return false; return op === 'above' ? stock.close > ma : stock.close < ma; }
  if (f === 'macd_hist') return tech.macd ? applyOp(tech.macd.histogram, op, val) : false;
  if (f === 'macd_cross') return tech.macd ? tech.macd.cross === val : false;
  if (f === 'macd_signal') { if (!tech.macd) return false; return op === 'above' ? tech.macd.macd > tech.macd.signal : tech.macd.macd < tech.macd.signal; }
  if (f === 'stoch_k') return tech.stoch ? applyOp(tech.stoch.k, op, val) : false;
  if (f === 'stoch_d') return tech.stoch && tech.stoch.d ? applyOp(tech.stoch.d, op, val) : false;
  if (f === 'stoch_zone') return tech.stoch ? tech.stoch.zone === val : false;
  if (f === 'fnet_streak') { const days = Math.abs(parseInt(val) || 3); const dir = (parseFloat(val) || 0) >= 0 ? 'buy' : 'sell'; const recent = db.prepare('SELECT (foreign_buy-foreign_sell) as fn FROM idx_daily WHERE code=? ORDER BY trade_date DESC LIMIT ?').all(stock.code, days); if (recent.length < days) return false; return dir === 'buy' ? recent.every(r => r.fn > 0) : recent.every(r => r.fn < 0); }
  return true;
}

// ═══ Sector Overview ═══
router.get('/sectors', (req, res) => {
  try {
    const { latestFundDate } = require('../db');
    const td = latestIdxDate();
    const sm = latestFundDate();
    if (!sm || !td) return res.json({ sectors: [], industries: [] });

    const rows = db.prepare(`
      SELECT f.code, f.sector, f.industry, f.per, f.pbv, f.roe, f.roa, f.der, f.npm, f.mkt_cap, f.ytd,
             d.close, d.value, d.volume, d.frequency, d.foreign_buy, d.foreign_sell,
             ((d.foreign_buy - d.foreign_sell) * d.close) as fnet_val,
             CASE WHEN d.prev_close > 0 THEN ROUND(CAST((d.close - d.prev_close) AS REAL) / d.prev_close * 100, 2) ELSE 0 END as chg_pct
      FROM idx_fundamental f
      LEFT JOIN idx_daily d ON f.code = d.code AND d.trade_date = ?
      WHERE f.snapshot_month = ? AND f.sector != ''
    `).all(td, sm);

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
      sector: s.sector, count: s.stocks.length, total_mcap: s.total_mcap, total_fnet: s.total_fnet,
      avg_per: s.per_cnt ? Math.round(s.per_sum / s.per_cnt * 10) / 10 : 0,
      avg_roe: s.roe_cnt ? Math.round(s.roe_sum / s.roe_cnt * 10) / 10 : 0,
      avg_ytd: s.ytd_cnt ? Math.round(s.ytd_sum / s.ytd_cnt * 10) / 10 : 0,
    })).sort((a, b) => b.total_mcap - a.total_mcap);

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
      industry: s.industry, sector: s.sector, count: s.stocks.length, total_mcap: s.total_mcap, total_fnet: s.total_fnet,
      avg_per: s.per_cnt ? Math.round(s.per_sum / s.per_cnt * 10) / 10 : 0,
      avg_roe: s.roe_cnt ? Math.round(s.roe_sum / s.roe_cnt * 10) / 10 : 0,
      avg_ytd: s.ytd_cnt ? Math.round(s.ytd_sum / s.ytd_cnt * 10) / 10 : 0,
    })).sort((a, b) => b.total_mcap - a.total_mcap);

    const indFilter = (req.query.industry || '').trim();
    let stockList = [];
    if (indFilter) {
      stockList = rows.filter(r => r.industry === indFilter).sort((a, b) => (b.mkt_cap || 0) - (a.mkt_cap || 0)).map(r => ({ code: r.code, sector: r.sector, industry: r.industry, close: r.close, chg_pct: r.chg_pct, mkt_cap: r.mkt_cap, per: r.per, roe: r.roe, ytd: r.ytd, fnet_val: r.fnet_val, volume: r.volume }));
    } else if (sectorFilter) {
      stockList = rows.filter(r => r.sector === sectorFilter).sort((a, b) => (b.mkt_cap || 0) - (a.mkt_cap || 0)).slice(0, 30).map(r => ({ code: r.code, sector: r.sector, industry: r.industry, close: r.close, chg_pct: r.chg_pct, mkt_cap: r.mkt_cap, per: r.per, roe: r.roe, ytd: r.ytd, fnet_val: r.fnet_val, volume: r.volume }));
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
    const minFreq = parseInt(req.query.min_freq) || 10;

    const dates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT ?').all(avgDays + 1).map(r => r.trade_date);
    if (dates.length < 5) return res.json({ data: [], error: 'Need more data' });

    const today = dates[0];
    const avgDates = dates.slice(1);
    const ph = avgDates.map(() => '?').join(',');

    const todayData = {};
    db.prepare('SELECT code,name,close,volume,value,frequency,foreign_buy,foreign_sell FROM idx_daily WHERE trade_date=? AND close>0').all(today)
      .forEach(r => { todayData[r.code] = r; });

    const avgData = {};
    db.prepare(`SELECT code, AVG(volume) as avg_vol, AVG(value) as avg_val, AVG(frequency) as avg_freq,
      AVG(ABS((foreign_buy-foreign_sell)*close)) as avg_fnet_abs
      FROM idx_daily WHERE trade_date IN (${ph}) AND close>0
      GROUP BY code HAVING AVG(frequency)>=?`).all(...avgDates, minFreq)
      .forEach(r => { avgData[r.code] = r; });

    const results = [];
    for (const [code, t] of Object.entries(todayData)) {
      const a = avgData[code];
      if (!a) continue;

      const valSpike = a.avg_val > 0 ? Math.round(t.value / a.avg_val * 10) / 10 : 0;
      const freqSpike = a.avg_freq > 0 ? Math.round(t.frequency / a.avg_freq * 10) / 10 : 0;
      const volSpike = a.avg_vol > 0 ? Math.round(t.volume / a.avg_vol * 10) / 10 : 0;
      const fnet = (t.foreign_buy - t.foreign_sell) * t.close;
      const fnetSpike = a.avg_fnet_abs > 0 ? Math.round(Math.abs(fnet) / a.avg_fnet_abs * 10) / 10 : 0;
      const score = Math.round((valSpike * 0.3 + freqSpike * 0.3 + volSpike * 0.2 + fnetSpike * 0.2) * 10) / 10;

      results.push({
        code, name: t.name, close: t.close,
        volume: t.volume, value: t.value, frequency: t.frequency,
        fnet, fnet_val: fnet,
        avg_vol: Math.round(a.avg_vol), avg_val: Math.round(a.avg_val), avg_freq: Math.round(a.avg_freq),
        val_spike: valSpike, freq_spike: freqSpike, vol_spike: volSpike, fnet_spike: fnetSpike, score
      });
    }

    results.sort((a, b) => b.score - a.score);

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

    const dormant = results.filter(r => r.avg_freq < 30 && r.freq_spike >= 3).sort((a, b) => b.freq_spike - a.freq_spike);

    res.json({
      data: results, dormant: dormant.slice(0, 30),
      sector_spikes: Object.values(sectorSpikes).sort((a, b) => b.avg_score - a.avg_score),
      trade_date: today, avg_days: avgDays, total: results.length
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/activity-history/:code', (req, res) => {
  try {
    const code = req.params.code.toUpperCase().trim();
    const days = parseInt(req.query.days) || 60;
    const rows = db.prepare('SELECT trade_date,close,volume,value,frequency,foreign_buy,foreign_sell FROM idx_daily WHERE code=? ORDER BY trade_date DESC LIMIT ?').all(code, days);
    rows.reverse();
    res.json({ code, data: rows.map(r => ({ ...r, fnet_val: (r.foreign_buy - r.foreign_sell) * r.close })) });
  } catch (e) { res.json({ code: req.params.code, data: [] }); }
});

// ═══ Sector Intelligence ═══
router.get('/sector-intelligence', (req, res) => {
  try {
    const { latestFundDate } = require('../db');
    const td = latestIdxDate();
    const sm = latestFundDate();
    if (!sm || !td) return res.json({ error: 'No data' });
    const weeks = parseInt(req.query.weeks) || 12;
    const level = req.query.level || 'sector';

    const allDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
    if (allDates.length < 5) return res.json({ error: 'Need more data' });

    const weekBuckets = [];
    let currentWeek = [];
    for (const d of allDates) {
      const dow = new Date(d + 'T00:00:00').getDay();
      if (dow === 1 && currentWeek.length > 0) { weekBuckets.push(currentWeek); currentWeek = []; }
      currentWeek.push(d);
    }
    if (currentWeek.length) weekBuckets.push(currentWeek);

    const recentWeeks = weekBuckets.slice(-weeks);

    // `company_profiles` DIPAKAI SEBAGAI SUMBER UTAMA, bukan `idx_fundamental`.
    // Sebab: di snapshot 2026-10 ada 2 baris warisan taksonomi lama yang lolos ke tabel
    // fundamental — INCF dengan sector "BASIC INDUSTRY AND CHEMICALS" dan VICI dengan
    // "CONSUMER GOODS INDUSTRY". Keduanya tidak cocok dengan 11 nama baru, jadi tampil
    // sebagai sektor sendiri berisi 1 saham dan satu baris penuh nol di heatmap.
    // company_profiles sudah memetakan keduanya dengan benar (Barang Baku, Barang
    // Konsumen Primer). idx_fundamental tetap dipakai sebagai cadangan untuk emiten yang
    // belum ada di company_profiles.
    const fundMap = {};
    db.prepare("SELECT code, sector, industry FROM idx_fundamental WHERE snapshot_month=? AND sector!=''").all(sm)
      .forEach(f => { fundMap[f.code] = { sector: f.sector, industry: f.industry }; });
    try {
      db.prepare("SELECT code, sector FROM company_profiles WHERE sector IS NOT NULL AND sector!=''").all()
        .forEach(c => {
          const prev = fundMap[c.code];
          fundMap[c.code] = { sector: c.sector, industry: prev ? prev.industry : '' };
        });
    } catch (e) { /* tabel tidak ada: pakai idx_fundamental saja */ }

    // Normalisasi nama sektor warisan (taksonomi IDX lama, bahasa Inggris) ke 11 nama
    // yang dipakai company_profiles. Tanpa ini, emiten yang TIDAK ada di company_profiles
    // (mis. GOTOM) tetap membawa label lama dan muncul sebagai sektor tambahan berisi
    // satu saham. Tabel ini bukan pemetaan selera: setiap nilai kanan adalah nama yang
    // benar-benar ada di company_profiles.
    const SECTOR_ALIAS = {
      'Technology': 'Teknologi',
      'Financials': 'Keuangan',
      'Energy': 'Energi',
      'Healthcare': 'Kesehatan',
      'Industrials': 'Perindustrian',
      'Infrastructures': 'Infrastruktur',
      'Basic Materials': 'Barang Baku',
      'Basic Industry and Chemicals': 'Barang Baku',
      'BASIC INDUSTRY AND CHEMICALS': 'Barang Baku',
      'Consumer Cyclicals': 'Barang Konsumen Non-Primer',
      'Consumer Non-Cyclicals': 'Barang Konsumen Primer',
      'CONSUMER GOODS INDUSTRY': 'Barang Konsumen Primer',
      'Properties & Real Estate': 'Properti & Real Estat',
      'Transportation & Logistic': 'Transportasi & Logistik',
    };
    for (const code of Object.keys(fundMap)) {
      const sec = fundMap[code].sector;
      if (sec && SECTOR_ALIAS[sec]) fundMap[code].sector = SECTOR_ALIAS[sec];
    }

    const weeklyData = [];
    for (const wDates of recentWeeks) {
      if (!wDates.length) continue;
      const ph = wDates.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT code, SUM((foreign_buy - foreign_sell) * close) as fnet_val, SUM(value) as total_value, SUM(volume) as total_volume, MIN(close) as week_low, MAX(close) as week_high
        FROM idx_daily WHERE trade_date IN (${ph}) AND close > 0 GROUP BY code
      `).all(...wDates);

      const firstDate = wDates[0], lastDate = wDates[wDates.length - 1];
      const firstCloses = {}, lastCloses = {};
      db.prepare('SELECT code, close FROM idx_daily WHERE trade_date=? AND close>0').all(firstDate).forEach(r => { firstCloses[r.code] = r.close; });
      db.prepare('SELECT code, close FROM idx_daily WHERE trade_date=? AND close>0').all(lastDate).forEach(r => { lastCloses[r.code] = r.close; });

      const groups = {};
      for (const r of rows) {
        const f = fundMap[r.code];
        if (!f) continue;
        const key = level === 'industry' ? f.industry : f.sector;
        if (!key) continue;
        if (!groups[key]) groups[key] = { name: key, sector: f.sector, fnet: 0, value: 0, volume: 0, stocks: 0, chg_sum: 0, chg_count: 0 };
        const g = groups[key];
        g.fnet += r.fnet_val || 0; g.value += r.total_value || 0; g.volume += r.total_volume || 0; g.stocks++;
        const fc = firstCloses[r.code], lc = lastCloses[r.code];
        if (fc && lc && fc > 0) { g.chg_sum += (lc - fc) / fc * 100; g.chg_count++; }
      }

      weeklyData.push({
        week_start: firstDate, week_end: lastDate, days: wDates.length,
        groups: Object.values(groups).map(g => ({ name: g.name, sector: g.sector, fnet: g.fnet, value: g.value, volume: g.volume, stocks: g.stocks, avg_chg: g.chg_count ? Math.round(g.chg_sum / g.chg_count * 100) / 100 : 0 }))
      });
    }

    const groupNames = [...new Set(weeklyData.flatMap(w => w.groups.map(g => g.name)))].sort();
    res.json({ level, weeks: weeklyData, group_names: groupNames, trade_date: td, snapshot_month: sm });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ Correlation ═══
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
        .forEach(r => { if (!invMap[r.investor_norm]) invMap[r.investor_norm] = new Set(); invMap[r.investor_norm].add(r.code); });
      const pairSet = new Set();
      for (const [inv, codes] of Object.entries(invMap)) {
        if (codes.size < 2 || codes.size > 50) continue;
        const arr = [...codes];
        for (let i = 0; i < arr.length && i < 20; i++) { for (let j = i + 1; j < arr.length && j < 20; j++) { pairSet.add([arr[i], arr[j]].sort().join('|')); } }
      }
      tickerPairs = [...pairSet].map(k => { const [a, b] = k.split('|'); return { a, b }; });
      tickers = [...new Set(tickerPairs.flatMap(p => [p.a, p.b]))];
    } else if (mode === 'industry') {
      const indMap = {};
      for (const [code, f] of Object.entries(fundInfo)) { if (!f.industry) continue; if (!indMap[f.industry]) indMap[f.industry] = []; indMap[f.industry].push(code); }
      for (const [ind, codes] of Object.entries(indMap)) { if (codes.length < 2) continue; const limited = codes.slice(0, 30); for (let i = 0; i < limited.length; i++) { for (let j = i + 1; j < limited.length; j++) { tickerPairs.push({ a: limited[i], b: limited[j] }); } } }
      tickers = [...new Set(tickerPairs.flatMap(p => [p.a, p.b]))];
    } else {
      if (industry) { tickers = Object.keys(fundInfo).filter(c => fundInfo[c].industry === industry); }
      else if (sector) { tickers = Object.keys(fundInfo).filter(c => fundInfo[c].sector === sector); }
      else { const td = latestIdxDate(); tickers = db.prepare('SELECT code FROM idx_daily WHERE trade_date=? AND close>0 ORDER BY value DESC LIMIT 150').all(td).map(r => r.code); }
    }

    if (tickers.length < 2) return res.json({ pairs: [], tickers: tickers.length, mode });

    const dates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT ?').all(days).map(r => r.trade_date).reverse();
    if (dates.length < 10) return res.json({ pairs: [], error: 'Need more data' });

    const returns = {};
    for (const code of tickers) {
      const rows = db.prepare('SELECT trade_date, close FROM idx_daily WHERE code=? AND trade_date>=? ORDER BY trade_date').all(code, dates[0]);
      if (rows.length < dates.length * 0.7) continue;
      const dailyRet = [];
      for (let i = 1; i < rows.length; i++) { if (rows[i - 1].close > 0) dailyRet.push((rows[i].close - rows[i - 1].close) / rows[i - 1].close); }
      if (dailyRet.length >= 10) returns[code] = dailyRet;
    }

    const pairs = [];
    const calcCorr = (codeA, codeB) => {
      const a = returns[codeA], b = returns[codeB];
      if (!a || !b) return null;
      const n = Math.min(a.length, b.length);
      if (n < 10) return null;
      const ax = a.slice(-n), bx = b.slice(-n);
      const ma = ax.reduce((s, v) => s + v, 0) / n, mb = bx.reduce((s, v) => s + v, 0) / n;
      let num = 0, da = 0, db2 = 0;
      for (let k = 0; k < n; k++) { num += (ax[k] - ma) * (bx[k] - mb); da += (ax[k] - ma) ** 2; db2 += (bx[k] - mb) ** 2; }
      return (da > 0 && db2 > 0) ? num / Math.sqrt(da * db2) : 0;
    };

    if (tickerPairs.length > 0) {
      for (const { a, b } of tickerPairs) { const corr = calcCorr(a, b); if (corr !== null && Math.abs(corr) >= minCorr) { pairs.push({ a, b, corr: Math.round(corr * 1000) / 1000 }); } }
    } else {
      const codes = Object.keys(returns);
      for (let i = 0; i < codes.length; i++) { for (let j = i + 1; j < codes.length; j++) { const corr = calcCorr(codes[i], codes[j]); if (corr !== null && Math.abs(corr) >= minCorr) { pairs.push({ a: codes[i], b: codes[j], corr: Math.round(corr * 1000) / 1000 }); } } }
    }

    pairs.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));

    const holdingsCache = {};
    function getHolders(code) {
      if (!holdingsCache[code] && sd) { holdingsCache[code] = db.prepare('SELECT investor_norm, investor, pct FROM holdings WHERE snapshot_date=? AND code=? AND pct>=1 ORDER BY pct DESC').all(sd, code); }
      return holdingsCache[code] || [];
    }

    const enriched = pairs.slice(0, 50).map(p => {
      const holdersA = getHolders(p.a), holdersB = getHolders(p.b);
      const aSet = new Set(holdersA.map(h => h.investor_norm));
      const common = holdersB.filter(h => aSet.has(h.investor_norm)).map(h => h.investor.substring(0, 30));
      return { ...p, a_sector: fundInfo[p.a]?.sector || '', a_industry: fundInfo[p.a]?.industry || '', b_sector: fundInfo[p.b]?.sector || '', b_industry: fundInfo[p.b]?.industry || '', common_owners: common.slice(0, 5) };
    });

    res.json({ pairs: enriched, tickers: Object.keys(returns).length, days: dates.length, min_corr: minCorr, mode, sector, industry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ Fundamental lists ═══
router.get('/fundamental-lists', (req, res) => {
  try {
    const { latestFundDate } = require('../db');
    const sm = latestFundDate();
    if (!sm) return res.json({ sectors: [], industries: [], sector_industry_map: {} });
    const rows = db.prepare("SELECT DISTINCT sector, industry FROM idx_fundamental WHERE snapshot_month=? AND sector!='' AND industry!=''").all(sm);
    const sectors = [...new Set(rows.map(r => r.sector))].sort();
    const industries = [...new Set(rows.map(r => r.industry))].sort();
    const sim = {};
    rows.forEach(r => { if (!sim[r.sector]) sim[r.sector] = []; if (!sim[r.sector].includes(r.industry)) sim[r.sector].push(r.industry); });
    for (const k of Object.keys(sim)) sim[k].sort();
    res.json({ sectors, industries, sector_industry_map: sim });
  } catch (e) { res.json({ sectors: [], industries: [] }); }
});

module.exports = router;