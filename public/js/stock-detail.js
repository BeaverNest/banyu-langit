// ═══ STOCK DETAIL — Tabbed Layout (Stockbit-style) ═══

var sdCode = '', sdData = null, sdLoading = false, sdActiveTab = 'financials';

var PHASE_COLORS = {
  accumulation: { bg: 'rgba(34,197,94,0.12)', color: '#22c55e', icon: '▲', label: 'ACCUMULATION' },
  markup: { bg: 'rgba(14,165,233,0.12)', color: '#0ea5e9', icon: '🚀', label: 'MARKUP' },
  distribution: { bg: 'rgba(239,68,68,0.12)', color: '#ef4444', icon: '▼', label: 'DISTRIBUTION' },
  markdown: { bg: 'rgba(249,115,22,0.12)', color: '#f97316', icon: '📉', label: 'MARKDOWN' }
};

// Tinggi chart di Stock Information. Dulu tinggi di-hardcode (price 360px, funda 300px,
// flow 180px) sehingga di jendela lebar plotnya memanjang tapi tetap pendek dan terlihat
// gepeng. Sekarang diturunkan dari tinggi viewport dengan batas bawah/atas supaya tetap
// masuk akal di layar pendek maupun tinggi.
function sdChartHeight(minH, ratio, maxH) {
  var H = Math.round((window.innerHeight || 900) * ratio);
  if (H < minH) H = minH;
  if (H > maxH) H = maxH;
  return H;
}

function loadStockDetail() {
  var el = $('sd-content'); if (!el) return;
  renderSDShell(el);
  if (sdData && sdCode) renderSDBody();
}

function renderSDShell(el) {
  var h = '<div style="padding:12px;height:100%;display:flex;flex-direction:column;overflow:hidden">';
  h += '<div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-shrink:0">';
  h += '<span style="font-size:14px;font-weight:700">🔬 Stock Detail</span>';
  h += '<div style="position:relative">';
  h += '<input id="sd-ticker-input" class="bei-filter-input" style="max-width:160px;text-transform:uppercase" placeholder="Enter ticker..." value="' + esc(sdCode) + '" onkeydown="sdInputKey(event)" oninput="sdAutoComplete()" autocomplete="off">';
  h += '<div id="sd-ac-dropdown" style="display:none;position:absolute;top:100%;left:0;width:280px;max-height:240px;overflow-y:auto;background:var(--bg1);border:1px solid var(--b2);border-radius:4px;z-index:999;box-shadow:0 4px 12px rgba(0,0,0,0.5)"></div>';
  h += '</div>';
  h += '<button class="bei-tab on" style="font-size:11px;padding:4px 12px" onclick="sdLoad()">Analyze</button>';
  if (sdData) h += '<span style="font-size:10px;color:var(--t3)">' + esc(sdData.name || '') + ' · ' + (sdData.current ? sdData.current.trade_date : '') + '</span>';
  h += '</div>';
  h += '<div id="sd-body" style="flex:1;overflow-y:auto"></div>';
  h += '</div>';
  el.innerHTML = h;
}

async function sdLoad() {
  var inp = $('sd-ticker-input'); if (!inp) return;
  var code = inp.value.trim().toUpperCase(); if (!code) return;
  sdCode = code;
  var body = $('sd-body'); if (!body) return;
  body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3)">Loading ' + esc(code) + '...</div>';
  try {
    var r = await fetch('/api/idx/stock-detail/' + encodeURIComponent(code));
    sdData = await r.json();
    if (sdData.error) { body.innerHTML = '<div class="ne">' + esc(sdData.error) + '</div>'; return; }
    renderSDBody();
  } catch (e) { body.innerHTML = '<div class="ne">Error: ' + e.message + '</div>'; }
}

function renderSDBody() {
  var body = $('sd-body'); if (!body || !sdData) return;
  var d = sdData;
  var h = '';
  var cur = d.current || {};
  var chgPct = cur.prev_close > 0 ? Math.round((cur.close - cur.prev_close) / cur.prev_close * 10000) / 100 : 0;
  var chgCls = chgPct > 0 ? 'up' : chgPct < 0 ? 'dn' : '';
  var st = d.stats || {};

  // ═══ HEADER — Price + Key Stats (clean, no analysis) ═══
  h += '<div style="display:flex;align-items:center;gap:14px;padding:8px 10px;margin-bottom:6px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px;flex-wrap:wrap">';
  h += '<div style="display:flex;align-items:baseline;gap:6px">';
  h += '<span style="font-size:22px;font-weight:800;font-family:var(--fm)">' + (cur.close || 0).toLocaleString() + '</span>';
  h += '<span class="' + chgCls + '" style="font-size:14px;font-weight:700">' + (chgPct > 0 ? '+' : '') + chgPct.toFixed(2) + '%</span>';
  h += '</div>';
  h += '<span style="color:var(--b2)">│</span>';
  function _hstat(l, v, c) { return '<span style="font-size:12px;color:var(--t3)">' + l + '</span> <span style="font-size:12px;font-weight:700;font-family:var(--fm);color:' + (c||'var(--t1)') + '">' + v + '</span>'; }
  h += _hstat('Vol', fmtRp(cur.volume || 0));
  h += _hstat('Val', fmtRp(cur.value || 0));
  h += '<span style="color:var(--b2)">│</span>';
  h += _hstat('52H', (st.peak_52w || 0).toLocaleString());
  h += _hstat('52L', (st.low_52w || 0).toLocaleString());
  h += _hstat('DD', st.drawdown_from_peak + '%', st.drawdown_from_peak < -10 ? 'var(--rd)' : st.drawdown_from_peak < -5 ? 'var(--am)' : 'var(--gn)');
  h += _hstat('ATR', (st.atr || 0).toLocaleString());
  if (st.rs_vs_ihsg !== null) h += _hstat('RS', (st.rs_vs_ihsg > 0 ? '+' : '') + st.rs_vs_ihsg + '%', st.rs_vs_ihsg > 0 ? 'var(--gn)' : 'var(--rd)');
  h += '</div>';

  // ═══ PRICE CHART — Candlestick + MA ribbon only ═══
  h += '<div id="sd-price-chart" style="width:100%;height:' + sdChartHeight(440, 0.55, 640) + 'px;margin-bottom:6px"></div>';

  // ═══ TAB BAR ═══
  var tabs = [
    { id: 'financials', label: 'Financials' },
    { id: 'fundachart', label: 'Fundachart' },
    { id: 'analysis', label: 'Analysis' },
    { id: 'ownership', label: 'Ownership' },
    { id: 'flow', label: 'Flow' },
    { id: 'news', label: 'News' }
  ];
  h += '<div style="display:flex;gap:2px;margin-bottom:8px;border-bottom:2px solid var(--b1);flex-shrink:0">';
  tabs.forEach(function(t) {
    var isOn = t.id === sdActiveTab;
    h += '<button onclick="sdSwitchTab(\'' + t.id + '\')" style="padding:6px 16px;font-size:12px;font-weight:' + (isOn ? '700' : '500') + ';color:' + (isOn ? 'var(--am)' : 'var(--t3)') + ';background:transparent;border:none;border-bottom:2px solid ' + (isOn ? 'var(--am)' : 'transparent') + ';cursor:pointer;margin-bottom:-2px">' + t.label + '</button>';
  });
  h += '</div>';

  // ═══ TAB CONTENT ═══
  h += '<div id="sd-tab-content" style="flex:1;overflow-y:auto"></div>';

  body.innerHTML = h;

  // Draw price chart (simplified — candlestick + MA only)
  setTimeout(function() { sdDrawPriceChartClean(d); }, 50);

  // Render active tab
  sdRenderTab(sdActiveTab);
}

function sdSwitchTab(tabId) {
  sdActiveTab = tabId;
  // Update tab bar active state
  var btns = document.querySelectorAll('#sd-body [onclick^="sdSwitchTab"]');
  btns.forEach(function(b) {
    var tid = b.getAttribute('onclick').match(/'(\w+)'/)[1];
    var isOn = tid === tabId;
    b.style.fontWeight = isOn ? '700' : '500';
    b.style.color = isOn ? 'var(--am)' : 'var(--t3)';
    b.style.borderBottom = '2px solid ' + (isOn ? 'var(--am)' : 'transparent');
  });
  sdRenderTab(tabId);
}

function sdRenderTab(tabId) {
  var el = $('sd-tab-content'); if (!el || !sdData) return;
  var d = sdData;
  var h = '';

  if (tabId === 'financials') h = sdTabFinancials(d);
  else if (tabId === 'fundachart') h = sdTabFundachart(d);
  else if (tabId === 'analysis') h = sdTabAnalysis(d);
  else if (tabId === 'ownership') h = sdTabOwnership(d);
  else if (tabId === 'flow') h = sdTabFlow(d);
  else if (tabId === 'news') h = sdTabNews(d);

  el.innerHTML = h;

  // Deferred chart rendering per tab
  setTimeout(function() {
    if (tabId === 'financials') sdDrawFinCharts(d);
    if (tabId === 'fundachart') sdDrawFundaCharts(d);
    if (tabId === 'analysis') {
      if (d.scoring) sdDrawRadar(d.scoring);
      
      sdDrawAnalysisCharts(d);
    }
    if (tabId === 'ownership' && d.ownership) sdDrawOwnershipCharts(d.ownership);
    if (tabId === 'flow') {
      if (d.chart) sdDrawFlowCharts(d);
    }
    if (tabId === 'news') sdLoadNews(d.code);
    // Resize
    setTimeout(function() {
      if (typeof BL !== 'undefined' && BL._instances) {
        Object.keys(BL._instances).forEach(function(k) {
          var c = BL._instances[k]; if (c && !c.isDisposed()) c.resize();
        });
      }
    }, 200);
  }, 50);
}

// ═══════════════════════════════════════════════════════════════
// TAB: FINANCIALS
// ═══════════════════════════════════════════════════════════════
function sdTabFinancials(d) {
  var fu = d.fundamental;
  if (!fu) return '<div style="padding:20px;color:var(--t3)">No fundamental data available</div>';
  var q = d.quarterly || [];
  var hist = d.fund_history || [];
  var band = d.valuation_band || [];
  var peers = d.peers || null;
  var cur = d.current || {};
  var h = '';

  function pc(v) { return v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(2) + '%'; }
  function cl(v) { return v == null ? 'var(--t3)' : (v > 0 ? 'var(--gn)' : v < 0 ? 'var(--rd)' : 'var(--t2)'); }
  function num(v, dg) { return v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: dg == null ? 0 : dg }); }
  function spark(vals, color) {
    var v = vals.filter(function (x) { return x != null && isFinite(x); });
    if (v.length < 2) return '';
    var mn = Math.min.apply(null, v), mx = Math.max.apply(null, v), rg = (mx - mn) || 1;
    var pts = v.map(function (y, i) {
      return (i / (v.length - 1) * 100).toFixed(2) + ',' + (26 - ((y - mn) / rg) * 22).toFixed(2);
    }).join(' ');
    return '<svg viewBox="0 0 100 30" preserveAspectRatio="none" style="width:100%;height:24px;display:block;margin-top:3px">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>';
  }
  function yoy(arr, i, key) {
    if (i < 4 || !arr[i] || !arr[i - 4]) return null;
    var a = arr[i][key], b = arr[i - 4][key];
    if (a == null || b == null || b === 0) return null;
    return Math.round((a - b) / Math.abs(b) * 10000) / 100;
  }

  // ═══ 1. KPI STRIP — 6 kotak, nilai + YoY + sparkline 8 kuartal ═══
  var last = q.length ? q[q.length - 1] : null;
  var li = q.length - 1;
  var kpis = [];
  if (last) {
    kpis.push({ l: 'Revenue (Q)', v: num(last.sales), y: yoy(q, li, 'sales'), s: q.slice(-8).map(function (x) { return x.sales; }), c: 'var(--bl)' });
    kpis.push({ l: 'Net Income (Q)', v: num(last.profit), y: yoy(q, li, 'profit'), s: q.slice(-8).map(function (x) { return x.profit; }), c: 'var(--gn)' });
    // TTM dipisah supaya tidak dibandingkan dengan laba kuartalan (kasus ADRO:
    // laba Q +100% tapi EPS TTM -16% karena basisnya beda).
    var tp = d.ttm_profit || null;
    kpis.push({ l: 'Net Income (TTM)', v: tp ? num(tp.value) : '—', y: tp ? tp.yoy : null, s: [], c: 'var(--gn)' });
  }
  kpis.push({ l: 'EPS (TTM)', v: fu.eps_trailing ? fu.eps_trailing.toFixed(2) : '—', y: d.fund_growth ? d.fund_growth.eps_growth : null, s: q.slice(-8).map(function (x) { return x.eps; }), c: 'var(--t1)' });
  kpis.push({ l: 'ROE (TTM)', v: fu.roe ? fu.roe.toFixed(2) + '%' : '—', y: null, s: q.slice(-8).map(function (x) { return x.roe; }), c: '#a855f7' });
  kpis.push({ l: 'DER', v: fu.der ? fu.der.toFixed(2) + 'x' : '—', y: null, s: q.slice(-8).map(function (x) { return x.der; }), c: 'var(--rd)' });

  h += '<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:10px">';
  kpis.forEach(function (k) {
    h += '<div style="padding:8px 10px;background:var(--bg1);border:1px solid var(--b1);border-radius:5px">' +
      '<div style="font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.4px">' + k.l + '</div>' +
      '<div style="font-family:var(--fm);font-size:15px;font-weight:700;color:var(--t1);margin:1px 0">' + k.v + '</div>' +
      (k.y != null ? '<div style="font-size:9px;font-weight:700;color:' + cl(k.y) + '">' + pc(k.y) + ' YoY</div>' : '<div style="font-size:9px;color:var(--t3)">&nbsp;</div>') +
      spark(k.s, k.c) + '</div>';
  });
  h += '</div>';

  // ═══ 2. CHART Revenue & Profit per kuartal ═══
  h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:5px;padding:10px;margin-bottom:10px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">REVENUE &amp; PROFIT PER KUARTAL <span style="font-weight:400;color:var(--t3);font-size:9px">(de-cumulated dari YTD)</span></div>';
  h += '<div id="sd-fin-rev" style="height:200px"></div></div>';

  // ═══ 3. GROWTH TABLE 8Q ═══
  h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:5px;padding:10px;margin-bottom:10px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">PERTUMBUHAN — YoY PER KUARTAL</div>';
  h += '<table class="bei-tbl" style="width:100%;font-size:11px"><thead><tr><th class="al">Kuartal</th><th class="ar">Revenue</th><th class="ar">Profit</th><th class="ar">EPS</th><th class="ar">ROE</th><th class="ar">DER</th></tr></thead><tbody>';
  var startIdx = Math.max(4, q.length - 8);
  for (var gi = startIdx; gi < q.length; gi++) {
    var rv = yoy(q, gi, 'sales'), pf = yoy(q, gi, 'profit');
    // roe 0 di periode lama = data tidak tersedia, bukan "naik 20 pp"
    var dRoe = (q[gi].roe > 0 && q[gi - 4].roe > 0) ? q[gi].roe - q[gi - 4].roe : null;
    var dDer = (q[gi].der > 0 && q[gi - 4].der > 0) ? q[gi].der - q[gi - 4].der : null;
    h += '<tr><td class="al" style="color:var(--t2)">' + q[gi].label + '</td>' +
      '<td class="ar" style="color:' + cl(rv) + ';font-family:var(--fm)">' + pc(rv) + '</td>' +
      '<td class="ar" style="color:' + cl(pf) + ';font-family:var(--fm)">' + pc(pf) + '</td>' +
      '<td class="ar" style="color:var(--t2);font-family:var(--fm)">' + (q[gi].eps ? q[gi].eps.toFixed(2) : '—') + '</td>' +
      '<td class="ar" style="color:' + cl(dRoe) + ';font-family:var(--fm)">' + (dRoe == null ? '—' : (dRoe > 0 ? '+' : '') + dRoe.toFixed(2) + ' pp') + '</td>' +
      '<td class="ar" style="color:' + cl(-dDer) + ';font-family:var(--fm)">' + (dDer == null ? '—' : (dDer > 0 ? '+' : '') + dDer.toFixed(2)) + '</td></tr>';
  }
  h += '</tbody></table></div>';

  // ═══ 4. VALUATION BAND ═══
  var curPer = fu.live_per || fu.per;
  var perList = band.map(function (x) { return x.per; }).filter(function (x) { return x != null; });
  var pctl = null;
  if (curPer && perList.length > 4) {
    pctl = Math.round(perList.filter(function (v) { return v < curPer; }).length / perList.length * 100);
  }
  h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:5px;padding:10px;margin-bottom:10px">';
  h += '<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1)">BAND VALUASI (PER)</div>';
  h += '<div style="font-size:10px;color:var(--t3)">' + band.length + ' kuartal' + (pctl != null ? ' · persentil <b style="color:var(--am)">' + pctl + '</b>' : '') + '</div>';
  h += '<div style="margin-left:auto;font-family:var(--fm);font-size:13px;font-weight:700">' + (curPer ? curPer.toFixed(2) + 'x' : '—') + '</div></div>';
  h += '<div id="sd-fin-band" style="height:170px"></div></div>';

  // ═══ 5. PEER ═══
  if (peers && peers.n) {
    function cmp(mine, med, lowBetter) {
      if (mine == null || med == null) return '<td class="ar" style="font-family:var(--fm);color:var(--t3)">—</td>';
      var better = lowBetter ? mine < med : mine > med;
      return '<td class="ar" style="font-family:var(--fm);color:' + (better ? 'var(--gn)' : 'var(--rd)') + '">' + Number(mine).toFixed(2) + '</td>';
    }
    h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:5px;padding:10px;margin-bottom:10px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">VS SEKTOR ' + esc(peers.sector) + ' <span style="font-weight:400;color:var(--t3);font-size:9px">(' + peers.n + ' emiten, periode sama)</span></div>';
    h += '<table class="bei-tbl" style="width:100%;font-size:11px"><thead><tr><th class="al"></th><th class="ar">PER</th><th class="ar">PBV</th><th class="ar">ROE</th><th class="ar">NPM</th></tr></thead><tbody>';
    h += '<tr><td class="al" style="color:var(--t1);font-weight:700">' + d.code + '</td>' + cmp(fu.live_per || fu.per, peers.per, true) + cmp(fu.live_pbv || fu.pbv, peers.pbv, true) + cmp(fu.roe, peers.roe, false) + cmp(fu.npm, peers.npm, false) + '</tr>';
    h += '<tr><td class="al" style="color:var(--t3)">Median sektor</td><td class="ar" style="font-family:var(--fm);color:var(--t3)">' + (peers.per == null ? '—' : peers.per.toFixed(2)) + '</td><td class="ar" style="font-family:var(--fm);color:var(--t3)">' + (peers.pbv == null ? '—' : peers.pbv.toFixed(2)) + '</td><td class="ar" style="font-family:var(--fm);color:var(--t3)">' + (peers.roe == null ? '—' : peers.roe.toFixed(2) + '%') + '</td><td class="ar" style="font-family:var(--fm);color:var(--t3)">' + (peers.npm == null ? '—' : peers.npm.toFixed(2) + '%') + '</td></tr>';
    h += '</tbody></table></div>';
  }

  // ═══ 6. BALANCE SHEET TREND ═══
  h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:5px;padding:10px;margin-bottom:10px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">NERACA — 8 KUARTAL</div>';
  h += '<div id="sd-fin-bs" style="height:180px"></div></div>';

  // ═══ 7. DIVIDEND TIMELINE ═══
  var dv = (d.dividend_history || []).slice(0, 10);
  if (dv.length) {
    h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:5px;padding:10px;margin-bottom:10px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">RIWAYAT DIVIDEN <span style="font-weight:400;color:var(--t3);font-size:9px">nominal = Proceed Ratio (KSEI)</span></div>';
    h += '<table class="bei-tbl" style="width:100%;font-size:11px"><thead><tr><th class="al">Cum</th><th class="al">Recording</th><th class="al">Payment</th><th class="ar">DPS</th></tr></thead><tbody>';
    dv.forEach(function (x) {
      h += '<tr><td class="al" style="font-family:var(--fm);color:var(--t2)">' + esc(x.cum_date || '—') + '</td><td class="al" style="font-family:var(--fm);color:var(--t3)">' + esc(x.recording_date || '—') + '</td><td class="al" style="font-family:var(--fm);color:var(--t3)">' + esc(x.payment_date || '—') + '</td><td class="ar" style="font-family:var(--fm);color:' + (x.dps > 0 ? 'var(--t1)' : 'var(--t3)') + '">' + (x.dps > 0 ? Number(x.dps).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—') + '</td></tr>';
    });
    h += '</tbody></table></div>';
  }

  // ═══ 8. PROVENANCE ═══
  var pv = d.provenance || {};
  h += '<div style="font-size:9px;color:var(--t3);font-family:var(--fm);padding:2px 0">' +
    'Periode ' + esc(pv.period || '—') + ' · ' + (pv.quarters || 0) + ' kuartal · sumber ' + esc(pv.source || '—') +
    ' · sales/profit ' + esc(pv.sales_profit_basis || '—') + ' · EPS/ROE ' + esc(pv.eps_roe_basis || '—') +
    ' · profit mencakup minority interest; EPS memakai laba atributif</div>';

  return h;
}

// Chart Financials (dipanggil deferred dari sdRenderTab)
function sdDrawFinCharts(d) {
  var q = d.quarterly || [], hist = d.fund_history || [], band = d.valuation_band || [];
  var axis = { axisLabel: { fontSize: 8, color: '#7d8fa8' }, axisLine: { lineStyle: { color: '#1e2836' } } };

  var e1 = document.getElementById('sd-fin-rev');
  if (e1 && q.length) {
    var c1 = BL.init(e1, 'sd-fin-rev'); if (c1) c1.setOption({
      grid: { left: 46, right: 34, top: 14, bottom: 22 },
      tooltip: { trigger: 'axis' },
      xAxis: Object.assign({ type: 'category', data: q.map(function (x) { return x.label; }) }, axis),
      yAxis: [{ type: 'value', axisLabel: { fontSize: 8, formatter: function (v) { return BL.fmtRp(v * 1e6); } }, splitLine: { lineStyle: { color: '#141c27' } } },
              { type: 'value', axisLabel: { fontSize: 8, formatter: '{value}%' }, splitLine: { show: false } }],
      series: [
        { name: 'Revenue', type: 'bar', data: q.map(function (x) { return x.sales; }), itemStyle: { color: '#3b82f6' } },
        { name: 'Profit', type: 'bar', data: q.map(function (x) { return x.profit; }), itemStyle: { color: '#22c55e' } },
        { name: 'NPM', type: 'line', yAxisIndex: 1, data: q.map(function (x) { return x.npm; }), symbolSize: 3, lineStyle: { width: 1 }, itemStyle: { color: '#f59e0b' } }
      ]
    });
  }

  var e2 = document.getElementById('sd-fin-band');
  if (e2 && band.length) {
    var per = band.map(function (x) { return x.per; });
    var vals = per.filter(function (v) { return v != null; }).sort(function (a, b) { return a - b; });
    var med = vals.length ? vals[Math.floor(vals.length / 2)] : null;
    var c2 = BL.init(e2, 'sd-fin-band'); if (c2) c2.setOption({
      grid: { left: 40, right: 14, top: 12, bottom: 22 },
      tooltip: { trigger: 'axis' },
      xAxis: Object.assign({ type: 'category', data: band.map(function (x) { return x.label; }) }, axis),
      yAxis: { type: 'value', axisLabel: { fontSize: 8, formatter: '{value}x' }, splitLine: { lineStyle: { color: '#141c27' } } },
      series: [{
        type: 'line', data: per, symbolSize: 3, lineStyle: { width: 1.5, color: '#3b82f6' }, itemStyle: { color: '#3b82f6' },
        markLine: med ? { silent: true, symbol: 'none', data: [{ yAxis: med, label: { formatter: 'median {c}x', fontSize: 8 }, lineStyle: { color: '#7d8fa8', type: 'dashed' } }] } : undefined
      }]
    });
  }

  var e3 = document.getElementById('sd-fin-bs');
  if (e3 && hist.length) {
    var hh = hist.slice(-8);
    var c3 = BL.init(e3, 'sd-fin-bs'); if (c3) c3.setOption({
      grid: { left: 48, right: 14, top: 14, bottom: 22 },
      tooltip: { trigger: 'axis' },
      legend: { textStyle: { fontSize: 9, color: '#7d8fa8' }, top: 0 },
      xAxis: Object.assign({ type: 'category', data: hh.map(function (x) { return x.period_label; }) }, axis),
      yAxis: { type: 'value', axisLabel: { fontSize: 8, formatter: function (v) { return BL.fmtRp(v * 1e6); } }, splitLine: { lineStyle: { color: '#141c27' } } },
      series: [
        { name: 'Assets', type: 'line', data: hh.map(function (x) { return x.assets; }), symbolSize: 2, itemStyle: { color: '#3b82f6' } },
        { name: 'Equity', type: 'line', data: hh.map(function (x) { return x.equity; }), symbolSize: 2, itemStyle: { color: '#22c55e' } },
        { name: 'Liabilities', type: 'line', data: hh.map(function (x) { return x.liabilities; }), symbolSize: 2, itemStyle: { color: '#ef4444' } }
      ]
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// TAB: FUNDACHART — Annual/Quarterly toggle
// ═══════════════════════════════════════════════════════════════
var sdFcMode = 'annual';

function sdTabFundachart(d) {
  var ann = d.annual_series || [];
  var q = d.quarterly || [];
  var hasA = ann.length >= 2, hasQ = q.length >= 4;
  if (!hasA && !hasQ) return '<div style="padding:20px;color:var(--t3)">Not enough data for fundachart</div>';
  if (!hasA) sdFcMode = 'quarterly';

  function card(id, title, sub, h) {
    return '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px">' +
      '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">' + title +
      ' <span style="font-weight:400;color:var(--t3)">(' + sub + ')</span></div>' +
      '<div id="' + id + '" style="width:100%;height:' + h + 'px"></div></div>';
  }

  var mode = sdFcMode === 'annual' ? 'Annual' : 'Quarterly';
  var h = '';
  h += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:10px">';
  if (hasA) {
    h += '<button onclick="sdFcToggle(\'annual\')" style="padding:5px 16px;font-size:11px;font-weight:' + (sdFcMode === 'annual' ? '700' : '400') + ';color:' + (sdFcMode === 'annual' ? '#fff' : 'var(--t3)') + ';background:' + (sdFcMode === 'annual' ? 'var(--am)' : 'var(--bg1)') + ';border:1px solid ' + (sdFcMode === 'annual' ? 'var(--am)' : 'var(--b1)') + ';border-radius:4px;cursor:pointer">Annual</button>';
  }
  if (hasQ) {
    h += '<button onclick="sdFcToggle(\'quarterly\')" style="padding:5px 16px;font-size:11px;font-weight:' + (sdFcMode === 'quarterly' ? '700' : '400') + ';color:' + (sdFcMode === 'quarterly' ? '#fff' : 'var(--t3)') + ';background:' + (sdFcMode === 'quarterly' ? 'var(--am)' : 'var(--bg1)') + ';border:1px solid ' + (sdFcMode === 'quarterly' ? 'var(--am)' : 'var(--b1)') + ';border-radius:4px;cursor:pointer">Quarterly</button>';
  }
  h += '<span style="margin-left:auto;font-size:9px;color:var(--t3);font-family:var(--fm)">' +
    (sdFcMode === 'annual' ? ann.length + ' tahun' : q.length + ' kuartal') + ' · sumber financial_ratios</span>';
  h += '</div>';

  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
  h += card('sd-fc-rp', 'REVENUE &amp; PROFIT + NPM', mode, sdChartHeight(300, 0.34, 400));
  h += card('sd-fc-er', 'EPS &amp; ROE', mode, sdChartHeight(300, 0.34, 400));
  h += card('sd-fc-mg', 'MARGIN TREND', mode, sdChartHeight(280, 0.32, 380));
  h += card('sd-fc-gr', 'PERTUMBUHAN YoY', mode, sdChartHeight(280, 0.32, 380));
  h += card('sd-fc-bs', 'NERACA &amp; DER', mode, sdChartHeight(300, 0.34, 400));
  if (sdFcMode === 'annual') h += card('sd-fc-dps', 'DIVIDEN PER SAHAM', 'tahunan', sdChartHeight(300, 0.34, 400));
  if (d.daily_valuation && d.daily_valuation.length >= 5) {
    h += card('sd-fc-val', 'LIVE PER · PBV · PRICE', 'harian', sdChartHeight(300, 0.34, 400));
  }
  h += '</div>';
  return h;
}

function sdFcToggle(mode) { sdFcMode = mode; sdRenderTab('fundachart'); }

function sdDrawFundaCharts(d) {
  var ann = d.annual_series || [], q = d.quarterly || [];
  var rows = (sdFcMode === 'annual' && ann.length) ? ann : q;
  if (!rows.length) return;
  var labels = rows.map(function (r) { return r.label || r.year || r.period; });
  var axisX = { type: 'category', data: labels, axisLabel: { fontSize: 9, rotate: labels.length > 8 ? 30 : 0 }, axisLine: { lineStyle: { color: '#1e2836' } } };
  var axisY = function (fmt) { return { type: 'value', axisLabel: { fontSize: 8, formatter: fmt }, splitLine: { lineStyle: { color: '#141c27' } } }; };
  var fmtRpAx = function (v) { return BL.fmtRp(v * 1e9); };   // nilai dalam miliar
  var grid = { left: 52, right: 42, top: 22, bottom: 24 };
  var leg = { textStyle: { fontSize: 9, color: '#7d8fa8' }, top: 0 };

  var el1 = document.getElementById('sd-fc-rp');
  if (el1) {
    var c1 = BL.init(el1, 'sd-fc-rp'); if (c1) c1.setOption({
      grid: grid, tooltip: { trigger: 'axis' }, legend: leg, xAxis: axisX,
      yAxis: [axisY(fmtRpAx), { type: 'value', axisLabel: { fontSize: 8, formatter: '{value}%' }, splitLine: { show: false } }],
      series: [
        { name: 'Revenue', type: 'bar', data: rows.map(function (r) { return r.sales; }), itemStyle: { color: 'rgba(59,130,246,0.75)' }, barMaxWidth: 26 },
        { name: 'Profit', type: 'bar', data: rows.map(function (r) { return r.profit; }), itemStyle: { color: 'rgba(34,197,94,0.75)' }, barMaxWidth: 26 },
        { name: 'NPM', type: 'line', yAxisIndex: 1, data: rows.map(function (r) { return r.npm; }), symbolSize: 4, lineStyle: { width: 1.5, color: '#f59e0b' }, itemStyle: { color: '#f59e0b' } }
      ]
    });
  }

  var el2 = document.getElementById('sd-fc-er');
  if (el2) {
    var c2 = BL.init(el2, 'sd-fc-er'); if (c2) c2.setOption({
      grid: grid, tooltip: { trigger: 'axis' }, legend: leg, xAxis: axisX,
      yAxis: [axisY('{value}'), { type: 'value', axisLabel: { fontSize: 8, formatter: '{value}%' }, splitLine: { show: false } }],
      series: [
        { name: 'EPS', type: 'bar', data: rows.map(function (r) { return r.eps; }), itemStyle: { color: 'rgba(14,165,233,0.75)' }, barMaxWidth: 26 },
        { name: 'ROE', type: 'line', yAxisIndex: 1, data: rows.map(function (r) { return r.roe; }), symbolSize: 4, lineStyle: { width: 1.5, color: '#22c55e' }, itemStyle: { color: '#22c55e' } }
      ]
    });
  }

  // Margins: NPM / ROA / ROE
  var el3 = document.getElementById('sd-fc-mg');
  if (el3) {
    var c3 = BL.init(el3, 'sd-fc-mg'); if (c3) c3.setOption({
      grid: grid, tooltip: { trigger: 'axis' }, legend: leg, xAxis: axisX,
      yAxis: [{ type: 'value', axisLabel: { fontSize: 8, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#141c27' } } }],
      series: [
        { name: 'NPM', type: 'line', data: rows.map(function (r) { return r.npm; }), symbolSize: 3, lineStyle: { width: 1.5, color: '#f59e0b' }, itemStyle: { color: '#f59e0b' } },
        { name: 'ROA', type: 'line', data: rows.map(function (r) { return r.roa; }), symbolSize: 3, lineStyle: { width: 1.5, color: '#38bdf8' }, itemStyle: { color: '#38bdf8' } },
        { name: 'ROE', type: 'line', data: rows.map(function (r) { return r.roe; }), symbolSize: 3, lineStyle: { width: 1.5, color: '#22c55e' }, itemStyle: { color: '#22c55e' } }
      ]
    });
  }

  // Growth YoY
  var step = sdFcMode === 'annual' ? 1 : 4;
  var gSales = [], gProfit = [];
  rows.forEach(function (r, i) {
    var b = rows[i - step];
    var f = function (k) { return (b && r[k] != null && b[k]) ? Math.round((r[k] - b[k]) / Math.abs(b[k]) * 10000) / 100 : null; };
    gSales.push(f('sales')); gProfit.push(f('profit'));
  });
  var el4 = document.getElementById('sd-fc-gr');
  if (el4) {
    var c4 = BL.init(el4, 'sd-fc-gr'); if (c4) c4.setOption({
      grid: grid, tooltip: { trigger: 'axis' }, legend: leg, xAxis: axisX,
      yAxis: [{ type: 'value', axisLabel: { fontSize: 8, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#141c27' } } }],
      series: [
        { name: 'Revenue YoY', type: 'bar', data: gSales, itemStyle: { color: 'rgba(59,130,246,0.75)' }, barMaxWidth: 22 },
        { name: 'Profit YoY', type: 'bar', data: gProfit, itemStyle: { color: 'rgba(34,197,94,0.75)' }, barMaxWidth: 22 }
      ]
    });
  }

  // Balance sheet + DER
  var el5 = document.getElementById('sd-fc-bs');
  if (el5) {
    var c5 = BL.init(el5, 'sd-fc-bs'); if (c5) c5.setOption({
      grid: grid, tooltip: { trigger: 'axis' }, legend: leg, xAxis: axisX,
      yAxis: [axisY(fmtRpAx), { type: 'value', axisLabel: { fontSize: 8, formatter: '{value}x' }, splitLine: { show: false } }],
      series: [
        { name: 'Assets', type: 'line', data: rows.map(function (r) { return r.assets; }), symbolSize: 3, lineStyle: { width: 1.5, color: '#3b82f6' }, itemStyle: { color: '#3b82f6' } },
        { name: 'Equity', type: 'line', data: rows.map(function (r) { return r.equity; }), symbolSize: 3, lineStyle: { width: 1.5, color: '#22c55e' }, itemStyle: { color: '#22c55e' } },
        { name: 'Liabilities', type: 'line', data: rows.map(function (r) { return r.liabilities; }), symbolSize: 3, lineStyle: { width: 1.5, color: '#ef4444' }, itemStyle: { color: '#ef4444' } },
        { name: 'DER', type: 'line', yAxisIndex: 1, data: rows.map(function (r) { return r.der; }), symbolSize: 3, lineStyle: { width: 1, type: 'dashed', color: '#f59e0b' }, itemStyle: { color: '#f59e0b' } }
      ]
    });
  }

  // DPS per tahun
  var el6 = document.getElementById('sd-fc-dps');
  if (el6 && d.dps_by_year && d.dps_by_year.length) {
    var c6 = BL.init(el6, 'sd-fc-dps'); if (c6) c6.setOption({
      grid: grid, tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: d.dps_by_year.map(function (x) { return x.year; }), axisLabel: { fontSize: 9 }, axisLine: { lineStyle: { color: '#1e2836' } } },
      yAxis: axisY('{value}'),
      series: [{ name: 'DPS', type: 'bar', data: d.dps_by_year.map(function (x) { return x.dps; }), itemStyle: { color: 'rgba(245,158,11,0.8)' }, barMaxWidth: 30 }]
    });
  }

  // Live valuation
  var dv = d.daily_valuation || [];
  var el7 = document.getElementById('sd-fc-val');
  if (el7 && dv.length >= 5) {
    var c7 = BL.init(el7, 'sd-fc-val'); if (c7) c7.setOption({
      grid: grid, tooltip: { trigger: 'axis' }, legend: leg,
      xAxis: { type: 'category', data: dv.map(function (r) { return r.date; }), axisLabel: { fontSize: 8, interval: Math.floor(dv.length / 6) }, axisLine: { lineStyle: { color: '#1e2836' } } },
      yAxis: [axisY('{value}'), { type: 'value', axisLabel: { fontSize: 8, formatter: BL.fmtRp }, splitLine: { show: false } }],
      series: [
        { name: 'PER', type: 'line', data: dv.map(function (r) { return r.live_per; }), symbol: 'none', lineStyle: { width: 1.5, color: '#3b82f6' }, itemStyle: { color: '#3b82f6' } },
        { name: 'PBV', type: 'line', data: dv.map(function (r) { return r.live_pbv; }), symbol: 'none', lineStyle: { width: 1.5, color: '#a855f7' }, itemStyle: { color: '#a855f7' } }
      ]
    });
  }
}

function sdTabAnalysis(d) {
  var h = '';
  var vd = d.verdict || {}, phase = d.phase, stg = d.stage || {};
  var pc = phase ? (PHASE_COLORS[phase.phase] || PHASE_COLORS.accumulation) : null;

  // Verdict + Phase + MA Stage header
  h += '<div style="display:flex;align-items:center;gap:12px;padding:8px 10px;margin-bottom:8px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px;flex-wrap:wrap">';
  if (vd.label) {
    var vColor = vd.color || 'var(--t2)';
    h += '<div style="display:flex;align-items:center;gap:4px"><span style="font-size:10px;color:var(--t3)">Verdict</span><span style="font-size:16px;font-weight:800;color:' + vColor + ';padding:2px 10px;border:1px solid ' + vColor + ';border-radius:3px">' + vd.label + '</span><span style="font-size:10px;color:var(--t3)">' + vd.bull + '/' + vd.total + '</span></div>';
    h += '<span style="color:var(--b2)">│</span>';
  }
  if (phase && pc) {
    h += '<div style="display:flex;align-items:center;gap:4px"><span style="font-size:10px;color:var(--t3)">Phase</span><span style="font-size:13px;font-weight:700;color:' + pc.color + '">' + pc.icon + ' ' + pc.label + '</span><span style="font-size:10px;color:var(--t3)">' + phase.days + 'd ' + (phase.confidence || 50) + '%</span></div>';
    h += '<span style="color:var(--b2)">│</span>';
  }
  if (stg.level != null) {
    var stgC = stg.level >= 4 ? '#22c55e' : stg.level >= 3 ? '#f59e0b' : stg.level >= 2 ? '#f97316' : '#ef4444';
    h += '<div style="display:flex;align-items:center;gap:4px"><span style="font-size:10px;color:var(--t3)">MA</span><span style="font-size:13px;font-weight:700;color:' + stgC + '">Stage ' + stg.level + '/' + stg.total + '</span><span style="font-size:10px;color:var(--t3)">' + stg.label + '</span>';
    if (stg.bullish_stack) h += '<span style="font-size:10px;color:#22c55e">✓aligned</span>';
    if (stg.bearish_stack) h += '<span style="font-size:10px;color:#ef4444">✕aligned</span>';
    h += '</div>';
  }
  h += '</div>';

  // MA Distance bar
  if (stg.ma && stg.ma.length) {
    h += '<div style="display:flex;align-items:center;gap:14px;padding:6px 10px;margin-bottom:8px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px;font-size:13px">';
    h += '<span style="color:var(--t3);font-weight:700;font-size:11px;min-width:55px">MA DIST</span>';
    stg.ma.forEach(function(m) {
      var color = m.above ? '#22c55e' : '#ef4444';
      var label = m.key.toUpperCase().replace('MA','');
      h += '<span><span style="color:var(--t3);font-size:11px">MA' + label + '</span> <span style="font-weight:700;font-family:var(--fm);color:' + color + '">' + (m.dist_pct > 0 ? '+' : '') + m.dist_pct.toFixed(2) + '%</span> <span style="color:var(--t3);font-family:var(--fm)">' + (m.value || 0).toLocaleString() + '</span></span>';
    });
    h += '</div>';
  }

  // Signal table
  if (vd.signals && vd.signals.length) {
    h += '<table class="bei-tbl" style="font-size:13px;margin-bottom:8px"><thead style="font-size:11px"><tr>';
    vd.signals.forEach(function(sig) { h += '<th class="al">' + esc(sig.name).toUpperCase() + '</th>'; });
    h += '</tr></thead><tbody><tr>';
    vd.signals.forEach(function(sig) {
      var sigC = sig.direction === 'bullish' ? '#22c55e' : sig.direction === 'bearish' ? '#ef4444' : 'var(--t3)';
      var arrow = sig.direction === 'bullish' ? '▲' : sig.direction === 'bearish' ? '▼' : '●';
      h += '<td class="al"><span style="color:' + sigC + ';font-weight:700">' + arrow + ' ' + esc(String(sig.value)) + '</span>';
      if (sig.detail) h += ' <span style="color:var(--t3);font-size:10px">' + esc(sig.detail) + '</span>';
      h += '</td>';
    });
    h += '</tr></tbody></table>';
  }

  // Warnings
  if (vd.warnings && vd.warnings.length) {
    vd.warnings.forEach(function(w) {
      h += '<div style="font-size:11px;color:var(--am);padding:4px 8px;background:rgba(255,152,0,0.06);border-radius:4px;margin-bottom:4px;border-left:3px solid var(--am)">⚠ ' + esc(w) + '</div>';
    });
  }

  // 2-col: Score + Commentary (kolom skor dulu dikunci 280px sehingga radar-nya sempit)
  h += '<div style="display:grid;grid-template-columns:minmax(340px,34%) 1fr;gap:10px;margin-top:8px">';

  // Score radar + values
  h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">METRIK</div>';
  if (d.scoring) {
    h += '<table class="bei-tbl" style="font-size:12px"><tbody>';
    [{ k: 'ma20_pct', l: 'vs MA20', c: 'var(--t1)', suffix: '%' },
     { k: 'ma200_pct', l: 'vs MA200', c: 'var(--t1)', suffix: '%' },
     { k: 'rsi14', l: 'RSI 14', c: 'var(--t1)', suffix: '' },
     { k: 'ret_5d', l: 'Ret 5D', c: 'var(--t1)', suffix: '%' },
     { k: 'ret_20d', l: 'Ret 20D', c: 'var(--t1)', suffix: '%' },
     { k: 'rel_vol', l: 'Rel Vol', c: 'var(--t1)', suffix: 'x' },
     { k: 'fnet_5d', l: 'FNet 5D', c: 'var(--t1)', suffix: ' M' }].forEach(function(f) {
      var val = (d.scoring[f.k] == null ? null : Math.round(d.scoring[f.k] * 100) / 100);
      var vc = f.c;
      h += '<tr><td class="al" style="color:var(--t3)">' + f.l + '</td><td class="ar" style="font-weight:' + ('700') + ';font-family:var(--fm);color:' + vc + ';font-size:' + (f.bold ? '14px' : '12px') + '">' + val + '</td></tr>';
    });
    h += '</tbody></table>';
  } else {
    h += '<div style="font-size:12px;color:var(--t3);padding:10px 0">No scoring data</div>';
  }
  h += '</div>';

  // Commentary
  h += '<div style="overflow-y:auto;max-height:500px">' + sdCommentary(d) + '</div>';

  h += '</div>'; // end 2-col

  // Grafik tren skor dihapus bersama metode skor komposit.

  // Historis tambahan (dari 500 bar harga)
  if (d.chart && d.chart.length >= 60) {
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">';
    h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">JARAK KE MA <span style="font-weight:400;color:var(--t3)">(250 sesi, %)</span></div>';
    h += '<div id="sd-an-ma" style="width:100%;height:' + sdChartHeight(280, 0.32, 380) + 'px"></div></div>';
    h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">ARUS ASING <span style="font-weight:400;color:var(--t3)">(60 sesi, bar = harian, garis = kumulatif)</span></div>';
    h += '<div id="sd-an-ff" style="width:100%;height:' + sdChartHeight(280, 0.32, 380) + 'px"></div></div>';
    h += '</div>';
  }

  // 52W range
  if (d.stats && d.stats.peak_52w && d.stats.low_52w && d.current) {
    var lo = d.stats.low_52w, hi = d.stats.peak_52w, px = d.current.close;
    var pos = hi > lo ? Math.max(0, Math.min(100, (px - lo) / (hi - lo) * 100)) : 0;
    h += '<div style="margin-top:10px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px">';
    h += '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--t3);margin-bottom:5px"><span style="font-weight:700;color:var(--t1);font-size:11px">POSISI RENTANG 52 MINGGU</span><span>' + pos.toFixed(2) + '% dari low</span></div>';
    h += '<div style="position:relative;height:10px;background:linear-gradient(90deg,#ef4444 0%,#f59e0b 50%,#22c55e 100%);border-radius:5px;opacity:.75">';
    h += '<div style="position:absolute;left:' + pos.toFixed(2) + '%;top:-4px;width:3px;height:18px;background:#fff;border-radius:2px;transform:translateX(-1px)"></div></div>';
    h += '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--t3);font-family:var(--fm);margin-top:4px"><span>' + lo.toLocaleString() + '</span><span>' + px.toLocaleString() + '</span><span>' + hi.toLocaleString() + '</span></div>';
    if (d.stats.drawdown_from_peak != null) {
      h += '<div style="font-size:10px;color:var(--t3);margin-top:3px">Drawdown dari peak ' + d.stats.drawdown_from_peak + '% · ' + (d.stats.pct_from_low || 0) + '% di atas low · ATR ' + (d.stats.atr || 0) + ' · vol ' + (d.stats.volatility_ann || 0) + '%</div>';
    }
    h += '</div>';
  }

  // Phase history table
  if (d.phases && d.phases.length) {
    h += '<div style="margin-top:10px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">PHASE HISTORY</div>';
    h += '<div style="overflow-x:auto"><table class="bei-tbl" style="font-size:12px"><thead style="font-size:10px"><tr>';
    h += '<th class="al">Phase</th><th class="ar">Conf.</th><th class="al">Period</th><th class="ar">Days</th><th class="ar">Open→Close</th><th class="ar">Change</th><th class="ar">F.Net</th>';
    h += '</tr></thead><tbody>';
    d.phases.slice().reverse().forEach(function(p) {
      var pc2 = PHASE_COLORS[p.phase] || PHASE_COLORS.accumulation;
      h += '<tr>';
      h += '<td class="al"><span style="padding:1px 6px;border-radius:3px;background:' + pc2.bg + ';color:' + pc2.color + ';font-weight:600;font-size:10px">' + pc2.label + '</span></td>';
      h += '<td class="ar" style="color:' + (p.confidence >= 75 ? 'var(--gn)' : 'var(--am)') + ';font-weight:600">' + (p.confidence || 50) + '%</td>';
      h += '<td class="al" style="font-family:var(--fm);font-size:10px">' + p.start + ' → ' + p.end + '</td>';
      h += '<td class="ar">' + p.days + '</td>';
      h += '<td class="ar" style="font-family:var(--fm)">' + (p.open || 0).toLocaleString() + ' → ' + (p.close || 0).toLocaleString() + '</td>';
      h += '<td class="ar ' + (p.change_pct > 0 ? 'up' : p.change_pct < 0 ? 'dn' : '') + '" style="font-weight:600">' + (p.change_pct > 0 ? '+' : '') + p.change_pct + '%</td>';
      h += '<td class="ar ' + (p.fnet > 0 ? 'up' : p.fnet < 0 ? 'dn' : '') + '">' + fmtRp(p.fnet) + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div></div>';
  }
  return h;
}

// ═══════════════════════════════════════════════════════════════
// TAB: OWNERSHIP
// ═══════════════════════════════════════════════════════════════
function sdTabOwnership(d) {
  var h = '';

  // Ownership — rincian lokal/asing per kategori + riwayat
  var CAT = [
    { k: 'mf', l: 'Reksa Dana' }, { k: 'id', l: 'Individu' }, { k: 'cp', l: 'Korporasi' },
    { k: 'is', l: 'Asuransi' }, { k: 'pf', l: 'Dana Pensiun' }, { k: 'ib', l: 'Bank / IB' },
    { k: 'sc', l: 'Sekuritas' }, { k: 'fd', l: 'Yayasan' }, { k: 'ot', l: 'Lainnya' }
  ];
  var LOC_C = ['#1d4ed8', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe', '#eff6ff', '#e0e7ff'];
  var FOR_C = ['#b45309', '#d97706', '#f59e0b', '#fbbf24', '#fcd34d', '#fde68a', '#fef3c7', '#fffbeb', '#fef9c3'];

  if (d.ownership) {
    var own = d.ownership;
    var pb = own.pct_breakdown || { local: {}, foreign: {} };
    var hist = own.history || [];
    var prev = hist.length >= 13 ? hist[hist.length - 13] : null;

    var rowsC = CAT.map(function (c) {
      var lv = pb.local[c.k] || 0, fv = pb.foreign[c.k] || 0;
      var pv = prev ? ((prev.local[c.k] || 0) + (prev.foreign[c.k] || 0)) : null;
      return { k: c.k, l: c.l, lv: lv, fv: fv, tot: lv + fv, delta: pv == null ? null : Math.round((lv + fv - pv) * 100) / 100 };
    }).filter(function (r) { return r.tot > 0; }).sort(function (a, b) { return b.tot - a.tot; });

    h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:12px">';
    h += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;flex-wrap:wrap;gap:6px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--t1)">OWNERSHIP <span style="font-weight:400;color:var(--t3)">per kategori investor · KSEI</span></div>';
    h += '<div style="font-size:9px;color:var(--t3);font-family:var(--fm)">' + esc(own.snapshot_date) + ' · basis ' + (own.listed_shares || 0).toLocaleString() + ' saham' + (own.scripless_pct != null ? ' · tercatat KSEI ' + Number(own.scripless_pct).toFixed(2) + '%' : '') + '</div>';
    h += '</div>';

    h += '<div style="display:grid;grid-template-columns:minmax(360px,42%) 1fr;gap:14px">';

    // Kiri: stacked bar + tabel
    h += '<div>';
    h += '<table class="bei-tbl" style="font-size:11px;width:100%"><thead style="font-size:9px"><tr>';
    h += '<th class="al">Kategori</th><th class="ar">Lokal</th><th class="ar">Asing</th><th class="ar">Total</th><th class="ar">Δ12m</th></tr></thead><tbody>';
    rowsC.forEach(function (r) {
      var dl = r.delta == null ? '—' : (r.delta > 0 ? '+' : '') + r.delta.toFixed(2) + ' pp';
      var dc = r.delta == null ? 'var(--t3)' : r.delta > 0 ? 'var(--gn)' : r.delta < 0 ? 'var(--rd)' : 'var(--t3)';
      h += '<tr><td class="al" style="color:var(--t2)">' + r.l + '</td>';
      h += '<td class="ar" style="font-family:var(--fm);color:#60a5fa">' + (r.lv ? r.lv.toFixed(2) : '—') + '</td>';
      h += '<td class="ar" style="font-family:var(--fm);color:#f59e0b">' + (r.fv ? r.fv.toFixed(2) : '—') + '</td>';
      h += '<td class="ar" style="font-family:var(--fm);font-weight:600">' + r.tot.toFixed(2) + '</td>';
      h += '<td class="ar" style="font-family:var(--fm);color:' + dc + '">' + dl + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<div style="font-size:9px;color:var(--t3);margin-top:5px">Persen terhadap saham beredar. Δ12m = perubahan komposisi vs snapshot 12 bulan lalu.</div>';
    h += '</div>';

    // Kanan: grafik riwayat
    h += '<div>';
    h += '<div style="font-size:10px;font-weight:700;color:var(--t2);margin-bottom:4px">KOMPOSISI LOKAL vs ASING <span style="font-weight:400;color:var(--t3)">(' + hist.length + ' snapshot)</span></div>';
    h += '<div id="sd-own-hist" style="width:100%;height:190px"></div>';
    h += '<div style="font-size:10px;font-weight:700;color:var(--t2);margin:8px 0 4px">TREN KATEGORI UTAMA <span style="font-weight:400;color:var(--t3)">(lokal + asing, % saham beredar)</span></div>';
    h += '<div id="sd-own-cat" style="width:100%;height:190px"></div>';
    h += '</div>';

    h += '</div></div>';
  } else {
    h += '<div style="padding:20px;color:var(--t3);background:var(--bg1);border:1px solid var(--b1);border-radius:4px">No ownership data</div>';
  }

  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">';

  // Dividends
  if (d.dividend_history && d.dividend_history.length) {
    var divs = d.dividend_history, curClose = (d.current||{}).close||0;
    var latDps = divs[0].dps||0, latYield = curClose > 0 ? Math.round(latDps/curClose*10000)/100 : 0;
    h += '<div style="padding:10px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:8px">DIVIDEND HISTORY</div>';
    h += '<div style="display:flex;gap:8px;margin-bottom:8px">';
    h += '<div style="flex:1;text-align:center;padding:8px;background:var(--bgH);border-radius:4px"><div style="font-size:18px;font-weight:800;font-family:var(--fm);color:' + (latYield >= 5 ? 'var(--gn)' : 'var(--am)') + '">' + latYield.toFixed(2) + '%</div><div style="font-size:10px;color:var(--t3)">Yield</div></div>';
    h += '<div style="flex:1;text-align:center;padding:8px;background:var(--bgH);border-radius:4px"><div style="font-size:18px;font-weight:800;font-family:var(--fm)">' + latDps.toLocaleString() + '</div><div style="font-size:10px;color:var(--t3)">Latest DPS</div></div>';
    h += '</div>';
    h += '<table class="bei-tbl" style="font-size:11px"><thead style="font-size:10px"><tr><th class="al">Cum Date</th><th class="al">Type</th><th class="ar">DPS</th><th class="ar">Yield</th></tr></thead><tbody>';
    divs.slice(0,10).forEach(function(dv) {
      var dy = curClose > 0 && dv.dps > 0 ? (dv.dps/curClose*100).toFixed(2)+'%' : '—';
      h += '<tr><td class="al" style="font-family:var(--fm)">' + esc(dv.cum_date||'') + '</td><td class="al" style="color:var(--t3)">' + esc(dv.div_type||'final') + '</td><td class="ar" style="font-family:var(--fm);font-weight:600;color:var(--gn)">' + (dv.dps||0).toLocaleString() + '</td><td class="ar" style="font-family:var(--fm);color:var(--t3)">' + dy + '</td></tr>';
    });
    h += '</tbody></table></div>';
  } else {
    h += '<div style="padding:20px;color:var(--t3);background:var(--bg1);border:1px solid var(--b1);border-radius:4px">No dividend data</div>';
  }

  // Corporate Actions
  if (d.ca_timeline && d.ca_timeline.length) {
    var caTypeColors = {dividend:'var(--gn)',rights:'var(--am)',hmetd:'var(--am)',split:'var(--bl)',reverse:'#a855f7',bonus:'#0ea5e9',merger:'#ef4444'};
    h += '<div style="padding:10px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:8px">CORPORATE ACTIONS</div>';
    h += '<table class="bei-tbl" style="font-size:11px"><thead style="font-size:10px"><tr><th class="al">Cum Date</th><th class="al">Type</th><th class="ar">Ratio</th><th class="al">Desc</th></tr></thead><tbody>';
    d.ca_timeline.slice(0,15).forEach(function(ca) {
      var tc = caTypeColors[ca.ca_type]||'var(--t2)';
      var ratio = ca.exercise_ratio ? ca.exercise_ratio.toFixed(2) : (ca.proceed_ratio ? ca.proceed_ratio.toFixed(2) : '—');
      var desc = ca.description||ca.exercise_instr||ca.proceed_instr||'';
      h += '<tr><td class="al" style="font-family:var(--fm)">' + esc(ca.cum_date||'') + '</td><td class="al"><span style="padding:1px 5px;border-radius:3px;background:' + tc + '22;color:' + tc + ';font-size:10px;font-weight:600">' + esc((ca.ca_type||'').toUpperCase()) + '</span></td><td class="ar" style="font-family:var(--fm)">' + ratio + '</td><td class="al" style="color:var(--t3);font-size:10px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(desc) + '">' + esc(desc.substring(0,50)) + '</td></tr>';
    });
    h += '</tbody></table></div>';
  } else {
    h += '<div style="padding:20px;color:var(--t3);background:var(--bg1);border:1px solid var(--b1);border-radius:4px">No CA data</div>';
  }

  h += '</div>';
  return h;
}

// ═══════════════════════════════════════════════════════════════
// TAB: FLOW
// ═══════════════════════════════════════════════════════════════
function sdTabFlow(d) {
  var ch = d.chart || [];
  if (ch.length < 10) return '<div style="padding:20px;color:var(--t3)">No flow data</div>';
  var ff = d.foreign || {};
  var h = '';

  // ── KPI: net per jendela + intensitas ──
  function netN(n) {
    var rows = ch.slice(-n), t = 0;
    rows.forEach(function (r) { t += (r.fnet || 0); });
    return t;
  }
  function valN(n) {
    var t = 0;
    ch.slice(-n).forEach(function (r) { t += (r.close || 0) * (r.volume || 0); });
    return t;
  }
  var n20 = netN(20), v20 = valN(20);
  var intens = v20 > 0 ? n20 / v20 * 100 : null;

  function avgN(n, fn) {
    var rows = ch.slice(-n), s = 0, c = 0;
    rows.forEach(function (r) { var v = fn(r); if (v != null && isFinite(v)) { s += v; c++; } });
    return c ? s / c : null;
  }
  var avgTrade = avgN(20, function (r) { return (r.value && r.frequency) ? r.value / r.frequency : null; });
  var turnover = avgN(20, function (r) { return (r.tradeable > 0) ? (r.volume || 0) / r.tradeable * 100 : null; });
  var forPart = avgN(20, function (r) {
    if (!r.value) return null;
    var fv = ((r.fbuy || 0) + (r.fsell || 0)) * (r.close || 0);
    return fv / (2 * r.value) * 100;
  });

  h += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">';
  [['5D', netN(5)], ['10D', netN(10)], ['20D', netN(20)], ['60D', netN(60)]].forEach(function (x) {
    var c = x[1] >= 0 ? 'var(--gn)' : 'var(--rd)';
    h += '<div style="padding:8px 10px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px">';
    h += '<div style="font-size:9px;color:var(--t3)">' + x[0] + ' NET</div>';
    h += '<div style="font-size:16px;font-weight:800;font-family:var(--fm);color:' + c + '">' + fmtRp(x[1]) + '</div></div>';
  });
  var ic = intens == null ? 'var(--t3)' : intens >= 0 ? 'var(--gn)' : 'var(--rd)';
  function kpi(lbl, val, sub, col) {
    var o = '<div style="padding:8px 10px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px">';
    o += '<div style="font-size:9px;color:var(--t3)">' + lbl + '</div>';
    o += '<div style="font-size:16px;font-weight:800;font-family:var(--fm);color:' + (col || 'var(--t1)') + '">' + val + '</div>';
    if (sub) o += '<div style="font-size:8px;color:var(--t3)">' + sub + '</div>';
    return o + '</div>';
  }
  h += kpi('INTENSITAS 20D', intens == null ? '—' : (intens >= 0 ? '+' : '') + intens.toFixed(2) + '%', 'net asing ÷ nilai', ic);
  h += kpi('AVG TRADE 20D', avgTrade == null ? '—' : fmtRp(avgTrade), 'nilai ÷ frekuensi');
  h += kpi('TURNOVER 20D', turnover == null ? '—' : turnover.toFixed(2) + '%', 'volume ÷ saham tradeable');
  h += kpi('PARTISIPASI ASING', forPart == null ? '—' : forPart.toFixed(2) + '%', 'estimasi, 2 sisi transaksi');
  h += '</div>';

  if (ff.accum_streak > 0) h += '<div style="font-size:11px;color:var(--gn);font-weight:600;margin-bottom:6px">Accumulating ' + ff.accum_streak + ' hari berturut-turut</div>';
  if (ff.distrib_streak > 0) h += '<div style="font-size:11px;color:var(--rd);font-weight:600;margin-bottom:6px">Distributing ' + ff.distrib_streak + ' hari berturut-turut</div>';

  // ── Grafik ──
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
  h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">KUMULATIF ARUS ASING vs HARGA <span style="font-weight:400;color:var(--t3)">(120 sesi)</span></div>';
  h += '<div id="sd-fnet-chart" style="width:100%;height:250px"></div></div>';
  h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">BID RATIO <span style="font-weight:400;color:var(--t3)">(sesi tersedia)</span></div>';
  h += '<div id="sd-bo-chart" style="width:100%;height:250px"></div></div>';
  h += '</div>';

  h += '<div style="margin-top:10px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">GROSS ASING: BELI vs JUAL <span style="font-weight:400;color:var(--t3)">(60 sesi, miliar Rp)</span></div>';
  h += '<div id="sd-gross-chart" style="width:100%;height:220px"></div>';
  h += '<div style="font-size:9px;color:var(--t3);margin-top:4px">Net negatif bisa berarti asing menjual, atau sekadar tidak membeli — dua hal yang berbeda.</div></div>';

  // ── Tabel 20 sesi ──
  var last20 = ch.slice(-20);
  var cum = 0, cumArr = [];
  last20.forEach(function (r) { cum += (r.fnet || 0); cumArr.push(cum); });
  h += '<div style="margin-top:10px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">RINCIAN 20 SESI TERAKHIR</div>';
  h += '<div style="overflow-x:auto"><table class="bei-tbl" style="font-size:11px;width:100%"><thead style="font-size:9px"><tr>';
  h += '<th class="al">Tanggal</th><th class="ar">Close</th><th class="ar">Chg</th><th class="ar">F.Net</th><th class="ar">Kum. 20D</th><th class="ar">Bid%</th><th class="ar">Nilai</th></tr></thead><tbody>';
  last20.slice().reverse().forEach(function (r, revIdx) {
    var i = last20.length - 1 - revIdx;
    var p = last20[i - 1];
    var chg = p ? (r.close - p.close) / p.close * 100 : 0;
    var fv = (r.fnet || 0);
    var bv = r.bid_vol || 0, ov = r.offer_vol || 0, tot = bv + ov;
    var br = (bv > 0 && ov > 0) ? bv / tot * 100 : null;
    var val = r.value || (r.close || 0) * (r.volume || 0);
    h += '<tr><td class="al" style="font-family:var(--fm);color:var(--t2)">' + esc(r.date) + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + (r.close || 0).toLocaleString() + '</td>';
    h += '<td class="ar ' + (chg > 0 ? 'up' : chg < 0 ? 'dn' : '') + '" style="font-family:var(--fm)">' + (chg > 0 ? '+' : '') + chg.toFixed(2) + '%</td>';
    h += '<td class="ar ' + (fv > 0 ? 'up' : fv < 0 ? 'dn' : '') + '" style="font-family:var(--fm)">' + fmtRp(fv) + '</td>';
    h += '<td class="ar ' + (cumArr[i] > 0 ? 'up' : cumArr[i] < 0 ? 'dn' : '') + '" style="font-family:var(--fm)">' + fmtRp(cumArr[i]) + '</td>';
    h += '<td class="ar" style="font-family:var(--fm);color:' + (br == null ? 'var(--t3)' : br >= 55 ? 'var(--gn)' : br <= 45 ? 'var(--rd)' : 'var(--t2)') + '">' + (br == null ? '—' : br.toFixed(2)) + '</td>';
    h += '<td class="ar" style="font-family:var(--fm);color:var(--t3)">' + fmtRp(val) + '</td></tr>';
  });
  h += '</tbody></table></div>';
  h += '<div style="font-size:9px;color:var(--t3);margin-top:5px">Bid% = bid volume ÷ (bid + offer) pada snapshot harian; kosong bila data bid/offer tidak tersedia.</div>';
  h += '</div>';

  return h;
}


// ═══════════════════════════════════════════════════════════════
// TAB: NEWS
// ═══════════════════════════════════════════════════════════════
function sdTabNews(d) {
  var h = '<div style="padding:10px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:8px">NEWS & ANNOUNCEMENTS</div>';
  if (d.announcements && d.announcements.length) {
    d.announcements.forEach(function(a) {
      var attList = []; try { attList = JSON.parse(a.attachments || '[]'); } catch(e) {}
      var pdfUrl = attList.length ? (attList[0].url || '') : '';
      if (pdfUrl && !pdfUrl.startsWith('http')) pdfUrl = 'https://www.idx.co.id' + pdfUrl;
      var clickable = pdfUrl ? ' onclick="window.open(\'' + esc(pdfUrl) + '\',\'_blank\')" style="cursor:pointer"' : '';
      h += '<div style="padding:6px 0;border-bottom:1px solid var(--b1)"' + clickable + '>';
      h += '<div style="font-size:12px;color:var(--t1);line-height:1.4">' + esc((a.title || '').substring(0, 120)) + (pdfUrl ? ' <span style="color:var(--am);font-size:10px">📎</span>' : '') + '</div>';
      h += '<div style="font-size:10px;color:var(--t3);margin-top:2px"><span style="color:var(--gn)">BEI</span> · ' + esc(a.ann_date || '') + (a.subject ? ' · ' + esc(a.subject) : '') + '</div>';
      h += '</div>';
    });
  }
  h += '<div id="sd-news-list"><div style="font-size:11px;color:var(--t3);padding:8px 0">Loading news...</div></div>';
  h += '</div>';
  return h;
}

// ═══════════════════════════════════════════════════════════════
// PRICE CHART — Clean: Candlestick + MA Ribbon only
// ═══════════════════════════════════════════════════════════════
function sdDrawPriceChartClean(d) {
  var el = $('sd-price-chart'); if (!el) return;
  var c = BL.init(el, 'sd-price'); if (!c) return;
  var chart = d.chart || [];
  var dates = chart.map(function(r) { return r.date; });
  var ohlc = chart.map(function(r) { return [r.open, r.close, r.low, r.high]; });
  var closes = chart.map(function(r) { return r.close; });

  function calcMALine(period) {
    var result = [];
    for (var i = 0; i < closes.length; i++) {
      if (i < period - 1) { result.push(null); continue; }
      var sum = 0;
      for (var j = i - period + 1; j <= i; j++) sum += closes[j];
      result.push(Math.round(sum / period));
    }
    return result;
  }

  var maColors = { 5: '#0ea5e9', 10: '#22c55e', 20: '#f59e0b', 50: '#ef4444', 200: '#a855f7' };
  var maSeries = [5, 10, 20, 50, 200].map(function(p) {
    return { name: 'MA' + p, type: 'line', data: calcMALine(p), symbol: 'none', lineStyle: { width: p >= 50 ? 1.5 : 1, color: maColors[p], opacity: 0.8 }, itemStyle: { color: maColors[p] }, connectNulls: true, silent: true, z: 1 };
  });

  var zS = Math.max(0, 100 - Math.min(100, 250 / dates.length * 100));

  c.setOption({
    tooltip: {
      trigger: 'axis', textStyle: { fontSize: 10 },
      formatter: function(params) {
        if (!params || !params.length) return '';
        var h = '<div style="font-size:10px;color:#888;margin-bottom:3px">' + params[0].axisValue + '</div>';
        params.forEach(function(p) {
          if (p.seriesType === 'candlestick' && p.data) {
            h += '<div style="font-size:10px">O:' + (p.data[1]||0).toLocaleString() + ' H:' + (p.data[4]||0).toLocaleString() + ' L:' + (p.data[3]||0).toLocaleString() + ' C:' + (p.data[2]||0).toLocaleString() + '</div>';
          } else if (p.seriesName && p.seriesName.indexOf('MA') === 0 && p.value != null) {
            h += '<div style="font-size:9px;color:' + p.color + '">' + p.seriesName + ': ' + p.value.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) + '</div>';
          }
        });
        return h;
      }
    },
    legend: { top: 0, right: 10, textStyle: { fontSize: 8 }, itemWidth: 12, itemHeight: 2, data: ['MA5','MA10','MA20','MA50','MA200'] },
    grid: { left: 55, right: 10, top: 22, bottom: 36 },
    xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 8, formatter: function(v) { return v.substring(5); } } },
    yAxis: { type: 'value', scale: true, position: 'right', axisLabel: { fontSize: 8 }, splitLine: { lineStyle: { color: '#1e2836', type: 'dashed' } } },
    dataZoom: [
      { type: 'inside', start: zS, end: 100 },
      { type: 'slider', height: 14, bottom: 2, borderColor: '#2a3444', fillerColor: 'rgba(84,112,198,0.15)', textStyle: { fontSize: 7, color: '#6b7a8d' } }
    ],
    series: [
      { type: 'candlestick', data: ohlc, z: 2, itemStyle: { color: '#26A69A', color0: '#EF5350', borderColor: '#26A69A', borderColor0: '#EF5350' } },
      maSeries[0], maSeries[1], maSeries[2], maSeries[3], maSeries[4]
    ]
  }, true);
}

// ═══ HELPER CARDS ═══
function sdFlowCard(label, val) {
  var cls = val > 0 ? 'var(--gn)' : val < 0 ? 'var(--rd)' : 'var(--t2)';
  return '<div style="padding:8px 12px;border-radius:6px;background:var(--bgH);text-align:center;min-width:80px;flex:1"><div style="font-size:14px;font-weight:700;font-family:var(--fm);color:' + cls + '">' + fmtRp(val || 0) + '</div><div style="font-size:10px;color:var(--t3);margin-top:1px">' + label + '</div></div>';
}

// ═══ RADAR CHART ═══
function sdDrawRadar(sc) {
  var el = $('sd-radar-chart'); if (!el) return;
  var c = BL.init(el, 'sd-radar'); if (!c) return;
  c.setOption({
    radar: {
      indicator: [{ name: 'Fund', max: 100 },{ name: 'Value', max: 100 },{ name: 'Mom', max: 100 },{ name: 'Demand', max: 100 },{ name: 'Foreign', max: 100 }],
      radius: '65%', center: ['50%', '55%'],
      axisName: { fontSize: 9, color: '#8a9bb5' },
      splitArea: { areaStyle: { color: ['rgba(84,112,198,0.02)', 'rgba(84,112,198,0.04)'] } },
      splitLine: { lineStyle: { color: '#1e2836' } },
      axisLine: { lineStyle: { color: '#2a3444' } }
    },
    series: [{ type: 'radar', data: [{ value: [sc.score_fundamental||0, sc.score_valuation||0, sc.score_momentum||0, sc.score_demand||0, sc.score_foreign||0], areaStyle: { color: 'rgba(255,152,0,0.15)' }, lineStyle: { color: '#ff9800', width: 2 }, itemStyle: { color: '#ff9800' } }] }]
  }, true);
}

// ═══ FOREIGN FLOW BAR CHART ═══
// ═══ FLOW CHARTS ═══
function sdDrawFlowCharts(d) {
  var ch = d.chart || [];
  var rows = ch.slice(-120);
  if (rows.length < 10) return;

  var el1 = document.getElementById('sd-fnet-chart');
  if (el1) {
    var cum = [], acc = 0;
    rows.forEach(function (r) { acc += (r.fnet || 0) / 1e9; cum.push(Math.round(acc * 10) / 10); });
    var c1 = BL.init(el1, 'sd-fnet-chart'); if (c1) c1.setOption({
      grid: { left: 48, right: 52, top: 24, bottom: 22 },
      tooltip: { trigger: 'axis' },
      legend: { textStyle: { fontSize: 9, color: '#7d8fa8' }, top: 0 },
      xAxis: { type: 'category', data: rows.map(function (r) { return r.date; }), axisLabel: { fontSize: 8, interval: Math.floor(rows.length / 6) }, axisLine: { lineStyle: { color: '#1e2836' } } },
      yAxis: [
        { type: 'value', name: 'kum (miliar)', nameTextStyle: { fontSize: 8, color: '#7d8fa8' }, axisLabel: { fontSize: 8 }, splitLine: { lineStyle: { color: '#141c27' } } },
        { type: 'value', name: 'harga', nameTextStyle: { fontSize: 8, color: '#7d8fa8' }, axisLabel: { fontSize: 8, formatter: function (v) { return v.toLocaleString(); } }, splitLine: { show: false } }
      ],
      series: [
        { name: 'Kumulatif asing', type: 'line', data: cum, symbol: 'none', lineStyle: { width: 1.8, color: '#f59e0b' }, itemStyle: { color: '#f59e0b' }, areaStyle: { opacity: 0.1 },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: '#34404f', type: 'dashed' }, data: [{ yAxis: 0 }] } },
        { name: 'Harga', type: 'line', yAxisIndex: 1, data: rows.map(function (r) { return r.close; }), symbol: 'none', lineStyle: { width: 1.2, color: '#3b82f6' }, itemStyle: { color: '#3b82f6' } }
      ]
    });
  }

  var g60 = ch.slice(-60);
  var el3 = document.getElementById('sd-gross-chart');
  if (el3 && g60.length) {
    var c3 = BL.init(el3, 'sd-gross-chart'); if (c3) c3.setOption({
      grid: { left: 48, right: 14, top: 24, bottom: 22 },
      tooltip: { trigger: 'axis' },
      legend: { textStyle: { fontSize: 9, color: '#7d8fa8' }, top: 0 },
      xAxis: { type: 'category', data: g60.map(function (r) { return r.date; }), axisLabel: { fontSize: 8, interval: Math.floor(g60.length / 6) }, axisLine: { lineStyle: { color: '#1e2836' } } },
      yAxis: { type: 'value', axisLabel: { fontSize: 8 }, splitLine: { lineStyle: { color: '#141c27' } } },
      series: [
        { name: 'Beli', type: 'bar', stack: 'g', data: g60.map(function (r) { return Math.round((r.fbuy || 0) * (r.close || 0) / 1e9 * 10) / 10; }), itemStyle: { color: 'rgba(34,197,94,0.75)' }, barMaxWidth: 12 },
        { name: 'Jual', type: 'bar', stack: 'g', data: g60.map(function (r) { return -Math.round((r.fsell || 0) * (r.close || 0) / 1e9 * 10) / 10; }), itemStyle: { color: 'rgba(239,68,68,0.75)' }, barMaxWidth: 12 }
      ]
    });
  }

  var bo = rows.filter(function (r) { return (r.bid_vol || 0) > 0 && (r.offer_vol || 0) > 0; });
  var el2 = document.getElementById('sd-bo-chart');
  if (el2 && bo.length >= 3) {
    var ratio = bo.map(function (r) { var t = (r.bid_vol || 0) + (r.offer_vol || 0); return Math.round((r.bid_vol || 0) / t * 1000) / 10; });
    var ma20 = ratio.map(function (_, i) {
      if (i < 4) return null;
      var k = Math.max(0, i - 19), s = 0;
      for (var j = k; j <= i; j++) s += ratio[j];
      return Math.round(s / (i - k + 1) * 10) / 10;
    });
    var c2 = BL.init(el2, 'sd-bo-chart'); if (c2) c2.setOption({
      grid: { left: 40, right: 14, top: 24, bottom: 22 },
      tooltip: { trigger: 'axis' },
      legend: { textStyle: { fontSize: 9, color: '#7d8fa8' }, top: 0 },
      xAxis: { type: 'category', data: bo.map(function (r) { return r.date; }), axisLabel: { fontSize: 8, interval: Math.floor(bo.length / 5) }, axisLine: { lineStyle: { color: '#1e2836' } } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 8, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#141c27' } } },
      series: [
        { name: 'Bid ratio', type: 'bar', data: ratio, barMaxWidth: 10,
          itemStyle: { color: function (p) { return p.value >= 55 ? 'rgba(34,197,94,0.8)' : p.value <= 45 ? 'rgba(239,68,68,0.8)' : 'rgba(148,163,184,0.6)'; } } },
        { name: 'MA20', type: 'line', data: ma20, symbol: 'none', lineStyle: { width: 1.5, color: '#f59e0b' }, itemStyle: { color: '#f59e0b' },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: '#34404f', type: 'dashed' }, data: [{ yAxis: 50 }] } }
      ]
    });
  }
}

// ═══ OWNERSHIP CHARTS ═══
function sdDrawOwnershipCharts(own) {
  var hist = own.history || [];
  if (hist.length < 3) return;
  var dates = hist.map(function (h) { return h.date; });
  var xAxis = { type: 'category', data: dates, axisLabel: { fontSize: 8, interval: Math.max(1, Math.floor(dates.length / 6)) }, axisLine: { lineStyle: { color: '#1e2836' } } };
  var yAxis = { type: 'value', axisLabel: { fontSize: 8, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#141c27' } } };

  var el1 = document.getElementById('sd-own-hist');
  if (el1) {
    var c1 = BL.init(el1, 'sd-own-hist'); if (c1) c1.setOption({
      grid: { left: 40, right: 12, top: 24, bottom: 20 },
      tooltip: { trigger: 'axis' }, legend: { textStyle: { fontSize: 9, color: '#7d8fa8' }, top: 0 },
      xAxis: xAxis, yAxis: yAxis,
      series: [
        { name: 'Asing', type: 'line', data: hist.map(function (h) { return h.foreign_pct; }), symbol: 'none', lineStyle: { width: 2, color: '#f59e0b' }, itemStyle: { color: '#f59e0b' }, areaStyle: { opacity: 0.12 } },
        { name: 'Lokal', type: 'line', data: hist.map(function (h) { return h.local_pct; }), symbol: 'none', lineStyle: { width: 2, color: '#3b82f6' }, itemStyle: { color: '#3b82f6' }, areaStyle: { opacity: 0.12 } }
      ]
    });
  }

  var el2 = document.getElementById('sd-own-cat');
  if (el2) {
    var keys = [
      { k: 'mf', l: 'Reksa Dana', c: '#a855f7' },
      { k: 'id', l: 'Individu', c: '#22c55e' },
      { k: 'cp', l: 'Korporasi', c: '#0ea5e9' },
      { k: 'is', l: 'Asuransi', c: '#ef4444' },
      { k: 'pf', l: 'Dana Pensiun', c: '#f59e0b' }
    ];
    var last = hist[hist.length - 1];
    keys.sort(function (a, b) { return ((last.cats[b.k] || 0) - (last.cats[a.k] || 0)); });
    var c2 = BL.init(el2, 'sd-own-cat'); if (c2) c2.setOption({
      grid: { left: 40, right: 12, top: 24, bottom: 20 },
      tooltip: { trigger: 'axis' }, legend: { textStyle: { fontSize: 9, color: '#7d8fa8' }, top: 0 },
      xAxis: xAxis, yAxis: yAxis,
      series: keys.slice(0, 4).map(function (k) {
        return { name: k.l, type: 'line', data: hist.map(function (h) { return (h.cats || {})[k.k] || 0; }), symbol: 'none', lineStyle: { width: 1.6, color: k.c }, itemStyle: { color: k.c } };
      })
    });
  }
}

// ═══ ANALYSIS: MA DISTANCE + FOREIGN FLOW ═══
function sdDrawAnalysisCharts(d) {
  var rows = (d.chart || []).slice(-250);
  if (rows.length < 60) return;

  function sma(arr, n, i) {
    if (i < n - 1) return null;
    var s = 0;
    for (var k = i - n + 1; k <= i; k++) s += arr[k];
    return s / n;
  }
  var closes = rows.map(function (r) { return r.close; });
  var dist = function (n) {
    return rows.map(function (r, i) {
      var m = sma(closes, n, i);
      return m ? Math.round((r.close - m) / m * 10000) / 100 : null;
    });
  };
  var dates = rows.map(function (r) { return r.date; });
  var fmtDate = { fontSize: 8, interval: Math.floor(rows.length / 6) };

  var el1 = document.getElementById('sd-an-ma');
  if (el1) {
    var c1 = BL.init(el1, 'sd-an-ma'); if (c1) c1.setOption({
      grid: { left: 42, right: 14, top: 20, bottom: 22 },
      tooltip: { trigger: 'axis' }, legend: { textStyle: { fontSize: 9, color: '#7d8fa8' }, top: 0 },
      xAxis: { type: 'category', data: dates, axisLabel: fmtDate, axisLine: { lineStyle: { color: '#1e2836' } } },
      yAxis: { type: 'value', axisLabel: { fontSize: 8, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#141c27' } } },
      series: [
        { name: 'vs MA20', type: 'line', data: dist(20), symbol: 'none', lineStyle: { width: 1.2, color: '#3b82f6' }, itemStyle: { color: '#3b82f6' } },
        { name: 'vs MA50', type: 'line', data: dist(50), symbol: 'none', lineStyle: { width: 1.2, color: '#f59e0b' }, itemStyle: { color: '#f59e0b' } },
        { name: 'vs MA200', type: 'line', data: dist(200), symbol: 'none', lineStyle: { width: 1.5, color: '#ef4444' }, itemStyle: { color: '#ef4444' },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: '#34404f', type: 'dashed' }, data: [{ yAxis: 0 }] } }
      ]
    });
  }

  var ff = (d.chart || []).slice(-60);
  var el2 = document.getElementById('sd-an-ff');
  if (el2 && ff.length) {
    var net = ff.map(function (r) { return (r.fnet || 0) * (r.close || 0) / 1e9; }); // miliar
    var cum = [], acc = 0;
    net.forEach(function (v) { acc += v; cum.push(Math.round(acc * 100) / 100); });
    var c2 = BL.init(el2, 'sd-an-ff'); if (c2) c2.setOption({
      grid: { left: 46, right: 14, top: 20, bottom: 22 },
      tooltip: { trigger: 'axis' }, legend: { textStyle: { fontSize: 9, color: '#7d8fa8' }, top: 0 },
      xAxis: { type: 'category', data: ff.map(function (r) { return r.date; }), axisLabel: { fontSize: 8, interval: Math.floor(ff.length / 5) }, axisLine: { lineStyle: { color: '#1e2836' } } },
      yAxis: [{ type: 'value', axisLabel: { fontSize: 8 }, splitLine: { lineStyle: { color: '#141c27' } } },
              { type: 'value', axisLabel: { fontSize: 8 }, splitLine: { show: false } }],
      series: [
        { name: 'Harian (miliar)', type: 'bar', data: net.map(function (v) { return Math.round(v * 100) / 100; }),
          itemStyle: { color: function (p) { return p.value >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)'; } }, barMaxWidth: 8 },
        { name: 'Kumulatif', type: 'line', yAxisIndex: 1, data: cum, symbol: 'none', lineStyle: { width: 1.6, color: '#f59e0b' }, itemStyle: { color: '#f59e0b' } }
      ]
    });
  }
}

// ═══ SCORE TREND CHART ═══
function sdDrawScoreChart(hist) {
  var el = $('sd-score-chart'); if (!el) return;
  var c = BL.init(el, 'sd-score-hist'); if (!c) return;
  var dates = hist.map(function(r) { return r.calc_date; });
  var factors = [
    { k: 'score_composite', l: 'Composite', c: '#ff9800', w: 2.5 },
    { k: 'score_fundamental', l: 'Fund', c: '#22c55e', w: 1.2 },
    { k: 'score_valuation', l: 'Value', c: '#0ea5e9', w: 1.2 },
    { k: 'score_momentum', l: 'Mom', c: '#f59e0b', w: 1.2 },
    { k: 'score_demand', l: 'Demand', c: '#a855f7', w: 1.2 },
    { k: 'score_foreign', l: 'Foreign', c: '#ef4444', w: 1.2 }
  ];
  c.setOption({
    tooltip: { trigger: 'axis', textStyle: { fontSize: 10 } },
    legend: { top: 0, left: 0, textStyle: { fontSize: 9 } },
    grid: { left: 35, right: 10, top: 24, bottom: 24 },
    xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 8, formatter: function(v) { return v.substring(5); } } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 8 }, splitLine: { lineStyle: { color: '#1e2836' } } },
    series: factors.map(function(f) { return { name: f.l, type: 'line', data: hist.map(function(r) { return r[f.k] || 0; }), symbol: 'none', lineStyle: { width: f.w, color: f.c }, itemStyle: { color: f.c } }; })
  }, true);
}

// ═══ STOCK COMMENTARY ═══
function sdCommentary(d) {
  var cur = d.current || {}, phase = d.phase, vd = d.verdict || {}, stg = d.stage || {};
  var sc = d.scoring || {}, ff = d.foreign || {}, bo = d.bid_offer || {}, fu = d.fundamental || {};
  var st = d.stats || {};

  var vScore = vd.score || 50;
  var verdict, verdictColor, verdictIcon;
  if (vd.label === 'STRONG BUY') { verdict = 'STRONG BUY'; verdictColor = '#00cc66'; verdictIcon = '🟢'; }
  else if (vd.label === 'BUY') { verdict = 'BUY'; verdictColor = '#66bb6a'; verdictIcon = '🟢'; }
  else if (vd.label === 'NEUTRAL') { verdict = 'NEUTRAL'; verdictColor = '#e8a838'; verdictIcon = '🟡'; }
  else if (vd.label === 'SELL') { verdict = 'SELL'; verdictColor = '#ff8a65'; verdictIcon = '🟠'; }
  else if (vd.label === 'STRONG SELL') { verdict = 'STRONG SELL'; verdictColor = '#ef5350'; verdictIcon = '🔴'; }
  else { verdict = 'N/A'; verdictColor = 'var(--t3)'; verdictIcon = '⚪'; }

  var h = '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:8px;padding:14px 16px">';
  h += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">';
  h += '<div style="font-size:12px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">📝 Commentary</div>';
  h += '<div style="padding:2px 10px;border-radius:4px;background:' + verdictColor + '22;border:1px solid ' + verdictColor + '44;font-size:12px;font-weight:700;color:' + verdictColor + '">' + verdictIcon + ' ' + verdict + '</div>';
  h += '</div>';
  h += '<div style="font-size:12px;line-height:1.8;color:var(--t2)">';

  // Sections (same logic, bigger font)
  var items;

  // Trend
  items = [];
  if (phase) {
    var pc = PHASE_COLORS[phase.phase] || {};
    items.push('Fase <b style="color:' + (pc.color||'var(--t1)') + '">' + (pc.label||phase.phase) + '</b> ' + phase.days + 'd (conf ' + (phase.confidence||50) + '%)');
  }
  if (stg.level != null) {
    items.push('MA Stage <b>' + stg.level + '/5</b> — ' + stg.label);
    if (stg.bullish_stack) items.push('✓ MA bullish aligned');
    if (stg.bearish_stack) items.push('✕ MA bearish aligned');
  }
  if (items.length) h += '<p style="margin:0 0 8px"><b>Trend:</b> ' + items.join('. ') + '.</p>';

  // Score
  items = [];
  var comp = sc.score_composite || 0;
  if (comp >= 75) items.push('Composite <b style="color:var(--gn)">' + Math.round(comp) + '</b> — kualitas sangat baik');
  else if (comp >= 50) items.push('Composite <b>' + Math.round(comp) + '</b> — moderate');
  else if (comp > 0) items.push('Composite <b style="color:var(--rd)">' + Math.round(comp) + '</b> — di bawah rata-rata');
  if (items.length) h += '<p style="margin:0 0 8px"><b>Score:</b> ' + items.join('. ') + '.</p>';

  // Foreign Flow
  items = [];
  var f10 = ff.fnet_10d || 0, f20 = ff.fnet_20d || 0;
  if (f10 > 0 && f20 > 0) items.push('Foreign net <b style="color:var(--gn)">positif</b> 10D & 20D — akumulasi');
  else if (f10 < 0 && f20 < 0) items.push('Foreign net <b style="color:var(--rd)">negatif</b> 10D & 20D — distribusi');
  else if (f10 > 0 && f20 < 0) items.push('Foreign <b>berbalik positif</b> 10D — potential turn');
  if (ff.accum_streak >= 5) items.push('🔥 Akumulasi <b style="color:var(--gn)">' + ff.accum_streak + ' hari</b>');
  if (ff.distrib_streak >= 5) items.push('⚠ Distribusi <b style="color:var(--rd)">' + ff.distrib_streak + ' hari</b>');
  if (items.length) h += '<p style="margin:0 0 8px"><b>Flow:</b> ' + items.join('. ') + '.</p>';

  // Fundamental
  items = [];
  var perVal = fu.live_per || fu.per || 0;
  if (perVal > 0 && perVal < 10) items.push('PER <b style="color:var(--gn)">' + perVal.toFixed(2) + 'x</b> — murah');
  else if (perVal > 20) items.push('PER <b style="color:var(--rd)">' + perVal.toFixed(2) + 'x</b> — premium');
  if (fu.roe && fu.roe > 15) items.push('ROE <b style="color:var(--gn)">' + fu.roe.toFixed(2) + '%</b>');
  if (fu.der && fu.der > 2) items.push('DER <b style="color:var(--rd)">' + fu.der.toFixed(2) + '</b> — leverage tinggi');
  if (fu.eps_trailing && fu.eps_trailing < 0) items.push('<b style="color:var(--rd)">Perusahaan merugi</b> (EPS ' + fu.eps_trailing.toFixed(2) + ')');
  if (items.length) h += '<p style="margin:0 0 8px"><b>Fundamental:</b> ' + items.join('. ') + '.</p>';

  // Ownership & Dividend
  var ownData = d.ownership;
  if (ownData) {
    items = [];
    items.push('Foreign ownership <b>' + ownData.foreign_pct.toFixed(2) + '%</b>');
    if (items.length) h += '<p style="margin:0 0 8px"><b>Ownership:</b> ' + items.join('. ') + '.</p>';
  }
  var divH = d.dividend_history;
  if (divH && divH.length) {
    var curPr = cur.close || 0, latDps = divH[0].dps || 0;
    var divY = curPr > 0 ? (latDps / curPr * 100) : 0;
    if (divY > 0) h += '<p style="margin:0 0 8px"><b>Dividend:</b> Yield <b>' + divY.toFixed(2) + '%</b>, ' + divH.length + ' records.</p>';
  }

  // Market context
  var mr = d.market_regime;
  if (mr) {
    var regL = mr.regime === 'bull' ? '<b style="color:var(--gn)">Bull</b>' : mr.regime === 'bear' ? '<b style="color:var(--rd)">Bear</b>' : mr.regime === 'mild_bull' ? '<b style="color:var(--gn)">Mild Bull</b>' : mr.regime === 'mild_bear' ? '<b style="color:var(--rd)">Mild Bear</b>' : '<b>Sideways</b>';
    h += '<p style="margin:0 0 8px"><b>Market:</b> IHSG ' + (mr.level||0).toLocaleString() + ' — ' + regL + ' (20D: ' + (mr.chg_20d > 0 ? '+' : '') + mr.chg_20d + '%).</p>';
  }

  // Commodity — seri basi tidak boleh terbaca sebagai harga hari ini (t_61ccbdbe).
  var cmd = d.commodity_context;
  if (cmd) {
    var pctS = function(v){ v = v || 0; return (v > 0 ? '+' : '') + v + '%'; };
    if (cmd.stale === true || cmd.state === 'excess') {
      var cmdAsOf = shortDay(cmd.stale_date);
      h += '<p style="margin:0 0 8px"><b>Commodity:</b> ' + esc(cmd.label) + ' <b style="color:var(--t3)">—</b>'
        + ' <span style="color:var(--t3)" title="level bar ' + esc(cmdAsOf) + ': ' + (cmd.price||0).toLocaleString() + ' — tidak dipakai sebagai harga terkini">'
        + '⏸ basi · terakhir ' + cmdAsOf + ' · ' + (cmd.lag_sessions == null ? '?' : cmd.lag_sessions) + ' sesi</span>'
        + ' (5D: ' + pctS(cmd.chg_5d) + ', 20D: ' + pctS(cmd.chg_20d) + ' s/d ' + cmdAsOf + ').</p>';
    } else if (cmd.state === 'by_source') {
      // Sumber memang lambat: harganya tetap harga bar terakhir, dan itu ditulis apa adanya
      // (tanggal + lag) tanpa kata "basi" (kanban t_b234606a).
      var cmdAsOf2 = shortDay(cmd.stale_date || cmd.date);
      h += '<p style="margin:0 0 8px"><b>Commodity:</b> ' + esc(cmd.label) + ' ' + (cmd.price||0).toLocaleString()
        + ' <span style="color:var(--t3)">· sumber lag ' + (cmd.lag_sessions == null ? '?' : cmd.lag_sessions) + ' sesi (' + cmdAsOf2 + ')</span>'
        + ', 5D: ' + pctS(cmd.chg_5d) + '%, 20D: ' + pctS(cmd.chg_20d) + '% s/d ' + cmdAsOf2 + '.</p>';
    } else {
      h += '<p style="margin:0 0 8px"><b>Commodity:</b> ' + esc(cmd.label) + ' ' + (cmd.price||0).toLocaleString() + ', 5D: ' + (cmd.chg_5d > 0 ? '+' : '') + cmd.chg_5d + '%, 20D: ' + (cmd.chg_20d > 0 ? '+' : '') + cmd.chg_20d + '%.</p>';
    }
  }

  h += '</div></div>';
  return h;
}

// ═══ AUTOCOMPLETE ═══
var _sdAcTimer = null, _sdAcIdx = -1, _sdAcItems = [];

function sdAutoComplete() {
  clearTimeout(_sdAcTimer);
  var inp = $('sd-ticker-input'); if (!inp) return;
  var q = inp.value.trim();
  if (q.length < 1) { sdAcHide(); return; }
  _sdAcTimer = setTimeout(function() { sdAcFetch(q); }, 150);
}

async function sdAcFetch(q) {
  try {
    var r = await fetch('/api/idx/autocomplete?q=' + encodeURIComponent(q) + '&limit=12');
    _sdAcItems = await r.json();
    _sdAcIdx = -1;
    sdAcRender();
  } catch(e) { sdAcHide(); }
}

function sdAcRender() {
  var dd = $('sd-ac-dropdown'); if (!dd) return;
  if (!_sdAcItems.length) { sdAcHide(); return; }
  var h = '';
  _sdAcItems.forEach(function(item, i) {
    var bg = i === _sdAcIdx ? 'var(--bgH)' : 'transparent';
    h += '<div data-idx="' + i + '" style="padding:6px 10px;cursor:pointer;background:' + bg + ';border-bottom:1px solid var(--b1);display:flex;align-items:center;gap:8px" onmouseenter="this.style.background=\'var(--bgH)\'" onmouseleave="this.style.background=\'' + bg + '\'" onclick="sdAcSelect(' + i + ')">';
    h += '<span style="font-weight:700;font-family:var(--fm);color:var(--bl);min-width:50px;font-size:12px">' + esc(item.code) + '</span>';
    h += '<span style="flex:1;font-size:11px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(item.name || '') + '</span>';
    h += '</div>';
  });
  dd.innerHTML = h;
  dd.style.display = 'block';
}

function sdAcSelect(idx) { var item = _sdAcItems[idx]; if (!item) return; var inp = $('sd-ticker-input'); if (inp) inp.value = item.code; sdAcHide(); sdLoad(); }
function sdAcHide() { var dd = $('sd-ac-dropdown'); if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; } _sdAcIdx = -1; _sdAcItems = []; }

function sdInputKey(e) {
  var dd = $('sd-ac-dropdown');
  if (dd && dd.style.display === 'block' && _sdAcItems.length) {
    if (e.key === 'ArrowDown') { e.preventDefault(); _sdAcIdx = Math.min(_sdAcIdx + 1, _sdAcItems.length - 1); sdAcRender(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); _sdAcIdx = Math.max(_sdAcIdx - 1, 0); sdAcRender(); return; }
    if (e.key === 'Enter' && _sdAcIdx >= 0) { e.preventDefault(); sdAcSelect(_sdAcIdx); return; }
    if (e.key === 'Escape') { sdAcHide(); return; }
  }
  if (e.key === 'Enter') sdLoad();
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('#sd-ticker-input') && !e.target.closest('#sd-ac-dropdown')) sdAcHide();
});

// ═══ OPEN FROM GLOBAL SEARCH ═══
window.sdOpenTicker = function(code) {
  sdCode = code;
  // Stock Information masih sub-tab di dalam Analysis — tetap ke sana.
  if (typeof stab === 'function') stab('analysis');
  if (typeof anaSubTab === 'function') {
    var btn = document.querySelector('.wt-b[onclick*="stockdetail"]');
    if (btn) anaSubTab('stockdetail', btn);
    else {
      document.querySelectorAll('#t-analysis .wp').forEach(function(p) { p.classList.remove('on'); });
      var panel = $('ana-stockdetail'); if (panel) panel.classList.add('on');
    }
  }
  loadStockDetail();
  setTimeout(sdLoad, 100);
};

// ═══ LOAD NEWS ═══
async function sdLoadNews(code) {
  var el = $('sd-news-list'); if (!el) return;
  try {
    var r = await fetch('/api/news?symbol=' + encodeURIComponent(code));
    var data = await r.json();
    if (!data || !data.length) { el.innerHTML = '<div style="font-size:11px;color:var(--t3)">No news found</div>'; return; }
    var h = '';
    data.slice(0, 10).forEach(function(n) {
      var url = n.url || n.link || '';
      var title = n.headline || n.title || '';
      var src = n.source || '';
      var dt = n.datetime ? new Date(n.datetime * 1000).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) : (n.date || '');
      if (!title) return;
      h += '<div style="padding:6px 0;border-bottom:1px solid var(--b1)">';
      if (url && url !== '#') {
        h += '<a href="' + esc(url) + '" target="_blank" rel="noopener" style="font-size:12px;color:var(--bl);text-decoration:none;line-height:1.4;display:block">' + esc(title.substring(0, 100)) + (title.length > 100 ? '...' : '') + ' ↗</a>';
      } else {
        h += '<div style="font-size:12px;color:var(--t1);line-height:1.4">' + esc(title.substring(0, 100)) + '</div>';
      }
      h += '<div style="font-size:10px;color:var(--t3);margin-top:2px"><span style="color:var(--am)">News</span>' + (src ? ' · ' + esc(src) : '') + (dt ? ' · ' + dt : '') + '</div>';
      h += '</div>';
    });
    el.innerHTML = h || '<div style="font-size:11px;color:var(--t3)">No news found</div>';
  } catch (e) { el.innerHTML = '<div style="font-size:11px;color:var(--t3)">News unavailable</div>'; }
}