import { z } from "zod"

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, "日期不正确")
const percent = z.number().finite().min(0).max(100)
export const wechatAnalyticsSchema = z.object({
  version: z.literal(1),
  source: z.literal("wechat-browser"),
  accountName: z.string().trim().min(1).max(100),
  collectedAt: z.string().datetime(),
  period: z.object({ start: date, end: date }).refine(value => value.start <= value.end, "统计起止日期不正确"),
  scope: z.enum(["visible-ranking", "period-article-list"]),
  metric: z.literal("period-readers"),
  collection: z.object({
    complete: z.boolean(),
    nextOffset: z.number().int().nonnegative(),
  }).default({ complete: false, nextOffset: 0 }),
  trafficSources: z.array(z.object({ name: z.string().max(100), percent })).max(30),
  articles: z.array(z.object({
    id: z.string().regex(/^\d+_\d+$/),
    title: z.string().trim().min(1).max(300),
    publishedAt: date,
    reads: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    shareOfReads: percent,
    localArticleId: z.string().max(160).nullable().optional(),
  })).min(1).max(500),
}).superRefine((value, context) => {
  if (new Set(value.articles.map(item => item.id)).size !== value.articles.length) context.addIssue({ code: "custom", message: "快照中存在重复文章" })
  if (value.articles.some(item => item.publishedAt > value.period.end)) context.addIssue({ code: "custom", message: "文章发布时间晚于统计截止日期" })
})

export type WechatAnalyticsSnapshot = z.infer<typeof wechatAnalyticsSchema>
export type WechatAttentionBand = "high" | "middle" | "low"

export type RankedWechatArticle = WechatAnalyticsSnapshot["articles"][number] & {
  rank: number
  percentile: number
  band: WechatAttentionBand
}

export function rankWechatArticles(snapshot: WechatAnalyticsSnapshot): RankedWechatArticle[] {
  const sorted = [...snapshot.articles].sort((left, right) => right.reads - left.reads || left.id.localeCompare(right.id))
  const last = Math.max(1, sorted.length - 1)
  return sorted.map((article, index) => {
    const percentile = Math.round((1 - index / last) * 100)
    return {
      ...article,
      rank: index + 1,
      percentile,
      band: sorted.length < 8 ? "middle" : percentile >= 75 ? "high" : percentile <= 25 ? "low" : "middle",
    }
  })
}

export function analyzeTopic(snapshot: WechatAnalyticsSnapshot, keyword: string) {
  const articles = rankWechatArticles(snapshot).filter(item => item.title.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()))
  const sorted = articles.map(item => item.reads).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return {
    articles,
    medianReaders: !sorted.length ? null : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    olderArticles: articles.filter(item => item.publishedAt < snapshot.period.start).length,
    // Never sum readers across articles: the same person can read several.
    observation: articles.length < 3 ? "匹配样本少于 3 篇，先收集素材，再验证兴趣。"
      : "同主题有多篇文章获得阅读，值得补充同发布时长数据，继续验证。",
  }
}

export function topicBrief(snapshot: WechatAnalyticsSnapshot, keyword: string, question: string, materials: string) {
  const result = analyzeTopic(snapshot, keyword)
  return {
    title: question.trim(),
    task: `# 选题任务\n\n文章主题：${question.trim()}\n\n面向账号「${snapshot.accountName}」的读者，先核实事实，再形成个人判断。\n\n## 选题依据\n统计窗口 ${snapshot.period.start} 至 ${snapshot.period.end}，采集到的文章中有 ${result.articles.length} 篇标题包含「${keyword || "全部"}」。${result.observation}\n这是选题假设，不是阅读效果承诺。写法以作者确认的取舍为准。\n\n## 写作前还需确认\n- 这件事与读者有什么直接关系？\n- 有哪些一手资料、亲身观察或采访可用？\n- 哪些事实已改变，哪些说法尚未核实？`,
    materials: `# 选题观察记录\n\n来源：微信后台内容分析，${snapshot.period.start} 至 ${snapshot.period.end}。指标为期间阅读人数，不代表发布后累计阅读，跨篇人数不可相加。\n\n${result.articles.map(item => `- ${item.title}（${item.publishedAt} 发布；期间 ${item.reads} 人；同期第 ${item.rank}/${snapshot.articles.length}${item.localArticleId ? `；工作台稿件 ${item.localArticleId}` : ""}）`).join("\n")}\n\n## 我已经收集的线索\n${materials.trim() || "待补充：原始公告链接、观察记录、采访对象、反例。"}\n\n## 待核实\n- 原始公告及更新时间\n- 同发布时间长度、同账号体量和流量来源下的表现\n- 读者实际反馈，避免只凭阅读人数判断`,
  }
}
