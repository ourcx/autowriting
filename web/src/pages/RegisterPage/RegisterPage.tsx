import { Input } from "../../components/FormControls/FormControls"
import Button from "../../components/Button/Button"
import { useState, type FormEvent } from "react"
import { useNavigate, Link } from "react-router-dom"
import { register } from "../../store/useAuth"
import "../LoginPage/LoginPage.css"

export default function RegisterPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) return
    if (password !== confirm) {
      setError("两次输入的密码不一致")
      return
    }
    setLoading(true)
    setError("")
    try {
      await register(username.trim(), password)
      navigate("/setup", { replace: true })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (err instanceof Error ? err.message : "注册失败，请重试")
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-root">
      <header className="auth-header">
        <Link className="auth-brand" to="/" aria-label="Dashy 首页">
          <span className="auth-brand-logo" aria-hidden="true">D</span>
          Dashy
        </Link>
      </header>
      <main className="auth-panel">
        <h1>创建 Dashy 账号</h1>
        <p className="auth-intro">注册后，连接 AI 服务就可以开始写作。</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="auth-error" role="alert">{error}</div>}

          <div className="auth-field">
            <label htmlFor="username">用户名</label>
            <Input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              aria-describedby="username-hint"
              required
            />
            <small id="username-hint">2–32 个字符，可用汉字、字母、数字、下划线或连字符</small>
          </div>

          <div className="auth-field">
            <label htmlFor="password">密码</label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              aria-describedby="password-hint"
              required
            />
            <small id="password-hint">至少 6 个字符</small>
          </div>

          <div className="auth-field">
            <label htmlFor="confirm">确认密码</label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
            />
          </div>

          <Button variant="primary" className="auth-submit" type="submit" disabled={loading}>
            {loading ? "注册中..." : "注册"}
          </Button>
        </form>
        <p className="auth-footer">
          已有账号？<Link to="/login">登录</Link>
        </p>
      </main>
    </div>
  )
}
