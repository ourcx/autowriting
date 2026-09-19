import { getSetting, setSetting } from "./db.ts"
import { findArticleIdByTitle, readArticleContent, resolveArticleFiles } from "./articleStorage.ts"
import { rankWechatArticles, wechatAnalyticsSchema, type WechatAnalyticsSnapshot } from "../shared/wechatAnalytics.ts"

export interface WechatAnalyticsState {
  status: "idle" | "collecting" | "succeeded" | "failed"
  lastAttemptAt?: string
  lastSuccessAt?: string
  nextRunAt?: string
  message?: string
}

const snapshotsKey = (userId: string) => `wechat_analytics:${userId}`
const stateKey = (userId: string) => `wechat_analytics_state:${userId}`

export function getWechatAnalyticsSnapshots(userId: string): WechatAnalyticsSnapshot[] {
  const value = getSetting(snapshotsKey(userId))
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const parsed = wechatAnalyticsSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

export function saveWechatAnalyticsSnapshot(userId: string, input: unknown): WechatAnalyticsSnapshot {
  const snapshot = wechatAnalyticsSchema.parse(input)
  const snapshots = getWechatAnalyticsSnapshots(userId)
  const previous = snapshots.find(item =>
    item.accountName === snapshot.accountName
    && item.period.start === snapshot.period.start
    && item.period.end === snapshot.period.end
  )
  for (const article of snapshot.articles) {
    if (article.localArticleId) {
      if (!readArticleContent(resolveArticleFiles(userId, article.localArticleId).article).article.trim()) {
        throw new Error("关联稿件不存在或不属于当前账号")
      }
    } else if (article.localArticleId === undefined) {
      article.localArticleId = previous?.articles.find(item => item.id === article.id)?.localArticleId
        || findArticleIdByTitle(userId, article.title)
    }
  }
  const next = [snapshot, ...snapshots.filter(item => item !== previous)].slice(0, 24)
  setSetting(snapshotsKey(userId), next)
  return snapshot
}

export function getWechatAnalyticsState(userId: string): WechatAnalyticsState {
  const value = getSetting(stateKey(userId))
  if (!value || typeof value !== "object") return { status: "idle" }
  const source = value as Record<string, unknown>
  const status = ["idle", "collecting", "succeeded", "failed"].includes(String(source.status))
    ? source.status as WechatAnalyticsState["status"]
    : "idle"
  return {
    status,
    ...(typeof source.lastAttemptAt === "string" ? { lastAttemptAt: source.lastAttemptAt } : {}),
    ...(typeof source.lastSuccessAt === "string" ? { lastSuccessAt: source.lastSuccessAt } : {}),
    ...(typeof source.nextRunAt === "string" ? { nextRunAt: source.nextRunAt } : {}),
    ...(typeof source.message === "string" ? { message: source.message.slice(0, 300) } : {}),
  }
}

export function saveWechatAnalyticsState(userId: string, state: WechatAnalyticsState): void {
  setSetting(stateKey(userId), state)
}

export function isWechatAnalyticsPrivateKey(key: string): boolean {
  return /^wechat_analytics(?:_config|_state)?:/.test(key)
}

export function formatWechatAudienceEvidence(userId: string): string {
  const snapshot = getWechatAnalyticsSnapshots(userId)[0]
  if (!snapshot) return ""
  const ranked = rankWechatArticles(snapshot)
  const selected = ranked.filter(item => item.band !== "middle").map(item => ({
    title: item.title,
    publishedAt: item.publishedAt,
    readersInPeriod: item.reads,
    rank: `${item.rank}/${ranked.length}`,
    relativeAttention: item.band === "high" ? "高关注" : "低关注",
    linkedArticleId: item.localArticleId,
  }))
  return `# 读者关注记录
统计窗口：${snapshot.period.start} 至 ${snapshot.period.end}；指标：期间阅读人数；样本：${snapshot.articles.length} 篇。
这些是同一窗口里的相对位置，受选题、发布时间、账号体量、推荐流量和旧文长尾影响。只能用于提出选题假设，不得据此模仿或否定句式、篇幅、模板。
${JSON.stringify(selected)}
`
}
