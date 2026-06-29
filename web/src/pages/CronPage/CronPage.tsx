import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import {
  ArrowLeft, Plus, Play, Pause, Trash2, RefreshCw, Clock,
  CheckCircle2, XCircle, AlertCircle, ChevronDown, Settings,
  Eye, EyeOff, Zap, TrendingUp, FileText, Paintbrush, Send, Activity,
} from 'lucide-react'
import { useAIReadiness, fetchServerStatus } from '../../store/useConfigStore'
import { loadAIConfig } from '../../utils/aiConfig'
import './CronPage.css'

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface CronJob {
  id: string
  name: string
  cronExpr: string
  enabled: boolean
  topic: string
  stylePrompt: string
  coverPrompt: string
  aiConfig: Record<string, string>
  wxAppId: string
  wxAppSecret: string
  lastRunAt: string | null
  nextRunAt: string | null
  runCount: number
  createdAt: string
  updatedAt: string
}

interface CronStep {
  step: string
  status: 'running' | 'success' | 'error' | 'warn' | 'skip'
  msg: string
  time: string
  topic?: string
  title?: string
}

interface CronLog {
  id: number
  jobId: string
  status: 'running' | 'success' | 'error'
  topic: string | null
  articleTitle: string | null
  articleId: string | null
  mediaId: string | null
  steps: CronStep[]
  errorMsg: string | null
  startedAt: string
  finishedAt: string | null
}

// ── Cron 预设 ─────────────────────────────────────────────────────────────────

const CRON_PRESETS = [
  { label: '每天 08:00', value: '0 8 * * *' },
  { label: '每天 12:00', value: '0 12 * * *' },
  { label: '每天 20:00', value: '0 20 * * *' },
  { label: '每周一 08:00', value: '0 8 * * 1' },
  { label: '每周三 08:00', value: '0 8 * * 3' },
  { label: '每周五 08:00', value: '0 8 * * 5' },
  { label: '工作日 08:00', value: '0 8 * * 1-5' },
  { label: '每小时', value: '0 * * * *' },
]

// ── Pipeline 步骤定义 ─────────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { key: 'trending', label: '热点抓取', icon: TrendingUp, color: 'peach' },
  { key: 'generate', label: '文章生成', icon: FileText, color: 'lavender' },
  { key: 'style', label: '样式生成', icon: Paintbrush, color: 'ochre' },
  { key: 'html', label: 'HTML 转换', icon: FileText, color: 'mint' },
  { key: 'publish', label: '推送草稿箱', icon: Send, color: 'pink' },
]

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function formatTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtDuration(startedAt: string, finishedAt: string | null) {
  if (!finishedAt) return '进行中'
  const s = Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function cronToHuman(expr: string) {
  const map: Record<string, string> = {
    '0 8 * * *': '每天 08:00',
    '0 12 * * *': '每天 12:00',
    '0 20 * * *': '每天 20:00',
    '0 8 * * 1': '每周一 08:00',
    '0 8 * * 3': '每周三 08:00',
    '0 8 * * 5': '每周五 08:00',
    '0 8 * * 1-5': '工作日 08:00',
    '0 * * * *': '每小时',
  }
  return map[expr] || expr
}

function emptyForm(): Partial<CronJob> {
  return { name: '', cronExpr: '0 8 * * *', enabled: true, topic: '', stylePrompt: '', coverPrompt: '', wxAppId: '', wxAppSecret: '', aiConfig: {} }
}

// ── Pipeline 可视化 ───────────────────────────────────────────────────────────

function PipelineViz({ steps, compact = false }: { steps: CronStep[], compact?: boolean }) {
  return (
    <div className={`pipeline${compact ? ' pipeline--compact' : ''}`}>
      {PIPELINE_STEPS.map((def, i) => {
        const found = steps.find(s => s.step === def.key)
        const status = found?.status ?? 'pending'
        const isDone = status === 'success'
        const hasNext = i < PIPELINE_STEPS.length - 1

        return (
          <React.Fragment key={def.key}>
            <div className="pipeline-step">
              <div className={`pipeline-node pipeline-node--${status} pipeline-node--color-${def.color}`}>
                <def.icon size={compact ? 10 : 13} />
              </div>
              {!compact && <div className="pipeline-label">{def.label}</div>}
              {!compact && found?.msg && <div className="pipeline-msg">{found.msg}</div>}
              {compact && <div className="pipeline-label-compact">{def.label}</div>}
            </div>
            {hasNext && (
              <div className={`pipeline-connector${isDone ? ' pipeline-connector--done' : ''}`} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ── 状态徽章 ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CronLog['status'] }) {
  const map = {
    success: { cls: 'badge--ok', label: '成功' },
    error: { cls: 'badge--err', label: '失败' },
    running: { cls: 'badge--run', label: '运行中' },
  }
  const { cls, label } = map[status]
  return <span className={`status-badge ${cls}`}>{label}</span>
}

// ══════════════════════════════════════════════════════════════════════════════
// 主页面
// ══════════════════════════════════════════════════════════════════════════════

export default function CronPage() {
  const navigate = useNavigate()
  const { articleReady } = useAIReadiness()
  useEffect(() => { fetchServerStatus() }, [])

  const [jobs, setJobs] = useState<CronJob[]>([])
  const [logs, setLogs] = useState<CronLog[]>([])
  const [loading, setLoading] = useState(false)
  const [jobLogs, setJobLogs] = useState<Record<string, CronLog[]>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [expandedLog, setExpandedLog] = useState<number | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<CronJob>>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [showAiKey, setShowAiKey] = useState(false)
  const [running, setRunning] = useState<string | null>(null)

  // ── 数据 ──────────────────────────────────────────────────────────────────

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try { const { data } = await axios.get('/api/cron/jobs'); setJobs(data) } catch { /**/ }
    setLoading(false)
  }, [])

  const loadLogs = useCallback(async () => {
    try { const { data } = await axios.get('/api/cron/logs?limit=20'); setLogs(data) } catch { /**/ }
  }, [])

  const loadJobLogs = useCallback(async (jobId: string) => {
    try {
      const { data } = await axios.get(`/api/cron/jobs/${jobId}/logs?limit=10`)
      setJobLogs(prev => ({ ...prev, [jobId]: data }))
    } catch { /**/ }
  }, [])

  useEffect(() => { loadJobs(); loadLogs() }, [loadJobs, loadLogs])

  // ── 操作 ──────────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditing(null)
    // 新建时从 localStorage 预填 AI 配置，用户可按需修改
    const localAI = loadAIConfig()
    const preAiConfig: Record<string, string> = {}
    if (localAI.articleProvider) preAiConfig.articleProvider = localAI.articleProvider
    if (localAI.articleApiKey) preAiConfig.articleApiKey = localAI.articleApiKey
    if (localAI.articleBaseUrl) preAiConfig.articleBaseUrl = localAI.articleBaseUrl
    if (localAI.articleModel) preAiConfig.articleModel = localAI.articleModel
    if (localAI.maasApiKey) preAiConfig.maasApiKey = localAI.maasApiKey
    if (localAI.maasBaseUrl) preAiConfig.maasBaseUrl = localAI.maasBaseUrl
    if (localAI.maasUserEmail) preAiConfig.maasUserEmail = localAI.maasUserEmail
    setForm({ ...emptyForm(), aiConfig: preAiConfig })
    setFormErr(null); setShowForm(true)
  }
  const openEdit = (job: CronJob) => {
    setEditing(job.id)
    setForm({
      name: job.name, cronExpr: job.cronExpr, topic: job.topic, stylePrompt: job.stylePrompt,
      coverPrompt: job.coverPrompt, wxAppId: job.wxAppId, wxAppSecret: job.wxAppSecret, aiConfig: job.aiConfig
    })
    setFormErr(null); setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name?.trim()) { setFormErr('任务名称不能为空'); return }
    if (!form.cronExpr?.trim()) { setFormErr('cron 表达式不能为空'); return }
    setSaving(true); setFormErr(null)
    try {
      const payload = {
        name: form.name?.trim(), cronExpr: form.cronExpr?.trim(),
        topic: form.topic?.trim() || '', stylePrompt: form.stylePrompt?.trim() || '',
        coverPrompt: form.coverPrompt?.trim() || '', wxAppId: form.wxAppId?.trim() || '',
        wxAppSecret: form.wxAppSecret?.trim() || '', aiConfig: form.aiConfig || {}
      }
      if (editing) await axios.put(`/api/cron/jobs/${editing}`, payload)
      else await axios.post('/api/cron/jobs', payload)
      setShowForm(false); await loadJobs()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setFormErr(msg || '保存失败')
    }
    setSaving(false)
  }

  const handleToggle = async (job: CronJob) => {
    try { await axios.post(`/api/cron/jobs/${job.id}/${job.enabled ? 'disable' : 'enable'}`); await loadJobs() } catch { /**/ }
  }
  const handleDelete = async (job: CronJob) => {
    if (!confirm(`确认删除任务「${job.name}」？`)) return
    try { await axios.delete(`/api/cron/jobs/${job.id}`); setJobs(p => p.filter(j => j.id !== job.id)); setLogs(p => p.filter(l => l.jobId !== job.id)) } catch { /**/ }
  }
  const handleRun = async (job: CronJob) => {
    setRunning(job.id)
    try {
      await axios.post(`/api/cron/jobs/${job.id}/run`)
      setTimeout(() => { loadLogs(); loadJobLogs(job.id); setRunning(null) }, 2000)
    } catch { setRunning(null) }
  }
  const toggleExpand = async (jobId: string) => {
    if (expanded === jobId) { setExpanded(null) } else { setExpanded(jobId); await loadJobLogs(jobId) }
  }

  // ── 统计 ──────────────────────────────────────────────────────────────────
  const totalRuns = jobs.reduce((a, j) => a + j.runCount, 0)
  const enabledCount = jobs.filter(j => j.enabled).length
  const successCount = logs.filter(l => l.status === 'success').length

  const STRIPE_COLORS = ['pink', 'teal', 'lavender', 'peach', 'ochre']

  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="cp-root">

      {/* ── Topbar ── */}
      <header className="cp-topbar">
        <button className="wd-back-btn" onClick={() => navigate(-1)}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-left"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg>
          返回
        </button>
        <div className="cp-topbar-title">
          <Clock size={15} />
          定时任务
        </div>
        <div className="cp-topbar-actions">
          <button className="cp-icon-btn" onClick={() => { loadJobs(); loadLogs() }} title="刷新">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
          {jobs.length > 0 && (
            <button className="cp-btn-primary" onClick={openCreate}>
              <Plus size={14} /> 新建任务
            </button>
          )}
        </div>
      </header>

      {/* ── AI 未配置 Banner ── */}
      {!articleReady && (
        <div className="cp-banner">
          <AlertCircle size={14} />
          <span><strong>AI 模型未配置</strong> — 定时任务需要 AI 才能运行</span>
          <button className="cp-banner-btn" onClick={() => navigate('/settings')}>去配置</button>
        </div>
      )}

      {/* ── 主内容 ── */}
      <main className="cp-main">

        {/* ── 空状态 ── */}
        {!loading && jobs.length === 0 && (
          <div className="cp-hero">
            <div className="cp-hero-label">自动化流水线</div>
            <h1 className="cp-hero-title">定时发文，全自动</h1>
            <p className="cp-hero-sub">设定一次，每天自动抓热点、写文章、生成样式，推到微信草稿箱</p>

            {/* 流程卡片 */}
            <div className="cp-hero-steps">
              {PIPELINE_STEPS.map((step, i) => (
                <React.Fragment key={step.key}>
                  <div className="cp-hero-step">
                    <div className={`cp-hero-icon cp-hero-icon--${step.color}`}>
                      <step.icon size={22} />
                    </div>
                    <div className="cp-hero-step-label">{step.label}</div>
                  </div>
                  {i < PIPELINE_STEPS.length - 1 && (
                    <div className="cp-hero-arrow">→</div>
                  )}
                </React.Fragment>
              ))}
            </div>

            <button className="cp-btn-primary cp-btn-lg" onClick={openCreate}>
              <Plus size={16} /> 新建第一个任务
            </button>
          </div>
        )}

        {/* ── 有任务时 ── */}
        {jobs.length > 0 && (
          <>
            {/* 统计行 */}
            <div className="cp-stats">
              <div className="cp-stat">
                <span className="cp-stat-num">{jobs.length}</span>
                <span className="cp-stat-label">任务</span>
              </div>
              <div className="cp-stat-sep" />
              <div className="cp-stat">
                <span className="cp-stat-num cp-stat-num--green">{enabledCount}</span>
                <span className="cp-stat-label">启用中</span>
              </div>
              <div className="cp-stat-sep" />
              <div className="cp-stat">
                <span className="cp-stat-num">{totalRuns}</span>
                <span className="cp-stat-label">累计执行</span>
              </div>
              <div className="cp-stat-sep" />
              <div className="cp-stat">
                <span className="cp-stat-num cp-stat-num--mint">{successCount}</span>
                <span className="cp-stat-label">近期成功</span>
              </div>
            </div>

            {/* 任务卡片 */}
            <div className="cp-job-list">
              {jobs.map((job, idx) => {
                const color = STRIPE_COLORS[idx % STRIPE_COLORS.length]
                const latestLog = (jobLogs[job.id] || [])[0] || logs.find(l => l.jobId === job.id)
                const isExpanded = expanded === job.id

                return (
                  <div key={job.id} className={`cp-job${isExpanded ? ' cp-job--open' : ''}${!job.enabled ? ' cp-job--off' : ''}`}>

                    {/* 卡片头 */}
                    <div className="cp-job-head" onClick={() => toggleExpand(job.id)}>
                      <div className={`cp-job-stripe cp-job-stripe--${color}`} />

                      <div className="cp-job-info">
                        <div className="cp-job-title-row">
                          <span className={`cp-dot${job.enabled ? ' cp-dot--on' : ''}`} />
                          <span className="cp-job-name">{job.name}</span>
                          {!job.enabled && <span className="cp-chip cp-chip--muted">已暂停</span>}
                        </div>
                        <div className="cp-job-meta">
                          <span className="cp-job-schedule">{cronToHuman(job.cronExpr)}</span>
                          <code className="cp-job-expr">{job.cronExpr}</code>
                          {job.topic && <span className="cp-chip">{job.topic.slice(0, 18)}{job.topic.length > 18 ? '…' : ''}</span>}
                        </div>
                        {/* compact pipeline（有执行记录时展示） */}
                        {latestLog && latestLog.steps.length > 0 && (
                          <div className="cp-job-pipeline">
                            <PipelineViz steps={latestLog.steps} compact />
                          </div>
                        )}
                      </div>

                      <div className="cp-job-right">
                        <div className="cp-job-counters">
                          <div className="cp-job-counter">
                            <span className="cp-counter-num">{job.runCount}</span>
                            <span className="cp-counter-label">次</span>
                          </div>
                          <div className="cp-job-counter">
                            <span className="cp-counter-label">{job.lastRunAt ? formatTime(job.lastRunAt) : '—'}</span>
                          </div>
                        </div>

                        <div className="cp-job-actions" onClick={e => e.stopPropagation()}>
                          <button
                            className={`cp-act${running === job.id ? ' cp-act--spin' : ''}`}
                            onClick={() => handleRun(job)}
                            disabled={!!running}
                            title="立即执行"
                          >
                            {running === job.id ? <RefreshCw size={13} className="spin" /> : <Play size={13} />}
                          </button>
                          <button className="cp-act" onClick={() => handleToggle(job)} title={job.enabled ? '暂停' : '启用'}>
                            {job.enabled ? <Pause size={13} /> : <Play size={13} />}
                          </button>
                          <button className="cp-act" onClick={() => openEdit(job)} title="编辑">
                            <Settings size={13} />
                          </button>
                          <button className="cp-act cp-act--danger" onClick={() => handleDelete(job)} title="删除">
                            <Trash2 size={13} />
                          </button>
                        </div>

                        <ChevronDown size={14} className={`cp-chevron${isExpanded ? ' cp-chevron--up' : ''}`} />
                      </div>
                    </div>

                    {/* 展开区：执行历史 */}
                    {isExpanded && (
                      <div className="cp-job-body">
                        <div className="cp-section-label">
                          <Activity size={11} /> 执行历史
                        </div>

                        {(jobLogs[job.id] || []).length === 0 ? (
                          <div className="cp-empty-logs">
                            <Clock size={20} />
                            <span>还没有执行记录，点击▶ 立即执行试试</span>
                          </div>
                        ) : (
                          <div className="cp-log-list">
                            {(jobLogs[job.id] || []).map(log => (
                              <div key={log.id} className="cp-log">
                                <div
                                  className="cp-log-row"
                                  onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                                >
                                  <StatusBadge status={log.status} />
                                  <span className="cp-log-title">{log.articleTitle || log.topic || '执行中...'}</span>
                                  <span className="cp-log-meta">{formatTime(log.startedAt)} · {fmtDuration(log.startedAt, log.finishedAt)}</span>
                                  <ChevronDown size={12} className={`cp-chevron${expandedLog === log.id ? ' cp-chevron--up' : ''}`} />
                                </div>

                                {expandedLog === log.id && (
                                  <div className="cp-log-detail">
                                    {/* Pipeline 大图 */}
                                    <PipelineViz steps={log.steps} />

                                    {/* 步骤文字列表 */}
                                    <div className="cp-step-list">
                                      {log.steps.map((step, si) => (
                                        <div key={si} className={`cp-step cp-step--${step.status}`}>
                                          <span className={`cp-step-dot cp-step-dot--${step.status}`} />
                                          <span className="cp-step-name">
                                            {PIPELINE_STEPS.find(p => p.key === step.step)?.label || step.step}
                                          </span>
                                          <span className="cp-step-msg">{step.msg}</span>
                                          <span className="cp-step-time">
                                            {new Date(step.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                          </span>
                                        </div>
                                      ))}
                                    </div>

                                    {log.errorMsg && (
                                      <div className="cp-log-error"><XCircle size={13} /> {log.errorMsg}</div>
                                    )}
                                    {log.mediaId && (
                                      <div className="cp-log-success"><CheckCircle2 size={13} /> 草稿已推送 · media_id: <code>{log.mediaId}</code></div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* 全局活动流（最近 20 条） */}
            {logs.length > 0 && (
              <div className="cp-feed-section">
                <div className="cp-section-label"><Zap size={11} /> 最近活动</div>
                <div className="cp-feed">
                  {logs.map((log, i) => {
                    const jobName = jobs.find(j => j.id === log.jobId)?.name || '—'
                    return (
                      <div key={log.id} className="cp-feed-item">
                        <div className="cp-feed-line">
                          <span className={`cp-feed-dot cp-feed-dot--${log.status}`} />
                          {i < logs.length - 1 && <span className="cp-feed-tail" />}
                        </div>
                        <div className="cp-feed-content">
                          <div className="cp-feed-top">
                            <StatusBadge status={log.status} />
                            <span className="cp-feed-job">{jobName}</span>
                            <span className="cp-feed-time">{formatTime(log.startedAt)}</span>
                          </div>
                          {log.articleTitle && <div className="cp-feed-title">{log.articleTitle}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── 弹窗 ── */}
      {showForm && (
        <div className="cp-overlay" onClick={() => setShowForm(false)}>
          <div className="cp-modal" onClick={e => e.stopPropagation()}>

            <div className="cp-modal-head">
              <div className="cp-modal-head-inner">
                <div className="cp-modal-icon"><Clock size={15} /></div>
                <h2>{editing ? '编辑任务' : '新建定时任务'}</h2>
              </div>
              <button className="cp-modal-close" onClick={() => setShowForm(false)}>×</button>
            </div>

            {/* Pipeline hint */}
            <div className="cp-modal-pipeline">
              {PIPELINE_STEPS.map((step, i) => (
                <React.Fragment key={step.key}>
                  <div className="cp-mp-step">
                    <div className={`cp-mp-icon cp-mp-icon--${step.color}`}><step.icon size={11} /></div>
                    <span>{step.label}</span>
                  </div>
                  {i < PIPELINE_STEPS.length - 1 && <span className="cp-mp-arrow">→</span>}
                </React.Fragment>
              ))}
            </div>

            <div className="cp-modal-body">

              <div className="cp-field">
                <label className="cp-label">任务名称 <span className="cp-req">*</span></label>
                <input className="cp-input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="每日教育资讯推送" autoFocus />
              </div>

              <div className="cp-field">
                <label className="cp-label">执行时间 <span className="cp-req">*</span></label>
                <div className="cp-presets">
                  {CRON_PRESETS.map(p => (
                    <button
                      key={p.value}
                      className={`cp-preset${form.cronExpr === p.value ? ' cp-preset--on' : ''}`}
                      onClick={() => setForm(f => ({ ...f, cronExpr: p.value }))}
                    >{p.label}</button>
                  ))}
                </div>
                <input className="cp-input cp-mono" value={form.cronExpr || ''} onChange={e => setForm(f => ({ ...f, cronExpr: e.target.value }))} placeholder="0 8 * * *" />
                <p className="cp-hint">格式：分 时 日 月 周（东八区）</p>
              </div>

              <div className="cp-field">
                <label className="cp-label">文章主题 <span className="cp-opt">可选 · 留空自动抓热点</span></label>
                <textarea className="cp-textarea" value={form.topic || ''} onChange={e => setForm(f => ({ ...f, topic: e.target.value }))} placeholder="AI 辅助学习的最佳实践" rows={2} />
              </div>

              <div className="cp-field">
                <label className="cp-label">CSS 样式风格 <span className="cp-opt">可选 · 留空用默认简洁风格</span></label>
                <textarea className="cp-textarea" value={form.stylePrompt || ''} onChange={e => setForm(f => ({ ...f, stylePrompt: e.target.value }))} placeholder="专业商务感，主色 #2c5f8a" rows={2} />
              </div>

              <div className="cp-sep"><span>AI 接口</span></div>

              {/* provider 选择 */}
              <div className="cp-field">
                <label className="cp-label">接口类型 <span className="cp-req">*</span></label>
                <div className="cp-presets">
                  {[
                    { v: 'maas', label: 'MaaS（内网）' },
                    { v: 'openai', label: 'OpenAI' },
                    { v: 'openai-compat', label: '兼容接口' },
                  ].map(p => (
                    <button
                      key={p.v}
                      className={`cp-preset${(form.aiConfig?.articleProvider || 'openai') === p.v ? ' cp-preset--on' : ''}`}
                      onClick={() => setForm(f => ({ ...f, aiConfig: { ...(f.aiConfig || {}), articleProvider: p.v } }))}
                    >{p.label}</button>
                  ))}
                </div>
              </div>

              {(form.aiConfig?.articleProvider || 'openai') === 'maas' ? (
                <>
                  <div className="cp-field">
                    <label className="cp-label">MaaS API Key <span className="cp-req">*</span></label>
                    <div className="cp-secret-wrap">
                      <input
                        className="cp-input cp-mono"
                        type={showAiKey ? 'text' : 'password'}
                        value={form.aiConfig?.maasApiKey || ''}
                        onChange={e => setForm(f => ({ ...f, aiConfig: { ...(f.aiConfig || {}), maasApiKey: e.target.value } }))}
                        placeholder="QST..."
                      />
                      <button className="cp-eye" onClick={() => setShowAiKey(s => !s)}>
                        {showAiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>
                  <div className="cp-row-2">
                    <div className="cp-field">
                      <label className="cp-label">MaaS 用户邮箱</label>
                      <input className="cp-input" value={form.aiConfig?.maasUserEmail || ''} onChange={e => setForm(f => ({ ...f, aiConfig: { ...(f.aiConfig || {}), maasUserEmail: e.target.value } }))} placeholder="you@example.com" />
                    </div>
                    <div className="cp-field">
                      <label className="cp-label">模型</label>
                      <input className="cp-input cp-mono" value={form.aiConfig?.articleModel || ''} onChange={e => setForm(f => ({ ...f, aiConfig: { ...(f.aiConfig || {}), articleModel: e.target.value } }))} placeholder="deepseek-v4-pro" />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="cp-field">
                    <label className="cp-label">API Key <span className="cp-req">*</span></label>
                    <div className="cp-secret-wrap">
                      <input
                        className="cp-input cp-mono"
                        type={showAiKey ? 'text' : 'password'}
                        value={form.aiConfig?.articleApiKey || ''}
                        onChange={e => setForm(f => ({ ...f, aiConfig: { ...(f.aiConfig || {}), articleApiKey: e.target.value } }))}
                        placeholder="sk-..."
                      />
                      <button className="cp-eye" onClick={() => setShowAiKey(s => !s)}>
                        {showAiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>
                  {(form.aiConfig?.articleProvider === 'openai-compat') && (
                    <div className="cp-row-2">
                      <div className="cp-field">
                        <label className="cp-label">Base URL</label>
                        <input className="cp-input cp-mono" value={form.aiConfig?.articleBaseUrl || ''} onChange={e => setForm(f => ({ ...f, aiConfig: { ...(f.aiConfig || {}), articleBaseUrl: e.target.value } }))} placeholder="https://api.example.com/v1" />
                      </div>
                      <div className="cp-field">
                        <label className="cp-label">模型</label>
                        <input className="cp-input cp-mono" value={form.aiConfig?.articleModel || ''} onChange={e => setForm(f => ({ ...f, aiConfig: { ...(f.aiConfig || {}), articleModel: e.target.value } }))} placeholder="gpt-4o" />
                      </div>
                    </div>
                  )}
                </>
              )}
              <p className="cp-hint">AI Key 仅存储在此任务配置中，与「AI 配置」页面独立。</p>

              <div className="cp-sep"><span>微信公众号</span></div>

              <div className="cp-row-2">
                <div className="cp-field">
                  <label className="cp-label">AppID</label>
                  <input className="cp-input cp-mono" value={form.wxAppId || ''} onChange={e => setForm(f => ({ ...f, wxAppId: e.target.value }))} placeholder="REDACTED_WECHAT_APP_ID" />
                </div>
                <div className="cp-field">
                  <label className="cp-label">AppSecret</label>
                  <div className="cp-secret-wrap">
                    <input className="cp-input cp-mono" type={showSecret ? 'text' : 'password'} value={form.wxAppSecret || ''} onChange={e => setForm(f => ({ ...f, wxAppSecret: e.target.value }))} placeholder="32 位 hex" />
                    <button className="cp-eye" onClick={() => setShowSecret(s => !s)}>
                      {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>
              </div>
              <p className="cp-hint">服务端运行，凭据存数据库（独立于 AI 配置页面）。留空则不推送微信。</p>

            </div>

            {formErr && (
              <div className="cp-modal-err"><AlertCircle size={13} /> {formErr}</div>
            )}

            <div className="cp-modal-foot">
              <button className="cp-btn-cancel" onClick={() => setShowForm(false)}>取消</button>
              <button className="cp-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : editing ? '保存修改' : '创建任务'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
