// ═══ AFL FORMULA SCREENER V3 — Modal Redesign ═══

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
  { name: 'Sector Filter', formula: 'Sector == "Teknologi" AND C > 0' },
];

var AFL_VARIABLES = {
  'Price': [
    {v:'C',d:'Close',tip:'Harga penutupan hari ini'},
    {v:'O',d:'Open',tip:'Harga pembukaan hari ini'},
    {v:'H',d:'High',tip:'Harga tertinggi hari ini'},
    {v:'L',d:'Low',tip:'Harga terendah hari ini'},
    {v:'Chg',d:'(%)',tip:'Perubahan harga dari kemarin dalam persen'}
  ],
  'MA': [
    {v:'MA3',tip:'Moving Average 3 hari'},
    {v:'MA5',tip:'Moving Average 5 hari — momentum sangat pendek'},
    {v:'MA10',tip:'Moving Average 10 hari — short-term trend'},
    {v:'MA20',tip:'Moving Average 20 hari — swing trend (1 bulan)'},
    {v:'MA30',tip:'Moving Average 30 hari'},
    {v:'MA50',tip:'Moving Average 50 hari — medium-term trend'},
    {v:'MA100',tip:'Moving Average 100 hari'},
    {v:'MA200',tip:'Moving Average 200 hari — long-term trend (1 tahun)'}
  ],
  'Distance %': [
    {v:'DistMA3',tip:'Jarak harga ke MA3 dalam %. Positif = di atas MA'},
    {v:'DistMA5',tip:'Jarak harga ke MA5 dalam %'},
    {v:'DistMA10',tip:'Jarak harga ke MA10 dalam %'},
    {v:'DistMA20',tip:'Jarak harga ke MA20 dalam %. >5% = overbought, <-5% = oversold'},
    {v:'DistMA30',tip:'Jarak harga ke MA30 dalam %'},
    {v:'DistMA50',tip:'Jarak harga ke MA50 dalam %'},
    {v:'DistMA100',tip:'Jarak harga ke MA100 dalam %'},
    {v:'DistMA200',tip:'Jarak harga ke MA200 dalam %. Saham sehat biasanya >0%'}
  ],
  'Above MA (0/1)': [
    {v:'Up_MA5',tip:'1 jika harga di atas MA5, 0 jika di bawah'},
    {v:'Up_MA10',tip:'1 jika harga di atas MA10'},
    {v:'Up_MA20',tip:'1 jika harga di atas MA20 — swing bullish'},
    {v:'Up_MA50',tip:'1 jika harga di atas MA50 — medium-term bullish'},
    {v:'Up_MA100',tip:'1 jika harga di atas MA100'},
    {v:'Up_MA200',tip:'1 jika harga di atas MA200 — long-term bullish'}
  ],
  'MA Stage': [
    {v:'MA_Above',tip:'Jumlah MA yang di bawah harga (0-5). Stage 5 = full uptrend, Stage 0 = full downtrend'},
    {v:'MA_Aligned',d:'(0/1)',tip:'1 jika MA tersusun rapi bullish: MA5>MA10>MA20>MA50>MA200'}
  ],
  'Trend (0/1)': [
    {v:'ShortTrend',tip:'1 jika C > MA10 AND C > MA20 — short-term bullish'},
    {v:'Intermediate',tip:'1 jika C > MA20 AND C > MA50 — intermediate bullish'},
    {v:'LongTrend',tip:'1 jika C > MA20 AND C > MA50 AND C > MA200 — full bullish alignment'}
  ],
  'Pattern (0/1)': [
    {v:'isBase',tip:'1 jika saham sedang membentuk base (sideways setelah downtrend, volatilitas rendah)'},
    {v:'isNearLow',tip:'1 jika harga dekat 20-day low (potential reversal zone)'},
    {v:'isBreakout',tip:'1 jika harga breakout di atas 20-day high'}
  ],
  'HHV/LLV': [
    {v:'HHV20',tip:'Highest High Value 20 hari — resistance terdekat'},
    {v:'LLV20',tip:'Lowest Low Value 20 hari — support terdekat'},
    {v:'HHV_C20',tip:'Highest Close 20 hari'},
    {v:'LLV_C20',tip:'Lowest Close 20 hari'},
    {v:'PrevHHV20',tip:'HHV20 hari kemarin — untuk detect breakout baru'}
  ],
  'MACD': [
    {v:'MACD',tip:'MACD Line (EMA12 - EMA26). Positif = bullish momentum'},
    {v:'Signal',tip:'Signal Line (EMA9 dari MACD). Cross = signal entry/exit'},
    {v:'MACD_Hist',tip:'Histogram (MACD - Signal). Naik = momentum menguat'},
    {v:'MACD_Status',d:'(-2~2)',tip:'-2=strong bearish, -1=weak bearish, 0=neutral, 1=weak bullish, 2=strong bullish'}
  ],
  'MACD Bool (0/1)': [
    {v:'Bullish_MACD',tip:'1 jika MACD > Signal AND MACD_Hist > 0 — momentum bullish kuat'},
    {v:'BullishWeak_MACD',tip:'1 jika MACD > Signal tapi MACD_Hist < 0 — bullish melemah'},
    {v:'Bearish_MACD',tip:'1 jika MACD < Signal AND MACD_Hist < 0 — momentum bearish kuat'},
    {v:'BearishWeak_MACD',tip:'1 jika MACD < Signal tapi MACD_Hist > 0 — bearish melemah'},
    {v:'MACDCross',tip:'1 jika MACD baru cross di atas Signal (golden cross) — signal beli'},
    {v:'MACDDeathCross',tip:'1 jika MACD baru cross di bawah Signal (death cross) — signal jual'}
  ],
  'Stoch': [
    {v:'K',d:'StochK',tip:'Stochastic %K (14,3). <20 = oversold, >80 = overbought'},
    {v:'D',d:'StochD',tip:'Stochastic %D (3-day SMA of K). Cross K>D = bullish'},
    {v:'StochCrossUp',d:'(0/1)',tip:'1 jika K cross di atas D — signal beli terutama di zona oversold'},
    {v:'StochTrend',d:'(0/1)',tip:'1 jika K > D — stochastic dalam trend naik'}
  ],
  'Volume': [
    {v:'V',d:'Volume',tip:'Volume saham yang diperdagangkan hari ini'},
    {v:'Val',d:'Value (Rp)',tip:'Nilai transaksi dalam Rupiah. Filter: Val > 1000000000 (1B) untuk saham liquid'},
    {v:'Freq',tip:'Jumlah transaksi hari ini. Freq tinggi = banyak partisipan'},
    {v:'DVMil',tip:'Value dalam juta Rupiah'},
    {v:'RelVol',d:'(x avg)',tip:'Volume hari ini / rata-rata 20 hari. >2x = volume spike, mungkin ada aksi korporasi atau breakout'},
    {v:'RelFreq',d:'(x avg)',tip:'Frequency hari ini / rata-rata 20 hari. >2x = banyak transaksi kecil, bisa jadi institusi splitting orders'}
  ],
  'Bid/Offer': [
    {v:'BidVol',tip:'Total volume di sisi bid (pembeli) hari ini'},
    {v:'OfferVol',tip:'Total volume di sisi offer (penjual) hari ini'},
    {v:'BidRatio',d:'(%)',tip:'Bid / (Bid+Offer) × 100. >55% = buyers dominant, <45% = sellers dominant'}
  ],
  'Foreign': [
    {v:'ForeignNet',tip:'Net foreign hari ini (shares). Positif = asing beli lebih banyak'},
    {v:'ForeignBuy',tip:'Foreign buy volume (shares) hari ini'},
    {v:'ForeignSell',tip:'Foreign sell volume (shares) hari ini'},
    {v:'FNetVal',d:'(Rp)',tip:'Net foreign value (Rp). Lebih akurat daripada ForeignNet karena sudah × harga'},
    {v:'Foreign_5D',tip:'Kumulatif net foreign 5 hari terakhir (Rp)'},
    {v:'Foreign_10D',tip:'Kumulatif net foreign 10 hari terakhir (Rp)'},
    {v:'Foreign_20D',tip:'Kumulatif net foreign 20 hari terakhir (Rp)'},
    {v:'F0',d:'(today)',tip:'Net foreign hari ini (Rp)'},
    {v:'F1',tip:'Net foreign kemarin (Rp)'},
    {v:'F2',tip:'Net foreign 2 hari lalu'},
    {v:'F3',tip:'Net foreign 3 hari lalu'},
    {v:'F4',tip:'Net foreign 4 hari lalu'}
  ],
  'Fundamental': [
    {v:'PER',tip:'Price to Earnings Ratio. <10 = murah, >30 = mahal. PER < 0 berarti rugi'},
    {v:'PBV',tip:'Price to Book Value. <1 = di bawah nilai buku, >3 = premium'},
    {v:'ROE',tip:'Return on Equity (%). >15% = bagus, <5% = kurang produktif'},
    {v:'ROA',tip:'Return on Assets (%). >5% = efisien menggunakan aset'},
    {v:'NPM',d:'(%)',tip:'Net Profit Margin. >10% = margin bagus'},
    {v:'DER',tip:'Debt to Equity Ratio. <1 = utang rendah, >2 = high leverage'},
    {v:'MktCap',tip:'Market Cap (close × listed shares). Filter: MktCap > 1e12 untuk large cap'}
  ],
  'Sector/Industry': [
    {v:'Sector',d:'(string)',tip:'Nama sektor dari BEI. Gunakan: Sector == "Teknologi" atau Sector == "Financials". Case-insensitive.'},
    {v:'Industry',d:'(string)',tip:'Nama industri dari BEI. Gunakan: Industry == "Banks". Case-insensitive.'},
    {v:'Board',d:'(string)',tip:'Papan pencatatan: "Utama", "Pengembangan", "Akselerasi". Board == "Utama"'}
  ],
  'Freq Analysis': [
    {v:'TickRatio',d:'(x avg)',tip:'Avg value per transaction / 20d avg. >2.5 = block trade (institusi), <0.6 = retail frenzy'},
    {v:'isBlockTrade',d:'(0/1)',tip:'1 jika terdeteksi block trade hari ini — lot besar, institusional, tick ratio >2.5x'},
    {v:'isRetailFrenzy',d:'(0/1)',tip:'1 jika retail frenzy — banyak transaksi kecil, freq spike >2x, tick ratio <0.6x'},
    {v:'isSmartAccum',d:'(0/1)',tip:'1 jika smart accumulation — volume naik, harga flat, foreign beli, under the radar'},
    {v:'isDryUp',d:'(0/1)',tip:'1 jika volume/freq kering (<0.4x avg) — tidak ada minat, potential base forming'}
  ]
};

// ═══ HELPERS ═══
function _t(d,k){return d.tech?d.tech[k]:null;}
function _f(d,k){return d.fund?d.fund[k]:null;}
function _x(d,k){return d.extra?d.extra[k]:null;}
function _pct(v){if(v==null)return'—';return '<span class="'+(v>0?'up':v<0?'dn':'')+'">'+v.toFixed(2)+'%</span>';}
function _num(v){if(v==null||v===0)return'—';return typeof v==='number'?v.toLocaleString():v;}
function _bool(v){return v?'<span class="up">✓</span>':'<span style="color:var(--t3)">·</span>';}
function _dist(d,k){var t=d.tech;if(!t||!t[k]||!d.close)return null;return Math.round((d.close-t[k])/t[k]*10000)/100;}
function _trend(v){if(v>0)return'<span class="up" style="font-size:9px">▲ Up</span>';if(v<0)return'<span class="dn" style="font-size:9px">▼ Down</span>';return'<span style="color:var(--t3);font-size:9px">— Flat</span>';}
function _cross(type){if(type==='golden')return'<span class="up" style="font-size:9px;font-weight:600">★ Golden</span>';if(type==='death')return'<span class="dn" style="font-size:9px;font-weight:600">✕ Death</span>';return'<span style="color:var(--t3)">—</span>';}
function _fval(d,key){var v=_x(d,key);if(v==null||v===0)return'<span style="color:var(--t3)">0</span>';return '<span class="'+(v>0?'up':v<0?'dn':'')+'">'+fmtRp(v)+'</span>';}

// ═══ COLUMN GROUPS ═══
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
  {name:'FreqAna',keys:['tickratio','blocktrade','retailfrenzy','smartaccum','dryup']},
];

// ═══ ALL COLUMNS ═══
var scrAllCols = {
  code:{label:'Code',align:'al',fmt:function(d){return '<span class="code" onclick="if(typeof sdOpenTicker===\'function\')sdOpenTicker(\''+esc(d.code)+'\');else gsOpen(\''+esc(d.code)+'\')">'+esc(d.code)+'</span>';}},
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
  relvol:{label:'RelVol',align:'ar',mono:1,sort:function(d){return _x(d,'RelVol')||0;},fmt:function(d){var v=_x(d,'RelVol');return v?v.toFixed(2)+'x':'—';}},
  ma3:{label:'MA3',align:'ar',mono:1,sort:function(d){return _t(d,'ma3')||0;},fmt:function(d){return _num(_t(d,'ma3'));}},
  ma5:{label:'MA5',align:'ar',mono:1,sort:function(d){return _t(d,'ma5')||0;},fmt:function(d){return _num(_t(d,'ma5'));}},
  ma10:{label:'MA10',align:'ar',mono:1,sort:function(d){return _t(d,'ma10')||0;},fmt:function(d){return _num(_t(d,'ma10'));}},
  ma20:{label:'MA20',align:'ar',mono:1,sort:function(d){return _t(d,'ma20')||0;},fmt:function(d){return _num(_t(d,'ma20'));}},
  ma30:{label:'MA30',align:'ar',mono:1,sort:function(d){return _t(d,'ma30')||0;},fmt:function(d){return _num(_t(d,'ma30'));}},
  ma50:{label:'MA50',align:'ar',mono:1,sort:function(d){return _t(d,'ma50')||0;},fmt:function(d){return _num(_t(d,'ma50'));}},
  ma100:{label:'MA100',align:'ar',mono:1,sort:function(d){return _t(d,'ma100')||0;},fmt:function(d){return _num(_t(d,'ma100'));}},
  ma200:{label:'MA200',align:'ar',mono:1,sort:function(d){return _t(d,'ma200')||0;},fmt:function(d){return _num(_t(d,'ma200'));}},
  distma3:{label:'D.3%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma3')||0;},fmt:function(d){return _pct(_dist(d,'ma3'));}},
  distma5:{label:'D.5%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma5')||0;},fmt:function(d){return _pct(_dist(d,'ma5'));}},
  distma10:{label:'D.10%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma10')||0;},fmt:function(d){return _pct(_dist(d,'ma10'));}},
  distma20:{label:'D.20%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma20')||0;},fmt:function(d){return _pct(_dist(d,'ma20'));}},
  distma30:{label:'D.30%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma30')||0;},fmt:function(d){return _pct(_dist(d,'ma30'));}},
  distma50:{label:'D.50%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma50')||0;},fmt:function(d){return _pct(_dist(d,'ma50'));}},
  distma100:{label:'D.100%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma100')||0;},fmt:function(d){return _pct(_dist(d,'ma100'));}},
  distma200:{label:'D.200%',align:'ar',mono:1,sort:function(d){return _dist(d,'ma200')||0;},fmt:function(d){return _pct(_dist(d,'ma200'));}},
  up_ma5:{label:'↑5',align:'ar',sort:function(d){var c=d.close,m=_t(d,'ma5');return(c&&m&&c>m)?1:0;},fmt:function(d){var c=d.close,m=_t(d,'ma5');return(c&&m)?_bool(c>m):'—';}},
  up_ma10:{label:'↑10',align:'ar',sort:function(d){var c=d.close,m=_t(d,'ma10');return(c&&m&&c>m)?1:0;},fmt:function(d){var c=d.close,m=_t(d,'ma10');return(c&&m)?_bool(c>m):'—';}},
  up_ma20:{label:'↑20',align:'ar',sort:function(d){var c=d.close,m=_t(d,'ma20');return(c&&m&&c>m)?1:0;},fmt:function(d){var c=d.close,m=_t(d,'ma20');return(c&&m)?_bool(c>m):'—';}},
  up_ma50:{label:'↑50',align:'ar',sort:function(d){var c=d.close,m=_t(d,'ma50');return(c&&m&&c>m)?1:0;},fmt:function(d){var c=d.close,m=_t(d,'ma50');return(c&&m)?_bool(c>m):'—';}},
  up_ma100:{label:'↑100',align:'ar',sort:function(d){var c=d.close,m=_t(d,'ma100');return(c&&m&&c>m)?1:0;},fmt:function(d){var c=d.close,m=_t(d,'ma100');return(c&&m)?_bool(c>m):'—';}},
  up_ma200:{label:'↑200',align:'ar',sort:function(d){var c=d.close,m=_t(d,'ma200');return(c&&m&&c>m)?1:0;},fmt:function(d){var c=d.close,m=_t(d,'ma200');return(c&&m)?_bool(c>m):'—';}},
  shorttrend:{label:'ShortTr',align:'ar',sort:function(d){return _x(d,'ShortTrend')||0;},fmt:function(d){return _bool(_x(d,'ShortTrend'));}},
  intermediate:{label:'IntTr',align:'ar',sort:function(d){return _x(d,'Intermediate')||0;},fmt:function(d){return _bool(_x(d,'Intermediate'));}},
  longtrend:{label:'LongTr',align:'ar',sort:function(d){return _x(d,'LongTrend')||0;},fmt:function(d){return _bool(_x(d,'LongTrend'));}},
  isbreakout:{label:'Brkout',align:'ar',sort:function(d){return _x(d,'isBreakout')||0;},fmt:function(d){return _bool(_x(d,'isBreakout'));}},
  isbase:{label:'Base',align:'ar',sort:function(d){return _x(d,'isBase')||0;},fmt:function(d){return _bool(_x(d,'isBase'));}},
  isnearlow:{label:'NrLow',align:'ar',sort:function(d){return _x(d,'isNearLow')||0;},fmt:function(d){return _bool(_x(d,'isNearLow'));}},
  hhv20:{label:'HHV20',align:'ar',mono:1,sort:function(d){return _x(d,'HHV20')||0;},fmt:function(d){return _num(_x(d,'HHV20'));}},
  llv20:{label:'LLV20',align:'ar',mono:1,sort:function(d){return _x(d,'LLV20')||0;},fmt:function(d){return _num(_x(d,'LLV20'));}},
  macd:{label:'MACD',align:'ar',mono:1,sort:function(d){var m=_t(d,'macd');return m?m.macd:0;},fmt:function(d){var m=_t(d,'macd');if(!m)return'—';var v=m.macd;return '<span class="'+(v>0?'up':v<0?'dn':'')+'">'+v.toFixed(2)+'</span>';}},
  signal:{label:'Signal',align:'ar',mono:1,sort:function(d){var m=_t(d,'macd');return m?m.signal:0;},fmt:function(d){var m=_t(d,'macd');return m?m.signal.toFixed(2):'—';}},
  macd_hist:{label:'MACD_H',align:'ar',mono:1,sort:function(d){var m=_t(d,'macd');return m?m.histogram:0;},fmt:function(d){var m=_t(d,'macd');if(!m)return'—';var v=m.histogram;return '<span class="'+(v>0?'up':v<0?'dn':'')+'">'+v.toFixed(2)+'</span>';}},
  macd_trend:{label:'MACD Tr',align:'ar',sort:function(d){return _x(d,'MACD_Status')||0;},fmt:function(d){var v=_x(d,'MACD_Status');return _trend(v);}},
  macd_cross:{label:'MACD×',align:'ar',sort:function(d){return _x(d,'MACDCross')?1:_x(d,'MACDDeathCross')?-1:0;},fmt:function(d){if(_x(d,'MACDCross'))return _cross('golden');if(_x(d,'MACDDeathCross'))return _cross('death');return '<span style="color:var(--t3)">—</span>';}},
  k:{label:'K',align:'ar',mono:1,sort:function(d){var s=_t(d,'stoch');return s?s.k:0;},fmt:function(d){var s=_t(d,'stoch');if(!s)return'—';var v=s.k;var c=v>80?'dn':v<20?'up':'';return '<span class="'+c+'">'+v.toFixed(2)+'</span>';}},
  d_stoch:{label:'D',align:'ar',mono:1,sort:function(d){var s=_t(d,'stoch');return s?(s.d||0):0;},fmt:function(d){var s=_t(d,'stoch');return s&&s.d?s.d.toFixed(2):'—';}},
  stoch_trend:{label:'Stoch Tr',align:'ar',sort:function(d){return _x(d,'StochTrend')||0;},fmt:function(d){var v=_x(d,'StochTrend');return v?'<span class="up" style="font-size:9px">▲ Up</span>':'<span class="dn" style="font-size:9px">▼ Down</span>';}},
  stoch_cross:{label:'Stoch×',align:'ar',sort:function(d){return _x(d,'StochCrossUp')||0;},fmt:function(d){return _x(d,'StochCrossUp')?_cross('golden'):'<span style="color:var(--t3)">—</span>';}},
  fnet:{label:'FNet',align:'ar',mono:1,bold:1,sort:function(d){return d.foreign_net_val||0;},fmt:function(d){var v=d.foreign_net_val||0;return '<span class="'+(v>0?'up':v<0?'dn':'')+'">'+fmtRp(v)+'</span>';}},
  fbuy:{label:'F.Buy',align:'ar',mono:1,sort:function(d){return(d.foreign_buy||0)*d.close;},fmt:function(d){return fmtRp((d.foreign_buy||0)*d.close);}},
  fsell:{label:'F.Sell',align:'ar',mono:1,sort:function(d){return(d.foreign_sell||0)*d.close;},fmt:function(d){return fmtRp((d.foreign_sell||0)*d.close);}},
  f5d:{label:'F.5D',align:'ar',mono:1,sort:function(d){return _x(d,'Foreign_5D')||0;},fmt:function(d){return _fval(d,'Foreign_5D');}},
  f0:{label:'F0',align:'ar',mono:1,sort:function(d){return _x(d,'F0')||0;},fmt:function(d){return _fval(d,'F0');}},
  f1:{label:'F1',align:'ar',mono:1,sort:function(d){return _x(d,'F1')||0;},fmt:function(d){return _fval(d,'F1');}},
  f2:{label:'F2',align:'ar',mono:1,sort:function(d){return _x(d,'F2')||0;},fmt:function(d){return _fval(d,'F2');}},
  f3:{label:'F3',align:'ar',mono:1,sort:function(d){return _x(d,'F3')||0;},fmt:function(d){return _fval(d,'F3');}},
  f4:{label:'F4',align:'ar',mono:1,sort:function(d){return _x(d,'F4')||0;},fmt:function(d){return _fval(d,'F4');}},
  per:{label:'PER',align:'ar',mono:1,sort:function(d){return _f(d,'per')||0;},fmt:function(d){var v=_f(d,'per');return v?v.toFixed(2):'—';}},
  pbv:{label:'PBV',align:'ar',mono:1,sort:function(d){return _f(d,'pbv')||0;},fmt:function(d){var v=_f(d,'pbv');return v?v.toFixed(2):'—';}},
  roe:{label:'ROE',align:'ar',mono:1,sort:function(d){return _f(d,'roe')||0;},fmt:function(d){var v=_f(d,'roe');return v?v.toFixed(2)+'%':'—';}},
  roa:{label:'ROA',align:'ar',mono:1,sort:function(d){return _f(d,'roa')||0;},fmt:function(d){var v=_f(d,'roa');return v?v.toFixed(2)+'%':'—';}},
  sector:{label:'Sector',align:'al',sort:function(d){return _f(d,'sector')||'';},fmt:function(d){var v=_f(d,'sector');return v?'<span style="font-size:9px">'+esc(v)+'</span>':'—';}},
  industry:{label:'Industry',align:'al',sort:function(d){return _f(d,'industry')||'';},fmt:function(d){var v=_f(d,'industry');return v?'<span style="font-size:9px">'+esc(v)+'</span>':'—';}},
  tickratio:{label:'Tick×',align:'ar',mono:1,sort:function(d){return _x(d,'TickRatio')||0;},fmt:function(d){var v=_x(d,'TickRatio');if(!v)return'—';var c=v>2.5?'#0ea5e9':v<0.6?'#f97316':'var(--t2)';return '<span style="color:'+c+'">'+v.toFixed(2)+'x</span>';}},
  blocktrade:{label:'Block',align:'ar',sort:function(d){return _x(d,'isBlockTrade')||0;},fmt:function(d){return _bool(_x(d,'isBlockTrade'));}},
  retailfrenzy:{label:'Retail',align:'ar',sort:function(d){return _x(d,'isRetailFrenzy')||0;},fmt:function(d){return _bool(_x(d,'isRetailFrenzy'));}},
  smartaccum:{label:'SmartA',align:'ar',sort:function(d){return _x(d,'isSmartAccum')||0;},fmt:function(d){return _bool(_x(d,'isSmartAccum'));}},
  dryup:{label:'DryUp',align:'ar',sort:function(d){return _x(d,'isDryUp')||0;},fmt:function(d){return _bool(_x(d,'isDryUp'));}},
};

// ═══ State ═══
var scrDefaultColOrder=Object.keys(scrAllCols);
var scrDefaultColVis={};(function(){for(var k in scrAllCols)scrDefaultColVis[k]=false;})();
['code','name','close','chg','volume','value','freq','fnet','ma20','ma50','ma200','k','macd_hist','per','pbv'].forEach(function(k){scrDefaultColVis[k]=true;});

var scrColOrder=scrDefaultColOrder.slice(),scrColVis=Object.assign({},scrDefaultColVis);
try{var _sc=JSON.parse(localStorage.getItem('scrCols4'));if(_sc){scrColVis=_sc.vis;scrColOrder=_sc.ord;}}catch(e){}
function saveScrCols(){localStorage.setItem('scrCols4',JSON.stringify({vis:scrColVis,ord:scrColOrder}));}

var scrFormulaText=localStorage.getItem('afl_formula')||'';
var scrSavedConfigs=[],scrResults=[],scrColToggleOpen=false;
var scrSortKey='fnet',scrSortDir='desc',scrDragCol=null;
var scrLoaded=false;
var scrModalOpen=false;

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
  PER:'per',PBV:'pbv',ROE:'roe',ROA:'roa',Sector:'sector',Industry:'industry'
};

function scrAutoColumns(formula){
  var base={code:1,name:1,close:1,chg:1,fnet:1};var extra={};
  formula.replace(/[()]/g,' ').split(/[\s]+/).forEach(function(w){w=w.trim();if(scrVarToCol[w])extra[scrVarToCol[w]]=1;});
  // Auto-show sector/industry if string filter used
  if(/sector/i.test(formula))extra['sector']=1;
  if(/industry/i.test(formula))extra['industry']=1;
  for(var k in scrColVis)scrColVis[k]=!!(base[k]||extra[k]);
  saveScrCols();var p=$('scr-col-toggle');if(p&&scrColToggleOpen)p.innerHTML=scrRenderColPanel();
}

// ═══ LOAD ═══
async function loadScreener(){
  var el=$('scr-content');if(!el)return;
  if(scrLoaded&&scrResults.length){if($('afl-results')){scrRenderResults();return;}}
  try{var r=await fetch('/api/screener/configs');scrSavedConfigs=await r.json();}catch(e){scrSavedConfigs=[];}
  renderScreenerUI();
  scrLoaded=true;
  if(scrResults.length){setTimeout(function(){scrRenderResults();var st=$('afl-status');if(st)st.innerHTML='✅ '+scrResults.length+' matches (cached)';var cb=$('scr-cols-btn');if(cb)cb.style.display='';},20);}
}

// ═══ MAIN UI — compact formula bar + results ═══
function renderScreenerUI(){
  var el=$('scr-content');if(!el)return;
  var h='<div style="padding:0;display:flex;flex-direction:column;height:100%;overflow:hidden">';

  // ── Formula bar (always visible) ──
  h+='<div style="padding:8px 12px;border-bottom:1px solid var(--b1);flex-shrink:0">';
  // Textarea full width
  h+='<textarea id="afl-input" class="afl-textarea" placeholder="C > MA20 AND K < 20 AND Val > 1000000000&#10;Sector == &quot;Teknologi&quot; AND ROE > 10" rows="2" oninput="aflOnInput()">'+esc(scrFormulaText)+'</textarea>';
  // Buttons row below: left = Run/Save/Clear, right = Formula
  h+='<div style="display:flex;align-items:center;gap:6px;margin-top:6px">';
  h+='<button class="afl-btn afl-btn-run" onclick="aflRun()">✦ Run Formula</button>';
  h+='<button class="afl-btn afl-btn-save" onclick="aflSaveConfig()">💾 Save as Config</button>';
  h+='<button class="afl-btn afl-btn-clear" onclick="aflClear()">↺ Clear</button>';
  h+='<div style="flex:1"></div>';
  h+='<button class="scr-formula-btn" onclick="scrOpenModal()" title="Open formula editor with variable reference">Formula</button>';
  h+='</div>';
  h+='</div>';

  // ── Templates + Saved (compact row) ──
  h+='<div style="display:flex;align-items:center;gap:6px;padding:4px 12px;border-bottom:1px solid var(--b1);flex-shrink:0;overflow-x:auto;flex-wrap:nowrap">';
  h+='<span style="font-size:9px;color:var(--t3);font-weight:700;flex-shrink:0">TPL:</span>';
  AFL_TEMPLATES.forEach(function(t,i){h+='<button class="afl-tpl" onclick="aflLoadTemplate('+i+')" title="'+esc(t.formula)+'">'+esc(t.name)+'</button>';});
  h+='<span style="width:1px;height:14px;background:var(--b2);flex-shrink:0;margin:0 2px"></span>';
  h+='<span style="font-size:9px;color:var(--t3);font-weight:700;flex-shrink:0">SAVED:</span>';
  h+='<span id="afl-saved">'+renderSavedConfigs()+'</span>';
  h+='<button class="afl-tpl afl-tpl-add" onclick="aflSaveConfig()">+ New</button>';
  h+='</div>';

  // ── Status + cols ──
  h+='<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;padding:4px 12px"><span id="afl-status" style="font-size:11px;color:var(--t3);flex:1;min-height:16px"></span><button id="scr-cols-btn" class="bei-sort-btn" style="font-size:9px;padding:2px 8px;display:none" onclick="scrShowColToggle()">⚙ Columns</button></div>';
  h+='<div id="scr-col-toggle" style="display:none;flex-shrink:0;padding:6px 12px;border-bottom:1px solid var(--b1)">'+scrRenderColPanel()+'</div>';

  // ── Results table ──
  h+='<div id="afl-results" style="flex:1;overflow:auto"></div></div>';
  el.innerHTML=h;

  // Create tooltip container
  if(!document.getElementById('afl-tooltip')){
    var tipDiv=document.createElement('div');tipDiv.id='afl-tooltip';
    tipDiv.style.cssText='display:none;position:fixed;z-index:9999;padding:8px 12px;background:#1a2332;border:1px solid var(--b2);border-radius:6px;font-size:11px;color:var(--t1);max-width:280px;line-height:1.5;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.4)';
    document.body.appendChild(tipDiv);
  }
}

// ═══ FORMULA MODAL — popup overlay with variable grid ═══
function scrOpenModal(){
  scrModalOpen=true;
  var existing=document.getElementById('scr-modal');
  if(existing)existing.remove();

  var overlay=document.createElement('div');
  overlay.id='scr-modal';
  overlay.className='scr-modal-overlay';
  overlay.onclick=function(e){if(e.target===overlay)scrCloseModal();};

  var h='<div class="scr-modal-box">';
  // Header
  h+='<div class="scr-modal-head">';
  h+='<span style="font-weight:700;font-size:var(--font-xl)">📋 Formula Editor</span>';
  h+='<div style="display:flex;gap:4px;align-items:center">';
  h+='<span style="font-size:9px;color:var(--t3)">Operators: AND OR > < >= <= == != ( )</span>';
  h+='<button class="epop-close" onclick="scrCloseModal()">✕</button>';
  h+='</div></div>';

  // Formula textarea
  h+='<div style="padding:12px 16px 8px">';
  h+='<textarea id="scr-modal-input" class="afl-textarea" rows="3" placeholder="C > MA20 AND K < 20 AND Val > 1000000000&#10;Sector == &quot;Teknologi&quot; AND ROE > 10" style="font-size:13px">'+esc(scrFormulaText)+'</textarea>';
  h+='<div style="display:flex;gap:6px;margin-top:8px">';
  h+='<button class="afl-btn afl-btn-run" onclick="scrModalRun()" style="padding:6px 16px;font-size:12px">✦ Run Formula</button>';
  h+='<button class="afl-btn afl-btn-save" onclick="scrModalSave()">💾 Save</button>';
  h+='<button class="afl-btn afl-btn-clear" onclick="scrModalClear()">↺ Clear</button>';
  h+='</div></div>';

  // Variable grid — table-like: category label left, vars right
  h+='<div style="padding:6px 12px;border-top:1px solid var(--b1);flex-shrink:0">';
  h+='<input id="scr-var-q" placeholder="cari indikator (mis. RSI, volume, foreign)" oninput="scrFilterVars(this.value)" style="width:100%;background:var(--bg0);border:1px solid var(--b1);border-radius:4px;padding:6px 9px;color:var(--t1);font-size:12px;outline:none">';
  h+='</div>';
  h+='<div class="scr-modal-vars">';
  var cats=Object.keys(AFL_VARIABLES);
  for(var ci=0;ci<cats.length;ci++){
    var cat=cats[ci];
    var vars=AFL_VARIABLES[cat];
    h+='<div class="scr-var-row">';
    h+='<div class="scr-var-cat">'+esc(cat)+'</div>';
    h+='<div class="scr-var-list">';
    vars.forEach(function(v){
      var tipAttr=v.tip?' data-tip="'+esc(v.tip)+'" onmouseenter="aflShowTip(event)" onmouseleave="aflHideTip()"':'';
      var isString=v.d==='(string)';
      h+='<span class="scr-var-btn'+(isString?' str':'')+'" onclick="scrModalInsert(\''+esc(v.v)+'\')"'+tipAttr+'>';
      h+=v.v;
      if(v.d)h+=' <span class="scr-var-desc">'+esc(v.d)+'</span>';
      h+='</span>';
    });
    h+='</div></div>';
  }
  h+='</div>';

  h+='</div>'; // end modal box
  overlay.innerHTML=h;
  document.body.appendChild(overlay);
  // Focus textarea
  setTimeout(function(){var inp=document.getElementById('scr-modal-input');if(inp){inp.focus();inp.setSelectionRange(inp.value.length,inp.value.length);}},50);
}

function scrCloseModal(){
  scrModalOpen=false;
  var m=document.getElementById('scr-modal');
  if(m)m.remove();
}

function scrModalInsert(v){
  var inp=document.getElementById('scr-modal-input');if(!inp)return;
  var s=inp.selectionStart,e=inp.selectionEnd,txt=inp.value,bef=txt.substring(0,s),aft=txt.substring(e);
  var sp=bef.length>0&&bef[bef.length-1]!==' '&&bef[bef.length-1]!=='(';
  // For string vars, insert with quotes template
  var insert=v;
  if(v==='Sector'||v==='Industry'||v==='Board')insert=v+' == ""';
  inp.value=bef+(sp?' ':'')+insert+aft;
  inp.focus();
  var np=s+(sp?1:0)+insert.length;
  // Place cursor inside quotes for string vars
  if(v==='Sector'||v==='Industry'||v==='Board')np=np-1;
  inp.setSelectionRange(np,np);
}

function scrModalRun(){
  // Sync modal → main textarea
  var mi=document.getElementById('scr-modal-input');
  if(mi){
    scrFormulaText=mi.value;
    localStorage.setItem('afl_formula',mi.value);
    var main=$('afl-input');if(main)main.value=mi.value;
  }
  scrCloseModal();
  aflRun();
}

function scrModalSave(){
  var mi=document.getElementById('scr-modal-input');
  if(mi){scrFormulaText=mi.value;localStorage.setItem('afl_formula',mi.value);var main=$('afl-input');if(main)main.value=mi.value;}
  aflSaveConfig();
}

function scrModalClear(){
  var mi=document.getElementById('scr-modal-input');
  if(mi)mi.value='';
}

// ═══ COL PANEL ═══
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
function aflLoadTemplate(idx){var t=AFL_TEMPLATES[idx];if(!t)return;var inp=$('afl-input');if(inp){inp.value=t.formula;scrFormulaText=t.formula;localStorage.setItem('afl_formula',t.formula);}var mi=document.getElementById('scr-modal-input');if(mi)mi.value=t.formula;}
function aflLoadConfig(id){
  var c=null;for(var i=0;i<scrSavedConfigs.length;i++){if(scrSavedConfigs[i].id===id){c=scrSavedConfigs[i];break;}}if(!c)return;
  try{var f=typeof c.filters==='string'?JSON.parse(c.filters):c.filters;var formula=f.formula||'';
  var inp=$('afl-input');if(inp){inp.value=formula;scrFormulaText=formula;localStorage.setItem('afl_formula',formula);}
  var mi=document.getElementById('scr-modal-input');if(mi)mi.value=formula;
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

// ═══ VARIABLE TOOLTIP ═══
function aflShowTip(e){
  var tip=e.target.closest('[data-tip]');if(!tip)return;
  var el=document.getElementById('afl-tooltip');if(!el)return;
  var text=tip.getAttribute('data-tip');if(!text)return;
  var varName=tip.textContent.split('/')[0].trim();
  el.innerHTML='<div style="font-weight:700;color:var(--bl);margin-bottom:3px;font-family:var(--fm)">'+esc(varName)+'</div>'+esc(text);
  el.style.display='block';
  var rect=tip.getBoundingClientRect();
  var x=rect.left;
  var y=rect.bottom+6;
  if(y+el.offsetHeight>window.innerHeight)y=rect.top-el.offsetHeight-6;
  if(x+el.offsetWidth>window.innerWidth)x=window.innerWidth-el.offsetWidth-10;
  el.style.left=x+'px';el.style.top=y+'px';
}
function aflHideTip(){var el=document.getElementById('afl-tooltip');if(el)el.style.display='none';}

function scrFilterVars(q){
  q=(q||'').toUpperCase().trim();
  var rows=document.querySelectorAll('.scr-var-row');
  rows.forEach(function(row){
    var catEl=row.querySelector('.scr-var-cat');
    var cat=catEl?catEl.textContent:'';
    var btns=row.querySelectorAll('.scr-var-btn');
    var shown=0;
    btns.forEach(function(b){
      var txt=(b.textContent||'').toUpperCase();
      var hit=!q||txt.indexOf(q)>=0||cat.toUpperCase().indexOf(q)>=0;
      b.style.display=hit?'':'none';
      if(hit)shown++;
    });
    row.style.display=shown?'':'none';
  });
}
