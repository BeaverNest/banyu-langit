const express = require('express');
const { yq } = require('../utils/yahoo');
const { gNews } = require('../utils/news');
const { db, latestIdxDate } = require('../db');

const router = express.Router();

// ═══ IDX INDEX CODE → Display label mapping ═══
const IDX_INDEX_LABELS = {
  'COMPOSITE': { label: 'IHSG', desc: 'IDX Composite' },
  'LQ45': { label: 'LQ45', desc: 'Liquid 45' },
  'IDX30': { label: 'IDX30', desc: 'Top 30' },
  'IDX80': { label: 'IDX80', desc: 'Top 80' },
  'IDXV30': { label: 'IDXV30', desc: 'Value 30' },
  'IDXG30': { label: 'IDXG30', desc: 'Growth 30' },
  'IDXQ30': { label: 'IDXQ30', desc: 'Quality 30' },
  'IDXHIDIV20': { label: 'HIDIV20', desc: 'High Dividend 20' },
  'IDXBUMN20': { label: 'BUMN20', desc: 'BUMN 20' },
  'IDXESGL': { label: 'ESGL', desc: 'ESG Leaders' },
  'JII70': { label: 'JII70', desc: 'Jakarta Islamic 70' },
  'ISSI': { label: 'ISSI', desc: 'Sharia Stock' },
  'KOMPAS100': { label: 'KOMPAS100', desc: 'Kompas 100' },
  'BISNIS-27': { label: 'BISNIS27', desc: 'Bisnis 27' },
  'SRI-KEHATI': { label: 'KEHATI', desc: 'SRI-KEHATI' },
  'MBX': { label: 'MBX', desc: 'Main Board' },
  'DBX': { label: 'DBX', desc: 'Development Board' },
  'ABX': { label: 'ABX', desc: 'Acceleration Board' },
  'IDXENERGY': { label: 'ENERGY', desc: 'Energy Sector' },
  'IDXBASIC': { label: 'BASIC', desc: 'Basic Materials' },
  'IDXINDUST': { label: 'INDUST', desc: 'Industrials' },
  'IDXNONCYC': { label: 'NONCYC', desc: 'Non-Cyclicals' },
  'IDXCYCLIC': { label: 'CYCLIC', desc: 'Cyclicals' },
  'IDXHEALTH': { label: 'HEALTH', desc: 'Healthcare' },
  'IDXFINANCE': { label: 'FINANCE', desc: 'Financials' },
  'IDXPROPERT': { label: 'PROPERTY', desc: 'Properties' },
  'IDXTECHNO': { label: 'TECHNO', desc: 'Technology' },
  'IDXINFRA': { label: 'INFRA', desc: 'Infrastructure' },
  'IDXTRANS': { label: 'TRANS', desc: 'Transportation' },
};

// Global market items (still Yahoo)
const GLOBAL_MKT = {
  commodities: [
    { symbol: 'GC=F', label: 'GOLD', desc: 'Gold Futures' },
    { symbol: 'SI=F', label: 'SILVER', desc: 'Silver Futures' },
    { symbol: 'CL=F', label: 'OIL (WTI)', desc: 'Crude Oil' },
    { symbol: 'BZ=F', label: 'OIL (BRENT)', desc: 'Brent Crude' },
    { symbol: 'NG=F', label: 'NAT GAS', desc: 'Natural Gas' },
    { symbol: 'HG=F', label: 'COPPER', desc: 'Copper Futures' },
    { symbol: 'PL=F', label: 'PLATINUM', desc: 'Platinum' },
    { symbol: 'ZC=F', label: 'CORN', desc: 'Corn Futures' }
  ],
  currencies: [
    { symbol: 'USDIDR=X', label: 'USD/IDR', desc: 'US Dollar / Rupiah' },
    { symbol: 'EURUSD=X', label: 'EUR/USD', desc: 'Euro / Dollar' },
    { symbol: 'GBPUSD=X', label: 'GBP/USD', desc: 'Pound / Dollar' },
    { symbol: 'USDJPY=X', label: 'USD/JPY', desc: 'Dollar / Yen' },
    { symbol: 'USDCNY=X', label: 'USD/CNY', desc: 'Dollar / Yuan' },
    { symbol: 'USDSGD=X', label: 'USD/SGD', desc: 'Dollar / Singapore' },
    { symbol: 'BTC-USD', label: 'BTC/USD', desc: 'Bitcoin' },
    { symbol: 'ETH-USD', label: 'ETH/USD', desc: 'Ethereum' }
  ],
  global_indices: [
    { symbol: '^GSPC', label: 'S&P 500', desc: 'S&P 500' },
    { symbol: '^DJI', label: 'DOW 30', desc: 'Dow Jones' },
    { symbol: '^HSI', label: 'HANG SENG', desc: 'Hong Kong' },
    { symbol: '^N225', label: 'NIKKEI', desc: 'Nikkei Japan' },
    { symbol: '000001.SS', label: 'SHANGHAI', desc: 'Shanghai Composite' },
    { symbol: '^FCHI', label: 'CAC 40', desc: 'France' },
    { symbol: '^GDAXI', label: 'DAX', desc: 'Germany' }
  ]
};

// ═══ COMMODITY → IDX STOCK MAPPING ═══
const COMMODITY_MAP = [
  { id: 'coal', label: 'COAL', tv: 'ICEEUR:NCF1!', desc: 'Newcastle Coal', icon: '⛏', color: '#64748b', tickers: ['ADRO','ITMG','PTBA','BUMI','BYAN','DSSA','GEMS','HRUM','MBAP','TOBA','ADMR','BSSR','GTBO','SMMT','AADI'] },
  { id: 'cpo', label: 'CPO', tv: 'MYX:FCPO1!', desc: 'Crude Palm Oil', icon: '🌴', color: '#22c55e', tickers: ['AALI','LSIP','DSNG','SIMP','TBLA','SGRO','SSMS','TAPG','CSRA','SMAR','ANJT','JARR'] },
  { id: 'nickel', label: 'NICKEL', tv: 'SHFE:NI1!', desc: 'Nickel Futures', icon: '🔩', color: '#0ea5e9', tickers: ['ANTM','INCO','NCKL','MBMA','MDKA','IFSH','PURE','HPAL'] },
  { id: 'tin', label: 'TIN', tv: 'SHFE:SN1!', desc: 'Tin Futures', icon: '🥫', color: '#8b5cf6', tickers: ['TINS','NIKL'] },
  { id: 'gold', label: 'GOLD', tv: 'COMEX:GC1!', desc: 'Gold Futures', icon: '🥇', color: '#f59e0b', tickers: ['ANTM','MDKA','ARCI','BRMS','EMAS','PSAB'] },
  { id: 'oil', label: 'OIL', tv: 'NYMEX:BZ1!', desc: 'Brent Crude Oil', icon: '🛢', color: '#ef4444', tickers: ['MEDC','ELSA','ENRG','RATU','ESSA','PTRO','BIPI','DEWA'] },
  { id: 'gas', label: 'GAS', tv: 'NYMEX:NG1!', desc: 'Natural Gas', icon: '🔥', color: '#f97316', tickers: ['PGAS','RAJA','TPMA'] },
  { id: 'copper', label: 'COPPER', tv: 'COMEX:HG1!', desc: 'Copper Futures', icon: '🔶', color: '#dc6b20', tickers: ['BRMS','CITA'] },
  { id: 'rubber', label: 'RUBBER', tv: 'TOCOM:JRU1!', desc: 'Rubber TSR20', icon: '🌳', color: '#14b8a6', tickers: ['GJTL'] },
  { id: 'steel', label: 'STEEL', tv: 'SHFE:RB1!', desc: 'Steel Rebar', icon: '🏗', color: '#6366f1', tickers: ['ISSP','KRAS','GDST','BTON','INAI'] }
];

// ═══ IDX INDICES — from database (no Yahoo) ═══
router.get('/idx-indices', (req, res) => {
  try {
    const group = req.query.group || 'main'; // main, sector, all
    const rows = db.prepare('SELECT * FROM index_list ORDER BY code').all();
    if (!rows.length) return res.json([]);

    let filtered = rows;
    if (group === 'main') {
      const mainCodes = ['COMPOSITE','LQ45','IDX30','IDX80','IDXV30','IDXG30','IDXQ30','IDXHIDIV20','IDXBUMN20','ISSI','JII70','KOMPAS100','BISNIS-27','SRI-KEHATI','MBX','DBX'];
      filtered = rows.filter(r => mainCodes.includes(r.code));
    } else if (group === 'sector') {
      filtered = rows.filter(r => r.code.startsWith('IDX') && ['IDXENERGY','IDXBASIC','IDXINDUST','IDXNONCYC','IDXCYCLIC','IDXHEALTH','IDXFINANCE','IDXPROPERT','IDXTECHNO','IDXINFRA','IDXTRANS'].includes(r.code));
    }

    const result = filtered.map(r => {
      const meta = IDX_INDEX_LABELS[r.code] || { label: r.code, desc: r.code };
      // Parse Indonesian format: "7.389,399" → 7389.399 (dot=thousands, comma=decimal)
      function parseIDNum(s) {
        if (!s) return 0;
        s = String(s).trim();
        // If has both dot and comma: Indonesian format
        if (s.includes('.') && s.includes(',')) {
          return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
        }
        // If only comma: treat as decimal
        if (s.includes(',') && !s.includes('.')) {
          return parseFloat(s.replace(',', '.')) || 0;
        }
        // Otherwise standard
        return parseFloat(s.replace(/,/g, '')) || 0;
      }
      const closeNum = parseIDNum(r.close);
      const changeNum = parseIDNum(r.change);
      const pctStr = String(r.percent || '0').replace('%', '').trim();
      const pctNum = parseIDNum(pctStr);
      return {
        code: r.code,
        label: meta.label,
        desc: meta.desc,
        price: closeNum,
        change: pctNum,
        change_val: changeNum,
        source: 'idx'
      };
    });

    res.json(result);
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ═══ MARKET OVERVIEW — IDX indices from DB + global from Yahoo ═══
router.get('/market', async (req, res) => {
  const cat = req.query.cat || 'indices';

  if (cat === 'indices') {
    // IDX indices from database + global from Yahoo
    try {
      const idxRows = db.prepare('SELECT * FROM index_list ORDER BY code').all();
      const mainCodes = ['COMPOSITE','LQ45','IDX30','IDX80','IDXHIDIV20','IDXBUMN20','KOMPAS100','ISSI'];
      const idxResult = mainCodes.map(code => {
        const r = idxRows.find(x => x.code === code);
        if (!r) return null;
        const meta = IDX_INDEX_LABELS[code] || { label: code, desc: code };
        function parseIDNum(s) {
          if (!s) return 0; s = String(s).trim();
          if (s.includes('.') && s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
          if (s.includes(',') && !s.includes('.')) return parseFloat(s.replace(',', '.')) || 0;
          return parseFloat(s.replace(/,/g, '')) || 0;
        }
        const closeNum = parseIDNum(r.close);
        const pctNum = parseIDNum(String(r.percent || '0').replace('%', ''));
        return { label: meta.label, desc: meta.desc, price: closeNum, change: pctNum, source: 'idx' };
      }).filter(Boolean);

      // Global indices from Yahoo (best effort, don't block)
      const globalResult = [];
      try {
        await Promise.all(GLOBAL_MKT.global_indices.map(async i => {
          const q = await yq(i.symbol);
          globalResult.push({ label: i.label, desc: i.desc, price: q?.price || 0, change: q?.change || 0, source: 'yahoo' });
        }));
      } catch { /* Yahoo failed, continue without global */ }

      res.json([...idxResult, ...globalResult]);
    } catch (e) {
      // Fallback: all from Yahoo
      const items = [
        { symbol: '^JKSE', label: 'IHSG', desc: 'IDX Composite' },
        ...GLOBAL_MKT.global_indices
      ];
      const q = {};
      await Promise.all(items.map(async i => { q[i.symbol] = await yq(i.symbol); }));
      res.json(items.map(i => ({ ...i, price: q[i.symbol]?.price || 0, change: q[i.symbol]?.change || 0 })));
    }
  } else {
    // Commodities + Currencies from Yahoo
    const items = GLOBAL_MKT[cat] || GLOBAL_MKT.commodities;
    const q = {};
    await Promise.all(items.map(async i => { q[i.symbol] = await yq(i.symbol); }));
    res.json(items.map(i => ({
      ...i,
      price: q[i.symbol]?.price || 0,
      change: q[i.symbol]?.change || 0,
      currency: q[i.symbol]?.currency || ''
    })));
  }
});

// Single quote
router.get('/quote', async (req, res) => {
  const q = await yq(req.query.symbol || '');
  res.json(q || { price: 0, change: 0, name: req.query.symbol });
});

// Batch quotes
router.get('/quotes', async (req, res) => {
  const syms = (req.query.symbols || '').split(',').filter(Boolean);
  const r = {};
  await Promise.all(syms.map(async s => { r[s] = await yq(s) || { price: 0, change: 0, name: s }; }));
  res.json(r);
});

// ═══ COMMODITY MAPPING — pure SQLite ═══
router.get('/commodities', (req, res) => {
  try {
    let td = null;
    const stockData = {};
    try {
      td = latestIdxDate();
      if (td) {
        const allTickers = [...new Set(COMMODITY_MAP.flatMap(c => c.tickers))];
        if (allTickers.length) {
          const ph = allTickers.map(() => '?').join(',');
          db.prepare(`SELECT code, name, close, prev_close, volume, value, frequency, foreign_buy, foreign_sell,
            CASE WHEN prev_close>0 THEN ROUND(CAST((close-prev_close)AS REAL)/prev_close*100,2) ELSE 0 END as chg_pct
            FROM idx_daily WHERE trade_date=? AND code IN (${ph})`).all(td, ...allTickers)
            .forEach(r => {
              r.fnet_val = ((r.foreign_buy||0) - (r.foreign_sell||0)) * (r.close||0);
              stockData[r.code] = r;
            });
        }
      }
    } catch(dbErr) { /* continue without stock data */ }

    const result = COMMODITY_MAP.map(c => {
      const stocks = c.tickers.map(t => stockData[t]).filter(Boolean)
        .sort((a, b) => (b.value || 0) - (a.value || 0));
      return {
        id: c.id, label: c.label, tv: c.tv, desc: c.desc, icon: c.icon, color: c.color,
        tickers: c.tickers, stocks,
        total_value: stocks.reduce((s, r) => s + (r.value || 0), 0),
        total_fnet: stocks.reduce((s, r) => s + (r.fnet_val || 0), 0),
        avg_chg: stocks.length ? Math.round(stocks.reduce((s, r) => s + (r.chg_pct || 0), 0) / stocks.length * 100) / 100 : 0,
      };
    });

    res.json({ commodities: result, trade_date: td });
  } catch (e) {
    console.error('Commodities error:', e.message);
    res.json({ commodities: [], error: e.message });
  }
});

// ═══ BEI ANNOUNCEMENTS — from company_announcements table ═══
router.get('/announcements', (req, res) => {
  try {
    const code = (req.query.code || '').toUpperCase();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.q || '';

    let sql = 'SELECT * FROM company_announcements WHERE 1=1';
    const params = [];

    if (code) {
      sql += ' AND company_code = ?';
      params.push(code);
    }
    if (search) {
      sql += ' AND (title LIKE ? OR subject LIKE ? OR company_code LIKE ?)';
      const like = '%' + search + '%';
      params.push(like, like, like);
    }

    sql += ' ORDER BY ann_date DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params);

    // Count total
    let countSql = 'SELECT COUNT(*) as c FROM company_announcements WHERE 1=1';
    const countParams = [];
    if (code) { countSql += ' AND company_code = ?'; countParams.push(code); }
    if (search) { countSql += ' AND (title LIKE ? OR subject LIKE ? OR company_code LIKE ?)'; const like = '%' + search + '%'; countParams.push(like, like, like); }
    const total = db.prepare(countSql).get(...countParams)?.c || 0;

    res.json({ data: rows, total, limit, offset });
  } catch (e) {
    res.json({ data: [], total: 0, error: e.message });
  }
});

// ═══ NEWS — Google News fallback ═══
router.get('/news', async (req, res) => {
  const s = req.query.symbol || '';
  let q = 'saham Indonesia IHSG market hari ini';
  if (s) {
    const c = s.replace('.JK', '').toUpperCase();
    q = s.toUpperCase().endsWith('.JK') ? `${c} saham Indonesia` : `${s} stock market`;
  }
  res.json(await gNews(q));
});

module.exports = router;
