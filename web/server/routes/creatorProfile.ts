import { Router } from "express"
import { authMiddleware } from "../authMiddleware.ts"
import { getSetting, setSetting } from "../db.ts"
import { logger } from "../logger.ts"
import { normalizeCreatorWritingProfile } from "../../shared/contentProduction.ts"
import { getWritingAssetOverview } from "../writingAssets.ts"
import {
  analyzeCreatorPersona,
  PersonaAgentInputError,
} from "../personaAgent.ts"

const router = Router()
router.use(authMiddleware)

function profileKey(userId: string): string {
  return `creator_writing_profile:${userId}`
}

router.get("/assets", (req, res) => {
  try {
    res.json(getWritingAssetOverview(req.user.id))
  } catch (error: unknown) {
    logger.error("CREATOR_PROFILE", "读取写作资产概览失败", {
      error: error instanceof Error ? error.message : String(error),
      userId: req.user.id,
    })
    res.status(500).json({ error: "读取写作资产概览失败" })
  }
})

router.post("/persona/analyze", async (req, res) => {
  try {
    res.json(await analyzeCreatorPersona(req.user.id, req.body || {}))
  } catch (error: unknown) {
    logger.error("CREATOR_PROFILE", "分析账号人设失败", {
      error: error instanceof Error ? error.message : String(error),
      userId: req.user.id,
    })
    const status = error instanceof PersonaAgentInputError ? error.statusCode : 502
    res.status(status).json({
      error: error instanceof PersonaAgentInputError ? error.message : "人设分析失败，请稍后重试",
    })
  }
})

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
