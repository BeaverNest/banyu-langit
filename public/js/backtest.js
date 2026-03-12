// ═══ BACKTEST UI V6 — public/js/backtest.js ═══
var btR=null,btRun=false,btShowT=false,btShowRef=false,btSort={col:'',dir:'desc'};
var btScopes={sectors:[],industries:[]};

function loadBacktest(){
  var el=$('bt-content');if(!el)return;
  fetch('/api/backtest/scopes').then(function(r){return r.json();}).then(function(d){btScopes=d||{};}).catch(function(){});
  renderBtForm(el);
}

function renderBtForm(el){
  if(!el)el=$('bt-content');if(!el)return;
  var d=btR;var h='<div style="padding:12px">';

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
  h+='<div><select id="bt-scope" style="width:85px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px;color:var(--t1);font-size:10px;outline:none" onchange="btScopeChg()"><option value="all">All Stocks</option><option value="stock"'+(d&&d.params.scope_type==='stock'?' selected':'')+'>Stock(s)</option><option value="sector"'+(d&&d.params.scope_type==='sector'?' selected':'')+'>Sector</option><option value="industry"'+(d&&d.params.scope_type==='industry'?' selected':'')+'>Industry</option></select><div style="font-size:7px;color:var(--t3)">Scope</div></div>';
  // Scope value
  h+='<div style="position:relative;'+(d&&d.params.scope_type!=='all'?'':'display:none')+'" id="bt-sv-wrap"><input id="bt-sv" style="width:130px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px 6px;color:var(--t1);font-size:10px;font-family:var(--fm);outline:none;text-transform:uppercase" placeholder="BBCA,TLKM" value="'+(d?esc(d.params.scope_value||''):'')+ '" oninput="btAcScope()" onfocus="btAcScope()" autocomplete="off"><div id="bt-sv-ac" class="bt-ac-drop"></div><div style="font-size:7px;color:var(--t3)">Filter</div></div>';
  h+='<div><input id="bt-mp" type="number" value="'+(d?d.params.max_positions:5)+'" style="width:45px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px 6px;color:var(--t1);font-family:var(--fm);font-size:10px;outline:none"><div style="font-size:7px;color:var(--t3)">Pos</div></div>';
  h+='<div><input id="bt-cap" type="number" value="'+(d?d.stats.initial_capital:100000000)+'" style="width:95px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:4px 6px;color:var(--t1);font-family:var(--fm);font-size:10px;outline:none"><div style="font-size:7px;color:var(--t3)">Capital</div></div>';
  // Force cutloss
  var clOn=d&&d.params.force_cutloss;
  h+='<div><div style="display:flex;align-items:center;gap:2px;background:var(--bgH);border:1px solid var(--b2);border-radius:4px;padding:3px 5px;height:22px"><input type="checkbox" id="bt-cl" '+(clOn?'checked':'')+' style="margin:0;width:13px;height:13px;cursor:pointer"><input id="bt-clp" type="number" value="'+(d&&d.params.cutloss_pct!=null?d.params.cutloss_pct:-10)+'" style="width:35px;background:transparent;border:none;color:var(--t1);font-family:var(--fm);font-size:10px;outline:none;text-align:right">%</div><div style="font-size:7px;color:var(--t3)">Cutloss</div></div>';
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
    ['Volume','V|Volume shares,Val|Value Rp,Freq|Frequency,DVMil|Value millions,RelVol|Vs 20d avg'],
    ['MA','MA5|5-day,MA10|10-day,MA20|20-day,MA50|50-day,MA100|100-day,MA200|200-day'],
    ['Dist%','DistMA5|% from MA5,DistMA20|% from MA20,DistMA50|% from MA50,DistMA200|% from MA200'],
    ['Position','Up_MA20|Above MA20,Up_MA50|Above MA50,ShortTrend|C>MA10+20,Intermediate|C>MA20+50,LongTrend|C>MA20+50+200'],
    ['MACD','MACD|MACD line,Signal|Signal line,MACD_Hist|Histogram,Bullish_MACD|Bullish,Bearish_MACD|Bearish,MACDCross|Golden cross'],
    ['Stoch','K|%K,D|%D'],
    ['Foreign','ForeignNet|Net Rp,ForeignBuy|Buy Rp,ForeignSell|Sell Rp,Foreign_5D|5d net Rp'],
    ['Range','HHV20|20d high,LLV20|20d low'],
    ['Fund','PER|P/E ratio,PBV|P/B ratio,ROE|Return on equity,MktCap|Market cap'],
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

function btScopeChg(){var v=$('bt-scope').value;var w=$('bt-sv-wrap');if(w)w.style.display=v==='all'?'none':'';var inp=$('bt-sv');if(inp){inp.value='';inp.placeholder=v==='stock'?'BBCA,TLKM':v==='sector'?'Type sector':v==='industry'?'Type industry':'';}}
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
      benchmark:$('bt-bm').value.trim()||'COMPOSITE',start_date:$('bt-sd').value||'',end_date:$('bt-ed').value||'',
      scope_type:$('bt-scope').value,scope_value:$('bt-sv')?$('bt-sv').value.trim():'',
    })});
    btR=await r.json();btShowT=false;btSort={col:'',dir:'desc'};
    if(st)st.textContent=btR.error?'❌ '+btR.error:'✅ '+(btR.compute_time/1000).toFixed(1)+'s · '+btR.stats.total_trades+' trades · '+btR.period.days+' days';
    var el=$('bt-res');if(el)el.innerHTML=btR.error?'':renderBtR(btR);
  }catch(e){if(st)st.textContent='❌ '+e.message;}
  btRun=false;if(btn){btn.textContent='▶ Run';btn.disabled=false;}
}

// ═══ RENDER RESULTS ═══
function renderBtR(d){
  var s=d.stats,h='';
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
  h+='</table></div></div>';
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

// ═══ EQUITY ═══
function btEqC(data,ic,bn){var W=600,H=180,P={t:10,r:55,b:20,l:8},cW=W-P.l-P.r,cH=H-P.t-P.b;var all=data.map(function(d){return d.equity;}).concat(data.map(function(d){return d.benchmark||ic;}));var mn=Math.min.apply(null,all)*.98,mx=Math.max.apply(null,all)*1.02;if(mx===mn)mx=mn+1;var sx=function(i){return P.l+(i/(data.length-1))*cW;},sy=function(v){return P.t+(1-(v-mn)/(mx-mn))*cH;};var h='<svg width="100%" viewBox="0 0 '+W+' '+H+'">';for(var g=0;g<=3;g++){var gy=P.t+(g/3)*cH,gv=mx-(g/3)*(mx-mn);h+='<line x1="'+P.l+'" y1="'+gy+'" x2="'+(W-P.r)+'" y2="'+gy+'" stroke="var(--b1)" stroke-width="0.5"/><text x="'+(W-P.r+3)+'" y="'+(gy+3)+'" font-size="7" fill="var(--t3)" font-family="var(--fm)">'+fmtRp(gv)+'</text>';}var bp='';for(var i=0;i<data.length;i++)bp+=(i===0?'M':'L')+sx(i).toFixed(1)+','+sy(data[i].benchmark||ic).toFixed(1);h+='<path d="'+bp+'" fill="none" stroke="var(--t3)" stroke-width="0.8" stroke-dasharray="3,2" opacity="0.5"/>';var ep='';for(var i=0;i<data.length;i++)ep+=(i===0?'M':'L')+sx(i).toFixed(1)+','+sy(data[i].equity).toFixed(1);var ec=data[data.length-1].equity>=ic?'var(--gn)':'var(--rd)';h+='<path d="'+ep+'L'+sx(data.length-1).toFixed(1)+','+(P.t+cH)+'L'+P.l+','+(P.t+cH)+'Z" fill="'+ec+'" opacity="0.06"/><path d="'+ep+'" fill="none" stroke="'+ec+'" stroke-width="1.2"/>';var ds=Math.max(1,Math.floor(data.length/6));for(var i=0;i<data.length;i+=ds)h+='<text x="'+sx(i)+'" y="'+(H-3)+'" font-size="6" fill="var(--t3)" text-anchor="middle" font-family="var(--fm)">'+data[i].date.substring(2,7)+'</text>';h+='<circle cx="'+(P.l+6)+'" cy="'+(P.t+3)+'" r="2.5" fill="'+ec+'"/><text x="'+(P.l+12)+'" y="'+(P.t+6)+'" font-size="7" fill="var(--t2)">Strategy</text><line x1="'+(P.l+55)+'" y1="'+(P.t+3)+'" x2="'+(P.l+65)+'" y2="'+(P.t+3)+'" stroke="var(--t3)" stroke-width="0.8" stroke-dasharray="3,2"/><text x="'+(P.l+68)+'" y="'+(P.t+6)+'" font-size="7" fill="var(--t3)">'+(bn||'Bench')+'</text>';return h+'</svg>';}
function btDDC(d){var W=600,H=70,P={t:3,r:55,b:3,l:8},cW=W-P.l-P.r,cH=H-P.t-P.b;var md=Math.max.apply(null,d.map(function(x){return x.drawdown||0;}));if(md<1)md=1;var sx=function(i){return P.l+(i/(d.length-1))*cW;},sy=function(v){return P.t+(v/md)*cH;};var h='<svg width="100%" viewBox="0 0 '+W+' '+H+'">';var p='M'+P.l+','+P.t;for(var i=0;i<d.length;i++)p+='L'+sx(i).toFixed(1)+','+sy(d[i].drawdown||0).toFixed(1);p+='L'+sx(d.length-1).toFixed(1)+','+P.t+'Z';h+='<path d="'+p+'" fill="var(--rd)" opacity="0.12"/>';var l='';for(var i=0;i<d.length;i++)l+=(i===0?'M':'L')+sx(i).toFixed(1)+','+sy(d[i].drawdown||0).toFixed(1);h+='<path d="'+l+'" fill="none" stroke="var(--rd)" stroke-width="0.8"/><text x="'+(W-P.r+3)+'" y="'+(P.t+cH)+'" font-size="7" fill="var(--rd)" font-family="var(--fm)">-'+md.toFixed(1)+'%</text>';return h+'</svg>';}

// ═══ MONTHLY ═══
function btMon(eq){var mo={};for(var i=0;i<eq.length;i++){var ym=eq[i].date.substring(0,7);if(!mo[ym])mo[ym]={f:eq[i].equity,l:eq[i].equity};mo[ym].l=eq[i].equity;}var ks=Object.keys(mo).sort(),by={},pr=null;for(var i=0;i<ks.length;i++){var ym=ks[i],yr=ym.substring(0,4),m=parseInt(ym.substring(5,7));var st=pr!==null?pr:mo[ym].f;var ret=st>0?Math.round((mo[ym].l-st)/st*10000)/100:0;if(!by[yr])by[yr]={};by[yr][m]=ret;pr=mo[ym].l;}var yrs=Object.keys(by).sort(),yt={};for(var i=0;i<yrs.length;i++){var yr=yrs[i],t=0;for(var m=1;m<=12;m++)if(by[yr][m]!==undefined)t+=by[yr][m];yt[yr]=Math.round(t*100)/100;}var mn=['J','F','M','A','M','J','J','A','S','O','N','D'];var h='<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;overflow:hidden">'+btSH('Monthly Returns')+'<div style="overflow-x:auto;padding:4px"><table style="width:100%;border-collapse:collapse;font-size:9px;font-family:var(--fm)"><tr><th style="padding:3px 4px;border-bottom:1px solid var(--b1);text-align:left;color:var(--t3);font-size:8px">Yr</th>';for(var m=0;m<12;m++)h+='<th style="padding:3px 3px;border-bottom:1px solid var(--b1);text-align:center;color:var(--t3);font-size:8px;min-width:30px">'+mn[m]+'</th>';h+='<th style="padding:3px 4px;border-bottom:1px solid var(--b1);text-align:center;font-size:8px;font-weight:700;color:var(--t3)">YR</th></tr>';for(var i=0;i<yrs.length;i++){var yr=yrs[i];h+='<tr><td style="padding:2px 4px;border-bottom:1px solid var(--b1);font-weight:700;color:var(--t2)">'+yr.substring(2)+'</td>';for(var m=1;m<=12;m++){var v=by[yr][m];if(v!==undefined){var bg=v>0?'rgba(34,197,94,'+Math.min(.35,Math.abs(v)/15)+')':v<0?'rgba(239,68,68,'+Math.min(.35,Math.abs(v)/15)+')':'transparent';var tc=v>0?'var(--gn)':v<0?'var(--rd)':'var(--t3)';h+='<td style="padding:2px 2px;border-bottom:1px solid var(--b1);text-align:center;background:'+bg+';color:'+tc+';font-weight:600">'+(v>0?'+':'')+v.toFixed(1)+'</td>';}else h+='<td style="padding:2px;border-bottom:1px solid var(--b1);text-align:center;color:var(--t3)">—</td>';}var yv=yt[yr]||0;h+='<td style="padding:2px 4px;border-bottom:1px solid var(--b1);text-align:center;font-weight:700;color:'+(yv>0?'var(--gn)':yv<0?'var(--rd)':'var(--t3)')+'">'+(yv>0?'+':'')+yv.toFixed(1)+'</td></tr>';}h+='</table></div></div>';return h;}

// ═══ DISTRIBUTION ═══
function btDist(trades){var bs=2.5,bk={};for(var i=0;i<trades.length;i++){var p=trades[i].pnlP||0;var b=Math.floor(p/bs)*bs;if(!bk[b])bk[b]=0;bk[b]++;}var ks=Object.keys(bk).map(Number).sort(function(a,b){return a-b;});if(!ks.length)return'';var mx=Math.max.apply(null,ks.map(function(k){return bk[k];}));var W=300,H=220,P={t:10,r:10,b:22,l:30},cW=W-P.l-P.r,cH=H-P.t-P.b,bW=Math.max(6,Math.min(20,cW/ks.length-2));var h='<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;overflow:hidden">'+btSH('P&L Distribution')+'<svg width="100%" viewBox="0 0 '+W+' '+H+'" style="padding:6px">';for(var g=0;g<=3;g++){var gy=P.t+(1-g/3)*cH,gv=Math.round(mx*g/3);h+='<line x1="'+P.l+'" y1="'+gy+'" x2="'+(W-P.r)+'" y2="'+gy+'" stroke="var(--b1)" stroke-width="0.3"/><text x="'+(P.l-3)+'" y="'+(gy+2)+'" font-size="7" fill="var(--t3)" text-anchor="end" font-family="var(--fm)">'+gv+'</text>';}var tw=ks.length*(bW+2),stX=P.l+(cW-tw)/2;for(var i=0;i<ks.length;i++){var k=ks[i],c=bk[k],bH=(c/mx)*cH,bx=stX+i*(bW+2),by=P.t+cH-bH;h+='<rect x="'+bx+'" y="'+by+'" width="'+bW+'" height="'+bH+'" fill="'+(k>=0?'var(--gn)':'var(--rd)')+'" opacity="0.7" rx="1"/>';if(i%Math.max(1,Math.floor(ks.length/8))===0)h+='<text x="'+(bx+bW/2)+'" y="'+(H-5)+'" font-size="7" fill="var(--t3)" text-anchor="middle" font-family="var(--fm)">'+(k>0?'+':'')+k+'%</text>';}h+='</svg></div>';return h;}

// ═══ MAE/MFE ═══
function btMAE(trades){var maes=trades.filter(function(t){return(t.mae||0)<0;}).map(function(t){return t.mae;}),mfes=trades.filter(function(t){return(t.mfe||0)>0;}).map(function(t){return t.mfe;});var am=maes.length?Math.round(maes.reduce(function(s,v){return s+v;},0)/maes.length*100)/100:0,af=mfes.length?Math.round(mfes.reduce(function(s,v){return s+v;},0)/mfes.length*100)/100:0;var h='<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;overflow:hidden">'+btSH('MAE / MFE')+'<div style="padding:8px;display:flex;gap:6px"><div style="flex:1;background:var(--rdB);border-radius:6px;padding:6px;text-align:center"><div style="font-size:8px;color:var(--rd);font-weight:600">Avg MAE</div><div style="font-family:var(--fm);font-size:14px;font-weight:700;color:var(--rd)">'+am.toFixed(1)+'%</div></div><div style="flex:1;background:var(--gnB);border-radius:6px;padding:6px;text-align:center"><div style="font-size:8px;color:var(--gn);font-weight:600">Avg MFE</div><div style="font-family:var(--fm);font-size:14px;font-weight:700;color:var(--gn)">+'+af.toFixed(1)+'%</div></div></div>';if(trades.length>=5){var W=280,H=140;h+='<svg width="100%" viewBox="0 0 '+W+' '+H+'" style="padding:0 8px 8px">';var ap=trades.map(function(t){return t.pnlP;}),am2=trades.map(function(t){return t.mae||0;});var mnX=Math.min.apply(null,am2)-1,mxX=1,mnY=Math.min.apply(null,ap)-1,mxY=Math.max.apply(null,ap)+1,sW=W-40,sH=H-28;var sx=function(v){return 30+(v-mnX)/(mxX-mnX)*sW;},sy=function(v){return 10+(1-(v-mnY)/(mxY-mnY))*sH;};if(mnY<0&&mxY>0)h+='<line x1="30" y1="'+sy(0)+'" x2="'+(W-10)+'" y2="'+sy(0)+'" stroke="var(--b2)" stroke-width="0.5"/>';for(var i=0;i<trades.length;i++){var t=trades[i];h+='<circle cx="'+sx(t.mae||0).toFixed(1)+'" cy="'+sy(t.pnlP).toFixed(1)+'" r="2.5" fill="'+(t.pnl>0?'var(--gn)':'var(--rd)')+'" opacity="0.45"/>';}h+='<text x="'+(W/2)+'" y="'+(H-2)+'" font-size="7" fill="var(--t3)" text-anchor="middle">MAE% →</text></svg>';}h+='</div>';return h;}

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
function btST(col){if(btSort.col===col)btSort.dir=btSort.dir==='desc'?'asc':'desc';else{btSort.col=col;btSort.dir='desc';}if(btR){$('bt-res').innerHTML=renderBtR(btR);btShowT=true;var b=$('bt-tb');if(b)b.style.display='';}}

// ═══ MONTE CARLO EQUITY BAND CHART ═══
function btMCChart(bands,ic){
  if(!bands||bands.length<3)return'';
  var W=700,H=200,P={t:12,r:55,b:22,l:8},cW=W-P.l-P.r,cH=H-P.t-P.b;
  var allV=bands.reduce(function(a,b){a.push(b.min,b.max);return a;},[]);
  var mn=Math.min.apply(null,allV)*.97,mx=Math.max.apply(null,allV)*1.03;if(mx===mn)mx=mn+1;
  var sx=function(i){return P.l+(i/(bands.length-1))*cW;};
  var sy=function(v){return P.t+(1-(v-mn)/(mx-mn))*cH;};
  var h='<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:8px;margin-bottom:10px">';
  h+='<div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:4px">MC Min / Median / Max Equity</div>';
  h+='<svg width="100%" viewBox="0 0 '+W+' '+H+'">';
  // Grid
  for(var g=0;g<=4;g++){var gy=P.t+(g/4)*cH,gv=mx-(g/4)*(mx-mn);h+='<line x1="'+P.l+'" y1="'+gy+'" x2="'+(W-P.r)+'" y2="'+gy+'" stroke="var(--b1)" stroke-width="0.3"/><text x="'+(W-P.r+3)+'" y="'+(gy+3)+'" font-size="7" fill="var(--t3)" font-family="var(--fm)">'+fmtRp(gv)+'</text>';}
  // P25-P75 band
  var bandU='M',bandD='M';
  for(var i=0;i<bands.length;i++){bandU+=(i?'L':'')+sx(i).toFixed(1)+','+sy(bands[i].p75).toFixed(1);bandD+=(i?'L':'')+sx(i).toFixed(1)+','+sy(bands[i].p25).toFixed(1);}
  // Close band polygon
  var poly=bandU;for(var i=bands.length-1;i>=0;i--)poly+='L'+sx(i).toFixed(1)+','+sy(bands[i].p25).toFixed(1);poly+='Z';
  h+='<path d="'+poly+'" fill="var(--bl)" opacity="0.08"/>';
  // Max line (green)
  var maxP='';for(var i=0;i<bands.length;i++)maxP+=(i?'L':'M')+sx(i).toFixed(1)+','+sy(bands[i].max).toFixed(1);
  h+='<path d="'+maxP+'" fill="none" stroke="var(--gn)" stroke-width="0.8" opacity="0.7"/>';
  // Median line (blue)
  var medP='';for(var i=0;i<bands.length;i++)medP+=(i?'L':'M')+sx(i).toFixed(1)+','+sy(bands[i].med).toFixed(1);
  h+='<path d="'+medP+'" fill="none" stroke="var(--bl)" stroke-width="1.2"/>';
  // Min line (red)
  var minP='';for(var i=0;i<bands.length;i++)minP+=(i?'L':'M')+sx(i).toFixed(1)+','+sy(bands[i].min).toFixed(1);
  h+='<path d="'+minP+'" fill="none" stroke="var(--rd)" stroke-width="0.8" opacity="0.7"/>';
  // X axis label
  h+='<text x="'+(W/2)+'" y="'+(H-3)+'" font-size="7" fill="var(--t3)" text-anchor="middle">Trade #</text>';
  // Legend
  h+='<line x1="'+(P.l+4)+'" y1="'+(P.t+3)+'" x2="'+(P.l+14)+'" y2="'+(P.t+3)+'" stroke="var(--gn)" stroke-width="1"/><text x="'+(P.l+17)+'" y="'+(P.t+6)+'" font-size="7" fill="var(--t3)">Max</text>';
  h+='<line x1="'+(P.l+40)+'" y1="'+(P.t+3)+'" x2="'+(P.l+50)+'" y2="'+(P.t+3)+'" stroke="var(--bl)" stroke-width="1.2"/><text x="'+(P.l+53)+'" y="'+(P.t+6)+'" font-size="7" fill="var(--t3)">Median</text>';
  h+='<line x1="'+(P.l+88)+'" y1="'+(P.t+3)+'" x2="'+(P.l+98)+'" y2="'+(P.t+3)+'" stroke="var(--rd)" stroke-width="1"/><text x="'+(P.l+101)+'" y="'+(P.t+6)+'" font-size="7" fill="var(--t3)">Min</text>';
  h+='</svg></div>';
  return h;
}
