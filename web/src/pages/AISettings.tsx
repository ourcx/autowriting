import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Save, Check, Eye, EyeOff, AlertCircle, CheckCircle2, Server } from 'lucide-react'
import {
  AIConfig,
  loadAIConfig,
  PROVIDER_PRESETS,
  COVER_PROVIDER_PRESETS,
} from '../utils/aiConfig'
import { useConfigStore, setLocalConfig, fetchServerStatus } from '../store/useConfigStore'
import { testAIConnection } from '../utils/apiHelpers'
import './AISettings.css'

export default function AISettings() {
  const navigate = useNavigate()
  const storeState = useConfigStore()
  const serverStatus = storeState.serverStatus

  const [config, setConfig] = useState<AIConfig>(loadAIConfig)
  const [saved, setSaved] = useState(false)
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    setConfig(loadAIConfig())
    // 拉服务端配置状态（用于展示「服务端已配置」提示）
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

  const toggleKey = (k: string) => {
    setShowKeys(s => ({ ...s, [k]: !s[k] }))
  }

  // 选择文章 provider 时自动填入默认 baseUrl 和模型
  const handleArticleProviderChange = (id: AIConfig['articleProvider']) => {
    const preset = PROVIDER_PRESETS.find(p => p.id === id)
    set({
      articleProvider: id,
      articleBaseUrl: preset?.defaultBaseUrl ?? config.articleBaseUrl,
      articleModel: preset?.models[0] ?? config.articleModel,
    })
  }

  // 连通性测试：调用公共方法
  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const result = await testAIConnection(config)
    setTestResult(result)
    setTesting(false)
  }

  const selectedArticlePreset = PROVIDER_PRESETS.find(p => p.id === config.articleProvider)

  return (
    <div className="as-root">
      {/* ── Header ── */}
      <header className="as-header">
        <div className="as-header-left">
          <button className="as-back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={15} />
            返回
          </button>
          <div className="as-header-title">
            <span className="as-header-badge">AI 配置</span>
            <span className="as-header-name">API 密钥与模型设置</span>
          </div>
        </div>
        <div className="as-header-actions">
          <button className={`as-btn as-btn-primary ${saved ? 'success' : ''}`} onClick={handleSave}>
            {saved ? <Check size={14} /> : <Save size={14} />}
            {saved ? '已保存' : '保存配置'}
          </button>
        </div>
      </header>

      <div className="as-body">
        {/* ── 配置状态总览（合并本地浏览器 + 服务端 .env 两个来源） ── */}
        {(() => {
          const localMaas       = config.articleProvider === 'maas' && !!config.maasApiKey
          const localOpenai     = config.articleProvider !== 'maas' && !!config.articleApiKey
          const localDalle      = config.coverProvider === 'openai' && !!config.coverApiKey
          const localStab       = config.coverProvider === 'stability' && !!config.coverApiKey
          const localSiliconflow = !!config.siliconflowApiKey
          const maasOk          = localMaas    || !!serverStatus?.maasReady
          const openaiOk        = localOpenai  || !!serverStatus?.openaiReady
          const dalleOk         = localDalle   || !!serverStatus?.dalleReady
          const stabilityOk     = localStab    || !!serverStatus?.stabilityReady
          const siliconflowOk   = localSiliconflow || !!serverStatus?.siliconflowReady
          const anyOk           = maasOk || openaiOk || dalleOk || stabilityOk || siliconflowOk
          return (
            <div className="as-server-status">
              <div className="as-server-status-title">
                <Server size={14} />
                配置状态
              </div>
              <div className="as-server-status-pills">
                <span className={`as-pill ${maasOk ? 'ok' : 'off'}`}>
                  {maasOk ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                  MaaS {maasOk
                    ? (localMaas ? '已配置（本地）' : `已配置（${serverStatus?.maasEmail || '服务端'}）`)
                    : '未配置'}
                </span>
                <span className={`as-pill ${openaiOk ? 'ok' : 'off'}`}>
                  {openaiOk ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                  OpenAI {openaiOk ? (localOpenai ? '已配置（本地）' : '已配置（服务端）') : '未配置'}
                </span>
                <span className={`as-pill ${dalleOk ? 'ok' : 'off'}`}>
                  {dalleOk ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                  DALL-E {dalleOk ? (localDalle ? '已配置（本地）' : '已配置（服务端）') : '未配置'}
                </span>
                <span className={`as-pill ${stabilityOk ? 'ok' : 'off'}`}>
                  {stabilityOk ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                  Stability {stabilityOk ? (localStab ? '已配置（本地）' : '已配置（服务端）') : '未配置'}
                </span>
                <span className={`as-pill ${siliconflowOk ? 'ok' : 'off'}`}>
                  {siliconflowOk ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                  Kolors {siliconflowOk ? (localSiliconflow ? '已配置（本地）' : '已配置（服务端）') : '未配置'}
                </span>
              </div>
              {anyOk && (
                <p className="as-server-status-note">
                  已配置（本地）表示 Key 保存在浏览器；已配置（服务端）表示从 .env 读取。
                </p>
              )}
            </div>
          )
        })()}

        {/* ── 文章生成 ── */}
        <section className="as-section">
          <div className="as-section-header">
            <h2 className="as-section-title">文章生成</h2>
            <p className="as-section-desc">用于 AI 写作的大语言模型配置</p>
          </div>

          {/* Provider 选择 */}
          <div className="as-field-group">
            <label className="as-label">API 服务商</label>
            <div className="as-provider-cards">
              {PROVIDER_PRESETS.map(p => (
                <button
                  key={p.id}
                  className={`as-provider-card ${config.articleProvider === p.id ? 'active' : ''}`}
                  onClick={() => handleArticleProviderChange(p.id)}
                >
                  <span className="as-provider-name">{p.name}</span>
                  <span className="as-provider-desc">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 根据 provider 显示对应字段 */}
          {config.articleProvider === 'maas' ? (
            <>
              <div className="as-field-row">
                <div className="as-field">
                  <label className="as-label">MaaS Base URL</label>
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
                <label className="as-label">MaaS API Key</label>
                <div className="as-key-wrap">
                  <input
                    className="as-input as-input-key"
                    type={showKeys['maas'] ? 'text' : 'password'}
                    value={config.maasApiKey}
                    onChange={e => set({ maasApiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                  <button className="as-eye-btn" onClick={() => toggleKey('maas')}>
                    {showKeys['maas'] ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="as-field-row">
                <div className="as-field as-field-grow">
                  <label className="as-label">Base URL</label>
                  <input
                    className="as-input"
                    value={config.articleBaseUrl}
                    onChange={e => set({ articleBaseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div className="as-field">
                  <label className="as-label">模型名称</label>
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
                    className="as-input as-input-key"
                    type={showKeys['article'] ? 'text' : 'password'}
                    value={config.articleApiKey}
                    onChange={e => set({ articleApiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                  <button className="as-eye-btn" onClick={() => toggleKey('article')}>
                    {showKeys['article'] ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* 连通性测试 */}
          <div className="as-test-row">
            <button className="as-btn as-btn-secondary" onClick={handleTest} disabled={testing}>
              {testing ? '测试中...' : '测试连接'}
            </button>
            {testResult && (
              <span className={`as-test-result ${testResult.ok ? 'ok' : 'err'}`}>
                {testResult.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                {testResult.msg}
              </span>
            )}
          </div>
        </section>

        {/* ── 分割线 ── */}
        <div className="as-divider" />

        {/* ── 封面生成 ── */}
        <section className="as-section">
          <div className="as-section-header">
            <h2 className="as-section-title">封面生成</h2>
            <p className="as-section-desc">选择默认生图服务并填写对应 API Key，封面生成器可随时切换</p>
          </div>

          {/* 默认 provider 选择 — 保存到 config.coverProvider */}
          <div className="as-field-group">
            <label className="as-label">默认图片生成服务</label>
            <div className="as-provider-cards">
              {COVER_PROVIDER_PRESETS.map(p => (
                <button
                  key={p.id}
                  className={`as-provider-card ${config.coverProvider === p.id ? 'active' : ''}`}
                  onClick={() => set({ coverProvider: p.id })}
                >
                  <span className="as-provider-name">{p.name}</span>
                  <span className="as-provider-desc">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── SiliconFlow（Kolors / Z-Image / Qwen 图编共用） ── */}
          <div className="as-field">
            <label className="as-label">SiliconFlow API Key</label>
            <div className="as-key-wrap">
              <input
                className="as-input as-input-key"
                type={showKeys['siliconflow'] ? 'text' : 'password'}
                value={config.siliconflowApiKey}
                onChange={e => set({ siliconflowApiKey: e.target.value })}
                placeholder="sk-nf..."
              />
              <button className="as-eye-btn" onClick={() => toggleKey('siliconflow')}>
                {showKeys['siliconflow'] ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="as-field-hint">
              Kolors / Z-Image / Qwen 图片编辑共用此 Key。前往{' '}
              <a href="https://cloud.siliconflow.cn/account/ak" target="_blank" rel="noreferrer">
                cloud.siliconflow.cn
              </a>{' '}
              获取，注册即送免费额度。
            </p>
          </div>

          <div className="as-field">
            <label className="as-label">Kolors 模型 <span className="as-label-opt">选填，默认 Kwai-Kolors/Kolors</span></label>
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
            <p className="as-field-hint">仅对「Kolors 可图」provider 生效，Z-Image / Qwen 图编使用固定模型。</p>
          </div>

          <div className="as-divider-sm" />

          {/* ── DALL-E 3 / Stability（共用 coverApiKey） ── */}
          <div className="as-field">
            <label className="as-label">OpenAI / Stability API Key <span className="as-label-opt">DALL-E 3 或 Stability AI</span></label>
            <div className="as-key-wrap">
              <input
                className="as-input as-input-key"
                type={showKeys['cover'] ? 'text' : 'password'}
                value={config.coverApiKey}
                onChange={e => set({ coverApiKey: e.target.value })}
                placeholder="sk-..."
              />
              <button className="as-eye-btn" onClick={() => toggleKey('cover')}>
                {showKeys['cover'] ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="as-field-hint">
              选择 DALL-E 3 时填 OpenAI Key；选 Stability AI 时填 Stability Key。如果文章生成也用 OpenAI，同一个 Key 复制过来即可。
            </p>
          </div>
        </section>

        {/* ── 说明 ── */}
        <div className="as-divider" />
        <section className="as-section as-section-tips">
          <h3 className="as-tips-title">说明</h3>
          <ul className="as-tips-list">
            <li>配置保存在本地浏览器，不会上传到任何服务器</li>
            <li>「自定义（OpenAI 兼容）」支持 Claude / DeepSeek / Gemini / 本地 Ollama 等兼容 OpenAI 接口的服务</li>
            <li>封面生成器里可随时切换模型，此处设置的是默认值</li>
            <li>修改配置后点击「保存配置」才会生效</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
