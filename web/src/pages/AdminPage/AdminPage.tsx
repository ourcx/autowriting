import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { useAuth } from '../../store/useAuth'
import { UserPlus, RotateCcw, Trash2, FileText, X, Eye, EyeOff, Activity } from 'lucide-react'
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

type Modal =
  | { type: 'articles'; user: UserRow; articles: ArticleItem[]; loading: boolean }
  | { type: 'create' }
  | { type: 'reset'; user: UserRow }
  | { type: 'delete'; user: UserRow }
  | null

export default function AdminPage() {
   const navigate = useNavigate()
   const { user: me } = useAuth()
   const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<Modal>(null)

  // Create user form
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user')
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState('')

  // Reset password form
  const [resetPwd, setResetPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError, setResetError] = useState('')

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

  useEffect(() => { fetchUsers() }, [])

  async function toggleDisable(u: UserRow) {
    try {
      await axios.patch(`/api/admin/users/${u.id}/disable`, { disabled: !u.disabled })
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, disabled: !x.disabled } : x))
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || '操作失败')
    }
  }

  async function openArticles(u: UserRow) {
    setModal({ type: 'articles', user: u, articles: [], loading: true })
    try {
      const res = await axios.get(`/api/admin/users/${u.id}/articles`)
      setModal(m => m?.type === 'articles' ? { ...m, articles: res.data, loading: false } : m)
    } catch {
      setModal(m => m?.type === 'articles' ? { ...m, loading: false } : m)
    }
  }

  function openCreate() {
    setNewUsername(''); setNewPassword(''); setNewRole('user')
    setCreateError('')
    setModal({ type: 'create' })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateLoading(true); setCreateError('')
    try {
      const res = await axios.post('/api/admin/users', {
        username: newUsername.trim(), password: newPassword, role: newRole,
      })
      setUsers(prev => [...prev, { ...res.data, disabled: false, created_at: new Date().toISOString(), articleCount: 0 }])
      setModal(null)
    } catch (err: unknown) {
      setCreateError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || '创建失败')
    } finally {
      setCreateLoading(false)
    }
  }

  function openReset(u: UserRow) {
    setResetPwd(''); setShowPwd(false); setResetError('')
    setModal({ type: 'reset', user: u })
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    if (modal?.type !== 'reset') return
    setResetLoading(true); setResetError('')
    try {
      await axios.patch(`/api/admin/users/${modal.user.id}/reset-password`, { password: resetPwd })
      setModal(null)
    } catch (err: unknown) {
      setResetError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || '重置失败')
    } finally {
      setResetLoading(false)
    }
  }

  async function handleDelete() {
    if (modal?.type !== 'delete') return
    try {
      await axios.delete(`/api/admin/users/${modal.user.id}`)
      setUsers(prev => prev.filter(u => u.id !== modal.user.id))
      setModal(null)
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || '删除失败')
    }
  }

  const totalUsers   = users.length
  const totalArticles = users.reduce((s, u) => s + u.articleCount, 0)
  const activeUsers  = users.filter(u => !u.disabled).length

  return (
    <div className="admin-root">
      {/* ── Top Nav ── */}
      <nav className="admin-nav">
        <Link to="/" className="admin-nav-brand">
          <div className="admin-nav-logo">D</div>
          <span className="admin-nav-name">Dashy</span>
        </Link>
        <div className="admin-nav-sep" />
        <span className="admin-nav-title">用户管理</span>
        <div className="admin-nav-spacer" />
        <button className="wd-back-btn" onClick={() => navigate('/')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-left"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg>
          返回
        </button>
      </nav>

      {/* ── Content ── */}
      <div className="admin-content">
        <div className="admin-page-header">
          <div>
            <h1>用户管理</h1>
            <p>管理账号、查看创作数据、控制账号状态</p>
          </div>
          <div className="admin-header-actions">
            <Link to="/monitoring" className="admin-create-btn">
              <Activity size={15} />
              系统监控
            </Link>
            <button className="admin-create-btn" onClick={openCreate}>
              <UserPlus size={15} />
              新建用户
            </button>
          </div>
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
                  <tr><td colSpan={6} className="admin-empty">暂无用户</td></tr>
                ) : users.map(u => (
                  <tr key={u.id}>
                    <td><span className="admin-username">{u.username}</span></td>
                    <td>
                      <span className={`badge ${u.role === 'admin' ? 'badge-admin' : 'badge-user'}`}>
                        {u.role === 'admin' ? 'Admin' : '用户'}
                      </span>
                    </td>
                    <td>
                      {u.disabled
                        ? <span className="badge badge-disabled">已禁用</span>
                        : <span className="badge badge-active">正常</span>}
                    </td>
                    <td>
                      {u.articleCount > 0
                        ? <button className="btn-link" onClick={() => openArticles(u)}>{u.articleCount} 篇</button>
                        : <span style={{ color: 'var(--color-muted-soft)' }}>—</span>}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                      {new Date(u.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td>
                      <div className="admin-actions">
                        {/* 禁用/启用 */}
                        <button
                          className={`btn-sm ${u.disabled ? 'btn-normal' : 'btn-warn'}`}
                          disabled={u.id === me?.id}
                          onClick={() => toggleDisable(u)}
                          title={u.id === me?.id ? '不能禁用自己' : u.disabled ? '启用账号' : '禁用账号'}
                        >
                          {u.disabled ? '启用' : '禁用'}
                        </button>

                        {/* 重置密码 */}
                        <button
                          className="btn-icon"
                          onClick={() => openReset(u)}
                          title="重置密码"
                        >
                          <RotateCcw size={13} />
                        </button>

                        {/* 删除 */}
                        <button
                          className="btn-icon btn-icon--danger"
                          disabled={u.id === me?.id}
                          onClick={() => setModal({ type: 'delete', user: u })}
                          title={u.id === me?.id ? '不能删除自己' : '删除用户'}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ════════════ Modals ════════════ */}

      {/* Articles modal */}
      {modal?.type === 'articles' && (
        <div className="admin-modal-overlay" onClick={() => setModal(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-modal-header-left">
                <FileText size={15} />
                <h2>{modal.user.username} 的文章</h2>
              </div>
              <button className="admin-modal-close" onClick={() => setModal(null)}><X size={14} /></button>
            </div>
            <div className="admin-modal-body">
              {modal.loading ? (
                <p className="admin-empty">加载中...</p>
              ) : modal.articles.length === 0 ? (
                <p className="admin-empty">该用户暂无文章</p>
              ) : (
                <div className="admin-article-list">
                  {modal.articles.map(a => (
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

      {/* Create user modal */}
      {modal?.type === 'create' && (
        <div className="admin-modal-overlay" onClick={() => setModal(null)}>
          <div className="admin-modal admin-modal--form" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-modal-header-left">
                <UserPlus size={15} />
                <h2>新建用户</h2>
              </div>
              <button className="admin-modal-close" onClick={() => setModal(null)}><X size={14} /></button>
            </div>
            <div className="admin-modal-body">
              <form className="admin-form" onSubmit={handleCreate}>
                {createError && <div className="admin-form-error">{createError}</div>}

                <div className="admin-form-field">
                  <label>用户名</label>
                  <input
                    type="text"
                    placeholder="3-20 个字符"
                    value={newUsername}
                    onChange={e => setNewUsername(e.target.value)}
                    required
                    autoFocus
                  />
                </div>

                <div className="admin-form-field">
                  <label>初始密码</label>
                  <input
                    type="password"
                    placeholder="至少 6 位"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    required
                  />
                </div>

                <div className="admin-form-field">
                  <label>角色</label>
                  <div className="admin-role-tabs">
                    <button
                      type="button"
                      className={`admin-role-tab ${newRole === 'user' ? 'active' : ''}`}
                      onClick={() => setNewRole('user')}
                    >普通用户</button>
                    <button
                      type="button"
                      className={`admin-role-tab ${newRole === 'admin' ? 'active' : ''}`}
                      onClick={() => setNewRole('admin')}
                    >管理员</button>
                  </div>
                </div>

                <div className="admin-form-actions">
                  <button type="button" className="admin-form-cancel" onClick={() => setModal(null)}>取消</button>
                  <button type="submit" className="admin-form-submit" disabled={createLoading}>
                    {createLoading ? '创建中...' : '创建用户'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Reset password modal */}
      {modal?.type === 'reset' && (
        <div className="admin-modal-overlay" onClick={() => setModal(null)}>
          <div className="admin-modal admin-modal--form" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-modal-header-left">
                <RotateCcw size={15} />
                <h2>重置密码 · {modal.user.username}</h2>
              </div>
              <button className="admin-modal-close" onClick={() => setModal(null)}><X size={14} /></button>
            </div>
            <div className="admin-modal-body">
              <form className="admin-form" onSubmit={handleReset}>
                {resetError && <div className="admin-form-error">{resetError}</div>}

                <div className="admin-form-field">
                  <label>新密码</label>
                  <div className="admin-pwd-row">
                    <input
                      type={showPwd ? 'text' : 'password'}
                      placeholder="至少 6 位"
                      value={resetPwd}
                      onChange={e => setResetPwd(e.target.value)}
                      required
                      autoFocus
                    />
                    <button type="button" className="admin-pwd-toggle" onClick={() => setShowPwd(v => !v)}>
                      {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div className="admin-form-actions">
                  <button type="button" className="admin-form-cancel" onClick={() => setModal(null)}>取消</button>
                  <button type="submit" className="admin-form-submit" disabled={resetLoading}>
                    {resetLoading ? '重置中...' : '确认重置'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {modal?.type === 'delete' && (
        <div className="admin-modal-overlay" onClick={() => setModal(null)}>
          <div className="admin-modal admin-modal--confirm" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-modal-header-left">
                <Trash2 size={15} />
                <h2>删除用户</h2>
              </div>
              <button className="admin-modal-close" onClick={() => setModal(null)}><X size={14} /></button>
            </div>
            <div className="admin-modal-body">
              <p className="admin-confirm-text">
                确定删除用户 <strong>{modal.user.username}</strong>？
                该操作不可撤销，用户数据将永久移除（服务端文章目录不受影响）。
              </p>
              <div className="admin-form-actions">
                <button className="admin-form-cancel" onClick={() => setModal(null)}>取消</button>
                <button className="admin-form-submit admin-form-submit--danger" onClick={handleDelete}>
                  确认删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
