import { chromium } from "playwright"
import { normalizeWechatArticleUrl } from "../../../shared/wechatArticleUrl.ts"
import { fetchPublicUrl } from "../networkPolicy.ts"
import { usablePageText } from "./webFetcher.ts"

const ARTICLE_ORIGIN = "https://mp.weixin.qq.com"
const SCRIPT_ORIGINS = new Set([ARTICLE_ORIGIN, "https://res.wx.qq.com"])
const MAX_RESOURCE_BYTES = 5 * 1024 * 1024
let activeReaders = 0

export async function readWechatArticleWithBrowser(rawUrl: string, signal: AbortSignal): Promise<string> {
  const articleUrl = normalizeWechatArticleUrl(rawUrl)
  if (!articleUrl || activeReaders >= 3) return ""
  signal.throwIfAborted()
  activeReaders++
  try {
    // 生产机冷启动曾超过 5 秒，为沙箱初始化留足时间。
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 15_000 })
    const close = () => { void browser.close().catch(() => {}) }
    signal.addEventListener("abort", close, { once: true })
    try {
      signal.throwIfAborted()
      const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false })
      await context.routeWebSocket("**/*", socket => socket.close())
      const page = await context.newPage()
      await context.route("**/*", async route => {
        const request = route.request()
        const url = new URL(request.url())
        const type = request.resourceType()
        const articleDocument = type === "document" && url.href === articleUrl
        const articleScript = type === "script" && SCRIPT_ORIGINS.has(url.origin)
        const articleData = ["fetch", "xhr"].includes(type) && url.origin === ARTICLE_ORIGIN && /^\/s(?:\/|$)/.test(url.pathname)
        if (request.method() !== "GET" || (!articleDocument && !articleScript && !articleData)) {
          await route.abort()
          return
        }
        // 由同源 HTTP 读取器校验跳转和公网地址，避免浏览器自动跟随资源跳转。
        try {
          const headers = request.headers()
          const response = await fetchPublicUrl(url.href, {
            signal,
            headers: {
              "User-Agent": headers["user-agent"] || "",
              Accept: headers.accept || "*/*",
              "Accept-Language": "zh-CN,zh;q=0.9",
            },
          }, true)
          if (!response.ok || (articleDocument && response.url && !normalizeWechatArticleUrl(response.url))) {
            await response.body?.cancel()
            await route.abort()
            return
          }
          const reader = response.body?.getReader()
          if (!reader) { await route.abort(); return }
          const chunks: Uint8Array[] = []
          let bytes = 0
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > MAX_RESOURCE_BYTES) { await reader.cancel(); await route.abort(); return }
            chunks.push(value)
          }
          await route.fulfill({
            status: response.status,
            contentType: response.headers.get("content-type") || undefined,
            body: Buffer.concat(chunks, bytes),
          })
        } catch {
          await route.abort().catch(() => {})
        }
      })
      await page.goto(articleUrl, { waitUntil: "domcontentloaded", timeout: 8000 })
      const content = await page.waitForFunction(() => {
        const body = document.querySelector<HTMLElement>("#js_content")?.innerText.trim()
        return body && body.length >= 12 ? body : false
      }, undefined, { timeout: 4000 })
      const text = await content.jsonValue()
      return typeof text === "string" && usablePageText(text) ? text : ""
    } finally {
      signal.removeEventListener("abort", close)
      await browser.close().catch(() => {})
    }
  } finally {
    activeReaders--
  }
}
