// ═══════════════════════════════════════════════════════════════════════════
// SCREENER — PASAR US
//
// Tab ini beda cara kerja dengan tab IDX: IDX memakai formula AFL
// ("C > MA20 AND ROE > 10") karena universe-nya kecil (963 emiten, semua punya
// fundamental + foreign flow). US tidak memakai formula karena:
//   1. signals_daily US tidak punya foreign flow / fundamental / bandarmology —
//      variabel formula IDX akan jadi tombol yang selalu mengembalikan 0 baris.
//   2. Universe 1.122 emiten lebih cocok disaring progresif (filter bertumpuk)
//      daripada ditulis sebagai satu ekspresi.
// Jadi US = filter panel, IDX = formula. Bukan inkonsistensi, tapi perbedaan
// data yang tersedia di masing-masing pasar.
// ═══════════════════════════════════════════════════════════════════════════

var SCR_MKT = 'IDX';
var SCR_US = {
  rows: [], total: 0, universe: 0, as_of: null, excluded: null, sectors: [],
  sort: 'ret_20d', order: 'desc', offset: 0, limit: 100, loading: false,
  f: { q: '', sector: '', min_price: 5, min_mcap: 1, max_rsi: '', min_rsi: '',
       min_dist200: '', max_dist200: '', min_ret20: '', max_ret20: '',
       trend_up: 0, cross200_up: 0, vol_spike: 0, break20: 0, preset: -1 }
};

function scrMarket(mkt, btn) {
  SCR_MKT = mkt;
  var bar = document.getElementById('scr-mkt-tabs');
  if (bar) {
    Array.prototype.forEach.call(bar.querySelectorAll('.wt-b'), function (b) {
      b.classList.toggle('on', b === btn || b.getAttribute('data-mkt') === mkt);
    });
  }
  document.querySelectorAll('#t-scr .wp').forEach(function (p) { p.classList.remove('on'); });
  var pane = document.getElementById(mkt === 'US' ? 'ana-scrus' : 'ana-screener');
  if (pane) pane.classList.add('on');
  if (mkt === 'US' && !SCR_US._init) { SCR_US._init = true; scrUsRender(); scrUsLoad(); }
  else if (mkt === 'US') { /* pertahankan hasil & filter yang sudah ada */ }
  else if (typeof scrResults !== 'undefined' && scrResults.length) { scrRenderResults(); }
}

// ── Filter bar ───────────────────────────────────────────────────────────────

var SCR_US_FILTERS = [
  { k: 'min_price', label: 'Harga ≥ $', w: 78, ph: '5' },
  { k: 'min_mcap', label: 'Mcap ≥ $B', w: 82, ph: '1' },
  { k: 'min_ret20', label: 'Ret20 ≥ %', w: 84, ph: '' },
  { k: 'max_ret20', label: 'Ret20 ≤ %', w: 84, ph: '' },
  { k: 'min_rsi', label: 'RSI ≥', w: 70, ph: '' },
  { k: 'max_rsi', label: 'RSI ≤', w: 70, ph: '' },
  { k: 'min_dist200', label: 'vs MA200 ≥ %', w: 96, ph: '' },
  { k: 'max_dist200', label: 'vs MA200 ≤ %', w: 96, ph: '' }
];

var SCR_US_FLAGS = [
  { k: 'trend_up', label: 'Trend up', tip: 'Close > MA50 > MA200 dan MA200 menanjak' },
  { k: 'cross200_up', label: 'Cross 200', tip: 'Menembus MA200 ke atas pada sesi ini' },
  { k: 'vol_spike', label: 'Vol spike', tip: 'Volume > 2× rata-rata 20 sesi' },
  { k: 'break20', label: 'Break 20D', tip: 'Close di atas high 20 sesi' }
];

// Preset diturunkan dari definisi sinyal, bukan dari selera. Angka "cocok" tiap
// preset dicek ke SQL dulu: preset yang menghasilkan 0 atau 1 baris dari 1.122
// emiten bukan "selektif", itu salah definisi.
//   - f_trend_up sudah menyiratkan C>MA50>MA200 dan MA200 menanjak, sehingga RSI
//     35 praktis mustahil (min RSI pada himpunan ini 45,8). "Oversold di uptrend"
//     karenanya memakai jarak ke MA200, bukan RSI.
//   - f_break20 + f_vol_spike bersamaan hanya menyisakan 1 emiten karena breakout
//     20 hari biasanya justru terjadi saat volume belum meledak.
var SCR_US_PRESETS = [
  { n: 'Momentum sehat', tip: 'Trend up + return 20D positif, harga ≥ $10, mcap ≥ $2B',
    f: { trend_up: 1, min_ret20: 0, min_price: 10, min_mcap: 2 } },
  { n: 'Pullback di uptrend', tip: 'Di atas MA200 tapi RSI ≤ 40 — koreksi dalam tren naik',
    f: { min_dist200: 0.1, max_rsi: 40, min_price: 5, min_mcap: 1 } },
  { n: 'Breakout 20D', tip: 'Close di atas high 20 sesi',
    f: { break20: 1, min_price: 5, min_mcap: 1 } },
  { n: 'Volume spike + uptrend', tip: 'Lonjakan volume pada emiten yang sedang tren naik',
    f: { vol_spike: 1, trend_up: 1, min_price: 5, min_mcap: 1 } },
  { n: 'Baru cross MA200', tip: 'Menembus MA200 ke atas pada sesi terakhir',
    f: { cross200_up: 1, min_price: 5, min_mcap: 1 } },
  { n: 'Large cap', tip: 'Mcap ≥ $200B — likuiditas tinggi',
    f: { min_mcap: 200, min_price: 10 } },
  { n: 'Jauh di bawah MA200', tip: 'Lebih dari 10% di bawah MA200 — kandidat reversal',
    f: { max_dist200: -10, min_price: 5, min_mcap: 2 } }
];

function scrUsFmt(v, d) {
  if (v === null || v === undefined || v === '' || Number.isNaN(v)) return '<span style="color:var(--t3)">—</span>';
  return (d !== undefined ? Number(v).toFixed(d) : v);
}
function scrUsPct(v) {
  if (v === null || v === undefined) return '<span style="color:var(--t3)">—</span>';
  var c = v > 0 ? 'var(--gn)' : (v < 0 ? 'var(--rd)' : 'var(--t2)');
  return '<span style="color:' + c + ';font-family:var(--fm)">' + (v > 0 ? '+' : '') + Number(v).toFixed(2) + '</span>';
}
function scrUsNum(v) {
  if (v === null || v === undefined) return '<span style="color:var(--t3)">—</span>';
  var n = Number(v);
  // Harga saham AS bisa empat digit (mis. 2375.84). Tanpa pemisah ribuan angka
  // itu menyatu dengan kolom sebelah.
  var txt = (Math.abs(n) >= 1000)
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toFixed(2);
  return '<span style="font-family:var(--fm)">' + txt + '</span>';
}

function scrUsRender() {
  var el = document.getElementById('scr-us');
  if (!el) return;
  var h = '<div style="padding:0;display:flex;flex-direction:column;height:100%;overflow:hidden">';

  // ── preset + filter bertumpuk ──
  h += '<div style="padding:7px 12px;border-bottom:1px solid var(--b1);flex-shrink:0">';
  h += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px">';
  h += '<span style="font-size:9px;color:var(--t3);font-weight:700">PRESET:</span>';
  SCR_US_PRESETS.forEach(function (p, i) {
    var on = (SCR_US.preset === i);
    h += '<button class="afl-tpl" onclick="scrUsPreset(' + i + ')" title="' + p.tip + '"'
      + ' style="' + (on ? 'background:var(--bl);color:#fff;border-color:var(--bl)' : '') + '">'
      + p.n + '</button>';
  });
  h += '<span style="flex:1"></span>';
  h += '<input id="suf-q" placeholder="Cari kode / nama" value="' + (SCR_US.f.q || '') + '"'
    + ' onkeydown="if(event.key===\'Enter\')scrUsApply()"'
    + ' style="width:150px;background:var(--bg2);border:1px solid var(--b2);color:var(--t1);'
    + 'font-family:var(--f);font-size:10px;padding:3px 6px;border-radius:3px">';
  h += '<button class="afl-btn afl-btn-run" onclick="scrUsApply()">✦ Apply</button>';
  h += '<button class="afl-btn afl-btn-clear" onclick="scrUsReset()">↺ Reset</button>';
  h += '</div>';

  h += '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
  SCR_US_FILTERS.forEach(function (f) {
    h += '<label style="display:flex;align-items:center;gap:3px;font-size:9px;color:var(--t3)">'
      + f.label + '<input id="suf-' + f.k + '" value="' + (SCR_US.f[f.k] === '' || SCR_US.f[f.k] === null ? '' : SCR_US.f[f.k]) + '"'
      + ' placeholder="' + f.ph + '" onkeydown="if(event.key===\'Enter\')scrUsApply()"'
      + ' style="width:' + f.w + 'px;background:var(--bg2);border:1px solid var(--b2);color:var(--t1);'
      + 'font-family:var(--fm);font-size:10px;padding:2px 5px;border-radius:3px"></label>';
  });
  h += '<span style="width:1px;height:14px;background:var(--b2)"></span>';
  SCR_US_FLAGS.forEach(function (f) {
    var on = SCR_US.f[f.k] ? 'background:var(--bl);color:#fff' : 'background:var(--bg2);color:var(--t2)';
    h += '<button onclick="scrUsFlag(\'' + f.k + '\')" title="' + f.tip + '"'
      + ' style="' + on + ';border:1px solid var(--b2);font-size:9px;font-weight:600;'
      + 'padding:2px 7px;border-radius:3px;cursor:pointer">' + f.label + '</button>';
  });
  h += '</div></div>';

  // ── status + tabel ──
  h += '<div id="suf-status" style="padding:4px 12px;font-size:10px;color:var(--t3);flex-shrink:0;'
    + 'display:flex;gap:10px;align-items:center;flex-wrap:wrap"></div>';
  h += '<div id="suf-results" style="flex:1;overflow:auto"></div>';
  h += '<div id="suf-pager" style="flex-shrink:0;border-top:1px solid var(--b1);'
    + 'padding:6px 12px;font-size:10px;color:var(--t3);display:flex;align-items:center;gap:10px"></div>';
  h += '</div>';
  el.innerHTML = h;
  scrUsStatus();
}

function scrUsStatus() {
  var st = document.getElementById('suf-status');
  if (!st) return;
  if (SCR_US.loading) { st.innerHTML = '<span style="color:var(--am)">⏳ Menyaring…</span>'; return; }
  if (!SCR_US.as_of) { st.innerHTML = '<span style="color:var(--t3)">Belum ada data.</span>'; return; }
  var x = SCR_US.excluded || {};
  var h = '<span style="color:var(--gn);font-weight:600">' + SCR_US.total + ' matches</span>';
  h += '<span style="color:var(--b2)">│</span><span>' + SCR_US.universe + ' emiten di universe</span>';
  h += '<span style="color:var(--b2)">│</span><span>' + SCR_US.as_of
    + ' <span style="color:var(--t4)">(sesi terakhir yang tersedia)</span></span>';
  if (x.etf) {
    h += '<span style="color:var(--b2)">│</span><span title="ETF tidak punya sektor/industri dan harganya turunan keranjang; ETF leveraged (mis. SOXS 3x bear) memuncaki daftar return dengan angka yang bukan pergerakan emiten">'
      + x.etf + ' ETF tidak disertakan</span>';
  }
  if (x.no_meta) {
    h += '<span style="color:var(--b2)">│</span><span title="Ada di signals_daily tapi tidak ada di us_symbols_meta (kemungkinan delisted) — tanpa nama/sektor/mcap">'
      + x.no_meta + ' tanpa metadata</span>';
  }
  st.innerHTML = h;
}

function scrUsReadFilters() {
  SCR_US_FILTERS.forEach(function (f) {
    var el = document.getElementById('suf-' + f.k);
    if (el) SCR_US.f[f.k] = el.value.trim();
  });
  var q = document.getElementById('suf-q');
  if (q) SCR_US.f.q = q.value.trim();
}

function scrUsApply() {
  SCR_US.preset = -1;
  scrUsReadFilters();
  SCR_US.offset = 0;
  scrUsLoad();
}

// Reset state SAJA — tidak memuat. Pemanggil yang menentukan kapan fetch jalan,
// supaya tidak ada dua permintaan bersamaan (yang lama menang dan preset dibuang).
function scrUsClear() {
  SCR_US.f = { q: '', sector: '', min_price: 5, min_mcap: 1, max_rsi: '', min_rsi: '',
    min_dist200: '', max_dist200: '', min_ret20: '', max_ret20: '',
    trend_up: 0, cross200_up: 0, vol_spike: 0, break20: 0, preset: -1 };
  SCR_US.sort = 'ret_20d'; SCR_US.order = 'desc'; SCR_US.offset = 0;
}

function scrUsReset() {
  scrUsClear();
  SCR_US.preset = -1;
  scrUsRender();
  scrUsLoad();
}

function scrUsPreset(i) {
  var p = SCR_US_PRESETS[i];
  if (!p) return;
  scrUsClear();
  Object.keys(p.f).forEach(function (k) { SCR_US.f[k] = p.f[k]; });
  SCR_US.preset = i;
  scrUsRender();
  scrUsLoad();
}

function scrUsFlag(k) {
  SCR_US.preset = -1;
  SCR_US.f[k] = SCR_US.f[k] ? 0 : 1;
  scrUsRender();
  scrUsLoad();
}

function scrUsSort(k) {
  if (SCR_US.sort === k) SCR_US.order = SCR_US.order === 'desc' ? 'asc' : 'desc';
  else { SCR_US.sort = k; SCR_US.order = (k === 'rsi14' || k === 'dist_ma200') ? 'asc' : 'desc'; }
  SCR_US.offset = 0;
  scrUsLoad();
}

var SCR_US_SEQ = 0;

async function scrUsLoad() {
  var mySeq = ++SCR_US_SEQ;
  SCR_US.loading = true;
  scrUsStatus();
  var res = document.getElementById('suf-results');
  if (res) res.innerHTML = '<div style="padding:18px;text-align:center;color:var(--t3);font-size:11px">Menyaring…</div>';
  var pg = document.getElementById('suf-pager');
  if (pg) pg.innerHTML = '';
  var f = SCR_US.f, qs = ['limit=' + SCR_US.limit, 'offset=' + SCR_US.offset,
    'sort=' + encodeURIComponent(SCR_US.sort), 'order=' + SCR_US.order];
  var map = { q: 'q', sector: 'sector', min_price: 'min_price', min_mcap: 'min_mcap',
    max_rsi: 'max_rsi', min_rsi: 'min_rsi', min_dist200: 'min_dist200', max_dist200: 'max_dist200',
    min_ret20: 'min_ret20', max_ret20: 'max_ret20' };
  Object.keys(map).forEach(function (k) {
    if (f[k] !== '' && f[k] !== null && f[k] !== undefined) qs.push(map[k] + '=' + encodeURIComponent(f[k]));
  });
  ['trend_up', 'cross200_up', 'vol_spike', 'break20'].forEach(function (k) {
    if (f[k]) qs.push('f_' + k + '=1');
  });

  try {
    SCR_US.lastUrl = '/api/us/screen?' + qs.join('&');
    var r = await fetch(SCR_US.lastUrl);
    var d = await r.json();
    if (mySeq !== SCR_US_SEQ) return;   // sudah ada permintaan lebih baru
    if (!d.ok) throw new Error(d.error || 'gagal');
    SCR_US.rows = d.rows || [];
    SCR_US.total = d.total || 0;
    SCR_US.universe = d.universe || 0;
    SCR_US.as_of = d.as_of;
    SCR_US.excluded = d.excluded || null;
    SCR_US.sectors = d.sectors || [];
    SCR_US.loading = false;
    scrUsStatus();
    scrUsTable();
  } catch (e) {
    if (mySeq !== SCR_US_SEQ) return;
    SCR_US.loading = false;
    scrUsStatus();
    if (res) res.innerHTML = '<div style="padding:18px;color:var(--rd);font-size:11px">Gagal memuat: ' + e.message + '</div>';
  }
}

var SCR_US_COLS = [
  { k: 'code', l: '#', w: 34, f: function (r, i) { return '<span style="color:var(--t3)">' + (i + 1 + SCR_US.offset) + '</span>'; } },
  { k: 'code', l: 'Kode', w: 62, f: function (r) { return '<b>' + r.code + '</b>'; } },
  { k: 'name', l: 'Nama', w: 180, f: function (r) { return '<span title="' + (r.name || '') + '">' + ((r.name || '').slice(0, 32)) + '</span>'; } },
  { k: 'sector', l: 'Sektor', w: 130, f: function (r) { return r.sector ? r.sector : '<span style="color:var(--am)" title="us_symbols_meta tidak punya sektor">—</span>'; } },
  { k: 'last', l: 'Harga $', w: 74, ar: 1, f: function (r) { return scrUsNum(r.last); } },
  { k: 'ret_1d', l: '1D', w: 66, ar: 1, f: function (r) { return scrUsPct(r.ret_1d); } },
  { k: 'ret_5d', l: '5D', w: 66, ar: 1, f: function (r) { return scrUsPct(r.ret_5d); } },
  { k: 'ret_20d', l: '20D', w: 66, ar: 1, f: function (r) { return scrUsPct(r.ret_20d); } },
  { k: 'mcap', l: 'Mcap $B', w: 78, ar: 1, f: function (r) { return scrUsNum(r.mcap_b); } },
  { k: 'rsi14', l: 'RSI', w: 52, ar: 1, f: function (r) { return scrUsNum(r.rsi14); } },
  { k: 'dist_ma200', l: 'vs200', w: 62, ar: 1, f: function (r) { return scrUsPct(r.dist_ma200); } },
  { k: 'vol_ratio', l: 'Vol×', w: 54, ar: 1, f: function (r) { return scrUsNum(r.vol_ratio); } },
  { k: null, l: 'Sinyal', w: 130, f: function (r) {
      var g = r.flags || {}, out = [];
      if (g.trend_up) out.push('<span style="color:var(--gn)">trend</span>');
      if (g.cross200_up) out.push('<span style="color:var(--bl)">cross200</span>');
      if (g.vol_spike) out.push('<span style="color:var(--am)">vol</span>');
      if (g.break20) out.push('<span style="color:var(--gn)">brk20</span>');
      return out.length ? out.join(' ') : '<span style="color:var(--t4)">—</span>';
  } }
];

function scrUsTable() {
  var el = document.getElementById('suf-results');
  if (!el) return;
  if (!SCR_US.rows.length) {
    el.innerHTML = '<div style="padding:22px;text-align:center;color:var(--t3);font-size:11px">'
      + 'Tidak ada emiten yang lolos filter ini. Coba longgarkan filter atau tekan Reset.</div>';
    return;
  }
  var h = '<table class="bei-tbl" style="font-size:10px"><thead><tr>';
  SCR_US_COLS.forEach(function (c) {
    var sorted = c.k && SCR_US.sort === c.k;
    var ar = sorted ? (SCR_US.order === 'desc' ? ' ▼' : ' ▲') : '';
    var st = 'padding:4px 6px;' + (c.w ? 'width:' + c.w + 'px;' : '') + (sorted ? 'color:var(--bl);' : '');
    if (c.k) {
      h += '<th class="' + (c.ar ? 'ar' : 'al') + '" style="' + st + 'cursor:pointer;user-select:none"'
        + ' onclick="scrUsSort(\'' + c.k + '\')">' + c.l + ar + '</th>';
    } else {
      h += '<th class="' + (c.ar ? 'ar' : 'al') + '" style="' + st + '">' + c.l + '</th>';
    }
  });
  h += '</tr></thead><tbody>';
  SCR_US.rows.forEach(function (r, i) {
    h += '<tr>';
    SCR_US_COLS.forEach(function (c) {
      h += '<td class="' + (c.ar ? 'ar' : 'al') + '" style="padding:3px 6px">' + c.f(r, i) + '</td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table>';

  el.innerHTML = h;
  scrUsPager();
}

// Paginasi tinggal di footer tetap: kalau ikut di dalam div yang menggulir, tombol
// "Berikutnya" hilang begitu tabel punya 100 baris dan harus digulir dulu ke dasar.
function scrUsPager() {
  var p = document.getElementById('suf-pager');
  if (!p) return;
  if (!SCR_US.rows.length) { p.innerHTML = '<span>Tidak ada baris.</span>'; return; }
  var from = SCR_US.offset + 1, to = SCR_US.offset + SCR_US.rows.length;
  var h = '<span>' + from + '–' + to + ' dari ' + SCR_US.total + '</span>';
  h += '<span style="flex:1"></span>';
  h += '<button class="afl-btn afl-btn-clear" ' + (SCR_US.offset === 0 ? 'disabled style="opacity:.35"' : '')
    + ' onclick="scrUsPage(-1)">← Sebelumnya</button>';
  h += '<button class="afl-btn afl-btn-clear" ' + (to >= SCR_US.total ? 'disabled style="opacity:.35"' : '')
    + ' onclick="scrUsPage(1)">Berikutnya →</button>';
  p.innerHTML = h;
}

function scrUsPage(dir) {
  var next = SCR_US.offset + dir * SCR_US.limit;
  if (next < 0 || next >= SCR_US.total) return;
  SCR_US.offset = next;
  scrUsLoad();
}
