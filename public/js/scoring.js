// ═══ COMPOSITE SCORING — Multi-factor stock ranking ═══

var scrScoreData = null;
var scrScoreSort = 'score_composite', scrScoreDir = 'desc';
var scrScoreWeights = { fundamental: 25, valuation: 20, momentum: 20, demand: 20, foreign: 15 };
var scrScoreLoading = false;
var scrScoreColToggleOpen = false;

// Column order + visibility (same pattern as IDX Daily)
var scrScoreColOrder = [
  'code','name','close','chg','composite','fundamental','valuation','momentum','demand','foreign',
  'sector','industry','roe','roa','npm','der','per','pbv','per_vs_ind','pbv_vs_ind','div_yield',
  'ma5','ma10','ma20','ma50','ma200','ma5_pct','ma10_pct','ma20_pct','ma50_pct','ma200_pct',
  'rsi14','macd','macd_hist','ret_5d','ret_20d','fnet_5d','fnet_dir',
  'bid_offer_ratio','bid_offer_5d','rel_vol','freq_spike','val_spike',
  'fnet_10d','fnet_20d','foreign_pct_val','foreign_accum_streak','fnet_vs_avg','mktcap'
];
var scrScoreCols = {
  code:true, name:true, close:true, chg:true, composite:true, fundamental:true, valuation:true, momentum:true,
  demand:true, foreign:true,
  sector:true, industry:true, roe:false, roa:false, npm:false, der:false, per:false, pbv:false,
  per_vs_ind:false, pbv_vs_ind:false, div_yield:false,
  ma5:false, ma10:false, ma20:false, ma50:false, ma200:false,
  ma5_pct:false, ma10_pct:false, ma20_pct:false, ma50_pct:false, ma200_pct:false,
  rsi14:false, macd:false, macd_hist:false,
  ret_5d:false, ret_20d:false, fnet_5d:false, fnet_dir:false,
  bid_offer_ratio:false, bid_offer_5d:false, rel_vol:false, freq_spike:false, val_spike:false,
  fnet_10d:false, fnet_20d:false, foreign_pct_val:false, foreign_accum_streak:false, fnet_vs_avg:false, mktcap:false
};
var scrScoreColLabels = {
  code:'Code', name:'Name', close:'Close', chg:'Chg%', composite:'Composite', fundamental:'Fund', valuation:'Value', momentum:'Momentum',
  demand:'Demand', foreign:'Foreign',
  sector:'Sector', industry:'Industry', roe:'ROE', roa:'ROA', npm:'NPM', der:'DER', per:'PER', pbv:'PBV',
  per_vs_ind:'PER/Ind', pbv_vs_ind:'PBV/Ind', div_yield:'DivYld',
  ma5:'MA5', ma10:'MA10', ma20:'MA20', ma50:'MA50', ma200:'MA200',
  ma5_pct:'MA5%', ma10_pct:'MA10%', ma20_pct:'MA20%', ma50_pct:'MA50%', ma200_pct:'MA200%',
  rsi14:'RSI', macd:'MACD', macd_hist:'MACD.H',
  ret_5d:'Ret5d', ret_20d:'Ret20d', fnet_5d:'FNet5d', fnet_dir:'FDir',
  bid_offer_ratio:'B/O', bid_offer_5d:'B/O.5d', rel_vol:'RelVol', freq_spike:'Freq↑', val_spike:'Val↑',
  fnet_10d:'FNet10d', fnet_20d:'FNet20d', foreign_pct_val:'F%Val', foreign_accum_streak:'FStrk', fnet_vs_avg:'FSpike', mktcap:'MktCap'
};
var scrScoreColAlign = {
  code:'al', name:'al', sector:'al', industry:'al', fnet_dir:'al'
};

try { var _sc = JSON.parse(localStorage.getItem('scoreCols')); if (_sc) { scrScoreCols = _sc.vis; scrScoreColOrder = _sc.ord; } } catch(e){}
try { var _sw = JSON.parse(localStorage.getItem('scoreWeights')); if (_sw) scrScoreWeights = _sw; } catch(e){}
function saveScoreCols() { localStorage.setItem('scoreCols', JSON.stringify({vis:scrScoreCols, ord:scrScoreColOrder})); }

var scrScoreSubTab = 'scores'; // scores | ic | backfill

// ═══ MAIN ENTRY ═══
function loadScoring() {
  var el = $('scoring-content'); if (!el) return;
  renderScoringShell(el);
  if (scrScoreSubTab === 'scores') loadLastScores();
  else if (scrScoreSubTab === 'ic') loadICTracking();
  else if (scrScoreSubTab === 'backfill') renderBackfillUI();
}

function renderScoringShell(el) {
  var h = '';
  // ── Weight controls ──
  h += '<div style="padding:8px 12px;border-bottom:1px solid var(--b1);display:flex;gap:10px;align-items:center;flex-wrap:wrap">';
  h += '<span style="font-size:11px;font-weight:700;color:var(--t1)">Weights:</span>';
  ['fundamental','valuation','momentum','demand','foreign'].forEach(function(k) {
    var label = k === 'fundamental' ? '📊 Fund' : k === 'valuation' ? '💰 Value' : k === 'momentum' ? '📈 Mom' : k === 'demand' ? '🔥 Demand' : '🌐 Foreign';
    h += '<label style="display:flex;align-items:center;gap:3px;font-size:10px;color:var(--t2)">' + label;
    h += ' <input type="number" id="sw-' + k + '" value="' + scrScoreWeights[k] + '" min="0" max="100" step="5" style="width:36px;background:var(--bg0);border:1px solid var(--b1);border-radius:3px;padding:2px 3px;color:var(--t1);font-family:var(--fm);font-size:10px;text-align:center;outline:none">';
    h += '%</label>';
  });
  h += '<button onclick="calcScore()" style="padding:4px 12px;border-radius:4px;border:none;background:var(--bl);color:#fff;font-weight:700;font-size:10px;font-family:var(--f);cursor:pointer" id="score-calc-btn">▶ Calculate</button>';
  h += '<span id="score-status" style="font-size:10px;color:var(--t3)"></span>';
  h += '<span style="flex:1"></span>';
  h += '<button id="score-cols-btn" class="bei-sort-btn" style="padding:3px 8px;font-size:9px;display:' + (scrScoreSubTab === 'scores' ? 'inline-block' : 'none') + '" onclick="scoreToggleCols()">⚙ Cols</button>';
  h += '</div>';

  // ── Sub-tabs ──
  h += '<div style="display:flex;gap:3px;padding:6px 12px;border-bottom:1px solid var(--b1)">';
  [{k:'scores',l:'📊 Scores'},{k:'ic',l:'📈 IC Tracking'},{k:'backfill',l:'⏪ Backfill'}].forEach(function(t) {
    h += '<button class="bei-tab' + (scrScoreSubTab === t.k ? ' on' : '') + '" onclick="scrScoreSubTab=\'' + t.k + '\';loadScoring()" style="padding:4px 10px;font-size:10px">' + t.l + '</button>';
  });
  h += '</div>';

  // ── Column toggle panel ──
  h += '<div id="score-col-toggle" style="display:none;padding:6px 12px;border-bottom:1px solid var(--b1)">';
  h += scoreRenderColPanel();
  h += '</div>';

  // ── Body ──
  h += '<div id="score-body" style="flex:1;overflow-y:auto"></div>';
  el.innerHTML = h;
}

function scoreRenderColPanel() {
  var h = '<div style="display:flex;gap:3px;flex-wrap:wrap;align-items:center">';
  h += '<span style="font-size:9px;font-weight:700;color:var(--t3);margin-right:2px">Drag to reorder:</span>';
  scrScoreColOrder.forEach(function(k) {
    h += '<span class="scr-col' + (scrScoreCols[k] ? ' on' : '') + '" draggable="true" data-scol="' + k + '" onclick="scoreToggleCol(\'' + k + '\')" ondragstart="scoreDragStart(event)" ondragover="scoreDragOver(event)" ondrop="scoreDrop(event)" style="font-size:9px;padding:2px 6px;cursor:grab;user-select:none">' + scrScoreColLabels[k] + '</span>';
  });
  h += '<button class="bei-sort-btn" onclick="scoreResetCols()" style="font-size:9px;padding:2px 6px;margin-left:4px">↺ Reset</button>';
  h += '</div>';
  return h;
}

// ═══ COLUMN TOGGLE / DRAG & DROP ═══
function scoreToggleCols() {
  scrScoreColToggleOpen = !scrScoreColToggleOpen;
  var el = $('score-col-toggle'); if (el) el.style.display = scrScoreColToggleOpen ? 'block' : 'none';
}
function scoreToggleCol(k) {
  scrScoreCols[k] = !scrScoreCols[k]; saveScoreCols();
  var panel = $('score-col-toggle'); if (panel) panel.innerHTML = scoreRenderColPanel();
  scoreRenderTable();
}
function scoreResetCols() {
  scrScoreColOrder = ['code','name','close','chg','composite','fundamental','valuation','momentum','demand','foreign','sector','industry','roe','roa','npm','der','per','pbv','per_vs_ind','pbv_vs_ind','div_yield','ma5','ma10','ma20','ma50','ma200','ma5_pct','ma10_pct','ma20_pct','ma50_pct','ma200_pct','rsi14','macd','macd_hist','ret_5d','ret_20d','fnet_5d','fnet_dir','bid_offer_ratio','bid_offer_5d','rel_vol','freq_spike','val_spike','fnet_10d','fnet_20d','foreign_pct_val','foreign_accum_streak','fnet_vs_avg','mktcap'];
  scrScoreCols = {
    code:true, name:true, close:true, chg:true, composite:true, fundamental:true, valuation:true, momentum:true,
    demand:true, foreign:true,
    sector:true, industry:true, roe:false, roa:false, npm:false, der:false, per:false, pbv:false,
    per_vs_ind:false, pbv_vs_ind:false, div_yield:false,
    ma5:false, ma10:false, ma20:false, ma50:false, ma200:false,
    ma5_pct:false, ma10_pct:false, ma20_pct:false, ma50_pct:false, ma200_pct:false,
    rsi14:false, macd:false, macd_hist:false,
    ret_5d:false, ret_20d:false, fnet_5d:false, fnet_dir:false,
    bid_offer_ratio:false, bid_offer_5d:false, rel_vol:false, freq_spike:false, val_spike:false,
    fnet_10d:false, fnet_20d:false, foreign_pct_val:false, foreign_accum_streak:false, fnet_vs_avg:false, mktcap:false
  };
  saveScoreCols();
  var panel = $('score-col-toggle'); if (panel) panel.innerHTML = scoreRenderColPanel();
  scoreRenderTable();
}

var scoreDragCol = null;
function scoreDragStart(e) { scoreDragCol = e.target.getAttribute('data-scol'); e.target.style.opacity = '0.4'; e.dataTransfer.effectAllowed = 'move'; }
function scoreDragOver(e) {
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('#score-col-toggle [data-scol]').forEach(function(el) { el.style.borderLeft = ''; });
  var target = e.target.closest('[data-scol]');
  if (target && target.getAttribute('data-scol') !== scoreDragCol) target.style.borderLeft = '2px solid var(--bl)';
}
function scoreDrop(e) {
  e.preventDefault();
  document.querySelectorAll('#score-col-toggle [data-scol]').forEach(function(el) { el.style.opacity = '1'; el.style.borderLeft = ''; });
  var target = e.target.closest('[data-scol]'); if (!target || !scoreDragCol) return;
  var dropCol = target.getAttribute('data-scol'); if (scoreDragCol === dropCol) return;
  var arr = scrScoreColOrder.slice();
  var fromIdx = arr.indexOf(scoreDragCol), toIdx = arr.indexOf(dropCol);
  if (fromIdx < 0 || toIdx < 0) return;
  arr.splice(fromIdx, 1); arr.splice(toIdx, 0, scoreDragCol);
  scrScoreColOrder = arr; scoreDragCol = null; saveScoreCols();
  var panel = $('score-col-toggle'); if (panel) panel.innerHTML = scoreRenderColPanel();
  scoreRenderTable();
}
// Drag on table headers too
function scoreThDragStart(e) { scoreDragCol = e.target.getAttribute('data-scol'); e.target.style.opacity = '0.4'; e.dataTransfer.effectAllowed = 'move'; }
function scoreThDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function scoreThDrop(e) {
  e.preventDefault();
  document.querySelectorAll('#score-body th[data-scol]').forEach(function(el) { el.style.opacity = '1'; });
  var target = e.target.closest('[data-scol]'); if (!target || !scoreDragCol) return;
  var dropCol = target.getAttribute('data-scol'); if (scoreDragCol === dropCol) return;
  var arr = scrScoreColOrder.slice();
  var fromIdx = arr.indexOf(scoreDragCol), toIdx = arr.indexOf(dropCol);
  if (fromIdx < 0 || toIdx < 0) return;
  arr.splice(fromIdx, 1); arr.splice(toIdx, 0, scoreDragCol);
  scrScoreColOrder = arr; scoreDragCol = null; saveScoreCols();
  if (scrScoreColToggleOpen) { var panel = $('score-col-toggle'); if (panel) panel.innerHTML = scoreRenderColPanel(); }
  scoreRenderTable();
}

// ═══ CALCULATE SCORE ═══
async function calcScore() {
  var btn = $('score-calc-btn'); if (btn) { btn.disabled = true; btn.textContent = '⏳ Calculating...'; }
  var status = $('score-status'); if (status) status.textContent = 'Computing scores for all stocks...';
  scrScoreWeights.fundamental = parseInt($('sw-fundamental').value) || 25;
  scrScoreWeights.valuation = parseInt($('sw-valuation').value) || 20;
  scrScoreWeights.momentum = parseInt($('sw-momentum').value) || 20;
  scrScoreWeights.demand = parseInt($('sw-demand').value) || 20;
  scrScoreWeights.foreign = parseInt($('sw-foreign').value) || 15;
  localStorage.setItem('scoreWeights', JSON.stringify(scrScoreWeights));
  try {
    var r = await fetch('/api/idx/composite-score', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ w_fundamental: scrScoreWeights.fundamental, w_valuation: scrScoreWeights.valuation, w_momentum: scrScoreWeights.momentum, w_demand: scrScoreWeights.demand, w_foreign: scrScoreWeights.foreign })
    });
    scrScoreData = await r.json();
    if (status) status.textContent = scrScoreData.ok ? '✅ ' + scrScoreData.total_scored + ' stocks scored (' + scrScoreData.trade_date + ')' : '❌ ' + (scrScoreData.error || 'Error');
    scoreRenderTable();
  } catch (e) { if (status) status.textContent = '❌ ' + e.message; }
  if (btn) { btn.disabled = false; btn.textContent = '▶ Calculate'; }
}

// ═══ LOAD LAST SCORES (GET, no recalc) ═══
async function loadLastScores() {
  var status = $('score-status'); if (status) status.textContent = 'Loading...';
  try {
    var r = await fetch('/api/idx/composite-score');
    var d = await r.json();
    if (d.data && d.data.length) {
      scrScoreData = d;
      if (d.weights) {
        scrScoreWeights = d.weights;
        var ef = $('sw-fundamental'); if (ef) ef.value = d.weights.fundamental;
        var ev = $('sw-valuation'); if (ev) ev.value = d.weights.valuation;
        var em = $('sw-momentum'); if (em) em.value = d.weights.momentum;
        var ed = $('sw-demand'); if (ed) ed.value = d.weights.demand || 20;
        var efr = $('sw-foreign'); if (efr) efr.value = d.weights.foreign || 15;
      }
      if (status) status.textContent = d.data.length + ' stocks · ' + (d.trade_date || '');
      scoreRenderTable();
    } else {
      if (status) status.textContent = 'No scores yet. Click Calculate.';
      var body = $('score-body'); if (body) body.innerHTML = '<div class="ne" style="padding:30px">Click <b>▶ Calculate</b> to compute composite scores for top 100 liquid stocks.<br><br><span style="font-size:10px;color:var(--t3)">Scores based on: Fundamental (ROE/ROA/NPM/DER) · Valuation (PER/PBV vs industry) · Momentum (MA/RSI/MACD/Foreign flow)</span></div>';
    }
  } catch (e) { if (status) status.textContent = ''; }
}

// ═══ RENDER TABLE ═══
function scoreRenderTable() {
  var body = $('score-body'); if (!body || !scrScoreData || !scrScoreData.data) return;
  var data = scrScoreData.data.slice();

  // Sort
  var dir = scrScoreDir === 'desc' ? -1 : 1;
  var sortKey = scrScoreSort;
  var fieldMap = {
    code:'code', name:'name', close:'close', chg:'change_pct', composite:'score_composite',
    fundamental:'score_fundamental', valuation:'score_valuation', momentum:'score_momentum',
    demand:'score_demand', foreign:'score_foreign',
    sector:'sector', industry:'industry', roe:'roe', roa:'roa', npm:'npm', der:'der', per:'per', pbv:'pbv',
    per_vs_ind:'per_vs_ind', pbv_vs_ind:'pbv_vs_ind', div_yield:'div_yield',
    ma5:'ma5', ma10:'ma10', ma20:'ma20', ma50:'ma50', ma200:'ma200',
    ma5_pct:'ma5_pct', ma10_pct:'ma10_pct', ma20_pct:'ma20_pct', ma50_pct:'ma50_pct', ma200_pct:'ma200_pct',
    rsi14:'rsi14', macd:'macd', macd_hist:'macd_hist',
    ret_5d:'ret_5d', ret_20d:'ret_20d', fnet_5d:'fnet_5d', fnet_dir:'fnet_dir',
    bid_offer_ratio:'bid_offer_ratio', bid_offer_5d:'bid_offer_5d', rel_vol:'rel_vol', freq_spike:'freq_spike', val_spike:'val_spike',
    fnet_10d:'fnet_10d', fnet_20d:'fnet_20d', foreign_pct_val:'foreign_pct_val', foreign_accum_streak:'foreign_accum_streak', fnet_vs_avg:'fnet_vs_avg',
    mktcap:'market_cap'
  };
  var sf = fieldMap[sortKey] || 'score_composite';
  if (sf === 'code' || sf === 'name' || sf === 'sector' || sf === 'industry' || sf === 'fnet_dir') {
    data.sort(function(a, b) { return dir * (a[sf] || '').localeCompare(b[sf] || ''); });
  } else {
    data.sort(function(a, b) { return dir * ((b[sf] || 0) - (a[sf] || 0)); });
  }

  // Visible columns
  var visCols = scrScoreColOrder.filter(function(k) { return scrScoreCols[k]; });

  var h = '<table class="bei-tbl" style="font-size:10px"><thead><tr>';
  h += '<th style="width:24px;text-align:center;padding:3px 2px">#</th>';
  visCols.forEach(function(k) {
    var arrow = scrScoreSort === k ? (scrScoreDir === 'desc' ? ' ▼' : ' ▲') : '';
    var style = scrScoreSort === k ? 'color:var(--bl);' : '';
    var align = scrScoreColAlign[k] || 'ar';
    h += '<th class="' + align + '" style="cursor:pointer;user-select:none;' + style + '" draggable="true" data-scol="' + k + '" onclick="scoreDoSort(\'' + k + '\')" ondragstart="scoreThDragStart(event)" ondragover="scoreThDragOver(event)" ondrop="scoreThDrop(event)">' + scrScoreColLabels[k] + arrow + '</th>';
  });
  h += '</tr></thead><tbody>';

  data.forEach(function(r, i) {
    h += '<tr>';
    h += '<td style="text-align:center;font-size:9px;color:var(--t3);padding:3px 2px">' + (i + 1) + '</td>';
    visCols.forEach(function(k) {
      h += scoreRenderCell(k, r);
    });
    h += '</tr>';
  });
  h += '</tbody></table>';
  body.innerHTML = h;
}

function scoreDoSort(k) {
  if (scrScoreSort === k) scrScoreDir = scrScoreDir === 'desc' ? 'asc' : 'desc';
  else { scrScoreSort = k; scrScoreDir = 'desc'; }
  scoreRenderTable();
}

function scoreRenderCell(k, r) {
  var align = scrScoreColAlign[k] || 'ar';
  var base = 'padding:var(--cell-py) var(--cell-px);font-family:var(--fm);';

  if (k === 'code') return '<td class="al"><span class="code" onclick="gsOpen(\'' + esc(r.code) + '\')">' + esc(r.code) + '</span></td>';
  if (k === 'name') return '<td class="al name" style="font-size:9px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.name || '') + '</td>';
  if (k === 'close') return '<td class="ar" style="' + base + '">' + (r.close || 0).toLocaleString() + '</td>';
  if (k === 'chg') { var c = r.change_pct > 0 ? 'up' : r.change_pct < 0 ? 'dn' : ''; return '<td class="ar ' + c + '" style="' + base + '">' + (r.change_pct > 0 ? '+' : '') + (r.change_pct || 0).toFixed(2) + '%</td>'; }
  if (k === 'sector') return '<td class="al" style="font-size:9px">' + esc(r.sector || '') + '</td>';
  if (k === 'industry') return '<td class="al" style="font-size:9px">' + esc(r.industry || '') + '</td>';
  if (k === 'fnet_dir') {
    var dc = r.fnet_dir === 'strong_buy' || r.fnet_dir === 'buy' ? 'color:var(--gn)' : r.fnet_dir === 'strong_sell' || r.fnet_dir === 'sell' ? 'color:var(--rd)' : 'color:var(--t3)';
    var dl = (r.fnet_dir || '').replace('_', ' ');
    return '<td class="al" style="font-size:9px;' + dc + ';font-weight:600">' + dl + '</td>';
  }
  if (k === 'mktcap') return '<td class="ar" style="' + base + '">' + fmtRp(r.market_cap || 0) + '</td>';
  if (k === 'fnet_5d') { var fc = (r.fnet_5d || 0) > 0 ? 'up' : (r.fnet_5d || 0) < 0 ? 'dn' : ''; return '<td class="ar ' + fc + '" style="' + base + 'font-weight:600">' + fmtRp(r.fnet_5d || 0) + '</td>'; }

  // Score columns — color coded with background
  if (k === 'composite' || k === 'fundamental' || k === 'valuation' || k === 'momentum' || k === 'demand' || k === 'foreign') {
    var field = k === 'composite' ? 'score_composite' : k === 'fundamental' ? 'score_fundamental' : k === 'valuation' ? 'score_valuation' : k === 'momentum' ? 'score_momentum' : k === 'demand' ? 'score_demand' : 'score_foreign';
    var v = r[field] || 0;
    var hue = v >= 70 ? '142' : v >= 50 ? '45' : v >= 30 ? '25' : '0'; // green → yellow → orange → red
    var sat = Math.min(80, v) + '%';
    var bg = 'hsla(' + hue + ',' + sat + ',50%,' + (k === 'composite' ? '0.18' : '0.10') + ')';
    var fw = k === 'composite' ? 'font-weight:700;font-size:11px;' : '';
    return '<td class="ar" style="' + base + fw + 'background:' + bg + '">' + v.toFixed(1) + '</td>';
  }

  // Percentage columns
  if (k === 'roe' || k === 'roa' || k === 'npm') {
    var v2 = r[k] || 0; var c2 = v2 > 0 ? (v2 > 15 ? 'color:var(--gn)' : '') : 'color:var(--rd)';
    return '<td class="ar" style="' + base + c2 + '">' + v2.toFixed(1) + '%</td>';
  }
  if (k === 'der') { var d2 = r.der || 0; var c3 = d2 < 1 ? 'color:var(--gn)' : d2 > 2 ? 'color:var(--rd)' : ''; return '<td class="ar" style="' + base + c3 + '">' + d2.toFixed(2) + '</td>'; }
  if (k === 'per') return '<td class="ar" style="' + base + '">' + (r.per || 0).toFixed(1) + '</td>';
  if (k === 'pbv') return '<td class="ar" style="' + base + '">' + (r.pbv || 0).toFixed(2) + '</td>';
  if (k === 'per_vs_ind' || k === 'pbv_vs_ind') { var vr = r[k] || 0; var cr = vr < 0 ? 'color:var(--gn)' : vr > 30 ? 'color:var(--rd)' : ''; return '<td class="ar" style="' + base + cr + '">' + (vr > 0 ? '+' : '') + vr.toFixed(1) + '%</td>'; }
  if (k === 'div_yield') { var dy = r.div_yield || 0; return '<td class="ar" style="' + base + (dy > 3 ? 'color:var(--gn)' : '') + '">' + (dy ? dy.toFixed(2) + '%' : '-') + '</td>'; }

  // MA values
  if (k === 'ma5' || k === 'ma10' || k === 'ma20' || k === 'ma50' || k === 'ma200') return '<td class="ar" style="' + base + '">' + (r[k] || 0).toLocaleString() + '</td>';
  // MA % distance
  if (k.endsWith('_pct')) { var mp = r[k] || 0; var mc = mp > 0 ? 'color:var(--gn)' : mp < 0 ? 'color:var(--rd)' : ''; return '<td class="ar" style="' + base + mc + '">' + (mp > 0 ? '+' : '') + mp.toFixed(1) + '%</td>'; }
  // RSI
  if (k === 'rsi14') { var rs = r.rsi14 || 0; var rc = rs > 70 ? 'color:var(--rd)' : rs < 30 ? 'color:var(--gn)' : ''; return '<td class="ar" style="' + base + rc + '">' + rs.toFixed(1) + '</td>'; }
  // MACD
  if (k === 'macd') return '<td class="ar" style="' + base + '">' + (r.macd || 0).toFixed(0) + '</td>';
  if (k === 'macd_hist') { var mh = r.macd_hist || 0; var mhc = mh > 0 ? 'color:var(--gn)' : mh < 0 ? 'color:var(--rd)' : ''; return '<td class="ar" style="' + base + mhc + '">' + mh.toFixed(0) + '</td>'; }
  // Returns
  if (k === 'ret_5d' || k === 'ret_20d') { var rv = r[k] || 0; var rvc = rv > 0 ? 'color:var(--gn)' : rv < 0 ? 'color:var(--rd)' : ''; return '<td class="ar" style="' + base + rvc + '">' + (rv > 0 ? '+' : '') + rv.toFixed(2) + '%</td>'; }

  // Demand/Supply columns
  if (k === 'bid_offer_ratio' || k === 'bid_offer_5d') { var bo = r[k] || 0; var boc = bo > 0.6 ? 'color:var(--gn)' : bo < 0.4 ? 'color:var(--rd)' : ''; return '<td class="ar" style="' + base + boc + '">' + bo.toFixed(2) + '</td>'; }
  if (k === 'rel_vol' || k === 'freq_spike' || k === 'val_spike') { var sv = r[k] || 0; var svc = sv > 2 ? 'color:var(--gn);font-weight:600' : sv > 1.5 ? 'color:var(--am)' : ''; return '<td class="ar" style="' + base + svc + '">' + sv.toFixed(1) + 'x</td>'; }

  // Foreign Smart Money columns
  if (k === 'fnet_10d' || k === 'fnet_20d') { var fn2 = r[k] || 0; var fnc2 = fn2 > 0 ? 'color:var(--gn)' : fn2 < 0 ? 'color:var(--rd)' : ''; return '<td class="ar" style="' + base + fnc2 + '">' + fmtRp(fn2) + '</td>'; }
  if (k === 'foreign_pct_val') { var fp = r.foreign_pct_val || 0; return '<td class="ar" style="' + base + (fp > 30 ? 'color:var(--am)' : '') + '">' + fp.toFixed(1) + '%</td>'; }
  if (k === 'foreign_accum_streak') { var fas = r.foreign_accum_streak || 0; var fasc = fas >= 5 ? 'color:var(--gn);font-weight:600' : fas >= 3 ? 'color:var(--gn)' : ''; return '<td class="ar" style="' + base + fasc + '">' + fas + 'd</td>'; }
  if (k === 'fnet_vs_avg') { var fva = r.fnet_vs_avg || 0; var fvac = fva > 1.5 ? 'color:var(--gn)' : fva < -1.5 ? 'color:var(--rd)' : ''; return '<td class="ar" style="' + base + fvac + '">' + fva.toFixed(1) + 'x</td>'; }

  return '<td class="ar" style="' + base + '">-</td>';
}

// ═══ IC TRACKING UI ═══
var icHorizon = 5;

async function loadICTracking() {
  var body = $('score-body'); if (!body) return;
  body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--t3)">Loading IC data...</div>';
  try {
    var r = await fetch('/api/idx/ic-tracking?horizon=' + icHorizon + '&limit=120');
    var d = await r.json();
    if (d.error || !d.data || d.data.length < 2) {
      body.innerHTML = '<div class="ne" style="padding:30px">Not enough data for IC tracking.<br><br><span style="font-size:10px;color:var(--t3)">Need at least 2 days of scored data + ' + icHorizon + ' forward trading days.<br>Use ⏪ Backfill tab to generate historical scores first.</span></div>';
      return;
    }
    renderICView(body, d);
  } catch (e) { body.innerHTML = '<div class="ne">Error: ' + e.message + '</div>'; }
}

function renderICView(el, d) {
  var h = '<div style="padding:12px">';

  // Horizon selector
  h += '<div style="display:flex;gap:4px;align-items:center;margin-bottom:12px">';
  h += '<span style="font-size:10px;color:var(--t3);font-weight:600">Forward horizon:</span>';
  [5, 10, 20].forEach(function(n) {
    h += '<button class="bei-sort-btn' + (icHorizon === n ? ' on' : '') + '" onclick="icHorizon=' + n + ';loadICTracking()" style="padding:3px 8px;font-size:10px">' + n + 'D</button>';
  });
  h += '<span style="flex:1"></span>';
  h += '<span style="font-size:10px;color:var(--t3)">' + d.total_dates + ' data points</span>';
  h += '</div>';

  // Summary cards
  var s = d.summary || {};
  var icCls = s.avg_ic > 0.05 ? 'color:var(--gn)' : s.avg_ic < 0 ? 'color:var(--rd)' : 'color:var(--am)';
  var hrCls = s.avg_hit_rate > 55 ? 'color:var(--gn)' : s.avg_hit_rate < 45 ? 'color:var(--rd)' : '';
  var spCls = s.avg_spread > 0 ? 'color:var(--gn)' : s.avg_spread < 0 ? 'color:var(--rd)' : '';
  h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">';
  h += '<div class="bd-card"><div class="bd-card-label">Avg IC (Composite)</div><div class="bd-card-val"><span style="' + icCls + '">' + s.avg_ic.toFixed(4) + '</span></div></div>';
  h += '<div class="bd-card"><div class="bd-card-label">Avg Hit Rate (Top 20)</div><div class="bd-card-val"><span style="' + hrCls + '">' + s.avg_hit_rate.toFixed(1) + '%</span></div></div>';
  h += '<div class="bd-card"><div class="bd-card-label">Avg Spread (Top-Bot)</div><div class="bd-card-val"><span style="' + spCls + '">' + s.avg_spread.toFixed(2) + '%</span></div></div>';
  h += '<div class="bd-card"><div class="bd-card-label">Horizon</div><div class="bd-card-val">' + d.horizon + ' days</div></div>';
  h += '</div>';

  // IC interpretation
  h += '<div style="font-size:10px;color:var(--t2);margin-bottom:12px;padding:6px 10px;border-radius:4px;background:var(--bgH);border:1px solid var(--b1)">';
  if (s.avg_ic > 0.05) h += '✅ <b style="color:var(--gn)">Score is predictive.</b> Stocks with higher scores tend to outperform.';
  else if (s.avg_ic > 0) h += '⚠️ <b style="color:var(--am)">Weak predictive power.</b> Slight positive correlation. Consider adjusting weights.';
  else h += '❌ <b style="color:var(--rd)">Score is not predictive.</b> No correlation with forward returns. Model needs rework.';
  h += ' IC > 0.05 is good, > 0.10 is excellent for equity markets.';
  h += '</div>';

  // IC Time Series Chart (ECharts)
  var data = d.data;
  h += '<div style="border:1px solid var(--b1);border-radius:6px;overflow:hidden;background:var(--bg2);margin-bottom:6px">' + BL.container('ic-chart', 280) + '</div>';

  // Detail table
  h += '<div style="overflow-x:auto;max-height:300px;overflow-y:auto"><table class="bei-tbl" style="font-size:10px"><thead><tr>';
  h += '<th class="al">Date</th><th class="ar">IC Comp</th><th class="ar">IC Fund</th><th class="ar">IC Val</th><th class="ar">IC Mom</th><th class="ar">Hit%</th><th class="ar">Top20 Ret</th><th class="ar">Bot20 Ret</th><th class="ar">Spread</th><th class="ar">N</th>';
  h += '</tr></thead><tbody>';
  data.slice().reverse().forEach(function(r) {
    var icc = r.ic_composite > 0.05 ? 'up' : r.ic_composite < 0 ? 'dn' : '';
    var hrc = r.hit_rate > 55 ? 'up' : r.hit_rate < 45 ? 'dn' : '';
    var spc = r.spread > 0 ? 'up' : r.spread < 0 ? 'dn' : '';
    h += '<tr>';
    h += '<td class="al" style="font-family:var(--fm)">' + r.date + '</td>';
    h += '<td class="ar ' + icc + '" style="font-family:var(--fm);font-weight:600">' + r.ic_composite.toFixed(4) + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + r.ic_fundamental.toFixed(4) + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + r.ic_valuation.toFixed(4) + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + r.ic_momentum.toFixed(4) + '</td>';
    h += '<td class="ar ' + hrc + '" style="font-family:var(--fm)">' + r.hit_rate.toFixed(1) + '%</td>';
    h += '<td class="ar" style="font-family:var(--fm);color:' + (r.avg_ret_top20 > 0 ? 'var(--gn)' : 'var(--rd)') + '">' + (r.avg_ret_top20 > 0 ? '+' : '') + r.avg_ret_top20.toFixed(2) + '%</td>';
    h += '<td class="ar" style="font-family:var(--fm);color:' + (r.avg_ret_bot20 > 0 ? 'var(--gn)' : 'var(--rd)') + '">' + (r.avg_ret_bot20 > 0 ? '+' : '') + r.avg_ret_bot20.toFixed(2) + '%</td>';
    h += '<td class="ar ' + spc + '" style="font-family:var(--fm);font-weight:600">' + (r.spread > 0 ? '+' : '') + r.spread.toFixed(2) + '%</td>';
    h += '<td class="ar" style="font-family:var(--fm);color:var(--t3)">' + r.n + '</td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  h += '</div>';
  el.innerHTML = h;
  // Deferred ECharts render
  setTimeout(function(){ icRenderChart(d.data); }, 50);
}

function icRenderChart(data) {
  var el = $('ic-chart'); if (!el) return;
  var c = BL.init(el, 'ic-chart'); if (!c) return;
  var dates = data.map(function(r) { return r.date; });
  c.setOption({
    tooltip: { trigger: 'axis', formatter: function(p) {
      var h = '<b>' + p[0].axisValue + '</b>';
      p.forEach(function(s) { h += '<br><span style="color:' + s.color + '">●</span> ' + s.seriesName + ': <b>' + (typeof s.value === 'number' ? s.value.toFixed(4) : s.value) + '</b>'; });
      return h;
    }},
    legend: { data: ['Composite','Fund','Value','Momentum','Demand','Foreign'], top: 0, left: 0, textStyle: { fontSize: 9 } },
    grid: { left: 50, right: 20, top: 28, bottom: 44, containLabel: false },
    dataZoom: BL.dataZoom(),
    xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 7, formatter: function(v) { return v.substring(5); } } },
    yAxis: { type: 'value', scale: true, axisLabel: { fontSize: 8, formatter: function(v) { return v.toFixed(2); } },
      splitLine: { lineStyle: { color: '#1e2836' } } },
    series: [
      { name: 'Composite', type: 'line', data: data.map(function(r) { return r.ic_composite; }), symbol: 'none', lineStyle: { width: 2.5, color: '#e0e6ed' }, itemStyle: { color: '#e0e6ed' }, z: 10 },
      { name: 'Fund', type: 'line', data: data.map(function(r) { return r.ic_fundamental; }), symbol: 'none', lineStyle: { width: 1.5, color: BL.colors.blue }, itemStyle: { color: BL.colors.blue } },
      { name: 'Value', type: 'line', data: data.map(function(r) { return r.ic_valuation; }), symbol: 'none', lineStyle: { width: 1.5, color: BL.colors.amber }, itemStyle: { color: BL.colors.amber } },
      { name: 'Momentum', type: 'line', data: data.map(function(r) { return r.ic_momentum; }), symbol: 'none', lineStyle: { width: 1.5, color: BL.colors.green }, itemStyle: { color: BL.colors.green } },
      { name: 'Demand', type: 'line', data: data.map(function(r) { return r.ic_demand || 0; }), symbol: 'none', lineStyle: { width: 1.5, color: '#fc8452' }, itemStyle: { color: '#fc8452' } },
      { name: 'Foreign', type: 'line', data: data.map(function(r) { return r.ic_foreign || 0; }), symbol: 'none', lineStyle: { width: 1.5, color: '#73c0de' }, itemStyle: { color: '#73c0de' } }
    ]
  });
}
var backfillRunning = false;

function renderBackfillUI() {
  var body = $('score-body'); if (!body) return;
  var h = '<div style="padding:16px 12px">';
  h += '<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:8px">⏪ Backfill Historical Scores</div>';
  h += '<div style="font-size:10px;color:var(--t2);margin-bottom:14px;line-height:1.6">Compute composite scores for historical dates using current weights.<br>This enables IC tracking to validate scoring model quality.<br><span style="color:var(--am)">⚠ Note: Fundamental data uses latest snapshot (look-ahead bias for older dates). Momentum metrics are computed correctly per date.</span></div>';

  h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">';
  h += '<label style="font-size:10px;color:var(--t2)">From: <input type="date" id="bf-from" value="' + getDefaultFrom() + '" style="background:var(--bg0);border:1px solid var(--b1);border-radius:3px;padding:3px 6px;color:var(--t1);font-family:var(--fm);font-size:10px;outline:none"></label>';
  h += '<label style="font-size:10px;color:var(--t2)">To: <input type="date" id="bf-to" value="' + getDefaultTo() + '" style="background:var(--bg0);border:1px solid var(--b1);border-radius:3px;padding:3px 6px;color:var(--t1);font-family:var(--fm);font-size:10px;outline:none"></label>';
  h += '<button onclick="runBackfill()" id="bf-btn" style="padding:5px 14px;border-radius:4px;border:none;background:var(--bl);color:#fff;font-weight:700;font-size:11px;font-family:var(--f);cursor:pointer">▶ Run Backfill</button>';
  h += '</div>';

  // Quick presets
  h += '<div style="display:flex;gap:4px;margin-bottom:14px">';
  [{l:'Last 30 days', d:30},{l:'Last 60 days',d:60},{l:'Last 6 months',d:180},{l:'Last 1 year',d:365}].forEach(function(p) {
    h += '<button class="bei-sort-btn" onclick="setBackfillRange(' + p.d + ')" style="padding:3px 8px;font-size:9px">' + p.l + '</button>';
  });
  h += '</div>';

  h += '<div id="bf-status" style="font-size:10px;color:var(--t3);margin-bottom:12px"></div>';

  // Show existing scored dates
  h += '<div id="bf-dates" style="font-size:10px;color:var(--t3)">Loading scored dates...</div>';
  h += '</div>';
  body.innerHTML = h;
  loadScoredDates();
}

function getDefaultFrom() {
  var d = new Date(); d.setDate(d.getDate() - 60);
  return d.toISOString().split('T')[0];
}
function getDefaultTo() {
  return new Date().toISOString().split('T')[0];
}
function setBackfillRange(days) {
  var to = new Date();
  var from = new Date(); from.setDate(from.getDate() - days);
  var ef = document.getElementById('bf-from'); if (ef) ef.value = from.toISOString().split('T')[0];
  var et = document.getElementById('bf-to'); if (et) et.value = to.toISOString().split('T')[0];
}

async function runBackfill() {
  if (backfillRunning) return;
  var from = document.getElementById('bf-from').value;
  var to = document.getElementById('bf-to').value;
  if (!from || !to) return;
  var btn = document.getElementById('bf-btn');
  var status = document.getElementById('bf-status');
  backfillRunning = true;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Running...'; }
  if (status) status.innerHTML = '<span style="color:var(--am)">Computing scores for ' + from + ' to ' + to + '... This may take a while.</span>';

  var wF = parseInt(($('sw-fundamental') || {}).value) || scrScoreWeights.fundamental;
  var wV = parseInt(($('sw-valuation') || {}).value) || scrScoreWeights.valuation;
  var wM = parseInt(($('sw-momentum') || {}).value) || scrScoreWeights.momentum;

  try {
    var r = await fetch('/api/idx/composite-score/backfill', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ from: from, to: to, w_fundamental: wF, w_valuation: wV, w_momentum: wM })
    });
    var d = await r.json();
    if (d.ok) {
      if (status) status.innerHTML = '<span style="color:var(--gn)">✅ Done! ' + d.dates_processed + ' dates, ' + d.total_scored + ' scores saved (' + d.from + ' → ' + d.to + ')</span>';
    } else {
      if (status) status.innerHTML = '<span style="color:var(--rd)">❌ ' + (d.error || 'Error') + '</span>';
    }
    loadScoredDates();
  } catch (e) {
    if (status) status.innerHTML = '<span style="color:var(--rd)">❌ ' + e.message + '</span>';
  }
  backfillRunning = false;
  if (btn) { btn.disabled = false; btn.textContent = '▶ Run Backfill'; }
}

async function loadScoredDates() {
  var el = document.getElementById('bf-dates'); if (!el) return;
  try {
    var r = await fetch('/api/idx/composite-score/dates');
    var d = await r.json();
    if (!d.dates || !d.dates.length) { el.innerHTML = 'No scores computed yet.'; return; }
    var h = '<div style="margin-top:8px"><div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">' + d.dates.length + ' scored dates</div>';
    h += '<div style="display:flex;gap:3px;flex-wrap:wrap">';
    d.dates.slice(0, 60).forEach(function(r) {
      h += '<span style="font-size:8px;padding:2px 5px;border-radius:3px;background:var(--bgH);border:1px solid var(--b1);font-family:var(--fm);color:var(--t2)">' + r.calc_date.substring(5) + ' <span style="color:var(--t3)">' + r.stocks + '</span></span>';
    });
    if (d.dates.length > 60) h += '<span style="font-size:8px;color:var(--t3)">+' + (d.dates.length - 60) + ' more</span>';
    h += '</div></div>';
    el.innerHTML = h;
  } catch (e) { el.innerHTML = 'Error loading dates'; }
}