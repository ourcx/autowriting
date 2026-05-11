import { useState, useRef, useEffect, useCallback } from 'react'
import { toast } from './Toast'
import { Eye, Edit2, Copy, Download, Sparkles, Check, X, RotateCcw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { loadAIConfig } from '../utils/aiConfig'
import './MarkdownEditor.css'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  height?: string
  articleId?: string
}

type AIAction = 'polish' | 'shorten' | 'expand' | 'rewrite-lead'

const AI_ACTIONS: { id: AIAction; label: string; desc: string }[] = [
  { id: 'polish',       label: '润色',   desc: '去 AI 腔，保持意思' },
  { id: 'shorten',      label: '缩短',   desc: '精简到 60%，去废话' },
  { id: 'expand',       label: '扩写',   desc: '补具体案例或数据' },
  { id: 'rewrite-lead', label: '改开头', desc: '直接切入，去掉铺垫' },
]

interface FloatMenu {
  x: number
  y: number
  selStart: number
  selEnd: number
  selectedText: string
}

export default function MarkdownEditor({
  value,
  onChange,
  placeholder = '输入 Markdown 内容...',
  height = '500px',
  articleId = '',
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>('edit')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── AI 内联助手状态 ──
  const [floatMenu, setFloatMenu]     = useState<FloatMenu | null>(null)
  const [aiLoading, setAiLoading]     = useState(false)
  const [aiResult, setAiResult]       = useState<string | null>(null)
  const [aiAction, setAiAction]       = useState<AIAction | null>(null)
  const floatRef = useRef<HTMLDivElement>(null)

  // 监听选区变化，用 textarea 镜像层精确定位
  const handleSelect = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    if (end <= start + 5) { setFloatMenu(null); return }

    const selectedText = value.substring(start, end)
    if (!selectedText.trim()) { setFloatMenu(null); return }

    // 用隐藏镜像 div 精确测量选区末尾坐标
    const mirror = document.createElement('div')
    const style  = window.getComputedStyle(ta)
    ;['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing',
      'paddingTop','paddingLeft','paddingRight','paddingBottom',
      'borderTopWidth','borderLeftWidth','borderRightWidth','borderBottomWidth',
      'boxSizing','wordWrap','whiteSpace','tabSize',
    ].forEach(p => { (mirror.style as unknown as Record<string,string>)[p] = style[p as keyof CSSStyleDeclaration] as string })
    mirror.style.position   = 'fixed'
    mirror.style.visibility = 'hidden'
    mirror.style.overflow   = 'hidden'
    mirror.style.width      = `${ta.clientWidth}px`
    mirror.style.height     = 'auto'
    mirror.style.top        = '0'
    mirror.style.left       = '0'
    mirror.style.whiteSpace = 'pre-wrap'

    const textBefore = document.createElement('span')
    textBefore.textContent = value.substring(0, end)
    const caret = document.createElement('span')
    caret.textContent = '|'
    mirror.appendChild(textBefore)
    mirror.appendChild(caret)
    document.body.appendChild(mirror)

    const taRect     = ta.getBoundingClientRect()
    const caretRect  = caret.getBoundingClientRect()
    document.body.removeChild(mirror)

    // 将镜像坐标映射回 textarea 视口坐标（减去滚动偏移）
    const rawY = taRect.top + (caretRect.top - ta.scrollTop)

    // 浮窗出现在选区末尾下方 8px，超出 viewport 底部则向上翻转
    const POPUP_H  = 52
    const viewH    = window.innerHeight
    const flippedY = rawY + caretRect.height + 8
    const finalY   = flippedY + POPUP_H > viewH - 12 ? rawY - POPUP_H - 6 : flippedY

    // X 轴：跟随光标，右侧超出则右对齐
    const POPUP_W = 340
    const rawX    = caretRect.left
    const finalX  = rawX + POPUP_W > window.innerWidth - 12 ? window.innerWidth - POPUP_W - 12 : rawX

    setFloatMenu({
      x: finalX,
      y: finalY,
      selStart: start,
      selEnd: end,
      selectedText,
    })
    setAiResult(null)
    setAiAction(null)
  }, [value])

  // 点击外部关闭浮窗
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (floatRef.current && !floatRef.current.contains(e.target as Node)) {
        const ta = textareaRef.current
        if (ta && ta.contains(e.target as Node)) return
        setFloatMenu(null)
        setAiResult(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleAIAction = async (action: AIAction) => {
    if (!floatMenu) return
    setAiLoading(true)
    setAiAction(action)
    setAiResult(null)
    try {
      const aiConfig = loadAIConfig()
      const resp = await fetch(`/api/articles/${articleId}/inline-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selected:    floatMenu.selectedText,
          fullArticle: value,           // 整篇文章，供后端做上下文感知
          action,
          aiConfig,
        }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || '操作失败')
      setAiResult(data.result)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '操作失败')
      setAiLoading(false)
    }
    setAiLoading(false)
  }

  const applyResult = () => {
    if (!floatMenu || !aiResult) return
    const newValue =
      value.substring(0, floatMenu.selStart) +
      aiResult +
      value.substring(floatMenu.selEnd)
    onChange(newValue)
    setFloatMenu(null)
    setAiResult(null)
    toast.success('已应用')
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    toast.info('已复制到剪贴板')
  }

  const handleDownload = () => {
    const element = document.createElement('a')
    const file = new Blob([value], { type: 'text/markdown' })
    element.href = URL.createObjectURL(file)
    element.download = `article_${Date.now()}.md`
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
  }

  const insertMarkdown = (before: string, after: string = '') => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end   = textarea.selectionEnd
    const selectedText = value.substring(start, end)
    const newValue =
      value.substring(0, start) + before + selectedText + after + value.substring(end)
    onChange(newValue)
    setTimeout(() => {
      textarea.focus()
      const newCursorPos = start + before.length + selectedText.length
      textarea.setSelectionRange(newCursorPos, newCursorPos)
    }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') { e.preventDefault(); insertMarkdown('    ') }
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); insertMarkdown('**', '**') }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); insertMarkdown('*', '*') }
  }

  return (
    <div className="markdown-editor">
      {/* ── Toolbar ── */}
      <div className="editor-toolbar">
        <div className="toolbar-left">
          <button className={`toolbar-btn ${mode === 'edit'    ? 'active' : ''}`} onClick={() => setMode('edit')}    title="编辑模式"><Edit2 size={18} />编辑</button>
          <button className={`toolbar-btn ${mode === 'preview' ? 'active' : ''}`} onClick={() => setMode('preview')} title="预览模式"><Eye   size={18} />预览</button>
          <button className={`toolbar-btn ${mode === 'split'   ? 'active' : ''}`} onClick={() => setMode('split')}   title="分屏模式"><div className="split-icon">⊞</div>分屏</button>
        </div>
        <div className="toolbar-right">
          <button className="toolbar-btn" onClick={() => insertMarkdown('# ')}       title="标题 1">H1</button>
          <button className="toolbar-btn" onClick={() => insertMarkdown('## ')}      title="标题 2">H2</button>
          <button className="toolbar-btn" onClick={() => insertMarkdown('**', '**')} title="加粗 (Ctrl+B)"><strong>B</strong></button>
          <button className="toolbar-btn" onClick={() => insertMarkdown('*', '*')}   title="斜体 (Ctrl+I)"><em>I</em></button>
          <button className="toolbar-btn" onClick={() => insertMarkdown('- ')}       title="列表">≡</button>
          <button className="toolbar-btn" onClick={() => insertMarkdown('[', '](url)')} title="链接">🔗</button>
          <button className="toolbar-btn" onClick={() => insertMarkdown('```\n', '\n```')} title="代码块">{'<>'}</button>
          <div className="toolbar-divider" />
          <button className="toolbar-btn" onClick={handleCopy}     title="复制"><Copy     size={18} /></button>
          <button className="toolbar-btn" onClick={handleDownload} title="下载"><Download size={18} /></button>
        </div>
      </div>

      {/* ── Editor area ── */}
      <div className="editor-container" style={{ height, position: 'relative' }}>
        {(mode === 'edit' || mode === 'split') && (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => { onChange(e.target.value); setFloatMenu(null) }}
            onKeyDown={handleKeyDown}
            onMouseUp={handleSelect}
            onKeyUp={handleSelect}
            placeholder={placeholder}
            className="editor-textarea"
            spellCheck={false}
          />
        )}

        {(mode === 'preview' || mode === 'split') && (
          <div className="editor-preview markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {value || '*预览内容将显示在这里*'}
            </ReactMarkdown>
          </div>
        )}

        {/* ── AI 浮窗（fixed 跟随选区末尾） ── */}
        {floatMenu && (mode === 'edit' || mode === 'split') && (
          <div
            ref={floatRef}
            className={`ai-float-menu${aiResult ? ' ai-float-menu--result' : ''}`}
            style={{ top: floatMenu.y, left: floatMenu.x }}
          >
            {!aiResult ? (
              /* ── 操作按钮行 ── */
              <>
                <span className="ai-float-label">
                  <Sparkles size={11} />
                  AI
                </span>
                <div className="ai-float-divider" />
                <div className="ai-float-actions">
                  {AI_ACTIONS.map(a => (
                    <button
                      key={a.id}
                      className={`ai-float-btn${aiLoading && aiAction === a.id ? ' ai-float-btn--loading' : ''}`}
                      onClick={() => handleAIAction(a.id)}
                      disabled={aiLoading}
                      title={a.desc}
                    >
                      {aiLoading && aiAction === a.id
                        ? <><span className="ai-spin" />{a.label}</>
                        : a.label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              /* ── 结果展示行 ── */
              <div className="ai-float-result">
                <div className="ai-float-result-text">{aiResult}</div>
                <div className="ai-float-result-actions">
                  <button className="ai-float-apply" onClick={applyResult}>
                    <Check size={12} />应用
                  </button>
                  <button
                    className="ai-float-retry"
                    onClick={() => { setAiResult(null); aiAction && handleAIAction(aiAction) }}
                    title="重新生成"
                  >
                    <RotateCcw size={12} />
                  </button>
                  <button
                    className="ai-float-cancel"
                    onClick={() => { setAiResult(null); setFloatMenu(null) }}
                    title="关闭"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="editor-footer">
        <span className="char-count">{value.length} 字符 · {value.split('\n').length} 行</span>
        {floatMenu && <span className="char-count" style={{ color: 'var(--color-brand-teal)' }}>已选 {floatMenu.selectedText.length} 字 · 选中后点击 AI 助手操作</span>}
      </div>
    </div>
  )
}
