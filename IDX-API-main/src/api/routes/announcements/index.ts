import type { Context } from '@neabyte/deserve'
import { and, eq, gte, lte } from 'drizzle-orm'
import Database from '@app/Database.ts'
import * as schemas from '@app/Backend/Schemas/index.ts'
import * as Helpers from '@app/api/Helpers.ts'

export async function GET(ctx: Context): Promise<Response> {
  const q = ctx.query() as Record<string, string>
  const { limit, offset, includeTotal } = Helpers.getPagination(q)
  const dateFrom = q['dateFrom'] ? Helpers.parseDate(q['dateFrom']) : null
  const dateTo = q['dateTo'] ? Helpers.parseDate(q['dateTo']) : null
  const companyCode = q['companyCode']?.trim()
  const conds: ReturnType<typeof eq>[] = []
  if (dateFrom !== null) {
    conds.push(gte(schemas.companyAnnouncement.date, dateFrom))
  }
  if (dateTo !== null) {
    conds.push(lte(schemas.companyAnnouncement.date, dateTo))
  }
  if (companyCode) {
    conds.push(eq(schemas.companyAnnouncement.companyCode, companyCode))
  }
  const whereClause = conds.length > 0 ? and(...conds) : undefined
  const baseQuery = Database.select().from(schemas.companyAnnouncement)
  const dataPromise = (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .limit(limit)
    .offset(offset)
  const countPromise = includeTotal
    ? Helpers.getTotalCount(Database, schemas.companyAnnouncement, whereClause ?? undefined)
    : undefined
  const { data, total } = await Helpers.runPaginated(dataPromise, countPromise)
  const meta = total !== undefined ? { limit, offset, total } : { limit, offset }
  return ctx.send.json(Helpers.paginatedEnvelope(data, meta))
}
