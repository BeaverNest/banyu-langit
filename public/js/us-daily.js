// ═══ PANEL SAHAM AS — tabel `us_daily` (kanban t_2c5e0fbb) ═══
//
// SATU payload: GET /api/idx/us-daily?codes=all&days=250. Tidak ada request kedua dan
// TIDAK ADA hitungan di UI: Last / 1D / 5D / 20D / YTD / %ile 52w datang dari server
// (server/routes/us-daily.js). Kontrak tampilan §1: angka yang dihasilkan server wajib
// sudah diformat, angka mentah DB tidak boleh muncul apa adanya.
//
// Kontrak tampilan (docs/ui-display-contract.md) yang dipatuhi:
//   §1 semua nilai 2 desimal — mrNum() / mrSigned(); tidak ada 0/1/3/4 desimal.
//   §2 table-layout:fixed + colgroup lebar eksplisit. Tabel ini memakai colgroup yang
//      SAMA dengan tabel monitor Market Regime (38/14/12/12/12/12) dan bungkus yang sama
//      (padding 12 + kartu ber-border), jadi tepi kanan kolomnya identik secara piksel —
//      diukur, bukan dikira. Header seragam: Last, 1D, 5D, 20D, YTD.
//   §3 tanpa kolom `as-of`/`sumber`; tanpa kolom %ile sebagai kolom (posisi 52w ditulis
//      di sel nama sebagai keterangan, sparkline di panel detail baris).
//   §4 sesi terakhir disebut sekali di baris meta, bukan sebagai label samar.
//   §5 sparkline detail: lebar penuh (viewBox responsif), crosshair + tooltip
//      `tanggal · nilai`, label min/max — memakai mrSparkSvg()/mrSparkMove() yang sudah
//      ada di market-regime.js (kartu menyebutnya eksplisit: jangan bikin spark kedua).
//
// KENAPA SPARK TIDAK JADI KOLOM: mrSparkSvg bertinggi 140px (dirancang untuk panel
// detail). Sebagai kolom, 36 baris jadi ~5.000px dan label min/max-nya bertabrakan di
// lebar ~170px; selain itu kolom tambahan mematahkan tepi kolom yang identik dengan
// Market Regime (kontrak §2). Jadi: satu klik baris = sparkline lebar penuh + provenance,
// persis pola drill-down yang sudah dipakai Market Regime (t_651e530e). 0 request per klik.

var udData = null;
var udLoading = false;

function loadUSDaily() {
  var el = $('ud-content'); if (!el) return;
  if (udData) { renderUD(el); return; }
  el.innerHTML = '<div class="ne" style="padding:40px">Loading saham AS...</div>';
  udFetch(el);
}

async function udFetch(el) {
  if (udLoading) return;
  udLoading = true;
  try {
    var r = await fetch('/api/idx/us-daily?codes=all&days=250');
    var d = await r.json();
    if (!d || d.ok === false) {
      el.innerHTML = '<div class="ne" style="color:var(--rd)">' + esc((d && d.error) || 'payload gagal dimuat') + '</div>';
      udLoading = false; return;
    }
    udData = d;
    renderUD(el);
  } catch (e) {
    el.innerHTML = '<div class="ne" style="color:var(--rd)">Error: ' + esc(e.message) + '</div>';
  }
  udLoading = false;
}

function udChg(v) {
  if (v === null || v === undefined || isNaN(v)) return '<span style="color:var(--t3)" title="riwayat belum cukup untuk jendela ini">—</span>';
  return '<span style="color:' + mrColor(v) + '">' + mrSigned(v, '%') + '</span>';
}

function renderUD(el) {
  var d = udData;
  var rows = (d && Array.isArray(d.rows)) ? d.rows : [];

  // Bungkus sama dengan Market Regime: padding 12 + kartu border-radius 6 — inilah yang
  // membuat tepi kolom tabel ini jatuh di koordinat yang sama dengan tabel monitor.
  var h = '<div style="padding:12px;font-family:var(--f)">';
  h += '<div style="border:1px solid var(--b1);border-radius:6px;overflow:hidden">';
  h += '<div style="padding:8px 12px;background:var(--bg1);border-bottom:1px solid var(--b1);'
    + 'font-size:12px;font-weight:700;color:var(--t1)">🇺🇸 Saham AS'
    + ' <span style="font-weight:400;color:var(--t3);font-size:10px">· ' + rows.length
    + ' simbol · harian</span></div>';
  h += '<div style="padding:10px 12px">';

  // Sesi terakhir + provenance disebut SEKALI di sini (kontrak §3: bukan kolom).
  h += '<div style="font-size:9px;color:var(--t3);margin-bottom:6px;font-family:var(--fm)">'
    + 'sesi terakhir ' + esc(d.as_of || '—')
    + ' · ' + esc(String((d.params && d.params.days) || 250)) + ' bar tampilan'
    + ' · harga adjusted (split + dividen) · klik baris = grafik · klik header = urutkan</div>';

  if (d.missing && d.missing.length) {
    h += '<div style="font-size:9px;color:var(--am);margin-bottom:4px">tidak ada baris untuk: '
      + esc(d.missing.join(', ')) + '</div>';
  }

  if (!rows.length) {
    h += '<div style="color:var(--t3);font-size:11px">' + esc(d.note || 'us_daily kosong') + '</div>';
  } else {
    h += udTable(rows);
  }

  h += '</div></div></div>';
  el.innerHTML = h;
}

function udTable(rows) {
  UD_ROW_MAP = {};
  // §2: table-layout fixed + colgroup EKSPLISIT yang identik dengan tabel monitor
  // Market Regime (halaman yang sama, blok sejenis): Instrumen 38 · Last 14 · 1D/5D/20D/YTD 12.
  var h = '<table class="mr-mon ud-tbl" style="width:100%;table-layout:fixed;border-collapse:collapse;'
    + 'font-size:10px;font-family:var(--fm)">'
    + '<colgroup><col style="width:38%"><col style="width:14%">'
    + '<col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:12%">'
    + '</colgroup>';

  h += '<tr style="color:var(--t3);border-bottom:1px solid var(--b1)">'
    + '<th style="text-align:left;padding:3px 6px;font-weight:600">Simbol</th>';
  [['Last', 'harga penutupan terakhir (adjusted)'],
   ['1D', 'perubahan vs sesi sebelumnya'],
   ['5D', 'perubahan vs 5 sesi sebelumnya'],
   ['20D', 'perubahan vs 20 sesi sebelumnya'],
   ['YTD', 'perubahan sejak akhir tahun lalu']].forEach(function (col) {
    h += '<th style="text-align:right;padding:3px 6px;font-weight:600;cursor:pointer;white-space:nowrap"'
      + ' title="' + esc(col[1]) + ' — klik untuk urutkan" onclick="mrSortTable(this)">' + col[0] + '</th>';
  });
  h += '</tr>';

  rows.forEach(function (it) {
    var lag = (it.lag_sessions === null || it.lag_sessions === undefined) ? 0 : Number(it.lag_sessions);
    // Bar terakhir bukan sesi terbaru: level TETAP dicetak (itu bar terakhir seri ini)
    // tapi diberi penanda + tooltip yang bisa dibaca pembaca awam (kontrak §4).
    var mark = (lag > 0)
      ? ' <span style="color:var(--am)" title="bar terakhir ' + esc(it.as_of || '—') + ', ' + lag
        + ' sesi di belakang sesi terbaru">·</span>'
      : '';
    // Posisi 52 minggu ditulis sebagai keterangan di sel nama, bukan sebagai kolom
    // (kontrak §3 menghapus kolom %ile dari tabel monitor; kartu tetap meminta angkanya).
    var pos = (it.pctile_52w === null || it.pctile_52w === undefined)
      ? '<span style="color:var(--t3)">52w —</span>'
      : '<span style="color:var(--t3)" title="Posisi harga terakhir di rentang setahun: 0 = terendah ('
        + mrNum(it.low_52w) + '), 100 = tertinggi (' + mrNum(it.high_52w) + ')">52w ' + mrNum(it.pctile_52w) + '</span>';
    var rowTitle = (it.name || it.code) + ': bar terakhir ' + (it.as_of || '—')
      + ' · ' + (it.n_bars || 0) + ' bar tersimpan (' + (it.first_date || '—') + ' → ' + (it.as_of || '—') + ')'
      + ' · rentang 52w ' + mrNum(it.low_52w) + '–' + mrNum(it.high_52w)
      + (it.source ? ' · sumber ' + it.source : '');
    UD_ROW_MAP[it.code] = it;             // dipakai udRowDetail (0 request per klik)

    h += '<tr class="mr-row ud-row" data-key="' + esc(it.code) + '" onclick="udRowDetail(this)"'
      + ' style="border-bottom:1px solid var(--b1)">';
    h += '<td style="padding:3px 6px;font-family:var(--f);overflow:hidden;text-overflow:ellipsis;'
      + 'white-space:nowrap" title="' + esc(rowTitle) + '"><b>' + esc(it.code) + '</b>' + mark
      + ' <span style="font-family:var(--fm);font-size:9px">' + pos + '</span></td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.last == null ? '' : it.last) + '">'
      + mrNum(it.last) + '</td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.chg_1d_pct == null ? '' : it.chg_1d_pct) + '">'
      + udChg(it.chg_1d_pct) + '</td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.chg_5d_pct == null ? '' : it.chg_5d_pct) + '">'
      + udChg(it.chg_5d_pct) + '</td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.chg_20d_pct == null ? '' : it.chg_20d_pct) + '">'
      + udChg(it.chg_20d_pct) + '</td>';
    h += '<td style="padding:3px 6px;text-align:right" data-v="' + (it.chg_ytd_pct == null ? '' : it.chg_ytd_pct) + '">'
      + udChg(it.chg_ytd_pct) + '</td>';
    h += '</tr>';
  });

  h += '</table>';
  return h;
}

// ═══ Detail baris: sparkline lebar penuh + provenance (0 request) ═══
// Memakai kelas mr-row/mr-detail supaya CSS dan mrCloseSeriesDetail() yang sudah ada
// berlaku apa adanya (hover, baris detail di bawah induknya, satu panel terbuka sekaligus).
var UD_ROW_MAP = {};

function udRowDetail(tr) {
  var key = tr.getAttribute('data-key') || '';
  var it = UD_ROW_MAP[key];
  if (!it) return;
  var wasOpen = tr.getAttribute('data-open') === '1';
  mrCloseSeriesDetail();                 // tutup panel lain (Market Regime maupun panel ini)
  if (wasOpen) return;                   // klik kedua = tutup
  tr.setAttribute('data-open', '1');

  var spark = (Array.isArray(it.spark) ? it.spark : []).filter(function (v) {
    return v !== null && v !== undefined && !isNaN(v);
  });

  var meta = ''
    + '<span>sesi terakhir <b style="color:var(--t2)">' + esc(it.as_of || '—') + '</b></span>'
    + '<span>bar tersimpan <b style="color:var(--t2)">' + esc(String(it.n_bars || 0)) + '</b>'
    + ' (' + esc(it.first_date || '—') + ' → ' + esc(it.as_of || '—') + ')</span>'
    + '<span>rentang 52w <b style="color:var(--t2)">' + mrNum(it.low_52w) + '</b> – <b style="color:var(--t2)">'
    + mrNum(it.high_52w) + '</b></span>'
    + '<span>posisi 52w <b style="color:var(--t2)">' + mrNum(it.pctile_52w) + '</b></span>'
    + (it.ytd_base_date ? '<span>YTD dari <b style="color:var(--t2)">' + esc(it.ytd_base_date) + '</b></span>' : '')
    + (it.source ? '<span>sumber <b style="color:var(--t2)">' + esc(it.source) + '</b></span>' : '');

  var html = '<div style="padding:6px 8px 8px">'
    + '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:9px;color:var(--t3);'
    + 'font-family:var(--fm);margin-bottom:2px">' + meta + '</div>';

  if (spark.length >= 2) {
    html += '<div style="font-size:9px;color:var(--t3);font-family:var(--fm)">'
      + esc(it.code) + ' · close ' + esc(String(spark.length)) + ' sesi terakhir</div>'
      + mrSparkSvg(spark, it.spark_dates || []);
  } else {
    html += '<div style="font-size:10px;color:var(--t3)">grafik tidak tersedia — butuh minimal 2 bar</div>';
  }
  html += '</div>';

  var row = document.createElement('tr');
  row.className = 'mr-detail';
  row.setAttribute('data-detail', '1');
  var td = document.createElement('td');
  td.colSpan = 6;
  td.style.padding = '0';
  td.innerHTML = html;
  row.appendChild(td);
  tr.parentNode.insertBefore(row, tr.nextSibling);
}
