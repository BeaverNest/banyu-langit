// ═══ PORTFOLIO BUILDER — Correlation Matrix + Smart Builder ═══
// Sub-tab in Analysis: integrates with Composite Score

var pbSubTab = 'matrix'; // matrix | builder
var pbStocks = []; // selected stock codes
var pbCorrData = null; // { matrix, codes, returns, period }
var pbLoading = false;
var pbDays = 120; // lookback days for correlation
var pbScoreData = null; // cached composite score data

// ═══ MAIN ENTRY ═══
function loadPortfolioBuilder() {
  var el = $('pb-content'); if (!el) return;
  renderPBShell(el);
  if (!pbScoreData) loadPBScores();
}

function renderPBShell(el) {
  var h = '';

  // ── Sub-tabs ──
  h += '<div style="display:flex;gap:3px;padding:6px 12px;border-bottom:1px solid var(--b1);align-items:center">';
  [{k:'matrix',l:'📊 Correlation Matrix'},{k:'builder',l:'🔧 Smart Builder'}].forEach(function(t) {
    h += '<button class="bei-tab' + (pbSubTab === t.k ? ' on' : '') + '" onclick="pbSubTab=\'' + t.k + '\';loadPortfolioBuilder()" style="padding:4px 10px;font-size:10px">' + t.l + '</button>';
  });
  h += '<span style="flex:1"></span>';
  h += '<span style="font-size:9px;color:var(--t3)" id="pb-score-status"></span>';
  h += '</div>';

  // ── Body ──
  h += '<div id="pb-body" style="flex:1;overflow-y:auto;padding:12px"></div>';
  el.innerHTML = h;

  if (pbSubTab === 'matrix') renderMatrixUI();
  else renderBuilderUI();
}

// ═══ LOAD COMPOSITE SCORES ═══
async function loadPBScores() {
  var st = $('pb-score-status');
  if (st) st.textContent = 'Loading scores...';
  try {
    var r = await fetch('/api/idx/metrics?limit=500');
    var d = await r.json();
    if (d.rows && d.rows.length) {
      pbScoreData = d.rows;
      if (st) st.textContent = d.rows.length + ' saham (metrik)';
    } else {
      if (st) st.textContent = 'Tidak ada data metrik';
    }
  } catch (e) { if (st) st.textContent = ''; }
}

// ═══ CORRELATION MATRIX UI ═══
function renderMatrixUI() {
  var body = $('pb-body'); if (!body) return;
  var h = '';

  // Input section
  h += '<div style="margin-bottom:12px">';
  h += '<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:6px">📊 Correlation Matrix</div>';
  h += '<div style="font-size:10px;color:var(--t2);margin-bottom:10px">Analyze pairwise correlation between stocks to detect concentration risk. Lower correlation = better diversification.</div>';

  h += '<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:10px">';
  h += '<div style="flex:1;min-width:250px"><div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:2px">Stocks (comma-separated)</div>';
  h += '<input id="pb-codes" style="width:100%;background:var(--bg0);border:1px solid var(--b1);border-radius:4px;padding:6px 8px;color:var(--t1);font-family:var(--fm);font-size:11px;outline:none;text-transform:uppercase" placeholder="BBCA,BBRI,TLKM,ADRO,PTBA,ASII" value="' + (pbStocks.length ? pbStocks.join(',') : '') + '"></div>';
  h += '<div><div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:2px">Lookback</div>';
  h += '<select id="pb-days" style="background:var(--bg0);border:1px solid var(--b1);border-radius:4px;padding:5px 8px;color:var(--t1);font-size:10px;outline:none">';
  [60,120,240].forEach(function(d) { h += '<option value="' + d + '"' + (pbDays === d ? ' selected' : '') + '>' + d + 'd</option>'; });
  h += '</select></div>';
  h += '<button onclick="runCorrelation()" id="pb-run-btn" style="padding:6px 16px;border-radius:6px;border:none;background:var(--bl);color:#fff;font-weight:700;font-size:11px;cursor:pointer">▶ Compute</button>';
  h += '</div>';

  // Quick presets from score
  h += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">';
  h += '<span style="font-size:9px;color:var(--t3);padding:3px 0">Quick:</span>';
  h += '<button class="bei-sort-btn" onclick="pbPreset(\'top10\')" style="padding:2px 8px;font-size:9px">Top 10 Score</button>';
  h += '<button class="bei-sort-btn" onclick="pbPreset(\'top20\')" style="padding:2px 8px;font-size:9px">Top 20 Score</button>';
  h += '<button class="bei-sort-btn" onclick="pbPreset(\'banks\')" style="padding:2px 8px;font-size:9px">Banks</button>';
  h += '<button class="bei-sort-btn" onclick="pbPreset(\'coal\')" style="padding:2px 8px;font-size:9px">Coal</button>';
  h += '<button class="bei-sort-btn" onclick="pbPreset(\'mixed\')" style="padding:2px 8px;font-size:9px">Mixed Sample</button>';
  h += '</div>';
  h += '</div>';

  h += '<div id="pb-status" style="font-size:10px;color:var(--t3);margin-bottom:8px"></div>';
  h += '<div id="pb-result"></div>';

  body.innerHTML = h;

  // Re-render previous results
  if (pbCorrData) renderCorrResult();
}

function pbPreset(type) {
  var inp = $('pb-codes'); if (!inp) return;
  if (type === 'top10' && pbScoreData) {
    inp.value = pbScoreData.slice(0, 10).map(function(s) { return s.code; }).join(',');
  } else if (type === 'top20' && pbScoreData) {
    inp.value = pbScoreData.slice(0, 20).map(function(s) { return s.code; }).join(',');
  } else if (type === 'banks') {
    inp.value = 'BBCA,BBRI,BMRI,BBNI,BRIS,BTPS,BBTN,BJTM';
  } else if (type === 'coal') {
    inp.value = 'ADRO,PTBA,ITMG,BSSR,MBSS,AADI,TPMA';
  } else if (type === 'mixed') {
    inp.value = 'BBCA,ADRO,TLKM,ASII,UNVR,CPIN,MNCN,TOWR';
  }
}

// ═══ COMPUTE CORRELATION ═══
async function runCorrelation() {
  if (pbLoading) return;
  var inp = $('pb-codes'); if (!inp) return;
  var codes = inp.value.toUpperCase().split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s.length >= 3; });
  if (codes.length < 2) { $('pb-status').textContent = '❌ Need at least 2 stocks'; return; }
  if (codes.length > 30) { $('pb-status').textContent = '❌ Max 30 stocks'; return; }

  pbStocks = codes;
  pbDays = parseInt(($('pb-days') || {}).value) || 120;
  pbLoading = true;
  var btn = $('pb-run-btn'); if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  var st = $('pb-status'); if (st) st.textContent = 'Fetching data for ' + codes.length + ' stocks...';

  try {
    // Fetch daily close data for all stocks in parallel
    var allData = {};
    await Promise.all(codes.map(async function(code) {
      var r = await fetch('/api/idx/flow?code=' + encodeURIComponent(code));
      var d = await r.json();
      if (d.data && d.data.length) {
        allData[code] = d.data.slice(-pbDays).map(function(r) { return { date: r.trade_date, close: r.close }; });
      }
    }));

    // Filter codes that actually have data
    var validCodes = codes.filter(function(c) { return allData[c] && allData[c].length >= 20; });
    if (validCodes.length < 2) { if (st) st.textContent = '❌ Not enough data'; pbLoading = false; if (btn) { btn.disabled = false; btn.textContent = '▶ Compute'; } return; }

    // Align dates — find common trading dates
    var dateSets = validCodes.map(function(c) { return new Set(allData[c].map(function(r) { return r.date; })); });
    var commonDates = [];
    allData[validCodes[0]].forEach(function(r) {
      var ok = true;
      for (var i = 1; i < dateSets.length; i++) { if (!dateSets[i].has(r.date)) { ok = false; break; } }
      if (ok) commonDates.push(r.date);
    });

    if (commonDates.length < 20) { if (st) st.textContent = '❌ Only ' + commonDates.length + ' common trading days (need 20+)'; pbLoading = false; if (btn) { btn.disabled = false; btn.textContent = '▶ Compute'; } return; }

    // Build aligned close price arrays and compute daily returns
    var returns = {};
    validCodes.forEach(function(code) {
      var priceMap = {};
      allData[code].forEach(function(r) { priceMap[r.date] = r.close; });
      var prices = commonDates.map(function(d) { return priceMap[d]; });
      var ret = [];
      for (var i = 1; i < prices.length; i++) {
        ret.push(prices[i - 1] > 0 ? (prices[i] - prices[i - 1]) / prices[i - 1] : 0);
      }
      returns[code] = ret;
    });

    // Compute Pearson correlation matrix
    var matrix = [];
    for (var i = 0; i < validCodes.length; i++) {
      matrix[i] = [];
      for (var j = 0; j < validCodes.length; j++) {
        if (i === j) { matrix[i][j] = 1.0; }
        else if (j < i) { matrix[i][j] = matrix[j][i]; }
        else { matrix[i][j] = pearsonCorr(returns[validCodes[i]], returns[validCodes[j]]); }
      }
    }

    pbCorrData = { matrix: matrix, codes: validCodes, returns: returns, period: commonDates.length, days: pbDays };
    if (st) st.textContent = '✅ ' + validCodes.length + ' stocks · ' + commonDates.length + ' trading days';
    renderCorrResult();
  } catch (e) {
    if (st) st.textContent = '❌ ' + e.message;
  }
  pbLoading = false;
  if (btn) { btn.disabled = false; btn.textContent = '▶ Compute'; }
}

function pearsonCorr(x, y) {
  var n = Math.min(x.length, y.length);
  if (n < 5) return 0;
  var sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (var i = 0; i < n; i++) {
    sx += x[i]; sy += y[i];
    sxx += x[i] * x[i]; syy += y[i] * y[i];
    sxy += x[i] * y[i];
  }
  var denom = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return denom > 0 ? (n * sxy - sx * sy) / denom : 0;
}

// ═══ RENDER CORRELATION RESULT ═══
function renderCorrResult() {
  var el = $('pb-result'); if (!el || !pbCorrData) return;
  var m = pbCorrData.matrix, codes = pbCorrData.codes, n = codes.length;

  // Compute portfolio-level stats
  var totalPairs = 0, sumCorr = 0, highPairs = [], lowPairs = [];
  for (var i = 0; i < n; i++) {
    for (var j = i + 1; j < n; j++) {
      var c = m[i][j];
      totalPairs++;
      sumCorr += c;
      if (c >= 0.7) highPairs.push({ a: codes[i], b: codes[j], c: c });
      if (c <= 0.2) lowPairs.push({ a: codes[i], b: codes[j], c: c });
    }
  }
  var avgCorr = totalPairs > 0 ? sumCorr / totalPairs : 0;
  var divScore = Math.max(0, Math.min(100, Math.round((1 - avgCorr) * 100)));

  // Summary cards
  var acCls = avgCorr > 0.6 ? 'color:var(--rd)' : avgCorr > 0.3 ? 'color:var(--am)' : 'color:var(--gn)';
  var dsCls = divScore < 40 ? 'color:var(--rd)' : divScore < 70 ? 'color:var(--am)' : 'color:var(--gn)';
  var h = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">';
  h += '<div class="bd-card"><div class="bd-card-label">Avg Correlation</div><div class="bd-card-val"><span style="' + acCls + '">' + avgCorr.toFixed(2) + '</span></div></div>';
  h += '<div class="bd-card"><div class="bd-card-label">Diversification Score</div><div class="bd-card-val"><span style="' + dsCls + '">' + divScore + '/100</span></div></div>';
  h += '<div class="bd-card"><div class="bd-card-label">High Corr Pairs (≥0.7)</div><div class="bd-card-val"><span style="' + (highPairs.length > 0 ? 'color:var(--rd)' : 'color:var(--gn)') + '">' + highPairs.length + '</span></div></div>';
  h += '<div class="bd-card"><div class="bd-card-label">Low Corr Pairs (≤0.2)</div><div class="bd-card-val"><span style="color:var(--gn)">' + lowPairs.length + '</span></div></div>';
  h += '</div>';

  // Interpretation
  h += '<div style="font-size:10px;padding:6px 10px;border-radius:4px;background:var(--bgH);border:1px solid var(--b1);margin-bottom:12px;color:var(--t2)">';
  if (avgCorr > 0.6) h += '❌ <b style="color:var(--rd)">Highly concentrated.</b> Stocks move together — drawdown risk amplified.';
  else if (avgCorr > 0.4) h += '⚠️ <b style="color:var(--am)">Moderate concentration.</b> Some diversification but room for improvement.';
  else h += '✅ <b style="color:var(--gn)">Well diversified.</b> Low average correlation across holdings.';
  if (highPairs.length > 0) {
    h += ' High-corr pairs: ' + highPairs.slice(0, 3).map(function(p) { return p.a + '/' + p.b + ' (' + p.c.toFixed(2) + ')'; }).join(', ');
    if (highPairs.length > 3) h += ' +' + (highPairs.length - 3) + ' more';
  }
  h += '</div>';

  // ECharts heatmap container
  h += '<div style="border:1px solid var(--b1);border-radius:8px;overflow:hidden;background:var(--bg2);margin-bottom:12px">';
  h += '<div style="padding:5px 10px;font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;border-bottom:1px solid var(--b1);background:var(--bgH)">Correlation Heatmap</div>';
  var chartH = Math.max(300, Math.min(600, n * 36 + 80));
  h += BL.container('pb-heatmap', chartH);
  h += '</div>';

  // Score overlay table (if scores available)
  if (pbScoreData) {
    var scoreMap = {};
    pbScoreData.forEach(function(s) { scoreMap[s.code] = s; });

    h += '<div style="border:1px solid var(--b1);border-radius:8px;overflow:hidden;background:var(--bg2);margin-bottom:12px">';
    h += '<div style="padding:5px 10px;font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;border-bottom:1px solid var(--b1);background:var(--bgH)">Score + Correlation Profile</div>';
    h += '<div style="overflow-x:auto"><table class="bei-tbl" style="font-size:10px"><thead><tr>';
    h += '<th class="al">Code</th><th class="ar">Ret20d</th><th class="ar">PER</th><th class="ar">PBV</th><th class="ar">RelVol</th><th class="al">Sector</th><th class="ar">Avg Corr</th><th class="ar">Max Corr</th><th class="al">Most Correlated</th>';
    h += '</tr></thead><tbody>';

    codes.forEach(function(code, i) {
      var sc = scoreMap[code] || {};
      var rowCorrs = m[i].slice();
      rowCorrs[i] = -999; // exclude self
      var avgC = 0, maxC = -1, maxIdx = -1;
      for (var j = 0; j < n; j++) {
        if (j !== i) {
          avgC += m[i][j];
          if (m[i][j] > maxC) { maxC = m[i][j]; maxIdx = j; }
        }
      }
      avgC = n > 1 ? avgC / (n - 1) : 0;
      var acC = avgC > 0.6 ? 'color:var(--rd)' : avgC > 0.3 ? 'color:var(--am)' : 'color:var(--gn)';
      var mcC = maxC > 0.7 ? 'color:var(--rd)' : maxC > 0.5 ? 'color:var(--am)' : 'color:var(--gn)';
      var compScore = sc.ret_20d == null ? 0 : sc.ret_20d;
      var bg = '';

      h += '<tr>';
      h += '<td class="al"><span class="code" onclick="gsOpen(\'' + esc(code) + '\')">' + esc(code) + '</span></td>';
      h += '<td class="ar" style="font-weight:700">' + (sc.ret_20d == null ? '–' : sc.ret_20d.toFixed(2)) + '</td>';
      h += '<td class="ar">' + (sc.per == null ? '–' : sc.per.toFixed(2)) + '</td>';
      h += '<td class="ar">' + (sc.pbv == null ? '–' : sc.pbv.toFixed(2)) + '</td>';
      h += '<td class="ar">' + (sc.rel_vol == null ? '–' : sc.rel_vol.toFixed(2)) + '</td>';
      h += '<td class="al" style="font-size:9px">' + esc(sc.sector || '-') + '</td>';
      h += '<td class="ar" style="font-weight:600;' + acC + '">' + avgC.toFixed(2) + '</td>';
      h += '<td class="ar" style="font-weight:600;' + mcC + '">' + maxC.toFixed(2) + '</td>';
      h += '<td class="al" style="font-size:9px">' + (maxIdx >= 0 ? codes[maxIdx] : '-') + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div></div>';
  }

  el.innerHTML = h;

  // Deferred ECharts heatmap render
  setTimeout(function() { renderCorrHeatmap(); }, 60);
}

function renderCorrHeatmap() {
  var el = $('pb-heatmap'); if (!el || !pbCorrData) return;
  var c = BL.init(el, 'pb-heatmap'); if (!c) return;
  var codes = pbCorrData.codes, m = pbCorrData.matrix, n = codes.length;

  var data = [];
  for (var i = 0; i < n; i++) {
    for (var j = 0; j < n; j++) {
      data.push([j, i, Math.round(m[i][j] * 100) / 100]);
    }
  }

  c.setOption({
    tooltip: {
      formatter: function(p) {
        return '<b>' + codes[p.value[1]] + ' × ' + codes[p.value[0]] + '</b><br>Correlation: <b style="color:' + (p.value[2] > 0.7 ? BL.colors.red : p.value[2] > 0.4 ? BL.colors.amber : BL.colors.green) + '">' + p.value[2].toFixed(2) + '</b>';
      }
    },
    grid: { left: 60, right: 60, top: 10, bottom: 50, containLabel: false },
    xAxis: { type: 'category', data: codes, axisLabel: { fontSize: 9, fontWeight: 600, rotate: 45 }, splitArea: { show: true, areaStyle: { color: ['transparent', 'rgba(255,255,255,0.02)'] } } },
    yAxis: { type: 'category', data: codes, axisLabel: { fontSize: 9, fontWeight: 600 }, splitArea: { show: true, areaStyle: { color: ['transparent', 'rgba(255,255,255,0.02)'] } } },
    visualMap: {
      min: -0.5, max: 1.0, calculable: true, orient: 'vertical', right: 5, top: 'center',
      textStyle: { fontSize: 8, color: '#6b7a8d' },
      inRange: { color: ['#2563eb', '#1e3a5f', '#1a1a2e', '#3d1a1a', '#7f1d1d', '#ef4444'] }
    },
    series: [{
      type: 'heatmap', data: data,
      label: { show: n <= 15, fontSize: 9, fontWeight: 600, fontFamily: 'IBM Plex Mono',
        formatter: function(p) { return p.value[2].toFixed(2); },
        color: function(p) { return p.value && p.value[2] > 0.5 ? '#fff' : '#8a9bb5'; }
      },
      itemStyle: { borderColor: '#0f1520', borderWidth: 1 },
      emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 2 } }
    }]
  });
}

// ═══ SMART BUILDER UI ═══
var sbMaxPos = 5;
var sbMaxCorr = 0.55;
var sbResult = null;

function renderBuilderUI() {
  var body = $('pb-body'); if (!body) return;
  var h = '';

  h += '<div style="margin-bottom:12px">';
  h += '<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:6px">🔧 Smart Portfolio Builder</div>';
  h += '<div style="font-size:10px;color:var(--t2);margin-bottom:10px;line-height:1.6">Select top-scored stocks while constraining pairwise correlation.<br>Algorithm: greedy selection from composite score ranking, skip if any pairwise corr with selected stocks exceeds threshold.</div>';

  h += '<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:10px">';
  h += '<div><div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:2px">Max Positions</div>';
  h += '<input id="sb-pos" type="number" value="' + sbMaxPos + '" min="2" max="20" style="width:50px;background:var(--bg0);border:1px solid var(--b1);border-radius:4px;padding:5px 8px;color:var(--t1);font-family:var(--fm);font-size:11px;outline:none"></div>';
  h += '<div><div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:2px">Max Correlation</div>';
  h += '<input id="sb-corr" type="number" value="' + sbMaxCorr + '" min="0.1" max="0.95" step="0.05" style="width:60px;background:var(--bg0);border:1px solid var(--b1);border-radius:4px;padding:5px 8px;color:var(--t1);font-family:var(--fm);font-size:11px;outline:none"></div>';
  h += '<div><div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:2px">Lookback</div>';
  h += '<select id="sb-days" style="background:var(--bg0);border:1px solid var(--b1);border-radius:4px;padding:5px 8px;color:var(--t1);font-size:10px;outline:none">';
  [60,120,240].forEach(function(d) { h += '<option value="' + d + '"' + (pbDays === d ? ' selected' : '') + '>' + d + 'd</option>'; });
  h += '</select></div>';
  h += '<div><div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:2px">Universe</div>';
  h += '<select id="sb-universe" style="background:var(--bg0);border:1px solid var(--b1);border-radius:4px;padding:5px 8px;color:var(--t1);font-size:10px;outline:none">';
  h += '<option value="20">Top 20 Score</option><option value="30">Top 30 Score</option><option value="50" selected>Top 50 Score</option><option value="100">Top 100 Score</option>';
  h += '</select></div>';
  h += '<button onclick="runSmartBuild()" id="sb-run-btn" style="padding:6px 16px;border-radius:6px;border:none;background:var(--gn);color:#fff;font-weight:700;font-size:11px;cursor:pointer">🔧 Build</button>';
  h += '</div></div>';

  h += '<div id="sb-status" style="font-size:10px;color:var(--t3);margin-bottom:8px"></div>';
  h += '<div id="sb-result"></div>';

  body.innerHTML = h;
  if (sbResult) renderBuilderResult();
}

// ═══ SMART BUILD ═══
async function runSmartBuild() {
  if (pbLoading) return;
  if (!pbScoreData || !pbScoreData.length) { $('sb-status').textContent = '❌ Tidak ada data metrik'; return; }

  sbMaxPos = parseInt(($('sb-pos') || {}).value) || 5;
  sbMaxCorr = parseFloat(($('sb-corr') || {}).value) || 0.55;
  var days = parseInt(($('sb-days') || {}).value) || 120;
  var universeN = parseInt(($('sb-universe') || {}).value) || 50;

  var universe = pbScoreData.slice(0, universeN).map(function(s) { return s.code; });
  pbLoading = true;
  var btn = $('sb-run-btn'); if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  var st = $('sb-status'); if (st) st.textContent = 'Fetching data for ' + universe.length + ' stocks...';

  try {
    // Fetch all data
    var allData = {};
    var batchSize = 10;
    for (var b = 0; b < universe.length; b += batchSize) {
      var batch = universe.slice(b, b + batchSize);
      await Promise.all(batch.map(async function(code) {
        try {
          var r = await fetch('/api/idx/flow?code=' + encodeURIComponent(code));
          var d = await r.json();
          if (d.data && d.data.length >= 20) {
            allData[code] = d.data.slice(-days).map(function(r) { return { date: r.trade_date, close: r.close }; });
          }
        } catch(e) {}
      }));
      if (st) st.textContent = 'Fetching... ' + Math.min(b + batchSize, universe.length) + '/' + universe.length;
    }

    // Build common dates and returns
    var validCodes = universe.filter(function(c) { return allData[c] && allData[c].length >= 20; });
    if (st) st.textContent = 'Computing correlations for ' + validCodes.length + ' stocks...';

    var dateSet0 = new Set(allData[validCodes[0]].map(function(r) { return r.date; }));
    // For smart build, use pairwise correlation (don't need ALL dates to match)

    // Pre-compute return arrays
    var returnsMap = {};
    validCodes.forEach(function(code) {
      var prices = allData[code].map(function(r) { return r.close; });
      var ret = [];
      for (var i = 1; i < prices.length; i++) {
        ret.push(prices[i - 1] > 0 ? (prices[i] - prices[i - 1]) / prices[i - 1] : 0);
      }
      returnsMap[code] = ret;
    });

    // Greedy selection
    var selected = [];
    var skipped = [];
    var scoreMap = {};
    pbScoreData.forEach(function(s) { scoreMap[s.code] = s; });

    for (var i = 0; i < validCodes.length && selected.length < sbMaxPos; i++) {
      var code = validCodes[i];
      if (!returnsMap[code]) continue;

      // Check correlation with all already-selected stocks
      var ok = true;
      var maxCorrWith = null;
      for (var j = 0; j < selected.length; j++) {
        var corr = pearsonCorr(returnsMap[code], returnsMap[selected[j].code]);
        if (corr > sbMaxCorr) {
          ok = false;
          maxCorrWith = { code: selected[j].code, corr: corr };
          break;
        }
      }

      if (ok) {
        selected.push({ code: code, score: (scoreMap[code] || {}).ret_20d || 0, rank: i + 1 });
      } else {
        skipped.push({ code: code, score: (scoreMap[code] || {}).ret_20d || 0, rank: i + 1, reason: 'corr ' + maxCorrWith.corr.toFixed(2) + ' with ' + maxCorrWith.code });
      }
    }

    // Compute correlation matrix for selected
    var selCodes = selected.map(function(s) { return s.code; });
    var selMatrix = [];
    for (var si = 0; si < selCodes.length; si++) {
      selMatrix[si] = [];
      for (var sj = 0; sj < selCodes.length; sj++) {
        if (si === sj) selMatrix[si][sj] = 1.0;
        else if (sj < si) selMatrix[si][sj] = selMatrix[sj][si];
        else selMatrix[si][sj] = pearsonCorr(returnsMap[selCodes[si]], returnsMap[selCodes[sj]]);
      }
    }

    // Avg correlation of selected portfolio
    var selAvgCorr = 0, selPairs = 0;
    for (var si2 = 0; si2 < selCodes.length; si2++) {
      for (var sj2 = si2 + 1; sj2 < selCodes.length; sj2++) {
        selAvgCorr += selMatrix[si2][sj2]; selPairs++;
      }
    }
    selAvgCorr = selPairs > 0 ? selAvgCorr / selPairs : 0;

    sbResult = { selected: selected, skipped: skipped, matrix: selMatrix, codes: selCodes, avgCorr: selAvgCorr, scoreMap: scoreMap, maxCorr: sbMaxCorr, maxPos: sbMaxPos };
    if (st) st.textContent = '✅ Selected ' + selected.length + '/' + sbMaxPos + ' from top ' + validCodes.length + ' scored stocks';
    renderBuilderResult();
  } catch (e) {
    if (st) st.textContent = '❌ ' + e.message;
  }
  pbLoading = false;
  if (btn) { btn.disabled = false; btn.textContent = '🔧 Build'; }
}

function renderBuilderResult() {
  var el = $('sb-result'); if (!el || !sbResult) return;
  var r = sbResult;
  var h = '';

  // Summary
  var avgScore = r.selected.reduce(function(s, x) { return s + x.score; }, 0) / (r.selected.length || 1);
  var divScore = Math.max(0, Math.min(100, Math.round((1 - r.avgCorr) * 100)));
  h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">';
  h += '<div class="bd-card"><div class="bd-card-label">Selected</div><div class="bd-card-val">' + r.selected.length + '/' + r.maxPos + '</div></div>';
  h += '<div class="bd-card"><div class="bd-card-label">Avg Score</div><div class="bd-card-val" style="color:var(--gn)">' + avgScore.toFixed(2) + '</div></div>';
  h += '<div class="bd-card"><div class="bd-card-label">Avg Correlation</div><div class="bd-card-val" style="' + (r.avgCorr > 0.5 ? 'color:var(--am)' : 'color:var(--gn)') + '">' + r.avgCorr.toFixed(2) + '</div></div>';
  h += '<div class="bd-card"><div class="bd-card-label">Diversification</div><div class="bd-card-val" style="' + (divScore < 50 ? 'color:var(--am)' : 'color:var(--gn)') + '">' + divScore + '/100</div></div>';
  h += '<div class="bd-card"><div class="bd-card-label">Max Corr Threshold</div><div class="bd-card-val">' + r.maxCorr + '</div></div>';
  h += '<div class="bd-card"><div class="bd-card-label">Skipped</div><div class="bd-card-val" style="color:var(--rd)">' + r.skipped.length + '</div></div>';
  h += '</div>';

  // Selected stocks table
  h += '<div style="border:1px solid var(--b1);border-radius:8px;overflow:hidden;background:var(--bg2);margin-bottom:12px">';
  h += '<div style="padding:5px 10px;font-size:9px;font-weight:700;color:var(--gn);text-transform:uppercase;border-bottom:1px solid var(--b1);background:var(--bgH)">✅ Selected Portfolio</div>';
  h += '<table class="bei-tbl" style="font-size:10px"><thead><tr>';
  h += '<th style="width:24px">#</th><th class="al">Code</th><th class="ar">Rank</th><th class="ar">Score</th><th class="al">Sector</th>';
  h += '</tr></thead><tbody>';
  r.selected.forEach(function(s, i) {
    var sc = r.scoreMap[s.code] || {};
    h += '<tr><td style="text-align:center;color:var(--t3)">' + (i + 1) + '</td>';
    h += '<td class="al"><span class="code" onclick="gsOpen(\'' + esc(s.code) + '\')">' + esc(s.code) + '</span></td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + s.rank + '</td>';
    h += '<td class="ar" style="font-weight:700;color:var(--gn)">' + s.score.toFixed(2) + '</td>';
    h += '<td class="al" style="font-size:9px">' + esc(sc.sector || '') + '</td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';

  // Mini correlation heatmap for selected
  if (r.codes.length >= 2) {
    h += '<div style="border:1px solid var(--b1);border-radius:8px;overflow:hidden;background:var(--bg2);margin-bottom:12px">';
    h += '<div style="padding:5px 10px;font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;border-bottom:1px solid var(--b1);background:var(--bgH)">Portfolio Correlation</div>';
    var miniH = Math.max(250, Math.min(400, r.codes.length * 40 + 80));
    h += BL.container('sb-mini-heatmap', miniH);
    h += '</div>';
  }

  // Skipped stocks
  if (r.skipped.length > 0) {
    h += '<div style="border:1px solid var(--b1);border-radius:8px;overflow:hidden;background:var(--bg2);margin-bottom:12px">';
    h += '<div style="padding:5px 10px;font-size:9px;font-weight:700;color:var(--rd);text-transform:uppercase;border-bottom:1px solid var(--b1);background:var(--bgH)">❌ Skipped (corr > ' + r.maxCorr + ')</div>';
    h += '<table class="bei-tbl" style="font-size:10px"><thead><tr>';
    h += '<th class="al">Code</th><th class="ar">Rank</th><th class="ar">Score</th><th class="al">Reason</th>';
    h += '</tr></thead><tbody>';
    r.skipped.slice(0, 20).forEach(function(s) {
      h += '<tr><td class="al"><span class="code" onclick="gsOpen(\'' + esc(s.code) + '\')">' + esc(s.code) + '</span></td>';
      h += '<td class="ar" style="font-family:var(--fm)">' + s.rank + '</td>';
      h += '<td class="ar">' + s.score.toFixed(2) + '</td>';
      h += '<td class="al" style="font-size:9px;color:var(--rd)">' + esc(s.reason) + '</td></tr>';
    });
    h += '</tbody></table></div>';
  }

  // CTA: Use in backtest
  h += '<div style="display:flex;gap:6px;margin-top:8px">';
  h += '<button onclick="pbCopyToBacktest()" style="padding:6px 14px;border-radius:6px;border:1px solid var(--b2);background:var(--bgH);color:var(--bl);font-weight:600;font-size:10px;cursor:pointer;font-family:var(--f)">📋 Copy to Backtest scope</button>';
  h += '<button onclick="pbCopyToCorr()" style="padding:6px 14px;border-radius:6px;border:1px solid var(--b2);background:var(--bgH);color:var(--bl);font-weight:600;font-size:10px;cursor:pointer;font-family:var(--f)">📊 View in Correlation Matrix</button>';
  h += '</div>';

  el.innerHTML = h;

  // Render mini heatmap
  if (r.codes.length >= 2) {
    setTimeout(function() {
      var hel = $('sb-mini-heatmap'); if (!hel) return;
      // Store data and reuse renderCorrHeatmap logic
      var prevData = pbCorrData;
      pbCorrData = { matrix: r.matrix, codes: r.codes };
      var c2 = BL.init(hel, 'sb-mini-heatmap'); if (!c2) return;
      var n2 = r.codes.length, data2 = [];
      for (var i = 0; i < n2; i++) for (var j = 0; j < n2; j++) data2.push([j, i, Math.round(r.matrix[i][j] * 100) / 100]);
      c2.setOption({
        tooltip: { formatter: function(p) { return '<b>' + r.codes[p.value[1]] + ' × ' + r.codes[p.value[0]] + '</b><br>Corr: <b>' + p.value[2].toFixed(2) + '</b>'; } },
        grid: { left: 60, right: 60, top: 10, bottom: 50, containLabel: false },
        xAxis: { type: 'category', data: r.codes, axisLabel: { fontSize: 10, fontWeight: 700, rotate: 0 } },
        yAxis: { type: 'category', data: r.codes, axisLabel: { fontSize: 10, fontWeight: 700 } },
        visualMap: { min: -0.5, max: 1.0, calculable: true, orient: 'vertical', right: 5, top: 'center', textStyle: { fontSize: 8, color: '#6b7a8d' }, inRange: { color: ['#2563eb', '#1e3a5f', '#1a1a2e', '#3d1a1a', '#7f1d1d', '#ef4444'] } },
        series: [{ type: 'heatmap', data: data2, label: { show: true, fontSize: 10, fontWeight: 700, fontFamily: 'IBM Plex Mono', formatter: function(p) { return p.value[2].toFixed(2); } }, itemStyle: { borderColor: '#0f1520', borderWidth: 1 } }]
      });
      pbCorrData = prevData;
    }, 60);
  }
}

// ═══ CTA ACTIONS ═══
function pbCopyToBacktest() {
  if (!sbResult || !sbResult.selected.length) return;
  var codes = sbResult.selected.map(function(s) { return s.code; }).join(',');
  // Switch to backtest tab, fill in scope
  var btTab = document.querySelector('.wt-b[onclick*="backtest"]');
  if (btTab) anaSubTab('backtest', btTab);
  setTimeout(function() {
    var scope = $('bt-scope'); if (scope) { scope.value = 'stock'; btScopeChg(); }
    var sv = $('bt-sv'); if (sv) sv.value = codes;
  }, 200);
  showT('Portfolio Builder', codes.split(',').length + ' stocks copied to Backtest');
}

function pbCopyToCorr() {
  if (!sbResult || !sbResult.selected.length) return;
  pbSubTab = 'matrix';
  pbStocks = sbResult.selected.map(function(s) { return s.code; });
  loadPortfolioBuilder();
  setTimeout(function() { runCorrelation(); }, 200);
}
