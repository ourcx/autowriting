/**
 * GenerateModal — 流式生成弹窗（Clay 设计风格）
 *
 * 三阶段 UI：
 *   1. pick     — 查询 RAG 候选文章，用户手动勾选要注入的往期文章
 *   2. generate — AI 流式输出（公众号 + 今日头条双平台并行展示）
 *   3. done     — 完成（应用按钮）
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { X, CheckCircle, AlertCircle, FileText, Eye, EyeOff, Zap } from 'lucide-react'
import './GenerateModal.css'

// ── 类型 ─────────────────────────────────────────────────────────────────────

interface RagCandidate {
  dir:     string
  title:   string
  score:   number
  sim:     number
  types:   string[]
  snippet: string
}

interface ContextArticle {
  dir:     string
  title:   string
  content: string
}

type Phase = 'pick' | 'generate' | 'done' | 'error'

interface Props {
  articleId:  string
  task:       string
  materials:  string
  aiConfig:   Record<string, unknown>
  onComplete: (article: string, articleToutiao: string, platforms: 'both' | 'wechat' | 'toutiao') => void
  onClose:    () => void
}

// ── 颜色映射（按相似度） ──────────────────────────────────────────────────────

function simColor(sim: number) {
  if (sim >= 80) return 'peach'
  if (sim >= 60) return 'lavender'
  return 'ochre'
}

// ═══════════════════════════════════════════════════════════════════════════════

export default function GenerateModal({ articleId, task, materials, aiConfig, onComplete, onClose }: Props) {
  const [phase,        setPhase]       = useState<Phase>('pick')
  const [statusMsg,    setStatusMsg]   = useState('')
  // 平台选择：both / wechat / toutiao
  const [platforms,    setPlatforms]   = useState<'both' | 'wechat' | 'toutiao'>('both')
  // 公众号流式文本
  const [streamTextWechat,   setStreamTextWechat]  = useState('')
  // 今日头条流式文本
  const [streamTextToutiao,  setStreamTextToutiao] = useState('')
  // 当前激活的平台 tab（生成阶段）
  const [activeTab,    setActiveTab]   = useState<'wechat' | 'toutiao'>('wechat')
  // 哪个平台已完成
  const [wechatDone,   setWechatDone]  = useState(false)
  const [toutiaoDone,  setToutiaoDone] = useState(false)
  const [errorMsg,     setErrorMsg]    = useState('')

  // ── RAG 候选 & 选择 ────────────────────────────────────────────────────────
  const [candidates,   setCandidates]  = useState<RagCandidate[]>([])
  const [loadingCands, setLoadingCands]= useState(true)
  const [candsError,   setCandsError]  = useState('')
  const [selected,     setSelected]    = useState<Set<string>>(new Set())

  // ── 上下文预览 ─────────────────────────────────────────────────────────────
  const [previewDir,    setPreviewDir]    = useState<string | null>(null)
  const [previewData,   setPreviewData]   = useState<ContextArticle | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [previewError,  setPreviewError]  = useState(false)
  const [showContextPanel,  setShowContextPanel]  = useState(false)
  const [loadingCtxPanel,   setLoadingCtxPanel]   = useState(false)
  const [ctxPanelError,     setCtxPanelError]     = useState(false)
  const [contextArticles, setContextArticles]   = useState<ContextArticle[]>([])
  const [ragContext,   setRagContext]  = useState<string>('')

  const streamRefWechat   = useRef<HTMLDivElement>(null)
  const streamRefToutiao  = useRef<HTMLDivElement>(null)
  const fullTextWechat    = useRef('')
  const fullTextToutiao   = useRef('')
  const abortRef   = useRef<AbortController | null>(null)

  const token = localStorage.getItem('auth_token')
  const authHeader: Record<string, string> = token ? { 'Authorization': `Bearer ${token}` } : {}

  // ── 1. 挂载时查询候选文章 ─────────────────────────────────────────────────

  useEffect(() => {
    fetchCandidates()
  }, [])

  // 自动滚动到底部
  useEffect(() => {
    if (streamRefWechat.current) {
      streamRefWechat.current.scrollTop = streamRefWechat.current.scrollHeight
    }
  }, [streamTextWechat])

  useEffect(() => {
    if (streamRefToutiao.current) {
      streamRefToutiao.current.scrollTop = streamRefToutiao.current.scrollHeight
    }
  }, [streamTextToutiao])

  // 公众号完成后自动切到今日头条 tab（仅在两者都生成时）
  useEffect(() => {
    if (wechatDone && !toutiaoDone && platforms !== 'wechat') {
      setActiveTab('toutiao')
    }
  }, [wechatDone, toutiaoDone, platforms])

  async function fetchCandidates() {
    setLoadingCands(true)
    setCandsError('')
    try {
      const resp = await fetch('/api/rag/candidates', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body:    JSON.stringify({ query: task, topK: 8, aiConfig }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || '查询失败')
      setCandidates(data.candidates || [])
      const topDirs = (data.candidates || []).slice(0, 2).map((c: RagCandidate) => c.dir)
      setSelected(new Set(topDirs))
    } catch (e: unknown) {
      setCandsError((e as Error).message || '查询候选文章失败')
    }
    setLoadingCands(false)
  }

  // ── 预览单篇文章内容 ──────────────────────────────────────────────────────

  const fetchPreview = useCallback(async (dir: string) => {
    if (previewDir === dir) { setPreviewDir(null); setPreviewData(null); return }
    setPreviewDir(dir)
    setPreviewData(null)
    setPreviewError(false)
    setLoadingPreview(true)
    try {
      const resp = await fetch('/api/rag/context', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body:    JSON.stringify({ dirs: [dir] }),
      })
      const data = await resp.json()
      const article = data.articles?.[0] || null
      setPreviewData(article)
      if (!article) setPreviewError(true)
    } catch {
      setPreviewData(null)
      setPreviewError(true)
    }
    setLoadingPreview(false)
  }, [previewDir])

  // ── 加载选中文章的完整上下文 ──────────────────────────────────────────────

  async function loadSelectedContext() {
    const dirs = [...selected]
    if (dirs.length === 0) {
      setContextArticles([])
      setRagContext('')
      setShowContextPanel(false)
      return
    }
    setLoadingCtxPanel(true)
    setCtxPanelError(false)
    setShowContextPanel(true)
    try {
      const resp = await fetch('/api/rag/context', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body:    JSON.stringify({ dirs }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || '加载失败')
      setContextArticles(data.articles || [])
      setRagContext(data.context || '')
      if (!data.context) setCtxPanelError(true)
    } catch {
      setCtxPanelError(true)
    }
    setLoadingCtxPanel(false)
  }

  // ── 用户点击「开始生成」 ──────────────────────────────────────────────────

  const handleStartGenerate = async () => {
    let ctxString = ''
    if (selected.size > 0) {
      try {
        const resp = await fetch('/api/rag/context', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body:    JSON.stringify({ dirs: [...selected] }),
        })
        const data = await resp.json()
        ctxString = data.context || ''
        setContextArticles(data.articles || [])
      } catch { /**/ }
    }
    setRagContext(ctxString)
    setPhase('generate')
    // 初始 tab：只生成今日头条时直接显示今日头条
    setActiveTab(platforms === 'toutiao' ? 'toutiao' : 'wechat')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    startStream(ctrl.signal, ctxString)
  }

  // ── 流式生成（双平台） ────────────────────────────────────────────────────

  async function startStream(signal: AbortSignal, selectedRagContext: string) {
    try {
      const resp = await fetch(`/api/articles/${articleId}/generate/stream`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body:    JSON.stringify({
          task, materials, aiConfig,
          selectedRagContext: selectedRagContext || undefined,
          platforms,
        }),
        signal,
      })

      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)

      const reader  = resp.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let   lineBuf = ''
      let   curEvent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        lineBuf += decoder.decode(value, { stream: true })
        const lines = lineBuf.split('\n')
        lineBuf = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) { curEvent = ''; continue }
          if (trimmed.startsWith('event:')) { curEvent = trimmed.slice(6).trim(); continue }
          if (trimmed.startsWith('data:')) {
            try {
              const payload = JSON.parse(trimmed.slice(5).trim()) as Record<string, unknown>
              dispatch(curEvent || inferEvent(payload), payload)
            } catch { /* ignore */ }
          }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return
      setPhase('error')
      setErrorMsg((e as Error).message || '生成失败')
    }
  }

  function inferEvent(p: Record<string, unknown>): string {
    if (p.step     !== undefined) return 'status'
    if (p.docs     !== undefined) return 'rag'
    if (p.text     !== undefined) return 'chunk'
    if (p.article  !== undefined) return 'done'
    if (p.message  !== undefined) return 'error'
    return ''
  }

  function dispatch(event: string, payload: Record<string, unknown>) {
    const platform = payload.platform as string | undefined
    switch (event) {
      case 'status':
        setStatusMsg(payload.message as string)
        // 切换到正在生成的平台 tab
        if (platform === 'toutiao') setActiveTab('toutiao')
        else if (platform === 'wechat') setActiveTab('wechat')
        break
      case 'chunk': {
        const t = payload.text as string
        if (platform === 'toutiao') {
          fullTextToutiao.current += t
          setStreamTextToutiao(fullTextToutiao.current)
        } else {
          fullTextWechat.current += t
          setStreamTextWechat(fullTextWechat.current)
        }
        break
      }
      case 'done':
        if (platform === 'toutiao') {
          setToutiaoDone(true)
          setPhase('done')
        } else {
          setWechatDone(true)
          // 只生成公众号时，公众号完成即进入 done
          if (platforms === 'wechat') setPhase('done')
        }
        break
      case 'error':
        setPhase('error')
        setErrorMsg(payload.message as string)
        break
    }
  }

  const handleApply = () => {
    onComplete(fullTextWechat.current, fullTextToutiao.current, platforms)
    onClose()
  }
  const handleClose = () => { abortRef.current?.abort(); onClose() }

  const toggleSelect = (dir: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else               next.add(dir)
      return next
    })
  }

  // 根据选择的平台判断是否全部完成
  const bothDone = platforms === 'wechat' ? wechatDone
    : platforms === 'toutiao' ? toutiaoDone
    : wechatDone && toutiaoDone

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  return (
    <div className="gm-overlay" onClick={e => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="gm-modal">

        {/* ── Header ── */}
        <div className="gm-header">
          <div className="gm-header-left">
            <span className="gm-title">AI 生成文章</span>
            {phase === 'pick' && (
              <span className="gm-pill gm-pill-rag">选择参考</span>
            )}
            {phase === 'generate' && !bothDone && (
              <span className="gm-pill gm-pill-generate">生成中</span>
            )}
            {phase === 'done' && (
              <span className="gm-pill gm-pill-done">已完成</span>
            )}
          </div>
          <button className="gm-icon-btn" onClick={handleClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════
            阶段 1：RAG 选择面板
        ══════════════════════════════════════════════════════ */}
        {phase === 'pick' && (
          <div className="gm-pick-body">

            {/* 左：候选文章列表 */}
            <div className="gm-pick-left">
              <div className="gm-section-label">
                往期相关文章
                {candidates.length > 0 && (
                  <span className="gm-count">{candidates.length}</span>
                )}
              </div>

              {loadingCands && (
                <div className="gm-searching">
                  <span className="gm-spinner" />
                  <span>正在向量检索...</span>
                </div>
              )}

              {!loadingCands && candsError && (
                <div className="gm-no-rag">
                  <AlertCircle size={14} />
                  {candsError}
                  <span>（如未建立索引可直接跳过）</span>
                </div>
              )}

              {!loadingCands && !candsError && candidates.length === 0 && (
                <div className="gm-no-rag">
                  未找到相关往期文章
                  <span>（可先在知识库页面建立向量索引）</span>
                </div>
              )}

              {!loadingCands && candidates.length > 0 && (
                <div className="gm-cand-list">
                  {candidates.map(c => {
                    const checked = selected.has(c.dir)
                    const color   = simColor(c.sim)
                    const isPreviewing = previewDir === c.dir
                    return (
                      <div
                        key={c.dir}
                        className={`gm-cand-card gm-cand-card--${color} ${checked ? 'gm-cand-card--selected' : ''}`}
                      >
                        <div className="gm-cand-row">
                          <label className="gm-cand-check">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSelect(c.dir)}
                            />
                            <span className="gm-cand-checkmark" />
                          </label>
                          <div className="gm-cand-info" onClick={() => toggleSelect(c.dir)}>
                            <div className="gm-cand-title">{c.title}</div>
                            <div className="gm-cand-meta">
                              <span className="gm-cand-dir">{c.dir}</span>
                              <span className={`gm-cand-sim gm-cand-sim--${color}`}>{c.sim}% 相似</span>
                            </div>
                            <p className="gm-cand-snippet">{c.snippet}</p>
                          </div>
                          <button
                            className={`gm-cand-preview-btn ${isPreviewing ? 'gm-cand-preview-btn--active' : ''}`}
                            title={isPreviewing ? '收起预览' : '预览全文'}
                            onClick={() => fetchPreview(c.dir)}
                          >
                            {isPreviewing ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                        </div>

                        {/* 内联预览区 */}
                        {isPreviewing && (
                          <div className="gm-cand-preview">
                            {loadingPreview ? (
                              <div className="gm-searching">
                                <span className="gm-spinner gm-spinner-sm" /> 读取中...
                              </div>
                            ) : previewData ? (
                              <>
                                <pre className="gm-cand-preview-text">{previewData.content.slice(0, 800)}{previewData.content.length > 800 ? '\n…（截断，完整内容将注入 AI）' : ''}</pre>
                              </>
                            ) : previewError ? (
                              <div className="gm-cand-preview-err">
                                读取内容失败——服务端可能需要重启以加载最新代码，或该文章暂无内容
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 右：上下文可视化面板 */}
            <div className="gm-pick-right">
              <div className="gm-section-label">
                将注入的上下文
                {selected.size > 0 && <span className="gm-count">{selected.size} 篇</span>}
                {selected.size > 0 && (
                    <button
                      className="gm-ctx-refresh-btn"
                      onClick={() => loadSelectedContext()}
                      title="预览将注入 AI 的上下文内容"
                      disabled={loadingCtxPanel}
                    >
                      {loadingCtxPanel
                        ? <><span className="gm-spinner gm-spinner-sm" /> 加载中</>
                        : <><Eye size={12} /> 预览</>}
                    </button>
                  )}
              </div>

              {/* 平台选择 */}
              <div className="gm-platform-selector">
                <span className="gm-platform-selector-label">生成平台</span>
                <div className="gm-platform-selector-btns">
                  <button
                    className={`gm-platform-selector-btn ${platforms === 'both' ? 'gm-platform-selector-btn--active' : ''}`}
                    onClick={() => setPlatforms('both')}
                  >
                    <span className="gm-platform-badge gm-platform-badge--wechat">公众号</span>
                    <span>+</span>
                    <span className="gm-platform-badge gm-platform-badge--toutiao">今日头条</span>
                  </button>
                  <button
                    className={`gm-platform-selector-btn ${platforms === 'wechat' ? 'gm-platform-selector-btn--active' : ''}`}
                    onClick={() => setPlatforms('wechat')}
                  >
                    <span className="gm-platform-badge gm-platform-badge--wechat">仅公众号</span>
                  </button>
                  <button
                    className={`gm-platform-selector-btn ${platforms === 'toutiao' ? 'gm-platform-selector-btn--active' : ''}`}
                    onClick={() => setPlatforms('toutiao')}
                  >
                    <span className="gm-platform-badge gm-platform-badge--toutiao">仅今日头条</span>
                  </button>
                </div>
              </div>

              {selected.size === 0 ? (
                <div className="gm-ctx-empty">
                  <FileText size={28} className="gm-ctx-empty-icon" />
                  <p>左侧勾选往期文章，AI 会把它们作为风格和结构参考注入到公众号 prompt 中</p>
                  <p className="gm-ctx-hint">今日头条文章不注入往期参考，直接按平台风格生成</p>
                </div>
              ) : (
                <div className="gm-ctx-selected">
                  {candidates
                    .filter(c => selected.has(c.dir))
                    .map(c => (
                      <div key={c.dir} className="gm-ctx-item">
                        <div className="gm-ctx-item-title">{c.title}</div>
                        <div className="gm-ctx-item-meta">{c.dir} · {c.sim}% 相似</div>
                      </div>
                    ))}

                  {showContextPanel && (
                    <div className="gm-ctx-panel">
                      <div className="gm-ctx-panel-head">
                        <span>将注入 AI 的完整上下文</span>
                        <button onClick={() => setShowContextPanel(false)}><X size={12} /></button>
                      </div>
                      {loadingCtxPanel ? (
                        <div className="gm-ctx-panel-loading">
                          <span className="gm-spinner gm-spinner-sm" /> 读取文章内容...
                        </div>
                      ) : ctxPanelError || !ragContext ? (
                        <div className="gm-ctx-panel-empty">
                          读取文章内容失败，请确认已建立 RAG 索引，或服务端已重启
                        </div>
                      ) : (
                        <pre className="gm-ctx-panel-text">{ragContext}</pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            阶段 2/3：双平台流式生成区
        ══════════════════════════════════════════════════════ */}
        {(phase === 'generate' || phase === 'done' || phase === 'error') && (
          <div className="gm-body">

            {/* 左：已选参考文章（只读） */}
            <div className="gm-left">
              <div className="gm-section-label">
                参考往期内容
                {selected.size > 0 && <span className="gm-count">{selected.size}</span>}
              </div>

              {selected.size === 0 && (
                <div className="gm-no-rag">
                  本次未使用往期文章参考
                </div>
              )}

              {contextArticles.length > 0 && (
                <div className="gm-rag-list">
                  {contextArticles.map((a, i) => (
                    <div key={i} className={`gm-rag-card gm-rag-card-${simColor(candidates.find(c => c.dir === a.dir)?.sim ?? 70)}`}>
                      <div className="gm-rag-card-header">
                        <span className="gm-rag-type-badge">
                          <FileText size={13} />
                          往期文章
                        </span>
                        <span className="gm-rag-dir">{a.dir}</span>
                      </div>
                      <p className="gm-rag-snippet">{a.title}</p>
                    </div>
                  ))}
                </div>
              )}

              {selected.size > 0 && contextArticles.length === 0 && (
                <div className="gm-searching">
                  <span className="gm-spinner gm-spinner-sm" />
                  <span>加载中...</span>
                </div>
              )}

              {/* 生成进度状态 */}
              <div className="gm-gen-progress">
                {platforms !== 'toutiao' && (
                  <div className={`gm-gen-progress-item ${wechatDone ? 'gm-gen-progress-item--done' : (phase === 'generate' && !wechatDone ? 'gm-gen-progress-item--active' : '')}`}>
                    <span className="gm-platform-badge gm-platform-badge--wechat">公众号</span>
                    {wechatDone
                      ? <CheckCircle size={13} className="gm-icon-ok" />
                      : (phase === 'generate' && !wechatDone ? <span className="gm-spinner gm-spinner-sm" /> : null)
                    }
                  </div>
                )}
                {platforms !== 'wechat' && (
                  <div className={`gm-gen-progress-item ${toutiaoDone ? 'gm-gen-progress-item--done' : (phase === 'generate' && (platforms === 'toutiao' || wechatDone) && !toutiaoDone ? 'gm-gen-progress-item--active' : '')}`}>
                    <span className="gm-platform-badge gm-platform-badge--toutiao">今日头条</span>
                    {toutiaoDone
                      ? <CheckCircle size={13} className="gm-icon-ok" />
                      : ((platforms === 'toutiao' || wechatDone) && !toutiaoDone ? <span className="gm-spinner gm-spinner-sm" /> : null)
                    }
                  </div>
                )}
              </div>
            </div>

            {/* 右：双平台流式输出区 */}
            <div className="gm-right">
              {/* 平台切换 Tab（只在两者都生成时显示） */}
              {platforms === 'both' && (
                <div className="gm-platform-tabs">
                  <button
                    className={`gm-platform-tab ${activeTab === 'wechat' ? 'gm-platform-tab--active' : ''}`}
                    onClick={() => setActiveTab('wechat')}
                  >
                    <span className="gm-platform-badge gm-platform-badge--wechat">公众号</span>
                    {wechatDone && <CheckCircle size={12} className="gm-icon-ok" />}
                    {!wechatDone && phase === 'generate' && <span className="gm-spinner gm-spinner-sm" />}
                  </button>
                  <button
                    className={`gm-platform-tab ${activeTab === 'toutiao' ? 'gm-platform-tab--active' : ''}`}
                    onClick={() => setActiveTab('toutiao')}
                  >
                    <span className="gm-platform-badge gm-platform-badge--toutiao">今日头条</span>
                    {toutiaoDone && <CheckCircle size={12} className="gm-icon-ok" />}
                    {!toutiaoDone && wechatDone && phase === 'generate' && <span className="gm-spinner gm-spinner-sm" />}
                  </button>
                  <div className="gm-section-label" style={{ marginLeft: 'auto' }}>
                    {phase === 'generate' && <span className="gm-spinner gm-spinner-sm" />}
                    {phase === 'done'     && <CheckCircle size={13} className="gm-icon-ok" />}
                    {phase === 'error'    && <AlertCircle size={13} className="gm-icon-err" />}
                  </div>
                </div>
              )}

              {/* 公众号内容（单平台时无 tab，直接显示） */}
              {platforms !== 'toutiao' && (
                <div
                  className="gm-stream"
                  ref={streamRefWechat}
                  style={{ display: platforms === 'wechat' || activeTab === 'wechat' ? 'block' : 'none' }}
                >
                  {phase === 'error' ? (
                    <div className="gm-error-msg">
                      <AlertCircle size={16} />
                      {errorMsg}
                    </div>
                  ) : streamTextWechat ? (
                    <pre className="gm-stream-text">{streamTextWechat}</pre>
                  ) : (
                    <div className="gm-stream-empty">
                      <span className="gm-spinner" />
                      <p>{statusMsg || 'AI 正在生成公众号文章...'}</p>
                    </div>
                  )}
                </div>
              )}

              {/* 今日头条内容（单平台时无 tab，直接显示） */}
              {platforms !== 'wechat' && (
                <div
                  className="gm-stream"
                  ref={streamRefToutiao}
                  style={{ display: platforms === 'toutiao' || activeTab === 'toutiao' ? 'block' : 'none' }}
                >
                  {phase === 'error' ? (
                    <div className="gm-error-msg">
                      <AlertCircle size={16} />
                      {errorMsg}
                    </div>
                  ) : streamTextToutiao ? (
                    <pre className="gm-stream-text">{streamTextToutiao}</pre>
                  ) : wechatDone || platforms === 'toutiao' ? (
                    <div className="gm-stream-empty">
                      <span className="gm-spinner" />
                      <p>AI 正在生成今日头条文章...</p>
                    </div>
                  ) : (
                    <div className="gm-stream-empty gm-stream-empty--waiting">
                      <p>公众号文章生成完成后，将自动开始生成今日头条版本</p>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        )}

        {/* ── Footer ── */}
        <div className="gm-footer">
          <div className="gm-footer-left">
            {phase === 'pick' && !loadingCands && (
              <span className="gm-footer-note">
                {selected.size > 0
                  ? `已选 ${selected.size} 篇作为公众号参考`
                  : '不选则跳过往期参考，直接生成'}
              </span>
            )}
            {phase === 'done' && (
              <span className="gm-footer-note">
                {platforms === 'wechat' ? '公众号文章已生成完毕'
                  : platforms === 'toutiao' ? '今日头条文章已生成完毕'
                  : '公众号 + 今日头条两篇文章已生成完毕'}
                {contextArticles.length > 0 && `，参考了 ${contextArticles.length} 篇往期文章`}
              </span>
            )}
          </div>
          <div className="gm-footer-actions">
            <button className="gm-btn-secondary" onClick={handleClose}>
              {phase === 'done' ? '关闭' : '取消'}
            </button>
            {phase === 'pick' && (
              <button
                className="gm-btn-primary"
                onClick={handleStartGenerate}
                disabled={loadingCands}
              >
                <Zap size={14} />
                {selected.size > 0 ? `注入 ${selected.size} 篇 · 开始生成` : '直接生成'}
              </button>
            )}
            {phase === 'done' && (
              <button className="gm-btn-primary" onClick={handleApply}>
                应用到编辑器
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
