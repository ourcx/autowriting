import { publicSourceUrl } from "../../writingResearch.ts"

const TRAILING_PUNCTUATION = /[。，、；：,.!?;:]+$/

/** 从 Markdown、HTML 和普通文本中提取公开 URL，不能把相邻标题吞进路径。 */
export function extractPublicSourceUrls(text: string, limit = 8): string[] {
  const raw: string[] = []
  for (const match of text.matchAll(/\]\((https?:\/\/[^\s<>()[\]）】]+)(?:\s+["'][^"']*["'])?\)/gi)) raw.push(match[1])
  for (const match of text.matchAll(/\bhref\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) raw.push(match[1])
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`()[\]（）【】]+/gi)) raw.push(match[0])
  const result: string[] = []
  for (const value of raw) {
    const url = publicSourceUrl(value.replace(TRAILING_PUNCTUATION, ""))
    if (!url || result.includes(url)) continue
    result.push(url)
    if (result.length >= limit) break
  }
  return result
}
