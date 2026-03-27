// ═══ BACKTESTING ENGINE V4 — server/routes/backtest.js ═══
// V4: Formula-only entry/exit, scope filter, fixed lot sizing, flexible benchmark, full AmiBroker stats

const express = require('express');
const { db, latestIdxDate } = require('../db');
const router = express.Router();

// ═══ INDICATORS ═══
function calcMA(c,p){if(c.length<p)return null;return Math.round(c.slice(-p).reduce((s,v)=>s+v,0)/p);}
function calcEMA(d,p){if(d.length<p)return null;const k=2/(p+1);let e=d.slice(0,p).reduce((s,v)=>s+v,0)/p;for(let i=p;i<d.length;i++)e=d[i]*k+e*(1-k);return e;}
function calcMACD(c){if(c.length<26)return null;let e12=c.slice(0,12).reduce((s,v)=>s+v,0)/12,e26=c.slice(0,26).reduce((s,v)=>s+v,0)/26;const k12=2/13,k26=2/27,a12=[],a26=[];for(let i=0;i<c.length;i++){if(i<12)e12=c.slice(0,i+1).reduce((s,v)=>s+v,0)/(i+1);else e12=c[i]*k12+e12*(1-k12);if(i<26)e26=c.slice(0,i+1).reduce((s,v)=>s+v,0)/(i+1);else e26=c[i]*k26+e26*(1-k26);a12.push(e12);a26.push(e26);}const ml=a12.map((v,i)=>v-a26[i]);let sg=ml.slice(0,9).reduce((s,v)=>s+v,0)/9;const k9=2/10,sigs=[];for(let i=0;i<ml.length;i++){if(i<9)sg=ml.slice(0,i+1).reduce((s,v)=>s+v,0)/(i+1);else sg=ml[i]*k9+sg*(1-k9);sigs.push(sg);}const l=ml.length-1;return{macd:Math.round(ml[l]*100)/100,signal:Math.round(sigs[l]*100)/100,histogram:Math.round((ml[l]-sigs[l])*100)/100};}
function calcStoch(h,l,c,kp,dp){kp=kp||14;dp=dp||3;if(c.length<kp)return null;const kv=[];for(let i=kp-1;i<c.length;i++){const hh=Math.max(...h.slice(i-kp+1,i+1)),ll=Math.min(...l.slice(i-kp+1,i+1));kv.push(hh===ll?50:(c[i]-ll)/(hh-ll)*100);}const dv=[];for(let i=dp-1;i<kv.length;i++)dv.push(kv.slice(i-dp+1,i+1).reduce((s,v)=>s+v,0)/dp);return{k:Math.round(kv[kv.length-1]*100)/100,d:dv.length?Math.round(dv[dv.length-1]*100)/100:null};}

// ═══ TOKENIZER + EVALUATOR ═══
function tokenize(f){const t=[];let i=0;const s=f.replace(/\s+/g,' ').trim();while(i<s.length){if(s[i]===' '){i++;continue;}if(s[i]==='('){t.push({type:'LP'});i++;continue;}if(s[i]===')'){t.push({type:'RP'});i++;continue;}if(s[i]==='>'&&s[i+1]==='='){t.push({type:'OP',v:'>='});i+=2;continue;}if(s[i]==='<'&&s[i+1]==='='){t.push({type:'OP',v:'<='});i+=2;continue;}if(s[i]==='='&&s[i+1]==='='){t.push({type:'OP',v:'=='});i+=2;continue;}if(s[i]==='!'&&s[i+1]==='='){t.push({type:'OP',v:'!='});i+=2;continue;}if(s[i]==='>'){t.push({type:'OP',v:'>'});i++;continue;}if(s[i]==='<'){t.push({type:'OP',v:'<'});i++;continue;}if(s[i]==='-'&&i+1<s.length&&s[i+1]>='0'&&s[i+1]<='9'&&(t.length===0||t[t.length-1].type==='LP'||t[t.length-1].type==='LG'||t[t.length-1].type==='OP')){let n='-';i++;while(i<s.length&&(s[i]>='0'&&s[i]<='9'||s[i]==='.'||s[i]==='e')){n+=s[i];i++;}t.push({type:'N',v:parseFloat(n)});continue;}if(s[i]>='0'&&s[i]<='9'){let n='';while(i<s.length&&(s[i]>='0'&&s[i]<='9'||s[i]==='.'||s[i]==='e')){n+=s[i];i++;}t.push({type:'N',v:parseFloat(n)});continue;}if((s[i]>='A'&&s[i]<='Z')||(s[i]>='a'&&s[i]<='z')||s[i]==='_'){let w='';while(i<s.length&&((s[i]>='A'&&s[i]<='Z')||(s[i]>='a'&&s[i]<='z')||(s[i]>='0'&&s[i]<='9')||s[i]==='_')){w+=s[i];i++;}if(w.toUpperCase()==='AND')t.push({type:'LG',v:'AND'});else if(w.toUpperCase()==='OR')t.push({type:'LG',v:'OR'});else t.push({type:'V',v:w});continue;}return{error:'Unexpected: "'+s[i]+'" pos '+i};}return t;}

function evalF(t,ctx){let p=0;function pk(){return p<t.length?t[p]:null;}function nx(){return t[p++];}function tn(v){return typeof v==='boolean'?v?1:0:v||0;}
function pE(){let r=pF();while(pk()&&pk().type==='LG'){const l=nx().v;const ri=pF();if(l==='AND')r=(tn(r)&&tn(ri))?1:0;else r=(tn(r)||tn(ri))?1:0;}return r;}
function pF(){let l=pA();if(pk()&&pk().type==='OP'){const o=nx().v;const r=pA();const a=tn(l),b=tn(r);if(o==='>')return a>b?1:0;if(o==='<')return a<b?1:0;if(o==='>=')return a>=b?1:0;if(o==='<=')return a<=b?1:0;if(o==='==')return a===b?1:0;if(o==='!=')return a!==b?1:0;}return l;}
function pA(){const tk=pk();if(!tk)throw new Error('Unexpected end');if(tk.type==='N'){nx();return tk.v;}if(tk.type==='V'){nx();if(ctx.hasOwnProperty(tk.v))return ctx[tk.v];const lo=tk.v.toLowerCase();for(const k of Object.keys(ctx)){if(k.toLowerCase()===lo)return ctx[k];}return 0;}if(tk.type==='LP'){nx();const r=pE();if(pk()&&pk().type==='RP')nx();return r;}throw new Error('Unexpected: '+tk.type);}
return!!tn(pE());}

// ═══ CA ═══
function loadCAs(){const r=db.prepare(`SELECT code,ex_date,ratio FROM corporate_actions WHERE status='confirmed' ORDER BY ex_date DESC`).all();const m={};for(const x of r){if(!m[x.code])m[x.code]=[];m[x.code].push(x);}return m;}
function adjP(c,d,a){if(!a||!a.length)return c;let f=1;for(const x of a){if(d<x.ex_date&&x.ratio>0&&x.ratio!==1)f*=(1/x.ratio);}return Math.round(c*f);}

// ═══ BUILD CONTEXT ═══
function buildCtx(hist,di,fund){
  const r=hist[di];const cls=hist.slice(0,di+1).map(h=>h.ac);const hs=hist.slice(0,di+1).map(h=>h.ah);const ls=hist.slice(0,di+1).map(h=>h.al);
  const c=cls[cls.length-1];const pc=di>0?cls[cls.length-2]:c;const chg=pc>0?Math.round((c-pc)/pc*10000)/100:0;
  const ma5=calcMA(cls,5),ma10=calcMA(cls,10),ma20=calcMA(cls,20),ma50=calcMA(cls,50),ma100=calcMA(cls,100),ma200=calcMA(cls,200);
  const macd=cls.length>=26?calcMACD(cls):null;const stoch=cls.length>=14?calcStoch(hs,ls,cls):null;
  const fn=((r.foreign_buy||0)-(r.foreign_sell||0))*c;
  const r5=hist.slice(Math.max(0,di-4),di+1);const f5d=r5.reduce((s,x)=>s+((x.foreign_buy||0)-(x.foreign_sell||0))*(x.close||0),0);
  const vs=hist.slice(Math.max(0,di-19),di+1).map(h=>h.volume);const vm=vs.length>=2?vs.slice(0,-1).reduce((s,v)=>s+v,0)/(vs.length-1):0;
  const rv=vm>0?Math.round(r.volume/vm*10)/10:0;
  const c20=cls.slice(-20);const hhv=c20.length?Math.max(...c20):0;const llv=c20.length?Math.min(...c20):0;
  const dm=(ma)=>ma?Math.round((c-ma)/ma*10000)/100:0;
  // ── Freq vars (P4 Sprint 13) ──
  let tickRatio=1,relFreq=1,isBlockTrade=0,isRetailFrenzy=0,isSmartAccum=0,isDryUp=0;
  if(di>=20){
    const h20=hist.slice(di-20,di);
    const avgVol=h20.reduce((s,x)=>s+(x.volume||0),0)/20;
    const avgFreq=h20.reduce((s,x)=>s+(x.frequency||0),0)/20;
    const avgVal=h20.reduce((s,x)=>s+(x.value||0),0)/20;
    const vol=r.volume||0,freq=r.frequency||0,val=r.value||0;
    relFreq=avgFreq>0?Math.round(freq/avgFreq*100)/100:1;
    const avgTickH=avgFreq>0?avgVal/avgFreq:0;
    const tickS=freq>0?val/freq:0;
    tickRatio=avgTickH>0?Math.round(tickS/avgTickH*100)/100:1;
    const fnet=((r.foreign_buy||0)-(r.foreign_sell||0))*(r.close||0);
    const priceChg=di>0&&cls[cls.length-2]>0?(c-cls[cls.length-2])/cls[cls.length-2]:0;
    isBlockTrade=(tickRatio>2.5&&rv>1.5&&relFreq<1.5)?1:0;
    isRetailFrenzy=(relFreq>2.0&&tickRatio<0.6&&rv>1.2)?1:0;
    isSmartAccum=(rv>1.2&&rv<3.0&&relFreq>=0.8&&relFreq<=1.8&&Math.abs(priceChg)<0.03&&fnet>0&&tickRatio>1.2)?1:0;
    isDryUp=(rv<0.4&&relFreq<0.5)?1:0;
  }
  return{C:c,O:r.open_price||c,H:r.high||c,L:r.low||c,Close:c,Open:r.open_price||c,High:r.high||c,Low:r.low||c,
    Chg:chg,V:r.volume||0,Volume:r.volume||0,Val:r.value||0,Value:r.value||0,Freq:r.frequency||0,DVMil:(r.value||0)/1e6,
    MA5:ma5||0,MA10:ma10||0,MA20:ma20||0,MA50:ma50||0,MA100:ma100||0,MA200:ma200||0,
    DistMA5:dm(ma5),DistMA10:dm(ma10),DistMA20:dm(ma20),DistMA50:dm(ma50),DistMA100:dm(ma100),DistMA200:dm(ma200),
    MACD:macd?macd.macd:0,Signal:macd?macd.signal:0,MACD_Hist:macd?macd.histogram:0,
    K:stoch?stoch.k:50,StochK:stoch?stoch.k:50,D:stoch?(stoch.d||50):50,StochD:stoch?(stoch.d||50):50,
    ForeignNet:fn,ForeignBuy:(r.foreign_buy||0)*c,ForeignSell:(r.foreign_sell||0)*c,Foreign_5D:f5d,RelVol:rv,HHV20:hhv,LLV20:llv,
    TickRatio:tickRatio,RelFreq:relFreq,isBlockTrade:isBlockTrade,isRetailFrenzy:isRetailFrenzy,isSmartAccum:isSmartAccum,isDryUp:isDryUp,
    Up_MA5:c>(ma5||0)?1:0,Up_MA10:c>(ma10||0)?1:0,Up_MA20:c>(ma20||0)?1:0,Up_MA50:c>(ma50||0)?1:0,
    ShortTrend:(c>(ma10||0)&&c>(ma20||0))?1:0,Intermediate:(c>(ma20||0)&&c>(ma50||0))?1:0,
    LongTrend:(c>(ma20||0)&&c>(ma50||0)&&c>(ma200||0))?1:0,
    Bullish_MACD:macd&&macd.macd>macd.signal&&macd.histogram>0?1:0,Bearish_MACD:macd&&macd.macd<macd.signal&&macd.histogram<0?1:0,
    MACDCross:0,BullishWeak_MACD:macd&&macd.macd>macd.signal&&macd.histogram<0?1:0,
    PER:(fund&&fund.per)||0,PBV:(fund&&fund.pbv)||0,ROE:(fund&&fund.roe)||0,MktCap:(fund&&fund.mkt_cap)||0,
    PnlPct:0,DaysHeld:0,EntryPrice:0,
  };
}

// ═══ MAIN BACKTEST ═══
router.post('/run', (req, res) => {
  const t0 = Date.now();
  try {
    const entryF = (req.body.formula || '').trim();
    const exitF = (req.body.exit_formula || '').trim();
    if (!entryF) return res.json({ error: 'No entry formula' });
    if (!exitF) return res.json({ error: 'No exit formula. Use e.g.: Bearish_MACD OR DaysHeld >= 10' });
    const eTk = tokenize(entryF); if (eTk.error) return res.json({ error: 'Entry: ' + eTk.error });
    const xTk = tokenize(exitF); if (xTk.error) return res.json({ error: 'Exit: ' + xTk.error });

    const maxPos = Math.max(1, Math.min(parseInt(req.body.max_positions) || 5, 30));
    const startDate = req.body.start_date || '';
    const endDate = req.body.end_date || '';
    const initCap = parseFloat(req.body.capital) || 100000000;

    // Scope filter
    const scopeType = req.body.scope_type || 'all'; // all, stock, sector, industry
    const scopeValue = (req.body.scope_value || '').toUpperCase().trim();

    // Lot sizing: fixed equal weight per position
    const lotMethod = req.body.lot_method || 'equal';

    // Force cutloss: safety net independent of exit formula
    const forceCutloss = req.body.force_cutloss === true || req.body.force_cutloss === 'true';
    const cutlossPct = parseFloat(req.body.cutloss_pct) || -10; // e.g. -10 means -10%

    // Max DD reduce: when portfolio DD exceeds threshold, reduce positions
    const maxDDReduce = req.body.max_dd_reduce === true || req.body.max_dd_reduce === 'true';
    const maxDDPct = Math.abs(parseFloat(req.body.max_dd_pct) || 10);

    // Risk Control: freeze + CL + cooldown + probe
    const riskControl = req.body.risk_control === true || req.body.risk_control === 'true';
    const rcDDFreeze = Math.abs(parseFloat(req.body.rc_dd_freeze) || 10);
    const rcCLFreeze = Math.max(1, parseInt(req.body.rc_cl_freeze) || 3);
    const rcCooldown = Math.max(1, parseInt(req.body.rc_cooldown) || 10);
    const rcProbePos = Math.max(1, parseInt(req.body.rc_probe_pos) || 1);
    const rcLiquidate = req.body.rc_liquidate === true || req.body.rc_liquidate === 'true';

    // Risk state machine
    let rcMode = 'normal'; // normal | freeze | probe
    let rcConsecLoss = 0;
    let rcFreezeStart = -1; // day index when freeze started
    let rcFreezeCount = 0; // total freeze events
    let rcProbeCount = 0; // times entered probe

    // Benchmark: can be index code or stock code
    const benchmark = (req.body.benchmark || 'COMPOSITE').toUpperCase().trim();

    // Dates
    let allDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
    const fullDates = [...allDates];
    if (startDate) allDates = allDates.filter(d => d >= startDate);
    if (endDate) allDates = allDates.filter(d => d <= endDate);
    if (allDates.length < 5) return res.json({ error: 'Need at least 5 trade dates in range' });

    // Pre-compute allDates index map
    const adMap = {}; allDates.forEach((d, i) => { adMap[d] = i; });

    const caMap = loadCAs();
    const { latestFundDate } = require('../db');
    const fm = latestFundDate();
    const fundMap = {};
    if (fm) db.prepare('SELECT * FROM idx_fundamental WHERE snapshot_month=?').all(fm).forEach(f => { fundMap[f.code] = f; });

    // Determine which codes to test based on scope
    let scopeCodes = null; // null = all
    let scoreUniverse = null; // for score_top: { date → Set of codes }
    if (scopeType === 'stock' && scopeValue) {
      scopeCodes = new Set(scopeValue.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));
      if (scopeCodes.size === 0) scopeCodes = null;
    } else if (scopeType === 'sector' && scopeValue && fm) {
      const sectorRows = db.prepare('SELECT code FROM idx_fundamental WHERE snapshot_month=? AND UPPER(sector)=?').all(fm, scopeValue);
      if (sectorRows.length) scopeCodes = new Set(sectorRows.map(r => r.code));
      else return res.json({ error: 'Sector not found: ' + scopeValue + '. Check available sectors.' });
    } else if (scopeType === 'industry' && scopeValue && fm) {
      const indRows = db.prepare('SELECT code FROM idx_fundamental WHERE snapshot_month=? AND UPPER(industry)=?').all(fm, scopeValue);
      if (indRows.length) scopeCodes = new Set(indRows.map(r => r.code));
      else return res.json({ error: 'Industry not found: ' + scopeValue + '. Check available industries.' });
    } else if (scopeType === 'score_top' && scopeValue) {
      // Dynamic universe: top N scored stocks per date
      const topN = parseInt(scopeValue) || 20;
      scoreUniverse = {};
      const scoreRows = db.prepare('SELECT calc_date, code FROM daily_scores WHERE calc_date>=? AND calc_date<=? ORDER BY calc_date, score_composite DESC').all(allDates[0], allDates[allDates.length - 1]);
      let curDate = '', count = 0;
      scoreRows.forEach(r => {
        if (r.calc_date !== curDate) { curDate = r.calc_date; count = 0; }
        count++;
        if (count <= topN) {
          if (!scoreUniverse[r.calc_date]) scoreUniverse[r.calc_date] = new Set();
          scoreUniverse[r.calc_date].add(r.code);
        }
      });
      // scopeCodes = union of all dates (for loading history)
      const allScoreCodes = new Set();
      Object.values(scoreUniverse).forEach(s => s.forEach(c => allScoreCodes.add(c)));
      if (allScoreCodes.size === 0) return res.json({ error: 'No scores found. Run Backfill first in Scoring tab.' });
      scopeCodes = allScoreCodes;
    } else if ((scopeType === 'sector' || scopeType === 'industry') && !scopeValue) {
      return res.json({ error: 'Please enter a ' + scopeType + ' name in the scope field' });
    }

    // Load history
    const lb = 210;
    const minDate = fullDates[Math.max(0, fullDates.indexOf(allDates[0]) - lb)] || allDates[0];
    const hbc = {}; // histByCode
    let query = 'SELECT code,trade_date,open_price,high,low,close,volume,value,frequency,foreign_buy,foreign_sell FROM idx_daily WHERE trade_date>=? AND close>0';
    let params = [minDate];
    if (scopeCodes && scopeCodes.size <= 50) {
      const codes = [...scopeCodes];
      query += ' AND code IN (' + codes.map(() => '?').join(',') + ')';
      params.push(...codes);
    }
    query += ' ORDER BY code,trade_date';
    const rows = db.prepare(query).all(...params);

    for (const r of rows) {
      if (scopeCodes && !scopeCodes.has(r.code)) continue;
      if (!hbc[r.code]) hbc[r.code] = [];
      const a = caMap[r.code];
      r.ac = a ? adjP(r.close, r.trade_date, a) : r.close;
      r.ah = a ? adjP(r.high || r.close, r.trade_date, a) : (r.high || r.close);
      r.al = a ? adjP(r.low || r.close, r.trade_date, a) : (r.low || r.close);
      hbc[r.code].push(r);
    }

    const dIdx = {};
    for (const code of Object.keys(hbc)) {
      dIdx[code] = {};
      hbc[code].forEach((r, i) => { dIdx[code][r.trade_date] = i; });
    }

    // ═══ SIMULATION ═══
    const trades = [];
    const openPos = [];
    const equity = [];
    let cap = initCap;
    let peak = initCap;
    let maxDD = 0;
    let dReturns = [];
    let daysExp = 0;
    let prevDD = 0; // previous day's drawdown % for max DD reduce

    // Benchmark: try idx_indices first, then idx_daily (for single stock benchmark)
    let benchData = db.prepare('SELECT trade_date,close FROM idx_indices WHERE index_code=? AND trade_date>=? ORDER BY trade_date').all(benchmark, allDates[0]);
    if (!benchData.length) {
      // Try as stock code
      benchData = db.prepare('SELECT trade_date,close FROM idx_daily WHERE code=? AND trade_date>=? ORDER BY trade_date').all(benchmark, allDates[0]);
    }
    const bMap = {};
    benchData.forEach(r => { bMap[r.trade_date] = r.close; });
    const bStart = bMap[allDates[0]] || 0;

    for (let di = 0; di < allDates.length; di++) {
      const td = allDates[di];
      const prevEq = cap + openPos.reduce((s, p) => {
        const i = dIdx[p.code] ? dIdx[p.code][td] : -1;
        return s + (i >= 0 ? hbc[p.code][i].ac * p.shares : p.ep * p.shares);
      }, 0);

      // ── Exits ──
      for (let pi = openPos.length - 1; pi >= 0; pi--) {
        const pos = openPos[pi];
        const hist = hbc[pos.code];
        const idx = dIdx[pos.code] ? dIdx[pos.code][td] : -1;
        if (idx < 0 || !hist[idx]) continue;
        const cur = hist[idx].ac;
        const pnlP = (cur - pos.ep) / pos.ep * 100;
        const days = di - pos.edi;
        if (pnlP < pos.mae) pos.mae = pnlP;
        if (pnlP > pos.mfe) pos.mfe = pnlP;

        let reason = null;

        // Priority 1: Force cutloss (safety net)
        if (forceCutloss && pnlP <= cutlossPct) {
          reason = 'force_cutloss';
        }
        // Priority 2: Exit formula signal
        else if (days >= 1) {
          try {
            const ctx = buildCtx(hist, idx, fundMap[pos.code]);
            ctx.PnlPct = Math.round(pnlP * 100) / 100;
            ctx.DaysHeld = days;
            ctx.EntryPrice = pos.ep;
            const tk = tokenize(exitF);
            if (!tk.error && evalF(tk, ctx)) reason = 'exit_signal';
          } catch (e) { /* skip */ }
        }

        if (reason) {
          const pnl = (cur - pos.ep) * pos.shares;
          const posVal = pos.ep * pos.shares;
          cap += cur * pos.shares;
          trades.push({
            code: pos.code, type: 'Long', ed: pos.ed, ep: pos.ep, xd: td, xp: cur,
            shares: pos.shares, pv: Math.round(posVal),
            pnl: Math.round(pnl), pnlP: Math.round(pnlP * 100) / 100,
            bars: days, ppb: days > 0 ? Math.round(pnlP / days * 100) / 100 : 0,
            reason, mae: Math.round(pos.mae * 100) / 100, mfe: Math.round(pos.mfe * 100) / 100,
          });
          openPos.splice(pi, 1);

          // ── Risk Control: track consecutive losses ──
          if (riskControl) {
            if (pnl > 0) { rcConsecLoss = 0; if (rcMode === 'probe') { rcMode = 'normal'; } }
            else { rcConsecLoss++; }
          }
        }
      }

      // ── Risk Control: check freeze triggers ──
      let justFroze = false;
      if (riskControl && rcMode === 'normal') {
        if (rcConsecLoss >= rcCLFreeze) { rcMode = 'freeze'; rcFreezeStart = di; rcFreezeCount++; justFroze = true; }
        else if (prevDD >= rcDDFreeze) { rcMode = 'freeze'; rcFreezeStart = di; rcFreezeCount++; justFroze = true; }
      }
      if (riskControl && rcMode === 'probe' && !justFroze) {
        if (rcConsecLoss >= rcCLFreeze) { rcMode = 'freeze'; rcFreezeStart = di; rcFreezeCount++; justFroze = true; }
        else if (prevDD >= rcDDFreeze) { rcMode = 'freeze'; rcFreezeStart = di; rcFreezeCount++; justFroze = true; }
      }

      // ── Liquidate on freeze: force close all open positions ──
      if (justFroze && rcLiquidate && openPos.length > 0) {
        for (let pi = openPos.length - 1; pi >= 0; pi--) {
          const pos = openPos[pi];
          const hist = hbc[pos.code];
          const idx = dIdx[pos.code] ? dIdx[pos.code][td] : -1;
          const cur = (idx >= 0 && hist[idx]) ? hist[idx].ac : pos.ep;
          const pnl = (cur - pos.ep) * pos.shares;
          const pnlP = (cur - pos.ep) / pos.ep * 100;
          const days = di - pos.edi;
          const posVal = pos.ep * pos.shares;
          cap += cur * pos.shares;
          trades.push({
            code: pos.code, type: 'Long', ed: pos.ed, ep: pos.ep, xd: td, xp: cur,
            shares: pos.shares, pv: Math.round(posVal),
            pnl: Math.round(pnl), pnlP: Math.round(pnlP * 100) / 100,
            bars: days, ppb: days > 0 ? Math.round(pnlP / days * 100) / 100 : 0,
            reason: 'liquidate', mae: Math.round(pos.mae * 100) / 100, mfe: Math.round(pos.mfe * 100) / 100,
          });
          openPos.splice(pi, 1);
        }
      }

      // Check cooldown → transition to probe
      if (riskControl && rcMode === 'freeze' && rcFreezeStart >= 0 && (di - rcFreezeStart) >= rcCooldown) {
        rcMode = 'probe'; rcProbeCount++;
      }

      // ── Entries ──
      let effectiveMaxPos = maxPos;
      if (riskControl) {
        if (rcMode === 'freeze') effectiveMaxPos = 0;
        else if (rcMode === 'probe') effectiveMaxPos = rcProbePos;
      }
      if (effectiveMaxPos > 0 && openPos.length < effectiveMaxPos) {
        const slots = effectiveMaxPos - openPos.length;
        const cands = [];
        // Determine eligible codes for this date
        const dayUniverse = scoreUniverse ? scoreUniverse[td] : null;
        for (const code of Object.keys(hbc)) {
          if (openPos.find(p => p.code === code)) continue;
          // Score universe filter: only allow codes in top N for this date
          if (dayUniverse && !dayUniverse.has(code)) continue;
          const hist = hbc[code];
          const idx = dIdx[code] ? dIdx[code][td] : -1;
          if (idx < 0 || !hist[idx] || hist[idx].trade_date !== td) continue;
          try {
            const ctx = buildCtx(hist, idx, fundMap[code]);
            const tk = tokenize(entryF);
            if (!tk.error && evalF(tk, ctx)) cands.push({ code, price: hist[idx].ac, value: hist[idx].value || 0 });
          } catch (e) { /* skip */ }
        }
        cands.sort((a, b) => (b.value || 0) - (a.value || 0));
        for (const c of cands.slice(0, slots)) {
          const alloc = cap / Math.max(1, slots);
          const sh = Math.floor(Math.floor(alloc / c.price) / 100) * 100;
          const cost = sh * c.price;
          if (sh < 100 || cost > cap) continue;
          cap -= cost;
          openPos.push({ code: c.code, ed: td, ep: c.price, shares: sh, edi: di, mae: 0, mfe: 0 });
        }
      }

      if (openPos.length > 0) daysExp++;
      const totEq = cap + openPos.reduce((s, p) => {
        const i = dIdx[p.code] ? dIdx[p.code][td] : -1;
        return s + (i >= 0 ? hbc[p.code][i].ac * p.shares : p.ep * p.shares);
      }, 0);
      if (totEq > peak) peak = totEq;
      const dd = peak > 0 ? (peak - totEq) / peak * 100 : 0;
      if (dd > maxDD) maxDD = dd;
      prevDD = dd; // store for next day's max DD reduce check
      const dr = prevEq > 0 ? (totEq - prevEq) / prevEq : 0;
      dReturns.push(dr);
      const bv = bStart > 0 && bMap[td] ? bMap[td] / bStart * initCap : initCap;
      equity.push({ date: td, equity: Math.round(totEq), benchmark: Math.round(bv), drawdown: Math.round(dd * 100) / 100, positions: openPos.length });
    }

    // Separate open positions (still floating) from closed trades
    const lastD = allDates[allDates.length - 1];
    const openPositions = [];
    for (const pos of openPos) {
      const hist = hbc[pos.code];
      const idx = dIdx[pos.code] ? dIdx[pos.code][lastD] : -1;
      const cur = idx >= 0 ? hist[idx].ac : pos.ep;
      const pnlP = (cur - pos.ep) / pos.ep * 100;
      const days = allDates.length - 1 - pos.edi;
      openPositions.push({
        code: pos.code, ed: pos.ed, ep: pos.ep, current: cur,
        shares: pos.shares, pv: Math.round(pos.ep * pos.shares),
        unrealized: Math.round((cur - pos.ep) * pos.shares),
        pnlP: Math.round(pnlP * 100) / 100, bars: days,
        mae: Math.round((pos.mae || 0) * 100) / 100,
        mfe: Math.round((pos.mfe || 0) * 100) / 100,
      });
      // Also add to trades as 'open' for stats calculation
      trades.push({
        code: pos.code, type: 'Long', ed: pos.ed, ep: pos.ep, xd: lastD, xp: cur,
        shares: pos.shares, pv: Math.round(pos.ep * pos.shares),
        pnl: Math.round((cur - pos.ep) * pos.shares), pnlP: Math.round(pnlP * 100) / 100,
        bars: days, ppb: days > 0 ? Math.round(pnlP / days * 100) / 100 : 0,
        reason: 'open', mae: Math.round((pos.mae || 0) * 100) / 100, mfe: Math.round((pos.mfe || 0) * 100) / 100
      });
    }

    // ═══ STATS ═══
    const W = trades.filter(t => t.pnl > 0), L = trades.filter(t => t.pnl <= 0);
    const wr = trades.length ? Math.round(W.length / trades.length * 1000) / 10 : 0;
    const aw = W.length ? Math.round(W.reduce((s, t) => s + t.pnlP, 0) / W.length * 100) / 100 : 0;
    const al = L.length ? Math.round(L.reduce((s, t) => s + t.pnlP, 0) / L.length * 100) / 100 : 0;
    const totPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const totRet = Math.round(totPnl / initCap * 10000) / 100;
    const exp = trades.length ? Math.round((wr / 100 * aw + (1 - wr / 100) * al) * 100) / 100 : 0;
    const gp = W.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(L.reduce((s, t) => s + t.pnl, 0));
    const pf = gl > 0 ? Math.round(gp / gl * 100) / 100 : gp > 0 ? 999 : 0;
    const avgDR = dReturns.length ? dReturns.reduce((s, v) => s + v, 0) / dReturns.length : 0;
    const stdDR = dReturns.length > 1 ? Math.sqrt(dReturns.reduce((s, v) => s + Math.pow(v - avgDR, 2), 0) / (dReturns.length - 1)) : 0;
    const sharpe = stdDR > 0 ? Math.round(avgDR / stdDR * Math.sqrt(252) * 100) / 100 : 0;
    const bEnd = bMap[lastD] || bStart;
    const bRet = bStart > 0 ? Math.round((bEnd - bStart) / bStart * 10000) / 100 : 0;
    const exposure = allDates.length > 0 ? Math.round(daysExp / allDates.length * 1000) / 10 : 0;
    const years = allDates.length / 252;
    const finalEq = equity.length ? equity[equity.length - 1].equity : initCap;
    const annRet = years > 0.1 ? Math.round((Math.pow(finalEq / initCap, 1 / years) - 1) * 10000) / 100 : totRet;
    const rar = exposure > 0 ? Math.round(annRet / (exposure / 100) * 100) / 100 : 0;
    const carDD = maxDD > 0 ? Math.round(annRet / maxDD * 100) / 100 : 0;
    let mcW = 0, mcL = 0, cW = 0, cL = 0;
    trades.forEach(t => { if (t.pnl > 0) { cW++; cL = 0; if (cW > mcW) mcW = cW; } else { cL++; cW = 0; if (cL > mcL) mcL = cL; } });
    const lW = W.length ? Math.round(Math.max(...W.map(t => t.pnlP)) * 100) / 100 : 0;
    const lL = L.length ? Math.round(Math.min(...L.map(t => t.pnlP)) * 100) / 100 : 0;
    const ahW = W.length ? Math.round(W.reduce((s, t) => s + t.bars, 0) / W.length * 10) / 10 : 0;
    const ahL = L.length ? Math.round(L.reduce((s, t) => s + t.bars, 0) / L.length * 10) / 10 : 0;
    const payoff = al !== 0 ? Math.round(Math.abs(aw / al) * 100) / 100 : 0;
    const avgH = trades.length ? Math.round(trades.reduce((s, t) => s + t.bars, 0) / trades.length * 10) / 10 : 0;

    // NEW: Recovery Factor = Net Profit / Max DD$
    const maxDD$ = maxDD > 0 ? Math.round(peak * maxDD / 100) : 0;
    const recoveryFactor = maxDD$ > 0 ? Math.round(totPnl / maxDD$ * 100) / 100 : 0;
    // RAR/MaxDD
    const rarMaxDD = maxDD > 0 ? Math.round(rar / maxDD * 100) / 100 : 0;
    // Standard Error of equity
    const stdErr = dReturns.length > 1 ? Math.round(stdDR * Math.sqrt(dReturns.length) * initCap / 100) : 0;
    // Max trade drawdown
    const maxTradeDD$ = trades.length ? Math.round(Math.min(...trades.map(t => t.pnl))) : 0;
    const maxTradeDDpct = trades.length ? Math.round(Math.min(...trades.map(t => t.pnlP)) * 100) / 100 : 0;
    // Avg profit/loss per trade (absolute)
    const avgPL = trades.length ? Math.round(totPnl / trades.length) : 0;
    const avgPLpct = trades.length ? Math.round(trades.reduce((s,t) => s + t.pnlP, 0) / trades.length * 100) / 100 : 0;

    // Cumulative profit on trades
    let cumPnl = 0;
    trades.forEach(t => { cumPnl += t.pnl; t.cumPnl = Math.round(cumPnl); });

    // By ticker
    const byT = {};
    trades.forEach(t => { if (!byT[t.code]) byT[t.code] = { code: t.code, trades: 0, wins: 0, pnl: 0 }; byT[t.code].trades++; if (t.pnl > 0) byT[t.code].wins++; byT[t.code].pnl += t.pnl; });

    // ═══ MONTE CARLO (enhanced with equity curve bands) ═══
    let mc = null;
    if (trades.length >= 10) {
      const mcN = 500, mcR = [];
      const tPnls = trades.map(t => t.pnl);
      const mcCurves = []; // store equity curves for band chart
      for (let r = 0; r < mcN; r++) {
        const sh = [...tPnls]; for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
        let eq = initCap, pk = eq, mdd = 0, low = eq;
        const curve = [initCap];
        for (const p of sh) { eq += p; if (eq > pk) pk = eq; const dd = pk > 0 ? (pk - eq) / pk * 100 : 0; if (dd > mdd) mdd = dd; if (eq < low) low = eq; curve.push(Math.round(eq)); }
        const ar = years > 0.1 ? Math.round((Math.pow(eq / initCap, 1 / years) - 1) * 10000) / 100 : 0;
        mcR.push({ fe: Math.round(eq), ar, mdd: Math.round(mdd * 100) / 100, low: Math.round(low) });
        mcCurves.push(curve);
      }
      mcR.sort((a, b) => a.fe - b.fe);
      const pct = (p) => mcR[Math.min(Math.floor(p / 100 * mcR.length), mcR.length - 1)];
      // Build band data: at each trade#, get min/median/max equity
      const bandLen = tPnls.length + 1;
      const bands = [];
      for (let i = 0; i < bandLen; i++) {
        const vals = mcCurves.map(c => c[i] || initCap).sort((a, b) => a - b);
        bands.push({ min: vals[0], p25: vals[Math.floor(vals.length * 0.25)], med: vals[Math.floor(vals.length * 0.5)], p75: vals[Math.floor(vals.length * 0.75)], max: vals[vals.length - 1] });
      }
      mc = { runs: mcN, p: { p1: pct(1), p5: pct(5), p10: pct(10), p25: pct(25), p50: pct(50), p75: pct(75), p90: pct(90), p95: pct(95), p99: pct(99) }, bands: bands.length > 200 ? bands.filter((_, i) => i % Math.ceil(bands.length / 200) === 0 || i === bands.length - 1) : bands };
    }

    // Available sectors/industries for scope dropdown
    const sectors = fm ? db.prepare("SELECT DISTINCT sector FROM idx_fundamental WHERE snapshot_month=? AND sector!='' AND sector IS NOT NULL ORDER BY sector").all(fm).map(r => r.sector) : [];
    const industries = fm ? db.prepare("SELECT DISTINCT industry FROM idx_fundamental WHERE snapshot_month=? AND industry!='' AND industry IS NOT NULL ORDER BY industry").all(fm).map(r => r.industry) : [];

    // ═══ BASELINE COMPARISON — when score_top, auto-run with scope=all ═══
    let baseline = null;
    if (scopeType === 'score_top' && trades.length > 0) {
      try {
        // Quick baseline: same params but scope=all, no MC
        const blTrades = [];
        const blOpenPos = [];
        let blCap = initCap;
        let blPeak = initCap;
        let blMaxDD = 0;

        for (let di = 0; di < allDates.length; di++) {
          const td = allDates[di];
          // Exits
          for (let pi = blOpenPos.length - 1; pi >= 0; pi--) {
            const pos = blOpenPos[pi];
            const hist = hbc[pos.code];
            const idx = dIdx[pos.code] ? dIdx[pos.code][td] : -1;
            if (idx < 0 || !hist[idx]) continue;
            const cur = hist[idx].ac;
            const pnlP = (cur - pos.ep) / pos.ep * 100;
            const days = di - pos.edi;
            let reason = null;
            if (forceCutloss && pnlP <= cutlossPct) reason = 'force_cutloss';
            else if (days >= 1) {
              try { const ctx = buildCtx(hist, idx, fundMap[pos.code]); ctx.PnlPct = Math.round(pnlP * 100) / 100; ctx.DaysHeld = days; ctx.EntryPrice = pos.ep; const tk = tokenize(exitF); if (!tk.error && evalF(tk, ctx)) reason = 'exit_signal'; } catch (e) {}
            }
            if (reason) {
              blCap += cur * pos.shares;
              blTrades.push({ pnl: Math.round((cur - pos.ep) * pos.shares), pnlP: Math.round(pnlP * 100) / 100 });
              blOpenPos.splice(pi, 1);
            }
          }
          // Entries — NO scoreUniverse filter (all stocks)
          if (blOpenPos.length < maxPos) {
            const slots = maxPos - blOpenPos.length;
            const cands = [];
            for (const code of Object.keys(hbc)) {
              if (blOpenPos.find(p => p.code === code)) continue;
              const hist = hbc[code];
              const idx = dIdx[code] ? dIdx[code][td] : -1;
              if (idx < 0 || !hist[idx] || hist[idx].trade_date !== td) continue;
              try { const ctx = buildCtx(hist, idx, fundMap[code]); const tk = tokenize(entryF); if (!tk.error && evalF(tk, ctx)) cands.push({ code, price: hist[idx].ac, value: hist[idx].value || 0 }); } catch (e) {}
            }
            cands.sort((a, b) => (b.value || 0) - (a.value || 0));
            for (const c of cands.slice(0, slots)) {
              const alloc = blCap / Math.max(1, slots);
              const sh = Math.floor(Math.floor(alloc / c.price) / 100) * 100;
              if (sh <= 0) continue;
              blCap -= sh * c.price;
              blOpenPos.push({ code: c.code, ep: c.price, shares: sh, ed: td, edi: di });
            }
          }
          // Track DD
          const blEq = blCap + blOpenPos.reduce((s, p) => { const i = dIdx[p.code] ? dIdx[p.code][td] : -1; return s + (i >= 0 ? hbc[p.code][i].ac * p.shares : p.ep * p.shares); }, 0);
          if (blEq > blPeak) blPeak = blEq;
          const dd = blPeak > 0 ? (blPeak - blEq) / blPeak * 100 : 0;
          if (dd > blMaxDD) blMaxDD = dd;
        }
        // Close remaining
        const lastD2 = allDates[allDates.length - 1];
        blOpenPos.forEach(p => { const idx = dIdx[p.code] ? dIdx[p.code][lastD2] : -1; const cur = idx >= 0 ? hbc[p.code][idx].ac : p.ep; blCap += cur * p.shares; blTrades.push({ pnl: Math.round((cur - p.ep) * p.shares), pnlP: Math.round((cur - p.ep) / p.ep * 10000) / 100 }); });

        const blFinalEq = Math.round(blCap);
        const blTotRet = Math.round((blFinalEq / initCap - 1) * 10000) / 100;
        const blW = blTrades.filter(t => t.pnl > 0);
        const blWr = blTrades.length ? Math.round(blW.length / blTrades.length * 1000) / 10 : 0;
        const blAvgW = blW.length ? Math.round(blW.reduce((s, t) => s + t.pnlP, 0) / blW.length * 100) / 100 : 0;
        const blL = blTrades.filter(t => t.pnl <= 0);
        const blAvgL = blL.length ? Math.round(blL.reduce((s, t) => s + t.pnlP, 0) / blL.length * 100) / 100 : 0;
        const blGP = blW.reduce((s, t) => s + t.pnl, 0);
        const blGL = Math.abs(blL.reduce((s, t) => s + t.pnl, 0));
        const blPF = blGL > 0 ? Math.round(blGP / blGL * 100) / 100 : 0;
        const blAvgPL = blTrades.length ? Math.round(blTrades.reduce((s, t) => s + t.pnlP, 0) / blTrades.length * 100) / 100 : 0;
        const blExp = blTrades.length ? Math.round((blWr / 100 * blAvgW + (1 - blWr / 100) * blAvgL) * 100) / 100 : 0;

        baseline = {
          total_trades: blTrades.length, win_rate: blWr, total_return: blTotRet,
          final_equity: blFinalEq, max_drawdown: Math.round(blMaxDD * 100) / 100,
          profit_factor: blPF, avg_pl_pct: blAvgPL, expectancy: blExp,
          scope: 'All Stocks'
        };
      } catch (blErr) { /* baseline failed, skip */ }
    }

    res.json({
      stats: { total_trades: trades.length, win_rate: wr, wins_count: W.length, losses_count: L.length,
        avg_win: aw, avg_loss: al, expectancy: exp, profit_factor: pf, sharpe,
        max_drawdown: Math.round(maxDD * 100) / 100, total_return: totRet, benchmark_return: bRet,
        alpha: Math.round((totRet - bRet) * 100) / 100, avg_hold: avgH, initial_capital: initCap, final_equity: finalEq,
        exposure, annual_return: annRet, rar, car_maxdd: carDD,
        max_consec_wins: mcW, max_consec_losses: mcL, largest_win: lW, largest_loss: lL,
        avg_hold_win: ahW, avg_hold_loss: ahL, payoff_ratio: payoff,
        gross_profit: Math.round(gp), gross_loss: Math.round(gl),
        recovery_factor: recoveryFactor, rar_maxdd: rarMaxDD,
        std_error: stdErr, max_trade_dd: maxTradeDD$, max_trade_dd_pct: maxTradeDDpct,
        avg_pl: avgPL, avg_pl_pct: avgPLpct },
      trades: trades.filter(t => t.reason !== 'open').slice(-500),
      open_positions: openPositions,
      equity: equity.length > 600 ? equity.filter((_, i) => i % Math.ceil(equity.length / 600) === 0 || i === equity.length - 1) : equity,
      by_ticker: Object.values(byT).sort((a, b) => b.pnl - a.pnl).slice(0, 30),
      monte_carlo: mc,
      period: { start: allDates[0], end: lastD, days: allDates.length },
      benchmark, formula: entryF, exit_formula: exitF,
      params: { max_positions: maxPos, scope_type: scopeType, scope_value: scopeValue, lot_method: lotMethod, force_cutloss: forceCutloss, cutloss_pct: cutlossPct,
        risk_control: riskControl, rc_dd_freeze: -rcDDFreeze, rc_cl_freeze: rcCLFreeze, rc_cooldown: rcCooldown, rc_probe_pos: rcProbePos, rc_liquidate: rcLiquidate,
        rc_stats: riskControl ? { freeze_count: rcFreezeCount, probe_count: rcProbeCount, final_mode: rcMode, final_consec_loss: rcConsecLoss } : null },
      scope_options: { sectors, industries },
      baseline,
      compute_time: Date.now() - t0
    });
  } catch (e) { console.error('BT error:', e); res.json({ error: e.message }); }
});

// ═══ FORMULA REFERENCE ═══
router.get('/variables', (req, res) => {
  res.json({ variables: [
    { cat: 'Price', vars: ['C / Close', 'O / Open', 'H / High', 'L / Low', 'Chg (% change)'] },
    { cat: 'Volume', vars: ['V / Volume', 'Val / Value (Rp)', 'Freq (frequency)', 'DVMil (value in millions)', 'RelVol (vs 20d avg)'] },
    { cat: 'Moving Avg', vars: ['MA5', 'MA10', 'MA20', 'MA50', 'MA100', 'MA200', 'DistMA5..DistMA200 (% from MA)'] },
    { cat: 'MA Position', vars: ['Up_MA5..Up_MA50 (1 if above)', 'ShortTrend (C>MA10 & C>MA20)', 'Intermediate (C>MA20 & C>MA50)', 'LongTrend (C>MA20 & MA50 & MA200)'] },
    { cat: 'MACD', vars: ['MACD', 'Signal', 'MACD_Hist', 'Bullish_MACD (1/0)', 'Bearish_MACD (1/0)', 'BullishWeak_MACD', 'MACDCross'] },
    { cat: 'Stochastic', vars: ['K / StochK', 'D / StochD'] },
    { cat: 'Foreign Flow', vars: ['ForeignNet (Rp)', 'ForeignBuy (Rp)', 'ForeignSell (Rp)', 'Foreign_5D (5-day net Rp)'] },
    { cat: 'Range', vars: ['HHV20 (20d high)', 'LLV20 (20d low)'] },
    { cat: 'Freq Analysis', vars: ['TickRatio (val/tx vs avg)', 'RelFreq (freq vs 20d avg)', 'isBlockTrade (0/1)', 'isRetailFrenzy (0/1)', 'isSmartAccum (0/1)', 'isDryUp (0/1)'] },
    { cat: 'Fundamental', vars: ['PER', 'PBV', 'ROE', 'MktCap'] },
    { cat: 'Exit Only', vars: ['PnlPct (current P&L %)', 'DaysHeld (bars since entry)', 'EntryPrice'] },
    { cat: 'Logic', vars: ['AND', 'OR', '> < >= <= == !=', '( ) for grouping'] },
  ]});
});

// ═══ SCOPE OPTIONS ═══
router.get('/scopes', (req, res) => {
  try {
    const { latestFundDate } = require('../db');
    const fm = latestFundDate();
    const sectors = fm ? db.prepare("SELECT DISTINCT sector FROM idx_fundamental WHERE snapshot_month=? AND sector!='' AND sector IS NOT NULL ORDER BY sector").all(fm).map(r => r.sector) : [];
    const industries = fm ? db.prepare("SELECT DISTINCT industry FROM idx_fundamental WHERE snapshot_month=? AND industry!='' AND industry IS NOT NULL ORDER BY industry").all(fm).map(r => r.industry) : [];
    res.json({ sectors, industries });
  } catch (e) { console.error('Scopes error:', e.message); res.json({ sectors: [], industries: [], error: e.message }); }
});

router.get('/dates', (req, res) => {
  try { const d = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date); res.json({ dates: d, total: d.length, first: d[0] || '', last: d[d.length - 1] || '' }); }
  catch { res.json({ dates: [], total: 0 }); }
});

// ═══ WALK FORWARD ENGINE (P2 Sprint 13) ═══

// Helper: run a simplified backtest on a date window, return { return_pct, trades, win_rate, profit_factor, max_dd }
function runSimWindow(hbc, dIdx, fundMap, allDates, windowStart, windowEnd, entryF, exitF, maxPos, initCap, forceCutloss, cutlossPct) {
  const dates = allDates.filter(d => d >= windowStart && d <= windowEnd);
  if (dates.length < 3) return null;
  const trades = [];
  const openPos = [];
  let cap = initCap, peak = initCap, maxDD = 0;

  for (let di = 0; di < dates.length; di++) {
    const td = dates[di];
    // Exits
    for (let pi = openPos.length - 1; pi >= 0; pi--) {
      const pos = openPos[pi];
      const hist = hbc[pos.code]; if (!hist) continue;
      const idx = dIdx[pos.code] ? dIdx[pos.code][td] : -1;
      if (idx < 0 || !hist[idx]) continue;
      const cur = hist[idx].ac;
      const pnlP = (cur - pos.ep) / pos.ep * 100;
      const days = di - pos.edi;
      let reason = null;
      if (forceCutloss && pnlP <= cutlossPct) reason = 'cutloss';
      else if (days >= 1) {
        try { const ctx = buildCtx(hist, idx, fundMap[pos.code]); ctx.PnlPct = Math.round(pnlP * 100) / 100; ctx.DaysHeld = days; ctx.EntryPrice = pos.ep; const tk = tokenize(exitF); if (!tk.error && evalF(tk, ctx)) reason = 'exit'; } catch {}
      }
      if (reason) {
        cap += cur * pos.shares;
        trades.push({ pnl: (cur - pos.ep) * pos.shares, pnlP: Math.round(pnlP * 100) / 100 });
        openPos.splice(pi, 1);
      }
    }
    // Entries
    const slots = maxPos - openPos.length;
    if (slots > 0) {
      const cands = [];
      for (const code of Object.keys(hbc)) {
        if (openPos.some(p => p.code === code)) continue;
        const hist = hbc[code];
        const idx = dIdx[code] ? dIdx[code][td] : -1;
        if (idx < 0 || !hist[idx] || hist[idx].trade_date !== td) continue;
        try { const ctx = buildCtx(hist, idx, fundMap[code]); const tk = tokenize(entryF); if (!tk.error && evalF(tk, ctx)) cands.push({ code, price: hist[idx].ac, value: hist[idx].value || 0 }); } catch {}
      }
      cands.sort((a, b) => (b.value || 0) - (a.value || 0));
      for (const c of cands.slice(0, slots)) {
        const alloc = cap / Math.max(1, slots);
        const sh = Math.floor(Math.floor(alloc / c.price) / 100) * 100;
        if (sh < 100 || sh * c.price > cap) continue;
        cap -= sh * c.price;
        openPos.push({ code: c.code, ep: c.price, shares: sh, edi: di });
      }
    }
    // Equity
    const totEq = cap + openPos.reduce((s, p) => { const i = dIdx[p.code] ? dIdx[p.code][td] : -1; return s + (i >= 0 ? hbc[p.code][i].ac * p.shares : p.ep * p.shares); }, 0);
    if (totEq > peak) peak = totEq;
    const dd = peak > 0 ? (peak - totEq) / peak * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }
  // Close remaining
  const lastD = dates[dates.length - 1];
  for (const pos of openPos) {
    const hist = hbc[pos.code]; if (!hist) continue;
    const idx = dIdx[pos.code] ? dIdx[pos.code][lastD] : -1;
    const cur = idx >= 0 ? hist[idx].ac : pos.ep;
    cap += cur * pos.shares;
    trades.push({ pnl: (cur - pos.ep) * pos.shares, pnlP: Math.round((cur - pos.ep) / pos.ep * 10000) / 100 });
  }
  const finalEq = cap;
  const retPct = Math.round((finalEq / initCap - 1) * 10000) / 100;
  const W = trades.filter(t => t.pnl > 0), L = trades.filter(t => t.pnl <= 0);
  const wr = trades.length ? Math.round(W.length / trades.length * 1000) / 10 : 0;
  const gp = W.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(L.reduce((s, t) => s + t.pnl, 0));
  const pf = gl > 0 ? Math.round(gp / gl * 100) / 100 : gp > 0 ? 999 : 0;
  const years = dates.length / 252;
  const annRet = years > 0.1 ? Math.round((Math.pow(Math.max(0.01, finalEq / initCap), 1 / years) - 1) * 10000) / 100 : retPct;
  return { return_pct: retPct, ann_return: annRet, trades: trades.length, win_rate: wr, profit_factor: pf, max_dd: Math.round(maxDD * 100) / 100, days: dates.length, start: dates[0], end: lastD };
}

// ── Mode 1: Formula Walk Forward ──
router.post('/walk-forward', (req, res) => {
  const t0 = Date.now();
  try {
    const entryF = (req.body.formula || '').trim();
    const exitF = (req.body.exit_formula || '').trim();
    if (!entryF || !exitF) return res.json({ error: 'Entry and exit formulas required' });
    const eTk = tokenize(entryF); if (eTk.error) return res.json({ error: 'Entry: ' + eTk.error });
    const xTk = tokenize(exitF); if (xTk.error) return res.json({ error: 'Exit: ' + xTk.error });

    const maxPos = Math.max(1, Math.min(parseInt(req.body.max_positions) || 5, 30));
    const initCap = parseFloat(req.body.capital) || 100000000;
    const isWindow = Math.max(20, parseInt(req.body.is_window) || 60);
    const oosWindow = Math.max(10, parseInt(req.body.oos_window) || 20);
    const stepSize = Math.max(5, parseInt(req.body.step_size) || 20);
    const forceCutloss = req.body.force_cutloss === true || req.body.force_cutloss === 'true';
    const cutlossPct = parseFloat(req.body.cutloss_pct) || -10;

    let allDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
    const startDate = req.body.start_date || '';
    const endDate = req.body.end_date || '';
    if (startDate) allDates = allDates.filter(d => d >= startDate);
    if (endDate) allDates = allDates.filter(d => d <= endDate);
    if (allDates.length < isWindow + oosWindow) return res.json({ error: 'Not enough data. Need ' + (isWindow + oosWindow) + ' days, have ' + allDates.length });

    // Load all history
    const caMap = loadCAs();
    const { latestFundDate } = require('../db');
    const fm = latestFundDate();
    const fundMap = {};
    if (fm) db.prepare('SELECT * FROM idx_fundamental WHERE snapshot_month=?').all(fm).forEach(f => { fundMap[f.code] = f; });

    const fullDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
    const lb = 210;
    const minDate = fullDates[Math.max(0, fullDates.indexOf(allDates[0]) - lb)] || allDates[0];
    const hbc = {};
    db.prepare('SELECT code,trade_date,open_price,high,low,close,volume,value,frequency,foreign_buy,foreign_sell FROM idx_daily WHERE trade_date>=? AND close>0 ORDER BY code,trade_date').all(minDate)
      .forEach(r => { if (!hbc[r.code]) hbc[r.code] = []; const a = caMap[r.code]; r.ac = a ? adjP(r.close, r.trade_date, a) : r.close; r.ah = a ? adjP(r.high || r.close, r.trade_date, a) : (r.high || r.close); r.al = a ? adjP(r.low || r.close, r.trade_date, a) : (r.low || r.close); hbc[r.code].push(r); });
    const dIdx = {};
    for (const code of Object.keys(hbc)) { dIdx[code] = {}; hbc[code].forEach((r, i) => { dIdx[code][r.trade_date] = i; }); }

    // Rolling windows
    const steps = [];
    let pos = 0;
    while (pos + isWindow + oosWindow <= allDates.length) {
      const isStart = allDates[pos];
      const isEnd = allDates[pos + isWindow - 1];
      const oosStart = allDates[pos + isWindow];
      const oosEnd = allDates[Math.min(pos + isWindow + oosWindow - 1, allDates.length - 1)];

      const isResult = runSimWindow(hbc, dIdx, fundMap, allDates, isStart, isEnd, entryF, exitF, maxPos, initCap, forceCutloss, cutlossPct);
      const oosResult = runSimWindow(hbc, dIdx, fundMap, allDates, oosStart, oosEnd, entryF, exitF, maxPos, initCap, forceCutloss, cutlossPct);

      steps.push({
        step: steps.length + 1,
        is: isResult, oos: oosResult,
        wfe: isResult && oosResult && isResult.ann_return > 0 ? Math.round(oosResult.ann_return / isResult.ann_return * 10000) / 100 : 0
      });
      pos += stepSize;
    }

    // Aggregate
    const validSteps = steps.filter(s => s.oos);
    const avgOOS = validSteps.length ? Math.round(validSteps.reduce((s, st) => s + st.oos.return_pct, 0) / validSteps.length * 100) / 100 : 0;
    const avgIS = validSteps.length ? Math.round(validSteps.reduce((s, st) => s + (st.is ? st.is.return_pct : 0), 0) / validSteps.length * 100) / 100 : 0;
    const avgWFE = validSteps.length ? Math.round(validSteps.reduce((s, st) => s + st.wfe, 0) / validSteps.length * 100) / 100 : 0;
    const oosWinRate = validSteps.length ? Math.round(validSteps.filter(s => s.oos.return_pct > 0).length / validSteps.length * 1000) / 10 : 0;

    let verdict = 'overfit';
    if (avgWFE > 50) verdict = 'robust';
    else if (avgWFE > 30) verdict = 'borderline';

    res.json({
      ok: true, mode: 'formula',
      params: { is_window: isWindow, oos_window: oosWindow, step_size: stepSize, formula: entryF, exit_formula: exitF, max_positions: maxPos },
      steps, total_steps: steps.length,
      summary: { avg_is_return: avgIS, avg_oos_return: avgOOS, avg_wfe: avgWFE, oos_win_rate: oosWinRate, verdict },
      compute_time: Date.now() - t0
    });
  } catch (e) { res.json({ error: e.message }); }
});

// ── Mode 2: Scoring Weights Walk Forward ──
router.post('/walk-forward-score', (req, res) => {
  const t0 = Date.now();
  try {
    const isWindow = Math.max(20, parseInt(req.body.is_window) || 60);
    const oosWindow = Math.max(10, parseInt(req.body.oos_window) || 20);
    const stepSize = Math.max(5, parseInt(req.body.step_size) || 20);
    const topN = Math.max(5, parseInt(req.body.top_n) || 20);

    // Get scored dates
    const scoreDates = db.prepare('SELECT DISTINCT calc_date FROM daily_scores ORDER BY calc_date').all().map(r => r.calc_date);
    if (scoreDates.length < isWindow + oosWindow) return res.json({ error: 'Not enough scored dates. Need ' + (isWindow + oosWindow) + ', have ' + scoreDates.length + '. Run Backfill first.' });

    // Weight grid for optimization (simplified: step=10, 5 factors summing to 100)
    const weightCombos = [];
    for (let f = 0; f <= 50; f += 10) {
      for (let v = 0; v <= 50 - f; v += 10) {
        for (let m = 0; m <= 40; m += 10) {
          for (let d = 0; d <= 40; d += 10) {
            const fr = 100 - f - v - m - d;
            if (fr >= 0 && fr <= 30) weightCombos.push({ fundamental: f, valuation: v, momentum: m, demand: d, foreign: fr });
          }
        }
      }
    }

    // Preload all scores
    const allScores = db.prepare('SELECT calc_date, code, score_fundamental, score_valuation, score_momentum, score_demand, score_foreign FROM daily_scores ORDER BY calc_date, code').all();
    const scoreByDate = {};
    allScores.forEach(r => { if (!scoreByDate[r.calc_date]) scoreByDate[r.calc_date] = []; scoreByDate[r.calc_date].push(r); });

    // Preload forward returns (close price next day / close price today - 1)
    const priceMap = {}; // code+date → close
    const tradeDates = db.prepare('SELECT DISTINCT trade_date FROM idx_daily ORDER BY trade_date').all().map(r => r.trade_date);
    const tdIdx = {}; tradeDates.forEach((d, i) => { tdIdx[d] = i; });

    // Load close prices for scored codes
    const scoredCodes = new Set(allScores.map(r => r.code));
    for (const code of scoredCodes) {
      db.prepare('SELECT trade_date, close FROM idx_daily WHERE code=? AND close>0 ORDER BY trade_date').all(code)
        .forEach(r => { priceMap[code + '_' + r.trade_date] = r.close; });
    }

    // Forward return helper
    function fwdReturn(code, date, horizon) {
      const di = tdIdx[date]; if (di === undefined) return null;
      const p0 = priceMap[code + '_' + date]; if (!p0) return null;
      const fi = Math.min(di + horizon, tradeDates.length - 1);
      const p1 = priceMap[code + '_' + tradeDates[fi]]; if (!p1) return null;
      return (p1 - p0) / p0 * 100;
    }

    // Rolling windows on score dates
    const steps = [];
    let pos = 0;
    while (pos + isWindow + oosWindow <= scoreDates.length) {
      const isDates = scoreDates.slice(pos, pos + isWindow);
      const oosDates = scoreDates.slice(pos + isWindow, pos + isWindow + oosWindow);

      // IS: find best weight combo by avg top-N forward 5d return (IC-like)
      let bestW = null, bestISret = -Infinity;
      for (const w of weightCombos) {
        let totalRet = 0, count = 0;
        for (const d of isDates) {
          const stocks = scoreByDate[d]; if (!stocks || !stocks.length) continue;
          // Compute composite score per weight
          const scored = stocks.map(s => ({
            code: s.code,
            composite: (s.score_fundamental || 0) * w.fundamental / 100 + (s.score_valuation || 0) * w.valuation / 100 +
                       (s.score_momentum || 0) * w.momentum / 100 + (s.score_demand || 0) * w.demand / 100 +
                       (s.score_foreign || 0) * w.foreign / 100
          })).sort((a, b) => b.composite - a.composite).slice(0, topN);
          // Avg forward return of top-N
          for (const s of scored) {
            const fr = fwdReturn(s.code, d, 5);
            if (fr !== null) { totalRet += fr; count++; }
          }
        }
        const avgRet = count > 0 ? totalRet / count : 0;
        if (avgRet > bestISret) { bestISret = avgRet; bestW = w; }
      }

      // OOS: apply bestW to OOS dates, measure top-N forward return
      let oosRet = 0, oosCount = 0;
      for (const d of oosDates) {
        const stocks = scoreByDate[d]; if (!stocks || !stocks.length) continue;
        const scored = stocks.map(s => ({
          code: s.code,
          composite: (s.score_fundamental || 0) * bestW.fundamental / 100 + (s.score_valuation || 0) * bestW.valuation / 100 +
                     (s.score_momentum || 0) * bestW.momentum / 100 + (s.score_demand || 0) * bestW.demand / 100 +
                     (s.score_foreign || 0) * bestW.foreign / 100
        })).sort((a, b) => b.composite - a.composite).slice(0, topN);
        for (const s of scored) {
          const fr = fwdReturn(s.code, d, 5);
          if (fr !== null) { oosRet += fr; oosCount++; }
        }
      }
      const avgOOS = oosCount > 0 ? Math.round(oosRet / oosCount * 100) / 100 : 0;
      const avgIS = Math.round(bestISret * 100) / 100;
      const wfe = avgIS > 0 ? Math.round(avgOOS / avgIS * 10000) / 100 : 0;

      steps.push({
        step: steps.length + 1,
        is_dates: { start: isDates[0], end: isDates[isDates.length - 1] },
        oos_dates: { start: oosDates[0], end: oosDates[oosDates.length - 1] },
        best_weights: bestW, is_avg_return: avgIS, oos_avg_return: avgOOS, wfe
      });
      pos += stepSize;
    }

    // Aggregate
    const avgWFE = steps.length ? Math.round(steps.reduce((s, st) => s + st.wfe, 0) / steps.length * 100) / 100 : 0;
    const avgOOSall = steps.length ? Math.round(steps.reduce((s, st) => s + st.oos_avg_return, 0) / steps.length * 100) / 100 : 0;
    const oosWinRate = steps.length ? Math.round(steps.filter(s => s.oos_avg_return > 0).length / steps.length * 1000) / 10 : 0;

    // Most frequently selected weights
    const wFreq = {};
    steps.forEach(s => { const k = JSON.stringify(s.best_weights); wFreq[k] = (wFreq[k] || 0) + 1; });
    const topWeights = Object.entries(wFreq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => ({ weights: JSON.parse(k), count: v }));

    let verdict = 'overfit';
    if (avgWFE > 50) verdict = 'robust';
    else if (avgWFE > 30) verdict = 'borderline';

    res.json({
      ok: true, mode: 'scoring',
      params: { is_window: isWindow, oos_window: oosWindow, step_size: stepSize, top_n: topN, weight_combos_tested: weightCombos.length },
      steps, total_steps: steps.length,
      summary: { avg_oos_return: avgOOSall, avg_wfe: avgWFE, oos_win_rate: oosWinRate, verdict, top_weights: topWeights },
      compute_time: Date.now() - t0
    });
  } catch (e) { res.json({ error: e.message }); }
});

module.exports = router;