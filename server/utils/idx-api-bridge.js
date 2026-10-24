/**
 * IDX-API Bridge Import for Banyu Langit
 * V2: Chunked imports to prevent OOM on large tables (stock_summary 500K+, trading_ss 879K+)
 * 
 * Reads data from IDX-API Deno project's SQLite database (database.sqlite)
 * and upserts into Banyu Langit's trading.db
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const IDX_DB_PATHS = [
  // explicit override first: a checkout on another machine has its own IDX-API location
  ...(process.env.IDX_DB_PATH ? [process.env.IDX_DB_PATH] : []),
  path.join(__dirname, '..', '..', 'IDX-API-main', 'data', 'database.sqlite'),
  path.join(__dirname, '..', '..', '..', 'IDX-API-main', 'data', 'database.sqlite'),
  '/app/IDX-API-main/data/database.sqlite'
];

function findIdxDb() {
  for (const p of IDX_DB_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function openIdxDb() {
  const dbPath = findIdxDb();
  if (!dbPath) throw new Error('IDX-API database not found. Run Deno sync first. Searched: ' + IDX_DB_PATHS.join(', '));
  return new Database(dbPath, { readonly: true });
}

// ═══ CHUNK SIZE for large tables ═══
const CHUNK_SIZE = 50000;

/**
 * Import stock_summary → idx_daily (CHUNKED to prevent OOM)
 */
function importStockSummary(targetDb, options = {}) {
  const idxDb = openIdxDb();
  try {
    const dateFilter = options.date || '';
    const fromDate = options.from || '';
    const toDate = options.to || '';

    let whereSql = '';
    const params = [];

    if (dateFilter) {
      const d = new Date(dateFilter + 'T00:00:00Z');
      const dayStart = d.getTime() - 7 * 3600000;
      const dayEnd = dayStart + 86400000;
      whereSql = ` WHERE date >= ? AND date < ?`;
      params.push(dayStart, dayEnd);
    } else if (fromDate && toDate) {
      const dFrom = new Date(fromDate + 'T00:00:00Z').getTime() - 7 * 3600000;
      const dTo = new Date(toDate + 'T00:00:00Z').getTime() - 7 * 3600000 + 86400000;
      whereSql = ` WHERE date >= ? AND date < ?`;
      params.push(dFrom, dTo);
    }

    // Count first
    const total = idxDb.prepare(`SELECT COUNT(*) as c FROM stock_summary${whereSql}`).get(...params)?.c || 0;
    if (!total) return { rows: 0, message: 'No data in IDX-API database for this range' };

    const upsert = targetDb.prepare(`INSERT INTO idx_daily(trade_date,code,name,prev_close,open_price,high,low,close,change,volume,value,frequency,bid,bid_vol,offer,offer_vol,listed_shares,tradeable_shares,foreign_buy,foreign_sell)
      VALUES(@trade_date,@code,@name,@prev_close,@open_price,@high,@low,@close,@change,@volume,@value,@frequency,@bid,@bid_vol,@offer,@offer_vol,@listed_shares,@tradeable_shares,@foreign_buy,@foreign_sell)
      ON CONFLICT(trade_date,code) DO UPDATE SET name=excluded.name,prev_close=excluded.prev_close,open_price=excluded.open_price,high=excluded.high,low=excluded.low,close=excluded.close,change=excluded.change,volume=excluded.volume,value=excluded.value,frequency=excluded.frequency,bid=excluded.bid,bid_vol=excluded.bid_vol,offer=excluded.offer,offer_vol=excluded.offer_vol,listed_shares=excluded.listed_shares,tradeable_shares=excluded.tradeable_shares,foreign_buy=excluded.foreign_buy,foreign_sell=excluded.foreign_sell`);

    let count = 0;
    let offset = 0;

    while (offset < total) {
      const rows = idxDb.prepare(`SELECT * FROM stock_summary${whereSql} LIMIT ${CHUNK_SIZE} OFFSET ${offset}`).all(...params);
      if (!rows.length) break;

      targetDb.transaction(() => {
        for (const r of rows) {
          const td = epochToDate(r.date);
          if (!td || !r.code) continue;
          upsert.run({
            trade_date: td,
            code: String(r.code || '').trim(),
            name: String(r.name || '').trim(),
            prev_close: r.previous || 0,
            open_price: r.open || 0,
            high: r.high || 0,
            low: r.low || 0,
            close: r.close || 0,
            change: r.change || 0,
            volume: r.volume || 0,
            value: r.value || 0,
            frequency: r.frequency || 0,
            bid: r.bid || 0,
            bid_vol: r.bid_volume || 0,
            offer: r.offer || 0,
            offer_vol: r.offer_volume || 0,
            listed_shares: r.listed_shares || 0,
            tradeable_shares: r.tradable_shares || 0,
            foreign_buy: r.foreign_buy || 0,
            foreign_sell: r.foreign_sell || 0
          });
          count++;
        }
      })();

      offset += rows.length;
      if (total > CHUNK_SIZE) console.log(`[bridge] stock_summary: ${count}/${total} rows imported`);
    }

    return { rows: count };
  } finally {
    idxDb.close();
  }
}

/**
 * Import index_summary → idx_indices
 */
function importIndexSummary(targetDb, options = {}) {
  const idxDb = openIdxDb();
  try {
    let sql = `SELECT * FROM index_summary WHERE 1=1`;
    const params = [];

    if (options.date) {
      const d = new Date(options.date + 'T00:00:00Z');
      const dayStart = d.getTime() - 7 * 3600000;
      const dayEnd = dayStart + 86400000;
      sql += ` AND date >= ? AND date < ?`;
      params.push(dayStart, dayEnd);
    } else if (options.from && options.to) {
      const dFrom = new Date(options.from + 'T00:00:00Z').getTime() - 7 * 3600000;
      const dTo = new Date(options.to + 'T00:00:00Z').getTime() - 7 * 3600000 + 86400000;
      sql += ` AND date >= ? AND date < ?`;
      params.push(dFrom, dTo);
    }

    const rows = idxDb.prepare(sql).all(...params);
    if (!rows.length) return { rows: 0, message: 'No index data' };

    const upsert = targetDb.prepare(`INSERT INTO idx_indices(trade_date,index_code,previous,highest,lowest,close,change_val,volume,value,frequency,market_cap)
      VALUES(@trade_date,@index_code,@previous,@highest,@lowest,@close,@change_val,@volume,@value,@frequency,@market_cap)
      ON CONFLICT(trade_date,index_code) DO UPDATE SET previous=excluded.previous,highest=excluded.highest,lowest=excluded.lowest,close=excluded.close,change_val=excluded.change_val,volume=excluded.volume,value=excluded.value,frequency=excluded.frequency,market_cap=excluded.market_cap`);

    let count = 0;
    targetDb.transaction(() => {
      for (const r of rows) {
        const td = epochToDate(r.date);
        if (!td || !r.code) continue;
        upsert.run({
          trade_date: td, index_code: String(r.code || '').trim(),
          previous: r.previous || 0, highest: r.high || 0, lowest: r.low || 0,
          close: r.close || 0, change_val: r.change || 0,
          volume: r.volume || 0, value: r.value || 0, frequency: r.frequency || 0, market_cap: r.market_cap || 0
        });
        count++;
      }
    })();

    return { rows: count };
  } finally {
    idxDb.close();
  }
}

/**
 * @deprecated DO NOT USE — replaced by importFinancialRatiosFull().
 *
 * It was wrong twice over, and both defects were silent:
 *   1. Target table: it wrote to `idx_fundamental` (keyed `(snapshot_month, code)`),
 *      not to `financial_ratios` (keyed `(code, period)`).
 *   2. Month key: it read `r.year` / `r.month`, columns that DO NOT EXIST in IDX-API's
 *      `financial_ratio` table (cols: id, code, name, sector, sub_sector, industry,
 *      sub_industry, period, assets, liabilities, equity, sales, ebt, profit, eps,
 *      book_value, per, pbv, der, roa, roe, npm). So the expression always fell through
 *      to the current month and all 19,373 quarterly rows were handed the SAME
 *      `snapshot_month`. Under `ON CONFLICT(snapshot_month, code)` they collapsed to
 *      ~1,000 rows of mixed quarterly vintages — while clobbering the correct
 *      stock_screener snapshot for that month and leaving orphan rows for codes that
 *      are not in the screener.
 *   Its `rows` also counted rows PROCESSED, so `{"ok":true,"rows":19373}` was a false
 *   success signal: it reported work that had not landed where the caller expected.
 *
 * Kept as an inert stub (not deleted) so the existing callers — `import-all` and
 * deno-proxy's `runBridgeImport` — cannot pollute `idx_fundamental` again, and so no
 * caller crashes with a TypeError. `idx_fundamental`'s current-month snapshot is owned
 * by importStockScreener() (stock_screener is the correct source for it).
 */
function importFinancialRatios(_targetDb) {
  console.warn('[bridge] importFinancialRatios() is DEPRECATED and no longer writes anything. ' +
    'Use importFinancialRatiosFull() (→ financial_ratios, keyed (code, period)) for quarterly ' +
    'ratios; idx_fundamental is owned by importStockScreener().');
  return {
    rows: 0, changes: 0, persisted: 0, inserted: 0,
    deprecated: true, replaced_by: 'importFinancialRatiosFull',
    note: 'no-op: previous behaviour wrote quarterly rows into idx_fundamental under the current month'
  };
}

function importStockScreener(targetDb) {
  const idxDb = openIdxDb();
  try {
    const rows = idxDb.prepare(`SELECT * FROM stock_screener`).all();
    if (!rows.length) return { rows: 0 };
    const now = new Date();
    const snapshotMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const upsert = targetDb.prepare(`INSERT INTO idx_fundamental(snapshot_month,code,name,sector,subsector,industry,subindustry,per,pbv,roe,roa,der,npm,mkt_cap,total_rev,chg_4w,chg_13w,chg_26w,chg_52w,mtd,ytd)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(snapshot_month,code) DO UPDATE SET name=excluded.name,sector=excluded.sector,subsector=excluded.subsector,industry=excluded.industry,subindustry=excluded.subindustry,per=excluded.per,pbv=excluded.pbv,roe=excluded.roe,roa=excluded.roa,der=excluded.der,npm=excluded.npm,mkt_cap=excluded.mkt_cap,total_rev=excluded.total_rev,chg_4w=excluded.chg_4w,chg_13w=excluded.chg_13w,chg_26w=excluded.chg_26w,chg_52w=excluded.chg_52w,mtd=excluded.mtd,ytd=excluded.ytd`);
    let count = 0;
    targetDb.transaction(() => {
      for (const r of rows) {
        if (!r.stock_code && !r.code) continue;
        const code = String(r.stock_code || r.code || '').trim();
        upsert.run(snapshotMonth, code, r.company_name || r.name || '',
          r.sector || '', r.sub_sector || '', r.industry || '', r.sub_industry || '',
          r.per || 0, r.pbv || 0, r.roe || 0, r.roa || 0, r.der || 0, r.npm || 0,
          r.market_capital || r.mkt_cap || 0, r.t_revenue || r.total_rev || 0,
          r.week_4_pc || r.chg_4w || 0, r.week_13_pc || r.chg_13w || 0,
          r.week_26_pc || r.chg_26w || 0, r.week_52_pc || r.chg_52w || 0,
          r.mtdpc || r.mtd || 0, r.ytdpc || r.ytd || 0);
        count++;
      }
    })();
    return { rows: count, snapshot_month: snapshotMonth };
  } finally { idxDb.close(); }
}

function importDividends(targetDb) {
  const idxDb = openIdxDb();
  try {
    const rows = idxDb.prepare(`SELECT * FROM company_dividend`).all();
    if (!rows.length) return { rows: 0 };
    const ins = targetDb.prepare(`INSERT INTO dividends(code,ex_date,cash_dividend,cum_date,record_date,payment_date,name)
      VALUES(@code,@ex_date,@cash_dividend,@cum_date,@record_date,@payment_date,@name)
      ON CONFLICT(code,ex_date) DO UPDATE SET cash_dividend=excluded.cash_dividend,cum_date=excluded.cum_date,record_date=excluded.record_date,payment_date=excluded.payment_date,name=excluded.name`);
    let count = 0;
    targetDb.transaction(() => {
      for (const r of rows) {
        if (!r.code) continue;
        ins.run({ code: String(r.code || '').trim(), ex_date: epochToDate(r.ex_dividend) || '', cash_dividend: r.cash_dividend || 0, cum_date: epochToDate(r.cum_dividend) || '', record_date: epochToDate(r.record_date) || '', payment_date: epochToDate(r.payment_date) || '', name: String(r.name || '').trim() });
        count++;
      }
    })();
    return { rows: count };
  } finally { idxDb.close(); }
}

function importStockSplits(targetDb) {
  const idxDb = openIdxDb();
  try {
    const rows = idxDb.prepare(`SELECT * FROM stock_split`).all();
    if (!rows.length) return { rows: 0 };
    const ins = targetDb.prepare(`INSERT INTO corporate_actions(code,ex_date,action_type,ratio,new_shares,notes,status)
      VALUES(@code,@ex_date,@action_type,@ratio,@new_shares,@notes,'confirmed')
      ON CONFLICT(code,ex_date) DO UPDATE SET action_type=excluded.action_type,ratio=excluded.ratio,new_shares=excluded.new_shares,notes=excluded.notes`);
    let count = 0;
    targetDb.transaction(() => {
      for (const r of rows) {
        if (!r.code) continue;
        let ratio = 1;
        const ratioStr = String(r.ratio || '');
        const parts = ratioStr.split(':');
        if (parts.length === 2) { ratio = (parseInt(parts[1]) || 1) / (parseInt(parts[0]) || 1); }
        const actionType = String(r.ssrs || 'split').toLowerCase().includes('reverse') ? 'reverse_split' : 'split';
        ins.run({ code: String(r.code || '').trim(), ex_date: epochToDate(r.listing_date) || '', action_type: actionType, ratio, new_shares: r.listed_shares || 0, notes: `${r.ssrs || ''} ratio=${ratioStr}` });
        count++;
      }
    })();
    return { rows: count };
  } finally { idxDb.close(); }
}

function importCompanyProfiles(targetDb) {
  const idxDb = openIdxDb();
  try {
    const rows = idxDb.prepare(`SELECT * FROM company_profile`).all();
    if (!rows.length) return { rows: 0 };
    const ins = targetDb.prepare(`INSERT INTO company_profiles(code,name,listing_date,updated_at) VALUES(?,?,?,datetime('now'))
      ON CONFLICT(code) DO UPDATE SET name=excluded.name,listing_date=excluded.listing_date,updated_at=datetime('now')`);
    let count = 0;
    targetDb.transaction(() => {
      for (const r of rows) {
        if (!r.code) continue;
        ins.run(String(r.code).trim(), String(r.name || '').trim(), r.listing_date ? epochToDate(r.listing_date) : '');
        count++;
      }
    })();
    return { rows: count };
  } finally { idxDb.close(); }
}

function importCompanyDetails(targetDb) {
  const idxDb = openIdxDb();
  try {
    const rows = idxDb.prepare(`SELECT * FROM company_detail`).all();
    if (!rows.length) return { rows: 0 };
    try { targetDb.exec("ALTER TABLE company_profiles ADD COLUMN sector TEXT DEFAULT ''"); } catch {}
    try { targetDb.exec("ALTER TABLE company_profiles ADD COLUMN sub_sector TEXT DEFAULT ''"); } catch {}
    try { targetDb.exec("ALTER TABLE company_profiles ADD COLUMN industry TEXT DEFAULT ''"); } catch {}
    try { targetDb.exec("ALTER TABLE company_profiles ADD COLUMN sub_industry TEXT DEFAULT ''"); } catch {}
    try { targetDb.exec("ALTER TABLE company_profiles ADD COLUMN board TEXT DEFAULT ''"); } catch {}
    try { targetDb.exec("ALTER TABLE company_profiles ADD COLUMN address TEXT DEFAULT ''"); } catch {}
    try { targetDb.exec("ALTER TABLE company_profiles ADD COLUMN website TEXT DEFAULT ''"); } catch {}
    try { targetDb.exec("ALTER TABLE company_profiles ADD COLUMN email TEXT DEFAULT ''"); } catch {}
    try { targetDb.exec("ALTER TABLE company_profiles ADD COLUMN phone TEXT DEFAULT ''"); } catch {}
    const ins = targetDb.prepare(`INSERT INTO company_profiles(code,sector,sub_sector,industry,sub_industry,board,address,website,email,phone,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(code) DO UPDATE SET sector=excluded.sector,sub_sector=excluded.sub_sector,industry=excluded.industry,sub_industry=excluded.sub_industry,board=excluded.board,address=excluded.address,website=excluded.website,email=excluded.email,phone=excluded.phone,updated_at=datetime('now')`);
    let count = 0;
    targetDb.transaction(() => {
      for (const r of rows) {
        if (!r.code) continue;
        ins.run(String(r.code).trim(), String(r.sector || '').trim(), String(r.sub_sector || '').trim(),
          String(r.industry || '').trim(), String(r.sub_industry || '').trim(), String(r.board || '').trim(),
          String(r.address || '').substring(0, 200).trim(), String(r.website || '').trim(),
          String(r.email || '').trim(), String(r.phone || '').trim());
        count++;
      }
    })();
    return { rows: count };
  } finally { idxDb.close(); }
}

function getIdxApiStatus() {
  try {
    const idxDb = openIdxDb();
    try {
      const tables = idxDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r => r.name);
      const counts = {};
      for (const t of ['stock_summary', 'index_summary', 'financial_ratio', 'stock_screener', 'company_dividend', 'stock_split', 'company_profile']) {
        try { counts[t] = idxDb.prepare(`SELECT COUNT(*) as c FROM ${t}`).get()?.c || 0; } catch { counts[t] = 0; }
      }
      let stockDateRange = {};
      try {
        const min = idxDb.prepare('SELECT MIN(date) as d FROM stock_summary').get()?.d;
        const max = idxDb.prepare('SELECT MAX(date) as d FROM stock_summary').get()?.d;
        stockDateRange = { first: epochToDate(min), last: epochToDate(max) };
      } catch {}
      return { ok: true, tables, counts, stock_dates: stockDateRange, db_path: findIdxDb() };
    } finally { idxDb.close(); }
  } catch (e) { return { ok: false, error: e.message }; }
}

// ═══ Helpers ═══

function epochToDate(epoch) {
  if (!epoch) return '';
  const ms = typeof epoch === 'number' ? epoch : parseInt(epoch);
  if (isNaN(ms)) return '';
  const d = new Date(ms + 7 * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isoToDate(s) {
  if (!s) return '';
  if (typeof s === 'number') return epochToDate(s);
  if (typeof s === 'string' && s.includes('T')) return s.slice(0, 10);
  return String(s).slice(0, 10);
}

/**
 * Generic CHUNKED bulk import — prevents OOM on large tables
 */
function bulkImport(targetDb, srcTable, upsertSql, mapFn) {
  const idxDb = openIdxDb();
  try {
    const total = idxDb.prepare(`SELECT COUNT(*) as c FROM ${srcTable}`).get()?.c || 0;
    if (!total) return { rows: 0 };

    const stmt = targetDb.prepare(upsertSql);
    let count = 0;      // rows passed to the upsert (attempted writes)
    let changes = 0;    // rows the engine actually reported as written (insert OR update)
    let offset = 0;

    while (offset < total) {
      const rows = idxDb.prepare(`SELECT * FROM ${srcTable} LIMIT ${CHUNK_SIZE} OFFSET ${offset}`).all();
      if (!rows.length) break;

      targetDb.transaction(() => {
        for (const r of rows) {
          const mapped = mapFn(r);
          if (!mapped) continue;
          const info = stmt.run(mapped);
          changes += info?.changes || 0;
          count++;
        }
      })();

      offset += rows.length;
      if (total > CHUNK_SIZE) console.log(`[bridge] ${srcTable}: ${count}/${total} rows imported`);
    }

    // `rows` = attempted, `changes` = written. Callers that report "success" from `rows`
    // alone cannot tell "processed but not stored" from "stored" — return both.
    return { rows: count, changes };
  } finally {
    idxDb.close();
  }
}

// ═══ Sprint 8.2: Bridge import functions ═══

function importBrokerSummary(targetDb) {
  return bulkImport(targetDb, 'broker_summary',
    `INSERT INTO broker_summary(trade_date,broker_code,broker_name,total_value,volume,frequency)
     VALUES(@trade_date,@broker_code,@broker_name,@total_value,@volume,@frequency)
     ON CONFLICT(trade_date,broker_code) DO UPDATE SET broker_name=excluded.broker_name,total_value=excluded.total_value,volume=excluded.volume,frequency=excluded.frequency`,
    r => { const td = epochToDate(r.date); if (!td || !r.broker_code) return null; return { trade_date: td, broker_code: r.broker_code, broker_name: r.broker_name || '', total_value: r.total_value || 0, volume: r.volume || 0, frequency: r.frequency || 0 }; });
}

function importMarketCalendar(targetDb) {
  return bulkImport(targetDb, 'market_calendar',
    `INSERT INTO market_calendar(cal_date,code,type,description) VALUES(@cal_date,@code,@type,@description)
     ON CONFLICT(cal_date,code,description) DO NOTHING`,
    r => { const d = epochToDate(r.date); if (!d) return null; return { cal_date: d, code: r.code || '', type: r.type || '', description: (r.description || '').slice(0, 200) }; });
}

function importCompanyAnnouncement(targetDb) {
  return bulkImport(targetDb, 'company_announcement',
    `INSERT INTO company_announcements(ann_id,ann_date,title,type,company_code,subject,is_stock,is_bond,attachments)
     VALUES(@ann_id,@ann_date,@title,@type,@company_code,@subject,@is_stock,@is_bond,@attachments)
     ON CONFLICT(ann_id) DO UPDATE SET title=excluded.title,type=excluded.type,attachments=excluded.attachments`,
    r => { if (!r.id) return null; return { ann_id: String(r.id), ann_date: epochToDate(r.date) || isoToDate(r.date), title: (r.title || '').slice(0, 300), type: r.type || '', company_code: r.company_code || '', subject: (r.subject || '').slice(0, 200), is_stock: r.is_stock || 0, is_bond: r.is_bond || 0, attachments: r.attachments || '' }; });
}

function importDomesticTrading(targetDb) {
  return bulkImport(targetDb, 'domestic_trading',
    `INSERT INTO domestic_trading(trade_date,buy_volume,buy_value,buy_frequency,sell_volume,sell_value,sell_frequency)
     VALUES(@trade_date,@buy_volume,@buy_value,@buy_frequency,@sell_volume,@sell_value,@sell_frequency)
     ON CONFLICT(trade_date) DO UPDATE SET buy_volume=excluded.buy_volume,buy_value=excluded.buy_value,buy_frequency=excluded.buy_frequency,sell_volume=excluded.sell_volume,sell_value=excluded.sell_value,sell_frequency=excluded.sell_frequency`,
    r => { const td = epochToDate(r.date); if (!td) return null; return { trade_date: td, buy_volume: r.buy_volume || 0, buy_value: r.buy_value || 0, buy_frequency: r.buy_frequency || 0, sell_volume: r.sell_volume || 0, sell_value: r.sell_value || 0, sell_frequency: r.sell_frequency || 0 }; });
}

function importIndustryTrading(targetDb) {
  return bulkImport(targetDb, 'industry_trading',
    `INSERT INTO industry_trading(trade_date,industry,members,shares,market_cap,volume,value,frequency,per,pbv)
     VALUES(@trade_date,@industry,@members,@shares,@market_cap,@volume,@value,@frequency,@per,@pbv)
     ON CONFLICT(trade_date,industry) DO UPDATE SET members=excluded.members,shares=excluded.shares,market_cap=excluded.market_cap,volume=excluded.volume,value=excluded.value,frequency=excluded.frequency,per=excluded.per,pbv=excluded.pbv`,
    r => { const td = epochToDate(r.date); if (!td || !r.industry) return null; return { trade_date: td, industry: r.industry, members: r.members || 0, shares: r.shares || 0, market_cap: r.market_cap || 0, volume: r.volume || 0, value: r.value || 0, frequency: r.frequency || 0, per: r.per || 0, pbv: r.pbv || 0 }; });
}

function importDailyIndex(targetDb) {
  return bulkImport(targetDb, 'daily_index',
    `INSERT INTO daily_index(trade_date,index_name,close) VALUES(@trade_date,@index_name,@close)
     ON CONFLICT(trade_date,index_name) DO UPDATE SET close=excluded.close`,
    r => { const td = epochToDate(r.date); if (!td || !r.name) return null; return { trade_date: td, index_name: r.name, close: r.close || 0 }; });
}

function importTopMovers(targetDb) {
  const idxDb = openIdxDb();
  try {
    let count = 0;
    const stmt = targetDb.prepare(`INSERT INTO top_movers(period,mover_type,code,name,previous,close,change,percentage)
      VALUES(@period,@mover_type,@code,@name,@previous,@close,@change,@percentage)
      ON CONFLICT(period,mover_type,code) DO UPDATE SET name=excluded.name,previous=excluded.previous,close=excluded.close,change=excluded.change,percentage=excluded.percentage`);
    targetDb.transaction(() => {
      for (const [table, type] of [['top_gainer', 'gainer'], ['top_loser', 'loser']]) {
        try {
          const rows = idxDb.prepare(`SELECT * FROM ${table}`).all();
          for (const r of rows) {
            if (!r.code) continue;
            stmt.run({ period: epochToDate(r.period) || '', mover_type: type, code: r.code, name: r.name || '', previous: r.previous || 0, close: r.close || 0, change: r.change || 0, percentage: r.percentage || 0 });
            count++;
          }
        } catch {}
      }
    })();
    return { rows: count };
  } finally { idxDb.close(); }
}

function importActiveStocks(targetDb) {
  const idxDb = openIdxDb();
  try {
    let count = 0;
    const stmt = targetDb.prepare(`INSERT INTO active_stocks(period,active_type,code,name,volume,value,frequency,volume_pct,value_pct,frequency_pct)
      VALUES(@period,@active_type,@code,@name,@volume,@value,@frequency,@volume_pct,@value_pct,@frequency_pct)
      ON CONFLICT(period,active_type,code) DO UPDATE SET name=excluded.name,volume=excluded.volume,value=excluded.value,frequency=excluded.frequency,volume_pct=excluded.volume_pct,value_pct=excluded.value_pct,frequency_pct=excluded.frequency_pct`);
    targetDb.transaction(() => {
      for (const [table, type] of [['active_volume', 'volume'], ['active_value', 'value'], ['active_frequency', 'frequency']]) {
        try {
          const rows = idxDb.prepare(`SELECT * FROM ${table}`).all();
          for (const r of rows) {
            if (!r.code) continue;
            stmt.run({ period: epochToDate(r.period) || '', active_type: type, code: r.code, name: r.name || '', volume: r.volume || 0, value: r.value || 0, frequency: r.frequency || 0, volume_pct: r.volume_percent || 0, value_pct: r.value_percent || 0, frequency_pct: r.frequency_percent || 0 });
            count++;
          }
        } catch {}
      }
    })();
    return { rows: count };
  } finally { idxDb.close(); }
}

function importCompanySuspend(targetDb) {
  return bulkImport(targetDb, 'company_suspend',
    `INSERT INTO company_suspends(code,title,suspend_date,type) VALUES(@code,@title,@suspend_date,@type)
     ON CONFLICT(code,suspend_date,type) DO UPDATE SET title=excluded.title`,
    r => { if (!r.code) return null; return { code: r.code, title: (r.title || '').slice(0, 200), suspend_date: epochToDate(r.date) || '', type: r.type || '' }; });
}

function importRightOfferings(targetDb) {
  return bulkImport(targetDb, 'right_offering',
    `INSERT INTO right_offerings(code,name,ratio,exercise_price,fund_raised,exercise_date,recording_date,trading_period,period)
     VALUES(@code,@name,@ratio,@exercise_price,@fund_raised,@exercise_date,@recording_date,@trading_period,@period)
     ON CONFLICT(code,recording_date) DO UPDATE SET name=excluded.name,ratio=excluded.ratio,exercise_price=excluded.exercise_price,fund_raised=excluded.fund_raised`,
    r => { if (!r.code) return null; return { code: r.code, name: r.name || '', ratio: r.ratio || '', exercise_price: r.exercise_price || 0, fund_raised: r.fund_raised || 0, exercise_date: epochToDate(r.exercise_date) || '', recording_date: epochToDate(r.recording_date) || '', trading_period: r.trading_period || '', period: epochToDate(r.period) || '' }; });
}

function importParticipantBrokers(targetDb) {
  return bulkImport(targetDb, 'participant_broker',
    `INSERT INTO participant_brokers(code,name,license) VALUES(@code,@name,@license)
     ON CONFLICT(code) DO UPDATE SET name=excluded.name,license=excluded.license`,
    r => { if (!r.code) return null; return { code: r.code, name: r.name || '', license: r.license || '' }; });
}

function importTradingSS(targetDb) {
  return bulkImport(targetDb, 'trading_ss',
    `INSERT INTO trading_ss(trade_date,code,name,previous,open_price,high,low,close,change,volume,value,frequency,listed_shares,tradeable_shares)
     VALUES(@trade_date,@code,@name,@previous,@open_price,@high,@low,@close,@change,@volume,@value,@frequency,@listed_shares,@tradeable_shares)
     ON CONFLICT(trade_date,code) DO UPDATE SET name=excluded.name,previous=excluded.previous,open_price=excluded.open_price,high=excluded.high,low=excluded.low,close=excluded.close,change=excluded.change,volume=excluded.volume,value=excluded.value,frequency=excluded.frequency`,
    r => { const td = isoToDate(r.date); if (!td || !r.code) return null; return { trade_date: td, code: r.code, name: r.name || '', previous: r.previous || 0, open_price: r.open || 0, high: r.high || 0, low: r.low || 0, close: r.close || 0, change: r.change || 0, volume: r.volume || 0, value: r.value || 0, frequency: r.frequency || 0, listed_shares: r.listed_shares || 0, tradeable_shares: r.tradable_shares || 0 }; });
}

function importTradingDaily(targetDb) {
  return bulkImport(targetDb, 'trading_daily',
    `INSERT INTO trading_daily(code,board,previous,open_price,high,low,close,change,volume,value,frequency,foreign_shares,updated_at)
     VALUES(@code,@board,@previous,@open_price,@high,@low,@close,@change,@volume,@value,@frequency,@foreign_shares,@updated_at)
     ON CONFLICT(code,board) DO UPDATE SET previous=excluded.previous,open_price=excluded.open_price,high=excluded.high,low=excluded.low,close=excluded.close,change=excluded.change,volume=excluded.volume,value=excluded.value,frequency=excluded.frequency,foreign_shares=excluded.foreign_shares,updated_at=excluded.updated_at`,
    r => { if (!r.code) return null; return { code: r.code, board: r.board || '', previous: r.previous || 0, open_price: r.open || 0, high: r.high || 0, low: r.low || 0, close: r.close || 0, change: r.change || 0, volume: r.volume || 0, value: r.value || 0, frequency: r.frequency || 0, foreign_shares: r.foreign_shares || 0, updated_at: r.updated_at || '' }; });
}

function importIndexChart(targetDb) {
  return bulkImport(targetDb, 'index_chart',
    `INSERT INTO index_chart(index_code,chart_date,value) VALUES(@index_code,@chart_date,@value)
     ON CONFLICT(index_code,chart_date) DO UPDATE SET value=excluded.value`,
    r => { const d = epochToDate(r.date); if (!d || !r.code) return null; return { index_code: r.code, chart_date: d, value: r.value || 0 }; });
}

function importIndexList(targetDb) {
  return bulkImport(targetDb, 'index_list',
    `INSERT INTO index_list(code,close,change,percent,current,updated_at) VALUES(@code,@close,@change,@percent,@current,datetime('now'))
     ON CONFLICT(code) DO UPDATE SET close=excluded.close,change=excluded.change,percent=excluded.percent,current=excluded.current,updated_at=datetime('now')`,
    r => { if (!r.code) return null; return { code: r.code, close: String(r.close || ''), change: String(r.change || ''), percent: String(r.percent || ''), current: String(r.current || '') }; });
}

function importFinancialReports(targetDb) {
  return bulkImport(targetDb, 'financial_report',
    `INSERT INTO financial_reports(code,name,year,period,attachments) VALUES(@code,@name,@year,@period,@attachments)
     ON CONFLICT(code,year,period) DO UPDATE SET name=excluded.name,attachments=excluded.attachments`,
    r => { if (!r.code) return null; return { code: r.code, name: r.name || '', year: r.year || 0, period: r.period || '', attachments: (r.attachments || '').slice(0, 1000) }; });
}

function importIssuedHistory(targetDb) {
  return bulkImport(targetDb, 'issued_history',
    `INSERT INTO issued_history(code,issue_date,type,shares,total_shares) VALUES(@code,@issue_date,@type,@shares,@total_shares)
     ON CONFLICT(code,issue_date,type) DO UPDATE SET shares=excluded.shares,total_shares=excluded.total_shares`,
    r => { if (!r.code) return null; return { code: r.code, issue_date: isoToDate(r.date) || '', type: r.type || '', shares: r.shares || 0, total_shares: r.total_shares || 0 }; });
}

function importAdditionalListings(targetDb) {
  return bulkImport(targetDb, 'additional_listing',
    `INSERT INTO additional_listings(code,name,shares,type,start_date,last_date,period) VALUES(@code,@name,@shares,@type,@start_date,@last_date,@period)
     ON CONFLICT(code,start_date,type) DO UPDATE SET name=excluded.name,shares=excluded.shares,last_date=excluded.last_date`,
    r => { if (!r.code) return null; return { code: r.code, name: r.name || '', shares: r.shares || 0, type: r.type || '', start_date: epochToDate(r.start_date) || '', last_date: epochToDate(r.last_date) || '', period: epochToDate(r.period) || '' }; });
}

function importNewListings(targetDb) {
  return bulkImport(targetDb, 'new_listing',
    `INSERT INTO new_listings(code,name,listed_shares,offering_shares,offering_price,fund_raised,listing_date,period) VALUES(@code,@name,@listed_shares,@offering_shares,@offering_price,@fund_raised,@listing_date,@period)
     ON CONFLICT(code) DO UPDATE SET name=excluded.name,listed_shares=excluded.listed_shares,offering_shares=excluded.offering_shares,offering_price=excluded.offering_price,fund_raised=excluded.fund_raised,listing_date=excluded.listing_date`,
    r => { if (!r.code) return null; return { code: r.code, name: r.name || '', listed_shares: r.listed_shares || 0, offering_shares: r.offering_shares || 0, offering_price: r.offering_price || 0, fund_raised: r.fund_raised || 0, listing_date: epochToDate(r.listing_date) || '', period: epochToDate(r.period) || '' }; });
}

function importSecurityStocks(targetDb) {
  return bulkImport(targetDb, 'security_stock',
    `INSERT INTO security_stocks(code,name,shares,listing_board,listing_date) VALUES(@code,@name,@shares,@listing_board,@listing_date)
     ON CONFLICT(code) DO UPDATE SET name=excluded.name,shares=excluded.shares,listing_board=excluded.listing_board,listing_date=excluded.listing_date`,
    r => { if (!r.code) return null; return { code: r.code, name: r.name || '', shares: r.shares || 0, listing_board: r.listing_board || '', listing_date: epochToDate(r.listing_date) || '' }; });
}

function importCompanyDelistings(targetDb) {
  return bulkImport(targetDb, 'company_delisting',
    `INSERT INTO company_delistings(code,name,listed_shares,market_cap,regular_price,listing_date,delisting_date) VALUES(@code,@name,@listed_shares,@market_cap,@regular_price,@listing_date,@delisting_date)
     ON CONFLICT(code,delisting_date) DO UPDATE SET name=excluded.name`,
    r => { if (!r.code) return null; return { code: r.code, name: r.name || '', listed_shares: r.listed_shares || 0, market_cap: r.market_cap || 0, regular_price: r.regular_price || 0, listing_date: epochToDate(r.listing_date) || '', delisting_date: epochToDate(r.delisting_date) || '' }; });
}

function importCompanyRelistings(targetDb) {
  return bulkImport(targetDb, 'company_relisting',
    `INSERT INTO company_relistings(code,name,listing_date) VALUES(@code,@name,@listing_date)
     ON CONFLICT(code) DO UPDATE SET name=excluded.name,listing_date=excluded.listing_date`,
    r => { if (!r.code) return null; return { code: r.code, name: r.name || '', listing_date: epochToDate(r.listing_date) || '' }; });
}

function importProfileAnnouncements(targetDb) {
  return bulkImport(targetDb, 'profile_announcement',
    `INSERT INTO profile_announcements(ann_id,ann_date,title,attachments) VALUES(@ann_id,@ann_date,@title,@attachments)
     ON CONFLICT(ann_id) DO UPDATE SET title=excluded.title`,
    r => { if (!r.id) return null; return { ann_id: String(r.id), ann_date: isoToDate(r.date) || '', title: (r.title || '').slice(0, 300), attachments: (r.attachments || '').slice(0, 1000) }; });
}

function importParticipantDealers(targetDb) {
  return bulkImport(targetDb, 'participant_dealer',
    `INSERT INTO participant_dealers(code,name,license,is_primary) VALUES(@code,@name,@license,@is_primary)
     ON CONFLICT(code) DO UPDATE SET name=excluded.name,license=excluded.license,is_primary=excluded.is_primary`,
    r => { if (!r.code) return null; return { code: r.code, name: r.name || '', license: r.license || '', is_primary: r.is_primary || 0 }; });
}

function importParticipantProfiles(targetDb) {
  return bulkImport(targetDb, 'participant_profile',
    `INSERT INTO participant_profiles(code,name,license,is_primary) VALUES(@code,@name,@license,@is_primary)
     ON CONFLICT(code) DO UPDATE SET name=excluded.name,license=excluded.license,is_primary=excluded.is_primary`,
    r => { if (!r.code) return null; return { code: r.code, name: r.name || '', license: r.license || '', is_primary: r.is_primary || 0 }; });
}

function importTradeSummary(targetDb) {
  return bulkImport(targetDb, 'trade_summary',
    `INSERT INTO trade_summary(summary_id,trade_date,volume,value,frequency) VALUES(@summary_id,@trade_date,@volume,@value,@frequency)
     ON CONFLICT(trade_date,summary_id) DO UPDATE SET volume=excluded.volume,value=excluded.value,frequency=excluded.frequency`,
    r => { const td = epochToDate(r.date); return { summary_id: r.id || '', trade_date: td || '', volume: r.volume || 0, value: r.value || 0, frequency: r.frequency || 0 }; });
}

/**
 * Import financial_ratio → financial_ratios (quarterly, keyed (code, period)).
 *
 * Returns processed vs actually-persisted counts so "ok" can never mean
 * "processed but not stored":
 *   rows      — rows attempted (legacy field, kept for callers)
 *   changes   — rows the engine reported written (insert OR update)
 *   persisted — alias of `changes` (handoff contract name)
 *   inserted  — new rows this run added to financial_ratios (target count delta)
 *   total     — financial_ratios row count after the import
 * A healthy idempotent re-run is rows=19373, inserted=0, total=19373.
 */
function importFinancialRatiosFull(targetDb) {
  const countRows = () => targetDb.prepare('SELECT COUNT(*) AS c FROM financial_ratios').get().c;
  const before = countRows();
  const res = bulkImport(targetDb, 'financial_ratio',
    `INSERT INTO financial_ratios(code,name,sector,sub_sector,industry,sub_industry,period,assets,liabilities,equity,sales,ebt,profit,eps,book_value,per,pbv,der,roa,roe,npm)
     VALUES(@code,@name,@sector,@sub_sector,@industry,@sub_industry,@period,@assets,@liabilities,@equity,@sales,@ebt,@profit,@eps,@book_value,@per,@pbv,@der,@roa,@roe,@npm)
     ON CONFLICT(code,period) DO UPDATE SET name=excluded.name,assets=excluded.assets,liabilities=excluded.liabilities,equity=excluded.equity,sales=excluded.sales,ebt=excluded.ebt,profit=excluded.profit,eps=excluded.eps,book_value=excluded.book_value,per=excluded.per,pbv=excluded.pbv,der=excluded.der,roa=excluded.roa,roe=excluded.roe,npm=excluded.npm`,
    r => { if (!r.code) return null; return { code: r.code, name: r.name || '', sector: r.sector || '', sub_sector: r.sub_sector || '', industry: r.industry || '', sub_industry: r.sub_industry || '', period: epochToDate(r.period) || '', assets: r.assets || 0, liabilities: r.liabilities || 0, equity: r.equity || 0, sales: r.sales || 0, ebt: r.ebt || 0, profit: r.profit || 0, eps: r.eps || 0, book_value: r.book_value || 0, per: r.per || 0, pbv: r.pbv || 0, der: r.der || 0, roa: r.roa || 0, roe: r.roe || 0, npm: r.npm || 0 }; });

  const total = countRows();
  // `changes` is absent when the source table is empty (bulkImport returns {rows:0} early).
  return { ...res, persisted: res.changes ?? res.rows, inserted: total - before, total };
}

// ═══ Date-window helpers for stock_price_history (epoch ms at 00:00 UTC) ═══
const DAY_MS = 86400000;
const WIB_OFFSET_MS = 7 * 3600000;

/** 'YYYY-MM-DD' → epoch ms of that WIB trading day's start (importStockSummary's convention). */
function wibDayStart(day) {
  const d = new Date(String(day).slice(0, 10) + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  return d.getTime() - WIB_OFFSET_MS;
}

/**
 * Resolve the date window for an incremental stock_price_history import.
 *
 * Self-healing rule, not a fixed "last N days":
 *   to   = MAX(date) in stock_price_history            (source frontier)
 *   from = MAX(trade_date) in idx_daily − overlapDays  (target frontier)
 * A target that is already current only re-pulls the overlap tail (upstream
 * revises the last sessions); a target that fell behind closes the entire gap in
 * one call, because `from` follows the target's own frontier.
 *
 * Explicit `date` / `from`+`to` override the rule; `full` bypasses it entirely.
 * Returns { from, to, start, end } with start === null meaning "no date filter".
 */
function resolvePriceWindow(idxDb, targetDb, options = {}) {
  const src = idxDb.prepare('SELECT MIN(date) AS mn, MAX(date) AS mx FROM stock_price_history').get();
  if (!src || !src.mn) throw new Error('stock_price_history is empty in IDX-API');
  const srcFirst = epochToDate(src.mn);
  const srcLast = epochToDate(src.mx);

  const single = options.date ? String(options.date).slice(0, 10) : null;
  if (single) {
    const s = wibDayStart(single);
    if (s === null) throw new Error(`Invalid date "${options.date}" (expected YYYY-MM-DD)`);
    return { from: single, to: single, start: s, end: s + DAY_MS };
  }

  const explicitFrom = options.from ? String(options.from).slice(0, 10) : null;
  const explicitTo = options.to ? String(options.to).slice(0, 10) : null;
  if (explicitFrom || explicitTo) {
    const from = explicitFrom || srcFirst;
    const to = explicitTo || srcLast;
    const s = wibDayStart(from), e = wibDayStart(to);
    if (s === null || e === null) throw new Error(`Invalid from/to ("${from}".."${to}"; expected YYYY-MM-DD)`);
    if (e < s) throw new Error(`from (${from}) must not be after to (${to})`);
    return { from, to, start: s, end: e + DAY_MS };
  }

  const overlapDays = Number.isFinite(Number(options.overlapDays)) ? Math.max(0, Number(options.overlapDays)) : 7;
  const tgt = targetDb.prepare('SELECT MAX(trade_date) AS mx FROM idx_daily').get();
  const end = wibDayStart(srcLast) + DAY_MS;
  let start = wibDayStart(srcFirst);
  if (tgt && tgt.mx) {
    const tgtStart = wibDayStart(tgt.mx);
    if (tgtStart !== null) start = Math.max(start, tgtStart - overlapDays * DAY_MS);
  }
  // Target is at or ahead of the source frontier: still refresh the last source day.
  if (start >= end) start = wibDayStart(srcLast);
  return { from: epochToDate(start), to: srcLast, start, end };
}

/**
 * Import stock_price_history → idx_daily (daily OHLCV series).
 * Source cols: code,date(ms),open,high,low,close,previous,volume,value,frequency,
 * foreign_buy,foreign_sell. Names filled from company_profile.
 * On conflict only price/volume/foreign are updated, preserving existing
 * bid/offer/listed_shares/name set by the stock_summary import.
 *
 * TWO MODES — the default is deliberately the cheap one:
 *   'incremental' (default) — bounded date window around the target's frontier.
 *   'full'                  — every source row (1,382,240 rows on 2026-10-14,
 *                             17.9s measured). Opt-in only.
 * The default MUST stay incremental: this function is called from
 * POST /sync/import-all, which runs daily. A full run there would re-upsert
 * 1.38M rows a day for zero new information.
 *
 * Source `date` is epoch ms at 00:00 UTC of the trading day (verified: 0 of
 * 1,382,240 rows off-midnight), so epochToDate() renders it exactly as the WIB
 * trading day and no two rows can collide on (trade_date, code).
 *
 * Options: { full|mode:'full', from, to, date, overlapDays }
 * Returns: { rows, inserted, total, mode, from, to }
 *   rows     — rows upserted this run (attempted == stored: any throw aborts)
 *   inserted — net NEW rows in idx_daily (count delta); a pure value refresh is 0,
 *              which is the honest signal that the run added nothing
 *   total    — idx_daily row count after the run
 */
function importStockPriceHistory(targetDb, options = {}) {
  const idxDb = openIdxDb();
  try {
    const src = idxDb.prepare(`SELECT COUNT(*) as c FROM stock_price_history`).get() || {};
    if (!src.c) return { rows: 0, message: 'No stock_price_history data' };

    const mode = (options.full || options.mode === 'full') ? 'full' : 'incremental';
    const win = mode === 'full'
      ? { from: epochToDate(idxDb.prepare('SELECT MIN(date) AS mn FROM stock_price_history').get().mn),
          to: epochToDate(idxDb.prepare('SELECT MAX(date) AS mx FROM stock_price_history').get().mx),
          start: null, end: null }
      : resolvePriceWindow(idxDb, targetDb, options);

    const countRows = () => targetDb.prepare('SELECT COUNT(*) AS c FROM idx_daily').get().c;
    const before = countRows();

    const nameMap = {};
    try {
      for (const r of idxDb.prepare(`SELECT code, name FROM company_profile WHERE name != ''`).all()) {
        nameMap[String(r.code).trim().toUpperCase()] = r.name || '';
      }
    } catch {}

    const upsert = targetDb.prepare(`INSERT INTO idx_daily(trade_date,code,name,prev_close,open_price,high,low,close,change,volume,value,frequency,foreign_buy,foreign_sell)
      VALUES(@trade_date,@code,@name,@prev_close,@open_price,@high,@low,@close,@change,@volume,@value,@frequency,@foreign_buy,@foreign_sell)
      ON CONFLICT(trade_date,code) DO UPDATE SET prev_close=excluded.prev_close,open_price=excluded.open_price,high=excluded.high,low=excluded.low,close=excluded.close,change=excluded.change,volume=excluded.volume,value=excluded.value,frequency=excluded.frequency,foreign_buy=excluded.foreign_buy,foreign_sell=excluded.foreign_sell`);

    const windowWhere = win.start === null ? '' : ' WHERE date >= ? AND date < ?';
    const windowParams = win.start === null ? [] : [win.start, win.end];
    const windowTotal = idxDb.prepare(`SELECT COUNT(*) AS c FROM stock_price_history${windowWhere}`).get(...windowParams).c;
    if (!windowTotal) {
      console.log(`[bridge] stock_price_history ${mode} ${win.from}..${win.to}: window empty, nothing to do`);
      return { rows: 0, inserted: 0, total: before, mode, from: win.from, to: win.to };
    }

    let count = 0, offset = 0;
    while (offset < windowTotal) {
      // LIMIT/OFFSET over the FILTERED window: the incremental path is normally a
      // single chunk; only the opt-in full run pays the repeated-scan cost.
      const rows = idxDb.prepare(`SELECT * FROM stock_price_history${windowWhere} LIMIT ${CHUNK_SIZE} OFFSET ${offset}`).all(...windowParams);
      if (!rows.length) break;
      targetDb.transaction(() => {
        for (const r of rows) {
          const td = epochToDate(r.date);
          if (!td || !r.code) continue;
          const code = String(r.code).trim().toUpperCase();
          upsert.run({
            trade_date: td, code, name: nameMap[code] || '',
            prev_close: r.previous || 0, open_price: r.open || 0,
            high: r.high || 0, low: r.low || 0, close: r.close || 0,
            change: Math.round((r.close || 0) - (r.previous || 0)),
            volume: r.volume || 0, value: r.value || 0, frequency: r.frequency || 0,
            foreign_buy: r.foreign_buy || 0, foreign_sell: r.foreign_sell || 0
          });
          count++;
        }
      })();
      offset += rows.length;
      if (windowTotal > CHUNK_SIZE) console.log(`[bridge] stock_price_history ${win.from}..${win.to}: ${count}/${windowTotal} rows imported`);
    }

    const total = countRows();
    const inserted = total - before;
    console.log(`[bridge] stock_price_history ${mode} ${win.from}..${win.to}: rows=${count} inserted=${inserted} total=${total}`);
    return { rows: count, inserted, total, mode, from: win.from, to: win.to };
  } finally { idxDb.close(); }
}

module.exports = {
  findIdxDb, importStockSummary, importIndexSummary, importFinancialRatios,
  importStockScreener, importDividends, importStockSplits, importCompanyProfiles,
  importCompanyDetails, getIdxApiStatus,
  importBrokerSummary, importMarketCalendar, importCompanyAnnouncement,
  importDomesticTrading, importIndustryTrading,
  importDailyIndex, importTopMovers, importActiveStocks,
  importCompanySuspend, importRightOfferings, importParticipantBrokers,
  importTradingSS, importTradingDaily, importIndexChart, importIndexList,
  importFinancialReports, importIssuedHistory, importAdditionalListings,
  importNewListings, importSecurityStocks, importCompanyDelistings,
  importCompanyRelistings, importProfileAnnouncements, importParticipantDealers,
  importParticipantProfiles, importTradeSummary, importFinancialRatiosFull,
  importStockPriceHistory,
  wait: (ms) => new Promise(r => setTimeout(r, ms))
};
