import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from './pages/DashboardPage'
import ArticleEditor from './pages/ArticleEditor'
import WeChatPreview from './pages/WeChatPreview'
import StyleEditor from './pages/StyleEditor'
import AISettings from './pages/AISettings'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/editor/:articleId" element={<ArticleEditor />} />
        <Route path="/preview/:articleId" element={<WeChatPreview />} />
        <Route path="/styles" element={<StyleEditor />} />
        <Route path="/settings" element={<AISettings />} />
        {/* 404 兜底：重定向回首页 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
