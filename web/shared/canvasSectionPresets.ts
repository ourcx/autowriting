import type { CanvasSource } from "./canvasArticle.ts"
import type {
  WechatBlockDocument,
  WechatIconName,
  WechatSectionBlock,
  WechatSectionLayout,
  WechatSectionPreset,
  WechatSurfaceKind,
} from "./wechatBlockDsl.ts"

export type CanvasSectionPresetId =
  | "clean-reading"
  | "side-note"
  | "soft-card"
  | "ticket-chapter"
  | "letter-chapter"
  | "numbered-steps"
  | "timeline-story"
  | "two-column"
  | "media-story"
  | "editorial-lead"

export interface CanvasSectionPreset {
  id: CanvasSectionPresetId
  name: string
  description: string
  layout: WechatSectionLayout
  preset: WechatSectionPreset
  frame?: WechatSectionBlock["frame"]
  accentStyle: WechatSectionBlock["accentStyle"]
  surfaceKind: WechatSurfaceKind
  icon?: WechatIconName
}

export const CANVAS_SECTION_PRESETS: CanvasSectionPreset[] = [
  { id: "clean-reading", name: "留白正文", description: "单栏连续阅读", layout: "stack", preset: "plain", accentStyle: "none", surfaceKind: "none" },
  { id: "side-note", name: "侧线章节", description: "左侧强调线", layout: "stack", preset: "soft", accentStyle: "left", surfaceKind: "solid", icon: "book-open" },
  { id: "soft-card", name: "柔色卡片", description: "浅底重点信息", layout: "stack", preset: "soft", accentStyle: "top", surfaceKind: "solid", icon: "lightbulb" },
  { id: "ticket-chapter", name: "票券章节", description: "适合活动流程", layout: "stack", preset: "plain", frame: "ticket", accentStyle: "none", surfaceKind: "none" },
  { id: "letter-chapter", name: "信纸章节", description: "适合人文长文", layout: "stack", preset: "plain", frame: "letter", accentStyle: "none", surfaceKind: "none" },
  { id: "numbered-steps", name: "编号步骤", description: "流程与教程", layout: "steps", preset: "plain", accentStyle: "none", surfaceKind: "none", icon: "check-circle" },
  { id: "timeline-story", name: "时间线", description: "经历与进展", layout: "timeline", preset: "plain", accentStyle: "none", surfaceKind: "none" },
  { id: "two-column", name: "双栏摘要", description: "并列短内容", layout: "two-column", preset: "soft", accentStyle: "top", surfaceKind: "solid" },
  { id: "media-story", name: "图文故事", description: "图片搭配短文", layout: "media-text", preset: "soft", accentStyle: "none", surfaceKind: "solid" },
  { id: "editorial-lead", name: "杂志导语", description: "大字视觉锚点", layout: "editorial", preset: "editorial", accentStyle: "bottom", surfaceKind: "none", icon: "quote" },
]

function surfaceStyle(kind: WechatSurfaceKind, document: WechatBlockDocument) {
  if (kind === "none") return undefined
  return {
    kind,
    colors: [document.theme.surfaceAlt],
    patternColor: document.theme.border,
    angle: 135,
    size: 22,
    opacity: 0.1,
    prompt: "",
    imageSize: "landscape_16_9" as const,
    fit: "cover" as const,
    overlayColor: document.theme.canvas,
    overlayOpacity: 0.12,
  }
}

export function applyCanvasSectionPreset(
  document: WechatBlockDocument,
  selectedId: string,
  presetId: CanvasSectionPresetId,
  sources: CanvasSource[],
): WechatBlockDocument {
  const sectionId = selectedId.split("::")[0]
  const preset = CANVAS_SECTION_PRESETS.find(item => item.id === presetId)
  if (!preset) return document
  const sourceMap = new Map(sources.map(source => [source.id, source]))
  return {
    ...document,
    blocks: document.blocks.map(block => {
      if (block.id !== sectionId || block.type !== "section") return block
      const sectionSources = block.sourceIds.flatMap(sourceId => {
        const source = sourceMap.get(sourceId)
        return source ? [source] : []
      })
      const hasImage = sectionSources.some(source => source.kind === "image")
      const layout = preset.layout === "media-text" && !hasImage ? "feature" : preset.layout
      const surfaced = preset.surfaceKind !== "none"
      return {
        ...block,
        layout,
        preset: preset.preset,
        frame: preset.frame,
        background: surfaced ? document.theme.surfaceAlt : "transparent",
        surfaceStyle: surfaceStyle(preset.surfaceKind, document),
        accentStyle: preset.accentStyle,
        accentColor: document.theme.primary,
        borderColor: document.theme.border,
        borderWidth: 0,
        radius: surfaced ? document.theme.radius : 0,
        padding: surfaced || layout !== "stack" ? 18 : 0,
        divider: preset.id === "numbered-steps" || preset.id === "timeline-story",
        shadow: preset.id === "soft-card" ? "soft" : "none",
        icon: preset.icon ? {
          kind: "lucide",
          name: preset.icon,
          color: document.theme.primary,
          size: 22,
          position: "top-left",
        } : undefined,
      }
    }),
  }
}
