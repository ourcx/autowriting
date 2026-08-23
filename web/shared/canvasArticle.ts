import type { CanvasDocument, CanvasImageNode, CanvasNode, CanvasTextNode } from "./canvasDsl.ts"
import { parseCanvasDocument } from "./canvasDsl.ts"

export type CanvasSourceKind = "title" | "heading" | "paragraph" | "quote" | "list" | "image"

export interface CanvasSource {
  id: string
  kind: CanvasSourceKind
  text?: string
  src?: string
  alt?: string
}

const IMAGE_MARKDOWN = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+|\/[^)\s]+|data:image\/(?:png|jpe?g|webp|gif);[^)]+)\)/gi
const HTML_IMAGE = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi

function cleanMarkdownText(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function splitText(value: string, maxLength = 220): string[] {
  const text = cleanMarkdownText(value)
  if (!text) return []
  const chunks: string[] = []
  let rest = text
  while (rest.length > maxLength) {
    let splitAt = Math.max(
      rest.lastIndexOf("。", maxLength),
      rest.lastIndexOf("！", maxLength),
      rest.lastIndexOf("？", maxLength),
      rest.lastIndexOf("；", maxLength),
    )
    if (splitAt < maxLength * 0.5) splitAt = maxLength
    chunks.push(rest.slice(0, splitAt + (splitAt < maxLength ? 1 : 0)).trim())
    rest = rest.slice(splitAt + (splitAt < maxLength ? 1 : 0)).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

function safeImageUrl(value: string): string {
  const url = value.trim().slice(0, 2048)
  if (
    /^https?:\/\//i.test(url)
    || /^data:image\/(?:png|jpe?g|webp|gif);/i.test(url)
    || (url.startsWith("/") && !url.startsWith("//"))
  ) return url
  return ""
}

export function extractCanvasSources(input: {
  title: string
  article: string
  materials?: string
  extraImages?: Array<{ src: string; alt?: string }>
}): CanvasSource[] {
  const sources: CanvasSource[] = []
  let sequence = 0
  const addText = (kind: Exclude<CanvasSourceKind, "image">, text: string) => {
    for (const chunk of splitText(text, kind === "title" ? 80 : 220)) {
      sources.push({ id: `source-${sequence++}`, kind, text: chunk })
    }
  }
  const addImage = (src: string, alt = "") => {
    const safeSrc = safeImageUrl(src)
    if (!safeSrc || sources.some(source => source.kind === "image" && source.src === safeSrc)) return
    sources.push({ id: `source-${sequence++}`, kind: "image", src: safeSrc, alt: cleanMarkdownText(alt) })
  }

  addText("title", input.title || "未命名文章")

  let paragraph: string[] = []
  let list: string[] = []
  let inCodeBlock = false
  const flushParagraph = () => {
    if (paragraph.length) addText("paragraph", paragraph.join(" "))
    paragraph = []
  }
  const flushList = () => {
    if (list.length) addText("list", list.map(item => `• ${item}`).join("\n"))
    list = []
  }

  for (const rawLine of input.article.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith("```")) {
      flushParagraph()
      flushList()
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) {
      paragraph.push(line)
      continue
    }

    for (const match of line.matchAll(IMAGE_MARKDOWN)) addImage(match[2], match[1])
    for (const match of line.matchAll(HTML_IMAGE)) addImage(match[1])
    const withoutImages = line.replace(IMAGE_MARKDOWN, "").replace(HTML_IMAGE, "").trim()
    if (!withoutImages) {
      flushParagraph()
      flushList()
      continue
    }

    const heading = withoutImages.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const headingText = cleanMarkdownText(heading[2])
      if (headingText && headingText !== cleanMarkdownText(input.title)) addText("heading", headingText)
      continue
    }
    const quote = withoutImages.match(/^>\s*(.+)$/)
    if (quote) {
      flushParagraph()
      flushList()
      addText("quote", quote[1])
      continue
    }
    const listItem = withoutImages.match(/^(?:[-*+]|\d+\.)\s+(.+)$/)
    if (listItem) {
      flushParagraph()
      list.push(cleanMarkdownText(listItem[1]))
      continue
    }
    flushList()
    paragraph.push(withoutImages)
  }
  flushParagraph()
  flushList()

  const imageText = `${input.article}\n${input.materials || ""}`
  for (const match of imageText.matchAll(IMAGE_MARKDOWN)) addImage(match[2], match[1])
  for (const match of imageText.matchAll(HTML_IMAGE)) addImage(match[1])
  for (const image of input.extraImages || []) addImage(image.src, image.alt)

  return sources.slice(0, 100)
}

export function parseCanvasSources(value: unknown): CanvasSource[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).flatMap((item, index): CanvasSource[] => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const kind = String(record.kind) as CanvasSourceKind
    if (!["title", "heading", "paragraph", "quote", "list", "image"].includes(kind)) return []
    const id = String(record.id || `source-${index}`).slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, "-")
    if (kind === "image") {
      const src = safeImageUrl(String(record.src || ""))
      return src ? [{ id, kind, src, alt: String(record.alt || "").slice(0, 200) }] : []
    }
    const text = String(record.text || "").slice(0, 600).trim()
    return text ? [{ id, kind, text }] : []
  })
}

function estimateTextHeight(text: string, width: number, fontSize: number, lineHeight: number): number {
  const charactersPerLine = Math.max(1, Math.floor(width / (fontSize * 0.92)))
  const lineCount = text.split("\n").reduce(
    (count, line) => count + Math.max(1, Math.ceil(line.length / charactersPerLine)),
    0,
  )
  return Math.ceil(lineCount * fontSize * lineHeight + 8)
}

function fallbackNode(source: CanvasSource, y: number): CanvasTextNode | CanvasImageNode {
  if (source.kind === "image") {
    return {
      id: `node-${source.id}`,
      sourceId: source.id,
      type: "image",
      x: 50,
      y,
      width: 650,
      height: 420,
      rotation: 0,
      opacity: 1,
      src: source.src || "",
      fit: "cover",
      radius: 6,
    }
  }

  const style = source.kind === "title"
    ? { fontSize: 52, fontWeight: 800, lineHeight: 1.25, fill: "#161616" }
    : source.kind === "heading"
      ? { fontSize: 38, fontWeight: 750, lineHeight: 1.3, fill: "#163f3b" }
      : source.kind === "quote"
        ? { fontSize: 32, fontWeight: 600, lineHeight: 1.55, fill: "#9f3d2f" }
        : { fontSize: 30, fontWeight: 400, lineHeight: 1.75, fill: "#292929" }
  const text = source.text || ""
  return {
    id: `node-${source.id}`,
    sourceId: source.id,
    type: "text",
    x: source.kind === "quote" ? 80 : 50,
    y,
    width: source.kind === "quote" ? 590 : 650,
    height: estimateTextHeight(text, source.kind === "quote" ? 590 : 650, style.fontSize, style.lineHeight),
    rotation: 0,
    opacity: 1,
    text,
    ...style,
    align: "left",
  }
}

export function createArticleCanvas(name: string, sources: CanvasSource[]): CanvasDocument {
  const nodes: CanvasNode[] = []
  let y = 70
  for (const source of sources) {
    const node = fallbackNode(source, y)
    nodes.push(node)
    y += node.height + (source.kind === "title" ? 70 : source.kind === "heading" ? 42 : 32)
  }
  return parseCanvasDocument({
    version: 1,
    name: name || "公众号长图",
    width: 750,
    height: Math.max(640, y + 60),
    background: "#fffdf8",
    nodes,
  })
}

export function hydrateCanvasDocument(
  value: unknown,
  sources: CanvasSource[],
  name: string,
): CanvasDocument {
  const parsed = parseCanvasDocument(value)
  const candidates = new Map<string, CanvasTextNode | CanvasImageNode>()
  const decorativeNodes = parsed.nodes
    .filter(node => node.type === "shape" || node.type === "motif")
    .slice(0, 24)
  for (const node of parsed.nodes) {
    if ((node.type === "text" || node.type === "image") && node.sourceId && !candidates.has(node.sourceId)) {
      candidates.set(node.sourceId, node)
    }
  }

  const contentNodes: CanvasNode[] = []
  let y = 70
  for (const source of sources) {
    const candidate = candidates.get(source.id)
    let node = candidate
      && ((candidate.type === "image") === (source.kind === "image"))
      ? candidate
      : fallbackNode(source, y)

    if (node.type === "text" && source.kind !== "image") {
      const text = source.text || ""
      const body = source.kind === "paragraph" || source.kind === "list"
      const fontSize = source.kind === "title"
        ? Math.min(60, Math.max(44, node.fontSize))
        : source.kind === "heading"
          ? Math.min(44, Math.max(34, node.fontSize))
          : Math.min(body ? 34 : 38, Math.max(body ? 28 : 30, node.fontSize))
      const width = Math.min(660, Math.max(body ? 610 : 540, node.width))
      const x = Math.min(700 - width, Math.max(50, node.x))
      node = {
        ...node,
        sourceId: source.id,
        x,
        y: Math.max(y, Math.min(node.y, y + 120)),
        width,
        text,
        fontSize,
        lineHeight: Math.max(body ? 1.6 : 1.3, node.lineHeight),
        height: estimateTextHeight(text, width, fontSize, Math.max(body ? 1.6 : 1.3, node.lineHeight)),
      }
    } else if (node.type === "image" && source.kind === "image") {
      const width = Math.min(660, Math.max(520, node.width))
      node = {
        ...node,
        sourceId: source.id,
        x: Math.min(700 - width, Math.max(50, node.x)),
        y: Math.max(y, Math.min(node.y, y + 120)),
        width,
        height: Math.max(320, node.height),
        src: source.src || "",
      }
    }

    contentNodes.push(node)
    y = node.y + node.height + (source.kind === "title" ? 70 : source.kind === "heading" ? 42 : 32)
  }

  return parseCanvasDocument({
    ...parsed,
    name: name || parsed.name,
    width: 750,
    height: Math.max(640, y + 60),
    nodes: [...decorativeNodes, ...contentNodes],
  })
}
