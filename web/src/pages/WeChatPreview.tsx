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
  articleToutiao: string
}

type PlatformMode = 'wechat' | 'toutiao'

export default function WeChatPreview() {
  const { articleId } = useParams<{ articleId: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<ArticleData>({ task: '', materials: '', article: '', title: '', articleToutiao: '' })
  const [loading, setLoading] = useState(true)
  const [platformMode, setPlatformMode] = useState<PlatformMode>('wechat')

  useEffect(() => {
    if (!articleId) return
    axios
      .get(`/api/articles/${articleId}`)
      .then(res => setData(res.data))
      .catch(err => console.error('加载失败', err))
      .finally(() => setLoading(false))
  }, [articleId])

  // 根据平台模式选择对应内容
  const activeContent = platformMode === 'toutiao' && data.articleToutiao
    ? data.articleToutiao
    : data.article

  const title = data.title || activeContent.split('\n')[0]?.replace(/^#+\s*/, '') || '未命名文章'

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
            <span className="preview-nav-label">发布预览</span>
            <span className="preview-nav-article">{title}</span>
          </div>
          <button
            className="preview-nav-styles-btn"
            onClick={() => navigate('/styles')}
          >
            <Palette size={14} />
            管理样式
          </button>
          <button
            className={`wr-platform-tab ${platformMode === 'wechat' ? 'active' : ''}`}
            onClick={() => setPlatformMode('wechat')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8.5 13.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15H9v-2h2v2zm4 0h-2v-2h2v2zm1.07-7.75-.9.92C14.45 10.9 14 11.5 14 13h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H9c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" />
            </svg>
            微信公众号
          </button>
          <button
            className={`wr-platform-tab wr-platform-tab--toutiao ${platformMode === 'toutiao' ? 'active' : ''}`}
            onClick={() => setPlatformMode('toutiao')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            今日头条
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
        ) : platformMode === 'toutiao' && !data.articleToutiao ? (
          <div className="preview-empty-toutiao">
            <p>今日头条版本尚未生成</p>
            <span>点击「生成文章」后会同时生成公众号和今日头条两个版本</span>
            <button onClick={() => navigate(-1)}>返回编辑器生成</button>
          </div>
        ) : (
          <WeChatRenderer content={activeContent} title={title} articleId={articleId} platformMode={platformMode} />
        )}
      </main>
    </div>
  )
}
