// ═══ SCREENING — metrik eksplisit, tanpa skor komposit ═══
//
// Kenapa dirombak: skor komposit (fundamental/valuation/momentum/demand/foreign)
// menyembunyikan asumsi — bobotnya manual, dan dua komponennya tidak punya padanan
// di pasar lain. Layar ini hanya menampilkan besaran yang bisa dihitung ulang dari
// data mentah: return, posisi terhadap MA, RSI, rasio volume, arus asing, dan
// rasio valuasi. Tidak ada angka gabungan, tidak ada bobot.
//
// Sumber: GET /api/idx/metrics (server menghitung & memformat 2 desimal).
// UI tidak menghitung apa pun kecuali menyusun baris.

var scrData = null;
var scrSort = 'ret_20d';
var scrOrder = 'desc';
var scrQ = '';
var scrSector = '';
var scrLimit = 100;

var SCR_COLS = [
  { k: 'code', l: 'Code', a: 'al' },
  { k: 'name', l: 'Name', a: 'al' },
  { k: 'close', l: 'Last', a: 'ar' },
  { k: 'chg', l: '1D', a: 'ar' },
  { k: 'ret_5d', l: '5D', a: 'ar' },
  { k: 'ret_20d', l: '20D', a: 'ar' },
  { k: 'ma20_pct', l: 'vs MA20', a: 'ar' },
  { k: 'ma200_pct', l: 'vs MA200', a: 'ar' },
  { k: 'rsi14', l: 'RSI', a: 'ar' },
  { k: 'rel_vol', l: 'RelVol', a: 'ar' },
  { k: 'fnet_5d', l: 'FNet 5D', a: 'ar' },
  { k: 'per', l: 'PER', a: 'ar' },
  { k: 'pbv', l: 'PBV', a: 'ar' },
  { k: 'roe', l: 'ROE', a: 'ar' },
  { k: 'mcap_t', l: 'MCap (T)', a: 'ar' },
  { k: 'sector', l: 'Sector', a: 'al' },
];

function scrNum(v, suffix) {
  if (v === null || v === undefined) return '<span style="color:var(--t3)">–</span>';
  var s = (Math.round(v * 100) / 100).toFixed(2);
  var col = '';
  if (suffix === '%') col = v > 0 ? 'color:var(--gn)' : (v < 0 ? 'color:var(--rd)' : '');
  return '<span style="' + col + '">' + s + (suffix || '') + '</span>';
}

function scrLoad() {
  var el = $('scoring-content'); if (!el) return;
  if (!$('scr-table')) {
    var h = '';
    h += '<div style="padding:10px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--b1)">';
    h += '<input id="scr-q" placeholder="cari kode / nama" oninput="scrQ=this.value;scrFetch()" style="width:180px;background:var(--bg0);border:1px solid var(--b1);border-radius:3px;padding:5px 8px;color:var(--t1);font-size:12px;outline:none">';
    h += '<select id="scr-sector" onchange="scrSector=this.value;scrFetch()" style="background:var(--bg0);border:1px solid var(--b1);border-radius:3px;padding:5px 6px;color:var(--t1);font-size:12px">';
    h += '<option value="">Semua sektor</option></select>';
    h += '<span style="font-size:11px;color:var(--t3)">metrik eksplisit · tanpa skor komposit</span>';
    h += '<span id="scr-meta" style="margin-left:auto;font-size:11px;color:var(--t3)"></span>';
    h += '</div>';
    h += '<div style="flex:1;overflow:auto"><table class="bei-tbl" style="font-size:12px" id="scr-table"><thead><tr>';
    SCR_COLS.forEach(function (c) {
      h += '<th class="' + c.a + '" style="cursor:pointer;user-select:none;white-space:nowrap" onclick="scrDoSort(\'' + c.k + '\')">' + c.l + '<span id="scr-ar-' + c.k + '"></span></th>';
    });
    h += '</tr></thead><tbody id="scr-body"><tr><td colspan="' + SCR_COLS.length + '" class="ne">Memuat…</td></tr></tbody></table></div>';
    el.innerHTML = h;
  }
  scrFetch();
}

function scrDoSort(k) {
  if (scrSort === k) scrOrder = (scrOrder === 'desc' ? 'asc' : 'desc');
  else { scrSort = k; scrOrder = 'desc'; }
  scrFetch();
}

async function scrFetch() {
  var body = $('scr-body'); if (!body) return;
  var url = '/api/idx/metrics?limit=' + scrLimit + '&sort=' + encodeURIComponent(scrSort) + '&order=' + scrOrder;
  if (scrQ) url += '&q=' + encodeURIComponent(scrQ);
  if (scrSector) url += '&sector=' + encodeURIComponent(scrSector);
  try {
    var r = await fetch(url);
    var d = await r.json();
    if (!d || d.ok === false) throw new Error((d && d.error) || 'payload gagal');
    scrData = d;
    scrRender(d);
    var meta = $('scr-meta');
    if (meta) meta.textContent = d.total + ' emiten · sesi ' + d.as_of + ' · fundamental ' + (d.fund_snapshot || '–') + ' · ' + d.ms + ' ms';
    var sel = $('scr-sector');
    if (sel && sel.options.length <= 1 && d.sectors) {
      d.sectors.forEach(function (s) {
        var o = document.createElement('option'); o.value = s.sector; o.textContent = s.sector + ' (' + s.n + ')'; sel.appendChild(o);
      });
    }
  } catch (e) {
    body.innerHTML = '<tr><td colspan="' + SCR_COLS.length + '" class="ne" style="color:var(--rd)">' + (e.message || 'gagal') + '</td></tr>';
  }
}

function scrRender(d) {
  var body = $('scr-body'); if (!body) return;
  SCR_COLS.forEach(function (c) { var a = $('scr-ar-' + c.k); if (a) a.textContent = (scrSort === c.k ? (scrOrder === 'desc' ? ' ▼' : ' ▲') : ''); });
  var rows = d.rows || [];
  if (!rows.length) { body.innerHTML = '<tr><td colspan="' + SCR_COLS.length + '" class="ne">tidak ada yang cocok</td></tr>'; return; }
  var h = '';
  rows.forEach(function (x) {
    h += '<tr>';
    h += '<td class="al" style="font-weight:600">' + scrEsc(x.code) + '</td>';
    h += '<td class="al" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + scrEsc(x.name || '') + '">' + scrEsc(x.name || '–') + '</td>';
    h += '<td class="ar">' + scrNum(x.close) + '</td>';
    h += '<td class="ar">' + scrNum(x.chg, '%') + '</td>';
    h += '<td class="ar">' + scrNum(x.ret_5d, '%') + '</td>';
    h += '<td class="ar">' + scrNum(x.ret_20d, '%') + '</td>';
    h += '<td class="ar">' + scrNum(x.ma20_pct, '%') + '</td>';
    h += '<td class="ar">' + scrNum(x.ma200_pct, '%') + '</td>';
    h += '<td class="ar">' + scrNum(x.rsi14) + '</td>';
    h += '<td class="ar">' + scrNum(x.rel_vol) + '</td>';
    h += '<td class="ar">' + scrNum(x.fnet_5d) + '</td>';
    h += '<td class="ar">' + scrNum(x.per) + '</td>';
    h += '<td class="ar">' + scrNum(x.pbv) + '</td>';
    h += '<td class="ar">' + scrNum(x.roe) + '</td>';
    h += '<td class="ar">' + scrNum(x.mcap_t) + '</td>';
    h += '<td class="al" style="color:var(--t2)">' + scrEsc(x.sector || '–') + '</td>';
    h += '</tr>';
  });
  body.innerHTML = h;
}

function scrEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

// Entry point yang dipanggil app.js saat tab "scoring" dibuka
function loadScoring() { scrLoad(); }
