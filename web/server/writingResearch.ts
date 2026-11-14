import { DEEPSEEK_APP_CONFIG, SERVER_AI_CONFIG } from "./config.ts"
import type { AIConfig } from "./types.ts"
import { createDeepSeekClient, isDeepSeekReady } from "./utils/deepseek.ts"
import { resolveZhipuApiKey } from "./utils/providerKeys.ts"
import { createSearchProvider } from "./utils/search/providers/index.ts"
import type { SearchResult } from "./utils/search/types.ts"
import { webFetch } from "./utils/search/webFetcher.ts"

const deepseek = createDeepSeekClient(DEEPSEEK_APP_CONFIG)

export function publicSourceUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password
      || (url.port && !["80", "443"].includes(url.port)) || value.length > 2048) return ""
    url.hash = ""
    return url.href
  } catch { return "" }
}

export interface WritingWebResearch {
  search: (_query: string, _signal: AbortSignal) => Promise<SearchResult[]>
  read: (_url: string, _signal: AbortSignal) => Promise<string>
}

export function createWritingWebResearch(config: AIConfig): WritingWebResearch | undefined {
  const provider = String(config.searchProvider || SERVER_AI_CONFIG.searchProvider || "")
  if (provider === "deepseek" || (!provider && isDeepSeekReady(DEEPSEEK_APP_CONFIG))) {
    if (!isDeepSeekReady(DEEPSEEK_APP_CONFIG)) return undefined
    return {
      async search(query, signal) {
        const rows = await deepseek.search(query, 5, signal)
        return rows.map(row => ({
          title: row.title, url: row.url, snippet: row.summary || row.snippet,
          source: row.siteName, datePublished: row.datePublished,
        }))
      },
      async read(url, signal) { return (await deepseek.fetchUrl(url, signal)).content },
    }
  }
  // 旧 Bing 配置保留给原素材页。文章调研只为实际可用的服务暴露工具。
  if (provider === "bing") return undefined
  const configuredSearxng = String(SERVER_AI_CONFIG.searxngUrl || "")
  const selectedProvider = createSearchProvider({
    searchProvider: provider,
    searchApiKey: String(config.searchApiKey || SERVER_AI_CONFIG.searchApiKey || ""),
    glmApiKey: resolveZhipuApiKey(config),
    searxngUrl: configuredSearxng,
  })
  // 旧配置默认选 Serper 但没填 Key 时，使用现有免 Key 搜索能力。
  const searchProvider = selectedProvider ?? ((!provider || provider === "serper")
    ? createSearchProvider({ searchProvider: "searxng", searxngUrl: configuredSearxng })
    : null)
  if (!searchProvider) return undefined

  return {
    search: (query, signal) => searchProvider.search(query, 5, signal),
    async read(url, signal) {
      const content = await webFetch(url, { maxChars: 5200, signal, textOnly: true })
      if (!content.trim() || /^\[(?:安全拦截|频率限制|抓取失败|内容提取失败|未提取到正文|超时)/.test(content)) throw new Error("网页正文读取失败")
      return content
    },
  }
}
