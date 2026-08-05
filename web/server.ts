/**
 * 服务入口
 */
import express from "express"
import cors from "cors"
import { PORT, PROJECT_ROOT, DRAFTS_DIR, CACHE_DIR, SERVER_AI_CONFIG } from "./server/config.ts"
import { logger } from "./server/logger.ts"
import { performanceMonitorMiddleware } from "./server/performanceMonitor.ts"
import articlesRouter from "./server/routes/articles.ts"
import coversRouter from "./server/routes/covers.ts"
import imagesRouter from "./server/routes/images.ts"
import publishRouter from "./server/routes/publish.ts"
import styleRouter from "./server/routes/style.ts"
import ragRouter from "./server/routes/rag.ts"
import templatesRouter from "./server/routes/templates.ts"
import settingsRouter from "./server/routes/settings.ts"
import materialsRouter from "./server/routes/materials.ts"
import wechatRouter from "./server/routes/wechat.ts"
import authRouter from "./server/routes/auth.ts"
import adminRouter from "./server/routes/admin.ts"
import monitoringRouter from "./server/routes/monitoring.ts"
import promptsRouter from "./server/routes/prompts.ts"
import cronRouter from "./server/routes/cron.ts"
import toutiaoRouter from "./server/routes/toutiao.ts"
import scoresRouter from "./server/routes/scores.ts"
import xiaohongshuRouter from "./server/routes/xiaohongshu.ts"
import agentRouter from "./server/routes/agent.ts"
import { validateArticleId } from "./server/articleIdMiddleware.ts"
import { initCronScheduler } from "./server/cronEngine.ts"
import { upsertTemplate, db } from "./server/db.ts"
import { BUILTIN_TEMPLATES_DATA } from "./server/builtinTemplates.ts"
import { seedBuiltinPrompts } from "./server/seedPrompts.ts"
import { cleanupXiaohongshuDebugArtifacts } from "./server/utils/public.ts"

const app = express()

const CACHE_TTL_DAYS = 7
const CLEANUP_HOUR = 2

function scheduleCleanup(): void {
  const now = new Date()
  const nextCleanup = new Date(now)
  nextCleanup.setHours(CLEANUP_HOUR, 0, 0, 0)
  if (nextCleanup <= now) nextCleanup.setDate(nextCleanup.getDate() + 1)
  const delay = nextCleanup.getTime() - now.getTime()
  setTimeout(() => {
    try {
      const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const deleted = (db.prepare("DELETE FROM cover_cache WHERE cached_at < ?").run(cutoff) as { changes: number }).changes
      const debugCleanup = cleanupXiaohongshuDebugArtifacts()
      logger.info("CLEANUP", "清理任务完成", { coverCacheDeleted: deleted, ...debugCleanup })
    } catch (error: unknown) {
      logger.error("CLEANUP", "清理任务失败", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    scheduleCleanup()
  }, delay)
  logger.info("CLEANUP", "已安排下次清理", { nextCleanup: nextCleanup.toISOString() })
}

try {
  const startupCleanup = cleanupXiaohongshuDebugArtifacts()
  if (startupCleanup.deleted > 0) {
    logger.info("CLEANUP", "启动时已清理小红书调试工件", startupCleanup)
  }
} catch (error: unknown) {
  logger.warn("CLEANUP", "启动时清理小红书调试工件失败", {
    error: error instanceof Error ? error.message : String(error),
  })
}
scheduleCleanup()

app.use(cors())
app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ limit: "50mb", extended: true }))
app.use(performanceMonitorMiddleware)

app.use("/api/auth", authRouter)
app.use("/api/agent", agentRouter)
app.use("/api/admin", adminRouter)
app.use("/api/articles/:articleId", validateArticleId)
app.use("/api/articles", articlesRouter)
app.use("/api", coversRouter)
app.use("/api/images", imagesRouter)
app.use("/api/publish", publishRouter)
app.use("/api", styleRouter)
app.use("/api/rag", ragRouter)
app.use("/api/templates", templatesRouter)
app.use("/api/settings", settingsRouter)
app.use("/api/materials", materialsRouter)
app.use("/api/wechat", wechatRouter)
app.use("/api/monitoring", monitoringRouter)
app.use("/api/prompts", promptsRouter)
app.use("/api/cron", cronRouter)
app.use("/api/toutiao", toutiaoRouter)
app.use("/api/scores", scoresRouter)
app.use("/api/xiaohongshu", xiaohongshuRouter)

app.get("/health", (_req, res) => { res.json({ status: "ok" }) })

app.get("/api/config/status", (_req, res) => {
  const hasMaasKey = !!(SERVER_AI_CONFIG.maasApiKey)
  const hasOpenaiKey = !!(SERVER_AI_CONFIG.articleApiKey)
  const hasCoverKey = !!(SERVER_AI_CONFIG.coverApiKey)
  const hasStabilityKey = !!(SERVER_AI_CONFIG.stabilityApiKey)
  const hasSiliconflowKey = !!(SERVER_AI_CONFIG.siliconflowApiKey)
  let provider: string | null = (SERVER_AI_CONFIG.articleProvider as string) || null
  if (!provider || provider === "openai") {
    if (hasMaasKey) provider = "maas"
    else if (hasOpenaiKey) provider = "openai"
    else provider = null
  }
  res.json({
    articleProvider: provider, articleReady: hasMaasKey || hasOpenaiKey,
    maasReady: hasMaasKey, maasEmail: hasMaasKey ? SERVER_AI_CONFIG.maasUserEmail : null,
    openaiReady: hasOpenaiKey, coverProvider: (SERVER_AI_CONFIG.coverProvider as string) || "local",
    coverReady: !!(hasCoverKey || hasStabilityKey || hasSiliconflowKey || (SERVER_AI_CONFIG.coverProvider === "local")),
    dalleReady: hasCoverKey, stabilityReady: hasStabilityKey, siliconflowReady: hasSiliconflowKey,
  })
})

for (const t of BUILTIN_TEMPLATES_DATA) { upsertTemplate(t) }
console.log(`[DB] 内置模板已同步（${BUILTIN_TEMPLATES_DATA.length} 个）`)
seedBuiltinPrompts()

app.listen(PORT, () => {
  initCronScheduler()
  logger.info("SERVER", "服务启动成功", { port: PORT, projectRoot: PROJECT_ROOT, draftsDir: DRAFTS_DIR, dbPath: `${CACHE_DIR}/../app.db` })
  console.log(`Server running at http://localhost:${PORT}`)
})
