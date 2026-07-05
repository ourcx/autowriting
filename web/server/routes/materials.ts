// @ts-nocheck
/**
 * 素材采集路由
 *
 * POST /api/materials/fetch-url        - Jina Reader 解析 URL，返回 Markdown 正文
 * POST /api/materials/fetch-url-batch  - 批量 Jina Reader 读取全文（并发上限 3）
 * POST /api/materials/search           - Serper/Bing/SearXNG 搜索，返回标题+摘要+URL 列表
 * POST /api/materials/:articleId/save  - 追加素材片段到 materials.md
 * GET  /api/materials/:articleId       - 读取当前 materials.md 内容
 */
import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { DRAFTS_DIR } from '../config.js'
import { logger } from '../logger.js'
import { authMiddleware } from '../authMiddleware.js'
import { webFetch } from '../utils/search/webFetcher.js'

const router = Router()

// 所有路由都需要登录（与 articles.js 保持一致）
router.use(authMiddleware)

// ── 工具函数（路径规则与 articles.js 的 getArticlePath 保持同步）───────────

function getUserDraftsDir(userId) {
  return path.join(DRAFTS_DIR, userId)
}

/**
 * 解析 materials.md 路径，支持多用户隔离。
 * 逻辑与 articles.js getArticlePath(id, 'materials', uid) 完全一致：
 *   1. 优先在 DRAFTS_DIR/{uid}/{articleId}/ 直接查找
 *   2. 其次按 YYYYMMDD-suffix 格式解析
 */
function getMaterialsPath(articleId, userId) {
  const baseDir = userId ? getUserDraftsDir(userId) : DRAFTS_DIR
  const directPath = path.join(baseDir, articleId)
  if (fs.existsSync(directPath)) {
    return path.join(directPath, 'prompt', 'materials.md')
  }
  const parts = articleId.split('-')
  const dateDir = parts[0]
  const suffix = parts.length > 1 ? `-${parts.slice(1).join('-')}` : ''
  return path.join(baseDir, dateDir, 'prompt', `materials${suffix}.md`)
}

// ── GET /api/materials/:articleId ─────────────────────────────────────────────
router.get('/:articleId', (req, res) => {
  try {
    const p = getMaterialsPath(req.params.articleId, req.user?.id)
    const content = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : ''
    res.json({ content })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── 工具：尝试 Jina Reader（快速超时，失败时静默降级）────────────────────────
async function fetchJinaText(url, apiKey = '') {
  const jinaUrl = `https://r.jina.ai/${url}`
  const headers = {
    'Accept': 'text/plain',
    'X-Return-Format': 'markdown',
    'X-Timeout': '8',
  }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  const resp = await fetch(jinaUrl, {
    headers,
    signal: AbortSignal.timeout(10000),
  })
  if (!resp.ok) throw new Error(`Jina ${resp.status}`)
  const text = await resp.text()
  if (text.length < 50) throw new Error('Jina 返回内容为空')
  return text.slice(0, 8000)
}

// ── POST /api/materials/fetch-url ─────────────────────────────────────────────
// 读取 URL 正文：优先 Jina Reader，不可用则降级到内置 WebFetcher
//   WebFetcher 三层防护：URL 安全检查 → 频率限制 → HTML 正文提取转 Markdown
router.post('/fetch-url', async (req, res) => {
  const { url, jinaApiKey = '' } = req.body
  if (!url) return res.status(400).json({ error: '缺少 url 参数' })

  let content = ''
  let method = ''

  // 尝试 Jina Reader（快速超时 10s）
  try {
    content = await fetchJinaText(url, jinaApiKey)
    method = 'jina'
  } catch (jinaErr) {
    logger.warn('MATERIALS', `Jina Reader 不可用，降级 WebFetcher: ${jinaErr.message}`)
    // 降级：使用内置 WebFetcher（安全策略 + HTML→Markdown）
    content = await webFetch(url, { maxChars: 8000 })
    method = 'webfetch'
    if (!content || content.startsWith('[')) {
      return res.status(500).json({ error: content || '抓取失败，可能是 JS 渲染页面或防爬墙' })
    }
  }

  res.json({ content, url, method })
})

// ── POST /api/materials/fetch-url-batch ───────────────────────────────────────
// 批量读取多个 URL 的全文：Jina 优先，降级 WebFetcher（并发上限 3）
router.post('/fetch-url-batch', async (req, res) => {
  const { urls, jinaApiKey = '' } = req.body
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: '缺少 urls 参数' })
  }

  const CONCURRENCY = 3
  const results = []

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map(async (url) => {
        let content = ''
        let ok = false
        try {
          content = await fetchJinaText(url, jinaApiKey)
          ok = true
        } catch {
          content = await webFetch(url, { maxChars: 8000 })
          ok = content.length > 0 && !content.startsWith('[')
        }
        return { url, content, ok }
      })
    )

    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j]
      if (r.status === 'fulfilled') {
        results.push(r.value)
      } else {
        results.push({ url: batch[j], content: '', ok: false, error: r.reason?.message || '读取失败' })
      }
    }
  }

  res.json({ results })
})

// ── POST /api/materials/search ────────────────────────────────────────────────
// 支持智谱（Zhipu）、Serper（Google/Baidu）、SearXNG（免费/自建）
router.post('/search', async (req, res) => {
  const { query, provider, apiKey, engine = 'google', num = 10, searxngUrl, glmApiKey } = req.body
  if (!query) return res.status(400).json({ error: '缺少 query 参数' })

  try {
    let results = []

    if (provider === 'searxng') {
      // SearXNG — 开源聚合搜索引擎，无需 API Key，可用公共实例
      // searx.be 限制了程序访问，改用 paulgo.io（稳定、支持 JSON API）
      const baseUrl = (searxngUrl || 'https://paulgo.io').replace(/\/$/, '')
      const params = new URLSearchParams({
        q:       query,
        format:  'json',
        engines: engine || 'google,bing,duckduckgo',
        lang:    'zh-CN',
        pageno:  '1',
      })
      const resp = await fetch(`${baseUrl}/search?${params}`, {
        headers: {
          'Accept':     'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; autowriting-bot/1.0)',
        },
        signal: AbortSignal.timeout(15000),
      })
      if (!resp.ok) {
        const errText = await resp.text()
        return res.status(502).json({ error: `SearXNG 返回 ${resp.status}: ${errText.slice(0, 200)}` })
      }
      const data = await resp.json()
      const items = data.results || []
      results = items.slice(0, num).map(item => ({
        title:   item.title   || '',
        snippet: item.content || item.snippet || '',
        url:     item.url     || '',
        source:  (() => { try { return new URL(item.url || 'https://unknown').hostname } catch { return 'unknown' } })(),
        engine:  (item.engines || []).join(','),
      }))

    } else if (provider === 'serper') {
      if (!apiKey) return res.status(400).json({ error: '未配置 Serper API Key，请在「AI 配置」页面填写，或切换到「SearXNG（免费）」' })
      // Serper.dev — 支持 google / baidu / bing 等 engine
      const resp = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY':    apiKey,
        },
        body:   JSON.stringify({ q: query, gl: 'cn', hl: 'zh-cn', num, engine }),
        signal: AbortSignal.timeout(15000),
      })
      if (!resp.ok) {
        const errText = await resp.text()
        return res.status(502).json({ error: `Serper API 错误 ${resp.status}: ${errText}` })
      }
      const data = await resp.json()
      const organic = data.organic || []
      results = organic.slice(0, num).map(item => ({
        title:   item.title   || '',
        snippet: item.snippet || '',
        url:     item.link    || '',
        source:  (() => { try { return new URL(item.link || 'https://unknown').hostname } catch { return 'unknown' } })(),
      }))

    } else if (provider === 'bing') {
      if (!apiKey) return res.status(400).json({ error: '未配置 Bing API Key，请在「AI 配置」页面填写' })
      // Bing Search API
      const params = new URLSearchParams({
        q:     query,
        mkt:   'zh-CN',
        count: String(num),
      })
      const resp = await fetch(`https://api.bing.microsoft.com/v7.0/search?${params}`, {
        headers: { 'Ocp-Apim-Subscription-Key': apiKey },
        signal:  AbortSignal.timeout(15000),
      })
      if (!resp.ok) {
        const errText = await resp.text()
        return res.status(502).json({ error: `Bing API 错误 ${resp.status}: ${errText}` })
      }
      const data = await resp.json()
      const webPages = data.webPages?.value || []
      results = webPages.slice(0, num).map(item => ({
        title:   item.name    || '',
        snippet: item.snippet || '',
        url:     item.url     || '',
        source:  (() => { try { return new URL(item.url || 'https://unknown').hostname } catch { return 'unknown' } })(),
      }))

    } else if (provider === 'zhipu') {
      // 智谱搜索 — 与 LLM 共用 GLM_API_KEY，零额外配置
      const zhipuKey = glmApiKey || apiKey
      if (!zhipuKey) return res.status(400).json({ error: '未配置智谱 API Key（GLM_API_KEY），请在「AI 配置」页面填写' })
      const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/tools/web_search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${zhipuKey}`,
        },
        body: JSON.stringify({
          search_engine: 'search_std',
          search_query: query,
          count: Math.min(num, 20),
          content_size: 'medium',
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        return res.status(502).json({ error: `智谱搜索 API 返回 ${resp.status}: ${errText.slice(0, 200)}` })
      }
      const data = await resp.json()
      const items = data.search_result || []
      results = items.slice(0, num).map(item => ({
        title:   item.title   || '',
        snippet: item.content || '',
        url:     item.link    || '',
        source:  (() => { try { return new URL(item.link || 'https://unknown').hostname } catch { return 'unknown' } })(),
      }))

    } else {
      // 未指定 provider 时自动检测
      return res.status(400).json({ error: `不支持的搜索服务商: ${provider || '未指定'}。支持：zhipu / serper / bing / searxng` })
    }

    res.json({ results, query })
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? '搜索请求超时（15s）' : e.message
    logger.error('MATERIALS', '搜索失败', { error: msg })
    res.status(500).json({ error: msg })
  }
})

// ── POST /api/materials/:articleId/save ───────────────────────────────────────
// 追加素材到 materials.md（追加而非覆盖，保留已有内容）
router.post('/:articleId/save', (req, res) => {
  try {
    const { content, mode = 'append' } = req.body
    if (!content) return res.status(400).json({ error: '缺少 content 参数' })

    const p      = getMaterialsPath(req.params.articleId, req.user?.id)
    const dir    = path.dirname(p)
    fs.mkdirSync(dir, { recursive: true })

    if (mode === 'replace') {
      fs.writeFileSync(p, content, 'utf-8')
    } else {
      // append：如果文件已有内容，加两行空行分隔
      const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').trimEnd() : ''
      const newContent = existing ? `${existing}\n\n---\n\n${content}` : content
      fs.writeFileSync(p, newContent, 'utf-8')
    }

    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
