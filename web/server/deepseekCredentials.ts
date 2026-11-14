import { DEEPSEEK_APP_CONFIG } from "./config.ts"
import { getSetting, setSetting } from "./db.ts"
import type { DeepSeekConfig } from "./utils/deepseek.ts"

const KEY_PREFIX = "deepseek_api_key:"

export function isPrivateDeepSeekKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX)
}

export function getAccountDeepSeekKey(userId: string): string {
  const value = getSetting(KEY_PREFIX + userId)
  return typeof value === "string" ? value : ""
}

export function setAccountDeepSeekKey(userId: string, key: string): void {
  setSetting(KEY_PREFIX + userId, key)
}

export function resolveDeepSeekConfig(userId?: string, serverConfig: DeepSeekConfig = DEEPSEEK_APP_CONFIG): DeepSeekConfig {
  // 账号 Key 只供当前账号使用。服务端开关只决定是否开放部署级共享 Key。
  const accountKey = userId ? getAccountDeepSeekKey(userId) : ""
  return accountKey ? { enabled: true, apiKey: accountKey } : serverConfig
}
