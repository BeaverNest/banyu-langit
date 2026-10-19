// ═══════════════════════════════════════════════════════════════════════════
// Variant-explicit indicator engines for the agent rail (/api/v1/idx/indicator).
//
// Contract rules these functions obey:
//   * the variant is a REQUIRED input, never an implicit default inside the math
//     (the route resolves the default and echoes it back to the caller);
//   * every series is aligned 1:1 with the input closes array; an index that
//     cannot be computed yet is `null` — the route turns nulls into `missing[]`,
//     it never forward-fills or interpolates;
//   * rounding mirrors what the server already publishes (RSI 1 dp like
//     daily_scores.rsi14, MA integer like the screener/composite-score path,
//     MACD 2 dp) so rail values and stored values stay comparable.
//
// RSI variants (both well defined, they DO disagree — measured 2026-09-11,
// 100 emiten: mean |Δ| = 4.10 pts, 11/100 flip the 70/30 label):
//   cutler : simple mean of the last `period` up/down moves   <- what BL uses
//   wilder : Wilder's smoothing, seeded with the first SMA     <- the textbook RSI
// MACD is 12/26/9 with signal = true 9-period EMA of the FULL MACD line
// (SMA-9 seed, then recursive) — the same math as screener.js / backtest.js.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

function round(v, dp) {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

// ── RSI ────────────────────────────────────────────────────────────────────
function rsiSeries(closes, period, variant) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (variant === 'cutler') {
    const gains = [], losses = [];
    for (let i = 0; i < n; i++) {
      const d = i === 0 ? 0 : closes[i] - closes[i - 1];
      gains.push(d > 0 ? d : 0);
      losses.push(d < 0 ? -d : 0);
    }
    for (let i = period; i < n; i++) {
      let g = 0, l = 0;
      for (let j = i - period + 1; j <= i; j++) { g += gains[j]; l += losses[j]; }
      const ag = g / period, al = l / period;
      out[i] = al === 0 ? 100 : round(100 - 100 / (1 + ag / al), 1);
    }
    return out;
  }
  if (variant === 'wilder') {
    if (n < period + 1) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) g += d; else l -= d;
    }
    let ag = g / period, al = l / period;
    out[period] = al === 0 ? 100 : round(100 - 100 / (1 + ag / al), 1);
    for (let i = period + 1; i < n; i++) {
      const d = closes[i] - closes[i - 1];
      const gain = d > 0 ? d : 0, loss = d < 0 ? -d : 0;
      ag = (ag * (period - 1) + gain) / period;
      al = (al * (period - 1) + loss) / period;
      out[i] = al === 0 ? 100 : round(100 - 100 / (1 + ag / al), 1);
    }
    return out;
  }
  throw new Error('unknown rsi variant: ' + variant);
}

// ── Moving averages ────────────────────────────────────────────────────────
function maSeries(closes, period, variant) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (variant === 'sma') {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += closes[i];
      if (i >= period) sum -= closes[i - period];
      if (i >= period - 1) out[i] = Math.round(sum / period);
    }
    return out;
  }
  if (variant === 'ema') {
    if (n < period) return out;
    const k = 2 / (period + 1);
    let v = 0;
    for (let i = 0; i < period; i++) v += closes[i];
    v /= period;
    out[period - 1] = Math.round(v);
    for (let i = period; i < n; i++) {
      v = closes[i] * k + v * (1 - k);
      out[i] = Math.round(v);
    }
    return out;
  }
  throw new Error('unknown ma variant: ' + variant);
}

// ── MACD (12/26/9) ─────────────────────────────────────────────────────────
function macdSeries(closes, fast, slow, signalPeriod) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n < slow + signalPeriod - 1) return out;
  const kF = 2 / (fast + 1), kS = 2 / (slow + 1);
  const line = new Array(n).fill(null);
  let ef = null, es = null, sf = 0, ss = 0;
  for (let i = 0; i < n; i++) {
    sf += closes[i]; ss += closes[i];
    if (i >= fast) sf -= closes[i - fast];
    if (i >= slow) ss -= closes[i - slow];
    ef = i === fast - 1 ? sf / fast : (i > fast - 1 ? closes[i] * kF + ef * (1 - kF) : null);
    es = i === slow - 1 ? ss / slow : (i > slow - 1 ? closes[i] * kS + es * (1 - kS) : null);
    if (ef !== null && es !== null) line[i] = ef - es;
  }
  const first = slow - 1;
  const dense = line.slice(first);
  const sig = new Array(dense.length).fill(null);
  if (dense.length >= signalPeriod) {
    const k9 = 2 / (signalPeriod + 1);
    let v = 0;
    for (let t = 0; t < signalPeriod; t++) v += dense[t];
    v /= signalPeriod;
    sig[signalPeriod - 1] = v;
    for (let t = signalPeriod; t < dense.length; t++) {
      v = dense[t] * k9 + v * (1 - k9);
      sig[t] = v;
    }
  }
  for (let t = 0; t < dense.length; t++) {
    const i = first + t;
    if (line[i] === null || sig[t] === null) continue;
    out[i] = {
      macd: round(line[i], 2),
      signal: round(sig[t], 2),
      hist: round(line[i] - sig[t], 2),
    };
  }
  return out;
}

const RSI_VARIANTS = ['cutler', 'wilder'];
const MA_VARIANTS = ['sma', 'ema'];
const MACD_VARIANTS = ['ema9_standard'];
const SUPPORTED = {
  rsi: { variants: RSI_VARIANTS, default_variant: 'cutler', default_period: 14, unit: 'index_points' },
  ma: { variants: MA_VARIANTS, default_variant: 'sma', default_period: 20, unit: 'IDR' },
  ema: { variants: ['ema'], default_variant: 'ema', default_period: 20, unit: 'IDR' },
  macd: { variants: MACD_VARIANTS, default_variant: 'ema9_standard', default_period: null, unit: 'IDR' },
  macd_fast: { variants: null },
};

// samples needed before the first computable value (0-based index + 1)
function samplesRequired(indicator, period) {
  if (indicator === 'rsi') return period + 1;
  if (indicator === 'ma' || indicator === 'ema') return period;
  return 26 + 9 - 1;   // macd: slow + signal - 1
}

function compute(indicator, variant, closes, period) {
  if (indicator === 'rsi') return rsiSeries(closes, period, variant).map(v => (v === null ? null : { value: v }));
  if (indicator === 'ma' || indicator === 'ema') return maSeries(closes, period, variant).map(v => (v === null ? null : { value: v }));
  if (indicator === 'macd') return macdSeries(closes, 12, 26, 9);
  throw new Error('unknown indicator: ' + indicator);
}

module.exports = { rsiSeries, maSeries, macdSeries, compute, samplesRequired, SUPPORTED, RSI_VARIANTS, MA_VARIANTS, MACD_VARIANTS, round };
