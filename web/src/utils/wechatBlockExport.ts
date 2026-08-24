const WECHAT_CONTENT_WIDTH = 677
const WECHAT_SIDE_SPACE = 24

function stripEditorAttributes(root: HTMLElement): void {
  root.removeAttribute("class")
  root.querySelectorAll("*").forEach(node => {
    node.removeAttribute("class")
    node.removeAttribute("data-block-id")
    node.removeAttribute("contenteditable")
    node.removeAttribute("tabindex")
  })
}

function replaceSvgDecorations(root: HTMLElement): void {
  root.querySelectorAll("svg").forEach(svg => {
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
  root.style.width = "100%"
  root.style.maxWidth = "100%"
  root.style.margin = "0"
  root.style.padding = "0"
  root.style.boxSizing = "border-box"
  root.style.fontFamily = "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif"

  Array.from(root.children).forEach(child => {
    if (!(child instanceof HTMLElement)) return
    child.style.marginLeft = `${WECHAT_SIDE_SPACE}px`
    child.style.marginRight = `${WECHAT_SIDE_SPACE}px`
    child.style.maxWidth = `calc(100% - ${WECHAT_SIDE_SPACE * 2}px)`
  })

  root.querySelectorAll("table").forEach(table => {
    table.style.width = "100%"
    table.style.maxWidth = "100%"
    table.style.tableLayout = "fixed"
    table.style.borderCollapse = "separate"
    table.style.borderSpacing = "0"
  })
  root.querySelectorAll("td").forEach(cell => {
    cell.style.width = "50%"
    cell.style.verticalAlign = "top"
    cell.style.wordBreak = "break-word"
    cell.style.overflowWrap = "break-word"
  })
  root.querySelectorAll("img").forEach(image => {
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
  stripEditorAttributes(clone)
  replaceSvgDecorations(clone)
  normalizeWechatElements(clone)
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
