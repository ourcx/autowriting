import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Palette, Settings, AlertTriangle } from 'lucide-react'
import Dashboard from './Dashboard'
import { useAIReadiness, fetchServerStatus } from '../store/useConfigStore'
import '../App.css'

export default function DashboardPage() {
  const navigate = useNavigate()
  const { articleReady: apiKeyReady } = useAIReadiness()

  // 首次挂载时拉服务端配置状态
  useEffect(() => { fetchServerStatus() }, [])

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="logo" style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>
            <h1>Dashy 公众号写作</h1>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="dash-styles-btn"
              onClick={() => navigate('/settings')}
              title="AI 模型配置"
            >
              <Settings size={15} />
              AI 配置
            </button>
            <button
              className="dash-styles-btn"
              onClick={() => navigate('/styles')}
            >
              <Palette size={15} />
              管理样式
            </button>
          </div>
        </div>
      </header>

      {/* 首次使用引导：未配置 API Key 时显示 */}
      {!apiKeyReady && (
        <div className="dash-setup-guide">
          <AlertTriangle size={16} />
          <div>
            <strong>使用前先配置 AI</strong>
            <span> — 需要填入 API Key 才能生成文章。配置保存在浏览器本地，不会上传服务器。</span>
          </div>
          <button onClick={() => navigate('/settings')}>立即配置 →</button>
        </div>
      )}

      <main className="app-main">
        <Dashboard
          onCreateArticle={(id) => navigate(`/editor/${id}`)}
          onEditArticle={(id) => navigate(`/editor/${id}`)}
        />
      </main>
    </div>
  )
}
