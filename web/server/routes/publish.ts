// @ts-nocheck
/**
 * 微信发布路由（存储已迁移至 SQLite）
 * POST   /api/publish/draft
 * GET    /api/publish/history
 * DELETE /api/publish/history/:id
 * GET    /api/publish/draft/:id    （获取草稿内容）
 */
import { Router } from 'express'
import { addPublishHistory, listPublishHistory, deletePublishHistory, getPublishById } from '../db.js'

const router = Router()

// POST /api/publish/draft
router.post('/draft', (req, res) => {
  try {
    const { title, content, coverImage } = req.body
    if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' })
    const draft = addPublishHistory(title, content, coverImage)
    res.json({ success: true, draftId: draft.id, message: '草稿已保存' })
  } catch (error) {
    console.error('Error saving draft:', error)
    res.status(500).json({ error: error.message })
  }
})

// GET /api/publish/history
router.get('/history', (req, res) => {
  try {
    res.json(listPublishHistory())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/publish/draft/:id
router.get('/draft/:id', (req, res) => {
  try {
    const draft = getPublishById(req.params.id)
    if (!draft) return res.status(404).json({ error: '草稿不存在' })
    res.json(draft)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// DELETE /api/publish/history/:id
router.delete('/history/:id', (req, res) => {
  try {
    deletePublishHistory(req.params.id)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router
