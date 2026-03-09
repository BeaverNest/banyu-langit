// ═══ Screener V5 — Rule Groups (AND/OR mixed), persistent config, larger popup ═══
var scrGroups = [{rules:[]}]; // Array of groups, each group has AND rules, groups connected by OR
var scrConfigs = [];
var scrResults = [];
var scrColumns = ['close','change_pct','volume','per','pbv','foreign_net_val','ma5','ma20','ma200'];
var scrEditId = null;
var scrSortCol = 'foreign_net_val';
var scrSortDir = 'desc';
var scrDragCol = null;

// ═══ Load saved state from localStorage ═══
try {
  var _scr = JSON.parse(localStorage.getItem('scrState'));
  if (_scr) {
    if (_scr.groups) scrGroups = _scr.groups;
    if (_scr.columns) scrColumns = _scr.columns;
    if (_scr.editId) scrEditId = _scr.editId;
  }
} catch(e){}

function scrSaveState() {
  localStorage.setItem('scrState', JSON.stringify({groups:scrGroups, columns:scrColumns, editId:scrEditId}));
}

// ═══ Backward compat: convert old flat rules to group format ═══
function scrMigrateRules(rules, logic) {
  if (!rules || !rules.length) return [{rules:[]}];
  if (logic === 'OR') {
    // Each rule becomes its own group
    return rules.map(function(r) { return {rules:[r]}; });
  }
  // AND: all rules in one group
  return [{rules: rules}];
}

// ═══ Field definitions — grouped ═══
var SCR_FIELDS = [
  {group:'Price',icon:'💰',items:[
    {k:'close',l:'Close Price',type:'num'},{k:'change_pct',l:'Change %',type:'num'}]},
  {group:'Volume & Activity',icon:'📊',items:[
    {k:'volume_lot',l:'Volume (lot)',type:'num'},{k:'value',l:'Value (IDR)',type:'num'},
    {k:'frequency',l:'Frequency',type:'num'},{k:'vol_spike',l:'Vol Spike (x avg)',type:'num'},
    {k:'val_spike',l:'Value Spike (x avg)',type:'num'},{k:'freq_spike',l:'Freq Spike (x avg)',type:'num'},
    {k:'fnet_spike',l:'F.Net Spike (x avg)',type:'num'},{k:'activity_score',l:'Activity Score',type:'num'}]},
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
    {k:'total_rev',l:'Revenue',type:'num'},{k:'eps',l:'EPS',type:'num'},{k:'div_yield',l:'Dividend Yield %',type:'num'}]},
  {group:'Profitability',icon:'📋',items:[
    {k:'roe',l:'ROE %',type:'num'},{k:'roa',l:'ROA %',type:'num'},
    {k:'der',l:'DER',type:'num'},{k:'npm',l:'NPM %',type:'num'},{k:'ytd',l:'YTD %',type:'num'},
    {k:'free_float',l:'Free Float %',type:'num'}]},
  {group:'Classification',icon:'🏷',items:[
    {k:'sector',l:'Sector',type:'select',opts:[['Energy','Energy'],['Financials','Financials'],['Basic Materials','Basic Materials'],['Industrials','Industrials'],['Consumer Cyclicals','Consumer Cyclicals'],['Consumer Non-Cyclicals','Consumer Non-Cyclicals'],['Healthcare','Healthcare'],['Technology','Technology'],['Infrastructures','Infrastructures'],['Transportation & Logistic','Transport & Logistic'],['Properties & Real Estate','Properties & RE']]},
    {k:'industry',l:'Industry',type:'text_match'},
    {k:'idx_index',l:'Index Member',type:'select',opts:[['LQ45','LQ45'],['IDX30','IDX30'],['IDX80','IDX80'],['ISSI','ISSI'],['JII','JII'],['JII70','JII70'],['KOMPAS100','KOMPAS100'],['IDX-MES BUMN 17','MES BUMN'],['IDXV30','IDXV30']]}]},
];

// ═══ Column definitions — grouped ═══
var SCR_COL_GROUPS = [
  {group:'Price',icon:'💰',cols:[
    {k:'close',l:'Close'},{k:'change_pct',l:'Chg%'},{k:'high',l:'High'},{k:'low',l:'Low'},{k:'bid',l:'Bid'},{k:'offer',l:'Offer'}]},
  {group:'Volume',icon:'📊',cols:[
    {k:'volume',l:'Vol(lot)'},{k:'value',l:'Value'},{k:'frequency',l:'Freq'},{k:'vol_spike',l:'Vol Spike'},
    {k:'val_spike',l:'Val Spike'},{k:'freq_spike',l:'Freq Spike'},{k:'fnet_spike',l:'FNet Spike'},{k:'activity_score',l:'Score'}]},
  {group:'Foreign',icon:'🌍',cols:[
    {k:'foreign_net_val',l:'F.Net'},{k:'foreign_buy_val',l:'F.Buy'},{k:'foreign_sell_val',l:'F.Sell'}]},
  {group:'MA',icon:'📈',cols:[
    {k:'ma5',l:'MA5'},{k:'ma10',l:'MA10'},{k:'ma20',l:'MA20'},{k:'ma50',l:'MA50'},{k:'ma100',l:'MA100'},{k:'ma200',l:'MA200'}]},
  {group:'MACD & Stoch',icon:'📉',cols:[
    {k:'macd_hist',l:'MACD'},{k:'macd_cross',l:'MACD X'},{k:'stoch_k',l:'Stoch K'},{k:'stoch_d',l:'Stoch D'}]},
  {group:'Fundamental',icon:'💎',cols:[
    {k:'per',l:'PER'},{k:'pbv',l:'PBV'},{k:'roe',l:'ROE%'},{k:'roa',l:'ROA%'},{k:'der',l:'DER'},{k:'npm',l:'NPM%'},
    {k:'eps',l:'EPS'},{k:'div_yield',l:'Div Yield'},{k:'free_float',l:'Free Float'},
    {k:'market_cap',l:'Mkt Cap'},{k:'total_rev',l:'Revenue'},{k:'ytd',l:'YTD%'},{k:'sector',l:'Sector'},{k:'industry',l:'Industry'}]},
];

var SCR_ALL_COLS = {};
SCR_COL_GROUPS.forEach(function(g){g.cols.forEach(function(c){SCR_ALL_COLS[c.k]=c;});});

// ═══ LOAD ═══
async function loadScreener() {
  try { var r = await fetch('/api/screener/configs'); scrConfigs = await r.json(); } catch { scrConfigs = []; }
  // Auto-load last used config
  if (scrEditId && !scrGroups[0].rules.length) {
    scrLoadConfig(scrEditId);
  }
  renderScreener();
}

// ═══ PRESET TEMPLATES ═══
var SCR_PRESETS = [
  { name: '🟢 Asing Akumulasi', desc: 'Foreign net buy streak + volume spike',
    groups: [{rules:[
      {field:'fnet_streak', op:'>', val:'3'},
      {field:'vol_spike', op:'>', val:'1.5'}
    ]}],
    columns: ['close','change_pct','foreign_net_val','volume','vol_spike','frequency','ma20','ma200']
  },
  { name: '🚀 Breakout', desc: 'Above MA20+MA200, MACD bullish, volume spike',
    groups: [{rules:[
      {field:'close_vs_ma20', op:'above', val:''},
      {field:'close_vs_ma200', op:'above', val:''},
      {field:'macd_signal', op:'above', val:''},
      {field:'vol_spike', op:'>', val:'1.5'}
    ]}],
    columns: ['close','change_pct','volume','vol_spike','foreign_net_val','ma20','ma200','macd_hist','stoch_k']
  },
  { name: '💎 Value Picks', desc: 'Low PER, high ROE, low PBV',
    groups: [{rules:[
      {field:'per', op:'>', val:'0'},
      {field:'per', op:'<', val:'15'},
      {field:'roe', op:'>', val:'10'},
      {field:'pbv', op:'<', val:'1.5'}
    ]}],
    columns: ['close','change_pct','per','pbv','roe','roa','der','npm','foreign_net_val','ytd']
  },
  { name: '📉 Oversold Bounce', desc: 'Stoch oversold, below MA20, MACD turning up',
    groups: [{rules:[
      {field:'stoch_zone', op:'=', val:'oversold'},
      {field:'close_vs_ma20', op:'below', val:''},
      {field:'macd_hist', op:'>', val:'0'}
    ]}],
    columns: ['close','change_pct','stoch_k','stoch_d','macd_hist','ma20','volume','foreign_net_val']
  }
];

// ═══ SCREENER ALERT — compare results vs previous, show modal report ═══
var scrAlertLastResults = {};
try { var _sa = JSON.parse(localStorage.getItem('scrAlertLast')); if (_sa) scrAlertLastResults = _sa; } catch(e){}

async function scrCheckAlerts() {
  if (!scrConfigs.length) { showT('⚠', 'No saved configs to check'); return; }
  var btn = $('scr-alert-btn');
  if (btn) { btn.textContent = '🔔 Checking...'; btn.disabled = true; }

  var report = []; // {name, totalCurrent, newStocks:[], removedStocks:[], allStocks:[{code,name,close,change_pct,fnet}]}

  for (var ci = 0; ci < scrConfigs.length; ci++) {
    var cfg = scrConfigs[ci];
    var f = cfg.filters;
    if (typeof f === 'string') { try { f = JSON.parse(f); } catch(e) { continue; } }
    if (!f) continue;

    var groups = f.groups || (f.rules ? [f.rules] : null);
    if (!groups || !groups.some(function(g) { return g && g.length > 0; })) continue;

    try {
      var r = await fetch('/api/screener/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: groups, limit: 500, always_tech: true }) });
      var d = await r.json();
      var currentStocks = (d.data || []).map(function(s) { return { code: s.code, name: s.name, close: s.close, change_pct: s.change_pct, fnet: s.foreign_net_val }; });
      var currentCodes = currentStocks.map(function(s) { return s.code; });
      var prevCodes = scrAlertLastResults[cfg.id] || [];

      var newStocks = currentStocks.filter(function(s) { return prevCodes.indexOf(s.code) < 0; });
      var removedStocks = prevCodes.filter(function(c) { return currentCodes.indexOf(c) < 0; });

      report.push({
        id: cfg.id,
        name: cfg.name,
        totalCurrent: currentCodes.length,
        totalPrev: prevCodes.length,
        newStocks: newStocks,
        removedStocks: removedStocks,
        allStocks: currentStocks.slice(0, 20)
      });

      scrAlertLastResults[cfg.id] = currentCodes;
    } catch(e) {
      report.push({ id: cfg.id, name: cfg.name, error: e.message });
    }
  }

  localStorage.setItem('scrAlertLast', JSON.stringify(scrAlertLastResults));
  if (btn) { btn.textContent = '🔔 Check Alerts'; btn.disabled = false; }

  // Show modal report
  scrShowAlertReport(report);
}

function scrShowAlertReport(report) {
  var existing = $('scr-alert-modal'); if (existing) existing.remove();
  var totalNew = report.reduce(function(s, r) { return s + (r.newStocks ? r.newStocks.length : 0); }, 0);
  var totalRemoved = report.reduce(function(s, r) { return s + (r.removedStocks ? r.removedStocks.length : 0); }, 0);

  var h = '<div class="epop o" id="scr-alert-modal" onclick="if(event.target===this)this.remove()">';
  h += '<div class="scr-modal" style="max-width:900px;max-height:85vh">';
  h += '<div class="scr-modal-h"><span>🔔 Screener Alert Report</span><button onclick="$(\'scr-alert-modal\').remove()">✕</button></div>';
  h += '<div class="scr-modal-body" style="max-height:calc(85vh - 60px);overflow-y:auto;padding:16px 20px">';

  // Summary
  h += '<div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap">';
  h += '<div class="bd-card"><div class="bd-card-label">Configs Checked</div><div class="bd-card-val">' + report.length + '</div></div>';
  h += '<div class="bd-card"><div class="bd-card-label">New Stocks</div><div class="bd-card-val"><span class="' + (totalNew > 0 ? 'up' : '') + '">' + totalNew + '</span></div></div>';
  h += '<div class="bd-card"><div class="bd-card-label">Removed</div><div class="bd-card-val"><span class="' + (totalRemoved > 0 ? 'dn' : '') + '">' + totalRemoved + '</span></div></div>';
  h += '</div>';

  if (!totalNew && !totalRemoved) {
    h += '<div style="text-align:center;padding:20px;color:var(--t3)">No changes since last check. All configs returned same stocks.</div>';
  }

  // Per config
  report.forEach(function(r) {
    if (r.error) {
      h += '<div style="padding:8px 12px;margin-bottom:8px;border:1px solid var(--rd);border-radius:8px;background:var(--rdB)">';
      h += '<span style="font-weight:700">' + esc(r.name) + '</span> — Error: ' + esc(r.error);
      h += '</div>';
      return;
    }

    var hasChanges = (r.newStocks && r.newStocks.length) || (r.removedStocks && r.removedStocks.length);
    var borderColor = hasChanges ? 'var(--am)' : 'var(--b2)';

    h += '<div style="border:1px solid ' + borderColor + ';border-radius:10px;margin-bottom:12px;overflow:hidden">';
    // Header
    h += '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bgH);border-bottom:1px solid var(--b1)">';
    h += '<span style="font-weight:700;font-size:13px">' + esc(r.name) + '</span>';
    h += '<span style="font-size:10px;color:var(--t3)">' + r.totalCurrent + ' stocks match</span>';
    if (r.totalPrev) h += '<span style="font-size:10px;color:var(--t3)">(was ' + r.totalPrev + ')</span>';
    if (r.newStocks.length) h += '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--gnB);color:var(--gn);font-weight:700">+' + r.newStocks.length + ' new</span>';
    if (r.removedStocks.length) h += '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--rdB);color:var(--rd);font-weight:700">-' + r.removedStocks.length + ' out</span>';
    h += '<span style="flex:1"></span>';
    h += '<button class="bei-sort-btn" onclick="scrLoadConfig(' + r.id + ');$(\'scr-alert-modal\').remove();scrRun()" style="font-size:10px;padding:3px 8px">🔬 Run</button>';
    h += '</div>';

    // New stocks table
    if (r.newStocks.length) {
      h += '<div style="padding:6px 14px 2px"><span style="font-size:10px;font-weight:700;color:var(--gn)">🟢 NEW — just entered criteria:</span></div>';
      h += '<table class="bei-tbl" style="width:100%"><thead><tr>';
      h += '<th class="al" style="min-width:50px">Code</th><th class="al">Name</th><th class="ar">Close</th><th class="ar">Chg%</th><th class="ar">F.Net</th>';
      h += '</tr></thead><tbody>';
      r.newStocks.forEach(function(s) {
        var chgCls = (s.change_pct||0) > 0 ? 'up' : (s.change_pct||0) < 0 ? 'dn' : '';
        var fCls = (s.fnet||0) > 0 ? 'up' : (s.fnet||0) < 0 ? 'dn' : '';
        h += '<tr style="background:var(--gnB);cursor:pointer" onclick="gsOpen(\'' + esc(s.code) + '\')">';
        h += '<td class="code al">' + esc(s.code) + '</td>';
        h += '<td class="al" style="font-size:10px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.name||'') + '</td>';
        h += '<td class="ar" style="font-family:var(--fm)">' + (s.close||0).toLocaleString() + '</td>';
        h += '<td class="ar ' + chgCls + '" style="font-family:var(--fm)">' + ((s.change_pct||0)>0?'+':'') + (s.change_pct||0).toFixed(2) + '%</td>';
        h += '<td class="ar ' + fCls + '" style="font-family:var(--fm)">' + fmtRp(s.fnet||0) + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table>';
    }

    // Removed stocks
    if (r.removedStocks.length) {
      h += '<div style="padding:6px 14px 2px"><span style="font-size:10px;font-weight:700;color:var(--rd)">🔴 OUT — no longer match:</span></div>';
      h += '<div style="padding:2px 14px 8px;display:flex;gap:4px;flex-wrap:wrap">';
      r.removedStocks.forEach(function(code) {
        h += '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--rdB);color:var(--rd);font-family:var(--fm);cursor:pointer" onclick="gsOpen(\'' + esc(code) + '\')">' + esc(code) + '</span>';
      });
      h += '</div>';
    }

    // Current top stocks (collapsed by default if no changes)
    if (!hasChanges && r.allStocks.length) {
      h += '<div style="padding:6px 14px 8px"><span style="font-size:10px;color:var(--t3)">Top matches: ';
      h += r.allStocks.slice(0, 8).map(function(s) {
        return '<span class="code" style="cursor:pointer" onclick="gsOpen(\'' + esc(s.code) + '\')">' + esc(s.code) + '</span>';
      }).join(' ');
      if (r.totalCurrent > 8) h += ' +' + (r.totalCurrent - 8) + ' more';
      h += '</span></div>';
    }

    h += '</div>';
  });

  h += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
}

function scrApplyPreset(idx) {
  var p = SCR_PRESETS[idx];
  if (!p) return;
  scrGroups = JSON.parse(JSON.stringify(p.groups));
  scrColumns = p.columns.slice();
  scrEditId = null;
  scrSaveState();
  // Close preset panel if open, open editor
  scrOpenEditor();
}

// ═══ MAIN RENDER ═══
function renderScreener() {
  var el = $('scr-content'); if (!el) return;
  var h = '';

  // Presets row
  h += '<div style="display:flex;gap:4px;flex-wrap:wrap;padding:2px 0 6px;align-items:center">';
  h += '<span style="font-size:10px;color:var(--t3);font-weight:600">Presets:</span>';
  SCR_PRESETS.forEach(function(p, i) {
    h += '<button class="bei-sort-btn" onclick="scrApplyPreset(' + i + ')" style="padding:3px 8px;font-size:10px" title="' + esc(p.desc) + '">' + p.name + '</button>';
  });
  h += '</div>';

  // Saved configs + actions
  h += '<div style="display:flex;gap:4px;flex-wrap:wrap;padding:2px 0 8px;align-items:center">';
  h += '<span style="font-size:10px;color:var(--t3);font-weight:600">Saved:</span>';
  scrConfigs.forEach(function(c) {
    h += '<button class="bei-tab' + (scrEditId === c.id ? ' on' : '') + '" onclick="scrLoadConfig(' + c.id + ');scrOpenEditor()">' + esc(c.name) + '</button>';
  });
  h += '<button class="bei-tab" onclick="scrGroups=[{rules:[]}];scrEditId=null;scrColumns=[\'close\',\'change_pct\',\'volume\',\'per\',\'pbv\',\'foreign_net_val\',\'ma20\'];scrOpenEditor()" style="border-style:dashed">+ New</button>';
  h += '<span style="flex:1"></span>';
  h += '<button class="bei-sort-btn" id="scr-alert-btn" onclick="scrCheckAlerts()" style="padding:4px 10px;font-size:11px;color:var(--am);border-color:var(--am)" title="Check all saved configs for new stocks">🔔 Check Alerts</button>';
  h += '<button class="pbtn" onclick="scrRun()" style="padding:5px 16px;font-size:12px">🔬 Run</button>';
  h += '</div>';

  // Active filters display
  var allRules = scrGetAllRules();
  if (allRules.length) {
    h += '<div style="display:flex;gap:4px;flex-wrap:wrap;padding:2px 0 6px;font-size:10px">';
    h += '<span style="color:var(--t3)">Filters:</span>';
    scrGroups.forEach(function(g, gi) {
      if (!g.rules.length) return;
      if (gi > 0) h += '<span style="color:var(--am);font-weight:700;padding:0 4px">OR</span>';
      g.rules.forEach(function(r, ri) {
        if (!r.field) return;
        var fDef = scrFindField(r.field);
        var label = fDef ? fDef.l : r.field;
        var display = label + ' ' + (r.op || '>') + ' ' + (r.val || '');
        h += '<span style="padding:2px 6px;border-radius:4px;background:var(--blB);color:var(--bl);font-weight:600">' + esc(display) + '</span>';
        if (ri < g.rules.length - 1) h += '<span style="color:var(--t3);font-weight:700;font-size:9px">AND</span>';
      });
    });
    h += '</div>';
  }

  if (scrResults.length) h += '<div style="font-size:11px;color:var(--t2);padding:2px 0">' + scrResults.length + ' results</div>';
  h += '<div id="scr-results">';
  if (scrResults.length) h += scrRenderResults();
  h += '</div>';
  el.innerHTML = h;
}

function scrFindField(k) {
  var found = null;
  SCR_FIELDS.forEach(function(g) { g.items.forEach(function(f) { if (f.k === k) found = f; }); });
  return found;
}

function scrGetAllRules() {
  var all = [];
  scrGroups.forEach(function(g) { g.rules.forEach(function(r) { if (r.field) all.push(r); }); });
  return all;
}

// ═══ RESULTS TABLE ═══
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
      h += '<td class="ar ' + scrGetCellClass(r, k) + '" style="font-family:var(--fm)">' + scrGetCellValue(r, k) + '</td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

function scrGetCellValue(r, k) {
  var t = r.tech || {}; var f = r.fund || {};
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
  if (k === 'val_spike') return t.val_spike ? t.val_spike + 'x' : '-';
  if (k === 'freq_spike') return t.freq_spike ? t.freq_spike + 'x' : '-';
  if (k === 'fnet_spike') return t.fnet_spike ? t.fnet_spike + 'x' : '-';
  if (k === 'activity_score') return t.activity_score ? t.activity_score + 'x' : '-';
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
  if (k === 'eps') return f.eps ? f.eps.toLocaleString() : '-';
  if (k === 'div_yield') return f.div_yield ? f.div_yield.toFixed(2) + '%' : '-';
  if (k === 'free_float') { var ff = r.tradeable_shares && r.listed_shares ? Math.round(r.tradeable_shares / r.listed_shares * 1000) / 10 : (f.free_float || 0); return ff ? ff.toFixed(1) + '%' : '-'; }
  if (k === 'market_cap') return f.mkt_cap ? fmtRp(f.mkt_cap) : '-';
  if (k === 'total_rev') return f.total_rev ? fmtRp(f.total_rev) : '-';
  if (k === 'ytd') return f.ytd ? (f.ytd > 0 ? '+' : '') + f.ytd.toFixed(1) + '%' : '-';
  if (k === 'sector') return f.sector || '-';
  if (k === 'industry') return f.industry || '-';
  return '-';
}

function scrGetCellClass(r, k) {
  if (k === 'change_pct') return (r.change_pct || 0) > 0 ? 'up' : (r.change_pct || 0) < 0 ? 'dn' : '';
  if (k === 'foreign_net_val') return (r.foreign_net_val || 0) > 0 ? 'up' : (r.foreign_net_val || 0) < 0 ? 'dn' : '';
  if (k === 'ytd') { var f = r.fund || {}; return (f.ytd || 0) > 0 ? 'up' : (f.ytd || 0) < 0 ? 'dn' : ''; }
  if (k === 'macd_hist') { var t = r.tech || {}; return t.macd ? (t.macd.histogram > 0 ? 'up' : 'dn') : ''; }
  if (k === 'activity_score') { var t2 = r.tech || {}; return (t2.activity_score || 0) >= 3 ? 'up' : (t2.activity_score || 0) >= 2 ? '' : ''; }
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
  if (k === 'val_spike') return t.val_spike || 0;
  if (k === 'freq_spike') return t.freq_spike || 0;
  if (k === 'fnet_spike') return t.fnet_spike || 0;
  if (k === 'activity_score') return t.activity_score || 0;
  if (k === 'per') return f.per || 0;
  if (k === 'pbv') return f.pbv || 0;
  if (k === 'roe') return f.roe || 0;
  if (k === 'roa') return f.roa || 0;
  if (k === 'der') return f.der || 0;
  if (k === 'npm') return f.npm || 0;
  if (k === 'eps') return f.eps || 0;
  if (k === 'div_yield') return f.div_yield || 0;
  if (k === 'free_float') return r.tradeable_shares && r.listed_shares ? r.tradeable_shares / r.listed_shares * 100 : (f.free_float || 0);
  if (k === 'market_cap') return f.mkt_cap || 0;
  if (k === 'total_rev') return f.total_rev || 0;
  if (k === 'ytd') return f.ytd || 0;
  if (k === 'sector') return f.sector || '';
  if (k === 'industry') return f.industry || '';
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

function scrDropCol(targetK) {
  if (!scrDragCol || scrDragCol === targetK) return;
  var fi = scrColumns.indexOf(scrDragCol), ti = scrColumns.indexOf(targetK);
  if (fi < 0 || ti < 0) return;
  scrColumns.splice(fi, 1); scrColumns.splice(ti, 0, scrDragCol);
  scrDragCol = null;
  var el = $('scr-results'); if (el) el.innerHTML = scrRenderResults();
}

function scrTogCol(k) {
  var i = scrColumns.indexOf(k);
  if (i >= 0) scrColumns.splice(i, 1); else scrColumns.push(k);
  scrRenderEditor();
}

function scrFieldChanged(gi, ri) {
  var fDef = scrFindField(scrGroups[gi].rules[ri].field);
  if (fDef) {
    if (fDef.type === 'compare') scrGroups[gi].rules[ri].op = 'above';
    else if (fDef.type === 'select') scrGroups[gi].rules[ri].op = '=';
    else scrGroups[gi].rules[ri].op = '>';
    scrGroups[gi].rules[ri].val = '';
  }
}

// ═══ EDITOR POPUP — larger, with rule groups ═══
function scrOpenEditor() {
  var existing = $('scr-editor'); if (existing) existing.remove();
  var h = '<div class="epop o" id="scr-editor" onclick="if(event.target===this)scrCloseEditor()">';
  h += '<div class="scr-modal" style="max-width:900px;max-height:85vh">';
  h += '<div class="scr-modal-h"><span>⚙️ Screener Rules</span><button onclick="scrCloseEditor()">✕</button></div>';
  h += '<div class="scr-modal-body" id="scr-editor-body" style="max-height:calc(85vh - 100px);overflow-y:auto;padding:16px 20px"></div>';
  h += '<div class="scr-modal-foot">';
  h += '<button class="bei-tab on" onclick="scrCloseEditor();scrRun()">🔬 Run</button>';
  if (scrEditId) {
    h += '<button class="bei-tab" onclick="scrSaveExisting()">💾 Save</button>';
    h += '<button class="bei-tab" onclick="scrSaveNew()">💾 Save As</button>';
    h += '<button class="bei-tab" style="color:var(--rd);border-color:var(--rd)" onclick="scrDelCfg(' + scrEditId + ')">🗑 Delete</button>';
  } else {
    h += '<button class="bei-tab" onclick="scrSaveNew()">💾 Save</button>';
  }
  h += '<button class="bei-tab" onclick="scrGroups=[{rules:[]}];scrRenderEditor()">↻ Reset</button>';
  h += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
  scrRenderEditor();
}

// ═══ EDITOR BODY — Rule Groups ═══
function scrRenderEditor() {
  var el = $('scr-editor-body'); if (!el) return;
  var h = '';

  // ── Rule Groups ──
  h += '<div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Rule Groups</div>';
  h += '<div style="font-size:9px;color:var(--t3);margin-bottom:10px">Each group uses AND logic. Groups are connected with OR. Stock matches if ANY group passes.</div>';

  scrGroups.forEach(function(group, gi) {
    h += '<div style="border:1px solid var(--b2);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:var(--bgH)">';
    h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">';
    h += '<span style="font-size:11px;font-weight:700;color:var(--bl)">Group ' + (gi + 1) + '</span>';
    h += '<span style="font-size:9px;color:var(--t3);background:var(--blB);padding:1px 6px;border-radius:3px">AND</span>';
    h += '<span style="flex:1"></span>';
    if (scrGroups.length > 1) h += '<button style="background:none;border:none;color:var(--rd);cursor:pointer;font-size:12px" onclick="scrGroups.splice(' + gi + ',1);scrRenderEditor()" title="Remove group">✕</button>';
    h += '</div>';

    // Rules in this group
    group.rules.forEach(function(rule, ri) {
      h += '<div style="display:flex;gap:5px;align-items:center;margin-bottom:5px">';
      // Field selector
      h += '<select class="scr-sel" style="min-width:140px" onchange="scrGroups[' + gi + '].rules[' + ri + '].field=this.value;scrFieldChanged(' + gi + ',' + ri + ');scrRenderEditor()">';
      h += '<option value="">Select field...</option>';
      SCR_FIELDS.forEach(function(g) {
        h += '<optgroup label="' + g.icon + ' ' + g.group + '">';
        g.items.forEach(function(f) { h += '<option value="' + f.k + '"' + (rule.field === f.k ? ' selected' : '') + '>' + f.l + '</option>'; });
        h += '</optgroup>';
      });
      h += '</select>';

      var fDef = scrFindField(rule.field);
      if (fDef) {
        if (fDef.type === 'num') {
          h += '<select class="scr-sel scr-sm" onchange="scrGroups[' + gi + '].rules[' + ri + '].op=this.value">';
          [['>','>'],['>=','≥'],['<','<'],['<=','≤']].forEach(function(o) { h += '<option value="' + o[0] + '"' + (rule.op === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
          h += '</select><input class="scr-inp" type="number" step="any" value="' + (rule.val || '') + '" onchange="scrGroups[' + gi + '].rules[' + ri + '].val=this.value" placeholder="Value">';
        } else if (fDef.type === 'compare') {
          h += '<select class="scr-sel scr-sm" onchange="scrGroups[' + gi + '].rules[' + ri + '].op=this.value">';
          [['above','↑ Above'],['below','↓ Below']].forEach(function(o) { h += '<option value="' + o[0] + '"' + (rule.op === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
          h += '</select>';
        } else if (fDef.type === 'select') {
          h += '<select class="scr-sel" onchange="scrGroups[' + gi + '].rules[' + ri + '].val=this.value"><option value="">Select...</option>';
          (fDef.opts || []).forEach(function(o) { h += '<option value="' + o[0] + '"' + (rule.val === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; });
          h += '</select>';
        } else if (fDef.type === 'text_match') {
          h += '<input class="scr-inp" style="min-width:160px" type="text" value="' + esc(rule.val || '') + '" onchange="scrGroups[' + gi + '].rules[' + ri + '].val=this.value" placeholder="Contains...">';
        }
      }
      h += '<button style="background:none;border:none;color:var(--rd);cursor:pointer;font-size:14px;padding:2px 4px" onclick="scrGroups[' + gi + '].rules.splice(' + ri + ',1);scrRenderEditor()">✕</button>';
      h += '</div>';
    });

    h += '<button class="bei-tab" onclick="scrGroups[' + gi + '].rules.push({field:\'\',op:\'>\',val:\'\'});scrRenderEditor()" style="border-style:dashed;font-size:10px;padding:3px 10px">+ Add Rule</button>';
    h += '</div>';

    // OR separator between groups
    if (gi < scrGroups.length - 1) {
      h += '<div style="text-align:center;padding:4px 0;font-size:12px;font-weight:700;color:var(--am)">— OR —</div>';
    }
  });

  h += '<button class="bei-tab" onclick="scrGroups.push({rules:[]});scrRenderEditor()" style="border-style:dashed;margin-bottom:16px;color:var(--am);border-color:var(--am)">+ Add Group (OR)</button>';

  // ── Column selector ──
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

function scrCloseEditor() { var p = $('scr-editor'); if (p) p.remove(); scrSaveState(); renderScreener(); }

// ═══ RUN — sends groups to backend ═══
async function scrRun() {
  scrSaveState();
  var el = $('scr-results'); if (el) el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3)">Running screener...</div>';
  try {
    // Convert groups to backend format
    // Backend supports: rules[] + logic (AND|OR)
    // For group support: send as groups[] array, backend evaluates OR between groups, AND within
    var allRules = [];
    var hasMultiGroup = scrGroups.length > 1;

    if (hasMultiGroup) {
      // Send groups format — backend needs update for this
      // Fallback: flatten with OR logic for now, backend treats as OR
      scrGroups.forEach(function(g) { g.rules.forEach(function(r) { if (r.field) allRules.push(r); }); });
      var r = await fetch('/api/screener/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups: scrGroups.map(function(g){return g.rules.filter(function(r){return r.field;});}), rules: allRules, logic: 'OR', limit: 500, always_tech: true }) });
      var d = await r.json();
      scrResults = d.data || [];
    } else {
      // Single group — send as AND
      var rules = scrGroups[0] ? scrGroups[0].rules.filter(function(r){return r.field;}) : [];
      var r = await fetch('/api/screener/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: rules, logic: 'AND', limit: 500, always_tech: true }) });
      var d = await r.json();
      scrResults = d.data || [];
    }
    renderScreener();
  } catch (e) { if (el) el.innerHTML = '<div class="ne">Error: ' + e.message + '</div>'; }
}

// ═══ CONFIG MANAGEMENT ═══
async function scrSaveNew() {
  var name = prompt('Config name:'); if (!name) return;
  try {
    var r = await fetch('/api/screener/configs', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, filters: { groups: scrGroups, columns: scrColumns } }) });
    var d = await r.json();
    if (d.id) { scrEditId = d.id; scrSaveState(); scrCloseEditor(); loadScreener(); showT('✅', 'Saved "' + name + '"'); }
  } catch (e) { showT('Error', e.message); }
}

async function scrSaveExisting() {
  if (!scrEditId) return;
  try {
    // Get current config name
    var cfg = scrConfigs.find(function(c) { return c.id === scrEditId; });
    var name = cfg ? cfg.name : 'Untitled';
    var r = await fetch('/api/screener/configs/' + scrEditId, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, filters: { groups: scrGroups, columns: scrColumns } }) });
    var d = await r.json();
    if (d.error) { showT('Error', d.error); return; }
    if (cfg) cfg.filters = { groups: JSON.parse(JSON.stringify(scrGroups)), columns: scrColumns.slice() };
    scrSaveState();
    showT('✅', 'Saved "' + name + '"');
  } catch (e) { showT('Error', e.message); }
}

function scrLoadConfig(id) {
  var cfg = scrConfigs.find(function(c) { return c.id === id; });
  if (!cfg) return;
  scrEditId = id;
  var f = cfg.filters;
  if (typeof f === 'string') { try { f = JSON.parse(f); } catch(e) { f = {}; } }
  if (!f) f = {};

  // Support old format (flat rules + logic) and new format (groups)
  if (f.groups) {
    scrGroups = JSON.parse(JSON.stringify(f.groups));
  } else if (f.rules) {
    scrGroups = scrMigrateRules(f.rules, f.logic || 'AND');
  } else {
    scrGroups = [{rules:[]}];
  }
  scrColumns = f.columns ? f.columns.slice() : ['close','change_pct','volume','per','pbv','foreign_net_val','ma20'];
  scrSaveState();
}

async function scrDelCfg(id) {
  if (!confirm('Delete this config?')) return;
  try {
    await fetch('/api/screener/configs/' + id, { method: 'DELETE' });
    scrEditId = null; scrGroups = [{rules:[]}]; scrSaveState();
    scrCloseEditor(); loadScreener(); showT('✅', 'Deleted');
  } catch (e) { showT('Error', e.message); }
}

// ═══ Backward compat ═══
var scrRules = []; // kept for any external references
var scrLogic = 'AND';