// ═══ SETTINGS MODAL — V4 Bloomberg Redesign ═══
let setActiveTab='sync';

function openSettings(){
  $('smod').classList.add('o');
  setTab('sync',document.querySelector('.smod-nav-item.on'));
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
  var titles={sync:'🔄 Sync Center',dbstats:'🗄 Database',upload:'📋 Upload',ca:'⚡ Corp Actions',tags:'🏷 Tags',export:'📥 Export',prefs:'🎨 Prefs'};
  var t=titles[tab]||tab;
  $('smod-title').innerHTML='<span class="sbh-icon">'+t.split(' ')[0]+'</span> '+t.split(' ').slice(1).join(' ');
  var c=$('smod-content');
  c.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">Loading...</div>';
  if(tab==='sync')renderSetSync(c);
  else if(tab==='dbstats')renderSetDbStats(c);
  else if(tab==='upload')renderSetUpload(c);
  else if(tab==='ca')renderSetCA(c);
  else if(tab==='tags')renderSetTags(c);
  else if(tab==='export')renderSetExport(c);
  else if(tab==='prefs')renderSetPrefs(c);
}

// ═══════════════════════════════════════════════
// SYNC CENTER — 1-Click sync + status + log
// ═══════════════════════════════════════════════
function renderSetSync(c){
  var h='';

  // Deno server status
  h+='<div id="sync-deno-bar" style="padding:6px 10px;border-radius:4px;margin-bottom:10px;font-size:var(--font-md);background:var(--bgH);border:1px solid var(--b1);display:flex;align-items:center;gap:8px">';
  h+='<span id="sync-deno-dot" style="width:8px;height:8px;border-radius:50%;background:var(--t3);flex-shrink:0"></span>';
  h+='<span id="sync-deno-text" style="color:var(--t2)">Checking Deno server...</span>';
  h+='</div>';

  // 1-Click buttons row
  h+='<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">';
  h+='<button id="sync-btn-daily" class="s-upload-btn" style="padding:6px 14px;background:var(--gn);color:#000;border-color:var(--gn);font-weight:700" onclick="sync1Click(\'daily\',this)">⚡ Daily Sync</button>';
  h+='<button id="sync-btn-full" class="s-upload-btn" style="padding:6px 14px;background:var(--bl);color:#000;border-color:var(--bl);font-weight:700" onclick="sync1Click(\'full\',this)">📦 Full Sync</button>';
  h+='<button id="sync-btn-cron" class="s-upload-btn" style="padding:6px 14px" onclick="sync1Click(\'cron\',this)">🔄 All Tables</button>';
  h+='<button class="s-upload-btn" style="padding:6px 14px" onclick="idxApiImportAll(this)">📥 Bridge Import</button>';
  h+='</div>';

  // Progress area
  h+='<div id="sync-progress" style="display:none;padding:8px 10px;border-radius:4px;margin-bottom:10px;background:var(--bg2);border:1px solid var(--b1);font-size:var(--font-sm);font-family:var(--fm);max-height:160px;overflow-y:auto"></div>';

  // Result
  h+='<div class="s-info" id="sync-result" style="display:none"></div>';

  // Quick stats
  h+='<div class="s-stats" id="sync-stats" style="margin-bottom:10px">';
  h+='<div class="s-stat"><div class="s-stat-val" id="ss-stock">--</div><div class="s-stat-lbl">Stock Latest</div></div>';
  h+='<div class="s-stat"><div class="s-stat-val" id="ss-index">--</div><div class="s-stat-lbl">Index Latest</div></div>';
  h+='<div class="s-stat"><div class="s-stat-val" id="ss-tickers">--</div><div class="s-stat-lbl">Tickers</div></div>';
  h+='<div class="s-stat"><div class="s-stat-val" id="ss-days">--</div><div class="s-stat-lbl">Trading Days</div></div>';
  h+='</div>';

  // Bridge status
  h+='<div id="sync-bridge" style="font-size:var(--font-sm);color:var(--t2);margin-bottom:10px"></div>';

  // Sync log
  h+='<div class="s-section"><div class="s-section-title">Recent Syncs</div>';
  h+='<div id="sync-log" style="font-size:var(--font-md);max-height:200px;overflow-y:auto">Loading...</div>';
  h+='</div>';

  // Help
  h+='<div style="font-size:var(--font-xs);color:var(--t3);padding:6px 8px;background:var(--bgH);border-radius:4px;margin-top:6px;line-height:1.6">';
  h+='<b>Daily:</b> Stock + Index hari ini (~8s) &nbsp; <b>Full:</b> 5 hari + screener + profiles (~12min) &nbsp; <b>All Tables:</b> Semua 38 function (~16min)<br>';
  h+='<b>Prerequisite:</b> Deno server harus running (<code>start-deno.ps1</code>). Bridge Import = hanya copy dari database.sqlite tanpa fetch API.';
  h+='</div>';

  c.innerHTML=h;
  syncLoadStatus();
  syncCheckDeno();
}

// Check Deno server health
async function syncCheckDeno(){
  var dot=$('sync-deno-dot'),txt=$('sync-deno-text');
  if(!dot||!txt)return;
  try{
    var r=await fetch('/api/idx/sync/deno-health');var d=await r.json();
    if(d.reachable){
      dot.style.background='var(--gn)';
      txt.style.color='var(--gn)';
      txt.textContent='Deno server online'+(d.running?' — '+d.running+' running':'')+(d.uptime?' (uptime: '+Math.round(d.uptime/60)+'m)':'');
    }else{throw new Error('not reachable');}
  }catch(e){
    dot.style.background='var(--rd)';
    txt.style.color='var(--rd)';
    txt.textContent='Deno server offline — run start-deno.ps1';
  }
}

// 1-Click sync handler
let syncPollTimer=null;
async function sync1Click(mode,btn){
  var endpoints={daily:'1click-daily',full:'start-full',cron:'start-cron'};
  var labels={daily:'Daily Sync',full:'Full Sync',cron:'All Tables'};
  var origText=btn.textContent;
  btn.disabled=true;btn.textContent='Starting...';

  var prog=$('sync-progress');
  var result=$('sync-result');
  prog.style.display='block';prog.innerHTML='<span style="color:var(--am)">Starting '+labels[mode]+'...</span>';
  result.style.display='none';

  try{
    if(mode==='daily'){
      // Daily is fast — use blocking 1click
      var r=await fetch('/api/idx/sync/1click-daily',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      var d=await r.json();
      prog.style.display='none';
      if(d.ok){
        var br=d.bridge||{};
        syncShowResult('Daily sync OK — bridge: '+(br.total_rows||0)+' rows',false);
        showT('Daily Sync','Complete');
      }else{
        syncShowResult('Error: '+(d.error||'unknown'),true);
      }
    }else{
      // Full/Cron — async: start then poll
      var endpoint=mode==='full'?'start-full':'start-cron';
      var r=await fetch('/api/idx/sync/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      var d=await r.json();
      if(d.ok){
        prog.innerHTML='<span style="color:var(--am)">'+labels[mode]+' running... polling progress</span>';
        // Start polling
        syncPollTimer=setInterval(function(){syncPollProgress(mode,btn,origText)},3000);
      }else if(d.error==='busy'){
        syncShowResult('Deno busy: '+d.message,true);
      }else{
        syncShowResult('Error: '+(d.error||'failed to start'),true);
      }
    }
  }catch(e){
    prog.style.display='none';
    syncShowResult('Error: '+e.message+' — Is Deno server running?',true);
  }

  if(mode==='daily'){btn.disabled=false;btn.textContent=origText;syncLoadStatus();}
}

async function syncPollProgress(mode,btn,origText){
  try{
    var r=await fetch('/api/idx/sync/deno-status');var d=await r.json();
    var prog=$('sync-progress');
    if(!d.running){
      // Done — stop polling
      clearInterval(syncPollTimer);syncPollTimer=null;
      btn.disabled=false;btn.textContent=origText;
      var last=d.last||{};
      prog.style.display='none';

      // Auto bridge import
      prog.style.display='block';prog.innerHTML='<span style="color:var(--am)">Running bridge import...</span>';
      try{
        var br=await fetch('/api/idx/sync/import-all',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        var brd=await br.json();
        prog.style.display='none';
        syncShowResult((last.summary||'Sync done')+' — Bridge: '+(brd.total_rows||0)+' rows',!last.ok);
        showT(mode==='full'?'Full Sync':'Cron Sync','Complete — '+(brd.total_rows||0)+' rows imported');
      }catch(e){
        prog.style.display='none';
        syncShowResult('Deno OK but bridge failed: '+e.message,true);
      }
      syncLoadStatus();
    }else{
      // Still running — show progress
      var lines=d.progress||[];
      var elapsed=d.elapsed||0;
      var html='<div style="color:var(--am);margin-bottom:4px">'+mode.toUpperCase()+' running... '+elapsed+'s elapsed</div>';
      // Show last 8 lines
      var show=lines.slice(-8);
      show.forEach(function(l){
        var color='var(--t2)';
        if(l.includes('✓'))color='var(--gn)';
        else if(l.includes('✗'))color='var(--rd)';
        else if(l.includes('ERROR'))color='var(--rd)';
        html+='<div style="color:'+color+'">'+esc(l)+'</div>';
      });
      if(lines.length>8)html+='<div style="color:var(--t3)">... '+(lines.length-8)+' more lines</div>';
      prog.innerHTML=html;
      prog.scrollTop=prog.scrollHeight;
    }
  }catch(e){/* keep polling */}
}

function syncShowResult(msg,isError){
  var el=$('sync-result');if(!el)return;
  el.style.display='block';
  el.style.color=isError?'var(--rd)':'var(--gn)';
  el.textContent=msg;
  setTimeout(function(){el.style.display='none';},12000);
}

async function syncLoadStatus(){
  try{
    var r=await fetch('/api/idx/sync/status');var d=await r.json();
    // Quick stats
    var ssStock=$('ss-stock');if(ssStock)ssStock.textContent=d.latest?.stock||'--';
    var ssIndex=$('ss-index');if(ssIndex)ssIndex.textContent=d.latest?.index||'--';
    var ssTickers=$('ss-tickers');if(ssTickers)ssTickers.textContent=d.counts?.tickers||0;
    var ssDays=$('ss-days');if(ssDays)ssDays.textContent=d.counts?.stock_dates||0;

    // Bridge
    var br=$('sync-bridge');
    if(br&&d.bridge){
      if(d.bridge.ok){
        var parts=[];
        if(d.bridge.counts){Object.entries(d.bridge.counts).forEach(function(e){if(e[1]>0)parts.push(e[0]+':'+e[1]);});}
        br.innerHTML='<span style="color:var(--gn)">Bridge connected</span> — '+parts.join(' | ');
      }else{
        br.innerHTML='<span style="color:var(--rd)">Bridge: '+esc(d.bridge.error||'not connected')+'</span>';
      }
    }

    // Log
    var logEl=$('sync-log');
    if(logEl&&d.recent_syncs){
      if(!d.recent_syncs.length){logEl.innerHTML='<div style="color:var(--t3)">No sync history</div>';return;}
      var h='<table class="s-ca-tbl"><thead><tr><th>Time</th><th>Type</th><th class="ar">Rows</th><th>Status</th></tr></thead><tbody>';
      d.recent_syncs.slice(0,15).forEach(function(l){
        var time=l.started_at?l.started_at.replace('T',' ').slice(5,16):'--';
        var sc=l.status==='ok'?'var(--gn)':'var(--rd)';
        var msg=l.message||'';if(msg.length>60)msg=msg.slice(0,60)+'...';
        h+='<tr><td style="white-space:nowrap">'+time+'</td><td>'+esc(l.sync_type)+'</td><td class="ar">'+(l.rows_synced||0).toLocaleString()+'</td><td style="color:'+sc+'">'+esc(l.status)+(msg?' <span style="color:var(--t3)">'+esc(msg)+'</span>':'')+'</td></tr>';
      });
      h+='</tbody></table>';
      logEl.innerHTML=h;
    }
  }catch(e){
    var ss=$('ss-stock');if(ss)ss.textContent='err';
  }
}

// ═══════════════════════════════════════════════
// DATABASE TAB
// ═══════════════════════════════════════════════
async function renderSetDbStats(c){
  c.innerHTML='<div style="text-align:center;padding:20px;color:var(--t3)">Loading...</div>';
  try{
    var results=await Promise.all([
      fetch('/api/idx/stats').then(function(r){return r.json()}),
      fetch('/api/insider/stats').then(function(r){return r.json()}),
      fetch('/api/idx/fundamental/stats').then(function(r){return r.json()}),
      fetch('/api/idx/ca/stats').then(function(r){return r.json()}),
      fetch('/api/idx/indices/stats').then(function(r){return r.json()}).catch(function(){return{total:0}})
    ]);
    var idx=results[0],ins=results[1],fund=results[2],ca=results[3],idxIdx=results[4];

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
    if(fund.snapshot_month)h+='Fundamental: <b>'+fund.snapshot_month+'</b> ('+fund.total+' stocks)<br>';
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

    c.innerHTML=h;
  }catch(e){c.innerHTML='<div style="color:var(--rd);padding:20px">Error: '+e.message+'</div>';}
}

// ═══════════════════════════════════════════════
// UPLOAD TAB — Manual only (Insider + Tags)
// ═══════════════════════════════════════════════
function renderSetUpload(c){
  var h='';
  h+='<div class="s-section"><div class="s-section-title">Manual Upload</div>';
  h+='<div style="font-size:var(--font-sm);color:var(--t3);margin-bottom:8px">Semua data OHLCV/Index/Fundamental sekarang otomatis via Sync Center. Hanya data berikut yang masih manual.</div>';
  h+='<div class="s-row"><div class="s-row-icon">📋</div><div class="s-row-info"><div class="s-row-title">Insider Ownership (XLSX)</div><div class="s-row-desc">BEI monthly shareholder data</div></div><div class="s-row-action"><label class="s-upload-btn">Choose File<input type="file" accept=".xlsx,.xls" onchange="setUploadInsider(this)"></label></div></div>';
  h+='<div class="s-row"><div class="s-row-icon">🏷</div><div class="s-row-info"><div class="s-row-title">Investor Tags (XLSX)</div><div class="s-row-desc">Groups, keyword rules, ticker map</div></div><div class="s-row-action"><label class="s-upload-btn">Choose File<input type="file" accept=".xlsx" onchange="setUploadTags(this)"></label></div></div>';
  h+='</div>';
  h+='<div class="s-info" id="set-upload-info"></div>';
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
      h+='Holdings: <b>'+ins.total.toLocaleString()+'</b> | Tickers: <b>'+ins.tickers+'</b> | Investors: <b>'+ins.investors.toLocaleString()+'</b>';
      if(ins.latest)h+=' | Last: <b>'+ins.latest+'</b>';
    }else{h+='<span style="color:var(--t3)">No insider data yet</span>';}
    h+='<div style="margin-top:4px">Tags: <b>'+tags.groups+'</b> groups | <b>'+tags.rules+'</b> rules | <b>'+tags.overrides+'</b> overrides</div>';
    el.innerHTML=h;
  }).catch(function(){});
}

async function setUploadInsider(input){
  if(!input.files[0])return;var fd=new FormData();fd.append('file',input.files[0]);
  var info=$('set-upload-info');info.textContent='Uploading insider data...';info.className='s-info';
  try{var r=await fetch('/api/insider/upload',{method:'POST',body:fd});var d=await r.json();
    if(d.success){info.textContent=d.total.toLocaleString()+' records ('+d.new_rows+' new, '+d.updated_rows+' updated)';showT('Insider',d.new_rows+' new records');}
    else{info.textContent=d.error||'unknown';info.className='s-info error';}
  }catch(e){info.textContent=e.message;info.className='s-info error';}input.value='';
}

async function setUploadTags(input){
  if(!input.files[0])return;var fd=new FormData();fd.append('file',input.files[0]);
  var info=$('set-upload-info');info.textContent='Uploading tags...';info.className='s-info';
  try{var r=await fetch('/api/insider/tags/upload',{method:'POST',body:fd});var d=await r.json();
    if(d.success){info.textContent='Tags: '+d.groups+' groups, '+d.rules+' rules';showT('Tags',d.groups+' groups');}
    else{info.textContent=d.error||'unknown';info.className='s-info error';}
  }catch(e){info.textContent=e.message;info.className='s-info error';}input.value='';
}

// ═══════════════════════════════════════════════
// CORPORATE ACTIONS TAB
// ═══════════════════════════════════════════════
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
    if(!rows.length){h+='<div style="text-align:center;padding:20px;color:var(--t3)">No corporate actions.</div>';c.innerHTML=h;return;}
    h+='<div style="overflow-y:auto;max-height:calc(80vh - 260px)"><table class="s-ca-tbl"><thead><tr><th>Code</th><th>Ex-Date</th><th>Type</th><th class="ar">Ratio</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    rows.forEach(function(r){
      var sCls=r.status==='pending'?'pending':r.status==='confirmed'?'confirmed':'dismissed';
      h+='<tr><td style="font-weight:700;color:var(--bl)">'+r.code+'</td><td>'+r.ex_date+'</td><td>'+(r.action_type||'').toUpperCase()+'</td><td class="ar" style="font-weight:700">'+r.ratio.toFixed(2)+'x</td><td><span class="s-ca-status '+sCls+'">'+r.status+'</span></td><td style="white-space:nowrap">';
      if(r.status==='pending')h+='<button class="s-ca-btn confirm" onclick="setCAConfirm('+r.id+')">Y</button> <button class="s-ca-btn dismiss" onclick="setCADismiss('+r.id+')">N</button>';
      else h+='<button class="s-ca-btn" onclick="setCADelete('+r.id+')">X</button>';
      h+='</td></tr>';
    });
    h+='</tbody></table></div>';
    c.innerHTML=h;
  }catch(e){c.innerHTML='<div style="color:var(--rd);padding:20px">Error: '+e.message+'</div>';}
}

async function setCAConfirm(id){try{await fetch('/api/idx/ca/'+id+'/confirm',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'});renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCADismiss(id){try{await fetch('/api/idx/ca/'+id+'/dismiss',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'});renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCADelete(id){if(!confirm('Delete?'))return;try{await fetch('/api/idx/ca/'+id,{method:'DELETE'});renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCAConfirmAll(){if(!confirm('Confirm all pending?'))return;try{var r=await fetch('/api/idx/ca/confirm-all',{method:'POST'});var d=await r.json();showT('OK',d.confirmed+' confirmed');renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCADismissAll(){if(!confirm('Dismiss all pending?'))return;try{var r=await fetch('/api/idx/ca/dismiss-all',{method:'POST'});var d=await r.json();showT('OK',d.dismissed+' dismissed');renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}
async function setCARedetect(){try{var r=await fetch('/api/idx/ca/detect',{method:'POST'});var d=await r.json();showT('OK',d.total+' detected');renderSetCA($('smod-content'));}catch(e){showT('Error',e.message);}}

// ═══════════════════════════════════════════════
// TAGS TAB
// ═══════════════════════════════════════════════
function renderSetTags(c){
  if(typeof renderTagsEditor==='function')renderTagsEditor(c);
  else c.innerHTML='<div style="color:var(--t3);padding:20px">Tags editor not loaded</div>';
}

// ═══════════════════════════════════════════════
// EXPORT TAB
// ═══════════════════════════════════════════════
function renderSetExport(c){
  var h='<div class="s-section"><div class="s-section-title">Export CSV</div>';
  h+='<button class="s-export-btn" onclick="exportCSV(\'screener\')"><div class="se-icon">📊</div><div class="se-info"><div class="se-title">IDX Daily</div><div class="se-desc">Latest OHLCV + foreign flow</div></div></button>';
  h+='<button class="s-export-btn" onclick="exportCSV(\'foreign\')"><div class="se-icon">🌍</div><div class="se-info"><div class="se-title">Foreign Flow (5D)</div><div class="se-desc">Net foreign ranking</div></div></button>';
  h+='<button class="s-export-btn" onclick="exportCSV(\'fundamental\')"><div class="se-icon">📈</div><div class="se-info"><div class="se-title">Fundamental</div><div class="se-desc">PER, PBV, ROE, sector</div></div></button>';
  h+='<button class="s-export-btn" onclick="exportCSV(\'ca\')"><div class="se-icon">⚡</div><div class="se-info"><div class="se-title">Corporate Actions</div><div class="se-desc">All CAs with status</div></div></button>';
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
    }else if(type==='fundamental'){
      var r=await fetch('/api/screener/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rules:[],limit:999})});var d=await r.json();
      rows=[['Code','Name','Close','PER','PBV','ROE','ROA','DER','Sector','Industry']];
      (d.data||[]).forEach(function(r){var f=r.fund||{};rows.push([r.code,r.name,r.close,f.per||'',f.pbv||'',f.roe||'',f.roa||'',f.der||'',f.sector||'',f.industry||'']);});
    }else if(type==='ca'){
      var r=await fetch('/api/idx/ca');var d=await r.json();
      if(!d.data||!d.data.length)throw new Error('No data');
      rows=[['Code','Ex-Date','Type','Ratio','Old Shares','New Shares','Status','Notes']];
      d.data.forEach(function(r){rows.push([r.code,r.ex_date,r.action_type,r.ratio,r.old_shares,r.new_shares,r.status,r.notes]);});
    }
    var csv=rows.map(function(r){return r.map(function(v){var s=String(v==null?'':v);if(s.includes(',')||s.includes('"')||s.includes('\n'))s='"'+s.replace(/"/g,'""')+'"';return s;}).join(',');}).join('\n');
    var blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();
    if(info)info.textContent='Downloaded '+filename+' ('+rows.length+' rows)';
  }catch(e){if(info){info.textContent=e.message;info.className='s-info error';}}
}

// ═══════════════════════════════════════════════
// PREFERENCES TAB
// ═══════════════════════════════════════════════
function renderSetPrefs(c){
  var th=document.documentElement.getAttribute('data-theme')||'dark';
  var isCompact=document.body.classList.contains('compact');
  var h='<div class="s-section"><div class="s-section-title">Appearance</div>';
  h+='<div class="s-row"><div class="s-row-icon">🌙</div><div class="s-row-info"><div class="s-row-title">Dark Mode</div><div class="s-row-desc">Toggle dark/light</div></div><div class="s-row-action"><div class="s-toggle'+(th==='dark'?' on':'')+'" onclick="prefTogTheme()"></div></div></div>';
  h+='<div class="s-row"><div class="s-row-icon">◻</div><div class="s-row-info"><div class="s-row-title">Compact Mode</div><div class="s-row-desc">Data-dense view</div></div><div class="s-row-action"><div class="s-toggle'+(isCompact?' on':'')+'" onclick="prefTogCompact(this)"></div></div></div>';
  h+='</div>';
  h+='<div class="s-section"><div class="s-section-title">About</div><div style="font-size:var(--font-md);color:var(--t2);line-height:1.8"><b>Banyu Langit</b> v3.0<br>Node.js + Express + SQLite + Deno Bridge<br>IDX market analytics platform</div></div>';
  c.innerHTML=h;
}
function prefTogTheme(){togTh();renderSetPrefs($('smod-content'));}
function prefTogCompact(el){if(typeof toggleCompact==='function')toggleCompact();if(el)el.classList.toggle('on');}

// ═══ Import All (bridge only, no Deno) ═══
async function idxApiImportAll(btn){
  if(btn){btn.disabled=true;btn.textContent='Importing...';}
  try{
    var r=await fetch('/api/idx/sync/import-all',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    var d=await r.json();
    if(d.error)throw new Error(d.error);
    var parts=[];
    if(d.detail){Object.entries(d.detail).forEach(function(e){if(e[1]&&e[1].rows)parts.push(e[0]+':'+e[1].rows);});}
    syncShowResult('Imported '+d.total_rows+' rows ('+parts.join(', ')+')',false);
    showT('Bridge Import',d.total_rows+' rows');
    syncLoadStatus();
  }catch(e){syncShowResult('Error: '+e.message,true);}
  finally{if(btn){btn.disabled=false;btn.textContent='📥 Bridge Import';}}
}

// ═══ Backward compat ═══
function renderSetIdxApi(c){renderSetSync(c);}
async function setUploadQuarterly(input){input.value='';showT('Info','Use Sync Center');}
async function renderUploadLogs(){}
async function idxApiLoadStatus(){syncLoadStatus();}
