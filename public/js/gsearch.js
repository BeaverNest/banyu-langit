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
      h += '<div style="color:var(--t3);padding:30px;text-align:center">No fundamental data for ' + esc(code) + '<br><span style="font-size:10px">Sync via Settings → Sync Center (Full Sync)</span></div>';
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

    // ─── ② SECTOR COMPARISON — Bullet Chart ───
    if (d.sector_peers && hasIdx) {
      var sp = d.sector_peers;
      var ip = d.industry_peers;
      h += '<div class="tp-section">vs ' + esc(sp.sector) + ' Sector (' + sp.count + ' stocks)';
      if (ip) h += ' · ' + esc(ip.industry) + ' (' + ip.count + ')';
      h += '</div>';
      var W = 780, rowH = 28, padL = 50, padR = 60;
      var metrics = [
        {k:'per', label:'PER', val: fund.per, fmt:function(v){return v.toFixed(1);}},
        {k:'pbv', label:'PBV', val: fund.pbv, fmt:function(v){return v.toFixed(2);}},
        {k:'roe', label:'ROE', val: fund.roe, fmt:function(v){return v.toFixed(1)+'%';}},
        {k:'der', label:'DER', val: fund.der, fmt:function(v){return v.toFixed(2);}},
        {k:'npm', label:'NPM', val: fund.npm, fmt:function(v){return v.toFixed(1)+'%';}}
      ].filter(function(m){return m.val && sp[m.k];});
      var svgH = metrics.length * rowH + 8;
      var svg = '<svg width="100%" viewBox="0 0 ' + W + ' ' + svgH + '" style="display:block">';
      metrics.forEach(function(m, i) {
        var y = i * rowH + 14;
        var s = sp[m.k];
        var rangeMin = Math.min(s.p25, m.val) * 0.8;
        var rangeMax = Math.max(s.p75, m.val) * 1.2;
        if (rangeMax <= rangeMin) rangeMax = rangeMin + 1;
        var barW = W - padL - padR;
        function xPos(v) { return padL + Math.max(0, Math.min(barW, (v - rangeMin) / (rangeMax - rangeMin) * barW)); }
        // Label
        svg += '<text x="' + (padL - 6) + '" y="' + (y + 4) + '" fill="var(--t2)" font-size="10" font-family="var(--fm)" text-anchor="end" font-weight="600">' + m.label + '</text>';
        // Background bar (full range)
        svg += '<rect x="' + padL + '" y="' + (y - 5) + '" width="' + barW + '" height="10" fill="var(--b1)" rx="2"/>';
        // P25-P75 range (sector)
        var x25 = xPos(s.p25), x75 = xPos(s.p75);
        svg += '<rect x="' + x25 + '" y="' + (y - 5) + '" width="' + Math.max(2, x75 - x25) + '" height="10" fill="var(--blB)" rx="2" stroke="var(--bl)" stroke-width="0.5" opacity="0.6"/>';
        // Median line
        svg += '<line x1="' + xPos(s.median) + '" y1="' + (y - 7) + '" x2="' + xPos(s.median) + '" y2="' + (y + 7) + '" stroke="var(--t3)" stroke-width="1.5"/>';
        // Industry median (if available)
        if (ip && ip[m.k]) {
          var imx = xPos(ip[m.k].median);
          svg += '<line x1="' + imx + '" y1="' + (y - 6) + '" x2="' + imx + '" y2="' + (y + 6) + '" stroke="var(--am)" stroke-width="1.5" stroke-dasharray="2,1"/>';
        }
        // Stock position dot
        var sx = xPos(m.val);
        var dotColor = 'var(--bl)';
        if (m.k === 'roe' || m.k === 'npm') dotColor = m.val > s.median ? 'var(--gn)' : 'var(--rd)';
        else if (m.k === 'per' || m.k === 'pbv' || m.k === 'der') dotColor = m.val < s.median ? 'var(--gn)' : m.val > s.p75 ? 'var(--rd)' : 'var(--am)';
        svg += '<circle cx="' + sx + '" cy="' + y + '" r="5" fill="' + dotColor + '" stroke="var(--bg0)" stroke-width="1.5"/>';
        // Value label
        svg += '<text x="' + (W - padR + 6) + '" y="' + (y + 4) + '" fill="' + dotColor + '" font-size="10" font-family="var(--fm)" font-weight="700">' + m.fmt(m.val) + '</text>';
      });
      svg += '</svg>';
      h += '<div style="border:1px solid var(--b1);border-radius:6px;overflow:hidden;background:var(--bg2);padding:4px 0">' + svg + '</div>';
      h += '<div style="display:flex;gap:12px;font-size:8px;color:var(--t3);margin-top:3px;padding:0 4px">';
      h += '<span>● Stock</span><span style="color:var(--t3)">│ Sector Median</span>';
      if (ip) h += '<span style="color:var(--am)">╎ Industry Median</span>';
      h += '<span style="color:var(--bl);opacity:.5">█ Sector P25–P75</span>';
      h += '</div>';
    }

    // ─── ③ INDUSTRY PER/PBV BAND — Time Series ───
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
        var dates = its.map(function(r) { return r.trade_date; });
        var W2 = 780, H2 = 160;
        var pad2 = {t: 16, r: 55, b: 22, l: 45};
        var cW2 = W2 - pad2.l - pad2.r, cH2 = H2 - pad2.t - pad2.b;
        var allVals = vals.slice();
        if (stockVal) allVals.push(stockVal);
        var minY = Math.min(mean - 2 * stddev, Math.min.apply(null, allVals)) * 0.95;
        var maxY = Math.max(mean + 2 * stddev, Math.max.apply(null, allVals)) * 1.05;
        var rngY = maxY - minY || 1;
        function bxS(i) { return pad2.l + i / (its.length - 1) * cW2; }
        function byS(v) { return pad2.t + (1 - (v - minY) / rngY) * cH2; }
        var svg2 = '<svg width="100%" viewBox="0 0 ' + W2 + ' ' + H2 + '" style="display:block">';
        // ±1σ band
        var bandTop = byS(mean + stddev), bandBot = byS(mean - stddev);
        svg2 += '<rect x="' + pad2.l + '" y="' + bandTop + '" width="' + cW2 + '" height="' + (bandBot - bandTop) + '" fill="var(--bl)" opacity="0.07" rx="2"/>';
        // ±2σ band (lighter)
        var band2Top = byS(mean + 2 * stddev), band2Bot = byS(mean - 2 * stddev);
        svg2 += '<rect x="' + pad2.l + '" y="' + band2Top + '" width="' + cW2 + '" height="' + (band2Bot - band2Top) + '" fill="var(--bl)" opacity="0.03"/>';
        // Mean line
        svg2 += '<line x1="' + pad2.l + '" y1="' + byS(mean) + '" x2="' + (W2 - pad2.r) + '" y2="' + byS(mean) + '" stroke="var(--t3)" stroke-width="1" stroke-dasharray="4,3"/>';
        svg2 += '<text x="' + (W2 - pad2.r + 4) + '" y="' + (byS(mean) + 3) + '" fill="var(--t3)" font-size="8" font-family="var(--fm)">μ ' + mean.toFixed(1) + '</text>';
        // +1σ / -1σ labels
        svg2 += '<text x="' + (W2 - pad2.r + 4) + '" y="' + (bandTop + 3) + '" fill="var(--t3)" font-size="7" font-family="var(--fm)">+1σ</text>';
        svg2 += '<text x="' + (W2 - pad2.r + 4) + '" y="' + (bandBot + 3) + '" fill="var(--t3)" font-size="7" font-family="var(--fm)">-1σ</text>';
        // Industry PER/PBV line
        var pts = [];
        its.forEach(function(r, i) { if (r[bm] > 0) pts.push(bxS(i) + ',' + byS(r[bm])); });
        svg2 += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="var(--bl)" stroke-width="1.5" opacity="0.7"/>';
        // Stock current value — horizontal dashed line + dot
        if (stockVal > 0) {
          var sy = byS(stockVal);
          svg2 += '<line x1="' + pad2.l + '" y1="' + sy + '" x2="' + (W2 - pad2.r) + '" y2="' + sy + '" stroke="var(--gn)" stroke-width="1" stroke-dasharray="3,2"/>';
          svg2 += '<circle cx="' + (W2 - pad2.r - 3) + '" cy="' + sy + '" r="4" fill="var(--gn)" stroke="var(--bg0)" stroke-width="1.5"/>';
          svg2 += '<text x="' + (W2 - pad2.r + 4) + '" y="' + (sy + 3) + '" fill="var(--gn)" font-size="9" font-family="var(--fm)" font-weight="700">' + stockVal.toFixed(bm === 'pbv' ? 2 : 1) + '</text>';
        }
        // X-axis date labels
        var step2 = Math.max(1, Math.floor(its.length / 6));
        for (var di2 = 0; di2 < its.length; di2 += step2) {
          svg2 += '<text x="' + bxS(di2) + '" y="' + (H2 - 4) + '" fill="var(--t3)" font-size="7" font-family="var(--fm)" text-anchor="middle">' + dates[di2].substring(5) + '</text>';
        }
        // Grid lines
        for (var g2 = 0; g2 <= 4; g2++) {
          var gy2 = pad2.t + g2 / 4 * cH2; var gv2 = maxY - g2 / 4 * rngY;
          svg2 += '<line x1="' + pad2.l + '" y1="' + gy2 + '" x2="' + (W2 - pad2.r) + '" y2="' + gy2 + '" stroke="var(--b1)" stroke-width="0.5"/>';
          svg2 += '<text x="' + (pad2.l - 4) + '" y="' + (gy2 + 3) + '" fill="var(--t3)" font-size="7" font-family="var(--fm)" text-anchor="end">' + gv2.toFixed(1) + '</text>';
        }
        svg2 += '</svg>';
        h += '<div style="border:1px solid var(--b1);border-radius:6px;overflow:hidden;background:var(--bg2)">' + svg2 + '</div>';
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

    // ─── ④ HISTORICAL PBV BAND — approx from adj_chart ───
    if (hasIdx && fund.pbv > 0 && d.adj_chart && d.adj_chart.length >= 30) {
      var bv = Math.round(d.price.close / fund.pbv); // approximate book value per share
      if (bv > 0) {
        var pbvHist = d.adj_chart.map(function(r) { return { date: r.trade_date, pbv: r.adj_close / bv }; });
        var pbvVals = pbvHist.map(function(r) { return r.pbv; });
        var pbvMean = pbvVals.reduce(function(a, b) { return a + b; }, 0) / pbvVals.length;
        var pbvVar = pbvVals.reduce(function(a, b) { return a + (b - pbvMean) * (b - pbvMean); }, 0) / pbvVals.length;
        var pbvStd = Math.sqrt(pbvVar);
        h += '<div class="tp-section">Historical PBV (approx, BV=' + bv.toLocaleString() + ')</div>';
        var W3 = 780, H3 = 130;
        var pad3 = {t: 14, r: 50, b: 20, l: 40};
        var cW3 = W3 - pad3.l - pad3.r, cH3 = H3 - pad3.t - pad3.b;
        var minP = Math.max(0, pbvMean - 2.5 * pbvStd);
        var maxP = pbvMean + 2.5 * pbvStd;
        var rngP = maxP - minP || 1;
        function pxS(i) { return pad3.l + i / (pbvHist.length - 1) * cW3; }
        function pyS(v) { return pad3.t + (1 - (v - minP) / rngP) * cH3; }
        var svg3 = '<svg width="100%" viewBox="0 0 ' + W3 + ' ' + H3 + '" style="display:block">';
        // ±1σ band
        var bt3 = pyS(pbvMean + pbvStd), bb3 = pyS(pbvMean - pbvStd);
        svg3 += '<rect x="' + pad3.l + '" y="' + bt3 + '" width="' + cW3 + '" height="' + Math.max(1, bb3 - bt3) + '" fill="var(--am)" opacity="0.08"/>';
        // Mean
        svg3 += '<line x1="' + pad3.l + '" y1="' + pyS(pbvMean) + '" x2="' + (W3 - pad3.r) + '" y2="' + pyS(pbvMean) + '" stroke="var(--t3)" stroke-width="1" stroke-dasharray="3,2"/>';
        svg3 += '<text x="' + (W3 - pad3.r + 4) + '" y="' + (pyS(pbvMean) + 3) + '" fill="var(--t3)" font-size="7" font-family="var(--fm)">μ ' + pbvMean.toFixed(2) + '</text>';
        // PBV line
        var pts3 = pbvHist.map(function(r, i) { return pxS(i) + ',' + pyS(r.pbv); });
        svg3 += '<polyline points="' + pts3.join(' ') + '" fill="none" stroke="var(--am)" stroke-width="1.5"/>';
        // End dot
        svg3 += '<circle cx="' + pxS(pbvHist.length - 1) + '" cy="' + pyS(pbvHist[pbvHist.length - 1].pbv) + '" r="3" fill="var(--am)"/>';
        // Date labels
        var step3 = Math.max(1, Math.floor(pbvHist.length / 6));
        for (var di3 = 0; di3 < pbvHist.length; di3 += step3) {
          svg3 += '<text x="' + pxS(di3) + '" y="' + (H3 - 4) + '" fill="var(--t3)" font-size="7" font-family="var(--fm)" text-anchor="middle">' + pbvHist[di3].date.substring(5) + '</text>';
        }
        // Y grid
        for (var g3 = 0; g3 <= 4; g3++) {
          var gy3 = pad3.t + g3 / 4 * cH3; var gv3 = maxP - g3 / 4 * rngP;
          svg3 += '<line x1="' + pad3.l + '" y1="' + gy3 + '" x2="' + (W3 - pad3.r) + '" y2="' + gy3 + '" stroke="var(--b1)" stroke-width="0.5"/>';
          svg3 += '<text x="' + (pad3.l - 4) + '" y="' + (gy3 + 3) + '" fill="var(--t3)" font-size="7" font-family="var(--fm)" text-anchor="end">' + gv3.toFixed(1) + '</text>';
        }
        svg3 += '</svg>';
        h += '<div style="border:1px solid var(--b1);border-radius:6px;overflow:hidden;background:var(--bg2)">' + svg3 + '</div>';
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

// ═══ Bid vs Offer Volume Chart — stacked bars ═══
function tpDrawBidOfferChart(data) {
  var h = '<div class="tp-section">Volume (Bid vs Offer)</div>';

  var W = 780, H = 120;
  var pad = {t: 10, r: 50, b: 20, l: 10};
  var cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
  var n = data.length;
  var barW = Math.max(2, Math.min(12, cW / n - 1));

  // Find max volume for scaling
  var maxVol = 0;
  data.forEach(function(r) {
    var total = (r.bid_vol || 0) + (r.offer_vol || 0);
    if (total > maxVol) maxVol = total;
  });
  if (!maxVol) maxVol = 1;

  var svg = '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" style="display:block">';

  // Bars
  data.forEach(function(r, i) {
    var x = pad.l + (i + 0.5) * (cW / n) - barW / 2;
    var bid = r.bid_vol || 0;
    var offer = r.offer_vol || 0;
    var total = bid + offer;
    var totalH = Math.max(1, (total / maxVol) * cH);
    var bidH = total > 0 ? (bid / total) * totalH : 0;
    var offerH = totalH - bidH;

    // Offer (red) on top
    var offerY = pad.t + (cH - totalH);
    svg += '<rect x="' + x + '" y="' + offerY + '" width="' + barW + '" height="' + offerH + '" fill="var(--rd)" opacity="0.7" rx="1"/>';
    // Bid (green) below
    svg += '<rect x="' + x + '" y="' + (offerY + offerH) + '" width="' + barW + '" height="' + bidH + '" fill="var(--gn)" opacity="0.7" rx="1"/>';
  });

  // X-axis labels (every ~10 bars)
  var step = Math.max(1, Math.floor(n / 8));
  for (var i = 0; i < n; i += step) {
    var x = pad.l + (i + 0.5) * (cW / n);
    var lbl = data[i].trade_date.substring(5).replace('-', '/');
    svg += '<text x="' + x + '" y="' + (H - 3) + '" fill="var(--t3)" font-size="7" font-family="var(--fm)" text-anchor="middle">' + lbl + '</text>';
  }

  // Right-side max label
  svg += '<text x="' + (W - pad.r + 4) + '" y="' + (pad.t + 8) + '" fill="var(--t3)" font-size="7" font-family="var(--fm)" text-anchor="start">' + fmtNum(maxVol) + '</text>';

  // Legend
  svg += '<rect x="' + (W - pad.r + 4) + '" y="' + (H - pad.b - 18) + '" width="8" height="8" fill="var(--gn)" opacity="0.7" rx="1"/>';
  svg += '<text x="' + (W - pad.r + 15) + '" y="' + (H - pad.b - 11) + '" fill="var(--t3)" font-size="7" font-family="var(--fm)">Bid</text>';
  svg += '<rect x="' + (W - pad.r + 4) + '" y="' + (H - pad.b - 8) + '" width="8" height="8" fill="var(--rd)" opacity="0.7" rx="1"/>';
  svg += '<text x="' + (W - pad.r + 15) + '" y="' + (H - pad.b - 1) + '" fill="var(--t3)" font-size="7" font-family="var(--fm)">Offer</text>';

  svg += '</svg>';
  h += '<div style="border-radius:8px;overflow:hidden;margin-bottom:4px">' + svg + '</div>';
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