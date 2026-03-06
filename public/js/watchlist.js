// ═══ NEWS ═══
function sNews(){const v=$('nsi').value.trim().toUpperCase();lNews(v);$('nsi').value='';}
async function lNews(s){const ns=$('nsl');ns.innerHTML='<div class="ne">Loading...</div>';try{const u=s?`/api/news?symbol=${encodeURIComponent(s)}`:'/api/news';const r=await fetch(u);const items=await r.json();if(!items.length){ns.innerHTML=`<div class="ne">No news${s?' for '+esc(s):''}.</div>`;return;}
ns.innerHTML=items.map(n=>{const t=n.datetime?new Date(n.datetime*1000).toLocaleDateString('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';return`<div class="ni" onclick="window.open('${n.url}','_blank')"><div class="nc" style="flex:1"><div class="nt">${esc(n.headline||'')}</div><div class="nm"><span>${esc(n.source||'')}</span><span>${t}</span></div></div></div>`;}).join('');}catch{ns.innerHTML='<div class="ne">Failed to load.</div>';}}

// ═══ WATCHLIST ═══
async function loadWL(){try{const r=await fetch('/api/watchlist');const wl=await r.json();if(!wl.length){$('wll').innerHTML='<div class="we">No symbols yet.</div>';return;}
const syms=wl.map(w=>w.symbol).join(',');const qr=await fetch(`/api/quotes?symbols=${encodeURIComponent(syms)}`);const qs=await qr.json();
$('wll').innerHTML=wl.map(w=>{const q=qs[w.symbol]||{};const p=q.price||0;const ch=q.change||0;const c=ch>0?'up':ch<0?'dn':'fl';const s=ch>0?'+':'';return`<div class="wi"><span class="ws">${esc(w.symbol)}</span><span class="wn">${esc(q.name||w.name)}</span><span class="wp_r">${p?p.toLocaleString():'—'}</span><span class="wc ${c}">${p?s+ch.toFixed(2)+'%':'—'}</span><button class="wx" onclick="delW('${w.id}')">✕</button></div>`;}).join('');}catch{}}
async function addW(){const v=$('wli').value.trim();if(!v)return;try{await fetch('/api/watchlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol:v})});$('wli').value='';await loadWL();}catch{}}
async function delW(id){try{await fetch(`/api/watchlist/${id}`,{method:'DELETE'});await loadWL();}catch{}}

// ═══ ALERTS ═══
async function loadAl(){try{const r=await fetch('/api/alerts');const al=await r.json();if(!al.length){$('alst').innerHTML='<div class="we">No alerts.</div>';return;}
$('alst').innerHTML=al.map(a=>`<div class="ai ${a.triggered?'fd':''}"><span class="acd">${esc(a.symbol)} ${a.condition==='above'?'≥':'≤'} ${a.price.toLocaleString()}</span><span class="ant">${esc(a.note)}</span><span class="ast ${a.triggered?'fi':'ac'}">${a.triggered?'🔔 FIRED':'Active'}</span><button class="ax" onclick="delAl('${a.id}')">✕</button></div>`).join('');}catch{}}
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

function showT(t,b){$('ttt').textContent=t;$('ttb').textContent=b;$('toast').classList.add('v');setTimeout(()=>$('toast').classList.remove('v'),6000);}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('imo').classList.remove('o');cDel();cEdit();cPop();}});

