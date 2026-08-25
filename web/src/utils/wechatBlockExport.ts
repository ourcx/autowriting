const WECHAT_CONTENT_WIDTH = 677
const DEFAULT_WECHAT_SIDE_SPACE = 8

function stripEditorAttributes(root: HTMLElement): void {
  root.removeAttribute("class")
  root.removeAttribute("data-wechat-side-padding")
  root.querySelectorAll("*").forEach(node => {
    node.removeAttribute("class")
    node.removeAttribute("data-block-id")
    node.removeAttribute("data-wechat-icon")
    node.removeAttribute("data-wechat-material")
    node.removeAttribute("data-wechat-material-wrapper")
    node.removeAttribute("contenteditable")
    node.removeAttribute("tabindex")
  })
}

function replaceSvgDecorations(root: HTMLElement): void {
  root.querySelectorAll("svg").forEach(svg => {
    if (svg.getAttribute("data-wechat-icon") === "true") {
      const clone = svg.cloneNode(true) as SVGElement
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
      clone.removeAttribute("data-wechat-icon")
      const image = document.createElement("img")
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`
      image.alt = ""
      image.setAttribute("data-wechat-icon", "true")
      image.setAttribute(
        "style",
        `display:block;width:${svg.getAttribute("width") || "24"}px;height:${svg.getAttribute("height") || "24"}px;`,
      )
      svg.replaceWith(image)
      return
    }
    const path = svg.querySelector("path")
    const stroke = path?.getAttribute("stroke") || "#dee0e3"
    const divider = document.createElement("section")
    divider.setAttribute(
      "style",
      `margin:12px auto 18px;width:96px;border-top:2px solid ${stroke};line-height:0;height:0;`,
    )
    svg.parentElement?.replaceWith(divider)
  })
}

function normalizeWechatElements(root: HTMLElement): void {
  const requestedSideSpace = Number(root.getAttribute("data-wechat-side-padding"))
  const sideSpace = Number.isFinite(requestedSideSpace)
    ? Math.min(48, Math.max(0, requestedSideSpace))
    : DEFAULT_WECHAT_SIDE_SPACE
  root.style.width = "100%"
  root.style.maxWidth = "100%"
  root.style.margin = "0"
  root.style.padding = "0"
  root.style.boxSizing = "border-box"
  root.style.fontFamily = "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif"

  Array.from(root.children).forEach(child => {
    if (!(child instanceof HTMLElement)) return
    if (child.getAttribute("data-wechat-material-wrapper") === "true") {
      child.style.maxWidth = "100%"
      child.removeAttribute("data-wechat-material-wrapper")
      return
    }
    child.style.marginLeft = `${sideSpace}px`
    child.style.marginRight = `${sideSpace}px`
    child.style.maxWidth = `calc(100% - ${sideSpace * 2}px)`
  })

  root.querySelectorAll("table").forEach(table => {
    table.style.width = "100%"
    table.style.maxWidth = "100%"
    table.style.tableLayout = "fixed"
    table.style.borderCollapse = "separate"
    table.style.borderSpacing = "0"
  })
  root.querySelectorAll("td").forEach(cell => {
    if (!cell.style.width) cell.style.width = "50%"
    cell.style.verticalAlign = "top"
    cell.style.wordBreak = "break-word"
    cell.style.overflowWrap = "break-word"
  })
  root.querySelectorAll("img").forEach(image => {
    if (image.getAttribute("data-wechat-icon") === "true") {
      image.style.maxWidth = "none"
      image.style.objectFit = ""
      image.removeAttribute("data-wechat-icon")
      return
    }
    if (image.getAttribute("data-wechat-material") === "true") {
      image.style.maxWidth = "100%"
      image.removeAttribute("data-wechat-material")
      return
    }
    image.style.display = "block"
    image.style.width = "100%"
    image.style.maxWidth = "100%"
    image.style.height = "auto"
    image.style.objectFit = ""
  })
  root.querySelectorAll("h1,h2,p,blockquote,section,figure,figcaption").forEach(node => {
    if (!(node instanceof HTMLElement)) return
    node.style.maxWidth = "100%"
    node.style.boxSizing = "border-box"
    node.style.wordBreak = "break-word"
    node.style.overflowWrap = "break-word"
  })
}

export function buildWechatBlockHtml(source: HTMLElement): string {
  const clone = source.cloneNode(true) as HTMLElement
  replaceSvgDecorations(clone)
  normalizeWechatElements(clone)
  stripEditorAttributes(clone)
  return clone.outerHTML
}

function copyViaSelection(html: string): boolean {
  const container = document.createElement("div")
  container.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    `width:${WECHAT_CONTENT_WIDTH}px`,
    "background:#ffffff",
    "pointer-events:none",
  ].join(";")
  container.innerHTML = html
  document.body.appendChild(container)
  try {
    const selection = window.getSelection()
    const content = container.firstElementChild
    if (!selection || !content) return false
    const range = document.createRange()
    range.selectNode(content)
    selection.removeAllRanges()
    selection.addRange(range)
    const copied = document.execCommand("copy")
    selection.removeAllRanges()
    return copied
  } finally {
    document.body.removeChild(container)
  }
}

export async function copyWechatBlockHtml(source: HTMLElement): Promise<void> {
  const html = buildWechatBlockHtml(source)
  const plainText = source.innerText
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        }),
      ])
      return
    } catch {
      // 浏览器拒绝 ClipboardItem 时回退到 selection + execCommand。
    }
  }
  if (!copyViaSelection(html)) throw new Error("浏览器拒绝复制富文本")
}
