import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage/DashboardPage'
import ArticleEditor from './pages/ArticleEditor/ArticleEditor'
import WeChatPreview from './pages/WeChatPreview/WeChatPreview'
import WeChatDrafts from './pages/WeChatDrafts/WeChatDrafts'
import StyleEditor from './pages/StyleEditor/StyleEditor'
import AISettings from './pages/AISettings/AISettings'
import RagPage from './pages/RagPage/RagPage'
import TokenUsagePage from './pages/TokenUsagePage/TokenUsagePage'
import LoginPage from './pages/LoginPage/LoginPage'
import RegisterPage from './pages/RegisterPage/RegisterPage'
import AdminPage from './pages/AdminPage/AdminPage'
import MonitoringPage from './pages/MonitoringPage/MonitoringPage'
import PromptsPage from './pages/PromptsPage/PromptsPage'
import CronPage from './pages/CronPage/CronPage'
import ArticleScorePage from './pages/ArticleScorePage/ArticleScorePage'
import PrivateRoute from './components/PrivateRoute/PrivateRoute'
import ToastProvider from './components/Toast/Toast'
import { syncAIConfigFromServer } from './utils/aiConfig'
import { initAuth } from './store/useAuth'

export default function App() {
  useEffect(() => {
    // 先恢复登录态，再同步 AI 配置
    initAuth().then(() => {
      syncAIConfigFromServer().catch(() => {})
    })
  }, [])

  return (
    <BrowserRouter>
      <ToastProvider />
      <Routes>
        {/* 公开路由 */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* 登录保护路由 */}
        <Route path="/" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
        <Route path="/editor/:articleId" element={<PrivateRoute><ArticleEditor /></PrivateRoute>} />
        <Route path="/preview/:articleId" element={<PrivateRoute><WeChatPreview /></PrivateRoute>} />
        <Route path="/drafts" element={<PrivateRoute><WeChatDrafts /></PrivateRoute>} />
        <Route path="/styles" element={<PrivateRoute><StyleEditor /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute><AISettings /></PrivateRoute>} />
        <Route path="/rag" element={<PrivateRoute><RagPage /></PrivateRoute>} />
        <Route path="/token-usage" element={<PrivateRoute><TokenUsagePage /></PrivateRoute>} />
        <Route path="/prompts" element={<PrivateRoute><PromptsPage /></PrivateRoute>} />
        <Route path="/cron" element={<PrivateRoute><CronPage /></PrivateRoute>} />
        <Route path="/scores" element={<PrivateRoute><ArticleScorePage /></PrivateRoute>} />

        {/* 管理员路由 */}
        <Route path="/admin" element={<PrivateRoute requireAdmin><AdminPage /></PrivateRoute>} />
        <Route path="/monitoring" element={<PrivateRoute requireAdmin><MonitoringPage /></PrivateRoute>} />

        {/* 404 兜底 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
