/**
 * 智谱搜索 Provider
 *
 * 使用智谱 GLM 联网搜索 API，与 LLM 共用 GLM_API_KEY，零额外配置。
 * 调用 POST https://open.bigmodel.cn/api/paas/v4/tools/web_search
 *
 * 引擎选项：
 *   search_std  - 标准版 0.01 元/次
 *   search_pro  - 增强版 0.03 元/次
 *   sougou_pro  - 搜狗 Pro 0.05 元/次
 *   quake_pro   - 夸克 Pro 0.05 元/次
 */

import { logger } from "../../../logger.ts"
import type { SearchProvider } from "./types.ts"
import type { SearchResult } from "../types.ts"

const ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/tools/web_search"

export function createZhipuProvider(apiKey: string, engine = "search_std"): SearchProvider {
  return {
    name() {
      return "zhipu"
    },

    isReady() {
      return !!(apiKey && apiKey.length > 0)
    },

    unavailableHint() {
      if (!apiKey) return "请配置 GLM_API_KEY（智谱 API Key），在「AI 配置」页面填写"
      return "智谱搜索需要有效的 API Key"
    },

    async search(query: string, topK = 5): Promise<SearchResult[]> {
      if (!query) return []

      try {
        const resp = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            search_engine: engine,
            search_query: query,
            count: Math.min(topK, 20),
            content_size: "medium",
          }),
          signal: AbortSignal.timeout(30000),
        })

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "")
          throw new Error(`智谱搜索 API 返回 ${resp.status}: ${errText.slice(0, 200)}`)
        }

        const data = await resp.json() as {
          search_result?: Array<{
            title?: string
            link?: string
            content?: string
          }>
        }

        const items = data.search_result || []

        const results: SearchResult[] = items.slice(0, topK).map((item) => ({
          title: item.title || "",
          snippet: item.content || "",
          url: item.link || "",
          source: extractDomain(item.link || ""),
        }))

        logger.info("SEARCH-ZHIPU", `搜索完成: ${query}`, { count: results.length })
        return results
      } catch (err: unknown) {
        const e = err as Error
        logger.error("SEARCH-ZHIPU", "搜索失败", { query, error: e.message })
        throw err
      }
    },
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return "unknown"
  }
}