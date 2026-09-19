import crypto from "node:crypto"
import { getSetting, setSetting } from "./db.ts"
import { readArticleContent, readArticleWorkflow, saveArticleWorkflow } from "./articleStorage.ts"
import { CandidateError, readCandidate } from "./generationCandidates.ts"
import type { ArticleWorkflow } from "../shared/articleWorkflow.ts"

export interface CreatorExperience {
  articleId: string
  candidateId?: string
  note: string
  retainedExpressions: string[]
  changedParagraphs: number
  retainedParagraphs: number
  promptIds: string[]
  referenceArticleIds: string[]
  templateId?: string
  updatedAt: string
}

export function listCreatorExperiences(userId: string): CreatorExperience[] {
  const value = getSetting(`creator_experiences:${userId}`)
  return Array.isArray(value) ? value as CreatorExperience[] : []
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
  const input = value as { note?: unknown; retainedExpressions?: unknown } | null
  if (!input || typeof input.note !== "string" || input.note.length > 1000 || !Array.isArray(input.retainedExpressions)
    || input.retainedExpressions.length > 10 || input.retainedExpressions.some(text => typeof text !== "string" || !text.trim() || text.length > 300)) {
    throw new CandidateError("请填写修改原因，保留表达最多 10 条，每条不超过 300 字")
  }
  const content = readArticleContent(articlePath)
  if (input.retainedExpressions.some(text => !content.article.includes(String(text)))) throw new CandidateError("保留表达必须出现在已保存的正文中")
  const workflow = readArticleWorkflow(articlePath, content)
  const original = workflow.selectedCandidateId ? readCandidate(userId, articleId, workflow.selectedCandidateId).content : ""
  const paragraphs = content.article.split(/\n\s*\n/).map(text => text.trim()).filter(Boolean)
  const retained = original ? paragraphs.filter(text => original.includes(text)).length : 0
  const now = new Date().toISOString()
  workflow.feedback = { note: input.note.trim(), retainedExpressions: input.retainedExpressions as string[], updatedAt: now }
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
  return entries.length ? `\n# 作者明确确认的写作偏好\n以下是作者反馈，不是读者表现的因果证据。只参考表达取舍，不复制旧事实；本次任务优先。\n${JSON.stringify(entries)}\n` : ""
}

export function draftFingerprint(accountId: string, payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify([accountId, payload])).digest("hex")
}
