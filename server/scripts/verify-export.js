#!/usr/bin/env node
/**
 * Verify the AmiBroker export. Fails loudly (exit 2) rather than reporting "looks fine".
 *
 *   node /app/server/scripts/verify-export.js --dir /app/data/export
 *
 * Checks that catch the failures which actually happen:
 *   - unadjusted split still in the series (BBCA 2021-10-13 would read -80%)
 *   - ticker namespace collision between US and IDX
 *   - phantom bars (price with zero volume) surviving the filter
 *   - OHLC internally inconsistent after adjustment
 *   - export silently short of the DB row count
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('/app/node_modules/better-sqlite3');

const DIR = process.argv.includes('--dir')
  ? process.argv[process.argv.indexOf('--dir') + 1] : '/app/data/export';
const DB_PATH = process.env.BL_DB || '/app/data/trading.db';

const fails = [];
const warns = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const warn = (cond, msg) => { if (!cond) warns.push(msg); };

function readCsv(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const lines = txt.split('\n').filter(Boolean);
  const rows = {};
  let cols = null;
  for (const line of lines) {
    const p = line.split(',');
    if (cols === null) { cols = p.length; }
    else ok(p.length === cols, `${path.basename(file)}: column count drift ${p.length} vs ${cols}`);
    const [t, d, o, h, l, c, v] = p;
    (rows[t] = rows[t] || []).push({
      d, o: +o, h: +h, l: +l, c: +c, v: +v,
    });
  }
  return { rows, lines: lines.length, cols: cols || 0 };
}

// ---------------------------------------------------------------- load
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv'));

const usFiles = files.filter(f => /^us_/.test(f));
// Equity chunks only. /^idx_/ used to be the whole test, and the moment idx_sector.csv (3 columns,
// close-only) joined the directory this sweep reported 12,232 "invalid OHLC" rows against a
// perfectly good file. A pattern loose enough to catch a new file shape silently redefines what
// the check means.
const idxFiles = files.filter(f => /^idx_part\d+\.csv$/.test(f));
ok(usFiles.length > 0, 'no US export files');
ok(idxFiles.length > 0, 'no IDX export files');
ok(files.includes('index_ihsg.csv'), 'index_ihsg.csv missing');

const us = {}; const idx = {};
for (const f of usFiles) Object.assign(us, readCsv(path.join(DIR, f)).rows);
for (const f of idxFiles) Object.assign(idx, readCsv(path.join(DIR, f)).rows);

// ---------------------------------------------------------------- 1. namespace
const collide = Object.keys(us).filter(t => idx[t]);
ok(collide.length === 0, `ticker collision between US and IDX: ${collide.slice(0, 5)}`);
const badIdxNames = Object.keys(idx).filter(t => !t.endsWith('.JK'));
ok(badIdxNames.length === 0, `IDX tickers without .JK suffix: ${badIdxNames.slice(0, 5)}`);

// ---------------------------------------------------------------- 2. split neutralised
// BBCA split 1:5 with ex-date 2021-10-13. Unadjusted, 2021-10-13 reads about -80% vs
// 2021-10-12; adjusted, the step is an ordinary daily move.
const bbca = idx['BBCA.JK'] || [];
const before = bbca.find(r => r.d === '2021-10-12');
const after = bbca.find(r => r.d === '2021-10-14');
ok(before && after, 'BBCA.JK missing around the 2021-10-13 split');
if (before && after) {
  const ratio = after.c / before.c;
  ok(ratio > 0.6 && ratio < 1.6,
     `BBCA split NOT neutralised: 2021-10-12 ${before.c} -> 2021-10-14 ${after.c} (ratio ${ratio.toFixed(3)})`);
}
// The same trap on a broader sample: no single-session move beyond +/-55% inside the
// adjusted series. Anything larger is an unhandled corporate action, not a market move.
let extremes = 0, extremeSample = [];
for (const [t, list] of Object.entries(idx)) {
  for (let i = 1; i < list.length; i++) {
    const r = list[i].c / list[i - 1].c;
    if (r < 0.45 || r > 2.2) {
      extremes++;
      if (extremeSample.length < 5) extremeSample.push(`${t} ${list[i].d} x${r.toFixed(2)}`);
    }
  }
}
warn(extremes === 0, `${extremes} adjusted IDX moves beyond ±55% remain: ${extremeSample.join(', ')}`);

// ---------------------------------------------------------------- 3. OHLC sanity
// Absolute tolerance, not bit-exact: adjusted US prices are float64 from yfinance (3.776119470596314
// vs ...135), so `high < close` triggers on the last binary digit and reports 1,417 phantom defects.
// A real defect here is a rupiah or a cent, never 1e-15.
const EPS = 1e-6;
let bad = 0, zeroVol = 0, flat = 0, badSample = [];
const scan = (obj) => {
  for (const [t, list] of Object.entries(obj)) {
    for (const r of list) {
      if (!(r.o > 0 && r.h > 0 && r.l > 0 && r.c > 0)) { bad++; if (badSample.length < 5) badSample.push(`${t} ${r.d} nonpositive`); continue; }
      if (r.h < Math.max(r.o, r.c) - EPS || r.l > Math.min(r.o, r.c) + EPS || r.h < r.l - EPS) {
        bad++;
        if (badSample.length < 5) badSample.push(`${t} ${r.d} o=${r.o} h=${r.h} l=${r.l} c=${r.c}`);
      }
      if (r.v <= 0) zeroVol++;
      if (Math.abs(r.o - r.h) < EPS && Math.abs(r.h - r.l) < EPS) flat++;
    }
  }
};
scan(us); scan(idx);
ok(bad === 0, `${bad} rows with invalid OHLC: ${badSample.join(' | ')}`);
// Zero-volume bars are counted, not failed: a real no-trade day is legitimate in US data
// (13,398 rows, all genuine halts), while in IDX every such row was already dropped as phantom.
// Failing on them would make the gate impossible to satisfy and therefore ignored.
warn(zeroVol === 0, `${zeroVol} zero-volume bars present (legitimate halts, kept)`);
warn(flat < 500, `${flat} bars with open=high=low (suspicious flatness)`);

// ------------------------------------------------ 3b. close-only files (3 columns)
// idx_sector.csv (46 IDX sector/strategy indices) and global_close.csv (yields, macro releases,
// COAL/TIN/RUBBER) carry Ticker,Date,Close and nothing else, because their sources never
// published an Open/High/Low. They are checked here as their OWN shape, not squeezed through the
// OHLC sweep - which cannot tell "close-only by design" from "corrupt bar".
const readCloseOnly = (file) => {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const out = new Map();
  let badDate = 0, badClose = 0, badCols = 0;
  for (const ln of lines) {
    const parts = ln.split(',');
    if (parts.length !== 3) { badCols++; continue; }
    const [t, d, c] = parts;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { badDate++; continue; }
    const cv = Number(c);
    if (!(cv > 0)) { badClose++; continue; }
    if (!out.has(t)) out.set(t, []);
    out.get(t).push({ d, c: cv });
  }
  return { out, badDate, badClose, badCols, lines: lines.length };
};

for (const f of ['idx_sector.csv', 'global_close.csv']) {
  if (!files.includes(f)) { ok(false, `${f} missing`); continue; }
  const r = readCloseOnly(path.join(DIR, f));
  ok(r.badCols === 0, `${f}: ${r.badCols} line(s) without exactly 3 columns`);
  ok(r.badDate === 0, `${f}: ${r.badDate} line(s) with an unparseable date`);
  ok(r.badClose === 0, `${f}: ${r.badClose} line(s) with a nonpositive close`);
  // Sorted on ticker then date, and no duplicate (ticker,date): a duplicate means the export
  // glued two sources together and AmiBroker would import both, silently overwriting one.
  let dup = 0, unsorted = 0;
  for (const [, list] of r.out) {
    for (let i = 1; i < list.length; i++) {
      if (list[i].d === list[i - 1].d) dup++;
      else if (list[i].d < list[i - 1].d) unsorted++;
    }
  }
  ok(dup === 0, `${f}: ${dup} duplicate (ticker,date) pair(s)`);
  ok(unsorted === 0, `${f}: ${unsorted} out-of-order date(s)`);
}

let idxSectorStat = null;
// idx_sector.csv specifics: the suffix keeps it out of the equity namespace, the depth floor is
// the same 60 sessions the exporter applies, and the manifest must agree with the file.
if (files.includes('idx_sector.csv')) {
  const r = readCloseOnly(path.join(DIR, 'idx_sector.csv'));
  const tickers = [...r.out.keys()];
  const badSuffix = tickers.filter(t => !t.endsWith('.JK'));
  ok(badSuffix.length === 0, `idx_sector.csv: ticker(s) without .JK suffix: ${badSuffix.slice(0, 5)}`);
  ok(tickers.length >= 40, `idx_sector.csv: only ${tickers.length} series, expected >= 40 of the 45 non-composite indices`);
  const short = tickers.filter(t => r.out.get(t).length < 60);
  ok(short.length === 0, `idx_sector.csv: ${short.length} series below 60 bars: ${short.slice(0, 5)}`);
  const man = manifest.idx_sectors || {};
  ok(man.tickers === tickers.length,
     `idx_sector.csv declares ${man.tickers} series in the manifest but holds ${tickers.length}`);
  const fileMax = tickers.map(t => r.out.get(t).slice(-1)[0].d).sort().slice(-1)[0];
  ok(!man.date_max || man.date_max === fileMax,
     `idx_sector.csv date_max ${fileMax} disagrees with the manifest (${man.date_max})`);
  // A lagging index feed must NOT stop the equity export: these series are optional extras, and
  // blocking 2,500 symbols because an index chart is a day behind would trade a small gap for a
  // total outage. Warn, and let verify-freshness.vbs judge the bars that actually landed.
  const idxMax = (manifest.idx || {}).date_max;
  warn(!idxMax || fileMax >= idxMax, `idx_sector.csv ends ${fileMax} while the IDX equity snapshot ends ${idxMax}`);
  idxSectorStat = { series: tickers.length, rows: r.lines, date_max: fileMax };
}

// ---------------------------------------------------------------- 4. against the DB
const db = new Database(DB_PATH, { readonly: true });
const dbUsCodes = db.prepare('SELECT COUNT(DISTINCT code) n FROM us_daily').get().n;
// Traded bars only (volume>0). The export keeps US halts but drops IDX phantom rows, so the
// IDX comparison must use the same definition or it will always look one bar short.
const dbIdxTraded = db.prepare('SELECT COUNT(*) n FROM idx_daily WHERE volume > 0 AND high > 0').get().n;
// Every IDX bar with a usable close, traded or not. No-trade bars are exported now (flattened,
// volume 0) because a suspended stock must hold its last price on the chart instead of vanishing.
const dbIdxAll = db.prepare('SELECT COUNT(*) n FROM idx_daily WHERE close > 0').get().n;
const dbShortTickers = db.prepare(
  'SELECT COUNT(*) n FROM (SELECT code, COUNT(*) c FROM idx_daily WHERE close>0 GROUP BY code HAVING c < ?)'
).get(Number(process.argv.includes('--min-bars') ? process.argv[process.argv.indexOf('--min-bars') + 1] : 60)).n;
const dbShortBars = db.prepare(`
  SELECT COALESCE(SUM(c),0) n FROM (
    SELECT code, COUNT(*) c FROM idx_daily WHERE volume>0 AND high>0 GROUP BY code HAVING c < ?
  )`).get(Number(process.argv.includes('--min-bars') ? process.argv[process.argv.indexOf('--min-bars') + 1] : 60)).n;
ok(Object.keys(us).length === manifest.us.tickers,
   `US ticker count ${Object.keys(us).length} != manifest ${manifest.us.tickers}`);
warn(Object.keys(us).length >= dbUsCodes - 5,
     `US export has ${Object.keys(us).length} tickers, DB has ${dbUsCodes}`);
ok(manifest.idx.flattened_no_trade_bars > 0, 'no-trade bar flattening did not run');
// Row accounting closes on ALL bars with a close, because no-trade bars are exported now.
// The only rows the exporter may withhold are the too-short tickers (MIN_BARS gate), so the
// check subtracts those. A previous version compared against volume>0 AND high>0, which both
// undercounted halted sessions and disagreed with the exporter's own definition of "short".
const dbShortBars2 = db.prepare(`
  SELECT COALESCE(SUM(c),0) n FROM (
    SELECT code, COUNT(*) c FROM idx_daily WHERE close>0 GROUP BY code HAVING c < ?
  )`).get(Number(process.argv.includes('--min-bars') ? process.argv[process.argv.indexOf('--min-bars') + 1] : 60)).n;
ok(manifest.idx.rows === dbIdxAll - dbShortBars2,
   `IDX row accounting: exported ${manifest.idx.rows}, DB total ${dbIdxAll} minus short-history ${dbShortBars2} = ${dbIdxAll - dbShortBars2}`);
ok(manifest.idx.dropped_too_short === dbShortTickers,
   `short-history tickers: manifest ${manifest.idx.dropped_too_short}, DB ${dbShortTickers}`);

// Last close must match the DB, or the export is stale relative to the app.
const ihsg = readCsv(path.join(DIR, 'index_ihsg.csv')).rows;
const jkse = (ihsg['JKSE'] || []);
const lastJkse = jkse[jkse.length - 1];
const dbJkse = db.prepare("SELECT trade_date, close FROM index_ohlc WHERE index_code='COMPOSITE' ORDER BY trade_date DESC LIMIT 1").get();
ok(lastJkse && String(dbJkse.trade_date).slice(0, 10) === lastJkse.d,
   `IHSG last date ${lastJkse && lastJkse.d} != DB ${dbJkse.trade_date}`);
ok(lastJkse && Math.abs(lastJkse.c - dbJkse.close) < 0.01,
   `IHSG last close ${lastJkse && lastJkse.c} != DB ${dbJkse.close}`);

const aapl = (us['AAPL'] || []).slice(-1)[0];
const dbAapl = db.prepare("SELECT trade_date, close FROM us_daily WHERE code='AAPL' ORDER BY trade_date DESC LIMIT 1").get();
ok(aapl && Math.abs(aapl.c - dbAapl.close) < 0.01,
   `AAPL last close ${aapl && aapl.c} != DB ${dbAapl.close}`);
ok(aapl && aapl.d === String(dbAapl.trade_date).slice(0, 10), `AAPL last date mismatch`);

// ---------------------------------------------------------------- 5. delta file
// The delta is what the nightly laptop import actually reads, so it must be a strict SUBSET of
// the full snapshot for the same ticker/date — otherwise the small file silently disagrees with
// the big one and the laptop's database diverges from the server's.
const deltaPath = path.join(DIR, 'delta_recent.csv');
ok(fs.existsSync(deltaPath), 'delta_recent.csv missing — laptop would import nothing new');
let deltaStat = null;
if (fs.existsSync(deltaPath)) {
  const dRows = readCsv(deltaPath).rows;
  const full = Object.assign({}, us, idx);
  let mism = 0, sample = [], covered = 0;
  for (const [t, list] of Object.entries(dRows)) {
    const src = full[t];
    if (!src) { mism++; if (sample.length < 3) sample.push(`${t} absent from snapshot`); continue; }
    const byDate = new Map(src.map(r => [r.d, r]));
    for (const r of list) {
      const f = byDate.get(r.d);
      if (!f) { mism++; if (sample.length < 4) sample.push(`${t} ${r.d} not in snapshot`); continue; }
      covered++;
      if (Math.abs(f.c - r.c) > 1e-6 || Math.abs(f.o - r.o) > 1e-6
          || Math.abs(f.h - r.h) > 1e-6 || Math.abs(f.l - r.l) > 1e-6 || f.v !== r.v) {
        mism++;
        if (sample.length < 4) sample.push(`${t} ${r.d} c:${r.c} vs ${f.c}`);
      }
    }
  }
  const rows = Object.values(dRows).reduce((a, b) => a + b.length, 0);
  ok(mism === 0, `delta disagrees with snapshot on ${mism} rows: ${sample.join(' | ')}`);
  ok(rows < (manifest.us.rows + manifest.idx.rows) / 10,
     `delta has ${rows} rows — not small enough to be an incremental file`);
  deltaStat = { rows, tickers: Object.keys(dRows).length, matched_against_snapshot: covered };
}

// ---------------------------------------------------------------- report
const summary = {
  files: files.length,
  us: { tickers: Object.keys(us).length, rows: Object.values(us).reduce((a, b) => a + b.length, 0) },
  idx: { tickers: Object.keys(idx).length, rows: Object.values(idx).reduce((a, b) => a + b.length, 0) },
  ihsg: { rows: jkse.length, last_date: lastJkse && lastJkse.d, last_close: lastJkse && lastJkse.c },
  idx_sector: idxSectorStat,
  bbca_split_check: before && after ? { d_before: before.d, c_before: before.c, d_after: after.d, c_after: after.c } : null,
  delta: deltaStat,
  fails: fails.length,
  warns: warns.length,
};
console.log(JSON.stringify(summary, null, 2));
for (const w of warns) console.log('WARN: ' + w);
for (const f of fails) console.log('FAIL: ' + f);
console.log(fails.length === 0 ? '\nEXPORT VERIFIED' : `\nEXPORT REJECTED (${fails.length})`);
process.exit(fails.length === 0 ? 0 : 2);
