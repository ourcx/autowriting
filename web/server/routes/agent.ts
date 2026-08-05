import { Router } from "express"
import { authMiddleware } from "../authMiddleware.ts"

const router = Router()
router.use(authMiddleware)

router.get("/status", (req, res) => {
  res.json({
    enabled: true,
    user: {
      id: req.user!.id,
      username: req.user!.username,
      role: req.user!.role,
    },
    capabilities: {
      articles: [
        "GET /api/articles",
        "GET /api/articles/:articleId",
        "POST /api/articles/:articleId",
        "POST /api/articles/:articleId/generate",
        "DELETE /api/articles/:articleId",
      ],
      publishing: [
        "POST /api/toutiao/publish",
        "POST /api/xiaohongshu/publish",
      ],
    },
  })
})

export default router
