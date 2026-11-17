export const BROWSER_MODEL_HEADER = "X-Dashy-Browser-Model"
export const BROWSER_MODEL_PATH = "/api/browser-model"
export const BROWSER_MODEL_CHUNK = 32 * 1024
export const BROWSER_MODEL_RESPONSE_LIMIT = 8 * 1024 * 1024

export interface BrowserModelJob {
  id: string
  url: string
  body: Record<string, unknown>
  timeout: number
}

export function browserArticleEndpoint(provider: unknown, base: unknown): string | undefined {
  if (provider !== "openai" && provider !== "openai-compat") return
  return browserModelEndpoint(base, "/chat/completions")
}

export function browserEmbeddingEndpoint(config: Record<string, unknown>): string | undefined {
  const base = config.embeddingBaseUrl || (config.articleProvider !== "maas" && config.articleBaseUrl) || "https://api.openai.com/v1"
  return browserModelEndpoint(typeof base === "string" ? base.trim().replace(/\/+$/, "").replace(/\/embeddings$/i, "") : base, "/embeddings")
}

export function browserModelEndpoint(base: unknown, path: string): string | undefined {
  if (typeof base !== "string" || !base.trim()) return
  try {
    const url = new URL(base.trim())
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return
    // 国内兼容服务继续走服务器，兼容模式下的其他 HTTPS 地址由浏览器访问。
    if (["api.deepseek.com", "open.bigmodel.cn", "api.siliconflow.cn", "dashscope.aliyuncs.com", "ark.cn-beijing.volces.com"].includes(url.hostname)) return
    return url.origin + url.pathname.replace(/\/+$/, "") + path
  } catch {
    return
  }
}

export const OPENAI_IMAGE_ENDPOINT = "https://api.openai.com/v1/images/generations"

export function isStabilityCoverEndpoint(value: string): boolean {
  return /^https:\/\/api\.stability\.ai\/v1\/text-to-image\/v1\/engines\/[a-z0-9-]+\/text-to-image$/.test(value)
}
