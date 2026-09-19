export interface WechatCredentials {
  appId: string
  appSecret: string
}

const WECHAT_CREDENTIALS_KEY = "wechat_credentials"
const TOUTIAO_COOKIES_KEY = "toutiao_cookies"
const XIAOHONGSHU_COOKIES_KEY = "xiaohongshu_cookies"
const WECHAT_ANALYTICS_COOKIES_KEY = "wechat_analytics_cookies"
const WECHAT_ANALYTICS_REFRESH_KEY = "wechat_analytics_refresh"

export interface WechatAnalyticsRefreshConfig {
  enabled: boolean
  intervalHours: number
}

function scopedKey(prefix: string, userId: string): string {
  return `${prefix}:${userId}`
}

export function loadWechatCredentials(): WechatCredentials | null {
  try {
    const raw = localStorage.getItem(WECHAT_CREDENTIALS_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!isWechatCredentials(value)) return null
    return value
  } catch {
    return null
  }
}

export function saveWechatCredentials(credentials: WechatCredentials): void {
  localStorage.setItem(WECHAT_CREDENTIALS_KEY, JSON.stringify(credentials))
}

export function clearWechatCredentials(): void {
  localStorage.removeItem(WECHAT_CREDENTIALS_KEY)
}

export function getWechatHeaders(): Record<string, string> {
  const credentials = loadWechatCredentials()
  if (!credentials) return {}
  return {
    "X-Wx-AppId": credentials.appId,
    "X-Wx-AppSecret": credentials.appSecret,
  }
}

export function loadToutiaoCookies(): string {
  return localStorage.getItem(TOUTIAO_COOKIES_KEY) ?? ""
}

export function saveToutiaoCookies(cookies: string): void {
  localStorage.setItem(TOUTIAO_COOKIES_KEY, cookies)
}

export function clearToutiaoCookies(): void {
  localStorage.removeItem(TOUTIAO_COOKIES_KEY)
}

export function hasToutiaoCookies(): boolean {
  try {
    const value: unknown = JSON.parse(loadToutiaoCookies())
    return Array.isArray(value) && value.length > 0
  } catch {
    return false
  }
}

export function loadXiaohongshuCookies(): string {
  return localStorage.getItem(XIAOHONGSHU_COOKIES_KEY) ?? ""
}

export function saveXiaohongshuCookies(cookies: string): void {
  localStorage.setItem(XIAOHONGSHU_COOKIES_KEY, cookies)
}

export function clearXiaohongshuCookies(): void {
  localStorage.removeItem(XIAOHONGSHU_COOKIES_KEY)
}

export function hasXiaohongshuCookies(): boolean {
  try {
    const value: unknown = JSON.parse(loadXiaohongshuCookies())
    return Array.isArray(value) && value.length > 0
  } catch {
    return false
  }
}

export function loadWechatAnalyticsCookies(userId: string): string {
  return localStorage.getItem(scopedKey(WECHAT_ANALYTICS_COOKIES_KEY, userId)) ?? ""
}

export function saveWechatAnalyticsCookies(userId: string, cookies: string): void {
  localStorage.setItem(scopedKey(WECHAT_ANALYTICS_COOKIES_KEY, userId), cookies)
}

export function clearWechatAnalyticsCookies(userId: string): void {
  localStorage.removeItem(scopedKey(WECHAT_ANALYTICS_COOKIES_KEY, userId))
}

export function hasWechatAnalyticsCookies(userId: string): boolean {
  try {
    const value: unknown = JSON.parse(loadWechatAnalyticsCookies(userId))
    return Array.isArray(value) && value.length > 0
  } catch {
    return false
  }
}

export function loadWechatAnalyticsRefreshConfig(userId: string): WechatAnalyticsRefreshConfig {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(scopedKey(WECHAT_ANALYTICS_REFRESH_KEY, userId)) || "null")
    if (!value || typeof value !== "object") throw new Error("invalid")
    const source = value as Record<string, unknown>
    return {
      enabled: source.enabled === true,
      intervalHours: typeof source.intervalHours === "number" && Number.isFinite(source.intervalHours)
        ? Math.min(168, Math.max(1, Math.round(source.intervalHours)))
        : 24,
    }
  } catch {
    return { enabled: false, intervalHours: 24 }
  }
}

export function saveWechatAnalyticsRefreshConfig(userId: string, config: WechatAnalyticsRefreshConfig): void {
  localStorage.setItem(scopedKey(WECHAT_ANALYTICS_REFRESH_KEY, userId), JSON.stringify(config))
}

function isWechatCredentials(value: unknown): value is WechatCredentials {
  if (!value || typeof value !== "object") return false
  const credentials = value as Record<string, unknown>
  return typeof credentials.appId === "string"
    && credentials.appId.length > 0
    && typeof credentials.appSecret === "string"
    && credentials.appSecret.length > 0
}
