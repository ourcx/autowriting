import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Save, Copy, Check, Wand2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { toast, showConfirm } from '../components/Toast'
import { loadAIConfig } from '../utils/aiConfig'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import {
  TemplateItem,
  fetchAllTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
  createNewTemplate,
  BUILTIN_TEMPLATES,
  PREVIEW_MARKDOWN,
} from '../utils/templateStore'
import './StyleEditor.css'

// ── Markdown 渲染 ──────────────────────────────────────────────────────────

function highlight(str: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return `<pre><code class="hljs language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
    } catch { /* ignore */ }
  }
  const esc = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<pre><code class="hljs">${esc}</code></pre>`
}

const mdParser = new MarkdownIt({ html: false, linkify: true, typographer: false, highlight })
const previewHtml = mdParser.render(PREVIEW_MARKDOWN)

// ── 组件 ──────────────────────────────────────────────────────────────────

export default function StyleEditor() {
  const navigate = useNavigate()

  const [templates, setTemplates] = useState<TemplateItem[]>([])
  const [selectedId, setSelectedId] = useState<string>('default')
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editColor, setEditColor] = useState('#1e6bb8')
  const [editCss, setEditCss] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [saved, setSaved] = useState(false)

  // AI 生成面板状态
  const [aiPanelOpen, setAiPanelOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiPreviewCss, setAiPreviewCss] = useState('')  // 预览生成结果

  const styleElRef = useRef<HTMLStyleElement | null>(null)
  const cssTextareaRef = useRef<HTMLTextAreaElement>(null)

  // ── 拖拽分栏宽度 ─────────────────────────────────────────────
  const [sidebarWidth, setSidebarWidth] = useState(220)
  const [previewWidth, setPreviewWidth] = useState(380)

  const sidebarResizerRef = useRef<HTMLDivElement>(null)
  const previewResizerRef = useRef<HTMLDivElement>(null)

  // 左侧 resizer：调整 sidebar 宽度
  const handleSidebarResizerDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarWidth
    sidebarResizerRef.current?.classList.add('dragging')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      const w = Math.min(360, Math.max(160, startW + ev.clientX - startX))
      setSidebarWidth(w)
    }
    const onUp = () => {
      sidebarResizerRef.current?.classList.remove('dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  // 右侧 resizer：调整 preview 宽度（向左拖增大 preview，反之缩小）
  const handlePreviewResizerDown = useCallback((e: ReactMouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = previewWidth
    previewResizerRef.current?.classList.add('dragging')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      // 向左拖（clientX 减小）=> preview 变大
      const w = Math.min(600, Math.max(280, startW - (ev.clientX - startX)))
      setPreviewWidth(w)
    }
    const onUp = () => {
      previewResizerRef.current?.classList.remove('dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [previewWidth])

  // 加载模板列表（从服务端，fallback 本地）
  const reloadTemplates = useCallback(() => {
    fetchAllTemplates().then(setTemplates).catch(() => {})
  }, [])

  useEffect(() => {
    reloadTemplates()
    window.addEventListener('wxtemplates-updated', reloadTemplates)
    return () => window.removeEventListener('wxtemplates-updated', reloadTemplates)
  }, [reloadTemplates])

  // 选中模板时加载数据
  useEffect(() => {
    const t = templates.find(t => t.id === selectedId)
    if (!t) return
    setEditName(t.name)
    setEditDesc(t.desc)
    setEditColor(t.accentColor)
    setEditCss(t.css)
    setIsDirty(false)
  }, [selectedId, templates])

  // 实时把 CSS 注入预览区
  useEffect(() => {
    const id = 'se-template-style'
    if (!styleElRef.current) {
      let el = document.getElementById(id) as HTMLStyleElement | null
      if (!el) {
        el = document.createElement('style')
        el.id = id
        document.head.appendChild(el)
      }
      styleElRef.current = el
    }
    styleElRef.current.textContent = editCss
    return () => { if (styleElRef.current) styleElRef.current.textContent = '' }
  }, [editCss])

  const isBuiltin = BUILTIN_TEMPLATES.some(t => t.id === selectedId)
  const selectedTemplate = templates.find(t => t.id === selectedId)

  // 保存（自定义）
  const handleSave = async () => {
    if (!selectedTemplate) return
    const t: TemplateItem = {
      ...selectedTemplate,
      name: editName,
      desc: editDesc,
      accentColor: editColor,
      css: editCss,
      isBuiltin: false,
    }
    await saveCustomTemplate(t)
    setIsDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // 克隆内置模板 → 新自定义模板
  const handleClone = async () => {
    if (!selectedTemplate) return
    const t = createNewTemplate({
      name: `${selectedTemplate.name} 副本`,
      desc: selectedTemplate.desc,
      accentColor: selectedTemplate.accentColor,
      css: selectedTemplate.css,
    })
    await saveCustomTemplate(t)
    setSelectedId(t.id)
  }

  // 新建空模板
  const handleNewTemplate = async () => {
    const t = createNewTemplate()
    await saveCustomTemplate(t)
    setSelectedId(t.id)
  }

  // 删除自定义模板
  const handleDelete = () => {
    if (isBuiltin || !selectedTemplate) return
    showConfirm({
      message: `确定删除「${selectedTemplate.name}」？`,
      detail: '删除后无法恢复。',
      confirmText: '删除',
      danger: true,
      onConfirm: async () => {
        await deleteCustomTemplate(selectedId)
        setSelectedId('default')
      },
    })
  }

  // AI 生成样式
  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) {
      toast.warn('请先输入风格描述')
      return
    }
    try {
      setAiGenerating(true)
      setAiPreviewCss('')
      const aiConfig = loadAIConfig()
      const resp = await fetch('/api/generate-style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt,
          baseCSS: editCss,
          aiConfig,
        }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || '生成失败')
      setAiPreviewCss(data.css)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '生成失败'
      toast.error(msg)
    } finally {
      setAiGenerating(false)
    }
  }

  // 把 AI 预览结果应用到编辑器
  const handleApplyAI = () => {
    if (!aiPreviewCss) return
    setEditCss(aiPreviewCss)
    setIsDirty(true)
    setAiPreviewCss('')
    setAiPanelOpen(false)
    toast.success('样式已应用，记得点保存')
  }

  // CSS textarea Tab 键支持
  const handleCssKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart
      const end = el.selectionEnd
      const newVal = el.value.slice(0, start) + '  ' + el.value.slice(end)
      setEditCss(newVal)
      setIsDirty(true)
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2
      })
    }
  }

  const builtinList = templates.filter(t => t.isBuiltin)
  const customList = templates.filter(t => !t.isBuiltin)

  return (
    <div className="se-root">
      {/* ── 顶部导航 ── */}
      <header className="se-header">
        <div className="se-header-left">
          <button className="se-back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={15} />
            返回
          </button>
          <div className="se-header-title">
            <span className="se-header-badge">样式管理</span>
            <span className="se-header-name">{editName || '未命名'}</span>
            {isDirty && <span className="se-dirty-dot" title="有未保存的改动" />}
          </div>
        </div>
        <div className="se-header-actions">
          {isBuiltin ? (
            <button className="se-btn se-btn-secondary" onClick={handleClone}>
              <Copy size={14} />
              克隆此模板
            </button>
          ) : (
            <>
              <button className="se-btn se-btn-danger" onClick={handleDelete}>
                <Trash2 size={14} />
                删除
              </button>
              <button
                className={`se-btn se-btn-primary ${saved ? 'success' : ''}`}
                onClick={handleSave}
                disabled={!isDirty && !saved}
              >
                {saved ? <Check size={14} /> : <Save size={14} />}
                {saved ? '已保存' : '保存'}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="se-body">
        {/* ── 左侧模板列表 ── */}
        <aside className="se-sidebar" style={{ width: sidebarWidth }}>
          <div className="se-sidebar-section">
            <p className="se-section-label">内置模板</p>
            {builtinList.map(t => (
              <button
                key={t.id}
                className={`se-tmpl-item ${selectedId === t.id ? 'active' : ''}`}
                onClick={() => setSelectedId(t.id)}
              >
                <span className="se-tmpl-dot" style={{ background: t.accentColor }} />
                <div className="se-tmpl-info">
                  <span className="se-tmpl-name">{t.name}</span>
                  <span className="se-tmpl-desc">{t.desc}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="se-sidebar-section">
            <div className="se-section-row">
              <p className="se-section-label">我的模板</p>
              <button className="se-new-btn" onClick={handleNewTemplate} title="新建模板">
                <Plus size={13} />
                新建
              </button>
            </div>
            {customList.length === 0 && (
              <p className="se-no-custom">克隆内置模板或新建开始</p>
            )}
            {customList.map(t => (
              <button
                key={t.id}
                className={`se-tmpl-item ${selectedId === t.id ? 'active' : ''}`}
                onClick={() => setSelectedId(t.id)}
              >
                <span className="se-tmpl-dot" style={{ background: t.accentColor }} />
                <div className="se-tmpl-info">
                  <span className="se-tmpl-name">{t.name}</span>
                  <span className="se-tmpl-desc">{t.desc || '自定义模板'}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* 左侧拖拽手柄 */}
        <div
          className="se-resizer"
          ref={sidebarResizerRef}
          onMouseDown={handleSidebarResizerDown}
          title="拖拽调整宽度"
        />

        {/* ── 中间编辑器 ── */}
        <div className="se-editor-pane">
          {/* 元数据 */}
          <div className="se-meta-bar">
            <div className="se-meta-field">
              <label className="se-meta-label">模板名称</label>
              <input
                className="se-meta-input"
                value={editName}
                onChange={e => { setEditName(e.target.value); setIsDirty(true) }}
                placeholder="模板名称"
                disabled={isBuiltin}
              />
            </div>
            <div className="se-meta-field">
              <label className="se-meta-label">描述</label>
              <input
                className="se-meta-input"
                value={editDesc}
                onChange={e => { setEditDesc(e.target.value); setIsDirty(true) }}
                placeholder="一句话描述风格"
                disabled={isBuiltin}
              />
            </div>
            <div className="se-meta-field se-meta-field-color">
              <label className="se-meta-label">主题色</label>
              <div className="se-color-wrap">
                <input
                  type="color"
                  className="se-color-picker"
                  value={editColor}
                  onChange={e => { setEditColor(e.target.value); setIsDirty(true) }}
                  disabled={isBuiltin}
                />
                <span className="se-color-hex">{editColor}</span>
              </div>
            </div>
            {isBuiltin && (
              <div className="se-builtin-notice">
                内置模板只读，点「克隆此模板」可在副本上自由编辑
              </div>
            )}
          </div>

          {/* ── AI 样式生成面板 ── */}
          <div className={`se-ai-panel ${aiPanelOpen ? 'open' : ''}`}>
            <button
              className="se-ai-toggle"
              onClick={() => setAiPanelOpen(v => !v)}
            >
              <Wand2 size={14} />
              <span>AI 生成样式</span>
              <span className="se-ai-toggle-badge">Beta</span>
              <span className="se-ai-toggle-chevron">
                {aiPanelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </span>
            </button>

            {aiPanelOpen && (
              <div className="se-ai-body">
                <p className="se-ai-desc">
                  描述你想要的样式风格，AI 自动生成配套 CSS。生成后可预览、确认后替换当前 CSS。
                </p>

                {/* 快捷标签 */}
                <div className="se-ai-tags">
                  {[
                    '简约白底，蓝色点缀',
                    '暗色科技感，霓虹绿',
                    '小清新，粉绿配色',
                    '商务正式，深蓝灰',
                    '温暖阅读感，橘色标题',
                    '极简黑白，大字号',
                  ].map(tag => (
                    <button
                      key={tag}
                      className="se-ai-tag"
                      onClick={() => setAiPrompt(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>

                <textarea
                  className="se-ai-input"
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder="例如：深色背景，主题色用紫色，标题加粗且有下划线装饰，blockquote 用左边框+浅紫背景，代码块深灰背景白色字..."
                  rows={3}
                />

                <div className="se-ai-actions">
                  <button
                    className="se-ai-btn-generate"
                    onClick={handleAIGenerate}
                    disabled={aiGenerating || !aiPrompt.trim()}
                  >
                    {aiGenerating
                      ? <><Loader2 size={14} className="se-ai-spin" /> 生成中...</>
                      : <><Wand2 size={14} /> 生成 CSS</>
                    }
                  </button>
                  {aiPreviewCss && (
                    <button
                      className="se-ai-btn-apply"
                      onClick={handleApplyAI}
                    >
                      <Check size={14} />
                      应用到编辑器
                    </button>
                  )}
                </div>

                {/* 预览生成结果 */}
                {aiPreviewCss && (
                  <div className="se-ai-preview-wrap">
                    <div className="se-ai-preview-label">生成结果（点击「应用」替换当前 CSS）</div>
                    <pre className="se-ai-preview-code">{aiPreviewCss}</pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* CSS 编辑器标题 */}
          <div className="se-css-header">
            <span className="se-css-title">CSS 编辑器</span>
            <span className="se-css-hint">
              所有选择器以 <code>#wemd</code> 开头，覆盖 h1–h4 / p / ul / ol / blockquote / code / pre / a / table / hr / img 等全部元素
            </span>
          </div>

          {/* CSS Textarea */}
          <textarea
            ref={cssTextareaRef}
            className="se-css-textarea"
            value={editCss}
            onChange={e => { setEditCss(e.target.value); setIsDirty(true) }}
            onKeyDown={handleCssKeyDown}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            readOnly={isBuiltin}
            placeholder="#wemd { ... }"
          />
        </div>

        {/* 右侧拖拽手柄 */}
        <div
          className="se-resizer"
          ref={previewResizerRef}
          onMouseDown={handlePreviewResizerDown}
          title="拖拽调整宽度"
        />

        {/* ── 右侧实时预览 ── */}
        <div className="se-preview-pane" style={{ width: previewWidth }}>
          <div className="se-preview-header">
            <span className="se-preview-label">实时预览</span>
            <span className="se-preview-sub">所有 Markdown 元素</span>
          </div>
          <div className="se-preview-scroll">
            <div className="se-preview-card">
              <div
                id="wemd"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
