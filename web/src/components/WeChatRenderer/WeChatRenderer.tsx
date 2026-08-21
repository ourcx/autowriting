import React, { useState, useRef, useCallback, useEffect } from 'react'
import { toast } from '../Toast/Toast'
import { Copy, Check, Minus, Plus, ExternalLink, Send, Loader2, Image as ImageIcon, Settings, Palette, Sparkles, Wand2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import { fetchAllTemplates, BUILTIN_TEMPLATES, TemplateItem } from '../../utils/templateStore'
import { DEFAULT_WECHAT_TEMPLATE_ID } from '../../../shared/defaultStyleTemplates'
import { ImageLibrary } from '../ImageLibrary/ImageLibrary'
import { generateXiaohongshuArticleMetadata, publishXiaohongshuNote } from '../../utils/apiHelpers'
import { hasXiaohongshuCookies, loadXiaohongshuCookies } from '../../utils/accountBindings'
import { loadAIConfig } from '../../utils/aiConfig'
import './WeChatRenderer.css'

type PlatformMode = 'wechat' | 'toutiao' | 'xiaohongshu'

interface WeChatRendererProps {
  content: string
  title?: string
  articleId?: string
  platformMode?: PlatformMode
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

// ── 复制到公众号：getComputedStyle 内联所有样式（等价于 juice，无需额外依赖）──

/**
 * WeMD 用 juice 把 CSS 文本内联到每个元素 style 属性。
 * 我们没有 juice，但浏览器渲染后可以用 getComputedStyle 读出计算值，
 * 手动写回 style 属性——效果完全等价，且兼容 CSS 变量、继承、权重。
 */

// 需要内联的关键属性列表（微信编辑器会识别这些）
// 注意：不内联 width / max-width ——这两个值是相对于隐藏容器（677px）算出的固定像素，
// 粘到微信编辑器（~600px）后会导致子元素溢出、margin 失效。
const INLINE_PROPS = [
  'color', 'background-color',
  'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-decoration',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-top-style', 'border-top-color',
  'border-left-width', 'border-left-style', 'border-left-color',
  'border-radius',
  'display',
] as const

// 常见默认值集合，命中则跳过内联（减少 HTML 体积）
const DEFAULT_VALUES = new Set([
  'rgba(0, 0, 0, 0)',   // transparent
  'normal',             // font-weight / font-style / line-height / letter-spacing
  'none',               // text-decoration / display:none 排除
  '0px',                // margin / padding / border-width
  'medium',             // border-width 默认
  'currentcolor',       // border-color 默认
  'auto',               // margin auto
  'visible',            // overflow
  'nowrap',             // white-space（仅当与父级一致时跳过）
  'initial',
  'inherit',
  'start',              // text-align start = left in LTR，微信默认
])

function inlineComputedStyles(root: HTMLElement): void {
  const all = [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[]
  all.forEach(el => {
    const computed = window.getComputedStyle(el)
    const parts: string[] = []
    INLINE_PROPS.forEach(prop => {
      const val = computed.getPropertyValue(prop)?.trim()
      if (!val) return
      if (DEFAULT_VALUES.has(val)) return
      // 跳过透明背景
      if (prop === 'background-color' && val === 'rgba(0, 0, 0, 0)') return
      // border-style 为 none 时跳过 border-width/color
      if (
        (prop === 'border-top-width' || prop === 'border-left-width') &&
        val === '0px'
      ) return
      parts.push(`${prop}:${val}`)
    })
    if (parts.length) el.setAttribute('style', parts.join(';'))
  })
}

/** 调试用：把 container innerHTML 输出到控制台，确认内联样式是否正确 */
function debugPrintHtml(container: HTMLElement) {
  const snippet = container.innerHTML.slice(0, 2000)
  console.group('[WeChatRenderer] clipboard HTML preview')
  console.log(snippet)
  console.groupEnd()
}

/**
 * 构建内联样式的 HTML 字符串，用于推送到微信草稿箱。
 * 微信草稿箱内容不支持 <style> 标签，必须把样式内联到每个元素。
 */
function buildInlinedHtml(innerHtml: string, css: string, fontSize: number): string {
  const COPY_ID = `wemd-draft-${Date.now()}`
  const scopedCss = css.replace(/#wemd\b/g, `#${COPY_ID}`)

  const container = document.createElement('div')
  container.style.cssText = [
    'position:fixed', 'top:0', 'left:0',
    'width:677px', 'opacity:0', 'pointer-events:none',
    'z-index:-9999', 'color-scheme:light', 'background:#ffffff',
    `font-size:${fontSize}px`,
    "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif",
  ].join(';')

  container.innerHTML = `<style>${scopedCss}</style><section id="${COPY_ID}">${innerHtml}</section>`
  document.body.appendChild(container)

  try {
    const section = container.querySelector(`#${COPY_ID}`) as HTMLElement | null
    if (!section) return innerHtml   // fallback：原始 html

    inlineComputedStyles(section)

    // 移除 <style>
    container.querySelector('style')?.remove()

    return section.outerHTML
  } finally {
    document.body.removeChild(container)
  }
}

function copyHtmlViaExecCommand(
  innerHtml: string,
  css: string,
  fontSize: number,
): boolean {
  const COPY_ID = `wemd-copy-${Date.now()}`
  const scopedCss = css.replace(/#wemd\b/g, `#${COPY_ID}`)

  const container = document.createElement('div')
  container.style.cssText = [
    'position:fixed', 'top:0', 'left:0',
    'width:677px', 'opacity:0', 'pointer-events:none',
    'z-index:-9999', 'color-scheme:light', 'background:#ffffff',
    `font-size:${fontSize}px`,
    "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif",
  ].join(';')

  container.innerHTML = `<style>${scopedCss}</style><section id="${COPY_ID}">${innerHtml}</section>`
  document.body.appendChild(container)

  try {
    const section = container.querySelector(`#${COPY_ID}`) as HTMLElement | null
    if (!section) return false

    // 1. 把所有计算后样式内联到每个元素 style 属性（等价于 juice）
    inlineComputedStyles(section)

    // 2. section 根元素：白底 + 清掉左右 padding
    //    模板 CSS 的 padding（如 24px）已被 getComputedStyle 内联进来，
    //    但我们用子元素 margin 来实现左右缩进，所以 section 本身不需要左右 padding，
    //    否则 padding + 子 margin 叠加会让缩进翻倍。
    section.style.setProperty('background-color', '#ffffff')
    section.style.setProperty('padding-left', '0px')
    section.style.setProperty('padding-right', '0px')

    // 3. 给每个直接子块加 margin-left/right，等同于容器左右 padding 60px。
    //    用子元素 margin 而非容器 padding 的原因：
    //    微信编辑器在粘贴时会清洗外层 <section> 的 padding，但会保留块级元素自身的 margin。
    const SIDE = '32px'
      ; (Array.from(section.children) as HTMLElement[]).forEach(child => {
        child.style.setProperty('margin-left', SIDE)
        child.style.setProperty('margin-right', SIDE)
      })

    // 4. 移除 <style> 标签（样式已内联，不需要再带进剪贴板）
    container.querySelector('style')?.remove()

    // 调试：确认第一个直接子元素的 margin-left 是否生效
    debugPrintHtml(container)

    // 5. selectNodeContents(container)：container 里现在只有 section，
    //    所以 section 元素本身（含所有 style 属性）会进入剪贴板
    const sel = window.getSelection()
    if (!sel) return false
    const range = document.createRange()
    range.selectNodeContents(container)
    sel.removeAllRanges()
    sel.addRange(range)
    const ok = document.execCommand('copy')
    sel.removeAllRanges()
    return ok
  } finally {
    document.body.removeChild(container)
  }
}

// ── 主组件 ──────────────────────────────────────────────────────────────────

// ── 今日头条 Cookie 工具函数 ──────────────────────────────────────────────────
const TT_COOKIE_KEY = 'toutiao_cookies'
const XIAOHONGSHU_TEMPLATES = ['简约基础', '清晰明朗', '黑白极简', '优雅几何', '平实叙事', '逻辑结构', '理性现代', '线条复古', '拼接色块', '杂志先锋', '交叉拓扑', '灵感备忘', '手帐书写', '札记集尘', '素雅底纹', '文艺清新', '黄昏手稿', '涂鸦马克', '大图纯享', '轻感明快']

function getTtCookies(): string {
  return localStorage.getItem(TT_COOKIE_KEY) ?? ''
}
function saveTtCookies(raw: string) {
  localStorage.setItem(TT_COOKIE_KEY, raw)
}
function hasTtCookies(): boolean {
  const raw = getTtCookies().trim()
  if (!raw) return false
  try { const arr = JSON.parse(raw); return Array.isArray(arr) && arr.length > 0 } catch { return false }
}

// ── 从 localStorage 读取公众号凭据 ────────────────────────────────────────────
const WX_STORAGE_KEY = 'wechat_credentials'
function getWxHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem(WX_STORAGE_KEY)
    if (!raw) return {}
    const { appId, appSecret } = JSON.parse(raw)
    if (!appId || !appSecret) return {}
    return { 'X-Wx-AppId': appId, 'X-Wx-AppSecret': appSecret }
  } catch { return {} }
}
function hasWxCreds(): boolean {
  try {
    const raw = localStorage.getItem(WX_STORAGE_KEY)
    if (!raw) return false
    const { appId, appSecret } = JSON.parse(raw)
    return !!(appId && appSecret)
  } catch { return false }
}

export const WeChatRenderer: React.FC<WeChatRendererProps> = ({ content, title, articleId, platformMode = 'wechat' }) => {
  const navigate = useNavigate()

  // 从服务端加载模板，初始用内置副本保证无白屏
  const [templates, setTemplates] = useState<TemplateItem[]>(BUILTIN_TEMPLATES)
  const [templateId, setTemplateId] = useState(DEFAULT_WECHAT_TEMPLATE_ID)
  const [editedCss, setEditedCss] = useState(() => BUILTIN_TEMPLATES[0]?.css ?? '')
  const [fontSize, setFontSize] = useState(16)
  const [copied, setCopied] = useState(false)
  const [ttCopied, setTtCopied] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

  // 推送草稿状态（公众号）
  const [wxBound, setWxBound] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushDone, setPushDone] = useState(false)

  // 今日头条：Cookie 配置弹窗 + 自动推送状态
  const [showTtCookieModal, setShowTtCookieModal] = useState(false)
  const [ttCookieDraft, setTtCookieDraft] = useState('')
  const [ttCookieBound, setTtCookieBound] = useState(false)
  const [ttPushing, setTtPushing] = useState(false)
  const [ttPushDone, setTtPushDone] = useState(false)
  // 小红书长文：会话与平台侧卡片配置
  const [xhsBound, setXhsBound] = useState(false)
  const [xhsPushing, setXhsPushing] = useState(false)
  const [xhsGenerating, setXhsGenerating] = useState(false)
  const [xhsPushDone, setXhsPushDone] = useState(false)
  const [xhsSummary, setXhsSummary] = useState('')
  const [xhsFinalTitle, setXhsFinalTitle] = useState(title ?? '')
  const [xhsTopics, setXhsTopics] = useState<string[]>([])
  const [xhsTemplateName, setXhsTemplateName] = useState(XIAOHONGSHU_TEMPLATES[0])
  const [xhsCoverType, setXhsCoverType] = useState<'with_image' | 'without_image'>('with_image')
  const [xhsShowAuthor, setXhsShowAuthor] = useState(true)
  const [xhsShowReadingTime, setXhsShowReadingTime] = useState(false)
  const [xhsShowSummary, setXhsShowSummary] = useState(true)
  // 今日头条：Chromium 安装状态 + 日志面板
  const [chromiumStatus, setChromiumStatus] = useState<'checking' | 'ready' | 'installing' | 'failed'>('checking')
  const [chromiumMsg, setChromiumMsg] = useState('正在检测浏览器环境...')
  const [showInstallLogs, setShowInstallLogs] = useState(false)
  const [installLogs, setInstallLogs] = useState<string[]>([])

  // 图片库选择器状态
  const [showImageLibrary, setShowImageLibrary] = useState(false)
  // 初始化时从 localStorage 读取封面（CoverGenerator 粘贴/生成后会写入）
  const [selectedCoverImage, setSelectedCoverImage] = useState<{ id: string; imageUrl: string } | null>(() => {
    if (!articleId) return null
    try {
      const saved = localStorage.getItem(`cover_image_${articleId}`)
      if (saved) return { id: 'pasted', imageUrl: saved }
    } catch { /* ignore */ }
    return null
  })

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

  // 首次挂载：从 localStorage 检查公众号凭据 + 头条 Cookie 是否存在
  useEffect(() => {
    setWxBound(hasWxCreds())
    setTtCookieBound(hasTtCookies())
    setXhsBound(hasXiaohongshuCookies())
  }, [])

  useEffect(() => {
    if (!xhsFinalTitle) setXhsFinalTitle(title ?? '')
  }, [title, xhsFinalTitle])

  useEffect(() => {
    fetchAllTemplates().then(all => {
      setTemplates(all)
      const defaultTemplate = all.find(t => t.id === DEFAULT_WECHAT_TEMPLATE_ID) ?? all[0]
      if (defaultTemplate) {
        setTemplateId(defaultTemplate.id)
        setEditedCss(defaultTemplate.css)
      }
    }).catch(() => { })
  }, [])

  // 监听 StyleEditor 发出的模板更新事件
  useEffect(() => {
    const sync = () => {
      fetchAllTemplates().then(all => {
        setTemplates(all)
        const still = all.find(t => t.id === templateId)
        if (still) {
          setEditedCss(still.css)
        } else {
          const defaultTemplate = all.find(t => t.id === DEFAULT_WECHAT_TEMPLATE_ID) ?? all[0]
          setTemplateId(defaultTemplate?.id ?? DEFAULT_WECHAT_TEMPLATE_ID)
          setEditedCss(defaultTemplate?.css ?? '')
        }
      }).catch(() => { })
    }
    window.addEventListener('wxtemplates-updated', sync)
    return () => window.removeEventListener('wxtemplates-updated', sync)
  }, [templateId])

  const html = renderMarkdown(content)
  const charCount = content?.replace(/\s/g, '').length ?? 0

  // 今日头条：轮询 Chromium 安装状态，直到 ready 或 failed
  useEffect(() => {
    if (platformMode !== 'toutiao') return
    let timer: ReturnType<typeof setInterval> | undefined // eslint-disable-line prefer-const
    const authHeader = { 'Authorization': `Bearer ${localStorage.getItem('auth_token') ?? ''}` }

    const poll = async () => {
      try {
        const r = await fetch('/api/toutiao/status', { headers: authHeader })
        const d = await r.json()
        setChromiumStatus(d.status ?? 'failed')
        setChromiumMsg(d.message ?? '')
        if (d.status === 'ready' || d.status === 'failed') {
          clearInterval(timer)
        }
      } catch {
        // 网络错误忽略，继续轮询
      }
    }

    const fetchLogs = async () => {
      try {
        const r = await fetch('/api/toutiao/install-logs', { headers: authHeader })
        const d = await r.json()
        if (d.lines?.length) setInstallLogs(d.lines)
      } catch { /* 忽略 */ }
    }

    poll()
    fetchLogs()
    timer = setInterval(() => { poll(); fetchLogs() }, 5000)
    return () => clearInterval(timer)
  }, [platformMode])

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

  const handleCopy = useCallback(() => {
    // padding 和 background 已经在 copyHtmlViaExecCommand 内部用 inline style 直接设置
    const ok = copyHtmlViaExecCommand(html, editedCss, fontSize)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } else {
      toast.warn('复制失败，请手动全选 (Ctrl+A) 后复制')
    }
  }, [html, editedCss, fontSize])

  // 今日头条：复制原始 Markdown
  const handleCopyMarkdown = useCallback(async () => {
    if (!content?.trim()) return

    // 用 markdown-it 把 Markdown 转成 HTML，粘贴到头条编辑器时会识别为富文本
    const mdRenderer = new MarkdownIt({ html: false, breaks: true, linkify: true })
    const htmlContent = mdRenderer.render(content)

    try {
      // 同时写入 text/html 和 text/plain
      // 头条 ProseMirror 编辑器粘贴时会优先使用 text/html
      const clipItem = new ClipboardItem({
        'text/html': new Blob([htmlContent], { type: 'text/html' }),
        'text/plain': new Blob([content], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([clipItem])
      setTtCopied(true)
      setTimeout(() => setTtCopied(false), 2500)
      toast.success('已复制富文本，打开今日头条编辑器 → 直接 Ctrl+V 粘贴')
    } catch {
      // 降级：只复制纯文本（部分浏览器不支持 ClipboardItem）
      try {
        await navigator.clipboard.writeText(content)
      } catch {
        const ta = document.createElement('textarea')
        ta.value = content
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setTtCopied(true)
      setTimeout(() => setTtCopied(false), 2500)
      toast.success('已复制（纯文本模式），粘贴后格式可能需要手动调整')
    }
  }, [content])

  // 今日头条：保存 Cookie 配置
  const handleSaveTtCookie = useCallback(() => {
    const raw = ttCookieDraft.trim()
    if (!raw) {
      toast.warn('Cookie 不能为空')
      return
    }
    try {
      const arr = JSON.parse(raw)
      if (!Array.isArray(arr) || arr.length === 0) {
        toast.warn('Cookie 格式不正确，需要是 JSON 数组格式')
        return
      }
      saveTtCookies(raw)
      setTtCookieBound(true)
      setShowTtCookieModal(false)
      toast.success(`已保存 ${arr.length} 个 Cookie`)
    } catch {
      toast.warn('Cookie 格式不正确，请粘贴从浏览器导出的 JSON 数组')
    }
  }, [ttCookieDraft])

  // 今日头条：自动推送
  const handleTtPublish = useCallback(async () => {
    if (!ttCookieBound) {
      toast.warn('请先配置今日头条 Cookie')
      setShowTtCookieModal(true)
      return
    }
    if (!title?.trim()) {
      toast.warn('文章标题不能为空')
      return
    }
    if (title.trim().length > 30) {
      toast.warn('今日头条标题不能超过 30 个字，请先修改标题')
      return
    }
    if (!content?.trim()) {
      toast.warn('文章内容不能为空')
      return
    }
    setTtPushing(true)
    try {
      // Cookie 放 body 而非 Header，避免 Header 超长导致 fetch 报错
      const cookiesJson = getTtCookies()
      const r = await fetch('/api/toutiao/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') ?? ''}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          content,
          cookies: cookiesJson,
          coverImageUrl: selectedCoverImage?.imageUrl ?? null,
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        if (r.status === 401 && d.error?.includes('Cookie')) {
          toast.error('Cookie 已失效，请重新配置', {
            duration: 0,
            action: { label: '重新配置', onClick: () => setShowTtCookieModal(true) },
          })
        } else {
          toast.error(d.error ?? '推送失败')
        }
        return
      }
      setTtPushDone(true)
      toast.success(d.message ?? '文章已发布到今日头条！', {
        duration: 0,
        action: { label: '去头条号', onClick: () => window.open('https://mp.toutiao.com/profile_v4/graphic/articles', '_blank') },
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '推送失败，请检查网络')
    } finally {
      setTtPushing(false)
    }
  }, [ttCookieBound, title, content])

  const handleXhsPublish = useCallback(async () => {
    if (!xhsBound) {
      toast.warn('请先在用户页绑定小红书账号', {
        action: { label: '去绑定', onClick: () => navigate('/account') },
      })
      return
    }
    if (!title?.trim() || title.trim().length < 2) {
      toast.warn('小红书长文标题至少需要 2 个字')
      return
    }
    if (!content?.trim()) {
      toast.warn('文章内容为空，无法发布小红书长文')
      return
    }

    setXhsPushing(true)
    try {
      const result = await publishXiaohongshuNote({
        cookies: loadXiaohongshuCookies(),
        contentType: 'article',
        title: title.trim(),
        content,
        imageUrls: [],
        articleOptions: {
          summary: xhsSummary.trim(),
          templateName: xhsTemplateName,
          coverType: xhsCoverType,
          showAuthor: xhsShowAuthor,
          showReadingTime: xhsShowReadingTime,
          showSummary: xhsShowSummary,
          finalTitle: xhsFinalTitle.trim(),
          topics: xhsTopics,
          original: true,
        },
      })
      setXhsPushDone(true)
      const noteUrl = result.noteUrl
      toast.success('文章已同步到小红书长文并完成发布', {
        duration: 0,
        action: noteUrl ? { label: '打开发布页', onClick: () => window.open(noteUrl, '_blank') } : undefined,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '小红书长文发布失败')
    } finally {
      setXhsPushing(false)
    }
  }, [
    content, navigate, title, xhsBound, xhsCoverType, xhsFinalTitle, xhsShowAuthor,
    xhsShowReadingTime, xhsShowSummary, xhsSummary, xhsTemplateName, xhsTopics,
  ])

  const handleXhsGenerateMetadata = useCallback(async () => {
    if (!title?.trim() || !content?.trim()) {
      toast.warn('标题或正文为空，无法生成小红书发布信息')
      return
    }
    setXhsGenerating(true)
    try {
      const metadata = await generateXiaohongshuArticleMetadata({
        title: title.trim(),
        content,
        aiConfig: loadAIConfig(),
      })
      setXhsFinalTitle(metadata.title)
      setXhsSummary(metadata.summary)
      setXhsTopics(metadata.topics)
      toast.success('已生成发布标题、摘要和话题，可确认后发布')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI 生成发布信息失败')
    } finally {
      setXhsGenerating(false)
    }
  }, [content, title])

  // 从 HTML 字符串提取第一张图片的 src
  function extractFirstImageSrc(htmlStr: string): string | null {
    const match = htmlStr.match(/<img[^>]+src=["']([^"']+)["']/i)
    return match ? match[1] : null
  }

  // 推送草稿到公众号草稿箱
  const handlePushDraft = useCallback(async () => {
    if (!wxBound) {
      //没有绑定公众号要提示绑定
      toast.warn('请先绑定公众号', {
        duration: 2500,
        action: {
          label: '去绑定',
          onClick: () => navigate('/account'),
        },
      })
    }
    if (!title?.trim() || !html?.trim()) {
      toast.warn('标题或内容为空，无法推送草稿')
      return
    }
    setPushing(true)
    try {
      // 用内联样式版本作为草稿内容（微信支持 HTML，但不支持 <style>，需内联）
      const inlinedHtml = buildInlinedHtml(html, editedCss, fontSize)
      const digest = content?.replace(/\s+/g, ' ').slice(0, 120) ?? ''

      // 简单估算 UTF-8 字节数（中文 3 字节，ASCII 1 字节）
      const byteLen = new Blob([inlinedHtml]).size
      if (byteLen > 600_000) {
        toast.warn(`内联样式后 HTML 约 ${Math.round(byteLen / 1024)}KB，可能超出微信限制，仍尝试推送…`)
      }

      // 优先使用用户从图片库选择的封面，其次尝试提取文章内容中的第一张图片
      let thumb_media_id: string | undefined
      let coverImageUrl: string | undefined

      if (selectedCoverImage) {
        // 使用用户选择的图片库图片
        coverImageUrl = selectedCoverImage.imageUrl
      } else {
        // 尝试从文章内容中提取第一张图片
        const firstImgSrc = extractFirstImageSrc(html)
        if (firstImgSrc) {
          coverImageUrl = firstImgSrc
        }
      }

      if (coverImageUrl) {
        try {
          const upR = await fetch('/api/wechat/upload-thumb', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getWxHeaders() },
            body: JSON.stringify({ url: coverImageUrl }),
          })
          const upD = await upR.json()
          if (upR.ok && upD.media_id) {
            thumb_media_id = upD.media_id
          } else {
            // 封面上传失败时给 warn，但继续尝试推送（不中断）
            toast.warn(`封面图上传失败，将尝试无封面推送：${upD.error ?? ''}`)
          }
        } catch {
          toast.warn('封面图上传出错，将尝试无封面推送')
        }
      }

      const r = await fetch('/api/wechat/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getWxHeaders() },
        body: JSON.stringify({ title: title.trim(), content: inlinedHtml, digest, thumb_media_id }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d.error ?? '推送失败')
        return
      }
      setPushDone(true)
      if (Array.isArray(d.failed_images) && d.failed_images.length > 0) {
        toast.warn(`有 ${d.failed_images.length} 张正文图片未能转存到微信，发布后可能仍不显示`, { duration: 5000 })
      } else if ((d.rewritten_images ?? 0) > 0) {
        toast.success(`正文图片已同步到微信，共处理 ${d.rewritten_images} 张`, { duration: 2500 })
      }
      // 推送成功后显示带跳转链接的提示
      toast.success('草稿已推送到微信！点击前往公众平台发布', {
        duration: 0, // 不自动消失
        action: {
          label: '去发布',
          onClick: () => window.open('https://mp.weixin.qq.com', '_blank'),
        },
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '推送失败')
    } finally {
      setPushing(false)
    }
  }, [html, editedCss, fontSize, title, content, selectedCoverImage])

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
      {/* ── 公众号模式 ── */}
      {platformMode === 'wechat' && (
        <>
          {/* 顶部工具栏 */}
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

              {/* 选择封面图片按钮 */}
              <button
                className={`wr-cover-btn ${selectedCoverImage ? 'selected' : ''}`}
                onClick={() => setShowImageLibrary(!showImageLibrary)}
                title="从图片库选择推文封面"
              >
                <ImageIcon size={15} />
                {selectedCoverImage ? '已选封面' : '选择封面'}
              </button>

              <button
                className={`wr-push-btn ${pushDone ? 'success' : ''}`}
                onClick={handlePushDraft}
                disabled={pushing || pushDone}
                title="将文章以 HTML 格式推送到公众号草稿箱"
              >
                {pushing
                  ? <Loader2 size={15} className="wr-spin" />
                  : pushDone
                    ? <Check size={15} />
                    : <Send size={15} />
                }
                {pushing ? '推送中...' : pushDone ? '已推送！' : '推送草稿'}
              </button>
            </div>
          </div>

          {/* 图片库选择器（浮层） */}
          {showImageLibrary && (
            <div className="wr-image-library-modal">
              <div className="wr-image-library-overlay" onClick={() => setShowImageLibrary(false)} />
              <div className="wr-image-library-panel">
                <div className="wr-image-library-header">
                  <h3>选择推文封面</h3>
                  <button
                    className="wr-image-library-close"
                    onClick={() => setShowImageLibrary(false)}
                    title="关闭"
                  >
                    ✕
                  </button>
                </div>
                <div className="wr-image-library-content">
                  <ImageLibrary
                    onImageSelect={(image) => {
                      setSelectedCoverImage({ id: image.id, imageUrl: image.imageUrl })
                      setShowImageLibrary(false)
                      toast.success('已选择封面图片')
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* 主体：左侧模板 + 拖拽条 + 右侧预览 */}
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
                      <span className="wr-tmpl-name">
                        {t.name}
                        {t.id === DEFAULT_WECHAT_TEMPLATE_ID && <span className="wr-default-badge">默认</span>}
                      </span>
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
        </>
      )}

      {/* ── 今日头条模式 ── */}
      {platformMode === 'toutiao' && (
        <>
          {/* Cookie 配置弹窗 */}
          {showTtCookieModal && (
            <div className="wr-image-library-modal">
              <div className="wr-image-library-overlay" onClick={() => setShowTtCookieModal(false)} />
              <div className="wr-tt-cookie-panel">
                <div className="wr-image-library-header">
                  <h3>配置今日头条 Cookie</h3>
                  <button className="wr-image-library-close" onClick={() => setShowTtCookieModal(false)}>✕</button>
                </div>
                <div className="wr-tt-cookie-body">
                  <div className="wr-tt-cookie-guide">
                    <p className="wr-tt-cookie-guide-title">如何获取 Cookie？</p>
                    <ol>
                      <li>在浏览器中登录 <a href="https://mp.toutiao.com" target="_blank" rel="noopener noreferrer">mp.toutiao.com</a></li>
                      <li>安装浏览器插件 <strong>EditThisCookie</strong> 或 <strong>Cookie-Editor</strong></li>
                      <li>在头条后台页面点击插件图标 → 选择「导出」→ 复制 JSON</li>
                      <li>将 JSON 粘贴到下方文本框</li>
                    </ol>
                  </div>
                  <textarea
                    className="wr-tt-cookie-textarea"
                    placeholder={'粘贴 Cookie JSON 数组，格式如：\n[{"name":"sessionid","value":"xxx","domain":".toutiao.com",...}]'}
                    value={ttCookieDraft}
                    onChange={e => setTtCookieDraft(e.target.value)}
                    spellCheck={false}
                  />
                  <div className="wr-tt-cookie-actions">
                    {ttCookieBound && (
                      <button
                        className="wr-tt-cookie-clear"
                        onClick={() => {
                          localStorage.removeItem(TT_COOKIE_KEY)
                          setTtCookieBound(false)
                          setTtCookieDraft('')
                          setTtPushDone(false)
                          toast.success('Cookie 已清除')
                          setShowTtCookieModal(false)
                        }}
                      >
                        清除已保存的 Cookie
                      </button>
                    )}
                    <button className="wr-tt-cookie-save" onClick={handleSaveTtCookie}>
                      <Check size={14} />
                      保存 Cookie
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 安装日志面板（浮层） */}
          {showInstallLogs && (
            <div className="wr-image-library-modal">
              <div className="wr-image-library-overlay" onClick={() => setShowInstallLogs(false)} />
              <div className="wr-install-log-panel">
                <div className="wr-image-library-header">
                  <h3>Chromium 安装日志</h3>
                  <button className="wr-image-library-close" onClick={() => setShowInstallLogs(false)}>✕</button>
                </div>
                <div className={`wr-install-log-status wr-chromium-status--${chromiumStatus}`}>
                  {(chromiumStatus === 'checking' || chromiumStatus === 'installing') && <Loader2 size={13} className="wr-spin" />}
                  {chromiumStatus === 'ready' && <Check size={13} />}
                  {chromiumStatus === 'failed' && <span>✕</span>}
                  {chromiumMsg}
                </div>
                <pre className="wr-install-log-pre">
                  {installLogs.length ? installLogs.join('\n') : '暂无日志，等待安装开始...'}
                </pre>
              </div>
            </div>
          )}

          {/* 今日头条工具栏 */}
          <div className="wr-toolbar">
            <div className="wr-toolbar-left">
              <span className="wr-stat">{charCount.toLocaleString()} 字</span>
              {/* Chromium 安装状态指示器 + 查看日志按钮 */}
              <span
                className={`wr-chromium-status wr-chromium-status--${chromiumStatus}`}
                onClick={() => setShowInstallLogs(true)}
                title="点击查看安装日志"
                style={{ cursor: 'pointer' }}
              >
                {chromiumStatus === 'checking' && <Loader2 size={12} className="wr-spin" />}
                {chromiumStatus === 'installing' && <Loader2 size={12} className="wr-spin" />}
                {chromiumStatus === 'ready' && <Check size={12} />}
                {chromiumStatus === 'failed' && <span style={{ fontSize: 12 }}>✕</span>}
                {chromiumMsg}
              </span>
            </div>
            <div className="wr-toolbar-right">
              {ttCopied ? (
                <span className="wr-copy-hint wr-copy-hint-success">
                  已复制富文本，打开头条编辑器 → 直接 Ctrl+V 粘贴
                </span>
              ) : (
                <span className="wr-copy-hint">
                  复制富文本后粘贴到今日头条编辑器，标题/加粗等格式自动保留
                </span>
              )}
              <button
                className={`wr-copy-btn wr-copy-btn--toutiao ${ttCopied ? 'success' : ''}`}
                onClick={handleCopyMarkdown}
              >
                {ttCopied ? <Check size={15} /> : <Copy size={15} />}
                {ttCopied ? '已复制！' : '复制富文本'}
              </button>

              {/* Cookie 配置按钮 */}
              <button
                className={`wr-tt-cookie-btn ${ttCookieBound ? 'bound' : ''}`}
                onClick={() => {
                  setTtCookieDraft(getTtCookies())
                  setShowTtCookieModal(true)
                }}
                title={ttCookieBound ? 'Cookie 已配置，点击修改' : '配置 Cookie 以启用自动推送'}
              >
                <Settings size={14} />
                {ttCookieBound ? 'Cookie 已配置' : '配置 Cookie'}
              </button>

              {/* 存为草稿按钮 */}
              <button
                className={`wr-push-btn wr-push-btn--toutiao ${ttPushDone ? 'success' : ''} ${!ttCookieBound ? 'disabled' : ''}`}
                onClick={handleTtPublish}
                disabled={ttPushing || ttPushDone}
                title={ttCookieBound ? '自动登录头条，将文章存为草稿（需手动添加封面后发布）' : '请先配置 Cookie'}
              >
                {ttPushing
                  ? <Loader2 size={15} className="wr-spin" />
                  : ttPushDone
                    ? <Check size={15} />
                    : <Send size={15} />
                }
                {ttPushing ? '保存中...' : ttPushDone ? '已存草稿！' : '存为草稿'}
              </button>

              <a
                href="https://mp.toutiao.com/profile_v4/graphic/publish"
                target="_blank"
                rel="noopener noreferrer"
                className="wr-tt-open-btn"
              >
                <ExternalLink size={14} />
                打开头条编辑器
              </a>
            </div>
          </div>

          {/* 今日头条预览主体 */}
          <div className="wr-main">
            <div className="wr-tt-preview">
              <div className="wr-tt-card">
                {title && (
                  <div className="wr-tt-header">
                    <span className="wr-tt-badge">今日头条预览</span>
                    <h2 className="wr-tt-title">{title}</h2>
                  </div>
                )}
                <div className="wr-tt-body">
                  <div
                    className="wr-tt-md-render"
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                </div>
                <div className="wr-tt-md-source">
                  <div className="wr-tt-source-label">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="16 18 22 12 16 6"/>
                      <polyline points="8 6 2 12 8 18"/>
                    </svg>
                    原始 Markdown（点击上方按钮复制）
                  </div>
                  <pre className="wr-tt-md-pre">{content}</pre>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── 小红书长文模式 ── */}
      {platformMode === 'xiaohongshu' && (
        <>
          <div className="wr-toolbar wr-xhs-toolbar">
            <div className="wr-xhs-toolbar-context">
              <div className="wr-xhs-toolbar-mark">小</div>
              <div>
                <span>小红书长文</span>
                <small>当前文章已同步 · {charCount.toLocaleString()} 字</small>
              </div>
            </div>
            <div className="wr-xhs-toolbar-actions">
              <span className={`wr-xhs-status ${xhsBound ? 'is-bound' : ''}`}>{xhsBound ? '账号已绑定' : '未绑定账号'}</span>
              <button
                className="wr-xhs-action wr-xhs-action--ai"
                onClick={handleXhsGenerateMetadata}
                disabled={xhsGenerating || xhsPushing}
              >
                {xhsGenerating ? <Loader2 size={15} className="wr-spin" /> : <Wand2 size={15} />}
                {xhsGenerating ? 'AI 生成中...' : 'AI 生成发布信息'}
              </button>
              <button
                className={`wr-xhs-action wr-xhs-action--publish ${xhsPushDone ? 'success' : ''}`}
                onClick={handleXhsPublish}
                disabled={xhsPushing || xhsPushDone}
              >
                {xhsPushing ? <Loader2 size={15} className="wr-spin" /> : xhsPushDone ? <Check size={15} /> : <Send size={15} />}
                {xhsPushing ? '同步发布中...' : xhsPushDone ? '已同步发布！' : '一键发布长文'}
              </button>
              <a
                href="https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
                target="_blank"
                rel="noopener noreferrer"
                className="wr-xhs-action wr-xhs-action--open"
              >
                <ExternalLink size={14} />
                平台预览
              </a>
            </div>
          </div>

          <div className="wr-xhs-main">
            <aside className="wr-xhs-sidebar">
              <div className="wr-xhs-sidebar-header">
                <div>
                  <p>长文发布设置</p>
                  <span>同步当前文章，不修改原文</span>
                </div>
              </div>
              <div className="wr-xhs-settings-card wr-xhs-settings-card--lavender">
                <div className="wr-xhs-settings-title"><Wand2 size={15} /><span>发布信息</span></div>
                <label className="wr-xhs-field">
                  <span>最终发布标题 <em>{Array.from(xhsFinalTitle).length} 字</em></span>
                  <input
                    value={xhsFinalTitle}
                    onChange={event => setXhsFinalTitle(event.target.value)}
                    placeholder="AI 生成后可在此调整"
                  />
                </label>
                <label className="wr-xhs-field">
                  <span>封面摘要 <em>{xhsSummary.length}/60</em></span>
                  <textarea
                    value={xhsSummary}
                    maxLength={60}
                    onChange={event => setXhsSummary(event.target.value)}
                    placeholder="为封面补充一句简短摘要"
                    rows={3}
                  />
                </label>
                <div className="wr-xhs-option-group">
                  <p>发布话题</p>
                  <div className="wr-xhs-topics">
                    {xhsTopics.length ? xhsTopics.map((topic, index) => (
                      <span key={`${topic}-${index}`}>#{topic}<button onClick={() => setXhsTopics(current => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>
                    )) : <small>用 AI 自动生成 3–5 个相关话题</small>}
                  </div>
                </div>
              </div>
              <div className="wr-xhs-settings-card">
                <div className="wr-xhs-settings-title"><Palette size={15} /><span>卡片排版</span></div>
                <section className="wr-xhs-option-group">
                  <p>选择模板</p>
                  <div className="wr-xhs-option-list">
                    {XIAOHONGSHU_TEMPLATES.map(templateName => (
                      <button
                        key={templateName}
                        className={xhsTemplateName === templateName ? 'active' : ''}
                        onClick={() => setXhsTemplateName(templateName)}
                      >
                        {templateName}
                      </button>
                    ))}
                  </div>
                </section>
                <section className="wr-xhs-option-group">
                  <p>封面类型</p>
                  <div className="wr-xhs-option-list">
                    <button className={xhsCoverType === 'with_image' ? 'active' : ''} onClick={() => setXhsCoverType('with_image')}>有图封面</button>
                    <button className={xhsCoverType === 'without_image' ? 'active' : ''} onClick={() => setXhsCoverType('without_image')}>无图封面</button>
                  </div>
                </section>
              </div>
              <div className="wr-xhs-settings-card wr-xhs-settings-card--mint">
                <div className="wr-xhs-settings-title"><Sparkles size={15} /><span>封面信息</span></div>
                <label className="wr-xhs-toggle"><input type="checkbox" checked={xhsShowAuthor} onChange={event => setXhsShowAuthor(event.target.checked)} /> 显示作者</label>
                <label className="wr-xhs-toggle"><input type="checkbox" checked={xhsShowReadingTime} disabled={charCount < 1500} onChange={event => setXhsShowReadingTime(event.target.checked)} /> 显示字数和时长 {charCount < 1500 ? '（满 1500 字可用）' : ''}</label>
                <label className="wr-xhs-toggle"><input type="checkbox" checked={xhsShowSummary} onChange={event => setXhsShowSummary(event.target.checked)} /> 显示摘要</label>
              </div>
              <p className="wr-xhs-note">流程：同步排版到“写长文” → 选择模板与封面 → 等待自动保存 → 进入下一步 → 填入 AI 生成的标题、话题与原创声明 → 发布。地点、可见范围和定时不自动修改。</p>
            </aside>

            <div className="wr-xhs-preview">
              <article className="wr-xhs-card">
                <div className="wr-xhs-card-cover">
                  <span>小红书长文预览</span>
                  <h2>{xhsFinalTitle || title}</h2>
                  {xhsShowSummary && xhsSummary && <p>{xhsSummary}</p>}
                  <footer>{xhsShowAuthor ? '当前账号' : ''}{xhsShowAuthor && xhsShowReadingTime ? ' · ' : ''}{xhsShowReadingTime ? `${charCount.toLocaleString()} 字` : ''}</footer>
                </div>
                <div className="wr-xhs-card-content" dangerouslySetInnerHTML={{ __html: html }} />
              </article>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default WeChatRenderer
