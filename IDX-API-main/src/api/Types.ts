export interface PaginationParams {
  limit: number
  offset: number
  includeTotal: boolean
}

export interface PaginatedMeta {
  limit: number
  offset: number
  total?: number
}

export interface ResourceTree {
  [key: string]: string | ResourceTree
}
