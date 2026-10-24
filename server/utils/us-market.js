'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// US MARKET — satu payload untuk menu US Market (Indices, Breadth, Sectors)
//
// Semua angka berasal dari tabel yang sudah dipakai tempat lain:
//   us_daily           -> harga adjusted (split + dividen), 1.400+ simbol
//   signals_daily      -> ret_1d/5d/20d, rsi14, dist_ma200, flag sinyal
//   us_symbols_meta    -> nama, sektor, industri, market cap
//
// Asumsi yang ditulis di UI:
//   - "Indeks" di sini adalah ETF proxy (SPY/QQQ/DIA/IWM), bukan ^GSPC/^IXIC/^DJI.
//     Tabel us_daily tidak memuat indeks ber-simbol caret; ETF dipakai karena
//     diperdagangkan, punya volume, dan harganya adjusted. Konsekuensinya level
//     absolutnya BUKAN level indeks (SPY ~760 vs S&P 500 ~6.800).
//   - Return dihitung dari close yang sudah adjusted; split/dividen tidak membuat
//     return palsu.
//   - Agregasi sektor memakai MEDIAN, bukan rata-rata: satu saham +400% (hasil
//     akuisisi) tidak boleh mewakili seluruh sektor.
// ═══════════════════════════════════════════════════════════════════════════════

const PROXIES = [
  { code: 'SPY', label: 'S&P 500', note: 'SPDR S&P 500 ETF' },
  { code: 'QQQ', label: 'Nasdaq 100', note: 'Invesco QQQ Trust' },
  { code: 'DIA', label: 'Dow 30', note: 'SPDR Dow Jones ETF' },
  { code: 'IWM', label: 'Russell 2000', note: 'iShares Russell 2000' }
];

function median(arr) {
  const v = arr.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function pct(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return (a / b - 1) * 100;
}

function buildUsMarket(db, opts = {}) {
  const days = Math.min(Math.max(parseInt(opts.days, 10) || 250, 40), 1300);

  // ── Sesi acuan: tanggal terakhir yang punya data sinyal. Harga dan breadth harus
  // berhenti di hari yang sama; kalau tidak, "breadth hari ini" bisa dihitung dari
  // harga kemarin sementara tabel menampilkan harga hari ini.
  const ref = db.prepare(
    "SELECT MAX(trade_date) AS d FROM signals_daily WHERE market='US'"
  ).get();
  const asOf = ref && ref.d ? ref.d : null;
  if (!asOf) return { ok: false, error: 'signals_daily US kosong' };

  // ── 1. Indeks proxy ───────────────────────────────────────────────────────────
  const indices = [];
  for (const p of PROXIES) {
    const bars = db.prepare(
      'SELECT trade_date, open, high, low, close, volume FROM us_daily WHERE code=? ORDER BY trade_date DESC LIMIT ?'
    ).all(p.code, days).reverse();
    if (!bars.length) { indices.push({ ...p, available: false }); continue; }

    const closes = bars.map(b => ({ d: b.trade_date, c: b.close })).filter(b => Number.isFinite(b.c));
    const n = closes.length;
    const last = closes[n - 1];
    const at = k => (n >= k + 1 ? closes[n - 1 - k].c : null);

    // YTD: bandingkan dengan sesi terakhir tahun sebelumnya.
    let ytdBase = null;
    const yr = String(last.d).slice(0, 4);
    for (let i = n - 1; i >= 0; i--) {
      if (String(closes[i].d).slice(0, 4) !== yr) { ytdBase = closes[i].c; break; }
    }

    const hi = Math.max(...closes.map(b => b.c));
    const lo = Math.min(...closes.map(b => b.c));

    indices.push({
      ...p,
      available: true,
      last: last.c,
      as_of: last.d,
      chg_1d: pct(last.c, at(1)),
      chg_5d: pct(last.c, at(5)),
      chg_20d: pct(last.c, at(20)),
      chg_ytd: pct(last.c, ytdBase),
      hi_range: hi,
      lo_range: lo,
      pct_from_hi: pct(last.c, hi),
      series: closes.map(b => ({ time: b.d, value: Math.round(b.c * 100) / 100 }))
    });
  }

  // ── 2. Breadth dari signals_daily ────────────────────────────────────────────
  const sig = db.prepare(
    `SELECT s.code, s.close, s.ret_1d, s.ret_5d, s.ret_20d, s.rsi14, s.dist_ma200,
            s.vol_ratio, s.f_trend_up, s.f_cross200_up, s.f_vol_spike, s.f_break20,
            s.f_oversold, s.f_overbought, m.sector, m.name, m.market_cap, m.quote_type
     FROM signals_daily s LEFT JOIN us_symbols_meta m ON m.code = s.code
     WHERE s.market='US' AND s.trade_date = ?`
  ).all(asOf);

  // Breadth & median dihitung dari EKUITAS saja. ETF tidak punya sektor dan
  // pergerakannya mengikuti indeksnya, jadi memasukkannya menghitung pasar dua kali
  // (SPY mewakili 500 saham). Jumlah yang dikeluarkan dilaporkan, bukan disembunyikan.
  const eq = sig.filter(r => (r.quote_type || 'EQUITY') !== 'ETF');
  const nEtf = sig.length - eq.length;

  const adv = eq.filter(r => Number.isFinite(r.ret_1d) && r.ret_1d > 0).length;
  const dec = eq.filter(r => Number.isFinite(r.ret_1d) && r.ret_1d < 0).length;
  const unch = eq.length - adv - dec;
  const above = () => eq.filter(r => Number.isFinite(r.dist_ma200) && r.dist_ma200 > 0).length;

  // Sesi sebelumnya untuk membandingkan breadth (apakah breadth membaik atau memburuk)
  const prevDate = db.prepare(
    "SELECT MAX(trade_date) d FROM signals_daily WHERE market='US' AND trade_date < ?"
  ).get(asOf);
  const prevSig = prevDate && prevDate.d ? db.prepare(
    "SELECT ret_1d, dist_ma200 FROM signals_daily WHERE market='US' AND trade_date = ?"
  ).all(prevDate.d) : [];
  const prevAdv = prevSig.filter(r => Number.isFinite(r.ret_1d) && r.ret_1d > 0).length;
  const prevAbove = prevSig.filter(r => Number.isFinite(r.dist_ma200) && r.dist_ma200 > 0).length;

  const pctOf = (k, tot) => (tot > 0 ? (k / tot) * 100 : null);

  const breadth = {
    n: eq.length,
    n_etf_excluded: nEtf,
    adv, dec, unch,
    adv_pct: pctOf(adv, eq.length),
    dec_pct: pctOf(dec, eq.length),
    unch_pct: pctOf(unch, eq.length),
    above_ma200: above(),
    above_ma200_pct: pctOf(above(), eq.length),
    prev_date: prevDate ? prevDate.d : null,
    prev_adv: prevSig.length ? prevAdv : null,
    prev_above_ma200_pct: prevSig.length ? pctOf(prevAbove, prevSig.length) : null,
    median_ret_1d: median(eq.map(r => r.ret_1d)),
    median_ret_5d: median(eq.map(r => r.ret_5d)),
    median_ret_20d: median(eq.map(r => r.ret_20d)),
    trend_up: eq.filter(r => r.f_trend_up).length,
    cross200_up: eq.filter(r => r.f_cross200_up).length,
    vol_spike: eq.filter(r => r.f_vol_spike).length,
    break20: eq.filter(r => r.f_break20).length,
    oversold: eq.filter(r => r.f_oversold).length,
    overbought: eq.filter(r => r.f_overbought).length
  };

  // ── 3. Sektor ────────────────────────────────────────────────────────────────
  const bySector = new Map();
  for (const r of eq) {
    const s = r.sector || '(tanpa sektor)';
    if (!bySector.has(s)) bySector.set(s, []);
    bySector.get(s).push(r);
  }
  const sectors = [];
  for (const [name, rows] of bySector) {
    const a = rows.filter(r => Number.isFinite(r.ret_1d) && r.ret_1d > 0).length;
    const d = rows.filter(r => Number.isFinite(r.ret_1d) && r.ret_1d < 0).length;
    const up = rows.filter(r => Number.isFinite(r.dist_ma200) && r.dist_ma200 > 0).length;
    sectors.push({
      sector: name,
      n: rows.length,
      adv: a, dec: d,
      adv_pct: pctOf(a, rows.length),
      median_ret_1d: median(rows.map(r => r.ret_1d)),
      median_ret_5d: median(rows.map(r => r.ret_5d)),
      median_ret_20d: median(rows.map(r => r.ret_20d)),
      median_dist_ma200: median(rows.map(r => r.dist_ma200)),
      above_ma200_pct: pctOf(up, rows.length),
      median_rsi: median(rows.map(r => r.rsi14))
    });
  }
  sectors.sort((a, b) => (b.median_ret_20d ?? -1e9) - (a.median_ret_20d ?? -1e9));

  // ── 4. Movers: hanya simbol dengan market cap diketahui, supaya ticker mikro
  // (yang harganya bisa +300% karena satu transaksi) tidak mendominasi daftar.
  // Ekuitas saja (ETF keluar), market cap wajib ada, dan harga >= $1: di bawah itu
  // pergerakan 1D hampir selalu noise tick mikro, bukan pergerakan yang bisa ditindak.
  const withCap = eq.filter(r => Number.isFinite(r.market_cap) && r.market_cap > 0
    && Number.isFinite(r.close) && r.close >= 1);
  const rank = withCap.slice().sort((a, b) => (b.ret_1d ?? -1e9) - (a.ret_1d ?? -1e9));
  const pack = r => ({
    code: r.code, name: r.name || null, sector: r.sector || null,
    last: r.close, ret_1d: r.ret_1d, ret_5d: r.ret_5d, ret_20d: r.ret_20d,
    rsi14: r.rsi14, dist_ma200: r.dist_ma200, vol_ratio: r.vol_ratio, market_cap: r.market_cap
  });

  return {
    ok: true,
    market: 'US',
    as_of: asOf,
    generated_at: new Date().toISOString(),
    n_symbols: sig.length,
    n_meta: db.prepare('SELECT COUNT(*) n FROM us_symbols_meta').get().n,
    params: { days },
    indices,
    breadth,
    sectors,
    movers: { gainers: rank.slice(0, 12).map(pack), losers: rank.slice(-12).reverse().map(pack) },
    method: {
      index_proxy: 'ETF (SPY/QQQ/DIA/IWM), bukan indeks caret — level absolut bukan level indeks',
      price_basis: 'adjusted close (split + dividen)',
      aggregation: 'median lintas emiten untuk angka sektor',
      mover_filter: 'hanya simbol dengan market cap terisi',
      breadth_source: 'signals_daily (ret_1d sign, dist_ma200), ekuitas saja',
      etf_excluded: 'ETF dikeluarkan dari breadth/sektor/mover; jumlahnya dilaporkan',
      mover_filter2: 'harga >= $1 dan market cap terisi'
    }
  };
}

module.exports = { buildUsMarket };
