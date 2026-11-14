import { isDeepSeekApiKey } from "../shared/aiPreferences.ts"
import type { AIConfig } from "./types.ts"
import type { DeepSeekConfig } from "./utils/deepseek.ts"

export const LEGACY_DEEPSEEK_KEY_PREFIX = "deepseek_api_key:"

export function isPrivateDeepSeekKey(key: string): boolean {
  return key.startsWith(LEGACY_DEEPSEEK_KEY_PREFIX)
}

export function resolveDeepSeekConfig(value: unknown): DeepSeekConfig {
  const apiKey = typeof value === "string" && isDeepSeekApiKey(value) ? value : ""
  return { enabled: Boolean(apiKey), apiKey }
}

export function withRequestDeepSeekKey<T extends AIConfig>(config: T, value: unknown): T & AIConfig {
  // 只认本次请求头。即使旧客户端在正文或任务设置中传了同名字段，也不会被用作凭据。
  return { ...config, deepseekApiKey: resolveDeepSeekConfig(value).apiKey }
}
