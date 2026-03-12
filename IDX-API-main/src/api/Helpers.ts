import { count } from 'drizzle-orm'
import type { PaginatedMeta, PaginationParams } from '@app/api/Types.ts'

export type { PaginatedMeta, PaginationParams } from '@app/api/Types.ts'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500
const MAX_OFFSET = 100_000

export function getPagination(query: Record<string, string> | undefined): PaginationParams {
  const q = query ?? {}
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(q['limit'] ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  )
  const rawOffset = Math.max(0, parseInt(q['offset'] ?? '0', 10) || 0)
  const offset = Math.min(rawOffset, MAX_OFFSET)
  const totalParam = q['total']?.toLowerCase()
  const includeTotal = totalParam === '1' || totalParam === 'true'
  return { limit, offset, includeTotal }
}

export function getLimitOffset(query: Record<string, string> | undefined): {
  limit: number
  offset: number
} {
  const { limit, offset } = getPagination(query)
  return { limit, offset }
}

export function paginatedEnvelope<T>(
  data: T[],
  meta: { limit: number; offset: number; total?: number }
): { data: T[]; meta: PaginatedMeta } {
  const m: PaginatedMeta = { limit: meta.limit, offset: meta.offset }
  if (meta.total !== undefined) {
    m.total = meta.total
  }
  return { data, meta: m }
}

export function jsonList<T>(data: T[], total?: number): { data: T[]; total?: number } {
  return total !== undefined ? { data, total } : { data }
}

export async function runPaginated<T>(
  dataPromise: Promise<T[]>,
  countPromise?: Promise<number> | null
): Promise<{ data: T[]; total?: number }> {
  const [data, total] = await Promise.all([dataPromise, countPromise ?? Promise.resolve(undefined)])
  if (total !== undefined) {
    return { data, total }
  }
  return { data }
}

export async function getTotalCount(
  db: unknown,
  table: unknown,
  whereClause?: unknown
): Promise<number> {
  const d = db as {
    select: (opts: { count: ReturnType<typeof count> }) => { from: (t: unknown) => unknown }
  }
  const builder = d.select({ count: count() }).from(table)
  const rows = (
    whereClause !== undefined && whereClause !== null
      ? (builder as { where: (w: unknown) => Promise<{ count: number }[]> }).where(whereClause)
      : builder
  ) as Promise<{ count: number }[]>
  const result = await rows
  const first = result?.[0]
  return typeof first?.count === 'number' ? first.count : 0
}

export function parseDate(dateStr: string): number | null {
  if (!dateStr || !/^\d{8}$/.test(dateStr)) {
    return null
  }
  const y = parseInt(dateStr.slice(0, 4), 10)
  const m = parseInt(dateStr.slice(4, 6), 10) - 1
  const d = parseInt(dateStr.slice(6, 8), 10)
  const t = new Date(y, m, d).getTime()
  return Number.isNaN(t) ? null : Math.floor(t / 1000)
}

export function monthToPeriod(year: number, month: number): number {
  return year * 100 + month
}

export function jsonOne<T>(data: T): { data: T } {
  return { data }
}

export function jsonError(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}
