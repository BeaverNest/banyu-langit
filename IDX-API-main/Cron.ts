import * as schemas from '@app/Backend/Schemas/index.ts'
import * as Sync from '@app/Backend/Sync/index.ts'
import Database from '@app/Database.ts'
import Logger from '@app/Logger.ts'

const startDate = '2026-01-01'
const endDate = '2026-03-10'
const delayMs = 400

function formatYmd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function getDateRange(start: string, end: string): string[] {
  const out: string[] = []
  const startD = new Date(start.slice(0, 4) + '-' + start.slice(4, 6) + '-' + start.slice(6, 8))
  const endD = new Date(end.slice(0, 4) + '-' + end.slice(4, 6) + '-' + end.slice(6, 8))
  for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
    out.push(formatYmd(d))
  }
  return out
}

function getMonthsInRange(start: string, end: string): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = []
  const startY = parseInt(start.slice(0, 4), 10)
  const startM = parseInt(start.slice(4, 6), 10)
  const endY = parseInt(end.slice(0, 4), 10)
  const endM = parseInt(end.slice(4, 6), 10)
  for (let y = startY; y <= endY; y++) {
    const mStart = y === startY ? startM : 1
    const mEnd = y === endY ? endM : 12
    for (let m = mStart; m <= mEnd; m++) {
      months.push({ year: y, month: m })
    }
  }
  return months
}

async function getCompanyCodes(): Promise<string[]> {
  const rows = await Database.select({ code: schemas.companyProfile.code }).from(
    schemas.companyProfile
  )
  return rows.map(r => r.code)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runSync<T>(name: string, fn: () => Promise<T>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    Logger.error(`[Cron] ${name} failed:`, err instanceof Error ? err.message : String(err))
  }
  await delay(delayMs)
}

async function runCron(): Promise<void> {
  Logger.info(`[Cron] Starting sync range ${startDate} -> ${endDate}`)
  const dateList = getDateRange(startDate.replace(/-/g, ''), endDate.replace(/-/g, ''))
  const months = getMonthsInRange(startDate.replace(/-/g, ''), endDate.replace(/-/g, ''))
  await runSync('syncCompanyProfile', Sync.syncCompanyProfile)
  await runSync('syncSecurityStock', Sync.syncSecurityStock)
  await runSync('syncCompanySuspend', Sync.syncCompanySuspend)
  await runSync('syncCompanyRelisting', Sync.syncCompanyRelisting)
  await runSync('syncTradeSummary', Sync.syncTradeSummary)
  await runSync('syncDealerParticipant', Sync.syncDealerParticipant)
  await runSync('syncProfileParticipant', Sync.syncProfileParticipant)
  await runSync('syncBrokerParticipant', Sync.syncBrokerParticipant)
  await runSync('syncIndexList', Sync.syncIndexList)
  await runSync('syncStockScreener', Sync.syncStockScreener)
  for (const { year, month } of months) {
    await runSync(`syncAdditionalListing(${year}-${month})`, () =>
      Sync.syncAdditionalListing(year, month)
    )
    await runSync(`syncCompanyDelisting(${year}-${month})`, () =>
      Sync.syncCompanyDelisting(year, month)
    )
    await runSync(`syncForeignTrading(${year}-${month})`, () =>
      Sync.syncForeignTrading(year, month)
    )
    await runSync(`syncCompanyDividend(${year}-${month})`, () =>
      Sync.syncCompanyDividend(year, month)
    )
    await runSync(`syncFinancialRatio(${year}-${month})`, () =>
      Sync.syncFinancialRatio(year, month)
    )
    await runSync(`syncTopGainer(${year}-${month})`, () => Sync.syncTopGainer(year, month))
    await runSync(`syncTopLoser(${year}-${month})`, () => Sync.syncTopLoser(year, month))
    await runSync(`syncRightOffering(${year}-${month})`, () => Sync.syncRightOffering(year, month))
    await runSync(`syncIndustryTrading(${year}-${month})`, () =>
      Sync.syncIndustryTrading(year, month)
    )
    await runSync(`syncNewListing(${year}-${month})`, () => Sync.syncNewListing(year, month))
    await runSync(`syncStockSplit(${year}-${month})`, () => Sync.syncStockSplit(year, month))
    await runSync(`syncDomesticTrading(${year}-${month})`, () =>
      Sync.syncDomesticTrading(year, month)
    )
    await runSync(`syncSectoralMovement(${year}-${month})`, () =>
      Sync.syncSectoralMovement(year, month)
    )
    await runSync(`syncActiveVolume(${year}-${month})`, () => Sync.syncActiveVolume(year, month))
    await runSync(`syncActiveFrequency(${year}-${month})`, () =>
      Sync.syncActiveFrequency(year, month)
    )
    await runSync(`syncActiveValue(${year}-${month})`, () => Sync.syncActiveValue(year, month))
    await runSync(`syncDailyIndex(${year}-${month})`, () => Sync.syncDailyIndex(year, month))
  }
  for (const dateStr of dateList) {
    await runSync(`syncMarketCalendar(${dateStr})`, () => Sync.syncMarketCalendar(dateStr))
    await runSync(`syncStockSummary(${dateStr})`, () => Sync.syncStockSummary(dateStr))
    await runSync(`syncBrokerSummary(${dateStr})`, () => Sync.syncBrokerSummary(dateStr))
    await runSync(`syncIndexSummary(${dateStr})`, () => Sync.syncIndexSummary(dateStr))
    await runSync(`syncCompanyAnnouncement(${dateStr})`, () =>
      Sync.syncCompanyAnnouncement(dateStr)
    )
  }
  const companyCodes = await getCompanyCodes()
  Logger.info(`[Cron] Per-company sync for ${companyCodes.length} companies`)
  for (const code of companyCodes) {
    await runSync(`syncProfileAnnouncement(${code})`, () => Sync.syncProfileAnnouncement(code))
    await runSync(`syncIssuedHistory(${code})`, () => Sync.syncIssuedHistory(code))
    await runSync(`syncTradingSS(${code})`, () => Sync.syncTradingSS(code, 0, 1000))
    await runSync(`syncTradingDaily(${code})`, () => Sync.syncTradingDaily(code))
    await runSync(`syncFinancialReport(${code}, 2025)`, () =>
      Sync.syncFinancialReport(code, 2025, 'audit')
    )
    await runSync(`syncFinancialReport(${code}, 2026 TW1)`, () =>
      Sync.syncFinancialReport(code, 2026, 'TW1')
    )
  }
  Logger.info('[Cron] All syncs finished.')
}

if (import.meta.main) {
  runCron()
}
