import { normalizeWechatArticleUrl } from "../../../shared/wechatArticleUrl.ts"
import { assertPublicHttpUrl } from "../networkPolicy.ts"
import { usablePageText, webFetch } from "./webFetcher.ts"

export class ArticlePageReadError extends Error {}

async function fetchJinaText(url: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "text/plain",
    "X-Return-Format": "markdown",
    "X-Timeout": "7",
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const response = await fetch(`https://r.jina.ai/${url}`, { headers, signal, redirect: "error" })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error("Jina 未读到正文")
  }
  const text = await response.text()
  const marker = text.match(/(?:^|\n)Markdown Content:\s*\n/i)
  return marker?.index === undefined ? text : text.slice(marker.index + marker[0].length)
}

interface ReadArticlePageOptions {
  signal?: AbortSignal
  jinaApiKey?: string
  maxChars?: number
  sameOrigin?: boolean
  fetchWithDeepSeek?: (_url: string, _signal: AbortSignal) => Promise<string>
}

export async function readArticlePage(rawUrl: string, options: ReadArticlePageOptions = {}) {
  const { signal, maxChars = 8000, sameOrigin, jinaApiKey = "" } = options
  let url: string
  const wechat = normalizeWechatArticleUrl(rawUrl)
  try { url = (await assertPublicHttpUrl(wechat || rawUrl)).href }
  catch { throw new ArticlePageReadError("链接无效或无法通过公网访问。") }

  const fetchWithDeepSeek = options.fetchWithDeepSeek
  const attempts = [
    { method: "webfetch", read: (deadline: AbortSignal) => webFetch(url, { maxChars, sameOrigin, signal: deadline, textOnly: true }) },
    ...(fetchWithDeepSeek ? [{ method: "deepseek", read: (deadline: AbortSignal) => fetchWithDeepSeek(url, deadline) }] : []),
    { method: "jina", read: (deadline: AbortSignal) => fetchJinaText(url, jinaApiKey, deadline) },
  ]
  // 严格同源的抓取仅交给能逐次检查跳转地址的内置读取器。
  for (const { method, read } of sameOrigin ? attempts.slice(0, 1) : attempts) {
    signal?.throwIfAborted()
    const timeout = AbortSignal.timeout(method === "webfetch" ? 6000 : 8000)
    const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      const content = await read(deadline)
      if (usablePageText(content)) return { content: content.trim().slice(0, maxChars), method }
    } catch {
      signal?.throwIfAborted()
    }
  }
  throw new ArticlePageReadError(wechat
    ? "微信未返回可读正文，可能需要验证。可在浏览器打开原文，或选公众号专用解析服务重试。"
    : "原站暂时无法读取，或页面没有可提取的正文。")
}
