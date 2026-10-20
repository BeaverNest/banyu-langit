// ═══ TEARSHEET — public/js/tearsheet.js ═══
// Detailed performance analytics from backtest results
// Reads from global btR (backtest result object set by backtest.js)

function loadTearsheet(){
  var el=$('ts-content');if(!el)return;
  if(!btR||btR.error){
    el.innerHTML='<div class="ne">Run a backtest first, then open Tearsheet for detailed analysis</div>';
    return;
  }
  renderTearsheet(el,btR);
}

function renderTearsheet(el,d){
  var s=d.stats,trades=d.trades||[],eq=d.equity||[];
  if(!trades.length||!eq.length){el.innerHTML='<div class="ne">No data to analyze</div>';return;}

  var h='<div style="padding:12px;overflow-y:auto;flex:1">';

  // ═══ HEADER ═══
  h+='<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">';
  h+='<div style="font-size:16px;font-weight:700;color:var(--t1)">📊 Strategy Tearsheet</div>';
  h+='<div style="font-size:10px;color:var(--t3)">'+d.period.start+' → '+d.period.end+' · '+d.period.days+' days · '+trades.length+' trades</div>';
  h+='<div style="flex:1"></div>';
  h+='<button onclick="tsCopyStats()" style="padding:4px 10px;border-radius:4px;border:1px solid var(--b2);background:none;color:var(--t2);font-size:10px;cursor:pointer;font-family:var(--f)">📋 Copy Stats</button>';
  h+='</div>';

  // ═══ KEY METRICS CARDS ═══
  h+='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:14px">';
  h+=tsCard('Net Return',btP(s.total_return),s.total_return);
  h+=tsCard('Annual Return',btP(s.annual_return),s.annual_return);
  h+=tsCard('Sharpe',s.sharpe.toFixed(2),s.sharpe>=1?1:s.sharpe>=0?0:-1);
  var sortino=tsSortino(eq);
  h+=tsCard('Sortino',sortino.toFixed(2),sortino>=1.5?1:sortino>=0?0:-1);
  h+=tsCard('Max Drawdown','-'+s.max_drawdown+'%',-1);
  h+=tsCard('Win Rate',s.win_rate+'%',s.win_rate>=50?1:s.win_rate>=40?0:-1);
  h+=tsCard('Profit Factor',s.profit_factor.toFixed(2),s.profit_factor>=1.5?1:s.profit_factor>=1?0:-1);
  h+=tsCard('Expectancy',btP(s.expectancy),s.expectancy);
  h+=tsCard('Recovery Factor',s.recovery_factor,s.recovery_factor>=2?1:s.recovery_factor>=1?0:-1);
  h+=tsCard('CAR/MaxDD',s.car_maxdd.toFixed(2),s.car_maxdd>=1?1:s.car_maxdd>=0.5?0:-1);
  h+=tsCard('Avg Trade',btP(s.avg_pl_pct),s.avg_pl_pct);
  h+=tsCard('Payoff Ratio',s.payoff_ratio.toFixed(2),s.payoff_ratio>=2?1:s.payoff_ratio>=1?0:-1);
  h+='</div>';

  // ═══ STRATEGY COMMENTARY ═══
  h+=tsCommentary(d,sortino);

  // ═══ ROW 1: Underwater + Rolling Sharpe ═══
  h+='<div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">';
  h+='<div style="flex:1;min-width:400px;background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:8px">';
  h+='<div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:4px">Underwater Plot (Drawdown Over Time)</div>';
  h+=BL.container('ts-underwater',300);
  h+='</div>';
  if(eq.length>=70){
    h+='<div style="flex:1;min-width:400px;background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:8px">';
    h+='<div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:4px">Rolling Sharpe (60-day)</div>';
    h+=BL.container('ts-rolling-sharpe',300);
    h+='</div>';
  }
  h+='</div>';

  // ═══ ROW 2: Monthly Heatmap ═══
  h+='<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:8px;margin-bottom:10px">';
  h+='<div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:6px">Monthly Returns (%)</div>';
  h+=tsMonthlyHeatmap(eq);
  h+='</div>';

  // ═══ ROW 3: Rolling Returns + Drawdowns ═══
  h+='<div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">';
  if(eq.length>=40){
    h+='<div style="flex:1;min-width:400px;background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:8px">';
    h+='<div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:4px">Rolling Returns</div>';
    h+=BL.container('ts-rolling-ret',300);
    h+='</div>';
  }
  h+='<div style="flex:0 0 340px;min-width:280px;background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:8px">';
  h+='<div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:4px">Top 5 Drawdowns</div>';
  h+=tsDrawdownTable(eq);
  h+='</div>';
  h+='</div>';

  // ═══ ROW 4: Streaks + Duration + DOW ═══
  if(trades.length>=3){
    h+='<div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">';
    h+='<div style="flex:1;min-width:320px;background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:8px">';
    h+='<div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:4px">Win/Loss Streaks</div>';
    h+=BL.container('ts-streaks',260);
    h+='</div>';
    h+='<div style="flex:1;min-width:320px;background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:8px">';
    h+='<div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:4px">Trade Duration Distribution</div>';
    h+=BL.container('ts-duration',260);
    h+='</div>';
    h+='<div style="flex:1;min-width:320px;background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:8px">';
    h+='<div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:4px">Return by Day of Week</div>';
    h+=BL.container('ts-dow-chart',260);
    h+='</div>';
    h+='</div>';
  }

  // ═══ ROW 5: Cum P&L + Summary ═══
  h+='<div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">';
  if(trades.length>=3){
    h+='<div style="flex:1;min-width:400px;background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:8px">';
    h+='<div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:4px">Cumulative P&L by Trade #</div>';
    h+=BL.container('ts-cum-pnl',300);
    h+='</div>';
  }
  h+='<div style="flex:0 0 340px;min-width:280px;background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:8px">';
  h+='<div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:6px">Summary Statistics</div>';
  h+=tsSummaryTable(d);
  h+='</div>';
  h+='</div>';

  h+='</div>';
  el.innerHTML=h;

  setTimeout(function(){
    try{tsUnderwaterRender(eq);}catch(e){console.warn('TS underwater:',e);}
    try{tsRollingSharpeRender(eq);}catch(e){console.warn('TS rsharpe:',e);}
    try{tsRollingRetRender(eq);}catch(e){console.warn('TS rret:',e);}
    try{tsStreaksRender(trades);}catch(e){console.warn('TS streaks:',e);}
    try{tsDurationRender(trades);}catch(e){console.warn('TS dur:',e);}
    try{tsDOWRender(trades);}catch(e){console.warn('TS dow:',e);}
    try{tsCumPnlRender(trades,s.initial_capital);}catch(e){console.warn('TS cumpnl:',e);}
  },80);
}

function tsCard(label,value,dir){
  var clr=dir>0?'var(--gn)':dir<0?'var(--rd)':'var(--t1)';
  return '<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:6px;padding:8px 10px">'+
    '<div style="font-size:8px;color:var(--t3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">'+label+'</div>'+
    '<div style="font-size:16px;font-weight:700;font-family:var(--fm);color:'+clr+'">'+value+'</div></div>';
}

function tsSortino(eq){
  if(eq.length<10)return 0;
  var rets=[];
  for(var i=1;i<eq.length;i++){rets.push((eq[i].equity-eq[i-1].equity)/eq[i-1].equity);}
  var mean=rets.reduce(function(s,v){return s+v;},0)/rets.length;
  var down=rets.filter(function(r){return r<0;});
  if(!down.length)return mean>0?99:0;
  var dd=Math.sqrt(down.reduce(function(s,v){return s+v*v;},0)/down.length);
  return dd>0?(mean/dd)*Math.sqrt(252):0;
}

function tsMonthlyHeatmap(eq){
  var byMonth={};
  eq.forEach(function(d){var ym=d.date.substring(0,7);if(!byMonth[ym])byMonth[ym]={first:d.equity,last:d.equity};byMonth[ym].last=d.equity;});
  var months=Object.keys(byMonth).sort();
  var returns={};
  for(var i=0;i<months.length;i++){var m=months[i];var prev=i>0?byMonth[months[i-1]].last:byMonth[m].first;returns[m]=(byMonth[m].last-prev)/prev*100;}
  var years={};
  months.forEach(function(m){var y=m.substring(0,4),mo=parseInt(m.substring(5,7));if(!years[y])years[y]={};years[y][mo]=returns[m];});
  var yKeys=Object.keys(years).sort();
  var moNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var h='<table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr><th style="padding:3px 6px;text-align:left;font-size:8px;color:var(--t3);border-bottom:1px solid var(--b1)">Year</th>';
  moNames.forEach(function(m){h+='<th style="padding:3px 4px;text-align:center;font-size:8px;color:var(--t3);border-bottom:1px solid var(--b1)">'+m+'</th>';});
  h+='<th style="padding:3px 6px;text-align:center;font-size:8px;color:var(--t3);border-bottom:1px solid var(--b1);font-weight:700">Year</th></tr></thead><tbody>';
  yKeys.forEach(function(y){
    h+='<tr><td style="padding:3px 6px;font-weight:700;font-family:var(--fm);border-bottom:1px solid var(--b1)">'+y+'</td>';
    var yt=0;
    for(var mo=1;mo<=12;mo++){var v=years[y][mo];if(v!==undefined){yt+=v;var bg=tsHC(v);var tc=Math.abs(v)>8?'#fff':'var(--t1)';h+='<td style="padding:3px 4px;text-align:center;font-family:var(--fm);font-weight:600;border-bottom:1px solid var(--b1);background:'+bg+';color:'+tc+'">'+(v>0?'+':'')+v.toFixed(2)+'</td>';}else{h+='<td style="padding:3px 4px;text-align:center;border-bottom:1px solid var(--b1);color:var(--t3)">—</td>';}}
    var yBg=tsHC(yt);var yTc=Math.abs(yt)>8?'#fff':'var(--t1)';
    h+='<td style="padding:3px 6px;text-align:center;font-family:var(--fm);font-weight:700;border-bottom:1px solid var(--b1);background:'+yBg+';color:'+yTc+'">'+(yt>0?'+':'')+yt.toFixed(2)+'%</td></tr>';
  });
  h+='</tbody></table>';return h;
}

function tsHC(v){
  if(v>10)return'rgba(0,180,80,0.5)';if(v>5)return'rgba(0,180,80,0.3)';if(v>2)return'rgba(0,180,80,0.15)';if(v>0)return'rgba(0,180,80,0.07)';
  if(v>-2)return'rgba(220,50,50,0.07)';if(v>-5)return'rgba(220,50,50,0.15)';if(v>-10)return'rgba(220,50,50,0.3)';return'rgba(220,50,50,0.5)';
}

function tsDrawdownTable(eq){
  var episodes=[],peak=eq[0].equity,peakDate=eq[0].date,cur=null;
  for(var i=1;i<eq.length;i++){var e=eq[i].equity;var dd=(peak-e)/peak*100;
    if(e>=peak){if(cur&&cur.maxDD>1){cur.recovery=eq[i].date;cur.duration=i-cur.si;episodes.push(cur);}cur=null;peak=e;peakDate=eq[i].date;}
    else{if(!cur)cur={si:i,start:peakDate,maxDD:dd,trough:eq[i].date};if(dd>cur.maxDD){cur.maxDD=dd;cur.trough=eq[i].date;}}
  }
  if(cur&&cur.maxDD>1){cur.duration=eq.length-cur.si;episodes.push(cur);}
  episodes.sort(function(a,b){return b.maxDD-a.maxDD;});
  var top5=episodes.slice(0,5);
  var h='<table style="width:100%;border-collapse:collapse;font-size:10px"><thead><tr>';
  ['#','Depth','Start','Trough','Recovery','Days'].forEach(function(c){h+='<th style="padding:3px 6px;font-size:8px;color:var(--t3);text-align:'+(c==='Depth'||c==='Days'?'right':'left')+';border-bottom:1px solid var(--b1)">'+c+'</th>';});
  h+='</tr></thead><tbody>';
  top5.forEach(function(ep,i){h+='<tr><td style="padding:3px 6px;border-bottom:1px solid var(--b1);font-weight:700;color:var(--t3)">'+(i+1)+'</td><td style="padding:3px 6px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm);font-weight:700;color:var(--rd)">-'+ep.maxDD.toFixed(2)+'%</td><td style="padding:3px 6px;border-bottom:1px solid var(--b1);font-family:var(--fm)">'+ep.start+'</td><td style="padding:3px 6px;border-bottom:1px solid var(--b1);font-family:var(--fm)">'+ep.trough+'</td><td style="padding:3px 6px;border-bottom:1px solid var(--b1);font-family:var(--fm)">'+(ep.recovery||'ongoing')+'</td><td style="padding:3px 6px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm)">'+(ep.duration||'—')+'</td></tr>';});
  if(!top5.length)h+='<tr><td colspan="6" style="padding:8px;color:var(--t3);text-align:center">No significant drawdowns</td></tr>';
  h+='</tbody></table>';return h;
}

function tsSummaryTable(d){
  var s=d.stats,eq=d.equity||[];var sortino=tsSortino(eq);
  var calmar=s.max_drawdown>0?(s.annual_return/s.max_drawdown).toFixed(2):'N/A';
  var wlRatio=Math.abs(s.avg_loss)>0?(Math.abs(s.avg_win)/Math.abs(s.avg_loss)).toFixed(2):'N/A';
  var wr=s.win_rate/100;var kelly=Math.abs(s.avg_loss)>0?((wr-(1-wr)/(Math.abs(s.avg_win)/Math.abs(s.avg_loss)))*100).toFixed(2)+'%':'N/A';
  var mr=tsMonthlyReturns(eq);var pm=mr.filter(function(r){return r>0;}).length;var nm=mr.filter(function(r){return r<0;}).length;
  var bm=mr.length?Math.max.apply(null,mr).toFixed(2)+'%':'N/A';var wm=mr.length?Math.min.apply(null,mr).toFixed(2)+'%':'N/A';
  var rows=[['Sharpe Ratio',s.sharpe.toFixed(2)],['Sortino Ratio',sortino.toFixed(2)],['Calmar Ratio',calmar],['Kelly Criterion',kelly],['Win/Loss Ratio',wlRatio],['Exposure',s.exposure+'%'],['',''],['Positive Months',pm+' / '+(pm+nm)],['Best Month',bm],['Worst Month',wm],['',''],['Max Consec. Wins',s.max_consec_wins],['Max Consec. Losses',s.max_consec_losses],['Avg Bars (win)',s.avg_hold_win+'d'],['Avg Bars (loss)',s.avg_hold_loss+'d'],['Largest Win','+'+s.largest_win+'%'],['Largest Loss',s.largest_loss+'%']];
  var h='<table style="width:100%;border-collapse:collapse;font-size:10px">';
  rows.forEach(function(r){if(!r[0])h+='<tr><td colspan="2" style="padding:2px;border-bottom:1px solid var(--b1)"></td></tr>';else h+='<tr><td style="padding:2px 6px;border-bottom:1px solid var(--b1);color:var(--t2)">'+r[0]+'</td><td style="padding:2px 6px;border-bottom:1px solid var(--b1);text-align:right;font-family:var(--fm);font-weight:600;color:var(--t1)">'+r[1]+'</td></tr>';});
  h+='</table>';return h;
}

function tsMonthlyReturns(eq){
  if(eq.length<10)return[];
  var byMonth={};eq.forEach(function(d){var ym=d.date.substring(0,7);if(!byMonth[ym])byMonth[ym]={first:d.equity,last:d.equity};byMonth[ym].last=d.equity;});
  var months=Object.keys(byMonth).sort();var rets=[];
  for(var i=1;i<months.length;i++){var prev=byMonth[months[i-1]].last;var cur=byMonth[months[i]].last;if(prev>0)rets.push((cur-prev)/prev*100);}
  return rets;
}

// ═══ CHARTS ═══

function tsUnderwaterRender(eq){
  var el=$('ts-underwater');if(!el||!eq||eq.length<5)return;
  var c=BL.init(el,'ts-uw');if(!c)return;
  var dates=[],dd=[],peak=eq[0].equity;
  for(var i=0;i<eq.length;i++){if(eq[i].equity>peak)peak=eq[i].equity;dates.push(eq[i].date);dd.push(Math.round(-(peak-eq[i].equity)/peak*10000)/100);}
  c.setOption({tooltip:{trigger:'axis',formatter:function(p){if(!p||!p[0])return'';return p[0].axisValue+'<br>DD: <b>'+p[0].value.toFixed(2)+'%</b>';}},grid:BL.grid({top:10,bottom:36}),dataZoom:BL.dataZoom(),xAxis:{type:'category',data:dates,axisLabel:{fontSize:8,interval:'auto'}},yAxis:{type:'value',max:0,axisLabel:{fontSize:8,formatter:function(v){return v.toFixed(2)+'%';}}},series:[{type:'line',data:dd,symbol:'none',lineStyle:{width:0.5,color:BL.colors.red},areaStyle:{color:'rgba(220,50,50,0.15)',opacity:1},itemStyle:{color:BL.colors.red}}]});
}

function tsRollingSharpeRender(eq){
  var el=$('ts-rolling-sharpe');if(!el||!eq||eq.length<70)return;
  var c=BL.init(el,'ts-rsharpe');if(!c)return;
  var win=60,dates=[],vals=[];
  for(var i=win;i<eq.length;i++){
    var rets=[];for(var j=i-win+1;j<=i;j++)rets.push((eq[j].equity-eq[j-1].equity)/eq[j-1].equity);
    var mean=rets.reduce(function(s,v){return s+v;},0)/rets.length;
    var std=Math.sqrt(rets.reduce(function(s,v){return s+(v-mean)*(v-mean);},0)/rets.length);
    dates.push(eq[i].date);vals.push(Math.round((std>0?(mean/std)*Math.sqrt(252):0)*100)/100);
  }
  if(!vals.length)return;
  c.setOption({tooltip:{trigger:'axis',formatter:function(p){if(!p||!p[0])return'';return p[0].axisValue+'<br>Sharpe: <b>'+p[0].value.toFixed(2)+'</b>';}},grid:BL.grid({top:10,bottom:36}),dataZoom:BL.dataZoom(),xAxis:{type:'category',data:dates,axisLabel:{fontSize:8,interval:'auto'}},yAxis:{type:'value',scale:true,axisLabel:{fontSize:8}},series:[{type:'line',data:vals,symbol:'none',lineStyle:{width:1.2,color:BL.colors.blue},itemStyle:{color:BL.colors.blue},markLine:{silent:true,symbol:'none',data:[{yAxis:0,lineStyle:{color:'#555',type:'dashed',width:0.5}}]}}]});
}

function tsRollingRetRender(eq){
  var el=$('ts-rolling-ret');if(!el||!eq)return;
  var windows=[];
  if(eq.length>=40)windows.push({n:30,name:'30d'});
  if(eq.length>=70)windows.push({n:60,name:'60d'});
  if(eq.length>=100)windows.push({n:90,name:'90d'});
  if(!windows.length)return;
  var c=BL.init(el,'ts-rret');if(!c)return;
  var sm=windows[0],xDates=[];
  for(var i=sm.n;i<eq.length;i++)xDates.push(eq[i].date);
  var colors=[BL.colors.blue,BL.colors.green,'#e8a838'];
  var series=windows.map(function(w,wi){
    var vals=[];for(var i=sm.n;i<eq.length;i++){if(i>=w.n)vals.push(Math.round((eq[i].equity-eq[i-w.n].equity)/eq[i-w.n].equity*10000)/100);else vals.push(null);}
    return{name:w.name,type:'line',data:vals,symbol:'none',lineStyle:{width:1,color:colors[wi]},itemStyle:{color:colors[wi]},connectNulls:false};
  });
  c.setOption({tooltip:{trigger:'axis'},legend:{data:windows.map(function(w){return w.name;}),top:0,left:0,textStyle:{fontSize:8}},grid:BL.grid({top:22,bottom:36}),dataZoom:BL.dataZoom(),xAxis:{type:'category',data:xDates,axisLabel:{fontSize:8,interval:'auto'}},yAxis:{type:'value',scale:true,axisLabel:{fontSize:8,formatter:function(v){return v.toFixed(2)+'%';}}},series:series});
}

function tsStreaksRender(trades){
  var el=$('ts-streaks');if(!el||!trades||trades.length<3)return;
  var c=BL.init(el,'ts-streaks');if(!c)return;
  var streaks=[],cur=0,curType=null;
  trades.forEach(function(t){var win=(t.pnlP||0)>0;if(curType===null){curType=win;cur=1;}else if(win===curType)cur++;else{streaks.push({type:curType,len:cur});curType=win;cur=1;}});
  if(cur>0)streaks.push({type:curType,len:cur});
  if(!streaks.length)return;
  var data=streaks.map(function(s){return{value:s.type?s.len:-s.len,itemStyle:{color:s.type?BL.colors.green:BL.colors.red}};});
  c.setOption({tooltip:{trigger:'axis',formatter:function(p){if(!p||!p[0])return'';var v=p[0].value;return'Streak: '+(v>0?'Win +'+v:'Loss '+v);}},grid:BL.grid({top:10,bottom:8,left:40}),xAxis:{type:'category',data:streaks.map(function(_,i){return''+(i+1);}),axisLabel:{fontSize:7,interval:Math.max(0,Math.floor(streaks.length/20))}},yAxis:{type:'value',axisLabel:{fontSize:8}},series:[{type:'bar',data:data,barMaxWidth:30}]});
}

function tsDurationRender(trades){
  var el=$('ts-duration');if(!el||!trades||trades.length<3)return;
  var c=BL.init(el,'ts-dur');if(!c)return;
  var bk=[{l:'1-3d',mn:0,mx:3,c:0},{l:'4-7d',mn:4,mx:7,c:0},{l:'8-14d',mn:8,mx:14,c:0},{l:'15-30d',mn:15,mx:30,c:0},{l:'31-60d',mn:31,mx:60,c:0},{l:'60d+',mn:61,mx:9999,c:0}];
  trades.forEach(function(t){var d=t.bars||0;for(var b=0;b<bk.length;b++){if(d>=bk[b].mn&&d<=bk[b].mx){bk[b].c++;break;}}});
  c.setOption({tooltip:{trigger:'axis',formatter:function(p){if(!p||!p[0])return'';return p[0].axisValue+': <b>'+p[0].value+'</b> trades';}},grid:BL.grid({top:10,bottom:8,left:40}),xAxis:{type:'category',data:bk.map(function(b){return b.l;}),axisLabel:{fontSize:9}},yAxis:{type:'value',minInterval:1,axisLabel:{fontSize:8}},series:[{type:'bar',data:bk.map(function(b){return b.c;}),itemStyle:{color:BL.colors.blue},barWidth:'55%'}]});
}

function tsDOWRender(trades){
  var el=$('ts-dow-chart');if(!el||!trades||trades.length<5)return;
  var c=BL.init(el,'ts-dowc');if(!c)return;
  var days=['Mon','Tue','Wed','Thu','Fri'];
  var dd={0:[],1:[],2:[],3:[],4:[]};
  trades.forEach(function(t){if(!t.ed)return;try{var d=new Date(t.ed).getDay()-1;if(d>=0&&d<=4)dd[d].push(t.pnlP||0);}catch(e){}});
  var avg=days.map(function(_,i){var a=dd[i];return a.length?Math.round(a.reduce(function(s,v){return s+v;},0)/a.length*100)/100:0;});
  var wr=days.map(function(_,i){var a=dd[i];return a.length?Math.round(a.filter(function(v){return v>0;}).length/a.length*100):0;});
  c.setOption({tooltip:{trigger:'axis'},legend:{data:['Avg Ret %','Win Rate %'],top:0,left:0,textStyle:{fontSize:8}},grid:BL.grid({top:22,bottom:8,left:40,right:40}),xAxis:{type:'category',data:days,axisLabel:{fontSize:10}},yAxis:[{type:'value',axisLabel:{fontSize:8,formatter:function(v){return v+'%';}}},{type:'value',min:0,max:100,axisLabel:{fontSize:8,formatter:function(v){return v+'%';}},splitLine:{show:false}}],series:[{name:'Avg Ret %',type:'bar',data:avg.map(function(v){return{value:v,itemStyle:{color:v>=0?BL.colors.green:BL.colors.red}};}),barWidth:'35%'},{name:'Win Rate %',type:'line',yAxisIndex:1,data:wr,symbol:'circle',symbolSize:6,lineStyle:{width:1.5,color:'#e8a838'},itemStyle:{color:'#e8a838'}}]});
}

function tsCumPnlRender(trades,capital){
  var el=$('ts-cum-pnl');if(!el||!trades||trades.length<3)return;
  var c=BL.init(el,'ts-cumpnl');if(!c)return;
  var cats=[],vals=[],cum=0;
  trades.forEach(function(t,i){cats.push('#'+(i+1));cum+=(t.pnl||0);vals.push(cum);});
  if(!vals.length)return;
  var lc=vals[vals.length-1]>=0?BL.colors.green:BL.colors.red;
  c.setOption({tooltip:{trigger:'axis',formatter:function(p){if(!p||!p[0])return'';return'Trade '+p[0].axisValue+'<br>Cum: <b>'+BL.fmtRp(p[0].value)+'</b>';}},grid:BL.grid({top:10,bottom:36}),dataZoom:BL.dataZoom(),xAxis:{type:'category',data:cats,axisLabel:{fontSize:7,interval:Math.max(0,Math.floor(trades.length/15))}},yAxis:{type:'value',scale:true,axisLabel:{fontSize:8,formatter:function(v){return BL.fmtRp(v);}}},series:[{type:'line',data:vals,symbol:'none',lineStyle:{width:1.5,color:lc},itemStyle:{color:lc},areaStyle:{color:lc,opacity:0.08}}]});
}

// ═══ STRATEGY COMMENTARY — auto-generated analysis ═══
function tsCommentary(d,sortino){
  var s=d.stats,trades=d.trades||[],eq=d.equity||[];
  var mr=tsMonthlyReturns(eq);
  var posMonths=mr.filter(function(r){return r>0;}).length;
  var totalMonths=mr.length;
  var calmar=s.max_drawdown>0?s.annual_return/s.max_drawdown:0;
  var wr=s.win_rate/100;
  var kelly=Math.abs(s.avg_loss)>0?(wr-(1-wr)/(Math.abs(s.avg_win)/Math.abs(s.avg_loss)))*100:0;

  // ── Overall Verdict ──
  var score=0;
  if(s.total_return>0)score++;if(s.total_return>20)score++;
  if(s.sharpe>=1)score++;if(s.sharpe>=2)score++;
  if(sortino>=1.5)score++;
  if(s.win_rate>=50)score++;
  if(s.profit_factor>=1.5)score++;if(s.profit_factor>=2)score++;
  if(s.max_drawdown<20)score++;if(s.max_drawdown<10)score++;
  if(s.expectancy>0)score++;
  if(calmar>=1)score++;
  // score 0-12

  var verdict,verdictColor,verdictIcon;
  if(score>=10){verdict='EXCELLENT';verdictColor='#00cc66';verdictIcon='🟢';}
  else if(score>=7){verdict='GOOD';verdictColor='#66bb6a';verdictIcon='🟢';}
  else if(score>=5){verdict='MODERATE';verdictColor='#e8a838';verdictIcon='🟡';}
  else if(score>=3){verdict='WEAK';verdictColor='#ff8a65';verdictIcon='🟠';}
  else{verdict='POOR';verdictColor='#ef5350';verdictIcon='🔴';}

  var h='<div style="background:var(--bg2);border:1px solid var(--b2);border-radius:8px;padding:12px 16px;margin-bottom:14px">';

  // Header with verdict badge
  h+='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">';
  h+='<div style="font-size:10px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.5px">Strategy Commentary</div>';
  h+='<div style="padding:2px 10px;border-radius:4px;background:'+verdictColor+'22;border:1px solid '+verdictColor+'44;font-size:11px;font-weight:700;color:'+verdictColor+'">'+verdictIcon+' '+verdict+'</div>';
  h+='<div style="font-size:9px;color:var(--t3)">(score '+score+'/12)</div>';
  h+='</div>';

  // Commentary paragraphs
  h+='<div style="font-size:11px;line-height:1.7;color:var(--t2)">';

  // ── Return Analysis ──
  if(s.total_return>0){
    h+='<p style="margin:0 0 8px">Strategy menghasilkan <b style="color:var(--gn)">'+btP(s.total_return)+'</b> net return selama '+d.period.days+' hari (annualized '+btP(s.annual_return)+')';
    if(s.alpha>0)h+=', menghasilkan <b style="color:var(--gn)">alpha +'+s.alpha+'%</b> di atas benchmark '+d.benchmark;
    else if(s.alpha<0)h+=', <b style="color:var(--rd)">underperform '+Math.abs(s.alpha)+'%</b> vs benchmark '+d.benchmark;
    h+='.</p>';
  }else{
    h+='<p style="margin:0 0 8px">Strategy <b style="color:var(--rd)">rugi '+Math.abs(s.total_return)+'%</b> selama '+d.period.days+' hari. Perlu evaluasi ulang entry/exit criteria.</p>';
  }

  // ── Risk Assessment ──
  var riskItems=[];
  if(s.max_drawdown>30)riskItems.push('Max drawdown <b style="color:var(--rd)">-'+s.max_drawdown+'%</b> sangat tinggi — pertimbangkan risk control atau position sizing yang lebih ketat');
  else if(s.max_drawdown>20)riskItems.push('Max drawdown <b style="color:var(--rd)">-'+s.max_drawdown+'%</b> cukup besar — monitor closely, bisa psikologis berat untuk ditahan');
  else if(s.max_drawdown>10)riskItems.push('Max drawdown <b>-'+s.max_drawdown+'%</b> moderate — dalam batas toleransi normal');
  else riskItems.push('Max drawdown hanya <b style="color:var(--gn)">-'+s.max_drawdown+'%</b> — risk control sangat baik');

  if(s.sharpe<0.5)riskItems.push('Sharpe <b>'+s.sharpe.toFixed(2)+'</b> rendah — return tidak cukup mengkompensasi volatilitas');
  else if(s.sharpe>=1)riskItems.push('Sharpe <b style="color:var(--gn)">'+s.sharpe.toFixed(2)+'</b> solid — risk-adjusted return baik');

  if(sortino>=2)riskItems.push('Sortino <b style="color:var(--gn)">'+sortino.toFixed(2)+'</b> excellent — downside volatility terkontrol dengan baik');
  else if(sortino<0.5)riskItems.push('Sortino <b>'+sortino.toFixed(2)+'</b> rendah — banyak downside volatility');

  h+='<p style="margin:0 0 8px"><b>Risk:</b> '+riskItems.join('. ')+'.</p>';

  // ── Trade Quality ──
  var tradeItems=[];
  if(s.win_rate>=55)tradeItems.push('Win rate <b style="color:var(--gn)">'+s.win_rate+'%</b> — mayoritas trades profitable');
  else if(s.win_rate>=45)tradeItems.push('Win rate <b>'+s.win_rate+'%</b> — di sekitar 50/50, strategy bergantung pada payoff ratio');
  else tradeItems.push('Win rate <b style="color:var(--rd)">'+s.win_rate+'%</b> rendah — perlu average win yang jauh lebih besar dari average loss untuk profitable');

  if(s.payoff_ratio>=2)tradeItems.push('Payoff ratio <b style="color:var(--gn)">'+s.payoff_ratio.toFixed(2)+'x</b> — winner jauh lebih besar dari loser');
  else if(s.payoff_ratio<1)tradeItems.push('Payoff ratio <b style="color:var(--rd)">'+s.payoff_ratio.toFixed(2)+'x</b> — average loss lebih besar dari average win, berbahaya');

  if(s.profit_factor>=2)tradeItems.push('Profit factor <b style="color:var(--gn)">'+s.profit_factor.toFixed(2)+'</b> kuat');
  else if(s.profit_factor<1)tradeItems.push('Profit factor <b style="color:var(--rd)">'+s.profit_factor.toFixed(2)+'</b> — total loss > total profit');

  h+='<p style="margin:0 0 8px"><b>Trade Quality:</b> '+tradeItems.join('. ')+'.</p>';

  // ── Consistency ──
  var consItems=[];
  if(totalMonths>0){
    var monthPct=Math.round(posMonths/totalMonths*100);
    if(monthPct>=60)consItems.push(posMonths+' dari '+totalMonths+' bulan positif (<b style="color:var(--gn)">'+monthPct+'%</b>) — cukup konsisten');
    else if(monthPct>=40)consItems.push(posMonths+' dari '+totalMonths+' bulan positif (<b>'+monthPct+'%</b>) — konsistensi moderate');
    else consItems.push('Hanya '+posMonths+' dari '+totalMonths+' bulan positif (<b style="color:var(--rd)">'+monthPct+'%</b>) — sangat tidak konsisten');
  }

  if(s.max_consec_losses>=8)consItems.push('Max consecutive loss <b style="color:var(--rd)">'+s.max_consec_losses+' trades</b> — sangat menguji psikologi, pastikan sizing manageable');
  else if(s.max_consec_losses>=5)consItems.push('Max consecutive loss <b>'+s.max_consec_losses+' trades</b> — normal tapi perlu mental preparedness');

  if(s.recovery_factor>=2)consItems.push('Recovery factor <b style="color:var(--gn)">'+s.recovery_factor+'</b> — recover dengan baik dari drawdown');
  else if(s.recovery_factor<1)consItems.push('Recovery factor <b style="color:var(--rd)">'+s.recovery_factor+'</b> — slow recovery, belum fully recover dari drawdown terbesar');

  if(consItems.length)h+='<p style="margin:0 0 8px"><b>Consistency:</b> '+consItems.join('. ')+'.</p>';

  // ── Sizing Guidance ──
  if(kelly>0&&kelly<50){
    h+='<p style="margin:0 0 8px"><b>Position Sizing:</b> Kelly Criterion suggest <b>'+kelly.toFixed(2)+'%</b> of capital per trade. Praktisnya gunakan half-Kelly (<b>'+Math.round(kelly/2)+'%</b>) untuk lebih konservatif.</p>';
  }else if(kelly<=0){
    h+='<p style="margin:0 0 8px"><b>Position Sizing:</b> Kelly Criterion <b style="color:var(--rd)">negatif</b> — secara matematis, strategy ini tidak layak di-bet. Perbaiki edge sebelum deploy modal.</p>';
  }

  // ── Key Warning ──
  var warnings=[];
  if(trades.length<30)warnings.push('Jumlah trades (<b>'+trades.length+'</b>) terlalu sedikit untuk kesimpulan statistik yang reliable — minimum 30-50 trades recommended');
  if(s.largest_loss&&Math.abs(parseFloat(s.largest_loss))>20)warnings.push('Largest single loss <b style="color:var(--rd)">'+s.largest_loss+'%</b> — consider tighter stop loss');
  if(s.exposure>=95)warnings.push('Exposure <b>'+s.exposure+'%</b> — hampir selalu fully invested, tidak ada cash buffer untuk opportunity');
  if(d.period.days<180)warnings.push('Backtest period hanya <b>'+d.period.days+' hari</b> — terlalu pendek untuk validasi. Idealnya 2-3 tahun minimum');

  if(warnings.length){
    h+='<p style="margin:0;padding:6px 10px;background:rgba(220,50,50,0.08);border-radius:4px;border-left:3px solid var(--rd)"><b>⚠️ Warning:</b> '+warnings.join('. ')+'.</p>';
  }

  h+='</div></div>';
  return h;
}

function tsCopyStats(){
  if(!btR||!btR.stats)return;var s=btR.stats;var sortino=tsSortino(btR.equity||[]);
  var txt='Strategy Tearsheet\n'+btR.period.start+' → '+btR.period.end+' ('+btR.period.days+' days)\n\n';
  txt+='Net Return: '+s.total_return+'%\nAnnual Return: '+s.annual_return+'%\nSharpe: '+s.sharpe.toFixed(2)+'\nSortino: '+sortino.toFixed(2)+'\nMax DD: -'+s.max_drawdown+'%\nWin Rate: '+s.win_rate+'%\nProfit Factor: '+s.profit_factor.toFixed(2)+'\nExpectancy: '+s.expectancy+'%\nTotal Trades: '+s.total_trades+'\nAvg P&L: '+s.avg_pl_pct+'%\n';
  navigator.clipboard.writeText(txt).then(function(){showT('Copied','Stats copied to clipboard');}).catch(function(){});
}
