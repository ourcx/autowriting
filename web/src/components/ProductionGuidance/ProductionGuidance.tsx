import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, BarChart3, CheckCircle2, ExternalLink, FileSearch, GitCompare } from "lucide-react"
import {
  auditArticleSources,
  comparePlatformVersions,
  WRITING_DNA_LAYER_LABELS,
  type CreatorFeedbackLayer,
} from "../../../shared/contentProduction"
import { fetchProductionInsights, saveCreatorFeedback, type ProductionInsights } from "../../utils/apiHelpers"
import { toast } from "../Toast/Toast"
import type { ArticleWorkflow } from "../../../shared/articleWorkflow"
import "./ProductionGuidance.css"

const PLATFORM_LABEL = { wechat: "公众号", toutiao: "今日头条", xiaohongshu: "小红书" }
const FEEDBACK_LAYER_OPTIONS: Array<[CreatorFeedbackLayer, string]> = [
  ["general", "综合取舍"],
  ...Object.entries(WRITING_DNA_LAYER_LABELS) as Array<[CreatorFeedbackLayer, string]>,
]

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

export default function ProductionGuidance({ article, materials, articleToutiao, workflow, articleId, onBeforeFeedback, onWorkflow }: {
  article: string
  materials: string
  articleToutiao: string
  workflow: ArticleWorkflow
  articleId?: string
  onBeforeFeedback?: () => Promise<boolean>
  onWorkflow?: (workflow: ArticleWorkflow) => void
}) {
  const sourceAudit = useMemo(() => auditArticleSources(article, materials), [article, materials])
  const [insights, setInsights] = useState<ProductionInsights | null>(null)
  const [layer, setLayer] = useState<CreatorFeedbackLayer>(workflow.feedback?.layer || "general")
  const [note, setNote] = useState(workflow.feedback?.note || "")
  const [expressions, setExpressions] = useState(workflow.feedback?.retainedExpressions.join("\n") || "")
  const [savingFeedback, setSavingFeedback] = useState(false)
  const saveFeedback = async () => {
    if (!articleId || savingFeedback) return
    setSavingFeedback(true)
    try {
      if (onBeforeFeedback && !await onBeforeFeedback()) return
      onWorkflow?.(await saveCreatorFeedback(articleId, layer, note, expressions.split("\n").map(value => value.trim()).filter(Boolean)))
      setInsights(await fetchProductionInsights())
      toast.success("已记录你的取舍，下一篇生成时会说明参考依据")
    } catch { toast.error("反馈未保存，请确认保留表达出现在正文中，每条不超过 300 字") }
    finally { setSavingFeedback(false) }
  }

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
          <div><BarChart3 size={17} /><h3>读者关注记录</h3></div>
          <span>{insights?.audienceEvidence?.sampleSize || 0} 篇自动数据</span>
        </div>
        {!insights?.audienceEvidence ? (
          <p className="pg-empty">还没有微信后台数据。到“选题与素材”连接已登录浏览器后，系统会自动更新。</p>
        ) : (
          <>
            <div className="pg-top-list">{insights.audienceEvidence.highAttention.slice(0, 3).map(item => (
              <div key={item.id}><span>高关注 · 第 {item.rank} 位</span><strong>{item.title} · {item.reads.toLocaleString()} 人</strong></div>
            ))}</div>
            <p className="pg-help">{insights.audienceEvidence.period.start} 至 {insights.audienceEvidence.period.end} 的相对位置。阅读人数会受选题、发布时间、账号体量和推荐流量影响，生成时只把它当作选题证据，不会模仿句式。</p>
          </>
        )}
      </section>

      <section className="pg-card pg-card--wide" aria-label="我的写作取舍">
        <div className="pg-card-head"><h3>我的写作取舍</h3><span>只记录你明确确认的偏好</span></div>
        <p className="pg-help">{workflow.selectedCandidateId ? `本稿来自候选 ${workflow.selectedCandidateId.slice(0, 8)}，原始候选稿和素材仍保留。` : "本稿未关联候选稿，仍可记录修改原因。"} 原样保留的段落只表示没有修改，不自动等同于偏好。</p>
        <label className="pg-feedback-label">这次修改主要影响
          <select value={layer} onChange={event => setLayer(event.target.value as CreatorFeedbackLayer)}>
            {FEEDBACK_LAYER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="pg-feedback-label">这次为什么这样改
          <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={1000} placeholder="例如：删掉泛泛的开场，先写自己的亲身观察。"/>
        </label>
        <label className="pg-feedback-label">下次还想保留的表达（从正文粘贴，每行一条，最多 10 条）
          <textarea value={expressions} onChange={event => setExpressions(event.target.value)} placeholder="只填你明确认可的表达；留空也可以。"/>
        </label>
        <button className="btn btn-secondary" onClick={() => void saveFeedback()} disabled={!articleId || savingFeedback}>{savingFeedback ? "保存中…" : "保存写作取舍"}</button>
        {!articleId && <p className="pg-help">此稿仅保存在浏览器中，移到服务器后可积累账号经验。</p>}
        {insights?.creatorExperiences?.slice(0, 3).map(item => <p className="pg-help" key={item.articleId}>
          <a href={`/editor/${encodeURIComponent(item.articleId)}?tab=analysis`}>{item.articleId}</a> · {item.layer === "general" ? "综合取舍" : WRITING_DNA_LAYER_LABELS[item.layer]}：{item.note || "已记录保留表达"}
          {item.candidateId ? ` · 原样保留 ${item.retainedParagraphs} 段，修改或新增 ${item.changedParagraphs} 段` : ""}
        </p>)}
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
