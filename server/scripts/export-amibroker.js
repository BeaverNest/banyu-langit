#!/usr/bin/env node
/**
 * Export trading.db -> AmiBroker ASCII CSV.
 *
 *   node /app/server/scripts/export-amibroker.js --market all --out /app/data/export
 *
 * Why this exists: AmiBroker is Windows-only and reads a LOCAL database, so the only safe
 * handoff is export -> sync -> import. Pointing it at an SMB/SSHFS share corrupts the DB
 * when the link drops mid-write.
 *
 * Basis (must never be mixed inside one file):
 *   US  : already split+dividend adjusted at source (us_daily.source = 'yahoo/yfinance:adj')
 *   IDX : RAW prices in idx_daily, adjusted here with server/utils/price-adjust.js so the
 *         export matches what the app's charts and backtester see. Factors come from
 *         ca_factors, derived from IDX's official prev_close.
 *
 * Ticker namespacing: IDX gets a ".JK" suffix, US stays bare. Twenty-two tickers exist on both
 * exchanges (AGRO, CBRE, COIN, FAST, INDO, LION, ...); without the suffix AmiBroker would merge
 * a Jakarta bank with a US company.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('/app/node_modules/better-sqlite3');
const { adjustRows, loadFactors } = require(path.join(__dirname, '..', 'utils', 'price-adjust.js'));

const DB_PATH = process.env.BL_DB || '/app/data/trading.db';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const OUT = String(arg('out', '/app/data/export'));
const MARKET = String(arg('market', 'all')).toLowerCase();
const CHUNK = Number(arg('chunk', 300));       // symbols per file
const MIN_BARS = Number(arg('min-bars', 60));  // drop symbols with too little history to test on
const LITE = !!arg('lite', false);             // skip the per-row OHLC sanity pass (faster)
// Rolling window of recent sessions written to ONE small file. The full snapshot is 332 MB and
// rewrites every row, so a laptop that syncs it daily moves megabytes it already has. The delta
// is ~9 MB, self-healing (re-importing is idempotent under $OVERWRITE 1), and needs no per-file
// bookkeeping on the laptop — which is what lets "open AmiBroker and it is current" work after
// any gap up to this many sessions.
const DELTA_SESSIONS = Number(arg('delta-sessions', 30));

const db = new Database(DB_PATH, { readonly: true });

// Cutoff = the Nth most recent distinct session across both markets.
const cutoff = (() => {
  const rows = db.prepare(`
    SELECT d FROM (
      SELECT trade_date AS d FROM us_daily
      UNION SELECT trade_date AS d FROM idx_daily
    ) WHERE d IS NOT NULL ORDER BY d DESC LIMIT ?
  `).all(DELTA_SESSIONS);
  return rows.length ? isoDate(rows[rows.length - 1].d) : '0000-00-00';
})();

const DELTA = [];
// Tickers that survive MIN_BARS into the full snapshot. The delta MUST be filtered by this too:
// a symbol dropped from the snapshot (too few bars) must not arrive through the incremental file,
// or the "subset" contract breaks and the laptop accumulates symbols the server does not have.
const KEPT = new Set();
// Symbols already present in a US or IDX snapshot. The GLOBAL block must not reuse one: AmiBroker
// keys a symbol by name, so a commodity named AAPL would silently overwrite the equity.
const ALL_TAKEN = new Set();
const GLOBAL_KEPT = new Set();

function isoDate(s) {
  // idx_daily uses both '2026-10-29' and '2026/10/09' in adjacent tables; normalise.
  return String(s || '').replace(/\//g, '-').slice(0, 10);
}

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** Write one CSV made of {ticker,date,o,h,l,c,v} records, sorted ticker then date. */
function writeCsv(file, records, closeOnly) {
  records.sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : a.date < b.date ? -1 : 1));
  const lines = new Array(records.length);
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    // closeOnly writes 3 columns so the importer never sees a fabricated Open/High/Low.
    lines[i] = closeOnly
      ? `${r.ticker},${r.date},${r.c}`
      : `${r.ticker},${r.date},${r.o},${r.h},${r.l},${r.c},${r.v}`;
  }
  // Write to a temporary name and rename into place. The HTTP server exposes this directory
  // continuously, so a client pulling mid-write would otherwise receive a truncated CSV and
  // import it as if it were complete - a 40 MB partition cut at 12 MB still parses, and the
  // missing tail is invisible. rename() is atomic within a filesystem.
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, lines.join('\n') + '\n');
  fs.renameSync(tmp, file);
  return { file: path.basename(file), rows: records.length, bytes: fs.statSync(file).size };
}

// ------------------------------------------------------------------ US
function exportUs() {
  const rows = db.prepare(`
    SELECT code, trade_date, open, high, low, close, volume
    FROM us_daily
    WHERE close > 0
    ORDER BY code, trade_date
  `).all();

  const byCode = new Map();
  let openClamped = 0;
  for (const r of rows) {
    const d = isoDate(r.trade_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const o = num(r.open, 0), h = num(r.high, 0), l = num(r.low, 0), c = num(r.close, 0);
    // yfinance's adjusted open does not always sit inside the adjusted [low, high]: after a
    // dividend the open and the close can be scaled by slightly different ratios, leaving 57
    // rows (of 3.1M) where open < low by a cent. AmiBroker will reject those bars outright.
    // Clamp to the envelope and COUNT it — clamping silently would be editing the source.
    let oc = o;
    if (oc < l) oc = l;
    if (oc > h) oc = h;
    if (oc !== o) openClamped++;
    if (d >= cutoff) DELTA.push({ ticker: r.code, date: d, o: oc, h, l, c, v: num(r.volume, 0), src: 'us' });
    (byCode.get(r.code) || byCode.set(r.code, []).get(r.code)).push({
      ticker: r.code, date: d, o: oc, h, l, c, v: num(r.volume, 0),
    });
  }
  const stats = flush(byCode, 'us', { source: 'us_daily', basis: 'split+dividend adjusted (yahoo/yfinance:adj)', suffix: '' });
  stats.open_clamped_into_low_high = openClamped;
  return stats;
}

// ------------------------------------------------------------------ IDX
function exportIdx() {
  const factors = loadFactors(db);
  const rows = db.prepare(`
    SELECT code, trade_date, open_price, high, low, close, volume, prev_close
    FROM idx_daily
    WHERE close > 0
    ORDER BY code, trade_date
  `).all();

  const byCode = new Map();
  let phantom = 0, openReconstructed = 0, openNative = 0;

  for (const r of rows) {
    const d = isoDate(r.trade_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    // Phantom bars: the exchange listed the code but nothing traded. close is carried over,
    // high/low/volume are 0. Keeping them would draw a flat zero-volume bar every day and let
    // a backtest "buy" at a price that never traded.
    if (!(num(r.high, 0) > 0) || !(num(r.volume, 0) > 0)) { phantom++; continue; }
    const o = num(r.open_price, 0);
    if (o > 0) openNative++;
    else { openReconstructed++; }
    // Field names MUST match what price-adjust.js reads: pickPrice() resolves
    // ['open','open_price'] / ['close','close_price'] etc. Naming these o/c/h/l makes
    // adjustRows() return null for every price and ships a CSV of NaNs.
    (byCode.get(r.code) || byCode.set(r.code, []).get(r.code)).push({
      ticker: r.code + '.JK', date: d,
      open: o, high: num(r.high, 0), low: num(r.low, 0), close: num(r.close, 0),
      volume: num(r.volume, 0),
      _prev: num(r.prev_close, 0),
    });
  }

  // Adjust in place per code (factors are per code, so the cumulative product is per code).
  for (const [code, list] of byCode) {
    const fs_ = factors[code] || [];
    // Open is missing on 84% of IDX history (the IDX rail only started carrying it in 2025).
    // Reconstruct from the official prev_close BEFORE adjusting, then let adjustRows scale it
    // with the same factor as the other fields. Documented, not silent.
    for (const r of list) if (!(r.open > 0)) { r.open = r._prev > 0 ? r._prev : r.close; }
    adjustRows(list, fs_, { dateKey: 'date' });
    for (const r of list) {
      r.o = r.ao; r.h = r.ah; r.l = r.al; r.c = r.ac; r.v = Math.round(r.avol);
      delete r.open; delete r.high; delete r.low; delete r.close; delete r.volume;
      delete r.ao; delete r.ah; delete r.al; delete r.ac; delete r.avol;
      delete r.__adjFactor; delete r._prev;
    }
    // adjustRows() rounds to integers, which can push high/low off the open/close envelope by
    // a rupiah. Re-close the envelope so the OHLC contract holds after adjustment.
    for (const r of list) {
      r.h = Math.max(r.h, r.o, r.c);
      r.l = Math.min(r.l, r.o, r.c);
    }
    for (const r of list) {
      if (r.date >= cutoff) DELTA.push({ ticker: r.ticker, date: r.date, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v, src: 'idx' });
    }
  }

  const stats = flush(byCode, 'idx', {
    source: 'idx_daily',
    basis: 'corporate-action adjusted via ca_factors (integer rupiah)',
    suffix: '.JK',
  });
  stats.dropped_phantom_bars = phantom;
  stats.open_native = openNative;
  stats.open_reconstructed_from_prev_close = openReconstructed;
  return stats;
}

// ------------------------------------------------------------------ GLOBAL market
// Forex, commodities, global indices and macro series live in custom_ohlc, not in idx_daily or
// us_daily - they reach the app through the same manual table the dashboard reads.
//
// WHY A SEPARATE MIN-BARS: macro series are monthly RELEASES (CPI, PMI, SRBI), not daily bars.
// Requiring 60 of them would empty that category, and padding them to look daily would put a
// fiction in the database. A 12-sample floor keeps a series that can be plotted while refusing
// the ones too young to mean anything, and the manifest records how many were dropped.
function exportGlobal() {
  const GLOBAL_MIN_BARS = Number(arg('global-min-bars', 12));
  // 'rates' is the SBN yield curve (ID1M..ID30Y). It is not a currency and not a macro release -
  // it is the risk-free term structure, and leaving it out silently dropped 12 series.
  const cats = ['currency', 'commodity', 'commodity_unverified', 'global_index', 'macro', 'rates'];
  const tickers = db.prepare(
    `SELECT code, name, category, rows FROM custom_tickers WHERE category IN (${cats.map(() => '?').join(',')}) ORDER BY code`
  ).all(...cats);

  const byCode = new Map();
  const dropped = [];
  const renamed = [];
  const US_NAMES = new Set([...ALL_TAKEN]);   // US market only: bare names, no suffix
  for (const t of tickers) {
    // Never let a commodity overwrite an equity symbol, but do not throw the series away either:
    // the US market already owns 'CORN' (a ticker), so the agricultural contract ships as UsCorn.
    // Bare-code collision only. 'COAL' vs 'COAL.JK' is NOT a collision - those are different
    // AmiBroker symbols - so only rename when the export really would overwrite: a US ticker
    // with the exact same name and no suffix. The rename keeps the series usable.
    let name = t.code;
    if (US_NAMES.has(name)) name = 'Us' + t.code;
    if (US_NAMES.has(name)) { dropped.push({ ticker: t.code, reason: 'still clashes after rename' }); continue; }
    if (name !== t.code) renamed.push({ from: t.code, to: name });
    const rows = db.prepare(`
      SELECT trade_date, open, high, low, close, volume FROM custom_ohlc
      WHERE code = ? AND close > 0 ORDER BY trade_date
    `).all(t.code);
    const recs = rows.map(r => ({
      ticker: name, date: isoDate(r.trade_date),
      o: num(r.open, 0), h: num(r.high, 0), l: num(r.low, 0), c: num(r.close, 0), v: num(r.volume, 0),
    })).filter(r => r.c > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
    if (recs.length < GLOBAL_MIN_BARS) {
      dropped.push({ ticker: t.code, bars: recs.length, category: t.category });
      continue;
    }
    byCode.set(name, recs);
    GLOBAL_KEPT.add(name);
  }

  // Two files, because a close-only series cannot travel in the OHLC file.
  // 34 of these series (all yields, every macro release, COAL, TIN, RUBBER) have open=high=low=0
  // in custom_ohlc: the source only ever gave a settlement price. Writing them into the OHLC
  // column set would put 0 in Open/High/Low and every candle, MA and ATR built on those bars
  // would be garbage. AmiBroker fills O/H/L from Close when the field is absent, so the honest
  // fix is a separate file that carries Close only - not a fabricated O/H/L.
  // Split per ROW, not per symbol. ALUMINIUM has 59 such days out of ~500, XAUUSD 2, USDIDR 2:
  // the source published a settlement only on those dates. Sending the whole symbol to the
  // close file would throw away its real High/Low on every other day, and keeping the zero row
  // in the OHLC file would put a bar with Low=0 on the chart. Dates are disjoint between the two
  // files, so the second import adds the missing bars instead of overwriting good ones.
  const flat = [], flatClose = [];
  for (const code of [...byCode.keys()].sort()) {
    const list = byCode.get(code);
    KEPT.add(code);
    for (const r of list) ((r.o === 0 && r.h === 0 && r.l === 0) ? flatClose : flat).push(r);
  }
  const w = writeCsv(path.join(OUT, 'global_all.csv'), flat);
  const wc = writeCsv(path.join(OUT, 'global_close.csv'), flatClose, true);
  let minD = '9999', maxD = '0000';
  for (const list of byCode.values()) {
    if (list[0].date < minD) minD = list[0].date;
    if (list[list.length - 1].date > maxD) maxD = list[list.length - 1].date;
  }
  return {
    market: 'global', files: [w, wc], tickers: byCode.size,
    rows: w.rows + wc.rows, bytes: w.bytes + wc.bytes,
    ohcl_bars: flat.length,
    close_only_bars: flatClose.length,
    close_only_symbols: new Set(flatClose.map(r => r.ticker)).size,
    date_min: minD, date_max: maxD, min_bars: GLOBAL_MIN_BARS,
    dropped_too_short: dropped.length, dropped_sample: dropped.slice(0, 12), renamed,
    note: 'macro series are monthly releases, not daily bars - do not read a flat stretch as missing data; close_only symbols carry no true Open/High/Low in the source',
  };
}

// ------------------------------------------------------------------ IHSG index
function exportIhsg() {
  const rows = db.prepare(`
    SELECT trade_date, open, high, low, close, volume
    FROM index_ohlc WHERE index_code = 'COMPOSITE' ORDER BY trade_date
  `).all();
  const recs = rows.map(r => ({
    ticker: 'JKSE', date: isoDate(r.trade_date),
    o: num(r.open, 0), h: num(r.high, 0), l: num(r.low, 0), c: num(r.close, 0), v: num(r.volume, 0),
  })).filter(r => r.c > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  const res = writeCsv(path.join(OUT, 'index_ihsg.csv'), recs);
  return Object.assign(res, { ticker: 'JKSE', rows_in: rows.length, rows_out: recs.length });
}

// ------------------------------------------------------------------ shared writer
function flush(byCode, market, meta) {
  const files = [];
  const dropped = [];
  const tickers = [...byCode.keys()].sort();
  const keep = [];
  for (const t of tickers) {
    const list = byCode.get(t);
    if (list.length < MIN_BARS) { dropped.push({ ticker: t, bars: list.length }); continue; }
    KEPT.add(String(t).replace(/\.JK$/, ''));   // delta stores the suffixed ticker
    // US only: a bare name with no suffix is the only thing that can collide. Adding the IDX
    // bare code too would collide 'COAL' (commodity) with 'COAL' (IDX ticker, exported as
    // COAL.JK - a different symbol) and rename a series for no reason.
    if (market === 'us') ALL_TAKEN.add(String(t));
    keep.push([t, list]);
  }
  let batch = [], idx = 0, rowsTotal = 0, bytesTotal = 0;
  const name = (i) => market === 'us' ? `us_part${String(i).padStart(2, '0')}.csv`
                                      : `idx_part${String(i).padStart(2, '0')}.csv`;
  for (let i = 0; i < keep.length; i++) {
    batch.push(...keep[i][1]);
    if (batch.length && (i % CHUNK === CHUNK - 1 || i === keep.length - 1)) {
      idx++;
      const w = writeCsv(path.join(OUT, name(idx)), batch);
      files.push(w); rowsTotal += w.rows; bytesTotal += w.bytes;
      batch = [];
    }
  }
  let minD = '9999', maxD = '0000';
  for (const [, list] of keep) {
    if (list[0].date < minD) minD = list[0].date;
    if (list[list.length - 1].date > maxD) maxD = list[list.length - 1].date;
  }
  return Object.assign({
    market, files, tickers: keep.length, rows: rowsTotal, bytes: bytesTotal,
    date_min: minD, date_max: maxD,
    dropped_too_short: dropped.length,
    dropped_sample: dropped.slice(0, 10),
  }, meta);
}

// ------------------------------------------------------------------ categories
// AmiBroker has six orthogonal dimensions. A symbol belongs to exactly ONE market and ONE group
// and ONE industry (industry implies sector), but to MANY watchlists. That single-assignment rule
// is why "filter US vs IDX" belongs in Market/Group, not in a watchlist: a watchlist would let a
// symbol sit in both markets, which is exactly the mistake the .JK suffix exists to prevent.
//
// Sector/industry are imported verbatim from the source. IDX sectors stay in Indonesian - the
// database is the system of record for them, and translating here would create a second place
// where the mapping can drift.
function writeCategories() {
  const files = [];
  const summary = {};

  // --- US: Market=US, Group=tradable type, Sector/Industry from us_symbols_meta
  const us = db.prepare(`
    SELECT d.code,
           COALESCE(NULLIF(m.quote_type,''), 'Other')  AS grp,
           COALESCE(NULLIF(m.sector,''),   'Unclassified') AS sector,
           COALESCE(NULLIF(m.industry,''), 'Unclassified') AS industry
    FROM (SELECT DISTINCT code FROM us_daily WHERE close > 0) d
    LEFT JOIN us_symbols_meta m ON m.code = d.code
    ORDER BY d.code
  `).all().filter(r => KEPT.has(r.code));

  // --- IDX: Market=IDX, Group=listing board, Sector/Industry from company_profiles
  const idx = db.prepare(`
    SELECT d.code,
           COALESCE(NULLIF(p.board,''),    'Unclassified') AS grp,
           (SELECT MAX(dd.name) FROM idx_daily dd WHERE dd.code = d.code) AS rowname,
           COALESCE(NULLIF(p.sector,''),   'Unclassified') AS sector,
           COALESCE(NULLIF(p.industry,''), 'Unclassified') AS industry
    FROM (SELECT DISTINCT code FROM idx_daily WHERE close > 0) d
    LEFT JOIN company_profiles p ON p.code = d.code
    ORDER BY d.code
  `).all().filter(r => KEPT.has(r.code));

  // ---- symbol information lookups ---------------------------------------
  // Kept as Map for O(1) lookups over ~2.4k rows; a JOIN would also work but these three
  // sources live in different shapes and a missing row must be COUNTED, not silently dropped.
  const profiles = new Map(db.prepare(
    `SELECT code, name, address, website FROM company_profiles`).all().map(r => [r.code, r]));
  const usMeta = new Map(db.prepare(
    `SELECT code, name, exchange, currency FROM us_symbols_meta`).all().map(r => [r.code, r]));
  const customInfo = new Map(db.prepare(
    `SELECT code, name FROM custom_tickers`).all().map(r => [r.code, r]));

  // ---- category files ---------------------------------------------------
  // AmiBroker's ASCII importer has an asymmetric API, and getting it wrong is silent:
  //   MARKET / GROUP       take a numeric ID only  -> a name is accepted and discarded
  //   SECTORNAME / INDUSTRYNAME  take a NAME and create it on the fly
  // Measured: the first attempt shipped names for MARKET/GROUP, both files returned rc=0, and
  // all 2,378 symbols stayed in market 0 ("Undefined"). rc=0 proves the file parsed, nothing more.
  //
  // So the work is split in three:
  //   category_assign.csv  ticker,market_id,group_id      -> applied over OLE (exact, no parsing)
  //   categories_sector.csv ticker,sector_name            -> ASCII, creates sectors
  //   categories_industry.csv ticker,industry_name        -> ASCII, attaches industry to sector
  // GICS/ICB are deliberately absent: the vendor ships only the classification TREES
  // (gics.txt / icb.txt are "code; name" lists), not a ticker -> code map. Filling them would
  // mean inventing the mapping, so they stay empty until a licensed crosswalk exists.
  const clean = (v) => String(v).replace(/,/g, ' ').replace(/[;\t]/g, ' ').replace(/\s+/g, ' ').trim();

  function atomic(file, lines) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, lines.join('\n') + '\n');
    fs.renameSync(tmp, file);
    return { file: path.basename(file), rows: lines.length, bytes: fs.statSync(file).size };
  }

  // --- GLOBAL: forex / commodity / global index / macro, one group per category
  const gl = db.prepare(`
    SELECT code,
           CASE category
             WHEN 'currency'             THEN 'FOREX'
             WHEN 'commodity'            THEN 'COMMODITY'
             WHEN 'commodity_unverified' THEN 'COMMODITY'
             WHEN 'global_index'         THEN 'INDEX'
             WHEN 'macro'                THEN 'MACRO'
             WHEN 'rates'                THEN 'RATES'
             ELSE 'OTHER' END AS grp
    FROM custom_tickers
    WHERE category IN ('currency','commodity','commodity_unverified','global_index','macro','rates')
    ORDER BY code
  `).all().filter(r => GLOBAL_KEPT.has(r.code) || GLOBAL_KEPT.has('Us' + r.code))
      .map(r => ({ ...r, code: GLOBAL_KEPT.has(r.code) ? r.code : 'Us' + r.code }));

  const usGroups = [...new Set(us.map(r => r.grp))].sort();
  const idxGroups = [...new Set(idx.map(r => r.grp))].sort();
  const glGroups = [...new Set(gl.map(r => r.grp))].sort();
  // JKSE is an index, not a stock: it has no company profile, so it never entered the IDX
  // snapshot and stayed in market 0 forever. It gets its own group under market 2.
  idxGroups.push('INDEX');
  idxGroups.sort();
  const mIndex = { US: 1, IDX: 2, GLOBAL: 3 };   // 0 = Undefined, 255 = reserved
  // Group IDs are ONE namespace across all markets, not one per market. Numbering US from 1 and
  // IDX from 1 as well would put "US EQUITY" and "IDX Akselerasi" both in group 1, and the
  // second name write would silently overwrite the first. Allocate the whole range up front.
  const gIndex = {};
  let gNext = 1;
  usGroups.forEach(g => { gIndex['US:' + g] = gNext++; });
  idxGroups.forEach(g => { gIndex['IDX:' + g] = gNext++; });
  glGroups.forEach(g => { gIndex['GLOBAL:' + g] = gNext++; });

  const tagged = [
    ...us.map(r => ({ sym: r.code, market: 'US', grp: r.grp, sector: r.sector, industry: r.industry })),
    ...idx.map(r => ({ sym: r.code + '.JK', market: 'IDX', grp: r.grp, sector: r.sector, industry: r.industry })),
    // GLOBAL carries no sector/industry on purpose. The Series window would fill with 75
    // one-member industries, which is noise, and AmiBroker derives sector FROM industry - so
    // inventing an industry here would quietly create a bogus sector tree.
    ...gl.map(r => ({ sym: r.code, market: 'GLOBAL', grp: r.grp, sector: 'Unclassified', industry: 'Unclassified', noSector: true })),
    // IHSG. Market 0 is 'Undefined' and a symbol sitting there is invisible to any market filter,
    // which is how it survived three rounds of verification without anyone noticing.
    { sym: 'JKSE', market: 'IDX', grp: 'INDEX', sector: 'Unclassified', industry: 'Unclassified', noSector: true },
  ];

  files.push(atomic(path.join(OUT, 'category_assign.csv'),
    tagged.map(r => `${clean(r.sym)},${mIndex[r.market]},${gIndex[r.market + ':' + r.grp]}`)));

  const eq = tagged.filter(r => !r.noSector);
  files.push(atomic(path.join(OUT, 'categories_sector.csv'),
    eq.map(r => `${clean(r.sym)},${clean(r.sector)}`)));

  files.push(atomic(path.join(OUT, 'categories_industry.csv'),
    eq.map(r => `${clean(r.sym)},${clean(r.sector)},${clean(r.industry)}`)));

  // Market and group names cannot ride in on the CSV (the importer takes IDs), and OLE cannot
  // enumerate Groups/Watchlists/Sectors at all in 6.30 - so the names ship as a small list and
  // the Windows side applies them through Markets.Item(n).Name, the one collection OLE exposes.
  files.push(atomic(path.join(OUT, 'category_names.csv'),
    [`MARKET,1,US`, `MARKET,2,IDX`, `MARKET,3,GLOBAL`,
     ...usGroups.map(g => `GROUP,${gIndex['US:' + g]},US ${g}`),
     ...idxGroups.map(g => `GROUP,${gIndex['IDX:' + g]},IDX ${g}`),
     ...glGroups.map(g => `GROUP,${gIndex['GLOBAL:' + g]},GLOBAL ${g}`)]));

  // ---- SYMBOL INFORMATION ------------------------------------------------------------
  // Full name, alias, address, website and currency. These are NOT decoration: the chart
  // header and the symbol window show FullName instead of the raw ticker, and a chart for
  // 'UNVR.JK' reading 'UNVR.JK' everywhere is harder to scan than 'Unilever Indonesia'.
  //
  // Address counts as one line on purpose. 301 of the IDX addresses contain a newline, and a
  // newline inside a CSV field would split one company into two malformed rows.
  //
  // Currency is left EMPTY for US names, not defaulted to USD: us_symbols_meta says USD for
  // 1333 of 1334 rows, but that is the exchange's listing currency, and an empty field is
  // honest where a guess is not.
  const sip = [];
  const siMissing = { idx_profile: 0, us_meta: 0 };
  for (const r of idx) {
    const p = profiles.get(r.code) || {};
    // 27 IDX codes trade on the exchange but have no row in company_profiles (APOL, BORN,
    // CKRA, ...). They still carry a name in idx_daily, so the fallback uses that instead of
    // dropping the symbol - an unnamed ticker in the symbol window reads as a bug.
    const fallbackName = String(r.rowname || '').trim();
    // Never skip a symbol. A missing profile row used to mean no symbol-info row at all, which
    // left 27 IDX codes with no name AND no alias in the symbol window. Emitting the row with
    // the ticker standing in for the name is honest - AmiBroker displays the ticker either way -
    // and it keeps the count reportable instead of silently shrinking the file.
    if (!p.code) siMissing.idx_profile++;
    const nameOut = p.name || fallbackName || r.code;
    sip.push({
      sym: r.code + '.JK',
      full: nameOut,
      alias: r.code,
      addr: String(p.address || '').replace(/[\r\n]+/g, '; ').replace(/\s+/g, ' ').trim(),
      web: String(p.website || '').trim(),
      cur: 'IDR',
    });
  }
  for (const r of us) {
    const m = usMeta.get(r.code) || {};
    // Same rule as IDX: 90 US tickers trade in us_daily but have no us_symbols_meta row
    // (BCO, CSL, DCI, FR, GGG, NFG ...). They trade, so they get a row.
    if (!m.code) siMissing.us_meta++;
    sip.push({
      sym: r.code,
      full: m.name || r.code,
      alias: r.code,
      addr: '',                       // not in us_symbols_meta - leaving it blank, not inventing
      web: m.exchange ? 'https://www.nasdaq.com/market-activity/stocks/' + r.code.toLowerCase() : '',
      cur: String(m.currency || '').trim(),
    });
  }
  for (const r of gl) {
    const t = customInfo.get(r.code) || {};
    sip.push({
      sym: r.code,
      full: t.name || r.code,
      alias: r.code,
      addr: '',
      web: '',
      cur: '',
    });
  }
  sip.push({ sym: 'JKSE', full: 'IHSG - Indeks Harga Saham Gabungan', alias: 'IHSG', addr: '', web: 'https://www.idx.co.id', cur: 'IDR' });

  files.push(atomic(path.join(OUT, 'symbol_info.csv'),
    sip.map(r => [r.sym, r.full, r.alias, r.addr, r.web, r.cur].map(clean).join(','))));

  const catSummary = {
    symbol_info: {
      rows: sip.length,
      missing: siMissing,
      // FullName fell back to the ticker for these - the database genuinely has no name, and
      // writing a made-up one would be worse than showing the symbol.
      name_is_ticker: sip.filter(r => r.full === r.sym || r.full === r.sym.replace(/\.JK$/, '')).length,
    },
    symbols: tagged.length,
    markets: { US: us.length, IDX: idx.length, GLOBAL: gl.length },
    groups: { US: usGroups, IDX: idxGroups, GLOBAL: glGroups },
    sectors: [...new Set(tagged.map(r => r.sector))].sort(),
    industries: [...new Set(tagged.map(r => r.industry))].length,
    gics: 'not populated - no ticker->code crosswalk in the vendor files',
    icb: 'not populated - no ticker->code crosswalk in the vendor files',
  };

  for (const [key, rows] of [['us', us], ['idx', idx]]) {
    const byM = {}, byG = {}, byS = {};
    for (const r of rows) {
      byG[r.grp] = (byG[r.grp] || 0) + 1;
      byS[r.sector] = (byS[r.sector] || 0) + 1;
    }
    summary[key] = { symbols: rows.length, groups: byG, sectors: byS,
                     unclassified_sector: rows.filter(r => r.sector === 'Unclassified').length };
  }
  return { files, summary, categories: catSummary };
}

// ------------------------------------------------------------------ main
function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // Merge, never overwrite: a partial run (--market idx) must not erase the metadata for the
  // market it did not touch, or the verifier can no longer describe what is already on disk.
  const mpath = path.join(OUT, 'manifest.json');
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(mpath, 'utf8')); } catch (e) { prev = {}; }
  const manifest = Object.assign({}, prev, {
    generated_at: new Date().toISOString(), db: DB_PATH, chunks_of_symbols: CHUNK,
  });
  if (!manifest.markets) manifest.markets = {};
  if (!manifest.markets[MARKET === 'all' ? 'all' : MARKET]) manifest.markets[MARKET] = null;
  manifest.markets[MARKET] = new Date().toISOString();

  if (MARKET === 'us' || MARKET === 'all') manifest.us = exportUs();
  if (MARKET === 'idx' || MARKET === 'all') {
    manifest.idx = exportIdx();
    manifest.ihsg = exportIhsg();
  }
  // GLOBAL last: it needs ALL_TAKEN populated by the equity snapshots to avoid a name collision.
  if (MARKET === 'global' || MARKET === 'all') manifest.global = exportGlobal();

  // One small file for the nightly incremental import. Sorted by ticker then date so the file
  // is deterministic: an unchanged session produces byte-identical output, and a sync client
  // sees no change at all instead of re-sending the whole thing.
  // Compare on the unsuffixed code: KEPT keys come from the DB, delta carries '.JK'.
  const deltaRows = DELTA.filter(r => KEPT.has(String(r.ticker).replace(/\.JK$/, '')));
  if (deltaRows.length) {
    const w = writeCsv(path.join(OUT, 'delta_recent.csv'), deltaRows);
    // The index is a symbol too; without it the chart of JKSE would lag the constituents.
    const ihsg = db.prepare(`
      SELECT trade_date, open, high, low, close, volume FROM index_ohlc
      WHERE index_code='COMPOSITE' AND trade_date >= ? ORDER BY trade_date
    `).all(cutoff);
    const iw = ihsg.length
      ? writeCsv(path.join(OUT, 'delta_index.csv'), ihsg.map(r => ({
          ticker: 'JKSE', date: isoDate(r.trade_date),
          o: num(r.open, 0), h: num(r.high, 0), l: num(r.low, 0), c: num(r.close, 0), v: num(r.volume, 0),
        })).filter(r => r.c > 0))
      : null;
    manifest.delta = {
      sessions: DELTA_SESSIONS, cutoff,
      files: [w, iw].filter(Boolean),
      rows: w.rows + (iw ? iw.rows : 0),
      bytes: w.bytes + (iw ? iw.bytes : 0),
    };
  }

  // Categories are written after both markets so KEPT holds the full universe; a symbol dropped
  // for having too little history must not be given a market/group assignment either.
  const cats = writeCategories();
  manifest.categories = {
    format: 'split by importer capability - see files[]',
    assignment: 'market/group applied over OLE (numeric IDs only); sector/industry applied via ASCII SECTORNAME/INDUSTRYNAME; gics/icb intentionally empty',
    files: cats.files,
    markets: cats.summary,
    note: 'Sector/industry import AFTER the quote files: $OVERWRITE 1 targets symbols that must ' +
          'already exist. Market/group have no name field in the importer, so assign-categories.vbs ' +
          'applies them over OLE. GICS/ICB stay empty: the vendor ships only the code trees, not a ' +
          'ticker crosswalk, and inventing one would be worse than leaving them blank.',
  };

  manifest.notes = [
    'One file per market chunk. Columns: Ticker,Date_YMD,Open,High,Low,Close,Volume.',
    'US prices are already split+dividend adjusted at source; IDX prices are adjusted here.',
    'NEVER import a US file and an IDX file into the same symbol namespace by stripping .JK.',
    'IDX Open is reconstructed from prev_close on 84% of history (the IDX rail only carries',
    '  real opens from 2025). Do not build an open-based entry rule on IDX history without',
    '  accounting for that. Report it, do not quietly trust it.',
    'IDX volume is divided by the corporate-action factor so it is on today\'s share count.',
    'Phantom bars (no trade: volume=0, high=0) are dropped, not carried forward.',
  ].join('\n');
  const manifestPath = path.join(OUT, 'manifest.json');
  fs.writeFileSync(manifestPath + '.tmp', JSON.stringify(manifest, null, 2));
  fs.renameSync(manifestPath + '.tmp', manifestPath);

  console.log(JSON.stringify(manifest, null, 2));
}

main();
