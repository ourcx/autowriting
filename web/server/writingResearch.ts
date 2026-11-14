import { normalizeWechatArticleUrl } from "../shared/wechatArticleUrl.ts"
import { SERVER_AI_CONFIG } from "./config.ts"
import { resolveDeepSeekConfig } from "./deepseekCredentials.ts"
import type { AIConfig } from "./types.ts"
import { createDeepSeekClient, isDeepSeekReady } from "./utils/deepseek.ts"
import { resolveZhipuApiKey } from "./utils/providerKeys.ts"
import { createSearchProvider } from "./utils/search/providers/index.ts"
import type { SearchResult } from "./utils/search/types.ts"
import { readArticlePage } from "./utils/search/readArticlePage.ts"

export function publicSourceUrl(value: string): string {
  try {
    const url = new URL(normalizeWechatArticleUrl(value) || value)
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password
      || (url.port && !["80", "443"].includes(url.port)) || value.length > 2048) return ""
    const wechatArticle = Boolean(normalizeWechatArticleUrl(value))
    if ([...url.searchParams.keys()].some(key => /^(?:access[_-]?token|token|auth|api[_-]?key|key|password|sig(?:nature)?|x-amz-.+|x-oss-.+)$/i.test(key)
      && !(wechatArticle && key === "signature"))) return ""
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
  const deepseekConfig = resolveDeepSeekConfig(config.deepseekApiKey)
  const deepseekReady = isDeepSeekReady(deepseekConfig)
  const searchApiKey = String(config.searchApiKey || SERVER_AI_CONFIG.searchApiKey || "")
  const zhipuApiKey = resolveZhipuApiKey(config)
  const defaultSearch = !provider || (provider === "serper" && !searchApiKey)
  const deepseek = deepseekReady && (provider === "deepseek" || defaultSearch) ? createDeepSeekClient(deepseekConfig) : undefined
  const read: WritingWebResearch["read"] = async (url, signal) => (await readArticlePage(url, {
    signal, maxChars: 24_000, jinaApiKey: String(config.jinaApiKey || SERVER_AI_CONFIG.jinaApiKey || ""),
    fetchWithDeepSeek: deepseek ? async (page, deadline) => (await deepseek.fetchUrl(page, deadline)).content : undefined,
  })).content
  if (deepseek) {
    return {
      async search(query, signal) {
        const rows = await deepseek.search(query, 5, signal)
        return rows.map(row => ({
          title: row.title, url: row.url, snippet: row.summary || row.snippet,
          source: row.siteName, datePublished: row.datePublished,
        }))
      },
      read,
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
    read,
  }
}
