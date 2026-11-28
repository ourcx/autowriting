import { normalizeWechatArticleUrl } from "../../../shared/wechatArticleUrl.ts"
import type { Page } from "playwright"
import { PublicPageBrowserSession } from "../publicPageBrowser.ts"
import { usablePageText } from "./webFetcher.ts"
import { extractWechatArticle } from "./wechatArticleContent.ts"

/** 元宝和写作 Agent 共用公开页面浏览器；这里仅保留公众号正文解析。 */
export async function readWechatArticleWithBrowser(rawUrl: string, signal: AbortSignal,
  createBrowser: (_signal: AbortSignal) => {
    open: (_url: string, _timeout?: number) => Promise<Pick<Page, "waitForFunction" | "content">>
    dispose: () => Promise<void>
  } = deadline => new PublicPageBrowserSession(deadline)): Promise<string> {
  const articleUrl = normalizeWechatArticleUrl(rawUrl)
  if (!articleUrl) return ""
  signal.throwIfAborted()
  const browser = createBrowser(signal)
  try {
    const page = await browser.open(articleUrl, 8000)
    await page.waitForFunction(() => {
      const body = document.querySelector<HTMLElement>("#js_content, .rich_media_content")
      return Boolean(body?.innerText.trim() || body?.querySelector("img[src], img[data-src]"))
    }, undefined, { timeout: 4000 }).catch(() => {})
    const content = extractWechatArticle(await page.content(), articleUrl)
    return usablePageText(content) ? content : ""
  } finally {
    await browser.dispose()
  }
}
