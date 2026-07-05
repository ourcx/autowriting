/**
 * Serper 搜索 Provider
 *
 * Serper.dev — 支持 google / baidu / bing 等 engine
 * 需要单独注册账号获取 API Key（每月有免费额度）
 */

import { logger } from "../../../logger.ts"
import type { SearchProvider } from "./types.ts"
import type { SearchResult } from "../types.ts"

const ENDPOINT = "https://google.serper.dev/search"

export function createSerperProvider(apiKey: string, engine = "google"): SearchProvider {
  return {
    name() {
      return "serper"
    },

    isReady() {
      return !!(apiKey && apiKey.length > 0)
    },

    unavailableHint() {
      if (!apiKey) return "请配置 Serper API Key，在「AI 配置」页面填写；或切换到智谱搜索/SearXNG"
      return "Serper 搜索需要有效的 API Key"
    },

    async search(query: string, topK = 5): Promise<SearchResult[]> {
      if (!query) return []

      try {
        const resp = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": apiKey,
          },
          body: JSON.stringify({
            q: query,
            gl: "cn",
            hl: "zh-cn",
            num: topK,
            engine,
          }),
          signal: AbortSignal.timeout(15000),
        })

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "")
          throw new Error(`Serper API 返回 ${resp.status}: ${errText.slice(0, 200)}`)
        }

        const data = await resp.json() as {
          organic?: Array<{
            title?: string
            snippet?: string
            link?: string
          }>
          answerBox?: {
            title?: string
            snippet?: string
            answer?: string
          }
        }

        const organic = data.organic || []
        let results: SearchResult[]

        if (organic.length > 0) {
          results = organic.slice(0, topK).map((item) => ({
            title: item.title || "",
            snippet: item.snippet || "",
            url: item.link || "",
            source: extractDomain(item.link || ""),
          }))
        } else if (data.answerBox) {
          // 降级到 Google 精选摘要
          const ab = data.answerBox
          results = [{
            title: ab.title || query,
            snippet: ab.snippet || ab.answer || "",
            url: "",
            source: "google-answer-box",
          }]
        } else {
          results = []
        }

        logger.info("SEARCH-SERPER", `搜索完成: ${query}`, { count: results.length })
        return results
      } catch (err: unknown) {
        const e = err as Error
        logger.error("SEARCH-SERPER", "搜索失败", { query, error: e.message })
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