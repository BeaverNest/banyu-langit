// THEME
function togTh(){const h=document.documentElement;const n=h.getAttribute('data-theme')==='dark'?'light':'dark';h.setAttribute('data-theme',n);$('thbtn').textContent=n==='dark'?'🌙':'☀️';localStorage.setItem('th',n);if(!chartHidden)loadChart();}


// ═══ SECTOR — moved to sector-intelligence.js ═══

// ═══ CHART ═══
function loadChart(){
  const th=document.documentElement.getAttribute('data-theme')||'light';
  const bg=th==='dark'?'#0F0F0F':'#ffffff';
  const gr=th==='dark'?'rgba(242,242,242,0.06)':'rgba(0,0,0,0.06)';
  const cfg=JSON.stringify({"allow_symbol_change":true,"calendar":false,"details":true,"hide_side_toolbar":false,"hide_top_toolbar":false,"hide_legend":false,"hide_volume":false,"hotlist":false,"interval":"D","locale":"en","save_image":true,"style":"1","symbol":"IDX:COMPOSITE","theme":th,"timezone":"Asia/Jakarta","backgroundColor":bg,"gridColor":gr,"watchlist":[],"withdateranges":true,"compareSymbols":[],"studies":[],"autosize":true});
  const html=`<!DOCTYPE html><html><head><style>body{margin:0;overflow:hidden;height:100vh}</style></head><body><div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:calc(100% - 32px);width:100%"></div><script src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>${cfg}<\/script></div></body></html>`;
  const f=document.createElement('iframe');f.style.cssText='width:100%;height:100%;border:none';
  $('chart').innerHTML='';$('chart').appendChild(f);
  f.contentDocument.open();f.contentDocument.write(html);f.contentDocument.close();
}

// TABS
function stab(n,b){document.querySelectorAll('.tabs .tab').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.querySelectorAll('.tpanel').forEach(p=>p.classList.remove('on'));$('t-'+n).classList.add('on');if(n==='wl'){loadWL();loadAl();}if(n==='mkt')loadMktOverview();if(n==='scr')loadScreener();if(n==='ins')chkIns();}
function swt(n,b){const panel=b.closest('.tpanel');panel.querySelectorAll('.wt-b').forEach(x=>x.classList.remove('on'));b.classList.add('on');panel.querySelectorAll('.wp').forEach(p=>p.classList.remove('on'));$('w-'+n).classList.add('on');}
function smkt(n,b){const panel=b.closest('.tpanel');panel.querySelectorAll('.wt-b').forEach(x=>x.classList.remove('on'));b.classList.add('on');panel.querySelectorAll('.wp').forEach(p=>p.classList.remove('on'));$('m-'+n).classList.add('on');if(n==='ov')loadMktOverview();if(n==='bei')loadBei();if(n==='nws')lNews('');}
function sins(n,b){const panel=b.closest('.tpanel');panel.querySelectorAll('.wt-b').forEach(x=>x.classList.remove('on'));b.classList.add('on');panel.querySelectorAll('.wp').forEach(p=>p.classList.remove('on'));$('i-'+n).classList.add('on');}

const mktCache={};
async function loadMktOverview(){
  var el=$('ml-ov');if(!el)return;
  if(mktCache._ov&&Date.now()-mktCache._ov.ts<60000){el.innerHTML=mktCache._ov.html;return;}
  el.innerHTML='<div class="ne">Loading...</div>';
  try{
    var [idx,cmd,cur]=await Promise.all([
      fetch('/api/market?cat=indices').then(r=>r.json()),
      fetch('/api/market?cat=commodities').then(r=>r.json()),
      fetch('/api/market?cat=currencies').then(r=>r.json())
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
    renderSection('Indices','📊',idx);
    renderSection('Commodities','🛢',cmd);
    renderSection('Currencies','💱',cur);
    mktCache._ov={html:h,ts:Date.now()};
    el.innerHTML=h;
  }catch{el.innerHTML='<div class="ne">Failed to load</div>';}
}

// RESIZE + CHART TOGGLE
let chartHidden=false;
function togChart(){
  var pr=document.querySelector('.pR');var pl=$('pL');var rh=$('rh');var btn=$('chtog');
  if(chartHidden){pr.style.display='';rh.style.display='';pl.style.width=pl.dataset.prevW||'420px';pl.style.maxWidth='800px';document.querySelector('.layout').classList.remove('ctr');btn.style.background='';chartHidden=false;loadChart();}
  else{pl.dataset.prevW=pl.offsetWidth+'px';pl.style.width='1220px';pl.style.maxWidth='1220px';document.querySelector('.layout').classList.add('ctr');pr.style.display='none';rh.style.display='none';btn.style.background='var(--blB)';chartHidden=true;}
}
(function(){var h=$('rh'),p=$('pL');var sx,sw;
h.addEventListener('mousedown',function(e){sx=e.clientX;sw=p.offsetWidth;h.classList.add('ac');document.body.classList.add('rz');document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);});
function mv(e){p.style.width=Math.max(280,Math.min(800,sw+(e.clientX-sx)))+'px';}
function up(){h.classList.remove('ac');document.body.classList.remove('rz');document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);}
})();

// ═══ Keyboard Shortcuts ═══
document.addEventListener('keydown',function(e){
  var tag=e.target.tagName;if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
  if(e.key==='/'){e.preventDefault();var gs=$('gsearch');if(gs){gs.focus();gs.select();}}
  if(e.key>='1'&&e.key<='5'&&!e.ctrlKey&&!e.metaKey&&!e.altKey){var tabs=document.querySelectorAll('.tabs .tab');var idx=parseInt(e.key)-1;if(tabs[idx]){tabs[idx].click();e.preventDefault();}}
  if(e.key==='c'){var ct=$('cta');if(ct){ct.focus();e.preventDefault();}}
  if(e.key==='?'){showT('Shortcuts','/ Search · 1-4 Tabs · C Compose · Esc Close');e.preventDefault();}
  if(e.key==='Escape')closeSettings();
});



// ═══ INIT: Theme + Chart default ═══
(function(){
  var saved=localStorage.getItem('th');
  if(saved){document.documentElement.setAttribute('data-theme',saved);$('thbtn').textContent=saved==='dark'?'🌙':'☀️';}
  // Chart: default hidden unless user set visible
  var chartPref=localStorage.getItem('chartDefault');
  if(chartPref!=='visible'){setTimeout(function(){if(!chartHidden)togChart();},100);}
})();