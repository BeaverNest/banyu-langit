import * as sync from '@app/Backend/Sync/index.ts'

console.log('Syncing stock summary 20260312...')
await sync.syncStockSummary('20260312')
console.log('Syncing index summary 20260312...')
await sync.syncIndexSummary('20260312')
console.log('Done!')
