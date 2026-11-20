import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { GENERATION_CANDIDATE_DIR } from "./config.ts"
import type { CandidateInput, GenerationCandidate } from "../shared/generationCandidate.ts"

interface StoredCandidate extends GenerationCandidate {
  input: CandidateInput
  writingBrief?: string
  draftComplete?: boolean
  imagesPrepared?: boolean
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
  const { input, writingBrief, draftComplete, imagesPrepared, ...candidate } = stored
  void input
  void writingBrief
  void draftComplete
  void imagesPrepared
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
  const candidate = JSON.parse(fs.readFileSync(target, "utf8")) as StoredCandidate
  // 旧版把事实核查结果写成中断。只恢复已写完且因这两种核查结果被拦下的稿件。
  if (candidate.status === "interrupted" && candidate.draftComplete && candidate.content.trim()
    && (candidate.message === "成稿仍有待核实的事实，已保留草稿。请查看核查记录，补充来源后重新生成。"
      || candidate.message === "事实核查未完成，已保留草稿，可继续核查。")) {
    candidate.status = "complete"
    candidate.message = "生成完成"
  }
  return candidate
}

export function interruptCandidateTrace(candidate: GenerationCandidate, finishedAt?: string): void {
  for (const step of candidate.trace || []) {
    if (step.status !== "running") continue
    step.status = "interrupted"
    step.finishedAt = finishedAt
  }
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
      // 进程退出的准确时刻不可知，保留开始时间，不把上次保存时间当作耗时。
      interruptCandidateTrace(stored)
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
  if (data.platform !== "wechat" && data.platform !== "toutiao" && data.platform !== "both") throw new CandidateError("生成平台不正确")
  const count = data.count ?? 1
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 3) throw new CandidateError("一次只能生成 1–3 篇")
  const writingAgent = data.writingAgent === true
  const writingMode = data.writingMode ?? "standard"
  // 只有明确的 generate 参数才授予生成图片权限；旧版 auto 也按真实图片处理。
  const imageMode = data.imageMode === "auto" ? "web" : data.imageMode ?? "web"
  const imageCount = data.imageCount ?? (writingMode === "image_story" ? 6 : 3)
  if (!["standard", "image_story"].includes(String(writingMode))) throw new CandidateError("文章生成方式不正确")
  if (!["none", "web", "generate"].includes(String(imageMode))) throw new CandidateError("配图方式不正确")
  if (writingMode === "image_story" && imageMode === "none") throw new CandidateError("多图少字模式需要启用配图")
  if (typeof imageCount !== "number" || !Number.isInteger(imageCount) || imageCount < 1 || imageCount > 8) throw new CandidateError("一篇文章最多配 1–8 张图")
  for (const key of ["browserTools", "terminalTools"]) {
    if (data[key] !== undefined && typeof data[key] !== "boolean") throw new CandidateError("工具权限参数不正确")
  }
  const references = data.referenceArticleIds ?? []
  if (!Array.isArray(references) || references.length > 8 || references.some(id => typeof id !== "string" || id.length > 160)) {
    throw new CandidateError("参考文章参数不正确")
  }
  return {
    task: text("task", 30000, true), materials: text("materials", 150000, !writingAgent),
    sourceArticle: text("sourceArticle", 100000), selectedRagContext: text("selectedRagContext", 50000),
    referenceArticleIds: references, platform: data.platform, count,
    ...(writingAgent ? { writingAgent } : {}),
    writingMode: writingMode as CandidateInput["writingMode"], imageMode: imageMode as CandidateInput["imageMode"],
    imageCount, browserTools: data.browserTools !== false, terminalTools: data.terminalTools !== false,
  }
}

export function createCandidates(userId: string, articleId: string, input: CandidateInput): GenerationCandidate[] {
  const batchId = crypto.randomUUID()
  const candidates: StoredCandidate[] = []
  for (let index = 0; index < input.count; index += 1) {
    const now = new Date().toISOString()
    const pairId = input.platform === "both" ? crypto.randomUUID() : undefined
    const wechatId = crypto.randomUUID()
    const platforms: Array<"wechat" | "toutiao"> = input.platform === "both" ? ["wechat", "toutiao"] : [input.platform]
    for (const platform of platforms) {
      const candidateInput: CandidateInput = {
        ...input,
        platform,
        writingMode: input.writingMode, imageMode: input.imageMode, imageCount: input.imageCount,
        // 双平台候选共享任务与素材并行成稿；单独生成头条时仍可使用传入的公众号正文。
        ...(input.platform === "both" && platform === "toutiao" ? { sourceArticle: "" } : {}),
      }
      const candidate: StoredCandidate = {
        id: platform === "wechat" && pairId ? wechatId : crypto.randomUUID(),
        batchId,
        pairId,
        label: input.platform === "both" ? `方案 ${index + 1} · ${platform === "wechat" ? "公众号" : "头条"}` : `候选 ${index + 1}`,
        platform,
        writingMode: input.writingMode, imageMode: input.imageMode, imageCount: input.imageCount,
        status: "queued", content: "", message: "等待生成",
        createdAt: now, updatedAt: now, input: candidateInput,
      }
      saveCandidate(userId, articleId, candidate)
      candidates.push(candidate)
    }
  }
  return candidates.map(publicCandidate)
}

const running = new Set<string>()
const perUser = new Map<string, number>()
let totalRunning = 0
// 一批最多生成 3 组双平台候选，共 6 个模型请求。
const MAX_CONCURRENT_PER_USER = 6
const MAX_CONCURRENT_TOTAL = 12

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
