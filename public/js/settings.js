// Settings modal, upload handlers, DB stats, Corp Actions, Export, Preferences
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
  var titles={upload:'📊 Data Upload',dbstats:'🗄 Database',ca:'⚡ Corporate Actions',tags:'🏷 Investor Tags',export:'📥 Export Data',idxdl:'⬇️ IDX Download',prefs:'🎨 Preferences'};
  $('smod-title').innerHTML='<span class="sbh-icon">'+titles[tab].split(' ')[0]+'</span> '+titles[tab].split(' ').slice(1).join(' ');
  var c=$('smod-content');
  c.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">Loading...</div>';
  if(tab==='upload')renderSetUpload(c);
  else if(tab==='dbstats')renderSetDbStats(c);
  else if(tab==='ca')renderSetCA(c);
  else if(tab==='tags')renderSetTags(c);
  else if(tab==='export')renderSetExport(c);
  else if(tab==='idxdl')renderSetIdxDownload(c);
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
  h+='<div class="s-row"><div class="s-row-icon">📋</div><div class="s-row-info"><div class="s-row-title">Quarterly Financials (Yahoo)</div><div class="s-row-desc">Revenue, Net Income, EPS, Cash Flow per quarter</div></div><div class="s-row-action"><label class="s-upload-btn">Choose File<input type="file" accept=".xlsx,.xls" onchange="setUploadQuarterly(this)"></label></div></div>';
  h+='<div class="s-row"><div class="s-row-icon">📉</div><div class="s-row-info"><div class="s-row-title">Index Summary (BEI)</div><div class="s-row-desc">IHSG, LQ45, IDX30, sectoral indices. Supports bulk upload.</div></div><div class="s-row-action"><label class="s-upload-btn">Choose Files<input type="file" accept=".xlsx,.xls" multiple onchange="setUploadIndices(this)"></label></div></div>';
  h+='</div>';
  h+='<div class="s-info" id="set-upload-info"></div>';
  h+='<div class="s-section"><div class="s-section-title">Current Data</div><div id="set-tag-stats" style="font-size:12px;color:var(--t2);line-height:1.8">Loading...</div></div>';
  h+='<div class="s-section"><div class="s-section-title">Upload History</div><div id="set-upload-logs" style="font-size:12px;color:var(--t2)">Loading...</div></div>';
  c.innerHTML=h;
  Promise.all([
    fetch('/api/insider/tags/stats').then(r=>r.json()),
    fetch('/api/insider/stats').then(r=>r.json()),
    fetch('/api/idx/stats').then(r=>r.json()),
    fetch('/api/idx/fundamental/stats').then(r=>r.json()),
    fetch('/api/quarterly/stats').then(r=>r.json()).catch(function(){return{total:0};}),
    fetch('/api/idx/indices/stats').then(r=>r.json()).catch(function(){return{total:0};})
  ]).then(function([tags,ins,idx,fund,qtr,idxIdx]){
    var el=$('set-tag-stats');if(!el)return;
    var h='<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px">';
    h+='<span>🏷 Groups: <b>'+tags.groups+'</b></span><span>📋 Rules: <b>'+tags.rules+'</b></span>';
    h+='<span>🔄 Overrides: <b>'+tags.overrides+'</b></span><span>📌 Ticker Map: <b>'+tags.ticker_map+'</b></span></div>';
    if(ins.total){h+='<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--b1)">👥 Holdings: <b>'+ins.total.toLocaleString()+'</b> · Tickers: <b>'+ins.tickers+'</b> · Investors: <b>'+ins.investors.toLocaleString()+'</b>'+(ins.latest?' · Last: <b>'+ins.latest+'</b>':'')+'</div>';}
    if(idx.total){h+='<div style="margin-top:6px">📊 IDX: <b>'+idx.total.toLocaleString()+'</b> records · <b>'+idx.tickers+'</b> tickers · <b>'+idx.dates+'</b> days'+(idx.latest?' · Latest: <b>'+idx.latest+'</b>':'')+'</div>';}
    if(fund.total){h+='<div style="margin-top:6px">📈 Fundamental: <b>'+fund.total+'</b> stocks'+(fund.snapshot_month?' · Month: <b>'+fund.snapshot_month+'</b>':'')+'</div>';}
    if(qtr.total){h+='<div style="margin-top:6px">📋 Quarterly: <b>'+qtr.total+'</b> records · <b>'+qtr.tickers+'</b> tickers · <b>'+qtr.periods+'</b> periods'+(qtr.latest?' · Latest: <b>'+qtr.latest+'</b>':'')+'</div>';}
    if(idxIdx.total){h+='<div style="margin-top:6px">📉 Indices: <b>'+idxIdx.total+'</b> records · <b>'+idxIdx.indices+'</b> indices · <b>'+idxIdx.dates+'</b> days'+(idxIdx.latest?' · Latest: <b>'+idxIdx.latest+'</b>':'')+'</div>';}
    el.innerHTML=h;
  }).catch(function(){var el=$('set-tag-stats');if(el)el.textContent='Error loading stats';});
  renderUploadLogs();
}

async function renderUploadLogs(){
  var el=$('set-upload-logs');if(!el)return;
  try{
    var r=await fetch('/api/upload-logs');var d=await r.json();var logs=d.logs||[];
    if(!logs.length){el.innerHTML='<div style="color:var(--t3)">No upload history yet</div>';return;}
    var h='<div style="overflow-y:auto;max-height:200px"><table class="s-ca-tbl"><thead><tr><th>Time</th><th>Type</th><th>File</th><th>Date</th><th class="ar">New</th><th class="ar">Updated</th><th class="ar">Total</th></tr></thead><tbody>';
    logs.slice(0,20).forEach(function(l){
      var typeLabel=l.upload_type==='idx_daily'?'📊 IDX':l.upload_type==='insider'?'📋 Insider':l.upload_type==='fundamental'?'📈 Fund':l.upload_type==='idx_indices'?'📉 Index':l.upload_type==='quarterly'?'📋 Qtr':'📄 Other';
      var time=l.uploaded_at?new Date(l.uploaded_at+'Z').toLocaleString('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
      h+='<tr><td style="font-size:10px;color:var(--t3);white-space:nowrap">'+time+'</td>';
      h+='<td style="font-size:10px">'+typeLabel+'</td>';
      h+='<td style="font-size:10px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(l.filename||'')+'">'+esc(l.filename||'—')+'</td>';
      h+='<td style="font-family:var(--fm);font-size:10px">'+esc(l.snapshot_date||'—')+'</td>';
      h+='<td class="ar" style="color:var(--gn)">'+(l.rows_new||0)+'</td>';
      h+='<td class="ar" style="color:var(--am)">'+(l.rows_updated||0)+'</td>';
      h+='<td class="ar">'+(l.rows_total||0)+'</td></tr>';
    });
    h+='</tbody></table></div>';
    el.innerHTML=h;
  }catch(e){el.innerHTML='<div style="color:var(--t3)">Error loading logs</div>';}
}

async function setUploadInsider(input){
  if(!input.files[0])return;var fd=new FormData();fd.append('file',input.files[0]);
  var info=$('set-upload-info');info.textContent='Uploading insider data...';info.className='s-info';
  try{var r=await fetch('/api/insider/upload',{method:'POST',body:fd});var d=await r.json();
    if(d.success){
      var msg='✅ Loaded '+d.total.toLocaleString()+' records, '+d.tickers+' tickers';
      if(d.new_rows!==undefined)msg+=' ('+d.new_rows+' new, '+d.updated_rows+' updated)';
      info.textContent=msg;
      showT('Insider Data',d.new_rows+' new records');
      if(typeof insHome==='function')insHome();
      renderUploadLogs();
    }
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
      var msg='✅ IDX: '+d.imported.toLocaleString()+' records';
      if(d.new_rows!==undefined)msg+=' ('+d.new_rows+' new, '+d.updated_rows+' updated)';
      msg+=', '+d.dates+' dates, '+d.tickers+' tickers';
      if(d.warnings&&d.warnings.length){
        msg+='\n⚠️ '+d.warnings.length+' warning(s):';
        d.warnings.forEach(function(w){msg+='\n  · '+w.file+': '+w.message;});
      }
      if(d.detected_ca&&d.detected_ca.length){
        msg+='\n⚡ '+d.detected_ca.length+' corporate action(s) detected!';
        showT('⚡ Corp Action Detected',d.detected_ca.length+' action(s) found. Check Corp Actions tab.');
      }else{showT('IDX Data',(d.new_rows||d.imported)+' new records imported');}
      info.textContent=msg;info.style.whiteSpace='pre-line';
      if(typeof beiStats!=='undefined')beiStats=null;
      renderUploadLogs();
    }else{info.textContent='❌ '+(d.error||'unknown');info.className='s-info error';}
  }catch(e){info.textContent='❌ '+e.message;info.className='s-info error';}input.value='';
}
async function setUploadFund(input){
  if(!input.files[0])return;var fd=new FormData();fd.append('file',input.files[0]);
  var info=$('set-upload-info');info.textContent='Uploading fundamental data...';info.className='s-info';
  try{var r=await fetch('/api/idx/fundamental/upload',{method:'POST',body:fd});var d=await r.json();
    if(d.success){info.textContent='✅ Fundamental: '+d.count+' stocks ('+d.snapshot_month+')';showT('Fundamental',d.count+' stocks loaded');renderUploadLogs();}
    else{info.textContent='❌ '+(d.error||'unknown');info.className='s-info error';}
  }catch(e){info.textContent='❌ '+e.message;info.className='s-info error';}input.value='';
}
async function setUploadQuarterly(input){
  if(!input.files[0])return;var fd=new FormData();fd.append('file',input.files[0]);
  var info=$('set-upload-info');info.textContent='Uploading quarterly financials...';info.className='s-info';
  try{var r=await fetch('/api/quarterly/upload',{method:'POST',body:fd});var d=await r.json();
    if(d.success){info.textContent='✅ Quarterly: '+d.count+' records, '+d.tickers+' tickers';showT('Quarterly',d.count+' records loaded');renderUploadLogs();}
    else{info.textContent='❌ '+(d.error||'unknown');info.className='s-info error';}
  }catch(e){info.textContent='❌ '+e.message;info.className='s-info error';}input.value='';
}
async function setUploadIndices(input){
  if(!input.files.length)return;var fd=new FormData();
  for(var i=0;i<input.files.length;i++)fd.append('file',input.files[i]);
  var info=$('set-upload-info');info.textContent='Uploading '+input.files.length+' index file(s)...';info.className='s-info';
  try{var r=await fetch('/api/idx/indices/upload',{method:'POST',body:fd});var d=await r.json();
    if(d.success){
      var msg='✅ Indices: '+d.imported+' records ('+d.new_rows+' new, '+d.updated_rows+' updated), '+d.indices+' indices, '+d.dates+' dates';
      info.textContent=msg;
      showT('Index Summary',d.new_rows+' new records imported');
      renderUploadLogs();
    }else{info.textContent='❌ '+(d.error||'unknown');info.className='s-info error';}
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
// ═══ IDX DOWNLOAD SCRIPT GENERATOR ═══
function renderSetIdxDownload(el){
  // Default dates
  var today=new Date().toISOString().split('T')[0];
  var h='<div class="s-section"><div class="s-section-title">⬇️ IDX Daily Auto-Download</div>';
  h+='<div style="font-size:11px;color:var(--t2);margin-bottom:12px">Generate Python script untuk download data Ringkasan Saham dari idx.co.id. Script jalan di Windows (butuh Chrome + Python).</div>';

  // Date range
  h+='<div style="display:flex;gap:8px;margin-bottom:10px;align-items:center">';
  h+='<div><div style="font-size:9px;color:var(--t3);font-weight:600;margin-bottom:2px">START DATE</div>';
  h+='<input id="idx-dl-start" type="date" value="'+today+'" style="padding:5px 8px;background:var(--bgH);border:1px solid var(--b2);border-radius:6px;font-size:12px;color:var(--t1);outline:none"></div>';
  h+='<div><div style="font-size:9px;color:var(--t3);font-weight:600;margin-bottom:2px">END DATE</div>';
  h+='<input id="idx-dl-end" type="date" value="'+today+'" style="padding:5px 8px;background:var(--bgH);border:1px solid var(--b2);border-radius:6px;font-size:12px;color:var(--t1);outline:none"></div>';
  h+='</div>';

  // Mode selection
  h+='<div style="margin-bottom:10px"><div style="font-size:9px;color:var(--t3);font-weight:600;margin-bottom:4px">MODE</div>';
  h+='<div style="display:flex;gap:6px">';
  h+='<label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer"><input type="radio" name="idx-dl-mode" value="download_upload" checked> Download + Auto Upload ke Banyu Langit</label>';
  h+='<label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer"><input type="radio" name="idx-dl-mode" value="download_only"> Download saja (simpan ke folder)</label>';
  h+='</div></div>';

  // Save folder
  h+='<div style="margin-bottom:10px"><div style="font-size:9px;color:var(--t3);font-weight:600;margin-bottom:2px">SAVE FOLDER (opsional, untuk download_only)</div>';
  h+='<input id="idx-dl-folder" type="text" value="C:\\Users\\ASUS TUF\\OneDrive\\Documents\\Datafeed\\RAW" style="width:100%;padding:5px 8px;background:var(--bgH);border:1px solid var(--b2);border-radius:6px;font-family:var(--fm);font-size:11px;color:var(--t1);outline:none"></div>';

  // Banyu Langit URL
  h+='<div style="margin-bottom:12px"><div style="font-size:9px;color:var(--t3);font-weight:600;margin-bottom:2px">BANYU LANGIT URL</div>';
  h+='<input id="idx-dl-url" type="text" value="http://localhost:3003" style="width:100%;padding:5px 8px;background:var(--bgH);border:1px solid var(--b2);border-radius:6px;font-family:var(--fm);font-size:11px;color:var(--t1);outline:none"></div>';

  // Generate buttons
  h+='<div style="display:flex;gap:8px;margin-bottom:16px">';
  h+='<button onclick="idxDlGenerate(\'py\')" style="padding:8px 20px;border-radius:8px;border:none;background:var(--bl);color:#fff;font-weight:700;cursor:pointer;font-size:12px">🐍 Generate Python Script</button>';
  h+='<button onclick="idxDlGenerate(\'bat\')" style="padding:8px 20px;border-radius:8px;border:none;background:#22c55e;color:#fff;font-weight:700;cursor:pointer;font-size:12px">📋 Generate .bat Runner</button>';
  h+='</div>';

  // Output area
  h+='<div id="idx-dl-output"></div>';

  // Requirements
  h+='<div style="margin-top:16px;padding:10px 12px;background:var(--bgH);border-radius:8px;font-size:10px;color:var(--t2);line-height:1.8">';
  h+='<div style="font-weight:700;margin-bottom:4px">📋 Requirements</div>';
  h+='<code>pip install selenium webdriver-manager requests</code><br>';
  h+='Chrome browser harus terinstall<br>';
  h+='Script jalan di <b>Windows</b> (bukan Docker)<br>';
  h+='Mode "Auto Upload" otomatis upload XLSX ke Banyu Langit setelah download';
  h+='</div>';
  h+='</div>';
  el.innerHTML=h;
}

function idxDlGenerate(type){
  var startDate=document.getElementById('idx-dl-start').value;
  var endDate=document.getElementById('idx-dl-end').value;
  var mode=document.querySelector('input[name="idx-dl-mode"]:checked').value;
  var folder=document.getElementById('idx-dl-folder').value.replace(/\\/g,'\\\\');
  var blUrl=document.getElementById('idx-dl-url').value;

  if(!startDate||!endDate){showT('⚠️','Set date range');return;}

  var autoUpload=mode==='download_upload';

  if(type==='py'){
    var py='';
    py+='# ═══ IDX Daily Auto-Download — Generated by Banyu Langit ═══\\n';
    py+='# Run: python download_idx.py\\n';
    py+='# Requirements: pip install selenium webdriver-manager'+(autoUpload?' requests':'')+'\\n\\n';
    py+='from selenium import webdriver\\n';
    py+='from selenium.webdriver.common.by import By\\n';
    py+='from selenium.webdriver.chrome.service import Service\\n';
    py+='from selenium.webdriver.support.ui import WebDriverWait\\n';
    py+='from selenium.webdriver.support import expected_conditions as EC\\n';
    py+='from webdriver_manager.chrome import ChromeDriverManager\\n';
    py+='from datetime import datetime, timedelta\\n';
    py+='import time, os, glob\\n';
    if(autoUpload)py+='import requests\\n';
    py+='\\n';
    py+='# ═══ CONFIG ═══\\n';
    py+='URL = "https://www.idx.co.id/id/data-pasar/ringkasan-perdagangan/ringkasan-saham/"\\n';
    py+='DOWNLOAD_DIR = r"'+folder+'"\\n';
    py+='START_DATE = "'+startDate+'"\\n';
    py+='END_DATE = "'+endDate+'"\\n';
    if(autoUpload)py+='BANYU_LANGIT = "'+blUrl+'"\\n';
    py+='\\n';
    py+='options = webdriver.ChromeOptions()\\n';
    py+='prefs = {"download.default_directory": DOWNLOAD_DIR, "download.prompt_for_download": False, "download.directory_upgrade": True}\\n';
    py+='options.add_experimental_option("prefs", prefs)\\n';
    py+='driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)\\n';
    py+='wait = WebDriverWait(driver, 30)\\n\\n';
    py+='driver.get(URL)\\n';
    py+='wait.until(EC.presence_of_element_located((By.TAG_NAME, "body")))\\n';
    py+='time.sleep(3)\\n\\n';
    py+='start = datetime.strptime(START_DATE, "%Y-%m-%d")\\n';
    py+='end = datetime.strptime(END_DATE, "%Y-%m-%d")\\n';
    py+='current = start\\n';
    py+='downloaded = []\\n\\n';
    py+='while current <= end:\\n';
    py+='    tanggal = current.strftime("%Y-%m-%d")\\n';
    py+='    print(f"[{tanggal}] Setting date...")\\n';
    py+='    date_input = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, ".mx-datepicker input")))\\n';
    py+='    driver.execute_script("""\\n';
    py+='        const input = arguments[0]; const value = arguments[1];\\n';
    py+='        input.value = value;\\n';
    py+='        input.dispatchEvent(new Event("input", { bubbles: true }));\\n';
    py+='        input.dispatchEvent(new Event("change", { bubbles: true }));\\n';
    py+='    """, date_input, tanggal)\\n';
    py+='    time.sleep(3)\\n';
    py+='    download_btn = wait.until(EC.presence_of_element_located((By.XPATH, "//button[contains(., \'Unduh\')]")))\\n';
    py+='    if not download_btn.is_enabled():\\n';
    py+='        print(f"  ⛔ Libur/no data → skip")\\n';
    py+='        current += timedelta(days=1)\\n';
    py+='        continue\\n';
    py+='    before = set(glob.glob(os.path.join(DOWNLOAD_DIR, "*.xlsx")))\\n';
    py+='    download_btn.click()\\n';
    py+='    print(f"  ✔ Downloading...")\\n';
    py+='    time.sleep(6)\\n';
    py+='    after = set(glob.glob(os.path.join(DOWNLOAD_DIR, "*.xlsx")))\\n';
    py+='    new_files = after - before\\n';
    py+='    if new_files:\\n';
    py+='        f = list(new_files)[0]\\n';
    py+='        print(f"  📁 File: {os.path.basename(f)}")\\n';
    py+='        downloaded.append(f)\\n';
    py+='    current += timedelta(days=1)\\n\\n';
    py+='driver.quit()\\n';
    py+='print(f"\\\\n✅ Downloaded {len(downloaded)} files")\\n\\n';

    if(autoUpload){
      py+='# ═══ AUTO UPLOAD TO BANYU LANGIT ═══\\n';
      py+='print("\\\\n📤 Uploading to Banyu Langit...")\\n';
      py+='for f in downloaded:\\n';
      py+='    try:\\n';
      py+='        with open(f, "rb") as fp:\\n';
      py+='            r = requests.post(f"{BANYU_LANGIT}/api/settings/upload-idx", files={"file": (os.path.basename(f), fp, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})\\n';
      py+='            d = r.json()\\n';
      py+='            print(f"  ✔ {os.path.basename(f)}: {d}")\\n';
      py+='    except Exception as e:\\n';
      py+='        print(f"  ❌ {os.path.basename(f)}: {e}")\\n';
      py+='print("\\\\n🎉 All done!")\\n';
    }

    // Show in textarea + download button
    var pyText=py.replace(/\\n/g,'\n').replace(/\\\\n/g,'\\n').replace(/\\\\"/g,'"');
    var out='<div style="margin-top:8px"><div style="font-size:11px;font-weight:600;margin-bottom:4px">Generated Script:</div>';
    out+='<textarea id="idx-dl-script" style="width:100%;height:200px;font-family:var(--fm);font-size:10px;background:var(--bgH);border:1px solid var(--b2);border-radius:6px;padding:8px;color:var(--t1);outline:none;resize:vertical;white-space:pre" readonly>'+pyText.replace(/</g,'&lt;')+'</textarea>';
    out+='<div style="display:flex;gap:8px;margin-top:6px">';
    out+='<button onclick="idxDlCopy()" style="padding:6px 16px;border-radius:6px;border:1px solid var(--b2);background:var(--bg2);cursor:pointer;font-size:11px">📋 Copy</button>';
    out+='<button onclick="idxDlDownloadFile()" style="padding:6px 16px;border-radius:6px;border:none;background:var(--bl);color:#fff;cursor:pointer;font-size:11px;font-weight:600">💾 Download .py</button>';
    out+='</div></div>';
    document.getElementById('idx-dl-output').innerHTML=out;
    document.getElementById('idx-dl-script').value=pyText;
  }

  if(type==='bat'){
    var bat='@echo off\\n';
    bat+='echo ═══ IDX Daily Download — Banyu Langit ═══\\n';
    bat+='echo.\\n';
    bat+='python download_idx.py\\n';
    bat+='echo.\\n';
    bat+='pause\\n';
    var batText=bat.replace(/\\n/g,'\n');
    var out2='<div style="margin-top:8px"><div style="font-size:11px;font-weight:600;margin-bottom:4px">.bat Runner:</div>';
    out2+='<textarea style="width:100%;height:80px;font-family:var(--fm);font-size:10px;background:var(--bgH);border:1px solid var(--b2);border-radius:6px;padding:8px;color:var(--t1);outline:none" readonly>'+batText.replace(/</g,'&lt;')+'</textarea>';
    out2+='<div style="margin-top:6px"><button onclick="idxDlDownloadBat()" style="padding:6px 16px;border-radius:6px;border:none;background:#22c55e;color:#fff;cursor:pointer;font-size:11px;font-weight:600">💾 Download .bat</button></div></div>';
    document.getElementById('idx-dl-output').innerHTML=out2;
  }
}

function idxDlCopy(){
  var ta=document.getElementById('idx-dl-script');
  if(ta){ta.select();document.execCommand('copy');showT('📋','Script copied to clipboard');}
}

function idxDlDownloadFile(){
  var ta=document.getElementById('idx-dl-script');if(!ta)return;
  var blob=new Blob([ta.value],{type:'text/plain'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='download_idx.py';a.click();
}

function idxDlDownloadBat(){
  var bat='@echo off\r\necho === IDX Daily Download === Banyu Langit ===\r\necho.\r\npython download_idx.py\r\necho.\r\npause\r\n';
  var blob=new Blob([bat],{type:'text/plain'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='run_download.bat';a.click();
}