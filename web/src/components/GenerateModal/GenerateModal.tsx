import { Collapse } from "../FormControls/FormControls"
import Button from "../Button/Button"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Activity, AlertCircle, CheckCircle, Copy, FileText, Layers, Loader2, RefreshCw, Settings2, Sparkles, Square, X, Zap } from "lucide-react"
import {
  createGenerationCandidates, extractErrorMessage, fetchGenerationCandidates,
  streamGenerationCandidate,
} from "../../utils/apiHelpers"
import type { CandidatePlatform, CandidateTarget, GenerationCandidate } from "../../../shared/generationCandidate"
import MarkdownIt from "markdown-it"
import { sanitizeHtml } from "../../utils/sanitizeHtml"
import SourceList from "./SourceList"
import CandidateTrajectory from "./CandidateTrajectory"
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

const markdown = new MarkdownIt({ html: false }).disable("image")
const STATUS = { queued: "排队中", generating: "生成中", complete: "已完成", interrupted: "已中断" }

function DraftPreview({ content, label }: { content: string; label: string }) {
  const html = useMemo(() => sanitizeHtml(markdown.render(content)), [content])
  return <div className="gc-paper" aria-label={label} dangerouslySetInnerHTML={{ __html: html }} />
}

export default function GenerateModal({ articleId, task, materials, sourceArticle = "", aiConfig, initialPlatform = "wechat", onComplete, onClose }: Props) {
  const [platform, setPlatform] = useState<CandidateTarget>(initialPlatform)
  const [count, setCount] = useState(1)
  const [rows, setRows] = useState<GenerationCandidate[]>([])
  const [activeId, setActiveId] = useState("")
  const [view, setView] = useState<"draft" | "trace" | "compare">("draft")
  const comparing = view === "compare"
  const [setupOpen, setSetupOpen] = useState(false)
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
      if (!candidates.length) setSetupOpen(true)
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
        if (event.step && mounted.current) {
          const step = event.step
          setRows(previous => previous.map(row => {
            if (row.id !== candidate.id) return row
            const trace = row.trace || []
            return { ...row, trace: trace.some(item => item.id === step.id)
              ? trace.map(item => item.id === step.id ? step : item) : [...trace.slice(-39), step] }
          }))
        }
        if (event.event === "status" && event.message) update(candidate.id, { message: event.message })
        if (event.event === "error") update(candidate.id, { status: "interrupted", message: event.message || "生成中断" })
      })
    } catch (cause) {
      const finishedAt = new Date().toISOString()
      const message = controller.signal.aborted ? "已停止，可继续生成" : extractErrorMessage(cause)
      if (mounted.current) setRows(previous => previous.map(row => row.id === candidate.id ? {
        ...row, status: "interrupted", finishedAt, message,
        trace: row.trace?.map(step => step.status === "running" ? { ...step, status: "interrupted" } : step),
      } : row))
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
      setView("trace")
      setSetupOpen(false)
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
  const completeCount = rows.filter(row => row.status === "complete").length
  const shown = comparing ? rows.filter(row => row.batchId === active?.batchId) : active ? [active] : []
  const pairReady = (row: GenerationCandidate) => !row.pairId || rows.some(item =>
    item.pairId === row.pairId && item.id !== row.id && item.status === "complete")
  return <div className="gc-overlay">
    <section className="gc-modal" role="dialog" aria-modal="true" aria-label="生成候选稿">
      <header className="gc-header">
        <div className="gc-heading">
          <span className="gc-mark" aria-hidden="true"><Sparkles size={20} /></span>
          <div><h2>生成候选稿</h2><p>写作工作台 <span aria-hidden="true">/</span> <span className="gc-completed">{completeCount} 篇已完成</span></p></div>
        </div>
        <div className="gc-header-actions">
          {busy
            ? <Button className="gc-stop" onClick={stop}><Square size={12} />停止生成</Button>
            : <Button variant="primary" className="gc-new" aria-expanded={setupOpen} onClick={() => setSetupOpen(open => !open)}><Settings2 size={15} />{setupOpen ? "生成设置" : "新建一批"}</Button>}
          <Button className="gc-icon" onClick={close} title="关闭并保留候选稿" aria-label="关闭生成窗口"><X size={18} /></Button>
        </div>
      </header>
      {!busy && setupOpen && <div className="gc-settings">
        <div className="gc-settings-controls">
          <fieldset className="gc-choice">
            <legend>生成平台</legend>
            <div className="gc-segmented" role="group" aria-label="生成平台">
              {([["wechat", "公众号母稿"], ["both", "公众号 + 今日头条"], ["toutiao", "今日头条版本"]] as const).map(([target, label]) =>
                <Button variant="plain" key={target} aria-pressed={platform === target} onClick={() => setPlatform(target)}>{label}</Button>)}
            </div>
          </fieldset>
          <fieldset className="gc-choice">
            <legend>候选数量</legend>
            <div className="gc-segmented gc-count-options" role="group" aria-label="候选数量">
              {[1, 2, 3].map(value => <Button variant="plain" key={value} aria-pressed={count === value} onClick={() => setCount(value)}>{value}</Button>)}
            </div>
          </fieldset>
          <Button variant="primary" className="gc-generate-button" disabled={loading || applying} onClick={() => void start()}>
            <Zap size={14} />{platform === "both" ? "生成双平台版本" : `生成${platform === "wechat" ? "公众号母稿" : "今日头条版本"}`}
          </Button>
        </div>
        <p>先查历史文章和公开网页，再起草、审稿、优化和复核。模型和联网工具可能分别计费。</p>
      </div>}
      {error && <div className="gc-alert" role="alert"><AlertCircle size={16} />{error}</div>}
      <div className="gc-workspace">
        <nav className="gc-list" aria-label="候选稿列表">
          <div className="gc-list-head"><span>候选稿 <small>{rows.length}</small></span>
            <Button className="gc-icon gc-refresh" disabled={loading || busy} onClick={() => void reload()} aria-label="刷新候选稿" title="刷新候选稿"><RefreshCw size={13} /></Button>
          </div>
          {rows.map(row => <Button variant="plain" key={row.id} className="gc-row" aria-current={row.id === activeId ? "true" : undefined} onClick={() => setActiveId(row.id)}>
            <span className="gc-row-kicker">{row.label}</span>
            <strong>{row.content.match(/^#\s+(.+)$/m)?.[1] || (row.platform === "wechat" ? "公众号稿" : "今日头条稿")}</strong>
            <span className="gc-row-meta"><i data-status={row.status} />{STATUS[row.status]}<span aria-hidden="true">·</span>{row.content.length} 字</span>
          </Button>)}
        </nav>
        <main className="gc-main">
          <div className="gc-main-head">
            <div className="gc-view-switch" role="group" aria-label="候选稿视图">
              <Button variant="plain" className="gc-view" aria-pressed={view === "draft"} onClick={() => setView("draft")}><FileText size={15} />正文</Button>
              <Button variant="plain" className="gc-view" aria-pressed={view === "trace"} onClick={() => setView("trace")}><Activity size={15} />生成轨迹</Button>
              <Button variant="plain" className="gc-view" aria-pressed={comparing} onClick={() => setView(comparing ? "draft" : "compare")}><Layers size={15} />对比全文</Button>
            </div>
            {busy && <span className="gc-live" role="status"><Loader2 size={14} className="gc-spin" />生成中</span>}
          </div>
          <div className={`gc-drafts${comparing ? " gc-drafts--compare" : ""}`}>
            {view === "trace" && active && <CandidateTrajectory key={active.id} candidate={active} now={now} />}
            {view !== "trace" && shown.map(row => <article className="gc-draft" key={row.id}>
              <div className="gc-reading">
                <header className="gc-reading-head"><span>{row.label} <span className="gc-reading-state">{STATUS[row.status]}</span></span>
                  <Button className="gc-icon" title="复制正文" aria-label={`复制${row.label}`} disabled={!row.content} onClick={() => void copy(row.content)}><Copy size={15} /></Button>
                </header>
                {row.message && row.message !== "生成完成" && <p className={row.status === "interrupted" ? "gc-alert" : "gc-message"}>{row.message}</p>}
                {row.content ? <DraftPreview content={row.content} label={`${row.label}正文`} /> : <div className="gc-empty"><FileText size={28} /><span>等待正文输出</span></div>}
                {Boolean(row.researchSources?.length || row.referenceArticleIds?.length) && (
                  <Collapse className="gc-evidence" label={<>本次参考了 {row.referenceArticleIds?.length || 0} 篇历史文章，读了 {row.researchSources?.length || 0} 个网页</>}>
                    {!!row.researchSources?.length && <SourceList sources={row.researchSources} />}
                  </Collapse>
                )}
              </div>
              {comparing && <footer className="gc-dock">
                {(row.status === "interrupted" || row.status === "queued") && <Button disabled={busy || applying} onClick={() => { stopped.current = false; void run(row) }}><RefreshCw size={14} />{row.content ? "继续生成" : "重试生成"}</Button>}
                <Button variant="primary" disabled={row.status !== "complete" || applying || !pairReady(row)} onClick={() => void apply(row)}>
                  {row.pairId ? "选用这一组" : "选用此稿"}
                </Button>
              </footer>}
            </article>)}
            {!active && <div className="gc-empty"><FileText size={30} /><strong>{loading ? "读取中" : "还没有候选稿"}</strong><span>生成后可在这里阅读、比较和查看执行轨迹。</span></div>}
          </div>
          {!comparing && active && <footer className="gc-dock">
            <span className="gc-dock-note">{active.status === "complete" ? active.message : active.label}</span>
            {(active.status === "interrupted" || active.status === "queued") &&
              <Button disabled={busy || applying} onClick={() => { stopped.current = false; void run(active) }}>
                <RefreshCw size={14} />{active.content ? "继续生成" : "重试生成"}
              </Button>}
            {view === "trace" && active.status === "complete" ? <Button onClick={() => setView("draft")}><FileText size={14} />查看正文</Button> :
              <Button variant="primary" disabled={active.status !== "complete" || applying || !pairReady(active)} onClick={() => void apply(active)}>
                <CheckCircle size={14} />{applying ? "保存中" : active.pairId ? "选用这一组" : "选用此稿"}
              </Button>}
          </footer>}
        </main>
      </div>
    </section>
  </div>
}
