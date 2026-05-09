/**
 * 服务入口
 * 路由拆分到 server/ 目录下各模块，保持本文件简洁
 */
import express from 'express'
import cors from 'cors'

// config.js 负责 dotenv 加载，必须最先 import
import { PORT, PROJECT_ROOT, DRAFTS_DIR, CACHE_DIR, SERVER_AI_CONFIG } from './server/config.js'

// 路由模块
import articlesRouter from './server/routes/articles.js'
import coversRouter   from './server/routes/covers.js'
import imagesRouter   from './server/routes/images.js'
import publishRouter  from './server/routes/publish.js'
import styleRouter    from './server/routes/style.js'

const app = express()

// ── 中间件 ────────────────────────────────────────────────────────────────────
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

// ── 路由挂载 ──────────────────────────────────────────────────────────────────
app.use('/api/articles',  articlesRouter)
app.use('/api',           coversRouter)    // covers 路由内部自带 /generate-cover 等路径
app.use('/api/images',    imagesRouter)
app.use('/api/publish',   publishRouter)
app.use('/api',           styleRouter)    // /api/generate-style

// ── 杂项接口 ──────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/config/status', (_req, res) => {
  const hasMaasKey      = !!SERVER_AI_CONFIG.maasApiKey
  const hasOpenaiKey    = !!SERVER_AI_CONFIG.articleApiKey
  const hasCoverKey     = !!SERVER_AI_CONFIG.coverApiKey
  const hasStabilityKey = !!SERVER_AI_CONFIG.stabilityApiKey

  let serverArticleProvider = SERVER_AI_CONFIG.articleProvider
  if (!serverArticleProvider || serverArticleProvider === 'openai') {
    if (hasMaasKey)     serverArticleProvider = 'maas'
    else if (hasOpenaiKey) serverArticleProvider = 'openai'
    else serverArticleProvider = null
  }

  res.json({
    articleProvider: serverArticleProvider,
    articleReady:    hasMaasKey || hasOpenaiKey,
    maasReady:       hasMaasKey,
    maasEmail:       hasMaasKey ? SERVER_AI_CONFIG.maasUserEmail : null,
    openaiReady:     hasOpenaiKey,
    coverProvider:   SERVER_AI_CONFIG.coverProvider || 'local',
    coverReady:      hasCoverKey || hasStabilityKey || SERVER_AI_CONFIG.coverProvider === 'local',
    dalleReady:      hasCoverKey,
    stabilityReady:  hasStabilityKey,
  })
})

// ── 启动 ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`)
  console.log(`📁 Project root: ${PROJECT_ROOT}`)
  console.log(`📝 Drafts directory: ${DRAFTS_DIR}`)
  console.log(`💾 Cache directory: ${CACHE_DIR}`)
})
