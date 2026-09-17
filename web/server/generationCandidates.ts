import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { GENERATION_CANDIDATE_DIR } from "./config.ts"
import type { CandidateInput, GenerationCandidate } from "../shared/generationCandidate.ts"

interface StoredCandidate extends GenerationCandidate {
  input: CandidateInput
}

export class CandidateError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message) }
}

function directory(userId: string, articleId: string): string {
  // Hash both identifiers so user-controlled IDs can never become path segments.
  const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex")
  return path.join(GENERATION_CANDIDATE_DIR, digest(userId), digest(articleId))
}

function filename(userId: string, articleId: string, id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new CandidateError("候选稿不存在", 404)
  return path.join(directory(userId, articleId), `${id}.json`)
}

export function publicCandidate(stored: StoredCandidate): GenerationCandidate {
  const { input, ...candidate } = stored
  void input
  return candidate
}

export function saveCandidate(userId: string, articleId: string, candidate: StoredCandidate): void {
  const target = filename(userId, articleId, candidate.id)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, JSON.stringify(candidate), { encoding: "utf8", mode: 0o600 })
    fs.renameSync(temporary, target)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

export function readCandidate(userId: string, articleId: string, id: string): StoredCandidate {
  const target = filename(userId, articleId, id)
  if (!fs.existsSync(target)) throw new CandidateError("候选稿不存在", 404)
  return JSON.parse(fs.readFileSync(target, "utf8")) as StoredCandidate
}

export function listCandidates(userId: string, articleId: string): GenerationCandidate[] {
  const dir = directory(userId, articleId)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(name => name.endsWith(".json")).map(name => {
    const stored = readCandidate(userId, articleId, name.slice(0, -5))
    // A restart loses active requests but never the checkpointed content.
    if (stored.status === "generating" && !running.has(stored.id)) {
      stored.status = "interrupted"
      stored.message = "上次生成已中断，可以继续生成"
      stored.finishedAt = stored.updatedAt
      saveCandidate(userId, articleId, stored)
    }
    return publicCandidate(stored)
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30)
}

export function parseCandidateInput(value: unknown): CandidateInput {
  if (!value || typeof value !== "object") throw new CandidateError("生成参数不正确")
  const data = value as Record<string, unknown>
  const text = (key: string, max: number, required = false) => {
    const value = data[key] ?? ""
    if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
      throw new CandidateError(`${key} 为空或长度超过限制`)
    }
    return value
  }
  if (data.platform !== "wechat" && data.platform !== "toutiao") throw new CandidateError("生成平台不正确")
  const count = data.count ?? 1
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 3) throw new CandidateError("一次只能生成 1–3 篇")
  const references = data.referenceArticleIds ?? []
  if (!Array.isArray(references) || references.length > 8 || references.some(id => typeof id !== "string" || id.length > 160)) {
    throw new CandidateError("参考文章参数不正确")
  }
  return {
    task: text("task", 30000, true), materials: text("materials", 150000, true),
    sourceArticle: text("sourceArticle", 100000), selectedRagContext: text("selectedRagContext", 50000),
    referenceArticleIds: references, platform: data.platform, count,
  }
}

export function createCandidates(userId: string, articleId: string, input: CandidateInput): GenerationCandidate[] {
  const batchId = crypto.randomUUID()
  return Array.from({ length: input.count }, (_, index) => {
    const now = new Date().toISOString()
    const candidate: StoredCandidate = {
      id: crypto.randomUUID(), batchId, label: `候选 ${index + 1}`, platform: input.platform,
      status: "queued", content: "", message: "等待生成", createdAt: now, updatedAt: now, input,
    }
    saveCandidate(userId, articleId, candidate)
    return publicCandidate(candidate)
  })
}

const running = new Set<string>()
const perUser = new Map<string, number>()
let totalRunning = 0
const MAX_CONCURRENT_PER_USER = 3
const MAX_CONCURRENT_TOTAL = 8

export function acquireCandidate(userId: string, id: string): () => void {
  if (running.has(id)) throw new CandidateError("这篇候选稿正在生成", 409)
  if ((perUser.get(userId) || 0) >= MAX_CONCURRENT_PER_USER || totalRunning >= MAX_CONCURRENT_TOTAL) {
    throw new CandidateError("生成任务较多，请稍后重试", 429)
  }
  running.add(id)
  perUser.set(userId, (perUser.get(userId) || 0) + 1)
  totalRunning += 1
  return () => {
    running.delete(id)
    const remaining = (perUser.get(userId) || 1) - 1
    if (remaining) perUser.set(userId, remaining)
    else perUser.delete(userId)
    totalRunning -= 1
  }
}
