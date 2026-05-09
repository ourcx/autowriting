import { useState, useEffect, useRef } from 'react'
import { Plus, Calendar, FileText, Trash2, ArrowRight, RefreshCw, Zap } from 'lucide-react'
import { fetchArticleList, deleteArticle } from '../utils/apiHelpers'
import { showConfirm } from '../components/Toast'
import './Dashboard.css'

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

export default function Dashboard({ onCreateArticle, onEditArticle }: DashboardProps) {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0])
  const [creating, setCreating] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadArticles() }, [])

  const loadArticles = async () => {
    try {
      setLoading(true)
      setArticles(await fetchArticleList())
    } catch (e) {
      console.error('加载文章失败', e)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    const dateStr = newDate.replace(/-/g, '')
    const title = titleRef.current?.value.trim() || ''
    let articleId = dateStr

    if (title) {
      const slug = title.replace(/[^\w\u4e00-\u9fff]/g, '').substring(0, 20)
      articleId = `${dateStr}-${slug}`
      localStorage.setItem(`article_title_${articleId}`, title)
    } else {
      articleId = `${dateStr}-${Date.now()}`
    }

    setCreating(true)
    onCreateArticle(articleId)
  }

  const handleDelete = (articleId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    showConfirm({
      message: '确定删除这篇文章？',
      detail: '删除后无法恢复。',
      confirmText: '删除',
      danger: true,
      onConfirm: async () => {
        try {
          await deleteArticle(articleId)
          loadArticles()
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
            创建后进入编辑器，填写任务要求和素材，一键生成文章
          </p>
        </div>
      </aside>

      {/* ── 右栏：文章列表 ───────────────────────────── */}
      <main className="dash-main">
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
        ) : articles.length === 0 ? (
          <div className="dash-empty">
            <div className="dash-empty-icon">
              <FileText size={32} />
            </div>
            <p>还没有文章</p>
            <span>从左边创建第一篇开始</span>
          </div>
        ) : (
          <ul className="dash-article-list">
            {articles.map(article => {
              const meta = STATUS_META[article.status] || STATUS_META.draft
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
        )}
      </main>
    </div>
  )
}
