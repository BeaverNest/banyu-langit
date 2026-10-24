// ═══ MARKET INTELLIGENCE V2 — 4 Tabs Only ═══
// Overview | Sector Performance | Sector/Industry Flow | Stock List
// All sector/industry names are clickable → navigate to Stock List auto-filtered

var miSubTab = 'overview'; // overview saja (sector/flow/stocklist pindah ke menu IHSG)

function loadMarketIntel() {
  var el = $('mi-content'); if (!el) return;
  renderMIShell(el);
}

function renderMIShell(el) {
  // Sector Performance, Sector/Industry Flow, dan Stock List PINDAH ke menu IHSG
  // (permintaan owner 24 Okt 2026) karena ketiganya turunan dari IHSG, bukan dari
  // "market intel" lintas aset. Market Intel kini hanya Overview.
  var tabs = [
    {k:'overview', l:'Overview'}
  ];
  var h = '<div class="wt">';
  tabs.forEach(function(t) {
    h += '<button class="wt-b' + (miSubTab === t.k ? ' on' : '') + '" onclick="miSwitchTab(\'' + t.k + '\',this)">' + t.l + '</button>';
  });
  h += '</div>';
  h += '<div id="mi-body" style="flex:1;overflow-y:auto"></div>';
  el.innerHTML = h;
  miLoadSubTab();
}

function miSwitchTab(tab, btn) {
  miSubTab = tab;
  var panel = btn ? (btn.closest('.tpanel') || btn.closest('#mi-content')) : null;
  if (panel) {
    panel.querySelectorAll('.wt-b').forEach(function(x) { x.classList.remove('on'); });
    if (btn) btn.classList.add('on');
  }
  miLoadSubTab();
}

function miLoadSubTab() {
  // Hanya Overview yang tersisa di Market Intel.
  if (miSubTab !== 'overview') miSubTab = 'overview';
  loadMIOverview();
}

// ═══ Navigate to Stock List with filter ═══
// Stok List kini hidup di menu IHSG. Fungsi ini tetap dipakai oleh tautan sektor di
// Overview, jadi ia harus MEMINDAHKAN tab, bukan hanya mengganti isi #mi-body.
function miGoStockList(sector, industry) {
  // Set global filter variables used by idx-daily-v2.js
  if (typeof idxSectorFilter !== 'undefined') idxSectorFilter = sector || '';
  if (typeof idxIndustryFilter !== 'undefined') idxIndustryFilter = industry || '';
  if (typeof idxFilter !== 'undefined') idxFilter = '';
  if (typeof stab === 'function') stab('ihsg');
  var btn = document.querySelector('#t-ihsg .wt-b[onclick*="stocklist"]');
  if (typeof ihsgTab === 'function') ihsgTab('stocklist', btn);
  // After render, set dropdowns if they exist
  setTimeout(function() {
    var sel = document.getElementById('idx-sector-sel');
    if (sel && sector) sel.value = sector;
    var indSel = document.getElementById('idx-industry-sel');
    if (indSel && industry) indSel.value = industry;
  }, 300);
}

// ═══ Helper: clickable sector/industry name ═══
function miSectorLink(name, type) {
  if (!name || name === 'Unknown' || name === '') return esc(name || '-');
  var onclick = type === 'industry'
    ? "miGoStockList('" + esc(name) + "')"
    : "miGoStockList('" + esc(name) + "')";
  return '<span class="code" style="cursor:pointer;color:var(--bl)" onclick="' + onclick + '">' + esc(name) + '</span>';
}

// ═══════════════════════════════════════════
// TAB 1: OVERVIEW (simplified Money Flow)
// ═══════════════════════════════════════════
async function loadMIOverview() {
  var body = $('mi-body'); if (!body) return;
  body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--t3)">Loading...</div>';
  try {
    var [unified, macro] = await Promise.all([
      fetch('/api/idx/unified?avg=20').then(function(r){return r.json();}),
      fetch('/api/idx/macro-flow?days=30').then(function(r){return r.json();}).catch(function(){return{data:[]};})
    ]);
    if (!unified.data || !unified.data.length) { body.innerHTML = '<div class="ne">No data</div>'; return; }
    var stocks = unified.data.filter(function(s){return s.close>0&&s.value>0;});
    var h = '';

    // Summary cards
    var totalFNet = stocks.reduce(function(s,r){return s+(r.fnet_val||0);},0);
    var totalVal = stocks.reduce(function(s,r){return s+(r.value||0);},0);
    var boStocks = stocks.filter(function(s){return(s.bid_vol||0)+(s.offer_vol||0)>0;});
    var totalBid = boStocks.reduce(function(s,r){return s+(r.bid_vol||0);},0);
    var totalOffer = boStocks.reduce(function(s,r){return s+(r.offer_vol||0);},0);
    var bidRatio = (totalBid+totalOffer)>0?totalBid/(totalBid+totalOffer):0.5;
    var adv = stocks.filter(function(s){return s.change_pct>0;}).length;
    var dec = stocks.filter(function(s){return s.change_pct<0;}).length;
    var totalFreq = stocks.reduce(function(s,r){return s+(r.frequency||0);},0);

    h += '<div style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 12px">';
    h += mfCard('Stocks', stocks.length, 'var(--bl)');
    h += mfCard('Adv / Dec', adv+' / '+dec, adv>dec?'var(--gn)':'var(--rd)');
    h += mfCard('Foreign Net', fmtRp(totalFNet), totalFNet>=0?'var(--gn)':'var(--rd)');
    h += mfCard('Total Value', fmtRp(totalVal), 'var(--bl)');
    h += mfCard('Bid/Offer', (bidRatio*100).toFixed(2)+'%', bidRatio>0.55?'var(--gn)':bidRatio<0.45?'var(--rd)':'var(--am)');
    h += mfCard('Frequency', fmtRp(totalFreq), 'var(--t1)');
    h += '</div>';

    // Macro flow chart
    if (macro.data && macro.data.length>=3) {
      h += '<div style="padding:0 12px 8px">';
      h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">Foreign Net Flow (30d)</div>';
      h += BL.container('mi-macro-flow',120);
      h += '</div>';
    }

    // Sector Activity — clickable boxes
    var sectorMap = {};
    stocks.forEach(function(s){
      var sec=s.sector||'Unknown'; if(sec==='Unknown'||!sec)return;
      if(!sectorMap[sec])sectorMap[sec]={chg:0,count:0,val:0,fnet:0};
      sectorMap[sec].chg+=(s.change_pct||0);sectorMap[sec].count++;
      sectorMap[sec].val+=(s.value||0);sectorMap[sec].fnet+=(s.fnet_val||0);
    });
    var sectors=Object.keys(sectorMap).map(function(k){var s=sectorMap[k];return{sector:k,avg_chg:s.chg/s.count,count:s.count,val:s.val,fnet:s.fnet};}).sort(function(a,b){return b.val-a.val;});

    h += '<div style="padding:0 12px 8px"><div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px">Sector Activity</div>';
    h += '<div style="display:flex;gap:4px;flex-wrap:wrap">';
    sectors.forEach(function(s){
      var bg=s.avg_chg>0?'rgba(38,166,154,0.1)':s.avg_chg<0?'rgba(239,83,80,0.1)':'var(--bgH)';
      var cc=s.avg_chg>0?'var(--gn)':s.avg_chg<0?'var(--rd)':'var(--t2)';
      h+='<div style="padding:6px 10px;border-radius:6px;border:1px solid var(--b1);background:'+bg+';cursor:pointer;min-width:120px" onclick="miGoStockList(\''+esc(s.sector)+'\')">';
      h+='<div style="font-size:10px;font-weight:700;color:'+cc+'">'+esc(s.sector)+'</div>';
      h+='<div style="font-size:9px;color:var(--t3)">'+s.count+' stocks &middot; '+fmtRp(s.val)+'</div>';
      h+='</div>';
    });
    h += '</div></div>';

    // Sector Foreign Net bar
    h += '<div style="padding:0 12px 8px">';
    h += '<div style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:4px">Foreign Net by Sector</div>';
    h += BL.container('mi-sector-fnet',280);
    h += '</div>';

    // Top tables row
    h += '<div style="display:flex;gap:10px;flex-wrap:wrap;padding:0 12px 12px">';

    // Top Gainers
    var topG=stocks.filter(function(s){return s.change_pct>0&&s.value>1e9;}).sort(function(a,b){return b.change_pct-a.change_pct;}).slice(0,10);
    h += '<div style="flex:1;min-width:260px"><div style="font-size:10px;font-weight:700;color:var(--gn);text-transform:uppercase;margin-bottom:4px">🔥 Top Gainers</div>';
    h += mfTopTable(topG,'change_pct','%','Chg');
    h += '</div>';

    // Top Losers
    var topL=stocks.filter(function(s){return s.change_pct<0&&s.value>1e9;}).sort(function(a,b){return a.change_pct-b.change_pct;}).slice(0,10);
    h += '<div style="flex:1;min-width:260px"><div style="font-size:10px;font-weight:700;color:var(--rd);text-transform:uppercase;margin-bottom:4px">📉 Top Losers</div>';
    h += mfTopTable(topL,'change_pct','%','Chg');
    h += '</div>';

    // Top Foreign Buy
    var topFB=stocks.filter(function(s){return(s.fnet_val||0)>0;}).sort(function(a,b){return(b.fnet_val||0)-(a.fnet_val||0);}).slice(0,10);
    h += '<div style="flex:1;min-width:260px"><div style="font-size:10px;font-weight:700;color:var(--gn);text-transform:uppercase;margin-bottom:4px">🐋 Top Foreign Buy</div>';
    h += mfTopTableFnet(topFB,true);
    h += '</div>';

    // Top Foreign Sell
    var topFS=stocks.filter(function(s){return(s.fnet_val||0)<0;}).sort(function(a,b){return(a.fnet_val||0)-(b.fnet_val||0);}).slice(0,10);
    h += '<div style="flex:1;min-width:260px"><div style="font-size:10px;font-weight:700;color:var(--rd);text-transform:uppercase;margin-bottom:4px">🐋 Top Foreign Sell</div>';
    h += mfTopTableFnet(topFS,false);
    h += '</div>';

    // Most Active (Value)
    var topV=stocks.sort(function(a,b){return(b.value||0)-(a.value||0);}).slice(0,10);
    h += '<div style="flex:1;min-width:260px"><div style="font-size:10px;font-weight:700;color:var(--bl);text-transform:uppercase;margin-bottom:4px">💰 Most Active (Value)</div>';
    h += mfTopTableVal(topV);
    h += '</div>';

    // Most Transacted (Freq)
    var topF=stocks.filter(function(s){return s.frequency>0;}).sort(function(a,b){return(b.frequency||0)-(a.frequency||0);}).slice(0,10);
    h += '<div style="flex:1;min-width:260px"><div style="font-size:10px;font-weight:700;color:var(--am);text-transform:uppercase;margin-bottom:4px">⚡ Most Transacted (Freq)</div>';
    h += mfTopTableFreq(topF);
    h += '</div>';

    h += '</div>';
    body.innerHTML = h;

    // Deferred charts
    setTimeout(function(){
      if(macro.data&&macro.data.length>=3){var cel=$('mi-macro-flow');if(cel){var c=BL.init(cel,'mi-macro');if(c){c.setOption({tooltip:{trigger:'axis',formatter:function(p){return'<b>'+p[0].axisValue+'</b><br>Net: <b>'+BL.fmtRp(p[0].value)+'</b>';}},grid:{left:50,right:20,top:8,bottom:22},xAxis:{type:'category',data:macro.data.map(function(r){return r.date;}),axisLabel:{fontSize:7,formatter:function(v){return v.substring(5);}}},yAxis:{type:'value',axisLabel:{fontSize:7,formatter:function(v){return BL.fmtRp(v);}},splitLine:{lineStyle:{color:'#1e2836'}}},series:[{type:'bar',data:macro.data.map(function(r){return{value:r.f_net,itemStyle:{color:r.f_net>=0?BL.colors.green:BL.colors.red,opacity:0.8}};}),barMaxWidth:12}]});}}}

      // Sector fnet bar - clickable
      var secArr=sectors.sort(function(a,b){return b.fnet-a.fnet;});
      var chartH=Math.max(200,secArr.length*24+40);
      var cel2El=document.getElementById('mi-sector-fnet');if(cel2El)cel2El.style.height=chartH+'px';
      var cel2=$('mi-sector-fnet');if(cel2){var c2=BL.init(cel2,'mi-sec-fnet');if(c2){
        c2.setOption({tooltip:{trigger:'axis',formatter:function(p){var d=secArr[secArr.length-1-p[0].dataIndex];return'<b>'+p[0].name+'</b> ('+(d?d.count:'')+' stocks)<br>Net: <b>'+BL.fmtRp(p[0].value)+'</b>';}},grid:{left:160,right:80,top:8,bottom:8},xAxis:{type:'value',axisLabel:{fontSize:8,formatter:function(v){return BL.fmtRp(v);}},splitLine:{lineStyle:{color:'#1e2836'}}},yAxis:{type:'category',data:secArr.map(function(s){return s.sector;}).reverse(),axisLabel:{fontSize:9,fontWeight:600,width:145,overflow:'truncate'},triggerEvent:true},series:[{type:'bar',data:secArr.map(function(s){return{value:s.fnet,itemStyle:{color:s.fnet>=0?BL.colors.green:BL.colors.red,opacity:0.85}};}).reverse(),barMaxWidth:18,label:{show:true,position:'right',fontSize:9,fontFamily:'IBM Plex Mono',color:'#8a9bb5',formatter:function(p){return BL.fmtRp(p.value);}}}]});
        // Click sector bar → go to Stock List
        c2.on('click',function(p){if(p.name)miGoStockList(p.name);});
      }}
    },80);

  } catch(e){ body.innerHTML='<div class="ne">Error: '+e.message+'</div>'; }
}

// ═══════════════════════════════════════════
// TAB 2: SECTOR PERFORMANCE (Rotation table only)
// ═══════════════════════════════════════════
function loadMISectorPerf() {
  var body = $('mi-body'); if (!body) return;
  body.innerHTML = '<div id="sector-content"><div class="ne">Loading...</div></div>';
  // Reset drill state so it always shows top-level rotation
  if (typeof sectorDrillSector !== 'undefined') sectorDrillSector = '';
  if (typeof sectorDrillIndustry !== 'undefined') sectorDrillIndustry = '';
  if (typeof secIntView !== 'undefined') secIntView = 'rotation';
  if (typeof secIntEmbedded !== 'undefined') secIntEmbedded = true;
  if (typeof loadSectorView === 'function') loadSectorView();
}

// ═══════════════════════════════════════════
// TAB 3: SECTOR/INDUSTRY FLOW (Flow Timeline only)
// ═══════════════════════════════════════════
function loadMISectorFlow() {
  var body = $('mi-body'); if (!body) return;
  body.innerHTML = '<div id="sector-content"><div class="ne">Loading...</div></div>';
  if (typeof secIntView !== 'undefined') secIntView = 'timeline';
  if (typeof secIntEmbedded !== 'undefined') secIntEmbedded = true;
  if (typeof loadSectorView === 'function') loadSectorView();
}

// ═══════════════════════════════════════════
// TAB 4: STOCK LIST (direct table only)
// ═══════════════════════════════════════════
function loadMIStockList() {
  var body = $('mi-body'); if (!body) return;
  body.innerHTML = '<div id="idx-content" style="flex:1;display:flex;flex-direction:column;overflow:hidden"><div class="ne">Loading...</div></div>';
  if (typeof idxView !== 'undefined') idxView = 'rankings';
  if (typeof idxEmbedded !== 'undefined') idxEmbedded = true;
  if (typeof idxShellRendered !== 'undefined') idxShellRendered = false;
  if (typeof loadIdxDaily === 'function') loadIdxDaily();
}

// ═══ Helper functions ═══
function mfCard(label, value, color) {
  return '<div class="bd-card"><div class="bd-card-label">' + label + '</div><div class="bd-card-val" style="color:' + color + '">' + value + '</div></div>';
}

function mfTopTable(items, key, suffix, header) {
  if (!items.length) return '<div style="font-size:10px;color:var(--t3);padding:8px">No data</div>';
  var h = '<table class="bei-tbl" style="font-size:10px"><thead><tr><th class="al">Code</th><th class="ar">Close</th><th class="ar">' + header + '</th><th class="ar">Value</th></tr></thead><tbody>';
  items.forEach(function(s) {
    var cc = (s[key]||0) > 0 ? 'up' : (s[key]||0) < 0 ? 'dn' : '';
    h += '<tr><td class="al"><span class="code" onclick="gsOpen(\'' + esc(s.code) + '\')">' + esc(s.code) + '</span></td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + (s.close||0).toLocaleString() + '</td>';
    h += '<td class="ar ' + cc + '" style="font-family:var(--fm)">' + ((s[key]||0)>0?'+':'') + (s[key]||0).toFixed(2) + suffix + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + fmtRp(s.value||0) + '</td></tr>';
  });
  return h + '</tbody></table>';
}

function mfTopTableFnet(items, isBuy) {
  if (!items.length) return '<div style="font-size:10px;color:var(--t3);padding:8px">No data</div>';
  var h = '<table class="bei-tbl" style="font-size:10px"><thead><tr><th class="al">Code</th><th class="ar">Close</th><th class="ar">F.Net</th><th class="ar">Chg%</th></tr></thead><tbody>';
  items.forEach(function(s) {
    var cc = (s.change_pct||0) > 0 ? 'up' : (s.change_pct||0) < 0 ? 'dn' : '';
    var fc = isBuy ? 'color:var(--gn)' : 'color:var(--rd)';
    h += '<tr><td class="al"><span class="code" onclick="gsOpen(\'' + esc(s.code) + '\')">' + esc(s.code) + '</span></td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + (s.close||0).toLocaleString() + '</td>';
    h += '<td class="ar" style="font-family:var(--fm);' + fc + '">' + fmtRp(s.fnet_val||0) + '</td>';
    h += '<td class="ar ' + cc + '" style="font-family:var(--fm)">' + ((s.change_pct||0)>0?'+':'') + (s.change_pct||0).toFixed(2) + '%</td></tr>';
  });
  return h + '</tbody></table>';
}

function mfTopTableVal(items) {
  if (!items.length) return '<div style="font-size:10px;color:var(--t3);padding:8px">No data</div>';
  var h = '<table class="bei-tbl" style="font-size:10px"><thead><tr><th class="al">Code</th><th class="al">Name</th><th class="ar">Value</th></tr></thead><tbody>';
  items.forEach(function(s) {
    h += '<tr><td class="al"><span class="code" onclick="gsOpen(\'' + esc(s.code) + '\')">' + esc(s.code) + '</span></td>';
    h += '<td class="al" style="font-size:9px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.name||'') + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + fmtRp(s.value||0) + '</td></tr>';
  });
  return h + '</tbody></table>';
}

function mfTopTableFreq(items) {
  if (!items.length) return '<div style="font-size:10px;color:var(--t3);padding:8px">No data</div>';
  var h = '<table class="bei-tbl" style="font-size:10px"><thead><tr><th class="al">Code</th><th class="al">Name</th><th class="ar">Freq</th></tr></thead><tbody>';
  items.forEach(function(s) {
    h += '<tr><td class="al"><span class="code" onclick="gsOpen(\'' + esc(s.code) + '\')">' + esc(s.code) + '</span></td>';
    h += '<td class="al" style="font-size:9px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(s.name||'') + '</td>';
    h += '<td class="ar" style="font-family:var(--fm)">' + (s.frequency||0).toLocaleString() + '</td></tr>';
  });
  return h + '</tbody></table>';
}
