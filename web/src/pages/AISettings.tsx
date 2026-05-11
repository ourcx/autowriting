import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Save, Check, Eye, EyeOff, AlertCircle, CheckCircle2,
  Zap, Image, Search, ChevronRight,
} from 'lucide-react'
import {
  AIConfig,
  loadAIConfig,
  PROVIDER_PRESETS,
  COVER_PROVIDER_PRESETS,
} from '../utils/aiConfig'
import { useConfigStore, setLocalConfig, fetchServerStatus } from '../store/useConfigStore'
import { testAIConnection } from '../utils/apiHelpers'
import './AISettings.css'

type Section = 'article' | 'cover' | 'search'

const NAV_ITEMS: { id: Section; icon: React.ReactNode; label: string; sub: string }[] = [
  { id: 'article', icon: <Zap size={16} />,    label: '文章生成',    sub: '大语言模型 API' },
  { id: 'cover',   icon: <Image size={16} />,  label: '封面生成',    sub: '图片生成 API'   },
  { id: 'search',  icon: <Search size={16} />, label: '素材搜索',    sub: '搜索引擎 API'   },
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

  useEffect(() => {
    setConfig(loadAIConfig())
    fetchServerStatus()
  }, [])

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

  const selectedArticlePreset = PROVIDER_PRESETS.find(p => p.id === config.articleProvider)

  // ── 配置状态（每个 key 的状态） ──────────────────────────────────────────
  const localMaas        = config.articleProvider === 'maas' && !!config.maasApiKey
  const localOpenai      = config.articleProvider !== 'maas' && !!config.articleApiKey
  const localSiliconflow = !!config.siliconflowApiKey
  const localCoverKey    = !!config.coverApiKey
  const localSearchKey   = !!config.searchApiKey

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
  ]

  return (
    <div className="as-root">
      {/* ── Header ── */}
      <header className="as-header">
        <div className="as-header-left">
          <button className="as-back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={15} />
            返回
          </button>
          <span className="as-header-title">API 配置</span>
        </div>
        <button className={`as-save-btn${saved ? ' as-save-btn--ok' : ''}`} onClick={handleSave}>
          {saved ? <Check size={14} /> : <Save size={14} />}
          {saved ? '已保存' : '保存'}
        </button>
      </header>

      <div className="as-layout">

        {/* ── 左侧导航 ── */}
        <aside className="as-sidebar">

          {/* 配置状态总览 */}
          <div className="as-status-block">
            <div className="as-status-label">配置状态</div>
            <div className="as-status-grid">
              {STATUS_CARDS.map(card => {
                const ok     = card.local || card.server
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
                        : <AlertCircle  size={13} className="as-sc-icon as-sc-icon--off" />
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
                      {config.articleProvider === p.id && <Check size={13} className="as-pt-check" />}
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
                    <button
                      key={p.id}
                      className={`as-provider-tile${config.coverProvider === p.id ? ' as-provider-tile--active' : ''}`}
                      onClick={() => set({ coverProvider: p.id })}
                    >
                      <span className="as-pt-name">{p.name}</span>
                      <span className="as-pt-desc">{p.desc}</span>
                      {config.coverProvider === p.id && <Check size={13} className="as-pt-check" />}
                    </button>
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
                <p className="as-panel-desc">配置后可在素材采集面板按关键词搜索网页，支持 Google / 百度 / Bing</p>
              </div>

              <div className="as-card">
                <div className="as-card-section-label">搜索服务商</div>
                <div className="as-provider-grid">
                  {[
                    { id: 'serper', name: 'Serper.dev', desc: '支持 Google / 百度，2500 次/月免费' },
                    { id: 'bing',   name: 'Bing Search', desc: 'Microsoft，1000 次/月免费' },
                  ].map(p => (
                    <button
                      key={p.id}
                      className={`as-provider-tile${config.searchProvider === p.id ? ' as-provider-tile--active' : ''}`}
                      onClick={() => set({ searchProvider: p.id as AIConfig['searchProvider'] })}
                    >
                      <span className="as-pt-name">{p.name}</span>
                      <span className="as-pt-desc">{p.desc}</span>
                      {config.searchProvider === p.id && <Check size={13} className="as-pt-check" />}
                    </button>
                  ))}
                </div>

                {config.searchProvider === 'serper' && (
                  <>
                    <div className="as-card-divider" />
                    <div className="as-card-section-label">搜索引擎</div>
                    <div className="as-provider-grid">
                      {[
                        { id: 'google', name: 'Google',    desc: '全球最大' },
                        { id: 'baidu',  name: '百度',       desc: '国内最大' },
                        { id: 'bing',   name: 'Bing',       desc: '微软必应' },
                      ].map(e => (
                        <button
                          key={e.id}
                          className={`as-provider-tile${config.searchEngine === e.id ? ' as-provider-tile--active' : ''}`}
                          onClick={() => set({ searchEngine: e.id })}
                        >
                          <span className="as-pt-name">{e.name}</span>
                          <span className="as-pt-desc">{e.desc}</span>
                          {config.searchEngine === e.id && <Check size={13} className="as-pt-check" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}

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
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  )
}
