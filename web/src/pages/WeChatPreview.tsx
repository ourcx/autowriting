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
          <button className="wd-back-btn" onClick={() => navigate(-1)}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-left"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg>
            返回
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
