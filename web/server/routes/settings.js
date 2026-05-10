/**
 * 配置路由（存储在 SQLite settings 表）
 * GET    /api/settings            获取所有配置
 * GET    /api/settings/:key       获取单个配置项
 * POST   /api/settings            批量设置（body: { key: value, ... }）
 * PUT    /api/settings/:key       设置单个配置项（body: { value }）
 */
import { Router } from 'express'
import { getSetting, setSetting, getAllSettings } from '../db.js'

const router = Router()

// GET /api/settings
router.get('/', (req, res) => {
  try {
    res.json(getAllSettings())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/settings/:key
router.get('/:key', (req, res) => {
  try {
    const value = getSetting(req.params.key)
    if (value === null) return res.status(404).json({ error: '配置项不存在' })
    res.json({ key: req.params.key, value })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// POST /api/settings（批量写入，body 为 key:value 对象）
router.post('/', (req, res) => {
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
router.put('/:key', (req, res) => {
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
