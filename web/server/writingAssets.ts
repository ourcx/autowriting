import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { DRAFTS_DIR, GENERATION_CANDIDATE_DIR } from "./config.ts"
import { getSetting, listArticleScores, listPrompts } from "./db.ts"
import { listCreatorExperiences } from "./productionJournal.ts"
import { getWechatAnalyticsSnapshots } from "./wechatAnalyticsStore.ts"
import { rankWechatArticles } from "../shared/wechatAnalytics.ts"
import {
  getCompletedWritingDnaLayers,
  normalizeCreatorWritingProfile,
} from "../shared/contentProduction.ts"

interface CandidateStats {
  total: number
  complete: number
}

function countCandidateFiles(userId: string): CandidateStats {
  const userDirectory = path.join(
    GENERATION_CANDIDATE_DIR,
    crypto.createHash("sha256").update(userId).digest("hex"),
  )
  if (!fs.existsSync(userDirectory)) return { total: 0, complete: 0 }
  const statuses: unknown[] = []
  for (const articleDirectory of fs.readdirSync(userDirectory, { withFileTypes: true })) {
    if (!articleDirectory.isDirectory()) continue
    const directory = path.join(userDirectory, articleDirectory.name)
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue
      try {
        const value = JSON.parse(fs.readFileSync(path.join(directory, entry.name), "utf8")) as { status?: unknown }
        statuses.push(value.status)
      } catch {
        statuses.push(undefined)
        // Corrupted candidate files stay untouched and are excluded from completed totals.
      }
    }
  }
  return {
    total: statuses.length,
    complete: statuses.filter(status => status === "complete").length,
  }
}

function countMaterialArticles(userId: string): number {
  const userDirectory = path.join(DRAFTS_DIR, userId)
  if (!fs.existsSync(userDirectory)) return 0
  const articleDirectories = new Set<string>()
  for (const articleDirectory of fs.readdirSync(userDirectory, { withFileTypes: true })) {
    if (!articleDirectory.isDirectory()) continue
    const promptDirectory = path.join(userDirectory, articleDirectory.name, "prompt")
    if (!fs.existsSync(promptDirectory)) continue
    const hasMaterials = fs.readdirSync(promptDirectory, { withFileTypes: true }).some(entry => {
      if (!entry.isFile() || !/^materials.*\.md$/.test(entry.name)) return false
      return fs.statSync(path.join(promptDirectory, entry.name)).size > 0
    })
    if (hasMaterials) articleDirectories.add(articleDirectory.name)
  }
  return articleDirectories.size
}

export function getWritingAssetOverview(userId: string) {
  const profile = normalizeCreatorWritingProfile(getSetting(`creator_writing_profile:${userId}`))
  const memory = getSetting(`global_memory:${userId}`)
  const experiences = listCreatorExperiences(userId)
  const candidates = countCandidateFiles(userId)
  const highPerformance = new Set<string>()
  const lowPerformance = new Set<string>()

  for (const score of listArticleScores(userId)) {
    if (typeof score.composite !== "number") continue
    if (score.composite >= 70) highPerformance.add(`score:${score.articleId}`)
    if (score.composite <= 30) lowPerformance.add(`score:${score.articleId}`)
  }

  const snapshot = getWechatAnalyticsSnapshots(userId)[0]
  if (snapshot) {
    for (const article of rankWechatArticles(snapshot)) {
      if (article.band === "high") highPerformance.add(`wechat:${article.id}`)
      if (article.band === "low") lowPerformance.add(`wechat:${article.id}`)
    }
  }

  return {
    summary: {
      dnaLayersCompleted: getCompletedWritingDnaLayers(profile).length,
      memoryCharacters: typeof memory === "string" ? Array.from(memory).length : 0,
      promptCount: listPrompts().length,
      materialArticleCount: countMaterialArticles(userId),
      candidateCount: candidates.total,
      completedCandidateCount: candidates.complete,
      confirmedChoiceCount: experiences.length,
      highPerformanceCount: highPerformance.size,
      lowPerformanceCount: lowPerformance.size,
    },
    recentConfirmedChoices: experiences.slice(0, 8),
  }
}
