/**
 * 服务入口
 * 路由拆分到 server/ 目录下各模块，保持本文件简洁
 */
import express from 'express'
import cors from 'cors'

// config.js 负责 dotenv 加载，必须最先 import
import { PORT, PROJECT_ROOT, DRAFTS_DIR, CACHE_DIR, SERVER_AI_CONFIG } from './server/config.js'

// 日志和监控系统
import { logger } from './server/logger.js'
import { performanceMonitorMiddleware } from './server/performanceMonitor.js'

// 路由模块
import articlesRouter  from './server/routes/articles.js'
import coversRouter    from './server/routes/covers.js'
import imagesRouter    from './server/routes/images.js'
import publishRouter   from './server/routes/publish.js'
import styleRouter     from './server/routes/style.js'
import ragRouter        from './server/routes/rag.js'
import templatesRouter  from './server/routes/templates.js'
import settingsRouter   from './server/routes/settings.js'
import materialsRouter  from './server/routes/materials.js'
import wechatRouter     from './server/routes/wechat.js'
import authRouter       from './server/routes/auth.js'
import adminRouter      from './server/routes/admin.js'
import monitoringRouter from './server/routes/monitoring.js'
import promptsRouter    from './server/routes/prompts.js'
import cronRouter        from './server/routes/cron.js'
import toutiaoRouter    from './server/routes/toutiao.js'

// Cron 调度器
import { initCronScheduler } from './server/cronEngine.js'

// 数据库初始化（建表 + 迁移旧数据 + 内置模板 seed）
import { upsertTemplate, listTemplates, db } from './server/db.js'
import { BUILTIN_TEMPLATES_DATA } from './server/builtinTemplates.js'
import { seedBuiltinPrompts } from './server/seedPrompts.js'

const app = express()

// ── 缓存清理任务（每天凌晨 2 点执行一次） ────────────────────────────────────────
// 删除 7 天前的过期缓存，减少磁盘占用
const CACHE_TTL_DAYS = 7
const CLEANUP_HOUR = 2  // 凌晨 2 点

function scheduleCleanup() {
  const now = new Date()
  const nextCleanup = new Date(now)
  nextCleanup.setHours(CLEANUP_HOUR, 0, 0, 0)
  if (nextCleanup <= now) {
    nextCleanup.setDate(nextCleanup.getDate() + 1)
  }
  
  const delay = nextCleanup.getTime() - now.getTime()
  
  setTimeout(() => {
    try {
      const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const deleted = db.prepare('DELETE FROM cover_cache WHERE cached_at < ?').run(cutoff).changes
      console.log(`[Cleanup] 删除过期缓存 ${deleted} 条（${cutoff} 之前）`)
    } catch (e) {
      console.error('[Cleanup] 缓存清理失败:', e.message)
    }
    scheduleCleanup()  // 递归调度下一次
  }, delay)
  
  console.log(`[Cleanup] 已调度缓存清理任务，下次执行时间：${nextCleanup.toLocaleString()}`)
}

scheduleCleanup()

// ── 中间件 ────────────────────────────────────────────────────────────────────
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

// 性能监控中间件（记录所有请求的响应时间和错误）
app.use(performanceMonitorMiddleware)

// ── 路由挂载 ──────────────────────────────────────────────────────────────────
app.use('/api/auth',       authRouter)
app.use('/api/admin',      adminRouter)
app.use('/api/articles',   articlesRouter)
app.use('/api',            coversRouter)    // covers 路由内部自带 /generate-cover 等路径
app.use('/api/images',     imagesRouter)
app.use('/api/publish',    publishRouter)
app.use('/api',            styleRouter)    // /api/generate-style
app.use('/api/rag',        ragRouter)       // RAG 向量索引管理
app.use('/api/templates',  templatesRouter)
app.use('/api/settings',   settingsRouter)
app.use('/api/materials',  materialsRouter) // 素材采集
app.use('/api/wechat',     wechatRouter)    // 微信公众号绑定
app.use('/api/monitoring', monitoringRouter) // 日志和监控（仅管理员可访问）
app.use('/api/prompts',    promptsRouter)   // 提示词管理
app.use('/api/cron',       cronRouter)      // 定时任务管理
app.use('/api/toutiao',    toutiaoRouter)   // 今日头条自动推送

// ── 杂项接口 ──────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/config/status', (_req, res) => {
  const hasMaasKey          = !!SERVER_AI_CONFIG.maasApiKey
  const hasOpenaiKey        = !!SERVER_AI_CONFIG.articleApiKey
  const hasCoverKey         = !!SERVER_AI_CONFIG.coverApiKey
  const hasStabilityKey     = !!SERVER_AI_CONFIG.stabilityApiKey
  const hasSiliconflowKey   = !!SERVER_AI_CONFIG.siliconflowApiKey

  let serverArticleProvider = SERVER_AI_CONFIG.articleProvider
  if (!serverArticleProvider || serverArticleProvider === 'openai') {
    if (hasMaasKey)        serverArticleProvider = 'maas'
    else if (hasOpenaiKey) serverArticleProvider = 'openai'
    else                   serverArticleProvider = null
  }

  res.json({
    articleProvider:  serverArticleProvider,
    articleReady:     hasMaasKey || hasOpenaiKey,
    maasReady:        hasMaasKey,
    maasEmail:        hasMaasKey ? SERVER_AI_CONFIG.maasUserEmail : null,
    openaiReady:      hasOpenaiKey,
    coverProvider:    SERVER_AI_CONFIG.coverProvider || 'local',
    coverReady:       hasCoverKey || hasStabilityKey || hasSiliconflowKey || SERVER_AI_CONFIG.coverProvider === 'local',
    dalleReady:       hasCoverKey,
    stabilityReady:   hasStabilityKey,
    siliconflowReady: hasSiliconflowKey,
  })
})

// ── 内置模板 seed（始终同步：每次启动时强制覆盖内置模板到最新版）──────────────
for (const t of BUILTIN_TEMPLATES_DATA) {
  upsertTemplate(t)
}
console.log(`[DB] 内置模板已同步（${BUILTIN_TEMPLATES_DATA.length} 个）`)

// ── 内置提示词 seed（始终同步：每次启动时检查并添加缺失的内置提示词）──────────
seedBuiltinPrompts()

// ── 启动 ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  // 初始化 Cron 调度器（在服务启动后）
  initCronScheduler()
  logger.info('SERVER', `服务启动成功`, {
    port: PORT,
    projectRoot: PROJECT_ROOT,
    draftsDir: DRAFTS_DIR,
    dbPath: `${CACHE_DIR}/../app.db`,
  })
  console.log(`Server running at http://localhost:${PORT}`)
  console.log(`Project root: ${PROJECT_ROOT}`)
  console.log(`Drafts dir:   ${DRAFTS_DIR}`)
  console.log(`DB path:      ${CACHE_DIR}/../app.db`)
})
