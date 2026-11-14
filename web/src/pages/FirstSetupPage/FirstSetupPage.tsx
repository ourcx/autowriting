import { Input } from "../../components/FormControls/FormControls"
import Button from "../../components/Button/Button"
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
import { articleEditorUrl } from "../../utils/articleNavigation"
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
      navigate(`${articleEditorUrl(articleId, { title: "我的第一篇文章" })}?tab=task`, { replace: true })
    } catch (error) {
      toast.error(extractErrorMessage(error, "首篇文章创建失败，请重试"))
    } finally {
      setCreating(false)
    }
  }

  const selectedPreset = PROVIDER_PRESETS.find(item => item.id === config.articleProvider)
  const isMaas = config.articleProvider === "maas"
  const isDeepSeek = config.articleProvider === "deepseek"

  return (
    <main className="fsp-root">
      <PageHeader title="首次设置" />

      <div className="fsp-shell">
        <aside className="fsp-progress" aria-label="设置进度">
          <ol>
            <li className={step === "ai" ? "active" : "complete"} aria-current={step === "ai" ? "step" : undefined}>
              <span aria-hidden="true">{step === "accounts" ? <Check size={15} /> : "1"}</span>
              <div><strong>连接 AI 服务</strong><small>{step === "accounts" ? "已连接" : "必需"}</small></div>
            </li>
            <li className={step === "accounts" ? "active" : ""} aria-current={step === "accounts" ? "step" : undefined}>
              <span aria-hidden="true">2</span>
              <div><strong>连接发布账号</strong><small>可跳过</small></div>
            </li>
          </ol>
          <p><ShieldCheck size={15} aria-hidden="true" /> API Key 与平台 Cookie 不会写进文章内容。</p>
        </aside>

        <section className="fsp-content">
          {step === "ai" ? (
            <div className="fsp-panel">
              <header>
                <h1>连接文章生成服务</h1>
                <p>选择服务商并填写 API Key。保存时会发送一次测试请求。</p>
              </header>

              <div className="fsp-provider-field">
                <p id="fsp-provider-label">AI 服务商</p>
                <div className="fsp-provider-options" role="group" aria-labelledby="fsp-provider-label">
                  {PROVIDER_PRESETS.map(provider => (
                    <Button variant="plain"
                      key={provider.id}
                      type="button"
                      aria-pressed={config.articleProvider === provider.id}
                      onClick={() => selectProvider(provider.id)}
                    >
                      <strong>{provider.name}</strong>
                      {config.articleProvider === provider.id && <Check size={15} aria-hidden="true" />}
                      <span>{provider.desc}</span>
                    </Button>
                  ))}
                </div>
              </div>

              {isDeepSeek ? (
                <div className="fsp-field">
                  <label htmlFor="fsp-deepseek-key">DeepSeek 公共 API Key</label>
                  <div className="fsp-secret">
                    <Input id="fsp-deepseek-key" type={showKey ? "text" : "password"} autoComplete="off" value={config.deepseekApiKey}
                      onChange={event => updateConfig({ deepseekApiKey: event.target.value })} placeholder="仅保存在当前浏览器" />
                    <Button variant="plain" aria-label={showKey ? "隐藏 DeepSeek Key" : "显示 DeepSeek Key"}
                      onClick={() => setShowKey(value => !value)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</Button>
                  </div>
                </div>
              ) : <div className="fsp-form-grid">
                <label>
                  <span>API 地址</span>
                  <Input
                    value={isMaas ? config.maasBaseUrl : config.articleBaseUrl}
                    onChange={event => updateConfig(isMaas
                      ? { maasBaseUrl: event.target.value }
                      : { articleBaseUrl: event.target.value })}
                    placeholder={selectedPreset?.defaultBaseUrl || "https://api.openai.com/v1"}
                  />
                </label>
                <label>
                  <span>模型</span>
                  <Input
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
                    <Input
                      value={config.maasUserEmail}
                      onChange={event => updateConfig({ maasUserEmail: event.target.value })}
                      placeholder="name@example.com"
                    />
                  </label>
                )}
                <div className="fsp-wide fsp-field">
                  <label htmlFor="fsp-api-key">API Key</label>
                  <div className="fsp-secret">
                    <Input
                      id="fsp-api-key"
                      type={showKey ? "text" : "password"}
                      value={isMaas ? config.maasApiKey : config.articleApiKey}
                      onChange={event => updateConfig(isMaas
                        ? { maasApiKey: event.target.value }
                        : { articleApiKey: event.target.value })}
                      placeholder="填写服务商提供的 API Key"
                      autoComplete="new-password"
                    />
                    <Button variant="plain" type="button" onClick={() => setShowKey(value => !value)} aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}>
                      {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                    </Button>
                  </div>
                </div>
              </div>}

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
                <Button variant="primary" onClick={() => void verifyAI()} disabled={testing}>
                  {testing && <Loader2 className="fsp-spin" size={17} aria-hidden="true" />}
                  {testing ? "正在测试连接" : "保存并测试连接"}
                </Button>
              </footer>
            </div>
          ) : (
            <div className="fsp-panel">
              <header>
                <h1>连接发布账号</h1>
                <p>你可以先写文章，发布前再连接要用的平台。</p>
              </header>

              <div className="fsp-account-list">
                <div className="fsp-account-row">
                  <div>
                    <strong>微信公众号</strong>
                    <span>草稿写入：{accountState.wechatPublish ? "已连接" : "未连接"} · 后台自动化：{accountState.wechatAnalytics ? "已连接" : "未连接"}</span>
                  </div>
                  <span className={accountState.wechatPublish || accountState.wechatAnalytics ? "connected" : ""}>
                    {accountState.wechatPublish || accountState.wechatAnalytics ? "已连接" : "未连接"}
                  </span>
                </div>
                <div className="fsp-account-row">
                  <div><strong>今日头条</strong><span>文章发布与账号数据</span></div>
                  <span className={accountState.toutiao ? "connected" : ""}>{accountState.toutiao ? "已连接" : "未连接"}</span>
                </div>
                <div className="fsp-account-row">
                  <div><strong>小红书</strong><span>图文笔记发布</span></div>
                  <span className={accountState.xiaohongshu ? "connected" : ""}>{accountState.xiaohongshu ? "已连接" : "未连接"}</span>
                </div>
              </div>

              <footer className="fsp-actions">
                <Button onClick={() => navigate("/account?from=setup")}>
                  现在连接账号
                </Button>
                <Button variant="primary" onClick={() => void createFirstArticle()} disabled={creating}>
                  {creating ? <Loader2 className="fsp-spin" size={17} /> : <ArrowRight size={17} />}
                  {creating ? "正在创建" : connectedCount ? "创建第一篇文章" : "暂不连接，创建第一篇文章"}
                </Button>
              </footer>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
