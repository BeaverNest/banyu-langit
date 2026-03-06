// COMPOSE
const ct=$('cta'),pb=$('pbtn');
ct.addEventListener('input',()=>{ct.style.height='auto';ct.style.height=ct.scrollHeight+'px';ck();});
ct.addEventListener('focus',()=>$('phint').classList.add('v'));
ct.addEventListener('blur',()=>setTimeout(()=>$('phint').classList.remove('v'),2000));
function ck(){pb.disabled=!ct.value.trim()&&imgs.length===0;}
function pTag(el){document.querySelectorAll('.cmp .pl').forEach(p=>p.classList.remove('on'));if(tag===el.dataset.t)tag=null;else{el.classList.add('on');tag=el.dataset.t;}}
$('fi').addEventListener('change',e=>{Array.from(e.target.files).forEach(f=>{if(imgs.length>=4)return;const r=new FileReader();r.onload=ev=>{imgs.push({data:ev.target.result,name:f.name});rPr();ck();};r.readAsDataURL(f);});$('fi').value='';});
function rPr(){$('cprev').innerHTML=imgs.map((m,i)=>`<div class="ciw"><img src="${m.data}"><button class="rx" onclick="event.stopPropagation();imgs.splice(${i},1);rPr();ck()">✕</button></div>`).join('');}
document.addEventListener('paste',e=>{const it=e.clipboardData?.items;if(!it)return;for(const i of it){if(i.type.startsWith('image/')&&imgs.length<4){e.preventDefault();const b=i.getAsFile();const r=new FileReader();r.onload=ev=>{imgs.push({data:ev.target.result,name:`paste-${Date.now()}.png`});rPr();ck();};r.readAsDataURL(b);}}});

// SEARCH
let sdb;$('sinp').addEventListener('input',()=>{clearTimeout(sdb);sdb=setTimeout(()=>{sq=$('sinp').value.trim().toLowerCase();$('sclr').classList.toggle('v',sq.length>0);rFeed();},200);});
function clrS(){$('sinp').value='';sq='';$('sclr').classList.remove('v');rFeed();}

// REPLY
function sR(id,ev){if(ev)ev.stopPropagation();replyTo=id;const e=all.find(x=>x.id===id);$('rtxt').textContent=(e?.text||'').substring(0,30)+'…';$('rind').classList.add('v');ct.placeholder='Post your reply…';ct.focus();}
function cxR(){replyTo=null;$('rind').classList.remove('v');ct.placeholder="What's happening with your trades?";}
function tLk(id,ev){if(ev)ev.stopPropagation();if(liked.has(id))liked.delete(id);else liked.add(id);localStorage.setItem('lk',JSON.stringify([...liked]));rFeed();}

// POST
async function post(){const t=ct.value.trim();if(!t&&imgs.length===0)return;pb.disabled=true;pb.textContent='…';const fd=new FormData();fd.append('text',t);fd.append('tag',tag||'NOTE');if(replyTo)fd.append('parentId',replyTo);for(const m of imgs){const r=await fetch(m.data);fd.append('images',await r.blob(),m.name);}try{const res=await fetch('/api/entries',{method:'POST',body:fd});if(res.ok){ct.value='';ct.style.height='auto';tag=null;imgs=[];document.querySelectorAll('.cmp .pl').forEach(p=>p.classList.remove('on'));$('cprev').innerHTML='';cxR();await lEnt();}}catch(e){console.error(e);}pb.disabled=false;pb.textContent='Post';ck();}

// LOAD
async function lEnt(){try{const r=await fetch('/api/entries');all=await r.json();rFeed();}catch{}}
function ft(d){const df=Date.now()-new Date(d);const m=Math.floor(df/60000);if(m<1)return'now';if(m<60)return m+'m';const h=Math.floor(m/60);if(h<24)return h+'h';const dy=Math.floor(h/24);if(dy<7)return dy+'d';return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'});}
function fd(d){return new Date(d).toLocaleDateString('en-US',{weekday:'short',day:'numeric',month:'short',year:'numeric'});}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

function rFeed(){
  const roots=all.filter(e=>!e.parentId);const cm={};all.forEach(e=>{if(e.parentId){if(!cm[e.parentId])cm[e.parentId]=[];cm[e.parentId].push(e);}});
  let vis=roots;if(sq)vis=vis.filter(e=>(e.text||'').toLowerCase().includes(sq)||(cm[e.id]||[]).some(r=>(r.text||'').toLowerCase().includes(sq)));
  if(!vis.length){$('feed').innerHTML=`<div class="empty"><div class="empty-i">${sq?'🔍':'📊'}</div><h3>${sq?'No results':'No entries yet'}</h3><p>${sq?'Try different keywords.':'Start documenting your trades.'}</p></div>`;return;}
  $('feed').innerHTML=vis.map((e,i)=>{const rp=cm[e.id]||[];return`<div class="ent" onclick="oPop('${e.id}')"><div class="eL"><div class="eav">🧑‍💻</div>${rp.length||i<vis.length-1?'<div class="tc"></div>':''}</div><div class="eR">${rH(e)}${e.text?`<div class="etx">${esc(e.text)}</div>`:''}${rIm(e.images)}${rAc(e.id,rp.length)}${rp.length?rRp(rp,cm):''}</div></div>`;}).join('');
}
function rH(e){return`<div class="eh"><span class="en">Trader</span><span class="eha">@diary</span><span class="edot">·</span><span class="etm">${ft(e.createdAt)}</span><span class="edt">${fd(e.createdAt)}</span><span class="etg ${e.tag}">${e.tag}</span></div>`;}
function rIm(im){if(!im?.length)return'';return`<div class="eim g${Math.min(im.length,4)}">${im.map(s=>`<img src="${s}" onclick="event.stopPropagation();$('imoi').src='${s}';$('imo').classList.add('o')">`).join('')}</div>`;}
function rAc(id,rc){return`<div class="ea"><button class="ab rp" onclick="event.stopPropagation();sR('${id}')">💬${rc?' '+rc:''}</button><button class="ab ed" onclick="event.stopPropagation();oEdit('${id}')">✏️</button><button class="ab lk ${liked.has(id)?'ld':''}" onclick="event.stopPropagation();tLk('${id}')">${liked.has(id)?'❤️':'🤍'}</button><button class="ab dl" onclick="event.stopPropagation();aDel('${id}')">🗑</button></div>`;}
function rRp(rp,cm){rp.sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));return`<div class="rpc">${rp.map(r=>{const sub=cm[r.id]||[];return`<div class="rpe"><div class="rpav">💬</div><div class="rpr">${rH(r)}${r.text?`<div class="etx">${esc(r.text)}</div>`:''}${rIm(r.images)}${rAc(r.id,sub.length)}${sub.length?rRp(sub,cm):''}</div></div>`;}).join('')}</div>`;}

// ═══ ENTRY POPUP ═══
function oPop(id){
  const e=all.find(x=>x.id===id);if(!e)return;
  const cm={};all.forEach(x=>{if(x.parentId){if(!cm[x.parentId])cm[x.parentId]=[];cm[x.parentId].push(x);}});

  function popReplies(pid,depth){
    const rp=cm[pid]||[];if(!rp.length)return'';
    rp.sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
    const ml=Math.min(depth*16,48);
    return rp.map(r=>{
      const rimgs=r.images?.length?`<div class="eim g${Math.min(r.images.length,2)}" style="margin:6px 0">${r.images.map(s=>`<img src="${s}" style="border-radius:8px;max-height:200px" onclick="$('imoi').src='${s}';$('imo').classList.add('o')">`).join('')}</div>`:'';
      const sub=popReplies(r.id,depth+1);
      return`<div class="epop-reply" style="margin-left:${ml}px">
        <div class="rpav">💬</div>
        <div class="epop-reply-body">
          <div class="eh"><span class="en">Trader</span><span class="eha">@diary</span><span class="edot">·</span><span class="etm">${ft(r.createdAt)}</span><span class="edt">${fd(r.createdAt)}</span><span class="etg ${r.tag}">${r.tag}</span></div>
          ${r.text?`<div class="etx" style="font-size:14px;margin:4px 0">${esc(r.text)}</div>`:''}
          ${rimgs}
          <div class="epop-reply-actions">
            <button class="ab rp" onclick="cPop();sR('${r.id}')">💬 Reply</button>
            <button class="ab ed" onclick="cPop();oEdit('${r.id}')">✏️</button>
            <button class="ab lk ${liked.has(r.id)?'ld':''}" onclick="tLk('${r.id}');oPop('${id}')">${liked.has(r.id)?'❤️':'🤍'}</button>
            <button class="ab dl" onclick="cPop();aDel('${r.id}')">🗑</button>
          </div>
        </div>
      </div>${sub}`;
    }).join('');
  }

  const allRepliesCount=(function countR(pid){const rp=cm[pid]||[];return rp.length+rp.reduce((s,r)=>s+countR(r.id),0);})(e.id);
  const imgHtml=e.images?.length?`<div class="epop-imgs g${Math.min(e.images.length,2)}">${e.images.map(s=>`<img src="${s}" onclick="$('imoi').src='${s}';$('imo').classList.add('o')">`).join('')}</div>`:'';
  const rpHtml=allRepliesCount?`<div class="epop-replies"><h4>💬 ${allRepliesCount} Replies</h4>${popReplies(e.id,0)}</div>`:'';

  $('epop-box').innerHTML=`
    <div class="epop-head"><div class="eav" style="width:44px;height:44px;font-size:18px">🧑‍💻</div><div class="epop-meta"><div class="en" style="font-size:15px">Trader <span class="eha">@diary</span></div><div><span class="edt" style="font-size:12px">${fd(e.createdAt)} · ${new Date(e.createdAt).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</span><span class="etg ${e.tag}" style="margin-left:8px">${e.tag}</span></div></div><button class="epop-close" onclick="cPop()">✕</button></div>
    <div class="epop-body"><div class="epop-text">${esc(e.text||'')}</div>${imgHtml}</div>
    <div class="epop-actions"><button class="ab rp" onclick="cPop();sR('${e.id}')">💬 Reply</button><button class="ab ed" onclick="cPop();oEdit('${e.id}')">✏️ Edit</button><button class="ab lk ${liked.has(e.id)?'ld':''}" onclick="tLk('${e.id}');oPop('${e.id}')">${liked.has(e.id)?'❤️':'🤍'} Like</button><button class="ab dl" onclick="cPop();aDel('${e.id}')">🗑 Delete</button></div>
    ${rpHtml}`;
  $('epop').classList.add('o');
}
function cPop(){$('epop').classList.remove('o');}

// EDIT
function oEdit(id){const e=all.find(x=>x.id===id);if(!e)return;eId=id;eTag=e.tag;eKeep=[...(e.images||[])];eNew=[];$('etx').value=e.text||'';rET();rEI();$('eov').classList.add('o');}
function cEdit(){eId=null;$('eov').classList.remove('o');}
function rET(){$('etr').innerHTML=['WIN','LOSS','NOTE'].map(t=>`<button class="pl ${eTag===t?'on':''}" data-t="${t}" onclick="eTag='${t}';rET()">${t==='WIN'?'▲ Win':t==='LOSS'?'▼ Loss':'◆ Note'}</button>`).join('');}
function rEI(){$('eis').innerHTML=eKeep.map((s,i)=>`<div class="eiw"><img src="${s}"><button class="re" onclick="eKeep.splice(${i},1);rEI()">✕</button></div>`).join('')+eNew.map((m,i)=>`<div class="eiw"><img src="${m.data}"><button class="re" onclick="eNew.splice(${i},1);rEI()">✕</button></div>`).join('');}
$('efi').addEventListener('change',e=>{Array.from(e.target.files).forEach(f=>{if(eKeep.length+eNew.length>=4)return;const r=new FileReader();r.onload=ev=>{eNew.push({data:ev.target.result,name:f.name});rEI();};r.readAsDataURL(f);});$('efi').value='';});
async function sEdit(){if(!eId)return;const fd=new FormData();fd.append('text',$('etx').value);fd.append('tag',eTag);fd.append('keepImages',JSON.stringify(eKeep));for(const m of eNew){const r=await fetch(m.data);fd.append('images',await r.blob(),m.name);}try{await fetch(`/api/entries/${eId}`,{method:'PUT',body:fd});cEdit();await lEnt();}catch{}}

// DELETE
function aDel(id){delT=id;$('ddlg').classList.add('o');}
function cDel(){delT=null;$('ddlg').classList.remove('o');}
async function eDel(){if(!delT)return;try{await fetch(`/api/entries/${delT}`,{method:'DELETE'});await lEnt();}catch{}cDel();}

