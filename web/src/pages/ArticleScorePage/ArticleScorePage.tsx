/**
 * 文章评分页  /scores
 * - 列出所有已生成文章，支持录入评分数据
 * - 支持手动添加外部文章（不影响文章列表）
 * - 系统自动计算综合评分（0-100）
 * - 有评分的文章在生成时会作为优秀/不优秀示例注入 prompt
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart2, Star, Trash2, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, Plus, X } from 'lucide-react'
import PageHeader from '../../components/PageHeader/PageHeader'
import { toast } from '../../components/Toast/Toast'
import './ArticleScorePage.css'

interface Article {
  id: string
  date: string
  title: string
  status: string
}

interface ScoreData {
  id: number
  articleId: string
  title: string
  platform: Platform
  views: number | null
  shares: number | null
  likes: number | null
  comments: number | null
  composite: number | null
  note: string | null
  scoredAt: string
}

interface ScoreForm {
  views: string
  shares: string
  likes: string
  comments: string
  composite: string
  note: string
}

// 手动添加文章的 Modal 表单
interface AddArticleForm {
  title: string
  content: string
  platform: Platform
  views: string
  shares: string
  likes: string
  comments: string
  composite: string
  note: string
}

type Platform = 'wechat' | 'toutiao' | 'xiaohongshu'

const EMPTY_FORM: ScoreForm = { views: '', shares: '', likes: '', comments: '', composite: '', note: '' }
const EMPTY_ADD_FORM: AddArticleForm = {
  title: '', content: '', platform: 'wechat',
  views: '', shares: '', likes: '', comments: '', composite: '', note: '',
}

function platformLabel(platform: Platform) {
  return { wechat: '公众号', toutiao: '今日头条', xiaohongshu: '小红书' }[platform]
}

function platformIcon(platform: Platform) {
  return { wechat: '📱', toutiao: '📰', xiaohongshu: '📕' }[platform]
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('auth_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function compositeColor(v: number | null) {
  if (v == null) return '#9a9a9a'
  if (v >= 70) return '#16a34a'
  if (v >= 40) return '#d97706'
  return '#dc2626'
}

function compositeLabel(v: number | null) {
  if (v == null) return null
  if (v >= 70) return { text: '优秀', color: 'green' }
  if (v >= 40) return { text: '一般', color: 'ochre' }
  return { text: '待改进', color: 'pink' }
}

function fmtNum(n: number | null) {
  if (n == null) return '—'
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  return n.toLocaleString()
}

// ── 评分卡片（复用） ──────────────────────────────────────────────────────────
function ScoreCard({
  s,
  onEdit,
  onDelete,
}: {
  s: ScoreData
  onEdit: () => void
  onDelete: () => void
}) {
  const lbl = compositeLabel(s.composite)
  return (
    <div className={`asp-score-card asp-score-card--${lbl?.color || 'muted'}`}>
      <div className="asp-score-card-head">
        <span className="asp-score-platform">{platformLabel(s.platform)}</span>
        {lbl && <span className="asp-score-label">{lbl.text}</span>}
        <div style={{ flex: 1 }} />
        <button className="asp-icon-btn asp-icon-btn--edit" onClick={onEdit} title="编辑">
          <Star size={13} />
        </button>
        <button className="asp-icon-btn asp-icon-btn--del" onClick={onDelete} title="删除">
          <Trash2 size={13} />
        </button>
      </div>
      <div className="asp-score-composite">
        <span className="asp-score-num" style={{ color: compositeColor(s.composite) }}>
          {s.composite ?? '—'}
        </span>
        <span className="asp-score-unit">/ 100</span>
      </div>
      <div className="asp-score-metrics">
        <div className="asp-metric"><span className="asp-metric-label">浏览</span><span className="asp-metric-val">{fmtNum(s.views)}</span></div>
        <div className="asp-metric"><span className="asp-metric-label">点赞</span><span className="asp-metric-val">{fmtNum(s.likes)}</span></div>
        <div className="asp-metric"><span className="asp-metric-label">转发</span><span className="asp-metric-val">{fmtNum(s.shares)}</span></div>
        <div className="asp-metric"><span className="asp-metric-label">评论</span><span className="asp-metric-val">{fmtNum(s.comments)}</span></div>
      </div>
      {s.note && <div className="asp-score-note">{s.note}</div>}
    </div>
  )
}

// ── 内联评分表单（复用） ──────────────────────────────────────────────────────
function InlineScoreForm({
  editState,
  isSaving,
  onPlatformChange,
  onFieldChange,
  onSave,
  onCancel,
}: {
  editState: { platform: Platform; form: ScoreForm }
  isSaving: boolean
  onPlatformChange: (p: Platform) => void
  onFieldChange: (field: keyof ScoreForm, value: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="asp-form-card">
      <div className="asp-form-head">
        <span className="asp-form-title">
          {platformIcon(editState.platform)} {platformLabel(editState.platform)} 数据录入
        </span>
        <div className="asp-platform-switch">
          <button
            className={`asp-platform-btn${editState.platform === 'wechat' ? ' asp-platform-btn--active' : ''}`}
            onClick={() => onPlatformChange('wechat')}
          >公众号</button>
          <button
            className={`asp-platform-btn${editState.platform === 'toutiao' ? ' asp-platform-btn--active' : ''}`}
            onClick={() => onPlatformChange('toutiao')}
          >今日头条</button>
          <button
            className={`asp-platform-btn${editState.platform === 'xiaohongshu' ? ' asp-platform-btn--active' : ''}`}
            onClick={() => onPlatformChange('xiaohongshu')}
          >小红书</button>
        </div>
      </div>
      <div className="asp-form-grid">
        {(['views', 'likes', 'shares', 'comments'] as const).map(field => (
          <div key={field} className="asp-form-field">
            <label className="asp-form-label">
              {{ views: '浏览量', likes: '点赞数', shares: '转发数', comments: '评论数' }[field]}
            </label>
            <input
              className="asp-input"
              type="number"
              placeholder={{ views: '如 5000', likes: '如 120', shares: '如 30', comments: '如 15' }[field]}
              value={editState.form[field]}
              onChange={e => onFieldChange(field, e.target.value)}
            />
          </div>
        ))}
        <div className="asp-form-field">
          <label className="asp-form-label">
            综合评分
            <span className="asp-form-hint">0-100，留空自动计算</span>
          </label>
          <input
            className="asp-input"
            type="number"
            min={0}
            max={100}
            placeholder="留空自动计算"
            value={editState.form.composite}
            onChange={e => onFieldChange('composite', e.target.value)}
          />
        </div>
        <div className="asp-form-field">
          <label className="asp-form-label">备注</label>
          <input
            className="asp-input"
            type="text"
            placeholder="可选，如「爆款」"
            value={editState.form.note}
            onChange={e => onFieldChange('note', e.target.value)}
          />
        </div>
      </div>
      <div className="asp-form-footer">
        <button className="asp-btn-ghost" onClick={onCancel}>取消</button>
        <button className="asp-btn-primary" onClick={onSave} disabled={isSaving}>
          {isSaving ? '保存中...' : '保存评分'}
        </button>
      </div>
    </div>
  )
}

// ── 手动添加文章 Modal ────────────────────────────────────────────────────────
function AddArticleModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<AddArticleForm>({ ...EMPTY_ADD_FORM })
  const [saving, setSaving] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  function setField<K extends keyof AddArticleForm>(k: K, v: AddArticleForm[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleSave() {
    if (!form.title.trim()) {
      toast.error('请填写文章标题')
      return
    }
    const hasData = [form.views, form.shares, form.likes, form.comments, form.composite].some(v => v !== '')
    if (!hasData) {
      toast.error('请至少填写一项数据（浏览量/点赞/转发/评论/综合评分）')
      return
    }

    setSaving(true)
    try {
      // 用 custom_ 前缀 + 时间戳生成唯一 ID
      const articleId = `custom_${Date.now()}`

      // 保存评分（content 一并传给后端，后端负责写文件）
      const res = await fetch(`/api/scores/${articleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title:     form.title.trim(),
          content:   form.content.trim() || undefined,
          platform:  form.platform,
          views:     form.views     || undefined,
          shares:    form.shares    || undefined,
          likes:     form.likes     || undefined,
          comments:  form.comments  || undefined,
          composite: form.composite || undefined,
          note:      form.note      || undefined,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      toast.success('文章评分已添加')
      onSaved()
      onClose()
    } catch (e: unknown) {
      toast.error('保存失败：' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // 点击遮罩关闭
  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose()
  }

  return (
    <div className="asp-modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="asp-modal">
        <div className="asp-modal-header">
          <span className="asp-modal-title">手动添加文章评分</span>
          <button className="asp-modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="asp-modal-body">
          {/* 文章标题 */}
          <div className="asp-form-field">
            <label className="asp-form-label">
              文章标题 <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              className="asp-input"
              type="text"
              placeholder="输入文章标题"
              value={form.title}
              onChange={e => setField('title', e.target.value)}
            />
          </div>

          {/* 文章内容 */}
          <div className="asp-form-field">
            <label className="asp-form-label">
              文章内容
              <span className="asp-form-hint">可选，填写后 AI 生成时可参考此文章风格</span>
            </label>
            <textarea
              className="asp-textarea"
              placeholder="粘贴文章正文内容（可选）"
              value={form.content}
              onChange={e => setField('content', e.target.value)}
              rows={6}
            />
          </div>

          {/* 平台选择 */}
          <div className="asp-form-field">
            <label className="asp-form-label">发布平台</label>
            <div className="asp-platform-switch" style={{ width: 'fit-content' }}>
              <button
                className={`asp-platform-btn${form.platform === 'wechat' ? ' asp-platform-btn--active' : ''}`}
                onClick={() => setField('platform', 'wechat')}
              >公众号</button>
              <button
                className={`asp-platform-btn${form.platform === 'toutiao' ? ' asp-platform-btn--active' : ''}`}
                onClick={() => setField('platform', 'toutiao')}
              >今日头条</button>
              <button
                className={`asp-platform-btn${form.platform === 'xiaohongshu' ? ' asp-platform-btn--active' : ''}`}
                onClick={() => setField('platform', 'xiaohongshu')}
              >小红书</button>
            </div>
          </div>

          {/* 数据指标 */}
          <div className="asp-modal-divider">数据指标（至少填一项）</div>
          <div className="asp-form-grid">
            {(['views', 'likes', 'shares', 'comments'] as const).map(field => (
              <div key={field} className="asp-form-field">
                <label className="asp-form-label">
                  {{ views: '浏览量', likes: '点赞数', shares: '转发数', comments: '评论数' }[field]}
                </label>
                <input
                  className="asp-input"
                  type="number"
                  placeholder={{ views: '如 5000', likes: '如 120', shares: '如 30', comments: '如 15' }[field]}
                  value={form[field]}
                  onChange={e => setField(field, e.target.value)}
                />
              </div>
            ))}
            <div className="asp-form-field">
              <label className="asp-form-label">
                综合评分
                <span className="asp-form-hint">0-100，留空自动计算</span>
              </label>
              <input
                className="asp-input"
                type="number"
                min={0}
                max={100}
                placeholder="留空自动计算"
                value={form.composite}
                onChange={e => setField('composite', e.target.value)}
              />
            </div>
            <div className="asp-form-field">
              <label className="asp-form-label">备注</label>
              <input
                className="asp-input"
                type="text"
                placeholder="可选，如「爆款」"
                value={form.note}
                onChange={e => setField('note', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="asp-modal-footer">
          <button className="asp-btn-ghost" onClick={onClose}>取消</button>
          <button className="asp-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '添加评分'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 文章卡片（通用） ──────────────────────────────────────────────────────────
function ArticleCard({
  articleId: _articleId,
  title,
  articleScores,
  isExpanded,
  editState,
  isSaving,
  onToggle,
  onStartEdit,
  onCancelEdit,
  onPlatformChange,
  onFieldChange,
  onSave,
  onDelete,
  badge,
}: {
  articleId: string
  title: string
  articleScores: ScoreData[]
  isExpanded: boolean
  editState: { platform: Platform; form: ScoreForm } | null | undefined
  isSaving: boolean
  onToggle: () => void
  onStartEdit: (platform: Platform, existing?: ScoreData) => void
  onCancelEdit: () => void
  onPlatformChange: (p: Platform) => void
  onFieldChange: (field: keyof ScoreForm, value: string) => void
  onSave: () => void
  onDelete: (platform: Platform) => void
  badge?: React.ReactNode
}) {
  const wechatScore  = articleScores.find(s => s.platform === 'wechat')
  const toutiaoScore = articleScores.find(s => s.platform === 'toutiao')
  const xiaohongshuScore = articleScores.find(s => s.platform === 'xiaohongshu')

  return (
    <div className={`asp-article-card${articleScores.length ? ' asp-article-card--scored' : ''}`}>
      <div className="asp-article-head" onClick={onToggle}>
        <div className="asp-article-info">
          <div className="asp-article-title">{title}</div>
          <div className="asp-article-meta">
            {badge}
            {articleScores.length === 0 && (
              <span className="asp-badge asp-badge--muted">未评分</span>
            )}
            {wechatScore && (
              <span className="asp-badge" style={{ background: `${compositeColor(wechatScore.composite)}18`, color: compositeColor(wechatScore.composite), border: `1px solid ${compositeColor(wechatScore.composite)}40` }}>
                公众号 {wechatScore.composite}分
              </span>
            )}
            {toutiaoScore && (
              <span className="asp-badge" style={{ background: `${compositeColor(toutiaoScore.composite)}18`, color: compositeColor(toutiaoScore.composite), border: `1px solid ${compositeColor(toutiaoScore.composite)}40` }}>
                头条 {toutiaoScore.composite}分
              </span>
            )}
            {xiaohongshuScore && (
              <span className="asp-badge" style={{ background: `${compositeColor(xiaohongshuScore.composite)}18`, color: compositeColor(xiaohongshuScore.composite), border: `1px solid ${compositeColor(xiaohongshuScore.composite)}40` }}>
                小红书 {xiaohongshuScore.composite}分
              </span>
            )}
          </div>
        </div>
        <button className="asp-expand-btn">
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {isExpanded && (
        <div className="asp-article-body">
          {articleScores.length > 0 && (
            <div className="asp-scores-grid">
              {articleScores.map(s => (
                <ScoreCard
                  key={s.platform}
                  s={s}
                  onEdit={() => onStartEdit(s.platform, s)}
                  onDelete={() => onDelete(s.platform)}
                />
              ))}
            </div>
          )}

          {editState ? (
            <InlineScoreForm
              editState={editState}
              isSaving={isSaving}
              onPlatformChange={onPlatformChange}
              onFieldChange={onFieldChange}
              onSave={onSave}
              onCancel={onCancelEdit}
            />
          ) : (
            <div className="asp-add-row">
              {!wechatScore && (
                <button className="asp-add-btn asp-add-btn--wechat" onClick={() => onStartEdit('wechat')}>
                  <Star size={13} />
                  录入公众号数据
                </button>
              )}
              {!toutiaoScore && (
                <button className="asp-add-btn asp-add-btn--toutiao" onClick={() => onStartEdit('toutiao')}>
                  <Star size={13} />
                  录入今日头条数据
                </button>
              )}
              {!xiaohongshuScore && (
                <button className="asp-add-btn asp-add-btn--xiaohongshu" onClick={() => onStartEdit('xiaohongshu')}>
                  <Star size={13} />
                  录入小红书数据
                </button>
              )}
              {wechatScore && toutiaoScore && xiaohongshuScore && (
                <span className="asp-all-scored">
                  <Minus size={12} />
                  三个平台均已评分，点击评分卡片上的编辑按钮修改
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── 主页面 ────────────────────────────────────────────────────────────────────
export default function ArticleScorePage() {
  const navigate = useNavigate()
  const [articles, setArticles]   = useState<Article[]>([])
  const [scores, setScores]       = useState<Record<string, ScoreData[]>>({})
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]   = useState<Record<string, boolean>>({})
  const [editing, setEditing]     = useState<Record<string, { platform: Platform; form: ScoreForm } | null>>({})
  const [saving, setSaving]       = useState<Record<string, boolean>>({})
  const [showAddModal, setShowAddModal] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [artRes, scoreRes] = await Promise.all([
        fetch('/api/articles', { headers: authHeaders() }),
        fetch('/api/scores',   { headers: authHeaders() }),
      ])
      const arts: Article[]       = await artRes.json()
      const allScores: ScoreData[] = await scoreRes.json()

      setArticles(arts.filter(a => a.status === 'generated'))

      const grouped: Record<string, ScoreData[]> = {}
      for (const s of allScores) {
        if (!grouped[s.articleId]) grouped[s.articleId] = []
        grouped[s.articleId].push(s)
      }
      setScores(grouped)
    } catch {
      toast.error('加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  function toggleExpand(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function startEdit(articleId: string, platform: Platform, existing?: ScoreData) {
    setEditing(prev => ({
      ...prev,
      [articleId]: {
        platform,
        form: existing ? {
          views:     existing.views     != null ? String(existing.views)     : '',
          shares:    existing.shares    != null ? String(existing.shares)    : '',
          likes:     existing.likes     != null ? String(existing.likes)     : '',
          comments:  existing.comments  != null ? String(existing.comments)  : '',
          composite: existing.composite != null ? String(existing.composite) : '',
          note:      existing.note || '',
        } : { ...EMPTY_FORM },
      },
    }))
  }

  function cancelEdit(articleId: string) {
    setEditing(prev => ({ ...prev, [articleId]: null }))
  }

  function updateForm(articleId: string, field: keyof ScoreForm, value: string) {
    setEditing(prev => {
      const cur = prev[articleId]
      if (!cur) return prev
      return { ...prev, [articleId]: { ...cur, form: { ...cur.form, [field]: value } } }
    })
  }

  function changePlatform(articleId: string, platform: Platform) {
    setEditing(prev => {
      const cur = prev[articleId]
      if (!cur) return prev
      return { ...prev, [articleId]: { ...cur, platform } }
    })
  }

  async function saveScore(articleId: string, title: string) {
    const cur = editing[articleId]
    if (!cur) return
    setSaving(prev => ({ ...prev, [articleId]: true }))
    try {
      const res = await fetch(`/api/scores/${articleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title,
          platform:  cur.platform,
          views:     cur.form.views     || undefined,
          shares:    cur.form.shares    || undefined,
          likes:     cur.form.likes     || undefined,
          comments:  cur.form.comments  || undefined,
          composite: cur.form.composite || undefined,
          note:      cur.form.note      || undefined,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      toast.success('评分已保存')
      cancelEdit(articleId)
      await fetchAll()
    } catch (e: unknown) {
      toast.error('保存失败：' + (e as Error).message)
    } finally {
      setSaving(prev => ({ ...prev, [articleId]: false }))
    }
  }

  async function deleteScore(articleId: string, platform: Platform) {
    if (!confirm(`确认删除「${platformLabel(platform)}」的评分？`)) return
    try {
      await fetch(`/api/scores/${articleId}/${platform}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      toast.success('已删除')
      await fetchAll()
    } catch {
      toast.error('删除失败')
    }
  }

  // 手动添加的文章（custom_ 前缀，不在 articles 列表里）
  const customArticleIds = Object.keys(scores).filter(id => id.startsWith('custom_'))
  const customArticles = customArticleIds.map(id => ({
    id,
    title: scores[id]?.[0]?.title || id,
    articleScores: scores[id] || [],
  }))

  // 统计
  const allScoresList = Object.values(scores).flat()
  const scoredCount = [...articles.filter(a => scores[a.id]?.length), ...customArticles].length
  const goodCount   = allScoresList.filter(s => (s.composite ?? 0) >= 70).length
  const badCount    = allScoresList.filter(s => (s.composite ?? 0) <= 30).length

  return (
    <div className="asp-root">

      <PageHeader
        title="文章评分"
        icon={<BarChart2 size={17} />}
        onBack={() => navigate('/')}
        actions={<button className="asp-btn-add" onClick={() => setShowAddModal(true)}>
          <Plus size={14} />
          手动添加文章
        </button>}
      />

      <div className="asp-body">

        {/* ── 说明卡片 ── */}
        <div className="asp-hero">
          <div className="asp-hero-text">
            <h1 className="asp-hero-h1">文章表现评分</h1>
            <p className="asp-hero-desc">
              输入公众号、今日头条或小红书的真实数据，系统自动计算综合评分。
              生成新文章时，<strong>优秀文章（≥70分）</strong>和<strong>低表现文章（≤30分）</strong>会作为示例注入 prompt，帮助 AI 学习成功模式、规避失败模式。
            </p>
          </div>
          <div className="asp-stats-row">
            <div className="asp-stat-card asp-stat-card--teal">
              <div className="asp-stat-num">{scoredCount}</div>
              <div className="asp-stat-label">已评分文章</div>
            </div>
            <div className="asp-stat-card asp-stat-card--green">
              <TrendingUp size={16} />
              <div className="asp-stat-num">{goodCount}</div>
              <div className="asp-stat-label">优秀示例</div>
            </div>
            <div className="asp-stat-card asp-stat-card--pink">
              <TrendingDown size={16} />
              <div className="asp-stat-num">{badCount}</div>
              <div className="asp-stat-label">待改进示例</div>
            </div>
          </div>
        </div>

        {/* ── 评分说明 ── */}
        <div className="asp-notice">
          <strong>综合评分算法：</strong>浏览量（40%，基准 1w）+ 点赞（30%，基准 500）+ 转发（20%，基准 200）+ 评论（10%，基准 100）。
          也可手动填写综合评分（0-100）覆盖自动计算。<strong>没有评分的文章不会注入 prompt。</strong>
        </div>

        {/* ── 手动添加的文章 ── */}
        {customArticles.length > 0 && (
          <section className="asp-section">
            <div className="asp-section-header">
              <div className="asp-section-label">手动录入文章（{customArticles.length} 篇）</div>
              <span className="asp-section-tip">这些文章不在编辑器文章列表中，仅用于评分参考</span>
            </div>
            <div className="asp-list">
              {customArticles.map(({ id, title, articleScores }) => (
                <ArticleCard
                  key={id}
                  articleId={id}
                  title={title}
                  articleScores={articleScores}
                  isExpanded={!!expanded[id]}
                  editState={editing[id]}
                  isSaving={!!saving[id]}
                  onToggle={() => toggleExpand(id)}
                  onStartEdit={(platform, existing) => startEdit(id, platform, existing)}
                  onCancelEdit={() => cancelEdit(id)}
                  onPlatformChange={p => changePlatform(id, p)}
                  onFieldChange={(field, value) => updateForm(id, field, value)}
                  onSave={() => saveScore(id, title)}
                  onDelete={platform => deleteScore(id, platform)}
                  badge={<span className="asp-badge asp-badge--custom">手动录入</span>}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── 已生成文章 ── */}
        <section className="asp-section">
          <div className="asp-section-header">
            <div className="asp-section-label">已生成文章（{articles.length} 篇）</div>
          </div>

          {loading ? (
            <div className="asp-loading">加载中...</div>
          ) : articles.length === 0 ? (
            <div className="asp-empty">暂无已生成的文章，请先在编辑器中生成文章</div>
          ) : (
            <div className="asp-list">
              {articles.map(article => (
                <ArticleCard
                  key={article.id}
                  articleId={article.id}
                  title={article.title}
                  articleScores={scores[article.id] || []}
                  isExpanded={!!expanded[article.id]}
                  editState={editing[article.id]}
                  isSaving={!!saving[article.id]}
                  onToggle={() => toggleExpand(article.id)}
                  onStartEdit={(platform, existing) => startEdit(article.id, platform, existing)}
                  onCancelEdit={() => cancelEdit(article.id)}
                  onPlatformChange={p => changePlatform(article.id, p)}
                  onFieldChange={(field, value) => updateForm(article.id, field, value)}
                  onSave={() => saveScore(article.id, article.title)}
                  onDelete={platform => deleteScore(article.id, platform)}
                  badge={<span className="asp-article-id">{article.id}</span>}
                />
              ))}
            </div>
          )}
        </section>

      </div>

      {/* ── 手动添加 Modal ── */}
      {showAddModal && (
        <AddArticleModal
          onClose={() => setShowAddModal(false)}
          onSaved={fetchAll}
        />
      )}
    </div>
  )
}
