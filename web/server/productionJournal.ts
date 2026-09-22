import crypto from "node:crypto"
import { getSetting, setSetting } from "./db.ts"
import { readArticleContent, readArticleWorkflow, saveArticleWorkflow } from "./articleStorage.ts"
import { CandidateError, readCandidate } from "./generationCandidates.ts"
import type { ArticleWorkflow } from "../shared/articleWorkflow.ts"
import {
  WRITING_DNA_LAYER_LABELS,
  type CreatorFeedbackLayer,
  type WritingDnaLayer,
} from "../shared/contentProduction.ts"

export interface CreatorExperience {
  articleId: string
  candidateId?: string
  layer: CreatorFeedbackLayer
  note: string
  retainedExpressions: string[]
  changedParagraphs: number
  retainedParagraphs: number
  promptIds: string[]
  referenceArticleIds: string[]
  templateId?: string
  updatedAt: string
}

const FEEDBACK_LAYERS = new Set<CreatorFeedbackLayer>([
  "general", "language", "structure", "angle", "material", "cognition", "visual",
])

function normalizeFeedbackLayer(value: unknown): CreatorFeedbackLayer {
  return typeof value === "string" && FEEDBACK_LAYERS.has(value as CreatorFeedbackLayer)
    ? value as CreatorFeedbackLayer
    : "general"
}

export function listCreatorExperiences(userId: string): CreatorExperience[] {
  const value = getSetting(`creator_experiences:${userId}`)
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return []
    const source = item as Record<string, unknown>
    if (typeof source.articleId !== "string") return []
    return [{
      articleId: source.articleId,
      ...(typeof source.candidateId === "string" ? { candidateId: source.candidateId } : {}),
      layer: normalizeFeedbackLayer(source.layer),
      note: typeof source.note === "string" ? source.note.slice(0, 1000) : "",
      retainedExpressions: Array.isArray(source.retainedExpressions)
        ? source.retainedExpressions.filter((entry): entry is string => typeof entry === "string").slice(0, 10)
        : [],
      changedParagraphs: typeof source.changedParagraphs === "number" ? source.changedParagraphs : 0,
      retainedParagraphs: typeof source.retainedParagraphs === "number" ? source.retainedParagraphs : 0,
      promptIds: Array.isArray(source.promptIds)
        ? source.promptIds.filter((entry): entry is string => typeof entry === "string").slice(0, 4)
        : [],
      referenceArticleIds: Array.isArray(source.referenceArticleIds)
        ? source.referenceArticleIds.filter((entry): entry is string => typeof entry === "string").slice(0, 8)
        : [],
      ...(typeof source.templateId === "string" ? { templateId: source.templateId } : {}),
      updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date(0).toISOString(),
    }]
  })
}

export function selectCandidate(userId: string, articleId: string, articlePath: string, candidateId: string): void {
  const candidate = readCandidate(userId, articleId, candidateId)
  const content = readArticleContent(articlePath)
  if (candidate.platform !== "wechat" || !candidate.content.trim()) throw new CandidateError("请选择有正文的公众号候选稿")
  const workflow = readArticleWorkflow(articlePath, content)
  if (workflow.selectedCandidateId !== candidateId) workflow.selectionCount = (workflow.selectionCount || 0) + 1
  workflow.selectedCandidateId = candidateId
  workflow.generationContext = {
    platforms: ["wechat"], referenceArticleIds: candidate.input.referenceArticleIds,
    promptIds: candidate.promptIds || ["prompt-article-generate"],
  }
  delete workflow.feedback
  saveArticleWorkflow(articlePath, workflow)
}

export function recordEditingActivity(articlePath: string, value: unknown): ArticleWorkflow {
  const input = value as { sessionId?: unknown; totalMs?: unknown } | null
  if (!input || typeof input.sessionId !== "string" || !/^[a-f0-9-]{36}$/.test(input.sessionId)
    || typeof input.totalMs !== "number" || !Number.isSafeInteger(input.totalMs) || input.totalMs < 0 || input.totalMs > 86400000) {
    throw new CandidateError("编辑计时参数不正确")
  }
  const workflow = readArticleWorkflow(articlePath, readArticleContent(articlePath))
  const sessions = workflow.activitySessions || {}
  const previous = sessions[input.sessionId] || 0
  // Cumulative checkpoints make retrying a lost response safe. A checkpoint can
  // add at most one minute, so a suspended tab cannot turn days away into work.
  const delta = Math.min(60000, Math.max(0, input.totalMs - previous))
  workflow.activeEditingMs = (workflow.activeEditingMs || 0) + delta
  workflow.activityTrackedAt ||= new Date().toISOString()
  sessions[input.sessionId] = Math.max(previous, input.totalMs)
  workflow.activitySessions = Object.fromEntries(Object.entries(sessions).slice(-100))
  saveArticleWorkflow(articlePath, workflow)
  return workflow
}

export function recordCreatorFeedback(userId: string, articleId: string, articlePath: string, value: unknown): ArticleWorkflow {
  const input = value as { layer?: unknown; note?: unknown; retainedExpressions?: unknown } | null
  if (!input || typeof input.note !== "string" || input.note.length > 1000 || !Array.isArray(input.retainedExpressions)
    || input.retainedExpressions.length > 10 || input.retainedExpressions.some(text => typeof text !== "string" || !text.trim() || text.length > 300)) {
    throw new CandidateError("请填写修改原因，保留表达最多 10 条，每条不超过 300 字")
  }
  const layer = normalizeFeedbackLayer(input.layer)
  const content = readArticleContent(articlePath)
  if (input.retainedExpressions.some(text => !content.article.includes(String(text)))) throw new CandidateError("保留表达必须出现在已保存的正文中")
  const workflow = readArticleWorkflow(articlePath, content)
  const original = workflow.selectedCandidateId ? readCandidate(userId, articleId, workflow.selectedCandidateId).content : ""
  const paragraphs = content.article.split(/\n\s*\n/).map(text => text.trim()).filter(Boolean)
  const retained = original ? paragraphs.filter(text => original.includes(text)).length : 0
  const now = new Date().toISOString()
  workflow.feedback = { layer, note: input.note.trim(), retainedExpressions: input.retainedExpressions as string[], updatedAt: now }
  saveArticleWorkflow(articlePath, workflow)
  const experience: CreatorExperience = {
    articleId, candidateId: workflow.selectedCandidateId, ...workflow.feedback,
    changedParagraphs: original ? paragraphs.length - retained : 0, retainedParagraphs: retained,
    promptIds: workflow.generationContext?.promptIds || [],
    referenceArticleIds: workflow.generationContext?.referenceArticleIds || [],
    templateId: workflow.publishContext?.templateId,
  }
  setSetting(`creator_experiences:${userId}`, [experience, ...listCreatorExperiences(userId).filter(item => item.articleId !== articleId)].slice(0, 100))
  return workflow
}

export function formatCreatorExperiences(userId: string): string {
  const entries = listCreatorExperiences(userId).filter(item => item.note || item.retainedExpressions.length).slice(0, 5)
  if (!entries.length) return ""
  const layerLabel = (layer: CreatorFeedbackLayer) => layer === "general"
    ? "综合取舍"
    : WRITING_DNA_LAYER_LABELS[layer as WritingDnaLayer]
  const rows = entries.map(item => {
    const note = item.note ? `- 作者确认：${item.note}` : ""
    const expressions = item.retainedExpressions.length
      ? `- 可复用表达：${item.retainedExpressions.map(value => `“${value}”`).join("；")}`
      : ""
    return `## ${layerLabel(item.layer)}\n${[note, expressions].filter(Boolean).join("\n")}`
  })
  return `
# 作者已确认的写作取舍
以下内容来自作者对模型稿的手动修改与明确确认。只复用取舍，不复制旧文章事实。已有规则没有执行时，应执行原规则，不要添加重复规则。
${rows.join("\n")}
`
}

export function draftFingerprint(accountId: string, payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify([accountId, payload])).digest("hex")
}
