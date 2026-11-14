// 浏览器和后台任务只同步这些选项。连接地址、附加请求头和凭据留在浏览器。
export const AI_PREFERENCE_KEYS = [
  "articleProvider", "articleModel", "coverProvider", "siliconflowModel", "doubaoModel",
  "embeddingModel", "embeddingDimensions", "embeddingInstruction", "localEmbeddingModel",
  "embeddingBatchSize", "embeddingBatchDelayMs", "zhipuKnowledgeMode", "zhipuKnowledgeIds",
  "zhipuKnowledgeRecallMethod", "zhipuKnowledgeRerank", "searchProvider", "searchEngine",
  "cdnProvider", "githubRepo", "githubBranch", "githubPath",
] as const

export function aiPreferences(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  return Object.fromEntries(AI_PREFERENCE_KEYS.flatMap(key => {
    const field = input[key]
    return typeof field === "string" || typeof field === "number" || typeof field === "boolean" ? [[key, field]] : []
  }))
}

export const DEEPSEEK_KEY_HEADER = "x-deepseek-api-key"
export const isDeepSeekApiKey = (value: string): boolean => /^[\x21-\x7E]{1,256}$/.test(value)
