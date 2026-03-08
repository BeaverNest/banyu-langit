// ═══ NEWS ═══
function sNews(){const v=$('nsi').value.trim().toUpperCase();lNews(v);$('nsi').value='';}
async function lNews(s){const ns=$('nsl');ns.innerHTML='<div class="ne">Loading...</div>';try{const u=s?`/api/news?symbol=${encodeURIComponent(s)}`:'/api/news';const r=await fetch(u);const items=await r.json();if(!items.length){ns.innerHTML=`<div class="ne">No news${s?' for '+esc(s):''}.</div>`;return;}
ns.innerHTML=items.map(n=>{const t=n.datetime?new Date(n.datetime*1000).toLocaleDateString('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';return`<div class="ni" onclick="window.open('${n.url}','_blank')"><div class="nc" style="flex:1"><div class="nt">${esc(n.headline||'')}</div><div class="nm"><span>${esc(n.source||'')}</span><span>${t}</span></div></div></div>`;}).join('');}catch{ns.innerHTML='<div class="ne">Failed to load.</div>';}}

// ═══ WATCHLIST — renders in topbar dropdown ═══
async function loadWL(){try{const r=await fetch('/api/watchlist');const wl=await r.json();
  var el=$('wll');if(!el)return;
  if(!wl.length){el.innerHTML='<div class="we" style="padding:12px;font-size:11px">No symbols yet.</div>';return;}
  const syms=wl.map(w=>w.symbol).join(',');const qr=await fetch(`/api/quotes?symbols=${encodeURIComponent(syms)}`);const qs=await qr.json();
  el.innerHTML=wl.map(w=>{const q=qs[w.symbol]||{};const p=q.price||0;const ch=q.change||0;const c=ch>0?'up':ch<0?'dn':'fl';const s=ch>0?'+':'';return`<div class="wi" style="padding:6px 10px;gap:6px;cursor:pointer" onclick="gsOpen('${esc(w.symbol.replace('.JK',''))}')"><span class="ws" style="font-size:11px;min-width:60px">${esc(w.symbol)}</span><span class="wn" style="font-size:9px;flex:1">${esc(q.name||w.name)}</span><span class="wp_r" style="font-size:11px;min-width:55px">${p?p.toLocaleString():'—'}</span><span class="wc ${c}" style="font-size:9px;min-width:48px">${p?s+ch.toFixed(2)+'%':'—'}</span><button class="wx" onclick="event.stopPropagation();delW('${w.id}')" style="font-size:10px">✕</button></div>`;}).join('');
  // Update badge
  var bdg=$('wlbdg');if(bdg){bdg.textContent=wl.length;bdg.style.display=wl.length>0?'flex':'none';}
}catch{}}
async function addW(){const v=$('wli').value.trim();if(!v)return;try{await fetch('/api/watchlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:v})});$('wli').value='';await loadWL();}catch{}}
async function delW(id){try{await fetch(`/api/watchlist/${id}`,{method:'DELETE'});await loadWL();}catch{}}

// ═══ ALERTS — renders in watchlist dropdown ═══
async function loadAl(){try{const r=await fetch('/api/alerts');const al=await r.json();
  var el=$('alst');if(!el)return;
  if(!al.length){el.innerHTML='<div class="we" style="padding:8px 10px;font-size:10px">No alerts.</div>';return;}
  el.innerHTML=al.map(a=>`<div class="ai ${a.triggered?'fd':''}" style="padding:5px 10px;gap:4px"><span class="acd" style="font-size:10px;min-width:80px">${esc(a.symbol)} ${a.condition==='above'?'≥':'≤'} ${a.price.toLocaleString()}</span><span class="ant" style="font-size:9px">${esc(a.note)}</span><span class="ast ${a.triggered?'fi':'ac'}" style="font-size:8px;padding:1px 4px">${a.triggered?'🔔':'●'}</span><button class="ax" onclick="event.stopPropagation();delAl('${a.id}')" style="font-size:9px">✕</button></div>`).join('');}catch{}}
async function addAl(){const s=$('as').value.trim(),c=$('ac').value,p=$('ap').value,n=$('an').value;if(!s||!p)return;try{await fetch('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:s,condition:c,price:p,note:n})});$('as').value='';$('ap').value='';$('an').value='';await loadAl();}catch{}}
async function delAl(id){try{await fetch(`/api/alerts/${id}`,{method:'DELETE'});await loadAl();}catch{}}

// ALERT CHECK
async function chkAl(){try{const r=await fetch('/api/alerts/check');const tr=await r.json();tr.forEach(a=>{showT(`🔔 ${a.symbol}`,`Hit ${a.triggeredPrice?.toLocaleString()} (${a.condition} ${a.price.toLocaleString()})${a.note?' — '+a.note:''}`);});if(tr.length){await loadAl();await loadN();}}catch{}}

// NOTIFICATIONS
async function loadN(){try{const r=await fetch('/api/notifications');const n=await r.json();const ur=n.filter(x=>!x.read).length;$('bdg').textContent=ur;$('bdg').classList.toggle('v',ur>0);
const nl=$('nlist');if(!n.length){nl.innerHTML='<div class="ndrop-e">No notifications</div>';return;}
nl.innerHTML=n.slice(0,20).map(x=>`<div class="nit ${x.read?'':'ur'}"><div class="nit-s">🔔 ${esc(x.symbol||'')}</div><div class="nit-m">${esc(x.message||'')}</div><div class="nit-t">${ft(x.createdAt)}</div></div>`).join('');}catch{}}
function togN(){const d=$('ndrop');d.classList.toggle('o');if(d.classList.contains('o')){loadN();fetch('/api/notifications/read-all',{method:'POST'}).then(()=>setTimeout(()=>$('bdg').classList.remove('v'),1000));}}
async function clrN(){try{await fetch('/api/notifications',{method:'DELETE'});$('nlist').innerHTML='<div class="ndrop-e">No notifications</div>';$('bdg').classList.remove('v');$('ndrop').classList.remove('o');}catch{}}
document.addEventListener('click',e=>{if(!$('bell').contains(e.target)&&!$('ndrop').contains(e.target))$('ndrop').classList.remove('o');});

document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('imo').classList.remove('o');cDel();cEdit();cPop();}});
