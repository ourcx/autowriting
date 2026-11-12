import { chromium } from 'playwright'
import { z } from 'zod'
import type { YuanbaoArticle, YuanbaoSearchResult } from '../../shared/yuanbaoSearch.ts'
import { webFetch } from './search/webFetcher.ts'

const PAGE_URL = 'https://so.qq.com/iaimode/search'
const SEARCH_URL = 'https://lizhiassistant.search.qq.com/browser_aimode/aimode/query_get'
const PAGE_ORIGINS = new Set([
  'https://so.qq.com',
  'https://search.sogoucdn.com',
  'https://snowflake.qq.com',
])
const MAX_STREAM_BYTES = 1024 * 1024
const MAX_ARTICLES = 10
const ARTICLE_CONCURRENCY = 3
let searching = false

export class YuanbaoSearchError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message)
  }
}

const citation = z.object({
  url: z.string(),
  title: z.string().nullish(),
  site_name: z.string().nullish(),
  abstract: z.string().nullish(),
})

const streamFrame = z.object({
  data_type: z.string().optional(),
  data: z.unknown().optional(),
  search_info: z.object({ search_results: z.array(z.unknown()) }).optional(),
  choices: z.array(z.object({
    delta: z.object({ content: z.string().nullish() }).optional(),
    finish_reason: z.string().nullish(),
  })).optional(),
})

function normalizeArticleUrl(value: string): string | null {
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (!['http:', 'https:'].includes(url.protocol)) return null
  if (url.hostname !== 'mp.weixin.qq.com' || url.username || url.password || url.port) return null

  // 元宝返回短链、带文章 ID 的长链或带签名的原文链接。
  const hasArticleId = url.searchParams.has('__biz') && url.searchParams.has('mid')
  const hasSignature = url.searchParams.has('signature')
  if (!/^\/s\/[\w-]+$/.test(url.pathname) && !(url.pathname === '/s' && (hasArticleId || hasSignature))) return null
  url.protocol = 'https:'
  url.hash = ''
  return url.href
}

export function parseYuanbaoStream(stream: string): YuanbaoSearchResult {
  const articles = new Map<string, YuanbaoArticle>()
  const answer: string[] = []
  let finished = false

  for (const line of stream.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (data === '[DONE]') {
      finished = true
      continue
    }

    let value: unknown
    try { value = JSON.parse(data) } catch { continue }
    const frame = streamFrame.safeParse(value)
    if (!frame.success) continue

    if (frame.data.data_type === 'anti_crawl') {
      const check = z.object({ status: z.literal('pass') }).safeParse(frame.data.data)
      if (!check.success) throw new YuanbaoSearchError('元宝暂未接受这次搜索，请稍后再试')
    }

    const choice = frame.data.choices?.[0]
    if (choice?.delta?.content) answer.push(choice.delta.content)
    if (choice?.finish_reason === 'stop') finished = true

    for (const candidate of frame.data.search_info?.search_results ?? []) {
      if (articles.size >= MAX_ARTICLES) break
      const result = citation.safeParse(candidate)
      if (!result.success) continue
      const url = normalizeArticleUrl(result.data.url)
      if (!url || articles.has(url)) continue
      articles.set(url, {
        url,
        title: result.data.title?.trim().slice(0, 160) || '公众号文章',
        source: result.data.site_name?.trim().slice(0, 80) || '微信公众号',
        snippet: result.data.abstract?.trim().slice(0, 1000) || '',
        content: '',
      })
    }
  }

  const text = answer.join('').trim()
  if (!finished || !text) throw new YuanbaoSearchError('元宝未返回完整回答，请重试')
  return { answer: text, articles: [...articles.values()] }
}

async function readSearchPage(query: string, signal: AbortSignal): Promise<YuanbaoSearchResult> {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 10000 })
  const closeBrowser = () => { void browser.close().catch(() => undefined) }
  signal.addEventListener('abort', closeBrowser, { once: true })

  try {
    signal.throwIfAborted()
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false })
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (PAGE_ORIGINS.has(url.origin) || url.href === SEARCH_URL) return route.continue()
      return route.abort()
    })

    const page = await context.newPage()
    const url = new URL(PAGE_URL)
    url.searchParams.set('query', `查找与「${query}」相关的微信公众号文章。请优先检索公众号，只引用 mp.weixin.qq.com 的原文，列出文章标题、公众号和原文链接。`)

    // 匿名页面自行发出搜索请求，由站点完成会话初始化和请求校验。
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url() === SEARCH_URL && response.request().method() === 'POST', { timeout: 20000 }),
      page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15000 }),
    ])
    if (!response.ok() || !response.headers()['content-type']?.includes('text/event-stream')) {
      throw new YuanbaoSearchError('元宝暂时无法提供搜索结果，请稍后再试')
    }

    const stream = await response.body()
    if (stream.byteLength > MAX_STREAM_BYTES) throw new YuanbaoSearchError('元宝返回的搜索结果过大')
    return parseYuanbaoStream(stream.toString('utf8'))
  } finally {
    signal.removeEventListener('abort', closeBrowser)
    await browser.close().catch(() => undefined)
  }
}

export async function searchYuanbao(query: string, clientSignal: AbortSignal): Promise<YuanbaoSearchResult> {
  if (searching) throw new YuanbaoSearchError('已有元宝搜索正在进行，请稍后再试', 429)
  searching = true
  const searchSignal = AbortSignal.any([clientSignal, AbortSignal.timeout(55000)])

  try {
    const result = await readSearchPage(query, searchSignal)
    for (let index = 0; index < result.articles.length; index += ARTICLE_CONCURRENCY) {
      clientSignal.throwIfAborted()
      const batch = result.articles.slice(index, index + ARTICLE_CONCURRENCY)
      await Promise.all(batch.map(async article => {
        const signal = AbortSignal.any([clientSignal, AbortSignal.timeout(6500)])
        const content = await webFetch(article.url, { signal, sameOrigin: true })
        if (content && !/^\[(?:安全拦截|频率限制|未提取到正文|超时)\]/.test(content)) article.content = content
      }))
    }
    return result
  } catch (error) {
    if (searchSignal.aborted && !clientSignal.aborted) throw new YuanbaoSearchError('元宝搜索超时，请稍后再试', 504)
    throw error
  } finally {
    searching = false
  }
}
