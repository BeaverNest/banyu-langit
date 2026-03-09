const{db}=require('./server/db');
const snaps=db.prepare('SELECT DISTINCT snapshot_date FROM holdings ORDER BY snapshot_date DESC LIMIT 10').all();
const total=db.prepare('SELECT COUNT(*) as c FROM holdings').get();
console.log('Total rows:', total.c);
console.log('Snapshots:', snaps.map(s=>s.snapshot_date));
