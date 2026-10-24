'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// COMPARISON — bandingkan satu emiten dengan peer di INDUSTRI yang sama
//
// Dipakai sub-tab "Comparison" di Stock Information. Semua angka dihitung dari
// tabel yang sama dengan Stock Detail (idx_daily + corpora te actions + idx_fundamental),
// supaya tidak ada dua definisi return/fundamental di aplikasi ini.
//
// Asumsi yang dipakai dan HARUS ikut ditampilkan di UI:
//   - Return dihitung dari harga `ac` (already corporate-action adjusted), bukan close
//     mentah. Tanpa ini, emiten yang baru stock split akan tampak -90%.
//   - Peer default = INDUSTRI (bukan sektor). Bank vs Asuransi beda bisnis; menyatukan
//     keduanya dalam "Keuangan" membuat perbandingan PER/PBV menyesatkan. Industri
//     dipakai kalau ada >= MIN_PEERS anggota; kalau tidak, naik ke sektor.
//   - Median, bukan rata-rata: satu emiten ekstrem (PER 500x karena laba mendekati nol)
//     tidak boleh menggeser garis pembanding seluruh industri.
// ═══════════════════════════════════════════════════════════════════════════════

const { loadFactors, adjustRows } = require('./price-adjust');

const MIN_PEERS = 5;          // di bawah ini, industri dianggap terlalu sempit
const LOOKBACK = 400;         // sesi yang diambil per emiten (cukup untuk 120D + MA200)
const HORIZONS = [5, 20, 60, 120, 250];

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

// Return per horizon dari seri {d, c} urut naik.
function returnsOf(series, horizons) {
  const out = {};
  const n = series.length;
  for (const h of horizons) {
    out[h] = n >= h + 1 ? pct(series[n - 1].c, series[n - 1 - h].c) : null;
  }
  return out;
}

function sma(series, n) {
  if (series.length < n) return null;
  let s = 0;
  for (let i = series.length - n; i < series.length; i++) s += series[i].c;
  return s / n;
}

function buildComparison(db, code) {
  const profile = db.prepare(
    'SELECT code, name, sector, industry FROM company_profiles WHERE code = ?'
  ).get(code);
  if (!profile) return { error: 'unknown_code', code };

  // ── 1. Tentukan universe peer ────────────────────────────────────────────────
  // Utamakan industri. Kalau terlalu sempit (mis. "Jasa Investasi" 6 emiten masih
  // lolos, tapi ada industri berisi 1-2 emiten), naik ke sektor.
  let level = 'industry';
  let universe = [];
  if (profile.industry) {
    universe = db.prepare(
      'SELECT code, name FROM company_profiles WHERE industry = ? AND sector = ? ORDER BY code'
    ).all(profile.industry, profile.sector || '');
  }
  if (universe.length < MIN_PEERS) {
    level = 'sector';
    universe = profile.sector
      ? db.prepare('SELECT code, name FROM company_profiles WHERE sector = ? ORDER BY code').all(profile.sector)
      : [];
  }
  if (!universe.length) return { error: 'no_peers', code, sector: profile.sector };

  const codes = universe.map(u => u.code);

  // ── 2. Ambil riwayat harga, sesuaikan aksi korporasi ────────────────────────
  const caFactors = loadFactors(db);
  const placeholders = codes.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT code, trade_date, close, open_price, high, low, volume, value, foreign_buy, foreign_sell
     FROM idx_daily WHERE code IN (${placeholders}) AND close > 0
     ORDER BY trade_date`
  ).all(...codes);

  const byCode = new Map();
  for (const r of rows) {
    if (!byCode.has(r.code)) byCode.set(r.code, []);
    byCode.get(r.code).push(r);
  }

  // Tanggal acuan: sesi terakhir yang dimiliki emiten yang diminta. Memakai tanggal
  // global bisa membandingkan emiten pada hari yang berbeda kalau salah satu suspended.
  const selfRaw = byCode.get(code) || [];
  if (!selfRaw.length) return { error: 'no_price_data', code };
  const asOf = selfRaw[selfRaw.length - 1].trade_date;

  const stats = [];
  for (const u of universe) {
    const raw = byCode.get(u.code);
    if (!raw || !raw.length) continue;

    // adjustRows menulis field `ac` (adjusted close) + `avol`; dipakai supaya split
    // dan right issue tidak membuat return tampak ekstrem.
    const data = raw.slice(-LOOKBACK).map(r => ({ ...r }));
    adjustRows(data, caFactors[u.code]);

    // Buang sesi setelah tanggal acuan supaya semua peer berhenti di hari yang sama.
    const cut = data.filter(r => r.trade_date <= asOf);
    if (cut.length < 30) continue;

    const series = cut.map(r => ({ d: r.trade_date, c: r.ac }));
    const last = series[series.length - 1];
    const rets = returnsOf(series, HORIZONS);
    const ma20 = sma(series, 20);
    const ma60 = sma(series, 60);
    const ma200 = sma(series, 200);

    // Foreign net dalam RUPIAH, bukan lembar: 1 juta lembar BBCA dan 1 juta lembar
    // saham Rp 50 jelas bukan aliran uang yang sama besar.
    let fnet = 0;
    for (const r of cut.slice(-20)) {
      fnet += ((r.foreign_buy || 0) - (r.foreign_sell || 0)) * r.ac;
    }

    stats.push({
      code: u.code,
      name: u.name,
      isSelf: u.code === code,
      close: last.c,
      last_date: last.d,
      ret_5d: rets[5], ret_20d: rets[20], ret_60d: rets[60],
      ret_120d: rets[120], ret_ytd: rets[250],
      vs_ma20: ma20 ? pct(last.c, ma20) : null,
      vs_ma60: ma60 ? pct(last.c, ma60) : null,
      vs_ma200: ma200 ? pct(last.c, ma200) : null,
      fnet_20d: fnet,
      value_20d: cut.slice(-20).reduce((a, r) => a + (r.value || 0), 0)
    });
  }

  // ── 3. Fundamental dari snapshot terakhir ──────────────────────────────────
  const snap = db.prepare('SELECT MAX(snapshot_month) AS m FROM idx_fundamental').get();
  const funds = snap && snap.m ? db.prepare(
    `SELECT code, per, pbv, roe, roa, npm, der, mkt_cap
     FROM idx_fundamental WHERE snapshot_month = ? AND code IN (${placeholders})`
  ).all(snap.m, ...codes) : [];
  const fmap = new Map(funds.map(f => [f.code, f]));
  for (const s of stats) {
    const f = fmap.get(s.code) || {};
    s.per = f.per; s.pbv = f.pbv; s.roe = f.roe; s.roa = f.roa;
    s.npm = f.npm; s.der = f.der; s.mkt_cap = f.mkt_cap;
  }

  // ── 4. Median pembanding ───────────────────────────────────────────────────
  // Median dihitung dari semua peer TERMASUK emiten yang diminta, karena pertanyaan
  // "di mana posisi saham ini di industrinya" memang membandingkan dengan populasi.
  const FIELDS = ['ret_5d', 'ret_20d', 'ret_60d', 'ret_120d', 'ret_ytd',
    'vs_ma20', 'vs_ma60', 'vs_ma200', 'fnet_20d',
    'per', 'pbv', 'roe', 'roa', 'npm', 'der'];
  const med = {};
  for (const f of FIELDS) med[f] = median(stats.map(s => s[f]));

  // PER/PBV negatif atau nol artinya laba/ekuitas negatif — bukan "murah". Dikeluarkan
  // dari median supaya tidak menarik pembanding ke bawah secara palsu.
  med.per_pos = median(stats.map(s => (s.per > 0 ? s.per : null)));
  med.pbv_pos = median(stats.map(s => (s.pbv > 0 ? s.pbv : null)));

  stats.sort((a, b) => (b.ret_20d ?? -1e9) - (a.ret_20d ?? -1e9));

  return {
    code,
    name: profile.name,
    sector: profile.sector,
    industry: profile.industry,
    level,
    level_label: level === 'industry' ? (profile.industry || profile.sector) : profile.sector,
    as_of: asOf,
    n_peers: stats.length,
    horizons: HORIZONS,
    stats,
    median: med,
    snapshot_month: snap ? snap.m : null,
    method: {
      return_basis: 'adjusted_close',
      aggregation: 'median',
      peer_scope: level,
      fnet_unit: 'IDR',
      note: 'Return memakai harga terkoreksi aksi korporasi; median lintas emiten; '
        + 'PER/PBV <= 0 dikeluarkan dari median valuasi.'
    }
  };
}

module.exports = { buildComparison };
