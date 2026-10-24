// ═══ BANYU LANGIT — Bloomberg Terminal App.js ═══
// Sidebar tabs, lazy load, keyboard nav, compact mode

// THEME
function togTh(){
  var h=document.documentElement;
  var n=h.getAttribute('data-theme')==='dark'?'light':'dark';
  h.setAttribute('data-theme',n);
  $('thbtn').textContent=n==='dark'?'🌙':'☀️';
  localStorage.setItem('th',n);
}

// ═══ SIDEBAR ═══
var sidebarExpanded=false;

function toggleSidebar(){
  var sb=$('sidebar');
  sidebarExpanded=!sidebarExpanded;
  sb.classList.toggle('expanded',sidebarExpanded);
  $('sidebar-arrow').textContent=sidebarExpanded?'◀':'▶';
  localStorage.setItem('sidebarExpanded',sidebarExpanded?'1':'0');
}

// ═══ COMPACT MODE ═══
function toggleCompact(){
  document.body.classList.toggle('compact');
  var isCompact=document.body.classList.contains('compact');
  localStorage.setItem('compact',isCompact?'1':'0');
  showT(isCompact?'Compact ON':'Compact OFF','Data density '+(isCompact?'maximum':'normal'));
}

// ═══ LAZY LOAD TRACKER ═══
var tabLoaded={regime:false,ihsg:false,mkt:false,diary:false,analysis:false,bt:false};

// ═══ MAIN TAB ROUTING — sidebar ═══
function stab(n,el){
  // Update sidebar
  document.querySelectorAll('.sidebar-tab[data-tab]').forEach(function(x){x.classList.remove('on')});
  var sidebarTab=document.querySelector('.sidebar-tab[data-tab="'+n+'"]');
  if(sidebarTab)sidebarTab.classList.add('on');
  // Also update old hidden tabs (compat)
  document.querySelectorAll('.tabs .tab').forEach(function(x){x.classList.remove('on')});

  // Switch panels
  document.querySelectorAll('.tpanel').forEach(function(p){p.classList.remove('on')});
  var panel=$('t-'+n);
  if(panel)panel.classList.add('on');

  // Lazy load — only load content on first visit
  // Market tab kini mendarat di sub-tab Commodities: Overview dihapus karena isinya
  // sudah ada di Market Regime (permintaan pemilik, 21 Okt 2026).
  // Market Regime kini menu sendiri (dulu sub-tab pertama Analysis). Dimuat saat pertama
  // dibuka, lalu di-refresh setiap kali tab diklik karena angkanya bergantung pipeline harian.
  if(n==='regime'){tabLoaded.regime=true;if(typeof loadMarketRegime==='function')loadMarketRegime();}
  // Halaman IHSG dimuat sekali per sesi browser (payload 60s-cache di server); klik ulang
  // memakai ihgData yang sudah ada, jadi tidak fetch berulang.
  // Menu IHSG punya 4 sub-panel; saat dibuka pertama kali tampilkan ringkasannya.
  // Klik ulang menu (bukan pindah tab) mengembalikan ke ringkasan supaya perilakunya
  // sama dengan menu lain yang selalu mendarat di tampilan default.
  if(n==='ihsg'){
    tabLoaded.ihsg=true;
    if(typeof ihsgTab==='function') ihsgTab('overview');
    else if(typeof loadIhsgPage==='function') loadIhsgPage();
  }
  if(n==='mkt'){tabLoaded.mkt=true;if(typeof loadCommodities==='function')loadCommodities();}
  if(n==='diary'&&!tabLoaded.diary){tabLoaded.diary=true;}
  if(n==='analysis'&&!tabLoaded.analysis){tabLoaded.analysis=true;}
  if(n==='scr'&&!tabLoaded.scr){tabLoaded.scr=true;if(typeof loadScreener==='function')loadScreener();}
  if(n==='pf'&&!tabLoaded.pf){tabLoaded.pf=true;if(typeof loadPortfolio==='function')loadPortfolio();}
  if(n==='bt'&&!tabLoaded.bt){tabLoaded.bt=true;if(typeof loadBacktest==='function')loadBacktest();}

  // Re-trigger load for tabs that need refresh
  if(n==='analysis'&&typeof loadMarketRegime==='function')loadMarketRegime();
}

// Market Regime: satu-satunya sub-tab di panelnya sendiri. Fungsi ini ada supaya tombol
// `.wt-b` di panel itu tidak memanggil anaSubTab() yang menargetkan #t-analysis.
// Market sub-tabs
function smkt(n,b){
  var panel=b.closest('.tpanel');
  panel.querySelectorAll('.wt-b').forEach(function(x){x.classList.remove('on')});
  b.classList.add('on');
  panel.querySelectorAll('.wp').forEach(function(p){p.classList.remove('on')});
  $('m-'+n).classList.add('on');
  if(n==='nws')lNews('');
  if(n==='ann')loadAnnouncements();
  if(n==='cmd'&&typeof loadCommodities==='function')loadCommodities();
}

// ═══ ANALYSIS SUB-TABS ═══
function anaSubTab(n,b){
  var panel=b.closest('.tpanel');
  panel.querySelectorAll('.wt-b').forEach(function(x){x.classList.remove('on')});
  b.classList.add('on');
  panel.querySelectorAll('.wp').forEach(function(p){p.classList.remove('on')});
  $('ana-'+n).classList.add('on');
  if(n==='usdaily'&&typeof loadUSDaily==='function')loadUSDaily();
  if(n==='sectors'&&typeof loadSectorView==='function')loadSectorView();
  if(n==='compare'&&typeof renderCompare==='function')renderCompare();
  if(n==='correlation'&&typeof loadCorrelationView==='function')loadCorrelationView();
}



// ═══ MARKET OVERVIEW — DIHAPUS DARI UI (21 Okt 2026) ═══
// Sub-tab Maket > Overview dihapus: isinya (harga + chg 1D/5D/20D per seri) sudah
// ada di panel Market Regime. Route `/api/market/overview` TETAP ada di
// server/routes/market.js karena dipakai server/scripts/check-series-freshness.js
// (penjaga kesegaran seri), jadi jangan hapus route-nya saat membersihkan UI.
// CSS .mkt-list/.mkt-section-h di css/ juga dibiarkan (tidak lagi dipakai di sini).

// ═══ WATCHLIST DROPDOWN TOGGLE ═══
function togWL(){
  var d=$('wldrop');d.classList.toggle('o');
  if(d.classList.contains('o')){loadWL();loadAl();}
}
document.addEventListener('click',function(e){
  if(!$('wlbtn').contains(e.target)&&!$('wldrop').contains(e.target))$('wldrop').classList.remove('o');
});

// ═══ KEYBOARD SHORTCUTS ═══
document.addEventListener('keydown',function(e){
  var tag=e.target.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;

  // / = Focus search
  if(e.key==='/'){e.preventDefault();var gs=$('gsearch');if(gs){gs.focus();gs.select();}}

  // 1-8 = Tab switch, HARUS sejajar dengan angka di title sidebar
  // (index.html: Market Regime [1] … Screener [8]). Menambah/menghapus menu berarti
  // dua tempat ini ikut diubah; kalau tidak, label menjanjikan tombol yang mati.
  if(e.key>='1'&&e.key<='8'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    var tabNames=['regime','ihsg','mkt','diary','analysis','pf','bt','scr'];
    var idx=parseInt(e.key)-1;
    if(idx<tabNames.length){stab(tabNames[idx]);e.preventDefault();}
  }

  // C = Compose (diary)
  if(e.key==='c'){var ct=$('cta');if(ct){stab('diary');ct.focus();e.preventDefault();}}

  // W = Watchlist
  if(e.key==='w'){togWL();e.preventDefault();}

  // S = Toggle sidebar
  if(e.key==='s'){toggleSidebar();e.preventDefault();}

  // T = Toggle theme
  if(e.key==='t'){togTh();e.preventDefault();}

  // D = Toggle compact (density)
  if(e.key==='d'){toggleCompact();e.preventDefault();}

  // ? = Help
  if(e.key==='?'){
    showT('Keyboard Shortcuts',
      '/ Search · 1-4 Tabs · C Compose · W Watchlist · S Sidebar · T Theme · D Density · Esc Close');
    e.preventDefault();
  }

  // Escape = Close overlays
  if(e.key==='Escape'){
    closeSettings();
    $('wldrop').classList.remove('o');
    $('ndrop').classList.remove('o');
  }
});

// ═══ INIT: Theme + Sidebar + Compact ═══
(function(){
  // Theme — default dark
  var saved=localStorage.getItem('th')||'dark';
  document.documentElement.setAttribute('data-theme',saved);
  if($('thbtn'))$('thbtn').textContent=saved==='dark'?'🌙':'☀️';

  // Sidebar state
  var sbState=localStorage.getItem('sidebarExpanded');
  if(sbState==='1'){
    sidebarExpanded=true;
    $('sidebar').classList.add('expanded');
    $('sidebar-arrow').textContent='◀';
  }

  // Compact mode
  if(localStorage.getItem('compact')==='1'){
    document.body.classList.add('compact');
  }
})();

// ═══ BEI ANNOUNCEMENTS ═══
var _annData=[];
async function loadAnnouncements(){
  var el=$('ann-list');if(!el)return;
  var q=($('ann-q')||{}).value||'';
  el.innerHTML='<div class="ne">Loading...</div>';
  try{
    var url='/api/announcements?limit=100';
    if(q)url+='&q='+encodeURIComponent(q);
    var r=await fetch(url);var d=await r.json();
    _annData=d.data||[];
    if(!_annData.length){el.innerHTML='<div class="ne">No announcements'+(q?' for "'+esc(q)+'"':'')+'</div>';return;}
    el.innerHTML='<div style="padding:2px 10px;font-size:var(--font-xs);color:var(--t3)">'+d.total.toLocaleString()+' total announcements</div>'+
      _annData.map(function(a,i){
        var date=a.ann_date||'';
        var code=a.company_code||'';
        var typeColor=a.type==='STOCK'?'var(--gn)':a.type==='BOND'?'var(--bl)':'var(--t3)';
        var hasAttach=false;
        try{var att=JSON.parse(a.attachments||'[]');hasAttach=att.length>0;}catch{}
        return '<div class="ni" style="cursor:pointer" onclick="openAnnPopup('+i+')"><div class="nc" style="flex:1">'+
          '<div class="nt">'+
            (code?'<span style="color:var(--bl);font-weight:700;margin-right:6px" onclick="event.stopPropagation();if(typeof gsOpen===\'function\')gsOpen(\''+esc(code)+'\')">'+esc(code)+'</span>':'')+
            esc(a.title||'')+
            (hasAttach?' <span style="color:var(--am);font-size:var(--font-xs)">📎</span>':'')+
          '</div>'+
          '<div class="nm">'+
            '<span style="color:'+typeColor+'">'+esc(a.type||'')+'</span>'+
            '<span>'+esc(date)+'</span>'+
            (a.subject?'<span style="color:var(--t3)">'+esc(a.subject)+'</span>':'')+
          '</div>'+
        '</div></div>';
      }).join('');
  }catch(e){el.innerHTML='<div class="ne">Error: '+e.message+'</div>';}
}

function openAnnPopup(idx){
  var a=_annData[idx];if(!a)return;
  var attachments=[];
  try{attachments=JSON.parse(a.attachments||'[]');}catch{}

  var h='<div class="epop-head"><div style="font-size:18px">📋</div><div class="epop-meta">';
  h+='<div class="en" style="font-size:15px">';
  if(a.company_code)h+='<span style="color:var(--bl);cursor:pointer" onclick="cPop();if(typeof gsOpen===\'function\')gsOpen(\''+esc(a.company_code)+'\')">'+esc(a.company_code)+'</span> ';
  h+=esc(a.title||'')+'</div>';
  h+='<div style="font-size:var(--font-sm);color:var(--t2);margin-top:2px">';
  h+='<span style="color:'+(a.type==='STOCK'?'var(--gn)':'var(--bl)')+'">'+esc(a.type||'')+'</span>';
  h+=' · '+esc(a.ann_date||'');
  if(a.subject)h+=' · '+esc(a.subject);
  h+='</div></div>';
  h+='<button class="epop-close" onclick="cPop()">✕</button></div>';

  h+='<div class="epop-body">';

  // Attachments
  if(attachments.length){
    h+='<div style="margin-bottom:12px">';
    h+='<div style="font-size:var(--font-xs);font-weight:700;color:var(--t3);text-transform:uppercase;margin-bottom:6px">Attachments ('+attachments.length+')</div>';
    attachments.forEach(function(att){
      var url=att.url||'';
      if(url&&!url.startsWith('http'))url='https://www.idx.co.id'+url;
      var name=att.filename||att.name||'Document';
      h+='<a href="'+esc(url)+'" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:4px;border-radius:4px;border:1px solid var(--b1);background:var(--bgH);text-decoration:none;color:var(--t1);transition:all .1s" onmouseover="this.style.borderColor=\'var(--bl)\'" onmouseout="this.style.borderColor=\'var(--b1)\'">';
      h+='<span style="font-size:18px">📄</span>';
      h+='<div style="flex:1;min-width:0"><div style="font-size:var(--font-md);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(name)+'</div>';
      h+='<div style="font-size:var(--font-xs);color:var(--t3)">PDF · Click to open</div></div>';
      h+='<span style="font-size:var(--font-sm);color:var(--bl)">Open ↗</span>';
      h+='</a>';
    });
    h+='</div>';
  }else{
    h+='<div style="font-size:var(--font-md);color:var(--t3);padding:12px 0">No attachments</div>';
  }

  // Ticker link
  if(a.company_code){
    h+='<div style="margin-top:8px;display:flex;gap:6px">';
    h+='<button style="padding:4px 10px;border-radius:4px;border:1px solid var(--b2);background:var(--bgH);color:var(--bl);font-family:var(--f);font-size:var(--font-sm);cursor:pointer" onclick="cPop();if(typeof gsOpen===\'function\')gsOpen(\''+esc(a.company_code)+'\')">View '+esc(a.company_code)+' Detail</button>';
    h+='<button style="padding:4px 10px;border-radius:4px;border:1px solid var(--b2);background:var(--bgH);color:var(--t2);font-family:var(--f);font-size:var(--font-sm);cursor:pointer" onclick="$(\'ann-q\').value=\''+esc(a.company_code)+'\';cPop();loadAnnouncements()">More from '+esc(a.company_code)+'</button>';
    h+='</div>';
  }

  h+='</div>';

  $('epop-box').innerHTML=h;
  $('epop').classList.add('o');
}

// ═══ BACKWARD COMPAT ═══
function scrSubTab(n,b){anaSubTab(n,b);}
function swt(n,b){}
