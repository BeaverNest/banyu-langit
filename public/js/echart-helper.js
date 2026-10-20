// ═══ BANYU LANGIT — ECharts Helper ═══
// Bloomberg dark theme, shared config, auto-resize, dispose management

var BL = BL || {};

// ═══ THEME ═══
BL.theme = {
  color: ['#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#3ba272','#fc8452','#9a60b4','#ea7ccc'],
  backgroundColor: 'transparent',
  textStyle: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: '#8a9bb5' },
  title: { textStyle: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, fontWeight: 700, color: '#c5cdd8' }, subtextStyle: { fontSize: 9, color: '#8a9bb5' } },
  legend: { textStyle: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: '#8a9bb5' }, pageTextStyle: { color: '#8a9bb5' }, itemWidth: 14, itemHeight: 8 },
  tooltip: {
    backgroundColor: 'rgba(15,20,30,0.95)', borderColor: '#2a3444', borderWidth: 1,
    textStyle: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: '#e0e6ed' },
    extraCssText: 'box-shadow:0 4px 20px rgba(0,0,0,.5);backdrop-filter:blur(8px);border-radius:6px;'
  },
  grid: { containLabel: false },
  categoryAxis: {
    axisLine: { lineStyle: { color: '#2a3444' } },
    axisTick: { lineStyle: { color: '#2a3444' } },
    axisLabel: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: '#6b7a8d' },
    splitLine: { lineStyle: { color: '#1e2836', type: 'dashed' } }
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: '#6b7a8d' },
    splitLine: { lineStyle: { color: '#1e2836', type: 'dashed' } }
  },
  dataZoom: [
    { type: 'inside', filterMode: 'filter' },
    { type: 'slider', height: 16, bottom: 4, borderColor: '#2a3444', fillerColor: 'rgba(84,112,198,0.15)',
      handleStyle: { color: '#5470c6', borderColor: '#5470c6' },
      textStyle: { fontSize: 8, color: '#6b7a8d' }, dataBackground: { lineStyle: { color: '#3a4a5a' }, areaStyle: { color: 'rgba(84,112,198,0.08)' } } }
  ]
};

// Register theme once
(function() {
  if (typeof echarts !== 'undefined' && !BL._themeRegistered) {
    echarts.registerTheme('banyu', BL.theme);
    BL._themeRegistered = true;
  }
})();

// ═══ INSTANCE MANAGEMENT ═══
BL._instances = {};

BL.init = function(el, key) {
  if (!el || typeof echarts === 'undefined') return null;
  // Register theme if not done
  if (!BL._themeRegistered) { echarts.registerTheme('banyu', BL.theme); BL._themeRegistered = true; }
  // Dispose old instance
  if (key && BL._instances[key]) { try { BL._instances[key].dispose(); } catch(e){} }
  var chart = echarts.init(el, 'banyu', { renderer: 'canvas' });
  if (key) BL._instances[key] = chart;
  return chart;
};

BL.dispose = function(key) {
  if (BL._instances[key]) { try { BL._instances[key].dispose(); } catch(e){} delete BL._instances[key]; }
};

BL.disposeAll = function() {
  Object.keys(BL._instances).forEach(function(k) { BL.dispose(k); });
};

// ═══ AUTO RESIZE ═══
(function() {
  var resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      Object.keys(BL._instances).forEach(function(k) {
        var c = BL._instances[k];
        if (c && !c.isDisposed()) c.resize();
      });
    }, 150);
  });
})();

// ═══ COLORS ═══
BL.colors = {
  green: '#22c55e', red: '#ef4444', blue: '#5470c6', amber: '#f59e0b', white: '#e0e6ed',
  greenBg: 'rgba(34,197,94,0.08)', redBg: 'rgba(239,68,68,0.08)', blueBg: 'rgba(84,112,198,0.08)',
  grid: '#1e2836', border: '#2a3444', text: '#8a9bb5', textDim: '#6b7a8d', textBright: '#c5cdd8',
  // Series palette (10 colors)
  series: ['#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#3ba272','#fc8452','#9a60b4','#ea7ccc','#67C2A5']
};

// ═══ COMMON OPTIONS ═══

// Tooltip formatter for Rp values
BL.fmtRp = function(n) {
  if (!n) return '0';
  var a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e12) return s + (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(2) + 'K';
  return n.toLocaleString();
};

// Standard grid with padding
BL.grid = function(opt) {
  return Object.assign({ left: 55, right: 55, top: 28, bottom: 36, containLabel: false }, opt || {});
};

// Standard dataZoom (inside + slider)
BL.dataZoom = function(opt) {
  return [
    { type: 'inside', filterMode: 'filter' },
    Object.assign({
      type: 'slider', height: 16, bottom: 2, borderColor: '#2a3444',
      fillerColor: 'rgba(84,112,198,0.15)',
      handleStyle: { color: '#5470c6', borderColor: '#5470c6' },
      textStyle: { fontSize: 8, color: '#6b7a8d' },
      dataBackground: { lineStyle: { color: '#3a4a5a' }, areaStyle: { color: 'rgba(84,112,198,0.08)' } }
    }, opt || {})
  ];
};

// Create container div with standard styling
BL.container = function(id, height) {
  return '<div id="' + id + '" style="width:100%;height:' + (height || 220) + 'px;min-height:120px"></div>';
};
