const $=id=>document.getElementById(id);
let tag=null,imgs=[],all=[],replyTo=null,delT=null,sq='';
let liked=new Set(JSON.parse(localStorage.getItem('lk')||'[]'));
let eId=null,eTag=null,eKeep=[],eNew=[];

function esc(s){const d=document.createElement('div');d.textContent=s||'';return d.innerHTML;}

// '2026-10-15' -> '15 Okt'. Dipakai penanda kesegaran seri (kanban t_61ccbdbe) di
// panel komoditas & market-regime; satu implementasi supaya dua panel menulis tanggal
// yang sama dengan cara yang sama.
var SHORT_DAY_MONTHS=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
function shortDay(iso){if(!iso||iso.length<10)return iso||'?';var m=parseInt(iso.slice(5,7),10);return parseInt(iso.slice(8,10),10)+' '+(SHORT_DAY_MONTHS[m-1]||'');}

function showT(t,b){$('ttt').textContent=t;$('ttb').textContent=b;$('toast').classList.add('v');setTimeout(()=>$('toast').classList.remove('v'),5000);}

function fmtNum(n){if(!n)return'0';var a=Math.abs(n);var s=n<0?'-':'';if(a>=1e12)return s+(a/1e12).toFixed(1)+'T';if(a>=1e9)return s+(a/1e9).toFixed(1)+'B';if(a>=1e6)return s+(a/1e6).toFixed(1)+'M';if(a>=1e3)return s+(a/1e3).toFixed(1)+'K';return n.toLocaleString();}

function fmtRp(n){if(!n)return'0';var a=Math.abs(n);var s=n<0?'-':'';if(a>=1e12)return s+(a/1e12).toFixed(1)+' T';if(a>=1e9)return s+(a/1e9).toFixed(1)+' B';if(a>=1e6)return s+(a/1e6).toFixed(1)+' M';if(a>=1e3)return s+(a/1e3).toFixed(0)+' K';return n.toLocaleString();}

// Financial statement formatter — Stockbit-style. DB values are in Miliar IDR.
// Shows: "43,439 B" (Miliar), "391 B", "2 B". Negative in parentheses: "(384 B)"
function fmtBM(n){if(n==null||n===0)return'—';var a=Math.abs(n);var s=n<0?'(':'';var e=n<0?')':'';return s+Math.round(a).toLocaleString()+' B'+e;}

// fmtBM with 2 decimal places for per-share values
function fmtBM2(n){if(n==null||n===0)return'—';return (n>=0?'':'-')+(Math.abs(n)).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});}

function skelRows(n){
  var h='';
  for(var i=0;i<n;i++)h+='<div class="skel-row"><div class="skel" style="width:44px"></div><div class="skel" style="flex:2"></div><div class="skel"></div><div class="skel"></div></div>';
  return h;
}