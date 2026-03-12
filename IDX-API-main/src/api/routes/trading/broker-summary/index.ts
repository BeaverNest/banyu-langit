import type { Context } from '@neabyte/deserve'
import { and, gte, lt } from 'drizzle-orm'
import Database from '@app/Database.ts'
import * as schemas from '@app/Backend/Schemas/index.ts'
import * as Helpers from '@app/api/Helpers.ts'

export async function GET(ctx: Context): Promise<Response> {
  const q = ctx.query() as Record<string, string>
  const dateParam = q['date']
  if (!dateParam) {
    return Helpers.jsonError('Query "date" (YYYYMMDD) required', 400)
  }
  const dateTs = Helpers.parseDate(dateParam)
  if (dateTs === null) {
    return Helpers.jsonError('Invalid date format; use YYYYMMDD', 400)
  }
  const dayStartMs = dateTs * 1000
  const dayEndMs = (dateTs + 86400) * 1000
  const { limit, offset, includeTotal } = Helpers.getPagination(q)
  const whereClause = and(
    gte(schemas.brokerSummary.date, dayStartMs),
    lt(schemas.brokerSummary.date, dayEndMs)
  )
  const dataPromise = Database.select()
    .from(schemas.brokerSummary)
    .where(whereClause)
    .limit(limit)
    .offset(offset)
  const countPromise = includeTotal
    ? Helpers.getTotalCount(Database, schemas.brokerSummary, whereClause)
    : undefined
  const { data, total } = await Helpers.runPaginated(dataPromise, countPromise)
  const meta = total !== undefined ? { limit, offset, total } : { limit, offset }
  return ctx.send.json(Helpers.paginatedEnvelope(data, meta))
}
