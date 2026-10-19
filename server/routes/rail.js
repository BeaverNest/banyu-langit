// ═══════════════════════════════════════════════════════════════════════════
// Agent rail — /api/v1/idx/*  (read-only, provenance-first)
//
// Contract: .hermes/profiles/eko/skills/economics/idx-data-pipeline-operations/
//           references/banyu-langit-agent-rail-contract.md
// Design rule: a rail may compute for the agent, it may NOT hide from the agent.
// Every response carries the mandatory envelope —
//   ok, as_of, source_table, code_version, params, unit, rows, missing,
//   is_month_complete
// — with `variant` named (never implied), gaps listed in `missing` (never
// interpolated, never forward-filled) and `code_version` pinning the build.
//
// Nothing in this file writes to the database or triggers an upstream fetch.
// Implemented 2026-09-11 (kanban t_3578a0b7, backend owner: Bima).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const { db, latestIdxDate } = require('../db');
const { getCodeVersion, getCodeVersionSource, getCodeFingerprint } = require('../utils/code-version');
const IND = require('../utils/indicators');
const { registerSqlAdjust } = require('../utils/price-adjust');
const { toIsoDate } = require('../utils/iso-date');

// ca_adj(close, code, trade_date) — harga terkoreksi aksi korporasi untuk query agregat.
registerSqlAdjust(db);

const router = express.Router();

const CODE_RE = /^[A-Z0-9][A-Z0-9._-]{0,11}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Date-column rule: identity list, kept aligned with scripts/audit-rail-freshness.sh
// (its DATE_COLS is a hand-maintained mirror of this list — re-prove with the diff in
// params.counts_reproduce) plus the columns added for the KSEI / issued_history findings
// (kanban t_b00757f3). Deliberately NOT a generic *_date scan: cum_date / dist_date /
// letter_date carry future-dated or empty values, and letting those set as_of makes the
// rail look fresher than the data it serves (the same trap as ann_date, t_bf6259d8).
const DATE_COLS = ['trade_date', 'ann_date', 'period', 'snapshot_month', 'snapshot_date', 'snap_date', 'issue_date', 'date'];
// Tanggal yang tersimpan sebagai teks NON-ISO (DD-MMM-YYYY). MAX() atas teks itu
// membandingkan hari lebih dulu, jadi as_of dihitung dengan menormalkan setiap nilai
// distinct ke ISO — bukan dengan mempercayai MAX() mentah.
const NON_ISO_DATE_COLS = ['issue_date'];
// Tabel yang kolom tanggalnya adalah PERIODE LAPORAN, bukan tanggal kejadian:
// MAX(period) mengembalikan periode terakhir yang ADA (financial_ratios 2026-07-31 =
// SATU baris), bukan periode yang membawa datanya. as_of = periode yang dilaporkan
// paling banyak kode (mode dari MAX(period) per kode); MAX() mentah tetap dikirim
// sebagai as_of_raw supaya periode "kerangka" itu tidak tersembunyi.
const COVERAGE_TABLES = { financial_ratios: 'period' };
const MAX_BARS = 5000;
const MAX_RANGE_DAYS = 3650;
const MAX_CODES = 200;

const SERIES_UNITS = {
  trade_date: 'date', open: 'IDR', high: 'IDR', low: 'IDR', close: 'IDR', prev_close: 'IDR',
  volume: 'shares', value: 'IDR', frequency: 'transactions', foreign_buy: 'shares', foreign_sell: 'shares',
};
const SCORE_UNITS = {
  calc_date: 'date', close: 'IDR', market_cap: 'IDR', rsi14: 'index_points',
  ma5: 'IDR', ma10: 'IDR', ma20: 'IDR', ma50: 'IDR', ma200: 'IDR',
  macd: 'IDR', macd_signal: 'IDR', macd_hist: 'IDR',
  score_composite: 'points_0_100', score_fundamental: 'points_0_100', score_valuation: 'points_0_100',
  score_momentum: 'points_0_100', score_demand: 'points_0_100', score_foreign: 'points_0_100',
};
const SERIES_COLS = ['trade_date', 'open_price', 'high', 'low', 'close', 'prev_close', 'volume', 'value', 'frequency', 'foreign_buy', 'foreign_sell'];
const SCORE_COLS = ['calc_date', 'code', 'name', 'close', 'change_pct', 'sector', 'industry', 'market_cap',
  'score_fundamental', 'score_valuation', 'score_momentum', 'score_demand', 'score_foreign', 'score_composite',
  'roe', 'roa', 'npm', 'der', 'per', 'pbv', 'per_vs_ind', 'pbv_vs_ind', 'div_yield',
  'ma5', 'ma10', 'ma20', 'ma50', 'ma200', 'ma5_pct', 'ma10_pct', 'ma20_pct', 'ma50_pct', 'ma200_pct',
  'rsi14', 'macd', 'macd_signal', 'macd_hist', 'ret_5d', 'ret_20d', 'fnet_5d', 'fnet_dir',
  'bid_offer_ratio', 'bid_offer_5d', 'rel_vol', 'freq_spike', 'val_spike',
  'fnet_10d', 'fnet_20d', 'foreign_pct_val', 'foreign_accum_streak', 'fnet_vs_avg',
  'w_fundamental', 'w_valuation', 'w_momentum', 'w_demand', 'w_foreign', 'variant', 'code_version'];

// ── envelope / error helpers ───────────────────────────────────────────────
function envelope(fields) {
  const base = {
    ok: true,
    as_of: '',
    source_table: '',
    code_version: getCodeVersion(),
    code_version_source: getCodeVersionSource(),
    // code_version = git HEAD (does not move for uncommitted edits);
    // code_fingerprint = hash of the server sources actually running.
    code_fingerprint: getCodeFingerprint(),
    params: {},
    unit: '',
    rows: [],
    missing: [],
    is_month_complete: false,
  };
  return Object.assign(base, fields || {});
}

function fail(res, status, code, message, extra) {
  return res.status(status).json(Object.assign({
    ok: false,
    error: message,
    code,
    code_version: getCodeVersion(),
    code_version_source: getCodeVersionSource(),
    code_fingerprint: getCodeFingerprint(),
  }, extra || {}));
}

// ── Month completeness — one definition, shared with damar's sync guard ────
// (agreed with damar, kanban t_bf6259d8; his daily-sync.sh uses the same rule)
//   * a month that has not elapsed yet is NEVER complete — kills the
//     "27 Sep read on 27 Sep looks complete" false positive;
//   * YYYY-MM of an elapsed month is complete;
//   * YYYY-MM-DD of an elapsed month is complete only if the last date reaches
//     the month end within MONTH_END_TOLERANCE_DAYS: a month whose last trading
//     day is Friday the 26th still counts as complete, while a feed that stopped
//     on the 10th is correctly reported incomplete.
// TZ-safe by construction: month end and "current month" derive from Date.UTC()/
// getUTC*, never from process-local time (the TZ trap reported by damar).
const MONTH_END_TOLERANCE_DAYS = 4;
const IS_MONTH_COMPLETE_RULE = 'YYYY-MM: true once the month has elapsed. YYYY-MM-DD: true only if the month has elapsed AND as_of >= month_end - 4 days. Never true for the current month.';
function isMonthComplete(asOf) {
  if (!asOf || typeof asOf !== 'string') return false;
  const m = asOf.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return false;
  const year = parseInt(m[1], 10), month = parseInt(m[2], 10);
  const now = new Date();
  const current = now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1);
  if (year * 12 + month >= current) return false;   // month still running (or future)
  if (!m[3]) return true;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return parseInt(m[3], 10) >= lastDay - MONTH_END_TOLERANCE_DAYS;
}

function marketDates(from, to) {
  return db.prepare('SELECT DISTINCT trade_date FROM idx_daily WHERE trade_date>=? AND trade_date<=? ORDER BY trade_date')
    .all(from, to).map(r => r.trade_date);
}

// DATE_RE alone accepts 2026-99-99; Date.parse() on that yields NaN and the
// subsequent toISOString() throws a raw HTML 500 (caught by the smoke matrix).
// Validate the calendar date itself, not just its shape.
function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  const parts = s.split('-').map(Number);
  const y = parts[0], m = parts[1], d = parts[2];
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function validateRange(fromQ, toQ, market) {
  const defaults = [];
  let from = fromQ === undefined || fromQ === null ? '' : String(fromQ).trim();
  let to = toQ === undefined || toQ === null ? '' : String(toQ).trim();
  if (!to) { to = market; defaults.push('to=market_as_of'); }
  else if (!isRealDate(to)) return { error: { code: 'INVALID_TO', message: 'to must be a real calendar date YYYY-MM-DD, got ' + JSON.stringify(toQ) } };
  if (!from) {
    from = new Date(Date.parse(to + 'T00:00:00Z') - 365 * 86400000).toISOString().slice(0, 10);
    defaults.push('from=to-365d');
  } else if (!isRealDate(from)) {
    return { error: { code: 'INVALID_FROM', message: 'from must be a real calendar date YYYY-MM-DD, got ' + JSON.stringify(fromQ) } };
  }
  if (from > to) return { error: { code: 'INVALID_RANGE', message: 'from (' + from + ') must be <= to (' + to + ')' } };
  const span = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
  if (span > MAX_RANGE_DAYS) {
    return { error: { code: 'RANGE_TOO_WIDE', message: 'range is ' + Math.round(span) + ' days; max ' + MAX_RANGE_DAYS + ' — narrow the window' } };
  }
  return { from, to, defaults };
}

function readCode(req, res) {
  const code = String(req.query.code || '').toUpperCase().trim();
  if (!code) {
    fail(res, 400, 'MISSING_CODE', 'query parameter code is required', { example: '/api/v1/idx/series?code=BBCA&from=2026-01-01&to=2026-09-11' });
    return null;
  }
  if (!CODE_RE.test(code)) { fail(res, 400, 'INVALID_CODE', 'code must match ' + String(CODE_RE)); return null; }
  return code;
}

// ── GET /api/v1/idx/ : self-description ────────────────────────────────────
router.get('/', (req, res) => {
  res.json(envelope({
    source_table: 'sqlite_master',
    unit: 'endpoints',
    params: { market_as_of: latestIdxDate() || null },
    as_of: latestIdxDate() || '',
    rows: [
      { endpoint: 'GET /api/v1/idx/freshness', params: '[format=json|text]', returns: 'per-table row count, date column, as_of, is_month_complete; format=text mirrors the layout of scripts/audit-rail-freshness.sh — a hand-maintained mirror of this endpoint (the script lives in the eko economics skill, not in this repo) that applies the same date-column and coverage rules, so the two agree byte for byte when the diff is empty; see params.counts_reproduce for the check' },
      { endpoint: 'GET /api/v1/idx/series', params: 'code, from, to', returns: 'raw OHLCV + foreign buy/sell per trading day, gaps in missing[]' },
      { endpoint: 'GET /api/v1/idx/indicator', params: 'code, indicator=rsi|ma|ema|macd, period, variant, from, to', returns: 'value series + variant echo + code_version' },
      { endpoint: 'GET /api/v1/idx/scores', params: 'date, codes', returns: 'persisted daily_scores rows with variant + code_version per row' },
    ],
  }));
});

// ── GET /api/v1/idx/freshness ──────────────────────────────────────────────
router.get('/freshness', (req, res) => {
  const format = String(req.query.format || 'json').toLowerCase();
  if (format !== 'json' && format !== 'text') {
    return fail(res, 400, 'INVALID_FORMAT', "format must be 'json' or 'text'", { parameter: 'format', got: req.query.format, supported: ['json', 'text'] });
  }
  const tableNames = db.prepare('select name from sqlite_master where type = ? order by name').all('table').map(r => r.name);
  const rows = [];
  for (const t of tableNames) {
    let cols = [];
    try {
      const s = db.prepare('select * from "' + t + '" limit 1').get();
      cols = s ? Object.keys(s) : [];
    } catch (e) { cols = []; }
    let count = null;
    try { count = db.prepare('select count(*) c from "' + t + '"').get().c; } catch (e) { count = null; }
    const dc = cols.find(c => DATE_COLS.indexOf(c) !== -1);
    let raw = '';
    let asOf = '';
    let basis = '';
    if (dc && count !== 0) {
      try {
        const v = db.prepare('select max("' + dc + '") m from "' + t + '"').get().m;
        raw = (v === null || v === undefined) ? '' : String(v);
      } catch (e) { raw = 'ERR'; }
      asOf = raw;
      // MAX() atas teks non-ISO membandingkan hari lebih dulu → normalisasi nilai
      // distinct ke ISO (jumlahnya kecil: issued_history 792) lalu ambil yang terbesar.
      if (NON_ISO_DATE_COLS.indexOf(dc) !== -1 && raw && raw !== 'ERR') {
        try {
          const vals = db.prepare('select distinct "' + dc + '" v from "' + t + '" where "' + dc + '" is not null and "' + dc + '" <> \'\'').all();
          let best = '';
          for (const vr of vals) {
            const iso = toIsoDate(vr.v);
            if (iso && (best === '' || iso > best)) best = iso;
          }
          if (best) { asOf = best; basis = 'normalised_non_iso_text'; }
        } catch (e) { /* biarkan as_of = raw; nilai mentah tetap terlihat di as_of_raw */ }
      }
    }
    const row = { table: t, rows: count, date_col: dc || '-', as_of: asOf, as_of_raw: raw, as_of_basis: basis };
    // Periode laporan: as_of = mode(MAX(period) per kode), bukan MAX(period).
    if (dc && count !== 0 && COVERAGE_TABLES[t] === dc) {
      try {
        const col = COVERAGE_TABLES[t];
        const mode = db.prepare(
          'SELECT p AS period, c AS codes FROM ('
          + 'SELECT p AS p, COUNT(*) AS c FROM (SELECT code, MAX("' + col + '") AS p FROM "' + t + '" GROUP BY code)'
          + ' GROUP BY p) ORDER BY c DESC, period DESC LIMIT 1').get();
        if (mode && mode.period) {
          const at = db.prepare('SELECT COUNT(*) n FROM "' + t + '" WHERE "' + col + '"=?').get(mode.period);
          const max = db.prepare('SELECT "' + col + '" p, COUNT(DISTINCT code) c FROM "' + t + '" GROUP BY 1 ORDER BY c DESC, p DESC LIMIT 1').get();
          row.as_of = mode.period;
          row.as_of_basis = 'mode_of_per_code_max_period';
          row.as_of_codes = mode.codes;
          row.as_of_rows = at ? at.n : null;
          if (max) { row.coverage_max_period = max.p; row.coverage_max_codes = max.c; }
        }
      } catch (e) { row.coverage_error = e.message; }
    }
    rows.push(row);
  }
  const w = rows.reduce((a, r) => Math.max(a, r.table.length), 5);
  rows.forEach(r => {
    const display = r.rows === null ? 'ERR' : String(r.rows);
    r.rows_display = display;
    r.script_line = r.table.padEnd(w) + ' ' + display.padStart(10) + ' ' + r.date_col.padStart(12) + '   ' + r.as_of;
  });
  const market = latestIdxDate() || '';
  const dated = rows.map(r => r.as_of).filter(Boolean);
  const maxAsOf = dated.length ? dated.reduce((a, b) => (b > a ? b : a)) : '';
  rows.forEach(r => {
    r.is_month_complete = isMonthComplete(r.as_of);
    r.lag_days = (market && r.as_of.length === 10)
      ? Math.round((Date.parse(market + 'T00:00:00Z') - Date.parse(r.as_of + 'T00:00:00Z')) / 86400000)
      : null;
  });

  if (format === 'text') {
    const header = 'TABLE'.padEnd(w) + ' ' + 'ROWS'.padStart(10) + ' ' + 'DATE_COL'.padStart(12) + '   AS-OF';
    const sep = '-'.repeat(w + 32);
    return res.type('text/plain').send([header, sep].concat(rows.map(r => r.script_line)).join('\n') + '\n');
  }

  return res.json(envelope({
    // Headline as_of = the market clock (idx_daily), NOT the max across tables:
    // company_announcements carries future-dated rows, and letting those set the
    // headline makes the rail look fresher than the market data it serves
    // (flagged by damar, t_bf6259d8). The wider inventory date stays visible in
    // inventory_as_of; per-table dates stay in rows[].as_of.
    as_of: market,
    market_as_of: market,
    inventory_as_of: maxAsOf,
    source_table: 'idx_daily',
    unit: 'rows',
    params: {
      format, tables: rows.length,
      as_of_rule: 'as_of = market clock = max(idx_daily.trade_date); inventory_as_of = max(as_of) over every table reported; per-table dates live in rows[].as_of',
      date_col_rule: 'DATE_COLS (identity list, not a generic *_date scan) = ' + DATE_COLS.join(', ') + '; non-ISO text date columns (' + NON_ISO_DATE_COLS.join(', ') + ') are normalised to YYYY-MM-DD before as_of is taken, and the raw MAX() stays visible in rows[].as_of_raw',
      coverage_rule: 'period-reporting tables (' + Object.keys(COVERAGE_TABLES).join(', ') + '): as_of = mode of MAX(period) per code — the period most codes have most recently reported — not MAX(period); rows[].as_of_raw still carries the raw MAX(period), rows[].coverage_max_period the widest-coverage period',
      is_month_complete_rule: IS_MONTH_COMPLETE_RULE,
      inventory_as_of: maxAsOf,
      counts_reproduce: 'scripts/audit-rail-freshness.sh (format=text) is a hand-maintained MIRROR of this endpoint, not generated from it: the rows/date_col/as_of layout and the date-column + coverage rules above match on both sides. Byte equality is a property to re-prove, not a claim — diff <(bash scripts/audit-rail-freshness.sh) <(curl -sS http://127.0.0.1:3003/api/v1/idx/freshness?format=text) must be empty; it was empty on 2026-10-19 (60 lines each, md5 2ec488c8bfd2724109a52b3aba5d1aa4), and the mirror can drift the next time either rule changes on one side only',
    },
    rows,
    missing: rows.filter(r => !r.as_of).map(r => r.table),
    is_month_complete: isMonthComplete(market),
  }));
});

// ── GET /api/v1/idx/series ─────────────────────────────────────────────────
router.get('/series', (req, res) => {
  const code = readCode(req, res);
  if (!code) return;
  const market = latestIdxDate() || '';
  if (!market) return fail(res, 409, 'NO_DATA', 'idx_daily is empty — nothing to serve');
  const range = validateRange(req.query.from, req.query.to, market);
  if (range.error) return fail(res, 400, range.error.code, range.error.message, { market_as_of: market });
  if (!db.prepare('SELECT 1 FROM idx_daily WHERE code=? LIMIT 1').get(code)) {
    return fail(res, 404, 'UNKNOWN_CODE', 'code ' + code + ' has no rows in idx_daily');
  }
  const raw = db.prepare('SELECT ' + SERIES_COLS.join(',') + ' FROM idx_daily WHERE code=? AND trade_date>=? AND trade_date<=? ORDER BY trade_date LIMIT ' + MAX_BARS)
    .all(code, range.from, range.to);
  const rows = raw.map(r => ({
    trade_date: r.trade_date, open: r.open_price, high: r.high, low: r.low, close: r.close,
    prev_close: r.prev_close, volume: r.volume, value: r.value, frequency: r.frequency,
    foreign_buy: r.foreign_buy, foreign_sell: r.foreign_sell,
  }));
  const have = new Set(rows.map(r => r.trade_date));
  const missing = marketDates(range.from, range.to).filter(d => !have.has(d));
  const lastBar = rows.length ? rows[rows.length - 1].trade_date : '';
  return res.json(envelope({
    as_of: lastBar,
    market_as_of: market,
    source_table: 'idx_daily',
    unit: 'per_field',
    units: SERIES_UNITS,
    params: {
      code, from: range.from, to: range.to, rows: rows.length,
      truncated: raw.length >= MAX_BARS,
      as_of_rule: 'max(trade_date) of the rows returned for this code',
      is_month_complete_rule: IS_MONTH_COMPLETE_RULE,
    },
    rows, missing,
    is_month_complete: isMonthComplete(lastBar),
    defaults_applied: range.defaults,
  }));
});

// ── GET /api/v1/idx/indicator ──────────────────────────────────────────────
router.get('/indicator', (req, res) => {
  const code = readCode(req, res);
  if (!code) return;
  const market = latestIdxDate() || '';
  if (!market) return fail(res, 409, 'NO_DATA', 'idx_daily is empty — nothing to serve');

  const defaults = [];
  let indicator = req.query.indicator ? String(req.query.indicator).toLowerCase().trim() : 'rsi';
  if (!req.query.indicator) defaults.push('indicator=rsi');
  if (indicator === 'ema') indicator = 'ema';   // kept distinct for the echo
  const spec = IND.SUPPORTED[indicator];
  if (!spec || !spec.variants) {
    return fail(res, 400, 'UNSUPPORTED_INDICATOR', 'indicator ' + JSON.stringify(req.query.indicator) + ' is not implemented', {
      parameter: 'indicator',
      supported: ['rsi', 'ma', 'ema', 'macd'],
      variants: { rsi: IND.RSI_VARIANTS, ma: IND.MA_VARIANTS, macd: IND.MACD_VARIANTS },
    });
  }

  let period = null;
  if (indicator !== 'macd') {
    if (req.query.period === undefined || req.query.period === '') {
      period = spec.default_period;
      defaults.push('period=' + period);
    } else {
      period = parseInt(req.query.period, 10);
      if (!Number.isInteger(period) || period < 2 || period > 250) {
        return fail(res, 400, 'INVALID_PERIOD', 'period must be an integer between 2 and 250', { parameter: 'period', got: req.query.period });
      }
    }
  }

  let variant;
  if (req.query.variant === undefined || req.query.variant === '') {
    variant = spec.default_variant;
    defaults.push('variant=' + variant);
  } else {
    variant = String(req.query.variant).toLowerCase().trim();
    if (spec.variants.indexOf(variant) === -1) {
      return fail(res, 400, 'UNSUPPORTED_VARIANT', 'variant ' + JSON.stringify(variant) + ' is not implemented for indicator ' + indicator, {
        parameter: 'variant', indicator, supported_variants: spec.variants, default_variant: spec.default_variant,
      });
    }
  }

  const range = validateRange(req.query.from, req.query.to, market);
  if (range.error) return fail(res, 400, range.error.code, range.error.message, { market_as_of: market });
  if (!db.prepare('SELECT 1 FROM idx_daily WHERE code=? LIMIT 1').get(code)) {
    return fail(res, 404, 'UNKNOWN_CODE', 'code ' + code + ' has no rows in idx_daily');
  }

  // Pull every bar up to `to` so warm-up happens on real history, not on the
  // requested window: a value at `from` must not depend on where the window starts.
  // ca_adj: deret harga dikoreksi aksi korporasi (ca_factors) — tanpa ini RSI/MA
  // nama pasca-split tidak sebanding dengan daily_scores (lihat utils/indicators.js).
  const hist = db.prepare('SELECT trade_date, close, ca_adj(close, code, trade_date) AS ac FROM idx_daily WHERE code=? AND trade_date<=? ORDER BY trade_date DESC LIMIT ' + MAX_BARS).all(code, range.to);
  hist.reverse();
  const closes = hist.map(r => (r.ac != null ? r.ac : r.close));
  const engine = indicator === 'ema' ? 'ma' : indicator;
  const series = IND.compute(engine, variant, closes, period);

  const valueByDate = new Map();
  for (let i = 0; i < hist.length; i++) {
    if (series[i] !== null && series[i] !== undefined) valueByDate.set(hist[i].trade_date, series[i]);
  }
  const rows = hist
    .filter(r => r.trade_date >= range.from && r.trade_date <= range.to && valueByDate.has(r.trade_date))
    .map(r => Object.assign({ trade_date: r.trade_date }, valueByDate.get(r.trade_date)));
  const have = new Set(rows.map(r => r.trade_date));
  const missing = marketDates(range.from, range.to).filter(d => !have.has(d));
  const lastValue = rows.length ? rows[rows.length - 1].trade_date : '';
  const need = IND.samplesRequired(engine, period);
  const barsInRangeNoValue = hist.filter(r => r.trade_date >= range.from && r.trade_date <= range.to && !have.has(r.trade_date)).length;

  return res.json(envelope({
    as_of: lastValue,
    market_as_of: market,
    source_table: 'idx_daily',
    unit: spec.unit,
    params: {
      code, indicator, period, variant,
      from: range.from, to: range.to, rows: rows.length,
      variant_source: defaults.indexOf('variant=' + variant) === -1 ? 'explicit' : 'default',
      variant_definition: indicator === 'rsi'
        ? (variant === 'cutler' ? 'simple mean of the last `period` up/down moves (what Banyu Langit itself uses)' : "Wilder's smoothing seeded with the first SMA (textbook RSI)")
        : (indicator === 'macd' ? 'MACD 12/26/9 with signal = 9-period EMA of the full MACD line (SMA-9 seed)' : variant + ' of the last `period` closes'),
      precision: indicator === 'rsi' ? 'rsi 1 dp' : (indicator === 'macd' ? 'macd/signal/hist 2 dp' : 'price rounded to IDR'),
      warmup: {
        samples_required: need,
        samples_available: hist.length,
        first_computable_date: hist.length >= need ? hist[need - 1].trade_date : null,
        bars_in_range_without_value: barsInRangeNoValue,
      },
      history_truncated: hist.length >= MAX_BARS,
      price_basis: 'adjusted_for_corporate_actions (ca_factors, back-adjusted; same basis as daily_scores)',
      as_of_rule: 'max(trade_date) carrying a computed value in the requested window',
      is_month_complete_rule: IS_MONTH_COMPLETE_RULE,
    },
    rows, missing,
    is_month_complete: isMonthComplete(lastValue),
    defaults_applied: defaults,
  }));
});

// ── GET /api/v1/idx/scores ─────────────────────────────────────────────────
router.get('/scores', (req, res) => {
  const defaults = [];
  let date = req.query.date === undefined ? '' : String(req.query.date).trim();
  if (!date) {
    const r = db.prepare('SELECT MAX(calc_date) d FROM daily_scores').get();
    date = r && r.d ? r.d : '';
    if (date) defaults.push('date=max(calc_date)');
  } else if (!isRealDate(date)) {
    return fail(res, 400, 'INVALID_DATE', 'date must be a real calendar date YYYY-MM-DD, got ' + JSON.stringify(req.query.date));
  }

  let codes = null;
  if (req.query.codes !== undefined && String(req.query.codes).trim()) {
    codes = String(req.query.codes).split(',').map(c => c.toUpperCase().trim()).filter(Boolean);
    if (!codes.length || codes.length > MAX_CODES) {
      return fail(res, 400, 'INVALID_CODES', 'codes must be 1..' + MAX_CODES + ' comma-separated tickers', { got: req.query.codes });
    }
    const bad = codes.find(c => !CODE_RE.test(c));
    if (bad) return fail(res, 400, 'INVALID_CODE', 'code must match ' + String(CODE_RE) + ', got ' + JSON.stringify(bad));
  }

  if (!date) {
    return res.json(envelope({
      source_table: 'daily_scores', unit: 'per_field', units: SCORE_UNITS,
      params: { date: '', codes: codes || 'all' },
      rows: [], missing: codes || [],
      note: 'daily_scores is empty — run POST /api/idx/composite-score (the /api/idx/sync/* endpoints now do this automatically)',
    }));
  }

  const params = [date].concat(codes || []);
  const sql = 'SELECT ' + SCORE_COLS.join(',') + ' FROM daily_scores WHERE calc_date=?'
    + (codes ? ' AND code IN (' + codes.map(() => '?').join(',') + ')' : '')
    + ' ORDER BY score_composite DESC';
  const rows = db.prepare(sql).all(...params);
  const have = new Set(rows.map(r => r.code));
  const missing = codes ? codes.filter(c => !have.has(c)) : [];
  const variants = Array.from(new Set(rows.map(r => r.variant || '(unstamped)'))).sort();
  const builds = Array.from(new Set(rows.map(r => r.code_version || '(unstamped)'))).sort();

  return res.json(envelope({
    as_of: rows.length ? date : '',
    market_as_of: latestIdxDate() || '',
    source_table: 'daily_scores',
    unit: 'per_field',
    units: SCORE_UNITS,
    params: { date, codes: codes || 'all', codes_missing: missing.length, rows: rows.length, is_month_complete_rule: IS_MONTH_COMPLETE_RULE },
    rows, missing,
    is_month_complete: isMonthComplete(rows.length ? date : ''),
    provenance: { variants, code_versions: builds },
    defaults_applied: defaults,
  }));
});

// Defence in depth: an unexpected throw still answers in the JSON error shape
// instead of Express's HTML 500 page.
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  return fail(res, 500, 'INTERNAL', 'rail failure: ' + ((err && err.message) || String(err)));
});

// Every rail error is JSON {ok:false,...} — an unknown rail path must never fall
// through to Express's HTML 404 (contract: "error harus JSON, bukan crash raw").
router.use((req, res) => fail(res, 404, 'NOT_FOUND',
  'no such rail endpoint: ' + req.method + ' /api/v1/idx' + req.path,
  { endpoints: ['/api/v1/idx/freshness', '/api/v1/idx/series', '/api/v1/idx/indicator', '/api/v1/idx/scores'] }));

module.exports = router;
