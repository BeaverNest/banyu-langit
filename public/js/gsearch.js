// ═══ Global Search + Unified Ticker Page ═══
var gsData = [];

// Load ticker list for autocomplete
async function gsLoadData() {
  try { var r = await fetch('/api/search?q='); gsData = []; } catch {}
}

// Autocomplete
async function gsAcType() {
  var q = ($('gsearch') || {}).value || '';
  var ac = $('gs-ac'); if (!ac) return;
  if (q.length < 1) { ac.classList.remove('v'); return; }
  try {
    var r = await fetch('/api/search?q=' + encodeURIComponent(q));
    var data = await r.json();
    if (!data.length) { ac.classList.remove('v'); return; }
    ac.innerHTML = data.map(function(r) {
      var fn = r.fnet_val || 0; var cls = fn > 0 ? 'up' : fn < 0 ? 'dn' : '';
      return '<div class="gs-ac-item" onclick="gsOpen(\'' + esc(r.code) + '\')">' +
        '<span class="ac-code">' + esc(r.code) + '</span>' +
        '<span class="ac-name">' + esc(r.name || '') + '</span>' +
        '<span class="ac-val">' + (r.close || 0).toLocaleString() + '</span>' +
        '<span class="ac-val ' + cls + '" style="min-width:60px;text-align:right">' + fmtRp(fn) + '</span>' +
        '</div>';
    }).join('');
    ac.classList.add('v');
  } catch { ac.classList.remove('v'); }
}

function gsAcKey(e) {
  if (e.key === 'Enter') {
    var q = ($('gsearch') || {}).value || '';
    if (q.trim()) gsOpen(q.trim().toUpperCase());
    $('gs-ac').classList.remove('v');
  }
  if (e.key === 'Escape') { $('gs-ac').classList.remove('v'); $('gsearch').blur(); }
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('#gsearch-wrap')) $('gs-ac').classList.remove('v');
});

// Open Ticker Page
async function gsOpen(code) {
  $('gs-ac').classList.remove('v');
  $('gsearch').value = code;
  var ov = $('ticker-ov'); var pg = $('ticker-page');
  ov.classList.add('v');
  pg.innerHTML = '<div style="padding:40px;text-align:center">' + skelRows(8) + '</div>';

  try {
    var r = await fetch('/api/ticker/' + encodeURIComponent(code));
    var d = await r.json();
    renderTickerPage(d);
  } catch (e) {
    pg.innerHTML = '<div style="padding:40px;text-align:center;color:var(--t3)">Error: ' + e.message + '</div>';
  }
}

function gsClose() {
  $('ticker-ov').classList.remove('v');
  $('gsearch').value = '';
}

// Render Ticker Page
var tpTab = 'overview';
function renderTickerPage(d) {
  var pg = $('ticker-page');
  var p = d.price || {};
  var code = d.code || '';
  var name = p.name || d.yahoo?.name || '';
  var close = p.close || d.yahoo?.price || 0;
  var chgPct = p.change_pct || d.yahoo?.change || 0;
  var chg = p.close ? (p.close - (p.prev_close || 0)) : 0;
  var pCls = chgPct > 0 ? 'up' : chgPct < 0 ? 'dn' : '';
  var hasCa = d.corporate_actions && d.corporate_actions.length > 0;

  var h = '<div class="tp-header">';
  // Top row
  h += '<div class="tp-top">';
  h += '<button class="tp-close" onclick="gsClose()">✕</button>';
  h += '<span class="tp-code">' + esc(code) + '</span>';
  h += '<span class="tp-name">' + esc(name) + '</span>';
  // CA badge
  if (hasCa) {
    h += '<span style="font-size:9px;padding:2px 8px;border-radius:4px;background:var(--amB);color:var(--am);font-weight:600" title="' + d.corporate_actions.length + ' corporate action(s)">⚡ ' + d.corporate_actions.length + ' CA</span>';
  }
  h += '<div class="tp-actions">';
  h += '<button onclick="addWatchlistFrom(\'' + esc(code) + '\');showT(\'Watchlist\',\'' + esc(code) + '.JK added\')">+ Watchlist</button>';
  h += '<button onclick="gsClose();stab(\'ins\',document.querySelectorAll(\'.tabs .tab\')[3]);setTimeout(function(){insGoStock(\'' + esc(code) + '\')},200)">🔍 Insider</button>';
  h += '<button onclick="gsClose();stab(\'wl\',document.querySelectorAll(\'.tabs .tab\')[1]);setTimeout(function(){swt(\'alt\',document.querySelectorAll(\'.wt-b\')[1]);$(\'as\').value=\'' + esc(code) + '.JK\';},200)">🔔 Alert</button>';
  h += '</div></div>';
  // Sector & index badges
  var fund = d.fundamental || {};
  if (fund.sector || fund.idx_index || hasCa) {
    h += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">';
    if (fund.sector) h += '<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--blB);color:var(--bl)">' + esc(fund.sector) + '</span>';
    if (fund.industry) h += '<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--bgH);color:var(--t2)">' + esc(fund.industry) + '</span>';
    if (fund.idx_index) { fund.idx_index.split(',').slice(0, 6).forEach(function(idx) { idx = idx.trim(); if (idx) h += '<span style="font-size:8px;padding:1px 4px;border-radius:3px;background:var(--amB);color:var(--am)">' + esc(idx) + '</span>'; }); }
    h += '</div>';
  }
  // Price
  h += '<div class="tp-price">';
  h += '<span class="price ' + pCls + '">' + close.toLocaleString() + '</span>';
  h += '<span class="chg ' + pCls + '">' + (chg > 0 ? '+' : '') + chg.toLocaleString() + ' (' + (chgPct > 0 ? '+' : '') + chgPct.toFixed(2) + '%)</span>';
  h += '</div>';
  // Meta row
  if (p.close) {
    var mktCap = p.market_cap || 0;
    var ff = p.tradeable_shares && p.listed_shares ? (p.tradeable_shares / p.listed_shares * 100) : 0;
    h += '<div class="tp-meta">';
    h += '<span>H <b>' + (p.high || 0).toLocaleString() + '</b></span>';
    h += '<span>L <b>' + (p.low || 0).toLocaleString() + '</b></span>';
    h += '<span>Vol <b>' + fmtNum(Math.round((p.volume || 0) / 100)) + ' lot</b></span>';
    h += '<span>Val <b>' + fmtRp(p.value || 0) + '</b></span>';
    h += '<span>Freq <b>' + fmtNum(p.frequency || 0) + '</b></span>';
    if (mktCap) h += '<span>MCap <b>' + fmtRp(mktCap) + '</b></span>';
    if (ff) h += '<span>FF <b>' + ff.toFixed(1) + '%</b></span>';
    if (p.bid) h += '<span>Bid <b>' + p.bid.toLocaleString() + '</b> (' + fmtNum(p.bid_vol) + ')</span>';
    if (p.offer) h += '<span>Offer <b>' + p.offer.toLocaleString() + '</b> (' + fmtNum(p.offer_vol) + ')</span>';
    h += '</div>';
  }
  h += '</div>';

  // Tabs
  h += '<div class="tp-tabs">';
  ['overview', 'foreign', 'insider', 'fundamental', 'quarterly'].forEach(function(t) {
    var lbl = t === 'overview' ? '📊 Overview' : t === 'foreign' ? '🌍 Foreign' : t === 'insider' ? '👥 Insider' : t === 'fundamental' ? '📈 Fundamental' : '📋 Quarterly';
    h += '<button class="tp-tab' + (tpTab === t ? ' on' : '') + '" onclick="tpTab=\'' + t + '\';renderTickerPage(window._tpData)">' + lbl + '</button>';
  });
  h += '</div>';

  // Body
  h += '<div class="tp-body">';

  if (tpTab === 'overview') {
    // Key stats grid
    if (p.close) {
      var fnv = p.foreign_net_val || 0; var fnCls = fnv > 0 ? 'up' : fnv < 0 ? 'dn' : '';
      h += '<div class="tp-section">Today</div>';
      h += '<div class="tp-grid">';
      h += '<div class="tp-stat"><div class="sv ' + fnCls + '">' + fmtRp(fnv) + '</div><div class="sl">F.Net</div></div>';
      h += '<div class="tp-stat"><div class="sv">' + fmtRp(p.value || 0) + '</div><div class="sl">Value</div></div>';
      h += '<div class="tp-stat"><div class="sv">' + fmtNum(Math.round((p.volume || 0) / 100)) + '</div><div class="sl">Vol(lot)</div></div>';
      h += '<div class="tp-stat"><div class="sv">' + fmtNum(p.frequency || 0) + '</div><div class="sl">Freq</div></div>';
      h += '</div>';
    }

    // ═══ Adjusted Price Chart — always show with timeframe selector ═══
    if (d.adj_chart && d.adj_chart.length >= 5) {
      h += tpChartWithRange(d.adj_chart, d.corporate_actions, code);
    }

    // Mini foreign flow chart (last 10 days)
    if (d.flow && d.flow.length) {
      var maxAbs = Math.max.apply(null, d.flow.map(function(r) { return Math.abs(r.foreign_net_val || 0); }));
      h += '<div class="tp-section">Foreign Flow (' + d.flow.length + 'D)</div>';
      d.flow.slice(-10).forEach(function(r) {
        var fnv = r.foreign_net_val || 0; var pct = maxAbs ? Math.min(90, Math.abs(fnv) / maxAbs * 90) : 0;
        var cls = fnv > 0 ? 'up' : fnv < 0 ? 'dn' : '';
        h += '<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:10px">';
        h += '<span style="color:var(--t3);font-family:var(--fm);min-width:68px">' + r.trade_date.substring(5) + '</span>';
        h += '<div class="tp-flow-bar" style="flex:1"><div class="bar-neg">';
        if (fnv < 0) h += '<div style="width:' + pct + '%;background:var(--rd);border-radius:2px;opacity:.8"></div>';
        h += '</div><div class="bar-mid"></div><div class="bar-pos">';
        if (fnv > 0) h += '<div style="width:' + pct + '%;background:var(--gn);border-radius:2px;opacity:.8"></div>';
        h += '</div></div>';
        h += '<span style="font-family:var(--fm);min-width:60px;text-align:right" class="' + cls + '">' + fmtRp(fnv) + '</span>';
        h += '</div>';
      });
      var lastAcc = d.flow[d.flow.length - 1]?.acc || 0;
      var accCls = lastAcc > 0 ? 'up' : lastAcc < 0 ? 'dn' : '';
      h += '<div style="margin-top:4px;font-size:11px;color:var(--t2)">Accumulation: <b class="' + accCls + '">' + fmtRp(lastAcc) + '</b></div>';
    }

  } else if (tpTab === 'foreign') {
    // Full foreign flow table — with adjusted close column if CA exists
    if (d.flow && d.flow.length) {
      var maxAbs = Math.max.apply(null, d.flow.map(function(r) { return Math.abs(r.foreign_net_val || 0); }));
      var showAdj = d.flow.some(function(r) { return r.adjusted; });
      h += '<table class="tp-holders" style="table-layout:fixed;width:100%"><colgroup>';
      h += '<col style="width:80px">';  // Date
      h += '<col style="width:60px">';  // Close
      if (showAdj) h += '<col style="width:55px">';  // Adj
      h += '<col style="width:auto;min-width:120px">';  // Flow bar
      h += '<col style="width:85px">';  // F.Net
      h += '<col style="width:75px">';  // Accum
      h += '</colgroup>';
      h += '<thead><tr><th>Date</th><th class="ar">Close</th>';
      if (showAdj) h += '<th class="ar" style="color:var(--am)">Adj</th>';
      h += '<th style="text-align:center">Flow</th><th class="ar">F.Net (IDR)</th><th class="ar">Accum</th></tr></thead><tbody>';
      for (var i = d.flow.length - 1; i >= 0; i--) {
        var r = d.flow[i]; var fnv = r.foreign_net_val || 0; var cls = fnv > 0 ? 'up' : fnv < 0 ? 'dn' : '';
        var accCls = r.acc > 0 ? 'up' : r.acc < 0 ? 'dn' : '';
        var pct = maxAbs ? Math.min(90, Math.abs(fnv) / maxAbs * 90) : 0;
        h += '<tr><td style="font-size:10px;font-family:var(--fm)">' + r.trade_date + '</td>';
        h += '<td class="ar" style="font-family:var(--fm)">' + (r.close || 0).toLocaleString() + '</td>';
        if (showAdj) {
          var adjStyle = r.adjusted ? 'color:var(--am);font-weight:600' : '';
          h += '<td class="ar" style="font-family:var(--fm);' + adjStyle + '">' + (r.adj_close || r.close || 0).toLocaleString() + '</td>';
        }
        h += '<td style="padding:4px 2px"><div class="tp-flow-bar"><div class="bar-neg">';
        if (fnv < 0) h += '<div style="width:' + pct + '%;background:var(--rd);border-radius:2px;opacity:.8"></div>';
        h += '</div><div class="bar-mid"></div><div class="bar-pos">';
        if (fnv > 0) h += '<div style="width:' + pct + '%;background:var(--gn);border-radius:2px;opacity:.8"></div>';
        h += '</div></div></td>';
        h += '<td class="ar ' + cls + '" style="font-family:var(--fm);font-weight:600">' + fmtRp(fnv) + '</td>';
        h += '<td class="ar ' + accCls + '" style="font-family:var(--fm)">' + fmtRp(r.acc) + '</td></tr>';
      }
      h += '</tbody></table>';
      if (showAdj) {
        h += '<div style="margin-top:6px;font-size:10px;color:var(--am)">⚡ Adj = adjusted price (backward, accounts for corporate actions)</div>';
      }
    } else h += '<div style="color:var(--t3);padding:20px;text-align:center">No flow data</div>';

  } else if (tpTab === 'insider') {
    // Full insider table
    if (d.insider && d.insider.holders.length) {
      h += '<div style="margin-bottom:8px;font-size:11px;color:var(--t2)">Data per ' + esc(d.insider.snapshot_date) + ' · ' + d.insider.holders.length + ' holders · Insider ' + d.insider.totalPct + '% · Free Float ' + d.insider.freeFloat + '%</div>';
      h += '<table class="tp-holders"><thead><tr><th>Investor</th><th>Type</th><th>L/F</th><th class="ar">Holdings</th><th class="ar">%</th></tr></thead><tbody>';
      d.insider.holders.forEach(function(ho) {
        var lfCls = ho.lf === 'A' || ho.lf === 'F' ? 'dn' : 'up';
        h += '<tr><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(ho.investor) + '</td>';
        h += '<td style="font-size:10px;color:var(--t3)">' + esc(ho.type || '-') + '</td>';
        h += '<td class="' + lfCls + '" style="font-size:10px">' + (ho.lf === 'A' || ho.lf === 'F' ? 'Foreign' : ho.lf ? 'Local' : '-') + '</td>';
        h += '<td class="ar">' + (ho.holdings || 0).toLocaleString() + '</td>';
        h += '<td class="ar" style="font-weight:700">' + ho.pct.toFixed(2) + '%</td></tr>';
      });
      h += '</tbody></table>';
    } else h += '<div style="color:var(--t3);padding:20px;text-align:center">No insider data for ' + esc(code) + '</div>';

  } else if (tpTab === 'fundamental') {
    var fund = d.fundamental || {};
    if (fund.code) {
      h += '<div class="tp-section">Valuation & Profitability</div>';
      h += '<div class="tp-grid">';
      h += '<div class="tp-stat"><div class="sv">' + (fund.per ? fund.per.toFixed(1) : '-') + '</div><div class="sl">PER</div></div>';
      h += '<div class="tp-stat"><div class="sv">' + (fund.pbv ? fund.pbv.toFixed(2) : '-') + '</div><div class="sl">PBV</div></div>';
      h += '<div class="tp-stat"><div class="sv ' + (fund.roe > 15 ? 'up' : fund.roe < 5 ? 'dn' : '') + '">' + (fund.roe ? fund.roe.toFixed(1) + '%' : '-') + '</div><div class="sl">ROE</div></div>';
      h += '<div class="tp-stat"><div class="sv ' + (fund.roa > 10 ? 'up' : fund.roa < 3 ? 'dn' : '') + '">' + (fund.roa ? fund.roa.toFixed(1) + '%' : '-') + '</div><div class="sl">ROA</div></div>';
      h += '<div class="tp-stat"><div class="sv ' + (fund.der < 1 ? 'up' : fund.der > 2 ? 'dn' : '') + '">' + (fund.der != null ? fund.der.toFixed(2) : '-') + '</div><div class="sl">DER</div></div>';
      h += '<div class="tp-stat"><div class="sv ' + (fund.npm > 15 ? 'up' : fund.npm < 5 ? 'dn' : '') + '">' + (fund.npm ? fund.npm.toFixed(1) + '%' : '-') + '</div><div class="sl">NPM</div></div>';
      h += '<div class="tp-stat"><div class="sv">' + fmtRp(fund.mkt_cap || 0) + '</div><div class="sl">Mkt Cap</div></div>';
      h += '<div class="tp-stat"><div class="sv">' + fmtRp(fund.total_rev || 0) + '</div><div class="sl">Revenue</div></div>';
      h += '</div>';
      h += '<div class="tp-section">Price Performance</div>';
      h += '<div class="tp-grid">';
      [['mtd', 'MTD'], ['ytd', 'YTD'], ['chg_4w', '4W'], ['chg_13w', '13W'], ['chg_26w', '26W'], ['chg_52w', '52W']].forEach(function(p) {
        var v = fund[p[0]] || 0; var cls = v > 0 ? 'up' : v < 0 ? 'dn' : '';
        h += '<div class="tp-stat"><div class="sv ' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</div><div class="sl">' + p[1] + '</div></div>';
      });
      h += '</div>';
      if (fund.sector || fund.idx_index) {
        h += '<div class="tp-section">Classification</div>';
        h += '<div style="font-size:11px;line-height:1.8">';
        if (fund.sector) h += '<div><span style="color:var(--t3);min-width:80px;display:inline-block">Sector</span> <b>' + esc(fund.sector) + '</b></div>';
        if (fund.subsector) h += '<div><span style="color:var(--t3);min-width:80px;display:inline-block">Subsector</span> ' + esc(fund.subsector) + '</div>';
        if (fund.industry) h += '<div><span style="color:var(--t3);min-width:80px;display:inline-block">Industry</span> ' + esc(fund.industry) + '</div>';
        if (fund.subindustry) h += '<div><span style="color:var(--t3);min-width:80px;display:inline-block">Sub-industry</span> ' + esc(fund.subindustry) + '</div>';
        h += '</div>';
        if (fund.idx_index) {
          h += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">';
          fund.idx_index.split(',').forEach(function(idx) { idx = idx.trim(); if (idx) h += '<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--amB);color:var(--am)">' + esc(idx) + '</span>'; });
          h += '</div>';
        }
      }
      h += '<div style="margin-top:10px;font-size:10px;color:var(--t3)">Data: BEI Screener ' + esc(fund.snapshot_month) + '</div>';
    } else h += '<div style="color:var(--t3);padding:20px;text-align:center">No fundamental data. Upload BEI Screener XLSX via Settings.</div>';

  } else if (tpTab === 'quarterly') {
    // Quarterly financials from Yahoo Finance data
    h += '<div id="tp-quarterly" style="padding:4px 0"><div style="color:var(--t3);text-align:center;padding:12px">Loading quarterly data...</div></div>';
    // Async load after render
    setTimeout(function() { loadQuarterlyTab(d.code); }, 50);
  }

  h += '</div>';
  pg.innerHTML = h;
  window._tpData = d;
}

// ═══ Price Chart with Timeframe Selector ═══
var tpChartRange = '3m';

function tpChartWithRange(fullData, cas, code) {
  var h = '<div class="tp-section" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
  h += '<span>Price Chart</span>';
  var hasCa = cas && cas.length;
  if (hasCa) h += '<span style="font-size:9px;padding:2px 6px;border-radius:4px;background:var(--amB);color:var(--am)">⚡ Adjusted</span>';
  h += '<span style="flex:1"></span>';
  // Range buttons
  [{k:'1m',l:'1M'},{k:'3m',l:'3M'},{k:'6m',l:'6M'},{k:'1y',l:'1Y'},{k:'2y',l:'2Y'},{k:'all',l:'ALL'}].forEach(function(r) {
    h += '<button class="bei-sort-btn' + (tpChartRange === r.k ? ' on' : '') + '" onclick="tpChartRange=\'' + r.k + '\';renderTickerPage(window._tpData)" style="padding:2px 7px;font-size:9px">' + r.l + '</button>';
  });
  h += '</div>';

  // Filter data by range
  var data = fullData;
  if (tpChartRange !== 'all') {
    var now = new Date(), cutoff = new Date();
    if (tpChartRange === '1m') cutoff.setMonth(now.getMonth() - 1);
    else if (tpChartRange === '3m') cutoff.setMonth(now.getMonth() - 3);
    else if (tpChartRange === '6m') cutoff.setMonth(now.getMonth() - 6);
    else if (tpChartRange === '1y') cutoff.setFullYear(now.getFullYear() - 1);
    else if (tpChartRange === '2y') cutoff.setFullYear(now.getFullYear() - 2);
    var cutStr = cutoff.toISOString().split('T')[0];
    data = fullData.filter(function(r) { return r.trade_date >= cutStr; });
  }
  if (data.length < 2) data = fullData.slice(-20); // fallback

  h += tpDrawPriceChart(data, cas);

  // CA summary badges
  if (hasCa) {
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">';
    cas.forEach(function(ca) {
      var typeLbl = { split: 'SPLIT', reverse: 'REVERSE', rights_or_bonus: 'RIGHTS/BONUS', manual: 'MANUAL' }[ca.action_type] || ca.action_type;
      h += '<span style="font-size:10px;padding:3px 8px;border-radius:5px;background:var(--amB);color:var(--am);font-family:var(--fm)">⚡ ' + typeLbl + ' ' + ca.ex_date + ' (' + ca.ratio.toFixed(2) + 'x)</span>';
    });
    h += '</div>';
  }

  return h;
}

// ═══ SVG Price Chart Renderer ═══
function tpDrawPriceChart(data, cas) {
  var W = 820, H = 180;
  var pad = { t: 16, r: 55, b: 24, l: 50 };
  var cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;

  var hasAdj = data.some(function(r) { return r.adjusted; });
  var closes = data.map(function(r) { return r.adj_close; });
  var rawCloses = data.map(function(r) { return r.close; });
  var dates = data.map(function(r) { return r.trade_date; });

  var minC = Math.min.apply(null, closes);
  var maxC = Math.max.apply(null, closes);
  if (hasAdj) {
    minC = Math.min(minC, Math.min.apply(null, rawCloses));
    maxC = Math.max(maxC, Math.max.apply(null, rawCloses));
  }
  var rng = maxC - minC || 1; minC -= rng * .05; maxC += rng * .05; rng = maxC - minC;

  function xS(i) { return pad.l + i / (data.length - 1) * cW; }
  function yS(v) { return pad.t + (1 - (v - minC) / rng) * cH; }

  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;border:1px solid var(--b1);border-radius:8px;background:var(--bg2)">';

  // Grid
  for (var g = 0; g <= 4; g++) {
    var gy = pad.t + g / 4 * cH; var gv = maxC - g / 4 * rng;
    svg += '<line x1="' + pad.l + '" y1="' + gy + '" x2="' + (W - pad.r) + '" y2="' + gy + '" stroke="var(--b1)" stroke-width="1"/>';
    svg += '<text x="' + (W - pad.r + 4) + '" y="' + (gy + 3) + '" fill="var(--t3)" font-size="9" font-family="var(--fm)">' + Math.round(gv).toLocaleString() + '</text>';
  }

  // Date labels
  var ls = Math.max(1, Math.floor(data.length / 6));
  for (var di = 0; di < data.length; di += ls) {
    svg += '<text x="' + xS(di) + '" y="' + (H - 4) + '" fill="var(--t3)" font-size="8" font-family="var(--fm)" text-anchor="middle">' + dates[di].substring(5) + '</text>';
  }

  // Raw price line (gray dashed) — only if adjusted
  if (hasAdj) {
    var rawPts = [];
    rawCloses.forEach(function(c, i) { rawPts.push(xS(i) + ',' + yS(c)); });
    svg += '<polyline points="' + rawPts.join(' ') + '" fill="none" stroke="var(--t3)" stroke-width="1" stroke-dasharray="3,2" opacity="0.5"/>';
  }

  // Adjusted/main price line
  var adjPts = [];
  closes.forEach(function(c, i) { adjPts.push(xS(i) + ',' + yS(c)); });
  svg += '<polyline points="' + adjPts.join(' ') + '" fill="none" stroke="var(--bl)" stroke-width="2" stroke-linejoin="round"/>';

  // End dot
  svg += '<circle cx="' + xS(data.length - 1) + '" cy="' + yS(closes[closes.length - 1]) + '" r="3" fill="var(--bl)"/>';

  // CA markers
  if (cas && cas.length) {
    cas.forEach(function(ca) {
      var idx = -1;
      for (var j = 0; j < dates.length; j++) {
        if (dates[j] >= ca.ex_date) { idx = j; break; }
      }
      if (idx >= 0 && idx < data.length) {
        var cx = xS(idx);
        svg += '<line x1="' + cx + '" y1="' + pad.t + '" x2="' + cx + '" y2="' + (H - pad.b) + '" stroke="var(--am)" stroke-width="1" stroke-dasharray="4,2"/>';
        var typeLbl = { split: 'S', reverse: 'R', rights_or_bonus: 'RB', manual: 'M' }[ca.action_type] || '?';
        svg += '<text x="' + cx + '" y="' + (pad.t - 3) + '" fill="var(--am)" font-size="8" font-family="var(--fm)" text-anchor="middle" font-weight="700">⚡' + typeLbl + ' ' + ca.ratio.toFixed(1) + 'x</text>';
      }
    });
  }

  // Legend
  if (hasAdj) {
    svg += '<text x="' + pad.l + '" y="' + (pad.t - 4) + '" fill="var(--bl)" font-size="8" font-family="var(--fm)">── Adjusted</text>';
    svg += '<text x="' + (pad.l + 65) + '" y="' + (pad.t - 4) + '" fill="var(--t3)" font-size="8" font-family="var(--fm)">╌╌ Raw</text>';
  }

  svg += '</svg>';
  return '<div style="border-radius:8px;overflow:hidden;margin-bottom:8px">' + svg + '</div>';
}

// Close on Escape or click overlay background
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && $('ticker-ov').classList.contains('v')) gsClose();
});
$('ticker-ov').addEventListener('click', function(e) {
  if (e.target === this) gsClose();
});

// ═══ QUARTERLY FINANCIALS TAB ═══
var qfMetric = 'revenue'; // revenue | net_income | eps | operating_cashflow | free_cashflow

async function loadQuarterlyTab(code) {
  var el = $('tp-quarterly'); if (!el) return;
  try {
    var r = await fetch('/api/quarterly/' + code);
    var d = await r.json();
    if (!d.data || !d.data.length) {
      el.innerHTML = '<div style="color:var(--t3);text-align:center;padding:20px">No quarterly data available.<br><span style="font-size:10px">Upload via Python script: <code>python scrape_quarterly.py</code></span></div>';
      return;
    }
    window._qfData = d.data;
    renderQuarterlyTab(el, d.data, code);
  } catch (e) {
    el.innerHTML = '<div class="ne">Error: ' + e.message + '</div>';
  }
}

function renderQuarterlyTab(el, data, code) {
  // Sort by period ascending (oldest first)
  var sorted = data.slice().sort(function(a, b) { return a.period.localeCompare(b.period); });

  // Metric selector
  var h = '<div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap">';
  [{k:'revenue',l:'Revenue'},{k:'net_income',l:'Net Income'},{k:'eps',l:'EPS'},
   {k:'gross_profit',l:'Gross Profit'},{k:'operating_cashflow',l:'Op. Cash Flow'},{k:'free_cashflow',l:'Free CF'}].forEach(function(m) {
    h += '<button class="bei-sort-btn' + (qfMetric === m.k ? ' on' : '') + '" onclick="qfMetric=\'' + m.k + '\';renderQuarterlyTab($(\'tp-quarterly\'),window._qfData,\'' + esc(code) + '\')" style="padding:3px 8px;font-size:10px">' + m.l + '</button>';
  });
  h += '</div>';

  // ── Bar chart ──
  var vals = sorted.map(function(r) { return r[qfMetric] || 0; });
  var labels = sorted.map(function(r) { return r.period.substring(2, 7); }); // YY-MM
  var maxAbs = Math.max.apply(null, vals.map(function(v) { return Math.abs(v); })) || 1;

  var W = el.offsetWidth || 500, H = 180;
  var pad = {t: 15, r: 10, b: 25, l: 65};
  var cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
  var barW = Math.max(8, Math.min(30, cW / vals.length - 3));
  var hasNeg = vals.some(function(v) { return v < 0; });
  var minV = hasNeg ? -maxAbs : 0;
  var maxV = maxAbs;
  var rng = maxV - minV || 1;
  function yS(v) { return pad.t + (1 - (v - minV) / rng) * cH; }
  var zeroY = yS(0);

  var svg = '<svg width="' + W + '" height="' + H + '" style="display:block">';
  // Grid
  for (var g = 0; g <= 4; g++) {
    var gy = pad.t + g / 4 * cH; var gv = maxV - g / 4 * rng;
    svg += '<line x1="' + pad.l + '" y1="' + gy + '" x2="' + (W - pad.r) + '" y2="' + gy + '" stroke="var(--b1)" stroke-width="1"/>';
    svg += '<text x="' + (pad.l - 4) + '" y="' + (gy + 3) + '" fill="var(--t3)" font-size="8" font-family="var(--fm)" text-anchor="end">' + fmtRp(gv) + '</text>';
  }
  // Zero line
  if (hasNeg) svg += '<line x1="' + pad.l + '" y1="' + zeroY + '" x2="' + (W - pad.r) + '" y2="' + zeroY + '" stroke="var(--t2)" stroke-width="1"/>';
  // Bars
  vals.forEach(function(v, i) {
    var x = pad.l + (i + 0.5) * (cW / vals.length) - barW / 2;
    var clr = v >= 0 ? 'var(--gn)' : 'var(--rd)';
    var barH, barY;
    if (v >= 0) { barH = Math.max(1, (v / rng) * cH); barY = zeroY - barH; }
    else { barH = Math.max(1, (Math.abs(v) / rng) * cH); barY = zeroY; }
    svg += '<rect x="' + x + '" y="' + barY + '" width="' + barW + '" height="' + barH + '" fill="' + clr + '" rx="2" opacity="0.8"/>';
    // Label
    svg += '<text x="' + (x + barW / 2) + '" y="' + (H - 4) + '" fill="var(--t3)" font-size="7" font-family="var(--fm)" text-anchor="middle">' + labels[i] + '</text>';
  });
  svg += '</svg>';
  h += '<div style="border-radius:8px;overflow:hidden;margin-bottom:8px">' + svg + '</div>';

  // ── Data table ──
  var metricLabel = qfMetric === 'revenue' ? 'Revenue' : qfMetric === 'net_income' ? 'Net Income' :
    qfMetric === 'eps' ? 'EPS' : qfMetric === 'gross_profit' ? 'Gross Profit' :
    qfMetric === 'operating_cashflow' ? 'Op. Cash Flow' : 'Free CF';

  h += '<div style="overflow-x:auto;max-height:250px;overflow-y:auto"><table class="bei-tbl" style="width:100%"><thead><tr>';
  h += '<th class="al">Period</th><th class="ar">Revenue</th><th class="ar">Net Income</th><th class="ar">NPM</th>';
  h += '<th class="ar">EPS</th><th class="ar">Op. CF</th><th class="ar">Free CF</th>';
  h += '<th class="ar">Assets</th><th class="ar">Equity</th><th class="ar">Debt</th>';
  h += '</tr></thead><tbody>';

  sorted.reverse().forEach(function(r) {
    var npm = r.revenue ? Math.round(r.net_income / r.revenue * 1000) / 10 : 0;
    var npmCls = npm > 0 ? 'up' : npm < 0 ? 'dn' : '';
    var niCls = r.net_income > 0 ? 'up' : r.net_income < 0 ? 'dn' : '';
    var cfCls = r.operating_cashflow > 0 ? 'up' : r.operating_cashflow < 0 ? 'dn' : '';
    var fcfCls = r.free_cashflow > 0 ? 'up' : r.free_cashflow < 0 ? 'dn' : '';

    h += '<tr>';
    h += '<td class="al" style="font-family:var(--fm);font-size:10px;white-space:nowrap">' + esc(r.period) + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + fmtRp(r.revenue || 0) + '</td>';
    h += '<td class="ar ' + niCls + '" style="font-family:var(--fm)">' + fmtRp(r.net_income || 0) + '</td>';
    h += '<td class="ar ' + npmCls + '" style="font-family:var(--fm)">' + npm.toFixed(1) + '%</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + (r.eps ? r.eps.toLocaleString() : '-') + '</td>';
    h += '<td class="ar ' + cfCls + '" style="font-family:var(--fm)">' + fmtRp(r.operating_cashflow || 0) + '</td>';
    h += '<td class="ar ' + fcfCls + '" style="font-family:var(--fm)">' + fmtRp(r.free_cashflow || 0) + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + fmtRp(r.total_assets || 0) + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + fmtRp(r.total_equity || 0) + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + fmtRp(r.total_debt || 0) + '</td>';
    h += '</tr>';
  });

  h += '</tbody></table></div>';
  h += '<div style="margin-top:6px;font-size:10px;color:var(--t3)">Source: Yahoo Finance quarterly reports. Upload via <code>python scrape_quarterly.py</code></div>';
  el.innerHTML = h;
}