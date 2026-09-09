import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from '../../components/Toast/Toast'
// @ts-ignore
import { useParams, useNavigate } from 'react-router-dom'
import { Zap, Save, Edit3, Palette, Settings, AlertTriangle, Plus, Trash2, Pencil, Sparkles, LayoutList, CheckCircle, ChevronRight, GripVertical, Send, User } from 'lucide-react'
import { useAIReadiness, fetchServerStatus } from '../../store/useConfigStore'
import { fetchArticle, recordArticleWorkflowEvent, saveArticle } from '../../utils/apiHelpers'
import {
  ArticleData,
  createEmptyArticleData,
  getLocalArticleStorageKey,
  loadLocalArticleData,
  normalizeArticleData,
} from '../../utils/articleData'
import CoverGenerator from '../../components/CoverGenerator/CoverGenerator'
import ImageLibrary from '../../components/ImageLibrary/ImageLibrary'
import MarkdownEditor from '../../components/MarkdownEditor/MarkdownEditor'
import ContentStats from '../../components/ContentStats/ContentStats'
import WeChatRenderer from '../../components/WeChatRenderer/WeChatRenderer'
import GenerateModal from '../../components/GenerateModal/GenerateModal'
import MaterialsCollector from '../../components/MaterialsCollector/MaterialsCollector'
import TaskTemplateModal from '../../components/TaskTemplateModal/TaskTemplateModal'
import PageHeader from '../../components/PageHeader/PageHeader'
import ProductionGuidance, { PlatformVersionSummary } from '../../components/ProductionGuidance/ProductionGuidance'
import {
  TaskTemplate,
  loadAllTaskTemplates,
  deleteCustomTaskTemplate,
} from '../../utils/taskTemplateStore'
import './ArticleEditor.css'
import {
  normalizeArticleWorkflow,
  type ArticleWorkflow,
  type ArticleWorkflowEvent,
} from '../../../shared/articleWorkflow'

type TabId = 'task' | 'materials' | 'article' | 'toutiao' | 'xiaohongshu' | 'analysis' | 'publish' | 'cover' | 'library'

// 流程步骤定义（cover 的 check 在组件内动态注入）
const BASE_FLOW_STEPS: { id: TabId; label: string; check: (d: ArticleData) => boolean }[] = [
  { id: 'task',      label: '任务', check: d => d.task.trim().length >= 20 },
  { id: 'materials', label: '素材', check: d => d.materials.trim().length >= 30 },
  { id: 'article',   label: '写作', check: d => d.article.trim().length > 100 },
  { id: 'analysis',  label: '审核', check: () => false },
  { id: 'publish',   label: '发布', check: () => false },
]

export default function ArticleEditor() {
  const { articleId = '' } = useParams<{ articleId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<ArticleData>(createEmptyArticleData)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('task')
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  // 封面是否已存在（从 localStorage 读取，CoverGenerator 生成/粘贴后更新）
  const [hasCover, setHasCover] = useState(false)
  const [workflow, setWorkflow] = useState<ArticleWorkflow>(() => normalizeArticleWorkflow(null, createEmptyArticleData()))

  // articleId 确定后同步检查封面状态（刷新后也能正确勾选）
  useEffect(() => {
    if (!articleId) return
    setHasCover(!!localStorage.getItem(`cover_image_${articleId}`))
  }, [articleId])

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

  // ── 本地文章读写（local: 前缀） ───────────────────────────────────────────
  const isLocalArticle = articleId.startsWith('local:')

  function loadLocalData(): ArticleData {
    return loadLocalArticleData(articleId)
  }

  function saveLocalData(d: ArticleData) {
    localStorage.setItem(getLocalArticleStorageKey(articleId), JSON.stringify(d))
    // 同步更新本地文章列表中的标题
    const title = d.title || d.article.split('\n')[0]?.replace(/^#+\s*/, '') || ''
    if (title) {
      const articles: Array<{ id: string; title: string }> = JSON.parse(localStorage.getItem('local_articles') || '[]')
      const updated = articles.map(a => a.id === articleId ? { ...a, title, status: d.article ? 'generated' : 'draft' } : a)
      localStorage.setItem('local_articles', JSON.stringify(updated))
    }
  }

  async function fetchArticleData() {
    try {
      setLoading(true)
      setLoadError(null)
      if (isLocalArticle) {
        const localData = loadLocalData()
        setData(localData)
        const stored = localStorage.getItem(`article_workflow_${articleId}`)
        setWorkflow(normalizeArticleWorkflow(stored ? JSON.parse(stored) : null, localData))
      } else {
        const d = await fetchArticle(articleId)
        setData(normalizeArticleData(d))
        setWorkflow(normalizeArticleWorkflow(d.workflow, d))
      }
    } catch (err) {
      console.error('加载文章失败', err)
      setLoadError('文章加载失败。为保护原文，当前页面已禁止保存，请重试加载。')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current || loading || loadError) return false
    try {
      savingRef.current = true
      setSaving(true)
      if (isLocalArticle) {
        saveLocalData(data)
        toast.success('已保存到本地')
      } else {
        const result = await saveArticle(articleId, data)
        if (result.workflow) setWorkflow(result.workflow)
        toast.success('保存成功')
      }
      return true
    } catch {
      toast.error('保存失败，请重试')
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [articleId, data, isLocalArticle, loadError, loading, saveLocalData])

  const handleWorkflowEvent = useCallback(async (event: ArticleWorkflowEvent, metadata?: { templateId?: string }) => {
    try {
      if (isLocalArticle) {
        const now = new Date().toISOString()
        const next = { ...workflow, updatedAt: now }
        if (event === 'generated' && !next.firstGeneratedAt) next.firstGeneratedAt = now
        if (event === 'generated') {
          delete next.lastReviewedAt
          delete next.wechatDraftOpenedAt
          delete next.wechatDraftAt
          delete next.publishContext
        }
        if (event === 'reviewed') next.lastReviewedAt = now
        if (event === 'wechat_draft_opened') next.wechatDraftOpenedAt = now
        if (event === 'wechat_draft_pushed') {
          next.wechatDraftAt = now
          if (metadata?.templateId) next.publishContext = { templateId: metadata.templateId }
        }
        const normalized = normalizeArticleWorkflow(next, data, next.createdAt)
        localStorage.setItem(`article_workflow_${articleId}`, JSON.stringify(normalized))
        setWorkflow(normalized)
        return
      }
      setWorkflow(await recordArticleWorkflowEvent(articleId, event, metadata))
    } catch {
      toast.warn('正文操作已完成，但文章进度记录失败')
    }
  }, [articleId, data, isLocalArticle, workflow])

  const handlePreview = useCallback(async () => {
    if (!data.article.trim()) return
    const saved = await handleSave()
    if (!saved) {
      toast.error('保存成功后才能进入预览，原文未被修改')
      return
    }
    setActiveTab('publish')
    void handleWorkflowEvent('wechat_draft_opened')
  }, [data.article, handleSave, handleWorkflowEvent])

  function handleGenerate() {
    if (!apiKeyReady) {
      setGenerateError('未配置 AI API Key，请先前往「AI 配置」页面填写后再生成。')
      return
    }
    setGenerateError(null)
    setShowGenerateModal(true)
  }

  useEffect(() => {
    if (!articleId) return
    fetchArticleData()
  }, [articleId])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void handleSave()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault()
        if (data.task && data.materials) handleGenerate()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault()
        void handlePreview()
      }
      if (e.key === 'Escape') {
        setShowGenerateModal(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [data, handlePreview, handleSave])

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

  const handleGenerateComplete = (article: string, articleToutiao: string, platforms: 'both' | 'wechat' | 'toutiao') => {
    setData(prev => {
      const next = {
        ...prev,
        ...(article ? { article } : {}),
        ...(articleToutiao ? { articleToutiao } : {}),
      }
      // 本地模式下生成完成后自动存到 localStorage
      if (isLocalArticle) saveLocalData(next)
      return next
    })
    // 跳转到对应 tab
    if (platforms === 'toutiao') {
      setActiveTab('toutiao')
    } else {
      setActiveTab('article')
    }
    const msg = platforms === 'wechat' ? '公众号文章已生成'
      : platforms === 'toutiao' ? '今日头条文章已生成'
      : '公众号 + 今日头条两篇文章已生成'
    toast.success(msg)
    void handleWorkflowEvent('generated')
  }

  const articleTitle = data.title || data.article.split('\n')[0]?.replace(/^#+\s*/, '') || `文章 ${articleId}`
  const reviewDone = Boolean(workflow.lastReviewedAt)
  const publishDone = Boolean(workflow.wechatDraftAt)

  const nextAction = data.task.trim().length < 20
    ? { label: '下一步：完善任务', action: () => setActiveTab('task') }
    : data.materials.trim().length < 30
      ? { label: '下一步：收集素材', action: () => setActiveTab('materials') }
      : data.article.trim().length <= 100
        ? { label: '下一步：生成文章', action: handleGenerate }
        : !reviewDone
          ? { label: '下一步：审核内容', action: () => setActiveTab('analysis') }
          : { label: publishDone ? '查看微信草稿' : '下一步：预览并推送', action: () => void handlePreview() }

  if (loading) {
    return (
      <div className="editor-loading">
        <div className="spinner" />
        <p>加载中...</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="editor-loading">
        <AlertTriangle size={24} />
        <p>{loadError}</p>
        <button className="btn btn-primary" onClick={() => void fetchArticleData()}>
          重新加载
        </button>
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

      <PageHeader
        title={<div className="header-title">
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
        </div>}
        onBack={() => navigate('/')}
        actions={<div className="header-actions">
          <button
            className="btn btn-ghost"
            onClick={() => navigate('/account')}
            title="设置账号受众、语气和禁用表达"
          >
            <User size={16} />
            写作档案
          </button>
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
          <button className="btn btn-secondary" onClick={() => void handleSave()} disabled={saving || loading}>
            <Save size={20} />
            {saving ? '保存中...' : '保存'}
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
              onClick={() => void handlePreview()}
              title="在当前工作台预览并推送公众号草稿 (Cmd+P)"
            >
              <Send size={18} />
              预览并推送
            </button>
          )}
        </div>}
      />

      {/* Tabs + 内容区 */}
      <div className="editor-container">

        {/* ── 流程进度条 ── */}
        <div className="editor-flow-bar">
          {BASE_FLOW_STEPS.map((step, idx) => {
            const done = step.id === 'analysis'
              ? reviewDone
              : step.id === 'publish'
                ? publishDone
                : step.check(data)
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
                {idx < BASE_FLOW_STEPS.length - 1 && <ChevronRight size={12} className="flow-step-sep" />}
              </button>
            )
          })}
          {/* 其余 Tab 以普通样式显示 */}
          <div className="flow-extra-tabs">
            <span className="flow-extra-label">平台与素材</span>
            <button
              className={`tab tab-extra ${activeTab === 'toutiao' ? 'active' : ''}`}
              onClick={() => setActiveTab('toutiao')}
            >
              头条
            </button>
            <button
              className={`tab tab-extra ${activeTab === 'xiaohongshu' ? 'active' : ''}`}
              onClick={() => setActiveTab('xiaohongshu')}
            >
              小红书
            </button>
            <button
              className={`tab tab-extra ${activeTab === 'cover' ? 'active' : ''}`}
              onClick={() => setActiveTab('cover')}
            >
              {hasCover ? '封面 ✓' : '封面'}
            </button>
            <button
              className={`tab tab-extra ${activeTab === 'library' ? 'active' : ''}`}
              onClick={() => setActiveTab('library')}
            >
              图片库
            </button>
          </div>
          <button className="flow-next-action" onClick={nextAction.action}>
            {nextAction.label}
            <ChevronRight size={14} />
          </button>
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
                  glmApiKey={aiConfig.glmApiKey || aiConfig.articleApiKey || ''}
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
              <div className="editor-platform-label editor-platform-label--wechat">公众号母稿 · 统一事实与观点</div>
              <MarkdownEditor
                value={data.article}
                onChange={value => setData(prev => ({ ...prev, article: value }))}
                placeholder="公众号文章将在这里显示..."
                height="600px"
                articleId={articleId}
              />
            </div>
          )}

          {activeTab === 'toutiao' && (
            <div className="editor-panel">
              <div className="editor-platform-label editor-platform-label--toutiao">今日头条版本</div>
              <PlatformVersionSummary source={data.article} target={data.articleToutiao} platform="toutiao" />
              <MarkdownEditor
                value={data.articleToutiao}
                onChange={value => setData(prev => ({ ...prev, articleToutiao: value }))}
                placeholder="今日头条文章将在这里显示..."
                height="600px"
                articleId={articleId}
              />
            </div>
          )}

          {activeTab === 'xiaohongshu' && (
            <div className="editor-panel editor-panel--xiaohongshu">
              <div className="editor-platform-label editor-platform-label--xiaohongshu">小红书长文</div>
              <div className="xiaohongshu-title-card">
                <div>
                  <h3>复用公众号正文</h3>
                  <p>小红书不会额外生成文章，发布时直接使用公众号正文；仅需设置独立标题。</p>
                </div>
                <label className="xiaohongshu-title-field">
                  <span>小红书标题 <em>{Array.from(data.xiaohongshuTitle).length} 字</em></span>
                  <input
                    value={data.xiaohongshuTitle}
                    onChange={event => setData(prev => ({ ...prev, xiaohongshuTitle: event.target.value }))}
                    placeholder={articleTitle || '输入小红书发布标题'}
                  />
                </label>
              </div>
              <MarkdownEditor
                value={data.article}
                onChange={value => setData(prev => ({ ...prev, article: value }))}
                placeholder="请先在公众号页生成或编辑文章正文..."
                height="500px"
                articleId={articleId}
              />
            </div>
          )}

          {activeTab === 'analysis' && (
            <div className="editor-panel">
              <ProductionGuidance article={data.article} materials={data.materials} articleToutiao={data.articleToutiao} workflow={workflow} />
              <ContentStats
                title={articleTitle}
                content={data.article}
                articleId={isLocalArticle ? articleId.slice(6) : articleId}
                task={data.task}
                onArticleChange={value => setData(prev => ({ ...prev, article: value }))}
                onReviewCompleted={() => void handleWorkflowEvent('reviewed')}
              />
            </div>
          )}

          {activeTab === 'publish' && (
            <div className="editor-panel editor-panel--publish">
              <div className="publish-workbench-head">
                <div>
                  <h3>公众号预览与推送</h3>
                  <p>选择样式、封面并推送草稿都在当前文章内完成。</p>
                </div>
                <button className="btn btn-secondary btn-small" onClick={() => navigate(`/preview/${articleId}`)}>
                  打开独立预览
                </button>
              </div>
              <div className="publish-workbench-body">
                <WeChatRenderer
                  content={data.article}
                  title={articleTitle}
                  articleId={articleId}
                  platformMode="wechat"
                  onDraftPushed={context => void handleWorkflowEvent('wechat_draft_pushed', context)}
                />
              </div>
            </div>
          )}

          {activeTab === 'cover' && (
            <div className="editor-panel">
              <CoverGenerator
                title={articleTitle}
                content={data.article}
                articleId={articleId}
                onCoverGenerated={() => setHasCover(true)}
              />
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
          sourceArticle={data.article}
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
