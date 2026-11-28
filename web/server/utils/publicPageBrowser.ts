import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright"
import { assertPublicHttpUrl, fetchPublicUrl } from "./networkPolicy.ts"
import { preparePublicBrowserContext, publicBrowserContextOptions, PUBLIC_BROWSER_ARGS } from "./publicBrowser.ts"

const VERIFICATION_HOST = /(?:^|\.)(?:recaptcha\.net|google\.com|gstatic\.com|hcaptcha\.com|hcaptcha\.net|geetest\.com|geetest\.net|tencentcloudapi\.com|captcha\.qq\.com|challenges\.cloudflare\.com|alicdn\.com)$/
const MAX_SESSION_BYTES = 64 * 1024 * 1024
let activeSessions = 0

export type PublicPageBrowserErrorCode = "busy" | "launch" | "navigation"

export class PublicPageBrowserError extends Error {
  constructor(readonly code: PublicPageBrowserErrorCode) {
    super(code)
  }
}

interface PublicPageBrowserOptions {
  verificationActive?: () => boolean
}

async function readResponseBytes(response: Response, limit: number, allowErrorPage: boolean): Promise<Buffer> {
  if ((!response.ok && !allowErrorPage) || !response.body) {
    await response.body?.cancel()
    throw new Error("Public resource is unavailable")
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) throw new Error("Public resource exceeds size limit")
      chunks.push(value)
    }
    return Buffer.concat(chunks, bytes)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

/**
 * 公开页面统一使用这一个匿名 Chromium 会话实现。
 * 调用方只负责解析页面内容，不再分别维护浏览器指纹、网络边界和资源上限。
 */
export class PublicPageBrowserSession {
  private browser?: Browser
  private context?: BrowserContext
  private currentPage?: Page
  private currentUrl = ""
  private fetchedBytes = 0
  private reserved = false
  private disposed = false
  private disposing?: Promise<void>
  private readonly options: PublicPageBrowserOptions
  private readonly abort = () => { void this.dispose() }

  constructor(private readonly signal: AbortSignal, options?: PublicPageBrowserOptions) {
    this.options = options || {}
    signal.addEventListener("abort", this.abort, { once: true })
  }

  get page(): Page | undefined { return this.currentPage }
  get sourceUrl(): string { return this.currentUrl }

  private async start(): Promise<void> {
    this.signal.throwIfAborted()
    if (this.disposed) throw new PublicPageBrowserError("navigation")
    if (this.browser) return
    if (activeSessions >= 3) throw new PublicPageBrowserError("busy")
    activeSessions++
    this.reserved = true
    try {
      this.browser = await chromium.launch({
        headless: true,
        chromiumSandbox: true,
        timeout: 15_000,
        args: PUBLIC_BROWSER_ARGS,
      })
      if (this.disposed || this.signal.aborted) {
        await this.dispose()
        this.signal.throwIfAborted()
        throw new PublicPageBrowserError("navigation")
      }
      const browser = this.browser
      this.context = await browser.newContext(publicBrowserContextOptions(browser, {
        serviceWorkers: "block", acceptDownloads: false, viewport: { width: 1280, height: 900 },
      }))
      await preparePublicBrowserContext(this.context)
      await this.context.routeWebSocket("**/*", socket => socket.close())
      await this.context.route("**/*", route => this.routeRequest(route))
      this.currentPage = await this.context.newPage()
      this.currentPage.setDefaultTimeout(8000)
      this.context.on("page", page => { if (page !== this.currentPage) void page.close().catch(() => {}) })
    } catch (error) {
      await this.dispose()
      if (error instanceof PublicPageBrowserError || this.signal.aborted) throw error
      throw new PublicPageBrowserError("launch")
    }
  }

  private async routeRequest(route: Route) {
    const request = route.request()
    const requestUrl = new URL(request.url())
    // 微信公开文章对 Node/TLS 指纹较敏感，固定官方域名的顶层 GET 交给 Chromium。
    // 跳转后的新请求仍会再次进入本路由，其他资源继续走统一的公网地址校验。
    if (request.method() === "GET" && request.resourceType() === "document"
      && requestUrl.hostname === "mp.weixin.qq.com") {
      await route.continue()
      return
    }
    const source = new URL(this.currentUrl)
    const sameSite = requestUrl.hostname === source.hostname
    const verificationHost = VERIFICATION_HOST.test(requestUrl.hostname)
    const verificationActive = this.options.verificationActive?.() === true
    const verificationRequest = (sameSite || verificationHost)
      && (verificationActive || /captcha|recaptcha|turnstile|challenge-platform|turing/i.test(requestUrl.href))
      && /captcha|verify|verification|challenge|turnstile|recaptcha|check|validate|security|turing|sec(?:_|\/)|fc\/|gettype|ajax\.php/i.test(requestUrl.href)
    if ((!["GET", "HEAD"].includes(request.method()) && !(request.method() === "POST" && verificationRequest))
      || ["media", "font"].includes(request.resourceType())) {
      await route.abort().catch(() => {})
      return
    }
    try {
      const resource = await assertPublicHttpUrl(request.url())
      const headers = request.headers()
      let response = await fetchPublicUrl(resource.href, {
        signal: AbortSignal.any([this.signal, AbortSignal.timeout(12_000)]),
        method: request.method(),
        ...(request.method() === "POST" ? { body: request.postData() || undefined } : {}),
        headers: {
          Accept: headers.accept || "*/*", "User-Agent": headers["user-agent"] || "Mozilla/5.0",
          "Accept-Language": "zh-CN,zh;q=0.9", "Accept-Encoding": "identity",
          ...(sameSite || verificationHost ? { Cookie: headers.cookie || "" } : {}),
          ...(verificationRequest ? {
            "Content-Type": headers["content-type"] || "application/x-www-form-urlencoded",
            Origin: headers.origin || source.origin, Referer: headers.referer || this.currentUrl,
          } : {}),
        },
      }, Boolean(headers.cookie || request.method() === "POST"))
      // 有些公开网站拒绝 Chromium 的标识，匿名文档再按普通 HTTP 读取一次。
      if (response.status === 403 && request.resourceType() === "document" && request.method() === "GET" && !headers.cookie) {
        const fallback = await fetchPublicUrl(resource.href, {
          signal: AbortSignal.any([this.signal, AbortSignal.timeout(12_000)]),
          headers: {
            Accept: "text/html,application/xhtml+xml,*/*", "User-Agent": "Mozilla/5.0",
            "Accept-Language": "zh-CN,zh;q=0.9", "Accept-Encoding": "identity",
          },
        }).catch(() => null)
        if (fallback?.ok) { await response.body?.cancel(); response = fallback }
        else await fallback?.body?.cancel()
      }
      if (request.resourceType() === "document" && response.url) this.currentUrl = response.url
      const body = await readResponseBytes(response, 12 * 1024 * 1024, request.resourceType() === "document")
      this.fetchedBytes += body.length
      if (this.fetchedBytes > MAX_SESSION_BYTES) throw new Error("Public browser session exceeds size limit")
      const cookies = response.headers.getSetCookie()
      const contentType = response.headers.get("content-type")
        || (request.resourceType() === "document" && /<!doctype\s+html|<html\b|<body\b/i.test(body.subarray(0, 1000).toString("utf8"))
          ? "text/html; charset=utf-8" : undefined)
      await route.fulfill({
        status: response.status,
        contentType,
        headers: cookies.length ? { "set-cookie": cookies.join("\n") } : undefined,
        body,
      })
    } catch {
      await route.abort().catch(() => {})
    }
  }

  async open(rawUrl: string, timeout = 20_000): Promise<Page> {
    const target = (await assertPublicHttpUrl(rawUrl)).href
    this.currentUrl = target
    await this.start()
    const page = this.currentPage
    if (!page) throw new PublicPageBrowserError("launch")
    try {
      await page.goto(target, { waitUntil: "domcontentloaded", timeout })
      return page
    } catch {
      this.signal.throwIfAborted()
      throw new PublicPageBrowserError("navigation")
    }
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing
    this.disposed = true
    this.signal.removeEventListener("abort", this.abort)
    const browser = this.browser
    this.browser = undefined
    this.context = undefined
    this.currentPage = undefined
    this.disposing = (async () => {
      await browser?.close().catch(() => {})
      if (this.reserved) {
        this.reserved = false
        activeSessions--
      }
    })()
    return this.disposing
  }
}
