import { CANVAS_MATERIALS } from "../../shared/canvasMaterialLibrary"

const WECHAT_CONTENT_WIDTH = 677
const DEFAULT_WECHAT_SIDE_SPACE = 8

const WECHAT_INLINE_PROPERTIES = [
  "color", "background-color", "background-image", "background-position",
  "background-size", "background-repeat",
  "font-family", "font-size", "font-weight", "font-style",
  "line-height", "letter-spacing", "text-align", "text-decoration",
  "text-transform", "text-indent",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top-width", "border-top-style", "border-top-color",
  "border-right-width", "border-right-style", "border-right-color",
  "border-bottom-width", "border-bottom-style", "border-bottom-color",
  "border-left-width", "border-left-style", "border-left-color",
  "border-radius", "box-shadow", "box-sizing",
  "display", "vertical-align", "white-space", "word-break", "overflow-wrap",
  "justify-content", "align-items", "flex-direction", "gap",
  "object-fit", "aspect-ratio", "float", "clear", "direction",
] as const

const DEFAULT_WECHAT_STYLE_VALUES = new Set([
  "",
  "initial",
  "inherit",
  "normal",
  "none",
  "auto",
  "visible",
  "start",
  "0px",
  "medium",
  "currentcolor",
  "baseline",
  "row",
  "fill",
  "repeat",
  "0% 0%",
])

function inlineComputedWechatStyles(source: HTMLElement, clone: HTMLElement): void {
  const sourceElements = [source, ...Array.from(source.querySelectorAll("*"))]
  const cloneElements = [clone, ...Array.from(clone.querySelectorAll("*"))]
  sourceElements.forEach((sourceElement, index) => {
    const cloneElement = cloneElements[index]
    if (
      !cloneElement
      || (!(cloneElement instanceof HTMLElement) && !(cloneElement instanceof SVGElement))
    ) return
    const computed = window.getComputedStyle(sourceElement)
    WECHAT_INLINE_PROPERTIES.forEach(property => {
      const value = computed.getPropertyValue(property).trim()
      if (DEFAULT_WECHAT_STYLE_VALUES.has(value)) return
      if (property === "background-color" && value === "rgba(0, 0, 0, 0)") return
      cloneElement.style.setProperty(property, value)
    })
  })
}

function stripEditorAttributes(root: HTMLElement): void {
  Array.from(root.attributes).forEach(attribute => {
    if (attribute.name.startsWith("data-")) root.removeAttribute(attribute.name)
  })
  root.removeAttribute("class")
  root.querySelectorAll("*").forEach(node => {
    Array.from(node.attributes).forEach(attribute => {
      if (attribute.name.startsWith("data-")) node.removeAttribute(attribute.name)
    })
    node.removeAttribute("class")
    node.removeAttribute("contenteditable")
    node.removeAttribute("tabindex")
  })
}

function stripEditorChrome(root: HTMLElement): void {
  root.style.border = "0"
  root.style.outline = "0"
  root.style.boxShadow = "none"
  root.querySelectorAll<HTMLElement>("[data-block-id],[data-section-source-id]").forEach(node => {
    node.style.border = "0"
    node.style.outline = "0"
    node.style.boxShadow = "none"
  })
}

function replaceTopLevelBlockWrappers(root: HTMLElement): void {
  Array.from(root.children).forEach(child => {
    if (
      !(child instanceof HTMLElement)
      || child.tagName !== "DIV"
      || !child.hasAttribute("data-block-id")
    ) return
    const section = document.createElement("section")
    Array.from(child.attributes).forEach(attribute => {
      section.setAttribute(attribute.name, attribute.value)
    })
    while (child.firstChild) section.appendChild(child.firstChild)
    child.replaceWith(section)
  })
}

function wrapWithWechatGutter(root: HTMLElement, sideSpace: number): void {
  const table = document.createElement("table")
  table.setAttribute("role", "presentation")
  table.setAttribute("data-wechat-gutter", "true")
  table.style.width = "100%"
  table.style.maxWidth = "100%"
  table.style.tableLayout = "fixed"
  table.style.borderCollapse = "collapse"
  table.style.borderSpacing = "0"
  table.style.border = "0"
  table.setAttribute("border", "0")
  table.setAttribute("cellpadding", "0")
  table.setAttribute("cellspacing", "0")

  const body = document.createElement("tbody")
  const row = document.createElement("tr")
  const cell = document.createElement("td")
  cell.setAttribute("data-wechat-gutter-cell", "true")
  cell.style.width = "100%"
  cell.style.padding = `0 ${sideSpace}px`
  cell.style.verticalAlign = "top"
  cell.style.wordBreak = "break-word"
  cell.style.overflowWrap = "break-word"
  cell.style.border = "0"
  body.style.border = "0"
  row.style.border = "0"

  while (root.firstChild) cell.appendChild(root.firstChild)
  row.appendChild(cell)
  body.appendChild(row)
  table.appendChild(body)
  root.appendChild(table)
}

function replaceSvgDecorations(root: HTMLElement): void {
  root.querySelectorAll("svg").forEach(svg => {
    if (svg.closest("[data-wechat-interactive]")) return
    // 保留完整矢量图和原容器，不能把曲线、图案或相邻文字替换成分隔线。
    const vector = svg.cloneNode(true) as SVGElement
    vector.setAttribute("xmlns", "http://www.w3.org/2000/svg")
    const image = document.createElement("img")
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(vector))}`
    image.alt = ""
    image.style.cssText = svg.getAttribute("style") || ""
    image.style.display = "block"
    image.style.width = svg.style.width || `${svg.getAttribute("width") || "24"}`.replace(/^(\d+(?:\.\d+)?)$/, "$1px")
    image.style.height = svg.style.height || `${svg.getAttribute("height") || "24"}`.replace(/^(\d+(?:\.\d+)?)$/, "$1px")
    image.setAttribute("data-wechat-material", "true")
    svg.replaceWith(image)
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
  root.style.border = "0"
  root.style.outline = "0"
  root.style.boxShadow = "none"
  root.style.boxSizing = "border-box"
  root.style.fontFamily = "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif"

  replaceTopLevelBlockWrappers(root)
  Array.from(root.children).forEach(child => {
    if (!(child instanceof HTMLElement)) return
    child.style.width = "100%"
    child.style.maxWidth = "100%"
    child.style.marginLeft = "0"
    child.style.marginRight = "0"
    child.style.boxSizing = "border-box"
  })
  wrapWithWechatGutter(root, sideSpace)

  root.querySelectorAll("table").forEach(table => {
    table.style.width = "100%"
    table.style.maxWidth = "100%"
    table.style.tableLayout = "fixed"
    table.style.borderCollapse = "separate"
    table.style.borderSpacing = "0"
    table.style.border = "0"
    table.style.outline = "0"
    table.style.boxShadow = "none"
    table.setAttribute("border", "0")
    table.setAttribute("cellpadding", "0")
    table.setAttribute("cellspacing", "0")
  })
  root.querySelectorAll<HTMLElement>("tbody,tr").forEach(node => {
    node.style.border = "0"
    node.style.outline = "0"
  })
  root.querySelectorAll("td").forEach(cell => {
    const hasIntentionalBorder = ["Top", "Right", "Bottom", "Left"].some(side => {
      const width = Number.parseFloat(cell.style.getPropertyValue(`border-${side.toLowerCase()}-width`))
      const style = cell.style.getPropertyValue(`border-${side.toLowerCase()}-style`)
      return width > 0 && style !== "none"
    })
    if (!hasIntentionalBorder) cell.style.border = "0"
    cell.style.outline = "0"
    cell.style.boxShadow = "none"
    // 未指定宽度的正文列应占据剩余空间，不能把时间线等窄标记布局强制平分。
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

// 项目内置素材在导出时内嵌，避免把仅本机可访问的 /canvas-materials 地址复制到公众号。
function embedPublicationMaterials(source: HTMLElement, clone: HTMLElement): void {
  const originals = Array.from(source.querySelectorAll("img"))
  const copies = Array.from(clone.querySelectorAll("img"))
  originals.forEach((image, index) => {
    const url = new URL(image.src, window.location.href)
    if (url.origin !== window.location.origin || !(CANVAS_MATERIALS.some(material => material.src === url.pathname) || image.dataset.wechatLibraryImage === "true")) return
    if (!image.complete || !image.naturalWidth) throw new Error("装饰素材尚未加载完成，请稍后再复制")
    const canvas = document.createElement("canvas")
    // 按显示宽度的两倍导出，保留透明度与清晰度，避免重复装饰把富文本膨胀到数 MB。
    canvas.width = Math.min(image.naturalWidth, Math.max(320, image.clientWidth * 2))
    canvas.height = Math.round(image.naturalHeight * canvas.width / image.naturalWidth)
    const context = canvas.getContext("2d")
    if (!context) throw new Error("浏览器无法导出装饰素材")
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    copies[index].src = canvas.toDataURL("image/png")
  })
}

export function buildWechatBlockHtml(source: HTMLElement): string {
  const clone = source.cloneNode(true) as HTMLElement
  embedPublicationMaterials(source, clone)
  inlineComputedWechatStyles(source, clone)
  stripEditorChrome(clone)
  replaceSvgDecorations(clone)
  normalizeWechatElements(clone)
  stripEditorAttributes(clone)
  // #region debug-point A-B-C:compiled-html
  navigator.sendBeacon("http://127.0.0.1:7777/event", JSON.stringify({ sessionId: "wechat-draft-style", runId: "post-fix", hypothesisId: "A,B,C", location: "src/utils/wechatBlockExport.ts:buildWechatBlockHtml", msg: "[DEBUG] WeChat block HTML compiled", data: { htmlLength: clone.outerHTML.length, selectedSourceCount: source.querySelectorAll(".is-selected").length, blackBorderCount: Array.from(clone.querySelectorAll<HTMLElement>("*")).filter(node => /rgb\(0,\s*0,\s*0\)|#000(?:000)?/i.test(`${node.style.borderColor};${node.style.borderTopColor};${node.style.borderRightColor};${node.style.borderBottomColor};${node.style.borderLeftColor}`) && /[1-9]\d*(?:\.\d+)?px/.test(`${node.style.borderWidth};${node.style.borderTopWidth};${node.style.borderRightWidth};${node.style.borderBottomWidth};${node.style.borderLeftWidth}`)).length, tableCount: clone.querySelectorAll("table").length, gutterBorder: clone.querySelector<HTMLElement>("[data-wechat-gutter]")?.style.border || "", iconCount: clone.querySelectorAll('img[data-wechat-icon="true"]').length, dataSvgIconCount: clone.querySelectorAll('img[src^="data:image/svg+xml"]').length }, ts: Date.now() }))
  // #endregion
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

// 剪贴板使用 PNG 承载静态 SVG，避免目标编辑器过滤 SVG data URL；文字仍是 HTML。
async function rasterizeExportVectors(html: string): Promise<string> {
  const container = document.createElement("div")
  container.innerHTML = html
  for (const image of container.querySelectorAll<HTMLImageElement>('img[src^="data:image/svg+xml"]')) {
    await image.decode()
    const canvas = document.createElement("canvas")
    const scale = Math.min(2, 2048 / Math.max(1, image.naturalWidth), 2048 / Math.max(1, image.naturalHeight))
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext("2d")
    if (!context) throw new Error("浏览器无法导出 SVG 素材")
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    image.src = canvas.toDataURL("image/png")
  }
  return container.innerHTML
}

export async function copyWechatBlockHtml(source: HTMLElement): Promise<void> {
  const html = await rasterizeExportVectors(buildWechatBlockHtml(source))
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
