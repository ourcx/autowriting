/**
 * GenerateModal — 流式生成弹窗
 *
 * 三阶段 UI：
 *   1. rag      — 检索往期文章（spinner + 来源列表）
 *   2. generate — AI 流式输出（实时文本滚动）
 *   3. done     — 完成（显示应用 / 关闭按钮）
 */
import { useEffect, useRef, useState } from 'react'
import { X, ChevronDown, ChevronRight, CheckCircle, AlertCircle } from 'lucide-react'
import './GenerateModal.css'

interface RagDoc {
  content: string
  source:  string
  type:    string
  dir:     string
  score:   number
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

export default function GenerateModal({ articleId, task, materials, aiConfig, onComplete, onClose }: Props) {
  const [phase,      setPhase]      = useState<Phase>('rag')
  const [statusMsg,  setStatusMsg]  = useState('正在检索往期相关文章...')
  const [ragDocs,    setRagDocs]    = useState<RagDoc[]>([])
  const [ragOpen,    setRagOpen]    = useState(false)
  const [streamText, setStreamText] = useState('')
  const [errorMsg,   setErrorMsg]   = useState('')
  const [ragCount,   setRagCount]   = useState(0)

  const textRef  = useRef<HTMLDivElement>(null)
  const fullText = useRef('')
  const abortRef = useRef<AbortController | null>(null)

  // 挂载即开始流式请求
  useEffect(() => {
    const ctrl = new AbortController()
    abortRef.current = ctrl
    startStream(ctrl.signal)
    return () => ctrl.abort()
  }, [])

  // 自动滚动到底部
  useEffect(() => {
    if (textRef.current) {
      textRef.current.scrollTop = textRef.current.scrollHeight
    }
  }, [streamText])

  async function startStream(signal: AbortSignal) {
    try {
      const resp = await fetch(`/api/articles/${articleId}/generate/stream`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ task, materials, aiConfig }),
        signal,
      })

      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`)
      }

      const reader  = resp.body.getReader()
      const decoder = new TextDecoder('utf-8')

      // 用 event+data 配对解析标准 SSE
      let lineBuf  = ''
      let curEvent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        lineBuf += decoder.decode(value, { stream: true })

        // 按行处理
        const lines = lineBuf.split('\n')
        lineBuf = lines.pop() ?? ''  // 末尾不完整行留到下次

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) {
            curEvent = ''  // 空行是 SSE 块分隔符，重置 event
            continue
          }
          if (trimmed.startsWith('event:')) {
            curEvent = trimmed.slice(6).trim()
            continue
          }
          if (trimmed.startsWith('data:')) {
            const raw = trimmed.slice(5).trim()
            try {
              const payload = JSON.parse(raw) as Record<string, unknown>
              dispatch(curEvent || inferEvent(payload), payload)
            } catch {
              // 忽略非 JSON
            }
          }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') return
      setPhase('error')
      setErrorMsg((e as Error).message || '生成失败')
    }
  }

  /** 根据 payload 字段推断事件类型（兜底） */
  function inferEvent(p: Record<string, unknown>): string {
    if (p.step)                       return 'status'
    if (p.docs !== undefined)         return 'rag'
    if (p.text !== undefined)         return 'chunk'
    if (p.article !== undefined)      return 'done'
    if (p.message !== undefined)      return 'error'
    return ''
  }

  /** 派发 SSE 事件到状态更新 */
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

  const handleApply = () => {
    onComplete(fullText.current)
    onClose()
  }

  const handleClose = () => {
    abortRef.current?.abort()
    onClose()
  }

  const typeLabel: Record<string, string> = {
    article:  '往期文章',
    task:     '任务参考',
    materials:'素材',
    task_sub: '任务参考',
  }

  return (
    <div className="gm-overlay" onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
      <div className="gm-modal">

        {/* ── Header ── */}
        <div className="gm-header">
          <div className="gm-header-left">
            <span className="gm-title">AI 生成文章</span>
            {phase !== 'error' && (
              <span className={`gm-badge gm-badge-${phase}`}>
                {phase === 'rag'      && '检索中'}
                {phase === 'generate' && '生成中'}
                {phase === 'done'     && '已完成'}
              </span>
            )}
          </div>
          <button className="gm-close" onClick={handleClose} title="关闭">
            <X size={18} />
          </button>
        </div>

        {/* ── Status bar ── */}
        {(phase === 'rag' || phase === 'generate') && (
          <div className="gm-status">
            <span className="gm-spinner" />
            <span>{statusMsg}</span>
          </div>
        )}
        {phase === 'done' && (
          <div className="gm-status gm-status-done">
            <CheckCircle size={15} />
            <span>生成完成{ragCount > 0 ? `，参考了 ${ragCount} 段往期内容` : ''}</span>
          </div>
        )}
        {phase === 'error' && (
          <div className="gm-status gm-status-error">
            <AlertCircle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* ── RAG 来源（可折叠）── */}
        {ragDocs.length > 0 && (
          <div className="gm-rag">
            <button className="gm-rag-toggle" onClick={() => setRagOpen(v => !v)}>
              {ragOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              召回 {ragDocs.length} 段往期内容作为参考
            </button>
            {ragOpen && (
              <div className="gm-rag-list">
                {ragDocs.map((d, i) => (
                  <div key={i} className="gm-rag-item">
                    <div className="gm-rag-meta">
                      <span className="gm-rag-type">{typeLabel[d.type] || d.type}</span>
                      <span className="gm-rag-dir">{d.dir}</span>
                      <span className="gm-rag-score">相似度 {(1 - d.score).toFixed(2)}</span>
                    </div>
                    <p className="gm-rag-content">{d.content.slice(0, 120)}…</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 流式输出区 ── */}
        <div className="gm-stream" ref={textRef}>
          {streamText
            ? <pre className="gm-stream-text">{streamText}</pre>
            : phase !== 'error' && <p className="gm-stream-placeholder">等待 AI 输出...</p>
          }
        </div>

        {/* ── Footer ── */}
        <div className="gm-footer">
          <button className="gm-btn gm-btn-ghost" onClick={handleClose}>
            {phase === 'done' ? '关闭' : '取消'}
          </button>
          {phase === 'done' && (
            <button className="gm-btn gm-btn-primary" onClick={handleApply}>
              应用到编辑器
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
