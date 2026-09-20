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
} from '../utils'
import { deleteCoverHistory, clearCoverHistory, getCoverCacheCount } from '../db.js'
import { mapWithConcurrency } from '../utils/concurrency.ts'
import { authMiddleware } from '../authMiddleware.ts'
import { logger } from '../logger.ts'
import { generateWithDoubao } from '../utils/doubaoImage.ts'

const router = Router()
router.use([
  '/generate-cover',
  '/generate-covers-batch',
  '/cover-history',
  '/cover-history/:id',
  '/cache-stats',
], authMiddleware)

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorDetail(error: unknown): string {
  if (axios.isAxiosError(error) && error.response?.data) {
    return JSON.stringify(error.response.data)
  }
  return errorMessage(error)
}

// ── POST /api/generate-cover ──────────────────────────────────────────────────

router.post('/generate-cover', async (req, res) => {
  try {
    const { title, content, style, color, provider: reqProvider, aiConfig, customPrompt, baseImageUrl } = req.body
    if (!title) return res.status(400).json({ error: '标题不能为空' })

    // 合并服务端配置与前端传入的用户配置，前端优先
    const cfg         = { ...SERVER_AI_CONFIG, ...(aiConfig || {}) }
    const provider    = reqProvider || cfg.coverProvider || 'local'
    const sfKey       = String(cfg.siliconflowApiKey || '')
    const sfModel     = String(cfg.siliconflowModel || 'Kwai-Kolors/Kolors')
    const doubaoKey   = String(cfg.doubaoApiKey || '')
    const doubaoModel = String(cfg.doubaoModel || '')
    const doubaoBaseUrl = String(cfg.doubaoBaseUrl || 'https://ark.cn-beijing.volces.com/api/v3')
    const coverApiKey = String(cfg.coverApiKey || cfg.stabilityApiKey || '')

    logger.debug('COVERS', '准备生成封面', {
      provider,
      hasSiliconflowKey: Boolean(sfKey),
      hasCoverKey: Boolean(coverApiKey),
      hasDoubaoKey: Boolean(doubaoKey),
      doubaoModelConfigured: Boolean(doubaoModel),
    })

    // ── 本地 SVG 占位（不需要 API） ─────────────────────────────────────────
    if (provider === 'local') {
      const cacheKey    = generateCacheKey(title, style, `${color}|local`)
      const svgContent  = generatePlaceholderCover(title, style, color)
      const imageUrl    = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`
      cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
      const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
      // 自动添加到图片库
      addImageToLibrary(imageUrl, title, 'cover', [style, color], 'local')
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
    if (provider === 'doubao' && (!doubaoKey || !doubaoModel)) {
      return res.status(400).json({ error: '豆包方舟 API Key 或图片模型未配置。请前往「AI 配置」页面填写。' })
    }

    // ── 缓存检查（仅非自定义 prompt，provider 参与 key 避免跨 provider 污染） ──
    const providerCacheKey = provider === 'doubao' ? `${provider}:${doubaoModel}` : provider
    const cacheKey = generateCacheKey(title, style, `${color}|${providerCacheKey}`)
    if (!customPrompt && provider !== 'qwen-edit') {
      const cached = getCachedImage(cacheKey)
      if (cached) {
        // 跳过旧的 SVG 脏缓存（之前兜底写进来的）
        if (provider !== 'local' && cached.imageUrl?.startsWith('data:image/svg')) {
          logger.debug('COVERS', '跳过旧 SVG 缓存，重新生成', { provider })
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
      // 自动添加到图片库
      addImageToLibrary(imageUrl, title, 'cover', [style, color], 'stability')
      return res.json({ imageUrl, historyId: historyItem.id })
    }

    // ── OpenAI DALL-E ────────────────────────────────────────────────────────
    if (provider === 'openai') {
      const key      = String(cfg.coverApiKey || cfg.articleApiKey || '')
      const imageUrl = await generateWithDallE(finalPrompt, key)
      cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'openai' })
      const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
      addImageToLibrary(imageUrl, title, 'cover', [style, color], 'openai')
      return res.json({ imageUrl, historyId: historyItem.id })
    }

    // ── 火山方舟 / 豆包 Seedream ─────────────────────────────────────────────
    if (provider === 'doubao') {
      const imageUrl = await generateWithDoubao(finalPrompt, doubaoKey, doubaoModel, doubaoBaseUrl)
      cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'doubao', model: doubaoModel })
      const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
      addImageToLibrary(imageUrl, title, 'cover', [style, color], 'doubao')
      return res.json({ imageUrl, historyId: historyItem.id })
    }

    // ── SiliconFlow Kolors ───────────────────────────────────────────────────
    if (provider === 'siliconflow') {
      const imageUrl    = await generateWithSiliconFlow(finalPrompt, sfKey, sfModel)
      cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'siliconflow' })
      const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
      addImageToLibrary(imageUrl, title, 'cover', [style, color], 'siliconflow')
      return res.json({ imageUrl, historyId: historyItem.id })
    }

    // ── Z-Image ──────────────────────────────────────────────────────────────
    if (provider === 'z-image') {
      const imageUrl    = await generateWithSiliconFlow(finalPrompt, sfKey, 'Tongyi-MAI/Z-Image')
      cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'z-image' })
      const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
      addImageToLibrary(imageUrl, title, 'cover', [style, color], 'z-image')
      return res.json({ imageUrl, historyId: historyItem.id })
    }

    // ── Qwen Image Edit ──────────────────────────────────────────────────────
    if (provider === 'qwen-edit') {
      let baseBuffer: Buffer | null = null
      let baseType   = 'image/png'
      if (baseImageUrl) {
        if (baseImageUrl.startsWith('data:')) {
          const m = baseImageUrl.match(/^data:([^;]+);base64,(.+)$/)
          if (m) { baseType = m[1]; baseBuffer = Buffer.from(m[2], 'base64') }
        } else {
          const imgResp = await axios.get(baseImageUrl, { responseType: 'arraybuffer' })
          baseBuffer    = Buffer.from(imgResp.data)
          baseType      = String(imgResp.headers['content-type'] || 'image/png')
        }
      }
      if (!baseBuffer) return res.status(400).json({ error: 'Qwen 图片编辑需要先选择或生成一张基础封面。' })
      const imageUrl    = await generateWithQwenEdit(finalPrompt, sfKey, baseBuffer, baseType)
      const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
      addImageToLibrary(imageUrl, title, 'cover', [style, color], 'qwen-edit')
      return res.json({ imageUrl, historyId: historyItem.id })
    }

    res.status(400).json({ error: `未知的图片生成服务商：${provider}` })
  } catch (error: unknown) {
    const detail = errorDetail(error)
    logger.error('COVERS', '封面生成失败', { error: detail })
    res.status(500).json({ error: detail || '封面生成失败，请检查 API Key 和网络连接' })
  }
})

// ── POST /api/generate-covers-batch ──────────────────────────────────────────

router.post('/generate-covers-batch', async (req, res) => {
  try {
    const { covers, provider } = req.body
    if (!Array.isArray(covers) || covers.length === 0) return res.status(400).json({ error: '封面列表不能为空' })
    if (covers.length > 10) return res.status(400).json({ error: '单次最多生成 10 个封面' })

    const outcomes = await mapWithConcurrency(covers, 3, async (cover, i) => {
      try {
        const { title, content, style, color } = cover
        if (!title) return { error: { index: i, error: '标题不能为空' } }

        const cacheKey = generateCacheKey(title, style, color)
        const cached   = getCachedImage(cacheKey)
        if (cached) {
          const h = addToHistory(title, style, color, provider, cached.imageUrl, cacheKey)
          return { result: { index: i, title, imageUrl: cached.imageUrl, cached: true, historyId: h.id } }
        }

        if (provider === 'local') {
          const svg         = generatePlaceholderCover(title, style, color)
          const imageUrl    = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
          cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
          const h = addToHistory(title, style, color, provider, imageUrl, cacheKey)
          return { result: { index: i, title, imageUrl, cached: false, historyId: h.id } }
        }

        if (provider === 'openai') {
          try {
            const prompt   = generatePrompt(title, content || '', style, color)
            const imageUrl = await generateWithDallE(prompt, String(SERVER_AI_CONFIG.coverApiKey || SERVER_AI_CONFIG.articleApiKey || ''))
            cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'openai' })
            const h = addToHistory(title, style, color, provider, imageUrl, cacheKey)
            addImageToLibrary(imageUrl, title, 'cover', [style, color], 'openai')
            return { result: { index: i, title, imageUrl, cached: false, historyId: h.id } }
          } catch (error: unknown) {
            logger.warn('COVERS', '批量生成中的 DALL-E 请求失败，回退到本地封面', { title, error: errorMessage(error) })
            const svg      = generatePlaceholderCover(title, style, color)
            const imageUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
            cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
            const h = addToHistory(title, style, color, provider, imageUrl, cacheKey)
            return { result: { index: i, title, imageUrl, cached: false, historyId: h.id, warning: 'OpenAI DALL-E 生成失败，已使用本地模式' } }
          }
        }
        return { error: { index: i, error: `批量生成暂不支持服务商：${provider}` } }
      } catch (error: unknown) {
        return { error: { index: i, error: errorMessage(error) } }
      }
    })
    const results = outcomes.flatMap(outcome => outcome.result ? [outcome.result] : [])
    const errors = outcomes.flatMap(outcome => outcome.error ? [outcome.error] : [])

    res.json({ success: true, results, errors: errors.length > 0 ? errors : undefined, total: covers.length, succeeded: results.length, failed: errors.length })
  } catch (error: unknown) {
    logger.error('COVERS', '批量生成封面失败', { error: errorMessage(error) })
    res.status(500).json({ error: errorMessage(error) })
  }
})

// ── GET /api/cover-history ────────────────────────────────────────────────────

router.get('/cover-history', (_req, res) => {
  try {
    res.json(loadHistory())
  } catch (error: unknown) {
    res.status(500).json({ error: errorMessage(error) })
  }
})

// ── DELETE /api/cover-history/:id ────────────────────────────────────────────

router.delete('/cover-history/:id', (req, res) => {
  try {
    deleteCoverHistory(req.params.id)
    res.json({ success: true })
  } catch (error: unknown) {
    res.status(500).json({ error: errorMessage(error) })
  }
})

// ── DELETE /api/cover-history（清空）─────────────────────────────────────────

router.delete('/cover-history', (_req, res) => {
  try {
    clearCoverHistory()
    res.json({ success: true })
  } catch (error: unknown) {
    res.status(500).json({ error: errorMessage(error) })
  }
})

// ── GET /api/cache-stats ──────────────────────────────────────────────────────

router.get('/cache-stats', (_req, res) => {
  try {
    const history    = loadHistory()
    const cacheCount = getCoverCacheCount()
    res.json({
      historyCount: history.length,
      cacheCount,
      cacheSize: cacheCount > 0 ? `${(cacheCount * 0.05).toFixed(2)} MB` : '0 MB',
    })
  } catch (error: unknown) {
    res.status(500).json({ error: errorMessage(error) })
  }
})

export default router
