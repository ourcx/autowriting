/**
 * WebFetcher — 网页抓取器
 *
 * 流程：
 *   1. NetworkPolicy 安全检查（防 SSRF、频率限制）
 *   2. HTTP 请求拿原始 HTML
 *   3. HTML 正文提取转 Markdown
 *
 * 支持：
 *   - URL 白名单（http/https 协议）
 *   - 屏蔽 localhost、内网地址
 *   - 请求频率限制（60s 内最多 30 次）
 *   - 响应体上限 5MB
 *   - 30s 整体超时
 */

import { logger } from "../../logger.ts"
import { assertPublicHttpUrl, fetchPublicUrl } from "../networkPolicy.ts"
import { extractWechatArticle, toMarkdown } from "./wechatArticleContent.ts"
import { load } from "cheerio"
import { extractXiaohongshuArticle, isXiaohongshuArticle } from "./xiaohongshuArticleContent.ts"
import { assessPageText, extractReadablePage } from "./pageContent.ts"

// ── 常量 ────────────────────────────────────────────────────────────────────────

/** 响应体上限 5MB */
const MAX_BODY_BYTES = 5 * 1024 * 1024
/** 请求超时 30s */
const REQUEST_TIMEOUT_MS = 30000
/** 频率限制：时间窗口 ms */
const RATE_WINDOW_MS = 60_000
/** 频率限制：窗口内最大请求数 */
const RATE_MAX_REQUESTS = 30

// ── 频率限制器 ──────────────────────────────────────────────────────────────────

const requestTimestamps: number[] = []

function checkRateLimit(): string | null {
  const now = Date.now()
  // 清理过期时间戳
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_WINDOW_MS) {
    requestTimestamps.shift()
  }
  if (requestTimestamps.length >= RATE_MAX_REQUESTS) {
    return "请求过于频繁，请稍后再试（60 秒内最多 30 次）"
  }
  requestTimestamps.push(now)
  return null
}

// ── 网络安全策略 ────────────────────────────────────────────────────────────────

/**
 * URL 安全检查
 * - 只允许 http/https 协议
 * - 屏蔽 localhost、127.0.0.1、内网地址
 */
function checkUrlSecurity(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return "无效的 URL 格式"
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== "http:" && protocol !== "https:") {
    return `不允许的协议: ${protocol}，仅支持 http/https`
  }

  const host = parsed.hostname.toLowerCase()

  // 屏蔽 localhost 及其变体
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
    return "禁止访问 localhost（安全策略）"
  }

  // 屏蔽内网地址段
  if (host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("172.")) {
    // 172.16.0.0 - 172.31.255.255 是内网
    if (host.startsWith("172.")) {
      const second = parseInt(host.split(".")[1] || "0", 10)
      if (second >= 16 && second <= 31) {
        return "禁止访问内网地址（安全策略）"
      }
    } else {
      return "禁止访问内网地址（安全策略）"
    }
  }

  // 屏蔽 0.0.0.0
  if (host === "0.0.0.0") {
    return "禁止访问无效地址（安全策略）"
  }

  return null
}

export function usablePageText(content: string): boolean {
  return assessPageText(content).usable
}

// ── 主抓取函数 ──────────────────────────────────────────────────────────────────

export interface FetchOptions {
  /** 最大字符数（默认 8000） */
  maxChars?: number
  signal?: AbortSignal
  sameOrigin?: boolean
  textOnly?: boolean
}

/**
 * 抓取指定 URL 的正文内容，返回 Markdown 格式
 *
 * @param url 要抓取的 URL
 * @param options 抓取选项
 * @returns 正文 Markdown 字符串，失败时返回空字符串
 */
export async function webFetch(url: string, options: FetchOptions = {}): Promise<string> {
  const { maxChars = 8000 } = options

  // 1. 安全检查
  const securityErr = checkUrlSecurity(url)
  if (securityErr) {
    logger.warn("WEB-FETCH", "安全检查未通过", { url, reason: securityErr })
    return `[安全拦截] ${securityErr}`
  }
  try {
    await assertPublicHttpUrl(url)
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "URL 安全检查失败"
    logger.warn("WEB-FETCH", "安全检查未通过", { url, reason })
    return `[安全拦截] ${reason}`
  }

  // 2. 频率限制
  const rateErr = checkRateLimit()
  if (rateErr) {
    logger.warn("WEB-FETCH", "频率限制", { url })
    return `[频率限制] ${rateErr}`
  }

  // 3. HTTP 请求
  try {
    const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline
    const resp = await fetchPublicUrl(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Accept-Encoding": "identity",
      },
      signal,
    }, options.sameOrigin)

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`)
    }

    // 流式读取，最多 5MB
    const contentType = resp.headers.get("content-type") || ""
    const body = await readBounded(resp)
    const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml")
      || (!contentType && /<!doctype\s+html|<html\b|<body\b/i.test(body.slice(0, 1000)))
    const wechatArticle = new URL(resp.url || url).hostname === "mp.weixin.qq.com"
    const xiaohongshuArticle = isXiaohongshuArticle(resp.url || url)

    if (!isHtml && (wechatArticle || (options.textOnly && !/^(text\/|application\/(?:json|xml))/i.test(contentType)))) {
      await resp.body?.cancel()
      return ""
    }
    if (!isHtml) {
      // 非 HTML 页面：直接返回文本
      const text = body
      logger.info("WEB-FETCH", "抓取成功（非HTML）", { url, length: text.length })
      return text.slice(0, maxChars)
    }

    // HTML 页面：提取正文
    const html = body

    // 检测是否为反爬页面
    if (html.length < 200) {
      logger.warn("WEB-FETCH", "页面内容过短，可能为JS渲染或防爬墙", { url })
      return `[未提取到正文] ${url} 可能是 JS 渲染页面或存在反爬机制，本期范围内不再重试。`
    }

    const wechatContent = wechatArticle ? extractWechatArticle(html, resp.url || url) : ""
    if (isBlockPage(html) && (!wechatArticle || !usablePageText(wechatContent))) {
      logger.warn("WEB-FETCH", "检测到反爬/验证页面", { url })
      return `[未提取到正文] ${url} 返回了人机验证或拦截页面，可能是 Cloudflare 等防护。`
    }

    // 4. HTML 正文提取
    const universityContent = load(html)("#vsb_content, .v_news_content").first().html()
    const readable = !wechatArticle && !xiaohongshuArticle && !universityContent
      ? extractReadablePage(html, resp.url || url) : undefined
    const markdown = wechatArticle ? wechatContent
      : xiaohongshuArticle ? extractXiaohongshuArticle(html, resp.url || url)
      : universityContent ? toMarkdown(universityContent, resp.url || url)
      : readable?.text || ""

    const quality = assessPageText(markdown)
    if ((!wechatArticle && markdown.length < 50) || !quality.usable) {
      logger.warn("WEB-FETCH", "网页没有可用正文", { url, length: markdown.length, reason: quality.reason,
        selector: readable?.selector || (universityContent ? "university-content" : wechatArticle ? "wechat-content" : xiaohongshuArticle ? "xiaohongshu-data" : "") })
      return `[未提取到正文] ${url} 可能是 JS 渲染页面或防爬墙，本期范围内不再重试。`
    }

    const truncated = markdown.slice(0, maxChars)
    logger.info("WEB-FETCH", "抓取成功", { url, length: truncated.length,
      selector: readable?.selector || (universityContent ? "university-content" : wechatArticle ? "wechat-content" : xiaohongshuArticle ? "xiaohongshu-data" : "") })
    return truncated
  } catch (err: unknown) {
    const e = err as Error
    if (e.name === "TimeoutError") {
      logger.warn("WEB-FETCH", "请求超时", { url })
      return `[超时] ${url} 请求超时（${REQUEST_TIMEOUT_MS / 1000}s），可能是目标服务器响应过慢。`
    }
    logger.error("WEB-FETCH", "抓取失败", { url, error: e.message })
    return ""
  }
}

/** 流式读取，最多 MAX_BODY_BYTES 字节 */
async function readBounded(resp: globalThis.Response): Promise<string> {
  const reader = resp.body?.getReader()
  if (!reader) {
    const text = await resp.text()
    return text.slice(0, MAX_BODY_BYTES)
  }

  const decoder = new TextDecoder()
  let total = 0
  const chunks: Uint8Array[] = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        total += value.length
        if (total >= MAX_BODY_BYTES) break
      }
    }
  } finally {
    reader.releaseLock()
  }

  // 合并 chunks
  const merged = new Uint8Array(Math.min(total, MAX_BODY_BYTES))
  let offset = 0
  for (const chunk of chunks) {
    const toCopy = Math.min(chunk.length, MAX_BODY_BYTES - offset)
    merged.set(chunk.subarray(0, toCopy), offset)
    offset += toCopy
    if (offset >= MAX_BODY_BYTES) break
  }

  const result = decoder.decode(merged, { stream: false })

  // 尝试从 Content-Type 按字符集解码
  try {
    const respCharset = resp.headers.get("content-type")?.match(/charset=([^\s;]+)/i)?.[1]
    if (respCharset && respCharset.toLowerCase() !== "utf-8") {
      // 简单字符集检测，优先用 UTF-8
      // 如果 UTF-8 解码结果中有乱码特征（大量 ?），尝试其他编码
      // 此处保持简单：如果 UTF-8 解码成功就不额外处理
    }
  } catch {
    // ignore
  }

  return result.slice(0, MAX_BODY_BYTES)
}

/** 检测是否为反爬/验证页面 */
function isBlockPage(html: string): boolean {
  const lower = html.toLowerCase()
  // Cloudflare challenge
  if (lower.includes("cf-challenge") || lower.includes("cf-browser-verification")) return true
  // 常见的验证码关键词
  if (lower.includes("captcha") && lower.includes("verify")) return true
  // 空白页
  if (html.trim().length < 50) return true
  return false
}
