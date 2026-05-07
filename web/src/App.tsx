import { useState } from 'react'
import { FileText, Plus, Zap, Image, Send } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import ArticleEditor from './pages/ArticleEditor'
import './App.css'

type Page = 'dashboard' | 'editor'

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const [selectedArticleId, setSelectedArticleId] = useState<string>('')

  const handleCreateArticle = (articleId: string) => {
    setSelectedArticleId(articleId)
    setCurrentPage('editor')
  }

  const handleEditArticle = (articleId: string) => {
    setSelectedArticleId(articleId)
    setCurrentPage('editor')
  }

  const handleBack = () => {
    setCurrentPage('dashboard')
    setSelectedArticleId('')
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="logo">
            <FileText size={32} />
            <h1>AI 自动写作系统</h1>
          </div>
          <nav className="nav">
            <button 
              className={`nav-btn ${currentPage === 'dashboard' ? 'active' : ''}`}
              onClick={() => handleBack()}
            >
              <Plus size={20} />
              仪表板
            </button>
          </nav>
        </div>
      </header>

      <main className="app-main">
        {currentPage === 'dashboard' ? (
          <Dashboard
            onCreateArticle={handleCreateArticle}
            onEditArticle={handleEditArticle}
          />
        ) : (
          <ArticleEditor articleId={selectedArticleId} onBack={handleBack} />
        )}
      </main>
    </div>
  )
}

export default App
