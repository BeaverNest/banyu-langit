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
  const [profile] = await Database.select()
    .from(schemas.companyProfile)
    .where(eq(schemas.companyProfile.code, code))
    .limit(1)
  if (!profile) {
    return Helpers.jsonError('Company not found', 404)
  }
  const [detail] = await Database.select()
    .from(schemas.companyDetail)
    .where(eq(schemas.companyDetail.code, code))
    .limit(1)
  return ctx.send.json(Helpers.jsonOne({ profile, detail: detail ?? null }))
}
