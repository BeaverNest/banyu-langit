// ═══ IDX Daily Analytics — Redesigned ═══
let beiMode='top',beiSort='value',beiDir='desc',beiFlowDays=5,beiFlowDir='desc',beiAnomalyType='block';
let beiStats=null,beiFundFilters=null,beiSector='',beiIndustry='';

async function loadBeiStats(){
  try{var r=await fetch('/api/idx/stats');beiStats=await r.json();}catch{beiStats=null;}
}
async function loadBeiFundFilters(){
  if(beiFundFilters)return;
  try{var r=await fetch('/api/idx/fundamental/stats');beiFundFilters=await r.json();}catch{beiFundFilters=null;}
}

// ═══ Status bar — compact one-liner ═══
function beiStatusBar(){
  if(!beiStats||!beiStats.latest)return'<div class="bei-status bei-status-empty">No IDX data. Upload via ⚙️ Settings.</div>';
  var latest=beiStats.latest;
  var now=new Date(),last=new Date(latest+'T17:00:00+07:00');
  var gap=0,d=new Date(last);
  while(d<now){d.setDate(d.getDate()+1);var dow=d.getDay();if(dow!==0&&dow!==6)gap++;}
  var icon=gap<=0?'🟢':gap<=1?'🟡':'🔴';
  var h='<div class="bei-status">'+icon+' <b>'+latest+'</b>';
  if(gap>1)h+=' <span style="color:var(--rd)">('+gap+'d behind)</span>';
  else if(gap===1)h+=' <span style="color:var(--am)">(yesterday)</span>';
  h+=' · '+beiStats.dates+'d · '+beiStats.tickers+' stocks';
  if(beiStats.all_dates&&beiStats.all_dates.length>=2){
    var ds=new Set(beiStats.all_dates),first=new Date(beiStats.all_dates[0]+'T00:00:00'),lastD=new Date(beiStats.all_dates[beiStats.all_dates.length-1]+'T00:00:00');
    var missing=[],c=new Date(first);c.setDate(c.getDate()+1);
    while(c<=lastD){var dow=c.getDay();var iso=c.toISOString().split('T')[0];if(dow!==0&&dow!==6&&!ds.has(iso))missing.push(iso);c.setDate(c.getDate()+1);}
    if(missing.length>0)h+=' · <span style="color:var(--rd)" title="'+missing.slice(0,20).join(', ')+'">⚠ '+missing.length+' gap</span>';
  }
  h+='</div>';
  return h;
}

// ═══ Filter bar — search + sector + industry dropdowns ═══
function beiFilterBar(){
  var h='<div class="bei-filter-bar">';
  h+='<input id="bei-q" class="bei-filter-input" placeholder="Search ticker..." value="'+esc(beiSearch)+'" oninput="beiAcType()" onkeydown="beiAcKey(event)" autocomplete="off">';
  h+='<div class="bei-ac" id="bei-ac"></div>';
  if(beiFundFilters){
    var secs=beiFundFilters.sectors||[];
    var inds=beiFundFilters.industries||[];
    if(secs.length){
      h+='<select class="bei-filter-sel" id="bei-sector" onchange="beiSector=this.value;beiIndustry=\'\';loadBei()">';
      h+='<option value="">All Sectors</option>';
      secs.forEach(function(s){h+='<option value="'+esc(s)+'"'+(beiSector===s?' selected':'')+'>'+esc(s)+'</option>';});
      h+='</select>';
    }
    if(inds.length){
      h+='<select class="bei-filter-sel" id="bei-industry" onchange="beiIndustry=this.value;loadBei()">';
      h+='<option value="">All Industries</option>';
      // Filter industries by selected sector if applicable
      var filtInds=inds;
      if(beiSector&&beiFundFilters.sector_industry_map){
        filtInds=beiFundFilters.sector_industry_map[beiSector]||inds;
      }
      filtInds.forEach(function(s){h+='<option value="'+esc(s)+'"'+(beiIndustry===s?' selected':'')+'>'+esc(s)+'</option>';});
      h+='</select>';
    }
  }
  if(beiSector||beiIndustry)h+='<button class="bei-filter-clear" onclick="beiSector=\'\';beiIndustry=\'\';loadBei()">✕ Clear</button>';
  h+='</div>';
  return h;
}

// ═══ Get fundamental map for filtering by sector/industry ═══
let beiFundMap=null;
async function loadBeiFundMap(){
  if(beiFundMap)return;
  try{
    var r=await fetch('/api/screener/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rules:[],limit:999})});
    var d=await r.json();
    beiFundMap={};
    (d.data||[]).forEach(function(s){if(s.fund)beiFundMap[s.code]=s.fund;});
  }catch{beiFundMap={};}
}

function beiApplyFilters(data){
  if(!beiSector&&!beiIndustry)return data;
  if(!beiFundMap)return data;
  return data.filter(function(r){
    var f=beiFundMap[r.code];
    if(!f)return false;
    if(beiSector&&f.sector!==beiSector)return false;
    if(beiIndustry&&f.industry!==beiIndustry)return false;
    return true;
  });
}

let beiSearch='',beiAllData=[];
async function loadBei(mode,opts){
  if(mode)beiMode=mode;
  opts=opts||{};
  var el=$('bei-content');if(!el)return;
  if(!beiStats)await loadBeiStats();
  await loadBeiFundFilters();
  if(beiSector||beiIndustry)await loadBeiFundMap();

  var h=beiStatusBar();

  // CA pending banner — compact
  h+=await beiCaBanner();

  // Filter bar
  h+=beiFilterBar();

  // Mode tabs
  h+='<div class="bei-tabs">';
  [{k:'top',l:'📊 Rankings'},{k:'foreign',l:'🌍 Foreign Flow'},{k:'anomaly',l:'🔍 Anomaly'},{k:'ca',l:'⚡ Corp Action'}].forEach(function(t){
    h+='<button class="bei-tab'+(t.k===beiMode?' on':'')+'" onclick="beiSearch=\'\';loadBei(\''+t.k+'\')">'+t.l+'</button>';
  });
  h+='</div>';

  if(beiMode==='ca'){
    el.innerHTML=h+skelRows(4);
    await loadBeiCaPanel(el,h);
    return;
  }

  if(beiMode==='top'){
    if(opts.sort)beiSort=opts.sort;if(opts.dir)beiDir=opts.dir;
    // Sort tabs
    h+='<div class="bei-sort-bar">';
    [{k:'value',d:'desc',l:'💰 Value'},{k:'volume',d:'desc',l:'📦 Vol'},{k:'frequency',d:'desc',l:'⚡ Freq'},{k:'foreign_net',d:'desc',l:'🟢 F.Buy'},{k:'foreign_net',d:'asc',l:'🔴 F.Sell'},{k:'change_pct',d:'desc',l:'🔥 Gain'},{k:'change_pct',d:'asc',l:'📉 Loss'}].forEach(function(s){
      h+='<button class="bei-sort-btn'+(beiSort===s.k&&beiDir===s.d?' on':'')+'" onclick="loadBei(\'top\',{sort:\''+s.k+'\',dir:\''+s.d+'\'})">'+s.l+'</button>';
    });
    h+='</div>';
    el.innerHTML=h+skelRows(8);
    try{
      var [rt,rd]=await Promise.all([
        fetch('/api/idx/top?sort='+beiSort+'&dir='+beiDir+'&limit=50').then(r=>r.json()),
        fetch('/api/idx/digest').then(r=>r.json())
      ]);
      if(!rt.data||!rt.data.length){el.innerHTML=h+'<div class="ne" style="padding:24px">No data</div>';return;}
      beiAllData=rt.data;

      // Digest — compact cards
      if(rd&&!rd.error&&rd.market){
        h+=beiDigestCards(rd);
      }

      // Apply sector/industry filter
      var filtered=beiApplyFilters(rt.data);
      if(beiSector||beiIndustry){
        h+='<div style="padding:4px 12px;font-size:10px;color:var(--t3)">Showing '+filtered.length+' of '+rt.data.length+' stocks</div>';
      }
      h+=beiTable(filtered,'top');
      el.innerHTML=h;
    }catch(e){el.innerHTML=h+'<div class="ne">Error: '+e.message+'</div>';}

  }else if(beiMode==='foreign'){
    if(opts.days)beiFlowDays=opts.days;if(opts.dir)beiFlowDir=opts.dir;
    h+='<div class="bei-sort-bar">';
    [3,5,10,20].forEach(function(d){h+='<button class="bei-sort-btn'+(beiFlowDays===d?' on':'')+'" onclick="loadBei(\'foreign\',{days:'+d+'})">'+d+'D</button>';});
    h+='<span style="width:6px"></span>';
    h+='<button class="bei-sort-btn'+(beiFlowDir==='desc'?' on':'')+'" onclick="loadBei(\'foreign\',{dir:\'desc\'})">🟢 Buy</button>';
    h+='<button class="bei-sort-btn'+(beiFlowDir==='asc'?' on':'')+'" onclick="loadBei(\'foreign\',{dir:\'asc\'})">🔴 Sell</button>';
    h+='</div>';
    el.innerHTML=h+skelRows(8);
    try{
      var r=await fetch('/api/idx/foreign?days='+beiFlowDays+'&dir='+beiFlowDir+'&limit=40');
      var d=await r.json();
      if(!d.data||!d.data.length){el.innerHTML=h+'<div class="ne">No multi-day data</div>';return;}
      var filtered=beiApplyFilters(d.data);
      h+='<div class="bei-date">📅 '+d.dates.join(', ')+' ('+d.days_actual+'d)</div>';
      h+='<div style="overflow-y:auto;max-height:calc(100vh - 300px)"><table class="bei-tbl"><thead><tr><th class="al">Code</th><th class="al">Name</th><th class="ar">Close</th><th class="ar">Buy</th><th class="ar">Sell</th><th class="ar">Net</th><th class="ar">Days</th><th class="ar">Streak</th></tr></thead><tbody>';
      filtered.forEach(function(r){
        var fn=r.net_flow_val||0;var cls=fn>0?'up':fn<0?'dn':'';
        var streakCls=r.buy_days===r.trade_days?'up':(r.buy_days===0?'dn':'');
        var badge=r.buy_days===r.trade_days?'🔥ALL':r.buy_days===0?'❄️ALL':'';
        h+='<tr><td class="code al" onclick="showFlowDetail(\''+esc(r.code)+'\')">'+esc(r.code)+'</td>';
        h+='<td class="name al" title="'+esc(r.name)+'">'+esc(r.name)+'</td>';
        h+='<td class="ar">'+(r.last_close||0).toLocaleString()+'</td>';
        h+='<td class="ar up">'+fmtRp(r.total_buy_val)+'</td>';
        h+='<td class="ar dn">'+fmtRp(r.total_sell_val)+'</td>';
        h+='<td class="ar '+cls+'" style="font-weight:700">'+fmtRp(fn)+'</td>';
        h+='<td class="ar '+streakCls+'">'+r.buy_days+'/'+r.trade_days+'</td>';
        h+='<td class="ar '+streakCls+'">'+badge+'</td></tr>';
      });
      h+='</tbody></table></div>';
      el.innerHTML=h;
    }catch(e){el.innerHTML=h+'<div class="ne">Error: '+e.message+'</div>';}

  }else if(beiMode==='anomaly'){
    if(opts.type)beiAnomalyType=opts.type;
    h+='<div class="bei-sort-bar">';
    [{k:'block',l:'🧱 Block'},{k:'volume_spike',l:'📈 Vol Spike'},{k:'freq_spike',l:'⚡ Freq Spike'}].forEach(function(t){
      h+='<button class="bei-sort-btn'+(beiAnomalyType===t.k?' on':'')+'" onclick="loadBei(\'anomaly\',{type:\''+t.k+'\'})">'+t.l+'</button>';
    });
    h+='</div>';
    el.innerHTML=h+skelRows(8);
    try{
      var r=await fetch('/api/idx/anomaly?type='+beiAnomalyType+'&limit=40');
      var d=await r.json();
      if(!d.data||!d.data.length){el.innerHTML=h+'<div class="ne">Need 2+ days for detection</div>';return;}
      var filtered=beiApplyFilters(d.data);
      h+='<div class="bei-date">📅 '+esc(d.trade_date)+(d.avg_days?' (vs '+d.avg_days+'d avg)':'')+'</div>';
      h+=beiTable(filtered,beiAnomalyType);
      el.innerHTML=h;
    }catch(e){el.innerHTML=h+'<div class="ne">Error: '+e.message+'</div>';}
  }
}

// ═══ Digest — compact summary cards ═══
function beiDigestCards(dg){
  var m=dg.market;
  var fnCls=(m.fnet||0)>0?'up':(m.fnet||0)<0?'dn':'';
  var trend=(m.fbuy_stocks||0)>(m.fsell_stocks||0);
  var trendTxt=trend?'<span class="up">BUY</span>':'<span class="dn">SELL</span>';
  if(m.fbuy_stocks===m.fsell_stocks)trendTxt='<span>NETRAL</span>';

  var h='<div class="bei-digest-v2">';
  // Row 1: summary cards
  h+='<div class="bd-cards">';
  h+='<div class="bd-card"><div class="bd-card-label">Asing</div><div class="bd-card-val">'+trendTxt+'</div></div>';
  h+='<div class="bd-card"><div class="bd-card-label">Net</div><div class="bd-card-val '+fnCls+'">'+fmtRp(m.fnet)+'</div></div>';
  h+='<div class="bd-card"><div class="bd-card-label">Buy</div><div class="bd-card-val up">'+fmtRp(m.fbuy)+'</div></div>';
  h+='<div class="bd-card"><div class="bd-card-label">Sell</div><div class="bd-card-val dn">'+fmtRp(m.fsell)+'</div></div>';
  h+='<div class="bd-card"><div class="bd-card-label">Adv/Dec</div><div class="bd-card-val"><span class="up">'+(m.advancers||0)+'</span>/<span class="dn">'+(m.decliners||0)+'</span></div></div>';
  h+='<div class="bd-card"><div class="bd-card-label">F.Stocks</div><div class="bd-card-val"><span class="up">'+(m.fbuy_stocks||0)+'</span>/<span class="dn">'+(m.fsell_stocks||0)+'</span></div></div>';
  if(dg.prev_date){
    var dc=dg.fnet_delta||0;var dcCls=dc>0?'up':dc<0?'dn':'';
    h+='<div class="bd-card"><div class="bd-card-label">vs Prev</div><div class="bd-card-val '+dcCls+'">'+(dc>0?'+':'')+fmtRp(dc)+'</div></div>';
  }
  h+='</div>';

  // Row 2: insights — horizontal compact
  var insights=[];
  function codeTag(code,val,cls){return'<span class="code" onclick="showFlowDetail(\''+esc(code)+'\')">'+esc(code)+'</span><span class="bd-tag '+cls+'">'+val+'</span>';}
  if(dg.top_buy&&dg.top_buy.length)insights.push('<span class="bd-insight">🟢 '+dg.top_buy.map(function(t){return codeTag(t.code,fmtRp(t.fnet_val),'buy');}).join(' ')+'</span>');
  if(dg.top_sell&&dg.top_sell.length)insights.push('<span class="bd-insight">🔴 '+dg.top_sell.map(function(t){return codeTag(t.code,fmtRp(t.fnet_val),'sell');}).join(' ')+'</span>');
  if(dg.spikes&&dg.spikes.length)insights.push('<span class="bd-insight">⚡ '+dg.spikes.map(function(t){return codeTag(t.code,t.ratio+'x','spike');}).join(' ')+'</span>');
  if(dg.streaks&&dg.streaks.length){
    var buys=dg.streaks.filter(function(s){return s.buy_days===s.days;});
    var sells=dg.streaks.filter(function(s){return s.buy_days===0;});
    if(buys.length)insights.push('<span class="bd-insight">🔥 '+buys.map(function(t){return'<span class="code" onclick="showFlowDetail(\''+esc(t.code)+'\')">'+esc(t.code)+'</span>';}).join(' ')+'</span>');
    if(sells.length)insights.push('<span class="bd-insight">❄️ '+sells.map(function(t){return'<span class="code" onclick="showFlowDetail(\''+esc(t.code)+'\')">'+esc(t.code)+'</span>';}).join(' ')+'</span>');
  }
  if(insights.length)h+='<div class="bd-insights">'+insights.join('')+'</div>';
  h+='</div>';
  return h;
}

// ═══ Search autocomplete ═══
function beiAcType(){
  var q=($('bei-q')||{}).value||'';var ac=$('bei-ac');if(!ac)return;
  if(q.length<1){ac.classList.remove('v');return;}
  var qu=q.toUpperCase();
  var matches=beiAllData.filter(function(r){return(r.code||'').indexOf(qu)===0;}).slice(0,8);
  if(!matches.length){ac.classList.remove('v');return;}
  ac.innerHTML=matches.map(function(r){
    var fnv=r.foreign_net_val||((r.foreign_net||0)*(r.close||0));var fnCls=fnv>0?'up':fnv<0?'dn':'';
    return'<div class="bei-ac-item" onclick="beiGoTicker(\''+esc(r.code)+'\')"><span class="ac-code">'+esc(r.code)+'</span><span class="ac-name">'+esc(r.name||'')+'</span><span class="ac-price '+fnCls+'">'+fmtRp(fnv)+'</span></div>';
  }).join('');
  ac.classList.add('v');
}
function beiAcKey(e){
  if(e.key==='Enter'){var q=($('bei-q')||{}).value||'';if(q.trim())beiGoTicker(q.trim().toUpperCase());else{beiSearch='';loadBei();};}
  if(e.key==='Escape'){var ac=$('bei-ac');if(ac)ac.classList.remove('v');}
}
function beiGoTicker(code){var ac=$('bei-ac');if(ac)ac.classList.remove('v');beiSearch='';showFlowDetail(code);}
document.addEventListener('click',function(e){if(!e.target.closest('.bei-filter-bar')){var ac=$('bei-ac');if(ac)ac.classList.remove('v');}});

// ═══ Data table ═══
function beiTable(data,type){
  var q=beiSearch.toUpperCase().trim();
  if(q)data=data.filter(function(r){return(r.code||'').indexOf(q)>=0||(r.name||'').toUpperCase().indexOf(q)>=0;});
  var h='<div style="overflow-y:auto;max-height:calc(100vh - 360px)"><table class="bei-tbl"><thead><tr>';
  h+='<th class="al">Code</th><th class="al">Name</th><th class="ar">Close</th><th class="ar">Chg%</th>';
  if(type==='block')h+='<th class="ar">Vol</th><th class="ar">Freq</th><th class="ar hi">Avg Lot</th>';
  else if(type==='volume_spike')h+='<th class="ar">Vol</th><th class="ar">Avg</th><th class="ar hi">Ratio</th>';
  else if(type==='freq_spike')h+='<th class="ar">Freq</th><th class="ar">Avg</th><th class="ar hi">Ratio</th>';
  else h+='<th class="ar">Vol</th><th class="ar">Value</th><th class="ar">Freq</th>';
  h+='<th class="ar">F.Buy</th><th class="ar">F.Sell</th><th class="ar">F.Net</th>';
  h+='</tr></thead><tbody>';
  data.forEach(function(r){
    var cp=r.change_pct||0;var cls=cp>0?'up':cp<0?'dn':'';
    var fnv=r.foreign_net_val||((r.foreign_net||0)*(r.close||0));var fnCls=fnv>0?'up':fnv<0?'dn':'';
    var fbv=r.foreign_buy_val||(r.foreign_buy*(r.close||0));
    var fsv=r.foreign_sell_val||(r.foreign_sell*(r.close||0));
    h+='<tr><td class="code al" onclick="showFlowDetail(\''+esc(r.code)+'\')">'+esc(r.code)+'</td>';
    h+='<td class="name al" title="'+esc(r.name||'')+'">'+esc(r.name||'')+'</td>';
    h+='<td class="ar">'+(r.close||0).toLocaleString()+'</td>';
    h+='<td class="ar '+cls+'">'+(cp>0?'+':'')+cp.toFixed(2)+'%</td>';
    if(type==='block'){
      h+='<td class="ar">'+fmtNum(Math.round((r.volume||0)/100))+'</td>';
      h+='<td class="ar">'+fmtNum(r.frequency)+'</td>';
      h+='<td class="ar hi">'+fmtNum(Math.round((r.avg_lot||0)/100))+'</td>';
    }else if(type==='volume_spike'){
      h+='<td class="ar">'+fmtNum(Math.round((r.volume||0)/100))+'</td>';
      h+='<td class="ar">'+fmtNum(Math.round((r.avg_vol||0)/100))+'</td>';
      h+='<td class="ar hi">'+(r.vol_ratio||0)+'x</td>';
    }else if(type==='freq_spike'){
      h+='<td class="ar">'+fmtNum(r.frequency)+'</td>';
      h+='<td class="ar">'+fmtNum(Math.round(r.avg_freq||0))+'</td>';
      h+='<td class="ar hi">'+(r.freq_ratio||0)+'x</td>';
    }else{
      h+='<td class="ar">'+fmtNum(Math.round((r.volume||0)/100))+'</td>';
      h+='<td class="ar">'+fmtRp(r.value)+'</td>';
      h+='<td class="ar">'+fmtNum(r.frequency)+'</td>';
    }
    h+='<td class="ar">'+fmtRp(fbv)+'</td>';
    h+='<td class="ar">'+fmtRp(fsv)+'</td>';
    h+='<td class="ar '+fnCls+'" style="font-weight:600">'+fmtRp(fnv)+'</td></tr>';
  });
  h+='</tbody></table></div>';
  return h;
}

// ═══ Flow detail — single stock deep dive ═══
async function showFlowDetail(code){
  try{
    var el=$('bei-content');
    el.innerHTML='<div style="padding:12px">'+skelRows(6)+'</div>';
    var [rf,rq]=await Promise.all([
      fetch('/api/idx/flow?code='+encodeURIComponent(code)),
      fetch('/api/idx/quote?code='+encodeURIComponent(code))
    ]);
    var flow=await rf.json();var qt=await rq.json();
    var data=flow.data||[];var last=data.length?data[data.length-1]:(qt.close?qt:{});

    var h='<div style="padding:12px">';
    h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">';
    h+='<button class="ins-back" style="display:inline-flex" onclick="loadBei()">← Back</button>';
    h+='<span style="font-weight:800;font-size:18px;font-family:var(--fm);color:var(--bl)">'+esc(code)+'</span>';
    if(qt.name)h+='<span style="color:var(--t2);font-size:12px">'+esc(qt.name)+'</span>';
    h+='<span style="flex:1"></span>';
    h+='<button class="bei-tab" onclick="showAdjustedOHLC(\''+esc(code)+'\')">📐 Adjusted</button>';
    h+='<button class="bei-tab" onclick="addWatchlistFrom(\''+esc(code)+'\')">+ Watchlist</button>';
    h+='<button class="bei-tab" onclick="stab(\'ins\',document.querySelectorAll(\'.tabs .tab\')[3]);setTimeout(function(){insGoStock(\''+esc(code)+'\')},200)">🔍 Insider</button>';
    h+='</div>';

    if(last&&last.close){
      var pClose=last.prev_close||qt.prev_close||0;
      var cp=pClose?((last.close-pClose)/pClose*100):0;var chg=last.close-pClose;var pCls=chg>0?'up':chg<0?'dn':'';
      var mktCap=(last.close||0)*(last.listed_shares||qt.listed_shares||0);
      var ff=(last.tradeable_shares||qt.tradeable_shares||0)/(last.listed_shares||qt.listed_shares||1)*100;
      h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:6px;margin-bottom:8px">';
      h+='<div class="ov-card"><div class="ov-card-n '+pCls+'">'+(last.close||0).toLocaleString()+'</div><div class="ov-card-l">Close</div></div>';
      h+='<div class="ov-card"><div class="ov-card-n '+pCls+'">'+(cp>0?'+':'')+cp.toFixed(2)+'%</div><div class="ov-card-l">Change</div></div>';
      h+='<div class="ov-card"><div class="ov-card-n">'+fmtRp(last.value||0)+'</div><div class="ov-card-l">Value</div></div>';
      h+='<div class="ov-card"><div class="ov-card-n">'+fmtNum(Math.round((last.volume||0)/100))+'</div><div class="ov-card-l">Vol(lot)</div></div>';
      h+='<div class="ov-card"><div class="ov-card-n">'+fmtNum(last.frequency||0)+'</div><div class="ov-card-l">Freq</div></div>';
      if(mktCap)h+='<div class="ov-card"><div class="ov-card-n">'+fmtRp(mktCap)+'</div><div class="ov-card-l">Mkt Cap</div></div>';
      h+='</div>';
      if(last.high||last.bid){
        h+='<div style="display:flex;gap:12px;font-size:11px;color:var(--t2);margin-bottom:8px;flex-wrap:wrap">';
        if(last.high)h+='<span>H <b style="color:var(--gn)">'+last.high.toLocaleString()+'</b></span>';
        if(last.low)h+='<span>L <b style="color:var(--rd)">'+last.low.toLocaleString()+'</b></span>';
        if(last.bid)h+='<span>Bid '+last.bid.toLocaleString()+'</span>';
        if(last.offer)h+='<span>Offer '+last.offer.toLocaleString()+'</span>';
        if(ff)h+='<span>FF '+ff.toFixed(1)+'%</span>';
        h+='</div>';
      }
    }
    if(!data.length){h+='<div class="ne">No history</div></div>';el.innerHTML=h;return;}

    var totalNetVal=data.reduce(function(s,r){return s+(r.foreign_net_val||0);},0);
    var buyDays=data.filter(function(r){return r.foreign_net>0;}).length;
    var sellDays=data.filter(function(r){return r.foreign_net<0;}).length;
    var netCls=totalNetVal>0?'up':totalNetVal<0?'dn':'';

    h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:6px;margin-bottom:8px">';
    h+='<div class="ov-card"><div class="ov-card-n '+netCls+'">'+fmtRp(totalNetVal)+'</div><div class="ov-card-l">Net ('+data.length+'D)</div></div>';
    h+='<div class="ov-card"><div class="ov-card-n up">'+buyDays+'</div><div class="ov-card-l">Buy Days</div></div>';
    h+='<div class="ov-card"><div class="ov-card-n dn">'+sellDays+'</div><div class="ov-card-l">Sell Days</div></div>';
    h+='</div>';

    var maxAbsVal=Math.max.apply(null,data.map(function(r){return Math.abs(r.foreign_net_val||0);}));
    h+='<div style="overflow-y:auto;max-height:calc(100vh - 400px)">';
    h+='<table class="bei-tbl"><thead><tr><th class="al">Date</th><th class="ar">Close</th><th class="ar">Chg%</th><th class="ar">Vol</th><th class="ar">Value</th><th style="text-align:center;min-width:100px">Flow</th><th class="ar">F.Net</th><th class="ar">Accum</th></tr></thead><tbody>';
    for(var i=data.length-1;i>=0;i--){
      var r=data[i];var fnv=r.foreign_net_val||0;var cls=fnv>0?'up':fnv<0?'dn':'';
      var accVal=r.foreign_acc_val||0;var accCls=accVal>0?'up':accVal<0?'dn':'';
      var pct=maxAbsVal?Math.min(90,Math.abs(fnv)/maxAbsVal*90):0;
      var prevC=i>0?data[i-1].close:r.close;var cp2=prevC?((r.close-prevC)/prevC*100):0;var cpCls=cp2>0?'up':cp2<0?'dn':'';
      h+='<tr><td class="al" style="font-size:10px">'+esc(r.trade_date)+'</td>';
      h+='<td class="ar">'+(r.close||0).toLocaleString()+'</td>';
      h+='<td class="ar '+cpCls+'">'+(i>0?(cp2>0?'+':'')+cp2.toFixed(1)+'%':'-')+'</td>';
      h+='<td class="ar">'+fmtNum(Math.round((r.volume||0)/100))+'</td>';
      h+='<td class="ar">'+fmtRp(r.value||0)+'</td>';
      h+='<td style="min-width:100px;padding:4px 2px"><div style="display:flex;height:12px"><div style="flex:1;display:flex;justify-content:flex-end">';
      if(fnv<0)h+='<div style="width:'+pct+'%;background:var(--rd);border-radius:2px;opacity:.7"></div>';
      h+='</div><div style="width:1px;background:var(--b2)"></div><div style="flex:1;display:flex">';
      if(fnv>0)h+='<div style="width:'+pct+'%;background:var(--gn);border-radius:2px;opacity:.7"></div>';
      h+='</div></div></td>';
      h+='<td class="ar '+cls+'" style="font-weight:600">'+fmtRp(fnv)+'</td>';
      h+='<td class="ar '+accCls+'">'+fmtRp(accVal)+'</td></tr>';
    }
    h+='</tbody></table></div></div>';
    el.innerHTML=h;
  }catch(e){showT('Error',e.message);}
}

async function addWatchlistFrom(code){
  try{await fetch('/api/watchlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:code+'.JK'})});showT('Watchlist','Added '+code+'.JK');}catch(e){showT('Error',e.message);}
}
function fmtNum(n){if(!n)return'0';var a=Math.abs(n);var s=n<0?'-':'';if(a>=1e12)return s+(a/1e12).toFixed(1)+'T';if(a>=1e9)return s+(a/1e9).toFixed(1)+'B';if(a>=1e6)return s+(a/1e6).toFixed(1)+'M';if(a>=1e3)return s+(a/1e3).toFixed(1)+'K';return n.toLocaleString();}
function fmtRp(n){if(!n)return'0';var a=Math.abs(n);var s=n<0?'-':'';if(a>=1e12)return s+(a/1e12).toFixed(1)+' T';if(a>=1e9)return s+(a/1e9).toFixed(1)+' B';if(a>=1e6)return s+(a/1e6).toFixed(1)+' M';if(a>=1e3)return s+(a/1e3).toFixed(0)+' K';return n.toLocaleString();}

// ═══ CA Banner + Panel + Adjusted OHLC (preserved from previous) ═══
async function beiCaBanner(){
  try{var r=await fetch('/api/idx/ca/stats');var d=await r.json();
    if(!d.pending||d.pending===0)return'';
    return'<div class="bei-ca-banner"><span>⚡ <b>'+d.pending+' corporate action</b> perlu review</span><span style="flex:1"></span><button class="bei-tab on" style="font-size:11px;padding:3px 10px" onclick="loadBei(\'ca\')">Review →</button></div>';
  }catch{return'';}
}

async function loadBeiCaPanel(el,headerH){
  try{
    var [rAll,rStats]=await Promise.all([fetch('/api/idx/ca').then(r=>r.json()),fetch('/api/idx/ca/stats').then(r=>r.json())]);
    var rows=rAll.data||[];var stats=rStats;var h=headerH;
    h+='<div style="display:flex;gap:8px;margin:8px 12px;flex-wrap:wrap">';
    h+='<div class="ov-card"><div class="ov-card-n" style="color:var(--am)">'+(stats.pending||0)+'</div><div class="ov-card-l">Pending</div></div>';
    h+='<div class="ov-card"><div class="ov-card-n up">'+(stats.confirmed||0)+'</div><div class="ov-card-l">Confirmed</div></div>';
    h+='<div class="ov-card"><div class="ov-card-n">'+(stats.total||0)+'</div><div class="ov-card-l">Total</div></div></div>';
    h+='<div style="display:flex;gap:6px;padding:0 12px 8px;flex-wrap:wrap">';
    if(stats.pending>0)h+='<button class="bei-tab" onclick="caConfirmAll()" style="font-size:11px;background:rgba(102,187,106,.12);border-color:var(--gn)">✓ Confirm All</button><button class="bei-tab" onclick="caDismissAll()" style="font-size:11px;background:rgba(239,83,80,.08);border-color:var(--rd)">✕ Dismiss All</button>';
    h+='<button class="bei-tab" onclick="caRedetect()" style="font-size:11px">🔄 Re-detect</button></div>';
    if(!rows.length){h+='<div class="ne" style="padding:24px">No corporate actions detected</div>';el.innerHTML=h;return;}
    h+='<div style="overflow-y:auto;max-height:calc(100vh - 320px);padding:0 12px">';
    h+='<table class="bei-tbl"><thead><tr><th class="al">Code</th><th class="al">Date</th><th class="al">Type</th><th class="ar">Ratio</th><th class="ar">Old</th><th class="ar">New</th><th class="al">Status</th><th>Aksi</th></tr></thead><tbody>';
    rows.forEach(function(r){
      var sCls=r.status==='pending'?'color:var(--am)':r.status==='confirmed'?'color:var(--gn)':'color:var(--t3)';
      var sIcon=r.status==='pending'?'⏳':r.status==='confirmed'?'✅':'❌';
      var typeLbl={split:'SPLIT',reverse:'REVERSE',rights_or_bonus:'RIGHTS/BONUS',unknown:'?',manual:'MANUAL'}[r.action_type]||r.action_type.toUpperCase();
      h+='<tr><td class="code al" onclick="showFlowDetail(\''+esc(r.code)+'\')">'+esc(r.code)+'</td>';
      h+='<td class="al" style="font-size:10px">'+esc(r.ex_date)+'</td>';
      h+='<td class="al"><span style="font-size:9px;padding:2px 5px;border-radius:3px;background:var(--blB);color:var(--bl)">'+typeLbl+'</span></td>';
      h+='<td class="ar" style="font-weight:700">'+r.ratio.toFixed(2)+'x</td>';
      h+='<td class="ar" style="font-size:10px">'+fmtNum(r.old_shares)+'</td>';
      h+='<td class="ar" style="font-size:10px">'+fmtNum(r.new_shares)+'</td>';
      h+='<td class="al" style="'+sCls+'">'+sIcon+' '+r.status+'</td>';
      h+='<td style="white-space:nowrap">';
      if(r.status==='pending')h+='<button style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid var(--gn);background:var(--gnB);color:var(--gn);cursor:pointer;margin-right:3px" onclick="caConfirm('+r.id+')">✓</button><button style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid var(--rd);background:var(--rdB);color:var(--rd);cursor:pointer" onclick="caDismiss('+r.id+')">✕</button>';
      else h+='<button style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid var(--b2);color:var(--t3);cursor:pointer" onclick="caDelete('+r.id+')">🗑</button>';
      h+='</td></tr>';
    });
    h+='</tbody></table></div>';
    el.innerHTML=h;
  }catch(e){el.innerHTML=headerH+'<div class="ne">Error: '+e.message+'</div>';}
}

function caTypeLabel(t){return{split:'SPLIT',reverse:'REVERSE',rights_or_bonus:'RIGHTS/BONUS',unknown:'?',manual:'MANUAL'}[t]||t.toUpperCase();}
async function caConfirm(id){try{await fetch('/api/idx/ca/'+id+'/confirm',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'});showT('✅','Confirmed');loadBei('ca');}catch(e){showT('Error',e.message);}}
async function caDismiss(id){try{await fetch('/api/idx/ca/'+id+'/dismiss',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'});showT('✅','Dismissed');loadBei('ca');}catch(e){showT('Error',e.message);}}
async function caDelete(id){if(!confirm('Delete?'))return;try{await fetch('/api/idx/ca/'+id,{method:'DELETE'});loadBei('ca');}catch(e){showT('Error',e.message);}}
async function caConfirmAll(){if(!confirm('Confirm all pending?'))return;try{var r=await fetch('/api/idx/ca/confirm-all',{method:'POST'});var d=await r.json();showT('✅','Confirmed '+d.confirmed);loadBei('ca');}catch(e){showT('Error',e.message);}}
async function caDismissAll(){if(!confirm('Dismiss all pending?'))return;try{var r=await fetch('/api/idx/ca/dismiss-all',{method:'POST'});var d=await r.json();showT('✅','Dismissed '+d.dismissed);loadBei('ca');}catch(e){showT('Error',e.message);}}
async function caRedetect(){try{var r=await fetch('/api/idx/ca/detect',{method:'POST'});var d=await r.json();showT('🔄','Detected '+d.total);loadBei('ca');}catch(e){showT('Error',e.message);}}

async function showAdjustedOHLC(code){
  var el=$('bei-content');el.innerHTML='<div style="padding:12px">'+skelRows(6)+'</div>';
  try{
    var r=await fetch('/api/idx/adjusted/'+encodeURIComponent(code));var d=await r.json();
    var data=d.data||[];var actions=d.actions||[];
    var h='<div style="padding:12px">';
    h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">';
    h+='<button class="ins-back" style="display:inline-flex" onclick="showFlowDetail(\''+esc(code)+'\')">← Back</button>';
    h+='<span style="font-weight:800;font-size:18px;font-family:var(--fm);color:var(--bl)">'+esc(code)+'</span>';
    h+='<span style="color:var(--t2);font-size:12px">📐 Adjusted OHLC</span></div>';
    if(actions.length){
      h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">';
      actions.forEach(function(a){h+='<span style="font-size:10px;padding:3px 8px;border-radius:4px;background:var(--blB);color:var(--bl)">'+caTypeLabel(a.action_type)+' '+esc(a.ex_date)+' ('+a.ratio.toFixed(2)+'x)</span>';});
      h+='</div>';
    }else h+='<div style="font-size:12px;color:var(--t3);margin-bottom:10px">No confirmed CA for this ticker</div>';
    if(!data.length){h+='<div class="ne">No data</div></div>';el.innerHTML=h;return;}
    var tail=data.slice(-60).reverse();
    h+='<div style="overflow-y:auto;max-height:calc(100vh - 280px)"><table class="bei-tbl"><thead><tr><th class="al">Date</th><th class="ar">Close</th><th class="ar" style="color:var(--bl)">Adj Close</th><th class="ar">Adj Open</th><th class="ar">Adj High</th><th class="ar">Adj Low</th><th class="ar">Adj Vol</th><th class="ar">Factor</th></tr></thead><tbody>';
    tail.forEach(function(r){
      var adj=r.cum_factor!==1;var fCls=adj?'color:var(--bl);font-weight:600':'';
      h+='<tr><td class="al" style="font-size:10px">'+esc(r.trade_date)+'</td>';
      h+='<td class="ar">'+(r.close||0).toLocaleString()+'</td>';
      h+='<td class="ar" style="'+fCls+'">'+(r.adj_close||0).toLocaleString()+'</td>';
      h+='<td class="ar" style="font-size:10px">'+(r.adj_open||0).toLocaleString()+'</td>';
      h+='<td class="ar" style="font-size:10px">'+(r.adj_high||0).toLocaleString()+'</td>';
      h+='<td class="ar" style="font-size:10px">'+(r.adj_low||0).toLocaleString()+'</td>';
      h+='<td class="ar">'+fmtNum(Math.round((r.adj_volume||0)/100))+'</td>';
      h+='<td class="ar" style="font-size:10px;'+(adj?'color:var(--am)':'')+'">'+r.cum_factor+'</td></tr>';
    });
    h+='</tbody></table></div></div>';
    el.innerHTML=h;
  }catch(e){el.innerHTML='<div class="ne">Error: '+e.message+'</div>';}
}