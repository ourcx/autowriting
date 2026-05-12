/**
 * GenerateModal — 流式生成弹窗（Clay 设计风格）
 *
 * 三阶段 UI：
 *   1. rag      — 检索往期文章（卡片列表，始终可见）
 *   2. generate — AI 流式输出（实时文本滚动）
 *   3. done     — 完成（应用按钮）
 */
import { useEffect, useRef, useState } from 'react'
import { X, CheckCircle, AlertCircle, FileText, Layers, BookOpen } from 'lucide-react'
import './GenerateModal.css'

interface RagDoc {
  content:  string
  source:   string
  type:     string
  dir:      string
  score:    number
}

type Phase = 'rag' | 'generate' | 'done' | 'error'

interface Props {
  articleId:  string
  task:       string
  materials:  string
  aiConfig:   Record<string, unknown>
  onComplete: (article: string) => void
  onClose:    () => void
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  article:  { label: '往期文章', color: 'peach',   icon: <FileText  size={13} /> },
  task:     { label: '任务参考', color: 'lavender', icon: <Layers    size={13} /> },
  materials:{ label: '素材参考', color: 'ochre',   icon: <BookOpen  size={13} /> },
  task_sub: { label: '任务参考', color: 'lavender', icon: <Layers    size={13} /> },
}

export default function GenerateModal({ articleId, task, materials, aiConfig, onComplete, onClose }: Props) {
  const [phase,      setPhase]      = useState<Phase>('rag')
  const [statusMsg,  setStatusMsg]  = useState('正在检索往期相关文章...')
  const [ragDocs,    setRagDocs]    = useState<RagDoc[]>([])
  const [streamText, setStreamText] = useState('')
  const [errorMsg,   setErrorMsg]   = useState('')
  const [ragCount,   setRagCount]   = useState(0)

  const streamRef = useRef<HTMLDivElement>(null)
  const fullText  = useRef('')
  const abortRef  = useRef<AbortController | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    abortRef.current = ctrl
    startStream(ctrl.signal)
    return () => ctrl.abort()
  }, [])

  // 自动滚动到底部
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight
    }
  }, [streamText])

  async function startStream(signal: AbortSignal) {
    try {
      const token = localStorage.getItem('auth_token')
      const resp = await fetch(`/api/articles/${articleId}/generate/stream`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body:    JSON.stringify({ task, materials, aiConfig }),
        signal,
      })

      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)

      const reader  = resp.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let   lineBuf  = ''
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
    if (p.step !== undefined)    return 'status'
    if (p.docs !== undefined)    return 'rag'
    if (p.text !== undefined)    return 'chunk'
    if (p.article !== undefined) return 'done'
    if (p.message !== undefined) return 'error'
    return ''
  }

  function dispatch(event: string, payload: Record<string, unknown>) {
    switch (event) {
      case 'status':
        if (payload.step === 'rag')      { setPhase('rag');      setStatusMsg(payload.message as string) }
        if (payload.step === 'generate') { setPhase('generate'); setStatusMsg(payload.message as string) }
        break
      case 'rag':
        setRagDocs(payload.docs as RagDoc[])
        break
      case 'chunk': {
        const t = payload.text as string
        fullText.current += t
        setStreamText(fullText.current)
        break
      }
      case 'done':
        setPhase('done')
        setRagCount((payload.ragCount as number) || 0)
        break
      case 'error':
        setPhase('error')
        setErrorMsg(payload.message as string)
        break
    }
  }

  const handleApply = () => { onComplete(fullText.current); onClose() }
  const handleClose = () => { abortRef.current?.abort(); onClose() }

  return (
    <div className="gm-overlay" onClick={e => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="gm-modal">

        {/* ── Header ── */}
        <div className="gm-header">
          <div className="gm-header-left">
            <span className="gm-title">AI 生成文章</span>
            {phase !== 'error' && (
              <span className={`gm-pill gm-pill-${phase}`}>
                {phase === 'rag'      && '检索中'}
                {phase === 'generate' && '生成中'}
                {phase === 'done'     && '已完成'}
              </span>
            )}
          </div>
          <button className="gm-icon-btn" onClick={handleClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="gm-body">

          {/* ── 左栏：RAG 召回区 ── */}
          <div className="gm-left">
            <div className="gm-section-label">
              参考往期内容
              {ragDocs.length > 0 && <span className="gm-count">{ragDocs.length}</span>}
            </div>

            {/* 检索中状态 */}
            {phase === 'rag' && ragDocs.length === 0 && (
              <div className="gm-searching">
                <span className="gm-spinner" />
                <span>正在向量检索...</span>
              </div>
            )}

            {/* 无召回结果 */}
            {phase !== 'rag' && ragDocs.length === 0 && (
              <div className="gm-no-rag">
                未找到相关往期文章
                <span>（可先建立向量索引）</span>
              </div>
            )}

            {/* 召回卡片列表 */}
            {ragDocs.length > 0 && (
              <div className="gm-rag-list">
                {ragDocs.map((d, i) => {
                  const cfg = TYPE_CONFIG[d.type] || { label: d.type, color: 'cream', icon: <FileText size={13} /> }
                  return (
                    <div key={i} className={`gm-rag-card gm-rag-card-${cfg.color}`}>
                      <div className="gm-rag-card-header">
                        <span className="gm-rag-type-badge">
                          {cfg.icon}
                          {cfg.label}
                        </span>
                        <span className="gm-rag-dir">{d.dir}</span>
                        <span className="gm-rag-sim">{Math.round((1 - d.score) * 100)}%</span>
                      </div>
                      <p className="gm-rag-snippet">{d.content.slice(0, 100)}…</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── 右栏：流式输出区 ── */}
          <div className="gm-right">
            <div className="gm-section-label">
              生成内容
              {(phase === 'rag' || phase === 'generate') && <span className="gm-spinner gm-spinner-sm" />}
              {phase === 'done'  && <CheckCircle size={13} className="gm-icon-ok" />}
              {phase === 'error' && <AlertCircle size={13} className="gm-icon-err" />}
            </div>

            <div className="gm-stream" ref={streamRef}>
              {phase === 'error' ? (
                <div className="gm-error-msg">
                  <AlertCircle size={16} />
                  {errorMsg}
                </div>
              ) : streamText ? (
                <pre className="gm-stream-text">{streamText}</pre>
              ) : (
                <div className="gm-stream-empty">
                  <span className="gm-spinner" />
                  <p>{statusMsg}</p>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* ── Footer ── */}
        <div className="gm-footer">
          {phase === 'done' && ragCount > 0 && (
            <span className="gm-footer-note">参考了 {ragCount} 段往期内容</span>
          )}
          <div className="gm-footer-actions">
            <button className="gm-btn-secondary" onClick={handleClose}>
              {phase === 'done' ? '关闭' : '取消'}
            </button>
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
