import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { register } from '../../store/useAuth'
import '../LoginPage/LoginPage.css'

export default function RegisterPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) return
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setLoading(true)
    setError('')
    try {
      await register(username.trim(), password)
      navigate('/', { replace: true })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (err instanceof Error ? err.message : '注册失败，请重试')
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
          <h1 className="auth-brand-title">开始你的<br />创作之旅</h1>
          <p className="auth-brand-desc">注册账号，解锁 AI 写作全部功能，第一篇文章只需 5 分钟。</p>
          <div className="auth-brand-pills">
            <span className="auth-brand-pill">免费使用</span>
            <span className="auth-brand-pill">无限草稿</span>
            <span className="auth-brand-pill">AI 润色</span>
            <span className="auth-brand-pill">一键排版</span>
          </div>
        </div>

        <div className="auth-brand-footer">© 2025 Dashy · 公众号写作助手</div>
      </div>

      {/* 右侧表单区 */}
      <div className="auth-panel">
        <div className="auth-card">
          <div className="auth-card-head">
            <h2>创建账号</h2>
            <p>填写以下信息，加入 Dashy</p>
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
                placeholder="3–20 个字符，字母 / 数字 / 下划线"
                required
              />
            </div>

            <div className="auth-field">
              <label htmlFor="password">密码</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="至少 6 个字符"
                required
              />
            </div>

            <div className="auth-field">
              <label htmlFor="confirm">确认密码</label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="再次输入密码"
                required
              />
            </div>

            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? '注册中...' : '注册'}
            </button>
          </form>

          <div className="auth-footer">
            已有账号？<Link to="/login">立即登录</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
