import { load } from "cheerio"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function isXiaohongshuArticle(url: string): boolean {
  const parsed = new URL(url)
  return /(^|\.)xiaohongshu\.com$/i.test(parsed.hostname) && /\/(?:explore|discovery\/item)\/[a-f0-9]+/i.test(parsed.pathname)
}

/** 只解析当前笔记的公开数据，不执行网页脚本，也不读取登录信息。 */
export function extractXiaohongshuArticle(html: string, articleUrl: string): string {
  if (!isXiaohongshuArticle(articleUrl)) return ""
  const id = new URL(articleUrl).pathname.match(/\/(?:explore|discovery\/item)\/([a-f0-9]+)/i)?.[1] || ""
  const $ = load(html)
  for (const element of $("script").toArray()) {
    const match = ($(element).html() || "").match(/\bwindow\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*\})\s*;?\s*$/)
    if (!match) continue
    try {
      // 小红书的序列化数据含 undefined；替换时跳过 JSON 字符串。
      const json = match[1].replace(/"(?:[^"\\]|\\[\s\S])*"|\bundefined\b/g, token => token === "undefined" ? "null" : token)
      const state = record(JSON.parse(json))
      const note = record(record(record(record(state.note).noteDetailMap)[id]).note)
      if (typeof note.noteId === "string" && note.noteId !== id) continue
      const description = typeof note.desc === "string" ? note.desc.trim() : ""
      if (!description) continue
      const title = typeof note.title === "string" ? note.title.trim() : ""
      const images = (Array.isArray(note.imageList) ? note.imageList : []).flatMap(value => {
        const image = record(value)
        const info = (Array.isArray(image.infoList) ? image.infoList : []).map(record)
        const raw = image.urlDefault || image.urlPre || info.find(item => typeof item.url === "string")?.url
        if (typeof raw !== "string") return []
        try {
          const url = new URL(raw, articleUrl)
          return ["http:", "https:"].includes(url.protocol) ? [`![笔记图片](${url.href})`] : []
        } catch { return [] }
      })
      return [title, description, ...images].filter(Boolean).join("\n\n")
    } catch { continue }
  }
  return ""
}
