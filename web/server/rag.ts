/**
 * RAG 模块：向量索引 + 混合检索（向量 + 关键词）
 */
import fs from "fs"
import path from "path"
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib"
import { Embeddings } from "@langchain/core/embeddings"
import { Document } from "@langchain/core/documents"
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"
import { DATA_DIR, DRAFTS_DIR, SERVER_AI_CONFIG } from "./config.ts"
import type { AIConfig, SearchResult, ArticleScore } from "./types.ts"

// ── 本地向量模型默认配置 ───────────────────────────────────────────────────────
const LOCAL_EMBED_MODEL = "Xenova/multilingual-e5-small"

// ── 检索默认参数 ───────────────────────────────────────────────────────────────
const DEFAULT_SCORE_THRESHOLD = 0.72
const DEFAULT_TOP_K = 10
const KEYWORD_WEIGHT = 0.3

// ── 索引目录 ──────────────────────────────────────────────────────────────────

const INDEX_DIR = path.join(DATA_DIR, "rag_index")

function getUserIndexDir(userId?: string): string {
  return userId
    ? path.join(DATA_DIR, "rag_index_users", String(userId))
    : INDEX_DIR
}

function getUserDraftsDir(userId?: string): string {
  return userId
    ? path.join(DRAFTS_DIR, String(userId))
    : DRAFTS_DIR
}

// ── 索引元数据 ─────────────────────────────────────────────────────────────────

const META_FILE = "index_meta.json"

interface IndexMeta {
  embedKey?: string
  embedMode?: string
  model?: string
  dimensions?: number
  builtAt?: string
  chunks?: number
  docs?: number
}

function saveIndexMeta(indexDir: string, meta: IndexMeta): void {
  fs.writeFileSync(path.join(indexDir, META_FILE), JSON.stringify(meta, null, 2))
}

function loadIndexMeta(indexDir: string): IndexMeta | null {
  const p = path.join(indexDir, META_FILE)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) as IndexMeta } catch { return null }
}

function getEmbeddingKey(cfg: AIConfig): string {
  const apiKey = (cfg.embeddingApiKey || cfg.articleApiKey || cfg.coverApiKey || "") as string
  if (!apiKey) {
    const model = (cfg.localEmbeddingModel || LOCAL_EMBED_MODEL) as string
    return `local:${model}`
  }
  const model = (cfg.embeddingModel || "text-embedding-3-small") as string
  const dims = (cfg.embeddingDimensions || "native") as string
  return `remote:${model}:${dims}`
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ── 远端 Embedding ─────────────────────────────────────────────────────────────

interface RawEmbeddingsOptions {
  apiKey: string
  baseURL: string
  model: string
  dimensions?: number
  instruction?: string
  extraHeaders?: Record<string, string>
  batchSize?: number
  batchDelayMs?: number
}

class RawEmbeddings extends Embeddings {
  apiKey: string
  baseURL: string
  model: string
  dimensions: number | undefined
  instruction: string | undefined
  extraHeaders: Record<string, string>
  batchSize: number
  batchDelayMs: number
  _cacheKey?: string

  constructor({ apiKey, baseURL, model, dimensions, instruction, extraHeaders = {}, batchSize = 4, batchDelayMs = 1000 }: RawEmbeddingsOptions) {
    super({})
    this.apiKey = apiKey
    this.baseURL = baseURL.replace(/\/$/, "")
    this.model = model
    this.dimensions = dimensions
    this.instruction = instruction
    this.extraHeaders = extraHeaders
    this.batchSize = batchSize
    this.batchDelayMs = batchDelayMs
  }

  async embedQuery(text: string): Promise<number[]> { return this._embedWithRetry(text) }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = []
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize)
      const vecs = await Promise.all(batch.map((t) => this._embedWithRetry(t)))
      results.push(...vecs)
      if (i + this.batchSize < texts.length) {
        await sleep(this.batchDelayMs)
      }
    }
    return results
  }

  async _embedWithRetry(text: string, maxRetries = 3): Promise<number[]> {
    const RETRY_DELAYS = [500, 2000, 8000]
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._embed(text)
      } catch (e: unknown) {
        const err = e as Error
        const is429 = err.message?.startsWith("429")
        const is503 = err.message?.startsWith("503")
        if ((!is429 && !is503) || attempt === maxRetries) {
          if (is429) {
            throw new Error(
              `Embedding API 配额已用完（429 Too Many Requests）。\n请等待配额恢复后重试，或切换到「本地向量模型」。\n原始错误：${err.message}`
            )
          }
          throw e
        }
        const delay = RETRY_DELAYS[attempt]
        console.warn(`[RAG] Embedding 请求被限流（${err.message.slice(0, 80)}），${delay}ms 后重试（${attempt + 1}/${maxRetries}）...`)
        await sleep(delay)
      }
    }
    throw new Error("unreachable")
  }

  async _embed(text: string): Promise<number[]> {
    const body: Record<string, unknown> = { model: this.model, input: text }
    if (this.dimensions) body.dimensions = this.dimensions
    if (this.instruction) body.instruction = this.instruction

    const resp = await fetch(`${this.baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const err = await resp.text()
      throw new Error(`${resp.status} [${resp.statusText}] ${err}`)
    }

    const data = await resp.json() as { data?: Array<{ embedding: number[] }> }
    const vec = data?.data?.[0]?.embedding
    if (!Array.isArray(vec)) throw new Error("Embedding API 返回格式异常：" + JSON.stringify(data))
    return vec
  }
}

// ── 本地 Embedding ────────────────────────────────────────────────────────────

class LocalEmbeddings extends Embeddings {
  modelName: string
  _pipeline: unknown = null
  _dims: number | null = null

  constructor(modelName = LOCAL_EMBED_MODEL) {
    super({})
    this.modelName = modelName
  }

  async _getPipeline(): Promise<unknown> {
    if (!this._pipeline) {
      let pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>
      try {
        const mod = await import("@xenova/transformers") as { pipeline: typeof pipeline }
        pipeline = mod.pipeline
      } catch {
        throw new Error("本地向量模型依赖未安装。请在 web/ 目录执行：pnpm add @xenova/transformers")
      }
      console.log(`[RAG] 加载本地向量模型：${this.modelName}（首次运行需下载模型文件，请稍候…）`)
      try {
        this._pipeline = await pipeline("feature-extraction", this.modelName, { quantized: true })
      } catch (loadErr: unknown) {
        const err = loadErr as Error
        throw new Error(`本地向量模型加载失败：${err.message}`)
      }
      console.log(`[RAG] 本地向量模型加载完成：${this.modelName}`)
    }
    return this._pipeline
  }

  _wrapQuery(text: string): string {
    return this.modelName.toLowerCase().includes("e5") ? `query: ${text}` : text
  }
  _wrapPassage(text: string): string {
    return this.modelName.toLowerCase().includes("e5") ? `passage: ${text}` : text
  }

  async embedQuery(text: string): Promise<number[]> {
    const pipe = await this._getPipeline() as { (text: string, opts?: Record<string, unknown>): Promise<{ data: Float32Array }> }
    const output = await pipe(this._wrapQuery(text), { pooling: "mean", normalize: true })
    const vec = Array.from(output.data)
    if (!this._dims) this._dims = vec.length
    return vec
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const pipe = await this._getPipeline() as { (text: string, opts?: Record<string, unknown>): Promise<{ data: Float32Array }> }
    const results: number[][] = []
    for (const text of texts) {
      const output = await pipe(this._wrapPassage(text), { pooling: "mean", normalize: true })
      const vec = Array.from(output.data)
      if (!this._dims) this._dims = vec.length
      results.push(vec)
    }
    return results
  }
}

// ── Embeddings 实例缓存 ───────────────────────────────────────────────────────

let _embeddings: RawEmbeddings | null = null
let _localEmbeddings: LocalEmbeddings | null = null

function getLocalEmbeddings(cfg: AIConfig = {}): LocalEmbeddings {
  const localModel = (cfg.localEmbeddingModel || LOCAL_EMBED_MODEL) as string
  if (!_localEmbeddings || _localEmbeddings.modelName !== localModel) {
    _localEmbeddings = new LocalEmbeddings(localModel)
  }
  return _localEmbeddings
}

function getRemoteEmbeddings(cfg: AIConfig): RawEmbeddings | null {
  const apiKey = (cfg.embeddingApiKey || cfg.articleApiKey || cfg.coverApiKey || "") as string
  if (!apiKey) return null

  const baseURL = (cfg.embeddingBaseUrl || (
    cfg.articleBaseUrl && cfg.articleProvider !== "maas"
      ? cfg.articleBaseUrl
      : "https://api.openai.com/v1"
  )) as string
  const model = (cfg.embeddingModel || "text-embedding-3-small") as string
  const dimensions = cfg.embeddingDimensions as number | undefined
  const instruction = cfg.embeddingInstruction as string | undefined
  const batchSize = (cfg.embeddingBatchSize || 4) as number
  const batchDelayMs = (cfg.embeddingBatchDelayMs || 1000) as number

  let extraHeaders: Record<string, string> = {}
  if (cfg.embeddingExtraHeaders) {
    try {
      extraHeaders = typeof cfg.embeddingExtraHeaders === "string"
        ? JSON.parse(cfg.embeddingExtraHeaders) as Record<string, string>
        : cfg.embeddingExtraHeaders as Record<string, string>
    } catch { /* 忽略 */ }
  }

  const cacheKey = JSON.stringify({ apiKey, baseURL, model, dimensions, instruction, extraHeaders, batchSize, batchDelayMs })
  if (!_embeddings || _embeddings._cacheKey !== cacheKey) {
    _embeddings = new RawEmbeddings({ apiKey, baseURL, model, dimensions, instruction, extraHeaders, batchSize, batchDelayMs })
    _embeddings._cacheKey = cacheKey
  }
  return _embeddings
}

async function resolveEmbeddings(aiConfig: AIConfig = {}): Promise<{ embeddings: RawEmbeddings | LocalEmbeddings; mode: string; model: string }> {
  const cfg = { ...SERVER_AI_CONFIG as unknown as AIConfig, ...aiConfig }
  const remote = getRemoteEmbeddings(cfg)

  if (!remote) {
    const emb = getLocalEmbeddings(cfg)
    console.log(`[RAG] 未配置 Embedding API Key，使用本地模型: ${emb.modelName}`)
    return { embeddings: emb, mode: "local", model: emb.modelName }
  }

  try {
    await remote.embedQuery("向量化探测")
    const model = (cfg.embeddingModel || "text-embedding-3-small") as string
    const dims = cfg.embeddingDimensions
    console.log(`[RAG] 远端 Embedding 可用: ${model}${dims ? `（${dims}维）` : ""}`)
    return { embeddings: remote, mode: "remote", model }
  } catch (e: unknown) {
    const reason = (e as Error).message?.slice(0, 160) || String(e)
    console.warn(`[RAG] 远端 Embedding 不可用（${reason}）`)
    console.warn("[RAG] 自动切换到本地模型 fallback...")
    const emb = getLocalEmbeddings(cfg)
    return { embeddings: emb, mode: "local", model: emb.modelName }
  }
}

// ── 文本切割器 ────────────────────────────────────────────────────────────────

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 800,
  chunkOverlap: 120,
  separators: ["\n\n\n", "\n\n", "\n", "。", "！", "？", "；", "，", ""],
})

// ── 文本预处理 ─────────────────────────────────────────────────────────────────

function cleanText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => {
      if (/^[-=*_]{3,}$/.test(line.trim())) return false
      if (/^https?:\/\/\S+$/.test(line.trim())) return false
      return true
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// ── 扫描草稿目录 ───────────────────────────────────────────────────────────────

interface RawDoc {
  content: string
  metadata: {
    source: string
    dir: string
    type: "article" | "task" | "materials" | "task_sub"
  }
}

function collectDocs(userId?: string): RawDoc[] {
  const docs: RawDoc[] = []
  const draftsDir = getUserDraftsDir(userId)
  if (!fs.existsSync(draftsDir)) return docs

  const dirs = fs.readdirSync(draftsDir).filter((f) => /^\d{8}/.test(f))
  for (const dir of dirs) {
    const base = path.join(draftsDir, dir)
    const files = [
      { file: path.join(base, "raw", "article_raw.md"), type: "article" as const },
      { file: path.join(base, "prompt", "task.md"), type: "task" as const },
      { file: path.join(base, "prompt", "materials.md"), type: "materials" as const },
    ]
    for (const { file, type } of files) {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, "utf-8")
        const content = cleanText(raw)
        if (content.length > 50) {
          docs.push({ content, metadata: { source: file, dir, type } })
        }
      }
    }
    const promptDir = path.join(base, "prompt")
    if (fs.existsSync(promptDir)) {
      for (const f of fs.readdirSync(promptDir)) {
        const fp = path.join(promptDir, f)
        if (!fs.statSync(fp).isFile()) continue
        if (f === "task.md" || f === "materials.md") continue
        if (!f.endsWith(".md") && !f.endsWith(".txt")) continue
        const raw = fs.readFileSync(fp, "utf-8")
        const content = cleanText(raw)
        if (content.length > 50) {
          docs.push({ content, metadata: { source: fp, dir, type: "task_sub" } })
        }
      }
    }
    const rawDir = path.join(base, "raw")
    if (fs.existsSync(rawDir)) {
      for (const f of fs.readdirSync(rawDir)) {
        const fp = path.join(rawDir, f)
        if (!fs.statSync(fp).isFile()) continue
        if (f === "article_raw.md") continue
        if (!f.startsWith("article_raw") || !f.endsWith(".md")) continue
        const raw = fs.readFileSync(fp, "utf-8")
        const content = cleanText(raw)
        if (content.length > 50) {
          docs.push({ content, metadata: { source: fp, dir, type: "article" } })
        }
      }
    }
  }
  return docs
}

// ── 构建/更新索引 ─────────────────────────────────────────────────────────────

export async function buildIndex(aiConfig: AIConfig = {}, userId?: string) {
  const { embeddings, mode, model } = await resolveEmbeddings(aiConfig)

  const rawDocs = collectDocs(userId)
  if (rawDocs.length === 0) return { indexed: 0, chunks: 0 }

  const langchainDocs: Document[] = []
  for (const { content, metadata } of rawDocs) {
    const chunks = await splitter.splitText(content)
    for (const chunk of chunks) {
      langchainDocs.push(new Document({ pageContent: chunk, metadata }))
    }
  }

  const indexDir = getUserIndexDir(userId)
  fs.mkdirSync(indexDir, { recursive: true })
  const vectorStore = await HNSWLib.fromDocuments(langchainDocs, embeddings)
  await vectorStore.save(indexDir)

  saveChunkStore(indexDir, langchainDocs)

  let dims: number | string = "?"
  if (mode === "local" && (_localEmbeddings?._dims)) {
    dims = _localEmbeddings._dims
  } else {
    try {
      const sample = await embeddings.embedQuery("维度探测")
      dims = sample.length
    } catch { /* 忽略 */ }
  }

  const embedKey = mode === "local" ? `local:${model}` : getEmbeddingKey({ ...SERVER_AI_CONFIG as unknown as AIConfig, ...aiConfig })

  saveIndexMeta(indexDir, {
    embedKey,
    embedMode: mode,
    model,
    dimensions: typeof dims === "number" ? dims : undefined,
    builtAt: new Date().toISOString(),
    chunks: langchainDocs.length,
    docs: rawDocs.length,
  })

  console.log(`[RAG] 索引构建完成：${rawDocs.length} 篇 / ${langchainDocs.length} chunks / 维度 ${dims} / 模型 ${model}`)

  return { indexed: rawDocs.length, chunks: langchainDocs.length, dimensions: dims, model, embedMode: mode }
}

// ── 关键词全文检索 ─────────────────────────────────────────────────────────────

const CHUNK_STORE_FILE = "chunk_store.json"

interface ChunkStoreItem {
  content: string
  metadata: { source: string; dir: string; type: string }
}

function saveChunkStore(indexDir: string, docs: Document[]): void {
  const store: ChunkStoreItem[] = docs.map((doc) => ({
    content: doc.pageContent,
    metadata: doc.metadata as { source: string; dir: string; type: string },
  }))
  fs.writeFileSync(path.join(indexDir, CHUNK_STORE_FILE), JSON.stringify(store))
}

function loadChunkStore(indexDir: string): ChunkStoreItem[] {
  const p = path.join(indexDir, CHUNK_STORE_FILE)
  if (!fs.existsSync(p)) return []
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) as ChunkStoreItem[] } catch { return [] }
}

function keywordSearch(query: string, chunks: ChunkStoreItem[], topK: number): SearchResult[] {
  if (!chunks.length) return []

  const tokens = new Set([
    ...query.split(/\s+/).filter((t) => t.length > 1),
    ...Array.from({ length: query.length - 1 }, (_, i) => query.slice(i, i + 2)),
  ])

  const scored = chunks.map((chunk) => {
    const content = chunk.content.toLowerCase()
    let hits = 0
    for (const token of tokens) {
      if (content.includes(token.toLowerCase())) hits++
    }
    const score = hits / tokens.size
    return { chunk, score }
  })

  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 2)
    .map(({ chunk, score }) => ({
      content: chunk.content,
      source: chunk.metadata.source,
      type: chunk.metadata.type,
      dir: chunk.metadata.dir,
      // 初始 score 为 1，后续被关键词覆盖
      score: 0,
      kwScore: parseFloat(score.toFixed(4)),
    }))
}

// ── 混合检索 ───────────────────────────────────────────────────────────────────

interface VectorResult {
  content: string
  source: string
  type: string
  dir: string
  score: number
}

interface MergedResult {
  content: string
  source: string
  type: string
  dir: string
  score: number
  sim: number
  kwScore: number
  finalScore: number
}

function mergeResults(vectorResults: VectorResult[], kwResults: SearchResult[], threshold: number): MergedResult[] {
  const merged = new Map<string, MergedResult>()

  for (const r of vectorResults) {
    const key = r.content.slice(0, 100)
    const sim = 1 - r.score
    merged.set(key, {
      ...r,
      sim,
      kwScore: 0,
      finalScore: (1 - KEYWORD_WEIGHT) * sim,
    })
  }

  for (const r of kwResults) {
    const key = r.content.slice(0, 100)
    if (merged.has(key)) {
      const entry = merged.get(key)!
      entry.kwScore = r.kwScore ?? 0
      entry.finalScore = (1 - KEYWORD_WEIGHT) * entry.sim + KEYWORD_WEIGHT * (r.kwScore ?? 0)
    } else {
      merged.set(key, {
        ...r,
        score: 1,
        sim: 0,
        kwScore: r.kwScore ?? 0,
        finalScore: KEYWORD_WEIGHT * (r.kwScore ?? 0),
      })
    }
  }

  return Array.from(merged.values())
    .filter((r) => {
      if (r.sim > 0) return r.score < threshold
      return (r.kwScore ?? 0) > 0.2
    })
    .sort((a, b) => b.finalScore - a.finalScore)
}

// ── 检索相关文档 ──────────────────────────────────────────────────────────────

interface RetrieveOptions {
  topK?: number
  aiConfig?: AIConfig
  userId?: string
  scoreThreshold?: number
}

export async function retrieveRelevant(query: string, { topK = DEFAULT_TOP_K, aiConfig = {}, userId, scoreThreshold }: RetrieveOptions = {}): Promise<SearchResult[]> {
  const threshold = scoreThreshold ?? DEFAULT_SCORE_THRESHOLD
  const cfg = { ...SERVER_AI_CONFIG as unknown as AIConfig, ...aiConfig }
  const indexDir = getUserIndexDir(userId)

  if (!fs.existsSync(path.join(indexDir, "hnswlib.index"))) {
    return []
  }

  const meta = loadIndexMeta(indexDir)

  let embeddings: RawEmbeddings | LocalEmbeddings
  if (meta?.embedMode === "local") {
    const localModel = meta.model || LOCAL_EMBED_MODEL
    embeddings = _localEmbeddings?.modelName === localModel
      ? _localEmbeddings
      : new LocalEmbeddings(localModel)
  } else if (meta?.embedMode === "remote" && meta?.embedKey) {
    const currentKey = getEmbeddingKey(cfg)
    if (meta.embedKey !== currentKey) {
      console.warn(
        `[RAG] Embedding 配置已变更，索引需要重建。\n  旧: ${meta.embedKey}\n  新: ${currentKey}\n  请在知识库页面点击「重建索引」`
      )
      return []
    }
    embeddings = getRemoteEmbeddings(aiConfig) || getLocalEmbeddings(cfg)
  } else {
    const remote = getRemoteEmbeddings(cfg)
    if (remote) {
      embeddings = remote
      console.log("[RAG] 旧索引无 embedMode 记录，使用当前远端配置检索")
    } else {
      embeddings = getLocalEmbeddings(cfg)
      console.log("[RAG] 旧索引无 embedMode 记录，无 API Key，使用本地模型检索")
    }
  }

  try {
    const vectorStore = await HNSWLib.load(indexDir, embeddings)
    const vectorRaw = await vectorStore.similaritySearchWithScore(query, topK * 3)
    const vectorResults: VectorResult[] = vectorRaw.map(([doc, score]) => ({
      content: doc.pageContent,
      source: doc.metadata.source as string,
      type: doc.metadata.type as string,
      dir: doc.metadata.dir as string,
      score: parseFloat(score.toFixed(4)),
    }))

    const chunks = loadChunkStore(indexDir)
    const kwResults = keywordSearch(query, chunks, topK)

    const merged = mergeResults(vectorResults, kwResults, threshold)
    const results = merged.slice(0, topK)

    console.log(
      `[RAG] 检索完成 | query="${query.slice(0, 30)}" | 向量候选:${vectorResults.length} 关键词候选:${kwResults.length} 混合后:${merged.length} 返回:${results.length}`
    )

    return results.map((r) => ({
      content: r.content,
      source: r.source,
      type: r.type,
      dir: r.dir,
      score: r.score,
      sim: parseFloat(((r.sim || 0) * 100).toFixed(1)),
      kwScore: r.kwScore || 0,
      finalScore: parseFloat((r.finalScore * 100).toFixed(1)),
    }))
  } catch (e: unknown) {
    console.error("[RAG] 检索失败:", (e as Error).message)
    return []
  }
}

// ── 格式化为 prompt 片段 ───────────────────────────────────────────────────────

export function formatRetrievedContext(docs: SearchResult[]): string {
  if (!docs.length) return ""
  const typeLabel: Record<string, string> = {
    article: "往期文章",
    task: "任务参考",
    materials: "素材参考",
    task_sub: "任务参考",
  }
  const parts = docs.map((d, i) => {
    const label = typeLabel[d.type] || "参考"
    const simStr = d.sim != null ? `相似度 ${d.sim}%` : ""
    const meta = [label, `目录 ${d.dir}`, simStr].filter(Boolean).join(" · ")
    return `### 参考${i + 1}（${meta}）\n${d.content}`
  })
  return `# 往期相关内容参考（自动检索，仅供风格和结构参考）\n\n${parts.join("\n\n---\n\n")}`
}

// ── 评分示例注入 ───────────────────────────────────────────────────────────────

export async function formatExampleContext(userId: string, draftsDir?: string): Promise<string> {
  try {
    const { getExampleArticles } = await import("./db.ts")
    const { good, bad } = getExampleArticles(userId, { goodThreshold: 70, badThreshold: 30, maxEach: 2 }) as { good: ArticleScore[]; bad: ArticleScore[] }

    if (!good.length && !bad.length) return ""

    const parts: string[] = []

    function readArticleSnippet(articleId: string): string | null {
      const userDraftsDir = draftsDir || path.join(DATA_DIR, "drafts", String(userId))
      const candidates = [
        path.join(userDraftsDir, articleId, "raw", "article_raw.md"),
        path.join(userDraftsDir, articleId.substring(0, 8), "raw", "article_raw.md"),
      ]
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, "utf-8")
          const cleaned = cleanText(raw)
          return cleaned.slice(0, 600)
        }
      }
      return null
    }

    if (good.length) {
      const goodParts: string[] = []
      for (const s of good) {
        const snippet = readArticleSnippet(s.articleId)
        if (!snippet) continue
        const meta = [
          s.platform === "wechat" ? "公众号" : "今日头条",
          s.views != null ? `浏览 ${s.views}` : null,
          s.likes != null ? `点赞 ${s.likes}` : null,
          s.shares != null ? `转发 ${s.shares}` : null,
          `综合评分 ${s.composite}`,
        ].filter(Boolean).join(" · ")
        goodParts.push(`#### 优秀示例：${s.title}（${meta}）\n${snippet}`)
      }
      if (goodParts.length) {
        parts.push(`### 高表现文章（请参考其写作风格、结构和表达方式）\n\n${goodParts.join("\n\n")}`)
      }
    }

    if (bad.length) {
      const badParts: string[] = []
      for (const s of bad) {
        const snippet = readArticleSnippet(s.articleId)
        if (!snippet) continue
        const meta = [
          s.platform === "wechat" ? "公众号" : "今日头条",
          s.views != null ? `浏览 ${s.views}` : null,
          s.likes != null ? `点赞 ${s.likes}` : null,
          s.shares != null ? `转发 ${s.shares}` : null,
          `综合评分 ${s.composite}`,
        ].filter(Boolean).join(" · ")
        badParts.push(`#### 低表现示例：${s.title}（${meta}）\n${snippet}`)
      }
      if (badParts.length) {
        parts.push(`### 低表现文章（请避免其写作风格和结构问题）\n\n${badParts.join("\n\n")}`)
      }
    }

    if (!parts.length) return ""

    return `# 历史文章表现参考（基于真实数据，请学习优秀示例、规避低表现模式）\n\n${parts.join("\n\n---\n\n")}`
  } catch (e: unknown) {
    console.warn("[RAG] formatExampleContext 失败:", (e as Error).message)
    return ""
  }
}

// ── 索引状态 ──────────────────────────────────────────────────────────────────

export function getIndexStatus(userId?: string) {
  const indexDir = getUserIndexDir(userId)
  const indexFile = path.join(indexDir, "hnswlib.index")
  if (!fs.existsSync(indexFile)) return { indexed: false, size: 0 }

  const stat = fs.statSync(indexFile)
  const meta = loadIndexMeta(indexDir)

  const hasChunkStore = fs.existsSync(path.join(indexDir, CHUNK_STORE_FILE))

  return {
    indexed: true,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    indexDir,
    embedMode: meta?.embedMode || null,
    model: meta?.model || null,
    dimensions: meta?.dimensions ?? null,
    chunks: meta?.chunks ?? null,
    docs: meta?.docs ?? null,
    embedKey: meta?.embedKey || null,
    needsRebuild: !meta,
    hybridSearch: hasChunkStore,
    scoreThreshold: DEFAULT_SCORE_THRESHOLD,
    keywordWeight: KEYWORD_WEIGHT,
  }
}