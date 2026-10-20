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
//   2. Monitor lintas aset — satu baris per seri `custom_tickers`; data baru = baris baru
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

  // ── 1. Regime bar ──
  h += mrSection('1', '🎛 Regime', mrRenderRegimeBar(d.regime));

  // ── strip narasi harian ──
  h += mrSection('·', '📌 Berubah hari ini', mrRenderChanged(d.changed_today));

  // ── 2. Monitor lintas aset ──
  h += mrSection('2', '📋 Monitor lintas aset', mrRenderMonitor(d.monitor));

  // ── 3. Kurva & likuiditas ──
  h += mrSection('3', '📐 Kurva &amp; likuiditas',
    '<div id="mr-liq-box">' + mrRenderLiquidity(d.liquidity) + '</div>'
    + '<div style="border-top:1px solid var(--b1);margin:10px 0 8px"></div>'
    + '<div id="mr-curve-box"></div>');

  // ── 4. Internals IDX ──
  h += mrSection('4', '🇮🇩 Internals IDX', mrRenderInternals(d.internals));

  // ── 5. Coverage ──
  h += mrSection('5', '🧭 Coverage — apa yang tidak kita punya', mrRenderCoverage(d.coverage));

  // ── 6. Hot News (dipertahankan) ──
  h += mrSection('6', '📰 Hot News', '<div id="mr-news"><div style="color:var(--t3);font-size:11px">⏳ Loading headlines...</div></div>');

  h += '</div>';
  el.innerHTML = h;

  // Kurva: data sudah ada di payload, tidak ada fetch kedua.
  setTimeout(function () { mrRenderCurveTo($('mr-curve-box'), d.curve); }, 0);
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

// ═══ 1. Regime bar: 4 skor dari payload.regime ═══
// Tidak ada skor komposit di sini. Komposit = rata-rata berbobot 4 skor heterogen; bobotnya
// TIDAK diputuskan di kartu mana pun, jadi menampilkannya berarti mengarang asumsi diam-diam
// (versi sebelumnya menampilkannya dan angkanya bentrok dengan endpoint kembar: 24 vs 62,91).
// Yang ditampilkan: 4 skor + label band dari server + tanggal acuan + status kesegaran.
function mrScoreColor(v) {
  if (v === null || v === undefined) return 'var(--t3)';
  return v >= 67 ? 'var(--gn)' : v >= 45 ? 'var(--am)' : v >= 33 ? 'var(--or, #f97316)' : 'var(--rd)';
}

var MR_STATUS_TEXT = {
  fresh:       { t: 'segar',           c: 'var(--gn)' },
  stale:       { t: 'basi',            c: 'var(--rd)' },
  aged:        { t: 'umur lewat kadens', c: 'var(--am)' },
  unmeasured:  { t: 'umur tak terukur', c: 'var(--t3)' },
  unavailable: { t: 'tidak terukur',   c: 'var(--t3)' }
};

function mrRenderRegimeBar(regime) {
  if (!regime || !regime.length) return '<div style="color:var(--t3);font-size:11px">Skor regime belum tersedia.</div>';
  var h = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:stretch">';
  regime.forEach(function (s) {
    var st = MR_STATUS_TEXT[s.status] || MR_STATUS_TEXT.unavailable;
    var comps = (s.components || []).map(function (c) {
      return esc(c.label) + ' ' + mrNum(c.value) + (c.unit === '%' ? '%' : '');
    }).join(' · ');
    var miss = (s.missing || []).map(function (m) { return esc(m.label); }).join(', ');
    h += '<div class="mr-score" data-id="' + esc(s.id) + '" style="background:var(--bg1);border:1px solid var(--b1);border-radius:6px;padding:8px 12px;min-width:210px;flex:1"'
      + ' title="' + esc(s.method || '') + '">';
    h += '<div style="font-size:9px;color:var(--t3)">' + esc(s.label) + '</div>';
    h += '<div style="font-size:20px;font-weight:700;font-family:var(--fm);color:' + mrScoreColor(s.score) + '">'
      + (s.score === null ? '—' : mrNum(s.score))
      + ' <span style="font-size:9px;font-weight:400;color:var(--t2)">' + esc(s.band_label || '') + '</span></div>';
    var meta = ['acuan <b style="color:var(--t2)">' + esc(s.as_of || '—') + '</b>'];
    if (s.age_days !== null && s.age_days !== undefined) meta.push(s.age_days + ' hr');
    if (st.t !== 'umur tak terukur') meta.push('<span style="color:' + st.c + '">' + st.t + '</span>');
    h += '<div style="font-size:9px;color:var(--t3)">' + meta.join(' · ') + '</div>';
    if (s.score === null) {
      h += '<div style="font-size:9px;color:var(--am)">' + esc(s.reason || 'skor tidak dihitung') + '</div>';
    } else {
      h += '<div style="font-size:9px;color:var(--t3);margin-top:2px">' + comps + '</div>';
      if (miss) h += '<div style="font-size:9px;color:var(--am)">tanpa komponen: ' + miss + '</div>';
    }
    h += '</div>';
  });
  h += '</div>';
  h += '<div style="font-size:9px;color:var(--t3);margin-top:5px">0-100 · &ge;67 mendukung · &lt;33 menekan · bukan sinyal</div>';
  return h;
}

// ═══ strip "berubah hari ini" — 3-5 baris ═══
// Satuan menempel pada FIELD yang benar, bukan pada baris: `value` = level/harga (bukan persen),
// `delta` = pergerakan dalam %. Versi pertama memberi '%' pada level IHSG ("4,996.61%") dan
// mengalikan ulang nilai yang sudah dalam Rp triliun ("-0.00 T").
function mrRenderChanged(list) {
  if (!list || !list.length) return '<div style="color:var(--t3);font-size:11px">Tidak ada pergerakan segar untuk sesi ini.</div>';
  var fmtValue = function (x) {
    if (x.unit === 'Rp tn') return mrSigned(x.value, ' T');      // nilai SUDAH dalam triliun
    if (x.unit === 'x') return mrNum(x.value) + 'x';
    if (x.unit === 'pct') return x.kind === 'breadth' ? mrNum(x.value) + '%' : mrNum(x.value);
    return mrNum(x.value);
  };
  var h = '<div style="display:flex;gap:6px;flex-wrap:wrap">';
  list.slice(0, 6).forEach(function (x) {
    var c = x.tone === 'up' ? 'var(--gn)' : x.tone === 'down' ? 'var(--rd)' : 'var(--t2)';
    var val = fmtValue(x);
    var dlt = (x.delta === null || x.delta === undefined) ? ''
      : ' <span style="color:' + mrColor(x.delta) + '">' + mrSigned(x.delta, '%') + '</span>';
    h += '<span style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:3px 8px;font-size:10px">'
      + '<span style="color:var(--t3)">' + esc(x.label) + '</span> '
      + '<b style="font-family:var(--fm);color:' + c + '">' + esc(val) + '</b>' + dlt
      + ' <span style="font-size:9px;color:var(--t3)">' + esc(x.as_of || '') + '</span></span>';
  });
  h += '</div>';
  return h;
}

// ═══ 2. Monitor lintas aset ═══
// Kelompok = payload.monitor.groups (array dari server, urutannya ditentukan server). TIDAK ADA
// daftar kategori yang di-hardcode di sini: kategori baru (mis. `credit`) langsung dirender —
// itu inti DoD2. Satu tabel per (kadens, jenis perubahan): baris bulanan tidak boleh duduk di
// bawah label kolom harian, dan seri rate tidak boleh diberi label "%" (salah satunya adalah
// cacat review t_95ab7fa9 butir 4).
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

function mrRenderMonitor(mon) {
  if (!mon || !mon.groups || !mon.groups.length) {
    return '<div style="color:var(--t3);font-size:11px">Tidak ada seri di custom_tickers.</div>';
  }
  var nRows = 0;
  mon.groups.forEach(function (g) { nRows += (g.items || []).length; });

  var h = '<div style="font-size:9px;color:var(--t3);margin-bottom:6px">'
    + nRows + ' seri · ' + mon.groups.length + ' kelas aset</div>';

  mon.groups.forEach(function (g) {
    var items = g.items || [];
    if (!items.length) return;
    // Partisi per kadens + jenis perubahan. `window.lags`/`window.unit` datang dari baris itu
    // sendiri (server), bukan dari baris pertama grup.
    var parts = {};
    items.forEach(function (it) {
      var isPct = it.kind === 'price';
      var key = (it.freq || 'D') + '|' + (isPct ? 'pct' : 'delta');
      (parts[key] = parts[key] || []).push(it);
    });
    h += '<div style="margin:12px 0 4px;font-size:10px;font-weight:700;color:var(--t1)">' + esc(g.label || g.category)
      + ' <span style="font-weight:400;color:var(--t3)">· ' + items.length + ' seri'
      + ' · ' + esc(g.windows || '') + '</span></div>';
    Object.keys(parts).sort().forEach(function (key) {
      var rows = parts[key];
      var first = rows[0];
      var isPct = first.kind === 'price';
      var unitWord = (first.window && first.window.unit) || 'sesi';
      var lags = (first.window && first.window.lags) || [1, 5, 20];
      var sfx = MR_UNIT_SHORT[unitWord] || MR_FREQ_SHORT[first.freq] || 'D';
      var caps = lags.map(function (l) { return (isPct ? '' : 'Δ') + l + sfx; });
      h += mrMonitorTable(rows, caps, isPct, unitWord);
    });
  });
  return h;
}

function mrMonitorTable(rows, caps, isPct, unitWord) {
  var h = '<table class="mr-mon" style="width:100%;border-collapse:collapse;font-size:10px;font-family:var(--fm)">';
  h += '<tr style="color:var(--t3);border-bottom:1px solid var(--b1)">'
    + '<th style="text-align:left;padding:3px 6px;font-weight:600">Instrumen</th>'
    + '<th style="text-align:right;padding:3px 6px;font-weight:600;cursor:pointer" onclick="mrSortTable(this)">Last</th>';
  caps.forEach(function (c) {
    h += '<th style="text-align:right;padding:3px 6px;font-weight:600;cursor:pointer" onclick="mrSortTable(this)">'
      + c + (isPct ? '' : ' <span style="font-weight:400">(' + esc(unitWord) + ')</span>') + '</th>';
  });
  h += '<th style="text-align:right;padding:3px 6px;font-weight:600;cursor:pointer" onclick="mrSortTable(this)">'
    + (isPct ? 'YTD' : 'Δ YTD') + '</th>'
    + '<th style="text-align:right;padding:3px 6px;font-weight:600;cursor:pointer" onclick="mrSortTable(this)">%ile 1Y</th>'
    + '</tr>';

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
    else if (st === 'delayed') mark = ' <span style="color:var(--t3)" title="sumber ini memang terbit terlambat ' + (it.lag_sessions || 0) + ' sesi (wajar ≤ ' + (it.expected_lag_sessions == null ? '—' : it.expected_lag_sessions) + ')">·</span>';

    var unitTag = it.unit ? ' <span style="color:var(--t3);font-size:9px">(' + esc(it.unit) + ')</span>' : '';
    h += '<tr class="mr-row" data-state="' + st + '" style="border-bottom:1px solid var(--b1)">';
    h += '<td style="padding:3px 6px;font-family:var(--f)">' + esc(it.name || it.code) + mark + unitTag + '</td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.last === null || it.last === undefined ? '' : it.last) + '">' + lastCell + '</td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.chg_1 == null ? '' : it.chg_1) + '">' + mrMonChg(it.chg_1, isPct, neutral) + '</td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.chg_5 == null ? '' : it.chg_5) + '">' + mrMonChg(it.chg_5, isPct, neutral) + '</td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.chg_20 == null ? '' : it.chg_20) + '">' + mrMonChg(it.chg_20, isPct, neutral) + '</td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.chg_ytd == null || it.n_bars < 2 ? '' : it.chg_ytd) + '">'
      + (it.n_bars < 2 ? '<span style="color:var(--t3)" title="seri baru punya 1 bar: YTD tidak bermakna">—</span>' : mrMonChg(it.chg_ytd, isPct, neutral)) + '</td>';
    h += '<td style="padding:3px 6px;text-align:right;color:var(--t2)" data-v="' + (it.pctile_1y == null ? '' : it.pctile_1y) + '">'
      + (it.pctile_1y == null ? '—' : mrNum(it.pctile_1y) + '%') + '</td>';
    h += '</tr>';
  });
  h += '</table>';
  return h;
}

function mrSortTable(th) {
  var table = th.closest('table'); if (!table) return;
  var idx = Array.prototype.indexOf.call(th.parentNode.children, th);
  var asc = th.getAttribute('data-asc') !== '1';
  th.setAttribute('data-asc', asc ? '1' : '0');
  var body = Array.prototype.slice.call(table.querySelectorAll('tr')).filter(function (r) { return r.querySelector('td'); });
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
  body.forEach(function (r) { table.appendChild(r); });
}

// ═══ 3a. Likuiditas: SRBI & JISDOR ═══
function mrRenderLiquidity(liq) {
  if (!liq || !liq.items || !liq.items.length) return '<div style="color:var(--t3);font-size:11px">SRBI/JISDOR tidak tersedia.</div>';
  var h = '<div style="font-size:10px;font-weight:700;margin-bottom:4px">Likuiditas domestik '
    + '<span style="font-weight:400;color:var(--t3)">· seri bulanan · terakhir ' + esc(liq.as_of || '—') + '</span></div>';
  h += '<table style="width:100%;border-collapse:collapse;font-size:10px;font-family:var(--fm)">';
  h += '<tr style="color:var(--t3);border-bottom:1px solid var(--b1)">'
    + '<th style="text-align:left;padding:3px 6px;font-weight:600">Seri</th>'
    + '<th style="text-align:right;padding:3px 6px;font-weight:600">Level</th>'
    + '<th style="text-align:right;padding:3px 6px;font-weight:600">Δ1 periode</th>'
    + '<th style="text-align:left;padding:3px 6px;font-weight:600">status</th></tr>';
  liq.items.forEach(function (x) {
    if (x.missing) {
      h += '<tr class="mr-liq" data-state="missing" style="border-bottom:1px solid var(--b1)">'
        + '<td style="padding:3px 6px">' + esc(x.label) + ' <span style="color:var(--am)">hilang dari custom_tickers</span></td>'
        + '<td style="padding:3px 6px;text-align:right">—</td><td style="padding:3px 6px;text-align:right">—</td>'
        + '<td style="padding:3px 6px;text-align:right">—</td><td style="padding:3px 6px">—</td></tr>';
      return;
    }
    var st = x.stale ? 'stale' : (x.state === 'na' ? 'unmeasured' : 'fresh');
    var stTxt = x.stale ? '<span style="color:var(--rd)">basi</span>'
      : x.state === 'na' ? '<span style="color:var(--t3)">—</span>'
      : '<span style="color:var(--gn)">segar</span>';
    var lvl = (x.last === null || x.last === undefined)
      ? '<span style="color:var(--t2)" title="bar terakhir ' + mrNum(x.last_bar_value) + ' pada ' + esc(x.as_of || '') + '">—</span>'
      : mrNum(x.last);
    var d1 = (x.chg_1 === null || x.chg_1 === undefined) ? '—'
      : '<span style="color:' + (x.stale ? 'var(--t3)' : mrColor(x.chg_1)) + '">' + mrSigned(x.chg_1, x.chg_1_unit === '%' ? '%' : '') + '</span>';
    h += '<tr class="mr-liq" data-state="' + st + '" style="border-bottom:1px solid var(--b1)">'
      + '<td style="padding:3px 6px;font-family:var(--f)">' + esc(x.label) + (x.unit ? ' <span style="color:var(--t3);font-size:9px">(' + esc(x.unit) + ')</span>' : '') + '</td>'
      + '<td style="padding:3px 6px;text-align:right">' + lvl + '</td>'
      + '<td style="padding:3px 6px;text-align:right">' + d1 + '</td>'
      + '<td style="padding:3px 6px">' + stTxt + '</td></tr>';
  });
  h += '</table>';
  h += '<div style="font-size:9px;color:var(--t3);margin-top:4px">' + esc(liq.note || '') + '</div>';
  return h;
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
  var h = '<div style="font-size:10px;font-weight:700;margin-bottom:4px">Kurva SUN '
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

  h += '<div id="mr-curve-chart" style="height:200px;background:var(--bg1);border:1px solid var(--b1);border-radius:6px"></div>';

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
  var vals = (d.tenors || []).map(function (t) { return (t.on_curve !== false && t.close !== null) ? t.close : null; });
  var known = vals.filter(function (v) { return v !== null; });
  var pad = known.length ? Math.max(0.05, (Math.max.apply(null, known) - Math.min.apply(null, known)) * 0.25) : 0.5;
  c.setOption({
    tooltip: {
      trigger: 'axis', textStyle: { fontSize: 9 },
      formatter: function (ps) {
        var p = ps[0];
        var t = (d.tenors || [])[p.dataIndex] || {};
        var s = '<b>' + esc(t.tenor || '') + '</b> · ' + esc(d.as_of || '') + '<br/>';
        if (p.value === null || p.value === undefined) return s + '— (tidak ada bar; terakhir ' + esc(t.date || '-') + ')';
        return s + mrNum(p.value) + '% · Δ1D ' + mrFmtBp(t.chg_1d_bp) + ' bp · Δ1W ' + mrFmtBp(t.chg_5d_bp)
          + ' bp · Δ1M ' + mrFmtBp(t.chg_20d_bp) + ' bp';
      }
    },
    grid: BL.grid({ top: 14, bottom: 22, left: 46, right: 12 }),
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 8 } },
    yAxis: {
      type: 'value', scale: true,
      min: known.length ? Math.min.apply(null, known) - pad : null,
      max: known.length ? Math.max.apply(null, known) + pad : null,
      axisLabel: { fontSize: 8, formatter: function (v) { return Number(v).toFixed(2) + '%'; } },
      splitLine: { lineStyle: { color: '#1e2836', type: 'dashed' } }
    },
    series: [{
      name: 'Yield', type: 'line', data: vals, connectNulls: false,
      symbol: 'circle', symbolSize: 5,
      lineStyle: { width: 2, color: '#5470c6' }, itemStyle: { color: '#5470c6' },
      areaStyle: { color: 'rgba(84,112,198,0.10)' },
      markPoint: {
        symbolSize: 34,
        label: { fontSize: 8, color: '#e0e6ed' },
        // Anotasi = pasangan slope 10Y−3Y. Pilih lewat LABEL tenor, JANGAN lewat `months`
        // (10Y = 120 bulan, bukan 10) — cacat review t_b042b106 r1.
        data: ['10Y', '3Y'].map(function (tenorLabel) {
          var t = (d.tenors || []).filter(function (x) {
            return x.tenor === tenorLabel && x.close !== null && x.close !== undefined && x.on_curve !== false;
          })[0];
          if (!t) return null;
          var idx = labels.indexOf(t.tenor);
          if (idx < 0) return null;
          return { name: t.tenor, coord: [idx, t.close], value: t.tenor };
        }).filter(Boolean)
      }
    }]
  }, true);
}

// ═══ 4. Internals IDX ═══
function mrRenderInternals(it) {
  if (!it || !it.as_of) return '<div style="color:var(--t3);font-size:11px">Internals IDX tidak tersedia.</div>';
  var h = '<div style="font-size:9px;color:var(--t3);margin-bottom:6px">sesi <b style="color:var(--t2)">' + esc(it.as_of)
    + '</b> · jendela ' + (it.sessions || 0) + ' sesi (dari ' + esc(it.window_from || '—') + ') · harga di-MA memakai harga terkoreksi aksi korporasi</div>';

  // IHSG + foreign flow + tape + breadth: tabel dua kolom supaya sejajar
  var ihsg = it.ihsg || {}, br = it.breadth || {}, ff = it.foreign_flow || {}, tp = it.tape || {};
  h += '<table style="width:100%;border-collapse:collapse;font-size:10px;font-family:var(--fm)">';
  h += '<tr style="color:var(--t3);border-bottom:1px solid var(--b1)">'
    + '<th style="text-align:left;padding:3px 6px;font-weight:600">Blok</th>'
    + '<th style="text-align:right;padding:3px 6px;font-weight:600">Nilai</th>'
    + '<th style="text-align:left;padding:3px 6px;font-weight:600">Rincian</th></tr>';

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
    h += '<div style="font-size:10px;font-weight:700;margin:10px 0 4px">Rotasi sektor '
      + '<span style="font-weight:400;color:var(--t3)">· sama bobot (equal weight) · ' + (sec.count || 0) + ' sektor · ' + esc(sec.as_of || '') + '</span></div>';
    h += '<table style="width:100%;border-collapse:collapse;font-size:10px;font-family:var(--fm)">';
    h += '<tr style="color:var(--t3);border-bottom:1px solid var(--b1)">'
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
        + '<td style="padding:3px 6px"' + click + '>' + pair[0] + ' ' + esc(x.sector) + '</td>'
        + '<td style="padding:3px 6px;text-align:right;color:' + mrColor(x.chg_1d) + '">' + mrSigned(x.chg_1d, '%') + '</td>'
        + '<td style="padding:3px 6px;text-align:right;color:' + mrColor(x.chg_20d) + '">' + mrSigned(x.chg_20d, '%') + '</td>'
        + '<td style="padding:3px 6px;text-align:right;color:' + mrColor(x.rs_vs_ihsg_1d) + '">' + mrSigned(x.rs_vs_ihsg_1d, '%') + '</td>'
        + '<td style="padding:3px 6px;text-align:right;color:var(--t3)">' + (x.members || 0) + '</td>'
        + '<td style="padding:3px 6px">' + (x.top_stocks || []).map(function (t) {
          return '<span class="code" onclick="sdOpenTicker(\'' + esc(t) + '\')" style="cursor:pointer;font-size:10px;font-weight:600;margin-right:4px">' + esc(t) + '</span>';
        }).join('') + '</td></tr>';
    });
    h += '</table>';
  }

  // Konsentrasi kepemilikan ≥1%
  var o = it.ownership;
  if (o) {
    var old = (o.age_days || 0) > 90;
    h += '<div style="font-size:10px;font-weight:700;margin:10px 0 4px">Konsentrasi kepemilikan &ge;1% '
      + '<span style="font-weight:400;color:' + (old ? 'var(--am)' : 'var(--t3)') + '">· periode ' + esc(o.period_date || '—')
      + ' (' + (o.age_days == null ? '—' : o.age_days) + ' hari) · ' + (o.codes || 0) + ' emiten · ' + (o.holders || 0) + ' pemegang tercatat</span></div>';
    h += '<div style="font-size:10px;color:var(--t2);margin-bottom:4px">HHI median <b>' + mrNum(o.hhi_median) + '</b>'
      + ' · HHI p90 <b>' + mrNum(o.hhi_p90) + '</b>'
      + ' · emiten sangat terkonsentrasi (HHI &gt; 50): <b>' + (o.very_concentrated || 0) + '</b></div>';
    h += '<table style="width:100%;border-collapse:collapse;font-size:10px;font-family:var(--fm)">';
    h += '<tr style="color:var(--t3);border-bottom:1px solid var(--b1)">'
      + '<th style="text-align:left;padding:3px 6px;font-weight:600">Kode</th>'
      + '<th style="text-align:left;padding:3px 6px;font-weight:600">Pemegang terbesar</th>'
      + '<th style="text-align:right;padding:3px 6px;font-weight:600">Porsi</th>'
      + '<th style="text-align:right;padding:3px 6px;font-weight:600">HHI</th>'
      + '<th style="text-align:right;padding:3px 6px;font-weight:600">Pemegang ≥1%</th></tr>';
    (o.most_concentrated || []).forEach(function (x) {
      h += '<tr style="border-bottom:1px solid var(--b1)">'
        + '<td style="padding:3px 6px"><span class="code" onclick="sdOpenTicker(\'' + esc(x.code) + '\')" style="cursor:pointer;font-weight:600">' + esc(x.code) + '</span></td>'
        + '<td style="padding:3px 6px;font-family:var(--f);color:var(--t2)">' + esc(x.top_holder || '—') + '</td>'
        + '<td style="padding:3px 6px;text-align:right">' + mrNum(x.top_pct) + '%</td>'
        + '<td style="padding:3px 6px;text-align:right">' + mrNum(x.hhi) + '</td>'
        + '<td style="padding:3px 6px;text-align:right;color:var(--t3)">' + (x.holders || 0) + '</td></tr>';
    });
    h += '</table>';
    h += '<div style="font-size:9px;color:var(--t3);margin-top:3px">' + esc(o.note || '') + '</div>';
    if (old) {
      h += '<div style="font-size:9px;color:var(--am);margin-top:3px">Data kepemilikan terakhir ' + o.age_days
        + ' hari lalu — BEI belum menerbitkan periode berikutnya. Bukan angka hari ini.</div>';
    }
  } else {
    h += '<div style="font-size:10px;color:var(--t3);margin-top:10px">Data kepemilikan &ge;1% belum tersedia.</div>';
  }
  return h;
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
  var h = '<div style="font-size:9px;color:var(--t3);margin-bottom:4px">'
    + 'Rujukan sesi <b style="color:var(--t2)">' + esc(cov.ref_date || '—') + '</b> (' + esc(cov.ref_source || '—') + ') · '
    + (c.series || 0) + ' seri aktif: ' + (c.fresh || 0) + ' segar · ' + (c.stale || 0) + ' basi · '
    + (c.delayed || 0) + ' terlambat (wajar) · ' + (c.aged || 0) + ' umur lewat kadens · '
    + (c.unmeasured || 0) + ' umur tak terukur · ' + (c.thin || 0) + ' histori tipis · ' + (c.no_series || 0) + ' tanpa bar</div>';

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
