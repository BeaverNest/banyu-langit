import { createClient } from '@libsql/client'

const client = createClient({ url: import.meta.resolve('@data/database.sqlite') })

// List all tables and row counts
const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")

console.log('=== IDX-API Database ===\n')

for (const t of tables.rows) {
  const name = t.name as string
  if (name.startsWith('__') || name.startsWith('drizzle')) continue
  
  const count = await client.execute(`SELECT COUNT(*) as c FROM "${name}"`)
  const c = count.rows[0]?.c || 0
  
  if (Number(c) > 0) {
    // Show columns
    const info = await client.execute(`PRAGMA table_info("${name}")`)
    const cols = info.rows.map(r => r.name).join(', ')
    
    // Show 1 sample row
    const sample = await client.execute(`SELECT * FROM "${name}" LIMIT 1`)
    
    console.log(`✅ ${name}: ${c} rows`)
    console.log(`   Columns: ${cols}`)
    if (sample.rows[0]) {
      const s = sample.rows[0]
      const preview = Object.entries(s).map(([k,v]) => `${k}=${String(v).substring(0,40)}`).join(' | ')
      console.log(`   Sample: ${preview}`)
    }
    console.log('')
  }
}

console.log('=== Empty tables ===')
for (const t of tables.rows) {
  const name = t.name as string
  if (name.startsWith('__') || name.startsWith('drizzle')) continue
  const count = await client.execute(`SELECT COUNT(*) as c FROM "${name}"`)
  if (Number(count.rows[0]?.c || 0) === 0) process.stdout.write(name + '  ')
}
console.log('')