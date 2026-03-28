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
  var titles={sync:'🔄 Sync Center',dbstats:'🗄 Database',upload:'📤 BEI Upload',ca:'⚡ Corp Actions',tags:'🏷 Tags',export:'📥 Export',prefs:'🎨 Prefs',custom:'📌 Custom Tickers',eod:'🌐 EOD Fetcher'};
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
  else if(tab==='custom')renderSetCustom(c);
  else if(tab==='eod')renderSetEOD(c);
}

// ═══════════════════════════════════════════════
// SYNC CENTER — Custom sync + module picker + date range
// ═══════════════════════════════════════════════

var SYNC_MODULES = {
  // Per-date (loop each trading day)
  stock_summary: { label: 'Stock Summary', icon: '📊', desc: 'OHLCV + foreign + bid/offer', type: 'daily', group: 'Market Data' },
  index_summary: { label: 'Index Summary', icon: '📈', desc: 'IHSG, LQ45, IDX30, etc', type: 'daily', group: 'Market Data' },
  broker_summary: { label: 'Broker Summary', icon: '🏦', desc: 'Broker buy/sell per day', type: 'daily', group: 'Market Data' },
  announcements: { label: 'Announcements', icon: '📢', desc: 'Company announcements', type: 'daily', group: 'Corporate' },
  market_calendar: { label: 'Market Calendar', icon: '📅', desc: 'Trading calendar', type: 'daily', group: 'Reference' },
  // Per-month
  financial_ratio: { label: 'Financial Ratios', icon: '📋', desc: 'PER, PBV, ROE, etc', type: 'monthly', group: 'Fundamental' },
  dividends: { label: 'Dividends', icon: '💰', desc: 'Dividend history', type: 'monthly', group: 'Corporate' },
  stock_split: { label: 'Stock Splits', icon: '✂', desc: 'Split/reverse split', type: 'monthly', group: 'Corporate' },
  foreign_trading: { label: 'Foreign Trading', icon: '🌍', desc: 'Foreign flow aggregate', type: 'monthly', group: 'Flow' },
  domestic_trading: { label: 'Domestic Trading', icon: '🏠', desc: 'Domestic flow aggregate', type: 'monthly', group: 'Flow' },
  industry_trading: { label: 'Industry Trading', icon: '🏭', desc: 'Per-industry flow', type: 'monthly', group: 'Flow' },
  sectoral: { label: 'Sectoral Movement', icon: '📊', desc: 'Per-sector performance', type: 'monthly', group: 'Flow' },
  daily_index: { label: 'Daily Index', icon: '📉', desc: 'Index daily values', type: 'monthly', group: 'Market Data' },
  top_movers: { label: 'Top Movers', icon: '🔥', desc: 'Gainer/Loser ranking', type: 'monthly', group: 'Market Data' },
  active_stocks: { label: 'Active Stocks', icon: '⚡', desc: 'By volume/value/freq', type: 'monthly', group: 'Market Data' },
  // No-date (run once)
  screener: { label: 'Screener', icon: '🔍', desc: 'Stock screener data', type: 'once', group: 'Reference' },
  company_profile: { label: 'Company Profiles', icon: '🏢', desc: 'Name, sector, industry', type: 'once', group: 'Reference' },
  suspends: { label: 'Suspensions', icon: '🚫', desc: 'Suspended stocks', type: 'once', group: 'Reference' },
  index_list: { label: 'Index List', icon: '📜', desc: 'All index constituents', type: 'once', group: 'Reference' }
};

function renderSetSync(c){
  var h='';

  // Deno server status
  h+='<div id="sync-deno-bar" style="padding:6px 10px;border-radius:4px;margin-bottom:10px;font-size:var(--font-md);background:var(--bgH);border:1px solid var(--b1);display:flex;align-items:center;gap:8px">';
  h+='<span id="sync-deno-dot" style="width:8px;height:8px;border-radius:50%;background:var(--t3);flex-shrink:0"></span>';
  h+='<span id="sync-deno-text" style="color:var(--t2)">Checking Deno server...</span>';
  h+='</div>';

  // Quick stats
  h+='<div class="s-stats" id="sync-stats" style="margin-bottom:10px">';
  h+='<div class="s-stat"><div class="s-stat-val" id="ss-stock">--</div><div class="s-stat-lbl">Stock Latest</div></div>';
  h+='<div class="s-stat"><div class="s-stat-val" id="ss-index">--</div><div class="s-stat-lbl">Index Latest</div></div>';
  h+='<div class="s-stat"><div class="s-stat-val" id="ss-tickers">--</div><div class="s-stat-lbl">Tickers</div></div>';
  h+='<div class="s-stat"><div class="s-stat-val" id="ss-days">--</div><div class="s-stat-lbl">Trading Days</div></div>';
  h+='</div>';

  // ── Quick Presets ──
  h+='<div style="margin-bottom:10px">';
  h+='<div style="font-size:10px;font-weight:700;color:var(--t2);margin-bottom:4px;text-transform:uppercase">Quick Presets</div>';
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap">';
  h+='<button class="s-upload-btn" style="padding:5px 12px;background:var(--gn);color:#000;border-color:var(--gn);font-weight:700" onclick="syncPreset(\'daily\')">⚡ Today</button>';
  h+='<button class="s-upload-btn" style="padding:5px 12px;background:var(--bl);color:#000;border-color:var(--bl);font-weight:700" onclick="syncPreset(\'week\')">📦 Last 5 Days</button>';
  h+='<button class="s-upload-btn" style="padding:5px 12px" onclick="syncPreset(\'all\')">🔄 All Tables (Today)</button>';
  h+='<button class="s-upload-btn" style="padding:5px 12px" onclick="idxApiImportAll(this)">📥 Bridge Import Only</button>';
  h+='</div></div>';

  // ── Custom Sync: Date Range ──
  h+='<div style="border:1px solid var(--b1);border-radius:6px;padding:10px;margin-bottom:10px;background:var(--bgH)">';
  h+='<div style="font-size:10px;font-weight:700;color:var(--t2);margin-bottom:6px;text-transform:uppercase">Custom Sync</div>';
  h+='<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">';
  h+='<label style="font-size:11px;color:var(--t2)">From:</label>';
  h+='<input type="date" id="sync-from" style="background:var(--bg0);border:1px solid var(--b2);padding:3px 8px;color:var(--t1);border-radius:3px;font-family:var(--fm);font-size:11px">';
  h+='<label style="font-size:11px;color:var(--t2)">To:</label>';
  h+='<input type="date" id="sync-to" style="background:var(--bg0);border:1px solid var(--b2);padding:3px 8px;color:var(--t1);border-radius:3px;font-family:var(--fm);font-size:11px">';
  // Quick range buttons
  h+='<span style="font-size:10px;color:var(--t3);margin-left:4px">Quick:</span>';
  ['1W','1M','3M','6M','1Y'].forEach(function(r){
    h+='<button class="bei-sort-btn" onclick="syncSetRange(\''+r+'\')" style="padding:2px 6px;font-size:9px">'+r+'</button>';
  });
  h+='</div>';

  // ── Module Picker ──
  h+='<div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap">';
  h+='<button class="bei-sort-btn" onclick="syncSelectAll(true)" style="padding:2px 8px;font-size:9px">Select All</button>';
  h+='<button class="bei-sort-btn" onclick="syncSelectAll(false)" style="padding:2px 8px;font-size:9px">Deselect All</button>';
  h+='<button class="bei-sort-btn" onclick="syncSelectGroup(\'Market Data\')" style="padding:2px 8px;font-size:9px">Market Data</button>';
  h+='<button class="bei-sort-btn" onclick="syncSelectGroup(\'Flow\')" style="padding:2px 8px;font-size:9px">Flow</button>';
  h+='<button class="bei-sort-btn" onclick="syncSelectGroup(\'Fundamental\')" style="padding:2px 8px;font-size:9px">Fundamental</button>';
  h+='<button class="bei-sort-btn" onclick="syncSelectGroup(\'Corporate\')" style="padding:2px 8px;font-size:9px">Corporate</button>';
  h+='<button class="bei-sort-btn" onclick="syncSelectGroup(\'Reference\')" style="padding:2px 8px;font-size:9px">Reference</button>';
  h+='</div>';

  h+='<div id="sync-modules" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px;max-height:200px;overflow-y:auto;margin-bottom:8px">';
  Object.keys(SYNC_MODULES).forEach(function(key){
    var m=SYNC_MODULES[key];
    var checked=key==='stock_summary'||key==='index_summary'?' checked':'';
    h+='<label style="display:flex;gap:4px;align-items:center;padding:3px 6px;border-radius:3px;background:var(--bg0);cursor:pointer;font-size:10px" title="'+esc(m.desc)+' ('+m.type+')">';
    h+='<input type="checkbox" class="sync-mod-cb" value="'+key+'"'+checked+' style="margin:0">';
    h+='<span>'+m.icon+'</span>';
    h+='<span style="color:var(--t1)">'+esc(m.label)+'</span>';
    h+='<span style="color:var(--t3);font-size:8px;margin-left:auto">'+m.type+'</span>';
    h+='</label>';
  });
  h+='</div>';

  // Start button
  h+='<div style="display:flex;gap:8px;align-items:center">';
  h+='<button id="sync-custom-btn" class="s-upload-btn" style="padding:6px 16px;background:var(--or);color:#000;border-color:var(--or);font-weight:700" onclick="syncCustomStart(this)">🚀 Start Custom Sync</button>';
  h+='<span id="sync-module-count" style="font-size:10px;color:var(--t3)"></span>';
  h+='</div>';
  h+='</div>';

  // Progress area
  h+='<div id="sync-progress" style="display:none;padding:8px 10px;border-radius:4px;margin-bottom:10px;background:var(--bg2);border:1px solid var(--b1);font-size:var(--font-sm);font-family:var(--fm);max-height:160px;overflow-y:auto"></div>';
  h+='<div class="s-info" id="sync-result" style="display:none"></div>';

  // Bridge status
  h+='<div id="sync-bridge" style="font-size:var(--font-sm);color:var(--t2);margin-bottom:10px"></div>';

  // Sync log
  h+='<div class="s-section"><div class="s-section-title">Recent Syncs</div>';
  h+='<div id="sync-log" style="font-size:var(--font-md);max-height:180px;overflow-y:auto">Loading...</div>';
  h+='</div>';

  c.innerHTML=h;

  // Set default dates (from: 5 days ago, to: today)
  var today=new Date(),from5=new Date();from5.setDate(today.getDate()-5);
  var toEl=document.getElementById('sync-to'),fromEl=document.getElementById('sync-from');
  if(toEl)toEl.value=today.toISOString().split('T')[0];
  if(fromEl)fromEl.value=from5.toISOString().split('T')[0];

  syncLoadStatus();
  syncCheckDeno();
  syncUpdateModuleCount();

  // Live count update
  document.querySelectorAll('.sync-mod-cb').forEach(function(cb){
    cb.addEventListener('change',syncUpdateModuleCount);
  });
}

// ── Module selection helpers ──
function syncSelectAll(state){
  document.querySelectorAll('.sync-mod-cb').forEach(function(cb){cb.checked=state;});
  syncUpdateModuleCount();
}
function syncSelectGroup(group){
  document.querySelectorAll('.sync-mod-cb').forEach(function(cb){
    var mod=SYNC_MODULES[cb.value];
    if(mod&&mod.group===group)cb.checked=true;
  });
  syncUpdateModuleCount();
}
function syncUpdateModuleCount(){
  var cnt=document.querySelectorAll('.sync-mod-cb:checked').length;
  var el=document.getElementById('sync-module-count');
  if(el)el.textContent=cnt+' module'+(cnt!==1?'s':'')+' selected';
}

// ── Date range quick-set ──
function syncSetRange(range){
  var to=new Date(),from=new Date();
  if(range==='1W')from.setDate(to.getDate()-7);
  else if(range==='1M')from.setMonth(to.getMonth()-1);
  else if(range==='3M')from.setMonth(to.getMonth()-3);
  else if(range==='6M')from.setMonth(to.getMonth()-6);
  else if(range==='1Y')from.setFullYear(to.getFullYear()-1);
  var toEl=document.getElementById('sync-to'),fromEl=document.getElementById('sync-from');
  if(toEl)toEl.value=to.toISOString().split('T')[0];
  if(fromEl)fromEl.value=from.toISOString().split('T')[0];
}

// ── Quick presets ──
function syncPreset(mode){
  if(mode==='daily'){
    // Select stock+index, set today, start
    syncSelectAll(false);
    document.querySelectorAll('.sync-mod-cb').forEach(function(cb){
      if(cb.value==='stock_summary'||cb.value==='index_summary')cb.checked=true;
    });
    var today=new Date().toISOString().split('T')[0];
    var toEl=document.getElementById('sync-to'),fromEl=document.getElementById('sync-from');
    if(toEl)toEl.value=today;if(fromEl)fromEl.value=today;
    syncUpdateModuleCount();
    sync1Click('daily',document.getElementById('sync-custom-btn')||document.createElement('button'));
  }else if(mode==='week'){
    syncSelectAll(false);
    ['stock_summary','index_summary','screener','financial_ratio','company_profile'].forEach(function(m){
      var cb=document.querySelector('.sync-mod-cb[value="'+m+'"]');if(cb)cb.checked=true;
    });
    syncSetRange('1W');
    syncUpdateModuleCount();
  }else if(mode==='all'){
    syncSelectAll(false);
    sync1Click('cron',document.createElement('button'));
  }
}

// ── Custom sync start ──
async function syncCustomStart(btn){
  var modules=[];
  document.querySelectorAll('.sync-mod-cb:checked').forEach(function(cb){modules.push(cb.value);});
  if(!modules.length){syncShowResult('No modules selected',true);return;}

  var fromEl=document.getElementById('sync-from'),toEl=document.getElementById('sync-to');
  var from=fromEl?fromEl.value:'';
  var to=toEl?toEl.value:'';
  if(!from||!to){syncShowResult('Date range required',true);return;}

  var origText=btn.textContent;
  btn.disabled=true;btn.textContent='Starting...';
  var prog=document.getElementById('sync-progress');
  var result=document.getElementById('sync-result');
  if(prog){prog.style.display='block';prog.innerHTML='<span style="color:var(--am)">Starting custom sync: '+modules.length+' modules, '+from+' → '+to+'</span>';}
  if(result)result.style.display='none';

  try{
    var r=await fetch('/api/idx/sync/custom',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({modules:modules,from:from,to:to})
    });
    var d=await r.json();
    if(d.ok){
      if(prog)prog.innerHTML='<span style="color:var(--am)">Custom sync running... polling progress</span>';
      syncPollTimer=setInterval(function(){syncPollProgress('custom',btn,origText)},3000);
    }else if(d.error==='busy'){
      syncShowResult('Deno busy: '+(d.message||''),true);
      btn.disabled=false;btn.textContent=origText;
      if(prog)prog.style.display='none';
    }else{
      syncShowResult('Error: '+(d.error||'failed'),true);
      btn.disabled=false;btn.textContent=origText;
      if(prog)prog.style.display='none';
    }
  }catch(e){
    if(prog)prog.style.display='none';
    syncShowResult('Error: '+e.message+' — Is Deno running?',true);
    btn.disabled=false;btn.textContent=origText;
  }
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
// BEI DATA UPLOAD — Auto-detect + Preview + Confirm
// ═══════════════════════════════════════════════
var _beiPreview=null;

function renderSetUpload(c){
  var h='';
  h+='<div class="s-section"><div class="s-section-title">BEI Data Upload</div>';
  h+='<div style="font-size:var(--font-sm);color:var(--t3);margin-bottom:10px">Drop any BEI file — auto-detects Financial Data, Balance Position, Corporate Actions, Dividends</div>';
  h+='<div id="bei-dropzone" style="border:2px dashed var(--b2);border-radius:10px;padding:28px 20px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s" onclick="document.getElementById(\'bei-file-input\').click()" ondragover="event.preventDefault();this.style.borderColor=\'var(--am)\';this.style.background=\'rgba(255,152,0,0.05)\'" ondragleave="this.style.borderColor=\'var(--b2)\';this.style.background=\'transparent\'" ondrop="beiHandleDrop(event)">';
  h+='<div style="font-size:13px;color:var(--t2);font-weight:500">Drop file here or click to browse</div>';
  h+='<div style="font-size:11px;color:var(--t3);margin-top:4px">XLSX · XLS · TXT</div>';
  h+='<input type="file" id="bei-file-input" accept=".xlsx,.xls,.txt,.csv" style="display:none" onchange="beiFileSelected(this)">';
  h+='</div>';
  h+='<div id="bei-preview" style="display:none"></div>';
  h+='</div>';

  h+='<div class="s-section"><div class="s-section-title">Insider Ownership</div>';
  h+='<div class="s-row"><div class="s-row-icon">📋</div><div class="s-row-info"><div class="s-row-title">Insider Ownership (XLSX)</div><div class="s-row-desc">BEI monthly shareholder >1% data</div></div><div class="s-row-action"><label class="s-upload-btn">Choose File<input type="file" accept=".xlsx,.xls" onchange="setUploadInsider(this)"></label></div></div>';
  h+='<div class="s-row"><div class="s-row-icon">🏷</div><div class="s-row-info"><div class="s-row-title">Investor Tags (XLSX)</div><div class="s-row-desc">Groups, keyword rules, ticker map</div></div><div class="s-row-action"><label class="s-upload-btn">Choose File<input type="file" accept=".xlsx" onchange="setUploadTags(this)"></label></div></div>';
  h+='<div class="s-info" id="set-upload-info"></div>';
  h+='</div>';

  h+='<div class="s-section"><div class="s-section-title">BEI Data Status</div>';
  h+='<div id="bei-data-stats" style="font-size:var(--font-md);color:var(--t2)">Loading...</div>';
  h+='</div>';

  h+='<div class="s-section"><div class="s-section-title">Import History</div>';
  h+='<div id="bei-upload-history" style="font-size:var(--font-md);color:var(--t2)">Loading...</div>';
  h+='</div>';

  c.innerHTML=h;
  beiLoadStats();
  beiLoadHistory();
}

function beiHandleDrop(e){
  e.preventDefault();
  var dz=document.getElementById('bei-dropzone');
  dz.style.borderColor='var(--b2)';dz.style.background='transparent';
  if(e.dataTransfer.files.length)beiUploadPreview(e.dataTransfer.files[0]);
}
function beiFileSelected(input){if(input.files[0])beiUploadPreview(input.files[0]);input.value='';}

async function beiUploadPreview(file){
  var preview=document.getElementById('bei-preview');
  preview.style.display='';
  preview.innerHTML='<div style="padding:16px;text-align:center;color:var(--t3)">Detecting file type...</div>';
  var fd=new FormData();fd.append('file',file);
  try{
    var r=await fetch('/api/idx/bei/upload/preview',{method:'POST',body:fd});
    var d=await r.json();
    if(d.error){preview.innerHTML=beiErrorCard(d.error,d.hint||'');return;}
    _beiPreview=d;
    preview.innerHTML=beiPreviewCard(d,file.name);
  }catch(e){preview.innerHTML=beiErrorCard(e.message,'');}
}

function beiPreviewCard(d,fileName){
  var h='<div style="margin-top:12px;border:1px solid var(--b2);border-radius:10px;overflow:hidden">';
  h+='<div style="padding:12px 16px;background:var(--bg2);border-bottom:1px solid var(--b1);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">';
  h+='<div><span style="color:var(--gn);font-weight:600;font-size:13px">✓ Detected: '+esc(d.label)+'</span>';
  if(d.snapshot)h+='<span style="margin-left:10px;font-size:12px;color:var(--t2)">Snapshot: <b style="color:var(--am)">'+esc(d.snapshot)+'</b></span>';
  h+='</div><div style="font-size:11px;color:var(--t3)">'+esc(fileName)+'</div></div>';

  h+='<div style="display:flex;gap:0;border-bottom:1px solid var(--b1)">';
  h+=beiStatPill('Rows',d.total_rows||0,'var(--t1)');
  if(d.skipped_rows>0)h+=beiStatPill('Skipped',d.skipped_rows,'var(--am)');
  if(d.conflicts>0)h+=beiStatPill('Overwrite',d.conflicts,'var(--rd)');
  h+='</div>';

  if(d.warnings&&d.warnings.length){
    h+='<div style="padding:8px 16px;border-bottom:1px solid var(--b1);font-size:11px;color:var(--am);background:rgba(255,152,0,0.04)">';
    d.warnings.forEach(function(w){h+='<div style="padding:1px 0">⚠ '+esc(w)+'</div>';});
    h+='</div>';
  }

  if(d.sample&&d.sample.length&&d.columns&&d.columns.length){
    h+='<div style="overflow-x:auto;max-height:220px;overflow-y:auto">';
    h+='<table style="width:100%;border-collapse:collapse;font-size:11px;font-family:var(--fm)">';
    h+='<thead><tr>';
    d.columns.forEach(function(c){h+='<th style="padding:4px 8px;text-align:left;border-bottom:1px solid var(--b2);color:var(--t3);font-weight:600;font-size:10px;white-space:nowrap;position:sticky;top:0;background:var(--bg1)">'+esc(c)+'</th>';});
    h+='</tr></thead><tbody>';
    d.sample.forEach(function(row){
      h+='<tr>';
      d.columns.forEach(function(c){
        var v=row[c];if(v===undefined||v===null)v='';
        if(typeof v==='number')v=v.toLocaleString();
        h+='<td style="padding:3px 8px;border-bottom:1px solid var(--b1);white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis">'+esc(String(v))+'</td>';
      });
      h+='</tr>';
    });
    h+='</tbody></table></div>';
  }

  h+='<div style="padding:12px 16px;display:flex;justify-content:flex-end;gap:8px;background:var(--bg2)">';
  h+='<button class="s-upload-btn" style="padding:6px 16px" onclick="beiCancelPreview()">Cancel</button>';
  h+='<button class="s-upload-btn" style="padding:6px 20px;background:var(--gn);color:#000;border-color:var(--gn);font-weight:700" onclick="beiCommit()">▶ Confirm Import</button>';
  h+='</div></div>';
  return h;
}

function beiStatPill(label,value,color){
  return '<div style="flex:1;padding:8px 16px;text-align:center;border-right:1px solid var(--b1)">'
    +'<div style="font-size:16px;font-weight:600;color:'+color+';font-family:var(--fm)">'+Number(value).toLocaleString()+'</div>'
    +'<div style="font-size:10px;color:var(--t3)">'+label+'</div></div>';
}

function beiErrorCard(msg,hint){
  var h='<div style="margin-top:12px;padding:16px;border:1px solid var(--rd);border-radius:10px;background:rgba(220,50,50,0.04)">';
  h+='<div style="font-size:13px;color:var(--rd);font-weight:600">✗ '+esc(msg)+'</div>';
  if(hint)h+='<div style="font-size:11px;color:var(--t3);margin-top:4px">'+esc(hint)+'</div>';
  h+='<button class="s-upload-btn" style="margin-top:8px;padding:4px 12px;font-size:11px" onclick="beiCancelPreview()">Dismiss</button>';
  h+='</div>';return h;
}

function beiCancelPreview(){
  _beiPreview=null;
  var el=document.getElementById('bei-preview');
  if(el){el.style.display='none';el.innerHTML='';}
}

async function beiCommit(){
  if(!_beiPreview||!_beiPreview.file_id)return;
  var preview=document.getElementById('bei-preview');
  var fileId=_beiPreview.file_id;var label=_beiPreview.label;
  preview.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">Importing '+esc(label)+'...</div>';
  try{
    var r=await fetch('/api/idx/bei/upload/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file_id:fileId})});
    var d=await r.json();
    if(d.error){preview.innerHTML=beiErrorCard(d.error,'');return;}
    var msg=d.rows_inserted+' rows imported';
    if(d.dividends_inserted)msg+=', '+d.dividends_inserted+' dividends';
    preview.innerHTML='<div style="margin-top:12px;padding:16px;border:1px solid var(--gn);border-radius:10px;background:rgba(50,180,50,0.04)">'
      +'<div style="font-size:13px;color:var(--gn);font-weight:600">✓ '+esc(label)+' imported successfully</div>'
      +'<div style="font-size:12px;color:var(--t2);margin-top:4px">'+esc(msg)+(d.snapshot?' · Snapshot: '+esc(d.snapshot):'')+'</div></div>';
    showT(label,msg);_beiPreview=null;
    beiLoadStats();beiLoadHistory();
    setTimeout(function(){var el=document.getElementById('bei-preview');if(el){el.style.display='none';el.innerHTML='';}},4000);
  }catch(e){preview.innerHTML=beiErrorCard(e.message,'');}
}

async function beiLoadStats(){
  var el=document.getElementById('bei-data-stats');if(!el)return;
  try{
    var r=await fetch('/api/idx/bei/upload/stats');var d=await r.json();
    var h='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">';
    h+=beiStatCard('Fundamental',d.fundamental?.total||0,d.fundamental?.snapshots?d.fundamental.snapshots+' snapshots':'No data',d.fundamental?.first&&d.fundamental?.last?d.fundamental.first+' → '+d.fundamental.last:'');
    h+=beiStatCard('Balance Pos.',d.balance_position?.total||0,d.balance_position?.snapshots?d.balance_position.snapshots+' snapshots':'No data',d.balance_position?.first&&d.balance_position?.last?d.balance_position.first+' → '+d.balance_position.last:'');
    h+=beiStatCard('Corp. Actions',d.corporate_actions?.total||0,d.corporate_actions?.first&&d.corporate_actions?.last?d.corporate_actions.first+'–'+d.corporate_actions.last:'No data','');
    h+=beiStatCard('Dividends',d.dividends?.total||0,d.dividends?.tickers?d.dividends.tickers+' tickers':'No data','');
    h+='</div>';el.innerHTML=h;
  }catch(e){el.innerHTML='<span style="color:var(--rd)">Error loading stats</span>';}
}

function beiStatCard(title,count,sub1,sub2){
  return '<div style="padding:10px 12px;background:var(--bg2);border-radius:8px;border:1px solid var(--b1)">'
    +'<div style="font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">'+title+'</div>'
    +'<div style="font-size:18px;font-weight:600;color:var(--t1);font-family:var(--fm);margin:2px 0">'+Number(count).toLocaleString()+'</div>'
    +(sub1?'<div style="font-size:10px;color:var(--t3)">'+esc(sub1)+'</div>':'')
    +(sub2?'<div style="font-size:10px;color:var(--t3)">'+esc(sub2)+'</div>':'')
    +'</div>';
}

async function beiLoadHistory(){
  var el=document.getElementById('bei-upload-history');if(!el)return;
  try{
    var r=await fetch('/api/idx/bei/upload/history');var rows=await r.json();
    if(!rows||!rows.length){el.innerHTML='<span style="color:var(--t3)">No imports yet</span>';return;}
    var typeLabels={financial_data:'Financial Data',balance_position:'Balance Position',ca_dividend:'Dividend',ca_rights:'Rights Issue',ca_split:'Stock Split',ca_reverse:'Reverse Stock',ca_bonus:'Bonus Shares',ca_merger:'Merger',ca_proxy:'Proxy/RUPS',ca_interest:'Interest',ca_conversion:'Conversion',ca_master:'CA Master'};
    var h='<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr>';
    h+='<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--b2);color:var(--t3);font-size:10px">Date</th>';
    h+='<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--b2);color:var(--t3);font-size:10px">Type</th>';
    h+='<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--b2);color:var(--t3);font-size:10px">Snapshot</th>';
    h+='<th style="text-align:right;padding:4px 8px;border-bottom:1px solid var(--b2);color:var(--t3);font-size:10px">Rows</th>';
    h+='<th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--b2);color:var(--t3);font-size:10px">File</th>';
    h+='</tr></thead><tbody>';
    rows.slice(0,20).forEach(function(r){
      var tl=typeLabels[r.file_type]||r.file_type;
      var ds=r.uploaded_at?r.uploaded_at.substring(0,16).replace('T',' '):'';
      h+='<tr style="border-bottom:1px solid var(--b1)">';
      h+='<td style="padding:3px 8px;font-family:var(--fm);color:var(--t2)">'+esc(ds)+'</td>';
      h+='<td style="padding:3px 8px"><span style="background:var(--bg2);padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600">'+esc(tl)+'</span></td>';
      h+='<td style="padding:3px 8px;font-family:var(--fm);color:var(--am)">'+esc(r.snapshot||'-')+'</td>';
      h+='<td style="padding:3px 8px;text-align:right;font-family:var(--fm);font-weight:600">'+(r.rows_inserted||0).toLocaleString()+'</td>';
      h+='<td style="padding:3px 8px;color:var(--t3);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(r.file_name)+'">'+esc(r.file_name||'')+'</td>';
      h+='</tr>';
    });
    h+='</tbody></table>';el.innerHTML=h;
  }catch(e){el.innerHTML='<span style="color:var(--rd)">Error loading history</span>';}
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

// ═══════════════════════════════════════════════
// CUSTOM TICKERS — AmiBroker-style import with column mapper
// ═══════════════════════════════════════════════

var _ctFileData = null; // parsed CSV lines
var _ctSep = ',';       // detected separator
var _ctSkip = 0;        // skip first N lines
var _ctColMap = [];     // column assignments: ['date','open','high','low','close','volume','skip'...]

var CT_ROLES = ['Skip','Ticker','Date','Open','High','Low','Close','Volume'];
var CT_CATEGORIES = [
  { v: 'global_index', l: '🌐 Global Index' },
  { v: 'commodity', l: '🛢 Commodity' },
  { v: 'currency', l: '💱 Currency' },
  { v: 'macro', l: '📊 Macro / Economic' },
  { v: 'fundamental_series', l: '📋 Fundamental Series' },
  { v: 'etf', l: '📦 ETF' },
  { v: 'crypto', l: '₿ Crypto' },
  { v: 'custom', l: '📌 Custom' }
];

function renderSetCustom(c) {
  var h = '';

  // ── Upload section ──
  h += '<div style="border:1px solid var(--b1);border-radius:6px;padding:14px;margin-bottom:14px;background:var(--bgH)">';
  h += '<div style="font-weight:700;margin-bottom:10px;color:var(--t1);font-size:14px">Add / Update Ticker</div>';

  // Row 1: Code + Name + Category + Linked Sector
  h += '<div style="display:grid;grid-template-columns:1fr 2fr 1fr 1fr;gap:8px;margin-bottom:10px">';
  h += '<div><div style="font-size:10px;color:var(--t3);margin-bottom:2px">Code *</div><input id="ct-code" placeholder="EIDO" style="width:100%;background:var(--bg0);border:1px solid var(--b2);padding:5px 8px;color:var(--bl);font-weight:700;text-transform:uppercase;border-radius:3px;font-family:var(--fm);font-size:12px"></div>';
  h += '<div><div style="font-size:10px;color:var(--t3);margin-bottom:2px">Name</div><input id="ct-name" placeholder="iShares MSCI Indonesia" style="width:100%;background:var(--bg0);border:1px solid var(--b2);padding:5px 8px;color:var(--t1);border-radius:3px;font-family:var(--f);font-size:12px"></div>';
  h += '<div><div style="font-size:10px;color:var(--t3);margin-bottom:2px">Category</div><select id="ct-cat" style="width:100%;background:var(--bg0);border:1px solid var(--b2);padding:5px 8px;color:var(--t1);border-radius:3px;font-family:var(--f);font-size:11px">';
  CT_CATEGORIES.forEach(function(cat) { h += '<option value="' + cat.v + '"' + (cat.v === 'custom' ? ' selected' : '') + '>' + cat.l + '</option>'; });
  h += '</select></div>';
  h += '<div><div style="font-size:10px;color:var(--t3);margin-bottom:2px">Linked Sector</div><select id="ct-sector" style="width:100%;background:var(--bg0);border:1px solid var(--b2);padding:5px 8px;color:var(--t1);border-radius:3px;font-family:var(--f);font-size:11px"><option value="">(none)</option></select></div>';
  h += '</div>';

  // Row 2: CSV file
  h += '<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">';
  h += '<div style="font-size:10px;color:var(--t3);min-width:60px">CSV File *</div>';
  h += '<input type="file" id="ct-file" accept=".csv,.txt,.tsv" style="font-size:12px;color:var(--t2)">';
  h += '</div>';

  // ── Column Mapper (hidden until file selected) ──
  h += '<div id="ct-mapper" style="display:none;border:1px solid var(--b2);border-radius:6px;padding:10px;margin-bottom:10px;background:var(--bg0)">';
  h += '<div style="font-size:12px;font-weight:700;color:var(--t1);margin-bottom:8px">Define Fields</div>';

  // Settings row: separator + skip lines
  h += '<div style="display:flex;gap:12px;align-items:center;margin-bottom:8px;flex-wrap:wrap">';
  h += '<label style="font-size:11px;color:var(--t2)">Separator: <select id="ct-sep" onchange="ctReParse()" style="background:var(--bg0);border:1px solid var(--b2);padding:3px 6px;color:var(--t1);border-radius:3px;font-family:var(--fm);font-size:11px"><option value=",">,  (comma)</option><option value=";">; (semicolon)</option><option value="\\t">Tab</option><option value="|">| (pipe)</option></select></label>';
  h += '<label style="font-size:11px;color:var(--t2)">Skip first <input type="number" id="ct-skip" value="0" min="0" max="20" onchange="ctReParse()" style="width:40px;background:var(--bg0);border:1px solid var(--b2);padding:3px;color:var(--t1);border-radius:3px;font-family:var(--fm);font-size:11px;text-align:center"> lines</label>';
  h += '<button class="bei-sort-btn" onclick="ctAutoDetect()" style="padding:3px 10px;font-size:10px">🔍 Auto-detect</button>';
  h += '</div>';

  // Column dropdowns (dynamic)
  h += '<div id="ct-col-selectors" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px"></div>';

  // Data sample preview
  h += '<div id="ct-sample" style="max-height:200px;overflow:auto;font-size:11px;font-family:var(--fm)"></div>';

  h += '</div>'; // end mapper

  // Upload button + result
  h += '<div style="display:flex;gap:8px;align-items:center">';
  h += '<button id="ct-upload-btn" class="s-upload-btn" style="padding:7px 20px;background:var(--gn);color:#000;border-color:var(--gn);font-weight:700;font-size:12px" onclick="ctUpload()">📤 Import CSV</button>';
  h += '<span id="ct-result" style="font-size:12px;color:var(--t2)"></span>';
  h += '</div>';
  h += '</div>';

  // ── Existing tickers table ──
  h += '<div style="font-weight:700;margin-bottom:6px;color:var(--t1);font-size:13px">Your Custom Tickers</div>';
  h += '<div id="ct-table" style="font-size:12px"><span style="color:var(--t3)">Loading...</span></div>';

  c.innerHTML = h;

  // Load sector options
  fetch('/api/screener/fundamental-lists').then(function(r) { return r.json(); }).then(function(d) {
    var sel = document.getElementById('ct-sector');
    if (sel && d.sectors) d.sectors.forEach(function(s) { sel.innerHTML += '<option value="' + esc(s) + '">' + esc(s) + '</option>'; });
  }).catch(function() {});

  // File change → parse & show mapper
  document.getElementById('ct-file').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    // Auto-suggest code
    var codeInput = document.getElementById('ct-code');
    if (!codeInput.value) {
      var suggested = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, ' ').trim().split(/\s+/)[0].toUpperCase();
      if (suggested && suggested.length <= 15) codeInput.value = suggested;
    }
    var reader = new FileReader();
    reader.onload = function(ev) {
      _ctFileData = ev.target.result.split(/\r?\n/).filter(function(l) { return l.trim(); });
      ctAutoDetectSep();
      ctBuildMapper();
      document.getElementById('ct-mapper').style.display = '';
    };
    reader.readAsText(file);
  });

  ctLoadTable();
}

// Auto-detect separator from first line (count separators OUTSIDE quotes)
function ctAutoDetectSep() {
  if (!_ctFileData || !_ctFileData.length) return;
  var line = _ctFileData[0];
  // Count separators outside quotes
  function countOutsideQuotes(line, sep) {
    var count = 0, inQ = false;
    for (var i = 0; i < line.length; i++) {
      if (line[i] === '"') inQ = !inQ;
      else if (line[i] === sep && !inQ) count++;
    }
    return count;
  }
  var counts = { ',': countOutsideQuotes(line, ','), ';': countOutsideQuotes(line, ';'), '\t': countOutsideQuotes(line, '\t'), '|': countOutsideQuotes(line, '|') };
  var best = ',', max = 0;
  for (var k in counts) { if (counts[k] > max) { max = counts[k]; best = k; } }
  _ctSep = best;
  var sel = document.getElementById('ct-sep');
  if (sel) sel.value = best === '\t' ? '\\t' : best;
}

// Parse a single CSV line respecting quotes
function ctParseLine(line, sep) {
  var result = [], current = '', inQ = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === sep && !inQ) { result.push(current.trim()); current = ''; continue; }
    current += c;
  }
  result.push(current.trim());
  return result;
}

// Re-parse when separator or skip changes
function ctReParse() {
  var sepSel = document.getElementById('ct-sep');
  _ctSep = sepSel ? (sepSel.value === '\\t' ? '\t' : sepSel.value) : ',';
  _ctSkip = parseInt((document.getElementById('ct-skip') || {}).value) || 0;
  ctBuildMapper();
}

// Build column mapper + sample preview
function ctBuildMapper() {
  if (!_ctFileData || !_ctFileData.length) return;
  var lines = _ctFileData.slice(_ctSkip);
  if (!lines.length) return;
  var firstLine = ctParseLine(lines[0], _ctSep);
  var numCols = firstLine.length;

  // Auto-detect column roles from header
  _ctColMap = firstLine.map(function(h) {
    var hl = h.replace(/"/g, '').trim().toLowerCase();
    if (/^(date|tanggal|datetime|timestamp|time|period|ymd)$/i.test(hl)) return 'Date';
    if (/^(open|px_open|harga_buka|pembukaan)$/i.test(hl)) return 'Open';
    if (/^(high|px_high|tertinggi|max)$/i.test(hl)) return 'High';
    if (/^(low|px_low|terendah|min)$/i.test(hl)) return 'Low';
    if (/^(close|px_last|price|adj.close|harga|nilai|value|last|terakhir)$/i.test(hl)) return 'Close';
    if (/^(vol|volume|vol\.|jumlah)$/i.test(hl)) return 'Volume';
    if (/^(ticker|symbol|code|kode)$/i.test(hl)) return 'Ticker';
    return 'Skip';
  });

  // Build selector dropdowns
  var selHtml = '';
  for (var i = 0; i < numCols; i++) {
    var headerLabel = firstLine[i].replace(/"/g, '').trim().substring(0, 15);
    selHtml += '<div style="display:flex;flex-direction:column;gap:2px;min-width:80px">';
    selHtml += '<div style="font-size:9px;color:var(--t3);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(headerLabel) + '">Col ' + (i + 1) + '</div>';
    selHtml += '<select data-colidx="' + i + '" onchange="_ctColMap[' + i + ']=this.value;ctRenderSample()" style="background:var(--bg0);border:1px solid var(--b2);padding:3px 4px;color:' + (_ctColMap[i] !== 'Skip' ? 'var(--am)' : 'var(--t2)') + ';border-radius:3px;font-family:var(--fm);font-size:10px;font-weight:' + (_ctColMap[i] !== 'Skip' ? '700' : '400') + '">';
    CT_ROLES.forEach(function(role) {
      selHtml += '<option value="' + role + '"' + (_ctColMap[i] === role ? ' selected' : '') + '>' + role + '</option>';
    });
    selHtml += '</select></div>';
  }
  document.getElementById('ct-col-selectors').innerHTML = selHtml;
  ctRenderSample();
}

// Render data sample table
function ctRenderSample() {
  var el = document.getElementById('ct-sample');
  if (!el || !_ctFileData) return;
  var lines = _ctFileData.slice(_ctSkip);
  var maxRows = Math.min(8, lines.length);
  var h = '<table style="width:100%;border-collapse:collapse">';

  // Header row with role labels
  var firstCols = ctParseLine(lines[0], _ctSep);
  h += '<tr>';
  for (var c = 0; c < firstCols.length; c++) {
    var role = _ctColMap[c] || 'Skip';
    var bg = role !== 'Skip' ? 'rgba(255,152,0,0.15)' : 'transparent';
    var color = role !== 'Skip' ? 'var(--am)' : 'var(--t3)';
    h += '<th style="padding:3px 6px;text-align:left;border-bottom:2px solid var(--b2);background:' + bg + ';color:' + color + ';font-size:10px;font-weight:700">' + role + '</th>';
  }
  h += '</tr>';

  // Data rows
  for (var i = 0; i < maxRows; i++) {
    var cols = ctParseLine(lines[i], _ctSep);
    var isHeader = (i === 0);
    h += '<tr style="border-bottom:1px solid var(--b1)">';
    for (var j = 0; j < cols.length; j++) {
      var val = cols[j].substring(0, 20);
      var role = _ctColMap[j] || 'Skip';
      var bg = role !== 'Skip' ? 'rgba(255,152,0,0.05)' : 'transparent';
      var style = isHeader ? 'color:var(--or);font-weight:600' : 'color:var(--t2)';
      h += '<td style="padding:3px 6px;' + style + ';background:' + bg + '">' + val + '</td>';
    }
    h += '</tr>';
  }
  h += '</table>';
  if (lines.length > 8) h += '<div style="color:var(--t3);margin-top:4px;font-size:10px">... ' + (lines.length - 1) + ' total data rows</div>';
  el.innerHTML = h;
}

// Auto-detect button: re-detect separator + columns
function ctAutoDetect() {
  ctAutoDetectSep();
  _ctSkip = 0;
  document.getElementById('ct-skip').value = '0';
  ctBuildMapper();
}

function ctLoadTable() {
  fetch('/api/idx/custom/tickers').then(function(r) { return r.json(); }).then(function(rows) {
    var el = document.getElementById('ct-table');
    if (!el) return;
    if (!rows.length) { el.innerHTML = '<div style="color:var(--t3);padding:8px">No custom tickers yet. Upload a CSV above.</div>'; return; }
    var h = '<table style="width:100%;border-collapse:collapse">';
    h += '<tr style="border-bottom:1px solid var(--b2)">';
    h += '<th style="text-align:left;padding:5px 8px;color:var(--t3);font-size:10px">Code</th>';
    h += '<th style="text-align:left;padding:5px 8px;color:var(--t3);font-size:10px">Name</th>';
    h += '<th style="text-align:left;padding:5px 8px;color:var(--t3);font-size:10px">Category</th>';
    h += '<th style="text-align:right;padding:5px 8px;color:var(--t3);font-size:10px">Rows</th>';
    h += '<th style="text-align:left;padding:5px 8px;color:var(--t3);font-size:10px">Range</th>';
    h += '<th style="text-align:left;padding:5px 8px;color:var(--t3);font-size:10px">Updated</th>';
    h += '<th style="padding:5px 8px;font-size:10px"></th>';
    h += '</tr>';
    rows.forEach(function(r) {
      var catColor = r.category === 'commodity' ? 'var(--am)' : r.category === 'global_index' ? 'var(--bl)' : r.category === 'currency' ? 'var(--gn)' : r.category === 'macro' ? '#a855f7' : 'var(--t2)';
      h += '<tr style="border-bottom:1px solid var(--b1)">';
      h += '<td style="padding:5px 8px;color:var(--bl);font-weight:700;font-size:12px;cursor:pointer" onclick="if(window.chartOpen)chartOpen(\'' + r.code + '\')">' + r.code + '</td>';
      h += '<td style="padding:5px 8px;color:var(--t2);font-size:12px">' + (r.name || '-') + '</td>';
      h += '<td style="padding:5px 8px"><span style="background:var(--bgH);padding:2px 8px;border-radius:3px;font-size:10px;color:' + catColor + ';border:1px solid ' + catColor + '33">' + (r.category || 'custom') + '</span></td>';
      h += '<td style="padding:5px 8px;text-align:right;color:var(--t1);font-family:var(--fm);font-size:12px">' + (r.rows || 0).toLocaleString() + '</td>';
      h += '<td style="padding:5px 8px;color:var(--t3);font-size:10px;font-family:var(--fm)">' + (r.first_date || '') + ' ~ ' + (r.last_date || '') + '</td>';
      h += '<td style="padding:5px 8px;color:var(--t3);font-size:10px">' + (r.updated_at || '').substring(0, 16) + '</td>';
      h += '<td style="padding:5px 8px">';
      h += '<button style="background:none;border:none;color:var(--rd);cursor:pointer;font-size:14px" onclick="ctDelete(\'' + r.code + '\')" title="Delete">🗑</button>';
      h += '</td></tr>';
    });
    h += '</table>';
    el.innerHTML = h;
  }).catch(function() {
    var el = document.getElementById('ct-table');
    if (el) el.innerHTML = '<span style="color:var(--rd)">Failed to load</span>';
  });
}

async function ctUpload() {
  var code = document.getElementById('ct-code').value.toUpperCase().trim();
  var name = document.getElementById('ct-name').value.trim();
  var cat = document.getElementById('ct-cat').value;
  var sector = (document.getElementById('ct-sector') || {}).value || '';
  var file = document.getElementById('ct-file').files[0];
  var btn = document.getElementById('ct-upload-btn');
  var result = document.getElementById('ct-result');

  if (!code) { result.innerHTML = '<span style="color:var(--rd)">Code required</span>'; return; }
  if (!file) { result.innerHTML = '<span style="color:var(--rd)">CSV file required</span>'; return; }

  // Validate column mapping has at least Date + Close
  var hasDate = _ctColMap.indexOf('Date') >= 0;
  var hasClose = _ctColMap.indexOf('Close') >= 0;
  if (_ctFileData && _ctColMap.length && (!hasDate || !hasClose)) {
    result.innerHTML = '<span style="color:var(--rd)">Column mapping needs at least Date + Close assigned</span>';
    return;
  }

  btn.disabled = true; btn.textContent = '⏳ Uploading...';
  result.innerHTML = '<span style="color:var(--t3)">Processing...</span>';

  try {
    var fd = new FormData();
    fd.append('file', file);
    fd.append('code', code);
    fd.append('name', name || code);
    fd.append('category', cat);
    fd.append('linked_sector', sector);
    fd.append('separator', _ctSep);
    fd.append('skip_lines', _ctSkip);
    fd.append('col_map', JSON.stringify(_ctColMap));

    var r = await fetch('/api/idx/custom/upload', { method: 'POST', body: fd });
    var d = await r.json();

    if (d.ok) {
      result.innerHTML = '<span style="color:var(--gn)">✅ ' + d.inserted + ' new + ' + d.updated + ' updated = ' + d.total_rows + ' total</span>';
      ctLoadTable();
      document.getElementById('ct-code').value = '';
      document.getElementById('ct-name').value = '';
      document.getElementById('ct-file').value = '';
      document.getElementById('ct-mapper').style.display = 'none';
      _ctFileData = null;
      showT('Custom Ticker', code + ': ' + d.total_rows + ' rows imported');
    } else {
      result.innerHTML = '<span style="color:var(--rd)">' + (d.error || 'Upload failed') + '</span>';
    }
  } catch (e) {
    result.innerHTML = '<span style="color:var(--rd)">Error: ' + e.message + '</span>';
  } finally {
    btn.disabled = false; btn.textContent = '📤 Import CSV';
  }
}

async function ctDelete(code) {
  if (!confirm('Delete custom ticker ' + code + ' and all its data?')) return;
  try {
    await fetch('/api/idx/custom/tickers/' + code, { method: 'DELETE' });
    ctLoadTable();
    showT('Deleted', code + ' removed');
  } catch (e) { showT('Error', e.message); }
}

// ═══════════════════════════════════════════════
// EOD FETCHER — Alpha Vantage + CoinGecko
// ═══════════════════════════════════════════════

var _eodLoading = false;

function renderSetEOD(c) {
  var h = '';

  // ── Add Ticker Form ──
  h += '<div style="border:1px solid var(--b2);border-radius:8px;padding:16px;margin-bottom:16px;background:var(--bg1)">';
  h += '<div style="font-weight:700;font-size:13px;color:var(--t1);margin-bottom:12px">🌐 Fetch EOD Data from API</div>';
  h += '<div style="font-size:10px;color:var(--t3);margin-bottom:12px">Yahoo Finance: US stocks, indices, commodities, forex (no key, full history) · CoinGecko: crypto (no key, 365 days)</div>';

  h += '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:10px">';
  // Code
  h += '<div><div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:2px">Ticker *</div>';
  h += '<input id="eod-code" style="width:120px;background:var(--bg0);border:1px solid var(--b1);border-radius:4px;padding:6px 8px;color:var(--t1);font-family:var(--fm);font-size:12px;text-transform:uppercase" placeholder="AAPL, BTC..."></div>';
  // Name
  h += '<div><div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:2px">Name</div>';
  h += '<input id="eod-name" style="width:180px;background:var(--bg0);border:1px solid var(--b1);border-radius:4px;padding:6px 8px;color:var(--t1);font-size:12px" placeholder="Apple Inc."></div>';
  // Category
  h += '<div><div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:2px">Category</div>';
  h += '<select id="eod-category" style="background:var(--bg0);border:1px solid var(--b1);border-radius:4px;padding:6px 8px;color:var(--t1);font-size:12px">';
  h += '<option value="global_index">🌍 Global Index/Stock</option>';
  h += '<option value="crypto">₿ Crypto</option>';
  h += '<option value="commodity">📦 Commodity</option>';
  h += '<option value="currency">💱 Currency (Forex)</option>';
  h += '<option value="custom">📌 Custom</option>';
  h += '</select></div>';
  // Full history toggle
  h += '<div><div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:2px">History</div>';
  h += '<select id="eod-full" style="background:var(--bg0);border:1px solid var(--b1);border-radius:4px;padding:6px 8px;color:var(--t1);font-size:12px">';
  h += '<option value="0">Latest ~100 days</option>';
  h += '<option value="1">Full (20yr stock / 1yr crypto)</option>';
  h += '</select></div>';
  // Fetch button
  h += '<button id="eod-fetch-btn" onclick="eodFetchOne()" style="padding:6px 16px;border-radius:4px;border:none;background:var(--bl);color:#fff;font-weight:700;font-size:12px;cursor:pointer">⚡ Fetch</button>';
  h += '</div>';

  h += '<div id="eod-result" style="font-size:11px;color:var(--t2)"></div>';
  h += '</div>';

  // ── Quick Add ──
  h += '<div style="border:1px solid var(--b2);border-radius:8px;padding:16px;margin-bottom:16px;background:var(--bg1)">';
  h += '<div style="font-weight:700;font-size:13px;color:var(--t1);margin-bottom:8px">⚡ Quick Add Popular</div>';
  h += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">';

  // US Stocks
  h += '<span style="font-size:9px;color:var(--t3);width:100%;font-weight:700">US Stocks:</span>';
  ['SPY|S&P 500 ETF','QQQ|Nasdaq 100 ETF','AAPL|Apple','MSFT|Microsoft','NVDA|Nvidia','TSLA|Tesla','GOOGL|Google','AMZN|Amazon','META|Meta'].forEach(function(s) {
    var parts = s.split('|');
    h += '<button class="bei-sort-btn" onclick="eodQuickAdd(\'' + parts[0] + '\',\'' + parts[1] + '\',\'global_index\')" style="font-size:10px;padding:3px 8px" title="' + parts[1] + '">' + parts[0] + '</button>';
  });

  // Crypto
  h += '<span style="font-size:9px;color:var(--t3);width:100%;font-weight:700;margin-top:6px">Crypto:</span>';
  ['BTC|Bitcoin','ETH|Ethereum','SOL|Solana','BNB|BNB','XRP|Ripple','ADA|Cardano','DOGE|Dogecoin','DOT|Polkadot','AVAX|Avalanche','LINK|Chainlink'].forEach(function(s) {
    var parts = s.split('|');
    h += '<button class="bei-sort-btn" onclick="eodQuickAdd(\'' + parts[0] + '\',\'' + parts[1] + '\',\'crypto\')" style="font-size:10px;padding:3px 8px" title="' + parts[1] + '">' + parts[0] + '</button>';
  });

  // Forex
  h += '<span style="font-size:9px;color:var(--t3);width:100%;font-weight:700;margin-top:6px">Forex:</span>';
  ['USDIDR|USD/IDR','EURUSD|EUR/USD','GBPUSD|GBP/USD','USDJPY|USD/JPY'].forEach(function(s) {
    var parts = s.split('|');
    h += '<button class="bei-sort-btn" onclick="eodQuickAdd(\'' + parts[0] + '\',\'' + parts[1] + '\',\'currency\')" style="font-size:10px;padding:3px 8px" title="' + parts[1] + '">' + parts[0] + '</button>';
  });

  h += '</div></div>';

  // ── Existing API tickers + Sync ──
  h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">';
  h += '<span style="font-weight:700;color:var(--t1);font-size:13px">API-sourced Tickers</span>';
  h += '<button onclick="eodSyncAllStale()" style="padding:4px 12px;border-radius:4px;border:1px solid var(--bl);background:transparent;color:var(--bl);font-size:11px;font-family:var(--f);cursor:pointer;font-weight:600" title="Update all tickers with data older than 7 days">🔄 Sync Stale</button>';
  h += '<span id="eod-sync-status" style="font-size:10px;color:var(--t3)"></span>';
  h += '</div>';
  h += '<div id="eod-table" style="font-size:12px"><span style="color:var(--t3)">Loading...</span></div>';

  c.innerHTML = h;
  eodLoadTable();
}

async function eodFetchOne() {
  var code = ($('eod-code') || {}).value || '';
  code = code.trim().toUpperCase();
  if (!code) { showT('⚠', 'Enter a ticker code'); return; }
  var name = ($('eod-name') || {}).value || code;
  var category = ($('eod-category') || {}).value || 'custom';
  var full = ($('eod-full') || {}).value === '1';

  var btn = $('eod-fetch-btn');
  var res = $('eod-result');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Fetching...'; }
  if (res) res.innerHTML = '<span style="color:var(--t3)">Fetching ' + code + '...</span>';

  try {
    var r = await fetch('/api/idx/custom/fetch-eod', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, name: name, category: category, full_history: full })
    });
    var d = await r.json();
    if (d.error) {
      if (res) res.innerHTML = '<span style="color:var(--rd)">❌ ' + d.error + '</span>';
    } else {
      if (res) res.innerHTML = '<span style="color:var(--gn)">✅ ' + code + ': ' + d.inserted + ' new + ' + d.updated + ' updated = ' + d.total_rows + ' total (' + (d.date_range.first || '') + ' ~ ' + (d.date_range.last || '') + ')</span>';
      // Clear inputs
      if ($('eod-code')) $('eod-code').value = '';
      if ($('eod-name')) $('eod-name').value = '';
      eodLoadTable();
    }
  } catch (e) {
    if (res) res.innerHTML = '<span style="color:var(--rd)">❌ ' + e.message + '</span>';
  }
  if (btn) { btn.disabled = false; btn.textContent = '⚡ Fetch'; }
}

function eodQuickAdd(code, name, category) {
  if ($('eod-code')) $('eod-code').value = code;
  if ($('eod-name')) $('eod-name').value = name;
  if ($('eod-category')) $('eod-category').value = category;
  eodFetchOne();
}

function eodLoadTable() {
  fetch('/api/idx/custom/tickers').then(function(r) { return r.json(); }).then(function(rows) {
    var el = $('eod-table'); if (!el) return;
    // Filter to show only API-sourced tickers
    var apiRows = rows.filter(function(r) { return r.source && r.source !== 'csv' && r.source !== 'manual'; });
    if (!apiRows.length) { el.innerHTML = '<div style="color:var(--t3);padding:8px">No API-sourced tickers yet. Use the form above to fetch data.</div>'; return; }

    var today = new Date().toISOString().split('T')[0];
    var h = '<table style="width:100%;border-collapse:collapse">';
    h += '<tr style="border-bottom:1px solid var(--b2)">';
    h += '<th style="text-align:left;padding:5px 8px;color:var(--t3);font-size:10px">Code</th>';
    h += '<th style="text-align:left;padding:5px 8px;color:var(--t3);font-size:10px">Name</th>';
    h += '<th style="text-align:left;padding:5px 8px;color:var(--t3);font-size:10px">Source</th>';
    h += '<th style="text-align:left;padding:5px 8px;color:var(--t3);font-size:10px">Category</th>';
    h += '<th style="text-align:right;padding:5px 8px;color:var(--t3);font-size:10px">Rows</th>';
    h += '<th style="text-align:left;padding:5px 8px;color:var(--t3);font-size:10px">Range</th>';
    h += '<th style="text-align:left;padding:5px 8px;color:var(--t3);font-size:10px">Status</th>';
    h += '<th style="padding:5px 8px;font-size:10px"></th>';
    h += '</tr>';

    apiRows.forEach(function(r) {
      var srcColor = r.source === 'coingecko' ? '#f59e0b' : r.source === 'av_stock' ? '#0ea5e9' : r.source === 'av_forex' ? '#22c55e' : 'var(--t2)';
      var srcLabel = r.source === 'coingecko' ? 'CoinGecko' : r.source === 'av_stock' ? 'Alpha V.' : r.source === 'av_forex' ? 'AV Forex' : r.source || '-';
      var catColor = r.category === 'commodity' ? 'var(--am)' : r.category === 'global_index' ? 'var(--bl)' : r.category === 'currency' ? 'var(--gn)' : r.category === 'crypto' ? '#f59e0b' : 'var(--t2)';
      var stale = false, staleDays = 0;
      if (r.last_date) {
        var diff = Math.floor((new Date(today) - new Date(r.last_date)) / 86400000);
        if (diff > 7) { stale = true; staleDays = diff; }
      }

      h += '<tr style="border-bottom:1px solid var(--b1)">';
      h += '<td style="padding:5px 8px;color:var(--bl);font-weight:700;font-size:12px">' + r.code + '</td>';
      h += '<td style="padding:5px 8px;color:var(--t2);font-size:12px">' + (r.name || '-') + '</td>';
      h += '<td style="padding:5px 8px"><span style="font-size:10px;color:' + srcColor + ';font-weight:600">' + srcLabel + '</span></td>';
      h += '<td style="padding:5px 8px"><span style="background:var(--bgH);padding:2px 8px;border-radius:3px;font-size:10px;color:' + catColor + ';border:1px solid ' + catColor + '33">' + (r.category || 'custom') + '</span></td>';
      h += '<td style="padding:5px 8px;text-align:right;color:var(--t1);font-family:var(--fm);font-size:12px">' + (r.rows || 0).toLocaleString() + '</td>';
      h += '<td style="padding:5px 8px;color:var(--t3);font-size:10px;font-family:var(--fm)">' + (r.first_date || '') + ' ~ ' + (r.last_date || '') + '</td>';
      h += '<td style="padding:5px 8px;font-size:10px">';
      if (stale) h += '<span title="Data ' + staleDays + ' hari tertinggal" style="color:var(--rd);cursor:help">⚠ ' + staleDays + 'd ago</span>';
      else h += '<span style="color:var(--gn)">✓ Fresh</span>';
      h += '</td>';
      h += '<td style="padding:5px 8px;white-space:nowrap">';
      h += '<button id="eod-sync-' + r.code + '" style="background:none;border:none;color:var(--bl);cursor:pointer;font-size:13px;padding:0 4px" onclick="eodSyncOne(\'' + r.code + '\',\'' + esc(r.name || '') + '\',\'' + esc(r.category || '') + '\')" title="Refresh data">🔄</button>';
      h += '<button style="background:none;border:none;color:var(--rd);cursor:pointer;font-size:14px;padding:0 4px" onclick="eodDelete(\'' + r.code + '\')" title="Delete">🗑</button>';
      h += '</td></tr>';
    });
    h += '</table>';
    el.innerHTML = h;
  }).catch(function() {
    var el = $('eod-table'); if (el) el.innerHTML = '<span style="color:var(--rd)">Failed to load</span>';
  });
}

async function eodSyncOne(code, name, category) {
  var btn = $('eod-sync-' + code);
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    var r = await fetch('/api/idx/custom/fetch-eod', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, name: name, category: category })
    });
    var d = await r.json();
    if (d.error) showT('⚠', code + ': ' + d.error);
    else showT('✅', code + ': +' + d.inserted + ' new, ' + d.updated + ' updated');
    eodLoadTable();
  } catch (e) { showT('Error', e.message); }
  if (btn) { btn.textContent = '🔄'; btn.disabled = false; }
}

async function eodSyncAllStale() {
  var st = $('eod-sync-status');
  if (st) st.textContent = 'Syncing stale tickers...';
  try {
    var r = await fetch('/api/idx/custom/sync-stale', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stale_days: 7 })
    });
    var d = await r.json();
    if (d.error) { if (st) st.textContent = '⚠ ' + d.error; return; }
    var ok = (d.results || []).filter(function(r) { return !r.error; }).length;
    var fail = (d.results || []).filter(function(r) { return r.error; }).length;
    if (st) st.textContent = '✅ ' + ok + ' synced' + (fail ? ', ' + fail + ' failed' : '');
    eodLoadTable();
  } catch (e) { if (st) st.textContent = '⚠ ' + e.message; }
}

async function eodDelete(code) {
  if (!confirm('Delete ' + code + ' and all its OHLC data?')) return;
  try {
    await fetch('/api/idx/custom/tickers/' + code, { method: 'DELETE' });
    eodLoadTable();
    showT('Deleted', code + ' removed');
  } catch (e) { showT('Error', e.message); }
}