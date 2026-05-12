/**
 * RAG 模块：向量索引 + 相似检索
 *
 * 策略：
 *   - 用 OpenAI text-embedding-3-small 或 MaaS 兼容 embedding 接口做向量化
 *   - 用 HNSWLib 在本地磁盘持久化向量库（DATA_DIR/rag_index/）
 *   - 扫描 DRAFTS_DIR 下所有 article_raw.md + materials.md，切成 chunk 写入
 *   - 生成文章时，用任务描述检索 top-k 相关片段作为上下文
 */
import fs from 'fs'
import path from 'path'
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib'
import { Embeddings } from '@langchain/core/embeddings'
import { Document } from '@langchain/core/documents'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { DATA_DIR, DRAFTS_DIR, SERVER_AI_CONFIG } from './config.js'

// 全局共享索引（无 userId 时的回落）
const INDEX_DIR = path.join(DATA_DIR, 'rag_index')

// 按用户隔离的索引目录
function getUserIndexDir(userId) {
  return userId
    ? path.join(DATA_DIR, 'rag_index_users', String(userId))
    : INDEX_DIR
}

// 按用户隔离的草稿目录
function getUserDraftsDir(userId) {
  return userId
    ? path.join(DRAFTS_DIR, String(userId))
    : DRAFTS_DIR
}

// ── 自定义 Embeddings 类（直接 fetch，不依赖 LangChain OpenAI 封装）─────────
// 好处：
//   1. 不会自动附加 encoding_format:'float'（部分服务商不支持）
//   2. 支持 dimensions / instruction 等扩展参数
//   3. 支持任意自定义 Header（如 X-Failover-Enabled）

class RawEmbeddings extends Embeddings {
  constructor({ apiKey, baseURL, model, dimensions, instruction, extraHeaders = {} }) {
    super({})
    this.apiKey       = apiKey
    this.baseURL      = baseURL.replace(/\/$/, '')
    this.model        = model
    this.dimensions   = dimensions   // 可选，number
    this.instruction  = instruction  // 可选，string
    this.extraHeaders = extraHeaders // 可选，object
  }

  /** 单条文本向量化 */
  async embedQuery(text) {
    return this._embed(text)
  }

  /** 批量向量化（每批最多 64 条，避免超长） */
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

// ── Embeddings 实例（懒加载，配置变化时重建） ─────────────────────────────────

let _embeddings = null
function getEmbeddings(aiConfig = {}) {
  const cfg = { ...SERVER_AI_CONFIG, ...aiConfig }

  // embedding 专用配置优先，其次回落到文章生成的 key/url
  const apiKey      = cfg.embeddingApiKey  || cfg.articleApiKey || cfg.coverApiKey || ''
  const baseURL     = cfg.embeddingBaseUrl || (
    cfg.articleBaseUrl && cfg.articleProvider !== 'maas'
      ? cfg.articleBaseUrl
      : 'https://api.openai.com/v1'
  )
  const model       = cfg.embeddingModel       || 'text-embedding-3-small'
  const dimensions  = cfg.embeddingDimensions  || undefined
  const instruction = cfg.embeddingInstruction || undefined

  // extraHeaders：JSON 字符串或对象
  let extraHeaders = {}
  if (cfg.embeddingExtraHeaders) {
    try {
      extraHeaders = typeof cfg.embeddingExtraHeaders === 'string'
        ? JSON.parse(cfg.embeddingExtraHeaders)
        : cfg.embeddingExtraHeaders
    } catch { /* 解析失败忽略 */ }
  }

  if (!apiKey) throw new Error('未配置 Embedding API Key，请在知识库页面填写后重试')

  // 任意参数变化时重建实例
  const cacheKey = JSON.stringify({ apiKey, baseURL, model, dimensions, instruction, extraHeaders })
  if (!_embeddings || _embeddings._cacheKey !== cacheKey) {
    _embeddings = new RawEmbeddings({ apiKey, baseURL, model, dimensions, instruction, extraHeaders })
    _embeddings._cacheKey = cacheKey
  }
  return _embeddings
}

// ── 文本切割器 ────────────────────────────────────────────────────────────────

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 800,
  chunkOverlap: 100,
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
    // 处理子目录格式（YYYYMMDD 下还有多个 task*.md）
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
  const embeddings = getEmbeddings(aiConfig)
  const rawDocs    = collectDocs(userId)
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

  return { indexed: rawDocs.length, chunks: langchainDocs.length }
}

// ── 检索相关文档 ──────────────────────────────────────────────────────────────

export async function retrieveRelevant(query, { topK = 5, aiConfig = {}, userId } = {}) {
  const indexDir = getUserIndexDir(userId)
  if (!fs.existsSync(path.join(indexDir, 'hnswlib.index'))) {
    return []  // 未索引，静默返回空
  }
  try {
    const embeddings = getEmbeddings(aiConfig)
    const vectorStore = await HNSWLib.load(indexDir, embeddings)
    const results = await vectorStore.similaritySearchWithScore(query, topK)
    // 过滤掉相似度太低的（score < 0.3 in cosine distance）
    return results
      .filter(([, score]) => score < 0.8)
      .map(([doc, score]) => ({
        content:  doc.pageContent,
        source:   doc.metadata.source,
        type:     doc.metadata.type,
        dir:      doc.metadata.dir,
        score:    parseFloat(score.toFixed(4)),
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
  return {
    indexed:   true,
    size:      stat.size,
    updatedAt: stat.mtime.toISOString(),
    indexDir,
  }
}
