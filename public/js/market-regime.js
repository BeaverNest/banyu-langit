// ═══ MARKET REGIME — Top-Down Framework ═══
// Level 1: Global Sentiment (custom tickers: global_index)
// Level 2: Commodity Cycle (custom tickers: commodity → linked_sector)
// Level 3: IDX Market (IHSG trend, breadth, foreign flow)
// Level 4: Sector Ranking (relative strength, foreign flow)
// Level 5: Decision Matrix (aggregate verdict)

var mrData = null;
var mrLoading = false;

function loadMarketRegime() {
  var el = $('mr-content'); if (!el) return;
  if (mrData) { renderMR(el); return; }
  el.innerHTML = '<div class="ne" style="padding:40px">Loading Market Regime...</div>';
  mrFetch(el);
}

async function mrFetch(el) {
  if (mrLoading) return;
  mrLoading = true;
  try {
    var r = await fetch('/api/idx/market-regime');
    mrData = await r.json();
    if (mrData.error) { el.innerHTML = '<div class="ne" style="color:var(--rd)">' + mrData.error + '</div>'; return; }
    renderMR(el);
  } catch (e) { el.innerHTML = '<div class="ne" style="color:var(--rd)">Error: ' + e.message + '</div>'; }
  mrLoading = false;
}

function mrRefresh() {
  mrData = null;
  var el = $('mr-content'); if (!el) return;
  el.innerHTML = '<div class="ne" style="padding:40px">Refreshing...</div>';
  mrFetch(el);
}

function renderMR(el) {
  if (!mrData) return;
  var d = mrData;
  var h = '<div style="padding:12px;font-family:var(--f)">';

  // Header
  h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">';
  h += '<span style="font-weight:700;font-size:14px">🌐 Market Regime</span>';
  h += '<button class="bei-sort-btn" onclick="mrRefresh()" style="font-size:10px;padding:3px 8px">🔄 Refresh</button>';
  if (d.date) h += '<span style="font-size:10px;color:var(--t3)">' + d.date + '</span>';
  h += '</div>';

  // ═══ Level 1: Global Sentiment ═══
  h += mrSection('1', '🌍 Global Sentiment', mrRenderGlobal(d.global));

  // ═══ Level 1.5: Macro Signals ═══
  h += mrSection('1.5', '📊 Macro Signals', mrRenderMacro(d.macro_signals));

  // ═══ Level 2: Commodity Cycle ═══
  h += mrSection('2', '📦 Commodity Cycle', mrRenderCommodity(d.commodities));

  // ═══ Level 3: IDX Market Regime ═══
  h += mrSection('3', '🇮🇩 IDX Market', mrRenderIDX(d.idx));

  // ═══ Level 4: Sector Ranking ═══
  h += mrSection('4', '🏢 Sector Ranking', mrRenderSectors(d.sectors));

  // ═══ Level 5: Decision Matrix ═══
  h += mrSection('5', '🎯 Decision Matrix', mrRenderDecision(d));

  // ═══ Level 6: Hot News ═══
  h += mrSection('6', '📰 Hot News', '<div id="mr-news"><div style="color:var(--t3);font-size:11px">⏳ Loading headlines...</div></div>');

  h += '</div>';
  el.innerHTML = h;

  // Render charts after DOM is ready
  setTimeout(function() { mrDrawCharts(d); }, 100);
  // Fetch news
  setTimeout(function() { mrRenderNews('mr-news'); }, 200);
}

function mrSection(num, title, content) {
  return '<div style="border:1px solid var(--b1);border-radius:6px;margin-bottom:10px;overflow:hidden">' +
    '<div style="padding:8px 12px;background:var(--bg1);border-bottom:1px solid var(--b1);font-size:12px;font-weight:700;color:var(--t1)">' +
    '<span style="color:var(--am);margin-right:6px">L' + num + '</span>' + title + '</div>' +
    '<div style="padding:10px 12px">' + content + '</div></div>';
}

// ═══ Level 1: Global ═══
function mrRenderGlobal(g) {
  if (!g || !g.length) return '<span style="color:var(--t3)">No global data. Add tickers with category=global_index in EOD Fetcher.</span>';
  var h = '<div style="display:flex;gap:8px;flex-wrap:wrap">';
  g.forEach(function(item) {
    var chg = item.chg_pct || 0;
    var cls = chg > 0 ? 'color:var(--gn)' : chg < 0 ? 'color:var(--rd)' : 'color:var(--t2)';
    var trend5 = item.chg_5d || 0;
    var trend20 = item.chg_20d || 0;
    var signal = trend20 > 3 ? '🟢' : trend20 < -3 ? '🔴' : '🟡';
    h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:6px;padding:8px 12px;min-width:140px;flex:1">';
    h += '<div style="font-size:10px;color:var(--t3);margin-bottom:2px">' + signal + ' ' + esc(item.name || item.code) + '</div>';
    h += '<div style="font-size:18px;font-weight:700;font-family:var(--fm);' + cls + '">' + (chg > 0 ? '+' : '') + chg.toFixed(2) + '%</div>';
    h += '<div style="font-size:9px;color:var(--t3)">Price: ' + (item.close || 0).toLocaleString(undefined, {maximumFractionDigits: 2}) + '</div>';
    h += '<div style="font-size:9px;color:var(--t3)">5D: <span style="' + (trend5 > 0 ? 'color:var(--gn)' : trend5 < 0 ? 'color:var(--rd)' : '') + '">' + (trend5 > 0 ? '+' : '') + trend5.toFixed(1) + '%</span>';
    h += ' · 20D: <span style="' + (trend20 > 0 ? 'color:var(--gn)' : trend20 < 0 ? 'color:var(--rd)' : '') + '">' + (trend20 > 0 ? '+' : '') + trend20.toFixed(1) + '%</span></div>';
    h += '</div>';
  });
  h += '</div>';

  // Aggregate signal
  var bullCount = g.filter(function(x) { return (x.chg_20d || 0) > 3; }).length;
  var bearCount = g.filter(function(x) { return (x.chg_20d || 0) < -3; }).length;
  var total = g.length;
  var verdict = bullCount > total / 2 ? '🟢 Risk-On' : bearCount > total / 2 ? '🔴 Risk-Off' : '🟡 Caution';
  h += '<div style="margin-top:8px;padding:6px 10px;background:rgba(84,112,198,0.06);border-radius:4px;font-size:11px"><b>Global:</b> ' + verdict + ' (' + bullCount + ' bullish, ' + bearCount + ' bearish, ' + (total - bullCount - bearCount) + ' neutral)</div>';
  return h;
}

// ═══ Level 1.5: Macro Signals ═══
function mrRenderMacro(ms) {
  if (!ms || !ms.signals || !ms.signals.length) return '<span style="color:var(--t3)">No macro signals. Upload VIX, DXY, US10Y, BDI, USDIDR via Custom Tickers.</span>';
  var sigs = ms.signals;
  var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(200px, 1fr));gap:6px;margin-bottom:8px">';
  sigs.forEach(function(s) {
    var bg = s.bear > 0 ? 'rgba(239,68,68,0.06)' : s.bull > 0 ? 'rgba(34,197,94,0.06)' : 'rgba(148,163,184,0.04)';
    var border = s.bear > 0 ? 'var(--rd)' : s.bull > 0 ? 'var(--gn)' : 'var(--b2)';
    h += '<div style="background:' + bg + ';border:1px solid ' + border + '33;border-radius:6px;padding:8px 10px">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">';
    h += '<span style="font-size:10px;font-weight:700;color:var(--t1)">' + s.emoji + ' ' + esc(s.code) + '</span>';
    h += '<span style="font-size:14px;font-weight:700;font-family:var(--fm);color:var(--t1)">' + (typeof s.value === 'number' ? s.value.toLocaleString(undefined, {maximumFractionDigits: 4}) : '-') + '</span>';
    h += '</div>';
    h += '<div style="font-size:9px;color:var(--t3)">' + esc(s.detail) + '</div>';
    if (s.bull > 0) h += '<div style="font-size:8px;color:var(--gn);margin-top:2px">+' + s.bull + ' bull point' + (s.bull > 1 ? 's' : '') + '</div>';
    if (s.bear > 0) h += '<div style="font-size:8px;color:var(--rd);margin-top:2px">+' + s.bear + ' bear point' + (s.bear > 1 ? 's' : '') + '</div>';
    h += '</div>';
  });
  h += '</div>';

  // Summary bar
  var totalBull = ms.bull_points || 0, totalBear = ms.bear_points || 0;
  var verdict = totalBear > totalBull + 1 ? '🔴 Macro Headwind' : totalBull > totalBear + 1 ? '🟢 Macro Tailwind' : '🟡 Macro Mixed';
  var vColor = totalBear > totalBull + 1 ? 'var(--rd)' : totalBull > totalBear + 1 ? 'var(--gn)' : 'var(--am)';
  h += '<div style="padding:5px 10px;background:rgba(84,112,198,0.06);border-radius:4px;font-size:11px">';
  h += '<b style="color:' + vColor + '">' + verdict + '</b>';
  h += ' <span style="color:var(--t3)">(' + totalBull + ' bull · ' + totalBear + ' bear)</span></div>';
  return h;
}

// ═══ Level 2: Commodity ═══
function mrRenderCommodity(cmds) {
  if (!cmds || !cmds.length) return '<span style="color:var(--t3)">No commodity data. Add tickers with category=commodity in EOD Fetcher.</span>';
  var h = '<table style="width:100%;border-collapse:collapse;font-size:11px">';
  h += '<tr style="border-bottom:1px solid var(--b2)">';
  h += '<th style="text-align:left;padding:4px 8px;color:var(--t3);font-size:9px">Commodity</th>';
  h += '<th style="text-align:right;padding:4px 8px;color:var(--t3);font-size:9px">Price</th>';
  h += '<th style="text-align:right;padding:4px 8px;color:var(--t3);font-size:9px">5D</th>';
  h += '<th style="text-align:right;padding:4px 8px;color:var(--t3);font-size:9px">20D</th>';
  h += '<th style="text-align:left;padding:4px 8px;color:var(--t3);font-size:9px">Trend</th>';
  h += '<th style="text-align:left;padding:4px 8px;color:var(--t3);font-size:9px">Linked Sector</th>';
  h += '</tr>';
  cmds.forEach(function(c) {
    var pts = c.points || 0;
    var thin = pts > 0 && pts < 6;                 // histori belum cukup untuk hitung 5D/20D
    var stale = c.stale === true;                  // bar terakhir tertinggal dari sesi rujukan (t_61ccbdbe)
    var chg5v = thin ? null : (c.chg_5d || 0);
    var chg20v = thin ? null : (c.chg_20d || 0);
    var chg5 = chg5v === null ? 0 : chg5v, chg20 = chg20v === null ? 0 : chg20v;
    var trend = thin ? '⚪ histori ' + pts + ' titik' : (chg20 > 5 ? '🟢 ▲ Up' : chg20 < -5 ? '🔴 ▼ Down' : chg20 > 2 ? '🟡 ↗ Mild Up' : chg20 < -2 ? '🟡 ↘ Mild Down' : '⚪ → Flat');
    // Harga seri basi TIDAK ditulis sebagai level: TIN 15 Okt di bawah sesi 19 Okt akan
    // terbaca "timah tidak bergerak 2 hari", padahal kita tidak punya bar-nya. Levelnya
    // tetap tersedia di title supaya bisa diperiksa.
    var priceCell = stale
      ? '<span style="color:var(--t2)" title="bar terakhir ' + esc(c.date || '') + ' (level ' + (c.close || 0).toLocaleString(undefined, {maximumFractionDigits: 2}) + ') — bukan sesi ' + esc(c.ref_date || '') + '">—</span>'
        + ' <span style="font-size:9px;color:var(--am);white-space:nowrap" title="sumber tidak menerbitkan bar untuk ' + (c.lag_sessions || 0) + ' sesi terakhir; retry tidak menolong">⏸ basi ' + esc(shortDay(c.stale_date || c.date)) + '</span>'
      : (c.close || 0).toLocaleString(undefined, {maximumFractionDigits: 2});
    var dimStale = stale ? 'color:var(--t3);' : '';
    // Baris basi: 5D/20D tetap dihitung dari bar terakhir seri itu, tapi diwarnai netral —
    // warnanya tidak boleh mengklaim pergerakan "sampai hari ini".
    var c5style = stale ? dimStale : (chg5 > 0 ? 'color:var(--gn);' : chg5 < 0 ? 'color:var(--rd);' : '');
    var c20style = stale ? dimStale : (chg20 > 0 ? 'color:var(--gn);' : chg20 < 0 ? 'color:var(--rd);' : '');
    h += '<tr style="border-bottom:1px solid var(--b1)' + (stale ? ';opacity:.85' : '') + '">';
    h += '<td style="padding:4px 8px;font-weight:600;color:var(--bl)">' + esc(c.name || c.code) + '</td>';
    h += '<td style="padding:4px 8px;text-align:right;font-family:var(--fm)">' + priceCell + '</td>';
    h += '<td style="padding:4px 8px;text-align:right;font-family:var(--fm);' + c5style + '">' + (chg5v === null ? '—' : (chg5 > 0 ? '+' : '') + chg5.toFixed(1) + '%') + '</td>';
    h += '<td style="padding:4px 8px;text-align:right;font-family:var(--fm);' + c20style + '">' + (chg20v === null ? '—' : (chg20 > 0 ? '+' : '') + chg20.toFixed(1) + '%') + '</td>';
    h += '<td style="padding:4px 8px;font-size:10px">' + trend + '</td>';
    h += '<td style="padding:4px 8px;font-size:10px;color:var(--t3)">' + esc(c.linked_sector || '-') + '</td>';
    h += '</tr>';
  });
  h += '</table>';
  return h;
}

// ═══ Level 3: IDX ═══
function mrRenderIDX(idx) {
  if (!idx) return '<span style="color:var(--t3)">No IDX data available.</span>';
  var h = '<div style="display:flex;gap:12px;flex-wrap:wrap">';

  // IHSG card
  var ihsg = idx.ihsg || {};
  var regime = ihsg.regime || 'unknown';
  var regimeColor = regime === 'bull' ? 'var(--gn)' : regime === 'bear' ? 'var(--rd)' : regime === 'mild_bull' ? 'var(--gn)' : regime === 'mild_bear' ? 'var(--rd)' : 'var(--t2)';
  var regimeLabel = regime === 'bull' ? '🟢 BULL' : regime === 'bear' ? '🔴 BEAR' : regime === 'mild_bull' ? '🟢 Mild Bull' : regime === 'mild_bear' ? '🔴 Mild Bear' : '🟡 Sideways';
  h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:6px;padding:10px 14px;min-width:180px">';
  h += '<div style="font-size:10px;color:var(--t3)">IHSG Composite</div>';
  h += '<div style="font-size:22px;font-weight:700;font-family:var(--fm)">' + (ihsg.level || 0).toLocaleString() + '</div>';
  h += '<div style="font-size:12px;font-weight:700;color:' + regimeColor + '">' + regimeLabel + '</div>';
  h += '<div style="font-size:9px;color:var(--t3);margin-top:4px">5D: ' + (ihsg.chg_5d > 0 ? '+' : '') + (ihsg.chg_5d || 0).toFixed(1) + '% · 20D: ' + (ihsg.chg_20d > 0 ? '+' : '') + (ihsg.chg_20d || 0).toFixed(1) + '%</div>';
  h += '</div>';

  // Foreign Flow card
  var ff = idx.foreign_flow || {};
  var fnetColor = (ff.net_20d || 0) > 0 ? 'var(--gn)' : 'var(--rd)';
  h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:6px;padding:10px 14px;min-width:180px">';
  h += '<div style="font-size:10px;color:var(--t3)">Foreign Flow (20D)</div>';
  h += '<div style="font-size:18px;font-weight:700;font-family:var(--fm);color:' + fnetColor + '">' + fmtRp(ff.net_20d || 0) + '</div>';
  h += '<div style="font-size:9px;color:var(--t3)">Today: ' + fmtRp(ff.net_today || 0) + '</div>';
  h += '<div style="font-size:9px;color:var(--t3)">5D: ' + fmtRp(ff.net_5d || 0) + '</div>';
  h += '</div>';

  // Breadth card
  var br = idx.breadth || {};
  h += '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:6px;padding:10px 14px;min-width:180px">';
  h += '<div style="font-size:10px;color:var(--t3)">Market Breadth</div>';
  h += '<div style="font-size:10px;margin-top:4px">Above MA20: <b style="color:' + ((br.pct_above_ma20 || 0) > 50 ? 'var(--gn)' : 'var(--rd)') + '">' + (br.pct_above_ma20 || 0).toFixed(0) + '%</b></div>';
  h += '<div style="font-size:10px">Above MA50: <b style="color:' + ((br.pct_above_ma50 || 0) > 50 ? 'var(--gn)' : 'var(--rd)') + '">' + (br.pct_above_ma50 || 0).toFixed(0) + '%</b></div>';
  h += '<div style="font-size:10px">Above MA200: <b style="color:' + ((br.pct_above_ma200 || 0) > 50 ? 'var(--gn)' : 'var(--rd)') + '">' + (br.pct_above_ma200 || 0).toFixed(0) + '%</b></div>';
  h += '<div style="font-size:9px;color:var(--t3);margin-top:2px">New High: ' + (br.new_high || 0) + ' · New Low: ' + (br.new_low || 0) + '</div>';
  h += '</div>';

  // Breadth chart placeholder
  h += '<div id="mr-breadth-chart" style="flex:1;min-width:250px;height:140px;background:var(--bg1);border:1px solid var(--b1);border-radius:6px"></div>';

  h += '</div>';
  return h;
}

// ═══ Level 4: Sectors ═══
function mrRenderSectors(sectors) {
  if (!sectors || !sectors.length) return '<span style="color:var(--t3)">No sector data.</span>';
  var h = '<table style="width:100%;border-collapse:collapse;font-size:11px">';
  h += '<tr style="border-bottom:1px solid var(--b2)">';
  h += '<th style="text-align:left;padding:5px 8px;color:var(--t3);font-size:9px">Sector</th>';
  h += '<th style="text-align:right;padding:5px 8px;color:var(--t3);font-size:9px">1D</th>';
  h += '<th style="text-align:right;padding:5px 8px;color:var(--t3);font-size:9px">20D</th>';
  h += '<th style="text-align:right;padding:5px 8px;color:var(--t3);font-size:9px">RS vs IHSG</th>';
  h += '<th style="text-align:right;padding:5px 8px;color:var(--t3);font-size:9px">F.Net 20D</th>';
  h += '<th style="text-align:left;padding:5px 8px;color:var(--t3);font-size:9px">Signal</th>';
  h += '<th style="text-align:left;padding:5px 8px;color:var(--t3);font-size:9px">Top Stocks</th>';
  h += '</tr>';
  sectors.forEach(function(s) {
    var chg = s.chg_pct || 0;
    var chg20 = s.chg_20d || 0;
    var rs = s.rs_vs_ihsg || 0;
    var fnet = s.fnet_20d || 0;
    var signal = rs > 2 && fnet > 0 ? '🟢 Strong' : rs > 0 && fnet > 0 ? '🟢 Favor' : rs < -2 && fnet < 0 ? '🔴 Avoid' : rs < 0 && fnet < 0 ? '🔴 Weak' : '🟡 Neutral';
    // Clickable sector → navigate to Market Intelligence Stock List
    var sectorClick = s.cp_sector ? ' onclick="mrGoSector(\'' + esc(s.cp_sector) + '\')" style="cursor:pointer;color:var(--bl)"' : '';
    h += '<tr style="border-bottom:1px solid var(--b1)">';
    h += '<td style="padding:5px 8px;font-weight:600"' + sectorClick + '>' + esc(s.sector.replace('IDX Sector ', '')) + '</td>';
    h += '<td style="padding:5px 8px;text-align:right;font-family:var(--fm);' + (chg > 0 ? 'color:var(--gn)' : chg < 0 ? 'color:var(--rd)' : '') + '">' + (chg > 0 ? '+' : '') + chg.toFixed(2) + '%</td>';
    h += '<td style="padding:5px 8px;text-align:right;font-family:var(--fm);font-weight:600;' + (chg20 > 0 ? 'color:var(--gn)' : chg20 < 0 ? 'color:var(--rd)' : '') + '">' + (chg20 > 0 ? '+' : '') + chg20.toFixed(1) + '%</td>';
    h += '<td style="padding:5px 8px;text-align:right;font-family:var(--fm);' + (rs > 0 ? 'color:var(--gn)' : rs < 0 ? 'color:var(--rd)' : '') + '">' + (rs > 0 ? '+' : '') + rs.toFixed(2) + '%</td>';
    h += '<td style="padding:5px 8px;text-align:right;font-family:var(--fm);' + (fnet > 0 ? 'color:var(--gn)' : fnet < 0 ? 'color:var(--rd)' : '') + '">' + fmtRp(fnet) + '</td>';
    h += '<td style="padding:5px 8px;font-size:10px">' + signal + '</td>';
    h += '<td style="padding:5px 8px">';
    if (s.top_stocks && s.top_stocks.length) {
      h += s.top_stocks.map(function(t) { return '<span class="code" onclick="sdOpenTicker(\'' + esc(t) + '\')" style="cursor:pointer;font-size:11px;font-weight:600;margin-right:4px">' + esc(t) + '</span>'; }).join('');
    }
    h += '</td></tr>';
  });
  h += '</table>';
  return h;
}

// ═══ Level 5: Decision Matrix ═══
function mrRenderDecision(d) {
  var signals = [];
  var bullPoints = 0, bearPoints = 0;

  // Macro Signals (P0 Sprint 13) — inject bull/bear from macro engine
  if (d.macro_signals && d.macro_signals.signals && d.macro_signals.signals.length) {
    var mb = d.macro_signals.bull_points || 0;
    var mr = d.macro_signals.bear_points || 0;
    bullPoints += mb; bearPoints += mr;
    var macroVerdict = mr > mb + 1 ? '🔴 Headwind' : mb > mr + 1 ? '🟢 Tailwind' : '🟡 Mixed';
    signals.push({ level: 'Macro', signal: macroVerdict, detail: mb + ' bull / ' + mr + ' bear points' });
  }

  // Global
  if (d.global && d.global.length) {
    var gBull = d.global.filter(function(x) { return (x.chg_20d || 0) > 3; }).length;
    var gBear = d.global.filter(function(x) { return (x.chg_20d || 0) < -3; }).length;
    var gTotal = d.global.length;
    if (gBull > gTotal / 2) { signals.push({ level: 'Global', signal: '🟢 Risk-On', detail: gBull + '/' + gTotal + ' bullish' }); bullPoints += 2; }
    else if (gBear > gTotal / 2) { signals.push({ level: 'Global', signal: '🔴 Risk-Off', detail: gBear + '/' + gTotal + ' bearish' }); bearPoints += 2; }
    else { signals.push({ level: 'Global', signal: '🟡 Mixed', detail: 'No clear direction' }); }
  }

  // Commodity — check if majority trending up
  if (d.commodities && d.commodities.length) {
    var cUp = d.commodities.filter(function(x) { return (x.chg_20d || 0) > 2; }).length;
    var cDown = d.commodities.filter(function(x) { return (x.chg_20d || 0) < -2; }).length;
    if (cUp > cDown) { signals.push({ level: 'Commodity', signal: '🟢 Tailwind', detail: cUp + ' rising' }); bullPoints++; }
    else if (cDown > cUp) { signals.push({ level: 'Commodity', signal: '🔴 Headwind', detail: cDown + ' falling' }); bearPoints++; }
    else { signals.push({ level: 'Commodity', signal: '🟡 Mixed', detail: '' }); }
  }

  // IHSG
  if (d.idx && d.idx.ihsg) {
    var regime = d.idx.ihsg.regime;
    if (regime === 'bull' || regime === 'mild_bull') { signals.push({ level: 'IHSG', signal: '🟢 ' + regime, detail: 'Chg20D: ' + (d.idx.ihsg.chg_20d || 0).toFixed(1) + '%' }); bullPoints += 2; }
    else if (regime === 'bear' || regime === 'mild_bear') { signals.push({ level: 'IHSG', signal: '🔴 ' + regime, detail: 'Chg20D: ' + (d.idx.ihsg.chg_20d || 0).toFixed(1) + '%' }); bearPoints += 2; }
    else { signals.push({ level: 'IHSG', signal: '🟡 Sideways', detail: '' }); }
  }

  // Foreign Flow
  if (d.idx && d.idx.foreign_flow) {
    var fnet = d.idx.foreign_flow.net_20d || 0;
    if (fnet > 0) { signals.push({ level: 'Foreign', signal: '🟢 Inflow', detail: fmtRp(fnet) }); bullPoints++; }
    else { signals.push({ level: 'Foreign', signal: '🔴 Outflow', detail: fmtRp(fnet) }); bearPoints++; }
  }

  // Breadth
  if (d.idx && d.idx.breadth) {
    var ma50 = d.idx.breadth.pct_above_ma50 || 0;
    if (ma50 > 60) { signals.push({ level: 'Breadth', signal: '🟢 Healthy', detail: ma50.toFixed(0) + '% > MA50' }); bullPoints++; }
    else if (ma50 < 30) { signals.push({ level: 'Breadth', signal: '🔴 Weak', detail: ma50.toFixed(0) + '% > MA50' }); bearPoints++; }
    else { signals.push({ level: 'Breadth', signal: '🟡 Neutral', detail: ma50.toFixed(0) + '% > MA50' }); }
  }

  // Final verdict
  var totalPoints = bullPoints + bearPoints;
  var verdict, verdictColor, verdictBg;
  if (bullPoints > bearPoints + 2) { verdict = '🟢 TRADE — Market conditions favorable'; verdictColor = 'var(--gn)'; verdictBg = 'rgba(34,197,94,0.08)'; }
  else if (bearPoints > bullPoints + 2) { verdict = '🔴 SIDELINE — Market conditions unfavorable'; verdictColor = 'var(--rd)'; verdictBg = 'rgba(239,68,68,0.08)'; }
  else if (bullPoints > bearPoints) { verdict = '🟡 SELECTIVE — Trade with caution, pick strong sectors'; verdictColor = 'var(--am)'; verdictBg = 'rgba(245,158,11,0.08)'; }
  else { verdict = '🟡 CAUTION — Mixed signals, reduce position size'; verdictColor = 'var(--am)'; verdictBg = 'rgba(245,158,11,0.08)'; }

  var h = '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px">';
  h += '<tr style="border-bottom:1px solid var(--b2)"><th style="text-align:left;padding:4px 8px;color:var(--t3);font-size:9px">Level</th><th style="text-align:left;padding:4px 8px;color:var(--t3);font-size:9px">Signal</th><th style="text-align:left;padding:4px 8px;color:var(--t3);font-size:9px">Detail</th></tr>';
  signals.forEach(function(s) {
    h += '<tr style="border-bottom:1px solid var(--b1)"><td style="padding:4px 8px;font-weight:600">' + s.level + '</td><td style="padding:4px 8px">' + s.signal + '</td><td style="padding:4px 8px;color:var(--t3);font-size:10px">' + (s.detail || '') + '</td></tr>';
  });
  h += '</table>';

  // Verdict banner
  h += '<div style="padding:10px 14px;border-radius:6px;background:' + verdictBg + ';border:1px solid ' + verdictColor + '33">';
  h += '<div style="font-size:14px;font-weight:700;color:' + verdictColor + '">' + verdict + '</div>';
  h += '<div style="font-size:10px;color:var(--t3);margin-top:2px">Bull points: ' + bullPoints + ' · Bear points: ' + bearPoints + '</div>';

  // Recommended sectors
  if (d.sectors && d.sectors.length) {
    var favored = d.sectors.filter(function(s) { return (s.rs_vs_ihsg || 0) > 0 && (s.fnet_20d || 0) > 0; });
    if (favored.length) {
      h += '<div style="font-size:11px;margin-top:6px"><b>Favored sectors:</b> ' + favored.map(function(s) { return '<span style="color:var(--gn);font-weight:600">' + esc(s.sector) + '</span>'; }).join(', ') + '</div>';
    }
  }
  h += '</div>';
  return h;
}

// ═══ CHARTS ═══
function mrDrawCharts(d) {
  // Breadth chart (mini bar chart)
  var bEl = $('mr-breadth-chart');
  if (bEl && d.idx && d.idx.breadth_history && d.idx.breadth_history.length) {
    var c = BL.init(bEl, 'mr-breadth');
    if (c) {
      var bh = d.idx.breadth_history;
      c.setOption({
        tooltip: { trigger: 'axis', textStyle: { fontSize: 9 } },
        legend: { top: 2, textStyle: { fontSize: 8 }, data: ['%>MA20', '%>MA50'] },
        grid: BL.grid({ top: 24, bottom: 20, left: 35, right: 10 }),
        xAxis: { type: 'category', data: bh.map(function(r) { return r.date; }), axisLabel: { fontSize: 7, formatter: function(v) { return v.substring(5); } } },
        yAxis: { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 8, formatter: function(v) { return v + '%'; } } },
        series: [
          { name: '%>MA20', type: 'line', data: bh.map(function(r) { return r.pct_above_ma20; }), symbol: 'none', lineStyle: { width: 1.5, color: '#0ea5e9' }, itemStyle: { color: '#0ea5e9' } },
          { name: '%>MA50', type: 'line', data: bh.map(function(r) { return r.pct_above_ma50; }), symbol: 'none', lineStyle: { width: 1.5, color: '#f59e0b' }, itemStyle: { color: '#f59e0b' } }
        ]
      }, true);
    }
  }
}

// ═══ Navigate: sector → Screener filtered, ticker → Stock Detail ═══
function mrGoSector(cpSector) {
  if (typeof stab === 'function') stab('analysis');
  setTimeout(function() {
    var btn = document.querySelector('.wt-b[onclick*="screener"]');
    if (btn && typeof anaSubTab === 'function') anaSubTab('screener', btn);
    setTimeout(function() {
      var formula = 'Sector == "' + cpSector + '" AND C > 0';
      var inp = document.getElementById('afl-input');
      if (inp) {
        inp.value = formula;
        if (typeof aflOnInput === 'function') aflOnInput();
        if (typeof aflRun === 'function') aflRun();
      }
    }, 300);
  }, 100);
}

// ═══ MARKET NEWS PANEL ═══
var _mrNewsCache = null;
var _mrNewsCacheTime = 0;

async function mrRenderNews(containerId) {
  var el = document.getElementById(containerId); if (!el) return;

  // Check cache (5 min TTL)
  var now = Date.now();
  if (_mrNewsCache && (now - _mrNewsCacheTime) < 300000) {
    mrRenderNewsData(el, _mrNewsCache);
    return;
  }

  try {
    var r = await fetch('/api/idx/market-news');
    var data = await r.json();
    if (data.error) { el.innerHTML = '<div style="color:var(--rd);font-size:11px">❌ ' + esc(data.error) + '</div>'; return; }
    _mrNewsCache = data;
    _mrNewsCacheTime = now;
    mrRenderNewsData(el, data);
  } catch (e) {
    el.innerHTML = '<div style="color:var(--rd);font-size:11px">❌ Network error</div>';
  }
}

function mrRefreshNewsFn() {
  _mrNewsCache = null;
  _mrNewsCacheTime = 0;
  mrRenderNews('mr-news');
}

function mrRenderNewsData(el, data) {
  var cats = data.categories || [];
  if (!cats.length) { el.innerHTML = '<div style="color:var(--t3);font-size:11px">No news available</div>'; return; }

  var h = '';

  // Header row: tabs + refresh
  h += '<div style="display:flex;align-items:center;border-bottom:1px solid var(--b1);overflow-x:auto;flex-shrink:0">';
  cats.forEach(function(cat, i) {
    var n = cat.items ? cat.items.length : 0;
    h += '<button class="mr-news-tab' + (i === 0 ? ' on' : '') + '" onclick="mrNewsTab(' + i + ')" data-idx="' + i + '">';
    h += cat.icon + ' ' + esc(cat.label);
    if (n) h += ' <span style="font-size:8px;opacity:.6">(' + n + ')</span>';
    h += '</button>';
  });
  h += '<div style="flex:1"></div>';
  if (data.fetched_at) {
    var ft = new Date(data.fetched_at);
    h += '<span style="font-size:9px;color:var(--t3);padding:0 8px">' + ft.toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'}) + '</span>';
  }
  h += '<button class="bei-sort-btn" onclick="mrRefreshNewsFn()" style="font-size:9px;padding:2px 8px;margin-right:4px">↻</button>';
  h += '</div>';

  // Panels
  cats.forEach(function(cat, ci) {
    h += '<div class="mr-news-panel" id="mr-news-p' + ci + '" style="display:' + (ci === 0 ? 'block' : 'none') + '">';
    if (!cat.items || !cat.items.length) {
      h += '<div style="padding:12px;text-align:center;color:var(--t3);font-size:11px">No headlines</div>';
    } else {
      h += '<div style="max-height:280px;overflow-y:auto">';
      cat.items.forEach(function(item) {
        var ageColor = item.age && item.age.indexOf('m ago') >= 0 ? 'var(--gn)' :
                       item.age && item.age.indexOf('h ago') >= 0 ? 'var(--bl)' : 'var(--t3)';
        h += '<a href="' + esc(item.url) + '" target="_blank" rel="noopener" class="mr-news-item">';
        h += '<div class="mr-news-headline">' + esc(item.headline) + '</div>';
        h += '<div class="mr-news-meta">';
        if (item.source) h += '<span>' + esc(item.source) + '</span>';
        if (item.age) h += '<span style="color:' + ageColor + '">' + esc(item.age) + '</span>';
        h += '</div></a>';
      });
      h += '</div>';
    }
    h += '</div>';
  });

  el.innerHTML = h;
}

function mrNewsTab(idx) {
  document.querySelectorAll('.mr-news-tab').forEach(function(t) {
    t.classList.toggle('on', parseInt(t.getAttribute('data-idx')) === idx);
  });
  document.querySelectorAll('.mr-news-panel').forEach(function(p, i) {
    p.style.display = i === idx ? 'block' : 'none';
  });
}