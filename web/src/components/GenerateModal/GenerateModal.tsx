import { useEffect, useRef, useState } from "react"
import { AlertCircle, CheckCircle, Copy, FileText, RefreshCw, Square, X, Zap } from "lucide-react"
import {
  createGenerationCandidates, extractErrorMessage, fetchGenerationCandidates,
  fetchJson, streamGenerationCandidate,
} from "../../utils/apiHelpers"
import type { CandidatePlatform, GenerationCandidate } from "../../../shared/generationCandidate"
import "./GenerateModal.css"

interface Props {
  articleId: string
  task: string
  materials: string
  sourceArticle?: string
  aiConfig: Record<string, unknown>
  onComplete: (article: string, articleToutiao: string, platforms: "both" | "wechat" | "toutiao") => void | Promise<void>
  onClose: () => void
}

interface ReferenceArticle { dir: string; title: string; snippet: string }
const STATUS = { queued: "排队中", generating: "生成中", complete: "已完成", interrupted: "已中断" }

export default function GenerateModal({ articleId, task, materials, sourceArticle = "", aiConfig, onComplete, onClose }: Props) {
  const [platform, setPlatform] = useState<CandidatePlatform>("wechat")
  const [count, setCount] = useState(1)
  const [rows, setRows] = useState<GenerationCandidate[]>([])
  const [activeId, setActiveId] = useState("")
  const [comparing, setComparing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState("")
  const [references, setReferences] = useState<ReferenceArticle[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [referencesLoading, setReferencesLoading] = useState(false)
  const [referenceError, setReferenceError] = useState("")
  const [loading, setLoading] = useState(true)
  const controllers = useRef(new Map<string, AbortController>())
  const stopped = useRef(false)
  const starting = useRef(false)
  const mounted = useRef(true)
  const referencesController = useRef<AbortController | null>(null)
  const preparationController = useRef<AbortController | null>(null)
  const [now, setNow] = useState(Date.now())
  const active = rows.find(row => row.id === activeId)
  const busy = creating || rows.some(row => row.status === "generating")

  const update = (id: string, patch: Partial<GenerationCandidate>) => {
    if (mounted.current) setRows(previous => previous.map(row => row.id === id ? { ...row, ...patch } : row))
  }
  const reload = async () => {
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
  }
  useEffect(() => {
    mounted.current = true
    void reload()
    const running = controllers.current
    return () => {
      mounted.current = false
      stopped.current = true
      running.forEach(controller => controller.abort())
      referencesController.current?.abort()
      preparationController.current?.abort()
    }
  }, [articleId])
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

  const loadReferences = async () => {
    const controller = new AbortController()
    referencesController.current?.abort()
    referencesController.current = controller
    setReferencesLoading(true)
    setReferenceError("")
    try {
      const token = localStorage.getItem("auth_token")
      const result = await fetchJson<{ candidates: ReferenceArticle[] }>("/api/rag/candidates", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ query: task, materials, topK: 8, aiConfig }),
      })
      if (mounted.current && !controller.signal.aborted) setReferences(result.candidates || [])
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) setReferenceError(extractErrorMessage(cause))
    } finally { if (mounted.current) setReferencesLoading(false) }
  }

  const run = async (candidate: GenerationCandidate) => {
    if (controllers.current.has(candidate.id)) return
    const controller = new AbortController()
    controllers.current.set(candidate.id, controller)
    update(candidate.id, { status: "generating", finishedAt: undefined, message: "等待模型输出" })
    try {
      await streamGenerationCandidate(articleId, candidate.id, aiConfig, controller.signal, event => {
        if (event.candidate) update(candidate.id, event.candidate)
        if (event.event === "chunk" && event.text && mounted.current) {
          setRows(previous => previous.map(row => row.id === candidate.id
            ? { ...row, content: row.content + event.text, firstChunkAt: row.firstChunkAt || new Date().toISOString(), message: "正在写作" } : row))
        }
        if (event.event === "error") update(candidate.id, { status: "interrupted", message: event.message || "生成中断" })
      })
    } catch (cause) {
      update(candidate.id, { status: "interrupted", finishedAt: new Date().toISOString(), message: controller.signal.aborted ? "已停止，可继续生成" : extractErrorMessage(cause) })
    } finally { controllers.current.delete(candidate.id) }
  }

  const start = async () => {
    if (starting.current || busy || loading) return
    starting.current = true
    stopped.current = false
    setCreating(true)
    setError("")
    const preparation = new AbortController()
    preparationController.current = preparation
    const preparationTimeout = setTimeout(() => preparation.abort(), 20000)
    try {
      let selectedRagContext = ""
      if (selected.length) {
        const token = localStorage.getItem("auth_token")
        const context = await fetchJson<{ context: string }>("/api/rag/context", {
          method: "POST", signal: preparation.signal,
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ dirs: selected }),
        })
        selectedRagContext = context.context || ""
      }
      if (stopped.current || !mounted.current) return
      const created = await createGenerationCandidates(articleId, {
        task, materials, sourceArticle, platform, count, selectedRagContext, referenceArticleIds: selected,
      })
      if (stopped.current || !mounted.current) return
      setRows(previous => [...created, ...previous])
      setActiveId(created[0].id)
      clearTimeout(preparationTimeout)
      let next = 0
      const worker = async () => {
        while (!stopped.current && next < created.length) {
          const row = created[next++]
          await run(row)
        }
      }
      await Promise.all([worker(), worker()])
    } catch (cause) { if (mounted.current) setError(extractErrorMessage(cause)) }
    finally {
      clearTimeout(preparationTimeout)
      starting.current = false
      if (mounted.current) setCreating(false)
    }
  }
  const stop = () => {
    stopped.current = true
    preparationController.current?.abort()
    controllers.current.forEach(controller => controller.abort())
  }
  const close = () => { stop(); onClose() }
  const apply = async (candidate: GenerationCandidate) => {
    if (candidate.status !== "complete" || applying) return
    setApplying(true)
    setError("")
    try {
      await onComplete(candidate.platform === "wechat" ? candidate.content : "", candidate.platform === "toutiao" ? candidate.content : "", candidate.platform)
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
        <label>生成平台<select value={platform} disabled={busy} onChange={event => setPlatform(event.target.value as CandidatePlatform)}><option value="wechat">公众号母稿</option><option value="toutiao">今日头条版本</option></select></label>
        <label>候选数量<select value={count} disabled={busy} onChange={event => setCount(Number(event.target.value))}><option value={1}>1 篇</option><option value={2}>2 篇</option><option value={3}>3 篇</option></select></label>
        <span className="gc-cost">最多两篇并发 · {count} 次模型生成{count > 1 ? "，费用按实际用量增加" : ""}</span>
        <button className="gm-btn-primary" disabled={busy || loading || applying} onClick={() => void start()}><Zap size={14} />{busy ? "生成中" : "开始生成"}</button>
      </div>
      <details className="gc-references">
        <summary>往期参考 · 已选 {selected.length} 篇</summary>
        <button className="gm-btn-secondary" disabled={referencesLoading || busy} onClick={() => void loadReferences()}><RefreshCw size={13} />{referencesLoading ? "检索中" : "检索往期文章"}</button>
        {referenceError && <p role="alert">{referenceError}</p>}
        {references.map(reference => <label key={reference.dir} title={reference.snippet}>
          <input type="checkbox" disabled={busy} checked={selected.includes(reference.dir)} onChange={event => setSelected(previous => event.target.checked ? [...previous, reference.dir] : previous.filter(id => id !== reference.dir))} />{reference.title}
        </label>)}
      </details>
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
            <pre>{row.content || "等待正文输出"}</pre>
            <footer>
              {(row.status === "interrupted" || row.status === "queued") && <button className="gm-btn-secondary" disabled={busy || applying} onClick={() => { stopped.current = false; void run(row) }}><RefreshCw size={14} />{row.content ? "继续生成" : "重试生成"}</button>}
              <button className="gm-btn-primary" disabled={row.status !== "complete" || applying} onClick={() => void apply(row)}><CheckCircle size={14} />{applying ? "保存中" : "选用此稿"}</button>
            </footer>
          </article>)}
          {!active && <div className="gc-empty"><FileText size={30} /><span>{loading ? "读取中" : "暂无候选稿"}</span></div>}
        </div>
      </div>
    </section>
  </div>
}
