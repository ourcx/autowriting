import { useState, useEffect } from 'react'
import {
  BarChart3, Clock, FileText, Eye,
  Sparkles, AlertCircle, CheckCircle2,
  ChevronDown, ChevronRight, Circle,
} from 'lucide-react'
import { loadAIConfig } from '../utils/aiConfig'
import './ContentStats.css'

interface ContentStatsProps {
  content: string
  title?: string
  articleId?: string
  task?: string
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

interface AnalysisResult {
  scores: ScoreMap
  wordCount: number
  readingMinutes: number
  strengths: string[]
  issues: Issue[]
  styleMatch: { score: number; note: string }
  topSuggestion: string
  ragCount: number
}

// ── AGENTS.md 规范核查（纯本地，即时） ────────────────────────────────────────

const AI_CLICHES = [
  '在当今这个', '随着科技', '大家好，今天', '总而言之', '总的来说', '综上所述',
  '希望本文', '让我们一起', '打开了新世界', '不得不说', '不得不提', '值得一提',
  '极大地', '显著地', '大幅度地', '接下来，让我们', '下面我将',
  '非常重要', '至关重要', '深刻影响', '不可忽视',
]

const WRONG_QUOTES = ['"', '"']  // 应该用「」
const WRONG_DASH   = '--'        // 应该用 ——
const WRONG_ELLIP  = '...'       // 应该用 ……

function runChecks(text: string, title?: string) {
  const foundCliches = AI_CLICHES.filter(c => text.includes(c))
  const hasWrongQuotes = WRONG_QUOTES.some(q => text.includes(q))
  const hasWrongDash   = text.includes(WRONG_DASH)
  const hasWrongEllip  = text.includes(WRONG_ELLIP)
  const wordCount      = text.replace(/[#*`\[\]()]/g, '').trim().length
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

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function ContentStats({ content, title, articleId, task }: ContentStatsProps) {
  const wordCount   = content.replace(/[#*`\[\]()]/g, '').trim().length
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

  // 挂载时加载最近一次分析结果
  useEffect(() => {
    if (!articleId) return
    fetch(`/api/articles/${articleId}/analyses?limit=1`)
      .then(r => r.ok ? r.json() : null)
      .then((data: AnalysisResult[] | null) => {
        if (data && data[0]) setResult(data[0])
      })
      .catch(() => {})
  }, [articleId])

  const checks = runChecks(content, title)

  const handleAnalyze = async () => {
    if (!articleId || content.trim().length < 100) {
      setError('文章内容太短，无法分析（至少 100 字）')
      return
    }
    setAnalyzing(true)
    setError(null)
    setResult(null)
    try {
      const aiConfig = loadAIConfig()
      const resp = await fetch(`/api/articles/${articleId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article: content, task, aiConfig }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || '分析失败')
      setResult(data as AnalysisResult)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '未知错误')
    } finally {
      setAnalyzing(false)
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
                  <div className={`checklist-item ${checks.foundCliches.length === 0 ? 'pass' : 'fail'}`}>
                    <span className={`ci-icon ${checks.foundCliches.length === 0 ? 'pass' : 'fail'}`}>
                      {checks.foundCliches.length === 0
                        ? <CheckCircle2 size={14} />
                        : <AlertCircle size={14} />}
                    </span>
                    <span className="ci-text">
                      {checks.foundCliches.length === 0
                        ? '没有检测到 AI 套话'
                        : <>发现 {checks.foundCliches.length} 处套话：
                            <span className="ci-found">「{checks.foundCliches.slice(0, 3).join('」「')}」{checks.foundCliches.length > 3 ? `等` : ''}</span>
                          </>
                      }
                    </span>
                  </div>
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
                ? <><span className="spinner-sm" />分析中...</>
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
                <span className="ring-label">{result.scores.overall}</span>
              </div>
              <div className="overall-meta">
                <div className="overall-verdict">
                  {result.scores.overall >= 80
                    ? '质量不错，小改即可'
                    : result.scores.overall >= 60
                      ? '基本达标，有改进空间'
                      : '需要较多修改'}
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
              {result.styleMatch.score >= 0 && (
                <div className="style-match-note">
                  风格一致性 {result.styleMatch.score}/100 — {result.styleMatch.note}
                </div>
              )}
            </div>

            {/* 亮点 */}
            {result.strengths.length > 0 && (
              <div className="strengths-block">
                <div className="block-title"><CheckCircle2 size={14} />文章亮点</div>
                <ul className="strengths-list">
                  {result.strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}

            {/* 问题 */}
            {result.issues.length > 0 && (
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

          </div>
        )}
      </div>

    </div>
  )
}
