const express = require('express');
const { yq } = require('../utils/yahoo');
const { gNews } = require('../utils/news');
const { db, latestIdxDate } = require('../db');

const router = express.Router();

const MKT = {
  indices: [
    { symbol: '^JKSE', label: 'IHSG', desc: 'IDX Composite' },
    { symbol: '^GSPC', label: 'S&P 500', desc: 'S&P 500' },
    { symbol: '^DJI', label: 'DOW 30', desc: 'Dow Jones' },
    { symbol: '^HSI', label: 'HANG SENG', desc: 'Hong Kong' },
    { symbol: '^N225', label: 'NIKKEI', desc: 'Nikkei Japan' },
    { symbol: '000001.SS', label: 'SHANGHAI', desc: 'Shanghai Composite' },
    { symbol: '^FCHI', label: 'CAC 40', desc: 'France' },
    { symbol: '^GDAXI', label: 'DAX', desc: 'Germany' }
  ],
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
  ]
};

// ═══ COMMODITY → IDX STOCK MAPPING ═══
const COMMODITY_MAP = [
  {
    id: 'coal', label: 'COAL', tv: 'ICEEUR:NCF1!', desc: 'Newcastle Coal',
    icon: '⛏', color: '#64748b',
    tickers: ['ADRO','ITMG','PTBA','BUMI','BYAN','DSSA','GEMS','HRUM','MBAP','TOBA','ADMR','BSSR','GTBO','SMMT','AADI']
  },
  {
    id: 'cpo', label: 'CPO', tv: 'MYX:FCPO1!', desc: 'Crude Palm Oil',
    icon: '🌴', color: '#22c55e',
    tickers: ['AALI','LSIP','DSNG','SIMP','TBLA','SGRO','SSMS','TAPG','CSRA','SMAR','ANJT','JARR']
  },
  {
    id: 'nickel', label: 'NICKEL', tv: 'SHFE:NI1!', desc: 'Nickel Futures',
    icon: '🔩', color: '#0ea5e9',
    tickers: ['ANTM','INCO','NCKL','MBMA','MDKA','IFSH','PURE','HPAL']
  },
  {
    id: 'tin', label: 'TIN', tv: 'SHFE:SN1!', desc: 'Tin Futures',
    icon: '🥫', color: '#8b5cf6',
    tickers: ['TINS','NIKL']
  },
  {
    id: 'gold', label: 'GOLD', tv: 'COMEX:GC1!', desc: 'Gold Futures',
    icon: '🥇', color: '#f59e0b',
    tickers: ['ANTM','MDKA','ARCI','BRMS','EMAS','PSAB']
  },
  {
    id: 'oil', label: 'OIL', tv: 'NYMEX:BZ1!', desc: 'Brent Crude Oil',
    icon: '🛢', color: '#ef4444',
    tickers: ['MEDC','ELSA','ENRG','RATU','ESSA','PTRO','BIPI','DEWA']
  },
  {
    id: 'gas', label: 'GAS', tv: 'NYMEX:NG1!', desc: 'Natural Gas',
    icon: '🔥', color: '#f97316',
    tickers: ['PGAS','RAJA','TPMA']
  },
  {
    id: 'copper', label: 'COPPER', tv: 'COMEX:HG1!', desc: 'Copper Futures',
    icon: '🔶', color: '#dc6b20',
    tickers: ['BRMS','CITA']
  },
  {
    id: 'rubber', label: 'RUBBER', tv: 'TOCOM:JRU1!', desc: 'Rubber TSR20',
    icon: '🌳', color: '#14b8a6',
    tickers: ['GJTL']
  },
  {
    id: 'steel', label: 'STEEL', tv: 'SHFE:RB1!', desc: 'Steel Rebar',
    icon: '🏗', color: '#6366f1',
    tickers: ['ISSP','KRAS','GDST','BTON','INAI']
  }
];

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

// Market overview
router.get('/market', async (req, res) => {
  const cat = req.query.cat || 'indices';
  const items = MKT[cat] || MKT.indices;
  const q = {};
  await Promise.all(items.map(async i => { q[i.symbol] = await yq(i.symbol); }));
  res.json(items.map(i => ({
    ...i,
    price: q[i.symbol]?.price || 0,
    change: q[i.symbol]?.change || 0,
    currency: q[i.symbol]?.currency || ''
  })));
});

// ═══ COMMODITY MAPPING ENDPOINT — no Yahoo fetch, pure SQLite ═══
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
        tickers: c.tickers,
        stocks,
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

// News
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
