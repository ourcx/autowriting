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
  workflow.currentStage = inferArticleWorkflowStage(content, workflow)
  return workflow
}
