import type { Context } from '@neabyte/deserve'
import { eq } from 'drizzle-orm'
import Database from '@app/Database.ts'
import * as schemas from '@app/Backend/Schemas/index.ts'
import * as Helpers from '@app/api/Helpers.ts'

export async function GET(ctx: Context): Promise<Response> {
  const q = ctx.query() as Record<string, string>
  const year = parseInt(q['year'] ?? '', 10)
  const month = parseInt(q['month'] ?? '', 10)
  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    return Helpers.jsonError('Query "year" and "month" (1-12) required', 400)
  }
  const period = Helpers.monthToPeriod(year, month)
  const whereClause = eq(schemas.topGainer.period, period)
  const { limit, offset, includeTotal } = Helpers.getPagination(q)
  const dataPromise = Database.select()
    .from(schemas.topGainer)
    .where(whereClause)
    .limit(limit)
    .offset(offset)
  const countPromise = includeTotal
    ? Helpers.getTotalCount(Database, schemas.topGainer, whereClause)
    : undefined
  const { data, total } = await Helpers.runPaginated(dataPromise, countPromise)
  const meta = total !== undefined ? { limit, offset, total } : { limit, offset }
  return ctx.send.json(Helpers.paginatedEnvelope(data, meta))
}
