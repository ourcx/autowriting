import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, BarChart3, Bookmark, BookOpen, Clock3, ExternalLink, FileText, Info, RefreshCw, Search, Share2, Sparkles, Upload, Users } from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  collectWechatAnalytics,
  fetchArticleList,
  fetchWechatAnalytics,
  importWechatAnalytics,
  extractErrorMessage,
  saveArticle,
  type WechatAnalyticsState,
} from "../../utils/apiHelpers"
import {
  hasWechatAnalyticsCookies,
  loadWechatAnalyticsCookies,
  loadWechatAnalyticsRefreshConfig,
  saveWechatAnalyticsRefreshConfig,
  type WechatAnalyticsRefreshConfig,
} from "../../utils/accountBindings"
import { useAuth } from "../../store/useAuth"
import { analyzeTopic, rankWechatArticles, topicBrief, wechatAnalyticsSchema, type WechatAnalyticsSnapshot } from "../../../shared/wechatAnalytics"
import Button from "../../components/Button/Button"
import PageHeader from "../../components/PageHeader/PageHeader"
import { toast } from "../../components/Toast/Toast"
import "./TopicInsights.css"

const CHART_COLORS = {
  readers: "#1a3a3a",
  sharers: "#ff6b5a",
  collectors: "#b8a4ed",
  sources: "#1a3a3a",
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

export default function TopicInsights() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const userId = user?.id || ""
  const [snapshots, setSnapshots] = useState<WechatAnalyticsSnapshot[]>([])
  const [index, setIndex] = useState(0)
  const [keyword, setKeyword] = useState("")
  const [question, setQuestion] = useState("")
  const [materials, setMaterials] = useState("")
  const [raw, setRaw] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<Array<{ id: string; title: string }>>([])
  const [config, setConfig] = useState<WechatAnalyticsRefreshConfig>({ enabled: false, intervalHours: 24 })
  const [state, setState] = useState<WechatAnalyticsState>({ status: "idle" })
  const [cookieBound, setCookieBound] = useState(false)
  const snapshot = snapshots[index]
  const analysis = useMemo(() => snapshot ? analyzeTopic(snapshot, keyword) : null, [snapshot, keyword])
  const ranked = useMemo(() => snapshot ? rankWechatArticles(snapshot) : [], [snapshot])
  const dailyMetrics = useMemo(() => snapshot?.dashboard.daily ?? [], [snapshot])
  const dailyChartData = useMemo(() => dailyMetrics.map(item => ({
    ...item,
    label: item.date.slice(5),
  })), [dailyMetrics])
  const dailyTotals = useMemo(() => dailyMetrics.reduce((totals, item) => ({
    sharers: totals.sharers + item.sharers,
    collectors: totals.collectors + item.collectors,
    sourceReaders: totals.sourceReaders + item.sourceReaders,
    publishedArticles: totals.publishedArticles + item.publishedArticles,
  }), { sharers: 0, collectors: 0, sourceReaders: 0, publishedArticles: 0 }), [dailyMetrics])
  const sourceChartData = useMemo(() => snapshot
    ? snapshot.trafficSources.slice().sort((left, right) => right.percent - left.percent)
    : [], [snapshot])
  const latestDaily = dailyMetrics[dailyMetrics.length - 1]
  const load = useCallback(async () => {
    try {
      const response = await fetchWechatAnalytics()
      setSnapshots(response.snapshots)
      setState(response.state)
      setDrafts(await fetchArticleList())
      if (userId) {
        setConfig(loadWechatAnalyticsRefreshConfig(userId))
        setCookieBound(hasWechatAnalyticsCookies(userId))
      }
      setError("")
    } catch { setError("数据未能加载，请刷新重试。") }
  }, [userId])
  useEffect(() => { void load() }, [load])

  const collect = useCallback(async () => {
    const cookies = userId ? loadWechatAnalyticsCookies(userId) : ""
    if (!cookies) {
      setCookieBound(false)
      setError("请先到用户页绑定微信公众号后台 Cookie JSON。")
      return
    }
    setBusy(true)
    setState(previous => ({ ...previous, status: "collecting", message: "正在读取微信后台" }))
    try {
      const response = await collectWechatAnalytics(cookies)
      setSnapshots(previous => [response.snapshot, ...previous.filter(item =>
        item.accountName !== response.snapshot.accountName
        || item.period.start !== response.snapshot.period.start
        || item.period.end !== response.snapshot.period.end
      )])
      setState(response.state)
      setIndex(0)
      setError("")
      toast.success(`已同步 ${response.snapshot.articles.length} 篇文章和 ${response.snapshot.dashboard.daily.length} 天看板数据`)
    } catch (caught) {
      const message = extractErrorMessage(caught, "自动采集失败，请检查微信 Cookie JSON。")
      await load()
      setError(message)
    } finally { setBusy(false) }
  }, [load, userId])
  const updateConfig = (next: WechatAnalyticsRefreshConfig) => {
    if (!userId) return
    saveWechatAnalyticsRefreshConfig(userId, next)
    setConfig(next)
    toast.success(next.enabled ? "已开启页面内定时刷新" : "已暂停定时刷新")
  }
  useEffect(() => {
    if (!config.enabled || !cookieBound || busy) return
    const elapsed = state.lastAttemptAt ? Date.now() - new Date(state.lastAttemptAt).getTime() : Number.POSITIVE_INFINITY
    const delay = Math.max(1000, config.intervalHours * 3600000 - elapsed)
    const timer = window.setTimeout(() => { void collect() }, delay)
    return () => window.clearTimeout(timer)
  }, [busy, collect, config.enabled, config.intervalHours, cookieBound, state.lastAttemptAt])

  const importSnapshot = async () => {
    setBusy(true)
    try {
      const parsed = wechatAnalyticsSchema.parse(JSON.parse(raw))
      await importWechatAnalytics(parsed)
      await load()
      setIndex(0)
      setRaw("")
      toast.success("已保存快照，同一账号和统计窗口不会重复计数")
    } catch { setError("导入失败，请使用浏览器采集的 JSON 快照，并检查日期、人数和文章标识。") }
    finally { setBusy(false) }
  }
  const linkArticle = async (id: string, localArticleId: string) => {
    if (!snapshot) return
    setBusy(true)
    try {
      const saved = await importWechatAnalytics({
        ...snapshot,
        articles: snapshot.articles.map(item => item.id === id
          ? { ...item, localArticleId: localArticleId || null }
          : item),
      })
      setSnapshots(previous => previous.map((item, position) => position === index ? saved : item))
    } catch { toast.error("关联失败，请重试") }
    finally { setBusy(false) }
  }
  const createBrief = async () => {
    if (!snapshot || !question.trim() || busy) return
    setBusy(true)
    try {
      const id = `${new Date().toLocaleDateString("sv-SE").replace(/-/g, "")}-选题-${crypto.randomUUID().slice(0, 8)}`
      await saveArticle(id, topicBrief(snapshot, keyword, question, materials))
      navigate(`/editor/${encodeURIComponent(id)}?tab=materials`)
    } catch { setError("任务保存失败，选题和素材仍保留在此页，可以重试。") }
    finally { setBusy(false) }
  }

  return <main className="topic-page">
    <PageHeader
      title="账号观察"
      subtitle="用文章表现辅助选题与素材整理"
      icon={<BarChart3 size={16}/>}
      backLabel="返回工作台"
      onBack={() => navigate("/")}
      actions={<a className="topic-header-action" href="https://mp.weixin.qq.com" target="_blank" rel="noreferrer">微信后台<ExternalLink size={14}/></a>}
    />
    <div className="topic-content">
    <header className="topic-header">
      <div className="topic-title-block"><p className="topic-eyebrow">从读者反馈，回到你的观察</p><h1>下一篇，值得写什么</h1><p>看看哪些问题持续有人读，把你的线索和判断接着写下去。</p></div>
    </header>
    <section className="topic-sync" aria-label="微信数据同步">
      <div className={`topic-sync-state topic-sync-state--${state.status}`}><span />
        <strong>{state.status === "collecting" ? "正在同步" : state.status === "failed" ? "同步中断" : state.lastSuccessAt ? `上次同步 ${new Date(state.lastSuccessAt).toLocaleString()}` : "尚未同步"}</strong>
        <small>{state.message || (cookieBound ? "Cookie JSON 已保存在当前浏览器" : "尚未绑定数据 Cookie")}</small>
      </div>
      <div className="topic-sync-controls">
        {!cookieBound && <Button className="topic-bind-button" onClick={() => navigate("/account")}>绑定数据 Cookie</Button>}
        <label className="topic-switch"><input type="checkbox" checked={config.enabled} disabled={!cookieBound} onChange={event => updateConfig({ ...config, enabled: event.target.checked })}/><span />页面内定时刷新</label>
        <label className="topic-interval"><Clock3 size={14}/><select aria-label="自动刷新间隔" value={config.intervalHours} disabled={!cookieBound || !config.enabled} onChange={event => updateConfig({ ...config, intervalHours: Number(event.target.value) })}>
          <option value={6}>每 6 小时</option><option value={12}>每 12 小时</option><option value={24}>每天</option><option value={72}>每 3 天</option>
        </select></label>
        <Button className="topic-sync-button" disabled={!cookieBound || busy} onClick={() => void collect()}><RefreshCw size={16} className={busy ? "topic-spin" : ""}/>{busy ? "同步中" : "立即同步"}</Button>
      </div>
    </section>
    {error && <div role="alert" className="topic-error"><span>{error}</span><Button onClick={() => void load()}>重新加载</Button></div>}
    <details className="topic-import">
      <summary><Upload size={16} />导入离线快照</summary>
      <p>仅在本机浏览器无法连接时使用。快照不应包含 Cookie、登录链接或 Token。</p>
      <input type="file" accept=".json,application/json" aria-label="选择数据快照" onChange={event => {
        const file = event.target.files?.[0]
        if (file && file.size <= 1000000) void file.text().then(setRaw).catch(() => setError("文件读取失败"))
        else if (file) setError("快照文件不能超过 1 MB")
      }}/>
      <textarea aria-label="数据快照 JSON" value={raw} onChange={event => setRaw(event.target.value)} placeholder="粘贴浏览器采集的 JSON 数据" maxLength={1000000}/>
      <Button variant="primary" disabled={busy || !raw.trim()} onClick={() => void importSnapshot()}>保存数据快照</Button>
    </details>
    {snapshot && analysis ? <>
      <div className="topic-period">
        <div className="topic-period-account"><span>当前账号</span><strong>{snapshot.accountName}</strong></div>
        <label className="topic-period-picker"><span>统计窗口</span><select aria-label="统计窗口" value={index} onChange={event => setIndex(Number(event.target.value))}>{snapshots.map((item, position) => <option key={`${item.accountName}-${item.period.start}-${item.period.end}`} value={position}>{item.accountName} · {item.period.start} — {item.period.end}</option>)}</select></label>
        <span className="topic-collected">采集于 {new Date(snapshot.collectedAt).toLocaleString()}</span>
      </div>
      <section className="topic-dashboard" aria-labelledby="topic-dashboard-title">
        <div className="topic-section-heading">
          <div><p className="topic-section-kicker">账号看板</p><h2 id="topic-dashboard-title">账号每日表现</h2><p>数据来自微信内容分析“数据概览”，和文章列表在同一次同步中更新。</p></div>
          <span className="topic-data-window">{dailyMetrics.length ? `${dailyMetrics.length} 天` : "待同步"}</span>
        </div>
        {latestDaily ? <>
          <div className="topic-dashboard-kpis">
            <div className="topic-dashboard-kpi topic-dashboard-kpi--mint"><Users size={20}/><strong>{latestDaily.readers.toLocaleString()}</strong><span>最近一天阅读人数</span><small>{latestDaily.date}</small></div>
            <div className="topic-dashboard-kpi topic-dashboard-kpi--peach"><Share2 size={20}/><strong>{dailyTotals.sharers.toLocaleString()}</strong><span>每日分享人数合计</span><small>{dailyMetrics.length} 天日数据相加</small></div>
            <div className="topic-dashboard-kpi topic-dashboard-kpi--lavender"><Bookmark size={20}/><strong>{dailyTotals.collectors.toLocaleString()}</strong><span>每日收藏人数合计</span><small>{dailyMetrics.length} 天日数据相加</small></div>
            <div className="topic-dashboard-kpi topic-dashboard-kpi--ochre"><FileText size={20}/><strong>{dailyTotals.publishedArticles.toLocaleString()}</strong><span>期间发表篇数</span><small>{snapshot.period.start} 至 {snapshot.period.end}</small></div>
          </div>
          <div className="topic-chart-grid">
            <section className="topic-chart-panel" aria-label="账号每日趋势图">
              <div className="topic-chart-heading"><div><strong>每日趋势</strong><span>阅读人数使用左轴，分享和收藏人数使用右轴</span></div></div>
              <div className="topic-chart-frame">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={dailyChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e5e5e5" strokeDasharray="3 3"/>
                    <XAxis dataKey="label" axisLine={false} tickLine={false} interval="preserveStartEnd" tick={{ fontSize: 10, fill: "#6a6a6a" }}/>
                    <YAxis yAxisId="readers" axisLine={false} tickLine={false} width={44} tickFormatter={value => formatCompactNumber(Number(value))} tick={{ fontSize: 10, fill: "#6a6a6a" }}/>
                    <YAxis yAxisId="engagement" orientation="right" axisLine={false} tickLine={false} width={36} tickFormatter={value => formatCompactNumber(Number(value))} tick={{ fontSize: 10, fill: "#6a6a6a" }}/>
                    <Tooltip cursor={{ fill: "#f5f0e0" }} contentStyle={{ border: "1px solid #e5e5e5", borderRadius: 8, background: "#fffaf0", fontSize: 12 }} labelFormatter={label => `日期 ${String(label)}`}/>
                    <Legend wrapperStyle={{ fontSize: 12 }}/>
                    <Bar yAxisId="readers" dataKey="readers" name="阅读人数" fill={CHART_COLORS.readers} radius={[4, 4, 0, 0]} maxBarSize={24}/>
                    <Line yAxisId="engagement" type="monotone" dataKey="sharers" name="分享人数" stroke={CHART_COLORS.sharers} strokeWidth={2} dot={false} activeDot={{ r: 4 }}/>
                    <Line yAxisId="engagement" type="monotone" dataKey="collectors" name="收藏人数" stroke={CHART_COLORS.collectors} strokeWidth={2} dot={false} activeDot={{ r: 4 }}/>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p className="topic-chart-note">跳转阅读原文人数的每日合计为 {dailyTotals.sourceReaders.toLocaleString()}。跨日读者可能重复，不能把日数据合计当作期间去重人数。</p>
            </section>
            <section className="topic-chart-panel" aria-label="阅读来源分布图">
              <div className="topic-chart-heading"><div><strong>阅读来源</strong><span>各渠道阅读人数在统计窗口内的占比</span></div></div>
              <div className="topic-chart-frame">
                {sourceChartData.length ? <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sourceChartData} layout="vertical" margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
                    <CartesianGrid horizontal={false} stroke="#e5e5e5" strokeDasharray="3 3"/>
                    <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tickFormatter={value => `${value}%`} tick={{ fontSize: 10, fill: "#6a6a6a" }}/>
                    <YAxis type="category" dataKey="name" width={72} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#3a3a3a" }}/>
                    <Tooltip cursor={{ fill: "#f5f0e0" }} contentStyle={{ border: "1px solid #e5e5e5", borderRadius: 8, background: "#fffaf0", fontSize: 12 }}/>
                    <Bar dataKey="percent" name="阅读人数占比" fill={CHART_COLORS.sources} radius={[0, 4, 4, 0]} maxBarSize={20}/>
                  </BarChart>
                </ResponsiveContainer> : <div className="topic-chart-empty">本次同步没有返回阅读来源。</div>}
              </div>
            </section>
          </div>
        </> : <div className="topic-dashboard-empty"><BarChart3 size={28}/><div><strong>重新同步后显示账号趋势</strong><span>旧快照没有每日看板数据，文章记录仍可继续使用。</span></div><Button variant="primary" disabled={busy} onClick={() => cookieBound ? void collect() : navigate("/account")}>{cookieBound ? "同步看板数据" : "绑定数据 Cookie"}</Button></div>}
      </section>
      <section className="topic-article-overview" aria-labelledby="topic-articles-title">
        <div className="topic-section-heading">
          <div><p className="topic-section-kicker">文章表现</p><h2 id="topic-articles-title">回到具体文章找线索</h2></div>
        </div>
        <div className="topic-article-facts">
          <div><BookOpen size={18}/><strong>{snapshot.articles.length}</strong><span>{snapshot.collection.complete ? "篇完整列表" : "篇已采集"}</span></div>
          <div><BarChart3 size={18}/><strong>{snapshot.trafficSources.find(item => item.name === "推荐")?.percent.toFixed(1) ?? "—"}<small>%</small></strong><span>推荐流量占比</span></div>
          <div><Sparkles size={18}/><strong>{ranked.filter(item => item.band === "high").length}<small> / </small>{ranked.filter(item => item.band === "low").length}</strong><span>高关注 / 低关注</span></div>
          <div className="topic-metric-note"><Info size={18}/><p>文章阅读人数包含旧文继续获得的阅读。高低关注只表示同一窗口内的相对位置，不同文章的读者可能重叠，也不能据此认定某种句式有效。</p></div>
        </div>
      </section>
      <section className="topic-workspace">
        <div className="topic-evidence">
          <div className="topic-evidence-heading"><div><p className="topic-section-kicker">文章筛选</p><h2>从历史文章里找线索</h2></div><span>筛选结果</span></div>
          <label className="topic-search"><Search size={18}/><input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="按主题筛选，例如：保研、校园跑" aria-label="主题关键词"/></label>
          <p className="topic-note">{analysis.articles.length} 篇匹配 · 期间阅读人数中位数 {analysis.medianReaders?.toLocaleString() ?? "—"} · {analysis.olderArticles} 篇在统计窗口前发布</p>
          <div className="topic-table-wrap"><table><thead><tr><th>文章 / 关联工作台稿件</th><th>相对位置</th><th>发布日期</th><th>期间阅读人数</th></tr></thead><tbody>
            {analysis.articles.map(item => <tr key={item.id}><td><strong>{item.title}</strong>
              <select disabled={busy} aria-label={`关联稿件：${item.title}`} value={item.localArticleId || ""} onChange={event => void linkArticle(item.id, event.target.value)}>
                <option value="">关联候选稿、素材和写作取舍…</option>{drafts.map(draft => <option value={draft.id} key={draft.id}>{draft.title}</option>)}
              </select>
              {item.localArticleId && <a href={`/editor/${encodeURIComponent(item.localArticleId)}?tab=analysis`}>查看写作取舍 ↗</a>}
            </td><td><span className={`topic-band topic-band--${item.band}`}>{item.band === "high" ? "高关注" : item.band === "low" ? "低关注" : "中段"}</span><small>第 {item.rank}/{snapshot.articles.length}</small></td><td>{item.publishedAt}</td><td>{item.reads.toLocaleString()}<small>后台占比 {item.shareOfReads}%</small></td></tr>)}
          </tbody></table></div>
          {!analysis.articles.length && <p>没有匹配的标题，换一个关键词试试。</p>}
          <p className="topic-note">{analysis.observation} 下一次对比应固定发布后的观察时长，并记录账号体量和流量来源。</p>
        </div>
        <aside className="topic-brief"><div className="topic-brief-heading"><Sparkles size={20}/><span>选题任务</span></div><h2>把问题带回素材</h2><p>你掌握的事实、现场观察和采访，决定这篇文章是否值得写。</p>
          <label>我想回答的问题<input value={question} maxLength={200} onChange={event => setQuestion(event.target.value)} placeholder="写下一个读者真的关心的问题"/></label>
          <label>已有线索与待补资料<textarea value={materials} maxLength={10000} onChange={event => setMaterials(event.target.value)} placeholder="原始公告链接、亲身经历、可采访的人、需要核对的数据…"/></label>
          <Button variant="primary" disabled={busy || !question.trim() || !analysis.articles.length} onClick={() => void createBrief()}>保存为选题任务 <ArrowRight size={16}/></Button>
          <small>会保存本次筛选的观察依据和素材缺口，下一步继续收集素材。</small>
        </aside>
      </section>
    </> : <div className="topic-empty"><h2>先同步一次微信数据</h2><p>数据到位后，可以筛选主题、关联已写文章，并把新的问题保存为任务。“降低 30%”仍是目标，不会作为已有结果展示。</p></div>}
    </div>
  </main>
}
