// @ts-nocheck
/**
 * 配置路由（存储在 SQLite settings 表）
 * GET    /api/settings                获取所有配置
 * GET    /api/settings/token-usage    Token 用量统计（需登录）
 * GET    /api/settings/:key           获取单个配置项
 * POST   /api/settings                批量设置（body: { key: value, ... }）
 * PUT    /api/settings/:key           设置单个配置项（body: { value }）
 */
import { Router } from 'express'
import { getSetting, setSetting, getAllSettings, getTokenUsageSummary } from '../db.js'
import { authMiddleware } from '../authMiddleware.js'

const router = Router()

// GET /api/settings
router.get('/', authMiddleware, (req, res) => {
  try {
    res.json(getAllSettings())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/settings/token-usage?days=30  （必须在 /:key 之前）
router.get('/token-usage', authMiddleware, (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days || '30', 10) || 30, 365)
    const summary = getTokenUsageSummary(req.user.id, days)
    res.json({ days, ...summary })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/settings/:key
router.get('/:key', authMiddleware, (req, res) => {
  try {
    const value = getSetting(req.params.key)
    // key 不存在时返回 200 + null，避免浏览器打印红色 404 错误
    res.json({ key: req.params.key, value: value ?? null })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// POST /api/settings（批量写入，body 为 key:value 对象）
router.post('/', authMiddleware, (req, res) => {
  try {
    const entries = Object.entries(req.body)
    if (entries.length === 0) return res.status(400).json({ error: '请求体不能为空' })
    for (const [key, value] of entries) {
      setSetting(key, value)
    }
    res.json({ success: true, updated: entries.length })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// PUT /api/settings/:key
router.put('/:key', authMiddleware, (req, res) => {
  try {
    const { value } = req.body
    if (value === undefined) return res.status(400).json({ error: 'value 不能为空' })
    setSetting(req.params.key, value)
    res.json({ key: req.params.key, value })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router
