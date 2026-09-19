import { chromium, type Page } from "playwright"
import { parseWechatCookieJson } from "./utils/platformCookies.ts"
import {
  getWechatAnalyticsState,
  saveWechatAnalyticsSnapshot,
  saveWechatAnalyticsState,
} from "./wechatAnalyticsStore.ts"
import { wechatAnalyticsSchema, type WechatAnalyticsSnapshot } from "../shared/wechatAnalytics.ts"

interface WechatArticleRow {
  ref_date?: unknown
  title?: unknown
  msg_id?: unknown
  item_idx?: unknown
  total_read_uv?: unknown
  read_uv_ratio?: unknown
}

interface WechatArticleListResponse {
  base_resp?: { ret?: unknown }
  article_list?: WechatArticleRow[]
  next_offset?: unknown
}

const collecting = new Set<string>()

function parseArticleRow(row: WechatArticleRow) {
  const title = typeof row.title === "string" ? row.title.trim() : ""
  const publishedAt = typeof row.ref_date === "string" ? row.ref_date.replaceAll("/", "-") : ""
  const messageId = typeof row.msg_id === "number" || typeof row.msg_id === "string" ? String(row.msg_id) : ""
  const itemIndex = typeof row.item_idx === "number" || typeof row.item_idx === "string" ? String(row.item_idx) : ""
  const readers = Number(row.total_read_uv)
  const ratio = Number(row.read_uv_ratio)
  if (!title || !messageId || !itemIndex || !Number.isSafeInteger(readers) || readers < 0 || !Number.isFinite(ratio)) {
    throw new Error("微信文章列表字段发生变化")
  }
  return {
    id: `${messageId}_${itemIndex}`,
    title,
    publishedAt,
    reads: readers,
    shareOfReads: Math.round((ratio <= 1 ? ratio * 100 : ratio) * 100) / 100,
  }
}

async function readAllArticles(page: Page, sourceUrl: string) {
  const articles = []
  let offset = 0
  let nextOffset: number
  do {
    const url = new URL(sourceUrl)
    url.searchParams.set("offset", String(offset))
    url.searchParams.set("count", "100")
    const response = await page.context().request.get(url.toString(), { timeout: 15000 })
    if (!response.ok()) throw new Error(`微信文章列表请求失败（HTTP ${response.status()}）`)
    const body = await response.json() as WechatArticleListResponse
    if (body.base_resp?.ret !== 0 || !Array.isArray(body.article_list)) throw new Error("微信文章列表返回异常")
    articles.push(...body.article_list.map(parseArticleRow))
    nextOffset = Number(body.next_offset) || 0
    if (nextOffset <= offset || body.article_list.length === 0) break
    offset = nextOffset
  } while (articles.length < 500)
  return { articles: articles.slice(0, 500), nextOffset }
}

async function resolveWechatToken(page: Page): Promise<string> {
  await page.goto("https://mp.weixin.qq.com/", { waitUntil: "domcontentloaded", timeout: 20000 })
  if (/login|cgi-bin\/login/i.test(page.url())) throw new Error("公众号 Cookie 已失效，请重新导出后绑定")
  const current = new URL(page.url()).searchParams.get("token")
  if (current) return current
  const token = await page.locator('a[href*="token="]').first().getAttribute("href").then(href => {
    if (!href) return ""
    return new URL(href, "https://mp.weixin.qq.com").searchParams.get("token") || ""
  }).catch(() => "")
  if (!token) throw new Error("未能从公众号登录态取得 token，请重新导出 Cookie")
  return token
}

export async function readWechatAnalyticsFromCookies(rawCookies: unknown): Promise<WechatAnalyticsSnapshot> {
  const cookies = parseWechatCookieJson(rawCookies)
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  try {
    await context.addCookies(cookies)
    const page = await context.newPage()
    const token = await resolveWechatToken(page)
    const analyticsUrl = new URL("https://mp.weixin.qq.com/misc/appmsganalysis")
    analyticsUrl.searchParams.set("action", "report")
    analyticsUrl.searchParams.set("type", "daily_v2")
    analyticsUrl.searchParams.set("token", token)
    analyticsUrl.searchParams.set("lang", "zh_CN")
    const articleListResponse = page.waitForResponse(response => response.url().includes("action=get_article_list"), { timeout: 20000 })
    await page.goto(analyticsUrl.toString(), { waitUntil: "domcontentloaded", timeout: 20000 })
    const sourceUrl = (await articleListResponse).url()
    await page.locator('input[placeholder="开始日期"]').first().waitFor({ state: "visible", timeout: 10000 })
    const [{ articles, nextOffset }, accountName, period, trafficSources] = await Promise.all([
      readAllArticles(page, sourceUrl),
      page.locator(".account_box-panel-head__nickname").first().textContent(),
      page.locator('input[placeholder="开始日期"], input[placeholder="结束日期"]').evaluateAll(inputs =>
        inputs.slice(0, 2).map(input => (input as HTMLInputElement).value.replaceAll("/", "-")),
      ),
      page.locator('[role="img"][aria-label]').evaluateAll(elements => elements.flatMap(element => {
        const match = element.getAttribute("aria-label")?.match(/^([^,]+),\s*(\d+(?:\.\d+)?)%?\.?$/)
        return match ? [{ name: match[1].trim(), percent: Number(match[2]) }] : []
      })),
    ])
    return wechatAnalyticsSchema.parse({
      version: 1,
      source: "wechat-browser",
      accountName: accountName?.trim(),
      collectedAt: new Date().toISOString(),
      period: { start: period[0], end: period[1] },
      scope: "period-article-list",
      metric: "period-readers",
      collection: { complete: nextOffset === 0, nextOffset },
      trafficSources,
      articles,
    })
  } finally {
    await context.close()
    await browser.close()
  }
}

export async function collectWechatAnalytics(userId: string, rawCookies: unknown): Promise<WechatAnalyticsSnapshot> {
  if (collecting.has(userId)) throw new Error("该账号的数据正在刷新")
  collecting.add(userId)
  const startedAt = new Date().toISOString()
  const previous = getWechatAnalyticsState(userId)
  saveWechatAnalyticsState(userId, { ...previous, status: "collecting", lastAttemptAt: startedAt, message: "正在使用 Cookie 读取微信后台" })
  try {
    const saved = saveWechatAnalyticsSnapshot(userId, await readWechatAnalyticsFromCookies(rawCookies))
    saveWechatAnalyticsState(userId, {
      status: "succeeded",
      lastAttemptAt: startedAt,
      lastSuccessAt: saved.collectedAt,
      message: `已采集 ${saved.articles.length} 篇文章`,
    })
    return saved
  } catch (error) {
    const message = error instanceof Error ? error.message : "微信数据采集失败"
    saveWechatAnalyticsState(userId, { ...previous, status: "failed", lastAttemptAt: startedAt, message })
    throw error
  } finally {
    collecting.delete(userId)
  }
}
