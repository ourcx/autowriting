import { importXiumiImage } from "./apiHelpers"
import { sanitizeHtml } from "./sanitizeHtml"

// 保留秀米的 section、内联样式和 SVG；脚本与事件属性由现有清理器移除。
export async function localizeXiumiHtml(
  html: string,
  imageCache: Map<string, string>,
): Promise<string> {
  const root = new DOMParser().parseFromString(sanitizeHtml(html), "text/html").body
  const localize = async (value: string): Promise<string> => {
    let url: URL
    try { url = new URL(value, "https://xiumi.us") }
    catch { return value }
    if (!/(^|\.)(xiumi\.us|xiumius\.cn)$/.test(url.hostname)) return value
    url.protocol = "https:"
    const cached = imageCache.get(url.href)
    if (cached) return cached
    const uploaded = await importXiumiImage(url.href)
    imageCache.set(url.href, uploaded)
    return uploaded
  }

  // 串行转存、按 URL 去重；任意图片失败就保留上一次完整排版，允许重试。
  for (const element of root.querySelectorAll("img, image")) {
    const attribute = element.tagName.toLowerCase() === "img" ? "src"
      : element.hasAttribute("href") ? "href" : "xlink:href"
    const src = element.getAttribute(attribute) || element.getAttribute("data-src")
    if (src) element.setAttribute(attribute, await localize(src))
    element.removeAttribute("srcset")
    element.removeAttribute("data-src")
  }
  for (const element of root.querySelectorAll("[style]")) {
    let style = element.getAttribute("style") || ""
    for (const match of style.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
      const url = await localize(match[2])
      if (url !== match[2]) style = style.replace(match[0], `url("${url}")`)
    }
    element.setAttribute("style", style)
  }
  return root.innerHTML
}
