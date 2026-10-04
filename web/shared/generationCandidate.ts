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
  /** 仅由服务端为成对生成的头条稿设置，保证它读取同组公众号母稿。 */
  sourceCandidateId?: string
}

export interface CandidateEvent {
  event: "candidate" | "chunk" | "status" | "done" | "error"
  candidate?: GenerationCandidate
  text?: string
  message?: string
}
