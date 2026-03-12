import type { Context } from '@neabyte/deserve'
import { and, eq, type SQL } from 'drizzle-orm'
import Database from '@app/Database.ts'
import * as schemas from '@app/Backend/Schemas/index.ts'
import * as Helpers from '@app/api/Helpers.ts'

export async function GET(ctx: Context): Promise<Response> {
  const q = ctx.query() as Record<string, string>
  const { limit, offset, includeTotal } = Helpers.getPagination(q)
  const code = q['code']?.trim()
  const board = q['board']?.trim()
  const conditions: SQL[] = []
  if (code) {
    conditions.push(eq(schemas.securityStock.code, code))
  }
  if (board) {
    conditions.push(eq(schemas.securityStock.listingBoard, board))
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined
  const baseQuery = Database.select().from(schemas.securityStock)
  const dataPromise = (whereClause ? baseQuery.where(whereClause) : baseQuery)
    .limit(limit)
    .offset(offset)
  const countPromise = includeTotal
    ? Helpers.getTotalCount(Database, schemas.securityStock, whereClause ?? undefined)
    : undefined
  const { data, total } = await Helpers.runPaginated(dataPromise, countPromise)
  const meta = total !== undefined ? { limit, offset, total } : { limit, offset }
  return ctx.send.json(Helpers.paginatedEnvelope(data, meta))
}
