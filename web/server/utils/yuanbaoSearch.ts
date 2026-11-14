import { chromium, type Page } from 'playwright'
import { z } from 'zod'
import type { YuanbaoArticle, YuanbaoSearchResult } from '../../shared/yuanbaoSearch.ts'
import { readArticlePage } from './search/readArticlePage.ts'

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
const DAY_MS = 86_400_000
const beijingDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
})
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
  publish_time_ts: z.unknown().optional(),
  time: z.unknown().optional(),
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

function formatPublishedOn(timestamp: number): string {
  return beijingDate.format(timestamp).replaceAll('/', '-')
}

function resolvePublishedOn(timestamp: unknown, date: unknown, now: number, today: string): string | undefined {
  const numeric = typeof timestamp === 'number' ? timestamp
    : typeof timestamp === 'string' && /^\d{10}(?:\d{3})?$/.test(timestamp) ? Number(timestamp) : NaN
  const ms = numeric < 1e12 ? numeric * 1000 : numeric
  if (Number.isFinite(ms) && ms > 0 && ms <= now) return formatPublishedOn(ms)

  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return undefined
  const day = Date.parse(`${date}T00:00:00+08:00`)
  return Number.isFinite(day) && formatPublishedOn(day) === date ? date : undefined
}

function recencyGroup(publishedOn: string | undefined, today: number): number {
  if (!publishedOn) return 3
  const age = (today - Date.parse(`${publishedOn}T00:00:00+08:00`)) / DAY_MS
  if (age < 7) return 0
  if (age < 30) return 1
  return 2
}

export function parseYuanbaoStream(stream: string, now = Date.now()): YuanbaoSearchResult {
  const articles = new Map<string, YuanbaoArticle>()
  const answer: string[] = []
  const today = formatPublishedOn(now)
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
      const result = citation.safeParse(candidate)
      if (!result.success) continue
      const url = normalizeArticleUrl(result.data.url)
      if (!url || articles.has(url)) continue
      const publishedOn = resolvePublishedOn(result.data.publish_time_ts, result.data.time, now, today)
      articles.set(url, {
        url,
        title: result.data.title?.trim().slice(0, 160) || '公众号文章',
        source: result.data.site_name?.trim().slice(0, 80) || '微信公众号',
        snippet: result.data.abstract?.trim().slice(0, 1000) || '',
        content: '',
        ...(publishedOn ? { publishedOn } : {}),
      })
    }
  }

  const text = answer.join('').trim()
  if (!finished || !text) throw new YuanbaoSearchError('元宝未返回完整回答，请重试')
  const dayStart = Date.parse(`${today}T00:00:00+08:00`)
  // 元宝未提供阅读量等互动数据，同一时段保留它给出的排序。
  const ranked = [...articles.values()]
    .sort((a, b) => recencyGroup(a.publishedOn, dayStart) - recencyGroup(b.publishedOn, dayStart))
    .slice(0, MAX_ARTICLES)
  return { answer: text, articles: ranked }
}

type StreamCapture = { text: string } | { error: 'too-large' | 'invalid-stream' }

export async function readYuanbaoStream(page: Page, url: string, signal: AbortSignal): Promise<YuanbaoSearchResult> {
  const bindingName = '__dashyCaptureYuanbaoStream'
  let receive: (result: StreamCapture) => void = () => {}
  await page.exposeBinding(bindingName, ({ frame }, result: StreamCapture) => {
    if (frame === page.mainFrame()) receive(result)
  })

  // 元宝的 SSE 响应没有 charset，Playwright 获取响应体时会拿到 Chromium 已经误解码的文本。
  // 在页面里复制这一个响应的字节流，按 SSE 规定的 UTF-8 解码，原响应仍交给元宝页面处理。
  await page.addInitScript({ content: `
    (() => {
      const { bindingName, searchUrl, maxBytes } = ${JSON.stringify({ bindingName, searchUrl: SEARCH_URL, maxBytes: MAX_STREAM_BYTES })}
      const nativeFetch = globalThis.fetch
      function capture(result) {
        return globalThis[bindingName](result)
      }

      async function readBody(response) {
        const reader = response.clone().body?.getReader()
        if (!reader) {
          await capture({ error: 'invalid-stream' })
          return
        }

        const decoder = new TextDecoder('utf-8', { fatal: true })
        const chunks = []
        let size = 0
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > maxBytes) {
              void reader.cancel().catch(() => undefined)
              await capture({ error: 'too-large' })
              return
            }
            chunks.push(decoder.decode(value, { stream: true }))
          }
          chunks.push(decoder.decode())
          await capture({ text: chunks.join('') })
        } catch {
          void reader.cancel().catch(() => undefined)
          await capture({ error: 'invalid-stream' })
        } finally {
          reader.releaseLock()
        }
      }

      globalThis.fetch = async (input, init) => {
        const response = await nativeFetch(input, init)
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
        if (response.url === searchUrl && method.toUpperCase() === 'POST' && response.ok) {
          void readBody(response).catch(() => undefined)
        }
        return response
      }
    })()
  ` })

  let cleanup = () => {}
  const body = new Promise<string>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    cleanup = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    receive = result => {
      if (!result || typeof result !== 'object') return
      if ('text' in result && typeof result.text === 'string' && Buffer.byteLength(result.text, 'utf8') <= MAX_STREAM_BYTES) {
        resolve(result.text)
      } else if ('error' in result && result.error === 'too-large') {
        reject(new YuanbaoSearchError('元宝返回的搜索结果过大'))
      } else {
        reject(new YuanbaoSearchError('元宝返回的搜索结果无法解码，请重试'))
      }
    }
  })

  try {
    const response = page.waitForResponse(
      response => response.url() === SEARCH_URL && response.request().method() === 'POST',
      { timeout: 20000 },
    ).then(response => {
      if (!response.ok() || !response.headers()['content-type']?.includes('text/event-stream')) {
        throw new YuanbaoSearchError('元宝暂时无法提供搜索结果，请稍后再试')
      }
    })
    const [stream] = await Promise.all([
      body,
      response,
      page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }),
    ])
    return parseYuanbaoStream(stream)
  } finally {
    cleanup()
  }
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
    url.searchParams.set('query', [
      `查找与「${query}」相关的微信公众号文章。`,
      '优先选择近 30 天发布、近期讨论较多的相关报道和实用解析。符合条件的原文较少时，补充近 90 天的相关内容。',
      '只引用 mp.weixin.qq.com 的原文，列出文章标题、公众号和原文链接。不要猜测阅读量或点赞量。',
    ].join(''))

    // 匿名页面自行发出搜索请求，由站点完成会话初始化和请求校验。
    return await readYuanbaoStream(page, url.href, signal)
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
        try { article.content = (await readArticlePage(article.url, { signal, sameOrigin: true })).content }
        catch { clientSignal.throwIfAborted() }
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
