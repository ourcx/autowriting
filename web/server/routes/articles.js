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
    // 今日头条文章路径（article_raw.md → article_toutiao.md）
    const toutiaoPath   = articlePath ? articlePath.replace('article_raw', 'article_toutiao') : null

    ensureDir(path.dirname(taskPath))
    ensureDir(path.dirname(materialsPath))
    ensureDir(path.dirname(articlePath))

    res.json({
      task:           fs.existsSync(taskPath)      ? fs.readFileSync(taskPath,      'utf-8') : '',
      materials:      fs.existsSync(materialsPath) ? fs.readFileSync(materialsPath, 'utf-8') : '',
      article:        fs.existsSync(articlePath)   ? fs.readFileSync(articlePath,   'utf-8') : '',
      title:          fs.existsSync(titlePath)     ? fs.readFileSync(titlePath,     'utf-8') : '',
      articleToutiao: toutiaoPath && fs.existsSync(toutiaoPath) ? fs.readFileSync(toutiaoPath, 'utf-8') : '',
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
    const { task, materials, article, title, articleToutiao } = req.body
    const uid = req.user.id

    const taskPath      = getArticlePath(articleId, 'task',      uid)
    const materialsPath = getArticlePath(articleId, 'materials', uid)
    const articlePath   = getArticlePath(articleId, 'article',   uid)
    const titlePath     = getArticlePath(articleId, 'title',     uid)
    const toutiaoPath   = articlePath ? articlePath.replace('article_raw', 'article_toutiao') : null

    ensureDir(path.dirname(taskPath))
    ensureDir(path.dirname(materialsPath))
    ensureDir(path.dirname(articlePath))

    if (task)           fs.writeFileSync(taskPath,      task,           'utf-8')
    if (materials)      fs.writeFileSync(materialsPath, materials,      'utf-8')
    if (article)        fs.writeFileSync(articlePath,   article,        'utf-8')
    if (title)          fs.writeFileSync(titlePath,     title,          'utf-8')
    if (articleToutiao && toutiaoPath) fs.writeFileSync(toutiaoPath, articleToutiao, 'utf-8')

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
// 支持同时生成公众号 + 今日头条两篇文章
// SSE 事件区分：
//   platform: 'wechat'   → 公众号文章 chunk/done
//   platform: 'toutiao'  → 今日头条文章 chunk/done

router.post('/:articleId/generate/stream', async (req, res) => {
  const { articleId } = req.params
  // selectedRagContext: 前端手动选择后由 /api/rag/context 返回的格式化字符串
  // 若提供则跳过自动 RAG 检索，直接使用
  // platforms: 'both' | 'wechat' | 'toutiao'，控制生成哪些平台
  const { task, materials, aiConfig, selectedRagContext, platforms = 'both' } = req.body

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
  let fullTextToutiao = ''

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

    // 今日头条提示词
    const toutiaoPromptData = getEffectivePrompt('prompt-article-generate-toutiao')
    const toutiaoInstruction = toutiaoPromptData?.content || ''

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

    // ── 公众号 prompt ──────────────────────────────────────────────────────────
    const wechatPrompt = `${streamGenerateInstruction ? streamGenerateInstruction + '\n\n' : ''}# 写作规范（必须严格遵守）
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

    // ── 今日头条 prompt（不注入 RAG，使用相同素材但不同提示词）──────────────
    const toutiaoPrompt = `${toutiaoInstruction ? toutiaoInstruction + '\n\n' : ''}${globalMemorySection}
# 当前时间
${currentDateTime}

# 本次任务要求
${task}

# 素材参考
${materials}

---

现在请直接输出完整的今日头条文章内容（纯 Markdown，只有 1 个 H1，H2 可带 emoji，标题要有吸引力）：`

    // ── 3. 构造请求参数（统一函数）──────────────────────────────────────────
    const { url, model, headers } = buildLLMRequest(cfg)

    // ── 4. 按需生成各平台文章 ─────────────────────────────────────────────────

    // 辅助：流式生成单个平台
    async function streamPlatform(prompt, systemMsg, platformKey, isLast) {
      send('status', { step: 'generate', message: `AI 正在生成${platformKey === 'wechat' ? '公众号' : '今日头条'}文章...`, platform: platformKey })

      const res2 = await axios.post(
        url,
        {
          model,
          messages: [
            { role: 'system', content: systemMsg },
            { role: 'user',   content: prompt },
          ],
          temperature: 0.9,
          max_tokens: 4096,
          stream: true,
        },
        { headers, responseType: 'stream' }
      )

      await new Promise((resolve, reject) => {
        let buffer = ''
        let fullContent = ''

        res2.data.on('data', (chunk) => {
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
                fullContent += content
                if (platformKey === 'wechat') fullText = fullContent
                else fullTextToutiao = fullContent
                send('chunk', { text: content, platform: platformKey })
              }
            } catch { /* ignore */ }
          }
        })

        res2.data.on('end', () => {
          // 持久化
          try {
            const articlePath = getArticlePath(articleId, 'article', req.user.id)
            if (platformKey === 'wechat') {
              ensureDir(path.dirname(articlePath))
              fs.writeFileSync(articlePath, fullContent, 'utf-8')
            } else {
              const toutiaoPath = articlePath.replace('article_raw', 'article_toutiao')
              ensureDir(path.dirname(toutiaoPath))
              fs.writeFileSync(toutiaoPath, fullContent, 'utf-8')
            }
          } catch (e) {
            console.error(`[Stream] 写入${platformKey}文章失败:`, e.message)
          }
          recordTokenUsage({
            articleId, userId: req.user.id, operation: 'generate', model,
            outputTokens: Math.ceil(fullContent.length / 1.5),
          })
          send('done', { article: fullContent, platform: platformKey, ragCount: platformKey === 'wechat' && selectedRagContext ? 1 : 0 })
          if (isLast) res.end()
          resolve()
        })

        res2.data.on('error', (e) => {
          console.error(`[Stream] ${platformKey}上游流错误:`, e.message)
          reject(e)
        })

        req.on('close', () => {
          if (!res.writableEnded) savePartial()
        })
      })
    }

    if (platforms === 'wechat') {
      // 只生成公众号
      await streamPlatform(
        wechatPrompt,
        '你是一个专业的内容创作助手，擅长按照规范和要求生成高质量的文章内容。',
        'wechat',
        true
      )
    } else if (platforms === 'toutiao') {
      // 只生成今日头条
      await streamPlatform(
        toutiaoPrompt,
        '你是一个专业的今日头条内容创作者，擅长写热点、情感、故事类文章，标题吸引人，内容接地气。',
        'toutiao',
        true
      )
    } else {
      // 两者都生成：先公众号，再今日头条
      await streamPlatform(
        wechatPrompt,
        '你是一个专业的内容创作助手，擅长按照规范和要求生成高质量的文章内容。',
        'wechat',
        false
      )
      await streamPlatform(
        toutiaoPrompt,
        '你是一个专业的今日头条内容创作者，擅长写热点、情感、故事类文章，标题吸引人，内容接地气。',
        'toutiao',
        true
      )
    }

  } catch (error) {
    console.error('[Stream] 生成失败:', error.response?.data || error.message)
    savePartial()
    const msg = error.response?.data?.error?.message || error.message
    send('error', { message: msg })
    res.end()
  }
})

// ── POST /api/articles/:articleId/analyze  (AI 内容分析，SSE 流式) ───────────

router.post('/:articleId/analyze', async (req, res) => {
  // SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const { articleId } = req.params
    const { article, task, aiConfig } = req.body

    if (!article || article.trim().length < 100) {
      send('error', { message: '文章内容太短，无法分析' })
      return res.end()
    }

    const cfg = { ...SERVER_AI_CONFIG, ...(aiConfig || {}) }

    // ── 1. RAG 检索（进度提示）──────────────────────────────────────────────
    send('progress', { step: 'rag', message: '正在检索往期相似文章...' })
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

请严格按照以下 JSON 结构返回分析结果，不要有任何额外文字。

uiBlocks 字段说明（必须根据实际问题选择，不要强行凑数）：
- 发现 AI 套话问题时，加入 type="cliche-diff" 块，items 列出每处套话的原句和改写建议
- 发现缺乏数据支撑时，加入 type="data-suggestion" 块，items 列出空泛表述和补充建议
- 发现结构/逻辑问题时，加入 type="structure-map" 块，sections 列出每个段落的诊断
- 发现开头有套话或不够直接时，加入 type="lead-rewrite" 块，给出原文和改写版本
- 文章整体质量好（overall>=75）时，加入 type="highlight-quote" 块，摘录 1-3 句金句

返回格式（严格合法 JSON，所有字段都必须有值）：

{
  "scores": {
    "overall": 75,
    "style": 70,
    "structure": 80,
    "actionability": 75,
    "originality": 65
  },
  "wordCount": 1800,
  "readingMinutes": 9,
  "strengths": ["优点1", "优点2", "优点3"],
  "issues": [
    {
      "level": "warn",
      "type": "AI套话",
      "quote": "原文问题片段",
      "suggestion": "具体改进建议"
    }
  ],
  "styleMatch": {
    "score": 70,
    "note": "风格说明"
  },
  "topSuggestion": "最重要的改进建议",
  "uiBlocks": [
    {
      "type": "cliche-diff",
      "title": "套话对比修改",
      "items": [{ "original": "原文套话句子", "suggestion": "改写后的句子" }]
    },
    {
      "type": "data-suggestion",
      "title": "数据补充建议",
      "items": [{ "claim": "文章中的空泛表述", "dataHint": "建议补充什么数据或案例" }]
    },
    {
      "type": "structure-map",
      "title": "结构诊断",
      "sections": [{ "heading": "开头", "status": "warn", "note": "一句话评价" }]
    },
    {
      "type": "lead-rewrite",
      "title": "开头改写建议",
      "original": "原文开头段落",
      "rewritten": "改写后的开头"
    },
    {
      "type": "highlight-quote",
      "title": "文章金句",
      "quotes": ["金句1", "金句2"]
    }
  ]
}

注意：上面是完整格式示例，实际返回时 uiBlocks 只包含真正适用的块（1-4个），scores 和 issues 等字段填入真实分析值。`

    // ── 3. 调用 LLM（流式）──────────────────────────────────────────────────
    const { url, model, headers } = buildLLMRequest(cfg)
    send('progress', { step: 'llm', message: 'AI 正在深度分析...' })

    const upstreamRes = await axios.post(url, {
      model,
      messages: [
        { role: 'system', content: '你是专业的文章分析助手，只输出合法 JSON，不加任何解释或 Markdown 代码块。' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
      stream: true,
    }, { headers, responseType: 'stream', timeout: 120000 })

    // ── 4. 逐 chunk 转发 + 增量解析 partial-result ───────────────────────────
    let fullText = ''
    let inputTokens = 0, outputTokens = 0
    let lastPartialSent = 0  // 上次发送 partial-result 时的文本长度

    // 尝试从不完整 JSON 中提取已完成的字段
    function tryParsePartial(text) {
      const cleaned = text.trim().replace(/^```(?:json)?\n?/, '')
      // 尝试直接解析
      try { return JSON.parse(cleaned) } catch {}
      // 尝试补全末尾
      const attempts = [
        cleaned + '"}]}',
        cleaned + '"]}',
        cleaned + ']}',
        cleaned + '}',
        cleaned.replace(/,?\s*"uiBlocks"\s*:[\s\S]*$/, '}'),
        cleaned.replace(/,?\s*"[^"]*"\s*:[\s\S]*$/, '}'),
      ]
      for (const attempt of attempts) {
        try { return JSON.parse(attempt) } catch {}
      }
      return null
    }

    await new Promise((resolve, reject) => {
      let lineBuf = ''
      upstreamRes.data.on('data', (chunk) => {
        lineBuf += chunk.toString()
        const lines = lineBuf.split('\n')
        lineBuf = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (!trimmed.startsWith('data:')) continue
          try {
            const parsed = JSON.parse(trimmed.slice(5).trim())
            const delta = parsed.choices?.[0]?.delta?.content || ''
            if (delta) {
              fullText += delta
              // 每积累 200 字符尝试一次增量解析，发送 partial-result
              if (fullText.length - lastPartialSent > 200) {
                const partial = tryParsePartial(fullText)
                if (partial && (partial.scores || partial.uiBlocks)) {
                  send('partial-result', { ...partial, ragCount: similarArticles.length })
                  lastPartialSent = fullText.length
                }
              }
            }
            if (parsed.usage) {
              inputTokens  = parsed.usage.prompt_tokens     || 0
              outputTokens = parsed.usage.completion_tokens || 0
            }
          } catch { /* 忽略解析失败的行 */ }
        }
      })
      upstreamRes.data.on('end', resolve)
      upstreamRes.data.on('error', reject)
    })

    // ── 5. 解析完整 JSON ──────────────────────────────────────────────────────
    const cleaned = fullText.trim()
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '')

    let result
    try {
      result = JSON.parse(cleaned)
    } catch {
      // 截断修复：uiBlocks 可能被截断
      const truncated = cleaned.replace(/,?\s*"uiBlocks"\s*:[\s\S]*$/, '') + '}'
      try {
        result = JSON.parse(truncated)
      } catch (e2) {
        send('error', { message: 'AI 返回格式异常，请重试' })
        return res.end()
      }
    }

    const fullResult = { ...result, ragCount: similarArticles.length }

    // ── 6. 保存 + token 用量 ──────────────────────────────────────────────────
    try { saveAnalysis(articleId, fullResult) } catch (e) { console.warn('[Analyze] 保存失败:', e.message) }

    if (inputTokens || outputTokens) {
      recordTokenUsage({
        articleId, userId: req.user.id, operation: 'analyze', model,
        inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
      })
    }

    // ── 7. 发送最终结果 ───────────────────────────────────────────────────────
    send('result', fullResult)
    res.end()

  } catch (error) {
    const status = error.response?.status
    const msg = error.response?.data?.error?.message || error.message
    console.error('[Analyze] 分析失败:', { status, msg })
    send('error', { message: `分析失败 (${status || 'network'}): ${msg}` })
    res.end()
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
