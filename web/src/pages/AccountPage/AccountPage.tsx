import { FormEvent, useCallback, useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  BarChart3, BookOpen, Brain, CheckCircle2, Database, Eye, EyeOff, ExternalLink,
  FileText, GitBranch, Link2, Link2Off, Newspaper, RefreshCw, ShieldCheck, Sparkles, Zap,
} from "lucide-react"
import PageHeader from "../../components/PageHeader/PageHeader"
import {
  collectWechatAnalytics, extractErrorMessage, fetchCreatorWritingProfile, fetchGlobalMemory,
  fetchToutiaoAccount, fetchWechatAccount, fetchWritingAssetOverview, saveCreatorWritingProfile,
  saveGlobalMemory, type ToutiaoAccount, type WechatAccount, type WritingAssetOverview,
} from "../../utils/apiHelpers"
import { toast } from "../../components/Toast/Toast"
import {
  EMPTY_CREATOR_WRITING_PROFILE,
  WRITING_DNA_LAYER_LABELS,
  type CreatorFeedbackLayer,
  type CreatorWritingProfile,
  type PublishingPlatform,
} from "../../../shared/contentProduction"
import {
  clearToutiaoCookies, clearWechatCredentials, getWechatHeaders,
  hasToutiaoCookies, loadToutiaoCookies, loadWechatCredentials,
  clearXiaohongshuCookies, hasXiaohongshuCookies,
  saveToutiaoCookies, saveWechatCredentials, saveXiaohongshuCookies,
  clearWechatAnalyticsCookies, hasWechatAnalyticsCookies,
  saveWechatAnalyticsCookies,
} from "../../utils/accountBindings"
import { useAuth } from "../../store/useAuth"
import "./AccountPage.css"

type Platform = "wechat" | "toutiao" | "xiaohongshu"
type WritingProfileTextField =
  | "preferredStructure"
  | "anglePreference"
  | "materialPreference"
  | "stance"
  | "visualStyle"

function formatNumber(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("zh-CN")
}

function feedbackLayerLabel(layer: CreatorFeedbackLayer): string {
  return layer === "general" ? "综合取舍" : WRITING_DNA_LAYER_LABELS[layer]
}

function AccountAvatar({ name, imageUrl, platform }: { name: string; imageUrl: string | null; platform: Platform }) {
  if (imageUrl) return <img className="ap-avatar" src={imageUrl} alt={`${name}头像`} />
  return <div className={`ap-avatar ap-avatar--${platform}`}>{name.slice(0, 1) || "?"}</div>
}

export default function AccountPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const [wechatAccount, setWechatAccount] = useState<WechatAccount | null>(null)
  const [toutiaoAccount, setToutiaoAccount] = useState<ToutiaoAccount | null>(null)
  const [wechatLoading, setWechatLoading] = useState(false)
  const [toutiaoLoading, setToutiaoLoading] = useState(false)
  const [wechatError, setWechatError] = useState("")
  const [toutiaoError, setToutiaoError] = useState("")
  const [wechatBound, setWechatBound] = useState(() => !!loadWechatCredentials())
  const [toutiaoBound, setToutiaoBound] = useState(hasToutiaoCookies)
  const [xiaohongshuBound, setXiaohongshuBound] = useState(hasXiaohongshuCookies)
  const [wechatAnalyticsBound, setWechatAnalyticsBound] = useState(false)
  const [appId, setAppId] = useState("")
  const [appSecret, setAppSecret] = useState("")
  const [showSecret, setShowSecret] = useState(false)
  const [cookies, setCookies] = useState("")
  const [bindingWechat, setBindingWechat] = useState(false)
  const [bindingToutiao, setBindingToutiao] = useState(false)
  const [xiaohongshuCookies, setXiaohongshuCookies] = useState("")
  const [xiaohongshuError, setXiaohongshuError] = useState("")
  const [wechatAnalyticsCookies, setWechatAnalyticsCookies] = useState("")
  const [wechatAnalyticsError, setWechatAnalyticsError] = useState("")
  const [bindingWechatAnalytics, setBindingWechatAnalytics] = useState(false)
  const [writingProfile, setWritingProfile] = useState<CreatorWritingProfile>(EMPTY_CREATOR_WRITING_PROFILE)
  const [globalMemory, setGlobalMemory] = useState("")
  const [assetOverview, setAssetOverview] = useState<WritingAssetOverview | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileSaving, setProfileSaving] = useState(false)

  const refreshWechat = useCallback(async () => {
    if (!loadWechatCredentials()) return
    setWechatLoading(true)
    setWechatError("")
    try {
      setWechatAccount(await fetchWechatAccount(getWechatHeaders()))
    } catch (error) {
      setWechatAccount(null)
      setWechatError(extractErrorMessage(error, "公众号数据加载失败"))
    } finally {
      setWechatLoading(false)
    }
  }, [])

  const refreshToutiao = useCallback(async (forceRefresh = false) => {
    const savedCookies = loadToutiaoCookies()
    if (!savedCookies) return
    setToutiaoLoading(true)
    setToutiaoError("")
    try {
      setToutiaoAccount(await fetchToutiaoAccount(savedCookies, forceRefresh))
    } catch (error) {
      setToutiaoAccount(null)
      setToutiaoError(extractErrorMessage(error, "今日头条数据加载失败"))
    } finally {
      setToutiaoLoading(false)
    }
  }, [])

  useEffect(() => {
    if (wechatBound) void refreshWechat()
    if (toutiaoBound) void refreshToutiao()
  }, [refreshToutiao, refreshWechat, toutiaoBound, wechatBound])

  useEffect(() => {
    Promise.all([
      fetchCreatorWritingProfile(),
      fetchGlobalMemory(),
    ])
      .then(([profile, memory]) => {
        setWritingProfile(profile)
        setGlobalMemory(memory)
      })
      .catch(error => toast.error(extractErrorMessage(error, "写作资产加载失败")))
      .finally(() => setProfileLoading(false))
    fetchWritingAssetOverview()
      .then(setAssetOverview)
      .catch(() => toast.warn("资产统计暂时无法读取，文风与长期背景仍可正常编辑"))
  }, [])

  useEffect(() => {
    setWechatAnalyticsBound(user ? hasWechatAnalyticsCookies(user.id) : false)
  }, [user])

  function updateProfile<K extends keyof CreatorWritingProfile>(field: K, value: CreatorWritingProfile[K]) {
    setWritingProfile(previous => ({ ...previous, [field]: value }))
  }

  function selectDefaultPlatform(platform: PublishingPlatform) {
    setWritingProfile(previous => ({ ...previous, defaultPlatforms: [platform] }))
  }

  async function saveWritingAssets() {
    setProfileSaving(true)
    try {
      const [profile] = await Promise.all([
        saveCreatorWritingProfile(writingProfile),
        saveGlobalMemory(globalMemory),
      ])
      setWritingProfile(profile)
      try {
        setAssetOverview(await fetchWritingAssetOverview())
      } catch {
        toast.warn("写作资产已保存，统计稍后刷新")
      }
      toast.success("写作 DNA 与长期背景已保存")
    } catch (error) {
      toast.error(extractErrorMessage(error, "写作资产保存失败"))
    } finally {
      setProfileSaving(false)
    }
  }

  async function bindWechat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!appId.trim() || !appSecret.trim()) {
      setWechatError("请填写 AppID 和 AppSecret")
      return
    }
    setBindingWechat(true)
    setWechatError("")
    const credentials = { appId: appId.trim(), appSecret: appSecret.trim() }
    try {
      const account = await fetchWechatAccount({
        "X-Wx-AppId": credentials.appId,
        "X-Wx-AppSecret": credentials.appSecret,
      })
      saveWechatCredentials(credentials)
      setWechatAccount(account)
      setWechatBound(true)
      setAppId("")
      setAppSecret("")
    } catch (error) {
      setWechatError(extractErrorMessage(error, "公众号绑定失败"))
    } finally {
      setBindingWechat(false)
    }
  }

  async function bindToutiao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = cookies.trim()
    try {
      const parsed: unknown = JSON.parse(value)
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Cookie 必须是非空 JSON 数组")
    } catch (error) {
      setToutiaoError(error instanceof Error ? error.message : "Cookie 格式不正确")
      return
    }
    setBindingToutiao(true)
    setToutiaoError("")
    try {
      const account = await fetchToutiaoAccount(value, true)
      saveToutiaoCookies(value)
      setToutiaoAccount(account)
      setToutiaoBound(true)
      setCookies("")
    } catch (error) {
      setToutiaoError(extractErrorMessage(error, "今日头条绑定失败，请检查 Cookie 是否有效"))
    } finally {
      setBindingToutiao(false)
    }
  }

  function unbindWechat() {
    if (!confirm("确认解绑公众号？")) return
    clearWechatCredentials()
    setWechatAccount(null)
    setWechatBound(false)
  }

  function unbindToutiao() {
    if (!confirm("确认解绑今日头条？")) return
    clearToutiaoCookies()
    setToutiaoAccount(null)
    setToutiaoBound(false)
  }

  function bindXiaohongshu(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = xiaohongshuCookies.trim()
    try {
      const parsed: unknown = JSON.parse(value)
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Cookie 必须是非空 JSON 数组")
      saveXiaohongshuCookies(value)
      setXiaohongshuBound(true)
      setXiaohongshuCookies("")
      setXiaohongshuError("")
    } catch (error) {
      setXiaohongshuError(error instanceof Error ? error.message : "Cookie 格式不正确")
    }
  }

  function unbindXiaohongshu() {
    if (!confirm("确认解绑小红书？")) return
    clearXiaohongshuCookies()
    setXiaohongshuBound(false)
    setXiaohongshuError("")
  }

  async function bindWechatAnalytics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user) return
    const value = wechatAnalyticsCookies.trim()
    try {
      const parsed: unknown = JSON.parse(value)
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Cookie 必须是非空 JSON 数组")
    } catch (error) {
      setWechatAnalyticsError(error instanceof Error ? error.message : "Cookie 格式不正确")
      return
    }
    setBindingWechatAnalytics(true)
    setWechatAnalyticsError("")
    try {
      await collectWechatAnalytics(value)
      saveWechatAnalyticsCookies(user.id, value)
      setWechatAnalyticsBound(true)
      setWechatAnalyticsCookies("")
      toast.success("微信数据 Cookie 已绑定，并完成首次同步")
    } catch (error) {
      setWechatAnalyticsError(extractErrorMessage(error, "微信数据绑定失败，请重新导出 Cookie"))
    } finally {
      setBindingWechatAnalytics(false)
    }
  }

  function unbindWechatAnalytics() {
    if (!user || !confirm("确认解绑微信数据 Cookie？历史快照会保留。")) return
    clearWechatAnalyticsCookies(user.id)
    setWechatAnalyticsBound(false)
    setWechatAnalyticsError("")
  }

  const activeTab = ["profile", "writing"].includes(searchParams.get("tab") || "") ? "writing" : "connections"
  const connectedPlatformCount = Number(wechatBound || wechatAnalyticsBound)
    + Number(toutiaoBound)
    + Number(xiaohongshuBound)
  const fromSetup = searchParams.get("from") === "setup"
  const changeTab = (tab: "connections" | "writing") => {
    const next = new URLSearchParams(searchParams)
    if (tab === "writing") next.set("tab", "writing")
    else next.delete("tab")
    setSearchParams(next, { replace: true })
  }

  return (
    <main className="ap-root">
      <PageHeader
        title="账号与资产"
        subtitle="管理平台连接、发布能力和可复用写作资产"
        backLabel={fromSetup ? "返回首次设置" : "返回工作台"}
        onBack={() => navigate(fromSetup ? "/setup" : "/")}
        actions={<div className="ap-header-note"><ShieldCheck size={14} /> 凭据仅保存在当前浏览器</div>}
      />

      <section className="ap-content">
        <div className="ap-heading">
          <div>
            <h1>{activeTab === "connections" ? "平台连接" : "写作资产"}</h1>
            <p>{activeTab === "connections"
              ? "按平台管理发布能力，需要哪项就连接哪项。"
              : "文风、背景、反馈与历史表现各司其职，生成时按固定顺序读取。"}</p>
          </div>
          {activeTab === "connections" && <div className="ap-summary"><strong>{connectedPlatformCount}/3</strong><span>平台已连接</span></div>}
        </div>

        <div className="ap-tabs" role="tablist" aria-label="账号设置">
          <button role="tab" aria-selected={activeTab === "connections"} onClick={() => changeTab("connections")}>
            <Link2 size={16} />账号连接
          </button>
          <button role="tab" aria-selected={activeTab === "writing"} onClick={() => changeTab("writing")}>
            <Brain size={16} />写作资产
          </button>
        </div>

        {activeTab === "connections" ? (
          <div className="ap-platform-list">
            <article className="ap-platform-row ap-platform-row--wechat">
              <header className="ap-platform-head">
                <span className="ap-platform-mark ap-platform-mark--wechat">微</span>
                <div>
                  <h2>微信公众号</h2>
                  <p>写入草稿使用 AppID，数据同步与后台发表使用 Cookie，可分别连接。</p>
                </div>
                <span className={`ap-status ${wechatBound || wechatAnalyticsBound ? "ap-status--ok" : ""}`}>
                  {Number(wechatBound) + Number(wechatAnalyticsBound)}/2 项可用
                </span>
              </header>

              <div className="ap-capability-grid">
                <section className="ap-capability">
                  <div className="ap-capability-title">
                    <BookOpen size={17} />
                    <div><h3>草稿写入</h3><p>需要 AppID 与 AppSecret</p></div>
                    <span className={wechatBound ? "ready" : ""}>{wechatBound ? "已连接" : "未连接"}</span>
                  </div>
                  {wechatBound ? (
                    <>
                      <div className="ap-account-brief">
                        <AccountAvatar name={wechatAccount?.nickname ?? "公众号"} imageUrl={wechatAccount?.headimgurl ?? null} platform="wechat" />
                        <div>
                          <strong>{wechatLoading ? "正在同步账号…" : wechatAccount?.nickname ?? "公众号账号"}</strong>
                          <span>{wechatAccount?.principal ?? "已连接公众号"} · {formatNumber(wechatAccount?.fans_count ?? null)} 位关注者</span>
                        </div>
                      </div>
                      {wechatAccount?.fans_limited || wechatAccount?.limited ? <p className="ap-limited">当前账号接口权限有限，部分数据暂不可获取。</p> : null}
                      {wechatError ? <p className="ap-error">{wechatError}</p> : null}
                      <div className="ap-actions">
                        <button className="ap-btn ap-btn--secondary" onClick={() => void refreshWechat()} disabled={wechatLoading}><RefreshCw size={15} className={wechatLoading ? "ap-spin" : ""} />刷新</button>
                        <button className="ap-icon-btn" onClick={unbindWechat} title="解绑公众号"><Link2Off size={16} /></button>
                      </div>
                    </>
                  ) : (
                    <form className="ap-bind-form" onSubmit={bindWechat}>
                      <input value={appId} onChange={event => { setAppId(event.target.value); setWechatError("") }} placeholder="AppID" autoComplete="off" />
                      <div className="ap-password"><input type={showSecret ? "text" : "password"} value={appSecret} onChange={event => { setAppSecret(event.target.value); setWechatError("") }} placeholder="AppSecret" autoComplete="new-password" /><button type="button" onClick={() => setShowSecret(value => !value)} title={showSecret ? "隐藏 AppSecret" : "显示 AppSecret"}>{showSecret ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
                      {wechatError ? <p className="ap-error">{wechatError}</p> : null}
                      <div className="ap-actions">
                        <button className="ap-btn ap-btn--dark" disabled={bindingWechat}>{bindingWechat ? "验证中…" : <><Link2 size={15} />连接草稿写入</>}</button>
                        <a href="https://developers.weixin.qq.com/console/product/mp" target="_blank" rel="noreferrer">获取凭据<ExternalLink size={13} /></a>
                      </div>
                    </form>
                  )}
                </section>

                <section className="ap-capability">
                  <div className="ap-capability-title">
                    <BarChart3 size={17} />
                    <div><h3>后台自动化</h3><p>数据看板与草稿发表共用 Cookie JSON</p></div>
                    <span className={wechatAnalyticsBound ? "ready" : ""}>{wechatAnalyticsBound ? "已连接" : "未连接"}</span>
                  </div>
                  {wechatAnalyticsBound ? (
                    <>
                      <div className="ap-account-brief ap-account-brief--plain">
                        <ShieldCheck size={20} />
                        <div><strong>微信后台会话已就绪</strong><span>同步看板或发表草稿时临时使用，后端不会持久化 Cookie</span></div>
                      </div>
                      <div className="ap-actions">
                        <button className="ap-btn ap-btn--dark" onClick={() => navigate("/insights")}>打开数据看板</button>
                        <button className="ap-icon-btn" onClick={unbindWechatAnalytics} title="解绑微信数据 Cookie"><Link2Off size={16} /></button>
                      </div>
                    </>
                  ) : (
                    <form className="ap-bind-form" onSubmit={bindWechatAnalytics}>
                      <textarea value={wechatAnalyticsCookies} onChange={event => { setWechatAnalyticsCookies(event.target.value); setWechatAnalyticsError("") }} placeholder='[{"name":"slave_sid","value":"…","domain":".mp.weixin.qq.com"}]' rows={4} />
                      {wechatAnalyticsError ? <p className="ap-error">{wechatAnalyticsError}</p> : null}
                      <div className="ap-actions">
                        <button className="ap-btn ap-btn--dark" disabled={bindingWechatAnalytics}>{bindingWechatAnalytics ? "验证并同步中…" : <><Link2 size={15} />连接微信后台</>}</button>
                        <a href="https://mp.weixin.qq.com" target="_blank" rel="noreferrer">打开微信后台<ExternalLink size={13} /></a>
                      </div>
                    </form>
                  )}
                </section>
              </div>
            </article>

            <article className="ap-platform-row">
              <header className="ap-platform-head">
                <span className="ap-platform-mark ap-platform-mark--toutiao">头</span>
                <div><h2>今日头条</h2><p>一份 Cookie 同时用于读取账号数据与发布文章。</p></div>
                <span className={`ap-status ${toutiaoBound ? "ap-status--ok" : ""}`}>{toutiaoBound ? "已连接" : "未连接"}</span>
              </header>
              <section className="ap-capability ap-capability--single">
                {toutiaoBound ? (
                  <>
                    <div className="ap-account-brief">
                      <AccountAvatar name={toutiaoAccount?.nickname ?? "头条号"} imageUrl={toutiaoAccount?.avatar_url ?? null} platform="toutiao" />
                      <div>
                        <strong>{toutiaoLoading ? "正在同步账号…" : toutiaoAccount?.nickname ?? "今日头条账号"}</strong>
                        <span>{formatNumber(toutiaoAccount?.followers_count ?? null)} 粉丝 · {formatNumber(toutiaoAccount?.total_reads ?? null)} 总阅读（播放）</span>
                      </div>
                    </div>
                    {toutiaoAccount?.data_note ? <p className="ap-limited">{toutiaoAccount.data_note}</p> : null}
                    {toutiaoAccount?.cached ? <p className="ap-limited">当前展示缓存数据，可手动刷新。</p> : null}
                    {toutiaoError ? <p className="ap-error">{toutiaoError}</p> : null}
                    <div className="ap-actions">
                      <button className="ap-btn ap-btn--secondary" onClick={() => void refreshToutiao(true)} disabled={toutiaoLoading}><RefreshCw size={15} className={toutiaoLoading ? "ap-spin" : ""} />刷新</button>
                      <a className="ap-icon-btn" href="https://mp.toutiao.com/profile_v4/index" target="_blank" rel="noreferrer" title="打开头条创作中心"><ExternalLink size={16} /></a>
                      <button className="ap-icon-btn" onClick={unbindToutiao} title="解绑今日头条"><Link2Off size={16} /></button>
                    </div>
                  </>
                ) : (
                  <form className="ap-bind-form ap-bind-form--horizontal" onSubmit={bindToutiao}>
                    <label><span>Cookie JSON</span><textarea value={cookies} onChange={event => { setCookies(event.target.value); setToutiaoError("") }} placeholder='[{"name":"sessionid","value":"…","domain":".toutiao.com"}]' rows={4} /></label>
                    <div className="ap-bind-side">
                      <p>从已登录的头条创作中心导出，验证通过后保存在当前浏览器。</p>
                      {toutiaoError ? <p className="ap-error">{toutiaoError}</p> : null}
                      <button className="ap-btn ap-btn--dark" disabled={bindingToutiao}>{bindingToutiao ? "验证中…" : <><Newspaper size={15} />连接今日头条</>}</button>
                      <a href="https://mp.toutiao.com/profile_v4/index" target="_blank" rel="noreferrer">打开创作中心<ExternalLink size={13} /></a>
                    </div>
                  </form>
                )}
              </section>
            </article>

            <article className="ap-platform-row">
              <header className="ap-platform-head">
                <span className="ap-platform-mark ap-platform-mark--xiaohongshu">红</span>
                <div><h2>小红书</h2><p>连接创作服务平台，用于图文笔记发布。</p></div>
                <span className={`ap-status ${xiaohongshuBound ? "ap-status--ok" : ""}`}>{xiaohongshuBound ? "已连接" : "未连接"}</span>
              </header>
              <section className="ap-capability ap-capability--single">
                {xiaohongshuBound ? (
                  <>
                    <div className="ap-account-brief ap-account-brief--plain">
                      <ShieldCheck size={20} />
                      <div><strong>发布会话已就绪</strong><span>遇到验证码或登录失效时，需要重新导出 Cookie</span></div>
                    </div>
                    <div className="ap-actions">
                      <button className="ap-btn ap-btn--dark" onClick={() => navigate("/")}>选择文章发布</button>
                      <a className="ap-icon-btn" href="https://creator.xiaohongshu.com" target="_blank" rel="noreferrer" title="打开小红书创作服务平台"><ExternalLink size={16} /></a>
                      <button className="ap-icon-btn" onClick={unbindXiaohongshu} title="解绑小红书"><Link2Off size={16} /></button>
                    </div>
                  </>
                ) : (
                  <form className="ap-bind-form ap-bind-form--horizontal" onSubmit={bindXiaohongshu}>
                    <label><span>Cookie JSON</span><textarea value={xiaohongshuCookies} onChange={event => { setXiaohongshuCookies(event.target.value); setXiaohongshuError("") }} placeholder='[{"name":"web_session","value":"…","domain":".xiaohongshu.com"}]' rows={4} /></label>
                    <div className="ap-bind-side">
                      <p>从已登录的小红书创作服务平台导出，仅用于图文笔记发布。</p>
                      {xiaohongshuError ? <p className="ap-error">{xiaohongshuError}</p> : null}
                      <button className="ap-btn ap-btn--dark"><BookOpen size={15} />连接小红书</button>
                      <a href="https://creator.xiaohongshu.com" target="_blank" rel="noreferrer">打开创作服务平台<ExternalLink size={13} /></a>
                    </div>
                  </form>
                )}
              </section>
            </article>
          </div>
        ) : (
          <section className="ap-writing-profile" aria-label="写作资产">
            <div className="ap-writing-profile-head">
              <div>
                <h2>写作资产总览</h2>
                <p>长期规则只保存你明确确认的内容，任务、素材和当次选择仍以单篇文章为准。</p>
              </div>
              <button className="ap-btn ap-btn--dark" onClick={() => void saveWritingAssets()} disabled={profileLoading || profileSaving}>
                {profileSaving ? "保存中…" : "保存写作资产"}
              </button>
            </div>

            <div className="ap-asset-metrics" aria-label="写作资产统计">
              <div><Sparkles size={17} /><strong>{assetOverview?.summary.dnaLayersCompleted ?? 0}/6</strong><span>文风层级</span></div>
              <div><FileText size={17} /><strong>{assetOverview?.summary.memoryCharacters ?? 0}</strong><span>背景记忆字数</span></div>
              <div><CheckCircle2 size={17} /><strong>{assetOverview?.summary.confirmedChoiceCount ?? 0}</strong><span>确认取舍</span></div>
              <div><Zap size={17} /><strong>{assetOverview?.summary.promptCount ?? 0}</strong><span>提示词</span></div>
              <div><Database size={17} /><strong>{assetOverview?.summary.materialArticleCount ?? 0}</strong><span>素材文章</span></div>
              <div><GitBranch size={17} /><strong>{assetOverview?.summary.completedCandidateCount ?? 0}/{assetOverview?.summary.candidateCount ?? 0}</strong><span>完成候选</span></div>
              <div><BarChart3 size={17} /><strong>{assetOverview?.summary.highPerformanceCount ?? 0}/{assetOverview?.summary.lowPerformanceCount ?? 0}</strong><span>高 / 低表现</span></div>
            </div>

            <section className="ap-asset-section" aria-labelledby="ap-dna-title">
              <div className="ap-asset-section-head">
                <div><span>长期表达规则</span><h3 id="ap-dna-title">六层写作 DNA</h3></div>
                <p>情境决定规则是否适用，字段留空不会阻塞生成。</p>
              </div>
              <div className="ap-writing-context">
                <label><span>主要读者</span><input value={writingProfile.audience} onChange={event => updateProfile("audience", event.target.value)} placeholder="稳定的核心读者，不写本篇临时受众" /></label>
                <fieldset className="ap-platform-defaults">
                  <legend>默认平台</legend>
                  <div>
                    {([["wechat", "公众号"], ["toutiao", "今日头条"], ["xiaohongshu", "小红书"]] as Array<[PublishingPlatform, string]>).map(([platform, label]) => (
                      <button type="button" key={platform} aria-pressed={writingProfile.defaultPlatforms[0] === platform} onClick={() => selectDefaultPlatform(platform)}>{label}</button>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="ap-dna-list">
                <div className="ap-dna-row">
                  <div className="ap-dna-label"><b>L1</b><div><h4>词句与节奏</h4><p>用词、句长、断句与明确禁用项</p></div></div>
                  <div className="ap-dna-fields">
                    <label><span>常用语气</span><input value={writingProfile.tone} onChange={event => updateProfile("tone", event.target.value)} placeholder="如：直接、克制，像熟悉业务的同事" /></label>
                    <label><span>句式与节奏</span><textarea value={writingProfile.languageStyle} onChange={event => updateProfile("languageStyle", event.target.value)} rows={3} placeholder="如：短句占多数；结论后补解释；不用破折号和分号" /></label>
                    <label><span>禁用表达</span><input value={writingProfile.bannedPhrases.join("、")} onChange={event => updateProfile("bannedPhrases", event.target.value.split(/[，,、]/).map(item => item.trim()).filter(Boolean))} placeholder="用顿号分隔" /></label>
                  </div>
                </div>
                {([
                  ["L2", "篇章结构", "文章怎样建立全貌、展开难点并收束", "preferredStructure", "如：问题切入 → 全貌 → 难点 → 判断 → 具体收束"],
                  ["L3", "切入视角", "面对同一题目时优先追问什么", "anglePreference", "如：从一个反常识问题或亲历困扰切入"],
                  ["L4", "素材选择", "倾向用什么材料证明、解释或唤起感受", "materialPreference", "如：优先一手经历、具体数据和可核对原文"],
                  ["L5", "观点与判断", "长期相信什么，以及判断的边界", "stance", "如：区分事实、推测和价值判断，不替读者下结论"],
                  ["L6", "图文与视觉", "图片、截图与排版分别承担什么职责", "visualStyle", "如：阅读型排版；图只用于解释结构或提供证据"],
                ] as Array<[string, string, string, WritingProfileTextField, string]>).map(([code, title, description, field, placeholder]) => (
                  <div className="ap-dna-row" key={code}>
                    <div className="ap-dna-label"><b>{code}</b><div><h4>{title}</h4><p>{description}</p></div></div>
                    <label className="ap-dna-single"><span>{title}规则</span><textarea value={writingProfile[field]} onChange={event => updateProfile(field, event.target.value)} rows={3} placeholder={placeholder} /></label>
                  </div>
                ))}
              </div>
            </section>

            <section className="ap-asset-section" aria-labelledby="ap-memory-title">
              <div className="ap-asset-section-head">
                <div><span>稳定事实</span><h3 id="ap-memory-title">长期背景记忆</h3></div>
                <p>{globalMemory.length} 字，生成时最多读取前 12000 字</p>
              </div>
              <textarea
                className="ap-memory-editor"
                aria-label="长期背景记忆"
                value={globalMemory}
                onChange={event => setGlobalMemory(event.target.value)}
                maxLength={100000}
                rows={9}
                placeholder={"## 账号定位\n- 长期关注的领域\n- 可公开引用的个人经历\n\n## 固定背景\n- 稳定业务事实与术语\n- 需要长期保持一致的信息"}
              />
              <p className="ap-asset-note">这里只保存身份、领域和稳定事实。文风规则放在六层 DNA，本篇资料放在文章素材。</p>
            </section>

            <section className="ap-asset-section" aria-labelledby="ap-sources-title">
              <div className="ap-asset-section-head">
                <div><span>生产资料</span><h3 id="ap-sources-title">素材、候选与表现证据</h3></div>
                <p>历史表现用于提出假设，不直接改写文风规则。</p>
              </div>
              <div className="ap-asset-links">
                <button onClick={() => navigate("/prompts")}><Zap size={18} /><span><strong>提示词</strong><small>{assetOverview?.summary.promptCount ?? 0} 条，管理生成与审核指令</small></span><ExternalLink size={14} /></button>
                <button onClick={() => navigate("/rag")}><Database size={18} /><span><strong>素材与往期文章</strong><small>{assetOverview?.summary.materialArticleCount ?? 0} 篇含素材，可按主题检索</small></span><ExternalLink size={14} /></button>
                <button onClick={() => navigate("/")}><GitBranch size={18} /><span><strong>候选池</strong><small>{assetOverview?.summary.candidateCount ?? 0} 篇候选，在对应文章中选用</small></span><ExternalLink size={14} /></button>
                <button onClick={() => navigate("/insights")}><BarChart3 size={18} /><span><strong>高低表现文章</strong><small>{assetOverview?.summary.highPerformanceCount ?? 0} 篇高表现，{assetOverview?.summary.lowPerformanceCount ?? 0} 篇低表现</small></span><ExternalLink size={14} /></button>
              </div>
            </section>

            <section className="ap-asset-section" aria-labelledby="ap-decisions-title">
              <div className="ap-asset-section-head">
                <div><span>人工确认</span><h3 id="ap-decisions-title">作者已确认的取舍</h3></div>
                <p>{assetOverview?.summary.confirmedChoiceCount ?? 0} 条</p>
              </div>
              <div className="ap-decision-list">
                {assetOverview?.recentConfirmedChoices.length ? assetOverview.recentConfirmedChoices.map(item => (
                  <a key={`${item.articleId}-${item.updatedAt}`} href={`/editor/${encodeURIComponent(item.articleId)}?tab=analysis`}>
                    <span>{feedbackLayerLabel(item.layer)}</span>
                    <strong>{item.note || item.retainedExpressions[0] || "已确认保留表达"}</strong>
                    <small>{new Date(item.updatedAt).toLocaleDateString("zh-CN")} · 修改或新增 {item.changedParagraphs} 段</small>
                  </a>
                )) : <div className="ap-decision-empty">还没有确认过写作取舍。文章手改后，可在审核页记录可复用选择。</div>}
              </div>
            </section>
          </section>
        )}
      </section>
    </main>
  )
}
