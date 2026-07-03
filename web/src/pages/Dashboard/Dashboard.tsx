import { useState, useEffect, useRef } from 'react'
import { Plus, Calendar, FileText, Trash2, ArrowRight, RefreshCw, Zap, Server, HardDrive, AlertTriangle, Upload } from 'lucide-react'
import { fetchArticleList, deleteArticle } from '../../utils'
import { showConfirm, toast } from '../../components/Toast/Toast'
import './Dashboard.css'

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
  status: 'draft' | 'generated' | 'published'
  createdAt: string
}

interface DashboardProps {
  onCreateArticle: (articleId: string) => void
  onEditArticle?: (articleId: string) => void
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  draft:     { label: '草稿',  className: 'status-draft' },
  generated: { label: '已生成', className: 'status-generated' },
  published: { label: '已发布', className: 'status-published' },
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

export default function Dashboard({ onCreateArticle, onEditArticle }: DashboardProps) {
  const [articles, setArticles] = useState<Article[]>([])
  const [localArticles, setLocalArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0])
  const [creating, setCreating] = useState(false)
  const [storageMode, setStorageMode] = useState<StorageMode>('server')
  const [migrating, setMigrating] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  async function loadArticles() {
    try {
      setLoading(true)
      setArticles(await fetchArticleList())
    } catch (e) {
      console.error('加载文章失败', e)
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

  const stats = {
    total: articles.length,
    generated: articles.filter(a => a.status === 'generated' || a.status === 'published').length,
    draft: articles.filter(a => a.status === 'draft').length,
  }

  // 合并列表（服务端在前，本地在后，并标记来源）
  const allArticles = [
    ...articles.map(a => ({ ...a, _local: false })),
    ...localArticles.map(a => ({ ...a, _local: true })),
  ]

  function renderArticleList(list: typeof allArticles, empty: string) {
    if (list.length === 0) return (
      <div className="dash-empty">
        <div className="dash-empty-icon"><FileText size={32} /></div>
        <p>{empty}</p>
        <span>从左边创建第一篇开始</span>
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
              onClick={() => onEditArticle?.(article.id)}
            >
              <div className="dash-article-left">
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
              </div>
              <div className="dash-article-right">
                <ArrowRight size={15} className="dash-article-arrow" />
                <button
                  className="dash-delete-btn"
                  onClick={e => handleDelete(article.id, e)}
                  title="删除"
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
            <span className="dash-stat-num">{stats.total}</span>
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
              <label>
                <Calendar size={12} />
                日期
              </label>
              <input
                type="date"
                className="dash-input"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
              />
            </div>
            <div className="dash-field">
              <label>
                <FileText size={12} />
                标题
                <span className="dash-optional">可选</span>
              </label>
              <input
                ref={titleRef}
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

          <p className="dash-create-hint">
            {storageMode === 'local'
              ? '本地模式：数据仅存浏览器，换设备后不可见'
              : '创建后进入编辑器，填写任务要求和素材，一键生成文章'}
          </p>
        </div>
      </aside>

      {/* ── 右栏：文章列表 ───────────────────────────── */}
      <main className="dash-main">
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
          <button
            className="dash-refresh-btn"
            onClick={loadArticles}
            disabled={loading}
            title="刷新"
          >
            <RefreshCw size={15} className={loading ? 'dash-spin' : ''} />
          </button>
        </div>

        {loading ? (
          <div className="dash-loading">
            <RefreshCw size={20} className="dash-spin" />
            <span>加载中...</span>
          </div>
        ) : (
          renderArticleList(allArticles, '还没有文章')
        )}
      </main>
    </div>
  )
}
