// ═══ COMMODITY MAPPING ═══
var cmdData=null,cmdExpanded=null,cmdSort='value',cmdDir='desc';
// Tanggal bar singkat ('15 Okt') untuk penanda basi — helper bersama di utils.js: shortDay().

async function loadCommodities(){
  var el=document.getElementById('cmd-content');
  if(!el)return;
  if(cmdData){cmdRender(el);return;}
  el.innerHTML='<div style="padding:20px;text-align:center;color:var(--t2)">Loading commodities...</div>';
  try{
    var r=await fetch('/api/commodities');
    if(!r.ok){el.innerHTML='<div style="padding:20px;color:red">HTTP '+r.status+'</div>';return;}
    cmdData=await r.json();
    if(!cmdData||!cmdData.commodities){el.innerHTML='<div style="padding:20px;color:red">No data</div>';return;}
    cmdRender(el);
  }catch(e){el.innerHTML='<div style="padding:20px;color:red">Error: '+e.message+'</div>';}
}

function cmdRender(el){
  if(!el)el=document.getElementById('cmd-content');
  if(!el||!cmdData)return;
  var cmds=cmdData.commodities;
  function pc(v){return v==null?'—':(v>0?'+':'')+Number(v).toFixed(2)+'%';}
  function cl(v){return v>0?'var(--gn)':v<0?'var(--rd)':'var(--t2)';}
  function px(v){return Number(v).toLocaleString(undefined,{maximumFractionDigits:2});}
  if(!cmds||!cmds.length){el.innerHTML='<div style="padding:20px;color:var(--t2)">No commodities</div>';return;}

  var h='<div style="padding:10px 12px">';

  // Cards grid
  h+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin-bottom:12px">';
  for(var i=0;i<cmds.length;i++){
    var c=cmds[i];
    var ac=c.avg_chg||0;
    var fn=c.total_fnet||0;
    var isExp=cmdExpanded===c.id;

    h+='<div style="background:'+(isExp?'var(--blB,rgba(255,152,0,.08))':'var(--bg2,#fff)')+';border:1px solid '+(isExp?'var(--bl,var(--bl))':'var(--b2,var(--b2))')+';border-radius:10px;padding:10px 12px;cursor:pointer" onclick="cmdToggle(\''+c.id+'\')">';

    // Row 1: icon + label + chart link
    // Deskripsi turun ke barisnya sendiri (t_4f60bcc4): caveat roll CPO/STEEL panjang (72-86
    // karakter), dan kalau ditempel inline di samping label ia pecah jadi 4-5 baris 9px dalam
    // kolom ~150px sehingga tinggi header kartu naik 18px -> 64px. Satu baris penuh selebar
    // kartu: teks tetap sama kata-per-kata, kartu tidak melar.
    var hasDesc=!!c.desc;
    h+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:'+(hasDesc?2:6)+'px">';
    h+='<span style="font-size:16px">'+(c.icon||'📦')+'</span>';
    h+='<div style="flex:1;min-width:0"><b style="font-size:13px">'+(c.label||'?')+'</b></div>';
    if(c.tv)h+='<a href="https://www.tradingview.com/chart/?symbol='+encodeURIComponent(c.tv)+'" target="_blank" onclick="event.stopPropagation()" style="font-size:9px;padding:3px 8px;border-radius:4px;background:var(--bl);color:#fff;text-decoration:none;font-weight:600">📈 Chart</a>';
    h+='</div>';
    if(hasDesc)h+='<div style="font-size:9px;color:var(--t2);line-height:1.35;margin-bottom:6px">'+c.desc+'</div>';

    // Row 2: harga komoditas
    // Seri basi (t_61ccbdbe): bar terakhir tertinggal dari sesi rujukan — TIN 15 Okt sementara
    // rail sudah 19 Okt. Level & chg 1D di response adalah milik bar LAMA, jadi yang ditulis
    // hanya tanggalnya; menampilkan 50.127 di sini akan mengarang sesi yang tidak ada.
    var cm=c.commodity;
    h+='<div style="display:flex;align-items:baseline;gap:6px;font-size:11px;margin-bottom:3px">';
    if(cm&&cm.stale){
      h+='<b style="font-family:monospace;color:var(--t2)" title="bar terakhir '+shortDay(cm.stale_date||cm.date)+' (level '+px(cm.price)+') — bukan sesi '+shortDay(cm.ref_date)+'">—</b>';
      h+='<span style="color:var(--am);font-weight:600;font-size:9px" title="sumber tidak menerbitkan bar untuk '+(cm.lag_sessions||0)+' sesi terakhir; retry tidak menolong, yang berhenti di hulu">⏸ basi · terakhir '+shortDay(cm.stale_date||cm.date)+' · '+(cm.lag_sessions||0)+' sesi</span>';
    } else if(cm){
      h+='<b style="font-family:monospace">'+px(cm.price)+'</b>';
      h+='<span style="color:'+cl(cm.chg_1d)+';font-weight:600">'+pc(cm.chg_1d)+'</span>';
      h+='<span style="color:var(--t3);font-size:9px">komoditas · '+shortDay(cm.stale_date||cm.date)+'</span>';
    } else {
      h+='<span style="color:var(--t3);font-size:10px">tanpa seri harga</span>';
    }
    h+='</div>';

    // Row 3: basket
    h+='<div style="display:flex;gap:8px;font-size:10px;flex-wrap:wrap">';
    h+='<span style="color:var(--t2)">'+(c.n||0)+' saham'+(c.thin?' <b style="color:var(--am)">thin</b>':'')+'</span>';
    h+='<span style="color:'+cl(c.median_chg)+';font-weight:600">Med '+pc(c.median_chg)+'</span>';
    h+='<span style="color:'+cl(c.avg_chg)+'">Avg '+pc(c.avg_chg)+'</span>';
    h+='<span style="color:var(--t3)">'+(c.up||0)+'↑/'+(c.down||0)+'↓</span>';
    h+='<span style="color:'+cl(fn)+';font-weight:600">FNet '+cmdFmt(fn)+'</span>';
    h+='</div>';

    // Row 4: horizon + divergensi
    h+='<div style="display:flex;gap:8px;font-size:9px;color:var(--t3);margin-top:2px">';
    h+='<span>5D <b style="color:'+cl(c.avg_5d)+'">'+pc(c.avg_5d)+'</b></span>';
    h+='<span>20D <b style="color:'+cl(c.avg_20d)+'">'+pc(c.avg_20d)+'</b></span>';
    if(c.divergence!=null)h+='<span style="margin-left:auto">div <b style="color:'+(c.divergence>0?'var(--gn)':'var(--rd)')+'">'+(c.divergence>0?'+':'')+c.divergence.toFixed(1)+' pp</b></span>';
    h+='</div>';

    // Row 3: ticker chips
    if(c.stocks&&c.stocks.length){
      h+='<div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:6px">';
      var show=Math.min(c.stocks.length,10);
      for(var j=0;j<show;j++){
        var s=c.stocks[j];
        var sc=s.chg_pct>0?'var(--gn)':s.chg_pct<0?'var(--rd)':'#888';
        h+='<span style="font-family:monospace;font-size:9px;font-weight:600;padding:2px 5px;border-radius:3px;background:rgba(0,0,0,0.05);color:'+sc+'">'+s.code+'</span>';
      }
      if(c.stocks.length>10)h+='<span style="font-size:9px;color:var(--t2)">+'+(c.stocks.length-10)+'</span>';
      h+='</div>';
    }
    h+='</div>';
  }
  h+='</div>';

  // Expanded table
  if(cmdExpanded){
    var cmd=null;
    for(var k=0;k<cmds.length;k++){if(cmds[k].id===cmdExpanded){cmd=cmds[k];break;}}
    if(cmd&&cmd.stocks&&cmd.stocks.length)h+=cmdTable(cmd);
  }

  if(cmdData.trade_date)h+='<div style="font-size:10px;color:var(--t2);padding:4px 0">IDX Data: '+cmdData.trade_date+'</div>';
  // Penanda basi tidak boleh cuma menumpang di kartu: baris ini menyebut SESI RUJUKAN
  // yang dipakai gerbang per-seri, jadi pembaca tahu "terakhir 15 Okt" diukur terhadap apa.
  var cf=cmdData.freshness;
  if(cf&&cf.stale_codes&&cf.stale_codes.length){
    var parts=[];
    for(var m=0;m<cmds.length;m++){
      var cq=cmds[m].commodity;
      if(cq&&cq.stale)parts.push(cq.code+' ('+shortDay(cq.stale_date||cq.date)+', '+cq.lag_sessions+' sesi)');
    }
    h+='<div style="font-size:10px;color:var(--am);padding:0 0 4px;line-height:1.4">⏸ '+parts.length+' seri komoditas tertinggal dari sesi '+shortDay(cf.ref_date)+': '+parts.join(' · ')+'</div>';
  }
  h+='</div>';

  el.innerHTML=h;
}

function cmdToggle(id){cmdExpanded=cmdExpanded===id?null:id;cmdRender();}
function cmdSortBy(key){if(cmdSort===key)cmdDir=cmdDir==='desc'?'asc':'desc';else{cmdSort=key;cmdDir='desc';}cmdRender();}

function cmdTable(cmd){
  var stocks=cmd.stocks.slice();
  var d=cmdDir==='desc'?-1:1;
  if(cmdSort==='code')stocks.sort(function(a,b){return d*a.code.localeCompare(b.code);});
  else if(cmdSort==='close')stocks.sort(function(a,b){return d*((b.close||0)-(a.close||0));});
  else if(cmdSort==='chg')stocks.sort(function(a,b){return d*((b.chg_pct||0)-(a.chg_pct||0));});
  else if(cmdSort==='fnet')stocks.sort(function(a,b){return d*((b.fnet_val||0)-(a.fnet_val||0));});
  else stocks.sort(function(a,b){return d*((b.value||0)-(a.value||0));});

  var h='<div style="border:1px solid var(--b2,var(--b2));border-radius:10px;overflow:hidden;margin-bottom:12px">';
  h+='<div style="padding:8px 12px;border-bottom:1px solid var(--b1,var(--b1));display:flex;align-items:center;gap:8px">';
  h+='<span style="font-size:14px">'+(cmd.icon||'')+'</span><b>'+cmd.label+' — '+cmd.desc+'</b>';
  h+='<span style="flex:1"></span>';
  if(cmd.tv)h+='<a href="https://www.tradingview.com/chart/?symbol='+encodeURIComponent(cmd.tv)+'" target="_blank" style="font-size:10px;padding:3px 10px;border-radius:4px;background:var(--bl);color:#fff;text-decoration:none;font-weight:600">📈 TradingView</a>';
  h+='</div>';

  // table-layout:fixed + colgroup -> lebar kolom tidak ditentukan panjang nama,
  // dan header/isi memakai sumbu yang sama.
  h+='<table style="width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed">';
  h+='<colgroup><col style="width:62px"><col><col style="width:92px"><col style="width:78px"><col style="width:96px"><col style="width:96px"></colgroup>';
  h+='<thead><tr style="background:var(--bgH,var(--bgH))">';
  // dulu ditulis 'al'/'ar' -> CSS tidak valid, header tertinggal di kiri
  var cols=[['code','Code','left'],['','Name','left'],['close','Close','right'],['chg','Chg%','right'],['value','Value','right'],['fnet','F.Net','right']];
  for(var i=0;i<cols.length;i++){
    var ck=cols[i][0],cl=cols[i][1],ca=cols[i][2];
    var arrow=cmdSort===ck?(cmdDir==='desc'?' ▼':' ▲'):'';
    var sty=cmdSort===ck?'color:var(--bl);':'';
    if(ck)h+='<th style="padding:6px 8px;text-align:'+ca+';cursor:pointer;'+sty+'" onclick="cmdSortBy(\''+ck+'\')">'+cl+arrow+'</th>';
    else h+='<th style="padding:6px 8px;text-align:'+ca+'">'+cl+'</th>';
  }
  h+='</tr></thead><tbody>';

  for(var j=0;j<stocks.length;j++){
    var s=stocks[j];
    var chg=s.chg_pct||0;
    var fn=s.fnet_val||0;
    h+='<tr style="border-top:1px solid var(--b1,var(--b1))">';
    h+='<td style="padding:4px 8px"><span style="color:var(--bl);font-weight:700;cursor:pointer;font-family:monospace" onclick="if(typeof gsOpen===\'function\')gsOpen(\''+s.code+'\')">'+s.code+'</span></td>';
    h+='<td style="padding:4px 8px;font-size:9px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.name||'')+'</td>';
    h+='<td style="padding:4px 8px;text-align:right;font-family:monospace;font-weight:600">'+(s.close||0).toLocaleString()+'</td>';
    h+='<td style="padding:4px 8px;text-align:right;font-family:monospace;font-weight:600;color:'+(chg>0?'var(--gn)':chg<0?'var(--rd)':'#888')+'">'+(chg>0?'+':'')+chg.toFixed(2)+'%</td>';
    h+='<td style="padding:4px 8px;text-align:right;font-family:monospace">'+cmdFmt(s.value||0)+'</td>';
    h+='<td style="padding:4px 8px;text-align:right;font-family:monospace;font-weight:600;color:'+(fn>0?'var(--gn)':fn<0?'var(--rd)':'#888')+'">'+cmdFmt(fn)+'</td>';
    h+='</tr>';
  }
  h+='</tbody></table></div>';
  return h;
}

function cmdFmt(v){
  if(!v)return'0';
  var abs=Math.abs(v);
  if(abs>=1e12)return(v/1e12).toFixed(1)+' T';
  if(abs>=1e9)return(v/1e9).toFixed(1)+' B';
  if(abs>=1e6)return(v/1e6).toFixed(1)+' M';
  if(abs>=1e3)return(v/1e3).toFixed(1)+' K';
  return Math.round(v).toString();
}