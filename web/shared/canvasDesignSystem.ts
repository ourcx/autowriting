import type { CanvasSource } from "./canvasArticle.ts"
import {
  getCanvasDesignTemplate,
  type CanvasDesignSectionRecipe,
  type CanvasDesignTemplateId,
  type CanvasDesignTheme,
} from "./canvasDesignTemplates.ts"
import {
  createWechatContentBlock,
  type WechatBlock,
  type WechatBlockDocument,
  type WechatBlockTheme,
  type WechatContentBlock,
  type WechatInlineMark,
  type WechatSectionBlock,
  type WechatSurfaceStyle,
  type WechatTextStyleOverride,
} from "./wechatBlockDsl.ts"

export interface CanvasVisualQualityMetrics {
  sectionCount: number
  standaloneContentCount: number
  composableGroupCount: number
  layoutCount: number
  layoutOpportunityCount: number
  surfaceCount: number
  accentCount: number
  iconCount: number
  mediaSectionCount: number
  materialCount: number
  typographyRoleCount: number
}

export interface CanvasVisualQualityReport {
  score: number
  passed: boolean
  issues: string[]
  metrics: CanvasVisualQualityMetrics
}

export interface CanvasDesignFinalization {
  document: WechatBlockDocument
  report: CanvasVisualQualityReport
  rebuilt: boolean
}

type AnchoredMaterial = Extract<WechatBlock, { type: "asset" | "decoration" | "divider" | "switcher" }>

export function normalizeCanvasPrimaryColor(
  document: WechatBlockDocument,
): WechatBlockDocument {
  const primary = document.theme.primary
  const normalizeMarks = (marks: WechatInlineMark[] | undefined): WechatInlineMark[] | undefined => (
    marks?.map(mark => ({ ...mark, color: primary }))
  )
  const blocks = document.blocks.map(block => {
    if (block.type === "content") {
      return {
        ...block,
        accentColor: primary,
        borderWidth: 0,
        marks: normalizeMarks(block.marks) || [],
      }
    }
    if (block.type === "section") {
      return {
        ...block,
        accentColor: primary,
        borderWidth: 0,
        icon: block.icon ? { ...block.icon, color: primary } : undefined,
        itemStyles: Object.fromEntries(Object.entries(block.itemStyles).map(([sourceId, style]) => [
          sourceId,
          {
            ...style,
            accentColor: style.accentColor === undefined ? undefined : primary,
            borderWidth: 0,
            marks: normalizeMarks(style.marks),
          },
        ])),
      }
    }
    if (block.type === "decoration") {
      return {
        ...block,
        fill: block.fill !== "transparent" && block.fill !== "rgba(0, 0, 0, 0)"
          ? primary
          : "transparent",
        stroke: primary,
      }
    }
    if (block.type === "divider") {
      return { ...block, color: primary, secondaryColor: primary }
    }
    return block
  })
  return {
    ...document,
    theme: {
      ...document.theme,
      secondary: primary,
      accent: primary,
    },
    blocks,
  }
}

function surfaceStyle(
  recipe: CanvasDesignSectionRecipe,
  theme: WechatBlockTheme,
): WechatSurfaceStyle | undefined {
  if (recipe.surfaceKind === "none") return undefined
  const colors = recipe.surfaceKind === "linear" || recipe.surfaceKind === "stripes"
    ? [theme.surface, theme.surfaceAlt]
    : [recipe.surface === "surface" ? theme.surface : theme.surfaceAlt]
  return {
    kind: recipe.surfaceKind,
    colors,
    patternColor: theme.border,
    angle: 135,
    size: 22,
    opacity: 0.1,
    prompt: "",
    imageSize: "landscape_16_9",
    fit: "cover",
    overlayColor: theme.canvas,
    overlayOpacity: 0.12,
  }
}

function themeFromDesignSystem(
  designTheme: CanvasDesignTheme,
  modelTheme: WechatBlockTheme,
  inheritModelTheme: boolean,
): WechatBlockTheme {
  const source = inheritModelTheme ? modelTheme : designTheme
  const primary = source.primary || designTheme.primary
  const canvasStyle = inheritModelTheme
    ? modelTheme.canvasStyle
    : {
        ...modelTheme.canvasStyle,
        ...designTheme.canvasStyle,
        prompt: "",
        imageSize: "landscape_16_9" as const,
        fit: "cover" as const,
        overlayColor: designTheme.canvas,
        overlayOpacity: 0.12,
      }
  return {
    ...modelTheme,
    ...source,
    primary,
    secondary: primary,
    accent: primary,
    canvasStyle,
  }
}

function sourceTextLength(source: CanvasSource): number {
  return source.kind === "image" ? 0 : (source.text || "").length
}

function isCompactGroup(sources: CanvasSource[]): boolean {
  const prose = sources.filter(source => source.kind === "paragraph" || source.kind === "list")
  return prose.length <= 3 && prose.every(source => sourceTextLength(source) <= 180)
}

function isNumericSource(source: CanvasSource): boolean {
  if (source.kind === "image" || !source.text) return false
  const digits = source.text.match(/[0-9%万亿千百]/g)?.length || 0
  return digits >= 2 && source.text.length <= 100
}

function semanticSourceGroups(sources: CanvasSource[]): CanvasSource[][] {
  const groups: CanvasSource[][] = []
  let pending: CanvasSource[] = []
  const flush = () => {
    if (pending.length > 0) groups.push(pending)
    pending = []
  }

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]
    if (source.kind === "title") {
      flush()
      groups.push([source])
      continue
    }
    if (source.kind === "heading") flush()
    if (source.kind === "image") {
      flush()
      const imageGroup = [source]
      while (imageGroup.length < 3 && sources[index + 1]?.kind === "image") {
        imageGroup.push(sources[index + 1])
        index += 1
      }
      const next = sources[index + 1]
      if (
        imageGroup.length === 1
        && next
        && next.kind !== "title"
        && next.kind !== "heading"
        && next.kind !== "image"
      ) {
        groups.push([source, next])
        index += 1
      } else {
        groups.push(imageGroup)
      }
      continue
    }
    pending.push(source)
    if (pending.length >= 4) flush()
  }
  flush()
  return groups
}

function documentSourceGroups(
  document: WechatBlockDocument,
  sourceById: Map<string, CanvasSource>,
): CanvasSource[][] {
  const groups: CanvasSource[][] = []
  let pending: CanvasSource[] = []
  const flush = () => {
    if (pending.length > 0) groups.push(pending)
    pending = []
  }
  for (const block of document.blocks) {
    if (block.type === "section") {
      flush()
      const sources = block.sourceIds.flatMap(sourceId => {
        const source = sourceById.get(sourceId)
        return source ? [source] : []
      })
      let sectionSources: CanvasSource[] = []
      const flushSection = () => {
        if (sectionSources.length > 0) groups.push(sectionSources)
        sectionSources = []
      }
      for (const source of sources) {
        if (source.kind === "title") {
          flushSection()
          groups.push([source])
        } else {
          sectionSources.push(source)
        }
      }
      flushSection()
      continue
    }
    if (block.type !== "content") continue
    const source = sourceById.get(block.sourceId)
    if (!source) continue
    if (source.kind === "title") {
      flush()
      groups.push([source])
      continue
    }
    if (source.kind === "heading" && pending.length > 0) flush()
    pending.push(source)
    if (pending.length >= 4) flush()
  }
  flush()
  return groups
}

function safeLayout(
  recipe: CanvasDesignSectionRecipe,
  sources: CanvasSource[],
): CanvasDesignSectionRecipe["layout"] {
  if (recipe.layout === "media-text") {
    if (sources.filter(source => source.kind === "image").length >= 2) return "grid"
    return sources[0]?.kind === "image" && sources.length >= 2 ? recipe.layout : "stack"
  }
  if (["two-column", "comparison", "feature", "editorial", "grid"].includes(recipe.layout)) {
    return isCompactGroup(sources) ? recipe.layout : "stack"
  }
  if ((recipe.layout === "timeline" || recipe.layout === "steps") && sources.length < 3) {
    return "stack"
  }
  return recipe.layout
}

function recipeForGroup(
  templateId: CanvasDesignTemplateId,
  group: CanvasSource[],
  sectionIndex: number,
): CanvasDesignSectionRecipe {
  const system = getCanvasDesignTemplate(templateId).designSystem
  if (group[0]?.kind === "image") return system.media
  if (sectionIndex === 0) return system.intro
  return system.bodyCycle[(sectionIndex - 1) % system.bodyCycle.length]
}

function itemStylesForGroup(
  sources: CanvasSource[],
  theme: WechatBlockTheme,
  templateId: CanvasDesignTemplateId,
  isIntro: boolean,
): Record<string, WechatTextStyleOverride> {
  const styles: Record<string, WechatTextStyleOverride> = {}
  const system = getCanvasDesignTemplate(templateId).designSystem
  for (const [index, source] of sources.entries()) {
    if (source.kind === "heading") {
      // 章节标题必须大于正文，眉题样式仅保留给其他模板，避免长文层级倒置。
      if (templateId === "editorial-story") {
        styles[source.id] = {
          variant: "plain", color: theme.text, fontSize: theme.headingSize,
          fontWeight: theme.headingWeight, lineHeight: theme.headingLineHeight,
          padding: 0, marginTop: 12, marginBottom: 20,
        }
        continue
      }
      styles[source.id] = {
        variant: "overline",
        color: theme.primary,
        fontSize: Math.min(13, theme.bodySize),
        fontWeight: theme.headingWeight,
        letterSpacing: 1.2,
        marginBottom: 12,
      }
      continue
    }
    if (source.kind === "quote") {
      styles[source.id] = {
        variant: "quote",
        color: theme.text,
        accentColor: theme.primary,
        fontSize: Math.min(22, theme.bodySize + 2),
        fontWeight: 500,
        ...(templateId === "editorial-story" ? {
          // 保留引用的内容语义，但不渲染引用框；短句通过居中与留白形成停顿。
          variant: "plain", background: "transparent", padding: 0,
          fontSize: theme.bodySize + 1, fontWeight: 600,
          align: sourceTextLength(source) <= 50 ? "center" : "left",
          marginTop: 28, marginBottom: 28, lineHeight: theme.bodyLineHeight,
        } : {}),
      }
      continue
    }
    if (templateId === "weekly-dashboard" && isNumericSource(source)) {
      styles[source.id] = {
        variant: "metric",
        color: theme.primary,
        fontSize: Math.min(26, theme.bodySize + 6),
        fontWeight: 750,
      }
      continue
    }
    if (isIntro && index === 0 && source.kind === "paragraph") {
      styles[source.id] = {
        variant: "lede",
        fontSize: templateId === "editorial-story" && sourceTextLength(source) > 80
          ? theme.bodySize
          : Math.min(22, theme.bodySize + 2),
        lineHeight: theme.bodyLineHeight,
      }
      continue
    }
    if (source.kind === "paragraph" && system.bodyTextIndent > 0) {
      styles[source.id] = { textIndent: system.bodyTextIndent }
    }
  }
  return Object.fromEntries(Object.entries(styles).map(([sourceId, style]) => [
    sourceId,
    { ...style, marks: style.marks || [] },
  ]))
}

function styleTitle(
  source: CanvasSource,
  theme: WechatBlockTheme,
  templateId: CanvasDesignTemplateId,
): WechatContentBlock {
  const system = getCanvasDesignTemplate(templateId).designSystem
  return {
    ...createWechatContentBlock(source, theme),
    variant: "title",
    background: "transparent",
    color: theme.text,
    accentColor: theme.primary,
    borderColor: theme.border,
    borderWidth: 0,
    radius: 0,
    padding: 0,
    marginTop: 0,
    marginBottom: Math.max(28, theme.sectionGap),
    fontSize: theme.displaySize,
    fontWeight: theme.displayWeight,
    lineHeight: theme.displayLineHeight,
    align: system.titleAlign,
  }
}

function styleStandaloneContent(
  source: CanvasSource,
  theme: WechatBlockTheme,
  templateId: CanvasDesignTemplateId,
): WechatContentBlock {
  if (source.kind === "title") return styleTitle(source, theme, templateId)
  const system = getCanvasDesignTemplate(templateId).designSystem
  const block = createWechatContentBlock(source, theme)
  return {
    ...block,
    color: theme.text,
    accentColor: theme.primary,
    borderColor: theme.border,
    borderWidth: 0,
    ...(templateId === "editorial-story" ? {
      variant: source.kind === "image" ? block.variant : "plain" as const,
      background: "transparent",
      padding: 0,
      ...(source.kind === "quote" ? {
        fontWeight: 600, align: sourceTextLength(source) <= 50 ? "center" as const : "left" as const,
        marginTop: 28, marginBottom: 28,
      } : {}),
      fontSize: source.kind === "heading" ? theme.headingSize : theme.bodySize,
      lineHeight: source.kind === "heading" ? theme.headingLineHeight : theme.bodyLineHeight,
    } : {}),
    textIndent: source.kind === "paragraph" ? system.bodyTextIndent : block.textIndent,
  }
}

function createSection(
  sources: CanvasSource[],
  recipe: CanvasDesignSectionRecipe,
  theme: WechatBlockTheme,
  templateId: CanvasDesignTemplateId,
  sectionIndex: number,
): WechatSectionBlock {
  const background = recipe.surface === "surface"
    ? theme.surface
    : recipe.surface === "surfaceAlt"
      ? theme.surfaceAlt
      : "transparent"
  // 叙事文章的图文上下排列，只有连续图片可以形成画廊。
  const readingMedia = templateId === "editorial-story" && sources[0]?.kind === "image"
  const layout = readingMedia
    ? sources.every(source => source.kind === "image") && sources.length > 1 ? "grid" : "stack"
    : safeLayout(recipe, sources)
  const plainMedia = readingMedia && layout === "stack"
  const surfaced = background !== "transparent" || recipe.surfaceKind !== "none"
  return {
    id: `design-section-${sources[0].id}`,
    type: "section",
    sourceIds: sources.map(source => source.id),
    layout,
    columnRatio: recipe.columnRatio,
    mediaPosition: sectionIndex % 2 === 0 ? "left" : "right",
    columns: 2,
    preset: surfaced ? recipe.preset : "plain",
    background: plainMedia ? "transparent" : background,
    color: theme.text,
    accentColor: theme.primary,
    borderColor: theme.border,
    borderWidth: 0,
    radius: surfaced ? theme.radius : 0,
    padding: plainMedia ? 0 : surfaced || layout !== "stack" ? 18 : 0,
    gap: 16,
    marginTop: 8,
    marginBottom: theme.sectionGap,
    divider: recipe.divider,
    accentStyle: recipe.accentStyle,
    shadow: recipe.shadow,
    surfaceStyle: plainMedia ? undefined : surfaceStyle(recipe, theme),
    leadSourceId: sectionIndex === 0
      ? sources.find(source => source.kind === "paragraph")?.id
      : undefined,
    overlineSourceId: sources.find(source => source.kind === "heading")?.id,
    icon: recipe.icon ? {
      kind: "lucide",
      name: recipe.icon,
      color: theme.primary,
      size: 22,
      position: "top-left",
    } : undefined,
    itemStyles: itemStylesForGroup(sources, theme, templateId, sectionIndex === 0),
  }
}

function anchoredMaterials(document: WechatBlockDocument): AnchoredMaterial[] {
  return document.blocks.filter((block): block is AnchoredMaterial => (
    block.type === "asset"
    || block.type === "decoration"
    || block.type === "divider"
    || block.type === "switcher"
  ))
}

function materialsForGroup(
  materials: AnchoredMaterial[],
  sourceIds: Set<string>,
  placement: "before" | "after",
): AnchoredMaterial[] {
  return materials.filter(material => (
    material.placement === placement && sourceIds.has(material.anchorSourceId)
  ))
}

export function compileCanvasDesignSystem(
  document: WechatBlockDocument,
  sources: CanvasSource[],
  templateId: CanvasDesignTemplateId,
  options: { forceRecipes?: boolean } = {},
): WechatBlockDocument {
  const template = getCanvasDesignTemplate(templateId)
  const system = template.designSystem
  const theme = themeFromDesignSystem(system.theme, document.theme, system.inheritModelTheme)
  const sourceById = new Map(sources.map(source => [source.id, source]))
  const existingSections = document.blocks.filter(block => block.type === "section")
  const useExistingGroups = !options.forceRecipes && existingSections.length >= 2
  const groups = useExistingGroups
    ? documentSourceGroups(document, sourceById)
    : semanticSourceGroups(sources)
  const materials = anchoredMaterials(document)
  const blocks: WechatBlock[] = []
  let sectionIndex = 0

  for (const group of groups) {
    if (group.length === 0) continue
    const sourceIds = new Set(group.map(source => source.id))
    blocks.push(...materialsForGroup(materials, sourceIds, "before"))
    if (group.length === 1) {
      blocks.push(styleStandaloneContent(group[0], theme, templateId))
    } else {
      const recipe = recipeForGroup(templateId, group, sectionIndex)
      blocks.push(createSection(group, recipe, theme, templateId, sectionIndex))
      sectionIndex += 1
    }
    blocks.push(...materialsForGroup(materials, sourceIds, "after"))
  }

  const sourceMarks = new Map<string, WechatInlineMark[]>()
  for (const block of document.blocks) {
    if (block.type === "content" && block.marks.length) sourceMarks.set(block.sourceId, block.marks)
    if (block.type === "section") {
      for (const [sourceId, style] of Object.entries(block.itemStyles)) {
        if (style.marks?.length) sourceMarks.set(sourceId, style.marks)
      }
    }
  }
  // AI 挑出的强调文字属于内容语义；重新套模板只换布局，不丢失已经选择的重点。
  for (const block of blocks) {
    if (block.type === "content") block.marks = sourceMarks.get(block.sourceId) || block.marks
    if (block.type === "section") {
      for (const sourceId of block.sourceIds) {
        const marks = sourceMarks.get(sourceId)
        if (marks) block.itemStyles[sourceId] = { ...block.itemStyles[sourceId], marks }
      }
    }
  }
  return {
    ...document,
    name: document.name,
    sidePadding: templateId === "editorial-story" ? 20 : document.sidePadding,
    background: theme.canvas,
    pageBackground: theme.canvas,
    font: theme.font,
    theme,
    blocks,
  }
}

function contentSourceIds(document: WechatBlockDocument): string[] {
  return document.blocks.flatMap(block => {
    if (block.type === "content") return [block.sourceId]
    if (block.type === "section") return block.sourceIds
    return []
  })
}

export function assessCanvasVisualQuality(
  document: WechatBlockDocument,
  sources: CanvasSource[],
): CanvasVisualQualityReport {
  const sections = document.blocks.filter((block): block is WechatSectionBlock => block.type === "section")
  const contentBlocks = document.blocks.filter(block => block.type === "content")
  const materials = anchoredMaterials(document)
  const layouts = new Set(sections.map(section => section.layout))
  const semanticGroups = semanticSourceGroups(sources)
  const composableGroupCount = semanticGroups.filter(group => group.length > 1).length
  const layoutOpportunityCount = semanticGroups.filter(group => (
    group.length > 1
    && (group[0]?.kind === "image" || isCompactGroup(group))
  )).length
  const surfaceCount = sections.filter(section => (
    section.background !== "transparent"
    || Boolean(section.surfaceStyle && section.surfaceStyle.kind !== "none")
  )).length
  const accentCount = sections.filter(section => section.accentStyle !== "none").length
  const iconCount = sections.filter(section => Boolean(section.icon)).length
  const sourceById = new Map(sources.map(source => [source.id, source]))
  const mediaSectionCount = sections.filter(section => (
    section.sourceIds.some(sourceId => sourceById.get(sourceId)?.kind === "image")
  )).length
  const typographyRoles = new Set(document.blocks.flatMap(block => {
    if (block.type === "content") return [block.variant]
    if (block.type === "section") {
      return Object.values(block.itemStyles).flatMap(style => style.variant ? [style.variant] : [])
    }
    return []
  }))
  const metrics: CanvasVisualQualityMetrics = {
    sectionCount: sections.length,
    standaloneContentCount: contentBlocks.length,
    composableGroupCount,
    layoutCount: layouts.size,
    layoutOpportunityCount,
    surfaceCount,
    accentCount,
    iconCount,
    mediaSectionCount,
    materialCount: materials.length,
    typographyRoleCount: typographyRoles.size,
  }
  const issues: string[] = []
  const counts = new Map<string, number>()
  for (const sourceId of contentSourceIds(document)) counts.set(sourceId, (counts.get(sourceId) || 0) + 1)
  if (sources.some(source => counts.get(source.id) !== 1)) issues.push("内容源覆盖不完整或重复")

  const requestedSections = sources.length >= 8 ? 2 : sources.length >= 3 ? 1 : 0
  const minimumSections = Math.min(requestedSections, composableGroupCount)
  if (sections.length < minimumSections) issues.push("组合区域不足")
  // 无边框排版由真实文字层级、可读字号和章节留白验收，不强迫插入装饰来凑数量。
  const headings = sources.filter(source => source.kind === "heading")
  const readableHeadings = headings.every(source => sections.some(section => {
    const style = section.itemStyles[source.id]
    return (style?.fontSize || 0) >= document.theme.bodySize + 3
  }) || contentBlocks.some(block => block.sourceId === source.id && block.fontSize >= document.theme.bodySize + 3))
  const readableSections = readableHeadings
    && typographyRoles.has("title")
    && (typographyRoles.has("lede") || headings.length > 0)
    && document.theme.bodySize >= 16
    && document.theme.bodyLineHeight >= 1.75
    && sections.length > 0
    && sections.every(section => section.marginBottom >= 24 && ["stack", "grid"].includes(section.layout))
  const techniques = [
    surfaceCount > 0,
    accentCount > 0,
    iconCount > 0,
    mediaSectionCount > 0,
    materials.length > 0,
  ].filter(Boolean).length
  if (sources.length >= 6 && composableGroupCount > 0 && techniques < 2 && !readableSections) {
    issues.push("视觉手段不足")
  }
  if (sources.length >= 10 && layoutOpportunityCount >= 2 && layouts.size < 2 && !readableSections) {
    issues.push("长文布局节奏单一")
  }
  if (sources.length >= 8 && typographyRoles.size < 2) issues.push("文字角色层级不足")
  if (sources.length >= 8 && contentBlocks.length > Math.ceil(sources.length / 2)) {
    issues.push("正文仍以逐段内容块为主")
  }

  let score = 100
  for (const issue of issues) {
    if (issue.includes("内容源")) score -= 40
    else if (issue.includes("组合区域")) score -= 25
    else score -= 15
  }
  return { score: Math.max(0, score), passed: issues.length === 0, issues, metrics }
}

export function finalizeCanvasDesign(
  document: WechatBlockDocument,
  sources: CanvasSource[],
  templateId: CanvasDesignTemplateId,
): CanvasDesignFinalization {
  const compiled = compileCanvasDesignSystem(document, sources, templateId)
  const report = assessCanvasVisualQuality(compiled, sources)
  if (report.passed) return { document: compiled, report, rebuilt: false }

  const rebuilt = compileCanvasDesignSystem(document, sources, templateId, { forceRecipes: true })
  return {
    document: rebuilt,
    report: assessCanvasVisualQuality(rebuilt, sources),
    rebuilt: true,
  }
}
