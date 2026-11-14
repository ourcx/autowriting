export type CandidatePlatform = "wechat" | "toutiao"
export type CandidateTarget = CandidatePlatform | "both"
export type CandidateStatus = "queued" | "generating" | "complete" | "interrupted"

export interface CandidateResearchSource {
  title: string
  url: string
  publishedAt?: string
  read: boolean
}

export type CandidateTraceStatus = "running" | "done" | "failed" | "skipped" | "interrupted"

export interface CandidateTraceSource {
  title: string
  url?: string
  articleId?: string
  publishedAt?: string
}

export interface CandidateTraceStep {
  id: string
  attempt: number
  title: string
  kind: "context" | "history" | "decision" | "search" | "read" | "find" | "outline" | "write"
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
