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

// ═══ MARKET OVERVIEW v2 — satu sumber + konteks ═══
// Sumber: idx_indices (indeks IDX), idx_daily (tape + sektor), custom_ohlc
// (global/makro/komoditas/FX, diisi pipeline harian). TIDAK memakai Yahoo live
// supaya angkanya identik dengan Market Regime dan punya tanggal.
const OV_LABEL = {
  SPX: ['S&P 500', 'Wall Street'], VIX: ['VIX', 'Volatilitas'],
  DXY: ['DXY', 'Dolar index'], US10Y: ['US 10Y', 'Yield 10 tahun'],
  COAL: ['Coal', 'Newcastle, USD/t'], CPO: ['CPO', 'Malaysia, MYR/t'],
  NICKEL: ['Nikel', 'USD/t'], TIN: ['Timah', 'USD/t'],
  COPPER: ['Tembaga', 'USD/lb'], ALUMINIUM: ['Aluminium', 'USD/t'],
  ZINC: ['Zinc', 'USD/t'], WTI: ['WTI', 'Minyak'], BRENT: ['Brent', 'Minyak'],
  NATGAS: ['Nat Gas', 'Gas alam'], GOLD: ['Emas', 'USD/oz'],
  USDIDR: ['USD/IDR', 'Rupiah'], USDCNY: ['USD/CNY', 'Yuan'],
};
const OV_LINK = {
  COAL: 'Energi', WTI: 'Energi', BRENT: 'Energi', NATGAS: 'Energi',
  CPO: 'Barang Konsumen Primer',
  NICKEL: 'Barang Baku', TIN: 'Barang Baku', COPPER: 'Barang Baku',
  ALUMINIUM: 'Barang Baku', ZINC: 'Barang Baku',
};

router.get('/market/overview', (req, res) => {
  try {
    const pct = (a, b) => (a != null && b != null && b > 0) ? Math.round((a - b) / b * 10000) / 100 : null;

    function stats(rows) {                       // rows DESC (terbaru dulu)
      if (!rows || !rows.length) return null;
      const asc = rows.map(r => r.close).reverse();
      const n = asc.length, last = asc[n - 1];
      const back = k => (n > k ? asc[n - 1 - k] : null);
      return {
        price: last,
        date: rows[0].trade_date,
        chg_1d: pct(last, back(1)),
        chg_5d: pct(last, back(5)),
        chg_20d: pct(last, back(20)),
        // persentil posisi harga saat ini dalam rentang 1 tahun (0-100)
        pctl: n >= 60 ? Math.round(asc.filter(v => v < last).length / n * 100) : null,
        points: n
      };
    }

    function fromOhlc(code) {
      const rows = db.prepare('SELECT trade_date, close FROM custom_ohlc WHERE code=? ORDER BY trade_date DESC LIMIT 260').all(code);
      const st = stats(rows);
      if (!st) return null;
      const [label, desc] = OV_LABEL[code] || [code, code];
      return Object.assign({ code, label, desc, linked_sector: OV_LINK[code] || '' }, st);
    }

    function fromIndex(code, label, desc) {
      const rows = db.prepare('SELECT trade_date, close FROM idx_indices WHERE index_code=? ORDER BY trade_date DESC LIMIT 60').all(code);
      const st = stats(rows);
      return st ? Object.assign({ code, label, desc }, st) : null;
    }

    // ── TAPE ──
    let tape = null;
    try {
      const tDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT 21').all().map(r => r.trade_date);
      if (tDates.length >= 21) {
        const vals = {};
        db.prepare(`SELECT trade_date, SUM(value) v FROM idx_daily WHERE trade_date >= ? AND close>0 GROUP BY trade_date`)
          .all(tDates[tDates.length - 1]).forEach(r => { vals[r.trade_date] = r.v || 0; });
        const ord = tDates.filter(d => vals[d] !== undefined);
        const vToday = vals[ord[0]] || 0;
        const prev = ord.slice(1, 21).map(d => vals[d]).filter(v => v > 0);
        const ma20 = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
        const rows = db.prepare('SELECT close, prev_close FROM idx_daily WHERE trade_date=? AND close>0 AND prev_close>0').all(ord[0]);
        let adv = 0, dec = 0, ara = 0, arb = 0;
        for (const r of rows) {
          const c = (r.close - r.prev_close) * 1.0 / r.prev_close;
          if (c > 0) adv++; else if (c < 0) dec++;
          const lim = r.prev_close < 500 ? 0.35 : r.prev_close <= 5000 ? 0.25 : 0.20;
          if (c >= lim * 0.995) ara++;
          if (c <= -0.15 * 0.995) arb++;
        }
        tape = { date: ord[0], value: vToday, value_ma20: ma20, value_ratio: ma20 > 0 ? Math.round(vToday / ma20 * 100) / 100 : null, advancers: adv, decliners: dec, ara, arb };
      }
    } catch (e) {}

    // ── SEKTOR (equal-weighted, dari harga saham) ──
    let sectors = [];
    try {
      const dts = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT 2').all().map(r => r.trade_date);
      if (dts.length === 2) {
        db.prepare(`SELECT cp.sector sector,
                    AVG((d.close-d.prev_close)*1.0/d.prev_close*100) chg, COUNT(*) n
                    FROM idx_daily d JOIN company_profiles cp ON d.code=cp.code
                    WHERE d.trade_date=? AND d.close>0 AND d.prev_close>0 AND cp.sector!=''
                    GROUP BY cp.sector`).all(dts[0])
          .forEach(r => sectors.push({ sector: r.sector, chg_1d: Math.round(r.chg * 100) / 100, members: r.n }));
        sectors.sort((a, b) => b.chg_1d - a.chg_1d);
      }
    } catch (e) {}

    const idxItems = [
      ['COMPOSITE', 'IHSG', 'Composite'],
      ['LQ45', 'LQ45', '45 saham likuid'],
      ['IDX30', 'IDX30', '30 saham besar'],
      ['IDX80', 'IDX80', '80 saham'],
      ['IDXHIDIV20', 'HIDIV20', 'Dividen tinggi'],
      ['IDXBUMN20', 'BUMN20', 'BUMN'],
      ['KOMPAS100', 'KOMPAS100', '100 saham'],
      ['ISSI', 'ISSI', 'Syariah'],
    ].map(([c, l, d]) => fromIndex(c, l, d)).filter(Boolean);

    const globalItems = ['SPX', 'VIX', 'DXY', 'US10Y'].map(fromOhlc).filter(Boolean);
    const commodityItems = ['COAL', 'CPO', 'NICKEL', 'TIN', 'COPPER', 'ALUMINIUM', 'ZINC', 'WTI', 'BRENT', 'NATGAS', 'GOLD'].map(fromOhlc).filter(Boolean);
    const fxItems = ['USDIDR', 'USDCNY'].map(fromOhlc).filter(Boolean);

    res.json({
      as_of: (idxItems[0] && idxItems[0].date) || null,
      tape,
      sections: [
        { id: 'idx', title: 'IDX', icon: '📊', items: idxItems },
        { id: 'sectors', title: 'SEKTOR (1 hari)', icon: '🧩', sectors },
        { id: 'global', title: 'RISIKO GLOBAL', icon: '🌐', items: globalItems },
        { id: 'commodities', title: 'KOMODITAS → SEKTOR', icon: '🛢', items: commodityItems },
        { id: 'fx', title: 'FX', icon: '💱', items: fxItems },
      ]
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
        let pctNum = parseIDNum(String(r.percent || '0').replace('%', ''));
        // index_list.percent selalu "0,00%" (upstream tidak mengirim change),
        // sehingga SEMUA indeks IDX tampil 0,00%. Hitung dari idx_indices:
        // dua penutupan terakhir per index_code.
        let asOf = (r.updated_at || '').slice(0, 10) || null;
        try {
          const last2 = db.prepare(`SELECT trade_date, close FROM idx_indices
                                    WHERE index_code=? ORDER BY trade_date DESC LIMIT 2`).all(code);
          if (last2.length === 2 && last2[1].close > 0) {
            pctNum = Math.round((last2[0].close - last2[1].close) / last2[1].close * 10000) / 100;
            asOf = last2[0].trade_date;
          }
        } catch (e) {}
        return { label: meta.label, desc: meta.desc, price: closeNum, change: pctNum, source: 'idx', date: asOf };
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
