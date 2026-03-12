/**
 * IDX-API Bridge Import for Banyu Langit
 * 
 * Reads data from IDX-API Deno project's SQLite database (database.sqlite)
 * and upserts into Banyu Langit's trading.db
 * 
 * Flow: Deno syncs from idx.co.id → database.sqlite → this bridge → trading.db
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Path to IDX-API database — relative to project root
const IDX_DB_PATHS = [
  path.join(__dirname, '..', '..', 'IDX-API-main', 'data', 'database.sqlite'),
  path.join(__dirname, '..', '..', '..', 'IDX-API-main', 'data', 'database.sqlite'),
  '/app/IDX-API-main/data/database.sqlite'  // Docker path
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

/**
 * Import stock_summary → idx_daily
 * Maps IDX-API columns to Banyu Langit schema
 */
function importStockSummary(targetDb, options = {}) {
  const idxDb = openIdxDb();
  try {
    const dateFilter = options.date || '';
    const fromDate = options.from || '';
    const toDate = options.to || '';

    let sql = `SELECT * FROM stock_summary WHERE 1=1`;
    const params = [];

    if (dateFilter) {
      // IDX-API stores dates as WIB midnight in UTC epoch
      // 2026-03-12 WIB 00:00 = 2026-03-11T17:00:00Z
      // So for date 2026-03-12, we search epoch range:
      //   from: 2026-03-11T17:00Z (date - 7h)
      //   to:   2026-03-12T17:00Z (date + 24h - 7h)
      const d = new Date(dateFilter + 'T00:00:00Z');
      const dayStart = d.getTime() - 7 * 3600000;
      const dayEnd = dayStart + 86400000;
      sql += ` AND date >= ? AND date < ?`;
      params.push(dayStart, dayEnd);
    } else if (fromDate && toDate) {
      const dFrom = new Date(fromDate + 'T00:00:00Z').getTime() - 7 * 3600000;
      const dTo = new Date(toDate + 'T00:00:00Z').getTime() - 7 * 3600000 + 86400000;
      sql += ` AND date >= ? AND date < ?`;
      params.push(dFrom, dTo);
    }

    const rows = idxDb.prepare(sql).all(...params);
    if (!rows.length) return { rows: 0, message: 'No data in IDX-API database for this range' };

    const upsert = targetDb.prepare(`INSERT INTO idx_daily(trade_date,code,name,prev_close,open_price,high,low,close,change,volume,value,frequency,bid,bid_vol,offer,offer_vol,listed_shares,tradeable_shares,foreign_buy,foreign_sell)
      VALUES(@trade_date,@code,@name,@prev_close,@open_price,@high,@low,@close,@change,@volume,@value,@frequency,@bid,@bid_vol,@offer,@offer_vol,@listed_shares,@tradeable_shares,@foreign_buy,@foreign_sell)
      ON CONFLICT(trade_date,code) DO UPDATE SET name=excluded.name,prev_close=excluded.prev_close,open_price=excluded.open_price,high=excluded.high,low=excluded.low,close=excluded.close,change=excluded.change,volume=excluded.volume,value=excluded.value,frequency=excluded.frequency,bid=excluded.bid,bid_vol=excluded.bid_vol,offer=excluded.offer,offer_vol=excluded.offer_vol,listed_shares=excluded.listed_shares,tradeable_shares=excluded.tradeable_shares,foreign_buy=excluded.foreign_buy,foreign_sell=excluded.foreign_sell`);

    let count = 0;
    targetDb.transaction(() => {
      for (const r of rows) {
        // Convert epoch ms to YYYY-MM-DD
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

    return { rows: count, dates: [...new Set(rows.map(r => epochToDate(r.date)))].sort() };
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
          trade_date: td,
          index_code: String(r.code || '').trim(),
          previous: r.previous || 0,
          highest: r.high || 0,
          lowest: r.low || 0,
          close: r.close || 0,
          change_val: r.change || 0,
          volume: r.volume || 0,
          value: r.value || 0,
          frequency: r.frequency || 0,
          market_cap: r.market_cap || 0
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
 * Import financial_ratio → idx_fundamental
 */
function importFinancialRatios(targetDb) {
  const idxDb = openIdxDb();
  try {
    const rows = idxDb.prepare(`SELECT * FROM financial_ratio`).all();
    if (!rows.length) return { rows: 0 };

    const upsert = targetDb.prepare(`INSERT INTO idx_fundamental(snapshot_month,code,name,sector,subsector,industry,subindustry,per,pbv,roe,roa,der,npm,mkt_cap,total_rev)
      VALUES(@snapshot_month,@code,@name,@sector,@subsector,@industry,@subindustry,@per,@pbv,@roe,@roa,@der,@npm,@mkt_cap,@total_rev)
      ON CONFLICT(snapshot_month,code) DO UPDATE SET name=excluded.name,sector=excluded.sector,subsector=excluded.subsector,industry=excluded.industry,subindustry=excluded.subindustry,per=excluded.per,pbv=excluded.pbv,roe=excluded.roe,roa=excluded.roa,der=excluded.der,npm=excluded.npm,mkt_cap=excluded.mkt_cap,total_rev=excluded.total_rev`);

    let count = 0;
    targetDb.transaction(() => {
      for (const r of rows) {
        if (!r.code) continue;
        // Derive snapshot_month from year+month or use current
        const sm = r.year && r.month ? `${r.year}-${String(r.month).padStart(2, '0')}` : new Date().toISOString().slice(0, 7);

        upsert.run({
          snapshot_month: sm,
          code: String(r.code || '').trim(),
          name: String(r.stock_name || r.name || '').trim(),
          sector: String(r.sector || '').trim(),
          subsector: String(r.sub_sector || '').trim(),
          industry: String(r.industry || '').trim(),
          subindustry: String(r.sub_industry || '').trim(),
          per: r.per || 0,
          pbv: r.price_bv || r.pbv || 0,
          roe: r.roe || 0,
          roa: r.roa || 0,
          der: r.de_ratio || r.der || 0,
          npm: r.npm || 0,
          mkt_cap: 0,
          total_rev: r.sales || r.total_rev || 0
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
 * Import stock_screener → idx_fundamental (enriched with price changes)
 */
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

        upsert.run(
          snapshotMonth, code, r.company_name || r.name || '',
          r.sector || '', r.sub_sector || '', r.industry || '', r.sub_industry || '',
          r.per || 0, r.pbv || 0, r.roe || 0, r.roa || 0, r.der || 0, r.npm || 0,
          r.market_capital || r.mkt_cap || 0, r.t_revenue || r.total_rev || 0,
          r.week_4_pc || r.chg_4w || 0, r.week_13_pc || r.chg_13w || 0,
          r.week_26_pc || r.chg_26w || 0, r.week_52_pc || r.chg_52w || 0,
          r.mtdpc || r.mtd || 0, r.ytdpc || r.ytd || 0
        );
        count++;
      }
    })();

    return { rows: count, snapshot_month: snapshotMonth };
  } finally {
    idxDb.close();
  }
}

/**
 * Import company_dividend → dividends
 */
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
        ins.run({
          code: String(r.code || '').trim(),
          ex_date: epochToDate(r.ex_dividend) || '',
          cash_dividend: r.cash_dividend || 0,
          cum_date: epochToDate(r.cum_dividend) || '',
          record_date: epochToDate(r.record_date) || '',
          payment_date: epochToDate(r.payment_date) || '',
          name: String(r.name || '').trim()
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
 * Import stock_split → corporate_actions
 */
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
        if (parts.length === 2) {
          const old = parseInt(parts[0]) || 1;
          const newP = parseInt(parts[1]) || 1;
          ratio = newP / old;
        }

        const actionType = String(r.ssrs || 'split').toLowerCase().includes('reverse') ? 'reverse_split' : 'split';

        ins.run({
          code: String(r.code || '').trim(),
          ex_date: epochToDate(r.listing_date) || '',
          action_type: actionType,
          ratio: ratio,
          new_shares: r.listed_shares || 0,
          notes: `${r.ssrs || ''} ratio=${ratioStr}`
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
 * Import company_profile → company_profiles
 */
function importCompanyProfiles(targetDb) {
  const idxDb = openIdxDb();
  try {
    const rows = idxDb.prepare(`SELECT * FROM company_profile`).all();
    if (!rows.length) return { rows: 0 };

    const ins = targetDb.prepare(`INSERT INTO company_profiles(code,name,listing_date,updated_at)
      VALUES(?,?,?,datetime('now'))
      ON CONFLICT(code) DO UPDATE SET name=excluded.name,listing_date=excluded.listing_date,updated_at=datetime('now')`);

    let count = 0;
    targetDb.transaction(() => {
      for (const r of rows) {
        if (!r.code) continue;
        const listDate = r.listing_date ? epochToDate(r.listing_date) : '';
        ins.run(String(r.code).trim(), String(r.name || '').trim(), listDate);
        count++;
      }
    })();

    return { rows: count };
  } finally {
    idxDb.close();
  }
}

/**
 * Import company_detail → company_profiles (enriched with sector, industry, board)
 */
function importCompanyDetails(targetDb) {
  const idxDb = openIdxDb();
  try {
    const rows = idxDb.prepare(`SELECT * FROM company_detail`).all();
    if (!rows.length) return { rows: 0 };

    // Ensure columns exist
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
        ins.run(
          String(r.code).trim(),
          String(r.sector || '').trim(),
          String(r.sub_sector || '').trim(),
          String(r.industry || '').trim(),
          String(r.sub_industry || '').trim(),
          String(r.board || '').trim(),
          String(r.address || '').substring(0, 200).trim(),
          String(r.website || '').trim(),
          String(r.email || '').trim(),
          String(r.phone || '').trim()
        );
        count++;
      }
    })();

    return { rows: count };
  } finally {
    idxDb.close();
  }
}

/**
 * Get status info from IDX-API database
 */
function getIdxApiStatus() {
  try {
    const idxDb = openIdxDb();
    try {
      const tables = idxDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r => r.name);

      const counts = {};
      for (const t of ['stock_summary', 'index_summary', 'financial_ratio', 'stock_screener', 'company_dividend', 'stock_split', 'company_profile']) {
        try {
          counts[t] = idxDb.prepare(`SELECT COUNT(*) as c FROM ${t}`).get()?.c || 0;
        } catch { counts[t] = 0; }
      }

      // Date ranges
      let stockDateRange = {};
      try {
        const min = idxDb.prepare('SELECT MIN(date) as d FROM stock_summary').get()?.d;
        const max = idxDb.prepare('SELECT MAX(date) as d FROM stock_summary').get()?.d;
        stockDateRange = { first: epochToDate(min), last: epochToDate(max) };
      } catch { /* */ }

      return { ok: true, tables, counts, stock_dates: stockDateRange, db_path: findIdxDb() };
    } finally {
      idxDb.close();
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══ Helpers ═══

function epochToDate(epoch) {
  if (!epoch) return '';
  // IDX-API stores dates as epoch milliseconds in WIB (UTC+7)
  // Add 7 hours offset to get correct date
  const ms = typeof epoch === 'number' ? epoch : parseInt(epoch);
  if (isNaN(ms)) return '';
  const d = new Date(ms + 7 * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

module.exports = {
  findIdxDb,
  importStockSummary,
  importIndexSummary,
  importFinancialRatios,
  importStockScreener,
  importDividends,
  importStockSplits,
  importCompanyProfiles,
  importCompanyDetails,
  getIdxApiStatus,
  wait: (ms) => new Promise(r => setTimeout(r, ms))
};
