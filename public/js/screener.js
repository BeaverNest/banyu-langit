// ═══ Screener V4 — Grouped columns, OR logic, drag-drop column reorder ═══
var scrRules = [];
var scrConfigs = [];
var scrResults = [];
var scrColumns = ['close','change_pct','volume','per','pbv','foreign_net_val','ma5','ma20','ma200'];
var scrEditId = null;
var scrSortCol = 'foreign_net_val';
var scrSortDir = 'desc';
var scrLogic = 'AND'; // AND | OR
var scrDragCol = null; // for drag-and-drop

// ═══ Field definitions — grouped ═══
var SCR_FIELDS = [
  {group:'Price',icon:'💰',items:[
    {k:'close',l:'Close Price',type:'num'},{k:'change_pct',l:'Change %',type:'num'}]},
  {group:'Volume',icon:'📊',items:[
    {k:'volume_lot',l:'Volume (lot)',type:'num'},{k:'value',l:'Value (IDR)',type:'num'},
    {k:'frequency',l:'Frequency',type:'num'},{k:'vol_spike',l:'Vol Spike (x avg)',type:'num'}]},
  {group:'Foreign Flow',icon:'🌍',items:[
    {k:'foreign_net_val',l:'Foreign Net (IDR)',type:'num'},{k:'fnet_streak',l:'Foreign Streak (days)',type:'num'}]},
  {group:'Moving Average',icon:'📈',items:[
    {k:'close_vs_ma5',l:'Close vs MA5',type:'compare'},{k:'close_vs_ma10',l:'Close vs MA10',type:'compare'},
    {k:'close_vs_ma20',l:'Close vs MA20',type:'compare'},{k:'close_vs_ma50',l:'Close vs MA50',type:'compare'},
    {k:'close_vs_ma100',l:'Close vs MA100',type:'compare'},{k:'close_vs_ma200',l:'Close vs MA200',type:'compare'}]},
  {group:'MACD',icon:'📉',items:[
    {k:'macd_hist',l:'MACD Histogram',type:'num'},
    {k:'macd_cross',l:'MACD Cross',type:'select',opts:[['golden','Golden Cross'],['death','Death Cross']]},
    {k:'macd_signal',l:'MACD vs Signal',type:'compare'}]},
  {group:'Stochastic',icon:'🔄',items:[
    {k:'stoch_k',l:'Stochastic %K',type:'num'},{k:'stoch_d',l:'Stochastic %D',type:'num'},
    {k:'stoch_zone',l:'Stoch Zone',type:'select',opts:[['oversold','Oversold (<20)'],['overbought','Overbought (>80)']]}]},
  {group:'Valuation',icon:'💎',items:[
    {k:'per',l:'PER',type:'num'},{k:'pbv',l:'PBV',type:'num'},{k:'mkt_cap',l:'Market Cap',type:'num'},
    {k:'total_rev',l:'Revenue',type:'num'}]},
  {group:'Profitability',icon:'📋',items:[
    {k:'roe',l:'ROE %',type:'num'},{k:'roa',l:'ROA %',type:'num'},
    {k:'der',l:'DER',type:'num'},{k:'npm',l:'NPM %',type:'num'},{k:'ytd',l:'YTD %',type:'num'}]},
  {group:'Classification',icon:'🏷',items:[
    {k:'sector',l:'Sector',type:'select',opts:[['Energy','Energy'],['Financials','Financials'],['Basic Materials','Basic Materials'],['Industrials','Industrials'],['Consumer Cyclicals','Consumer Cyclicals'],['Consumer Non-Cyclicals','Consumer Non-Cyclicals'],['Healthcare','Healthcare'],['Technology','Technology'],['Infrastructures','Infrastructures'],['Transportation & Logistic','Transport & Logistic'],['Properties & Real Estate','Properties & RE']]},
    {k:'idx_index',l:'Index Member',type:'select',opts:[['LQ45','LQ45'],['IDX30','IDX30'],['IDX80','IDX80'],['ISSI','ISSI'],['JII','JII'],['JII70','JII70'],['KOMPAS100','KOMPAS100'],['IDX-MES BUMN 17','MES BUMN'],['IDXV30','IDXV30']]}]},
];

// ═══ Column definitions — grouped for selector ═══
var SCR_COL_GROUPS = [
  {group:'Price',icon:'💰',cols:[
    {k:'close',l:'Close'},{k:'change_pct',l:'Chg%'},{k:'high',l:'High'},{k:'low',l:'Low'},{k:'bid',l:'Bid'},{k:'offer',l:'Offer'}]},
  {group:'Volume',icon:'📊',cols:[
    {k:'volume',l:'Vol(lot)'},{k:'value',l:'Value'},{k:'frequency',l:'Freq'},{k:'vol_spike',l:'Vol Spike'}]},
  {group:'Foreign',icon:'🌍',cols:[
    {k:'foreign_net_val',l:'F.Net'},{k:'foreign_buy_val',l:'F.Buy'},{k:'foreign_sell_val',l:'F.Sell'}]},
  {group:'MA',icon:'📈',cols:[
    {k:'ma5',l:'MA5'},{k:'ma10',l:'MA10'},{k:'ma20',l:'MA20'},{k:'ma50',l:'MA50'},{k:'ma100',l:'MA100'},{k:'ma200',l:'MA200'}]},
  {group:'MACD & Stoch',icon:'📉',cols:[
    {k:'macd_hist',l:'MACD'},{k:'macd_cross',l:'MACD X'},{k:'stoch_k',l:'Stoch K'},{k:'stoch_d',l:'Stoch D'}]},
  {group:'Fundamental',icon:'💎',cols:[
    {k:'per',l:'PER'},{k:'pbv',l:'PBV'},{k:'roe',l:'ROE%'},{k:'roa',l:'ROA%'},{k:'der',l:'DER'},{k:'npm',l:'NPM%'},
    {k:'market_cap',l:'Mkt Cap'},{k:'total_rev',l:'Revenue'},{k:'ytd',l:'YTD%'},{k:'sector',l:'Sector'}]},
];

// Flat col lookup
var SCR_ALL_COLS = {};
SCR_COL_GROUPS.forEach(function(g){g.cols.forEach(function(c){SCR_ALL_COLS[c.k]=c;});});

async function loadScreener() {
  try { var r = await fetch('/api/screener/configs'); scrConfigs = await r.json(); } catch { scrConfigs = []; }
  renderScreener();
}

function renderScreener() {
  var el = $('scr-content'); if (!el) return;
  var h = '';
  // Saved configs — click opens editor
  h += '<div style="display:flex;gap:4px;flex-wrap:wrap;padding:2px 0 8px">';
  scrConfigs.forEach(function(c) {
    h += '<button class="bei-tab' + (scrEditId === c.id ? ' on' : '') + '" onclick="scrLoadConfig(' + c.id + ');scrOpenEditor()">' + esc(c.name) + '</button>';
  });
  h += '<button class="bei-tab" onclick="scrRules=[];scrEditId=null;scrLogic=\'AND\';scrColumns=[\'close\',\'change_pct\',\'volume\',\'per\',\'pbv\',\'foreign_net_val\',\'ma20\'];scrOpenEditor()" style="border-style:dashed">+ New</button>';
  h += '<span style="flex:1"></span>';
  h += '<button class="pbtn" onclick="scrRun()" style="padding:5px 16px;font-size:12px">🔬 Run</button>';
  h += '</div>';

  // Active filters display
  if (scrRules.length) {
    h += '<div style="display:flex;gap:4px;flex-wrap:wrap;padding:2px 0 6px;font-size:10px">';
    h += '<span style="color:var(--t3)">Filters:</span>';
    scrRules.forEach(function(r, i) {
      if (!r.field) return;
      var fDef = null; SCR_FIELDS.forEach(function(g) { g.items.forEach(function(f) { if (f.k === r.field) fDef = f; }); });
      var label = fDef ? fDef.l : r.field;
      var display = label + ' ' + (r.op || '>') + ' ' + (r.val || '');
      h += '<span style="padding:2px 6px;border-radius:4px;background:var(--blB);color:var(--bl);font-weight:600">' + esc(display) + '</span>';
      if (i < scrRules.length - 1) h += '<span style="color:var(--t3);font-weight:700">' + scrLogic + '</span>';
    });
    h += '</div>';
  }

  // Results count
  if (scrResults.length) {
    h += '<div style="font-size:11px;color:var(--t2);padding:2px 0">' + scrResults.length + ' results</div>';
  }

  // Results table
  h += '<div id="scr-results">';
  if (scrResults.length) h += scrRenderResults();
  h += '</div>';

  el.innerHTML = h;
}

function scrRenderResults() {
  var h = '<div style="overflow:auto;max-height:calc(100vh - 220px)"><table class="bei-tbl" style="width:100%"><thead style="position:sticky;top:0;z-index:1;background:var(--bg1)"><tr>';
  h += '<th class="al" style="cursor:pointer;user-select:none;min-width:55px" onclick="scrSort(\'code\')">Code' + (scrSortCol === 'code' ? (scrSortDir === 'asc' ? ' ▲' : ' ▼') : '') + '</th>';
  h += '<th class="al" style="min-width:120px">Name</th>';

  scrColumns.forEach(function(k) {
    var c = SCR_ALL_COLS[k] || {k:k, l:k};
    var arrow = scrSortCol === k ? (scrSortDir === 'asc' ? ' ▲' : ' ▼') : '';
    h += '<th class="ar" style="cursor:pointer;user-select:none;white-space:nowrap" ';
    h += 'draggable="true" ondragstart="scrDragCol=\'' + k + '\'" ondragover="event.preventDefault()" ondrop="scrDropCol(\'' + k + '\')" ';
    h += 'onclick="scrSort(\'' + k + '\')">' + c.l + arrow + '</th>';
  });
  h += '</tr></thead><tbody>';

  scrResults.forEach(function(r) {
    h += '<tr><td class="code al" onclick="gsOpen(\'' + esc(r.code) + '\')">' + esc(r.code) + '</td>';
    h += '<td class="name al" style="font-size:10px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(r.name || '') + '</td>';
    scrColumns.forEach(function(k) {
      var v = scrGetCellValue(r, k);
      var cls = scrGetCellClass(r, k);
      h += '<td class="ar ' + cls + '" style="font-family:var(--fm)">' + v + '</td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

function scrGetCellValue(r, k) {
  var t = r.tech || {};
  var f = r.fund || {};
  if (k === 'close') return (r.close || 0).toLocaleString();
  if (k === 'change_pct') return (r.change_pct > 0 ? '+' : '') + (r.change_pct || 0).toFixed(2) + '%';
  if (k === 'volume') return fmtNum(Math.round((r.volume || 0) / 100));
  if (k === 'value') return fmtRp(r.value || 0);
  if (k === 'frequency') return fmtNum(r.frequency || 0);
  if (k === 'foreign_net_val') return fmtRp(r.foreign_net_val || 0);
  if (k === 'foreign_buy_val') return fmtRp((r.foreign_buy || 0) * r.close);
  if (k === 'foreign_sell_val') return fmtRp((r.foreign_sell || 0) * r.close);
  if (k === 'high') return (r.high || 0).toLocaleString();
  if (k === 'low') return (r.low || 0).toLocaleString();
  if (k === 'bid') return (r.bid || 0).toLocaleString();
  if (k === 'offer') return (r.offer || 0).toLocaleString();
  if (k === 'vol_spike') return t.vol_ratio ? t.vol_ratio + 'x' : '-';
  if (k.match(/^ma\d+$/)) { var v = t[k]; return v ? v.toLocaleString() : '-'; }
  if (k === 'macd_hist') return t.macd ? t.macd.histogram.toFixed(1) : '-';
  if (k === 'macd_cross') return t.macd && t.macd.cross ? t.macd.cross : '-';
  if (k === 'stoch_k') return t.stoch ? t.stoch.k.toFixed(1) : '-';
  if (k === 'stoch_d') return t.stoch && t.stoch.d ? t.stoch.d.toFixed(1) : '-';
  if (k === 'per') return f.per || '-';
  if (k === 'pbv') return f.pbv || '-';
  if (k === 'roe') return f.roe ? f.roe + '%' : '-';
  if (k === 'roa') return f.roa ? f.roa + '%' : '-';
  if (k === 'der') return f.der || '-';
  if (k === 'npm') return f.npm ? f.npm + '%' : '-';
  if (k === 'market_cap') return f.mkt_cap ? fmtRp(f.mkt_cap) : '-';
  if (k === 'total_rev') return f.total_rev ? fmtRp(f.total_rev) : '-';
  if (k === 'ytd') return f.ytd ? (f.ytd > 0 ? '+' : '') + f.ytd.toFixed(1) + '%' : '-';
  if (k === 'sector') return f.sector || '-';
  return '-';
}

function scrGetCellClass(r, k) {
  if (k === 'change_pct') return (r.change_pct || 0) > 0 ? 'up' : (r.change_pct || 0) < 0 ? 'dn' : '';
  if (k === 'foreign_net_val') return (r.foreign_net_val || 0) > 0 ? 'up' : (r.foreign_net_val || 0) < 0 ? 'dn' : '';
  if (k === 'ytd') { var f = r.fund || {}; return (f.ytd || 0) > 0 ? 'up' : (f.ytd || 0) < 0 ? 'dn' : ''; }
  if (k === 'macd_hist') { var t = r.tech || {}; return t.macd ? (t.macd.histogram > 0 ? 'up' : 'dn') : ''; }
  return '';
}

function scrSortValue(r, k) {
  var t = r.tech || {}; var f = r.fund || {};
  if (k === 'code') return r.code || '';
  if (k === 'close') return r.close || 0;
  if (k === 'change_pct') return r.change_pct || 0;
  if (k === 'volume') return r.volume || 0;
  if (k === 'value') return r.value || 0;
  if (k === 'frequency') return r.frequency || 0;
  if (k === 'foreign_net_val') return r.foreign_net_val || 0;
  if (k === 'foreign_buy_val') return (r.foreign_buy || 0) * r.close;
  if (k === 'foreign_sell_val') return (r.foreign_sell || 0) * r.close;
  if (k === 'high') return r.high || 0;
  if (k === 'low') return r.low || 0;
  if (k.match(/^ma\d+$/)) return t[k] || 0;
  if (k === 'macd_hist') return t.macd ? t.macd.histogram : 0;
  if (k === 'stoch_k') return t.stoch ? t.stoch.k : 0;
  if (k === 'stoch_d') return t.stoch ? (t.stoch.d || 0) : 0;
  if (k === 'vol_spike') return t.vol_ratio || 0;
  if (k === 'per') return f.per || 0;
  if (k === 'pbv') return f.pbv || 0;
  if (k === 'roe') return f.roe || 0;
  if (k === 'roa') return f.roa || 0;
  if (k === 'der') return f.der || 0;
  if (k === 'npm') return f.npm || 0;
  if (k === 'market_cap') return f.mkt_cap || 0;
  if (k === 'total_rev') return f.total_rev || 0;
  if (k === 'ytd') return f.ytd || 0;
  if (k === 'sector') return f.sector || '';
  return 0;
}

function scrSort(k) {
  if (scrSortCol === k) scrSortDir = scrSortDir === 'desc' ? 'asc' : 'desc';
  else { scrSortCol = k; scrSortDir = 'desc'; }
  scrResults.sort(function(a, b) {
    var va = scrSortValue(a, k), vb = scrSortValue(b, k);
    if (typeof va === 'string') return scrSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return scrSortDir === 'asc' ? va - vb : vb - va;
  });
  var el = $('scr-results'); if (el) el.innerHTML = scrRenderResults();
}

// ═══ Drag-and-drop column reorder ═══
function scrDropCol(targetK) {
  if (!scrDragCol || scrDragCol === targetK) return;
  var fromIdx = scrColumns.indexOf(scrDragCol);
  var toIdx = scrColumns.indexOf(targetK);
  if (fromIdx < 0 || toIdx < 0) return;
  scrColumns.splice(fromIdx, 1);
  scrColumns.splice(toIdx, 0, scrDragCol);
  scrDragCol = null;
  var el = $('scr-results'); if (el) el.innerHTML = scrRenderResults();
}

function scrTogCol(k) {
  var i = scrColumns.indexOf(k);
  if (i >= 0) scrColumns.splice(i, 1);
  else scrColumns.push(k);
  scrRenderEditor();
}

function scrFieldChanged(i) {
  var fDef = null;
  SCR_FIELDS.forEach(function(g) { g.items.forEach(function(f) { if (f.k === scrRules[i].field) fDef = f; }); });
  if (fDef) {
    if (fDef.type === 'compare') scrRules[i].op = 'above';
    else if (fDef.type === 'select') scrRules[i].op = '=';
    else scrRules[i].op = '>';
    scrRules[i].val = '';
  }
}

// ═══ Editor Popup — redesigned with grouped fields ═══
function scrOpenEditor() {
  var h = '<div class="epop o" id="scr-editor" onclick="if(event.target===this)scrCloseEditor()">';
  h += '<div class="scr-modal" style="max-width:650px">';
  h += '<div class="scr-modal-h"><span>⚙️ Screener Rules</span><button onclick="scrCloseEditor()">✕</button></div>';
  h += '<div class="scr-modal-body" id="scr-editor-body" style="max-height:70vh;overflow-y:auto"></div>';
  h += '<div class="scr-modal-foot">';
  h += '<button class="bei-tab on" onclick="scrCloseEditor();scrRun()">🔬 Run</button>';
  if (scrEditId) {
    h += '<button class="bei-tab" onclick="scrSaveExisting()">💾 Save</button>';
    h += '<button class="bei-tab" onclick="scrSaveNew()">💾 Save As</button>';
    h += '<button class="bei-tab" style="color:var(--rd);border-color:var(--rd)" onclick="scrDelCfg(' + scrEditId + ')">🗑 Delete</button>';
  } else {
    h += '<button class="bei-tab" onclick="scrSaveNew()">💾 Save</button>';
  }
  h += '<button class="bei-tab" onclick="scrRules=[];scrRenderEditor()">↻ Reset</button>';
  h += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
  scrRenderEditor();
}

function scrRenderEditor() {
  var el = $('scr-editor-body'); if (!el) return;
  var h = '';

  // ── Logic toggle ──
  h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">';
  h += '<span style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Rules</span>';
  h += '<button class="bei-sort-btn' + (scrLogic === 'AND' ? ' on' : '') + '" onclick="scrLogic=\'AND\';scrRenderEditor()" style="padding:2px 8px;font-size:10px">AND</button>';
  h += '<button class="bei-sort-btn' + (scrLogic === 'OR' ? ' on' : '') + '" onclick="scrLogic=\'OR\';scrRenderEditor()" style="padding:2px 8px;font-size:10px">OR</button>';
  h += '<span style="flex:1"></span>';
  h += '<span style="font-size:9px;color:var(--t3)">' + (scrLogic === 'AND' ? 'All rules must match' : 'Any rule can match') + '</span>';
  h += '</div>';

  // ── Rules ──
  scrRules.forEach(function(rule, i) {
    h += '<div style="display:flex;gap:5px;align-items:center;margin-bottom:5px">';
    // Grouped field selector
    h += '<select class="scr-sel" style="min-width:140px" onchange="scrRules[' + i + '].field=this.value;scrFieldChanged(' + i + ');scrRenderEditor()">';
    h += '<option value="">Select field...</option>';
    SCR_FIELDS.forEach(function(g) {
      h += '<optgroup label="' + g.icon + ' ' + g.group + '">';
      g.items.forEach(function(f) { h += '<option value="' + f.k + '"' + (rule.field === f.k ? ' selected' : '') + '>' + f.l + '</option>'; });
      h += '</optgroup>';
    });
    h += '</select>';

    var fDef = null; SCR_FIELDS.forEach(function(g) { g.items.forEach(function(f) { if (f.k === rule.field) fDef = f; }); });
    if (fDef) {
      if (fDef.type === 'num') {
        h += '<select class="scr-sel scr-sm" onchange="scrRules[' + i + '].op=this.value">';
        [['>','>'],['>=','≥'],['<','<'],['<=','≤']].forEach(function(o) { h += '<option value="' + o[0] + '"' + (rule.op === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
        h += '</select><input class="scr-inp" type="number" step="any" value="' + (rule.val || '') + '" onchange="scrRules[' + i + '].val=this.value" placeholder="Value">';
      } else if (fDef.type === 'compare') {
        h += '<select class="scr-sel scr-sm" onchange="scrRules[' + i + '].op=this.value">';
        [['above','↑ Above'],['below','↓ Below']].forEach(function(o) { h += '<option value="' + o[0] + '"' + (rule.op === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
        h += '</select>';
      } else if (fDef.type === 'select') {
        h += '<select class="scr-sel" onchange="scrRules[' + i + '].val=this.value"><option value="">Select...</option>';
        (fDef.opts || []).forEach(function(o) { h += '<option value="' + o[0] + '"' + (rule.val === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
        h += '</select>';
      }
    }
    h += '<button style="background:none;border:none;color:var(--rd);cursor:pointer;font-size:14px;padding:2px 4px" onclick="scrRules.splice(' + i + ',1);scrRenderEditor()">✕</button>';
    h += '</div>';
  });
  h += '<button class="bei-tab" onclick="scrRules.push({field:\'\',op:\'>\',val:\'\'});scrRenderEditor()" style="border-style:dashed;margin-bottom:14px">+ Add Rule</button>';

  // ── Column selector — grouped ──
  h += '<div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Table Columns</div>';
  h += '<div style="font-size:9px;color:var(--t3);margin-bottom:6px">Click to toggle. Drag column headers in table to reorder.</div>';
  SCR_COL_GROUPS.forEach(function(g) {
    h += '<div style="margin-bottom:6px"><span style="font-size:9px;color:var(--t3);font-weight:600">' + g.icon + ' ' + g.group + '</span> ';
    g.cols.forEach(function(c) {
      var on = scrColumns.indexOf(c.k) >= 0;
      h += '<button class="scr-col' + (on ? ' on' : '') + '" onclick="scrTogCol(\'' + c.k + '\')" style="margin:1px">' + c.l + '</button>';
    });
    h += '</div>';
  });

  el.innerHTML = h;
}

function scrCloseEditor() { var p = $('scr-editor'); if (p) p.remove(); renderScreener(); }

// ═══ Run ═══
async function scrRun() {
  var el = $('scr-results'); if (el) el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3)">Running screener...</div>';
  try {
    var r = await fetch('/api/screener/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: scrRules, logic: scrLogic, limit: 200, always_tech: true }) });
    var d = await r.json();
    scrResults = d.data || [];
    renderScreener();
  } catch (e) { if (el) el.innerHTML = '<div class="ne">Error: ' + e.message + '</div>'; }
}

// ═══ Config Management ═══
async function scrSaveNew() {
  var name = prompt('Config name:'); if (!name) return;
  try {
    var r = await fetch('/api/screener/configs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, filters: { rules: scrRules, columns: scrColumns, logic: scrLogic } }) });
    var d = await r.json();
    if (d.id) {
      scrEditId = d.id;
      scrCloseEditor();
      loadScreener();
      showT('✅', 'Saved "' + name + '"');
    }
  } catch (e) { showT('Error', e.message); }
}

async function scrSaveExisting() {
  if (!scrEditId) return;
  try {
    await fetch('/api/screener/configs/' + scrEditId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: { rules: scrRules, columns: scrColumns, logic: scrLogic } }) });
    // Update local cache so we don't need to re-fetch
    var cfg = scrConfigs.find(function(c) { return c.id === scrEditId; });
    if (cfg) cfg.filters = { rules: JSON.parse(JSON.stringify(scrRules)), columns: scrColumns.slice(), logic: scrLogic };
    showT('✅', 'Updated');
  } catch (e) { showT('Error', e.message); }
}

function scrLoadConfig(id) {
  var cfg = scrConfigs.find(function(c) { return c.id === id; });
  if (!cfg) return;
  scrEditId = id;
  // Handle filters as string (old format) or object (new format)
  var f = cfg.filters;
  if (typeof f === 'string') { try { f = JSON.parse(f); } catch(e) { f = {}; } }
  if (!f) f = {};
  // Deep copy rules to prevent reference mutation
  scrRules = JSON.parse(JSON.stringify(f.rules || []));
  scrColumns = f.columns ? f.columns.slice() : ['close','change_pct','volume','per','pbv','foreign_net_val','ma20'];
  scrLogic = f.logic || 'AND';
}

function scrCloseCfg() { var p = $('scr-cfg-popup'); if (p) p.remove(); renderScreener(); }

async function scrUpdateCfg(id) {
  try { await fetch('/api/screener/configs/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: { rules: scrRules, columns: scrColumns, logic: scrLogic } }) }); showT('✅', 'Updated'); loadScreener(); } catch (e) { showT('Error', e.message); }
}

async function scrDelCfg(id) {
  if (!confirm('Delete this config?')) return;
  try {
    await fetch('/api/screener/configs/' + id, { method: 'DELETE' });
    scrEditId = null;
    scrRules = [];
    scrCloseEditor();
    loadScreener();
    showT('✅', 'Deleted');
  } catch (e) { showT('Error', e.message); }
}