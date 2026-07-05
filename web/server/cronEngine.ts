// @ts-nocheck
/**
 * Cron 任务执行引擎
 * 负责：
 *  1. 调度所有已启用的 cron 任务（node-cron）
 *  2. 执行单次任务流程：热点抓取 → 文章生成 → 样式生成 → 文章优化 → 推送草稿箱
 *  3. 写入执行日志
 */
import cron from 'node-cron'
import axios from 'axios'
import path from 'path'
import fs from 'fs'
import {
  db,
  listCronJobs, getCronJob,
  createCronLog, updateCronLog,
  updateCronJobRunStats,
  getSetting,
} from './db.ts'
import { SERVER_AI_CONFIG, DRAFTS_DIR, getWritingGuideContent } from './config.ts'
import { 
  buildLLMRequest, 
  callLLMWithRetry,
  ensureDir,
  collectMaterials,
  formatMaterialsAsMarkdown,
} from './utils/index.ts'
import { nowDay } from './utils'
// 调度实例 Map<jobId, ScheduledTask>
const _scheduledTasks = new Map()

// ── 工具 ─────────────────────────────────────────────────────────────────────

/**
 * 合并 AI 配置（优先级从低到高）：
 *   1. 服务端环境变量 SERVER_AI_CONFIG（.env）
 *   2. settings 表里的 ai-config（用户在「AI 配置」页面保存的，已持久化到 DB）
 *   3. 任务专属 aiConfig（cron_jobs.ai_config，只覆盖任务级别差异）
 */
function mergeAiConfig(jobAiConfig = {}) {
  let dbConfig = {}
  try {
    const saved = getSetting('ai-config')
    if (saved && typeof saved === 'object') dbConfig = saved
  } catch { /* 读库失败时静默回退 */ }
  return { ...SERVER_AI_CONFIG, ...dbConfig, ...jobAiConfig }
}

function formatDate(d = new Date()) {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

/**
 * 获取微信 access_token（直接调用微信接口，不依赖 wechat.js 路由的内存缓存）
 * cron 任务在后台跑，凭据存在数据库，每次重新获取（token 有效期 2h）
 */
const _tokenCache = new Map()

async function getWxToken(appId:string, appSecret:string) {
  const now = Math.floor(Date.now() / 1000)
  const cached = _tokenCache.get(appId)
  if (cached && cached.exp - now > 300) return cached.token

  const resp = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
    params: { grant_type: 'client_credential', appid: appId, secret: appSecret },
    timeout: 8000,
  })
  if (resp.data.errcode) throw new Error(`微信 Token 获取失败: [${resp.data.errcode}] ${resp.data.errmsg}`)
  const token = resp.data.access_token
  _tokenCache.set(appId, { token, exp: now + (resp.data.expires_in || 7200) })
  return token
}

// ── 步骤 0：智能素材收集（可选）─────────────────────────────────────────────

async function collectMaterialsIfEnabled(job, topic, aiConfig) {
  // 检查是否启用了智能素材收集
  if (!job.enableMaterialsCollection) {
    return null
  }

  try {
    // collectMaterials 通过 Provider 架构自动检测可用的搜索引擎
    // 不再需要 bingApiKey/jinaApiKey 参数，配置从环境变量和 AI 配置中获取
    const dataset = await collectMaterials(topic, aiConfig)
    return dataset
  } catch (err) {
    // 素材收集失败不阻断整体流程，只记录警告
    console.warn(`[Cron:${job.name}] 素材收集失败: ${err.message}`)
    return null
  }
}

// ── 步骤 1：热点抓取 ─────────────────────────────────────────────────────────

async function fetchTrending(job, aiConfig) {
  // 如果用户指定了固定主题，直接返回
  if (job.topic && job.topic.trim()) {
    return job.topic.trim()
  }

  // 校验 AI 配置（Key 必须在任务的 aiConfig 中显式配置）
  const isMaas = aiConfig.articleProvider === 'maas'
  if (isMaas) {
    if (!aiConfig.maasApiKey) throw new Error('AI 未配置：请编辑此任务，在「AI 接口」区块填写 MaaS API Key')
  } else {
    if (!aiConfig.articleApiKey) throw new Error('AI 未配置：请编辑此任务，在「AI 接口」区块填写 API Key')
  }

  const { url, model, headers } = buildLLMRequest(aiConfig)
  const today = nnowDay()

  let resp
  try {
    resp = await callLLMWithRetry(url, {
      model,
      messages: [
        {
          role: 'system',
          content: '你是一个内容策划专家，专注于教育、AI、效率工具等领域。',
        },
        {
          role: 'user',
          content: `今天是 ${today}，请为微信公众号生成一个当前热门的文章选题。
要求：
1. 与 AI工具、效率提升、教育或大学生相关
2. 选题要有时效性和话题性
3. 只输出选题标题和简短的写作角度说明，格式：
选题：xxx
角度：xxx`,
        },
      ],
      temperature: 0.9,
      max_tokens: 300,
    }, headers)
  } catch (err) {
    const status = err.response?.status
    if (status === 401) throw new Error('AI API Key 无效或已过期（401），请前往「AI 配置」页面重新填写')
    if (status === 403) throw new Error('AI API Key 无访问权限（403），请检查 Key 是否正确')
    if (status === 429) throw new Error('AI 调用频率超限（429），请稍后再试或更换 API Key')
    throw err
  }

  return resp.data.choices[0].message.content.trim()
}

// ── 步骤 2：生成文章 ─────────────────────────────────────────────────────────

async function generateArticle(topic: string, aiConfig: any, materialsDataset: any = null) {
  // 写作规范：可选注入，没配置就跳过整段
  const writingGuide = getWritingGuideContent()
  const writingGuideSection = writingGuide ? `# 写作规范（必须严格遵守）\n${writingGuide}\n\n` : ''
  
  // 素材数据集：如果有，注入到提示词中
  let materialsSection = ''
  if (materialsDataset) {
    const materialsMarkdown = formatMaterialsAsMarkdown(materialsDataset)
    materialsSection = `# 参考素材（从网络搜索和爬取获得）\n\n${materialsMarkdown}\n\n**重要提示**：\n- 以上素材仅供参考，请提取关键信息和数据\n- 必须用自己的语言重新组织，不要直接复制粘贴\n- 引用数据时要标注来源（如"根据某网站报道"）\n- 保持客观和真实，不要编造不存在的信息\n\n`
  }
  
  const { url, model, headers } = buildLLMRequest(aiConfig)
  const today = nowDay()

  const resp = await callLLMWithRetry(url, {
    model,
    messages: [
      {
        role: 'system',
        content: '你是一个专业的微信公众号内容创作者，擅长写真诚、实用、有干货的文章。你善于从网络素材中提取关键信息，结合实际案例，创作出有深度、有价值的内容。',
      },
      {
        role: 'user',
        content: `${writingGuideSection}${materialsSection}# 今日选题
${topic}

# 写作要求
- 今天是 ${today}
- 文章面向大学生家长、老师，25-60 岁读者群
- 字数 800-1500 字
- 有具体案例和数据支撑
- 结尾有明确的行动建议
${materialsDataset ? '- 充分利用上面提供的参考素材，但要用自己的语言重新表达' : ''}

---

请直接输出完整文章（纯 Markdown，只有 1 个 H1，所有 H2 带 emoji）：`,
      },
    ],
    temperature: 0.85,
    max_tokens: 4096,
  }, headers)

  return resp.data.choices[0].message.content.trim()
}

// ── 步骤 3：生成 CSS 样式 ─────────────────────────────────────────────────────

async function generateStyle(stylePrompt, aiConfig) {
  if (!stylePrompt) {
    // 返回一个简洁默认样式
    return `#wemd { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; font-size: 15px; line-height: 1.8; color: #333; padding: 0 16px; }
#wemd p { margin: 1em 0; text-align: justify; }
#wemd h1 { font-size: 22px; font-weight: 700; text-align: center; padding-bottom: 12px; border-bottom: 2px solid #1a7aed; margin-bottom: 24px; }
#wemd h2 { position: relative; font-size: 18px; font-weight: 700; padding-left: 14px; margin: 24px 0 12px; }
#wemd h2::before { content: ""; display: block; position: absolute; left: 0; top: 3px; bottom: 3px; width: 4px; background: #1a7aed; border-radius: 2px; }
#wemd h3 { font-size: 16px; font-weight: 600; margin: 18px 0 8px; }
#wemd h3::before { content: "◆ "; color: #1a7aed; }
#wemd ul, #wemd ol { padding-left: 20px; margin: 0.8em 0; }
#wemd li { margin: 4px 0; }
#wemd blockquote { border-left: 4px solid #1a7aed; background: #f0f7ff; padding: 10px 16px; margin: 16px 0; border-radius: 0 6px 6px 0; }
#wemd blockquote p { margin: 0; }
#wemd strong { color: #1a7aed; font-weight: 700; }
#wemd code { background: #f0f4f8; border-radius: 3px; padding: 1px 5px; font-size: 13px; }
#wemd pre { background: #1a1a2e; border-radius: 8px; padding: 16px; overflow-x: auto; }
#wemd pre code { background: none; padding: 0; color: #e0e0e0; font-size: 13px; }
#wemd hr { border: none; border-top: 1px solid #e0e0e0; margin: 24px 0; }
#wemd table { width: 100%; border-collapse: collapse; margin: 16px 0; }
#wemd th { background: #1a7aed; color: #fff; padding: 8px 12px; }
#wemd td { padding: 8px 12px; border: 1px solid #e0e0e0; }
#wemd tr:nth-child(even) td { background: #f5f8ff; }`
  }

  const { url, model, headers } = buildLLMRequest(aiConfig)

  const STYLE_SYSTEM = `你是一名专业的微信公众号 CSS 设计师。

约束：不能用 CSS 变量、外部字体、rgba()、linear-gradient()、CSS Grid。
选择器必须以 #wemd 开头。只输出纯 CSS 代码，以 #wemd { 开头，不要任何解释。`

  const resp = await callLLMWithRetry(url, {
    model,
    messages: [
      { role: 'system', content: STYLE_SYSTEM },
      {
        role: 'user',
        content: `请根据风格描述生成微信公众号文章的完整 CSS 样式：

**风格描述**：${stylePrompt}

要求：
1. h1 居中 + ::after 底部横线
2. h2 左侧竖线（::before 绝对定位）+ 浅色背景
3. h3 用 ::before 放小符号
4. blockquote 带背景色和左边框
5. code 浅色背景，pre 深色背景
6. 只输出 CSS，从 #wemd { 开始`,
      },
    ],
    temperature: 0.7,
    max_tokens: 2500,
  }, headers)

  const css = resp.data.choices[0].message.content.trim()
  return css.replace(/^```css\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '').trim()
}

// ── 步骤 4：将 Markdown 转为带样式的 HTML ────────────────────────────────────

function markdownToHtml(md, css) {
  // 简单 Markdown → HTML（微信兼容）
  let html = md
    // 标题
    .replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{4}\s+(.+)$/gm, '<h4>$1</h4>')
    // 粗体斜体
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // 行内代码
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // 引用块
    .replace(/^>\s*(.+)$/gm, '<blockquote><p>$1</p></blockquote>')
    // 无序列表
    .replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>')
    // 有序列表
    .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
    // 分割线
    .replace(/^---+$/gm, '<hr>')
    // 段落（两个换行 → <p>）
    .replace(/\n\n+/g, '\n</p><p>\n')

  // 简单包一层段落
  html = '<p>\n' + html + '\n</p>'

  // 合并相邻 li
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => {
    return '<ul>' + match + '</ul>'
  })

  // 清理空段落
  html = html.replace(/<p>\s*<\/p>/g, '')

  return `<style>${css}</style><div id="wemd">${html}</div>`
}

// ── 步骤 5：推送到微信草稿箱 ──────────────────────────────────────────────────

async function pushToWechat(job, title, htmlContent) {
  if (!job.wxAppId || !job.wxAppSecret) {
    throw new Error('未配置微信公众号凭据（appId/appSecret）')
  }

  const token = await getWxToken(job.wxAppId, job.wxAppSecret)
  const article = {
    title:                 title.slice(0, 64),
    content:               htmlContent,
    need_open_comment:     0,
    only_fans_can_comment: 0,
  }

  const resp = await axios.post(
    'https://api.weixin.qq.com/cgi-bin/draft/add',
    { articles: [article] },
    { params: { access_token: token }, timeout: 15000 },
  )

  if (resp.data.errcode && resp.data.errcode !== 0) {
    throw new Error(`推送草稿失败: [${resp.data.errcode}] ${resp.data.errmsg}`)
  }

  return resp.data.media_id
}

// ── 核心：执行一次任务 ────────────────────────────────────────────────────────

export async function runCronJob(jobId) {
  const job = getCronJob(jobId)
  if (!job) throw new Error(`任务 ${jobId} 不存在`)

  const aiConfig = mergeAiConfig(job.aiConfig)
  const steps = []
  let logId = null

  const addStep = (step, status, msg, extra = {}) => {
    steps.push({ step, status, msg, ...extra, time: new Date().toISOString() })
    if (logId) updateCronLog(logId, { steps })
    console.log(`[Cron:${job.name}] [${step}] ${status}: ${msg}`)
  }

  try {
    // 创建执行日志
    logId = createCronLog({ jobId, userId: job.userId, topic: job.topic })

    // ── Step 1: 热点抓取 ───────────────────────────────────────────────────
    addStep('trending', 'running', '正在抓取热点主题...')
    let topic
    try {
      topic = await fetchTrending(job, aiConfig)
      addStep('trending', 'success', `主题：${topic.slice(0, 60)}`, { topic })
      updateCronLog(logId, { topic })
    } catch (e) {
      addStep('trending', 'error', e.message)
      throw new Error(`热点抓取失败: ${e.message}`)
    }

    // ── Step 1.5: 智能素材收集（可选）──────────────────────────────────────
    let materialsDataset = null
    if (job.enableMaterialsCollection) {
      addStep('materials', 'running', '正在收集网络素材...')
      try {
        materialsDataset = await collectMaterialsIfEnabled(job, topic, aiConfig)
        if (materialsDataset) {
          addStep('materials', 'success', 
            `素材已收集：${materialsDataset.summary.totalItems} 条（搜索 ${materialsDataset.summary.searchQueries} 词，爬取 ${materialsDataset.summary.crawledUrls} URL）`,
            { summary: materialsDataset.summary }
          )
        } else {
          addStep('materials', 'skip', '素材收集已跳过或失败')
        }
      } catch (e) {
        addStep('materials', 'warn', `素材收集失败，继续生成文章: ${e.message}`)
        // 不阻断流程，继续生成文章
      }
    }

    // ── Step 2: 生成文章 ───────────────────────────────────────────────────
    addStep('generate', 'running', '正在生成文章...')
    let articleMd
    try {
      articleMd = await generateArticle(topic, aiConfig, materialsDataset)
      const firstLine = articleMd.split('\n')[0].replace(/^#+\s*/, '').trim()
      addStep('generate', 'success', `文章已生成（${articleMd.length} 字）`, { title: firstLine })
    } catch (e) {
      addStep('generate', 'error', e.message)
      throw new Error(`文章生成失败: ${e.message}`)
    }

    // 提取标题
    const titleMatch = articleMd.match(/^#+\s+(.+)$/m)
    const articleTitle = titleMatch ? titleMatch[1].trim() : topic.slice(0, 30)

    // 保存文章到本地（目录名必须以 8 位日期开头，才能被文章列表扫描器识别）
    const dateStr = formatDate()
    const articleId = `${dateStr}-cron-${jobId.slice(-6)}`
    const articleDir = path.join(DRAFTS_DIR, job.userId, articleId)
    const rawDir = path.join(articleDir, 'raw')
    const promptDir = path.join(articleDir, 'prompt')
    ensureDir(rawDir)
    ensureDir(promptDir)
    fs.writeFileSync(path.join(rawDir, 'article_raw.md'), articleMd, 'utf-8')
    fs.writeFileSync(path.join(articleDir, 'title.txt'), articleTitle, 'utf-8')
    
    // 保存素材数据集（如果有）
    if (materialsDataset) {
      const materialsMarkdown = formatMaterialsAsMarkdown(materialsDataset)
      fs.writeFileSync(path.join(promptDir, 'materials.md'), materialsMarkdown, 'utf-8')
      
      // 同时保存 JSON 格式方便程序读取
      fs.writeFileSync(
        path.join(promptDir, 'materials.json'),
        JSON.stringify(materialsDataset, null, 2),
        'utf-8'
      )
    }
    
    updateCronLog(logId, { articleTitle, articleId })

    // ── Step 3: 生成样式 ───────────────────────────────────────────────────
    addStep('style', 'running', '正在生成 CSS 样式...')
    let css
    try {
      css = await generateStyle(job.stylePrompt, aiConfig)
      addStep('style', 'success', `CSS 已生成（${css.length} 字节）`)
    } catch (e) {
      addStep('style', 'warn', `样式生成失败，使用默认样式: ${e.message}`)
      css = await generateStyle(null, aiConfig)  // 降级为默认
    }

    // ── Step 4: 转换为 HTML ───────────────────────────────────────────────
    addStep('html', 'running', '正在转换 HTML...')
    const htmlContent = markdownToHtml(articleMd, css)
    addStep('html', 'success', 'HTML 转换完成')

    // ── Step 5: 推送微信草稿箱 ────────────────────────────────────────────
    if (job.wxAppId && job.wxAppSecret) {
      addStep('publish', 'running', '正在推送到微信草稿箱...')
      try {
        const mediaId = await pushToWechat(job, articleTitle, htmlContent)
        addStep('publish', 'success', `草稿已推送，media_id: ${mediaId}`)
        updateCronLog(logId, { mediaId })
      } catch (e) {
        addStep('publish', 'error', e.message)
        // 推送失败不视为整体失败，只记录错误
      }
    } else {
      addStep('publish', 'skip', '未配置微信凭据，跳过推送')
    }

    // 更新任务统计
    const now = new Date().toISOString()
    const jobLatest = getCronJob(jobId)
    updateCronJobRunStats(jobId, {
      lastRunAt: now,
      nextRunAt: jobLatest.nextRunAt,
      runCount: (jobLatest.runCount || 0) + 1,
    })

    updateCronLog(logId, { status: 'success', finishedAt: now, steps })
    return { success: true, articleTitle, articleId, steps }
  } catch (err) {
    console.error(`[Cron:${job.name}] 执行失败:`, err.message)
    const now = new Date().toISOString()
    if (logId) {
      updateCronLog(logId, { status: 'error', errorMsg: err.message, finishedAt: now, steps })
    }
    throw err
  }
}

// ── 调度管理 ─────────────────────────────────────────────────────────────────

/**
 * 计算 cron 表达式的下一次执行时间
 */
function getNextRunTime(cronExpr) {
  try {
    const task = cron.schedule(cronExpr, () => {}, { scheduled: false })
    // node-cron 没有直接提供 nextDate，手动计算
    // 简单实现：检查接下来 7 天内的时间点
    const now = new Date()
    for (let i = 1; i <= 7 * 24 * 60; i++) {
      const t = new Date(now.getTime() + i * 60 * 1000)
      // 用 cron.validate 检测，但需要知道当前时间点是否匹配
      // 这里用一个简化的检测方法
    }
    task.destroy()
  } catch {}
  return null
}

/**
 * 为单个任务启动调度
 */
export function scheduleJob(job) {
  // 先清除旧调度
  unscheduleJob(job.id)

  if (!job.enabled) return

  if (!cron.validate(job.cronExpr)) {
    console.warn(`[Cron] 任务 "${job.name}" cron 表达式无效: ${job.cronExpr}`)
    return
  }

  const task = cron.schedule(job.cronExpr, async () => {
    console.log(`[Cron] 开始执行任务: ${job.name} (${job.id})`)
    try {
      await runCronJob(job.id)
    } catch (e) {
      console.error(`[Cron] 任务 ${job.name} 执行异常:`, e.message)
    }
  }, {
    timezone: 'Asia/Shanghai',
  })

  _scheduledTasks.set(job.id, task)
  console.log(`[Cron] 已调度任务: "${job.name}" [${job.cronExpr}]`)
}

/**
 * 取消单个任务调度
 */
export function unscheduleJob(jobId) {
  const existing = _scheduledTasks.get(jobId)
  if (existing) {
    existing.destroy()
    _scheduledTasks.delete(jobId)
  }
}

/**
 * 初始化：加载所有用户的已启用任务并调度
 */
export function initCronScheduler() {
  try {
    const allJobs = db.prepare('SELECT * FROM cron_jobs WHERE enabled = 1').all()
    let count = 0
    for (const r of allJobs) {
      const job = {
        id: r.id, userId: r.user_id, name: r.name, cronExpr: r.cron_expr,
        enabled: r.enabled === 1, topic: r.topic, stylePrompt: r.style_prompt,
        coverPrompt: r.cover_prompt,
        aiConfig: (() => { try { return JSON.parse(r.ai_config) } catch { return {} } })(),
        wxAppId: r.wx_app_id, wxAppSecret: r.wx_app_secret,
        lastRunAt: r.last_run_at, nextRunAt: r.next_run_at, runCount: r.run_count,
      }
      scheduleJob(job)
      count++
    }
    console.log(`[Cron] 调度器已初始化，共加载 ${count} 个任务`)
  } catch (e) {
    console.error('[Cron] 初始化调度器失败:', e.message)
  }
}
