import * as sync from '@app/Backend/Sync/index.ts'

const year = 2025
const months = [1,2,3,4,5,6,7,8,9,10,11,12]

console.log('=== Full Data Sync 2025 ===')

// One-time data (no params)
console.log('Company profiles...')
await sync.syncCompanyProfile()
console.log('Security stock...')
await sync.syncSecurityStock()
console.log('Stock screener...')
await sync.syncStockScreener()
console.log('Index list...')
await sync.syncIndexList()
console.log('Trade summary...')
await sync.syncTradeSummary()

// Monthly data
for (const m of months) {
  console.log('--- ' + year + '-' + String(m).padStart(2,'0') + ' ---')
  await sync.syncFinancialRatio(year, m)
  await sync.syncCompanyDividend(year, m)
  await sync.syncStockSplit(year, m)
  await sync.syncForeignTrading(year, m)
  await sync.syncIndustryTrading(year, m)
  await sync.syncDailyIndex(year, m)
  await sync.syncTopGainer(year, m)
  await sync.syncTopLoser(year, m)
  await sync.syncSectoralMovement(year, m)
  await sync.syncDomesticTrading(year, m)
  await sync.syncNewListing(year, m)
  await sync.syncAdditionalListing(year, m)
  await sync.syncRightOffering(year, m)
}

console.log('=== Done ===')