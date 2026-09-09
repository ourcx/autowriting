import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, BarChart3, CheckCircle2, ExternalLink, FileSearch, GitCompare } from "lucide-react"
import {
  auditArticleSources,
  comparePlatformVersions,
} from "../../../shared/contentProduction"
import { fetchProductionInsights, type ProductionInsights } from "../../utils/apiHelpers"
import type { ArticleWorkflow } from "../../../shared/articleWorkflow"
import "./ProductionGuidance.css"

const PLATFORM_LABEL = { wechat: "公众号", toutiao: "今日头条", xiaohongshu: "小红书" }

export function PlatformVersionSummary({ source, target, platform }: {
  source: string
  target: string
  platform: "toutiao" | "xiaohongshu"
}) {
  const comparison = useMemo(() => comparePlatformVersions(source, target), [source, target])
  if (!target.trim()) return (
    <div className="pg-version pg-version--empty">
      <GitCompare size={15} /> 尚未生成{PLATFORM_LABEL[platform]}版本，公众号正文会继续作为事实与观点母稿。
    </div>
  )
  return (
    <div className="pg-version">
      <div><GitCompare size={15} /><strong>与公众号母稿对比</strong></div>
      <span>{comparison.targetCharacters} 字</span>
      <span>{comparison.lengthDeltaPercent >= 0 ? "+" : ""}{comparison.lengthDeltaPercent}% 长度</span>
      <span>{comparison.sharedParagraphPercent}% 段落原样保留</span>
      <span className={comparison.changed ? "pg-version-state" : "pg-version-state pg-version-state--same"}>
        {comparison.changed ? "已有平台改写" : "与母稿相同"}
      </span>
    </div>
  )
}

export default function ProductionGuidance({ article, materials, articleToutiao, workflow }: {
  article: string
  materials: string
  articleToutiao: string
  workflow: ArticleWorkflow
}) {
  const sourceAudit = useMemo(() => auditArticleSources(article, materials), [article, materials])
  const [insights, setInsights] = useState<ProductionInsights | null>(null)

  useEffect(() => {
    fetchProductionInsights().then(setInsights).catch(() => setInsights(null))
  }, [])

  return (
    <div className="pg-grid">
      <section className="pg-card" aria-label="事实来源检查">
        <div className="pg-card-head">
          <div><FileSearch size={17} /><h3>事实来源边界</h3></div>
          <span className={sourceAudit.unsupportedCount ? "pg-risk" : "pg-ok"}>
            {sourceAudit.unsupportedCount ? `${sourceAudit.unsupportedCount} 条待核对` : "数字均可回查"}
          </span>
        </div>
        <p className="pg-help">检查正文中的数字和日期是否能在本篇素材中找到。这里只做发布前提醒，不替代人工核实。</p>
        {sourceAudit.claims.length ? (
          <div className="pg-claims">
            {sourceAudit.claims.map((claim, index) => (
              <div key={`${claim.text}-${index}`} className={claim.supported ? "pg-claim pg-claim--ok" : "pg-claim pg-claim--risk"}>
                {claim.supported ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                <span>{claim.text}</span>
              </div>
            ))}
          </div>
        ) : <p className="pg-empty">正文暂未识别到需要核对的数字或日期。</p>}
        <div className="pg-sources">
          <strong>素材来源 {sourceAudit.sources.length}</strong>
          {sourceAudit.sources.slice(0, 5).map(source => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}<ExternalLink size={11} /></a>
          ))}
          {!sourceAudit.sources.length && <span>素材中没有可点击来源链接</span>}
        </div>
      </section>

      <section className="pg-card" aria-label="历史表现参考">
        <div className="pg-card-head">
          <div><BarChart3 size={17} /><h3>历史表现参考</h3></div>
          <span>{insights?.sampleSize || 0} 条评分</span>
        </div>
        {!insights?.sampleSize ? (
          <p className="pg-empty">还没有文章表现数据。发布后在“文章评分”录入阅读、点赞和转发，后续生成会自动参考高表现文章。</p>
        ) : (
          <>
            <div className="pg-patterns">
              <div><span>高表现标题</span><strong>约 {insights.patterns.averageTitleCharacters ?? "—"} 字</strong></div>
              <div><span>高表现正文</span><strong>约 {insights.patterns.averageArticleCharacters ?? "—"} 字</strong></div>
              <div><span>平均分最佳平台</span><strong>{insights.patterns.bestPlatform ? PLATFORM_LABEL[insights.patterns.bestPlatform.platform] : "—"}</strong></div>
            </div>
            <div className="pg-top-list">
              {insights.topArticles.slice(0, 3).map(item => (
                <div key={`${item.articleId}-${item.platform}`}>
                  <span>{PLATFORM_LABEL[item.platform]} · {item.composite} 分{item.templateId ? ` · ${item.templateId}` : ""}</span>
                  <strong title={`${item.promptIds.length} 个提示词，${item.referenceArticleIds.length} 篇参考文章`}>{item.title}</strong>
                </div>
              ))}
            </div>
            <p className="pg-help">生成时已自动注入高、低表现示例；这里展示当前可解释的参考口径。</p>
          </>
        )}
      </section>

      <section className="pg-card pg-card--wide" aria-label="平台版本关系">
        <div className="pg-card-head"><div><GitCompare size={17} /><h3>母稿与平台版本</h3></div></div>
        <p className="pg-help">公众号正文是事实与观点母稿。平台版本只调整标题、节奏和表达，不应引入母稿与素材之外的新事实。</p>
        {workflow.generationContext && (
          <p className="pg-context">本次生成：{workflow.generationContext.promptIds.length || 0} 个提示词 · {workflow.generationContext.referenceArticleIds.length || 0} 篇历史参考{workflow.publishContext?.templateId ? ` · 发布模板 ${workflow.publishContext.templateId}` : ""}</p>
        )}
        <PlatformVersionSummary source={article} target={articleToutiao} platform="toutiao" />
      </section>
    </div>
  )
}
