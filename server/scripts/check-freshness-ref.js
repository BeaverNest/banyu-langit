#!/usr/bin/env node
/**
 * Regression proof for the freshness ref-date fix.
 *
 * The bug: `ref_date` was MAX(raw frontier). A rail that writes today's bar in the
 * morning (Asian indices, crypto) pushed ref past the last CLOSED session, so every
 * honest series looked "1 session behind" and, with expected_lag_sessions=0, was
 * painted stale. The panel showed "—" for 46 Series that were freshly updated.
 *
 * The fix must keep BOTH halves true:
 *   (a) after market close, a series stuck on the previous session IS stale
 *   (b) before market close, the same series is NOT stale
 *
 * If this test only checked (b), the fix could silently disable the alarm entirely.
 */
const path = require('path');
const FRESH = require(path.join(__dirname, '..', 'utils', 'series-freshness.js'));

const ctx = {
  ref_date: '2026-10-30',
  ref_billable: null, // filled per case
  sessions: [],
  expected_lag: { X: { expected_lag_sessions: 0, lag_basis: 'declared' } },
  pipeline: { state: 'ok' },
  window_from: '2026-01-01',
};

function run(label, nowIso, refBillable, sessions, lastDate, want) {
  const c = Object.assign({}, ctx, { ref_billable: refBillable, sessions });
  const r = FRESH.seriesFreshness(c, lastDate, 'X');
  const ok = r.state === want;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} state=${String(r.state).padEnd(10)} lag=${r.lag_sessions} excess=${r.excess_sessions} want=${want}`
  );
  return ok;
}

let all = true;

// 10:00 WIB on 30 Oct. Today's bar is NOT owed yet: ref billed to 29 Oct.
all &= run('before close, series on last closed session', '2026-10-30T03:00:00Z',
  '2026-10-29', ['2026-10-28', '2026-10-29'], '2026-10-29', 'fresh');

// Same day, series still on 28 Oct -> genuinely one session behind.
all &= run('before close, series one session behind', '2026-10-30T03:00:00Z',
  '2026-10-29', ['2026-10-28', '2026-10-29'], '2026-10-28', 'excess');

// 22:00 WIB on 30 Oct: cutoff passed, today's bar is owed.
all &= run('after close, series stuck on yesterday', '2026-10-30T15:00:00Z',
  '2026-10-30', ['2026-10-28', '2026-10-29', '2026-10-30'], '2026-10-29', 'excess');

// After close and the bar arrived.
all &= run('after close, series current', '2026-10-30T15:00:00Z',
  '2026-10-30', ['2026-10-28', '2026-10-29', '2026-10-30'], '2026-10-30', 'fresh');

// Genuine multi-session lag must survive the fix.
all &= run('before close, series four sessions behind', '2026-10-30T03:00:00Z',
  '2026-10-29', ['2026-10-24', '2026-10-27', '2026-10-28', '2026-10-29'], '2026-10-24', 'excess');

console.log(all ? '\nALL PASS' : '\nFAILURES PRESENT');
process.exit(all ? 0 : 1);
