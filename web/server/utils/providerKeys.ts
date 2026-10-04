import type { AIConfig } from "../types.ts"

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function isZhipuEndpoint(value: unknown): boolean {
  return clean(value).includes("open.bigmodel.cn")
}

export function resolveZhipuApiKey(config: AIConfig, toolKey?: unknown): string {
  const explicit = clean(toolKey)
  if (explicit) return explicit

  const shared = clean(config.zhipuApiKey) || clean(config.glmApiKey)
  if (shared) return shared

  if (config.articleProvider === "zhipu" || isZhipuEndpoint(config.articleBaseUrl)) {
    return clean(config.articleApiKey)
  }
  return ""
}

export function resolveArticleApiKey(config: AIConfig): string {
  const explicit = clean(config.articleApiKey)
  if (explicit) return explicit
  if (config.articleProvider === "zhipu" || isZhipuEndpoint(config.articleBaseUrl)) {
    return resolveZhipuApiKey(config)
  }
  return ""
}

export function hasArticleApiKey(config: AIConfig): boolean {
  return config.articleProvider === "maas"
    ? Boolean(clean(config.maasApiKey))
    : Boolean(resolveArticleApiKey(config))
}

export function resolveEmbeddingApiKey(config: AIConfig): string {
  const explicit = clean(config.embeddingApiKey)
  if (explicit) return explicit
  if (isZhipuEndpoint(config.embeddingBaseUrl) || /^embedding-[23]$/i.test(clean(config.embeddingModel))) {
    return resolveZhipuApiKey(config)
  }
  return resolveArticleApiKey(config) || clean(config.coverApiKey)
}
