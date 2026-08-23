import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AlertTriangle, Palette, Shapes } from 'lucide-react'
import WeChatRenderer from '../../components/WeChatRenderer/WeChatRenderer'
import PageHeader from '../../components/PageHeader/PageHeader'
import { fetchArticle } from '../../utils/apiHelpers'
import {
  ArticleData,
  createEmptyArticleData,
  loadLocalArticleData,
  normalizeArticleData,
} from '../../utils/articleData'
import './WeChatPreview.css'

type PlatformMode = 'wechat' | 'toutiao' | 'xiaohongshu'

export default function WeChatPreview() {
  const { articleId } = useParams<{ articleId: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<ArticleData>(createEmptyArticleData)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [platformMode, setPlatformMode] = useState<PlatformMode>('wechat')

  useEffect(() => {
    if (!articleId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const article = articleId.startsWith('local:')
          ? loadLocalArticleData(articleId)
          : normalizeArticleData(await fetchArticle(articleId))
        if (!cancelled) setData(article)
      } catch (error) {
        console.error('加载失败', error)
        if (!cancelled) setLoadError('文章预览加载失败，原文没有被修改。请返回编辑器重试。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [articleId])

  // 根据平台模式选择对应内容
  const activeContent = platformMode === 'toutiao' && data.articleToutiao
    ? data.articleToutiao
    : data.article

  const articleTitle = data.title || activeContent.split('\n')[0]?.replace(/^#+\s*/, '') || '未命名文章'
  const title = platformMode === 'xiaohongshu'
    ? data.xiaohongshuTitle || articleTitle
    : articleTitle

  return (
    <div className="wechat-preview-page">
      <PageHeader
        title={<div className="preview-nav-title">
            <span className="preview-nav-label">发布预览</span>
            <span className="preview-nav-article">{title}</span>
          </div>}
        onBack={() => navigate(-1)}
        actions={<>
          <button
            className="preview-nav-styles-btn"
            onClick={() => navigate('/styles')}
          >
            <Palette size={14} />
            管理样式
          </button>
          <button
            className="preview-nav-styles-btn"
            onClick={() => navigate(`/canvas?articleId=${encodeURIComponent(articleId || '')}`)}
          >
            <Shapes size={14} />
            视觉画布
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
          <button
            className={`wr-platform-tab wr-platform-tab--xiaohongshu ${platformMode === 'xiaohongshu' ? 'active' : ''}`}
            onClick={() => setPlatformMode('xiaohongshu')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="3" y="5" width="18" height="14" rx="4" />
              <path d="M8 9h8v2H8zm0 4h5v2H8z" fill="#fffaf0" />
            </svg>
            小红书长文
          </button>
        </>}
      />

      {/* 内容区 */}
      <main className="preview-main">
        {loading ? (
          <div className="preview-loading">
            <div className="preview-spinner" />
            <p>加载文章中...</p>
          </div>
        ) : loadError ? (
          <div className="preview-empty-toutiao">
            <AlertTriangle size={24} />
            <p>{loadError}</p>
            <button onClick={() => navigate(-1)}>返回编辑器</button>
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
