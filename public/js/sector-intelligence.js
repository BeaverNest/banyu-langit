// ═══ SECTOR INTELLIGENCE — Rotation, Flow Timeline, Correlation ═══
var secIntView='overview'; // overview | rotation | timeline | correlation
var secIntLevel='sector'; // sector | industry
var secIntMetric='fnet'; // fnet | avg_chg | value
var secIntWeeks=12;
var secIntCache={};
var secIntEmbedded = false; // true when loaded inside Market Intel (hide sub-nav)

// ── Main entry: replaces loadSectorView ──
async function loadSectorView(){
  var el=$('sector-content');if(!el)return;

  var h='';
  // Sub-navigation — only show when standalone (not embedded in Market Intel)
  if(!secIntEmbedded){
  h+='<div style="display:flex;align-items:center;gap:3px;padding:8px 12px;border-bottom:1px solid var(--b1);flex-wrap:wrap">';
  [{k:'overview',l:'📊 Overview'},{k:'rotation',l:'🔥 Rotation'},{k:'timeline',l:'📈 Flow Timeline'}].forEach(function(v){
    h+='<button class="bei-sort-btn'+(secIntView===v.k?' on':'')+'" onclick="secIntView=\''+v.k+'\';loadSectorView()" style="padding:5px 12px;font-size:11px">'+v.l+'</button>';
  });
  h+='</div>';
  }
  h+='<div id="sec-int-body" style="overflow-y:auto;height:calc(100% - '+(secIntEmbedded?'0':'40')+'px)"></div>';
  el.innerHTML=h;

  var body=$('sec-int-body');
  if(secIntView==='overview')await loadSecOverview(body);
  else if(secIntView==='rotation')await loadSecRotation(body);
  else if(secIntView==='timeline')await loadSecTimeline(body);
  else if(secIntView==='correlation')await loadSecCorrelation(body);
}

// ═══ 1. OVERVIEW — Sector Sankey Flow Diagram ═══
var sectorDrillSector='',sectorDrillIndustry='';
var sankeyMode='foreign'; // foreign | transaction
var tmCache=null;

async function loadSecOverview(el){
  el.innerHTML='<div style="padding:12px">'+skelRows(6)+'</div>';
  try{
    var url='/api/screener/sectors?treemap=1';
    if(sectorDrillSector)url+='&sector='+encodeURIComponent(sectorDrillSector);
    var r=await fetch(url);var d=await r.json();
    if(d.error){el.innerHTML='<div class="ne">'+d.error+'</div>';return;}
    tmCache=d;
    renderSankeyView(el,d);
  }catch(e){el.innerHTML='<div class="ne">Error: '+e.message+'</div>';}
}

function renderSankeyView(el,d){
  var h='';
  // Breadcrumb
  h+='<div style="padding:8px 12px;font-size:12px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--b1)">';
  h+='<span class="code" style="cursor:pointer" onclick="sectorDrillSector=\'\';sectorDrillIndustry=\'\';loadSectorView()">All Sectors</span>';
  if(sectorDrillSector){h+=' <span style="color:var(--t3)">›</span> <span style="font-weight:600">'+esc(sectorDrillSector)+'</span>';}
  if(d.snapshot_month)h+='<span style="flex:1"></span><span style="color:var(--t3);font-family:var(--fm);font-size:10px">BEI '+d.snapshot_month+'</span>';
  h+='</div>';

  // Mode toggle
  h+='<div style="display:flex;gap:6px;padding:8px 12px;align-items:center;border-bottom:1px solid var(--b1)">';
  h+='<span style="font-size:10px;color:var(--t3);font-weight:600">Mode:</span>';
  h+='<button class="bei-sort-btn'+(sankeyMode==='foreign'?' on':'')+'" onclick="sankeyMode=\'foreign\';renderSankeyView($(\'sec-int-body\'),tmCache)" style="padding:4px 12px;font-size:11px">🌍 Foreign Flow</button>';
  h+='<button class="bei-sort-btn'+(sankeyMode==='transaction'?' on':'')+'" onclick="sankeyMode=\'transaction\';renderSankeyView($(\'sec-int-body\'),tmCache)" style="padding:4px 12px;font-size:11px">💰 Transaction</button>';
  h+='<span style="flex:1"></span>';
  if(sankeyMode==='foreign')h+='<span style="font-size:9px;color:var(--t3)"><span style="color:#22c55e">━</span> Buy flow &nbsp; <span style="color:#ef4444">━</span> Sell flow</span>';
  else h+='<span style="font-size:9px;color:var(--t3)">Width = trading value proportion</span>';
  h+='</div>';

  h+='<div id="sankey-chart" style="padding:12px"></div>';
  el.innerHTML=h;

  var stocks=d.treemap||[];
  if(!stocks.length){$('sankey-chart').innerHTML='<div class="ne">No data</div>';return;}
  if(sectorDrillSector)stocks=stocks.filter(function(s){return s.sector===sectorDrillSector;});

  if(sankeyMode==='foreign')drawForeignSankey(stocks);
  else drawTransactionSankey(stocks);
}


// Sort state for sector overview
var secFlowSort='net',secFlowDir='desc';


// Sort state
var secFlowSort='net',secFlowDir='desc';


var secFlowSort='net',secFlowDir='desc';

function drawForeignSankey(stocks){
  var container=$('sankey-chart');if(!container)return;
  var groupKey=sectorDrillSector?'industry':'sector';
  var groups={};
  stocks.forEach(function(s){
    var gn=s[groupKey]||'Other';
    if(!groups[gn])groups[gn]={name:gn,fbuy:0,fsell:0,fnet:0,value:0};
    groups[gn].fbuy+=s.fbuy_val||0;
    groups[gn].fsell+=s.fsell_val||0;
    groups[gn].fnet+=s.fnet_val||0;
    groups[gn].value+=s.value||0;
  });
  var gList=Object.values(groups).filter(function(g){return g.fbuy>0||g.fsell>0;});

  // Sort
  var dir=secFlowDir==='desc'?-1:1;
  if(secFlowSort==='buy') gList.sort(function(a,b){return dir*(a.fbuy-b.fbuy);});
  else if(secFlowSort==='sell') gList.sort(function(a,b){return dir*(a.fsell-b.fsell);});
  else gList.sort(function(a,b){return dir*(a.fnet-b.fnet);});

  if(!gList.length){container.innerHTML='<div class="ne">No data</div>';return;}

  var totalBuy=gList.reduce(function(s,g){return s+g.fbuy;},0);
  var totalSell=gList.reduce(function(s,g){return s+g.fsell;},0);
  var totalNet=totalBuy-totalSell;
  var maxVal=Math.max.apply(null,gList.map(function(g){return Math.max(g.fbuy,g.fsell);}));

  var h='';

  // Summary cards
  h+='<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">';
  h+='<div style="flex:1;min-width:100px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:18px;font-weight:800;font-family:var(--fm);color:#22c55e">'+fmtRp(totalBuy)+'</div><div style="font-size:9px;color:var(--t3);margin-top:2px">FOREIGN BUY</div></div>';
  h+='<div style="flex:1;min-width:100px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:18px;font-weight:800;font-family:var(--fm);color:#ef4444">'+fmtRp(totalSell)+'</div><div style="font-size:9px;color:var(--t3);margin-top:2px">FOREIGN SELL</div></div>';
  var nc=totalNet>0?'#22c55e':'#ef4444';
  h+='<div style="flex:1;min-width:100px;background:'+(totalNet>0?'rgba(34,197,94,0.08)':'rgba(239,68,68,0.08)')+';border:1px solid '+(totalNet>0?'rgba(34,197,94,0.2)':'rgba(239,68,68,0.2)')+';border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:18px;font-weight:800;font-family:var(--fm);color:'+nc+'">'+fmtRp(totalNet)+'</div><div style="font-size:9px;color:var(--t3);margin-top:2px">NET FLOW</div></div>';
  h+='</div>';

  // Sort buttons
  h+='<div style="display:flex;gap:3px;margin-bottom:6px;align-items:center">';
  h+='<span style="font-size:10px;color:var(--t3);font-weight:600">Sort:</span>';
  ['net','buy','sell'].forEach(function(k){
    var lbl=k==='net'?'Net':k==='buy'?'Buy':'Sell';
    var arrow=secFlowSort===k?(secFlowDir==='desc'?' \u25BC':' \u25B2'):'';
    h+='<button class="bei-sort-btn'+(secFlowSort===k?' on':'')+'" onclick="secFlowSort=\''+k+'\';secFlowDir=secFlowSort===\''+k+'\'&&secFlowDir===\'desc\'?\'asc\':\'desc\';renderSankeyView($(\'sec-int-body\'),tmCache)" style="padding:2px 8px;font-size:10px">'+lbl+arrow+'</button>';
  });
  h+='</div>';

  // Butterfly chart — buy left ←|→ sell right
  h+='<div style="margin-bottom:8px">';
  // Header
  h+='<div style="display:flex;align-items:center;padding:0 0 4px;border-bottom:1px solid var(--b1)">';
  h+='<div style="width:130px"></div>';
  h+='<div style="flex:1;text-align:right;font-size:9px;color:#22c55e;font-weight:600">BUY \u2192</div>';
  h+='<div style="width:2px"></div>';
  h+='<div style="flex:1;text-align:left;font-size:9px;color:#ef4444;font-weight:600">\u2190 SELL</div>';
  h+='<div style="width:75px;text-align:right;font-size:9px;color:var(--t3);font-weight:600">NET</div>';
  h+='</div>';

  gList.forEach(function(g){
    var buyPct=maxVal>0?(g.fbuy/maxVal)*100:0;
    var sellPct=maxVal>0?(g.fsell/maxVal)*100:0;
    var isNet=g.fnet>0;
    var drillClick=sectorDrillSector?'':'sectorDrillSector=\''+esc(g.name).replace(/'/g,"\\'")+'\';loadSectorView()';

    h+='<div style="display:flex;align-items:center;padding:3px 0;cursor:'+(drillClick?'pointer':'default')+'" '+(drillClick?'onclick="'+drillClick+'" onmouseenter="this.style.background=\'var(--bgH)\'" onmouseleave="this.style.background=\'none\'"':'')+'>';
    // Name
    h+='<div style="width:130px;font-size:10px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:6px" title="'+esc(g.name)+'">'+esc(g.name)+'</div>';
    // Buy bar (right-aligned, grows left)
    h+='<div style="flex:1;display:flex;justify-content:flex-end;height:18px">';
    h+='<div style="width:'+buyPct+'%;background:rgba(34,197,94,0.3);border-radius:2px 0 0 2px;display:flex;align-items:center;justify-content:flex-start;padding:0 4px;min-width:'+(buyPct>0?'2px':'0')+'">';
    if(buyPct>20) h+='<span style="font-size:8px;font-family:var(--fm);color:#22c55e;white-space:nowrap">'+fmtRp(g.fbuy)+'</span>';
    h+='</div></div>';
    // Center divider
    h+='<div style="width:2px;height:18px;background:var(--b2);flex-shrink:0"></div>';
    // Sell bar (left-aligned, grows right)
    h+='<div style="flex:1;display:flex;justify-content:flex-start;height:18px">';
    h+='<div style="width:'+sellPct+'%;background:rgba(239,68,68,0.3);border-radius:0 2px 2px 0;display:flex;align-items:center;justify-content:flex-end;padding:0 4px;min-width:'+(sellPct>0?'2px':'0')+'">';
    if(sellPct>20) h+='<span style="font-size:8px;font-family:var(--fm);color:#ef4444;white-space:nowrap">'+fmtRp(g.fsell)+'</span>';
    h+='</div></div>';
    // Net value
    h+='<div style="width:75px;text-align:right;font-family:var(--fm);font-size:10px;font-weight:600;color:'+(isNet?'#22c55e':'#ef4444')+'">'+fmtRp(g.fnet)+'</div>';
    h+='</div>';
  });
  h+='</div>';

  // Stats
  h+='<div style="display:flex;gap:12px;padding:4px 0;font-size:10px;color:var(--t3)">';
  h+='<span>'+stocks.length+' stocks \u00b7 '+gList.length+' '+(sectorDrillSector?'industries':'sectors')+'</span>';
  h+='</div>';

  h+=buildStockTable(stocks, true);
  container.innerHTML=h;
  setTimeout(loadSecEnrichment, 50);
}

function drawTransactionSankey(stocks){
  var container=$('sankey-chart');if(!container)return;
  var groupKey=sectorDrillSector?'industry':'sector';
  var groups={};
  stocks.forEach(function(s){
    var gn=s[groupKey]||'Other';
    if(!groups[gn])groups[gn]={name:gn,value:0,fnet:0,count:0};
    groups[gn].value+=s.value||0;
    groups[gn].fnet+=s.fnet_val||0;
    groups[gn].count++;
  });
  var gList=Object.values(groups).filter(function(g){return g.value>0;}).sort(function(a,b){return b.value-a.value;});
  if(!gList.length){container.innerHTML='<div class="ne">No data</div>';return;}
  var totalVal=gList.reduce(function(s,g){return s+g.value;},0);
  var colors=['#0ea5e9','#22c55e','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#6366f1','#a855f7','#06b6d4','#84cc16','#e11d48','#0d9488'];

  // Donut
  var size=200,cx=size/2,cyc=size/2,r=80,ri=52;
  var svgD='<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'">';
  var startAngle=-Math.PI/2;
  gList.forEach(function(g,i){
    var pct=g.value/totalVal;var angle=pct*Math.PI*2;if(angle<0.01)return;var endAngle=startAngle+angle;
    var large=angle>Math.PI?1:0;var color=colors[i%colors.length];
    var x1=cx+r*Math.cos(startAngle),y1=cyc+r*Math.sin(startAngle);
    var x2=cx+r*Math.cos(endAngle),y2=cyc+r*Math.sin(endAngle);
    var ix1=cx+ri*Math.cos(endAngle),iy1=cyc+ri*Math.sin(endAngle);
    var ix2=cx+ri*Math.cos(startAngle),iy2=cyc+ri*Math.sin(startAngle);
    var drillAttr=sectorDrillSector?'':'onclick="sectorDrillSector=\''+esc(g.name)+'\';loadSectorView()"';
    svgD+='<path d="M'+x1+','+y1+' A'+r+','+r+' 0 '+large+',1 '+x2+','+y2+' L'+ix1+','+iy1+' A'+ri+','+ri+' 0 '+large+',0 '+ix2+','+iy2+'Z"';
    svgD+=' fill="'+color+'" stroke="var(--bg1)" stroke-width="1.5" style="cursor:pointer;transition:opacity .15s" onmouseenter="this.style.opacity=0.8" onmouseleave="this.style.opacity=1" '+drillAttr+'>';
    svgD+='<title>'+esc(g.name)+': '+fmtRp(g.value)+' ('+Math.round(pct*1000)/10+'%)</title></path>';
    startAngle=endAngle;
  });
  var topPct=gList.length?Math.round(gList[0].value/totalVal*1000)/10:0;
  svgD+='<text x="'+cx+'" y="'+(cyc-4)+'" text-anchor="middle" font-size="16" font-weight="800" fill="var(--t1)" font-family="var(--fm)">'+topPct+'%</text>';
  svgD+='<text x="'+cx+'" y="'+(cyc+12)+'" text-anchor="middle" font-size="9" fill="var(--t3)">'+esc(gList[0].name.length>12?gList[0].name.substring(0,11)+'\u2026':gList[0].name)+'</text>';
  svgD+='</svg>';

  // Legend (clickable)
  var legendH='<div style="display:flex;flex-direction:column;gap:3px;font-size:11px">';
  gList.forEach(function(g,i){
    var pct=Math.round(g.value/totalVal*1000)/10;var color=colors[i%colors.length];
    var drillAttr=sectorDrillSector?'':'onclick="sectorDrillSector=\''+esc(g.name)+'\';loadSectorView()" style="cursor:pointer"';
    legendH+='<div style="display:flex;align-items:center;gap:6px;padding:2px 0" '+drillAttr+'>';
    legendH+='<span style="width:10px;height:10px;border-radius:3px;background:'+color+';flex-shrink:0"></span>';
    legendH+='<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500">'+esc(g.name)+'</span>';
    legendH+='<span style="font-family:var(--fm);color:var(--t2);white-space:nowrap">'+fmtRp(g.value)+'</span>';
    legendH+='<span style="font-family:var(--fm);color:var(--t3);min-width:36px;text-align:right">'+pct+'%</span>';
    legendH+='</div>';
  });
  legendH+='</div>';

  var statsH='<div style="display:flex;gap:12px;padding:6px 0;font-size:10px;color:var(--t3)">';
  statsH+='<span>'+stocks.length+' stocks \u00b7 '+gList.length+' '+(sectorDrillSector?'industries':'sectors')+'</span>';
  statsH+='<span>Total: '+fmtRp(totalVal)+'</span></div>';

  var h='<div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap"><div>'+svgD+'</div><div style="flex:1;min-width:200px">'+legendH+'</div></div>';
  h+=statsH+buildStockTable(stocks, true);
  container.innerHTML=h;
  setTimeout(loadSecEnrichment, 50);
}

// ═══ SORTABLE STOCK TABLE ═══
var secTblSort='value',secTblDir='desc';

function secTblDoSort(key){
  if(secTblSort===key)secTblDir=secTblDir==='desc'?'asc':'desc';
  else{secTblSort=key;secTblDir='desc';}
  // Re-render just the table body
  if(tmCache)renderSankeyView($('sec-int-body'),tmCache);
}

function buildStockTable(stocks, withEnrichment){
  // Filter out inactive stocks (value=0, volume=0)
  var active = stocks.filter(function(s) { return (s.value || 0) > 0; });
  var sorted=active.slice();
  var dir=secTblDir==='desc'?-1:1;
  var sortFns={
    code:function(a,b){return dir*a.code.localeCompare(b.code);},
    close:function(a,b){return dir*((b.close||0)-(a.close||0));},
    chg:function(a,b){return dir*((b.chg_pct||0)-(a.chg_pct||0));},
    value:function(a,b){return dir*((b.value||0)-(a.value||0));},
    volume:function(a,b){return dir*((b.volume||0)-(a.volume||0));},
    freq:function(a,b){return dir*((b.frequency||0)-(a.frequency||0));},
    fbuy:function(a,b){return dir*(((b.fbuy_val||0))-((a.fbuy_val||0)));},
    fsell:function(a,b){return dir*(((b.fsell_val||0))-((a.fsell_val||0)));},
    fnet:function(a,b){return dir*((b.fnet_val||0)-(a.fnet_val||0));}
  };
  if(sortFns[secTblSort])sorted.sort(sortFns[secTblSort]);
  else sorted.sort(sortFns.value);

  var h = '';

  // ═══ Enrichment Panel (heatmap + industry PER/PBV) — inserted BEFORE stock table ═══
  if (withEnrichment) {
    h += '<div id="sec-enrichment" style="margin-top:12px"><div style="font-size:10px;color:var(--t3)">Loading sector data...</div></div>';
  }

  // ═══ Collapsible Stock Table ═══
  var inactive = stocks.length - active.length;
  h += '<div style="margin-top:12px">';
  h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer" onclick="var t=this.nextElementSibling;t.style.display=t.style.display===\'none\'?\'block\':\'none\';this.querySelector(\'.arrow\').textContent=t.style.display===\'none\'?\'▶\':\'▼\'">';
  h += '<span class="arrow" style="font-size:9px;color:var(--t3)">▼</span>';
  h += '<span style="font-size:11px;font-weight:700;color:var(--t1)">Stock Details</span>';
  h += '<span style="font-size:9px;color:var(--t3)">' + active.length + ' active' + (inactive ? ' · ' + inactive + ' inactive hidden' : '') + '</span>';
  h += '</div>';
  h += '<div>';

  function thh(key,label){
    var arrow=secTblSort===key?(secTblDir==='desc'?' \u25BC':' \u25B2'):'';
    var style=secTblSort===key?'color:var(--bl);':'';
    return '<th class="ar" style="cursor:pointer;user-select:none;'+style+'" onclick="secTblDoSort(\''+key+'\')">'+label+arrow+'</th>';
  }

  h+='<table class="bei-tbl" style="font-size:10px"><thead><tr>';
  h+='<th class="al" style="cursor:pointer" onclick="secTblDoSort(\'code\')">Code'+(secTblSort==='code'?(secTblDir==='desc'?' \u25BC':' \u25B2'):'')+'</th>';
  h+='<th class="al">'+(sectorDrillSector?'Industry':'Sector')+'</th>';
  h+=thh('close','Close');h+=thh('chg','Chg%');h+=thh('value','Value');h+=thh('freq','Freq');
  h+=thh('fnet','F.Net');
  h+='</tr></thead><tbody>';
  sorted.slice(0,50).forEach(function(s){
    var chg=s.chg_pct||0;var fn=s.fnet_val||0;
    h+='<tr>';
    h+='<td><span class="code" onclick="gsOpen(\''+esc(s.code)+'\')">'+esc(s.code)+'</span></td>';
    h+='<td class="name" style="font-size:9px">'+esc(sectorDrillSector?(s.industry||''):(s.sector||''))+'</td>';
    h+='<td class="ar" style="font-family:var(--fm)">'+(s.close||0).toLocaleString()+'</td>';
    h+='<td class="ar '+(chg>0?'up':chg<0?'dn':'')+'" style="font-family:var(--fm)">'+(chg>0?'+':'')+chg.toFixed(2)+'%</td>';
    h+='<td class="ar" style="font-family:var(--fm)">'+fmtRp(s.value||0)+'</td>';
    h+='<td class="ar" style="font-family:var(--fm)">'+(s.frequency||0).toLocaleString()+'</td>';
    h+='<td class="ar '+(fn>0?'up':fn<0?'dn':'')+'" style="font-family:var(--fm);font-weight:600">'+fmtRp(fn)+'</td>';
    h+='</tr>';
  });
  h+='</tbody></table></div></div>';
  return h;
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

    // Clickable name → go to Stock List filtered by sector/industry
    var clickAction=secIntLevel==='sector'?
      'miGoStockList(\''+esc(name).replace(/'/g,"\\'")+'\')'
      :'miGoStockList(\'\',\''+esc(name).replace(/'/g,"\\'")+'\')';

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

  var allV=[];
  visible.forEach(function(n){series[n].forEach(function(v){allV.push(v);});});
  if(!allV.length){
    chartEl.innerHTML='';
    renderTimelineLegend(legEl,sorted,series,colors,n2);
    return;
  }

  // ECharts render
  chartEl.style.height=H+'px';
  var c=BL.init(chartEl,'sec-timeline');if(!c){return;}
  var cats=weeks.map(function(w){return w.week_start;});
  var seriesArr=[];
  visible.forEach(function(name){
    var ci=sorted.indexOf(name);
    var clr=colors[ci%colors.length];
    var isChg=secTimeMetric==='avg_chg';
    seriesArr.push({
      name:name.replace('IDX Sector ',''),type:'line',data:series[name],symbol:'none',
      lineStyle:{width:2,color:clr},itemStyle:{color:clr},
      emphasis:{lineStyle:{width:3}}
    });
  });
  c.setOption({
    tooltip:{trigger:'axis',formatter:function(p){
      var h='<b>'+p[0].axisValue.substring(5)+'</b>';
      p.sort(function(a,b){return(b.value||0)-(a.value||0);});
      p.forEach(function(s){
        var v=s.value;var fmt=secTimeMetric==='avg_chg'?((v>0?'+':'')+v.toFixed(1)+'%'):BL.fmtRp(v);
        h+='<br><span style="color:'+s.color+'">●</span> '+s.seriesName+': <b>'+fmt+'</b>';
      });return h;
    }},
    grid:BL.grid({top:16,bottom:40,left:65,right:60}),
    dataZoom:BL.dataZoom(),
    xAxis:{type:'category',data:cats,axisLabel:{fontSize:7,formatter:function(v){return v.substring(5);}}},
    yAxis:{type:'value',axisLabel:{fontSize:8,formatter:function(v){return secTimeMetric==='avg_chg'?v.toFixed(1)+'%':BL.fmtRp(v);}}},
    series:seriesArr
  },true);

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
  // Detect if we're in standalone correlation tab or inside sectors
  var isStandalone=el.id==='correlation-content';
  window._corrReloadFn=isStandalone?loadCorrelationView:function(){secIntView='correlation';loadSectorView();};
  // Sub-tab bar
  var h='<div style="padding:8px 12px;display:flex;gap:3px;border-bottom:1px solid var(--b1)">';
  [{k:'ownership',l:'👥 By Ownership'},{k:'industry',l:'🏭 By Industry'},{k:'custom',l:'🔧 Custom'}].forEach(function(m){
    h+='<button class="bei-sort-btn'+(corrMode===m.k?' on':'')+'" onclick="corrMode=\''+m.k+'\';window._corrReloadFn()" style="padding:5px 12px;font-size:11px">'+m.l+'</button>';
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
  var rl='window._corrReloadFn()';
  var h='<div style="padding:6px 12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--b1)">';

  if(corrMode==='custom'){
    h+='<select id="corr-sector" class="bei-filter-sel" style="min-width:150px;font-size:11px" onchange="corrSector=this.value;corrIndustry=\'\';populateCorrDropdowns();'+rl+'"><option value="">All Sectors</option></select>';
    h+='<select id="corr-industry" class="bei-filter-sel" style="min-width:150px;font-size:11px" onchange="corrIndustry=this.value;'+rl+'"><option value="">All Industries</option></select>';
    h+='<span style="width:6px"></span>';
  }else{
    var desc=corrMode==='ownership'?'Pairs yang share pemilik sama (\u22651% ownership)':'Pairs di industri yang sama';
    h+='<span style="font-size:10px;color:var(--t3)">'+desc+'</span><span style="width:6px"></span>';
  }

  h+='<span style="font-size:10px;color:var(--t3)">Period:</span>';
  [{k:65,l:'3M'},{k:130,l:'6M'},{k:260,l:'1Y'},{k:520,l:'2Y'}].forEach(function(d){
    h+='<button class="bei-sort-btn'+(corrDays===d.k?' on':'')+'" onclick="corrDays='+d.k+';'+rl+'" style="padding:3px 8px;font-size:10px">'+d.l+'</button>';
  });
  h+='<span style="width:6px"></span>';
  h+='<span style="font-size:10px;color:var(--t3)">Min r:</span>';
  [0.5,0.6,0.7,0.8,0.9].forEach(function(m){
    h+='<button class="bei-sort-btn'+(corrMin===m?' on':'')+'" onclick="corrMin='+m+';'+rl+'" style="padding:3px 8px;font-size:10px">'+m+'</button>';
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
// ═══ Standalone Correlation View — for Analysis > Correlation sub-tab ═══
async function loadCorrelationView(){
  var el=$('correlation-content');if(!el)return;
  await loadSecCorrelation(el);
}
// ═══ SECTOR ENRICHMENT — Sectoral Movement Heatmap + Industry PER/PBV ═══
async function loadSecEnrichment() {
  var el = document.getElementById('sec-enrichment'); if (!el) return;
  var h = '';

  // 1. Sectoral Movement Heatmap
  try {
    var r = await fetch('/api/idx/sectoral?days=30');
    var sd = await r.json();
    if (sd.sectors && sd.sectors.length && sd.dates && sd.dates.length) {
      h += '<div style="border:1px solid var(--b1);border-radius:8px;overflow:hidden;margin-bottom:12px;background:var(--bg2)">';
      h += '<div style="padding:8px 12px;font-size:11px;font-weight:700;color:var(--t1);border-bottom:1px solid var(--b1)">📊 Sector Performance Heatmap (' + sd.dates.length + ' days)</div>';
      h += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:9px"><thead><tr>';
      h += '<th style="padding:3px 6px;text-align:left;font-size:8px;color:var(--t3);position:sticky;left:0;background:var(--bg2);z-index:1;min-width:80px">Sector</th>';
      // Show last 20 dates max
      var showDates = sd.dates.slice(-15);
      showDates.forEach(function(dt) {
        h += '<th style="padding:3px 3px;text-align:center;font-size:7px;color:var(--t3);white-space:nowrap;font-family:var(--fm)">' + dt.substring(5) + '</th>';
      });
      h += '</tr></thead><tbody>';
      sd.sectors.forEach(function(sec) {
        var shortSec = sec.replace(/^IDX Sector /i, '').replace(/^Composite Index/i, 'IHSG');
        h += '<tr><td style="padding:3px 6px;font-weight:600;font-size:9px;position:sticky;left:0;background:var(--bg2);z-index:1;white-space:nowrap">' + esc(shortSec) + '</td>';
        showDates.forEach(function(dt) {
          var val = sd.data[dt] && sd.data[dt][sec] != null ? sd.data[dt][sec] : null;
          if (val !== null) {
            var intensity = Math.min(1, Math.abs(val) / 3);
            var bg = val > 0 ? 'rgba(0,230,118,' + (intensity * 0.5) + ')' : val < 0 ? 'rgba(255,61,0,' + (intensity * 0.5) + ')' : 'transparent';
            var clr = val > 0 ? 'var(--gn)' : val < 0 ? 'var(--rd)' : 'var(--t3)';
            h += '<td style="padding:2px 3px;text-align:center;font-family:var(--fm);background:' + bg + ';color:' + clr + '">' + val.toFixed(1) + '</td>';
          } else {
            h += '<td style="padding:2px 3px;text-align:center;color:var(--t3)">-</td>';
          }
        });
        h += '</tr>';
      });
      h += '</tbody></table></div></div>';
    }
  } catch (e) { /* sectoral data not available */ }

  // 2. Industry PER/PBV Table
  try {
    var r2 = await fetch('/api/idx/industry-overview');
    var id = await r2.json();
    if (id.data && id.data.length) {
      h += '<div style="border:1px solid var(--b1);border-radius:8px;overflow:hidden;background:var(--bg2)">';
      h += '<div style="padding:8px 12px;font-size:11px;font-weight:700;color:var(--t1);border-bottom:1px solid var(--b1)">🏭 Industry Valuation';
      if (id.trade_date) h += ' <span style="font-size:9px;font-weight:400;color:var(--t3)">' + id.trade_date + '</span>';
      h += '</div>';
      h += '<div style="overflow-x:auto;max-height:300px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr>';
      h += '<th style="padding:4px 8px;text-align:left;font-size:8px;color:var(--t3);position:sticky;top:0;background:var(--bg2)">Industry</th>';
      h += '<th style="padding:4px 6px;text-align:right;font-size:8px;color:var(--t3);position:sticky;top:0;background:var(--bg2)">Members</th>';
      h += '<th style="padding:4px 6px;text-align:right;font-size:8px;color:var(--t3);position:sticky;top:0;background:var(--bg2)">PER</th>';
      h += '<th style="padding:4px 6px;text-align:right;font-size:8px;color:var(--t3);position:sticky;top:0;background:var(--bg2)">PBV</th>';
      h += '<th style="padding:4px 6px;text-align:right;font-size:8px;color:var(--t3);position:sticky;top:0;background:var(--bg2)">Mkt Cap</th>';
      h += '<th style="padding:4px 6px;text-align:right;font-size:8px;color:var(--t3);position:sticky;top:0;background:var(--bg2)">Value</th>';
      h += '</tr></thead><tbody>';
      id.data.forEach(function(r) {
        var perCls = r.per > 0 && r.per < 15 ? 'color:var(--gn)' : r.per > 30 ? 'color:var(--rd)' : '';
        var pbvCls = r.pbv > 0 && r.pbv < 1.5 ? 'color:var(--gn)' : r.pbv > 3 ? 'color:var(--rd)' : '';
        h += '<tr style="border-top:1px solid var(--b1)">';
        h += '<td style="padding:4px 8px;font-weight:600;white-space:nowrap">' + esc(r.industry || '') + '</td>';
        h += '<td style="padding:4px 6px;text-align:right;font-family:var(--fm)">' + (r.members || 0) + '</td>';
        h += '<td style="padding:4px 6px;text-align:right;font-family:var(--fm);font-weight:600;' + perCls + '">' + (r.per ? r.per.toFixed(1) : '-') + '</td>';
        h += '<td style="padding:4px 6px;text-align:right;font-family:var(--fm);font-weight:600;' + pbvCls + '">' + (r.pbv ? r.pbv.toFixed(2) : '-') + '</td>';
        h += '<td style="padding:4px 6px;text-align:right;font-family:var(--fm)">' + fmtRp(r.market_cap || 0) + '</td>';
        h += '<td style="padding:4px 6px;text-align:right;font-family:var(--fm)">' + fmtRp(r.value || 0) + '</td>';
        h += '</tr>';
      });
      h += '</tbody></table></div></div>';
    }
  } catch (e) { /* industry data not available */ }

  if (h) el.innerHTML = h;
  else el.innerHTML = '<div style="font-size:10px;color:var(--t3)">No sector enrichment data. Run Cron All sync to populate sectoral_movement & industry_trading tables.</div>';
}
