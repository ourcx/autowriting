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
import { DRAFTS_DIR, SERVER_AI_CONFIG, getAgentsContent } from '../config.js'
import { ensureDir, buildLLMRequest, callLLMWithRetry } from '../utils.js'
import { retrieveRelevant, formatRetrievedContext } from '../rag.js'
import { saveAnalysis, getLatestAnalysis, listAnalyses, recordTokenUsage, getEffectivePrompt, getSetting } from '../db.js'
import { authMiddleware } from '../authMiddleware.js'
import { triggerBuildIndex } from './rag.js'

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

    // 文章内容有更新时，异步触发增量 RAG 索引（不阻塞响应）
    if (article || materials) {
      triggerBuildIndex(SERVER_AI_CONFIG, req.user.id).catch(() => {})
    }

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

    if (!cfg.articleApiKey && cfg.articleProvider !== 'maas') {
      return res.status(400).json({ error: '未配置 API Key，请前往「AI 配置」页面设置后重试' })
    }
    if (cfg.articleProvider === 'maas' && !cfg.maasApiKey) {
      return res.status(400).json({ error: '未配置 MaaS API Key，请前往「AI 配置」页面设置后重试' })
    }

    const agentsContent = getAgentsContent()

    // 从数据库读取文章生成提示词（支持用户自定义覆盖）
    const generatePromptData = getEffectivePrompt('prompt-article-generate')
    const generateSystemInstruction = generatePromptData?.content || ''

    // 当前时间（北京时间格式）
    const nowGen = new Date()
    const formatterGen = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'long',
    })
    const currentDateTimeGen = formatterGen.format(nowGen)

    // 全局永久记忆
    const globalMemoryGen = getSetting('global_memory')
    const globalMemorySectionGen = globalMemoryGen ? `\n\n# 全局背景信息（永久记忆）\n${globalMemoryGen}\n` : ''

    const userPrompt = `${generateSystemInstruction ? generateSystemInstruction + '\n\n' : ''}# 写作规范（必须严格遵守）
${agentsContent}
${globalMemorySectionGen}
# 当前时间
${currentDateTimeGen}

# 本次任务要求
${task}

# 素材参考
${materials}

---

现在请直接输出完整的文章内容（纯 Markdown，只有 1 个 H1，所有 H2 带 emoji）：`

    const { url, model, headers } = buildLLMRequest(cfg)

    const response = await callLLMWithRetry(url, {
      model,
      messages: [
        { role: 'system', content: '你是一个专业的内容创作助手，擅长按照规范和要求生成高质量的文章内容。' },
        { role: 'user',   content: userPrompt },
      ],
      temperature: 0.9,
      max_tokens: 4096,
      stream: false,
    }, headers)

    const article = response.data.choices[0].message.content
    const articlePath = getArticlePath(articleId, 'article', req.user.id)
    ensureDir(path.dirname(articlePath))
    fs.writeFileSync(articlePath, article, 'utf-8')

    // 记录 token 使用
    const usage = response.data.usage
    if (usage) {
      recordTokenUsage({
        articleId, userId: req.user.id, operation: 'generate', model,
        inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      })
    }

    res.json({ article })
  } catch (error) {
    console.error('Error generating article:', error.response?.data || error.message)
    res.status(500).json({ error: error.response?.data?.error?.message || error.message })
  }
})

// ── POST /api/articles/:articleId/generate/stream  (SSE) ─────────────────────

router.post('/:articleId/generate/stream', async (req, res) => {
  const { articleId } = req.params
  // selectedRagContext: 前端手动选择后由 /api/rag/context 返回的格式化字符串
  // 若提供则跳过自动 RAG 检索，直接使用
  const { task, materials, aiConfig, selectedRagContext } = req.body

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

  // 已生成内容（用于中断时恢复）
  let fullText = ''

  // 中断时将已生成内容持久化到磁盘
  const savePartial = () => {
    if (fullText.length < 50) return
    try {
      const articlePath = getArticlePath(articleId, 'article', req.user.id)
      ensureDir(path.dirname(articlePath))
      fs.writeFileSync(articlePath, fullText, 'utf-8')
    } catch (e) {
      console.warn('[Stream] 中断时保存部分内容失败:', e.message)
    }
  }

  try {
    if (!task || !materials) {
      send('error', { message: '任务和素材不能为空' })
      return res.end()
    }

    const cfg = { ...SERVER_AI_CONFIG, ...(aiConfig || {}) }

    if (!cfg.articleApiKey && cfg.articleProvider !== 'maas') {
      send('error', { message: '未配置 API Key，请前往「AI 配置」页面设置后重试' })
      return res.end()
    }
    if (cfg.articleProvider === 'maas' && !cfg.maasApiKey) {
      send('error', { message: '未配置 MaaS API Key，请前往「AI 配置」页面设置后重试' })
      return res.end()
    }

    // ── 1. RAG 上下文（仅使用前端手动选择的，不再自动检索） ──────────────────
    const ragSection = selectedRagContext ? `\n\n${selectedRagContext}\n` : ''
    if (selectedRagContext) {
      send('status', { step: 'rag', message: `已注入 ${selectedRagContext.split('###').length - 1} 篇往期文章` })
    }

    // ── 2. 读取写作规范 + 数据库提示词 ──────────────────────────────────────
    const agentsContent = getAgentsContent()

    // 从数据库读取文章生成提示词（支持用户自定义覆盖）
    const streamGeneratePromptData = getEffectivePrompt('prompt-article-generate')
    const streamGenerateInstruction = streamGeneratePromptData?.content || ''

    // 当前时间（北京时间格式）
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'long',
    })
    const currentDateTime = formatter.format(now)

    // 全局永久记忆
    const globalMemory = getSetting('global_memory')
    const globalMemorySection = globalMemory ? `\n\n# 全局背景信息（永久记忆）\n${globalMemory}\n` : ''

    const userPrompt = `${streamGenerateInstruction ? streamGenerateInstruction + '\n\n' : ''}# 写作规范（必须严格遵守）
${agentsContent}
${ragSection}${globalMemorySection}
# 当前时间
${currentDateTime}

# 本次任务要求
${task}

# 素材参考
${materials}

---

现在请直接输出完整的文章内容（纯 Markdown，只有 1 个 H1，所有 H2 带 emoji）：`

    // ── 3. 构造请求参数（统一函数）──────────────────────────────────────────
    const { url, model, headers } = buildLLMRequest(cfg)

    // ── 4. 流式请求上游 LLM ───────────────────────────────────────────────────
    send('status', { step: 'generate', message: 'AI 正在生成文章...' })

    const upstreamRes = await axios.post(
      url,
      {
        model,
        messages: [
          { role: 'system', content: '你是一个专业的内容创作助手，擅长按照规范和要求生成高质量的文章内容。' },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 0.9,
        max_tokens: 4096,
        stream: true,
      },
      { headers, responseType: 'stream' }
    )

    // ── 5. 逐行解析 OpenAI SSE，转发给前端 ───────────────────────────────────
    let buffer = ''

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

      // 流式结束时 token 数无法精确获取，记录估算值（1 token ≈ 1.5 个汉字）
      recordTokenUsage({
        articleId, userId: req.user.id, operation: 'generate', model,
        outputTokens: Math.ceil(fullText.length / 1.5),
      })

      send('done', { article: fullText, ragCount: selectedRagContext ? 1 : 0 })
      res.end()
    })

    upstreamRes.data.on('error', (e) => {
      console.error('[Stream] 上游流错误:', e.message)
      savePartial()  // 中断时保存已生成内容
      send('error', { message: e.message, partial: fullText.length > 0 })
      res.end()
    })

    // 客户端主动断开时也保存
    req.on('close', () => {
      if (!res.writableEnded) savePartial()
    })

  } catch (error) {
    console.error('[Stream] 生成失败:', error.response?.data || error.message)
    savePartial()
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
        userId: req.user.id,
      })
    } catch { /* 无索引时跳过 */ }

    const similarContext = similarArticles.length
      ? `\n\n# 往期相似文章片段（用于风格对比）\n` +
        similarArticles.map((d, i) =>
          `### 片段${i + 1}（${d.dir} · 相似度${Math.round((1 - d.score) * 100)}%）\n${d.content}`
        ).join('\n\n')
      : ''

    // ── 2. 读取写作规范 + 数据库提示词 ──────────────────────────────────────
    const agentsContent = getAgentsContent()

    // 从数据库读取文章分析提示词（支持用户自定义覆盖）
    const analyzePromptData = getEffectivePrompt('prompt-article-analyze')
    const analyzeInstruction = analyzePromptData?.content || ''

    const taskContext = task ? `\n\n# 本次写作任务\n${task}` : ''

    const prompt = `${analyzeInstruction ? analyzeInstruction + '\n\n' : '你是一个专业的文章审核助手，擅长分析微信公众号文章的质量。请对以下文章进行深度分析，返回 JSON 格式结果。\n\n'}# 写作规范（判断依据）
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
  "topSuggestion": <最重要的一条改进建议，不超过80字>,
  "uiBlocks": [
    根据文章的实际问题，从以下类型中选择 1-4 个最有价值的 UI 块，按优先级排序。

    如果发现 AI 套话（issues 中有 type 包含"套话"或"AI腔"的 error/warn 级别问题），必须包含：
    {
      "type": "cliche-diff",
      "title": "套话对比修改",
      "items": [
        {
          "original": <原文中的套话句子，完整句子>,
          "suggestion": <具体的改写建议，给出替换后的句子>
        }
      ]
    }

    如果发现缺乏数据支撑（issues 中有关于"数据""案例""具体"的问题），必须包含：
    {
      "type": "data-suggestion",
      "title": "数据补充建议",
      "items": [
        {
          "claim": <文章中的空泛表述，原文引用>,
          "dataHint": <建议补充什么类型的数据或案例，具体说明>
        }
      ]
    }

    如果发现结构问题（issues 中有关于"结构""逻辑""段落"的问题），必须包含：
    {
      "type": "structure-map",
      "title": "结构诊断",
      "sections": [
        {
          "heading": <段落标题或「开头」「结尾」>,
          "status": <"good"|"warn"|"error">,
          "note": <一句话评价，不超过30字>
        }
      ]
    }

    如果文章开头有套话或不够直接，必须包含：
    {
      "type": "lead-rewrite",
      "title": "开头改写建议",
      "original": <原文开头段落，完整引用>,
      "rewritten": <改写后的开头，直接切入主题，保持原意>
    }

    如果文章整体质量不错（overall >= 75），可以包含：
    {
      "type": "highlight-quote",
      "title": "文章金句",
      "quotes": [<文章中最有力的 1-3 句话，原文引用>]
    }

    注意：uiBlocks 数组只包含真正适用的块，不要强行凑数。如果文章质量很好，可以只返回 highlight-quote。
  ]
}`

    // ── 3. 调用 LLM（带重试）──────────────────────────────────────────────────
    const { url, model, headers } = buildLLMRequest(cfg)

    const llmRes = await callLLMWithRetry(url, {
      model,
      messages: [
        { role: 'system', content: '你是专业的文章分析助手，只输出合法 JSON，不加任何解释或 Markdown 代码块。' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 3500,
    }, headers)

    const raw = llmRes.data.choices[0].message.content.trim()
    // 去掉可能的 ```json 包裹
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    let result
    try {
      result = JSON.parse(cleaned)
    } catch {
      // JSON 解析失败时尝试截断修复（uiBlocks 过长可能被截断）
      const truncated = cleaned.replace(/,?\s*"uiBlocks"\s*:[\s\S]*$/, '') + '}'
      result = JSON.parse(truncated)
    }

    const fullResult = { ...result, ragCount: similarArticles.length }

    // 自动保存到 SQLite
    try { saveAnalysis(articleId, fullResult) } catch (e) { console.warn('[Analyze] 保存分析结果失败:', e.message) }

    // 记录 token 使用
    const usage = llmRes.data.usage
    if (usage) {
      recordTokenUsage({
        articleId, userId: req.user.id, operation: 'analyze', model,
        inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      })
    }

    res.json(fullResult)
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message
    console.error('[Analyze] 分析失败:', msg)
    res.status(500).json({ error: msg })
  }
})

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

    // 从数据库读取对应内联编辑提示词（支持用户自定义覆盖）
    const editPromptMap = {
      'polish':       'prompt-edit-polish',
      'shorten':      'prompt-edit-shorten',
      'expand':       'prompt-edit-expand',
      'rewrite-lead': 'prompt-edit-rewrite-lead',
    }
    const editPromptId = editPromptMap[action]
    const editPromptData = editPromptId ? getEffectivePrompt(editPromptId) : null
    const editCustomContent = editPromptData?.content || ''

    const BUILTIN_ACTION_PROMPTS = {
      'polish': `你是专业的文字编辑。请对【待润色片段】进行润色：
- 去掉 AI 感、套话、被动句
- 保持第一人称「我」
- 保持与全文风格一致（真诚、实用、像朋友聊天）
- 只输出润色后的文字，不要解释、不要引号`,

      'shorten': `你是专业的文字编辑。请将【待精简片段】精简到原来的 60% 以内：
- 去掉废话、重复和空话
- 保留核心意思和关键数据
- 保持与全文语气一致
- 只输出精简后的文字，不要解释`,

      'expand': `你是专业的文字编辑。请将【待扩写片段】扩写：
- 补充一个具体案例、真实数据或操作细节，让观点更有说服力
- 扩写后不超过原来的 2 倍
- 保持与全文风格一致，不用"此外""值得注意"等套话
- 只输出扩写后的文字，不要解释`,

      'rewrite-lead': `你是专业的文字编辑。请重写【待改写片段】的开头：
- 直接切入核心场景或痛点，不要铺垫和废话
- 像朋友聊天一样，不用"在当今时代""大家好"等套话
- 保持与全文的叙事风格和第一人称一致
- 只输出改写后的完整段落，不要解释`,
    }

    const ACTION_PROMPTS = {
      'polish':       `${editCustomContent || BUILTIN_ACTION_PROMPTS['polish']}${articleCtx}\n\n# 待润色片段\n${selected}`,
      'shorten':      `${editCustomContent || BUILTIN_ACTION_PROMPTS['shorten']}${articleCtx}\n\n# 待精简片段\n${selected}`,
      'expand':       `${editCustomContent || BUILTIN_ACTION_PROMPTS['expand']}${articleCtx}\n\n# 待扩写片段\n${selected}`,
      'rewrite-lead': `${editCustomContent || BUILTIN_ACTION_PROMPTS['rewrite-lead']}${articleCtx}\n\n# 待改写片段\n${selected}`,
    }

    const prompt = ACTION_PROMPTS[action]
    if (!prompt) return res.status(400).json({ error: '不支持的操作类型' })

    const llmRes = await callLLMWithRetry(url, {
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
    }, headers)

    const usage = llmRes.data.usage
    if (usage) {
      recordTokenUsage({
        articleId: req.params.articleId, userId: req.user.id, operation: 'edit',
        model, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      })
    }

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

    const agentsContent = getAgentsContent()

    // 从数据库读取大纲生成提示词（支持用户自定义覆盖）
    const outlinePromptData = getEffectivePrompt('prompt-outline-generate')
    const outlineInstruction = outlinePromptData?.content || ''

    const prompt = `${outlineInstruction ? outlineInstruction + '\n\n' : '你是一个专业的内容策划助手。根据以下写作任务要求，生成一份清晰的文章写作大纲。\n\n'}# 写作规范参考
${agentsContent}

# 写作任务要求
${task}

---

请生成一份写作大纲，要求：
1. 用 Markdown 格式输出，H2 为主章节，H3 为小节
2. 每个章节标题后用 1-2 句话说明该节要写什么、核心论点是什么
3. 总共 3-5 个主章节，结构符合任务要求
4. 不要写"大纲如下"等废话，直接输出大纲内容`

    const llmRes = await callLLMWithRetry(url, {
      model,
      messages: [
        { role: 'system', content: '你是专业的内容策划助手，只输出大纲内容，Markdown 格式。' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.8,
      max_tokens: 1024,
    }, headers)

    const usage = llmRes.data.usage
    if (usage) {
      recordTokenUsage({
        articleId: req.params.articleId, userId: req.user.id, operation: 'outline',
        model, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      })
    }

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

    // 从数据库读取素材整理提示词（支持用户自定义覆盖）
    const refinePromptData = getEffectivePrompt('prompt-materials-organize')
    const refineInstruction = refinePromptData?.content || ''

    const taskContext = task ? `\n\n# 写作任务（整理方向参考）\n${task}` : ''

    const prompt = `${refineInstruction ? refineInstruction + taskContext : `你是一个专业的素材整理助手。请把以下原始素材整理成结构化的写作参考，方便作者按图索骥写文章。${taskContext}

**整理要求：**
1. 去除完全重复的内容，合并表达相似的观点（合并时保留最完整的表述）
2. 删除泛泛而谈的废话，只保留有具体支撑的内容
3. 数据、案例务必保留原始数字，不要模糊化
4. 结构化输出，每条信息独立成行，便于写作时直接引用`}

# 原始素材
${materials}

---

请整理成以下结构（Markdown 格式，直接输出，不要解释，不要重复内容）：

## 核心数据与事实
（列出所有可引用的数据、时间、数字、具体事实；重复数据只保留一条）

## 关键观点
（提炼出 3-5 个核心论点，每条一句话；相似观点合并为一条）

## 可用案例
（整理出具体的案例、场景、故事，每条说明来源；相似案例合并）

## 踩坑与注意
（整理出实际问题、风险、注意事项；去除重复警告）

## 写作角度建议
（根据素材，建议 2-3 个差异化的写作切入角度，避免大而全）`

    const llmRes = await callLLMWithRetry(url, {
      model,
      messages: [
        { role: 'system', content: '你是专业的素材整理助手，只输出整理后的 Markdown 内容，不加任何解释。' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.5,
      max_tokens: 2048,
    }, headers)

    const usage = llmRes.data.usage
    if (usage) {
      recordTokenUsage({
        articleId: req.params.articleId, userId: req.user.id, operation: 'refine',
        model, inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      })
    }

    res.json({ refined: llmRes.data.choices[0].message.content.trim() })
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message
    console.error('[RefineMaterials] 失败:', msg)
    res.status(500).json({ error: msg })
  }
})

// ── POST /api/articles/:articleId/deai/stream  (去 AI 味复审 SSE) ─────────────
// body: { article: string, aiConfig }
// SSE events: status | chunk | done | error

router.post('/:articleId/deai/stream', async (req, res) => {
  const { articleId } = req.params
  const { article, aiConfig } = req.body

  // SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  let fullText = ''

  try {
    if (!article || article.trim().length < 100) {
      send('error', { message: '文章内容太短，无法进行去 AI 味处理（至少 100 字）' })
      return res.end()
    }

    const cfg = { ...SERVER_AI_CONFIG, ...(aiConfig || {}) }

    if (!cfg.articleApiKey && cfg.articleProvider !== 'maas') {
      send('error', { message: '未配置 API Key，请前往「AI 配置」页面设置后重试' })
      return res.end()
    }
    if (cfg.articleProvider === 'maas' && !cfg.maasApiKey) {
      send('error', { message: '未配置 MaaS API Key，请前往「AI 配置」页面设置后重试' })
      return res.end()
    }

    // 从数据库读取去 AI 味提示词（支持用户自定义覆盖）
    const deaiPromptData = getEffectivePrompt('prompt-article-deai')
    const deaiInstruction = deaiPromptData?.content || ''

    const userPrompt = `${deaiInstruction}

# 待处理文章

${article}`

    const { url, model, headers } = buildLLMRequest(cfg)

    send('status', { step: 'deai', message: 'AI 正在去除 AI 腔调...' })

    const upstreamRes = await axios.post(
      url,
      {
        model,
        messages: [
          { role: 'system', content: '你是专业的文字编辑，只输出修改后的完整文章（Markdown 格式），不加任何解释或对比说明。' },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 0.6,
        max_tokens: 4096,
        stream: true,
      },
      { headers, responseType: 'stream' }
    )

    let buffer = ''

    upstreamRes.data.on('data', (chunk) => {
      buffer += chunk.toString('utf-8')
      const lines = buffer.split('\n')
      buffer = lines.pop()

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
        } catch { /* 忽略解析失败的行 */ }
      }
    })

    upstreamRes.data.on('end', () => {
      recordTokenUsage({
        articleId, userId: req.user.id, operation: 'deai', model,
        outputTokens: Math.ceil(fullText.length / 1.5),
      })
      send('done', { article: fullText })
      res.end()
    })

    upstreamRes.data.on('error', (e) => {
      console.error('[DeAI] 上游流错误:', e.message)
      send('error', { message: e.message })
      res.end()
    })

    req.on('close', () => { if (!res.writableEnded) res.end() })

  } catch (error) {
    console.error('[DeAI] 失败:', error.response?.data || error.message)
    const msg = error.response?.data?.error?.message || error.message
    send('error', { message: msg })
    res.end()
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
