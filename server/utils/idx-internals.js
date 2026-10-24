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
      // JANGAN fallback ke `now` saat indeks melewati ujung array: itu mengembalikan 0.00% untuk
      // horizon yang datanya tidak ada, dan 0% terbaca sebagai "datar" padahal artinya "tidak
      // diketahui". Rail COMPOSITE saat ini hanya 40 bar (2026-08-31..2026-10-23), jadi 60D
      // memang belum tersedia dan harus null.
      const at = (i) => (rows[i] ? rows[i].close : null);
      const chg = (i) => { const v = at(i); return (v > 0 && now > 0) ? r2((now / v - 1) * 100) : null; };
      const chg20 = chg(20);
      const regime = chg20 > 5 ? 'bull' : chg20 > 2 ? 'mild_bull' : chg20 < -5 ? 'bear' : chg20 < -2 ? 'mild_bear' : 'sideways';
      ihsg = {
        level: r2(now), date: rows[0].trade_date,
        chg_1d: chg(1), chg_5d: chg(5), chg_20d: chg20, chg_60d: chg(60), regime,
      };
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

  // ── Sektor: horizon 1D/5D/20D/60D, equal weight, harga terkoreksi ──
  // Horizon dipilih supaya satu tabel bisa menjawab "siapa bergerak hari ini" (1D), "minggu ini"
  // (5D), "bulan ini" (20D), dan "kuartal" (60D). Dulu hanya 1D dan 20D, sehingga rotasi jangka
  // menengah tidak terlihat sama sekali.
  // Pakai `ac` (close terkoreksi aksi korporasi) untuk SEMUA horizon, termasuk 1D: kalau 1D
  // memakai close mentah sementara 20D memakai ac, satu baris bisa mencampur dua definisi return
  // dan selisihnya muncul sebagai "rotasi" padahal itu split.
  // Basis tiap horizon dicari per saham (`arr.find`), bukan dari `dates[]` global: saham yang
  // disuspensi beberapa hari tidak punya bar di tanggal global itu, dan memaksakan tanggal global
  // akan membuang saham tersebut dari rata-rata sektornya tanpa jejak.
  let sectors = null;
  try {
    const prof = new Map();
    for (const r of db.prepare("SELECT code, sector FROM company_profiles WHERE sector IS NOT NULL AND sector <> ''").all()) prof.set(r.code, r.sector);
    const HORIZONS = [1, 5, 20, 60];
    // Basis per horizon diambil dari `dates` (hasil `sessionsBack`), yaitu tanggal yang memang ada
    // di idx_daily — bukan tanggal kalender hasil mundur N hari. Sudah diverifikasi: 1.640 tanggal
    // di tabel ini tidak mengandung Sabtu/Minggu, jadi basis 60 sesi (2026-07-29) memang hari bursa.
    // Untuk saham yang baru listing, bar di tanggal basis tidak ada dan saham itu dilewati lewat
    // `pos.get(bd)` — bukan dianggap return 0%.
    const baseDate = {};
    for (const h of HORIZONS) baseDate[h] = dates.length >= h + 1 ? dates[dates.length - 1 - h] : null;
    const agg = new Map();
    for (const [code, arr] of byCode) {
      const sec = prof.get(code);
      if (!sec) continue;
      const n = arr.length;
      if (arr[n - 1].trade_date !== asOf) continue;
      let b = agg.get(sec);
      if (!b) {
        b = { n: 0, members: [], acc: {} };
        for (const h of HORIZONS) b.acc[h] = { sum: 0, n: 0, up: 0, vals: [] };
        agg.set(sec, b);
      }
      b.n++;
      const pos = new Map();
      for (let i = 0; i < n; i++) pos.set(arr[i].trade_date, i);
      const r0 = arr[n - 1];
      for (const h of HORIZONS) {
        const bd = baseDate[h];
        if (!bd) continue;
        const bi = pos.get(bd);
        if (bi === undefined) continue;            // saham tidak punya bar di tanggal basis
        const base = arr[bi];
        if (!(base.ac > 0) || !(r0.ac > 0)) continue;
        // WAJIB diperdagangkan di KEDUA ujung horizon. `value = 0` berarti tidak ada transaksi dan
        // `close` di bar itu adalah harga carry-forward dari hari sebelumnya, sehingga return
        // terhitung 0,00% — bukan "datar", tapi "tidak ada harga". Tanpa filter ini, 114 dari 131
        // nama ber-return 0% pada 60D adalah saham tanpa transaksi, dan median sektor tertarik ke
        // nol: Transportasi tercatat 0,00% padahal anggotanya bergerak +1327% sampai -38%.
        if (!(base.value > 0) || !(r0.value > 0)) continue;
        const ret = (r0.ac / base.ac - 1) * 100;
        b.acc[h].sum += ret;
        b.acc[h].n++;
        if (ret > 0.005) b.acc[h].up++;
        b.acc[h].vals.push(ret);
      }
      b.members.push({ code, value: r0.value || 0 });
    }
    const list = [];
    for (const [sec, b] of agg) {
      b.members.sort((x, y) => y.value - x.value);
      // Median lintas emiten jadi angka utama, BUKAN rata-rata. Dengan equal weight, satu emiten
      // ekstrem menggeser seluruh sektor: 60D Transportasi mean +41,7% sementara median 0%, karena
      // TRUK naik +1.327% (422 -> 6.025) dari 40 anggota. Menampilkan mean di kolom tabel berarti
      // menyajikan pergerakan satu saham sebagai "rotasi sektor". Mean tetap dikirim sebagai
      // chg_* supaya pembaca bisa memeriksa selisihnya, dan divergensi besar ditandai di UI.
      const stat = (h) => {
        const v = b.acc[h].vals;
        if (!v.length) return { mean: null, med: null, up: 0, n: 0 };
        const mean = v.reduce((s, x) => s + x, 0) / v.length;
        const srt = v.slice().sort((x, y) => x - y);
        const m = srt.length;
        const med = m % 2 ? srt[(m - 1) / 2] : (srt[m / 2 - 1] + srt[m / 2]) / 2;
        return { mean: r2(mean), med: r2(med), up: b.acc[h].up, n: b.acc[h].n };
      };
      const s1 = stat(1), s5 = stat(5), s20 = stat(20), s60 = stat(60);
      list.push({
        sector: SECTOR_LABELS[sec] || sec,
        cp_sector: sec,
        members: b.n,
        chg_1d: s1.mean, chg_5d: s5.mean, chg_20d: s20.mean, chg_60d: s60.mean,
        med_1d: s1.med, med_5d: s5.med, med_20d: s20.med, med_60d: s60.med,
        // Breadth per horizon: berapa emiten yang benar-benar naik dari sampel yang dipakai.
        // Median 0,00% di IDX sering berarti "separuh emiten tidak bergerak", bukan "tidak ada
        // data" — tanpa angka ini keduanya tidak bisa dibedakan.
        up_1d: s1.up, up_5d: s5.up, up_20d: s20.up, up_60d: s60.up,
        // Berapa emiten yang benar-benar masuk rata-rata tiap horizon. 60D bisa lebih kecil dari
        // jumlah anggota kalau ada saham baru listing — tanpa angka ini, selisih antar kolom
        // tampak seperti rotasi padahal beda sampel.
        n_1d: b.acc[1].n, n_5d: b.acc[5].n, n_20d: b.acc[20].n, n_60d: b.acc[60].n,
        rs_vs_ihsg_1d: (s1.med !== null && ihsg && Number.isFinite(ihsg.chg_1d)) ? r2(s1.med - ihsg.chg_1d) : null,
        rs_vs_ihsg_20d: (s20.med !== null && ihsg && Number.isFinite(ihsg.chg_20d)) ? r2(s20.med - ihsg.chg_20d) : null,
        top_stocks: b.members.slice(0, 3).map(m => m.code),
      });
    }
    list.sort((a, b) => (b.med_1d == null ? -1e9 : b.med_1d) - (a.med_1d == null ? -1e9 : a.med_1d));
    sectors = {
      as_of: asOf, method: 'equal_weight_median', horizons: HORIZONS,
      stat: 'median_member_return', mean_field: 'chg_*', median_field: 'med_*',
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
