import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, Palette, AlertTriangle, Database, BookOpen, LogOut, Shield, Zap, Clock, Star, Image, User, Shapes } from 'lucide-react'
import Dashboard from '../Dashboard/Dashboard'
import OnboardingGuide from '../../components/OnboardingGuide/OnboardingGuide'
import PageHeader from '../../components/PageHeader/PageHeader'
import { useAIReadiness, fetchServerStatus } from '../../store/useConfigStore'
import { useAuth, logout } from '../../store/useAuth'
import './DashboardPage.css'
import { articleEditorUrl } from '../../utils/articleNavigation'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { articleReady: apiKeyReady } = useAIReadiness()
  const { user, isAdmin } = useAuth()
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    fetchServerStatus()
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
      <PageHeader
        title={<div className="dp-logo" onClick={() => navigate('/')}>
          <div className="dp-logo-mark">D</div>
          <span>Dashy</span>
        </div>}
        actions={<nav className="dp-nav" aria-label="工作台导航">
          <div className="dp-nav-group" role="group" aria-label="创作工具">
            <button className="dp-nav-btn" onClick={() => navigate('/drafts')}>
              <BookOpen size={14} />
              微信草稿
            </button>
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
          </div>
          <div className="dp-nav-group" role="group" aria-label="设计">
            <button className="dp-nav-btn" onClick={() => navigate('/wechat/materials')}>
              <Image size={14} />
              素材库
            </button>
            <button className="dp-nav-btn" onClick={() => navigate('/styles')}>
              <Palette size={14} />
              样式
            </button>
            <button className="dp-nav-btn" onClick={() => navigate('/canvas')}>
              <Shapes size={14} />
              画布
            </button>
          </div>
          <div className="dp-nav-group" role="group" aria-label="账户与配置">
            <button className={`dp-nav-btn ${!apiKeyReady ? 'dp-nav-btn--warn' : ''}`} onClick={() => navigate('/settings')}>
              {apiKeyReady ? <Settings size={14} /> : <AlertTriangle size={14} />}
              AI 配置
            </button>
            {isAdmin && (
              <button className="dp-nav-btn" onClick={() => navigate('/admin')}>
                <Shield size={14} />
                管理
              </button>
            )}
            <button className="dp-nav-btn" onClick={() => navigate('/account')} title="用户页与写作档案">
              <User size={14} />
              <span className="dp-nav-user">{user?.username || '用户页'}</span>
            </button>
            <button className="dp-nav-btn dp-nav-btn--icon" title="登出" aria-label="登出" onClick={() => { logout(); navigate('/login') }}>
              <LogOut size={14} />
            </button>
          </div>
        </nav>}
      />

      {/* ── 主体内容（占满剩余高度） ── */}
      <div className="dp-body">
        <Dashboard
          onCreateArticle={id => navigate(articleEditorUrl(id))}
          onEditArticle={id => navigate(articleEditorUrl(id))}
          onPublishArticle={(id, platform) => navigate(articleEditorUrl(id, platform))}
        />
      </div>

      {/* ── 欢迎引导 ── */}
      {showOnboarding && (
        <OnboardingGuide onComplete={handleOnboardingComplete} />
      )}
    </div>
  )
}
