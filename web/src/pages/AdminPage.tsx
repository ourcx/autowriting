import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../store/useAuth'
import './AdminPage.css'

interface UserRow {
  id: string
  username: string
  role: 'admin' | 'user'
  disabled: boolean
  created_at: string
  articleCount: number
}

interface ArticleItem {
  id: string
  title: string
  date: string
  status: string
}

export default function AdminPage() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [articlesModal, setArticlesModal] = useState<{ user: UserRow; articles: ArticleItem[] } | null>(null)
  const [articlesLoading, setArticlesLoading] = useState(false)

  useEffect(() => {
    fetchUsers()
  }, [])

  async function fetchUsers() {
    setLoading(true)
    setError('')
    try {
      const res = await axios.get('/api/admin/users')
      setUsers(res.data)
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function toggleDisable(u: UserRow) {
    try {
      await axios.patch(`/api/admin/users/${u.id}/disable`, { disabled: !u.disabled })
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, disabled: !x.disabled } : x))
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || '操作失败')
    }
  }

  async function openArticles(u: UserRow) {
    setArticlesLoading(true)
    setArticlesModal({ user: u, articles: [] })
    try {
      const res = await axios.get(`/api/admin/users/${u.id}/articles`)
      setArticlesModal({ user: u, articles: res.data })
    } catch {
      setArticlesModal({ user: u, articles: [] })
    } finally {
      setArticlesLoading(false)
    }
  }

  // Derived stats
  const totalUsers = users.length
  const totalArticles = users.reduce((s, u) => s + u.articleCount, 0)
  const activeUsers = users.filter(u => !u.disabled).length

  return (
    <div className="admin-root">
      {/* Top Nav */}
      <nav className="admin-nav">
        <Link to="/" className="admin-nav-brand">
          <div className="admin-nav-logo">D</div>
          <span className="admin-nav-name">Dashy</span>
        </Link>
        <div className="admin-nav-sep" />
        <span className="admin-nav-title">用户管理</span>
        <div className="admin-nav-spacer" />
        <Link to="/" className="admin-nav-back">← 返回创作台</Link>
      </nav>

      {/* Content */}
      <div className="admin-content">
        <div className="admin-page-header">
          <h1>用户管理</h1>
          <p>管理所有账号、查看创作数据、控制账号状态</p>
        </div>

        {/* Stat cards */}
        {!loading && !error && (
          <div className="admin-stats">
            <div className="admin-stat-card card-teal">
              <span className="admin-stat-label">总用户数</span>
              <span className="admin-stat-value">{totalUsers}</span>
            </div>
            <div className="admin-stat-card card-ochre">
              <span className="admin-stat-label">总文章数</span>
              <span className="admin-stat-value">{totalArticles}</span>
            </div>
            <div className="admin-stat-card card-lavender">
              <span className="admin-stat-label">活跃账号</span>
              <span className="admin-stat-value">{activeUsers}</span>
            </div>
          </div>
        )}

        {error && <div className="admin-error-bar">{error}</div>}

        {loading ? (
          <p className="admin-empty">加载中...</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>用户名</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>文章数</th>
                  <th>注册时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="admin-empty">暂无用户</td>
                  </tr>
                ) : users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <span className="admin-username">{u.username}</span>
                    </td>
                    <td>
                      <span className={`badge ${u.role === 'admin' ? 'badge-admin' : 'badge-user'}`}>
                        {u.role === 'admin' ? 'Admin' : '用户'}
                      </span>
                    </td>
                    <td>
                      {u.disabled
                        ? <span className="badge badge-disabled">已禁用</span>
                        : <span className="badge badge-active">正常</span>
                      }
                    </td>
                    <td>
                      {u.articleCount > 0
                        ? <button className="btn-link" onClick={() => openArticles(u)}>{u.articleCount} 篇</button>
                        : <span style={{ color: 'var(--color-muted-soft)' }}>—</span>
                      }
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                      {new Date(u.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td>
                      <button
                        className={`btn-sm ${u.disabled ? 'btn-normal' : 'btn-danger'}`}
                        disabled={u.id === me?.id}
                        onClick={() => toggleDisable(u)}
                        title={u.id === me?.id ? '不能禁用自己' : ''}
                      >
                        {u.disabled ? '启用' : '禁用'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Articles Modal */}
      {articlesModal && (
        <div className="admin-modal-overlay" onClick={() => setArticlesModal(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h2>{articlesModal.user.username} 的文章</h2>
              <button className="admin-modal-close" onClick={() => setArticlesModal(null)}>×</button>
            </div>
            <div className="admin-modal-body">
              {articlesLoading ? (
                <p className="admin-empty">加载中...</p>
              ) : articlesModal.articles.length === 0 ? (
                <p className="admin-empty">该用户暂无文章</p>
              ) : (
                <div className="admin-article-list">
                  {articlesModal.articles.map(a => (
                    <div key={a.id} className="admin-article-item">
                      <div className="title">{a.title}</div>
                      <div className="meta">{a.date} · {a.status === 'generated' ? '已生成' : '草稿'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
