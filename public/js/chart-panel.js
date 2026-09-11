// ═══ BANYU LANGIT — Chart Panel V4 ═══
// TradingView-style: candlestick OHLC, last price line, MA price labels, crosshair
// Foreign Flow (bar), Bid/Offer Vol, Drawing Tools, Index tickers
// Keyboard: G = toggle chart

(function(){
  'use strict';

  var _open = false;
  var _inst = null;
  var _data = null;
  var _code = '';
  var _type = 'stock';
  var _width = parseInt(localStorage.getItem('chartW')) || 55;
  var _tf = '1D';
  var _acIdx = -1;
  var _drawMode = null;
  var _drawings = [];
  var _drawStart = null;
  var _chartStyle = localStorage.getItem('chartStyle') || 'candle'; // 'candle' or 'area'

  // Colors — TradingView style
  var C = {
    bull: '#26A69A', bear: '#EF5350',
    bullA: 'rgba(38,166,154,0.5)', bearA: 'rgba(239,83,80,0.5)',
    bg: 'transparent', grid: '#1e1e2e', gridSub: '#1a1a2e',
    text: '#888', textDim: '#555', textBright: '#ccc',
    cross: '#555', tooltip: 'rgba(15,15,25,0.95)',
    lastLine: '#2962FF'
  };

  var _ind = {
    ma5:   { on: false, label: 'MA 5',   period: 5,   color: '#FF5252', grp: 'overlay' },
    ma10:  { on: false, label: 'MA 10',  period: 10,  color: '#FF9800', grp: 'overlay' },
    ma20:  { on: true,  label: 'MA 20',  period: 20,  color: '#FFAB00', grp: 'overlay' },
    ma50:  { on: true,  label: 'MA 50',  period: 50,  color: '#26C6DA', grp: 'overlay' },
    ma100: { on: false, label: 'MA 100', period: 100, color: '#66BB6A', grp: 'overlay' },
    ma200: { on: false, label: 'MA 200', period: 200, color: '#AB47BC', grp: 'overlay' },
    ma400: { on: false, label: 'MA 400', period: 400, color: '#78909C', grp: 'overlay' },
    bbands:{ on: false, label: 'Bollinger (20,2)', period: 20, std: 2, color: '#78909C', grp: 'overlay' },
    vol:   { on: true,  label: 'Volume',  color: '#546E7A', grp: 'sub' },
    fflow: { on: false, label: 'Foreign Flow', color: '#2196F3', grp: 'sub' },
    bidoff:{ on: false, label: 'Bid/Offer Vol', color: '#4CAF50', grp: 'sub' },
    freq:  { on: false, label: 'Frequency', color: '#FF9800', grp: 'sub' },
    // RSI variant = Cutler (simple average of the last 14 changes) — same math as server/routes/idx.js calcRSI, so chart and screener agree
    rsi:   { on: false, label: 'RSI (14) Cutler', period: 14, color: '#AB47BC', grp: 'sub' },
    macd:  { on: false, label: 'MACD (12,26,9)', fast: 12, slow: 26, signal: 9, grp: 'sub' }
  };

  var _indexMap = {
    'IHSG':'COMPOSITE','COMPOSITE':'COMPOSITE','LQ45':'LQ45','IDX30':'IDX30','IDX80':'IDX80',
    'HIDIV20':'HIDIV20','BUMN20':'BUMN20','KOMPAS100':'KOMPAS100','ISSI':'ISSI',
    'JII':'JII','JII70':'JII70','IDXBUMN20':'IDXBUMN20','IDX-IC':'IDX-IC','IDXESGL':'IDXESGL',
    'IDXQ30':'IDXQ30','IDXV30':'IDXV30','IDXG30':'IDXG30','IDXHIDIV20':'HIDIV20',
    'SRI-KEHATI':'SRI-KEHATI','PEFINDO25':'PEFINDO25','BISNIS-27':'BISNIS-27','MBX':'MBX',
    'DBX':'DBX','INVESTOR33':'INVESTOR33'
  };

  document.addEventListener('DOMContentLoaded', function(){
    _injectButton(); _injectPanel(); _bindKeys();
    try { var s=JSON.parse(localStorage.getItem('chartInd')||'{}'); Object.keys(s).forEach(function(k){if(_ind[k])_ind[k].on=s[k];}); }catch(e){}
  });

  function _injectButton(){
    var topR=document.querySelector('.topbar-r'); if(!topR)return;
    var btn=document.createElement('button');
    btn.className='ib chart-toggle'; btn.id='chart-btn'; btn.title='Chart [G]'; btn.textContent='📊'; btn.onclick=toggleChart;
    var sett=topR.querySelector('[onclick*="openSettings"]');
    if(sett)topR.insertBefore(btn,sett); else topR.appendChild(btn);
  }

  function _injectPanel(){
    var p=document.createElement('div'); p.className='chart-panel'; p.id='chart-panel';
    p.style.setProperty('--chart-w',_width+'%');
    p.innerHTML=
      '<div class="chart-resize" id="chart-resize"></div>'+
      '<div class="chart-topbar">'+
        '<div style="position:relative">'+
          '<input class="chart-ticker-input" id="chart-ticker" placeholder="BBCA" autocomplete="off">'+
          '<div class="chart-ac" id="chart-ac"></div>'+
        '</div>'+
        '<div class="chart-price-info" id="chart-price-info"></div>'+
        '<div class="chart-tool-group" id="chart-tools">'+
          '<button class="chart-tool-btn" data-tool="hline" title="Horizontal Line">─</button>'+
          '<button class="chart-tool-btn" data-tool="trendline" title="Trend Line">╱</button>'+
          '<button class="chart-tool-btn" data-tool="clear" title="Clear Drawings">🗑</button>'+
        '</div>'+
        '<div class="chart-tf-group" id="chart-style-group">'+
          '<button class="chart-tf-btn'+ (_chartStyle==='candle'?' active':'') +'" data-style="candle" title="Candlestick">🕯</button>'+
          '<button class="chart-tf-btn'+ (_chartStyle==='area'?' active':'') +'" data-style="area" title="Bloomberg Area">📈</button>'+
        '</div>'+
        '<div class="chart-tf-group">'+
          '<button class="chart-tf-btn active" data-tf="1D">D</button>'+
          '<button class="chart-tf-btn" data-tf="1W">W</button>'+
          '<button class="chart-tf-btn" data-tf="1M">M</button>'+
        '</div>'+
        '<div style="position:relative">'+
          '<button class="chart-ind-btn" id="chart-ind-btn" title="Indicators">fx</button>'+
          '<div class="chart-ind-drop" id="chart-ind-drop"></div>'+
        '</div>'+
        '<button class="chart-tool-btn" id="chart-download-btn" title="Download PNG" style="font-size:14px">📷</button>'+
        '<button class="chart-tool-btn" id="chart-popup-btn" title="Pop-up Window" style="font-size:14px">⧉</button>'+
        '<button class="chart-close-btn" onclick="toggleChart()" title="Close [G]">✕</button>'+
      '</div>'+
      '<div class="chart-body" id="chart-body"></div>';
    var topbar=document.querySelector('.topbar');
    if(topbar&&topbar.nextSibling)topbar.parentNode.insertBefore(p,topbar.nextSibling);
    else document.body.appendChild(p);
    _bindTickerInput(); _bindTFButtons(); _bindStyleButtons(); _buildIndDropdown(); _bindResize(); _bindDrawTools(); _bindDownload(); _bindPopup();
  }

  window.toggleChart=function(){
    _open=!_open;
    var panel=$i('chart-panel'),btn=$i('chart-btn'),layout=document.querySelector('.layout');
    if(_open){
      panel.style.setProperty('--chart-w',_width+'%'); panel.classList.add('open');
      if(btn)btn.classList.add('active');
      if(layout){layout.classList.add('chart-open');layout.style.setProperty('--chart-w',_width+'%');}
      var inp=$i('chart-ticker');
      if(inp&&!inp.value)setTimeout(function(){inp.focus();},300);
      if(_inst)setTimeout(function(){_inst.resize();},320);
      if(_inst)setTimeout(function(){_inst.resize();},600);
      // Resize all BL ECharts instances (Compare, Scoring, Market Intel, etc.)
      setTimeout(function(){_resizeBLInstances();},350);
      setTimeout(function(){_resizeBLInstances();},650);
    }else{
      panel.classList.remove('open');
      if(btn)btn.classList.remove('active');
      if(layout){layout.classList.remove('chart-open');layout.style.marginRight='';}
      // Resize all BL instances back to full width
      setTimeout(function(){_resizeBLInstances();},350);
      setTimeout(function(){_resizeBLInstances();},650);
    }
  };

  window.chartOpen=function(code){
    if(!_open)toggleChart();
    var inp=$i('chart-ticker'); if(inp)inp.value=code;
    _loadChart(code);
  };

  // ═══ TICKER INPUT ═══
  function _bindTickerInput(){
    var inp=$i('chart-ticker'); if(!inp)return;
    var acEl=$i('chart-ac');
    inp.addEventListener('input',function(){
      var q=inp.value.trim().toUpperCase(); _acIdx=-1;
      if(q.length<1){acEl.classList.remove('open');acEl.innerHTML='';return;}
      fetch('/api/idx/autocomplete?q='+encodeURIComponent(q)+'&limit=10')
        .then(function(r){return r.json();})
        .then(function(d){
          if(!d.length){acEl.classList.remove('open');return;}
          acEl.innerHTML=d.map(function(it){
            var badge=it.type==='index'?'<span class="ac-badge">IDX</span>':'';
            return '<div class="chart-ac-item" data-code="'+_e(it.code)+'" data-type="'+(it.type||'stock')+'">'+
              '<span class="ac-code">'+_e(it.code)+badge+'</span>'+
              '<span class="ac-name">'+_e(it.name||'')+'</span></div>';
          }).join('');
          acEl.classList.add('open');
          acEl.querySelectorAll('.chart-ac-item').forEach(function(el){
            el.addEventListener('mousedown',function(e){
              e.preventDefault(); inp.value=el.getAttribute('data-code'); acEl.classList.remove('open');
              _loadChart(inp.value,el.getAttribute('data-type'));
            });
          });
        }).catch(function(){});
    });
    inp.addEventListener('keydown',function(e){
      var items=acEl.querySelectorAll('.chart-ac-item');
      if(e.key==='ArrowDown'){e.preventDefault();_acIdx=Math.min(_acIdx+1,items.length-1);_hlAc(items);}
      else if(e.key==='ArrowUp'){e.preventDefault();_acIdx=Math.max(_acIdx-1,0);_hlAc(items);}
      else if(e.key==='Enter'){
        e.preventDefault();acEl.classList.remove('open');
        var st='stock';
        if(_acIdx>=0&&items[_acIdx]){inp.value=items[_acIdx].getAttribute('data-code');st=items[_acIdx].getAttribute('data-type')||'stock';}
        if(inp.value.trim())_loadChart(inp.value.trim().toUpperCase(),st);
      }
      else if(e.key==='Escape')acEl.classList.remove('open');
    });
    inp.addEventListener('blur',function(){setTimeout(function(){acEl.classList.remove('open');},150);});
  }
  function _hlAc(items){items.forEach(function(el,i){el.classList.toggle('sel',i===_acIdx);});}

  // ═══ TIMEFRAME ═══
  function _bindTFButtons(){
    document.querySelectorAll('.chart-tf-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        document.querySelectorAll('.chart-tf-btn').forEach(function(b){b.classList.remove('active');});
        btn.classList.add('active'); _tf=btn.getAttribute('data-tf');
        if(_data)_render();
      });
    });
  }

  // ═══ CHART STYLE TOGGLE ═══
  function _bindStyleButtons(){
    document.querySelectorAll('#chart-style-group .chart-tf-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        document.querySelectorAll('#chart-style-group .chart-tf-btn').forEach(function(b){b.classList.remove('active');});
        btn.classList.add('active');
        _chartStyle=btn.getAttribute('data-style');
        localStorage.setItem('chartStyle',_chartStyle);
        if(_data)_render();
      });
    });
  }

  // ═══ INDICATOR DROPDOWN ═══
  function _buildIndDropdown(){
    var drop=$i('chart-ind-drop'),btn=$i('chart-ind-btn'); if(!drop||!btn)return;
    function render(){
      var h='<div class="ind-section">Overlays</div>';
      _eachInd('overlay',function(k,ind){h+=_indItem(k,ind);});
      h+='<div class="ind-section">Sub-Charts</div>';
      _eachInd('sub',function(k,ind){h+=_indItem(k,ind);});
      drop.innerHTML=h;
      drop.querySelectorAll('.chart-ind-item').forEach(function(el){
        el.addEventListener('mousedown',function(e){
          e.preventDefault();var k=el.getAttribute('data-ind');
          _ind[k].on=!_ind[k].on; el.classList.toggle('on',_ind[k].on);
          _saveInd(); if(_data)_render();
        });
      });
    }
    btn.addEventListener('click',function(e){e.stopPropagation();drop.classList.toggle('open');render();});
    document.addEventListener('click',function(e){if(!btn.contains(e.target)&&!drop.contains(e.target))drop.classList.remove('open');});
  }
  function _indItem(k,ind){return '<div class="chart-ind-item'+(ind.on?' on':'')+'" data-ind="'+k+'"><span>'+_e(ind.label)+'</span><span class="ind-check">✓</span></div>';}
  function _eachInd(grp,fn){Object.keys(_ind).forEach(function(k){if(_ind[k].grp===grp)fn(k,_ind[k]);});}
  function _saveInd(){var s={};Object.keys(_ind).forEach(function(k){s[k]=_ind[k].on;});localStorage.setItem('chartInd',JSON.stringify(s));}

  // ═══ DRAWING TOOLS ═══
  function _bindDrawTools(){
    document.querySelectorAll('.chart-tool-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        var tool=btn.getAttribute('data-tool');
        if(tool==='clear'){_drawings=[];_drawMode=null;_drawStart=null;
          document.querySelectorAll('.chart-tool-btn').forEach(function(b){b.classList.remove('active');});
          if(_data)_render();return;}
        if(_drawMode===tool){_drawMode=null;btn.classList.remove('active');}
        else{_drawMode=tool;document.querySelectorAll('.chart-tool-btn').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');}
        _drawStart=null;
      });
    });
  }
  function _bindChartClick(){
    if(!_inst)return;
    _inst.off('click');
    _inst.on('click',function(params){
      if(!_drawMode||!params)return;
      var coord=_inst.convertFromPixel({seriesIndex:0},[params.event.offsetX,params.event.offsetY]);
      if(!coord||coord.length<2)return;
      if(_drawMode==='hline'){
        _drawings.push({type:'hline',value:coord[1]});_render();
      }else if(_drawMode==='trendline'){
        if(!_drawStart){_drawStart={x:Math.round(coord[0]),y:coord[1]};}
        else{_drawings.push({type:'trendline',x0:_drawStart.x,y0:_drawStart.y,x1:Math.round(coord[0]),y1:coord[1]});_drawStart=null;_render();}
      }
    });
  }

  // ═══ DOWNLOAD PNG ═══
  function _bindDownload(){
    var btn=$i('chart-download-btn'); if(!btn)return;
    btn.addEventListener('click',function(){
      if(!_inst)return;
      var url=_inst.getDataURL({type:'png',pixelRatio:2,backgroundColor:'#0a0a14'});
      var a=document.createElement('a');
      a.href=url; a.download=(_code||'chart')+'_'+(_tf||'1D')+'_'+new Date().toISOString().slice(0,10)+'.png';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
  }

  // ═══ POPUP WINDOW (interactive chart in separate window) ═══
  function _bindPopup(){
    var btn=$i('chart-popup-btn'); if(!btn)return;
    btn.addEventListener('click',function(){
      if(!_inst||!_data)return;
      var indConf={};
      Object.keys(_ind).forEach(function(k){
        indConf[k]={on:_ind[k].on,label:_ind[k].label,period:_ind[k].period||0,color:_ind[k].color||'',grp:_ind[k].grp,std:_ind[k].std||0,fast:_ind[k].fast||0,slow:_ind[k].slow||0,signal:_ind[k].signal||0};
      });
      window.__chartPopup={data:_data,ind:indConf,tf:_tf};
      var w=Math.min(1400,Math.round(screen.width*0.85));
      var h=Math.min(900,Math.round(screen.height*0.8));
      var left=Math.round((screen.width-w)/2);
      var top=Math.round((screen.height-h)/2);
      window.open('/chart-popup.html','chart_popup','width='+w+',height='+h+',left='+left+',top='+top+',menubar=no,toolbar=no');
    });
  }

  // ═══ RESIZE ═══
  function _bindResize(){
    var h=$i('chart-resize'); if(!h)return;
    h.addEventListener('mousedown',function(e){
      e.preventDefault();document.body.style.cursor='ew-resize';document.body.style.userSelect='none';
      document.addEventListener('mousemove',onM);document.addEventListener('mouseup',onU);
    });
    function onM(e){
      var w=((window.innerWidth-e.clientX)/window.innerWidth)*100;
      _width=Math.max(25,Math.min(80,Math.round(w)));
      var p=$i('chart-panel');p.style.setProperty('--chart-w',_width+'%');
      var l=document.querySelector('.layout');if(l&&_open)l.style.setProperty('--chart-w',_width+'%');
      if(_inst)_inst.resize();
      _resizeBLInstances();
    }
    function onU(){document.removeEventListener('mousemove',onM);document.removeEventListener('mouseup',onU);
      document.body.style.cursor='';document.body.style.userSelect='';localStorage.setItem('chartW',_width);}
  }

  // ═══ KEYBOARD ═══
  function _bindKeys(){
    document.addEventListener('keydown',function(e){
      var tag=e.target.tagName;if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
      if(e.key==='g'||e.key==='G'){toggleChart();e.preventDefault();}
    });
  }

  // ═══ LOAD DATA ═══
  function _loadChart(code,type){
    code=(code||'').toUpperCase().replace('.JK','').trim();if(!code)return;
    var isIndex=(type==='index')||!!_indexMap[code];
    var indexCode=_indexMap[code]||code;
    _code=code;_type=isIndex?'index':'stock';_drawings=[];_drawStart=null;_drawMode=null;
    document.querySelectorAll('.chart-tool-btn').forEach(function(b){b.classList.remove('active');});
    var body=$i('chart-body');
    if(!_inst)_inst=echarts.init(body,null,{renderer:'canvas'});
    _inst.showLoading({text:code+'...',color:'#2196F3',textColor:'#aaa',maskColor:'rgba(0,0,0,0.3)'});
    var toolsEl=$i('chart-tools');if(toolsEl)toolsEl.style.display=isIndex?'none':'';
    var url=isIndex?'/api/idx/indices/history?code='+encodeURIComponent(indexCode)+'&days=5000':'/api/idx/adjusted/'+encodeURIComponent(code);
    fetch(url).then(function(r){return r.json();}).then(function(d){
      _inst.hideLoading();
      var rows=d.data;
      if(!rows||!rows.length){_inst.clear();_inst.setOption({title:{text:code+': No data',left:'center',top:'center',textStyle:{color:'#666',fontSize:14}}});return;}
      if(isIndex){
        rows=rows.map(function(r){return{
          trade_date:r.trade_date,adj_open:r.previous||r.close,adj_high:r.highest||r.close,adj_low:r.lowest||r.close,adj_close:r.close,
          adj_volume:r.volume||0,volume:r.volume||0,prev_close:r.previous||0,open_price:r.previous||r.close,close:r.close,
          high:r.highest||r.close,low:r.lowest||r.close,foreign_buy:0,foreign_sell:0,bid_vol:0,offer_vol:0,value:r.value||0
        };});
      }
      _data={code:code,data:rows,type:_type};
      _updatePrice(rows[rows.length-1]); _render(); _bindChartClick();
    }).catch(function(e){_inst.hideLoading();_inst.clear();
      _inst.setOption({title:{text:'Error: '+e.message,left:'center',top:'center',textStyle:{color:'#f44',fontSize:12}}});
    });
  }

  // ═══ PRICE INFO BAR ═══
  function _updatePrice(last){
    var el=$i('chart-price-info');if(!el||!last)return;
    var c=last.adj_close||last.close,p=last.prev_close||0;
    var chg=p?((c-p)/p*100):0,cls=chg>0?'up':chg<0?'dn':'',ar=chg>0?'▲':chg<0?'▼':'';
    var badge=_type==='index'?'<span class="cp-badge">INDEX</span>':'';
    el.innerHTML=badge+'<span class="cp-price">'+c.toLocaleString(undefined,{maximumFractionDigits:0})+'</span>'+
      '<span class="cp-change '+cls+'">'+ar+(chg>0?'+':'')+chg.toFixed(2)+'%</span>'+
      '<span style="color:var(--t3);font-size:var(--font-xs)">'+(last.trade_date||'')+'</span>';
  }

  // ═══ RENDER CHART — TradingView Style ═══
  function _render(){
    if(!_data||!_inst)return;
    var raw=_data.data;
    var data=_tf==='1W'?_resample(raw,'W'):_tf==='1M'?_resample(raw,'M'):raw;
    var isIdx=_data.type==='index';
    var dates=data.map(function(r){return r.trade_date;});
    var ohlc=data.map(function(r){return[r.adj_open||r.open_price,r.adj_close||r.close,r.adj_low||r.low,r.adj_high||r.high];});
    var volumes=data.map(function(r){return r.adj_volume||r.volume||0;});
    var closes=data.map(function(r){return r.adj_close||r.close;});
    var lastClose=closes.length?closes[closes.length-1]:0;
    var lastOhlc=ohlc.length?ohlc[ohlc.length-1]:null;
    var lastBull=lastOhlc?(lastOhlc[1]>=lastOhlc[0]):true;

    // Count active sub-charts
    var subs=[];
    if(_ind.vol.on)subs.push('vol');
    if(_ind.fflow.on&&!isIdx)subs.push('fflow');
    if(_ind.bidoff.on&&!isIdx)subs.push('bidoff');
    if(_ind.freq.on&&!isIdx)subs.push('freq');
    if(_ind.rsi.on)subs.push('rsi');
    if(_ind.macd.on)subs.push('macd');
    // Bloomberg area mode: auto-add drawdown sub-chart
    if(_chartStyle==='area')subs.push('drawdown');

    var subH=subs.length===0?0:subs.length===1?20:subs.length===2?16:subs.length===3?13:11;
    var totalSubH=subs.length*(subH+2);
    var mainBottom=8+totalSubH;

    var grids=[],xAxes=[],yAxes=[],series=[];

    // ── Grid 0: Candlestick (main) ──
    grids.push({left:55,right:60,top:20,bottom:mainBottom+'%'});
    xAxes.push({type:'category',data:dates,gridIndex:0,show:subs.length===0,
      axisLine:{lineStyle:{color:'#333'}},axisLabel:{color:C.text,fontSize:10},axisTick:{show:false},
      splitLine:{show:false}});
    yAxes.push({type:'value',gridIndex:0,scale:true,splitNumber:6,
      position:'right',
      splitLine:{lineStyle:{color:C.gridSub,type:'dashed'}},
      axisLabel:{color:C.text,fontSize:10,inside:false,
        formatter:function(v){return v>=1e6?(v/1e6).toFixed(1)+'M':v>=1000?v.toLocaleString():v%1===0?v.toFixed(0):v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});}},
      axisLine:{show:false}});

    // ── Main chart series (Candlestick or Bloomberg Area) ──
    if(_chartStyle==='area'){
      // Bloomberg-style: white line + blue gradient fill + stats overlay
      series.push({type:'line',data:closes,xAxisIndex:0,yAxisIndex:0,
        smooth:false,symbol:'none',lineStyle:{width:1.5,color:'#ffffff'},name:'Close',z:2,
        areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,
          colorStops:[{offset:0,color:'rgba(33,100,243,0.45)'},{offset:0.6,color:'rgba(33,100,243,0.15)'},{offset:1,color:'rgba(33,100,243,0.02)'}]}},
        markLine:{symbol:'none',data:[{
          yAxis:lastClose,
          lineStyle:{color:lastBull?C.bull:C.bear,width:1,type:'dashed'},
          label:{formatter:lastClose.toLocaleString(),position:'end',
            backgroundColor:lastBull?C.bull:C.bear,color:'#fff',fontSize:10,
            padding:[2,6],borderRadius:2}
        }],silent:true,animation:false}
      });
      // Stats legend (Bloomberg style) — using graphic elements
      var allH=Math.max.apply(null,closes),allL=Math.min.apply(null,closes.filter(function(v){return v>0})),allAvg=Math.round(closes.reduce(function(s,v){return s+v},0)/closes.length);
      // Calculate max drawdown
      var peak=0,maxDD=0;
      for(var di=0;di<closes.length;di++){if(closes[di]>peak)peak=closes[di];var dd=peak>0?(closes[di]-peak)/peak*100:0;if(dd<maxDD)maxDD=dd;}
      var statsHtml='<span style="color:#fff;font-size:11px;font-weight:700">'+_code+'</span>';
      statsHtml+=' <span style="color:#888;font-size:10px">Last</span> <span style="color:#fff;font-size:11px">'+lastClose.toLocaleString()+'</span>';
      statsHtml+=' <span style="color:#888;font-size:10px">High</span> <span style="color:#26A69A;font-size:11px">'+allH.toLocaleString()+'</span>';
      statsHtml+=' <span style="color:#888;font-size:10px">Low</span> <span style="color:#EF5350;font-size:11px">'+allL.toLocaleString()+'</span>';
      statsHtml+=' <span style="color:#888;font-size:10px">Avg</span> <span style="color:#FFAB00;font-size:11px">'+allAvg.toLocaleString()+'</span>';
      statsHtml+=' <span style="color:#888;font-size:10px">DD</span> <span style="color:#EF5350;font-size:11px">'+maxDD.toFixed(1)+'%</span>';
    } else {
      // Candlestick mode (default TradingView style)
      var markLines=[];
      markLines.push({
        yAxis:lastClose,
        lineStyle:{color:lastBull?C.bull:C.bear,width:1,type:'dashed'},
        label:{formatter:lastClose.toLocaleString(),position:'end',
          backgroundColor:lastBull?C.bull:C.bear,color:'#fff',fontSize:10,
          padding:[2,6],borderRadius:2}
      });
      _drawings.forEach(function(d){if(d.type==='hline')markLines.push({yAxis:d.value,lineStyle:{color:'#FF9800',width:1,type:'dashed'},label:{formatter:Math.round(d.value).toLocaleString(),position:'end',color:'#FF9800',fontSize:10}});});

      series.push({type:'candlestick',data:ohlc,xAxisIndex:0,yAxisIndex:0,
        itemStyle:{color:C.bull,color0:C.bear,borderColor:C.bull,borderColor0:C.bear,borderWidth:1},
        barMaxWidth:12,barMinWidth:1,
        markLine:{symbol:'none',data:markLines,silent:true,animation:false}
      });
    }

    // ── MA overlays with price labels (dynamic — loops all ma* keys) ──
    Object.keys(_ind).forEach(function(k){
      if(k.substring(0,2)!=='ma'||k==='macd'||!_ind[k].on||_ind[k].grp!=='overlay'||!_ind[k].period)return;
      var maData=_calcMA(closes,_ind[k].period);
      var lastMA=null;
      for(var mi=maData.length-1;mi>=0;mi--){if(maData[mi]!==null){lastMA=maData[mi];break;}}
      var maSeries={type:'line',data:maData,xAxisIndex:0,yAxisIndex:0,
        smooth:false,symbol:'none',lineStyle:{width:1.2,color:_ind[k].color},name:_ind[k].label,z:1};
      if(lastMA!==null){
        var maLabel=lastMA.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
        maSeries.markLine={symbol:'none',silent:true,animation:false,
          data:[{yAxis:lastMA,lineStyle:{color:_ind[k].color,width:0,type:'solid'},
            label:{formatter:maLabel,position:'end',
              color:_ind[k].color,fontSize:9,backgroundColor:'rgba(0,0,0,0.6)',
              padding:[1,4],borderRadius:2}}]};
      }
      series.push(maSeries);
    });

    // Bollinger Bands
    if(_ind.bbands.on){
      var bb=_calcBB(closes,_ind.bbands.period,_ind.bbands.std);
      series.push({type:'line',data:bb.u,xAxisIndex:0,yAxisIndex:0,smooth:false,symbol:'none',lineStyle:{width:1,color:_ind.bbands.color,type:'dashed'},name:'BB Up',z:0});
      series.push({type:'line',data:bb.l,xAxisIndex:0,yAxisIndex:0,smooth:false,symbol:'none',lineStyle:{width:1,color:_ind.bbands.color,type:'dashed'},name:'BB Lo',z:0});
      series.push({type:'line',data:bb.m,xAxisIndex:0,yAxisIndex:0,smooth:false,symbol:'none',lineStyle:{width:1,color:_ind.bbands.color,opacity:0.4},name:'BB Mid',z:0});
    }

    // ═══ SUB-CHARTS ═══
    var gIdx=1;
    var subTopStart=100-mainBottom+2;

    subs.forEach(function(sc,si){
      var top=subTopStart+si*(subH+2);
      var isLast=si===subs.length-1;
      grids.push({left:55,right:60,top:top+'%',height:subH+'%'});
      xAxes.push({type:'category',data:dates,gridIndex:gIdx,show:isLast,
        axisLine:{lineStyle:{color:'#333'}},axisLabel:{color:C.text,fontSize:9},axisTick:{show:false}});

      if(sc==='vol'){
        yAxes.push({type:'value',gridIndex:gIdx,scale:false,splitNumber:2,position:'right',
          splitLine:{lineStyle:{color:C.gridSub}},
          axisLabel:{color:C.textDim,fontSize:9,formatter:_fmtAxisVal},axisLine:{show:false}});
        series.push({type:'bar',data:volumes.map(function(v,i){
          var bull=ohlc[i]?ohlc[i][1]>=ohlc[i][0]:true;
          return{value:v,itemStyle:{color:bull?C.bullA:C.bearA}};
        }),xAxisIndex:gIdx,yAxisIndex:gIdx,barMaxWidth:8,name:'Vol'});
      }
      else if(sc==='fflow'){
        var fnet=data.map(function(r){return(((r.foreign_buy||0)-(r.foreign_sell||0))*(r.adj_close||r.close||1));});
        yAxes.push({type:'value',gridIndex:gIdx,scale:true,splitNumber:2,position:'right',
          splitLine:{lineStyle:{color:C.gridSub}},
          axisLabel:{color:C.textDim,fontSize:9,formatter:_fmtAxisVal},axisLine:{show:false}});
        series.push({type:'bar',data:fnet.map(function(v){
          return{value:v,itemStyle:{color:v>=0?'rgba(38,166,154,0.7)':'rgba(239,83,80,0.7)'}};
        }),xAxisIndex:gIdx,yAxisIndex:gIdx,barMaxWidth:6,name:'F.Net'});
      }
      else if(sc==='bidoff'){
        var bids=data.map(function(r){return r.bid_vol||0;});
        var offers=data.map(function(r){return -(r.offer_vol||0);});
        yAxes.push({type:'value',gridIndex:gIdx,scale:true,splitNumber:2,position:'right',
          splitLine:{lineStyle:{color:C.gridSub}},
          axisLabel:{color:C.textDim,fontSize:9,formatter:function(v){return _fmtAxisVal(Math.abs(v));}},
          axisLine:{show:false}});
        series.push({type:'bar',data:bids.map(function(v){return{value:v,itemStyle:{color:'rgba(38,166,154,0.7)'}};}),
          xAxisIndex:gIdx,yAxisIndex:gIdx,barMaxWidth:6,name:'Bid',stack:'bo'});
        series.push({type:'bar',data:offers.map(function(v){return{value:v,itemStyle:{color:'rgba(239,83,80,0.7)'}};}),
          xAxisIndex:gIdx,yAxisIndex:gIdx,barMaxWidth:6,name:'Offer',stack:'bo'});
      }
      else if(sc==='macd'){
        var md=_calcMACD(closes,_ind.macd.fast,_ind.macd.slow,_ind.macd.signal);
        yAxes.push({type:'value',gridIndex:gIdx,scale:true,splitNumber:2,position:'right',
          splitLine:{lineStyle:{color:C.gridSub}},axisLabel:{color:C.textDim,fontSize:9},axisLine:{show:false}});
        series.push({type:'line',data:md.macd,xAxisIndex:gIdx,yAxisIndex:gIdx,smooth:false,symbol:'none',lineStyle:{width:1.2,color:'#2196F3'},name:'MACD'});
        series.push({type:'line',data:md.signal,xAxisIndex:gIdx,yAxisIndex:gIdx,smooth:false,symbol:'none',lineStyle:{width:1.2,color:'#FF9800'},name:'Signal'});
        series.push({type:'bar',data:md.hist.map(function(v){return{value:v,itemStyle:{color:v>=0?'rgba(38,166,154,0.7)':'rgba(239,83,80,0.7)'}};}),
          xAxisIndex:gIdx,yAxisIndex:gIdx,barMaxWidth:4});
      }
      else if(sc==='freq'){
        var freqs=data.map(function(r){return r.frequency||0;});
        yAxes.push({type:'value',gridIndex:gIdx,scale:false,splitNumber:2,position:'right',
          splitLine:{lineStyle:{color:C.gridSub}},
          axisLabel:{color:C.textDim,fontSize:9,formatter:_fmtAxisVal},axisLine:{show:false}});
        series.push({type:'bar',data:freqs.map(function(v,i){
          var bull=ohlc[i]?ohlc[i][1]>=ohlc[i][0]:true;
          return{value:v,itemStyle:{color:bull?'rgba(255,152,0,0.6)':'rgba(255,152,0,0.3)'}};
        }),xAxisIndex:gIdx,yAxisIndex:gIdx,barMaxWidth:6,name:'Freq'});
      }
      else if(sc==='rsi'){
        var rsiData=_calcRSI(closes,_ind.rsi.period);
        yAxes.push({type:'value',gridIndex:gIdx,scale:false,splitNumber:2,position:'right',
          min:0,max:100,
          splitLine:{lineStyle:{color:C.gridSub}},axisLabel:{color:C.textDim,fontSize:9},axisLine:{show:false}});
        series.push({type:'line',data:rsiData,xAxisIndex:gIdx,yAxisIndex:gIdx,smooth:false,symbol:'none',
          lineStyle:{width:1.5,color:_ind.rsi.color},name:'RSI',
          markLine:{symbol:'none',silent:true,animation:false,data:[
            {yAxis:70,lineStyle:{color:'rgba(239,83,80,0.4)',width:1,type:'dashed'},label:{formatter:'70',position:'end',color:'#EF5350',fontSize:8}},
            {yAxis:30,lineStyle:{color:'rgba(38,166,154,0.4)',width:1,type:'dashed'},label:{formatter:'30',position:'end',color:'#26A69A',fontSize:8}}
          ]}
        });
      }
      else if(sc==='drawdown'){
        // Bloomberg-style drawdown % from peak
        var ddData=[],pk=0;
        for(var di=0;di<closes.length;di++){if(closes[di]>pk)pk=closes[di];ddData.push(pk>0?Math.round((closes[di]-pk)/pk*10000)/100:0);}
        yAxes.push({type:'value',gridIndex:gIdx,scale:true,splitNumber:3,position:'right',max:0,
          splitLine:{lineStyle:{color:C.gridSub}},
          axisLabel:{color:C.textDim,fontSize:9,formatter:function(v){return v.toFixed(0)+'%';}},
          axisLine:{show:false}});
        series.push({type:'line',data:ddData,xAxisIndex:gIdx,yAxisIndex:gIdx,smooth:false,symbol:'none',
          lineStyle:{width:0.8,color:'#EF5350'},name:'Drawdown',
          areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,
            colorStops:[{offset:0,color:'rgba(239,83,80,0.05)'},{offset:1,color:'rgba(239,83,80,0.5)'}]}},
          markLine:{symbol:'none',silent:true,animation:false,data:[
            {yAxis:0,lineStyle:{color:'#555',width:1},label:{show:false}}
          ]}
        });
      }
      gIdx++;
    });

    // DataZoom
    var xList=[];for(var i=0;i<xAxes.length;i++)xList.push(i);
    var zS=Math.max(0,100-Math.min(100,200/data.length*100));

    // Trendline graphics
    var graphic=[];
    _drawings.forEach(function(d){
      if(d.type==='trendline'&&_inst){
        var p0=_inst.convertToPixel({seriesIndex:0},[d.x0,d.y0]);
        var p1=_inst.convertToPixel({seriesIndex:0},[d.x1,d.y1]);
        if(p0&&p1)graphic.push({type:'line',shape:{x1:p0[0],y1:p0[1],x2:p1[0],y2:p1[1]},style:{stroke:'#FF9800',lineWidth:1.5},z:100,silent:true});
      }
    });

    _inst.clear();
    // Stats overlay graphic for Bloomberg area mode
    var graphicItems=graphic.length?graphic:[];
    if(_chartStyle==='area'&&typeof statsHtml!=='undefined'){
      graphicItems.push({type:'text',left:65,top:22,style:{text:_code+' | Last '+lastClose.toLocaleString()+' | High '+Math.max.apply(null,closes).toLocaleString()+' | Low '+Math.min.apply(null,closes.filter(function(v){return v>0})).toLocaleString()+' | Avg '+Math.round(closes.reduce(function(s,v){return s+v},0)/closes.length).toLocaleString(),fill:'#aaa',fontSize:11,fontFamily:'IBM Plex Mono'},z:100});
    }
    _inst.setOption({
      animation:false,backgroundColor:C.bg,
      graphic:graphicItems.length?graphicItems:undefined,
      grid:grids,xAxis:xAxes,yAxis:yAxes,series:series,
      dataZoom:[
        {type:'inside',xAxisIndex:xList,start:zS,end:100,zoomOnMouseWheel:true,moveOnMouseMove:true},
        {type:'slider',xAxisIndex:xList,bottom:0,height:16,borderColor:'transparent',backgroundColor:'rgba(0,0,0,0)',
          fillerColor:'rgba(33,150,243,0.1)',handleStyle:{color:'#2196F3'},textStyle:{color:C.text,fontSize:9},start:zS,end:100}
      ],
      tooltip:{
        trigger:'axis',confine:true,
        axisPointer:{type:'cross',crossStyle:{color:C.cross},lineStyle:{color:C.cross,type:'dashed'}},
        backgroundColor:C.tooltip,borderColor:'#333',
        textStyle:{color:C.textBright,fontSize:11,fontFamily:'IBM Plex Mono'},
        formatter:function(params){
          if(!params||!params.length)return'';
          var d=params[0].axisValue;
          if(_chartStyle==='area'){
            // Area mode — show close + drawdown + sub values
            var cp=params.find(function(p){return p.seriesName==='Close';});
            var dd=params.find(function(p){return p.seriesName==='Drawdown';});
            var h='<div style="margin-bottom:3px"><b style="font-size:12px">'+_code+'</b> <span style="color:#888;font-size:10px">'+d+'</span></div>';
            if(cp&&cp.data)h+='<div style="font-size:12px;font-weight:700;color:#fff">'+Number(cp.data).toLocaleString()+'</div>';
            if(dd&&dd.data!==null&&dd.data!==undefined)h+='<div style="font-size:10px;color:#EF5350;margin-top:2px">DD '+Number(dd.data).toFixed(1)+'%</div>';
            params.forEach(function(p){
              if(p.seriesName==='Vol'){var vv=typeof p.data==='object'?p.data.value:p.data;if(vv)h+='<div style="font-size:10px;color:#888;margin-top:2px">Vol '+_fN(vv)+'</div>';}
              if(p.seriesName==='F.Net'){var vv=typeof p.data==='object'?p.data.value:p.data;if(vv)h+='<div style="font-size:10px;color:'+(vv>=0?C.bull:C.bear)+';margin-top:2px">F.Net '+_fN(vv)+'</div>';}
            });
            return h;
          }
          // Candlestick mode
          var cs=params.find(function(p){return p.seriesType==='candlestick';});
          if(!cs)return d;
          var v=cs.data;
          var chg=v[0]?((v[1]-v[0])/v[0]*100):0;
          var chgColor=chg>=0?C.bull:C.bear;
          var chgSign=chg>=0?'+':'';
          var h='<div style="margin-bottom:3px"><b style="font-size:12px">'+_code+'</b> <span style="color:#888;font-size:10px">'+d+'</span></div>';
          h+='<div style="display:flex;gap:12px;font-size:11px">';
          h+='<span><span style="color:#888">O</span> '+(v[0]||0).toLocaleString()+'</span>';
          h+='<span><span style="color:#888">H</span> '+(v[3]||0).toLocaleString()+'</span>';
          h+='<span><span style="color:#888">L</span> '+(v[2]||0).toLocaleString()+'</span>';
          h+='<span style="color:'+chgColor+';font-weight:700"><span style="color:#888">C</span> '+(v[1]||0).toLocaleString()+'</span>';
          h+='<span style="color:'+chgColor+';font-size:10px">'+chgSign+chg.toFixed(2)+'%</span>';
          h+='</div>';
          // Sub-chart values
          params.forEach(function(p){
            if(p.seriesName==='Vol'){var vv=typeof p.data==='object'?p.data.value:p.data;if(vv)h+='<div style="font-size:10px;color:#888;margin-top:2px">Vol '+_fN(vv)+'</div>';}
            if(p.seriesName==='F.Net'){var vv=typeof p.data==='object'?p.data.value:p.data;if(vv)h+='<div style="font-size:10px;color:'+(vv>=0?C.bull:C.bear)+';margin-top:2px">F.Net '+_fN(vv)+'</div>';}
            if(p.seriesName==='Bid'){var vv=typeof p.data==='object'?p.data.value:p.data;if(vv)h+='<div style="font-size:10px;color:#888;margin-top:1px">Bid '+_fN(vv)+'</div>';}
            if(p.seriesName==='Offer'){var vv=typeof p.data==='object'?p.data.value:p.data;if(vv)h+='<div style="font-size:10px;color:#888">Offer '+_fN(Math.abs(vv))+'</div>';}
            if(p.seriesName==='MACD'&&p.data!==null){h+='<div style="font-size:10px;color:#2196F3;margin-top:2px">MACD '+p.data+'</div>';}
            if(p.seriesName==='Signal'&&p.data!==null){h+='<div style="font-size:10px;color:#FF9800">Sig '+p.data+'</div>';}
            if(p.seriesName==='Freq'){var vv=typeof p.data==='object'?p.data.value:p.data;if(vv)h+='<div style="font-size:10px;color:#FF9800;margin-top:2px">Freq '+_fN(vv)+'</div>';}
            if(p.seriesName==='RSI'&&p.data!==null){var rv=typeof p.data==='number'?p.data:0;var rc=rv>=70?C.bear:rv<=30?C.bull:'#AB47BC';h+='<div style="font-size:10px;color:'+rc+';margin-top:2px">'+_e(_ind.rsi.label)+' '+rv.toFixed(1)+'</div>';}
          });
          return h;
        }
      },
      axisPointer:{
        link:[{xAxisIndex:'all'}],
        label:{backgroundColor:'#1a1a2e',color:C.textBright,fontSize:10,formatter:function(p){
          if(p.axisDimension==='y'){
            var v=p.value;
            return v>=1e6?(v/1e6).toFixed(1)+'M':v>=1000?Math.round(v).toLocaleString():v.toFixed(0);
          }
          return p.value;
        }}
      }
    });
  }

  // ═══ RESAMPLE ═══
  function _resample(data,mode){
    if(!data.length)return data;
    var g={};
    data.forEach(function(r){
      var d=r.trade_date,key;
      if(mode==='W'){var dt=new Date(d),day=dt.getDay()||7;dt.setDate(dt.getDate()+4-day);var ys=new Date(dt.getFullYear(),0,1);key=dt.getFullYear()+'-W'+('0'+Math.ceil(((dt-ys)/86400000+1)/7)).slice(-2);}
      else key=d.substring(0,7);
      if(!g[key])g[key]=[];g[key].push(r);
    });
    return Object.keys(g).sort().map(function(k){
      var a=g[k],f=a[0],l=a[a.length-1];
      return{
        trade_date:l.trade_date,
        adj_open:f.adj_open||f.open_price,adj_close:l.adj_close||l.close,
        adj_high:Math.max.apply(null,a.map(function(r){return r.adj_high||r.high;})),
        adj_low:Math.min.apply(null,a.map(function(r){return r.adj_low||r.low;})),
        adj_volume:a.reduce(function(s,r){return s+(r.adj_volume||r.volume||0);},0),
        volume:a.reduce(function(s,r){return s+(r.volume||0);},0),
        prev_close:f.prev_close||0,open_price:f.open_price||f.adj_open,close:l.close||l.adj_close,
        high:Math.max.apply(null,a.map(function(r){return r.high||r.adj_high;})),
        low:Math.min.apply(null,a.map(function(r){return r.low||r.adj_low;})),
        foreign_buy:a.reduce(function(s,r){return s+(r.foreign_buy||0);},0),
        foreign_sell:a.reduce(function(s,r){return s+(r.foreign_sell||0);},0),
        bid_vol:a.reduce(function(s,r){return s+(r.bid_vol||0);},0),
        offer_vol:a.reduce(function(s,r){return s+(r.offer_vol||0);},0),
        frequency:a.reduce(function(s,r){return s+(r.frequency||0);},0)
      };
    });
  }

  // ═══ INDICATORS ═══
  function _calcMA(c,p){var r=[];for(var i=0;i<c.length;i++){if(i<p-1){r.push(null);continue;}var s=0;for(var j=i-p+1;j<=i;j++)s+=c[j];r.push(Math.round(s/p*100)/100);}return r;}
  function _calcBB(c,p,std){var mid=_calcMA(c,p),u=[],l=[];for(var i=0;i<c.length;i++){if(mid[i]===null){u.push(null);l.push(null);continue;}var s=0;for(var j=i-p+1;j<=i;j++)s+=Math.pow(c[j]-mid[i],2);var sd=Math.sqrt(s/p);u.push(Math.round((mid[i]+std*sd)*100)/100);l.push(Math.round((mid[i]-std*sd)*100)/100);}return{u:u,m:mid,l:l};}
  function _calcMACD(c,fast,slow,sig){function ema(d,p){var k=2/(p+1),r=[d[0]];for(var i=1;i<d.length;i++)r.push(d[i]*k+r[i-1]*(1-k));return r;}var ef=ema(c,fast),es=ema(c,slow);var ml=ef.map(function(v,i){return Math.round((v-es[i])*100)/100;});var sl=ema(ml,sig);var hl=ml.map(function(v,i){return Math.round((v-sl[i])*100)/100;});for(var i=0;i<slow;i++){ml[i]=null;sl[i]=null;hl[i]=null;}return{macd:ml,signal:sl,hist:hl};}
  function _calcRSI(c,p){var r=[];for(var i=0;i<c.length;i++){if(i<p){r.push(null);continue;}var gain=0,loss=0;for(var j=i-p+1;j<=i;j++){var d=c[j]-c[j-1];if(d>0)gain+=d;else loss-=d;}var avgG=gain/p,avgL=loss/p;if(avgL===0){r.push(100);}else{var rs=avgG/avgL;r.push(Math.round((100-100/(1+rs))*100)/100);}}return r;}

  // ═══ HELPERS ═══
  function $i(id){return document.getElementById(id);}
  function _fN(v){if(!v)return'0';var a=Math.abs(v),sg=v<0?'-':'';if(a>=1e12)return sg+(a/1e12).toFixed(2)+'T';if(a>=1e9)return sg+(a/1e9).toFixed(2)+'B';if(a>=1e6)return sg+(a/1e6).toFixed(2)+'M';if(a>=1e3)return sg+(a/1e3).toFixed(1)+'K';return v.toLocaleString();}
  function _fmtAxisVal(v){if(!v)return'';var a=Math.abs(v);if(a>=1e12)return(v/1e12).toFixed(0)+'T';if(a>=1e9)return(v/1e9).toFixed(0)+'B';if(a>=1e6)return(v/1e6).toFixed(0)+'M';if(a>=1e3)return(v/1e3).toFixed(0)+'K';return'';}
  function _fmtPrice(v){if(!v)return'0';return v>=1000&&v%1===0?Math.round(v).toLocaleString():v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});}
  function _e(s){return typeof s==='string'?s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):String(s||'');}

  // ═══ RESIZE ALL BL ECHARTS INSTANCES ═══
  // Called when chart panel opens/closes/resizes so Compare, Scoring, etc. don't get clipped
  function _resizeBLInstances(){
    if(typeof BL!=='undefined'&&BL._instances){
      Object.keys(BL._instances).forEach(function(k){
        try{var c=BL._instances[k];if(c&&!c.isDisposed())c.resize();}catch(e){}
      });
    }
  }

  window.addEventListener('resize',function(){if(_inst&&_open)_inst.resize();});
  // ResizeObserver for reliable resize when panel width changes
  try{
    var _ro=new ResizeObserver(function(){if(_inst&&_open)_inst.resize();});
    document.addEventListener('DOMContentLoaded',function(){
      var body=document.getElementById('chart-body');
      if(body)_ro.observe(body);
    });
  }catch(e){}

  window._chartGetState=function(){return{code:_code,data:_data,indicators:_ind,tf:_tf,type:_type};};
  window._chartAddIndicator=function(opts){console.log('[Chart] addIndicator placeholder',opts);};

})();
