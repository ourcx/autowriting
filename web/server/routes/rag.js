/**
 * RAG 管理路由
 * POST /api/rag/index    - 异步构建/重建向量索引（立即返回 queued: true）
 * GET  /api/rag/status   - 查询索引状态（含构建进度）
 * POST /api/rag/search   - 手动搜索（调试用）
 */
import { Router } from 'express'
import { buildIndex, retrieveRelevant, getIndexStatus } from '../rag.js'
import { SERVER_AI_CONFIG } from '../config.js'
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
router.post('/search', async (req, res) => {
  try {
    const { query, topK = 5, aiConfig: clientAiConfig } = req.body
    if (!query) return res.status(400).json({ error: '缺少 query' })
    const aiConfig = { ...SERVER_AI_CONFIG, ...(clientAiConfig || {}) }
    const results = await retrieveRelevant(query, { topK, aiConfig, userId: req.user.id })
    res.json({ results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
