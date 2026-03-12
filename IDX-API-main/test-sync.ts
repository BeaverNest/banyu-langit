import * as sync from '@app/Backend/Sync/index.ts'

console.log('=== Syncing March 2026 ===')

// Stock + Index summary per hari
const dates = ['20260310', '20260311', '20260312']
for (const d of dates) {
  console.log('Stock summary', d)
  await sync.syncStockSummary(d)
  console.log('Index summary', d)
  await sync.syncIndexSummary(d)
}

// Fundamental
console.log('Financial ratios 2026-03...')
await sync.syncFinancialRatio(2026, 3)

// Screener
console.log('Stock screener...')
await sync.syncStockScreener()

console.log('=== Done ===')