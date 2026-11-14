import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, CheckCircle, Copy, ExternalLink, FileText, RefreshCw, Square, X, Zap } from "lucide-react"
import {
  createGenerationCandidates, extractErrorMessage, fetchGenerationCandidates,
  streamGenerationCandidate,
} from "../../utils/apiHelpers"
import type { CandidatePlatform, CandidateTarget, GenerationCandidate } from "../../../shared/generationCandidate"
import "./GenerateModal.css"

interface Props {
  articleId: string
  task: string
  materials: string
  sourceArticle?: string
  aiConfig: Record<string, unknown>
  initialPlatform?: CandidatePlatform
  onComplete: (article: string, articleToutiao: string, platforms: "both" | "wechat" | "toutiao", candidateId?: string) => void | Promise<void>
  onClose: () => void
}

const STATUS = { queued: "排队中", generating: "生成中", complete: "已完成", interrupted: "已中断" }

export default function GenerateModal({ articleId, task, materials, sourceArticle = "", aiConfig, initialPlatform = "wechat", onComplete, onClose }: Props) {
  const [platform, setPlatform] = useState<CandidateTarget>(initialPlatform)
  const [count, setCount] = useState(1)
  const [rows, setRows] = useState<GenerationCandidate[]>([])
  const [activeId, setActiveId] = useState("")
  const [comparing, setComparing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const controllers = useRef(new Map<string, AbortController>())
  const stopped = useRef(false)
  const starting = useRef(false)
  const mounted = useRef(true)
  const [now, setNow] = useState(() => Date.now())
  const active = rows.find(row => row.id === activeId)
  const busy = creating || rows.some(row => row.status === "generating")

  const update = (id: string, patch: Partial<GenerationCandidate>) => {
    if (mounted.current) setRows(previous => previous.map(row => row.id === id ? { ...row, ...patch } : row))
  }
  const reload = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const candidates = await fetchGenerationCandidates(articleId)
      if (!mounted.current) return
      setRows(candidates)
      setActiveId(previous => candidates.some(row => row.id === previous) ? previous : candidates[0]?.id || "")
    } catch (cause) {
      if (mounted.current) setError(extractErrorMessage(cause))
    } finally { if (mounted.current) setLoading(false) }
  }, [articleId])
  useEffect(() => {
    mounted.current = true
    void reload()
    const running = controllers.current
    return () => {
      mounted.current = false
      stopped.current = true
      running.forEach(controller => controller.abort())
    }
  }, [reload])
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [busy])
  useEffect(() => {
    if (!busy || creating) return
    // A dialog reopened during cancellation may see the server's last active checkpoint.
    const timer = setInterval(() => {
      if (controllers.current.size) return
      void fetchGenerationCandidates(articleId).then(candidates => {
        if (mounted.current) setRows(candidates)
      }).catch(() => {})
    }, 3000)
    return () => clearInterval(timer)
  }, [articleId, busy, creating])

  const run = async (candidate: GenerationCandidate): Promise<GenerationCandidate | null> => {
    if (controllers.current.has(candidate.id)) return null
    const controller = new AbortController()
    let completed: GenerationCandidate | null = null
    controllers.current.set(candidate.id, controller)
    update(candidate.id, { status: "generating", finishedAt: undefined, message: "等待模型输出" })
    try {
      await streamGenerationCandidate(articleId, candidate.id, aiConfig, controller.signal, event => {
        if (event.candidate) {
          update(candidate.id, event.candidate)
          if (event.event === "done") completed = event.candidate
        }
        if (event.event === "chunk" && event.text && mounted.current) {
          setRows(previous => previous.map(row => row.id === candidate.id
            ? { ...row, content: row.content + event.text, firstChunkAt: row.firstChunkAt || new Date().toISOString(), message: "正在写作" } : row))
        }
        if (event.event === "status" && event.message) update(candidate.id, { message: event.message })
        if (event.event === "error") update(candidate.id, { status: "interrupted", message: event.message || "生成中断" })
      })
    } catch (cause) {
      update(candidate.id, { status: "interrupted", finishedAt: new Date().toISOString(), message: controller.signal.aborted ? "已停止，可继续生成" : extractErrorMessage(cause) })
    } finally { controllers.current.delete(candidate.id) }
    return completed
  }

  const start = async () => {
    if (starting.current || busy || loading) return
    starting.current = true
    stopped.current = false
    setCreating(true)
    setError("")
    try {
      const created = await createGenerationCandidates(articleId, {
        task, materials, sourceArticle, platform, count, selectedRagContext: "", referenceArticleIds: [], writingAgent: true,
      })
      if (stopped.current || !mounted.current) return
      setRows(previous => [...created, ...previous])
      setActiveId(created[0].id)
      await Promise.all(created.map(candidate => run(candidate)))
    } catch (cause) { if (mounted.current) setError(extractErrorMessage(cause)) }
    finally {
      starting.current = false
      if (mounted.current) setCreating(false)
    }
  }
  const stop = () => {
    stopped.current = true
    controllers.current.forEach(controller => controller.abort())
  }
  const close = () => { stop(); onClose() }
  const apply = async (candidate: GenerationCandidate) => {
    if (candidate.status !== "complete" || applying) return
    setApplying(true)
    setError("")
    try {
      const pair = candidate.pairId ? rows.find(row => row.pairId === candidate.pairId && row.id !== candidate.id) : undefined
      if (candidate.pairId && pair?.status === "complete") {
        const wechat = candidate.platform === "wechat" ? candidate : pair
        const toutiao = candidate.platform === "toutiao" ? candidate : pair
        await onComplete(wechat.content, toutiao.content, "both", wechat.id)
      } else {
        await onComplete(candidate.platform === "wechat" ? candidate.content : "", candidate.platform === "toutiao" ? candidate.content : "", candidate.platform, candidate.id)
      }
      stop()
      onClose()
    } catch (cause) { setError(extractErrorMessage(cause, "选用失败，候选稿仍保留")) }
    finally { if (mounted.current) setApplying(false) }
  }
  const copy = async (content: string) => {
    try { await navigator.clipboard.writeText(content) }
    catch { setError("复制失败，请选中正文后手动复制") }
  }
  return <div className="gm-overlay">
    <section className="gm-modal gc-modal" role="dialog" aria-modal="true" aria-label="生成候选稿">
      <header className="gm-header">
        <div className="gm-header-left"><strong className="gm-title">生成候选稿</strong><span className="gm-footer-note">{rows.filter(row => row.status === "complete").length} 篇已完成</span></div>
        <button className="gm-icon-btn" onClick={close} title="关闭并保留候选稿" aria-label="关闭生成窗口"><X size={18} /></button>
      </header>
      <div className="gc-settings">
        <fieldset className="gc-choice">
          <legend>生成平台</legend>
          <div className="gc-segmented" role="group" aria-label="生成平台">
            <button type="button" aria-pressed={platform === "wechat"} disabled={busy} onClick={() => setPlatform("wechat")}>公众号母稿</button>
            <button type="button" aria-pressed={platform === "both"} disabled={busy} onClick={() => setPlatform("both")}>公众号 + 今日头条</button>
            <button type="button" aria-pressed={platform === "toutiao"} disabled={busy} onClick={() => setPlatform("toutiao")}>今日头条版本</button>
          </div>
        </fieldset>
        <fieldset className="gc-choice">
          <legend>候选数量</legend>
          <div className="gc-count-options" role="group" aria-label="候选数量">
            {[1, 2, 3].map(value => (
              <button type="button" key={value} aria-pressed={count === value} disabled={busy} onClick={() => setCount(value)}>{value}</button>
            ))}
          </div>
        </fieldset>
        <button className="gm-btn-primary gc-generate-button" disabled={busy || loading || applying} onClick={() => void start()}>
          <Zap size={14} />
          {busy ? "生成中" : platform === "both" ? "生成双平台版本" : `生成${platform === "wechat" ? "公众号母稿" : "今日头条版本"}`}
        </button>
      </div>
      <p className="gc-cost">自动查找历史文章和表达样本，按需搜索网页、核对来源，再拟提纲和成文。会发起多次模型请求，联网搜索和读取网页可能另行计费。</p>
      {error && <div className="gc-error" role="alert"><AlertCircle size={16} />{error}</div>}
      <div className="gc-toolbar">
        <span>{busy ? "候选稿生成中" : loading ? "正在读取候选稿" : "候选稿"}</span>
        <div>
          <button className="gm-btn-secondary" disabled={busy || loading} onClick={() => void reload()} title="刷新候选稿"><RefreshCw size={14} /></button>
          <button className="gm-btn-secondary" aria-pressed={comparing} onClick={() => setComparing(value => !value)}>对比全文</button>
          {busy && <button className="gm-btn-secondary" onClick={stop}><Square size={12} />停止生成</button>}
        </div>
      </div>
      <div className={`gc-workspace ${comparing ? "gc-workspace--compare" : ""}`}>
        <nav className="gc-list" aria-label="候选稿列表">
          {rows.map(row => <button key={row.id} className={row.id === activeId ? "gc-row gc-row--active" : "gc-row"} onClick={() => setActiveId(row.id)}>
            <strong>{row.content.match(/^#\s+(.+)$/m)?.[1] || row.label}</strong>
            <span>{row.platform === "wechat" ? "公众号" : "头条"} · {STATUS[row.status]} · {row.content.length} 字</span>
            <small>{new Date(row.createdAt).toLocaleTimeString()} · {Math.max(0, Math.round(((row.finishedAt ? Date.parse(row.finishedAt) : now) - Date.parse(row.createdAt)) / 1000))} 秒</small>
          </button>)}
        </nav>
        <div className="gc-drafts">
          {(comparing ? rows.filter(row => row.batchId === active?.batchId) : active ? [active] : []).map(row => <article className="gc-draft" key={row.id}>
            <header><strong>{row.label}</strong><span>{STATUS[row.status]}</span>
              <button className="gm-icon-btn" title="复制正文" aria-label={`复制${row.label}`} disabled={!row.content} onClick={() => void copy(row.content)}><Copy size={15} /></button>
            </header>
            <p className={row.status === "interrupted" ? "gc-error" : "gc-message"}>{row.message}</p>
            {Boolean(row.researchSources?.length || row.referenceArticleIds?.length) && (
              <details className="gc-evidence">
                <summary>本次参考了 {row.referenceArticleIds?.length || 0} 篇历史文章，读了 {row.researchSources?.length || 0} 个网页</summary>
                {!!row.researchSources?.length && <ul>{row.researchSources.map(source => (
                  <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title} <ExternalLink size={12} /></a></li>
                ))}</ul>}
              </details>
            )}
            <pre>{row.content || "等待正文输出"}</pre>
            <footer>
              {(row.status === "interrupted" || row.status === "queued") && <button className="gm-btn-secondary" disabled={busy || applying} onClick={() => { stopped.current = false; void run(row) }}><RefreshCw size={14} />{row.content ? "继续生成" : "重试生成"}</button>}
              <button
                className="gm-btn-primary"
                disabled={row.status !== "complete" || applying || Boolean(row.pairId && !rows.some(item => item.pairId === row.pairId && item.id !== row.id && item.status === "complete"))}
                onClick={() => void apply(row)}
              ><CheckCircle size={14} />{applying ? "保存中" : row.pairId ? "选用这一组" : "选用此稿"}</button>
            </footer>
          </article>)}
          {!active && <div className="gc-empty"><FileText size={30} /><span>{loading ? "读取中" : "暂无候选稿"}</span></div>}
        </div>
      </div>
    </section>
  </div>
}
