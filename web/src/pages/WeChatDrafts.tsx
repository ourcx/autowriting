import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, RefreshCw, FileText, Clock, Layers,
  ExternalLink, Link2, Download, Loader2, Trash2,
  Send, Image, BookOpen, BarChart2, ChevronRight,
} from 'lucide-react'
import { toast } from '../components/Toast'
import './WeChatDrafts.css'

/* ── HTML → Markdown（导入用）── */
function htmlToMarkdown(html: string): string {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
    const el  = node as HTMLElement
    const tag = el.tagName?.toLowerCase()
    const ch  = Array.from(el.childNodes).map(walk).join('')
    if (!ch.trim()) return ''
    if (['h1','h2','h3','h4'].includes(tag)) return `\n${'#'.repeat(parseInt(tag[1]))} ${ch.trim()}\n`
    if (tag === 'p' || tag === 'section') return `\n${ch.trim()}\n`
    if (tag === 'li')   return `- ${ch.trim()}\n`
    if (tag === 'br')   return '\n'
    if (tag === 'strong' || tag === 'b') return `**${ch}**`
    if (tag === 'em'    || tag === 'i')  return `*${ch}*`
    return ch
  }
  return walk(tmp).replace(/\n{3,}/g, '\n\n').trim()
}

/* ── 微信图片通过服务端代理访问（绕过防盗链）── */
function wxImg(url: string | null | undefined): string | null {
  if (!url) return null
  return `/api/wechat/proxy-img?url=${encodeURIComponent(url)}`
}

/* ── 类型定义 ── */
interface DraftItem {
  media_id:    string
  update_time: number
  title:       string
  digest:      string
  thumb_url:   string | null
  url:         string | null
  count:       number
}

interface PublishedItem {
  article_id:  string
  update_time: number
  title:       string
  digest:      string
  thumb_url:   string | null
  url:         string | null
  count:       number
}

interface MaterialItem {
  media_id:    string
  name:        string
  update_time: number
  url:         string
}

interface ArticleStat {
  title:     string
  url:       string | null
  read_num:  number
  share_num: number
  date:      string
}

type TabId = 'drafts' | 'published' | 'materials'

const PAGE_SIZE = 10

function formatTime(ts: number): string {
  if (!ts) return '—'
  const d    = new Date(ts * 1000)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000)     return '刚刚'
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 604_800_000)return `${Math.floor(diff / 86_400_000)} 天前`
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', year: 'numeric' })
}


/* ══════════════════════════════════════════════
   主组件
══════════════════════════════════════════════ */
export default function WeChatDrafts() {
  const navigate = useNavigate()
  const [tab, setTab]   = useState<TabId>('drafts')
  const [bound, setBound] = useState<boolean | null>(null)

  /* ── 草稿箱 state ── */
  const [drafts,       setDrafts]       = useState<DraftItem[]>([])
  const [draftTotal,   setDraftTotal]   = useState(0)
  const [draftOffset,  setDraftOffset]  = useState(0)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError,   setDraftError]   = useState<string | null>(null)
  const [importing,    setImporting]    = useState<string | null>(null)
  const [deleting,     setDeleting]     = useState<string | null>(null)
  const [publishing,   setPublishing]   = useState<string | null>(null)

  /* ── 已发布 state ── */
  const [pubItems,      setPubItems]      = useState<PublishedItem[]>([])
  const [pubTotal,      setPubTotal]      = useState(0)
  const [pubOffset,     setPubOffset]     = useState(0)
  const [pubLoading,    setPubLoading]    = useState(false)
  const [pubError,      setPubError]      = useState<string | null>(null)
  const [pubNoAuth,     setPubNoAuth]     = useState(false)   // 48001 权限不足
  const [pubLoaded,     setPubLoaded]     = useState(false)
  const [statsMap,      setStatsMap]      = useState<Record<string, ArticleStat>>({})
  const [statsLoading,  setStatsLoading]  = useState(false)

  /* ── 素材库 state ── */
  const [matItems,   setMatItems]   = useState<MaterialItem[]>([])
  const [matTotal,   setMatTotal]   = useState(0)
  const [matOffset,  setMatOffset]  = useState(0)
  const [matLoading, setMatLoading] = useState(false)
  const [matError,   setMatError]   = useState<string | null>(null)
  const [matLoaded,  setMatLoaded]  = useState(false)
  const [matDeleting,setMatDeleting]= useState<string | null>(null)
  const [matType,    setMatType]    = useState<'image'|'voice'|'video'>('image')
  const prevMatType = useRef(matType)

  /* ── 绑定状态检查 ── */
  useEffect(() => {
    fetch('/api/wechat/status')
      .then(r => r.json())
      .then(d => setBound(d.bound))
      .catch(() => setBound(false))
  }, [])

  /* ══ 草稿箱 ══ */
  const fetchDrafts = useCallback(async (off: number) => {
    setDraftLoading(true)
    setDraftError(null)
    try {
      const r = await fetch(`/api/wechat/drafts?offset=${off}&count=${PAGE_SIZE}`)
      const d = await r.json()
      if (!r.ok) { setDraftError(d.error ?? '拉取失败'); return }
      if (off === 0) setDrafts(d.items)
      else           setDrafts(prev => [...prev, ...d.items])
      setDraftTotal(d.total_count)
      setDraftOffset(off + d.item_count)
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : '网络错误')
    } finally { setDraftLoading(false) }
  }, [])

  useEffect(() => { if (bound) fetchDrafts(0) }, [bound, fetchDrafts])

  /* 导入 */
  const handleImport = async (item: DraftItem) => {
    if (importing) return
    setImporting(item.media_id)
    try {
      const r = await fetch(`/api/wechat/draft/${item.media_id}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? '获取失败')
      const mdContent = d.content ? htmlToMarkdown(d.content) : ''
      const dateStr   = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const slug      = item.title.replace(/[^\w\u4e00-\u9fff]/g, '').substring(0, 20)
      const articleId = `${dateStr}-${slug || Date.now()}`
      const token     = localStorage.getItem('auth_token')
      const saveR = await fetch(`/api/articles/${articleId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          title: item.title,
          task: `# 从微信草稿箱导入\n\n原草稿标题：${item.title}`,
          materials: '',
          article: mdContent,
        }),
      })
      if (!saveR.ok) throw new Error('创建文章失败')
      toast.success(`「${item.title}」已导入编辑器`)
      navigate(`/editor/${articleId}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败')
    } finally { setImporting(null) }
  }

  /* 删除草稿 */
  const handleDeleteDraft = async (item: DraftItem) => {
    if (!confirm(`确定删除草稿「${item.title}」？此操作不可撤销。`)) return
    setDeleting(item.media_id)
    try {
      const r = await fetch(`/api/wechat/draft/${item.media_id}`, { method: 'DELETE' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? '删除失败')
      setDrafts(prev => prev.filter(x => x.media_id !== item.media_id))
      setDraftTotal(t => t - 1)
      toast.success(`草稿「${item.title}」已删除`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    } finally { setDeleting(null) }
  }

  /* 发布草稿 */
  const handlePublishDraft = async (item: DraftItem) => {
    if (!confirm(`确定将「${item.title}」发布到公众号？发布后将对所有关注者可见。`)) return
    setPublishing(item.media_id)
    try {
      const r = await fetch(`/api/wechat/draft/${item.media_id}/publish`, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? '发布失败')
      toast.success(`「${item.title}」已提交发布，稍后在「已发布」Tab 查看`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '发布失败')
    } finally { setPublishing(null) }
  }

  /* ══ 已发布文章 ══ */
  const fetchPublished = useCallback(async (off: number) => {
    setPubLoading(true)
    setPubError(null)
    setPubNoAuth(false)
    try {
      const r = await fetch(`/api/wechat/published?offset=${off}&count=${PAGE_SIZE}`)
      const d = await r.json()
      if (!r.ok) {
        // 48001 = api unauthorized：账号没有 freepublish 权限（需认证服务号）
        if (d.errcode === 48001 || String(d.error ?? '').includes('48001')) {
          setPubNoAuth(true)
        } else {
          setPubError(d.error ?? '拉取失败')
        }
        return
      }
      if (off === 0) setPubItems(d.items)
      else           setPubItems(prev => [...prev, ...d.items])
      setPubTotal(d.total_count)
      setPubOffset(off + d.item_count)
      setPubLoaded(true)
    } catch (e) {
      setPubError(e instanceof Error ? e.message : '网络错误')
    } finally { setPubLoading(false) }
  }, [])

  /* 阅读统计 */
  const fetchStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const r = await fetch('/api/wechat/article-stats')
      const d = await r.json()
      if (!r.ok) return
      const map: Record<string, ArticleStat> = {}
      for (const a of (d.articles ?? [])) {
        if (a.title) map[a.title] = a
      }
      setStatsMap(map)
    } catch { /* 统计接口报错不影响主功能 */ }
    finally { setStatsLoading(false) }
  }, [])

  useEffect(() => {
    if (tab === 'published' && bound && !pubLoaded) {
      fetchPublished(0)
      fetchStats()
    }
  }, [tab, bound, pubLoaded, fetchPublished, fetchStats])

  /* ══ 素材库 ══ */
  const fetchMaterials = useCallback(async (off: number, type: string) => {
    setMatLoading(true)
    setMatError(null)
    try {
      const r = await fetch(`/api/wechat/materials?type=${type}&offset=${off}&count=20`)
      const d = await r.json()
      if (!r.ok) { setMatError(d.error ?? '拉取失败'); return }
      if (off === 0) setMatItems(d.items)
      else           setMatItems(prev => [...prev, ...d.items])
      setMatTotal(d.total_count)
      setMatOffset(off + d.item_count)
      setMatLoaded(true)
    } catch (e) {
      setMatError(e instanceof Error ? e.message : '网络错误')
    } finally { setMatLoading(false) }
  }, [])

  useEffect(() => {
    if (tab === 'materials' && bound) {
      if (!matLoaded || prevMatType.current !== matType) {
        prevMatType.current = matType
        setMatLoaded(false)
        setMatItems([])
        setMatOffset(0)
        fetchMaterials(0, matType)
      }
    }
  }, [tab, bound, matType, matLoaded, fetchMaterials])

  const handleDeleteMaterial = async (item: MaterialItem) => {
    if (!confirm(`确定删除素材「${item.name}」？此操作不可撤销。`)) return
    setMatDeleting(item.media_id)
    try {
      const r = await fetch(`/api/wechat/material/${item.media_id}`, { method: 'DELETE' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? '删除失败')
      setMatItems(prev => prev.filter(x => x.media_id !== item.media_id))
      setMatTotal(t => t - 1)
      toast.success(`素材「${item.name}」已删除`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    } finally { setMatDeleting(null) }
  }

  /* ── 未绑定 ── */
  if (bound === false) {
    return (
      <div className="wd-root">
        <header className="wd-header">
          <button className="wd-back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={14} />返回
          </button>
          <span className="wd-header-title">公众号</span>
        </header>
        <div className="wd-empty">
          <div className="wd-empty-icon"><Link2 size={36} /></div>
          <p className="wd-empty-title">尚未绑定公众号</p>
          <p className="wd-empty-desc">前往「API 配置 → 公众号绑定」完成绑定后，即可查看草稿箱和已发布文章</p>
          <button className="wd-goto-btn" onClick={() => navigate('/settings')}>前往配置</button>
        </div>
      </div>
    )
  }

  /* ── Tab 内容 ── */
  const tabs = [
    { id: 'drafts'    as TabId, label: '草稿箱',   icon: FileText, count: draftTotal },
    { id: 'published' as TabId, label: '已发布',   icon: BookOpen, count: pubTotal },
    { id: 'materials' as TabId, label: '素材库',   icon: Image,    count: matTotal },
  ]

  return (
    <div className="wd-root">

      {/* ── Header ── */}
      <header className="wd-header">
        <button className="wd-back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} />返回
        </button>
        <div className="wd-header-center">
          <span className="wd-header-title">公众号管理</span>
        </div>
        <button
          className="wd-refresh-btn"
          title="刷新"
          disabled={draftLoading || pubLoading || matLoading}
          onClick={() => {
            if (tab === 'drafts')    { setDraftOffset(0); fetchDrafts(0) }
            if (tab === 'published') { setPubLoaded(false); setPubOffset(0) }
            if (tab === 'materials') { setMatLoaded(false); setMatOffset(0) }
          }}
        >
          <RefreshCw size={14} className={(draftLoading || pubLoading || matLoading) ? 'wd-spin' : ''} />
        </button>
      </header>

      {/* ── Tabs ── */}
      <div className="wd-tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`wd-tab${tab === t.id ? ' wd-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={14} />
            {t.label}
            {t.count > 0 && (
              <span className="wd-tab-count">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════
          草稿箱 Tab
      ════════════════════════════════════════ */}
      {tab === 'drafts' && (
        <>
          {draftError && (
            <div className="wd-error-bar">
              {draftError}
              <button onClick={() => fetchDrafts(0)}>重试</button>
            </div>
          )}
          {draftLoading && drafts.length === 0 && (
            <div className="wd-loading"><div className="wd-spinner" /><p>拉取草稿箱...</p></div>
          )}
          {!draftLoading && !draftError && drafts.length === 0 && (
            <div className="wd-empty">
              <div className="wd-empty-icon"><FileText size={36} /></div>
              <p className="wd-empty-title">草稿箱是空的</p>
              <p className="wd-empty-desc">在文章预览页点击「推送草稿」，内容会出现在这里</p>
            </div>
          )}
          {drafts.length > 0 && (
            <main className="wd-main">
              <div className="wd-list">
                {drafts.map(item => (
                  <div key={item.media_id} className="wd-card">
                    <div className="wd-card-thumb">
                      {item.thumb_url
                        ? <img src={wxImg(item.thumb_url)!} alt="封面" />
                        : <div className="wd-card-thumb-placeholder"><FileText size={18} /></div>
                      }
                    </div>
                    <div className="wd-card-body">
                      <div className="wd-card-title">{item.title}</div>
                      {item.digest && <div className="wd-card-digest">{item.digest}</div>}
                      <div className="wd-card-meta">
                        <span className="wd-card-time"><Clock size={11} />{formatTime(item.update_time)}</span>
                        {item.count > 1 && (
                          <span className="wd-card-multi"><Layers size={11} />{item.count} 篇图文</span>
                        )}
                      </div>
                    </div>
                    <div className="wd-card-actions">
                      {/* 导入编辑 */}
                      <button
                        className="wd-btn wd-btn--import"
                        disabled={!!importing || !!deleting || !!publishing}
                        onClick={() => handleImport(item)}
                        title="导入到编辑器"
                      >
                        {importing === item.media_id
                          ? <Loader2 size={12} className="wd-spin" />
                          : <Download size={12} />
                        }
                        导入编辑
                      </button>
                      {/* 发布 */}
                      <button
                        className="wd-btn wd-btn--publish"
                        disabled={!!importing || !!deleting || !!publishing}
                        onClick={() => handlePublishDraft(item)}
                        title="发布到公众号"
                      >
                        {publishing === item.media_id
                          ? <Loader2 size={12} className="wd-spin" />
                          : <Send size={12} />
                        }
                        发布
                      </button>
                      {/* 预览 */}
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="wd-btn wd-btn--preview"
                          title="在微信中预览"
                        >
                          <ExternalLink size={12} />
                          预览
                        </a>
                      )}
                      {/* 删除 */}
                      <button
                        className="wd-btn wd-btn--delete"
                        disabled={!!importing || !!deleting || !!publishing}
                        onClick={() => handleDeleteDraft(item)}
                        title="删除草稿"
                      >
                        {deleting === item.media_id
                          ? <Loader2 size={12} className="wd-spin" />
                          : <Trash2 size={12} />
                        }
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {drafts.length < draftTotal && (
                <div className="wd-load-more">
                  <button
                    className="wd-load-more-btn"
                    onClick={() => fetchDrafts(draftOffset)}
                    disabled={draftLoading}
                  >
                    {draftLoading
                      ? <><div className="wd-spinner wd-spinner--sm" />加载中...</>
                      : `加载更多（还有 ${draftTotal - drafts.length} 篇）`
                    }
                  </button>
                </div>
              )}
            </main>
          )}
        </>
      )}

      {/* ════════════════════════════════════════
          已发布 Tab
      ════════════════════════════════════════ */}
      {tab === 'published' && (
        <>
          {/* 48001 权限不足 — 优雅降级提示 */}
          {pubNoAuth && (
            <div className="wd-empty">
              <div className="wd-empty-icon"><BookOpen size={36} /></div>
              <p className="wd-empty-title">当前账号没有「已发布」查询权限</p>
              <p className="wd-empty-desc">
                微信 <code>freepublish/batchget</code> 接口仅对<strong>已认证服务号</strong>开放，
                订阅号或未认证服务号无法使用此功能。
                草稿箱及素材库不受影响，可正常使用。
              </p>
            </div>
          )}
          {pubError && !pubNoAuth && (
            <div className="wd-error-bar">
              {pubError}
              <button onClick={() => { setPubLoaded(false); fetchPublished(0) }}>重试</button>
            </div>
          )}
          {pubLoading && pubItems.length === 0 && (
            <div className="wd-loading"><div className="wd-spinner" /><p>拉取已发布文章...</p></div>
          )}
          {!pubLoading && !pubError && !pubNoAuth && pubItems.length === 0 && pubLoaded && (
            <div className="wd-empty">
              <div className="wd-empty-icon"><BookOpen size={36} /></div>
              <p className="wd-empty-title">还没有已发布的文章</p>
              <p className="wd-empty-desc">从草稿箱点击「发布」，文章将出现在这里</p>
            </div>
          )}
          {pubItems.length > 0 && (
            <main className="wd-main">
              {/* 阅读统计摘要 */}
              {!statsLoading && Object.keys(statsMap).length > 0 && (
                <div className="wd-stats-banner">
                  <BarChart2 size={14} />
                  <span>近 7 天数据：</span>
                  {Object.values(statsMap).slice(0, 3).map(s => (
                    <span key={s.title} className="wd-stats-item">
                      「{s.title.substring(0, 10)}...」
                      <strong>{s.read_num.toLocaleString()}</strong> 阅读
                    </span>
                  ))}
                </div>
              )}
              <div className="wd-list">
                {pubItems.map(item => {
                  const stat = statsMap[item.title]
                  return (
                    <div key={item.article_id} className="wd-card">
                      <div className="wd-card-thumb">
                        {item.thumb_url
                          ? <img src={wxImg(item.thumb_url)!} alt="封面" />
                          : <div className="wd-card-thumb-placeholder"><BookOpen size={18} /></div>
                        }
                      </div>
                      <div className="wd-card-body">
                        <div className="wd-card-title">{item.title}</div>
                        {item.digest && <div className="wd-card-digest">{item.digest}</div>}
                        <div className="wd-card-meta">
                          <span className="wd-card-time"><Clock size={11} />{formatTime(item.update_time)}</span>
                          {item.count > 1 && (
                            <span className="wd-card-multi"><Layers size={11} />{item.count} 篇图文</span>
                          )}
                          {/* 阅读数徽章 */}
                          {stat && (
                            <span className="wd-card-reads">
                              <BarChart2 size={11} />
                              {stat.read_num.toLocaleString()} 阅读 · {stat.share_num} 分享
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="wd-card-actions">
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="wd-btn wd-btn--preview"
                          >
                            <ExternalLink size={12} />
                            查看原文
                          </a>
                        )}
                        <a
                          href={item.url ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="wd-btn wd-btn--import"
                          onClick={e => { if (!item.url) e.preventDefault() }}
                        >
                          <ChevronRight size={12} />
                          详情
                        </a>
                      </div>
                    </div>
                  )
                })}
              </div>
              {pubItems.length < pubTotal && (
                <div className="wd-load-more">
                  <button
                    className="wd-load-more-btn"
                    onClick={() => fetchPublished(pubOffset)}
                    disabled={pubLoading}
                  >
                    {pubLoading
                      ? <><div className="wd-spinner wd-spinner--sm" />加载中...</>
                      : `加载更多（还有 ${pubTotal - pubItems.length} 篇）`
                    }
                  </button>
                </div>
              )}
            </main>
          )}
        </>
      )}

      {/* ════════════════════════════════════════
          素材库 Tab
      ════════════════════════════════════════ */}
      {tab === 'materials' && (
        <>
          {/* 素材类型切换 */}
          <div className="wd-mat-toolbar">
            {(['image','voice','video'] as const).map(t => (
              <button
                key={t}
                className={`wd-mat-type-btn${matType === t ? ' wd-mat-type-btn--active' : ''}`}
                onClick={() => setMatType(t)}
              >
                {{ image: '图片', voice: '音频', video: '视频' }[t]}
              </button>
            ))}
            {matTotal > 0 && (
              <span className="wd-mat-total">共 {matTotal} 个素材</span>
            )}
          </div>

          {matError && (
            <div className="wd-error-bar">
              {matError}
              <button onClick={() => { setMatLoaded(false) }}>重试</button>
            </div>
          )}
          {matLoading && matItems.length === 0 && (
            <div className="wd-loading"><div className="wd-spinner" /><p>拉取素材库...</p></div>
          )}
          {!matLoading && !matError && matItems.length === 0 && matLoaded && (
            <div className="wd-empty">
              <div className="wd-empty-icon"><Image size={36} /></div>
              <p className="wd-empty-title">没有{({ image:'图片', voice:'音频', video:'视频' })[matType]}素材</p>
              <p className="wd-empty-desc">在公众号后台上传后会出现在这里</p>
            </div>
          )}

          {matItems.length > 0 && (
            <main className="wd-main">
              <div className={matType === 'image' ? 'wd-mat-grid' : 'wd-list'}>
                {matItems.map(item => (
                  matType === 'image' ? (
                    /* 图片网格 */
                    <div key={item.media_id} className="wd-mat-img-card">
                      <div className="wd-mat-img-wrap">
                        <img src={wxImg(item.url)!} alt={item.name} loading="lazy" />
                        <div className="wd-mat-img-overlay">
                          <button
                            className="wd-mat-del-btn"
                            onClick={() => handleDeleteMaterial(item)}
                            disabled={matDeleting === item.media_id}
                            title="删除素材"
                          >
                            {matDeleting === item.media_id
                              ? <Loader2 size={13} className="wd-spin" />
                              : <Trash2 size={13} />
                            }
                          </button>
                          <a href={item.url} target="_blank" rel="noreferrer" className="wd-mat-open-btn">
                            <ExternalLink size={13} />
                          </a>
                        </div>
                      </div>
                      <div className="wd-mat-img-name" title={item.name}>{item.name}</div>
                      <div className="wd-mat-img-time">{formatTime(item.update_time)}</div>
                    </div>
                  ) : (
                    /* 音频/视频列表 */
                    <div key={item.media_id} className="wd-card">
                      <div className="wd-card-thumb">
                        <div className="wd-card-thumb-placeholder">
                          {matType === 'voice' ? '🎵' : '🎬'}
                        </div>
                      </div>
                      <div className="wd-card-body">
                        <div className="wd-card-title">{item.name}</div>
                        <div className="wd-card-meta">
                          <span className="wd-card-time"><Clock size={11} />{formatTime(item.update_time)}</span>
                        </div>
                      </div>
                      <div className="wd-card-actions">
                        <button
                          className="wd-btn wd-btn--delete"
                          onClick={() => handleDeleteMaterial(item)}
                          disabled={matDeleting === item.media_id}
                          title="删除"
                        >
                          {matDeleting === item.media_id
                            ? <Loader2 size={12} className="wd-spin" />
                            : <Trash2 size={12} />
                          }
                        </button>
                      </div>
                    </div>
                  )
                ))}
              </div>

              {matItems.length < matTotal && (
                <div className="wd-load-more">
                  <button
                    className="wd-load-more-btn"
                    onClick={() => fetchMaterials(matOffset, matType)}
                    disabled={matLoading}
                  >
                    {matLoading
                      ? <><div className="wd-spinner wd-spinner--sm" />加载中...</>
                      : `加载更多（还有 ${matTotal - matItems.length} 个）`
                    }
                  </button>
                </div>
              )}
            </main>
          )}
        </>
      )}
    </div>
  )
}
