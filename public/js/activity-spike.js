// ═══ ACTIVITY SPIKE — detect unusual trading activity ═══
var actView='ranking'; // ranking | sectors | dormant
var actAvg=20;
var actData=null;
var actSort='value',actDir='desc';

async function loadActivitySpike(){
  var el=$('activity-content');if(!el)return;
  el.innerHTML='<div style="padding:12px">'+skelRows(8)+'</div>';

  try{
    var r=await fetch('/api/screener/activity-spike?avg='+actAvg);
    actData=await r.json();
    renderActivity();
  }catch(e){el.innerHTML='<div class="ne">Error: '+e.message+'</div>';}
}

function renderActivity(){
  var el=$('activity-content');if(!el||!actData)return;
  var d=actData;

  var h='<div style="display:flex;gap:3px;padding:8px 0;border-bottom:1px solid var(--b1);flex-wrap:wrap;align-items:center">';
  [{k:'ranking',l:'📊 Ranking'},{k:'sectors',l:'🔥 Sector Heatmap'},{k:'dormant',l:'⚡ Dormant → Active'}].forEach(function(v){
    h+='<button class="bei-sort-btn'+(actView===v.k?' on':'')+'" onclick="actView=\''+v.k+'\';renderActivity()" style="padding:5px 12px;font-size:11px">'+v.l+'</button>';
  });
  h+='<span style="flex:1"></span>';
  h+='<span style="font-size:10px;color:var(--t3)">Avg period:</span>';
  [10,20,60].forEach(function(n){
    h+='<button class="bei-sort-btn'+(actAvg===n?' on':'')+'" onclick="actAvg='+n+';loadActivitySpike()" style="padding:3px 8px;font-size:10px">'+n+'D</button>';
  });
  if(d.trade_date)h+='<span style="font-size:10px;color:var(--t3);font-family:var(--fm);margin-left:6px">'+d.trade_date+'</span>';
  h+='</div>';

  if(actView==='ranking')h+=renderActRanking(d);
  else if(actView==='sectors')h+=renderActSectors(d);
  else if(actView==='dormant')h+=renderActDormant(d);

  el.innerHTML=h;
}

// ═══ 1. RANKING TABLE ═══
function renderActRanking(d){
  var data=(d.data||[]).slice();
  data.sort(function(a,b){
    var va=a[actSort]||0,vb=b[actSort]||0;
    return actDir==='asc'?va-vb:vb-va;
  });

  function sa(col){return actSort===col?(actDir==='asc'?' ▲':' ▼'):'';}
  function sc(col){return'actSort=\''+col+'\';actDir=actSort===\''+col+'\'&&actDir===\'desc\'?\'asc\':\'desc\';renderActivity()';}

  var h='<div style="font-size:11px;color:var(--t2);padding:6px 0">Top '+data.length+' stocks by activity spike (vs '+d.avg_days+'D average)</div>';
  h+='<div style="overflow:auto;max-height:calc(100vh - 240px)"><table class="bei-tbl" style="width:100%">';
  h+='<thead style="position:sticky;top:0;background:var(--bg1);z-index:1"><tr>';
  h+='<th class="al" style="min-width:55px">Code</th><th class="al" style="min-width:100px">Name</th>';
  h+='<th class="ar" style="cursor:pointer" onclick="'+sc('close')+'">Close'+sa('close')+'</th>';
  h+='<th class="ar" style="cursor:pointer" onclick="'+sc('value')+'">Value'+sa('value')+'</th>';
  h+='<th class="ar" style="cursor:pointer" onclick="'+sc('frequency')+'">Freq'+sa('frequency')+'</th>';
  h+='<th class="ar" style="cursor:pointer" onclick="'+sc('fnet_val')+'">F.Net'+sa('fnet_val')+'</th>';
  h+='<th class="ar" style="cursor:pointer" onclick="'+sc('score')+'">Score'+sa('score')+'</th>';
  h+='<th class="ar" style="cursor:pointer" onclick="'+sc('val_spike')+'">Val↑'+sa('val_spike')+'</th>';
  h+='<th class="ar" style="cursor:pointer" onclick="'+sc('freq_spike')+'">Freq↑'+sa('freq_spike')+'</th>';
  h+='<th class="ar" style="cursor:pointer" onclick="'+sc('vol_spike')+'">Vol↑'+sa('vol_spike')+'</th>';
  h+='<th class="ar" style="cursor:pointer" onclick="'+sc('fnet_spike')+'">F.Net↑'+sa('fnet_spike')+'</th>';
  h+='<th style="width:30px"></th>';
  h+='</tr></thead><tbody>';

  data.forEach(function(r){
    var scoreCls=r.score>=3?'up':r.score>=2?'':'dn';
    var fCls=(r.fnet_val||0)>0?'up':(r.fnet_val||0)<0?'dn':'';
    h+='<tr>';
    h+='<td class="code al" onclick="gsOpen(\''+esc(r.code)+'\')">'+esc(r.code)+'</td>';
    h+='<td class="al" style="font-size:10px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.name||'')+'</td>';
    h+='<td class="ar" style="font-family:var(--fm)">'+(r.close||0).toLocaleString()+'</td>';
    h+='<td class="ar" style="font-family:var(--fm)">'+fmtRp(r.value||0)+'</td>';
    h+='<td class="ar" style="font-family:var(--fm)">'+fmtNum(r.frequency||0)+'</td>';
    h+='<td class="ar '+fCls+'" style="font-family:var(--fm)">'+fmtRp(r.fnet_val||0)+'</td>';
    h+='<td class="ar '+scoreCls+'" style="font-family:var(--fm);font-weight:700">'+r.score+'x</td>';
    h+='<td class="ar" style="font-family:var(--fm);color:'+(r.val_spike>=3?'var(--gn)':r.val_spike>=2?'var(--am)':'var(--t2)')+'">'+r.val_spike+'x</td>';
    h+='<td class="ar" style="font-family:var(--fm);color:'+(r.freq_spike>=3?'var(--gn)':r.freq_spike>=2?'var(--am)':'var(--t2)')+'">'+r.freq_spike+'x</td>';
    h+='<td class="ar" style="font-family:var(--fm);color:'+(r.vol_spike>=3?'var(--gn)':r.vol_spike>=2?'var(--am)':'var(--t2)')+'">'+r.vol_spike+'x</td>';
    h+='<td class="ar" style="font-family:var(--fm);color:'+(r.fnet_spike>=3?'var(--gn)':r.fnet_spike>=2?'var(--am)':'var(--t2)')+'">'+r.fnet_spike+'x</td>';
    h+='<td><button style="background:none;border:none;cursor:pointer;font-size:12px" onclick="actShowChart(\''+esc(r.code)+'\')">📈</button></td>';
    h+='</tr>';
  });
  h+='</tbody></table></div>';
  h+='<div style="font-size:10px;color:var(--t3);padding:4px 0">Score = weighted spike (Value 30% + Freq 30% + Vol 20% + F.Net 20%). Color: 🟢 ≥3x, 🟡 ≥2x, ⚪ <2x</div>';
  return h;
}

// ═══ 2. SECTOR HEATMAP ═══
function renderActSectors(d){
  var sectors=d.sector_spikes||[];
  if(!sectors.length)return'<div class="ne" style="padding:20px">No sector data</div>';

  var maxScore=Math.max.apply(null,sectors.map(function(s){return s.avg_score;}))||1;

  var h='<div style="font-size:11px;color:var(--t2);padding:6px 0">Sector activity level (average spike score)</div>';
  h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px;padding:8px 0">';

  sectors.forEach(function(s){
    var intensity=Math.min(1,s.avg_score/maxScore);
    var bg=s.avg_score>=2?'rgba(34,197,94,'+Math.max(0.05,intensity*0.4)+')':
           s.avg_score>=1.5?'rgba(245,158,11,'+Math.max(0.05,intensity*0.3)+')':'var(--bgH)';
    var topCode=s.top_spike?s.top_spike.code:'';
    var topScore=s.top_spike?s.top_spike.score:0;

    h+='<div style="padding:12px;border-radius:8px;border:1px solid var(--b1);background:'+bg+'">';
    h+='<div style="font-weight:700;font-size:12px;margin-bottom:4px">'+esc(s.sector)+'</div>';
    h+='<div style="display:flex;gap:12px;font-size:11px">';
    h+='<span>Avg Score: <b style="font-family:var(--fm)">'+s.avg_score+'x</b></span>';
    h+='<span>Stocks: <b style="font-family:var(--fm)">'+s.count+'</b></span>';
    h+='</div>';
    if(topCode)h+='<div style="font-size:10px;color:var(--t3);margin-top:4px">Top: <span class="code" onclick="gsOpen(\''+esc(topCode)+'\')">'+esc(topCode)+'</span> ('+topScore+'x)</div>';
    h+='</div>';
  });
  h+='</div>';
  return h;
}

// ═══ 3. DORMANT → ACTIVE ═══
function renderActDormant(d){
  var dormant=d.dormant||[];
  if(!dormant.length)return'<div class="ne" style="padding:20px">No dormant stocks detected today (avg freq <30, today freq spike ≥3x)</div>';

  var h='<div style="font-size:11px;color:var(--t2);padding:6px 0">'+dormant.length+' stocks went from dormant to active (normally low frequency, today spiked ≥3x)</div>';
  h+='<div style="overflow:auto;max-height:calc(100vh - 240px)"><table class="bei-tbl" style="width:100%">';
  h+='<thead style="position:sticky;top:0;background:var(--bg1);z-index:1"><tr>';
  h+='<th class="al">Code</th><th class="al">Name</th><th class="ar">Close</th>';
  h+='<th class="ar">Avg Freq</th><th class="ar">Today Freq</th><th class="ar">Freq Spike</th>';
  h+='<th class="ar">Value</th><th class="ar">F.Net</th>';
  h+='</tr></thead><tbody>';

  dormant.forEach(function(r){
    var fCls=(r.fnet_val||0)>0?'up':(r.fnet_val||0)<0?'dn':'';
    h+='<tr>';
    h+='<td class="code al" onclick="gsOpen(\''+esc(r.code)+'\')">'+esc(r.code)+'</td>';
    h+='<td class="al" style="font-size:10px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.name||'')+'</td>';
    h+='<td class="ar" style="font-family:var(--fm)">'+(r.close||0).toLocaleString()+'</td>';
    h+='<td class="ar" style="font-family:var(--fm);color:var(--t3)">'+r.avg_freq+'</td>';
    h+='<td class="ar" style="font-family:var(--fm);font-weight:700">'+fmtNum(r.frequency)+'</td>';
    h+='<td class="ar up" style="font-family:var(--fm);font-weight:700">'+r.freq_spike+'x</td>';
    h+='<td class="ar" style="font-family:var(--fm)">'+fmtRp(r.value||0)+'</td>';
    h+='<td class="ar '+fCls+'" style="font-family:var(--fm)">'+fmtRp(r.fnet_val||0)+'</td>';
    h+='</tr>';
  });
  h+='</tbody></table></div>';
  h+='<div style="font-size:10px;color:var(--t3);padding:4px 0">Dormant = avg frequency < 30 trades/day. Active = today freq spike ≥ 3x average.</div>';
  return h;
}

// ═══ 4. ACTIVITY CHART for single ticker ═══
async function actShowChart(code){
  try{
    var r=await fetch('/api/screener/activity-history/'+code+'?days=60');
    var d=await r.json();
    if(!d.data||!d.data.length)return;

    // Show in a popup
    var h='<div class="epop o" id="act-chart-pop" onclick="if(event.target===this)this.remove()">';
    h+='<div style="background:var(--bg1);border-radius:12px;padding:16px;max-width:700px;width:90%;margin:40px auto">';
    h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
    h+='<span style="font-weight:700;font-size:14px">'+esc(code)+' — Activity (60D)</span>';
    h+='<button onclick="$(\'act-chart-pop\').remove()" style="background:none;border:none;font-size:18px;cursor:pointer">✕</button></div>';
    h+='<div id="act-chart-svg"></div></div></div>';
    document.body.insertAdjacentHTML('beforeend',h);

    var el=$('act-chart-svg');
    var data=d.data;
    var W=el.offsetWidth||600,H=200;
    var pad={t:15,r:10,b:25,l:55};
    var cW=W-pad.l-pad.r,cH=H-pad.t-pad.b;
    var n=data.length;

    // Draw value bar chart
    var maxVal=Math.max.apply(null,data.map(function(r){return r.value||0;}))||1;
    var svg='<svg width="'+W+'" height="'+H+'" style="display:block">';
    var barW=Math.max(2,cW/n-1);

    data.forEach(function(r,i){
      var x=pad.l+i*(cW/n);
      var v=r.value||0;
      var barH=Math.max(1,v/maxVal*cH);
      var fnet=r.fnet_val||0;
      var clr=fnet>0?'var(--gn)':fnet<0?'var(--rd)':'var(--t3)';
      svg+='<rect x="'+x+'" y="'+(pad.t+cH-barH)+'" width="'+barW+'" height="'+barH+'" fill="'+clr+'" rx="1" opacity="0.7"/>';
    });

    // X axis labels
    var ls=Math.max(1,Math.floor(n/8));
    for(var i=0;i<n;i+=ls){
      svg+='<text x="'+(pad.l+i*(cW/n)+barW/2)+'" y="'+(H-4)+'" fill="var(--t3)" font-size="8" font-family="var(--fm)" text-anchor="middle">'+data[i].trade_date.substring(5)+'</text>';
    }
    // Y axis
    for(var g=0;g<=3;g++){
      var gy=pad.t+g/3*cH;var gv=maxVal-g/3*maxVal;
      svg+='<text x="'+(pad.l-4)+'" y="'+(gy+3)+'" fill="var(--t3)" font-size="8" font-family="var(--fm)" text-anchor="end">'+fmtRp(gv)+'</text>';
    }
    svg+='</svg>';
    svg+='<div style="font-size:10px;color:var(--t3);margin-top:4px">Bar = transaction value. 🟢 Foreign net buy, 🔴 Foreign net sell</div>';
    el.innerHTML=svg;
  }catch(e){showT('Error',e.message);}
}