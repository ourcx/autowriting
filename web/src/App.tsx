import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import ArticleEditor from './pages/ArticleEditor'
import WeChatPreview from './pages/WeChatPreview'
import WeChatDrafts from './pages/WeChatDrafts'
import StyleEditor from './pages/StyleEditor'
import AISettings from './pages/AISettings'
import RagPage from './pages/RagPage'
import ToastProvider from './components/Toast'
import { syncAIConfigFromServer } from './utils/aiConfig'

export default function App() {
  // 启动时从服务端同步 AI 配置到 localStorage
  useEffect(() => {
    syncAIConfigFromServer().catch(() => {})
  }, [])

  return (
    <BrowserRouter>
      <ToastProvider />
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/editor/:articleId" element={<ArticleEditor />} />
        <Route path="/preview/:articleId" element={<WeChatPreview />} />
        <Route path="/drafts" element={<WeChatDrafts />} />
        <Route path="/styles" element={<StyleEditor />} />
        <Route path="/settings" element={<AISettings />} />
        <Route path="/rag" element={<RagPage />} />
        {/* 404 兜底：重定向回首页 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
