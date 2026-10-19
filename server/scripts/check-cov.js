const D = require('/app/node_modules/better-sqlite3');
const db = new D('/app/data/trading.db', { readonly: true });
const q = (y) => db.prepare(`SELECT COUNT(*) n, SUM(CASE WHEN listed_shares>0 THEN 1 ELSE 0 END) ls, SUM(CASE WHEN prev_close>0 THEN 1 ELSE 0 END) pc FROM idx_daily WHERE trade_date>=? AND trade_date<?`).get(y + '-01-01', (parseInt(y) + 1) + '-01-01');
for (const y of ['2020', '2021', '2022', '2023', '2024', '2025', '2026']) console.log(y, JSON.stringify(q(y)));
