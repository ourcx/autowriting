import MarkdownIt from "markdown-it"
import hljs from "highlight.js"

type CalloutType = "note" | "tip" | "important" | "warning" | "caution"

const CALLOUT_LABELS: Record<CalloutType, string> = {
  note: "说明",
  tip: "建议",
  important: "重点",
  warning: "注意",
  caution: "警告",
}

function highlightCode(source: string, language: string): string {
  if (language && hljs.getLanguage(language)) {
    try {
      const html = hljs.highlight(source, { language, ignoreIllegals: true }).value
      return `<pre class="custom"><code class="hljs language-${language}">${html}</code></pre>`
    } catch {
      // 未识别的语言回退为安全转义文本。
    }
  }
  return `<pre class="custom"><code class="hljs">${MarkdownIt().utils.escapeHtml(source)}</code></pre>`
}

const parser = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  highlight: highlightCode,
})

function enhanceHeadings(root: HTMLElement): void {
  root.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6").forEach(heading => {
    const content = document.createElement("span")
    content.className = "content"
    content.innerHTML = heading.innerHTML

    const prefix = document.createElement("span")
    prefix.className = "prefix"
    prefix.setAttribute("aria-hidden", "true")

    const suffix = document.createElement("span")
    suffix.className = "suffix"
    suffix.setAttribute("aria-hidden", "true")

    heading.replaceChildren(prefix, content, suffix)
  })
}

function enhanceTables(root: HTMLElement): void {
  root.querySelectorAll<HTMLTableElement>("table").forEach(table => {
    if (table.parentElement?.classList.contains("table-container")) return
    const container = document.createElement("div")
    container.className = "table-container"
    table.replaceWith(container)
    container.appendChild(table)
  })
}

function enhanceQuotes(root: HTMLElement): void {
  root.querySelectorAll<HTMLQuoteElement>("blockquote").forEach(quote => {
    const firstParagraph = quote.querySelector(":scope > p")
    const marker = firstParagraph?.textContent?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i)
    if (!marker || !firstParagraph) {
      quote.classList.add("multiquote-1")
      return
    }

    const type = marker[1].toLowerCase() as CalloutType
    firstParagraph.innerHTML = firstParagraph.innerHTML.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, "")
    quote.classList.add("callout", `callout-${type}`)

    const title = document.createElement("div")
    title.className = "callout-title"
    title.textContent = CALLOUT_LABELS[type]
    quote.prepend(title)
  })
}

function enhanceTaskLists(root: HTMLElement): void {
  root.querySelectorAll<HTMLLIElement>("li").forEach(item => {
    const match = item.innerHTML.match(/^\s*\[([ xX])\]\s*/)
    if (!match) return

    item.classList.add("task-list-item")
    item.innerHTML = item.innerHTML.replace(/^\s*\[([ xX])\]\s*/, "")

    const status = document.createElement("span")
    status.className = "task-list-status"
    status.setAttribute("aria-hidden", "true")
    status.textContent = match[1].toLowerCase() === "x" ? "✓" : "○"
    item.prepend(status)
  })
}

function enhanceImages(root: HTMLElement): void {
  root.querySelectorAll<HTMLImageElement>("p > img:only-child").forEach(image => {
    const paragraph = image.parentElement
    if (!paragraph) return

    const figure = document.createElement("figure")
    paragraph.replaceWith(figure)
    figure.appendChild(image)

    const captionParagraph = figure.nextElementSibling
    const captionEmphasis = captionParagraph?.matches("p")
      ? captionParagraph.querySelector(":scope > em:only-child")
      : null
    if (!captionEmphasis || !captionParagraph) return

    const caption = document.createElement("figcaption")
    caption.innerHTML = captionEmphasis.innerHTML
    figure.appendChild(caption)
    captionParagraph.remove()
  })
}

export function renderWechatMarkdown(markdown: string): string {
  if (!markdown.trim()) return ""

  const documentRoot = new DOMParser().parseFromString(
    `<section id="wechat-markdown-root">${parser.render(markdown)}</section>`,
    "text/html",
  )
  const root = documentRoot.querySelector<HTMLElement>("#wechat-markdown-root")
  if (!root) return parser.render(markdown)

  enhanceHeadings(root)
  enhanceTables(root)
  enhanceQuotes(root)
  enhanceTaskLists(root)
  enhanceImages(root)

  return root.innerHTML
}
