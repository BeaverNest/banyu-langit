import type { Context } from '@neabyte/deserve'
import { eq } from 'drizzle-orm'
import Database from '@app/Database.ts'
import * as schemas from '@app/Backend/Schemas/index.ts'
import * as Helpers from '@app/api/Helpers.ts'

export async function GET(ctx: Context): Promise<Response> {
  const code = ctx.param('code')
  if (!code) {
    return Helpers.jsonError('Missing code', 400)
  }
  const q = ctx.query() as Record<string, string>
  const { limit, offset, includeTotal } = Helpers.getPagination(q)
  const whereClause = eq(schemas.issuedHistory.code, code)
  const dataPromise = Database.select()
    .from(schemas.issuedHistory)
    .where(whereClause)
    .limit(limit)
    .offset(offset)
  const countPromise = includeTotal
    ? Helpers.getTotalCount(Database, schemas.issuedHistory, whereClause)
    : undefined
  const { data, total } = await Helpers.runPaginated(dataPromise, countPromise)
  const meta = total !== undefined ? { limit, offset, total } : { limit, offset }
  return ctx.send.json(Helpers.paginatedEnvelope(data, meta))
}
