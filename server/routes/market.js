const express = require('express');
const { yq } = require('../utils/yahoo');
const { gNews } = require('../utils/news');

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
