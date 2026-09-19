import { Router } from "express"
import { authMiddleware } from "../authMiddleware.ts"
import { WECHAT_ANALYTICS_CDP_URL } from "../config.ts"
import { collectWechatAnalytics } from "../wechatAnalyticsCollector.ts"
import {
  getWechatAnalyticsConfig,
  getWechatAnalyticsSnapshots,
  getWechatAnalyticsState,
  saveWechatAnalyticsConfig,
  saveWechatAnalyticsSnapshot,
} from "../wechatAnalyticsStore.ts"
import { wechatAnalyticsSchema } from "../../shared/wechatAnalytics.ts"

const router = Router()
router.use(authMiddleware)
router.get("/", (req, res) => {
  res.json({
    snapshots: getWechatAnalyticsSnapshots(req.user.id),
    config: getWechatAnalyticsConfig(req.user.id),
    state: getWechatAnalyticsState(req.user.id),
    collectorAvailable: Boolean(WECHAT_ANALYTICS_CDP_URL),
  })
})

router.post("/", (req, res) => {
  const parsed = wechatAnalyticsSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || "数据快照格式不正确" })
    return
  }
  try {
    res.json(saveWechatAnalyticsSnapshot(req.user.id, parsed.data))
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "快照保存失败，请检查关联稿件" })
  }
})

router.post("/collect", async (req, res) => {
  try {
    const snapshot = await collectWechatAnalytics(req.user.id)
    res.json({
      snapshot,
      config: getWechatAnalyticsConfig(req.user.id),
      state: getWechatAnalyticsState(req.user.id),
    })
  } catch (error) {
    res.status(503).json({
      error: error instanceof Error ? error.message : "微信数据采集失败",
      state: getWechatAnalyticsState(req.user.id),
    })
  }
})

router.put("/config", (req, res) => {
  try {
    res.json(saveWechatAnalyticsConfig(req.user.id, req.body))
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "刷新配置不正确" })
  }
})

export default router
