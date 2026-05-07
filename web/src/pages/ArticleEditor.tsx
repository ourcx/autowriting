import { useState, useEffect } from 'react'
import { ArrowLeft, Zap, Save, Eye, Send, ExternalLink, Edit3, Globe } from 'lucide-react'
import axios from 'axios'
import ContentAnalysisPanel from '../components/ContentAnalysisPanel'
import CoverGenerator from '../components/CoverGenerator'
import CoverHistory from '../components/CoverHistory'
import BatchCoverGenerator from '../components/BatchCoverGenerator'
import ImageLibrary from '../components/ImageLibrary'
import WeChatPublisher from '../components/WeChatPublisher'
import MarkdownEditor from '../components/MarkdownEditor'
import AutomationPanel from '../components/AutomationPanel'
import ContentStats from '../components/ContentStats'
import './ArticleEditor.css'

interface ArticleEditorProps {
  articleId: string
  onBack: () => void
}

interface ArticleData {
  task: string
  materials: string
  article: string
  title: string
}

export default function ArticleEditor({ articleId, onBack }: ArticleEditorProps) {
  const [data, setData] = useState<ArticleData>({
    task: '',
    materials: '',
    article: '',
    title: ''
  })
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [activeTab, setActiveTab] = useState<'task' | 'materials' | 'article' | 'editor' | 'analysis' | 'cover' | 'history' | 'batch' | 'library' | 'publish'>('task')
  const [preview, setPreview] = useState(false)
  const [showBatchGenerator, setShowBatchGenerator] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)

  useEffect(() => {
    fetchArticleData()
    // 从 localStorage 读取临时保存的标题
    const savedTitle = localStorage.getItem(`article_title_${articleId}`)
    if (savedTitle) {
      setData(prev => ({ ...prev, title: savedTitle }))
      localStorage.removeItem(`article_title_${articleId}`)
    }
  }, [articleId])

  useEffect(() => {
    // 注册快捷键
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + S 保存
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
      // Ctrl/Cmd + G 生成
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault()
        if (data.task && data.materials) {
          handleGenerate()
        }
      }
      // Ctrl/Cmd + P 发布
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault()
        if (data.article) {
          handlePublishToWeChat()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [data.task, data.materials, data.article])

  const fetchArticleData = async () => {
    try {
      setLoading(true)
      const response = await axios.get(`/api/articles/${articleId}`)
      setData(response.data)
    } catch (error) {
      console.error('Failed to fetch article data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      await axios.post(`/api/articles/${articleId}`, data)
      alert('保存成功！')
    } catch (error) {
      console.error('Failed to save:', error)
      alert('保存失败')
    }
  }

  const handleGenerate = async () => {
    try {
      setGenerating(true)
      const response = await axios.post(`/api/articles/${articleId}/generate`, {
        task: data.task,
        materials: data.materials
      })
      setData(prev => ({
        ...prev,
        article: response.data.article
      }))
      setActiveTab('article')
    } catch (error) {
      console.error('Failed to generate:', error)
      alert('生成失败，请检查任务和素材是否完整')
    } finally {
      setGenerating(false)
    }
  }

  const handlePublishToWeChat = () => {
    // 跳转到微信公众号平台
    window.open('https://mp.weixin.qq.com/', '_blank')
  }

  if (loading) {
    return (
      <div className="editor-loading">
        <div className="spinner"></div>
        <p>加载中...</p>
      </div>
    )
  }

  return (
    <div className="editor">
      <div className="editor-header">
        <button className="btn-back" onClick={onBack}>
          <ArrowLeft size={20} />
          返回
        </button>
        <div className="header-title">
          {editingTitle ? (
            <input
              type="text"
              value={data.title}
              onChange={(e) => setData(prev => ({ ...prev, title: e.target.value }))}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setEditingTitle(false)
              }}
              autoFocus
              className="title-input"
              placeholder="输入文章标题..."
            />
          ) : (
            <h2 onClick={() => setEditingTitle(true)}>
              {data.title || `文章 ${articleId}`}
              <Edit3 size={16} className="edit-icon" />
            </h2>
          )}
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={handleSave}>
            <Save size={20} />
            保存
          </button>
          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={generating || !data.task || !data.materials}
          >
            <Zap size={20} />
            {generating ? '生成中...' : '生成文章'}
          </button>
          <button
            className="btn btn-success"
            onClick={handlePublishToWeChat}
            title="跳转到微信公众号平台发布"
          >
            <ExternalLink size={20} />
            发布
          </button>
        </div>
      </div>

      <div className="editor-container">
        <div className="editor-tabs">
          <button
            className={`tab ${activeTab === 'task' ? 'active' : ''}`}
            onClick={() => setActiveTab('task')}
          >
            📋 任务要求
          </button>
          <button
            className={`tab ${activeTab === 'materials' ? 'active' : ''}`}
            onClick={() => setActiveTab('materials')}
          >
            📚 素材整理
          </button>
          <button
            className={`tab ${activeTab === 'article' ? 'active' : ''}`}
            onClick={() => setActiveTab('article')}
          >
            📝 文章内容
          </button>
          <button
            className={`tab ${activeTab === 'editor' ? 'active' : ''}`}
            onClick={() => setActiveTab('editor')}
          >
            ✏️ 在线编辑
          </button>
          <button
            className={`tab ${activeTab === 'analysis' ? 'active' : ''}`}
            onClick={() => setActiveTab('analysis')}
          >
            📊 内容分析
          </button>
          <button
            className={`tab ${activeTab === 'cover' ? 'active' : ''}`}
            onClick={() => setActiveTab('cover')}
          >
            🖼️ 生成封面
          </button>
          <button
            className={`tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            📜 生成历史
          </button>
          <button
            className={`tab ${activeTab === 'batch' ? 'active' : ''}`}
            onClick={() => setActiveTab('batch')}
          >
            🎨 批量生成
          </button>
          <button
            className={`tab ${activeTab === 'library' ? 'active' : ''}`}
            onClick={() => setActiveTab('library')}
          >
            🖼️ 图片库
          </button>
          <button
            className={`tab ${activeTab === 'publish' ? 'active' : ''}`}
            onClick={() => setActiveTab('publish')}
          >
            📱 发布
          </button>
        </div>

        <div className="editor-content">
          {/* 自动化操作面板 */}
          <AutomationPanel
            dateDir={articleId}
            title={data.title}
            task={data.task}
            materials={data.materials}
            article={data.article}
            onGenerate={handleGenerate}
            onSave={handleSave}
            onPublish={handlePublishToWeChat}
          />

          {activeTab === 'task' && (
            <div className="editor-panel">
              <div className="panel-header">
                <h3>写作任务要求</h3>
                <p>定义文章的主题、结构和风格要求</p>
              </div>
              <textarea
                value={data.task}
                onChange={(e) => setData(prev => ({ ...prev, task: e.target.value }))}
                placeholder="# 写作任务要求

## 基本信息
- **文章主题**：
- **目标字数**：1500-2000 字
- **发布平台**：微信公众号

## 结构要求
1. 开场：直接切入痛点或场景
2. 🧠 这是什么：解释核心概念
3. ⚙️ 怎么做：分步骤说明
4. 🔍 踩过的坑：分享真实问题
5. ⚡ 值不值得做：给出明确判断"
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
                onChange={(e) => setData(prev => ({ ...prev, materials: e.target.value }))}
                placeholder="# 素材整理

## 核心数据
- [数据点 1]
- [数据点 2]

## 技术栈/工具
- **工具 1**：简短描述
- **工具 2**：简短描述

## 踩过的坑
### 坑1：[问题描述]
- **问题**：[具体问题]
- **原因**：[为什么出现]
- **解决**：[怎么解决的]

## 个人观点
- [观点 1]
- [观点 2]"
                className="editor-textarea"
              />
            </div>
          )}

          {activeTab === 'article' && (
            <div className="editor-panel">
              <MarkdownEditor
                value={data.article}
                onChange={(value) => setData(prev => ({ ...prev, article: value }))}
                placeholder="文章将在这里显示..."
                height="600px"
              />
            </div>
          )}

          {activeTab === 'editor' && (
            <div className="editor-panel" style={{ padding: 0, height: '100%' }}>
              <iframe
                src="https://edit.wemd.app/"
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  borderRadius: '8px'
                }}
                title="wemd.app 在线编辑器"
              />
            </div>
          )}

          {activeTab === 'analysis' && (
            <div className="editor-panel">
              <ContentStats title={data.title || data.article.split('\n')[0] || '未命名文章'} content={data.article} />
            </div>
          )}

          {activeTab === 'cover' && (
            <div className="editor-panel">
              <CoverGenerator
                title={data.title || data.article.split('\n')[0] || '未命名文章'}
                content={data.article}
              />
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
                <h3>🎨 批量生成封面</h3>
                <p>一次生成多个不同风格和颜色的封面</p>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowBatchGenerator(true)}
                >
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

          {activeTab === 'publish' && (
            <div className="editor-panel">
              <WeChatPublisher
                title={data.title || data.article.split('\n')[0] || '未命名文章'}
                content={data.article}
                onPublish={() => {
                  alert('文章已发布到草稿箱！')
                  setActiveTab('article')
                }}
              />
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
    </div>
  )
}

function markdownToHtml(markdown: string): string {
  let html = markdown
    .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')

  return `<p>${html}</p>`
}
