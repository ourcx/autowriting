/**
 * 服务入口
 * 路由拆分到 server/ 目录下各模块，保持本文件简洁
 */
import express from 'express'
import cors from 'cors'

// config.js 负责 dotenv 加载，必须最先 import
import { PORT, PROJECT_ROOT, DRAFTS_DIR, CACHE_DIR, SERVER_AI_CONFIG } from './server/config.js'

// 路由模块
import articlesRouter  from './server/routes/articles.js'
import coversRouter    from './server/routes/covers.js'
import imagesRouter    from './server/routes/images.js'
import publishRouter   from './server/routes/publish.js'
import styleRouter     from './server/routes/style.js'
import ragRouter       from './server/routes/rag.js'
import templatesRouter from './server/routes/templates.js'
import settingsRouter  from './server/routes/settings.js'

// 数据库初始化（建表 + 迁移旧数据 + 内置模板 seed）
import { upsertTemplate, listTemplates } from './server/db.js'
import { BUILTIN_TEMPLATES_DATA } from './server/builtinTemplates.js'

const app = express()

// ── 中间件 ────────────────────────────────────────────────────────────────────
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

// ── 路由挂载 ──────────────────────────────────────────────────────────────────
app.use('/api/articles',   articlesRouter)
app.use('/api',            coversRouter)    // covers 路由内部自带 /generate-cover 等路径
app.use('/api/images',     imagesRouter)
app.use('/api/publish',    publishRouter)
app.use('/api',            styleRouter)    // /api/generate-style
app.use('/api/rag',        ragRouter)      // RAG 向量索引管理
app.use('/api/templates',  templatesRouter)
app.use('/api/settings',   settingsRouter)

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

// ── 内置模板 seed（首次启动时写入）──────────────────────────────────────────
const existingTemplates = listTemplates()
if (!existingTemplates.some(t => t.isBuiltin)) {
  for (const t of BUILTIN_TEMPLATES_DATA) {
    upsertTemplate(t)
  }
  console.log(`[DB] 已写入 ${BUILTIN_TEMPLATES_DATA.length} 个内置模板`)
}

// ── 启动 ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
  console.log(`Project root: ${PROJECT_ROOT}`)
  console.log(`Drafts dir:   ${DRAFTS_DIR}`)
  console.log(`DB path:      ${CACHE_DIR}/../app.db`)
})
