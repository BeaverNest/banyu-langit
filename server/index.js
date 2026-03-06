const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { db, dataDir } = require('./db');
const { yq } = require('./utils/yahoo');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';

// Directories
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Multer
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(uploadDir));

// Auth middleware for API v1
function auth(req, res, next) {
  if (!API_KEY) return next();
  const k = req.headers['x-api-key'] || req.query.api_key;
  if (k !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ═══ Mount routes ═══
const diaryRoutes = require('./routes/diary')(upload);
const watchlistRoutes = require('./routes/watchlist');
const marketRoutes = require('./routes/market');
const insiderRoutes = require('./routes/insider')(upload);
const idxRoutes = require('./routes/idx')(upload);
const screenerRoutes = require('./routes/screener');

app.use('/api', diaryRoutes);
app.use('/api', watchlistRoutes);
app.use('/api', marketRoutes);
app.use('/api/insider', insiderRoutes);
app.use('/api/idx', idxRoutes);
app.use('/api/screener', screenerRoutes);

// ═══ Global Search — Unified Ticker ═══
app.get('/api/ticker/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase().trim();
    const { latestSnap, latestIdxDate } = require('./db');
    const result = { code };

    // IDX Daily — latest + history
    const td = latestIdxDate();
    if (td) {
      const latest = db.prepare('SELECT * FROM idx_daily WHERE trade_date=? AND code=?').get(td, code);
      if (latest) {
        const chgPct = latest.prev_close ? ((latest.close - latest.prev_close) / latest.prev_close * 100) : 0;
        result.price = { ...latest, change_pct: Math.round(chgPct * 100) / 100, foreign_net: latest.foreign_buy - latest.foreign_sell, foreign_net_val: (latest.foreign_buy - latest.foreign_sell) * latest.close, market_cap: latest.close * latest.listed_shares };
      }
      // Foreign flow last 20 days
      const flow = db.prepare('SELECT trade_date,close,volume,value,frequency,foreign_buy,foreign_sell FROM idx_daily WHERE code=? ORDER BY trade_date DESC LIMIT 20').all(code);
      let acc = 0;
      flow.reverse().forEach(r => { r.foreign_net = r.foreign_buy - r.foreign_sell; r.foreign_net_val = r.foreign_net * r.close; acc += r.foreign_net_val; r.acc = acc; });
      result.flow = flow;
    }

    // Yahoo quote fallback
    if (!result.price) {
      const q = await yq(code + '.JK') || await yq(code);
      if (q) result.yahoo = q;
    }

    // Insider ownership
    const sd = latestSnap();
    if (sd) {
      const holders = db.prepare('SELECT investor,type,lf,holdings,pct FROM holdings WHERE snapshot_date=? AND code=? ORDER BY pct DESC LIMIT 15').all(sd, code);
      if (holders.length) {
        const totalPct = holders.reduce((s, h) => s + h.pct, 0);
        result.insider = { holders, totalPct: Math.round(totalPct * 100) / 100, freeFloat: Math.round(Math.max(0, 100 - totalPct) * 100) / 100, snapshot_date: sd };
      }
    }

    // Fundamental data
    const { latestFundDate } = require('./db');
    const fm = latestFundDate();
    if (fm) {
      const fund = db.prepare('SELECT * FROM idx_fundamental WHERE snapshot_month=? AND code=?').get(fm, code);
      if (fund) result.fundamental = fund;
    }

    res.json(result);
  } catch (e) { res.json({ code: req.params.code, error: e.message }); }
});

// Autocomplete — search tickers from idx_daily
app.get('/api/search', (req, res) => {
  try {
    const q = (req.query.q || '').toUpperCase().trim();
    if (q.length < 1) return res.json([]);
    const { latestIdxDate } = require('./db');
    const td = latestIdxDate();
    if (!td) return res.json([]);
    const rows = db.prepare('SELECT code, name, close, (foreign_buy-foreign_sell)*close as fnet_val FROM idx_daily WHERE trade_date=? AND code LIKE ? AND close>0 ORDER BY value DESC LIMIT 8').all(td, q + '%');
    res.json(rows);
  } catch { res.json([]); }
});

// ═══ API V1 (Authenticated) ═══
const v1 = express.Router();
v1.use(auth);
v1.get('/insider/stock', (req, res) => {
  const q = (req.query.q || '').toUpperCase().trim();
  const { latestSnap } = require('./db');
  const sd = latestSnap();
  if (!sd) return res.json({ success: true, data: { results: [], total: 0 } });
  if (!q) {
    const codes = db.prepare('SELECT DISTINCT code FROM holdings WHERE snapshot_date=? ORDER BY code').all(sd).map(r => r.code);
    return res.json({ success: true, data: { tickers: codes, total: codes.length, lastDate: sd } });
  }
  let rows = db.prepare('SELECT * FROM holdings WHERE snapshot_date=? AND code=? ORDER BY pct DESC').all(sd, q);
  if (!rows.length) rows = db.prepare('SELECT * FROM holdings WHERE snapshot_date=? AND code LIKE ? ORDER BY pct DESC').all(sd, q + '%');
  res.json({ success: true, data: { results: rows, total: rows.length } });
});
v1.get('/quote', async (req, res) => { const q = await yq(req.query.symbol || ''); res.json({ success: true, data: q || { price: 0, change: 0 } }); });
app.use('/api/v1', v1);

// Health
app.get('/api/health', (req, res) => {
  const s = db.prepare('SELECT COUNT(*)as c FROM holdings').get();
  res.json({ status: 'ok', version: '2.0.0', name: 'Banyu Langit Trading Diary', db: 'sqlite', holdings: s.c });
});

// ═══ Auto-load investor tags ═══
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Banyu Langit v2 on http://localhost:${PORT}`);
  try {
    const tagCount = db.prepare("SELECT COUNT(*)as c FROM investor_groups").get().c;
    if (tagCount === 0) {
      const paths = ['./data/investor_tags.xlsx', '/app/data/investor_tags.xlsx'];
      for (const fp of paths) {
        if (fs.existsSync(fp)) {
          console.log('Auto-loading investor tags from', fp);
          const wb = XLSX.read(fs.readFileSync(fp), { type: 'buffer' });
          const tx = db.transaction(() => {
            if (wb.SheetNames.includes('Groups')) {
              const rows = XLSX.utils.sheet_to_json(wb.Sheets['Groups']);
              const ins = db.prepare("INSERT OR IGNORE INTO investor_groups(name,category,key_person,tickers,description)VALUES(?,?,?,?,?)");
              for (const r of rows) { if (r.GROUP_NAME) ins.run(r.GROUP_NAME, r.CATEGORY || '', r.KEY_PERSON || '', r.TICKERS || '', r.DESCRIPTION || ''); }
            }
            if (wb.SheetNames.includes('Keyword Rules')) {
              const rows = XLSX.utils.sheet_to_json(wb.Sheets['Keyword Rules']);
              const ins = db.prepare("INSERT INTO investor_rules(keyword,match_type,group_name,notes)VALUES(?,?,?,?)");
              for (const r of rows) { if (r.KEYWORD && r.GROUP_NAME) ins.run(r.KEYWORD, r.MATCH_TYPE || 'contains', r.GROUP_NAME, r.NOTES || ''); }
            }
            if (wb.SheetNames.includes('Manual Overrides')) {
              const rows = XLSX.utils.sheet_to_json(wb.Sheets['Manual Overrides']);
              const ins = db.prepare("INSERT OR IGNORE INTO investor_overrides(investor_name,group_name,notes)VALUES(?,?,?)");
              for (const r of rows) { if (r.INVESTOR_NAME_EXACT && r.GROUP_NAME) ins.run(r.INVESTOR_NAME_EXACT, r.GROUP_NAME, r.NOTES || ''); }
            }
            if (wb.SheetNames.includes('Ticker Map')) {
              const rows = XLSX.utils.sheet_to_json(wb.Sheets['Ticker Map']);
              const ins = db.prepare("INSERT OR IGNORE INTO ticker_groups(ticker,group_name,category)VALUES(?,?,?)");
              for (const r of rows) { if (r.TICKER && r.GROUP_NAME) ins.run(r.TICKER.toUpperCase().trim(), r.GROUP_NAME, r.CATEGORY || ''); }
            }
          });
          tx();
          const stats = { groups: db.prepare("SELECT COUNT(*)as c FROM investor_groups").get().c, rules: db.prepare("SELECT COUNT(*)as c FROM investor_rules").get().c };
          console.log('Tags loaded:', stats.groups, 'groups,', stats.rules, 'rules');
          break;
        }
      }
    } else { console.log('Tags already loaded:', tagCount, 'groups'); }
  } catch (e) { console.error('Tag auto-load error:', e.message); }
});
