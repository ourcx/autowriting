/**
 * 封面路由：单张生成、批量生成、历史管理、缓存统计
 * POST   /api/generate-cover
 * POST   /api/generate-covers-batch
 * GET    /api/cover-history
 * DELETE /api/cover-history/:id
 * DELETE /api/cover-history
 * GET    /api/cache-stats
 */
import { Router } from 'express'
import axios from 'axios'
import { SERVER_AI_CONFIG } from '../config.js'
import {
  generateCacheKey, getCachedImage, cacheImage,
  loadHistory, addToHistory,
  addImageToLibrary,
  generatePrompt, generatePlaceholderCover, generateWithDallE,
} from '../utils.js'
import { deleteCoverHistory, clearCoverHistory, getCoverCacheCount } from '../db.js'

const router = Router()

// ── POST /api/generate-cover ──────────────────────────────────────────────────

router.post('/generate-cover', async (req, res) => {
  try {
    const { title, content, style, color, provider: reqProvider, aiConfig } = req.body
    if (!title) return res.status(400).json({ error: '标题不能为空' })

    const cfg = { ...SERVER_AI_CONFIG, ...(aiConfig || {}) }
    const provider    = reqProvider || cfg.coverProvider || 'local'
    const coverApiKey = cfg.coverApiKey || cfg.stabilityApiKey || ''

    const cacheKey = generateCacheKey(title, style, color)
    const cached   = getCachedImage(cacheKey)
    if (cached) {
      const historyItem = addToHistory(title, style, color, provider, cached.imageUrl, cacheKey)
      return res.json({ imageUrl: cached.imageUrl, cached: true, historyId: historyItem.id })
    }

    if (provider === 'local') {
      const svgContent = generatePlaceholderCover(title, style, color)
      const imageUrl   = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`
      cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
      const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
      return res.json({ imageUrl, historyId: historyItem.id })
    }

    if (provider === 'stability') {
      try {
        const prompt   = generatePrompt(title, content, style, color)
        const response = await axios.post(
          `${SERVER_AI_CONFIG.stabilityBaseUrl}/text-to-image/v1/engines/${process.env.STABILITY_ENGINE || 'stable-diffusion-3-large'}/text-to-image`,
          { text_prompts: [{ text: prompt, weight: 1 }], cfg_scale: 7, height: 640, width: 1216, samples: 1, steps: 30 },
          { headers: { 'Authorization': `Bearer ${coverApiKey || SERVER_AI_CONFIG.stabilityApiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } }
        )
        if (response.data.artifacts?.length > 0) {
          const imageUrl = `data:image/png;base64,${response.data.artifacts[0].base64}`
          cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'stability' })
          const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
          return res.json({ imageUrl, historyId: historyItem.id })
        }
        throw new Error('No image generated')
      } catch (e) {
        console.error('Stability AI error:', e.response?.data || e.message)
        const svgContent  = generatePlaceholderCover(title, style, color)
        const imageUrl    = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`
        cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
        const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
        return res.json({ imageUrl, historyId: historyItem.id, warning: 'Stability AI 生成失败，已使用本地模式' })
      }
    }

    if (provider === 'openai') {
      try {
        const prompt      = generatePrompt(title, content, style, color)
        const imageUrl    = await generateWithDallE(prompt, coverApiKey)
        cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'openai' })
        const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
        addImageToLibrary(imageUrl, title, 'cover', [style, color], 'openai')
        return res.json({ imageUrl, historyId: historyItem.id })
      } catch (e) {
        console.error('OpenAI DALL-E error:', e.message)
        const svgContent  = generatePlaceholderCover(title, style, color)
        const imageUrl    = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`
        cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
        const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
        return res.json({ imageUrl, historyId: historyItem.id, warning: `DALL-E 生成失败（${e.message}），已使用本地模式` })
      }
    }

    res.status(400).json({ error: '未知的图片生成服务商' })
  } catch (error) {
    console.error('Error generating cover:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── POST /api/generate-covers-batch ──────────────────────────────────────────

router.post('/generate-covers-batch', async (req, res) => {
  try {
    const { covers, provider } = req.body
    if (!Array.isArray(covers) || covers.length === 0) return res.status(400).json({ error: '封面列表不能为空' })
    if (covers.length > 10) return res.status(400).json({ error: '单次最多生成 10 个封面' })

    const results = []
    const errors  = []

    for (let i = 0; i < covers.length; i++) {
      try {
        const { title, content, style, color } = covers[i]
        if (!title) { errors.push({ index: i, error: '标题不能为空' }); continue }

        const cacheKey = generateCacheKey(title, style, color)
        const cached   = getCachedImage(cacheKey)
        if (cached) {
          const h = addToHistory(title, style, color, provider, cached.imageUrl, cacheKey)
          results.push({ index: i, title, imageUrl: cached.imageUrl, cached: true, historyId: h.id })
          continue
        }

        if (provider === 'local') {
          const svg         = generatePlaceholderCover(title, style, color)
          const imageUrl    = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
          cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
          const h = addToHistory(title, style, color, provider, imageUrl, cacheKey)
          results.push({ index: i, title, imageUrl, cached: false, historyId: h.id })
          continue
        }

        if (provider === 'openai') {
          try {
            const prompt   = generatePrompt(title, content || '', style, color)
            const imageUrl = await generateWithDallE(prompt)
            cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'openai' })
            const h = addToHistory(title, style, color, provider, imageUrl, cacheKey)
            addImageToLibrary(imageUrl, title, 'cover', [style, color], 'openai')
            results.push({ index: i, title, imageUrl, cached: false, historyId: h.id })
          } catch (e) {
            console.error(`OpenAI DALL-E error for ${title}:`, e.message)
            const svg      = generatePlaceholderCover(title, style, color)
            const imageUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
            cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
            const h = addToHistory(title, style, color, provider, imageUrl, cacheKey)
            results.push({ index: i, title, imageUrl, cached: false, historyId: h.id, warning: 'OpenAI DALL-E 生成失败，已使用本地模式' })
          }
        }
      } catch (e) {
        errors.push({ index: i, error: e.message })
      }
    }

    res.json({ success: true, results, errors: errors.length > 0 ? errors : undefined, total: covers.length, succeeded: results.length, failed: errors.length })
  } catch (error) {
    console.error('Error in batch generation:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── GET /api/cover-history ────────────────────────────────────────────────────

router.get('/cover-history', (req, res) => {
  try {
    res.json(loadHistory())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ── DELETE /api/cover-history/:id ────────────────────────────────────────────

router.delete('/cover-history/:id', (req, res) => {
  try {
    deleteCoverHistory(req.params.id)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ── DELETE /api/cover-history（清空）─────────────────────────────────────────

router.delete('/cover-history', (req, res) => {
  try {
    clearCoverHistory()
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ── GET /api/cache-stats ──────────────────────────────────────────────────────

router.get('/cache-stats', (req, res) => {
  try {
    const history    = loadHistory()
    const cacheCount = getCoverCacheCount()
    res.json({
      historyCount: history.length,
      cacheCount,
      cacheSize: cacheCount > 0 ? `${(cacheCount * 0.05).toFixed(2)} MB` : '0 MB',
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router
