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
var tabLoaded={mkt:false,idx:false,diary:false,analysis:false,pf:false,ins:false};

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
  if(n==='mkt'&&!tabLoaded.mkt){tabLoaded.mkt=true;loadMktOverview();}
  if(n==='idx'&&!tabLoaded.idx){tabLoaded.idx=true;if(typeof loadIdxDaily==='function')loadIdxDaily();}
  if(n==='diary'&&!tabLoaded.diary){tabLoaded.diary=true;}
  if(n==='analysis'&&!tabLoaded.analysis){tabLoaded.analysis=true;if(typeof loadScreener==='function')loadScreener();}
  if(n==='pf'&&!tabLoaded.pf){tabLoaded.pf=true;if(typeof loadPortfolio==='function')loadPortfolio();}
  if(n==='ins'&&!tabLoaded.ins){tabLoaded.ins=true;if(typeof chkIns==='function')chkIns();}

  // Re-trigger load for tabs that need refresh
  if(n==='mkt')loadMktOverview();
  if(n==='idx'&&typeof loadIdxDaily==='function')loadIdxDaily();
  if(n==='analysis'&&typeof loadScreener==='function')loadScreener();
  if(n==='pf'&&typeof loadPortfolio==='function')loadPortfolio();
  if(n==='ins'&&typeof chkIns==='function')chkIns();
}

// Market sub-tabs
function smkt(n,b){
  var panel=b.closest('.tpanel');
  panel.querySelectorAll('.wt-b').forEach(function(x){x.classList.remove('on')});
  b.classList.add('on');
  panel.querySelectorAll('.wp').forEach(function(p){p.classList.remove('on')});
  $('m-'+n).classList.add('on');
  if(n==='ov')loadMktOverview();
  if(n==='nws')lNews('');
  if(n==='cmd'&&typeof loadCommodities==='function')loadCommodities();
}

// ═══ ANALYSIS SUB-TABS ═══
function anaSubTab(n,b){
  var panel=b.closest('.tpanel');
  panel.querySelectorAll('.wt-b').forEach(function(x){x.classList.remove('on')});
  b.classList.add('on');
  panel.querySelectorAll('.wp').forEach(function(p){p.classList.remove('on')});
  $('ana-'+n).classList.add('on');
  if(n==='screener'&&typeof loadScreener==='function')loadScreener();
  if(n==='sectors'&&typeof loadSectorView==='function')loadSectorView();
  if(n==='compare'&&typeof renderCompare==='function')renderCompare();
  if(n==='correlation'&&typeof loadCorrelationView==='function')loadCorrelationView();
  if(n==='backtest'&&typeof loadBacktest==='function')loadBacktest();
}

// Insider sub-tabs (compat)
function sins(n,b){var panel=b.closest('.tpanel');panel.querySelectorAll('.wt-b').forEach(function(x){x.classList.remove('on')});b.classList.add('on');panel.querySelectorAll('.wp').forEach(function(p){p.classList.remove('on')});$('i-'+n).classList.add('on');}

// ═══ MARKET OVERVIEW ═══
var mktCache={};
async function loadMktOverview(){
  var el=$('ml-ov');if(!el)return;
  if(mktCache._ov&&Date.now()-mktCache._ov.ts<60000){el.innerHTML=mktCache._ov.html;return;}
  el.innerHTML='<div class="ne">Loading...</div>';
  try{
    var [idx,cmd,cur]=await Promise.all([
      fetch('/api/market?cat=indices').then(function(r){return r.json()}),
      fetch('/api/market?cat=commodities').then(function(r){return r.json()}),
      fetch('/api/market?cat=currencies').then(function(r){return r.json()})
    ]);
    var h='';
    function renderSection(title,icon,data){
      h+='<div class="mkt-section-h">'+icon+' '+title+'</div>';
      data.forEach(function(m){
        var c=m.change>0?'up':m.change<0?'dn':'fl';
        var ar=m.change>0?'▲':m.change<0?'▼':'';
        var s=m.change>0?'+':'';
        var pr=m.price?m.price.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
        var ch=m.price?ar+' '+s+m.change.toFixed(2)+'%':'—';
        h+='<div class="mkt-item"><span class="mkt-label">'+esc(m.label)+'</span><span class="mkt-desc">'+esc(m.desc)+'</span><span class="mkt-price">'+pr+'</span><span class="mkt-chg '+c+'">'+ch+'</span></div>';
      });
    }
    renderSection('INDICES','📊',idx);
    renderSection('COMMODITIES','🛢',cmd);
    renderSection('CURRENCIES','💱',cur);
    mktCache._ov={html:h,ts:Date.now()};
    el.innerHTML=h;
  }catch(e){el.innerHTML='<div class="ne">Failed to load</div>';}
}

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

  // 1-6 = Tab switch
  if(e.key>='1'&&e.key<='6'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    var tabNames=['mkt','idx','diary','analysis','pf','ins'];
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
      '/ Search · 1-6 Tabs · C Compose · W Watchlist · S Sidebar · T Theme · D Density · Esc Close');
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

// ═══ BACKWARD COMPAT ═══
function scrSubTab(n,b){anaSubTab(n,b);}
function swt(n,b){}
