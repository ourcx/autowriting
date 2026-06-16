/**
 * RAG 模块：向量索引 + 混合检索（向量 + 关键词）
 *
 * 优化策略（参考 RAG 工程质量框架）：
 *   1. 文本切分：更大 chunkSize（800）+ 更合理重叠（120），优化分隔符顺序
 *   2. 文本预处理：入库前清洗噪声字符、过短段落、重复空行
 *   3. 混合检索：向量相似度 + BM25 关键词检索，两路合并去重后排序
 *   4. Score 阈值：可配置，默认 0.72（更严格），支持动态调整
 *   5. 文档覆盖：collectDocs 同时收录 .txt / .md / .json 格式
 *   6. 上下文格式：携带相似度、文件类型、来源目录，方便排查
 *
 * Embedding 策略：
 *   - 优先使用 OpenAI / MaaS 兼容 embedding 接口（text-embedding-3-small，1536维）
 *   - 无 API Key 时自动 fallback 到本地模型 @xenova/transformers
 *     默认: Xenova/multilingual-e5-small（384维，支持中文，首次需下载约 500MB）
 *   - 用 HNSWLib 在本地磁盘持久化向量库（DATA_DIR/rag_index/）
 *   - 索引旁存 meta.json 记录维度+模型，切换 embedding 时提示重建
 */
import fs from 'fs'
import path from 'path'
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib'
import { Embeddings } from '@langchain/core/embeddings'
import { Document } from '@langchain/core/documents'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { DATA_DIR, DRAFTS_DIR, SERVER_AI_CONFIG } from './config.js'

// ── 本地向量模型默认配置 ───────────────────────────────────────────────────────
// multilingual-e5-small: 384维，支持中文，首次下载约 500MB，速度适中
// 需要更高质量可改为 Xenova/multilingual-e5-large（1024维，约 1.2GB）
const LOCAL_EMBED_MODEL = 'Xenova/multilingual-e5-small'

// ── 检索默认参数 ───────────────────────────────────────────────────────────────
// 可通过 retrieveRelevant 的 options 覆盖
const DEFAULT_SCORE_THRESHOLD = 0.72  // 相似度阈值：越低越严格（距离值，< 阈值才保留）
const DEFAULT_TOP_K           = 5     // 默认召回 chunk 数
const KEYWORD_WEIGHT          = 0.3   // 关键词分数在混合排序中的权重（0～1）

// ── 索引目录 ──────────────────────────────────────────────────────────────────

const INDEX_DIR = path.join(DATA_DIR, 'rag_index')

function getUserIndexDir(userId) {
  return userId
    ? path.join(DATA_DIR, 'rag_index_users', String(userId))
    : INDEX_DIR
}

function getUserDraftsDir(userId) {
  return userId
    ? path.join(DRAFTS_DIR, String(userId))
    : DRAFTS_DIR
}

// ── 索引元数据（meta.json） ───────────────────────────────────────────────────
// 记录建索引时的 embedKey + 维度，load 时比对，不匹配则提示重建

const META_FILE = 'index_meta.json'

function saveIndexMeta(indexDir, meta) {
  fs.writeFileSync(path.join(indexDir, META_FILE), JSON.stringify(meta, null, 2))
}

function loadIndexMeta(indexDir) {
  const p = path.join(indexDir, META_FILE)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
}

// 生成当前 embedding 配置的唯一标识（用于比对是否需要重建索引）
function getEmbeddingKey(cfg) {
  const apiKey = cfg.embeddingApiKey || cfg.articleApiKey || cfg.coverApiKey || ''
  if (!apiKey) {
    const model = cfg.localEmbeddingModel || LOCAL_EMBED_MODEL
    return `local:${model}`
  }
  const model = cfg.embeddingModel || 'text-embedding-3-small'
  const dims   = cfg.embeddingDimensions || 'native'
  return `remote:${model}:${dims}`
}

// ── 远端 Embedding（直接 fetch，不依赖 LangChain OpenAI 封装）─────────────────

class RawEmbeddings extends Embeddings {
  constructor({ apiKey, baseURL, model, dimensions, instruction, extraHeaders = {} }) {
    super({})
    this.apiKey       = apiKey
    this.baseURL      = baseURL.replace(/\/$/, '')
    this.model        = model
    this.dimensions   = dimensions
    this.instruction  = instruction
    this.extraHeaders = extraHeaders
  }

  async embedQuery(text) { return this._embed(text) }

  async embedDocuments(texts) {
    const BATCH = 64
    const results = []
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH)
      const vecs  = await Promise.all(batch.map(t => this._embed(t)))
      results.push(...vecs)
    }
    return results
  }

  async _embed(text) {
    const body = { model: this.model, input: text }
    if (this.dimensions)  body.dimensions  = this.dimensions
    if (this.instruction) body.instruction = this.instruction

    const resp = await fetch(`${this.baseURL}/embeddings`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const err = await resp.text()
      throw new Error(`${resp.status} [${resp.statusText}] ${err}`)
    }

    const data = await resp.json()
    const vec  = data?.data?.[0]?.embedding
    if (!Array.isArray(vec)) throw new Error('Embedding API 返回格式异常：' + JSON.stringify(data))
    return vec
  }
}

// ── 本地 Embedding（@xenova/transformers，无需 API Key） ─────────────────────
// 使用 multilingual-e5-small（384维）或配置指定的模型
// e5 系列模型需要在 query/passage 前加前缀以获得最佳效果

class LocalEmbeddings extends Embeddings {
  constructor(modelName = LOCAL_EMBED_MODEL) {
    super({})
    this.modelName = modelName
    this._pipeline = null
    this._dims     = null  // 实际维度（首次推理后记录）
  }

  async _getPipeline() {
    if (!this._pipeline) {
      let pipeline
      try {
        ;({ pipeline } = await import('@xenova/transformers'))
      } catch {
        throw new Error(
          '本地向量模型需要安装依赖，请在 web/ 目录执行：npm install @xenova/transformers'
        )
      }
      console.log(`[RAG] 加载本地向量模型：${this.modelName}（首次运行需下载模型文件，请稍候…）`)
      this._pipeline = await pipeline('feature-extraction', this.modelName, {
        quantized: true,   // 量化版本，体积更小、速度更快，精度略有损失
      })
      console.log(`[RAG] 本地向量模型加载完成`)
    }
    return this._pipeline
  }

  /** 给 e5 系列模型加 "query: " 前缀，其他模型不加 */
  _wrapQuery(text) {
    return this.modelName.toLowerCase().includes('e5') ? `query: ${text}` : text
  }
  _wrapPassage(text) {
    return this.modelName.toLowerCase().includes('e5') ? `passage: ${text}` : text
  }

  async embedQuery(text) {
    const pipe   = await this._getPipeline()
    const output = await pipe(this._wrapQuery(text), { pooling: 'mean', normalize: true })
    const vec = Array.from(output.data)
    if (!this._dims) this._dims = vec.length
    return vec
  }

  async embedDocuments(texts) {
    const pipe = await this._getPipeline()
    const results = []
    for (const text of texts) {
      const output = await pipe(this._wrapPassage(text), { pooling: 'mean', normalize: true })
      const vec = Array.from(output.data)
      if (!this._dims) this._dims = vec.length
      results.push(vec)
    }
    return results
  }
}

// ── Embeddings 实例缓存 ───────────────────────────────────────────────────────

let _embeddings      = null  // 远端
let _localEmbeddings = null  // 本地

function getLocalEmbeddings(cfg = {}) {
  const localModel = cfg.localEmbeddingModel || LOCAL_EMBED_MODEL
  if (!_localEmbeddings || _localEmbeddings.modelName !== localModel) {
    _localEmbeddings = new LocalEmbeddings(localModel)
  }
  return _localEmbeddings
}

/**
 * 返回远端 Embeddings 实例（不探测，纯构造）。
 * 若无 API Key，直接返回 null（调用方负责切本地）。
 */
function getRemoteEmbeddings(cfg) {
  const apiKey = cfg.embeddingApiKey || cfg.articleApiKey || cfg.coverApiKey || ''
  if (!apiKey) return null

  const baseURL    = cfg.embeddingBaseUrl || (
    cfg.articleBaseUrl && cfg.articleProvider !== 'maas'
      ? cfg.articleBaseUrl
      : 'https://api.openai.com/v1'
  )
  const model      = cfg.embeddingModel       || 'text-embedding-3-small'
  const dimensions = cfg.embeddingDimensions  || undefined
  const instruction= cfg.embeddingInstruction || undefined

  let extraHeaders = {}
  if (cfg.embeddingExtraHeaders) {
    try {
      extraHeaders = typeof cfg.embeddingExtraHeaders === 'string'
        ? JSON.parse(cfg.embeddingExtraHeaders)
        : cfg.embeddingExtraHeaders
    } catch { /* 忽略 */ }
  }

  const cacheKey = JSON.stringify({ apiKey, baseURL, model, dimensions, instruction, extraHeaders })
  if (!_embeddings || _embeddings._cacheKey !== cacheKey) {
    _embeddings = new RawEmbeddings({ apiKey, baseURL, model, dimensions, instruction, extraHeaders })
    _embeddings._cacheKey = cacheKey
  }
  return _embeddings
}

/**
 * 探测远端 embedding，失败自动降级本地。
 * - 无 API Key → 直接本地
 * - 有 API Key 但调用失败（401 / 网络等）→ 打印警告，切本地
 * 返回: { embeddings, mode: 'remote'|'local', model }
 */
async function resolveEmbeddings(aiConfig = {}) {
  const cfg = { ...SERVER_AI_CONFIG, ...aiConfig }
  const remote = getRemoteEmbeddings(cfg)

  if (!remote) {
    // 无 Key，直接本地
    const emb = getLocalEmbeddings(cfg)
    console.log(`[RAG] 未配置 Embedding API Key，使用本地模型: ${emb.modelName}`)
    return { embeddings: emb, mode: 'local', model: emb.modelName }
  }

  // 有 Key → 先探测一次，确认可用
  try {
    await remote.embedQuery('向量化探测')
    const model = cfg.embeddingModel || 'text-embedding-3-small'
    const dims  = cfg.embeddingDimensions
    console.log(`[RAG] 远端 Embedding 可用: ${model}${dims ? `（${dims}维）` : ''}`)
    return { embeddings: remote, mode: 'remote', model }
  } catch (e) {
    const reason = e.message?.slice(0, 160) || String(e)
    console.warn(`[RAG] 远端 Embedding 不可用（${reason}）`)
    console.warn(`[RAG] 自动切换到本地模型 fallback，首次运行需下载模型文件（约 500MB），请耐心等待…`)
    const emb = getLocalEmbeddings(cfg)
    return { embeddings: emb, mode: 'local', model: emb.modelName }
  }
}

// 兼容旧调用（retrieveRelevant 内部用，不探测）
function getEmbeddings(aiConfig = {}) {
  const cfg    = { ...SERVER_AI_CONFIG, ...aiConfig }
  const remote = getRemoteEmbeddings(cfg)
  if (!remote) return getLocalEmbeddings(cfg)
  return remote
}

// ── 文本切割器 ────────────────────────────────────────────────────────────────
// 优化：增大 chunkSize 到 800（语义更完整），overlap 增到 120（避免边界截断）
// separators 顺序：优先按段落/句子切，最后才按字符强切

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize:    800,
  chunkOverlap: 120,
  separators: ['\n\n\n', '\n\n', '\n', '。', '！', '？', '；', '，', ''],
})

// ── 文本预处理：清洗噪声，提高入库质量 ───────────────────────────────────────

/**
 * 对原始文本做清洗：
 * - 去掉连续多空行（超过 2 个换行压缩为 2 个）
 * - 去掉行首行尾多余空白
 * - 过滤掉 URL-only 行、分隔符行（---、===、***）
 * - 去掉 Markdown 代码块标记行（```）——保留代码内容，只去标记
 */
function cleanText(text) {
  return text
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => {
      // 过滤纯分隔符行
      if (/^[-=*_]{3,}$/.test(line.trim())) return false
      // 过滤纯 URL 行
      if (/^https?:\/\/\S+$/.test(line.trim())) return false
      return true
    })
    .join('\n')
    // 压缩超过 2 个连续换行
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── 扫描草稿目录，收集所有文档 ────────────────────────────────────────────────
// 优化：新增支持 .txt 格式文件（如素材纯文本）

function collectDocs(userId) {
  const docs = []
  const draftsDir = getUserDraftsDir(userId)
  if (!fs.existsSync(draftsDir)) return docs

  const dirs = fs.readdirSync(draftsDir).filter(f => /^\d{8}/.test(f))
  for (const dir of dirs) {
    const base = path.join(draftsDir, dir)
    const files = [
      { file: path.join(base, 'raw', 'article_raw.md'), type: 'article' },
      { file: path.join(base, 'prompt', 'task.md'),     type: 'task' },
      { file: path.join(base, 'prompt', 'materials.md'),type: 'materials' },
    ]
    for (const { file, type } of files) {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf-8')
        const content = cleanText(raw)
        if (content.length > 50) {
          docs.push({ content, metadata: { source: file, dir, type } })
        }
      }
    }
    // 子目录格式：YYYYMMDD 下还有多个 task*.md 和 *.txt
    const promptDir = path.join(base, 'prompt')
    if (fs.existsSync(promptDir)) {
      for (const f of fs.readdirSync(promptDir)) {
        const fp = path.join(promptDir, f)
        if (!fs.statSync(fp).isFile()) continue
        // 跳过已处理的主文件
        if (f === 'task.md' || f === 'materials.md') continue
        // 支持 .md 和 .txt 格式
        if (!f.endsWith('.md') && !f.endsWith('.txt')) continue
        const raw = fs.readFileSync(fp, 'utf-8')
        const content = cleanText(raw)
        if (content.length > 50) {
          docs.push({ content, metadata: { source: fp, dir, type: 'task_sub' } })
        }
      }
    }
    // raw 目录下的 article_raw*.md（带后缀变体）
    const rawDir = path.join(base, 'raw')
    if (fs.existsSync(rawDir)) {
      for (const f of fs.readdirSync(rawDir)) {
        const fp = path.join(rawDir, f)
        if (!fs.statSync(fp).isFile()) continue
        // 跳过已处理的主文件
        if (f === 'article_raw.md') continue
        if (!f.startsWith('article_raw') || !f.endsWith('.md')) continue
        const raw = fs.readFileSync(fp, 'utf-8')
        const content = cleanText(raw)
        if (content.length > 50) {
          docs.push({ content, metadata: { source: fp, dir, type: 'article' } })
        }
      }
    }
  }
  return docs
}

// ── 构建/更新索引 ─────────────────────────────────────────────────────────────

export async function buildIndex(aiConfig = {}, userId) {
  // resolveEmbeddings 会先探测远端，失败自动降级本地，整个 build 用同一个实例
  const { embeddings, mode, model } = await resolveEmbeddings(aiConfig)

  const rawDocs = collectDocs(userId)
  if (rawDocs.length === 0) return { indexed: 0, chunks: 0 }

  const langchainDocs = []
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

  // 同时持久化文本块，用于关键词检索
  saveChunkStore(indexDir, langchainDocs)

  // 实际维度：本地模型建完后可以从实例读；远端调一次
  let dims = '?'
  if (mode === 'local' && embeddings._dims) {
    dims = embeddings._dims
  } else {
    try {
      const sample = await embeddings.embedQuery('维度探测')
      dims = sample.length
    } catch { /* 忽略 */ }
  }

  // embedKey 用实际使用的 mode 而非当前配置（可能已 fallback 到本地）
  const embedKey = mode === 'local' ? `local:${model}` : getEmbeddingKey({ ...SERVER_AI_CONFIG, ...aiConfig })

  saveIndexMeta(indexDir, {
    embedKey,
    embedMode:  mode,
    model,
    dimensions: dims,
    builtAt:    new Date().toISOString(),
    chunks:     langchainDocs.length,
    docs:       rawDocs.length,
  })

  console.log(`[RAG] 索引构建完成：${rawDocs.length} 篇 / ${langchainDocs.length} chunks / 维度 ${dims} / 模型 ${model}`)

  return { indexed: rawDocs.length, chunks: langchainDocs.length, dimensions: dims, model, embedMode: mode }
}

// ── 关键词全文检索（BM25-like 简化实现）────────────────────────────────────────
// 持久化文本块到 JSON，支持离线关键词检索

const CHUNK_STORE_FILE = 'chunk_store.json'

function saveChunkStore(indexDir, docs) {
  const store = docs.map(doc => ({
    content:  doc.pageContent,
    metadata: doc.metadata,
  }))
  fs.writeFileSync(path.join(indexDir, CHUNK_STORE_FILE), JSON.stringify(store))
}

function loadChunkStore(indexDir) {
  const p = path.join(indexDir, CHUNK_STORE_FILE)
  if (!fs.existsSync(p)) return []
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return [] }
}

/**
 * 简单关键词检索：对 query 分词后，计算每个 chunk 的词命中率
 * 返回结果按命中率降序，格式与向量检索结果保持一致
 */
function keywordSearch(query, chunks, topK) {
  if (!chunks.length) return []

  // 中文分词：按字符 n-gram (2-gram) + 空格分词
  const tokens = new Set([
    ...query.split(/\s+/).filter(t => t.length > 1),
    ...Array.from({ length: query.length - 1 }, (_, i) => query.slice(i, i + 2)),
  ])

  const scored = chunks.map(chunk => {
    const content = chunk.content.toLowerCase()
    let hits = 0
    for (const token of tokens) {
      if (content.includes(token.toLowerCase())) hits++
    }
    const score = hits / tokens.size  // 命中率 0～1
    return { chunk, score }
  })

  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK * 2)  // 取双倍，后续合并
    .map(({ chunk, score }) => ({
      content:  chunk.content,
      source:   chunk.metadata.source,
      type:     chunk.metadata.type,
      dir:      chunk.metadata.dir,
      kwScore:  parseFloat(score.toFixed(4)),  // 关键词命中率（越高越相关）
    }))
}

// ── 混合检索：向量 + 关键词，合并去重后排序 ───────────────────────────────────

/**
 * 归一化混合分数：
 *   向量 score（距离，越小越好） → 转换为相似度 sim = 1 - score
 *   关键词 kwScore（命中率，越大越好）
 *   最终分数 = (1 - KEYWORD_WEIGHT) * sim + KEYWORD_WEIGHT * kwScore
 *   分数越高越相关
 */
function mergeResults(vectorResults, kwResults, threshold) {
  // vectorResults: [{ content, source, type, dir, score }]  score=距离
  // kwResults:     [{ content, source, type, dir, kwScore }] kwScore=命中率

  const merged = new Map()  // key = content 前 100 字符（去重）

  for (const r of vectorResults) {
    const key = r.content.slice(0, 100)
    const sim = 1 - r.score  // 转为相似度
    merged.set(key, {
      ...r,
      sim,
      kwScore: 0,
      // 混合分：向量占主导
      finalScore: (1 - KEYWORD_WEIGHT) * sim,
    })
  }

  for (const r of kwResults) {
    const key = r.content.slice(0, 100)
    if (merged.has(key)) {
      // 已有向量结果，叠加关键词分
      const entry = merged.get(key)
      entry.kwScore   = r.kwScore
      entry.finalScore = (1 - KEYWORD_WEIGHT) * entry.sim + KEYWORD_WEIGHT * r.kwScore
    } else {
      // 只有关键词命中，无向量结果（向量 sim 设为 0）
      merged.set(key, {
        ...r,
        sim: 0,
        score: 1,  // 距离设为最大
        finalScore: KEYWORD_WEIGHT * r.kwScore,
      })
    }
  }

  return Array.from(merged.values())
    .filter(r => {
      // 向量阈值过滤：有向量结果时，距离必须 < threshold；纯关键词结果放行
      if (r.sim > 0) return r.score < threshold
      return r.kwScore > 0.2  // 纯关键词命中率至少 20%
    })
    .sort((a, b) => b.finalScore - a.finalScore)
}

// ── 检索相关文档 ──────────────────────────────────────────────────────────────

export async function retrieveRelevant(query, { topK = DEFAULT_TOP_K, aiConfig = {}, userId, scoreThreshold } = {}) {
  const threshold = scoreThreshold ?? DEFAULT_SCORE_THRESHOLD
  const cfg       = { ...SERVER_AI_CONFIG, ...aiConfig }
  const indexDir  = getUserIndexDir(userId)

  if (!fs.existsSync(path.join(indexDir, 'hnswlib.index'))) {
    return []  // 未索引，静默返回空
  }

  const meta = loadIndexMeta(indexDir)

  // ── 根据索引元数据决定用哪个 embeddings 实例 ─────────────────────────────
  // 如果索引是本地模型建的，直接用本地（不再走远端，避免 401）
  // 如果索引是远端建的，检查当前配置是否一致
  let embeddings
  if (meta?.embedMode === 'local') {
    const localModel = meta.model || LOCAL_EMBED_MODEL
    embeddings = _localEmbeddings?.modelName === localModel
      ? _localEmbeddings
      : new LocalEmbeddings(localModel)
  } else {
    const currentKey = getEmbeddingKey(cfg)
    if (meta && meta.embedKey && meta.embedKey !== currentKey) {
      console.warn(
        `[RAG] Embedding 配置已变更，索引需要重建。\n` +
        `  旧: ${meta.embedKey}（${meta.dimensions}维）\n` +
        `  新: ${currentKey}\n` +
        `  请在知识库页面点击「重建索引」`
      )
      return []
    }
    embeddings = getEmbeddings(aiConfig)
  }

  try {
    // ── 向量检索（取更多候选，混合后再截取 topK） ────────────────────────────
    const vectorStore = await HNSWLib.load(indexDir, embeddings)
    const vectorRaw   = await vectorStore.similaritySearchWithScore(query, topK * 3)
    const vectorResults = vectorRaw.map(([doc, score]) => ({
      content: doc.pageContent,
      source:  doc.metadata.source,
      type:    doc.metadata.type,
      dir:     doc.metadata.dir,
      score:   parseFloat(score.toFixed(4)),
    }))

    // ── 关键词检索 ─────────────────────────────────────────────────────────
    const chunks    = loadChunkStore(indexDir)
    const kwResults = keywordSearch(query, chunks, topK)

    // ── 混合合并 ──────────────────────────────────────────────────────────
    const merged = mergeResults(vectorResults, kwResults, threshold)
    const results = merged.slice(0, topK)

    console.log(
      `[RAG] 检索完成 | query="${query.slice(0, 30)}" | 向量候选:${vectorResults.length} ` +
      `关键词候选:${kwResults.length} 混合后:${merged.length} 返回:${results.length}`
    )

    return results.map(r => ({
      content:    r.content,
      source:     r.source,
      type:       r.type,
      dir:        r.dir,
      score:      r.score,
      sim:        parseFloat(((r.sim || 0) * 100).toFixed(1)),  // 相似度百分比
      kwScore:    r.kwScore || 0,
      finalScore: parseFloat((r.finalScore * 100).toFixed(1)),  // 综合得分百分比
    }))
  } catch (e) {
    console.error('[RAG] 检索失败:', e.message)
    return []
  }
}

// ── 将检索结果格式化为 prompt 片段 ───────────────────────────────────────────
// 优化：加入相似度百分比和文档类型标注，方便模型判断可信度

export function formatRetrievedContext(docs) {
  if (!docs.length) return ''
  const typeLabel = {
    article:  '往期文章',
    task:     '任务参考',
    materials:'素材参考',
    task_sub: '任务参考',
  }
  const parts = docs.map((d, i) => {
    const label = typeLabel[d.type] || '参考'
    const simStr = d.sim != null ? `相似度 ${d.sim}%` : ''
    const meta = [label, `目录 ${d.dir}`, simStr].filter(Boolean).join(' · ')
    return `### 参考${i + 1}（${meta}）\n${d.content}`
  })
  return `# 往期相关内容参考（自动检索，仅供风格和结构参考）\n\n${parts.join('\n\n---\n\n')}`
}

// ── 索引状态 ──────────────────────────────────────────────────────────────────

export function getIndexStatus(userId) {
  const indexDir  = getUserIndexDir(userId)
  const indexFile = path.join(indexDir, 'hnswlib.index')
  if (!fs.existsSync(indexFile)) return { indexed: false, size: 0 }

  const stat = fs.statSync(indexFile)
  const meta = loadIndexMeta(indexDir)

  // 检查是否有关键词索引
  const hasChunkStore = fs.existsSync(path.join(indexDir, CHUNK_STORE_FILE))

  return {
    indexed:       true,
    size:          stat.size,
    updatedAt:     stat.mtime.toISOString(),
    indexDir,
    // embedding 相关信息
    embedMode:     meta?.embedMode  || 'unknown',
    model:         meta?.model      || 'unknown',
    dimensions:    meta?.dimensions || '?',
    chunks:        meta?.chunks     || '?',
    docs:          meta?.docs       || '?',
    embedKey:      meta?.embedKey   || null,
    // 混合检索能力
    hybridSearch:  hasChunkStore,
    // 检索参数（当前默认值）
    scoreThreshold: DEFAULT_SCORE_THRESHOLD,
    keywordWeight:  KEYWORD_WEIGHT,
  }
}
