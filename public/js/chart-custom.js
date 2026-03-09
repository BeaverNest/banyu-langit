// ═══ Custom Chart — Lightweight Charts v4 ═══
// Fix: data range, button labels, MACD separate area, indicator popup
var chartInstance = null;
var chartSeries = {};
var chartCode = 'COMPOSITE';
var chartRange = '6m';
var chartInterval = 'D';
var chartData = null;
var chartIndicators = {};
try { chartIndicators = JSON.parse(localStorage.getItem('chartInd')) || {}; } catch(e) {}
if (!chartIndicators.ma) chartIndicators.ma = { 20: true, 200: true };
if (chartIndicators.volume === undefined) chartIndicators.volume = true;
if (chartIndicators.caMarkers === undefined) chartIndicators.caMarkers = true;
if (chartIndicators.macd === undefined) chartIndicators.macd = false;
if (!chartIndicators.macdParams) chartIndicators.macdParams = { fast: 12, slow: 26, signal: 9 };
function saveChartInd() { localStorage.setItem('chartInd', JSON.stringify(chartIndicators)); }

var MA_COLORS = { 5:'#f59e0b', 10:'#a855f7', 20:'#0ea5e9', 50:'#22c55e', 100:'#ec4899', 200:'#ef4444' };

// ═══ MAIN ENTRY ═══
function loadChart() {
  var c = $('chart'); if (!c) return;
  c.innerHTML = '';
  c.style.cssText = 'display:flex;flex-direction:column;height:100%';

  // Toolbar
  var tb = document.createElement('div'); tb.id = 'chart-toolbar';
  tb.style.cssText = 'display:flex;gap:3px;padding:6px 8px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--b1);background:var(--bg1)';
  tb.innerHTML = buildToolbar(); c.appendChild(tb);

  // Main chart area (candlestick + volume)
  var main = document.createElement('div'); main.id = 'chart-main';
  main.style.cssText = 'flex:3;position:relative;min-height:0';
  c.appendChild(main);

  // MACD chart area (separate, below main)
  var macdArea = document.createElement('div'); macdArea.id = 'chart-macd';
  macdArea.style.cssText = 'flex:1;position:relative;min-height:0;border-top:1px solid var(--b1);display:' + (chartIndicators.macd ? 'block' : 'none');
  c.appendChild(macdArea);

  loadChartData();
}

function buildToolbar() {
  var h = '<input id="chart-ticker" style="width:80px;padding:3px 6px;border:1px solid var(--b2);border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase;background:var(--bg0);color:var(--t1);font-family:var(--fm)" value="' + chartCode + '" onkeydown="if(event.key===\'Enter\'){chartCode=this.value.toUpperCase();loadChartData()}">';
  h += '<button class="bei-sort-btn" onclick="chartCode=$(\'chart-ticker\').value.toUpperCase();loadChartData()" style="padding:2px 6px;font-size:9px">Go</button>';

  // Separator
  h += '<span style="width:1px;height:14px;background:var(--b2);margin:0 4px"></span>';

  // Interval: D W M (candle size)
  [{k:'D',l:'D'},{k:'W',l:'W'},{k:'M',l:'M'}].forEach(function(r) {
    h += '<button class="bei-sort-btn' + (chartInterval === r.k ? ' on' : '') + '" onclick="chartInterval=\'' + r.k + '\';rebuildChart()" style="padding:2px 7px;font-size:9px;font-weight:700">' + r.l + '</button>';
  });

  h += '<span style="width:1px;height:14px;background:var(--b2);margin:0 4px"></span>';

  // Range: 1m 3m 6m 1y 3y ALL (how far back)
  [{k:'1m',l:'1m'},{k:'3m',l:'3m'},{k:'6m',l:'6m'},{k:'1y',l:'1y'},{k:'3y',l:'3y'},{k:'all',l:'ALL'}].forEach(function(r) {
    h += '<button class="bei-sort-btn' + (chartRange === r.k ? ' on' : '') + '" onclick="chartRange=\'' + r.k + '\';rebuildChart()" style="padding:2px 6px;font-size:9px">' + r.l + '</button>';
  });

  h += '<span style="flex:1"></span>';
  h += '<button class="bei-sort-btn" onclick="openChartIndModal()" style="padding:2px 8px;font-size:9px">⚙ Indicators</button>';
  return h;
}

// ═══ INDICATOR MODAL (popup, not inline) ═══
function openChartIndModal() {
  var existing = $('chart-ind-modal'); if (existing) existing.remove();
  var ma = chartIndicators.ma || {};
  var mp = chartIndicators.macdParams || {fast:12,slow:26,signal:9};

  var h = '<div class="epop o" id="chart-ind-modal" onclick="if(event.target===this)this.remove()">';
  h += '<div class="scr-modal" style="max-width:420px">';
  h += '<div class="scr-modal-h"><span>⚙ Chart Indicators</span><button onclick="$(\'chart-ind-modal\').remove()">✕</button></div>';
  h += '<div class="scr-modal-body" style="padding:16px 20px">';

  // MA section
  h += '<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:8px">Moving Averages</div>';
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">';
  [5,10,20,50,100,200].forEach(function(n) {
    var on = ma[n];
    h += '<button class="scr-col' + (on ? ' on' : '') + '" onclick="chartIndicators.ma[' + n + ']=!chartIndicators.ma[' + n + '];saveChartInd();openChartIndModal();rebuildChart()" style="font-size:10px;padding:4px 10px;border-color:' + MA_COLORS[n] + (on ? ';background:' + MA_COLORS[n] + ';color:#fff' : '') + '">SMA ' + n + '</button>';
  });
  h += '</div>';

  // Volume
  h += '<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:8px">Overlays</div>';
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">';
  h += '<button class="scr-col' + (chartIndicators.volume ? ' on' : '') + '" onclick="chartIndicators.volume=!chartIndicators.volume;saveChartInd();openChartIndModal();rebuildChart()" style="font-size:10px;padding:4px 10px">📊 Volume</button>';
  h += '<button class="scr-col' + (chartIndicators.caMarkers ? ' on' : '') + '" onclick="chartIndicators.caMarkers=!chartIndicators.caMarkers;saveChartInd();openChartIndModal();rebuildChart()" style="font-size:10px;padding:4px 10px">⚡ CA Markers</button>';
  h += '</div>';

  // MACD
  h += '<div style="font-size:11px;font-weight:700;color:var(--t2);margin-bottom:8px">Oscillators</div>';
  h += '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">';
  h += '<button class="scr-col' + (chartIndicators.macd ? ' on' : '') + '" onclick="chartIndicators.macd=!chartIndicators.macd;saveChartInd();openChartIndModal();rebuildChart()" style="font-size:10px;padding:4px 10px">📉 MACD</button>';
  if (chartIndicators.macd) {
    h += '<span style="font-size:10px;color:var(--t3)">Fast:</span>';
    h += '<input style="width:32px;text-align:center;border:1px solid var(--b2);border-radius:4px;font-size:10px;padding:3px;background:var(--bg0);color:var(--t1)" value="' + mp.fast + '" onchange="chartIndicators.macdParams.fast=parseInt(this.value)||12;saveChartInd();rebuildChart()">';
    h += '<span style="font-size:10px;color:var(--t3)">Slow:</span>';
    h += '<input style="width:32px;text-align:center;border:1px solid var(--b2);border-radius:4px;font-size:10px;padding:3px;background:var(--bg0);color:var(--t1)" value="' + mp.slow + '" onchange="chartIndicators.macdParams.slow=parseInt(this.value)||26;saveChartInd();rebuildChart()">';
    h += '<span style="font-size:10px;color:var(--t3)">Signal:</span>';
    h += '<input style="width:32px;text-align:center;border:1px solid var(--b2);border-radius:4px;font-size:10px;padding:3px;background:var(--bg0);color:var(--t1)" value="' + mp.signal + '" onchange="chartIndicators.macdParams.signal=parseInt(this.value)||9;saveChartInd();rebuildChart()">';
  }
  h += '</div>';

  // Info
  h += '<div style="font-size:9px;color:var(--t3);margin-top:12px;padding-top:8px;border-top:1px solid var(--b1)">';
  h += 'MACD shows as separate panel below price chart. Click indicators to toggle on/off.';
  h += '</div>';

  h += '</div></div></div>';
  document.body.insertAdjacentHTML('beforeend', h);
}

// ═══ DATA LOADING ═══
async function loadChartData() {
  var main = $('chart-main'); if (!main) return;
  if (chartCode === 'COMPOSITE' || chartCode === 'IHSG') { loadChartTradingView(main); return; }
  main.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--t3)">Loading ' + chartCode + '...</div>';
  try {
    var r = await fetch('/api/idx/adjusted/' + chartCode);
    chartData = await r.json();
    if (!chartData.data || !chartData.data.length) { main.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--t3)">No data for ' + chartCode + '</div>'; return; }
    buildCharts();
  } catch(e) { main.innerHTML = '<div class="ne">Error: ' + e.message + '</div>'; }
}

function loadChartTradingView(area) {
  var th = document.documentElement.getAttribute('data-theme') || 'light';
  var bg = th === 'dark' ? '#0F0F0F' : '#ffffff';
  var cfg = JSON.stringify({"allow_symbol_change":true,"calendar":false,"details":false,"hide_side_toolbar":true,"hide_top_toolbar":true,"hide_legend":false,"hide_volume":false,"interval":"D","locale":"en","style":"1","symbol":"IDX:COMPOSITE","theme":th,"timezone":"Asia/Jakarta","backgroundColor":bg,"withdateranges":false,"range":"YTD","studies":["STD;SMA"],"autosize":true});
  area.innerHTML = ''; var f = document.createElement('iframe'); f.style.cssText = 'width:100%;height:100%;border:none'; area.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write('<!DOCTYPE html><html><head><style>body{margin:0;overflow:hidden;height:100vh}</style></head><body><div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div><script src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>' + cfg + '<\/script></div></body></html>'); f.contentDocument.close();
  // Hide MACD area for composite
  var ma = $('chart-macd'); if (ma) ma.style.display = 'none';
}

// ═══ AGGREGATION ═══
function aggregateData(data, interval) {
  if (interval === 'D') return data;
  var groups = {};
  data.forEach(function(r) {
    var key;
    if (interval === 'W') {
      // Get Monday of the week
      var d = new Date(r.trade_date + 'T00:00:00');
      var day = d.getDay(); var diff = day === 0 ? 6 : day - 1;
      d.setDate(d.getDate() - diff);
      key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    } else {
      key = r.trade_date.substring(0, 7) + '-01';
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });
  return Object.keys(groups).sort().map(function(key) {
    var b = groups[key], o = b[0], c = b[b.length - 1];
    return {
      trade_date: key,
      adj_open: o.adj_open || o.open_price, open_price: o.open_price,
      adj_high: Math.max.apply(null, b.map(function(x){return x.adj_high||x.high;})),
      adj_low: Math.min.apply(null, b.map(function(x){return x.adj_low||x.low;})),
      adj_close: c.adj_close || c.close, close: c.close,
      adj_volume: b.reduce(function(s,x){return s+(x.adj_volume||x.volume||0);},0),
      volume: b.reduce(function(s,x){return s+(x.volume||0);},0),
    };
  });
}

function filterByRange(data, range) {
  if (range === 'all' || !data.length) return data;
  var lastDate = data[data.length - 1].trade_date;
  var y = parseInt(lastDate.substring(0,4)), m = parseInt(lastDate.substring(5,7)) - 1, d = parseInt(lastDate.substring(8,10));
  var cutoff = new Date(y, m, d);
  if (range === '1m') cutoff.setMonth(cutoff.getMonth() - 1);
  else if (range === '3m') cutoff.setMonth(cutoff.getMonth() - 3);
  else if (range === '6m') cutoff.setMonth(cutoff.getMonth() - 6);
  else if (range === '1y') cutoff.setFullYear(cutoff.getFullYear() - 1);
  else if (range === '3y') cutoff.setFullYear(cutoff.getFullYear() - 3);
  else return data;
  var cutStr = cutoff.getFullYear() + '-' + String(cutoff.getMonth()+1).padStart(2,'0') + '-' + String(cutoff.getDate()).padStart(2,'0');
  return data.filter(function(r) { return r.trade_date >= cutStr; });
}

// ═══ BUILD BOTH CHARTS ═══
function buildCharts() {
  var mainEl = $('chart-main'); if (!mainEl) return;
  var macdEl = $('chart-macd'); if (!macdEl) return;
  mainEl.innerHTML = ''; macdEl.innerHTML = '';

  var th = document.documentElement.getAttribute('data-theme') || 'light', isDark = th === 'dark';
  var data = aggregateData(filterByRange(chartData.data, chartRange), chartInterval);
  if (!data.length) { mainEl.innerHTML = '<div class="ne" style="padding:40px">No data in range</div>'; return; }

  var showMACD = chartIndicators.macd && data.length >= 26;
  macdEl.style.display = showMACD ? 'block' : 'none';

  var opts = {
    layout: { background: { type: 'solid', color: isDark ? '#0F0F0F' : '#fff' }, textColor: isDark ? '#9ca3af' : '#6b7280', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 },
    grid: { vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }, horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: isDark ? '#333' : '#ddd' },
    timeScale: { borderColor: isDark ? '#333' : '#ddd', timeVisible: false },
  };

  // ── Main chart (candlestick + MA + volume) ──
  chartInstance = LightweightCharts.createChart(mainEl, { ...opts, width: mainEl.offsetWidth, height: mainEl.offsetHeight });
  chartSeries = {};

  chartSeries.candle = chartInstance.addCandlestickSeries({ upColor: '#22c55e', downColor: '#ef4444', borderDownColor: '#ef4444', borderUpColor: '#22c55e', wickDownColor: '#ef4444', wickUpColor: '#22c55e' });
  chartSeries.candle.setData(data.map(function(r) { return { time: r.trade_date, open: r.adj_open, high: r.adj_high, low: r.adj_low, close: r.adj_close }; }));

  if (chartIndicators.volume) {
    chartSeries.volume = chartInstance.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
    chartInstance.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartSeries.volume.setData(data.map(function(r) {
      return { time: r.trade_date, value: r.adj_volume || r.volume, color: (r.adj_close >= r.adj_open) ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)' };
    }));
  }

  // MA lines
  var closes = data.map(function(r){return r.adj_close;}), dates = data.map(function(r){return r.trade_date;});
  var ma = chartIndicators.ma || {};
  [5,10,20,50,100,200].forEach(function(period) {
    if (!ma[period] || closes.length < period) return;
    chartSeries['ma'+period] = chartInstance.addLineSeries({ color: MA_COLORS[period], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    var d = [];
    for (var i = period-1; i < closes.length; i++) { var s=0; for (var j=i-period+1;j<=i;j++) s+=closes[j]; d.push({time:dates[i],value:Math.round(s/period)}); }
    chartSeries['ma'+period].setData(d);
  });

  // CA markers
  if (chartIndicators.caMarkers && chartData.actions && chartData.actions.length) {
    var ds={}; data.forEach(function(d){ds[d.trade_date]=1;});
    var markers = chartData.actions.filter(function(ca){return ds[ca.ex_date];}).map(function(ca) {
      return { time:ca.ex_date, position:'aboveBar', color:ca.action_type==='split'?'#f59e0b':'#a855f7', shape:'arrowDown', text:(ca.action_type||'CA')+' '+(ca.ratio||'')+'x' };
    });
    if (markers.length) chartSeries.candle.setMarkers(markers);
  }

  chartInstance.timeScale().fitContent();

  // ── MACD chart (separate instance below) ──
  if (showMACD) {
    var macdChart = LightweightCharts.createChart(macdEl, { ...opts, width: macdEl.offsetWidth, height: macdEl.offsetHeight,
      rightPriceScale: { ...opts.rightPriceScale, scaleMargins: { top: 0.1, bottom: 0.1 } }
    });
    chartSeries._macdChart = macdChart;

    var p = chartIndicators.macdParams;
    function ema(arr,per){var k=2/(per+1),r=[arr[0]];for(var i=1;i<arr.length;i++)r.push(arr[i]*k+r[i-1]*(1-k));return r;}
    var ef=ema(closes,p.fast), es=ema(closes,p.slow);
    var ml=ef.map(function(v,i){return v-es[i];});
    var slRaw=ema(ml.slice(p.slow-1),p.signal);
    var sl=new Array(p.slow-1+p.signal-1).fill(null).concat(slRaw);

    // Histogram
    var hist=macdChart.addHistogramSeries({priceFormat:{type:'price',precision:1,minMove:0.1}});
    var hd=[];
    for(var i=p.slow-1;i<closes.length;i++){var sig=sl[i];var hv=sig!=null?ml[i]-sig:0;hd.push({time:dates[i],value:Math.round(hv*100)/100,color:hv>=0?'rgba(34,197,94,0.5)':'rgba(239,68,68,0.5)'});}
    hist.setData(hd);

    // MACD line
    var mLine=macdChart.addLineSeries({color:'#0ea5e9',lineWidth:1.5,priceLineVisible:false,lastValueVisible:true,crosshairMarkerVisible:true});
    var md=[];for(var i=p.slow-1;i<closes.length;i++)md.push({time:dates[i],value:Math.round(ml[i]*100)/100});
    mLine.setData(md);

    // Signal line
    var sLine=macdChart.addLineSeries({color:'#f59e0b',lineWidth:1,lineStyle:2,priceLineVisible:false,lastValueVisible:true});
    var sd=[];for(var i=0;i<sl.length;i++)if(sl[i]!=null)sd.push({time:dates[i],value:Math.round(sl[i]*100)/100});
    sLine.setData(sd);

    // Zero line
    var zLine=macdChart.addLineSeries({color:isDark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.1)',lineWidth:1,lineStyle:2,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});
    zLine.setData(dates.map(function(d){return{time:d,value:0};}));

    macdChart.timeScale().fitContent();

    // Sync time scales
    chartInstance.timeScale().subscribeVisibleLogicalRangeChange(function(range){if(range)macdChart.timeScale().setVisibleLogicalRange(range);});
    macdChart.timeScale().subscribeVisibleLogicalRangeChange(function(range){if(range)chartInstance.timeScale().setVisibleLogicalRange(range);});
  }

  // Resize handler
  if (window._chartResize) window.removeEventListener('resize', window._chartResize);
  window._chartResize = function() { resizeChart(); };
  window.addEventListener('resize', window._chartResize);
}

function rebuildChart() {
  if (!chartData) { loadChartData(); return; }
  // Cleanup
  if (chartSeries._macdChart) { chartSeries._macdChart.remove(); chartSeries._macdChart = null; }
  if (chartInstance) { chartInstance.remove(); chartInstance = null; }
  buildCharts();
  var tb = $('chart-toolbar'); if (tb) tb.innerHTML = buildToolbar();
}

function resizeChart() {
  var m = $('chart-main'), d = $('chart-macd');
  if (chartInstance && m) chartInstance.resize(m.offsetWidth, m.offsetHeight);
  if (chartSeries._macdChart && d) chartSeries._macdChart.resize(d.offsetWidth, d.offsetHeight);
}

function chartSetTicker(code) { chartCode = code.toUpperCase(); var i = $('chart-ticker'); if (i) i.value = chartCode; loadChartData(); }