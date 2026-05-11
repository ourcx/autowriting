/**
 * 素材采集路由
 *
 * POST /api/materials/fetch-url        - Jina Reader 解析 URL，返回 Markdown 正文
 * POST /api/materials/search           - Serper/Bing 搜索，返回标题+摘要+URL 列表
 * POST /api/materials/:articleId/save  - 追加素材片段到 materials.md
 * GET  /api/materials/:articleId       - 读取当前 materials.md 内容
 */
import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { DRAFTS_DIR } from '../config.js'

const router = Router()

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function getDraftDir(articleId) {
  return path.join(DRAFTS_DIR, articleId)
}

function getMaterialsPath(articleId) {
  return path.join(getDraftDir(articleId), 'prompt', 'materials.md')
}

// ── GET /api/materials/:articleId ─────────────────────────────────────────────
router.get('/:articleId', (req, res) => {
  try {
    const p = getMaterialsPath(req.params.articleId)
    const content = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : ''
    res.json({ content })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/materials/fetch-url ─────────────────────────────────────────────
// 用 Jina Reader 把任意 URL 转成干净的 Markdown
router.post('/fetch-url', async (req, res) => {
  const { url } = req.body
  if (!url) return res.status(400).json({ error: '缺少 url 参数' })

  try {
    const jinaUrl = `https://r.jina.ai/${url}`
    const resp = await fetch(jinaUrl, {
      headers: {
        'Accept': 'text/plain',
        'X-Return-Format': 'markdown',
        'X-Timeout': '20',
      },
      signal: AbortSignal.timeout(25000),
    })
    if (!resp.ok) {
      return res.status(502).json({ error: `Jina Reader 返回 ${resp.status}，请检查 URL 是否可访问` })
    }
    const text = await resp.text()
    // 简单截断，避免返回超大正文
    const content = text.slice(0, 8000)
    res.json({ content, url })
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? 'URL 解析超时（25s），请换一个地址试试' : e.message
    res.status(500).json({ error: msg })
  }
})

// ── POST /api/materials/search ────────────────────────────────────────────────
// 支持 Serper（Google/Baidu）和 Bing Search API
router.post('/search', async (req, res) => {
  const { query, provider = 'serper', apiKey, engine = 'google', num = 10 } = req.body
  if (!query) return res.status(400).json({ error: '缺少 query 参数' })
  if (!apiKey) return res.status(400).json({ error: '未配置搜索 API Key，请在「AI 配置」页面填写' })

  try {
    let results = []

    if (provider === 'serper') {
      // Serper.dev — 支持 google / baidu / bing 等 engine
      const resp = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey,
        },
        body: JSON.stringify({ q: query, gl: 'cn', hl: 'zh-cn', num, engine }),
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
        source:  new URL(item.link || 'https://unknown').hostname,
      }))
    } else if (provider === 'bing') {
      // Bing Search API
      const params = new URLSearchParams({
        q:    query,
        mkt:  'zh-CN',
        count: String(num),
      })
      const resp = await fetch(`https://api.bing.microsoft.com/v7.0/search?${params}`, {
        headers: { 'Ocp-Apim-Subscription-Key': apiKey },
        signal: AbortSignal.timeout(15000),
      })
      if (!resp.ok) {
        const errText = await resp.text()
        return res.status(502).json({ error: `Bing API 错误 ${resp.status}: ${errText}` })
      }
      const data = await resp.json()
      const webPages = data.webPages?.value || []
      results = webPages.slice(0, num).map(item => ({
        title:   item.name        || '',
        snippet: item.snippet     || '',
        url:     item.url         || '',
        source:  new URL(item.url || 'https://unknown').hostname,
      }))
    } else {
      return res.status(400).json({ error: `不支持的搜索服务商: ${provider}` })
    }

    res.json({ results, query })
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? '搜索请求超时（15s）' : e.message
    res.status(500).json({ error: msg })
  }
})

// ── POST /api/materials/:articleId/save ───────────────────────────────────────
// 追加素材到 materials.md（追加而非覆盖，保留已有内容）
router.post('/:articleId/save', (req, res) => {
  try {
    const { content, mode = 'append' } = req.body
    if (!content) return res.status(400).json({ error: '缺少 content 参数' })

    const p      = getMaterialsPath(req.params.articleId)
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
