/**
 * 文章路由：CRUD + AI 生成
 * GET    /api/articles
 * GET    /api/articles/:articleId
 * POST   /api/articles/:articleId
 * POST   /api/articles/:articleId/generate
 * POST   /api/articles/:articleId/generate/stream  ← SSE 流式
 * POST   /api/articles/:articleId/analyze          ← AI 内容分析
 * DELETE /api/articles/:articleId
 */
import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { DRAFTS_DIR, AGENTS_FILE, SERVER_AI_CONFIG } from '../config.js'
import { ensureDir } from '../utils.js'
import { retrieveRelevant, formatRetrievedContext } from '../rag.js'
import { saveAnalysis, getLatestAnalysis, listAnalyses } from '../db.js'
import { authMiddleware } from '../authMiddleware.js'

const router = Router()

// 所有文章路由都需要登录
router.use(authMiddleware)

// ── 工具：根据 userId + articleId 解析各类文件路径 ───────────────────────────
// 用户文章存在 DRAFTS_DIR/{userId}/ 子目录下，实现多用户隔离

function getUserDraftsDir(userId) {
  return path.join(DRAFTS_DIR, userId)
}

function getArticlePath(articleId, type, userId) {
  const baseDir = userId ? getUserDraftsDir(userId) : DRAFTS_DIR

  // 优先尝试直接在 baseDir 找完整目录（如 20260430-广州五月旅游指南）
  const directPath = path.join(baseDir, articleId)
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
    task:      path.join(baseDir, dateDir, 'prompt', `task${suffix}.md`),
    materials: path.join(baseDir, dateDir, 'prompt', `materials${suffix}.md`),
    article:   path.join(baseDir, dateDir, 'raw', `article_raw${suffix}.md`),
    title:     path.join(baseDir, dateDir, `title${suffix}.txt`),
  }[type]
}

// ── 工具：扫描某个 drafts 目录，返回文章列表 ─────────────────────────────────
function scanArticlesInDir(draftsDir) {
  if (!fs.existsSync(draftsDir)) return []
  const articleMap = new Map()
  const dateDirs = fs.readdirSync(draftsDir)
    .filter(f => /^\d{8}/.test(f))
    .sort((a, b) => {
      const dateA = a.substring(0, 8)
      const dateB = b.substring(0, 8)
      return dateA !== dateB ? dateB.localeCompare(dateA) : b.localeCompare(a)
    })

  for (const dateDir of dateDirs) {
    const promptDir = path.join(draftsDir, dateDir, 'prompt')
    const rawDir    = path.join(draftsDir, dateDir, 'raw')
    const hasPromptDir = fs.existsSync(promptDir)
    const hasRawDir    = fs.existsSync(rawDir)
    if (!hasPromptDir && !hasRawDir) continue

    const taskFiles = hasPromptDir
      ? fs.readdirSync(promptDir).filter(f => f.startsWith('task') && f.endsWith('.md'))
      : []

    if (taskFiles.length === 0) {
      const articleId = dateDir
      let title = ''
      const titlePath = path.join(draftsDir, dateDir, 'title.txt')
      if (fs.existsSync(titlePath)) title = fs.readFileSync(titlePath, 'utf-8').trim()
      if (!title) {
        const defaultArticlePath = path.join(rawDir, 'article_raw.md')
        if (fs.existsSync(defaultArticlePath)) {
          const firstLine = fs.readFileSync(defaultArticlePath, 'utf-8').split('\n')[0]?.replace(/^#+\s*/, '').trim()
          if (firstLine) title = firstLine
        }
      }
      if (!title) title = `文章 ${articleId}`
      articleMap.set(articleId, { id: articleId, date: dateDir, title, status: 'draft', createdAt: new Date().toISOString() })
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
      const titlePath   = path.join(draftsDir, dateDir, `title${taskFile.replace('task.md', '')}.txt`)

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
      if (!articleMap.has(articleId)) {
        articleMap.set(articleId, { id: articleId, date: dateDir, title, status, createdAt: new Date().toISOString() })
      }
    }
  }
  return [...articleMap.values()]
}

// ── GET /api/articles ─────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  try {
    const userDir = getUserDraftsDir(req.user.id)
    const articles = scanArticlesInDir(userDir)
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
    const uid           = req.user.id
    const taskPath      = getArticlePath(articleId, 'task',      uid)
    const materialsPath = getArticlePath(articleId, 'materials', uid)
    const articlePath   = getArticlePath(articleId, 'article',   uid)
    const titlePath     = getArticlePath(articleId, 'title',     uid)

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
    const uid = req.user.id

    const taskPath      = getArticlePath(articleId, 'task',      uid)
    const materialsPath = getArticlePath(articleId, 'materials', uid)
    const articlePath   = getArticlePath(articleId, 'article',   uid)
    const titlePath     = getArticlePath(articleId, 'title',     uid)

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
    const articlePath = getArticlePath(articleId, 'article', req.user.id)
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
        const articlePath = getArticlePath(articleId, 'article', req.user.id)
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

// ── POST /api/articles/:articleId/analyze  (AI 内容分析) ─────────────────────

router.post('/:articleId/analyze', async (req, res) => {
  try {
    const { articleId } = req.params
    const { article, task, aiConfig } = req.body

    if (!article || article.trim().length < 100) {
      return res.status(400).json({ error: '文章内容太短，无法分析' })
    }

    const cfg = { ...SERVER_AI_CONFIG, ...(aiConfig || {}) }

    // ── 1. RAG 检索最相似往期文章（用于风格对比）────────────────────────────
    let similarArticles = []
    try {
      similarArticles = await retrieveRelevant(article.slice(0, 500), {
        topK: 3,
        aiConfig: cfg,
      })
    } catch { /* 无索引时跳过 */ }

    const similarContext = similarArticles.length
      ? `\n\n# 往期相似文章片段（用于风格对比）\n` +
        similarArticles.map((d, i) =>
          `### 片段${i + 1}（${d.dir} · 相似度${Math.round((1 - d.score) * 100)}%）\n${d.content}`
        ).join('\n\n')
      : ''

    // ── 2. 读取写作规范 ───────────────────────────────────────────────────────
    let agentsContent = ''
    if (fs.existsSync(AGENTS_FILE)) {
      agentsContent = fs.readFileSync(AGENTS_FILE, 'utf-8')
    }

    const taskContext = task ? `\n\n# 本次写作任务\n${task}` : ''

    const prompt = `你是一个专业的文章审核助手，擅长分析微信公众号文章的质量。请对以下文章进行深度分析，返回 JSON 格式结果。

# 写作规范（判断依据）
${agentsContent}
${taskContext}
${similarContext}

# 待分析文章
${article}

---

请严格按照以下 JSON 结构返回分析结果，不要有任何额外文字：

{
  "scores": {
    "overall": <0-100整数，综合评分>,
    "style": <0-100，风格真实度，避免 AI 腔>,
    "structure": <0-100，结构合理性>,
    "actionability": <0-100，实用性和可操作性>,
    "originality": <0-100，观点独特性>
  },
  "wordCount": <实际字数整数>,
  "readingMinutes": <阅读分钟数整数>,
  "strengths": [<字符串，3-5条优点，每条20字以内>],
  "issues": [
    {
      "level": <"error"|"warn"|"info">,
      "type": <问题类型，如"AI套话"|"空话"|"结构问题"|"逻辑断层"等>,
      "quote": <原文中的问题片段，不超过40字>,
      "suggestion": <具体改进建议，不超过60字>
    }
  ],
  "styleMatch": {
    "score": <0-100，与往期风格一致性，无往期数据时返回-1>,
    "note": <一句话说明，如「开头较官方，与往期直接切入的习惯有差异」>
  },
  "topSuggestion": <最重要的一条改进建议，不超过80字>
}`

    // ── 3. 调用 LLM ──────────────────────────────────────────────────────────
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

    const llmRes = await axios.post(
      requestUrl,
      {
        model: requestModel,
        messages: [
          { role: 'system', content: '你是专业的文章分析助手，只输出合法 JSON，不加任何解释或 Markdown 代码块。' },
          { role: 'user',   content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      },
      { headers: requestHeaders }
    )

    const raw = llmRes.data.choices[0].message.content.trim()
    // 去掉可能的 ```json 包裹
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    const result  = JSON.parse(cleaned)

    const fullResult = { ...result, ragCount: similarArticles.length }

    // 自动保存到 SQLite
    try { saveAnalysis(articleId, fullResult) } catch (e) { console.warn('[Analyze] 保存分析结果失败:', e.message) }

    res.json(fullResult)
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message
    console.error('[Analyze] 分析失败:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── 公共工具：构造 LLM 请求参数 ──────────────────────────────────────────────

function buildLLMRequest(cfg) {
  const headers = { 'Content-Type': 'application/json' }
  let url = '', model = ''
  if (cfg.articleProvider === 'maas') {
    url   = `${cfg.maasBaseUrl}/chat/completions`
    model = 'deepseek-v4-pro'
    headers['api-key']           = cfg.maasApiKey
    headers['x-maas-user-email'] = cfg.maasUserEmail
    headers['x-maas-app-id']     = 'qs-api'
  } else {
    url   = `${cfg.articleBaseUrl}/chat/completions`
    model = cfg.articleModel || 'gpt-4o'
    headers['Authorization'] = `Bearer ${cfg.articleApiKey}`
  }
  return { url, model, headers }
}

// ── POST /api/articles/:articleId/inline-edit  (AI 内联编辑) ─────────────────
// body: { selected: string, action: 'polish'|'shorten'|'expand'|'rewrite-lead', aiConfig }
// 返回: { result: string }

router.post('/:articleId/inline-edit', async (req, res) => {
  try {
    const { selected, fullArticle, action, aiConfig } = req.body
    if (!selected || selected.trim().length < 5) {
      return res.status(400).json({ error: '选中内容太短' })
    }

    const cfg = { ...SERVER_AI_CONFIG, ...(aiConfig || {}) }
    const { url, model, headers } = buildLLMRequest(cfg)

    // 全文上下文块（截断到 3000 字，避免超 token）
    const articleCtx = fullArticle
      ? `\n\n# 全文上下文（仅供参考，不要重复输出）\n${fullArticle.slice(0, 3000)}${fullArticle.length > 3000 ? '\n…（以下省略）' : ''}`
      : ''

    const ACTION_PROMPTS = {
      'polish': `你是专业的文字编辑。请对【待润色片段】进行润色：
- 去掉 AI 感、套话、被动句
- 保持第一人称「我」
- 保持与全文风格一致（真诚、实用、像朋友聊天）
- 只输出润色后的文字，不要解释、不要引号${articleCtx}

# 待润色片段
${selected}`,

      'shorten': `你是专业的文字编辑。请将【待精简片段】精简到原来的 60% 以内：
- 去掉废话、重复和空话
- 保留核心意思和关键数据
- 保持与全文语气一致
- 只输出精简后的文字，不要解释${articleCtx}

# 待精简片段
${selected}`,

      'expand': `你是专业的文字编辑。请将【待扩写片段】扩写：
- 补充一个具体案例、真实数据或操作细节，让观点更有说服力
- 扩写后不超过原来的 2 倍
- 保持与全文风格一致，不用"此外""值得注意"等套话
- 只输出扩写后的文字，不要解释${articleCtx}

# 待扩写片段
${selected}`,

      'rewrite-lead': `你是专业的文字编辑。请重写【待改写片段】的开头：
- 直接切入核心场景或痛点，不要铺垫和废话
- 像朋友聊天一样，不用"在当今时代""大家好"等套话
- 保持与全文的叙事风格和第一人称一致
- 只输出改写后的完整段落，不要解释${articleCtx}

# 待改写片段
${selected}`,
    }

    const prompt = ACTION_PROMPTS[action]
    if (!prompt) return res.status(400).json({ error: '不支持的操作类型' })

    const llmRes = await axios.post(url, {
      model,
      messages: [
        {
          role: 'system',
          content: '你是专业的文字编辑。严格按要求处理文字，只输出处理后的内容，不加任何解释、前缀或引号。风格规范：真诚、实用、人性化，像朋友聊天，不用 AI 套话。',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.65,
      max_tokens: 1200,
    }, { headers })

    res.json({ result: llmRes.data.choices[0].message.content.trim() })
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message
    console.error('[InlineEdit] 失败:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── POST /api/articles/:articleId/outline  (AI 生成写作大纲) ─────────────────
// body: { task: string, aiConfig }
// 返回: { outline: string }   Markdown 格式大纲

router.post('/:articleId/outline', async (req, res) => {
  try {
    const { task, aiConfig } = req.body
    if (!task || task.trim().length < 20) {
      return res.status(400).json({ error: '任务要求内容太短，请先填写任务要求' })
    }

    const cfg = { ...SERVER_AI_CONFIG, ...(aiConfig || {}) }
    const { url, model, headers } = buildLLMRequest(cfg)

    let agentsContent = ''
    if (fs.existsSync(AGENTS_FILE)) agentsContent = fs.readFileSync(AGENTS_FILE, 'utf-8')

    const prompt = `你是一个专业的内容策划助手。根据以下写作任务要求，生成一份清晰的文章写作大纲。

# 写作规范参考
${agentsContent}

# 写作任务要求
${task}

---

请生成一份写作大纲，要求：
1. 用 Markdown 格式输出，H2 为主章节，H3 为小节
2. 每个章节标题后用 1-2 句话说明该节要写什么、核心论点是什么
3. 总共 3-5 个主章节，结构符合任务要求
4. 不要写"大纲如下"等废话，直接输出大纲内容`

    const llmRes = await axios.post(url, {
      model,
      messages: [
        { role: 'system', content: '你是专业的内容策划助手，只输出大纲内容，Markdown 格式。' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 1024,
    }, { headers })

    res.json({ outline: llmRes.data.choices[0].message.content.trim() })
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message
    console.error('[Outline] 失败:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── POST /api/articles/:articleId/refine-materials  (AI 整理素材) ─────────────
// body: { materials: string, task: string, aiConfig }
// 返回: { refined: string }

router.post('/:articleId/refine-materials', async (req, res) => {
  try {
    const { materials, task, aiConfig } = req.body
    if (!materials || materials.trim().length < 30) {
      return res.status(400).json({ error: '素材内容太少，无法整理' })
    }

    const cfg = { ...SERVER_AI_CONFIG, ...(aiConfig || {}) }
    const { url, model, headers } = buildLLMRequest(cfg)

    const taskContext = task ? `\n\n# 写作任务（整理方向参考）\n${task}` : ''

    const prompt = `你是一个专业的素材整理助手。请把以下原始素材整理成结构化的写作参考，方便作者按图索骥写文章。${taskContext}

# 原始素材
${materials}

---

请整理成以下结构（Markdown 格式，直接输出，不要解释）：

## 核心数据与事实
（列出所有可引用的数据、时间、数字、具体事实）

## 关键观点
（提炼出 3-5 个核心论点，每条一句话）

## 可用案例
（整理出具体的案例、场景、故事，每条说明来源）

## 踩坑与注意
（整理出实际问题、风险、注意事项）

## 写作角度建议
（根据素材，建议 2-3 个差异化的写作切入角度）`

    const llmRes = await axios.post(url, {
      model,
      messages: [
        { role: 'system', content: '你是专业的素材整理助手，只输出整理后的 Markdown 内容，不加任何解释。' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 2048,
    }, { headers })

    res.json({ refined: llmRes.data.choices[0].message.content.trim() })
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message
    console.error('[RefineMaterials] 失败:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/articles/:articleId/analyses ────────────────────────────────────

router.get('/:articleId/analyses', (req, res) => {
  try {
    const { limit = '1' } = req.query
    if (limit === '1') {
      const latest = getLatestAnalysis(req.params.articleId)
      res.json(latest ? [latest] : [])
    } else {
      res.json(listAnalyses(req.params.articleId))
    }
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ── DELETE /api/articles/:articleId ──────────────────────────────────────────

router.delete('/:articleId', (req, res) => {
  try {
    const { articleId } = req.params
    const userDir = getUserDraftsDir(req.user.id)

    const directPath = path.join(userDir, articleId)
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
    const promptDir = path.join(userDir, dateDir, 'prompt')
    const rawDir    = path.join(userDir, dateDir, 'raw')

    for (const fp of [
      path.join(promptDir, `task${suffix}.md`),
      path.join(promptDir, `materials${suffix}.md`),
      path.join(rawDir,    `article_raw${suffix}.md`),
      path.join(userDir, dateDir, `title${suffix}.txt`),
    ]) {
      if (fs.existsSync(fp)) fs.unlinkSync(fp)
    }

    for (const dir of [promptDir, rawDir, path.join(userDir, dateDir)]) {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting article:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
