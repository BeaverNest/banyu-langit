// ═══════════════════════════════════════════════════════════════════════════════
// MENU: US MARKET
//
// Tiga sub-tab: Indices, Breadth, Sectors. Semua data satu payload dari
// /api/us/market — tidak ada request per tab, jadi pindah tab tidak menunggu.
//
// Catatan desain:
//   - Chart memakai Lightweight Charts lokal (bukan ECharts CDN) supaya tidak
//     bergantung pada cdnjs; pola sama dengan stock-detail.js.
//   - Angka indeks diberi label tegas "ETF proxy": SPY ~760 BUKAN level S&P 500
//     (~6.800). Menampilkannya tanpa penjelasan itu menyesatkan.
// ═══════════════════════════════════════════════════════════════════════════════

var USM_DATA = null;
var USM_LOADING = false;
var USM_TAB = 'indices';
var USM_CHARTS = {};

function usmFmt(v, kind) {
  if (v == null || !isFinite(v)) return '—';
  if (kind === 'pct') return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  if (kind === 'x') return v.toFixed(2) + 'x';
  if (kind === 'p') return v.toFixed(2);
  if (kind === 'cap') {
    var a = Math.abs(v);
    if (a >= 1e12) return (v / 1e12).toFixed(2) + ' T';
    if (a >= 1e9) return (v / 1e9).toFixed(1) + ' B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + ' M';
    return String(Math.round(v));
  }
  if (kind === 'n') return v.toLocaleString('id-ID');
  return String(v);
}

function usmColor(v) {
  if (v == null || !isFinite(v)) return 'var(--t3)';
  return v > 0 ? '#22c55e' : (v < 0 ? '#ef4444' : 'var(--t3)');
}

function loadUsMarket() {
  var el = document.getElementById('usm-content');
  if (!el) return;
  if (USM_DATA) { usmRender(el); return; }
  if (USM_LOADING) return;
  USM_LOADING = true;
  el.innerHTML = '<div class="ne" style="padding:40px">Memuat pasar AS…</div>';
  fetch('/api/us/market')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      USM_LOADING = false;
      if (!d.ok) { el.innerHTML = '<div class="ne" style="padding:24px;color:var(--rd)">Gagal: ' + esc(d.error || 'tidak diketahui') + '</div>'; return; }
      USM_DATA = d;
      usmRender(el);
    })
    .catch(function (e) {
      USM_LOADING = false;
      el.innerHTML = '<div class="ne" style="padding:24px;color:var(--rd)">Error: ' + esc(e.message) + '</div>';
    });
}

function usmSubTab(tab, btn) {
  USM_TAB = tab;
  var bar = document.querySelectorAll('#t-usm .wt-b');
  bar.forEach(function (b) { b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  else bar.forEach(function (b) { if ((b.getAttribute('data-ust') || '') === tab) b.classList.add('on'); });
  // Satu wadah `usm-body` untuk ketiga tab; isinya diganti, bukan ditumpuk.
  if (USM_DATA) usmRender(document.getElementById('usm-content'));
}

function usmRender(el) {
  if (!el) return;
  var d = USM_DATA;
  var h = '';

  // Garis konteks: sesi, jumlah simbol, dan sumber angka. Ditulis sekali di atas,
  // bukan diulang sebagai kolom.
  h += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:7px 10px;margin-bottom:8px;'
    + 'background:var(--bg1);border:1px solid var(--b1);border-radius:4px;font-size:10px;color:var(--t3)">';
  h += '<span>Sesi <b style="color:var(--t1)">' + esc(d.as_of) + '</b></span>';
  h += '<span style="color:var(--b2)">│</span><span>' + usmFmt(d.n_symbols, 'n') + ' simbol ber-sinyal</span>';
  h += '<span style="color:var(--b2)">│</span><span>' + usmFmt(d.n_meta, 'n') + ' di metadata</span>';
  if (d.breadth && d.breadth.n_etf_excluded) {
    h += '<span style="color:var(--b2)">│</span><span>' + d.breadth.n_etf_excluded
      + ' ETF dikeluarkan dari hitungan</span>';
  }
  h += '<span style="margin-left:auto;color:var(--am)">Indeks = ETF proxy (SPY/QQQ/DIA/IWM), bukan level indeks</span>';
  h += '</div>';

  if (USM_TAB === 'indices') h += usmIndices(d);
  else if (USM_TAB === 'breadth') h += usmBreadth(d);
  else if (USM_TAB === 'sectors') h += usmSectors(d);

  // Metode selalu tampil di bawah, apa pun tab-nya.
  h += '<div style="margin-top:10px;padding:8px 10px;background:var(--bg1);border:1px solid var(--b1);'
    + 'border-radius:4px;font-size:9px;color:var(--t3);line-height:1.6">'
    + '<b style="color:var(--t2)">Metode.</b> Harga = adjusted close (split + dividen). '
    + 'Angka sektor = <b>median</b> lintas emiten, bukan rata-rata. '
    + 'Breadth dihitung dari tanda <code>ret_1d</code> dan posisi terhadap MA200 di <code>signals_daily</code>. '
    + 'Daftar mover dibatasi ke simbol yang punya market cap, supaya ticker mikro tidak mendominasi.</div>';

  el.innerHTML = h;
  if (USM_TAB === 'indices') usmDrawCharts(d);
}

// ─── TAB 1: INDICES ────────────────────────────────────────────────────────────
function usmIndices(d) {
  var h = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;margin-bottom:8px">';
  d.indices.forEach(function (ix) {
    h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:9px 10px">';
    h += '<div style="display:flex;align-items:baseline;gap:6px">'
      + '<span style="font-weight:800;font-size:12px;color:var(--t1)">' + esc(ix.code) + '</span>'
      + '<span style="font-size:10px;color:var(--t3)">' + esc(ix.label) + '</span></div>';
    if (!ix.available) {
      h += '<div style="font-size:10px;color:var(--t3);margin-top:6px">tidak ada data</div></div>';
      return;
    }
    h += '<div style="display:flex;align-items:baseline;gap:8px;margin-top:3px">'
      + '<span style="font-size:19px;font-weight:700;font-family:var(--fm);color:var(--t1)">'
      + usmFmt(ix.last, 'p') + '</span>'
      + '<span style="font-size:11px;font-family:var(--fm);color:' + usmColor(ix.chg_1d) + '">'
      + usmFmt(ix.chg_1d, 'pct') + '</span></div>';
    h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px;margin-top:6px;font-size:10px;font-family:var(--fm)">';
    [['5D', ix.chg_5d], ['20D', ix.chg_20d], ['YTD', ix.chg_ytd]].forEach(function (p) {
      h += '<div><div style="font-size:8px;color:var(--t3)">' + p[0] + '</div>'
        + '<div style="color:' + usmColor(p[1]) + '">' + usmFmt(p[1], 'pct') + '</div></div>';
    });
    h += '</div>';
    h += '<div style="font-size:9px;color:var(--t3);margin-top:5px">'
      + 'dari puncak ' + usmFmt(ix.pct_from_hi, 'pct') + ' · rentang '
      + usmFmt(ix.lo_range, 'p') + '–' + usmFmt(ix.hi_range, 'p') + '</div>';
    h += '<div id="usm-chart-' + esc(ix.code) + '" style="height:90px;margin-top:6px"></div>';
    h += '</div>';
  });
  h += '</div>';
  return h;
}

function usmDrawCharts(d) {
  if (typeof LightweightCharts === 'undefined') return;
  d.indices.forEach(function (ix) {
    var box = document.getElementById('usm-chart-' + ix.code);
    if (!box || !ix.available || !ix.series || !ix.series.length) return;
    if (USM_CHARTS[ix.code]) { try { USM_CHARTS[ix.code].remove(); } catch (e) {} delete USM_CHARTS[ix.code]; }
    var ch = LightweightCharts.createChart(box, {
      width: box.clientWidth, height: box.clientHeight,
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8', fontSize: 9, attributionLogo: false },
      grid: { vertLines: { color: 'rgba(148,163,184,0.08)' }, horzLines: { color: 'rgba(148,163,184,0.08)' } },
      rightPriceScale: { borderColor: 'rgba(148,163,184,0.2)', scaleMargins: { top: 0.15, bottom: 0.1 } },
      timeScale: { borderColor: 'rgba(148,163,184,0.2)', timeVisible: false, fixLeftEdge: true },
      crosshair: { mode: 1 },
      handleScroll: false, handleScale: false
    });
    var line = ch.addSeries(LightweightCharts.AreaSeries, {
      lineColor: ixfColor(ix.chg_20d), topColor: ixfColor(ix.chg_20d) + '44',
      bottomColor: 'rgba(0,0,0,0)', lineWidth: 1.5,
      priceLineVisible: false, lastValueVisible: false
    });
    line.setData(ix.series);
    if (ix.series.length > 120) {
      ch.timeScale().setVisibleLogicalRange({ from: ix.series.length - 120, to: ix.series.length });
    } else {
      ch.timeScale().fitContent();
    }
    USM_CHARTS[ix.code] = ch;
  });
}

function ixfColor(v) {
  if (v == null || !isFinite(v)) return '#64748b';
  return v > 0 ? '#22c55e' : (v < 0 ? '#ef4444' : '#64748b');
}

// ─── TAB 2: BREADTH ────────────────────────────────────────────────────────────
function usmBreadth(d) {
  var b = d.breadth;
  var h = '';

  // Tiga angka utama: breadth 1D, di atas MA200, dan median return 20D.
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;margin-bottom:8px">';

  function card(title, big, sub, color) {
    return '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px">'
      + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:var(--t3)">' + title + '</div>'
      + '<div style="font-size:22px;font-weight:800;font-family:var(--fm);color:' + color + ';margin:3px 0">' + big + '</div>'
      + '<div style="font-size:9px;color:var(--t3)">' + sub + '</div></div>';
  }

  h += card('Breadth 1D', usmFmt(b.adv_pct, 'p') + '%',
    b.adv + ' naik · ' + b.dec + ' turun · ' + b.unch + ' datar', usmColor(b.adv_pct - 50));
  h += card('Di atas MA200', usmFmt(b.above_ma200_pct, 'p') + '%',
    usmFmt(b.above_ma200, 'n') + ' dari ' + usmFmt(b.n, 'n') + ' simbol',
    usmColor(b.above_ma200_pct - 50));
  h += card('Median 1D', usmFmt(b.median_ret_1d, 'pct'),
    '5D ' + usmFmt(b.median_ret_5d, 'pct') + ' · 20D ' + usmFmt(b.median_ret_20d, 'pct'),
    usmColor(b.median_ret_1d));
  h += '</div>';

  // Perubahan breadth vs sesi sebelumnya. Arah breadth lebih informatif daripada
  // levelnya: 33% naik tapi sebelumnya 20% berarti membaik, bukan buruk.
  h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px;margin-bottom:8px">';
  h += '<div style="font-size:10px;font-weight:700;color:var(--t1);margin-bottom:6px">Perubahan vs sesi sebelumnya'
    + ' <span style="font-weight:400;color:var(--t3)">(' + esc(b.prev_date || '—') + ')</span></div>';
  if (b.prev_adv != null) {
    var dAdv = b.adv - b.prev_adv;
    var dM = b.above_ma200_pct - (b.prev_above_ma200_pct || 0);
    h += '<div style="display:flex;gap:24px;font-size:11px;font-family:var(--fm)">';
    h += '<div><span style="color:var(--t3);font-size:9px">emiten naik</span><br>'
      + b.prev_adv + ' → ' + b.adv + ' <span style="color:' + usmColor(dAdv) + '">('
      + (dAdv > 0 ? '+' : '') + dAdv + ')</span></div>';
    h += '<div><span style="color:var(--t3);font-size:9px">% di atas MA200</span><br>'
      + usmFmt(b.prev_above_ma200_pct, 'p') + '% → ' + usmFmt(b.above_ma200_pct, 'p') + '% <span style="color:'
      + usmColor(dM) + '">(' + (dM > 0 ? '+' : '') + dM.toFixed(2) + 'pp)</span></div>';
    h += '</div>';
  } else {
    h += '<div style="font-size:10px;color:var(--t3)">tidak ada sesi pembanding</div>';
  }
  h += '</div>';

  // Distribusi sinyal. Ini hitungan mentah dari flag di signals_daily, bukan opini.
  var sig = [
    ['Trend naik (MA10>20>50)', b.trend_up, 'f_trend_up'],
    ['Cross MA200 ke atas', b.cross200_up, 'f_cross200_up'],
    ['Volume spike', b.vol_spike, 'f_vol_spike'],
    ['Breakout 20 hari', b.break20, 'f_break20'],
    ['Oversold (RSI)', b.oversold, 'f_oversold'],
    ['Overbought (RSI)', b.overbought, 'f_overbought']
  ];
  h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px">';
  h += '<div style="font-size:10px;font-weight:700;color:var(--t1);margin-bottom:6px">Distribusi sinyal</div>';
  h += '<table style="width:100%;border-collapse:collapse;font-size:10px;font-family:var(--fm)">';
  sig.forEach(function (s) {
    var p = b.n > 0 ? (s[1] / b.n) * 100 : 0;
    h += '<tr style="border-bottom:1px solid var(--b1)">'
      + '<td style="padding:4px 4px;color:var(--t2)">' + s[0] + '</td>'
      + '<td style="padding:4px 4px;text-align:right;color:var(--t1);width:60px">' + usmFmt(s[1], 'n') + '</td>'
      + '<td style="padding:4px 4px;text-align:right;color:var(--t3);width:55px">' + p.toFixed(1) + '%</td>'
      + '<td style="padding:4px 4px;width:110px">'
      + '<div style="height:5px;background:var(--bg2,#1e293b);border-radius:2px">'
      + '<div style="height:5px;width:' + Math.min(100, p).toFixed(1) + '%;background:var(--am);border-radius:2px"></div>'
      + '</div></td></tr>';
  });
  h += '</table></div>';
  return h;
}

// ─── TAB 3: SECTORS ────────────────────────────────────────────────────────────
function usmSectors(d) {
  var h = '';
  h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;overflow:hidden">';
  h += '<div style="padding:8px 10px;border-bottom:1px solid var(--b1);font-size:11px;font-weight:700;color:var(--t1)">'
    + 'Sektor <span style="font-weight:400;color:var(--t3);font-size:9px">'
    + d.sectors.length + ' sektor · median lintas emiten · urut 20D</span></div>';
  h += '<table style="width:100%;border-collapse:collapse;font-size:10px;font-family:var(--fm)">';
  h += '<thead><tr style="color:var(--t3);border-bottom:1px solid var(--b1)">';
  var th = 'padding:5px 6px;font-size:9px;font-weight:600;text-align:right;white-space:nowrap';
  h += '<th style="' + th + ';text-align:left">Sektor</th>'
    + '<th style="' + th + '">n</th>'
    + '<th style="' + th + '">1D</th>'
    + '<th style="' + th + '">5D</th>'
    + '<th style="' + th + '">20D</th>'
    + '<th style="' + th + '">vs MA200</th>'
    + '<th style="' + th + '">% &gt; MA200</th>'
    + '<th style="' + th + '">RSI</th>'
    + '<th style="' + th + '">breadth</th>';
  h += '</tr></thead><tbody>';

  d.sectors.forEach(function (s) {
    h += '<tr style="border-bottom:1px solid var(--b1)">';
    var noSec = s.sector === '(tanpa sektor)';
    h += '<td style="padding:5px 6px;font-weight:600;color:' + (noSec ? 'var(--am)' : 'var(--t1)') + '"'
      + (noSec ? ' title="us_symbols_meta tidak punya sektor untuk emiten ini; bukan berarti tidak ada sektor"' : '')
      + '>' + esc(s.sector) + '</td>';
    h += '<td style="padding:5px 6px;text-align:right;color:var(--t3)">' + s.n + '</td>';
    h += '<td style="padding:5px 6px;text-align:right;color:' + usmColor(s.median_ret_1d) + '">' + usmFmt(s.median_ret_1d, 'pct') + '</td>';
    h += '<td style="padding:5px 6px;text-align:right;color:' + usmColor(s.median_ret_5d) + '">' + usmFmt(s.median_ret_5d, 'pct') + '</td>';
    h += '<td style="padding:5px 6px;text-align:right;color:' + usmColor(s.median_ret_20d) + '">' + usmFmt(s.median_ret_20d, 'pct') + '</td>';
    h += '<td style="padding:5px 6px;text-align:right;color:' + usmColor(s.median_dist_ma200) + '">' + usmFmt(s.median_dist_ma200, 'pct') + '</td>';
    h += '<td style="padding:5px 6px;text-align:right;color:var(--t2)">' + usmFmt(s.above_ma200_pct, 'p') + '%</td>';
    h += '<td style="padding:5px 6px;text-align:right;color:var(--t3)">' + usmFmt(s.median_rsi, 'p') + '</td>';
    h += '<td style="padding:5px 6px;text-align:right;color:' + usmColor(s.adv_pct - 50) + '">'
      + usmFmt(s.adv_pct, 'p') + '%</td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';

  // Movers. Dua kolom: gainers dan losers, keduanya dibatasi ke simbol ber-market-cap.
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">';
  [['Top gainers 1D', d.movers.gainers, '#22c55e'], ['Top losers 1D', d.movers.losers, '#ef4444']].forEach(function (grp) {
    h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:8px 10px">';
    h += '<div style="font-size:10px;font-weight:700;color:' + grp[2] + ';margin-bottom:5px">' + grp[0] + '</div>';
    h += '<table style="width:100%;border-collapse:collapse;font-size:10px;font-family:var(--fm)">';
    grp[1].forEach(function (m) {
      h += '<tr style="border-bottom:1px solid var(--b1)">'
        + '<td style="padding:3px 2px;color:var(--t1);font-weight:600">' + esc(m.code) + '</td>'
        + '<td style="padding:3px 2px;color:var(--t3);font-size:8px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
        + esc(String(m.name || '').slice(0, 22)) + '</td>'
        + '<td style="padding:3px 2px;text-align:right;color:var(--t2)">' + usmFmt(m.last, 'p') + '</td>'
        + '<td style="padding:3px 2px;text-align:right;color:' + usmColor(m.ret_1d) + '">' + usmFmt(m.ret_1d, 'pct') + '</td>'
        + '<td style="padding:3px 2px;text-align:right;color:var(--t3);font-size:9px">' + usmFmt(m.market_cap, 'cap') + '</td>'
        + '</tr>';
    });
    h += '</table></div>';
  });
  h += '</div>';
  return h;
}
