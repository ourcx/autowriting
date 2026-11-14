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
    if ([...url.searchParams.keys()].some(key => /^(?:access[_-]?token|token|auth|api[_-]?key|key|password|sig(?:nature)?|x-amz-.+|x-oss-.+)$/i.test(key))) return ""
    url.hash = ""
    return url.href
  } catch { return "" }
}

export interface WritingWebResearch {
  search?: (_query: string, _signal: AbortSignal) => Promise<SearchResult[]>
  read: (_url: string, _signal: AbortSignal) => Promise<string>
}

export function createWritingWebResearch(config: AIConfig): WritingWebResearch {
  const provider = String(config.searchProvider || SERVER_AI_CONFIG.searchProvider || "")
  const deepseekReady = isDeepSeekReady(DEEPSEEK_APP_CONFIG)
  const searchApiKey = String(config.searchApiKey || SERVER_AI_CONFIG.searchApiKey || "")
  const zhipuApiKey = resolveZhipuApiKey(config)
  const defaultSearch = !provider || (provider === "serper" && !searchApiKey)
  if (deepseekReady && (provider === "deepseek" || defaultSearch)) {
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
  const configuredSearxng = String(config.searxngUrl || SERVER_AI_CONFIG.searxngUrl || "")
  const selectedProvider = provider === "deepseek" || provider === "bing" ? null : createSearchProvider({
    searchProvider: provider,
    searchApiKey,
    glmApiKey: zhipuApiKey,
    searxngUrl: configuredSearxng,
  })
  // 默认 Serper 没有 Key 时先复用已配置的搜索服务，否则尝试现有的免 Key 入口。
  const searchProvider = selectedProvider ?? (defaultSearch
    ? createSearchProvider({ searchProvider: zhipuApiKey ? "zhipu" : "searxng", glmApiKey: zhipuApiKey, searxngUrl: configuredSearxng }) : null)

  return {
    ...(searchProvider && { search: (query: string, signal: AbortSignal) => searchProvider.search(query, 5, signal) }),
    async read(url, signal) {
      const content = await webFetch(url, { maxChars: 24000, signal, textOnly: true })
      if (!content.trim() || /^\[(?:安全拦截|频率限制|抓取失败|内容提取失败|未提取到正文|超时)/.test(content)) throw new Error("网页正文读取失败")
      return content
    },
  }
}
