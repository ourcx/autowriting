import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

const MAX_REDIRECTS = 3

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [first, second] = parts
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0]
  return normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith("::ffff:127.")
    || normalized.startsWith("::ffff:10.")
    || normalized.startsWith("::ffff:192.168.")
    || normalized.startsWith("::ffff:169.254.")
    || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(normalized)
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPrivateIpv4(address)
  if (family === 6) return isPrivateIpv6(address)
  return true
}

export async function assertPublicHttpUrl(value: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("URL 格式不正确")
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("仅支持 HTTP 或 HTTPS URL")
  if (url.username || url.password) throw new Error("URL 不能包含认证信息")
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("URL 端口不允许访问")

  const host = url.hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("不允许访问本机或内网地址")
  }

  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("不允许访问本机或内网地址")
  }
  return url
}

export async function fetchPublicUrl(value: string, init: RequestInit = {}): Promise<Response> {
  let current = await assertPublicHttpUrl(value)
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await fetch(current, { ...init, redirect: "manual" })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get("location")
    if (!location) throw new Error("重定向响应缺少 Location")
    if (redirect === MAX_REDIRECTS) throw new Error("重定向次数过多")
    current = await assertPublicHttpUrl(new URL(location, current).toString())
  }
  throw new Error("重定向次数过多")
}
