// ═══ STOCK DETAIL — Phase Detection + Deep Analytics per Ticker ═══

var sdCode = '', sdData = null, sdLoading = false;

var PHASE_COLORS = {
  accumulation: { bg: 'rgba(34,197,94,0.12)', color: '#22c55e', icon: '▲', label: 'ACCUMULATION' },
  markup: { bg: 'rgba(14,165,233,0.12)', color: '#0ea5e9', icon: '🚀', label: 'MARKUP' },
  distribution: { bg: 'rgba(239,68,68,0.12)', color: '#ef4444', icon: '▼', label: 'DISTRIBUTION' },
  markdown: { bg: 'rgba(249,115,22,0.12)', color: '#f97316', icon: '📉', label: 'MARKDOWN' }
};

function loadStockDetail() {
  var el = $('sd-content'); if (!el) return;
  renderSDShell(el);
  if (sdData && sdCode) renderSDBody();
}

function renderSDShell(el) {
  var h = '<div style="padding:12px;height:100%;display:flex;flex-direction:column;overflow:hidden">';
  // Search bar with autocomplete
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

  // ═══ HEADER — compact 2-row Bloomberg style ═══
  var cur = d.current || {};
  var chgPct = cur.prev_close > 0 ? Math.round((cur.close - cur.prev_close) / cur.prev_close * 10000) / 100 : 0;
  var chgCls = chgPct > 0 ? 'up' : chgPct < 0 ? 'dn' : '';
  var phase = d.phase;
  var pc = phase ? (PHASE_COLORS[phase.phase] || PHASE_COLORS.accumulation) : null;
  var vd = d.verdict || {};
  var stg = d.stage || {};

  // Row 1: Price | Verdict | Phase | Stage — single horizontal bar
  h += '<div style="display:flex;align-items:center;gap:12px;padding:8px 10px;margin-bottom:6px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px;flex-wrap:wrap">';
  // Price block
  h += '<div style="display:flex;align-items:baseline;gap:6px">';
  h += '<span style="font-size:20px;font-weight:800;font-family:var(--fm)">' + (cur.close || 0).toLocaleString() + '</span>';
  h += '<span class="' + chgCls + '" style="font-size:13px;font-weight:700">' + (chgPct > 0 ? '+' : '') + chgPct.toFixed(2) + '%</span>';
  h += '<span style="font-size:9px;color:var(--t3)">Vol ' + fmtRp(cur.volume || 0) + ' · Val ' + fmtRp(cur.value || 0) + '</span>';
  h += '</div>';
  h += '<span style="color:var(--b2)">│</span>';
  // Verdict
  if (vd.label) {
    var vColor = vd.color || 'var(--t2)';
    h += '<div style="display:flex;align-items:center;gap:4px">';
    h += '<span style="font-size:9px;color:var(--t3)">Verdict</span>';
    h += '<span style="font-size:14px;font-weight:800;color:' + vColor + ';padding:1px 8px;border:1px solid ' + vColor + ';border-radius:3px">' + vd.label + '</span>';
    h += '<span style="font-size:9px;color:var(--t3)">' + vd.bull + '/' + vd.total + '</span>';
    h += '</div>';
    h += '<span style="color:var(--b2)">│</span>';
  }
  // Phase
  if (phase && pc) {
    h += '<div style="display:flex;align-items:center;gap:4px">';
    h += '<span style="font-size:9px;color:var(--t3)">Phase</span>';
    h += '<span style="font-size:12px;font-weight:700;color:' + pc.color + '">' + pc.icon + ' ' + pc.label + '</span>';
    h += '<span style="font-size:9px;color:var(--t3)">' + phase.days + 'd ' + (phase.confidence || 50) + '%</span>';
    h += '</div>';
    h += '<span style="color:var(--b2)">│</span>';
  }
  // MA Stage
  if (stg.level != null) {
    var stgColor = stg.level >= 4 ? '#22c55e' : stg.level >= 3 ? '#f59e0b' : stg.level >= 2 ? '#f97316' : '#ef4444';
    h += '<div style="display:flex;align-items:center;gap:4px">';
    h += '<span style="font-size:9px;color:var(--t3)">MA</span>';
    h += '<span style="font-size:12px;font-weight:700;color:' + stgColor + '">Stage ' + stg.level + '/' + stg.total + '</span>';
    h += '<span style="font-size:9px;color:var(--t3)">' + stg.label + '</span>';
    if (stg.bullish_stack) h += '<span style="font-size:9px;color:#22c55e">✓aligned</span>';
    if (stg.bearish_stack) h += '<span style="font-size:9px;color:#ef4444">✕aligned</span>';
    h += '</div>';
  }
  h += '</div>';

  // Row 2: Key stats — inline bar, not cards
  var st = d.stats || {};
  h += '<div style="display:flex;align-items:center;gap:12px;padding:5px 10px;margin-bottom:6px;font-size:12px;flex-wrap:wrap">';
  function _stat(lbl, val, cls) {
    var c = cls === 'up' ? 'var(--gn)' : cls === 'dn' ? 'var(--rd)' : cls === 'am' ? 'var(--am)' : 'var(--t1)';
    return '<span style="color:var(--t3)">' + lbl + '</span> <span style="font-weight:700;font-family:var(--fm);color:' + c + '">' + val + '</span>';
  }
  h += _stat('52H', (st.peak_52w || 0).toLocaleString(), '');
  h += _stat('52L', (st.low_52w || 0).toLocaleString(), '');
  h += _stat('DD', st.drawdown_from_peak + '%', st.drawdown_from_peak < -10 ? 'dn' : st.drawdown_from_peak < -5 ? 'am' : 'up');
  h += _stat('ATR14', (st.atr || 0).toLocaleString(), '');
  h += _stat('Vol%', (st.volatility_ann || 0).toFixed(1) + '%', st.volatility_ann > 50 ? 'dn' : '');
  if (st.rs_vs_ihsg !== null) h += _stat('RS', (st.rs_vs_ihsg > 0 ? '+' : '') + st.rs_vs_ihsg + '%', st.rs_vs_ihsg > 0 ? 'up' : 'dn');
  h += '</div>';

  // Signal table — single row horizontal
  if (vd.signals && vd.signals.length) {
    h += '<table class="bei-tbl" style="font-size:13px;margin-bottom:6px"><thead style="font-size:11px"><tr>';
    vd.signals.forEach(function(sig) { h += '<th class="al">' + esc(sig.name).toUpperCase() + '</th>'; });
    h += '</tr></thead><tbody><tr>';
    vd.signals.forEach(function(sig) {
      var sigColor = sig.direction === 'bullish' ? '#22c55e' : sig.direction === 'bearish' ? '#ef4444' : 'var(--t3)';
      var arrow = sig.direction === 'bullish' ? '▲' : sig.direction === 'bearish' ? '▼' : '●';
      h += '<td class="al"><span style="color:' + sigColor + ';font-weight:700">' + arrow + ' ' + esc(String(sig.value)) + '</span>';
      if (sig.detail) h += ' <span style="color:var(--t3);font-size:10px">' + esc(sig.detail) + '</span>';
      h += '</td>';
    });
    h += '</tr></tbody></table>';
  }

  // Warnings
  if (vd.warnings && vd.warnings.length) {
    h += '<div style="margin-bottom:10px">';
    vd.warnings.forEach(function(w) {
      h += '<div style="font-size:10px;color:var(--am);padding:3px 8px;background:rgba(255,152,0,0.06);border-radius:4px;margin-bottom:3px;border-left:3px solid var(--am)">⚠ ' + esc(w) + '</div>';
    });
    h += '</div>';
  }

  // ═══ AI COMMENTARY — moved to bottom ═══
  var commentaryHtml = sdCommentary(d);

  // ═══ MA Level Bar — compact inline ═══
  if (stg.ma && stg.ma.length) {
    h += '<div style="display:flex;align-items:center;gap:14px;padding:6px 10px;margin-bottom:6px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px;font-size:13px">';
    h += '<span style="color:var(--t3);font-weight:700;font-size:11px;min-width:55px">MA DIST</span>';
    stg.ma.forEach(function(m) {
      var color = m.above ? '#22c55e' : '#ef4444';
      var label = m.key.toUpperCase().replace('MA','');
      h += '<span><span style="color:var(--t3);font-size:11px">MA' + label + '</span> <span style="font-weight:700;font-family:var(--fm);color:' + color + '">' + (m.dist_pct > 0 ? '+' : '') + m.dist_pct.toFixed(1) + '%</span> <span style="color:var(--t3);font-family:var(--fm)">' + (m.value || 0).toLocaleString() + '</span></span>';
    });
    h += '</div>';
  }

  // ═══ CHART — full width, no sidebar ═══
  h += '<div style="margin-bottom:8px">';
  h += '<div style="font-size:10px;font-weight:700;color:var(--t1);margin-bottom:4px">PRICE & PHASES</div>';
  h += '<div id="sd-price-chart" style="width:100%;height:520px"></div>';
  h += '</div>';

  // ═══ 3-COLUMN ROW: MA Respect | Freq Analysis | 5-Factor Score ═══
  h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">';

  // ── Col 1: MA Respect Rate ──
  h += '<div style="padding:8px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px;overflow:hidden">';
  h += '<div style="font-size:10px;font-weight:700;color:var(--t1);margin-bottom:6px">MA RESPECT RATE</div>';
  if (d.ma_respect && d.ma_respect.length) {
    h += '<table class="bei-tbl" style="font-size:11px"><thead style="font-size:10px"><tr>';
    h += '<th class="al">MA</th><th class="ar">Rate</th><th class="ar">↑</th><th class="ar">↓</th><th class="ar">N</th><th class="al">Now</th>';
    h += '</tr></thead><tbody>';
    d.ma_respect.forEach(function(mr) {
      var rateColor = mr.respect_rate >= 65 ? '#22c55e' : mr.respect_rate >= 50 ? '#f59e0b' : '#ef4444';
      var nearTag = mr.near_now ? '<span style="color:var(--am);font-weight:700">⚡' + (mr.current_dist > 0 ? '+' : '') + mr.current_dist + '%</span>' : '<span style="color:var(--t3)">' + (mr.current_dist != null ? (mr.current_dist > 0 ? '+' : '') + mr.current_dist + '%' : '—') + '</span>';
      h += '<tr>';
      h += '<td class="al" style="font-weight:600">' + mr.label + '</td>';
      h += '<td class="ar" style="font-weight:800;font-family:var(--fm);color:' + rateColor + '">' + mr.respect_rate + '%</td>';
      h += '<td class="ar" style="color:var(--gn);font-family:var(--fm)">' + mr.bounces + '</td>';
      h += '<td class="ar" style="color:var(--rd);font-family:var(--fm)">' + mr.breakdowns + '</td>';
      h += '<td class="ar" style="font-family:var(--fm);color:var(--t3)">' + mr.touches + '</td>';
      h += '<td class="al">' + nearTag + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table>';
  } else {
    h += '<div style="font-size:11px;color:var(--t3);padding:10px 0">No data</div>';
  }
  h += '</div>';

  // ── Col 2: Freq Analysis ──
  h += '<div style="padding:8px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px;overflow:hidden">';
  h += '<div style="font-size:10px;font-weight:700;color:var(--t1);margin-bottom:6px">FREQ ANALYSIS';
  if (d.freq_analysis) {
    var fa = d.freq_analysis;
    var faCounts = [];
    if (fa.block_trade) faCounts.push('<span style="color:#0ea5e9">B:' + fa.block_trade + '</span>');
    if (fa.retail_frenzy) faCounts.push('<span style="color:#f97316">R:' + fa.retail_frenzy + '</span>');
    if (fa.smart_accum) faCounts.push('<span style="color:#22c55e">S:' + fa.smart_accum + '</span>');
    if (fa.dry_up) faCounts.push('<span style="color:#6b7280">D:' + fa.dry_up + '</span>');
    h += ' <span style="font-weight:400;color:var(--t3)">' + (fa.events || 0) + ' events</span>';
    if (faCounts.length) h += ' ' + faCounts.join(' ');
  }
  h += '</div>';
  if (d.freq_analysis && d.freq_analysis.recent && d.freq_analysis.recent.length) {
    h += '<table class="bei-tbl" style="font-size:11px"><thead style="font-size:10px"><tr>';
    h += '<th class="al">Date</th><th class="al">Type</th><th class="ar">RVol</th><th class="ar">RFreq</th><th class="ar">Tick×</th><th class="ar">Chg</th>';
    h += '</tr></thead><tbody>';
    d.freq_analysis.recent.slice().reverse().forEach(function(ev) {
      var tColors = { block_trade: '#0ea5e9', retail_frenzy: '#f97316', smart_accum: '#22c55e', dry_up: '#6b7280' };
      var tLabels = { block_trade: 'Block', retail_frenzy: 'Retail', smart_accum: 'Smart', dry_up: 'Dry' };
      var tc = tColors[ev.type] || 'var(--t2)';
      var pCls = ev.priceChg > 0 ? 'up' : ev.priceChg < 0 ? 'dn' : '';
      h += '<tr>';
      h += '<td class="al" style="color:var(--t3);font-family:var(--fm)">' + ev.date.slice(5) + '</td>';
      h += '<td class="al" style="color:' + tc + ';font-weight:600">' + (tLabels[ev.type] || ev.type) + '</td>';
      h += '<td class="ar" style="font-family:var(--fm);color:' + (ev.relVol > 1.5 ? 'var(--am)' : 'var(--t2)') + '">' + ev.relVol + 'x</td>';
      h += '<td class="ar" style="font-family:var(--fm);color:' + (ev.relFreq > 1.5 ? 'var(--am)' : 'var(--t2)') + '">' + ev.relFreq + 'x</td>';
      h += '<td class="ar" style="font-family:var(--fm);color:' + (ev.tickRatio > 2 ? '#0ea5e9' : ev.tickRatio < 0.6 ? '#f97316' : 'var(--t2)') + '">' + ev.tickRatio + 'x</td>';
      h += '<td class="ar ' + pCls + '" style="font-family:var(--fm)">' + (ev.priceChg > 0 ? '+' : '') + ev.priceChg + '%</td>';
      h += '</tr>';
    });
    h += '</tbody></table>';
  } else {
    h += '<div style="font-size:11px;color:var(--t3);padding:10px 0">No events detected (20d)</div>';
  }
  h += '</div>';

  // ── Col 3: 5-Factor Score ──
  h += '<div style="padding:8px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px;overflow:hidden">';
  h += '<div style="font-size:10px;font-weight:700;color:var(--t1);margin-bottom:6px">5-FACTOR SCORE</div>';
  if (d.scoring) {
    var sc = d.scoring;
    h += '<div id="sd-radar-chart" style="width:100%;height:200px"></div>';
    // Score values — compact inline
    h += '<table class="bei-tbl" style="font-size:11px"><tbody>';
    [{ k: 'score_composite', l: 'Composite', c: 'var(--bl)', bold: true },
     { k: 'score_fundamental', l: 'Fundamental', c: '#22c55e' },
     { k: 'score_valuation', l: 'Valuation', c: '#0ea5e9' },
     { k: 'score_momentum', l: 'Momentum', c: '#f59e0b' },
     { k: 'score_demand', l: 'Demand', c: '#a855f7' },
     { k: 'score_foreign', l: 'Foreign', c: '#ef4444' }].forEach(function(f) {
      var val = Math.round(sc[f.k] || 0);
      var valColor = val >= 70 ? '#22c55e' : val <= 30 ? '#ef4444' : f.c;
      h += '<tr><td class="al" style="color:var(--t3);font-size:10px">' + f.l + '</td>';
      h += '<td class="ar" style="font-weight:' + (f.bold ? '800' : '700') + ';font-family:var(--fm);color:' + valColor + ';font-size:' + (f.bold ? '13px' : '11px') + '">' + val + '</td></tr>';
    });
    h += '</tbody></table>';
  } else {
    h += '<div style="font-size:11px;color:var(--t3);padding:10px 0">No scoring data</div>';
  }
  h += '</div>';

  h += '</div>'; // end 3-col grid

  // ═══ ROW 2: Foreign + Bid/Offer + Fundamentals ═══
  h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">';

  // Foreign flow
  var ff = d.foreign || {};
  h += '<div style="flex:1;min-width:280px;background:var(--bg1);border:1px solid var(--b1);border-radius:8px;padding:12px">';
  h += '<div style="font-size:10px;font-weight:700;color:var(--t1);margin-bottom:8px">FOREIGN FLOW</div>';
  h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">';
  h += sdFlowCard('5D Net', ff.fnet_5d);
  h += sdFlowCard('10D Net', ff.fnet_10d);
  h += sdFlowCard('20D Net', ff.fnet_20d);
  h += sdFlowCard('Total', ff.fnet_total);
  h += '</div>';
  if (ff.accum_streak > 0) h += '<div style="font-size:10px;color:var(--gn);font-weight:600;margin-bottom:6px">🔥 Accumulating ' + ff.accum_streak + ' consecutive days</div>';
  if (ff.distrib_streak > 0) h += '<div style="font-size:10px;color:var(--rd);font-weight:600;margin-bottom:6px">⚠ Distributing ' + ff.distrib_streak + ' consecutive days</div>';
  h += '<div id="sd-fnet-chart" style="width:100%;height:120px"></div>';
  h += '</div>';

  // Bid/Offer
  var bo = d.bid_offer || {};
  h += '<div style="flex:1;min-width:280px;background:var(--bg1);border:1px solid var(--b1);border-radius:8px;padding:12px">';
  h += '<div style="font-size:10px;font-weight:700;color:var(--t1);margin-bottom:8px">BID/OFFER ANALYSIS</div>';
  var avgR = bo.avg_ratio || 50;
  var boColor = avgR > 55 ? 'var(--gn)' : avgR < 45 ? 'var(--rd)' : 'var(--am)';
  h += '<div style="text-align:center;margin-bottom:8px"><div style="font-size:28px;font-weight:800;font-family:var(--fm);color:' + boColor + '">' + avgR.toFixed(1) + '%</div><div style="font-size:9px;color:var(--t3)">20D Avg Bid Ratio</div></div>';
  h += '<div id="sd-bo-chart" style="width:100%;height:120px"></div>';
  h += '</div>';

  // Fundamental snapshot
  if (d.fundamental) {
    var fu = d.fundamental;
    h += '<div style="flex:1;min-width:280px;background:var(--bg1);border:1px solid var(--b1);border-radius:8px;padding:12px">';
    h += '<div style="font-size:10px;font-weight:700;color:var(--t1);margin-bottom:10px">FUNDAMENTALS</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px">';
    [{ l: 'PER', v: fu.per ? fu.per.toFixed(2) : '—' }, { l: 'PBV', v: fu.pbv ? fu.pbv.toFixed(2) : '—' }, { l: 'ROE', v: fu.roe ? fu.roe.toFixed(1) + '%' : '—' }, { l: 'ROA', v: fu.roa ? fu.roa.toFixed(1) + '%' : '—' }, { l: 'DER', v: fu.der ? fu.der.toFixed(2) : '—' }, { l: 'NPM', v: fu.npm ? fu.npm.toFixed(1) + '%' : '—' }, { l: 'Mkt Cap', v: fu.mkt_cap ? fmtRp(fu.mkt_cap) : '—' }, { l: 'Sector', v: fu.sector || '—' }, { l: 'Industry', v: fu.industry || '—' }, { l: 'Revenue', v: fu.total_rev ? fmtRp(fu.total_rev) : '—' }].forEach(function(f) {
      h += '<div style="padding:5px 8px;background:var(--bgH);border-radius:4px"><span style="color:var(--t3);font-size:9px">' + f.l + '</span><div style="font-weight:600;font-size:12px;margin-top:1px">' + f.v + '</div></div>';
    });
    h += '</div></div>';
  }
  h += '</div>';

  // ═══ PHASE HISTORY TABLE ═══
  if (d.phases && d.phases.length) {
    h += '<div style="margin-bottom:12px">';
    h += '<div style="font-size:10px;font-weight:700;color:var(--t1);margin-bottom:6px">PHASE HISTORY</div>';
    h += '<div style="overflow-x:auto"><table class="bei-tbl" style="font-size:11px"><thead style="font-size:10px"><tr>';
    h += '<th class="al">Phase</th><th class="ar">Conf.</th><th class="al">Period</th><th class="ar">Days</th><th class="ar">Open→Close</th><th class="ar">Change</th><th class="ar">Avg Freq</th><th class="ar">F.Net</th>';
    h += '</tr></thead><tbody>';
    d.phases.slice().reverse().forEach(function(p) {
      var pc2 = PHASE_COLORS[p.phase] || PHASE_COLORS.accumulation;
      var conf = p.confidence || 50;
      var confColor = conf >= 75 ? 'var(--gn)' : conf >= 50 ? 'var(--am)' : 'var(--t3)';
      h += '<tr>';
      h += '<td class="al"><span style="padding:1px 6px;border-radius:3px;background:' + pc2.bg + ';color:' + pc2.color + ';font-weight:600;font-size:9px">' + pc2.label + '</span></td>';
      h += '<td class="ar" style="color:' + confColor + ';font-weight:600">' + conf + '%</td>';
      h += '<td class="al" style="font-family:var(--fm);font-size:9px">' + p.start + ' → ' + p.end + '</td>';
      h += '<td class="ar">' + p.days + '</td>';
      h += '<td class="ar" style="font-family:var(--fm)">' + (p.open || 0).toLocaleString() + ' → ' + (p.close || 0).toLocaleString() + '</td>';
      h += '<td class="ar ' + (p.change_pct > 0 ? 'up' : p.change_pct < 0 ? 'dn' : '') + '" style="font-weight:600">' + (p.change_pct > 0 ? '+' : '') + p.change_pct + '%</td>';
      h += '<td class="ar" style="font-family:var(--fm)">' + (p.avg_freq || 0).toLocaleString() + '</td>';
      h += '<td class="ar ' + (p.fnet > 0 ? 'up' : p.fnet < 0 ? 'dn' : '') + '">' + fmtRp(p.fnet) + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div></div>';
  }

  // Score history chart
  if (d.score_history && d.score_history.length >= 3) {
    h += '<div style="margin-bottom:12px">';
    h += '<div style="font-size:10px;font-weight:700;color:var(--t1);margin-bottom:4px">SCORE TREND</div>';
    h += '<div id="sd-score-chart" style="width:100%;height:470px"></div>';
    h += '</div>';
  }

  // ═══ 2-COL: Commentary (left) | News (right) — equal height, scrollable ═══
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;height:360px">';

  // Left: Commentary (scrollable)
  h += '<div style="overflow-y:auto;height:100%">' + commentaryHtml + '</div>';

  // Right: News (BEI Announcements + Google News, scrollable)
  h += '<div style="padding:10px;background:var(--bg1);border:1px solid var(--b1);border-radius:4px;overflow-y:auto;height:100%">';
  h += '<div style="font-size:10px;font-weight:700;color:var(--t1);margin-bottom:8px">NEWS & ANNOUNCEMENTS</div>';

  // BEI Announcements (already in data)
  if (d.announcements && d.announcements.length) {
    d.announcements.forEach(function(a) {
      var attList = [];
      try { attList = JSON.parse(a.attachments || '[]'); } catch(e) {}
      var pdfUrl = attList.length ? (attList[0].url || '') : '';
      if (pdfUrl && !pdfUrl.startsWith('http')) pdfUrl = 'https://www.idx.co.id' + pdfUrl;
      var clickable = pdfUrl ? ' onclick="window.open(\'' + esc(pdfUrl) + '\',\'_blank\')" style="cursor:pointer"' : '';
      h += '<div style="padding:5px 0;border-bottom:1px solid var(--b1)"' + clickable + '>';
      h += '<div style="font-size:11px;color:var(--t1);line-height:1.4">' + esc((a.title || '').substring(0, 100)) + (a.title && a.title.length > 100 ? '...' : '') + (pdfUrl ? ' <span style="color:var(--am);font-size:9px">📎</span>' : '') + '</div>';
      h += '<div style="font-size:9px;color:var(--t3);margin-top:1px"><span style="color:var(--gn)">BEI</span> · ' + esc(a.ann_date || '') + (a.subject ? ' · ' + esc(a.subject) : '') + '</div>';
      h += '</div>';
    });
  }

  // Google News placeholder — loaded async
  h += '<div id="sd-news-list"><div style="font-size:10px;color:var(--t3);padding:6px 0">Loading news...</div></div>';
  h += '</div>';

  h += '</div>'; // end 2-col

  body.innerHTML = h;

  // ═══ DEFERRED: Load Google News ═══
  sdLoadNews(d.code);

  // ═══ DEFERRED CHARTS ═══
  setTimeout(function() {
    sdDrawPriceChart(d);
    if (d.scoring) sdDrawRadar(d.scoring);
    if (d.chart) sdDrawFnetChart(d.chart);
    if (d.bid_offer && d.bid_offer.data) sdDrawBOChart(d.bid_offer.data);
    if (d.score_history && d.score_history.length >= 3) sdDrawScoreChart(d.score_history);
    // Force resize all charts after layout settles
    setTimeout(function() {
      if (typeof BL !== 'undefined' && BL._instances) {
        Object.keys(BL._instances).forEach(function(k) {
          var c = BL._instances[k];
          if (c && !c.isDisposed()) c.resize();
        });
      }
    }, 300);
  }, 100);
}

// ═══ HELPER CARDS ═══
function sdStatCard(label, value, cls) {
  var color = cls === 'up' ? 'var(--gn)' : cls === 'dn' ? 'var(--rd)' : cls === 'am' ? 'var(--am)' : 'var(--t1)';
  return '<div style="padding:12px;border-radius:8px;background:var(--bg1);border:1px solid var(--b1);text-align:center"><div style="font-size:9px;color:var(--t3);text-transform:uppercase;margin-bottom:2px">' + label + '</div><div style="font-size:17px;font-weight:700;font-family:var(--fm);color:' + color + '">' + value + '</div></div>';
}

function sdFlowCard(label, val) {
  var cls = val > 0 ? 'var(--gn)' : val < 0 ? 'var(--rd)' : 'var(--t2)';
  return '<div style="padding:6px 12px;border-radius:6px;background:var(--bgH);text-align:center;min-width:80px;flex:1"><div style="font-size:13px;font-weight:700;font-family:var(--fm);color:' + cls + '">' + fmtRp(val || 0) + '</div><div style="font-size:9px;color:var(--t3);margin-top:1px">' + label + '</div></div>';
}

// ═══ PRICE CHART — Candlestick + MA Ribbon + Phase Zones + Volume + AD Line ═══
function sdDrawPriceChart(d) {
  var el = $('sd-price-chart'); if (!el) return;
  var c = BL.init(el, 'sd-price'); if (!c) return;
  var chart = d.chart || [], adData = d.ad_line || [];
  var dates = chart.map(function(r) { return r.date; });
  var ohlc = chart.map(function(r) { return [r.open, r.close, r.low, r.high]; });
  var closes = chart.map(function(r) { return r.close; });
  var volumes = chart.map(function(r) { return r.volume || 0; });
  var adValues = adData.map(function(r) { return r.ad; });

  // ── Compute MAs from close data ──
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
  var ma5 = calcMALine(5);
  var ma10 = calcMALine(10);
  var ma20 = calcMALine(20);
  var ma50 = calcMALine(50);
  var ma200 = calcMALine(200);

  // ── Phase markAreas + labels ──
  var markAreas = [], markPoints = [];
  if (d.phases) {
    d.phases.forEach(function(p) {
      var pc2 = PHASE_COLORS[p.phase];
      if (!pc2) return;
      // Only show phases that overlap with chart data range
      var startIdx = dates.indexOf(p.start);
      var endIdx = dates.indexOf(p.end);
      if (startIdx < 0 && endIdx < 0) return;
      markAreas.push([{ xAxis: p.start, itemStyle: { color: pc2.bg } }, { xAxis: p.end }]);
      // Phase label at top of zone
      var labelDate = p.start;
      if (startIdx >= 0) labelDate = dates[Math.min(startIdx + Math.floor((endIdx - startIdx) / 2), dates.length - 1)] || p.start;
      var shortLabel = p.phase === 'accumulation' ? 'ACC' : p.phase === 'markup' ? 'MU' : p.phase === 'distribution' ? 'DIST' : 'MD';
      var conf = p.confidence || 50;
      markPoints.push({
        coord: [labelDate, null],
        symbol: 'none',
        label: {
          show: true,
          formatter: shortLabel + (conf >= 60 ? ' ' + conf + '%' : ''),
          position: 'top',
          fontSize: 8,
          fontWeight: 600,
          color: pc2.color,
          backgroundColor: pc2.bg,
          padding: [1, 4],
          borderRadius: 2
        }
      });
    });
  }

  // Fix markPoint coords — need Y value (use high of that date)
  markPoints.forEach(function(mp) {
    var idx = dates.indexOf(mp.coord[0]);
    if (idx >= 0 && ohlc[idx]) mp.coord[1] = ohlc[idx][3]; // high
  });

  // ── MA line definitions ──
  var maColors = { ma5: '#0ea5e9', ma10: '#22c55e', ma20: '#f59e0b', ma50: '#ef4444', ma200: '#a855f7' };
  var maWidths = { ma5: 1, ma10: 1, ma20: 1.5, ma50: 1.5, ma200: 2 };

  function maSeriesDef(name, data, color, width) {
    return {
      name: name, type: 'line', data: data, xAxisIndex: 0, yAxisIndex: 0,
      symbol: 'none', lineStyle: { width: width, color: color, opacity: 0.8 },
      itemStyle: { color: color }, connectNulls: true, silent: true, z: 1
    };
  }

  var maSeries = [
    maSeriesDef('MA5', ma5, maColors.ma5, maWidths.ma5),
    maSeriesDef('MA10', ma10, maColors.ma10, maWidths.ma10),
    maSeriesDef('MA20', ma20, maColors.ma20, maWidths.ma20),
    maSeriesDef('MA50', ma50, maColors.ma50, maWidths.ma50),
    maSeriesDef('MA200', ma200, maColors.ma200, maWidths.ma200)
  ];

  // ── Chart layout: 4 grids (price 45%, volume 12%, AD 15%, Freq Analyzer 15%) ──
  var zS = Math.max(0, 100 - Math.min(100, 250 / dates.length * 100));

  // Compute Vol/Freq (average lot size per transaction)
  var freqs = chart.map(function(r) { return r.frequency || 0; });
  var volFreq = chart.map(function(r, i) {
    var f = r.frequency || 0;
    return f > 0 ? Math.round(r.volume / f) : 0;
  });
  // Compute 20-day average of vol/freq for coloring
  var vfAvg20 = [];
  for (var vfi = 0; vfi < volFreq.length; vfi++) {
    if (vfi < 19) { vfAvg20.push(volFreq[vfi]); continue; }
    var vfSum = 0;
    for (var vfj = vfi - 19; vfj <= vfi; vfj++) vfSum += volFreq[vfj];
    vfAvg20.push(vfSum / 20);
  }
  var vfBarData = volFreq.map(function(v, i) {
    var avg = vfAvg20[i] || 1;
    var ratio = v / avg;
    // Green = big lots (institutional), Red = small lots (retail), neutral = normal
    var color = ratio >= 1.5 ? 'rgba(38,166,154,0.7)' : ratio <= 0.6 ? 'rgba(239,83,80,0.7)' : 'rgba(120,120,140,0.4)';
    return { value: v, itemStyle: { color: color } };
  });

  c.setOption({
    tooltip: {
      trigger: 'axis', textStyle: { fontSize: 10 },
      formatter: function(params) {
        if (!params || !params.length) return '';
        var d = params[0].axisValue;
        var h = '<div style="font-size:10px;color:#888;margin-bottom:3px">' + d + '</div>';
        params.forEach(function(p) {
          if (p.seriesType === 'candlestick' && p.data) {
            h += '<div style="font-size:10px">O:' + (p.data[1]||0).toLocaleString() + ' H:' + (p.data[4]||0).toLocaleString() + ' L:' + (p.data[3]||0).toLocaleString() + ' C:' + (p.data[2]||0).toLocaleString() + '</div>';
          } else if (p.seriesName && p.seriesName.indexOf('MA') === 0 && p.value != null) {
            h += '<div style="font-size:9px;color:' + p.color + '">' + p.seriesName + ': ' + p.value.toLocaleString() + '</div>';
          } else if (p.seriesName === 'Vol/Freq' && p.value != null) {
            h += '<div style="font-size:9px;color:#26C6DA">Lot Size: ' + p.value.toLocaleString() + '</div>';
          }
        });
        return h;
      }
    },
    legend: { top: 0, right: 10, textStyle: { fontSize: 8 }, itemWidth: 12, itemHeight: 2, data: ['MA5', 'MA10', 'MA20', 'MA50', 'MA200'] },
    grid: [
      { left: 55, right: 55, top: 22, bottom: '45%' },   // price
      { left: 55, right: 55, top: '57%', bottom: '32%' }, // volume
      { left: 55, right: 55, top: '70%', bottom: '17%' }, // AD line
      { left: 55, right: 55, top: '85%', bottom: 30 }     // freq analyzer
    ],
    xAxis: [
      { type: 'category', data: dates, gridIndex: 0, show: false },
      { type: 'category', data: dates, gridIndex: 1, show: false },
      { type: 'category', data: dates, gridIndex: 2, show: false },
      { type: 'category', data: dates, gridIndex: 3, axisLabel: { fontSize: 7, formatter: function(v) { return v.substring(5); } } }
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, scale: true, position: 'right', axisLabel: { fontSize: 8 }, splitLine: { lineStyle: { color: '#1e2836', type: 'dashed' } } },
      { type: 'value', gridIndex: 1, scale: false, position: 'right', axisLabel: { fontSize: 7, formatter: function(v) { return BL.fmtRp(v); } }, splitLine: { lineStyle: { color: '#1e2836' } } },
      { type: 'value', gridIndex: 2, scale: true, position: 'right', axisLabel: { fontSize: 7, formatter: function(v) { return BL.fmtRp(v); } }, splitLine: { lineStyle: { color: '#1e2836' } } },
      { type: 'value', gridIndex: 3, scale: false, position: 'right', axisLabel: { fontSize: 7, formatter: function(v) { return v >= 1000 ? (v/1000).toFixed(0) + 'K' : v; } }, splitLine: { lineStyle: { color: '#1e2836' } }, name: 'Vol/Freq', nameTextStyle: { fontSize: 7, color: '#6b7a8d', padding: [0,0,0,-30] } }
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2, 3], start: zS, end: 100 },
      { type: 'slider', xAxisIndex: [0, 1, 2, 3], height: 14, bottom: 2, borderColor: '#2a3444', fillerColor: 'rgba(84,112,198,0.15)', textStyle: { fontSize: 7, color: '#6b7a8d' } }
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    series: [
      // Candlestick + phase zones + phase labels
      {
        type: 'candlestick', data: ohlc, xAxisIndex: 0, yAxisIndex: 0, z: 2,
        itemStyle: { color: '#26A69A', color0: '#EF5350', borderColor: '#26A69A', borderColor0: '#EF5350' },
        markArea: { silent: true, data: markAreas },
        markPoint: { data: markPoints, silent: true }
      },
      // MA Ribbon
      maSeries[0], maSeries[1], maSeries[2], maSeries[3], maSeries[4],
      // Volume bars
      {
        type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barMaxWidth: 4, silent: true, name: 'Volume',
        data: volumes.map(function(v, i) {
          return { value: v, itemStyle: { color: ohlc[i] && ohlc[i][1] >= ohlc[i][0] ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)' } };
        })
      },
      // AD Line
      {
        type: 'line', data: adValues, xAxisIndex: 2, yAxisIndex: 2,
        symbol: 'none', lineStyle: { width: 1.5, color: '#26C6DA' }, name: 'AD Line',
        areaStyle: { color: 'rgba(38,198,218,0.06)' }
      },
      // Frequency Analyzer (Vol/Freq = avg lot size)
      {
        type: 'bar', xAxisIndex: 3, yAxisIndex: 3, barMaxWidth: 4, silent: true, name: 'Vol/Freq',
        data: vfBarData
      }
    ]
  }, true);
}

// ═══ RADAR CHART ═══
function sdDrawRadar(sc) {
  var el = $('sd-radar-chart'); if (!el) return;
  var c = BL.init(el, 'sd-radar'); if (!c) return;
  c.setOption({
    radar: {
      indicator: [
        { name: 'Fund', max: 100 }, { name: 'Value', max: 100 }, { name: 'Mom', max: 100 },
        { name: 'Demand', max: 100 }, { name: 'Foreign', max: 100 }
      ],
      radius: '65%', center: ['50%', '55%'],
      axisName: { fontSize: 9, color: '#8a9bb5' },
      splitArea: { areaStyle: { color: ['rgba(84,112,198,0.02)', 'rgba(84,112,198,0.04)'] } },
      splitLine: { lineStyle: { color: '#1e2836' } },
      axisLine: { lineStyle: { color: '#2a3444' } }
    },
    series: [{
      type: 'radar',
      data: [{
        value: [sc.score_fundamental || 0, sc.score_valuation || 0, sc.score_momentum || 0, sc.score_demand || 0, sc.score_foreign || 0],
        name: 'Score',
        areaStyle: { color: 'rgba(255,152,0,0.15)' },
        lineStyle: { color: '#ff9800', width: 2 },
        itemStyle: { color: '#ff9800' }
      }]
    }]
  }, true);
}

// ═══ FOREIGN FLOW BAR CHART ═══
function sdDrawFnetChart(chartData) {
  var el = $('sd-fnet-chart'); if (!el) return;
  var c = BL.init(el, 'sd-fnet'); if (!c) return;
  var last20 = chartData.slice(-20);
  c.setOption({
    grid: { left: 45, right: 10, top: 8, bottom: 20 },
    tooltip: { trigger: 'axis', textStyle: { fontSize: 10 }, formatter: function(p) { if (!p || !p.length) return ''; return '<div style="font-size:10px">' + p[0].axisValue + '<br>F.Net: <b>' + BL.fmtRp(p[0].value) + '</b></div>'; } },
    xAxis: { type: 'category', data: last20.map(function(r) { return r.date; }), axisLabel: { fontSize: 7, formatter: function(v) { return v.substring(8); } } },
    yAxis: { type: 'value', axisLabel: { fontSize: 7, formatter: function(v) { return BL.fmtRp(v); } }, splitLine: { lineStyle: { color: '#1e2836' } } },
    series: [{
      type: 'bar', barMaxWidth: 14,
      data: last20.map(function(r) {
        var v = r.fnet || 0;
        return { value: v, itemStyle: { color: v >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)' } };
      })
    }]
  }, true);
}

// ═══ BID/OFFER CHART ═══
function sdDrawBOChart(boData) {
  var el = $('sd-bo-chart'); if (!el) return;
  var c = BL.init(el, 'sd-bo'); if (!c) return;
  c.setOption({
    grid: { left: 35, right: 10, top: 8, bottom: 20 },
    xAxis: { type: 'category', data: boData.map(function(r) { return r.date; }), axisLabel: { fontSize: 7, formatter: function(v) { return v.substring(8); } } },
    yAxis: { type: 'value', min: 20, max: 80, axisLabel: { fontSize: 7, formatter: function(v) { return v + '%'; } }, splitLine: { lineStyle: { color: '#1e2836' } } },
    series: [{
      type: 'bar', data: boData.map(function(r) {
        return { value: r.ratio, itemStyle: { color: r.ratio > 55 ? 'rgba(34,197,94,0.6)' : r.ratio < 45 ? 'rgba(239,68,68,0.6)' : 'rgba(255,152,0,0.4)' } };
      }), barMaxWidth: 12
    }, {
      type: 'line', data: boData.map(function() { return 50; }), symbol: 'none', lineStyle: { color: '#555', type: 'dashed', width: 1 }, silent: true
    }]
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
    legend: { top: 0, left: 0, textStyle: { fontSize: 8 } },
    grid: { left: 35, right: 10, top: 24, bottom: 20 },
    xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 7, formatter: function(v) { return v.substring(5); } } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { fontSize: 8 }, splitLine: { lineStyle: { color: '#1e2836' } } },
    series: factors.map(function(f) {
      return { name: f.l, type: 'line', data: hist.map(function(r) { return r[f.k] || 0; }), symbol: 'none', lineStyle: { width: f.w, color: f.c }, itemStyle: { color: f.c } };
    })
  }, true);
}

// ═══ STOCK COMMENTARY — auto-generated analysis ═══
function sdCommentary(d) {
  var cur = d.current || {}, phase = d.phase, vd = d.verdict || {}, stg = d.stage || {};
  var sc = d.scoring || {}, ff = d.foreign || {}, bo = d.bid_offer || {}, fu = d.fundamental || {};
  var st = d.stats || {};

  // ── Verdict Score (reuse from verdict) ──
  var vScore = vd.score || 50;
  var verdict, verdictColor, verdictIcon;
  if (vd.label === 'STRONG BUY') { verdict = 'STRONG BUY'; verdictColor = '#00cc66'; verdictIcon = '🟢'; }
  else if (vd.label === 'BUY') { verdict = 'BUY'; verdictColor = '#66bb6a'; verdictIcon = '🟢'; }
  else if (vd.label === 'NEUTRAL') { verdict = 'NEUTRAL'; verdictColor = '#e8a838'; verdictIcon = '🟡'; }
  else if (vd.label === 'SELL') { verdict = 'SELL'; verdictColor = '#ff8a65'; verdictIcon = '🟠'; }
  else if (vd.label === 'STRONG SELL') { verdict = 'STRONG SELL'; verdictColor = '#ef5350'; verdictIcon = '🔴'; }
  else { verdict = 'N/A'; verdictColor = 'var(--t3)'; verdictIcon = '⚪'; }

  var h = '<div style="background:var(--bg1);border:1px solid var(--b1);border-radius:8px;padding:12px 16px;margin-bottom:12px">';

  // Header
  h += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">';
  h += '<div style="font-size:11px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">📝 Analysis Commentary</div>';
  h += '<div style="padding:2px 10px;border-radius:4px;background:' + verdictColor + '22;border:1px solid ' + verdictColor + '44;font-size:11px;font-weight:700;color:' + verdictColor + '">' + verdictIcon + ' ' + verdict + '</div>';
  h += '<div style="font-size:9px;color:var(--t3)">(' + (vd.bull || 0) + '/' + (vd.total || 0) + ' signals bullish)</div>';
  h += '</div>';

  h += '<div style="font-size:11px;line-height:1.7;color:var(--t2)">';

  // ── 1. Phase & Trend ──
  var phaseItems = [];
  if (phase) {
    var pc = PHASE_COLORS[phase.phase] || {};
    var conf = phase.confidence || 50;
    phaseItems.push('Saham sedang dalam fase <b style="color:' + (pc.color || 'var(--t1)') + '">' + (pc.label || phase.phase) + '</b> selama ' + phase.days + ' hari (confidence ' + conf + '%)');

    if (phase.phase === 'accumulation') {
      if (conf >= 70) phaseItems.push('Confidence tinggi — ada indikasi smart money sedang akumulasi. Pantau breakout dari range');
      else phaseItems.push('Masih dalam fase sideways/basing. Belum ada konfirmasi kuat untuk entry');
    } else if (phase.phase === 'markup') {
      phaseItems.push('Trend naik aktif — momentum positif. Perhatikan apakah volume mengkonfirmasi rally');
    } else if (phase.phase === 'distribution') {
      if (conf >= 70) phaseItems.push('Hati-hati — distribusi aktif dengan confidence tinggi. Smart money kemungkinan sedang exit');
      else phaseItems.push('Ada tanda-tanda distribusi. Monitor volume dan foreign flow untuk konfirmasi');
    } else if (phase.phase === 'markdown') {
      phaseItems.push('Downtrend aktif — hindari catch falling knife kecuali ada sinyal reversal yang kuat');
    }
  }

  if (stg.level != null) {
    if (stg.level >= 4) phaseItems.push('MA Stage <b style="color:#22c55e">' + stg.level + '/5</b> — harga di atas mayoritas MA, struktur bullish');
    else if (stg.level >= 3) phaseItems.push('MA Stage <b>' + stg.level + '/5</b> — intermediate, belum fully bullish');
    else if (stg.level <= 1) phaseItems.push('MA Stage <b style="color:#ef4444">' + stg.level + '/5</b> — harga di bawah hampir semua MA, struktur bearish');
    else phaseItems.push('MA Stage <b>' + stg.level + '/5</b> — mixed signals');

    if (stg.bullish_stack) phaseItems.push('✓ MA bullish aligned (stacking) — strong uptrend confirmation');
    if (stg.bearish_stack) phaseItems.push('✕ MA bearish aligned — strong downtrend confirmation');
  }

  if (phaseItems.length) h += '<p style="margin:0 0 8px"><b>Trend:</b> ' + phaseItems.join('. ') + '.</p>';

  // ── 1b. MA Respect ──
  var mar = d.ma_respect;
  if (mar && mar.length) {
    var marItems = [];
    // Find best respect rate
    var best = null;
    mar.forEach(function(m) { if (!best || m.respect_rate > best.respect_rate) best = m; });
    if (best && best.respect_rate >= 55) {
      marItems.push('Historis paling respect <b style="color:var(--gn)">' + best.label + '</b> dengan bounce rate <b>' + best.respect_rate + '%</b> dari ' + best.touches + ' touch events');
    }
    // Check if near any respected MA now
    var nearAlert = mar.filter(function(m) { return m.near_now && m.respect_rate >= 55; });
    nearAlert.forEach(function(m) {
      marItems.push('⚡ Harga sekarang <b style="color:var(--am)">mendekati ' + m.label + '</b> (dist ' + (m.current_dist > 0 ? '+' : '') + m.current_dist + '%) — historis bounce ' + m.respect_rate + '% di level ini');
    });
    // Check if approaching a weak MA (likely to break)
    var nearWeak = mar.filter(function(m) { return m.near_now && m.respect_rate < 45; });
    nearWeak.forEach(function(m) {
      marItems.push('Harga mendekati ' + m.label + ' tapi <b style="color:var(--rd)">respect rate hanya ' + m.respect_rate + '%</b> — lebih sering breakdown daripada bounce');
    });
    if (marItems.length) h += '<p style="margin:0 0 8px"><b>MA Support:</b> ' + marItems.join('. ') + '.</p>';
  }

  // ── 2. Scoring & Quality ──
  var scoreItems = [];
  var comp = sc.score_composite || 0;
  if (comp >= 75) scoreItems.push('Composite score <b style="color:var(--gn)">' + Math.round(comp) + '</b> — kualitas sangat baik secara multi-factor');
  else if (comp >= 50) scoreItems.push('Composite score <b>' + Math.round(comp) + '</b> — kualitas moderate');
  else scoreItems.push('Composite score <b style="color:var(--rd)">' + Math.round(comp) + '</b> — di bawah rata-rata');

  // Highlight strongest and weakest factor
  var factors = [
    { k: 'score_fundamental', l: 'Fundamental' },
    { k: 'score_valuation', l: 'Valuation' },
    { k: 'score_momentum', l: 'Momentum' },
    { k: 'score_demand', l: 'Demand' },
    { k: 'score_foreign', l: 'Foreign SM' }
  ];
  var best = null, worst = null;
  factors.forEach(function(f) {
    var v = sc[f.k] || 0;
    if (!best || v > best.v) best = { l: f.l, v: v };
    if (!worst || v < worst.v) worst = { l: f.l, v: v };
  });
  if (best && worst && best.l !== worst.l) {
    scoreItems.push('Faktor terkuat: <b style="color:var(--gn)">' + best.l + ' (' + Math.round(best.v) + ')</b>, terlemah: <b style="color:var(--rd)">' + worst.l + ' (' + Math.round(worst.v) + ')</b>');
  }

  if (scoreItems.length) h += '<p style="margin:0 0 8px"><b>Score:</b> ' + scoreItems.join('. ') + '.</p>';

  // ── 3. Foreign Flow ──
  var flowItems = [];
  if (ff.fnet_10d != null || ff.fnet_20d != null) {
    var f10 = ff.fnet_10d || 0, f20 = ff.fnet_20d || 0;
    if (f10 > 0 && f20 > 0) flowItems.push('Foreign net <b style="color:var(--gn)">positif</b> baik 10D maupun 20D — asing sedang akumulasi');
    else if (f10 < 0 && f20 < 0) flowItems.push('Foreign net <b style="color:var(--rd)">negatif</b> 10D dan 20D — asing sedang distribusi');
    else if (f10 > 0 && f20 < 0) flowItems.push('Foreign mulai <b>berbalik positif</b> di 10 hari terakhir — potential trend change');
    else if (f10 < 0 && f20 > 0) flowItems.push('Foreign baru <b>berbalik negatif</b> setelah sebelumnya akumulasi — watch for continuation');
  }
  if (ff.accum_streak >= 5) flowItems.push('🔥 Foreign akumulasi <b style="color:var(--gn)">' + ff.accum_streak + ' hari berturut</b> — sinyal kuat');
  else if (ff.distrib_streak >= 5) flowItems.push('⚠ Foreign distribusi <b style="color:var(--rd)">' + ff.distrib_streak + ' hari berturut</b> — tekanan jual asing');

  if (flowItems.length) h += '<p style="margin:0 0 8px"><b>Foreign Flow:</b> ' + flowItems.join('. ') + '.</p>';

  // ── 4. Bid/Offer ──
  var boItems = [];
  var avgR = bo.avg_ratio || 0;
  if (avgR > 60) boItems.push('Bid ratio <b style="color:var(--gn)">' + avgR.toFixed(1) + '%</b> — buying pressure dominan');
  else if (avgR > 55) boItems.push('Bid ratio <b>' + avgR.toFixed(1) + '%</b> — slight buying edge');
  else if (avgR < 40) boItems.push('Bid ratio <b style="color:var(--rd)">' + avgR.toFixed(1) + '%</b> — selling pressure dominan');
  else if (avgR < 45) boItems.push('Bid ratio <b>' + avgR.toFixed(1) + '%</b> — slight selling pressure');

  if (boItems.length) h += '<p style="margin:0 0 8px"><b>Supply/Demand:</b> ' + boItems.join('. ') + '.</p>';

  // ── 5. Fundamental Snapshot ──
  var fundItems = [];
  if (fu.per && fu.per > 0) {
    if (fu.per < 10) fundItems.push('PER <b style="color:var(--gn)">' + fu.per.toFixed(1) + 'x</b> — valuasi murah');
    else if (fu.per < 20) fundItems.push('PER <b>' + fu.per.toFixed(1) + 'x</b> — valuasi wajar');
    else fundItems.push('PER <b style="color:var(--rd)">' + fu.per.toFixed(1) + 'x</b> — valuasi premium');
  }
  if (fu.roe) {
    if (fu.roe > 15) fundItems.push('ROE <b style="color:var(--gn)">' + fu.roe.toFixed(1) + '%</b> — profitabilitas baik');
    else if (fu.roe < 5) fundItems.push('ROE <b style="color:var(--rd)">' + fu.roe.toFixed(1) + '%</b> — profitabilitas rendah');
  }
  if (fu.der && fu.der > 2) fundItems.push('DER <b style="color:var(--rd)">' + fu.der.toFixed(2) + '</b> — leverage tinggi, risiko keuangan meningkat');
  if (fu.npm) {
    if (fu.npm > 20) fundItems.push('NPM <b style="color:var(--gn)">' + fu.npm.toFixed(1) + '%</b> — margin laba bersih sangat baik');
    else if (fu.npm < 5 && fu.npm > 0) fundItems.push('NPM <b>' + fu.npm.toFixed(1) + '%</b> — margin tipis');
    else if (fu.npm < 0) fundItems.push('NPM <b style="color:var(--rd)">' + fu.npm.toFixed(1) + '%</b> — perusahaan merugi');
  }

  if (fundItems.length) h += '<p style="margin:0 0 8px"><b>Fundamental:</b> ' + fundItems.join('. ') + '.</p>';

  // ── 6. Risk & Position ──
  var riskItems = [];
  if (st.drawdown_from_peak && st.drawdown_from_peak < -30) riskItems.push('Saham sudah turun <b style="color:var(--rd)">' + st.drawdown_from_peak + '%</b> dari 52W high — deep drawdown territory');
  else if (st.drawdown_from_peak && st.drawdown_from_peak < -15) riskItems.push('Koreksi <b>' + st.drawdown_from_peak + '%</b> dari 52W high');
  else if (st.drawdown_from_peak && st.drawdown_from_peak > -5) riskItems.push('Dekat <b style="color:var(--gn)">52W high</b> — hanya ' + st.drawdown_from_peak + '% dari peak');

  if (st.volatility_ann && st.volatility_ann > 60) riskItems.push('Volatilitas annualized <b style="color:var(--rd)">' + st.volatility_ann.toFixed(0) + '%</b> sangat tinggi — position sizing harus konservatif');
  else if (st.volatility_ann && st.volatility_ann > 40) riskItems.push('Volatilitas <b>' + st.volatility_ann.toFixed(0) + '%</b> — moderate-high');

  if (st.rs_vs_ihsg != null) {
    if (st.rs_vs_ihsg > 10) riskItems.push('Relative strength vs IHSG <b style="color:var(--gn)">+' + st.rs_vs_ihsg + '%</b> — outperform market');
    else if (st.rs_vs_ihsg < -10) riskItems.push('Relative strength vs IHSG <b style="color:var(--rd)">' + st.rs_vs_ihsg + '%</b> — underperform market');
  }

  if (riskItems.length) h += '<p style="margin:0 0 8px"><b>Risk:</b> ' + riskItems.join('. ') + '.</p>';

  // ── 7. Market Regime ──
  var mr = d.market_regime;
  if (mr) {
    var mrItems = [];
    var regimeLabel = mr.regime === 'bull' ? '<b style="color:var(--gn)">Bullish</b>' :
                      mr.regime === 'bear' ? '<b style="color:var(--rd)">Bearish</b>' :
                      mr.regime === 'mild_bull' ? '<b style="color:var(--gn)">Mild Bullish</b>' :
                      mr.regime === 'mild_bear' ? '<b style="color:var(--rd)">Mild Bearish</b>' : '<b>Sideways</b>';
    mrItems.push('IHSG di level ' + (mr.level || 0).toLocaleString() + ' — regime ' + regimeLabel);
    mrItems.push('Performa 5D: <b>' + (mr.chg_5d > 0 ? '+' : '') + mr.chg_5d + '%</b>, 20D: <b>' + (mr.chg_20d > 0 ? '+' : '') + mr.chg_20d + '%</b>');
    if (mr.regime === 'bear' || mr.regime === 'mild_bear') mrItems.push('Kondisi pasar negatif — lebih selektif, kurangi agresivitas');
    else if (mr.regime === 'bull') mrItems.push('Kondisi pasar mendukung — risk appetite tinggi');
    h += '<p style="margin:0 0 8px"><b>Market:</b> ' + mrItems.join('. ') + '.</p>';
  }

  // ── 8. Sector Context (enhanced) ──
  var sec = d.sector_context;
  if (sec) {
    var secItems = [];
    secItems.push('Sektor <b>' + esc(sec.sector) + '</b>');
    if (sec.fnet_20d > 0) secItems.push('foreign net 20D <b style="color:var(--gn)">positif</b> — asing sedang masuk ke sektor ini');
    else if (sec.fnet_20d < 0) secItems.push('foreign net 20D <b style="color:var(--rd)">negatif</b> — asing sedang keluar dari sektor ini');
    else secItems.push('foreign flow sektor netral');
    h += '<p style="margin:0 0 8px"><b>Sector:</b> ' + secItems.join('. ') + '.</p>';
  }

  // ── 9. Commodity Context ──
  var cmd = d.commodity_context;
  if (cmd) {
    var cmdItems = [];
    cmdItems.push(esc(cmd.label) + ' di level <b>' + (cmd.price || 0).toLocaleString() + '</b>');
    var cmdDir5 = cmd.chg_5d > 2 ? '<b style="color:var(--gn)">naik +' + cmd.chg_5d + '%</b>' : cmd.chg_5d < -2 ? '<b style="color:var(--rd)">turun ' + cmd.chg_5d + '%</b>' : 'relatif flat (' + (cmd.chg_5d > 0 ? '+' : '') + cmd.chg_5d + '%)';
    cmdItems.push('5D: ' + cmdDir5);
    if (cmd.chg_20d > 5) cmdItems.push('Trend 20D <b style="color:var(--gn)">naik +' + cmd.chg_20d + '%</b> — tailwind untuk saham ini');
    else if (cmd.chg_20d < -5) cmdItems.push('Trend 20D <b style="color:var(--rd)">turun ' + cmd.chg_20d + '%</b> — headwind untuk saham ini');
    h += '<p style="margin:0 0 8px"><b>Commodity:</b> ' + cmdItems.join('. ') + '.</p>';
  }

  // ── 10. Recent Announcements ──
  var ann = d.announcements;
  if (ann && ann.length) {
    var annItems = [];
    ann.slice(0, 3).forEach(function(a) {
      annItems.push('<span style="color:var(--t3)">' + esc(a.ann_date || '') + '</span> ' + esc((a.title || '').substring(0, 80)) + (a.title && a.title.length > 80 ? '...' : ''));
    });
    h += '<p style="margin:0 0 8px"><b>News:</b> ' + annItems.join(' · ') + '.</p>';
  }

  // ── Actionable Summary ──
  var summary = '';
  if (phase && stg.level != null) {
    if (phase.phase === 'accumulation' && stg.level >= 3 && (ff.fnet_10d || 0) > 0) {
      summary = '✅ <b style="color:var(--gn)">Potensi entry</b> — fase akumulasi dengan MA structure improving dan foreign akumulasi. Tunggu konfirmasi breakout volume untuk timing.';
    } else if (phase.phase === 'accumulation' && stg.level <= 2) {
      summary = '⏳ <b>Wait & see</b> — fase akumulasi tapi harga masih di bawah MA kunci. Tunggu MA stage improve ke 3+ sebelum entry.';
    } else if (phase.phase === 'markup' && stg.level >= 4) {
      summary = '🚀 <b style="color:var(--gn)">Uptrend aktif</b> — fase markup dengan MA bullish. Bisa hold/add on dip selama struktur MA intact.';
    } else if (phase.phase === 'markup' && (ff.fnet_10d || 0) < 0) {
      summary = '⚠ <b style="color:var(--am)">Caution</b> — fase markup tapi foreign sudah mulai distribusi. Potential divergence — siapkan exit plan.';
    } else if (phase.phase === 'distribution') {
      summary = '🔻 <b style="color:var(--rd)">Waspada distribusi</b> — smart money kemungkinan sedang exit. Kurangi posisi atau tighten stop loss.';
    } else if (phase.phase === 'markdown' && stg.level <= 1) {
      summary = '⛔ <b style="color:var(--rd)">Avoid</b> — downtrend aktif dengan MA bearish. Tunggu ada tanda accumulation sebelum mempertimbangkan entry.';
    } else if (phase.phase === 'markdown' && (ff.fnet_10d || 0) > 0) {
      summary = '👀 <b style="color:var(--am)">Watch for reversal</b> — masih markdown tapi foreign mulai masuk. Potential early accumulation — belum konfirm.';
    } else {
      summary = '📊 Sinyal mixed — tidak ada conviction kuat untuk action. Pantau perkembangan phase dan flow sebelum ambil keputusan.';
    }
  }

  if (summary) {
    // Append market regime caveat
    if (mr && (mr.regime === 'bear' || mr.regime === 'mild_bear') && summary.indexOf('Avoid') < 0) {
      summary += ' <span style="color:var(--am)">(Catatan: pasar sedang bearish — extra caution)</span>';
    }
    h += '<p style="margin:0;padding:8px 12px;background:rgba(84,112,198,0.06);border-radius:4px;border-left:3px solid var(--bl)"><b>Kesimpulan:</b> ' + summary + '</p>';
  }

  h += '</div></div>';
  return h;
}

// ═══ AUTOCOMPLETE — ticker search dropdown ═══
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
    var typeColor = item.type === 'index' ? 'var(--am)' : item.type === 'custom' ? 'var(--bl)' : 'var(--t3)';
    h += '<div class="sd-ac-item" data-idx="' + i + '" style="padding:6px 10px;cursor:pointer;background:' + bg + ';border-bottom:1px solid var(--b1);display:flex;align-items:center;gap:8px" onmouseenter="this.style.background=\'var(--bgH)\'" onmouseleave="this.style.background=\'' + bg + '\'" onclick="sdAcSelect(' + i + ')">';
    h += '<span style="font-weight:700;font-family:var(--fm);color:var(--bl);min-width:50px;font-size:12px">' + esc(item.code) + '</span>';
    h += '<span style="flex:1;font-size:11px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(item.name || '') + '</span>';
    h += '<span style="font-size:9px;color:' + typeColor + ';text-transform:uppercase">' + esc(item.type || '') + '</span>';
    h += '</div>';
  });
  dd.innerHTML = h;
  dd.style.display = 'block';
}

function sdAcSelect(idx) {
  var item = _sdAcItems[idx]; if (!item) return;
  var inp = $('sd-ticker-input'); if (inp) inp.value = item.code;
  sdAcHide();
  sdLoad();
}

function sdAcHide() {
  var dd = $('sd-ac-dropdown'); if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; }
  _sdAcIdx = -1; _sdAcItems = [];
}

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

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  if (!e.target.closest('#sd-ticker-input') && !e.target.closest('#sd-ac-dropdown')) sdAcHide();
});

// ═══ OPEN FROM GLOBAL SEARCH ═══
window.sdOpenTicker = function(code) {
  sdCode = code;
  // Switch to Analysis tab → Stock Detail sub-tab
  if (typeof stab === 'function') stab('analysis');
  if (typeof anaSubTab === 'function') {
    var btn = document.querySelector('.wt-b[onclick*="stockdetail"]');
    if (btn) anaSubTab('stockdetail', btn);
    else {
      // Fallback: directly set sub-tab
      document.querySelectorAll('#t-analysis .wp').forEach(function(p) { p.classList.remove('on'); });
      var panel = $('ana-stockdetail'); if (panel) panel.classList.add('on');
      document.querySelectorAll('#t-analysis .wt-b').forEach(function(b) { b.classList.toggle('on', b.textContent.indexOf('Stock Detail') >= 0); });
    }
  }
  loadStockDetail();
  setTimeout(sdLoad, 100);
};

// ═══ LOAD NEWS — Google News per ticker ═══
async function sdLoadNews(code) {
  var el = $('sd-news-list'); if (!el) return;
  try {
    var r = await fetch('/api/news?symbol=' + encodeURIComponent(code));
    var data = await r.json();
    if (!data || !data.length) { el.innerHTML = '<div style="font-size:10px;color:var(--t3)">No news found</div>'; return; }
    var h = '';
    data.slice(0, 10).forEach(function(n) {
      var url = n.url || n.link || '';
      var title = n.headline || n.title || '';
      var src = n.source || '';
      var dt = n.datetime ? new Date(n.datetime * 1000).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) : (n.date || '');
      if (!title) return;
      h += '<div style="padding:5px 0;border-bottom:1px solid var(--b1)">';
      if (url && url !== '#') {
        h += '<a href="' + esc(url) + '" target="_blank" rel="noopener" style="font-size:11px;color:var(--bl);text-decoration:none;line-height:1.4;display:block" onmouseover="this.style.color=\'var(--t1)\'" onmouseout="this.style.color=\'var(--bl)\'">' + esc(title.substring(0, 100)) + (title.length > 100 ? '...' : '') + ' ↗</a>';
      } else {
        h += '<div style="font-size:11px;color:var(--t1);line-height:1.4">' + esc(title.substring(0, 100)) + (title.length > 100 ? '...' : '') + '</div>';
      }
      h += '<div style="font-size:9px;color:var(--t3);margin-top:1px"><span style="color:var(--am)">News</span>' + (src ? ' · ' + esc(src) : '') + (dt ? ' · ' + dt : '') + '</div>';
      h += '</div>';
    });
    el.innerHTML = h || '<div style="font-size:10px;color:var(--t3)">No news found</div>';
  } catch (e) { el.innerHTML = '<div style="font-size:10px;color:var(--t3)">News unavailable</div>'; }
}
