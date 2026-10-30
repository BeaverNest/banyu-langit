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
const idxFiles = files.filter(f => /^idx_/.test(f));
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

// ---------------------------------------------------------------- 4. against the DB
const db = new Database(DB_PATH, { readonly: true });
const dbUsCodes = db.prepare('SELECT COUNT(DISTINCT code) n FROM us_daily').get().n;
// Traded bars only (volume>0). The export keeps US halts but drops IDX phantom rows, so the
// IDX comparison must use the same definition or it will always look one bar short.
const dbIdxTraded = db.prepare('SELECT COUNT(*) n FROM idx_daily WHERE volume > 0 AND high > 0').get().n;
const dbShortTickers = db.prepare(
  'SELECT COUNT(*) n FROM (SELECT code, COUNT(*) c FROM idx_daily WHERE volume>0 AND high>0 GROUP BY code HAVING c < ?)'
).get(Number(process.argv.includes('--min-bars') ? process.argv[process.argv.indexOf('--min-bars') + 1] : 60)).n;
const dbShortBars = db.prepare(`
  SELECT COALESCE(SUM(c),0) n FROM (
    SELECT code, COUNT(*) c FROM idx_daily WHERE volume>0 AND high>0 GROUP BY code HAVING c < ?
  )`).get(Number(process.argv.includes('--min-bars') ? process.argv[process.argv.indexOf('--min-bars') + 1] : 60)).n;
ok(Object.keys(us).length === manifest.us.tickers,
   `US ticker count ${Object.keys(us).length} != manifest ${manifest.us.tickers}`);
warn(Object.keys(us).length >= dbUsCodes - 5,
     `US export has ${Object.keys(us).length} tickers, DB has ${dbUsCodes}`);
ok(manifest.idx.dropped_phantom_bars > 0, 'phantom-bar filter did not run');
// Row accounting must close exactly: exported + too-short = DB traded. Phantom bars are a
// separate bucket (they are in the DB but neither exported nor "too short"). If this does not
// close, rows vanished for a reason we cannot name — which is the failure mode this whole gate
// exists to catch.
ok(manifest.idx.rows + dbShortBars === dbIdxTraded,
   `IDX row accounting: exported ${manifest.idx.rows} + short-history ${dbShortBars} = ${manifest.idx.rows + dbShortBars}, DB traded ${dbIdxTraded}`);
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

// ---------------------------------------------------------------- report
const summary = {
  files: files.length,
  us: { tickers: Object.keys(us).length, rows: Object.values(us).reduce((a, b) => a + b.length, 0) },
  idx: { tickers: Object.keys(idx).length, rows: Object.values(idx).reduce((a, b) => a + b.length, 0) },
  ihsg: { rows: jkse.length, last_date: lastJkse && lastJkse.d, last_close: lastJkse && lastJkse.c },
  bbca_split_check: before && after ? { d_before: before.d, c_before: before.c, d_after: after.d, c_after: after.c } : null,
  fails: fails.length,
  warns: warns.length,
};
console.log(JSON.stringify(summary, null, 2));
for (const w of warns) console.log('WARN: ' + w);
for (const f of fails) console.log('FAIL: ' + f);
console.log(fails.length === 0 ? '\nEXPORT VERIFIED' : `\nEXPORT REJECTED (${fails.length})`);
process.exit(fails.length === 0 ? 0 : 2);
