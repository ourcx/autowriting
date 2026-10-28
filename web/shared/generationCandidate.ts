export type CandidatePlatform = "wechat" | "toutiao"
export type CandidateTarget = CandidatePlatform | "both"
export type CandidateStatus = "queued" | "generating" | "complete" | "interrupted"

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
}

export interface CandidateInput {
  task: string
  materials: string
  sourceArticle: string
  selectedRagContext: string
  referenceArticleIds: string[]
  platform: CandidateTarget
  count: number
  /** 兼容历史候选稿：旧版双平台任务的头条稿会读取同组公众号母稿。 */
  sourceCandidateId?: string
}

export interface CandidateEvent {
  event: "candidate" | "chunk" | "status" | "done" | "error"
  candidate?: GenerationCandidate
  text?: string
  message?: string
}
