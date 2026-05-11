import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, Palette, AlertTriangle, PenLine, Database, BookOpen } from 'lucide-react'
import Dashboard from './Dashboard'
import { useAIReadiness, fetchServerStatus } from '../store/useConfigStore'
import './DashboardPage.css'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { articleReady: apiKeyReady } = useAIReadiness()
  const [wxBound, setWxBound] = useState(false)

  useEffect(() => {
    fetchServerStatus()
    fetch('/api/wechat/status')
      .then(r => r.json())
      .then(d => setWxBound(d.bound))
      .catch(() => {})
  }, [])

  return (
    <div className="dp-root">
      {/* ── Header ── */}
      <header className="dp-header">
        <div className="dp-logo" onClick={() => navigate('/')}>
          <div className="dp-logo-mark">
            <PenLine size={16} />
          </div>
          <span>公众号写作</span>
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
          <button className="dp-nav-btn" onClick={() => navigate('/settings')}>
            <Settings size={14} />
            AI 配置
          </button>
          <button className="dp-nav-btn" onClick={() => navigate('/styles')}>
            <Palette size={14} />
            样式
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
    </div>
  )
}
