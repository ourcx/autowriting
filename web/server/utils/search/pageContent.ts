import { load } from "cheerio"
import { toMarkdown } from "./wechatArticleContent.ts"

const BLOCK_PAGE = /(?:环境异常.{0,40}完成验证|完成安全验证后|此内容因违规无法查看|该内容已被发布者删除|该内容已删除|该内容暂时无法查看|访问过于频繁|robot check|just a moment|access denied|target .* returned status code|warning: .*captcha)/i
const STATUS_PAGE = /^(?:#+\s*)?(?:403(?:\s+forbidden)?|404(?:\s+not found)?|forbidden|502\s+bad gateway|503\s+service unavailable)(?:\s|$)/i
const FAILURE_PREFIX = /^\[(?:安全拦截|频率限制|抓取失败|内容提取失败|未提取到正文|超时)\]/
const MAIN_SELECTORS = [
  "#js_content", ".rich_media_content", "#vsb_content", ".v_news_content",
  "[itemprop='articleBody']", "#text_content", "#wza_content", ".article-content",
  ".article_content", ".post-content", ".entry-content", ".news-content",
  ".detail-content", ".content-detail", ".dy-article", "article", "main", "[role='main']",
]
const NOISE_SELECTOR = [
  "script", "style", "noscript", "template", "iframe", "canvas", "svg", "video", "audio",
  "nav", "header", "footer", "aside", "form", "button", "input", "select", "textarea",
  "[aria-hidden='true']", "[class*='advert']", "[class*='recommend']", "[class*='related']",
  "[class*='comment']", "[class*='share']", "[class*='breadcrumb']", "[class*='pagination']",
  "[id*='advert']", "[id*='recommend']", "[id*='related']", "[id*='comment']",
].join(",")

export interface PageTextQuality {
  usable: boolean
  reason: string
  textLength: number
  paragraphCount: number
  sentenceCount: number
}

export interface ReadablePageContent {
  title: string
  text: string
  selector: string
  quality: PageTextQuality
}

function visibleText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[#>*_`|~-]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
}

/** 判断工具读到的是文章正文，而不是导航壳、登录页或验证提示。 */
export function assessPageText(content: string, minChars = 80): PageTextQuality {
  const raw = content.trim()
  const text = visibleText(raw)
  const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean)
  const textLength = text.replace(/\s/g, "").length
  const paragraphCount = lines.filter(line => line.replace(/\s/g, "").length >= 28).length
  const sentenceCount = (text.match(/[。！？!?；;]/g) || []).length
  const shortLines = lines.filter(line => line.length <= 20 && !/[。！？!?；;]/.test(line)).length
  const navigationShell = lines.length >= 6 && shortLines / lines.length >= 0.7 && sentenceCount < 2 && paragraphCount < 2
  let reason = ""
  if (!raw || textLength < minChars) reason = "正文文字过短"
  else if (FAILURE_PREFIX.test(raw) || STATUS_PAGE.test(raw) || BLOCK_PAGE.test(text.slice(0, 900))) reason = "页面是错误、登录或验证提示"
  else if (navigationShell) reason = "页面主要由导航和短链接组成"
  else if (textLength < 180 && paragraphCount < 2 && sentenceCount < 2) reason = "缺少连续正文段落"
  return { usable: !reason, reason, textLength, paragraphCount, sentenceCount }
}

function pageTitle(html: string): string {
  const $ = load(html)
  return ($("meta[property='og:title']").attr("content") || $("h1").first().text() || $("title").text())
    .replace(/\s+/g, " ").trim().slice(0, 180)
}

/** 从浏览器执行后的 DOM 或原始 HTML 中选择正文密度最高的语义容器。 */
export function extractReadablePage(html: string, articleUrl: string): ReadablePageContent {
  const $ = load(html)
  const seen = new Set<unknown>()
  const candidates: Array<{ selector: string; text: string; score: number; quality: PageTextQuality }> = []
  for (const selector of MAIN_SELECTORS) {
    $(selector).each((_index, element) => {
      if (seen.has(element)) return
      seen.add(element)
      const node = $(element).clone()
      node.find(NOISE_SELECTOR).remove()
      const linkLength = node.find("a").text().replace(/\s/g, "").length
      const plainLength = node.text().replace(/\s/g, "").length
      const paragraphCount = node.find("p").filter((_row, paragraph) => $(paragraph).text().trim().length >= 24).length
      const text = toMarkdown(node.html() || "", articleUrl)
      const quality = assessPageText(text)
      if (!quality.usable) return
      const linkRatio = plainLength ? linkLength / plainLength : 1
      const depth = $(element).parents().length
      const score = Math.min(quality.textLength, 24_000) + paragraphCount * 120
        + quality.sentenceCount * 24 + depth * 30 - Math.round(linkRatio * quality.textLength * 1.6)
      candidates.push({ selector, text, score, quality })
    })
  }
  candidates.sort((left, right) => right.score - left.score || right.quality.textLength - left.quality.textLength)
  const best = candidates[0]
  if (best) return { title: pageTitle(html), text: best.text.slice(0, 24_000), selector: best.selector, quality: best.quality }
  return { title: pageTitle(html), text: "", selector: "", quality: assessPageText("") }
}
