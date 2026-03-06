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

  var h = '<div class="tp-header">';
  // Top row: close, code, name, actions
  h += '<div class="tp-top">';
  h += '<button class="tp-close" onclick="gsClose()">✕</button>';
  h += '<span class="tp-code">' + esc(code) + '</span>';
  h += '<span class="tp-name">' + esc(name) + '</span>';
  h += '<div class="tp-actions">';
  h += '<button onclick="addWatchlistFrom(\'' + esc(code) + '\');showT(\'Watchlist\',\'' + esc(code) + '.JK added\')">+ Watchlist</button>';
  h += '<button onclick="gsClose();stab(\'ins\',document.querySelectorAll(\'.tabs .tab\')[3]);setTimeout(function(){insGoStock(\'' + esc(code) + '\')},200)">🔍 Insider</button>';
  h += '<button onclick="gsClose();stab(\'wl\',document.querySelectorAll(\'.tabs .tab\')[1]);setTimeout(function(){swt(\'alt\',document.querySelectorAll(\'.wt-b\')[1]);$(\'as\').value=\'' + esc(code) + '.JK\';},200)">🔔 Alert</button>';
  h += '</div></div>';
  // Sector & index badges
  var fund = d.fundamental || {};
  if (fund.sector || fund.idx_index) {
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
  ['overview', 'foreign', 'insider', 'fundamental'].forEach(function(t) {
    var lbl = t === 'overview' ? '📊 Overview' : t === 'foreign' ? '🌍 Foreign' : t === 'insider' ? '👥 Insider' : '📈 Fundamental';
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
    // Mini foreign flow chart (last 20 days)
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
      // Accumulation
      var lastAcc = d.flow[d.flow.length - 1]?.acc || 0;
      var accCls = lastAcc > 0 ? 'up' : lastAcc < 0 ? 'dn' : '';
      h += '<div style="margin-top:4px;font-size:11px;color:var(--t2)">Accumulation: <b class="' + accCls + '">' + fmtRp(lastAcc) + '</b></div>';
    }
    // Insider summary
    if (d.insider) {
      h += '<div class="tp-section">Top Holders (insider ' + d.insider.totalPct + '% · FF ' + d.insider.freeFloat + '%)</div>';
      d.insider.holders.slice(0, 5).forEach(function(ho) {
        h += '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px">';
        h += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(ho.investor) + '</span>';
        var typeClr = ho.type === 'Corporate' ? 'var(--bl)' : ho.type === 'Individual' ? 'var(--am)' : 'var(--t3)';
        if (ho.type) h += '<span style="font-size:9px;color:' + typeClr + '">' + esc(ho.type) + '</span>';
        var lfClr = ho.lf === 'A' || ho.lf === 'F' ? 'var(--rd)' : 'var(--gn)';
        if (ho.lf) h += '<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:' + (ho.lf === 'A' || ho.lf === 'F' ? 'var(--rdB)' : 'var(--gnB)') + ';color:' + lfClr + '">' + (ho.lf === 'A' || ho.lf === 'F' ? 'Foreign' : 'Local') + '</span>';
        h += '<span style="font-family:var(--fm);font-weight:700;min-width:50px;text-align:right">' + ho.pct.toFixed(2) + '%</span>';
        h += '</div>';
      });
    }

  } else if (tpTab === 'foreign') {
    // Full foreign flow table
    if (d.flow && d.flow.length) {
      var maxAbs = Math.max.apply(null, d.flow.map(function(r) { return Math.abs(r.foreign_net_val || 0); }));
      h += '<table class="tp-holders"><thead><tr><th>Date</th><th class="ar">Close</th><th>Flow</th><th class="ar">F.Net (IDR)</th><th class="ar">Accum</th></tr></thead><tbody>';
      for (var i = d.flow.length - 1; i >= 0; i--) {
        var r = d.flow[i]; var fnv = r.foreign_net_val || 0; var cls = fnv > 0 ? 'up' : fnv < 0 ? 'dn' : '';
        var accCls = r.acc > 0 ? 'up' : r.acc < 0 ? 'dn' : '';
        var pct = maxAbs ? Math.min(90, Math.abs(fnv) / maxAbs * 90) : 0;
        h += '<tr><td style="font-size:10px">' + r.trade_date + '</td><td class="ar">' + (r.close || 0).toLocaleString() + '</td>';
        h += '<td style="min-width:100px;padding:4px 2px"><div class="tp-flow-bar"><div class="bar-neg">';
        if (fnv < 0) h += '<div style="width:' + pct + '%;background:var(--rd);border-radius:2px;opacity:.8"></div>';
        h += '</div><div class="bar-mid"></div><div class="bar-pos">';
        if (fnv > 0) h += '<div style="width:' + pct + '%;background:var(--gn);border-radius:2px;opacity:.8"></div>';
        h += '</div></div></td>';
        h += '<td class="ar ' + cls + '" style="font-weight:600">' + fmtRp(fnv) + '</td>';
        h += '<td class="ar ' + accCls + '">' + fmtRp(r.acc) + '</td></tr>';
      }
      h += '</tbody></table>';
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
  }

  h += '</div>';
  pg.innerHTML = h;
  window._tpData = d;
}

// Close on Escape or click overlay background
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && $('ticker-ov').classList.contains('v')) gsClose();
});
$('ticker-ov').addEventListener('click', function(e) {
  if (e.target === this) gsClose();
});
