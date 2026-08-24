import type { CanvasDocument, CanvasImageNode, CanvasNode, CanvasTextNode } from "./canvasDsl.ts"
import { estimateCanvasTextHeight, parseCanvasDocument } from "./canvasDsl.ts"
import type { CanvasDesignTokens } from "./canvasDesignTemplates.ts"

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
    ? { fontSize: 52, fontWeight: 800, lineHeight: 1.25, fill: "#161616", variant: "plain" as const, background: "transparent", borderColor: "transparent", borderWidth: 0, radius: 0, padding: 0 }
    : source.kind === "heading"
      ? { fontSize: 38, fontWeight: 750, lineHeight: 1.3, fill: "#356fb8", variant: "banner" as const, background: "#dce9f8", borderColor: "#3d3d3d", borderWidth: 2, radius: 12, padding: 22 }
      : source.kind === "quote"
        ? { fontSize: 32, fontWeight: 600, lineHeight: 1.55, fill: "#333333", variant: "quote" as const, background: "#dce9f8", borderColor: "#3d3d3d", borderWidth: 2, radius: 12, padding: 28 }
        : source.kind === "list"
          ? { fontSize: 30, fontWeight: 500, lineHeight: 1.7, fill: "#333333", variant: "card" as const, background: "#fff0d7", borderColor: "#3d3d3d", borderWidth: 2, radius: 10, padding: 24 }
          : { fontSize: 30, fontWeight: 400, lineHeight: 1.75, fill: "#333333", variant: "plain" as const, background: "transparent", borderColor: "transparent", borderWidth: 0, radius: 0, padding: 0 }
  const text = source.text || ""
  return {
    id: `node-${source.id}`,
    sourceId: source.id,
    type: "text",
    x: 50,
    y,
    width: 650,
    height: estimateCanvasTextHeight(text, 650, style.fontSize, style.lineHeight, style.padding),
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

function overlaps(
  left: CanvasNode,
  right: CanvasNode,
  gap = 12,
): boolean {
  return left.x < right.x + right.width + gap
    && left.x + left.width + gap > right.x
    && left.y < right.y + right.height + gap
    && left.y + left.height + gap > right.y
}

function hydrateFreeformCanvas(
  parsed: CanvasDocument,
  candidates: Map<string, CanvasTextNode | CanvasImageNode>,
  sources: CanvasSource[],
  name: string,
  decorativeNodes: CanvasNode[],
  designTokens?: CanvasDesignTokens | null,
): CanvasDocument {
  const canvasWidth = Math.min(1280, Math.max(750, parsed.width))
  const margin = 40
  const contentNodes: CanvasNode[] = []
  let fallbackY = 70

  for (const source of sources) {
    const candidate = candidates.get(source.id)
    let node = candidate
      && ((candidate.type === "image") === (source.kind === "image"))
      ? candidate
      : fallbackNode(source, fallbackY)
    const maxWidth = canvasWidth - margin * 2
    const x = Math.min(canvasWidth - margin - 180, Math.max(margin, node.x))
    const width = Math.min(maxWidth, Math.max(180, Math.min(node.width, canvasWidth - x - margin)))

    if (node.type === "text" && source.kind !== "image") {
      const text = source.text || ""
      const body = source.kind === "paragraph" || source.kind === "list"
      const fallback = fallbackNode(source, fallbackY) as CanvasTextNode
      const fontSize = source.kind === "title"
        ? Math.min(60, Math.max(24, node.fontSize))
        : source.kind === "heading"
          ? Math.min(38, Math.max(16, node.fontSize))
          : Math.min(body ? 28 : 32, Math.max(body ? 14 : 16, node.fontSize))
      const padding = Math.max(0, node.padding)
      const lineHeight = Math.max(body ? 1.45 : 1.25, node.lineHeight)
      node = {
        ...node,
        sourceId: source.id,
        x,
        y: Math.max(margin, node.y),
        width,
        text,
        variant: node.variant === "plain" ? fallback.variant : node.variant,
        padding,
        fontSize,
        lineHeight,
        height: estimateCanvasTextHeight(text, width, fontSize, lineHeight, padding),
      }
      if (designTokens) {
        const heading = source.kind === "heading"
        const title = source.kind === "title"
        node = {
          ...node,
          fill: designTokens.text,
          background: node.variant === "plain" ? "transparent" : designTokens.surface,
          borderColor: node.variant === "plain" ? "transparent" : designTokens.border,
          fontSize: title
            ? designTokens.h1Size
            : heading
              ? designTokens.h2Size
              : designTokens.bodySize,
          fontWeight: title
            ? designTokens.h1Weight
            : heading
              ? designTokens.h2Weight
              : designTokens.bodyWeight,
          lineHeight: title
            ? designTokens.h1LineHeight
            : heading
              ? designTokens.h2LineHeight
              : designTokens.bodyLineHeight,
        }
        node.height = estimateCanvasTextHeight(
          text,
          width,
          node.fontSize,
          node.lineHeight,
          padding,
        )
      }
    } else if (node.type === "image" && source.kind === "image") {
      node = {
        ...node,
        sourceId: source.id,
        x,
        y: Math.max(margin, node.y),
        width,
        height: Math.max(160, Math.min(720, node.height)),
        src: source.src || "",
      }
    }

    for (let pass = 0; pass <= contentNodes.length; pass += 1) {
      const collisions = contentNodes.filter(placed => overlaps(node, placed))
      if (collisions.length === 0) break
      node = {
        ...node,
        y: Math.max(...collisions.map(placed => placed.y + placed.height + 24)),
      }
    }
    contentNodes.push(node)
    fallbackY = Math.max(fallbackY, node.y + node.height + 32)
  }

  const contentBottom = contentNodes.reduce(
    (bottom, node) => Math.max(bottom, node.y + node.height),
    0,
  )
  return parseCanvasDocument({
    ...parsed,
    name: name || parsed.name,
    width: canvasWidth,
    height: Math.max(parsed.height, contentBottom + margin),
    background: designTokens?.surfaceSoft || parsed.background,
    nodes: [
      ...decorativeNodes.map((node, index): CanvasNode => {
        if (!designTokens) return node
        if (node.type === "path" || node.type === "motif") {
          return {
            ...node,
            stroke: index % 2 === 0 ? designTokens.primary : designTokens.secondary,
            fill: node.fill === "transparent" ? "transparent" : designTokens.tertiary,
          }
        }
        if (node.type === "shape") {
          return {
            ...node,
            fill: index % 3 === 0
              ? designTokens.primary
              : index % 3 === 1
                ? designTokens.secondary
                : designTokens.tertiary,
            stroke: designTokens.border,
          }
        }
        return node
      }),
      ...contentNodes,
    ],
  })
}

export function hydrateCanvasDocument(
  value: unknown,
  sources: CanvasSource[],
  name: string,
  options: {
    layoutMode?: "article" | "freeform"
    designTokens?: CanvasDesignTokens | null
  } = {},
): CanvasDocument {
  const parsed = parseCanvasDocument(value)
  const candidates = new Map<string, CanvasTextNode | CanvasImageNode>()
  const decorativeNodes = parsed.nodes
    .filter(node => node.type === "shape" || node.type === "motif" || node.type === "path")
    .slice(0, 24)
  for (const node of parsed.nodes) {
    if ((node.type === "text" || node.type === "image") && node.sourceId && !candidates.has(node.sourceId)) {
      candidates.set(node.sourceId, node)
    }
  }

  if (options.layoutMode === "freeform") {
    return hydrateFreeformCanvas(
      parsed,
      candidates,
      sources,
      name,
      decorativeNodes,
      options.designTokens,
    )
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
      const fallback = fallbackNode(source, y) as CanvasTextNode
      const fontSize = source.kind === "title"
        ? Math.min(60, Math.max(44, node.fontSize))
        : source.kind === "heading"
          ? Math.min(44, Math.max(34, node.fontSize))
          : Math.min(body ? 34 : 38, Math.max(body ? 28 : 30, node.fontSize))
      const width = 650
      const variant = node.variant === "plain" ? fallback.variant : node.variant
      const padding = Math.max(node.padding, fallback.padding)
      node = {
        ...node,
        sourceId: source.id,
        x: 50,
        y: Math.max(y, Math.min(node.y, y + 120)),
        width,
        text,
        variant,
        background: node.background === "transparent" ? fallback.background : node.background,
        borderColor: node.borderColor === "transparent" ? fallback.borderColor : node.borderColor,
        borderWidth: Math.max(node.borderWidth, fallback.borderWidth),
        radius: Math.max(node.radius, fallback.radius),
        padding,
        fontSize,
        lineHeight: Math.max(body ? 1.6 : 1.3, node.lineHeight),
        height: estimateCanvasTextHeight(
          text,
          width,
          fontSize,
          Math.max(body ? 1.6 : 1.3, node.lineHeight),
          padding,
        ),
      }
    } else if (node.type === "image" && source.kind === "image") {
      const width = 650
      node = {
        ...node,
        sourceId: source.id,
        x: 50,
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
