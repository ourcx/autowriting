export type CandidatePlatform = "wechat" | "toutiao"
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
}

export interface CandidateInput {
  task: string
  materials: string
  sourceArticle: string
  selectedRagContext: string
  referenceArticleIds: string[]
  platform: CandidatePlatform
  count: number
}

export interface CandidateEvent {
  event: "candidate" | "chunk" | "status" | "done" | "error"
  candidate?: GenerationCandidate
  text?: string
  message?: string
}
