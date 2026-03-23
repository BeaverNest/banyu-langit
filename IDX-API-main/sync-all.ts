import * as sync from '@app/Backend/Sync/index.ts'

console.log('=== Full Sync ===')

// 1. Company profiles (master data)
console.log('1. Company profiles...')
await sync.syncCompanyProfile()

// 2. Stock screener (fundamental + price changes)
console.log('2. Stock screener...')
await sync.syncStockScreener()

// 3. Financial ratios March 2026
console.log('3. Financial ratios 2026-03...')
await sync.syncFinancialRatio(2026, 3)

// 4. Dividends recent months
console.log('4. Dividends...')
await sync.syncCompanyDividend(2026, 1)
await sync.syncCompanyDividend(2026, 2)
await sync.syncCompanyDividend(2026, 3)

// 5. Stock splits recent
console.log('5. Stock splits...')
await sync.syncStockSplit(2026, 1)
await sync.syncStockSplit(2026, 2)
await sync.syncStockSplit(2026, 3)

// 6. Index list (real-time)
console.log('6. Index list...')
await sync.syncIndexList()

// 7. Stock + Index summary for last 5 trading days
const dates = ['20260305','20260306','20260307','20260310','20260311','20260312']
for (const d of dates) {
  console.log(`7. Stock+Index ${d}...`)
  await sync.syncStockSummary(d)
  await sync.syncIndexSummary(d)
}

console.log('=== Done ===')