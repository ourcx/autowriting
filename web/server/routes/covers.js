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
  generatePrompt, generatePlaceholderCover, generateWithDallE, generateWithSiliconFlow, generateWithQwenEdit,
  maskApiKey,
} from '../utils.js'
import { deleteCoverHistory, clearCoverHistory, getCoverCacheCount } from '../db.js'

const router = Router()

// ── POST /api/generate-cover ──────────────────────────────────────────────────

router.post('/generate-cover', async (req, res) => {
  try {
    const { title, content, style, color, provider: reqProvider, aiConfig, customPrompt, baseImageUrl } = req.body
    if (!title) return res.status(400).json({ error: '标题不能为空' })

    // 合并服务端配置与前端传入的用户配置，前端优先
    const cfg         = { ...SERVER_AI_CONFIG, ...(aiConfig || {}) }
    const provider    = reqProvider || cfg.coverProvider || 'local'
    const sfKey       = cfg.siliconflowApiKey || ''
    const sfModel     = cfg.siliconflowModel  || 'Kwai-Kolors/Kolors'
    const coverApiKey = cfg.coverApiKey || cfg.stabilityApiKey || ''

    // ── 诊断日志（已脱敏） ───────────────────────────────────────────────────
    console.log('[cover] ─────────────────────────────────')
    console.log('[cover] provider (req)    :', reqProvider)
    console.log('[cover] provider (final)  :', provider)
    console.log('[cover] sfKey             :', sfKey ? `sk-...${sfKey.slice(-6)} (len=${sfKey.length})` : '❌ 空')
    console.log('[cover] sfModel           :', sfModel)
    console.log('[cover] coverApiKey       :', coverApiKey ? `sk-...${coverApiKey.slice(-6)}` : '❌ 空')
    console.log('[cover] aiConfig received :', JSON.stringify(maskApiKey(aiConfig || {})))
    console.log('[cover] ─────────────────────────────────')

    // ── 本地 SVG 占位（不需要 API） ─────────────────────────────────────────
    if (provider === 'local') {
      const cacheKey    = generateCacheKey(title, style, `${color}|local`)
      const svgContent  = generatePlaceholderCover(title, style, color)
      const imageUrl    = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`
      cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
      const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
      return res.json({ imageUrl, historyId: historyItem.id })
    }

    // ── 需要 API 的 provider：先做 key 验证 ──────────────────────────────────
    const SF_PROVIDERS = ['siliconflow', 'z-image', 'qwen-edit']
    if (SF_PROVIDERS.includes(provider) && !sfKey) {
      return res.status(400).json({
        error: 'SiliconFlow API Key 未配置。请前往「AI 配置」页面填写 SiliconFlow API Key 并保存。',
      })
    }
    if (provider === 'openai' && !cfg.coverApiKey && !cfg.articleApiKey) {
      return res.status(400).json({ error: 'OpenAI API Key 未配置。请前往「AI 配置」页面填写。' })
    }
    if (provider === 'stability' && !coverApiKey) {
      return res.status(400).json({ error: 'Stability AI API Key 未配置。请前往「AI 配置」页面填写。' })
    }

    // ── 缓存检查（仅非自定义 prompt，provider 参与 key 避免跨 provider 污染） ──
    const cacheKey = generateCacheKey(title, style, `${color}|${provider}`)
    if (!customPrompt && provider !== 'qwen-edit') {
      const cached = getCachedImage(cacheKey)
      if (cached) {
        // 跳过旧的 SVG 脏缓存（之前兜底写进来的）
        if (provider !== 'local' && cached.imageUrl?.startsWith('data:image/svg')) {
          console.log('[cover] 跳过旧 SVG 缓存，重新生成')
        } else {
          const historyItem = addToHistory(title, style, color, provider, cached.imageUrl, cacheKey)
          return res.json({ imageUrl: cached.imageUrl, cached: true, historyId: historyItem.id })
        }
      }
    }

    const finalPrompt = customPrompt || generatePrompt(title, content, style, color)

    // ── Stability AI ─────────────────────────────────────────────────────────
    if (provider === 'stability') {
      const response = await axios.post(
        `${SERVER_AI_CONFIG.stabilityBaseUrl}/text-to-image/v1/engines/${process.env.STABILITY_ENGINE || 'stable-diffusion-3-large'}/text-to-image`,
        { text_prompts: [{ text: finalPrompt, weight: 1 }], cfg_scale: 7, height: 640, width: 1216, samples: 1, steps: 30 },
        { headers: { Authorization: `Bearer ${coverApiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' } },
      )
      if (!response.data.artifacts?.length) throw new Error('Stability AI 未返回图片')
      const imageUrl    = `data:image/png;base64,${response.data.artifacts[0].base64}`
      cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'stability' })
      const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
      return res.json({ imageUrl, historyId: historyItem.id })
    }

    // ── OpenAI DALL-E ────────────────────────────────────────────────────────
    if (provider === 'openai') {
      const key      = cfg.coverApiKey || cfg.articleApiKey
      const imageUrl = await generateWithDallE(finalPrompt, key)
      cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'openai' })
      const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
      addImageToLibrary(imageUrl, title, 'cover', [style, color], 'openai')
      return res.json({ imageUrl, historyId: historyItem.id })
    }

    // ── SiliconFlow Kolors ───────────────────────────────────────────────────
    if (provider === 'siliconflow') {
      console.log(`[cover] siliconflow model=${sfModel}, key=sk-...${sfKey.slice(-6)}`)
      const imageUrl    = await generateWithSiliconFlow(finalPrompt, sfKey, sfModel)
      cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'siliconflow' })
      const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
      addImageToLibrary(imageUrl, title, 'cover', [style, color], 'siliconflow')
      return res.json({ imageUrl, historyId: historyItem.id })
    }

    // ── Z-Image ──────────────────────────────────────────────────────────────
    if (provider === 'z-image') {
      console.log(`[cover] z-image, key=sk-...${sfKey.slice(-6)}`)
      const imageUrl    = await generateWithSiliconFlow(finalPrompt, sfKey, 'Tongyi-MAI/Z-Image')
      cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'z-image' })
      const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
      addImageToLibrary(imageUrl, title, 'cover', [style, color], 'z-image')
      return res.json({ imageUrl, historyId: historyItem.id })
    }

    // ── Qwen Image Edit ──────────────────────────────────────────────────────
    if (provider === 'qwen-edit') {
      let baseBuffer = null
      let baseType   = 'image/png'
      if (baseImageUrl) {
        if (baseImageUrl.startsWith('data:')) {
          const m = baseImageUrl.match(/^data:([^;]+);base64,(.+)$/)
          if (m) { baseType = m[1]; baseBuffer = Buffer.from(m[2], 'base64') }
        } else {
          const imgResp = await axios.get(baseImageUrl, { responseType: 'arraybuffer' })
          baseBuffer    = Buffer.from(imgResp.data)
          baseType      = imgResp.headers['content-type'] || 'image/png'
        }
      }
      console.log(`[cover] qwen-edit, hasBase=${!!baseBuffer}, key=sk-...${sfKey.slice(-6)}`)
      const imageUrl    = await generateWithQwenEdit(finalPrompt, sfKey, baseBuffer, baseType)
      const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
      addImageToLibrary(imageUrl, title, 'cover', [style, color], 'qwen-edit')
      return res.json({ imageUrl, historyId: historyItem.id })
    }

    res.status(400).json({ error: `未知的图片生成服务商：${provider}` })
  } catch (error) {
    const detail = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message
    console.error('[cover] generate error:', detail)
    res.status(500).json({ error: detail || '封面生成失败，请检查 API Key 和网络连接' })
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
