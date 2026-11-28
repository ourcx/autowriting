import type { Browser, BrowserContext, BrowserContextOptions } from "playwright"

export const PUBLIC_BROWSER_ARGS = ["--disable-blink-features=AutomationControlled"]

function chromeVersion(browser: Browser): string {
  return browser.version().match(/\d+(?:\.\d+){1,3}/)?.[0] || "141.0.0.0"
}

/**
 * 公开网页只需要接近普通桌面浏览器的匿名环境；不注入登录态，也不持久化 Cookie。
 * 避免使用 Playwright 默认的 HeadlessChrome 标识触发站点的误拦截。
 */
export function publicBrowserContextOptions(
  browser: Browser,
  options: BrowserContextOptions = {},
): BrowserContextOptions {
  return {
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion(browser)} Safari/537.36`,
    ...options,
  }
}

export async function preparePublicBrowserContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => undefined })
  })
}
