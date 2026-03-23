// Data Explorer — cross-asset overlay (ticker + sector + industry + konglomerat + custom/macro)
// V3: Correlation toggle fix, Dual Y-axis, Monthly interpolation
let cmpColors=['#0ea5e9','#ef4444','#22c55e','#f59e0b','#a855f7','#ec4899','#14b8a6','#f97316'];

let cmpRange='6m';
let cmpList=[];
let cmpAddType='ticker';
let cmpGroupCache={};
let cmpShowFlow=false;
let cmpShowCorr=false; // toggle rolling correlation panel + snapshot cards
let cmpCorrWindow=20; // rolling window (trading days)
let cmpDualAxis=false; // dual Y-axis for absolute price mode
let cmpAllData=null;
let cmpDates=null;
let cmpSparseKeys={};

var CMP_TYPES={
  ticker:{icon:'📊',label:'Ticker',color:'var(--bl)',bg:'var(--blB)',placeholder:'BBCA, TLKM...'},
  sector:{icon:'🏢',label:'Sector',color:'var(--gn)',bg:'var(--gnB)'},
  industry:{icon:'🏭',label:'Industry',color:'var(--am)',bg:'var(--amB)'},
  konglo:{icon:'👑',label:'Konglo',color:'#8b5cf6',bg:'rgba(139,92,246,.12)'}
};

function renderCompare(){
  var el=$('compare-content');if(!el)return;
  var h='<div style="padding:12px;font-family:var(--f)">';
  h+='<div style="font-weight:700;font-size:14px;margin-bottom:10px">🔬 Data Explorer</div>';

  // Add bar
  h+='<div class="cmp-input-bar" style="gap:4px">';
  h+='<div style="display:flex;gap:2px">';
  ['ticker','sector','industry','konglo'].forEach(function(t){
    var ct=CMP_TYPES[t],on=cmpAddType===t;
    h+='<button class="bei-sort-btn'+(on?' on':'')+'" onclick="cmpSetAddType(\''+t+'\')" style="padding:3px 8px;font-size:10px" title="Add '+ct.label+'">'+ct.icon+'</button>';
  });
  h+='</div>';
  if(cmpAddType==='ticker'){
    h+='<div style="position:relative">';
    h+='<input id="cmp-input" class="bei-filter-input" style="max-width:200px;text-transform:uppercase" placeholder="'+CMP_TYPES.ticker.placeholder+'" onkeydown="cmpInputKey(event)" oninput="cmpAutoComplete()" autocomplete="off">';
    h+='<div id="cmp-ac-dropdown" style="display:none;position:absolute;top:100%;left:0;width:300px;max-height:240px;overflow-y:auto;background:var(--bg1);border:1px solid var(--b2);border-radius:4px;z-index:999;box-shadow:0 4px 12px rgba(0,0,0,0.5)"></div>';
    h+='</div>';
    h+='<button class="bei-tab on" style="font-size:11px;padding:4px 10px" onclick="cmpAddTicker()">+ Add</button>';
  }else{
    h+='<select id="cmp-group-sel" class="bei-filter-sel" style="min-width:220px"><option value="">Loading...</option></select>';
    h+='<button class="bei-tab on" style="font-size:11px;padding:4px 10px" onclick="cmpAddFromDropdown()">+ Add</button>';
  }
  if(cmpList.length)h+='<button class="bei-filter-clear" onclick="cmpList=[];cmpAllData=null;renderCompare()">Clear</button>';
  h+='<span style="flex:1"></span><span style="font-size:10px;color:var(--t3)">Max 8 · Mix freely</span>';
  h+='</div>';

  // Chips
  if(cmpList.length){
    h+='<div class="cmp-chips">';
    cmpList.forEach(function(item,i){
      var ct=CMP_TYPES[item.type]||CMP_TYPES.ticker;
      h+='<span class="cmp-chip" style="border-color:'+cmpColors[i%8]+'"><span class="cmp-chip-dot" style="background:'+cmpColors[i%8]+'"></span><span style="font-size:8px;padding:0 4px;border-radius:3px;background:'+ct.bg+';color:'+ct.color+';font-weight:600;margin-right:2px">'+ct.icon+'</span>'+esc(item.name)+'<button class="cmp-chip-x" onclick="cmpList.splice('+i+',1);cmpAllData=null;renderCompare()">✕</button></span>';
    });
    h+='</div>';
  }

  // Range + Toggles
  h+='<div class="cmp-range-bar" style="align-items:center;flex-wrap:wrap;gap:3px">';
  [{k:'1m',l:'1M'},{k:'3m',l:'3M'},{k:'6m',l:'6M'},{k:'1y',l:'1Y'},{k:'3y',l:'3Y'},{k:'5y',l:'5Y'},{k:'all',l:'ALL'}].forEach(function(r){
    h+='<button class="bei-sort-btn'+(cmpRange===r.k?' on':'')+'" onclick="cmpRange=\''+r.k+'\';cmpAllData=null;renderCompare()">'+r.l+'</button>';
  });
  h+='<span style="width:1px;height:14px;background:var(--b2);margin:0 4px"></span>';
  h+='<button class="bei-sort-btn'+(cmpShowFlow?' on':'')+'" onclick="cmpShowFlow=!cmpShowFlow;renderCompare()" style="padding:3px 8px;font-size:10px">🌊 F.Net</button>';
  var dualDisabled=cmpList.length>2;
  var dualTitle=dualDisabled?'Dual Y-axis only works with exactly 2 items':'Dual Y-axis (absolute price, 2 items only)';
  var dualStyle=dualDisabled&&cmpDualAxis?'opacity:0.5;':'';
  h+='<button class="bei-sort-btn'+(cmpDualAxis?' on':'')+'" onclick="cmpDualAxis=!cmpDualAxis;renderCompare()" style="padding:3px 8px;font-size:10px;'+dualStyle+'" title="'+dualTitle+'">⚖ Dual-Y</button>';
  if(cmpList.length>=2){
    h+='<button class="bei-sort-btn'+(cmpShowCorr?' on':'')+'" onclick="cmpShowCorr=!cmpShowCorr;renderCompare()" style="padding:3px 8px;font-size:10px">📐 ρ Corr</button>';
  }
  h+='</div>';

  // Chart areas
  h+='<div id="cmp-chart" class="cmp-chart-area"></div>';
  h+='<div id="cmp-summary"></div></div>';
  el.innerHTML=h;

  if(cmpAddType!=='ticker')cmpLoadDropdown(cmpAddType);
  if(cmpList.length>=2){
    if(cmpAllData&&cmpDates)cmpRedraw(); // use cache for toggle (no re-fetch)
    else cmpLoadMixed();
  }
  else if(cmpList.length===1)$('cmp-chart').innerHTML='<div class="ne" style="padding:30px">Add 1 more to compare</div>';
  else $('cmp-chart').innerHTML='<div class="ne" style="padding:30px">Add 2+ items to compare<br><span style="font-size:11px;color:var(--t3)">Mix tickers, sectors, industries, commodities, and macro freely</span></div>';
}

function cmpSetAddType(t){cmpAddType=t;renderCompare();}

function cmpAddTicker(){
  var inp=$('cmp-input');if(!inp)return;
  var raw=inp.value.trim().toUpperCase();if(!raw)return;
  raw.split(',').forEach(function(code){
    code=code.trim();if(!code)return;
    if(cmpList.length>=8)return;
    if(cmpList.some(function(x){return x.type==='ticker'&&x.name===code;}))return;
    cmpList.push({type:'ticker',name:code});
  });
  inp.value='';cmpAllData=null;renderCompare();
}

function cmpAddFromDropdown(){
  var sel=$('cmp-group-sel');if(!sel||!sel.value)return;
  var name=sel.value;
  if(cmpList.length>=8){showT('⚠','Max 8');return;}
  if(cmpList.some(function(x){return x.type===cmpAddType&&x.name===name;}))return;
  cmpList.push({type:cmpAddType,name:name});sel.value='';cmpAllData=null;renderCompare();
}

async function cmpLoadDropdown(mode){
  var sel=$('cmp-group-sel');if(!sel)return;
  if(cmpGroupCache[mode]){cmpPopulateDropdown(sel,mode,cmpGroupCache[mode]);return;}
  try{var r=await fetch('/api/idx/compare-groups?mode='+mode);var d=await r.json();cmpGroupCache[mode]=d.items||[];cmpPopulateDropdown(sel,mode,cmpGroupCache[mode]);}catch(e){sel.innerHTML='<option value="">Error</option>';}
}

function cmpPopulateDropdown(sel,mode,items){
  var ct=CMP_TYPES[mode];var h='<option value="">Select '+ct.label+'...</option>';
  items.forEach(function(item){
    if(cmpList.some(function(x){return x.type===mode&&x.name===item.name;}))return;
    var extra=item.count?' ('+item.count+')':'';var label=item.name;
    if(mode==='konglo'&&item.key_person)label+=' — '+item.key_person;
    if(mode==='konglo'&&item.category)extra=' · '+item.category+extra;
    h+='<option value="'+esc(item.name)+'">'+esc(label)+extra+'</option>';
  });sel.innerHTML=h;
}

// ═══ INTERPOLATE SPARSE DATA ═══
// For monthly/quarterly custom tickers: step-fill gaps (hold previous value)
function cmpInterpolate(dataArr, allDates){
  if(!dataArr||!dataArr.length)return dataArr;
  // Build date→close map from original data
  var map={};dataArr.forEach(function(r){map[r.trade_date]=r;});
  // Check sparseness: if data covers < 40% of allDates, it's sparse
  var coverage=0;allDates.forEach(function(d){if(map[d])coverage++;});
  var ratio=allDates.length>0?coverage/allDates.length:1;
  if(ratio>0.4)return dataArr; // dense enough, no interpolation needed

  // Step interpolation: hold last known value forward until next reading
  // More appropriate than linear for macro data (inflation constant per period)
  var knownDates=dataArr.map(function(r){return r.trade_date;}).sort();
  var result=[];
  var lastKnown=null;
  var ki=0;
  for(var i=0;i<allDates.length;i++){
    var d=allDates[i];
    // Advance known-date pointer
    while(ki<knownDates.length&&knownDates[ki]<=d){
      lastKnown=map[knownDates[ki]];
      ki++;
    }
    if(map[d]){
      result.push(map[d]);
    }else if(lastKnown){
      result.push({trade_date:d,close:lastKnown.close,fnet_val:0,_interpolated:true});
    }
    // else: before first known point — no data yet
  }
  return result;
}

// ═══ LOAD DATA ═══
async function cmpLoadMixed(){
  var chartEl=$('cmp-chart'),sumEl=$('cmp-summary');if(!chartEl)return;
  chartEl.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">Loading...</div>';
  if(sumEl)sumEl.innerHTML='';

  try{
    var allData={};
    var tickerItems=cmpList.filter(function(x){return x.type==='ticker';});
    var groupItems=cmpList.filter(function(x){return x.type!=='ticker';});

    await Promise.all(tickerItems.map(async function(item){
      var key=cmpItemKey(item);
      var r=await fetch('/api/idx/flow?code='+encodeURIComponent(item.name));var d=await r.json();
      allData[key]=(d.data||[]).map(function(r){return{trade_date:r.trade_date,close:r.close,fnet_val:(r.foreign_buy-r.foreign_sell)*r.close||r.foreign_net_val||0};});
    }));

    var byType={};
    groupItems.forEach(function(item){if(!byType[item.type])byType[item.type]=[];byType[item.type].push(item.name);});
    await Promise.all(Object.keys(byType).map(async function(type){
      var names=byType[type];
      var r=await fetch('/api/idx/compare-group?mode='+type+'&groups='+encodeURIComponent(names.join(',')));var d=await r.json();
      if(d.error)return;var groups=d.groups||{};
      names.forEach(function(name){
        var key=cmpItemKey({type:type,name:name});var g=groups[name];
        if(g&&g.data)allData[key]=g.data.map(function(r){return{trade_date:r.trade_date,close:r.avg_close,fnet_val:r.total_fnet_val||0,count:r.count,tickers:g.tickers};});
        else allData[key]=[];
      });
    }));

    var allDatesSet=new Set();
    cmpList.forEach(function(item){(allData[cmpItemKey(item)]||[]).forEach(function(r){allDatesSet.add(r.trade_date);});});
    var dates=Array.from(allDatesSet).sort();
    if(dates.length<2){chartEl.innerHTML='<div class="ne">Not enough data</div>';return;}

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
      cmpList.forEach(function(item){var key=cmpItemKey(item);allData[key]=(allData[key]||[]).filter(function(r){return r.trade_date>=cutStr;});});
    }
    if(dates.length<2){chartEl.innerHTML='<div class="ne">Not enough data for this range</div>';return;}

    // Interpolate sparse data (monthly/quarterly custom tickers)
    var sparseKeys={};
    cmpList.forEach(function(item){
      var key=cmpItemKey(item);
      var orig=allData[key]||[];
      var interp=cmpInterpolate(orig,dates);
      if(interp.length>orig.length)sparseKeys[key]=true;
      allData[key]=interp;
    });

    cmpAllData=allData;cmpDates=dates;cmpSparseKeys=sparseKeys;
    cmpRedraw();
  }catch(e){chartEl.innerHTML='<div class="ne">Error: '+e.message+'</div>';}
}

// ═══ REDRAW ═══
function cmpRedraw(){
  if(!cmpAllData||!cmpDates)return;
  var chartEl=$('cmp-chart'),sumEl=$('cmp-summary');if(!chartEl)return;
  var allData=cmpAllData,dates=cmpDates;

  // % Change series (normalized)
  var series={},absMap={};
  cmpList.forEach(function(item){
    var key=cmpItemKey(item);
    var map={};(allData[key]||[]).forEach(function(r){map[r.trade_date]=r.close;});
    absMap[key]=map;
    var fc=null;
    series[key]=dates.map(function(d){var c=map[d];if(c&&!fc)fc=c;if(!c||!fc)return null;return Math.round((c-fc)/fc*10000)/100;});
  });

  var flowSeries=cmpShowFlow?cmpBuildFlowSeries(allData,dates):null;
  var hasCorr=cmpShowCorr&&cmpList.length>=2;
  // Auto-set correlation window based on range
  if(hasCorr){
    var rangeWindowMap={'1m':10,'3m':15,'6m':20,'1y':30,'3y':40,'5y':60,'all':60};
    cmpCorrWindow=rangeWindowMap[cmpRange]||20;
  }
  cmpDrawChart(chartEl,dates,series,absMap,flowSeries,hasCorr?absMap:null);

  cmpRenderSummary(sumEl,allData,dates,absMap);
}

// ═══ PEARSON CORRELATION ═══
function cmpPearson(x,y){
  var n=x.length;if(n<5)return null;
  var sx=0,sy=0,sxx=0,syy=0,sxy=0;
  for(var i=0;i<n;i++){sx+=x[i];sy+=y[i];sxx+=x[i]*x[i];syy+=y[i]*y[i];sxy+=x[i]*y[i];}
  var denom=Math.sqrt((n*sxx-sx*sx)*(n*syy-sy*sy));
  if(denom===0)return 0;
  return Math.round((n*sxy-sx*sy)/denom*10000)/10000;
}

// ═══ MAIN CHART (with optional flow + correlation sub-grids + dual Y-axis) ═══
function cmpDrawChart(chartEl,dates,series,absMap,flowSeries,corrAbsMap){
  var hasFlow=cmpShowFlow&&flowSeries&&Object.keys(flowSeries).length>0;
  var hasCorr=!!corrAbsMap;
  var subCount=(hasFlow?1:0)+(hasCorr?1:0);
  var H=subCount===2?620:subCount===1?520:450;
  chartEl.style.height=H+'px';
  var c=BL.init(chartEl,'cmp-chart');if(!c)return;

  // Layout percentages
  var mainBottom,flowTop,flowBottom,corrTop,corrBottom;
  if(subCount===0){mainBottom=40;}
  else if(subCount===1){mainBottom='54%';if(hasFlow){flowTop='50%';flowBottom=36;}else{corrTop='50%';corrBottom=36;}}
  else{mainBottom='40%';flowTop='44%';flowBottom='30%';corrTop='56%';corrBottom=36;}

  var grids=[BL.grid({top:24,bottom:mainBottom,left:55,right:cmpDualAxis?60:60})];
  var xAxes=[{type:'category',data:dates,gridIndex:0,show:subCount===0,axisLabel:{fontSize:7,formatter:function(v){return v.substring(5);}}}];
  var yAxes=[];
  var allSeries=[];
  var gIdx=1;

  // ═══ DUAL Y-AXIS MODE (only for exactly 2 items) ═══
  if(cmpDualAxis&&cmpList.length===2){
    // Left Y-axis: first item absolute price
    // Right Y-axis: second item absolute price
    var cmpYFmt=function(v){
      if(Math.abs(v)>=1e9)return(v/1e9).toFixed(1)+'B';
      if(Math.abs(v)>=1e6)return(v/1e6).toFixed(1)+'M';
      if(Math.abs(v)>=1e3)return(v/1e3).toFixed(1)+'K';
      return v.toFixed(v<100?2:0);
    };

    yAxes.push({type:'value',gridIndex:0,position:'left',
      axisLabel:{fontSize:8,color:cmpColors[0],formatter:cmpYFmt},
      splitLine:{lineStyle:{color:'#1e2836',type:'dashed'}},
      axisLine:{show:true,lineStyle:{color:cmpColors[0]}}
    });

    yAxes.push({type:'value',gridIndex:0,position:'right',
      axisLabel:{fontSize:8,color:cmpColors[1],formatter:cmpYFmt},
      splitLine:{show:false},
      axisLine:{show:true,lineStyle:{color:cmpColors[1]}}
    });

    cmpList.forEach(function(item,ci){
      var key=cmpItemKey(item),map=absMap[key]||{},clr=cmpColors[ci%8];
      var labelName=item.name.length>12?item.name.substring(0,12)+'…':item.name;
      var absData=dates.map(function(d){return map[d]||null;});
      var isSparse=!!cmpSparseKeys[key];
      var seriesOpt={name:labelName,type:'line',data:absData,symbol:isSparse?'circle':'none',
        symbolSize:isSparse?4:0,
        lineStyle:{width:2.5,color:clr},itemStyle:{color:clr},
        xAxisIndex:0,yAxisIndex:ci,connectNulls:true};
      if(isSparse)seriesOpt.step='end';
      allSeries.push(seriesOpt);
    });
    gIdx=1;
  }else{
    // ═══ NORMALIZED MODE (default) ═══
    yAxes.push({type:'value',gridIndex:0,axisLabel:{fontSize:8,formatter:function(v){return(v>0?'+':'')+v.toFixed(1)+'%';}},splitLine:{lineStyle:{color:'#1e2836',type:'dashed'}}});

    cmpList.forEach(function(item,ci){
      var key=cmpItemKey(item),clr=cmpColors[ci%8];
      var labelName=item.name.length>12?item.name.substring(0,12)+'…':item.name;
      var isSparse=!!cmpSparseKeys[key];
      var seriesOpt={name:labelName,type:'line',data:series[key]||[],symbol:isSparse?'circle':'none',
        symbolSize:isSparse?4:0,
        lineStyle:{width:2.5,color:clr},itemStyle:{color:clr},
        xAxisIndex:0,yAxisIndex:0,connectNulls:true};
      if(isSparse)seriesOpt.step='end';
      allSeries.push(seriesOpt);
    });
  }

  // Flow sub-grid
  if(hasFlow){
    grids.push({left:55,right:60,top:flowTop,bottom:flowBottom});
    xAxes.push({type:'category',data:dates,gridIndex:gIdx,show:!hasCorr,axisLabel:{fontSize:7,formatter:function(v){return v.substring(5);}}});
    yAxes.push({type:'value',gridIndex:gIdx,axisLabel:{fontSize:8,formatter:function(v){return BL.fmtRp(v);}},splitLine:{lineStyle:{color:'#1e2836',type:'dashed'}}});
    var flowYIdx=yAxes.length-1;
    cmpList.forEach(function(item,ci){
      var key=cmpItemKey(item),clr=cmpColors[ci%8];
      var labelName=(item.name.length>12?item.name.substring(0,12)+'…':item.name)+' F.Net';
      allSeries.push({name:labelName,type:'line',data:flowSeries[key]||[],symbol:'none',lineStyle:{width:1.5,color:clr,opacity:0.7},itemStyle:{color:clr},xAxisIndex:gIdx,yAxisIndex:flowYIdx});
    });
    gIdx++;
  }

  // Correlation sub-grid
  if(hasCorr){
    var win=cmpCorrWindow;
    var corrColors2=['#f59e0b','#a855f7','#ec4899','#14b8a6','#0ea5e9','#22c55e'];

    // Build daily returns
    var retMap={};
    cmpList.forEach(function(item){
      var key=cmpItemKey(item),map=corrAbsMap[key]||{};
      retMap[key]=[];
      for(var i=1;i<dates.length;i++){
        var cur=map[dates[i]],prev=map[dates[i-1]];
        retMap[key].push(cur&&prev&&prev>0?(cur-prev)/prev:null);
      }
    });

    // Pad rolling data to align with main dates (first value has no return)
    var pairIdx=0;
    var corrYIdx=yAxes.length; // will be pushed next
    for(var i=0;i<cmpList.length;i++){
      for(var j=i+1;j<cmpList.length;j++){
        var ki=cmpItemKey(cmpList[i]),kj=cmpItemKey(cmpList[j]);
        var ri=retMap[ki],rj=retMap[kj];
        var rolling=[null]; // first date has no return
        for(var d=0;d<ri.length;d++){
          if(d<win-1){rolling.push(null);continue;}
          var xi=[],yi=[];
          for(var w=d-win+1;w<=d;w++){if(ri[w]!==null&&rj[w]!==null){xi.push(ri[w]);yi.push(rj[w]);}}
          rolling.push(xi.length>=5?cmpPearson(xi,yi):null);
        }
        var pairName=cmpList[i].name+'×'+cmpList[j].name;
        if(pairName.length>20)pairName=cmpList[i].name.substring(0,6)+'×'+cmpList[j].name.substring(0,6);
        allSeries.push({name:'ρ '+pairName,type:'line',data:rolling,symbol:'none',lineStyle:{width:1.8,color:corrColors2[pairIdx%corrColors2.length]},itemStyle:{color:corrColors2[pairIdx%corrColors2.length]},xAxisIndex:gIdx,yAxisIndex:corrYIdx});
        pairIdx++;
      }
    }

    // Reference lines
    allSeries.push({type:'line',data:dates.map(function(){return 0.7;}),symbol:'none',lineStyle:{width:1,color:'rgba(34,197,94,0.25)',type:'dashed'},xAxisIndex:gIdx,yAxisIndex:corrYIdx,silent:true,tooltip:{show:false}});
    allSeries.push({type:'line',data:dates.map(function(){return 0;}),symbol:'none',lineStyle:{width:1,color:'rgba(255,255,255,0.08)'},xAxisIndex:gIdx,yAxisIndex:corrYIdx,silent:true,tooltip:{show:false}});
    allSeries.push({type:'line',data:dates.map(function(){return -0.3;}),symbol:'none',lineStyle:{width:1,color:'rgba(239,68,68,0.25)',type:'dashed'},xAxisIndex:gIdx,yAxisIndex:corrYIdx,silent:true,tooltip:{show:false}});

    grids.push({left:55,right:60,top:corrTop,bottom:corrBottom});
    xAxes.push({type:'category',data:dates,gridIndex:gIdx,axisLabel:{fontSize:7,formatter:function(v){return v.substring(5);}}});
    yAxes.push({type:'value',gridIndex:gIdx,min:-1,max:1,splitNumber:4,axisLabel:{fontSize:8,formatter:function(v){return v.toFixed(1);}},splitLine:{lineStyle:{color:'#1e2836',type:'dashed'}}});
    gIdx++;
  }

  // Shared dataZoom across all grids
  var xIdxAll=[];for(var xi=0;xi<xAxes.length;xi++)xIdxAll.push(xi);

  c.setOption({
    tooltip:{trigger:'axis',textStyle:{fontSize:10},formatter:function(params){
      if(!params||!params.length)return'';
      var d=params[0].axisValue;
      var h='<div style="font-size:10px;color:#888;margin-bottom:3px">'+d+'</div>';
      params.forEach(function(p){
        var v=p.value;if(v===null||v===undefined)return;
        var sn=p.seriesName||'';
        if(sn.indexOf('ρ ')===0){
          var color=v>0.7?'#22c55e':v>0.3?'#f59e0b':v>-0.3?'#888':v>-0.7?'#f97316':'#ef4444';
          h+='<div style="display:flex;align-items:center;gap:4px;font-size:10px"><span style="width:8px;height:8px;border-radius:50%;background:'+p.color+'"></span>'+sn+'<span style="font-weight:700;margin-left:auto;color:'+color+'">'+v.toFixed(3)+'</span></div>';
        }else if(sn.indexOf('F.Net')>=0){
          h+='<div style="display:flex;align-items:center;gap:4px;font-size:10px"><span style="width:8px;height:8px;border-radius:50%;background:'+p.color+'"></span>'+sn+'<span style="font-weight:700;margin-left:auto">'+BL.fmtRp(v)+'</span></div>';
        }else if(cmpDualAxis&&cmpList.length===2){
          var fmt=Math.abs(v)>=1e6?BL.fmtRp(v):v.toLocaleString(undefined,{maximumFractionDigits:2});
          h+='<div style="display:flex;align-items:center;gap:4px;font-size:10px"><span style="width:8px;height:8px;border-radius:50%;background:'+p.color+'"></span>'+sn+'<span style="font-weight:700;margin-left:auto">'+fmt+'</span></div>';
        }else{
          // Normalized mode: show % change + actual value for context
          var absVal='';
          try{
            var item=cmpList[p.seriesIndex];
            if(item){var key=cmpItemKey(item);var av=absMap[key]?absMap[key][d]:null;if(av!=null)absVal=' <span style="color:#888;font-weight:400">('+av.toLocaleString(undefined,{maximumFractionDigits:2})+')</span>';}
          }catch(e){}
          h+='<div style="display:flex;align-items:center;gap:4px;font-size:10px"><span style="width:8px;height:8px;border-radius:50%;background:'+p.color+'"></span>'+sn+'<span style="font-weight:700;margin-left:auto">'+(v>0?'+':'')+v.toFixed(2)+'%'+absVal+'</span></div>';
        }
      });
      return h;
    }},
    legend:{top:2,left:8,textStyle:{fontSize:8}},
    grid:grids,xAxis:xAxes,yAxis:yAxes,
    axisPointer:{link:[{xAxisIndex:xIdxAll}]},
    dataZoom:[{type:'inside',xAxisIndex:xIdxAll},{type:'slider',height:14,bottom:2,xAxisIndex:xIdxAll,borderColor:'#2a3444',fillerColor:'rgba(84,112,198,0.15)',textStyle:{fontSize:7,color:'#6b7a8d'}}],
    series:allSeries
  },true);
}

// ═══ SUMMARY + CORRELATION SNAPSHOT ═══
function cmpRenderSummary(sumEl,allData,dates,absMap){
  if(!sumEl)return;
  var sh='';

  // Correlation snapshot cards — ONLY show when cmpShowCorr is active
  if(cmpShowCorr&&cmpList.length>=2){
    var returns={};
    cmpList.forEach(function(item){
      var key=cmpItemKey(item),map=absMap[key]||{},rets=[];
      for(var i=1;i<dates.length;i++){var c=map[dates[i]],p=map[dates[i-1]];rets.push(c&&p&&p>0?{r:(c-p)/p}:{r:null});}
      returns[key]=rets;
    });

    var corrs=[];
    for(var i=0;i<cmpList.length;i++){
      for(var j=i+1;j<cmpList.length;j++){
        var ki=cmpItemKey(cmpList[i]),kj=cmpItemKey(cmpList[j]);
        var ri=returns[ki]||[],rj=returns[kj]||[];
        var xi=[],yi=[];
        for(var d=0;d<ri.length;d++){if(ri[d].r!==null&&rj[d]&&rj[d].r!==null){xi.push(ri[d].r);yi.push(rj[d].r);}}
        corrs.push({a:cmpList[i].name,b:cmpList[j].name,corr:cmpPearson(xi,yi),n:xi.length,ci:i,cj:j});
      }
    }

    if(corrs.length){
      sh+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;padding:6px 0;border-top:1px solid var(--b1)">';
      corrs.forEach(function(c){
        var v=c.corr;
        var color=v===null?'var(--t3)':v>0.7?'#22c55e':v>0.3?'#f59e0b':v>-0.3?'var(--t2)':v>-0.7?'#f97316':'#ef4444';
        var bg=v===null?'var(--bgH)':v>0.7?'rgba(34,197,94,0.08)':v<-0.3?'rgba(239,68,68,0.08)':'var(--bgH)';
        var label=v===null?'N/A':v.toFixed(3);
        var interp=v===null?'':v>0.7?'Strong +':v>0.3?'Moderate +':v>-0.3?'Weak':v>-0.7?'Moderate −':'Strong −';
        sh+='<div style="padding:6px 10px;border-radius:6px;border:1px solid var(--b1);background:'+bg+';min-width:120px;text-align:center">';
        sh+='<div style="font-size:9px;color:var(--t3);margin-bottom:2px"><span style="color:'+cmpColors[c.ci%8]+';font-weight:700">'+esc(c.a)+'</span> × <span style="color:'+cmpColors[c.cj%8]+';font-weight:700">'+esc(c.b)+'</span></div>';
        sh+='<div style="font-size:16px;font-weight:800;font-family:var(--fm);color:'+color+'">'+label+'</div>';
        sh+='<div style="font-size:8px;color:'+color+'">'+interp+'</div>';
        sh+='<div style="font-size:8px;color:var(--t3)">'+c.n+' obs</div></div>';
      });
      sh+='</div>';
    }
  }

  // Summary cards
  sh+='<div class="cmp-summary-grid">';
  cmpList.forEach(function(item,ci){
    var key=cmpItemKey(item),data=allData[key];if(!data||!data.length)return;
    // Use non-interpolated endpoints for accurate summary
    var origData=(data||[]).filter(function(r){return !r._interpolated;});
    var f=origData.length?origData[0]:data[0];
    var l=origData.length?origData[origData.length-1]:data[data.length-1];
    var pct=f.close?((l.close-f.close)/f.close*100):0;
    var cls=pct>0?'up':pct<0?'dn':'';
    var totalFnet=data.reduce(function(s,r){return s+(r._interpolated?0:(r.fnet_val||0));},0);
    var fnetCls=totalFnet>0?'up':totalFnet<0?'dn':'';
    var ct=CMP_TYPES[item.type]||CMP_TYPES.ticker;
    var clickAttr=item.type==='ticker'?' onclick="gsOpen(\''+esc(item.name)+'\')" style="cursor:pointer"':'';
    sh+='<div class="cmp-summary-card"'+clickAttr+'>';
    sh+='<div class="cmp-sc-head"><span class="cmp-sc-dot" style="background:'+cmpColors[ci%8]+'"></span><span style="font-size:8px;padding:1px 5px;border-radius:3px;background:'+ct.bg+';color:'+ct.color+';font-weight:600">'+ct.icon+'</span><span class="cmp-sc-code">'+esc(item.name)+'</span></div>';
    sh+='<div class="cmp-sc-pct '+cls+'">'+(pct>0?'+':'')+pct.toFixed(2)+'%</div>';
    if(item.type==='ticker')sh+='<div class="cmp-sc-detail">'+f.close.toLocaleString()+' → '+l.close.toLocaleString()+'</div>';
    else{sh+='<div class="cmp-sc-detail">Avg '+Math.round(f.close).toLocaleString()+' → '+Math.round(l.close).toLocaleString();if(l.tickers)sh+=' · '+l.tickers+' stocks';sh+='</div>';}
    sh+='<div class="cmp-sc-detail '+fnetCls+'">F.Net: '+fmtRp(totalFnet)+'</div></div>';
  });
  sh+='</div>';
  sumEl.innerHTML=sh;
}

function cmpItemKey(item){return item.type+':'+item.name;}

function cmpBuildFlowSeries(allData,dates){
  var fs={};
  cmpList.forEach(function(item){
    var key=cmpItemKey(item),data=allData[key]||[];if(!data.length)return;
    var map={};data.forEach(function(r){if(!r._interpolated)map[r.trade_date]=r.fnet_val||0;});
    var cum=0;fs[key]=dates.map(function(d){cum+=map[d]||0;return cum;});
  });return fs;
}

// ═══ AUTOCOMPLETE — ticker search dropdown ═══
var _cmpAcTimer=null,_cmpAcIdx=-1,_cmpAcItems=[];

function cmpAutoComplete(){
  clearTimeout(_cmpAcTimer);
  var inp=$('cmp-input');if(!inp)return;
  var q=inp.value.trim();
  if(q.length<1){cmpAcHide();return;}
  _cmpAcTimer=setTimeout(function(){cmpAcFetch(q);},150);
}

async function cmpAcFetch(q){
  try{
    var r=await fetch('/api/idx/autocomplete?q='+encodeURIComponent(q)+'&limit=12');
    _cmpAcItems=await r.json();
    _cmpAcIdx=-1;
    cmpAcRender();
  }catch(e){cmpAcHide();}
}

function cmpAcRender(){
  var dd=$('cmp-ac-dropdown');if(!dd)return;
  if(!_cmpAcItems.length){cmpAcHide();return;}
  var h='';
  _cmpAcItems.forEach(function(item,i){
    var bg=i===_cmpAcIdx?'var(--bgH)':'transparent';
    var typeColor=item.type==='index'?'var(--am)':item.type==='custom'?'var(--bl)':'var(--t3)';
    h+='<div class="cmp-ac-item" data-idx="'+i+'" style="padding:6px 10px;cursor:pointer;background:'+bg+';border-bottom:1px solid var(--b1);display:flex;align-items:center;gap:8px" onmouseenter="this.style.background=\'var(--bgH)\'" onmouseleave="this.style.background=\''+bg+'\'" onclick="cmpAcSelect('+i+')">';
    h+='<span style="font-weight:700;font-family:var(--fm);color:var(--bl);min-width:60px;font-size:12px">'+esc(item.code)+'</span>';
    h+='<span style="flex:1;font-size:11px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(item.name||'')+'</span>';
    h+='<span style="font-size:9px;color:'+typeColor+';text-transform:uppercase">'+esc(item.type||'')+'</span>';
    h+='</div>';
  });
  dd.innerHTML=h;
  dd.style.display='block';
}

function cmpAcSelect(idx){
  var item=_cmpAcItems[idx];if(!item)return;
  var inp=$('cmp-input');if(inp)inp.value=item.code;
  cmpAcHide();
  cmpAddTicker();
}

function cmpAcHide(){
  var dd=$('cmp-ac-dropdown');if(dd){dd.style.display='none';dd.innerHTML='';}
  _cmpAcIdx=-1;_cmpAcItems=[];
}

function cmpInputKey(e){
  var dd=$('cmp-ac-dropdown');
  if(dd&&dd.style.display==='block'&&_cmpAcItems.length){
    if(e.key==='ArrowDown'){e.preventDefault();_cmpAcIdx=Math.min(_cmpAcIdx+1,_cmpAcItems.length-1);cmpAcRender();return;}
    if(e.key==='ArrowUp'){e.preventDefault();_cmpAcIdx=Math.max(_cmpAcIdx-1,0);cmpAcRender();return;}
    if(e.key==='Enter'&&_cmpAcIdx>=0){e.preventDefault();cmpAcSelect(_cmpAcIdx);return;}
    if(e.key==='Escape'){cmpAcHide();return;}
  }
  if(e.key==='Enter')cmpAddTicker();
}

// Close dropdown when clicking outside
document.addEventListener('click',function(e){
  if(!e.target.closest('#cmp-input')&&!e.target.closest('#cmp-ac-dropdown'))cmpAcHide();
});

Object.defineProperty(window,'cmpTickers',{
  get:function(){return cmpList.filter(function(x){return x.type==='ticker';}).map(function(x){return x.name;});},
  set:function(v){cmpList=cmpList.filter(function(x){return x.type!=='ticker';});(v||[]).forEach(function(t){cmpList.push({type:'ticker',name:t});});}
});
