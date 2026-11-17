import { Router } from "express"
import { rateLimit } from "express-rate-limit"
import { authMiddleware } from "../authMiddleware.ts"
import { acceptBrowserModelFrame, openBrowserModelSession } from "../browserModel.ts"

const router = Router()
router.use(authMiddleware)

router.post("/open", (req, res) => {
  openBrowserModelSession(req.user.id, res)
})

const frameLimit = rateLimit({
  windowMs: 60_000,
  limit: 360,
  keyGenerator: req => req.user.id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
})

router.post("/:sessionId/:jobId", frameLimit, (req, res) => {
  if (!acceptBrowserModelFrame(req.user.id, String(req.params.sessionId), String(req.params.jobId), req.body)) {
    res.status(409).json({ error: "浏览器模型请求已结束或无效" })
    return
  }
  res.sendStatus(204)
})

export default router
