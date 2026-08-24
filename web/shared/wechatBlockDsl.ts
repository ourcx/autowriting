import type { CanvasSource, CanvasSourceKind } from "./canvasArticle.ts"
import type { CanvasDesignTemplateId } from "./canvasDesignTemplates.ts"

export type WechatBlockVariant =
  | "plain"
  | "title"
  | "banner"
  | "card"
  | "quote"
  | "highlight"
  | "lede"
  | "overline"
  | "metric"
  | "image"

export type WechatBlockAlign = "left" | "center" | "right"
export type WechatBlockFont = "system" | "serif" | "rounded" | "friendly"
  | "editorial"

export interface WechatContentBlock {
  id: string
  type: "content"
  sourceId: string
  variant: WechatBlockVariant
  background: string
  color: string
  accentColor: string
  borderColor: string
  borderWidth: number
  radius: number
  padding: number
  marginTop: number
  marginBottom: number
  fontSize: number
  fontWeight: number
  fontStyle: "normal" | "italic"
  textDecoration: "none" | "underline"
  letterSpacing: number
  lineHeight: number
  align: WechatBlockAlign
  imageFit: "cover" | "contain"
  imageRadius: number
}

export interface WechatDecorationBlock {
  id: string
  type: "decoration"
  anchorSourceId: string
  placement: "before" | "after"
  d: string
  viewBoxWidth: number
  viewBoxHeight: number
  width: number
  height: number
  align: WechatBlockAlign
  fill: string
  stroke: string
  strokeWidth: number
  marginTop: number
  marginBottom: number
}

export type WechatSectionLayout = "stack" | "two-column" | "comparison" | "feature"
  | "editorial"
export type WechatSectionAccent = "none" | "top" | "left" | "bottom" | "tri-color"

export interface WechatTextStyleOverride {
  variant?: Exclude<WechatBlockVariant, "image">
  background?: string
  color?: string
  accentColor?: string
  fontSize?: number
  fontWeight?: number
  fontStyle?: "normal" | "italic"
  textDecoration?: "none" | "underline"
  letterSpacing?: number
  lineHeight?: number
  align?: WechatBlockAlign
}

export interface WechatSectionBlock {
  id: string
  type: "section"
  sourceIds: string[]
  layout: WechatSectionLayout
  background: string
  color: string
  accentColor: string
  borderColor: string
  borderWidth: number
  radius: number
  padding: number
  gap: number
  marginTop: number
  marginBottom: number
  divider: boolean
  accentStyle: WechatSectionAccent
  shadow: "none" | "soft"
  leadSourceId?: string
  overlineSourceId?: string
  itemStyles: Record<string, WechatTextStyleOverride>
}

export type WechatBlock = WechatContentBlock | WechatDecorationBlock | WechatSectionBlock

export interface WechatBlockDocument {
  version: 1
  name: string
  width: 677
  background: string
  pageBackground: string
  font: WechatBlockFont
  blocks: WechatBlock[]
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("公众号块文档必须是 JSON 对象")
  }
  return value as Record<string, unknown>
}

function textIn(value: unknown, fallback: string, maxLength: number): string {
  return (typeof value === "string" ? value : fallback).slice(0, maxLength)
}

function numberIn(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function colorIn(value: unknown, fallback: string): string {
  const color = textIn(value, fallback, 32)
  return /^(#[0-9a-f]{3,8}|rgba?\([0-9.,\s%]+\)|transparent)$/i.test(color) ? color : fallback
}

function idIn(value: unknown, fallback: string): string {
  return textIn(value, fallback, 64).replace(/[^a-zA-Z0-9_-]/g, "-")
}

function pathIn(value: unknown): string {
  const path = textIn(value, "", 4000).trim()
  if (!path || !/[Mm]/.test(path)) return ""
  return /^[MmLlHhVvCcSsQqTtAaZzEe0-9.,+\-\s]+$/.test(path) ? path : ""
}

function parseContentBlock(record: Record<string, unknown>, index: number): WechatContentBlock {
  const variants: WechatBlockVariant[] = [
    "plain", "title", "banner", "card", "quote", "highlight", "lede", "overline", "metric", "image",
  ]
  const aligns: WechatBlockAlign[] = ["left", "center", "right"]
  return {
    id: idIn(record.id, `block-${index + 1}`),
    type: "content",
    sourceId: idIn(record.sourceId, ""),
    variant: variants.includes(record.variant as WechatBlockVariant)
      ? record.variant as WechatBlockVariant
      : "plain",
    background: colorIn(record.background, "transparent"),
    color: colorIn(record.color, "#262626"),
    accentColor: colorIn(record.accentColor, "#2f6f62"),
    borderColor: colorIn(record.borderColor, "transparent"),
    borderWidth: numberIn(record.borderWidth, 0, 0, 8),
    radius: numberIn(record.radius, 0, 0, 32),
    padding: numberIn(record.padding, 0, 0, 48),
    marginTop: numberIn(record.marginTop, 0, 0, 80),
    marginBottom: numberIn(record.marginBottom, 20, 0, 80),
    fontSize: numberIn(record.fontSize, 17, 12, 48),
    fontWeight: numberIn(record.fontWeight, 400, 300, 900),
    fontStyle: record.fontStyle === "italic" ? "italic" : "normal",
    textDecoration: record.textDecoration === "underline" ? "underline" : "none",
    letterSpacing: numberIn(record.letterSpacing, 0, 0, 8),
    lineHeight: numberIn(record.lineHeight, 1.8, 1, 2.6),
    align: aligns.includes(record.align as WechatBlockAlign)
      ? record.align as WechatBlockAlign
      : "left",
    imageFit: record.imageFit === "contain" ? "contain" : "cover",
    imageRadius: numberIn(record.imageRadius, 0, 0, 32),
  }
}

function parseDecorationBlock(
  record: Record<string, unknown>,
  index: number,
): WechatDecorationBlock | null {
  const d = pathIn(record.d)
  if (!d) return null
  const aligns: WechatBlockAlign[] = ["left", "center", "right"]
  return {
    id: idIn(record.id, `decoration-${index + 1}`),
    type: "decoration",
    anchorSourceId: idIn(record.anchorSourceId, ""),
    placement: record.placement === "before" ? "before" : "after",
    d,
    viewBoxWidth: numberIn(record.viewBoxWidth, 240, 16, 1000),
    viewBoxHeight: numberIn(record.viewBoxHeight, 80, 16, 1000),
    width: numberIn(record.width, 160, 16, 677),
    height: numberIn(record.height, 56, 16, 320),
    align: aligns.includes(record.align as WechatBlockAlign)
      ? record.align as WechatBlockAlign
      : "center",
    fill: colorIn(record.fill, "transparent"),
    stroke: colorIn(record.stroke, "#2f6f62"),
    strokeWidth: numberIn(record.strokeWidth, 3, 0, 20),
    marginTop: numberIn(record.marginTop, 4, 0, 64),
    marginBottom: numberIn(record.marginBottom, 16, 0, 64),
  }
}

function parseSectionBlock(
  record: Record<string, unknown>,
  index: number,
): WechatSectionBlock | null {
  const sourceIds = Array.isArray(record.sourceIds)
    ? [...new Set(record.sourceIds.map(value => idIn(value, "")).filter(Boolean))].slice(0, 8)
    : []
  if (sourceIds.length < 2) return null
  const layouts: WechatSectionLayout[] = ["stack", "two-column", "comparison", "feature", "editorial"]
  const rawItemStyles = record.itemStyles && typeof record.itemStyles === "object" && !Array.isArray(record.itemStyles)
    ? record.itemStyles as Record<string, unknown>
    : {}
  const itemStyles = Object.fromEntries(sourceIds.flatMap(sourceId => {
    const rawStyle = rawItemStyles[sourceId]
    if (!rawStyle || typeof rawStyle !== "object" || Array.isArray(rawStyle)) return []
    const style = rawStyle as Record<string, unknown>
    const variants: Array<Exclude<WechatBlockVariant, "image">> = [
      "plain", "title", "banner", "card", "quote", "highlight", "lede", "overline", "metric",
    ]
    const aligns: WechatBlockAlign[] = ["left", "center", "right"]
    return [[sourceId, {
      variant: variants.includes(style.variant as Exclude<WechatBlockVariant, "image">)
        ? style.variant as Exclude<WechatBlockVariant, "image">
        : undefined,
      background: style.background === undefined ? undefined : colorIn(style.background, "transparent"),
      color: style.color === undefined ? undefined : colorIn(style.color, "#262626"),
      accentColor: style.accentColor === undefined ? undefined : colorIn(style.accentColor, "#5263a5"),
      fontSize: style.fontSize === undefined ? undefined : numberIn(style.fontSize, 17, 12, 48),
      fontWeight: style.fontWeight === undefined ? undefined : numberIn(style.fontWeight, 400, 300, 900),
      fontStyle: style.fontStyle === "italic" ? "italic" : undefined,
      textDecoration: style.textDecoration === "underline" ? "underline" : undefined,
      letterSpacing: style.letterSpacing === undefined ? undefined : numberIn(style.letterSpacing, 0, 0, 8),
      lineHeight: style.lineHeight === undefined ? undefined : numberIn(style.lineHeight, 1.8, 1, 2.6),
      align: aligns.includes(style.align as WechatBlockAlign)
        ? style.align as WechatBlockAlign
        : undefined,
    } satisfies WechatTextStyleOverride]]
  }))
  return {
    id: idIn(record.id, `section-${index + 1}`),
    type: "section",
    sourceIds,
    layout: layouts.includes(record.layout as WechatSectionLayout)
      ? record.layout as WechatSectionLayout
      : "stack",
    background: colorIn(record.background, "#ffffff"),
    color: colorIn(record.color, "#262626"),
    accentColor: colorIn(record.accentColor, "#5263a5"),
    borderColor: colorIn(record.borderColor, "#dee0e3"),
    borderWidth: numberIn(record.borderWidth, 1, 0, 8),
    radius: numberIn(record.radius, 8, 0, 32),
    padding: numberIn(record.padding, 20, 0, 48),
    gap: numberIn(record.gap, 16, 0, 40),
    marginTop: numberIn(record.marginTop, 8, 0, 80),
    marginBottom: numberIn(record.marginBottom, 24, 0, 80),
    divider: record.divider !== false,
    accentStyle: ["none", "top", "left", "bottom", "tri-color"].includes(String(record.accentStyle))
      ? record.accentStyle as WechatSectionAccent
      : "none",
    shadow: record.shadow === "soft" ? "soft" : "none",
    leadSourceId: sourceIds.includes(String(record.leadSourceId)) ? String(record.leadSourceId) : undefined,
    overlineSourceId: sourceIds.includes(String(record.overlineSourceId)) ? String(record.overlineSourceId) : undefined,
    itemStyles,
  }
}

export function parseWechatBlockDocument(value: unknown): WechatBlockDocument {
  const record = asRecord(value)
  const rawBlocks = Array.isArray(record.blocks) ? record.blocks.slice(0, 140) : []
  const blocks = rawBlocks.flatMap((item, index): WechatBlock[] => {
    try {
      const block = asRecord(item)
      if (block.type === "content") return [parseContentBlock(block, index)]
      if (block.type === "decoration") {
        const decoration = parseDecorationBlock(block, index)
        return decoration ? [decoration] : []
      }
      if (block.type === "section") {
        const section = parseSectionBlock(block, index)
        return section ? [section] : []
      }
      return []
    } catch {
      return []
    }
  })

  return {
    version: 1,
    name: textIn(record.name, "公众号块排版", 80),
    width: 677,
    background: colorIn(record.background, "#ffffff"),
    pageBackground: colorIn(record.pageBackground, "#f4f1e8"),
    font: ["system", "serif", "rounded", "friendly", "editorial"].includes(String(record.font))
      ? record.font as WechatBlockFont
      : "system",
    blocks,
  }
}

function fallbackStyle(kind: CanvasSourceKind): Omit<WechatContentBlock, "id" | "sourceId" | "type"> {
  const common = {
    accentColor: "#2f6f62",
    borderColor: "transparent",
    borderWidth: 0,
    radius: 0,
    marginTop: 0,
    align: "left" as const,
    imageFit: "cover" as const,
    imageRadius: 6,
    fontStyle: "normal" as const,
    textDecoration: "none" as const,
    letterSpacing: 0,
  }
  if (kind === "title") {
    return { ...common, variant: "title", background: "transparent", color: "#171717", padding: 0, marginBottom: 34, fontSize: 34, fontWeight: 800, lineHeight: 1.35 }
  }
  if (kind === "heading") {
    return { ...common, variant: "banner", background: "#e7f0ed", color: "#183c35", borderColor: "#2f6f62", borderWidth: 0, radius: 4, padding: 14, marginTop: 20, marginBottom: 20, fontSize: 23, fontWeight: 750, lineHeight: 1.45 }
  }
  if (kind === "quote") {
    return { ...common, variant: "quote", background: "#f5f0e0", color: "#3d3a33", borderColor: "#e8b94a", borderWidth: 0, radius: 4, padding: 20, marginBottom: 24, fontSize: 17, fontWeight: 500, lineHeight: 1.8 }
  }
  if (kind === "list") {
    return { ...common, variant: "card", background: "#fff8ec", color: "#2d2b27", borderColor: "#ead8bd", borderWidth: 1, radius: 6, padding: 18, marginBottom: 24, fontSize: 17, fontWeight: 400, lineHeight: 1.9 }
  }
  if (kind === "image") {
    return { ...common, variant: "image", background: "transparent", color: "#666666", padding: 0, marginTop: 6, marginBottom: 28, fontSize: 13, fontWeight: 400, lineHeight: 1.5 }
  }
  return { ...common, variant: "plain", background: "transparent", color: "#2c2c2c", padding: 0, marginBottom: 22, fontSize: 17, fontWeight: 400, lineHeight: 1.9 }
}

export function createWechatContentBlock(source: CanvasSource): WechatContentBlock {
  return {
    id: `block-${source.id}`,
    type: "content",
    sourceId: source.id,
    ...fallbackStyle(source.kind),
  }
}

export function createWechatBlockDocument(
  name: string,
  sources: CanvasSource[],
): WechatBlockDocument {
  return {
    version: 1,
    name: name || "公众号块排版",
    width: 677,
    background: "#ffffff",
    pageBackground: "#f4f1e8",
    font: "system",
    blocks: sources.map(createWechatContentBlock),
  }
}

function validSection(
  section: WechatSectionBlock,
  sourceIndex: Map<string, number>,
): boolean {
  const indexes = section.sourceIds.map(id => sourceIndex.get(id))
  if (indexes.some(index => index === undefined)) return false
  return indexes.every((index, offset) => (
    typeof index === "number"
    && index === (indexes[0] as number) + offset
  ))
}

function createTemplateSection(
  sourceIds: string[],
  templateId: CanvasDesignTemplateId,
  index: number,
): WechatSectionBlock {
  if (templateId === "weekly-dashboard") {
    return {
      id: `template-section-${index}`,
      type: "section",
      sourceIds,
      layout: "comparison",
      background: "#ffffff",
      color: "#1f2329",
      accentColor: "#5263a5",
      borderColor: "#dee0e3",
      borderWidth: 1,
      radius: 8,
      padding: 20,
      gap: 16,
      marginTop: 8,
      marginBottom: 24,
      divider: true,
      accentStyle: "none",
      shadow: "none",
      itemStyles: {},
    }
  }
  if (templateId === "interview-notes") {
    return {
      id: `template-section-${index}`,
      type: "section",
      sourceIds,
      layout: "two-column",
      background: "#fff8ec",
      color: "#2d2b27",
      accentColor: "#d9855b",
      borderColor: "#ead8bd",
      borderWidth: 1,
      radius: 8,
      padding: 20,
      gap: 14,
      marginTop: 8,
      marginBottom: 24,
      divider: false,
      accentStyle: "none",
      shadow: "none",
      itemStyles: {},
    }
  }
  return {
    id: `template-section-${index}`,
    type: "section",
    sourceIds,
    layout: "feature",
    background: "#ffffff",
    color: "#262626",
    accentColor: "#2f6f62",
    borderColor: "#e3e5e7",
    borderWidth: 1,
    radius: 6,
    padding: 20,
    gap: 16,
    marginTop: 8,
    marginBottom: 24,
    divider: false,
    accentStyle: "none",
    shadow: "none",
    itemStyles: {},
  }
}

function applyTemplateSections(
  blocks: WechatBlock[],
  sources: CanvasSource[],
  templateId: CanvasDesignTemplateId,
): WechatBlock[] {
  if (blocks.filter(block => block.type === "section").length >= 2 || sources.length < 4) {
    return blocks
  }
  const sourceMap = new Map(sources.map(source => [source.id, source]))
  const result: WechatBlock[] = []
  const pending: WechatContentBlock[] = []
  let sectionIndex = 0

  const flush = () => {
    while (pending.length > 0) {
      const chunk = pending.splice(0, Math.min(4, pending.length))
      if (chunk.length === 1) result.push(chunk[0])
      else {
        result.push(createTemplateSection(
          chunk.map(block => block.sourceId),
          templateId,
          sectionIndex++,
        ))
      }
    }
  }

  for (const block of blocks) {
    if (block.type !== "content") {
      flush()
      result.push(block)
      continue
    }
    const source = sourceMap.get(block.sourceId)
    if (source?.kind === "title") {
      flush()
      result.push(block)
      continue
    }
    if (source?.kind === "heading" && pending.length > 0) flush()
    pending.push(block)
  }
  flush()
  return result
}

export function hydrateWechatBlockDocument(
  value: unknown,
  sources: CanvasSource[],
  name: string,
  options: { templateId?: CanvasDesignTemplateId } = {},
): WechatBlockDocument {
  const parsed = parseWechatBlockDocument(value)
  const sourceIds = new Set(sources.map(source => source.id))
  const sourceIndex = new Map(sources.map((source, index) => [source.id, index]))
  const contentCandidates = new Map<string, WechatContentBlock>()
  const sectionCandidates = new Map<string, WechatSectionBlock>()
  const decorations = parsed.blocks
    .filter((block): block is WechatDecorationBlock => (
      block.type === "decoration"
      && sourceIds.has(block.anchorSourceId)
    ))
    .slice(0, 24)
    .map((block, index) => ({ ...block, id: `decoration-${index + 1}` }))

  for (const block of parsed.blocks) {
    if (
      block.type === "content"
      && sourceIds.has(block.sourceId)
      && !contentCandidates.has(block.sourceId)
    ) {
      contentCandidates.set(block.sourceId, block)
    }
    if (
      block.type === "section"
      && validSection(block, sourceIndex)
      && !sectionCandidates.has(block.sourceIds[0])
    ) {
      sectionCandidates.set(block.sourceIds[0], block)
    }
  }

  const blocks: WechatBlock[] = []
  for (let sourcePosition = 0; sourcePosition < sources.length; sourcePosition += 1) {
    const source = sources[sourcePosition]
    blocks.push(...decorations.filter(block => (
      block.anchorSourceId === source.id && block.placement === "before"
    )))

    const section = sectionCandidates.get(source.id)
    if (section) {
      blocks.push({
        ...section,
        id: `section-${source.id}`,
        sourceIds: [...section.sourceIds],
      })
      const lastSourceId = section.sourceIds[section.sourceIds.length - 1]
      blocks.push(...decorations.filter(block => (
        section.sourceIds.includes(block.anchorSourceId)
        && block.placement === "after"
      )).map(block => ({ ...block, anchorSourceId: lastSourceId })))
      sourcePosition += section.sourceIds.length - 1
      continue
    }

    const candidate = contentCandidates.get(source.id)
    const fallback = createWechatContentBlock(source)
    blocks.push(candidate ? {
      ...candidate,
      id: `block-${source.id}`,
      sourceId: source.id,
      variant: source.kind === "image"
        ? "image"
        : candidate.variant === "image"
          ? fallback.variant
          : candidate.variant,
      fontSize: source.kind === "title"
        ? Math.max(28, candidate.fontSize)
        : Math.min(28, candidate.fontSize),
    } : fallback)

    blocks.push(...decorations.filter(block => (
      block.anchorSourceId === source.id && block.placement === "after"
    )))
  }

  const templatedBlocks = options.templateId
    ? applyTemplateSections(blocks, sources, options.templateId)
    : blocks
  return {
    ...parsed,
    name: name || parsed.name,
    blocks: templatedBlocks,
  }
}
