import { createClient } from '@libsql/client'

const client = createClient({ url: import.meta.resolve('@data/database.sqlite') })

const tables = [
  'broker_summary',
  'company_announcement', 
  'foreign_trading',
  'industry_trading',
  'market_calendar',
  'trading_ss',
  'trading_daily',
  'top_gainer',
  'top_loser',
  'sectoral_movement',
  'daily_index',
  'additional_listing',
  'new_listing',
  'right_offering',
  'company_suspend',
  'security_stock'
]

for (const name of tables) {
  try {
    const info = await client.execute('PRAGMA table_info("' + name + '")')
    const cols = info.rows.map(r => r.name).join(', ')
    const count = await client.execute('SELECT COUNT(*) as c FROM "' + name + '"')
    const c = count.rows[0]?.c || 0
    console.log(name + ' (' + c + ' rows): ' + cols)
    if (Number(c) > 0) {
      const sample = await client.execute('SELECT * FROM "' + name + '" LIMIT 1')
      if (sample.rows[0]) {
        const preview = Object.entries(sample.rows[0]).map(function(e) { return e[0] + '=' + String(e[1]).substring(0, 50) }).join(' | ')
        console.log('  -> ' + preview)
      }
    }
    console.log('')
  } catch(e) {
    console.log(name + ': ERROR ' + e.message)
    console.log('')
  }
}