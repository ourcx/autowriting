import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Palette } from 'lucide-react'
import axios from 'axios'
import WeChatRenderer from '../components/WeChatRenderer'
import './WeChatPreview.css'

interface ArticleData {
  task: string
  materials: string
  article: string
  title: string
}

export default function WeChatPreview() {
  const { articleId } = useParams<{ articleId: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<ArticleData>({ task: '', materials: '', article: '', title: '' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!articleId) return
    axios
      .get(`/api/articles/${articleId}`)
      .then(res => setData(res.data))
      .catch(err => console.error('加载失败', err))
      .finally(() => setLoading(false))
  }, [articleId])

  const title = data.title || data.article.split('\n')[0]?.replace(/^#+\s*/, '') || '未命名文章'

  return (
    <div className="wechat-preview-page">
      {/* 顶部导航栏 */}
      <header className="preview-nav">
        <div className="preview-nav-inner">
          <button className="preview-nav-back" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} />
            返回编辑器
          </button>
          <div className="preview-nav-title">
            <span className="preview-nav-label">公众号预览</span>
            <span className="preview-nav-article">{title}</span>
          </div>
          <button
            className="preview-nav-styles-btn"
            onClick={() => navigate('/styles')}
          >
            <Palette size={14} />
            管理样式
          </button>
        </div>
      </header>

      {/* 内容区 */}
      <main className="preview-main">
        {loading ? (
          <div className="preview-loading">
            <div className="preview-spinner" />
            <p>加载文章中...</p>
          </div>
        ) : (
          <WeChatRenderer content={data.article} title={title} />
        )}
      </main>
    </div>
  )
}
