export type CanvasNodeType = "text" | "image" | "shape" | "motif"
export type CanvasShape = "rect" | "ellipse"
export type CanvasMotif = "wave" | "dots" | "arch" | "spark" | "frame"

interface CanvasNodeBase {
  id: string
  sourceId?: string
  type: CanvasNodeType
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
}

export interface CanvasTextNode extends CanvasNodeBase {
  type: "text"
  text: string
  fill: string
  fontSize: number
  fontWeight: number
  lineHeight: number
  align: "left" | "center" | "right"
}

export interface CanvasImageNode extends CanvasNodeBase {
  type: "image"
  src: string
  fit: "cover" | "contain"
  radius: number
}

export interface CanvasShapeNode extends CanvasNodeBase {
  type: "shape"
  shape: CanvasShape
  fill: string
  stroke: string
  strokeWidth: number
  radius: number
}

export interface CanvasMotifNode extends CanvasNodeBase {
  type: "motif"
  motif: CanvasMotif
  fill: string
  stroke: string
  strokeWidth: number
}

export type CanvasNode = CanvasTextNode | CanvasImageNode | CanvasShapeNode | CanvasMotifNode

export interface CanvasDocument {
  version: 1
  name: string
  width: number
  height: number
  background: string
  nodes: CanvasNode[]
}

const DEFAULT_IMAGE_A = "https://copilot-cn.bytedance.net/api/ide/v1/text_to_image?prompt=editorial%20portrait%20of%20a%20Chinese%20independent%20designer%20in%20a%20bright%20minimal%20studio%2C%20natural%20window%20light%2C%20warm%20neutral%20palette%2C%20documentary%20photography%2C%20high%20detail&image_size=portrait_4_3"
const DEFAULT_IMAGE_B = "https://copilot-cn.bytedance.net/api/ide/v1/text_to_image?prompt=close-up%20of%20hands%20arranging%20printed%20editorial%20layouts%20on%20a%20clean%20worktable%2C%20natural%20light%2C%20realistic%20photography%2C%20warm%20paper%20textures%2C%20high%20detail&image_size=landscape_4_3"

export const DEFAULT_CANVAS_DOCUMENT: CanvasDocument = {
  version: 1,
  name: "人物故事画布",
  width: 750,
  height: 1000,
  background: "#fffaf0",
  nodes: [
    { id: "shape-bg", type: "shape", shape: "rect", x: 0, y: 0, width: 750, height: 1000, rotation: 0, opacity: 1, fill: "#fffaf0", stroke: "#fffaf0", strokeWidth: 0, radius: 0 },
    { id: "motif-arch", type: "motif", motif: "arch", x: 500, y: 36, width: 210, height: 230, rotation: 0, opacity: 1, fill: "#ffb084", stroke: "#0a0a0a", strokeWidth: 0 },
    { id: "title", type: "text", x: 48, y: 48, width: 430, height: 150, rotation: 0, opacity: 1, text: "把复杂的事，\\n做得清楚而漂亮", fill: "#0a0a0a", fontSize: 46, fontWeight: 700, lineHeight: 1.18, align: "left" },
    { id: "subtitle", type: "text", x: 52, y: 215, width: 380, height: 70, rotation: 0, opacity: 1, text: "CREATIVE PRACTICE · 2026", fill: "#6a6a6a", fontSize: 17, fontWeight: 600, lineHeight: 1.4, align: "left" },
    { id: "image-main", type: "image", x: 48, y: 310, width: 420, height: 500, rotation: 0, opacity: 1, src: DEFAULT_IMAGE_A, fit: "cover", radius: 8 },
    { id: "image-detail", type: "image", x: 490, y: 560, width: 212, height: 250, rotation: 0, opacity: 1, src: DEFAULT_IMAGE_B, fit: "cover", radius: 8 },
    { id: "quote-bg", type: "shape", shape: "rect", x: 470, y: 305, width: 232, height: 220, rotation: 0, opacity: 1, fill: "#1a3a3a", stroke: "#1a3a3a", strokeWidth: 0, radius: 8 },
    { id: "quote", type: "text", x: 494, y: 340, width: 184, height: 140, rotation: 0, opacity: 1, text: "设计不是装饰，\\n而是让信息\\n拥有秩序。", fill: "#ffffff", fontSize: 25, fontWeight: 600, lineHeight: 1.45, align: "left" },
    { id: "footer-line", type: "motif", motif: "wave", x: 48, y: 872, width: 654, height: 46, rotation: 0, opacity: 1, fill: "#e8b94a", stroke: "#e8b94a", strokeWidth: 8 },
    { id: "footer", type: "text", x: 48, y: 930, width: 654, height: 40, rotation: 0, opacity: 1, text: "DASHY VISUAL STORY", fill: "#0a0a0a", fontSize: 16, fontWeight: 700, lineHeight: 1.2, align: "right" },
  ],
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("画布 DSL 必须是 JSON 对象")
  }
  return value as Record<string, unknown>
}

function numberIn(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function textIn(value: unknown, fallback: string, maxLength: number): string {
  return (typeof value === "string" ? value : fallback).slice(0, maxLength)
}

function colorIn(value: unknown, fallback: string): string {
  const color = textIn(value, fallback, 32)
  return /^(#[0-9a-f]{3,8}|rgba?\([0-9.,\s%]+\)|transparent)$/i.test(color) ? color : fallback
}

function urlIn(value: unknown): string {
  const url = textIn(value, "", 2048)
  if (
    /^https?:\/\//i.test(url)
    || /^data:image\/(?:png|jpe?g|webp|gif);/i.test(url)
    || (url.startsWith("/") && !url.startsWith("//"))
  ) return url
  return ""
}

function baseNode(record: Record<string, unknown>, index: number): CanvasNodeBase {
  return {
    id: textIn(record.id, `node-${index + 1}`, 64).replace(/[^a-zA-Z0-9_-]/g, "-"),
    sourceId: typeof record.sourceId === "string"
      ? textIn(record.sourceId, "", 64).replace(/[^a-zA-Z0-9_-]/g, "-")
      : undefined,
    type: record.type as CanvasNodeType,
    x: numberIn(record.x, 0, -2000, 4000),
    y: numberIn(record.y, 0, -2000, 30000),
    width: numberIn(record.width, 160, 8, 2000),
    height: numberIn(record.height, 80, 8, 4000),
    rotation: numberIn(record.rotation, 0, -360, 360),
    opacity: numberIn(record.opacity, 1, 0, 1),
  }
}

function parseNode(value: unknown, index: number): CanvasNode | null {
  const record = asRecord(value)
  if (!["text", "image", "shape", "motif"].includes(String(record.type))) return null
  const base = baseNode(record, index)

  if (record.type === "text") {
    return {
      ...base,
      type: "text",
      text: textIn(record.text, "文本", 600),
      fill: colorIn(record.fill, "#0a0a0a"),
      fontSize: numberIn(record.fontSize, 28, 10, 180),
      fontWeight: numberIn(record.fontWeight, 500, 300, 900),
      lineHeight: numberIn(record.lineHeight, 1.3, 0.8, 3),
      align: ["left", "center", "right"].includes(String(record.align))
        ? record.align as CanvasTextNode["align"]
        : "left",
    }
  }
  if (record.type === "image") {
    return {
      ...base,
      type: "image",
      src: urlIn(record.src),
      fit: record.fit === "contain" ? "contain" : "cover",
      radius: numberIn(record.radius, 0, 0, 200),
    }
  }
  if (record.type === "shape") {
    return {
      ...base,
      type: "shape",
      shape: record.shape === "ellipse" ? "ellipse" : "rect",
      fill: colorIn(record.fill, "#f5f0e0"),
      stroke: colorIn(record.stroke, "transparent"),
      strokeWidth: numberIn(record.strokeWidth, 0, 0, 40),
      radius: numberIn(record.radius, 0, 0, 200),
    }
  }
  return {
    ...base,
    type: "motif",
    motif: ["wave", "dots", "arch", "spark", "frame"].includes(String(record.motif))
      ? record.motif as CanvasMotif
      : "wave",
    fill: colorIn(record.fill, "#e8b94a"),
    stroke: colorIn(record.stroke, "#e8b94a"),
    strokeWidth: numberIn(record.strokeWidth, 4, 0, 40),
  }
}

export function parseCanvasDocument(value: unknown): CanvasDocument {
  const record = asRecord(value)
  const rawNodes = Array.isArray(record.nodes) ? record.nodes.slice(0, 140) : []
  const nodes = rawNodes.map(parseNode).filter((node): node is CanvasNode => node !== null)
  if (nodes.length === 0) throw new Error("画布至少需要一个有效节点")

  return {
    version: 1,
    name: textIn(record.name, "未命名画布", 80),
    width: numberIn(record.width, 750, 320, 1600),
    height: numberIn(record.height, 1000, 320, 32000),
    background: colorIn(record.background, "#fffaf0"),
    nodes,
  }
}
