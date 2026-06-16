import { useState, useEffect, useCallback } from 'react'
import { toast } from '../components/Toast'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Zap, Save, Edit3, Palette, Settings, AlertTriangle, Plus, Trash2, Pencil, Sparkles, LayoutList, CheckCircle, ChevronRight, GripVertical } from 'lucide-react'
import { useAIReadiness, fetchServerStatus } from '../store/useConfigStore'
import { fetchArticle, saveArticle } from '../utils/apiHelpers'
import CoverGenerator from '../components/CoverGenerator'
import ImageLibrary from '../components/ImageLibrary'
import MarkdownEditor from '../components/MarkdownEditor'
import ContentStats from '../components/ContentStats'
import GenerateModal from '../components/GenerateModal'
import MaterialsCollector from '../components/MaterialsCollector'
import TaskTemplateModal from '../components/TaskTemplateModal'
import {
  TaskTemplate,
  loadAllTaskTemplates,
  deleteCustomTaskTemplate,
} from '../utils/taskTemplateStore'
import './ArticleEditor.css'

interface ArticleData {
  task: string
  materials: string
  article: string
  title: string
}

type TabId = 'task' | 'materials' | 'article' | 'analysis' | 'cover' | 'library'

// 流程步骤定义
const FLOW_STEPS: { id: TabId; label: string; check: (d: ArticleData) => boolean }[] = [
  { id: 'task',      label: '任务要求', check: d => d.task.trim().length >= 20 },
  { id: 'materials', label: '素材采集', check: d => d.materials.trim().length >= 30 },
  { id: 'article',   label: '生成文章', check: d => d.article.trim().length > 100 },
  { id: 'cover',     label: '生成封面', check: () => false }, // 无自动完成态
  { id: 'analysis',  label: '内容分析', check: () => false },
]

export default function ArticleEditor() {
  const { articleId = '' } = useParams<{ articleId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<ArticleData>({ task: '', materials: '', article: '', title: '' })
  const [loading, setLoading] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('task')
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)

  // 写作任务模板
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>(() => loadAllTaskTemplates())
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | undefined>(undefined)

  // AI 生成大纲
  const [generatingOutline, setGeneratingOutline] = useState(false)
  // 大纲编辑态：null=未生成, string=待确认的大纲内容
  const [pendingOutline, setPendingOutline] = useState<string | null>(null)

  // AI 整理素材
  const [refiningMaterials, setRefiningMaterials] = useState(false)

  const reloadTemplates = useCallback(() => {
    setTaskTemplates(loadAllTaskTemplates())
  }, [])

  useEffect(() => {
    window.addEventListener('wx-task-templates-updated', reloadTemplates)
    return () => window.removeEventListener('wx-task-templates-updated', reloadTemplates)
  }, [reloadTemplates])

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

  // ── 本地文章读写（local: 前缀） ───────────────────────────────────────────
  const isLocalArticle = articleId.startsWith('local:')
  const localStorageKey = `local_article_data_${articleId}`

  function loadLocalData(): ArticleData {
    try {
      return JSON.parse(localStorage.getItem(localStorageKey) || 'null') || { task: '', materials: '', article: '', title: '' }
    } catch {
      return { task: '', materials: '', article: '', title: '' }
    }
  }

  function saveLocalData(d: ArticleData) {
    localStorage.setItem(localStorageKey, JSON.stringify(d))
    // 同步更新本地文章列表中的标题
    const title = d.title || d.article.split('\n')[0]?.replace(/^#+\s*/, '') || ''
    if (title) {
      const articles: Array<{ id: string; title: string }> = JSON.parse(localStorage.getItem('local_articles') || '[]')
      const updated = articles.map(a => a.id === articleId ? { ...a, title, status: d.article ? 'generated' : 'draft' } : a)
      localStorage.setItem('local_articles', JSON.stringify(updated))
    }
  }

  const fetchArticleData = async () => {
    try {
      setLoading(true)
      if (isLocalArticle) {
        setData(loadLocalData())
      } else {
        const d = await fetchArticle(articleId)
        setData(d)
      }
    } catch (err) {
      console.error('加载文章失败', err)
    } finally {
      setLoading(false)
    }
  }

  // ── AI：生成大纲 → 追加到 materials ─────────────────────────────────────
  const handleGenerateOutline = async () => {
    if (!data.task || data.task.trim().length < 20) {
      toast.warn('请先填写任务要求（至少 20 字）')
      return
    }
    setGeneratingOutline(true)
    try {
      const apiId = isLocalArticle ? articleId.slice(6) : articleId
      const token = localStorage.getItem('auth_token')
      const resp = await fetch(`/api/articles/${apiId}/outline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ task: data.task, aiConfig }),
      })
      const d = await resp.json()
      if (!resp.ok) throw new Error(d.error || '生成失败')
      // 不直接追加，而是进入「待确认」状态让用户先编辑
      setPendingOutline(d.outline)
      setActiveTab('materials')
      toast.success('大纲已生成，请确认后追加到素材库')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '生成大纲失败')
    }
    setGeneratingOutline(false)
  }

  // ── AI：整理素材 ──────────────────────────────────────────────────────────
  const handleRefineMaterials = async () => {
    if (!data.materials || data.materials.trim().length < 30) {
      toast.warn('素材库内容太少，请先采集一些素材')
      return
    }
    setRefiningMaterials(true)
    try {
      const apiId = isLocalArticle ? articleId.slice(6) : articleId
      const token = localStorage.getItem('auth_token')
      const resp = await fetch(`/api/articles/${apiId}/refine-materials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ materials: data.materials, task: data.task, aiConfig }),
      })
      const d = await resp.json()
      if (!resp.ok) throw new Error(d.error || '整理失败')
      setData(prev => ({ ...prev, materials: d.refined }))
      toast.success('素材已整理完毕')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '整理素材失败')
    }
    setRefiningMaterials(false)
  }

  const handleSave = async () => {
    try {
      if (isLocalArticle) {
        saveLocalData(data)
        toast.success('已保存到本地')
      } else {
        await saveArticle(articleId, data)
        toast.success('保存成功')
      }
    } catch {
      toast.error('保存失败，请重试')
    }
  }

  const handleGenerate = () => {
    if (!apiKeyReady) {
      setGenerateError('未配置 AI API Key，请先前往「AI 配置」页面填写后再生成。')
      return
    }
    setGenerateError(null)
    setShowGenerateModal(true)
  }

  const handleGenerateComplete = (article: string) => {
    setData(prev => {
      const next = { ...prev, article }
      // 本地模式下生成完成后自动存到 localStorage
      if (isLocalArticle) saveLocalData(next)
      return next
    })
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
        <button className="wd-back-btn" onClick={() => navigate('/')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-left"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg>
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

        {/* ── 流程进度条 ── */}
        <div className="editor-flow-bar">
          {FLOW_STEPS.map((step, idx) => {
            const done = step.check(data)
            const isActive = activeTab === step.id
            return (
              <button
                key={step.id}
                className={`flow-step ${isActive ? 'flow-step--active' : ''} ${done ? 'flow-step--done' : ''}`}
                onClick={() => setActiveTab(step.id)}
              >
                <span className="flow-step-num">
                  {done ? <CheckCircle size={13} /> : idx + 1}
                </span>
                <span className="flow-step-label">{step.label}</span>
                {idx < FLOW_STEPS.length - 1 && <ChevronRight size={12} className="flow-step-sep" />}
              </button>
            )
          })}
          {/* 其余 Tab 以普通样式显示 */}
          <div className="flow-extra-tabs">
            <button
              className={`tab tab-extra ${activeTab === 'library' ? 'active' : ''}`}
              onClick={() => setActiveTab('library')}
            >
              图片库
            </button>
          </div>
        </div>

        <div className="editor-tabs" style={{ display: 'none' }}>
          {/* 隐藏旧 tabs，保留结构兼容 */}
        </div>

        <div className="editor-content">
          {activeTab === 'task' && (
            <div className="editor-panel editor-panel--task">
              {/* 模板选择栏 */}
              <div className="task-template-bar">
                <div className="task-template-list">
                  {taskTemplates.map(t => (
                    <div
                      key={t.id}
                      className="task-tmpl-chip"
                      title={t.desc}
                    >
                      <button
                        className="task-tmpl-chip-btn"
                        onClick={() => setData(prev => ({ ...prev, task: t.content }))}
                      >
                        {t.name}
                      </button>
                      {!t.isBuiltin && (
                        <span className="task-tmpl-chip-actions">
                          <button
                            className="task-tmpl-icon-btn"
                            title="编辑"
                            onClick={() => { setEditingTemplate(t); setShowTemplateModal(true) }}
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            className="task-tmpl-icon-btn task-tmpl-icon-btn--del"
                            title="删除"
                            onClick={() => {
                              if (confirm(`删除模板「${t.name}」？`)) {
                                deleteCustomTaskTemplate(t.id)
                                reloadTemplates()
                              }
                            }}
                          >
                            <Trash2 size={11} />
                          </button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  className="task-tmpl-new-btn"
                  onClick={() => { setEditingTemplate(undefined); setShowTemplateModal(true) }}
                >
                  <Plus size={13} />
                  新建模板
                </button>
                <button
                  className="task-tmpl-outline-btn"
                  onClick={handleGenerateOutline}
                  disabled={generatingOutline || !data.task}
                  title="根据任务要求生成写作大纲，追加到素材库"
                >
                  {generatingOutline
                    ? <><span className="task-outline-spin" />生成中...</>
                    : <><LayoutList size={13} />生成大纲</>}
                </button>
              </div>

              {/* 编辑区 */}
              <textarea
                value={data.task}
                onChange={e => setData(prev => ({ ...prev, task: e.target.value }))}
                placeholder={`# 写作任务要求\n\n## 基本信息\n- **文章主题**：\n- **目标字数**：1500-2000 字\n- **发布平台**：微信公众号\n\n## 结构要求\n1. 开场：直接切入痛点或场景\n2. 这是什么：解释核心概念\n3. 怎么做：分步骤说明\n4. 踩过的坑：分享真实问题\n5. 值不值得做：给出明确判断`}
                className="editor-textarea"
              />
            </div>
          )}

          {activeTab === 'materials' && (
            <div className="editor-panel editor-panel--materials">
              {/* 左侧：素材采集 */}
              <div className="materials-collector-pane">
                <div className="panel-header materials-panel-header">
                  <h3>素材采集</h3>
                  <p>搜索 / 解析 URL / 粘贴，采集后自动写入右侧素材库</p>
                </div>
                <MaterialsCollector
                  articleId={articleId}
                  searchApiKey={aiConfig.searchApiKey || ''}
                  searchProvider={aiConfig.searchProvider || 'serper'}
                  searchEngine={aiConfig.searchEngine || 'google'}
                  searxngUrl={aiConfig.searxngUrl || ''}
                  jinaApiKey={aiConfig.jinaApiKey || ''}
                  onSaved={fetchArticleData}
                />
              </div>

              {/* 右侧：素材库编辑器 */}
              <div className="materials-editor-pane">
                <div className="panel-header materials-panel-header">
                  <div className="materials-header-top">
                    <h3>素材库</h3>
                    <button
                      className="materials-refine-btn"
                      onClick={handleRefineMaterials}
                      disabled={refiningMaterials || !data.materials}
                      title="AI 读取当前素材，整理为结构化格式（会自动去重）"
                    >
                      {refiningMaterials
                        ? <><span className="task-outline-spin" />整理中...</>
                        : <><Sparkles size={12} />AI 整理+去重</>}
                    </button>
                  </div>
                  <p>materials.md — 可直接编辑，也可从左侧采集后写入</p>
                </div>

                {/* 大纲待确认卡片 */}
                {pendingOutline !== null && (
                  <div className="outline-confirm-card">
                    <div className="outline-confirm-header">
                      <div className="outline-confirm-title">
                        <GripVertical size={14} />
                        AI 生成大纲（可编辑后追加）
                      </div>
                      <button className="outline-confirm-close" onClick={() => setPendingOutline(null)}>✕</button>
                    </div>
                    <textarea
                      className="outline-confirm-editor"
                      value={pendingOutline}
                      onChange={e => setPendingOutline(e.target.value)}
                    />
                    <div className="outline-confirm-actions">
                      <button className="outline-btn-cancel" onClick={() => setPendingOutline(null)}>放弃</button>
                      <button
                        className="outline-btn-apply"
                        onClick={() => {
                          const block = `\n\n---\n\n## AI 生成大纲\n\n${pendingOutline}`
                          setData(prev => ({ ...prev, materials: prev.materials + block }))
                          setPendingOutline(null)
                          toast.success('大纲已追加到素材库')
                        }}
                      >
                        追加到素材库
                      </button>
                    </div>
                  </div>
                )}

                <textarea
                  value={data.materials}
                  onChange={e => setData(prev => ({ ...prev, materials: e.target.value }))}
                  placeholder={`# 素材整理\n\n## 核心数据\n- [数据点 1]\n\n## 踩过的坑\n### 坑1：[问题描述]\n- **问题**：\n- **原因**：\n- **解决**：\n\n## 个人观点\n- [观点 1]`}
                  className="editor-textarea"
                />
              </div>
            </div>
          )}

          {activeTab === 'article' && (
            <div className="editor-panel">
              <MarkdownEditor
                value={data.article}
                onChange={value => setData(prev => ({ ...prev, article: value }))}
                placeholder="文章将在这里显示..."
                height="600px"
                articleId={articleId}
              />
            </div>
          )}

          {activeTab === 'analysis' && (
            <div className="editor-panel">
              <ContentStats
                title={articleTitle}
                content={data.article}
                articleId={articleId}
                task={data.task}
                onArticleChange={value => setData(prev => ({ ...prev, article: value }))}
              />
            </div>
          )}

          {activeTab === 'cover' && (
            <div className="editor-panel">
              <CoverGenerator title={articleTitle} content={data.article} />
            </div>
          )}

          {activeTab === 'library' && (
            <div className="editor-panel">
              <ImageLibrary />
            </div>
          )}
        </div>
      </div>

      {showGenerateModal && (
        <GenerateModal
          articleId={isLocalArticle ? articleId.slice(6) : articleId}
          task={data.task}
          materials={data.materials}
          aiConfig={aiConfig as unknown as Record<string, unknown>}
          onComplete={handleGenerateComplete}
          onClose={() => setShowGenerateModal(false)}
        />
      )}

      {showTemplateModal && (
        <TaskTemplateModal
          initial={editingTemplate}
          onClose={() => setShowTemplateModal(false)}
          onSaved={() => reloadTemplates()}
        />
      )}
    </div>
  )
}
