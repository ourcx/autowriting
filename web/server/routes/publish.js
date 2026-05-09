/**
 * 微信发布路由
 * POST   /api/publish/draft
 * GET    /api/publish/history
 * DELETE /api/publish/history/:id
 */
import { Router } from 'express'
import { loadPublishHistory, savePublishHistory, generateDraftFile } from '../utils.js'

const router = Router()

// POST /api/publish/draft
router.post('/draft', (req, res) => {
  try {
    const { title, content, coverImage } = req.body
    if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' })
    const draft = generateDraftFile(title, content, coverImage)
    res.json({ success: true, draftId: draft.id, message: '草稿已生成，请在微信编辑器中继续编辑' })
  } catch (error) {
    console.error('Error publishing draft:', error)
    res.status(500).json({ error: error.message })
  }
})

// GET /api/publish/history
router.get('/history', (req, res) => {
  try {
    res.json(loadPublishHistory())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// DELETE /api/publish/history/:id
router.delete('/history/:id', (req, res) => {
  try {
    const history = loadPublishHistory().filter(item => item.id !== req.params.id)
    savePublishHistory(history)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router
