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
    if(cm&&(cm.state==='excess'||cm.stale===true)){
      h+='<b style="font-family:monospace;color:var(--t2)" title="bar terakhir '+shortDay(cm.stale_date||cm.date)+' (level '+px(cm.price)+') — bukan sesi '+shortDay(cm.ref_date)+'">—</b>';
      h+='<span style="color:var(--am);font-weight:600;font-size:9px" title="sumber tidak menerbitkan bar untuk '+(cm.lag_sessions||0)+' sesi terakhir; retry tidak menolong, yang berhenti di hulu">⏸ basi · terakhir '+shortDay(cm.stale_date||cm.date)+' · '+(cm.lag_sessions||0)+' sesi</span>';
    } else if(cm&&cm.state==='by_source'){
      // Sumber memang lambat (CPO/RSS3: nol bar Jumat). Bukan alarm: harga + tanggal bar
      // ditulis apa adanya dalam warna netral, tanpa kata "basi" dan tanpa banner ⏸ —
      // alarm-kelelahan berasal dari kata, bukan cuma dari warna (kanban t_b234606a).
      h+='<b style="font-family:monospace">'+px(cm.price)+'</b>';
      h+='<span style="color:var(--t3);font-size:9px" title="lag '+(cm.lag_sessions||0)+' sesi masih dalam kebiasaan sumber (ekspektasi '+(cm.expected_lag_sessions==null?'?':cm.expected_lag_sessions)+' sesi)">sumber lag '+(cm.lag_sessions||0)+' sesi ('+shortDay(cm.stale_date||cm.date)+')</span>';
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
    // 5D/10D/20D = perubahan per SESI, dihitung server dari harga terkoreksi aksi korporasi
    // (ca_adj) atas N+1 bar. n per horizon ikut ditulis: basket yang belum punya 20 sesi
    // membuat rata-rata 20D dihitung dari nama lebih sedikit daripada 5D.
    h+='<div style="display:flex;gap:8px;font-size:9px;color:var(--t3);margin-top:2px">';
    h+='<span title="'+(c.n_5d||0)+' saham">5D <b style="color:'+cl(c.avg_5d)+'">'+pc(c.avg_5d)+'</b></span>';
    h+='<span title="'+(c.n_10d||0)+' saham">10D <b style="color:'+cl(c.avg_10d)+'">'+pc(c.avg_10d)+'</b></span>';
    h+='<span title="'+(c.n_20d||0)+' saham">20D <b style="color:'+cl(c.avg_20d)+'">'+pc(c.avg_20d)+'</b></span>';
    if(c.divergence!=null)h+='<span style="margin-left:auto">div <b style="color:'+(c.divergence>0?'var(--gn)':'var(--rd)')+'">'+(c.divergence>0?'+':'')+c.divergence.toFixed(2)+' pp</b></span>';
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
  // Banner ⏸ hanya untuk 'excess' (di luar kebiasaan sumber). Seri 'by_source' tidak masuk
  // sini walau lag-nya > 0 — kalau masuk, kembalilah alarm-kelelahan yang kartu t_b234606a
  // hapus. Karena itu pembandingnya `state`/`stale`, bukan `lag_sessions > 0`.
  var cf=cmdData.freshness;
  if(cf&&cf.stale_codes&&cf.stale_codes.length){
    var parts=[];
    for(var m=0;m<cmds.length;m++){
      var cq=cmds[m].commodity;
      if(cq&&(cq.state==='excess'||cq.stale===true))parts.push(cq.code+' ('+shortDay(cq.stale_date||cq.date)+', '+(cq.excess_sessions==null?cq.lag_sessions:cq.excess_sessions)+' sesi di atas kebiasaan)');
    }
    h+='<div style="font-size:10px;color:var(--am);padding:0 0 4px;line-height:1.4">⏸ '+parts.length+' seri komoditas tertinggal dari sesi '+shortDay(cf.ref_date)+': '+parts.join(' · ')+'</div>';
  }
  // Sinyal sistem "pipeline data berhenti" (kanban t_c6c01360): saat state stopped/calendar_stale
  // setiap seri sudah turun ke 'na' di server (lag null), jadi banner ⏸ di atas tidak akan menyala.
  // Panel ini hanya perlu TIDAK berbohong: tulis sebabnya dengan teks netral yang sama seperti
  // badge Market Regime (var(--t3)) — bukan alarm, karena angka lag-nya memang tidak diketahui.
  var cp=cf&&cf.pipeline;
  if(cp&&(cp.state==='lag1'||cp.state==='stopped'||cp.state==='calendar_stale')){
    var cpTxt=cp.state==='lag1'
      ? 'sesi terakhir belum masuk (data terakhir '+shortDay(cp.ref_date||'—')+')'
      : cp.state==='stopped'
        ? 'pipeline data berhenti '+(cp.elapsed_sessions==null?0:cp.elapsed_sessions)+' sesi — kesegaran per seri tidak diukur'
        : 'kalender sesi kedaluwarsa (valid s/d '+((cp.calendar&&cp.calendar.valid_through)||'—')+')';
    h+='<div id="cmd-pipeline-note" data-state="'+cp.state+'" style="font-size:10px;color:var(--t3);padding:0 0 4px;line-height:1.4">'+cpTxt+'</div>';
  }
  h+='</div>';

  el.innerHTML=h;
}

function cmdToggle(id){cmdExpanded=cmdExpanded===id?null:id;cmdRender();}
function cmdSortBy(key){if(cmdSort===key)cmdDir=cmdDir==='desc'?'asc':'desc';else{cmdSort=key;cmdDir='desc';}cmdRender();}

function cmdTable(cmd){
  var stocks=cmd.stocks.slice();
  // d=1 untuk desc: (b-a) positif berarti a di belakang b -> terbesar di atas.
  // Sebelumnya d=-1 untuk desc sehingga urutan terbalik dari panah ▼ yang ditulis header.
  var d=cmdDir==='desc'?1:-1;
  // null (sesi belum cukup) selalu di bawah, baik asc maupun desc — jangan diperlakukan 0%.
  function num(key){return function(a,b){
    var av=a[key],bv=b[key];
    if(av==null&&bv==null)return 0;
    if(av==null)return 1;
    if(bv==null)return -1;
    return d*(bv-av);
  };}
  if(cmdSort==='code')stocks.sort(function(a,b){return d*a.code.localeCompare(b.code);});
  else if(cmdSort==='close')stocks.sort(num('close'));
  else if(cmdSort==='chg')stocks.sort(num('chg_pct'));
  else if(cmdSort==='5d')stocks.sort(num('chg_5d'));
  else if(cmdSort==='10d')stocks.sort(num('chg_10d'));
  else if(cmdSort==='20d')stocks.sort(num('chg_20d'));
  else if(cmdSort==='fnet')stocks.sort(num('fnet_val'));
  else stocks.sort(num('value'));

  // Horizon: 2 desimal + tanda, seperti kolom Chg%. Nilai kosong ditulis '—', bukan 0,00%.
  // title menunjuk TANGGAL DASAR jendela: kalau emiten punya bar hilang (suspend/no-trade),
  // at(k) melompati bar itu sehingga jendela lebih lebar dari labelnya — pembaca bisa melihatnya.
  function hcell(v,base){
    if(v==null)return '<td style="padding:4px 8px;text-align:right;font-family:monospace;color:var(--t3)" title="bar sesi belum cukup">—</td>';
    return '<td style="padding:4px 8px;text-align:right;font-family:monospace;font-weight:600;color:'+(v>0?'var(--gn)':v<0?'var(--rd)':'#888')+'" title="dasar '+(base?shortDay(base):'—')+'">'+(v>0?'+':'')+v.toFixed(2)+'%</td>';
  }

  var h='<div style="border:1px solid var(--b2,var(--b2));border-radius:10px;overflow:hidden;margin-bottom:12px">';
  h+='<div style="padding:8px 12px;border-bottom:1px solid var(--b1,var(--b1));display:flex;align-items:center;gap:8px">';
  h+='<span style="font-size:14px">'+(cmd.icon||'')+'</span><b>'+cmd.label+' — '+cmd.desc+'</b>';
  h+='<span style="flex:1"></span>';
  if(cmd.tv)h+='<a href="https://www.tradingview.com/chart/?symbol='+encodeURIComponent(cmd.tv)+'" target="_blank" style="font-size:10px;padding:3px 10px;border-radius:4px;background:var(--bl);color:#fff;text-decoration:none;font-weight:600">📈 TradingView</a>';
  h+='</div>';

  // table-layout:fixed + colgroup -> lebar kolom tidak ditentukan panjang nama,
  // dan header/isi memakai sumbu yang sama.
  h+='<table style="width:100%;border-collapse:collapse;font-size:10px;table-layout:fixed">';
  h+='<colgroup><col style="width:62px"><col><col style="width:88px"><col style="width:68px"><col style="width:56px"><col style="width:56px"><col style="width:56px"><col style="width:92px"><col style="width:96px"></colgroup>';
  h+='<thead><tr style="background:var(--bgH,var(--bgH))">';
  // dulu ditulis 'al'/'ar' -> CSS tidak valid, header tertinggal di kiri
  var cols=[['code','Code','left'],['','Name','left'],['close','Close','right'],['chg','Chg%','right'],['5d','5D','right'],['10d','10D','right'],['20d','20D','right'],['value','Value','right'],['fnet','F.Net','right']];
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
    h+='<td title="'+esc(s.name||s.code)+'" style="padding:4px 8px;font-size:9px;color:var(--t2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.name||'')+'</td>';
    h+='<td style="padding:4px 8px;text-align:right;font-family:monospace;font-weight:600">'+(s.close||0).toLocaleString()+'</td>';
    h+='<td style="padding:4px 8px;text-align:right;font-family:monospace;font-weight:600;color:'+(chg>0?'var(--gn)':chg<0?'var(--rd)':'#888')+'">'+(chg>0?'+':'')+chg.toFixed(2)+'%</td>';
    h+=hcell(s.chg_5d,s.base_5d)+hcell(s.chg_10d,s.base_10d)+hcell(s.chg_20d,s.base_20d);
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
  if(abs>=1e12)return(v/1e12).toFixed(2)+' T';
  if(abs>=1e9)return(v/1e9).toFixed(2)+' B';
  if(abs>=1e6)return(v/1e6).toFixed(2)+' M';
  if(abs>=1e3)return(v/1e3).toFixed(2)+' K';
  return Math.round(v).toString();
}