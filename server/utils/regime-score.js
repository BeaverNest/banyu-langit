'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// SKOR REGIME (kanban t_19f4f0d4, lapis 1).
//
// Empat skor untuk bar paling atas halaman. Ini KOMPOSIT DESKRIPTIF dari data yang kita punya —
// bukan ramalan, bukan sinyal beli/jual, dan bukan model statistik terkalibrasi. Semua ambang di
// bawah adalah PILIHAN EKSPLISIT yang bisa dibaca dan dibantah, bukan hasil fitting.
//
// Kontrak yang dijaga:
//  1. Setiap komponen membawa `as_of`, `state` (kontrak series-freshness), dan `age_days`.
//     Skor tidak pernah lebih segar dari komponen tertuanya: `as_of` = tanggal TERTUA yang
//     dipakai, dan `status` = keadaan terburuk di antara komponen ('stale' > 'unmeasured' >
//     'fresh'). Skor yang memakai SRBI 31 Agu TIDAK boleh tampil seperti angka hari ini.
//  2. Komponen yang tidak tersedia (seri hilang / tidak dideklarasikan) TIDAK diberi nilai
//     netral diam-diam: bobotnya dibuang, komponennya masuk `missing`, dan bila bobot yang
//     tersisa < 50% skor dikirim `score:null` + `reason`.
//  3. Bobot & ambang didokumentasikan per komponen supaya pembaca tahu skor ini lahir dari
//     asumsi apa. Mengubah ambang = mengubah berkas ini, terlihat di review.
//
// Arah skor: 0 = paling menekan aset berisiko, 100 = paling mendukung. Untuk komponen yang
// berbanding TERBALIK (VIX, DXY, US10Y, HY OAS, SRBI), anchor-nya sudah dibalik di sini.
// ═══════════════════════════════════════════════════════════════════════════

const r2 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);

/**
 * Interpolasi linear pada anchor [[nilai, skor], ...] (nilai naik). Di luar rentang = clamp.
 * Anchor sengaja sedikit dan bisa dibaca manusia; ini peta kebijakan, bukan regresi.
 */
function band(x, anchors) {
  if (x == null || !Number.isFinite(x)) return null;
  if (x <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i];
    const [x0, y0] = anchors[i - 1];
    if (x <= x1) {
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

// ── Ambang (dibaca sebagai: "pada level ini, kondisinya sekian dari skala 0-100") ──
const ANCHORS = {
  VIX: [[12, 100], [16, 78], [20, 55], [25, 32], [32, 12], [45, 0]],          // volatilitas: tinggi = buruk
  HYOAS: [[2.5, 100], [3.0, 82], [3.5, 66], [4.5, 45], [6.0, 22], [8.0, 0]], // spread kredit: lebar = buruk
  DXY: [[95, 92], [100, 68], [105, 45], [110, 22], [115, 5]],                 // dolar kuat = menekan EM
  US10Y: [[3.0, 92], [4.0, 70], [4.5, 52], [5.0, 34], [5.5, 18], [6.5, 0]],
  USDIDR_20D: [[-3, 92], [-1, 68], [0, 52], [1, 34], [3, 12], [6, 0]],         // rupiah melemah = buruk
  M2_YOY: [[0, 8], [4, 32], [6, 50], [8, 68], [11, 86], [15, 96]],            // uang beredar: tinggi = longgar
  LOANS_YOY: [[0, 8], [5, 35], [8, 55], [11, 78], [15, 92]],                   // kredit: pertumbuhan = longgar
  SRBI_1M_PCT: [[-12, 92], [-5, 76], [0, 52], [5, 32], [12, 8]],               // SRBI naik = menyerap likuiditas
  BI_RATE: [[3.0, 92], [4.5, 72], [5.75, 52], [7.0, 30], [9.0, 8]],           // suku bunga riil/kebijakan
  IHSG_20D: [[-25, 0], [-15, 10], [-8, 24], [-3, 40], [0, 50], [3, 62], [8, 80], [15, 94], [25, 100]],
  BREADTH_MA50: [[3, 2], [15, 18], [30, 34], [45, 52], [60, 72], [75, 88], [90, 98]],
  FF_20D_TN: [[-25, 0], [-12, 16], [-4, 38], [0, 52], [4, 66], [12, 84], [25, 100]], // Rp triliun
};

const W = {
  // Kunci = KODE seri (bukan label), supaya bobot tidak bisa "hilang" karena salah nama.
  risk_appetite: { VIX: 0.40, HYOAS: 0.30, GLOBAL_BREADTH: 0.30 },
  domestic_liquidity: { MACRO_M2_YOY: 0.30, MACRO_LOANS_YOY: 0.30, SRBI_1M_PCT: 0.20, MACRO_BI_RATE: 0.20 },
  external: { DXY: 0.35, US10Y: 0.35, USDIDR_20D: 0.30 },
  equity: { IHSG_20D: 0.40, BREADTH_MA50: 0.35, FF_20D_TN: 0.25 },
};

const LABELS = {
  risk_appetite: 'Risk Appetite',
  domestic_liquidity: 'Likuiditas Domestik',
  external: 'Eksternal',
  equity: 'Ekuitas',
};

const METHODS = {
  risk_appetite: 'Rata-rata berbobot: VIX (0,40, terbalik), HY OAS (0,30, terbalik), dan lebar partisipasi 12 indeks global dengan chg 20 sesi > 0 (0,30).',
  domestic_liquidity: 'Rata-rata berbobot: M2 YoY (0,30), kredit bank YoY (0,30), perubahan SRBI total 1 bulan dalam % (0,20, terbalik: SRBI menarik likuiditas), BI Rate (0,20, terbalik).',
  external: 'Rata-rata berbobot: DXY (0,35, terbalik), US10Y (0,35, terbalik), perubahan USD/IDR 20 sesi (0,30, terbalik).',
  equity: 'Rata-rata berbobot: IHSG chg 20 sesi (0,40), % saham di atas MA50 (0,35), foreign net 20 sesi dalam Rp triliun (0,25).',
};

function scoreBandLabel(v) {
  if (v == null) return 'tidak terukur';
  if (v >= 67) return 'mendukung';
  if (v >= 45) return 'campuran';
  if (v >= 33) return 'campuran-lemah';
  return 'menekan';
}

const STATE_RANK = { fresh: 0, by_source: 1, na: 2, excess: 3, no_series: 3 };

/**
 * @param {Array} series keluaran cross-asset.buildMonitor().series
 * @param {object|null} internals keluaran idx-internals.buildInternals()
 */
function buildRegimeScores(series, internals) {
  const byCode = new Map(series.map(s => [s.code, s]));
  const get = (code) => byCode.get(code) || null;

  // Komponen mentah yang dipakai lebih dari satu skor.
  const globalIdx = series.filter(s => s.category === 'global_index' && Number.isFinite(s.chg_20));
  const globalBreadth = globalIdx.length
    ? {
        id: 'GLOBAL_BREADTH', label: 'Indeks global chg 20 > 0',
        value: r2(globalIdx.filter(s => s.chg_20 > 0).length / globalIdx.length * 100),
        points: band(globalIdx.filter(s => s.chg_20 > 0).length / globalIdx.length * 100, ANCHORS.BREADTH_MA50),
        unit: '%', as_of: globalIdx.map(s => s.as_of).filter(Boolean).sort()[0] || null,
        state: globalIdx.some(s => s.state === 'excess') ? 'excess'
          : globalIdx.some(s => s.state === 'na') ? 'na'
          : globalIdx.some(s => s.state === 'by_source') ? 'by_source' : 'fresh',
        age_days: globalIdx.reduce((mx, s) => Math.max(mx, s.age_days == null ? 0 : s.age_days), 0),
        n: globalIdx.length,
      }
    : null;

  const srbiTotal = get('SRBI_TOTAL');
  let srbi1m = null;
  if (srbiTotal && Number.isFinite(srbiTotal.chg_1) && Number.isFinite(srbiTotal.last_bar_value)) {
    // chg_1 untuk kind 'level' = selisih absolut; ubah ke % dari level agar anchor bermakna.
    const base = srbiTotal.last_bar_value - srbiTotal.chg_1;
    srbi1m = base > 0 ? r2(srbiTotal.chg_1 / base * 100) : null;
  }

  const breadth = internals && internals.breadth;
  const ff = internals && internals.foreign_flow;
  const ihsg = internals && internals.ihsg;

  const compSpec = {
    risk_appetite: [
      { from: 'VIX', label: 'VIX', pick: (s) => s.last, anchors: ANCHORS.VIX, unit: 'index' },
      { from: 'HYOAS', label: 'US HY OAS', pick: (s) => s.last, anchors: ANCHORS.HYOAS, unit: '%' },
      { synth: globalBreadth, label: 'Breadth indeks global' },
    ],
    domestic_liquidity: [
      { from: 'MACRO_M2_YOY', label: 'M2 YoY', pick: (s) => s.last, anchors: ANCHORS.M2_YOY, unit: '%' },
      { from: 'MACRO_LOANS_YOY', label: 'Kredit bank YoY', pick: (s) => s.last, anchors: ANCHORS.LOANS_YOY, unit: '%' },
      { synth: srbi1m != null && srbiTotal ? {
        id: 'SRBI_1M_PCT', label: 'SRBI total 1 bln', value: srbi1m, points: band(srbi1m, ANCHORS.SRBI_1M_PCT),
        unit: '%', as_of: srbiTotal.as_of, state: srbiTotal.state, age_days: srbiTotal.age_days,
      } : null, label: 'SRBI total 1 bln' },
      { from: 'MACRO_BI_RATE', label: 'BI Rate', pick: (s) => s.last, anchors: ANCHORS.BI_RATE, unit: '%' },
    ],
    external: [
      { from: 'DXY', label: 'DXY', pick: (s) => s.last, anchors: ANCHORS.DXY, unit: 'index' },
      { from: 'US10Y', label: 'US 10Y', pick: (s) => s.last, anchors: ANCHORS.US10Y, unit: '%' },
      { from: 'USDIDR', wkey: 'USDIDR_20D', label: 'USD/IDR 20 sesi', pick: (s) => s.chg_20, anchors: ANCHORS.USDIDR_20D, unit: '%' },
    ],
    equity: [
      { synth: ihsg && Number.isFinite(ihsg.chg_20d) ? {
        id: 'IHSG_20D', label: 'IHSG chg 20 sesi', value: ihsg.chg_20d, points: band(ihsg.chg_20d, ANCHORS.IHSG_20D),
        unit: '%', as_of: ihsg.date, state: 'fresh', age_days: 0,
      } : null, label: 'IHSG chg 20 sesi' },
      { synth: breadth && Number.isFinite(breadth.pct_above_ma50) ? {
        id: 'BREADTH_MA50', label: '% saham > MA50', value: breadth.pct_above_ma50, points: band(breadth.pct_above_ma50, ANCHORS.BREADTH_MA50),
        unit: '%', as_of: breadth.as_of, state: 'fresh', age_days: 0,
      } : null, label: '% saham di atas MA50' },
      { synth: ff && Number.isFinite(ff.net_20d) ? {
        id: 'FF_20D_TN', label: 'Foreign net 20 sesi', value: r2(ff.net_20d / 1e12), points: band(ff.net_20d / 1e12, ANCHORS.FF_20D_TN),
        unit: 'Rp tn', as_of: ff.as_of, state: 'fresh', age_days: 0,
      } : null, label: 'Foreign net 20 sesi' },
    ],
  };

  const out = [];
  for (const id of Object.keys(W)) {
    const weights = W[id];
    const comps = [];
    const missing = [];
    let wSum = 0, acc = 0;
    for (const spec of compSpec[id]) {
      let c = null;
      if (spec.synth) {
        c = spec.synth;
        c = { id: c.id, label: spec.label, value: r2(c.value), unit: c.unit, as_of: c.as_of, state: c.state, age_days: c.age_days, points: r2(c.points), aged: false };
        if (c.value == null || c.points == null) c = null;
      } else {
        const s = get(spec.from);
        if (s && s.last != null) {
          const raw = spec.pick(s);
          const pts = band(raw, spec.anchors);
          c = { id: spec.from, label: spec.label, value: r2(raw), unit: s.unit || spec.unit, as_of: s.as_of, state: s.state, age_days: s.age_days, points: r2(pts), level: s.last, aged: !!s.aged, note: s.state === 'na' ? 'umur tidak diukur (lag belum dideklarasikan)' : null };
          if (pts == null) c = null;
        }
      }
      const wkey = spec.wkey || (spec.synth ? (spec.synth.id || spec.label) : spec.from);
      const w = (weights[wkey] == null ? 0 : weights[wkey]);
      if (!c) { missing.push({ label: spec.label, code: spec.from || null, weight: w }); continue; }
      if (w === 0) { missing.push({ label: spec.label, code: spec.from || null, weight: 0 }); comps.push({ code: c.id, label: c.label, value: c.value, unit: c.unit, as_of: c.as_of, state: c.state, age_days: c.age_days, points: c.points, weight: 0, aged: !!c.aged, note: 'tidak berbobot di skor ini' }); continue; }
      comps.push({ code: c.id, label: c.label, value: c.value, unit: c.unit, as_of: c.as_of, state: c.state, age_days: c.age_days, points: c.points, weight: w, aged: !!c.aged, note: c.note || null });
      wSum += w; acc += w * c.points;
    }
    const totalW = Object.values(weights).reduce((a, b) => a + b, 0);
    const coverage = totalW > 0 ? wSum / totalW : 0;
    const score = coverage >= 0.5 ? r2(acc / wSum) : null;

    // as_of = komponen TERTUA (skor tidak lebih segar dari inputnya), status = keadaan terburuk.
    let asOf = null, worst = 'fresh', maxAge = null, anyAged = false, allFresh = true;
    for (const c of comps) {
      if (c.as_of && (!asOf || c.as_of < asOf)) asOf = c.as_of;
      if ((STATE_RANK[c.state] || 0) > (STATE_RANK[worst] || 0)) worst = c.state;
      if (c.age_days != null && (maxAge == null || c.age_days > maxAge)) maxAge = c.age_days;
      if (c.aged) anyAged = true;
      if (c.state !== 'fresh') allFresh = false;
    }
    out.push({
      id,
      label: LABELS[id],
      score,
      band_label: scoreBandLabel(score),
      as_of: asOf,
      age_days: maxAge,
      // 'fresh' hanya bila SEMUA komponen diukur & se-sesi. 'unmeasured' = ada komponen yang
      // umurnya tidak diukur (kalender sumber bukan sesi IDX) tapi masih muda — bukan basi, tapi
      // juga bukan "segar". 'aged' = ada komponen yang umurnya melewati kadensnya.
      status: score == null ? 'unavailable'
        : worst === 'excess' ? 'stale'
        : anyAged ? 'aged'
        : allFresh ? 'fresh'
        : 'unmeasured',
      state_worst: score == null ? null : worst,
      coverage: r2(coverage * 100),
      weights_total: r2(totalW),
      components: comps,
      missing,
      method: METHODS[id],
      reason: score == null ? 'komponen tersedia < 50% bobot — skor tidak dihitung' : null,
    });
  }
  return out;
}

module.exports = { buildRegimeScores, band, ANCHORS, W, scoreBandLabel };
