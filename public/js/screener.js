// ═══ AFL FORMULA SCREENER V2 ═══

var AFL_TEMPLATES = [
  { name: 'Ketat Uptrend', formula: 'C > MA200 AND C > MA50 AND C > MA20 AND MA20 > MA50 AND MA50 > MA200 AND V > 100000' },
  { name: 'Persiapan Bullish', formula: 'C > MA200 AND C > MA50 AND C < MA20 AND DistMA20 > -5 AND V > 50000' },
  { name: 'Big Down Reversal', formula: 'C < MA200 AND C > MA20 AND Chg > 3 AND RelVol > 2 AND Freq > 100' },
  { name: 'Breakout', formula: 'isBreakout AND C > MA50 AND RelVol > 1.5 AND Val > 1000000000' },
  { name: 'Base Formation', formula: 'isBase AND C > MA200 AND K < 30 AND Val > 500000000' },
  { name: 'Short Trend + Foreign', formula: 'ShortTrend AND ForeignNet > 0 AND Foreign_5D > 0 AND Val > 1000000000' },
  { name: 'Long Uptrend', formula: 'LongTrend AND MACD > Signal AND Val > 500000000' },
  { name: 'Oversold Stoch', formula: 'K < 20 AND D < 20 AND C > MA200 AND Val > 500000000' },
  { name: 'MACD Golden Cross', formula: 'MACDCross AND C > MA50 AND Val > 1000000000' },
  { name: 'Foreign 5D Inflow', formula: 'Foreign_5D > 0 AND F0 > 0 AND F1 > 0 AND C > MA20 AND Val > 1000000000' },
];

var AFL_VARIABLES = {
  'Price': [{v:'C',d:'Close'},{v:'O',d:'Open'},{v:'H',d:'High'},{v:'L',d:'Low'},{v:'Chg',d:'(%)'}],
  'MA': [{v:'MA3'},{v:'MA5'},{v:'MA10'},{v:'MA20'},{v:'MA30'},{v:'MA50'},{v:'MA100'},{v:'MA200'}],
  'Distance %': [{v:'DistMA3'},{v:'DistMA5'},{v:'DistMA10'},{v:'DistMA20'},{v:'DistMA30'},{v:'DistMA50'},{v:'DistMA100'},{v:'DistMA200'}],
  'Above MA (0/1)': [{v:'Up_MA5'},{v:'Up_MA10'},{v:'Up_MA20'},{v:'Up_MA50'},{v:'Up_MA100'},{v:'Up_MA200'}],
  'Trend (0/1)': [{v:'ShortTrend'},{v:'Intermediate'},{v:'LongTrend'}],
  'Pattern (0/1)': [{v:'isBase'},{v:'isNearLow'},{v:'isBreakout'}],
  'HHV/LLV': [{v:'HHV20'},{v:'LLV20'},{v:'HHV_C20'},{v:'LLV_C20'},{v:'PrevHHV20'}],
  'MACD': [{v:'MACD'},{v:'Signal'},{v:'MACD_Hist'},{v:'MACD_Status',d:'(-2~2)'}],
  'MACD Bool (0/1)': [{v:'Bullish_MACD'},{v:'BullishWeak_MACD'},{v:'Bearish_MACD'},{v:'BearishWeak_MACD'},{v:'MACDCross'},{v:'MACDDeathCross'}],
  'Stoch': [{v:'K',d:'StochK'},{v:'D',d:'StochD'},{v:'StochCrossUp',d:'(0/1)'},{v:'StochTrend',d:'(0/1)'}],
  'Volume': [{v:'V',d:'Volume'},{v:'Val',d:'Value'},{v:'Freq'},{v:'DVMil'},{v:'RelVol',d:'(x avg)'}],
  'Foreign': [{v:'ForeignNet'},{v:'ForeignBuy'},{v:'ForeignSell'},{v:'Foreign_5D'},{v:'F0',d:'(today)'},{v:'F1'},{v:'F2'},{v:'F3'},{v:'F4'}],
  'Fundamental': [{v:'PER'},{v:'PBV'},{v:'ROE'},{v:'ROA'}]
};

// ═══ HELPERS ═══
function _t(d,k){return d.tech?d.tech[k]:null;}
function _f(d,k){return d.fund?d.fund[k]:null;}
function _x(d,k){return d.extra?d.extra[k]:null;}
function _pct(v){if(v==null)return'—';return '<span class="'+(v>0?'up':v<0?'dn':'')+'">'+v.toFixed(1)+'%</span>';}
function _num(v){if(v==null||v===0)return'—';return typeof v==='number'?v.toLocaleString():v;}
function _bool(v){return v?'<span class="up">✓</span>':'<span style="color:var(--t3)">·</span>';}
function _dist(d,k){var t=d.tech;if(!t||!t[k]||!d.close)return null;return Math.round((d.close-t[k])/t[k]*10000)/100;}
function _trend(v){if(v>0)return'<span class="up" style="font-size:9px">▲ Up</span>';if(v<0)return'<span class="dn" style="font-size:9px">▼ Down</span>';return'<span style="color:var(--t3);font-size:9px">— Flat</span>';}
function _cross(type){if(type==='golden')return'<span class="up" style="font-size:9px;font-weight:600">★ Golden</span>';if(type==='death')return'<span class="dn" style="font-size:9px;font-weight:600">✕ Death</span>';return'<span style="color:var(--t3)">—</span>';}
function _fval(d,key){var v=_x(d,key);if(v==null||v===0)return'<span style="color:var(--t3)">0</span>';return '<span class="'+(v>0?'up':v<0?'dn':'')+'">'+fmtRp(v)+'</span>';}

// ═══ COLUMN GROUPS — for organized toggle panel ═══
var scrColGroups = [
  {name:'Base',keys:['code','name','close','open','high','low','chg']},
  {name:'Volume',keys:['volume','value','freq','dvmil','relvol']},
  {name:'MA',keys:['ma3','ma5','ma10','ma20','ma30','ma50','ma100','ma200']},
  {name:'Dist%',keys:['distma3','distma5','distma10','distma20','distma30','distma50','distma100','distma200']},
  {name:'Above',keys:['up_ma5','up_ma10','up_ma20','up_ma50','up_ma100','up_ma200']},
  {name:'Trend',keys:['shorttrend','intermediate','longtrend','isbreakout','isbase','isnearlow']},
  {name:'HHV/LLV',keys:['hhv20','llv20']},
  {name:'MACD',keys:['macd','signal','macd_hist','macd_trend','macd_cross']},
  {name:'Stoch',keys:['k','d_stoch','stoch_trend','stoch_cross']},
  {name:'Foreign',keys:['fnet','fbuy','fsell','f5d','f0','f1','f2','f3','f4']},
  {name:'Funda',keys:['per','pbv','roe','roa','sector','industry']},
];

// ═══ ALL COLUMNS ═══
var scrAllCols = {
  code:{label:'Code',align:'al',fmt:function(d){return '<span class="code" onclick="gsOpen(\''+esc(d.code)+'\')">'+esc(d.code)+'</span>';}},
  name:{label:'Name',align:'al',cls:'name',fmt:function(d){return esc(d.name||'');}},
  close:{label:'Close',align:'ar',mono:1,bold:1,sort:function(d){return d.close||0;},fmt:function(d){return(d.close||0).toLocaleString();}},
  open:{label:'Open',align:'ar',mono:1,sort:function(d){return d.open_price||0;},fmt:function(d){return _num(d.open_price);}},
  high:{label:'High',align:'ar',mono:1,sort:function(d){return d.high||0;},fmt:function(d){return _num(d.high);}},
  low:{label:'Low',align:'ar',mono:1,sort:function(d){return d.low||0;},fmt:function(d){return _num(d.low);}},
  chg:{label:'Chg%',align:'ar',mono:1,bold:1,sort:function(d){return d.change_pct||0;},fmt:function(d){var v=d.change_pct||0;return '<span class="'+(v>0?'up':v<0?'dn':'')+'">'+(v>0?'+':'')+v.toFixed(2)+'%</span>';}},
  volume:{label:'Volume',align:'ar',mono:1,sort:function(d){return d.volume||0;},fmt:function(d){return fmtNum(d.volume);}},
  value:{label:'Value',align:'ar',mono:1,sort:function(d){return d.value||0;},fmt:function(d){return fmtRp(d.value);}},
  freq:{label:'Freq',align:'ar',mono:1,sort:function(d){return d.frequency||0;},fmt:function(d){return(d.frequency||0).toLocaleString();}},
  dvmil:{label:'DVMil',align:'ar',mono:1,sort:function(d){return(d.value||0)/1e6;},fmt:function(d){return d.value?Math.round(d.value/1e6).toLocaleString():'—';}},
  relvol:{label:'RelVol',align:'ar',mono:1,sort:function(d){return _x(d,'RelVol')||0;},fmt:function(d){var v=_x(d,'RelVol');return v?v.toFixed(1)+'x':'—';}},
  // MA
  ma3:{label:'MA3',align:'ar',mono:1,sort:function(d){return _t(d,'ma3')||0;},fmt:function(d){return _num(_t(d,'ma3'));}},
  ma5:{label:'MA5',align:'ar',mono:1,sort:function(d){return _t(d,'ma5')||0;},fmt:function(d){return _num(_t(d,'ma5'));}},
  ma10:{label:'MA10',align:'ar',mono:1,sort:function(d){return _t(d,'ma10')||0;},fmt:function(d){return _num(_t(d,'ma10'));}},
  ma20:{label:'MA20',align:'ar',mono:1,sort:function(d){return _t(d,'ma20')||0;},fmt:function(d){return _num(_t(d,'ma20'));}},
  ma30:{label:'MA30',align:'ar',mono:1,sort:function(d){return _t(d,'ma30')||0;},fmt:function(d){return _num(_t(d,'ma30'));}},
  ma50:{label:'MA50',align:'ar',mono:1,sort:function(d){return _t(d,'ma50')||0;},fmt:function(d){return _num(_t(d,'ma50'));}},
  ma100:{label:'MA100',align:'ar',mono:1,sort:function(d){return _t(d,'ma100')||0;},fmt:function(d){return _num(_t(d,'ma100'));}},
  ma200:{label:'MA200',align:'ar',mono:1,sort:function(d){return _t(d,'ma200')||0;},fmt:function(d){return _num(_t(d,'ma200'));}},
  // Dist%
  distma3:{label:'D.3%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma3')||0;},fmt:function(d){return _pct(_dist(d,'ma3'));}},
  distma5:{label:'D.5%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma5')||0;},fmt:function(d){return _pct(_dist(d,'ma5'));}},
  distma10:{label:'D.10%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma10')||0;},fmt:function(d){return _pct(_dist(d,'ma10'));}},
  distma20:{label:'D.20%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma20')||0;},fmt:function(d){return _pct(_dist(d,'ma20'));}},
  distma30:{label:'D.30%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma30')||0;},fmt:function(d){return _pct(_dist(d,'ma30'));}},
  distma50:{label:'D.50%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma50')||0;},fmt:function(d){return _pct(_dist(d,'ma50'));}},
  distma100:{label:'D.100%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma100')||0;},fmt:function(d){return _pct(_dist(d,'ma100'));}},
  distma200:{label:'D.200%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma200')||0;},fmt:function(d){return _pct(_dist(d,'ma200'));}},
  // Above MA
  up_ma5:{label:'↑5',align:'ar',sort:function(d){var c=d.close,m=_t(d,'ma5');return(c&&m&&c>m)?1:0;},fmt:function(d){var c=d.close,m=_t(d,'ma5');return(c&&m)?_bool(c>m):'—';}},
  up_ma10:{label:'↑10',align:'ar',sort:function(d){var c=d.close,m=_t(d,'ma10');return(c&&m&&c>m)?1:0;},fmt:function(d){var c=d.close,m=_t(d,'ma10');return(c&&m)?_bool(c>m):'—';}},
  up_ma20:{label:'↑20',align:'ar',sort:function(d){var c=d.close,m=_t(d,'ma20');return(c&&m&&c>m)?1:0;},fmt:function(d){var c=d.close,m=_t(d,'ma20');return(c&&m)?_bool(c>m):'—';}},
  up_ma50:{label:'↑50',align:'ar',sort:function(d){var c=d.close,m=_t(d,'ma50');return(c&&m&&c>m)?1:0;},fmt:function(d){var c=d.close,m=_t(d,'ma50');return(c&&m)?_bool(c>m):'—';}},
  up_ma100:{label:'↑100',align:'ar',sort:function(d){var c=d.close,m=_t(d,'ma100');return(c&&m&&c>m)?1:0;},fmt:function(d){var c=d.close,m=_t(d,'ma100');return(c&&m)?_bool(c>m):'—';}},
  up_ma200:{label:'↑200',align:'ar',sort:function(d){var c=d.close,m=_t(d,'ma200');return(c&&m&&c>m)?1:0;},fmt:function(d){var c=d.close,m=_t(d,'ma200');return(c&&m)?_bool(c>m):'—';}},
  // Trend/Pattern
  shorttrend:{label:'ShortTr',align:'ar',sort:function(d){return _x(d,'ShortTrend')||0;},fmt:function(d){return _bool(_x(d,'ShortTrend'));}},
  intermediate:{label:'IntTr',align:'ar',sort:function(d){return _x(d,'Intermediate')||0;},fmt:function(d){return _bool(_x(d,'Intermediate'));}},
  longtrend:{label:'LongTr',align:'ar',sort:function(d){return _x(d,'LongTrend')||0;},fmt:function(d){return _bool(_x(d,'LongTrend'));}},
  isbreakout:{label:'Brkout',align:'ar',sort:function(d){return _x(d,'isBreakout')||0;},fmt:function(d){return _bool(_x(d,'isBreakout'));}},
  isbase:{label:'Base',align:'ar',sort:function(d){return _x(d,'isBase')||0;},fmt:function(d){return _bool(_x(d,'isBase'));}},
  isnearlow:{label:'NrLow',align:'ar',sort:function(d){return _x(d,'isNearLow')||0;},fmt:function(d){return _bool(_x(d,'isNearLow'));}},
  // HHV/LLV
  hhv20:{label:'HHV20',align:'ar',mono:1,sort:function(d){return _x(d,'HHV20')||0;},fmt:function(d){return _num(_x(d,'HHV20'));}},
  llv20:{label:'LLV20',align:'ar',mono:1,sort:function(d){return _x(d,'LLV20')||0;},fmt:function(d){return _num(_x(d,'LLV20'));}},
  // MACD
  macd:{label:'MACD',align:'ar',mono:1,sort:function(d){var m=_t(d,'macd');return m?m.macd:0;},fmt:function(d){var m=_t(d,'macd');if(!m)return'—';var v=m.macd;return '<span class="'+(v>0?'up':v<0?'dn':'')+'">'+v.toFixed(1)+'</span>';}},
  signal:{label:'Signal',align:'ar',mono:1,sort:function(d){var m=_t(d,'macd');return m?m.signal:0;},fmt:function(d){var m=_t(d,'macd');return m?m.signal.toFixed(1):'—';}},
  macd_hist:{label:'MACD_H',align:'ar',mono:1,sort:function(d){var m=_t(d,'macd');return m?m.histogram:0;},fmt:function(d){var m=_t(d,'macd');if(!m)return'—';var v=m.histogram;return '<span class="'+(v>0?'up':v<0?'dn':'')+'">'+v.toFixed(1)+'</span>';}},
  macd_trend:{label:'MACD Tr',align:'ar',sort:function(d){return _x(d,'MACD_Status')||0;},fmt:function(d){var v=_x(d,'MACD_Status');return _trend(v);}},
  macd_cross:{label:'MACD×',align:'ar',sort:function(d){return _x(d,'MACDCross')?1:_x(d,'MACDDeathCross')?-1:0;},fmt:function(d){if(_x(d,'MACDCross'))return _cross('golden');if(_x(d,'MACDDeathCross'))return _cross('death');return '<span style="color:var(--t3)">—</span>';}},
  // Stoch
  k:{label:'K',align:'ar',mono:1,sort:function(d){var s=_t(d,'stoch');return s?s.k:0;},fmt:function(d){var s=_t(d,'stoch');if(!s)return'—';var v=s.k;var c=v>80?'dn':v<20?'up':'';return '<span class="'+c+'">'+v.toFixed(1)+'</span>';}},
  d_stoch:{label:'D',align:'ar',mono:1,sort:function(d){var s=_t(d,'stoch');return s?(s.d||0):0;},fmt:function(d){var s=_t(d,'stoch');return s&&s.d?s.d.toFixed(1):'—';}},
  stoch_trend:{label:'Stoch Tr',align:'ar',sort:function(d){return _x(d,'StochTrend')||0;},fmt:function(d){var v=_x(d,'StochTrend');return v?'<span class="up" style="font-size:9px">▲ Up</span>':'<span class="dn" style="font-size:9px">▼ Down</span>';}},
  stoch_cross:{label:'Stoch×',align:'ar',sort:function(d){return _x(d,'StochCrossUp')||0;},fmt:function(d){return _x(d,'StochCrossUp')?_cross('golden'):'<span style="color:var(--t3)">—</span>';}},
  // Foreign
  fnet:{label:'FNet',align:'ar',mono:1,bold:1,sort:function(d){return d.foreign_net_val||0;},fmt:function(d){var v=d.foreign_net_val||0;return '<span class="'+(v>0?'up':v<0?'dn':'')+'">'+fmtRp(v)+'</span>';}},
  fbuy:{label:'F.Buy',align:'ar',mono:1,sort:function(d){return(d.foreign_buy||0)*d.close;},fmt:function(d){return fmtRp((d.foreign_buy||0)*d.close);}},
  fsell:{label:'F.Sell',align:'ar',mono:1,sort:function(d){return(d.foreign_sell||0)*d.close;},fmt:function(d){return fmtRp((d.foreign_sell||0)*d.close);}},
  f5d:{label:'F.5D',align:'ar',mono:1,sort:function(d){return _x(d,'Foreign_5D')||0;},fmt:function(d){return _fval(d,'Foreign_5D');}},
  f0:{label:'F0',align:'ar',mono:1,sort:function(d){return _x(d,'F0')||0;},fmt:function(d){return _fval(d,'F0');}},
  f1:{label:'F1',align:'ar',mono:1,sort:function(d){return _x(d,'F1')||0;},fmt:function(d){return _fval(d,'F1');}},
  f2:{label:'F2',align:'ar',mono:1,sort:function(d){return _x(d,'F2')||0;},fmt:function(d){return _fval(d,'F2');}},
  f3:{label:'F3',align:'ar',mono:1,sort:function(d){return _x(d,'F3')||0;},fmt:function(d){return _fval(d,'F3');}},
  f4:{label:'F4',align:'ar',mono:1,sort:function(d){return _x(d,'F4')||0;},fmt:function(d){return _fval(d,'F4');}},
  // Fundamental
  per:{label:'PER',align:'ar',mono:1,sort:function(d){return _f(d,'per')||0;},fmt:function(d){var v=_f(d,'per');return v?v.toFixed(1):'—';}},
  pbv:{label:'PBV',align:'ar',mono:1,sort:function(d){return _f(d,'pbv')||0;},fmt:function(d){var v=_f(d,'pbv');return v?v.toFixed(1):'—';}},
  roe:{label:'ROE',align:'ar',mono:1,sort:function(d){return _f(d,'roe')||0;},fmt:function(d){var v=_f(d,'roe');return v?v.toFixed(1)+'%':'—';}},
  roa:{label:'ROA',align:'ar',mono:1,sort:function(d){return _f(d,'roa')||0;},fmt:function(d){var v=_f(d,'roa');return v?v.toFixed(1)+'%':'—';}},
  sector:{label:'Sector',align:'al',sort:function(d){return _f(d,'sector')||'';},fmt:function(d){var v=_f(d,'sector');return v?'<span style="font-size:9px">'+esc(v)+'</span>':'—';}},
  industry:{label:'Industry',align:'al',sort:function(d){return _f(d,'industry')||'';},fmt:function(d){var v=_f(d,'industry');return v?'<span style="font-size:9px">'+esc(v)+'</span>':'—';}},
};

// ═══ State ═══
var scrDefaultColOrder=Object.keys(scrAllCols);
var scrDefaultColVis={};(function(){for(var k in scrAllCols)scrDefaultColVis[k]=false;})();
['code','name','close','chg','volume','value','freq','fnet','ma20','ma50','ma200','k','macd_hist','per','pbv'].forEach(function(k){scrDefaultColVis[k]=true;});

var scrColOrder=scrDefaultColOrder.slice(),scrColVis=Object.assign({},scrDefaultColVis);
try{var _sc=JSON.parse(localStorage.getItem('scrCols4'));if(_sc){scrColVis=_sc.vis;scrColOrder=_sc.ord;}}catch(e){}
function saveScrCols(){localStorage.setItem('scrCols4',JSON.stringify({vis:scrColVis,ord:scrColOrder}));}

var scrFormulaText=localStorage.getItem('afl_formula')||'';
var scrSavedConfigs=[],scrResults=[],scrRefOpen=false,scrColToggleOpen=false;
var scrSortKey='fnet',scrSortDir='desc',scrDragCol=null;
var scrEditorOpen=true;

// Var → col mapping
var scrVarToCol={
  C:'close',Close:'close',O:'open',Open:'open',H:'high',High:'high',L:'low',Low:'low',Chg:'chg',
  V:'volume',Volume:'volume',Val:'value',Value:'value',Freq:'freq',DVMil:'dvmil',RelVol:'relvol',
  MA3:'ma3',MA5:'ma5',MA10:'ma10',MA20:'ma20',MA30:'ma30',MA50:'ma50',MA100:'ma100',MA200:'ma200',
  DistMA3:'distma3',DistMA5:'distma5',DistMA10:'distma10',DistMA20:'distma20',DistMA30:'distma30',DistMA50:'distma50',DistMA100:'distma100',DistMA200:'distma200',
  Up_MA5:'up_ma5',Up_MA10:'up_ma10',Up_MA20:'up_ma20',Up_MA50:'up_ma50',Up_MA100:'up_ma100',Up_MA200:'up_ma200',
  ShortTrend:'shorttrend',Intermediate:'intermediate',LongTrend:'longtrend',
  isBase:'isbase',isNearLow:'isnearlow',isBreakout:'isbreakout',
  HHV20:'hhv20',LLV20:'llv20',HHV_C20:'hhv20',LLV_C20:'llv20',PrevHHV20:'hhv20',
  MACD:'macd',Signal:'signal',MACD_Hist:'macd_hist',MACD_Status:'macd_trend',
  Bullish_MACD:'macd_trend',BullishWeak_MACD:'macd_trend',Bearish_MACD:'macd_trend',BearishWeak_MACD:'macd_trend',
  MACDCross:'macd_cross',MACDDeathCross:'macd_cross',
  K:'k',D:'d_stoch',StochK:'k',StochD:'d_stoch',StochCrossUp:'stoch_cross',StochTrend:'stoch_trend',
  ForeignNet:'fnet',ForeignBuy:'fbuy',ForeignSell:'fsell',Foreign_5D:'f5d',F0:'f0',F1:'f1',F2:'f2',F3:'f3',F4:'f4',
  PER:'per',PBV:'pbv',ROE:'roe',ROA:'roa'
};

function scrAutoColumns(formula){
  var base={code:1,name:1,close:1,chg:1,fnet:1};var extra={};
  formula.replace(/[()]/g,' ').split(/[\s]+/).forEach(function(w){w=w.trim();if(scrVarToCol[w])extra[scrVarToCol[w]]=1;});
  for(var k in scrColVis)scrColVis[k]=!!(base[k]||extra[k]);
  saveScrCols();var p=$('scr-col-toggle');if(p&&scrColToggleOpen)p.innerHTML=scrRenderColPanel();
}

// ═══ LOAD ═══
async function loadScreener(){
  var el=$('scr-content');if(!el)return;
  try{var r=await fetch('/api/screener/configs');scrSavedConfigs=await r.json();}catch(e){scrSavedConfigs=[];}
  renderScreenerUI();
}

// ═══ UI ═══
function scrToggleEditor(){
  scrEditorOpen=!scrEditorOpen;
  var ed=$('scr-editor');if(ed)ed.style.display=scrEditorOpen?'flex':'none';
  var sum=$('scr-summary');if(sum)sum.style.display=scrEditorOpen?'none':'flex';
  var arrow=$('scr-tog-arrow');if(arrow)arrow.textContent=scrEditorOpen?'▲ Hide':'▼ Show';
}

function renderScreenerUI(){
  var el=$('scr-content');if(!el)return;
  var h='<div style="padding:0;display:flex;flex-direction:column;height:100%;overflow:hidden">';

  // Compact summary bar (visible when editor hidden)
  var shortFormula=scrFormulaText.length>80?scrFormulaText.substring(0,77)+'…':scrFormulaText;
  h+='<div id="scr-summary" style="display:'+(scrEditorOpen?'none':'flex')+';align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--b1);flex-shrink:0;cursor:pointer" onclick="scrToggleEditor()">';
  h+='<span style="font-size:10px;color:var(--t3)">Formula:</span>';
  h+='<span style="font-family:var(--fm);font-size:11px;color:var(--bl);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(shortFormula||'(none)')+'</span>';
  h+='<button class="afl-btn afl-btn-run" onclick="event.stopPropagation();aflRun()" style="padding:4px 12px;font-size:10px">🚀 Run</button>';
  h+='<span id="scr-tog-arrow" style="font-size:10px;color:var(--t3)">▼ Show</span>';
  h+='</div>';

  // Editor section (collapsible)
  h+='<div id="scr-editor" style="display:'+(scrEditorOpen?'flex':'none')+';flex-direction:column;gap:8px;padding:10px 12px;flex-shrink:0;border-bottom:1px solid var(--b1)">';
  // Toggle hide button
  h+='<div style="display:flex;align-items:center;justify-content:space-between">';
  h+='<span style="font-size:11px;color:var(--t3);font-weight:600">Templates:</span>';
  h+='<button onclick="scrToggleEditor()" style="background:none;border:none;font-size:10px;color:var(--t3);cursor:pointer;padding:2px 6px" id="scr-tog-arrow">▲ Hide</button>';
  h+='</div>';
  // Template buttons
  h+='<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
  AFL_TEMPLATES.forEach(function(t,i){h+='<button class="afl-tpl" onclick="aflLoadTemplate('+i+')" title="'+esc(t.formula)+'">'+esc(t.name)+'</button>';});
  h+='</div>';
  // Saved
  h+='<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span style="font-size:11px;color:var(--t3);font-weight:600">Saved:</span><span id="afl-saved">'+renderSavedConfigs()+'</span>';
  h+='<button class="afl-tpl afl-tpl-add" onclick="aflSaveConfig()">+ New</button></div>';
  // Formula + buttons
  h+='<div style="display:flex;gap:8px;align-items:flex-start"><div style="flex:1"><textarea id="afl-input" class="afl-textarea" placeholder="C > MA20 AND K < 20 AND Val > 1000000000&#10;Operators: AND OR > < >= <= == != ( )" rows="3" oninput="aflOnInput()">'+esc(scrFormulaText)+'</textarea></div>';
  h+='<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0"><button class="afl-btn afl-btn-run" onclick="aflRun()">🚀 Run Formula</button><button class="afl-btn afl-btn-save" onclick="aflSaveConfig()">💾 Save as Config</button><button class="afl-btn afl-btn-clear" onclick="aflClear()">↺ Clear</button></div></div>';
  // Ref
  h+='<div><div class="afl-ref-toggle" onclick="aflToggleRef()"><span>'+(scrRefOpen?'▼':'▶')+'</span> <span style="font-size:11px">📋 Available Variables & Operators</span></div>';
  h+='<div id="afl-ref" style="display:'+(scrRefOpen?'grid':'none')+'" class="afl-ref-grid">';
  for(var cat in AFL_VARIABLES){h+='<div class="afl-ref-cat"><div class="afl-ref-cat-title">'+esc(cat)+'</div>';AFL_VARIABLES[cat].forEach(function(v){h+='<span class="afl-ref-var" onclick="aflInsertVar(\''+v.v+'\')">'+v.v+(v.d?' <span style="color:var(--t3);font-weight:400">/ '+esc(v.d)+'</span>':'')+'</span>';});h+='</div>';}
  h+='</div></div>';
  h+='</div>'; // end editor

  // Status + cols
  h+='<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;padding:4px 12px"><span id="afl-status" style="font-size:11px;color:var(--t3);flex:1;min-height:16px"></span><button id="scr-cols-btn" class="bei-sort-btn" style="font-size:9px;padding:2px 8px;display:none" onclick="scrShowColToggle()">⚙ Columns</button></div>';
  // Col toggle
  h+='<div id="scr-col-toggle" style="display:none;flex-shrink:0;padding:6px 12px;border-bottom:1px solid var(--b1)">'+scrRenderColPanel()+'</div>';
  h+='<div id="afl-results" style="flex:1;overflow:auto"></div></div>';
  el.innerHTML=h;
}

// ═══ GROUPED COL PANEL ═══
function scrRenderColPanel(){
  var h='<div style="display:flex;flex-direction:column;gap:4px">';
  scrColGroups.forEach(function(g){
    h+='<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap">';
    h+='<span style="font-size:9px;font-weight:700;color:var(--t3);min-width:42px">'+g.name+'</span>';
    g.keys.forEach(function(k){
      if(!scrAllCols[k])return;
      h+='<span class="scr-col'+(scrColVis[k]?' on':'')+'" draggable="true" data-col="'+k+'" onclick="scrToggleCol(\''+k+'\')" ondragstart="scrColDragStart(event)" ondragover="scrColDragOver(event)" ondrop="scrColDrop(event)" style="font-size:9px;padding:2px 5px;cursor:grab;user-select:none">'+scrAllCols[k].label+'</span>';
    });
    h+='</div>';
  });
  h+='<div style="margin-top:2px"><button class="bei-sort-btn" onclick="scrResetCols()" style="font-size:9px;padding:2px 6px">↺ Reset</button></div>';
  h+='</div>';return h;
}
function scrShowColToggle(){scrColToggleOpen=!scrColToggleOpen;var el=$('scr-col-toggle');if(el){el.style.display=scrColToggleOpen?'block':'none';el.innerHTML=scrRenderColPanel();}}
function scrToggleCol(k){scrColVis[k]=!scrColVis[k];saveScrCols();var p=$('scr-col-toggle');if(p)p.innerHTML=scrRenderColPanel();scrRenderResults();}
function scrResetCols(){scrColOrder=scrDefaultColOrder.slice();scrColVis=Object.assign({},scrDefaultColVis);saveScrCols();var p=$('scr-col-toggle');if(p)p.innerHTML=scrRenderColPanel();scrRenderResults();}

// ═══ DRAG ═══
function scrColDragStart(e){scrDragCol=e.target.getAttribute('data-col');e.target.style.opacity='0.4';e.dataTransfer.effectAllowed='move';}
function scrColDragOver(e){e.preventDefault();e.dataTransfer.dropEffect='move';document.querySelectorAll('#scr-col-toggle [data-col]').forEach(function(el){el.style.borderLeft='';});var t=e.target.closest('[data-col]');if(t&&t.getAttribute('data-col')!==scrDragCol)t.style.borderLeft='2px solid var(--bl)';}
function scrColDrop(e){e.preventDefault();document.querySelectorAll('#scr-col-toggle [data-col]').forEach(function(el){el.style.opacity='1';el.style.borderLeft='';});var t=e.target.closest('[data-col]');if(!t||!scrDragCol)return;var dc=t.getAttribute('data-col');if(scrDragCol===dc)return;var a=scrColOrder.slice(),f=a.indexOf(scrDragCol),to=a.indexOf(dc);if(f<0||to<0)return;a.splice(f,1);a.splice(to,0,scrDragCol);scrColOrder=a;scrDragCol=null;saveScrCols();scrRenderResults();}
function scrThDragStart(e){scrDragCol=e.target.getAttribute('data-col');e.target.style.opacity='0.4';e.dataTransfer.effectAllowed='move';}
function scrThDragOver(e){e.preventDefault();e.dataTransfer.dropEffect='move';}
function scrThDrop(e){e.preventDefault();document.querySelectorAll('#afl-results th[data-col]').forEach(function(el){el.style.opacity='1';});var t=e.target.closest('[data-col]');if(!t||!scrDragCol)return;var dc=t.getAttribute('data-col');if(scrDragCol===dc)return;var a=scrColOrder.slice(),f=a.indexOf(scrDragCol),to=a.indexOf(dc);if(f<0||to<0)return;a.splice(f,1);a.splice(to,0,scrDragCol);scrColOrder=a;scrDragCol=null;saveScrCols();var p=$('scr-col-toggle');if(p&&scrColToggleOpen)p.innerHTML=scrRenderColPanel();scrRenderResults();}

// ═══ SORT ═══
function scrDoSort(key){if(scrSortKey===key)scrSortDir=scrSortDir==='desc'?'asc':'desc';else{scrSortKey=key;scrSortDir='desc';}scrRenderResults();}
function scrSortData(data){var col=scrAllCols[scrSortKey];var dir=scrSortDir==='desc'?-1:1;if(!col||!col.sort)return data.slice().sort(function(a,b){return dir*((Math.abs(b.foreign_net_val||0))-(Math.abs(a.foreign_net_val||0)));});var fn=col.sort;return data.slice().sort(function(a,b){var va=fn(a),vb=fn(b);if(typeof va==='string')return dir*va.localeCompare(vb);return dir*((vb||0)-(va||0));});}

// ═══ SAVED ═══
function renderSavedConfigs(){
  if(!scrSavedConfigs.length)return '<span style="font-size:10px;color:var(--t3)">No saved configs</span>';
  return scrSavedConfigs.map(function(c){
    var formula='';try{var f=typeof c.filters==='string'?JSON.parse(c.filters):c.filters;formula=f.formula||'';}catch(e){}
    return '<span style="display:inline-flex;align-items:center;gap:0;margin-right:2px"><button class="afl-tpl afl-tpl-saved" onclick="aflLoadConfig('+c.id+')" title="'+esc(formula)+'" style="border-radius:5px 0 0 5px">'+esc(c.name)+'</button><button class="afl-tpl" onclick="aflDeleteConfig('+c.id+',\''+esc(c.name).replace(/'/g,"\\'")+'\');" title="Delete" style="border-radius:0 5px 5px 0;border-left:none;padding:3px 5px;color:var(--rd);font-size:10px">✕</button></span>';
  }).join('');
}

// ═══ ACTIONS ═══
function aflLoadTemplate(idx){var t=AFL_TEMPLATES[idx];if(!t)return;var inp=$('afl-input');if(inp){inp.value=t.formula;scrFormulaText=t.formula;localStorage.setItem('afl_formula',t.formula);}}
function aflLoadConfig(id){
  var c=null;for(var i=0;i<scrSavedConfigs.length;i++){if(scrSavedConfigs[i].id===id){c=scrSavedConfigs[i];break;}}if(!c)return;
  try{var f=typeof c.filters==='string'?JSON.parse(c.filters):c.filters;var formula=f.formula||'';
  var inp=$('afl-input');if(inp){inp.value=formula;scrFormulaText=formula;localStorage.setItem('afl_formula',formula);}
  if(f.colVis){scrColVis=Object.assign({},scrDefaultColVis,f.colVis);}
  if(f.colOrder&&f.colOrder.length){scrColOrder=f.colOrder;}
  saveScrCols();var p=$('scr-col-toggle');if(p&&scrColToggleOpen)p.innerHTML=scrRenderColPanel();
  if(scrResults.length)scrRenderResults();}catch(e){}
}
async function aflSaveConfig(){
  var formula='';var inp=$('afl-input');if(inp)formula=inp.value.trim();
  if(!formula){showT('⚠️','Write a formula first');return;}
  var name=prompt('Config name:');if(!name)return;
  try{await fetch('/api/screener/configs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,filters:{formula:formula,colVis:scrColVis,colOrder:scrColOrder}})});
  var r=await fetch('/api/screener/configs');scrSavedConfigs=await r.json();
  var el=$('afl-saved');if(el)el.innerHTML=renderSavedConfigs();showT('💾 Saved',name);}catch(e){}
}
async function aflDeleteConfig(id,name){
  if(!confirm('Delete "'+name+'"?'))return;
  try{await fetch('/api/screener/configs/'+id,{method:'DELETE'});var r=await fetch('/api/screener/configs');scrSavedConfigs=await r.json();var el=$('afl-saved');if(el)el.innerHTML=renderSavedConfigs();}catch(e){}
}
function aflClear(){var inp=$('afl-input');if(inp)inp.value='';scrFormulaText='';localStorage.setItem('afl_formula','');scrResults=[];var r=$('afl-results');if(r)r.innerHTML='';var s=$('afl-status');if(s)s.textContent='';var cb=$('scr-cols-btn');if(cb)cb.style.display='none';scrColToggleOpen=false;var ct=$('scr-col-toggle');if(ct)ct.style.display='none';}
function aflOnInput(){var inp=$('afl-input');if(inp){scrFormulaText=inp.value;localStorage.setItem('afl_formula',inp.value);}}
function aflToggleRef(){scrRefOpen=!scrRefOpen;var el=$('afl-ref');if(el)el.style.display=scrRefOpen?'grid':'none';var t=document.querySelector('.afl-ref-toggle span:first-child');if(t)t.textContent=scrRefOpen?'▼':'▶';}
function aflInsertVar(v){var inp=$('afl-input');if(!inp)return;var s=inp.selectionStart,e=inp.selectionEnd,txt=inp.value,bef=txt.substring(0,s),aft=txt.substring(e);var sp=bef.length>0&&bef[bef.length-1]!==' '&&bef[bef.length-1]!=='(';inp.value=bef+(sp?' ':'')+v+aft;inp.focus();var np=s+(sp?1:0)+v.length;inp.setSelectionRange(np,np);scrFormulaText=inp.value;localStorage.setItem('afl_formula',inp.value);}

// ═══ RUN ═══
async function aflRun(){
  var formula='';var inp=$('afl-input');if(inp)formula=inp.value.trim();
  if(!formula){showT('⚠️','Write a formula first');return;}
  var st=$('afl-status'),re=$('afl-results');
  if(st)st.innerHTML='<span style="color:var(--am)">⏳ Running...</span>';
  if(re)re.innerHTML=skelRows(8);
  try{
    var r=await fetch('/api/screener/formula',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({formula:formula,limit:500})});
    var data=await r.json();
    if(data.error){if(st)st.innerHTML='<span style="color:var(--rd)">❌ '+esc(data.error)+'</span>';if(re)re.innerHTML='';return;}
    scrResults=data.data||[];
    if(st)st.innerHTML='<span style="color:var(--gn)">✅ '+(data.total||0)+' matches</span> · <span style="color:var(--t3)">'+(data.trade_date||'')+' · '+(data.parse_time||0)+'ms</span>';
    scrAutoColumns(formula);
    var cb=$('scr-cols-btn');if(cb)cb.style.display=scrResults.length?'inline-block':'none';
    // Auto-hide editor after successful run
    if(scrResults.length&&scrEditorOpen){scrEditorOpen=false;var ed=$('scr-editor');if(ed)ed.style.display='none';var sum=$('scr-summary');if(sum){sum.style.display='flex';var sf=sum.querySelector('span:nth-child(2)');if(sf)sf.textContent=formula.length>80?formula.substring(0,77)+'…':formula;}}
    scrRenderResults();
  }catch(e){if(st)st.innerHTML='<span style="color:var(--rd)">❌ Network error</span>';if(re)re.innerHTML='';}
}

// ═══ RENDER TABLE ═══
function scrRenderResults(){
  var el=$('afl-results');if(!el)return;
  if(!scrResults||!scrResults.length){el.innerHTML='<div style="padding:20px;text-align:center;color:var(--t3);font-size:12px">No results. Write a formula and click Run.</div>';return;}
  var visCols=scrColOrder.filter(function(k){return scrColVis[k]&&scrAllCols[k];});
  var sorted=scrSortData(scrResults);
  var h='<table class="bei-tbl" style="font-size:10px"><thead><tr><th class="ar" style="width:28px">#</th>';
  visCols.forEach(function(k){var c=scrAllCols[k];var ar=scrSortKey===k?(scrSortDir==='desc'?' ▼':' ▲'):'';var ss=scrSortKey===k?'color:var(--bl);':'';h+='<th class="'+c.align+'" style="cursor:pointer;user-select:none;'+ss+'" draggable="true" data-col="'+k+'" onclick="scrDoSort(\''+k+'\')" ondragstart="scrThDragStart(event)" ondragover="scrThDragOver(event)" ondrop="scrThDrop(event)">'+c.label+ar+'</th>';});
  h+='</tr></thead><tbody>';
  sorted.forEach(function(d,i){
    h+='<tr><td class="ar" style="color:var(--t3)">'+(i+1)+'</td>';
    visCols.forEach(function(k){var c=scrAllCols[k];var s='';if(c.mono)s+='font-family:var(--fm);';if(c.bold)s+='font-weight:600;';h+='<td class="'+c.align+(c.cls?' '+c.cls:'')+'"'+(s?' style="'+s+'"':'')+'>'+c.fmt(d)+'</td>';});
    h+='</tr>';});
  h+='</tbody></table>';el.innerHTML=h;
}