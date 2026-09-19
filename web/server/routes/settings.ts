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
import { settingsSchemas, validateBody } from '../validation.ts'
import { isWechatAnalyticsPrivateKey } from '../wechatAnalyticsStore.ts'

const router = Router()
const GLOBAL_MEMORY_KEY = 'global_memory'

router.use(authMiddleware)

function userMemoryKey(userId: string) {
  return `${GLOBAL_MEMORY_KEY}:${userId}`
}

function isPrivateMemoryKey(key: string) {
  return key.startsWith(`${GLOBAL_MEMORY_KEY}:`)
}

function getUserGlobalMemory(userId: string) {
  const value = getSetting(userMemoryKey(userId))
  return typeof value === 'string' ? value : ''
}

function getVisibleSettings(userId: string) {
  const settings = getAllSettings()
  for (const key of Object.keys(settings)) {
    if (isPrivateMemoryKey(key) || isWechatAnalyticsPrivateKey(key)) delete settings[key]
  }
  settings[GLOBAL_MEMORY_KEY] = getUserGlobalMemory(userId)
  return settings
}

function isForbiddenPrivateKey(key: string) {
  return isPrivateMemoryKey(key) || isWechatAnalyticsPrivateKey(key)
}

function parseGlobalMemory(value: unknown) {
  if (typeof value !== 'string') throw new TypeError('永久记忆必须是文本')
  if (value.length > 100_000) throw new RangeError('永久记忆不能超过 100000 字')
  return value
}

// GET /api/settings
router.get('/', (req, res) => {
  try {
    res.json(getVisibleSettings(req.user.id))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/settings/token-usage?days=30  （必须在 /:key 之前）
router.get('/token-usage', (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days || '30', 10) || 30, 365)
    const summary = getTokenUsageSummary(req.user.id, days)
    res.json({ days, ...summary })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/settings/:key
router.get('/:key', (req, res) => {
  try {
    if (isForbiddenPrivateKey(req.params.key)) return res.status(403).json({ error: '无权访问其他用户的私有配置' })
    const value = req.params.key === GLOBAL_MEMORY_KEY
      ? getUserGlobalMemory(req.user.id)
      : getSetting(req.params.key)
    // key 不存在时返回 200 + null，避免浏览器打印红色 404 错误
    res.json({ key: req.params.key, value: value ?? null })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// POST /api/settings（批量写入，body 为 key:value 对象）
router.post('/', validateBody(settingsSchemas.updateMany), (req, res) => {
  try {
    const entries = Object.entries(req.body)
    if (entries.length === 0) return res.status(400).json({ error: '请求体不能为空' })
    if (entries.some(([key]) => isForbiddenPrivateKey(key))) {
      return res.status(403).json({ error: '无权写入其他用户的私有配置' })
    }
    for (const [key, value] of entries) {
      if (key === GLOBAL_MEMORY_KEY) {
        setSetting(userMemoryKey(req.user.id), parseGlobalMemory(value))
      } else {
        setSetting(key, value)
      }
    }
    res.json({ success: true, updated: entries.length })
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ error: error.message })
    res.status(500).json({ error: error.message })
  }
})

// PUT /api/settings/:key
router.put('/:key', validateBody(settingsSchemas.updateOne), (req, res) => {
  try {
    const { value } = req.body
    if (value === undefined) return res.status(400).json({ error: 'value 不能为空' })
    if (isForbiddenPrivateKey(req.params.key)) return res.status(403).json({ error: '无权写入其他用户的私有配置' })
    if (req.params.key === GLOBAL_MEMORY_KEY) {
      setSetting(userMemoryKey(req.user.id), parseGlobalMemory(value))
    } else {
      setSetting(req.params.key, value)
    }
    res.json({ key: req.params.key, value })
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ error: error.message })
    res.status(500).json({ error: error.message })
  }
})

export default router
