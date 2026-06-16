/**
 * MaterialsCollector — 素材采集面板
 * 三种模式：URL 解析（Jina）/ 搜索引擎（Serper/Bing）/ 手动粘贴
 * 采集结果可勾选后一键追加到 materials.md
 * 支持为每条素材指定时间标签（可选）
 */
import { useState } from 'react'
import {
  Link, Search, ClipboardPaste, Plus, Check,
  Loader2, ExternalLink, ChevronDown, ChevronUp, AlertCircle, Calendar, X,
} from 'lucide-react'
import { toast } from './Toast'
import './MaterialsCollector.css'

interface SearchResult {
  title:   string
  snippet: string
  url:     string
  source:  string
}

interface CollectedItem {
  id:       string
  type:     'url' | 'search' | 'paste'
  title:    string
  content:  string
  url?:     string
  source?:  string
  selected: boolean
  expanded: boolean
  dateTag:  string   // 可选时间标签，格式 YYYY-MM-DD 或空字符串
}

interface Props {
  articleId: string
  searchApiKey: string
  searchProvider: 'serper' | 'bing'
  searchEngine: string
  onSaved?: () => void
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
  onSaved,
}: Props) {
  const [mode, setMode]             = useState<'url' | 'search' | 'paste'>('search')
  const [urlInput, setUrlInput]     = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [pasteText, setPasteText]   = useState('')
  const [pasteTitle, setPasteTitle] = useState('')
  const [loading, setLoading]       = useState(false)
  const [saving, setSaving]         = useState(false)
  const [items, setItems]           = useState<CollectedItem[]>([])

  // 新增素材时的默认时间（可以不填）
  const [defaultDateTag, setDefaultDateTag] = useState('')

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
      const res  = await fetch('/api/materials/fetch-url', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const hostname = new URL(url).hostname
      const firstLine = data.content.split('\n').find((l: string) => l.trim()) || hostname
      const title = firstLine.replace(/^#+\s*/, '').slice(0, 80)

      setItems(prev => [{
        id:       nextId(),
        type:     'url',
        title,
        content:  data.content,
        url,
        source:   hostname,
        selected: true,
        expanded: false,
        dateTag:  defaultDateTag,
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
    if (!searchApiKey) {
      toast.error('未配置搜索 API Key，请先在「AI 配置」页面填写')
      return
    }
    setLoading(true)
    try {
      const res  = await fetch('/api/materials/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          query,
          provider: searchProvider,
          apiKey:   searchApiKey,
          engine:   searchEngine,
          num:      10,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const results: SearchResult[] = data.results || []
      if (results.length === 0) {
        toast.warn('没有搜索到相关结果')
        return
      }

      const newItems: CollectedItem[] = results.map(r => ({
        id:       nextId(),
        type:     'search' as const,
        title:    r.title,
        content:  r.snippet,
        url:      r.url,
        source:   r.source,
        selected: false,
        expanded: false,
        dateTag:  defaultDateTag,
      }))
      setItems(prev => [...newItems, ...prev])
      toast.success(`找到 ${results.length} 条结果`)
    } catch (e: unknown) {
      toast.error('搜索失败：' + (e as Error).message)
    } finally {
      setLoading(false)
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

      const res  = await fetch(`/api/materials/${articleId}/save`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
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

  const selectedCount = items.filter(it => it.selected).length

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
          <div className="mc-search-row">
            <input
              className="mc-input"
              placeholder={searchApiKey ? '输入关键词，如：AI 效率工具 2025' : '请先在「AI 配置」页面填写搜索 API Key'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !loading) handleSearch() }}
              disabled={loading || !searchApiKey}
            />
            <button
              className="mc-btn mc-btn--primary"
              onClick={handleSearch}
              disabled={loading || !searchQuery.trim() || !searchApiKey}
            >
              {loading ? <Loader2 size={14} className="mc-spin" /> : <Search size={14} />}
              {loading ? '搜索中...' : '搜索'}
            </button>
            {!searchApiKey && (
              <div className="mc-warn-inline">
                <AlertCircle size={13} />
                未配置搜索 Key
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
                className={`mc-item${item.selected ? ' mc-item--selected' : ''} mc-item--${item.type}`}
              >
                <div className="mc-item-header">
                  <label className="mc-item-check">
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => toggleSelect(item.id)}
                    />
                    <span className="mc-item-type-badge mc-badge--${item.type}">
                      {item.type === 'url'    && <Link size={11} />}
                      {item.type === 'search' && <Search size={11} />}
                      {item.type === 'paste'  && <ClipboardPaste size={11} />}
                      {item.source || (item.type === 'paste' ? '粘贴' : item.type)}
                    </span>
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

                {!item.expanded && item.content && (
                  <div className="mc-item-snippet">
                    {item.content.slice(0, 200).replace(/\n/g, ' ')}
                    {item.content.length > 200 && '...'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="mc-empty">
          {mode === 'search' && <p>输入关键词搜索，结果会出现在这里</p>}
          {mode === 'url'    && <p>输入网页链接，Jina AI 会自动提取正文</p>}
          {mode === 'paste'  && <p>粘贴任意文本内容，如小红书笔记、公众号摘录</p>}
        </div>
      )}
    </div>
  )
}
