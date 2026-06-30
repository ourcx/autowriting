import { useState, useEffect, useRef } from 'react'
import {
  BarChart3, Clock, FileText, Eye,
  Sparkles, AlertCircle, CheckCircle2,
  ChevronDown, ChevronRight, Circle, Wand2, X,
} from 'lucide-react'
import { loadAIConfig } from '../../utils/aiConfig'
import './ContentStats.css'

interface ContentStatsProps {
  content: string
  title?: string
  articleId?: string
  task?: string
  onArticleChange?: (content: string) => void
}

interface ScoreMap {
  overall: number
  style: number
  structure: number
  actionability: number
  originality: number
}

interface Issue {
  level: 'error' | 'warn' | 'info'
  type: string
  quote: string
  suggestion: string
}

// ── a2ui 风格：动态 UI 块类型定义 ────────────────────────────────────────────

interface UIBlockClicheDiff {
  type: 'cliche-diff'
  title: string
  items: Array<{ original: string; suggestion: string }>
}

interface UIBlockDataSuggestion {
  type: 'data-suggestion'
  title: string
  items: Array<{ claim: string; dataHint: string }>
}

interface UIBlockStructureMap {
  type: 'structure-map'
  title: string
  sections: Array<{ heading: string; status: 'good' | 'warn' | 'error'; note: string }>
}

interface UIBlockLeadRewrite {
  type: 'lead-rewrite'
  title: string
  original: string
  rewritten: string
}

interface UIBlockHighlightQuote {
  type: 'highlight-quote'
  title: string
  quotes: string[]
}

type UIBlock = UIBlockClicheDiff | UIBlockDataSuggestion | UIBlockStructureMap | UIBlockLeadRewrite | UIBlockHighlightQuote

interface AnalysisResult {
  scores: ScoreMap
  wordCount: number
  readingMinutes: number
  strengths: string[]
  issues: Issue[]
  styleMatch: { score: number; note: string }
  topSuggestion: string
  ragCount: number
  uiBlocks?: UIBlock[]
}

// ── AGENTS.md 规范核查（纯本地，即时） ────────────────────────────────────────

// AGENTS.md 中明确列出的禁词，按类别分组（用于精准定位）
const AI_CLICHES: Array<{ word: string; reason: string }> = [
  // 空洞开场白
  { word: '在当今这个',   reason: '空洞开场白，直接切入主题' },
  { word: '随着科技',     reason: '空洞开场白，直接切入主题' },
  { word: '随着人工智能', reason: '空洞开场白，直接切入主题' },
  { word: '大家好，今天', reason: '空洞开场白，直接切入主题' },
  { word: '在这个时代',   reason: '空洞开场白，直接切入主题' },
  { word: '在当下这个',   reason: '空洞开场白，直接切入主题' },
  // 空泛总结
  { word: '总而言之',     reason: '机器人式收尾，改为具体行动建议' },
  { word: '总的来说',     reason: '机器人式收尾，改为具体行动建议' },
  { word: '综上所述',     reason: '机器人式收尾，改为具体行动建议' },
  { word: '希望本文',     reason: '空洞结尾套话，直接结束' },
  { word: '希望这篇',     reason: '空洞结尾套话，直接结束' },
  { word: '让我们一起',   reason: '空洞结尾套话，直接结束' },
  // 陈词滥调
  { word: '打开了新世界', reason: 'AI 套话，用具体描述替代' },
  { word: '不得不说',     reason: 'AI 套话，直接说结论' },
  { word: '不得不提',     reason: 'AI 套话，直接说结论' },
  { word: '值得一提的是', reason: 'AI 套话，直接说结论' },
  { word: '值得注意的是', reason: 'AI 套话，直接说结论' },
  { word: '说实话',       reason: '除非真的在强调对比，否则删除' },
  { word: '老实说',       reason: '除非真的在强调对比，否则删除' },
  // 机器人过渡
  { word: '接下来，让我们', reason: '机器人式过渡，删除或改为自然过渡' },
  { word: '下面我将详细介绍', reason: '机器人式过渡，直接介绍内容' },
  { word: '首先，其次，',  reason: '机械式结构，用逻辑关系自然过渡' },
  // 过度修饰
  { word: '极大地',       reason: '空洞修饰，用数据替代（如「节省了 2 小时」）' },
  { word: '显著地',       reason: '空洞修饰，用数据替代' },
  { word: '大幅度地',     reason: '空洞修饰，用数据替代' },
  { word: '至关重要',     reason: '空洞修饰，说清楚为什么重要' },
  { word: '深刻影响',     reason: '空洞修饰，说清楚怎么影响' },
  { word: '不可忽视',     reason: '空洞修饰，说清楚忽视了什么后果' },
  { word: '非常重要',     reason: '空洞修饰，用数据或具体场景替代' },
]

const WRONG_QUOTES = ['"', '"']  // 应该用「」
const WRONG_DASH   = '--'        // 应该用 ——
const WRONG_ELLIP  = '...'       // 应该用 ……

interface CliqueFound { word: string; reason: string; count: number }

function runChecks(text: string, title?: string) {
  // 统计每个套话出现次数
  const foundCliches: CliqueFound[] = AI_CLICHES
    .map(c => {
      let count = 0
      let pos = 0
      while ((pos = text.indexOf(c.word, pos)) !== -1) { count++; pos++ }
      return { ...c, count }
    })
    .filter(c => c.count > 0)

  const hasWrongQuotes = WRONG_QUOTES.some(q => text.includes(q))
  const hasWrongDash   = text.includes(WRONG_DASH)
  const hasWrongEllip  = text.includes(WRONG_ELLIP)
  const wordCount      = text.replace(/[#*`[\]()]/g, '').trim().length
  const hasData        = /\d+[%万元个人次分钟年月]/.test(text)
  const hasFirstPerson = text.includes('我')
  const hasHeadings    = /^#{1,6}\s/m.test(text)
  const titleLen       = (title || '').replace(/^#+\s*/, '').length

  return {
    foundCliches,
    hasWrongQuotes,
    hasWrongDash,
    hasWrongEllip,
    wordCount,
    hasData,
    hasFirstPerson,
    hasHeadings,
    titleLenOk: titleLen === 0 || (titleLen >= 10 && titleLen <= 20),
    wordCountOk: wordCount >= 1500 && wordCount <= 2500,
  }
}

// ── 子组件 ────────────────────────────────────────────────────────────────────

function ScoreBar({ label, score, dim }: { label: string; score: number; dim: string }) {
  return (
    <div className="score-bar-row">
      <div className="score-bar-label">{label}</div>
      <div className="score-bar-track">
        <div className={`score-bar-fill ${dim}`} style={{ width: `${score}%` }} />
      </div>
      <div className="score-bar-value">{score}</div>
    </div>
  )
}

function IssueItem({ issue }: { issue: Issue }) {
  const [open, setOpen] = useState(false)
  const levelMap = {
    error: { label: '严重', color: 'var(--color-error)',   bg: '#fff5f5', border: '#fca5a5' },
    warn:  { label: '警告', color: 'var(--color-warning)', bg: '#fffbeb', border: '#fcd34d' },
    info:  { label: '建议', color: 'var(--color-muted)',   bg: 'var(--color-surface-soft)', border: 'var(--color-hairline)' },
  }
  const lv = levelMap[issue.level]
  return (
    <div className="issue-item" style={{ borderLeftColor: lv.color, background: lv.bg }}>
      <div className="issue-header" onClick={() => setOpen(v => !v)}>
        <span className="issue-badge" style={{ color: lv.color }}>{lv.label}</span>
        <span className="issue-type">{issue.type}</span>
        {issue.quote && (
          <span className="issue-quote">「{issue.quote.slice(0, 22)}{issue.quote.length > 22 ? '……' : ''}」</span>
        )}
        <span className="issue-toggle">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
      </div>
      {open && (
        <div className="issue-detail">
          {issue.quote && <div className="issue-origin">原文：「{issue.quote}」</div>}
          <div className="issue-suggestion">建议：{issue.suggestion}</div>
        </div>
      )}
    </div>
  )
}

// ── Clay 设计系统：动态 UI 块渲染器 ──────────────────────────────────────────
// 每种 block 对应一张饱和色卡片，颜色循环：pink → lavender → peach → teal → ochre

const BLOCK_THEMES = {
  'cliche-diff':     { bg: '#ff4d8b', text: '#fff',    accent: 'rgba(255,255,255,0.25)', label: '套话修改' },
  'data-suggestion': { bg: '#b8a4ed', text: '#0a0a0a', accent: 'rgba(10,10,10,0.12)',   label: '数据补充' },
  'lead-rewrite':    { bg: '#ffb084', text: '#0a0a0a', accent: 'rgba(10,10,10,0.12)',   label: '开头改写' },
  'structure-map':   { bg: '#1a3a3a', text: '#fff',    accent: 'rgba(255,255,255,0.2)', label: '结构诊断' },
  'highlight-quote': { bg: '#e8b94a', text: '#0a0a0a', accent: 'rgba(10,10,10,0.12)',   label: '文章金句' },
} as const

// Skeleton 占位块（流式加载中）
function UIBlockSkeleton({ type }: { type: string }) {
  const theme = BLOCK_THEMES[type as keyof typeof BLOCK_THEMES] || BLOCK_THEMES['cliche-diff']
  return (
    <div className="clay-card clay-card--skeleton" style={{ background: theme.bg }}>
      <div className="clay-card-label" style={{ color: theme.text, opacity: 0.6 }}>{theme.label}</div>
      <div className="clay-skeleton-lines" style={{ '--accent': theme.accent } as React.CSSProperties}>
        <div className="clay-skel-line clay-skel-line--title" />
        <div className="clay-skel-line" />
        <div className="clay-skel-line clay-skel-line--short" />
      </div>
    </div>
  )
}

function UIBlockClicheDiffRenderer({ block }: { block: UIBlockClicheDiff }) {
  const theme = BLOCK_THEMES['cliche-diff']
  return (
    <div className="clay-card clay-card--cliche" style={{ background: theme.bg }}>
      <div className="clay-card-header">
        <span className="clay-card-label" style={{ color: theme.text }}>{theme.label}</span>
        <span className="clay-card-count" style={{ background: theme.accent, color: theme.text }}>
          {block.items.length} 处
        </span>
      </div>
      <div className="clay-card-title" style={{ color: theme.text }}>{block.title}</div>
      <div className="clay-cliche-list">
        {block.items.map((item, i) => (
          <div key={i} className="clay-cliche-item">
            <div className="clay-cliche-bad">
              <span className="clay-cliche-tag" style={{ background: 'rgba(0,0,0,0.2)', color: theme.text }}>原文</span>
              <span className="clay-cliche-text" style={{ color: theme.text }}>「{item.original}」</span>
            </div>
            <div className="clay-cliche-arrow" style={{ color: theme.text }}>↓</div>
            <div className="clay-cliche-good" style={{ background: 'rgba(255,255,255,0.18)', borderRadius: 10 }}>
              <span className="clay-cliche-tag" style={{ background: 'rgba(255,255,255,0.3)', color: theme.text }}>改为</span>
              <span className="clay-cliche-text" style={{ color: theme.text }}>{item.suggestion}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function UIBlockDataSuggestionRenderer({ block }: { block: UIBlockDataSuggestion }) {
  const theme = BLOCK_THEMES['data-suggestion']
  return (
    <div className="clay-card clay-card--data" style={{ background: theme.bg }}>
      <div className="clay-card-header">
        <span className="clay-card-label" style={{ color: theme.text }}>{theme.label}</span>
        <span className="clay-card-count" style={{ background: theme.accent, color: theme.text }}>
          {block.items.length} 处
        </span>
      </div>
      <div className="clay-card-title" style={{ color: theme.text }}>{block.title}</div>
      <div className="clay-data-list">
        {block.items.map((item, i) => (
          <div key={i} className="clay-data-item" style={{ background: theme.accent, borderRadius: 12 }}>
            <div className="clay-data-claim" style={{ color: theme.text }}>
              <span className="clay-data-tag">空泛</span>「{item.claim}」
            </div>
            <div className="clay-data-hint" style={{ color: theme.text, opacity: 0.85 }}>
              建议补充：{item.dataHint}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function UIBlockStructureMapRenderer({ block }: { block: UIBlockStructureMap }) {
  const theme = BLOCK_THEMES['structure-map']
  const statusDot = {
    good:  { bg: '#22c55e', label: '好' },
    warn:  { bg: '#f59e0b', label: '注意' },
    error: { bg: '#ef4444', label: '问题' },
  }
  return (
    <div className="clay-card clay-card--structure" style={{ background: theme.bg }}>
      <div className="clay-card-header">
        <span className="clay-card-label" style={{ color: theme.text }}>{theme.label}</span>
      </div>
      <div className="clay-card-title" style={{ color: theme.text }}>{block.title}</div>
      <div className="clay-struct-list">
        {block.sections.map((sec, i) => {
          const dot = statusDot[sec.status] || statusDot.warn
          return (
            <div key={i} className="clay-struct-item">
              <div className="clay-struct-dot" style={{ background: dot.bg }} title={dot.label} />
              <div className="clay-struct-content">
                <div className="clay-struct-heading" style={{ color: theme.text }}>{sec.heading}</div>
                <div className="clay-struct-note" style={{ color: theme.text, opacity: 0.75 }}>{sec.note}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function UIBlockLeadRewriteRenderer({ block }: { block: UIBlockLeadRewrite }) {
  const theme = BLOCK_THEMES['lead-rewrite']
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(block.rewritten).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="clay-card clay-card--lead" style={{ background: theme.bg }}>
      <div className="clay-card-header">
        <span className="clay-card-label" style={{ color: theme.text }}>{theme.label}</span>
      </div>
      <div className="clay-card-title" style={{ color: theme.text }}>{block.title}</div>
      <div className="clay-lead-panels">
        <div className="clay-lead-panel clay-lead-panel--before" style={{ background: 'rgba(0,0,0,0.1)' }}>
          <div className="clay-lead-tag" style={{ color: theme.text, opacity: 0.6 }}>原开头</div>
          <div className="clay-lead-text" style={{ color: theme.text, opacity: 0.8 }}>{block.original}</div>
        </div>
        <div className="clay-lead-divider" style={{ color: theme.text }}>AI 改写 ↓</div>
        <div className="clay-lead-panel clay-lead-panel--after" style={{ background: 'rgba(255,255,255,0.22)' }}>
          <div className="clay-lead-tag" style={{ color: theme.text }}>改写后</div>
          <div className="clay-lead-text" style={{ color: theme.text, fontWeight: 500 }}>{block.rewritten}</div>
          <button
            className="clay-lead-copy"
            onClick={handleCopy}
            style={{ background: theme.text, color: theme.bg }}
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
    </div>
  )
}

function UIBlockHighlightQuoteRenderer({ block }: { block: UIBlockHighlightQuote }) {
  const theme = BLOCK_THEMES['highlight-quote']
  return (
    <div className="clay-card clay-card--quote" style={{ background: theme.bg }}>
      <div className="clay-card-header">
        <span className="clay-card-label" style={{ color: theme.text }}>{theme.label}</span>
      </div>
      <div className="clay-card-title" style={{ color: theme.text }}>{block.title}</div>
      <div className="clay-quote-list">
        {block.quotes.map((q, i) => (
          <div key={i} className="clay-quote-item" style={{ borderLeftColor: theme.text }}>
            <span className="clay-quote-text" style={{ color: theme.text }}>{q}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// 流式渲染：analyzing 时显示 skeleton，result 到来后逐块替换
function DynamicUIBlocks({
  blocks,
  analyzing,
}: {
  blocks?: UIBlock[]
  analyzing?: boolean
}) {
  // 已知的 block 类型顺序（用于 skeleton 占位）
  const SKELETON_TYPES = ['cliche-diff', 'data-suggestion', 'lead-rewrite']

  if (!blocks || blocks.length === 0) {
    if (!analyzing) return null
    // 分析中但还没有任何 block：显示 skeleton
    return (
      <div className="clay-ui-blocks">
        <div className="clay-ui-blocks-label">AI 正在生成诊断面板...</div>
        <div className="clay-ui-blocks-grid">
          {SKELETON_TYPES.map(t => <UIBlockSkeleton key={t} type={t} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="clay-ui-blocks">
      <div className="clay-ui-blocks-label">AI 诊断面板</div>
      <div className="clay-ui-blocks-grid">
        {blocks.map((block, i) => {
          switch (block.type) {
            case 'cliche-diff':     return <UIBlockClicheDiffRenderer     key={i} block={block} />
            case 'data-suggestion': return <UIBlockDataSuggestionRenderer key={i} block={block} />
            case 'structure-map':   return <UIBlockStructureMapRenderer   key={i} block={block} />
            case 'lead-rewrite':    return <UIBlockLeadRewriteRenderer    key={i} block={block} />
            case 'highlight-quote': return <UIBlockHighlightQuoteRenderer key={i} block={block} />
            default:                return null
          }
        })}
        {/* 分析中：已有部分 block，剩余位置显示 skeleton */}
        {analyzing && blocks.length < 3 && (
          SKELETON_TYPES.slice(blocks.length).map(t => <UIBlockSkeleton key={`sk-${t}`} type={t} />)
        )}
      </div>
    </div>
  )
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function ContentStats({ content, title, articleId, task, onArticleChange }: ContentStatsProps) {
  const wordCount   = content.replace(/[#*`[\]()]/g, '').trim().length
  const readingTime = Math.ceil(wordCount / 200)
  const headings    = content.split('\n').reduce<Array<{ level: number; title: string }>>((acc, line) => {
    const m = line.match(/^(#{1,6})\s+(.+?)$/)
    if (m) acc.push({ level: m[1].length, title: m[2].trim() })
    return acc
  }, [])
  const paragraphs = content.split('\n\n').filter(p => p.trim()).length

  const [analyzing, setAnalyzing]   = useState(false)
  const [result, setResult]         = useState<AnalysisResult | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [saved, setSaved]           = useState(false)
  const [tocOpen, setTocOpen]       = useState(false)
  const [checkOpen, setCheckOpen]   = useState(true)

  // ── 去 AI 味状态 ───────────────────────────────────────────────────────────
  const [deaiLoading,   setDeaiLoading]   = useState(false)
  const [deaiError,     setDeaiError]     = useState<string | null>(null)
  const [deaiResult,    setDeaiResult]    = useState<string>('')
  const [showDeaiPanel, setShowDeaiPanel] = useState(false)
  const deaiFullText = useRef('')
  const deaiStreamRef = useRef<HTMLDivElement>(null)

  // 挂载时加载最近一次分析结果
  useEffect(() => {
    if (!articleId) return
    const token = localStorage.getItem('auth_token')
    fetch(`/api/articles/${articleId}/analyses?limit=1`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    })
      .then(r => r.ok ? r.json() : null)
      .then((data: AnalysisResult[] | null) => {
        if (data && data[0]) setResult(data[0])
      })
      .catch(() => {})
  }, [articleId])

  const checks = runChecks(content, title)

  // 自动滚动到底部
  const scrollDeaiToBottom = () => {
    if (deaiStreamRef.current) {
      deaiStreamRef.current.scrollTop = deaiStreamRef.current.scrollHeight
    }
  }

  const handleDeai = async () => {
    if (!articleId || content.trim().length < 100) {
      setDeaiError('文章内容太短，无法处理（至少 100 字）')
      setShowDeaiPanel(true)
      return
    }
    setDeaiLoading(true)
    setDeaiError(null)
    setDeaiResult('')
    setShowDeaiPanel(true)
    deaiFullText.current = ''

    try {
      const aiConfig = loadAIConfig()
      const token = localStorage.getItem('auth_token')
      const resp = await fetch(`/api/articles/${articleId}/deai/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ article: content, aiConfig }),
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
              const evt = curEvent || (payload.text !== undefined ? 'chunk' : payload.article !== undefined ? 'done' : payload.message !== undefined ? 'error' : '')
              if (evt === 'chunk') {
                const t = payload.text as string
                deaiFullText.current += t
                setDeaiResult(deaiFullText.current)
                setTimeout(scrollDeaiToBottom, 0)
              } else if (evt === 'done') {
                // done 时 fullText 已完整
              } else if (evt === 'error') {
                setDeaiError(payload.message as string)
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch (e: unknown) {
      setDeaiError(e instanceof Error ? e.message : '未知错误')
    } finally {
      setDeaiLoading(false)
    }
  }

  const handleApplyDeai = () => {
    if (deaiFullText.current && onArticleChange) {
      onArticleChange(deaiFullText.current)
      setShowDeaiPanel(false)
      setDeaiResult('')
      deaiFullText.current = ''
    }
  }

  const handleDiscardDeai = () => {
    setShowDeaiPanel(false)
    setDeaiResult('')
    deaiFullText.current = ''
    setDeaiError(null)
  }

  // 流式分析进度文字
  const [analyzeProgress, setAnalyzeProgress] = useState<string>('')

  const handleAnalyze = async () => {
    if (!articleId || content.trim().length < 100) {
      setError('文章内容太短，无法分析（至少 100 字）')
      return
    }
    setAnalyzing(true)
    setError(null)
    setResult(null)
    setAnalyzeProgress('')

    try {
      const aiConfig = loadAIConfig()
      const token = localStorage.getItem('auth_token')
      const resp = await fetch(`/api/articles/${articleId}/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ article: content, task, aiConfig }),
      })

      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)

      const reader  = resp.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let   lineBuf  = ''
      let   curEvent = ''
      let   accumulated = ''

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
          if (!trimmed.startsWith('data:')) continue

          try {
            const payload = JSON.parse(trimmed.slice(5).trim()) as Record<string, unknown>
            const evt = curEvent

            if (evt === 'progress') {
              setAnalyzeProgress(payload.message as string)
            } else if (evt === 'chunk') {
              accumulated += payload.text as string
            } else if (evt === 'partial-result') {
              // 增量更新：流式渲染已解析的部分
              setResult(prev => ({
                scores: { overall: 0, style: 0, structure: 0, actionability: 0, originality: 0 },
                wordCount: 0, readingMinutes: 0, strengths: [], issues: [],
                styleMatch: { score: 0, note: '' }, topSuggestion: '', ragCount: 0,
                ...prev,
                ...(payload as unknown as Partial<AnalysisResult>),
              }))
            } else if (evt === 'result') {
              setResult(payload as unknown as AnalysisResult)
              setAnalyzeProgress('')
              setSaved(true)
              setTimeout(() => setSaved(false), 3000)
            } else if (evt === 'error') {
              throw new Error(payload.message as string)
            }
          } catch (parseErr) {
            // 只有 event:error 时才抛出
            if (curEvent === 'error') throw parseErr
          }
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '未知错误')
    } finally {
      setAnalyzing(false)
      setAnalyzeProgress('')
    }
  }

  const scoreLabels: Record<keyof Omit<ScoreMap, 'overall'>, string> = {
    style:         '风格真实度',
    structure:     '结构合理性',
    actionability: '实用可操作',
    originality:   '观点独特性',
  }

  const issueErrors = result?.issues.filter(i => i.level === 'error') ?? []
  const issueWarns  = result?.issues.filter(i => i.level === 'warn')  ?? []
  const issueInfos  = result?.issues.filter(i => i.level === 'info')  ?? []

  // 规范核查通过数
  const checkItems = [
    !checks.foundCliches.length,
    !checks.hasWrongQuotes,
    !checks.hasWrongDash,
    !checks.hasWrongEllip,
    checks.hasData,
    checks.hasFirstPerson,
    checks.wordCountOk,
    checks.hasHeadings,
  ]
  const passCount = checkItems.filter(Boolean).length

  return (
    <div className="content-stats">

      {/* ── 四格统计 ─────────────────────────────────────────────────────────── */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon"><FileText size={18} /></div>
          <div className="stat-content">
            <div className="stat-label">字数</div>
            <div className="stat-value">{wordCount.toLocaleString()}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><Clock size={18} /></div>
          <div className="stat-content">
            <div className="stat-label">阅读时间</div>
            <div className="stat-value">{readingTime} 分钟</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><BarChart3 size={18} /></div>
          <div className="stat-content">
            <div className="stat-label">段落数</div>
            <div className="stat-value">{paragraphs}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><Eye size={18} /></div>
          <div className="stat-content">
            <div className="stat-label">标题数</div>
            <div className="stat-value">{headings.length}</div>
          </div>
        </div>
      </div>

      {/* ── 规范核查（AGENTS.md） ─────────────────────────────────────────────── */}
      {content.trim().length > 50 && (
        <div className="checklist-section">
          <div className="checklist-header" onClick={() => setCheckOpen(v => !v)}>
            <div className="checklist-header-left">
              {checkOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              写作规范核查
              <span className="checklist-progress-text">{passCount}/{checkItems.length} 通过</span>
            </div>
          </div>

          {checkOpen && (
            <div className="checklist-body">

              {/* AI 套话 */}
              <div className="checklist-group">
                <div className="checklist-group-title">AI 套话检测</div>
                <div className="checklist-items">
                  {checks.foundCliches.length === 0 ? (
                    <div className="checklist-item pass">
                      <span className="ci-icon pass"><CheckCircle2 size={14} /></span>
                      <span className="ci-text">没有检测到 AI 套话</span>
                    </div>
                  ) : (
                    <>
                      <div className="checklist-item fail">
                        <span className="ci-icon fail"><AlertCircle size={14} /></span>
                        <span className="ci-text">
                          发现 <strong>{checks.foundCliches.length}</strong> 处禁用套话，请逐一修改：
                        </span>
                      </div>
                      {checks.foundCliches.map((c, i) => (
                        <div key={i} className="checklist-item checklist-item--sub fail">
                          <span className="ci-icon fail"><AlertCircle size={12} /></span>
                          <span className="ci-text">
                            <span className="ci-found">「{c.word}」</span>
                            {c.count > 1 && <span className="ci-count">×{c.count}</span>}
                            <span className="ci-reason"> — {c.reason}</span>
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>

              {/* 标点规范 */}
              <div className="checklist-group">
                <div className="checklist-group-title">标点规范</div>
                <div className="checklist-items">
                  <div className={`checklist-item ${!checks.hasWrongQuotes ? 'pass' : 'fail'}`}>
                    <span className={`ci-icon ${!checks.hasWrongQuotes ? 'pass' : 'fail'}`}>
                      {!checks.hasWrongQuotes ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                    </span>
                    <span className="ci-text">
                      引号使用{checks.hasWrongQuotes
                        ? <> — <span className="ci-found">检测到 " " 英文引号，应改为「」</span></>
                        : '正确（使用「」）'}
                    </span>
                  </div>
                  <div className={`checklist-item ${!checks.hasWrongDash ? 'pass' : 'fail'}`}>
                    <span className={`ci-icon ${!checks.hasWrongDash ? 'pass' : 'fail'}`}>
                      {!checks.hasWrongDash ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                    </span>
                    <span className="ci-text">
                      破折号{checks.hasWrongDash
                        ? <> — <span className="ci-found">检测到 -- 应改为 ——</span></>
                        : '正确（使用 ——）'}
                    </span>
                  </div>
                  <div className={`checklist-item ${!checks.hasWrongEllip ? 'pass' : 'fail'}`}>
                    <span className={`ci-icon ${!checks.hasWrongEllip ? 'pass' : 'fail'}`}>
                      {!checks.hasWrongEllip ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                    </span>
                    <span className="ci-text">
                      省略号{checks.hasWrongEllip
                        ? <> — <span className="ci-found">检测到 ... 应改为 ……</span></>
                        : '正确（使用 ……）'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 内容质量 */}
              <div className="checklist-group">
                <div className="checklist-group-title">内容质量</div>
                <div className="checklist-items">
                  <div className={`checklist-item ${checks.hasData ? 'pass' : 'check'}`}>
                    <span className={`ci-icon ${checks.hasData ? 'pass' : 'check'}`}>
                      {checks.hasData ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                    </span>
                    <span className="ci-text">
                      {checks.hasData ? '包含具体数据或案例' : '建议补充具体数据（如「节省了 2 小时」）'}
                    </span>
                  </div>
                  <div className={`checklist-item ${checks.hasFirstPerson ? 'pass' : 'check'}`}>
                    <span className={`ci-icon ${checks.hasFirstPerson ? 'pass' : 'check'}`}>
                      {checks.hasFirstPerson ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                    </span>
                    <span className="ci-text">
                      {checks.hasFirstPerson ? '使用了第一人称「我」' : '建议用「我」而非「我们」增加真实感'}
                    </span>
                  </div>
                  <div className={`checklist-item ${checks.wordCountOk ? 'pass' : 'check'}`}>
                    <span className={`ci-icon ${checks.wordCountOk ? 'pass' : 'check'}`}>
                      {checks.wordCountOk ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                    </span>
                    <span className="ci-text">
                      字数{checks.wordCountOk
                        ? `在建议范围（1500-2500 字）`
                        : wordCount < 1500
                          ? `${wordCount} 字，建议增加到 1500 字以上`
                          : `${wordCount} 字，已超出 2500 字建议上限`
                      }
                    </span>
                  </div>
                  <div className={`checklist-item ${checks.hasHeadings ? 'pass' : 'check'}`}>
                    <span className={`ci-icon ${checks.hasHeadings ? 'pass' : 'check'}`}>
                      {checks.hasHeadings ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                    </span>
                    <span className="ci-text">
                      {checks.hasHeadings
                        ? `包含标题结构（${headings.length} 个）`
                        : '建议用 H2/H3 标题组织内容（建议 3-5 个）'}
                    </span>
                  </div>
                </div>
              </div>

            </div>
          )}
        </div>
      )}

      {/* ── 目录折叠 ─────────────────────────────────────────────────────────── */}
      {headings.length > 0 && (
        <div className="toc-section">
          <button className="toc-toggle" onClick={() => setTocOpen(v => !v)}>
            {tocOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            文章目录（{headings.length} 个标题）
          </button>
          {tocOpen && (
            <ul className="toc-list">
              {headings.map((h, i) => (
                <li key={i} className={`toc-item level-${h.level}`} style={{ paddingLeft: `${(h.level - 1) * 14}px` }}>
                  {h.title}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── 去 AI 味 ─────────────────────────────────────────────────────────── */}
      <div className="deai-section">
        <div className="deai-header">
          <div className="deai-title">
            <Wand2 size={15} />
            去 AI 味复审
            <span className="deai-subtitle">删套话、改过渡词、修标点</span>
          </div>
          <button
            className={`btn-deai ${deaiLoading ? 'loading' : ''}`}
            onClick={handleDeai}
            disabled={deaiLoading || content.trim().length < 100}
          >
            {deaiLoading
              ? <><span className="spinner-sm" />处理中...</>
              : <><Wand2 size={13} />{showDeaiPanel && deaiResult ? '重新处理' : '开始处理'}</>
            }
          </button>
        </div>

        {showDeaiPanel && (
          <div className="deai-panel">
            <div className="deai-panel-head">
              <span className="deai-panel-label">
                {deaiLoading ? '正在改写...' : deaiError ? '处理失败' : '改写预览'}
              </span>
              <button className="deai-panel-close" onClick={handleDiscardDeai} title="关闭">
                <X size={13} />
              </button>
            </div>

            {deaiError && (
              <div className="deai-error">
                <AlertCircle size={14} />
                {deaiError}
              </div>
            )}

            {!deaiError && (
              <div className="deai-stream" ref={deaiStreamRef}>
                {deaiResult ? (
                  <pre className="deai-stream-text">{deaiResult}</pre>
                ) : (
                  <div className="deai-stream-empty">
                    <span className="spinner-sm" />
                    <span>AI 正在逐字改写...</span>
                  </div>
                )}
              </div>
            )}

            {!deaiLoading && !deaiError && deaiResult && (
              <div className="deai-panel-footer">
                <button className="deai-btn-discard" onClick={handleDiscardDeai}>放弃</button>
                {onArticleChange && (
                  <button className="deai-btn-apply" onClick={handleApplyDeai}>应用到编辑器</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── AI 深度分析 ───────────────────────────────────────────────────────── */}
      <div className="analysis-section">
        <div className="analysis-header">
          <div className="analysis-title">
            <Sparkles size={15} />
            AI 深度分析
            <span className="analysis-subtitle">结合写作规范 + 往期文章对比</span>
          </div>
          <div className="analysis-header-right">
            {saved && <span className="saved-badge">已保存</span>}
            <button
              className={`btn-analyze ${analyzing ? 'loading' : ''}`}
              onClick={handleAnalyze}
              disabled={analyzing || content.trim().length < 100}
            >
              {analyzing
                ? <><span className="spinner-sm" />{analyzeProgress || '分析中...'}</>
                : <><Sparkles size={13} />{result ? '重新分析' : '开始分析'}</>
              }
            </button>
          </div>
        </div>

        {error && (
          <div className="analysis-error">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {!result && !analyzing && (
          <div className="analysis-empty">
            <p>AI 会读取 AGENTS.md 规范和往期文章，评分并列出具体问题。</p>
            {content.trim().length < 100 && (
              <p className="analysis-tip">文章内容不足 100 字，先把文章写长一点再分析。</p>
            )}
          </div>
        )}

        {/* 分析中且还没有 result：只显示 skeleton UI 块 */}
        {analyzing && !result && (
          <DynamicUIBlocks blocks={undefined} analyzing={true} />
        )}

        {result && (
          <div className="analysis-result">

            {/* 综合评分 */}
            <div className="overall-row">
              <div className="overall-score-ring">
                <svg viewBox="0 0 64 64" className="ring-svg">
                  <circle cx="32" cy="32" r="26" className="ring-bg" />
                  <circle
                    cx="32" cy="32" r="26"
                    className="ring-fill"
                    strokeDasharray={`${(result.scores.overall / 100) * 163} 163`}
                  />
                </svg>
                <span className="ring-label">{result.scores.overall || '…'}</span>
              </div>
              <div className="overall-meta">
                <div className="overall-verdict">
                  {result.scores.overall >= 80
                    ? '质量不错，小改即可'
                    : result.scores.overall >= 60
                      ? '基本达标，有改进空间'
                      : result.scores.overall > 0
                        ? '需要较多修改'
                        : analyzing ? '分析中...' : ''}
                </div>
                {result.ragCount > 0 && (
                  <div className="rag-badge">对比了 {result.ragCount} 篇往期文章</div>
                )}
                {result.topSuggestion && (
                  <div className="top-suggestion">优先改：{result.topSuggestion}</div>
                )}
              </div>
            </div>

            {/* 四维评分 */}
            <div className="scores-block">
              {(['style', 'structure', 'actionability', 'originality'] as const).map(key => (
                <ScoreBar
                  key={key}
                  label={scoreLabels[key]}
                  score={result.scores[key]}
                  dim={key}
                />
              ))}
              {result.styleMatch?.score >= 0 && result.styleMatch?.note && (
                <div className="style-match-note">
                  风格一致性 {result.styleMatch.score}/100 — {result.styleMatch.note}
                </div>
              )}
            </div>

            {/* 亮点 */}
            {result.strengths?.length > 0 && (
              <div className="strengths-block">
                <div className="block-title"><CheckCircle2 size={14} />文章亮点</div>
                <ul className="strengths-list">
                  {result.strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}

            {/* 问题 */}
            {result.issues?.length > 0 && (
              <div className="issues-block">
                <div className="block-title">
                  <AlertCircle size={14} />
                  问题检测
                  <span className="issue-counts">
                    {issueErrors.length > 0 && <span className="count-badge error">{issueErrors.length} 严重</span>}
                    {issueWarns.length  > 0 && <span className="count-badge warn">{issueWarns.length} 警告</span>}
                    {issueInfos.length  > 0 && <span className="count-badge info">{issueInfos.length} 建议</span>}
                  </span>
                </div>
                <div className="issues-list">
                  {[...issueErrors, ...issueWarns, ...issueInfos].map((issue, i) => (
                    <IssueItem key={i} issue={issue} />
                  ))}
                </div>
              </div>
            )}

            {/* ── 动态 UI 块（Clay 设计系统，流式渲染） ── */}
            <DynamicUIBlocks blocks={result.uiBlocks} analyzing={analyzing} />

          </div>
        )}
      </div>

    </div>
  )
}
