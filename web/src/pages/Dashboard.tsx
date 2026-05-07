import { useState, useEffect } from 'react'
import { Plus, Calendar, FileText, Trash2, Edit2, RefreshCw } from 'lucide-react'
import axios from 'axios'
import './Dashboard.css'

interface Article {
  id: string  // 唯一标识：日期-序号 或 日期-标题
  date: string
  title: string
  status: 'draft' | 'generated' | 'published'
  createdAt: string
}

interface DashboardProps {
  onCreateArticle: (articleId: string) => void
  onEditArticle?: (articleId: string) => void
}

export default function Dashboard({ onCreateArticle, onEditArticle }: DashboardProps) {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0])

  useEffect(() => {
    fetchArticles()
  }, [])

  const fetchArticles = async () => {
    try {
      setLoading(true)
      const response = await axios.get('/api/articles')
      setArticles(response.data)
    } catch (error) {
      console.error('Failed to fetch articles:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateNew = () => {
    const dateStr = newDate.replace(/-/g, '')
    const titleInput = document.getElementById('new-article-title') as HTMLInputElement
    const title = titleInput?.value.trim() || ''
    
    // 生成唯一 ID：如果有标题就用 日期-标题，否则用 日期-时间戳
    let articleId = dateStr
    if (title) {
      // 使用标题作为 ID 的一部分（去除特殊字符）
      const titleSlug = title.replace(/[^\w\u4e00-\u9fff]/g, '').substring(0, 20)
      articleId = `${dateStr}-${titleSlug}`
    } else {
      // 没有标题就用时间戳确保唯一性
      articleId = `${dateStr}-${Date.now()}`
    }
    
    // 保存标题到 localStorage 临时存储
    if (title) {
      localStorage.setItem(`article_title_${articleId}`, title)
    }
    
    onCreateArticle(articleId)
  }

  const handleDelete = async (articleId: string) => {
    if (confirm('确定要删除这篇文章吗？')) {
      try {
        await axios.delete(`/api/articles/${articleId}`)
        fetchArticles()
      } catch (error) {
        console.error('Failed to delete article:', error)
      }
    }
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      draft: '草稿',
      generated: '已生成',
      published: '已发布'
    }
    return labels[status] || status
  }

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: '#9f9b93',
      generated: '#fbbd41',
      published: '#078a52'
    }
    return colors[status] || '#000'
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>文章管理</h2>
        <p>创建和管理你的公众号文章</p>
      </div>

      <div className="create-section">
        <div className="create-card">
          <h3>创建新文章</h3>
          <div className="create-form">
            <div className="form-group">
              <label>选择日期</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="date-input"
              />
            </div>
            <div className="form-group">
              <label>文章标题（可选）</label>
              <input
                type="text"
                placeholder="输入文章标题，留空则使用日期"
                className="title-input"
                id="new-article-title"
              />
            </div>
            <button className="btn btn-primary" onClick={handleCreateNew}>
              <Plus size={20} />
              创建文章
            </button>
          </div>
        </div>
      </div>

      <div className="articles-section">
        <div className="section-header">
          <h3>最近文章</h3>
          <button
            className="btn-refresh"
            onClick={() => fetchArticles()}
            disabled={loading}
            title="刷新文章列表"
          >
            <RefreshCw size={18} />
          </button>
        </div>
        {loading ? (
          <div className="loading">加载中...</div>
        ) : articles.length === 0 ? (
          <div className="empty-state">
            <FileText size={48} />
            <p>还没有文章，创建一篇吧！</p>
          </div>
        ) : (
          <div className="articles-grid">
            {articles.map((article) => (
              <div key={article.id} className="article-card">
                <div className="article-header">
                  <div>
                    <h4>{article.title || `文章 ${article.date}`}</h4>
                    <p className="article-date">
                      <Calendar size={14} />
                      {article.date}
                    </p>
                  </div>
                  <span
                    className="status-badge"
                    style={{ backgroundColor: getStatusColor(article.status) }}
                  >
                    {getStatusLabel(article.status)}
                  </span>
                </div>
                <div className="article-actions">
                  <button
                    className="btn btn-small btn-secondary"
                    onClick={() => onEditArticle?.(article.id)}
                  >
                    <Edit2 size={16} />
                    编辑
                  </button>
                  <button
                    className="btn btn-small btn-danger"
                    onClick={() => handleDelete(article.id)}
                  >
                    <Trash2 size={16} />
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
