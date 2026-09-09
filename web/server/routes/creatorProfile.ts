import { Router } from "express"
import { authMiddleware } from "../authMiddleware.ts"
import { getSetting, setSetting } from "../db.ts"
import { logger } from "../logger.ts"
import { normalizeCreatorWritingProfile } from "../../shared/contentProduction.ts"

const router = Router()
router.use(authMiddleware)

function profileKey(userId: string): string {
  return `creator_writing_profile:${userId}`
}

router.get("/", (req, res) => {
  try {
    res.json(normalizeCreatorWritingProfile(getSetting(profileKey(req.user.id))))
  } catch (error: unknown) {
    logger.error("CREATOR_PROFILE", "读取账号写作档案失败", {
      error: error instanceof Error ? error.message : String(error),
      userId: req.user.id,
    })
    res.status(500).json({ error: "读取账号写作档案失败" })
  }
})

router.put("/", (req, res) => {
  try {
    const profile = normalizeCreatorWritingProfile(req.body)
    setSetting(profileKey(req.user.id), profile)
    res.json(profile)
  } catch (error: unknown) {
    logger.error("CREATOR_PROFILE", "保存账号写作档案失败", {
      error: error instanceof Error ? error.message : String(error),
      userId: req.user.id,
    })
    res.status(500).json({ error: "保存账号写作档案失败" })
  }
})

export default router
