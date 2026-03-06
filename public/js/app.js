// THEME
function togTh(){const h=document.documentElement;const n=h.getAttribute('data-theme')==='dark'?'light':'dark';h.setAttribute('data-theme',n);$('thbtn').textContent=n==='dark'?'🌙':'☀️';localStorage.setItem('th',n);if(!chartHidden)loadChart();}

// ═══ SETTINGS MODAL ═══
let setActiveTab='upload';

function openSettings(){
  $('smod').classList.add('o');
  setTab('upload',document.querySelector('.smod-nav-item'));
  fetch('/api/idx/ca/stats').then(r=>r.json()).then(d=>{
    var b=$('smod-ca-badge');
    if(d.pending>0){b.textContent=d.pending;b.style.display='';}
    else{b.style.display='none';}
  }).catch(function(){});
}

function closeSettings(){$('smod').classList.remove('o');}

function setTab(tab,el){
  setActiveTab=tab;
  document.querySelectorAll('.smod-nav-item').forEach(x=>x.classList.remove('on'));
  if(el)el.classList.add('on');
  var titles={upload:'📊 Data Upload',dbstats:'🗄 Database',ca:'⚡ Corporate Actions',export:'📥 Export Data',prefs:'🎨 Preferences'};
  $('smod-title').innerHTML='<span class="sbh-icon">'+titles[tab].split(' ')[0]+'</span> '+titles[tab].split(' ').slice(1).join(' ');
  var c=$('smod-content');
  c.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">Loading...</div>';
  if(tab==='upload')renderSetUpload(c);
  else if(tab==='dbstats')renderSetDbStats(c);
  else if(tab==='ca')renderSetCA(c);
  else if(tab==='export')renderSetExport(c);
  else if(tab==='prefs')renderSetPrefs(c);
}

// ── Upload Tab ──
function renderSetUpload(c){
  var h='';
  h+='<div class="s-section"><div class="s-section-title">Upload Data</div>';
  h+='<div class="s-row"><div class="s-row-icon">📋</div><div class="s-row-info"><div class="s-row-title">Insider Ownership (XLSX)</div><div class="s-row-desc">BEI monthly shareholder data</div></div><div class="s-row-action"><label class="s-upload-btn">Choose File<input type="file" accept=".xlsx,.xls" onchange="setUploadInsider(this)"></label></div></div>';
  h+='<div class="s-row"><div class="s-row-icon">🏷</div><div class="s-row-info"><div class="s-row-title">Investor Tags (XLSX)</div><div class="s-row-desc">Conglomerate groups, keyword rules, ticker map</div></div><div class="s-row-action"><label class="s-upload-btn">Choose File<input type="file" accept=".xlsx" onchange="setUploadTags(this)"></label></div></div>';
  h+='<div class="s-row"><div class="s-row-icon">📊</div><div class="s-row-info"><div class="s-row-title">IDX Daily (Ringkasan Saham)</div><div class="s-row-desc">Daily OHLCV + foreign flow. Supports bulk (500 files)</div></div><div class="s-row-action"><label class="s-upload-btn">Choose Files<input type="file" accept=".xlsx,.xls" multiple onchange="setUploadIdx(this)"></label></div></div>';
  h+='<div class="s-row"><div class="s-row-icon">📈</div><div class="s-row-info"><div class="s-row-title">Fundamental (BEI Screener)</div><div class="s-row-desc">PER, PBV, ROE, ROA, DER, NPM, Sector, Industry</div></div><div class="s-row-action"><label class="s-upload-btn">Choose File<input type="file" accept=".xlsx,.xls" onchange="setUploadFund(this)"></label></div></div>';
  h+='</div>';
  h+='<div class="s-info" id="set-upload-info"></div>';
  h+='<div class="s-section"><div class="s-section-title">Current Data</div><div id="set-tag-stats" style="font-size:12px;color:var(--t2);line-height:1.8">Loading...</div></div>';
  c.innerHTML=h;
  Promise.all([
    fetch('/api/insider/tags/stats').then(r=>r.json()),
    fetch('/api/insider/stats').then(r=>r.json()),
    fetch('/api/idx/stats').then(r=>r.json()),
    fetch('/api/idx/fundamental/stats').then(r=>r.json())
  ]).then(function([tags,ins,idx,fund]){
    var el=$('set-tag-stats');if(!el)return;
    var h='<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px">';
    h+='<span>🏷 Groups: <b>'+tags.groups+'</b></span><span>📋 Rules: <b>'+tags.rules+'</b></span>';
    h+='<span>🔄 Overrides: <b>'+tags.overrides+'</b></span><span>📌 Ticker Map: <b>'+tags.ticker_map+'</b></span></div>';
    if(ins.total){h+='<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--b1)">👥 Holdings: <b>'+ins.total.toLocaleString()+'</b> · Tickers: <b>'+ins.tickers+'</b> · Investors: <b>'+ins.investors.toLocaleString()+'</b>'+(ins.latest?' · Last: <b>'+ins.latest+'</b>':'')+'</div>';}
    if(idx.total){h+='<div style="margin-top:6px">📊 IDX: <b>'+idx.total.toLocaleString()+'</b> records · <b>'+idx.tickers+'</b> tickers · <b>'+idx.dates+'</b> days'+(idx.latest?' · Latest: <b>'+idx.latest+'</b>':'')+'</div>';}
    if(fund.total){h+='<div style="margin-top:6px">📈 Fundamental: <b>'+fund.total+'</b> stocks'+(fund.snapshot_month?' · Month: <b>'+fund.snapshot_month+'</b>':'')+'</div>';}
    el.innerHTML=h;
  }).catch(function(){var el=$('set-tag-stats');if(el)el.textContent='Error loading stats';});
}

async function setUploadInsider(input){
  if(!input.files[0])return;var fd=new FormData();fd.append('file',input.files[0]);
  var info=$('set-upload-info');info.textContent='Uploading insider data...';info.className='s-info';
  try{var r=await fetch('/api/insider/upload',{method:'POST',body:fd});var d=await r.json();
    if(d.success){info.textContent='✅ Loaded '+d.total.toLocaleString()+' records, '+d.tickers+' tickers';showT('Insider Data','Uploaded '+d.total.toLocaleString()+' records');if(typeof insHome==='function')insHome();}
    else{info.textContent='❌ '+(d.error||'unknown');info.className='s-info error';}
  }catch(e){info.textContent='❌ '+e.message;info.className='s-info error';}input.value='';
}
async function setUploadTags(input){
  if(!input.files[0])return;var fd=new FormData();fd.append('file',input.files[0]);
  var info=$('set-upload-info');info.textContent='Uploading tags...';info.className='s-info';
  try{var r=await fetch('/api/insider/tags/upload',{method:'POST',body:fd});var d=await r.json();
    if(d.success){info.textContent='✅ Tags: '+d.groups+' groups, '+d.rules+' rules';showT('Tags Updated',d.groups+' groups loaded');}
    else{info.textContent='❌ '+(d.error||'unknown');info.className='s-info error';}
  }catch(e){info.textContent='❌ '+e.message;info.className='s-info error';}input.value='';
}
async function setUploadIdx(input){
  if(!input.files.length)return;var fd=new FormData();
  for(var i=0;i<input.files.length;i++)fd.append('file',input.files[i]);
  var info=$('set-upload-info');info.textContent='Uploading '+input.files.length+' file(s)...';info.className='s-info';
  try{var r=await fetch('/api/idx/upload',{method:'POST',body:fd});var d=await r.json();
    if(d.success){
      var msg='✅ IDX: '+d.imported.toLocaleString()+' records, '+d.dates+' dates, '+d.tickers+' tickers';
      if(d.detected_ca&&d.detected_ca.length){
        msg+='\n⚡ '+d.detected_ca.length+' corporate action(s) detected!';
        showT('⚡ Corp Action Detected',d.detected_ca.length+' action(s) found. Check Corp Actions tab.');
      }else{showT('IDX Data','Imported '+d.imported.toLocaleString()+' records');}
      info.textContent=msg;
      if(typeof beiStats!=='undefined')beiStats=null;
    }else{info.textContent='❌ '+(d.error||'unknown');info.className='s-info error';}
  }catch(e){info.textContent='❌ '+e.message;info.className='s-info error';}input.value='';
}
async function setUploadFund(input){
  if(!input.files[0])return;var fd=new FormData();fd.append('file',input.files[0]);
  var info=$('set-upload-info');info.textContent='Uploading fundamental data...';info.className='s-info';
  try{var r=await fetch('/api/idx/fundamental/upload',{method:'POST',body:fd});var d=await r.json();
    if(d.success){info.textContent='✅ Fundamental: '+d.count+' stocks ('+d.snapshot_month+')';showT('Fundamental',d.count+' stocks loaded');}
    else{info.textContent='❌ '+(d.error||'unknown');info.className='s-info error';}
  }catch(e){info.textContent='❌ '+e.message;info.className='s-info error';}input.value='';
}

// ── Database Stats Tab ──
async function renderSetDbStats(c){
  c.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3)">Loading...</div>';
  try{
    var [idx,ins,fund,ca]=await Promise.all([
      fetch('/api/idx/stats').then(r=>r.json()),
      fetch('/api/insider/stats').then(r=>r.json()),
      fetch('/api/idx/fundamental/stats').then(r=>r.json()),
      fetch('/api/idx/ca/stats').then(r=>r.json())
    ]);
    var h='<div class="s-stats">';
    h+='<div class="s-stat"><div class="s-stat-val">'+(idx.total||0).toLocaleString()+'</div><div class="s-stat-lbl">IDX Records</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val">'+(idx.tickers||0)+'</div><div class="s-stat-lbl">Tickers</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val">'+(idx.dates||0)+'</div><div class="s-stat-lbl">Trading Days</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val">'+(ins.total||0).toLocaleString()+'</div><div class="s-stat-lbl">Holdings</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val">'+(ins.investors||0).toLocaleString()+'</div><div class="s-stat-lbl">Investors</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val">'+(fund.total||0)+'</div><div class="s-stat-lbl">Fundamentals</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val am">'+(ca.pending||0)+'</div><div class="s-stat-lbl">CA Pending</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val up">'+(ca.confirmed||0)+'</div><div class="s-stat-lbl">CA Confirmed</div></div>';
    h+='</div>';
    h+='<div class="s-section"><div class="s-section-title">IDX Daily Range</div>';
    if(idx.oldest&&idx.latest)h+='<div style="font-size:12px;color:var(--t2)">📅 <b>'+idx.oldest+'</b> → <b>'+idx.latest+'</b></div>';
    if(idx.all_dates&&idx.all_dates.length>=2){
      var ds=new Set(idx.all_dates);var first=new Date(idx.all_dates[0]+'T00:00:00');var lastD=new Date(idx.all_dates[idx.all_dates.length-1]+'T00:00:00');
      var missing=[];var cc=new Date(first);cc.setDate(cc.getDate()+1);
      while(cc<=lastD){var dow=cc.getDay();var iso=cc.toISOString().split('T')[0];if(dow!==0&&dow!==6&&!ds.has(iso))missing.push(iso);cc.setDate(cc.getDate()+1);}
      if(missing.length>0){
        h+='<div style="margin-top:8px;font-size:12px;color:var(--rd)">⚠️ '+missing.length+' gap(s)'+(missing.length>20?' (mungkin libur nasional)':'')+'</div>';
        if(missing.length<=20){h+='<div class="s-gap-list">';missing.forEach(function(d){h+='<span class="s-gap-item">'+d+'</span>';});h+='</div>';}
      }else h+='<div style="margin-top:8px;font-size:12px;color:var(--gn)">✅ No gaps</div>';
    }
    h+='</div>';
    if(ins.latest){h+='<div class="s-section"><div class="s-section-title">Insider Ownership</div><div style="font-size:12px;color:var(--t2)">📅 Last: <b>'+ins.latest+'</b> · '+ins.tickers+' tickers</div></div>';}
    if(fund.snapshot_month){h+='<div class="s-section"><div class="s-section-title">Fundamental</div><div style="font-size:12px;color:var(--t2)">📅 <b>'+fund.snapshot_month+'</b> · '+fund.total+' stocks · '+(fund.sectors?fund.sectors.length:0)+' sectors</div></div>';}
    c.innerHTML=h;
  }catch(e){c.innerHTML='<div style="color:var(--rd);padding:20px">Error: '+e.message+'</div>';}
}

// ── Corporate Actions Tab ──
async function renderSetCA(c){
  c.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3)">Loading...</div>';
  try{
    var [all,stats]=await Promise.all([fetch('/api/idx/ca').then(r=>r.json()),fetch('/api/idx/ca/stats').then(r=>r.json())]);
    var rows=all.data||[];var h='';
    h+='<div class="s-stats">';
    h+='<div class="s-stat"><div class="s-stat-val am">'+(stats.pending||0)+'</div><div class="s-stat-lbl">Pending</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val up">'+(stats.confirmed||0)+'</div><div class="s-stat-lbl">Confirmed</div></div>';
    h+='<div class="s-stat"><div class="s-stat-val">'+(stats.total||0)+'</div><div class="s-stat-lbl">Total</div></div></div>';
    h+='<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">';
    if(stats.pending>0){h+='<button class="s-ca-btn confirm" onclick="setCAConfirmAll()">✓ Confirm All</button><button class="s-ca-btn dismiss" onclick="setCADismissAll()">✕ Dismiss All</button>';}
    h+='<button class="s-ca-btn" onclick="setCARedetect()">🔄 Re-detect</button></div>';
    if(!rows.length){h+='<div style="text-align:center;padding:24px;color:var(--t3);font-size:12px">No corporate actions. Upload multi-day IDX data for auto-detection.</div>';c.innerHTML=h;return;}
    h+='<div style="overflow-y:auto;max-height:calc(80vh - 280px)"><table class="s-ca-tbl"><thead><tr><th>Code</th><th>Ex-Date</th><th>Type</th><th style="text-align:right">Ratio</th><th style="text-align:right">Old Shares</th><th style="text-align:right">New Shares</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(function(r){
      var sCls=r.status==='pending'?'pending':r.status==='confirmed'?'confirmed':'dismissed';
      var typeLbl={split:'SPLIT',reverse:'REVERSE',rights_or_bonus:'RIGHTS/BONUS',unknown:'UNKNOWN',manual:'MANUAL'}[r.action_type]||r.action_type.toUpperCase();
      h+='<tr><td style="font-weight:700;color:var(--bl)">'+r.code+'</td><td>'+r.ex_date+'</td><td>'+typeLbl+'</td><td style="text-align:right;font-weight:700">'+r.ratio.toFixed(2)+'x</td><td style="text-align:right">'+(r.old_shares||0).toLocaleString()+'</td><td style="text-align:right">'+(r.new_shares||0).toLocaleString()+'</td><td><span class="s-ca-status '+sCls+'">'+(r.status==='pending'?'⏳':r.status==='confirmed'?'✅':'❌')+' '+r.status+'</span></td><td style="white-space:nowrap">';
      if(r.status==='pending')h+='<button class="s-ca-btn confirm" onclick="setCAConfirm('+r.id+')">✓</button> <button class="s-ca-btn dismiss" onclick="setCADismiss('+r.id+')">✕</button>';
      else h+='<button class="s-ca-btn" onclick="setCADelete('+r.id+')">🗑</button>';
      h+='</td></tr>';
    });
    h+='</tbody></table></div>';
    h+='<div style="font-size:10px;color:var(--t3);margin-top:12px;padding:10px;background:var(--bgH);border-radius:8px">💡 Auto-detect: listed_shares change ≥1.5x or ≤0.67x. Confirm to enable adjusted OHLC.</div>';
    c.innerHTML=h;
  }catch(e){c.innerHTML='<div style="color:var(--rd);padding:20px">Error: '+e.message+'</div>';}
}

async function setCAConfirm(id){try{await fetch('/api/idx/ca/'+id+'/confirm',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'});showT('✅','Confirmed');renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCADismiss(id){try{await fetch('/api/idx/ca/'+id+'/dismiss',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'});showT('✅','Dismissed');renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCADelete(id){if(!confirm('Delete?'))return;try{await fetch('/api/idx/ca/'+id,{method:'DELETE'});renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCAConfirmAll(){if(!confirm('Confirm all pending?'))return;try{var r=await fetch('/api/idx/ca/confirm-all',{method:'POST'});var d=await r.json();showT('✅','Confirmed '+d.confirmed);renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCADismissAll(){if(!confirm('Dismiss all pending?'))return;try{var r=await fetch('/api/idx/ca/dismiss-all',{method:'POST'});var d=await r.json();showT('✅','Dismissed '+d.dismissed);renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCARedetect(){try{var r=await fetch('/api/idx/ca/detect',{method:'POST'});var d=await r.json();showT('🔄','Detected '+d.total+' new');renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}

// ── Export Tab ──
function renderSetExport(c){
  var h='<div class="s-section"><div class="s-section-title">Export Data as CSV</div>';
  h+='<button class="s-export-btn" onclick="exportCSV(\'screener\')"><div class="se-icon">🔬</div><div class="se-info"><div class="se-title">IDX Daily (All Stocks)</div><div class="se-desc">Latest day, OHLCV + foreign flow + market cap</div></div></button>';
  h+='<button class="s-export-btn" onclick="exportCSV(\'foreign\')"><div class="se-icon">🌍</div><div class="se-info"><div class="se-title">Foreign Flow (5D)</div><div class="se-desc">Net foreign buy/sell ranking, last 5 trading days</div></div></button>';
  h+='<button class="s-export-btn" onclick="exportCSV(\'fundamental\')"><div class="se-icon">📈</div><div class="se-info"><div class="se-title">Fundamental Data</div><div class="se-desc">PER, PBV, ROE, ROA, sector, industry</div></div></button>';
  h+='<button class="s-export-btn" onclick="exportCSV(\'ca\')"><div class="se-icon">⚡</div><div class="se-info"><div class="se-title">Corporate Actions</div><div class="se-desc">All detected corporate actions with status</div></div></button>';
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
      rows=[['Code','Name','Close','Buy(IDR)','Sell(IDR)','Net(IDR)','Buy Shares','Sell Shares','Net Shares','Days','Buy Days']];
      d.data.forEach(function(r){rows.push([r.code,r.name,r.last_close,r.total_buy_val,r.total_sell_val,r.net_flow_val,r.total_buy_shares,r.total_sell_shares,r.net_flow_shares,r.trade_days,r.buy_days]);});
      filename='foreign-flow-5d.csv';
    }else if(type==='fundamental'){
      var r=await fetch('/api/screener/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rules:[],limit:999})});var d=await r.json();
      rows=[['Code','Name','Close','PER','PBV','ROE','ROA','DER','NPM','Mkt Cap','Sector','Industry']];
      (d.data||[]).forEach(function(r){var f=r.fund||{};rows.push([r.code,r.name,r.close,f.per||'',f.pbv||'',f.roe||'',f.roa||'',f.der||'',f.npm||'',f.mkt_cap||'',f.sector||'',f.industry||'']);});
      filename='fundamental.csv';
    }else if(type==='ca'){
      var r=await fetch('/api/idx/ca');var d=await r.json();
      if(!d.data||!d.data.length)throw new Error('No data');
      rows=[['Code','Ex-Date','Type','Ratio','Old Shares','New Shares','Old Close','New Close','Status','Notes']];
      d.data.forEach(function(r){rows.push([r.code,r.ex_date,r.action_type,r.ratio,r.old_shares,r.new_shares,r.old_close,r.new_close,r.status,r.notes]);});
      filename='corporate-actions.csv';
    }
    var csv=rows.map(function(r){return r.map(function(v){var s=String(v==null?'':v);if(s.includes(',')||s.includes('"')||s.includes('\n'))s='"'+s.replace(/"/g,'""')+'"';return s;}).join(',');}).join('\n');
    var blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();
    if(info){info.textContent='✅ Downloaded '+filename+' ('+rows.length+' rows)';}
  }catch(e){if(info){info.textContent='❌ '+e.message;info.className='s-info error';}}
}

// ── Preferences Tab ──
function renderSetPrefs(c){
  var th=document.documentElement.getAttribute('data-theme')||'light';
  var h='<div class="s-section"><div class="s-section-title">Appearance</div>';
  h+='<div class="s-row"><div class="s-row-icon">🌙</div><div class="s-row-info"><div class="s-row-title">Dark Mode</div><div class="s-row-desc">Toggle between dark and light theme</div></div><div class="s-row-action"><div class="s-toggle'+(th==='dark'?' on':'')+'" onclick="prefTogTheme()"></div></div></div>';
  h+='<div class="s-row"><div class="s-row-icon">📊</div><div class="s-row-info"><div class="s-row-title">Show Chart on Startup</div><div class="s-row-desc">TradingView chart visible when app loads</div></div><div class="s-row-action"><div class="s-toggle'+(localStorage.getItem('chartDefault')==='visible'?' on':'')+'" onclick="prefTogChart(this)"></div></div></div>';
  h+='</div>';
  h+='<div class="s-section"><div class="s-section-title">About</div><div style="font-size:12px;color:var(--t2);line-height:1.8"><b>Banyu Langit Trading Diary</b> v2.1<br>Node.js + Express + SQLite + Vanilla JS<br>IDX market analytics & insider ownership tracker</div></div>';
  c.innerHTML=h;
}
function prefTogTheme(){togTh();renderSetPrefs($('smod-content'));}
function prefTogChart(el){if(el)el.classList.toggle('on');var show=el&&el.classList.contains('on');localStorage.setItem('chartDefault',show?'visible':'hidden');}

// ═══ CHART ═══
function loadChart(){
  const th=document.documentElement.getAttribute('data-theme')||'light';
  const bg=th==='dark'?'#0F0F0F':'#ffffff';
  const gr=th==='dark'?'rgba(242,242,242,0.06)':'rgba(0,0,0,0.06)';
  const cfg=JSON.stringify({"allow_symbol_change":true,"calendar":false,"details":true,"hide_side_toolbar":false,"hide_top_toolbar":false,"hide_legend":false,"hide_volume":false,"hotlist":false,"interval":"D","locale":"en","save_image":true,"style":"1","symbol":"IDX:COMPOSITE","theme":th,"timezone":"Asia/Jakarta","backgroundColor":bg,"gridColor":gr,"watchlist":[],"withdateranges":true,"compareSymbols":[],"studies":[],"autosize":true});
  const html=`<!DOCTYPE html><html><head><style>body{margin:0;overflow:hidden;height:100vh}</style></head><body><div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:calc(100% - 32px);width:100%"></div><script src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>${cfg}<\/script></div></body></html>`;
  const f=document.createElement('iframe');f.style.cssText='width:100%;height:100%;border:none';
  $('chart').innerHTML='';$('chart').appendChild(f);
  f.contentDocument.open();f.contentDocument.write(html);f.contentDocument.close();
}

// TABS
function stab(n,b){document.querySelectorAll('.tabs .tab').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.querySelectorAll('.tpanel').forEach(p=>p.classList.remove('on'));$('t-'+n).classList.add('on');if(n==='wl'){loadWL();loadAl();}if(n==='mkt')loadMkt('indices','ml-idx');if(n==='ins')chkIns();}
function swt(n,b){const panel=b.closest('.tpanel');panel.querySelectorAll('.wt-b').forEach(x=>x.classList.remove('on'));b.classList.add('on');panel.querySelectorAll('.wp').forEach(p=>p.classList.remove('on'));$('w-'+n).classList.add('on');}
function smkt(n,b){const panel=b.closest('.tpanel');panel.querySelectorAll('.wt-b').forEach(x=>x.classList.remove('on'));b.classList.add('on');panel.querySelectorAll('.wp').forEach(p=>p.classList.remove('on'));$('m-'+n).classList.add('on');if(n==='idx')loadMkt('indices','ml-idx');if(n==='cmd')loadMkt('commodities','ml-cmd');if(n==='cur')loadMkt('currencies','ml-cur');if(n==='bei')loadBei();if(n==='scr')loadScreener();if(n==='nws')lNews('');}
function sins(n,b){const panel=b.closest('.tpanel');panel.querySelectorAll('.wt-b').forEach(x=>x.classList.remove('on'));b.classList.add('on');panel.querySelectorAll('.wp').forEach(p=>p.classList.remove('on'));$('i-'+n).classList.add('on');}

const mktCache={};
async function loadMkt(cat,elId){const el=$(elId);if(!el)return;if(mktCache[cat]&&Date.now()-mktCache[cat].ts<60000){renderMkt(mktCache[cat].data,el);return;}el.innerHTML='<div class="ne">Loading...</div>';try{const r=await fetch(`/api/market?cat=${cat}`);const data=await r.json();mktCache[cat]={data,ts:Date.now()};renderMkt(data,el);}catch{el.innerHTML='<div class="ne">Failed to load.</div>';}}
function renderMkt(data,el){if(!data.length){el.innerHTML='<div class="ne">No data.</div>';return;}el.innerHTML=data.map(m=>{const c=m.change>0?'up':m.change<0?'dn':'fl';const ar=m.change>0?'▲':m.change<0?'▼':'';const s=m.change>0?'+':'';const pr=m.price?m.price.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'—';const ch=m.price?`${ar} ${s}${m.change.toFixed(2)}%`:'—';return`<div class="mkt-item"><span class="mkt-label">${esc(m.label)}</span><span class="mkt-desc">${esc(m.desc)}</span><span class="mkt-price">${pr}</span><span class="mkt-chg ${c}">${ch}</span></div>`;}).join('');}

// RESIZE + CHART TOGGLE
let chartHidden=false;
function togChart(){
  var pr=document.querySelector('.pR');var pl=$('pL');var rh=$('rh');var btn=$('chtog');
  if(chartHidden){pr.style.display='';rh.style.display='';pl.style.width=pl.dataset.prevW||'420px';pl.style.maxWidth='800px';document.querySelector('.layout').classList.remove('ctr');btn.style.background='';chartHidden=false;loadChart();}
  else{pl.dataset.prevW=pl.offsetWidth+'px';pl.style.width='1220px';pl.style.maxWidth='1220px';document.querySelector('.layout').classList.add('ctr');pr.style.display='none';rh.style.display='none';btn.style.background='var(--blB)';chartHidden=true;}
}
(function(){var h=$('rh'),p=$('pL');var sx,sw;
h.addEventListener('mousedown',function(e){sx=e.clientX;sw=p.offsetWidth;h.classList.add('ac');document.body.classList.add('rz');document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);});
function mv(e){p.style.width=Math.max(280,Math.min(800,sw+(e.clientX-sx)))+'px';}
function up(){h.classList.remove('ac');document.body.classList.remove('rz');document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);}
})();

// ═══ Keyboard Shortcuts ═══
document.addEventListener('keydown',function(e){
  var tag=e.target.tagName;if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
  if(e.key==='/'){e.preventDefault();var gs=$('gsearch');if(gs){gs.focus();gs.select();}}
  if(e.key>='1'&&e.key<='4'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){var tabs=document.querySelectorAll('.tabs .tab');var idx=parseInt(e.key)-1;if(tabs[idx]){tabs[idx].click();e.preventDefault();}}
  if(e.key==='c'){var ct=$('cta');if(ct){ct.focus();e.preventDefault();}}
  if(e.key==='?'){showT('Shortcuts','/ Search · 1-4 Tabs · C Compose · Esc Close');e.preventDefault();}
  if(e.key==='Escape')closeSettings();
});

// ═══ INIT: Theme + Chart default ═══
(function(){
  var saved=localStorage.getItem('th');
  if(saved){document.documentElement.setAttribute('data-theme',saved);$('thbtn').textContent=saved==='dark'?'🌙':'☀️';}
  // Chart: default hidden unless user set visible
  var chartPref=localStorage.getItem('chartDefault');
  if(chartPref!=='visible'){setTimeout(function(){if(!chartHidden)togChart();},100);}
})();