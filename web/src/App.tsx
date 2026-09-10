import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage/DashboardPage'
import LoginPage from './pages/LoginPage/LoginPage'
import PrivateRoute from './components/PrivateRoute/PrivateRoute'
import ToastProvider from './components/Toast/Toast'
import { syncAIConfigFromServer } from './utils/aiConfig'
import { initAuth } from './store/useAuth'

// Keep the landing workspace light; editors and administrative tools load on entry.
const ArticleEditor = lazy(() => import('./pages/ArticleEditor/ArticleEditor'))
const WeChatPreview = lazy(() => import('./pages/WeChatPreview/WeChatPreview'))
const WeChatDrafts = lazy(() => import('./pages/WeChatDrafts/WeChatDrafts'))
const WeChatMaterials = lazy(() => import('./pages/WeChatMaterials/WeChatMaterials'))
const StyleEditor = lazy(() => import('./pages/StyleEditor/StyleEditor'))
const AISettings = lazy(() => import('./pages/AISettings/AISettings'))
const RagPage = lazy(() => import('./pages/RagPage/RagPage'))
const TokenUsagePage = lazy(() => import('./pages/TokenUsagePage/TokenUsagePage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage/RegisterPage'))
const AdminPage = lazy(() => import('./pages/AdminPage/AdminPage'))
const MonitoringPage = lazy(() => import('./pages/MonitoringPage/MonitoringPage'))
const PromptsPage = lazy(() => import('./pages/PromptsPage/PromptsPage'))
const CronPage = lazy(() => import('./pages/CronPage/CronPage'))
const ArticleScorePage = lazy(() => import('./pages/ArticleScorePage/ArticleScorePage'))
const AccountPage = lazy(() => import('./pages/AccountPage/AccountPage'))
const CanvasStudio = lazy(() => import('./pages/CanvasStudio/CanvasStudio'))

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
      <Suspense fallback={<div className="route-loading" role="status">正在打开工作区...</div>}>
      <Routes>
        {/* 公开路由 */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* 登录保护路由 */}
        <Route path="/" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
        <Route path="/editor/:articleId" element={<PrivateRoute><ArticleEditor /></PrivateRoute>} />
        <Route path="/preview/:articleId" element={<PrivateRoute><WeChatPreview /></PrivateRoute>} />
        <Route path="/drafts" element={<PrivateRoute><WeChatDrafts /></PrivateRoute>} />
        <Route path="/wechat/materials" element={<PrivateRoute><WeChatMaterials /></PrivateRoute>} />
        <Route path="/styles" element={<PrivateRoute><StyleEditor /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute><AISettings /></PrivateRoute>} />
        <Route path="/rag" element={<PrivateRoute><RagPage /></PrivateRoute>} />
        <Route path="/token-usage" element={<PrivateRoute><TokenUsagePage /></PrivateRoute>} />
        <Route path="/prompts" element={<PrivateRoute><PromptsPage /></PrivateRoute>} />
        <Route path="/cron" element={<PrivateRoute><CronPage /></PrivateRoute>} />
        <Route path="/scores" element={<PrivateRoute><ArticleScorePage /></PrivateRoute>} />
        <Route path="/account" element={<PrivateRoute><AccountPage /></PrivateRoute>} />
        <Route path="/canvas" element={<PrivateRoute><CanvasStudio /></PrivateRoute>} />

        {/* 管理员路由 */}
        <Route path="/admin" element={<PrivateRoute requireAdmin><AdminPage /></PrivateRoute>} />
        <Route path="/monitoring" element={<PrivateRoute requireAdmin><MonitoringPage /></PrivateRoute>} />

        {/* 404 兜底 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
