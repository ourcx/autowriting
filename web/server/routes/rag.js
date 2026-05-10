/**
 * RAG 管理路由
 * POST /api/rag/index    - 构建/重建向量索引
 * GET  /api/rag/status   - 查询索引状态
 * POST /api/rag/search   - 手动搜索（调试用）
 */
import { Router } from 'express'
import { buildIndex, retrieveRelevant, getIndexStatus } from '../rag.js'
import { SERVER_AI_CONFIG } from '../config.js'

const router = Router()

// POST /api/rag/index
router.post('/index', async (req, res) => {
  try {
    const { aiConfig: clientAiConfig } = req.body
    const aiConfig = { ...SERVER_AI_CONFIG, ...(clientAiConfig || {}) }
    const result = await buildIndex(aiConfig)
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('[RAG] 索引失败:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /api/rag/status
router.get('/status', (_req, res) => {
  try {
    res.json(getIndexStatus())
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
    const results = await retrieveRelevant(query, { topK, aiConfig })
    res.json({ results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
