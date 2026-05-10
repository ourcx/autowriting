import { useState, useEffect } from 'react'
import { toast } from '../components/Toast'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Zap, Save, Edit3, Palette, Settings, AlertTriangle } from 'lucide-react'
import { useAIReadiness, fetchServerStatus } from '../store/useConfigStore'
import { fetchArticle, saveArticle } from '../utils/apiHelpers'
import CoverGenerator from '../components/CoverGenerator'
import CoverHistory from '../components/CoverHistory'
import BatchCoverGenerator from '../components/BatchCoverGenerator'
import ImageLibrary from '../components/ImageLibrary'
import MarkdownEditor from '../components/MarkdownEditor'
import ContentStats from '../components/ContentStats'
import GenerateModal from '../components/GenerateModal'
import './ArticleEditor.css'

interface ArticleData {
  task: string
  materials: string
  article: string
  title: string
}

type TabId = 'task' | 'materials' | 'article' | 'analysis' | 'cover' | 'history' | 'batch' | 'library'

export default function ArticleEditor() {
  const { articleId = '' } = useParams<{ articleId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<ArticleData>({ task: '', materials: '', article: '', title: '' })
  const [loading, setLoading] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('task')
  const [showBatchGenerator, setShowBatchGenerator] = useState(false)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)

  // 从 store 读取配置就绪状态（本地 + 服务端综合判断）
  const { localConfig: aiConfig, articleReady: apiKeyReady } = useAIReadiness()

  // 首次挂载时拉一次服务端状态
  useEffect(() => { fetchServerStatus() }, [])

  useEffect(() => {
    if (!articleId) return
    fetchArticleData()
  }, [articleId])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault()
        if (data.task && data.materials) handleGenerate()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault()
        if (data.article) navigate(`/preview/${articleId}`)
      }
      if (e.key === 'Escape') {
        setShowGenerateModal(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [data.task, data.materials, data.article, articleId])

  const fetchArticleData = async () => {
    try {
      setLoading(true)
      const d = await fetchArticle(articleId)
      setData(d)
    } catch (err) {
      console.error('加载文章失败', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      await saveArticle(articleId, data)
      toast.success('保存成功')
    } catch {
      toast.error('保存失败，请重试')
    }
  }

  const handleGenerate = () => {
    // 前置检查：未配置 Key 时直接提示，不发请求
    if (!apiKeyReady) {
      setGenerateError('未配置 AI API Key，请先前往「AI 配置」页面填写后再生成。')
      return
    }
    setGenerateError(null)
    setShowGenerateModal(true)
  }

  const handleGenerateComplete = (article: string) => {
    setData(prev => ({ ...prev, article }))
    setActiveTab('article')
    toast.success('文章生成成功')
  }

  const articleTitle = data.title || data.article.split('\n')[0]?.replace(/^#+\s*/, '') || `文章 ${articleId}`

  if (loading) {
    return (
      <div className="editor-loading">
        <div className="spinner" />
        <p>加载中...</p>
      </div>
    )
  }

  return (
    <div className="editor">
      {/* ── 未配置 Key 提示横幅 ── */}
      {!apiKeyReady && (
        <div className="editor-setup-banner">
          <AlertTriangle size={15} />
          <span>还没配置 AI API Key，生成文章需要先</span>
          <button onClick={() => navigate('/settings')}>前往配置</button>
          <span>（已配置的可忽略此提示）</span>
        </div>
      )}

      {/* ── 生成错误横幅 ── */}
      {generateError && (
        <div className="editor-error-banner">
          <AlertTriangle size={15} />
          <span>{generateError}</span>
          {generateError.includes('API Key') && (
            <button onClick={() => navigate('/settings')}>去配置</button>
          )}
          <button className="editor-error-close" onClick={() => setGenerateError(null)}>✕</button>
        </div>
      )}

      {/* 顶部 Header */}
      <div className="editor-header">
        <button className="btn-back" onClick={() => navigate('/')}>
          <ArrowLeft size={20} />
          返回
        </button>

        <div className="header-title">
          {editingTitle ? (
            <input
              type="text"
              value={data.title}
              onChange={e => setData(prev => ({ ...prev, title: e.target.value }))}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={e => { if (e.key === 'Enter') setEditingTitle(false) }}
              autoFocus
              className="title-input"
              placeholder="输入文章标题..."
            />
          ) : (
            <h2 onClick={() => setEditingTitle(true)}>
              {articleTitle}
              <Edit3 size={16} className="edit-icon" />
            </h2>
          )}
        </div>

        <div className="header-actions">
          <button
            className="btn btn-ghost"
            onClick={() => navigate('/settings')}
            title="AI 模型和 API Key 配置"
          >
            <Settings size={16} />
            AI 配置
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => navigate('/styles')}
            title="管理 CSS 样式模板"
          >
            <Palette size={16} />
            管理样式
          </button>
          <button className="btn btn-secondary" onClick={handleSave}>
            <Save size={20} />
            保存
          </button>
          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={!data.task || !data.materials}
          >
            <Zap size={20} />
            生成文章
          </button>
          {data.article && (
            <button
              className="btn btn-success"
              onClick={() => navigate(`/preview/${articleId}`)}
              title="公众号预览 (Cmd+P)"
            >
              公众号预览
            </button>
          )}
        </div>
      </div>

      {/* Tabs + 内容区 */}
      <div className="editor-container">
        <div className="editor-tabs">
          {(
            [
              ['task', '任务要求'],
              ['materials', '素材整理'],
              ['article', '文章内容'],
              ['analysis', '内容分析'],
              ['cover', '生成封面'],
              ['history', '生成历史'],
              ['batch', '批量生成'],
              ['library', '图片库'],
            ] as [TabId, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className={`tab ${activeTab === id ? 'active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="editor-content">
          {activeTab === 'task' && (
            <div className="editor-panel">
              <div className="panel-header">
                <h3>写作任务要求</h3>
                <p>定义文章的主题、结构和风格要求</p>
              </div>
              <textarea
                value={data.task}
                onChange={e => setData(prev => ({ ...prev, task: e.target.value }))}
                placeholder={`# 写作任务要求\n\n## 基本信息\n- **文章主题**：\n- **目标字数**：1500-2000 字\n- **发布平台**：微信公众号\n\n## 结构要求\n1. 开场：直接切入痛点或场景\n2. 这是什么：解释核心概念\n3. 怎么做：分步骤说明\n4. 踩过的坑：分享真实问题\n5. 值不值得做：给出明确判断`}
                className="editor-textarea"
              />
            </div>
          )}

          {activeTab === 'materials' && (
            <div className="editor-panel">
              <div className="panel-header">
                <h3>素材整理</h3>
                <p>收集和整理文章所需的数据、案例和观点</p>
              </div>
              <textarea
                value={data.materials}
                onChange={e => setData(prev => ({ ...prev, materials: e.target.value }))}
                placeholder={`# 素材整理\n\n## 核心数据\n- [数据点 1]\n\n## 踩过的坑\n### 坑1：[问题描述]\n- **问题**：\n- **原因**：\n- **解决**：\n\n## 个人观点\n- [观点 1]`}
                className="editor-textarea"
              />
            </div>
          )}

          {activeTab === 'article' && (
            <div className="editor-panel">
              <MarkdownEditor
                value={data.article}
                onChange={value => setData(prev => ({ ...prev, article: value }))}
                placeholder="文章将在这里显示..."
                height="600px"
              />
            </div>
          )}

          {activeTab === 'analysis' && (
            <div className="editor-panel">
              <ContentStats title={articleTitle} content={data.article} />
            </div>
          )}

          {activeTab === 'cover' && (
            <div className="editor-panel">
              <CoverGenerator title={articleTitle} content={data.article} />
            </div>
          )}

          {activeTab === 'history' && (
            <div className="editor-panel">
              <CoverHistory />
            </div>
          )}

          {activeTab === 'batch' && (
            <div className="editor-panel">
              <div className="batch-generator-placeholder">
                <h3>批量生成封面</h3>
                <p>一次生成多个不同风格和颜色的封面</p>
                <button className="btn btn-primary" onClick={() => setShowBatchGenerator(true)}>
                  <Zap size={20} />
                  打开批量生成器
                </button>
              </div>
            </div>
          )}

          {activeTab === 'library' && (
            <div className="editor-panel">
              <ImageLibrary />
            </div>
          )}
        </div>
      </div>

      {showBatchGenerator && (
        <BatchCoverGenerator
          onClose={() => setShowBatchGenerator(false)}
          onSuccess={() => setActiveTab('history')}
        />
      )}

      {showGenerateModal && (
        <GenerateModal
          articleId={articleId}
          task={data.task}
          materials={data.materials}
          aiConfig={aiConfig as unknown as Record<string, unknown>}
          onComplete={handleGenerateComplete}
          onClose={() => setShowGenerateModal(false)}
        />
      )}
    </div>
  )
}
