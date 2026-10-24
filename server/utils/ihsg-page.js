'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// IHSG PAGE — payload untuk menu "IHSG" (permintaan owner 24 Okt 2026).
//
// TUJUAN: satu halaman yang menjawab "IHSG sedang di mana" tanpa menebak, dan yang
// membedakan tiga hal yang sering dicampur di satu grafik:
//   1. LEVEL  — 5.439,26. Sumber `index_chart` (268 sesi sejak 2025-09-15) dan `idx_indices`
//               (OHLC 40 sesi sejak 2026-08-31). Dua rail ini DIVERIFIKASI identik pada
//               251 hari yang tumpang tindih (selisih < 1 poin), jadi aman ditumpuk.
//   2. BREADTH — berapa persen emiten di atas MA20/50/200. Indeks naik oleh segelintir
//               saham besar tetap "naik" di level, tapi breadth-nya bisa rusak.
//   3. ARUS    — foreign net per sesi, nilai transaksi vs MA20, ARA/ARB, adv/dec.
//
// ATURAN ANGKA (jangan dilanggar):
//  - MA dan return memakai `ca_adj(close)` (terkoreksi aksi korporasi). Level IHSG memakai
//    `index_chart.value` apa adanya karena itu level indeks resmi, bukan harga saham.
//  - Return IHSG dihitung dari level `index_chart`, BUKAN rata-rata return saham.
//  - Sesi tanpa data mengembalikan null, bukan 0. 0,00% berarti "datar"; null berarti
//    "tidak tahu" — dua hal berbeda dan tidak boleh tampil sama.
//  - `foreign_flow` = (foreign_buy - foreign_sell) x close, per saham per sesi. Ini BUKAN
//    arus dana bersih lintas broker (tidak ada netting antar broker asing).
//  - `value` tape berasal dari `idx_indices` (nilai resmi bursa). Penjumlahan `idx_daily`
//    hanya 86-96% dari angka ini karena tidak semua transaksi punya baris per saham, jadi
//    JANGAN dijumlahkan dan disebut "nilai transaksi bursa".
// ═══════════════════════════════════════════════════════════════════════════

const r2 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);

// Jendela chart utama. 120 sesi ≈ 6 bulan: cukup untuk melihat tren, cukup terang untuk
// membaca level. Rentang lebih panjang bikin garis 1 tahun gepeng di kolom sempit.
const MAIN_SESSIONS = 120;
// Panjang seri breadth/arus. Disamakan dengan SERIES_SESSIONS di idx-internals supaya dua
// panel tidak menampilkan rentang berbeda untuk hal yang sama.
const FLOW_SESSIONS = 40;

function sessions(db, n) {
  return db.prepare('SELECT DISTINCT trade_date AS d FROM idx_daily ORDER BY trade_date DESC LIMIT ?')
    .all(n).map((r) => r.d).reverse();
}

function buildIhsg(db) {
  const hasIdx = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='index_chart'").get().c > 0;
  if (!hasIdx) return { available: false, reason: 'index_chart belum ada' };

  // ── Level: satu seri dari index_chart (tanpa lubang) ──
  const levelRows = db.prepare(
    "SELECT chart_date AS d, value AS v FROM index_chart WHERE index_code='COMPOSITE' ORDER BY chart_date"
  ).all();
  if (!levelRows.length) return { available: false, reason: 'index_chart kosong untuk COMPOSITE' };

  const asOf = levelRows[levelRows.length - 1].d;
  const vals = levelRows.map((r) => r.v);
  const last = vals[vals.length - 1];

  // Return dihitung dari indeks level, dengan basis tanggal bursa (bukan offset kalender).
  const chgOver = (n) => {
    const i = levelRows.length - 1 - n;
    if (i < 0) return null;                    // riwayat belum cukup -> null, bukan 0
    return r2(((last - vals[i]) / vals[i]) * 100);
  };

  // ── OHLC hari terakhir + statistik sesi ──
  const ohlc = db.prepare(
    "SELECT trade_date AS d, close, previous, highest, lowest, volume, value, frequency " +
    "FROM idx_indices WHERE index_code='COMPOSITE' ORDER BY trade_date DESC LIMIT 1"
  ).get() || null;

  // ── Rentang 52 minggu dari level (bukan dari OHLC 40 sesi yang terlalu pendek) ──
  const win = levelRows.slice(-252).map((r) => r.v);
  const hi52 = Math.max.apply(null, win), lo52 = Math.min.apply(null, win);

  // MA dari level indeks: 20/50/200 sesi, null bila riwayat kurang.
  const ma = (k) => (vals.length >= k ? r2(vals.slice(-k).reduce((s, v) => s + v, 0) / k) : null);
  const ma20 = ma(20), ma50 = ma(50), ma200 = ma(200);

  // ── Seri chart utama: 120 sesi, dengan OHLC bila tersedia (40 sesi terakhir) ──
  const hist = levelRows.slice(-MAIN_SESSIONS);
  const ohlcMap = new Map(
    db.prepare("SELECT trade_date AS d, close, previous, highest, lowest FROM idx_indices WHERE index_code='COMPOSITE'").all()
      .map((r) => [r.d, r])
  );
  const series = hist.map((r) => {
    const o = ohlcMap.get(r.d);
    // OHLC hanya ada 40 sesi; sebelum itu chart memakai mode line. Mengirim high=low=close
    // akan menggambar candle setinggi nol garis (terbaca seperti data rusak), jadi null-kan.
    return o
      ? { date: r.d, close: r2(r.v), open: o.previous == null ? null : r2(o.previous), high: r2(o.highest), low: r2(o.lowest) }
      : { date: r.d, close: r2(r.v), open: null, high: null, low: null };
  });
  const ohlcFrom = series.find((x) => x.high != null);
  const ohlcFromDate = ohlcFrom ? ohlcFrom.date : null;

  // ── Sesi terakhir: breadth, arus, ARA/ARB, adv/dec ──
  const flowDates = sessions(db, FLOW_SESSIONS);
  const rows = db.prepare(
    `SELECT code, trade_date, ca_adj(close, code, trade_date) AS ac, prev_close, close,
            value, foreign_buy, foreign_sell
       FROM idx_daily WHERE trade_date >= ?`
  ).all(flowDates[0]);

  // Per tanggal: foreign net, nilai, adv/dec, ARA/ARB.
  const byDate = new Map();
  const byCode = new Map();
  for (const r of rows) {
    let b = byDate.get(r.trade_date);
    if (!b) { b = { fnet: 0, value: 0, adv: 0, dec: 0, ara: 0, arb: 0, n: 0 }; byDate.set(r.trade_date, b); }
    b.fnet += (r.foreign_buy - r.foreign_sell) * r.close;
    b.value += r.value || 0;
    b.n++;
    const pc = r.prev_close;
    if (pc > 0) {
      const chg = (r.close - pc) / pc;
      if (chg > 0) b.adv++; else if (chg < 0) b.dec++;
      const araPct = pc < 200 ? 0.35 : pc <= 5000 ? 0.25 : 0.20;
      if (chg >= araPct * 0.995) b.ara++;
      if (chg <= -0.15 * 0.995) b.arb++;
    }
    if (!byCode.has(r.code)) byCode.set(r.code, []);
    byCode.get(r.code).push(r);
  }
  // Seri arus: hanya tanggal yang punya baris, ASC.
  const flowSeries = flowDates.filter((d) => byDate.has(d)).map((d) => {
    const b = byDate.get(d);
    return { date: d, net: Math.round(b.fnet), value: Math.round(b.value) };
  });

  // ── Breadth pada sesi terakhir: butuh riwayat panjang, jadi query terpisah ──
  // Bulk di atas hanya 40 sesi (tidak cukup untuk MA200), jadi ambil 200+ sesi sekali.
  const breadthDates = sessions(db, 220);
  const brows = db.prepare(
    `SELECT code, trade_date, ca_adj(close, code, trade_date) AS ac
       FROM idx_daily WHERE trade_date >= ? ORDER BY code, trade_date`
  ).all(breadthDates[0]);
  const bmap = new Map();
  for (const r of brows) {
    if (!bmap.has(r.code)) bmap.set(r.code, []);
    bmap.get(r.code).push(r);
  }
  let above20 = 0, above50 = 0, above200 = 0, tot = 0, nh = 0, nl = 0;
  const breadthSeries = [];   // % di atas MA20 per sesi (untuk sparkline)
  const lastDates = breadthDates.slice(-FLOW_SESSIONS);

  // Hitung sekali jalan: untuk setiap sesi terakhir, hitung % di atas MA20 memakai window
  // per saham. Ini O(nama x sesi) tapi hanya 40 sesi terakhir, bukan 220 x 40.
  const perDateAbove = new Map(lastDates.map((d) => [d, { a20: 0, n: 0 }]));
  for (const [, arr] of bmap) {
    if (arr.length < 50) continue;              // aturan panel lama: minimal 50 bar
    const cl = arr.map((x) => x.ac);
    // MA20 untuk sesi ke-i butuh 20 bar sebelumnya; hanya hitung bila cukup.
    for (let i = 19; i < arr.length; i++) {
      const d = arr[i].trade_date;
      const t = perDateAbove.get(d);
      if (!t) continue;
      let s = 0;
      for (let k = i - 19; k <= i; k++) s += cl[k];
      const m20 = s / 20;
      t.n++;
      if (cl[i] > m20) t.a20++;
    }
  }
  for (const d of lastDates) {
    const t = perDateAbove.get(d);
    if (t && t.n) breadthSeries.push({ date: d, pct_above_ma20: r2((t.a20 / t.n) * 100) });
  }

  // Breadth sesi terakhir untuk MA20/50/200 + new high/low.
  for (const [, arr] of bmap) {
    const n = arr.length;
    if (n < 50) continue;
    if (arr[n - 1].trade_date !== asOf) continue;  // tidak bertransaksi hari ini
    tot++;
    const cl = arr.map((x) => x.ac);
    const p = cl[n - 1];
    const m = (k) => (n >= k ? cl.slice(n - k).reduce((s, v) => s + v, 0) / k : null);
    const m20 = m(20), m50 = m(50), m200 = m(200);
    if (m20 && p > m20) above20++;
    if (m50 && p > m50) above50++;
    if (m200 && p > m200) above200++;
    // New high/low HARUS ketat, bukan toleransi 2%.
    // Versi pertama memakai `p >= mx*0.98` dan melaporkan 99 new high di pasar yang turun
    // 40% YTD — sebabnya saham mati seperti ARTI (Rp 2 sepanjang tahun) memenuhi syarat
    // karena 2 >= 2*0.98. Sekarang: harus menyamai/melewati harga tertinggi, DAN rentang
    // 250 sesinya harus bergerak (mx > mn*1.05) supaya nama yang tidak pernah bergerak
    // tidak dihitung sebagai "high".
    const look = cl.slice(Math.max(0, n - 250));
    const mx = Math.max.apply(null, look), mn = Math.min.apply(null, look);
    const moved = mx > mn * 1.05;
    if (moved && p >= mx) nh++;
    if (moved && p <= mn) nl++;
  }

  const bToday = byDate.get(asOf) || null;

  // Nilai resmi bursa (idx_indices) + MA20-nya dari rail yang sama.
  const valRows = db.prepare(
    "SELECT value FROM idx_indices WHERE index_code='COMPOSITE' ORDER BY trade_date DESC LIMIT 21"
  ).all().map((r) => r.value).filter((v) => v > 0);

  return {
    available: true,
    as_of: asOf,
    generated_at: new Date().toISOString(),
    level: {
      close: r2(last),
      prev: levelRows.length > 1 ? r2(vals[vals.length - 2]) : null,
      chg_pct: chgOver(1),
      chg_5d: chgOver(5),
      chg_20d: chgOver(20),
      chg_60d: chgOver(60),
      chg_120d: chgOver(120),
      // YTD dihitung dari CLOSE TERAKHIR TAHUN SEBELUMNYA, bukan bar pertama tahun ini.
      // Versi pertama memakai bar pertama 2026 (2 Jan) sehingga YTD -37,82% padahal basis
      // yang lazim -37,10% (dari 30 Des 2025). Selisih 0,7 pp cukup untuk salah kutip.
      chg_ytd: (function () {
        const year = asOf.slice(0, 4);
        let base = null;
        for (let i = levelRows.length - 1; i >= 0; i--) {
          if (levelRows[i].d.slice(0, 4) < year) { base = vals[i]; break; }
        }
        return base ? r2(((last - base) / base) * 100) : null;
      })(),
      ma20, ma50, ma200,
      vs_ma20: ma20 ? r2(((last - ma20) / ma20) * 100) : null,
      vs_ma50: ma50 ? r2(((last - ma50) / ma50) * 100) : null,
      vs_ma200: ma200 ? r2(((last - ma200) / ma200) * 100) : null,
      high_52w: r2(hi52), low_52w: r2(lo52),
      pct_from_high: hi52 ? r2(((last - hi52) / hi52) * 100) : null,
      pct_from_low: lo52 ? r2(((last - lo52) / lo52) * 100) : null,
      ohlc: ohlc ? {
        open: ohlc.previous == null ? null : r2(ohlc.previous),
        high: r2(ohlc.highest), low: r2(ohlc.lowest),
        volume: ohlc.volume, value: ohlc.value, frequency: ohlc.frequency,
      } : null,
      sessions: levelRows.length,
      from_date: levelRows[0].d,
    },
    series,
    ohlc_from: ohlcFromDate,
    breadth: tot ? {
      as_of: asOf, total: tot,
      pct_above_ma20: r2((above20 / tot) * 100),
      pct_above_ma50: r2((above50 / tot) * 100),
      pct_above_ma200: r2((above200 / tot) * 100),
      new_high: nh, new_low: nl,
      series: breadthSeries,
    } : null,
    flow: bToday ? {
      as_of: asOf,
      net_today: Math.round(bToday.fnet),
      net_5d: Math.round(flowSeries.slice(-5).reduce((s, x) => s + x.net, 0)),
      net_20d: Math.round(flowSeries.slice(-20).reduce((s, x) => s + x.net, 0)),
      advancers: bToday.adv, decliners: bToday.dec,
      ara: bToday.ara, arb: bToday.arb,
      members: bToday.n,
      value_today: valRows.length ? Math.round(valRows[0]) : null,
      value_ma20: valRows.length > 1 ? Math.round(valRows.slice(1).reduce((s, v) => s + v, 0) / (valRows.length - 1)) : null,
      value_ratio: (function () {
        if (valRows.length < 2) return null;
        const m = valRows.slice(1).reduce((s, v) => s + v, 0) / (valRows.length - 1);
        return m > 0 ? r2(valRows[0] / m) : null;
      })(),
      series: flowSeries,
      sessions: flowSeries.length,
    } : null,
  };
}

module.exports = { buildIhsg, MAIN_SESSIONS, FLOW_SESSIONS };
