const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { db, dataDir, latestSnap } = require('../db');
const { normInv, parseDate, detectHeaders, resolveInvestorGroup, resolveTickerGroup } = require('../utils/normalize');

const router = express.Router();

function stockSummary(rows) {
  const bt = {};
  rows.forEach(r => {
    if (!bt[r.code]) bt[r.code] = { holders: [], totalPct: 0, date: r.snapshot_date, issuer: r.issuer };
    bt[r.code].holders.push(r);
    bt[r.code].totalPct += r.pct;
  });
  Object.values(bt).forEach(t => {
    t.freeFloat = parseFloat(Math.max(0, 100 - t.totalPct).toFixed(2));
    t.totalPct = parseFloat(t.totalPct.toFixed(2));
  });
  return { results: rows.slice(0, 200), total: rows.length, summary: bt };
}

module.exports = function(upload) {
  // Upload XLSX
  router.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    try {
      const wb = XLSX.readFile(req.file.path, { cellDates: true });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      if (!rows.length) return res.status(400).json({ error: 'Empty file' });
      const hmap = detectHeaders(rows[0]);
      if (!Object.values(hmap).includes('code') || !Object.values(hmap).includes('investor'))
        return res.status(400).json({ error: 'Cannot detect columns. Found: ' + Object.keys(rows[0]).join(', ') });
      const manualDate = req.body?.snapshot_date || '';
      const parsed = [];
      for (const row of rows) {
        const r = {}; for (const [s, t] of Object.entries(hmap)) r[t] = row[s];
        const code = String(r.code || '').toUpperCase().trim();
        const investor = String(r.investor || '').trim();
        if (!code || !investor) continue;
        parsed.push({ snapshot_date: manualDate || parseDate(r.date), code, issuer: String(r.issuer || '').trim(), investor, investor_norm: normInv(investor), type: String(r.type || '').toUpperCase().trim(), lf: String(r.lf || '').toUpperCase().trim().charAt(0) || '', nationality: String(r.nationality || '').trim(), domicile: String(r.domicile || '').trim(), holdings: parseInt(r.holdings) || 0, pct: parseFloat(r.pct) || 0 });
      }
      if (!parsed.length) return res.status(400).json({ error: 'No valid rows' });
      const ups = db.prepare(`INSERT INTO holdings(snapshot_date,code,issuer,investor,investor_norm,type,lf,nationality,domicile,holdings,pct)VALUES(@snapshot_date,@code,@issuer,@investor,@investor_norm,@type,@lf,@nationality,@domicile,@holdings,@pct)ON CONFLICT(snapshot_date,code,investor)DO UPDATE SET issuer=excluded.issuer,investor_norm=excluded.investor_norm,type=excluded.type,lf=excluded.lf,holdings=excluded.holdings,pct=excluded.pct`);
      const chkH = db.prepare('SELECT id FROM holdings WHERE snapshot_date=? AND code=? AND investor=?');
      let newRows = 0, updRows = 0;
      db.transaction(() => { for (const r of parsed) { const ex = chkH.get(r.snapshot_date, r.code, r.investor); ups.run(r); if (ex) updRows++; else newRows++; } })();
      const sd = parsed[0].snapshot_date; const tks = [...new Set(parsed.map(r => r.code))].length;
      db.prepare('INSERT INTO upload_logs(filename,snapshot_date,rows_total,rows_new,rows_updated,tickers,upload_type)VALUES(?,?,?,?,?,?,?)').run(req.file.originalname, sd, parsed.length, newRows, updRows, tks, 'insider');
      fs.unlinkSync(req.file.path);
      res.json({ success: true, total: parsed.length, new_rows: newRows, updated_rows: updRows, tickers: tks, date: sd, headers: hmap });
    } catch (e) { console.error('Upload:', e); res.status(500).json({ error: 'Parse failed: ' + e.message }); }
  });

  // Search /api/insider?q=
  router.get('/', (req, res) => {
    try {
      const q = (req.query.q || '').toUpperCase().trim();
      const sd = latestSnap(); if (!sd) return res.json({ tickers: [], total: 0, lastDate: null });
      if (!q) {
        const codes = db.prepare('SELECT DISTINCT code FROM holdings WHERE snapshot_date=? ORDER BY code').all(sd).map(r => r.code);
        return res.json({ tickers: codes, total: db.prepare('SELECT COUNT(*)as c FROM holdings WHERE snapshot_date=?').get(sd).c, lastDate: sd });
      }
      let rows = db.prepare('SELECT * FROM holdings WHERE snapshot_date=? AND code=? ORDER BY pct DESC').all(sd, q);
      if (!rows.length) rows = db.prepare('SELECT * FROM holdings WHERE snapshot_date=? AND code LIKE ? ORDER BY pct DESC').all(sd, q + '%');
      if (!rows.length) rows = db.prepare('SELECT * FROM holdings WHERE snapshot_date=? AND investor_norm LIKE ? ORDER BY pct DESC LIMIT 200').all(sd, '%' + normInv(q) + '%');
      if (!rows.length) return res.json({ results: [], total: 0, summary: {} });
      res.json(stockSummary(rows));
    } catch (e) { res.json({ results: [], total: 0, summary: {}, error: e.message }); }
  });

  // Search by investor
  router.get('/investor', (req, res) => {
    try {
      const q = (req.query.q || '').trim(); if (!q) return res.json({ investors: [], total: 0 });
      const sd = latestSnap(); if (!sd) return res.json({ investors: [], total: 0 });
      const rows = db.prepare('SELECT * FROM holdings WHERE snapshot_date=? AND investor_norm LIKE ? ORDER BY pct DESC').all(sd, '%' + normInv(q) + '%');
      const bi = {}; rows.forEach(r => { const k = r.investor_norm; if (!bi[k]) bi[k] = { name: r.investor, type: r.type, lf: r.lf, stocks: [] }; bi[k].stocks.push({ code: r.code, issuer: r.issuer, holdings: r.holdings, pct: r.pct, date: r.snapshot_date }); });
      Object.values(bi).forEach(i => i.stocks.sort((a, b) => b.pct - a.pct));
      res.json({ investors: Object.values(bi), total: rows.length });
    } catch (e) { res.json({ investors: [], total: 0, error: e.message }); }
  });

  // Network
  router.get('/network', (req, res) => {
    try {
      const code = (req.query.code || '').toUpperCase().trim();
      const inv = (req.query.investor || '').trim();
      const sd = latestSnap(); if (!sd) return res.json({ nodes: [], links: [] });
      const nodes = new Map(), links = [];
      if (code) {
        const hs = db.prepare('SELECT * FROM holdings WHERE snapshot_date=? AND code=? ORDER BY pct DESC').all(sd, code);
        nodes.set('s:' + code, { id: 's:' + code, label: code, type: 'stock' });
        for (const h of hs) {
          const ik = 'i:' + h.investor_norm;
          if (!nodes.has(ik)) nodes.set(ik, { id: ik, label: h.investor.substring(0, 25), type: 'investor', itype: h.type });
          links.push({ source: ik, target: 's:' + code, pct: h.pct });
          const oth = db.prepare('SELECT * FROM holdings WHERE snapshot_date=? AND investor_norm=? AND code!=? ORDER BY pct DESC LIMIT 5').all(sd, h.investor_norm, code);
          for (const o of oth) { const sk = 's:' + o.code; if (!nodes.has(sk)) nodes.set(sk, { id: sk, label: o.code, type: 'stock' }); links.push({ source: ik, target: sk, pct: o.pct }); }
        }
      } else if (inv) {
        const nm = normInv(inv);
        const hs = db.prepare('SELECT * FROM holdings WHERE snapshot_date=? AND investor_norm LIKE ? ORDER BY pct DESC LIMIT 20').all(sd, '%' + nm + '%');
        for (const h of hs) {
          const ik = 'i:' + h.investor_norm; if (!nodes.has(ik)) nodes.set(ik, { id: ik, label: h.investor.substring(0, 25), type: 'investor', itype: h.type });
          const sk = 's:' + h.code; if (!nodes.has(sk)) nodes.set(sk, { id: sk, label: h.code, type: 'stock' });
          links.push({ source: ik, target: sk, pct: h.pct });
          const co = db.prepare('SELECT * FROM holdings WHERE snapshot_date=? AND code=? AND investor_norm!=? ORDER BY pct DESC LIMIT 3').all(sd, h.code, h.investor_norm);
          for (const c of co) { const ck = 'i:' + c.investor_norm; if (!nodes.has(ck)) nodes.set(ck, { id: ck, label: c.investor.substring(0, 25), type: 'investor', itype: c.type }); links.push({ source: ck, target: sk, pct: c.pct }); }
        }
      }
      const enriched = [...nodes.values()].map(n => {
        if (n.type === 'investor') { const g = resolveInvestorGroup(n.label); if (g) { const gd = db.prepare("SELECT category FROM investor_groups WHERE name=?").get(g); n.group = g; n.groupCat = gd ? gd.category : ''; } }
        else if (n.type === 'stock') { const tg = resolveTickerGroup(n.label); if (tg.length) n.groups = tg.map(t => t.group_name); }
        return n;
      });
      res.json({ nodes: enriched, links });
    } catch (e) { res.json({ nodes: [], links: [], error: e.message }); }
  });

  // Overview
  router.get('/overview', (req, res) => {
    try {
      const sd = latestSnap(); if (!sd) return res.json({ types: [], topForeign: [], mostConnected: [] });
      const types = db.prepare("SELECT CASE WHEN type='' OR type IS NULL THEN 'OT' ELSE type END as type,COUNT(DISTINCT investor)as investors,COUNT(DISTINCT code)as tickers FROM holdings WHERE snapshot_date=? GROUP BY 1 ORDER BY investors DESC").all(sd);
      const topForeign = db.prepare("SELECT investor as name,investor_norm,type,COUNT(DISTINCT code)as stocks FROM holdings WHERE snapshot_date=? AND (lf='A' OR lf='F') GROUP BY investor_norm ORDER BY stocks DESC LIMIT 10").all(sd);
      const mostConnected = db.prepare("SELECT investor as name,investor_norm,type,lf,COUNT(DISTINCT code)as stocks FROM holdings WHERE snapshot_date=? GROUP BY investor_norm ORDER BY stocks DESC LIMIT 10").all(sd);
      res.json({ types, topForeign, mostConnected, snapshot_date: sd });
    } catch (e) { res.json({ types: [], topForeign: [], mostConnected: [], error: e.message }); }
  });

  // By type
  router.get('/by-type', (req, res) => {
    try {
      const type = (req.query.type || '').toUpperCase().trim(); if (!type) return res.json({ investors: [], total: 0 });
      const sd = latestSnap(); if (!sd) return res.json({ investors: [], total: 0 });
      const rows = db.prepare("SELECT investor as name,investor_norm,type,lf,COUNT(DISTINCT code)as positions FROM holdings WHERE snapshot_date=? AND (type=? OR (?='OT' AND (type='' OR type IS NULL))) GROUP BY investor_norm ORDER BY positions DESC LIMIT 200").all(sd, type, type);
      const result = rows.map(r => { const top = db.prepare("SELECT code,issuer,pct FROM holdings WHERE snapshot_date=? AND investor_norm=? ORDER BY pct DESC LIMIT 1").get(sd, r.investor_norm); return { ...r, topHolding: top || null }; });
      res.json({ investors: result, total: rows.length, type });
    } catch (e) { res.json({ investors: [], total: 0, error: e.message }); }
  });

  // Tags
  router.get('/tags/groups', (req, res) => { try { res.json({ groups: db.prepare("SELECT * FROM investor_groups ORDER BY category,name").all() }); } catch (e) { res.json({ groups: [], error: e.message }); } });
  router.get('/tags/resolve', (req, res) => {
    try {
      const name = req.query.name || ''; const ticker = req.query.ticker || '';
      const invGroup = name ? resolveInvestorGroup(name) : null;
      const tickerGroups = ticker ? resolveTickerGroup(ticker) : [];
      let groupDetail = null; if (invGroup) groupDetail = db.prepare("SELECT * FROM investor_groups WHERE name=?").get(invGroup);
      res.json({ investor_group: invGroup, ticker_groups: tickerGroups, group_detail: groupDetail });
    } catch (e) { res.json({ error: e.message }); }
  });
  router.post('/tags/upload', multer({ storage: multer.memoryStorage() }).single('file'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file' });
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const tx = db.transaction(() => {
        db.prepare("DELETE FROM investor_groups").run();
        db.prepare("DELETE FROM investor_rules").run();
        db.prepare("DELETE FROM investor_overrides").run();
        db.prepare("DELETE FROM ticker_groups").run();
        if (wb.SheetNames.includes('Groups')) { const rows = XLSX.utils.sheet_to_json(wb.Sheets['Groups']); const ins = db.prepare("INSERT OR IGNORE INTO investor_groups(name,category,key_person,tickers,description)VALUES(?,?,?,?,?)"); for (const r of rows) { if (r.GROUP_NAME) ins.run(r.GROUP_NAME, r.CATEGORY || '', r.KEY_PERSON || '', r.TICKERS || '', r.DESCRIPTION || ''); } }
        if (wb.SheetNames.includes('Keyword Rules')) { const rows = XLSX.utils.sheet_to_json(wb.Sheets['Keyword Rules']); const ins = db.prepare("INSERT INTO investor_rules(keyword,match_type,group_name,notes)VALUES(?,?,?,?)"); for (const r of rows) { if (r.KEYWORD && r.GROUP_NAME) ins.run(r.KEYWORD, r.MATCH_TYPE || 'contains', r.GROUP_NAME, r.NOTES || ''); } }
        if (wb.SheetNames.includes('Manual Overrides')) { const rows = XLSX.utils.sheet_to_json(wb.Sheets['Manual Overrides']); const ins = db.prepare("INSERT OR IGNORE INTO investor_overrides(investor_name,group_name,notes)VALUES(?,?,?)"); for (const r of rows) { if (r.INVESTOR_NAME_EXACT && r.GROUP_NAME) ins.run(r.INVESTOR_NAME_EXACT, r.GROUP_NAME, r.NOTES || ''); } }
        if (wb.SheetNames.includes('Ticker Map')) { const rows = XLSX.utils.sheet_to_json(wb.Sheets['Ticker Map']); const ins = db.prepare("INSERT OR IGNORE INTO ticker_groups(ticker,group_name,category)VALUES(?,?,?)"); for (const r of rows) { if (r.TICKER && r.GROUP_NAME) ins.run(r.TICKER.toUpperCase().trim(), r.GROUP_NAME, r.CATEGORY || ''); } }
      });
      tx();
      res.json({ success: true, groups: db.prepare("SELECT COUNT(*)as c FROM investor_groups").get().c, rules: db.prepare("SELECT COUNT(*)as c FROM investor_rules").get().c, overrides: db.prepare("SELECT COUNT(*)as c FROM investor_overrides").get().c, ticker_map: db.prepare("SELECT COUNT(*)as c FROM ticker_groups").get().c });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  router.get('/tags/stats', (req, res) => { try { res.json({ groups: db.prepare("SELECT COUNT(*)as c FROM investor_groups").get().c, rules: db.prepare("SELECT COUNT(*)as c FROM investor_rules").get().c, overrides: db.prepare("SELECT COUNT(*)as c FROM investor_overrides").get().c, ticker_map: db.prepare("SELECT COUNT(*)as c FROM ticker_groups").get().c }); } catch (e) { res.json({ error: e.message }); } });

  // History
  router.get('/history', (req, res) => {
    try {
      const code = (req.query.code || '').toUpperCase().trim(); if (!code) return res.json({ history: [] });
      const inv = (req.query.investor || '').trim();
      if (inv) { const rows = db.prepare('SELECT snapshot_date as date,investor,pct,holdings FROM holdings WHERE code=? AND investor_norm LIKE ? ORDER BY snapshot_date').all(code, '%' + normInv(inv) + '%'); return res.json({ code, investor: inv, history: rows }); }
      const rows = db.prepare('SELECT snapshot_date as date,COUNT(*)as holders,ROUND(SUM(pct),2)as totalInsider,ROUND(MAX(0,100-SUM(pct)),2)as freeFloat FROM holdings WHERE code=? GROUP BY snapshot_date ORDER BY snapshot_date').all(code);
      res.json({ code, history: rows });
    } catch (e) { res.json({ history: [] }); }
  });

  // Stats
  router.get('/stats', (req, res) => { try { res.json({ total: db.prepare('SELECT COUNT(*)as c FROM holdings').get().c, tickers: db.prepare('SELECT COUNT(DISTINCT code)as c FROM holdings').get().c, investors: db.prepare('SELECT COUNT(DISTINCT investor)as c FROM holdings').get().c, snapshots: db.prepare('SELECT COUNT(DISTINCT snapshot_date)as c FROM holdings').get().c, latest: latestSnap() }); } catch { res.json({ total: 0 }); } });
  router.get('/snapshots', (req, res) => { try { res.json({ snapshots: db.prepare('SELECT DISTINCT snapshot_date,COUNT(*)as rows FROM holdings GROUP BY snapshot_date ORDER BY snapshot_date DESC').all() }); } catch { res.json({ snapshots: [] }); } });
  router.get('/logs', (req, res) => { try { res.json({ logs: db.prepare('SELECT * FROM upload_logs ORDER BY uploaded_at DESC LIMIT 20').all() }); } catch { res.json({ logs: [] }); } });

  // Delete
  router.delete('/', (req, res) => { try { const s = req.query.snapshot; if (s) db.prepare('DELETE FROM holdings WHERE snapshot_date=?').run(s); else db.exec('DELETE FROM holdings'); res.json({ success: true }); } catch (e) { res.json({ success: false, error: e.message }); } });

  // Migrate JSON
  router.post('/migrate', (req, res) => {
    try {
      const f = path.join(dataDir, 'insider.json');
      if (!fs.existsSync(f)) return res.json({ migrated: 0, msg: 'No JSON data' });
      const data = JSON.parse(fs.readFileSync(f, 'utf8')); if (!data.length) return res.json({ migrated: 0 });
      const ins = db.prepare('INSERT OR IGNORE INTO holdings(snapshot_date,code,issuer,investor,investor_norm,type,lf,nationality,domicile,holdings,pct)VALUES(@snapshot_date,@code,@issuer,@investor,@investor_norm,@type,@lf,@nationality,@domicile,@holdings,@pct)');
      let c = 0; db.transaction(() => { for (const r of data) { ins.run({ snapshot_date: r.date || 'unknown', code: (r.code || '').toUpperCase(), issuer: r.issuer || '', investor: r.investor || '', investor_norm: normInv(r.investor || ''), type: r.type || '', lf: r.lf || '', nationality: r.nationality || '', domicile: r.domicile || '', holdings: r.holdings || 0, pct: r.pct || 0 }); c++; } })();
      res.json({ migrated: c });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ═══ INVESTOR TAGS CRUD ═══

  // ── Groups CRUD ──
  router.get('/tags/groups/all', (req, res) => {
    try {
      const rows = db.prepare("SELECT * FROM investor_groups ORDER BY category, name").all();
      res.json({ data: rows });
    } catch (e) { res.json({ data: [], error: e.message }); }
  });

  router.post('/tags/groups', (req, res) => {
    try {
      const { name, category, key_person, tickers, description } = req.body;
      if (!name) return res.status(400).json({ error: 'Name required' });
      db.prepare("INSERT INTO investor_groups(name,category,key_person,tickers,description)VALUES(?,?,?,?,?)")
        .run(name, category || '', key_person || '', tickers || '', description || '');
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/tags/groups/:id', (req, res) => {
    try {
      const { name, category, key_person, tickers, description } = req.body;
      db.prepare("UPDATE investor_groups SET name=?,category=?,key_person=?,tickers=?,description=? WHERE id=?")
        .run(name, category || '', key_person || '', tickers || '', description || '', req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/tags/groups/:id', (req, res) => {
    try {
      db.prepare("DELETE FROM investor_groups WHERE id=?").run(req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Rules CRUD ──
  router.get('/tags/rules/all', (req, res) => {
    try {
      const rows = db.prepare("SELECT * FROM investor_rules ORDER BY group_name, keyword").all();
      res.json({ data: rows });
    } catch (e) { res.json({ data: [], error: e.message }); }
  });

  router.post('/tags/rules', (req, res) => {
    try {
      const { keyword, match_type, group_name, notes } = req.body;
      if (!keyword || !group_name) return res.status(400).json({ error: 'keyword + group_name required' });
      db.prepare("INSERT INTO investor_rules(keyword,match_type,group_name,notes)VALUES(?,?,?,?)")
        .run(keyword, match_type || 'contains', group_name, notes || '');
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/tags/rules/:id', (req, res) => {
    try {
      const { keyword, match_type, group_name, notes } = req.body;
      db.prepare("UPDATE investor_rules SET keyword=?,match_type=?,group_name=?,notes=? WHERE id=?")
        .run(keyword, match_type || 'contains', group_name, notes || '', req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/tags/rules/:id', (req, res) => {
    try {
      db.prepare("DELETE FROM investor_rules WHERE id=?").run(req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Ticker Map CRUD ──
  router.get('/tags/tickers/all', (req, res) => {
    try {
      const rows = db.prepare("SELECT * FROM ticker_groups ORDER BY group_name, ticker").all();
      res.json({ data: rows });
    } catch (e) { res.json({ data: [], error: e.message }); }
  });

  router.post('/tags/tickers', (req, res) => {
    try {
      const { ticker, group_name, category } = req.body;
      if (!ticker || !group_name) return res.status(400).json({ error: 'ticker + group_name required' });
      db.prepare("INSERT OR IGNORE INTO ticker_groups(ticker,group_name,category)VALUES(?,?,?)")
        .run(ticker.toUpperCase().trim(), group_name, category || '');
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/tags/tickers/:id', (req, res) => {
    try {
      const { ticker, group_name, category } = req.body;
      db.prepare("UPDATE ticker_groups SET ticker=?,group_name=?,category=? WHERE id=?")
        .run(ticker.toUpperCase().trim(), group_name, category || '', req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/tags/tickers/:id', (req, res) => {
    try {
      db.prepare("DELETE FROM ticker_groups WHERE id=?").run(req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Overrides CRUD ──
  router.get('/tags/overrides/all', (req, res) => {
    try {
      const rows = db.prepare("SELECT * FROM investor_overrides ORDER BY group_name, investor_name").all();
      res.json({ data: rows });
    } catch (e) { res.json({ data: [], error: e.message }); }
  });

  router.post('/tags/overrides', (req, res) => {
    try {
      const { investor_name, group_name, notes } = req.body;
      if (!investor_name || !group_name) return res.status(400).json({ error: 'investor_name + group_name required' });
      db.prepare("INSERT OR IGNORE INTO investor_overrides(investor_name,group_name,notes)VALUES(?,?,?)")
        .run(investor_name, group_name, notes || '');
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/tags/overrides/:id', (req, res) => {
    try {
      const { investor_name, group_name, notes } = req.body;
      db.prepare("UPDATE investor_overrides SET investor_name=?,group_name=?,notes=? WHERE id=?")
        .run(investor_name, group_name, notes || '', req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.delete('/tags/overrides/:id', (req, res) => {
    try {
      db.prepare("DELETE FROM investor_overrides WHERE id=?").run(req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
