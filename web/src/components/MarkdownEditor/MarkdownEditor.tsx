import { useState, useRef, useEffect, useCallback } from 'react'
import { toast } from '../Toast/Toast'
import { Edit2, Copy, Download, Sparkles, Check, X, RotateCcw, ImagePlus, Loader2, Zap } from 'lucide-react'
import { loadAIConfig } from '../../utils'
import PromptSelector from '../PromptSelector/PromptSelector'
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
  { id: 'polish', label: '润色', desc: '去 AI 腔，保持意思' },
  { id: 'shorten', label: '缩短', desc: '精简到 60%，去废话' },
  { id: 'expand', label: '扩写', desc: '补具体案例或数据' },
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── AI 内联助手状态 ──
  const [floatMenu, setFloatMenu] = useState<FloatMenu | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<string | null>(null)
  const [aiAction, setAiAction] = useState<AIAction | null>(null)
  const floatRef = useRef<HTMLDivElement>(null)

  // ── 图片上传状态 ──
  const [uploading, setUploading] = useState(false)

  // ── 提示词选择器状态 ──
  const [showPromptSelector, setShowPromptSelector] = useState(false)

  // 监听选区变化，用 textarea 镜像层精确定位
  const handleSelect = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    if (end <= start + 5) { setFloatMenu(null); return }

    const selectedText = value.substring(start, end)
    if (!selectedText.trim()) { setFloatMenu(null); return }

    // 用隐藏镜像 div 精确测量选区末尾坐标
    const mirror = document.createElement('div')
    const style = window.getComputedStyle(ta)
      ;['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
        'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom',
        'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'borderBottomWidth',
        'boxSizing', 'wordWrap', 'whiteSpace', 'tabSize',
      ].forEach(p => { (mirror.style as unknown as Record<string, string>)[p] = style[p as keyof CSSStyleDeclaration] as string })
    mirror.style.position = 'fixed'
    mirror.style.visibility = 'hidden'
    mirror.style.overflow = 'hidden'
    mirror.style.width = `${ta.clientWidth}px`
    mirror.style.height = 'auto'
    mirror.style.top = '0'
    mirror.style.left = '0'
    mirror.style.whiteSpace = 'pre-wrap'

    const textBefore = document.createElement('span')
    textBefore.textContent = value.substring(0, end)
    const caret = document.createElement('span')
    caret.textContent = '|'
    mirror.appendChild(textBefore)
    mirror.appendChild(caret)
    document.body.appendChild(mirror)

    const taRect = ta.getBoundingClientRect()
    const caretRect = caret.getBoundingClientRect()
    document.body.removeChild(mirror)

    // 将镜像坐标映射回 textarea 视口坐标（减去滚动偏移）
    const rawY = taRect.top + (caretRect.top - ta.scrollTop)

    // 浮窗出现在选区末尾下方 8px，超出 viewport 底部则向上翻转
    const POPUP_H = 52
    const viewH = window.innerHeight
    const flippedY = rawY + caretRect.height + 8
    const finalY = flippedY + POPUP_H > viewH - 12 ? rawY - POPUP_H - 6 : flippedY

    // X 轴：跟随光标，右侧超出则右对齐
    const POPUP_W = 340
    const rawX = caretRect.left
    const finalX = rawX + POPUP_W > window.innerWidth - 12 ? window.innerWidth - POPUP_W - 12 : rawX

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

  // ── 图片上传核心函数 ──────────────────────────────────────────────────────
  const uploadImageFile = useCallback(async (file: File): Promise<string | null> => {
    if (!file.type.startsWith('image/')) {
      toast.error('只支持图片文件')
      return null
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('图片超过 20MB 限制')
      return null
    }

    setUploading(true)
    const authToken = localStorage.getItem('auth_token')
    const authHeader: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {}

    try {
      const cfg = loadAIConfig()
      const cdnProvider = cfg.cdnProvider || 'none'

      // ── GitHub + jsDelivr ──────────────────────────────────────────────
      if (cdnProvider === 'github' && cfg.githubToken && cfg.githubRepo) {
        try {
          const formData = new FormData()
          formData.append('image', file)
          const resp = await fetch('/api/images/upload-github', {
            method: 'POST',
            headers: {
              'x-github-token': cfg.githubToken,
              'x-github-repo': cfg.githubRepo,
              'x-github-branch': cfg.githubBranch || 'main',
              'x-github-path': cfg.githubPath || 'images/',
              ...authHeader,
            },
            body: formData,
          })
          const data = await resp.json()
          if (resp.ok && data.url) return data.url as string
          console.warn('[github-cdn] 上传失败，降级本地：', data.error)
          toast.warn('GitHub 上传失败，已保存到本地')
        } catch (e) {
          console.warn('[github-cdn] 上传异常，降级本地：', e)
          toast.warn('GitHub 上传异常，已保存到本地')
        }
      }

      // ── Imgur ──────────────────────────────────────────────────────────
      if (cdnProvider === 'imgur' && cfg.imgurClientId) {
        try {
          const formData = new FormData()
          formData.append('image', file)
          const resp = await fetch('/api/images/upload-imgur', {
            method: 'POST',
            headers: { 'x-imgur-client-id': cfg.imgurClientId, ...authHeader },
            body: formData,
          })
          const data = await resp.json()
          if (resp.ok && data.url) return data.url as string
          console.warn('[imgur] 上传失败，降级本地：', data.error)
          toast.warn('Imgur 上传失败，已保存到本地')
        } catch (e) {
          console.warn('[imgur] 上传异常，降级本地：', e)
          toast.warn('Imgur 上传异常，已保存到本地')
        }
      }

      // ── 降级：本地存储 ─────────────────────────────────────────────────
      const formData = new FormData()
      formData.append('image', file)
      if (articleId) formData.append('articleId', articleId)
      const resp = await fetch('/api/images/upload', {
        method: 'POST',
        headers: authHeader,
        body: formData,
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || '上传失败')
      return data.url as string
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '图片上传失败')
      return null
    } finally {
      setUploading(false)
    }
  }, [articleId])

  // 在光标处插入图片 Markdown 语法
  const insertImageMarkdown = useCallback((url: string, alt = '图片') => {
    const ta = textareaRef.current
    const cursor = ta ? ta.selectionStart : value.length
    const mdImg = `![${alt}](${url})`
    const newValue = value.substring(0, cursor) + mdImg + value.substring(cursor)
    onChange(newValue)
    // 移动光标到图片语法后
    setTimeout(() => {
      if (ta) {
        ta.focus()
        const newPos = cursor + mdImg.length
        ta.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }, [value, onChange])

  // 粘贴事件：拦截图片粘贴
  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find(item => item.type.startsWith('image/'))
    if (!imageItem) return // 非图片粘贴，走默认行为

    e.preventDefault()
    const file = imageItem.getAsFile()
    if (!file) return

    toast.info('正在上传粘贴的图片...')
    const url = await uploadImageFile(file)
    if (url) {
      insertImageMarkdown(url, '图片')
      toast.success('图片已上传并插入')
    }
  }, [uploadImageFile, insertImageMarkdown])

  // 拖拽图片到编辑区
  const handleDrop = useCallback(async (e: React.DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
    if (files.length === 0) return
    e.preventDefault()

    toast.info(`正在上传 ${files.length} 张图片...`)
    for (const file of files) {
      const url = await uploadImageFile(file)
      if (url) insertImageMarkdown(url, file.name.replace(/\.[^.]+$/, ''))
    }
    if (files.length > 0) toast.success('图片上传完成')
  }, [uploadImageFile, insertImageMarkdown])

  const handleDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  // 点击工具栏图片按钮
  const handleImageButtonClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    // reset
    e.target.value = ''

    for (const file of files) {
      const url = await uploadImageFile(file)
      if (url) insertImageMarkdown(url, file.name.replace(/\.[^.]+$/, ''))
    }
  }

  const handleAIAction = async (action: AIAction) => {
    if (!floatMenu) return
    setAiLoading(true)
    setAiAction(action)
    setAiResult(null)
    try {
      const aiConfig = loadAIConfig()
      const token = localStorage.getItem('auth_token')
      const resp = await fetch(`/api/articles/${articleId}/inline-edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          selected: floatMenu.selectedText,
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
    const end = textarea.selectionEnd
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

  interface Prompt {
    id: string
    name: string
    category: string
    description: string
    content: string
    version: number
    tags: string[]
    isBuiltin: boolean
    usageCount: number
    createdAt: string
    updatedAt: string
    replacesId?: string | null
  }

  const handlePromptSelect = (prompt: Prompt) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const cursor = textarea.selectionStart
    const newValue = value.substring(0, cursor) + prompt.content + value.substring(cursor)
    onChange(newValue)
    setTimeout(() => {
      textarea.focus()
      const newPos = cursor + prompt.content.length
      textarea.setSelectionRange(newPos, newPos)
    }, 0)
    toast.success(`已插入提示词：${prompt.name}`)
  }

  return (
    <div className="markdown-editor">
      {/* 隐藏的文件 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* ── Toolbar ── */}
      <div className="editor-toolbar">
        <div className="toolbar-left">
          <button className={`toolbar-btn active`} title="编辑模式"><Edit2 size={18} />编辑</button>
        </div>
        <div className="toolbar-right">
          <button className="toolbar-btn" onClick={() => insertMarkdown('# ')} title="标题 1">H1</button>
          <button className="toolbar-btn" onClick={() => insertMarkdown('## ')} title="标题 2">H2</button>
          <button className="toolbar-btn" onClick={() => insertMarkdown('**', '**')} title="加粗 (Ctrl+B)"><strong>B</strong></button>
          <button className="toolbar-btn" onClick={() => insertMarkdown('*', '*')} title="斜体 (Ctrl+I)"><em>I</em></button>
          <button className="toolbar-btn" onClick={() => insertMarkdown('- ')} title="列表">≡</button>
          <button className="toolbar-btn" onClick={() => insertMarkdown('[', '](url)')} title="链接">🔗</button>
          <button className="toolbar-btn" onClick={() => insertMarkdown('```\n', '\n```')} title="代码块">{'<>'}</button>
          <div className="toolbar-divider" />
          <button
            className={`toolbar-btn toolbar-btn--image${uploading ? ' toolbar-btn--loading' : ''}`}
            onClick={handleImageButtonClick}
            disabled={uploading}
            title="上传图片（也可直接粘贴或拖拽图片到编辑区）"
          >
            {uploading
              ? <Loader2 size={16} className="spin" />
              : <ImagePlus size={16} />}
            图片
          </button>
          <div className="toolbar-divider" />
          <button
            className="toolbar-btn"
            onClick={() => setShowPromptSelector(true)}
            title="插入提示词"
          >
            <Zap size={16} />
            提示词
          </button>
          <div className="toolbar-divider" />
          <button className="toolbar-btn" onClick={handleCopy} title="复制"><Copy size={18} /></button>
          <button className="toolbar-btn" onClick={handleDownload} title="下载"><Download size={18} /></button>
        </div>
      </div>

      {/* ── Editor area ── */}
      <div className="editor-container" style={{ height, position: 'relative' }}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => { onChange(e.target.value); setFloatMenu(null) }}
          onKeyDown={handleKeyDown}
          onMouseUp={handleSelect}
          onKeyUp={handleSelect}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          placeholder={placeholder}
          className={`editor-textarea${uploading ? ' editor-textarea--uploading' : ''}`}
          spellCheck={false}
        />

        {/* 上传遮罩 */}
        {uploading && (
          <div className="editor-upload-overlay">
            <Loader2 size={28} className="spin" />
            <span>图片上传中...</span>
          </div>
        )}

        {/* ── AI 浮窗（fixed 跟随选区末尾） ── */}
        {floatMenu && (
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
        {uploading && <span className="char-count" style={{ color: 'var(--color-brand-teal)' }}>图片上传中...</span>}
        {!uploading && floatMenu && <span className="char-count" style={{ color: 'var(--color-brand-teal)' }}>已选 {floatMenu.selectedText.length} 字 · 选中后点击 AI 助手操作</span>}
        {!uploading && !floatMenu && <span className="char-count" style={{ color: 'var(--color-neutral-400)' }}>支持粘贴 / 拖拽图片到编辑区自动上传</span>}
      </div>

      {/* ── 提示词选择器 ── */}
      {showPromptSelector && (
        <PromptSelector
          onSelect={handlePromptSelect}
          onClose={() => setShowPromptSelector(false)}
        />
      )}
    </div>
  )
}
