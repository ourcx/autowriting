export type CandidatePlatform = "wechat" | "toutiao"
export type CandidateTarget = CandidatePlatform | "both"
export type CandidateStatus = "queued" | "generating" | "complete" | "interrupted"
export type ArticleWritingMode = "standard" | "image_story"
export type ArticleImageMode = "none" | "web" | "generate"

export interface ArticleImage {
  id: string
  url: string
  alt: string
  source: "web" | "generated"
  sourceUrl?: string
  originalUrl?: string
  placement: string
}

export interface CandidateResearchSource {
  title: string
  url: string
  publishedAt?: string
  read: boolean
  scope?: "primary" | "background"
}

export type CandidateTraceStatus = "running" | "done" | "failed" | "skipped" | "interrupted" | "changes_requested"

export interface CandidateTraceSource {
  title: string
  url?: string
  articleId?: string
  publishedAt?: string
  scope?: "primary" | "background"
}

export interface CandidateTraceStep {
  id: string
  attempt: number
  title: string
  kind: "context" | "history" | "decision" | "search" | "read" | "find" | "browser" | "terminal" | "image" | "outline" | "write" | "review" | "edit" | "verify"
  status: CandidateTraceStatus
  startedAt: string
  finishedAt?: string
  input?: string
  output?: string
  sources?: CandidateTraceSource[]
}

export interface GenerationCandidate {
  id: string
  batchId: string
  label: string
  platform: CandidatePlatform
  status: CandidateStatus
  content: string
  message: string
  createdAt: string
  updatedAt: string
  firstChunkAt?: string
  finishedAt?: string
  model?: string
  promptIds?: string[]
  pairId?: string
  referenceArticleIds?: string[]
  researchSources?: CandidateResearchSource[]
  trace?: CandidateTraceStep[]
  writingMode?: ArticleWritingMode
  imageMode?: ArticleImageMode
  imageCount?: number
  images?: ArticleImage[]
  imageMessage?: string
}

export interface CandidateInput {
  task: string
  materials: string
  sourceArticle: string
  selectedRagContext: string
  referenceArticleIds: string[]
  platform: CandidateTarget
  count: number
  writingAgent?: boolean
  writingMode?: ArticleWritingMode
  imageMode?: ArticleImageMode
  imageCount?: number
  browserTools?: boolean
  terminalTools?: boolean
  /** 兼容历史候选稿：旧版双平台任务的头条稿会读取同组公众号母稿。 */
  sourceCandidateId?: string
}

export interface CandidateEvent {
  event: "candidate" | "chunk" | "status" | "trace" | "done" | "error"
  candidate?: GenerationCandidate
  step?: CandidateTraceStep
  text?: string
  message?: string
}
