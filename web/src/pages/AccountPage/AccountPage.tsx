import { FormEvent, useCallback, useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  BarChart3, BookOpen, Edit3, Eye, EyeOff, ExternalLink, Link2, Link2Off,
  Newspaper, RefreshCw, ShieldCheck,
} from "lucide-react"
import PageHeader from "../../components/PageHeader/PageHeader"
import {
  extractErrorMessage, fetchCreatorWritingProfile, fetchToutiaoAccount, fetchWechatAccount,
  collectWechatAnalytics, saveCreatorWritingProfile,
  ToutiaoAccount, WechatAccount,
} from "../../utils/apiHelpers"
import { toast } from "../../components/Toast/Toast"
import {
  EMPTY_CREATOR_WRITING_PROFILE,
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

function formatNumber(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("zh-CN")
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
    fetchCreatorWritingProfile()
      .then(setWritingProfile)
      .catch(error => toast.error(extractErrorMessage(error, "写作档案加载失败")))
      .finally(() => setProfileLoading(false))
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

  async function saveWritingProfile() {
    setProfileSaving(true)
    try {
      setWritingProfile(await saveCreatorWritingProfile(writingProfile))
      toast.success("账号写作档案已保存，之后生成文章会自动使用")
    } catch (error) {
      toast.error(extractErrorMessage(error, "写作档案保存失败"))
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

  const activeTab = searchParams.get("tab") === "profile" ? "profile" : "connections"
  const connectedPlatformCount = Number(wechatBound || wechatAnalyticsBound)
    + Number(toutiaoBound)
    + Number(xiaohongshuBound)
  const fromSetup = searchParams.get("from") === "setup"
  const changeTab = (tab: "connections" | "profile") => {
    const next = new URLSearchParams(searchParams)
    if (tab === "profile") next.set("tab", "profile")
    else next.delete("tab")
    setSearchParams(next, { replace: true })
  }

  return (
    <main className="ap-root">
      <PageHeader
        title="账号与发布"
        subtitle="管理平台连接、发布能力和写作偏好"
        backLabel={fromSetup ? "返回首次设置" : "返回工作台"}
        onBack={() => navigate(fromSetup ? "/setup" : "/")}
        actions={<div className="ap-header-note"><ShieldCheck size={14} /> 凭据仅保存在当前浏览器</div>}
      />

      <section className="ap-content">
        <div className="ap-heading">
          <div>
            <h1>{activeTab === "connections" ? "平台连接" : "写作档案"}</h1>
            <p>{activeTab === "connections"
              ? "按平台管理发布能力，需要哪项就连接哪项。"
              : "这些偏好会作为生成参考，单篇任务要求仍然优先。"}</p>
          </div>
          {activeTab === "connections" && <div className="ap-summary"><strong>{connectedPlatformCount}/3</strong><span>平台已连接</span></div>}
        </div>

        <div className="ap-tabs" role="tablist" aria-label="账号设置">
          <button role="tab" aria-selected={activeTab === "connections"} onClick={() => changeTab("connections")}>
            <Link2 size={16} />账号连接
          </button>
          <button role="tab" aria-selected={activeTab === "profile"} onClick={() => changeTab("profile")}>
            <Edit3 size={16} />写作档案
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
          <section className="ap-writing-profile" aria-label="写作档案">
            <div className="ap-writing-profile-head">
              <div>
                <h2>生成时默认使用的写作偏好</h2>
                <p>单篇文章里的任务要求优先级更高，这里只补充长期不变的信息。</p>
              </div>
              <button className="ap-btn ap-btn--dark" onClick={() => void saveWritingProfile()} disabled={profileLoading || profileSaving}>
                {profileSaving ? "保存中…" : "保存写作档案"}
              </button>
            </div>
            <div className="ap-writing-profile-grid">
              <label><span>目标读者</span><input value={writingProfile.audience} onChange={event => updateProfile("audience", event.target.value)} placeholder="如：广州大学城学生和年轻教师" /></label>
              <label><span>内容立场</span><input value={writingProfile.stance} onChange={event => updateProfile("stance", event.target.value)} placeholder="如：实用、克制，明确区分事实和观点" /></label>
              <label><span>常用语气</span><input value={writingProfile.tone} onChange={event => updateProfile("tone", event.target.value)} placeholder="如：像熟悉校园的学长，直接但不油腻" /></label>
              <label><span>视觉倾向</span><input value={writingProfile.visualStyle} onChange={event => updateProfile("visualStyle", event.target.value)} placeholder="如：阅读型、少装饰、青绿色" /></label>
              <label className="ap-writing-profile-wide"><span>常用结构</span><textarea value={writingProfile.preferredStructure} onChange={event => updateProfile("preferredStructure", event.target.value)} rows={3} placeholder="如：场景开头 → 背景解释 → 分步建议 → 风险提醒 → 结论" /></label>
              <label className="ap-writing-profile-wide"><span>禁用表达</span><input value={writingProfile.bannedPhrases.join("、")} onChange={event => updateProfile("bannedPhrases", event.target.value.split(/[，,、]/).map(item => item.trim()).filter(Boolean))} placeholder="用顿号分隔，如：众所周知、赋能、闭眼冲" /></label>
            </div>
            <fieldset className="ap-platform-defaults">
              <legend>默认生成平台</legend>
              <p>生成弹窗会按当前编辑位置优先选择；没有明确上下文时使用这里的设置。</p>
              <div>
                {([["wechat", "公众号母稿"], ["toutiao", "今日头条版本"], ["xiaohongshu", "小红书发布"]] as Array<[PublishingPlatform, string]>).map(([platform, label]) => (
                  <button type="button" key={platform} aria-pressed={writingProfile.defaultPlatforms[0] === platform} onClick={() => selectDefaultPlatform(platform)}>{label}</button>
                ))}
              </div>
            </fieldset>
          </section>
        )}
      </section>
    </main>
  )
}
