import { Input } from "../FormControls/FormControls"
import Button from "../Button/Button"
import { useState, useRef, useEffect, useCallback } from 'react'
import { toast } from '../Toast/Toast'
import { Copy, Download, Sparkles, Check, X, RotateCcw, ImagePlus, Loader2, Zap, FileText, Code2, Link } from 'lucide-react'
import { aiRequestConfig, deepSeekKeyHeaders, loadAIConfig } from '../../utils/aiConfig'
import PromptSelector from '../PromptSelector/PromptSelector'
import InlineMarkdownInput, { type InlineMarkdownInputHandle } from "./InlineMarkdownInput"
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
  const editorRef = useRef<InlineMarkdownInputHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showImages, setShowImages] = useState(true)

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

  const handleSelect = useCallback((selection: ReturnType<InlineMarkdownInputHandle["getSelection"]>) => {
    const { start, end, left, top, bottom } = selection
    if (end <= start + 5) { setFloatMenu(null); return }
    const selectedText = editorRef.current?.getValue().substring(start, end) || ""
    if (!selectedText.trim()) { setFloatMenu(null); return }
    const POPUP_H = 52
    const viewH = window.innerHeight
    const flippedY = bottom + 8
    const finalY = flippedY + POPUP_H > viewH - 12 ? top - POPUP_H - 6 : flippedY
    const POPUP_W = 340
    const finalX = Math.max(12, Math.min(left, window.innerWidth - POPUP_W - 12))
    setFloatMenu({
      x: finalX,
      y: finalY,
      selStart: start,
      selEnd: end,
      selectedText,
    })
    setAiResult(null)
    setAiAction(null)
  }, [])

  // 点击外部关闭浮窗
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (floatRef.current && !floatRef.current.contains(e.target as Node)) {
        if (editorRef.current?.contains(e.target as Node)) return
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
    const editor = editorRef.current
    if (!editor) return
    const { start, end } = editor.getSelection()
    const caption = alt.replace(/[[\]\\\r\n]/g, " ").trim() || "图片"
    editor.replace(start, end, `\n\n![${caption}](${url})\n\n`)
  }, [])
  const uploadImages = useCallback(async (files: File[]) => {
    if (uploading) return
    let saved = 0
    for (const file of files) {
      const url = await uploadImageFile(file)
      if (url) { insertImageMarkdown(url, file.name.replace(/\.[^.]+$/, "")); saved++ }
    }
    if (saved) toast.success(`已插入 ${saved} 张图片`)
  }, [uploading, uploadImageFile, insertImageMarkdown])

  // 点击工具栏图片按钮
  const handleImageButtonClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    // reset
    e.target.value = ''

    await uploadImages(files)
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
          ...deepSeekKeyHeaders(),
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          selected: floatMenu.selectedText,
          fullArticle: value,           // 整篇文章，供后端做上下文感知
          action,
          aiConfig: aiRequestConfig(aiConfig),
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
    const editor = editorRef.current
    if (!editor || editor.getValue().substring(floatMenu.selStart, floatMenu.selEnd) !== floatMenu.selectedText) {
      toast.warn("原文已变化，请重新选中后操作")
      return
    }
    editor.replace(floatMenu.selStart, floatMenu.selEnd, aiResult)
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
    const editor = editorRef.current
    if (!editor) return
    const { start, end } = editor.getSelection()
    editor.replace(start, end, before + editor.getValue().substring(start, end) + after)
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
    const editor = editorRef.current
    if (!editor) return
    const { start, end } = editor.getSelection()
    editor.replace(start, end, prompt.content)
    toast.success(`已插入提示词：${prompt.name}`)
  }

  return (
    <div className="markdown-editor">
      {/* 隐藏的文件 input */}
      <Input
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
          <div className="editor-view-options" role="group" aria-label="正文显示方式">
            <Button variant="plain" className={`toolbar-btn${showImages ? " active" : ""}`} aria-pressed={showImages} onClick={() => setShowImages(true)}><FileText size={15} />图文</Button>
            <Button variant="plain" className={`toolbar-btn${!showImages ? " active" : ""}`} aria-pressed={!showImages} onClick={() => setShowImages(false)}><Code2 size={15} />Markdown</Button>
          </div>
        </div>
        <div className="toolbar-right">
          <Button variant="plain" className="toolbar-btn" onClick={() => insertMarkdown('# ')} title="标题 1">H1</Button>
          <Button variant="plain" className="toolbar-btn" onClick={() => insertMarkdown('## ')} title="标题 2">H2</Button>
          <Button variant="plain" className="toolbar-btn" onClick={() => insertMarkdown('**', '**')} title="加粗 (Ctrl+B)"><strong>B</strong></Button>
          <Button variant="plain" className="toolbar-btn" onClick={() => insertMarkdown('*', '*')} title="斜体 (Ctrl+I)"><em>I</em></Button>
          <Button variant="plain" className="toolbar-btn" onClick={() => insertMarkdown('- ')} title="列表">≡</Button>
          <Button variant="plain" className="toolbar-btn" onClick={() => insertMarkdown('[', '](url)')} title="链接"><Link size={16} /></Button>
          <Button variant="plain" className="toolbar-btn" onClick={() => insertMarkdown('```\n', '\n```')} title="代码块">{'<>'}</Button>
          <div className="toolbar-divider" />
          <Button variant="plain"
            className={`toolbar-btn toolbar-btn--image${uploading ? ' toolbar-btn--loading' : ''}`}
            onClick={handleImageButtonClick}
            disabled={uploading}
            title="上传图片（也可直接粘贴或拖拽图片到编辑区）"
          >
            {uploading
              ? <Loader2 size={16} className="spin" />
              : <ImagePlus size={16} />}
            图片
          </Button>
          <div className="toolbar-divider" />
          <Button variant="plain"
            className="toolbar-btn"
            onClick={() => setShowPromptSelector(true)}
            title="插入提示词"
          >
            <Zap size={16} />
            提示词
          </Button>
          <div className="toolbar-divider" />
          <Button variant="plain" className="toolbar-btn" onClick={handleCopy} title="复制"><Copy size={18} /></Button>
          <Button variant="plain" className="toolbar-btn" onClick={handleDownload} title="下载"><Download size={18} /></Button>
        </div>
      </div>

      {/* ── Editor area ── */}
      <div className="markdown-input-area" style={{ height, position: 'relative' }}>
        <InlineMarkdownInput
          ref={editorRef}
          value={value}
          onChange={text => { onChange(text); setFloatMenu(null) }}
          onSelect={handleSelect}
          onImageFiles={files => { void uploadImages(files) }}
          placeholder={placeholder}
          showImages={showImages}
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
                    <Button variant="plain"
                      key={a.id}
                      className={`ai-float-btn${aiLoading && aiAction === a.id ? ' ai-float-btn--loading' : ''}`}
                      onClick={() => handleAIAction(a.id)}
                      disabled={aiLoading}
                      title={a.desc}
                    >
                      {aiLoading && aiAction === a.id
                        ? <><span className="ai-spin" />{a.label}</>
                        : a.label}
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              /* ── 结果展示行 ── */
              <div className="ai-float-result">
                <div className="ai-float-result-text">{aiResult}</div>
                <div className="ai-float-result-actions">
                  <Button variant="plain" className="ai-float-apply" onClick={applyResult}>
                    <Check size={12} />应用
                  </Button>
                  <Button variant="plain"
                    className="ai-float-retry"
                    onClick={() => { setAiResult(null); aiAction && handleAIAction(aiAction) }}
                    title="重新生成"
                  >
                    <RotateCcw size={12} />
                  </Button>
                  <Button variant="plain"
                    className="ai-float-cancel"
                    onClick={() => { setAiResult(null); setFloatMenu(null) }}
                    title="关闭"
                  >
                    <X size={12} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="editor-footer">
        <span className="char-count">{value.length} 字符 · {(value.match(/!\[[^\]\n]*\]\([^)]+\)/g) || []).length} 张图</span>
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
