/**
 * CSS 模板路由（存储在 SQLite style_templates 表）
 * GET    /api/templates           列出所有模板（内置 + 自定义）
 * GET    /api/templates/:id       获取单个模板
 * POST   /api/templates           新建/更新自定义模板
 * DELETE /api/templates/:id       删除自定义模板
 * POST   /api/templates/seed      初始化内置模板（首次或重置）
 */
import { Router } from 'express'
import { listTemplates, upsertTemplate, deleteTemplate, getTemplate } from '../db.js'

const router = Router()

// GET /api/templates
router.get('/', (req, res) => {
  try {
    res.json(listTemplates())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/templates/:id
router.get('/:id', (req, res) => {
  try {
    const t = getTemplate(req.params.id)
    if (!t) return res.status(404).json({ error: '模板不存在' })
    res.json(t)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// POST /api/templates（新建或更新自定义模板）
router.post('/', (req, res) => {
  try {
    const { id, name, desc, accentColor, css } = req.body
    if (!name || !css) return res.status(400).json({ error: '模板名称和 CSS 不能为空' })
    const now = Date.now()
    const templateId = id || `custom-${now}`
    upsertTemplate({ id: templateId, name, desc, accentColor, css, isBuiltin: false, createdAt: now, updatedAt: now })
    res.json(getTemplate(templateId))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// DELETE /api/templates/:id
router.delete('/:id', (req, res) => {
  try {
    deleteTemplate(req.params.id)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router
