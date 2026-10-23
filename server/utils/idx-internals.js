'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// INTERNALS IDX untuk monitor lintas aset (kanban t_19f4f0d4).
//
// Satu query bulk untuk ~201 sesi (≈193 ribu baris, ~350 ms) lalu semua turunan dihitung di
// JS: breadth, foreign flow 1D/5D/20D, nilai transaksi vs MA20, ARA/ARB, adv/dec, sektor
// teratas/terbawah, dan konsentrasi kepemilikan ≥1% dari `ownership_1pct`.
//
// Kenapa bulk, bukan N+1 seperti panel lama: /api/idx/market-regime menghitung breadth dengan
// SATU QUERY PER SAHAM (989 saham × 200 bar) = ~2 detik per request. Halaman baru memuat satu
// endpoint, jadi biayanya harus dibayar sekali.
//
// Aturan yang TIDAK boleh dilanggar (sama dengan panel lama):
//  - Harga di-MA memakai `ca_adj(close,...)` (terkoreksi aksi korporasi). Tanpa itu breadth
//    berubah hanya karena split.
//  - Foreign flow dihitung dari `idx_daily` per saham, BUKAN `foreign_trading` (tabel itu
//    berhenti 2026-09-30 sehingga angka 30 Sep akan tampil sebagai "hari ini").
//  - Nilai transaksi memakai `value` apa adanya (rupiah sesi itu), bukan harga terkoreksi.
//  - Sektor = rata-rata setara (equal weight) dari anggota yang punya `company_profiles.sector`;
//    TIDAK memakai tabel sectoral_movement (berhenti 30 Sep, dan change_pct-nya kumulatif).
// ═══════════════════════════════════════════════════════════════════════════

const r2 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);

const SECTOR_ORDER = [
  'IDX Sector Energy', 'IDX Sector Basic Materials', 'IDX Sector Industrials',
  'IDX Sector Consumer Non-Cyclicals', 'IDX Sector Consumer Cyclicals',
  'IDX Sector Healthcare', 'IDX Sector Financials', 'IDX Sector Properties & Real Estate',
  'IDX Sector Technology', 'IDX Sector Infrastructures', 'IDX Sector Transportation & Logistic',
];
const SECTOR_LABELS = {
  'IDX Sector Energy': 'Energi',
  'IDX Sector Basic Materials': 'Barang Baku',
  'IDX Sector Industrials': 'Perindustrian',
  'IDX Sector Consumer Non-Cyclicals': 'Konsumen Primer',
  'IDX Sector Consumer Cyclicals': 'Konsumen Non-Primer',
  'IDX Sector Healthcare': 'Kesehatan',
  'IDX Sector Financials': 'Keuangan',
  'IDX Sector Properties & Real Estate': 'Properti & Real Estat',
  'IDX Sector Technology': 'Teknologi',
  'IDX Sector Infrastructures': 'Infrastruktur',
  'IDX Sector Transportation & Logistic': 'Transportasi & Logistik',
};

function sessionsBack(db, n) {
  return db.prepare('SELECT DISTINCT trade_date AS d FROM idx_daily ORDER BY trade_date DESC LIMIT ?')
    .all(n).map(r => r.d).reverse();          // ASC
}

/**
 * Hitung semua internals IDX.
 * @param {import('better-sqlite3').Database} db
 * @param {{sessions?:number, sectorLimit?:number}} [opts]
 */
function buildInternals(db, opts) {
  const o = opts || {};
  const nSessions = o.sessions || 201;
  const dates = sessionsBack(db, nSessions);
  if (!dates.length) {
    return { as_of: null, ihsg: null, breadth: null, foreign_flow: null, tape: null, sectors: null, available: false };
  }
  const asOf = dates[dates.length - 1];

  // ── IHSG (tabel indeks, bukan rata-rata saham) ──
  let ihsg = null;
  try {
    const rows = db.prepare("SELECT trade_date, close FROM idx_indices WHERE index_code='COMPOSITE' ORDER BY trade_date DESC LIMIT 61").all();
    if (rows.length >= 21) {
      const now = rows[0].close;
      const at = (i) => (rows[i] ? rows[i].close : now);
      const chg = (i) => (at(i) > 0 ? r2((now / at(i) - 1) * 100) : null);
      const chg20 = chg(20);
      const regime = chg20 > 5 ? 'bull' : chg20 > 2 ? 'mild_bull' : chg20 < -5 ? 'bear' : chg20 < -2 ? 'mild_bear' : 'sideways';
      ihsg = { level: r2(now), date: rows[0].trade_date, chg_1d: chg(1), chg_5d: chg(5), chg_20d: chg20, regime };
    }
  } catch (e) { ihsg = null; }

  // ── IHSG: riwayat 60 sesi (chart) + regime ──
  // `regime` di bawah adalah label kondisi 20-sesi, bukan skor gabungan. Chart L4 memakai
  // `history` ini supaya panel bisa menunjukkan IHSG terhadap breadth pada tanggal yang sama,
  // bukan dua sumber tanggal berbeda.
  let ihsgHistory = null;
  try {
    const rowsAll = db.prepare("SELECT trade_date AS d, close FROM idx_indices WHERE index_code='COMPOSITE' ORDER BY trade_date DESC LIMIT 60").all();
    if (rowsAll.length >= 2) {
      ihsgHistory = { dates: rowsAll.map(r => r.d).reverse(), close: rowsAll.map(r => r.close).reverse() };
    }
  } catch (e) { ihsgHistory = null; }

  // ── Bulk window (satu query) ──
  const rows = db.prepare(
    `SELECT code, trade_date, ca_adj(close, code, trade_date) AS ac,
            close, prev_close, value, foreign_buy, foreign_sell
     FROM idx_daily WHERE trade_date >= ? AND close > 0
     ORDER BY code, trade_date`).all(dates[0]);

  const byCode = new Map();
  for (const r of rows) {
    let a = byCode.get(r.code);
    if (!a) { a = []; byCode.set(r.code, a); }
    a.push(r);
  }

  // ── Breadth: close terkoreksi vs MA20/50/200 pada sesi terakhir ──
  let above20 = 0, above50 = 0, above200 = 0, tot = 0, newHigh = 0, newLow = 0;
  const breadthNow = [];
  for (const [code, arr] of byCode) {
    const n = arr.length;
    if (n < 50) continue;                       // aturan panel lama: minimal 50 bar
    if (arr[n - 1].trade_date !== asOf) continue; // saham yang tidak bertransaksi hari ini tidak dihitung
    tot++;
    const cl = arr.map(x => x.ac);
    const p = cl[n - 1];
    const ma = (k) => (n >= k ? cl.slice(n - k).reduce((s, v) => s + v, 0) / k : null);
    const m20 = ma(20), m50 = ma(50), m200 = ma(200);
    if (m20 && p > m20) above20++;
    if (m50 && p > m50) above50++;
    if (m200 && p > m200) above200++;
    const look = cl.slice(Math.max(0, n - 250));
    const mx = Math.max.apply(null, look), mn = Math.min.apply(null, look);
    if (p >= mx * 0.98) newHigh++;
    if (p <= mn * 1.02) newLow++;
    breadthNow.push({ code, ac: p, prev: arr[n - 1].prev_close });
  }
  const breadth = tot ? {
    as_of: asOf, total: tot,
    pct_above_ma20: r2(above20 / tot * 100),
    pct_above_ma50: r2(above50 / tot * 100),
    pct_above_ma200: r2(above200 / tot * 100),
    above_ma20: above20, above_ma50: above50, above_ma200: above200,
    new_high: newHigh, new_low: newLow,
  } : null;

  // ── Foreign flow & nilai transaksi ──
  const byDate = new Map();
  for (const r of rows) {
    const d = r.trade_date;
    let b = byDate.get(d);
    if (!b) { b = { fnet: 0, value: 0, adv: 0, dec: 0, ara: 0, arb: 0, n: 0 }; byDate.set(d, b); }
    b.fnet += (r.foreign_buy - r.foreign_sell) * r.close;
    b.value += r.value || 0;
    b.n++;
    const pc = r.prev_close;
    if (pc > 0) {
      const chg = (r.close - pc) / pc;
      if (chg > 0) b.adv++; else if (chg < 0) b.dec++;
      // Batas tier ARA: 200 / 5.000 (diverifikasi dari tape 23 Okt 2026, lihat
      // server/routes/backtest.js::araPct). Kode lama memakai 500.
      const araPct = pc < 200 ? 0.35 : pc <= 5000 ? 0.25 : 0.20;
      if (chg >= araPct * 0.995) b.ara++;
      if (chg <= -0.15 * 0.995) b.arb++;
    }
  }
  const last20 = dates.slice(-20).filter(d => byDate.has(d)).reverse();  // DESC, terbaru dulu
  let foreign_flow = null, tape = null;
  if (last20.length) {
    const sum = (n) => last20.slice(0, n).reduce((s, d) => s + byDate.get(d).fnet, 0);
    foreign_flow = {
      as_of: last20[0],
      net_today: Math.round(byDate.get(last20[0]).fnet),
      net_5d: Math.round(sum(5)),
      net_20d: Math.round(sum(20)),
      sessions: last20.length,
    };
    const vToday = byDate.get(last20[0]).value;
    const prev20 = last20.slice(1).map(d => byDate.get(d).value).filter(v => v > 0);
    const vMa20 = prev20.length ? prev20.reduce((a, b) => a + b, 0) / prev20.length : 0;
    const t = byDate.get(last20[0]);
    // Seri harian 20 sesi (ASC = terlama dulu) untuk chart: foreign net per sesi + nilai
    // transaksi. Dikirim terpisah dari ringkasan 5D/20D supaya chart tidak perlu menurunkan
    // angka sendiri dari total.
    const flowSeries = last20.slice().reverse().map(d => ({
      date: d,
      net: Math.round(byDate.get(d).fnet),
      value: Math.round(byDate.get(d).value),
    }));
    tape = {
      as_of: last20[0],
      value_today: Math.round(vToday),
      value_ma20: Math.round(vMa20),
      value_ratio: vMa20 > 0 ? r2(vToday / vMa20) : null,
      advancers: t.adv, decliners: t.dec, ara: t.ara, arb: t.arb, members: t.n,
      series: flowSeries,
    };
    foreign_flow.series = flowSeries;
  }

  // ── Sektor: 1D & 20D equal weight (pakai harga terkoreksi untuk 20D) ──
  let sectors = null;
  try {
    const prof = new Map();
    for (const r of db.prepare("SELECT code, sector FROM company_profiles WHERE sector IS NOT NULL AND sector <> ''").all()) prof.set(r.code, r.sector);
    const d20 = dates.length >= 21 ? dates[dates.length - 21] : null;
    const agg = new Map();
    for (const [code, arr] of byCode) {
      const sec = prof.get(code);
      if (!sec) continue;
      const n = arr.length;
      if (arr[n - 1].trade_date !== asOf) continue;
      let b = agg.get(sec);
      if (!b) { b = { n: 0, d1: 0, n1: 0, d20: 0, n20: 0, members: [] }; agg.set(sec, b); }
      b.n++;
      const r0 = arr[n - 1];
      if (r0.prev_close > 0) { b.d1 += (r0.close / r0.prev_close - 1) * 100; b.n1++; }
      if (d20) {
        const base = arr.find(x => x.trade_date === d20);
        if (base && base.ac > 0) { b.d20 += (r0.ac / base.ac - 1) * 100; b.n20++; }
      }
      b.members.push({ code, value: r0.value || 0 });
    }
    const list = [];
    for (const [sec, b] of agg) {
      b.members.sort((x, y) => y.value - x.value);
      list.push({
        sector: SECTOR_LABELS[sec] || sec,
        cp_sector: sec,
        members: b.n,
        chg_1d: b.n1 ? r2(b.d1 / b.n1) : null,
        chg_20d: b.n20 ? r2(b.d20 / b.n20) : null,
        rs_vs_ihsg_1d: (b.n1 && ihsg && Number.isFinite(ihsg.chg_1d)) ? r2(b.d1 / b.n1 - ihsg.chg_1d) : null,
        top_stocks: b.members.slice(0, 3).map(m => m.code),
      });
    }
    list.sort((a, b) => (b.chg_1d == null ? -1e9 : b.chg_1d) - (a.chg_1d == null ? -1e9 : a.chg_1d));
    sectors = {
      as_of: asOf, method: 'equal_weight',
      count: list.length,
      top: list.slice(0, 3),
      bottom: list.slice(-3).reverse(),
      all: list,
    };
  } catch (e) { sectors = null; }

  // ── Kepemilikan ≥1%: HHI & top holder dari periode terbaru yang tersedia ──
  let ownership = null;
  try {
    const period = (db.prepare('SELECT MAX(period_date) AS p FROM ownership_1pct WHERE is_current=1').get() || {}).p || null;
    if (period) {
      const rowsOwn = db.prepare(
        `SELECT code, issuer_name, investor_name, pct, local_foreign
         FROM ownership_1pct WHERE is_current=1 AND period_date=? AND pct IS NOT NULL AND pct >= 1
         ORDER BY code, pct DESC`).all(period);
      const byCodeOwn = new Map();
      for (const r of rowsOwn) {
        let a = byCodeOwn.get(r.code);
        if (!a) { a = []; byCodeOwn.set(r.code, a); }
        a.push(r);
      }
      // HHI = Σ (pangsa %)² / 100  ->  skala 0..100 (100 = satu pemegang seluruh saham).
      const hhis = [];
      const topConcentrated = [];
      for (const [code, arr] of byCodeOwn) {
        const sumSq = arr.reduce((s, r) => s + r.pct * r.pct, 0);
        const hhi = r2(sumSq / 100);
        hhis.push(hhi);
        topConcentrated.push({
          code, issuer: arr[0].issuer_name, holders: arr.length,
          top_holder: arr[0].investor_name, top_pct: r2(arr[0].pct), hhi,
        });
      }
      hhis.sort((a, b) => a - b);
      const median = hhis.length ? hhis[Math.floor(hhis.length / 2)] : null;
      topConcentrated.sort((a, b) => b.hhi - a.hhi);
      // Top holder terbesar menurut pct (siapa yang memegang paling besar di pasar)
      const byTopPct = topConcentrated.slice().sort((a, b) => b.top_pct - a.top_pct);
      ownership = {
        period_date: period,
        age_days: (() => {
          const t = Date.parse(period + 'T00:00:00Z');
          return Number.isFinite(t) ? Math.round((Date.now() - t) / 86400000) : null;
        })(),
        codes: byCodeOwn.size,
        holders: rowsOwn.length,
        hhi_median: median,
        hhi_p90: hhis.length ? hhis[Math.floor(hhis.length * 0.9)] : null,
        very_concentrated: hhis.filter(h => h > 50).length,
        most_concentrated: topConcentrated.slice(0, 5),
        largest_holders: byTopPct.slice(0, 5),
        note: 'HHI = Σ(pangsa %)²/100 pada pemegang ≥1%: 100 = satu pemegang memiliki seluruh saham. Sumber hanya memuat pemegang ≥1% sehingga HHI adalah batas bawah konsentrasi.',
      };
    }
  } catch (e) { ownership = null; }

  return {
    as_of: asOf, available: true, ihsg, ihsg_history: ihsgHistory, breadth, foreign_flow, tape, sectors, ownership,
    sessions: dates.length,
    window_from: dates[0],
  };
}

module.exports = { buildInternals, SECTOR_LABELS, SECTOR_ORDER };
