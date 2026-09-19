import type { Cookie } from "playwright"

const WECHAT_HOST = "mp.weixin.qq.com"

export function parseWechatCookieJson(value: unknown): Cookie[] {
  let parsed: unknown = value
  if (typeof value === "string") {
    if (value.length > 200_000) throw new Error("Cookie JSON 不能超过 200000 字")
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error("Cookie 必须是 JSON 数组")
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 200) {
    throw new Error("Cookie 必须是包含 1–200 项的 JSON 数组")
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`第 ${index + 1} 项 Cookie 格式不正确`)
    const source = item as Record<string, unknown>
    const name = typeof source.name === "string" ? source.name.trim() : ""
    const rawCookieValue = source.value
    const hasStringValue = typeof rawCookieValue === "string"
    const cookieValue = hasStringValue ? rawCookieValue : ""
    const domain = typeof source.domain === "string" && source.domain.trim()
      ? source.domain.trim().toLowerCase()
      : `.${WECHAT_HOST}`
    const hostname = domain.replace(/^\./, "")
    const allowedDomains = new Set([WECHAT_HOST, "weixin.qq.com", "qq.com"])
    if (!name || !hasStringValue || !allowedDomains.has(hostname)) {
      throw new Error(`第 ${index + 1} 项 Cookie 缺少 name/value，或域名不属于微信公众平台`)
    }
    const sameSite = source.sameSite === "Strict" || source.sameSite === "None" ? source.sameSite : "Lax"
    const rawExpires = typeof source.expires === "number" ? source.expires
      : typeof source.expirationDate === "number" ? source.expirationDate : undefined
    return {
      name,
      value: cookieValue,
      domain,
      path: typeof source.path === "string" && source.path.startsWith("/") ? source.path : "/",
      secure: source.secure !== false,
      httpOnly: source.httpOnly === true,
      sameSite,
      expires: rawExpires && Number.isFinite(rawExpires) && rawExpires > 0 ? rawExpires : -1,
    } satisfies Cookie
  })
}
