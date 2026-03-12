import type { Context } from '@neabyte/deserve'
import { desc, eq } from 'drizzle-orm'
import Database from '@app/Database.ts'
import * as schemas from '@app/Backend/Schemas/index.ts'
import * as Helpers from '@app/api/Helpers.ts'

export async function GET(ctx: Context): Promise<Response> {
  const code = ctx.param('code')
  if (!code) {
    return Helpers.jsonError('Missing index code', 400)
  }
  const q = ctx.query() as Record<string, string>
  const period = q['period']?.toUpperCase()
  if (period && !['1D', '1W', '1M', '1Q', '1Y'].includes(period)) {
    return Helpers.jsonError('Invalid period; use 1D, 1W, 1M, 1Q, 1Y', 400)
  }
  const { limit, offset, includeTotal } = Helpers.getPagination(q)
  const whereClause = eq(schemas.indexChart.code, code)
  const dataPromise = Database.select()
    .from(schemas.indexChart)
    .where(whereClause)
    .orderBy(desc(schemas.indexChart.date))
    .limit(limit)
    .offset(offset)
  const countPromise = includeTotal
    ? Helpers.getTotalCount(Database, schemas.indexChart, whereClause)
    : undefined
  const { data, total } = await Helpers.runPaginated(dataPromise, countPromise)
  const meta = total !== undefined ? { limit, offset, total } : { limit, offset }
  return ctx.send.json(Helpers.paginatedEnvelope(data, meta))
}
