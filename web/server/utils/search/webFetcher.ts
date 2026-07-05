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

// ── HTML 正文提取 ───────────────────────────────────────────────────────────────

/**
 * 清理噪声标签：script、style、nav、aside、footer、header、form、iframe
 * class/id 含 ads、banner、sidebar、comment 等关键词的元素一并删除
 */
function cleanNoiseTags(html: string): string {
  // 删除完整标签（script / style / nav / aside / footer / header / form / iframe）
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    //删除canvas\img等多媒体标签的内容
    .replace(/<canvas[^>]*>/gi, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<svg[^>]*>/gi, "")
    .replace(/<audio[^>]*>/gi, "")
    .replace(/<video[^>]*>/gi, "")
    .replace(/<canvas[\s\S]*?<\/canvas>/gi, "")
    // 删除带 noise class/id 的 div
    .replace(/<div[^>]*\b(?:class|id)\s*=\s*"[^"]*(?:ads|banner|sidebar|comment|advertisement|popup|nav|menu|footer|header)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
}

/**
 * 尝试从 HTML 中找到主内容容器
 * 优先找 <article>、<main>、[role=main]
 * 找不到则回退到 <body>
 */
function findMainContainer(html: string): string {
  // 尝试匹配 <article>...</article>
  const articleMatch = html.match(/<article[\s>][\s\S]*?<\/article>/i)
  if (articleMatch) return articleMatch[0]

  // 尝试匹配 <main>...</main>
  const mainMatch = html.match(/<main[\s>][\s\S]*?<\/main>/i)
  if (mainMatch) return mainMatch[0]

  // 尝试匹配 [role="main"]
  const roleMainMatch = html.match(/<[^>]+role\s*=\s*"main"[^>]*>[\s\S]*?<\/[^>]+>/i)
  if (roleMainMatch) return roleMainMatch[0]

  // 回退到 body
  const bodyMatch = html.match(/<body[\s>][\s\S]*?<\/body>/i)
  if (bodyMatch) return bodyMatch[0]

  return html
}

/**
 * HTML → Markdown 简易转换
 * - h1-h6 → # ~ ######
 * - p → 段落
 * - strong/b → **粗体**
 * - em/i → *斜体*
 * - a → [text](url)
 * - pre/code → 代码块
 * - li → - 列表
 * - br → 换行
 * - 其他标签去除
 */
function htmlToMarkdown(html: string): string {
  let md = html

  // 1. pre/code 代码块（在清标签之前处理）
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
    const decoded = code
      .replace(/</g, "<")
      .replace(/>/g, ">")
      .replace(/&/g, "&")
      .replace(/"/g, '"')
      .trim()
    return `\n\`\`\`\n${decoded}\n\`\`\`\n`
  })

  // 2. 标题 h1-h6
  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
    return `\n${"#".repeat(parseInt(level, 10))} ${stripInlineTags(content).trim()}\n`
  })

  // 3. 段落
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, content) => {
    return `\n${stripInlineTags(content).trim()}\n`
  })

  // 4. 列表项
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, content) => {
    return `- ${stripInlineTags(content).trim()}\n`
  })

  // 5. 换行
  md = md.replace(/<br\s*\/?>/gi, "\n")

  // 6. strong / b
  md = md.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, "**$1**")

  // 7. em / i
  md = md.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, "*$1*")

  // 8. 链接
  md = md.replace(/<a[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")

  // 9. 表格简易处理
  md = md.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    const rows = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []
    const mdRows: string[] = []
    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || []
      const mdCells = cells.map((c) => stripInlineTags(c.replace(/<[^>]+>/g, "").trim()))
      mdRows.push(`| ${mdCells.join(" | ")} |`)
      if (i === 0 && rows.length > 1) {
        mdRows.push(`| ${mdCells.map(() => "---").join(" | ")} |`)
      }
    }
    return `\n${mdRows.join("\n")}\n`
  })

  // 10. 去除所有剩余的 HTML 标签
  md = md.replace(/<[^>]+>/g, "")

  // 11. HTML 实体解码
  md = md
    .replace(/&nbsp;/g, " ")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))

  // 12. 压缩多余空行
  md = md
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return md
}

/** 去除内联标签但保留文本 */
function stripInlineTags(text: string): string {
  return text.replace(/<[^>]+>/g, "")
}

// ── 主抓取函数 ──────────────────────────────────────────────────────────────────

export interface FetchOptions {
  /** 最大字符数（默认 8000） */
  maxChars?: number
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

  // 2. 频率限制
  const rateErr = checkRateLimit()
  if (rateErr) {
    logger.warn("WEB-FETCH", "频率限制", { url })
    return `[频率限制] ${rateErr}`
  }

  // 3. HTTP 请求
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; autowriting-web-fetch/1.0)",
        "Accept": "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`)
    }

    // 流式读取，最多 5MB
    const contentType = resp.headers.get("content-type") || ""
    const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml")

    if (!isHtml) {
      // 非 HTML 页面：直接返回文本
      const text = await readBounded(resp)
      logger.info("WEB-FETCH", "抓取成功（非HTML）", { url, length: text.length })
      return text.slice(0, maxChars)
    }

    // HTML 页面：提取正文
    const html = await readBounded(resp)

    // 检测是否为反爬页面
    if (html.length < 200) {
      logger.warn("WEB-FETCH", "页面内容过短，可能为JS渲染或防爬墙", { url })
      return `[未提取到正文] ${url} 可能是 JS 渲染页面或存在反爬机制，本期范围内不再重试。`
    }

    if (isBlockPage(html)) {
      logger.warn("WEB-FETCH", "检测到反爬/验证页面", { url })
      return `[未提取到正文] ${url} 返回了人机验证或拦截页面，可能是 Cloudflare 等防护。`
    }

    // 4. HTML 正文提取
    const cleaned = cleanNoiseTags(html)
    const container = findMainContainer(cleaned)
    const markdown = htmlToMarkdown(container)

    if (markdown.length < 50) {
      logger.warn("WEB-FETCH", "正文提取后内容过短", { url, length: markdown.length })
      return `[未提取到正文] ${url} 可能是 JS 渲染页面或防爬墙，本期范围内不再重试。`
    }

    const truncated = markdown.slice(0, maxChars)
    logger.info("WEB-FETCH", "抓取成功", { url, length: truncated.length })
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
  let result = ""
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

  result = decoder.decode(merged, { stream: false })

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