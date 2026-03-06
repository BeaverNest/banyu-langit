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


// ═══ SCREENER SUBTABS ═══
let cmpTickers=[],cmpColors=['#0ea5e9','#ef4444','#22c55e','#f59e0b','#a855f7','#ec4899','#14b8a6','#f97316'];

function scrSubTab(n,b){
  var panel=b.closest('.tpanel');
  panel.querySelectorAll('.wt-b').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');
  panel.querySelectorAll('.wp').forEach(p=>p.classList.remove('on'));
  $('scr-'+n).classList.add('on');
  if(n==='screener')loadScreener();
  if(n==='sectors')loadSectorView();
  if(n==='compare')renderCompare();
}

// ═══ COMPARISON — Multi-mode: Ticker / Sector / Industry / Konglomerat ═══
let cmpRange='6m';
let cmpMode='ticker'; // ticker | sector | industry | konglo
let cmpItems=[]; // selected items for current mode (tickers or group names)
let cmpGroupOptions=null; // cached dropdown options

function renderCompare(){
  var el=$('compare-content');if(!el)return;
  var h='<div style="padding:12px;font-family:var(--f)">';
  h+='<div style="font-weight:700;font-size:14px;margin-bottom:10px">📈 Comparison</div>';

  // ── Mode selector ──
  h+='<div style="display:flex;gap:3px;margin-bottom:10px;flex-wrap:wrap">';
  [{k:'ticker',l:'📊 Ticker',d:'Saham vs Saham'},{k:'sector',l:'🏢 Sector',d:'Sector vs Sector'},{k:'industry',l:'🏭 Industry',d:'Industry vs Industry'},{k:'konglo',l:'👑 Konglomerat',d:'Grup vs Grup'}].forEach(function(m){
    h+='<button class="bei-sort-btn'+(cmpMode===m.k?' on':'')+'" onclick="cmpSwitchMode(\''+m.k+'\')" title="'+m.d+'" style="padding:4px 10px;font-size:11px">'+m.l+'</button>';
  });
  h+='</div>';

  // ── Input area (varies by mode) ──
  h+='<div class="cmp-input-bar">';
  if(cmpMode==='ticker'){
    h+='<input id="cmp-input" class="bei-filter-input" style="max-width:160px" placeholder="Add ticker (BBCA)" onkeydown="if(event.key===\'Enter\')cmpAdd()">';
    h+='<button class="bei-tab on" style="font-size:11px;padding:4px 12px" onclick="cmpAdd()">+ Add</button>';
  }else{
    h+='<select id="cmp-group-sel" class="bei-filter-sel" style="min-width:200px"><option value="">Select '+cmpModeLabel()+'...</option></select>';
    h+='<button class="bei-tab on" style="font-size:11px;padding:4px 12px" onclick="cmpAddGroup()">+ Add</button>';
  }
  if(cmpItems.length)h+='<button class="bei-filter-clear" onclick="cmpItems=[];renderCompare()">Clear All</button>';
  h+='<span style="flex:1"></span>';
  h+='<span style="font-size:10px;color:var(--t3)">Max 8 · Normalized % change</span>';
  h+='</div>';

  // ── Selected items chips ──
  if(cmpItems.length){
    h+='<div class="cmp-chips">';
    cmpItems.forEach(function(t,i){
      h+='<span class="cmp-chip" style="border-color:'+cmpColors[i%8]+'">';
      h+='<span class="cmp-chip-dot" style="background:'+cmpColors[i%8]+'"></span>'+esc(t);
      h+='<button class="cmp-chip-x" onclick="cmpItems.splice('+i+',1);renderCompare()">✕</button></span>';
    });
    h+='</div>';
  }

  // ── Range buttons ──
  h+='<div class="cmp-range-bar">';
  [{k:'1m',l:'1M'},{k:'3m',l:'3M'},{k:'6m',l:'6M'},{k:'1y',l:'1Y'},{k:'3y',l:'3Y'},{k:'5y',l:'5Y'},{k:'all',l:'ALL'}].forEach(function(r){
    h+='<button class="bei-sort-btn'+(cmpRange===r.k?' on':'')+'" onclick="cmpRange=\''+r.k+'\';cmpLoadData()">'+r.l+'</button>';
  });
  h+='</div>';

  // ── Chart + Summary placeholders ──
  h+='<div id="cmp-chart" class="cmp-chart-area"></div>';
  h+='<div id="cmp-summary"></div>';
  h+='<div id="cmp-detail" style="margin-top:8px"></div>';
  h+='</div>';
  el.innerHTML=h;

  // Load group options for dropdown
  if(cmpMode!=='ticker')cmpLoadGroupOptions();

  // Auto-load if enough items
  if(cmpItems.length>=2)cmpLoadData();
  else{
    var minLabel=cmpMode==='ticker'?'tickers':cmpModeLabel()+'s';
    $('cmp-chart').innerHTML='<div class="ne" style="padding:30px">Add 2+ '+minLabel+' to compare</div>';
  }
}

function cmpModeLabel(){return{ticker:'Ticker',sector:'Sector',industry:'Industry',konglo:'Konglomerat'}[cmpMode]||'Item';}

function cmpSwitchMode(mode){
  if(cmpMode===mode)return;
  cmpMode=mode;
  cmpItems=[];
  cmpGroupOptions=null;
  renderCompare();
}

// ── Add ticker (existing logic) ──
function cmpAdd(){
  var inp=$('cmp-input');if(!inp)return;
  var code=inp.value.trim().toUpperCase();if(!code)return;
  if(cmpItems.includes(code)){showT('⚠','Already added');return;}
  if(cmpItems.length>=8){showT('⚠','Max 8');return;}
  cmpItems.push(code);inp.value='';renderCompare();
}

// ── Add group from dropdown ──
function cmpAddGroup(){
  var sel=$('cmp-group-sel');if(!sel||!sel.value)return;
  var name=sel.value;
  if(cmpItems.includes(name)){showT('⚠','Already added');return;}
  if(cmpItems.length>=8){showT('⚠','Max 8');return;}
  cmpItems.push(name);sel.value='';renderCompare();
}

// ── Load dropdown options from backend ──
async function cmpLoadGroupOptions(){
  var sel=$('cmp-group-sel');if(!sel)return;
  try{
    var url='/api/idx/compare-groups?mode='+cmpMode;
    var r=await fetch(url);var d=await r.json();
    var items=d.items||[];
    var h='<option value="">Select '+cmpModeLabel()+'...</option>';
    items.forEach(function(item){
      var label=item.name;
      var extra='';
      if(item.count)extra=' ('+item.count+')';
      if(item.category&&cmpMode==='konglo')extra=' · '+item.category+extra;
      if(item.key_person&&cmpMode==='konglo')label+=' — '+item.key_person;
      // Skip if already selected
      if(cmpItems.includes(item.name))return;
      h+='<option value="'+esc(item.name)+'">'+esc(label)+extra+'</option>';
    });
    sel.innerHTML=h;
    cmpGroupOptions=items;
  }catch(e){console.error('Group options error:',e);}
}

// ═══ LOAD DATA — unified for all modes ═══
async function cmpLoadData(){
  var chartEl=$('cmp-chart'),sumEl=$('cmp-summary'),detailEl=$('cmp-detail');
  if(!chartEl)return;

  // Update range highlight
  document.querySelectorAll('.cmp-range-bar .bei-sort-btn').forEach(function(b){
    b.classList.toggle('on',b.textContent.toLowerCase().replace(/\s/g,'')===cmpRange);
  });
  chartEl.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">Loading...</div>';
  if(sumEl)sumEl.innerHTML='';
  if(detailEl)detailEl.innerHTML='';

  try{
    var allData={};

    if(cmpMode==='ticker'){
      // ── Ticker mode: fetch /api/idx/flow per ticker ──
      await Promise.all(cmpItems.map(async function(code){
        var r=await fetch('/api/idx/flow?code='+encodeURIComponent(code));
        var d=await r.json();
        allData[code]=(d.data||[]).map(function(r){return{trade_date:r.trade_date,close:r.close,fnet_val:r.foreign_net_val||0};});
      }));
    }else{
      // ── Group mode: fetch /api/idx/compare-group ──
      var groupsParam=cmpItems.join(',');
      var r=await fetch('/api/idx/compare-group?mode='+cmpMode+'&groups='+encodeURIComponent(groupsParam));
      var d=await r.json();
      if(d.error){chartEl.innerHTML='<div class="ne">'+d.error+'</div>';return;}
      var groups=d.groups||{};
      cmpItems.forEach(function(name){
        var g=groups[name];
        if(g&&g.data){
          allData[name]=g.data.map(function(r){return{trade_date:r.trade_date,close:r.avg_close,fnet_val:r.total_fnet_val||0,count:r.count};});
        }else{
          allData[name]=[];
        }
      });
    }

    // ── Build unified date axis ──
    var allDates=new Set();
    cmpItems.forEach(function(key){(allData[key]||[]).forEach(function(r){allDates.add(r.trade_date);});});
    var dates=Array.from(allDates).sort();
    if(dates.length<2){chartEl.innerHTML='<div class="ne">Not enough data</div>';return;}

    // ── Apply range filter ──
    if(cmpRange!=='all'){
      var now=new Date(),cutoff=new Date();
      if(cmpRange==='1m')cutoff.setMonth(now.getMonth()-1);
      else if(cmpRange==='3m')cutoff.setMonth(now.getMonth()-3);
      else if(cmpRange==='6m')cutoff.setMonth(now.getMonth()-6);
      else if(cmpRange==='1y')cutoff.setFullYear(now.getFullYear()-1);
      else if(cmpRange==='3y')cutoff.setFullYear(now.getFullYear()-3);
      else if(cmpRange==='5y')cutoff.setFullYear(now.getFullYear()-5);
      var cutStr=cutoff.toISOString().split('T')[0];
      dates=dates.filter(function(d){return d>=cutStr;});
      cmpItems.forEach(function(key){allData[key]=(allData[key]||[]).filter(function(r){return r.trade_date>=cutStr;});});
    }
    if(dates.length<2){chartEl.innerHTML='<div class="ne">Not enough data for this range</div>';return;}

    // ── Normalize to % change from first date ──
    var series={};
    cmpItems.forEach(function(key){
      var map={};(allData[key]||[]).forEach(function(r){map[r.trade_date]=r.close;});
      var fc=null;
      series[key]=dates.map(function(d){var c=map[d];if(c&&!fc)fc=c;if(!c||!fc)return null;return Math.round((c-fc)/fc*10000)/100;});
    });

    // ── Draw SVG chart (reuse existing logic) ──
    cmpDrawChart(chartEl,dates,series);

    // ── Summary cards ──
    var sh='<div class="cmp-summary-grid">';
    cmpItems.forEach(function(key,ci){
      var data=allData[key];if(!data||!data.length)return;
      var f=data[0],l=data[data.length-1];
      var pct=f.close?((l.close-f.close)/f.close*100):0;
      var cls=pct>0?'up':pct<0?'dn':'';

      // Total foreign net for period
      var totalFnet=data.reduce(function(s,r){return s+(r.fnet_val||0);},0);
      var fnetCls=totalFnet>0?'up':totalFnet<0?'dn':'';

      var clickAttr=cmpMode==='ticker'?' onclick="gsOpen(\''+esc(key)+'\')" style="cursor:pointer"':'';

      sh+='<div class="cmp-summary-card"'+clickAttr+'>';
      sh+='<div class="cmp-sc-head"><span class="cmp-sc-dot" style="background:'+cmpColors[ci%8]+'"></span><span class="cmp-sc-code">'+esc(key)+'</span></div>';
      sh+='<div class="cmp-sc-pct '+cls+'">'+(pct>0?'+':'')+pct.toFixed(2)+'%</div>';
      if(cmpMode==='ticker'){
        sh+='<div class="cmp-sc-detail">'+f.close.toLocaleString()+' → '+l.close.toLocaleString()+'</div>';
      }else{
        sh+='<div class="cmp-sc-detail">Avg: '+Math.round(f.close).toLocaleString()+' → '+Math.round(l.close).toLocaleString()+'</div>';
      }
      sh+='<div class="cmp-sc-detail"><span class="'+fnetCls+'">F.Net: '+fmtRp(totalFnet)+'</span></div>';
      sh+='</div>';
    });
    sh+='</div>';
    if(sumEl)sumEl.innerHTML=sh;

    // ── Detail: show ticker composition for group modes ──
    if(cmpMode!=='ticker'&&detailEl){
      var dh='<div style="margin-top:6px">';
      dh+='<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);margin-bottom:6px">Composition</div>';
      dh+='<div style="display:flex;gap:8px;flex-wrap:wrap">';
      var groupData={}; // need to re-fetch or cache — use allData metadata
      // For group modes, show what tickers are in each group
      cmpItems.forEach(function(key,ci){
        var data=allData[key]||[];
        var lastCount=data.length?data[data.length-1].count:0;
        dh+='<div style="font-size:11px;display:flex;align-items:center;gap:4px">';
        dh+='<span class="cmp-chip-dot" style="background:'+cmpColors[ci%8]+';width:6px;height:6px;border-radius:50%;display:inline-block"></span>';
        dh+='<span style="font-weight:600">'+esc(key)+'</span>';
        if(lastCount)dh+='<span style="color:var(--t3)">('+lastCount+' stocks)</span>';
        dh+='</div>';
      });
      dh+='</div></div>';
      detailEl.innerHTML=dh;
    }

  }catch(e){chartEl.innerHTML='<div class="ne">Error: '+e.message+'</div>';}
}

// ═══ SVG CHART RENDERER — shared by all modes ═══
function cmpDrawChart(chartEl,dates,series){
  var W=chartEl.offsetWidth||700,H=320;
  var pad={t:20,r:60,b:30,l:55};
  var cW=W-pad.l-pad.r,cH=H-pad.t-pad.b;

  var allV=[];cmpItems.forEach(function(c){(series[c]||[]).forEach(function(v){if(v!==null)allV.push(v);});});
  if(!allV.length){chartEl.innerHTML='<div class="ne">No data to chart</div>';return;}

  var minV=Math.min.apply(null,allV),maxV=Math.max.apply(null,allV);
  var rng=maxV-minV||1;minV-=rng*.05;maxV+=rng*.05;rng=maxV-minV;
  function xS(i){return pad.l+i/(dates.length-1)*cW;}
  function yS(v){return pad.t+(1-(v-minV)/rng)*cH;}

  var svg='<svg width="'+W+'" height="'+H+'" style="display:block">';

  // Grid lines + labels
  for(var g=0;g<=5;g++){
    var gy=pad.t+g/5*cH;var gv=maxV-g/5*rng;
    svg+='<line x1="'+pad.l+'" y1="'+gy+'" x2="'+(W-pad.r)+'" y2="'+gy+'" stroke="var(--b1)" stroke-width="1"/>';
    svg+='<text x="'+(W-pad.r+4)+'" y="'+(gy+3)+'" fill="var(--t3)" font-size="9" font-family="var(--fm)">'+(gv>0?'+':'')+gv.toFixed(1)+'%</text>';
  }

  // Zero line
  if(minV<0&&maxV>0){
    var zy=yS(0);
    svg+='<line x1="'+pad.l+'" y1="'+zy+'" x2="'+(W-pad.r)+'" y2="'+zy+'" stroke="var(--t3)" stroke-width="1" stroke-dasharray="3,3"/>';
  }

  // Date labels
  var ls=Math.max(1,Math.floor(dates.length/8));
  for(var di=0;di<dates.length;di+=ls){
    svg+='<text x="'+xS(di)+'" y="'+(H-4)+'" fill="var(--t3)" font-size="8" font-family="var(--fm)" text-anchor="middle">'+dates[di].substring(5)+'</text>';
  }

  // Series lines
  cmpItems.forEach(function(key,ci){
    var clr=cmpColors[ci%8],pts=[];
    (series[key]||[]).forEach(function(v,i){if(v!==null)pts.push(xS(i)+','+yS(v));});
    if(pts.length>=2){
      svg+='<polyline points="'+pts.join(' ')+'" fill="none" stroke="'+clr+'" stroke-width="2" stroke-linejoin="round"/>';
      // End dot + label
      var vals=series[key].filter(function(v){return v!==null;});
      var last=vals[vals.length-1];
      var li=series[key].lastIndexOf(last);
      svg+='<circle cx="'+xS(li)+'" cy="'+yS(last)+'" r="3" fill="'+clr+'"/>';
      // Label on left side
      var labelText=key.length>12?key.substring(0,12)+'…':key;
      svg+='<text x="'+(pad.l-4)+'" y="'+(yS(last)+3)+'" fill="'+clr+'" font-size="9" font-family="var(--fm)" text-anchor="end">'+labelText+'</text>';
    }
  });

  svg+='</svg>';
  chartEl.innerHTML=svg;
}

// ═══ Backward compat: keep cmpTickers synced with cmpItems for ticker mode ═══
// (some other code may reference cmpTickers directly)
Object.defineProperty(window,'cmpTickers',{
  get:function(){return cmpMode==='ticker'?cmpItems:[];},
  set:function(v){if(cmpMode==='ticker')cmpItems=v;}
});

// ═══ SECTOR OVERVIEW ═══
let sectorDrillSector='',sectorDrillIndustry='';

async function loadSectorView(){
  var el=$('sector-content');if(!el)return;
  el.innerHTML='<div style="padding:12px">'+skelRows(6)+'</div>';
  try{
    var url='/api/screener/sectors';
    if(sectorDrillSector)url+='?sector='+encodeURIComponent(sectorDrillSector);
    if(sectorDrillIndustry)url+=(sectorDrillSector?'&':'?')+'industry='+encodeURIComponent(sectorDrillIndustry);
    var r=await fetch(url);var d=await r.json();
    if(d.error){el.innerHTML='<div class="ne">'+d.error+'</div>';return;}
    var h='';

    // Breadcrumb
    h+='<div style="padding:8px 12px;font-size:12px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--b1)">';
    h+='<span class="code" style="cursor:pointer" onclick="sectorDrillSector=\'\';sectorDrillIndustry=\'\';loadSectorView()">All Sectors</span>';
    if(sectorDrillSector){h+=' <span style="color:var(--t3)">›</span> <span class="code" style="cursor:pointer" onclick="sectorDrillIndustry=\'\';loadSectorView()">'+esc(sectorDrillSector)+'</span>';}
    if(sectorDrillIndustry){h+=' <span style="color:var(--t3)">›</span> <span style="font-weight:600">'+esc(sectorDrillIndustry)+'</span>';}
    if(d.snapshot_month)h+='<span style="flex:1"></span><span style="color:var(--t3);font-family:var(--fm);font-size:10px">BEI '+d.snapshot_month+'</span>';
    h+='</div>';

    if(!sectorDrillSector&&!sectorDrillIndustry){
      // ── Sector cards ──
      h+='<div style="padding:12px"><div style="font-weight:700;font-size:14px;margin-bottom:10px">Sector Overview</div>';
      h+='<div class="sector-grid">';
      (d.sectors||[]).forEach(function(s){
        var ytdCls=s.avg_ytd>0?'up':s.avg_ytd<0?'dn':'';
        var fnetCls=s.total_fnet>0?'up':s.total_fnet<0?'dn':'';
        h+='<div class="sector-card" onclick="sectorDrillSector=\''+esc(s.sector)+'\';loadSectorView()">';
        h+='<div class="sc-header"><span class="sc-name">'+esc(s.sector)+'</span><span class="sc-count">'+s.count+' stocks</span></div>';
        h+='<div class="sc-stats">';
        h+='<div class="sc-stat"><div class="sc-stat-val">'+fmtRp(s.total_mcap)+'</div><div class="sc-stat-lbl">Mkt Cap</div></div>';
        h+='<div class="sc-stat"><div class="sc-stat-val">'+s.avg_per+'x</div><div class="sc-stat-lbl">Avg PER</div></div>';
        h+='<div class="sc-stat"><div class="sc-stat-val">'+s.avg_roe+'%</div><div class="sc-stat-lbl">Avg ROE</div></div>';
        h+='<div class="sc-stat"><div class="sc-stat-val '+ytdCls+'">'+(s.avg_ytd>0?'+':'')+s.avg_ytd+'%</div><div class="sc-stat-lbl">Avg YTD</div></div>';
        h+='<div class="sc-stat"><div class="sc-stat-val '+fnetCls+'">'+fmtRp(s.total_fnet)+'</div><div class="sc-stat-lbl">F.Net</div></div>';
        h+='</div></div>';
      });
      h+='</div></div>';

    }else if(sectorDrillSector&&!sectorDrillIndustry){
      // ── Industry cards within sector ──
      h+='<div style="padding:12px"><div style="font-weight:700;font-size:14px;margin-bottom:10px">'+esc(sectorDrillSector)+' — Industries</div>';
      if(d.industries&&d.industries.length){
        h+='<div class="sector-grid">';
        d.industries.forEach(function(s){
          var ytdCls=s.avg_ytd>0?'up':s.avg_ytd<0?'dn':'';
          var fnetCls=s.total_fnet>0?'up':s.total_fnet<0?'dn':'';
          h+='<div class="sector-card" onclick="sectorDrillIndustry=\''+esc(s.industry)+'\';loadSectorView()">';
          h+='<div class="sc-header"><span class="sc-name">'+esc(s.industry)+'</span><span class="sc-count">'+s.count+' stocks</span></div>';
          h+='<div class="sc-stats">';
          h+='<div class="sc-stat"><div class="sc-stat-val">'+fmtRp(s.total_mcap)+'</div><div class="sc-stat-lbl">Mkt Cap</div></div>';
          h+='<div class="sc-stat"><div class="sc-stat-val">'+s.avg_per+'x</div><div class="sc-stat-lbl">PER</div></div>';
          h+='<div class="sc-stat"><div class="sc-stat-val">'+s.avg_roe+'%</div><div class="sc-stat-lbl">ROE</div></div>';
          h+='<div class="sc-stat"><div class="sc-stat-val '+ytdCls+'">'+(s.avg_ytd>0?'+':'')+s.avg_ytd+'%</div><div class="sc-stat-lbl">YTD</div></div>';
          h+='<div class="sc-stat"><div class="sc-stat-val '+fnetCls+'">'+fmtRp(s.total_fnet)+'</div><div class="sc-stat-lbl">F.Net</div></div>';
          h+='</div></div>';
        });
        h+='</div>';
      }
      // Top stocks in this sector
      if(d.stocks&&d.stocks.length){
        h+='<div style="font-weight:600;font-size:12px;margin:16px 0 8px;color:var(--t2)">Top Stocks by Market Cap</div>';
        h+=sectorStockTable(d.stocks);
      }
      h+='</div>';

    }else{
      // ── Stock list for specific industry ──
      h+='<div style="padding:12px"><div style="font-weight:700;font-size:14px;margin-bottom:10px">'+esc(sectorDrillIndustry)+'</div>';
      if(d.stocks&&d.stocks.length){
        h+=sectorStockTable(d.stocks);
      }else{
        h+='<div class="ne">No stocks in this industry</div>';
      }
      h+='</div>';
    }

    el.innerHTML=h;
  }catch(e){el.innerHTML='<div class="ne">Error: '+e.message+'</div>';}
}

function sectorStockTable(stocks){
  var h='<div style="overflow-x:auto"><table class="bei-tbl"><thead><tr>';
  h+='<th class="al">Code</th><th class="al">Industry</th><th class="ar">Close</th><th class="ar">Chg%</th>';
  h+='<th class="ar">Mkt Cap</th><th class="ar">PER</th><th class="ar">ROE</th><th class="ar">YTD</th><th class="ar">F.Net</th>';
  h+='</tr></thead><tbody>';
  stocks.forEach(function(r){
    var cpCls=(r.chg_pct||0)>0?'up':(r.chg_pct||0)<0?'dn':'';
    var ytdCls=(r.ytd||0)>0?'up':(r.ytd||0)<0?'dn':'';
    var fnCls=(r.fnet_val||0)>0?'up':(r.fnet_val||0)<0?'dn':'';
    h+='<tr><td class="code al" onclick="gsOpen(\''+esc(r.code)+'\')">'+esc(r.code)+'</td>';
    h+='<td class="name al" style="font-size:10px">'+esc(r.industry||'')+'</td>';
    h+='<td class="ar">'+(r.close||0).toLocaleString()+'</td>';
    h+='<td class="ar '+cpCls+'">'+(r.chg_pct>0?'+':'')+(r.chg_pct||0).toFixed(2)+'%</td>';
    h+='<td class="ar">'+fmtRp(r.mkt_cap||0)+'</td>';
    h+='<td class="ar">'+(r.per||'-')+'</td>';
    h+='<td class="ar">'+(r.roe?r.roe+'%':'-')+'</td>';
    h+='<td class="ar '+ytdCls+'">'+(r.ytd?(r.ytd>0?'+':'')+r.ytd.toFixed(1)+'%':'-')+'</td>';
    h+='<td class="ar '+fnCls+'" style="font-weight:600">'+fmtRp(r.fnet_val||0)+'</td></tr>';
  });
  h+='</tbody></table></div>';
  return h;
}

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
function stab(n,b){document.querySelectorAll('.tabs .tab').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.querySelectorAll('.tpanel').forEach(p=>p.classList.remove('on'));$('t-'+n).classList.add('on');if(n==='wl'){loadWL();loadAl();}if(n==='mkt')loadMktOverview();if(n==='scr')loadScreener();if(n==='ins')chkIns();}
function swt(n,b){const panel=b.closest('.tpanel');panel.querySelectorAll('.wt-b').forEach(x=>x.classList.remove('on'));b.classList.add('on');panel.querySelectorAll('.wp').forEach(p=>p.classList.remove('on'));$('w-'+n).classList.add('on');}
function smkt(n,b){const panel=b.closest('.tpanel');panel.querySelectorAll('.wt-b').forEach(x=>x.classList.remove('on'));b.classList.add('on');panel.querySelectorAll('.wp').forEach(p=>p.classList.remove('on'));$('m-'+n).classList.add('on');if(n==='ov')loadMktOverview();if(n==='bei')loadBei();if(n==='nws')lNews('');}
function sins(n,b){const panel=b.closest('.tpanel');panel.querySelectorAll('.wt-b').forEach(x=>x.classList.remove('on'));b.classList.add('on');panel.querySelectorAll('.wp').forEach(p=>p.classList.remove('on'));$('i-'+n).classList.add('on');}

const mktCache={};
async function loadMktOverview(){
  var el=$('ml-ov');if(!el)return;
  if(mktCache._ov&&Date.now()-mktCache._ov.ts<60000){el.innerHTML=mktCache._ov.html;return;}
  el.innerHTML='<div class="ne">Loading...</div>';
  try{
    var [idx,cmd,cur]=await Promise.all([
      fetch('/api/market?cat=indices').then(r=>r.json()),
      fetch('/api/market?cat=commodities').then(r=>r.json()),
      fetch('/api/market?cat=currencies').then(r=>r.json())
    ]);
    var h='';
    function renderSection(title,icon,data){
      h+='<div class="mkt-section-h">'+icon+' '+title+'</div>';
      data.forEach(function(m){
        var c=m.change>0?'up':m.change<0?'dn':'fl';
        var ar=m.change>0?'▲':m.change<0?'▼':'';
        var s=m.change>0?'+':'';
        var pr=m.price?m.price.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
        var ch=m.price?ar+' '+s+m.change.toFixed(2)+'%':'—';
        h+='<div class="mkt-item"><span class="mkt-label">'+esc(m.label)+'</span><span class="mkt-desc">'+esc(m.desc)+'</span><span class="mkt-price">'+pr+'</span><span class="mkt-chg '+c+'">'+ch+'</span></div>';
      });
    }
    renderSection('Indices','📊',idx);
    renderSection('Commodities','🛢',cmd);
    renderSection('Currencies','💱',cur);
    mktCache._ov={html:h,ts:Date.now()};
    el.innerHTML=h;
  }catch{el.innerHTML='<div class="ne">Failed to load</div>';}
}

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
  if(e.key>='1'&&e.key<='5'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){var tabs=document.querySelectorAll('.tabs .tab');var idx=parseInt(e.key)-1;if(tabs[idx]){tabs[idx].click();e.preventDefault();}}
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