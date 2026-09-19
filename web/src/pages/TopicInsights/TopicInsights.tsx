import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, ArrowRight, Upload, Search, RefreshCw, Clock3 } from "lucide-react"
import {
  collectWechatAnalytics,
  fetchArticleList,
  fetchWechatAnalytics,
  importWechatAnalytics,
  extractErrorMessage,
  saveArticle,
  saveWechatAnalyticsConfig,
  type WechatAnalyticsConfig,
  type WechatAnalyticsState,
} from "../../utils/apiHelpers"
import { analyzeTopic, rankWechatArticles, topicBrief, wechatAnalyticsSchema, type WechatAnalyticsSnapshot } from "../../../shared/wechatAnalytics"
import { toast } from "../../components/Toast/Toast"
import "./TopicInsights.css"

export default function TopicInsights() {
  const navigate = useNavigate()
  const [snapshots, setSnapshots] = useState<WechatAnalyticsSnapshot[]>([])
  const [index, setIndex] = useState(0)
  const [keyword, setKeyword] = useState("")
  const [question, setQuestion] = useState("")
  const [materials, setMaterials] = useState("")
  const [raw, setRaw] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<Array<{ id: string; title: string }>>([])
  const [config, setConfig] = useState<WechatAnalyticsConfig>({ enabled: false, intervalHours: 24 })
  const [state, setState] = useState<WechatAnalyticsState>({ status: "idle" })
  const [collectorAvailable, setCollectorAvailable] = useState(false)
  const snapshot = snapshots[index]
  const analysis = useMemo(() => snapshot ? analyzeTopic(snapshot, keyword) : null, [snapshot, keyword])
  const ranked = useMemo(() => snapshot ? rankWechatArticles(snapshot) : [], [snapshot])
  const history = useMemo(() => snapshots.slice().reverse().map(item => ({
    label: item.period.end.slice(5),
    median: (() => {
      const values = item.articles.map(article => article.reads).sort((a, b) => a - b)
      const middle = Math.floor(values.length / 2)
      return !values.length ? 0 : values.length % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2)
    })(),
  })), [snapshots])
  const trendMax = Math.max(1, ...history.map(item => item.median))
  const load = async () => {
    try {
      const response = await fetchWechatAnalytics()
      setSnapshots(response.snapshots)
      setConfig(response.config)
      setState(response.state)
      setCollectorAvailable(response.collectorAvailable)
      setDrafts(await fetchArticleList())
      setError("")
    } catch { setError("数据未能加载，请刷新重试。") }
  }
  useEffect(() => { void load() }, [])

  const collect = async () => {
    setBusy(true)
    setState(previous => ({ ...previous, status: "collecting", message: "正在读取微信后台" }))
    try {
      const response = await collectWechatAnalytics()
      setSnapshots(previous => [response.snapshot, ...previous.filter(item =>
        item.accountName !== response.snapshot.accountName
        || item.period.start !== response.snapshot.period.start
        || item.period.end !== response.snapshot.period.end
      )])
      setConfig(response.config)
      setState(response.state)
      setIndex(0)
      setError("")
      toast.success(`已自动同步 ${response.snapshot.articles.length} 篇文章`)
    } catch (caught) {
      setError(extractErrorMessage(caught, "自动采集失败，请确认本机浏览器已打开微信内容分析页。"))
      await load()
    } finally { setBusy(false) }
  }
  const updateConfig = async (next: WechatAnalyticsConfig) => {
    try {
      setConfig(await saveWechatAnalyticsConfig(next))
      toast.success(next.enabled ? "已开启定时刷新" : "已暂停定时刷新")
    } catch { toast.error("刷新设置未保存") }
  }

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
    <nav><button onClick={() => navigate("/")}><ArrowLeft size={16} />工作台</button><span>账号观察 / 选题与素材</span></nav>
    <header className="topic-header"><div><p className="topic-eyebrow">从读者反馈，回到你的观察</p><h1>下一篇，值得写什么</h1><p>看看哪些问题持续有人读，把你的线索和判断接着写下去。</p></div><a href="https://mp.weixin.qq.com" target="_blank" rel="noreferrer">打开微信后台 ↗</a></header>
    <section className="topic-sync" aria-label="微信数据同步">
      <div className={`topic-sync-state topic-sync-state--${state.status}`}><span />
        <strong>{state.status === "collecting" ? "正在同步" : state.status === "failed" ? "同步中断" : state.lastSuccessAt ? `上次同步 ${new Date(state.lastSuccessAt).toLocaleString()}` : "尚未同步"}</strong>
        <small>{state.message || (collectorAvailable ? "已配置本机专用浏览器连接" : "本机浏览器连接未配置")}</small>
      </div>
      <label className="topic-switch"><input type="checkbox" checked={config.enabled} disabled={!collectorAvailable} onChange={event => void updateConfig({ ...config, enabled: event.target.checked })}/><span />定时刷新</label>
      <label className="topic-interval"><Clock3 size={14}/><select aria-label="自动刷新间隔" value={config.intervalHours} disabled={!collectorAvailable || !config.enabled} onChange={event => void updateConfig({ ...config, intervalHours: Number(event.target.value) })}>
        <option value={6}>每 6 小时</option><option value={12}>每 12 小时</option><option value={24}>每天</option><option value={72}>每 3 天</option>
      </select></label>
      <button className="btn btn-primary" disabled={!collectorAvailable || busy} onClick={() => void collect()}><RefreshCw size={16} className={busy ? "topic-spin" : ""}/>{busy ? "同步中" : "立即同步"}</button>
    </section>
    {error && <p role="alert" className="topic-error">{error}<button onClick={() => void load()}>重新加载</button></p>}
    <details className="topic-import">
      <summary><Upload size={16} />导入离线快照</summary>
      <p>仅在本机浏览器无法连接时使用。快照不应包含 Cookie、登录链接或 Token。</p>
      <input type="file" accept=".json,application/json" aria-label="选择数据快照" onChange={event => {
        const file = event.target.files?.[0]
        if (file && file.size <= 1000000) void file.text().then(setRaw).catch(() => setError("文件读取失败"))
        else if (file) setError("快照文件不能超过 1 MB")
      }}/>
      <textarea aria-label="数据快照 JSON" value={raw} onChange={event => setRaw(event.target.value)} placeholder="粘贴浏览器采集的 JSON 数据" maxLength={1000000}/>
      <button className="btn btn-primary" disabled={busy || !raw.trim()} onClick={() => void importSnapshot()}>保存数据快照</button>
    </details>
    {snapshot && analysis ? <>
      <div className="topic-period">
        <strong>{snapshot.accountName}</strong>
        <select aria-label="统计窗口" value={index} onChange={event => setIndex(Number(event.target.value))}>{snapshots.map((item, position) => <option key={`${item.accountName}-${item.period.start}-${item.period.end}`} value={position}>{item.accountName} · {item.period.start} — {item.period.end}</option>)}</select>
        <span>采集于 {new Date(snapshot.collectedAt).toLocaleString()}</span>
      </div>
      <div className="topic-observation">
        <div><strong>{snapshot.articles.length}</strong><span>{snapshot.collection.complete ? "篇完整列表" : "篇已采集，列表未完整"}</span></div>
        <div><strong>{snapshot.trafficSources.find(item => item.name === "推荐")?.percent.toFixed(1) ?? "—"}<small>%</small></strong><span>期间推荐流量占比</span></div>
        <div><strong>{ranked.filter(item => item.band === "high").length}<small> / </small>{ranked.filter(item => item.band === "low").length}</strong><span>高关注 / 低关注</span></div>
        <p>这里是统计期内的阅读人数，包含旧文继续获得的阅读。高低关注只表示同一窗口内的相对位置；不同文章的读者可能重叠，也不能据此认定某种句式有效。</p>
      </div>
      {history.length > 1 && <section className="topic-trend" aria-label="快照趋势">
        <div><h2>窗口中位阅读变化</h2><p>不同统计窗口的文章集合可能变化，这条线只帮助发现波动，不证明增长原因。</p></div>
        <div className="topic-bars">{history.map(item => <div key={item.label} title={`${item.label}：${item.median.toLocaleString()} 人`}><span style={{ height: `${Math.max(8, Math.round(item.median / trendMax * 100))}%` }}/><small>{item.label}</small></div>)}</div>
      </section>}
      <section className="topic-workspace">
        <div className="topic-evidence">
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
        <aside className="topic-brief"><h2>把问题带回素材</h2><p>你掌握的事实、现场观察和采访，决定这篇文章是否值得写。</p>
          <label>我想回答的问题<input value={question} maxLength={200} onChange={event => setQuestion(event.target.value)} placeholder="写下一个读者真的关心的问题"/></label>
          <label>已有线索与待补资料<textarea value={materials} maxLength={10000} onChange={event => setMaterials(event.target.value)} placeholder="原始公告链接、亲身经历、可采访的人、需要核对的数据…"/></label>
          <button className="btn btn-primary" disabled={busy || !question.trim() || !analysis.articles.length} onClick={() => void createBrief()}>保存为选题任务 <ArrowRight size={16}/></button>
          <small>会保存本次筛选的观察依据和素材缺口，下一步继续收集素材。</small>
        </aside>
      </section>
    </> : <div className="topic-empty"><h2>先同步一次微信数据</h2><p>数据到位后，可以筛选主题、关联已写文章，并把新的问题保存为任务。“降低 30%”仍是目标，不会作为已有结果展示。</p></div>}
  </main>
}
