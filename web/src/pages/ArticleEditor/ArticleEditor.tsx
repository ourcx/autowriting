import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from '../../components/Toast/Toast'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Zap, Save, Edit3, Palette, Settings, AlertTriangle, Plus, Trash2, Pencil, Sparkles, LayoutList, CheckCircle, ChevronRight, ChevronDown, GripVertical, User, Newspaper, BookOpen, MessageCircle, HelpCircle, Image, Link2, Link2Off } from 'lucide-react'
import { useAIReadiness, fetchServerStatus } from '../../store/useConfigStore'
import { useAuth } from '../../store/useAuth'
import { useEditingActivity } from './useEditingActivity'
import {
  fetchArticle,
  fetchCreatorWritingProfile,
  generateArticleOutline,
  recordArticleWorkflowEvent,
  refineArticleMaterials,
  saveArticle,
} from '../../utils/apiHelpers'
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
import { resolveEditorTab, resolvePublishPlatform, type EditorTab, type PublishPlatform } from '../../utils/articleNavigation'
import {
  normalizeArticleWorkflow,
  type ArticleWorkflow,
  type ArticleWorkflowEvent,
} from '../../../shared/articleWorkflow'
import type { CandidatePlatform } from '../../../shared/generationCandidate'
import {
  hasToutiaoCookies,
  hasXiaohongshuCookies,
  loadWechatCredentials,
} from '../../utils/accountBindings'
import OnboardingGuide from '../../components/OnboardingGuide/OnboardingGuide'
import { hasCompletedGuide, type GuidePage } from '../../utils/userExperience'

type TabId = EditorTab

const PUBLISH_PLATFORMS = [
  { id: 'wechat', label: '公众号', icon: MessageCircle },
  { id: 'toutiao', label: '今日头条', icon: Newspaper },
  { id: 'xiaohongshu', label: '小红书', icon: BookOpen },
] as const

const MAIN_FLOW_STEPS = [
  { id: 'task', label: '任务' },
  { id: 'materials', label: '素材' },
  { id: 'draft', label: '写作' },
  { id: 'review', label: '审核' },
  { id: 'publish', label: '发布' },
] as const

type MainFlowStep = typeof MAIN_FLOW_STEPS[number]['id']

const FLOW_TAB: Record<MainFlowStep, TabId> = {
  task: 'task',
  materials: 'materials',
  draft: 'article',
  review: 'analysis',
  publish: 'publish',
}

export default function ArticleEditor() {
  const { articleId = '' } = useParams<{ articleId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [data, setData] = useState<ArticleData>(createEmptyArticleData)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [defaultGenerationPlatform, setDefaultGenerationPlatform] = useState<CandidatePlatform>('wechat')
  const [showGuide, setShowGuide] = useState(false)
  const [guidePage, setGuidePage] = useState<GuidePage>('editor')
  const [editingTitle, setEditingTitle] = useState(false)
  // 封面是否已存在（从 localStorage 读取，CoverGenerator 生成/粘贴后更新）
  const [hasCover, setHasCover] = useState(false)
  const [workflow, setWorkflow] = useState<ArticleWorkflow>(() => normalizeArticleWorkflow(null, createEmptyArticleData()))
  const { user } = useAuth()
  const savedData = useRef(createEmptyArticleData())
  const [savedArticle, setSavedArticle] = useState("")
  const [dirty, setDirty] = useState(false)
  const [recovery, setRecovery] = useState<ArticleData | null>(null)
  const recoveryKey = `article_recovery:${user?.id || "anonymous"}:${articleId}`
  // URL records the workspace, not production progress. Refreshing never marks a step complete.
  const activeTab = resolveEditorTab(searchParams.get('tab'), workflow.currentStage)
  const publishPlatform = resolvePublishPlatform(searchParams.get('platform'))
  const setActiveTab = useCallback((tab: TabId) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      next.set('tab', tab)
      return next
    }, { replace: true })
  }, [setSearchParams])
  const selectPublishPlatform = (platform: PublishPlatform) => {
    setSearchParams({ tab: 'publish', platform }, { replace: true })
  }
  useEffect(() => {
    if (loading || loadError || searchParams.has('tab')) return
    const next = new URLSearchParams(searchParams)
    next.set('tab', resolveEditorTab(null, workflow.currentStage))
    setSearchParams(next, { replace: true })
  }, [loading, loadError, searchParams, setSearchParams, workflow.currentStage])

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
  const {
    localConfig: aiConfig,
    articleReady: apiKeyReady,
    serverStatus,
  } = useAIReadiness()

  // 首次挂载时拉一次服务端状态
  useEffect(() => { fetchServerStatus() }, [])

  useEffect(() => {
    fetchCreatorWritingProfile()
      .then(profile => {
        const preferred = profile.defaultPlatforms.find(platform => platform === 'wechat' || platform === 'toutiao')
        if (preferred) setDefaultGenerationPlatform(preferred)
      })
      .catch(() => {})
  }, [])

  // ── 本地文章读写（local: 前缀） ───────────────────────────────────────────
  const isLocalArticle = articleId.startsWith('local:')
  useEditingActivity(articleId, !loading && !loadError && !isLocalArticle)

  useEffect(() => {
    if (loading || loadError) return
    const changed = JSON.stringify(data) !== JSON.stringify(savedData.current)
    setDirty(changed)
    if (changed) {
      try { sessionStorage.setItem(recoveryKey, JSON.stringify(data)) } catch { /* Storage can be full; saving remains available. */ }
    }
    const warn = (event: BeforeUnloadEvent) => { if (changed) { event.preventDefault(); event.returnValue = "" } }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [data, loading, loadError, recoveryKey])

  const saveLocalData = useCallback((d: ArticleData) => {
    localStorage.setItem(getLocalArticleStorageKey(articleId), JSON.stringify(d))
    // 同步更新本地文章列表中的标题
    const title = d.title || d.article.split('\n')[0]?.replace(/^#+\s*/, '') || ''
    if (title) {
      const articles: Array<{ id: string; title: string }> = JSON.parse(localStorage.getItem('local_articles') || '[]')
      const updated = articles.map(a => a.id === articleId ? { ...a, title, status: d.article ? 'generated' : 'draft' } : a)
      localStorage.setItem('local_articles', JSON.stringify(updated))
    }
  }, [articleId])

  const fetchArticleData = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError(null)
      if (isLocalArticle) {
        const localData = loadLocalArticleData(articleId)
        setData(localData)
        savedData.current = localData
        setSavedArticle(localData.article)
        const stored = localStorage.getItem(`article_workflow_${articleId}`)
        setWorkflow(normalizeArticleWorkflow(stored ? JSON.parse(stored) : null, localData))
      } else {
        const d = await fetchArticle(articleId)
        setData(normalizeArticleData(d))
        savedData.current = normalizeArticleData(d)
        setSavedArticle(normalizeArticleData(d).article)
        setWorkflow(normalizeArticleWorkflow(d.workflow, d))
      }
      try {
        const cached = sessionStorage.getItem(recoveryKey)
        setRecovery(cached && cached !== JSON.stringify(savedData.current) ? normalizeArticleData(JSON.parse(cached)) : null)
      } catch { setRecovery(null) }
      setDirty(false)
    } catch (err) {
      console.error('加载文章失败', err)
      setLoadError('文章加载失败。为保护原文，当前页面已禁止保存，请重试加载。')
    } finally {
      setLoading(false)
    }
  }, [articleId, isLocalArticle, recoveryKey])

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
      savedData.current = data
      setSavedArticle(data.article)
      setDirty(false)
      setRecovery(null)
      sessionStorage.removeItem(recoveryKey)
      return true
    } catch {
      toast.error('保存失败，请重试')
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [articleId, data, isLocalArticle, loadError, loading, saveLocalData, recoveryKey])

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
        }
        if (event === 'reviewed') next.lastReviewedAt = now
        if (event === 'wechat_draft_opened') next.wechatDraftOpenedAt = now
        if (event === 'wechat_draft_pushed') {
          next.wechatDraftAt = now
          next.firstWechatDraftAt ||= now
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

  const handlePreview = useCallback(async (platform: PublishPlatform = 'wechat') => {
    const content = platform === 'toutiao' ? data.articleToutiao : data.article
    if (!content.trim()) return
    const saved = await handleSave()
    if (!saved) {
      toast.error('保存成功后才能进入预览，原文未被修改')
      return
    }
    setSearchParams({ tab: 'publish', platform }, { replace: true })
    if (platform === 'wechat') void handleWorkflowEvent('wechat_draft_opened')
  }, [data.article, data.articleToutiao, handleSave, handleWorkflowEvent, setSearchParams])

  const handleGenerate = useCallback(() => {
    if (!data.task.trim()) {
      setGenerateError('请先填写写作任务，再生成候选稿。')
      setActiveTab('task')
      return
    }
    if (!data.materials.trim()) {
      setGenerateError('请先填写或采集素材，再生成候选稿。')
      setActiveTab('materials')
      return
    }
    if (!apiKeyReady) {
      setGenerateError('未配置 AI API Key，请先前往「AI 配置」页面填写后再生成。')
      return
    }
    setGenerateError(null)
    setShowGenerateModal(true)
  }, [apiKeyReady, data.materials, data.task, setActiveTab])

  useEffect(() => {
    if (!articleId) return
    void fetchArticleData()
  }, [articleId, fetchArticleData])

  useEffect(() => {
    if (loading || !user || showGuide) return
    const page: GuidePage = activeTab === 'publish' ? 'publish' : 'editor'
    const isRealTaskEntry = page === 'publish' || (activeTab === 'task' && !data.task.trim())
    if (isRealTaskEntry && !hasCompletedGuide(user.id, page)) {
      setGuidePage(page)
      setShowGuide(true)
    }
  }, [activeTab, data.task, loading, showGuide, user])

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
  }, [data, handleGenerate, handlePreview, handleSave])

  // ── AI：生成大纲 → 追加到 materials ─────────────────────────────────────
  const handleGenerateOutline = async () => {
    if (!data.task || data.task.trim().length < 20) {
      toast.warn('请先填写任务要求（至少 20 字）')
      return
    }
    setGeneratingOutline(true)
    try {
      const apiId = isLocalArticle ? articleId.slice(6) : articleId
      // 不直接追加，而是进入「待确认」状态让用户先编辑
      setPendingOutline(await generateArticleOutline(apiId, data.task, aiConfig))
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
      const refined = await refineArticleMaterials(apiId, data.materials, data.task, aiConfig)
      setData(prev => ({ ...prev, materials: refined }))
      toast.success('素材已整理完毕')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '整理素材失败')
    }
    setRefiningMaterials(false)
  }

  const handleGenerateComplete = async (article: string, articleToutiao: string, platforms: 'both' | 'wechat' | 'toutiao', candidateId?: string) => {
    const next = { ...data, ...(article ? { article } : {}), ...(articleToutiao ? { articleToutiao } : {}) }
    // Candidate generation never writes the mother draft. Persist selection before closing the dialog.
    if (isLocalArticle) saveLocalData(next)
    else {
      const result = await saveArticle(articleId, { ...next, ...(platforms === 'wechat' ? { selectedCandidateId: candidateId } : {}) })
      if (result.workflow) setWorkflow(result.workflow)
    }
    savedData.current = next
    setSavedArticle(next.article)
    setDirty(false)
    sessionStorage.removeItem(recoveryKey)
    setData(next)
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
    if (platforms !== 'toutiao' && isLocalArticle) void handleWorkflowEvent('generated')
  }

  const articleTitle = data.title || data.article.split('\n')[0]?.replace(/^#+\s*/, '') || `文章 ${articleId}`
  const bodyChanged = data.article !== savedArticle
  const reviewDone = Boolean(workflow.lastReviewedAt) && !bodyChanged
  const publishDone = Boolean(workflow.wechatDraftAt) && !bodyChanged
  const generationPlatform: CandidatePlatform = activeTab === 'toutiao'
    || (activeTab === 'publish' && publishPlatform === 'toutiao')
    ? 'toutiao'
    : activeTab === 'article'
      ? 'wechat'
      : defaultGenerationPlatform
  const activeFlowStep: MainFlowStep | null = activeTab === 'task'
    ? 'task'
    : activeTab === 'materials'
      ? 'materials'
    : activeTab === 'article'
      ? 'draft'
      : activeTab === 'analysis'
        ? 'review'
        : activeTab === 'publish' || activeTab === 'toutiao' || activeTab === 'xiaohongshu'
          ? 'publish'
          : null
  const publishAccountConnected = publishPlatform === 'wechat'
    ? Boolean(loadWechatCredentials())
    : publishPlatform === 'toutiao'
      ? hasToutiaoCookies()
      : hasXiaohongshuCookies()

  const flowStepDone = (step: MainFlowStep) => {
    if (step === 'task') return Boolean(data.task.trim())
    if (step === 'materials') return Boolean(data.materials.trim())
    if (step === 'draft') return Boolean(data.article.trim())
    if (step === 'review') return reviewDone
    return publishDone
  }

  const openFlowStep = (step: MainFlowStep) => {
    if (step === 'publish') {
      void handlePreview()
      return
    }
    setActiveTab(FLOW_TAB[step])
  }

  const nextActionLabel = activeTab === 'task'
    ? '下一步：填写素材'
    : activeTab === 'materials'
      ? '下一步：进入写作'
      : activeTab === 'article'
        ? '下一步：审核定稿'
        : activeTab === 'analysis'
          ? '下一步：选择平台发布'
          : activeTab === 'toutiao'
            ? data.articleToutiao.trim() ? '下一步：发布今日头条' : '生成今日头条版本'
            : activeTab === 'xiaohongshu'
              ? '下一步：发布小红书'
              : ''
  const nextActionDisabled = activeTab === 'task'
    ? !data.task.trim()
    : activeTab === 'materials'
      ? !data.materials.trim()
      : activeTab === 'article'
        ? !data.article.trim()
        : activeTab === 'analysis' || activeTab === 'xiaohongshu'
          ? !data.article.trim()
          : activeTab === 'toutiao'
            ? data.articleToutiao.trim()
              ? false
              : !data.task.trim() || !data.materials.trim() || !apiKeyReady
            : false
  const showGenerateAction = activeTab === 'materials'
    || activeTab === 'article'
    || activeTab === 'analysis'
    || activeTab === 'toutiao'
  const generationReady = Boolean(data.task.trim() && data.materials.trim() && apiKeyReady)
  const generationActionLabel = generationPlatform === 'toutiao'
    ? data.articleToutiao.trim() ? '继续生成头条候选稿' : '生成头条候选稿'
    : data.article.trim() ? '继续生成候选稿' : '生成候选稿'
  const generationActionTitle = !data.task.trim()
    ? '请先填写写作任务'
    : !data.materials.trim()
      ? '请先填写或采集素材'
      : !apiKeyReady
        ? '请先配置 AI API Key'
        : generationActionLabel

  function handleNextAction() {
    if (activeTab === 'task') setActiveTab('materials')
    else if (activeTab === 'materials') setActiveTab('article')
    else if (activeTab === 'article') setActiveTab('analysis')
    else if (activeTab === 'analysis') void handlePreview()
    else if (activeTab === 'toutiao') {
      if (data.articleToutiao.trim()) void handlePreview('toutiao')
      else handleGenerate()
    }
    else if (activeTab === 'xiaohongshu') void handlePreview('xiaohongshu')
  }

  const publishContent = publishPlatform === 'toutiao' ? data.articleToutiao : data.article
  const publishTitle = publishPlatform === 'xiaohongshu' ? data.xiaohongshuTitle || articleTitle : articleTitle

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
              <span>{articleTitle}</span>
              <Edit3 size={16} className="edit-icon" />
            </h2>
          )}
        </div>}
        onBack={() => navigate('/')}
        actions={<div className="header-actions">
          <button
            className="btn btn-ghost"
            onClick={() => navigate('/account?tab=writing')}
            title="管理写作 DNA、长期背景和创作证据"
            aria-label="写作资产"
          >
            <User size={16} />
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => navigate('/settings')}
            title="AI 模型和 API Key 配置"
            aria-label="AI 配置"
          >
            <Settings size={16} />
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => navigate('/styles')}
            title="管理 CSS 样式模板"
            aria-label="管理样式"
          >
            <Palette size={16} />
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setGuidePage(activeTab === 'publish' ? 'publish' : 'editor')
              setShowGuide(true)
            }}
            title="查看当前页引导"
            aria-label="查看当前页引导"
          >
            <HelpCircle size={16} />
          </button>
          <button className="btn btn-secondary" title={saving ? '保存中' : '保存'} aria-label={saving ? '保存中' : '保存'} onClick={() => void handleSave()} disabled={saving || loading}>
            <Save size={20} />
          </button>
        </div>}
      />

      {/* Tabs + 内容区 */}
      <div className="editor-container">

        {/* ── 流程进度条 ── */}
        <div className="editor-flow-wrap" data-onboarding="editor-workflow">
          <div className="editor-flow-bar">
            {MAIN_FLOW_STEPS.map((step, idx) => {
              const done = flowStepDone(step.id)
              const isActive = activeFlowStep === step.id
              return (
                <button
                  key={step.id}
                  className={`flow-step ${isActive ? 'flow-step--active' : ''} ${done ? 'flow-step--done' : ''}`}
                  aria-current={isActive ? 'step' : undefined}
                  onClick={() => openFlowStep(step.id)}
                  disabled={step.id === 'publish' && (!data.article.trim() || saving)}
                >
                  <span className="flow-step-num">
                    {done ? <CheckCircle size={13} /> : idx + 1}
                  </span>
                  <span className="flow-step-label">{step.label}</span>
                  {idx < MAIN_FLOW_STEPS.length - 1 && <ChevronRight size={12} className="flow-step-sep" />}
                </button>
              )
            })}

            <div className="editor-secondary-nav">
              <details className="editor-menu">
                <summary><Newspaper size={15} />平台版本<ChevronDown size={13} /></summary>
                <div className="editor-menu-popover">
                  <button className={activeTab === 'toutiao' ? 'active' : ''} onClick={() => setActiveTab('toutiao')}>
                    <Newspaper size={15} /><span><strong>今日头条版本</strong><small>{data.articleToutiao.trim() ? '正文已就绪' : '待生成'}</small></span>
                  </button>
                  <button className={activeTab === 'xiaohongshu' ? 'active' : ''} onClick={() => setActiveTab('xiaohongshu')}>
                    <BookOpen size={15} /><span><strong>小红书版本</strong><small>复用母稿并设置标题</small></span>
                  </button>
                </div>
              </details>
              <details className="editor-menu">
                <summary><Image size={15} />辅助工具<ChevronDown size={13} /></summary>
                <div className="editor-menu-popover editor-menu-popover--right">
                  <button className={activeTab === 'cover' ? 'active' : ''} onClick={() => setActiveTab('cover')}>
                    <Image size={15} /><span><strong>封面</strong><small>{hasCover ? '已有封面' : '生成或上传封面'}</small></span>
                  </button>
                  <button className={activeTab === 'library' ? 'active' : ''} onClick={() => setActiveTab('library')}>
                    <LayoutList size={15} /><span><strong>图片库</strong><small>管理正文图片</small></span>
                  </button>
                </div>
              </details>
            </div>
          </div>
        </div>

        <div className="editor-tabs" style={{ display: 'none' }}>
          {/* 隐藏旧 tabs，保留结构兼容 */}
        </div>

        <div className="editor-content">
          <div className="editor-save-status" role="status">
            {dirty ? "有未保存的修改 · 本标签页已保留恢复副本" : isLocalArticle ? "已保存在此浏览器" : "已保存到服务器 · 文章列表可继续编辑"}
            <span> · 活跃编辑约 {Math.round((workflow.activeEditingMs || 0) / 60000)} 分钟 · 审核后返工 {workflow.reworkCount || 0} 次</span>
            {workflow.selectedCandidateId && <span> · 已记录候选稿选择</span>}
          </div>
          {recovery && <div className="editor-save-status">
            检测到上次未保存的修改。
            <button className="btn btn-secondary btn-small" onClick={() => { setData(recovery); setRecovery(null) }}>恢复修改</button>
            <button className="btn btn-secondary btn-small" onClick={() => { sessionStorage.removeItem(recoveryKey); setRecovery(null) }}>使用已保存版本</button>
          </div>}
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
                  wechatCollectorReady={serverStatus?.wechatCollectorReady}
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
              <div className="platform-edit-head">
                <div className="editor-platform-label editor-platform-label--toutiao">今日头条版本</div>
              </div>
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
              <div className="platform-edit-head">
                <div className="editor-platform-label editor-platform-label--xiaohongshu">小红书长文</div>
              </div>
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
              <ProductionGuidance article={data.article} materials={data.materials} articleToutiao={data.articleToutiao} workflow={workflow}
                articleId={isLocalArticle ? undefined : articleId} onBeforeFeedback={handleSave} onWorkflow={setWorkflow} />
              <ContentStats
                title={articleTitle}
                content={data.article}
                articleId={isLocalArticle ? articleId.slice(6) : articleId}
                task={data.task}
                onArticleChange={value => setData(prev => ({ ...prev, article: value }))}
                onReviewCompleted={() => void (async () => { if (await handleSave()) await handleWorkflowEvent('reviewed') })()}
              />
            </div>
          )}

          {activeTab === 'publish' && (
            <div className="editor-panel editor-panel--publish">
              <div className="publish-workbench-head">
                <div>
                  <h3>{publishPlatform === 'wechat' ? '公众号预览与推送' : `${publishPlatform === 'toutiao' ? '今日头条' : '小红书'}预览与发布`}</h3>
                  {publishDone && <p><CheckCircle size={13} /> 已推送微信草稿</p>}
                </div>
                <div className={`publish-account-status ${publishAccountConnected ? 'is-ready' : ''}`} data-onboarding="publish-account-status">
                  {publishAccountConnected ? <Link2 size={15} /> : <Link2Off size={15} />}
                  <span>{publishAccountConnected ? '账号已连接' : '账号未连接'}</span>
                  <button onClick={() => navigate('/account')}>{publishAccountConnected ? '管理' : '去连接'}</button>
                </div>
              </div>
              <div className="publish-platforms" role="group" aria-label="发布平台" data-onboarding="publish-platforms">
                {PUBLISH_PLATFORMS.map(platform => (
                  <button key={platform.id} className={`publish-platform publish-platform--${platform.id}`} aria-pressed={publishPlatform === platform.id} onClick={() => selectPublishPlatform(platform.id)}>
                    <platform.icon size={18} />
                    <strong>{platform.label}</strong>
                    <span>{platform.id === 'wechat' && publishDone ? '已推送草稿' : (platform.id === 'toutiao' ? data.articleToutiao : data.article).trim() ? '正文已就绪' : '待补正文'}</span>
                  </button>
                ))}
              </div>
              <div className="publish-workbench-body" data-onboarding="publish-workbench">
                {publishContent.trim() ? <WeChatRenderer
                  content={publishContent}
                  title={publishTitle}
                  articleId={articleId}
                  platformMode={publishPlatform}
                  onDraftPushed={() => { if (!isLocalArticle) void fetchArticle(articleId).then(result => setWorkflow(normalizeArticleWorkflow(result.workflow, result))) }}
                /> : <div className="publish-empty">
                  <BookOpen size={28} />
                  <h3>{publishPlatform === 'toutiao' ? '今日头条版本尚未生成' : '尚未添加正文'}</h3>
                  <button className="btn btn-primary" onClick={() => setActiveTab(publishPlatform === 'toutiao' ? 'toutiao' : 'article')}>
                    <Edit3 size={16} />去编辑正文
                  </button>
                  <button className="btn btn-secondary" onClick={handleGenerate} disabled={!data.task.trim() || !data.materials.trim()}>
                    <Zap size={16} />生成文章
                  </button>
                </div>}
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
        {nextActionLabel && (
          <div className={`editor-next-dock ${showGenerateAction ? 'editor-next-dock--with-generate' : ''}`}>
            {showGenerateAction && (
              <button
                className="flow-generate-action"
                onClick={handleGenerate}
                disabled={saving || !generationReady}
                title={generationActionTitle}
              >
                <Zap size={16} />
                {generationActionLabel}
              </button>
            )}
            <button
              className="flow-next-action"
              onClick={handleNextAction}
              disabled={saving || nextActionDisabled}
              data-onboarding="next-action"
            >
              {nextActionLabel}
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {showGenerateModal && (
        <GenerateModal
          articleId={articleId}
          task={data.task}
          materials={data.materials}
          sourceArticle={data.article}
          aiConfig={aiConfig as unknown as Record<string, unknown>}
          initialPlatform={generationPlatform}
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
      {showGuide && user && (
        <OnboardingGuide page={guidePage} userId={user.id} run={showGuide} onClose={() => setShowGuide(false)} />
      )}
    </div>
  )
}
