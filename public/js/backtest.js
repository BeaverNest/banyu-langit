// ═══ BACKTEST UI V6 — public/js/backtest.js ═══
var btR=null,btRun=false,btShowT=false,btShowRef=false,btSort={col:'',dir:'desc'};
var btScopes={sectors:[],industries:[]};
var btMode='backtest'; // backtest | walkforward
var wfR=null,wfRunning=false;

function loadBacktest(){
  var el=$('bt-content');if(!el)return;
  fetch('/api/backtest/scopes').then(function(r){return r.json();}).then(function(d){btScopes=d||{};}).catch(function(){});
  if(btMode==='walkforward')renderWFForm(el);
  else renderBtForm(el);
}

function btSwitchMode(mode){
  btMode=mode;
  var el=$('bt-content');if(!el)return;
  if(mode==='walkforward')renderWFForm(el);
  else renderBtForm(el);
}

function renderBtForm(el){
  if(!el)el=$('bt-content');if(!el)return;
  var d=btR;var h='<div style="padding:12px">';

  // Mode tabs
  h+='<div style="display:flex;gap:4px;margin-bottom:8px">';
  h+='<button class="bei-tab'+(btMode==='backtest'?' on':'')+'" onclick="btSwitchMode(\'backtest\')" style="padding:5px 14px;font-size:12px">📊 Backtest</button>';
  h+='<button class="bei-tab'+(btMode==='walkforward'?' on':'')+'" onclick="btSwitchMode(\'walkforward\')" style="padding:5px 14px;font-size:12px">🔄 Walk Forward</button>';
  h+='</div>';

  // ── Formulas ──
  h+='<div style="display:flex;gap:10px;margin-bottom:6px;flex-wrap:wrap">';
  h+='<div style="flex:3;min-width:300px">';
  h+='<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--t3);margin-bottom:2px">Entry Formula</div>';
  h+='<textarea id="bt-ef" class="afl-textarea" style="min-height:36px;max-height:70px;font-size:12px" placeholder="C > MA20 AND Bullish_MACD">'+(d?esc(d.formula):'C > MA20 AND Bullish_MACD AND ForeignNet > 0')+'</textarea>';
  h+='<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:2px">';
  [['MA Cross','C > MA20 AND C > MA50 AND Bullish_MACD'],['Asing Akumulasi','Foreign_5D > 0 AND ForeignNet > 0 AND C > MA20'],['Oversold','K < 25 AND C > MA50 AND RelVol > 1.5'],['Breakout','C > HHV20 AND RelVol > 2 AND Chg > 1'],['Value','PER > 0 AND PER < 15 AND C > MA20']].forEach(function(t){
    h+='<button style="padding:1px 6px;border-radius:3px;border:1px solid var(--b2);background:none;color:var(--t3);font-size:8px;cursor:pointer;font-family:var(--f)" onclick="$(\'bt-ef\').value=\''+t[1].replace(/'/g,"\\'")+'\'">'+t[0]+'</button>';
  });
  h+='</div></div>';
  h+='<div style="flex:2;min-width:240px">';
  h+='<div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--t3);margin-bottom:2px">Exit Formula <span style="font-weight:400;letter-spacing:0;text-transform:none">(+PnlPct DaysHeld EntryPrice)</span></div>';
  h+='<textarea id="bt-xf" class="afl-textarea" style="min-height:36px;max-height:70px;font-size:12px" placeholder="Bearish_MACD OR DaysHeld >= 10">'+(d&&d.exit_formula?esc(d.exit_formula):'Bearish_MACD OR DaysHeld >= 10 OR PnlPct < -5')+'</textarea>';
  h+='</div></div>';

  // ── Params + Run (single row) ──
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px;align-items:end">';
  h+='<div><select id="bt-scope" style="width:85px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px;color:var(--t1);font-size:10px;outline:none" onchange="btScopeChg()"><option value="all">All Stocks</option><option value="stock"'+(d&&d.params.scope_type==='stock'?' selected':'')+'>Stock(s)</option><option value="sector"'+(d&&d.params.scope_type==='sector'?' selected':'')+'>Sector</option><option value="industry"'+(d&&d.params.scope_type==='industry'?' selected':'')+'>Industry</option><option value="score_top"'+(d&&d.params.scope_type==='score_top'?' selected':'')+'>📊 Top Score</option></select><div style="font-size:7px;color:var(--t3)">Scope</div></div>';
  // Scope value
  h+='<div style="position:relative;'+(d&&d.params.scope_type!=='all'?'':'display:none')+'" id="bt-sv-wrap"><input id="bt-sv" style="width:130px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px 6px;color:var(--t1);font-size:10px;font-family:var(--fm);outline:none;text-transform:uppercase" placeholder="BBCA,TLKM" value="'+(d?esc(d.params.scope_value||''):'')+ '" oninput="btAcScope()" onfocus="btAcScope()" autocomplete="off"><div id="bt-sv-ac" class="bt-ac-drop"></div><div style="font-size:7px;color:var(--t3)">Filter</div></div>';
  h+='<div><input id="bt-mp" type="number" value="'+(d?d.params.max_positions:5)+'" style="width:60px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px 6px;color:var(--t1);font-family:var(--fm);font-size:10px;outline:none;text-align:center"><div style="font-size:7px;color:var(--t3)">Pos</div></div>';
  h+='<div><input id="bt-cap" type="number" value="'+(d?d.stats.initial_capital:100000000)+'" style="width:95px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px 6px;color:var(--t1);font-family:var(--fm);font-size:10px;outline:none"><div style="font-size:7px;color:var(--t3)">Capital</div></div>';
  // Force cutloss
  var clOn=d&&d.params.force_cutloss;
  h+='<div><div style="display:flex;align-items:center;gap:2px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:3px 5px;height:22px"><input type="checkbox" id="bt-cl" '+(clOn?'checked':'')+' style="margin:0;width:13px;height:13px;cursor:pointer"><input id="bt-clp" type="number" value="'+(d&&d.params.cutloss_pct!=null?d.params.cutloss_pct:-10)+'" style="width:55px;background:transparent;border:none;color:var(--t1);font-family:var(--fm);font-size:10px;outline:none;text-align:center">%</div><div style="font-size:7px;color:var(--t3)">Cutloss</div></div>';
  // Risk Control
  var rcOn=d&&d.params.risk_control;
  h+='<div><div style="display:flex;align-items:center;gap:2px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:3px 5px;height:22px"><input type="checkbox" id="bt-rc" '+(rcOn?'checked':'')+' style="margin:0;width:13px;height:13px;cursor:pointer" onclick="var p=document.getElementById(\'bt-rc-params\');if(p)p.style.display=this.checked?\'flex\':\'none\'"></div><div style="font-size:7px;color:var(--t3)">Risk Ctrl</div></div>';
  h+='<div id="bt-rc-params" style="display:'+(rcOn?'flex':'none')+';gap:6px;align-items:end;flex-wrap:wrap">';
  h+='<div><input id="bt-rc-dd" type="number" value="'+(d&&d.params.rc_dd_freeze!=null?d.params.rc_dd_freeze:-10)+'" style="width:60px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px 6px;color:var(--t1);font-family:var(--fm);font-size:10px;outline:none;text-align:center">%<div style="font-size:7px;color:var(--t3)">DD Freeze</div></div>';
  h+='<div><input id="bt-rc-cl" type="number" value="'+(d&&d.params.rc_cl_freeze||3)+'" style="width:60px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px 6px;color:var(--t1);font-family:var(--fm);font-size:10px;outline:none;text-align:center"><div style="font-size:7px;color:var(--t3)">CL Freeze</div></div>';
  h+='<div><input id="bt-rc-cd" type="number" value="'+(d&&d.params.rc_cooldown||10)+'" style="width:60px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px 6px;color:var(--t1);font-family:var(--fm);font-size:10px;outline:none;text-align:center"> days<div style="font-size:7px;color:var(--t3)">Cooldown</div></div>';
  h+='<div><input id="bt-rc-pb" type="number" value="'+(d&&d.params.rc_probe_pos||1)+'" style="width:60px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px 6px;color:var(--t1);font-family:var(--fm);font-size:10px;outline:none;text-align:center"> pos<div style="font-size:7px;color:var(--t3)">Probe</div></div>';
  var lqOn=d&&d.params.rc_liquidate;
  h+='<div><div style="display:flex;align-items:center;gap:3px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px 6px;height:22px"><input type="checkbox" id="bt-rc-lq" '+(lqOn?'checked':'')+' style="margin:0;width:13px;height:13px;cursor:pointer"><span style="font-size:9px;color:var(--t2)">Liquidate</span></div><div style="font-size:7px;color:var(--t3)">On Freeze</div></div>';
  h+='</div>';
  // Benchmark
  h+='<div style="position:relative"><input id="bt-bm" style="width:100px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px 6px;color:var(--t1);font-family:var(--fm);font-size:10px;outline:none;text-transform:uppercase" value="'+(d?d.benchmark:'COMPOSITE')+'" oninput="btAcBench()" onfocus="btAcBench()" autocomplete="off"><div id="bt-bm-ac" class="bt-ac-drop"></div><div style="font-size:7px;color:var(--t3)">Benchmark</div></div>';
  h+='<div><input id="bt-sd" type="date" style="width:115px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px;color:var(--t1);font-size:10px;outline:none" value="'+(d?d.period.start:'')+'"><div style="font-size:7px;color:var(--t3)">From</div></div>';
  h+='<div><input id="bt-ed" type="date" style="width:115px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px;color:var(--t1);font-size:10px;outline:none" value="'+(d?d.period.end:'')+'"><div style="font-size:7px;color:var(--t3)">To</div></div>';
  h+='<div style="flex:1"></div>';
  h+='<button onclick="btTogRef()" id="bt-ref-btn" style="padding:5px 8px;border-radius:6px;border:1px solid var(--b2);background:'+(btShowRef?'var(--blB)':'none')+';color:'+(btShowRef?'var(--bl)':'var(--t3)')+';font-size:11px;cursor:pointer" title="Variable Reference">📖</button>';
  h+='<button id="bt-rb" onclick="runBt()" style="padding:5px 20px;border-radius:6px;border:none;background:var(--bl);color:#fff;font-weight:700;font-size:12px;cursor:pointer">▶ Run</button>';
  h+='</div>';

  // ── Reference (collapsible) ──
  h+='<div id="bt-ref" style="'+(btShowRef?'':'display:none')+';background:var(--bgH);border:1px solid var(--b1);border-radius:6px;padding:6px 10px;margin:4px 0 6px">';
  var refs=[
    ['Price','C|Close price,O|Open,H|High,L|Low,Chg|Change %'],
    ['Volume','V|Volume shares,Val|Value Rp,Freq|Frequency,DVMil|Value millions,RelVol|Vs 20d avg,RelFreq|Freq vs avg'],
    ['MA','MA3|3-day,MA5|5-day,MA10|10-day,MA20|20-day,MA30|30-day,MA50|50-day,MA100|100-day,MA200|200-day'],
    ['Dist%','DistMA3|% from MA3,DistMA5|% from MA5,DistMA10|% from MA10,DistMA20|% from MA20,DistMA30|% from MA30,DistMA50|% from MA50,DistMA100|% from MA100,DistMA200|% from MA200'],
    ['Position','Up_MA5|Above MA5,Up_MA10|Above MA10,Up_MA20|Above MA20,Up_MA50|Above MA50,Up_MA100|Above MA100,Up_MA200|Above MA200,MA_Above|Stage 0-5,MA_Aligned|Bullish stack'],
    ['Trend','ShortTrend|C>MA10+20,Intermediate|C>MA20+50,LongTrend|C>MA20+50+200'],
    ['Pattern','isBase|Base formation,isNearLow|Near 20d low,isBreakout|Above 20d high'],
    ['MACD','MACD|MACD line,Signal|Signal line,MACD_Hist|Histogram,Bullish_MACD|Bullish,BullishWeak_MACD|Weak bull,Bearish_MACD|Bearish,BearishWeak_MACD|Weak bear,MACDCross|Golden cross,MACDDeathCross|Death cross,MACD_Status|-2~2'],
    ['Stoch','K|%K,D|%D,StochCrossUp|K cross D up,StochTrend|K>D'],
    ['Bid/Offer','BidVol|Bid volume,OfferVol|Offer volume,BidRatio|Bid % ratio'],
    ['Foreign','ForeignNet|Net Rp,ForeignBuy|Buy Rp,ForeignSell|Sell Rp,Foreign_5D|5d net,Foreign_10D|10d net,Foreign_20D|20d net,F0|Today,F1|Yesterday,F2|2d ago,F3|3d ago,F4|4d ago'],
    ['Scoring','Score|Composite 0-100,ScoreFund|Fundamental,ScoreVal|Valuation,ScoreMom|Momentum,ScoreDemand|Demand,ScoreForeign|Foreign SM'],
    ['Freq','TickRatio|Val/tx vs avg,isBlockTrade|Block trade,isRetailFrenzy|Retail frenzy,isSmartAccum|Smart accumulation,isDryUp|Volume dry up,RelFreq|Freq vs 20d avg'],
    ['Range','HHV20|20d high,LLV20|20d low,HHV_C20|20d close high,LLV_C20|20d close low,PrevHHV20|Yesterday HHV20'],
    ['Fund','PER|P/E ratio,PBV|P/B ratio,ROE|Return on equity,ROA|Return on assets,NPM|Net profit margin,DER|Debt/equity,MktCap|Market cap'],
    ['Exit','PnlPct|Current P&L %,DaysHeld|Bars held,EntryPrice|Entry price'],
  ];
  h+='<div style="display:flex;flex-wrap:wrap;gap:1px 14px">';
  refs.forEach(function(cat){
    h+='<div style="white-space:nowrap;line-height:1.8"><span style="font-weight:700;color:var(--t3);font-size:8px;text-transform:uppercase">'+cat[0]+': </span>';
    cat[1].split(',').forEach(function(item){
      var parts=item.split('|');
      h+='<span title="'+esc(parts[1]||'')+'" style="color:var(--bl);font-family:var(--fm);cursor:pointer;font-weight:600;font-size:10px;padding:0 1px" onclick="btIns(\''+parts[0]+'\')">'+parts[0]+'</span> ';
    });
    h+='</div>';
  });
  h+='</div></div>';

  h+='<div id="bt-st" style="font-size:10px;color:var(--t2);min-height:14px;margin-bottom:6px"></div>';
  h+='<div id="bt-res">';
  if(d&&!d.error)h+=renderBtR(d);
  else if(d&&d.error)h+='<div style="padding:12px;color:var(--rd)">❌ '+esc(d.error)+'</div>';
  h+='</div></div>';

  // Autocomplete dropdown CSS (inline)
  h+='<style>.bt-ac-drop{display:none;position:absolute;top:100%;left:0;width:200px;max-height:180px;overflow-y:auto;background:var(--bg2);border:1px solid var(--b2);border-radius:0 0 6px 6px;z-index:99;box-shadow:var(--sh)}.bt-ac-item{padding:5px 8px;cursor:pointer;font-size:10px;border-bottom:1px solid var(--b1);display:flex;justify-content:space-between;gap:6px}.bt-ac-item:hover{background:var(--bgH)}.bt-ac-item .ac-c{font-weight:600;font-family:var(--fm);color:var(--bl)}.bt-ac-item .ac-s{color:var(--t3);font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style>';

  el.innerHTML=h;
  if(d&&!d.error)btRenderCharts(d);
}

// ═══ AUTOCOMPLETE ═══
function btAcScope(){
  var inp=$('bt-sv'),ac=$('bt-sv-ac');if(!inp||!ac)return;
  var q=inp.value.trim().toUpperCase(),scope=$('bt-scope').value;
  if(scope==='stock'&&q.length>=1){
    // Extract last ticker being typed (after last comma)
    var parts=q.split(',');var last=parts[parts.length-1].trim();
    if(last.length<1){ac.style.display='none';return;}
    fetch('/api/search?q='+encodeURIComponent(last)).then(function(r){return r.json();}).then(function(d){
      btRenderAc(ac,d.map(function(r){return[r.code,r.name||''];}),function(v){
        parts[parts.length-1]=v;inp.value=parts.join(',');ac.style.display='none';inp.focus();
      });
    }).catch(function(){});
  }else if(scope==='sector'){
    var items=(btScopes.sectors||[]).filter(function(s){return!q||s.toUpperCase().indexOf(q)>=0;}).slice(0,12);
    btRenderAc(ac,items.map(function(s){return[s,'Sector'];}),function(v){inp.value=v;ac.style.display='none';});
  }else if(scope==='industry'){
    var items=(btScopes.industries||[]).filter(function(s){return!q||s.toUpperCase().indexOf(q)>=0;}).slice(0,12);
    btRenderAc(ac,items.map(function(s){return[s,'Industry'];}),function(v){inp.value=v;ac.style.display='none';});
  }else{ac.style.display='none';}
}

function btAcBench(){
  var inp=$('bt-bm'),ac=$('bt-bm-ac');if(!inp||!ac)return;
  var q=inp.value.trim().toUpperCase();
  var indices=['COMPOSITE','LQ45','IDX30','IDX80','IDXESGL','IDXQ30','IDXV30','IDXG30','IDXBUMN20','IDXHIDIV20','JII','ISSI','SRI-KEHATI'];
  var filtered=indices.filter(function(s){return!q||s.indexOf(q)>=0;}).map(function(s){return[s,'Index'];});
  if(q.length>=1){
    fetch('/api/search?q='+encodeURIComponent(q)).then(function(r){return r.json();}).then(function(d){
      var all=filtered.concat(d.slice(0,6).map(function(r){return[r.code,(r.name||'').substring(0,25)];}));
      btRenderAc(ac,all.slice(0,12),function(v){inp.value=v;ac.style.display='none';});
    }).catch(function(){});
  }else{
    btRenderAc(ac,filtered.slice(0,10),function(v){inp.value=v;ac.style.display='none';});
  }
}

// Render autocomplete items with WORKING click handlers
function btRenderAc(ac,items,onPick){
  if(!items.length){ac.style.display='none';return;}
  ac.innerHTML='';
  items.forEach(function(it){
    var div=document.createElement('div');
    div.className='bt-ac-item';
    div.innerHTML='<span class="ac-c">'+esc(it[0])+'</span><span class="ac-s">'+esc(it[1])+'</span>';
    div.addEventListener('mousedown',function(e){e.preventDefault();e.stopPropagation();onPick(it[0]);});
    ac.appendChild(div);
  });
  ac.style.display='block';
}

// Close autocomplete on blur
document.addEventListener('click',function(e){
  if(!e.target.closest('#bt-sv-wrap')){var a=$('bt-sv-ac');if(a)a.style.display='none';}
  if(!e.target.closest('#bt-bm')){var a=$('bt-bm-ac');if(a)a.style.display='none';}
});

function btScopeChg(){var v=$('bt-scope').value;var w=$('bt-sv-wrap');if(w)w.style.display=v==='all'?'none':'';var inp=$('bt-sv');if(inp){inp.value='';inp.placeholder=v==='stock'?'BBCA,TLKM':v==='sector'?'Type sector':v==='industry'?'Type industry':v==='score_top'?'20 (top N stocks)':'';}}
function btTogRef(){btShowRef=!btShowRef;var el=$('bt-ref'),btn=$('bt-ref-btn');if(el)el.style.display=btShowRef?'':'none';if(btn){btn.style.background=btShowRef?'var(--blB)':'none';btn.style.color=btShowRef?'var(--bl)':'var(--t3)';}}
function btIns(v){var el=$('bt-xf');if(document.activeElement===$('bt-ef'))el=$('bt-ef');if(!el)el=$('bt-ef');if(el){var s=el.selectionStart!=null?el.selectionStart:el.value.length;el.value=el.value.substring(0,s)+v+' '+el.value.substring(s);el.focus();}}

async function runBt(){
  if(btRun)return;btRun=true;
  var btn=$('bt-rb'),st=$('bt-st');
  if(btn){btn.textContent='⏳';btn.disabled=true;}if(st)st.textContent='Computing...';
  try{
    var r=await fetch('/api/backtest/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      formula:$('bt-ef').value.trim(),exit_formula:$('bt-xf').value.trim(),
      max_positions:parseInt($('bt-mp').value)||5,capital:parseFloat($('bt-cap').value)||100000000,
      force_cutloss:$('bt-cl')?$('bt-cl').checked:false,cutloss_pct:$('bt-clp')?parseFloat($('bt-clp').value)||-10:-10,
      risk_control:$('bt-rc')?$('bt-rc').checked:false,
      rc_dd_freeze:$('bt-rc-dd')?parseFloat($('bt-rc-dd').value)||-10:-10,
      rc_cl_freeze:$('bt-rc-cl')?parseInt($('bt-rc-cl').value)||3:3,
      rc_cooldown:$('bt-rc-cd')?parseInt($('bt-rc-cd').value)||10:10,
      rc_probe_pos:$('bt-rc-pb')?parseInt($('bt-rc-pb').value)||1:1,
      rc_liquidate:$('bt-rc-lq')?$('bt-rc-lq').checked:false,
      benchmark:$('bt-bm').value.trim()||'COMPOSITE',start_date:$('bt-sd').value||'',end_date:$('bt-ed').value||'',
      scope_type:$('bt-scope').value,scope_value:$('bt-sv')?$('bt-sv').value.trim():'',
    })});
    btR=await r.json();btShowT=false;btSort={col:'',dir:'desc'};
    if(st)st.textContent=btR.error?'❌ '+btR.error:'✅ '+(btR.compute_time/1000).toFixed(1)+'s · '+btR.stats.total_trades+' trades · '+btR.period.days+' days';
    var el=$('bt-res');if(el){el.innerHTML=btR.error?'':renderBtR(btR);if(!btR.error)btRenderCharts(btR);}
  }catch(e){if(st)st.textContent='❌ '+e.message;}
  btRun=false;if(btn){btn.textContent='▶ Run';btn.disabled=false;}
}

// ═══ RENDER RESULTS ═══
function renderBtR(d){
  var s=d.stats,h='';

  // ═══ SCORE vs BASELINE COMPARISON ═══
  if (d.baseline) {
    var b = d.baseline;
    var dRet = Math.round((s.total_return - b.total_return) * 100) / 100;
    var dWr = Math.round((s.win_rate - b.win_rate) * 10) / 10;
    var dPF = Math.round((s.profit_factor - b.profit_factor) * 100) / 100;
    var dDD = Math.round((b.max_drawdown - s.max_drawdown) * 100) / 100; // positive = score has less DD
    var dAvg = Math.round((s.avg_pl_pct - b.avg_pl_pct) * 100) / 100;
    var verdict = dRet > 0 ? '✅ Scoring adds +' + dRet + '% alpha over baseline' : '❌ Baseline outperforms by ' + Math.abs(dRet) + '%';
    var vClr = dRet > 0 ? 'var(--gn)' : 'var(--rd)';

    h += '<div style="margin-bottom:10px;border:1px solid var(--b2);border-radius:8px;overflow:hidden;background:var(--bg2)">';
    h += '<div style="padding:6px 12px;font-size:11px;font-weight:700;color:var(--t1);border-bottom:1px solid var(--b1);display:flex;align-items:center;gap:6px">📊 Score Universe vs All Stocks <span style="flex:1"></span><span style="font-size:10px;font-weight:400;color:' + vClr + '">' + verdict + '</span></div>';
    h += '<table style="width:100%;font-size:10px;border-collapse:collapse">';
    h += '<thead><tr><th style="padding:4px 8px;text-align:left;font-size:9px;color:var(--t3)">Metric</th><th style="padding:4px 8px;text-align:right;font-size:9px;color:var(--am)">📊 Top Score</th><th style="padding:4px 8px;text-align:right;font-size:9px;color:var(--t3)">📋 All Stocks</th><th style="padding:4px 8px;text-align:right;font-size:9px;color:var(--t3)">Δ Advantage</th></tr></thead><tbody>';

    function cmpRow(label, vScore, vBase, delta, higherBetter) {
      var clr = (higherBetter ? delta > 0 : delta < 0) ? 'color:var(--gn)' : delta === 0 ? '' : 'color:var(--rd)';
      var sign = delta > 0 ? '+' : '';
      return '<tr style="border-top:1px solid var(--b1)"><td style="padding:4px 8px;font-weight:600">' + label + '</td><td style="padding:4px 8px;text-align:right;font-family:var(--fm);color:var(--am);font-weight:600">' + vScore + '</td><td style="padding:4px 8px;text-align:right;font-family:var(--fm)">' + vBase + '</td><td style="padding:4px 8px;text-align:right;font-family:var(--fm);font-weight:600;' + clr + '">' + sign + delta + '</td></tr>';
    }

    h += cmpRow('Net Return', btP(s.total_return), btP(b.total_return), dRet + '%', true);
    h += cmpRow('Win Rate', s.win_rate + '%', b.win_rate + '%', dWr + '%', true);
    h += cmpRow('Profit Factor', s.profit_factor, b.profit_factor, dPF, true);
    h += cmpRow('Max Drawdown', '-' + s.max_drawdown + '%', '-' + b.max_drawdown + '%', dDD + '%', true);
    h += cmpRow('Avg P&L/Trade', btP(s.avg_pl_pct), btP(b.avg_pl_pct), dAvg + '%', true);
    h += cmpRow('Expectancy', btP(s.expectancy), btP(b.expectancy), Math.round((s.expectancy - b.expectancy) * 100) / 100 + '%', true);
    h += cmpRow('Total Trades', s.total_trades, b.total_trades, s.total_trades - b.total_trades, false);
    h += '</tbody></table></div>';
  }

  h+='<div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">';
  h+='<div style="min-width:260px;flex:0 0 260px"><div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;overflow:hidden">';
  h+=btSH('Performance');h+='<table style="width:100%;font-size:10px;border-collapse:collapse">';
  h+=btSR('Initial Capital',fmtRp(s.initial_capital),0);
  h+=btSR('Final Capital',fmtRp(s.final_equity),s.final_equity>=s.initial_capital?1:-1);
  h+=btSR('Net Profit',fmtRp(s.final_equity-s.initial_capital)+' ('+btP(s.total_return)+')',s.total_return);
  h+=btSR('Exposure',s.exposure+'%',0);
  h+=btSR('Annual Return',btP(s.annual_return),s.annual_return);
  h+=btSR('Risk Adj. Return',btP(s.rar),s.rar);
  h+=btSR(d.benchmark,btP(s.benchmark_return),s.benchmark_return);
  h+=btSR('Alpha',btP(s.alpha),s.alpha);h+='</table>';
  h+=btSH('Trades');h+='<table style="width:100%;font-size:10px;border-collapse:collapse">';
  h+=btSR('All Trades',s.total_trades,0);
  h+=btSR('Avg P&L',fmtRp(s.avg_pl)+' ('+s.avg_pl_pct+'%)',s.avg_pl_pct);
  h+=btSR('Avg Bars Held',s.avg_hold+' days',0);
  h+='</table>';
  h+=btSH('Winners');h+='<table style="width:100%;font-size:10px;border-collapse:collapse">';
  h+=btSR('Winners',s.wins_count+' ('+s.win_rate+'%)',s.win_rate>=50?1:-1);
  h+=btSR('Avg Profit','+'+s.avg_win+'%',1);
  h+=btSR('Avg Bars (win)',s.avg_hold_win+' days',0);
  h+=btSR('Max Consecutive',s.max_consec_wins,0);
  h+=btSR('Largest Win','+'+s.largest_win+'%',1);
  h+='</table>';
  h+=btSH('Losers');h+='<table style="width:100%;font-size:10px;border-collapse:collapse">';
  h+=btSR('Losers',s.losses_count+' ('+(100-s.win_rate).toFixed(1)+'%)',-1);
  h+=btSR('Avg Loss',s.avg_loss+'%',-1);
  h+=btSR('Avg Bars (loss)',s.avg_hold_loss+' days',0);
  h+=btSR('Max Consecutive',s.max_consec_losses,0);
  h+=btSR('Largest Loss',s.largest_loss+'%',-1);
  h+='</table>';
  h+=btSH('Risk Metrics');h+='<table style="width:100%;font-size:10px;border-collapse:collapse">';
  h+=btSR('Max System DD','-'+s.max_drawdown+'%',-1);
  h+=btSR('Max Trade DD',s.max_trade_dd_pct+'%',-1);
  h+=btSR('Recovery Factor',s.recovery_factor,s.recovery_factor>=1?1:-1);
  h+=btSR('CAR/MaxDD',s.car_maxdd.toFixed(2),s.car_maxdd>=1?1:-1);
  h+=btSR('RAR/MaxDD',(s.rar_maxdd||0).toFixed(2),(s.rar_maxdd||0)>=1?1:-1);
  h+=btSR('Profit Factor',s.profit_factor.toFixed(2),s.profit_factor>=1?1:-1);
  h+=btSR('Payoff Ratio',s.payoff_ratio.toFixed(2),s.payoff_ratio>=2?1:0);
  h+=btSR('Sharpe Ratio',s.sharpe.toFixed(2),s.sharpe>=1?1:s.sharpe<0?-1:0);
  h+=btSR('Expectancy',btP(s.expectancy),s.expectancy);
  h+='</table>';
  // Risk Control stats
  if(d.params&&d.params.risk_control&&d.params.rc_stats){
    var rc=d.params.rc_stats;
    h+='<div style="margin-top:4px;padding-top:4px;border-top:1px solid var(--b1)">';
    h+='<div style="font-size:8px;font-weight:700;color:var(--am);text-transform:uppercase;margin-bottom:2px">Risk Control</div>';
    h+='<table style="width:100%;font-size:10px;border-collapse:collapse">';
    h+=btSR('Freeze Events',rc.freeze_count,rc.freeze_count>0?-1:0);
    h+=btSR('Probe Events',rc.probe_count,0);
    h+=btSR('Final Mode',rc.final_mode,rc.final_mode==='normal'?1:rc.final_mode==='freeze'?-1:0);
    h+=btSR('Final CL Streak',rc.final_consec_loss,rc.final_consec_loss>=d.params.rc_cl_freeze?-1:0);
    h+='</table></div>';
  }
  h+='</div></div>';
  h+='<div style="flex:1;min-width:320px">';
  if(d.equity&&d.equity.length>2){h+='<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:8px;margin-bottom:6px"><div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:4px">Equity vs '+esc(d.benchmark)+'</div>'+btEqC(d.equity,s.initial_capital,d.benchmark)+'</div>';
    h+='<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:8px"><div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:4px">Drawdown</div>'+btDDC(d.equity)+'</div>';}
  h+='</div></div>';
  h+='<div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">';
  if(d.equity&&d.equity.length>20)h+='<div style="flex:1;min-width:320px">'+btMon(d.equity)+'</div>';
  if(d.trades&&d.trades.length>3)h+='<div style="flex:0 0 320px;min-width:280px">'+btDist(d.trades)+'</div>';
  if(d.trades&&d.trades.length>=5&&d.trades[0].mae!==undefined)h+='<div style="flex:0 0 320px;min-width:280px">'+btMAE(d.trades)+'</div>';
  h+='</div>';
  if(d.monte_carlo){h+=btMC(d.monte_carlo,s);if(d.monte_carlo.bands)h+=btMCChart(d.monte_carlo.bands,s.initial_capital);}
  if(d.by_ticker&&d.by_ticker.length)h+=btTK(d.by_ticker);
  // Open positions (floating)
  if(d.open_positions&&d.open_positions.length){
    h+='<div style="background:var(--bg2);border:1px solid var(--am);border-radius:8px;overflow:hidden;margin-bottom:10px">';
    h+=btSH('⏳ Open Positions ('+d.open_positions.length+')');
    h+='<table style="width:100%;font-size:10px;border-collapse:collapse"><thead><tr>';
    ['Ticker','Entry Date','Entry$','Current$','Unreal. P&L','%Chg','Shares','Pos.Val','Bars','MAE','MFE'].forEach(function(c){
      h+='<th style="padding:4px 6px;font-size:8px;color:var(--t3);border-bottom:1px solid var(--b1);text-align:'+(c==='Ticker'||c==='Entry Date'?'left':'right')+'">'+c+'</th>';
    });
    h+='</tr></thead><tbody>';
    d.open_positions.forEach(function(p){
      var cc=p.unrealized>0?'up':p.unrealized<0?'dn':'';
      h+='<tr>';
      h+='<td style="padding:3px 6px;border-bottom:1px solid var(--b1)"><span class="code" onclick="gsOpen(\''+esc(p.code)+'\')">'+esc(p.code)+'</span></td>';
      h+='<td style="padding:3px 6px;border-bottom:1px solid var(--b1);font-family:var(--fm)">'+p.ed+'</td>';
      h+='<td style="padding:3px 6px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm)">'+(p.ep||0).toLocaleString()+'</td>';
      h+='<td style="padding:3px 6px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm);font-weight:600">'+(p.current||0).toLocaleString()+'</td>';
      h+='<td class="'+cc+'" style="padding:3px 6px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm);font-weight:600">'+fmtRp(p.unrealized)+'</td>';
      h+='<td class="'+cc+'" style="padding:3px 6px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm)">'+(p.pnlP>0?'+':'')+p.pnlP+'%</td>';
      h+='<td style="padding:3px 6px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm)">'+(p.shares||0).toLocaleString()+'</td>';
      h+='<td style="padding:3px 6px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm)">'+fmtRp(p.pv)+'</td>';
      h+='<td style="padding:3px 6px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm)">'+p.bars+'</td>';
      h+='<td style="padding:3px 6px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm);color:var(--rd)">'+p.mae+'%</td>';
      h+='<td style="padding:3px 6px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm);color:var(--gn)">'+(p.mfe>0?'+':'')+p.mfe+'%</td>';
      h+='</tr>';
    });
    // Total unrealized
    var totUnreal=d.open_positions.reduce(function(s,p){return s+p.unrealized;},0);
    var totVal=d.open_positions.reduce(function(s,p){return s+p.pv;},0);
    h+='<tr style="font-weight:700;background:var(--bgH)"><td style="padding:4px 6px;border-bottom:1px solid var(--b1)" colspan="4">Total Open</td>';
    h+='<td class="'+(totUnreal>0?'up':totUnreal<0?'dn':'')+'" style="padding:4px 6px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm)">'+fmtRp(totUnreal)+'</td>';
    h+='<td style="padding:4px 6px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm);color:'+(totUnreal>0?'var(--gn)':totUnreal<0?'var(--rd)':'var(--t3)')+'">'+(totVal>0?((totUnreal/totVal*100).toFixed(2)+'%'):'')+'</td>';
    h+='<td colspan="5"></td></tr>';
    h+='</tbody></table></div>';
  }
  if(d.trades&&d.trades.length)h+=btTR(d.trades);
  h+='<div style="font-size:9px;color:var(--t3);margin-top:4px">'+d.period.start+' → '+d.period.end+' · '+d.period.days+'d · '+(d.compute_time/1000).toFixed(1)+'s</div>';
  return h;
}

function btP(v){return(v>0?'+':'')+v+'%';}
function btSH(t){return'<div style="padding:4px 10px;font-size:8px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--b1);border-top:1px solid var(--b1);background:var(--bgH)">'+t+'</div>';}
function btSR(l,v,d){var c=d>0?'var(--gn)':d<0?'var(--rd)':'var(--t1)';return'<tr><td style="padding:2px 10px;border-bottom:1px solid var(--b1);color:var(--t2);font-size:10px">'+l+'</td><td style="padding:2px 10px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm);font-weight:600;color:'+c+'">'+v+'</td></tr>';}
function btRI(r){return r==='exit_signal'?'<span style="color:var(--bl)">Signal</span>':r==='force_cutloss'?'<span style="color:var(--rd);font-weight:700">✂ CL</span>':r==='open'?'<span style="color:var(--am);font-weight:600">⏳ Open</span>':r==='end'?'<span style="color:var(--t3)">End</span>':r||'';}

// ═══ EQUITY (ECharts) ═══
function btEqC(data,ic,bn){return BL.container('bt-eq-chart',495);}
function btEqC_render(data,ic,bn){
  var el=$('bt-eq-chart');if(!el)return;
  var c=BL.init(el,'bt-eq');if(!c)return;
  var dates=data.map(function(d){return d.date;});
  var eq=data.map(function(d){return d.equity;});
  var bm=data.map(function(d){return d.benchmark||ic;});
  var isUp=eq[eq.length-1]>=ic;
  c.setOption({
    tooltip:{trigger:'axis',formatter:function(p){var d=p[0].axisValue;var h='<b>'+d+'</b>';p.forEach(function(s){h+='<br><span style="color:'+s.color+'">●</span> '+s.seriesName+': <b>'+BL.fmtRp(s.value)+'</b>';});return h;}},
    legend:{data:['Strategy',bn||'Bench'],top:2,left:8,textStyle:{fontSize:9}},
    grid:BL.grid({top:24,bottom:40}),
    dataZoom:BL.dataZoom(),
    xAxis:{type:'category',data:dates,axisLabel:{fontSize:7,formatter:function(v){return v.substring(2,7);}}},
    yAxis:{type:'value',scale:true,axisLabel:{fontSize:8,formatter:function(v){return BL.fmtRp(v);}}},
    series:[
      {name:'Strategy',type:'line',data:eq,symbol:'none',lineStyle:{width:1.5,color:isUp?BL.colors.green:BL.colors.red},areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:isUp?'rgba(34,197,94,0.12)':'rgba(239,68,68,0.12)'},{offset:1,color:'transparent'}]}},itemStyle:{color:isUp?BL.colors.green:BL.colors.red}},
      {name:bn||'Bench',type:'line',data:bm,symbol:'none',lineStyle:{width:0.8,color:BL.colors.textDim,type:'dashed'},itemStyle:{color:BL.colors.textDim}}
    ]
  });
}
function btDDC(d){return BL.container('bt-dd-chart',175);}
function btDDC_render(d){
  var el=$('bt-dd-chart');if(!el)return;
  var c=BL.init(el,'bt-dd');if(!c)return;
  var dates=d.map(function(x){return x.date;});
  var dd=d.map(function(x){return-(x.drawdown||0);});
  c.setOption({
    tooltip:{trigger:'axis',formatter:function(p){return'<b>'+p[0].axisValue+'</b><br>DD: <b style="color:'+BL.colors.red+'">'+p[0].value.toFixed(2)+'%</b>';}},
    grid:{left:8,right:55,top:3,bottom:3,containLabel:false},
    xAxis:{type:'category',data:dates,show:false},
    yAxis:{type:'value',axisLabel:{fontSize:7,formatter:function(v){return v.toFixed(1)+'%';}},splitLine:{lineStyle:{color:'#1e2836'}}},
    series:[{type:'line',data:dd,symbol:'none',lineStyle:{width:0.8,color:BL.colors.red},areaStyle:{color:'rgba(239,68,68,0.12)'}}]
  });
}

// ═══ MONTHLY ═══
function btMon(eq){var mo={};for(var i=0;i<eq.length;i++){var ym=eq[i].date.substring(0,7);if(!mo[ym])mo[ym]={f:eq[i].equity,l:eq[i].equity};mo[ym].l=eq[i].equity;}var ks=Object.keys(mo).sort(),by={},pr=null;for(var i=0;i<ks.length;i++){var ym=ks[i],yr=ym.substring(0,4),m=parseInt(ym.substring(5,7));var st=pr!==null?pr:mo[ym].f;var ret=st>0?Math.round((mo[ym].l-st)/st*10000)/100:0;if(!by[yr])by[yr]={};by[yr][m]=ret;pr=mo[ym].l;}var yrs=Object.keys(by).sort(),yt={};for(var i=0;i<yrs.length;i++){var yr=yrs[i],t=0;for(var m=1;m<=12;m++)if(by[yr][m]!==undefined)t+=by[yr][m];yt[yr]=Math.round(t*100)/100;}var mn=['J','F','M','A','M','J','J','A','S','O','N','D'];var h='<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;overflow:hidden">'+btSH('Monthly Returns')+'<div style="overflow-x:auto;padding:4px"><table style="width:100%;border-collapse:collapse;font-size:9px;font-family:var(--fm)"><tr><th style="padding:3px 4px;border-bottom:1px solid var(--b1);text-align:left;color:var(--t3);font-size:8px">Yr</th>';for(var m=0;m<12;m++)h+='<th style="padding:3px 3px;border-bottom:1px solid var(--b1);text-align:center;color:var(--t3);font-size:8px;min-width:30px">'+mn[m]+'</th>';h+='<th style="padding:3px 4px;border-bottom:1px solid var(--b1);text-align:center;font-size:8px;font-weight:700;color:var(--t3)">YR</th></tr>';for(var i=0;i<yrs.length;i++){var yr=yrs[i];h+='<tr><td style="padding:2px 4px;border-bottom:1px solid var(--b1);font-weight:700;color:var(--t2)">'+yr.substring(2)+'</td>';for(var m=1;m<=12;m++){var v=by[yr][m];if(v!==undefined){var bg=v>0?'rgba(34,197,94,'+Math.min(.35,Math.abs(v)/15)+')':v<0?'rgba(239,68,68,'+Math.min(.35,Math.abs(v)/15)+')':'transparent';var tc=v>0?'var(--gn)':v<0?'var(--rd)':'var(--t3)';h+='<td style="padding:2px 2px;border-bottom:1px solid var(--b1);text-align:center;background:'+bg+';color:'+tc+';font-weight:600">'+(v>0?'+':'')+v.toFixed(1)+'</td>';}else h+='<td style="padding:2px;border-bottom:1px solid var(--b1);text-align:center;color:var(--t3)">—</td>';}var yv=yt[yr]||0;h+='<td style="padding:2px 4px;border-bottom:1px solid var(--b1);text-align:center;font-weight:700;color:'+(yv>0?'var(--gn)':yv<0?'var(--rd)':'var(--t3)')+'">'+(yv>0?'+':'')+yv.toFixed(1)+'</td></tr>';}h+='</table></div></div>';return h;}

// ═══ DISTRIBUTION (ECharts) ═══
function btDist(trades){var bs=2.5,bk={};for(var i=0;i<trades.length;i++){var p=trades[i].pnlP||0;var b=Math.floor(p/bs)*bs;if(!bk[b])bk[b]=0;bk[b]++;}var ks=Object.keys(bk).map(Number).sort(function(a,b){return a-b;});if(!ks.length)return'';var h='<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;overflow:hidden">'+btSH('P&L Distribution')+BL.container('bt-dist-chart',200)+'</div>';return h;}
function btDist_render(trades){
  var el=$('bt-dist-chart');if(!el)return;
  var c=BL.init(el,'bt-dist');if(!c)return;
  var bs=2.5,bk={};for(var i=0;i<trades.length;i++){var p=trades[i].pnlP||0;var b=Math.floor(p/bs)*bs;if(!bk[b])bk[b]=0;bk[b]++;}
  var ks=Object.keys(bk).map(Number).sort(function(a,b){return a-b;});
  var cats=ks.map(function(k){return(k>0?'+':'')+k+'%';});
  var vals=ks.map(function(k){return bk[k];});
  var colors=ks.map(function(k){return k>=0?BL.colors.green:BL.colors.red;});
  c.setOption({
    tooltip:{trigger:'axis',formatter:function(p){return p[0].name+': <b>'+p[0].value+'</b> trades';}},
    grid:BL.grid({left:35,right:10,top:10,bottom:28}),
    xAxis:{type:'category',data:cats,axisLabel:{fontSize:7,interval:Math.max(0,Math.floor(ks.length/8)-1)}},
    yAxis:{type:'value',axisLabel:{fontSize:8}},
    series:[{type:'bar',data:vals.map(function(v,i){return{value:v,itemStyle:{color:colors[i],opacity:0.75}};}),barMaxWidth:20,itemStyle:{borderRadius:[2,2,0,0]}}]
  });
}

// ═══ MAE/MFE (ECharts) ═══
function btMAE(trades){var maes=trades.filter(function(t){return(t.mae||0)<0;}).map(function(t){return t.mae;}),mfes=trades.filter(function(t){return(t.mfe||0)>0;}).map(function(t){return t.mfe;});var am=maes.length?Math.round(maes.reduce(function(s,v){return s+v;},0)/maes.length*100)/100:0,af=mfes.length?Math.round(mfes.reduce(function(s,v){return s+v;},0)/mfes.length*100)/100:0;var h='<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;overflow:hidden">'+btSH('MAE / MFE')+'<div style="padding:8px;display:flex;gap:6px"><div style="flex:1;background:var(--rdB);border-radius:6px;padding:6px;text-align:center"><div style="font-size:8px;color:var(--rd);font-weight:600">Avg MAE</div><div style="font-family:var(--fm);font-size:14px;font-weight:700;color:var(--rd)">'+am.toFixed(1)+'%</div></div><div style="flex:1;background:var(--gnB);border-radius:6px;padding:6px;text-align:center"><div style="font-size:8px;color:var(--gn);font-weight:600">Avg MFE</div><div style="font-family:var(--fm);font-size:14px;font-weight:700;color:var(--gn)">+'+af.toFixed(1)+'%</div></div></div>';if(trades.length>=5){h+=BL.container('bt-mae-chart',140);}h+='</div>';return h;}
function btMAE_render(trades){
  var el=$('bt-mae-chart');if(!el)return;
  var c=BL.init(el,'bt-mae');if(!c)return;
  var wins=[],losses=[];
  trades.forEach(function(t){var d=[t.mae||0,t.pnlP];if(t.pnl>0)wins.push(d);else losses.push(d);});
  c.setOption({
    tooltip:{trigger:'item',formatter:function(p){return'MAE: '+p.value[0]+'%<br>P&L: '+p.value[1]+'%';}},
    grid:BL.grid({left:35,right:10,top:8,bottom:28}),
    xAxis:{type:'value',name:'MAE%',nameTextStyle:{fontSize:8},axisLabel:{fontSize:7,formatter:function(v){return v+'%';}}},
    yAxis:{type:'value',name:'P&L%',nameTextStyle:{fontSize:8},axisLabel:{fontSize:7,formatter:function(v){return v+'%';}}},
    series:[
      {name:'Win',type:'scatter',data:wins,symbolSize:5,itemStyle:{color:BL.colors.green,opacity:0.5}},
      {name:'Loss',type:'scatter',data:losses,symbolSize:5,itemStyle:{color:BL.colors.red,opacity:0.5}}
    ]
  });
}

// ═══ MONTE CARLO ═══
function btMC(mc,s){var h='<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;overflow:hidden;margin-bottom:10px">'+btSH('Monte Carlo ('+mc.runs+')')+'<div style="overflow-x:auto"><table style="width:100%;font-size:10px;border-collapse:collapse;font-family:var(--fm)"><tr><th style="padding:3px 8px;text-align:left;font-size:8px;color:var(--t3);border-bottom:1px solid var(--b1)">Pctl</th><th style="padding:3px 8px;text-align:right;font-size:8px;color:var(--t3);border-bottom:1px solid var(--b1)">Final Eq.</th><th style="padding:3px 8px;text-align:right;font-size:8px;color:var(--t3);border-bottom:1px solid var(--b1)">Ann.Ret</th><th style="padding:3px 8px;text-align:right;font-size:8px;color:var(--t3);border-bottom:1px solid var(--b1)">Max DD%</th><th style="padding:3px 8px;text-align:right;font-size:8px;color:var(--t3);border-bottom:1px solid var(--b1)">Lowest</th></tr>';[['1%','p1'],['5%','p5'],['10%','p10'],['25%','p25'],['50%','p50'],['75%','p75'],['90%','p90'],['95%','p95'],['99%','p99']].forEach(function(x){var p=mc.p[x[1]];if(!p)return;var fc=p.fe>=s.initial_capital?'var(--gn)':'var(--rd)',b=x[0]==='50%'?';font-weight:700':'';h+='<tr><td style="padding:3px 8px;border-bottom:1px solid var(--b1);font-weight:600'+b+'">'+x[0]+'</td><td style="padding:3px 8px;border-bottom:1px solid var(--b1);text-align:right;color:'+fc+b+'">'+fmtRp(p.fe)+'</td><td style="padding:3px 8px;border-bottom:1px solid var(--b1);text-align:right;color:'+(p.ar>=0?'var(--gn)':'var(--rd)')+b+'">'+(p.ar>0?'+':'')+p.ar+'%</td><td style="padding:3px 8px;border-bottom:1px solid var(--b1);text-align:right;color:var(--rd)">'+p.mdd+'%</td><td style="padding:3px 8px;border-bottom:1px solid var(--b1);text-align:right">'+fmtRp(p.low)+'</td></tr>';});h+='</table></div></div>';return h;}

// ═══ TICKERS ═══
function btTK(byT){var w=byT.filter(function(t){return t.pnl>0;}).slice(0,10),lo=byT.filter(function(t){return t.pnl<=0;}).sort(function(a,b){return a.pnl-b.pnl;}).slice(0,10);var h='<div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">';function tbl(items,title,color){var r='<div style="flex:1;min-width:200px;background:var(--bg2);border:1px solid var(--b2);border-radius:8px;overflow:hidden">'+btSH(title)+'<table style="width:100%;font-size:10px;border-collapse:collapse"><tr><th style="padding:3px 8px;text-align:left;font-size:8px;color:var(--t3);border-bottom:1px solid var(--b1)">Code</th><th style="padding:3px 8px;text-align:right;font-size:8px;color:var(--t3);border-bottom:1px solid var(--b1)">Trades</th><th style="padding:3px 8px;text-align:right;font-size:8px;color:var(--t3);border-bottom:1px solid var(--b1)">Win Rate</th><th style="padding:3px 8px;text-align:right;font-size:8px;color:var(--t3);border-bottom:1px solid var(--b1)">Total P&L</th></tr>';items.forEach(function(t){var wr=t.trades?Math.round(t.wins/t.trades*100):0;r+='<tr><td style="padding:2px 8px;border-bottom:1px solid var(--b1)"><span class="code" onclick="gsOpen(\''+esc(t.code)+'\')">'+esc(t.code)+'</span></td><td style="padding:2px 8px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm)">'+t.trades+'</td><td style="padding:2px 8px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm);color:'+color+'">'+wr+'%</td><td style="padding:2px 8px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm);font-weight:600;color:'+color+'">'+fmtRp(t.pnl)+'</td></tr>';});return r+'</table></div>';}h+=tbl(w,'🟢 Top Winners','var(--gn)');h+=tbl(lo,'🔴 Top Losers','var(--rd)');h+='</div>';return h;}

// ═══ TRADE TABLE ═══
function btTR(trades){var h='<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;overflow:hidden;margin-bottom:10px"><div style="padding:5px 10px;font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;border-bottom:1px solid var(--b1);background:var(--bgH);cursor:pointer;display:flex;justify-content:space-between" onclick="btTT()"><span>Trades ('+trades.length+')</span><span id="bt-ta">'+(btShowT?'▼':'▶')+'</span></div><div id="bt-tb" style="'+(btShowT?'':'display:none')+';overflow:auto;max-height:400px">';var sorted=[...trades];if(btSort.col)sorted.sort(function(a,b){var va=a[btSort.col]||0,vb=b[btSort.col]||0;if(typeof va==='string')return btSort.dir==='asc'?va.localeCompare(vb):vb.localeCompare(va);return btSort.dir==='asc'?va-vb:vb-va;});else sorted.reverse();
// Columns: [key, header, width, align]
var cols=[['code','Ticker',58,'l'],['ed','Entry',78,'l'],['ep','Entry$',55,'r'],['xd','Exit',78,'l'],['xp','Exit$',55,'r'],['pnlP','%Chg',48,'r'],['pnl','Profit',55,'r'],['shares','Shares',52,'r'],['pv','Pos.Val',55,'r'],['cumPnl','Cum.P',55,'r'],['bars','Bars',28,'r'],['ppb','P/B',34,'r'],['mae','MAE',42,'r'],['mfe','MFE',42,'r'],['reason','Exit',38,'l']];
h+='<table style="width:100%;font-size:9px;border-collapse:collapse;table-layout:fixed"><colgroup>';
cols.forEach(function(c){h+='<col style="width:'+c[2]+'px">';});
h+='</colgroup><thead><tr>';
cols.forEach(function(c){var ar=btSort.col===c[0]?(btSort.dir==='desc'?' ▼':' ▲'):'';var al=c[3]==='r'?'text-align:right;':'';h+='<th style="padding:4px 4px;font-size:8px;color:var(--t3);border-bottom:1px solid var(--b1);cursor:pointer;position:sticky;top:0;background:var(--bg2);user-select:none;'+al+'overflow:hidden;text-overflow:ellipsis" onclick="btST(\''+c[0]+'\')">'+c[1]+ar+'</th>';});
h+='</tr></thead><tbody>';
var sty='padding:3px 4px;border-bottom:1px solid var(--b1);overflow:hidden;text-overflow:ellipsis;';
var fm='font-family:var(--fm);';
sorted.forEach(function(t){var cc=t.pnl>0?'up':t.pnl<0?'dn':'';
  h+='<tr>';
  h+='<td style="'+sty+'"><span class="code" onclick="gsOpen(\''+esc(t.code)+'\')">'+esc(t.code)+'</span></td>';
  h+='<td style="'+sty+fm+'">'+t.ed+'</td>';
  h+='<td style="'+sty+fm+'text-align:right">'+(t.ep||0).toLocaleString()+'</td>';
  h+='<td style="'+sty+fm+'">'+t.xd+'</td>';
  h+='<td style="'+sty+fm+'text-align:right">'+(t.xp||0).toLocaleString()+'</td>';
  h+='<td class="'+cc+'" style="'+sty+fm+'text-align:right;font-weight:600">'+(t.pnlP>0?'+':'')+t.pnlP+'%</td>';
  h+='<td class="'+cc+'" style="'+sty+fm+'text-align:right">'+fmtRp(t.pnl)+'</td>';
  h+='<td style="'+sty+fm+'text-align:right">'+(t.shares||0).toLocaleString()+'</td>';
  h+='<td style="'+sty+fm+'text-align:right">'+fmtRp(t.pv||0)+'</td>';
  var ccc=(t.cumPnl||0)>0?'up':(t.cumPnl||0)<0?'dn':'';
  h+='<td class="'+ccc+'" style="'+sty+fm+'text-align:right">'+fmtRp(t.cumPnl||0)+'</td>';
  h+='<td style="'+sty+fm+'text-align:right">'+t.bars+'</td>';
  h+='<td style="'+sty+fm+'text-align:right">'+(t.ppb||0).toFixed(2)+'</td>';
  h+='<td style="'+sty+fm+'text-align:right;color:var(--rd)">'+(t.mae||0)+'%</td>';
  h+='<td style="'+sty+fm+'text-align:right;color:var(--gn)">'+(t.mfe>0?'+':'')+(t.mfe||0)+'%</td>';
  h+='<td style="'+sty+'font-size:8px">'+btRI(t.reason)+'</td>';
  h+='</tr>';
});
h+='</tbody></table></div></div>';return h;}

function btTT(){btShowT=!btShowT;var b=$('bt-tb'),a=$('bt-ta');if(b)b.style.display=btShowT?'':'none';if(a)a.textContent=btShowT?'▼':'▶';}
function btST(col){if(btSort.col===col)btSort.dir=btSort.dir==='desc'?'asc':'desc';else{btSort.col=col;btSort.dir='desc';}if(btR){$('bt-res').innerHTML=renderBtR(btR);btRenderCharts(btR);btShowT=true;var b=$('bt-tb');if(b)b.style.display='';}}

// ═══ MONTE CARLO EQUITY BAND CHART (ECharts) ═══
function btMCChart(bands,ic){
  if(!bands||bands.length<3)return'';
  var h='<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:8px;margin-bottom:10px">';
  h+='<div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:4px">MC Min / Median / Max Equity</div>';
  h+=BL.container('bt-mc-chart',450);
  h+='</div>';
  return h;
}
function btMCChart_render(bands,ic){
  var el=$('bt-mc-chart');if(!el||!bands||bands.length<3)return;
  var c=BL.init(el,'bt-mc');if(!c)return;
  var cats=bands.map(function(_,i){return'#'+(i+1);});
  var maxD=bands.map(function(b){return b.max;});
  var p75D=bands.map(function(b){return b.p75;});
  var medD=bands.map(function(b){return b.med;});
  var p25D=bands.map(function(b){return b.p25;});
  var minD=bands.map(function(b){return b.min;});
  c.setOption({
    tooltip:{trigger:'axis',formatter:function(p){var h='Trade '+p[0].axisValue;p.forEach(function(s){if(s.seriesName!=='_p25')h+='<br><span style="color:'+s.color+'">●</span> '+s.seriesName+': <b>'+BL.fmtRp(s.value)+'</b>';});return h;}},
    legend:{data:['Max','Median','Min'],top:0,left:0,textStyle:{fontSize:8}},
    grid:BL.grid({top:22,bottom:36}),
    dataZoom:BL.dataZoom(),
    xAxis:{type:'category',data:cats,axisLabel:{fontSize:7,interval:Math.max(0,Math.floor(bands.length/10)-1)}},
    yAxis:{type:'value',scale:true,axisLabel:{fontSize:8,formatter:function(v){return BL.fmtRp(v);}}},
    series:[
      {name:'Max',type:'line',data:maxD,symbol:'none',lineStyle:{width:0.8,color:BL.colors.green,opacity:0.7},itemStyle:{color:BL.colors.green}},
      {name:'_p25',type:'line',data:p25D,symbol:'none',lineStyle:{width:0,opacity:0},stack:'band',areaStyle:{color:'transparent'},tooltip:{show:false}},
      {name:'P25-P75',type:'line',data:p75D.map(function(v,i){return v-p25D[i];}),symbol:'none',lineStyle:{width:0,opacity:0},stack:'band',areaStyle:{color:BL.colors.blueBg,opacity:1}},
      {name:'Median',type:'line',data:medD,symbol:'none',lineStyle:{width:1.5,color:BL.colors.blue},itemStyle:{color:BL.colors.blue}},
      {name:'Min',type:'line',data:minD,symbol:'none',lineStyle:{width:0.8,color:BL.colors.red,opacity:0.7},itemStyle:{color:BL.colors.red}}
    ]
  });
}

// ═══ DEFERRED RENDER — call after innerHTML is set ═══
function btRenderCharts(d){
  if(!d)return;
  var s=d.stats;
  setTimeout(function(){
    if(d.equity&&d.equity.length>2){btEqC_render(d.equity,s.initial_capital,d.benchmark);btDDC_render(d.equity);}
    if(d.trades&&d.trades.length>3)btDist_render(d.trades);
    if(d.trades&&d.trades.length>=5&&d.trades[0].mae!==undefined)btMAE_render(d.trades);
    if(d.monte_carlo&&d.monte_carlo.bands)btMCChart_render(d.monte_carlo.bands,s.initial_capital);
  },50);
}
// ═══ WALK FORWARD UI (P2 Sprint 13) ═══

function renderWFForm(el) {
  if (!el) el = $('bt-content'); if (!el) return;
  var h = '<div style="padding:12px">';

  // Mode tabs
  h += '<div style="display:flex;gap:4px;margin-bottom:8px">';
  h += '<button class="bei-tab" onclick="btSwitchMode(\'backtest\')" style="padding:5px 14px;font-size:12px">📊 Backtest</button>';
  h += '<button class="bei-tab on" onclick="btSwitchMode(\'walkforward\')" style="padding:5px 14px;font-size:12px">🔄 Walk Forward</button>';
  h += '</div>';

  // WF Mode selector
  h += '<div style="display:flex;gap:8px;margin-bottom:10px;align-items:center">';
  h += '<span style="font-size:12px;font-weight:700">Mode:</span>';
  h += '<button class="bei-sort-btn' + (wfMode !== 'scoring' ? ' on' : '') + '" onclick="wfMode=\'formula\';renderWFForm()" style="padding:5px 12px;font-size:11px">📝 Formula WF</button>';
  h += '<button class="bei-sort-btn' + (wfMode === 'scoring' ? ' on' : '') + '" onclick="wfMode=\'scoring\';renderWFForm()" style="padding:5px 12px;font-size:11px">🎯 Scoring WF</button>';
  h += '</div>';

  // Parameters
  h += '<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:8px;padding:10px;background:var(--bg1);border:1px solid var(--b1);border-radius:6px">';
  h += '<div><div style="font-size:9px;color:var(--t3)">IS Window</div><input id="wf-is" type="number" value="60" min="20" max="200" style="width:55px;background:var(--bg0);border:1px solid var(--b1);border-radius:3px;padding:4px;color:var(--t1);font-family:var(--fm);font-size:12px;text-align:center"> days</div>';
  h += '<div><div style="font-size:9px;color:var(--t3)">OOS Window</div><input id="wf-oos" type="number" value="20" min="5" max="60" style="width:55px;background:var(--bg0);border:1px solid var(--b1);border-radius:3px;padding:4px;color:var(--t1);font-family:var(--fm);font-size:12px;text-align:center"> days</div>';
  h += '<div><div style="font-size:9px;color:var(--t3)">Step Size</div><input id="wf-step" type="number" value="20" min="5" max="60" style="width:55px;background:var(--bg0);border:1px solid var(--b1);border-radius:3px;padding:4px;color:var(--t1);font-family:var(--fm);font-size:12px;text-align:center"> days</div>';

  if (wfMode !== 'scoring') {
    h += '<div><div style="font-size:9px;color:var(--t3)">Max Pos</div><input id="wf-mp" type="number" value="5" min="1" max="20" style="width:45px;background:var(--bg0);border:1px solid var(--b1);border-radius:3px;padding:4px;color:var(--t1);font-family:var(--fm);font-size:12px;text-align:center"></div>';
  } else {
    h += '<div><div style="font-size:9px;color:var(--t3)">Top N stocks</div><input id="wf-topn" type="number" value="20" min="5" max="50" style="width:55px;background:var(--bg0);border:1px solid var(--b1);border-radius:3px;padding:4px;color:var(--t1);font-family:var(--fm);font-size:12px;text-align:center"></div>';
  }
  h += '</div>';

  // Formula inputs (formula mode only)
  if (wfMode !== 'scoring') {
    h += '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">';
    h += '<div style="flex:1;min-width:280px"><div style="font-size:9px;font-weight:700;color:var(--t3);margin-bottom:2px">Entry Formula</div>';
    h += '<textarea id="wf-entry" class="afl-textarea" style="min-height:32px;font-size:12px" placeholder="C > MA20 AND Bullish_MACD">C > MA20 AND Bullish_MACD AND ForeignNet > 0</textarea></div>';
    h += '<div style="flex:1;min-width:280px"><div style="font-size:9px;font-weight:700;color:var(--t3);margin-bottom:2px">Exit Formula</div>';
    h += '<textarea id="wf-exit" class="afl-textarea" style="min-height:32px;font-size:12px" placeholder="Bearish_MACD OR DaysHeld >= 10">Bearish_MACD OR DaysHeld >= 10 OR PnlPct < -5</textarea></div>';
    h += '</div>';
  }

  // Run button
  h += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">';
  h += '<button id="wf-run-btn" onclick="runWF()" style="padding:8px 20px;border-radius:4px;border:none;background:var(--bl);color:#fff;font-weight:700;font-size:13px;cursor:pointer">▶ Run Walk Forward</button>';
  h += '<span id="wf-status" style="font-size:11px;color:var(--t3)"></span>';
  h += '</div>';

  // Results
  h += '<div id="wf-results">';
  if (wfR) h += renderWFResults(wfR);
  h += '</div>';

  h += '</div>';
  el.innerHTML = h;
  if (wfR) setTimeout(function() { wfDrawCharts(wfR); }, 100);
}

var wfMode = 'formula';

async function runWF() {
  if (wfRunning) return;
  wfRunning = true;
  var btn = $('wf-run-btn'), st = $('wf-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Running...'; }
  if (st) st.textContent = 'Walk forward analysis running...';

  try {
    var url, payload;
    if (wfMode === 'scoring') {
      url = '/api/backtest/walk-forward-score';
      payload = {
        is_window: parseInt($('wf-is').value) || 60,
        oos_window: parseInt($('wf-oos').value) || 20,
        step_size: parseInt($('wf-step').value) || 20,
        top_n: parseInt($('wf-topn').value) || 20
      };
    } else {
      url = '/api/backtest/walk-forward';
      payload = {
        formula: $('wf-entry').value.trim(),
        exit_formula: $('wf-exit').value.trim(),
        is_window: parseInt($('wf-is').value) || 60,
        oos_window: parseInt($('wf-oos').value) || 20,
        step_size: parseInt($('wf-step').value) || 20,
        max_positions: parseInt($('wf-mp').value) || 5,
        force_cutloss: true, cutloss_pct: -10
      };
    }
    var r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    wfR = await r.json();
    if (st) st.textContent = wfR.error ? '❌ ' + wfR.error : '✅ ' + wfR.total_steps + ' steps · ' + (wfR.compute_time / 1000).toFixed(1) + 's';
    var el = $('wf-results');
    if (el) { el.innerHTML = wfR.error ? '' : renderWFResults(wfR); }
    if (!wfR.error) setTimeout(function() { wfDrawCharts(wfR); }, 100);
  } catch (e) { if (st) st.textContent = '❌ ' + e.message; }
  wfRunning = false;
  if (btn) { btn.disabled = false; btn.textContent = '▶ Run Walk Forward'; }
}

function renderWFResults(d) {
  if (!d || !d.steps || !d.steps.length) return '';
  var s = d.summary;
  var h = '';

  // Verdict banner
  var vColor = s.verdict === 'robust' ? 'var(--gn)' : s.verdict === 'borderline' ? 'var(--am)' : 'var(--rd)';
  var vBg = s.verdict === 'robust' ? 'rgba(34,197,94,0.08)' : s.verdict === 'borderline' ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)';
  var vEmoji = s.verdict === 'robust' ? '🟢' : s.verdict === 'borderline' ? '🟡' : '🔴';
  h += '<div style="padding:10px 14px;border-radius:6px;background:' + vBg + ';border:1px solid ' + vColor + '33;margin-bottom:10px">';
  h += '<div style="font-size:16px;font-weight:700;color:' + vColor + '">' + vEmoji + ' ' + s.verdict.toUpperCase() + '</div>';
  h += '<div style="font-size:11px;color:var(--t2);margin-top:2px">';
  h += 'Avg WFE: <b>' + (s.avg_wfe || 0) + '%</b>';
  h += ' · OOS Win Rate: <b>' + (s.oos_win_rate || 0) + '%</b>';
  if (s.avg_oos_return !== undefined) h += ' · Avg OOS Return: <b style="color:' + (s.avg_oos_return > 0 ? 'var(--gn)' : 'var(--rd)') + '">' + (s.avg_oos_return > 0 ? '+' : '') + s.avg_oos_return + '%</b>';
  h += '</div>';
  if (s.verdict === 'robust') h += '<div style="font-size:10px;color:var(--gn);margin-top:3px">WFE > 50% — Strategy survives out-of-sample. Deploy with confidence.</div>';
  else if (s.verdict === 'borderline') h += '<div style="font-size:10px;color:var(--am);margin-top:3px">WFE 30-50% — Partial survival OOS. Use reduced position sizing.</div>';
  else h += '<div style="font-size:10px;color:var(--rd);margin-top:3px">WFE < 30% — Strategy is overfit to historical data. Do not deploy.</div>';

  // Top weights (scoring mode)
  if (d.mode === 'scoring' && s.top_weights && s.top_weights.length) {
    h += '<div style="margin-top:6px;font-size:10px;color:var(--t2)"><b>Most selected weights:</b>';
    s.top_weights.forEach(function(tw) {
      var w = tw.weights;
      h += ' F' + w.fundamental + '/V' + w.valuation + '/M' + w.momentum + '/D' + w.demand + '/Fr' + w.foreign + ' (' + tw.count + 'x)';
    });
    h += '</div>';
  }
  h += '</div>';

  // WFE interpretation guide
  h += '<div style="font-size:9px;color:var(--t3);margin-bottom:8px">WFE = OOS annualized return / IS annualized return. Measures how much in-sample performance survives out-of-sample.</div>';

  // Chart placeholder
  h += '<div id="wf-chart" style="height:220px;background:var(--bg1);border:1px solid var(--b1);border-radius:6px;margin-bottom:10px"></div>';

  // Step detail table
  h += '<table style="width:100%;border-collapse:collapse;font-size:10px">';
  h += '<tr style="border-bottom:2px solid var(--b2)">';
  h += '<th style="padding:4px 6px;text-align:center;color:var(--t3);font-size:8px">Step</th>';
  if (d.mode === 'formula') {
    h += '<th style="padding:4px 6px;text-align:left;color:var(--t3);font-size:8px">IS Period</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--t3);font-size:8px">IS Return</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--t3);font-size:8px">IS Trades</th>';
    h += '<th style="padding:4px 6px;text-align:left;color:var(--t3);font-size:8px">OOS Period</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--t3);font-size:8px">OOS Return</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--t3);font-size:8px">OOS Trades</th>';
  } else {
    h += '<th style="padding:4px 6px;text-align:left;color:var(--t3);font-size:8px">IS Dates</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--t3);font-size:8px">IS Avg Ret</th>';
    h += '<th style="padding:4px 6px;text-align:left;color:var(--t3);font-size:8px">OOS Dates</th>';
    h += '<th style="padding:4px 6px;text-align:right;color:var(--t3);font-size:8px">OOS Avg Ret</th>';
    h += '<th style="padding:4px 6px;text-align:left;color:var(--t3);font-size:8px">Best Weights</th>';
  }
  h += '<th style="padding:4px 6px;text-align:right;color:var(--t3);font-size:8px">WFE</th>';
  h += '</tr>';

  d.steps.forEach(function(st) {
    var wfeC = st.wfe > 50 ? 'color:var(--gn)' : st.wfe > 30 ? 'color:var(--am)' : 'color:var(--rd)';
    h += '<tr style="border-bottom:1px solid var(--b1)">';
    h += '<td style="padding:3px 6px;text-align:center;font-weight:600">' + st.step + '</td>';

    if (d.mode === 'formula') {
      var is = st.is || {};
      var oos = st.oos || {};
      h += '<td style="padding:3px 6px;font-size:9px;color:var(--t3)">' + (is.start || '').substring(5) + '→' + (is.end || '').substring(5) + '</td>';
      h += '<td style="padding:3px 6px;text-align:right;font-family:var(--fm);' + (is.return_pct > 0 ? 'color:var(--gn)' : is.return_pct < 0 ? 'color:var(--rd)' : '') + '">' + (is.return_pct > 0 ? '+' : '') + (is.return_pct || 0) + '%</td>';
      h += '<td style="padding:3px 6px;text-align:right;font-family:var(--fm)">' + (is.trades || 0) + '</td>';
      h += '<td style="padding:3px 6px;font-size:9px;color:var(--t3)">' + (oos.start || '').substring(5) + '→' + (oos.end || '').substring(5) + '</td>';
      h += '<td style="padding:3px 6px;text-align:right;font-family:var(--fm);font-weight:700;' + (oos.return_pct > 0 ? 'color:var(--gn)' : oos.return_pct < 0 ? 'color:var(--rd)' : '') + '">' + (oos.return_pct > 0 ? '+' : '') + (oos.return_pct || 0) + '%</td>';
      h += '<td style="padding:3px 6px;text-align:right;font-family:var(--fm)">' + (oos.trades || 0) + '</td>';
    } else {
      h += '<td style="padding:3px 6px;font-size:9px;color:var(--t3)">' + (st.is_dates ? st.is_dates.start.substring(5) + '→' + st.is_dates.end.substring(5) : '') + '</td>';
      h += '<td style="padding:3px 6px;text-align:right;font-family:var(--fm);' + (st.is_avg_return > 0 ? 'color:var(--gn)' : 'color:var(--rd)') + '">' + (st.is_avg_return > 0 ? '+' : '') + st.is_avg_return + '%</td>';
      h += '<td style="padding:3px 6px;font-size:9px;color:var(--t3)">' + (st.oos_dates ? st.oos_dates.start.substring(5) + '→' + st.oos_dates.end.substring(5) : '') + '</td>';
      h += '<td style="padding:3px 6px;text-align:right;font-family:var(--fm);font-weight:700;' + (st.oos_avg_return > 0 ? 'color:var(--gn)' : 'color:var(--rd)') + '">' + (st.oos_avg_return > 0 ? '+' : '') + st.oos_avg_return + '%</td>';
      var bw = st.best_weights || {};
      h += '<td style="padding:3px 6px;font-size:9px;font-family:var(--fm)">F' + (bw.fundamental||0) + ' V' + (bw.valuation||0) + ' M' + (bw.momentum||0) + ' D' + (bw.demand||0) + ' Fr' + (bw.foreign||0) + '</td>';
    }
    h += '<td style="padding:3px 6px;text-align:right;font-family:var(--fm);font-weight:700;' + wfeC + '">' + (st.wfe || 0) + '%</td>';
    h += '</tr>';
  });
  h += '</table>';
  return h;
}

function wfDrawCharts(d) {
  if (!d || !d.steps || !d.steps.length) return;
  var el = $('wf-chart'); if (!el) return;
  var c = BL.init(el, 'wf-chart');
  if (!c) return;

  var labels = d.steps.map(function(s) { return 'S' + s.step; });
  var isData, oosData;
  if (d.mode === 'formula') {
    isData = d.steps.map(function(s) { return s.is ? s.is.return_pct : 0; });
    oosData = d.steps.map(function(s) { return s.oos ? s.oos.return_pct : 0; });
  } else {
    isData = d.steps.map(function(s) { return s.is_avg_return || 0; });
    oosData = d.steps.map(function(s) { return s.oos_avg_return || 0; });
  }
  var wfeData = d.steps.map(function(s) { return s.wfe || 0; });

  c.setOption({
    tooltip: { trigger: 'axis', textStyle: { fontSize: 10 } },
    legend: { top: 2, textStyle: { fontSize: 9, color: '#94a3b8' }, data: ['IS Return', 'OOS Return', 'WFE'] },
    grid: BL.grid({ top: 30, bottom: 24, left: 40, right: 40 }),
    xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 8 } },
    yAxis: [
      { type: 'value', name: 'Return %', nameTextStyle: { fontSize: 8 }, axisLabel: { fontSize: 8, formatter: function(v) { return v + '%'; } } },
      { type: 'value', name: 'WFE %', nameTextStyle: { fontSize: 8 }, axisLabel: { fontSize: 8, formatter: function(v) { return v + '%'; } }, splitLine: { show: false } }
    ],
    series: [
      { name: 'IS Return', type: 'bar', data: isData, barWidth: 8, itemStyle: { color: 'rgba(84,112,198,0.5)' } },
      { name: 'OOS Return', type: 'bar', data: oosData, barWidth: 8, itemStyle: { color: function(p) { return p.value >= 0 ? BL.colors.green : BL.colors.red; } } },
      { name: 'WFE', type: 'line', yAxisIndex: 1, data: wfeData, symbol: 'circle', symbolSize: 4, lineStyle: { width: 2, color: '#f59e0b' }, itemStyle: { color: '#f59e0b' },
        markLine: { silent: true, data: [{ yAxis: 50, lineStyle: { color: BL.colors.green, type: 'dashed', width: 1 }, label: { formatter: '50% robust', fontSize: 8 } }, { yAxis: 30, lineStyle: { color: BL.colors.red, type: 'dashed', width: 1 }, label: { formatter: '30% overfit', fontSize: 8 } }] } }
    ]
  }, true);
}