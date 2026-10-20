// ═══ PORTFOLIO — Lot Sizing + Trade Tracker ═══
var pfView='calc',pfSettings=null,pfKelly=null,pfTicker=null;
var lsCode='',lsRisk=1,lsFee=0.4,lsResult=null;

async function loadPortfolio(){
  var el=$('pf-content');if(!el)return;
  if(!pfSettings){try{var r=await fetch('/api/portfolio/settings');pfSettings=await r.json();}catch(e){pfSettings={capital:100000000,win_rate:50,risk_per_trade:2,kelly_fraction:50};}}
  renderPortfolio();
}

function renderPortfolio(){
  var el=$('pf-content');if(!el)return;
  var h='<div style="height:100%;display:flex;flex-direction:column;overflow:hidden">';
  h+='<div style="display:flex;gap:3px;padding:8px 12px;border-bottom:1px solid var(--b1);flex-shrink:0">';
  [{k:'calc',l:'🧮 Lot Sizing'},{k:'open',l:'📂 Open'},{k:'history',l:'📋 History'},{k:'settings',l:'⚙ Settings'}].forEach(function(t){
    h+='<button class="bei-sort-btn'+(pfView===t.k?' on':'')+'" onclick="pfView=\''+t.k+'\';renderPortfolio()" style="padding:5px 12px;font-size:11px">'+t.l+'</button>';
  });
  h+='</div><div style="flex:1;overflow-y:auto;padding:12px" id="pf-body"></div></div>';
  el.innerHTML=h;
  var body=$('pf-body');
  if(pfView==='calc')renderCalc(body);
  else if(pfView==='open')renderTrades(body,'open');
  else if(pfView==='history')renderTrades(body,'closed');
  else if(pfView==='settings')renderSettings(body);
}

function renderCalc(el){
  var bal=pfSettings?pfSettings.capital:100000000;
  var t=pfTicker;
  var h='';

  h+='<div style="display:flex;gap:6px;align-items:center;margin-bottom:12px">';
  h+='<input id="ls-code" value="'+esc(lsCode)+'" placeholder="Ticker" onkeydown="if(event.key===\'Enter\')lsLoad()" style="width:110px;padding:8px 10px;background:var(--bgH);border:1px solid var(--b2);border-radius:8px;font-family:var(--fm);font-size:14px;font-weight:700;text-transform:uppercase;color:var(--t1);outline:none">';
  h+='<button onclick="lsLoad()" style="padding:8px 16px;border-radius:8px;border:none;background:var(--bl);color:#fff;font-weight:700;font-size:12px;cursor:pointer">Load</button>';
  h+='<span style="font-size:10px;color:var(--t3)">Enter ticker → auto-load price, ATR, support levels</span></div>';

  if(t){
    h+='<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px">';
    h+='<span style="font-size:20px;font-weight:800;font-family:var(--fm);color:var(--bl)">'+t.code+'</span>';
    h+='<span style="font-size:11px;color:var(--t2)">'+esc(t.name||'')+'</span>';
    h+='<span style="flex:1"></span>';
    h+='<span style="font-size:22px;font-weight:800;font-family:var(--fm)">'+t.close.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+'</span></div>';

    h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;padding:6px 10px;background:var(--bgH);border-radius:6px;font-family:var(--fm);font-size:10px;color:var(--t2)">';
    if(t.atr)h+='<span>ATR(14): <b style="color:var(--t1)">'+t.atr+'</b></span>';
    if(t.ma20)h+='<span>MA20: <b style="color:var(--t1)">'+t.ma20.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+'</b></span>';
    if(t.ma50)h+='<span>MA50: <b style="color:var(--t1)">'+t.ma50.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+'</b></span>';
    if(t.ma200)h+='<span>MA200: <b style="color:var(--t1)">'+t.ma200.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+'</b></span>';
    if(t.low20)h+='<span>Low20: <b style="color:var(--t1)">'+t.low20.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+'</b></span>';
    h+='<span>H: <b>'+t.high.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+'</b> L: <b>'+t.low.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+'</b></span></div>';

    // 4 entry prices
    h+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-bottom:8px">';
    for(var i=1;i<=4;i++){
      h+='<div><div style="font-size:8px;color:var(--t3);font-weight:600;margin-bottom:2px">Entry Price '+i+'</div>';
      h+='<div style="display:flex;align-items:center;background:var(--bgH);border:1px solid var(--b2);border-radius:6px;padding:0 6px">';
      h+='<span style="font-size:9px;color:var(--t3)">Rp</span>';
      h+='<input id="ls-e'+i+'" type="number" value="'+(i===1?t.close:'')+'" placeholder="'+(i===1?'Entry':'Optional')+'" style="flex:1;background:none;border:none;padding:5px 4px;font-family:var(--fm);font-size:12px;color:var(--t1);outline:none">';
      h+='</div></div>';
    }
    h+='</div>';

    // SL, Risk, Fee, Balance
    h+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-bottom:10px">';
    h+='<div><div style="font-size:8px;color:var(--t3);font-weight:600;margin-bottom:2px">SL Price</div>';
    h+='<div style="display:flex;align-items:center;background:var(--bgH);border:1px solid var(--b2);border-radius:6px;padding:0 6px"><span style="font-size:9px;color:var(--t3)">Rp</span>';
    h+='<input id="ls-sl" type="number" placeholder="Stop loss" style="flex:1;background:none;border:none;padding:5px 4px;font-family:var(--fm);font-size:12px;color:var(--t1);outline:none"></div></div>';
    h+='<div><div style="font-size:8px;color:var(--t3);font-weight:600;margin-bottom:2px">Risk</div>';
    h+='<select id="ls-risk" style="width:100%;padding:5px 4px;background:var(--bgH);border:1px solid var(--b2);border-radius:6px;font-size:11px;color:var(--t1);outline:none">';
    [{v:0.5,l:'[0.5%] Defensive'},{v:1,l:'[1.0%] Standard'},{v:1.5,l:'[1.5%] Optimistic'},{v:2,l:'[2.0%] Aggressive'},{v:2.5,l:'[2.5%] Risky'},{v:3,l:'[3.0%] High Risk'},{v:5,l:'[5.0%] Dangerous'}].forEach(function(r){
      h+='<option value="'+r.v+'"'+(lsRisk===r.v?' selected':'')+'>'+r.l+'</option>';});
    h+='</select></div>';
    h+='<div><div style="font-size:8px;color:var(--t3);font-weight:600;margin-bottom:2px">Fee</div>';
    h+='<input id="ls-fee" type="number" step="0.05" value="'+lsFee+'" style="width:100%;padding:5px 6px;background:var(--bgH);border:1px solid var(--b2);border-radius:6px;font-family:var(--fm);font-size:12px;color:var(--t1);outline:none"></div>';
    h+='<div><div style="font-size:8px;color:var(--t3);font-weight:600;margin-bottom:2px">Balance <span style="color:var(--rd)">(bukan equity)</span></div>';
    h+='<div style="display:flex;align-items:center;background:var(--bgH);border:1px solid var(--b2);border-radius:6px;padding:0 6px"><span style="font-size:9px;color:var(--t3)">Rp</span>';
    h+='<input id="ls-bal" type="number" value="'+(bal/1e6)+'" style="flex:1;background:none;border:none;padding:5px 4px;font-family:var(--fm);font-size:12px;color:var(--t1);outline:none">';
    h+='<span style="font-size:9px;color:var(--t3)">jt</span></div></div></div>';

    h+='<div style="display:flex;gap:8px;justify-content:center;margin-bottom:14px">';
    h+='<button onclick="lsCalc()" style="padding:8px 32px;border-radius:8px;border:none;background:var(--bl);color:#fff;font-size:13px;font-weight:700;cursor:pointer">📊 Calculate</button>';
    h+='<button onclick="lsReset()" style="padding:8px 14px;border-radius:8px;border:1px solid var(--b2);background:var(--bg2);color:var(--t2);font-size:13px;cursor:pointer">↺</button></div>';

    h+='<div id="ls-result">'+(lsResult?renderLsResult():'')+'</div>';

    if(pfKelly){var k=pfKelly;
      h+='<div style="margin-top:12px;padding:8px 12px;background:var(--bgH);border-radius:8px;display:flex;gap:14px;flex-wrap:wrap;font-size:10px">';
      h+='<span style="font-weight:700">📊 Kelly</span>';
      h+='<span>WR: <b>'+k.stats.win_rate+'%</b> ('+k.stats.source+')</span>';
      h+='<span>R:R: <b>'+k.stats.rr+'</b></span>';
      h+='<span>Raw: <b style="color:var(--gn)">'+k.kelly.raw+'%</b></span>';
      h+='<span>Adj: <b style="color:var(--bl)">'+k.kelly.adjusted+'%</b></span>';
      h+='<span>Trades: '+k.stats.total_trades+' (W:'+k.stats.wins+' L:'+k.stats.losses+')</span></div>';}
  }else{
    h+='<div style="text-align:center;padding:40px;color:var(--t3)"><div style="font-size:32px;margin-bottom:8px">🧮</div><div>Enter ticker and click Load</div></div>';
  }
  el.innerHTML=h;
}

async function lsLoad(){
  var code=($('ls-code')?$('ls-code').value:'').toUpperCase().trim();if(!code)return;lsCode=code;lsResult=null;
  try{var r=await fetch('/api/portfolio/kelly?code='+code);var d=await r.json();pfKelly=d;pfTicker=d.ticker;renderCalc($('pf-body'));}catch(e){showT('❌','Failed');}
}
function lsReset(){lsResult=null;var el=$('ls-result');if(el)el.innerHTML='';}

function lsCalc(){
  var entries=[];
  for(var i=1;i<=4;i++){var v=parseFloat($('ls-e'+i)?$('ls-e'+i).value:0);if(v>0)entries.push(v);}
  if(!entries.length){showT('⚠️','Enter at least 1 entry price');return;}
  var sl=parseFloat($('ls-sl')?$('ls-sl').value:0);if(!sl){showT('⚠️','Enter stop loss');return;}
  var risk=parseFloat($('ls-risk')?$('ls-risk').value:1);
  var fee=parseFloat($('ls-fee')?$('ls-fee').value:0.4);
  var balJt=parseFloat($('ls-bal')?$('ls-bal').value:0);var bal=balJt*1e6;
  if(!bal){showT('⚠️','Enter balance');return;}
  lsRisk=risk;lsFee=fee;

  var maxRisk=bal*(risk/100);var riskEach=maxRisk/entries.length;
  var rows=[],totalLots=0,totalCost=0;
  entries.forEach(function(entry){
    var rps=Math.abs(entry-sl);if(rps<=0)return;
    var lots=Math.floor(Math.floor(riskEach/rps)/100);if(lots<1)lots=1;
    var shares=lots*100;var cost=entry*shares;
    totalLots+=lots;totalCost+=cost;
    rows.push({entry:entry,sl:sl,lots:lots,shares:shares,cost:cost,pctM:bal>0?(cost/bal*100):0,rps:rps});
  });
  var avgEntry=totalCost>0?totalCost/(totalLots*100):0;
  lsResult={rows:rows,totalLots:totalLots,totalCost:totalCost,totalPctM:bal>0?(totalCost/bal*100):0,avgEntry:avgEntry,sl:sl,fee:totalCost*(fee/100),estLoss:Math.abs(avgEntry-sl)*(totalLots*100),bal:bal,risk:risk};
  var el=$('ls-result');if(el)el.innerHTML=renderLsResult();
}

function renderLsResult(){
  var r=lsResult;if(!r||!r.rows.length)return'';
  var h='<table class="bei-tbl" style="font-size:11px;margin-bottom:10px"><thead><tr>';
  h+='<th class="ar">Entry</th><th class="ar">SL</th><th class="ar">Lot</th><th class="ar">%m</th><th class="ar">Rp</th></tr></thead><tbody>';
  r.rows.forEach(function(row){
    h+='<tr><td class="ar" style="font-family:var(--fm)">'+row.entry.toLocaleString()+'</td>';
    h+='<td class="ar" style="font-family:var(--fm)">'+row.sl.toLocaleString()+'</td>';
    h+='<td class="ar" style="font-family:var(--fm);font-weight:700;color:var(--bl)">'+row.lots.toLocaleString()+'</td>';
    h+='<td class="ar" style="font-family:var(--fm)">'+row.pctM.toFixed(2)+'</td>';
    h+='<td class="ar" style="font-family:var(--fm)">'+row.cost.toLocaleString()+'</td></tr>';
  });
  h+='<tr style="font-weight:700;border-top:2px solid var(--b2)"><td colspan="2" class="ar">Total</td>';
  h+='<td class="ar" style="font-family:var(--fm);color:var(--bl)">'+r.totalLots.toLocaleString()+'</td>';
  h+='<td class="ar" style="font-family:var(--fm)">'+r.totalPctM.toFixed(2)+'</td>';
  h+='<td class="ar" style="font-family:var(--fm)">'+r.totalCost.toLocaleString()+'</td></tr></tbody></table>';

  h+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-bottom:10px">';
  h+=lsCard('Estimated Average','Rp '+Math.round(r.avgEntry).toLocaleString(),'var(--t1)');
  h+=lsCard('Estimated Loss','Rp '+fmtRp(r.estLoss),'var(--rd)');
  h+='<div style="background:var(--bgH);border-radius:6px;padding:6px 8px"><div style="font-size:8px;color:var(--t3);font-weight:600;margin-bottom:2px">TP</div>';
  h+='<div style="display:flex;align-items:center;gap:2px"><span style="font-size:9px;color:var(--t3)">Rp</span>';
  h+='<input id="ls-tp" type="number" placeholder="Target" oninput="lsTP()" style="flex:1;background:none;border:none;font-family:var(--fm);font-size:12px;color:var(--t1);outline:none;width:60px"></div></div>';
  h+='<div style="background:var(--bgH);border-radius:6px;padding:6px 8px"><div style="font-size:8px;color:var(--t3);font-weight:600;margin-bottom:2px">Estimated Profit</div>';
  h+='<div id="ls-profit" style="font-weight:700;font-family:var(--fm);font-size:12px;color:var(--gn)">—</div></div></div>';

  h+='<div style="display:flex;gap:12px;font-size:10px;color:var(--t3);margin-bottom:8px"><span>Fee (buy): '+fmtRp(r.fee)+'</span><span>Risk: '+r.risk+'% of '+fmtRp(r.bal)+'</span></div>';
  h+='<button onclick="lsSave()" style="width:100%;padding:8px;border-radius:8px;border:none;background:var(--gn);color:#fff;font-size:12px;font-weight:700;cursor:pointer">💾 Save Trade</button>';
  return h;
}
function lsCard(l,v,c){return'<div style="background:var(--bgH);border-radius:6px;padding:6px 8px"><div style="font-size:8px;color:var(--t3);font-weight:600;margin-bottom:2px">'+l+'</div><div style="font-weight:700;font-family:var(--fm);font-size:12px;color:'+c+'">'+v+'</div></div>';}
function lsTP(){var tp=parseFloat($('ls-tp')?$('ls-tp').value:0);var el=$('ls-profit');if(!el||!lsResult)return;if(!tp){el.textContent='—';return;}var p=Math.abs(tp-lsResult.avgEntry)*(lsResult.totalLots*100);var up=tp>lsResult.avgEntry;el.style.color=up?'var(--gn)':'var(--rd)';el.textContent=(up?'+':'-')+' Rp '+fmtRp(p);}
async function lsSave(){if(!lsCode||!lsResult){showT('⚠️','Calculate first');return;}var tp=parseFloat($('ls-tp')?$('ls-tp').value:0)||0;try{await fetch('/api/portfolio/trades',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:lsCode.toUpperCase(),name:pfTicker?pfTicker.name:'',entry_price:Math.round(lsResult.avgEntry),lots:lsResult.totalLots,stop_loss:lsResult.sl,target_price:tp,notes:'Risk:'+lsRisk+'% Entries:'+lsResult.rows.map(function(r){return r.entry;}).join('/')})});showT('💾',lsCode+' '+lsResult.totalLots+' lots saved');}catch(e){showT('❌','Error');}}

// ═══ TRADES ═══
async function renderTrades(el,status){el.innerHTML=skelRows(5);try{var r=await fetch('/api/portfolio/trades?status='+status);var trades=await r.json();if(!trades.length){el.innerHTML='<div class="ne">No '+status+' trades</div>';return;}var h='<table class="bei-tbl" style="font-size:10px"><thead><tr><th class="al">Code</th><th class="ar">Entry</th><th class="ar">Lots</th><th class="ar">SL</th><th class="ar">TP</th>';h+=status==='open'?'<th class="ar">Current</th>':'<th class="ar">Exit</th>';h+='<th class="ar">P&L</th><th class="al">Date</th><th></th></tr></thead><tbody>';trades.forEach(function(t){var pnl=0;if(status==='open'&&t.current_price)pnl=(t.current_price-t.entry_price)*t.lots*100;else if(t.exit_price)pnl=(t.exit_price-t.entry_price)*(t.exit_lots||t.lots)*100;var pc=pnl>0?'up':pnl<0?'dn':'';h+='<tr><td><span class="code" onclick="gsOpen(\''+esc(t.code)+'\')">'+esc(t.code)+'</span></td><td class="ar" style="font-family:var(--fm)">'+t.entry_price.toLocaleString()+'</td><td class="ar" style="font-family:var(--fm)">'+t.lots.toLocaleString()+'</td><td class="ar" style="font-family:var(--fm)">'+(t.stop_loss||'—')+'</td><td class="ar" style="font-family:var(--fm)">'+(t.target_price||'—')+'</td><td class="ar" style="font-family:var(--fm)">'+(status==='open'?(t.current_price?t.current_price.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'—'):(t.exit_price?t.exit_price.toLocaleString():'—'))+'</td><td class="ar '+pc+'" style="font-family:var(--fm);font-weight:600">'+fmtRp(pnl)+'</td><td style="font-size:9px;color:var(--t3)">'+esc(t.entry_date||'')+'</td><td style="white-space:nowrap">';if(status==='open')h+='<button class="bei-sort-btn" onclick="pfClose('+t.id+')" style="font-size:9px;padding:2px 6px">Close</button> ';h+='<button class="bei-sort-btn" onclick="pfDel('+t.id+')" style="font-size:9px;padding:2px 6px;color:var(--rd)">✕</button></td></tr>';});h+='</tbody></table>';el.innerHTML=h;}catch(e){el.innerHTML='<div class="ne">Error</div>';}}
async function pfClose(id){var p=prompt('Exit price:');if(!p)return;try{await fetch('/api/portfolio/trades/'+id+'/close',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({exit_price:parseFloat(p)})});renderPortfolio();}catch(e){}}
async function pfDel(id){if(!confirm('Delete?'))return;try{await fetch('/api/portfolio/trades/'+id,{method:'DELETE'});renderPortfolio();}catch(e){}}

// ═══ SETTINGS ═══
function renderSettings(el){var s=pfSettings||{capital:100000000,win_rate:50,risk_per_trade:2,kelly_fraction:50};var h='<div style="max-width:400px"><div style="font-size:15px;font-weight:800;margin-bottom:12px">⚙ Portfolio Settings</div>';[{id:'pf-cap',l:'Capital (IDR)',v:s.capital},{id:'pf-wr',l:'Win Rate (%)',v:s.win_rate},{id:'pf-rpt',l:'Risk per Trade (%)',v:s.risk_per_trade},{id:'pf-kf',l:'Kelly Fraction (%)',v:s.kelly_fraction}].forEach(function(f){h+='<div style="margin-bottom:8px"><div style="font-size:10px;color:var(--t3);font-weight:600;margin-bottom:3px">'+f.l+'</div><input id="'+f.id+'" type="number" value="'+f.v+'" style="width:100%;padding:6px 10px;background:var(--bgH);border:1px solid var(--b2);border-radius:6px;font-family:var(--fm);font-size:13px;color:var(--t1);outline:none"></div>';});h+='<button onclick="pfSaveSet()" style="padding:8px 20px;border-radius:8px;border:none;background:var(--bl);color:#fff;font-weight:700;cursor:pointer">💾 Save</button>';h+='<div style="margin-top:16px;padding:12px;background:var(--bgH);border-radius:8px;font-size:11px;color:var(--t2);line-height:1.7"><div style="font-weight:700;margin-bottom:4px">📊 Kelly Criterion</div><b>Kelly % = W - (1-W) / R</b><br>W = win rate, R = avg win / avg loss<br><br><b style="color:var(--am)">Kelly Fraction</b>: Half Kelly (50%) recommended.<br><b style="color:var(--am)">Risk per Trade</b>: Fixed % capital risked.<br><br>5+ closed trades → auto-calculate from history.</div></div>';el.innerHTML=h;}
async function pfSaveSet(){try{await fetch('/api/portfolio/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({capital:parseFloat($('pf-cap').value)||1e8,win_rate:parseFloat($('pf-wr').value)||50,risk_per_trade:parseFloat($('pf-rpt').value)||2,kelly_fraction:parseFloat($('pf-kf').value)||50})});pfSettings=null;var r=await fetch('/api/portfolio/settings');pfSettings=await r.json();showT('💾','Saved');}catch(e){}}
// ═══ PAPER TRADING — P&L setelah fee, identitas aturan, alasan keluar, kurva ekuitas ═══
// Blok ini MENIMPA renderTrades di atas (deklarasi fungsi terakhir yang menang).
// Tidak mengubah fungsi lain; hapus blok ini untuk kembali ke tampilan lama.
var PF_FEE_BUY = 0.0015, PF_FEE_SELL = 0.0015, PF_TAX_SELL = 0.0010;

function pfRule(notes) {
  var m = /([a-z0-9_]+_v\d+)/i.exec(notes || '');
  var h = /sha16\s+([0-9a-f]{8,})/i.exec(notes || '');
  return { rule: m ? m[1] : null, sha: h ? h[1] : null };
}
function pfFee(t, closed) {
  var buy = (t.entry_price || 0) * (t.lots || 0) * 100 * PF_FEE_BUY;
  var sell = closed
    ? (t.exit_price || 0) * ((t.exit_lots || t.lots) || 0) * 100 * (PF_FEE_SELL + PF_TAX_SELL)
    : 0;
  return buy + sell;
}
function pfGross(t, closed) {
  var sh = ((closed ? (t.exit_lots || t.lots) : t.lots) || 0) * 100;
  var px = closed ? (t.exit_price || 0) : (t.current_price || 0);
  return (px - (t.entry_price || 0)) * sh;
}
function pfExitReason(t) {
  // Alasan eksplisit di notes MENANG (kita yang menuliskannya saat menutup posisi).
  var n = (t.notes || '');
  if (/karena\s+close\s*<\s*MA20/i.test(n)) return 'MA20';
  if (/karena\s+stop/i.test(n)) return 'stop';
  if (/karena\s+target/i.test(n)) return 'target';
  if (/karena\s+waktu/i.test(n)) return 'waktu';
  if (!t.exit_price) return '—';
  // Inferensi hanya bila melewati batas secara tegas — harga yang PERSIS di stop
  // tidak membuktikan stop yang menutup posisi (bisa aturan lain di harga sama).
  if (t.stop_loss && t.exit_price < t.stop_loss) return 'stop?';
  if (t.target_price && t.exit_price > t.target_price) return 'target?';
  return '—';
}
function pfRp(v) {
  var r = Math.round(v || 0);
  return (r < 0 ? '−' : '+') + Math.abs(r).toLocaleString('id-ID');
}
function pfCurve(trades) {
  var cl = trades.filter(function (t) { return t.exit_price; })
    .slice().sort(function (a, b) { return (a.exit_date || '') < (b.exit_date || '') ? -1 : 1; });
  if (cl.length < 2) return '<div class="ne" style="padding:6px 0">Kurva butuh ≥2 trade tertutup.</div>';
  var cum = 0, pts = cl.map(function (t) { cum += pfGross(t, true) - pfFee(t, true); return cum; });
  var w = 520, h = 90;
  var min = Math.min.apply(null, pts.concat([0])), max = Math.max.apply(null, pts.concat([0]));
  var sc = function (v) { return h - ((v - min) / ((max - min) || 1)) * (h - 8) - 4; };
  var xs = function (i) { return (i / (pts.length - 1)) * w; };
  var d = pts.map(function (v, i) { return xs(i).toFixed(2) + ',' + sc(v).toFixed(2); }).join(' ');
  var col = cum >= 0 ? '#1a7f37' : '#c0392b';
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" ' +
    'style="width:100%;height:80px;margin-bottom:8px">' +
    '<line x1="0" y1="' + sc(0).toFixed(2) + '" x2="' + w + '" y2="' + sc(0).toFixed(2) +
    '" stroke="#bbb" stroke-dasharray="3 3" stroke-width="1"/>' +
    '<polyline fill="none" stroke="' + col + '" stroke-width="2" points="' + d + '"/></svg>';
}
function pfSummary(trades, closed) {
  var n = trades.length; if (!n) return '';
  var gross = 0, fee = 0, wins = 0;
  trades.forEach(function (t) {
    var g = pfGross(t, closed), f = pfFee(t, closed);
    gross += g; fee += f; if (g - f > 0) wins++;
  });
  var net = gross - fee;
  var c = net >= 0 ? 'var(--gn)' : 'var(--rd)';
  var card = function (label, val, color) {
    return '<div style="background:var(--bgH);border-radius:6px;padding:6px 8px">' +
      '<div style="font-size:8px;color:var(--t3);font-weight:600">' + label + '</div>' +
      '<div style="font-weight:800;font-family:var(--fm);font-size:12px;color:' + (color || 'var(--t1)') + '">' + val + '</div></div>';
  };
  return '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px">' +
    card('NET P&L (setelah fee)', pfRp(net), c) +
    card('FEE', Math.round(fee).toLocaleString('id-ID')) +
    card('WIN (net)', wins + '/' + n + ' (' + Math.round(wins / n * 100) + '%)') +
    card('RATA2 / TRADE', pfRp(net / n)) +
    '</div>';
}
var PF_BANNER = '<div style="margin-bottom:8px;padding:6px 10px;border-radius:6px;' +
  'background:rgba(192,57,43,.07);border:1px solid rgba(192,57,43,.25);font-size:10px;color:var(--t2);line-height:1.5">' +
  '<b style="color:var(--rd)">Paper trading — aturan ini belum terbukti.</b> ' +
  'Uji ke depan: excess +0,15% @20 sesi, t terkoreksi 0,11 (ambang klaim 2,9). ' +
  'P&L <b>sudah dipotong fee 0,40% bolak-balik</b>. Ini latihan proses, bukan rekomendasi.</div>';

async function renderTrades(el, status) {
  el.innerHTML = skelRows(5);
  try {
    var r = await fetch('/api/portfolio/trades?status=' + status);
    var trades = await r.json();
    var closed = (status === 'closed');
    if (!trades.length) { el.innerHTML = PF_BANNER + '<div class="ne">No ' + status + ' trades</div>'; return; }
    var h = PF_BANNER + pfSummary(trades, closed);
    if (closed) h += pfCurve(trades);
    h += '<table class="bei-tbl" style="font-size:10px"><thead><tr>' +
      '<th class="al">Code</th><th class="al">Aturan</th><th class="ar">Entry</th>' +
      '<th class="ar">Lots</th><th class="ar">SL</th><th class="ar">TP</th>' +
      (closed ? '<th class="ar">Exit</th>' : '<th class="ar">Current</th>') +
      '<th class="ar">Net P&L</th><th class="al">Keluar</th><th class="al">Date</th><th></th>' +
      '</tr></thead><tbody>';
    trades.forEach(function (t) {
      var g = pfGross(t, closed), f = pfFee(t, closed), net = g - f;
      var pc = net > 0 ? 'up' : net < 0 ? 'dn' : '';
      var rr = pfRule(t.notes);
      var badge = rr.sha
        ? '<span style="font-size:8px;color:var(--t3)" title="' + esc(t.notes || '') + '">' +
          (rr.rule || 'rule') + '<br>' + rr.sha + '</span>'
        : '<span style="font-size:8px;color:var(--t3)">manual</span>';
      h += '<tr><td><span class="code" onclick="gsOpen(\'' + esc(t.code) + '\')">' + esc(t.code) + '</span></td>';
      h += '<td>' + badge + '</td>';
      h += '<td class="ar" style="font-family:var(--fm)">' + (t.entry_price || 0).toLocaleString() + '</td>';
      h += '<td class="ar" style="font-family:var(--fm)">' + (t.lots || 0).toLocaleString() + '</td>';
      h += '<td class="ar" style="font-family:var(--fm)">' + (t.stop_loss || '—') + '</td>';
      h += '<td class="ar" style="font-family:var(--fm)">' + (t.target_price || '—') + '</td>';
      h += '<td class="ar" style="font-family:var(--fm)">' + (closed
        ? ((t.exit_price || 0).toLocaleString())
        : (t.current_price ? t.current_price.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '—')) + '</td>';
      h += '<td class="ar ' + pc + '" style="font-family:var(--fm);font-weight:600" title="bruto ' +
        pfRp(g) + ' · fee ' + pfRp(f) + '">' + pfRp(net) + '</td>';
      h += '<td style="font-size:9px;color:var(--t3)">' + (closed ? pfExitReason(t) : '—') + '</td>';
      h += '<td style="font-size:9px;color:var(--t3)">' + esc(t.entry_date || '') + '</td>';
      h += '<td style="white-space:nowrap">';
      if (!closed) h += '<button class="bei-sort-btn" onclick="pfClose(' + t.id + ')" style="font-size:9px;padding:2px 6px">Close</button> ';
      h += '<button class="bei-sort-btn" onclick="pfDel(' + t.id + ')" style="font-size:9px;padding:2px 6px;color:var(--rd)">✕</button></td></tr>';
    });
    h += '</tbody></table>';
    el.innerHTML = h;
  } catch (e) { el.innerHTML = '<div class="ne">Error</div>'; }
}
