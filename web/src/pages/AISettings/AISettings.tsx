import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Save, Check, Eye, EyeOff, AlertCircle, CheckCircle2,
  Zap, Image, Search, ChevronRight,
  ExternalLink, Sparkles, ArrowRight,
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

type Section = 'overview' | 'quickstart' | 'providers' | 'article' | 'cover' | 'search' | 'advanced' | 'cdn'

const WORKFLOW_TABS = [
  { id: 'overview', label: '概览' },
  { id: 'article', label: '文章' },
  { id: 'search', label: '联网' },
  { id: 'cover', label: '封面' },
  { id: 'providers', label: '更多' },
] as const

const MORE_TABS = [
  { id: 'providers', label: '公共 Key' },
  { id: 'advanced', label: '智谱与知识库' },
  { id: 'cdn', label: '图片存储' },
] as const

const SEARCH_LABELS: Record<AIConfig['searchProvider'], string> = {
  deepseek: 'DeepSeek', zhipu: '智谱', searxng: 'SearXNG', serper: 'Serper', bing: 'Bing',
}

export default function AISettings() {
  const navigate = useNavigate()
  const storeState = useConfigStore()
  const serverStatus = storeState.serverStatus

  const [config, setConfig] = useState<AIConfig>(loadAIConfig)
  const [saved, setSaved] = useState(false)
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [activeSection, setActiveSection] = useState<Section>('overview')

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

  // 应用快速预设
  const applyPreset = (presetId: string) => {
    const preset = CONFIG_PRESETS.find(p => p.id === presetId)
    if (preset) {
      setConfig(c => ({ ...c, ...(preset.config as Partial<AIConfig>) }))
      setTestResult(null)
    }
  }

  const applyRecommendedSetup = () => {
    set({
      articleProvider: 'zhipu',
      articleBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      articleModel: 'glm-5.3-flash',
      articleApiKey: '',
      coverProvider: 'zhipu',
      zhipuImageApiKey: '',
      searchProvider: 'zhipu',
      searchApiKey: '',
      glmApiKey: '',
    })
  }

  const handleSaveAndStart = () => {
    setLocalConfig(config)
    navigate('/')
  }

  const selectedArticlePreset = PROVIDER_PRESETS.find(p => p.id === config.articleProvider)

  // ── 配置状态（每个 key 的状态） ──────────────────────────────────────────
  const deepseekSelected = config.articleProvider === 'deepseek'
  const deepseekReady = Boolean(serverStatus?.deepseekReady)
  const localArticleReady = !deepseekSelected && (config.articleProvider === 'maas'
    ? Boolean(config.maasApiKey)
    : config.articleProvider === 'zhipu'
      ? Boolean(config.articleApiKey || config.zhipuApiKey)
      : Boolean(config.articleApiKey))
  const localCoverReady = config.coverProvider === 'local'
    || (config.coverProvider === 'openrouter' && Boolean(config.openrouterApiKey))
    || (config.coverProvider === 'zhipu' && Boolean(config.zhipuImageApiKey || config.zhipuApiKey))
    || (config.coverProvider === 'doubao' && Boolean(config.doubaoApiKey && config.doubaoModel))
    || (['siliconflow', 'z-image', 'qwen-edit'].includes(config.coverProvider) && Boolean(config.siliconflowApiKey))
    || (['openai', 'stability'].includes(config.coverProvider) && Boolean(config.coverApiKey))
  const sharedZhipuReady = Boolean(config.zhipuApiKey || serverStatus?.zhipuReady)
  const searchKeyReady = Boolean(config.searchApiKey)
  const searchUsesFallback = config.searchProvider === 'serper' && !searchKeyReady
  const searchUsesDeepSeek = searchUsesFallback && deepseekReady
  const searchUsesZhipu = searchUsesFallback && !searchUsesDeepSeek && (sharedZhipuReady || config.glmApiKey || (config.articleProvider === 'zhipu' && config.articleApiKey))
  const searchReady = config.searchProvider === 'searxng'
    || (config.searchProvider === 'deepseek' && deepseekReady)
    || (config.searchProvider === 'serper' && searchKeyReady)
    || (config.searchProvider === 'zhipu' && Boolean(searchKeyReady || sharedZhipuReady || config.glmApiKey || (config.articleProvider === 'zhipu' && config.articleApiKey)))
  const recommendedApplied = config.articleProvider === 'zhipu'
    && config.coverProvider === 'zhipu'
    && config.searchProvider === 'zhipu'
  const recommendedReady = recommendedApplied && sharedZhipuReady
  const coverName = COVER_PROVIDER_PRESETS.find(p => p.id === config.coverProvider)?.name
  const more = MORE_TABS.some(tab => tab.id === activeSection)
  const tabId = more ? 'providers' : activeSection === 'quickstart' ? 'overview' : activeSection
  const services = [
    {
      id: 'article', icon: <Zap size={18} />, name: '文章模型',
      detail: [selectedArticlePreset?.name, config.articleModel].filter(Boolean).join(' · '),
      status: localArticleReady ? '浏览器已配置' : (deepseekSelected ? deepseekReady : serverStatus?.articleReady) ? '服务端已配置' : '待配置',
    },
    {
      id: 'search', icon: <Search size={18} />, name: '联网与来源核查',
      detail: searchUsesDeepSeek ? 'DeepSeek' : searchUsesZhipu ? '智谱' : searchUsesFallback ? 'Serper / SearXNG' : SEARCH_LABELS[config.searchProvider],
      status: searchUsesDeepSeek ? '服务端已配置' : searchUsesZhipu || searchReady ? '已配置' : searchUsesFallback ? '将尝试备用搜索' : '待配置',
    },
    {
      id: 'cover', icon: <Image size={18} />, name: '封面生成',
      detail: coverName,
      status: config.coverProvider === 'local' ? '本地生成' : localCoverReady ? '浏览器已配置'
        : config.coverProvider === serverStatus?.coverProvider && serverStatus.coverReady ? '服务端已配置' : '待配置',
    },
  ] as const

  return (
    <div className="as-root">
      <PageHeader
        title="AI 配置"
        onBack={() => navigate(-1)}
        actions={(
          <div className="as-header-actions">
            <button className="as-usage-btn" onClick={() => navigate('/token-usage')}>Token 用量</button>
            <button className={`as-save-btn${saved ? ' as-save-btn--ok' : ''}`} onClick={handleSave}>
              {saved ? <Check size={14} /> : <Save size={14} />}
              {saved ? '已保存' : '保存'}
            </button>
          </div>
        )}
      />

      <div className="as-layout">
        <nav className="as-tabs" aria-label="AI 配置分类">
          {WORKFLOW_TABS.map(tab => (
            <button type="button" key={tab.id} aria-pressed={tabId === tab.id} onClick={() => setActiveSection(tab.id)}>{tab.label}</button>
          ))}
        </nav>
        <main className="as-content">
          {activeSection === 'overview' && (
            <section className="as-panel">
              <div className="as-overview-heading">
                <h2 className="as-panel-title">创作服务</h2>
                <button className="as-text-button" onClick={() => setActiveSection('quickstart')}><Sparkles size={15} /> 快速配置</button>
              </div>
              <div className="as-service-list">
                {services.map(service => (
                  <button type="button" className="as-service-row" key={service.id} onClick={() => setActiveSection(service.id)}>
                    <span className="as-service-icon">{service.icon}</span>
                    <span className="as-service-copy"><strong>{service.name}</strong><span>{service.detail}</span></span>
                    <span className="as-service-status" data-ready={service.status !== '待配置'}>{service.status}</span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <p className="as-hint">文章 Agent 会用联网服务搜索资料和核查来源。浏览器里的封面 Key 在对应服务设置中管理。</p>
            </section>
          )}

          {more && (
            <nav className="as-subtabs" aria-label="更多 AI 设置">
              {MORE_TABS.map(tab => (
                <button type="button" key={tab.id} aria-pressed={activeSection === tab.id} onClick={() => setActiveSection(tab.id)}>{tab.label}</button>
              ))}
            </nav>
          )}

          {/* ════ 快速开始 ════ */}
          {activeSection === 'quickstart' && (
            <div className="as-panel">
              <div className="as-panel-header">
                <button className="as-text-button" onClick={() => setActiveSection('overview')}>返回概览</button>
                <h2 className="as-panel-title">快速配置</h2>
              </div>

              <div className="as-card as-quick-card">
                <div className="as-quick-heading">
                  <div>
                    <span className="as-card-tag as-card-tag--teal">推荐 · 最少配置</span>
                    <h3>智谱一站式方案</h3>
                    <p>文章用 GLM，封面用 GLM-Image，素材搜索也复用同一个 Key。</p>
                  </div>
                  <button
                    className={`as-quick-apply${recommendedApplied ? ' as-quick-apply--active' : ''}`}
                    onClick={applyRecommendedSetup}
                  >
                    {recommendedApplied ? <Check size={15} /> : <Sparkles size={15} />}
                    {recommendedApplied ? '已选用' : '一键使用'}
                  </button>
                </div>

                <div className="as-quick-capabilities" aria-label="推荐方案能力">
                  {[
                    ['文章生成', 'GLM-5.3 Flash'],
                    ['封面生成', 'GLM-Image'],
                    ['素材搜索', '智谱 Web Search'],
                  ].map(([label, detail]) => (
                    <div className="as-quick-capability" key={label}>
                      {recommendedReady
                        ? <CheckCircle2 size={17} />
                        : <span className="as-quick-step-dot" />}
                      <span><strong>{label}</strong><small>{detail}</small></span>
                    </div>
                  ))}
                </div>

                <div className="as-card-divider" />

                <div className="as-field">
                  <label className="as-label">智谱 API Key</label>
                  <div className="as-key-wrap">
                    <input
                      className="as-input as-input-mono"
                      type={showKeys['quick-zhipu'] ? 'text' : 'password'}
                      value={config.zhipuApiKey}
                      onChange={e => set({ zhipuApiKey: e.target.value })}
                      placeholder={serverStatus?.zhipuReady ? '服务端已配置，可直接开始' : '填一次即可，不用再配置三个服务'}
                    />
                    <button className="as-eye-btn" onClick={() => toggleKey('quick-zhipu')} aria-label="显示或隐藏 API Key">
                      {showKeys['quick-zhipu'] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <p className="as-hint">
                    没有 Key？前往 <a href="https://bigmodel.cn/usercenter/proj-mgmt/apikeys" target="_blank" rel="noreferrer">智谱开放平台</a> 获取。
                    {serverStatus?.zhipuReady ? ' 当前服务端已有可用配置。' : ''}
                  </p>
                </div>

                <div className="as-quick-actions">
                  <button
                    className="as-btn-test"
                    onClick={handleTest}
                    disabled={testing || !config.zhipuApiKey || !recommendedApplied}
                  >
                    {testing ? '测试中...' : '测试连接'}
                  </button>
                  <button
                    className="as-quick-start"
                    onClick={handleSaveAndStart}
                    disabled={!recommendedReady}
                  >
                    保存并开始写作
                    <ArrowRight size={15} />
                  </button>
                </div>
                {testResult && (
                  <span className={`as-test-msg${testResult.ok ? ' as-test-msg--ok' : ' as-test-msg--err'}`}>
                    {testResult.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                    {testResult.msg}
                  </span>
                )}
              </div>

              <div className="as-card as-quick-card">
                <div className="as-quick-heading">
                  <div>
                    <h3>DeepSeek 写作与素材</h3>
                    <p>文章用 deepseek-flash，素材搜索、链接读取、文件解析和语音复用服务端配置。</p>
                    {!deepseekReady && <p>请管理员先在服务端启用 DeepSeek 并配置 API Key。</p>}
                  </div>
                  <button
                    className="as-quick-apply"
                    disabled={!deepseekReady}
                    onClick={() => {
                      const preset = PROVIDER_PRESETS.find(provider => provider.id === 'deepseek')
                      if (!preset) return
                      setLocalConfig({
                        ...config, articleProvider: 'deepseek', articleBaseUrl: preset.defaultBaseUrl,
                        articleModel: preset.models[0], searchProvider: 'deepseek',
                      })
                      navigate('/')
                    }}
                  >
                    <Sparkles size={15} />保存并使用 DeepSeek
                  </button>
                </div>
              </div>

              <button className="as-detail-link" onClick={() => setActiveSection('article')}>
                我想分别选择文章、封面和搜索服务
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          {/* ════ 服务商公共 Key ════ */}
          {activeSection === 'providers' && (
            <div className="as-panel">
              <div className="as-panel-header">
                <h2 className="as-panel-title">服务商公共 Key</h2>
                <p className="as-panel-desc">同一服务商的多个工具默认复用一个 Key；工具自己的 Key 非空时优先使用工具 Key</p>
              </div>
              <div className="as-card">
                <div className="as-card-label-row">
                  <span className="as-card-section-label">智谱 AI</span>
                  <span className="as-card-tag as-card-tag--teal">文章 · GLM-Image · 搜索 · 向量</span>
                </div>
                <p className="as-card-desc">
                  智谱文章模型、GLM-Image、网页搜索和向量检索复用这个 Key。保存后同步到服务端供定时任务使用。
                </p>
                <div className="as-field">
                  <label className="as-label">智谱公共 API Key</label>
                  <div className="as-key-wrap">
                    <input
                      className="as-input as-input-mono"
                      type={showKeys['zhipu-common'] ? 'text' : 'password'}
                      value={config.zhipuApiKey}
                      onChange={e => set({ zhipuApiKey: e.target.value })}
                      placeholder="填写一次，供智谱系列工具复用"
                    />
                    <button className="as-eye-btn" onClick={() => toggleKey('zhipu-common')}>
                      {showKeys['zhipu-common'] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <p className="as-hint">
                    前往 <a href="https://bigmodel.cn/usercenter/proj-mgmt/apikeys" target="_blank" rel="noreferrer">智谱开放平台</a> 获取。旧的工具级 Key 保留并优先，不会被公共 Key 覆盖。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ════ 智谱高级服务 ════ */}
          {activeSection === 'advanced' && (
            <div className="as-panel">
              <div className="as-panel-header">
                <h2 className="as-panel-title">智谱高级服务</h2>
                <p className="as-panel-desc">文章工作台直接接入知识检索和文件解析；平台长任务从智谱控制台管理</p>
              </div>
              <div className="as-card">
                <div className="as-card-label-row">
                  <span className="as-card-section-label">已接入文章流程</span>
                  <span className="as-card-tag as-card-tag--teal">复用智谱公共 Key</span>
                </div>
                <div className="as-provider-grid">
                  <button className="as-provider-tile" onClick={() => navigate('/rag')}>
                    <span className="as-pt-name">GLM 全模态知识库</span>
                    <span className="as-pt-desc">配置云知识库 ID，参与文章生成自动召回</span>
                  </button>
                  <button className="as-provider-tile" onClick={() => navigate('/drafts')}>
                    <span className="as-pt-name">文件解析与 OCR</span>
                    <span className="as-pt-desc">在文章素材采集器上传 PDF、Office、图片或手写稿</span>
                  </button>
                </div>
              </div>
              <div className="as-card">
                <div className="as-card-section-label">智谱平台管理能力</div>
                <p className="as-card-desc">
                  这些能力会创建计费资源或异步任务，因此仍在智谱控制台完成。部署或微调得到的模型编码，可以直接填入“文章生成 → 模型”。
                </p>
                <div className="as-provider-grid">
                  {[
                    ['模型部署', '创建私有实例，完成后复制模型编码', 'https://open.bigmodel.cn/console/modelcenter/deploy'],
                    ['模型微调', '上传训练集并创建 SFT / DPO 任务', 'https://bigmodel.cn/console/modelft/finetuning'],
                    ['模型评测', '对基础模型、微调模型进行数据集评测', 'https://docs.bigmodel.cn/cn/guide/tools/evaluation'],
                    ['Batch 批量处理', '适合非实时大批量任务，通常异步完成', 'https://www.bigmodel.cn/console/batch/task'],
                  ].map(([name, desc, url]) => (
                    <a className="as-provider-tile" href={url} target="_blank" rel="noreferrer" key={name}>
                      <span className="as-pt-name">{name} <ExternalLink size={12} /></span>
                      <span className="as-pt-desc">{desc}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}

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
                <p className="as-card-desc">一键选择服务与模型，应用后只需填写该方案对应的 Key</p>
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

                {deepseekSelected ? (
                  <p className="as-hint">deepseek-flash · {deepseekReady ? '服务端已启用。使用模型或测试连接会产生 Token 费用。' : '请管理员在服务端启用 DeepSeek 并配置 API Key。'}</p>
                ) : config.articleProvider === 'maas' ? (
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
                          placeholder={config.articleProvider === 'zhipu' ? '选填；留空复用智谱公共 Key' : 'sk-...'}
                        />
                        <button className="as-eye-btn" onClick={() => toggleKey('article')}>
                          {showKeys['article'] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                <div className="as-test-row">
                  <button className="as-btn-test" onClick={handleTest} disabled={testing || (deepseekSelected && !deepseekReady)}>
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
                <p className="as-panel-desc">先选一个默认服务，下面只填写这个服务需要的配置</p>
              </div>

              <div className="as-card">
                <div className="as-card-section-label">默认封面服务</div>
                <div className="as-provider-grid">
                  {COVER_PROVIDER_PRESETS.map(p => (
                    <button
                      key={p.id}
                      className={`as-provider-tile${config.coverProvider === p.id ? ' as-provider-tile--active' : ''}`}
                      onClick={() => set({ coverProvider: p.id })}
                    >
                      <span className="as-pt-name">{p.name}</span>
                      <span className="as-pt-desc">{p.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {config.coverProvider === 'local' && (
                <div className="as-card as-card--hint">
                  <div className="as-card-label-row">
                    <span className="as-card-section-label">SVG 占位封面</span>
                    <span className="as-card-tag as-card-tag--teal">无需配置</span>
                  </div>
                  <p className="as-card-desc">可以直接开始写作，需要正式图片时再切换其他服务。</p>
                </div>
              )}

              {config.coverProvider === 'zhipu' && (
              <div className="as-card">
                <div className="as-card-label-row">
                  <span className="as-card-section-label">智谱 GLM-Image</span>
                  <span className="as-card-tag as-card-tag--teal">复用智谱公共 Key</span>
                </div>
                <p className="as-card-desc">支持社交媒体封面、海报和多格图画，生成结果会保存到封面历史和图片库。</p>
                <div className="as-field">
                  <label className="as-label">图片工具专用 Key <span className="as-label-opt">选填</span></label>
                  <div className="as-key-wrap">
                    <input
                      className="as-input as-input-mono"
                      type={showKeys['zhipu-image'] ? 'text' : 'password'}
                      value={config.zhipuImageApiKey}
                      onChange={e => set({ zhipuImageApiKey: e.target.value })}
                      placeholder="留空复用智谱公共 Key"
                    />
                    <button className="as-eye-btn" onClick={() => toggleKey('zhipu-image')}>
                      {showKeys['zhipu-image'] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>
              )}

              {config.coverProvider === 'doubao' && (
              <div className="as-card">
                <div className="as-card-label-row">
                  <span className="as-card-section-label">火山方舟</span>
                  <span className="as-card-tag as-card-tag--teal">豆包 Seedream</span>
                </div>
                <p className="as-card-desc">使用方舟图片生成 API。模型可填写模型 ID 或你在方舟控制台创建的推理接入点 ID。</p>
                <div className="as-row-2">
                  <div className="as-field as-field--grow">
                    <label className="as-label">Base URL</label>
                    <input
                      className="as-input"
                      value={config.doubaoBaseUrl}
                      onChange={e => set({ doubaoBaseUrl: e.target.value })}
                      placeholder="https://ark.cn-beijing.volces.com/api/v3"
                    />
                  </div>
                  <div className="as-field">
                    <label className="as-label">模型 / Endpoint ID</label>
                    <input
                      className="as-input"
                      value={config.doubaoModel}
                      onChange={e => set({ doubaoModel: e.target.value })}
                      placeholder="ep-... 或 Seedream 模型 ID"
                    />
                  </div>
                </div>
                <div className="as-field">
                  <label className="as-label">方舟 API Key</label>
                  <div className="as-key-wrap">
                    <input
                      className="as-input as-input-mono"
                      type={showKeys['doubao'] ? 'text' : 'password'}
                      value={config.doubaoApiKey}
                      onChange={e => set({ doubaoApiKey: e.target.value })}
                      placeholder="填写方舟 API Key"
                    />
                    <button className="as-eye-btn" onClick={() => toggleKey('doubao')}>
                      {showKeys['doubao'] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <p className="as-hint">
                    前往 <a href="https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" target="_blank" rel="noreferrer">火山方舟控制台</a> 获取 API Key，并先开通对应图片模型。
                  </p>
                </div>
              </div>
              )}

              {/* SiliconFlow — Kolors / Z-Image / Qwen 图编 */}
              {['siliconflow', 'z-image', 'qwen-edit'].includes(config.coverProvider) && (
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
              )}

              {/* DALL-E / Stability */}
              {['openai', 'stability'].includes(config.coverProvider) && (
              <div className="as-card">
                <div className="as-card-label-row">
                  <span className="as-card-section-label">{config.coverProvider === 'openai' ? 'OpenAI' : 'Stability AI'}</span>
                  <span className="as-card-tag as-card-tag--ochre">{config.coverProvider === 'openai' ? 'DALL-E 3' : 'Stable Diffusion'}</span>
                </div>
                <div className="as-field">
                  <label className="as-label">{config.coverProvider === 'openai' ? 'OpenAI API Key' : 'Stability API Key'}</label>
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
                  <p className="as-hint">
                    {config.coverProvider === 'openai' ? '文章也使用 OpenAI 时，可以填写同一个 Key。' : '填写 Stability AI 控制台生成的 Key。'}
                  </p>
                </div>
              </div>
              )}

              {config.coverProvider === 'openrouter' && (
              <div className="as-card">
                <div className="as-card-label-row">
                  <span className="as-card-section-label">OpenRouter · GPT Image 2</span>
                  <span className="as-card-tag as-card-tag--lavender">浏览器直连</span>
                </div>
                <div className="as-field">
                  <label className="as-label">API Key</label>
                  <div className="as-key-wrap">
                    <input
                      className="as-input as-input-mono"
                      type={showKeys['openrouter'] ? 'text' : 'password'}
                      value={config.openrouterApiKey}
                      onChange={e => set({ openrouterApiKey: e.target.value })}
                      placeholder="sk-or-..."
                    />
                    <button className="as-eye-btn" onClick={() => toggleKey('openrouter')}>
                      {showKeys['openrouter'] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <p className="as-hint">仅保存在当前浏览器，生成封面时由浏览器直接请求 OpenRouter，不经过部署服务器。</p>
                </div>
              </div>
              )}
            </div>
          )}

          {/* ════ 素材搜索 ════ */}
          {activeSection === 'search' && (
            <div className="as-panel">
              <div className="as-panel-header">
                <h2 className="as-panel-title">联网与来源核查</h2>
                <p className="as-panel-desc">文章 Agent 和素材采集共用搜索服务。生成时会尝试搜索选题，再打开来源核查日期和正文。</p>
              </div>

              <div className="as-card">
                <div className="as-card-section-label">搜索服务商</div>
                <p className="as-card-desc">智谱搜索适合中文素材，可复用文章模型的智谱 Key；SearXNG 无需 API Key；Serper / Bing 需单独注册</p>
                <div className="as-provider-grid">
                  {[
                    { id: 'deepseek', name: 'DeepSeek 搜索', desc: '搜索网页、读取原文', url: 'https://api-docs.deepseek.com/zh-cn/guides/search/', tip: '使用服务端 Key' },
                    { id: 'zhipu', name: '智谱搜索（推荐）', desc: '中文检索，支持摘要、来源和发布日期', url: 'https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys', tip: '可复用智谱文章模型 Key' },
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
                        <a href={p.url} target="_blank" rel="noreferrer">{p.id === 'deepseek' ? '官方文档 ↗' : '获取 Key ↗'}</a> {p.tip}
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

                {config.searchProvider === 'deepseek' && (
                  <p className="as-hint">{deepseekReady ? '服务端已启用。搜索和读取网页按调用计费。' : '请管理员在服务端启用 DeepSeek 并配置 API Key。'}</p>
                )}
                {/* 智谱 / Serper / Bing API Key */}
                {config.searchProvider !== 'searxng' && config.searchProvider !== 'deepseek' && (
                  <>
                    <div className="as-card-divider" />
                    <div className="as-field">
                      <label className="as-label">{config.searchProvider === 'zhipu' ? '智谱' : config.searchProvider === 'serper' ? 'Serper' : 'Bing'} API Key</label>
                      <div className="as-key-wrap">
                        <input
                          className="as-input as-input-mono"
                          type={showKeys['search'] ? 'text' : 'password'}
                          value={config.searchApiKey}
                          onChange={e => set({ searchApiKey: e.target.value })}
                          placeholder={config.searchProvider === 'zhipu' ? '选填；留空复用智谱公共 Key' : config.searchProvider === 'serper' ? 'serper.dev 注册后获取' : 'Azure Portal 获取'}
                        />
                        <button className="as-eye-btn" onClick={() => toggleKey('search')}>
                          {showKeys['search'] ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                      <p className="as-hint">
                        {config.searchProvider === 'zhipu'
                          ? <><a href="https://bigmodel.cn/usercenter/proj-mgmt/apikeys" target="_blank" rel="noreferrer">智谱开放平台</a> 获取 Key；留空时复用“公共 Key”中的智谱 Key</>
                          : config.searchProvider === 'serper'
                          ? <><a href="https://serper.dev" target="_blank" rel="noreferrer">serper.dev</a> 免费注册，赠 2500 次额度，支持 Google / 百度 / Bing</>
                          : <><a href="https://portal.azure.com" target="_blank" rel="noreferrer">Azure Portal</a> 创建「Bing Search v7」资源，每月 1000 次免费</>
                        }
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className="as-card">
                <div className="as-card-label-row">
                  <span className="as-card-section-label">公众号文章采集</span>
                  <span className="as-card-tag as-card-tag--teal">付费服务</span>
                </div>
                <p className="as-card-desc">
                  在“素材采集”中按关键词搜索公众号文章，并通过同一服务读取正文。密钥仅从服务端环境变量读取。
                </p>
                <div className="as-provider-grid">
                  <a
                    className={`as-provider-tile${serverStatus?.wechatCollectorReady?.tikhub ? ' as-provider-tile--active' : ''}`}
                    href="https://user.tikhub.io/dashboard/api"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="as-pt-name">TikHub</span>
                    <span className="as-pt-desc">
                      {serverStatus?.wechatCollectorReady?.tikhub ? 'TIKHUB_API_KEY 已配置' : '设置 TIKHUB_API_KEY'}
                    </span>
                  </a>
                  <a
                    className={`as-provider-tile${serverStatus?.wechatCollectorReady?.dajiala ? ' as-provider-tile--active' : ''}`}
                    href="https://www.dajiala.com/main/interface?actnav=0"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="as-pt-name">极致了数据</span>
                    <span className="as-pt-desc">
                      {serverStatus?.wechatCollectorReady?.dajiala ? 'DAJIALA_API_KEY 已配置' : '设置 DAJIALA_API_KEY'}
                    </span>
                  </a>
                </div>
                <p className="as-hint">
                  修改环境变量后需要重启后端。平台不会把密钥返回给浏览器或写入日志。
                </p>
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

        </main>
      </div>
    </div>
  )
}
