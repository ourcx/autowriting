/**
 * SearXNG 搜索 Provider
 *
 * 开源元搜索引擎，无需 API Key，需自行部署或使用公共实例。
 * 通过 Docker 部署：docker run --rm -p 8888:8888 searxng/searxng
 */

import { logger } from "../../../logger.ts"
import type { SearchProvider } from "./types.ts"
import type { SearchResult } from "../types.ts"

const DEFAULT_BASE_URL = "https://paulgo.io"

export function createSearxngProvider(baseUrl?: string, engines?: string): SearchProvider {
  const resolvedUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "")
  const resolvedEngines = engines || "google,bing,duckduckgo"

  return {
    name() {
      return "searxng"
    },

    isReady() {
      return true // 公共实例无需 Key
    },

    unavailableHint() {
      return "SearXNG 实例不可用，请检查网络或更换实例地址"
    },

    async search(query: string, topK = 5): Promise<SearchResult[]> {
      if (!query) return []

      try {
        const params = new URLSearchParams({
          q: query,
          format: "json",
          engines: resolvedEngines,
          lang: "zh-CN",
          pageno: "1",
        })

        const resp = await fetch(`${resolvedUrl}/search?${params}`, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; autowriting-bot/1.0)",
          },
          signal: AbortSignal.timeout(15000),
        })

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "")
          throw new Error(`SearXNG 返回 ${resp.status}: ${errText.slice(0, 200)}`)
        }

        const data = await resp.json() as {
          results?: Array<{
            title?: string
            content?: string
            snippet?: string
            url?: string
            engines?: string[]
          }>
        }

        const items = data.results || []

        const results: SearchResult[] = items.slice(0, topK).map((item) => ({
          title: item.title || "",
          snippet: item.content || item.snippet || "",
          url: item.url || "",
          source: extractDomain(item.url || ""),
        }))

        logger.info("SEARCH-SEARXNG", `搜索完成: ${query}`, { count: results.length })
        return results
      } catch (err: unknown) {
        const e = err as Error
        logger.error("SEARCH-SEARXNG", "搜索失败", { query, error: e.message })
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