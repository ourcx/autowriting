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
import { OpenAIEmbeddings } from '@langchain/openai'
import { Document } from '@langchain/core/documents'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { DATA_DIR, DRAFTS_DIR, SERVER_AI_CONFIG } from './config.js'

const INDEX_DIR = path.join(DATA_DIR, 'rag_index')

// ── Embeddings 实例（懒加载，避免启动时就报错） ──────────────────────────────

let _embeddings = null
function getEmbeddings(aiConfig = {}) {
  const cfg = { ...SERVER_AI_CONFIG, ...aiConfig }
  // 优先用配置的 openai key，MaaS 一般不提供 embedding，用 openai 兜底
  const apiKey  = cfg.articleApiKey || cfg.coverApiKey || ''
  const baseURL = cfg.articleBaseUrl && cfg.articleProvider !== 'maas'
    ? cfg.articleBaseUrl
    : 'https://api.openai.com/v1'
  if (!apiKey) throw new Error('未配置 OpenAI API Key，RAG 功能需要 embedding 接口')
  if (!_embeddings || _embeddings._apiKey !== apiKey) {
    _embeddings = new OpenAIEmbeddings({
      openAIApiKey: apiKey,
      modelName: 'text-embedding-3-small',
      configuration: { baseURL },
    })
    _embeddings._apiKey = apiKey
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

function collectDocs() {
  const docs = []
  if (!fs.existsSync(DRAFTS_DIR)) return docs

  const dirs = fs.readdirSync(DRAFTS_DIR).filter(f => /^\d{8}/.test(f))
  for (const dir of dirs) {
    const base = path.join(DRAFTS_DIR, dir)
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

export async function buildIndex(aiConfig = {}) {
  const embeddings = getEmbeddings(aiConfig)
  const rawDocs    = collectDocs()
  if (rawDocs.length === 0) return { indexed: 0, chunks: 0 }

  const langchainDocs = []
  for (const { content, metadata } of rawDocs) {
    const chunks = await splitter.splitText(content)
    for (const chunk of chunks) {
      langchainDocs.push(new Document({ pageContent: chunk, metadata }))
    }
  }

  fs.mkdirSync(INDEX_DIR, { recursive: true })
  const vectorStore = await HNSWLib.fromDocuments(langchainDocs, embeddings)
  await vectorStore.save(INDEX_DIR)

  return { indexed: rawDocs.length, chunks: langchainDocs.length }
}

// ── 检索相关文档 ──────────────────────────────────────────────────────────────

export async function retrieveRelevant(query, { topK = 5, aiConfig = {} } = {}) {
  if (!fs.existsSync(path.join(INDEX_DIR, 'hnswlib.index'))) {
    return []  // 未索引，静默返回空
  }
  try {
    const embeddings = getEmbeddings(aiConfig)
    const vectorStore = await HNSWLib.load(INDEX_DIR, embeddings)
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

export function getIndexStatus() {
  const indexFile = path.join(INDEX_DIR, 'hnswlib.index')
  if (!fs.existsSync(indexFile)) return { indexed: false, size: 0 }
  const stat = fs.statSync(indexFile)
  return {
    indexed: true,
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    indexDir: INDEX_DIR,
  }
}
