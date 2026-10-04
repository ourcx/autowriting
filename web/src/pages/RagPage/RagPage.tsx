/**
 * RAG 管理页  /rag
 * - Embedding 配置（远端 API / 本地模型 tab 切换）
 * - 限流控制（批并发数 + 批次延迟）
 * - 索引状态 + 一键重建（异步轮询）
 * - 相似度搜索测试
 */
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Database, RefreshCw, Search,
  FileText, Layers, BookOpen, AlertCircle, CheckCircle,
  ExternalLink, Cpu, Zap,
} from 'lucide-react'
import { toast } from '../../components/Toast/Toast'
import PageHeader from '../../components/PageHeader/PageHeader'
import { useConfigStore, updateLocalConfig } from '../../store/useConfigStore'
import './RagPage.css'

interface IndexStatus {
  indexed: boolean
  size?: number
  updatedAt?: string
  indexDir?: string
  building?: boolean
  progress?: string
  buildError?: string | null
  buildResult?: { indexed: number; chunks: number } | null
  startedAt?: string | null
  needsRebuild?: boolean
  embedMode?: string | null
  model?: string | null
  dimensions?: number | string | null
  chunks?: number | string | null
  docs?: number | string | null
}

interface RagDoc {
  content: string
  source: string
  type: string
  dir: string
  score: number
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  article:  { label: '往期文章', color: 'peach',    icon: <FileText size={13} /> },
  task:     { label: '任务参考', color: 'lavender', icon: <Layers size={13} /> },
  materials:{ label: '素材参考', color: 'ochre',    icon: <BookOpen size={13} /> },
  task_sub: { label: '任务参考', color: 'lavender', icon: <Layers size={13} /> },
  zhipu_knowledge: { label: '智谱云知识库', color: 'mint', icon: <Database size={13} /> },
}

const PRESET_MODELS = [
  'embedding-3',
  'text-embedding-3-small',
  'text-embedding-3-large',
  'qwen3-embedding',
]

const LOCAL_MODEL_PRESETS = [
  { id: '',                                                    label: 'multilingual-e5-small',              dims: 384,  size: '~120 MB', note: '默认，速度最快',   url: 'https://huggingface.co/intfloat/multilingual-e5-small' },
  { id: 'Xenova/multilingual-e5-base',                        label: 'multilingual-e5-base',               dims: 768,  size: '~280 MB', note: '质量更高',         url: 'https://huggingface.co/intfloat/multilingual-e5-base' },
  { id: 'Xenova/multilingual-e5-large',                       label: 'multilingual-e5-large',              dims: 1024, size: '~560 MB', note: '最高质量',         url: 'https://huggingface.co/intfloat/multilingual-e5-large' },
  { id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',       label: 'paraphrase-multilingual-MiniLM-L12-v2', dims: 384, size: '~120 MB', note: '句子语义匹配', url: 'https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2' },
]

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`
}

export default function RagPage() {
  const navigate = useNavigate()
  const { localConfig } = useConfigStore()

  // ── 配置模式：remote | local ────────────────────────────────────────────────
  const [configTab, setConfigTab] = useState<'remote' | 'local'>(
    localConfig.embeddingApiKey ? 'remote' : 'local'
  )

  // ── 远端 API 配置 ────────────────────────────────────────────────────────────
  const [embKey,     setEmbKey]     = useState(localConfig.embeddingApiKey       || '')
  const [embUrl,     setEmbUrl]     = useState(localConfig.embeddingBaseUrl      || 'https://api.openai.com/v1')
  const [embModel,   setEmbModel]   = useState(localConfig.embeddingModel        || 'text-embedding-3-small')
  const [embDims,    setEmbDims]    = useState(localConfig.embeddingDimensions   || '')
  const [embInstr,   setEmbInstr]   = useState(localConfig.embeddingInstruction  || '')
  const [embHeaders, setEmbHeaders] = useState(localConfig.embeddingExtraHeaders || '')
  const [headersErr, setHeadersErr] = useState(false)

  // ── 限流控制 ─────────────────────────────────────────────────────────────────
  const [embBatchSize,  setEmbBatchSize]  = useState(localConfig.embeddingBatchSize    || '1')
  const [embBatchDelay, setEmbBatchDelay] = useState(localConfig.embeddingBatchDelayMs || '3000')

  // ── 本地模型配置 ─────────────────────────────────────────────────────────────
  const [localModel, setLocalModel] = useState(localConfig.localEmbeddingModel || '')
  const [knowledgeMode, setKnowledgeMode] = useState(localConfig.zhipuKnowledgeMode || 'off')
  const [knowledgeIds, setKnowledgeIds] = useState(localConfig.zhipuKnowledgeIds || '')
  const [knowledgeRecall, setKnowledgeRecall] = useState(localConfig.zhipuKnowledgeRecallMethod || 'mixed')
  const [knowledgeRerank, setKnowledgeRerank] = useState(localConfig.zhipuKnowledgeRerank !== false)

  // ── 脏标记 ───────────────────────────────────────────────────────────────────
  const [embDirty, setEmbDirty] = useState(false)

  // ── 索引状态 ─────────────────────────────────────────────────────────────────
  const [status,   setStatus]   = useState<IndexStatus | null>(null)
  const [building, setBuilding] = useState(false)
  const [buildLog, setBuildLog] = useState<{ ok: boolean; msg: string } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── 搜索 ─────────────────────────────────────────────────────────────────────
  const [query,     setQuery]     = useState('')
  const [searching, setSearching] = useState(false)
  const [results,   setResults]   = useState<RagDoc[] | null>(null)

  const usesZhipuEmbedding = embUrl.includes('open.bigmodel.cn') || /^embedding-[23]$/i.test(embModel)
  const effectiveKey = embKey
    || (usesZhipuEmbedding ? localConfig.zhipuApiKey : '')
    || localConfig.articleApiKey
    || ''
  const hasKey       = !!effectiveKey

  const headersValid = !embHeaders || (() => {
    try { JSON.parse(embHeaders); return true } catch { return false }
  })()

  const embAiConfig = {
    embeddingApiKey:       effectiveKey,
    embeddingBaseUrl:      embUrl    || 'https://api.openai.com/v1',
    embeddingModel:        embModel  || 'text-embedding-3-small',
    embeddingDimensions:   embDims   ? Number(embDims)        : undefined,
    embeddingInstruction:  embInstr  || undefined,
    embeddingExtraHeaders: embHeaders|| undefined,
    localEmbeddingModel:   localModel|| undefined,
    embeddingBatchSize:    embBatchSize  ? Number(embBatchSize)  : undefined,
    embeddingBatchDelayMs: embBatchDelay ? Number(embBatchDelay) : undefined,
    zhipuApiKey: localConfig.zhipuApiKey,
    zhipuKnowledgeMode: knowledgeMode,
    zhipuKnowledgeIds: knowledgeIds,
    zhipuKnowledgeRecallMethod: knowledgeRecall,
    zhipuKnowledgeRerank: knowledgeRerank,
  }

  useEffect(() => {
    fetchStatus()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('auth_token')
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async function fetchStatus() {
    try {
      const res = await fetch('/api/rag/status', { headers: authHeaders() })
      if (res.status === 401) { setStatus({ indexed: false }); return }
      const data: IndexStatus = await res.json()
      setStatus(data)
      if (!data.building && pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
        if (data.buildError) {
          setBuildLog({ ok: false, msg: `失败：${data.buildError}` })
          setBuilding(false)
        } else if (data.buildResult) {
          setBuildLog({ ok: true, msg: `成功索引 ${data.buildResult.indexed} 篇文档，切分为 ${data.buildResult.chunks} 个片段` })
          setBuilding(false)
        }
      }
    } catch {
      setStatus({ indexed: false })
    }
  }

  function startPolling() {
    if (pollRef.current) return
    pollRef.current = setInterval(fetchStatus, 1500)
  }

  function mark() { setEmbDirty(true) }

  function saveEmbConfig() {
    if (embHeaders && !headersValid) { toast.error('Extra Headers 不是合法的 JSON'); return }
    updateLocalConfig({
      embeddingApiKey:       embKey,
      embeddingBaseUrl:      embUrl,
      embeddingModel:        embModel,
      embeddingDimensions:   embDims,
      embeddingInstruction:  embInstr,
      embeddingExtraHeaders: embHeaders,
      localEmbeddingModel:   localModel,
      embeddingBatchSize:    embBatchSize  || '1',
      embeddingBatchDelayMs: embBatchDelay || '3000',
      zhipuKnowledgeMode: knowledgeMode,
      zhipuKnowledgeIds: knowledgeIds,
      zhipuKnowledgeRecallMethod: knowledgeRecall,
      zhipuKnowledgeRerank: knowledgeRerank,
    })
    setEmbDirty(false)
    setHeadersErr(false)
    toast.success('配置已保存')
  }

  async function handleBuild() {
    if (!hasKey && !localModel) { toast.error('请先配置 API Key 或选择本地向量模型'); return }
    if (embDirty) { toast.warn('配置有未保存的改动，请先保存'); return }
    setBuilding(true)
    setBuildLog(null)
    try {
      const res  = await fetch('/api/rag/index', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body:    JSON.stringify({ aiConfig: embAiConfig }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      await fetchStatus()
      startPolling()
    } catch (e: unknown) {
      const msg = (e as Error).message
      setBuildLog({ ok: false, msg: `失败：${msg}` })
      toast.error('构建失败：' + msg)
      setBuilding(false)
    }
  }

  async function handleSearch() {
    if (!query.trim()) return
    const knowledgeReady = knowledgeMode !== 'off' && !!knowledgeIds.trim() && !!localConfig.zhipuApiKey
    if (!hasKey && !localModel && !knowledgeReady) { toast.error('请先配置本地索引或智谱云知识库'); return }
    setSearching(true)
    setResults(null)
    try {
      const res  = await fetch('/api/rag/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body:    JSON.stringify({ query: query.trim(), topK: 6, aiConfig: embAiConfig }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResults(data.results)
    } catch (e: unknown) {
      toast.error('搜索失败：' + (e as Error).message)
    } finally {
      setSearching(false)
    }
  }

  const canBuild = (hasKey || !!localModel) && !embDirty
  const cloudReady = knowledgeMode !== 'off' && !!knowledgeIds.trim() && !!localConfig.zhipuApiKey

  // 是否是自定义本地模型
  const isCustomLocal = !!localModel && !LOCAL_MODEL_PRESETS.find(m => m.id === localModel)

  return (
    <div className="rp-root">

      <PageHeader
        title="向量知识库"
        icon={<Database size={17} />}
        onBack={() => navigate('/')}
      />

      <div className="rp-body">

        {/* ══ Embedding 配置 ══ */}
        <section className="rp-section">
          <div className="rp-section-label">Embedding 配置</div>

          {/* Tab 切换 */}
          <div className="rp-tabs">
            <button
              className={`rp-tab${configTab === 'remote' ? ' rp-tab--active' : ''}`}
              onClick={() => setConfigTab('remote')}
            >
              远端 API
              {hasKey
                ? <span className="rp-tab-dot rp-tab-dot--ok" />
                : <span className="rp-tab-dot rp-tab-dot--warn" />
              }
            </button>
            <button
              className={`rp-tab${configTab === 'local' ? ' rp-tab--active' : ''}`}
              onClick={() => setConfigTab('local')}
            >
              <Cpu size={13} />
              本地模型
              {!hasKey && <span className="rp-tab-dot rp-tab-dot--ok" />}
            </button>
            {embDirty && <span className="rp-badge-dirty" style={{ marginLeft: 'auto' }}>未保存</span>}
          </div>

          {/* ── 远端 API ── */}
          {configTab === 'remote' && (
            <div className="rp-config-card">
              <div className="rp-field-grid">

                <div className="rp-field rp-field--span2">
                  <label className="rp-field-label">
                    API Key
                    <span className="rp-field-hint">留空时仅复用同服务商公共 Key；智谱端点会复用智谱公共 Key</span>
                  </label>
                  <input
                    className="rp-input rp-input-mono"
                    type="password"
                    placeholder={usesZhipuEmbedding && localConfig.zhipuApiKey ? '留空使用智谱公共 Key（已配置）' : localConfig.articleApiKey ? '留空使用文章 Key（已配置）' : 'sk-...'}
                    value={embKey}
                    onChange={e => { setEmbKey(e.target.value); mark() }}
                  />
                </div>

                <div className="rp-field">
                  <label className="rp-field-label">
                    Base URL
                    <span className="rp-field-hint">OpenAI 兼容接口</span>
                  </label>
                  <input
                    className="rp-input rp-input-mono"
                    placeholder="https://api.openai.com/v1"
                    value={embUrl}
                    onChange={e => { setEmbUrl(e.target.value); mark() }}
                  />
                </div>

                <div className="rp-field">
                  <label className="rp-field-label">
                    模型
                    <span className="rp-field-hint">与服务商支持的模型对应</span>
                  </label>
                  <input
                    className="rp-input rp-input-mono"
                    placeholder="text-embedding-3-small"
                    value={embModel}
                    onChange={e => { setEmbModel(e.target.value); mark() }}
                    list="rp-model-list"
                  />
                  <datalist id="rp-model-list">
                    {PRESET_MODELS.map(m => <option key={m} value={m} />)}
                  </datalist>
                  <div className="rp-preset-pills">
                    <button
                      className={`rp-preset-pill${usesZhipuEmbedding ? ' rp-preset-pill--active' : ''}`}
                      onClick={() => {
                        setEmbUrl('https://open.bigmodel.cn/api/paas/v4')
                        setEmbModel('embedding-3')
                        setEmbDims('2048')
                        mark()
                      }}
                    >智谱 Embedding-3</button>
                    {PRESET_MODELS.map(m => (
                      <button
                        key={m}
                        className={`rp-preset-pill${embModel === m ? ' rp-preset-pill--active' : ''}`}
                        onClick={() => { setEmbModel(m); mark() }}
                      >{m}</button>
                    ))}
                  </div>
                </div>

                <div className="rp-field">
                  <label className="rp-field-label">
                    Dimensions
                    <span className="rp-field-hint">留空使用默认值（Qwen3 建议填 1024）</span>
                  </label>
                  <input
                    className="rp-input rp-input-mono"
                    type="number"
                    placeholder="留空使用默认值"
                    value={embDims}
                    onChange={e => { setEmbDims(e.target.value); mark() }}
                  />
                </div>

                <div className="rp-field">
                  <label className="rp-field-label">
                    Instruction
                    <span className="rp-field-hint">任务指令，Qwen3-Embedding 支持</span>
                  </label>
                  <input
                    className="rp-input"
                    placeholder="如：检索与以下内容相关的往期文章"
                    value={embInstr}
                    onChange={e => { setEmbInstr(e.target.value); mark() }}
                  />
                </div>

                <div className="rp-field">
                  <label className="rp-field-label">
                    Extra Headers
                    <span className="rp-field-hint">JSON 格式，如 Gitee AI 的 X-Failover-Enabled</span>
                  </label>
                  <textarea
                    className={`rp-textarea rp-input-mono${headersErr ? ' rp-textarea--error' : ''}`}
                    placeholder={'{\n  "X-Failover-Enabled": "true"\n}'}
                    rows={3}
                    value={embHeaders}
                    onChange={e => {
                      setEmbHeaders(e.target.value); mark()
                      setHeadersErr(e.target.value !== '' && (() => { try { JSON.parse(e.target.value); return false } catch { return true } })())
                    }}
                  />
                  {headersErr && <span className="rp-field-error">不是合法的 JSON</span>}
                </div>

              </div>

              {/* 限流控制 */}
              <div className="rp-rate-limit">
                <div className="rp-rate-limit-head">
                  <Zap size={13} />
                  限流控制
                  <span className="rp-field-hint">遇到 429 配额超限时调小并发、调大延迟</span>
                </div>
                <div className="rp-rate-limit-fields">
                  <div className="rp-field">
                    <label className="rp-field-label">
                      批并发数
                      <span className="rp-field-hint">默认 1</span>
                    </label>
                    <input
                      className="rp-input rp-input-mono"
                      type="number" min={1} max={128}
                      value={embBatchSize}
                      onChange={e => { setEmbBatchSize(e.target.value); mark() }}
                    />
                  </div>
                  <div className="rp-field">
                    <label className="rp-field-label">
                      批次延迟 (ms)
                      <span className="rp-field-hint">默认 3000</span>
                    </label>
                    <input
                      className="rp-input rp-input-mono"
                      type="number" min={0} max={10000}
                      value={embBatchDelay}
                      onChange={e => { setEmbBatchDelay(e.target.value); mark() }}
                    />
                  </div>
                </div>
              </div>

              <div className="rp-config-footer">
                <span className="rp-config-status">
                  {hasKey
                    ? `${embKey ? '专用 Key' : '文章 Key 回落'} · ${embModel || 'text-embedding-3-small'}`
                    : <span className="rp-config-status--warn">未配置 Key，将使用本地模型</span>
                  }
                </span>
                <button className="rp-btn-primary" onClick={saveEmbConfig} disabled={!embDirty}>
                  保存配置
                </button>
              </div>
            </div>
          )}

          {/* ── 本地模型 ── */}
          {configTab === 'local' && (
            <div className="rp-config-card">
              <p className="rp-local-desc">
                无远端 API Key 时自动使用本地模型（@xenova/transformers），首次运行自动下载权重。切换模型后需重建索引。
              </p>

              <div className="rp-local-model-list">
                {LOCAL_MODEL_PRESETS.map(m => {
                  const isActive = localModel === m.id
                  return (
                    <label
                      key={m.id}
                      className={`rp-local-model-item${isActive ? ' rp-local-model-item--active' : ''}`}
                      onClick={() => { setLocalModel(m.id); mark() }}
                    >
                      <div className="rp-local-model-radio">
                        <div className={`rp-radio-dot${isActive ? ' rp-radio-dot--on' : ''}`} />
                      </div>
                      <div className="rp-local-model-info">
                        <div className="rp-local-model-name">
                          {m.label}
                          {m.id === '' && <span className="rp-local-model-tag rp-local-model-tag--default">默认</span>}
                        </div>
                        <div className="rp-local-model-meta">{m.dims} 维 · {m.size} · {m.note}</div>
                      </div>
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rp-local-model-link"
                        onClick={e => e.stopPropagation()}
                      >
                        <ExternalLink size={12} />HF
                      </a>
                    </label>
                  )
                })}

                {/* 自定义 */}
                <div className={`rp-local-model-item rp-local-model-item--custom${isCustomLocal ? ' rp-local-model-item--active' : ''}`}>
                  <div className="rp-local-model-radio">
                    <div className={`rp-radio-dot${isCustomLocal ? ' rp-radio-dot--on' : ''}`} />
                  </div>
                  <div className="rp-local-model-info" style={{ flex: 1 }}>
                    <div className="rp-local-model-name">自定义模型 ID</div>
                    <input
                      className="rp-input rp-input-mono"
                      style={{ marginTop: 6, height: 36 }}
                      placeholder="Xenova/your-model"
                      value={isCustomLocal ? localModel : ''}
                      onChange={e => { setLocalModel(e.target.value); mark() }}
                      onClick={e => e.stopPropagation()}
                    />
                    <div className="rp-local-model-meta" style={{ marginTop: 4 }}>
                      需 Xenova/ 前缀，来自{' '}
                      <a href="https://huggingface.co/models?library=transformers.js&pipeline_tag=feature-extraction" target="_blank" rel="noreferrer" className="rp-inline-link">
                        HuggingFace Transformers.js
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rp-config-footer">
                <span className="rp-config-status">
                  {localModel
                    ? `已选择：${LOCAL_MODEL_PRESETS.find(m => m.id === localModel)?.label ?? localModel}`
                    : '使用默认 multilingual-e5-small（384 维）'
                  }
                </span>
                <button className="rp-btn-primary" onClick={saveEmbConfig} disabled={!embDirty}>
                  保存配置
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ══ 智谱云知识库 ══ */}
        <section className="rp-section">
          <div className="rp-section-label">智谱云知识库</div>
          <div className="rp-config-card">
            <div className="rp-field-grid">
              <div className="rp-field">
                <label className="rp-field-label">
                  召回模式
                  <span className="rp-field-hint">参与文章生成和本页搜索测试</span>
                </label>
                <select
                  className="rp-input"
                  value={knowledgeMode}
                  onChange={event => { setKnowledgeMode(event.target.value as typeof knowledgeMode); mark() }}
                >
                  <option value="off">关闭，仅使用本地索引</option>
                  <option value="remote">仅智谱云知识库</option>
                  <option value="hybrid">智谱云知识库 + 本地索引</option>
                </select>
              </div>
              <div className="rp-field">
                <label className="rp-field-label">检索方式</label>
                <select
                  className="rp-input"
                  value={knowledgeRecall}
                  onChange={event => { setKnowledgeRecall(event.target.value as typeof knowledgeRecall); mark() }}
                  disabled={knowledgeMode === 'off'}
                >
                  <option value="mixed">混合检索</option>
                  <option value="embedding">向量检索</option>
                  <option value="keyword">关键词检索</option>
                </select>
              </div>
              <div className="rp-field rp-field--span2">
                <label className="rp-field-label">
                  知识库 ID
                  <span className="rp-field-hint">多个 ID 用逗号或换行分隔，最多 20 个</span>
                </label>
                <textarea
                  className="rp-textarea rp-input-mono"
                  rows={3}
                  placeholder="knowledge-id-1, knowledge-id-2"
                  value={knowledgeIds}
                  onChange={event => { setKnowledgeIds(event.target.value); mark() }}
                  disabled={knowledgeMode === 'off'}
                />
              </div>
              <label className="rp-local-model-item" style={{ gridColumn: 'span 2' }}>
                <input
                  type="checkbox"
                  checked={knowledgeRerank}
                  onChange={event => { setKnowledgeRerank(event.target.checked); mark() }}
                  disabled={knowledgeMode === 'off'}
                />
                <div className="rp-local-model-info">
                  <div className="rp-local-model-name">启用智谱 Rerank 重排</div>
                  <div className="rp-local-model-meta">提高最终召回排序质量，会产生对应服务费用</div>
                </div>
              </label>
            </div>
            <div className="rp-config-footer">
              <span className="rp-config-status">
                {cloudReady
                  ? '已就绪；文章生成会自动召回云知识片段'
                  : knowledgeMode === 'off'
                    ? '未启用'
                    : '需要智谱公共 Key 和知识库 ID'}
              </span>
              <a className="rp-inline-link" href="https://open.bigmodel.cn/console/knowledge" target="_blank" rel="noreferrer">
                管理智谱知识库 <ExternalLink size={12} />
              </a>
              <button className="rp-btn-primary" onClick={saveEmbConfig} disabled={!embDirty}>保存配置</button>
            </div>
          </div>
        </section>

        {/* ══ 索引状态 ══ */}
        <section className="rp-section">
          <div className="rp-section-label">索引状态</div>

          {/* 说明条 */}
          <div className="rp-notice">
            知识库只索引<strong>服务端存储</strong>的文章（本地草稿不在范围内）。写完新文章后点「重新构建」刷新知识库。
          </div>

          <div className="rp-status-card">
            <div className="rp-status-left">
              {status === null ? (
                <span className="rp-dot-loading" />
              ) : (status.building || building) ? (
                <RefreshCw size={20} className="rp-spin rp-icon-building" />
              ) : status.indexed ? (
                <CheckCircle size={20} className="rp-icon-ok" />
              ) : (
                <AlertCircle size={20} className="rp-icon-warn" />
              )}
              <div>
                <div className="rp-status-title">
                  {status === null                                                     && '加载中...'}
                  {status !== null && (status.building || building)                   && `构建中：${status.progress || '准备中...'}`}
                  {status !== null && !status.building && !building && !status.indexed && '尚未建立索引'}
                  {status !== null && !status.building && !building && status.indexed  && '索引已就绪'}
                </div>
                <div className="rp-status-meta">
                  {status?.building && status.startedAt && (
                    <span>开始于 {new Date(status.startedAt).toLocaleTimeString('zh-CN')}</span>
                  )}
                  {!status?.building && !building && status?.indexed && (
                    <>
                      {status.size   != null && <span>{fmtSize(status.size)}</span>}
                      {status.docs   != null && <span>{status.docs} 篇</span>}
                      {status.chunks != null && <span>{status.chunks} 段</span>}
                      {status.model  && status.model !== 'unknown' && (
                        <span className="rp-status-model">
                          {status.embedMode === 'local' && <Cpu size={11} />}
                          {status.model.split('/').pop()}
                          {status.dimensions != null ? ` · ${status.dimensions} 维` : ''}
                        </span>
                      )}
                      {status.updatedAt && (
                        <span>更新于 {new Date(status.updatedAt).toLocaleString('zh-CN')}</span>
                      )}
                    </>
                  )}
                  {!status?.indexed && !status?.building && !building && status !== null && (
                    <span>扫描草稿目录，向量化后存入本地 HNSWLib</span>
                  )}
                </div>
              </div>
            </div>
            <button
              className={`rp-btn-primary${(building || status?.building) ? ' rp-btn-loading' : ''}`}
              onClick={handleBuild}
              disabled={building || status?.building || !canBuild}
              title={
                !hasKey && !localModel ? '请先配置 API Key 或选择本地模型'
                  : embDirty ? '请先保存配置'
                  : ''
              }
            >
              <RefreshCw size={14} className={(building || status?.building) ? 'rp-spin' : ''} />
              {(building || status?.building) ? '构建中...' : status?.indexed ? '重新构建' : '立即构建'}
            </button>
          </div>

          {(building || status?.building) && (
            <div className="rp-progress-bar">
              <div className="rp-progress-bar-inner rp-progress-bar-animate" />
            </div>
          )}

          {status?.indexed && status?.needsRebuild && !building && !status?.building && (
            <div className="rp-build-log rp-build-log--warn">
              当前索引是旧版本格式（缺少 meta），检索时自动适配，建议点「重新构建」生成完整索引。
            </div>
          )}

          {buildLog && !building && !status?.building && (
            <div className={`rp-build-log${buildLog.ok ? '' : ' rp-build-log--error'}`}>
              {buildLog.msg}
            </div>
          )}
        </section>

        {/* ══ 搜索测试 ══ */}
        <section className="rp-section">
          <div className="rp-section-label">相似度搜索测试</div>
          <div className="rp-search-row">
            <input
              className="rp-input"
              placeholder={status?.indexed || cloudReady ? '输入任意文本，测试知识检索效果...' : '请先构建索引或配置智谱云知识库'}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
              disabled={!status?.indexed && !cloudReady}
            />
            <button
              className="rp-btn-primary"
              onClick={handleSearch}
              disabled={searching || (!status?.indexed && !cloudReady) || !query.trim()}
            >
              <Search size={14} />
              {searching ? '检索中...' : '搜索'}
            </button>
          </div>

          {results !== null && (
            <div className="rp-results">
              {results.length === 0 ? (
                <div className="rp-no-result">没有找到相关内容（相似度过低）</div>
              ) : (
                <>
                  <div className="rp-results-summary">找到 {results.length} 段相关内容</div>
                  <div className="rp-result-grid">
                    {results.map((doc, i) => {
                      const cfg = TYPE_CONFIG[doc.type] || { label: doc.type, color: 'cream', icon: <FileText size={13} /> }
                      return (
                        <div key={i} className={`rp-result-card rp-result-card--${cfg.color}`}>
                          <div className="rp-result-header">
                            <span className="rp-result-badge">{cfg.icon}{cfg.label}</span>
                            <span className="rp-result-dir">{doc.dir}</span>
                            <span className="rp-result-sim">{Math.round(doc.type === 'zhipu_knowledge' ? 100 - doc.score * 100 : (1 - doc.score) * 100)}% 相似</span>
                          </div>
                          <p className="rp-result-content">{doc.content}</p>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* ══ 使用说明 ══ */}
        <section className="rp-section">
          <div className="rp-section-label">使用说明</div>
          <div className="rp-guide-grid">
            <div className="rp-guide-card rp-guide-card--teal">
              <div className="rp-guide-step">01</div>
              <div className="rp-guide-title">配置向量模型</div>
              <p>有 API Key 走远端（质量更好）；没有 Key 在「本地模型」选一个，首次运行自动下载权重。</p>
            </div>
            <div className="rp-guide-card rp-guide-card--peach">
              <div className="rp-guide-step">02</div>
              <div className="rp-guide-title">构建索引</div>
              <p>扫描服务端草稿（<code>article_raw.md</code> / <code>task.md</code> / <code>materials.md</code>），切片向量化存入 HNSWLib。</p>
            </div>
            <div className="rp-guide-card rp-guide-card--lavender">
              <div className="rp-guide-step">03</div>
              <div className="rp-guide-title">自动召回</div>
              <p>生成文章时自动检索本地索引或智谱云知识库，把相关片段注入 prompt。写完新文章后按需重建本地索引。</p>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
