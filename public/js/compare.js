// Comparison mixed mode — ticker + sector + industry + konglomerat
// ═══ SCREENER SUBTABS ═══
let cmpColors=['#0ea5e9','#ef4444','#22c55e','#f59e0b','#a855f7','#ec4899','#14b8a6','#f97316'];

// scrSubTab removed — now handled by anaSubTab in app.js

// ═══ COMPARISON — Mixed mode: freely combine Ticker + Sector + Industry + Konglomerat ═══
let cmpRange='6m';
// Each item: { type: 'ticker'|'sector'|'industry'|'konglo', name: 'BBCA' }
let cmpList=[];
let cmpAddType='ticker'; // current add-mode selector
let cmpGroupCache={}; // { sector: [...], industry: [...], konglo: [...] }
let cmpShowFlow=false; // toggle foreign flow overlay
let cmpFlowData={}; // { 'ticker:BBCA': [{trade_date, fnet_val}] }

var CMP_TYPES={
  ticker:{icon:'📊',label:'Ticker',color:'var(--bl)',bg:'var(--blB)',placeholder:'BBCA, TLKM...'},
  sector:{icon:'🏢',label:'Sector',color:'var(--gn)',bg:'var(--gnB)'},
  industry:{icon:'🏭',label:'Industry',color:'var(--am)',bg:'var(--amB)'},
  konglo:{icon:'👑',label:'Konglo',color:'#8b5cf6',bg:'rgba(139,92,246,.12)'}
};

function renderCompare(){
  var el=$('compare-content');if(!el)return;
  var h='<div style="padding:12px;font-family:var(--f)">';
  h+='<div style="font-weight:700;font-size:14px;margin-bottom:10px">📈 Comparison</div>';

  // ── Add bar: type selector + input/dropdown + add button ──
  h+='<div class="cmp-input-bar" style="gap:4px">';

  // Type toggle buttons
  h+='<div style="display:flex;gap:2px">';
  ['ticker','sector','industry','konglo'].forEach(function(t){
    var ct=CMP_TYPES[t];
    var on=cmpAddType===t;
    h+='<button class="bei-sort-btn'+(on?' on':'')+'" onclick="cmpSetAddType(\''+t+'\')" style="padding:3px 8px;font-size:10px" title="Add '+ct.label+'">'+ct.icon+'</button>';
  });
  h+='</div>';

  // Input: text for ticker, dropdown for groups
  if(cmpAddType==='ticker'){
    h+='<input id="cmp-input" class="bei-filter-input" style="max-width:180px" placeholder="'+CMP_TYPES.ticker.placeholder+'" onkeydown="if(event.key===\'Enter\')cmpAddTicker()">';
    h+='<button class="bei-tab on" style="font-size:11px;padding:4px 10px" onclick="cmpAddTicker()">+ Add</button>';
  }else{
    h+='<select id="cmp-group-sel" class="bei-filter-sel" style="min-width:220px"><option value="">Loading...</option></select>';
    h+='<button class="bei-tab on" style="font-size:11px;padding:4px 10px" onclick="cmpAddFromDropdown()">+ Add</button>';
  }

  if(cmpList.length)h+='<button class="bei-filter-clear" onclick="cmpList=[];renderCompare()">Clear</button>';
  h+='<span style="flex:1"></span>';
  h+='<span style="font-size:10px;color:var(--t3)">Max 8 · Mix freely</span>';
  h+='</div>';

  // ── Selected items — chips with type badge ──
  if(cmpList.length){
    h+='<div class="cmp-chips">';
    cmpList.forEach(function(item,i){
      var ct=CMP_TYPES[item.type]||CMP_TYPES.ticker;
      h+='<span class="cmp-chip" style="border-color:'+cmpColors[i%8]+'">';
      h+='<span class="cmp-chip-dot" style="background:'+cmpColors[i%8]+'"></span>';
      h+='<span style="font-size:8px;padding:0 4px;border-radius:3px;background:'+ct.bg+';color:'+ct.color+';font-weight:600;margin-right:2px">'+ct.icon+'</span>';
      h+=esc(item.name);
      h+='<button class="cmp-chip-x" onclick="cmpList.splice('+i+',1);renderCompare()">✕</button></span>';
    });
    h+='</div>';
  }

  // ── Range buttons + Flow overlay toggle ──
  h+='<div class="cmp-range-bar" style="align-items:center">';
  [{k:'1m',l:'1M'},{k:'3m',l:'3M'},{k:'6m',l:'6M'},{k:'1y',l:'1Y'},{k:'3y',l:'3Y'},{k:'5y',l:'5Y'},{k:'all',l:'ALL'}].forEach(function(r){
    h+='<button class="bei-sort-btn'+(cmpRange===r.k?' on':'')+'" onclick="cmpRange=\''+r.k+'\';cmpLoadMixed()">'+r.l+'</button>';
  });
  h+='<span style="flex:1"></span>';
  h+='<button class="bei-sort-btn'+(cmpShowFlow?' on':'')+'" onclick="cmpShowFlow=!cmpShowFlow;cmpLoadMixed()" style="padding:3px 8px;font-size:10px" title="Toggle Foreign Flow overlay">🌊 F.Net</button>';
  h+='</div>';

  // ── Chart + Summary ──
  h+='<div id="cmp-chart" class="cmp-chart-area"></div>';
  h+='<div id="cmp-summary"></div>';
  h+='</div>';
  el.innerHTML=h;

  // Load group dropdown if needed
  if(cmpAddType!=='ticker')cmpLoadDropdown(cmpAddType);

  // Auto-load chart if 2+ items
  if(cmpList.length>=2)cmpLoadMixed();
  else if(cmpList.length===1)$('cmp-chart').innerHTML='<div class="ne" style="padding:30px">Add 1 more to compare</div>';
  else $('cmp-chart').innerHTML='<div class="ne" style="padding:30px">Add 2+ items to compare<br><span style="font-size:11px;color:var(--t3)">Mix tickers, sectors, industries, and konglomerat freely</span></div>';
}

function cmpSetAddType(t){
  cmpAddType=t;
  renderCompare();
}

// ── Add ticker ──
function cmpAddTicker(){
  var inp=$('cmp-input');if(!inp)return;
  var raw=inp.value.trim().toUpperCase();if(!raw)return;
  // Support comma-separated
  raw.split(',').forEach(function(code){
    code=code.trim();if(!code)return;
    if(cmpList.length>=8){showT('⚠','Max 8');return;}
    if(cmpList.some(function(x){return x.type==='ticker'&&x.name===code;})){return;}
    cmpList.push({type:'ticker',name:code});
  });
  inp.value='';
  renderCompare();
}

// ── Add from dropdown ──
function cmpAddFromDropdown(){
  var sel=$('cmp-group-sel');if(!sel||!sel.value)return;
  var name=sel.value;
  if(cmpList.length>=8){showT('⚠','Max 8');return;}
  if(cmpList.some(function(x){return x.type===cmpAddType&&x.name===name;})){showT('⚠','Already added');return;}
  cmpList.push({type:cmpAddType,name:name});
  sel.value='';
  renderCompare();
}

// ── Load dropdown options ──
async function cmpLoadDropdown(mode){
  var sel=$('cmp-group-sel');if(!sel)return;
  // Use cache if available
  if(cmpGroupCache[mode]){
    cmpPopulateDropdown(sel,mode,cmpGroupCache[mode]);
    return;
  }
  try{
    var r=await fetch('/api/idx/compare-groups?mode='+mode);
    var d=await r.json();
    cmpGroupCache[mode]=d.items||[];
    cmpPopulateDropdown(sel,mode,cmpGroupCache[mode]);
  }catch(e){sel.innerHTML='<option value="">Error loading</option>';}
}

function cmpPopulateDropdown(sel,mode,items){
  var ct=CMP_TYPES[mode];
  var h='<option value="">Select '+ct.label+'...</option>';
  items.forEach(function(item){
    // Skip already added
    if(cmpList.some(function(x){return x.type===mode&&x.name===item.name;}))return;
    var extra=item.count?' ('+item.count+')':'';
    var label=item.name;
    if(mode==='konglo'&&item.key_person)label+=(' — '+item.key_person);
    if(mode==='konglo'&&item.category)extra=' · '+item.category+extra;
    h+='<option value="'+esc(item.name)+'">'+esc(label)+extra+'</option>';
  });
  sel.innerHTML=h;
}

// ═══ LOAD DATA — unified for mixed items ═══
async function cmpLoadMixed(){
  var chartEl=$('cmp-chart'),sumEl=$('cmp-summary');
  if(!chartEl)return;

  // Update range highlight
  document.querySelectorAll('.cmp-range-bar .bei-sort-btn').forEach(function(b){
    b.classList.toggle('on',b.textContent.toLowerCase().replace(/\s/g,'')===cmpRange);
  });
  chartEl.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3)">Loading...</div>';
  if(sumEl)sumEl.innerHTML='';

  try{
    var allData={};

    // Split items by type
    var tickerItems=cmpList.filter(function(x){return x.type==='ticker';});
    var groupItems=cmpList.filter(function(x){return x.type!=='ticker';});

    // ── Fetch ticker data individually ──
    await Promise.all(tickerItems.map(async function(item){
      var key=cmpItemKey(item);
      var r=await fetch('/api/idx/flow?code='+encodeURIComponent(item.name));
      var d=await r.json();
      allData[key]=(d.data||[]).map(function(r){return{trade_date:r.trade_date,close:r.close,fnet_val:(r.foreign_buy-r.foreign_sell)*r.close||r.foreign_net_val||0};});
    }));

    // ── Fetch group data in batches by type ──
    var byType={};
    groupItems.forEach(function(item){
      if(!byType[item.type])byType[item.type]=[];
      byType[item.type].push(item.name);
    });

    await Promise.all(Object.keys(byType).map(async function(type){
      var names=byType[type];
      var r=await fetch('/api/idx/compare-group?mode='+type+'&groups='+encodeURIComponent(names.join(',')));
      var d=await r.json();
      if(d.error)return;
      var groups=d.groups||{};
      names.forEach(function(name){
        var key=cmpItemKey({type:type,name:name});
        var g=groups[name];
        if(g&&g.data){
          allData[key]=g.data.map(function(r){return{trade_date:r.trade_date,close:r.avg_close,fnet_val:r.total_fnet_val||0,count:r.count,tickers:g.tickers};});
        }else{
          allData[key]=[];
        }
      });
    }));

    // ── Build date axis ──
    var allDates=new Set();
    cmpList.forEach(function(item){
      var key=cmpItemKey(item);
      (allData[key]||[]).forEach(function(r){allDates.add(r.trade_date);});
    });
    var dates=Array.from(allDates).sort();
    if(dates.length<2){chartEl.innerHTML='<div class="ne">Not enough data</div>';return;}

    // ── Range filter ──
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
      cmpList.forEach(function(item){
        var key=cmpItemKey(item);
        allData[key]=(allData[key]||[]).filter(function(r){return r.trade_date>=cutStr;});
      });
    }
    if(dates.length<2){chartEl.innerHTML='<div class="ne">Not enough data for this range</div>';return;}

    // ── Normalize to % change ──
    var series={};
    cmpList.forEach(function(item){
      var key=cmpItemKey(item);
      var map={};(allData[key]||[]).forEach(function(r){map[r.trade_date]=r.close;});
      var fc=null;
      series[key]=dates.map(function(d){var c=map[d];if(c&&!fc)fc=c;if(!c||!fc)return null;return Math.round((c-fc)/fc*10000)/100;});
    });

    // ── Draw chart ──
    var flowSeries = cmpShowFlow ? cmpBuildFlowSeries(allData, dates) : null;
    cmpDrawChart(chartEl,dates,series,flowSeries);

    // ── Summary cards ──
    var sh='<div class="cmp-summary-grid">';
    cmpList.forEach(function(item,ci){
      var key=cmpItemKey(item);
      var data=allData[key];if(!data||!data.length)return;
      var f=data[0],l=data[data.length-1];
      var pct=f.close?((l.close-f.close)/f.close*100):0;
      var cls=pct>0?'up':pct<0?'dn':'';
      var totalFnet=data.reduce(function(s,r){return s+(r.fnet_val||0);},0);
      var fnetCls=totalFnet>0?'up':totalFnet<0?'dn':'';
      var ct=CMP_TYPES[item.type]||CMP_TYPES.ticker;

      var clickAttr=item.type==='ticker'?' onclick="gsOpen(\''+esc(item.name)+'\')" style="cursor:pointer"':'';

      sh+='<div class="cmp-summary-card"'+clickAttr+'>';
      sh+='<div class="cmp-sc-head"><span class="cmp-sc-dot" style="background:'+cmpColors[ci%8]+'"></span>';
      sh+='<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:'+ct.bg+';color:'+ct.color+';font-weight:600">'+ct.icon+'</span>';
      sh+='<span class="cmp-sc-code">'+esc(item.name)+'</span></div>';
      sh+='<div class="cmp-sc-pct '+cls+'">'+(pct>0?'+':'')+pct.toFixed(2)+'%</div>';
      if(item.type==='ticker'){
        sh+='<div class="cmp-sc-detail">'+f.close.toLocaleString()+' → '+l.close.toLocaleString()+'</div>';
      }else{
        sh+='<div class="cmp-sc-detail">Avg '+Math.round(f.close).toLocaleString()+' → '+Math.round(l.close).toLocaleString();
        if(l.tickers)sh+=' · '+l.tickers+' stocks';
        sh+='</div>';
      }
      sh+='<div class="cmp-sc-detail '+fnetCls+'">F.Net: '+fmtRp(totalFnet)+'</div>';
      sh+='</div>';
    });
    sh+='</div>';
    if(sumEl)sumEl.innerHTML=sh;

  }catch(e){chartEl.innerHTML='<div class="ne">Error: '+e.message+'</div>';}
}

// ── Unique key for each item ──
function cmpItemKey(item){return item.type+':'+item.name;}

// ═══ ECHARTS CHART RENDERER — with optional flow overlay ═══
function cmpDrawChart(chartEl,dates,series,flowSeries){
  var hasFlow=cmpShowFlow&&flowSeries&&Object.keys(flowSeries).length>0;
  var H=hasFlow?420:320;
  chartEl.style.height=H+'px';
  var c=BL.init(chartEl,'cmp-chart');if(!c)return;

  var allV=[];
  cmpList.forEach(function(item){
    var key=cmpItemKey(item);
    (series[key]||[]).forEach(function(v){if(v!==null)allV.push(v);});
  });
  if(!allV.length){chartEl.innerHTML='<div class="ne">No data to chart</div>';return;}

  // Build price series
  var priceSeries=[];
  cmpList.forEach(function(item,ci){
    var key=cmpItemKey(item);
    var clr=cmpColors[ci%8];
    var labelName=item.name.length>12?item.name.substring(0,12)+'…':item.name;
    priceSeries.push({
      name:labelName,type:'line',data:series[key]||[],symbol:'none',
      lineStyle:{width:2,color:clr},itemStyle:{color:clr},
      xAxisIndex:0,yAxisIndex:0,connectNulls:true
    });
  });

  // Build flow series if enabled
  var flowSeriesArr=[];
  if(hasFlow){
    cmpList.forEach(function(item,ci){
      var key=cmpItemKey(item);
      var clr=cmpColors[ci%8];
      var labelName=(item.name.length>12?item.name.substring(0,12)+'…':item.name)+' F.Net';
      flowSeriesArr.push({
        name:labelName,type:'line',data:flowSeries[key]||[],symbol:'none',
        lineStyle:{width:1.5,color:clr,opacity:0.7},itemStyle:{color:clr},
        xAxisIndex:hasFlow?1:0,yAxisIndex:hasFlow?1:0
      });
    });
  }

  var grids=[BL.grid({top:24,bottom:hasFlow?'56%':40,left:55,right:60})];
  var xAxes=[{type:'category',data:dates,gridIndex:0,axisLabel:{fontSize:7,formatter:function(v){return v.substring(5);}}}];
  var yAxes=[{type:'value',gridIndex:0,axisLabel:{fontSize:8,formatter:function(v){return(v>0?'+':'')+v.toFixed(1)+'%';}}}];

  if(hasFlow){
    grids.push({left:55,right:60,top:'52%',bottom:36,containLabel:false});
    xAxes.push({type:'category',data:dates,gridIndex:1,axisLabel:{fontSize:7,formatter:function(v){return v.substring(5);}}});
    yAxes.push({type:'value',gridIndex:1,axisLabel:{fontSize:8,formatter:function(v){return BL.fmtRp(v);}}});
  }

  c.setOption({
    tooltip:{trigger:'axis'},
    legend:{top:2,left:8,textStyle:{fontSize:8}},
    grid:grids,
    xAxis:xAxes,
    yAxis:yAxes,
    dataZoom:[{type:'inside',xAxisIndex:hasFlow?[0,1]:[0]},{type:'slider',height:14,bottom:2,xAxisIndex:hasFlow?[0,1]:[0],borderColor:'#2a3444',fillerColor:'rgba(84,112,198,0.15)',textStyle:{fontSize:7,color:'#6b7a8d'}}],
    series:priceSeries.concat(flowSeriesArr)
  },true);
}

// Build flow cumulative series for overlay
function cmpBuildFlowSeries(allData, dates) {
  var flowSeries = {};
  cmpList.forEach(function(item) {
    var key = cmpItemKey(item);
    var data = allData[key] || [];
    if (!data.length) return;
    var map = {};
    data.forEach(function(r) { map[r.trade_date] = r.fnet_val || 0; });
    var cum = 0;
    flowSeries[key] = dates.map(function(d) {
      var v = map[d] || 0;
      cum += v;
      return cum;
    });
  });
  return flowSeries;
}

// ═══ Backward compat ═══
Object.defineProperty(window,'cmpTickers',{
  get:function(){return cmpList.filter(function(x){return x.type==='ticker';}).map(function(x){return x.name;});},
  set:function(v){cmpList=cmpList.filter(function(x){return x.type!=='ticker';});(v||[]).forEach(function(t){cmpList.push({type:'ticker',name:t});});}
});