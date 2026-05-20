import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import ArticleEditor from './pages/ArticleEditor'
import WeChatPreview from './pages/WeChatPreview'
import WeChatDrafts from './pages/WeChatDrafts'
import StyleEditor from './pages/StyleEditor'
import AISettings from './pages/AISettings'
import RagPage from './pages/RagPage'
import TokenUsagePage from './pages/TokenUsagePage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import AdminPage from './pages/AdminPage'
import MonitoringPage from './pages/MonitoringPage'
import PromptsPage from './pages/PromptsPage'
import PrivateRoute from './components/PrivateRoute'
import ToastProvider from './components/Toast'
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

        {/* 管理员路由 */}
        <Route path="/admin" element={<PrivateRoute requireAdmin><AdminPage /></PrivateRoute>} />
        <Route path="/monitoring" element={<PrivateRoute requireAdmin><MonitoringPage /></PrivateRoute>} />

        {/* 404 兜底 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
