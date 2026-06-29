import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { login } from '../../store/useAuth'
import './LoginPage.css'

export default function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) return
    setLoading(true)
    setError('')
    try {
      await login(username.trim(), password)
      navigate('/', { replace: true })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (err instanceof Error ? err.message : '登录失败，请重试')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-root">
      {/* 左侧品牌区 */}
      <div className="auth-brand">
        <div className="auth-brand-top">
          <div className="auth-brand-logo">D</div>
          <span className="auth-brand-name">Dashy</span>
        </div>

        <div className="auth-brand-body">
          <h1 className="auth-brand-title">公众号/头条写作，<br />交给 AI</h1>
          <p className="auth-brand-desc">从选题到成文，一站式 AI 辅助写作工具，帮你高效产出有质感的内容。</p>
          <div className="auth-brand-pills">
            <span className="auth-brand-pill">AI 生成</span>
            <span className="auth-brand-pill">文章排版</span>
            <span className="auth-brand-pill">草稿管理</span>
            <span className="auth-brand-pill">多账号协作</span>
          </div>
        </div>

        <div className="auth-brand-footer">© 2025 Dashy · 公众号写作助手</div>
      </div>

      {/* 右侧表单区 */}
      <div className="auth-panel">
        <div className="auth-card">
          <div className="auth-card-head">
            <h2>欢迎回来</h2>
            <p>登录你的 Dashy 账号，继续创作</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {error && <div className="auth-error">{error}</div>}

            <div className="auth-field">
              <label htmlFor="username">用户名</label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="请输入用户名"
                required
              />
            </div>

            <div className="auth-field">
              <label htmlFor="password">密码</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="请输入密码"
                required
              />
            </div>

            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? '登录中...' : '登录'}
            </button>
          </form>

          <div className="auth-footer">
            没有账号？<Link to="/register">立即注册</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
