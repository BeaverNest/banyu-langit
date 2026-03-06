// ═══ Screener V3 — Rules in popup, results full width ═══
var scrRules = [];
var scrConfigs = [];
var scrResults = [];
var scrColumns = ['close','change_pct','volume','frequency','foreign_net_val','ma5','ma20','macd_hist','stoch_k'];
var scrEditId = null;
var scrSortCol = 'foreign_net_val';
var scrSortDir = 'desc';

var SCR_FIELDS = [
  {group:'Price',items:[{k:'close',l:'Close Price',type:'num'},{k:'change_pct',l:'Change %',type:'num'}]},
  {group:'Volume',items:[{k:'volume_lot',l:'Volume (lot)',type:'num'},{k:'value',l:'Value (IDR)',type:'num'},{k:'frequency',l:'Frequency',type:'num'},{k:'vol_spike',l:'Vol Spike (x avg)',type:'num'}]},
  {group:'Foreign',items:[{k:'foreign_net_val',l:'Foreign Net (IDR)',type:'num'},{k:'fnet_streak',l:'Foreign Streak (days)',type:'num'}]},
  {group:'MA',items:[{k:'close_vs_ma5',l:'Close vs MA5',type:'compare'},{k:'close_vs_ma10',l:'Close vs MA10',type:'compare'},{k:'close_vs_ma20',l:'Close vs MA20',type:'compare'},{k:'close_vs_ma50',l:'Close vs MA50',type:'compare'},{k:'close_vs_ma100',l:'Close vs MA100',type:'compare'},{k:'close_vs_ma200',l:'Close vs MA200',type:'compare'}]},
  {group:'MACD',items:[{k:'macd_hist',l:'MACD Histogram',type:'num'},{k:'macd_cross',l:'MACD Cross',type:'select',opts:[['golden','Golden Cross'],['death','Death Cross']]},{k:'macd_signal',l:'MACD vs Signal',type:'compare'}]},
  {group:'Stochastic',items:[{k:'stoch_k',l:'Stochastic %K',type:'num'},{k:'stoch_d',l:'Stochastic %D',type:'num'},{k:'stoch_zone',l:'Stoch Zone',type:'select',opts:[['oversold','Oversold (<20)'],['overbought','Overbought (>80)']]}]},
];

var SCR_COLS = [
  {k:'close',l:'Close'},{k:'change_pct',l:'Chg%'},{k:'volume',l:'Vol(lot)'},{k:'value',l:'Value'},{k:'frequency',l:'Freq'},
  {k:'foreign_net_val',l:'F.Net'},{k:'foreign_buy_val',l:'F.Buy'},{k:'foreign_sell_val',l:'F.Sell'},
  {k:'ma5',l:'MA5'},{k:'ma10',l:'MA10'},{k:'ma20',l:'MA20'},{k:'ma50',l:'MA50'},{k:'ma100',l:'MA100'},{k:'ma200',l:'MA200'},
  {k:'macd_hist',l:'MACD'},{k:'macd_cross',l:'MACD X'},{k:'stoch_k',l:'Stoch K'},{k:'stoch_d',l:'Stoch D'},
  {k:'vol_spike',l:'Vol Spike'},{k:'high',l:'High'},{k:'low',l:'Low'},{k:'bid',l:'Bid'},{k:'offer',l:'Offer'},{k:'market_cap',l:'Mkt Cap'},
];

async function loadScreener() {
  try { var r = await fetch('/api/screener/configs'); scrConfigs = await r.json(); } catch { scrConfigs = []; }
  renderScreener();
}

function renderScreener() {
  var el = $('scr-content'); if (!el) return;
  var h = '';
  // Top bar: configs + edit button + run
  h += '<div style="padding:6px 12px;border-bottom:1px solid var(--b1);display:flex;gap:4px;flex-wrap:wrap;align-items:center">';
  scrConfigs.forEach(function(c) { h += '<button class="bei-tab" onclick="scrLoadConfig(' + c.id + ')">' + esc(c.name) + '</button>'; });
  h += '<button class="bei-tab" style="border-style:dashed" onclick="scrEditId=null;scrRules=[];scrOpenEditor()">+ New</button>';
  h += '<span style="flex:1"></span>';
  if (scrRules.length) h += '<button class="bei-tab" onclick="scrOpenEditor()">⚙️ Edit Rules (' + scrRules.filter(function(r){return r.field;}).length + ')</button>';
  h += '<button class="bei-tab on" onclick="scrRun()">🔬 Run</button>';
  h += '<span id="scr-status" style="font-size:10px;color:var(--t3);margin-left:4px"></span>';
  h += '</div>';
  // Active rules summary
  var activeRules = scrRules.filter(function(r) { return r.field; });
  if (activeRules.length) {
    h += '<div style="padding:4px 12px;border-bottom:1px solid var(--b1);display:flex;gap:4px;flex-wrap:wrap;align-items:center">';
    h += '<span style="font-size:9px;color:var(--t3)">Filters:</span>';
    activeRules.forEach(function(r) {
      var label = r.field; SCR_FIELDS.forEach(function(g) { g.items.forEach(function(f) { if (f.k === r.field) label = f.l; }); });
      var opTxt = r.op || ''; var valTxt = r.val || '';
      if (r.op === 'above') opTxt = '↑'; else if (r.op === 'below') opTxt = '↓';
      h += '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--blB);color:var(--bl);font-family:var(--fm)">' + esc(label) + ' ' + opTxt + ' ' + valTxt + '</span>';
    });
    h += '<span style="font-size:9px;color:var(--t3);margin-left:4px">(AND)</span>';
    h += '</div>';
  }
  // Results
  h += scrRenderResults();
  el.innerHTML = h;
}

function scrRenderResults() {
  if (!scrResults.length) return '<div style="padding:40px;text-align:center;color:var(--t3);font-size:12px">Set rules via ⚙️ Edit Rules, then 🔬 Run</div>';
  var sorted = scrResults.slice();
  if (scrSortCol) {
    sorted.sort(function(a, b) {
      var av = scrSortValue(a, scrSortCol), bv = scrSortValue(b, scrSortCol);
      return scrSortDir === 'asc' ? av - bv : bv - av;
    });
  }
  var h = '<div style="padding:3px 12px;font-size:10px;color:var(--t3)">' + scrResults.length + ' results</div>';
  h += '<div style="overflow-y:auto;max-height:calc(100vh - 200px)"><table class="bei-tbl"><thead><tr>';
  h += '<th class="al">Code</th><th class="al">Name</th>';
  scrColumns.forEach(function(k) {
    var c = SCR_COLS.find(function(x) { return x.k === k; }); if (!c) return;
    var arrow = scrSortCol === k ? (scrSortDir === 'asc' ? ' ▲' : ' ▼') : '';
    h += '<th class="ar" style="cursor:pointer;user-select:none" onclick="scrSort(\'' + k + '\')">' + c.l + arrow + '</th>';
  });
  h += '</tr></thead><tbody>';
  sorted.forEach(function(r) {
    var t = r.tech || {};
    h += '<tr><td class="al"><span class="code" onclick="gsOpen(\'' + esc(r.code) + '\')">' + esc(r.code) + '</span></td>';
    h += '<td class="al name">' + esc(r.name || '') + '</td>';
    scrColumns.forEach(function(k) { var v = scrGetVal(r, t, k); h += '<td class="ar ' + (v.cls || '') + '">' + v.txt + '</td>'; });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

function scrSortValue(r, k) {
  var t = r.tech || {};
  switch (k) {
    case 'close': return r.close || 0;
    case 'change_pct': return r.change_pct || 0;
    case 'volume': return r.volume || 0;
    case 'value': return r.value || 0;
    case 'frequency': return r.frequency || 0;
    case 'foreign_net_val': return r.foreign_net_val || 0;
    case 'foreign_buy_val': return (r.foreign_buy || 0) * (r.close || 0);
    case 'foreign_sell_val': return (r.foreign_sell || 0) * (r.close || 0);
    case 'market_cap': return (r.close || 0) * (r.listed_shares || 0);
    case 'vol_spike': return t.vol_ratio || 0;
    case 'ma5': case 'ma10': case 'ma20': case 'ma50': case 'ma100': case 'ma200': return t[k] || 0;
    case 'macd_hist': return t.macd ? t.macd.histogram : 0;
    case 'stoch_k': return t.stoch ? t.stoch.k : 0;
    case 'stoch_d': return t.stoch && t.stoch.d ? t.stoch.d : 0;
    case 'high': return r.high || 0;
    case 'low': return r.low || 0;
    default: return 0;
  }
}

function scrSort(k) {
  if (scrSortCol === k) scrSortDir = scrSortDir === 'desc' ? 'asc' : 'desc';
  else { scrSortCol = k; scrSortDir = 'desc'; }
  renderScreener();
}

function scrGetVal(r, t, k) {
  switch (k) {
    case 'close': return {txt:(r.close||0).toLocaleString()};
    case 'change_pct': var cp=r.change_pct||0; return {txt:(cp>0?'+':'')+cp.toFixed(2)+'%',cls:cp>0?'up':cp<0?'dn':''};
    case 'volume': return {txt:fmtNum(Math.round((r.volume||0)/100))};
    case 'value': return {txt:fmtRp(r.value||0)};
    case 'frequency': return {txt:fmtNum(r.frequency||0)};
    case 'foreign_net_val': var fn=r.foreign_net_val||0; return {txt:fmtRp(fn),cls:fn>0?'up':fn<0?'dn':''};
    case 'foreign_buy_val': return {txt:fmtRp((r.foreign_buy||0)*(r.close||0))};
    case 'foreign_sell_val': return {txt:fmtRp((r.foreign_sell||0)*(r.close||0))};
    case 'high': return {txt:(r.high||0).toLocaleString()};
    case 'low': return {txt:(r.low||0).toLocaleString()};
    case 'bid': return {txt:(r.bid||0).toLocaleString()};
    case 'offer': return {txt:(r.offer||0).toLocaleString()};
    case 'market_cap': return {txt:fmtRp((r.close||0)*(r.listed_shares||0))};
    case 'vol_spike': return {txt:t.vol_ratio?t.vol_ratio+'x':'-',cls:t.vol_ratio>3?'hi':''};
    case 'ma5':case 'ma10':case 'ma20':case 'ma50':case 'ma100':case 'ma200':
      var mv=t[k]; if(!mv) return {txt:'-'}; return {txt:Math.round(mv).toLocaleString(),cls:r.close>mv?'up':'dn'};
    case 'macd_hist': if(!t.macd) return {txt:'-'}; var mh=t.macd.histogram; return {txt:(mh>0?'+':'')+mh,cls:mh>0?'up':mh<0?'dn':''};
    case 'macd_cross': if(!t.macd) return {txt:'-'}; return {txt:t.macd.cross==='golden'?'🟢GX':t.macd.cross==='death'?'🔴DX':'-'};
    case 'stoch_k': if(!t.stoch) return {txt:'-'}; return {txt:t.stoch.k.toFixed(0),cls:t.stoch.zone==='oversold'?'up':t.stoch.zone==='overbought'?'dn':''};
    case 'stoch_d': if(!t.stoch) return {txt:'-'}; return {txt:t.stoch.d?t.stoch.d.toFixed(0):'-'};
    default: return {txt:'-'};
  }
}

function scrTogCol(k) { var i=scrColumns.indexOf(k); if(i>=0)scrColumns.splice(i,1); else scrColumns.push(k); scrRenderEditor(); }

function scrFieldChanged(i) {
  var f = scrRules[i].field;
  var fDef = null; SCR_FIELDS.forEach(function(g) { g.items.forEach(function(fd) { if (fd.k === f) fDef = fd; }); });
  if (fDef && fDef.type === 'compare') scrRules[i].op = 'above';
  else if (fDef && fDef.type === 'select') scrRules[i].op = '';
  else scrRules[i].op = '>';
  scrRules[i].val = '';
}

// ═══ Editor Popup ═══
function scrOpenEditor() {
  var h = '<div class="epop o" id="scr-editor" onclick="if(event.target===this)scrCloseEditor()">';
  h += '<div class="scr-modal">';
  h += '<div class="scr-modal-h"><span>⚙️ Screener Rules</span><button onclick="scrCloseEditor()">✕</button></div>';
  h += '<div class="scr-modal-body" id="scr-editor-body"></div>';
  h += '<div class="scr-modal-foot">';
  h += '<button class="bei-tab on" onclick="scrCloseEditor();scrRun()">🔬 Run</button>';
  if (scrEditId) h += '<button class="bei-tab" onclick="scrSaveExisting()">💾 Save</button>';
  else h += '<button class="bei-tab" onclick="scrSaveNew()">💾 Save As</button>';
  h += '<button class="bei-tab" onclick="scrRules=[];scrRenderEditor()">↻ Reset</button>';
  h += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
  scrRenderEditor();
}

function scrRenderEditor() {
  var el = $('scr-editor-body'); if (!el) return;
  var h = '';
  // Rules
  h += '<div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Rules (AND)</div>';
  scrRules.forEach(function(rule, i) {
    h += '<div style="display:flex;gap:6px;align-items:center;margin-bottom:5px">';
    h += '<select class="scr-sel" onchange="scrRules[' + i + '].field=this.value;scrFieldChanged(' + i + ');scrRenderEditor()">';
    h += '<option value="">Select...</option>';
    SCR_FIELDS.forEach(function(g) { h += '<optgroup label="' + g.group + '">'; g.items.forEach(function(f) { h += '<option value="' + f.k + '"' + (rule.field === f.k ? ' selected' : '') + '>' + f.l + '</option>'; }); h += '</optgroup>'; });
    h += '</select>';
    var fDef = null; SCR_FIELDS.forEach(function(g) { g.items.forEach(function(f) { if (f.k === rule.field) fDef = f; }); });
    if (fDef) {
      if (fDef.type === 'num') {
        h += '<select class="scr-sel scr-sm" onchange="scrRules[' + i + '].op=this.value">';
        [['>','>'],['>=','≥'],['<','<'],['<=','≤']].forEach(function(o) { h += '<option value="' + o[0] + '"' + (rule.op === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
        h += '</select><input class="scr-inp" type="number" step="any" value="' + (rule.val || '') + '" onchange="scrRules[' + i + '].val=this.value" placeholder="Value">';
      } else if (fDef.type === 'compare') {
        h += '<select class="scr-sel scr-sm" onchange="scrRules[' + i + '].op=this.value">';
        [['above','Above'],['below','Below']].forEach(function(o) { h += '<option value="' + o[0] + '"' + (rule.op === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
        h += '</select>';
      } else if (fDef.type === 'select') {
        h += '<select class="scr-sel" onchange="scrRules[' + i + '].val=this.value"><option value="">Select...</option>';
        (fDef.opts || []).forEach(function(o) { h += '<option value="' + o[0] + '"' + (rule.val === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
        h += '</select>';
      }
    }
    h += '<button style="background:none;border:none;color:var(--rd);cursor:pointer;font-size:14px" onclick="scrRules.splice(' + i + ',1);scrRenderEditor()">✕</button>';
    h += '</div>';
  });
  h += '<button class="bei-tab" onclick="scrRules.push({field:\'\',op:\'>\',val:\'\'});scrRenderEditor()" style="border-style:dashed;margin-bottom:12px">+ Add Rule</button>';
  // Columns
  h += '<div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Table Columns</div>';
  h += '<div style="display:flex;gap:3px;flex-wrap:wrap">';
  SCR_COLS.forEach(function(c) {
    var on = scrColumns.indexOf(c.k) >= 0;
    h += '<button class="scr-col' + (on ? ' on' : '') + '" onclick="scrTogCol(\'' + c.k + '\')">' + c.l + '</button>';
  });
  h += '</div>';
  el.innerHTML = h;
}

function scrCloseEditor() { var p = $('scr-editor'); if (p) p.remove(); renderScreener(); }

// ═══ Run ═══
async function scrRun() {
  var st = $('scr-status'); if (st) st.textContent = 'Running...';
  try {
    var r = await fetch('/api/screener/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: scrRules.filter(function(r) { return r.field; }), limit: 100 }) });
    var d = await r.json(); scrResults = d.data || [];
    if (st) st.textContent = d.total + ' found';
    renderScreener();
  } catch (e) { if (st) st.textContent = 'Error'; }
}

// ═══ Config Management ═══
async function scrSaveNew() {
  var rules = scrRules.filter(function(r) { return r.field; });
  if (!rules.length) { showT('Screener', 'Add rules first'); return; }
  var name = prompt('Config name:'); if (!name) return;
  try { await fetch('/api/screener/configs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, filters: JSON.stringify({ rules: rules, columns: scrColumns }) }) }); showT('Saved', name); scrCloseEditor(); loadScreener(); } catch (e) { showT('Error', e.message); }
}

async function scrSaveExisting() {
  if (!scrEditId) return scrSaveNew();
  var cfg = scrConfigs.find(function(c) { return c.id === scrEditId; });
  var name = cfg ? cfg.name : 'Untitled';
  var rules = scrRules.filter(function(r) { return r.field; });
  try { await fetch('/api/screener/configs/' + scrEditId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, filters: JSON.stringify({ rules: rules, columns: scrColumns }) }) }); showT('Updated', name); scrCloseEditor(); loadScreener(); } catch (e) { showT('Error', e.message); }
}

function scrLoadConfig(id) {
  var cfg = scrConfigs.find(function(c) { return c.id === id; }); if (!cfg) return;
  scrEditId = id;
  var parsed = {}; try { parsed = typeof cfg.filters === 'string' ? JSON.parse(cfg.filters) : cfg.filters; } catch {}
  scrRules = parsed.rules || []; if (parsed.columns) scrColumns = parsed.columns;
  // Popup: Load & Run / Edit / Delete
  var h = '<div class="epop o" id="scr-cfg-popup" onclick="if(event.target===this)scrCloseCfg()">';
  h += '<div class="scr-modal" style="max-width:360px">';
  h += '<div class="scr-modal-h"><span>📁 ' + esc(cfg.name) + '</span><button onclick="scrCloseCfg()">✕</button></div>';
  h += '<div style="padding:12px"><div style="font-size:11px;color:var(--t2);margin-bottom:8px">' + scrRules.length + ' rules · ' + scrColumns.length + ' columns</div>';
  h += '<input id="scr-cfg-name" value="' + esc(cfg.name) + '" style="width:100%;background:var(--bgH);border:1px solid var(--b2);border-radius:6px;padding:6px 10px;color:var(--t1);font-size:12px;outline:none;margin-bottom:10px">';
  h += '<div style="display:flex;gap:6px">';
  h += '<button class="bei-tab on" onclick="scrCloseCfg();scrRun()" style="flex:1">🔬 Load & Run</button>';
  h += '<button class="bei-tab" onclick="scrCloseCfg();scrOpenEditor()" style="flex:1">⚙️ Edit</button>';
  h += '<button class="bei-tab" onclick="scrUpdateCfg(' + id + ')">💾</button>';
  h += '<button class="bei-tab" onclick="scrDelCfg(' + id + ')" style="color:var(--rd)">🗑</button>';
  h += '</div></div></div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
}

function scrCloseCfg() { var p = $('scr-cfg-popup'); if (p) p.remove(); renderScreener(); }

async function scrUpdateCfg(id) {
  var name = ($('scr-cfg-name') || {}).value; if (!name) return;
  try { await fetch('/api/screener/configs/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, filters: JSON.stringify({ rules: scrRules.filter(function(r) { return r.field; }), columns: scrColumns }) }) }); showT('Updated', name); scrCloseCfg(); loadScreener(); } catch (e) { showT('Error', e.message); }
}

async function scrDelCfg(id) {
  if (!confirm('Delete config?')) return;
  try { await fetch('/api/screener/configs/' + id, { method: 'DELETE' }); scrCloseCfg(); scrEditId=null; scrRules = []; scrResults = []; loadScreener(); } catch {}
}