import assert from "node:assert/strict"
import type { CanvasSource } from "../shared/canvasArticle.ts"
import {
  assessCanvasVisualQuality,
  finalizeCanvasDesign,
  normalizeCanvasPrimaryColor,
} from "../shared/canvasDesignSystem.ts"
import {
  CANVAS_DESIGN_TEMPLATES,
  getCanvasDesignTemplate,
  type CanvasDesignTemplateId,
} from "../shared/canvasDesignTemplates.ts"
import { createWechatBlockDocument, hydrateWechatBlockDocument, parseWechatBlockDocument } from "../shared/wechatBlockDsl.ts"

const sources: CanvasSource[] = [
  { id: "source-0", kind: "title", text: "一万米高空的逻辑死局" },
  { id: "source-1", kind: "paragraph", text: "事故发生在风暴边缘，所有系统看似仍在正常工作。" },
  { id: "source-2", kind: "paragraph", text: "真正危险的是信息突然失去一致性，驾驶舱开始出现认知分裂。" },
  { id: "source-3", kind: "heading", text: "风暴夹缝中的航程" },
  { id: "source-4", kind: "paragraph", text: "机组沿既定航路进入雷暴活跃区域，外部环境快速恶化。" },
  { id: "source-5", kind: "paragraph", text: "皮托管短暂结冰，三套空速数据先后出现冲突。" },
  { id: "source-6", kind: "paragraph", text: "自动驾驶断开后，控制权重新回到飞行员手中。" },
  { id: "source-7", kind: "heading", text: "四分钟里的逻辑断裂" },
  { id: "source-8", kind: "quote", text: "我来控制。" },
  { id: "source-9", kind: "paragraph", text: "错误动作与错误反馈互相强化，留给机组的判断窗口越来越小。" },
  { id: "source-10", kind: "image", src: "/uploads/canvas-quality-fixture.png", alt: "驾驶舱示意" },
  { id: "source-11", kind: "paragraph", text: "示意图用于解释两侧操纵输入无法被另一侧直接感知。" },
  { id: "source-12", kind: "paragraph", text: "技术故障最终演变为训练、协作与人机界面的共同失败。" },
]

const expectedSignatures: Record<CanvasDesignTemplateId, {
  primary: string
  font: string
  layouts: string[]
  icons: string[]
}> = {
  "scrapbook-letter": { primary: "#b63f68", font: "system", layouts: ["stack", "stack", "stack", "stack"], icons: [] },
  "editorial-story": {
    primary: "#a84632",
    font: "editorial",
    layouts: ["stack", "stack", "stack", "stack"],
    icons: [],
  },
  "interview-notes": {
    primary: "#c56f4f",
    font: "friendly",
    layouts: ["feature", "stack", "two-column", "media-text"],
    icons: ["mic", "mic"],
  },
  "weekly-dashboard": {
    primary: "#5263a5",
    font: "system",
    layouts: ["comparison", "comparison", "grid", "media-text"],
    icons: ["bar-chart", "bar-chart", "trending-up"],
  },
  "design-reference": {
    primary: "#2f6f62",
    font: "system",
    layouts: ["editorial", "editorial", "stack", "media-text"],
    icons: ["sparkles", "book-open"],
  },
}

for (const template of CANVAS_DESIGN_TEMPLATES) {
  const initial = createWechatBlockDocument("视觉质量夹具", sources)
  const flatReport = assessCanvasVisualQuality(initial, sources)
  assert.equal(flatReport.passed, false, `${template.id} 的平铺文档必须被质量门禁拒绝`)

  const result = finalizeCanvasDesign(initial, sources, template.id)
  assert.equal(result.report.passed, true, `${template.id} 应通过确定性设计质量门禁`)
  assert.deepEqual(result.report.issues, [])

  const sourceIds = result.document.blocks.flatMap(block => {
    if (block.type === "content") return [block.sourceId]
    if (block.type === "section") return block.sourceIds
    return []
  })
  assert.deepEqual(sourceIds, sources.map(source => source.id), `${template.id} 必须保持内容源顺序`)
  assert.equal(new Set(sourceIds).size, sources.length, `${template.id} 不得重复内容源`)

  for (const block of result.document.blocks) {
    if (block.type === "content" || block.type === "section") {
      assert.equal(block.borderWidth, 0, `${template.id} 不得生成完整边框`)
      assert.equal(block.accentColor, result.document.theme.primary, `${template.id} 必须统一主色`)
    }
    if (block.type === "section") {
      for (const style of Object.values(block.itemStyles)) {
        assert.ok(Array.isArray(style.marks), `${template.id} 的 Section 局部样式必须补齐 marks`)
      }
    }
  }

  const signature = {
    primary: result.document.theme.primary,
    font: result.document.theme.font,
    layouts: result.document.blocks.flatMap(block => block.type === "section" ? [block.layout] : []),
    icons: result.document.blocks.flatMap(block => (
      block.type === "section" && block.icon?.name ? [block.icon.name] : []
    )),
  }
  assert.deepEqual(signature, expectedSignatures[template.id], `${template.id} 的视觉签名发生变化`)

  if (!template.designSystem.inheritModelTheme) {
    assert.equal(
      result.document.theme.primary,
      getCanvasDesignTemplate(template.id).designSystem.theme.primary,
      `${template.id} 必须应用模板 Token`,
    )
  }
}

const groupedTitleFixture = finalizeCanvasDesign(
  createWechatBlockDocument("分组标题夹具", sources),
  sources,
  "editorial-story",
).document
const groupedTitleSection = groupedTitleFixture.blocks.find(block => block.type === "section")
assert.ok(groupedTitleSection)
groupedTitleSection.sourceIds.unshift(sources[0].id)
groupedTitleFixture.blocks = groupedTitleFixture.blocks.filter(block => (
  block.type !== "content" || block.sourceId !== sources[0].id
))
const regroupedTitle = finalizeCanvasDesign(groupedTitleFixture, sources, "editorial-story").document
assert.equal(regroupedTitle.blocks[0]?.type, "content", "标题必须从 AI section 中拆出")
if (regroupedTitle.blocks[0]?.type === "content") {
  assert.equal(regroupedTitle.blocks[0].sourceId, sources[0].id, "标题必须保持文章首位")
  assert.equal(regroupedTitle.blocks[0].variant, "title", "标题必须使用独立标题样式")
}

const longProseSources: CanvasSource[] = [
  { id: "long-title", kind: "title", text: "长篇叙事" },
  ...Array.from({ length: 12 }, (_, index): CanvasSource => ({
    id: `long-${index}`,
    kind: "paragraph",
    text: `第 ${index + 1} 段：${"这是一段需要保持单列阅读宽度的长正文。".repeat(16)}`,
  })),
]
const longProseResult = finalizeCanvasDesign(
  createWechatBlockDocument("长正文安全布局夹具", longProseSources),
  longProseSources,
  "editorial-story",
)
assert.equal(longProseResult.report.passed, true, "长正文安全退回单列时不应被误判为低质量")
assert.equal(longProseResult.report.metrics.layoutOpportunityCount, 0)

const imageRichSources: CanvasSource[] = [
  { id: "gallery-title", kind: "title", text: "影像周记" },
  ...Array.from({ length: 7 }, (_, index): CanvasSource => ({
    id: `gallery-${index}`,
    kind: "image",
    src: `/uploads/gallery-${index}.png`,
    alt: `影像 ${index + 1}`,
  })),
]
const imageRichResult = finalizeCanvasDesign(
  createWechatBlockDocument("多图安全布局夹具", imageRichSources),
  imageRichSources,
  "editorial-story",
)
assert.equal(imageRichResult.report.passed, true, "连续图片必须形成安全画廊并通过质量门禁")
assert.ok(imageRichResult.report.metrics.mediaSectionCount >= 2)
assert.ok(imageRichResult.document.blocks.some(block => block.type === "section" && block.layout === "grid"))

const preservationFixture = finalizeCanvasDesign(
  createWechatBlockDocument("归一化夹具", sources),
  sources,
  "editorial-story",
).document
const preservationSection = preservationFixture.blocks.find(block => block.type === "section")
assert.ok(preservationSection)
preservationSection.background = "#abcdef"
preservationSection.shadow = "soft"
preservationSection.padding = 31
preservationSection.borderWidth = 3
preservationSection.accentColor = "#ff00ff"
preservationSection.itemStyles[preservationSection.sourceIds[0]] = {
  fontSize: 27,
  background: "#fedcba",
  borderWidth: 4,
  accentColor: "#00ff00",
}
const normalized = normalizeCanvasPrimaryColor(preservationFixture)
const normalizedSection = normalized.blocks.find(block => block.type === "section")
assert.ok(normalizedSection)
assert.equal(normalizedSection.background, "#abcdef", "归一化不得清除背景")
assert.equal(normalizedSection.shadow, "soft", "归一化不得清除阴影")
assert.equal(normalizedSection.padding, 31, "归一化不得改写间距")
assert.equal(normalizedSection.borderWidth, 0, "归一化必须清除完整边框")
assert.equal(normalizedSection.accentColor, normalized.theme.primary, "归一化必须统一主色")
assert.equal(normalizedSection.itemStyles[normalizedSection.sourceIds[0]]?.fontSize, 27, "归一化不得改写字号")
assert.equal(normalizedSection.itemStyles[normalizedSection.sourceIds[0]]?.background, "#fedcba", "归一化不得清除局部背景")
assert.equal(normalizedSection.itemStyles[normalizedSection.sourceIds[0]]?.borderWidth, 0, "归一化必须清除局部边框")
assert.equal(normalized.theme.secondary, normalized.theme.primary)
assert.equal(normalized.theme.accent, normalized.theme.primary)

process.stdout.write(`canvas design quality: ${CANVAS_DESIGN_TEMPLATES.length} templates passed\n`)

// 阅读模板的验收关注正文宽度和语义层级，不能退回短正文双栏或小于正文的章节标题。
const readingDocument = finalizeCanvasDesign(createWechatBlockDocument("阅读夹具", sources), sources, "editorial-story").document
for (const section of readingDocument.blocks.filter(block => block.type === "section")) {
  assert.equal(section.layout, "stack", "知识长文中的正文和单图必须上下排列")
  for (const sourceId of section.sourceIds) {
    if (sources.find(source => source.id === sourceId)?.kind === "heading") {
      assert.ok((section.itemStyles[sourceId]?.fontSize || 0) >= readingDocument.theme.bodySize + 3, "章节标题必须大于正文")
    }
  }
}
assert.ok(readingDocument.theme.displaySize <= 32, "手机标题不能使用海报字号")
const shortProse = longProseSources.map(source => ({ ...source, text: source.text?.slice(0, 55) }))
assert.equal(finalizeCanvasDesign(createWechatBlockDocument("短段落", shortProse), shortProse, "editorial-story").report.passed, true, "无小标题的短段落长文也应能单栏成稿")
const marked = readingDocument.blocks.find(block => block.type === "section")
assert.ok(marked)
marked.itemStyles[marked.sourceIds[0]] = { marks: [{ match: "事故", occurrence: 1, color: readingDocument.theme.primary, background: "transparent", fontWeight: 700, textDecoration: "none" }] }
const remark = finalizeCanvasDesign(readingDocument, sources, "editorial-story").document
const remarkSection = remark.blocks.find(block => block.type === "section" && block.sourceIds.includes(marked.sourceIds[0]))
assert.ok(remarkSection && remarkSection.type === "section")
assert.deepEqual(remarkSection.itemStyles[marked.sourceIds[0]].marks, marked.itemStyles[marked.sourceIds[0]].marks, "切换模板不得抹掉 AI 或用户选择的重点文字")

// 去掉引用框后仍须保留内容；导语、章节与引用不能通过边框或底色模拟 Markdown 样式。
for (const block of readingDocument.blocks) {
  if (block.type !== "section") continue
  assert.equal(block.accentStyle, "none", "默认文章不应有章节或导语竖线")
  assert.equal(block.background, "transparent", "默认正文和导语应沿用纸面底色")
  for (const sourceId of block.sourceIds) {
    const source = sources.find(item => item.id === sourceId)
    if (source?.kind === "heading" || source?.kind === "quote") {
      assert.equal(block.itemStyles[sourceId].variant, "plain", "章节和引用不得使用自动描边变体")
    }
    if (source?.kind === "quote") {
      assert.equal(block.itemStyles[sourceId].background, "transparent")
      assert.equal(block.itemStyles[sourceId].padding, 0)
    }
  }
}

// 主题扩展经过与真实保存、生成相同的解析链路，必须保持内容覆盖及素材白名单。
const scrapbook = finalizeCanvasDesign(createWechatBlockDocument("纸笺", sources), sources, "scrapbook-letter").document
const savedScrapbook = hydrateWechatBlockDocument(JSON.parse(JSON.stringify(scrapbook)), sources)
assert.equal(savedScrapbook.theme.publicationStyle, "scrapbook")
assert.equal(normalizeCanvasPrimaryColor(savedScrapbook).theme.secondary, "#387699")
assert.ok(savedScrapbook.blocks.some(block => block.type === "section" && block.frame === "notebook"))
assert.equal(assessCanvasVisualQuality(savedScrapbook, sources).passed, true)
const materialFixture = parseWechatBlockDocument({ ...scrapbook, blocks: [
  { type: "asset", materialId: "watercolor-clip", anchorSourceId: "source-0" },
  { type: "asset", materialId: "https://example.com/untrusted.png", anchorSourceId: "source-0" },
] })
assert.equal(materialFixture.blocks.length, 1, "不接受任意 URL 伪装成本地素材")
assert.equal(materialFixture.blocks[0].type, "asset")
assert.equal(hydrateWechatBlockDocument({ ...scrapbook, blocks: [...scrapbook.blocks, ...materialFixture.blocks] }, sources).blocks.filter(block => block.type === "asset").length, 1)

const libraryFixture = parseWechatBlockDocument({ ...scrapbook, blocks: [
  { type: "asset", libraryImage: { url: "https://example.com/photo.jpg", title: "教室" }, anchorSourceId: "source-0" },
  { type: "asset", libraryImage: { url: "javascript:alert(1)" }, anchorSourceId: "source-0" },
  { type: "asset", libraryImage: { url: "/api/images/uploads/../../secrets.png" }, anchorSourceId: "source-0" },
] })
assert.equal(libraryFixture.blocks.length, 1, "图库照片拒绝脚本协议及本地路径逃逸")
assert.equal(libraryFixture.blocks[0].type === "asset" && libraryFixture.blocks[0].libraryImage?.title, "教室")
