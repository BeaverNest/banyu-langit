const D=require('/app/node_modules/better-sqlite3');const fs=require('fs');const db=new D('/app/data/trading.db',{readonly:true});
const f1=db.prepare('SELECT code, ex_date, factor FROM ca_factors ORDER BY code, ex_date').all();
fs.writeFileSync('/tmp/ca_factors.csv','code,ex_date,factor\n'+f1.map(r=>r.code+','+r.ex_date+','+r.factor).join('\n'));
const f2=db.prepare('SELECT trade_date, close FROM market_index_constructed ORDER BY trade_date').all();
fs.writeFileSync('/tmp/market_index_constructed.csv','trade_date,close\n'+f2.map(r=>r.trade_date+','+r.close).join('\n'));
console.log('ca',f1.length,'idx',f2.length);