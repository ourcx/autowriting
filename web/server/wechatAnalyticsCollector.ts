import { chromium, type Browser, type Page } from "playwright"
import { WECHAT_ANALYTICS_CDP_URL } from "./config.ts"
import { logger } from "./logger.ts"
import {
  getWechatAnalyticsConfig,
  getWechatAnalyticsState,
  listEnabledWechatAnalyticsUsers,
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

let browserPromise: Promise<Browser> | null = null
const collecting = new Set<string>()
let scheduler: NodeJS.Timeout | null = null

function getEndpoint(): string {
  if (!WECHAT_ANALYTICS_CDP_URL) throw new Error("未配置本机浏览器连接")
  const url = new URL(WECHAT_ANALYTICS_CDP_URL)
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("浏览器连接只允许本机地址")
  }
  return url.toString()
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.connectOverCDP(getEndpoint(), { timeout: 10000 })
    browserPromise.then(browser => {
      browser.once("disconnected", () => { browserPromise = null })
    }).catch(() => { browserPromise = null })
  }
  return browserPromise
}

function isAnalyticsPage(page: Page): boolean {
  try {
    const url = new URL(page.url())
    return url.hostname === "mp.weixin.qq.com"
      && url.pathname === "/misc/appmsganalysis"
      && url.searchParams.get("type") === "daily_v2"
      && url.searchParams.has("token")
  } catch {
    return false
  }
}

async function findArticleListUrl(page: Page): Promise<string> {
  const readResource = () => page.evaluate(() =>
    performance.getEntriesByType("resource")
      .map(entry => entry.name)
      .find(url => url.includes("action=get_article_list")) || "",
  )
  const existing = await readResource()
  if (existing) return existing
  const responsePromise = page.waitForResponse(response => response.url().includes("action=get_article_list"), { timeout: 15000 })
  await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 })
  return (await responsePromise).url()
}

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

export async function readWechatAnalyticsFromBrowser(): Promise<WechatAnalyticsSnapshot> {
  const browser = await getBrowser()
  const pages = browser.contexts().flatMap(context => context.pages()).filter(isAnalyticsPage)
  if (pages.length !== 1) throw new Error("请在本机浏览器中只打开一个已登录的微信内容分析页")
  const page = pages[0]
  const sourceUrl = await findArticleListUrl(page)
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
}

export async function collectWechatAnalytics(userId: string): Promise<WechatAnalyticsSnapshot> {
  if (collecting.has(userId)) throw new Error("该账号的数据正在刷新")
  collecting.add(userId)
  const startedAt = new Date().toISOString()
  const previous = getWechatAnalyticsState(userId)
  saveWechatAnalyticsState(userId, { ...previous, status: "collecting", lastAttemptAt: startedAt, message: "正在读取已登录的微信后台" })
  try {
    const snapshot = await readWechatAnalyticsFromBrowser()
    const saved = saveWechatAnalyticsSnapshot(userId, snapshot)
    const config = getWechatAnalyticsConfig(userId)
    const nextRunAt = new Date(Date.now() + config.intervalHours * 3600000).toISOString()
    saveWechatAnalyticsState(userId, {
      status: "succeeded",
      lastAttemptAt: startedAt,
      lastSuccessAt: saved.collectedAt,
      nextRunAt,
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

async function runScheduledCollection(): Promise<void> {
  for (const userId of listEnabledWechatAnalyticsUsers()) {
    const config = getWechatAnalyticsConfig(userId)
    const state = getWechatAnalyticsState(userId)
    const due = !state.lastAttemptAt
      || Date.now() - new Date(state.lastAttemptAt).getTime() >= config.intervalHours * 3600000
    if (!due || collecting.has(userId)) continue
    try {
      await collectWechatAnalytics(userId)
    } catch (error) {
      logger.warn("WECHAT_ANALYTICS", "定时采集失败", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

export function startWechatAnalyticsScheduler(): void {
  if (scheduler || !WECHAT_ANALYTICS_CDP_URL) return
  scheduler = setInterval(() => { void runScheduledCollection() }, 15 * 60 * 1000)
  scheduler.unref()
  void runScheduledCollection()
}
