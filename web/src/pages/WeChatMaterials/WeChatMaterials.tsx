import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Eye,
  FileImage,
  FileText,
  Loader2,
  Music2,
  RefreshCw,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { toast } from '../../components/Toast/Toast'
import { fetchBlob, fetchJson } from '../../utils/apiHelpers'
import './WeChatMaterials.css'

type MaterialType = 'image' | 'voice' | 'video' | 'news'
type UploadMaterialType = 'image' | 'voice' | 'video'

interface MaterialNewsItem {
  title?: string
  author?: string
  digest?: string
  content?: string
  url?: string
  content_source_url?: string
  thumb_media_id?: string
  thumb_url?: string
}

interface WechatMaterialItem {
  media_id: string
  name?: string
  url?: string
  update_time: number
  content?: {
    news_item?: MaterialNewsItem[]
  }
}

interface MaterialDetail {
  media_id: string
  type: MaterialType
  news_item?: MaterialNewsItem[]
  title?: string
  description?: string
  down_url?: string
  content_type?: string
  size?: number
  file_url?: string
}

const WX_STORAGE_KEY = 'wechat_credentials'
const PAGE_SIZE = 20

function getWxHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem(WX_STORAGE_KEY)
    if (!raw) return {}
    const { appId, appSecret } = JSON.parse(raw)
    if (!appId || !appSecret) return {}
    return { 'X-Wx-AppId': appId, 'X-Wx-AppSecret': appSecret }
  } catch {
    return {}
  }
}

function hasWxCreds(): boolean {
  try {
    const raw = localStorage.getItem(WX_STORAGE_KEY)
    if (!raw) return false
    const { appId, appSecret } = JSON.parse(raw)
    return !!(appId && appSecret)
  } catch {
    return false
  }
}

function wxImg(url: string | null | undefined): string | null {
  if (!url) return null
  return `/api/wechat/proxy-img?url=${encodeURIComponent(url)}`
}

function formatTime(ts: number): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatSize(size?: number): string {
  if (!size) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
}

function uploadAccept(type: UploadMaterialType): string {
  if (type === 'image') return 'image/*'
  if (type === 'voice') return '.mp3,.wma,.wav,.amr,audio/*'
  return '.mp4,video/mp4'
}

async function copyText(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMessage)
  } catch {
    toast.warn('复制失败，请手动复制')
  }
}

export default function WeChatMaterials() {
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [bound, setBound] = useState<boolean | null>(null)
  const [materialType, setMaterialType] = useState<MaterialType>('image')
  const [items, setItems] = useState<WechatMaterialItem[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const [detail, setDetail] = useState<MaterialDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailFileUrl, setDetailFileUrl] = useState<string | null>(null)
  const [detailFileLoading, setDetailFileLoading] = useState(false)

  const [uploadType, setUploadType] = useState<UploadMaterialType>('image')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadIntroduction, setUploadIntroduction] = useState('')
  const [uploading, setUploading] = useState(false)

  const revokeDetailFileUrl = useCallback(() => {
    setDetailFileUrl(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }, [])

  useEffect(() => {
    setBound(hasWxCreds())
  }, [])

  useEffect(() => revokeDetailFileUrl, [revokeDetailFileUrl])

  const fetchMaterials = useCallback(async (nextOffset = 0, replace = false) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchJson<{
        items?: WechatMaterialItem[]
        total_count?: number
        item_count?: number
      }>(
        `/api/wechat/materials?type=${materialType}&offset=${nextOffset}&count=${PAGE_SIZE}`,
        { headers: getWxHeaders() },
      )
      setItems(prev => (replace || nextOffset === 0 ? (data.items ?? []) : [...prev, ...(data.items ?? [])]))
      setTotal(data.total_count ?? 0)
      setOffset(nextOffset + (data.item_count ?? 0))
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setLoading(false)
    }
  }, [materialType])

  useEffect(() => {
    if (!bound) return
    setItems([])
    setOffset(0)
    setTotal(0)
    fetchMaterials(0, true)
  }, [bound, materialType, fetchMaterials])

  const openDetail = useCallback(async (item: WechatMaterialItem) => {
    setDetailLoading(true)
    setDetailError(null)
    setDetail(null)
    setDetailFileLoading(false)
    revokeDetailFileUrl()
    try {
      const data = await fetchJson<MaterialDetail>(`/api/wechat/material/${item.media_id}?type=${materialType}`, {
        headers: getWxHeaders(),
      })
      setDetail(data)
      if (data.file_url && (data.type === 'image' || data.type === 'voice')) {
        setDetailFileLoading(true)
        try {
          const blob = await fetchBlob(data.file_url, { headers: getWxHeaders() })
          setDetailFileUrl(URL.createObjectURL(blob))
        } catch (err) {
          setDetailError(err instanceof Error ? err.message : '加载文件失败')
        } finally {
          setDetailFileLoading(false)
        }
      }
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '获取详情失败')
    } finally {
      setDetailLoading(false)
    }
  }, [materialType, revokeDetailFileUrl])

  const handleDelete = useCallback(async (item: WechatMaterialItem) => {
    if (!window.confirm(`确定删除素材「${item.name || item.content?.news_item?.[0]?.title || item.media_id}」？`)) return
    setDeleting(item.media_id)
    try {
      await fetchJson(`/api/wechat/material/${item.media_id}`, {
        method: 'DELETE',
        headers: getWxHeaders(),
      })
      setItems(prev => prev.filter(entry => entry.media_id !== item.media_id))
      setTotal(prev => Math.max(0, prev - 1))
      setDetail(prev => {
        if (prev?.media_id === item.media_id) {
          revokeDetailFileUrl()
          return null
        }
        return prev
      })
      toast.success('素材已删除')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(null)
    }
  }, [revokeDetailFileUrl])

  const handleUpload = useCallback(async () => {
    if (!uploadFile) {
      toast.warn('请先选择要上传的文件')
      return
    }

    setUploading(true)
    try {
      const form = new FormData()
      form.append('media', uploadFile)
      form.append('type', uploadType)
      if (uploadType === 'video') {
        form.append('title', uploadTitle.trim())
        form.append('introduction', uploadIntroduction.trim())
      }

      const data = await fetchJson<{ media_id: string }>('/api/wechat/material/upload', {
        method: 'POST',
        headers: getWxHeaders(),
        body: form,
      })

      toast.success(`素材上传成功：${data.media_id}`)
      setUploadFile(null)
      setUploadTitle('')
      setUploadIntroduction('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (materialType === uploadType) {
        fetchMaterials(0, true)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }, [fetchMaterials, materialType, uploadFile, uploadIntroduction, uploadTitle, uploadType])

  const typeMeta = useMemo(() => ({
    image: { label: '图片素材', icon: FileImage, empty: '暂无图片素材' },
    voice: { label: '音频素材', icon: Music2, empty: '暂无音频素材' },
    video: { label: '视频素材', icon: Video, empty: '暂无视频素材' },
    news: { label: '图文素材', icon: FileText, empty: '暂无图文素材' },
  }), [])

  if (bound === false) {
    return (
      <div className="wm-page">
        <header className="wm-header">
          <button className="wm-back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={14} />
            返回
          </button>
          <div className="wm-header-title">公众号素材管理</div>
        </header>
        <div className="wm-empty-state">
          <div className="wm-empty-icon"><FileImage size={36} /></div>
          <h2>尚未绑定公众号</h2>
          <p>先去「AI 配置」里绑定公众号凭据，再回来管理素材。</p>
          <button className="wm-primary-btn" onClick={() => navigate('/settings')}>前往绑定</button>
        </div>
      </div>
    )
  }

  const EmptyIcon = typeMeta[materialType].icon
  const canOpenDetailFile = !!detailFileUrl && !detailFileLoading

  return (
    <div className="wm-page">
      <header className="wm-header">
        <div className="wm-header-left">
          <button className="wm-back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={14} />
            返回
          </button>
          <div>
            <div className="wm-header-title">公众号素材管理</div>
            <div className="wm-header-subtitle">上传、查看、复制、删除永久素材，支持图片 / 音频 / 视频 / 图文</div>
          </div>
        </div>
        <div className="wm-header-actions">
          <button className="wm-secondary-btn" onClick={() => navigate('/drafts')}>
            草稿箱
          </button>
          <button className="wm-secondary-btn" disabled={loading} onClick={() => fetchMaterials(0, true)}>
            <RefreshCw size={14} className={loading ? 'wm-spin' : ''} />
            刷新
          </button>
        </div>
      </header>

      <section className="wm-hero">
        <div className="wm-hero-card wm-hero-card--teal">
          <div className="wm-kicker">Material Hub</div>
          <h2>统一管理公众号永久素材</h2>
          <p>适合集中维护封面图、视频、音频与公众号后台已有的图文素材。</p>
        </div>
        <div className="wm-hero-card wm-hero-card--peach">
          <div className="wm-kicker">Upload</div>
          <h2>直接上传到微信素材库</h2>
          <p>上传成功后立即返回 `media_id`，可直接用于封面或后续发布链路。</p>
        </div>
      </section>

      <section className="wm-toolbar">
        <div className="wm-type-tabs">
          {(Object.keys(typeMeta) as MaterialType[]).map(type => {
            const Icon = typeMeta[type].icon
            return (
              <button
                key={type}
                className={`wm-type-tab ${materialType === type ? 'is-active' : ''}`}
                onClick={() => setMaterialType(type)}
              >
                <Icon size={14} />
                {typeMeta[type].label}
              </button>
            )
          })}
        </div>
        <div className="wm-toolbar-meta">
          {total > 0 ? `共 ${total} 个素材` : '当前暂无素材'}
        </div>
      </section>

      <section className="wm-upload-panel">
        <div className="wm-section-title">上传永久素材</div>
        <div className="wm-upload-grid">
          <label className="wm-field">
            <span>素材类型</span>
            <select value={uploadType} onChange={e => setUploadType(e.target.value as UploadMaterialType)}>
              <option value="image">图片</option>
              <option value="voice">音频</option>
              <option value="video">视频</option>
            </select>
          </label>
          <label className="wm-field">
            <span>选择文件</span>
            <input
              ref={fileInputRef}
              type="file"
              accept={uploadAccept(uploadType)}
              onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="wm-field">
            <span>视频标题</span>
            <input
              type="text"
              disabled={uploadType !== 'video'}
              value={uploadTitle}
              onChange={e => setUploadTitle(e.target.value)}
              placeholder="仅视频素材需要"
            />
          </label>
          <label className="wm-field">
            <span>视频简介</span>
            <input
              type="text"
              disabled={uploadType !== 'video'}
              value={uploadIntroduction}
              onChange={e => setUploadIntroduction(e.target.value)}
              placeholder="仅视频素材需要"
            />
          </label>
        </div>
        <div className="wm-upload-footer">
          <div className="wm-upload-hint">
            {uploadFile ? `已选择：${uploadFile.name}` : '支持上传图片 / 音频 / 视频到公众号永久素材库'}
          </div>
          <button className="wm-primary-btn" disabled={uploading} onClick={handleUpload}>
            {uploading ? <Loader2 size={14} className="wm-spin" /> : <Upload size={14} />}
            {uploading ? '上传中...' : '上传素材'}
          </button>
        </div>
      </section>

      {error && (
        <div className="wm-error-bar">
          <span>{error}</span>
          <button onClick={() => fetchMaterials(0, true)}>重试</button>
        </div>
      )}

      <section className="wm-content-grid">
        <div className="wm-list-panel">
          <div className="wm-section-title">素材列表</div>
          {loading && items.length === 0 ? (
            <div className="wm-loading">
              <Loader2 size={18} className="wm-spin" />
              <span>正在拉取素材...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="wm-empty-card">
              <div className="wm-empty-icon"><EmptyIcon size={28} /></div>
              <h3>{typeMeta[materialType].empty}</h3>
              <p>可以先在上方上传，或去公众号后台创建后回来查看。</p>
            </div>
          ) : materialType === 'image' ? (
            <div className="wm-image-grid">
              {items.map(item => (
                <article key={item.media_id} className="wm-image-card">
                  <div className="wm-image-frame">
                    {item.url ? (
                      <img src={wxImg(item.url) || item.url} alt={item.name || item.media_id} loading="lazy" />
                    ) : (
                      <div className="wm-image-placeholder"><FileImage size={20} /></div>
                    )}
                  </div>
                  <div className="wm-card-body">
                    <div className="wm-card-title" title={item.name || item.media_id}>{item.name || '未命名图片'}</div>
                    <div className="wm-card-meta">{formatTime(item.update_time)}</div>
                    <div className="wm-card-actions">
                      <button onClick={() => openDetail(item)}><Eye size={13} />详情</button>
                      <button onClick={() => copyText(item.media_id, '已复制 media_id')}><Copy size={13} />复制 ID</button>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noreferrer"><ExternalLink size={13} />原图</a>
                      )}
                      <button className="danger" disabled={deleting === item.media_id} onClick={() => handleDelete(item)}>
                        {deleting === item.media_id ? <Loader2 size={13} className="wm-spin" /> : <Trash2 size={13} />}
                        删除
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="wm-list">
              {items.map(item => {
                const firstNews = item.content?.news_item?.[0]
                const title = materialType === 'news' ? firstNews?.title || '未命名图文' : item.name || '未命名素材'
                const subtitle = materialType === 'news'
                  ? `${item.content?.news_item?.length ?? 0} 篇文章`
                  : formatTime(item.update_time)
                return (
                  <article key={item.media_id} className="wm-list-card">
                    <div className="wm-list-main">
                      <div className="wm-list-title">{title}</div>
                      <div className="wm-list-subtitle">{subtitle}</div>
                      {firstNews?.digest && (
                        <div className="wm-list-digest">{firstNews.digest}</div>
                      )}
                    </div>
                    <div className="wm-card-actions">
                      <button onClick={() => openDetail(item)}><Eye size={13} />详情</button>
                      <button onClick={() => copyText(item.media_id, '已复制 media_id')}><Copy size={13} />复制 ID</button>
                      <button className="danger" disabled={deleting === item.media_id} onClick={() => handleDelete(item)}>
                        {deleting === item.media_id ? <Loader2 size={13} className="wm-spin" /> : <Trash2 size={13} />}
                        删除
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          {items.length < total && (
            <div className="wm-load-more">
              <button className="wm-secondary-btn" disabled={loading} onClick={() => fetchMaterials(offset, false)}>
                {loading ? <Loader2 size={14} className="wm-spin" /> : null}
                加载更多
              </button>
            </div>
          )}
        </div>

        <aside className="wm-detail-panel">
          <div className="wm-detail-header">
            <div className="wm-section-title">素材详情</div>
            {detail && (
                <button className="wm-icon-btn" onClick={() => { setDetail(null); setDetailError(null); revokeDetailFileUrl() }}>
                  <X size={14} />
                </button>
            )}
          </div>

          {detailLoading ? (
            <div className="wm-loading">
              <Loader2 size={18} className="wm-spin" />
              <span>正在加载详情...</span>
            </div>
          ) : detailError ? (
            <div className="wm-empty-card">
              <h3>详情加载失败</h3>
              <p>{detailError}</p>
            </div>
          ) : !detail ? (
            <div className="wm-empty-card">
              <h3>选择一个素材</h3>
              <p>点击左侧任意素材查看详情、复制标识或打开原始链接。</p>
            </div>
          ) : (
            <div className="wm-detail-body">
              <div className="wm-detail-row">
                <span>素材类型</span>
                <strong>{typeMeta[detail.type].label}</strong>
              </div>
              <div className="wm-detail-row">
                <span>Media ID</span>
                <code>{detail.media_id}</code>
              </div>
              <div className="wm-detail-actions">
                <button onClick={() => copyText(detail.media_id, '已复制 media_id')}>
                  <Copy size={13} />
                  复制 media_id
                </button>
                {(detail.type === 'image' || detail.type === 'voice') && (
                  <button
                    disabled={!canOpenDetailFile}
                    onClick={() => {
                      if (!detailFileUrl) return
                      window.open(detailFileUrl, '_blank', 'noopener,noreferrer')
                    }}
                  >
                    {detailFileLoading ? <Loader2 size={13} className="wm-spin" /> : <ExternalLink size={13} />}
                    {detailFileLoading ? '加载文件...' : '打开文件'}
                  </button>
                )}
                {detail.down_url && (
                  <a href={detail.down_url} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} />
                    下载视频
                  </a>
                )}
              </div>

              {detail.type === 'image' || detail.type === 'voice' ? (
                <div className="wm-detail-card">
                  <div className="wm-detail-row">
                    <span>内容类型</span>
                    <strong>{detail.content_type || '—'}</strong>
                  </div>
                  <div className="wm-detail-row">
                    <span>文件大小</span>
                    <strong>{formatSize(detail.size)}</strong>
                  </div>
                  {detailFileLoading && (
                    <div className="wm-loading">
                      <Loader2 size={18} className="wm-spin" />
                      <span>正在加载素材文件...</span>
                    </div>
                  )}
                  {detailFileUrl && detail.type === 'image' && (
                    <img className="wm-detail-preview" src={detailFileUrl} alt="素材详情" />
                  )}
                  {detailFileUrl && detail.type === 'voice' && (
                    <audio className="wm-audio-player" controls src={detailFileUrl} />
                  )}
                </div>
              ) : null}

              {detail.type === 'video' ? (
                <div className="wm-detail-card">
                  <div className="wm-detail-row">
                    <span>标题</span>
                    <strong>{detail.title || '—'}</strong>
                  </div>
                  <div className="wm-detail-row">
                    <span>描述</span>
                    <strong>{detail.description || '—'}</strong>
                  </div>
                </div>
              ) : null}

              {detail.type === 'news' ? (
                <div className="wm-news-list">
                  {(detail.news_item ?? []).map((entry, index) => (
                    <article key={`${detail.media_id}-${index}`} className="wm-news-card">
                      <div className="wm-news-title">{entry.title || `图文 ${index + 1}`}</div>
                      <div className="wm-news-meta">
                        <span>作者：{entry.author || '—'}</span>
                        {entry.url ? (
                          <a href={entry.url} target="_blank" rel="noreferrer">查看文章</a>
                        ) : null}
                      </div>
                      {entry.thumb_url ? (
                        <img className="wm-news-thumb" src={wxImg(entry.thumb_url) || entry.thumb_url} alt={entry.title || '封面'} />
                      ) : null}
                      {entry.digest ? <p className="wm-news-digest">{entry.digest}</p> : null}
                      {entry.content_source_url ? (
                        <a className="wm-news-link" href={entry.content_source_url} target="_blank" rel="noreferrer">
                          阅读原文
                        </a>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </section>
    </div>
  )
}