/**
 * MaterialsCollector — 素材采集面板
 * 三种模式：搜索引擎（Serper/Bing/SearXNG）/ URL 解析（Jina）/ 手动粘贴
 * 搜索结果支持「读取全文」（单条 & 批量），采集后一键追加到 materials.md
 */
import { useState } from 'react'
import {
  Link, Search, ClipboardPaste, Plus, Check,
  Loader2, ExternalLink, ChevronDown, ChevronUp, AlertCircle,
  Calendar, X, BookOpen, Globe,
} from 'lucide-react'
import { toast } from '../Toast/Toast'
import './MaterialsCollector.css'

interface SearchResult {
  title:   string
  snippet: string
  url:     string
  source:  string
  engine?: string
}

interface CollectedItem {
  id:           string
  type:         'url' | 'search' | 'paste'
  title:        string
  content:      string
  url?:         string
  source?:      string
  selected:     boolean
  expanded:     boolean
  dateTag:      string    // 可选时间标签，格式 YYYY-MM-DD 或空字符串
  fetching?:    boolean   // 正在读取全文
  fullFetched?: boolean   // 已读取全文
}

interface Props {
  articleId:      string
  searchApiKey:   string
  searchProvider: 'serper' | 'bing' | 'searxng'
  searchEngine:   string
  searxngUrl?:    string
  jinaApiKey?:    string
  onSaved?:       () => void
}

let _idCounter = 0
function nextId() { return String(++_idCounter) }

/** 格式化日期显示 */
function formatDateTag(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return dateStr
  }
}

export default function MaterialsCollector({
  articleId,
  searchApiKey,
  searchProvider,
  searchEngine,
  searxngUrl,
  jinaApiKey,
  onSaved,
}: Props) {
  const [mode, setMode]               = useState<'url' | 'search' | 'paste'>('search')
  const [urlInput, setUrlInput]       = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [pasteText, setPasteText]     = useState('')
  const [pasteTitle, setPasteTitle]   = useState('')
  const [loading, setLoading]         = useState(false)
  const [saving, setSaving]           = useState(false)
  const [batchFetching, setBatchFetching] = useState(false)
  const [items, setItems]             = useState<CollectedItem[]>([])

  // 新增素材时的默认时间（可以不填）
  const [defaultDateTag, setDefaultDateTag] = useState('')

  // 是否可以使用搜索（SearXNG 不需要 key）
  const canSearch = searchProvider === 'searxng' || !!searchApiKey

  // ── 工具：带鉴权的 fetch ───────────────────────────────────────────────────
  function authFetch(url: string, options: RequestInit = {}) {
    const token = localStorage.getItem('auth_token')
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers as Record<string, string> || {}),
      },
    })
  }

  // ── URL 解析 ──────────────────────────────────────────────────────────────
  async function handleFetchUrl() {
    const url = urlInput.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) {
      toast.error('请输入完整的 URL（以 http:// 或 https:// 开头）')
      return
    }
    setLoading(true)
    try {
      const res  = await authFetch('/api/materials/fetch-url', {
        method:  'POST',
        body:    JSON.stringify({ url, jinaApiKey: jinaApiKey || '' }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const hostname = new URL(url).hostname
      const firstLine = data.content.split('\n').find((l: string) => l.trim()) || hostname
      const title = firstLine.replace(/^#+\s*/, '').slice(0, 80)

      setItems(prev => [{
        id:          nextId(),
        type:        'url',
        title,
        content:     data.content,
        url,
        source:      hostname,
        selected:    true,
        expanded:    false,
        dateTag:     defaultDateTag,
        fullFetched: true,
      }, ...prev])
      setUrlInput('')
      toast.success('页面解析成功')
    } catch (e: unknown) {
      toast.error('解析失败：' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // ── 搜索 ──────────────────────────────────────────────────────────────────
  async function handleSearch() {
    const query = searchQuery.trim()
    if (!query) return
    if (!canSearch) {
      toast.error('未配置搜索 API Key，请先在「AI 配置」页面填写，或切换到 SearXNG（免费）')
      return
    }
    setLoading(true)
    try {
      const body: Record<string, unknown> = {
        query,
        provider:   searchProvider,
        engine:     searchEngine,
        num:        10,
      }
      if (searchProvider === 'searxng') {
        body.searxngUrl = searxngUrl || ''
      } else {
        body.apiKey = searchApiKey
      }

      const res  = await authFetch('/api/materials/search', {
        method:  'POST',
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const results: SearchResult[] = data.results || []
      if (results.length === 0) {
        toast.warn('没有搜索到相关结果')
        return
      }

      const newItems: CollectedItem[] = results.map(r => ({
        id:          nextId(),
        type:        'search' as const,
        title:       r.title,
        content:     r.snippet,
        url:         r.url,
        source:      r.source,
        selected:    false,
        expanded:    false,
        dateTag:     defaultDateTag,
        fullFetched: false,
      }))
      setItems(prev => [...newItems, ...prev])
      toast.success(`找到 ${results.length} 条结果，点击「读全文」可获取完整内容`)
    } catch (e: unknown) {
      toast.error('搜索失败：' + (e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  // ── 单条读取全文 ─────────────────────────────────────────────────────────
  async function handleFetchFullText(id: string, url: string) {
    // 标记 fetching
    setItems(prev => prev.map(it => it.id === id ? { ...it, fetching: true } : it))
    try {
      const res  = await authFetch('/api/materials/fetch-url', {
        method:  'POST',
        body:    JSON.stringify({ url, jinaApiKey: jinaApiKey || '' }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      // 用全文替换摘要，并自动勾选
      setItems(prev => prev.map(it =>
        it.id === id
          ? { ...it, content: data.content, fetching: false, fullFetched: true, selected: true, expanded: false }
          : it
      ))
      const methodTip = data.method === 'direct' ? '（直接抓取，部分动态页面内容可能不完整）' : ''
      toast.success(`全文读取成功${methodTip}`)
    } catch (e: unknown) {
      setItems(prev => prev.map(it => it.id === id ? { ...it, fetching: false } : it))
      const msg = (e as Error).message
      const tip = msg.includes('fetch failed') || msg.includes('超时')
        ? '网络连接失败，请检查服务器网络是否正常'
        : msg
      toast.error('读取失败：' + tip)
    }
  }

  // ── 批量读取全文（已选中且未读全文的 search 条目）────────────────────────
  async function handleBatchFetchFullText() {
    const targets = items.filter(it => it.selected && it.type === 'search' && !it.fullFetched && it.url)
    if (targets.length === 0) {
      toast.warn('没有可以读取全文的搜索结果（请先勾选搜索结果条目）')
      return
    }

    setBatchFetching(true)
    // 标记所有目标为 fetching
    setItems(prev => prev.map(it =>
      targets.find(t => t.id === it.id) ? { ...it, fetching: true } : it
    ))

    try {
      const res  = await authFetch('/api/materials/fetch-url-batch', {
        method:  'POST',
        body:    JSON.stringify({ urls: targets.map(t => t.url), jinaApiKey: jinaApiKey || '' }),
      })
      const data = await res.json()
      const results: { url: string; content: string; ok: boolean; error?: string }[] = data.results || []

      // 按 url 匹配，更新内容
      setItems(prev => prev.map(it => {
        const found = results.find(r => r.url === it.url)
        if (!found) return it
        if (found.ok && found.content) {
          return { ...it, content: found.content, fetching: false, fullFetched: true }
        }
        return { ...it, fetching: false }
      }))

      const successCount = results.filter(r => r.ok && r.content).length
      const failCount    = results.length - successCount
      if (failCount > 0) {
        toast.warn(`${successCount} 条成功，${failCount} 条读取失败（部分网站限制访问）`)
      } else {
        toast.success(`批量读取完成，共 ${successCount} 条`)
      }
    } catch (e: unknown) {
      // 失败时清除所有 fetching 状态
      setItems(prev => prev.map(it => ({ ...it, fetching: false })))
      toast.error('批量读取失败：' + (e as Error).message)
    } finally {
      setBatchFetching(false)
    }
  }

  // ── 手动粘贴 ────────────────────────────────────────────────────────────
  function handleAddPaste() {
    const content = pasteText.trim()
    if (!content) return
    const title = pasteTitle.trim() || '手动添加的素材'
    setItems(prev => [{
      id:       nextId(),
      type:     'paste',
      title,
      content,
      selected: true,
      expanded: false,
      dateTag:  defaultDateTag,
    }, ...prev])
    setPasteText('')
    setPasteTitle('')
    toast.success('素材已添加')
  }

  // ── 切换选中 ────────────────────────────────────────────────────────────
  function toggleSelect(id: string) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, selected: !it.selected } : it))
  }

  function toggleExpand(id: string) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, expanded: !it.expanded } : it))
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(it => it.id !== id))
  }

  function setItemDateTag(id: string, dateTag: string) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, dateTag } : it))
  }

  function selectAll()   { setItems(prev => prev.map(it => ({ ...it, selected: true  }))) }
  function selectNone()  { setItems(prev => prev.map(it => ({ ...it, selected: false }))) }

  // ── 统计 ─────────────────────────────────────────────────────────────────
  const selectedCount   = items.filter(it => it.selected).length
  const canBatchFetch   = items.some(it => it.selected && it.type === 'search' && !it.fullFetched && it.url)

  // ── 入库 ────────────────────────────────────────────────────────────────
  async function handleSave() {
    const selected = items.filter(it => it.selected)
    if (selected.length === 0) {
      toast.warn('请先勾选要保存的素材')
      return
    }
    setSaving(true)
    try {
      // 按时间标签分组：有时间的按时间分组，没有时间的归到「无时间标签」组
      const groups = new Map<string, CollectedItem[]>()

      for (const item of selected) {
        const key = item.dateTag || '__no_date__'
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(item)
      }

      // 生成最终素材文本
      const parts: string[] = []

      // 先输出有时间标签的（按日期升序）
      const dateKeys = [...groups.keys()]
        .filter(k => k !== '__no_date__')
        .sort()

      for (const dateKey of dateKeys) {
        const groupItems = groups.get(dateKey)!
        parts.push(`\n## 📅 ${formatDateTag(dateKey)}`)
        for (const it of groupItems) {
          const header = it.url
            ? `### ${it.title}\n> 来源：${it.source || it.url}  \n> URL：${it.url}`
            : `### ${it.title}`
          parts.push(`${header}\n\n${it.content}`)
        }
      }

      // 再输出无时间标签的
      if (groups.has('__no_date__')) {
        const noDateItems = groups.get('__no_date__')!
        for (const it of noDateItems) {
          const header = it.url
            ? `### ${it.title}\n> 来源：${it.source || it.url}  \n> URL：${it.url}`
            : `### ${it.title}`
          parts.push(`${header}\n\n${it.content}`)
        }
      }

      const content = parts.join('\n\n')

      const res  = await authFetch(`/api/materials/${articleId}/save`, {
        method:  'POST',
        body:    JSON.stringify({ content, mode: 'append' }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      // 移除已保存的条目
      setItems(prev => prev.filter(it => !it.selected))
      toast.success(`${selected.length} 条素材已写入 materials.md`)
      onSaved?.()
    } catch (e: unknown) {
      toast.error('保存失败：' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mc-root">

      {/* ── 默认时间标签 ── */}
      <div className="mc-date-bar">
        <Calendar size={13} className="mc-date-icon" />
        <span className="mc-date-label">素材时间</span>
        <input
          type="date"
          className="mc-date-input"
          value={defaultDateTag}
          onChange={e => setDefaultDateTag(e.target.value)}
          title="为新采集的素材设置时间标签（可选）"
        />
        {defaultDateTag && (
          <button
            className="mc-date-clear"
            onClick={() => setDefaultDateTag('')}
            title="清除时间"
          >
            <X size={11} />
          </button>
        )}
        <span className="mc-date-hint">
          {defaultDateTag ? `新素材将标注 ${formatDateTag(defaultDateTag)}` : '不填则不标注时间'}
        </span>
      </div>

      {/* ── 模式切换 ── */}
      <div className="mc-mode-tabs">
        {([
          ['search', <Search size={13} />,         '搜索采集'],
          ['url',    <Link size={13} />,            'URL 解析'],
          ['paste',  <ClipboardPaste size={13} />,  '手动粘贴'],
        ] as [typeof mode, React.ReactNode, string][]).map(([id, icon, label]) => (
          <button
            key={id}
            className={`mc-mode-tab${mode === id ? ' mc-mode-tab--active' : ''}`}
            onClick={() => setMode(id)}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* ── 输入区 ── */}
      <div className="mc-input-area">

        {mode === 'search' && (
          <div className="mc-search-wrap">
            <div className="mc-search-row">
              <input
                className="mc-input"
                placeholder={
                  searchProvider === 'searxng'
                    ? '输入关键词，SearXNG 聚合搜索（免费）'
                    : canSearch
                    ? '输入关键词，如：AI 效率工具 2025'
                    : '请先在「AI 配置」页面填写搜索 API Key'
                }
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) handleSearch() }}
                disabled={loading || !canSearch}
              />
              <button
                className="mc-btn mc-btn--primary"
                onClick={handleSearch}
                disabled={loading || !searchQuery.trim() || !canSearch}
              >
                {loading ? <Loader2 size={14} className="mc-spin" /> : <Search size={14} />}
                {loading ? '搜索中...' : '搜索'}
              </button>
            </div>
            {/* 搜索状态提示 */}
            {searchProvider === 'searxng' ? (
              <div className="mc-search-tip mc-search-tip--free">
                <Globe size={12} />
                SearXNG 聚合搜索，无需 API Key — 搜索后点击「读全文」获取完整内容
              </div>
            ) : !searchApiKey ? (
              <div className="mc-search-tip mc-search-tip--warn">
                <AlertCircle size={12} />
                未配置搜索 Key —— 可在「AI 配置」切换到 SearXNG（免费）方案
              </div>
            ) : (
              <div className="mc-search-tip mc-search-tip--hint">
                <BookOpen size={12} />
                搜索结果仅含摘要，点击「读全文」可获取完整正文
              </div>
            )}
          </div>
        )}

        {mode === 'url' && (
          <div className="mc-url-row">
            <input
              className="mc-input mc-input--mono"
              placeholder="粘贴网页 URL，如 https://mp.weixin.qq.com/..."
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !loading) handleFetchUrl() }}
              disabled={loading}
            />
            <button
              className="mc-btn mc-btn--primary"
              onClick={handleFetchUrl}
              disabled={loading || !urlInput.trim()}
            >
              {loading ? <Loader2 size={14} className="mc-spin" /> : <Link size={14} />}
              {loading ? '解析中...' : '解析'}
            </button>
          </div>
        )}

        {mode === 'paste' && (
          <div className="mc-paste-area">
            <input
              className="mc-input"
              placeholder="素材标题（选填）"
              value={pasteTitle}
              onChange={e => setPasteTitle(e.target.value)}
            />
            <textarea
              className="mc-textarea"
              placeholder="粘贴素材内容：小红书笔记文字、微信文章摘录、数据报告内容……"
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={5}
            />
            <button
              className="mc-btn mc-btn--primary"
              onClick={handleAddPaste}
              disabled={!pasteText.trim()}
            >
              <Plus size={14} />
              添加到列表
            </button>
          </div>
        )}
      </div>

      {/* ── 素材列表 ── */}
      {items.length > 0 && (
        <div className="mc-list-area">
          <div className="mc-list-header">
            <span className="mc-list-count">
              共 {items.length} 条，已选 {selectedCount} 条
            </span>
            <div className="mc-list-actions">
              <button className="mc-link-btn" onClick={selectAll}>全选</button>
              <button className="mc-link-btn" onClick={selectNone}>取消</button>
              {canBatchFetch && (
                <button
                  className={`mc-btn mc-btn--fetch${batchFetching ? ' mc-btn--loading' : ''}`}
                  onClick={handleBatchFetchFullText}
                  disabled={batchFetching}
                  title="批量读取已选搜索结果的完整正文"
                >
                  {batchFetching
                    ? <><Loader2 size={13} className="mc-spin" />读取中...</>
                    : <><BookOpen size={13} />批量读全文</>
                  }
                </button>
              )}
              <button
                className={`mc-btn mc-btn--save${saving ? ' mc-btn--loading' : ''}`}
                onClick={handleSave}
                disabled={saving || selectedCount === 0}
              >
                {saving
                  ? <><Loader2 size={13} className="mc-spin" />保存中...</>
                  : <><Check size={13} />写入素材库（{selectedCount}）</>
                }
              </button>
            </div>
          </div>

          <div className="mc-item-list">
            {items.map(item => (
              <div
                key={item.id}
                className={`mc-item${item.selected ? ' mc-item--selected' : ''} mc-item--${item.type}${item.fullFetched && item.type === 'search' ? ' mc-item--full' : ''}`}
              >
                <div className="mc-item-header">
                  <label className="mc-item-check">
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => toggleSelect(item.id)}
                    />
                    <span className={`mc-item-type-badge mc-badge--${item.type}`}>
                      {item.type === 'url'    && <Link size={11} />}
                      {item.type === 'search' && <Search size={11} />}
                      {item.type === 'paste'  && <ClipboardPaste size={11} />}
                      {item.source || (item.type === 'paste' ? '粘贴' : item.type)}
                    </span>
                    {/* 全文标记 */}
                    {item.type === 'search' && item.fullFetched && (
                      <span className="mc-full-badge">全文</span>
                    )}
                    <span className="mc-item-title">{item.title}</span>
                  </label>
                  <div className="mc-item-ops">
                    {/* 时间标签 */}
                    <div className="mc-item-date-wrap" title="设置素材时间（可选）">
                      {item.dateTag ? (
                        <span className="mc-item-date-tag">
                          <Calendar size={10} />
                          {formatDateTag(item.dateTag)}
                          <button
                            className="mc-item-date-clear"
                            onClick={() => setItemDateTag(item.id, '')}
                            title="清除时间"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      ) : (
                        <input
                          type="date"
                          className="mc-item-date-input"
                          value=""
                          onChange={e => setItemDateTag(item.id, e.target.value)}
                          title="设置时间（可选）"
                        />
                      )}
                    </div>

                    {/* 读取全文按钮（仅 search 类型且未读全文时显示） */}
                    {item.type === 'search' && !item.fullFetched && item.url && (
                      <button
                        className="mc-fetch-btn"
                        onClick={() => handleFetchFullText(item.id, item.url!)}
                        disabled={item.fetching}
                        title="用 Jina Reader 读取完整正文"
                      >
                        {item.fetching
                          ? <Loader2 size={12} className="mc-spin" />
                          : <BookOpen size={12} />
                        }
                        {item.fetching ? '读取中' : '读全文'}
                      </button>
                    )}

                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mc-icon-btn"
                        title="在新标签打开"
                      >
                        <ExternalLink size={13} />
                      </a>
                    )}
                    <button
                      className="mc-icon-btn"
                      onClick={() => toggleExpand(item.id)}
                      title={item.expanded ? '收起' : '展开内容'}
                    >
                      {item.expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <button
                      className="mc-icon-btn mc-icon-btn--del"
                      onClick={() => removeItem(item.id)}
                      title="移除"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {item.expanded && (
                  <div className="mc-item-content">
                    <pre className="mc-item-pre">{item.content}</pre>
                  </div>
                )}

                {!item.expanded && (
                  <div className="mc-item-snippet">
                    {item.content
                      ? <>{item.content.slice(0, 200).replace(/\n/g, ' ')}{item.content.length > 200 && '...'}</>
                      : <span className="mc-snippet-empty">暂无摘要，点击「读全文」获取正文</span>
                    }
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="mc-empty">
          {mode === 'search' && (
            <div className="mc-empty-inner">
              <Search size={28} className="mc-empty-icon" />
              <p>输入关键词搜索，获取摘要后可点击「读全文」获取完整内容</p>
              {searchProvider === 'searxng' && (
                <span className="mc-empty-badge">SearXNG 免费搜索已启用</span>
              )}
            </div>
          )}
          {mode === 'url' && (
            <div className="mc-empty-inner">
              <Link size={28} className="mc-empty-icon" />
              <p>输入网页链接，Jina AI 会自动提取正文</p>
            </div>
          )}
          {mode === 'paste' && (
            <div className="mc-empty-inner">
              <ClipboardPaste size={28} className="mc-empty-icon" />
              <p>粘贴任意文本内容，如小红书笔记、公众号摘录</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
