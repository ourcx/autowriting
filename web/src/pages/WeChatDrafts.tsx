import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw, FileText, Clock, Layers, ExternalLink, Link2 } from 'lucide-react'
import './WeChatDrafts.css'

interface DraftItem {
  media_id:    string
  update_time: number      // Unix 秒
  title:       string
  digest:      string
  thumb_url:   string | null
  url:         string | null
  count:       number      // 图文数量
}

interface DraftListResp {
  total_count: number
  item_count:  number
  items:       DraftItem[]
}

const PAGE_SIZE = 10

function formatTime(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60_000)     return '刚刚'
  if (diff < 3600_000)   return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000)  return `${Math.floor(diff / 3600_000)} 小时前`
  if (diff < 604800_000) return `${Math.floor(diff / 86400_000)} 天前`
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function WeChatDrafts() {
  const navigate = useNavigate()

  const [items, setItems]           = useState<DraftItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [offset, setOffset]         = useState(0)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [bound, setBound]           = useState<boolean | null>(null)

  // 检查公众号绑定状态
  useEffect(() => {
    fetch('/api/wechat/status')
      .then(r => r.json())
      .then(d => setBound(d.bound))
      .catch(() => setBound(false))
  }, [])

  const fetchDrafts = useCallback(async (off: number) => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/wechat/drafts?offset=${off}&count=${PAGE_SIZE}`)
      const d: DraftListResp & { error?: string } = await r.json()
      if (!r.ok) {
        setError(d.error ?? '拉取失败')
        return
      }
      if (off === 0) {
        setItems(d.items)
      } else {
        setItems(prev => [...prev, ...d.items])
      }
      setTotalCount(d.total_count)
      setOffset(off + d.item_count)
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (bound) fetchDrafts(0)
  }, [bound, fetchDrafts])

  const handleRefresh = () => {
    setOffset(0)
    fetchDrafts(0)
  }

  const handleLoadMore = () => {
    fetchDrafts(offset)
  }

  const hasMore = items.length < totalCount

  // ── 未绑定状态 ────────────────────────────────────────────────────────────
  if (bound === false) {
    return (
      <div className="wd-root">
        <header className="wd-header">
          <button className="wd-back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={15} />
            返回
          </button>
          <span className="wd-header-title">草稿箱</span>
        </header>
        <div className="wd-empty">
          <div className="wd-empty-icon"><Link2 size={32} /></div>
          <p className="wd-empty-title">尚未绑定公众号</p>
          <p className="wd-empty-desc">前往「API 配置 → 公众号绑定」完成绑定后，即可查看草稿箱</p>
          <button className="wd-goto-btn" onClick={() => navigate('/settings')}>
            前往配置
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="wd-root">
      {/* ── Header ── */}
      <header className="wd-header">
        <button className="wd-back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={15} />
          返回
        </button>
        <div className="wd-header-center">
          <span className="wd-header-title">草稿箱</span>
          {totalCount > 0 && (
            <span className="wd-header-count">{totalCount} 篇</span>
          )}
        </div>
        <button
          className="wd-refresh-btn"
          onClick={handleRefresh}
          disabled={loading}
          title="刷新"
        >
          <RefreshCw size={15} className={loading ? 'wd-spin' : ''} />
        </button>
      </header>

      {/* ── 错误提示 ── */}
      {error && (
        <div className="wd-error-bar">
          {error}
          <button onClick={handleRefresh}>重试</button>
        </div>
      )}

      {/* ── 加载中（首屏） ── */}
      {loading && items.length === 0 && (
        <div className="wd-loading">
          <div className="wd-spinner" />
          <p>拉取草稿箱...</p>
        </div>
      )}

      {/* ── 空状态 ── */}
      {!loading && !error && items.length === 0 && (
        <div className="wd-empty">
          <div className="wd-empty-icon"><FileText size={32} /></div>
          <p className="wd-empty-title">草稿箱是空的</p>
          <p className="wd-empty-desc">在文章预览页点击「推送草稿」，内容会出现在这里</p>
        </div>
      )}

      {/* ── 草稿列表 ── */}
      {items.length > 0 && (
        <main className="wd-main">
          <div className="wd-list">
            {items.map(item => (
              <div key={item.media_id} className="wd-card">
                {/* 封面图 */}
                <div className="wd-card-thumb">
                  {item.thumb_url
                    ? <img src={item.thumb_url} alt="封面" />
                    : <div className="wd-card-thumb-placeholder"><FileText size={20} /></div>
                  }
                </div>

                {/* 文字信息 */}
                <div className="wd-card-body">
                  <div className="wd-card-title">{item.title}</div>
                  {item.digest && (
                    <div className="wd-card-digest">{item.digest}</div>
                  )}
                  <div className="wd-card-meta">
                    <span className="wd-card-time">
                      <Clock size={12} />
                      {formatTime(item.update_time)}
                    </span>
                    {item.count > 1 && (
                      <span className="wd-card-multi">
                        <Layers size={12} />
                        {item.count} 篇图文
                      </span>
                    )}
                  </div>
                </div>

                {/* 操作 */}
                <div className="wd-card-actions">
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="wd-card-open-btn"
                      title="在微信中预览"
                    >
                      <ExternalLink size={14} />
                      预览
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 加载更多 */}
          {hasMore && (
            <div className="wd-load-more">
              <button
                className="wd-load-more-btn"
                onClick={handleLoadMore}
                disabled={loading}
              >
                {loading ? <><div className="wd-spinner wd-spinner--sm" />加载中...</> : `加载更多（还有 ${totalCount - items.length} 篇）`}
              </button>
            </div>
          )}
        </main>
      )}
    </div>
  )
}
