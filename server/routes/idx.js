const express = require('express');
const fs = require('fs');
const XLSX = require('xlsx');
const { db, latestIdxDate } = require('../db');
const { parseTradeDate } = require('../utils/normalize');

const router = express.Router();

// Upload (bulk) — with duplicate detection, format validation, corporate actions
module.exports = function(upload) {
  // Expected IDX headers
  var IDX_HEADERS = ['Kode Saham','Nama Perusahaan','Tanggal Perdagangan Terakhir','Sebelumnya','Open Price','Tertinggi','Terendah','Penutupan','Selisih','Volume','Nilai','Frekuensi','Bid','Bid Volume','Offer','Offer Volume','Listed Shares','Tradeble Shares','Foreign Buy','Foreign Sell'];

  router.post('/upload', upload.array('file', 500), async (req, res) => {
    try {
      const files = req.files || [];
      if (!files.length) return res.status(400).json({ error: 'No files' });

      const ins = db.prepare(`INSERT INTO idx_daily(trade_date,code,name,prev_close,open_price,high,low,close,change,volume,value,frequency,bid,bid_vol,offer,offer_vol,listed_shares,tradeable_shares,foreign_buy,foreign_sell)VALUES(@trade_date,@code,@name,@prev_close,@open_price,@high,@low,@close,@change,@volume,@value,@frequency,@bid,@bid_vol,@offer,@offer_vol,@listed_shares,@tradeable_shares,@foreign_buy,@foreign_sell)ON CONFLICT(trade_date,code) DO UPDATE SET name=excluded.name,prev_close=excluded.prev_close,open_price=excluded.open_price,high=excluded.high,low=excluded.low,close=excluded.close,change=excluded.change,volume=excluded.volume,value=excluded.value,frequency=excluded.frequency,bid=excluded.bid,bid_vol=excluded.bid_vol,offer=excluded.offer,offer_vol=excluded.offer_vol,listed_shares=excluded.listed_shares,tradeable_shares=excluded.tradeable_shares,foreign_buy=excluded.foreign_buy,foreign_sell=excluded.foreign_sell`);

      const chk = db.prepare('SELECT id FROM idx_daily WHERE trade_date=? AND code=?');

      let totalNew = 0, totalUpdated = 0, totalSkipped = 0;
      const fileDates = [];
      const warnings = [];
      const manualDate = req.body.trade_date || '';

      db.transaction(() => {
        for (const file of files) {
          const wb = XLSX.readFile(file.path);
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws);

          // Format validation — check headers
          if (rows.length > 0) {
            var fileHeaders = Object.keys(rows[0]);
            var missing = IDX_HEADERS.filter(function(h) { return !fileHeaders.some(function(fh) { return fh.trim() === h; }); });
            var unknown = fileHeaders.filter(function(fh) { return !IDX_HEADERS.some(function(h) { return h === fh.trim(); }); });
            if (missing.length > 3) {
              warnings.push({ file: file.originalname, type: 'headers', message: 'Missing ' + missing.length + ' expected columns: ' + missing.slice(0, 5).join(', '), missing: missing.slice(0, 10) });
            }
            if (unknown.length > 0 && unknown.length > fileHeaders.length / 2) {
              warnings.push({ file: file.originalname, type: 'format', message: 'Unrecognized format — ' + unknown.length + ' unknown columns', unknown: unknown.slice(0, 5) });
            }
          }

          let fileNew = 0, fileUpdated = 0, fileSkipped = 0, fileDate = '';
          for (const r of rows) {
            const code = String(r['Kode Saham'] || '').trim().toUpperCase();
            if (!code) continue;
            const td = manualDate || parseTradeDate(r['Tanggal Perdagangan Terakhir']) || '';
            if (!td) continue;
            if (!fileDate) fileDate = td;

            // Duplicate detection
            const existing = chk.get(td, code);

            ins.run({ trade_date: td, code, name: String(r['Nama Perusahaan'] || '').trim(), prev_close: parseInt(r['Sebelumnya']) || 0, open_price: parseInt(r['Open Price']) || 0, high: parseInt(r['Tertinggi']) || 0, low: parseInt(r['Terendah']) || 0, close: parseInt(r['Penutupan']) || 0, change: parseInt(r['Selisih']) || 0, volume: parseInt(r['Volume']) || 0, value: parseInt(r['Nilai']) || 0, frequency: parseInt(r['Frekuensi']) || 0, bid: parseInt(r['Bid']) || 0, bid_vol: parseInt(r['Bid Volume']) || 0, offer: parseInt(r['Offer']) || 0, offer_vol: parseInt(r['Offer Volume']) || 0, listed_shares: parseInt(r['Listed Shares']) || 0, tradeable_shares: parseInt(r['Tradeble Shares']) || 0, foreign_buy: parseInt(r['Foreign Buy']) || 0, foreign_sell: parseInt(r['Foreign Sell']) || 0 });

            if (existing) fileUpdated++;
            else fileNew++;
          }

          if (fileDate) fileDates.push({ file: file.originalname, date: fileDate, new: fileNew, updated: fileUpdated });
          totalNew += fileNew;
          totalUpdated += fileUpdated;
        }
      })();

      const dates = db.prepare('SELECT COUNT(DISTINCT trade_date)as c FROM idx_daily').get().c;
      const tickers = db.prepare('SELECT COUNT(DISTINCT code)as c FROM idx_daily').get().c;

      // Log upload
      for (const fd of fileDates) {
        db.prepare('INSERT INTO upload_logs(filename,snapshot_date,rows_total,rows_new,rows_updated,tickers,upload_type)VALUES(?,?,?,?,?,?,?)').run(fd.file, fd.date, fd.new + fd.updated, fd.new, fd.updated, tickers, 'idx_daily');
      }

      // Auto-detect corporate actions
      const detected = detectCorporateActions();

      res.json({ success: true, imported: totalNew + totalUpdated, new_rows: totalNew, updated_rows: totalUpdated, files: fileDates, dates, tickers, warnings, detected_ca: detected });
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
      db.prepare('INSERT INTO upload_logs(filename,snapshot_date,rows_total,rows_new,tickers,upload_type)VALUES(?,?,?,?,?,?)').run(req.file.originalname, snapMonth, count, count, count, 'fundamental');
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

  return router;
};