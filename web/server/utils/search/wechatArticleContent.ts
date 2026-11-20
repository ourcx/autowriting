import { load } from "cheerio"
import TurndownService from "turndown"

function toMarkdown(html: string, articleUrl: string): string {
  const $ = load(html, {}, false)
  $("script, style, iframe, form, noscript").remove()
  $("img, a").each((_index, element) => {
    const node = $(element)
    const image = node.is("img")
    const attribute = image ? "src" : "href"
    const raw = (image ? node.attr("data-src") || node.attr("src") : node.attr("href"))?.trim()
    try {
      const url = new URL(raw || "", articleUrl)
      if (!raw || !["http:", "https:"].includes(url.protocol)) throw new Error("Invalid resource URL")
      node.attr(attribute, url.href)
    } catch {
      if (image) node.remove()
      else node.removeAttr(attribute)
    }
  })
  const converter = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })
  return converter.turndown($.html()).trim()
}

// 只读取已知字段中的字符串，不执行文章里的 JavaScript。
function embeddedText(scripts: string, field: string): string {
  const name = field === "desc" ? "\\bwindow\\s*\\.\\s*desc" : `(?:\\b${field}|["']${field}["'])`
  const match = new RegExp(`${name}\\s*[:=]\\s*(?:"((?:[^"\\\\]|\\\\[\\s\\S])*)"|'((?:[^'\\\\]|\\\\[\\s\\S])*)')`).exec(scripts)
  if (!match) return ""
  const raw = match[1] ?? match[2]
  try {
    const escaped = raw.replace(/\\(?:x([0-9a-fA-F]{2})|([\s\S]))|"/g, (escape, hex: string | undefined, character: string | undefined) => {
      if (escape === '"') return '\\"'
      if (hex) return `\\u00${hex}`
      if (character === "'") return "'"
      if (character === "\n" || character === "\r") return ""
      if (character === "v") return "\\u000b"
      if (character === "0") return "\\u0000"
      return escape
    })
    const text: unknown = JSON.parse(`"${escaped}"`)
    return typeof text === "string" ? text.trim() : ""
  } catch {
    return ""
  }
}

function embeddedHtml(text: string): string {
  // 图片分享说明可能把 HTML 再编码为实体；普通 JS 正文则可能只有纯文本。
  const decoded = /&(?:lt|#0*60|#x0*3c);/i.test(text) ? load(text).text() : text
  if (/<(?:p|div|section|h[1-6]|br|img|a|ul|ol|pre)\b/i.test(decoded)) return decoded
  return decoded.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>")
}

export function extractWechatArticle(html: string, articleUrl: string): string {
  const $ = load(html)
  // 普通图文只取正文容器，避免把导航、评论和验证提示当成文章。
  for (const element of $("#js_content, .rich_media_content").toArray()) {
    const content = toMarkdown($(element).html() || "", articleUrl)
    if (content) return content
  }
  const scripts = $("script").map((_index, element) => $(element).html() || "").get().join("\n")
  // 新版 JS 内嵌正文与图片分享说明分别使用不同字段。
  for (const field of ["content_noencode", "desc"]) {
    const text = embeddedText(scripts, field)
    if (!text) continue
    const content = toMarkdown(embeddedHtml(text), articleUrl)
    if (content) return content
  }
  return ""
}
