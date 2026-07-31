export interface WechatCredentials {
  appId: string
  appSecret: string
}

const WECHAT_CREDENTIALS_KEY = "wechat_credentials"
const TOUTIAO_COOKIES_KEY = "toutiao_cookies"

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

function isWechatCredentials(value: unknown): value is WechatCredentials {
  if (!value || typeof value !== "object") return false
  const credentials = value as Record<string, unknown>
  return typeof credentials.appId === "string"
    && credentials.appId.length > 0
    && typeof credentials.appSecret === "string"
    && credentials.appSecret.length > 0
}
