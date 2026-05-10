/**
 * 文章路由：CRUD + AI 生成
 * GET    /api/articles
 * GET    /api/articles/:articleId
 * POST   /api/articles/:articleId
 * POST   /api/articles/:articleId/generate
 * POST   /api/articles/:articleId/generate/stream  ← SSE 流式
 * DELETE /api/articles/:articleId
 */
import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { DRAFTS_DIR, AGENTS_FILE, SERVER_AI_CONFIG } from '../config.js'
import { ensureDir } from '../utils.js'
import { retrieveRelevant, formatRetrievedContext } from '../rag.js'

const router = Router()

// ── 工具：根据 articleId 解析各类文件路径 ──────────────────────────────────────

function getArticlePath(articleId, type) {
  // 优先尝试直接在 DRAFTS_DIR 找完整目录（如 20260430-广州五月旅游指南）
  const directPath = path.join(DRAFTS_DIR, articleId)
  if (fs.existsSync(directPath)) {
    return {
      task:      path.join(directPath, 'prompt', 'task.md'),
      materials: path.join(directPath, 'prompt', 'materials.md'),
      article:   path.join(directPath, 'raw', 'article_raw.md'),
      title:     path.join(directPath, 'title.txt'),
    }[type]
  }

  // 按 YYYYMMDD-后缀 格式解析
  const parts = articleId.split('-')
  const dateDir = parts[0]
  const suffix = parts.length > 1 ? `-${parts.slice(1).join('-')}` : ''
  return {
    task:      path.join(DRAFTS_DIR, dateDir, 'prompt', `task${suffix}.md`),
    materials: path.join(DRAFTS_DIR, dateDir, 'prompt', `materials${suffix}.md`),
    article:   path.join(DRAFTS_DIR, dateDir, 'raw', `article_raw${suffix}.md`),
    title:     path.join(DRAFTS_DIR, dateDir, `title${suffix}.txt`),
  }[type]
}

// ── GET /api/articles ─────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    if (!fs.existsSync(DRAFTS_DIR)) return res.json([])

    const articles = []
    const dateDirs = fs.readdirSync(DRAFTS_DIR)
      .filter(f => /^\d{8}/.test(f))
      .sort((a, b) => {
        const dateA = a.substring(0, 8)
        const dateB = b.substring(0, 8)
        return dateA !== dateB ? dateB.localeCompare(dateA) : b.localeCompare(a)
      })

    console.log('[API] Found directories:', dateDirs)

    for (const dateDir of dateDirs) {
      const promptDir = path.join(DRAFTS_DIR, dateDir, 'prompt')
      const rawDir    = path.join(DRAFTS_DIR, dateDir, 'raw')
      const hasPromptDir = fs.existsSync(promptDir)
      const hasRawDir    = fs.existsSync(rawDir)

      if (!hasPromptDir && !hasRawDir) continue

      const taskFiles = hasPromptDir
        ? fs.readdirSync(promptDir).filter(f => f.startsWith('task') && f.endsWith('.md'))
        : []

      if (taskFiles.length === 0) {
        // 没有 task 文件，当作单篇兜底
        const articleId = dateDir
        let title = ''
        const titlePath = path.join(DRAFTS_DIR, dateDir, 'title.txt')
        if (fs.existsSync(titlePath)) title = fs.readFileSync(titlePath, 'utf-8').trim()
        if (!title) {
          const defaultArticlePath = path.join(rawDir, 'article_raw.md')
          if (fs.existsSync(defaultArticlePath)) {
            const firstLine = fs.readFileSync(defaultArticlePath, 'utf-8').split('\n')[0]?.replace(/^#+\s*/, '').trim()
            if (firstLine) title = firstLine
          }
        }
        if (!title) title = `文章 ${articleId}`
        articles.push({ id: articleId, date: dateDir, title, status: 'draft', createdAt: new Date().toISOString() })
        continue
      }

      for (const taskFile of taskFiles) {
        let articleId = dateDir
        if (taskFile !== 'task.md') {
          const suffix = taskFile.replace('task', '').replace('.md', '')
          articleId = `${dateDir}${suffix}`
        }

        const taskPath    = path.join(promptDir, taskFile)
        const articlePath = path.join(rawDir, taskFile.replace('task', 'article_raw'))
        const titlePath   = path.join(DRAFTS_DIR, dateDir, `title${taskFile.replace('task.md', '')}.txt`)

        let title = ''
        let status = 'draft'

        if (fs.existsSync(titlePath)) {
          title = fs.readFileSync(titlePath, 'utf-8').trim()
        } else if (fs.existsSync(articlePath)) {
          const firstLine = fs.readFileSync(articlePath, 'utf-8').split('\n')[0]?.replace(/^#+\s*/, '').trim()
          if (firstLine) title = firstLine
        } else if (fs.existsSync(taskPath)) {
          const match = fs.readFileSync(taskPath, 'utf-8').match(/文章主题[：:]\s*(.+)/i)
          if (match) title = match[1].trim()
        }

        if (!title) title = `文章 ${articleId}`
        if (fs.existsSync(articlePath)) status = 'generated'

        articles.push({ id: articleId, date: dateDir, title, status, createdAt: new Date().toISOString() })
      }
    }

    res.json(articles)
  } catch (error) {
    console.error('Error fetching articles:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── GET /api/articles/:articleId ──────────────────────────────────────────────

router.get('/:articleId', (req, res) => {
  try {
    const { articleId } = req.params
    const taskPath      = getArticlePath(articleId, 'task')
    const materialsPath = getArticlePath(articleId, 'materials')
    const articlePath   = getArticlePath(articleId, 'article')
    const titlePath     = getArticlePath(articleId, 'title')

    ensureDir(path.dirname(taskPath))
    ensureDir(path.dirname(materialsPath))
    ensureDir(path.dirname(articlePath))

    res.json({
      task:      fs.existsSync(taskPath)      ? fs.readFileSync(taskPath,      'utf-8') : '',
      materials: fs.existsSync(materialsPath) ? fs.readFileSync(materialsPath, 'utf-8') : '',
      article:   fs.existsSync(articlePath)   ? fs.readFileSync(articlePath,   'utf-8') : '',
      title:     fs.existsSync(titlePath)     ? fs.readFileSync(titlePath,     'utf-8') : '',
    })
  } catch (error) {
    console.error('Error fetching article:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── POST /api/articles/:articleId（保存）─────────────────────────────────────

router.post('/:articleId', (req, res) => {
  try {
    const { articleId } = req.params
    const { task, materials, article, title } = req.body

    const taskPath      = getArticlePath(articleId, 'task')
    const materialsPath = getArticlePath(articleId, 'materials')
    const articlePath   = getArticlePath(articleId, 'article')
    const titlePath     = getArticlePath(articleId, 'title')

    ensureDir(path.dirname(taskPath))
    ensureDir(path.dirname(materialsPath))
    ensureDir(path.dirname(articlePath))

    if (task)      fs.writeFileSync(taskPath,      task,      'utf-8')
    if (materials) fs.writeFileSync(materialsPath, materials, 'utf-8')
    if (article)   fs.writeFileSync(articlePath,   article,   'utf-8')
    if (title)     fs.writeFileSync(titlePath,     title,     'utf-8')

    res.json({ success: true })
  } catch (error) {
    console.error('Error saving article:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── POST /api/articles/:articleId/generate ────────────────────────────────────

router.post('/:articleId/generate', async (req, res) => {
  try {
    const { articleId } = req.params
    const { task, materials, aiConfig } = req.body

    if (!task || !materials) {
      return res.status(400).json({ error: '任务和素材不能为空' })
    }

    const cfg = { ...SERVER_AI_CONFIG, ...(aiConfig || {}) }

    let agentsContent = ''
    if (fs.existsSync(AGENTS_FILE)) {
      agentsContent = fs.readFileSync(AGENTS_FILE, 'utf-8')
    }

    const userPrompt = `你是一个专业的内容创作助手。请严格按照以下要求完成文章写作任务。

# 写作规范（必须严格遵守）
${agentsContent}

# 本次任务要求
${task}

# 素材参考
${materials}

---

现在请根据以上规范和素材，直接输出完整的文章内容（纯 Markdown 格式，不要有任何其他说明）：`

    let requestHeaders = { 'Content-Type': 'application/json' }
    let requestUrl = ''
    let requestModel = ''

    if (cfg.articleProvider === 'maas') {
      requestUrl   = `${cfg.maasBaseUrl}/chat/completions`
      requestModel = 'deepseek-v4-pro'
      requestHeaders['api-key']           = cfg.maasApiKey
      requestHeaders['x-maas-user-email'] = cfg.maasUserEmail
      requestHeaders['x-maas-app-id']     = 'qs-api'
    } else {
      requestUrl   = `${cfg.articleBaseUrl}/chat/completions`
      requestModel = cfg.articleModel || 'gpt-4o'
      requestHeaders['Authorization'] = `Bearer ${cfg.articleApiKey}`
    }

    if (!cfg.articleApiKey && cfg.articleProvider !== 'maas') {
      return res.status(400).json({ error: '未配置 API Key，请前往「AI 配置」页面设置后重试' })
    }
    if (cfg.articleProvider === 'maas' && !cfg.maasApiKey) {
      return res.status(400).json({ error: '未配置 MaaS API Key，请前往「AI 配置」页面设置后重试' })
    }

    const response = await axios.post(
      requestUrl,
      {
        model: requestModel,
        messages: [
          { role: 'system', content: '你是一个专业的内容创作助手，擅长按照规范和要求生成高质量的文章内容。' },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 0.9,
        max_tokens: 4096,
        stream: false,
      },
      { headers: requestHeaders }
    )

    const article = response.data.choices[0].message.content
    const articlePath = getArticlePath(articleId, 'article')
    ensureDir(path.dirname(articlePath))
    fs.writeFileSync(articlePath, article, 'utf-8')

    res.json({ article })
  } catch (error) {
    console.error('Error generating article:', error.response?.data || error.message)
    res.status(500).json({ error: error.response?.data?.error?.message || error.message })
  }
})

// ── POST /api/articles/:articleId/generate/stream  (SSE) ─────────────────────

router.post('/:articleId/generate/stream', async (req, res) => {
  const { articleId } = req.params
  const { task, materials, aiConfig } = req.body

  // SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  // 工具：向客户端发送一个 SSE 事件
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  try {
    if (!task || !materials) {
      send('error', { message: '任务和素材不能为空' })
      return res.end()
    }

    const cfg = { ...SERVER_AI_CONFIG, ...(aiConfig || {}) }

    // ── 1. RAG 检索 ───────────────────────────────────────────────────────────
    send('status', { step: 'rag', message: '正在检索往期相关文章...' })
    let ragContext = ''
    let ragDocs    = []
    try {
      ragDocs    = await retrieveRelevant(task, { topK: 4, aiConfig: cfg })
      ragContext  = formatRetrievedContext(ragDocs)
      if (ragDocs.length) send('rag', { docs: ragDocs })
    } catch (e) {
      console.warn('[Stream] RAG 检索失败（继续生成）:', e.message)
    }

    // ── 2. 读取写作规范 ───────────────────────────────────────────────────────
    let agentsContent = ''
    if (fs.existsSync(AGENTS_FILE)) {
      agentsContent = fs.readFileSync(AGENTS_FILE, 'utf-8')
    }

    const ragSection = ragContext
      ? `\n\n# 往期相关内容参考\n${ragContext}\n`
      : ''

    const userPrompt = `你是一个专业的内容创作助手。请严格按照以下要求完成文章写作任务。

# 写作规范（必须严格遵守）
${agentsContent}
${ragSection}
# 本次任务要求
${task}

# 素材参考
${materials}

---

现在请根据以上规范和素材，直接输出完整的文章内容（纯 Markdown 格式，不要有任何其他说明）：`

    // ── 3. 构造请求参数 ───────────────────────────────────────────────────────
    let requestHeaders = { 'Content-Type': 'application/json' }
    let requestUrl = ''
    let requestModel = ''

    if (cfg.articleProvider === 'maas') {
      requestUrl   = `${cfg.maasBaseUrl}/chat/completions`
      requestModel = 'deepseek-v4-pro'
      requestHeaders['api-key']           = cfg.maasApiKey
      requestHeaders['x-maas-user-email'] = cfg.maasUserEmail
      requestHeaders['x-maas-app-id']     = 'qs-api'
    } else {
      requestUrl   = `${cfg.articleBaseUrl}/chat/completions`
      requestModel = cfg.articleModel || 'gpt-4o'
      requestHeaders['Authorization'] = `Bearer ${cfg.articleApiKey}`
    }

    if (!cfg.articleApiKey && cfg.articleProvider !== 'maas') {
      send('error', { message: '未配置 API Key，请前往「AI 配置」页面设置后重试' })
      return res.end()
    }
    if (cfg.articleProvider === 'maas' && !cfg.maasApiKey) {
      send('error', { message: '未配置 MaaS API Key，请前往「AI 配置」页面设置后重试' })
      return res.end()
    }

    // ── 4. 流式请求上游 LLM ───────────────────────────────────────────────────
    send('status', { step: 'generate', message: 'AI 正在生成文章...' })

    const upstreamRes = await axios.post(
      requestUrl,
      {
        model: requestModel,
        messages: [
          { role: 'system', content: '你是一个专业的内容创作助手，擅长按照规范和要求生成高质量的文章内容。' },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 0.9,
        max_tokens: 4096,
        stream: true,
      },
      {
        headers: requestHeaders,
        responseType: 'stream',
      }
    )

    // ── 5. 逐行解析 OpenAI SSE，转发给前端 ───────────────────────────────────
    let fullText = ''
    let buffer   = ''

    upstreamRes.data.on('data', (chunk) => {
      buffer += chunk.toString('utf-8')
      const lines = buffer.split('\n')
      buffer = lines.pop() // 保留未完整的最后一行

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data:')) continue

        try {
          const json    = JSON.parse(trimmed.slice(5).trim())
          const content = json.choices?.[0]?.delta?.content
          if (content) {
            fullText += content
            send('chunk', { text: content })
          }
        } catch {
          // 忽略解析失败的行
        }
      }
    })

    upstreamRes.data.on('end', () => {
      // ── 6. 持久化到磁盘 ───────────────────────────────────────────────────
      try {
        const articlePath = getArticlePath(articleId, 'article')
        ensureDir(path.dirname(articlePath))
        fs.writeFileSync(articlePath, fullText, 'utf-8')
      } catch (e) {
        console.error('[Stream] 写入文章失败:', e.message)
      }

      send('done', { article: fullText, ragCount: ragDocs.length })
      res.end()
    })

    upstreamRes.data.on('error', (e) => {
      console.error('[Stream] 上游流错误:', e.message)
      send('error', { message: e.message })
      res.end()
    })

  } catch (error) {
    console.error('[Stream] 生成失败:', error.response?.data || error.message)
    const msg = error.response?.data?.error?.message || error.message
    send('error', { message: msg })
    res.end()
  }
})

// ── DELETE /api/articles/:articleId ──────────────────────────────────────────

router.delete('/:articleId', (req, res) => {
  try {
    const { articleId } = req.params

    const directPath = path.join(DRAFTS_DIR, articleId)
    if (fs.existsSync(directPath)) {
      for (const sub of ['prompt', 'raw', 'final']) {
        const subDir = path.join(directPath, sub)
        if (fs.existsSync(subDir)) fs.rmSync(subDir, { recursive: true, force: true })
      }
      for (const file of fs.readdirSync(directPath)) {
        const fp = path.join(directPath, file)
        if (fs.statSync(fp).isFile()) fs.unlinkSync(fp)
      }
      if (fs.readdirSync(directPath).length === 0) fs.rmdirSync(directPath)
      return res.json({ success: true })
    }

    const parts = articleId.split('-')
    const dateDir = parts[0]
    const suffix  = parts.length > 1 ? `-${parts.slice(1).join('-')}` : ''
    const promptDir = path.join(DRAFTS_DIR, dateDir, 'prompt')
    const rawDir    = path.join(DRAFTS_DIR, dateDir, 'raw')

    for (const fp of [
      path.join(promptDir, `task${suffix}.md`),
      path.join(promptDir, `materials${suffix}.md`),
      path.join(rawDir,    `article_raw${suffix}.md`),
      path.join(DRAFTS_DIR, dateDir, `title${suffix}.txt`),
    ]) {
      if (fs.existsSync(fp)) fs.unlinkSync(fp)
    }

    for (const dir of [promptDir, rawDir, path.join(DRAFTS_DIR, dateDir)]) {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting article:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
