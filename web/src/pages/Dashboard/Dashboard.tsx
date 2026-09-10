import { useState, useEffect, useRef } from 'react'
import { Plus, Calendar, FileText, Trash2, ArrowRight, RefreshCw, Zap, Server, HardDrive, AlertTriangle, Upload, Search, MessageCircle, Newspaper, BookOpen, X } from 'lucide-react'
import { fetchArticleList, fetchArticleWorkflowMetrics, deleteArticle } from '../../utils/apiHelpers'
import { showConfirm, toast } from '../../components/Toast/Toast'
import './Dashboard.css'
import type { PublishPlatform } from '../../utils/articleNavigation'

// ── 本地文章（localStorage）工具 ─────────────────────────────────────────────
const LOCAL_ARTICLES_KEY = 'local_articles'

function loadLocalArticles(): Article[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_ARTICLES_KEY) || '[]')
  } catch {
    return []
  }
}

function saveLocalArticles(articles: Article[]) {
  localStorage.setItem(LOCAL_ARTICLES_KEY, JSON.stringify(articles))
}

function deleteLocalArticle(articleId: string) {
  const articles = loadLocalArticles().filter(a => a.id !== articleId)
  saveLocalArticles(articles)
}

function addLocalArticle(article: Article) {
  const articles = loadLocalArticles()
  // 不重复添加
  if (!articles.find(a => a.id === article.id)) {
    articles.unshift(article)
    saveLocalArticles(articles)
  }
}

interface Article {
  id: string
  date: string
  title: string
  status: 'brief' | 'materials' | 'drafting' | 'review' | 'ready' | 'wechat_draft' | 'draft' | 'generated' | 'published'
  createdAt: string
}

interface DashboardProps {
  onCreateArticle: (articleId: string) => void
  onEditArticle?: (articleId: string) => void
  onPublishArticle: (articleId: string, platform: PublishPlatform) => void
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  brief:         { label: '补充任务', className: 'status-draft' },
  materials:     { label: '收集素材', className: 'status-draft' },
  drafting:      { label: '待写作', className: 'status-draft' },
  review:        { label: '待审核', className: 'status-generated' },
  ready:         { label: '待发布', className: 'status-generated' },
  wechat_draft:  { label: '微信草稿', className: 'status-published' },
  draft:         { label: '草稿', className: 'status-draft' },
  generated:     { label: '待审核', className: 'status-generated' },
  published:     { label: '已发布', className: 'status-published' },
}

// 存储位置类型
type StorageMode = 'server' | 'local'

// 本地文章迁移到服务端
async function migrateLocalToServer(articles: Article[]): Promise<{ ok: number; fail: number }> {
  let ok = 0, fail = 0
  for (const a of articles) {
    try {
      const raw = localStorage.getItem(`local_article_data_${a.id}`)
      if (!raw) continue
      const data = JSON.parse(raw)
      const token = localStorage.getItem('auth_token')
      // 用真实 articleId（去掉 local: 前缀）创建
      const serverId = a.id.replace(/^local:/, '')
      await fetch(`/api/articles/${serverId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      })
      // 删除本地数据
      localStorage.removeItem(`local_article_data_${a.id}`)
      ok++
    } catch {
      fail++
    }
  }
  // 清理本地文章列表
  const remaining = loadLocalArticles().filter(a => !articles.find(b => b.id === a.id) || fail > 0)
  saveLocalArticles(remaining)
  return { ok, fail }
}

export default function Dashboard({ onCreateArticle, onEditArticle, onPublishArticle }: DashboardProps) {
  const [articles, setArticles] = useState<Article[]>([])
  const [localArticles, setLocalArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0])
  const [creating, setCreating] = useState(false)
  const [storageMode, setStorageMode] = useState<StorageMode>('server')
  const [migrating, setMigrating] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'writing' | 'review' | 'ready' | 'done'>('all')
  const [loadError, setLoadError] = useState(false)
  const [workflowMetrics, setWorkflowMetrics] = useState<{ sampleSize: number; medianMinutes: number | null }>({ sampleSize: 0, medianMinutes: null })
  const titleRef = useRef<HTMLInputElement>(null)

  async function loadArticles() {
    try {
      setLoading(true)
      setLoadError(false)
      // Metrics are supplementary; their latency must not block the user's article list.
      void fetchArticleWorkflowMetrics().then(setWorkflowMetrics).catch(() => {})
      setArticles(await fetchArticleList())
    } catch (e) {
      console.error('加载文章失败', e)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadArticles()
    setLocalArticles(loadLocalArticles())
  }, [])

  const handleMigrateLocal = async () => {
    if (localArticles.length === 0) return
    setMigrating(true)
    try {
      const { ok, fail } = await migrateLocalToServer(localArticles)
      setLocalArticles(loadLocalArticles())
      await loadArticles()
      if (fail === 0) toast.success(`成功迁移 ${ok} 篇文章到服务端`)
      else toast.warn(`迁移完成：${ok} 篇成功，${fail} 篇失败`)
    } catch {
      toast.error('迁移失败，请重试')
    } finally {
      setMigrating(false)
    }
  }

  const handleCreate = () => {
    if (creating) return
    if (!newDate) {
      toast.warn('请选择文章日期')
      return
    }
    const dateStr = newDate.replace(/-/g, '')
    const title = titleRef.current?.value.trim() || ''
    const slug = title ? title.replace(/[^\w\u4e00-\u9fff]/g, '').substring(0, 20) : ''
    const articleId = slug ? `${dateStr}-${slug}` : `${dateStr}-${Date.now()}`

    if (storageMode === 'local') {
      // 本地存储：articleId 加 local: 前缀
      const localId = `local:${articleId}`
      const newArticle: Article = {
        id: localId,
        date: dateStr,
        title: title || `文章 ${dateStr}`,
        status: 'draft',
        createdAt: new Date().toISOString(),
      }
      addLocalArticle(newArticle)
      setLocalArticles(loadLocalArticles())
      setCreating(true)
      onCreateArticle(localId)
    } else {
      if (title) {
        localStorage.setItem(`article_title_${articleId}`, title)
      }
      setCreating(true)
      onCreateArticle(articleId)
    }
  }

  const handleDelete = (articleId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const isLocal = articleId.startsWith('local:')
    showConfirm({
      message: '确定删除这篇文章？',
      detail: '删除后无法恢复。',
      confirmText: '删除',
      danger: true,
      onConfirm: async () => {
        try {
          if (isLocal) {
            deleteLocalArticle(articleId)
            setLocalArticles(loadLocalArticles())
          } else {
            await deleteArticle(articleId)
            loadArticles()
          }
        } catch (err) {
          console.error('删除失败', err)
        }
      },
    })
  }

  // 合并列表（服务端在前，本地在后，并标记来源）
  const allArticles = [
    ...articles.map(a => ({ ...a, _local: false })),
    ...localArticles.map(a => ({ ...a, _local: true })),
  ]
  const filters = [
    { id: 'all', label: '全部', statuses: null },
    { id: 'writing', label: '写作中', statuses: ['brief', 'materials', 'drafting', 'draft'] },
    { id: 'review', label: '待审核', statuses: ['review', 'generated'] },
    { id: 'ready', label: '待推送', statuses: ['ready'] },
    { id: 'done', label: '已推送 / 发布', statuses: ['wechat_draft', 'published'] },
  ] as const
  const matchesFilter = (article: Article, id: typeof filter) => {
    const statuses: readonly string[] | null = filters.find(item => item.id === id)?.statuses || null
    return !statuses || statuses.includes(article.status)
  }
  const visibleArticles = allArticles.filter(article =>
    matchesFilter(article, filter) && `${article.title} ${article.date}`.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const resumeArticle = allArticles.find(article => article.status === 'ready')
    || allArticles.find(article => ['review', 'generated'].includes(article.status))
    || allArticles.find(article => !['wechat_draft', 'published'].includes(article.status))
  const stats = {
    total: allArticles.length,
    generated: allArticles.filter(a => ['review', 'ready', 'wechat_draft', 'generated', 'published'].includes(a.status)).length,
    draft: allArticles.filter(a => ['brief', 'materials', 'drafting', 'draft'].includes(a.status)).length,
  }

  function renderArticleList(list: typeof allArticles, empty: string) {
    if (list.length === 0) return (
      <div className="dash-empty">
        <div className="dash-empty-icon"><FileText size={32} /></div>
        <p>{empty}</p>
        {(query || filter !== 'all') && <button className="dash-text-btn" onClick={() => { setQuery(''); setFilter('all') }}>清除筛选</button>}
      </div>
    )
    return (
      <ul className="dash-article-list">
        {list.map(article => {
          const meta = STATUS_META[article.status] || STATUS_META.draft
          // 格式化日期：从 date 字段 "20260512" 转为 "05-12"
          const dateStr = article.date
            ? `${article.date.slice(4, 6)}-${article.date.slice(6, 8)}`
            : ''
          return (
            <li
              key={article.id}
              className="dash-article-item"
            >
              <button className="dash-article-left" onClick={() => onEditArticle?.(article.id)} aria-label={`继续编辑：${article.title || '未命名文章'}`}>
                <div className="dash-article-dot" data-status={article.status} />
                <div>
                  <p className="dash-article-title">
                    {article.title || '未命名文章'}
                  </p>
                  <div className="dash-article-meta">
                    <span className={`dash-status-tag ${meta.className}`}>
                      {meta.label}
                    </span>
                    {dateStr && (
                      <span className="dash-meta-date">{dateStr}</span>
                    )}
                    {article._local && (
                      <span className="dash-local-tag">
                        <HardDrive size={10} />本地
                      </span>
                    )}
                  </div>
                </div>
              </button>
              <div className="dash-article-right">
                {['review', 'ready', 'wechat_draft', 'generated', 'published'].includes(article.status) && (
                  <div className="dash-platform-actions">
                    <button title="公众号预览与推送" aria-label={`公众号：${article.title}`} onClick={() => onPublishArticle(article.id, 'wechat')}><MessageCircle size={16} /></button>
                    <button title="今日头条预览与发布" aria-label={`今日头条：${article.title}`} onClick={() => onPublishArticle(article.id, 'toutiao')}><Newspaper size={16} /></button>
                    <button title="小红书预览与发布" aria-label={`小红书：${article.title}`} onClick={() => onPublishArticle(article.id, 'xiaohongshu')}><BookOpen size={16} /></button>
                  </div>
                )}
                <button
                  className="dash-delete-btn"
                  onClick={e => handleDelete(article.id, e)}
                  title="删除"
                  aria-label={`删除：${article.title}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="dash-root">
      {/* ── 左栏：创建 + 统计 ─────────────────────────── */}
      <aside className="dash-sidebar">
        {/* 统计数字 */}
        <div className="dash-stats">
          <div className="dash-stat">
            <span className="dash-stat-num">{loadError ? '—' : stats.total}</span>
            <span className="dash-stat-label">篇文章</span>
          </div>
          <div className="dash-stat-divider" />
          <div className="dash-stat">
            <span className="dash-stat-num dash-stat-num--green">{stats.generated}</span>
            <span className="dash-stat-label">已生成</span>
          </div>
          <div className="dash-stat-divider" />
          <div className="dash-stat">
            <span className="dash-stat-num">{stats.draft}</span>
            <span className="dash-stat-label">草稿</span>
          </div>
          <div className="dash-stat-divider" />
          <div className="dash-stat" title={`已统计 ${workflowMetrics.sampleSize} 篇推送到微信草稿的文章`}>
            <span className="dash-stat-num">
              {workflowMetrics.medianMinutes === null ? '—' : workflowMetrics.medianMinutes < 60
                ? workflowMetrics.medianMinutes
                : (workflowMetrics.medianMinutes / 60).toFixed(1)}
            </span>
            <span className="dash-stat-label">
              {workflowMetrics.medianMinutes === null ? '暂无耗时样本' : workflowMetrics.medianMinutes < 60 ? '分钟 / 微信草稿' : '小时 / 微信草稿'}
            </span>
          </div>
        </div>

        {/* 创建卡片 */}
        <div className="dash-create-card">
          <div className="dash-create-header">
            <div className="dash-create-icon">
              <Plus size={18} />
            </div>
            <h2>新建文章</h2>
          </div>

          {/* 存储位置选择 */}
          <div className="dash-storage-toggle">
            <button
              className={`dash-storage-btn ${storageMode === 'server' ? 'active' : ''}`}
              onClick={() => setStorageMode('server')}
            >
              <Server size={12} />
              存服务端
            </button>
            <button
              className={`dash-storage-btn ${storageMode === 'local' ? 'active' : ''}`}
              onClick={() => setStorageMode('local')}
            >
              <HardDrive size={12} />
              存本地
            </button>
          </div>

          <div className="dash-create-fields">
            <div className="dash-field">
              <label htmlFor="article-date">
                <Calendar size={12} />
                日期
              </label>
              <input
                type="date"
                id="article-date"
                className="dash-input"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
              />
            </div>
            <div className="dash-field">
              <label htmlFor="article-title">
                <FileText size={12} />
                标题
                <span className="dash-optional">可选</span>
              </label>
              <input
                ref={titleRef}
                id="article-title"
                type="text"
                className="dash-input"
                placeholder="留空则自动用日期命名"
                onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
              />
            </div>
          </div>

          <button
            className="dash-create-btn"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? (
              <>
                <RefreshCw size={16} className="dash-spin" />
                创建中...
              </>
            ) : (
              <>
                <Zap size={16} />
                开始写作
                <ArrowRight size={15} className="dash-arrow" />
              </>
            )}
          </button>

          {storageMode === 'local' && <p className="dash-create-hint">数据仅存此浏览器，清除缓存后会丢失。</p>}
        </div>
      </aside>

      {/* ── 右栏：文章列表 ───────────────────────────── */}
      <main className="dash-main">
        <div className="dash-workspace-heading">
          <h1>创作工作台</h1>
          <button className="dash-text-btn" onClick={() => titleRef.current?.focus()}><Plus size={16} />新建文章</button>
        </div>
        {!loading && !loadError && resumeArticle && (
          <section className="dash-resume" aria-label="继续创作">
            <div><span>{STATUS_META[resumeArticle.status]?.label || '继续创作'}</span><h2>{resumeArticle.title || '未命名文章'}</h2></div>
            <button onClick={() => onEditArticle?.(resumeArticle.id)}>继续处理<ArrowRight size={16} /></button>
          </section>
        )}
        {/* 本地存储警告横幅 */}
        {localArticles.length > 0 && (
          <div className="dash-local-warning">
            <AlertTriangle size={13} />
            <span>
              有 <strong>{localArticles.length}</strong> 篇文章仅存在本地浏览器，清除缓存或换设备后会丢失
            </span>
            <button
              className="dash-migrate-btn"
              onClick={handleMigrateLocal}
              disabled={migrating}
            >
              <Upload size={11} />
              {migrating ? '迁移中...' : '迁移到服务端'}
            </button>
          </div>
        )}

        <div className="dash-list-header">
          <h3>文章列表</h3>
          <label className="dash-search">
            <Search size={16} />
            <input aria-label="搜索文章" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题或日期" />
            {query && <button title="清除搜索" aria-label="清除搜索" onClick={() => setQuery('')}><X size={14} /></button>}
          </label>
          <button
            className="dash-refresh-btn"
            onClick={loadArticles}
            disabled={loading}
            title="刷新"
          >
            <RefreshCw size={15} className={loading ? 'dash-spin' : ''} />
          </button>
        </div>
        <div className="dash-filters" role="group" aria-label="文章进度筛选">
          {filters.map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
            {item.label}<span>{allArticles.filter(article => matchesFilter(article, item.id)).length}</span>
          </button>)}
        </div>

        {loadError ? (
          <div className="dash-empty" role="alert"><AlertTriangle size={24} /><p>文章列表加载失败</p><button className="dash-text-btn" onClick={() => void loadArticles()}>重新加载</button></div>
        ) : loading ? (
          <div className="dash-loading">
            <RefreshCw size={20} className="dash-spin" />
            <span>加载中...</span>
          </div>
        ) : (
          renderArticleList(visibleArticles, allArticles.length ? '没有匹配的文章' : '还没有文章')
        )}
      </main>
    </div>
  )
}
