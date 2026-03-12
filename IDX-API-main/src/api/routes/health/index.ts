import type { Context } from '@neabyte/deserve'

export function GET(_ctx: Context): Response {
  return Response.json({ status: 'ok' }, {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}
