import React, { useState, useRef, useCallback, useEffect } from 'react'
import { toast } from './Toast'
import { Copy, Check, Minus, Plus, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import { loadAllTemplates, TemplateItem } from '../utils/templateStore'
import './WeChatRenderer.css'

interface WeChatRendererProps {
  content: string
  title?: string
}

// ── Markdown ──────────────────────────────────────────────────────────────────

function highlightCode(str: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return `<pre><code class="hljs language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
    } catch { /* ignore */ }
  }
  const esc = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<pre><code class="hljs">${esc}</code></pre>`
}

const md = new MarkdownIt({ html: false, linkify: true, typographer: false, highlight: highlightCode })

function renderMarkdown(content: string): string {
  return content?.trim() ? md.render(content) : ''
}

// ── CSS → Inline Styles（复制到公众号用）────────────────────────────────────

interface ParsedRule {
  selectors: string[]
  props: Record<string, string>
}

function parseCssRules(cssText: string): ParsedRule[] {
  const rules: ParsedRule[] = []
  // 跳过 @media 等 at-rules，只匹配普通规则
  const ruleRe = /([^{@][^{]*)\{([^}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = ruleRe.exec(cssText)) !== null) {
    const selText = m[1].trim()
    const propText = m[2]
    const props: Record<string, string> = {}
    propText.split(';').forEach(p => {
      const ci = p.indexOf(':')
      if (ci > 0) {
        const k = p.slice(0, ci).trim()
        const v = p.slice(ci + 1).trim()
        if (k && v) props[k] = v
      }
    })
    if (!Object.keys(props).length) continue
    const selectors = selText.split(',').map(s => s.trim()).filter(Boolean)
    rules.push({ selectors, props })
  }
  return rules
}

function applyInlineStylesFromCss(html: string, cssText: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<div id="wemd">${html}</div>`, 'text/html')
  const root = doc.getElementById('wemd')
  if (!root) return html

  const rules = parseCssRules(cssText)
  const allEls: Element[] = [root, ...Array.from(root.querySelectorAll('*'))]

  allEls.forEach(el => {
    const styleMap: Record<string, string> = {}

    rules.forEach(({ selectors, props }) => {
      selectors.forEach(rawSel => {
        // 处理根元素 #wemd
        if (rawSel === '#wemd') {
          if (el === root) Object.assign(styleMap, props)
          return
        }
        // 处理 #wemd 后代选择器：#wemd h2 → h2，#wemd > p → p，#wemd blockquote p → blockquote p
        if (!rawSel.startsWith('#wemd')) return
        const childSel = rawSel
          .replace(/^#wemd\s*>\s*/, '')  // 直接子元素
          .replace(/^#wemd\s+/, '')       // 后代
        if (!childSel || el === root) return
        try {
          if (el.matches(childSel)) Object.assign(styleMap, props)
        } catch { /* 忽略无效选择器 */ }
      })
    })

    if (Object.keys(styleMap).length > 0) {
      const existing = el.getAttribute('style') || ''
      const newStyle = Object.entries(styleMap).map(([k, v]) => `${k}: ${v}`).join('; ')
      el.setAttribute('style', existing ? `${existing}; ${newStyle}` : newStyle)
    }
  })

  return root.innerHTML
}

// ── 主组件 ──────────────────────────────────────────────────────────────────

export const WeChatRenderer: React.FC<WeChatRendererProps> = ({ content, title }) => {
  const navigate = useNavigate()

  // 从 store 加载模板，监听跨组件更新
  const [templates, setTemplates] = useState<TemplateItem[]>(() => loadAllTemplates())
  const [templateId, setTemplateId] = useState('default')
  const [editedCss, setEditedCss] = useState(() => loadAllTemplates()[0]?.css ?? '')
  const [fontSize, setFontSize] = useState(16)
  const [copied, setCopied] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

  // 拖拽分栏宽度
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const resizerRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  const handleResizerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = sidebarWidth
    resizerRef.current?.classList.add('dragging')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      const delta = e.clientX - dragStartXRef.current
      const newWidth = Math.min(480, Math.max(180, dragStartWidthRef.current + delta))
      setSidebarWidth(newWidth)
    }

    const onMouseUp = () => {
      isDraggingRef.current = false
      resizerRef.current?.classList.remove('dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [sidebarWidth])

  // 监听 StyleEditor 发出的模板更新事件
  useEffect(() => {
    const sync = () => {
      const all = loadAllTemplates()
      setTemplates(all)
      // 若当前选中模板被删除，切回 default
      const still = all.find(t => t.id === templateId)
      if (still) {
        setEditedCss(still.css)
      } else {
        setTemplateId('default')
        setEditedCss(all[0]?.css ?? '')
      }
    }
    window.addEventListener('wxtemplates-updated', sync)
    return () => window.removeEventListener('wxtemplates-updated', sync)
  }, [templateId])

  const html = renderMarkdown(content)
  const charCount = content?.replace(/\s/g, '').length ?? 0

  // 实时把 CSS 注入到 <head>，驱动预览
  useEffect(() => {
    const id = 'wr-template-style'
    let el = document.getElementById(id) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = id
      document.head.appendChild(el)
    }
    el.textContent = `#wemd { font-size: ${fontSize}px; }\n${editedCss}`
    return () => { if (el) el.textContent = '' }
  }, [editedCss, fontSize])

  const handleSelectTemplate = (t: TemplateItem) => {
    setTemplateId(t.id)
    setEditedCss(t.css)
  }

  const handleCopy = useCallback(async () => {
    if (!previewRef.current) return
    try {
      const inlineHtml = applyInlineStylesFromCss(html, editedCss)
      const wrapperHtml = `<div style="font-size:${fontSize}px;word-break:break-word;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;">${inlineHtml}</div>`

      if (typeof ClipboardItem !== 'undefined') {
        const blob = new Blob([wrapperHtml], { type: 'text/html' })
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })])
      } else {
        const el = previewRef.current
        const sel = window.getSelection()
        if (sel) {
          const range = document.createRange()
          range.selectNodeContents(el)
          sel.removeAllRanges()
          sel.addRange(range)
          document.execCommand('copy')
          sel.removeAllRanges()
        }
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (err) {
      console.error('复制失败', err)
      toast.warn('复制失败，请手动全选 (Ctrl+A) 后复制')
    }
  }, [html, editedCss, fontSize])

  // 空状态
  if (!content?.trim()) {
    return (
      <div className="wr-root">
        <div className="wr-empty">
          <div className="wr-empty-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M8 12h8M8 8h5M8 16h6" />
            </svg>
          </div>
          <p className="wr-empty-title">暂无文章内容</p>
          <p className="wr-empty-desc">在「文章内容」标签页生成或编写文章后，此处自动渲染</p>
        </div>
      </div>
    )
  }

  return (
    <div className="wr-root">
      {/* ── 顶部工具栏 ── */}
      <div className="wr-toolbar">
        <div className="wr-toolbar-left">
          {/* 字号控制 */}
          <div className="wr-fontsize">
            <button className="wr-fontsize-btn" onClick={() => setFontSize(s => Math.max(12, s - 1))} title="减小字号">
              <Minus size={11} />
            </button>
            <span className="wr-fontsize-value">{fontSize}px</span>
            <button className="wr-fontsize-btn" onClick={() => setFontSize(s => Math.min(22, s + 1))} title="增大字号">
              <Plus size={11} />
            </button>
          </div>
          <span className="wr-stat">{charCount.toLocaleString()} 字</span>
        </div>
        <div className="wr-toolbar-right">
          {copied ? (
            <span className="wr-copy-hint wr-copy-hint-success">
              已复制富文本，打开公众号编辑器 → 直接 Ctrl+V 粘贴
            </span>
          ) : (
            <span className="wr-copy-hint">
              点击复制 → 粘贴到公众号编辑器，样式自动带入
            </span>
          )}
          <button className={`wr-copy-btn ${copied ? 'success' : ''}`} onClick={handleCopy}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? '已复制！' : '复制内容'}
          </button>
        </div>
      </div>

      {/* ── 主体：左侧模板 + 拖拽条 + 右侧预览 ── */}
      <div className="wr-main">
        {/* 左侧边栏 */}
        <div className="wr-sidebar" style={{ width: sidebarWidth }}>
          <div className="wr-sidebar-header">
            <p className="wr-sidebar-section-label">样式模板</p>
            <button
              className="wr-manage-styles-btn"
              onClick={() => navigate('/styles')}
              title="管理样式模板"
            >
              <ExternalLink size={12} />
              管理
            </button>
          </div>
          <div className="wr-template-list">
            {templates.map(t => (
              <button
                key={t.id}
                className={`wr-tmpl-item ${templateId === t.id ? 'active' : ''}`}
                onClick={() => handleSelectTemplate(t)}
              >
                <span className="wr-tmpl-dot" style={{ background: t.accentColor }} />
                <div className="wr-tmpl-info">
                  <span className="wr-tmpl-name">{t.name}</span>
                  <span className="wr-tmpl-desc">{t.desc}</span>
                </div>
                {templateId === t.id && <span className="wr-tmpl-check"><Check size={12} /></span>}
              </button>
            ))}
          </div>

          <div className="wr-css-editor-wrap">
            <p className="wr-sidebar-section-label" style={{ marginBottom: 8 }}>
              自定义 CSS
              <span className="wr-css-hint">实时预览</span>
            </p>
            <textarea
              className="wr-css-textarea"
              value={editedCss}
              onChange={e => { setEditedCss(e.target.value); setTemplateId('custom') }}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
        </div>

        {/* 拖拽手柄 */}
        <div
          className="wr-resizer"
          ref={resizerRef}
          onMouseDown={handleResizerMouseDown}
          title="拖拽调整宽度"
        />

        {/* 右侧预览 */}
        <div className="wr-preview">
          <div className="wr-article-card">
            {title && (
              <div className="wr-article-header">
                <span className="wr-article-badge">公众号预览</span>
                <h2 className="wr-article-title">{title}</h2>
              </div>
            )}
            <div
              id="wemd"
              ref={previewRef}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default WeChatRenderer
