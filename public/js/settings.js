// ═══ SETTINGS MODAL — Simplified ═══
let setActiveTab='idxapi';

function openSettings(){
  $('smod').classList.add('o');
  setTab('idxapi',document.querySelector('.smod-nav-item.on'));
  fetch('/api/idx/ca/stats').then(function(r){return r.json()}).then(function(d){
    var b=$('smod-ca-badge');
    if(d.pending>0){b.textContent=d.pending;b.style.display='';}
    else{b.style.display='none';}
  }).catch(function(){});
}

function closeSettings(){$('smod').classList.remove('o');}

function setTab(tab,el){
  setActiveTab=tab;
  document.querySelectorAll('.smod-nav-item').forEach(function(x){x.classList.remove('on')});
  if(el)el.classList.add('on');
  else{var t=document.querySelector('.smod-nav-item[onclick*="'+tab+'"]');if(t)t.classList.add('on');}
  var titles={upload:'📋 Manual Upload',dbstats:'🗄 Database',ca:'⚡ Corporate Actions',tags:'🏷 Investor Tags',export:'📥 Export',idxapi:'🔄 IDX API Sync',prefs:'🎨 Preferences'};
  var t=titles[tab]||tab;
  $('smod-title').innerHTML='<span class="sbh-icon">'+t.split(' ')[0]+'</span> '+t.split(' ').slice(1).join(' ');
  var c=$('smod-content');
  c.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">Loading...</div>';
  if(tab==='upload')renderSetUpload(c);
  else if(tab==='dbstats')renderSetDbStats(c);
  else if(tab==='ca')renderSetCA(c);
  else if(tab==='tags')renderSetTags(c);
  else if(tab==='export')renderSetExport(c);
  else if(tab==='idxapi')renderSetIdxApi(c);
  else if(tab==='prefs')renderSetPrefs(c);
}

// ═══ UPLOAD TAB — Only manual uploads ═══
function renderSetUpload(c){
  var h='';
  h+='<div class="s-section"><div class="s-section-title">Manual Upload</div>';
  h+='<div style="font-size:var(--font-sm);color:var(--t2);margin-bottom:10px">Data OHLCV, Index, dan Fundamental sekarang otomatis via <b>IDX API Sync</b>. Hanya data berikut yang masih perlu manual upload.</div>';
  h+='<div class="s-row"><div class="s-row-icon">📋</div><div class="s-row-info"><div class="s-row-title">Insider Ownership (XLSX)</div><div class="s-row-desc">BEI monthly shareholder data — satu-satunya data yang masih manual</div></div><div class="s-row-action"><label class="s-upload-btn">Choose File<input type="file" accept=".xlsx,.xls" onchange="setUploadInsider(this)"></label></div></div>';
  h+='<div class="s-row"><div class="s-row-icon">🏷</div><div class="s-row-info"><div class="s-row-title">Investor Tags (XLSX)</div><div class="s-row-desc">Conglomerate groups, keyword rules, ticker map</div></div><div class="s-row-action"><label class="s-upload-btn">Choose File<input type="file" accept=".xlsx" onchange="setUploadTags(this)"></label></div></div>';
  h+='</div>';
  h+='<div class="s-info" id="set-upload-info"></div>';

  // Current insider data stats
  h+='<div class="s-section"><div class="s-section-title">Insider Data Status</div><div id="set-insider-stats" style="font-size:var(--font-md);color:var(--t2)">Loading...</div></div>';
  c.innerHTML=h;

  Promise.all([
    fetch('/api/insider/stats').then(function(r){return r.json()}),
    fetch('/api/insider/tags/stats').then(function(r){return r.json()})
  ]).then(function(results){
    var ins=results[0],tags=results[1];
    var el=$('set-insider-stats');if(!el)return;
    var h='';
    if(ins.total){
      h+='<div>Holdings: <b>'+ins.total.toLocaleString()+'</b> rows | Tickers: <b>'+ins.tickers+'</b> | Investors: <b>'+ins.investors.toLocaleString()+'</b>';
      if(ins.latest)h+=' | Last: <b>'+ins.latest+'</b>';
      h+='</div>';
    }else{h+='<div style="color:var(--t3)">No insider data uploaded yet</div>';}
    h+='<div style="margin-top:6px">Tags: <b>'+tags.groups+'</b> groups | <b>'+tags.rules+'</b> rules | <b>'+tags.overrides+'</b> overrides | <b>'+tags.ticker_map+'</b> ticker map</div>';
    el.innerHTML=h;
  }).catch(function(){});
}

async function setUploadInsider(input){
  if(!input.files[0])return;var fd=new FormData();fd.append('file',input.files[0]);
  var info=$('set-upload-info');info.textContent='Uploading insider data...';info.className='s-info';
  try{var r=await fetch('/api/insider/upload',{method:'POST',body:fd});var d=await r.json();
    if(d.success){
      info.textContent='Loaded '+d.total.toLocaleString()+' records, '+d.tickers+' tickers ('+d.new_rows+' new, '+d.updated_rows+' updated)';
      showT('Insider Data',d.new_rows+' new records');
      if(typeof insHome==='function')insHome();
    }else{info.textContent=d.error||'unknown';info.className='s-info error';}
  }catch(e){info.textContent=e.message;info.className='s-info error';}input.value='';
}

async function setUploadTags(input){
  if(!input.files[0])return;var fd=new FormData();fd.append('file',input.files[0]);
  var info=$('set-upload-info');info.textContent='Uploading tags...';info.className='s-info';
  try{var r=await fetch('/api/insider/tags/upload',{method:'POST',body:fd});var d=await r.json();
    if(d.success){info.textContent='Tags: '+d.groups+' groups, '+d.rules+' rules';showT('Tags Updated',d.groups+' groups loaded');}
    else{info.textContent=d.error||'unknown';info.className='s-info error';}
  }catch(e){info.textContent=e.message;info.className='s-info error';}input.value='';
}

// ═══ DATABASE TAB — Unified stats dashboard ═══
async function renderSetDbStats(c){
  c.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3)">Loading...</div>';
  try{
    var results=await Promise.all([
      fetch('/api/idx/stats').then(function(r){return r.json()}),
      fetch('/api/insider/stats').then(function(r){return r.json()}),
      fetch('/api/idx/fundamental/stats').then(function(r){return r.json()}),
      fetch('/api/idx/ca/stats').then(function(r){return r.json()}),
      fetch('/api/idx/indices/stats').then(function(r){return r.json()}).catch(function(){return{total:0}}),
      fetch('/api/idx/sync/status').then(function(r){return r.json()}).catch(function(){return{}})
    ]);
    var idx=results[0],ins=results[1],fund=results[2],ca=results[3],idxIdx=results[4],sync=results[5];

    var h='<div class="s-stats">';
    h+='<div class="s-stat"><div class="s-stat-val">'+(idx.total||0).toLocaleString()+'</div><div class="s-stat-lbl">IDX Records</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val">'+(idx.tickers||0)+'</div><div class="s-stat-lbl">Tickers</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val">'+(idx.dates||0)+'</div><div class="s-stat-lbl">Trading Days</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val">'+(ins.total||0).toLocaleString()+'</div><div class="s-stat-lbl">Holdings</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val">'+(fund.total||0)+'</div><div class="s-stat-lbl">Fundamentals</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val am">'+(ca.pending||0)+'</div><div class="s-stat-lbl">CA Pending</div></div>';
    h+='</div>';

    // Date ranges
    h+='<div class="s-section"><div class="s-section-title">Data Coverage</div>';
    h+='<div style="font-size:var(--font-md);color:var(--t2);line-height:1.8">';
    if(idx.oldest&&idx.latest)h+='IDX Daily: <b>'+idx.oldest+'</b> to <b>'+idx.latest+'</b> ('+idx.dates+' days)<br>';
    if(idxIdx.latest)h+='Index: <b>'+(idxIdx.oldest||'?')+'</b> to <b>'+idxIdx.latest+'</b> ('+idxIdx.dates+' days, '+idxIdx.indices+' indices)<br>';
    if(fund.snapshot_month)h+='Fundamental: <b>'+fund.snapshot_month+'</b> ('+fund.total+' stocks, '+(fund.sectors?fund.sectors.length:0)+' sectors)<br>';
    if(ins.latest)h+='Insider: <b>'+ins.latest+'</b> ('+ins.tickers+' tickers, '+ins.investors+' investors)<br>';
    h+='</div></div>';

    // Gap detection
    if(idx.all_dates&&idx.all_dates.length>=2){
      var ds=new Set(idx.all_dates);var first=new Date(idx.all_dates[0]+'T00:00:00');var lastD=new Date(idx.all_dates[idx.all_dates.length-1]+'T00:00:00');
      var missing=[];var cc=new Date(first);cc.setDate(cc.getDate()+1);
      while(cc<=lastD){var dow=cc.getDay();var iso=cc.toISOString().split('T')[0];if(dow!==0&&dow!==6&&!ds.has(iso))missing.push(iso);cc.setDate(cc.getDate()+1);}
      h+='<div class="s-section"><div class="s-section-title">Gap Detection</div>';
      if(missing.length>0){
        h+='<div style="font-size:var(--font-md);color:var(--rd)">'+missing.length+' gap(s)'+(missing.length>20?' (mungkin libur nasional)':'')+'</div>';
        if(missing.length<=20){h+='<div class="s-gap-list">';missing.forEach(function(d){h+='<span class="s-gap-item">'+d+'</span>';});h+='</div>';}
      }else{h+='<div style="font-size:var(--font-md);color:var(--gn)">No gaps detected</div>';}
      h+='</div>';
    }

    // Bridge status
    if(sync.bridge){
      h+='<div class="s-section"><div class="s-section-title">Deno Bridge</div>';
      if(sync.bridge.ok){
        h+='<div style="font-size:var(--font-md);color:var(--gn)">Connected to IDX-API database</div>';
        if(sync.bridge.counts){
          var bc=sync.bridge.counts;
          h+='<div style="font-size:var(--font-sm);color:var(--t2);margin-top:4px">';
          Object.entries(bc).forEach(function(e){if(e[1]>0)h+=e[0]+': <b>'+e[1]+'</b> | ';});
          h+='</div>';
        }
      }else{
        h+='<div style="font-size:var(--font-md);color:var(--rd)">Not connected: '+(sync.bridge.error||'database.sqlite not found')+'</div>';
      }
      h+='</div>';
    }

    c.innerHTML=h;
  }catch(e){c.innerHTML='<div style="color:var(--rd);padding:20px">Error: '+e.message+'</div>';}
}

// ═══ CORPORATE ACTIONS TAB ═══
async function renderSetCA(c){
  c.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3)">Loading...</div>';
  try{
    var results=await Promise.all([fetch('/api/idx/ca').then(function(r){return r.json()}),fetch('/api/idx/ca/stats').then(function(r){return r.json()})]);
    var rows=results[0].data||[];var stats=results[1];var h='';
    h+='<div class="s-stats">';
    h+='<div class="s-stat"><div class="s-stat-val am">'+(stats.pending||0)+'</div><div class="s-stat-lbl">Pending</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val up">'+(stats.confirmed||0)+'</div><div class="s-stat-lbl">Confirmed</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val">'+(stats.total||0)+'</div><div class="s-stat-lbl">Total</div></div></div>';
    h+='<div style="display:flex;gap:4px;margin-bottom:10px;flex-wrap:wrap">';
    if(stats.pending>0){h+='<button class="s-ca-btn confirm" onclick="setCAConfirmAll()">Confirm All</button><button class="s-ca-btn dismiss" onclick="setCADismissAll()">Dismiss All</button>';}
    h+='<button class="s-ca-btn" onclick="setCARedetect()">Re-detect</button></div>';
    if(!rows.length){h+='<div style="text-align:center;padding:20px;color:var(--t3);font-size:var(--font-md)">No corporate actions detected.</div>';c.innerHTML=h;return;}
    h+='<div style="overflow-y:auto;max-height:calc(80vh - 260px)"><table class="s-ca-tbl"><thead><tr><th>Code</th><th>Ex-Date</th><th>Type</th><th class="ar">Ratio</th><th class="ar">Old Shares</th><th class="ar">New Shares</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(function(r){
      var sCls=r.status==='pending'?'pending':r.status==='confirmed'?'confirmed':'dismissed';
      var typeLbl=(r.action_type||'').toUpperCase();
      h+='<tr><td style="font-weight:700;color:var(--bl)">'+r.code+'</td><td>'+r.ex_date+'</td><td>'+typeLbl+'</td><td class="ar" style="font-weight:700">'+r.ratio.toFixed(2)+'x</td><td class="ar">'+(r.old_shares||0).toLocaleString()+'</td><td class="ar">'+(r.new_shares||0).toLocaleString()+'</td><td><span class="s-ca-status '+sCls+'">'+r.status+'</span></td><td style="white-space:nowrap">';
      if(r.status==='pending')h+='<button class="s-ca-btn confirm" onclick="setCAConfirm('+r.id+')">Y</button> <button class="s-ca-btn dismiss" onclick="setCADismiss('+r.id+')">N</button>';
      else h+='<button class="s-ca-btn" onclick="setCADelete('+r.id+')">X</button>';
      h+='</td></tr>';
    });
    h+='</tbody></table></div>';
    c.innerHTML=h;
  }catch(e){c.innerHTML='<div style="color:var(--rd);padding:20px">Error: '+e.message+'</div>';}
}

async function setCAConfirm(id){try{await fetch('/api/idx/ca/'+id+'/confirm',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'});showT('OK','Confirmed');renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCADismiss(id){try{await fetch('/api/idx/ca/'+id+'/dismiss',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'});showT('OK','Dismissed');renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCADelete(id){if(!confirm('Delete?'))return;try{await fetch('/api/idx/ca/'+id,{method:'DELETE'});renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCAConfirmAll(){if(!confirm('Confirm all pending?'))return;try{var r=await fetch('/api/idx/ca/confirm-all',{method:'POST'});var d=await r.json();showT('OK','Confirmed '+d.confirmed);renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCADismissAll(){if(!confirm('Dismiss all pending?'))return;try{var r=await fetch('/api/idx/ca/dismiss-all',{method:'POST'});var d=await r.json();showT('OK','Dismissed '+d.dismissed);renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCARedetect(){try{var r=await fetch('/api/idx/ca/detect',{method:'POST'});var d=await r.json();showT('OK','Detected '+d.total+' new');renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}

// ═══ TAGS TAB (delegate to tags-editor.js) ═══
function renderSetTags(c){
  if(typeof renderTagsEditor==='function')renderTagsEditor(c);
  else c.innerHTML='<div style="color:var(--t3);padding:20px">Tags editor not loaded</div>';
}

// ═══ EXPORT TAB ═══
function renderSetExport(c){
  var h='<div class="s-section"><div class="s-section-title">Export as CSV</div>';
  h+='<button class="s-export-btn" onclick="exportCSV(\'screener\')"><div class="se-icon">📊</div><div class="se-info"><div class="se-title">IDX Daily (All Stocks)</div><div class="se-desc">Latest day OHLCV + foreign flow</div></div></button>';
  h+='<button class="s-export-btn" onclick="exportCSV(\'foreign\')"><div class="se-icon">🌍</div><div class="se-info"><div class="se-title">Foreign Flow (5D)</div><div class="se-desc">Net foreign buy/sell ranking</div></div></button>';
  h+='<button class="s-export-btn" onclick="exportCSV(\'fundamental\')"><div class="se-icon">📈</div><div class="se-info"><div class="se-title">Fundamental</div><div class="se-desc">PER, PBV, ROE, sector, industry</div></div></button>';
  h+='<button class="s-export-btn" onclick="exportCSV(\'ca\')"><div class="se-icon">⚡</div><div class="se-info"><div class="se-title">Corporate Actions</div><div class="se-desc">All detected CAs with status</div></div></button>';
  h+='</div><div class="s-info" id="set-export-info"></div>';
  c.innerHTML=h;
}

async function exportCSV(type){
  var info=$('set-export-info');if(info){info.textContent='Generating...';info.className='s-info';}
  try{
    var rows=[],filename='banyu-langit-'+type+'.csv';
    if(type==='screener'){
      var r=await fetch('/api/idx/top?sort=value&dir=desc&limit=999');var d=await r.json();
      if(!d.data||!d.data.length)throw new Error('No data');
      rows=[['Code','Name','Close','Change%','Volume','Value','Frequency','F.Buy','F.Sell','F.Net','Market Cap']];
      d.data.forEach(function(r){rows.push([r.code,r.name,r.close,r.change_pct,r.volume,r.value,r.frequency,r.foreign_buy,r.foreign_sell,r.foreign_net,r.market_cap]);});
      filename='idx-daily-'+d.trade_date+'.csv';
    }else if(type==='foreign'){
      var r=await fetch('/api/idx/foreign?days=5&dir=desc&limit=999');var d=await r.json();
      if(!d.data||!d.data.length)throw new Error('No data');
      rows=[['Code','Name','Close','Buy(IDR)','Sell(IDR)','Net(IDR)','Days','Buy Days']];
      d.data.forEach(function(r){rows.push([r.code,r.name,r.last_close,r.total_buy_val,r.total_sell_val,r.net_flow_val,r.trade_days,r.buy_days]);});
      filename='foreign-flow-5d.csv';
    }else if(type==='fundamental'){
      var r=await fetch('/api/screener/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rules:[],limit:999})});var d=await r.json();
      rows=[['Code','Name','Close','PER','PBV','ROE','ROA','DER','Sector','Industry']];
      (d.data||[]).forEach(function(r){var f=r.fund||{};rows.push([r.code,r.name,r.close,f.per||'',f.pbv||'',f.roe||'',f.roa||'',f.der||'',f.sector||'',f.industry||'']);});
      filename='fundamental.csv';
    }else if(type==='ca'){
      var r=await fetch('/api/idx/ca');var d=await r.json();
      if(!d.data||!d.data.length)throw new Error('No data');
      rows=[['Code','Ex-Date','Type','Ratio','Old Shares','New Shares','Status','Notes']];
      d.data.forEach(function(r){rows.push([r.code,r.ex_date,r.action_type,r.ratio,r.old_shares,r.new_shares,r.status,r.notes]);});
      filename='corporate-actions.csv';
    }
    var csv=rows.map(function(r){return r.map(function(v){var s=String(v==null?'':v);if(s.includes(',')||s.includes('"')||s.includes('\n'))s='"'+s.replace(/"/g,'""')+'"';return s;}).join(',');}).join('\n');
    var blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();
    if(info)info.textContent='Downloaded '+filename+' ('+rows.length+' rows)';
  }catch(e){if(info){info.textContent=e.message;info.className='s-info error';}}
}

// ═══ PREFERENCES TAB ═══
function renderSetPrefs(c){
  var th=document.documentElement.getAttribute('data-theme')||'dark';
  var isCompact=document.body.classList.contains('compact');
  var h='<div class="s-section"><div class="s-section-title">Appearance</div>';
  h+='<div class="s-row"><div class="s-row-icon">🌙</div><div class="s-row-info"><div class="s-row-title">Dark Mode</div><div class="s-row-desc">Toggle dark/light theme</div></div><div class="s-row-action"><div class="s-toggle'+(th==='dark'?' on':'')+'" onclick="prefTogTheme()"></div></div></div>';
  h+='<div class="s-row"><div class="s-row-icon">◻</div><div class="s-row-info"><div class="s-row-title">Compact Mode</div><div class="s-row-desc">Reduce padding for data-dense view</div></div><div class="s-row-action"><div class="s-toggle'+(isCompact?' on':'')+'" onclick="prefTogCompact(this)"></div></div></div>';
  h+='</div>';
  h+='<div class="s-section"><div class="s-section-title">About</div><div style="font-size:var(--font-md);color:var(--t2);line-height:1.8"><b>Banyu Langit</b> v3.0<br>Node.js + Express + SQLite + Deno Bridge<br>IDX market analytics platform</div></div>';
  c.innerHTML=h;
}
function prefTogTheme(){togTh();renderSetPrefs($('smod-content'));}
function prefTogCompact(el){if(typeof toggleCompact==='function')toggleCompact();if(el)el.classList.toggle('on');}
function prefTogChart(el){if(el)el.classList.toggle('on');localStorage.setItem('chartDefault',el&&el.classList.contains('on')?'visible':'hidden');}

// ═══ IDX API SYNC TAB — Main hub ═══
function renderSetIdxApi(c){
  var h='';

  // Import All — top priority button
  h+='<div class="s-section">';
  h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">';
  h+='<button class="s-upload-btn" style="padding:8px 20px;font-size:var(--font-lg);background:var(--bl);color:#fff;border-color:var(--bl)" onclick="idxApiImportAll(this)">Import All from Deno DB</button>';
  h+='<span style="font-size:var(--font-sm);color:var(--t3)">Import semua data yang sudah di-sync Deno ke Banyu Langit</span>';
  h+='</div></div>';

  // Quick actions
  h+='<div class="s-section"><div class="s-section-title">Quick Actions</div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">';
  h+='<button class="s-upload-btn" onclick="idxApiSyncDate(\'stock\')">Import Stock</button>';
  h+='<button class="s-upload-btn" onclick="idxApiSyncDate(\'index\')">Import Index</button>';
  h+='<button class="s-upload-btn" onclick="idxApiSyncDate(\'both\')">Import Both</button>';
  h+='<input type="date" id="idxapi-date" style="padding:4px 8px;border:1px solid var(--b1);border-radius:4px;background:var(--bg0);color:var(--t1);font-size:var(--font-md);font-family:var(--f)">';
  h+='</div>';

  h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
  h+='<button class="s-upload-btn" onclick="idxApiSyncScreener(this)">Import Screener</button>';
  h+='<button class="s-upload-btn" onclick="idxApiSyncProfiles(this)">Import Profiles</button>';
  h+='</div></div>';

  // Backfill
  h+='<div class="s-section"><div class="s-section-title">Backfill Range</div>';
  h+='<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">';
  h+='<input type="date" id="idxapi-from" style="padding:4px 8px;border:1px solid var(--b1);border-radius:4px;background:var(--bg0);color:var(--t1);font-size:var(--font-md);font-family:var(--f)">';
  h+='<span style="color:var(--t3)">to</span>';
  h+='<input type="date" id="idxapi-to" style="padding:4px 8px;border:1px solid var(--b1);border-radius:4px;background:var(--bg0);color:var(--t1);font-size:var(--font-md);font-family:var(--f)">';
  h+='<button class="s-upload-btn" onclick="idxApiBatchSync(\'stock\')">Stock</button>';
  h+='<button class="s-upload-btn" onclick="idxApiBatchSync(\'index\')">Index</button>';
  h+='</div></div>';

  // Monthly
  h+='<div class="s-section"><div class="s-section-title">Monthly Data</div>';
  h+='<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">';
  h+='<input type="number" id="idxapi-year" value="'+new Date().getFullYear()+'" min="2020" max="2030" style="width:60px;padding:4px 6px;border:1px solid var(--b1);border-radius:4px;background:var(--bg0);color:var(--t1);font-size:var(--font-md);font-family:var(--f)">';
  h+='<input type="number" id="idxapi-month" value="'+(new Date().getMonth()+1)+'" min="1" max="12" style="width:44px;padding:4px 6px;border:1px solid var(--b1);border-radius:4px;background:var(--bg0);color:var(--t1);font-size:var(--font-md);font-family:var(--f)">';
  h+='<button class="s-upload-btn" onclick="idxApiSyncMonthly(\'ratios\')">Ratios</button>';
  h+='<button class="s-upload-btn" onclick="idxApiSyncMonthly(\'splits\')">Splits</button>';
  h+='<button class="s-upload-btn" onclick="idxApiSyncMonthly(\'dividends\')">Dividends</button>';
  h+='</div></div>';

  // Status
  h+='<div class="s-section"><div class="s-section-title">Sync Status</div><div id="idxapi-status" style="font-size:var(--font-md);color:var(--t2)">Loading...</div></div>';

  // Log
  h+='<div class="s-section"><div class="s-section-title">Sync Log</div><div id="idxapi-log" style="font-size:var(--font-md);color:var(--t2);max-height:200px;overflow-y:auto">Loading...</div></div>';

  // Result
  h+='<div class="s-info" id="idxapi-result"></div>';

  // Help
  h+='<div style="font-size:var(--font-sm);color:var(--t3);padding:8px;background:var(--bgH);border-radius:4px;margin-top:8px;line-height:1.6">';
  h+='<b>Workflow:</b> Jalankan <code>daily-sync.ps1</code> di PowerShell, atau manual: Deno sync dulu, lalu klik Import All di sini.<br>';
  h+='<b>Note:</b> Data Insider Ownership tetap manual upload via tab Upload.';
  h+='</div>';

  c.innerHTML=h;

  // Set default date
  var today=new Date().toISOString().slice(0,10);
  var el=document.getElementById('idxapi-date');if(el)el.value=today;

  idxApiLoadStatus();
}

function idxApiShowResult(msg,isError){
  var el=document.getElementById('idxapi-result');if(!el)return;
  el.style.display='block';
  el.style.color=isError?'var(--rd)':'var(--gn)';
  el.innerHTML=msg;
  setTimeout(function(){el.style.display='none';},8000);
}

async function idxApiImportAll(btn){
  if(btn){btn.disabled=true;btn.textContent='Importing...';}
  try{
    var r=await fetch('/api/idx/sync/import-all',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    var d=await r.json();
    if(d.error)throw new Error(d.error);
    var detail=d.detail||{};
    var parts=[];
    if(detail.stock&&detail.stock.rows)parts.push('stock:'+detail.stock.rows);
    if(detail.index&&detail.index.rows)parts.push('index:'+detail.index.rows);
    if(detail.screener&&detail.screener.rows)parts.push('screener:'+detail.screener.rows);
    if(detail.fundamental&&detail.fundamental.rows)parts.push('fund:'+detail.fundamental.rows);
    if(detail.dividends&&detail.dividends.rows)parts.push('div:'+detail.dividends.rows);
    if(detail.splits&&detail.splits.rows)parts.push('splits:'+detail.splits.rows);
    if(detail.profiles&&detail.profiles.rows)parts.push('profiles:'+detail.profiles.rows);
    if(detail.details&&detail.details.rows)parts.push('details:'+detail.details.rows);
    idxApiShowResult('Imported '+d.total_rows+' rows ('+parts.join(', ')+')');
    idxApiLoadStatus();
    showT('Import All',d.total_rows+' rows imported');
  }catch(e){idxApiShowResult('Error: '+e.message,true);}
  finally{if(btn){btn.disabled=false;btn.textContent='Import All from Deno DB';}}
}

async function idxApiSyncScreener(btn){
  if(btn){btn.disabled=true;btn.textContent='...';}
  try{
    var r=await fetch('/api/idx/sync/screener',{method:'POST',headers:{'Content-Type':'application/json'}});
    var d=await r.json();if(d.error)throw new Error(d.error);
    idxApiShowResult('Screener: '+d.rows+' stocks');idxApiLoadStatus();
  }catch(e){idxApiShowResult('Error: '+e.message,true);}
  finally{if(btn){btn.disabled=false;btn.textContent='Import Screener';}}
}

async function idxApiSyncProfiles(btn){
  if(btn){btn.disabled=true;btn.textContent='...';}
  try{
    var r=await fetch('/api/idx/sync/company-profiles',{method:'POST',headers:{'Content-Type':'application/json'}});
    var d=await r.json();if(d.error)throw new Error(d.error);
    idxApiShowResult('Profiles: '+(d.profiles||0)+' + Details: '+(d.details||0));idxApiLoadStatus();
  }catch(e){idxApiShowResult('Error: '+e.message,true);}
  finally{if(btn){btn.disabled=false;btn.textContent='Import Profiles';}}
}

async function idxApiSyncDate(type){
  var date=document.getElementById('idxapi-date')?.value;
  if(!date){idxApiShowResult('Pilih tanggal',true);return;}
  idxApiShowResult('Importing '+type+' for '+date+'...');
  try{
    var body=JSON.stringify({date:date});
    if(type==='stock'||type==='both'){
      var r1=await fetch('/api/idx/sync/stock-summary',{method:'POST',headers:{'Content-Type':'application/json'},body:body});
      var d1=await r1.json();if(d1.error)throw new Error(d1.error);
    }
    if(type==='index'||type==='both'){
      var r2=await fetch('/api/idx/sync/index-summary',{method:'POST',headers:{'Content-Type':'application/json'},body:body});
      var d2=await r2.json();if(d2.error)throw new Error(d2.error);
    }
    var msg='';
    if(type==='stock'||type==='both')msg+='Stock: '+(d1?.rows||0);
    if(type==='both')msg+=' | ';
    if(type==='index'||type==='both')msg+='Index: '+(d2?.rows||0);
    idxApiShowResult(msg);idxApiLoadStatus();
  }catch(e){idxApiShowResult('Error: '+e.message,true);}
}

async function idxApiBatchSync(type){
  var from=document.getElementById('idxapi-from')?.value;
  var to=document.getElementById('idxapi-to')?.value;
  if(!from||!to){idxApiShowResult('Set from and to date',true);return;}
  idxApiShowResult('Importing '+type+' '+from+' to '+to+'...');
  try{
    var endpoint=type==='stock'?'/api/idx/sync/batch-stock':'/api/idx/sync/batch-index';
    var r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:from,to:to})});
    var d=await r.json();if(d.error)throw new Error(d.error);
    idxApiShowResult('Imported '+(d.total_rows||0)+' rows');idxApiLoadStatus();
  }catch(e){idxApiShowResult('Error: '+e.message,true);}
}

async function idxApiSyncMonthly(type){
  var year=parseInt(document.getElementById('idxapi-year')?.value);
  var month=parseInt(document.getElementById('idxapi-month')?.value);
  if(!year||!month){idxApiShowResult('Set year and month',true);return;}
  idxApiShowResult('Importing '+type+'...');
  try{
    var endpoints={ratios:'/api/idx/sync/financial-ratios',splits:'/api/idx/sync/stock-splits',dividends:'/api/idx/sync/dividends'};
    var r=await fetch(endpoints[type],{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({year:year,month:month})});
    var d=await r.json();if(d.error)throw new Error(d.error);
    idxApiShowResult(type+': '+(d.rows||0)+' rows');idxApiLoadStatus();
  }catch(e){idxApiShowResult('Error: '+e.message,true);}
}

async function idxApiLoadStatus(){
  try{
    var r=await fetch('/api/idx/sync/status');var d=await r.json();
    var el=document.getElementById('idxapi-status');
    if(el){
      var h='<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 14px">';
      h+='<span>Stock Latest: <b>'+(d.latest?.stock||'--')+'</b></span>';
      h+='<span>Index Latest: <b>'+(d.latest?.index||'--')+'</b></span>';
      h+='<span>Fund Latest: <b>'+(d.latest?.fundamental||'--')+'</b></span>';
      h+='<span>Tickers: <b>'+(d.counts?.tickers||0)+'</b></span>';
      h+='<span>Stock Days: <b>'+(d.counts?.stock_dates||0)+'</b></span>';
      h+='<span>Index Days: <b>'+(d.counts?.index_dates||0)+'</b></span>';
      h+='</div>';
      el.innerHTML=h;
    }
    var logEl=document.getElementById('idxapi-log');
    if(logEl&&d.recent_syncs){
      if(!d.recent_syncs.length){logEl.innerHTML='<div style="color:var(--t3)">No sync history</div>';return;}
      var h2='<table class="s-ca-tbl"><thead><tr><th>Time</th><th>Type</th><th>Date</th><th class="ar">Rows</th><th>Status</th></tr></thead><tbody>';
      d.recent_syncs.forEach(function(l){
        var time=l.finished_at?new Date(l.finished_at+'Z').toLocaleString('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'--';
        var statusColor=l.status==='ok'?'var(--gn)':l.status==='error'?'var(--rd)':'var(--t3)';
        h2+='<tr><td style="white-space:nowrap">'+time+'</td><td>'+l.sync_type+'</td><td>'+l.sync_date+'</td><td class="ar">'+l.rows_synced+'</td><td style="color:'+statusColor+'">'+l.status+(l.message?' -- '+l.message.slice(0,50):'')+'</td></tr>';
      });
      h2+='</tbody></table>';
      logEl.innerHTML=h2;
    }
  }catch(e){
    var el2=document.getElementById('idxapi-status');if(el2)el2.textContent='Error loading status';
  }
}

// ═══ Backward compat — old upload functions that might be called ═══
async function setUploadQuarterly(input){input.value='';showT('Info','Use IDX API Sync instead');}
async function renderUploadLogs(){}
