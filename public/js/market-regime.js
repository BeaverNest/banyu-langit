// ═══ MARKET REGIME — monitor lintas aset + drill-down (kanban t_19f4f0d4) ═══
//
// Halaman ini dibangun dari SATU payload: GET /api/idx/cross-asset.
// Tidak ada endpoint kedua untuk fakta yang sama. Sebelumnya halaman memanggil
// /api/idx/monitor, /api/idx/regime-score, /api/idx/internals-extra DAN /api/idx/cross-asset;
// dua implementasi skor regime menghasilkan angka berbeda pada sesi yang sama (review sena
// t_95ab7fa9 butir 1). Ketiga endpoint kembar itu sudah dihapus dari routes/idx.js.
//
// Struktur (5 lapis + 1 strip narasi):
//   1. Regime bar         — 4 skor, tiap skor membawa tanggal acuan + status kesegaran
//   ·  Berubah hari ini   — 3-5 baris narasi
//   2. Monitor lintas aset — satu baris per seri `custom_tickers`; data baru = baris baru.
//      Klik satu baris = panel detail seri itu (as-of + umur, sumber, n_bars, rentang 1Y, spark)
//      dari payload yang sama — 0 request per klik (kartu t_651e530e).
//   3. Kurva & likuiditas  — 11 tenor SUN (Δ1D/1W/1M) + slope + SRBI/JISDOR
//   4. Internals IDX       — breadth, foreign flow, tape, sektor, konsentrasi ≥1%
//   5. Coverage            — seri basi/hilang/terlambat, bernama + umur
//   6. Hot News            — dipertahankan: feed headline, bukan kartu data (tidak ada di monitor)
//
// ATURAN KESEGARAN: UI TIDAK PERNAH menghitung sendiri ambang basi. Satu-satunya sumber adalah
// server/utils/series-freshness.js yang hasilnya sudah menempel di tiap baris (`state`, `aged`,
// `age_days`) dan di `coverage`. Versi sebelumnya memakai ambang hari lokal (D 5 / W 12 / M 45 /
// Q 130) di UI sementara server memakai ambang per seri — akibatnya 8 baris bertanda ⏸ tampil
// bersama strip "0 seri basi" (DoD5 FAIL). Sekarang strip dan penanda baris membaca field yang
// SAMA, jadi mustahil berbeda.
//
// ATURAN FORMAT: 2 desimal untuk semua nilai yang ditampilkan (rumah: public/js).
// Tidak ada tombol refresh: halaman menyebut kapan server membaca DB (generated_at).

var mrData = null;
var mrLoading = false;
// Indeks baris -> item payload. Diisi saat render; dipakai klik baris (mrRowDetail).
var mrSeriesMap = {};

function loadMarketRegime() {
  var el = $('mr-content'); if (!el) return;
  if (mrData) { renderMR(el); return; }
  el.innerHTML = '<div class="ne" style="padding:40px">Loading Market Regime...</div>';
  mrFetch(el);
}

async function mrFetch(el) {
  if (mrLoading) return;
  mrLoading = true;
  try {
    var r = await fetch('/api/idx/cross-asset');
    var d = await r.json();
    if (!d || d.ok === false) {
      el.innerHTML = '<div class="ne" style="color:var(--rd)">' + esc((d && d.error) || 'payload gagal dimuat') + '</div>';
      mrLoading = false; return;
    }
    mrData = d;
    renderMR(el);
  } catch (e) {
    el.innerHTML = '<div class="ne" style="color:var(--rd)">Error: ' + esc(e.message) + '</div>';
  }
  mrLoading = false;
}

function renderMR(el) {
  var d = mrData; if (!d) return;
  var h = '<div style="padding:12px;font-family:var(--f)">';

  // ── Header ──
  h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">';
  h += '<span style="font-weight:700;font-size:14px">🌐 Market Regime</span>';
  h += '<span style="font-size:10px;color:var(--t3)">data per <b style="color:var(--t2)">' + esc(d.ref_date || '—') + '</b>'
    + ' (' + esc(d.ref_source || '—') + ')</span>';
  h += mrPipelineBadge(d.pipeline);
  h += '</div>';

  // ── 1. Regime bar: tidak ditampilkan (permintaan owner 20 Okt 2026 — dinilai tidak jelas).
  // Data skor tetap ada di payload /api/idx/cross-asset (field `regime`).

  // ── strip narasi harian ──
  // "Berubah hari ini" tidak ditampilkan (permintaan owner 20 Okt 2026).

  // ── 2. Monitor lintas aset ──
  h += mrSection('2', '📋 Monitor lintas aset', mrKpiStrip(d.internals, d.monitor) + mrRenderMonitor(d.monitor));

  // ── 3. Kurva & likuiditas ──
  // L3 dirombak (23 Okt 2026): dua blok ini sebelumnya hanya tabel angka. Sekarang tiap blok
  // punya chart di atas tabel — kurva dengan pembanding 1 bulan lalu, likuiditas dengan riwayat
  // 30 bulan. Tabel tetap ada karena angka eksak + status kesegaran tidak boleh hilang.
  h += mrSection('3', '📐 Kurva &amp; likuiditas',
    '<div id="mr-liq-box">' + mrRenderLiquidity(d.liquidity) + '</div>'
    + '<div style="border-top:1px solid var(--b1);margin:10px 0 8px"></div>'
    + '<div id="mr-curve-box"></div>');

  // ── 4. Internals IDX ──
  h += mrSection('4', '🇮🇩 Internals IDX', mrRenderInternals(d.internals, d));

  // ── 5. Coverage: tidak ditampilkan di Market Regime (permintaan owner 20 Okt 2026).
  // Penanda basi tetap ada di baris tabel (⏸/◔) dan di tooltip; data mentahnya tetap
  // tersedia di payload /api/idx/cross-asset (field `coverage`) untuk diagnosis.

  // ── 6. Hot News (dipertahankan) ──
  h += mrSection('6', '📰 Hot News', '<div id="mr-news"><div style="color:var(--t3);font-size:11px">⏳ Loading headlines...</div></div>');

  h += '</div>';
  // Instance chart lama harus dibuang SEBELUM innerHTML diganti: kalau tidak, ResizeObserver
  // mereka menembak pada elemen yang sudah lepas dari DOM dan melempar error di console.
  mrDisposeSectionCharts();
  el.innerHTML = h;

  // Kurva & likuiditas: data sudah ada di payload, tidak ada fetch kedua.
  // Chart dipasang SETELAH innerHTML terpasang — LWC butuh lebar nyata elemen kontainer.
  setTimeout(function () { mrRenderCurveTo($('mr-curve-box'), d.curve); }, 0);
  setTimeout(function () { mrDrawLiquidity(d.liquidity); }, 0);
  setTimeout(function () { mrRenderInternalsCharts(d.internals); }, 0);
  setTimeout(function () { mrRenderNews('mr-news'); }, 200);
}

// Badge baris-level sinyal "pipeline data berhenti" (kanban t_c6c01360).
// Sumber: ctx.pipeline -> payload.pipeline (server/utils/series-freshness.js). Ambang yang
// SUDAH DIPUTUSKAN (§D3), jangan diubah di sini:
//   elapsed 1 -> catatan netral var(--t3) "sesi terakhir belum masuk", TANPA badge
//   elapsed >=2 -> badge amber var(--am) "⚠ pipeline data berhenti N sesi"
//   elapsed >=5 -> badge merah var(--rd)  (outage > sepekan)
//   calendar_stale -> catatan netral var(--t3), TANPA alarm (kalender kedaluwarsa bukan outage)
// Saat state stopped/calendar_stale semua seri sudah 'na' di server; badge ini hanya menjelaskan
// SEBABNYA. Angka lag sengaja tidak ditampilkan: kita tidak tahu lag-nya, jadi jangan mengarang.
function mrPipelineBadge(p) {
  if (!p || !p.state) return '';
  var calTxt = (p.calendar && p.calendar.valid_through) ? p.calendar.valid_through : '—';
  var title = 'sesi terdeklarasi terakhir yang cutoff-nya (21:00 WIB) sudah lewat: ' + (p.last_expected_session || '—')
    + '; data terakhir di DB: ' + (p.ref_date || '—') + '; kalender sesi valid s/d ' + calTxt;
  if (p.state === 'stopped') {
    var n = p.elapsed_sessions == null ? 0 : p.elapsed_sessions;
    var red = n >= 5;                       // >=5 sesi = outage lebih dari sepekan
    return '<span id="mr-pipeline-badge" data-state="stopped" data-elapsed="' + n + '"'
      + ' data-red="' + (red ? '1' : '0') + '" style="background:'
      + (red ? 'rgba(239,68,68,.12)' : 'rgba(245,158,11,.12)') + ';border:1px solid '
      + (red ? 'var(--rd)' : 'var(--am)') + ';border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;color:'
      + (red ? 'var(--rd)' : 'var(--am)') + '" title="' + esc(title) + '">'
      + '⚠ pipeline data berhenti ' + n + ' sesi</span>';
  }
  if (p.state === 'lag1') {
    return '<span id="mr-pipeline-note" data-state="lag1" data-elapsed="' + (p.elapsed_sessions == null ? 1 : p.elapsed_sessions) + '"'
      + ' style="font-size:10px;color:var(--t3)" title="' + esc(title) + '">sesi terakhir belum masuk (data terakhir '
      + esc(p.ref_date || '—') + ')</span>';
  }
  if (p.state === 'calendar_stale') {
    return '<span id="mr-pipeline-note" data-state="calendar_stale" style="font-size:10px;color:var(--t3)"'
      + ' title="kalender sesi perlu diperbarui dari SK libur bursa IDX; sinyal tidak dinyalakan supaya tidak jadi alarm palsu">'
      + 'kalender sesi kedaluwarsa (valid s/d ' + esc(calTxt) + ')</span>';
  }
  return '';   // 'ok' / 'no_ref' -> tidak ada teks
}

function mrSection(num, title, content) {
  return '<div style="border:1px solid var(--b1);border-radius:6px;margin-bottom:10px;overflow:hidden">' +
    '<div style="padding:8px 12px;background:var(--bg1);border-bottom:1px solid var(--b1);font-size:12px;font-weight:700;color:var(--t1)">' +
    '<span style="color:var(--am);margin-right:6px">L' + num + '</span>' + title + '</div>' +
    '<div style="padding:10px 12px">' + content + '</div></div>';
}

// ═══ Format angka — 2 desimal (aturan rumah), tidak ada cabang ">=1000 dibulatkan" ═══
function mrNum(v) {
  if (v === null || v === undefined || v === '' || isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function mrSigned(v, suffix) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  var n = Number(v);
  return (n > 0 ? '+' : '') + n.toFixed(2) + (suffix || '');
}
function mrColor(v) {
  if (v === null || v === undefined || isNaN(v) || Number(v) === 0) return 'var(--t2)';
  return Number(v) > 0 ? 'var(--gn)' : 'var(--rd)';
}
function mrRpTn(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (Number(v) > 0 ? '+' : '') + (Number(v) / 1e12).toFixed(2) + ' T';
}
function mrClock(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })
      + ' WIB';
  } catch (e) { return String(iso); }
}

// ═══ 1. Regime bar — TIDAK dirender (permintaan owner 20 Okt 2026) ═══
// Fungsi render-nya (dulu `mrRenderRegimeBar` + pembantu `mrScoreColor`/`MR_STATUS_TEXT`)
// DIHAPUS di kartu t_651e530e, bukan dikomentari: jalur render yang ditinggal hidup adalah
// cara termudah menghidupkan kembali seksi yang sudah diputuskan owner untuk dibuang.
// Data `regime` tetap dikirim /api/idx/cross-asset (field `regime`) untuk diagnosis via API.
//
// Catatan yang berlaku untuk isi skor: tidak ada skor komposit di mana pun. Komposit =
// rata-rata berbobot 4 skor heterogen; bobotnya TIDAK diputuskan di kartu mana pun, jadi
// menampilkannya berarti mengarang asumsi diam-diam (versi lama: 24 vs 62,91 di endpoint kembar).

// ═══ 1b. "Berubah hari ini" — TIDAK dirender (permintaan owner 20 Okt 2026) ═══
// `mrRenderChanged` ikut DIHAPUS (kartu t_651e530e) dengan alasan yang sama. Payload tetap
// membawa `changed_today` untuk diagnosis; UI tidak punya jalur untuk mencetaknya.


// ═══ 2. Monitor lintas aset ═══
// Kelompok = payload.monitor.groups (array dari server, urutannya ditentukan server). TIDAK ADA
// daftar kategori yang di-hardcode di sini: kategori baru (mis. `credit`) langsung dirender —
// itu inti DoD2. Satu tabel per (kadens, jenis perubahan): baris bulanan tidak boleh duduk di
// bawah label kolom harian, dan seri rate tidak boleh diberi label "%" (salah satunya adalah
// cacat review t_95ab7fa9 butir 4).
var MR_FREQ_WORD = { D: 'harian', W: 'mingguan', M: 'bulanan', Q: 'kuartalan' };
var MR_FREQ_SHORT = { D: 'D', W: 'W', M: 'M', Q: 'Q', Y: 'Y' };
var MR_FREQ_TEXT = { D: 'harian', W: 'mingguan', M: 'bulanan', Q: 'kuartalan', Y: 'tahunan' };
var MR_UNIT_SHORT = { sesi: 'D', minggu: 'W', bulan: 'M', kuartal: 'Q', tahun: 'Y' };

// Status baris: DIBACA DARI SERVER (`it.status`), bukan dihitung ulang di sini.
// Server mengirim satu status eksklusif per seri dan memakai field yang sama untuk hitungan
// coverage (cross-asset.js), jadi penanda baris dan strip tidak mungkin berbeda cerita —
// cacat review r1 (8 baris ⏸ vs strip "0 seri basi") berasal dari dua implementasi ambang basi.
// Derivasi lokal di bawah hanya cadangan bila payload lama tanpa `status`.
function mrRowState(it) {
  if (it.status) return it.status === 'no_series' ? 'missing' : it.status;
  if (it.no_series) return 'missing';
  if (it.state === 'excess') return 'stale';
  if (it.state === 'by_source') return 'delayed';
  if (it.state === 'na' && it.aged) return 'aged';
  if (it.state === 'na') return 'unmeasured';
  return 'fresh';
}

function mrMonChg(v, isPct, neutral) {
  if (v === null || v === undefined || isNaN(v)) return '<span style="color:var(--t3)">—</span>';
  var c = neutral ? 'var(--t3)' : mrColor(v);      // baris basi: netral, bukan merah/hijau
  return '<span style="color:' + c + '">' + mrSigned(v, isPct ? '%' : '') + '</span>';
}


// ═══ Strip KPI: 4 angka yang menentukan "hari ini risk-on atau risk-off" ═══
// Semua nilai sudah ada di payload (internals + monitor); 0 request tambahan.
function mrKpiStrip(it, mon) {
  var tiles = [];
  var ih = (it && it.ihsg) || null;
  if (ih && ih.level != null) {
    tiles.push({ k: 'IHSG', v: mrNum(ih.level), c: ih.chg_1d, pct: true, sub: 'regime ' + (ih.regime || '—') });
  }
  var ff = (it && it.foreign_flow) || null;
  if (ff && ff.net_today != null) {
    tiles.push({ k: 'Asing hari ini', v: mrRpTn(ff.net_today), c: null, pct: false, sub: '5D ' + mrRpTn(ff.net_5d) });
  }
  var want = { USDIDR: 'USD/IDR', US10Y: 'US 10Y', VIX: 'VIX', ID10Y: 'SUN 10Y' };
  var found = {};
  ((mon && mon.groups) || []).forEach(function (g) {
    (g.items || []).forEach(function (x) { if (want[x.code]) found[x.code] = x; });
  });
  Object.keys(want).forEach(function (code) {
    var x = found[code]; if (!x) return;
    tiles.push({ k: want[code], v: (x.last == null ? '—' : mrNum(x.last)), c: x.chg_1, pct: x.kind === 'price', sub: '' });
  });
  if (!tiles.length) return '';
  var h = '<div class="mr-kpi">';
  tiles.slice(0, 5).forEach(function (t) {
    var col = 'var(--t1)';
    if (t.c != null && !isNaN(t.c)) col = t.c > 0 ? 'var(--gn)' : (t.c < 0 ? 'var(--rd)' : 'var(--t2)');
    var cv = (t.c == null || isNaN(t.c)) ? '—' : (t.pct ? mrSigned(t.c, '%') : mrSigned(t.c, ''));
    h += '<div class="mr-kpi-t"><div class="mr-kpi-k">' + esc(t.k) + '</div>'
      + '<div class="mr-kpi-v">' + t.v + '</div>'
      + '<div class="mr-kpi-c" style="color:' + col + '">' + cv
      + (t.sub ? ' <span style="color:var(--t3)">· ' + esc(t.sub) + '</span>' : '') + '</div></div>';
  });
  h += '</div>';
  return h;
}

function mrRenderMonitor(mon) {
  if (!mon || !mon.groups || !mon.groups.length) {
    return '<div style="color:var(--t3);font-size:11px">Tidak ada seri di custom_tickers.</div>';
  }
  var nRows = 0;
  mon.groups.forEach(function (g) { nRows += (g.items || []).length; });

  var h = '<div class="mr-mon-note">'
    + nRows + ' seri · ' + mon.groups.length + ' kelas aset · klik baris = detail · klik header kolom = urut</div>'
    + '<div class="mr-grid">';

  // Blok kecil terpisah bikin tidak rapi: 'commodity_unverified' digabung ke Komoditas.
  var groups = [];
  var cmd = null;
  mon.groups.forEach(function (g) {
    if (g.category === 'commodity' || g.category === 'commodity_unverified') {
      if (!cmd) { cmd = { category: 'commodity', label: 'Komoditas', windows: g.windows, items: [] }; groups.push(cmd); }
      cmd.items = cmd.items.concat(g.items || []);
      return;
    }
    groups.push(g);
  });

  groups.forEach(function (g) {
    var items = g.items || [];
    if (!items.length) return;
    // Partisi per kadens + jenis perubahan. `window.lags`/`window.unit` datang dari baris itu
    // sendiri (server), bukan dari baris pertama grup.
    var parts = {};
    items.forEach(function (it) {
      var isPct = it.kind === 'price';
      // KUNCI = kadens + JENIS NILAI, bukan kadens saja. Commit 571f156 sempat memakai kadens
      // saja; akibatnya tabel harian yang diawali seri harga (DXY/VIX) menampung US10Y/REAL10Y/
      // HYOAS (kind 'rate') dan mencetak selisih poin sebagai "%" — "-0.06%" untuk 6 bp.
      // Blok per kelas aset tetap satu (commodity digabung di atas); yang dipisah hanya
      // sub-tabel yang semantik kolomnya berbeda.
      var key = (it.freq || 'D') + '|' + (isPct ? 'pct' : 'delta');
      (parts[key] = parts[key] || []).push(it);
    });
    var domFreq = items[0].freq || 'D';
    var nStale = items.filter(function (x) { return mrRowState(x) === 'stale'; }).length;
    h += '<div class="mr-card"><div class="mr-card-h">'
      + '<span class="mr-card-t">' + esc(g.label || g.category) + '</span>'
      + '<span class="mr-card-m">' + items.length + ' seri · ' + esc(MR_FREQ_WORD[domFreq] || domFreq)
      + (nStale ? ' · <b style="color:var(--am)">' + nStale + ' basi</b>' : '') + '</span></div>'
      + '<div class="mr-card-b">';
    Object.keys(parts).sort().forEach(function (key) {
      var rows = parts[key];
      var first = rows[0];
      var isPct = first.kind === 'price';
      var unitWord = (first.window && first.window.unit) || 'sesi';
      var lags = (first.window && first.window.lags) || [1, 5, 20];
      var sfx = MR_UNIT_SHORT[unitWord] || MR_FREQ_SHORT[first.freq] || 'D';
      var caps = lags.map(function (l) { return l + sfx; });
      if (Object.keys(parts).length > 1) {
        // Sub-judul hanya muncul bila satu kelas aset punya lebih dari satu sub-tabel; jenis
        // nilai ditandai Δ supaya dua sub-tabel berkadens sama tidak tampak identik.
        var subLbl = (MR_FREQ_WORD[first.freq] || first.freq || '') + (isPct ? '' : ' · Δ selisih');
        h += '<div style="font-size:9px;color:var(--t3);margin:2px 0">' + esc(subLbl) + '</div>';
      }
      h += mrMonitorTable(rows, caps, isPct, unitWord);
    });
    h += '</div></div>';
  });
  h += '</div>';
  return h;
}

function mrMonitorTable(rows, caps, isPct, unitWord) {
  var h = '<table class="mr-mon" style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:10px;font-family:var(--fm)">'
    + '<colgroup><col style="width:38%"><col style="width:14%">'
    + '<col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:12%"></colgroup>'
    + '<thead><tr style="color:var(--t3)">'
    + '<th style="text-align:left;padding:3px 6px;font-weight:600">Instrumen</th>'
    + '<th style="text-align:right;padding:3px 6px;font-weight:600;cursor:pointer" onclick="mrSortTable(this)">Last</th>';
  caps.forEach(function (c) {
    h += '<th style="text-align:right;padding:3px 6px;font-weight:600;cursor:pointer" onclick="mrSortTable(this)"'
      + (isPct ? '' : ' title="perubahan dalam ' + esc(unitWord) + '"') + '>' + c + '</th>';
  });
  h += '<th style="text-align:right;padding:3px 6px;font-weight:600;cursor:pointer" onclick="mrSortTable(this)">'
    + 'YTD</th>'
    + '</tr></thead><tbody>';

  rows.forEach(function (it) {
    var st = mrRowState(it);
    var neutral = (st === 'stale' || st === 'aged' || st === 'missing');
    var lastCell, mark = '';
    if (it.last === null || it.last === undefined) {
      // Aturan lama dipertahankan: level seri 'excess' TIDAK ditulis sebagai angka terkini.
      lastCell = '<span style="color:var(--t2)" title="bar terakhir '
        + esc(it.as_of || '—') + ' bernilai ' + mrNum(it.last_bar_value) + ' — bukan sesi ' + esc(it.ref_date || '') + '">—</span>';
    } else {
      lastCell = mrNum(it.last);
    }
    if (st === 'stale') mark = ' <span style="color:var(--am)" title="sumber tidak menerbitkan bar untuk ' + (it.excess_sessions || it.lag_sessions || 0) + ' sesi terakhir (ambang ' + (it.expected_lag_sessions == null ? '—' : it.expected_lag_sessions) + ' sesi); retry tidak menolong">⏸</span>';
    else if (st === 'aged') mark = ' <span style="color:var(--am)" title="umur data melewati kadens seri ini dan lag-nya belum dideklarasikan — bukan angka hari ini">◔</span>';
    else if (st === 'delayed') mark = ''; /* penanda titik dihapus: lag wajar bukan anomali, cukup di tooltip */

    var unitTag = '';   // satuan hanya di tooltip, bukan di sebelah nama
    // as-of per baris (DoD3) TANPA kolom: kolom as-of & sumber dihapus dua kali oleh commit
    // 8fc4904/571f156 (pemangkasan teks). Tanggal dicetak hanya bila baris BUKAN 'fresh' DAN
    // tanggalnya berbeda dari sesi rujukan (baris bersesi rujukan sudah bertanggal di header);
    // tanggal + sumber + umur selalu ada di title baris, jadi tidak ada baris yang tak bisa dicek.
    var needsDate = st !== 'fresh' && it.as_of && it.as_of !== it.ref_date;
    var asofNote = '';  // tanggal/umur hanya di tooltip baris
    var rowTitle = (it.name || it.code) + ': bar terakhir ' + (it.as_of || '—')
      + (it.age_days != null ? ' · umur ' + it.age_days + ' hari' : '')
      + (it.ref_date ? ' · rujukan sesi ' + it.ref_date : '')
      + (it.source ? ' · sumber ' + it.source : '');
    var rowKey = (it.category || '') + '|' + (it.code || '');
    mrSeriesMap[rowKey] = it;
    h += '<tr class="mr-row" data-state="' + st + '" data-asof="' + esc(it.as_of || '') + '"'
      + ' data-key="' + esc(rowKey) + '" onclick="mrRowDetail(this)"'
      + ' style="border-bottom:1px solid var(--b1)">';
    h += '<td style="padding:3px 6px;font-family:var(--f);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(rowTitle) + '">' + esc(it.name || it.code) + mark + unitTag + asofNote + '</td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.last === null || it.last === undefined ? '' : it.last) + '">' + lastCell + '</td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.chg_1 == null ? '' : it.chg_1) + '">' + mrMonChg(it.chg_1, isPct, neutral) + '</td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.chg_5 == null ? '' : it.chg_5) + '">' + mrMonChg(it.chg_5, isPct, neutral) + '</td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.chg_20 == null ? '' : it.chg_20) + '">' + mrMonChg(it.chg_20, isPct, neutral) + '</td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.chg_ytd == null || it.n_bars < 2 ? '' : it.chg_ytd) + '">'
      + (it.n_bars < 2 ? '<span style="color:var(--t3)" title="seri baru punya 1 bar: YTD tidak bermakna">—</span>' : mrMonChg(it.chg_ytd, isPct, neutral)) + '</td>';
    h += '</tr>';
  });
  h += '</tbody></table>';
  return h;
}

// ═══ Drill-down baris monitor (kartu t_651e530e) ═══
// Satu klik membuka satu panel TEPAT di bawah baris yang diklik. Semua field yang ditampilkan
// sudah ada di payload /api/idx/cross-asset (`as_of`, `age_days`, `source`, `n_bars`, `first_date`,
// `win_1y_min/max`, `spark`) — jadi 0 request per klik dan tidak ada endpoint tambahan.
// Kenapa panel dan bukan kolom: grid monitor berhenti di YTD (aturan owner — kolom as-of/sumber
// dan %ile 1Y tidak kembali); provenance dibaca di panel, bukan di grid. `pctile_1y` SENGAJA
// tidak dicetak meski ada di payload, karena dialah kolom yang dihapus owner (2796faf).
// Degradasi wajib: status 'no_series'/n_bars 0 -> "tidak ada seri"; n_bars < 21 -> "riwayat <
// 21 bar"; spark kosong/<2 titik -> "spark tidak tersedia". Tidak ada panel kosong, tidak throw.
var MR_ROW_TEXT = {
  fresh:      ['segar',                               'var(--gn)'],
  stale:      ['basi — sumber tidak menerbitkan bar',  'var(--rd)'],
  aged:       ['umur lewat kadens',                    'var(--am)'],
  delayed:    ['terlambat (wajar untuk sumber ini)',    'var(--t3)'],
  unmeasured: ['', 'var(--t3)'],
  missing:    ['tidak ada seri',                       'var(--rd)']
};

function mrCloseSeriesDetail() {
  var openRows = document.querySelectorAll('tr.mr-detail');
  for (var i = 0; i < openRows.length; i++) openRows[i].parentNode.removeChild(openRows[i]);
  var sel = document.querySelectorAll('table.mr-mon tr.mr-row[data-open="1"]');
  for (var j = 0; j < sel.length; j++) sel[j].removeAttribute('data-open');
  mrDisposeSparkCharts();   // instance LWC hidup di panel yang baru dibuang
}

function mrRowDetail(tr) {
  var key = tr.getAttribute('data-key') || '';
  var it = mrSeriesMap[key];
  if (!it) return;                          // baris tanpa item payload: diam, jangan error
  var wasOpen = tr.getAttribute('data-open') === '1';
  mrCloseSeriesDetail();
  if (wasOpen) return;                      // klik kedua pada baris yang sama = tutup
  tr.setAttribute('data-open', '1');
  var row = document.createElement('tr');
  row.className = 'mr-detail';
  row.setAttribute('data-detail', '1');
  row.setAttribute('data-key', key);
  row.innerHTML = '<td colspan="6" style="padding:8px 10px;background:var(--bg1);'
    + 'border-bottom:1px solid var(--b2);font-family:var(--fm)">' + mrSeriesDetailHtml(it) + '</td>';
  tr.parentNode.insertBefore(row, tr.nextSibling);
  mrMountSparkCharts(row);
}

// Pasang LWC di setiap kontainer .mr-spark-lwc pada panel yang baru masuk DOM.
// Fallback: bila LightweightCharts tidak tersedia, gambar ulang dengan SVG lama (tampilan
// tetap informatif, hanya kehilangan sumbu waktu & tooltip bawaan).
function mrMountSparkCharts(scope) {
  var boxes = (scope || document).querySelectorAll('.mr-spark-lwc');
  for (var i = 0; i < boxes.length; i++) {
    var el = boxes[i];
    if (el.getAttribute('data-mounted') === '1') continue;
    var vals = [], dates = [];
    try {
      vals = JSON.parse(el.getAttribute('data-vals') || '[]');
      dates = JSON.parse(el.getAttribute('data-dates') || '[]');
    } catch (e) { vals = []; dates = []; }
    if (vals.length < 2) { el.parentNode.removeChild(el); continue; }
    var col = vals[vals.length - 1] >= vals[0] ? mrSparkTheme().up : mrSparkTheme().down;
    var mounted = false;
    try { mounted = mrSparkLwc(el, vals, dates, col); } catch (e) { mounted = false; }
    if (mounted) {
      el.setAttribute('data-mounted', '1');
    } else {
      var wrap = document.createElement('div');
      wrap.innerHTML = mrSparkSvg(vals, dates);
      el.parentNode.replaceChild(wrap, el);
    }
  }
}

// Sparkline drill-down = Lightweight Charts v5 (Apache-2.0, TradingView), bukan SVG manual.
// Alasan: sumbu waktu ikut benar (gap akhir pekan/libur tidak diratakan seperti polyline
// index-per-titik), crosshair + tooltip bawaan, dan panel bisa di-zoom/di-pan tanpa kode hover
// sendiri. Library-nya disajikan lokal (public/js/vendor) supaya atribusi & lisensi terkendali.
// Kalau window.LightweightCharts tidak ada (CDN/lokal gagal muat, tes DOM tanpa JS vendor),
// fungsi jatuh ke SVG lama — panel tetap terisi, tidak ada layar kosong.
var MR_SPARK_CHARTS = [];
// Chart bagian L3/L4 dipisah dari chart drill-down baris. Dulu semuanya satu array, dan
// mrCloseSeriesDetail() (dipanggil tiap kali baris monitor diklik) membuang SEMUA chart —
// temuan uji 23 Okt: setelah klik satu baris, canvas likuiditas/kurva/IHSG/flow jadi 0.
var MR_SECTION_CHARTS = [];

function mrDisposeCharts(arr) {
  for (var i = 0; i < arr.length; i++) {
    var ch = arr[i];
    try { if (ch.__mrRO) ch.__mrRO.disconnect(); } catch (e) {}
    try { if (ch.__mrDisposed) ch.__mrDisposed(); } catch (e) {}
    try { ch.remove(); } catch (e) { /* sudah lepas dari DOM */ }
  }
  arr.length = 0;
}

function mrDisposeSparkCharts() {
  mrDisposeCharts(MR_SPARK_CHARTS);
}

function mrDisposeSectionCharts() {
  mrDisposeCharts(MR_SECTION_CHARTS);
}

// ── Tinggi chart: satu sumber untuk kontainer DAN canvas ──
// Sebelumnya tiap chart punya angka sendiri (110–200 px) dan canvas-nya dibuat dengan angka
// terpisah dari tinggi kontainer. Begitu keduanya berbeda, canvas meluber atau menyisakan celah.
// Aturan sekarang: tinggi ditentukan CSS clamp() pada kontainer (`mrChartCss`), dan canvas
// membaca clientHeight kontainer. `mrChartH` hanya cadangan angka untuk kasus kontainer masih
// tersembunyi (clientHeight = 0) saat chart dibuat.
var MR_CHART_H = { liq: 360, curve: 380, hist: 300, ihsg: 310, flow: 270, spark: 230 };

// Tinggi kontainer ditulis sebagai CSS clamp(), BUKAN angka px hasil hitung saat render.
// Alasan: tinggi px yang dipanggang ke inline style tidak berubah saat jendela di-resize —
// sudah diuji: viewport 577 px -> 900 px, kontainer tetap 317 px. Dengan clamp() + vh,
// kontainer ikut viewport, dan ResizeObserver meneruskan perubahan itu ke canvas.
// CATATAN: satuan vh = persen tinggi viewport, jadi angkanya 28–42, BUKAN hasil kali basis.
// Percobaan pertama memakai base×0.62 sebagai vh (223vh) — semua chart mentok ke batas atas.
var MR_CHART_CSS = {
  liq:   'clamp(340px, 40vh, 520px)',
  curve: 'clamp(360px, 44vh, 560px)',
  hist:  'clamp(300px, 36vh, 460px)',
  ihsg:  'clamp(320px, 40vh, 520px)',
  flow:  'clamp(280px, 34vh, 440px)',
  spark: 'clamp(200px, 26vh, 320px)'
};

function mrChartCss(kind) {
  return MR_CHART_CSS[kind] || 'clamp(200px, 30vh, 380px)';
}

function mrChartH(kind) {
  var base = MR_CHART_H[kind] || 240;
  var vh = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 900;
  return Math.max(Math.round(base * 0.7), Math.min(Math.round(base * 1.5), Math.round(vh * 0.55) || base));
}
// `spec.height`, `spec.series` = [{type:'line'|'bars', data:[{time,value}], color, title}] .
// Semua chart yang dibuat lewat sini otomatis masuk MR_SPARK_CHARTS sehingga render ulang
// (ganti tab / refresh) tidak meninggalkan instance yatim.
function mrLwcCreate(el, spec) {
  var LWC = (typeof window !== 'undefined') ? window.LightweightCharts : null;
  if (!LWC || typeof LWC.createChart !== 'function' || !el) return null;
  var th = mrSparkTheme();
  var cs = getComputedStyle(document.documentElement);
  var chart;
  try {
    chart = LWC.createChart(el, {
      width: el.clientWidth || 600,
      // Tinggi ikut kontainer, bukan angka sendiri: kontainer yang menentukan (mrChartH), canvas
      // menyesuaikan. Kalau spec.height diberikan, itu hanya cadangan saat clientHeight = 0
      // (panel masih tersembunyi).
      height: el.clientHeight || spec.height || 200,
      layout: {
        background: { type: 'solid', color: th.bg },
        textColor: th.text,
        fontFamily: (cs.getPropertyValue('--fm') || 'monospace').trim() || 'monospace',
        // 10 px: chart sekarang 2–3× lebih tinggi, jadi label 9 px terlihat kecil dan sumbu waktu
        // (bulan/tanggal) sulit dibaca. 10 px masih muat di kolom sempit 480 px.
        fontSize: 10,
        attributionLogo: true      // syarat lisensi Apache-2.0 Lightweight Charts
      },
      grid: { vertLines: { visible: false }, horzLines: { color: th.grid, style: 2 } },
      // Sumbu kiri dipakai hanya kalau ada seri dengan satuan berbeda (mis. JISDOR IDR/USD
      // berdampingan dengan SRBI Rp tn). Dua skala terpisah = dua satuan, bukan dua sumbu curang.
      leftPriceScale: { visible: !!spec.leftScale, borderColor: th.grid, scaleMargins: { top: 0.14, bottom: 0.14 } },
      rightPriceScale: {
        borderColor: th.grid,
        scaleMargins: { top: 0.14, bottom: 0.14 },
        // label harga di kanan; satuan ditulis di judul/legenda, bukan di setiap label
        priceFormat: spec.priceFormat || { type: 'price', precision: spec.precision == null ? 2 : spec.precision, minMove: spec.minMove || 0.01 }
      },
      timeScale: { borderColor: th.grid, timeVisible: false, secondsVisible: false },
      crosshair: { mode: 1 },
      handleScroll: false,
      handleScale: false,
      localization: { locale: 'en-US' }
    });
  } catch (e) { return null; }

  var created = 0;
  var needLeft = !!spec.leftScale;
  (spec.series || []).forEach(function (s) { if (s.scale === 'left') needLeft = true; });
  (spec.series || []).forEach(function (s) {
    try {
      var scaleId = s.scale === 'left' ? 'left' : 'right';
      if (s.type === 'bars') {
        var h = chart.addSeries(LWC.HistogramSeries, {
          color: s.color, priceLineVisible: false, lastValueVisible: false, base: 0,
          priceScaleId: scaleId,
          priceFormat: s.priceFormat || spec.priceFormat || { type: 'price', precision: 2, minMove: 0.01 }
        });
        h.setData(s.data);
      } else {
        var ln = chart.addSeries(LWC.LineSeries, {
          color: s.color, lineWidth: s.width || 2,
          priceLineVisible: false, lastValueVisible: true,
          priceScaleId: scaleId,
          priceFormat: s.priceFormat || spec.priceFormat || undefined,
          crosshairMarkerVisible: true, crosshairMarkerRadius: 3,
          title: s.title || ''
        });
        ln.setData(s.data);
      }
      created++;
    } catch (e) { /* seri gagal: chart tetap hidup dengan seri lain */ }
  });
  if (needLeft) { try { chart.applyOptions({ leftPriceScale: { visible: true, borderColor: th.grid, scaleMargins: { top: 0.14, bottom: 0.14 } } }); } catch (e) {} }
  if (!created) { try { chart.remove(); } catch (e) {} return null; }
  chart.timeScale().fitContent();

  var disposed = false;
  chart.__mrDisposed = function () { disposed = true; };
  var ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(function () {
    if (disposed) return;
    // Lebar DAN tinggi: chart di panel ini tinggi-nya mengikuti viewport (mrChartH), jadi saat
    // window di-resize canvas harus ikut, bukan hanya melebar.
    try { chart.applyOptions({ width: el.clientWidth || 600, height: el.clientHeight || spec.height || 200 }); } catch (e) {}
  }) : null;
  if (ro) ro.observe(el);
  chart.__mrRO = ro;
  MR_SPARK_CHARTS.push(chart);
  return chart;
}

// Sama seperti mrLwcCreate, tetapi terdaftar sebagai chart bagian (L3/L4) yang hanya dibuang
// saat seluruh panel di-render ulang — bukan saat baris monitor dibuka/ditutup.
function mrLwcCreateSection(el, spec) {
  var ch = mrLwcCreate(el, spec);
  if (ch) {
    // mrLwcCreate mendaftarkan ke MR_SPARK_CHARTS; pindahkan ke daftar bagian.
    var idx = MR_SPARK_CHARTS.indexOf(ch);
    if (idx >= 0) MR_SPARK_CHARTS.splice(idx, 1);
    MR_SECTION_CHARTS.push(ch);
  }
  return ch;
}

// Ubah {dates:[...], values:[...]} -> titik LWC; tanggal non-ISO dibuang bersama nilainya.
function mrLwcPoints(dates, values, transform) {
  var pts = [];
  for (var i = 0; i < values.length; i++) {
    var d = (dates && dates[i]) ? String(dates[i]).slice(0, 10) : null;
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    var v = transform ? transform(values[i], i) : values[i];
    if (v === null || v === undefined || isNaN(v)) continue;
    pts.push({ time: d, value: Number(v) });
  }
  return pts;
}


function mrSparkTheme() {
  // Warna dibaca dari CSS variable supaya tema terang/gelap Banyu Langit tetap berlaku;
  // LWC menggambar di canvas sendiri sehingga tidak mewarisi warna teks induknya.
  var cs = getComputedStyle(document.documentElement);
  var g = function (n, d) { var v = (cs.getPropertyValue(n) || '').trim(); return v || d; };
  return {
    up: g('--gn', '#00e676'),
    down: g('--rd', '#ff3d00'),
    text: g('--t3', '#555555'),
    grid: g('--b1', '#1e1e1e'),
    bg: 'transparent'
  };
}

function mrSparkLwc(el, vals, dates, color) {
  var pts = mrLwcPoints(dates, vals);
  if (pts.length < 2) return false;
  var ch = mrLwcCreate(el, {
    height: mrChartH('spark'),
    series: [{ type: 'line', data: pts, color: color, width: 2 }]
  });
  return !!ch;
}

function mrSparkSvg(vals, dates) {
  // Lebar mengikuti tabel (viewBox diskalakan). Hover memakai koordinat viewBox yang sama.
  var w = 1000, hgt = 140, pad = 8;
  var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
  var span = (max - min) || 1;
  var pts = vals.map(function (v, i) {
    var x = pad + (w - 2 * pad) * (vals.length <= 1 ? 0 : i / (vals.length - 1));
    var y = hgt - pad - (hgt - 2 * pad) * ((v - min) / span);
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  var col = vals[vals.length - 1] >= vals[0] ? 'var(--gn)' : 'var(--rd)';
  var ds = JSON.stringify(dates || []).replace(/'/g, '&#39;');
  return '<div style="position:relative;margin-top:6px">'
    + '<svg width="100%" height="' + hgt + '" viewBox="0 0 ' + w + ' ' + hgt + '"'
    + ' preserveAspectRatio="none" data-vals=\'' + JSON.stringify(vals) + '\' data-dates=\'' + ds + '\''
    + ' style="display:block;width:100%;cursor:crosshair" aria-label="sparkline" role="img"'
    + ' onmousemove="mrSparkMove(event,this)" onmouseleave="mrSparkLeave(this)">'
    + '<polyline fill="none" stroke="' + col + '" stroke-width="1.6" vector-effect="non-scaling-stroke"'
    + ' points="' + pts + '"></polyline>'
    + '<line class="mr-cross" x1="0" y1="0" x2="0" y2="' + hgt + '" stroke="rgba(160,170,190,.55)"'
    + ' stroke-width="1" vector-effect="non-scaling-stroke" style="display:none"></line>'
    + '<circle class="mr-dot" cx="0" cy="0" r="3" fill="' + col + '" style="display:none"></circle>'
    + '</svg>'
    + '<div class="mr-spark-tip" style="position:absolute;top:0;left:0;pointer-events:none;opacity:0;'
    + 'background:var(--bg2);border:1px solid var(--b1);border-radius:4px;padding:2px 6px;font-size:9px;'
    + 'font-family:var(--fm);white-space:nowrap;transition:opacity .1s"></div>'
    + '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--t3);margin-top:2px">'
    + '<span>' + mrNum(min) + '</span><span>' + mrNum(max) + '</span></div>'
    + '</div>';
}

// Hover: crosshair + tooltip tanggal/nilai. Dipakai bersama semua baris (delegasi per elemen).
function mrSparkMove(ev, svg) {
  var vals = JSON.parse(svg.getAttribute('data-vals') || '[]');
  var dates = JSON.parse(svg.getAttribute('data-dates') || '[]');
  if (!vals.length) return;
  var box = svg.getBoundingClientRect();
  var rel = (ev.clientX - box.left) / (box.width || 1);
  var i = Math.round(rel * (vals.length - 1));
  i = Math.max(0, Math.min(vals.length - 1, i));
  var pad = 8, w = 1000;
  var x = pad + (w - 2 * pad) * (vals.length <= 1 ? 0 : i / (vals.length - 1));
  var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), span = (max - min) || 1;
  var y = 140 - pad - (140 - 2 * pad) * ((vals[i] - min) / span);
  var line = svg.querySelector('.mr-cross'), dot = svg.querySelector('.mr-dot');
  if (line) { line.setAttribute('x1', x); line.setAttribute('x2', x); line.style.display = ''; }
  if (dot) { dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.style.display = ''; }
  var tip = svg.parentNode.querySelector('.mr-spark-tip');
  if (tip) {
    tip.style.opacity = 1;
    tip.textContent = (dates[i] || '') + ' · ' + mrNum(vals[i]);
    var left = Math.min(Math.max(0, rel * box.width - 45), Math.max(0, box.width - 120));
    tip.style.left = left + 'px';
  }
}

function mrSparkLeave(svg) {
  var line = svg.querySelector('.mr-cross'), dot = svg.querySelector('.mr-dot');
  if (line) line.style.display = 'none';
  if (dot) dot.style.display = 'none';
  var tip = svg.parentNode.querySelector('.mr-spark-tip');
  if (tip) tip.style.opacity = 0;
}

function mrSeriesDetailHtml(it) {
  var st = mrRowState(it);
  var stp = MR_ROW_TEXT[st] || MR_ROW_TEXT.unmeasured;
  var n = (it.n_bars == null) ? 0 : it.n_bars;
  var spark = (Array.isArray(it.spark) ? it.spark : []).filter(function (v) {
    return v !== null && v !== undefined && !isNaN(v);
  });

  // data-* dipakai uji (dan reviewer) supaya angka di panel bisa dicek tanpa membaca teks.
  var h = '<div class="mr-series-detail" data-code="' + esc(it.code || '') + '"'
    + ' data-status="' + esc(st) + '" data-n-bars="' + n + '"'
    + ' data-win-min="' + (it.win_1y_min == null ? '' : it.win_1y_min) + '"'
    + ' data-win-max="' + (it.win_1y_max == null ? '' : it.win_1y_max) + '"'
    + ' data-spark-n="' + spark.length + '">';
  h += '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:baseline">'
    + '<b style="font-size:11px;color:var(--t1)">' + esc(it.name || it.code || '—') + '</b>'
    + '<span style="font-size:9px;color:var(--t3)">' + esc(it.code || '') + '</span>'
    + '<span style="font-size:9px;color:' + stp[1] + '">' + esc(stp[0]) + '</span></div>';
  // Provenance lengkap ada di title baris tabel; panel detail cukup identitas + level terakhir.
  h += '<div style="display:flex;flex-wrap:wrap;gap:10px;font-size:9px;color:var(--t3);margin-top:3px">'
    + '<span>terakhir <b style="color:var(--t2)">' + mrNum(it.last) + '</b></span>'
    + '<span>' + esc(MR_FREQ_TEXT[it.freq] || it.freq || '') + '</span>'
    + '</div>';

  if (st === 'missing' || n === 0) {
    h += '<div style="font-size:10px;color:var(--rd);margin-top:5px">tidak ada seri: '
      + esc(it.code || '') + ' belum punya bar sama sekali, jadi tidak ada rentang 1Y maupun '
      + 'spark untuk digambar.</div></div>';
    return h;
  }
  if (n < 21) {
    h += '<div style="font-size:9px;color:var(--am);margin-top:4px">riwayat &lt; 21 bar (' + n
      + ' bar): rentang 1Y dan YTD belum bermakna untuk seri ini.</div>';
  }
  if (spark.length < 2) {
    h += '<div style="font-size:9px;color:var(--t3);margin-top:4px">spark tidak tersedia ('
      + spark.length + ' titik di payload)</div>';
  } else {
    // Kontainer kosong: chart dipasang SETELAH baris masuk DOM (butuh lebar nyata elemen).
    // data-* = nilai yang sama dengan payload; tidak ada request tambahan.
    h += '<div class="mr-spark-lwc" style="height:' + mrChartCss('spark') + ';width:100%;margin-top:6px"'
      + ' data-vals=\'' + JSON.stringify(spark) + '\''
      + ' data-dates=\'' + JSON.stringify(it.spark_dates || []) + '\'></div>';
  }
  h += '</div>';
  return h;
}

function mrSortTable(th) {
  var table = th.closest('table'); if (!table) return;
  // Baris panel detail hidup DI DALAM tabel yang sama: tutup dulu. Kalau tidak, panelnya ikut
  // jadi anggota array sortir dan tertinggal di posisi lama setelah baris induknya pindah —
  // kelas cacat yang sama dengan baris keluar dari tbody (temuan sena r3).
  mrCloseSeriesDetail();
  var idx = Array.prototype.indexOf.call(th.parentNode.children, th);
  var asc = th.getAttribute('data-asc') !== '1';
  th.setAttribute('data-asc', asc ? '1' : '0');
  var body = Array.prototype.slice.call(table.querySelectorAll('tr')).filter(function (r) { return r.querySelector('td') && r.getAttribute('data-detail') !== '1'; });
  body.sort(function (a, b) {
    var ca = a.children[idx], cb = b.children[idx];
    var rawA = ca ? ca.getAttribute('data-v') : null;
    var rawB = cb ? cb.getAttribute('data-v') : null;
    var va = rawA === null || rawA === '' ? NaN : parseFloat(rawA);
    var vb = rawB === null || rawB === '' ? NaN : parseFloat(rawB);
    // Kolom teks (as-of, sumber, instrumen): bandingkan sebagai string ISO/nama.
    if (isNaN(va) && isNaN(vb)) {
      var sa = ca ? (ca.textContent || '') : '', sb = cb ? (cb.textContent || '') : '';
      return asc ? sa.localeCompare(sb) : sb.localeCompare(sa);
    }
    if (isNaN(va)) return 1;
    if (isNaN(vb)) return -1;
    return asc ? va - vb : vb - va;
  });
  // Baris HARUS masuk ke <tbody>, bukan ke <table>: appendChild ke <table> mengeluarkan
  // baris dari tbody (terukur: tbody rows 12 -> 0 setelah klik header; temuan sena r3).
  var tb = (table.tBodies && table.tBodies[0]) ? table.tBodies[0] : table;
  body.forEach(function (r) { tb.appendChild(r); });
}

// ═══ 3a. Likuiditas: SRBI & JISDOR ═══
function mrRenderLiquidity(liq) {
  if (!liq || !liq.items || !liq.items.length) return '<div style="color:var(--t3);font-size:11px">SRBI/JISDOR tidak tersedia.</div>';
  var h = '<div style="font-size:10px;font-weight:700;margin:16px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--b1)">Likuiditas domestik '
    + '<span style="font-weight:400;color:var(--t3)">· seri bulanan · terakhir ' + esc(liq.as_of || '—') + '</span></div>';
  // Chart riwayat: SRBI (Rp tn) di sumbu kanan, JISDOR (IDR/USD) di sumbu kiri — beda satuan,
  // beda skala. Tabel di bawah tetap jadi tempat angka eksak; chart hanya menjawab arah.
  h += '<div id="mr-liq-chart" style="height:' + mrChartCss('liq') + ';background:var(--bg1);border:1px solid var(--b1);border-radius:6px;margin-bottom:8px"></div>';
  h += '<table style="width:100%;border-collapse:collapse;font-size:10px;font-family:var(--fm)">';
  h += '<thead><tr>';
    + '<th style="text-align:left;padding:3px 6px;font-weight:600">Seri</th>'
    + '<th style="text-align:right;padding:3px 6px;font-weight:600">Level</th>'
    + '<th style="text-align:right;padding:3px 6px;font-weight:600">Δ1 periode</th>'
    + '<th style="text-align:left;padding:3px 6px;font-weight:600">status</th></tr></thead><tbody>';
  liq.items.forEach(function (x) {
    if (x.missing) {
      h += '<tr class="mr-liq" data-state="missing" style="border-bottom:1px solid var(--b1)">'
        + '<td style="padding:3px 6px">' + esc(x.label) + ' <span style="color:var(--am)">hilang dari custom_tickers</span></td>'
        + '<td style="padding:3px 6px;text-align:right">—</td><td style="padding:3px 6px;text-align:right">—</td>'
        + '<td style="padding:3px 6px;text-align:right">—</td><td style="padding:3px 6px">—</td></tr>';
      return;
    }
    // Status dari server (`x.status`), bukan disimpulkan lagi di sini: seri SRBI yang umurnya
    // lewat kadens dulu tampil "segar" karena blok ini hanya membaca x.stale/x.state.
    var st = x.status || (x.stale ? 'stale' : (x.state === 'na' ? 'unmeasured' : 'fresh'));
    var MR_LIQ_TEXT = {
      fresh: ['segar', 'var(--gn)'],
      stale: ['basi', 'var(--rd)'],
      delayed: ['terlambat (wajar)', 'var(--t3)'],
      aged: ['umur &gt; kadens', 'var(--am)'],
      unmeasured: ['', 'var(--t3)'],
      no_series: ['tanpa bar', 'var(--rd)']
    };
    var stPair = MR_LIQ_TEXT[st] || MR_LIQ_TEXT.unmeasured;
    var stTxt = '<span style="color:' + stPair[1] + '" title="' + esc('as-of ' + (x.as_of || '—')
      + (x.age_days == null ? '' : ' · umur ' + x.age_days + ' hari')) + '">' + stPair[0] + '</span>';
    var neutralLiq = (st === 'stale' || st === 'aged' || st === 'missing');
    var lvl = (x.last === null || x.last === undefined)
      ? '<span style="color:var(--t2)" title="bar terakhir ' + mrNum(x.last_bar_value) + ' pada ' + esc(x.as_of || '') + '">—</span>'
      : '<span' + (neutralLiq ? ' style="color:var(--t2)"' : '') + '>' + mrNum(x.last) + '</span>';
    var d1 = (x.chg_1 === null || x.chg_1 === undefined) ? '—'
      : '<span style="color:' + (neutralLiq ? 'var(--t3)' : mrColor(x.chg_1)) + '">' + mrSigned(x.chg_1, x.chg_1_unit === '%' ? '%' : '') + '</span>';
    h += '<tr class="mr-liq" data-state="' + st + '" style="border-bottom:1px solid var(--b1)">'
      + '<td style="padding:3px 6px;font-family:var(--f)">' + esc(x.label) + '</td>'
      + '<td style="padding:3px 6px;text-align:right">' + lvl + '</td>'
      + '<td style="padding:3px 6px;text-align:right">' + d1 + '</td>'
      + '<td style="padding:3px 6px">' + stTxt + '</td></tr>';
  });
  h += '</table>';
  h += '<div style="font-size:9px;color:var(--t3);margin-top:4px">' + esc(liq.note || '') + '</div>';
  // Chart TIDAK digambar di sini: fungsi ini masih membangun string, kontainernya belum ada di
  // DOM. renderMR memanggil mrDrawLiquidity setelah innerHTML terpasang (lihat setTimeout).
  return h;
}

// Chart likuiditas: level SRBI per komponen (Rp tn, sumbu kanan) + JISDOR (IDR/USD, sumbu kiri).
// 30 titik terakhir dari `spark` seri monitor. Tanggalnya tanggal rilis bulanan, jadi jarak antar
// titik ~1 bulan — bukan harian. Chart TIDAK memperpanjang garis melewati tanggal rilis terakhir:
// level SRBI Agustus 2026 tidak boleh dibaca sebagai "hari ini".
function mrDrawLiquidity(liq) {
  var el = $('mr-liq-chart'); if (!el) return;
  var picked = (liq.items || []).filter(function (x) {
    return !x.missing && x.spark && x.spark.length > 1 && x.spark_dates && x.spark_dates.length > 1;
  });
  if (!picked.length) {
    el.innerHTML = '<div style="color:var(--t3);font-size:10px;padding:8px">Riwayat likuiditas tidak tersedia (seri tidak membawa spark).</div>';
    return;
  }
  var colors = ['#5470c6', '#f0a020', '#9aa4b2', '#22c55e'];
  var series = [];
  picked.forEach(function (x, i) {
    var isFx = (x.unit || '').indexOf('IDR') === 0;
    var col = isFx ? mrCssColor('var(--gn)') : colors[i % colors.length];
    series.push({
      type: 'line',
      data: mrLwcPoints(x.spark_dates, x.spark),
      color: col,
      width: isFx ? 1.6 : 2,
      title: x.label + (x.unit ? ' (' + x.unit + ')' : ''),
      scale: isFx ? 'left' : 'right',
      priceFormat: isFx ? { type: 'price', precision: 0, minMove: 1 }
        : { type: 'price', precision: 2, minMove: 0.01 }
    });
  });
  var ch = mrLwcCreateSection(el, { height: mrChartH('spark'), leftScale: series.some(function (s) { return s.scale === 'left'; }), series: series });
  if (!ch) {
    el.innerHTML = '<div style="color:var(--t3);font-size:10px;padding:8px">Lightweight Charts tidak termuat.</div>';
  }
}

// ═══ 3b. Kurva imbal hasil SUN — 11 tenor, hari ini vs 1W vs 1M ═══
// Data: payload.curve (satudata, satu tanggal untuk seluruh kurva). UI tidak menghitung slope
// dan tidak mengambil bar terdekat untuk tenor yang tertinggal: yang tidak punya bar di tanggal
// kurva ditulis "—" beserta tanggal bar terakhirnya.
function mrFmtBp(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (v > 0 ? '+' : '') + Number(v).toFixed(2);
}

function mrRenderCurveTo(box, d) {
  if (!box) return;
  if (!d || d.available === false || !d.tenors || !d.tenors.length) {
    box.innerHTML = '<div style="color:var(--t3);font-size:11px">Kurva tidak tersedia'
      + (d && d.error ? ': ' + esc(d.error) : ' (tidak ada seri tenor SUN di custom_ohlc)') + '.</div>';
    return;
  }
  var cov = d.coverage || { present: 0, total: 0 };
  var h = '<div style="font-size:10px;font-weight:700;margin:16px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--b1)">Kurva SUN '
    + '<span style="font-weight:400;color:var(--t3)">· ' + cov.present + '/' + cov.total + ' tenor</span></div>';
  h += '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;margin-bottom:6px;font-size:10px;color:var(--t3)">';
  h += '<span>sumber: <b style="color:var(--t2)">' + esc(d.source || 'investing') + '</b></span>';
  h += '<span>tanggal kurva: <b style="color:var(--t1)" id="mr-curve-date">' + esc(d.as_of || '—') + '</b></span>';
  if (d.is_latest === false && d.latest_date) {
    h += '<span style="color:var(--am)">bar terbaru ' + esc(d.latest_date) + ' — kurva diambil dari sesi sebelumnya agar satu tanggal</span>';
  }
  var fr = d.freshness || null;
  if (fr && fr.state === 'excess') {
    var lagTxt = (fr.lag_capped ? '≥ ' : '') + fr.lag_sessions;
    h += '<span id="mr-curve-stale" data-state="excess" data-lag="' + fr.lag_sessions + '"'
      + ' data-ref="' + esc(fr.ref_date || '') + '"'
      + ' data-expected="' + (fr.expected_lag_sessions == null ? '' : fr.expected_lag_sessions) + '"'
      + ' style="background:rgba(239,68,68,.12);border:1px solid var(--rd);border-radius:4px;padding:1px 6px;font-weight:700;color:var(--rd)"'
      + ' title="tanggal kurva ' + esc(d.as_of || '') + ' vs sesi rujukan ' + esc(fr.ref_date || '')
      + '; ambang expected_lag_sessions=' + (fr.expected_lag_sessions == null ? '—' : fr.expected_lag_sessions)
      + ' sesi (deklarasi ' + esc(fr.threshold_code || '') + ' di custom_tickers)">'
      + '⚠ kurva tertinggal ' + lagTxt + ' sesi</span>';
  } else if (fr && fr.state === 'by_source' && fr.lag_sessions > 0) {
    h += '<span id="mr-curve-delayed" data-state="by_source" data-lag="' + fr.lag_sessions + '"'
      + ' style="color:var(--am)">sumber terlambat ' + fr.lag_sessions + ' sesi (wajar ≤ '
      + fr.expected_lag_sessions + ')</span>';
  } else if (!fr || fr.state === 'na') {
    // 'na' = TIDAK DIUKUR: jangan diam (dulu tak bisa dibedakan dari "segar"), jangan juga
    // dituduh basi. Netral, dengan sebab yang benar.
    var naCause = fr ? 'undeclared' : 'no_context';
    var naTxt = fr ? 'kesegaran kurva tidak diukur (tenor belum dideklarasikan)'
      : 'kesegaran kurva tidak diukur (konteks sesi tidak tersedia)';
    if (fr && fr.lag_basis === 'pipeline_stopped') { naCause = 'pipeline_stopped'; naTxt = 'kesegaran kurva tidak diukur (pipeline data berhenti)'; }
    else if (fr && fr.lag_basis === 'calendar_stale') { naCause = 'calendar_stale'; naTxt = 'kesegaran kurva tidak diukur (kalender sesi kedaluwarsa)'; }
    h += '<span id="mr-curve-untracked" data-state="na" data-cause="' + naCause + '" style="color:var(--t3)">' + naTxt + '</span>';
  }
  if (d.anchor_fallback) h += '<span style="color:var(--am)">cakupan tanggal terbaik &lt; ' + (d.min_coverage || 0) + ' tenor</span>';
  h += '</div>';

  // Slope (dihitung server; tanda wajib tampil: negatif = inversi)
  h += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">';
  (d.slopes || []).forEach(function (s) {
    if (s.bp === null || s.bp === undefined) {
      h += '<span style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:3px 8px;font-size:10px;color:var(--t3)" title="salah satu tenor tidak punya bar di tanggal kurva">' + esc(s.id) + ' —</span>';
      return;
    }
    var col = s.bp > 0 ? 'var(--gn)' : s.bp < 0 ? 'var(--rd)' : 'var(--t2)';
    h += '<span style="background:var(--bg1);border:1px solid ' + (s.inverted ? 'var(--rd)' : 'var(--b1)') + ';border-radius:4px;padding:3px 8px;font-size:10px;color:var(--t2)"'
      + ' title="' + esc(s.long_tenor + ' (' + s.long + ') − ' + s.short_tenor + ' (' + s.short + ') = ' + s.pp + ' pp pada ' + d.as_of) + '">'
      + esc(s.id) + ' <b style="font-family:var(--fm);color:' + col + '">' + mrFmtBp(s.bp) + ' bp' + (s.inverted ? ' · INVERSI' : '') + '</b></span>';
  });
  h += '</div>';

  h += '<div id="mr-curve-chart" style="height:' + mrChartCss('curve') + ';background:var(--bg1);border:1px solid var(--b1);border-radius:6px"></div>';

  // Riwayat level tenor kunci (sumbu waktu). Ditulis setelah tabel Δ supaya urutan bacanya:
  // bentuk kurva hari ini -> arah 12 bulan -> angka eksak per tenor.
  var histDates = (d.history && d.history.dates) || [];
  if (histDates.length) {
    h += '<div style="font-size:9px;color:var(--t3);margin:10px 0 4px">Riwayat tenor kunci '
      + '<b style="color:var(--t2)">3Y · 10Y · 30Y</b> · ' + histDates.length + ' titik · '
      + esc(histDates[0]) + ' → ' + esc(histDates[histDates.length - 1])
      + (d.history.step > 1 ? ' (sampling 1/' + d.history.step + ' sesi)' : '') + '</div>';
    h += '<div id="mr-curve-history" style="height:' + mrChartCss('hist') + ';background:var(--bg1);border:1px solid var(--b1);border-radius:6px"></div>';
  }

  h += '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:8px">';
  h += '<tr style="border-bottom:1px solid var(--b2)">';
  ['Tenor', 'Yield (%)', 'Δ1D (bp)', 'Δ1W (bp)', 'Δ1M (20 sesi, bp)', 'Bar'].forEach(function (t, i) {
    h += '<th style="text-align:' + (i === 0 || i === 5 ? 'left' : 'right') + ';padding:4px 8px;color:var(--t3);font-size:9px">' + t + '</th>';
  });
  h += '</tr>';
  d.tenors.forEach(function (t) {
    var on = t.on_curve !== false && t.close !== null && t.close !== undefined;
    var cellYield = on ? '<b style="font-family:var(--fm)">' + mrNum(t.close) + '</b>'
      : '<span style="color:var(--am)" title="tidak ada bar pada ' + esc(d.as_of || '') + '">— <span style="font-size:9px">' + esc(t.date || 'tanpa bar') + '</span></span>';
    var c1 = on && t.chg_1d_bp != null ? (t.chg_1d_bp > 0 ? 'color:var(--rd)' : t.chg_1d_bp < 0 ? 'color:var(--gn)' : '') : '';
    var c5 = on && t.chg_5d_bp != null ? (t.chg_5d_bp > 0 ? 'color:var(--rd)' : t.chg_5d_bp < 0 ? 'color:var(--gn)' : '') : '';
    var c20 = on && t.chg_20d_bp != null ? (t.chg_20d_bp > 0 ? 'color:var(--rd)' : t.chg_20d_bp < 0 ? 'color:var(--gn)' : '') : '';
    h += '<tr style="border-bottom:1px solid var(--b1)">';
    h += '<td style="padding:4px 8px;font-weight:600">' + esc(t.tenor) + '</td>';
    h += '<td style="padding:4px 8px;text-align:right">' + cellYield + '</td>';
    h += '<td style="padding:4px 8px;text-align:right;font-family:var(--fm);' + c1 + '">' + (on ? mrFmtBp(t.chg_1d_bp) : '—') + '</td>';
    h += '<td style="padding:4px 8px;text-align:right;font-family:var(--fm);' + c5 + '">' + (on ? mrFmtBp(t.chg_5d_bp) : '—') + '</td>';
    h += '<td style="padding:4px 8px;text-align:right;font-family:var(--fm);' + c20 + '">' + (on ? mrFmtBp(t.chg_20d_bp) : '—') + '</td>';
    h += '<td style="padding:4px 8px;font-size:9px;color:' + (on ? 'var(--t3)' : 'var(--am)') + '">' + esc(on ? t.date : (t.date || '—')) + '</td>';
    h += '</tr>';
  });
  h += '</table>';
  if (d.behind && d.behind.length) {
    h += '<div style="font-size:9px;color:var(--am);margin-top:4px">Tidak ikut tergambar (bar lebih baru dari tanggal kurva): '
      + d.behind.map(function (b) { return esc(b.tenor) + ' ' + esc(b.date); }).join(', ') + '</div>';
  }
  h += '<div style="font-size:9px;color:var(--t3);margin-top:4px">Yield = %, Δ dalam basis poin (1 bp = 0,01 pp). '
    + 'Δ1D/Δ1W/Δ1M dihitung dari bar seri tenor itu sendiri (1W = 5 sesi, 1M = 20 sesi bursa). '
    + 'Slope negatif = inversi. Tidak ada slope yang disimpan sebagai seri baru. '
    + 'Kesegaran kurva memakai aturan yang sama dengan seri lain (series-freshness.js).</div>';
  box.innerHTML = h;

  mrDrawCurve(d);
}

function mrDrawCurve(d) {
  var el = $('mr-curve-chart'); if (!el) return;
  var c = BL.init(el, 'mr-curve');
  if (!c) return;
  var labels = (d.tenors || []).map(function (t) { return t.tenor; });
  function level(t) { return (t.on_curve !== false && t.close !== null && t.close !== undefined) ? t.close : null; }
  // Tiga potret kurva di satu sumbu tenor. Sumbu-x di sini ORDINAL (1M..30Y), bukan waktu —
  // karena itu ECharts, bukan Lightweight Charts: memaksa sumbu waktu pada tenor akan mengarang
  // jarak antar-tenor yang tidak linier (30Y = 360 bulan vs 1Y = 12 bulan).
  var series = [
    { name: 'Hari ini (' + (d.as_of || '—') + ')', key: 'now', width: 2.4, dash: null, area: true },
    { name: '1 minggu lalu', key: 'w', width: 1.6, dash: 'dotted', area: false },
    { name: '1 bulan lalu', key: 'm', width: 1.6, dash: 'dashed', area: false }
  ];
  var data = {};
  series.forEach(function (s) {
    data[s.key] = (d.tenors || []).map(function (t) {
      var base = level(t);
      if (base === null) return null;
      if (s.key === 'now') return base;
      var bp = s.key === 'w' ? t.chg_5d_bp : t.chg_20d_bp;
      // chg_*_bp sudah dihitung server dari bar tenor itu sendiri; menurunkannya di UI dengan
      // asumsi lain (mis. bar terdekat) akan menghasilkan kurva pembanding yang tidak sinkron
      // dengan kolom Δ di tabel bawahnya.
      return (bp === null || bp === undefined) ? null : base - bp / 100;
    });
  });
  var known = [].concat(data.now, data.w, data.m).filter(function (v) { return v !== null; });
  if (!known.length) return;
  var pad = Math.max(0.05, (Math.max.apply(null, known) - Math.min.apply(null, known)) * 0.12);
  var colors = { now: '#5470c6', w: '#f0a020', m: '#9aa4b2' };
  c.setOption({
    tooltip: {
      trigger: 'axis', textStyle: { fontSize: 9 },
      formatter: function (ps) {
        var t = (d.tenors || [])[ps[0].dataIndex] || {};
        var s = '<b>' + esc(t.tenor || '') + '</b> · ' + esc(d.as_of || '') + '<br/>';
        if (ps[0].value === null || ps[0].value === undefined) return s + '— (tidak ada bar; terakhir ' + esc(t.date || '-') + ')';
        s += 'hari ini ' + mrNum(ps[0].value) + '% · Δ1D ' + mrFmtBp(t.chg_1d_bp) + ' bp · Δ1W '
          + mrFmtBp(t.chg_5d_bp) + ' bp · Δ1M ' + mrFmtBp(t.chg_20d_bp) + ' bp';
        return s;
      }
    },
    legend: {
      top: 0, right: 0, itemWidth: 10, itemHeight: 8, itemGap: 8,
      textStyle: { fontSize: 8, color: '#8a97a8' }
    },
    grid: BL.grid({ top: 24, bottom: 22, left: 46, right: 12 }),
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 8 } },
    yAxis: {
      type: 'value', scale: true,
      min: Math.min.apply(null, known) - pad,
      max: Math.max.apply(null, known) + pad,
      axisLabel: { fontSize: 8, formatter: function (v) { return Number(v).toFixed(2) + '%'; } },
      splitLine: { lineStyle: { color: '#1e2836', type: 'dashed' } }
    },
    series: series.map(function (s) {
      return {
        name: s.name, type: 'line', data: data[s.key], connectNulls: false,
        symbol: s.key === 'now' ? 'circle' : 'none', symbolSize: 5, smooth: false,
        lineStyle: { width: s.width, color: colors[s.key], type: s.dash || 'solid' },
        itemStyle: { color: colors[s.key] },
        areaStyle: s.area ? { color: 'rgba(84,112,198,0.10)' } : null
      };
    })
  }, true);

  // Riwayat level tiga tenor kunci — sumbu WAKTU, karena itu Lightweight Charts. Pembanding
  // kurva di atas menjawab \"bentuk hari ini vs sebulan lalu\"; chart ini menjawab \"arah\".
  mrDrawCurveHistory(d);
}

function mrDrawCurveHistory(d) {
  var el = $('mr-curve-history'); if (!el) return;
  var hist = d.history || null;
  if (!hist || !hist.dates || !hist.dates.length) {
    el.innerHTML = '<div style="color:var(--t3);font-size:10px;padding:8px">Riwayat kurva tidak tersedia.</div>';
    return;
  }
  var pick = ['3Y', '10Y', '30Y'];
  var palette = { '3Y': 'var(--gn)', '10Y': 'var(--bl)', '30Y': 'var(--am)' };
  var series = [];
  pick.forEach(function (label) {
    var t = (hist.tenors || []).filter(function (x) { return x.tenor === label; })[0];
    if (!t) return;
    var pts = mrLwcPoints(hist.dates, t.values);
    if (pts.length < 2) return;
    series.push({ type: 'line', data: pts, color: mrCssColor(palette[label]), width: 2, title: label });
  });
  if (!series.length) {
    el.innerHTML = '<div style="color:var(--t3);font-size:10px;padding:8px">Riwayat tenor kunci tidak tersedia.</div>';
    return;
  }
  var ch = mrLwcCreateSection(el, { height: mrChartH('hist'), precision: 2, minMove: 0.001, series: series });
  if (!ch) {
    el.innerHTML = '<div style="color:var(--t3);font-size:10px;padding:8px">Lightweight Charts tidak termuat.</div>';
  }
}

// CSS variable -> nilai warna nyata; LWC tidak membaca var() di canvas.
function mrCssColor(v) {
  if (!v || v.indexOf('var(') !== 0) return v || '#8a97a8';
  var name = v.slice(4, -1).trim();
  return (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim() || '#8a97a8';
}

// ═══ 4. Internals IDX ═══
function mrRenderInternals(it, mrData) {
  if (!it || !it.as_of) return '<div style="color:var(--t3);font-size:11px">Internals IDX tidak tersedia.</div>';
  var h = '<div style="font-size:9px;color:var(--t3);margin-bottom:6px">sesi <b style="color:var(--t2)">' + esc(it.as_of)
    + '</b> · jendela ' + (it.sessions || 0) + ' sesi (dari ' + esc(it.window_from || '—') + ') · harga di-MA memakai harga terkoreksi aksi korporasi</div>';

  // IHSG + foreign flow + tape + breadth: tabel dua kolom supaya sejajar
  var ihsg = it.ihsg || {}, br = it.breadth || {}, ff = it.foreign_flow || {}, tp = it.tape || {};

  // ── strip visual: breadth sebagai meter, bukan tiga angka dalam satu sel ──
  // Ambang 50% bukan "netral secara ekonomi" — itu hanya titik tengah skala 0–100 pada sumbu
  // yang sama; warna di bawah 50% berarti mayoritas emiten di bawah MA-nya, bukan sinyal jual.
  h += '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px">';
  [['MA20', br.pct_above_ma20], ['MA50', br.pct_above_ma50], ['MA200', br.pct_above_ma200]].forEach(function (pair) {
    var k = pair[0], v = pair[1];
    var has = (v !== null && v !== undefined && !isNaN(v));
    var pct = has ? Math.max(0, Math.min(100, Number(v))) : 0;
    var col = !has ? 'var(--t3)' : pct >= 60 ? 'var(--gn)' : pct >= 40 ? 'var(--am)' : 'var(--rd)';
    h += '<div style="flex:1 1 120px;min-width:110px">'
      + '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--t3);margin-bottom:2px">'
      + '<span>' + k + '</span><b style="color:' + col + ';font-family:var(--fm)">' + (has ? mrNum(v) + '%' : '—') + '</b></div>'
      + '<div style="height:5px;background:var(--b1);border-radius:3px;overflow:hidden">'
      + '<div style="width:' + pct + '%;height:100%;background:' + col + '"></div></div></div>';
  });
  h += '</div>';

  // ── chart IHSG 40 sesi + foreign net per sesi ──
  var ih = it.ihsg_history || null;
  if (ih && ih.dates && ih.dates.length > 1) {
    h += '<div style="font-size:9px;color:var(--t3);margin:2px 0 3px">IHSG · ' + ih.dates.length + ' sesi ('
      + esc(ih.dates[0]) + ' → ' + esc(ih.dates[ih.dates.length - 1]) + ')</div>';
    h += '<div id="mr-ihsg-chart" style="height:' + mrChartCss('ihsg') + ';background:var(--bg1);border:1px solid var(--b1);border-radius:6px"></div>';
  }
  var flowSeries = (ff.series || []).filter(function (x) { return x && x.date; });
  if (flowSeries.length > 1) {
    h += '<div style="font-size:9px;color:var(--t3);margin:8px 0 3px">Foreign net per sesi (Rp tn) · '
      + (ff.sessions || flowSeries.length) + ' sesi · hijau = net beli, merah = net jual</div>';
    h += '<div id="mr-flow-chart" style="height:' + mrChartCss('flow') + ';background:var(--bg1);border:1px solid var(--b1);border-radius:6px"></div>';
  }

  h += '<table style="width:100%;border-collapse:collapse;font-size:10px;font-family:var(--fm);margin-top:8px">';
  h += '<thead><tr>';
    + '<th style="text-align:left;padding:3px 6px;font-weight:600">Blok</th>'
    + '<th style="text-align:right;padding:3px 6px;font-weight:600">Nilai</th>'
    + '<th style="text-align:left;padding:3px 6px;font-weight:600">Rincian</th></tr></thead><tbody>';

  var regimeTxt = ihsg.regime === 'bull' ? 'bull' : ihsg.regime === 'mild_bull' ? 'mild bull'
    : ihsg.regime === 'bear' ? 'bear' : ihsg.regime === 'mild_bear' ? 'mild bear' : 'sideways';
  h += '<tr style="border-bottom:1px solid var(--b1)"><td style="padding:3px 6px">IHSG</td>'
    + '<td style="padding:3px 6px;text-align:right"><b>' + mrNum(ihsg.level) + '</b> '
    + '<span style="color:' + (ihsg.regime === 'bull' || ihsg.regime === 'mild_bull' ? 'var(--gn)' : ihsg.regime === 'bear' || ihsg.regime === 'mild_bear' ? 'var(--rd)' : 'var(--t2)') + '">' + regimeTxt + '</span></td>'
    + '<td style="padding:3px 6px;color:var(--t3)">1D <span style="color:' + mrColor(ihsg.chg_1d) + '">' + mrSigned(ihsg.chg_1d, '%') + '</span>'
    + ' · 5D <span style="color:' + mrColor(ihsg.chg_5d) + '">' + mrSigned(ihsg.chg_5d, '%') + '</span>'
    + ' · 20D <span style="color:' + mrColor(ihsg.chg_20d) + '">' + mrSigned(ihsg.chg_20d, '%') + '</span>'
    + ' · ' + esc(ihsg.date || '') + '</td></tr>';

  h += '<tr style="border-bottom:1px solid var(--b1)"><td style="padding:3px 6px">Foreign net</td>'
    + '<td style="padding:3px 6px;text-align:right;color:' + mrColor(ff.net_today) + '">' + mrRpTn(ff.net_today) + '</td>'
    + '<td style="padding:3px 6px;color:var(--t3)">5D <span style="color:' + mrColor(ff.net_5d) + '">' + mrRpTn(ff.net_5d) + '</span>'
    + ' · 20D <span style="color:' + mrColor(ff.net_20d) + '">' + mrRpTn(ff.net_20d) + '</span>'
    + ' · dari idx_daily per saham (' + (ff.sessions || 0) + ' sesi)</td></tr>';

  h += '<tr style="border-bottom:1px solid var(--b1)"><td style="padding:3px 6px">Nilai transaksi</td>'
    + '<td style="padding:3px 6px;text-align:right">' + mrNum(tp.value_ratio) + 'x MA20</td>'
    + '<td style="padding:3px 6px;color:var(--t3)">' + mrRpTn(tp.value_today) + ' vs MA20 ' + mrRpTn(tp.value_ma20)
    + ' · naik ' + (tp.advancers || 0) + ' / turun ' + (tp.decliners || 0)
    + ' · ARA ' + (tp.ara || 0) + ' ARB ' + (tp.arb || 0) + ' · ' + (tp.members || 0) + ' emiten</td></tr>';

  h += '<tr style="border-bottom:1px solid var(--b1)"><td style="padding:3px 6px">Breadth</td>'
    + '<td style="padding:3px 6px;text-align:right">' + mrNum(br.pct_above_ma50) + '% &gt; MA50</td>'
    + '<td style="padding:3px 6px;color:var(--t3)">&gt;MA20 ' + mrNum(br.pct_above_ma20) + '%'
    + ' · &gt;MA200 ' + mrNum(br.pct_above_ma200) + '%'
    + ' · new high ' + (br.new_high || 0) + ' / new low ' + (br.new_low || 0)
    + ' · ' + (br.total || 0) + ' emiten</td></tr>';
  h += '</table>';

  // Sektor
  var sec = it.sectors;
  if (sec && (sec.top || sec.bottom)) {
    h += '<div style="font-size:10px;font-weight:700;margin:16px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--b1)">Rotasi sektor '
      + '<span style="font-weight:400;color:var(--t3)">· sama bobot (equal weight) · ' + (sec.count || 0) + ' sektor · ' + esc(sec.as_of || '') + '</span></div>';
    // Bar 20D per sektor: satu sumbu nol, urut dari terkuat. Angka 1D/20D tetap di tabel bawah —
    // bar ini hanya memindahkan \"siapa menguat\" dari kolom angka ke panjang batang.
    var secAll = (sec.top || []).concat(sec.bottom || []).filter(function (x) { return x && x.chg_20d !== null && x.chg_20d !== undefined; });
    if (secAll.length > 2) {
      var maxAbs = Math.max.apply(null, secAll.map(function (x) { return Math.abs(x.chg_20d); })) || 1;
      secAll.sort(function (a, b) { return b.chg_20d - a.chg_20d; });
      h += '<div style="margin-bottom:8px">';
      secAll.forEach(function (x) {
        var w = Math.max(1, Math.round(Math.abs(x.chg_20d) / maxAbs * 50));
        var pos = x.chg_20d >= 0;
        h += '<div style="display:flex;align-items:center;gap:6px;font-size:9px;line-height:15px">'
          + '<span style="width:118px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t3)">' + esc(x.sector) + '</span>'
          + '<span style="flex:1;display:flex;height:6px;background:transparent">'
          + (pos ? '<span style="width:50%"></span>' : '<span style="width:' + (50 - w) + '%;margin-left:auto"></span>')
          + '<span style="width:' + w + '%;background:' + mrColor(x.chg_20d) + ';border-radius:2px"></span>'
          + (pos ? '<span style="width:' + (50 - w) + '%"></span>' : '<span style="width:50%"></span>')
          + '</span>'
          + '<span style="width:46px;text-align:right;font-family:var(--fm);color:' + mrColor(x.chg_20d) + '">' + mrSigned(x.chg_20d, '%') + '</span></div>';
      });
      h += '<div style="font-size:8px;color:var(--t3);margin-top:2px">20 sesi · garis tengah = 0% · skala maks ±' + mrNum(maxAbs) + '%</div>';
      h += '</div>';
    }
    h += '<table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:10px;font-family:var(--fm)">'
      + '<colgroup><col style="width:24%"><col style="width:12%"><col style="width:12%">'
      + '<col style="width:16%"><col style="width:10%"><col style="width:26%"></colgroup>';
    h += '</thead><tbody>';
      + '<th style="text-align:left;padding:3px 6px;font-weight:600">Sektor</th>'
      + '<th style="text-align:right;padding:3px 6px;font-weight:600">1D</th>'
      + '<th style="text-align:right;padding:3px 6px;font-weight:600">20D</th>'
      + '<th style="text-align:right;padding:3px 6px;font-weight:600">RS vs IHSG (1D)</th>'
      + '<th style="text-align:right;padding:3px 6px;font-weight:600">Emiten</th>'
      + '<th style="text-align:left;padding:3px 6px;font-weight:600">Terbesar</th></tr>';
    var rows = (sec.top || []).map(function (x) { return ['▲', x]; })
      .concat((sec.bottom || []).map(function (x) { return ['▼', x]; }));
    rows.forEach(function (pair) {
      var x = pair[1];
      var click = x.cp_sector ? ' onclick="mrGoSector(\'' + esc(x.cp_sector) + '\')" style="cursor:pointer;color:var(--bl)"' : '';
      h += '<tr style="border-bottom:1px solid var(--b1)">'
        + '<td style="padding:3px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"' + click + ' title="' + esc(x.sector || '') + '">' + pair[0] + ' ' + esc(x.sector) + '</td>'
        + '<td style="padding:3px 6px;text-align:right;color:' + mrColor(x.chg_1d) + '">' + mrSigned(x.chg_1d, '%') + '</td>'
        + '<td style="padding:3px 6px;text-align:right;color:' + mrColor(x.chg_20d) + '">' + mrSigned(x.chg_20d, '%') + '</td>'
        + '<td style="padding:3px 6px;text-align:right;color:' + mrColor(x.rs_vs_ihsg_1d) + '">' + mrSigned(x.rs_vs_ihsg_1d, '%') + '</td>'
        + '<td style="padding:3px 6px;text-align:right;color:var(--t3)">' + (x.members || 0) + '</td>'
        + '<td style="padding:3px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (x.top_stocks || []).map(function (t) {
          return '<span class="code" onclick="sdOpenTicker(\'' + esc(t) + '\')" style="cursor:pointer;font-size:10px;font-weight:600;margin-right:4px">' + esc(t) + '</span>';
        }).join('<span style="color:var(--t3)"> · </span>') + '</td></tr>';
    });
    h += '</table>';
  }

  // Konsentrasi kepemilikan ≥1% tidak ditampilkan (permintaan owner 20 Okt 2026).
  // Data tetap ada di payload /api/idx/cross-asset (field `internals.ownership`; ringkasannya
  // juga di `coverage.extras.ownership`). Endpoint lama /api/idx/internals-extra sudah 404
  // sejak commit dcbd997 — komentar yang menyebutnya menyesatkan (temuan sena r5).
  //
  // `mrRenderCoverage` / `mrCovBucket` / `mrCovItems` di bawah juga tidak dipanggil: seksi
  // L5 Coverage dipangkas owner. Ketiganya SENGAJA dipertahankan di kartu t_651e530e karena
  // kartu ini hanya menugaskan penghapusan mrRenderRegimeBar/mrRenderChanged; menghapus blok
  // ini adalah keputusan terpisah (payload `coverage` masih satu-satunya cara membaca status
  // 78 seri lewat API, dan fungsi ini adalah referensi bentuknya).
  return h;
}

// Chart L4: IHSG (level, sumbu kanan) dan foreign net per sesi (bar, sumbu kiri dikali -1? tidak:
// keduanya beda besaran sama sekali, jadi foreign flow punya chart sendiri).
// Kenapa dipisah: menumpuk Rp tn di atas level IHSG 5.400 memaksa dua skala pada satu sumbu visual;
// pembaca akan menyimpulkan korelasi dari kemiringan garis yang tidak sebanding.
function mrRenderInternalsCharts(it) {
  if (!it) return;
  var ih = it.ihsg_history || null;
  var el = $('mr-ihsg-chart');
  if (el && ih && ih.dates && ih.dates.length > 1) {
    var pts = mrLwcPoints(ih.dates, ih.close);
    if (pts.length > 1) {
      var ch = mrLwcCreateSection(el, {
        height: mrChartH('ihsg'),
        precision: 2, minMove: 0.01,
        series: [{ type: 'line', data: pts, color: mrCssColor('var(--bl)'), width: 2 }]
      });
      if (!ch) el.innerHTML = '<div style="color:var(--t3);font-size:10px;padding:8px">Lightweight Charts tidak termuat.</div>';
    } else {
      el.innerHTML = '<div style="color:var(--t3);font-size:10px;padding:8px">Riwayat IHSG tidak cukup untuk digambar.</div>';
    }
  }

  var ff = (it.foreign_flow && it.foreign_flow.series) || [];
  var fel = $('mr-flow-chart');
  if (fel && ff.length > 1) {
    // Bar per sesi: nilai net dalam Rp tn (skala -1..+1 khas pasar ini), warna per tanda.
    var green = mrCssColor('var(--gn)'), red = mrCssColor('var(--rd)');
    var bars = ff.map(function (x) {
      return {
        time: String(x.date).slice(0, 10),
        value: Math.round(x.net / 1e9) / 1000,   // rupiah -> Rp tn, 3 desimal
        color: x.net >= 0 ? green : red
      };
    }).filter(function (b) { return /^\d{4}-\d{2}-\d{2}$/.test(b.time); });
    var ch2 = mrLwcCreateSection(fel, {
      height: mrChartH('flow'),
      series: [{ type: 'bars', data: bars, color: green }],
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
    });
    if (!ch2) fel.innerHTML = '<div style="color:var(--t3);font-size:10px;padding:8px">Lightweight Charts tidak termuat.</div>';
  }
}
// ═══ 5. Coverage strip ═══
// Menggantikan tombol refresh yang sudah dihapus: sebutkan apa yang tidak kita punya, bernama.
// Semua daftar di bawah berasal dari payload.coverage — sumber yang SAMA dengan penanda ⏸/◔ di
// baris monitor, jadi strip dan badge tidak bisa berbeda cerita.
function mrCovItems(arr, fmt) {
  return (arr || []).map(fmt).join(' · ');
}
function mrCovBucket(label, arr, fmt, tone) {
  var n = (arr || []).length;
  var h = '<div style="margin-top:4px;font-size:9px;color:' + (n ? tone : 'var(--t3)') + '">'
    + '<b>' + label + ' (' + n + ')</b>: ';
  if (!n) { h += '—</div>'; return h; }
  var list = mrCovItems(arr, fmt);
  if (n > 6) {
    // Daftar panjang jangan mengubur strip: detail dilipat, jumlahnya tetap di depan.
    h += '<details><summary style="cursor:pointer">' + esc((arr[0].name || arr[0].code)) + ', '
      + esc((arr[1].name || arr[1].code)) + ', … (klik untuk ' + n + ' nama)</summary>' + esc(list) + '</details></div>';
    return h;
  }
  h += esc(list) + '</div>';
  return h;
}

function mrRenderCoverage(cov) {
  if (!cov) return '<div style="color:var(--t3);font-size:11px">Blok coverage tidak tersedia.</div>';
  var c = cov.counts || {};
  // Enam bucket status EKSKLUSIF (server: series[].status). `status_sum` dikirim server supaya
  // ketidakcocokan terlihat sebagai angka, bukan diratakan diam-diam — review r2 menemukan strip
  // 79 untuk 78 seri karena `aged` dulu ditambahkan di luar rantai if/else.
  var bucketSum = (c.fresh || 0) + (c.stale || 0) + (c.delayed || 0) + (c.aged || 0)
    + (c.unmeasured || 0) + (c.no_series || 0);
  var sumOk = (c.status_sum_ok !== undefined) ? c.status_sum_ok : (bucketSum === (c.series || 0));
  var h = '<div style="font-size:9px;color:var(--t3);margin-bottom:4px">'
    + 'Rujukan sesi <b style="color:var(--t2)">' + esc(cov.ref_date || '—') + '</b> (' + esc(cov.ref_source || '—') + ') · '
    + (c.series || 0) + ' seri aktif: ' + (c.fresh || 0) + ' segar · ' + (c.stale || 0) + ' basi · '
    + (c.delayed || 0) + ' terlambat (wajar) · ' + (c.aged || 0) + ' umur lewat kadens · '
    + (c.unmeasured || 0) + ' tanpa status umur · ' + (c.no_series || 0) + ' tanpa bar'
    + ' <span style="color:' + (sumOk ? 'var(--t3)' : 'var(--rd)') + '"'
    + ' title="enam bucket status saling eksklusif; jumlahnya harus sama dengan jumlah seri">'
    + '(bucket ' + bucketSum + '/' + (c.series || 0) + (sumOk ? '' : ' — TIDAK COCOK') + ')</span></div>';
  // Atribut silang: sengaja boleh tumpang tindih dengan status di atas, jadi ditulis terpisah
  // dan TIDAK dijumlahkan ke total seri.
  var attrs = [];
  if (c.thin != null) attrs.push((c.thin || 0) + ' histori tipis (&lt;21 bar)');
  if (c.unit_unknown != null) attrs.push((c.unit_unknown || 0) + ' satuan level belum ada');
  if (c.unit_missing != null) attrs.push((c.unit_missing || 0) + ' jenis nilai belum ada');
  if (c.undeclared_lag != null) attrs.push((c.undeclared_lag || 0) + ' lag belum dideklarasikan');
  if (attrs.length) {
    h += '<div style="font-size:9px;color:var(--t3)">Atribut silang (tidak dijumlahkan ke seri): '
      + attrs.join(' · ') + '</div>';
  }
  if (cov.age_thresholds) {
    var at = cov.age_thresholds;
    h += '<div style="font-size:9px;color:var(--t3)">Ambang umur lewat kadens (lag belum dideklarasikan): '
      + 'D' + at.D + ' · W' + at.W + ' · M' + at.M + ' · Q' + at.Q + ' hari'
      + ' — seri ber-expected_lag memakai deklarasi per sumber, bukan ambang ini.</div>';
  }

  var withAge = function (x) { return (x.name || x.code) + ' (' + (x.as_of || '—') + ', ' + (x.age_days == null ? '?' : x.age_days) + ' hr)'; };
  h += mrCovBucket('Basi — sumber tidak menerbitkan bar', cov.stale, withAge, 'var(--rd)');
  h += mrCovBucket('Terlambat — masih dalam kebiasaan sumber', cov.delayed, withAge, 'var(--am)');
  h += mrCovBucket('Umur lewat kadens (lag belum dideklarasikan)', cov.aged, withAge, 'var(--am)');
  h += mrCovBucket('Tanpa bar sama sekali', cov.no_series, function (x) { return (x.name || x.code); }, 'var(--rd)');
  h += mrCovBucket('Histori tipis (&lt; 21 bar)', cov.thin, function (x) { return (x.name || x.code) + ' (' + (x.n_bars || 0) + ' bar)'; }, 'var(--t2)');
  h += mrCovBucket('Umur tidak terukur (bukan tuduhan basi)', cov.unmeasured, withAge, 'var(--t2)');
  if ((cov.unit_unknown || []).length) {
    h += mrCovBucket('Satuan level belum dideklarasikan', cov.unit_unknown, function (x) { return (x.name || x.code); }, 'var(--t2)');
  }
  if ((cov.unit_identity_missing || cov.unit_missing || []).length) {
    h += mrCovBucket('Jenis nilai (value_kind) belum dideklarasikan', cov.unit_missing, function (x) { return (x.name || x.code); }, 'var(--am)');
  }

  // Blok lain yang punya lubang sendiri (kurva, kepemilikan) — disebut di sini, bukan disembunyikan.
  var ex = cov.extras || {};
  if (ex.curve) {
    h += '<div style="margin-top:6px;font-size:9px;color:var(--t3)"><b>Kurva SUN</b>: '
      + (ex.curve.as_of ? 'tanggal ' + esc(ex.curve.as_of) : 'tidak ada kurva') + ' · '
      + (ex.curve.coverage ? ex.curve.coverage.present + '/' + ex.curve.coverage.total + ' tenor' : '—')
      + ' · kesegaran ' + esc(ex.curve.state || '—')
      + (ex.curve.lag_sessions == null ? '' : ' (' + ex.curve.lag_sessions + ' sesi)') + '</div>';
  }
  if (ex.ownership) {
    h += '<div style="margin-top:2px;font-size:9px;color:' + ((ex.ownership.age_days || 0) > 90 ? 'var(--am)' : 'var(--t3)') + '">'
      + '<b>Kepemilikan &ge;1%</b>: periode ' + esc(ex.ownership.period_date || '—')
      + ' · ' + (ex.ownership.age_days == null ? '—' : ex.ownership.age_days) + ' hari'
      + ((ex.ownership.age_days || 0) > 90 ? ' (BEI belum menerbitkan periode berikutnya)' : '') + '</div>';
  }
  h += '<div style="margin-top:6px;font-size:9px;color:var(--t3)">Tidak ada tombol refresh: data diperbarui oleh pipeline. '
    + 'Halaman ini hanya membaca DB saat dimuat, jadi kalau pipeline berhenti, yang berubah adalah tanggal rujukan di atas — bukan angkanya.</div>';
  return h;
}

// ═══ Navigasi: sektor → Screener terfilter, ticker → Stock Detail ═══
function mrGoSector(cpSector) {
  if (typeof stab === 'function') stab('analysis');
  setTimeout(function () {
    var btn = document.querySelector('.wt-b[onclick*="screener"]');
    if (btn && typeof anaSubTab === 'function') anaSubTab('screener', btn);
    setTimeout(function () {
      var formula = 'Sector == "' + cpSector + '" AND C > 0';
      var inp = document.getElementById('afl-input');
      if (inp) {
        inp.value = formula;
        if (typeof aflOnInput === 'function') aflOnInput();
        if (typeof aflRun === 'function') aflRun();
      }
    }, 300);
  }, 100);
}

// ═══ MARKET NEWS PANEL — dipertahankan (feed headline, bukan kartu data) ═══
var _mrNewsCache = null;
var _mrNewsCacheTime = 0;

async function mrRenderNews(containerId) {
  var el = document.getElementById(containerId); if (!el) return;

  var now = Date.now();
  if (_mrNewsCache && (now - _mrNewsCacheTime) < 300000) {
    mrRenderNewsData(el, _mrNewsCache);
    return;
  }

  try {
    var r = await fetch('/api/idx/market-news');
    var data = await r.json();
    if (data.error) { el.innerHTML = '<div style="color:var(--rd);font-size:11px">❌ ' + esc(data.error) + '</div>'; return; }
    _mrNewsCache = data;
    _mrNewsCacheTime = now;
    mrRenderNewsData(el, data);
  } catch (e) {
    el.innerHTML = '<div style="color:var(--rd);font-size:11px">❌ Network error</div>';
  }
}

function mrRefreshNewsFn() {
  _mrNewsCache = null;
  _mrNewsCacheTime = 0;
  mrRenderNews('mr-news');
}

function mrRenderNewsData(el, data) {
  var cats = data.categories || [];
  if (!cats.length) { el.innerHTML = '<div style="color:var(--t3);font-size:11px">No news available</div>'; return; }

  var h = '';

  // Header row: tabs
  h += '<div style="display:flex;align-items:center;border-bottom:1px solid var(--b1);overflow-x:auto;flex-shrink:0">';
  cats.forEach(function (cat, i) {
    var n = cat.items ? cat.items.length : 0;
    h += '<button class="mr-news-tab' + (i === 0 ? ' on' : '') + '" onclick="mrNewsTab(' + i + ')" data-idx="' + i + '">';
    h += cat.icon + ' ' + esc(cat.label);
    if (n) h += ' <span style="font-size:8px;opacity:.6">(' + n + ')</span>';
    h += '</button>';
  });
  h += '<div style="flex:1"></div>';
  if (data.fetched_at) {
    var ft = new Date(data.fetched_at);
    h += '<span style="font-size:9px;color:var(--t3);padding:0 8px">' + ft.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + '</span>';
  }
  h += '<button class="bei-sort-btn" onclick="mrRefreshNewsFn()" style="font-size:9px;padding:2px 8px;margin-right:4px">↻</button>';
  h += '</div>';

  // Panels
  cats.forEach(function (cat, ci) {
    h += '<div class="mr-news-panel" id="mr-news-p' + ci + '" style="display:' + (ci === 0 ? 'block' : 'none') + '">';
    if (!cat.items || !cat.items.length) {
      h += '<div style="padding:12px;text-align:center;color:var(--t3);font-size:11px">No headlines</div>';
    } else {
      h += '<div style="max-height:280px;overflow-y:auto">';
      cat.items.forEach(function (item) {
        var ageColor = item.age && item.age.indexOf('m ago') >= 0 ? 'var(--gn)' :
          item.age && item.age.indexOf('h ago') >= 0 ? 'var(--bl)' : 'var(--t3)';
        h += '<a href="' + esc(item.url) + '" target="_blank" rel="noopener" class="mr-news-item">';
        h += '<div class="mr-news-headline">' + esc(item.headline) + '</div>';
        h += '<div class="mr-news-meta">';
        if (item.source) h += '<span>' + esc(item.source) + '</span>';
        if (item.age) h += '<span style="color:' + ageColor + '">' + esc(item.age) + '</span>';
        h += '</div></a>';
      });
      h += '</div>';
    }
    h += '</div>';
  });

  el.innerHTML = h;
}

function mrNewsTab(idx) {
  document.querySelectorAll('.mr-news-tab').forEach(function (t) {
    t.classList.toggle('on', parseInt(t.getAttribute('data-idx')) === idx);
  });
  document.querySelectorAll('.mr-news-panel').forEach(function (p, i) {
    p.style.display = i === idx ? 'block' : 'none';
  });
}
