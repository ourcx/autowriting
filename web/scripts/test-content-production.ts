import assert from "node:assert/strict"
import {
  auditArticleSources,
  comparePlatformVersions,
  formatCreatorProfileForPrompt,
  normalizeCreatorWritingProfile,
} from "../shared/contentProduction.ts"
import { acquireCandidate, CandidateError } from "../server/generationCandidates.ts"
import { rankWechatArticles, wechatAnalyticsSchema } from "../shared/wechatAnalytics.ts"

const profile = normalizeCreatorWritingProfile({
  audience: "大学生",
  tone: "直接",
  bannedPhrases: "赋能、闭眼冲",
  defaultPlatforms: ["wechat", "toutiao", "unknown"],
  visualStyle: "少装饰",
})
assert.deepEqual(profile.bannedPhrases, ["赋能", "闭眼冲"])
assert.deepEqual(profile.defaultPlatforms, ["wechat", "toutiao"])
assert.match(formatCreatorProfileForPrompt(profile), /视觉倾向：少装饰/)

const comparison = comparePlatformVersions(
  "# 标题\n\n第一段内容保持完全一致。\n\n第二段内容需要进行平台改写。",
  "# 新标题\n\n第一段内容保持完全一致。\n\n第二段已经针对平台完成缩短。",
)
assert.equal(comparison.changed, true)
assert.equal(comparison.sharedParagraphPercent, 50)

const audit = auditArticleSources(
  "2026 年共有 120 人参加。预计 2027 年增长到 150 人。",
  "[学校通知](https://example.edu/notice) 显示，2026 年共有 120 人参加。",
)
assert.equal(audit.sources.length, 1)
assert.equal(audit.claims.length, 2)
assert.equal(audit.unsupportedCount, 1)

const analytics = wechatAnalyticsSchema.parse({
  version: 1,
  source: "wechat-browser",
  accountName: "测试账号",
  collectedAt: "2026-09-19T10:00:00.000Z",
  period: { start: "2026-08-20", end: "2026-09-18" },
  scope: "period-article-list",
  metric: "period-readers",
  collection: { complete: true, nextOffset: 0 },
  trafficSources: [{ name: "推荐", percent: 50 }],
  articles: Array.from({ length: 8 }, (_, index) => ({
    id: `${1000 + index}_1`,
    title: `文章 ${index + 1}`,
    publishedAt: "2026-09-01",
    reads: 800 - index * 100,
    shareOfReads: 12.5,
  })),
})
const ranked = rankWechatArticles(analytics)
assert.equal(ranked[0].band, "high")
assert.equal(ranked.at(-1)?.band, "low")
assert.equal(ranked[0].rank, 1)
assert.equal(ranked.at(-1)?.rank, 8)

const releaseCandidates = [
  acquireCandidate("concurrency-test-user", "candidate-1"),
  acquireCandidate("concurrency-test-user", "candidate-2"),
  acquireCandidate("concurrency-test-user", "candidate-3"),
]
try {
  assert.throws(
    () => acquireCandidate("concurrency-test-user", "candidate-4"),
    (error: unknown) => error instanceof CandidateError && error.statusCode === 429,
  )
} finally {
  releaseCandidates.forEach(release => release())
}

console.log("账号写作档案、平台版本对比与事实来源检查通过")
