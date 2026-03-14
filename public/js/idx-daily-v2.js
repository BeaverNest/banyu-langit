// ═══ IDX DAILY V2 — Unified Rankings + Activity Spike + Digest + Flow ═══
var idxView = 'digest'; // digest (default) | rankings | flow
var idxSort = 'value', idxDir = 'desc';
var idxData = null;
var idxFilter = '';
var idxSectorFilter = '';
var idxAvg = 20;
var idxSuspended = new Set(); // suspended stock codes

// Column ORDER + visibility — array defines display order (user can reorder via dropdown)
var idxColOrder = ['code','name','close','chg','value','freq','fnet','score','freq_spike','vol_spike','ma20','ma200','vol','fbuy','fsell','val_spike','fnet_spike','sector'];
var idxCols = {
  code:true, name:true, close:true, chg:true, value:true, vol:false,
  freq:true, fbuy:false, fsell:false, fnet:true, score:true,
  val_spike:false, freq_spike:false, vol_spike:false, fnet_spike:false,
  ma20:false, ma200:false, sector:false
};
var idxColLabels = {
  code:'Code', name:'Name', close:'Close', chg:'Chg%', value:'Value', vol:'Volume',
  freq:'Freq', fbuy:'F.Buy', fsell:'F.Sell', fnet:'F.Net', score:'Score',
  val_spike:'Val↑', freq_spike:'Freq↑', vol_spike:'Vol↑', fnet_spike:'FNet↑',
  ma20:'MA20', ma200:'MA200', sector:'Sector'
};

try { var _s = JSON.parse(localStorage.getItem('idxCols2')); if (_s) { idxCols = _s.vis; idxColOrder = _s.ord; } } catch(e){}
function saveIdxCols() { localStorage.setItem('idxCols2', JSON.stringify({vis:idxCols, ord:idxColOrder})); }

// ═══ MAIN LOAD ═══
var idxShellRendered = false;
var idxColToggleOpen = false;

async function loadIdxDaily() {
  var el = $('idx-content'); if (!el) return;
  idxShellRendered = false;
  el.innerHTML = '<div style="padding:12px">' + skelRows(10) + '</div>';
  try {
    var [r, sus] = await Promise.all([
      fetch('/api/idx/unified?avg=' + idxAvg),
      fetch('/api/idx/suspended').then(function(r){return r.json()}).catch(function(){return{codes:[]}})
    ]);
    idxData = await r.json();
    idxSuspended = new Set(sus.codes || []);
    renderIdxDaily();
  } catch (e) { el.innerHTML = '<div class="ne">Error: ' + e.message + '</div>'; }
}

// ═══ RENDER SHELL + BODY ═══
function renderIdxDaily() {
  var el = $('idx-content'); if (!el || !idxData) return;
  var d = idxData;

  if (!idxShellRendered || !$('idx-body')) {
    var h = '';
    h += '<div style="display:flex;gap:3px;padding:8px 12px;border-bottom:1px solid var(--b1);align-items:center;flex-wrap:wrap">';
    [{k:'digest',l:'📋 Digest'},{k:'rankings',l:'📊 Rankings'},{k:'flow',l:'🌊 Flow'}].forEach(function(v) {
      h += '<button class="bei-tab' + (idxView === v.k ? ' on' : '') + '" id="idx-vbtn-' + v.k + '" onclick="idxSwitchView(\'' + v.k + '\')" style="padding:5px 12px;font-size:11px">' + v.l + '</button>';
    });
    h += '<span style="flex:1"></span>';
    if (d.trade_date) h += '<span style="font-size:10px;color:var(--t3);font-family:var(--fm)">' + d.trade_date + '</span>';
    h += '</div>';

    h += '<div id="idx-filter-bar" style="display:' + (idxView === 'digest' ? 'none' : 'flex') + ';gap:6px;padding:6px 12px;border-bottom:1px solid var(--b1);align-items:center;flex-wrap:wrap">';
    h += '<input class="bei-filter-input" style="max-width:160px" id="idx-filter-input" placeholder="Filter ticker..." value="' + esc(idxFilter) + '" oninput="idxOnFilter(this.value)">';
    if (d.sectors && d.sectors.length) {
      h += '<select class="bei-filter-sel" style="max-width:180px" id="idx-sector-sel" onchange="idxSectorFilter=this.value;idxRenderBody()">';
      h += '<option value="">All Sectors</option>';
      d.sectors.forEach(function(s) { h += '<option value="' + esc(s) + '"' + (idxSectorFilter === s ? ' selected' : '') + '>' + esc(s) + '</option>'; });
      h += '</select>';
    }
    h += '<button class="bei-filter-clear" id="idx-clear-btn" style="display:' + (idxFilter || idxSectorFilter ? 'inline-block' : 'none') + '" onclick="idxClearFilters()">Clear</button>';
    h += '<span style="flex:1"></span>';
    h += '<span id="idx-avg-controls" style="display:' + (idxView === 'rankings' ? 'flex' : 'none') + ';align-items:center;gap:3px">';
    h += '<span style="font-size:10px;color:var(--t3)">Avg:</span>';
    [10,20,60].forEach(function(n) {
      h += '<button class="bei-sort-btn' + (idxAvg === n ? ' on' : '') + '" onclick="idxAvg=' + n + ';loadIdxDaily()" style="padding:2px 6px;font-size:9px">' + n + 'D</button>';
    });
    h += '</span>';
    h += '<button id="idx-cols-btn" class="bei-sort-btn" style="display:' + (idxView === 'rankings' ? 'inline-block' : 'none') + ';padding:2px 8px;font-size:9px" onclick="idxShowColToggle()">⚙ Cols</button>';
    h += '</div>';

    h += '<div id="idx-col-toggle" style="display:' + (idxColToggleOpen && idxView === 'rankings' ? 'block' : 'none') + ';padding:8px 12px;border-bottom:1px solid var(--b1)">';
    h += idxRenderColPanel();
    h += '</div>';

    h += '<div id="idx-body" style="flex:1;overflow-y:auto"></div>';
    el.innerHTML = h;
    idxShellRendered = true;
  }
  idxRenderBody();
}

function idxRenderColPanel() {
  var h = '<div style="display:flex;gap:3px;flex-wrap:wrap;align-items:center">';
  h += '<span style="font-size:10px;font-weight:700;color:var(--t3);margin-right:2px">Drag to reorder:</span>';
  idxColOrder.forEach(function(k) {
    h += '<span class="scr-col' + (idxCols[k] ? ' on' : '') + '" draggable="true" data-col="' + k + '" onclick="idxToggleCol(\'' + k + '\')" ondragstart="idxDragStart(event)" ondragover="idxDragOver(event)" ondrop="idxDrop(event)" style="font-size:9px;padding:2px 6px;cursor:grab;user-select:none">' + idxColLabels[k] + '</span>';
  });
  h += '<button class="bei-sort-btn" onclick="idxResetColOrder()" style="font-size:9px;padding:2px 6px;margin-left:4px">↺ Reset</button>';
  h += '</div>';
  return h;
}

// ═══ DRAG & DROP for column reorder ═══
var idxDragCol = null;

function idxDragStart(e) {
  idxDragCol = e.target.getAttribute('data-col');
  e.target.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
}

function idxDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  // Reset all borders first
  document.querySelectorAll('#idx-col-toggle [data-col]').forEach(function(el) { el.style.borderLeft = ''; });
  var target = e.target.closest('[data-col]');
  if (target && target.getAttribute('data-col') !== idxDragCol) target.style.borderLeft = '2px solid var(--bl)';
}

function idxDrop(e) {
  e.preventDefault();
  // Reset all styles
  document.querySelectorAll('#idx-col-toggle [data-col]').forEach(function(el) {
    el.style.opacity = '1';
    el.style.borderLeft = '';
  });

  var target = e.target.closest('[data-col]');
  if (!target || !idxDragCol) return;
  var dropCol = target.getAttribute('data-col');
  if (idxDragCol === dropCol) return;

  var arr = idxColOrder.slice();
  var fromIdx = arr.indexOf(idxDragCol);
  var toIdx = arr.indexOf(dropCol);
  if (fromIdx < 0 || toIdx < 0) return;

  arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, idxDragCol);
  idxColOrder = arr;
  idxDragCol = null;
  saveIdxCols();

  var panel = $('idx-col-toggle');
  if (panel) panel.innerHTML = idxRenderColPanel();
  idxRenderBody();
}

// Also support drag on table headers
function idxThDragStart(e) {
  idxDragCol = e.target.getAttribute('data-col');
  e.target.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
}

function idxThDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function idxThDrop(e) {
  e.preventDefault();
  var target = e.target.closest('[data-col]');
  document.querySelectorAll('.bei-tbl th[data-col]').forEach(function(el) { el.style.opacity = '1'; });
  if (!target || !idxDragCol) return;
  var dropCol = target.getAttribute('data-col');
  if (idxDragCol === dropCol) return;

  var arr = idxColOrder.slice();
  var fromIdx = arr.indexOf(idxDragCol);
  var toIdx = arr.indexOf(dropCol);
  if (fromIdx < 0 || toIdx < 0) return;

  arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, idxDragCol);
  idxColOrder = arr;
  idxDragCol = null;
  saveIdxCols();

  // Also refresh col panel if open
  var panel = $('idx-col-toggle');
  if (panel && idxColToggleOpen) panel.innerHTML = idxRenderColPanel();
  idxRenderBody();
}

function idxResetColOrder() {
  idxColOrder = ['code','name','close','chg','value','freq','fnet','score','freq_spike','vol_spike','ma20','ma200','vol','fbuy','fsell','val_spike','fnet_spike','sector'];
  saveIdxCols();
  var panel = $('idx-col-toggle'); if (panel) panel.innerHTML = idxRenderColPanel();
  idxRenderBody();
}

function idxToggleCol(k) {
  idxCols[k] = !idxCols[k]; saveIdxCols();
  var panel = $('idx-col-toggle'); if (panel) panel.innerHTML = idxRenderColPanel();
  idxRenderBody();
}

function idxSwitchView(v) {
  idxView = v;
  ['digest','rankings','flow'].forEach(function(k) { var btn = $('idx-vbtn-' + k); if (btn) btn.classList.toggle('on', k === v); });
  var fb = $('idx-filter-bar'); if (fb) fb.style.display = v === 'digest' ? 'none' : 'flex';
  var ct = $('idx-col-toggle'); if (ct) ct.style.display = (idxColToggleOpen && v === 'rankings') ? 'block' : 'none';
  var avg = $('idx-avg-controls'); if (avg) avg.style.display = v === 'rankings' ? 'flex' : 'none';
  var cb = $('idx-cols-btn'); if (cb) cb.style.display = v === 'rankings' ? 'inline-block' : 'none';
  idxRenderBody();
}

function idxShowColToggle() {
  idxColToggleOpen = !idxColToggleOpen;
  var el = $('idx-col-toggle');
  if (el) el.style.display = (idxColToggleOpen && idxView === 'rankings') ? 'block' : 'none';
}

var idxFilterDebounce;
function idxOnFilter(val) {
  idxFilter = val.toUpperCase();
  clearTimeout(idxFilterDebounce);
  idxFilterDebounce = setTimeout(function() {
    idxRenderBody();
    var btn = $('idx-clear-btn'); if (btn) btn.style.display = (idxFilter || idxSectorFilter) ? 'inline-block' : 'none';
  }, 150);
}
function idxClearFilters() {
  idxFilter = ''; idxSectorFilter = '';
  var inp = $('idx-filter-input'); if (inp) inp.value = '';
  var sel = $('idx-sector-sel'); if (sel) sel.value = '';
  var btn = $('idx-clear-btn'); if (btn) btn.style.display = 'none';
  idxRenderBody();
}

function idxRenderBody() {
  var body = $('idx-body'); if (!body || !idxData) return;
  if (idxView === 'digest') body.innerHTML = renderIdxDigest(idxData);
  else if (idxView === 'rankings') body.innerHTML = renderIdxRankings(idxData);
  else if (idxView === 'flow') body.innerHTML = renderIdxFlow(idxData);
}

function idxFilteredData() {
  if (!idxData || !idxData.data) return [];
  var data = idxData.data;
  if (idxFilter) data = data.filter(function(r) { return r.code.includes(idxFilter); });
  if (idxSectorFilter) data = data.filter(function(r) { return r.sector === idxSectorFilter; });
  return data;
}

// ═══ 1. DIGEST — Dashboard cards (mockup layout) ═══
function renderIdxDigest(d) {
  var s = d.summary || {};
  var data = d.data || [];
  var h = '<div style="padding:12px">';

  h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">';
  [{l:'Total Stocks',v:s.total_stocks||0,c:''},{l:'Advancers',v:s.advancers||0,c:'up'},{l:'Decliners',v:s.decliners||0,c:'dn'},{l:'Unchanged',v:s.unchanged||0,c:''},{l:'Total Value',v:fmtRp(s.total_value||0),c:''},{l:'F.Net (IDR)',v:fmtRp(s.total_fnet_val||0),c:(s.total_fnet_val||0)>0?'up':'dn'},{l:'F.Buy Stocks',v:s.foreign_buy_stocks||0,c:'up'},{l:'F.Sell Stocks',v:s.foreign_sell_stocks||0,c:'dn'}].forEach(function(c) {
    h += '<div class="bd-card"><div class="bd-card-label">' + c.l + '</div><div class="bd-card-val"><span class="' + c.c + '">' + c.v + '</span></div></div>';
  });
  h += '</div>';

  // ═══ MACRO FOREIGN vs DOMESTIC FLOW CHART ═══
  h += '<div id="macro-flow-chart" style="margin-bottom:14px;border:1px solid var(--b1);border-radius:8px;background:var(--bg2);padding:10px 12px"><div style="font-size:10px;color:var(--t3)">Loading macro flow...</div></div>';
  setTimeout(loadMacroFlowChart, 50);

  var gainers = data.filter(function(r){return r.change_pct>0;}).sort(function(a,b){return b.change_pct-a.change_pct;}).slice(0,8);
  var losers = data.filter(function(r){return r.change_pct<0;}).sort(function(a,b){return a.change_pct-b.change_pct;}).slice(0,8);
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">';
  h += idxDigestCard('▲ Top Gainer', 'var(--gn)', gainers, function(r){ return '<span class="up" style="font-family:var(--fm)">+' + r.change_pct.toFixed(2) + '%</span>'; });
  h += idxDigestCard('▼ Top Loser', 'var(--rd)', losers, function(r){ return '<span class="dn" style="font-family:var(--fm)">' + r.change_pct.toFixed(2) + '%</span>'; });
  h += '</div>';

  if (d.sector_spikes && d.sector_spikes.length) {
    h += '<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:10px;padding:10px 12px;margin-bottom:14px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:8px">🔥 Sector Activity</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px">';
    var maxScore = Math.max.apply(null, d.sector_spikes.map(function(s){return s.avg_score;}))||1;
    d.sector_spikes.forEach(function(s) {
      var intensity = Math.min(1, s.avg_score / maxScore);
      var bg = s.avg_score >= 2 ? 'rgba(34,197,94,' + Math.max(0.05, intensity*0.3) + ')' : s.avg_score >= 1.5 ? 'rgba(245,158,11,' + Math.max(0.05, intensity*0.2) + ')' : 'var(--bgH)';
      h += '<div style="padding:6px 10px;border-radius:6px;border:1px solid var(--b1);background:' + bg + ';cursor:pointer" onclick="idxSectorFilter=\'' + esc(s.sector) + '\';idxSwitchView(\'rankings\')">';
      h += '<div style="font-weight:600;font-size:11px">' + esc(s.sector) + '</div>';
      h += '<div style="font-size:10px;color:var(--t2)">Score: <b style="font-family:var(--fm)">' + s.avg_score + 'x</b> · ' + s.count + ' stocks</div></div>';
    });
    h += '</div></div>';
  }

  var byValue = data.slice().sort(function(a,b){return(b.value||0)-(a.value||0);}).slice(0,8);
  var byFreq = data.slice().sort(function(a,b){return(b.frequency||0)-(a.frequency||0);}).slice(0,8);
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">';
  h += idxDigestCard('💰 Most Active (Value)', 'var(--bl)', byValue, function(r){ return '<span style="font-family:var(--fm);color:var(--t2)">' + fmtRp(r.value||0) + '</span>'; });
  h += idxDigestCard('⚡ Most Transaksi (Freq)', 'var(--am)', byFreq, function(r){ return '<span style="font-family:var(--fm);color:var(--t2)">' + fmtNum(r.frequency||0) + '</span>'; });
  h += '</div>';

  var dig = d.digest || {};
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">';
  if (dig.top_buy && dig.top_buy.length) {
    h += '<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:10px;padding:10px 12px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--gn);margin-bottom:6px">🟢 Top Foreign Buy</div>';
    dig.top_buy.forEach(function(r) {
      h += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer" onclick="gsOpen(\'' + esc(r.code) + '\')">';
      h += '<span class="code" style="min-width:45px">' + esc(r.code) + '</span>';
      h += '<span class="bd-tag buy">' + fmtRp(r.fnet_val) + '</span>';
      if (r.chg) h += '<span style="font-size:10px;color:' + (r.chg>0?'var(--gn)':'var(--rd)') + '">' + (r.chg>0?'+':'') + r.chg + '%</span>';
      h += '</div>';
    });
    h += '</div>';
  }
  if (dig.top_sell && dig.top_sell.length) {
    h += '<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:10px;padding:10px 12px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--rd);margin-bottom:6px">🔴 Top Foreign Sell</div>';
    dig.top_sell.forEach(function(r) {
      h += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer" onclick="gsOpen(\'' + esc(r.code) + '\')">';
      h += '<span class="code" style="min-width:45px">' + esc(r.code) + '</span>';
      h += '<span class="bd-tag sell">' + fmtRp(r.fnet_val) + '</span>';
      if (r.chg) h += '<span style="font-size:10px;color:' + (r.chg>0?'var(--gn)':'var(--rd)') + '">' + (r.chg>0?'+':'') + r.chg + '%</span>';
      h += '</div>';
    });
    h += '</div>';
  }
  h += '</div>';

  if ((dig.spikes && dig.spikes.length) || (d.dormant && d.dormant.length)) {
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">';
    if (dig.spikes && dig.spikes.length) {
      h += '<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:10px;padding:10px 12px">';
      h += '<div style="font-size:11px;font-weight:700;color:var(--am);margin-bottom:6px">⚡ Volume Spikes</div>';
      dig.spikes.forEach(function(r) {
        h += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer" onclick="gsOpen(\'' + esc(r.code) + '\')">';
        h += '<span class="code" style="min-width:45px">' + esc(r.code) + '</span><span class="bd-tag spike">' + r.ratio + 'x vol</span>';
        if (r.chg) h += '<span style="font-size:10px;color:' + (r.chg>0?'var(--gn)':'var(--rd)') + '">' + (r.chg>0?'+':'') + r.chg + '%</span>';
        h += '</div>';
      });
      h += '</div>';
    }
    if (d.dormant && d.dormant.length) {
      h += '<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:10px;padding:10px 12px">';
      h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">💤→⚡ Dormant → Active (' + d.dormant.length + ')</div>';
      d.dormant.slice(0,8).forEach(function(r) {
        h += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer" onclick="gsOpen(\'' + esc(r.code) + '\')">';
        h += '<span class="code" style="min-width:45px">' + esc(r.code) + '</span><span class="bd-tag spike">' + r.freq_spike + 'x freq</span></div>';
      });
      h += '</div>';
    }
    h += '</div>';
  }
  h += '</div>';
  return h;
}

function idxDigestCard(title, color, items, renderVal) {
  var h = '<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:10px;overflow:hidden">';
  h += '<div style="padding:8px 12px;font-size:11px;font-weight:700;color:' + color + ';border-bottom:1px solid var(--b1)">' + title + '</div>';
  items.forEach(function(r, i) {
    h += '<div style="display:flex;align-items:center;gap:6px;padding:5px 12px;border-bottom:1px solid var(--b1);cursor:pointer;transition:background .1s" onmouseover="this.style.background=\'var(--bgH)\'" onmouseout="this.style.background=\'\'" onclick="gsOpen(\'' + esc(r.code) + '\')">';
    h += '<span style="font-size:10px;color:var(--t3);min-width:16px;font-family:var(--fm)">' + (i+1) + '</span>';
    h += '<span class="code" style="min-width:45px;font-size:12px">' + esc(r.code) + '</span>';
    h += '<span style="font-size:10px;color:var(--t2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.name||'') + '</span>';
    h += renderVal(r);
    h += '</div>';
  });
  h += '</div>';
  return h;
}

// ═══ 2. RANKINGS TABLE ═══
function renderIdxRankings(d) {
  var data = idxFilteredData().slice();
  data.sort(function(a,b) {
    var va = idxGetVal(a,idxSort), vb = idxGetVal(b,idxSort);
    if (typeof va === 'string') return idxDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return idxDir === 'asc' ? (va||0)-(vb||0) : (vb||0)-(va||0);
  });

  function sa(col) { return idxSort === col ? (idxDir === 'asc' ? ' ▲' : ' ▼') : ''; }
  function sc(col) { return 'idxSort=\'' + col + '\';idxDir=idxSort===\'' + col + '\'&&idxDir===\'desc\'?\'asc\':\'desc\';idxRenderBody()'; }
  var visibleCols = idxColOrder.filter(function(k){return idxCols[k];});

  var h = '<div style="font-size:10px;color:var(--t3);padding:4px 12px">' + data.length + ' stocks' + (d.total ? ' / ' + d.total + ' total' : '') + '</div>';
  h += '<div style="overflow:auto;max-height:calc(100vh - 260px)"><table class="bei-tbl" style="width:100%">';
  h += '<thead style="position:sticky;top:0;background:var(--bg1);z-index:1"><tr>';
  visibleCols.forEach(function(k) {
    var align = (k === 'code' || k === 'name' || k === 'sector') ? 'al' : 'ar';
    var sortKey = k === 'chg' ? 'change_pct' : k === 'fbuy' ? 'foreign_buy_val' : k === 'fsell' ? 'foreign_sell_val' : k === 'freq' ? 'frequency' : k === 'vol' ? 'volume' : k === 'fnet' ? 'fnet_val' : k;
    h += '<th class="' + align + '" data-col="' + k + '" draggable="true" ondragstart="idxThDragStart(event)" ondragover="idxThDragOver(event)" ondrop="idxThDrop(event)" style="cursor:pointer;user-select:none" onclick="' + sc(sortKey) + '">' + idxColLabels[k] + sa(sortKey) + '</th>';
  });
  h += '</tr></thead><tbody>';

  data.slice(0,200).forEach(function(r) {
    h += '<tr>';
    visibleCols.forEach(function(k) { h += idxRenderCell(k, r); });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  h += '<div style="font-size:9px;color:var(--t3);padding:4px 12px">Score = weighted spike (Val 30% + Freq 30% + Vol 20% + FNet 20%). 🟢 ≥3x 🟡 ≥2x. Avg: ' + (d.avg_days||20) + 'D</div>';
  return h;
}

function idxRenderCell(k, r) {
  function spikeClr(v) { return v >= 3 ? 'var(--gn)' : v >= 2 ? 'var(--am)' : 'var(--t2)'; }
  var chgCls = (r.change_pct||0)>0?'up':(r.change_pct||0)<0?'dn':'';
  var fCls = (r.fnet_val||0)>0?'up':(r.fnet_val||0)<0?'dn':'';
  if (k==='code') return '<td class="code al" onclick="gsOpen(\'' + esc(r.code) + '\')">' + esc(r.code) + (idxSuspended.has(r.code) ? ' <span style="font-size:7px;color:var(--rd);font-weight:700" title="Suspended">⚠</span>' : '') + '</td>';
  if (k==='name') return '<td class="al name" style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.name||'') + '</td>';
  if (k==='close') return '<td class="ar" style="font-family:var(--fm)">' + (r.close||0).toLocaleString() + '</td>';
  if (k==='chg') return '<td class="ar ' + chgCls + '" style="font-family:var(--fm)">' + ((r.change_pct||0)>0?'+':'') + (r.change_pct||0).toFixed(2) + '%</td>';
  if (k==='value') return '<td class="ar" style="font-family:var(--fm)">' + fmtRp(r.value||0) + '</td>';
  if (k==='vol') return '<td class="ar" style="font-family:var(--fm)">' + fmtNum(r.volume||0) + '</td>';
  if (k==='freq') return '<td class="ar" style="font-family:var(--fm)">' + fmtNum(r.frequency||0) + '</td>';
  if (k==='fbuy') return '<td class="ar" style="font-family:var(--fm)">' + fmtRp((r.foreign_buy||0)*(r.close||0)) + '</td>';
  if (k==='fsell') return '<td class="ar" style="font-family:var(--fm)">' + fmtRp((r.foreign_sell||0)*(r.close||0)) + '</td>';
  if (k==='fnet') return '<td class="ar ' + fCls + '" style="font-family:var(--fm);font-weight:600">' + fmtRp(r.fnet_val||0) + '</td>';
  if (k==='score') return '<td class="ar" style="font-family:var(--fm);font-weight:700;color:' + spikeClr(r.score||0) + '">' + (r.score?r.score+'x':'-') + '</td>';
  if (k==='val_spike') return '<td class="ar" style="font-family:var(--fm);color:' + spikeClr(r.val_spike||0) + '">' + (r.val_spike?r.val_spike+'x':'-') + '</td>';
  if (k==='freq_spike') return '<td class="ar" style="font-family:var(--fm);color:' + spikeClr(r.freq_spike||0) + '">' + (r.freq_spike?r.freq_spike+'x':'-') + '</td>';
  if (k==='vol_spike') return '<td class="ar" style="font-family:var(--fm);color:' + spikeClr(r.vol_spike||0) + '">' + (r.vol_spike?r.vol_spike+'x':'-') + '</td>';
  if (k==='fnet_spike') return '<td class="ar" style="font-family:var(--fm);color:' + spikeClr(r.fnet_spike||0) + '">' + (r.fnet_spike?r.fnet_spike+'x':'-') + '</td>';
  if (k==='ma20') return '<td class="ar" style="font-family:var(--fm);color:' + (r.close>(r.ma20||0)?'var(--gn)':'var(--t3)') + '">' + (r.ma20?r.ma20.toLocaleString():'-') + '</td>';
  if (k==='ma200') return '<td class="ar" style="font-family:var(--fm);color:' + (r.close>(r.ma200||0)?'var(--gn)':'var(--t3)') + '">' + (r.ma200?r.ma200.toLocaleString():'-') + '</td>';
  if (k==='sector') return '<td class="al" style="font-size:9px;color:var(--t2);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.sector||'') + '</td>';
  return '<td>-</td>';
}

function idxGetVal(r, field) {
  if (field === 'code') return r.code || '';
  if (field === 'name') return r.name || '';
  if (field === 'sector') return r.sector || '';
  if (field === 'foreign_buy_val') return (r.foreign_buy||0) * (r.close||0);
  if (field === 'foreign_sell_val') return (r.foreign_sell||0) * (r.close||0);
  return r[field] || 0;
}

// ═══ 3. FLOW — draggable columns, sortable, clickable ═══
var idxFlowDays = 5, idxFlowDir = 'desc', idxFlowData = null;
var flowSort = 'net_flow_val', flowDir = 'desc';
var flowColOrder = ['code','name','last_close','flow_bar','net_flow_val','net_flow_shares','total_buy_val','total_sell_val','buy_days'];
var flowCols = { code:true, name:true, last_close:true, flow_bar:true, net_flow_val:true, net_flow_shares:true, total_buy_val:false, total_sell_val:false, buy_days:true };
var flowColLabels = { code:'Code', name:'Name', last_close:'Close', flow_bar:'Flow', net_flow_val:'Net (IDR)', net_flow_shares:'Net (Shares)', total_buy_val:'Buy (IDR)', total_sell_val:'Sell (IDR)', buy_days:'Buy Days' };
var flowColToggleOpen = false;
var flowDragCol = null;

try { var _fs = JSON.parse(localStorage.getItem('flowCols')); if (_fs) { flowCols = _fs.vis; flowColOrder = _fs.ord; } } catch(e){}
function saveFlowCols() { localStorage.setItem('flowCols', JSON.stringify({vis:flowCols, ord:flowColOrder})); }

function renderIdxFlow(d) {
  var h = '<div style="padding:12px">';
  h += '<div style="display:flex;gap:3px;align-items:center;margin-bottom:8px;flex-wrap:wrap">';
  h += '<span style="font-weight:700;font-size:13px">🌊 Foreign Flow Accumulation</span><span style="flex:1"></span>';
  h += '<span style="font-size:10px;color:var(--t3)">Period:</span>';
  [1,3,5,10,20].forEach(function(n) {
    h += '<button class="bei-sort-btn' + (idxFlowDays === n ? ' on' : '') + '" onclick="idxFlowDays=' + n + ';idxFlowData=null;idxRenderBody()" style="padding:2px 7px;font-size:10px">' + n + 'D</button>';
  });
  h += '<button class="bei-sort-btn' + (idxFlowDir === 'desc' ? ' on' : '') + '" onclick="idxFlowDir=\'desc\';idxFlowData=null;idxRenderBody()" style="padding:2px 7px;font-size:10px">🟢 Buy</button>';
  h += '<button class="bei-sort-btn' + (idxFlowDir === 'asc' ? ' on' : '') + '" onclick="idxFlowDir=\'asc\';idxFlowData=null;idxRenderBody()" style="padding:2px 7px;font-size:10px">🔴 Sell</button>';
  h += '<button class="bei-sort-btn" onclick="flowToggleColPanel()" style="padding:2px 8px;font-size:9px">⚙ Cols</button>';
  h += '</div>';
  // Column toggle panel
  h += '<div id="flow-col-toggle" style="display:' + (flowColToggleOpen ? 'flex' : 'none') + ';gap:3px;flex-wrap:wrap;align-items:center;margin-bottom:8px">';
  h += '<span style="font-size:10px;font-weight:700;color:var(--t3);margin-right:2px">Drag to reorder:</span>';
  flowColOrder.forEach(function(k) {
    h += '<span class="scr-col' + (flowCols[k] ? ' on' : '') + '" draggable="true" data-fcol="' + k + '" onclick="flowToggleCol(\'' + k + '\')" ondragstart="flowChipDragStart(event)" ondragover="flowChipDragOver(event)" ondrop="flowChipDrop(event)" style="font-size:9px;padding:2px 6px;cursor:grab;user-select:none">' + flowColLabels[k] + '</span>';
  });
  h += '<button class="bei-sort-btn" onclick="flowResetCols()" style="font-size:9px;padding:2px 6px">↺</button>';
  h += '</div>';
  h += '<div id="idx-flow-tbl">' + skelRows(8) + '</div></div>';
  // Use cached data if available, otherwise fetch
  if (idxFlowData) setTimeout(renderFlowTbl, 10);
  else setTimeout(loadIdxFlow, 50);
  return h;
}

function flowToggleColPanel() {
  flowColToggleOpen = !flowColToggleOpen;
  var el = $('flow-col-toggle'); if (el) el.style.display = flowColToggleOpen ? 'flex' : 'none';
}
function flowToggleCol(k) {
  flowCols[k] = !flowCols[k]; saveFlowCols();
  // Refresh chips
  var panel = $('flow-col-toggle');
  if (panel) {
    var h = '<span style="font-size:10px;font-weight:700;color:var(--t3);margin-right:2px">Drag to reorder:</span>';
    flowColOrder.forEach(function(k2) {
      h += '<span class="scr-col' + (flowCols[k2] ? ' on' : '') + '" draggable="true" data-fcol="' + k2 + '" onclick="flowToggleCol(\'' + k2 + '\')" ondragstart="flowChipDragStart(event)" ondragover="flowChipDragOver(event)" ondrop="flowChipDrop(event)" style="font-size:9px;padding:2px 6px;cursor:grab;user-select:none">' + flowColLabels[k2] + '</span>';
    });
    h += '<button class="bei-sort-btn" onclick="flowResetCols()" style="font-size:9px;padding:2px 6px">↺</button>';
    panel.innerHTML = h;
  }
  renderFlowTbl();
}
function flowResetCols() {
  flowColOrder = ['code','name','last_close','flow_bar','net_flow_val','net_flow_shares','total_buy_val','total_sell_val','buy_days'];
  flowCols = { code:true, name:true, last_close:true, flow_bar:true, net_flow_val:true, net_flow_shares:true, total_buy_val:false, total_sell_val:false, buy_days:true };
  saveFlowCols(); flowToggleCol('code'); // triggers refresh
}

// Drag for flow chips
function flowChipDragStart(e) { flowDragCol = e.target.getAttribute('data-fcol'); e.target.style.opacity = '0.4'; e.dataTransfer.effectAllowed = 'move'; }
function flowChipDragOver(e) {
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('#flow-col-toggle [data-fcol]').forEach(function(el) { el.style.borderLeft = ''; });
  var t = e.target.closest('[data-fcol]');
  if (t && t.getAttribute('data-fcol') !== flowDragCol) t.style.borderLeft = '2px solid var(--bl)';
}
function flowChipDrop(e) {
  e.preventDefault();
  document.querySelectorAll('#flow-col-toggle [data-fcol]').forEach(function(el) { el.style.opacity = '1'; el.style.borderLeft = ''; });
  var t = e.target.closest('[data-fcol]');
  if (!t || !flowDragCol) return;
  var dropCol = t.getAttribute('data-fcol');
  if (flowDragCol === dropCol) return;
  var arr = flowColOrder.slice(), fi = arr.indexOf(flowDragCol), ti = arr.indexOf(dropCol);
  if (fi < 0 || ti < 0) return;
  arr.splice(fi, 1); arr.splice(ti, 0, flowDragCol);
  flowColOrder = arr; flowDragCol = null; saveFlowCols();
  flowToggleCol('code'); // triggers refresh
}

// Drag for flow table headers
function flowThDragStart(e) { flowDragCol = e.target.getAttribute('data-fcol'); e.target.style.opacity = '0.4'; e.dataTransfer.effectAllowed = 'move'; }
function flowThDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function flowThDrop(e) {
  e.preventDefault();
  document.querySelectorAll('.bei-tbl th[data-fcol]').forEach(function(el) { el.style.opacity = '1'; });
  var t = e.target.closest('[data-fcol]');
  if (!t || !flowDragCol) return;
  var dropCol = t.getAttribute('data-fcol');
  if (flowDragCol === dropCol) return;
  var arr = flowColOrder.slice(), fi = arr.indexOf(flowDragCol), ti = arr.indexOf(dropCol);
  if (fi < 0 || ti < 0) return;
  arr.splice(fi, 1); arr.splice(ti, 0, flowDragCol);
  flowColOrder = arr; flowDragCol = null; saveFlowCols();
  if ($('flow-col-toggle') && flowColToggleOpen) flowToggleCol('code');
  else renderFlowTbl();
}

async function loadIdxFlow() {
  var el = $('idx-flow-tbl'); if (!el) return;
  el.innerHTML = skelRows(8);
  try {
    var r = await fetch('/api/idx/foreign?days=' + idxFlowDays + '&dir=' + idxFlowDir + '&limit=9999');
    idxFlowData = await r.json();
    renderFlowTbl();
  } catch(e) { el.innerHTML = '<div class="ne">Error: ' + e.message + '</div>'; }
}

function renderFlowTbl() {
  var el = $('idx-flow-tbl'); if (!el || !idxFlowData) return;
  var d = idxFlowData;
  if (!d.data || !d.data.length) { el.innerHTML = '<div class="ne">No flow data</div>'; return; }
  var data = d.data.slice();

  // Apply ticker filter
  if (idxFilter) data = data.filter(function(r) { return r.code.includes(idxFilter); });

  // Apply sector filter (lookup from idxData)
  if (idxSectorFilter && idxData && idxData.data) {
    var sectorMap = {};
    idxData.data.forEach(function(r) { if (r.sector) sectorMap[r.code] = r.sector; });
    data = data.filter(function(r) { return sectorMap[r.code] === idxSectorFilter; });
  }

  data.sort(function(a,b) { var va=a[flowSort]||0, vb=b[flowSort]||0; return flowDir==='asc'?va-vb:vb-va; });
  var maxAbs = Math.max.apply(null, data.map(function(r){ return Math.abs(r.net_flow_val||0); }))||1;

  function fsa(col) { return flowSort===col?(flowDir==='asc'?' ▲':' ▼'):''; }
  function fsc(col) { return 'flowSort=\''+col+'\';flowDir=flowSort===\''+col+'\'&&flowDir===\'desc\'?\'asc\':\'desc\';renderFlowTbl()'; }

  var visCols = flowColOrder.filter(function(k){ return flowCols[k]; });

  var h = '<div style="font-size:10px;color:var(--t3);margin-bottom:4px">' + data.length + ' stocks' + (data.length !== d.data.length ? ' (filtered)' : '') + ' · ' + d.days_actual + ' days</div>';
  h += '<div style="overflow:auto;max-height:calc(100vh - 300px)"><table class="bei-tbl" style="width:100%">';
  h += '<thead style="position:sticky;top:0;background:var(--bg1);z-index:1"><tr>';

  visCols.forEach(function(k) {
    var align = (k === 'code' || k === 'name') ? 'al' : k === 'flow_bar' ? '' : 'ar';
    var sortable = k !== 'flow_bar' && k !== 'code' && k !== 'name';
    var thStyle = 'cursor:pointer;user-select:none';
    if (k === 'flow_bar') thStyle += ';width:110px;text-align:center';
    h += '<th class="' + align + '" data-fcol="' + k + '" draggable="true" ondragstart="flowThDragStart(event)" ondragover="flowThDragOver(event)" ondrop="flowThDrop(event)" style="' + thStyle + '"';
    if (sortable) h += ' onclick="' + fsc(k) + '"';
    h += '>' + flowColLabels[k] + (sortable ? fsa(k) : '') + '</th>';
  });
  h += '</tr></thead><tbody>';

  data.forEach(function(r) {
    var fnv = r.net_flow_val||0, cls = fnv>0?'up':fnv<0?'dn':'';
    var pct = maxAbs ? Math.min(90, Math.abs(fnv)/maxAbs*90) : 0;
    var bdCls = r.buy_days===r.trade_days?'up':r.buy_days===0?'dn':'';

    h += '<tr style="cursor:pointer" onclick="gsOpen(\'' + esc(r.code) + '\')">';
    visCols.forEach(function(k) {
      if (k==='code') h += '<td class="code al">' + esc(r.code) + '</td>';
      else if (k==='name') h += '<td class="al name" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.name||'') + '</td>';
      else if (k==='last_close') h += '<td class="ar" style="font-family:var(--fm)">' + (r.last_close||0).toLocaleString() + '</td>';
      else if (k==='flow_bar') {
        h += '<td style="padding:4px 2px"><div class="tp-flow-bar"><div class="bar-neg">';
        if (fnv<0) h += '<div style="width:'+pct+'%;background:var(--rd);border-radius:2px;opacity:.8"></div>';
        h += '</div><div class="bar-mid"></div><div class="bar-pos">';
        if (fnv>0) h += '<div style="width:'+pct+'%;background:var(--gn);border-radius:2px;opacity:.8"></div>';
        h += '</div></div></td>';
      }
      else if (k==='net_flow_val') h += '<td class="ar '+cls+'" style="font-family:var(--fm);font-weight:600">' + fmtRp(fnv) + '</td>';
      else if (k==='net_flow_shares') h += '<td class="ar '+cls+'" style="font-family:var(--fm)">' + fmtNum(r.net_flow_shares||0) + '</td>';
      else if (k==='total_buy_val') h += '<td class="ar up" style="font-family:var(--fm)">' + fmtRp(r.total_buy_val||0) + '</td>';
      else if (k==='total_sell_val') h += '<td class="ar dn" style="font-family:var(--fm)">' + fmtRp(r.total_sell_val||0) + '</td>';
      else if (k==='buy_days') h += '<td class="ar '+bdCls+'" style="font-family:var(--fm)">' + r.buy_days + '/' + r.trade_days + '</td>';
      else h += '<td>-</td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  el.innerHTML = h;
}

// ═══ MACRO FOREIGN vs DOMESTIC FLOW CHART (ECharts) ═══
async function loadMacroFlowChart() {
  var el = document.getElementById('macro-flow-chart'); if (!el) return;
  try {
    var r = await fetch('/api/idx/macro-flow?days=30');
    var d = await r.json();
    if (!d.data || d.data.length < 3) { el.innerHTML = '<div style="font-size:10px;color:var(--t3)">No macro flow data.</div>'; return; }
    var data = d.data;
    var lastNet = data[data.length - 1].f_net;
    var lastClr = lastNet >= 0 ? 'var(--gn)' : 'var(--rd)';
    var h2 = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">';
    h2 += '<span style="font-size:11px;font-weight:700;color:var(--t1)">Foreign Net Flow</span>';
    h2 += '<span style="font-size:9px;color:var(--t3)">' + data.length + ' days</span>';
    h2 += '<span style="flex:1"></span>';
    h2 += '<span style="font-size:10px;font-weight:700;color:' + lastClr + '">' + fmtRp(lastNet) + '</span>';
    h2 += '</div>';
    h2 += BL.container('macro-flow-ec', 110);
    el.innerHTML = h2;
    // Deferred render
    setTimeout(function() {
      var cel = document.getElementById('macro-flow-ec'); if (!cel) return;
      var c = BL.init(cel, 'macro-flow'); if (!c) return;
      var dates = data.map(function(r) { return r.date; });
      var vals = data.map(function(r) { return r.f_net; });
      c.setOption({
        tooltip: { trigger: 'axis', formatter: function(p) { return '<b>' + p[0].axisValue + '</b><br>Net: <b>' + BL.fmtRp(p[0].value) + '</b>'; } },
        grid: { left: 50, right: 20, top: 8, bottom: 22, containLabel: false },
        xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 7, formatter: function(v) { return v.substring(5); }, interval: Math.max(0, Math.floor(data.length / 8) - 1) } },
        yAxis: { type: 'value', axisLabel: { fontSize: 7, formatter: function(v) { return BL.fmtRp(v); } }, splitLine: { lineStyle: { color: '#1e2836' } } },
        series: [{ type: 'bar', data: vals.map(function(v) { return { value: v, itemStyle: { color: v >= 0 ? BL.colors.green : BL.colors.red, opacity: 0.8 } }; }), barMaxWidth: 12 }]
      });
    }, 50);
  } catch (e) { el.innerHTML = '<div style="font-size:10px;color:var(--t3)">Macro flow: ' + e.message + '</div>'; }
}

// ═══ COMPAT ═══
function addWatchlistFrom(code) { fetch('/api/watchlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:code+'.JK'})}).catch(function(){}); }
function loadBei() { loadIdxDaily(); }
var beiStats = null;
async function loadAcData() {}