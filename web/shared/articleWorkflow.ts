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
