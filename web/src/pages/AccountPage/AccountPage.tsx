import { FormEvent, useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowLeft, Eye, EyeOff, ExternalLink, Link2, Link2Off,
  RefreshCw, ShieldCheck, Users,
} from "lucide-react"
import {
  extractErrorMessage, fetchToutiaoAccount, fetchWechatAccount,
  ToutiaoAccount, WechatAccount,
} from "../../utils/apiHelpers"
import {
  clearToutiaoCookies, clearWechatCredentials, getWechatHeaders,
  hasToutiaoCookies, loadToutiaoCookies, loadWechatCredentials,
  saveToutiaoCookies, saveWechatCredentials,
} from "../../utils/accountBindings"
import "./AccountPage.css"

type Platform = "wechat" | "toutiao"

function formatNumber(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("zh-CN")
}

function AccountAvatar({ name, imageUrl, platform }: { name: string; imageUrl: string | null; platform: Platform }) {
  if (imageUrl) return <img className="ap-avatar" src={imageUrl} alt={`${name}头像`} />
  return <div className={`ap-avatar ap-avatar--${platform}`}>{name.slice(0, 1) || "?"}</div>
}

export default function AccountPage() {
  const navigate = useNavigate()
  const [wechatAccount, setWechatAccount] = useState<WechatAccount | null>(null)
  const [toutiaoAccount, setToutiaoAccount] = useState<ToutiaoAccount | null>(null)
  const [wechatLoading, setWechatLoading] = useState(false)
  const [toutiaoLoading, setToutiaoLoading] = useState(false)
  const [wechatError, setWechatError] = useState("")
  const [toutiaoError, setToutiaoError] = useState("")
  const [wechatBound, setWechatBound] = useState(() => !!loadWechatCredentials())
  const [toutiaoBound, setToutiaoBound] = useState(hasToutiaoCookies)
  const [appId, setAppId] = useState("")
  const [appSecret, setAppSecret] = useState("")
  const [showSecret, setShowSecret] = useState(false)
  const [cookies, setCookies] = useState("")
  const [bindingWechat, setBindingWechat] = useState(false)
  const [bindingToutiao, setBindingToutiao] = useState(false)

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

  return (
    <main className="ap-root">
      <header className="ap-header">
        <button className="ap-back" onClick={() => navigate("/")}>
          <ArrowLeft size={16} /> 返回工作台
        </button>
        <div className="ap-brand"><span>Dashy</span><span className="ap-brand-slash">/</span> 用户页</div>
        <div className="ap-header-note"><ShieldCheck size={14} /> 凭据仅保存在当前浏览器</div>
      </header>

      <section className="ap-content">
        <div className="ap-intro">
          <div>
            <p className="ap-eyebrow">CREATOR ACCOUNTS</p>
            <h1>一个地方，查看你的内容账号</h1>
            <p>绑定公众号与今日头条后，快速掌握账号状态和创作数据。</p>
          </div>
          <div className="ap-summary">
            <span>已连接</span>
            <strong>{Number(wechatBound) + Number(toutiaoBound)}<small>/2</small></strong>
            <span>内容平台</span>
          </div>
        </div>

        <div className="ap-grid">
          <article className="ap-card ap-card--wechat">
            <div className="ap-card-top">
              <div className="ap-platform"><span className="ap-platform-mark ap-platform-mark--wechat">微</span><span>微信公众号</span></div>
              <span className={`ap-status ${wechatBound ? "ap-status--ok" : ""}`}>{wechatBound ? "已绑定" : "未绑定"}</span>
            </div>
            {wechatBound ? (
              <>
                <div className="ap-profile">
                  <AccountAvatar name={wechatAccount?.nickname ?? "公众号"} imageUrl={wechatAccount?.headimgurl ?? null} platform="wechat" />
                  <div><h2>{wechatLoading ? "正在同步账号…" : wechatAccount?.nickname ?? "公众号账号"}</h2><p>{wechatAccount?.principal ?? "已连接公众号"}</p></div>
                </div>
                <div className="ap-metric">
                  <Users size={18} /><div><strong>{formatNumber(wechatAccount?.fans_count ?? null)}</strong><span>关注人数</span></div>
                </div>
                {wechatAccount?.fans_limited || wechatAccount?.limited ? <p className="ap-limited">当前账号接口权限有限，部分数据暂不可获取。</p> : null}
                {wechatError ? <p className="ap-error">{wechatError}</p> : null}
                <div className="ap-actions">
                  <button className="ap-btn ap-btn--secondary" onClick={() => void refreshWechat()} disabled={wechatLoading}><RefreshCw size={15} className={wechatLoading ? "ap-spin" : ""} /> 刷新数据</button>
                  <button className="ap-icon-btn" onClick={unbindWechat} title="解绑公众号"><Link2Off size={16} /></button>
                </div>
              </>
            ) : (
              <form className="ap-bind-form" onSubmit={bindWechat}>
                <p>使用公众号 AppID 与 AppSecret 验证并连接账号。</p>
                <input value={appId} onChange={event => { setAppId(event.target.value); setWechatError("") }} placeholder="AppID" autoComplete="off" />
                <div className="ap-password"><input type={showSecret ? "text" : "password"} value={appSecret} onChange={event => { setAppSecret(event.target.value); setWechatError("") }} placeholder="AppSecret" autoComplete="new-password" /><button type="button" onClick={() => setShowSecret(value => !value)}>{showSecret ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
                {wechatError ? <p className="ap-error">{wechatError}</p> : null}
                <button className="ap-btn ap-btn--dark" disabled={bindingWechat}>{bindingWechat ? "验证中…" : <><Link2 size={15} />绑定公众号</>}</button>
                <a href="https://developers.weixin.qq.com/console/product/mp" target="_blank" rel="noreferrer">前往微信公众平台 <ExternalLink size={13} /></a>
              </form>
            )}
          </article>

          <article className="ap-card ap-card--toutiao">
            <div className="ap-card-top">
              <div className="ap-platform"><span className="ap-platform-mark ap-platform-mark--toutiao">头</span><span>今日头条</span></div>
              <span className={`ap-status ${toutiaoBound ? "ap-status--ok" : ""}`}>{toutiaoBound ? "已绑定" : "未绑定"}</span>
            </div>
            {toutiaoBound ? (
              <>
                <div className="ap-profile">
                  <AccountAvatar name={toutiaoAccount?.nickname ?? "头条号"} imageUrl={toutiaoAccount?.avatar_url ?? null} platform="toutiao" />
                  <div><h2>{toutiaoLoading ? "正在同步账号…" : toutiaoAccount?.nickname ?? "今日头条账号"}</h2><p>{toutiaoAccount?.description || "已连接今日头条创作中心"}</p></div>
                </div>
                <div className="ap-stat-grid">
                  <div><strong>{formatNumber(toutiaoAccount?.followers_count ?? null)}</strong><span>粉丝</span></div>
                  <div><strong>{formatNumber(toutiaoAccount?.total_reads ?? null)}</strong><span>总阅读(播放)量</span></div>
                  <div><strong>{formatNumber(toutiaoAccount?.total_income ?? null)}</strong><span>累计收益（元）</span></div>
                </div>
                {toutiaoAccount?.data_note ? <p className="ap-limited">{toutiaoAccount.data_note}</p> : null}
                {toutiaoAccount?.cached ? <p className="ap-limited">已使用缓存数据，点击“刷新数据”可立即更新。</p> : null}
                {toutiaoError ? <p className="ap-error">{toutiaoError}</p> : null}
                <div className="ap-actions">
                  <button className="ap-btn ap-btn--secondary" onClick={() => void refreshToutiao(true)} disabled={toutiaoLoading}><RefreshCw size={15} className={toutiaoLoading ? "ap-spin" : ""} /> 刷新数据</button>
                  <a className="ap-icon-btn" href="https://mp.toutiao.com/profile_v4/index" target="_blank" rel="noreferrer" title="打开头条创作中心"><ExternalLink size={16} /></a>
                  <button className="ap-icon-btn" onClick={unbindToutiao} title="解绑今日头条"><Link2Off size={16} /></button>
                </div>
              </>
            ) : (
              <form className="ap-bind-form" onSubmit={bindToutiao}>
                <p>粘贴已登录头条创作中心浏览器导出的 Cookie JSON，用于读取账号数据及发布文章。</p>
                <textarea value={cookies} onChange={event => { setCookies(event.target.value); setToutiaoError("") }} placeholder='[{"name":"sessionid","value":"…","domain":".toutiao.com"}]' rows={5} />
                {toutiaoError ? <p className="ap-error">{toutiaoError}</p> : null}
                <button className="ap-btn ap-btn--dark" disabled={bindingToutiao}>{bindingToutiao ? "验证中…" : <><Link2 size={15} />绑定今日头条</>}</button>
                <a href="https://mp.toutiao.com/profile_v4/index" target="_blank" rel="noreferrer">打开头条创作中心 <ExternalLink size={13} /></a>
              </form>
            )}
          </article>
        </div>
      </section>
    </main>
  )
}
