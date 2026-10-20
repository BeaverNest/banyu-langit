const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

// ═══ .env support — read from .env file if exists ═══
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const [key, ...rest] = line.split('=');
      const val = rest.join('=').trim();
      if (key && val && !process.env[key.trim()]) process.env[key.trim()] = val;
    });
  }
} catch (e) { /* ignore */ }

const { db, dataDir } = require('./db');
const { yq } = require('./utils/yahoo');
// Basis penyesuaian harga untuk mini-chart pencarian: ca_factors adalah satu-satunya
// sumber untuk kode yang dikenalinya, corporate_actions hanya fallback (helper yang
// sama dipakai chart panel, /stock-detail, screener, dan jalur skoring).
const { loadFactors, factorForRow, fallbackRatioActions } = require('./utils/price-adjust');

const app = express();
const PORT = parseInt(process.env.PORT) || 3000;
const API_KEY = process.env.API_KEY || '';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

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
app.use(express.json({ limit: '20mb' }));   // impor KSEI bulanan ~0,5 MB/payload
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
// Monitor lintas aset + skor regime (kanban t_19f4f0d4) — router sendiri supaya berkas route
// idx.js (6 ribu baris) tidak perlu ditumbuhi satu blok lagi setiap kali ada data baru.
app.use('/api/idx', require('./routes/cross-asset'));
app.use('/api/screener', screenerRoutes);
app.use('/api/backtest', require('./routes/backtest'));
app.use('/api/portfolio', require('./routes/portfolio'));

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
        // Check suspend status
        let suspended = false;
        try {
          const susRow = db.prepare('SELECT type FROM company_suspends WHERE code=? ORDER BY suspend_date DESC LIMIT 1').get(code);
          if (susRow && (susRow.type === 'Suspend' || susRow.type === 'suspend')) suspended = true;
        } catch {}
        result.price = { ...latest, change_pct: Math.round(chgPct * 100) / 100, foreign_net: latest.foreign_buy - latest.foreign_sell, foreign_net_val: (latest.foreign_buy - latest.foreign_sell) * latest.close, market_cap: latest.close * latest.listed_shares, suspended };
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

    // Corporate actions (row mentah — tetap dikirim untuk badge/kompatibilitas UI)
    const cas = db.prepare(`SELECT * FROM corporate_actions WHERE code=? AND status='confirmed' ORDER BY ex_date DESC`).all(code);
    if (cas.length) result.corporate_actions = cas;

    // Basis faktor untuk SEMUA baris (flow + adj_chart): ca_factors menang; ratio dari
    // corporate_actions HANYA dipakai kalau kode itu tidak punya entri ca_factors.
    // Menjumlahkan keduanya = double count (RAJA 0,2x0,2, DSSA 625x) — lihat price-adjust.js.
    const factors = loadFactors(db)[code] || [];
    const ratioCas = fallbackRatioActions(factors, cas);
    const factorSource = factors.length ? 'ca_factors' : (ratioCas.length ? 'corporate_actions' : null);

    // Enrich flow with adjusted close (basis yang sama dengan chart & tabel adj_chart)
    if (result.flow && result.flow.length && factorSource) {
      result.flow = result.flow.map(r => {
        const cumFactor = factorForRow(factors, cas, r.trade_date);
        r.adj_close = cumFactor !== 1 ? Math.round(r.close * cumFactor) : r.close;
        r.adj_factor = Math.round(cumFactor * 1000000) / 1000000;
        r.adjusted = cumFactor !== 1;
        r.factor_source = factorSource;
        return r;
      });
    }

    // Price chart — always provide (last 120 days), with adjustment from the factor basis
    if (td) {
      const hist = db.prepare('SELECT trade_date,close,high,low,volume,foreign_buy,foreign_sell,bid_vol,offer_vol FROM idx_daily WHERE code=? ORDER BY trade_date DESC LIMIT 500').all(code);
      hist.reverse();
      if (hist.length >= 2) {
        result.adj_chart = hist.map(r => {
          const cumFactor = factorForRow(factors, cas, r.trade_date);
          return {
            trade_date: r.trade_date,
            close: r.close,
            adj_close: cumFactor !== 1 ? Math.round(r.close * cumFactor) : r.close,
            adj_high: cumFactor !== 1 ? Math.round(r.high * cumFactor) : r.high,
            adj_low: cumFactor !== 1 ? Math.round(r.low * cumFactor) : r.low,
            fnet_val: (r.foreign_buy - r.foreign_sell) * r.close,
            bid_vol: r.bid_vol || 0,
            offer_vol: r.offer_vol || 0,
            volume: r.volume || 0,
            adjusted: cumFactor !== 1,
            factor_source: factorSource
          };
        });
      }
    }

    // Dividends for this ticker
    try {
      const divs = db.prepare('SELECT * FROM dividends WHERE code=? ORDER BY ex_date DESC LIMIT 10').all(code);
      if (divs.length) {
        result.dividends = divs;
        // Dividend yield = latest cash_dividend / close * 100
        if (result.price && result.price.close > 0 && divs[0].cash_dividend) {
          result.dividend_yield = Math.round(divs[0].cash_dividend / result.price.close * 10000) / 100;
        }
      }
    } catch {}

    // Deep financial ratios (assets, equity, EPS, book_value)
    try {
      const ratios = db.prepare('SELECT * FROM financial_ratios WHERE code=? ORDER BY period DESC LIMIT 8').all(code);
      if (ratios.length) {
        result.financial_ratios = ratios;
        result.financial_ratios_unit = 'million';
      }
    } catch {}

    // ═══ SECTOR PEERS — median/percentile PER/PBV/ROE/DER/NPM for same sector & industry ═══
    try {
      const { latestFundDate } = require('./db');
      const fm2 = latestFundDate();
      if (fm2 && result.fundamental) {
        const sect = result.fundamental.sector;
        const ind = result.fundamental.industry;
        function calcPercentiles(arr) {
          if (!arr.length) return { median: 0, p25: 0, p75: 0, min: 0, max: 0, count: 0 };
          const s = arr.slice().sort((a, b) => a - b);
          const n = s.length;
          return {
            median: s[Math.floor(n / 2)],
            p25: s[Math.floor(n * 0.25)],
            p75: s[Math.floor(n * 0.75)],
            min: s[0],
            max: s[n - 1],
            count: n
          };
        }
        if (sect) {
          const peers = db.prepare('SELECT code, per, pbv, roe, roa, der, npm, mkt_cap FROM idx_fundamental WHERE snapshot_month=? AND sector=? AND per>0 AND pbv>0').all(fm2, sect);
          if (peers.length >= 3) {
            result.sector_peers = {
              sector: sect,
              count: peers.length,
              per: calcPercentiles(peers.map(p => p.per).filter(v => v > 0 && v < 200)),
              pbv: calcPercentiles(peers.map(p => p.pbv).filter(v => v > 0 && v < 50)),
              roe: calcPercentiles(peers.map(p => p.roe).filter(v => Math.abs(v) < 200)),
              der: calcPercentiles(peers.map(p => p.der).filter(v => v >= 0 && v < 50)),
              npm: calcPercentiles(peers.map(p => p.npm).filter(v => Math.abs(v) < 200))
            };
          }
        }
        if (ind) {
          const indPeers = db.prepare('SELECT code, per, pbv, roe, der, npm FROM idx_fundamental WHERE snapshot_month=? AND industry=? AND per>0 AND pbv>0').all(fm2, ind);
          if (indPeers.length >= 3) {
            result.industry_peers = {
              industry: ind,
              count: indPeers.length,
              per: calcPercentiles(indPeers.map(p => p.per).filter(v => v > 0 && v < 200)),
              pbv: calcPercentiles(indPeers.map(p => p.pbv).filter(v => v > 0 && v < 50)),
              roe: calcPercentiles(indPeers.map(p => p.roe).filter(v => Math.abs(v) < 200))
            };
          }
        }
      }
    } catch {}

    // ═══ INDUSTRY PER/PBV TIME SERIES — from industry_trading table ═══
    try {
      const ind = (result.fundamental || {}).industry;
      if (ind) {
        const indTs = db.prepare('SELECT trade_date, per, pbv, market_cap, volume, value FROM industry_trading WHERE industry=? AND per>0 ORDER BY trade_date DESC LIMIT 250').all(ind);
        if (indTs.length >= 5) {
          indTs.reverse();
          result.industry_ts = { industry: ind, data: indTs };
        }
      }
    } catch {}

    // ═══ FINANCIAL REPORTS — PDF links from BEI ═══
    try {
      const reports = db.prepare('SELECT * FROM financial_reports WHERE code=? ORDER BY year DESC, period DESC LIMIT 8').all(code);
      if (reports.length) result.financial_reports_list = reports;
    } catch {}

    // ═══ ISSUED HISTORY — share issuance/dilution ═══
    try {
      const issued = db.prepare('SELECT * FROM issued_history WHERE code=? ORDER BY issue_date DESC LIMIT 20').all(code);
      if (issued.length) result.issued_history = issued;
    } catch {}

    // ═══ COMPANY PROFILE & DETAIL ═══
    try {
      const prof = db.prepare('SELECT * FROM company_profiles WHERE code=?').get(code);
      if (prof) result.profile = prof;
      const det = db.prepare('SELECT * FROM company_details WHERE code=?').get(code);
      if (det) result.detail = det;
    } catch {}

    // Announcements count
    try {
      const annCount = db.prepare('SELECT COUNT(*) as c FROM company_announcements WHERE company_code=?').get(code);
      if (annCount && annCount.c > 0) result.announcements_count = annCount.c;
    } catch {}

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
// Agent rail (read-only, envelope-first): /api/v1/idx/{freshness,series,indicator,scores}
// Mounted before the v1 router so agent reads never depend on the UI auth middleware.
app.use('/api/v1/idx', require('./routes/rail'));
app.use('/api/v1', v1);

// Health
app.get('/api/health', (req, res) => {
  const s = db.prepare('SELECT COUNT(*)as c FROM holdings').get();
  res.json({ status: 'ok', version: '2.0.0', name: 'Banyu Langit Trading Diary', db: 'sqlite', holdings: s.c });
});

// ═══ Upload Logs — unified for all upload types ═══
app.get('/api/upload-logs', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM upload_logs ORDER BY uploaded_at DESC LIMIT 50').all();
    res.json({ logs: rows });
  } catch { res.json({ logs: [] }); }
});

// ═══ Quarterly Financials ═══
app.get('/api/quarterly/:code', (req, res) => {
  try {
    const code = req.params.code.toUpperCase().trim();
    const rows = db.prepare('SELECT * FROM quarterly_financials WHERE code=? ORDER BY period DESC').all(code);
    res.json({ code, data: rows });
  } catch (e) { res.json({ code: req.params.code, data: [], error: e.message }); }
});

app.post('/api/quarterly/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(req.file.path);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    if (!rows.length) return res.status(400).json({ error: 'Empty file' });

    const ins = db.prepare(`INSERT INTO quarterly_financials(code,period,period_type,revenue,net_income,operating_income,gross_profit,eps,total_assets,total_equity,total_debt,total_cash,operating_cashflow,free_cashflow,capex,dividend_per_share,shares_outstanding)
      VALUES(@code,@period,@period_type,@revenue,@net_income,@operating_income,@gross_profit,@eps,@total_assets,@total_equity,@total_debt,@total_cash,@operating_cashflow,@free_cashflow,@capex,@dividend_per_share,@shares_outstanding)
      ON CONFLICT(code,period,period_type) DO UPDATE SET revenue=excluded.revenue,net_income=excluded.net_income,operating_income=excluded.operating_income,gross_profit=excluded.gross_profit,eps=excluded.eps,total_assets=excluded.total_assets,total_equity=excluded.total_equity,total_debt=excluded.total_debt,total_cash=excluded.total_cash,operating_cashflow=excluded.operating_cashflow,free_cashflow=excluded.free_cashflow,capex=excluded.capex,dividend_per_share=excluded.dividend_per_share,shares_outstanding=excluded.shares_outstanding`);

    let count = 0;
    db.transaction(() => {
      for (const r of rows) {
        const code = String(r.code || '').trim().toUpperCase();
        const period = String(r.period || '').trim();
        if (!code || !period) continue;
        ins.run({
          code, period, period_type: String(r.period_type || 'quarterly'),
          revenue: parseFloat(r.revenue) || 0, net_income: parseFloat(r.net_income) || 0,
          operating_income: parseFloat(r.operating_income) || 0, gross_profit: parseFloat(r.gross_profit) || 0,
          eps: parseFloat(r.eps) || 0, total_assets: parseFloat(r.total_assets) || 0,
          total_equity: parseFloat(r.total_equity) || 0, total_debt: parseFloat(r.total_debt) || 0,
          total_cash: parseFloat(r.total_cash) || 0, operating_cashflow: parseFloat(r.operating_cashflow) || 0,
          free_cashflow: parseFloat(r.free_cashflow) || 0, capex: parseFloat(r.capex) || 0,
          dividend_per_share: parseFloat(r.dividend_per_share) || 0,
          shares_outstanding: parseFloat(r.shares_outstanding) || 0
        });
        count++;
      }
    })();
    fs.unlinkSync(req.file.path);
    db.prepare('INSERT INTO upload_logs(filename,snapshot_date,rows_total,rows_new,tickers,upload_type)VALUES(?,?,?,?,?,?)').run(req.file.originalname, '', count, count, [...new Set(rows.map(r => r.code))].length, 'quarterly');
    res.json({ success: true, count, tickers: [...new Set(rows.map(r => r.code))].length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/quarterly/stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*)as c FROM quarterly_financials').get().c;
    const tickers = db.prepare('SELECT COUNT(DISTINCT code)as c FROM quarterly_financials').get().c;
    const periods = db.prepare('SELECT COUNT(DISTINCT period)as c FROM quarterly_financials').get().c;
    const latest = db.prepare('SELECT MAX(period)as p FROM quarterly_financials').get().p;
    res.json({ total, tickers, periods, latest });
  } catch { res.json({ total: 0, tickers: 0, periods: 0 }); }
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
