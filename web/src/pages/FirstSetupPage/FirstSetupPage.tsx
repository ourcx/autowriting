import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  ShieldCheck,
} from "lucide-react"
import PageHeader from "../../components/PageHeader/PageHeader"
import { toast } from "../../components/Toast/Toast"
import { useAuth } from "../../store/useAuth"
import { setLocalConfig } from "../../store/useConfigStore"
import {
  type AIConfig,
  loadAIConfig,
  PROVIDER_PRESETS,
} from "../../utils/aiConfig"
import {
  extractErrorMessage,
  saveArticle,
  testAIConnection,
} from "../../utils/apiHelpers"
import {
  hasToutiaoCookies,
  hasWechatAnalyticsCookies,
  hasXiaohongshuCookies,
  loadWechatCredentials,
} from "../../utils/accountBindings"
import {
  completeFirstSetup,
  getSetupSessionKey,
} from "../../utils/userExperience"
import "./FirstSetupPage.css"

type SetupStep = "ai" | "accounts"

export default function FirstSetupPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const sessionKey = user ? getSetupSessionKey(user.id) : ""
  const [step, setStep] = useState<SetupStep>(() => (
    sessionKey && sessionStorage.getItem(sessionKey) === "accounts" ? "accounts" : "ai"
  ))
  const [config, setConfig] = useState<AIConfig>(loadAIConfig)
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!sessionKey) return
    setStep(sessionStorage.getItem(sessionKey) === "accounts" ? "accounts" : "ai")
  }, [sessionKey])

  const accountState = useMemo(() => ({
    wechatPublish: Boolean(loadWechatCredentials()),
    wechatAnalytics: user ? hasWechatAnalyticsCookies(user.id) : false,
    toutiao: hasToutiaoCookies(),
    xiaohongshu: hasXiaohongshuCookies(),
  }), [user])

  const connectedCount = [
    accountState.wechatPublish || accountState.wechatAnalytics,
    accountState.toutiao,
    accountState.xiaohongshu,
  ].filter(Boolean).length

  function updateConfig(patch: Partial<AIConfig>) {
    setConfig(previous => ({ ...previous, ...patch }))
    setTestResult(null)
  }

  function selectProvider(provider: AIConfig["articleProvider"]) {
    const preset = PROVIDER_PRESETS.find(item => item.id === provider)
    updateConfig({
      articleProvider: provider,
      articleBaseUrl: preset?.defaultBaseUrl ?? config.articleBaseUrl,
      articleModel: preset?.models[0] ?? config.articleModel,
    })
  }

  async function verifyAI() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testAIConnection(config)
      setTestResult(result)
      if (!result.ok) return
      setLocalConfig(config)
      if (sessionKey) sessionStorage.setItem(sessionKey, "accounts")
      setStep("accounts")
    } finally {
      setTesting(false)
    }
  }

  async function createFirstArticle() {
    if (!user || creating) return
    setCreating(true)
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const articleId = `${date}-${Date.now()}`
    try {
      await saveArticle(articleId, { title: "我的第一篇文章" })
      completeFirstSetup(user.id)
      if (sessionKey) sessionStorage.removeItem(sessionKey)
      navigate(`/editor/${encodeURIComponent(articleId)}?tab=task`, { replace: true })
    } catch (error) {
      toast.error(extractErrorMessage(error, "首篇文章创建失败，请重试"))
    } finally {
      setCreating(false)
    }
  }

  const selectedPreset = PROVIDER_PRESETS.find(item => item.id === config.articleProvider)
  const isMaas = config.articleProvider === "maas"

  return (
    <main className="fsp-root">
      <PageHeader
        title="首次设置"
        subtitle="先让文章生成可用，发布账号可以稍后补"
      />

      <div className="fsp-shell">
        <aside className="fsp-progress" aria-label="设置进度">
          <div className="fsp-brand">
            <span className="fsp-brand-mark">D</span>
            <div>
              <strong>开始创作前</strong>
              <span>大约 2 分钟</span>
            </div>
          </div>
          <ol>
            <li className={step === "ai" ? "active" : "complete"}>
              <span>{step === "accounts" ? <Check size={15} /> : "1"}</span>
              <div><strong>连接 AI 服务</strong><small>必需，现场验证</small></div>
            </li>
            <li className={step === "accounts" ? "active" : ""}>
              <span>2</span>
              <div><strong>连接发布账号</strong><small>可跳过，发布前再补</small></div>
            </li>
          </ol>
          <p><ShieldCheck size={15} /> API Key 与平台 Cookie 不会写进文章内容。</p>
        </aside>

        <section className="fsp-content">
          {step === "ai" ? (
            <div className="fsp-panel">
              <header>
                <span className="fsp-section-icon"><KeyRound size={20} /></span>
                <div>
                  <p>必需设置</p>
                  <h1>连接文章生成服务</h1>
                  <span>填写后会立即发起一次最小请求，确认当前配置真的可用。</span>
                </div>
              </header>

              <div className="fsp-provider-options" role="group" aria-label="AI 服务商">
                {PROVIDER_PRESETS.map(provider => (
                  <button
                    key={provider.id}
                    type="button"
                    aria-pressed={config.articleProvider === provider.id}
                    onClick={() => selectProvider(provider.id)}
                  >
                    <strong>{provider.name}</strong>
                    <span>{provider.desc}</span>
                  </button>
                ))}
              </div>

              <div className="fsp-form-grid">
                <label>
                  <span>API 地址</span>
                  <input
                    value={isMaas ? config.maasBaseUrl : config.articleBaseUrl}
                    onChange={event => updateConfig(isMaas
                      ? { maasBaseUrl: event.target.value }
                      : { articleBaseUrl: event.target.value })}
                    placeholder={selectedPreset?.defaultBaseUrl || "https://api.openai.com/v1"}
                  />
                </label>
                <label>
                  <span>模型</span>
                  <input
                    value={isMaas ? "deepseek-v4-pro" : config.articleModel}
                    disabled={isMaas}
                    onChange={event => updateConfig({ articleModel: event.target.value })}
                    list="fsp-models"
                  />
                  <datalist id="fsp-models">
                    {selectedPreset?.models.map(model => <option key={model} value={model} />)}
                  </datalist>
                </label>
                {isMaas && (
                  <label className="fsp-wide">
                    <span>用户邮箱</span>
                    <input
                      value={config.maasUserEmail}
                      onChange={event => updateConfig({ maasUserEmail: event.target.value })}
                      placeholder="name@example.com"
                    />
                  </label>
                )}
                <label className="fsp-wide">
                  <span>API Key</span>
                  <div className="fsp-secret">
                    <input
                      type={showKey ? "text" : "password"}
                      value={isMaas ? config.maasApiKey : config.articleApiKey}
                      onChange={event => updateConfig(isMaas
                        ? { maasApiKey: event.target.value }
                        : { articleApiKey: event.target.value })}
                      placeholder="填写服务商提供的 API Key"
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={() => setShowKey(value => !value)} title={showKey ? "隐藏 API Key" : "显示 API Key"}>
                      {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </label>
              </div>

              {testResult && (
                <div className={`fsp-result ${testResult.ok ? "fsp-result--ok" : "fsp-result--error"}`} role="status">
                  {testResult.ok ? <CheckCircle2 size={17} /> : <KeyRound size={17} />}
                  {testResult.msg}
                </div>
              )}

              <footer className="fsp-actions">
                <a href={selectedPreset?.url} target="_blank" rel="noreferrer">
                  获取服务商 Key <ExternalLink size={14} />
                </a>
                <button className="fsp-primary" onClick={() => void verifyAI()} disabled={testing}>
                  {testing ? <Loader2 className="fsp-spin" size={17} /> : <CheckCircle2 size={17} />}
                  {testing ? "正在测试连接" : "保存并测试连接"}
                </button>
              </footer>
            </div>
          ) : (
            <div className="fsp-panel">
              <header>
                <span className="fsp-section-icon"><Link2 size={20} /></span>
                <div>
                  <p>可稍后完成</p>
                  <h1>连接你准备使用的平台</h1>
                  <span>不必一次填完。生成文章不受影响，真正发布前再连接也可以。</span>
                </div>
              </header>

              <div className="fsp-account-list">
                <div className="fsp-account-row">
                  <span className="fsp-platform-mark fsp-platform-mark--wechat">微</span>
                  <div>
                    <strong>微信公众号</strong>
                    <span>草稿发布：{accountState.wechatPublish ? "已连接" : "未连接"} · 数据分析：{accountState.wechatAnalytics ? "已连接" : "未连接"}</span>
                  </div>
                  <span className={accountState.wechatPublish || accountState.wechatAnalytics ? "connected" : ""}>
                    {accountState.wechatPublish || accountState.wechatAnalytics ? "已连接" : "可选"}
                  </span>
                </div>
                <div className="fsp-account-row">
                  <span className="fsp-platform-mark fsp-platform-mark--toutiao">头</span>
                  <div><strong>今日头条</strong><span>文章发布与账号数据</span></div>
                  <span className={accountState.toutiao ? "connected" : ""}>{accountState.toutiao ? "已连接" : "可选"}</span>
                </div>
                <div className="fsp-account-row">
                  <span className="fsp-platform-mark fsp-platform-mark--xiaohongshu">红</span>
                  <div><strong>小红书</strong><span>图文笔记发布</span></div>
                  <span className={accountState.xiaohongshu ? "connected" : ""}>{accountState.xiaohongshu ? "已连接" : "可选"}</span>
                </div>
              </div>

              <footer className="fsp-actions">
                <button className="fsp-secondary" onClick={() => navigate("/account?from=setup")}>
                  现在连接账号
                </button>
                <button className="fsp-primary" onClick={() => void createFirstArticle()} disabled={creating}>
                  {creating ? <Loader2 className="fsp-spin" size={17} /> : <ArrowRight size={17} />}
                  {creating ? "正在创建" : connectedCount ? "创建第一篇文章" : "暂不连接，创建第一篇文章"}
                </button>
              </footer>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
