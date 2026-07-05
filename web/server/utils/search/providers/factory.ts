/**
 * SearchProviderFactory — 根据配置自动选择最合适的搜索 Provider
 *
 * 选择逻辑：
 *   1. 环境变量 SEARCH_PROVIDER 显式指定 → 强制使用该 Provider
 *   2. 检测 GLM_API_KEY → zhipu（智谱搜索，与 LLM 共用 Key）
 *   3. 检测 SERPER_API_KEY → serper（Serper.dev）
 *   4. 检测 SEARXNG_URL → searxng（开源自建）
 *   5. 都没配置 → 返回 null，调用方提示用户配置
 *
 * Key 来源：process.env（包括 .env）、AIConfig 中传入的 searchApiKey
 */

import { logger } from "../../../logger.ts"
import type { SearchProvider } from "./types.ts"
import { createZhipuProvider } from "./zhipu.ts"
import { createSerperProvider } from "./serper.ts"
import { createSearxngProvider } from "./searxng.ts"

export type SearchProviderId = "zhipu" | "serper" | "searxng"

export interface SearchConfig {
  /** 显式指定的 Provider（优先级最高） */
  searchProvider?: SearchProviderId | string
  /** 搜索 API Key（serper 用 searchApiKey，zhipu 用 glmKey） */
  searchApiKey?: string
  /** 智谱 API Key（可能是 articleApiKey，被 zhipu 复用） */
  glmApiKey?: string
  /** SearXNG 实例地址 */
  searxngUrl?: string
}

/**
 * 根据配置创建 SearchProvider 实例
 * 如果没有任何可用 Provider，返回 null
 */
export function createSearchProvider(config: SearchConfig = {}): SearchProvider | null {
  const provider = config.searchProvider || ""
  const searchApiKey = config.searchApiKey || ""
  const glmKey = config.glmApiKey || ""
  const searxngUrl = config.searxngUrl || ""
  const serperKey = searchApiKey
  // 智谱搜索直接复用 GLM_API_KEY（可能来自 articleApiKey）
  const zhipuKey = glmKey || searchApiKey

  // 1. 显式指定
  if (provider && provider !== "bing") {
    switch (provider.toLowerCase()) {
      case "zhipu": {
        const p = createZhipuProvider(zhipuKey)
        if (p.isReady()) return p
        logger.warn("SEARCH-FACTORY", `显式指定 zhipu 但未配置 Key`)
        return null
      }
      case "serper": {
        const p = createSerperProvider(serperKey)
        if (p.isReady()) return p
        logger.warn("SEARCH-FACTORY", `显式指定 serper 但未配置 Key`)
        return null
      }
      case "searxng": {
        return createSearxngProvider(searxngUrl)
      }
      default:
        logger.warn("SEARCH-FACTORY", `未知的 searchProvider: ${provider}`)
        break
    }
  }

  // 2. 自动检测：优先智谱（与 LLM 共用 API Key，零额外配置）
  if (zhipuKey) {
    const p = createZhipuProvider(zhipuKey)
    if (p.isReady()) {
      logger.info("SEARCH-FACTORY", "自动选择 zhipu（检测到 GLM_API_KEY）")
      return p
    }
  }

  // 3. 自动检测：Serper
  if (serperKey) {
    const p = createSerperProvider(serperKey)
    if (p.isReady()) {
      logger.info("SEARCH-FACTORY", "自动选择 serper（检测到 SERPER_API_KEY）")
      return p
    }
  }

  // 4. 自动检测：SearXNG
  if (searxngUrl) {
    logger.info("SEARCH-FACTORY", "自动选择 searxng（检测到 SEARXNG_URL）")
    return createSearxngProvider(searxngUrl)
  }

  // 5. 都没有 → 返回 null
  logger.warn("SEARCH-FACTORY", "未检测到任何可用搜索引擎配置")
  return null
}