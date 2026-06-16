/**
 * RAG 管理路由
 * POST /api/rag/index      - 异步构建/重建向量索引（立即返回 queued: true）
 * GET  /api/rag/status     - 查询索引状态（含构建进度 + 混合检索能力标志）
 * POST /api/rag/search     - 手动搜索调试（支持 scoreThreshold / topK 参数）
 * POST /api/rag/candidates - 按文章维度聚合的候选列表（供用户手动选择）
 * POST /api/rag/context    - 根据选定目录读取完整文章内容
 */
import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { buildIndex, retrieveRelevant, getIndexStatus } from '../rag.js'
import { SERVER_AI_CONFIG, DRAFTS_DIR } from '../config.js'
import { authMiddleware } from '../authMiddleware.js'

const router = Router()

// 记录每个用户的异步构建状态
// Map<userId, { running: boolean, progress: string, error: string|null, startedAt: Date|null }>
const buildState = new Map()

function getState(userId) {
  if (!buildState.has(userId)) {
    buildState.set(userId, { running: false, progress: '', error: null, startedAt: null, result: null })
  }
  return buildState.get(userId)
}

// 异步触发索引构建（可复用：文章保存后的增量更新也调用这个）
export async function triggerBuildIndex(aiConfig, userId) {
  const state = getState(userId)
  if (state.running) return  // 已在构建中，跳过
  state.running = true
  state.progress = '准备中...'
  state.error = null
  state.startedAt = new Date()
  state.result = null

  setImmediate(async () => {
    try {
      state.progress = '扫描文章...'
      const result = await buildIndex(aiConfig, userId)
      state.result = result
      state.progress = `完成（${result.indexed} 篇 / ${result.chunks} 段）`
    } catch (err) {
      console.error('[RAG] 异步索引失败:', err.message)
      state.error = err.message
      state.progress = '构建失败'
    } finally {
      state.running = false
    }
  })
}

// 所有 RAG 路由需要登录
router.use(authMiddleware)

// POST /api/rag/index — 异步触发，立即返回
router.post('/index', (req, res) => {
  const { aiConfig: clientAiConfig } = req.body
  const aiConfig = { ...SERVER_AI_CONFIG, ...(clientAiConfig || {}) }
  const userId = req.user.id
  const state = getState(userId)

  if (state.running) {
    return res.json({ queued: false, running: true, progress: state.progress })
  }

  triggerBuildIndex(aiConfig, userId)
  res.json({ queued: true, running: true, progress: '准备中...' })
})

// GET /api/rag/status — 返回索引文件状态 + 实时构建进度
router.get('/status', (req, res) => {
  try {
    const fileStatus = getIndexStatus(req.user.id)
    const state = getState(req.user.id)
    res.json({
      ...fileStatus,
      building: state.running,
      progress: state.progress,
      buildError: state.error,
      buildResult: state.result,
      startedAt: state.startedAt?.toISOString() ?? null,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/rag/search（调试接口）
// body: { query, topK?, scoreThreshold?, aiConfig? }
// 返回结果包含向量相似度、关键词命中率、综合得分，方便排查检索效果
router.post('/search', async (req, res) => {
  try {
    const { query, topK = 5, scoreThreshold, aiConfig: clientAiConfig } = req.body
    if (!query) return res.status(400).json({ error: '缺少 query' })
    const aiConfig = { ...SERVER_AI_CONFIG, ...(clientAiConfig || {}) }
    const results = await retrieveRelevant(query, {
      topK,
      scoreThreshold,
      aiConfig,
      userId: req.user.id,
    })
    res.json({
      results,
      meta: {
        topK,
        scoreThreshold: scoreThreshold ?? null,
        count: results.length,
      },
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── 工具：扫描目录下的所有 article_raw*.md 文件，返回合并内容 ────────────────
// dir 格式为 YYYYMMDD，实际文件名可能带后缀如 article_raw-广州大学问题汇总.md
function readAllArticlesInDir(baseDir) {
  const rawDir = path.join(baseDir, 'raw')
  if (!fs.existsSync(rawDir)) return ''
  const files = fs.readdirSync(rawDir).filter(f => f.startsWith('article_raw') && f.endsWith('.md'))
  const parts = []
  for (const f of files) {
    const content = fs.readFileSync(path.join(rawDir, f), 'utf-8').trim()
    if (content.length > 20) parts.push(content)
  }
  return parts.join('\n\n---\n\n')
}

// 工具：读取目录下标题（先找 title*.txt，再从 article_raw*.md 首行提取，再找 task*.md 主题）
function readDirTitle(baseDir, fallback) {
  // 1. title.txt
  const titleFile = path.join(baseDir, 'title.txt')
  if (fs.existsSync(titleFile)) {
    const t = fs.readFileSync(titleFile, 'utf-8').trim()
    if (t) return t
  }
  // 2. title-*.txt（带后缀）
  if (fs.existsSync(baseDir)) {
    const titleFiles = fs.readdirSync(baseDir).filter(f => f.startsWith('title') && f.endsWith('.txt'))
    for (const tf of titleFiles) {
      const t = fs.readFileSync(path.join(baseDir, tf), 'utf-8').trim()
      if (t) return t
    }
  }
  // 3. article_raw*.md 首行
  const rawDir = path.join(baseDir, 'raw')
  if (fs.existsSync(rawDir)) {
    const rawFiles = fs.readdirSync(rawDir).filter(f => f.startsWith('article_raw') && f.endsWith('.md'))
    for (const rf of rawFiles) {
      const firstLine = fs.readFileSync(path.join(rawDir, rf), 'utf-8').split('\n')[0]?.replace(/^#+\s*/, '').trim()
      if (firstLine) return firstLine
    }
  }
  // 4. task*.md 里的文章主题
  const promptDir = path.join(baseDir, 'prompt')
  if (fs.existsSync(promptDir)) {
    const taskFiles = fs.readdirSync(promptDir).filter(f => f.startsWith('task') && f.endsWith('.md'))
    for (const tf of taskFiles) {
      const match = fs.readFileSync(path.join(promptDir, tf), 'utf-8').match(/文章主题[：:]\s*(.+)/i)
      if (match) return match[1].trim()
    }
  }
  return fallback
}

// POST /api/rag/candidates — 按文章目录维度聚合的候选列表（供用户手动选择上下文）
// body: { query, topK?, aiConfig? }
// 返回: { candidates: [{ dir, title, snippet, score, types }] }
router.post('/candidates', async (req, res) => {
  try {
    const { query, topK = 8, aiConfig: clientAiConfig } = req.body
    if (!query) return res.status(400).json({ error: '缺少 query' })

    const aiConfig = { ...SERVER_AI_CONFIG, ...(clientAiConfig || {}) }
    const userId = req.user.id

    // 检索更多 chunk，以便按文章目录聚合
    const chunks = await retrieveRelevant(query, { topK: topK * 3, aiConfig, userId })

    // 按 dir 聚合：同一目录取最高相似度，合并内容片段
    const dirMap = new Map()
    for (const chunk of chunks) {
      const { dir, content, type, score } = chunk
      if (!dirMap.has(dir)) {
        dirMap.set(dir, { dir, score, types: new Set([type]), snippets: [content] })
      } else {
        const entry = dirMap.get(dir)
        if (score < entry.score) entry.score = score   // score 越小越相似
        entry.types.add(type)
        if (entry.snippets.length < 3) entry.snippets.push(content)
      }
    }

    // 读取每个目录对应的文章标题（兼容带后缀的文件名）
    const userDraftsDir = path.join(DRAFTS_DIR, String(userId))
    const candidates = []
    for (const [, entry] of dirMap) {
      const dirPath = path.join(userDraftsDir, entry.dir)
      const title = readDirTitle(dirPath, entry.dir)

      candidates.push({
        dir:     entry.dir,
        title,
        score:   parseFloat(entry.score.toFixed(4)),
        sim:     Math.round((1 - entry.score) * 100),
        types:   [...entry.types],
        snippet: entry.snippets.join(' … ').slice(0, 200),
      })
    }

    // 按相似度排序，只返回前 topK 个文章
    candidates.sort((a, b) => a.score - b.score)
    res.json({ candidates: candidates.slice(0, topK) })
  } catch (err) {
    console.error('[RAG candidates]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /api/rag/context — 根据选定的文章目录列表，读取完整内容并格式化为上下文
// body: { dirs: string[] }
// 返回: { context: string, articles: [{ dir, title, content }] }
router.post('/context', async (req, res) => {
  try {
    const { dirs } = req.body
    if (!Array.isArray(dirs) || dirs.length === 0) {
      return res.status(400).json({ error: '缺少 dirs' })
    }

    const userId = req.user.id
    const userDraftsDir = path.join(DRAFTS_DIR, String(userId))
    const articles = []

    for (const dir of dirs.slice(0, 5)) {  // 最多 5 篇，避免 token 过长
      // 安全：dir 只允许形如 20260512 或 20260512-xxx 的格式
      if (!/^\d{8}/.test(dir)) continue

      const dirPath = path.join(userDraftsDir, dir)
      if (!fs.existsSync(dirPath)) continue

      // 读取标题（兼容带后缀文件名）
      const title = readDirTitle(dirPath, dir)

      // 读取文章内容：合并该目录下所有 article_raw*.md，截取前 1500 字
      let content = readAllArticlesInDir(dirPath).slice(0, 1500)

      // 没有文章时，fallback 读所有 task*.md
      if (!content) {
        const promptDir = path.join(dirPath, 'prompt')
        if (fs.existsSync(promptDir)) {
          const taskFiles = fs.readdirSync(promptDir).filter(f => f.startsWith('task') && f.endsWith('.md'))
          const parts = []
          for (const tf of taskFiles) {
            const c = fs.readFileSync(path.join(promptDir, tf), 'utf-8').trim()
            if (c) parts.push(c)
          }
          content = parts.join('\n\n').slice(0, 800)
        }
      }

      if (content) articles.push({ dir, title, content })
    }

    if (articles.length === 0) {
      return res.json({ context: '', articles: [] })
    }

    const parts = articles.map((a, i) =>
      `### 参考${i + 1}（往期文章 · ${a.dir}）\n${a.content}`
    )
    const context = `# 往期相关内容参考（手动选择，仅供风格和结构参考）\n\n${parts.join('\n\n---\n\n')}`

    res.json({ context, articles })
  } catch (err) {
    console.error('[RAG context]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
