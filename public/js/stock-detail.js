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
    if (tabId === 'fundachart') sdDrawFundaCharts(d);
    if (tabId === 'analysis') {
      if (d.scoring) sdDrawRadar(d.scoring);
      if (d.score_history && d.score_history.length >= 3) sdDrawScoreChart(d.score_history);
    }
    if (tabId === 'flow') {
      if (d.chart) sdDrawFnetChart(d.chart);
      if (d.bid_offer && d.bid_offer.data) sdDrawBOChart(d.bid_offer.data);
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
  var h = '';
  if (!d.fundamental) return '<div style="padding:20px;color:var(--t3)">No fundamental data available</div>';
  var fu = d.fundamental;
  var cur = d.current || {};
  var close = cur.close || 0;

  // Helper: render a section card
  function secH(title) { return '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px;text-transform:uppercase;letter-spacing:.3px">' + title + '</div>'; }
  // Helper: render a row
  function row(label, val, opts) {
    opts = opts || {};
    var c = opts.color || 'var(--t1)';
    var fw = opts.bold ? '700' : '600';
    var suffix = opts.suffix || '';
    var icon = opts.icon || '';
    return '<tr><td class="al" style="color:var(--t3);font-size:12px;padding:3px 0">' + label + icon + '</td><td class="ar" style="font-weight:' + fw + ';font-family:var(--fm);color:' + c + ';font-size:12px;padding:3px 0">' + val + suffix + '</td></tr>';
  }
  function tblS() { return '<table class="bei-tbl" style="font-size:12px;width:100%"><tbody>'; }
  function tblE() { return '</tbody></table>'; }
  function cardS() { return '<div style="padding:10px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px">'; }
  function cardE() { return '</div>'; }

  // Color helpers
  function valC(v, low, high) { return v > 0 ? (v < low ? '#22c55e' : v < high ? 'var(--t1)' : '#ef4444') : 'var(--rd)'; }
  function pctC(v) { return v > 0 ? 'var(--gn)' : v < 0 ? 'var(--rd)' : 'var(--t2)'; }
  function pctFmt(v) { if (v == null) return '—'; return (v > 0 ? '+' : '') + v.toFixed(2) + '%'; }

  // ═══ 3-COLUMN GRID ═══
  h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">';

  // ════════════════════════════════════════
  // COL 1: CURRENT VALUATION
  // ════════════════════════════════════════
  h += cardS();
  h += secH('Current Valuation');
  h += tblS();

  // PER
  var perVal = fu.live_per || fu.per || 0;
  var perColor = valC(perVal, 10, 20);
  h += row('PER (TTM)', perVal ? perVal.toFixed(2) + 'x' : '—', { color: perColor, icon: fu.live_per ? ' <span style="color:var(--am);font-size:9px">⚡</span>' : '' });

  // PBV
  var pbvVal = fu.live_pbv || fu.pbv || 0;
  var pbvColor = pbvVal > 0 ? (pbvVal < 1 ? '#22c55e' : pbvVal < 2 ? 'var(--t1)' : '#ef4444') : 'var(--t2)';
  h += row('PBV', pbvVal ? pbvVal.toFixed(2) + 'x' : '—', { color: pbvColor, icon: fu.live_pbv ? ' <span style="color:var(--am);font-size:9px">⚡</span>' : '' });

  // Earnings Yield
  if (fu.earnings_yield != null) {
    var eyC = fu.earnings_yield > 10 ? '#22c55e' : fu.earnings_yield > 5 ? 'var(--t1)' : fu.earnings_yield > 0 ? 'var(--am)' : 'var(--rd)';
    h += row('Earnings Yield', fu.earnings_yield.toFixed(2) + '%', { color: eyC });
  }

  // P/S
  if (fu.price_to_sales) {
    var psC = fu.price_to_sales < 1 ? '#22c55e' : fu.price_to_sales < 3 ? 'var(--t1)' : '#ef4444';
    h += row('P/S', fu.price_to_sales.toFixed(2) + 'x', { color: psC });
  }

  // Market Cap (computed: close × shares_outstanding if available, or from fu.market_cap)
  var mktCap = fu.market_cap || (fu.shares_outstanding && close ? close * fu.shares_outstanding : 0);
  if (mktCap) {
    h += row('Market Cap', fmtRp(mktCap), {});
  }

  // Shares Outstanding
  if (fu.shares_outstanding) {
    h += row('Shares Outstanding', (fu.shares_outstanding / 1e9).toFixed(2) + ' B', {});
  }

  // Free Float (if available from ownership)
  if (d.ownership && d.ownership.free_float_pct != null) {
    h += row('Free Float', d.ownership.free_float_pct.toFixed(2) + '%', {});
  }

  h += tblE();
  h += cardE();

  // ════════════════════════════════════════
  // COL 2: PROFITABILITY & SOLVENCY
  // ════════════════════════════════════════
  h += cardS();
  h += secH('Profitability');
  h += tblS();

  // ROE
  var roeC = fu.roe > 15 ? '#22c55e' : fu.roe > 0 ? 'var(--t1)' : 'var(--rd)';
  h += row('ROE (TTM)', fu.roe ? fu.roe.toFixed(2) + '%' : '—', { color: roeC, bold: true });

  // ROA
  h += row('ROA (TTM)', fu.roa ? fu.roa.toFixed(2) + '%' : '—', {});

  // NPM
  h += row('Net Profit Margin', fu.npm ? fu.npm.toFixed(2) + '%' : '—', { color: (fu.npm||0) < 0 ? 'var(--rd)' : 'var(--t1)' });

  // Gross Profit Margin (if available from backend)
  if (fu.gpm != null) {
    h += row('Gross Profit Margin', fu.gpm.toFixed(2) + '%', {});
  }

  // Operating Profit Margin (if available)
  if (fu.opm != null) {
    h += row('Operating Profit Margin', fu.opm.toFixed(2) + '%', {});
  }

  h += tblE();

  // Solvency sub-section
  h += '<div style="margin-top:8px">';
  h += '<div style="font-size:10px;font-weight:600;color:var(--t3);margin-bottom:4px">Solvency</div>';
  h += tblS();

  // DER
  var derC = fu.der > 2 ? 'var(--rd)' : fu.der > 1 ? 'var(--am)' : 'var(--t1)';
  h += row('DER', fu.der ? fu.der.toFixed(2) : '—', { color: derC });

  // DAR
  if (fu.dar != null) h += row('DAR', fu.dar.toFixed(1) + '%', {});

  // Equity Ratio
  if (fu.equity_ratio != null) h += row('Equity Ratio', fu.equity_ratio.toFixed(1) + '%', {});

  // Financial Leverage (Assets / Equity)
  if (fu.assets && fu.equity && fu.equity > 0) {
    var finLev = fu.assets / fu.equity;
    h += row('Financial Leverage', finLev.toFixed(2) + 'x', { color: finLev > 3 ? 'var(--rd)' : finLev > 2 ? 'var(--am)' : 'var(--t1)' });
  }

  h += tblE();
  h += '</div>';

  // DuPont
  if (fu.dupont) {
    var dp = fu.dupont;
    h += '<div style="margin-top:8px;padding:8px;background:var(--bgH);border-radius:4px">';
    h += '<div style="font-size:10px;font-weight:700;color:var(--t3);margin-bottom:4px">DUPONT DECOMPOSITION</div>';
    h += '<div style="font-size:11px;font-family:var(--fm);color:var(--t2);line-height:1.7">';
    h += 'ROE = <span style="color:var(--bl)">' + dp.npm.toFixed(1) + '%</span> × <span style="color:var(--am)">' + dp.asset_turnover.toFixed(1) + '%</span> × <span style="color:#a855f7">' + dp.equity_multiplier.toFixed(2) + 'x</span>';
    h += '<br><span style="font-size:9px;color:var(--t3)">NPM × Asset Turnover × Eq Multiplier = ' + dp.roe_check.toFixed(1) + '%</span>';
    h += '</div></div>';
  }
  h += cardE();

  // ════════════════════════════════════════
  // COL 3: FINANCIAL STATEMENTS
  // ════════════════════════════════════════
  h += cardS();
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);text-transform:uppercase;letter-spacing:.3px">Financial Statements</div>';
  h += '<div style="font-size:10px;color:var(--t3)">' + esc(fu.snapshot_month || '') + '</div>';
  h += '</div>';

  // Income Statement
  h += '<div style="font-size:10px;font-weight:600;color:var(--t3);margin-bottom:3px">Income Statement</div>';
  h += tblS();
  h += row('Revenue (TTM)', fu.sales ? fmtBM(fu.sales) : '—', {});
  if (fu.gross_profit != null) {
    h += row('Gross Profit', fmtBM(fu.gross_profit), { color: (fu.gross_profit||0) < 0 ? 'var(--rd)' : 'var(--t1)' });
  }
  h += row('EBT', fu.ebt ? fmtBM(fu.ebt) : '—', { color: (fu.ebt||0) < 0 ? 'var(--rd)' : 'var(--t1)' });
  h += row('Net Income', fu.profit ? fmtBM(fu.profit) : '—', { color: (fu.profit||0) < 0 ? 'var(--rd)' : 'var(--gn)', bold: true });
  h += tblE();

  // Balance Sheet
  h += '<div style="font-size:10px;font-weight:600;color:var(--t3);margin:6px 0 3px">Balance Sheet</div>';
  h += tblS();
  h += row('Total Assets', fu.assets ? fmtBM(fu.assets) : '—', {});
  h += row('Total Liabilities', fu.liabilities ? fmtBM(fu.liabilities) : '—', { color: 'var(--rd)' });
  h += row('Total Equity', fu.equity ? fmtBM(fu.equity) : '—', { color: 'var(--gn)', bold: true });
  h += tblE();

  // Per Share
  h += '<div style="font-size:10px;font-weight:600;color:var(--t3);margin:6px 0 3px">Per Share</div>';
  h += tblS();
  h += row('EPS (TTM)', fu.eps_trailing ? fu.eps_trailing.toFixed(2) : '—', { color: (fu.eps_trailing||0) < 0 ? 'var(--rd)' : 'var(--t1)' });
  h += row('Book Value/Share', fu.book_value ? fu.book_value.toFixed(2) : '—', {});
  // Revenue Per Share (if shares available)
  if (fu.shares_outstanding && fu.sales) {
    var rps = (fu.sales * 1e6) / fu.shares_outstanding; // sales in Miliar×1e6 to get per-share
    h += row('Revenue/Share', rps.toFixed(2), {});
  }
  h += tblE();

  // YoY Growth
  if (d.fund_growth) {
    var fg = d.fund_growth;
    h += '<div style="font-size:10px;font-weight:600;color:var(--t3);margin:6px 0 3px">Growth YoY <span style="font-weight:400">(' + esc(fg.period) + ')</span></div>';
    h += tblS();
    if (fg.revenue_growth != null) h += row('Revenue', pctFmt(fg.revenue_growth), { color: pctC(fg.revenue_growth), bold: true });
    if (fg.profit_growth != null) h += row('Net Income', pctFmt(fg.profit_growth), { color: pctC(fg.profit_growth), bold: true });
    if (fg.eps_growth != null) h += row('EPS', pctFmt(fg.eps_growth), { color: pctC(fg.eps_growth) });
    if (fg.equity_growth != null) h += row('Equity', pctFmt(fg.equity_growth), { color: pctC(fg.equity_growth) });
    h += tblE();
  }

  // Sector & Classification
  h += '<div style="margin-top:6px;font-size:10px;color:var(--t3)">' + (fu.sector || '') + (fu.industry ? ' · ' + fu.industry : '') + (fu.sharia ? ' · <span style="color:var(--gn)">☪ Syariah</span>' : '') + '</div>';
  h += cardE();

  h += '</div>'; // end 3-col

  // ═══ SECOND ROW: Dividend Summary ═══
  var divH = d.dividend_history;
  if (divH && divH.length) {
    var latDps = divH[0].dps || 0;
    var latYield = close > 0 ? Math.round(latDps / close * 10000) / 100 : 0;
    // TTM dividend (sum of last 4 quarters / recent dividends within 365 days)
    var ttmDps = 0;
    var oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    var oneYearStr = oneYearAgo.toISOString().split('T')[0];
    divH.forEach(function(dv) { if (dv.cum_date >= oneYearStr) ttmDps += (dv.dps || 0); });
    var ttmYield = close > 0 ? Math.round(ttmDps / close * 10000) / 100 : 0;
    var payoutRatio = fu.eps_trailing > 0 ? Math.round(ttmDps / fu.eps_trailing * 10000) / 100 : 0;

    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">';

    // Dividend Card
    h += cardS();
    h += secH('Dividend');
    h += '<div style="display:flex;gap:8px;margin-bottom:8px">';
    h += '<div style="flex:1;text-align:center;padding:8px;background:var(--bgH);border-radius:4px"><div style="font-size:16px;font-weight:800;font-family:var(--fm);color:' + (ttmYield >= 5 ? 'var(--gn)' : 'var(--am)') + '">' + ttmYield.toFixed(2) + '%</div><div style="font-size:9px;color:var(--t3)">Div Yield (TTM)</div></div>';
    h += '<div style="flex:1;text-align:center;padding:8px;background:var(--bgH);border-radius:4px"><div style="font-size:16px;font-weight:800;font-family:var(--fm)">' + ttmDps.toLocaleString() + '</div><div style="font-size:9px;color:var(--t3)">Dividend (TTM)</div></div>';
    if (payoutRatio > 0) {
      h += '<div style="flex:1;text-align:center;padding:8px;background:var(--bgH);border-radius:4px"><div style="font-size:16px;font-weight:800;font-family:var(--fm);color:' + (payoutRatio > 100 ? 'var(--rd)' : 'var(--t1)') + '">' + payoutRatio.toFixed(1) + '%</div><div style="font-size:9px;color:var(--t3)">Payout Ratio</div></div>';
    }
    h += '</div>';
    // Latest Ex-Date
    if (divH[0].cum_date) {
      h += '<div style="font-size:10px;color:var(--t3)">Latest Ex-Date: <span style="color:var(--t1);font-weight:600">' + esc(divH[0].cum_date) + '</span></div>';
    }
    h += cardE();

    // Dividend History mini table
    h += cardS();
    h += secH('Dividend History');
    h += '<table class="bei-tbl" style="font-size:11px"><thead style="font-size:10px"><tr><th class="al">Period</th><th class="ar">DPS</th><th class="al">Ex-Date</th><th class="ar">Yield</th></tr></thead><tbody>';
    divH.slice(0, 6).forEach(function(dv) {
      var dy = close > 0 && dv.dps > 0 ? (dv.dps / close * 100).toFixed(2) + '%' : '—';
      h += '<tr><td class="al" style="font-family:var(--fm)">' + esc(dv.div_type || 'final') + '</td><td class="ar" style="font-family:var(--fm);font-weight:600;color:var(--gn)">' + (dv.dps || 0).toLocaleString() + '</td><td class="al" style="font-family:var(--fm);color:var(--t3)">' + esc(dv.cum_date || '') + '</td><td class="ar" style="font-family:var(--fm);color:var(--t3)">' + dy + '</td></tr>';
    });
    h += '</tbody></table>';
    h += cardE();

    h += '</div>'; // end div-row
  }

  return h;
}

// ═══════════════════════════════════════════════════════════════
// TAB: FUNDACHART — Annual/Quarterly toggle
// ═══════════════════════════════════════════════════════════════
var sdFcMode = 'annual';

function sdTabFundachart(d) {
  var hasFH = d.fund_history && d.fund_history.length >= 2;
  var hasDV = d.daily_valuation && d.daily_valuation.length >= 5;
  if (!hasFH && !hasDV) return '<div style="padding:20px;color:var(--t3)">Not enough data for fundachart</div>';
  var h = '';
  if (hasFH) {
    h += '<div style="display:flex;gap:4px;margin-bottom:10px">';
    h += '<button onclick="sdFcToggle(\'annual\')" style="padding:5px 16px;font-size:11px;font-weight:' + (sdFcMode==='annual'?'700':'400') + ';color:' + (sdFcMode==='annual'?'#fff':'var(--t3)') + ';background:' + (sdFcMode==='annual'?'var(--am)':'var(--bg1)') + ';border:1px solid ' + (sdFcMode==='annual'?'var(--am)':'var(--b1)') + ';border-radius:4px;cursor:pointer">Annual</button>';
    h += '<button onclick="sdFcToggle(\'quarterly\')" style="padding:5px 16px;font-size:11px;font-weight:' + (sdFcMode==='quarterly'?'700':'400') + ';color:' + (sdFcMode==='quarterly'?'#fff':'var(--t3)') + ';background:' + (sdFcMode==='quarterly'?'var(--am)':'var(--bg1)') + ';border:1px solid ' + (sdFcMode==='quarterly'?'var(--am)':'var(--b1)') + ';border-radius:4px;cursor:pointer">Quarterly</button>';
    h += '</div>';
  }
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
  if (hasFH) {
    var ml = sdFcMode==='annual'?'Annual':'Quarterly';
    h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px"><div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">REVENUE & PROFIT <span style="font-weight:400;color:var(--t3)">(' + ml + ')</span></div><div id="sd-fc-revprofit" style="width:100%;height:' + sdChartHeight(320, 0.35, 420) + 'px"></div></div>';
    h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px"><div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">EPS & ROE <span style="font-weight:400;color:var(--t3)">(' + ml + ')</span></div><div id="sd-fc-epsroe" style="width:100%;height:' + sdChartHeight(320, 0.35, 420) + 'px"></div></div>';
    h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px"><div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">BALANCE SHEET <span style="font-weight:400;color:var(--t3)">(' + ml + ')</span></div><div id="sd-fc-bs" style="width:100%;height:' + sdChartHeight(320, 0.35, 420) + 'px"></div></div>';
  }
  if (hasDV) {
    h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px"><div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">LIVE PER · PBV · PRICE <span style="font-weight:400;color:var(--t3)">(Daily)</span></div><div id="sd-fc-val" style="width:100%;height:' + sdChartHeight(320, 0.35, 420) + 'px"></div></div>';
  }
  h += '</div>';
  return h;
}

function sdFcToggle(mode) { sdFcMode = mode; sdRenderTab('fundachart'); }

function sdPrepareFundaData(d) {
  var fh = d.fund_history || [];
  if (fh.length < 1) return { labels: [], data: [] };
  if (sdFcMode === 'annual') {
    var fy = fh.filter(function(r) { return r.quarter_label === 'FY'; });
    if (fy.length < 1) fy = fh.filter(function(r) { return r.quarter_label === 'Q3'; });
    return { labels: fy.map(function(r) { return r.period_label; }), data: fy };
  }
  // Quarterly delta
  var result = [];
  var qOrder = ['Q1','Q2','Q3','FY'];
  for (var i = 0; i < fh.length; i++) {
    var cur = fh[i], ql = cur.quarter_label, qIdx = qOrder.indexOf(ql);
    if (qIdx === 0) {
      result.push({ period_label: cur.period_label, sales: cur.sales||0, profit: cur.profit||0, eps_trailing: cur.eps_trailing||0, roe: cur.roe||0, equity: cur.equity||0, liabilities: cur.liabilities||0, assets: cur.assets||0 });
    } else {
      var prev = null;
      for (var j = i-1; j >= 0; j--) { if (qOrder.indexOf(fh[j].quarter_label) === qIdx-1) { prev = fh[j]; break; } }
      result.push({
        period_label: cur.period_label.replace('FY','Q4'),
        sales: prev ? (cur.sales||0)-(prev.sales||0) : (cur.sales||0),
        profit: prev ? (cur.profit||0)-(prev.profit||0) : (cur.profit||0),
        eps_trailing: prev ? (cur.eps_trailing||0)-(prev.eps_trailing||0) : (cur.eps_trailing||0),
        roe: cur.roe||0, equity: cur.equity||0, liabilities: cur.liabilities||0, assets: cur.assets||0
      });
    }
  }
  return { labels: result.map(function(r) { return r.period_label; }), data: result };
}

function sdDrawFundaCharts(d) {
  var p = sdPrepareFundaData(d), labels = p.labels, fd = p.data;
  // Helper: format billions/millions for tooltip
  function fmtB(v) {
    if (v == null || isNaN(v)) return '—';
    v = Math.round(v * 100) / 100;
    if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(2) + ' T';
    if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(2) + ' B';
    return v.toFixed(2) + ' M';
  }
  function fmtAxis(v) {
    if (Math.abs(v) >= 1e6) return (v/1e6).toFixed(2) + 'T';
    if (Math.abs(v) >= 1e3) return (v/1e3).toFixed(2) + 'B';
    return v.toFixed(2);
  }
  function ttFmt(params) {
    if (!params || !params.length) return '';
    var h = '<div style="font-size:10px;font-weight:700;margin-bottom:3px">' + params[0].axisValue + '</div>';
    params.forEach(function(p) {
      if (p.value == null) return;
      var v = typeof p.value === 'number' ? (Math.abs(p.value) >= 100 ? fmtB(p.value) : (Math.round(p.value*100)/100).toLocaleString()) : p.value;
      h += '<div style="font-size:10px"><span style="color:' + p.color + '">●</span> ' + p.seriesName + ': <b>' + v + '</b></div>';
    });
    return h;
  }

  if (fd.length >= 1) {
    var el1 = $('sd-fc-revprofit');
    if (el1) { var c1 = BL.init(el1, 'sd-fc-rp'); if (c1) c1.setOption({
      tooltip: { trigger: 'axis', textStyle: { fontSize: 10 }, formatter: ttFmt },
      legend: { top: 0, textStyle: { fontSize: 9 } },
      grid: { left: 55, right: 10, top: 28, bottom: 28 },
      xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 9, rotate: labels.length > 6 ? 30 : 0 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 8, formatter: fmtAxis }, splitLine: { lineStyle: { color: '#1e2836' } } },
      series: [
        { name: 'Revenue', type: 'bar', data: fd.map(function(r){return Math.round(r.sales*100)/100;}), itemStyle: { color: 'rgba(84,112,198,0.7)' }, barMaxWidth: 28 },
        { name: 'Net Profit', type: 'bar', data: fd.map(function(r){return Math.round(r.profit*100)/100;}), itemStyle: { color: function(p){return (p.value||0)>=0?'rgba(34,197,94,0.7)':'rgba(239,68,68,0.7)';} }, barMaxWidth: 28 }
      ]
    }, true); }

    var el2 = $('sd-fc-epsroe');
    if (el2) { var c2 = BL.init(el2, 'sd-fc-er'); if (c2) c2.setOption({
      tooltip: { trigger: 'axis', textStyle: { fontSize: 10 }, formatter: ttFmt },
      legend: { top: 0, textStyle: { fontSize: 9 } },
      grid: { left: 50, right: 45, top: 28, bottom: 28 },
      xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 9, rotate: labels.length > 6 ? 30 : 0 } },
      yAxis: [
        { type: 'value', name: 'EPS', nameTextStyle: { fontSize: 8 }, axisLabel: { fontSize: 8 }, splitLine: { lineStyle: { color: '#1e2836' } } },
        { type: 'value', name: 'ROE %', nameTextStyle: { fontSize: 8 }, axisLabel: { fontSize: 8 }, splitLine: { show: false } }
      ],
      series: [
        { name: 'EPS', type: 'bar', data: fd.map(function(r){return Math.round(r.eps_trailing*100)/100;}), itemStyle: { color: function(p){return (p.value||0)>=0?'rgba(14,165,233,0.7)':'rgba(239,68,68,0.7)';} }, barMaxWidth: 28 },
        { name: 'ROE', type: 'line', yAxisIndex: 1, data: fd.map(function(r){return Math.round(r.roe*100)/100;}), symbol: 'circle', symbolSize: 5, lineStyle: { color: '#22c55e', width: 2 }, itemStyle: { color: '#22c55e' } }
      ]
    }, true); }

    var el3 = $('sd-fc-bs');
    if (el3) { var c3 = BL.init(el3, 'sd-fc-bs'); if (c3) c3.setOption({
      tooltip: { trigger: 'axis', textStyle: { fontSize: 10 }, formatter: ttFmt },
      legend: { top: 0, textStyle: { fontSize: 9 } },
      grid: { left: 55, right: 10, top: 28, bottom: 28 },
      xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 9, rotate: labels.length > 6 ? 30 : 0 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 8, formatter: fmtAxis }, splitLine: { lineStyle: { color: '#1e2836' } } },
      series: [
        { name: 'Equity', type: 'bar', stack: 'bs', data: fd.map(function(r){return Math.round(r.equity*100)/100;}), itemStyle: { color: 'rgba(34,197,94,0.7)' }, barMaxWidth: 28 },
        { name: 'Liabilities', type: 'bar', stack: 'bs', data: fd.map(function(r){return Math.round(r.liabilities*100)/100;}), itemStyle: { color: 'rgba(239,68,68,0.5)' }, barMaxWidth: 28 }
      ]
    }, true); }
  }

  // Daily Live Valuation — 3 Y-axes: PER (left), PBV (left-inner), Price (right)
  var dv = d.daily_valuation || [];
  if (dv.length >= 5) {
    var el4 = $('sd-fc-val');
    if (el4) { var c4 = BL.init(el4, 'sd-fc-val'); if (c4) c4.setOption({
      tooltip: { trigger: 'axis', textStyle: { fontSize: 10 }, formatter: function(params) {
        if (!params || !params.length) return '';
        var h = '<div style="font-size:10px;color:#888;margin-bottom:3px">' + params[0].axisValue + '</div>';
        params.forEach(function(p) {
          if (p.value == null) return;
          var v = p.seriesName === 'Price' ? p.value.toLocaleString() : (Math.round(p.value*100)/100).toFixed(2);
          h += '<div style="font-size:10px"><span style="color:' + p.color + '">●</span> ' + p.seriesName + ': <b>' + v + (p.seriesName === 'Live PER' ? 'x' : p.seriesName === 'Live PBV' ? 'x' : '') + '</b></div>';
        });
        return h;
      }},
      legend: { top: 0, textStyle: { fontSize: 9 } },
      grid: { left: 45, right: 55, top: 28, bottom: 28 },
      xAxis: { type: 'category', data: dv.map(function(r){return r.date;}), axisLabel: { fontSize: 8, formatter: function(v){return v.substring(5);} } },
      yAxis: [
        { type: 'value', name: 'PER', nameTextStyle: { fontSize: 8, color: '#ff9800' }, scale: true, axisLabel: { fontSize: 8, color: '#ff9800' }, splitLine: { lineStyle: { color: '#1e2836' } } },
        { type: 'value', name: 'Price', nameTextStyle: { fontSize: 8, color: 'rgba(255,255,255,0.4)' }, scale: true, position: 'right', axisLabel: { fontSize: 8, color: 'rgba(255,255,255,0.4)' }, splitLine: { show: false } },
        { type: 'value', name: 'PBV', nameTextStyle: { fontSize: 8, color: '#a855f7' }, scale: true, position: 'right', offset: 40, axisLabel: { fontSize: 8, color: '#a855f7' }, splitLine: { show: false } }
      ],
      dataZoom: [{ type: 'inside', start: 0, end: 100 }],
      series: [
        { name: 'Live PER', type: 'line', yAxisIndex: 0, data: dv.map(function(r){return r.live_per;}), symbol: 'none', lineStyle: { color: '#ff9800', width: 2 }, itemStyle: { color: '#ff9800' }, connectNulls: true },
        { name: 'Live PBV', type: 'line', yAxisIndex: 2, data: dv.map(function(r){return r.live_pbv;}), symbol: 'none', lineStyle: { color: '#a855f7', width: 1.5 }, itemStyle: { color: '#a855f7' }, connectNulls: true },
        { name: 'Price', type: 'line', yAxisIndex: 1, data: dv.map(function(r){return r.close;}), symbol: 'none', lineStyle: { color: 'rgba(255,255,255,0.4)', width: 1.5, type: 'dashed' }, itemStyle: { color: 'rgba(255,255,255,0.4)' } }
      ]
    }, true); }
  }
}

// ═══════════════════════════════════════════════════════════════
// TAB: ANALYSIS
// ═══════════════════════════════════════════════════════════════
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
      h += '<span><span style="color:var(--t3);font-size:11px">MA' + label + '</span> <span style="font-weight:700;font-family:var(--fm);color:' + color + '">' + (m.dist_pct > 0 ? '+' : '') + m.dist_pct.toFixed(1) + '%</span> <span style="color:var(--t3);font-family:var(--fm)">' + (m.value || 0).toLocaleString() + '</span></span>';
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
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">5-FACTOR SCORE</div>';
  if (d.scoring) {
    h += '<div id="sd-radar-chart" style="width:100%;height:280px"></div>';
    h += '<table class="bei-tbl" style="font-size:12px"><tbody>';
    [{ k: 'score_composite', l: 'Composite', c: 'var(--bl)', bold: true },
     { k: 'score_fundamental', l: 'Fundamental', c: '#22c55e' },
     { k: 'score_valuation', l: 'Valuation', c: '#0ea5e9' },
     { k: 'score_momentum', l: 'Momentum', c: '#f59e0b' },
     { k: 'score_demand', l: 'Demand', c: '#a855f7' },
     { k: 'score_foreign', l: 'Foreign', c: '#ef4444' }].forEach(function(f) {
      var val = Math.round(d.scoring[f.k] || 0);
      var vc = val >= 70 ? '#22c55e' : val <= 30 ? '#ef4444' : f.c;
      h += '<tr><td class="al" style="color:var(--t3)">' + f.l + '</td><td class="ar" style="font-weight:' + (f.bold ? '800' : '700') + ';font-family:var(--fm);color:' + vc + ';font-size:' + (f.bold ? '14px' : '12px') + '">' + val + '</td></tr>';
    });
    h += '</tbody></table>';
  } else {
    h += '<div style="font-size:12px;color:var(--t3);padding:10px 0">No scoring data</div>';
  }
  h += '</div>';

  // Commentary
  h += '<div style="overflow-y:auto;max-height:500px">' + sdCommentary(d) + '</div>';

  h += '</div>'; // end 2-col

  // Score history chart
  if (d.score_history && d.score_history.length >= 3) {
    h += '<div style="margin-top:10px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px;padding:10px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">SCORE TREND</div>';
    h += '<div id="sd-score-chart" style="width:100%;height:' + sdChartHeight(380, 0.45, 560) + 'px"></div>';
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
  var h = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">';

  // Ownership
  if (d.ownership) {
    var own = d.ownership;
    h += '<div style="padding:10px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div style="font-size:11px;font-weight:700;color:var(--t1)">OWNERSHIP</div><div style="font-size:10px;color:var(--t3)">' + esc(own.snapshot_date) + '</div></div>';
    var fPct = own.foreign_pct || 0, lPct = own.local_pct || 0;
    h += '<div style="display:flex;height:28px;border-radius:4px;overflow:hidden;margin-bottom:10px">';
    if (lPct > 0) h += '<div style="width:' + lPct + '%;background:var(--bl);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;min-width:35px">L ' + lPct.toFixed(1) + '%</div>';
    if (fPct > 0) h += '<div style="width:' + fPct + '%;background:var(--am);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;min-width:35px">F ' + fPct.toFixed(1) + '%</div>';
    h += '</div>';
    var invTypes = [{k:'is',l:'Insurance'},{k:'cp',l:'Corporate'},{k:'pf',l:'Pension'},{k:'ib',l:'IB/Broker'},{k:'id',l:'Individual'},{k:'mf',l:'Mutual Fund'},{k:'sc',l:'Securities'},{k:'fd',l:'Foundation'},{k:'ot',l:'Others'}];
    h += '<table class="bei-tbl" style="font-size:11px"><thead style="font-size:10px"><tr><th class="al">Type</th><th class="ar">Local</th><th class="ar">Foreign</th></tr></thead><tbody>';
    var bk = own.breakdown || {}, bkL = bk.local || {}, bkF = bk.foreign || {};
    invTypes.forEach(function(t) { var lv = bkL[t.k]||0, fv = bkF[t.k]||0; if (!lv && !fv) return; h += '<tr><td class="al" style="color:var(--t3)">' + t.l + '</td><td class="ar" style="font-family:var(--fm)">' + fmtRp(lv) + '</td><td class="ar" style="font-family:var(--fm);color:var(--am)">' + fmtRp(fv) + '</td></tr>'; });
    h += '</tbody></table></div>';
  } else {
    h += '<div style="padding:20px;color:var(--t3);background:var(--bg1);border:1px solid var(--b1);border-radius:4px">No ownership data</div>';
  }

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
  var h = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">';
  var ff = d.foreign || {};

  // Foreign Flow
  h += '<div style="padding:10px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:8px">FOREIGN FLOW</div>';
  h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">';
  h += sdFlowCard('5D Net', ff.fnet_5d);
  h += sdFlowCard('10D Net', ff.fnet_10d);
  h += sdFlowCard('20D Net', ff.fnet_20d);
  h += sdFlowCard('Total', ff.fnet_total);
  h += '</div>';
  if (ff.accum_streak > 0) h += '<div style="font-size:11px;color:var(--gn);font-weight:600;margin-bottom:6px">🔥 Accumulating ' + ff.accum_streak + ' consecutive days</div>';
  if (ff.distrib_streak > 0) h += '<div style="font-size:11px;color:var(--rd);font-weight:600;margin-bottom:6px">⚠ Distributing ' + ff.distrib_streak + ' consecutive days</div>';
  h += '<div id="sd-fnet-chart" style="width:100%;height:240px"></div>';
  h += '</div>';

  // Bid/Offer
  var bo = d.bid_offer || {};
  h += '<div style="padding:10px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:8px">BID/OFFER ANALYSIS</div>';
  var avgR = bo.avg_ratio || 50;
  var boColor = avgR > 55 ? 'var(--gn)' : avgR < 45 ? 'var(--rd)' : 'var(--am)';
  h += '<div style="text-align:center;margin-bottom:8px"><div style="font-size:32px;font-weight:800;font-family:var(--fm);color:' + boColor + '">' + avgR.toFixed(1) + '%</div><div style="font-size:10px;color:var(--t3)">20D Avg Bid Ratio</div></div>';
  h += '<div id="sd-bo-chart" style="width:100%;height:240px"></div>';
  h += '</div>';

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
            h += '<div style="font-size:9px;color:' + p.color + '">' + p.seriesName + ': ' + p.value.toLocaleString() + '</div>';
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
function sdDrawFnetChart(chartData) {
  var el = $('sd-fnet-chart'); if (!el) return;
  var c = BL.init(el, 'sd-fnet'); if (!c) return;
  var last20 = chartData.slice(-20);
  c.setOption({
    grid: { left: 50, right: 10, top: 8, bottom: 24 },
    tooltip: { trigger: 'axis', textStyle: { fontSize: 10 } },
    xAxis: { type: 'category', data: last20.map(function(r) { return r.date; }), axisLabel: { fontSize: 8, formatter: function(v) { return v.substring(8); } } },
    yAxis: { type: 'value', axisLabel: { fontSize: 8, formatter: function(v) { return BL.fmtRp(v); } }, splitLine: { lineStyle: { color: '#1e2836' } } },
    series: [{ type: 'bar', barMaxWidth: 14, data: last20.map(function(r) { var v = r.fnet || 0; return { value: v, itemStyle: { color: v >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)' } }; }) }]
  }, true);
}

// ═══ BID/OFFER CHART ═══
function sdDrawBOChart(boData) {
  var el = $('sd-bo-chart'); if (!el) return;
  var c = BL.init(el, 'sd-bo'); if (!c) return;
  c.setOption({
    grid: { left: 35, right: 10, top: 8, bottom: 24 },
    xAxis: { type: 'category', data: boData.map(function(r) { return r.date; }), axisLabel: { fontSize: 8, formatter: function(v) { return v.substring(8); } } },
    yAxis: { type: 'value', min: 20, max: 80, axisLabel: { fontSize: 8, formatter: function(v) { return v + '%'; } }, splitLine: { lineStyle: { color: '#1e2836' } } },
    series: [
      { type: 'bar', data: boData.map(function(r) { return { value: r.ratio, itemStyle: { color: r.ratio > 55 ? 'rgba(34,197,94,0.6)' : r.ratio < 45 ? 'rgba(239,68,68,0.6)' : 'rgba(255,152,0,0.4)' } }; }), barMaxWidth: 12 },
      { type: 'line', data: boData.map(function() { return 50; }), symbol: 'none', lineStyle: { color: '#555', type: 'dashed', width: 1 }, silent: true }
    ]
  }, true);
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
  if (perVal > 0 && perVal < 10) items.push('PER <b style="color:var(--gn)">' + perVal.toFixed(1) + 'x</b> — murah');
  else if (perVal > 20) items.push('PER <b style="color:var(--rd)">' + perVal.toFixed(1) + 'x</b> — premium');
  if (fu.roe && fu.roe > 15) items.push('ROE <b style="color:var(--gn)">' + fu.roe.toFixed(1) + '%</b>');
  if (fu.der && fu.der > 2) items.push('DER <b style="color:var(--rd)">' + fu.der.toFixed(2) + '</b> — leverage tinggi');
  if (fu.eps_trailing && fu.eps_trailing < 0) items.push('<b style="color:var(--rd)">Perusahaan merugi</b> (EPS ' + fu.eps_trailing.toFixed(0) + ')');
  if (items.length) h += '<p style="margin:0 0 8px"><b>Fundamental:</b> ' + items.join('. ') + '.</p>';

  // Ownership & Dividend
  var ownData = d.ownership;
  if (ownData) {
    items = [];
    items.push('Foreign ownership <b>' + ownData.foreign_pct.toFixed(1) + '%</b>');
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

  // Commodity
  var cmd = d.commodity_context;
  if (cmd) {
    h += '<p style="margin:0 0 8px"><b>Commodity:</b> ' + esc(cmd.label) + ' ' + (cmd.price||0).toLocaleString() + ', 5D: ' + (cmd.chg_5d > 0 ? '+' : '') + cmd.chg_5d + '%, 20D: ' + (cmd.chg_20d > 0 ? '+' : '') + cmd.chg_20d + '%.</p>';
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