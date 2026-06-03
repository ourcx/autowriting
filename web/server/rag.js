/**
 * RAG 模块：向量索引 + 相似检索
 *
 * 策略：
 *   - 优先使用 OpenAI / MaaS 兼容 embedding 接口做向量化（text-embedding-3-small，1536维）
 *   - 无 API Key 时自动 fallback 到本地模型 @xenova/transformers
 *     默认: Xenova/multilingual-e5-large（1024维，支持中文，首次需下载约 1.2GB）
 *     可在配置中设置 localEmbeddingModel 切换其他模型
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
// 使用 multilingual-e5-large（1024维）或配置指定的模型
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
// 600 字符 / 80 重叠，中文每段约 600 字，保留更完整的语义单元

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize:    600,
  chunkOverlap: 80,
  separators: ['\n\n', '\n', '。', '！', '？', '，', ''],
})

// ── 扫描草稿目录，收集所有文档 ────────────────────────────────────────────────

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
        const content = fs.readFileSync(file, 'utf-8').trim()
        if (content.length > 50) {
          docs.push({ content, metadata: { source: file, dir, type } })
        }
      }
    }
    // 子目录格式：YYYYMMDD 下还有多个 task*.md
    const promptDir = path.join(base, 'prompt')
    if (fs.existsSync(promptDir)) {
      for (const f of fs.readdirSync(promptDir)) {
        const fp = path.join(promptDir, f)
        if (f !== 'task.md' && f !== 'materials.md' && fs.statSync(fp).isFile()) {
          const content = fs.readFileSync(fp, 'utf-8').trim()
          if (content.length > 50) {
            docs.push({ content, metadata: { source: fp, dir, type: 'task_sub' } })
          }
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

// ── 检索相关文档 ──────────────────────────────────────────────────────────────

export async function retrieveRelevant(query, { topK = 5, aiConfig = {}, userId } = {}) {
  const cfg      = { ...SERVER_AI_CONFIG, ...aiConfig }
  const indexDir = getUserIndexDir(userId)

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
    const vectorStore = await HNSWLib.load(indexDir, embeddings)
    const results = await vectorStore.similaritySearchWithScore(query, topK)
    return results
      .filter(([, score]) => score < 0.75)
      .map(([doc, score]) => ({
        content: doc.pageContent,
        source:  doc.metadata.source,
        type:    doc.metadata.type,
        dir:     doc.metadata.dir,
        score:   parseFloat(score.toFixed(4)),
      }))
  } catch (e) {
    console.error('[RAG] 检索失败:', e.message)
    return []
  }
}

// ── 将检索结果格式化为 prompt 片段 ───────────────────────────────────────────

export function formatRetrievedContext(docs) {
  if (!docs.length) return ''
  const parts = docs.map((d, i) => {
    const typeLabel = { article: '往期文章', task: '任务参考', materials: '素材参考', task_sub: '任务参考' }[d.type] || '参考'
    return `### 参考${i + 1}（${typeLabel} · 目录 ${d.dir}）\n${d.content}`
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

  return {
    indexed:    true,
    size:       stat.size,
    updatedAt:  stat.mtime.toISOString(),
    indexDir,
    // embedding 相关信息
    embedMode:  meta?.embedMode  || 'unknown',
    model:      meta?.model      || 'unknown',
    dimensions: meta?.dimensions || '?',
    chunks:     meta?.chunks     || '?',
    docs:       meta?.docs       || '?',
    embedKey:   meta?.embedKey   || null,
  }
}
