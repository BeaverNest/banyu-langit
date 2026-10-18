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

  // Sync chart panel
  if (typeof chartSetTicker === 'function') chartSetTicker(code);

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
  // Suspend badge
  if (p.suspended) {
    h += '<span style="font-size:9px;padding:2px 8px;border-radius:4px;background:var(--rdB);color:var(--rd);font-weight:700;animation:pulse 1.5s infinite">⚠ SUSPEND</span>';
  }
  h += '<span class="tp-name">' + esc(name) + '</span>';
  // CA badge
  if (hasCa) {
    h += '<span style="font-size:9px;padding:2px 8px;border-radius:4px;background:var(--amB);color:var(--am);font-weight:600" title="' + d.corporate_actions.length + ' corporate action(s)">⚡ ' + d.corporate_actions.length + ' CA</span>';
  }
  h += '<div class="tp-actions">';
  h += '<button onclick="window.open(\'https://stockbit.com/symbol/' + esc(code) + '/chartbit\',\'_blank\')" style="background:var(--bl);color:#fff;border-color:var(--bl)">📈 Chart</button>';
  h += '<button onclick="window.open(\'https://www.idx.co.id/id/hasil-pencarian?q=' + esc(code) + '&p=1&sort=1\',\'_blank\')">🏛 IDX</button>';
  h += '<button onclick="addWatchlistFrom(\'' + esc(code) + '\');showT(\'Watchlist\',\'' + esc(code) + '.JK added\')">+ Watchlist</button>';
  h += '<button onclick="gsClose();stab(\'ins\',document.querySelectorAll(\'.tabs .tab\')[5]);setTimeout(function(){insGoStock(\'' + esc(code) + '\')},200)">🔍 Insider</button>';
  h += '<button onclick="gsClose();togWL();setTimeout(function(){$(\'as\').value=\'' + esc(code) + '.JK\';},200)">🔔 Alert</button>';
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

  // Tabs — merged Fundamental+Quarterly, added News
  h += '<div class="tp-tabs">';
  ['overview', 'foreign', 'insider', 'fundamental', 'news'].forEach(function(t) {
    var lbl = t === 'overview' ? '📊 Overview' : t === 'foreign' ? '🌍 Foreign' : t === 'insider' ? '👥 Insider' : t === 'fundamental' ? '📈 Fundamental' : '📋 News';
    h += '<button class="tp-tab' + (tpTab === t ? ' on' : '') + '" onclick="tpTab=\'' + t + '\';renderTickerPage(window._tpData)">' + lbl + '</button>';
  });
  h += '</div>';

  // Body
  h += '<div class="tp-body">';

  if (tpTab === 'overview') {
    // Key stats grid — enriched with bid/offer
    if (p.close) {
      var fnv = p.foreign_net_val || 0; var fnCls = fnv > 0 ? 'up' : fnv < 0 ? 'dn' : '';
      h += '<div class="tp-section">Today</div>';
      h += '<div class="tp-grid">';
      h += '<div class="tp-stat"><div class="sv ' + fnCls + '">' + fmtRp(fnv) + '</div><div class="sl">F.Net</div></div>';
      h += '<div class="tp-stat"><div class="sv">' + fmtRp(p.value || 0) + '</div><div class="sl">Value</div></div>';
      h += '<div class="tp-stat"><div class="sv">' + fmtNum(Math.round((p.volume || 0) / 100)) + '</div><div class="sl">Vol(lot)</div></div>';
      h += '<div class="tp-stat"><div class="sv">' + fmtNum(p.frequency || 0) + '</div><div class="sl">Freq</div></div>';
      h += '<div class="tp-stat"><div class="sv" style="color:var(--gn)">' + fmtNum(p.bid_vol || 0) + '</div><div class="sl">Bid Vol</div></div>';
      h += '<div class="tp-stat"><div class="sv" style="color:var(--rd)">' + fmtNum(p.offer_vol || 0) + '</div><div class="sl">Offer Vol</div></div>';
      h += '</div>';

      // Bid/Offer ratio bar
      var totalBO = (p.bid_vol || 0) + (p.offer_vol || 0);
      if (totalBO > 0) {
        var bidPct = Math.round((p.bid_vol || 0) / totalBO * 100);
        h += '<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;margin:-4px 0 8px">';
        h += '<div style="width:' + bidPct + '%;background:var(--gn);opacity:.6"></div>';
        h += '<div style="width:' + (100 - bidPct) + '%;background:var(--rd);opacity:.6"></div>';
        h += '</div>';
      }
    }

    // Dividend alert if upcoming
    if (d.dividends && d.dividends.length) {
      var latDiv = d.dividends[0];
      h += '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:4px;background:var(--gnB);border:1px solid var(--gnBo);margin-bottom:8px">';
      h += '<span style="font-size:14px">💰</span>';
      h += '<div style="font-size:var(--font-md)"><b style="color:var(--gn)">Rp ' + (latDiv.cash_dividend || 0).toLocaleString() + '</b> per share';
      if (d.dividend_yield) h += ' <span style="color:var(--t2)">(Yield: ' + d.dividend_yield.toFixed(2) + '%)</span>';
      h += '<div style="font-size:var(--font-xs);color:var(--t3)">Ex: ' + esc(latDiv.ex_date) + ' · Pay: ' + esc(latDiv.payment_date) + '</div>';
      h += '</div></div>';
    }

    // ═══ Adjusted Price Chart — always show with timeframe selector ═══
    if (d.adj_chart && d.adj_chart.length >= 5) {
      h += tpChartWithRange(d.adj_chart, d.corporate_actions, code);

      // ═══ Bid vs Offer Volume Chart — synced with price chart range ═══
      var volData = d.adj_chart;
      if (tpChartRange !== 'all') {
        var now2 = new Date(), cut2 = new Date();
        if (tpChartRange === '1m') cut2.setMonth(now2.getMonth() - 1);
        else if (tpChartRange === '3m') cut2.setMonth(now2.getMonth() - 3);
        else if (tpChartRange === '6m') cut2.setMonth(now2.getMonth() - 6);
        else if (tpChartRange === '1y') cut2.setFullYear(now2.getFullYear() - 1);
        else if (tpChartRange === '2y') cut2.setFullYear(now2.getFullYear() - 2);
        var cutStr2 = cut2.toISOString().split('T')[0];
        volData = d.adj_chart.filter(function(r) { return r.trade_date >= cutStr2; });
      }
      if (volData.length < 2) volData = d.adj_chart.slice(-20);

      // Check if bid/offer data exists
      var hasBidOffer = volData.some(function(r) { return (r.bid_vol || 0) > 0 || (r.offer_vol || 0) > 0; });
      if (hasBidOffer) {
        h += tpDrawBidOfferChart(volData);
      }
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
    var hasIdx = !!fund.code;
    var hasRatios = d.financial_ratios && d.financial_ratios.length > 0;
    var frUnit = d.financial_ratios_unit === 'million' ? 1e6 : 1;

    if (!hasIdx && !hasRatios) {
      h += '<div style="color:var(--t3);padding:30px;text-align:center">No fundamental data for ' + esc(code) + '<br><span style="font-size:10px">Fundamental data is synced automatically every day</span></div>';
    } else {

    // ─── ① VALUATION SNAPSHOT ───
    if (hasIdx) {
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
      // EPS + BV badges from financial_ratios
      if (hasRatios) {
        var latR = d.financial_ratios[0];
        h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:-2px 0 8px">';
        if (latR.eps) h += '<span style="font-size:var(--font-sm);padding:2px 8px;border-radius:4px;background:var(--bgH);border:1px solid var(--b1)">EPS <b style="color:var(--bl)">' + latR.eps.toFixed(0) + '</b></span>';
        if (latR.book_value) h += '<span style="font-size:var(--font-sm);padding:2px 8px;border-radius:4px;background:var(--bgH);border:1px solid var(--b1)">BV <b style="color:var(--bl)">' + latR.book_value.toFixed(0) + '</b></span>';
        h += '</div>';
      }
    }

    // ─── ② SECTOR COMPARISON — Bullet Chart (ECharts) ───
    if (d.sector_peers && hasIdx) {
      var sp = d.sector_peers;
      var ip = d.industry_peers;
      h += '<div class="tp-section">vs ' + esc(sp.sector) + ' Sector (' + sp.count + ' stocks)';
      if (ip) h += ' · ' + esc(ip.industry) + ' (' + ip.count + ')';
      h += '</div>';
      var metrics = [
        {k:'per', label:'PER', val: fund.per, fmt:function(v){return v.toFixed(1);}},
        {k:'pbv', label:'PBV', val: fund.pbv, fmt:function(v){return v.toFixed(2);}},
        {k:'roe', label:'ROE', val: fund.roe, fmt:function(v){return v.toFixed(1)+'%';}},
        {k:'der', label:'DER', val: fund.der, fmt:function(v){return v.toFixed(2);}},
        {k:'npm', label:'NPM', val: fund.npm, fmt:function(v){return v.toFixed(1)+'%';}}
      ].filter(function(m){return m.val && sp[m.k];});
      h += '<div style="border:1px solid var(--b1);border-radius:6px;overflow:hidden;background:var(--bg2);padding:4px 0">' + BL.container('gs-bullet-chart', metrics.length * 32 + 16) + '</div>';
      h += '<div style="display:flex;gap:12px;font-size:8px;color:var(--t3);margin-top:3px;padding:0 4px">';
      h += '<span>● Stock</span><span style="color:var(--t3)">│ Sector Median</span>';
      if (ip) h += '<span style="color:var(--am)">╎ Industry Median</span>';
      h += '<span style="color:var(--bl);opacity:.5">█ Sector P25–P75</span>';
      h += '</div>';
      // Store data for deferred render
      window._gsBulletData = {metrics:metrics,sp:sp,ip:ip,code:code,fund:fund};
    }

    // ─── ③ INDUSTRY PER/PBV BAND — Time Series (ECharts) ───
    if (d.industry_ts && d.industry_ts.data.length >= 5) {
      var its = d.industry_ts.data;
      window._fundBandMetric = window._fundBandMetric || 'pbv';
      var bm = window._fundBandMetric;
      h += '<div class="tp-section" style="display:flex;align-items:center;gap:6px">Industry ' + esc(d.industry_ts.industry) + ' Valuation Band<span style="flex:1"></span>';
      [{k:'pbv',l:'PBV'},{k:'per',l:'PER'}].forEach(function(m) {
        h += '<button class="bei-sort-btn' + (bm === m.k ? ' on' : '') + '" onclick="window._fundBandMetric=\'' + m.k + '\';renderTickerPage(window._tpData)" style="padding:2px 7px;font-size:9px">' + m.l + '</button>';
      });
      h += '</div>';
      var vals = its.map(function(r) { return r[bm] || 0; }).filter(function(v) { return v > 0; });
      if (vals.length >= 5) {
        var mean = vals.reduce(function(a, b) { return a + b; }, 0) / vals.length;
        var variance = vals.reduce(function(a, b) { return a + (b - mean) * (b - mean); }, 0) / vals.length;
        var stddev = Math.sqrt(variance);
        var stockVal = hasIdx ? (bm === 'pbv' ? fund.pbv : fund.per) : 0;
        h += '<div style="border:1px solid var(--b1);border-radius:6px;overflow:hidden;background:var(--bg2)">' + BL.container('gs-band-chart', 160) + '</div>';
        // Store for deferred render
        window._gsBandData = {its:its,bm:bm,mean:mean,stddev:stddev,stockVal:stockVal};
        // Insight
        var zscore = stddev > 0 ? (stockVal - mean) / stddev : 0;
        var zLabel = zscore > 1.5 ? 'Expensive' : zscore > 0.5 ? 'Above Avg' : zscore > -0.5 ? 'Fair' : zscore > -1.5 ? 'Below Avg' : 'Cheap';
        var zColor = zscore > 1 ? 'var(--rd)' : zscore > -0.5 ? 'var(--am)' : 'var(--gn)';
        if (stockVal > 0) {
          h += '<div style="font-size:var(--font-sm);margin-top:4px;display:flex;gap:8px;align-items:center">';
          h += '<span style="padding:2px 8px;border-radius:4px;background:var(--bgH);border:1px solid var(--b1);color:' + zColor + ';font-weight:700">' + zLabel + '</span>';
          h += '<span style="color:var(--t3)">' + esc(code) + ' ' + bm.toUpperCase() + ' ' + stockVal.toFixed(bm === 'pbv' ? 2 : 1) + ' vs Industry avg ' + mean.toFixed(1) + ' (z=' + zscore.toFixed(1) + ')</span>';
          h += '</div>';
        }
      }
    }

    // ─── ④ HISTORICAL PBV BAND — approx from adj_chart (ECharts) ───
    if (hasIdx && fund.pbv > 0 && d.adj_chart && d.adj_chart.length >= 30) {
      var bv = Math.round(d.price.close / fund.pbv); // approximate book value per share
      if (bv > 0) {
        var pbvHist = d.adj_chart.map(function(r) { return { date: r.trade_date, pbv: r.adj_close / bv }; });
        var pbvVals = pbvHist.map(function(r) { return r.pbv; });
        var pbvMean = pbvVals.reduce(function(a, b) { return a + b; }, 0) / pbvVals.length;
        var pbvVar = pbvVals.reduce(function(a, b) { return a + (b - pbvMean) * (b - pbvMean); }, 0) / pbvVals.length;
        var pbvStd = Math.sqrt(pbvVar);
        h += '<div class="tp-section">Historical PBV (approx, BV=' + bv.toLocaleString() + ')</div>';
        h += '<div style="border:1px solid var(--b1);border-radius:6px;overflow:hidden;background:var(--bg2)">' + BL.container('gs-histpbv-chart', 170) + '</div>';
        window._gsHistPBVData = {pbvHist:pbvHist,pbvMean:pbvMean,pbvStd:pbvStd};
      }
    }

    // ─── ⑤ PRICE PERFORMANCE ───
    if (hasIdx) {
      h += '<div class="tp-section">Price Performance</div>';
      h += '<div class="tp-grid">';
      [['mtd', 'MTD'], ['ytd', 'YTD'], ['chg_4w', '4W'], ['chg_13w', '13W'], ['chg_26w', '26W'], ['chg_52w', '52W']].forEach(function(p) {
        var v = fund[p[0]] || 0; var cls = v > 0 ? 'up' : v < 0 ? 'dn' : '';
        h += '<div class="tp-stat"><div class="sv ' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</div><div class="sl">' + p[1] + '</div></div>';
      });
      h += '</div>';
    }

    // ─── ⑥ FINANCIAL REPORTS — PDF links from BEI ───
    if (d.financial_reports_list && d.financial_reports_list.length) {
      h += '<div class="tp-section">Financial Reports (BEI)</div>';
      h += '<div style="display:flex;gap:4px;flex-wrap:wrap">';
      d.financial_reports_list.forEach(function(fr) {
        var label = (fr.period || '') + ' ' + (fr.year || '');
        var attachments = [];
        try { attachments = JSON.parse(fr.attachments || '[]'); } catch {}
        if (attachments.length) {
          attachments.forEach(function(att) {
            var url = att.url || '';
            if (url && !url.startsWith('http')) url = 'https://www.idx.co.id' + url;
            h += '<a href="' + esc(url) + '" target="_blank" rel="noopener" style="font-size:var(--font-sm);padding:4px 10px;border-radius:4px;background:var(--bgH);border:1px solid var(--b1);color:var(--bl);text-decoration:none;display:inline-flex;align-items:center;gap:4px;transition:all .1s" onmouseover="this.style.borderColor=\'var(--bl)\'" onmouseout="this.style.borderColor=\'var(--b1)\'">';
            h += '📄 ' + esc(label.trim()) + '</a>';
          });
        } else {
          h += '<span style="font-size:var(--font-sm);padding:4px 10px;border-radius:4px;background:var(--bgH);border:1px solid var(--b1);color:var(--t3)">📄 ' + esc(label.trim()) + '</span>';
        }
      });
      h += '</div>';
    }

    // ─── ⑦ DIVIDEND HISTORY ───
    if (d.dividends && d.dividends.length) {
      h += '<div class="tp-section">Dividend History';
      if (d.dividend_yield) h += ' <span style="font-size:10px;color:var(--gn);font-weight:600">(Yield: ' + d.dividend_yield.toFixed(2) + '%)</span>';
      h += '</div>';
      h += '<div style="overflow-x:auto"><table class="tp-holders" style="font-size:10px"><thead><tr>';
      h += '<th>Ex-Date</th><th class="ar">Cash Div</th><th>Cum Date</th><th>Record</th><th>Payment</th>';
      h += '</tr></thead><tbody>';
      d.dividends.forEach(function(dv) {
        h += '<tr><td style="font-weight:600;color:var(--bl)">' + esc(dv.ex_date || '') + '</td>';
        h += '<td class="ar" style="font-weight:700;color:var(--gn)">Rp ' + (dv.cash_dividend || 0).toLocaleString() + '</td>';
        h += '<td>' + esc(dv.cum_date || '') + '</td>';
        h += '<td>' + esc(dv.record_date || '') + '</td>';
        h += '<td>' + esc(dv.payment_date || '') + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }

    // ─── ⑧ CLASSIFICATION & PROFILE ───
    if (hasIdx && (fund.sector || fund.idx_index)) {
      h += '<div class="tp-section">Classification</div>';
      h += '<div style="font-size:11px;line-height:1.8">';
      if (fund.sector) h += '<div><span style="color:var(--t3);min-width:80px;display:inline-block">Sector</span> <b>' + esc(fund.sector) + '</b></div>';
      if (fund.subsector) h += '<div><span style="color:var(--t3);min-width:80px;display:inline-block">Subsector</span> ' + esc(fund.subsector) + '</div>';
      if (fund.industry) h += '<div><span style="color:var(--t3);min-width:80px;display:inline-block">Industry</span> ' + esc(fund.industry) + '</div>';
      if (fund.subindustry) h += '<div><span style="color:var(--t3);min-width:80px;display:inline-block">Sub-industry</span> ' + esc(fund.subindustry) + '</div>';
      h += '</div>';
      if (fund.idx_index) {
        h += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">';
        fund.idx_index.split(',').forEach(function(idx) { idx = idx.trim(); if (idx) h += '<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:var(--amB);color:var(--am)">' + esc(idx) + '</span>'; });
        h += '</div>';
      }
    }
    if (d.profile || d.detail) {
      var prof = d.detail || d.profile || {};
      var items = [];
      if (prof.board) items.push(['Board', prof.board]);
      if (prof.listing_date && prof.listing_date > '1990-01-01') items.push(['Listed', prof.listing_date]);
      if (prof.website) items.push(['Web', prof.website]);
      if (items.length) {
        h += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px;font-size:var(--font-sm);color:var(--t2)">';
        items.forEach(function(it) { h += '<span>' + it[0] + ': <b style="color:var(--t1)">' + esc(it[1]) + '</b></span>'; });
        h += '</div>';
      }
    }

    // ─── ⑨ SHARE ISSUANCE HISTORY ───
    if (d.issued_history && d.issued_history.length) {
      var validIssued = d.issued_history.filter(function(is) { return is.issue_date && is.issue_date > '1990-01-01' && (is.shares || is.total_shares); });
      if (validIssued.length) {
      h += '<div class="tp-section">Share Issuance History</div>';
      h += '<div style="overflow-x:auto;max-height:160px;overflow-y:auto"><table class="tp-holders" style="font-size:10px"><thead><tr>';
      h += '<th>Date</th><th>Type</th><th class="ar">Shares</th><th class="ar">Total After</th>';
      h += '</tr></thead><tbody>';
      validIssued.forEach(function(is) {
        h += '<tr><td style="font-family:var(--fm)">' + esc(is.issue_date || '') + '</td>';
        h += '<td style="font-size:9px">' + esc(is.type || '') + '</td>';
        h += '<td class="ar" style="font-family:var(--fm)">' + fmtNum(is.shares || 0) + '</td>';
        h += '<td class="ar" style="font-family:var(--fm)">' + fmtNum(is.total_shares || 0) + '</td></tr>';
      });
      h += '</tbody></table></div>';
      }
    }

    // ─── ⑩ ANNOUNCEMENTS LINK ───
    if (d.announcements_count) {
      h += '<div style="margin-top:10px;padding:8px 10px;border-radius:4px;background:var(--bgH);border:1px solid var(--b1);display:flex;align-items:center;gap:8px;cursor:pointer" onclick="gsClose();stab(\'mkt\');setTimeout(function(){smkt(\'ann\',document.querySelector(\'.wt-b[onclick*=ann]\'));$(\'ann-q\').value=\'' + esc(d.code) + '\';loadAnnouncements()},200)">';
      h += '<span style="font-size:14px">📋</span>';
      h += '<div><div style="font-size:var(--font-md);font-weight:600">' + d.announcements_count + ' BEI Announcements</div>';
      h += '<div style="font-size:var(--font-xs);color:var(--t3)">Click to view all announcements for ' + esc(d.code) + '</div></div>';
      h += '<span style="margin-left:auto;color:var(--bl);font-size:var(--font-sm)">View →</span></div>';
    }

    // Source footnote
    h += '<div style="margin-top:8px;font-size:8px;color:var(--t3)">Data: BEI Screener ' + esc((fund.snapshot_month || '')) + (d.industry_ts ? ' · Industry Trading IDX API' : '') + '</div>';
    } // end has data

  } else if (tpTab === 'news') {
    // ═══ NEWS TAB — BEI Announcements for this ticker ═══
    h += '<div id="tp-news-content"><div style="color:var(--t3);text-align:center;padding:12px">Loading announcements...</div></div>';
    setTimeout(function() { loadTickerNews(d.code); }, 50);
  }

  h += '</div>';
  pg.innerHTML = h;
  window._tpData = d;
  // Deferred ECharts renders
  setTimeout(function() { gsRenderCharts(); }, 80);
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

// ═══ SVG Price Chart Renderer → ECharts ═══
function tpDrawPriceChart(data, cas) {
  // Store data for deferred render
  window._gsPriceData = {data:data, cas:cas};
  return '<div style="border-radius:8px;overflow:hidden;margin-bottom:8px;border:1px solid var(--b1);background:var(--bg2)">' + BL.container('gs-price-chart', 260) + '</div>';
}

// ═══ Bid vs Offer Volume Chart — ECharts stacked bars ═══
function tpDrawBidOfferChart(data) {
  var h = '<div class="tp-section">Volume (Bid vs Offer)</div>';
  window._gsVolumeData = data;
  h += '<div style="border-radius:8px;overflow:hidden;margin-bottom:4px">' + BL.container('gs-volume-chart', 150) + '</div>';
  return h;
}

// Close on Escape or click overlay background
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && $('ticker-ov').classList.contains('v')) gsClose();
});
$('ticker-ov').addEventListener('click', function(e) {
  if (e.target === this) gsClose();
});

// ═══ LEGACY: Quarterly tab removed — fundamental tab now uses IDX API data ═══

// ═══ Ticker News Tab — BEI Announcements ═══
async function loadTickerNews(code) {
  var el = $('tp-news-content'); if (!el) return;
  try {
    var r = await fetch('/api/announcements?code=' + encodeURIComponent(code) + '&limit=50');
    var d = await r.json();
    if (!d.data || !d.data.length) {
      el.innerHTML = '<div style="color:var(--t3);text-align:center;padding:20px">No BEI announcements for ' + esc(code) + '</div>';
      return;
    }
    var h = '<div style="font-size:var(--font-xs);color:var(--t3);margin-bottom:6px">' + d.total + ' announcements for ' + esc(code) + '</div>';
    d.data.forEach(function(a, i) {
      var hasAttach = false;
      var attachments = [];
      try { attachments = JSON.parse(a.attachments || '[]'); hasAttach = attachments.length > 0; } catch {}
      var typeColor = a.type === 'STOCK' ? 'var(--gn)' : a.type === 'BOND' ? 'var(--bl)' : 'var(--t3)';

      h += '<div style="padding:8px 0;border-bottom:1px solid var(--b1)">';
      h += '<div style="display:flex;align-items:flex-start;gap:8px">';
      h += '<div style="flex:1;min-width:0">';
      h += '<div style="font-size:var(--font-md);font-weight:600;line-height:1.4">' + esc(a.title || '') + '</div>';
      h += '<div style="font-size:var(--font-xs);color:var(--t3);margin-top:2px">';
      h += '<span style="color:' + typeColor + '">' + esc(a.type || '') + '</span> · ' + esc(a.ann_date || '');
      if (a.subject) h += ' · ' + esc(a.subject);
      h += '</div></div>';
      h += '</div>';

      // Inline attachment links
      if (hasAttach) {
        h += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">';
        attachments.forEach(function(att) {
          var url = att.url || '';
          if (url && !url.startsWith('http')) url = 'https://www.idx.co.id' + url;
          var name = att.originalName || att.filename || 'Document';
          if (name.length > 40) name = name.substring(0, 37) + '...';
          h += '<a href="' + esc(url) + '" target="_blank" rel="noopener" style="font-size:var(--font-xs);padding:2px 6px;border-radius:3px;background:var(--bgH);border:1px solid var(--b1);color:var(--bl);text-decoration:none;display:inline-flex;align-items:center;gap:3px">';
          h += '📄 ' + esc(name) + '</a>';
        });
        h += '</div>';
      }
      h += '</div>';
    });
    el.innerHTML = h;
  } catch (e) {
    el.innerHTML = '<div class="ne">Error: ' + e.message + '</div>';
  }
}
// ═══ DEFERRED ECHARTS RENDERS — Ticker Page Charts ═══
function gsRenderCharts() {
  // ② Bullet chart
  if (window._gsBulletData) {
    var bd = window._gsBulletData;
    var el = document.getElementById('gs-bullet-chart'); if (el) {
      var c = BL.init(el, 'gs-bullet'); if (c) {
        var cats = bd.metrics.map(function(m){ return m.label; }).reverse();
        var stockVals = bd.metrics.map(function(m){ return m.val; }).reverse();
        var medians = bd.metrics.map(function(m){ return bd.sp[m.k].median; }).reverse();
        var p25s = bd.metrics.map(function(m){ return bd.sp[m.k].p25; }).reverse();
        var p75s = bd.metrics.map(function(m){ return bd.sp[m.k].p75; }).reverse();
        var indMed = bd.ip ? bd.metrics.map(function(m){ return bd.ip[m.k] ? bd.ip[m.k].median : null; }).reverse() : null;
        var dotColors = bd.metrics.map(function(m){
          if (m.k === 'roe' || m.k === 'npm') return m.val > bd.sp[m.k].median ? BL.colors.green : BL.colors.red;
          if (m.k === 'per' || m.k === 'pbv' || m.k === 'der') return m.val < bd.sp[m.k].median ? BL.colors.green : m.val > bd.sp[m.k].p75 ? BL.colors.red : BL.colors.amber;
          return BL.colors.blue;
        }).reverse();
        var series = [
          {name:'P25-P75',type:'bar',data:p75s.map(function(v,i){return v-p25s[i];}),stack:'range',barWidth:10,itemStyle:{color:BL.colors.blueBg,borderColor:BL.colors.blue,borderWidth:0.5,borderRadius:2},silent:true},
          {name:'_base',type:'bar',data:p25s,stack:'range',barWidth:10,itemStyle:{color:'transparent'},silent:true,tooltip:{show:false}},
          {name:'Sector Med',type:'scatter',data:medians.map(function(v,i){return[v,i];}),symbolSize:2,symbol:'rect',itemStyle:{color:BL.colors.textDim},encode:{x:0,y:1}},
          {name:'Stock',type:'scatter',data:stockVals.map(function(v,i){return{value:[v,i],itemStyle:{color:dotColors[i]}};}),symbolSize:10,encode:{x:0,y:1}}
        ];
        if (indMed) {
          series.push({name:'Ind Med',type:'scatter',data:indMed.map(function(v,i){return v!=null?[v,i]:null;}).filter(function(v){return v;}),symbolSize:6,symbol:'diamond',itemStyle:{color:BL.colors.amber},encode:{x:0,y:1}});
        }
        c.setOption({
          tooltip:{trigger:'item',formatter:function(p){if(!p.seriesName||p.seriesName.charAt(0)==='_')return'';return p.seriesName+': '+p.value[0];}},
          grid:{left:50,right:55,top:4,bottom:4,containLabel:false},
          xAxis:{type:'value',axisLabel:{fontSize:8},splitLine:{lineStyle:{color:'#1e2836'}}},
          yAxis:{type:'category',data:cats,axisLabel:{fontSize:10,fontWeight:600}},
          series:series
        });
      }
    }
    window._gsBulletData = null;
  }
  // ③ Band chart
  if (window._gsBandData) {
    var bd2 = window._gsBandData;
    var el2 = document.getElementById('gs-band-chart'); if (el2) {
      var c2 = BL.init(el2, 'gs-band'); if (c2) {
        var dates = bd2.its.map(function(r){return r.trade_date;});
        var vals2 = bd2.its.map(function(r){return r[bd2.bm]||null;});
        var markLines = [{yAxis:bd2.mean,name:'μ '+bd2.mean.toFixed(1),lineStyle:{color:'#6b7a8d',type:'dashed',width:1}},
          {yAxis:bd2.mean+bd2.stddev,name:'+1σ',lineStyle:{color:'#3a4a5a',type:'dotted'}},
          {yAxis:bd2.mean-bd2.stddev,name:'-1σ',lineStyle:{color:'#3a4a5a',type:'dotted'}}];
        var markAreas = [[{yAxis:bd2.mean-bd2.stddev},{yAxis:bd2.mean+bd2.stddev}]];
        var opt = {
          tooltip:{trigger:'axis',formatter:function(p){return'<b>'+p[0].axisValue+'</b><br>'+bd2.bm.toUpperCase()+': <b>'+((p[0].value||0).toFixed(2))+'</b>';}},
          grid:BL.grid({top:12,bottom:36,left:40,right:50}),
          dataZoom:BL.dataZoom(),
          xAxis:{type:'category',data:dates,axisLabel:{fontSize:7,formatter:function(v){return v.substring(5);}}},
          yAxis:{type:'value',scale:true,axisLabel:{fontSize:8,formatter:function(v){return v.toFixed(1);}}},
          series:[{type:'line',data:vals2,symbol:'none',lineStyle:{width:1.5,color:BL.colors.blue,opacity:0.7},
            markLine:{silent:true,symbol:'none',label:{fontSize:7,color:'#6b7a8d',formatter:function(p){return p.name;}},data:markLines},
            markArea:{silent:true,itemStyle:{color:'rgba(84,112,198,0.06)'},data:markAreas}}]
        };
        if (bd2.stockVal > 0) {
          opt.series[0].markLine.data.push({yAxis:bd2.stockVal,name:bd2.stockVal.toFixed(2),lineStyle:{color:BL.colors.green,type:'dashed',width:1},label:{color:BL.colors.green,fontWeight:700}});
        }
        c2.setOption(opt);
      }
    }
    window._gsBandData = null;
  }
  // ④ Historical PBV
  if (window._gsHistPBVData) {
    var bd3 = window._gsHistPBVData;
    var el3 = document.getElementById('gs-histpbv-chart'); if (el3) {
      var c3 = BL.init(el3, 'gs-histpbv'); if (c3) {
        var dates3 = bd3.pbvHist.map(function(r){return r.date;});
        var vals3 = bd3.pbvHist.map(function(r){return r.pbv;});
        c3.setOption({
          tooltip:{trigger:'axis',formatter:function(p){return'<b>'+p[0].axisValue+'</b><br>PBV: <b>'+p[0].value.toFixed(2)+'</b>';}},
          grid:BL.grid({top:10,bottom:36,left:40,right:50}),
          dataZoom:BL.dataZoom(),
          xAxis:{type:'category',data:dates3,axisLabel:{fontSize:7,formatter:function(v){return v.substring(5);}}},
          yAxis:{type:'value',scale:true,axisLabel:{fontSize:8,formatter:function(v){return v.toFixed(1);}}},
          series:[{type:'line',data:vals3,symbol:'none',lineStyle:{width:1.5,color:BL.colors.amber},
            markLine:{silent:true,symbol:'none',label:{fontSize:7,color:'#6b7a8d'},data:[
              {yAxis:bd3.pbvMean,name:'μ '+bd3.pbvMean.toFixed(2),lineStyle:{color:'#6b7a8d',type:'dashed',width:1}}
            ]},
            markArea:{silent:true,itemStyle:{color:'rgba(245,158,11,0.06)'},data:[[{yAxis:bd3.pbvMean-bd3.pbvStd},{yAxis:bd3.pbvMean+bd3.pbvStd}]]}}]
        });
      }
    }
    window._gsHistPBVData = null;
  }
  // ⑤ Price Chart
  if (window._gsPriceData) {
    var pd = window._gsPriceData;
    var el5 = document.getElementById('gs-price-chart'); if (el5) {
      var c5 = BL.init(el5, 'gs-price'); if (c5) {
        var data5 = pd.data, cas5 = pd.cas;
        var hasAdj = data5.some(function(r){return r.adjusted;});
        var dates5 = data5.map(function(r){return r.trade_date;});
        var closes5 = data5.map(function(r){return r.adj_close;});
        var rawCloses5 = data5.map(function(r){return r.close;});
        var seriesArr = [];
        if (hasAdj) {
          seriesArr.push({name:'Raw',type:'line',data:rawCloses5,symbol:'none',lineStyle:{width:1,color:BL.colors.textDim,type:'dashed',opacity:0.5},itemStyle:{color:BL.colors.textDim}});
        }
        seriesArr.push({name:hasAdj?'Adjusted':'Close',type:'line',data:closes5,symbol:'none',lineStyle:{width:2,color:BL.colors.amber},
          areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'rgba(245,158,11,0.10)'},{offset:1,color:'transparent'}]}},
          itemStyle:{color:BL.colors.amber},
          markPoint:{symbol:'circle',symbolSize:6,data:[{coord:[dates5[dates5.length-1],closes5[closes5.length-1]],itemStyle:{color:BL.colors.amber}}]}
        });
        // CA markers as markLine
        if (cas5 && cas5.length) {
          var caLines = cas5.map(function(ca){
            var typeLbl = {split:'S',reverse:'R',rights_or_bonus:'RB',manual:'M'}[ca.action_type]||'?';
            return {xAxis:ca.ex_date,label:{formatter:'⚡'+typeLbl+' '+ca.ratio.toFixed(1)+'x',fontSize:8,color:BL.colors.amber,fontWeight:700,position:'start'},lineStyle:{color:BL.colors.amber,type:'dashed',width:1}};
          });
          seriesArr[seriesArr.length-1].markLine = {silent:true,symbol:'none',data:caLines};
        }
        c5.setOption({
          tooltip:{trigger:'axis',formatter:function(p){var h='<b>'+p[0].axisValue+'</b>';p.forEach(function(s){h+='<br><span style="color:'+s.color+'">●</span> '+s.seriesName+': <b>'+Math.round(s.value).toLocaleString()+'</b>';});return h;}},
          legend:hasAdj?{data:['Adjusted','Raw'],top:0,left:0,textStyle:{fontSize:8}}:undefined,
          grid:BL.grid({top:hasAdj?22:12,bottom:36,left:50,right:55}),
          dataZoom:BL.dataZoom(),
          xAxis:{type:'category',data:dates5,axisLabel:{fontSize:7,formatter:function(v){return v.substring(5);}}},
          yAxis:{type:'value',scale:true,axisLabel:{fontSize:8,formatter:function(v){return Math.round(v).toLocaleString();}}},
          series:seriesArr
        });
      }
    }
    window._gsPriceData = null;
  }
  // ⑥ Volume (Bid vs Offer)
  if (window._gsVolumeData) {
    var vd = window._gsVolumeData;
    var el6 = document.getElementById('gs-volume-chart'); if (el6) {
      var c6 = BL.init(el6, 'gs-volume'); if (c6) {
        var dates6 = vd.map(function(r){return r.trade_date;});
        var bids = vd.map(function(r){return r.bid_vol||0;});
        var offers = vd.map(function(r){return r.offer_vol||0;});
        c6.setOption({
          tooltip:{trigger:'axis',formatter:function(p){var h='<b>'+p[0].axisValue+'</b>';p.forEach(function(s){h+='<br><span style="color:'+s.color+'">●</span> '+s.seriesName+': <b>'+BL.fmtRp(s.value)+'</b>';});return h;}},
          legend:{data:['Bid','Offer'],top:0,right:10,textStyle:{fontSize:8}},
          grid:{left:10,right:50,top:18,bottom:22,containLabel:false},
          xAxis:{type:'category',data:dates6,axisLabel:{fontSize:7,formatter:function(v){return v.substring(5).replace('-','/');}}},
          yAxis:{type:'value',axisLabel:{fontSize:7,formatter:function(v){return BL.fmtRp(v);}},splitLine:{lineStyle:{color:'#1e2836'}}},
          series:[
            {name:'Bid',type:'bar',stack:'vol',data:bids,itemStyle:{color:BL.colors.green,opacity:0.75},barMaxWidth:12},
            {name:'Offer',type:'bar',stack:'vol',data:offers,itemStyle:{color:BL.colors.red,opacity:0.75},barMaxWidth:12}
          ]
        });
      }
    }
    window._gsVolumeData = null;
  }
}
