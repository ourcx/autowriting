import { getWritingGuideContent } from "./config.ts"
import { getSetting } from "./db.ts"
import { formatCreatorExperiences } from "./productionJournal.ts"
import { formatExampleContext } from "./rag.ts"
import {
  ARTICLE_WRITING_BASELINE,
  formatCreatorPersonaForPrompt,
  formatCreatorProfileForPrompt,
  normalizeCreatorWritingProfile,
} from "../shared/contentProduction.ts"

interface WritingContextOptions {
  includeWritingGuide?: boolean
  includePerformanceEvidence?: boolean
  referenceContext?: string
  compactForAgent?: boolean
}

function boundedMemory(value: unknown): string {
  if (typeof value !== "string") return ""
  const memory = value.trim()
  if (memory.length <= 12000) return memory
  return `${memory.slice(0, 12000)}\n\n[背景记忆过长，本次只读取前 12000 字。请在写作资产中精简。]`
}

export async function buildWritingContext(
  userId: string,
  {
    includeWritingGuide = true,
    includePerformanceEvidence = true,
    referenceContext = "",
    compactForAgent = false,
  }: WritingContextOptions = {},
): Promise<string> {
  const writingProfile = normalizeCreatorWritingProfile(getSetting(`creator_writing_profile:${userId}`))
  const persona = formatCreatorPersonaForPrompt(writingProfile.persona)
  const profile = formatCreatorProfileForPrompt(writingProfile)
  const memory = boundedMemory(getSetting(`global_memory:${userId}`))
  const performance = includePerformanceEvidence ? await formatExampleContext(userId) : ""
  const writingGuide = includeWritingGuide ? getWritingGuideContent().trim() : ""
  const confirmedExpressions = formatCreatorExperiences(userId)
  const baseline = compactForAgent
    ? ARTICLE_WRITING_BASELINE.split("\n").slice(0, 4).join("\n")
    : ARTICLE_WRITING_BASELINE
  const sections = [
    persona,
    baseline,
    `# 上下文使用顺序
1. 本篇任务与素材决定当前情境、事实边界和交付目标。
2. 已确认作者人设用于确定叙述身份，不能据此补写未确认的个人经历。
3. 写作 DNA 与作者已确认取舍用于表达选择，不适用当前情境时不要生搬硬套。
4. 长期背景只提供稳定事实，不能覆盖本篇素材。
5. 历史表现只用于提出选题和内容假设，不能证明某种句式、篇幅或模板有效。
6. 往期文章只参考展开方式，不复制旧事实。`,
    writingGuide ? `# 通用写作规范\n${compactForAgent ? writingGuide.slice(0, 2500) : writingGuide}` : "",
    profile,
    compactForAgent ? confirmedExpressions.slice(0, 1600) : confirmedExpressions,
    memory ? `# 长期背景记忆\n${compactForAgent ? memory.slice(0, 1600) : memory}` : "",
    compactForAgent ? performance.slice(0, 900) : performance,
    referenceContext.trim(),
  ].map(section => section.trim()).filter(Boolean)
  return `${sections.join("\n\n")}\n\n`
}
