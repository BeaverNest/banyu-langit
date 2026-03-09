// ═══ Portfolio Tracker + Kelly Position Sizer ═══
var pfView = 'dashboard'; // dashboard | entry | positions | history | settings
var pfStats = null;
var pfSettings = null;
var pfTrades = [];

async function loadPortfolio() {
  var el = $('pf-content'); if (!el) return;
  // Load settings + stats in parallel
  try {
    var [sRes, stRes] = await Promise.all([fetch('/api/portfolio/settings'), fetch('/api/portfolio/stats')]);
    pfSettings = await sRes.json();
    pfStats = await stRes.json();
  } catch(e) { pfSettings = { capital: 100000000, win_rate: 50, risk_per_trade: 2, kelly_fraction: 50 }; pfStats = {}; }
  renderPortfolio();
}

function renderPortfolio() {
  var el = $('pf-content'); if (!el) return;
  var h = '';

  // Sub-nav
  h += '<div style="display:flex;gap:3px;padding:8px 12px;border-bottom:1px solid var(--b1);flex-wrap:wrap;align-items:center">';
  [{k:'dashboard',l:'📊 Dashboard'},{k:'entry',l:'➕ New Trade'},{k:'positions',l:'📈 Open'},{k:'history',l:'📋 History'},{k:'settings',l:'⚙ Settings'}].forEach(function(v) {
    h += '<button class="bei-sort-btn' + (pfView === v.k ? ' on' : '') + '" onclick="pfView=\'' + v.k + '\';renderPortfolio()" style="padding:5px 12px;font-size:11px">' + v.l + '</button>';
  });
  h += '</div>';
  h += '<div id="pf-body" style="flex:1;overflow-y:auto;padding:12px"></div>';
  el.innerHTML = h;

  var body = $('pf-body');
  if (pfView === 'dashboard') renderPfDashboard(body);
  else if (pfView === 'entry') renderPfEntry(body);
  else if (pfView === 'positions') loadPfPositions(body);
  else if (pfView === 'history') loadPfHistory(body);
  else if (pfView === 'settings') renderPfSettings(body);
}

// ═══ DASHBOARD ═══
function renderPfDashboard(el) {
  var s = pfStats || {};
  var h = '<div style="font-weight:700;font-size:14px;margin-bottom:12px">💼 Portfolio Dashboard</div>';

  // Stats cards
  h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">';
  h += pfCard('Capital', fmtRp(s.capital || 0), '');
  h += pfCard('Invested', fmtRp(s.total_invested || 0), '');
  h += pfCard('Open Positions', s.open_positions || 0, '');
  h += pfCard('Unrealized P&L', fmtRp(s.unrealized_pnl || 0), (s.unrealized_pnl || 0) > 0 ? 'up' : (s.unrealized_pnl || 0) < 0 ? 'dn' : '');
  h += pfCard('Realized P&L', fmtRp(s.realized_pnl || 0), (s.realized_pnl || 0) > 0 ? 'up' : (s.realized_pnl || 0) < 0 ? 'dn' : '');
  h += pfCard('Win Rate', (s.win_rate || 0) + '%', (s.win_rate || 0) >= 50 ? 'up' : 'dn');
  h += pfCard('W / L', (s.wins || 0) + ' / ' + (s.losses || 0), '');
  h += pfCard('Closed Trades', s.closed_trades || 0, '');
  h += '</div>';

  // Quick actions
  h += '<div style="display:flex;gap:8px;margin-bottom:16px">';
  h += '<button class="pbtn" onclick="pfView=\'entry\';renderPortfolio()" style="padding:8px 20px;font-size:12px">➕ New Trade</button>';
  h += '<button class="bei-tab" onclick="pfView=\'positions\';renderPortfolio()">📈 Open Positions (' + (s.open_positions || 0) + ')</button>';
  h += '<button class="bei-tab" onclick="pfView=\'history\';renderPortfolio()">📋 Trade History</button>';
  h += '</div>';

  el.innerHTML = h;
}

function pfCard(label, value, cls) {
  return '<div class="bd-card"><div class="bd-card-label">' + label + '</div><div class="bd-card-val ' + cls + '">' + value + '</div></div>';
}

// ═══ NEW TRADE ENTRY + KELLY ═══
var pfEntryCode = '';
var pfKellyData = null;

function renderPfEntry(el) {
  var h = '<div style="font-weight:700;font-size:14px;margin-bottom:12px">➕ New Trade — Kelly Position Sizer</div>';

  // Ticker input
  h += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">';
  h += '<input id="pf-ticker" class="scr-inp" style="width:120px;font-size:14px;font-weight:700;text-transform:uppercase" placeholder="BBCA" value="' + esc(pfEntryCode) + '" onkeydown="if(event.key===\'Enter\')pfLoadKelly()">';
  h += '<button class="pbtn" onclick="pfLoadKelly()" style="padding:6px 16px">Load</button>';
  h += '<span style="font-size:10px;color:var(--t3)">Enter ticker → auto-load price, ATR, support levels</span>';
  h += '</div>';

  // Kelly result area
  h += '<div id="pf-kelly-result">';
  if (pfKellyData) h += renderKellyResult(pfKellyData);
  else h += '<div style="color:var(--t3);padding:20px;text-align:center">Enter a ticker above to calculate position size</div>';
  h += '</div>';

  el.innerHTML = h;
}

async function pfLoadKelly() {
  var inp = $('pf-ticker'); if (!inp) return;
  pfEntryCode = inp.value.toUpperCase().trim();
  if (!pfEntryCode) return;

  var el = $('pf-kelly-result');
  if (el) el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3)">Loading ' + pfEntryCode + '...</div>';

  try {
    var r = await fetch('/api/portfolio/kelly?code=' + pfEntryCode);
    pfKellyData = await r.json();
    if (el) el.innerHTML = renderKellyResult(pfKellyData);
  } catch(e) { if (el) el.innerHTML = '<div class="ne">Error: ' + e.message + '</div>'; }
}

function renderKellyResult(d) {
  if (!d.ticker) return '<div class="ne">Ticker not found</div>';
  var t = d.ticker, s = d.settings, k = d.kelly, st = d.stats;
  var h = '';

  // Ticker info bar
  h += '<div style="display:flex;gap:12px;align-items:center;padding:10px 14px;background:var(--bgH);border-radius:10px;margin-bottom:12px">';
  h += '<span style="font-size:18px;font-weight:700;color:var(--bl);cursor:pointer" onclick="gsOpen(\'' + esc(t.code) + '\')">' + t.code + '</span>';
  h += '<span style="font-size:12px;color:var(--t2)">' + esc(t.name || '') + '</span>';
  h += '<span style="flex:1"></span>';
  h += '<span style="font-family:var(--fm);font-size:16px;font-weight:700">' + t.close.toLocaleString() + '</span>';
  h += '</div>';

  // Two columns: left = inputs, right = result
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';

  // ── LEFT: Trade inputs ──
  h += '<div style="border:1px solid var(--b2);border-radius:10px;padding:14px">';
  h += '<div style="font-weight:700;font-size:12px;margin-bottom:10px">Trade Setup</div>';

  h += pfInputRow('Entry Price', 'pf-entry', t.close, 'Auto-filled with close');
  h += pfInputRow('Stop Loss', 'pf-sl', t.low20 || Math.round(t.close * 0.95), 'Suggested: 20D low or ATR-based');
  h += pfInputRow('Target Price', 'pf-tp', Math.round(t.close * 1.1), 'Your take-profit level');
  h += pfInputRow('Lots', 'pf-lots', '', 'Auto-calculated below');

  h += '<div style="margin-top:10px">';
  h += '<button class="pbtn" onclick="pfCalcKelly()" style="padding:6px 16px;font-size:12px;width:100%">🎯 Calculate Position Size</button>';
  h += '</div>';

  // Reference data
  h += '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--b1)">';
  h += '<div style="font-size:10px;font-weight:600;color:var(--t3);margin-bottom:4px">Reference Levels</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px;font-size:10px;font-family:var(--fm)">';
  h += '<span>ATR(14): ' + (t.atr || '-').toLocaleString() + '</span>';
  h += '<span>MA20: ' + (t.ma20 ? t.ma20.toLocaleString() : '-') + '</span>';
  h += '<span>MA50: ' + (t.ma50 ? t.ma50.toLocaleString() : '-') + '</span>';
  h += '<span>MA200: ' + (t.ma200 ? t.ma200.toLocaleString() : '-') + '</span>';
  h += '<span>Low 20D: ' + (t.low20 ? t.low20.toLocaleString() : '-') + '</span>';
  h += '<span>High: ' + t.high.toLocaleString() + ' Low: ' + t.low.toLocaleString() + '</span>';
  h += '</div></div>';
  h += '</div>';

  // ── RIGHT: Kelly result ──
  h += '<div>';

  // Kelly stats
  h += '<div style="border:1px solid var(--b2);border-radius:10px;padding:14px;margin-bottom:12px">';
  h += '<div style="font-weight:700;font-size:12px;margin-bottom:8px">📊 Kelly Criterion</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px">';
  h += '<span style="color:var(--t3)">Win Rate:</span><span style="font-family:var(--fm);font-weight:600">' + st.win_rate + '% <span style="font-size:9px;color:var(--t3)">(' + st.source + ')</span></span>';
  h += '<span style="color:var(--t3)">Avg R:R:</span><span style="font-family:var(--fm);font-weight:600">' + st.rr + '</span>';
  h += '<span style="color:var(--t3)">Raw Kelly:</span><span style="font-family:var(--fm);font-weight:700;color:var(--bl)">' + k.raw + '%</span>';
  h += '<span style="color:var(--t3)">Adj Kelly (' + s.kelly_fraction + '%):</span><span style="font-family:var(--fm);font-weight:700;color:var(--gn)">' + k.adjusted + '%</span>';
  h += '<span style="color:var(--t3)">Trades (W/L):</span><span style="font-family:var(--fm)">' + st.wins + '/' + st.losses + ' (' + st.total_trades + ' total)</span>';
  h += '</div></div>';

  // Position sizing result (calculated on button click)
  h += '<div id="pf-sizing-result" style="border:1px solid var(--bl);border-radius:10px;padding:14px;background:var(--blB)">';
  h += '<div style="font-weight:700;font-size:12px;margin-bottom:6px;color:var(--bl)">🎯 Position Size</div>';
  h += '<div style="font-size:11px;color:var(--t3)">Click "Calculate" to compute optimal lot size</div>';
  h += '</div>';

  // Save trade button
  h += '<div style="margin-top:12px">';
  h += '<button class="pbtn" id="pf-save-btn" onclick="pfSaveTrade()" style="padding:8px 20px;font-size:12px;width:100%" disabled>💾 Save Trade</button>';
  h += '</div>';

  h += '</div></div>';

  return h;
}

function pfInputRow(label, id, value, hint) {
  var h = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">';
  h += '<span style="font-size:11px;color:var(--t2);min-width:90px">' + label + '</span>';
  h += '<input id="' + id + '" class="scr-inp" style="flex:1" type="number" step="any" value="' + (value || '') + '" placeholder="' + hint + '">';
  h += '</div>';
  return h;
}

function pfCalcKelly() {
  var entry = parseFloat($('pf-entry')?.value) || 0;
  var sl = parseFloat($('pf-sl')?.value) || 0;
  var tp = parseFloat($('pf-tp')?.value) || 0;
  if (!entry || !sl) { showT('⚠', 'Enter entry price and stop loss'); return; }

  var d = pfKellyData;
  var s = d.settings;

  var riskPerShare = Math.abs(entry - sl);
  var rewardPerShare = tp ? Math.abs(tp - entry) : riskPerShare * 2;
  var rr = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0;

  // Kelly with this trade's R:R
  var wr = d.stats.win_rate / 100;
  var kellyRaw = rr > 0 ? Math.max(0, wr - (1 - wr) / rr) : 0;
  var kellyAdj = kellyRaw * (s.kelly_fraction / 100);

  // Position size
  var capitalAtRisk = s.capital * kellyAdj;
  var riskMethod = s.capital * (s.risk_per_trade / 100); // fixed % risk
  var useAmount = Math.min(capitalAtRisk, riskMethod); // conservative: use smaller

  var shares = riskPerShare > 0 ? Math.floor(useAmount / riskPerShare) : 0;
  var lots = Math.floor(shares / 100);
  var totalCost = lots * 100 * entry;
  var maxLoss = lots * 100 * riskPerShare;
  var maxProfit = lots * 100 * rewardPerShare;
  var pctOfCapital = s.capital > 0 ? (totalCost / s.capital * 100) : 0;

  // Update lots input
  var lotsInp = $('pf-lots'); if (lotsInp) lotsInp.value = lots;

  // Render result
  var el = $('pf-sizing-result'); if (!el) return;
  var h = '<div style="font-weight:700;font-size:12px;margin-bottom:8px;color:var(--bl)">🎯 Position Size</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px">';
  h += '<span style="color:var(--t2)">Risk/share:</span><span style="font-family:var(--fm)">' + riskPerShare.toLocaleString() + '</span>';
  h += '<span style="color:var(--t2)">Reward/share:</span><span style="font-family:var(--fm)">' + rewardPerShare.toLocaleString() + '</span>';
  h += '<span style="color:var(--t2)">R:R Ratio:</span><span style="font-family:var(--fm);font-weight:700;color:' + (rr >= 2 ? 'var(--gn)' : rr >= 1 ? 'var(--am)' : 'var(--rd)') + '">1:' + rr.toFixed(2) + '</span>';
  h += '<span style="color:var(--t2)">Kelly (this trade):</span><span style="font-family:var(--fm);font-weight:700">' + (kellyAdj * 100).toFixed(1) + '%</span>';
  h += '</div>';
  h += '<hr style="border:none;border-top:1px solid var(--b1);margin:8px 0">';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:12px">';
  h += '<span style="font-weight:700;font-size:16px;color:var(--bl);grid-column:1/-1">' + lots + ' lots (' + (lots * 100).toLocaleString() + ' shares)</span>';
  h += '<span style="color:var(--t2)">Total Cost:</span><span style="font-family:var(--fm);font-weight:600">' + fmtRp(totalCost) + '</span>';
  h += '<span style="color:var(--t2)">% of Capital:</span><span style="font-family:var(--fm)">' + pctOfCapital.toFixed(1) + '%</span>';
  h += '<span style="color:var(--t2)">Max Loss:</span><span style="font-family:var(--fm);color:var(--rd)">' + fmtRp(maxLoss) + '</span>';
  h += '<span style="color:var(--t2)">Max Profit:</span><span style="font-family:var(--fm);color:var(--gn)">' + fmtRp(maxProfit) + '</span>';
  h += '</div>';
  el.innerHTML = h;

  // Enable save
  var btn = $('pf-save-btn'); if (btn) btn.disabled = false;
}

async function pfSaveTrade() {
  var code = pfEntryCode;
  var entry = parseFloat($('pf-entry')?.value) || 0;
  var sl = parseFloat($('pf-sl')?.value) || 0;
  var tp = parseFloat($('pf-tp')?.value) || 0;
  var lots = parseInt($('pf-lots')?.value) || 0;
  if (!code || !entry || !lots) { showT('⚠', 'Fill all fields'); return; }

  try {
    var r = await fetch('/api/portfolio/trades', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, name: pfKellyData?.ticker?.name || '', entry_date: new Date().toISOString().split('T')[0], entry_price: entry, lots: lots, stop_loss: sl, target_price: tp }) });
    var d = await r.json();
    if (d.success) {
      showT('✅', code + ' — ' + lots + ' lots @ ' + entry.toLocaleString() + ' saved');
      pfEntryCode = ''; pfKellyData = null;
      pfView = 'positions'; loadPortfolio();
    } else { showT('Error', d.error); }
  } catch(e) { showT('Error', e.message); }
}

// ═══ OPEN POSITIONS ═══
async function loadPfPositions(el) {
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3)">Loading...</div>';
  try {
    var r = await fetch('/api/portfolio/trades?status=open');
    var trades = await r.json();
    renderPfPositions(el, trades);
  } catch(e) { el.innerHTML = '<div class="ne">Error: ' + e.message + '</div>'; }
}

function renderPfPositions(el, trades) {
  var h = '<div style="font-weight:700;font-size:14px;margin-bottom:12px">📈 Open Positions (' + trades.length + ')</div>';
  if (!trades.length) { el.innerHTML = h + '<div class="ne">No open positions. <span class="code" style="cursor:pointer" onclick="pfView=\'entry\';renderPortfolio()">+ New Trade</span></div>'; return; }

  h += '<table class="bei-tbl" style="width:100%"><thead><tr>';
  h += '<th class="al">Code</th><th class="ar">Entry</th><th class="ar">Lots</th><th class="ar">Current</th><th class="ar">P&L</th><th class="ar">P&L %</th><th class="ar">SL</th><th class="ar">TP</th><th class="ar">Date</th><th></th>';
  h += '</tr></thead><tbody>';

  var totalPnl = 0;
  trades.forEach(function(t) {
    var cur = t.current_price || t.entry_price;
    var pnl = (cur - t.entry_price) * t.lots * 100;
    var pnlPct = t.entry_price > 0 ? (cur - t.entry_price) / t.entry_price * 100 : 0;
    totalPnl += pnl;
    var cls = pnl > 0 ? 'up' : pnl < 0 ? 'dn' : '';
    var slHit = t.stop_loss && cur <= t.stop_loss;
    var tpHit = t.target_price && cur >= t.target_price;

    h += '<tr' + (slHit ? ' style="background:var(--rdB)"' : tpHit ? ' style="background:var(--gnB)"' : '') + '>';
    h += '<td class="code al" onclick="gsOpen(\'' + esc(t.code) + '\')">' + esc(t.code) + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + t.entry_price.toLocaleString() + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + t.lots + '</td>';
    h += '<td class="ar" style="font-family:var(--fm);font-weight:600">' + cur.toLocaleString() + '</td>';
    h += '<td class="ar ' + cls + '" style="font-family:var(--fm);font-weight:700">' + fmtRp(pnl) + '</td>';
    h += '<td class="ar ' + cls + '" style="font-family:var(--fm)">' + (pnlPct > 0 ? '+' : '') + pnlPct.toFixed(2) + '%</td>';
    h += '<td class="ar" style="font-family:var(--fm);color:var(--rd)">' + (t.stop_loss ? t.stop_loss.toLocaleString() : '-') + '</td>';
    h += '<td class="ar" style="font-family:var(--fm);color:var(--gn)">' + (t.target_price ? t.target_price.toLocaleString() : '-') + '</td>';
    h += '<td class="ar" style="font-size:10px;color:var(--t3)">' + (t.entry_date || '').substring(5) + '</td>';
    h += '<td><button class="bei-sort-btn" onclick="pfCloseTrade(' + t.id + ',' + cur + ')" style="font-size:9px;padding:2px 6px;color:var(--am)">Close</button>';
    h += '<button class="bei-sort-btn" onclick="pfDeleteTrade(' + t.id + ')" style="font-size:9px;padding:2px 6px;color:var(--rd)">✕</button></td>';
    h += '</tr>';
  });
  h += '</tbody></table>';

  var totalCls = totalPnl > 0 ? 'up' : totalPnl < 0 ? 'dn' : '';
  h += '<div style="text-align:right;padding:8px;font-size:12px;font-weight:700">Total Unrealized: <span class="' + totalCls + '">' + fmtRp(totalPnl) + '</span></div>';

  el.innerHTML = h;
}

async function pfCloseTrade(id, currentPrice) {
  var price = prompt('Exit price:', currentPrice || '');
  if (!price) return;
  try {
    var r = await fetch('/api/portfolio/trades/' + id + '/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exit_price: parseFloat(price) }) });
    var d = await r.json();
    if (d.success) { showT('✅', 'Trade closed'); loadPortfolio(); }
    else showT('Error', d.error);
  } catch(e) { showT('Error', e.message); }
}

async function pfDeleteTrade(id) {
  if (!confirm('Delete this trade?')) return;
  try { await fetch('/api/portfolio/trades/' + id, { method: 'DELETE' }); showT('✅', 'Deleted'); loadPortfolio(); } catch(e) { showT('Error', e.message); }
}

// ═══ TRADE HISTORY ═══
async function loadPfHistory(el) {
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3)">Loading...</div>';
  try {
    var r = await fetch('/api/portfolio/trades?status=closed');
    var trades = await r.json();
    renderPfHistory(el, trades);
  } catch(e) { el.innerHTML = '<div class="ne">Error: ' + e.message + '</div>'; }
}

function renderPfHistory(el, trades) {
  var h = '<div style="font-weight:700;font-size:14px;margin-bottom:12px">📋 Trade History (' + trades.length + ')</div>';
  if (!trades.length) { el.innerHTML = h + '<div class="ne">No closed trades yet</div>'; return; }

  // Stats summary
  var wins = 0, losses = 0, totalPnl = 0, winPnl = 0, lossPnl = 0;
  trades.forEach(function(t) {
    var pnl = ((t.exit_price || t.entry_price) - t.entry_price) * (t.exit_lots || t.lots) * 100;
    totalPnl += pnl;
    if (pnl > 0) { wins++; winPnl += pnl; } else if (pnl < 0) { losses++; lossPnl += Math.abs(pnl); }
  });
  var wr = (wins + losses) > 0 ? (wins / (wins + losses) * 100).toFixed(1) : '0';
  var avgWin = wins > 0 ? winPnl / wins : 0;
  var avgLoss = losses > 0 ? lossPnl / losses : 1;
  var expectancy = (wins + losses) > 0 ? totalPnl / (wins + losses) : 0;

  h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">';
  h += pfCard('Total P&L', fmtRp(totalPnl), totalPnl > 0 ? 'up' : 'dn');
  h += pfCard('Win Rate', wr + '%', parseFloat(wr) >= 50 ? 'up' : 'dn');
  h += pfCard('W / L', wins + ' / ' + losses, '');
  h += pfCard('Avg Win', fmtRp(avgWin), 'up');
  h += pfCard('Avg Loss', fmtRp(avgLoss), 'dn');
  h += pfCard('Avg R:R', avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '-', '');
  h += pfCard('Expectancy', fmtRp(expectancy) + '/trade', expectancy > 0 ? 'up' : 'dn');
  h += '</div>';

  // Table
  h += '<table class="bei-tbl" style="width:100%"><thead><tr>';
  h += '<th class="al">Code</th><th class="ar">Entry</th><th class="ar">Exit</th><th class="ar">Lots</th><th class="ar">P&L</th><th class="ar">%</th><th class="ar">Entry Date</th><th class="ar">Exit Date</th><th class="ar">Days</th>';
  h += '</tr></thead><tbody>';

  trades.forEach(function(t) {
    var exitP = t.exit_price || t.entry_price;
    var pnl = (exitP - t.entry_price) * (t.exit_lots || t.lots) * 100;
    var pnlPct = t.entry_price > 0 ? (exitP - t.entry_price) / t.entry_price * 100 : 0;
    var cls = pnl > 0 ? 'up' : pnl < 0 ? 'dn' : '';
    var days = '';
    if (t.entry_date && t.exit_date) {
      var d1 = new Date(t.entry_date), d2 = new Date(t.exit_date);
      days = Math.round((d2 - d1) / 86400000);
    }

    h += '<tr>';
    h += '<td class="code al" onclick="gsOpen(\'' + esc(t.code) + '\')">' + esc(t.code) + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + t.entry_price.toLocaleString() + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + exitP.toLocaleString() + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + (t.exit_lots || t.lots) + '</td>';
    h += '<td class="ar ' + cls + '" style="font-family:var(--fm);font-weight:700">' + fmtRp(pnl) + '</td>';
    h += '<td class="ar ' + cls + '" style="font-family:var(--fm)">' + (pnlPct > 0 ? '+' : '') + pnlPct.toFixed(2) + '%</td>';
    h += '<td class="ar" style="font-size:10px">' + (t.entry_date || '') + '</td>';
    h += '<td class="ar" style="font-size:10px">' + (t.exit_date || '') + '</td>';
    h += '<td class="ar" style="font-size:10px;color:var(--t3)">' + days + '</td>';
    h += '</tr>';
  });
  h += '</tbody></table>';
  el.innerHTML = h;
}

// ═══ SETTINGS ═══
function renderPfSettings(el) {
  var s = pfSettings || {};
  var h = '<div style="font-weight:700;font-size:14px;margin-bottom:12px">⚙ Portfolio Settings</div>';
  h += '<div style="max-width:400px">';
  h += pfInputRow('Capital (IDR)', 'pfs-capital', s.capital || 100000000, 'Total trading capital');
  h += pfInputRow('Win Rate (%)', 'pfs-wr', s.win_rate || 50, 'Your estimated win rate');
  h += pfInputRow('Risk per Trade (%)', 'pfs-risk', s.risk_per_trade || 2, 'Max % capital risk per trade');
  h += pfInputRow('Kelly Fraction (%)', 'pfs-kf', s.kelly_fraction || 50, '50 = Half Kelly (recommended)');
  h += '<button class="pbtn" onclick="pfSaveSettings()" style="margin-top:10px;padding:8px 20px">💾 Save</button>';
  h += '</div>';

  h += '<div style="margin-top:20px;padding:14px;border:1px solid var(--b2);border-radius:10px;max-width:500px">';
  h += '<div style="font-weight:700;font-size:12px;margin-bottom:8px">📖 Kelly Criterion Explained</div>';
  h += '<div style="font-size:11px;line-height:1.6;color:var(--t2)">';
  h += '<b>Kelly % = W - (1-W) / R</b><br>';
  h += 'W = win rate, R = avg win / avg loss<br><br>';
  h += '<b>Kelly Fraction</b>: Most traders use Half Kelly (50%) for safety. Full Kelly is mathematically optimal but very aggressive.<br><br>';
  h += '<b>Risk per Trade</b>: Fixed % of capital risked. Position size = min(Kelly amount, Risk amount) for extra safety.<br><br>';
  h += 'Once you have 5+ closed trades, Kelly auto-calculates from your actual win rate and R:R ratio.';
  h += '</div></div>';

  el.innerHTML = h;
}

async function pfSaveSettings() {
  var capital = parseFloat($('pfs-capital')?.value) || 100000000;
  var wr = parseFloat($('pfs-wr')?.value) || 50;
  var risk = parseFloat($('pfs-risk')?.value) || 2;
  var kf = parseFloat($('pfs-kf')?.value) || 50;
  try {
    await fetch('/api/portfolio/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capital: capital, win_rate: wr, risk_per_trade: risk, kelly_fraction: kf }) });
    pfSettings = { capital: capital, win_rate: wr, risk_per_trade: risk, kelly_fraction: kf };
    showT('✅', 'Settings saved');
  } catch(e) { showT('Error', e.message); }
}
