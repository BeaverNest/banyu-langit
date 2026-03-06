const express = require('express');
const fs = require('fs');
const XLSX = require('xlsx');
const { db, latestIdxDate } = require('../db');
const { parseTradeDate } = require('../utils/normalize');

const router = express.Router();

// Upload (bulk)
module.exports = function(upload) {
  router.post('/upload', upload.array('file', 500), async (req, res) => {
    try {
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ error: 'No files' });
      const ins = db.prepare(`INSERT INTO idx_daily(trade_date,code,name,prev_close,open_price,high,low,close,change,volume,value,frequency,bid,bid_vol,offer,offer_vol,listed_shares,tradeable_shares,foreign_buy,foreign_sell)VALUES(@trade_date,@code,@name,@prev_close,@open_price,@high,@low,@close,@change,@volume,@value,@frequency,@bid,@bid_vol,@offer,@offer_vol,@listed_shares,@tradeable_shares,@foreign_buy,@foreign_sell)ON CONFLICT(trade_date,code) DO UPDATE SET name=excluded.name,prev_close=excluded.prev_close,open_price=excluded.open_price,high=excluded.high,low=excluded.low,close=excluded.close,change=excluded.change,volume=excluded.volume,value=excluded.value,frequency=excluded.frequency,bid=excluded.bid,bid_vol=excluded.bid_vol,offer=excluded.offer,offer_vol=excluded.offer_vol,listed_shares=excluded.listed_shares,tradeable_shares=excluded.tradeable_shares,foreign_buy=excluded.foreign_buy,foreign_sell=excluded.foreign_sell`);
      let totalCount = 0; const fileDates = [];
      const manualDate = req.body.trade_date || '';
      db.transaction(() => {
        for (const file of files) {
          const wb = XLSX.readFile(file.path);
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws);
          let fileCount = 0, fileDate = '';
          for (const r of rows) {
            const code = String(r['Kode Saham'] || '').trim().toUpperCase();
            if (!code) continue;
            const td = manualDate || parseTradeDate(r['Tanggal Perdagangan Terakhir']) || '';
            if (!td) continue;
            if (!fileDate) fileDate = td;
            ins.run({ trade_date: td, code, name: String(r['Nama Perusahaan'] || '').trim(), prev_close: parseInt(r['Sebelumnya']) || 0, open_price: parseInt(r['Open Price']) || 0, high: parseInt(r['Tertinggi']) || 0, low: parseInt(r['Terendah']) || 0, close: parseInt(r['Penutupan']) || 0, change: parseInt(r['Selisih']) || 0, volume: parseInt(r['Volume']) || 0, value: parseInt(r['Nilai']) || 0, frequency: parseInt(r['Frekuensi']) || 0, bid: parseInt(r['Bid']) || 0, bid_vol: parseInt(r['Bid Volume']) || 0, offer: parseInt(r['Offer']) || 0, offer_vol: parseInt(r['Offer Volume']) || 0, listed_shares: parseInt(r['Listed Shares']) || 0, tradeable_shares: parseInt(r['Tradeble Shares']) || 0, foreign_buy: parseInt(r['Foreign Buy']) || 0, foreign_sell: parseInt(r['Foreign Sell']) || 0 });
            fileCount++;
          }
          if (fileDate) fileDates.push({ file: file.originalname, date: fileDate, rows: fileCount });
          totalCount += fileCount;
        }
      })();
      const dates = db.prepare('SELECT COUNT(DISTINCT trade_date)as c FROM idx_daily').get().c;
      const tickers = db.prepare('SELECT COUNT(DISTINCT code)as c FROM idx_daily').get().c;
      res.json({ success: true, imported: totalCount, files: fileDates, dates, tickers });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Quote
  router.get('/quote', (req, res) => {
    const code = (req.query.code || '').toUpperCase().trim();
    if (!code) return res.json({ error: 'No code' });
    const td = latestIdxDate(); if (!td) return res.json({ error: 'No data' });
    const row = db.prepare('SELECT * FROM idx_daily WHERE trade_date=? AND code=?').get(td, code);
    if (!row) return res.json({ error: 'Not found' });
    const chgPct = row.prev_close ? ((row.close - row.prev_close) / row.prev_close * 100) : 0;
    res.json({ ...row, change_pct: Math.round(chgPct * 100) / 100, foreign_net: row.foreign_buy - row.foreign_sell, foreign_buy_val: row.foreign_buy * row.close, foreign_sell_val: row.foreign_sell * row.close, foreign_net_val: (row.foreign_buy - row.foreign_sell) * row.close, market_cap: row.close * row.listed_shares });
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

  // Daily Digest — auto-generated market summary
  router.get('/digest', (req, res) => {
    try {
      const td = latestIdxDate(); if (!td) return res.json({ error: 'No data' });
      const allDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date DESC LIMIT 5').all().map(r => r.trade_date);
      const prevDate = allDates.length > 1 ? allDates[1] : null;

      // Today's summary
      const today = db.prepare(`SELECT COUNT(*)as total, SUM(CASE WHEN close>prev_close THEN 1 ELSE 0 END)as advancers, SUM(CASE WHEN close<prev_close THEN 1 ELSE 0 END)as decliners, SUM(value)as total_value, SUM(foreign_buy*close)as fbuy, SUM(foreign_sell*close)as fsell, SUM((foreign_buy-foreign_sell)*close)as fnet, SUM(CASE WHEN (foreign_buy-foreign_sell)>0 THEN 1 ELSE 0 END)as fbuy_stocks, SUM(CASE WHEN (foreign_buy-foreign_sell)<0 THEN 1 ELSE 0 END)as fsell_stocks FROM idx_daily WHERE trade_date=? AND close>0`).get(td);

      // Yesterday's net for comparison
      let prevNet = 0, fnetDelta = 0;
      if (prevDate) {
        const prev = db.prepare(`SELECT SUM((foreign_buy-foreign_sell)*close)as fnet FROM idx_daily WHERE trade_date=? AND close>0`).get(prevDate);
        prevNet = prev?.fnet || 0;
        fnetDelta = (today.fnet || 0) - prevNet;
      }

      // Top 3 foreign buy (by value)
      const topBuy = db.prepare(`SELECT code, name, ((foreign_buy-foreign_sell)*close) as fnet_val, CASE WHEN prev_close>0 THEN ROUND(CAST((close-prev_close)AS REAL)/prev_close*100,2) ELSE 0 END as chg FROM idx_daily WHERE trade_date=? AND close>0 AND (foreign_buy-foreign_sell)>0 ORDER BY (foreign_buy-foreign_sell)*close DESC LIMIT 3`).all(td);

      // Top 3 foreign sell
      const topSell = db.prepare(`SELECT code, name, ((foreign_buy-foreign_sell)*close) as fnet_val, CASE WHEN prev_close>0 THEN ROUND(CAST((close-prev_close)AS REAL)/prev_close*100,2) ELSE 0 END as chg FROM idx_daily WHERE trade_date=? AND close>0 AND (foreign_buy-foreign_sell)<0 ORDER BY (foreign_buy-foreign_sell)*close ASC LIMIT 3`).all(td);

      // Top volume spike (vs avg of previous dates)
      let spikes = [];
      const prevDates = allDates.filter(d => d < td).slice(0, 4);
      if (prevDates.length >= 2) {
        const ph = prevDates.map(() => '?').join(',');
        spikes = db.prepare(`SELECT t.code, t.name, t.volume, t.frequency, a.avg_vol, ROUND(CAST(t.volume AS REAL)/a.avg_vol,1) as ratio, CASE WHEN t.prev_close>0 THEN ROUND(CAST((t.close-t.prev_close)AS REAL)/t.prev_close*100,2) ELSE 0 END as chg FROM idx_daily t JOIN (SELECT code, AVG(volume)as avg_vol FROM idx_daily WHERE trade_date IN (${ph}) AND volume>0 GROUP BY code) a ON t.code=a.code WHERE t.trade_date=? AND t.close>0 AND t.volume>0 AND a.avg_vol>0 AND CAST(t.volume AS REAL)/a.avg_vol>3 ORDER BY CAST(t.volume AS REAL)/a.avg_vol DESC LIMIT 3`).all(...prevDates, td);
      }

      // Foreign streak — stocks with consecutive buy/sell
      let streaks = [];
      if (allDates.length >= 3) {
        const last3 = allDates.slice(0, 3);
        const ph = last3.map(() => '?').join(',');
        streaks = db.prepare(`SELECT code, name, COUNT(*)as days, SUM(CASE WHEN (foreign_buy-foreign_sell)>0 THEN 1 ELSE 0 END)as buy_days, SUM((foreign_buy-foreign_sell)*close)as total_fnet FROM idx_daily WHERE trade_date IN (${ph}) AND close>0 GROUP BY code HAVING days=${last3.length} AND (buy_days=${last3.length} OR buy_days=0) ORDER BY ABS(total_fnet) DESC LIMIT 5`).all(...last3);
      }

      res.json({
        trade_date: td,
        prev_date: prevDate,
        market: today,
        fnet_delta: fnetDelta,
        prev_fnet: prevNet,
        top_buy: topBuy,
        top_sell: topSell,
        spikes,
        streaks
      });
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
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
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

    // Fallback
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
  router.post('/fundamental/upload', upload.single('file'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file' });
      const wb = XLSX.readFile(req.file.path);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      if (!rows.length) return res.status(400).json({ error: 'Empty' });
      const snapMonth = req.body.snapshot_month || new Date().toISOString().substring(0, 7);
      const ins = db.prepare(`INSERT INTO idx_fundamental(snapshot_month,code,name,sector,subsector,industry,subindustry,idx_index,per,pbv,roe,roa,der,npm,mkt_cap,total_rev,chg_4w,chg_13w,chg_26w,chg_52w,mtd,ytd)VALUES(@sm,@code,@name,@sector,@subsector,@industry,@subindustry,@idx_index,@per,@pbv,@roe,@roa,@der,@npm,@mkt_cap,@total_rev,@chg_4w,@chg_13w,@chg_26w,@chg_52w,@mtd,@ytd)ON CONFLICT(snapshot_month,code) DO UPDATE SET name=excluded.name,sector=excluded.sector,subsector=excluded.subsector,industry=excluded.industry,subindustry=excluded.subindustry,idx_index=excluded.idx_index,per=excluded.per,pbv=excluded.pbv,roe=excluded.roe,roa=excluded.roa,der=excluded.der,npm=excluded.npm,mkt_cap=excluded.mkt_cap,total_rev=excluded.total_rev,chg_4w=excluded.chg_4w,chg_13w=excluded.chg_13w,chg_26w=excluded.chg_26w,chg_52w=excluded.chg_52w,mtd=excluded.mtd,ytd=excluded.ytd`);
      let count = 0;
      db.transaction(() => {
        for (const r of rows) {
          const code = String(r['Kode Saham'] || '').trim().toUpperCase();
          if (!code) continue;
          ins.run({ sm: snapMonth, code, name: String(r['Nama Perusahaan'] || '').trim(), sector: String(r['Sektor'] || ''), subsector: String(r['Subsektor'] || ''), industry: String(r['Industri'] || ''), subindustry: String(r['Subindustri'] || ''), idx_index: String(r['Index'] || ''), per: parseFloat(r['PER']) || 0, pbv: parseFloat(r['PBV']) || 0, roe: parseFloat(r['ROE %']) || 0, roa: parseFloat(r['ROA %']) || 0, der: parseFloat(r['DER']) || 0, npm: parseFloat(r['NPM %']) || 0, mkt_cap: parseFloat(r['Mkt Cap']) || 0, total_rev: parseFloat(r['Total Rev']) || 0, chg_4w: parseFloat(r['4-wk %Pr. Chg.']) || 0, chg_13w: parseFloat(r['13-wk %Pr. Chg.']) || 0, chg_26w: parseFloat(r['26-wk %Pr. Chg.']) || 0, chg_52w: parseFloat(r['52-wk %Pr. Chg.']) || 0, mtd: parseFloat(r['MTD']) || 0, ytd: parseFloat(r['YTD']) || 0 });
          count++;
        }
      })();
      fs.unlinkSync(req.file.path);
      res.json({ success: true, count, snapshot_month: snapMonth });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

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
      res.json({ snapshot_month: sm, total, sectors });
    } catch { res.json({ total: 0 }); }
  });

  return router;
};