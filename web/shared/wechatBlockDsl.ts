import { getCanvasMaterial, parseCanvasLibraryImage, type CanvasLibraryImage, type CanvasMaterialId } from "./canvasMaterialLibrary.ts"
import type { CanvasSource, CanvasSourceKind } from "./canvasArticle.ts"

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
  | "dropcap"
  | "image"

export type WechatBlockAlign = "left" | "center" | "right"
export type WechatBlockFont = "system" | "serif" | "rounded" | "friendly"
  | "editorial"

export interface WechatInlineMark {
  match: string
  occurrence: number
  color: string
  background: string
  fontWeight: number
  textDecoration: "none" | "underline"
}

export type WechatSurfaceKind =
  | "none"
  | "solid"
  | "linear"
  | "stripes"
  | "dots"
  | "grid"
  | "ruled-paper"
  | "generated"

export interface WechatSurfaceStyle {
  kind: WechatSurfaceKind
  colors: string[]
  patternColor: string
  angle: number
  size: number
  opacity: number
  prompt: string
  imageSize: WechatGeneratedImageSize
  fit: "cover" | "contain" | "tile"
  overlayColor: string
  overlayOpacity: number
}

export interface WechatBlockTheme {
  publicationStyle?: "scrapbook"
  font: WechatBlockFont
  canvas: string
  surface: string
  surfaceAlt: string
  text: string
  muted: string
  primary: string
  secondary: string
  accent: string
  border: string
  displaySize: number
  displayWeight: number
  displayLineHeight: number
  headingSize: number
  headingWeight: number
  headingLineHeight: number
  bodySize: number
  bodyWeight: number
  bodyLineHeight: number
  radius: number
  sectionGap: number
  canvasStyle: WechatSurfaceStyle
}

export type WechatSectionPreset =
  | "plain"
  | "soft"
  | "feature"
  | "editorial"
  | "callout"

export type WechatIconName =
  | "book-open"
  | "quote"
  | "lightbulb"
  | "sparkles"
  | "mic"
  | "trending-up"
  | "check-circle"
  | "arrow-right"
  | "bar-chart"

export interface WechatSectionIcon {
  kind: "lucide" | "path"
  name?: WechatIconName
  d?: string
  color: string
  size: number
  position: "top-left" | "top-right" | "inline"
}

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
  textIndent: number
  marks: WechatInlineMark[]
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

export type WechatGeneratedImageSize =
  | "square_hd"
  | "square"
  | "portrait_4_3"
  | "portrait_16_9"
  | "landscape_4_3"
  | "landscape_16_9"

export interface WechatAssetBlock {
  libraryImage?: CanvasLibraryImage
  materialId?: CanvasMaterialId
  id: string
  type: "asset"
  anchorSourceId: string
  placement: "before" | "after"
  prompt: string
  imageSize: WechatGeneratedImageSize
  width: number
  radius: number
  align: WechatBlockAlign
  marginTop: number
  marginBottom: number
}

export interface WechatDividerBlock {
  id: string
  type: "divider"
  anchorSourceId: string
  placement: "before" | "after"
  style: "solid" | "dashed" | "dotted" | "double" | "gradient"
  color: string
  secondaryColor: string
  width: number
  thickness: number
  align: WechatBlockAlign
  marginTop: number
  marginBottom: number
}

export interface WechatSwitcherBlock {
  id: string
  type: "switcher"
  anchorSourceId: string
  placement: "before" | "after"
  beforePrompt: string
  afterPrompt: string
  imageSize: WechatGeneratedImageSize
  width: number
  radius: number
  align: WechatBlockAlign
  marginTop: number
  marginBottom: number
}

export type WechatSectionLayout = "stack" | "two-column" | "comparison" | "feature"
  | "editorial" | "timeline" | "steps" | "media-text" | "grid"
export type WechatSectionAccent = "none" | "top" | "left" | "bottom" | "tri-color"

export interface WechatTextStyleOverride {
  variant?: Exclude<WechatBlockVariant, "image">
  background?: string
  color?: string
  accentColor?: string
  borderColor?: string
  borderWidth?: number
  radius?: number
  padding?: number
  marginTop?: number
  marginBottom?: number
  fontSize?: number
  fontWeight?: number
  fontStyle?: "normal" | "italic"
  textDecoration?: "none" | "underline"
  letterSpacing?: number
  lineHeight?: number
  textIndent?: number
  marks?: WechatInlineMark[]
  align?: WechatBlockAlign
}

export interface WechatSectionBlock {
  frame?: "notebook" | "photo" | "collage" | "letter" | "ticket"
  id: string
  type: "section"
  sourceIds: string[]
  layout: WechatSectionLayout
  columnRatio: "1:1" | "1:2" | "2:1"
  mediaPosition: "left" | "right"
  columns: 2 | 3
  preset: WechatSectionPreset
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
  surfaceStyle?: WechatSurfaceStyle
  leadSourceId?: string
  overlineSourceId?: string
  icon?: WechatSectionIcon
  itemStyles: Record<string, WechatTextStyleOverride>
}

export type WechatBlock =
  | WechatContentBlock
  | WechatDecorationBlock
  | WechatAssetBlock
  | WechatDividerBlock
  | WechatSwitcherBlock
  | WechatSectionBlock

export interface WechatBlockDocument {
  version: 1
  name: string
  width: 677
  sidePadding: number
  background: string
  pageBackground: string
  font: WechatBlockFont
  theme: WechatBlockTheme
  blocks: WechatBlock[]
}

export const DEFAULT_WECHAT_BLOCK_THEME: WechatBlockTheme = {
  font: "system",
  canvas: "#ffffff",
  surface: "#ffffff",
  surfaceAlt: "#f7f7f7",
  text: "#262626",
  muted: "#6a6a6a",
  primary: "#2f6f62",
  secondary: "#3b82f6",
  accent: "#e8b94a",
  border: "#e5e5e5",
  displaySize: 34,
  displayWeight: 800,
  displayLineHeight: 1.25,
  headingSize: 23,
  headingWeight: 700,
  headingLineHeight: 1.4,
  bodySize: 17,
  bodyWeight: 400,
  bodyLineHeight: 1.8,
  radius: 6,
  sectionGap: 24,
  canvasStyle: {
    kind: "none",
    colors: ["#ffffff"],
    patternColor: "rgba(47,111,98,0.12)",
    angle: 135,
    size: 20,
    opacity: 0.12,
    prompt: "",
    imageSize: "landscape_16_9",
    fit: "cover",
    overlayColor: "#ffffff",
    overlayOpacity: 0.12,
  },
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

function promptIn(value: unknown): string {
  return textIn(value, "", 600)
    .split("")
    .map(character => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127 ? character : " "
    })
    .join("")
    .trim()
}

function imageSizeIn(value: unknown): WechatGeneratedImageSize {
  const sizes: WechatGeneratedImageSize[] = [
    "square_hd",
    "square",
    "portrait_4_3",
    "portrait_16_9",
    "landscape_4_3",
    "landscape_16_9",
  ]
  return sizes.includes(value as WechatGeneratedImageSize)
    ? value as WechatGeneratedImageSize
    : "landscape_16_9"
}

function numberIn(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function colorIn(value: unknown, fallback: string): string {
  const color = textIn(value, fallback, 32)
  return /^(#[0-9a-f]{3,8}|rgba?\([0-9.,\s%]+\)|transparent)$/i.test(color) ? color : fallback
}

function hasVisibleFill(color: string): boolean {
  if (color.toLowerCase() === "transparent") return false
  const rgba = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)$/i)
  return !rgba || Number(rgba[1]) > 0
}

function parseSurfaceStyle(
  value: unknown,
  fallbackColor: string,
): WechatSurfaceStyle {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const kinds: WechatSurfaceKind[] = [
    "none",
    "solid",
    "linear",
    "stripes",
    "dots",
    "grid",
    "ruled-paper",
    "generated",
  ]
  const colors = Array.isArray(record.colors)
    ? record.colors
      .slice(0, 3)
      .map(color => colorIn(color, ""))
      .filter(Boolean)
    : []
  const prompt = promptIn(record.prompt)
  const requestedKind = kinds.includes(record.kind as WechatSurfaceKind)
      ? record.kind as WechatSurfaceKind
      : "none"
  return {
    kind: requestedKind === "generated" && !prompt ? "none" : requestedKind,
    colors: colors.length > 0 ? colors : [fallbackColor],
    patternColor: colorIn(record.patternColor, "rgba(47,111,98,0.12)"),
    angle: numberIn(record.angle, 135, 0, 360),
    size: numberIn(record.size, 20, 6, 80),
    opacity: numberIn(record.opacity, 0.12, 0.02, 0.5),
    prompt,
    imageSize: imageSizeIn(record.imageSize),
    fit: ["cover", "contain", "tile"].includes(String(record.fit))
      ? record.fit as WechatSurfaceStyle["fit"]
      : "cover",
    overlayColor: colorIn(record.overlayColor, "#ffffff"),
    overlayOpacity: numberIn(record.overlayOpacity, 0.12, 0, 0.8),
  }
}

function fontIn(value: unknown, fallback: WechatBlockFont): WechatBlockFont {
  return ["system", "serif", "rounded", "friendly", "editorial"].includes(String(value))
    ? value as WechatBlockFont
    : fallback
}

function parseTheme(value: unknown): WechatBlockTheme {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    publicationStyle: record.publicationStyle === "scrapbook" ? "scrapbook" : undefined,
    font: fontIn(record.font, DEFAULT_WECHAT_BLOCK_THEME.font),
    canvas: colorIn(record.canvas, DEFAULT_WECHAT_BLOCK_THEME.canvas),
    surface: colorIn(record.surface, DEFAULT_WECHAT_BLOCK_THEME.surface),
    surfaceAlt: colorIn(record.surfaceAlt, DEFAULT_WECHAT_BLOCK_THEME.surfaceAlt),
    text: colorIn(record.text, DEFAULT_WECHAT_BLOCK_THEME.text),
    muted: colorIn(record.muted, DEFAULT_WECHAT_BLOCK_THEME.muted),
    primary: colorIn(record.primary, DEFAULT_WECHAT_BLOCK_THEME.primary),
    secondary: colorIn(record.secondary, DEFAULT_WECHAT_BLOCK_THEME.secondary),
    accent: colorIn(record.accent, DEFAULT_WECHAT_BLOCK_THEME.accent),
    border: colorIn(record.border, DEFAULT_WECHAT_BLOCK_THEME.border),
    displaySize: numberIn(record.displaySize, DEFAULT_WECHAT_BLOCK_THEME.displaySize, 24, 64),
    displayWeight: numberIn(record.displayWeight, DEFAULT_WECHAT_BLOCK_THEME.displayWeight, 300, 900),
    displayLineHeight: numberIn(record.displayLineHeight, DEFAULT_WECHAT_BLOCK_THEME.displayLineHeight, 1, 2),
    headingSize: numberIn(record.headingSize, DEFAULT_WECHAT_BLOCK_THEME.headingSize, 16, 42),
    headingWeight: numberIn(record.headingWeight, DEFAULT_WECHAT_BLOCK_THEME.headingWeight, 300, 900),
    headingLineHeight: numberIn(record.headingLineHeight, DEFAULT_WECHAT_BLOCK_THEME.headingLineHeight, 1, 2.2),
    bodySize: numberIn(record.bodySize, DEFAULT_WECHAT_BLOCK_THEME.bodySize, 12, 24),
    bodyWeight: numberIn(record.bodyWeight, DEFAULT_WECHAT_BLOCK_THEME.bodyWeight, 300, 900),
    bodyLineHeight: numberIn(record.bodyLineHeight, DEFAULT_WECHAT_BLOCK_THEME.bodyLineHeight, 1.2, 2.4),
    radius: numberIn(record.radius, DEFAULT_WECHAT_BLOCK_THEME.radius, 0, 32),
    sectionGap: numberIn(record.sectionGap, DEFAULT_WECHAT_BLOCK_THEME.sectionGap, 8, 96),
    canvasStyle: parseSurfaceStyle(
      record.canvasStyle,
      colorIn(record.canvas, DEFAULT_WECHAT_BLOCK_THEME.canvas),
    ),
  }
}

function idIn(value: unknown, fallback: string): string {
  return textIn(value, fallback, 64).replace(/[^a-zA-Z0-9_-]/g, "-")
}

function pathIn(value: unknown): string {
  const path = textIn(value, "", 4000).trim()
  if (!path || !/[Mm]/.test(path)) return ""
  return /^[MmLlHhVvCcSsQqTtAaZzEe0-9.,+\-\s]+$/.test(path) ? path : ""
}

function parseInlineMarks(value: unknown): WechatInlineMark[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 3).flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const match = textIn(record.match, "", 80).trim()
    if (!match) return []
    const mark: WechatInlineMark = {
      match,
      occurrence: numberIn(record.occurrence, 1, 1, 8),
      color: colorIn(record.color, "transparent"),
      background: colorIn(record.background, "transparent"),
      fontWeight: numberIn(record.fontWeight, 700, 300, 900),
      textDecoration: record.textDecoration === "underline" ? "underline" : "none",
    }
    return [mark]
  }).filter((mark, index, marks) => (
    marks.findIndex(candidate => (
      candidate.match === mark.match && candidate.occurrence === mark.occurrence
    )) === index
  ))
}

function validInlineMarks(
  marks: WechatInlineMark[],
  sourceText: string,
): WechatInlineMark[] {
  return marks.filter(mark => {
    let from = 0
    let index: number
    for (let count = 0; count < mark.occurrence; count += 1) {
      index = sourceText.indexOf(mark.match, from)
      if (index < 0) return false
      from = index + mark.match.length
    }
    return true
  })
}

function parseContentBlock(
  record: Record<string, unknown>,
  index: number,
  theme: WechatBlockTheme,
): WechatContentBlock {
  const variants: WechatBlockVariant[] = [
    "plain", "title", "banner", "card", "quote", "highlight", "lede", "overline", "metric", "dropcap", "image",
  ]
  const aligns: WechatBlockAlign[] = ["left", "center", "right"]
  const variant = variants.includes(record.variant as WechatBlockVariant)
    ? record.variant as WechatBlockVariant
    : "plain"
  const display = variant === "title" || variant === "metric"
  const heading = variant === "banner"
  const overline = variant === "overline"
  const lede = variant === "lede" || variant === "quote"
  const background = colorIn(record.background, "transparent")
  const borderWidth = numberIn(record.borderWidth, 0, 0, 8)
  const requestedPadding = numberIn(record.padding, 0, 0, 48)
  const padding = borderWidth > 0 || hasVisibleFill(background)
    ? Math.max(12, requestedPadding)
    : requestedPadding
  return {
    id: idIn(record.id, `block-${index + 1}`),
    type: "content",
    sourceId: idIn(record.sourceId, ""),
    variant,
    background,
    color: colorIn(record.color, theme.text),
    accentColor: colorIn(record.accentColor, theme.accent),
    borderColor: colorIn(record.borderColor, "transparent"),
    borderWidth,
    radius: numberIn(record.radius, 0, 0, 32),
    padding,
    marginTop: numberIn(record.marginTop, 0, 0, 80),
    marginBottom: numberIn(record.marginBottom, 20, 0, 80),
    fontSize: numberIn(
      record.fontSize,
      display
        ? theme.displaySize
        : heading
          ? theme.headingSize
          : overline
            ? Math.min(12, theme.bodySize)
            : lede
              ? Math.min(24, theme.bodySize + 3)
              : theme.bodySize,
      10,
      64,
    ),
    fontWeight: numberIn(
      record.fontWeight,
      display
        ? theme.displayWeight
        : heading || overline
          ? theme.headingWeight
          : theme.bodyWeight,
      300,
      900,
    ),
    fontStyle: record.fontStyle === "italic" ? "italic" : "normal",
    textDecoration: record.textDecoration === "underline" ? "underline" : "none",
    letterSpacing: numberIn(record.letterSpacing, 0, 0, 8),
    lineHeight: numberIn(
      record.lineHeight,
      display
        ? theme.displayLineHeight
        : heading
          ? theme.headingLineHeight
          : theme.bodyLineHeight,
      1,
      2.6,
    ),
    textIndent: numberIn(record.textIndent, 0, 0, 64),
    marks: parseInlineMarks(record.marks),
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

function parseAssetBlock(
  record: Record<string, unknown>,
  index: number,
): WechatAssetBlock | null {
  const prompt = promptIn(record.prompt)
  const materialId = getCanvasMaterial(record.materialId)?.id
  const libraryImage = parseCanvasLibraryImage(record.libraryImage)
  if (!prompt && !materialId && !libraryImage) return null
  const aligns: WechatBlockAlign[] = ["left", "center", "right"]
  return {
    id: idIn(record.id, `asset-${index + 1}`),
    materialId,
    libraryImage,
    type: "asset",
    anchorSourceId: idIn(record.anchorSourceId, ""),
    placement: record.placement === "before" ? "before" : "after",
    prompt,
    imageSize: imageSizeIn(record.imageSize),
    width: numberIn(record.width, 320, 80, 677),
    radius: numberIn(record.radius, 0, 0, 32),
    align: aligns.includes(record.align as WechatBlockAlign)
      ? record.align as WechatBlockAlign
      : "center",
    marginTop: numberIn(record.marginTop, 12, 0, 80),
    marginBottom: numberIn(record.marginBottom, 24, 0, 80),
  }
}

function parseDividerBlock(
  record: Record<string, unknown>,
  index: number,
  theme: WechatBlockTheme,
): WechatDividerBlock | null {
  const anchorSourceId = idIn(record.anchorSourceId, "")
  if (!anchorSourceId) return null
  const styles: WechatDividerBlock["style"][] = [
    "solid", "dashed", "dotted", "double", "gradient",
  ]
  const aligns: WechatBlockAlign[] = ["left", "center", "right"]
  return {
    id: idIn(record.id, `divider-${index + 1}`),
    type: "divider",
    anchorSourceId,
    placement: record.placement === "before" ? "before" : "after",
    style: styles.includes(record.style as WechatDividerBlock["style"])
      ? record.style as WechatDividerBlock["style"]
      : "solid",
    color: colorIn(record.color, theme.accent),
    secondaryColor: colorIn(record.secondaryColor, theme.secondary),
    width: numberIn(record.width, 120, 24, 677),
    thickness: numberIn(record.thickness, 2, 1, 8),
    align: aligns.includes(record.align as WechatBlockAlign)
      ? record.align as WechatBlockAlign
      : "center",
    marginTop: numberIn(record.marginTop, 16, 0, 80),
    marginBottom: numberIn(record.marginBottom, 20, 0, 80),
  }
}

function parseSwitcherBlock(
  record: Record<string, unknown>,
  index: number,
): WechatSwitcherBlock | null {
  const anchorSourceId = idIn(record.anchorSourceId, "")
  const beforePrompt = promptIn(record.beforePrompt)
  const afterPrompt = promptIn(record.afterPrompt)
  if (
    !anchorSourceId
    || !beforePrompt
    || !afterPrompt
    || beforePrompt.toLowerCase() === afterPrompt.toLowerCase()
  ) return null
  const aligns: WechatBlockAlign[] = ["left", "center", "right"]
  return {
    id: idIn(record.id, `switcher-${index + 1}`),
    type: "switcher",
    anchorSourceId,
    placement: record.placement === "before" ? "before" : "after",
    beforePrompt,
    afterPrompt,
    imageSize: imageSizeIn(record.imageSize),
    width: numberIn(record.width, 597, 120, 677),
    radius: numberIn(record.radius, 0, 0, 32),
    align: aligns.includes(record.align as WechatBlockAlign)
      ? record.align as WechatBlockAlign
      : "center",
    marginTop: numberIn(record.marginTop, 16, 0, 80),
    marginBottom: numberIn(record.marginBottom, 24, 0, 80),
  }
}

function parseSectionIcon(
  value: unknown,
  theme: WechatBlockTheme,
): WechatSectionIcon | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const names: WechatIconName[] = [
    "book-open",
    "quote",
    "lightbulb",
    "sparkles",
    "mic",
    "trending-up",
    "check-circle",
    "arrow-right",
    "bar-chart",
  ]
  const name = names.includes(record.name as WechatIconName)
    ? record.name as WechatIconName
    : undefined
  const d = pathIn(record.d)
  const kind = record.kind === "path" && d
    ? "path"
    : name
      ? "lucide"
      : null
  if (!kind) return undefined
  return {
    kind,
    name: kind === "lucide" ? name : undefined,
    d: kind === "path" ? d : undefined,
    color: colorIn(record.color, theme.accent),
    size: numberIn(record.size, 24, 14, 64),
    position: ["top-left", "top-right", "inline"].includes(String(record.position))
      ? record.position as WechatSectionIcon["position"]
      : "top-left",
  }
}

function parseSectionBlock(
  record: Record<string, unknown>,
  index: number,
  theme: WechatBlockTheme,
): WechatSectionBlock | null {
  const sourceIds = Array.isArray(record.sourceIds)
    ? [...new Set(record.sourceIds.map(value => idIn(value, "")).filter(Boolean))].slice(0, 8)
    : []
  if (sourceIds.length < 2) return null
  const layouts: WechatSectionLayout[] = [
    "stack", "two-column", "comparison", "feature", "editorial", "timeline", "steps",
    "media-text", "grid",
  ]
  const presets: WechatSectionPreset[] = ["plain", "soft", "feature", "editorial", "callout"]
  const preset = presets.includes(record.preset as WechatSectionPreset)
    ? record.preset as WechatSectionPreset
    : "plain"
  const framed = preset !== "plain"
  const defaultAccent: WechatSectionAccent = preset === "editorial" || preset === "feature"
    ? "top"
    : preset === "callout"
      ? "left"
      : "none"
  const rawItemStyles = record.itemStyles && typeof record.itemStyles === "object" && !Array.isArray(record.itemStyles)
    ? record.itemStyles as Record<string, unknown>
    : {}
  const itemStyles = Object.fromEntries(sourceIds.flatMap(sourceId => {
    const rawStyle = rawItemStyles[sourceId]
    if (!rawStyle || typeof rawStyle !== "object" || Array.isArray(rawStyle)) return []
    const style = rawStyle as Record<string, unknown>
    const variants: Array<Exclude<WechatBlockVariant, "image">> = [
      "plain", "title", "banner", "card", "quote", "highlight", "lede", "overline", "metric", "dropcap",
    ]
    const aligns: WechatBlockAlign[] = ["left", "center", "right"]
    const background = style.background === undefined
      ? undefined
      : colorIn(style.background, "transparent")
    const borderWidth = style.borderWidth === undefined
      ? undefined
      : numberIn(style.borderWidth, 0, 0, 8)
    const requestedPadding = style.padding === undefined
      ? undefined
      : numberIn(style.padding, 0, 0, 48)
    const padding = (borderWidth || (background && hasVisibleFill(background)))
      ? Math.max(12, requestedPadding ?? 0)
      : requestedPadding
    return [[sourceId, {
      variant: variants.includes(style.variant as Exclude<WechatBlockVariant, "image">)
        ? style.variant as Exclude<WechatBlockVariant, "image">
        : undefined,
      background,
      color: style.color === undefined ? undefined : colorIn(style.color, "#262626"),
      accentColor: style.accentColor === undefined ? undefined : colorIn(style.accentColor, "#5263a5"),
      borderColor: style.borderColor === undefined ? undefined : colorIn(style.borderColor, theme.border),
      borderWidth,
      radius: style.radius === undefined ? undefined : numberIn(style.radius, 0, 0, 32),
      padding,
      marginTop: style.marginTop === undefined ? undefined : numberIn(style.marginTop, 0, 0, 80),
      marginBottom: style.marginBottom === undefined ? undefined : numberIn(style.marginBottom, 12, 0, 80),
      fontSize: style.fontSize === undefined ? undefined : numberIn(style.fontSize, 17, 12, 48),
      fontWeight: style.fontWeight === undefined ? undefined : numberIn(style.fontWeight, 400, 300, 900),
      fontStyle: style.fontStyle === "italic" ? "italic" : undefined,
      textDecoration: style.textDecoration === "underline" ? "underline" : undefined,
      letterSpacing: style.letterSpacing === undefined ? undefined : numberIn(style.letterSpacing, 0, 0, 8),
      lineHeight: style.lineHeight === undefined ? undefined : numberIn(style.lineHeight, 1.8, 1, 2.6),
      textIndent: style.textIndent === undefined ? undefined : numberIn(style.textIndent, 0, 0, 64),
      marks: style.marks === undefined ? undefined : parseInlineMarks(style.marks),
      align: aligns.includes(style.align as WechatBlockAlign)
        ? style.align as WechatBlockAlign
        : undefined,
    } satisfies WechatTextStyleOverride]]
  }))
  const background = colorIn(record.background, framed ? theme.surface : "transparent")
  const borderWidth = numberIn(record.borderWidth, 0, 0, 8)
  const surfaceStyle = record.surfaceStyle
    ? parseSurfaceStyle(record.surfaceStyle, background)
    : undefined
  const requestedPadding = numberIn(record.padding, framed ? 24 : 0, 0, 48)
  const padding = framed
    || borderWidth > 0
    || hasVisibleFill(background)
    || Boolean(surfaceStyle && surfaceStyle.kind !== "none")
    ? Math.max(12, requestedPadding)
    : requestedPadding
  return {
    id: idIn(record.id, `section-${index + 1}`),
    frame: ["notebook", "photo", "collage", "letter", "ticket"].includes(String(record.frame))
      ? record.frame as WechatSectionBlock["frame"] : undefined,
    type: "section",
    sourceIds,
    layout: layouts.includes(record.layout as WechatSectionLayout)
      ? record.layout as WechatSectionLayout
      : "stack",
    columnRatio: ["1:1", "1:2", "2:1"].includes(String(record.columnRatio))
      ? record.columnRatio as WechatSectionBlock["columnRatio"]
      : "1:1",
    mediaPosition: record.mediaPosition === "right" ? "right" : "left",
    columns: record.columns === 3 ? 3 : 2,
    preset,
    background,
    color: colorIn(record.color, theme.text),
    accentColor: colorIn(record.accentColor, theme.accent),
    borderColor: colorIn(record.borderColor, theme.border),
    borderWidth,
    radius: numberIn(record.radius, theme.radius, 0, 32),
    padding,
    gap: numberIn(record.gap, 16, 0, 40),
    marginTop: numberIn(record.marginTop, 8, 0, 80),
    marginBottom: numberIn(record.marginBottom, theme.sectionGap, 0, 96),
    divider: record.divider !== false,
    accentStyle: ["none", "top", "left", "bottom", "tri-color"].includes(String(record.accentStyle))
      ? record.accentStyle as WechatSectionAccent
      : defaultAccent,
    shadow: record.shadow === "soft" ? "soft" : "none",
    surfaceStyle,
    leadSourceId: sourceIds.includes(String(record.leadSourceId)) ? String(record.leadSourceId) : undefined,
    overlineSourceId: sourceIds.includes(String(record.overlineSourceId)) ? String(record.overlineSourceId) : undefined,
    icon: parseSectionIcon(record.icon, theme),
    itemStyles,
  }
}

export function parseWechatBlockDocument(value: unknown): WechatBlockDocument {
  const record = asRecord(value)
  const theme = parseTheme(record.theme)
  const rawBlocks = Array.isArray(record.blocks) ? record.blocks.slice(0, 140) : []
  const blocks = rawBlocks.flatMap((item, index): WechatBlock[] => {
    try {
      const block = asRecord(item)
      if (block.type === "content") return [parseContentBlock(block, index, theme)]
      if (block.type === "decoration") {
        const decoration = parseDecorationBlock(block, index)
        return decoration ? [decoration] : []
      }
      if (block.type === "asset") {
        const asset = parseAssetBlock(block, index)
        return asset ? [asset] : []
      }
      if (block.type === "divider") {
        const divider = parseDividerBlock(block, index, theme)
        return divider ? [divider] : []
      }
      if (block.type === "switcher") {
        const switcher = parseSwitcherBlock(block, index)
        return switcher ? [switcher] : []
      }
      if (block.type === "section") {
        const section = parseSectionBlock(block, index, theme)
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
    sidePadding: numberIn(record.sidePadding, 8, 0, 48),
    background: colorIn(record.background, theme.canvas),
    pageBackground: colorIn(record.pageBackground, theme.canvas),
    font: fontIn(record.font, theme.font),
    theme,
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
    textIndent: 0,
    marks: [],
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

export function createWechatContentBlock(
  source: CanvasSource,
  theme: WechatBlockTheme = DEFAULT_WECHAT_BLOCK_THEME,
): WechatContentBlock {
  const fallback = fallbackStyle(source.kind)
  return {
    id: `block-${source.id}`,
    type: "content",
    sourceId: source.id,
    ...fallback,
    color: theme.text,
    accentColor: theme.accent,
    fontSize: source.kind === "title"
      ? theme.displaySize
      : source.kind === "heading"
        ? theme.headingSize
        : theme.bodySize,
    lineHeight: source.kind === "title" || source.kind === "heading"
      ? fallback.lineHeight
      : theme.bodyLineHeight,
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
    sidePadding: 8,
    background: "#ffffff",
    pageBackground: "#f4f1e8",
    font: "system",
    theme: DEFAULT_WECHAT_BLOCK_THEME,
    blocks: sources.map(source => createWechatContentBlock(source)),
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

export function hydrateWechatBlockDocument(
  value: unknown,
  sources: CanvasSource[],
  name: string,
): WechatBlockDocument {
  const parsed = parseWechatBlockDocument(value)
  const sourceIds = new Set(sources.map(source => source.id))
  const sourceMap = new Map(sources.map(source => [source.id, source]))
  const sourceIndex = new Map(sources.map((source, index) => [source.id, index]))
  const contentCandidates = new Map<string, WechatContentBlock>()
  const sectionCandidates = new Map<string, WechatSectionBlock>()
  const anchoredMaterials = parsed.blocks
    .filter((block): block is WechatDecorationBlock | WechatAssetBlock | WechatDividerBlock | WechatSwitcherBlock => (
      (block.type === "decoration" || block.type === "asset" || block.type === "divider" || block.type === "switcher")
      && sourceIds.has(block.anchorSourceId)
    ))
    .filter((block, index, blocks) => (
      blocks
        .slice(0, index)
        .filter(candidate => candidate.type === block.type)
        .length < (
          block.type === "asset"
            // 固定模板占用最多 3 个素材位，额外空间留给人工快速编排。
            ? 12
            : block.type === "switcher"
              ? 3
              : block.type === "divider"
                ? 10
                : 8
        )
    ))
    .map((block, index) => ({
      ...block,
      id: `${block.type}-${index + 1}`,
    }))

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
    blocks.push(...anchoredMaterials.filter(block => (
      block.anchorSourceId === source.id && block.placement === "before"
    )))

    const section = sectionCandidates.get(source.id)
    if (section) {
      blocks.push(...anchoredMaterials.filter(block => (
        block.placement === "before"
        && block.anchorSourceId !== source.id
        && section.sourceIds.includes(block.anchorSourceId)
      )))
      blocks.push({
        ...section,
        id: `section-${source.id}`,
        sourceIds: [...section.sourceIds],
        itemStyles: Object.fromEntries(Object.entries(section.itemStyles).map(([sourceId, style]) => [
          sourceId,
          {
            ...style,
            marks: validInlineMarks(style.marks || [], sourceMap.get(sourceId)?.text || ""),
          },
        ])),
      })
      const lastSourceId = section.sourceIds[section.sourceIds.length - 1]
      blocks.push(...anchoredMaterials.filter(block => (
        section.sourceIds.includes(block.anchorSourceId)
        && block.placement === "after"
      )).map(block => ({ ...block, anchorSourceId: lastSourceId })))
      sourcePosition += section.sourceIds.length - 1
      continue
    }

    const candidate = contentCandidates.get(source.id)
    const fallback = createWechatContentBlock(source, parsed.theme)
    const semanticVariant = candidate?.variant === "plain" && parsed.theme.publicationStyle !== "scrapbook"
      ? source.kind === "title"
        ? "title"
        : source.kind === "heading"
          ? "banner"
          : source.kind === "quote"
            ? "quote"
            : source.kind === "list"
              ? "card"
              : "plain"
      : candidate?.variant
    blocks.push(candidate ? {
      ...candidate,
      id: `block-${source.id}`,
      sourceId: source.id,
      marks: validInlineMarks(candidate.marks, source.text || ""),
      variant: source.kind === "image"
        ? "image"
        : candidate.variant === "image"
          ? fallback.variant
          : semanticVariant || fallback.variant,
      fontSize: source.kind === "title"
        ? Math.max(parsed.theme.displaySize, candidate.fontSize)
        : source.kind === "heading" && candidate.variant === "plain"
          ? parsed.theme.headingSize
          : Math.min(28, candidate.fontSize),
    } : fallback)

    blocks.push(...anchoredMaterials.filter(block => (
      block.anchorSourceId === source.id && block.placement === "after"
    )))
  }

  return {
    ...parsed,
    name: name || parsed.name,
    blocks,
  }
}
