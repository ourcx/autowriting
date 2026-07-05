/**
 * Search Provider 接口定义
 */

import type { SearchResult } from "../types.ts"

/** 搜索 Provider 接口 */
export interface SearchProvider {
  /** provider 名称 */
  name(): string
  /** 是否可用（已配置必需的 Key/URL） */
  isReady(): boolean
  /** 不可用时的提示信息 */
  unavailableHint(): string
  /** 执行搜索，返回结果列表 */
  search(query: string, topK?: number): Promise<SearchResult[]>
}