// ═══ SECTOR INTELLIGENCE — Rotation, Flow Timeline, Correlation ═══
var secIntView='overview'; // overview | rotation | timeline | correlation
var secIntLevel='sector'; // sector | industry
var secIntMetric='fnet'; // fnet | avg_chg | value
var secIntWeeks=12;
var secIntCache={};

// ── Main entry: replaces loadSectorView ──
async function loadSectorView(){
  var el=$('sector-content');if(!el)return;

  // Sub-navigation
  var h='<div style="display:flex;align-items:center;gap:3px;padding:8px 12px;border-bottom:1px solid var(--b1);flex-wrap:wrap">';
  [{k:'overview',l:'📊 Overview'},{k:'rotation',l:'🔥 Rotation'},{k:'timeline',l:'📈 Flow Timeline'},{k:'correlation',l:'🔗 Correlation'}].forEach(function(v){
    h+='<button class="bei-sort-btn'+(secIntView===v.k?' on':'')+'" onclick="secIntView=\''+v.k+'\';loadSectorView()" style="padding:5px 12px;font-size:11px">'+v.l+'</button>';
  });
  h+='</div>';
  h+='<div id="sec-int-body" style="overflow-y:auto;height:calc(100% - 40px)"></div>';
  el.innerHTML=h;

  var body=$('sec-int-body');
  if(secIntView==='overview')await loadSecOverview(body);
  else if(secIntView==='rotation')await loadSecRotation(body);
  else if(secIntView==='timeline')await loadSecTimeline(body);
  else if(secIntView==='correlation')await loadSecCorrelation(body);
}

// ═══ 1. OVERVIEW — existing sector cards with drill-down (preserved) ═══
var sectorDrillSector='',sectorDrillIndustry='';

async function loadSecOverview(el){
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
      if(d.stocks&&d.stocks.length){
        h+='<div style="font-weight:600;font-size:12px;margin:16px 0 8px;color:var(--t2)">Top Stocks by Market Cap</div>';
        h+=sectorStockTable(d.stocks);
      }
      h+='</div>';
    }else{
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

// ═══ 2. ROTATION HEATMAP ═══
var rotSortCol='total',rotSortDir='desc';

// Normalize sector/industry names to Title Case
function titleCase(s){
  if(!s)return'';
  return s.toLowerCase().replace(/(?:^|\s|&|-)\S/g,function(c){return c.toUpperCase();}).replace(/ And /g,' & ');
}

async function loadSecRotation(el){
  el.innerHTML='<div id="rotation-ctrl"></div><div id="rotation-heatmap" style="overflow:auto;max-height:calc(100vh - 200px)"></div>';
  renderRotationCtrl();

  if(secIntWeeks<13)secIntWeeks=13;

  try{
    var cacheKey='rot_'+secIntLevel+'_'+secIntWeeks;
    if(!secIntCache[cacheKey]){
      var r=await fetch('/api/screener/sector-intelligence?level='+secIntLevel+'&weeks='+secIntWeeks);
      secIntCache[cacheKey]=await r.json();
    }
    window._rotData=secIntCache[cacheKey];
    renderRotationHeatmap();
  }catch(e){$('rotation-heatmap').innerHTML='<div class="ne">Error: '+e.message+'</div>';}
}

function renderRotationCtrl(){
  var el=$('rotation-ctrl');if(!el)return;
  var h='<div style="padding:8px 12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--b1)">';
  h+='<span style="font-size:10px;color:var(--t3)">Level:</span>';
  [{k:'sector',l:'Sector'},{k:'industry',l:'Industry'}].forEach(function(l){
    h+='<button class="bei-sort-btn'+(secIntLevel===l.k?' on':'')+'" onclick="secIntLevel=\''+l.k+'\';secIntCache={};loadSectorView()" style="padding:3px 8px;font-size:10px">'+l.l+'</button>';
  });
  h+='<span style="width:8px"></span>';
  h+='<span style="font-size:10px;color:var(--t3)">Metric:</span>';
  [{k:'fnet',l:'🌍 F.Net'},{k:'avg_chg',l:'📈 Price %'},{k:'value',l:'💰 Value'}].forEach(function(m){
    h+='<button class="bei-sort-btn'+(secIntMetric===m.k?' on':'')+'" onclick="secIntMetric=\''+m.k+'\';renderRotationCtrl();renderRotationHeatmap()" style="padding:3px 8px;font-size:10px">'+m.l+'</button>';
  });
  h+='<span style="width:8px"></span>';
  h+='<span style="font-size:10px;color:var(--t3)">Period:</span>';
  [{k:13,l:'3M'},{k:26,l:'6M'},{k:52,l:'1Y'},{k:104,l:'2Y'}].forEach(function(p){
    h+='<button class="bei-sort-btn'+(secIntWeeks===p.k?' on':'')+'" onclick="secIntWeeks='+p.k+';secIntCache={};loadSectorView()" style="padding:3px 8px;font-size:10px">'+p.l+'</button>';
  });
  h+='</div>';
  el.innerHTML=h;
}

function renderRotationHeatmap(){
  var el=$('rotation-heatmap');if(!el||!window._rotData)return;
  var d=window._rotData;
  if(d.error){el.innerHTML='<div class="ne">'+d.error+'</div>';return;}

  var weeks=d.weeks||[];var names=d.group_names||[];
  if(!weeks.length||!names.length){el.innerHTML='<div class="ne">Not enough data</div>';return;}

  // Aggregate into monthly buckets for readability
  var months=[];
  var monthMap={};
  weeks.forEach(function(w){
    var key=w.week_start.substring(0,7); // YYYY-MM
    if(!monthMap[key]){monthMap[key]={label:w.week_start.substring(2,7),groups:{},weeks:0};months.push(monthMap[key]);}
    monthMap[key].weeks++;
    w.groups.forEach(function(g){
      if(!monthMap[key].groups[g.name])monthMap[key].groups[g.name]={fnet:0,avg_chg:0,value:0,count:0};
      var mg=monthMap[key].groups[g.name];
      mg.fnet+=g.fnet;mg.value+=g.value;mg.count++;
      mg.avg_chg+=g.avg_chg; // sum weekly avg, divide later
    });
  });
  months.forEach(function(m){
    for(var k in m.groups){if(m.groups[k].count)m.groups[k].avg_chg=Math.round(m.groups[k].avg_chg/m.groups[k].count*100)/100;}
  });

  // Build matrix from monthly data
  var matrix={};var maxAbs=0;
  names.forEach(function(n){
    matrix[n]=[];
    var total=0;
    months.forEach(function(m){
      var g=m.groups[n];
      var val=0;
      if(g){
        if(secIntMetric==='fnet')val=g.fnet;
        else if(secIntMetric==='avg_chg')val=g.avg_chg;
        else val=g.value;
      }
      matrix[n].push(val);
      total+=val;
      if(Math.abs(val)>maxAbs)maxAbs=Math.abs(val);
    });
    matrix[n]._total=total;
  });

  // Sort
  var sortedNames=names.slice();
  if(rotSortCol==='name'){
    sortedNames.sort(function(a,b){return rotSortDir==='asc'?a.localeCompare(b):b.localeCompare(a);});
  }else if(rotSortCol==='total'){
    sortedNames.sort(function(a,b){return rotSortDir==='asc'?matrix[a]._total-matrix[b]._total:matrix[b]._total-matrix[a]._total;});
  }else if(rotSortCol.startsWith('m_')){
    var mi=parseInt(rotSortCol.substring(2));
    sortedNames.sort(function(a,b){return rotSortDir==='asc'?(matrix[a][mi]||0)-(matrix[b][mi]||0):(matrix[b][mi]||0)-(matrix[a][mi]||0);});
  }

  // Filter out "No Sector" etc
  sortedNames=sortedNames.filter(function(n){return n&&n.toLowerCase()!=='no sector'&&n.trim()!=='';});

  var metricLabel=secIntMetric==='fnet'?'Foreign Net Flow':secIntMetric==='avg_chg'?'Avg Price Change %':'Total Value';
  var h='<div style="font-weight:700;font-size:13px;margin-bottom:8px">Sector Rotation — '+metricLabel+'</div>';

  // Sortable header helper
  function sortArrow(col){return rotSortCol===col?(rotSortDir==='asc'?' ▲':' ▼'):'';}
  function sortClick(col){return'rotSortCol=\''+col+'\';rotSortDir=rotSortCol===\''+col+'\'&&rotSortDir===\'desc\'?\'asc\':\'desc\';renderRotationHeatmap()';}

  h+='<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:10px;min-width:100%">';
  h+='<thead><tr>';
  h+='<th style="padding:4px 8px;text-align:left;position:sticky;left:0;background:var(--bg1);z-index:3;min-width:170px;font-size:9px;color:var(--t3);cursor:pointer;user-select:none;border-bottom:2px solid var(--b2)" onclick="'+sortClick('name')+'">'+secIntLevel.toUpperCase()+sortArrow('name')+'</th>';
  months.forEach(function(m,mi){
    h+='<th style="padding:4px 4px;text-align:center;font-size:9px;color:var(--t3);min-width:70px;font-family:var(--fm);cursor:pointer;user-select:none;border-bottom:2px solid var(--b2)" onclick="'+sortClick('m_'+mi)+'">'+m.label+sortArrow('m_'+mi)+'</th>';
  });
  h+='<th style="padding:4px 8px;text-align:right;font-size:9px;color:var(--t3);min-width:80px;position:sticky;right:0;background:var(--bg1);z-index:3;cursor:pointer;user-select:none;border-bottom:2px solid var(--b2)" onclick="'+sortClick('total')+'">TOTAL'+sortArrow('total')+'</th>';
  h+='</tr></thead><tbody>';

  sortedNames.forEach(function(name){
    var vals=matrix[name];
    var total=vals._total;
    var totalCls=total>0?'up':total<0?'dn':'';
    var displayName=titleCase(name);

    // Clickable name → drill to sector overview or show stock list
    var clickAction=secIntLevel==='sector'?
      'sectorDrillSector=\''+esc(name).replace(/'/g,"\\'")+'\';sectorDrillIndustry=\'\';secIntView=\'overview\';loadSectorView()':
      'sectorDrillIndustry=\''+esc(name).replace(/'/g,"\\'")+'\';secIntView=\'overview\';loadSectorView()';

    h+='<tr>';
    h+='<td style="padding:4px 8px;font-weight:600;font-size:11px;border-bottom:1px solid var(--b1);position:sticky;left:0;background:var(--bg1);z-index:2;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;cursor:pointer;color:var(--bl)" title="'+esc(name)+'" onclick="'+clickAction+'">'+esc(displayName)+'</td>';

    vals.forEach(function(v,vi){
      if(typeof v!=='number')return; // skip _total
      var intensity=maxAbs?Math.min(1,Math.abs(v)/maxAbs):0;
      var bg,color;
      if(v>0){bg='rgba(34,197,94,'+Math.max(0.05,intensity*0.6)+')';color=intensity>0.3?'var(--gn)':'var(--t2)';}
      else if(v<0){bg='rgba(239,68,68,'+Math.max(0.05,intensity*0.6)+')';color=intensity>0.3?'var(--rd)':'var(--t2)';}
      else{bg='transparent';color='var(--t3)';}
      var display=secIntMetric==='fnet'?fmtRp(v):secIntMetric==='avg_chg'?(v>0?'+':'')+v.toFixed(1)+'%':fmtRp(v);
      h+='<td style="padding:3px 4px;text-align:center;border-bottom:1px solid var(--b1);background:'+bg+';color:'+color+';font-family:var(--fm);font-size:9px;font-weight:600">'+display+'</td>';
    });

    var totalDisplay=secIntMetric==='fnet'?fmtRp(total):secIntMetric==='avg_chg'?(total>0?'+':'')+total.toFixed(1)+'%':fmtRp(total);
    h+='<td style="padding:4px 8px;text-align:right;border-bottom:1px solid var(--b1);font-family:var(--fm);font-weight:700;font-size:11px;position:sticky;right:0;background:var(--bg1);z-index:2" class="'+totalCls+'">'+totalDisplay+'</td>';
    h+='</tr>';
  });

  h+='</tbody></table></div>';
  h+='<div style="margin-top:8px;font-size:10px;color:var(--t3)">🟢 Positive (inflow/gain) → 🔴 Negative (outflow/loss). Click name to drill down. Click header to sort. Monthly aggregated.</div>';
  el.innerHTML=h;
}

// ═══ 3. FLOW TIMELINE — multi-line chart with toggleable sectors ═══
var secTimeMetric='fnet'; // fnet | avg_chg | value
var secTimeHidden={}; // { 'Financials': true } = hidden

async function loadSecTimeline(el){
  el.innerHTML='<div id="timeline-ctrl"></div><div id="timeline-wrap"></div>';
  renderTimelineCtrl();

  try{
    if(secIntWeeks<13)secIntWeeks=13;
    var cacheKey='rot_'+secIntLevel+'_'+secIntWeeks;
    if(!secIntCache[cacheKey]){
      var r=await fetch('/api/screener/sector-intelligence?level='+secIntLevel+'&weeks='+secIntWeeks);
      secIntCache[cacheKey]=await r.json();
    }
    window._rotData=secIntCache[cacheKey];
    renderTimeline();
  }catch(e){
    var w=$('timeline-wrap');if(w)w.innerHTML='<div class="ne" style="padding:20px">Error: '+e.message+'</div>';
  }
}

function renderTimelineCtrl(){
  var el=$('timeline-ctrl');if(!el)return;
  var h='<div style="padding:8px 12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--b1)">';
  h+='<span style="font-size:10px;color:var(--t3)">Level:</span>';
  [{k:'sector',l:'Sector'},{k:'industry',l:'Industry'}].forEach(function(l){
    h+='<button class="bei-sort-btn'+(secIntLevel===l.k?' on':'')+'" onclick="secIntLevel=\''+l.k+'\';secIntCache={};secTimeHidden={};loadSectorView()" style="padding:3px 8px;font-size:10px">'+l.l+'</button>';
  });
  h+='<span style="width:8px"></span>';
  h+='<span style="font-size:10px;color:var(--t3)">Metric:</span>';
  [{k:'fnet',l:'🌍 Cumul. F.Net'},{k:'avg_chg',l:'📈 Cumul. Price %'},{k:'value',l:'💰 Weekly Value'}].forEach(function(m){
    h+='<button class="bei-sort-btn'+(secTimeMetric===m.k?' on':'')+'" onclick="secTimeMetric=\''+m.k+'\';renderTimelineCtrl();renderTimeline()" style="padding:3px 8px;font-size:10px">'+m.l+'</button>';
  });
  h+='<span style="width:8px"></span>';
  [{k:13,l:'3M'},{k:26,l:'6M'},{k:52,l:'1Y'},{k:104,l:'2Y'}].forEach(function(p){
    h+='<button class="bei-sort-btn'+(secIntWeeks===p.k?' on':'')+'" onclick="secIntWeeks='+p.k+';secIntCache={};secTimeHidden={};loadSectorView()" style="padding:3px 8px;font-size:10px">'+p.l+'</button>';
  });
  h+='</div>';
  el.innerHTML=h;
}

function renderTimeline(){
  var wrap=$('timeline-wrap');
  if(!wrap||!window._rotData)return;
  var d=window._rotData;
  if(d.error||!d.weeks||!d.weeks.length){wrap.innerHTML='<div class="ne" style="padding:20px">Not enough data</div>';return;}

  var weeks=d.weeks,names=(d.group_names||[]).filter(function(n){return n&&n.toLowerCase()!=='no sector'&&n.trim()!=='';});
  var colors=['#0ea5e9','#ef4444','#22c55e','#f59e0b','#a855f7','#ec4899','#14b8a6','#f97316','#06b6d4','#84cc16','#6366f1','#dc2626','#8b5cf6','#0284c7'];

  // Build series
  var series={};
  var cumulative=secTimeMetric==='fnet'||secTimeMetric==='avg_chg';
  names.forEach(function(n){
    var vals=[];var cum=0;
    weeks.forEach(function(w){
      var g=w.groups.find(function(x){return x.name===n;});
      var v=0;
      if(g){
        if(secTimeMetric==='fnet')v=g.fnet;
        else if(secTimeMetric==='avg_chg')v=g.avg_chg;
        else v=g.value;
      }
      if(cumulative){cum+=v;vals.push(cum);}
      else vals.push(v);
    });
    series[n]=vals;
  });

  // Sort by abs final value
  var sorted=names.slice().sort(function(a,b){
    var la=series[a],lb=series[b];
    return Math.abs(lb[lb.length-1])-Math.abs(la[la.length-1]);
  });

  // Visible = not hidden
  var visible=sorted.filter(function(n){return!secTimeHidden[n];});

  // Chart
  var n2=weeks.length;
  var h='<div id="timeline-chart" style="padding:12px"></div>';
  h+='<div id="timeline-legend" style="padding:4px 12px 12px"></div>';
  wrap.innerHTML=h;

  var chartEl=$('timeline-chart'),legEl=$('timeline-legend');
  if(!chartEl)return;

  var W=chartEl.offsetWidth||700,H=350;
  var pad={t:20,r:60,b:30,l:65};
  var cW=W-pad.l-pad.r,cH=H-pad.t-pad.b;

  var allV=[];
  visible.forEach(function(n){series[n].forEach(function(v){allV.push(v);});});
  if(!allV.length){
    chartEl.innerHTML='';
    renderTimelineLegend(legEl,sorted,series,colors,n2);
    return;
  }

  var minV=Math.min.apply(null,allV),maxV=Math.max.apply(null,allV);
  var rng=maxV-minV||1;minV-=rng*.05;maxV+=rng*.05;rng=maxV-minV;
  function xS(i){return pad.l+i/(n2-1)*cW;}
  function yS(v){return pad.t+(1-(v-minV)/rng)*cH;}

  var svg='<svg width="'+W+'" height="'+H+'" style="display:block">';
  for(var g=0;g<=5;g++){
    var gy=pad.t+g/5*cH;var gv=maxV-g/5*rng;
    svg+='<line x1="'+pad.l+'" y1="'+gy+'" x2="'+(W-pad.r)+'" y2="'+gy+'" stroke="var(--b1)" stroke-width="1"/>';
    var label=secTimeMetric==='avg_chg'?(gv>0?'+':'')+gv.toFixed(1)+'%':fmtRp(gv);
    svg+='<text x="'+(W-pad.r+4)+'" y="'+(gy+3)+'" fill="var(--t3)" font-size="8" font-family="var(--fm)">'+label+'</text>';
  }
  if(minV<0&&maxV>0){var zy=yS(0);svg+='<line x1="'+pad.l+'" y1="'+zy+'" x2="'+(W-pad.r)+'" y2="'+zy+'" stroke="var(--t3)" stroke-width="1" stroke-dasharray="3,3"/>';}
  var ls=Math.max(1,Math.floor(n2/8));
  for(var di=0;di<n2;di+=ls){
    svg+='<text x="'+xS(di)+'" y="'+(H-4)+'" fill="var(--t3)" font-size="8" font-family="var(--fm)" text-anchor="middle">'+weeks[di].week_start.substring(5)+'</text>';
  }

  visible.forEach(function(name){
    var ci=sorted.indexOf(name);
    var clr=colors[ci%colors.length];
    var pts=[];
    series[name].forEach(function(v,i){pts.push(xS(i)+','+yS(v));});
    if(pts.length>=2){
      svg+='<polyline points="'+pts.join(' ')+'" fill="none" stroke="'+clr+'" stroke-width="2" stroke-linejoin="round" opacity="0.85"/>';
      var last=series[name][n2-1];
      svg+='<circle cx="'+xS(n2-1)+'" cy="'+yS(last)+'" r="3" fill="'+clr+'"/>';
    }
  });
  svg+='</svg>';
  chartEl.innerHTML=svg;

  renderTimelineLegend(legEl,sorted,series,colors,n2);
}

function renderTimelineLegend(legEl,sorted,series,colors,n2){
  if(!legEl)return;
  var allOn=sorted.every(function(n){return!secTimeHidden[n];});
  var allOff=sorted.every(function(n){return secTimeHidden[n];});

  var lh='<div style="display:flex;gap:4px;margin-bottom:6px">';
  lh+='<button class="bei-sort-btn'+(allOn?' on':'')+'" onclick="secTimeHidden={};renderTimeline()" style="padding:2px 8px;font-size:9px">Show All</button>';
  lh+='<button class="bei-sort-btn" onclick="if(window._tlSorted)window._tlSorted.forEach(function(n){secTimeHidden[n]=true;});renderTimeline()" style="padding:2px 8px;font-size:9px">Hide All</button>';
  lh+='<button class="bei-sort-btn" onclick="secTimeShowTop(5)" style="padding:2px 8px;font-size:9px">Top 5</button>';
  lh+='<button class="bei-sort-btn" onclick="secTimeShowTop(3)" style="padding:2px 8px;font-size:9px">Top 3</button>';
  lh+='</div>';

  lh+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:2px">';
  sorted.forEach(function(name,ci){
    var clr=colors[ci%colors.length];
    var last=series[name][n2-1];
    var cls=last>0?'up':last<0?'dn':'';
    var display=secTimeMetric==='avg_chg'?(last>0?'+':'')+last.toFixed(1)+'%':fmtRp(last);
    var hidden=secTimeHidden[name];
    var opacity=hidden?'0.3':'1';
    var displayName=titleCase(name);
    if(displayName.length>22)displayName=displayName.substring(0,22)+'…';

    lh+='<div style="display:flex;align-items:center;gap:4px;padding:2px 6px;border-radius:4px;cursor:pointer;opacity:'+opacity+';font-size:11px;transition:opacity .15s'+(hidden?'':';background:var(--bgH)')+'" onclick="secTimeHidden[\''+esc(name).replace(/'/g,"\\'")+'\']='+(hidden?'false':'true')+';renderTimeline()">';
    lh+='<span style="width:12px;height:3px;background:'+clr+';border-radius:2px;flex-shrink:0"></span>';
    lh+='<span style="font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(name)+'">'+esc(displayName)+'</span>';
    lh+='<span class="'+cls+'" style="font-family:var(--fm);font-size:10px;white-space:nowrap">'+display+'</span>';
    lh+='</div>';
  });
  lh+='</div>';
  legEl.innerHTML=lh;

  // Store sorted in window for button access
  window._tlSorted=sorted;
}

function secTimeShowTop(n){
  if(!window._tlSorted)return;
  secTimeHidden={};
  window._tlSorted.forEach(function(name,i){if(i>=n)secTimeHidden[name]=true;});
  renderTimeline();
}

// ═══ 4. CORRELATION — 3 modes ═══
var corrMode='ownership'; // ownership | industry | custom
var corrSector='',corrIndustry='',corrDays=65,corrMin=0.7;
var corrLists=null; // cached sector/industry lists

async function loadSecCorrelation(el){
  // Sub-tab bar
  var h='<div style="padding:8px 12px;display:flex;gap:3px;border-bottom:1px solid var(--b1)">';
  [{k:'ownership',l:'👥 By Ownership'},{k:'industry',l:'🏭 By Industry'},{k:'custom',l:'🔧 Custom'}].forEach(function(m){
    h+='<button class="bei-sort-btn'+(corrMode===m.k?' on':'')+'" onclick="corrMode=\''+m.k+'\';loadSectorView()" style="padding:5px 12px;font-size:11px">'+m.l+'</button>';
  });
  h+='</div>';
  h+='<div id="corr-ctrl"></div>';
  h+='<div id="corr-results" style="padding:12px">'+skelRows(6)+'</div>';
  el.innerHTML=h;

  renderCorrCtrl();

  // Load lists for Custom mode dropdown
  if(!corrLists){
    try{var r=await fetch('/api/screener/fundamental-lists');corrLists=await r.json();}catch(e){corrLists={sectors:[],industries:[],sector_industry_map:{}};}
  }
  if(corrMode==='custom')populateCorrDropdowns();

  // Fetch correlation
  try{
    var url='/api/screener/correlation?mode='+corrMode+'&days='+corrDays+'&min='+corrMin;
    if(corrMode==='custom'){
      if(corrSector)url+='&sector='+encodeURIComponent(corrSector);
      if(corrIndustry)url+='&industry='+encodeURIComponent(corrIndustry);
    }
    var r=await fetch(url);var d=await r.json();
    renderCorrelation(d);
  }catch(e){$('corr-results').innerHTML='<div class="ne">Error: '+e.message+'</div>';}
}

function renderCorrCtrl(){
  var el=$('corr-ctrl');if(!el)return;
  var h='<div style="padding:6px 12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--b1)">';

  if(corrMode==='custom'){
    h+='<select id="corr-sector" class="bei-filter-sel" style="min-width:150px;font-size:11px" onchange="corrSector=this.value;corrIndustry=\'\';populateCorrDropdowns();loadSectorView()"><option value="">All Sectors</option></select>';
    h+='<select id="corr-industry" class="bei-filter-sel" style="min-width:150px;font-size:11px" onchange="corrIndustry=this.value;loadSectorView()"><option value="">All Industries</option></select>';
    h+='<span style="width:6px"></span>';
  }else{
    var desc=corrMode==='ownership'?'Pairs yang share pemilik sama (≥1% ownership)':'Pairs di industri yang sama';
    h+='<span style="font-size:10px;color:var(--t3)">'+desc+'</span><span style="width:6px"></span>';
  }

  h+='<span style="font-size:10px;color:var(--t3)">Period:</span>';
  [{k:65,l:'3M'},{k:130,l:'6M'},{k:260,l:'1Y'},{k:520,l:'2Y'}].forEach(function(d){
    h+='<button class="bei-sort-btn'+(corrDays===d.k?' on':'')+'" onclick="corrDays='+d.k+';loadSectorView()" style="padding:3px 8px;font-size:10px">'+d.l+'</button>';
  });
  h+='<span style="width:6px"></span>';
  h+='<span style="font-size:10px;color:var(--t3)">Min r:</span>';
  [0.5,0.6,0.7,0.8,0.9].forEach(function(m){
    h+='<button class="bei-sort-btn'+(corrMin===m?' on':'')+'" onclick="corrMin='+m+';loadSectorView()" style="padding:3px 8px;font-size:10px">'+m+'</button>';
  });
  h+='</div>';
  el.innerHTML=h;
}

function populateCorrDropdowns(){
  if(!corrLists)return;
  var selS=$('corr-sector');
  if(selS){
    var h='<option value="">All Sectors</option>';
    (corrLists.sectors||[]).forEach(function(s){h+='<option value="'+esc(s)+'"'+(corrSector===s?' selected':'')+'>'+esc(s)+'</option>';});
    selS.innerHTML=h;
  }
  var selI=$('corr-industry');
  if(selI){
    var h2='<option value="">All Industries</option>';
    var list=corrLists.industries||[];
    if(corrSector&&corrLists.sector_industry_map&&corrLists.sector_industry_map[corrSector])list=corrLists.sector_industry_map[corrSector];
    list.forEach(function(s){h2+='<option value="'+esc(s)+'"'+(corrIndustry===s?' selected':'')+'>'+esc(s)+'</option>';});
    selI.innerHTML=h2;
  }
}

function renderCorrelation(d){
  var el=$('corr-results');if(!el)return;
  if(d.error){el.innerHTML='<div class="ne">'+d.error+'</div>';return;}
  var pairs=d.pairs||[];

  var modeLabel=d.mode==='ownership'?'By Ownership':d.mode==='industry'?'By Industry':'Custom';
  var h='<div style="font-size:12px;color:var(--t2);margin-bottom:8px">'+modeLabel+': '+pairs.length+' correlated pairs ('+d.tickers+' stocks, '+d.days+' days, r ≥ '+d.min_corr+')</div>';

  if(!pairs.length){
    h+='<div class="ne" style="padding:20px">No correlated pairs found. Try lowering min r or changing period.</div>';
    el.innerHTML=h;return;
  }

  h+='<div style="overflow-y:auto;max-height:calc(100vh - 320px)"><table class="bei-tbl" style="table-layout:fixed;width:100%"><colgroup>';
  h+='<col style="width:65px">';
  h+='<col style="width:65px">';
  h+='<col style="width:55px">';
  h+='<col style="width:170px">';
  h+='<col style="width:auto">';
  h+='</colgroup>';
  h+='<thead><tr>';
  h+='<th class="al">Stock A</th><th class="al">Stock B</th><th class="ar">Corr.</th><th class="al">Industry</th><th class="al">Common Owners</th></tr></thead><tbody>';

  pairs.forEach(function(p){
    var corrCls=p.corr>0.85?'up':p.corr<-0.5?'dn':'';
    var common=p.common_owners||[];

    h+='<tr>';
    h+='<td class="al"><span class="code" onclick="gsOpen(\''+esc(p.a)+'\')">'+esc(p.a)+'</span></td>';
    h+='<td class="al"><span class="code" onclick="gsOpen(\''+esc(p.b)+'\')">'+esc(p.b)+'</span></td>';
    h+='<td class="ar"><span class="'+corrCls+'" style="font-family:var(--fm);font-weight:700">'+p.corr.toFixed(2)+'</span></td>';
    h+='<td class="al" style="font-size:10px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(p.a_industry||'')+'">'+esc(p.a_industry||'')+'</td>';
    h+='<td class="al" style="font-size:10px;overflow:hidden">';
    if(common.length){
      h+=common.map(function(c){return'<span style="display:inline-block;padding:1px 5px;border-radius:3px;background:rgba(139,92,246,.1);color:#8b5cf6;font-size:9px;margin:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px" title="'+esc(c)+'">'+esc(c)+'</span>';}).join(' ');
    }else{h+='<span style="color:var(--t3)">—</span>';}
    h+='</td>';
    h+='</tr>';
  });

  h+='</tbody></table></div>';
  var note=d.mode==='ownership'?'Showing pairs that share at least 1 common owner (≥1% stake). Pearson r of daily returns.':d.mode==='industry'?'Showing pairs in the same industry. Pearson r of daily returns.':'Pearson r of daily returns. 1.0 = perfectly correlated.';
  h+='<div style="margin-top:8px;font-size:10px;color:var(--t3)">'+note+'</div>';
  el.innerHTML=h;
}

// ═══ Shared: Stock table for sector drill-down ═══
var secStockSort='mkt_cap',secStockDir='desc';
var secStockCols={code:true,industry:true,close:true,chg_pct:true,mkt_cap:true,per:true,roe:true,ytd:true,fnet_val:true};
var allStockCols=[
  {k:'code',l:'Code',al:'al'},{k:'industry',l:'Industry',al:'al'},{k:'close',l:'Close',al:'ar'},
  {k:'chg_pct',l:'Chg%',al:'ar'},{k:'mkt_cap',l:'Mkt Cap',al:'ar'},{k:'per',l:'PER',al:'ar'},
  {k:'roe',l:'ROE',al:'ar'},{k:'ytd',l:'YTD',al:'ar'},{k:'fnet_val',l:'F.Net',al:'ar'}
];

function sectorStockTable(stocks){
  var sorted=stocks.slice().sort(function(a,b){
    var va=a[secStockSort]||0,vb=b[secStockSort]||0;
    if(secStockSort==='code')return secStockDir==='asc'?(a.code||'').localeCompare(b.code||''):(b.code||'').localeCompare(a.code||'');
    return secStockDir==='asc'?va-vb:vb-va;
  });

  function sa(col){return secStockSort===col?(secStockDir==='asc'?' ▲':' ▼'):'';}
  function sc(col){return'secStockSort=\''+col+'\';secStockDir=secStockSort===\''+col+'\'&&secStockDir===\'desc\'?\'asc\':\'desc\';loadSectorView()';}

  // Column toggle
  var h='<div style="display:flex;gap:3px;margin-bottom:6px;flex-wrap:wrap">';
  allStockCols.forEach(function(c){
    if(c.k==='code')return; // always show code
    var on=secStockCols[c.k]!==false;
    h+='<button class="bei-sort-btn'+(on?' on':'')+'" onclick="secStockCols.'+c.k+'=!secStockCols.'+c.k+';loadSectorView()" style="padding:2px 6px;font-size:9px">'+c.l+'</button>';
  });
  h+='</div>';

  var visCols=allStockCols.filter(function(c){return c.k==='code'||secStockCols[c.k]!==false;});

  h+='<div style="overflow-x:auto"><table class="bei-tbl" style="width:100%"><thead><tr>';
  visCols.forEach(function(c){
    var style='cursor:pointer;user-select:none;white-space:nowrap';
    h+='<th class="'+c.al+'" style="'+style+'" onclick="'+sc(c.k)+'">'+c.l+sa(c.k)+'</th>';
  });
  h+='</tr></thead><tbody>';

  sorted.forEach(function(r){
    var cpCls=(r.chg_pct||0)>0?'up':(r.chg_pct||0)<0?'dn':'';
    var ytdCls=(r.ytd||0)>0?'up':(r.ytd||0)<0?'dn':'';
    var fnCls=(r.fnet_val||0)>0?'up':(r.fnet_val||0)<0?'dn':'';
    h+='<tr>';
    visCols.forEach(function(c){
      if(c.k==='code')h+='<td class="code al" onclick="gsOpen(\''+esc(r.code)+'\')">'+esc(r.code)+'</td>';
      else if(c.k==='industry')h+='<td class="al" style="font-size:10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.industry||'')+'</td>';
      else if(c.k==='close')h+='<td class="ar" style="font-family:var(--fm)">'+(r.close||0).toLocaleString()+'</td>';
      else if(c.k==='chg_pct')h+='<td class="ar '+cpCls+'" style="font-family:var(--fm)">'+(r.chg_pct>0?'+':'')+(r.chg_pct||0).toFixed(2)+'%</td>';
      else if(c.k==='mkt_cap')h+='<td class="ar" style="font-family:var(--fm)">'+fmtRp(r.mkt_cap||0)+'</td>';
      else if(c.k==='per')h+='<td class="ar" style="font-family:var(--fm)">'+(r.per||'-')+'</td>';
      else if(c.k==='roe')h+='<td class="ar" style="font-family:var(--fm)">'+(r.roe?r.roe+'%':'-')+'</td>';
      else if(c.k==='ytd')h+='<td class="ar '+ytdCls+'" style="font-family:var(--fm)">'+(r.ytd?(r.ytd>0?'+':'')+r.ytd.toFixed(1)+'%':'-')+'</td>';
      else if(c.k==='fnet_val')h+='<td class="ar '+fnCls+'" style="font-family:var(--fm);font-weight:600">'+fmtRp(r.fnet_val||0)+'</td>';
    });
    h+='</tr>';
  });
  h+='</tbody></table></div>';
  return h;
}