import { SERVER_AI_CONFIG } from "../config.ts"
import { logger } from "../logger.ts"

export type WechatCollectorProvider = "tikhub" | "dajiala"
export type WechatCollectorSort = "default" | "latest" | "hot"
export type WechatCollectorTimeRange = "all" | "day" | "week" | "half_year"

export interface WechatCollectorSearchInput {
  provider: WechatCollectorProvider
  query: string
  sort?: WechatCollectorSort
  publishTime?: WechatCollectorTimeRange
  cursor?: string
  page?: number
}

export interface WechatCollectorArticle {
  title: string
  snippet: string
  url: string
  source: string
  publishedAt: string
  provider: WechatCollectorProvider
}

export interface WechatCollectorSearchResponse {
  results: WechatCollectorArticle[]
  cursor: string
  hasMore: boolean
  total: number | null
}

export interface WechatCollectorArticleContent {
  title: string
  content: string
  url: string
  source: string
  publishedAt: string
}

type UnknownRecord = Record<string, unknown>

const TIKHUB_SEARCH_URL = "https://api.tikhub.io/api/v1/wechat_search/v2/fetch_search"
const TIKHUB_ARTICLE_URL = "https://api.tikhub.io/api/v1/wechat_mp/v2/fetch_article_detail_h5"
const DAJIALA_SEARCH_URL = "https://www.dajiala.com/fbmain/monitor/v3/web_search"
const DAJIALA_ARTICLE_URL = "https://www.dajiala.com/fbmain/monitor/v3/article_detail"
const REQUEST_TIMEOUT_MS = 35_000

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return ""
}

function findString(value: unknown, keys: string[], depth = 0): string {
  if (depth > 4) return ""
  const record = asRecord(value)
  if (!record) return ""

  for (const key of keys) {
    const direct = asString(record[key])
    if (direct) return direct
  }
  for (const nested of Object.values(record)) {
    if (!nested || typeof nested !== "object") continue
    const found = findString(nested, keys, depth + 1)
    if (found) return found
  }
  return ""
}

function findWechatUrl(value: unknown, depth = 0): string {
  if (depth > 5) return ""
  if (typeof value === "string") {
    const match = value.match(/https?:\/\/mp\.weixin\.qq\.com\/s(?:[/?][^\s"'<>]*)?/i)
    return match?.[0] || ""
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findWechatUrl(item, depth + 1)
      if (found) return found
    }
    return ""
  }
  const record = asRecord(value)
  if (!record) return ""

  const preferredKeys = ["doc_url", "url", "link", "article_url", "content_url", "jump_url"]
  for (const key of preferredKeys) {
    const found = findWechatUrl(record[key], depth + 1)
    if (found) return found
  }
  for (const nested of Object.values(record)) {
    const found = findWechatUrl(nested, depth + 1)
    if (found) return found
  }
  return ""
}

function findArticleUrl(record: UnknownRecord): string {
  const preferredKeys = ["doc_url", "url", "link", "article_url", "content_url", "jump_url"]
  for (const key of preferredKeys) {
    const found = findWechatUrl(record[key])
    if (found) return found
  }
  for (const key of ["jumpInfo", "jump_info", "urlInfo", "url_info"]) {
    const found = findWechatUrl(record[key])
    if (found) return found
  }
  return ""
}

function stripMarkup(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|section|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function normalizePublishedAt(value: unknown): string {
  const raw = asString(value)
  if (!raw) return ""
  if (/^\d{10,13}$/.test(raw)) {
    const timestamp = Number(raw) * (raw.length === 10 ? 1000 : 1)
    const date = new Date(timestamp)
    return Number.isNaN(date.getTime()) ? "" : date.toISOString()
  }
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? raw : date.toISOString()
}

function normalizeArticle(value: unknown, provider: WechatCollectorProvider): WechatCollectorArticle | null {
  const record = asRecord(value)
  if (!record) return null
  const url = findArticleUrl(record)
  if (!url) return null

  const title = stripMarkup(findString(record, ["title", "article_title", "name"])) || "公众号文章"
  const snippet = stripMarkup(findString(record, ["desc", "description", "snippet", "digest", "content"]))
  const sourceRecord = asRecord(record.source)
  const jumpInfo = asRecord(record.jumpInfo) || asRecord(record.jump_info)
  const source = stripMarkup(
    findString(record, ["nick_name", "nickname", "wx_name", "account_name", "source_name"])
    || findString(sourceRecord, ["title", "name", "nickname"])
    || findString(jumpInfo, ["nickName", "nickname"]),
  ) || "微信公众号"
  const publishedAt = normalizePublishedAt(findString(record, [
    "date",
    "publish_time",
    "create_time",
    "datetime",
    "dateTime",
  ]))

  return { title, snippet, url, source, publishedAt, provider }
}

function deduplicateArticles(items: WechatCollectorArticle[]): WechatCollectorArticle[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = item.url.replace(/#.*$/, "")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function collectArticleItems(value: unknown, provider: WechatCollectorProvider): WechatCollectorArticle[] {
  const output: WechatCollectorArticle[] = []

  const visit = (current: unknown, depth: number) => {
    if (depth > 5) return
    if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1)
      return
    }
    const record = asRecord(current)
    if (!record) return

    const article = normalizeArticle(record, provider)
    if (article) {
      output.push(article)
      return
    }
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === "object") visit(nested, depth + 1)
    }
  }

  visit(value, 0)
  return deduplicateArticles(output)
}

async function readJsonResponse(response: Response, providerLabel: string): Promise<UnknownRecord> {
  const text = await response.text()
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`${providerLabel}返回了无法解析的数据`)
  }
  const record = asRecord(payload)
  if (!record) throw new Error(`${providerLabel}返回格式不正确`)
  if (!response.ok) {
    const message = findString(record, ["message_zh", "message", "msg", "error"])
    throw new Error(message || `${providerLabel}请求失败（HTTP ${response.status}）`)
  }
  return record
}

async function searchWithTikhub(input: WechatCollectorSearchInput): Promise<WechatCollectorSearchResponse> {
  const apiKey = SERVER_AI_CONFIG.tikhubApiKey
  if (!apiKey) throw new Error("服务端未配置 TIKHUB_API_KEY")

  const response = await fetch(TIKHUB_SEARCH_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      keyword: input.query,
      business_type: "article",
      sort: input.sort || "default",
      publish_time: input.publishTime || "all",
      offset: 0,
      cursor: input.cursor || null,
      raw: false,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = await readJsonResponse(response, "TikHub")
  if (Number(payload.code) !== 200) {
    throw new Error(findString(payload, ["message_zh", "message"]) || `TikHub 返回错误码 ${String(payload.code)}`)
  }

  const data = asRecord(payload.data)
  const results = collectArticleItems(data?.items, "tikhub")
  return {
    results,
    cursor: asString(data?.cursor),
    hasMore: Boolean(data?.continue_flag),
    total: typeof data?.total === "number" ? data.total : null,
  }
}

const DAJIALA_SORT: Record<WechatCollectorSort, number> = {
  default: 0,
  latest: 1,
  hot: 2,
}

const DAJIALA_PUBLISH_TIME: Record<WechatCollectorTimeRange, number> = {
  all: 0,
  day: 1,
  week: 2,
  half_year: 3,
}

async function searchWithDajiala(input: WechatCollectorSearchInput): Promise<WechatCollectorSearchResponse> {
  const apiKey = SERVER_AI_CONFIG.dajialaApiKey
  if (!apiKey) throw new Error("服务端未配置 DAJIALA_API_KEY")

  const response = await fetch(DAJIALA_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: 1,
      keyword: input.query,
      search_type: 1,
      publish_time_type: DAJIALA_PUBLISH_TIME[input.publishTime || "all"],
      sort_type: DAJIALA_SORT[input.sort || "default"],
      currentPage: Math.max(1, input.page || 1),
      offset: 0,
      cookies_buffer: "",
      key: apiKey,
      verifycode: "",
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = await readJsonResponse(response, "极致了数据")
  if (Number(payload.code) !== 0 && Number(payload.code) !== 200) {
    throw new Error(findString(payload, ["msg", "message"]) || `极致了数据返回错误码 ${String(payload.code)}`)
  }

  const results = collectArticleItems(payload.data, "dajiala")
  const page = Math.max(1, input.page || 1)
  const totalPage = Number(payload.total_page) || page
  return {
    results,
    cursor: "",
    hasMore: page < totalPage,
    total: typeof payload.total === "number" ? payload.total : null,
  }
}

export async function searchWechatArticles(
  input: WechatCollectorSearchInput,
): Promise<WechatCollectorSearchResponse> {
  logger.info("WECHAT-COLLECTOR", "开始搜索公众号文章", {
    provider: input.provider,
    queryLength: input.query.length,
  })
  return input.provider === "tikhub"
    ? searchWithTikhub(input)
    : searchWithDajiala(input)
}

function articleContentFromPayload(
  payload: UnknownRecord,
  url: string,
): WechatCollectorArticleContent {
  const data = asRecord(payload.data) || payload
  const contentRecord = asRecord(data.content) || data
  const content = stripMarkup(findString(contentRecord, [
    "content_text",
    "content_noencode",
    "content",
    "article_content",
    "text",
  ]))
  if (!content) throw new Error("服务商未返回可用的文章正文")

  return {
    title: stripMarkup(findString(contentRecord, ["title", "article_title", "name"])) || "公众号文章",
    content,
    url,
    source: stripMarkup(findString(contentRecord, [
      "nick_name",
      "nickname",
      "wx_name",
      "account_name",
      "author",
    ])) || "微信公众号",
    publishedAt: normalizePublishedAt(findString(contentRecord, [
      "create_time",
      "create_timestamp",
      "ori_create_time",
      "publish_time",
      "date",
    ])),
  }
}

async function fetchTikhubArticle(url: string): Promise<WechatCollectorArticleContent> {
  const apiKey = SERVER_AI_CONFIG.tikhubApiKey
  if (!apiKey) throw new Error("服务端未配置 TIKHUB_API_KEY")
  const response = await fetch(TIKHUB_ARTICLE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, raw: false }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = await readJsonResponse(response, "TikHub")
  if (Number(payload.code) !== 200) {
    throw new Error(findString(payload, ["message_zh", "message"]) || `TikHub 返回错误码 ${String(payload.code)}`)
  }
  return articleContentFromPayload(payload, url)
}

async function fetchDajialaArticle(url: string): Promise<WechatCollectorArticleContent> {
  const apiKey = SERVER_AI_CONFIG.dajialaApiKey
  if (!apiKey) throw new Error("服务端未配置 DAJIALA_API_KEY")
  const response = await fetch(DAJIALA_ARTICLE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: apiKey, url }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = await readJsonResponse(response, "极致了数据")
  if (Number(payload.code) !== 0 && Number(payload.code) !== 200) {
    throw new Error(findString(payload, ["msg", "message"]) || `极致了数据返回错误码 ${String(payload.code)}`)
  }
  return articleContentFromPayload(payload, url)
}

export async function fetchWechatArticle(
  provider: WechatCollectorProvider,
  url: string,
): Promise<WechatCollectorArticleContent> {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:" || parsed.hostname !== "mp.weixin.qq.com" || !parsed.pathname.startsWith("/s")) {
    throw new Error("仅支持读取 mp.weixin.qq.com/s 开头的公众号文章")
  }
  return provider === "tikhub"
    ? fetchTikhubArticle(url)
    : fetchDajialaArticle(url)
}

export function getWechatCollectorReadiness() {
  return {
    tikhub: Boolean(SERVER_AI_CONFIG.tikhubApiKey),
    dajiala: Boolean(SERVER_AI_CONFIG.dajialaApiKey),
  }
}

export const wechatCollectorTestUtils = {
  collectArticleItems,
  articleContentFromPayload,
}
