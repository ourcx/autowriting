export type CookiePlatform = "wechat" | "toutiao" | "xiaohongshu"
export type CookieInputSource = "json" | "cookie-header" | "curl"

interface BrowserCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: "Strict" | "Lax" | "None"
  expires?: number
}

export interface NormalizedCookieInput {
  cookiesJson: string
  count: number
  source: CookieInputSource
}

const MAX_INPUT_LENGTH = 200_000
const MAX_COOKIE_COUNT = 200

const PLATFORM_CONFIG: Record<CookiePlatform, { defaultDomain: string; allowedDomains: string[] }> = {
  wechat: {
    defaultDomain: ".mp.weixin.qq.com",
    allowedDomains: ["mp.weixin.qq.com", "weixin.qq.com", "qq.com"],
  },
  toutiao: {
    defaultDomain: ".toutiao.com",
    allowedDomains: ["toutiao.com"],
  },
  xiaohongshu: {
    defaultDomain: ".xiaohongshu.com",
    allowedDomains: ["xiaohongshu.com"],
  },
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function normalizeSameSite(value: unknown): BrowserCookie["sameSite"] {
  const normalized = typeof value === "string" ? value.toLowerCase() : ""
  if (normalized === "strict") return "Strict"
  if (normalized === "none" || normalized === "no_restriction") return "None"
  return "Lax"
}

function isAllowedDomain(domain: string, platform: CookiePlatform): boolean {
  const hostname = domain.replace(/^\./, "").toLowerCase()
  if (platform === "wechat") return PLATFORM_CONFIG.wechat.allowedDomains.includes(hostname)
  return PLATFORM_CONFIG[platform].allowedDomains.some(
    allowed => hostname === allowed || hostname.endsWith(`.${allowed}`),
  )
}

function normalizeJsonCookies(items: unknown[], platform: CookiePlatform): BrowserCookie[] {
  if (items.length === 0 || items.length > MAX_COOKIE_COUNT) {
    throw new Error(`登录信息必须包含 1–${MAX_COOKIE_COUNT} 项 Cookie`)
  }

  const cookies = items.map((item, index) => {
    const source = asRecord(item)
    if (!source) throw new Error(`第 ${index + 1} 项 Cookie 格式不正确`)
    const name = typeof source.name === "string" ? source.name.trim() : ""
    const hasStringValue = typeof source.value === "string"
    if (!name || !hasStringValue) throw new Error(`第 ${index + 1} 项 Cookie 缺少 name 或 value`)

    let domain = typeof source.domain === "string" ? source.domain.trim().toLowerCase() : ""
    if (!domain && typeof source.url === "string") {
      try {
        domain = new URL(source.url).hostname.toLowerCase()
      } catch {
        domain = ""
      }
    }
    if (!domain) domain = PLATFORM_CONFIG[platform].defaultDomain

    const rawExpires = typeof source.expires === "number"
      ? source.expires
      : typeof source.expirationDate === "number" ? source.expirationDate : undefined
    const cookie: BrowserCookie = {
      name,
      value: source.value as string,
      domain,
      path: typeof source.path === "string" && source.path.startsWith("/") ? source.path : "/",
      secure: source.secure !== false,
      httpOnly: source.httpOnly === true,
      sameSite: normalizeSameSite(source.sameSite),
    }
    if (rawExpires !== undefined && Number.isFinite(rawExpires) && rawExpires > 0) {
      cookie.expires = rawExpires
    }
    return cookie
  }).filter(cookie => isAllowedDomain(cookie.domain, platform))

  if (cookies.length === 0) throw new Error("没有找到当前平台的 Cookie，请确认复制的是对应创作后台")
  return deduplicateCookies(cookies)
}

function extractQuotedOptions(input: string, option: string): string[] {
  const expression = new RegExp(`(?:^|\\s)${option}\\s+\\$?(['"])([\\s\\S]*?)\\1`, "gi")
  return [...input.matchAll(expression)].map(match => match[2])
}

function extractCookieHeader(input: string): { value: string; source: CookieInputSource } {
  const headerOption = extractQuotedOptions(input, "(?:-H|--header)")
    .find(header => /^cookie\s*:/i.test(header))
  if (headerOption) {
    return { value: headerOption.replace(/^cookie\s*:\s*/i, ""), source: "curl" }
  }

  const cookieOption = extractQuotedOptions(input, "(?:-b|--cookie)")[0]
  if (cookieOption) return { value: cookieOption, source: "curl" }

  const headerLine = input.split(/\r?\n/).find(line => /^\s*cookie\s*:/i.test(line))
  if (headerLine) {
    return { value: headerLine.replace(/^\s*cookie\s*:\s*/i, "").trim(), source: "cookie-header" }
  }

  if (/^curl(?:\s|$)/i.test(input)) {
    throw new Error("cURL 中没有找到 Cookie，请先登录平台并复制一个已登录请求")
  }
  if (input.includes("\n")) {
    throw new Error("没有找到 Cookie 请求头")
  }
  return { value: input.replace(/^cookie\s*:\s*/i, ""), source: "cookie-header" }
}

function normalizeHeaderCookies(value: string, platform: CookiePlatform): BrowserCookie[] {
  const pairs = value.split(";").map(item => item.trim()).filter(Boolean)
  if (pairs.length === 0 || pairs.length > MAX_COOKIE_COUNT) {
    throw new Error(`登录信息必须包含 1–${MAX_COOKIE_COUNT} 项 Cookie`)
  }

  const cookies = pairs.map((pair, index) => {
    const separator = pair.indexOf("=")
    if (separator <= 0) throw new Error(`第 ${index + 1} 项 Cookie 缺少“=”`)
    const name = pair.slice(0, separator).trim()
    let cookieValue = pair.slice(separator + 1).trim()
    if (!name || /[\s;=]/.test(name)) throw new Error(`第 ${index + 1} 项 Cookie 名称不正确`)
    if (
      cookieValue.length >= 2
      && cookieValue[0] === cookieValue[cookieValue.length - 1]
      && (cookieValue[0] === "'" || cookieValue[0] === "\"")
    ) {
      cookieValue = cookieValue.slice(1, -1)
    }
    return {
      name,
      value: cookieValue,
      domain: PLATFORM_CONFIG[platform].defaultDomain,
      path: "/",
      secure: true,
      httpOnly: false,
      sameSite: "Lax" as const,
    }
  })
  return deduplicateCookies(cookies)
}

function deduplicateCookies(cookies: BrowserCookie[]): BrowserCookie[] {
  const unique = new Map<string, BrowserCookie>()
  cookies.forEach(cookie => unique.set(`${cookie.domain}\n${cookie.path}\n${cookie.name}`, cookie))
  return [...unique.values()]
}

export function normalizePlatformCookieInput(input: string, platform: CookiePlatform): NormalizedCookieInput {
  const value = input.trim()
  if (!value) throw new Error("请先粘贴登录信息")
  if (value.length > MAX_INPUT_LENGTH) throw new Error(`登录信息不能超过 ${MAX_INPUT_LENGTH} 字`)

  if (value.startsWith("[") || value.startsWith("{")) {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error("Cookie JSON 格式不正确")
    }
    const record = asRecord(parsed)
    const items = Array.isArray(parsed) ? parsed : record?.cookies
    if (!Array.isArray(items)) throw new Error("Cookie JSON 必须是数组，或包含 cookies 数组")
    const cookies = normalizeJsonCookies(items, platform)
    return { cookiesJson: JSON.stringify(cookies), count: cookies.length, source: "json" }
  }

  const extracted = extractCookieHeader(value)
  const cookies = normalizeHeaderCookies(extracted.value, platform)
  return { cookiesJson: JSON.stringify(cookies), count: cookies.length, source: extracted.source }
}

export function cookieInputSourceLabel(source: CookieInputSource): string {
  if (source === "curl") return "cURL"
  if (source === "cookie-header") return "Cookie 请求头"
  return "Cookie JSON"
}
