import { useState, useEffect, useCallback } from 'react'
// @ts-ignore
import { useNavigate } from 'react-router-dom'
import {
  Save, Check, Eye, EyeOff, AlertCircle, CheckCircle2,
  Zap, Image, Search, ChevronRight, ShieldAlert, Brain,
} from 'lucide-react'
import {
  AIConfig,
  loadAIConfig,
  PROVIDER_PRESETS,
  COVER_PROVIDER_PRESETS,
  CONFIG_PRESETS,
} from '../../utils/aiConfig'
import PageHeader from '../../components/PageHeader/PageHeader'
import { useConfigStore, setLocalConfig, fetchServerStatus } from '../../store/useConfigStore'
import { testAIConnection } from '../../utils/apiHelpers'
import './AISettings.css'

type Section = 'article' | 'cover' | 'search' | 'cdn' | 'memory'

const NAV_ITEMS: { id: Section; icon: React.ReactNode; label: string; sub: string }[] = [
  { id: 'article', icon: <Zap size={16} />, label: '文章生成', sub: '大语言模型 API' },
  { id: 'cover', icon: <Image size={16} />, label: '封面生成', sub: '图片生成 API' },
  { id: 'search', icon: <Search size={16} />, label: '素材搜索', sub: '搜索引擎 API' },
  { id: 'cdn', icon: <Image size={16} />, label: '图床配置', sub: 'Imgur 图片 CDN' },
  { id: 'memory', icon: <Brain size={16} />, label: '永久记忆', sub: '每次生成都注入' },
]

export default function AISettings() {
  const navigate = useNavigate()
  const storeState = useConfigStore()
  const serverStatus = storeState.serverStatus

  const [config, setConfig] = useState<AIConfig>(loadAIConfig)
  const [saved, setSaved] = useState(false)
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [activeSection, setActiveSection] = useState<Section>('article')

  // ── 永久记忆 ──────────────────────────────────────────────────────────────
  const [globalMemory, setGlobalMemory] = useState('')
  const [memorySaving, setMemorySaving] = useState(false)
  const [memorySaved, setMemorySaved] = useState(false)
  const [memoryLoadError, setMemoryLoadError] = useState('')

  const loadGlobalMemory = useCallback(async () => {
    try {
      const token = localStorage.getItem('auth_token')
      const r = await fetch('/api/settings/global_memory', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      const d = await r.json()
      setGlobalMemory(d.value || '')
    } catch {
      setMemoryLoadError('加载失败')
    }
  }, [])

  const saveGlobalMemory = async () => {
    setMemorySaving(true)
    try {
      const token = localStorage.getItem('auth_token')
      const r = await fetch('/api/settings/global_memory', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ value: globalMemory }),
      })
      if (!r.ok) throw new Error('保存失败')
      setMemorySaved(true)
      setTimeout(() => setMemorySaved(false), 2500)
    } catch {
      setMemoryLoadError('保存失败，请重试')
    }
    setMemorySaving(false)
  }

  useEffect(() => {
    setConfig(loadAIConfig())
    fetchServerStatus()
    loadGlobalMemory()
  }, [loadGlobalMemory])

  const handleSave = () => {
    setLocalConfig(config)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const set = (patch: Partial<AIConfig>) => {
    setConfig(c => ({ ...c, ...patch }))
    setTestResult(null)
  }

  const toggleKey = (k: string) => setShowKeys(s => ({ ...s, [k]: !s[k] }))

  const handleArticleProviderChange = (id: AIConfig['articleProvider']) => {
    const preset = PROVIDER_PRESETS.find(p => p.id === id)
    set({
      articleProvider: id,
      articleBaseUrl: preset?.defaultBaseUrl ?? config.articleBaseUrl,
      articleModel: preset?.models[0] ?? config.articleModel,
    })
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const result = await testAIConnection(config)
    setTestResult(result)
    setTesting(false)
  }

  // 应用快速预设
  const applyPreset = (presetId: string) => {
    const preset = CONFIG_PRESETS.find(p => p.id === presetId)
    if (preset) {
      setConfig(c => ({ ...c, ...(preset.config as Partial<AIConfig>) }))
      setTestResult(null)
    }
  }

  const selectedArticlePreset = PROVIDER_PRESETS.find(p => p.id === config.articleProvider)

  // ── 配置状态（每个 key 的状态） ──────────────────────────────────────────
  const localMaas = config.articleProvider === 'maas' && !!config.maasApiKey
  const localOpenai = config.articleProvider !== 'maas' && !!config.articleApiKey
  const localSiliconflow = !!config.siliconflowApiKey
  const localCoverKey = !!config.coverApiKey
  const localSearchKey = config.searchProvider === 'searxng' || !!config.searchApiKey
  const localCdn = (config.cdnProvider === 'imgur' && !!config.imgurClientId)
    || (config.cdnProvider === 'github' && !!config.githubToken && !!config.githubRepo)

  const STATUS_CARDS = [
    {
      label: 'MaaS',
      local: localMaas,
      server: !!serverStatus?.maasReady,
      serverNote: serverStatus?.maasEmail || '服务端',
      color: 'teal',
      section: 'article' as Section,
    },
    {
      label: 'OpenAI',
      local: localOpenai,
      server: !!serverStatus?.openaiReady,
      serverNote: '服务端',
      color: 'lavender',
      section: 'article' as Section,
    },
    {
      label: 'SiliconFlow',
      local: localSiliconflow,
      server: false,
      serverNote: '',
      color: 'peach',
      section: 'cover' as Section,
    },
    {
      label: 'DALL-E',
      local: config.coverProvider === 'openai' && localCoverKey,
      server: !!serverStatus?.dalleReady,
      serverNote: '服务端',
      color: 'ochre',
      section: 'cover' as Section,
    },
    {
      label: 'Stability',
      local: config.coverProvider === 'stability' && localCoverKey,
      server: !!serverStatus?.stabilityReady,
      serverNote: '服务端',
      color: 'pink',
      section: 'cover' as Section,
    },
    {
      label: '搜索引擎',
      local: localSearchKey,
      server: false,
      serverNote: '',
      color: 'mint',
      section: 'search' as Section,
    },
    {
      label: '图床',
      local: localCdn,
      server: false,
      serverNote: '',
      color: 'lavender',
      section: 'cdn' as Section,
    },
  ]

  return (
    <div className="as-root">
      <PageHeader
        title="API 配置"
        subtitle="管理文章生成、封面、搜索与图床服务"
        onBack={() => navigate(-1)}
        actions={(
          <button className={`as-save-btn${saved ? ' as-save-btn--ok' : ''}`} onClick={handleSave}>
            {saved ? <Check size={14} /> : <Save size={14} />}
            {saved ? '已保存' : '保存'}
          </button>
        )}
      />

      {/* ── 安全提示 Banner ── */}
      <div className="as-security-banner">
        <ShieldAlert size={14} className="as-security-banner-icon" />
        <span>
          API Key 仅保存在<strong>当前浏览器</strong>。定时任务在服务端执行时，会将 Key 同步写入本机数据库供 Cron 使用，读取需要登录鉴权。请勿将 Key 分享给他人。
        </span>
      </div>

      <div className="as-layout">

        {/* ── 左侧导航 ── */}
        <aside className="as-sidebar">

          {/* 配置状态总览 */}
          <div className="as-status-block">
            <div className="as-status-label">配置状态</div>
            <div className="as-status-grid">
              {STATUS_CARDS.map(card => {
                const ok = card.local || card.server
                const source = card.local ? '本地' : card.server ? card.serverNote : null
                return (
                  <button
                    key={card.label}
                    className={`as-status-card as-status-card--${card.color}${ok ? ' as-status-card--ok' : ''}`}
                    onClick={() => setActiveSection(card.section)}
                    title={`前往配置 ${card.label}`}
                  >
                    <div className="as-status-card-top">
                      {ok
                        ? <CheckCircle2 size={13} className="as-sc-icon as-sc-icon--ok" />
                        : <AlertCircle size={13} className="as-sc-icon as-sc-icon--off" />
                      }
                      <span className="as-status-card-name">{card.label}</span>
                    </div>
                    <div className="as-status-card-src">
                      {ok ? source : '未配置'}
                    </div>
                  </button>
                )
              })}
            </div>
            <p className="as-status-legend">
              <span className="as-legend-dot as-legend-dot--local" />本地 = 浏览器存储
              <span className="as-legend-dot as-legend-dot--server" style={{ marginLeft: 8 }} />服务端 = .env
            </p>
          </div>

          {/* 功能导航 */}
          <nav className="as-nav">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                className={`as-nav-item${activeSection === item.id ? ' as-nav-item--active' : ''}`}
                onClick={() => setActiveSection(item.id)}
              >
                <span className="as-nav-icon">{item.icon}</span>
                <span className="as-nav-text">
                  <span className="as-nav-label">{item.label}</span>
                  <span className="as-nav-sub">{item.sub}</span>
                </span>
                <ChevronRight size={14} className="as-nav-arrow" />
              </button>
            ))}

            {/* Token 用量统计入口 */}
            <button
              className="as-nav-item"
              onClick={() => navigate('/token-usage')}
            >
              <span className="as-nav-icon">⚡</span>
              <span className="as-nav-text">
                <span className="as-nav-label">Token 用量</span>
                <span className="as-nav-sub">消耗统计与费用估算</span>
              </span>
              <ChevronRight size={14} className="as-nav-arrow" />
            </button>
          </nav>
        </aside>

        {/* ── 右侧内容 ── */}
        <main className="as-content">

          {/* ════ 文章生成 ════ */}
          {activeSection === 'article' && (
            <div className="as-panel">
              <div className="as-panel-header">
                <h2 className="as-panel-title">文章生成</h2>
                <p className="as-panel-desc">选择 AI 服务商，填入 API Key，生成公众号文章</p>
              </div>

              {/* 快速预设方案 */}
              <div className="as-card">
                <div className="as-card-section-label">快速预设方案</div>
                <p className="as-card-desc">一键应用推荐配置，无需逐个填写 API Key</p>
                <div className="as-provider-grid">
                  {CONFIG_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      className="as-provider-tile"
                      onClick={() => applyPreset(preset.id)}
                    >
                      <span className="as-pt-name">{preset.name}</span>
                      <span className="as-pt-desc">{preset.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="as-card">
                <div className="as-card-section-label">选择服务商</div>
                <div className="as-provider-grid">
                  {PROVIDER_PRESETS.map(p => (
                    <button
                      key={p.id}
                      className={`as-provider-tile${config.articleProvider === p.id ? ' as-provider-tile--active' : ''}`}
                      onClick={() => handleArticleProviderChange(p.id)}
                    >
                      <span className="as-pt-name">{p.name}</span>
                      <span className="as-pt-desc">{p.desc}</span>
                      <span className="as-pt-hint">
                        <a href={p.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>获取 Key ↗</a> {p.tip}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="as-card-divider" />

                {config.articleProvider === 'maas' ? (
                  <>
                    <div className="as-row-2">
                      <div className="as-field">
                        <label className="as-label">Base URL</label>
                        <input
                          className="as-input"
                          value={config.maasBaseUrl}
                          onChange={e => set({ maasBaseUrl: e.target.value })}
                          placeholder="https://maas.devops.xiaohongshu.com/v1"
                        />
                      </div>
                      <div className="as-field">
                        <label className="as-label">User Email</label>
                        <input
                          className="as-input"
                          value={config.maasUserEmail}
                          onChange={e => set({ maasUserEmail: e.target.value })}
                          placeholder="your@xiaohongshu.com"
                        />
                      </div>
                    </div>
                    <div className="as-field">
                      <label className="as-label">API Key</label>
                      <div className="as-key-wrap">
                        <input
                          className="as-input as-input-mono"
                          type={showKeys['maas'] ? 'text' : 'password'}
                          value={config.maasApiKey}
                          onChange={e => set({ maasApiKey: e.target.value })}
                          placeholder="sk-..."
                        />
                        <button className="as-eye-btn" onClick={() => toggleKey('maas')}>
                          {showKeys['maas'] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="as-row-2">
                      <div className="as-field as-field--grow">
                        <label className="as-label">Base URL</label>
                        <input
                          className="as-input"
                          value={config.articleBaseUrl}
                          onChange={e => set({ articleBaseUrl: e.target.value })}
                          placeholder="https://api.openai.com/v1"
                        />
                      </div>
                      <div className="as-field">
                        <label className="as-label">模型</label>
                        <input
                          className="as-input"
                          list="as-model-list"
                          value={config.articleModel}
                          onChange={e => set({ articleModel: e.target.value })}
                          placeholder="gpt-4o"
                        />
                        <datalist id="as-model-list">
                          {selectedArticlePreset?.models.map(m => (
                            <option key={m} value={m} />
                          ))}
                        </datalist>
                      </div>
                    </div>
                    <div className="as-field">
                      <label className="as-label">API Key</label>
                      <div className="as-key-wrap">
                        <input
                          className="as-input as-input-mono"
                          type={showKeys['article'] ? 'text' : 'password'}
                          value={config.articleApiKey}
                          onChange={e => set({ articleApiKey: e.target.value })}
                          placeholder="sk-..."
                        />
                        <button className="as-eye-btn" onClick={() => toggleKey('article')}>
                          {showKeys['article'] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                <div className="as-test-row">
                  <button className="as-btn-test" onClick={handleTest} disabled={testing}>
                    {testing ? '测试中...' : '测试连接'}
                  </button>
                  {testResult && (
                    <span className={`as-test-msg${testResult.ok ? ' as-test-msg--ok' : ' as-test-msg--err'}`}>
                      {testResult.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                      {testResult.msg}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ════ 封面生成 ════ */}
          {activeSection === 'cover' && (
            <div className="as-panel">
              <div className="as-panel-header">
                <h2 className="as-panel-title">封面生成</h2>
                <p className="as-panel-desc">封面生成器支持多种图片服务，Key 填了才能用对应服务</p>
              </div>

              {/* SiliconFlow — Kolors / Z-Image / Qwen 图编 */}
              <div className="as-card">
                <div className="as-card-label-row">
                  <span className="as-card-section-label">SiliconFlow</span>
                  <span className="as-card-tag as-card-tag--peach">Kolors · Z-Image · Qwen 图编</span>
                </div>
                <div className="as-field">
                  <label className="as-label">API Key</label>
                  <div className="as-key-wrap">
                    <input
                      className="as-input as-input-mono"
                      type={showKeys['siliconflow'] ? 'text' : 'password'}
                      value={config.siliconflowApiKey}
                      onChange={e => set({ siliconflowApiKey: e.target.value })}
                      placeholder="sk-nf..."
                    />
                    <button className="as-eye-btn" onClick={() => toggleKey('siliconflow')}>
                      {showKeys['siliconflow'] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <p className="as-hint">
                    前往 <a href="https://cloud.siliconflow.cn/account/ak" target="_blank" rel="noreferrer">cloud.siliconflow.cn</a> 获取，注册即送免费额度
                  </p>
                </div>
                <div className="as-field">
                  <label className="as-label">Kolors 模型 <span className="as-label-opt">选填</span></label>
                  <input
                    className="as-input"
                    list="as-siliconflow-models"
                    value={config.siliconflowModel}
                    onChange={e => set({ siliconflowModel: e.target.value })}
                    placeholder="Kwai-Kolors/Kolors"
                  />
                  <datalist id="as-siliconflow-models">
                    <option value="Kwai-Kolors/Kolors" />
                    <option value="Tongyi-MAI/Z-Image" />
                    <option value="Tongyi-MAI/Z-Image-Turbo" />
                    <option value="black-forest-labs/FLUX.1-schnell" />
                  </datalist>
                </div>
              </div>

              {/* DALL-E / Stability */}
              <div className="as-card">
                <div className="as-card-label-row">
                  <span className="as-card-section-label">OpenAI / Stability</span>
                  <span className="as-card-tag as-card-tag--ochre">DALL-E 3 · Stability AI</span>
                </div>
                <div className="as-field">
                  <label className="as-label">API Key</label>
                  <div className="as-key-wrap">
                    <input
                      className="as-input as-input-mono"
                      type={showKeys['cover'] ? 'text' : 'password'}
                      value={config.coverApiKey}
                      onChange={e => set({ coverApiKey: e.target.value })}
                      placeholder="sk-..."
                    />
                    <button className="as-eye-btn" onClick={() => toggleKey('cover')}>
                      {showKeys['cover'] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <p className="as-hint">DALL-E 3 填 OpenAI Key；Stability AI 填 Stability Key。文章 Key 与封面 Key 相同时复制即可。</p>
                </div>
              </div>

              {/* 默认 provider */}
              <div className="as-card">
                <div className="as-card-section-label">默认封面服务</div>
                <p className="as-card-desc">封面生成器里可随时切换，这里设默认值</p>
                <div className="as-provider-grid">
                  {COVER_PROVIDER_PRESETS.map(p => (
                    <>
                      <button
                        key={p.id}
                        className={`as-provider-tile${config.coverProvider === p.id ? ' as-provider-tile--active' : ''}`}
                        onClick={() => set({ coverProvider: p.id })}
                      >
                        <span className="as-pt-name">{p.name}</span>
                        <span className="as-pt-desc">{p.desc}</span>
                      </button>
                    </>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ════ 素材搜索 ════ */}
          {activeSection === 'search' && (
            <div className="as-panel">
              <div className="as-panel-header">
                <h2 className="as-panel-title">素材搜索</h2>
                <p className="as-panel-desc">配置后可在素材采集面板按关键词搜索网页，搜索结果可一键读取全文</p>
              </div>

              <div className="as-card">
                <div className="as-card-section-label">搜索服务商</div>
                <p className="as-card-desc">SearXNG 无需 API Key 即可使用，适合入门；Serper / Bing 需注册获取 Key</p>
                <div className="as-provider-grid">
                  {[
                    { id: 'zhipu', name: '智谱搜索（推荐）', desc: '与 LLM 共用 GLM_API_KEY，零额外配置', url: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys', tip: '登录智谱开放平台获取 API Key' },
                    { id: 'searxng', name: 'SearXNG', desc: '开源聚合，231 个搜索引擎，无需 Key', url: 'https://docs.searxng.org/admin/installation-docker.html', tip: 'Docker 一键部署，零成本' },
                    { id: 'serper', name: 'Serper.dev', desc: '支持 Google / 百度，2500 次/月免费', url: 'https://serper.dev', tip: '免费注册，2500 次/月' },
                    { id: 'bing', name: 'Bing Search', desc: 'Microsoft，1000 次/月免费', url: 'https://portal.azure.com', tip: 'Azure Portal 创建资源' },
                  ].map(p => (
                    <div key={p.id} className="as-provider-wrap">
                      <button
                        className={`as-provider-tile${config.searchProvider === p.id ? ' as-provider-tile--active' : ''}`}
                        onClick={() => set({ searchProvider: p.id as AIConfig['searchProvider'] })}
                      >
                        <span className="as-pt-name">{p.name}</span>
                        <span className="as-pt-desc">{p.desc}</span>
                      </button>
                      <p className="as-hint as-provider-hint">
                        <a href={p.url} target="_blank" rel="noreferrer">获取 Key ↗</a> {p.tip}
                      </p>
                    </div>
                  ))}
                </div>

                {/* SearXNG 配置 */}
                {config.searchProvider === 'searxng' && (
                  <>
                    <div className="as-card-divider" />
                    <div className="as-field">
                      <label className="as-label">SearXNG 实例 URL <span className="as-label-opt">选填，默认使用公共实例</span></label>
                      <input
                        className="as-input as-input-mono"
                        value={config.searxngUrl || ''}
                        onChange={e => set({ searxngUrl: e.target.value })}
                        placeholder="https://paulgo.io（留空使用默认公共实例）"
                      />
                      <p className="as-hint">
                        公共实例列表：<a href="https://searx.space" target="_blank" rel="noreferrer">searx.space</a>。
                        自建实例参考：<a href="https://docs.searxng.org/admin/installation-docker.html" target="_blank" rel="noreferrer">Docker 安装文档</a>。
                        公共实例可能偶发限流，自建实例更稳定。
                      </p>
                    </div>
                    <div className="as-test-row">
                      <span className="as-test-msg as-test-msg--ok">
                        <CheckCircle2 size={13} />
                        SearXNG 无需 API Key，直接使用即可
                      </span>
                    </div>
                  </>
                )}

                {/* Serper engine 选择 */}
                {config.searchProvider === 'serper' && (
                  <>
                    <div className="as-card-divider" />
                    <div className="as-card-section-label">搜索引擎</div>
                    <div className="as-provider-grid">
                      {[
                        { id: 'google', name: 'Google', desc: '全球最大' },
                        { id: 'baidu', name: '百度', desc: '国内最大' },
                        { id: 'bing', name: 'Bing', desc: '微软必应' },
                      ].map(e => (
                        <button
                          key={e.id}
                          className={`as-provider-tile${config.searchEngine === e.id ? ' as-provider-tile--active' : ''}`}
                          onClick={() => set({ searchEngine: e.id })}
                        >
                          <span className="as-pt-name">{e.name}</span>
                          <span className="as-pt-desc">{e.desc}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* Serper / Bing API Key */}
                {config.searchProvider !== 'searxng' && (
                  <>
                    <div className="as-card-divider" />
                    <div className="as-field">
                      <label className="as-label">{config.searchProvider === 'serper' ? 'Serper' : 'Bing'} API Key</label>
                      <div className="as-key-wrap">
                        <input
                          className="as-input as-input-mono"
                          type={showKeys['search'] ? 'text' : 'password'}
                          value={config.searchApiKey}
                          onChange={e => set({ searchApiKey: e.target.value })}
                          placeholder={config.searchProvider === 'serper' ? 'serper.dev 注册后获取' : 'Azure Portal 获取'}
                        />
                        <button className="as-eye-btn" onClick={() => toggleKey('search')}>
                          {showKeys['search'] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      <p className="as-hint">
                        {config.searchProvider === 'serper'
                          ? <><a href="https://serper.dev" target="_blank" rel="noreferrer">serper.dev</a> 免费注册，赠 2500 次额度，支持 Google / 百度 / Bing</>
                          : <><a href="https://portal.azure.com" target="_blank" rel="noreferrer">Azure Portal</a> 创建「Bing Search v7」资源，每月 1000 次免费</>
                        }
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* Jina Reader 配置 */}
              <div className="as-card">
                <div className="as-card-label-row">
                  <span className="as-card-section-label">Jina Reader（读全文）</span>
                  <span className="as-card-tag as-card-tag--teal">可选，无 Key 自动降级</span>
                </div>
                <p className="as-card-desc">
                  读全文时优先调用 Jina Reader（返回干净 Markdown），无法访问时自动降级为直接抓取。国内服务器可能无法访问 r.jina.ai，填写 API Key 可走付费通道（更稳定）。
                </p>
                <div className="as-field">
                  <label className="as-label">Jina API Key <span className="as-label-opt">选填，留空走免费通道（可能被墙）</span></label>
                  <div className="as-key-wrap">
                    <input
                      className="as-input as-input-mono"
                      type={showKeys['jina'] ? 'text' : 'password'}
                      value={config.jinaApiKey || ''}
                      onChange={e => set({ jinaApiKey: e.target.value })}
                      placeholder="jina_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    />
                    <button className="as-eye-btn" onClick={() => toggleKey('jina')}>
                      {showKeys['jina'] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <p className="as-hint">
                    前往 <a href="https://jina.ai/reader" target="_blank" rel="noreferrer">jina.ai/reader</a> 注册获取，每天免费 200 次，付费可解锁更多额度
                  </p>
                </div>
              </div>

              {/* SearXNG 说明卡片 */}
              {config.searchProvider === 'searxng' && (
                <div className="as-card as-card--hint">
                  <div className="as-card-section-label">关于 SearXNG</div>
                  <ul className="as-memory-tips">
                    <li>聚合 231 个搜索引擎，包含 Google、Bing、百度、DuckDuckGo 等</li>
                    <li>无需注册，无需 API Key，开箱即用</li>
                    <li>公共实例有速率限制，频繁使用建议自建实例（Docker 5 分钟搭好）</li>
                    <li>搜索结果获得摘要后，点「读全文」用 Jina Reader 获取完整正文</li>
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ════ 图床配置 ════ */}
          {activeSection === 'cdn' && (
            <div className="as-panel">
              <div className="as-panel-header">
                <h2 className="as-panel-title">图床配置</h2>
                <p className="as-panel-desc">编辑器粘贴 / 拖拽图片时，自动上传到图床并插入外链 URL，方便公众号发布</p>
              </div>

              {/* 选择方案 */}
              <div className="as-card">
                <div className="as-card-section-label">选择图床方案</div>
                <div className="as-provider-grid">
                  {[
                    { id: 'none', name: '不使用', desc: '图片保存在本机，仅本地可访问' },
                    { id: 'github', name: 'GitHub + jsDelivr', desc: '国内访问快，免费无限制，推荐' },
                    { id: 'imgur', name: 'Imgur', desc: '全球 CDN，国内需代理' },
                  ].map(p => (
                    <button
                      key={p.id}
                      className={`as-provider-tile${config.cdnProvider === p.id ? ' as-provider-tile--active' : ''}`}
                      onClick={() => set({ cdnProvider: p.id as AIConfig['cdnProvider'] })}
                    >
                      <span className="as-pt-name">{p.name}</span>
                      <span className="as-pt-desc">{p.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* GitHub 配置 */}
              {config.cdnProvider === 'github' && (
                <div className="as-card">
                  <div className="as-card-label-row">
                    <span className="as-card-section-label">GitHub + jsDelivr</span>
                    <span className="as-card-tag as-card-tag--teal">国内加速 · 免费无限制</span>
                  </div>
                  <p className="as-card-desc">
                    图片上传到 GitHub 仓库，通过 jsDelivr CDN 分发。国内访问速度优于 Imgur，且无容量限制。
                  </p>

                  <div className="as-field">
                    <label className="as-label">Personal Access Token</label>
                    <div className="as-key-wrap">
                      <input
                        className="as-input as-input-mono"
                        type={showKeys['github'] ? 'text' : 'password'}
                        value={config.githubToken}
                        onChange={e => set({ githubToken: e.target.value })}
                        placeholder="ghp_xxxxxxxxxxxx"
                      />
                      <button className="as-eye-btn" onClick={() => toggleKey('github')}>
                        {showKeys['github'] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <p className="as-hint">
                      前往 <a href="https://github.com/settings/tokens/new" target="_blank" rel="noreferrer">GitHub → Settings → Tokens</a>，
                      创建 Classic Token，勾选 <code>repo</code> 权限
                    </p>
                  </div>

                  <div className="as-row-2">
                    <div className="as-field as-field--grow">
                      <label className="as-label">仓库</label>
                      <input
                        className="as-input as-input-mono"
                        value={config.githubRepo}
                        onChange={e => set({ githubRepo: e.target.value })}
                        placeholder="username/my-images"
                      />
                      <p className="as-hint">建一个专门存图片的公开仓库，格式：用户名/仓库名</p>
                    </div>
                    <div className="as-field">
                      <label className="as-label">分支</label>
                      <input
                        className="as-input as-input-mono"
                        value={config.githubBranch}
                        onChange={e => set({ githubBranch: e.target.value })}
                        placeholder="main"
                      />
                    </div>
                  </div>

                  <div className="as-field">
                    <label className="as-label">存储路径 <span className="as-label-opt">选填</span></label>
                    <input
                      className="as-input as-input-mono"
                      value={config.githubPath}
                      onChange={e => set({ githubPath: e.target.value })}
                      placeholder="images/"
                    />
                    <p className="as-hint">图片在仓库中的存放目录，以 / 结尾，默认 images/</p>
                  </div>

                  {config.githubToken && config.githubRepo && (
                    <div className="as-test-row">
                      <span className="as-test-msg as-test-msg--ok">
                        <CheckCircle2 size={13} />
                        已配置，图片将上传到 {config.githubRepo} 并通过 jsDelivr 访问
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Imgur 配置 */}
              {config.cdnProvider === 'imgur' && (
                <div className="as-card">
                  <div className="as-card-label-row">
                    <span className="as-card-section-label">Imgur</span>
                    <span className="as-card-tag as-card-tag--lavender">全球 CDN · 国内需代理</span>
                  </div>
                  <p className="as-card-desc">
                    免费图床，单张 10MB 限制，匿名上传永久有效。国内访问可能较慢。
                  </p>
                  <div className="as-field">
                    <label className="as-label">Client ID</label>
                    <div className="as-key-wrap">
                      <input
                        className="as-input as-input-mono"
                        type={showKeys['imgur'] ? 'text' : 'password'}
                        value={config.imgurClientId}
                        onChange={e => set({ imgurClientId: e.target.value })}
                        placeholder="xxxxxxxxxxxxxxx"
                      />
                      <button className="as-eye-btn" onClick={() => toggleKey('imgur')}>
                        {showKeys['imgur'] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <p className="as-hint">
                      前往 <a href="https://api.imgur.com/oauth2/addclient" target="_blank" rel="noreferrer">api.imgur.com/oauth2/addclient</a>，
                      选「OAuth 2 authorization without a callback URL」，获取 Client ID
                    </p>
                  </div>

                  {config.imgurClientId && (
                    <div className="as-test-row">
                      <span className="as-test-msg as-test-msg--ok">
                        <CheckCircle2 size={13} />
                        已配置，图片将上传到 Imgur CDN
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* 不使用时提示 */}
              {config.cdnProvider === 'none' && (
                <div className="as-card">
                  <p className="as-hint" style={{ margin: 0 }}>
                    未启用图床，图片将保存在本机服务器。分享文章时图片链接仅本地可访问，不适合对外发布。
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ════ 永久记忆 ════ */}
          {activeSection === 'memory' && (
            <div className="as-panel">
              <div className="as-panel-header">
                <h2 className="as-panel-title">永久记忆</h2>
                <p className="as-panel-desc">这里的内容会在每次生成文章时自动注入到 AI 提示词中，适合放置写作背景、账号定位、常用素材模板等固定信息</p>
              </div>

              <div className="as-card">
                <div className="as-card-section-label">全局背景内容</div>
                <p className="as-card-desc">
                  支持 Markdown 格式。建议包含：账号定位、目标读者、写作风格偏好、常见禁忌词、固定参考数据等。
                </p>

                {memoryLoadError && (
                  <div className="as-memory-error">
                    <AlertCircle size={13} />
                    {memoryLoadError}
                  </div>
                )}

                <textarea
                  className="as-memory-editor"
                  value={globalMemory}
                  onChange={e => { setGlobalMemory(e.target.value); setMemoryLoadError('') }}
                  placeholder={`## 账号定位\n- 面向：大学生家长、教师群体\n- 风格：真诚实用，避免官腔\n\n## 常用背景\n- 平台：微信公众号\n- 字数目标：1500-2000 字\n\n## 禁忌词\n- 不得使用「首先其次」「总而言之」等套话\n- 不用「深度」「全面」等空洞修饰词`}
                  rows={16}
                />

                <div className="as-memory-footer">
                  <span className="as-memory-count">
                    {globalMemory.length} 字
                    {globalMemory.length > 0 && ' · 已启用，每次生成文章时自动注入'}
                  </span>
                  <div className="as-memory-actions">
                    {globalMemory && (
                      <button
                        className="as-btn-ghost"
                        onClick={() => { if (confirm('清空全部永久记忆内容？')) setGlobalMemory('') }}
                      >
                        清空
                      </button>
                    )}
                    <button
                      className={`as-btn-test${memorySaved ? ' as-btn-test--ok' : ''}`}
                      onClick={saveGlobalMemory}
                      disabled={memorySaving}
                    >
                      {memorySaving ? '保存中...' : memorySaved ? <><Check size={13} />已保存</> : <><Save size={13} />保存记忆</>}
                    </button>
                  </div>
                </div>
              </div>

              <div className="as-card as-card--hint">
                <div className="as-card-section-label">使用建议</div>
                <ul className="as-memory-tips">
                  <li>账号定位、目标读者群体放这里，不用每篇文章重复填</li>
                  <li>常用的竞品对比、行业数据可以放这里作为参考背景</li>
                  <li>禁止使用的表述方式或必须遵守的格式规则可以在这里强调</li>
                  <li>内容越精炼越好，控制在 500 字以内效果最佳</li>
                </ul>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  )
}
