export type ArticleWorkflowStage =
  | "brief"
  | "materials"
  | "drafting"
  | "review"
  | "ready"
  | "wechat_draft"

export type ArticleWorkflowEvent = "generated" | "reviewed" | "wechat_draft_opened" | "wechat_draft_pushed"

export interface ArticleWorkflow {
  createdAt: string
  updatedAt: string
  currentStage: ArticleWorkflowStage
  firstGeneratedAt?: string
  lastReviewedAt?: string
  wechatDraftOpenedAt?: string
  wechatDraftAt?: string
  firstWechatDraftAt?: string
  firstDraftActiveMs?: number
  firstDraftReworkCount?: number
  activeEditingMs?: number
  activityTrackedAt?: string
  activitySessions?: Record<string, number>
  reworkCount?: number
  selectedCandidateId?: string
  selectionCount?: number
  feedback?: { note: string; retainedExpressions: string[]; updatedAt: string }
  draftReceipt?: {
    status: "sending" | "succeeded" | "unknown" | "failed"
    fingerprint: string
    accountId: string
    at: string
    mediaId?: string
    message?: string
    title?: string
    sourceHash?: string
  }
  generationContext?: {
    platforms: Array<"wechat" | "toutiao">
    referenceArticleIds: string[]
    promptIds: string[]
  }
  publishContext?: {
    templateId: string
  }
}

export interface ArticleWorkflowContent {
  task: string
  materials: string
  article: string
}

export function inferArticleWorkflowStage(
  content: ArticleWorkflowContent,
  workflow?: Partial<ArticleWorkflow> | null,
): ArticleWorkflowStage {
  if (workflow?.wechatDraftAt) return "wechat_draft"
  if (workflow?.lastReviewedAt) return "ready"
  if (content.article.trim().length > 100) return "review"
  if (content.materials.trim().length >= 30) return "drafting"
  if (content.task.trim().length >= 20) return "materials"
  return "brief"
}

export function normalizeArticleWorkflow(
  value: unknown,
  content: ArticleWorkflowContent,
  createdAt = new Date().toISOString(),
): ArticleWorkflow {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const text = (key: string): string | undefined => typeof source[key] === "string" ? source[key] as string : undefined
  const workflow: ArticleWorkflow = {
    createdAt: text("createdAt") || createdAt,
    updatedAt: text("updatedAt") || createdAt,
    currentStage: "brief",
    ...(text("firstGeneratedAt") ? { firstGeneratedAt: text("firstGeneratedAt") } : {}),
    ...(text("lastReviewedAt") ? { lastReviewedAt: text("lastReviewedAt") } : {}),
    ...(text("wechatDraftOpenedAt") ? { wechatDraftOpenedAt: text("wechatDraftOpenedAt") } : {}),
    ...(text("wechatDraftAt") ? { wechatDraftAt: text("wechatDraftAt") } : {}),
    ...(text("firstWechatDraftAt") || text("wechatDraftAt") ? { firstWechatDraftAt: text("firstWechatDraftAt") || text("wechatDraftAt") } : {}),
    ...(text("activityTrackedAt") ? { activityTrackedAt: text("activityTrackedAt") } : {}),
    ...(text("selectedCandidateId") ? { selectedCandidateId: text("selectedCandidateId") } : {}),
  }
  for (const key of ["activeEditingMs", "reworkCount", "selectionCount", "firstDraftActiveMs", "firstDraftReworkCount"] as const) {
    if (typeof source[key] === "number" && Number.isFinite(source[key]) && source[key] >= 0) workflow[key] = source[key]
  }
  if (source.activitySessions && typeof source.activitySessions === "object") {
    workflow.activitySessions = Object.fromEntries(Object.entries(source.activitySessions).filter(
      ([key, value]) => /^[a-f0-9-]{36}$/.test(key) && typeof value === "number" && Number.isFinite(value) && value >= 0,
    ).slice(-100)) as Record<string, number>
  }
  if (source.feedback && typeof source.feedback === "object") {
    const feedback = source.feedback as Record<string, unknown>
    workflow.feedback = {
      note: typeof feedback.note === "string" ? feedback.note.slice(0, 1000) : "",
      retainedExpressions: Array.isArray(feedback.retainedExpressions)
        ? feedback.retainedExpressions.filter((value): value is string => typeof value === "string").slice(0, 10).map(value => value.slice(0, 300)) : [],
      updatedAt: typeof feedback.updatedAt === "string" ? feedback.updatedAt : createdAt,
    }
  }
  if (source.draftReceipt && typeof source.draftReceipt === "object") {
    const receipt = source.draftReceipt as Record<string, unknown>
    if (["sending", "succeeded", "unknown", "failed"].includes(String(receipt.status))
      && typeof receipt.fingerprint === "string" && typeof receipt.accountId === "string" && typeof receipt.at === "string") {
      workflow.draftReceipt = {
        status: receipt.status as NonNullable<ArticleWorkflow["draftReceipt"]>["status"],
        fingerprint: receipt.fingerprint, accountId: receipt.accountId, at: receipt.at,
        ...(typeof receipt.mediaId === "string" ? { mediaId: receipt.mediaId } : {}),
        ...(typeof receipt.message === "string" ? { message: receipt.message.slice(0, 300) } : {}),
        ...(typeof receipt.title === "string" ? { title: receipt.title } : {}),
        ...(typeof receipt.sourceHash === "string" ? { sourceHash: receipt.sourceHash } : {}),
      }
    }
  }
  if (source.generationContext && typeof source.generationContext === "object") {
    const context = source.generationContext as Record<string, unknown>
    workflow.generationContext = {
      platforms: Array.isArray(context.platforms)
        ? context.platforms.filter((item): item is "wechat" | "toutiao" => item === "wechat" || item === "toutiao").slice(0, 2)
        : [],
      referenceArticleIds: Array.isArray(context.referenceArticleIds)
        ? context.referenceArticleIds.filter((item): item is string => typeof item === "string").map(item => item.slice(0, 160)).slice(0, 8)
        : [],
      promptIds: Array.isArray(context.promptIds)
        ? context.promptIds.filter((item): item is string => typeof item === "string").map(item => item.slice(0, 100)).slice(0, 4)
        : [],
    }
  }
  if (source.publishContext && typeof source.publishContext === "object") {
    const templateId = (source.publishContext as Record<string, unknown>).templateId
    if (typeof templateId === "string" && templateId.trim()) {
      workflow.publishContext = { templateId: templateId.trim().slice(0, 100) }
    }
  }
  workflow.currentStage = inferArticleWorkflowStage(content, workflow)
  return workflow
}
