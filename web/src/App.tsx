import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { FileText } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import ArticleEditor from './pages/ArticleEditor'
import WeChatPreview from './pages/WeChatPreview'
import StyleEditor from './pages/StyleEditor'
import './App.css'

// 仪表板页（带顶部导航）
function DashboardPage() {
  const navigate = useNavigate()

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="logo" style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>
            <FileText size={28} />
            <h1>AI 自动写作系统</h1>
          </div>
        </div>
      </header>
      <main className="app-main">
        <Dashboard
          onCreateArticle={(id) => navigate(`/editor/${id}`)}
          onEditArticle={(id) => navigate(`/editor/${id}`)}
        />
      </main>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/editor/:articleId" element={<ArticleEditor />} />
        <Route path="/preview/:articleId" element={<WeChatPreview />} />
        <Route path="/styles" element={<StyleEditor />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
