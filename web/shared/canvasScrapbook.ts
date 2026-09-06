import type { CanvasSource } from "./canvasArticle.ts"
import type { WechatBlockDocument } from "./wechatBlockDsl.ts"

// 纸笺是整篇设计策略：只给完整章节加纸张，段落本身仍是连续、可编辑的正文。
export function applyScrapbookDesign(document: WechatBlockDocument, sources: CanvasSource[]): WechatBlockDocument {
  const sourceMap = new Map(sources.map(source => [source.id, source]))
  let chapter = 0
  return {
    ...document,
    sidePadding: 18,
    blocks: document.blocks.map(block => {
      if (block.type === "content") {
        const source = sourceMap.get(block.sourceId)
        return {
          ...block,
          variant: source?.kind === "title" ? "title" : source?.kind === "image" ? "image" : "plain",
          color: source?.kind === "title" || source?.kind === "heading" ? document.theme.primary : document.theme.text,
          align: source?.kind === "title" ? "center" : block.align,
          imageFit: "contain",
          imageRadius: 0,
        }
      }
      if (block.type !== "section") return block
      const group = block.sourceIds.flatMap(id => sourceMap.get(id) || [])
      const hasHeading = group.some(source => source.kind === "heading")
      const allImages = group.every(source => source.kind === "image")
      const frame = allImages ? group.length > 1 ? "collage" : "photo" : hasHeading ? "notebook" : undefined
      const color = chapter++ % 2 === 0 ? document.theme.primary : document.theme.secondary
      return {
        ...block, frame, layout: "stack", background: "transparent", surfaceStyle: undefined,
        borderWidth: 0, padding: 0, accentStyle: "none", icon: undefined, shadow: "none",
        overlineSourceId: undefined,
        itemStyles: Object.fromEntries(group.map(source => [source.id, {
          ...block.itemStyles[source.id],
          marks: block.itemStyles[source.id]?.marks || [],
          variant: "plain", color: source.kind === "heading" ? color : document.theme.text,
          background: source.kind === "heading" ? chapter % 2 ? "#fff0f4" : "#eaf6fb" : "transparent",
          borderColor: document.theme.border, borderWidth: source.kind === "heading" ? 1 : 0,
          radius: source.kind === "heading" ? 28 : 0, padding: source.kind === "heading" ? 12 : 0,
          fontSize: source.kind === "heading" ? document.theme.headingSize : document.theme.bodySize,
          fontWeight: source.kind === "heading" ? 700 : document.theme.bodyWeight,
          lineHeight: source.kind === "heading" ? 1.6 : document.theme.bodyLineHeight,
          align: source.kind === "heading" ? "center" : "left", marginBottom: 24,
        }])),
      }
    }),
  }
}
