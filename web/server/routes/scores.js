/**
 * 文章评分路由
 * GET    /api/scores                    列出当前用户所有评分
 * GET    /api/scores/:articleId         获取某篇文章的评分（所有平台）
 * POST   /api/scores/:articleId         保存/更新评分（支持 content 字段写入文件）
 * DELETE /api/scores/:articleId/:platform  删除评分
 */
import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { authMiddleware } from '../authMiddleware.js'
import {
  listArticleScores,
  getArticleScores,
  saveArticleScore,
  deleteArticleScore,
} from '../db.js'
import { logger } from '../logger.js'
import { DRAFTS_DIR } from '../config.js'

const router = Router()
router.use(authMiddleware)

// ── GET /api/scores ───────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const scores = listArticleScores(req.user.id)
    res.json(scores)
  } catch (e) {
    logger.error('SCORES', '获取评分列表失败', { error: e.message })
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/scores/:articleId ────────────────────────────────────────────────
router.get('/:articleId', (req, res) => {
  try {
    const scores = getArticleScores(req.user.id, req.params.articleId)
    res.json(scores)
  } catch (e) {
    logger.error('SCORES', '获取文章评分失败', { error: e.message })
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/scores/:articleId ───────────────────────────────────────────────
router.post('/:articleId', (req, res) => {
  try {
    const { articleId } = req.params
    const { title, platform, views, shares, likes, comments, composite, note } = req.body

    if (!platform || !['wechat', 'toutiao'].includes(platform)) {
      return res.status(400).json({ error: 'platform 必须是 wechat 或 toutiao' })
    }

    // 至少要有一个数据字段
    const hasData = [views, shares, likes, comments, composite].some(v => v != null && v !== '')
    if (!hasData) {
      return res.status(400).json({ error: '请至少填写一项数据（浏览量/点赞/转发/评论/综合评分）' })
    }

    // 如果是手动添加的文章（custom_ 前缀）且携带了内容，写入文件供 RAG 检索
    const { content } = req.body
    if (articleId.startsWith('custom_') && content && content.trim()) {
      try {
        const articleDir = path.join(DRAFTS_DIR, String(req.user.id), articleId, 'raw')
        fs.mkdirSync(articleDir, { recursive: true })
        fs.writeFileSync(path.join(articleDir, 'article_raw.md'), content.trim(), 'utf8')
        // 同时写 title.txt
        const titlePath = path.join(DRAFTS_DIR, String(req.user.id), articleId, 'title.txt')
        fs.writeFileSync(titlePath, (title || articleId).trim(), 'utf8')
      } catch (writeErr) {
        logger.warn('SCORES', '写入文章内容文件失败（不影响评分保存）', { error: writeErr.message })
      }
    }

    const score = saveArticleScore({
      userId:    req.user.id,
      articleId,
      title:     title || articleId,
      platform,
      views:     views    != null && views    !== '' ? Number(views)    : undefined,
      shares:    shares   != null && shares   !== '' ? Number(shares)   : undefined,
      likes:     likes    != null && likes    !== '' ? Number(likes)    : undefined,
      comments:  comments != null && comments !== '' ? Number(comments) : undefined,
      composite: composite != null && composite !== '' ? Number(composite) : undefined,
      note,
    })

    res.json(score)
  } catch (e) {
    logger.error('SCORES', '保存评分失败', { error: e.message })
    res.status(500).json({ error: e.message })
  }
})

// ── DELETE /api/scores/:articleId/:platform ───────────────────────────────────
router.delete('/:articleId/:platform', (req, res) => {
  try {
    const { articleId, platform } = req.params
    deleteArticleScore(req.user.id, articleId, platform)
    res.json({ success: true })
  } catch (e) {
    logger.error('SCORES', '删除评分失败', { error: e.message })
    res.status(500).json({ error: e.message })
  }
})

export default router
