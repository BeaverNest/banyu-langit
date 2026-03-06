// INSIDER — Stack-based navigation
var insStack=[];
var insAcCache=null,insAcIdx=-1;
var TM={ID:'Individual',CP:'Corporate',PF:'Pension Fund',IS:'Insurance',MF:'Mutual Fund',IB:'Inv. Bank',SC:'Securities',BK:'Bank',OT:'Other',FD:'Foundation',TR:'Trust',VC:'Venture Capital',HF:'Hedge Fund',PE:'Private Equity',SP:'SPV',SO:'State-Owned',GI:'Gov. Institution',CB:'Central Bank',FI:'Financial Inst.',AM:'Asset Management',IN:'Institutional',CO:'Cooperative',NG:'NGO',LL:'LLP',FO:'Foreign Org.',PR:'Prop. Trading',OM:'Other Managed'};

// Upload handlers moved to Settings popup

function insNav(title,showBack){
  $('ins-title').textContent=title;
  $('ins-back').style.display=showBack?'':'none';
}

function insBack(){
  var t=document.getElementById('net-tip');if(t)t.classList.remove('v');
  if(insStack.length>1){insStack.pop();var prev=insStack[insStack.length-1];prev.fn();}
  else insHome();
}

function insPush(title,fn){
  insStack.push({title,fn});
  fn();
}

// ── HOME: Market Overview ──
async function insHome(){
  var t=document.getElementById('net-tip');if(t)t.classList.remove('v');
  insStack=[{title:'Market Overview',fn:insHome}];
  insNav('Market Overview',false);
  var ct=$('ins-content');ct.innerHTML='<div class="ne">'+skelRows(6)+'</div>';
  try{
    var r=await fetch('/api/insider/stats');var st=await r.json();
    if(!st.total||st.total===0){ct.innerHTML='<div class="ne" style="padding:40px">Upload kepemilikan.xlsx to get started.<br><br>Use ⚙️ Settings to upload insider data.</div>';return;}

    // Get type breakdown + top foreign + most connected
    var r2=await fetch('/api/insider?q=');var d2=await r2.json();
    var allData=[];
    try{
      // Fetch all records for analysis (use empty search which returns tickers list)
      // We need to do type breakdown from the full data via stats or a dedicated endpoint
      // For now, build from available data
    }catch{}

    var html='';
    // Stats bar
    html+='<div class="ov-stats">';
    html+='<div class="ov-stat"><div class="ov-stat-num">'+st.tickers.toLocaleString()+'</div><div class="ov-stat-lbl">Tickers</div></div>';
    html+='<div class="ov-stat"><div class="ov-stat-num">'+st.investors.toLocaleString()+'</div><div class="ov-stat-lbl">Investors</div></div>';
    html+='<div class="ov-stat"><div class="ov-stat-num">'+st.snapshots+'</div><div class="ov-stat-lbl">Snapshots</div></div>';
    html+='<div class="ov-stat"><div class="ov-stat-num">'+(st.latest||'N/A')+'</div><div class="ov-stat-lbl">Last Update</div></div>';
    html+='</div>';

    // Data staleness warning
    if(st.latest){
      var days=Math.floor((Date.now()-new Date(st.latest))/(1000*60*60*24));
      if(days>30){
        html+='<div style="padding:10px 14px;background:var(--rdB);border:1px solid var(--rd);border-radius:8px;margin:12px 12px 0;font-size:12px;color:var(--rd);display:flex;align-items:center;gap:8px">';
        html+='<span style="font-size:16px">\u26a0\ufe0f</span><span>Data kepemilikan terakhir: <b>'+st.latest+'</b> ('+days+' hari lalu). Upload data terbaru dari BEI.</span></div>';
      } else if(days>20){
        html+='<div style="padding:10px 14px;background:var(--amB);border:1px solid var(--am);border-radius:8px;margin:12px 12px 0;font-size:12px;color:var(--am);display:flex;align-items:center;gap:8px">';
        html+='<span style="font-size:16px">\u23f0</span><span>Data kepemilikan: <b>'+st.latest+'</b> ('+days+' hari lalu). Update akhir bulan dari BEI.</span></div>';
      }
    }

    html+='<div class="ov-grid">';

    // By Investor Type card - fetch breakdown via search
    html+='<div class="ov-card" id="ov-types"><div class="ov-card-h"><span class="ov-accent"></span>By Investor Type</div><div class="ne" style="padding:12px">Loading...</div></div>';

    // Top Foreign Investors
    html+='<div class="ov-card" id="ov-foreign"><div class="ov-card-h"><span class="ov-accent" style="background:var(--am)"></span>Top Foreign Investors</div><div class="ne" style="padding:12px">Loading...</div></div>';

    // Most Connected (most stocks)
    html+='<div class="ov-card" id="ov-connected"><div class="ov-card-h"><span class="ov-accent" style="background:var(--bl)"></span>Most Connected</div><div class="ne" style="padding:12px">Loading...</div></div>';

    // Quick search suggestions
    html+='<div class="ov-card" id="ov-quick"><div class="ov-card-h"><span class="ov-accent" style="background:var(--rd)"></span>Top Tickers by Holders</div><div class="ne" style="padding:12px">Loading...</div></div>';

    html+='</div>';
    ct.innerHTML=html;

    // Load overview data async
    loadOverviewCards();
  }catch(e){ct.innerHTML='<div class="ne">Error: '+e.message+'</div>';}
}

async function loadOverviewCards(){
  try{
    var r=await fetch('/api/insider/overview');var ov=await r.json();
    var typeCard=$('ov-types');
    if(typeCard&&ov.types){
      var th='<div class="ov-card-h"><span class="ov-accent"></span>By Investor Type</div>';
      ov.types.forEach(function(t){
        if(!t.type)return;
        th+='<div class="ov-row" onclick="insTypeList(\''+t.type+'\')">';
        th+='<span class="ov-badge type-badge tp-'+(t.type||'OT')+'">'+(t.type||'?')+'</span>';
        th+='<span class="ov-name">'+(TM[t.type]||t.type||'Other')+'</span>';
        th+='<span class="ov-val" style="font-family:var(--fm)">'+t.investors+'</span></div>';
      });
      typeCard.innerHTML=th;
    }
    var fc=$('ov-foreign');
    if(fc&&ov.topForeign&&ov.topForeign.length){
      var fh='<div class="ov-card-h"><span class="ov-accent" style="background:var(--am)"></span>Top Foreign Investors</div>';
      ov.topForeign.forEach(function(f){
        fh+='<div class="ov-row" onclick="insGoInvestor(\''+f.name.replace(/'/g,"\\'")+'\')">';
        fh+='<span class="ov-badge lf-badge lf-A">F</span>';
        fh+='<span class="ov-name">'+f.name.substring(0,35)+'</span>';
        fh+='<span class="ov-val" style="color:var(--gn)">'+f.stocks+' stocks</span></div>';
      });
      fc.innerHTML=fh;
    }
    var cc=$('ov-connected');
    if(cc&&ov.mostConnected&&ov.mostConnected.length){
      var ch='<div class="ov-card-h"><span class="ov-accent" style="background:var(--bl)"></span>Most Connected</div>';
      ov.mostConnected.forEach(function(c2){
        ch+='<div class="ov-row" onclick="insGoInvestor(\''+c2.name.replace(/'/g,"\\'")+'\')">';
        ch+='<span class="ov-name">'+c2.name.substring(0,35)+'</span>';
        ch+='<span class="ov-val" style="color:var(--bl)">'+c2.stocks+' stocks</span></div>';
      });
      cc.innerHTML=ch;
    }
    var qc=$('ov-quick');
    if(qc&&insAcCache&&insAcCache.length){
      var qh='<div class="ov-card-h"><span class="ov-accent" style="background:var(--rd)"></span>Quick Access</div>';
      insAcCache.slice(0,10).forEach(function(t){
        qh+='<div class="ov-row" onclick="insGoStock(\''+t+'\')"><span class="ov-name" style="font-family:var(--fm);font-weight:700;color:var(--bl)">'+t+'</span><span class="ov-val">&rarr;</span></div>';
      });
      qc.innerHTML=qh;
    }
  }catch(e){console.error('Overview error:',e);}
}

// ── STOCK DETAIL ──
function insGoStock(code){
  var t=document.getElementById('net-tip');if(t)t.classList.remove('v');
  $('inq').value='';$('ins-ac').classList.remove('v');
  insPush(code,function(){
    insNav(code,true);
    var ct=$('ins-content');ct.innerHTML='<div class="ne">Loading '+code+'...</div>';
    fetch('/api/insider?q='+encodeURIComponent(code)).then(function(r){return r.json();}).then(function(d){
      if(!d.results||!d.results.length){ct.innerHTML='<div class="ne">No data for '+code+'</div>';return;}
      var summary=d.summary||{};
      var html='<div class="ins-detail">';
      for(var tk in summary){
        var s=summary[tk];var ff=s.freeFloat||0;var tp=s.totalPct||0;
        var dt=s.date?new Date(s.date).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}):'N/A';
        var holders=s.holders||[];
        var colors=['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#06b6d4','#84cc16'];

        // Header
        html+='<div class="ins-detail-header"><h2>'+esc(tk)+'</h2><span class="sub">'+esc(s.issuer||'')+'</span><button class="net-btn" onclick="insNetwork(\'stock\',\''+esc(tk)+'\')">🕸 Network</button></div>';
        html+='<div id="stk-tag-'+esc(tk)+'" style="padding:0 0 8px"></div>';

        // Stats row
        var corpH=holders.filter(function(h){return h.type==='CP';}).length;
        var indH=holders.filter(function(h){return h.type==='ID';}).length;
        var forPct=holders.filter(function(h){return h.lf==='A'||h.lf==='F';}).reduce(function(a,h){return a+h.pct;},0);
        html+='<div class="ov-stats" style="border-radius:10px;border:1px solid var(--b2);margin-bottom:12px">';
        html+='<div class="ov-stat"><div class="ov-stat-num">'+holders.length+'</div><div class="ov-stat-lbl">Holders</div></div>';
        html+='<div class="ov-stat"><div class="ov-stat-num" style="color:var(--bl)">'+tp.toFixed(1)+'%</div><div class="ov-stat-lbl">Insider</div></div>';
        html+='<div class="ov-stat"><div class="ov-stat-num" style="color:'+(ff<20?'var(--rd)':ff<40?'var(--am)':'var(--gn)')+'">'+ff.toFixed(1)+'%</div><div class="ov-stat-lbl">Free Float</div></div>';
        html+='<div class="ov-stat"><div class="ov-stat-num" style="color:var(--am)">'+forPct.toFixed(1)+'%</div><div class="ov-stat-lbl">Foreign</div></div>';
        html+='</div>';

        // Analysis text
        var topH=holders[0];
        var dt2=s.date?new Date(s.date).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}):'N/A';
        html+='<div style="padding:12px 0;font-size:13px;line-height:1.7;color:var(--t2)">';
        html+='Data per <b style="color:var(--t1)">'+dt2+'</b> &mdash; ';
        html+='<b style="color:var(--t1)">'+holders.length+'</b> pemegang tercatat: '+corpH+' corporate, '+indH+' individual. ';
        if(topH)html+='Terbesar: <b style="color:var(--t1)">'+esc(topH.investor)+'</b> ('+topH.pct.toFixed(2)+'%). ';
        if(forPct>0)html+='Foreign ownership: <b style="color:var(--am)">'+forPct.toFixed(2)+'%</b>. ';
        if(ff<15)html+='<span style="color:var(--rd)">⚠ Very low liquidity — free float hanya '+ff.toFixed(1)+'%</span>';
        else if(ff<25)html+='<span style="color:var(--am)">Free float terbatas ('+ff.toFixed(1)+'%)</span>';
        else if(ff>60)html+='<span style="color:var(--gn)">Likuiditas tinggi — free float '+ff.toFixed(1)+'%</span>';
        html+='</div>';

        // Pie + table layout
        var pd=[];holders.forEach(function(h,i){if(h.pct>0)pd.push({label:h.investor.substring(0,20),pct:h.pct,color:colors[i%colors.length]});});
        if(ff>0)pd.push({label:'Free Float',pct:ff,color:'#374151'});

        html+='<div class="ins-section"><div class="ins-section-h"><span class="sec-accent" style="background:var(--bl)"></span>Shareholders</div>';
        // Pie chart
        if(pd.length){
          html+='<div class="ins-pie-wrap"><div>'+drawPie(pd,90)+'</div><div class="ins-pie-legend">';
          pd.forEach(function(p){html+='<div class="leg-row"><span class="leg-dot" style="background:'+p.color+'"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">'+esc(p.label)+'</span><span class="leg-pct">'+p.pct.toFixed(1)+'%</span></div>';});
          html+='</div></div>';
        }
        // Table
        html+='<table class="ins-tbl"><thead><tr><th>Investor</th><th>Type</th><th>L/F</th><th>Holdings</th><th>%</th></tr></thead><tbody>';
        holders.forEach(function(r){
          html+='<tr><td class="inv-name clickable" onclick="insGoInvestor(\''+esc(r.investor).replace(/'/g,"\'")+'\')" title="'+esc(r.investor)+'">'+esc(r.investor)+'</td>';
          html+='<td><span class="type-badge tp-'+esc(r.type)+'">'+(TM[r.type]||r.type)+'</span></td>';
          html+='<td><span class="lf-badge lf-'+(r.lf==='A'||r.lf==='F'?'A':'L')+'">'+(r.lf==='L'?'Local':'Foreign')+'</span></td>';
          html+='<td style="font-family:var(--fm);text-align:right">'+r.holdings.toLocaleString()+'</td>';
          html+='<td class="pct"><span class="pct-bar" style="width:'+Math.min(r.pct,100)+'px"></span>'+r.pct.toFixed(2)+'%</td></tr>';
        });
        html+='</tbody></table></div>';

        html+='<div style="font-size:10px;color:var(--t3);text-align:right;margin-top:4px">Data per '+dt+'</div>';
      }
      html+='</div>';
      ct.innerHTML=html;
      // Async: fetch group tags for this ticker
      for(var _tk in summary){
        (function(tkk){
          fetch('/api/insider/tags/resolve?ticker='+encodeURIComponent(tkk)).then(function(r){return r.json();}).then(function(t){
            var el=document.getElementById('stk-tag-'+tkk);
            if(el&&t.ticker_groups&&t.ticker_groups.length){
              el.innerHTML=t.ticker_groups.map(function(g){return'<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:rgba(139,92,246,.12);color:#8b5cf6;margin-left:6px;font-weight:600">'+g.group_name+'</span>';}).join('');
            }
          }).catch(function(){});
        })(_tk);
      }
    }).catch(function(e){ct.innerHTML='<div class="ne">Error: '+e.message+'</div>';});
  });
}

// ── INVESTOR DETAIL ──
function insGoInvestor(name){
  var t=document.getElementById('net-tip');if(t)t.classList.remove('v');
  $('inq').value='';$('ins-ac').classList.remove('v');
  insPush(name,function(){
    insNav(name,true);
    var ct=$('ins-content');ct.innerHTML=''+skelRows(6)+'';
    fetch('/api/insider/investor?q='+encodeURIComponent(name)).then(function(r){return r.json();}).then(function(d){
      var investors=d.investors||[];
      if(!investors.length){ct.innerHTML='<div class="ne">No data for "'+esc(name)+'"</div>';return;}
      var html='<div class="ins-detail">';
      investors.forEach(function(inv){
        html+='<div class="ins-detail-header"><h2 style="font-size:16px">'+esc(inv.name)+'</h2>';
        html+='<div class="ins-badges"><span class="type-badge tp-'+esc(inv.type)+'">'+(TM[inv.type]||inv.type)+'</span>';
        html+='<span class="lf-badge lf-'+(inv.lf==='L'?'L':'A')+'">'+(inv.lf==='L'?'🇮🇩 Local':'🌐 Foreign')+'</span>';
        html+='<span style="font-family:var(--fm);font-size:11px;color:var(--t2);border:1px solid var(--b2);padding:2px 8px;border-radius:5px">'+inv.stocks.length+' Holdings</span>';
        html+='<button class="net-btn" onclick="insNetwork(\'investor\',\''+esc(inv.name).replace(/'/g,"\\'")+'\')">\ud83d\udd78\ufe0f Network</button>';
        html+='</div></div>';

        html+='<div class="ins-section"><div class="ins-section-h"><span class="sec-accent" style="background:var(--gn)"></span>Portfolio</div>';
        html+='<table class="ins-tbl"><thead><tr><th>Ticker</th><th>Company</th><th>Shares</th><th>%</th></tr></thead><tbody>';
        inv.stocks.forEach(function(s){
          html+='<tr><td class="code clickable" onclick="insGoStock(\''+esc(s.code)+'\')">' +esc(s.code)+'</td>';
          html+='<td class="inv-name">'+esc(s.issuer)+'</td>';
          html+='<td style="font-family:var(--fm);text-align:right">'+s.holdings.toLocaleString()+'</td>';
          html+='<td class="pct"><span class="pct-bar" style="width:'+Math.min(s.pct,100)+'px"></span>'+s.pct.toFixed(2)+'%</td></tr>';
        });
        html+='</tbody></table></div>';
      });
      html+='</div>';
      ct.innerHTML=html;
    }).catch(function(e){ct.innerHTML='<div class="ne">Error: '+e.message+'</div>';});
  });
}

// ── NETWORK GRAPH ──
function insNetwork(mode,id){
  var title=(mode==='stock'?id:'Network: '+id.substring(0,25));
  insPush(title,function(){
    insNav(title,true);
    var ct=$('ins-content');ct.innerHTML='<div class="ne">'+skelRows(4)+'</div>';
    var url=mode==='stock'?'/api/insider/network?code='+encodeURIComponent(id):'/api/insider/network?investor='+encodeURIComponent(id);
    fetch(url).then(function(r){return r.json();}).then(function(data){
      if(!data.nodes||!data.nodes.length){ct.innerHTML='<div class="ne">No network data</div>';return;}
      var html='<div class="net-wrap"><div id="net-svg"></div>';
      html+='<div class="net-legend">';
      html+='<span><i style="background:#3b82f6"></i> Ticker</span>';
      html+='<span><i style="background:#22c55e"></i> Investor</span>';
      html+='<span><i style="background:#f59e0b"></i> Entry point</span>';
      html+='<span><i style="background:#8b5cf6"></i> Konglo</span>';
      html+='<span><i style="background:#dc2626"></i> BUMN</span>';
      html+='<span><i style="background:#06b6d4"></i> Asing</span>';
      html+='<span style="margin-left:auto;font-size:10px;color:var(--t3)">'+data.nodes.length+' nodes, '+data.links.length+' links</span>';
      html+='</div></div>';
      ct.innerHTML=html;
      drawNetwork(data,mode,id);
    }).catch(function(e){ct.innerHTML='<div class="ne">Error: '+e.message+'</div>';});
  });
}

function drawNetwork(data,mode,entryId){
  var container=document.getElementById('net-svg');
  if(!container)return;
  var W=container.clientWidth||800,H=Math.min(650,Math.max(500,W*0.6));

  var svg=d3.select('#net-svg').append('svg').attr('width',W).attr('height',H).attr('viewBox','0 0 '+W+' '+H);

  // Zoom
  var g=svg.append('g');
  svg.call(d3.zoom().scaleExtent([0.3,4]).on('zoom',function(e){g.attr('transform',e.transform);}));

  // Entry node id
  var entryKey=mode==='stock'?'s:'+entryId:'i:'+data.nodes.find(function(n){return n.type==='investor'&&n.label.toUpperCase().indexOf(entryId.toUpperCase().substring(0,10))>=0;})?.id;

  // Force simulation
  var sim=d3.forceSimulation(data.nodes)
    .force('link',d3.forceLink(data.links).id(function(d){return d.id;}).distance(function(d){return d.pct>5?80:120;}))
    .force('charge',d3.forceManyBody().strength(-300))
    .force('center',d3.forceCenter(W/2,H/2))
    .force('collision',d3.forceCollide().radius(function(d){return nodeR(d)+25;}).strength(0.8))
    .force('x',d3.forceX(W/2).strength(0.05))
    .force('y',d3.forceY(H/2).strength(0.05));

  function nodeR(d){
    if(d.id===entryKey)return 28;
    if(d.type==='stock')return 18;
    return 16;
  }
  function nodeColor(d){
    if(d.id===entryKey)return'#f59e0b';
    if(d.group){
      if(d.groupCat==='Konglomerat')return'#8b5cf6';
      if(d.groupCat==='BUMN'||d.groupCat==='BUMN Holding')return'#dc2626';
      if(d.groupCat==='Asing')return'#06b6d4';
      return'#22c55e';
    }
    return d.type==='stock'?'#3b82f6':'#22c55e';
  }

  // Links
  var link=g.append('g').selectAll('line').data(data.links).join('line')
    .attr('stroke','var(--b2)').attr('stroke-opacity',0.6)
    .attr('stroke-width',function(d){return Math.max(1,Math.min(d.pct/5,4));});

  // Link labels (percentage)
  var linkLabel=g.append('g').selectAll('text').data(data.links.filter(function(d){return d.pct>=2;})).join('text')
    .text(function(d){return d.pct.toFixed(1)+'%';})
    .attr('font-size',8).attr('fill','var(--t3)').attr('text-anchor','middle').attr('font-family','var(--fm)');

  // Nodes
  var node=g.append('g').selectAll('g').data(data.nodes).join('g').attr('cursor','pointer');

  node.append('circle')
    .attr('r',function(d){return nodeR(d);})
    .attr('fill',function(d){return nodeColor(d);})
    .attr('stroke','var(--bg1)').attr('stroke-width',2)
    .attr('opacity',0.9);

  // Group label (below node name)
  node.filter(function(d){return d.group;}).append('text')
    .text(function(d){return d.group.substring(0,18);})
    .attr('font-size',9).attr('fill','var(--am)').attr('font-weight','600')
    .attr('font-family','var(--fs)').attr('text-anchor','middle')
    .attr('dy',function(d){return nodeR(d)+22;});

  // Ticker group label
  node.filter(function(d){return d.groups&&d.groups.length;}).append('text')
    .text(function(d){return d.groups[0].substring(0,18);})
    .attr('font-size',9).attr('fill','var(--bl)').attr('font-weight','600')
    .attr('font-family','var(--fs)').attr('text-anchor','middle')
    .attr('dy',function(d){return nodeR(d)+22;});

  node.append('text')
    .text(function(d){return d.label.substring(0,15);})
    .attr('font-size',function(d){return d.id===entryKey?13:11;})
    .attr('font-weight',function(d){return d.id===entryKey?'700':'500';})
    .attr('font-family',function(d){return d.type==='stock'?'var(--fm)':'var(--fs)';})
    .attr('fill','var(--t1)')
    .attr('text-anchor','middle')
    .attr('dy',function(d){return nodeR(d)+12;});

  // Click handler
  node.on('click',function(e,d){
    tip.classList.remove('v');
    if(d.type==='stock'){var code=d.label||d.id.replace('s:','');insGoStock(code);}
    else{var name=d.label||d.id.replace('i:','');insGoInvestor(name);}
  });

  // Drag
  node.call(d3.drag()
    .on('start',function(e,d){if(!e.active)sim.alphaTarget(0.3).restart();d.fx=d.x;d.fy=d.y;})
    .on('drag',function(e,d){d.fx=e.x;d.fy=e.y;})
    .on('end',function(e,d){if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null;})
  );

  // Hover tooltip
  var tip=$('net-tip');
  function showTip(e,d){
    // Gather connections for this node
    var conns=data.links.filter(function(l){
      var sid=typeof l.source==='object'?l.source.id:l.source;
      var tid=typeof l.target==='object'?l.target.id:l.target;
      return sid===d.id||tid===d.id;
    });
    var color=nodeColor(d);
    var h='<div class="net-tip-name"><span class="nt-dot" style="background:'+color+'"></span>'+esc(d.label)+'</div>';
    if(d.type==='stock'){
      var groups=d.groups?d.groups.join(', '):'';
      if(groups)h+='<div class="net-tip-row"><b>Group:</b> '+esc(groups)+'</div>';
      h+='<div class="net-tip-row"><b>Shareholders:</b> '+conns.length+'</div>';
      var totalPct=conns.reduce(function(s,l){return s+l.pct;},0);
      h+='<div class="net-tip-row"><b>Tracked ownership:</b> '+totalPct.toFixed(1)+'%</div>';
      if(conns.length){
        h+='<div class="net-tip-divider"></div><div class="net-tip-links">';
        conns.sort(function(a,b){return b.pct-a.pct;}).slice(0,5).forEach(function(l){
          var sid=typeof l.source==='object'?l.source.id:l.source;
          var inv=data.nodes.find(function(n){return n.id===(sid===d.id?(typeof l.target==='object'?l.target.id:l.target):sid);});
          if(inv)h+='<span>'+esc(inv.label.substring(0,20))+' '+l.pct.toFixed(1)+'%</span>';
        });
        h+='</div>';
      }
    }else{
      if(d.itype)h+='<div class="net-tip-row"><b>Type:</b> '+esc(d.itype)+'</div>';
      if(d.group)h+='<div class="net-tip-row"><b>Group:</b> '+esc(d.group)+(d.groupCat?' <span class="net-tip-badge" style="background:var(--blB);color:var(--bl)">'+esc(d.groupCat)+'</span>':'')+'</div>';
      h+='<div class="net-tip-row"><b>Holdings:</b> '+conns.length+' stock'+(conns.length>1?'s':'')+'</div>';
      if(conns.length){
        h+='<div class="net-tip-divider"></div><div class="net-tip-links">';
        conns.sort(function(a,b){return b.pct-a.pct;}).slice(0,6).forEach(function(l){
          var tid=typeof l.target==='object'?l.target.id:l.target;
          var stk=data.nodes.find(function(n){return n.id===(tid===d.id?(typeof l.source==='object'?l.source.id:l.source):tid);});
          if(stk)h+='<span>'+esc(stk.label)+' '+l.pct.toFixed(1)+'%</span>';
        });
        h+='</div>';
      }
    }
    tip.innerHTML=h;tip.classList.add('v');
    // Highlight connected
    var connIds=new Set([d.id]);
    conns.forEach(function(l){
      connIds.add(typeof l.source==='object'?l.source.id:l.source);
      connIds.add(typeof l.target==='object'?l.target.id:l.target);
    });
    node.select('circle').attr('opacity',function(n){return connIds.has(n.id)?1:0.15;});
    node.selectAll('text').attr('opacity',function(n){return connIds.has(n.id)?1:0.15;});
    link.attr('stroke-opacity',function(l){
      var sid=typeof l.source==='object'?l.source.id:l.source;
      var tid=typeof l.target==='object'?l.target.id:l.target;
      return(sid===d.id||tid===d.id)?0.9:0.05;
    });
    linkLabel.attr('opacity',function(l){
      var sid=typeof l.source==='object'?l.source.id:l.source;
      var tid=typeof l.target==='object'?l.target.id:l.target;
      return(sid===d.id||tid===d.id)?1:0.05;
    });
  }
  function moveTip(e){
    var x=e.clientX+12,y=e.clientY+12;
    if(x+290>window.innerWidth)x=e.clientX-290;
    if(y+200>window.innerHeight)y=e.clientY-200;
    tip.style.left=x+'px';tip.style.top=y+'px';
  }
  function hideTip(){
    tip.classList.remove('v');
    node.select('circle').attr('opacity',0.9);
    node.selectAll('text').attr('opacity',1);
    link.attr('stroke-opacity',0.6);
    linkLabel.attr('opacity',1);
  }
  node.on('mouseenter',showTip).on('mousemove',moveTip).on('mouseleave',hideTip);

  // Tick
  sim.on('tick',function(){
    link.attr('x1',function(d){return d.source.x;}).attr('y1',function(d){return d.source.y;})
        .attr('x2',function(d){return d.target.x;}).attr('y2',function(d){return d.target.y;});
    linkLabel.attr('x',function(d){return(d.source.x+d.target.x)/2;})
             .attr('y',function(d){return(d.source.y+d.target.y)/2;});
    node.attr('transform',function(d){return'translate('+d.x+','+d.y+')';});
  });
}

// ── TYPE LIST ──
function insTypeList(type){
  var label=TM[type]||type;
  insPush(label,function(){
    insNav(label,true);
    var ct=$('ins-content');ct.innerHTML='<div class="ne">Loading '+label+'...</div>';
    fetch('/api/insider/by-type?type='+encodeURIComponent(type)).then(function(r){return r.json();}).then(function(d){
      if(!d.investors||!d.investors.length){ct.innerHTML='<div class="ne">No '+label+' investors found.</div>';return;}
      var html='<div class="ins-detail">';
      html+='<div class="ins-detail-header"><h2>'+esc(label)+'</h2><span class="type-badge tp-'+esc(type)+'">'+esc(type)+'</span><span class="sub" style="margin-left:8px">'+d.total+' investors</span></div>';
      html+='<div class="ins-section"><table class="ins-tbl"><thead><tr><th>Investor</th><th>Nat.</th><th>Positions</th><th>Top Holding</th></tr></thead><tbody>';
      d.investors.forEach(function(inv){
        html+='<tr>';
        html+='<td class="inv-name clickable" onclick="insGoInvestor(\''+esc(inv.name).replace(/'/g,"\\'")+'\')" title="'+esc(inv.name)+'">'+esc(inv.name)+'</td>';
        html+='<td><span class="lf-badge lf-'+(inv.lf==='L'?'L':'A')+'">'+(inv.lf==='L'?'Local':'Foreign')+'</span></td>';
        html+='<td style="font-family:var(--fm);text-align:center">'+inv.positions+'</td>';
        if(inv.topHolding){
          html+='<td><span class="code clickable" onclick="insGoStock(\''+esc(inv.topHolding.code)+'\')" style="margin-right:6px">'+esc(inv.topHolding.code)+'</span><span style="font-family:var(--fm);font-size:10px;color:var(--t3)">'+inv.topHolding.pct.toFixed(2)+'%</span></td>';
        }else{
          html+='<td>-</td>';
        }
        html+='</tr>';
      });
      html+='</tbody></table></div></div>';
      ct.innerHTML=html;
    }).catch(function(e){ct.innerHTML='<div class="ne">Error: '+e.message+'</div>';});
  });
}

// ── UNIFIED SEARCH ──
function insSearch(){
  var q=$('inq').value.trim();
  if(!q)return;
  $('ins-ac').classList.remove('v');
  // Detect: if 2-5 uppercase letters, try as ticker first
  if(/^[A-Z]{2,5}$/i.test(q)){
    insGoStock(q.toUpperCase());
  }else{
    insGoInvestor(q);
  }
}

// ── AUTOCOMPLETE ──
async function loadAcData(){
  try{
    var r=await fetch('/api/insider?q=');var d=await r.json();
    insAcCache=(d.tickers||[]);
  }catch{}
}

var acDebounce=null;
function acType(){
  var q=$('inq').value.trim();
  var drop=$('ins-ac');
  if(q.length<1){drop.classList.remove('v');return;}
  var qu=q.toUpperCase();
  var html='';
  // Ticker matches
  if(insAcCache){
    var hits=insAcCache.filter(function(t){return t.indexOf(qu)===0;}).slice(0,5);
    if(hits.length){
      html+='<div class="ins-ac-cat">Tickers</div>';
      hits.forEach(function(h,i){html+='<div class="ins-ac-item" onmousedown="insGoStock(\''+h+'\')"><span class="ac-name" style="font-family:var(--fm);font-weight:700;color:var(--bl)">'+h+'</span></div>';});
    }
  }
  // Investor matches (debounced)
  clearTimeout(acDebounce);
  acDebounce=setTimeout(async function(){
    try{
      var r=await fetch('/api/insider/investor?q='+encodeURIComponent(q));var d=await r.json();
      if(d.investors&&d.investors.length){
        var invHtml='<div class="ins-ac-cat">Investors</div>';
        d.investors.slice(0,5).forEach(function(inv){
          invHtml+='<div class="ins-ac-item" onmousedown="insGoInvestor(\''+inv.name.replace(/'/g,"\'")+'\')">';
          invHtml+='<span class="ac-name">'+inv.name+'</span>';
          invHtml+='<span class="ac-info"><span class="type-badge tp-'+(inv.type||'')+'">'+inv.type+'</span> '+inv.stocks.length+' stocks</span></div>';
        });
        // Append to existing html
        var existingHtml=drop.innerHTML;
        // Only replace investor part
        var catIdx=existingHtml.indexOf('<div class="ins-ac-cat">Investors');
        if(catIdx>=0)existingHtml=existingHtml.substring(0,catIdx);
        drop.innerHTML=existingHtml+invHtml;
        drop.classList.add('v');
      }
    }catch{}
  },300);

  if(html){drop.innerHTML=html;drop.classList.add('v');}
}

function acKey(e){
  var drop=$('ins-ac');
  if(e.key==='Enter'){drop.classList.remove('v');insSearch();}
  else if(e.key==='Escape'){drop.classList.remove('v');}
}

document.addEventListener('click',function(e){if(!e.target.closest('.ins-search-bar'))$('ins-ac').classList.remove('v');});

async function chkIns(){
  try{
    var r=await fetch('/api/insider/stats');var d=await r.json();
    if(d.total>0){$('ins-info').textContent=d.total.toLocaleString()+' records, '+d.tickers+' tickers, last update: '+(d.latest||'N/A');$('ins-info').classList.add('v');}
    insHome();
  }catch{insHome();}
}

function drawPie(data,r){const cx=r,cy=r,tot=data.reduce((s,d)=>s+d.pct,0);if(!tot)return'';let sa=-Math.PI/2;let p='';data.forEach(d=>{const sl=d.pct/tot*2*Math.PI;const ea=sa+sl;const x1=cx+r*Math.cos(sa),y1=cy+r*Math.sin(sa),x2=cx+r*Math.cos(ea),y2=cy+r*Math.sin(ea);p+='<path d="M'+cx+','+cy+' L'+x1+','+y1+' A'+r+','+r+' 0 '+(sl>Math.PI?1:0)+',1 '+x2+','+y2+' Z" fill="'+d.color+'" stroke="var(--bg1)" stroke-width="2"/>'; sa=ea;});p+='<circle cx="'+cx+'" cy="'+cy+'" r="'+(r*.55)+'" fill="var(--bg1)"/>';const ff=data.find(d=>d.label==='Free Float');if(ff)p+='<text x="'+cx+'" y="'+(cy-6)+'" text-anchor="middle" fill="var(--t2)" font-size="10" font-family="var(--fm)">Free Float</text><text x="'+cx+'" y="'+(cy+12)+'" text-anchor="middle" fill="var(--t1)" font-size="16" font-weight="700" font-family="var(--fm)">'+ff.pct.toFixed(1)+'%</text>';return'<svg width="'+(r*2)+'" height="'+(r*2)+'" viewBox="0 0 '+(r*2)+' '+(r*2)+'">'+p+'</svg>';}
