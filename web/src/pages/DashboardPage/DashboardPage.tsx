import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, Palette, AlertTriangle, Database, BookOpen, LogOut, Shield, Zap, Clock, BarChart3, Image, User, Shapes, HelpCircle } from 'lucide-react'
import Dashboard from '../Dashboard/Dashboard'
import OnboardingGuide from '../../components/OnboardingGuide/OnboardingGuide'
import PageHeader from '../../components/PageHeader/PageHeader'
import { useAIReadiness, fetchServerStatus } from '../../store/useConfigStore'
import { useAuth, logout } from '../../store/useAuth'
import './DashboardPage.css'
import { articleEditorUrl } from '../../utils/articleNavigation'
import {
  hasToutiaoCookies,
  hasWechatAnalyticsCookies,
  hasXiaohongshuCookies,
  loadWechatCredentials,
} from '../../utils/accountBindings'
import { hasCompletedGuide } from '../../utils/userExperience'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { articleReady: apiKeyReady } = useAIReadiness()
  const { user, isAdmin } = useAuth()
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    fetchServerStatus()
    if (user && !hasCompletedGuide(user.id, "dashboard")) {
      setShowOnboarding(true)
    }
  }, [user])

  const connectedPlatforms = Number(Boolean(loadWechatCredentials()) || (user ? hasWechatAnalyticsCookies(user.id) : false))
    + Number(hasToutiaoCookies())
    + Number(hasXiaohongshuCookies())

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
            <button className="dp-nav-btn" onClick={() => navigate('/insights')}>
              <BarChart3 size={14} />
              数据看板
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
          <div className="dp-nav-group" role="group" aria-label="账户与配置" data-onboarding="setup-status">
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
            <button className="dp-nav-btn dp-nav-btn--account" onClick={() => navigate('/account')} title={`${user?.username || '当前用户'}的发布账号与写作档案`}>
              <User size={14} />
              <span>账号与发布</span>
              <small className={connectedPlatforms ? 'is-ready' : ''}>{connectedPlatforms}/3</small>
            </button>
            <button className="dp-nav-btn dp-nav-btn--icon" title="查看当前页引导" aria-label="查看当前页引导" onClick={() => setShowOnboarding(true)}>
              <HelpCircle size={14} />
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
      {showOnboarding && user && (
        <OnboardingGuide page="dashboard" userId={user.id} run={showOnboarding} onClose={() => setShowOnboarding(false)} />
      )}
    </div>
  )
}
