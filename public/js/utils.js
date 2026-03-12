const $=id=>document.getElementById(id);
let tag=null,imgs=[],all=[],replyTo=null,delT=null,sq='';
let liked=new Set(JSON.parse(localStorage.getItem('lk')||'[]'));
let eId=null,eTag=null,eKeep=[],eNew=[];

function esc(s){const d=document.createElement('div');d.textContent=s||'';return d.innerHTML;}

function showT(t,b){$('ttt').textContent=t;$('ttb').textContent=b;$('toast').classList.add('v');setTimeout(()=>$('toast').classList.remove('v'),5000);}

function fmtNum(n){if(!n)return'0';var a=Math.abs(n);var s=n<0?'-':'';if(a>=1e12)return s+(a/1e12).toFixed(1)+'T';if(a>=1e9)return s+(a/1e9).toFixed(1)+'B';if(a>=1e6)return s+(a/1e6).toFixed(1)+'M';if(a>=1e3)return s+(a/1e3).toFixed(1)+'K';return n.toLocaleString();}

function fmtRp(n){if(!n)return'0';var a=Math.abs(n);var s=n<0?'-':'';if(a>=1e12)return s+(a/1e12).toFixed(1)+' T';if(a>=1e9)return s+(a/1e9).toFixed(1)+' B';if(a>=1e6)return s+(a/1e6).toFixed(1)+' M';if(a>=1e3)return s+(a/1e3).toFixed(0)+' K';return n.toLocaleString();}

function skelRows(n){
  var h='';
  for(var i=0;i<n;i++)h+='<div class="skel-row"><div class="skel" style="width:44px"></div><div class="skel" style="flex:2"></div><div class="skel"></div><div class="skel"></div></div>';
  return h;
}
