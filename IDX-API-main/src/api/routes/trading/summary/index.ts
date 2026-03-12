import type { Context } from '@neabyte/deserve'
import Database from '@app/Database.ts'
import * as schemas from '@app/Backend/Schemas/index.ts'
import * as Helpers from '@app/api/Helpers.ts'

export async function GET(ctx: Context): Promise<Response> {
  const q = ctx.query() as Record<string, string>
  const { limit, offset, includeTotal } = Helpers.getPagination(q)
  const dataPromise = Database.select()
    .from(schemas.tradeSummary)
    .limit(limit)
    .offset(offset)
  const countPromise = includeTotal ? Helpers.getTotalCount(Database, schemas.tradeSummary) : undefined
  const { data, total } = await Helpers.runPaginated(dataPromise, countPromise)
  const meta = total !== undefined ? { limit, offset, total } : { limit, offset }
  return ctx.send.json(Helpers.paginatedEnvelope(data, meta))
}
