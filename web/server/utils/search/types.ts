/**
 * 搜索模块共享类型定义
 */

/** 单条搜索结果 */
export interface SearchResult {
  title: string
  snippet: string
  url: string
  source: string
  datePublished?: string | null
}

/** 搜索 Provider 选项 */
export interface SearchOptions {
  query: string
  topK?: number  // 返回结果数量，默认 5
}

/** 抓取结果 */
export interface FetchResult {
  url: string
  content: string
  ok: boolean
  error?: string
}