import { Input } from "../../components/FormControls/FormControls"
import Button from "../../components/Button/Button"
import { useState, type FormEvent } from "react"
import { useNavigate, Link } from "react-router-dom"
import { login } from "../../store/useAuth"
import "./LoginPage.css"

export default function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) return
    setLoading(true)
    setError("")
    try {
      await login(username.trim(), password)
      navigate("/", { replace: true })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || (err instanceof Error ? err.message : "登录失败，请重试")
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
        <h1>登录 Dashy</h1>
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
              required
            />
          </div>

          <div className="auth-field">
            <label htmlFor="password">密码</label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          <Button variant="primary" className="auth-submit" type="submit" disabled={loading}>
            {loading ? "登录中..." : "登录"}
          </Button>
        </form>
        <p className="auth-footer">
          没有账号？<Link to="/register">注册</Link>
        </p>
      </main>
    </div>
  )
}
