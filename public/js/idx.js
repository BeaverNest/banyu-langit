// IDX Daily Analytics
let beiMode='top',beiSort='value',beiDir='desc',beiFlowDays=5,beiFlowDir='desc',beiAnomalyType='block';
let beiStats=null;

async function loadBeiStats(){
  try{var r=await fetch('/api/idx/stats');beiStats=await r.json();}catch{beiStats=null;}
}

function beiStatusBar(){
  if(!beiStats||!beiStats.latest)return'<div class="bei-status bei-status-empty">No IDX data. Upload Ringkasan Saham via ⚙️ Settings.</div>';
  var h='<div class="bei-status">';
  var latest=beiStats.latest;
  var now=new Date();var last=new Date(latest+'T17:00:00+07:00');
  var gap=0,d=new Date(last);
  while(d<now){d.setDate(d.getDate()+1);var dow=d.getDay();if(dow!==0&&dow!==6)gap++;}
  var color=gap<=0?'var(--gn)':gap<=1?'var(--am)':'var(--rd)';
  var icon=gap<=0?'🟢':gap<=1?'🟡':'🔴';
  h+=icon+' <b>'+latest+'</b>';
  if(gap>1)h+=' <span style="color:var(--rd)">('+gap+' hari tertinggal)</span>';
  else if(gap===1)h+=' <span style="color:var(--am)">(kemarin)</span>';
  h+=' · '+beiStats.dates+' hari · '+beiStats.tickers+' saham';
  if(beiStats.all_dates&&beiStats.all_dates.length>=2){
    var ds=new Set(beiStats.all_dates);
    var first=new Date(beiStats.all_dates[0]+'T00:00:00');
    var lastD=new Date(beiStats.all_dates[beiStats.all_dates.length-1]+'T00:00:00');
    var missing=[],c=new Date(first);
    c.setDate(c.getDate()+1);
    while(c<=lastD){
      var dow=c.getDay();
      var iso=c.toISOString().split('T')[0];
      if(dow!==0&&dow!==6&&!ds.has(iso))missing.push(iso);
      c.setDate(c.getDate()+1);
    }
    if(missing.length>0&&missing.length<=10)h+=' · <span style="color:var(--rd)" title="'+missing.join(', ')+'">⚠️ '+missing.length+' gap</span>';
    else if(missing.length>10)h+=' · <span style="color:var(--rd)">⚠️ '+missing.length+' gap (mungkin libur nasional)</span>';
  }
  h+='</div>';
  return h;
}

let beiSearch='',beiAllData=[];
async function loadBei(mode,opts){
  if(mode)beiMode=mode;
  opts=opts||{};
  var el=$('bei-content');if(!el)return;
  if(!beiStats)await loadBeiStats();

  var h=beiStatusBar();

  // ═══ CA pending banner ═══
  h+=await beiCaBanner();

  // Search bar with autocomplete
  h+='<div class="bei-bar"><input id="bei-q" placeholder="Search ticker... (BBCA, ASII)" value="'+esc(beiSearch)+'" oninput="beiAcType()" onkeydown="beiAcKey(event)" autocomplete="off"><div class="bei-ac" id="bei-ac"></div></div>';

  // Mode tabs
  [{k:'top',l:'📊 Rankings'},{k:'foreign',l:'🌍 Foreign Flow'},{k:'anomaly',l:'🔍 Anomaly'},{k:'ca',l:'⚡ Corp Action'}].forEach(function(t){
    if(!h.includes('bei-tabs'))h+='<div class="bei-tabs">';
    h+='<button class="bei-tab'+(t.k===beiMode?' on':'')+'" onclick="beiSearch=\'\';loadBei(\''+t.k+'\')">'+t.l+'</button>';
  });
  h+='</div>';

  if(beiMode==='ca'){
    el.innerHTML=h+''+skelRows(4)+'';
    await loadBeiCaPanel(el,h);
    return;
  }

  if(beiMode==='top'){
    if(opts.sort)beiSort=opts.sort;if(opts.dir)beiDir=opts.dir;
    h+='<div class="bei-tabs" style="border-bottom:none;padding-top:0">';
    [{k:'value',d:'desc',l:'💰 Value'},{k:'volume',d:'desc',l:'📦 Volume'},{k:'frequency',d:'desc',l:'⚡ Freq'},{k:'foreign_net',d:'desc',l:'🟢 F.Buy'},{k:'foreign_net',d:'asc',l:'🔴 F.Sell'},{k:'change_pct',d:'desc',l:'🔥 Gainers'},{k:'change_pct',d:'asc',l:'📉 Losers'}].forEach(function(s){
      h+='<button class="bei-tab'+(beiSort===s.k&&beiDir===s.d?' on':'')+'" onclick="loadBei(\'top\',{sort:\''+s.k+'\',dir:\''+s.d+'\'})">'+s.l+'</button>';
    });
    h+='</div>';
    el.innerHTML=h+''+skelRows(8)+'';
    try{
      var r=await fetch('/api/idx/top?sort='+beiSort+'&dir='+beiDir+'&limit=50');
      var d=await r.json();
      if(!d.data||!d.data.length){el.innerHTML=h+'<div class="ne" style="padding:24px">No data. Upload via ⚙️ Settings.</div>';return;}
      beiAllData=d.data;
      // Digest
      var r2=await fetch('/api/idx/digest');var dg=await r2.json();
      if(dg&&!dg.error&&dg.market){
        var m=dg.market;
        var fnCls=(m.fnet||0)>0?'up':(m.fnet||0)<0?'dn':'';
        var trend=(m.fbuy_stocks||0)>(m.fsell_stocks||0);
        var trendTxt=trend?'Asing <b class="up">BUY</b>':'Asing <b class="dn">SELL</b>';
        if(m.fbuy_stocks===m.fsell_stocks)trendTxt='Asing <b>NETRAL</b>';
        var deltaH='';
        if(dg.prev_date){
          var dc=dg.fnet_delta||0;var dcCls=dc>0?'up':dc<0?'dn':'';
          deltaH='<span class="'+dcCls+'" style="font-size:10px">'+(dc>0?'▲ +':'▼ ')+fmtRp(dc)+' vs kemarin</span>';
        }
        h+='<div class="bei-head"><div class="h-row">';
        h+='<span class="h-date">'+esc(dg.trade_date)+'</span>';
        h+='<span class="h-trend">'+trendTxt+'</span>';
        h+='<div class="h-sep"></div>';
        h+='<div class="h-stat"><span class="h-lbl">Net</span> <span class="h-val '+fnCls+'">'+fmtRp(m.fnet)+'</span></div>';
        h+='<div class="h-stat"><span class="h-lbl">Buy</span> <span class="h-val up">'+fmtRp(m.fbuy)+'</span></div>';
        h+='<div class="h-stat"><span class="h-lbl">Sell</span> <span class="h-val dn">'+fmtRp(m.fsell)+'</span></div>';
        h+='<div class="h-sep"></div>';
        h+='<span style="font-size:10px;color:var(--t3)"><span class="up">'+(m.advancers||0)+'↑</span> <span class="dn">'+(m.decliners||0)+'↓</span> · Buy '+(m.fbuy_stocks||0)+' · Sell '+(m.fsell_stocks||0)+'</span>';
        if(deltaH)h+='<div class="h-sep"></div>'+deltaH;
        h+='</div></div>';
        var hasInsight=false;
        h+='<div class="bei-digest">';
        function codeTag(code,val,cls){return'<span class="code" onclick="showFlowDetail(\''+esc(code)+'\')">'+esc(code)+'</span> <span class="tag '+(cls||'')+'">'+val+'</span>';}
        if(dg.top_buy&&dg.top_buy.length){hasInsight=true;h+='<div class="d-row"><span class="d-icon">🟢</span><span class="d-label">Top Buy</span>'+dg.top_buy.map(function(t){return codeTag(t.code,fmtRp(t.fnet_val),'buy');}).join(' ')+'</div>';}
        if(dg.top_sell&&dg.top_sell.length){hasInsight=true;h+='<div class="d-row"><span class="d-icon">🔴</span><span class="d-label">Top Sell</span>'+dg.top_sell.map(function(t){return codeTag(t.code,fmtRp(t.fnet_val),'sell');}).join(' ')+'</div>';}
        if(dg.spikes&&dg.spikes.length){hasInsight=true;h+='<div class="d-row"><span class="d-icon">⚡</span><span class="d-label">Vol Spike</span>'+dg.spikes.map(function(t){return codeTag(t.code,t.ratio+'x','spike');}).join(' ')+'</div>';}
        if(dg.streaks&&dg.streaks.length){
          var buys=dg.streaks.filter(function(s){return s.buy_days===s.days;});
          var sells=dg.streaks.filter(function(s){return s.buy_days===0;});
          if(buys.length){hasInsight=true;h+='<div class="d-row"><span class="d-icon">🔥</span><span class="d-label">Streak Buy</span>'+buys.map(function(t){return'<span class="code" onclick="showFlowDetail(\''+esc(t.code)+'\')">'+esc(t.code)+'</span>';}).join(' ')+'</div>';}
          if(sells.length){hasInsight=true;h+='<div class="d-row"><span class="d-icon">❄️</span><span class="d-label">Streak Sell</span>'+sells.map(function(t){return'<span class="code" onclick="showFlowDetail(\''+esc(t.code)+'\')">'+esc(t.code)+'</span>';}).join(' ')+'</div>';}
        }
        h+='</div>';
        if(!hasInsight)h=h.replace('<div class="bei-digest"></div>','');
      }
      h+=beiTable(d.data,'top');
      el.innerHTML=h;
    }catch(e){el.innerHTML=h+'<div class="ne">Error: '+e.message+'</div>';}

  }else if(beiMode==='foreign'){
    if(opts.days)beiFlowDays=opts.days;if(opts.dir)beiFlowDir=opts.dir;
    h+='<div class="bei-tabs" style="border-bottom:none;padding-top:0">';
    [3,5,10,20].forEach(function(d){h+='<button class="bei-tab'+(beiFlowDays===d?' on':'')+'" onclick="loadBei(\'foreign\',{days:'+d+'})">'+d+'D</button>';});
    h+='<span style="width:8px"></span>';
    h+='<button class="bei-tab'+(beiFlowDir==='desc'?' on':'')+'" onclick="loadBei(\'foreign\',{dir:\'desc\'})">🟢 Net Buy</button>';
    h+='<button class="bei-tab'+(beiFlowDir==='asc'?' on':'')+'" onclick="loadBei(\'foreign\',{dir:\'asc\'})">🔴 Net Sell</button>';
    h+='</div>';
    el.innerHTML=h+''+skelRows(8)+'';
    try{
      var r=await fetch('/api/idx/foreign?days='+beiFlowDays+'&dir='+beiFlowDir+'&limit=40');
      var d=await r.json();
      if(!d.data||!d.data.length){el.innerHTML=h+'<div class="ne">No multi-day data. Upload more days.</div>';return;}
      h+='<div class="bei-date">📅 '+d.dates.join(', ')+' ('+d.days_actual+' hari)</div>';
      h+='<div style="overflow-y:auto;max-height:calc(100vh - 300px)"><table class="bei-tbl"><thead><tr><th class="al">Code</th><th class="al">Name</th><th class="ar">Close</th><th class="ar">Buy (IDR)</th><th class="ar">Sell (IDR)</th><th class="ar">Net (IDR)</th><th class="ar">Days</th><th class="ar">Streak</th></tr></thead><tbody>';
      d.data.forEach(function(r){
        var fn=r.net_flow_val||0;var cls=fn>0?'up':fn<0?'dn':'';
        var streakCls=r.buy_days===r.trade_days?'up':(r.buy_days===0?'dn':'');
        var badge=r.buy_days===r.trade_days?'🔥ALL BUY':r.buy_days===0?'❄️ALL SELL':'';
        h+='<tr><td class="code al" onclick="showFlowDetail(\''+esc(r.code)+'\')">'+esc(r.code)+'</td>';
        h+='<td class="name al" title="'+esc(r.name)+'">'+esc(r.name)+'</td>';
        h+='<td class="ar">'+r.last_close.toLocaleString()+'</td>';
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
    h+='<div class="bei-tabs" style="border-bottom:none;padding-top:0">';
    [{k:'block',l:'🧱 Block Trade'},{k:'volume_spike',l:'📈 Vol Spike'},{k:'freq_spike',l:'⚡ Freq Spike'}].forEach(function(t){
      h+='<button class="bei-tab'+(beiAnomalyType===t.k?' on':'')+'" onclick="loadBei(\'anomaly\',{type:\''+t.k+'\'})">'+t.l+'</button>';
    });
    h+='</div>';
    el.innerHTML=h+''+skelRows(8)+'';
    try{
      var r=await fetch('/api/idx/anomaly?type='+beiAnomalyType+'&limit=40');
      var d=await r.json();
      if(!d.data||!d.data.length){el.innerHTML=h+'<div class="ne">No data or need 2+ days for spike detection.</div>';return;}
      h+='<div class="bei-date">📅 '+esc(d.trade_date)+(d.avg_days?' (vs avg '+d.avg_days+' hari)':'')+'</div>';
      h+=beiTable(d.data,beiAnomalyType);
      el.innerHTML=h;
    }catch(e){el.innerHTML=h+'<div class="ne">Error: '+e.message+'</div>';}
  }
}

// Search autocomplete
function beiAcType(){
  var q=($('bei-q')||{}).value||'';
  var ac=$('bei-ac');if(!ac)return;
  if(q.length<1){ac.classList.remove('v');return;}
  var qu=q.toUpperCase();
  var matches=beiAllData.filter(function(r){return(r.code||'').indexOf(qu)===0;}).slice(0,8);
  if(!matches.length){ac.classList.remove('v');return;}
  ac.innerHTML=matches.map(function(r){
    var fnv=r.foreign_net_val||((r.foreign_net||0)*(r.close||0));
    var fnCls=fnv>0?'up':fnv<0?'dn':'';
    return'<div class="bei-ac-item" onclick="beiGoTicker(\''+esc(r.code)+'\')"><span class="ac-code">'+esc(r.code)+'</span><span class="ac-name">'+esc(r.name||'')+'</span><span class="ac-price '+fnCls+'">'+fmtRp(fnv)+'</span></div>';
  }).join('');
  ac.classList.add('v');
}
function beiAcKey(e){
  if(e.key==='Enter'){
    var q=($('bei-q')||{}).value||'';
    if(q.trim()){beiGoTicker(q.trim().toUpperCase());}
    else{beiSearch='';loadBei();}
  }
  if(e.key==='Escape'){var ac=$('bei-ac');if(ac)ac.classList.remove('v');}
}
function beiGoTicker(code){
  var ac=$('bei-ac');if(ac)ac.classList.remove('v');
  beiSearch='';
  showFlowDetail(code);
}
document.addEventListener('click',function(e){if(!e.target.closest('.bei-bar')){var ac=$('bei-ac');if(ac)ac.classList.remove('v');}});

function beiFilter(){beiSearch=($('bei-q')||{}).value||'';loadBei();}

function beiTable(data,type){
  var q=beiSearch.toUpperCase().trim();
  if(q)data=data.filter(function(r){return(r.code||'').indexOf(q)>=0||(r.name||'').toUpperCase().indexOf(q)>=0;});
  var h='<div style="overflow-y:auto;max-height:calc(100vh - 360px)"><table class="bei-tbl"><thead><tr>';
  h+='<th class="al">Code</th><th class="al">Name</th><th class="ar">Close</th><th class="ar">Chg%</th>';
  if(type==='block')h+='<th class="ar">Vol(lot)</th><th class="ar">Freq</th><th class="ar hi">Avg Lot</th>';
  else if(type==='volume_spike')h+='<th class="ar">Vol(lot)</th><th class="ar">Avg Vol</th><th class="ar hi">Ratio</th>';
  else if(type==='freq_spike')h+='<th class="ar">Freq</th><th class="ar">Avg Freq</th><th class="ar hi">Ratio</th>';
  else h+='<th class="ar">Vol(lot)</th><th class="ar">Value</th><th class="ar">Freq</th>';
  h+='<th class="ar">F.Buy</th><th class="ar">F.Sell</th><th class="ar">F.Net</th>';
  h+='</tr></thead><tbody>';
  data.forEach(function(r){
    var cp=r.change_pct||0;var cls=cp>0?'up':cp<0?'dn':'';
    var fnv=r.foreign_net_val||((r.foreign_net||0)*(r.close||0));
    var fnCls=fnv>0?'up':fnv<0?'dn':'';
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

// Flow detail popup for a single stock
async function showFlowDetail(code){
  try{
    var el=$('bei-content');
    el.innerHTML='<div style="padding:12px"><div class="ne">'+skelRows(6)+'</div></div>';
    var [rf,rq]=await Promise.all([
      fetch('/api/idx/flow?code='+encodeURIComponent(code)),
      fetch('/api/idx/quote?code='+encodeURIComponent(code))
    ]);
    var flow=await rf.json();
    var qt=await rq.json();
    var data=flow.data||[];
    var last=data.length?data[data.length-1]:(qt.close?qt:{});

    var h='<div style="padding:12px">';
    h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">';
    h+='<button class="ins-back" style="display:inline-flex" onclick="loadBei()">← Back</button>';
    h+='<span style="font-weight:800;font-size:18px;font-family:var(--fm);color:var(--bl)">'+esc(code)+'</span>';
    if(qt.name)h+='<span style="color:var(--t2);font-size:12px">'+esc(qt.name)+'</span>';
    h+='<span style="flex:1"></span>';
    h+='<button class="bei-tab" onclick="showAdjustedOHLC(\''+esc(code)+'\')">📐 Adjusted</button>';
    h+='<button class="bei-tab" onclick="addWatchlistFrom(\''+esc(code)+'\')">+ Watchlist</button>';
    h+='<button class="bei-tab" onclick="stab(\'ins\',document.querySelectorAll(\'.tabs .tab\')[3]);setTimeout(function(){insGoStock(\''+esc(code)+'\')},200)">🔍 Insider</button>';
    h+='<button class="bei-tab" onclick="stab(\'wl\',document.querySelectorAll(\'.tabs .tab\')[1]);setTimeout(function(){swt(\'alt\',document.querySelectorAll(\'.wt-b\')[1]);$(\'as\').value=\''+esc(code)+'.JK\';},200)">🔔 Alert</button>';
    h+='</div>';

    if(last&&last.close){
      var pClose=last.prev_close||qt.prev_close||0;
      var cp=pClose?((last.close-pClose)/pClose*100):0;
      var chg=last.close-pClose;
      var pCls=chg>0?'up':chg<0?'dn':'';
      var mktCap=(last.close||0)*(last.listed_shares||qt.listed_shares||0);
      var ff=(last.tradeable_shares||qt.tradeable_shares||0)/(last.listed_shares||qt.listed_shares||1)*100;
      h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:6px;margin-bottom:8px">';
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
        if(last.bid)h+='<span>Bid '+last.bid.toLocaleString()+' ('+fmtNum(last.bid_vol||0)+')</span>';
        if(last.offer)h+='<span>Offer '+last.offer.toLocaleString()+' ('+fmtNum(last.offer_vol||0)+')</span>';
        if(ff)h+='<span>FF '+ff.toFixed(1)+'%</span>';
        h+='</div>';
      }
    }
    if(!data.length){h+='<div class="ne">No daily history</div></div>';el.innerHTML=h;return;}

    var totalNetVal=data.reduce(function(s,r){return s+(r.foreign_net_val||0);},0);
    var buyDays=data.filter(function(r){return r.foreign_net>0;}).length;
    var sellDays=data.filter(function(r){return r.foreign_net<0;}).length;
    var netCls=totalNetVal>0?'up':totalNetVal<0?'dn':'';
    var avgVol=data.reduce(function(s,r){return s+(r.volume||0);},0)/data.length;
    var avgVal=data.reduce(function(s,r){return s+(r.value||0);},0)/data.length;

    h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px;margin-bottom:8px">';
    h+='<div class="ov-card"><div class="ov-card-n '+netCls+'">'+fmtRp(totalNetVal)+'</div><div class="ov-card-l">Net Asing ('+data.length+'D)</div></div>';
    h+='<div class="ov-card"><div class="ov-card-n up">'+buyDays+'</div><div class="ov-card-l">Buy Days</div></div>';
    h+='<div class="ov-card"><div class="ov-card-n dn">'+sellDays+'</div><div class="ov-card-l">Sell Days</div></div>';
    h+='<div class="ov-card"><div class="ov-card-n">'+fmtRp(avgVal)+'</div><div class="ov-card-l">Avg Val/day</div></div>';
    h+='<div class="ov-card"><div class="ov-card-n">'+fmtNum(Math.round(avgVol/100))+'</div><div class="ov-card-l">Avg Vol(lot)</div></div>';
    h+='</div>';

    var maxAbsVal=Math.max.apply(null,data.map(function(r){return Math.abs(r.foreign_net_val||0);}));
    h+='<div style="font-size:11px;font-weight:600;color:var(--t2);margin-bottom:4px">Daily History</div>';
    h+='<div style="overflow-y:auto;max-height:calc(100vh - 440px)">';
    h+='<table class="bei-tbl"><thead><tr><th class="al">Date</th><th class="ar">Close</th><th class="ar">Chg%</th><th class="ar">Vol(lot)</th><th class="ar">Value</th><th class="ar">Freq</th><th style="text-align:center;min-width:120px">Flow</th><th class="ar">F.Net</th><th class="ar">Accum</th></tr></thead><tbody>';
    for(var i=data.length-1;i>=0;i--){
      var r=data[i];
      var fnv=r.foreign_net_val||0;var cls=fnv>0?'up':fnv<0?'dn':'';
      var accVal=r.foreign_acc_val||0;var accCls=accVal>0?'up':accVal<0?'dn':'';
      var pct=maxAbsVal?Math.min(90,Math.abs(fnv)/maxAbsVal*90):0;
      var prevC=i>0?data[i-1].close:r.close;
      var cp2=prevC?((r.close-prevC)/prevC*100):0;
      var cpCls=cp2>0?'up':cp2<0?'dn':'';
      h+='<tr>';
      h+='<td class="al" style="font-size:10px">'+esc(r.trade_date)+'</td>';
      h+='<td class="ar">'+(r.close||0).toLocaleString()+'</td>';
      h+='<td class="ar '+cpCls+'">'+(i>0?(cp2>0?'+':'')+cp2.toFixed(1)+'%':'-')+'</td>';
      h+='<td class="ar">'+fmtNum(Math.round((r.volume||0)/100))+'</td>';
      h+='<td class="ar">'+fmtRp(r.value||0)+'</td>';
      h+='<td class="ar">'+fmtNum(r.frequency||0)+'</td>';
      h+='<td style="min-width:120px;padding:4px 2px"><div style="display:flex;height:12px">';
      h+='<div style="flex:1;display:flex;justify-content:flex-end">';
      if(fnv<0)h+='<div style="width:'+pct+'%;background:var(--rd);border-radius:2px;opacity:.8"></div>';
      h+='</div><div style="width:1px;background:var(--b2)"></div><div style="flex:1;display:flex">';
      if(fnv>0)h+='<div style="width:'+pct+'%;background:var(--gn);border-radius:2px;opacity:.8"></div>';
      h+='</div></div></td>';
      h+='<td class="ar '+cls+'" style="font-weight:600">'+fmtRp(fnv)+'</td>';
      h+='<td class="ar '+accCls+'">'+fmtRp(accVal)+'</td>';
      h+='</tr>';
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

// ═══════════════════════════════════════════════════════════
// ═══ CORPORATE ACTION — banner, review panel, adjusted OHLC
// ═══════════════════════════════════════════════════════════

// Pending CA banner — shows at top of IDX panel when there are unreviewed CAs
async function beiCaBanner(){
  try{
    var r=await fetch('/api/idx/ca/stats');
    var d=await r.json();
    if(!d.pending||d.pending===0)return'';
    return'<div style="background:rgba(255,167,38,.12);border:1px solid rgba(255,167,38,.3);border-radius:8px;padding:8px 12px;margin-bottom:8px;display:flex;align-items:center;gap:8px;font-size:12px">'
      +'<span>⚡</span>'
      +'<span><b>'+d.pending+' corporate action</b> terdeteksi, perlu review</span>'
      +'<span style="flex:1"></span>'
      +'<button class="bei-tab on" style="font-size:11px;padding:3px 10px" onclick="loadBei(\'ca\')">Review →</button>'
      +'</div>';
  }catch{return'';}
}

// Corp Action review panel
async function loadBeiCaPanel(el,headerH){
  try{
    var [rAll,rStats]=await Promise.all([
      fetch('/api/idx/ca'),
      fetch('/api/idx/ca/stats')
    ]);
    var all=await rAll.json();
    var stats=await rStats.json();
    var rows=all.data||[];

    var h=headerH;

    // Stats
    h+='<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">';
    h+='<div class="ov-card"><div class="ov-card-n" style="color:var(--am)">'+(stats.pending||0)+'</div><div class="ov-card-l">Pending</div></div>';
    h+='<div class="ov-card"><div class="ov-card-n up">'+(stats.confirmed||0)+'</div><div class="ov-card-l">Confirmed</div></div>';
    h+='<div class="ov-card"><div class="ov-card-n">'+(stats.total||0)+'</div><div class="ov-card-l">Total</div></div>';
    h+='</div>';

    // Bulk actions
    if(stats.pending>0){
      h+='<div style="display:flex;gap:6px;margin-bottom:10px">';
      h+='<button class="bei-tab" onclick="caConfirmAll()" style="font-size:11px;background:rgba(102,187,106,.15);border-color:var(--gn)">✓ Confirm All Pending</button>';
      h+='<button class="bei-tab" onclick="caDismissAll()" style="font-size:11px;background:rgba(239,83,80,.1);border-color:var(--rd)">✕ Dismiss All</button>';
      h+='<button class="bei-tab" onclick="caRedetect()" style="font-size:11px">🔄 Re-detect</button>';
      h+='</div>';
    }else{
      h+='<div style="display:flex;gap:6px;margin-bottom:10px">';
      h+='<button class="bei-tab" onclick="caRedetect()" style="font-size:11px">🔄 Re-detect</button>';
      h+='</div>';
    }

    if(!rows.length){
      h+='<div class="ne" style="padding:24px">Belum ada corporate action terdeteksi. Upload data multi-hari untuk auto-detect.</div>';
      el.innerHTML=h;return;
    }

    // Table
    h+='<div style="overflow-y:auto;max-height:calc(100vh - 340px)">';
    h+='<table class="bei-tbl"><thead><tr>';
    h+='<th class="al">Code</th><th class="al">Ex-Date</th><th class="al">Type</th>';
    h+='<th class="ar">Old Shares</th><th class="ar">New Shares</th><th class="ar">Ratio</th>';
    h+='<th class="ar">Old Close</th><th class="ar">New Close</th>';
    h+='<th class="al">Status</th><th class="al">Aksi</th>';
    h+='</tr></thead><tbody>';

    rows.forEach(function(r){
      var sCls=r.status==='pending'?'color:var(--am)':r.status==='confirmed'?'color:var(--gn)':'color:var(--t3)';
      var sIcon=r.status==='pending'?'⏳':r.status==='confirmed'?'✅':'❌';
      var typeLbl=caTypeLabel(r.action_type);
      h+='<tr>';
      h+='<td class="code al" onclick="showFlowDetail(\''+esc(r.code)+'\')">'+esc(r.code)+'</td>';
      h+='<td class="al" style="font-size:11px">'+esc(r.ex_date)+'</td>';
      h+='<td class="al"><span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(79,195,247,.1);color:var(--bl)">'+typeLbl+'</span></td>';
      h+='<td class="ar" style="font-size:11px">'+fmtNum(r.old_shares)+'</td>';
      h+='<td class="ar" style="font-size:11px">'+fmtNum(r.new_shares)+'</td>';
      h+='<td class="ar" style="font-weight:700">'+r.ratio.toFixed(2)+'x</td>';
      h+='<td class="ar">'+(r.old_close||0).toLocaleString()+'</td>';
      h+='<td class="ar">'+(r.new_close||0).toLocaleString()+'</td>';
      h+='<td class="al" style="'+sCls+'">'+sIcon+' '+esc(r.status)+'</td>';
      h+='<td class="al" style="white-space:nowrap">';
      if(r.status==='pending'){
        h+='<button style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--gn);background:rgba(102,187,106,.1);color:var(--gn);cursor:pointer;margin-right:4px" onclick="caConfirm('+r.id+')">✓</button>';
        h+='<button style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--rd);background:rgba(239,83,80,.1);color:var(--rd);cursor:pointer" onclick="caDismiss('+r.id+')">✕</button>';
      }else{
        h+='<button style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--b2);color:var(--t3);cursor:pointer" onclick="caDelete('+r.id+')">🗑</button>';
      }
      h+='</td>';
      h+='</tr>';
    });

    h+='</tbody></table></div>';

    // Notes
    h+='<div style="font-size:10px;color:var(--t3);margin-top:8px;padding:8px;background:var(--bg2);border-radius:6px">';
    h+='💡 <b>Auto-detect logic:</b> listed_shares berubah ≥1.5x atau ≤0.67x antar hari berturutan. ';
    h+='Ratio bulat → split, non-bulat → rights/bonus, turun → reverse. ';
    h+='Confirm untuk aktifkan adjusted OHLC, dismiss untuk false positive.';
    h+='</div>';

    el.innerHTML=h;
  }catch(e){el.innerHTML=headerH+'<div class="ne">Error: '+e.message+'</div>';}
}

function caTypeLabel(t){
  var map={split:'SPLIT',reverse:'REVERSE',rights_or_bonus:'RIGHTS/BONUS',unknown:'UNKNOWN',manual:'MANUAL'};
  return map[t]||t.toUpperCase();
}

async function caConfirm(id){
  try{await fetch('/api/idx/ca/'+id+'/confirm',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'});showT('Corp Action','Confirmed');loadBei('ca');}catch(e){showT('Error',e.message);}
}
async function caDismiss(id){
  try{await fetch('/api/idx/ca/'+id+'/dismiss',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'});showT('Corp Action','Dismissed');loadBei('ca');}catch(e){showT('Error',e.message);}
}
async function caDelete(id){
  if(!confirm('Hapus corporate action ini?'))return;
  try{await fetch('/api/idx/ca/'+id,{method:'DELETE'});showT('Corp Action','Deleted');loadBei('ca');}catch(e){showT('Error',e.message);}
}
async function caConfirmAll(){
  if(!confirm('Confirm semua pending corporate actions?'))return;
  try{var r=await fetch('/api/idx/ca/confirm-all',{method:'POST'});var d=await r.json();showT('Corp Action','Confirmed '+d.confirmed+' actions');loadBei('ca');}catch(e){showT('Error',e.message);}
}
async function caDismissAll(){
  if(!confirm('Dismiss semua pending corporate actions?'))return;
  try{var r=await fetch('/api/idx/ca/dismiss-all',{method:'POST'});var d=await r.json();showT('Corp Action','Dismissed '+d.dismissed+' actions');loadBei('ca');}catch(e){showT('Error',e.message);}
}
async function caRedetect(){
  try{var r=await fetch('/api/idx/ca/detect',{method:'POST'});var d=await r.json();showT('Corp Action','Detected '+d.total+' new actions');loadBei('ca');}catch(e){showT('Error',e.message);}
}

// ═══ Adjusted OHLC view ═══
async function showAdjustedOHLC(code){
  var el=$('bei-content');
  el.innerHTML='<div style="padding:12px">'+skelRows(6)+'</div>';
  try{
    var r=await fetch('/api/idx/adjusted/'+encodeURIComponent(code));
    var d=await r.json();
    var data=d.data||[];
    var actions=d.actions||[];
    var hasAdj=data.some(function(r){return r.cum_factor!==1;});

    var h='<div style="padding:12px">';
    h+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">';
    h+='<button class="ins-back" style="display:inline-flex" onclick="showFlowDetail(\''+esc(code)+'\')">← Back</button>';
    h+='<span style="font-weight:800;font-size:18px;font-family:var(--fm);color:var(--bl)">'+esc(code)+'</span>';
    h+='<span style="color:var(--t2);font-size:12px">📐 Adjusted OHLC</span>';
    h+='</div>';

    // Actions summary
    if(actions.length){
      h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">';
      actions.forEach(function(a){
        h+='<span style="font-size:10px;padding:3px 8px;border-radius:4px;background:rgba(79,195,247,.1);color:var(--bl)">';
        h+=caTypeLabel(a.action_type)+' '+esc(a.ex_date)+' ('+a.ratio.toFixed(2)+'x)';
        h+='</span>';
      });
      h+='</div>';
    }else{
      h+='<div style="font-size:12px;color:var(--t3);margin-bottom:10px">Tidak ada corporate action yang confirmed untuk ticker ini</div>';
    }

    if(!data.length){
      h+='<div class="ne">No OHLC data</div></div>';
      el.innerHTML=h;return;
    }

    // Last 60 rows table (newest first)
    var tail=data.slice(-60).reverse();
    h+='<div style="overflow-y:auto;max-height:calc(100vh - 300px)">';
    h+='<table class="bei-tbl"><thead><tr>';
    h+='<th class="al">Date</th><th class="ar">Close</th><th class="ar" style="color:var(--bl)">Adj Close</th>';
    h+='<th class="ar">Adj Open</th><th class="ar">Adj High</th><th class="ar">Adj Low</th>';
    h+='<th class="ar">Adj Vol(lot)</th><th class="ar">Factor</th>';
    h+='</tr></thead><tbody>';

    tail.forEach(function(r){
      var adjusted=r.cum_factor!==1;
      var fCls=adjusted?'color:var(--bl);font-weight:600':'';
      h+='<tr>';
      h+='<td class="al" style="font-size:10px">'+esc(r.trade_date)+'</td>';
      h+='<td class="ar">'+(r.close||0).toLocaleString()+'</td>';
      h+='<td class="ar" style="'+fCls+'">'+(r.adj_close||0).toLocaleString()+'</td>';
      h+='<td class="ar" style="font-size:11px">'+(r.adj_open||0).toLocaleString()+'</td>';
      h+='<td class="ar" style="font-size:11px">'+(r.adj_high||0).toLocaleString()+'</td>';
      h+='<td class="ar" style="font-size:11px">'+(r.adj_low||0).toLocaleString()+'</td>';
      h+='<td class="ar">'+fmtNum(Math.round((r.adj_volume||0)/100))+'</td>';
      h+='<td class="ar" style="font-size:10px;'+(adjusted?'color:var(--am)':'')+'">'+r.cum_factor+'</td>';
      h+='</tr>';
    });
    h+='</tbody></table></div></div>';
    el.innerHTML=h;
  }catch(e){el.innerHTML='<div class="ne">Error: '+e.message+'</div>';}
}