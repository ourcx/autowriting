import { normalizeWechatArticleUrl } from "../../../shared/wechatArticleUrl"
/**
 * MaterialsCollector — 素材采集面板
 * 网页搜索、公众号采集、链接、文件、调研、语音和手动粘贴
 * 搜索结果支持「读取全文」（单条 & 批量），采集后一键追加到 materials.md
 */
import { useEffect, useRef, useState } from 'react'
import {
  Link, Search, ClipboardPaste, Plus, Check,
  Loader2, ExternalLink, ChevronDown, ChevronUp, AlertCircle,
  Calendar, X, BookOpen, Globe, MessageCircle,
  Upload, Sparkles, Mic,
} from 'lucide-react'
import Button from '../Button/Button'
import { Checkbox, FilePicker, Input, Select, SelectField, Textarea } from "../FormControls/FormControls"
import { toast } from '../Toast/Toast'
import {
  deepSeekRequest,
  fetchDeepSeekMaterial,
  formatDeepSeekResearch,
  parseDeepSeekMaterial,
  searchDeepSeekMaterials,
  transcribeDeepSeekMaterial,
  type DeepSeekChatResponse,
  extractErrorMessage,
  fetchMaterialUrl,
  fetchMaterialUrls,
  fetchWechatArticle,
  parseMaterialFile,
  searchMaterials,
  searchWechatArticles,
  searchYuanbaoMaterials,
  type MaterialSearchResult,
  type WechatCollectorProvider,
  type WechatCollectorSort,
  type WechatCollectorTimeRange,
} from '../../utils/apiHelpers'
import './MaterialsCollector.css'

interface CollectedItem {
  id:           string
  type:         'url' | 'search' | 'wechat' | 'paste' | 'file'
  title:        string
  content:      string
  url?:         string
  source?:      string
  provider?:    WechatCollectorProvider
  useDeepSeekFetch?: boolean
  selected:     boolean
  expanded:     boolean
  dateTag:      string    // 可选时间标签，格式 YYYY-MM-DD 或空字符串
  fetching?:    boolean   // 正在读取全文
  fullFetched?: boolean   // 已读取全文
}

interface Props {
  articleId:      string
  searchApiKey:   string
  searchProvider: 'serper' | 'bing' | 'searxng' | 'zhipu' | 'deepseek'
  searchEngine:   string
  searxngUrl?:    string
  glmApiKey?:     string
  jinaApiKey?:    string
  wechatCollectorReady?: {
    yuanbao?: boolean
    tikhub: boolean
    dajiala: boolean
  }
  deepseekReady?: boolean
  onSave: (appendedContent: string) => Promise<void>
}

let _idCounter = 0
function nextId() { return String(++_idCounter) }

const RESEARCH_OPTIONS = [
  { key: 'thinking', label: '深度思考' },
  { key: 'webSearch', label: '联网搜索' },
  { key: 'readUrl', label: '阅读链接' },
] as const

const DEEPSEEK_DOCUMENT_EXTENSIONS = '.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff'

type WechatSearchSource = WechatCollectorProvider | 'yuanbao'

// 元宝文章未读到正文时，仍可选用摘要或链接，保存时标明状态。
function needsWechatArticleText(item: CollectedItem): boolean {
  return item.type === 'wechat' && !item.provider && !item.fullFetched
}

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
  glmApiKey,
  jinaApiKey,
  wechatCollectorReady = { tikhub: false, dajiala: false },
  deepseekReady = false,
  onSave,
}: Props) {
  const [mode, setMode]               = useState<'url' | 'search' | 'wechat' | 'paste' | 'file' | 'research' | 'audio'>('search')
  const [urlInput, setUrlInput]       = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [wechatQuery, setWechatQuery] = useState('')
  const [wechatProvider, setWechatProvider] = useState<WechatSearchSource>('yuanbao')
  const yuanbaoRequest = useRef<AbortController | null>(null)
  const [wechatSort, setWechatSort] = useState<WechatCollectorSort>('default')
  const [wechatPublishTime, setWechatPublishTime] = useState<WechatCollectorTimeRange>('all')
  const [pasteText, setPasteText]     = useState('')
  const [pasteTitle, setPasteTitle]   = useState('')
  const [loading, setLoading]         = useState(false)
  const [saving, setSaving]           = useState(false)
  const [batchFetching, setBatchFetching] = useState(false)
  const [items, setItems]             = useState<CollectedItem[]>([])
  const [parseMode, setParseMode]     = useState<'document' | 'handwriting'>('document')
  const [deepseekConsent, setDeepseekConsent] = useState(false)
  const [urlProvider, setUrlProvider] = useState<string>()
  const [fileProvider, setFileProvider] = useState<string>()
  const [ocrPurpose, setOcrPurpose] = useState<'text_recognition' | 'rich_layout_recognition'>('text_recognition')
  const [researchPrompt, setResearchPrompt] = useState('')
  const [researchFile, setResearchFile] = useState<File>()
  const [researchPurpose, setResearchPurpose] = useState('text_recognition')
  const [researchOptions, setResearchOptions] = useState({ thinking: true, webSearch: true, readUrl: true })
  const canUseDeepSeek = deepseekReady && deepseekConsent
  const deepSeekSearch = searchProvider === 'deepseek'
  const deepSeekFile = deepseekReady && (fileProvider ? fileProvider === 'deepseek' : deepSeekSearch)
  const wechatUrl = normalizeWechatArticleUrl(urlInput)
  const wechatReaders = [
    ...(wechatUrl && wechatCollectorReady.tikhub ? [{ value: 'tikhub', label: 'TikHub 公众号解析（付费）' }] : []),
    ...(wechatUrl && wechatCollectorReady.dajiala ? [{ value: 'dajiala', label: '极致了公众号解析（付费）' }] : []),
  ]
  const urlReaders = [{ value: 'web', label: wechatUrl ? '公众号原文直读' : '通用网页读取' },
    ...(deepseekReady ? [{ value: 'deepseek', label: 'DeepSeek Fetch' }] : []), ...wechatReaders]
  const selectedUrlReader = urlReaders.some(reader => reader.value === urlProvider)
    ? urlProvider
    : !wechatUrl && deepSeekSearch && deepseekReady ? 'deepseek' : 'web'
  const deepSeekUrl = selectedUrlReader === 'deepseek'

  // 新增素材时的默认时间（可以不填）
  const [defaultDateTag, setDefaultDateTag] = useState('')

  // 是否可以使用搜索（SearXNG 不需要 key）
  const canSearch = deepSeekSearch ? canUseDeepSeek : searchProvider === 'searxng'
    || (searchProvider === 'zhipu' ? !!(glmApiKey || searchApiKey) : !!searchApiKey)
  const usingYuanbao = wechatProvider === 'yuanbao'
  const yuanbaoAvailable = wechatCollectorReady.yuanbao !== false
  const canSearchWechat = usingYuanbao ? yuanbaoAvailable : wechatCollectorReady[wechatProvider]

  useEffect(() => () => yuanbaoRequest.current?.abort(), [articleId])

  function addDeepSeekItem(title: string, content: string, source: string) {
    if (!content.trim()) throw new Error('DeepSeek 未返回可用文本')
    setItems(prev => [{
      id: nextId(), type: 'file', title, content, source, selected: true, expanded: false,
      dateTag: defaultDateTag, fullFetched: true,
    }, ...prev])
  }

  async function handleTranscribe(file?: File) {
    if (!file || loading || !canUseDeepSeek) return
    setLoading(true)
    try {
      const { text } = await transcribeDeepSeekMaterial(file)
      addDeepSeekItem(file.name, text, 'DeepSeek 语音转文字')
    } catch (error) {
      toast.error(extractErrorMessage(error, '语音转文字失败'))
    } finally {
      setLoading(false)
    }
  }

  async function handleResearch() {
    const prompt = researchPrompt.trim()
    if (!prompt || loading || !canUseDeepSeek) return
    setLoading(true)
    try {
      const fields = {
        prompt, confirmedCost: true, ...researchOptions, purpose: researchPurpose,
      }
      let body: typeof fields | FormData = fields
      if (researchFile) {
        if (!researchFile.size || researchFile.size > 32 * 1024 * 1024) throw new Error('附件须为 1 字节至 32 MiB')
        const form = new FormData()
        for (const [key, value] of Object.entries(fields)) form.append(key, String(value))
        form.append('file', researchFile)
        body = form
      }
      const { content, annotations } = await deepSeekRequest<DeepSeekChatResponse>('chat', body)
      addDeepSeekItem(prompt.replace(/\s+/g, ' ').slice(0, 80), formatDeepSeekResearch(content, annotations), 'DeepSeek 调研')
    } catch (error) {
      toast.error(extractErrorMessage(error, 'DeepSeek 调研失败'))
    } finally {
      setLoading(false)
    }
  }

  async function handleParseFile(file: File | null) {
    if (!file || loading || (deepSeekFile ? !canUseDeepSeek : !glmApiKey)) return
    setLoading(true)
    try {
      if (deepSeekFile) {
        const { content } = await parseDeepSeekMaterial(file, ocrPurpose)
        addDeepSeekItem(file.name, content, 'DeepSeek OCR')
      } else {
        const data = await parseMaterialFile(file, parseMode, glmApiKey || '')
        setItems(prev => [{
          id: nextId(),
          type: 'file',
          title: data.title,
          content: data.content,
          source: parseMode === 'handwriting' ? '智谱手写 OCR' : '智谱文件解析',
          selected: true,
          expanded: false,
          dateTag: defaultDateTag,
          fullFetched: true,
        }, ...prev])
        toast.success(`已解析 ${data.title}`)
      }
    } catch (error: unknown) {
      toast.error(extractErrorMessage(error, '文件解析失败'))
    } finally {
      setLoading(false)
    }
  }

  // ── URL 解析 ──────────────────────────────────────────────────────────────
  async function handleFetchUrl() {
    const url = urlInput.trim()
    if (!url || loading || (deepSeekUrl && !canUseDeepSeek)) return
    if (!/^https?:\/\//i.test(url)) {
      toast.error('请输入完整的 URL（以 http:// 或 https:// 开头）')
      return
    }
    setLoading(true)
    try {
      const sourceUrl = wechatUrl || url
      const data = selectedUrlReader === 'tikhub' || selectedUrlReader === 'dajiala'
        ? await fetchWechatArticle({ provider: selectedUrlReader, url: sourceUrl })
        : deepSeekUrl ? await fetchDeepSeekMaterial(sourceUrl) : await fetchMaterialUrl(sourceUrl, jinaApiKey || '')

      const hostname = new URL(url).hostname
      const firstLine = data.content.split('\n').find((l: string) => l.trim()) || hostname
      const title = (('title' in data && data.title) || firstLine.replace(/^#+\s*/, '')).slice(0, 80)

      setItems(prev => [{
        id:          nextId(),
        type:        wechatUrl ? 'wechat' : 'url',
        title,
        content:     data.content,
        url:         sourceUrl,
        source:      'source' in data && typeof data.source === 'string' ? data.source : hostname,
        selected:    true,
        expanded:    false,
        dateTag:     defaultDateTag,
        fullFetched: true,
      }, ...prev])
      setUrlInput('')
      toast.success('页面解析成功')
    } catch (e: unknown) {
      toast.error(extractErrorMessage(e, '页面解析失败'))
    } finally {
      setLoading(false)
    }
  }

  // ── 搜索 ──────────────────────────────────────────────────────────────────
  async function handleSearch() {
    const query = searchQuery.trim()
    if (!query || loading) return
    if (!canSearch) {
      toast.error(deepSeekSearch ? '请确认 DeepSeek 使用说明后再搜索' : searchProvider === 'zhipu'
        ? '未配置智谱 API Key，请先在「AI 配置」页面填写'
        : '未配置搜索 API Key，请先在「AI 配置」页面填写，或切换到 SearXNG（免费）')
      return
    }
    setLoading(true)
    try {
      const results: MaterialSearchResult[] = deepSeekSearch
        ? await searchDeepSeekMaterials(query)
        : (await searchMaterials({
          query, provider: searchProvider, engine: searchEngine, num: 10,
          ...(searchProvider === 'searxng' ? { searxngUrl: searxngUrl || '' } : { apiKey: searchApiKey }),
          ...(searchProvider === 'zhipu' ? { glmApiKey: glmApiKey || searchApiKey } : {}),
        })).results || []
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
        dateTag:     r.datePublished?.slice(0, 10) || defaultDateTag,
        fullFetched: false,
        useDeepSeekFetch: deepSeekSearch,
      }))
      setItems(prev => [...newItems, ...prev])
      toast.success(`找到 ${results.length} 条结果，点击「读全文」可获取完整内容`)
    } catch (e: unknown) {
      toast.error('搜索失败：' + extractErrorMessage(e, '搜索服务暂时不可用，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }

  // ── 公众号文章搜索 ────────────────────────────────────────────────────────
  async function handleWechatSearch() {
    const query = wechatQuery.trim()
    if (!query || loading || !canSearchWechat) return
    if (wechatProvider === 'yuanbao') {
      await handleYuanbaoSearch(query)
      return
    }

    setLoading(true)
    try {
      const data = await searchWechatArticles({
        provider: wechatProvider,
        query,
        sort: wechatSort,
        publishTime: wechatPublishTime,
      })
      const existingUrls = new Set(items.map(item => item.url).filter(Boolean))
      const newItems: CollectedItem[] = data.results
        .filter(result => !existingUrls.has(result.url))
        .map(result => ({
          id: nextId(),
          type: 'wechat',
          title: result.title,
          content: result.snippet,
          url: result.url,
          source: result.source,
          provider: result.provider,
          selected: false,
          expanded: false,
          dateTag: result.publishedAt ? result.publishedAt.slice(0, 10) : defaultDateTag,
          fullFetched: false,
        }))

      if (newItems.length === 0) {
        toast.warn(data.results.length ? '搜索结果已在当前列表中' : '没有搜索到公众号文章')
        return
      }
      setItems(prev => [...newItems, ...prev])
      toast.success(`找到 ${newItems.length} 篇公众号文章`)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '公众号文章搜索失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleYuanbaoSearch(query: string) {
    if (yuanbaoRequest.current) return
    const controller = new AbortController()
    yuanbaoRequest.current = controller
    setLoading(true)
    try {
      const { answer, articles } = await searchYuanbaoMaterials(query, controller.signal)
      if (controller.signal.aborted) return
      const answerItem: CollectedItem = {
        id: nextId(), type: 'paste', title: '元宝 AI 回答', source: '元宝',
        content: answer, selected: false, expanded: false, dateTag: defaultDateTag,
      }
      const articleItems = articles.map((article): CollectedItem => ({
        id: nextId(),
        type: 'wechat',
        title: article.title,
        source: article.source,
        url: article.url,
        content: article.content || article.snippet,
        fullFetched: !!article.content,
        selected: false,
        expanded: false,
        dateTag: defaultDateTag || article.publishedOn || '',
      }))
      const articlesByUrl = new Map(articles.map(article => [article.url, article]))
      setItems(prev => {
        const existingUrls = new Set(prev.map(item => item.url))
        const refreshed = prev.map(item => {
          if (!item.url || !needsWechatArticleText(item)) return item
          const content = articlesByUrl.get(item.url)?.content
          return content ? { ...item, content, fullFetched: true } : item
        })
        const answerExists = prev.some(item => item.source === '元宝' && item.content === answer)
        return [
          ...(answerExists ? [] : [answerItem]),
          ...articleItems.filter(item => !existingUrls.has(item.url)),
          ...refreshed,
        ]
      })

      const parsedCount = articles.filter(article => article.content).length
      if (!articles.length) toast.warn('已取得元宝回答，未找到公众号原文')
      else if (parsedCount < articles.length) toast.success(`找到 ${articles.length} 篇公众号文章，${parsedCount} 篇有正文，其余可按线索加入`)
      else toast.success(`已解析 ${parsedCount} 篇公众号文章`)
    } catch (error: unknown) {
      if (!controller.signal.aborted) toast.error(extractErrorMessage(error, '元宝搜索失败，请稍后再试'))
    } finally {
      yuanbaoRequest.current = null
      setLoading(false)
    }
  }

  // ── 单条读取全文 ─────────────────────────────────────────────────────────
  async function handleFetchFullText(id: string, url: string) {
    const target = items.find(item => item.id === id)
    if (!target || target.fetching || (target.useDeepSeekFetch && !canUseDeepSeek)) return
    // 标记 fetching
    setItems(prev => prev.map(it => it.id === id ? { ...it, fetching: true } : it))
    try {
      const isYuanbaoArticle = needsWechatArticleText(target)
      let articleData: {
        title: string
        content: string
        source: string
        publishedAt: string
      }
      if (target.type === 'wechat' && target.provider) {
        articleData = await fetchWechatArticle({ provider: target.provider, url })
      } else if (target.useDeepSeekFetch) {
        const data = await fetchDeepSeekMaterial(url)
        articleData = { ...data, source: target.source || '', publishedAt: '' }
      } else {
        const data = await fetchMaterialUrl(url, jinaApiKey || '')
        articleData = {
          title: target.title,
          content: data.content,
          source: target.source || '',
          publishedAt: '',
        }
      }

      // 元宝解析结果先供预览，由用户决定是否勾选入库。
      setItems(prev => prev.map(it =>
        it.id === id
          ? {
              ...it,
              title: articleData.title || it.title,
              content: articleData.content,
              source: articleData.source || it.source,
              dateTag: articleData.publishedAt ? articleData.publishedAt.slice(0, 10) : it.dateTag,
              fetching: false,
              fullFetched: true,
              selected: isYuanbaoArticle ? it.selected : true,
              expanded: false,
            }
          : it
      ))
      toast.success(isYuanbaoArticle ? '已补齐公众号正文' : '全文读取成功')
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
    const targets = items.filter(it => it.selected && it.type === 'search' && !it.fullFetched && !it.fetching && !it.useDeepSeekFetch && it.url)
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
      const urls = targets.flatMap(target => target.url ? [target.url] : [])
      const data = await fetchMaterialUrls(urls, jinaApiKey || '')
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

  function selectAll()   { setItems(prev => prev.map(it => ({ ...it, selected: true }))) }
  function selectNone()  { setItems(prev => prev.map(it => ({ ...it, selected: false }))) }

  // ── 统计 ─────────────────────────────────────────────────────────────────
  const selectedCount   = items.filter(it => it.selected).length
  const canBatchFetch   = items.some(it => it.selected && it.type === 'search' && !it.fullFetched && !it.fetching && !it.useDeepSeekFetch && it.url)

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
        groups.get(key)?.push(item)
      }

      // 生成最终素材文本
      const parts: string[] = []

      // 先输出有时间标签的（按日期升序）
      const dateKeys = [...groups.keys()]
        .filter(k => k !== '__no_date__')
        .sort()

      for (const dateKey of dateKeys) {
        const groupItems = groups.get(dateKey) || []
        parts.push(`\n## 📅 ${formatDateTag(dateKey)}`)
        for (const it of groupItems) {
          const header = it.url
            ? `### ${it.title}\n> 来源：${it.source || it.url}  \n> URL：${it.url}`
            : `### ${it.title}${it.source ? `\n> 来源：${it.source}` : ''}`
          const body = needsWechatArticleText(it)
            ? it.content ? `> 元宝搜索摘要，原文未读\n\n${it.content}` : '> 仅保留原文链接，尚未读取正文'
            : it.content
          parts.push(`${header}\n\n${body}`)
        }
      }

      // 再输出无时间标签的
      if (groups.has('__no_date__')) {
        const noDateItems = groups.get('__no_date__') || []
        for (const it of noDateItems) {
          const header = it.url
            ? `### ${it.title}\n> 来源：${it.source || it.url}  \n> URL：${it.url}`
            : `### ${it.title}${it.source ? `\n> 来源：${it.source}` : ''}`
          const body = needsWechatArticleText(it)
            ? it.content ? `> 元宝搜索摘要，原文未读\n\n${it.content}` : '> 仅保留原文链接，尚未读取正文'
            : it.content
          parts.push(`${header}\n\n${body}`)
        }
      }

      const content = parts.join('\n\n')

      await onSave(content)

      // 移除已保存的条目
      const savedIds = new Set(selected.map(item => item.id))
      setItems(prev => prev.filter(it => !savedIds.has(it.id)))
      toast.success(`${selected.length} 条素材已写入 materials.md`)
    } catch (e: unknown) {
      toast.error('保存失败：' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mc-root">

      <div className="mc-toolbar">
        <div className="mc-mode-tabs" role="group" aria-label="采集方式">
          {([
            ['search', <Search size={14} />, '搜索采集'],
            ['wechat', <MessageCircle size={14} />, '公众号采集'],
            ['url', <Link size={14} />, 'URL 解析'],
            ['file', <Upload size={14} />, '文件 / OCR'],
            ...(deepseekReady ? [
              ['research', <Sparkles size={14} />, 'DeepSeek 调研'],
              ['audio', <Mic size={14} />, '语音转文字'],
            ] : []),
            ['paste', <ClipboardPaste size={14} />, '手动粘贴'],
          ] as [typeof mode, React.ReactNode, string][]).map(([id, icon, label]) => (
            <Button key={id} className="mc-mode-tab" aria-pressed={mode === id} disabled={loading}
              onClick={() => { setMode(id); if (id !== 'research') setResearchFile(undefined) }}>
              {icon}{label}
            </Button>
          ))}
        </div>
        <div className="mc-date-bar">
          <label className="mc-date-label">
            <Calendar size={14} aria-hidden="true" />
            素材时间
            <Input type="date" className="mc-date-input" value={defaultDateTag}
              onChange={e => setDefaultDateTag(e.target.value)} title="为新采集的素材设置时间标签（可选）" />
          </label>
          {defaultDateTag && <Button className="mc-date-clear" onClick={() => setDefaultDateTag('')} aria-label="清除时间"><X size={13} /></Button>}
          {!defaultDateTag && <span className="mc-date-hint">选填</span>}
        </div>
      </div>

      <div className="mc-input-area">
        {deepseekReady && mode !== 'research' && ((mode === 'search' && deepSeekSearch) || (mode === 'url' && deepSeekUrl)
          || (mode === 'file' && deepSeekFile) || mode === 'audio') && (
          <Checkbox className="mc-consent" checked={deepseekConsent} disabled={loading} onCheckedChange={setDeepseekConsent}>
            同意将主动提交的内容发送给 DeepSeek，并按调用计费
          </Checkbox>
        )}

        {mode === 'search' && (
          <div className="mc-search-wrap">
            <div className="mc-search-row">
              <Input
                className="mc-input"
                placeholder={
                  searchProvider === 'searxng'
                    ? '输入关键词，SearXNG 聚合搜索（免费）'
                    : deepSeekSearch ? '输入 DeepSeek 搜索词（最多 128 字符）'
                    : canSearch
                    ? '输入关键词，如：AI 效率工具 2025'
                    : '请先在「AI 配置」页面填写搜索 API Key'
                }
                aria-label="搜索关键词"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !loading) handleSearch() }}
                disabled={loading || !canSearch}
              />
              <Button variant="plain"
                className="mc-btn mc-btn--primary"
                onClick={handleSearch}
                disabled={loading || !searchQuery.trim() || !canSearch}
              >
                {loading ? <Loader2 size={14} className="mc-spin" /> : <Search size={14} />}
                {loading ? '搜索中...' : '搜索'}
              </Button>
            </div>
            {/* 搜索状态提示 */}
            {searchProvider === 'searxng' ? (
              <div className="mc-search-tip mc-search-tip--free">
                <Globe size={12} />
                SearXNG 聚合搜索，无需 API Key — 搜索后点击「读全文」获取完整内容
              </div>
            ) : deepSeekSearch ? (
              <div className="mc-search-tip mc-search-tip--hint">
                {deepseekReady ? 'DeepSeek 搜索 · 点击单条结果的「读全文」可读取原文' : '请在 AI 配置的「公共 Key」中配置 DeepSeek'}
              </div>
            ) : !canSearch ? (
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

        {mode === 'wechat' && (
          <div className="mc-wechat-search">
            <div className="mc-provider-toggle mc-provider-toggle--wechat" aria-label="公众号采集来源">
              {([
                ['yuanbao', '元宝 AI 搜索', yuanbaoAvailable ? '自动解析原文' : '服务端未启用'],
                ['tikhub', 'TikHub', wechatCollectorReady.tikhub ? '$0.01 / 次' : '未配置'],
                ['dajiala', '极致了数据', wechatCollectorReady.dajiala ? '约 ¥0.5 / 次' : '未配置'],
              ] as Array<[WechatSearchSource, string, string]>).map(([provider, label, detail]) => (
                <Button variant="plain"
                  key={provider}
                  type="button"
                  className={`mc-provider-option${wechatProvider === provider ? ' mc-provider-option--active' : ''}`}
                  aria-pressed={wechatProvider === provider}
                  onClick={() => setWechatProvider(provider)}
                >
                  <span>{label}</span>
                  <small>{detail}</small>
                </Button>
              ))}
            </div>

            {!usingYuanbao && <div className="mc-wechat-filters">
              <SelectField
                className="mc-select"
                aria-label="公众号文章排序"
                value={wechatSort}
                onChange={event => setWechatSort(event.target.value as WechatCollectorSort)}
              >
                <option value="default">相关度</option>
                <option value="latest">最新发布</option>
                <option value="hot">热度优先</option>
              </SelectField>
              <SelectField
                className="mc-select"
                aria-label="公众号文章发布时间"
                value={wechatPublishTime}
                onChange={event => setWechatPublishTime(event.target.value as WechatCollectorTimeRange)}
              >
                <option value="all">不限时间</option>
                <option value="day">最近一天</option>
                <option value="week">最近七天</option>
                <option value="half_year">最近半年</option>
              </SelectField>
            </div>}

            <div className="mc-search-row">
              <Input
                className="mc-input"
                placeholder="输入主题、机构或文章关键词"
                value={wechatQuery}
                onChange={event => setWechatQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing && !loading && canSearchWechat) {
                    void handleWechatSearch()
                  }
                }}
                disabled={loading || !canSearchWechat}
                maxLength={100}
              />
              <Button variant="plain"
                type="button"
                className="mc-btn mc-btn--primary"
                onClick={() => void handleWechatSearch()}
                disabled={loading || !wechatQuery.trim() || !canSearchWechat}
              >
                {loading ? <Loader2 size={14} className="mc-spin" /> : <Search size={14} />}
                {loading ? (usingYuanbao ? '搜索并解析中…' : '搜索中…') : '搜索公众号'}
              </Button>
            </div>

            {usingYuanbao ? (
              <div className={`mc-search-tip mc-search-tip--${yuanbaoAvailable ? 'hint' : 'warn'}`}>
                {yuanbaoAvailable ? <BookOpen size={12} /> : <AlertCircle size={12} />}
                {yuanbaoAvailable ? '回答和公众号文章可分别勾选；未读到正文的条目会标明状态。' : '当前服务器未启用元宝 AI 搜索。'}
              </div>
            ) : (
              <div className={`mc-search-tip${canSearchWechat ? ' mc-search-tip--paid' : ' mc-search-tip--warn'}`}>
                {canSearchWechat ? <BookOpen size={12} /> : <AlertCircle size={12} />}
                {canSearchWechat
                  ? `搜索会产生服务商费用；读取单篇正文${wechatProvider === 'tikhub' ? '约 $0.01' : '约 ¥0.045'}`
                  : `请在服务端环境变量中配置 ${wechatProvider === 'tikhub' ? 'TIKHUB_API_KEY' : 'DAJIALA_API_KEY'}`}
              </div>
            )}
          </div>
        )}

        {mode === 'url' && (
          <div className="mc-search-wrap">
            {urlReaders.length > 1 && <label className="mc-field mc-tool-field">
              <span>链接读取服务</span>
              <Select label="链接读取服务" value={selectedUrlReader || 'web'} disabled={loading} onValueChange={setUrlProvider} options={urlReaders} />
            </label>}
            <div className="mc-url-row">
            <Input
              className="mc-input mc-input--mono"
              aria-label="网页 URL"
              placeholder="粘贴网页 URL，如 https://mp.weixin.qq.com/..."
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !loading) handleFetchUrl() }}
              disabled={loading}
            />
            <Button variant="plain"
              className="mc-btn mc-btn--primary"
              onClick={handleFetchUrl}
              disabled={loading || !urlInput.trim() || (deepSeekUrl && !canUseDeepSeek)}
            >
              {loading ? <Loader2 size={14} className="mc-spin" /> : <Link size={14} />}
              {loading ? '解析中...' : '解析'}
            </Button>
            </div>
            {wechatUrl && <p className="mc-field-hint">
              {wechatReaders.length ? '直读遇到微信验证时，可以切换公众号专用解析服务。' : '若微信要求验证，请打开原文后手动粘贴正文。'}
            </p>}
          </div>
        )}

        {mode === 'file' && (
          <div className="mc-paste-area">
            {deepseekReady && <label className="mc-field mc-tool-field">
              <span>文件解析服务</span>
              <Select label="文件解析服务" value={deepSeekFile ? 'deepseek' : 'zhipu'} disabled={loading} onValueChange={setFileProvider} options={[{ value: 'zhipu', label: '智谱' }, { value: 'deepseek', label: 'DeepSeek OCR' }]} />
            </label>}
            {deepSeekFile ? <label className="mc-field mc-tool-field">
              <span>OCR 解析方式</span>
              <Select label="OCR 解析方式" value={ocrPurpose} disabled={loading} onValueChange={value => setOcrPurpose(value === 'rich_layout_recognition' ? 'rich_layout_recognition' : 'text_recognition')} options={[{ value: 'text_recognition', label: '提取文本' }, { value: 'rich_layout_recognition', label: '图文混排' }]} />
            </label> : <div className="mc-provider-toggle" aria-label="智谱文件解析类型">
              <Button variant="plain"
                type="button"
                className={`mc-provider-option${parseMode === 'document' ? ' mc-provider-option--active' : ''}`}
                onClick={() => setParseMode('document')}
              >
                <span>文档解析</span>
                <small>PDF / Office / 图片 / 文本</small>
              </Button>
              <Button variant="plain"
                type="button"
                className={`mc-provider-option${parseMode === 'handwriting' ? ' mc-provider-option--active' : ''}`}
                onClick={() => setParseMode('handwriting')}
              >
                <span>手写 OCR</span>
                <small>PNG / JPG / JPEG</small>
              </Button>
            </div>}
            <label className={`mc-btn mc-btn--primary${loading ? ' mc-btn--loading' : ''}`}>
              {loading ? <Loader2 size={14} className="mc-spin" /> : <Upload size={14} />}
              {loading ? '解析中...' : '选择文件并解析'}
              <Input
                type="file"
                hidden
                disabled={loading || (deepSeekFile ? !canUseDeepSeek : !glmApiKey)}
                accept={deepSeekFile ? DEEPSEEK_DOCUMENT_EXTENSIONS : parseMode === 'handwriting'
                  ? '.png,.jpg,.jpeg,image/png,image/jpeg'
                  : '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.html,.png,.jpg,.jpeg,.webp,.tiff'}
                onChange={event => {
                  const file = event.target.files?.[0] || null
                  event.target.value = ''
                  void handleParseFile(file)
                }}
              />
            </label>
            {deepSeekFile ? <div className="mc-search-tip mc-search-tip--hint">支持 PDF、Word、PPT 和图片，单个文件最大 32 MiB</div> : <div className={`mc-search-tip${glmApiKey ? ' mc-search-tip--hint' : ' mc-search-tip--warn'}`}>
              {glmApiKey ? <BookOpen size={12} /> : <AlertCircle size={12} />}
              {glmApiKey
                ? '文件会发送到智谱解析，返回文本后再由你确认是否写入素材库'
                : '请先在「AI 配置 → 公共 Key」配置智谱 API Key'}
            </div>}
          </div>
        )}

        {mode === 'research' && (
          <form className="mc-research" onSubmit={event => { event.preventDefault(); void handleResearch() }}>
            <label className="mc-field">
              <span>调研问题</span>
              <Textarea rows={4} maxLength={32000} placeholder="想查什么？可以粘贴相关链接"
                value={researchPrompt} disabled={loading} onChange={event => setResearchPrompt(event.target.value)} />
            </label>
            <fieldset className="mc-research-options" disabled={loading}>
              <legend>调研能力</legend>
              <div>
                {RESEARCH_OPTIONS.map(({ key, label }) => (
                  <Checkbox key={key} className="mc-option" checked={researchOptions[key]}
                    disabled={loading} onCheckedChange={checked => setResearchOptions({ ...researchOptions, [key]: checked })}>{label}</Checkbox>
                ))}
              </div>
            </fieldset>
            <div className="mc-research-attachment">
              <div className="mc-field mc-research-file">
                <span>参考附件 <small>选填</small></span>
                <div className="mc-file-actions">
                  <FilePicker disabled={loading}
                    accept={researchPurpose === 'user_data' ? '.txt,.md,.csv,.json,.html,.xml,.xls,.xlsx' : DEEPSEEK_DOCUMENT_EXTENSIONS}
                    onPick={setResearchFile}>{researchFile ? '更换附件' : '选择附件'}</FilePicker>
                  {researchFile && <>
                    <span className="mc-file-name" title={researchFile.name}>{researchFile.name}</span>
                    <Button className="mc-date-clear" onClick={() => setResearchFile(undefined)}
                      disabled={loading} aria-label="移除附件"><X size={14} /></Button>
                  </>}
                </div>
              </div>
              <label className="mc-field">
                <span>附件解析方式</span>
                <Select label="附件解析方式" value={researchPurpose} disabled={loading}
                onValueChange={value => { setResearchPurpose(value); setResearchFile(undefined) }}
                options={[
                  { value: 'text_recognition', label: '提取文本' },
                  { value: 'rich_layout_recognition', label: '图文混排' },
                  { value: 'user_data', label: '纯文本 / 表格' },
                ]} />
              </label>
            </div>
            <div className="mc-research-footer">
              <Checkbox className="mc-research-consent" checked={deepseekConsent} disabled={loading} onCheckedChange={setDeepseekConsent}>
                同意将调研问题和附件发送给 DeepSeek，并按调用计费
              </Checkbox>
              <Button type="submit" variant="primary" className="mc-research-submit" disabled={loading || !canUseDeepSeek || !researchPrompt.trim()}>
                {loading ? <Loader2 size={15} className="mc-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
                {loading ? '调研中…' : '开始调研'}
              </Button>
            </div>
            {loading && <p className="mc-research-status" role="status">正在等待 DeepSeek 返回调研结果</p>}
          </form>
        )}

        {mode === 'audio' && (
          <div className="mc-audio">
            <FilePicker accept=".wav,.ogg" disabled={loading || !canUseDeepSeek} onPick={file => void handleTranscribe(file)}>
              {loading ? '转写中…' : '选择音频并转写'}
            </FilePicker>
            <p className="mc-field-hint">WAV 或 Ogg Opus · 最长 120 秒 · 最大 8 MiB</p>
          </div>
        )}

        {mode === 'paste' && (
          <div className="mc-paste-area">
            <Input
              className="mc-input"
              placeholder="素材标题（选填）"
              value={pasteTitle}
              onChange={e => setPasteTitle(e.target.value)}
            />
            <Textarea
              className="mc-textarea"
              placeholder="粘贴素材内容：小红书笔记文字、微信文章摘录、数据报告内容……"
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={5}
            />
            <Button variant="plain"
              className="mc-btn mc-btn--primary"
              onClick={handleAddPaste}
              disabled={!pasteText.trim()}
            >
              <Plus size={14} />
              添加到列表
            </Button>
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
              <Button variant="plain" className="mc-link-btn" onClick={selectAll}>全选</Button>
              <Button variant="plain" className="mc-link-btn" onClick={selectNone}>取消</Button>
              {canBatchFetch && (
                <Button variant="plain"
                  className={`mc-btn mc-btn--fetch${batchFetching ? ' mc-btn--loading' : ''}`}
                  onClick={handleBatchFetchFullText}
                  disabled={batchFetching}
                  title="批量读取已选搜索结果的完整正文"
                >
                  {batchFetching
                    ? <><Loader2 size={13} className="mc-spin" />读取中...</>
                    : <><BookOpen size={13} />批量读全文</>
                  }
                </Button>
              )}
              <Button variant="plain"
                className={`mc-btn mc-btn--save${saving ? ' mc-btn--loading' : ''}`}
                onClick={handleSave}
                disabled={saving || selectedCount === 0}
              >
                {saving
                  ? <><Loader2 size={13} className="mc-spin" />保存中...</>
                  : <><Check size={13} />写入素材库（{selectedCount}）</>
                }
              </Button>
            </div>
          </div>

          <div className="mc-item-list">
            {items.map(item => (
              <div
                key={item.id}
                className={`mc-item${item.selected ? ' mc-item--selected' : ''} mc-item--${item.type}${item.fullFetched && (item.type === 'search' || item.type === 'wechat') ? ' mc-item--full' : ''}`}
              >
                <div className="mc-item-header">
                  <Checkbox className="mc-item-check" checked={item.selected}
                    onCheckedChange={() => toggleSelect(item.id)}>
                    <span className="mc-item-label">
                    <span className={`mc-item-type-badge mc-badge--${item.type}`}>
                      {item.type === 'url'    && <Link size={11} />}
                      {item.type === 'search' && <Search size={11} />}
                      {item.type === 'wechat' && <MessageCircle size={11} />}
                      {item.type === 'paste'  && <ClipboardPaste size={11} />}
                      {item.type === 'file'   && <Upload size={11} />}
                      {item.source || (item.type === 'paste' ? '粘贴' : item.type)}
                    </span>
                    {/* 全文标记 */}
                    {(item.type === 'search' || item.type === 'wechat') && item.fullFetched && (
                      <span className="mc-full-badge">{item.type === 'wechat' && !item.provider ? '正文' : '全文'}</span>
                    )}
                    {needsWechatArticleText(item) && <span className="mc-preview-badge">{item.content ? '摘要' : '链接'}</span>}
                    <span className="mc-item-title">{item.title}</span>
                    </span>
                  </Checkbox>
                  <div className="mc-item-ops">
                    {/* 时间标签 */}
                    <div className="mc-item-date-wrap" title="设置素材时间（可选）">
                      {item.dateTag ? (
                        <span className="mc-item-date-tag">
                          <Calendar size={10} />
                          {formatDateTag(item.dateTag)}
                          <Button variant="plain"
                            className="mc-item-date-clear"
                            onClick={() => setItemDateTag(item.id, '')}
                            title="清除时间"
                          >
                            <X size={9} />
                          </Button>
                        </span>
                      ) : (
                        <Input
                          type="date"
                          className="mc-item-date-input"
                          value=""
                          onChange={e => setItemDateTag(item.id, e.target.value)}
                          title="设置时间（可选）"
                        />
                      )}
                    </div>

                    {/* 搜索结果先展示摘要，确认后再读取全文；公众号服务会产生单篇费用。 */}
                    {(item.type === 'search' || item.type === 'wechat') && !item.fullFetched && item.url && (
                      <Button variant="plain"
                        className="mc-fetch-btn"
                        onClick={() => item.url && handleFetchFullText(item.id, item.url)}
                        disabled={item.fetching || (item.useDeepSeekFetch && (!canUseDeepSeek || loading || items.some(result => result.useDeepSeekFetch && result.fetching)))}
                        title={item.provider ? '通过付费服务读取正文' : '用网页解析器读取正文'}
                      >
                        {item.fetching
                          ? <Loader2 size={12} className="mc-spin" />
                          : <BookOpen size={12} />
                        }
                        {item.fetching ? '读取中' : needsWechatArticleText(item) ? '重试解析' : item.type === 'wechat' ? '读取正文' : '读全文'}
                      </Button>
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
                    <Button variant="plain"
                      className="mc-icon-btn"
                      onClick={() => toggleExpand(item.id)}
                      title={item.expanded ? '收起' : '展开内容'}
                    >
                      {item.expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </Button>
                    <Button variant="plain"
                      className="mc-icon-btn mc-icon-btn--del"
                      onClick={() => removeItem(item.id)}
                      title="移除"
                    >
                      ✕
                    </Button>
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
                      : <span className="mc-snippet-empty">
                          {needsWechatArticleText(item) ? item.url : '暂无摘要，点击「读全文」获取正文'}
                        </span>
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
          {mode === 'wechat' && (
            <div className="mc-empty-inner">
              <MessageCircle size={28} className="mc-empty-icon" />
              <p>{usingYuanbao ? '输入关键词，查找相关的公众号文章' : '搜索公开公众号文章，确认摘要后再按需读取正文'}</p>
              {!usingYuanbao && canSearchWechat && (
                <span className="mc-empty-badge">
                  {wechatProvider === 'tikhub' ? 'TikHub 已启用' : '极致了数据已启用'}
                </span>
              )}
            </div>
          )}
          {mode === 'url' && (
            <div className="mc-empty-inner">
              <Link size={28} className="mc-empty-icon" />
              <p>输入网页链接，{deepSeekUrl ? 'DeepSeek Fetch' : 'Jina Reader'} 会提取正文</p>
            </div>
          )}
          {mode === 'paste' && (
            <div className="mc-empty-inner">
              <ClipboardPaste size={28} className="mc-empty-icon" />
              <p>粘贴任意文本内容，如小红书笔记、公众号摘录</p>
            </div>
          )}
          {mode === 'file' && (
            <div className="mc-empty-inner">
              <Upload size={28} className="mc-empty-icon" />
              <p>上传 PDF、Office、图片或手写稿，解析为可编辑素材</p>
              <span className="mc-empty-badge">复用智谱公共 Key</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
