import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, Palette, AlertTriangle, Database, BookOpen, LogOut, Shield, Zap, Clock, Star } from 'lucide-react'
import Dashboard from './Dashboard'
import OnboardingGuide from '../components/OnboardingGuide'
import { useAIReadiness, fetchServerStatus } from '../store/useConfigStore'
import { useAuth, logout } from '../store/useAuth'
import './DashboardPage.css'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { articleReady: apiKeyReady } = useAIReadiness()
  const { user, isAdmin } = useAuth()
  const [wxBound, setWxBound] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    fetchServerStatus()
    // 从 localStorage 检查公众号凭据是否存在（不走服务器）
    try {
      const raw = localStorage.getItem('wechat_credentials')
      if (raw) {
        const { appId, appSecret } = JSON.parse(raw)
        setWxBound(!!(appId && appSecret))
      }
    } catch { /* ignore */ }

    // 检查是否需要显示引导（首次访问）
    const hasSeenOnboarding = localStorage.getItem('onboarding-completed')
    if (!hasSeenOnboarding) {
      setShowOnboarding(true)
    }
  }, [])

  const handleOnboardingComplete = () => {
    localStorage.setItem('onboarding-completed', 'true')
    setShowOnboarding(false)
  }

  return (
    <div className="dp-root">
      {/* ── Header ── */}
      <header className="dp-header">
        <div className="dp-logo" onClick={() => navigate('/')}>
          <div className="dp-logo-mark">D</div>
          <span>Dashy</span>
        </div>

        <nav className="dp-nav">
          {!apiKeyReady && (
            <button
              className="dp-nav-btn dp-nav-btn--warn"
              onClick={() => navigate('/settings')}
            >
              <AlertTriangle size={13} />
              配置 AI Key
            </button>
          )}
          {wxBound && (
            <button className="dp-nav-btn" onClick={() => navigate('/drafts')}>
              <BookOpen size={14} />
              草稿箱
            </button>
          )}
          <button className="dp-nav-btn" onClick={() => navigate('/rag')}>
            <Database size={14} />
            知识库
          </button>
          <button className="dp-nav-btn" onClick={() => navigate('/prompts')}>
            <Zap size={14} />
            提示词
          </button>
          <button className="dp-nav-btn" onClick={() => navigate('/cron')}>
            <Clock size={14} />
            定时任务
          </button>
          <button className="dp-nav-btn" onClick={() => navigate('/scores')}>
            <Star size={14} />
            文章评分
          </button>
          <button className="dp-nav-btn" onClick={() => navigate('/settings')}>
            <Settings size={14} />
            AI 配置
          </button>
          <button className="dp-nav-btn" onClick={() => navigate('/styles')}>
            <Palette size={14} />
            样式
          </button>
          {isAdmin && (
            <button className="dp-nav-btn" onClick={() => navigate('/admin')}>
              <Shield size={14} />
              管理
            </button>
          )}
          <span className="dp-nav-user" title={user?.username}>
            {user?.username}
          </span>
          <button className="dp-nav-btn dp-nav-btn--ghost" onClick={() => { logout(); navigate('/login') }}>
            <LogOut size={14} />
            登出
          </button>
        </nav>
      </header>

      {/* ── 主体内容（占满剩余高度） ── */}
      <div className="dp-body">
        <Dashboard
          onCreateArticle={id => navigate(`/editor/${id}`)}
          onEditArticle={id => navigate(`/editor/${id}`)}
        />
      </div>

      {/* ── 欢迎引导 ── */}
      {showOnboarding && (
        <OnboardingGuide onComplete={handleOnboardingComplete} />
      )}
    </div>
  )
}
