import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import axios from 'axios'
import dotenv from 'dotenv'
import crypto from 'crypto'

// 依次尝试：web/.env → 项目根目录 .env，先找到哪个用哪个
const envInWebDir  = path.join(__dirname, '.env')
const envInRoot    = path.join(__dirname, '..', '.env')
if (fs.existsSync(envInWebDir)) {
  dotenv.config({ path: envInWebDir })
} else if (fs.existsSync(envInRoot)) {
  dotenv.config({ path: envInRoot })
} else {
  dotenv.config() // 兜底：从 cwd 找
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

// 目录配置 — 支持环境变量覆盖（独立部署时可自定义）
const PROJECT_ROOT = process.env.PROJECT_ROOT || path.join(__dirname, '..')
const DRAFTS_DIR = process.env.DRAFTS_DIR || path.join(PROJECT_ROOT, '公众号写作', 'drafts')
const AGENTS_FILE = process.env.AGENTS_FILE || path.join(PROJECT_ROOT, 'AGENTS.md')
const DATA_DIR = process.env.DATA_DIR || path.join(PROJECT_ROOT, '.cache')
const CACHE_DIR = path.join(DATA_DIR, 'covers')
const HISTORY_FILE = path.join(DATA_DIR, 'cover_history.json')

// 服务端 AI 配置（兜底，用户在前端配置的会覆盖这里）
const SERVER_AI_CONFIG = {
  // 文章生成
  articleProvider: process.env.ARTICLE_PROVIDER || 'openai',
  articleApiKey: process.env.OPENAI_API_KEY || process.env.ARTICLE_API_KEY || '',
  articleBaseUrl: process.env.ARTICLE_BASE_URL || 'https://api.openai.com/v1',
  articleModel: process.env.ARTICLE_MODEL || 'gpt-4o',
  // MaaS（内部）
  maasApiKey: process.env.MAAS_API_KEY || '',
  maasBaseUrl: process.env.MAAS_BASE_URL || 'https://maas.devops.xiaohongshu.com/v1',
  maasUserEmail: process.env.MAAS_USER_EMAIL || '',
  // 封面
  coverProvider: process.env.COVER_PROVIDER || 'local',
  coverApiKey: process.env.COVER_API_KEY || process.env.OPENAI_API_KEY || '',
  // Stability（保留兼容）
  stabilityApiKey: process.env.STABILITY_API_KEY || '',
  stabilityBaseUrl: process.env.STABILITY_BASE_URL || 'https://api.stability.ai/v1',
}

// 图片管理系统配置
const IMAGES_DIR = path.join(DATA_DIR, 'images')
const IMAGES_METADATA_FILE = path.join(DATA_DIR, 'images_metadata.json')

// 微信发布配置
const PUBLISH_DIR = path.join(DATA_DIR, 'publish')
const PUBLISH_HISTORY_FILE = path.join(DATA_DIR, 'publish_history.json')

// 中间件
app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb' }))

// 工具函数
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// 生成缓存 key（基于标题、风格、颜色的 hash）
function generateCacheKey(title, style, color) {
  const data = `${title}|${style}|${color}`
  return crypto.createHash('md5').update(data).digest('hex')
}

// 读取生成历史
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error('Error loading history:', error)
  }
  return []
}

// 保存生成历史
function saveHistory(history) {
  try {
    ensureDir(path.dirname(HISTORY_FILE))
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8')
  } catch (error) {
    console.error('Error saving history:', error)
  }
}

// 添加到历史记录
function addToHistory(title, style, color, provider, imageUrl, cacheKey) {
  const history = loadHistory()
  history.unshift({
    id: Date.now().toString(),
    title,
    style,
    color,
    provider,
    imageUrl,
    cacheKey,
    createdAt: new Date().toISOString(),
    cached: false
  })
  // 只保留最近 100 条记录
  if (history.length > 100) {
    history.pop()
  }
  saveHistory(history)
  return history[0]
}

// 从缓存读取图片
function getCachedImage(cacheKey) {
  try {
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`)
    if (fs.existsSync(cachePath)) {
      const data = fs.readFileSync(cachePath, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error('Error reading cache:', error)
  }
  return null
}

// 保存到缓存
function cacheImage(cacheKey, imageUrl, metadata) {
  try {
    ensureDir(CACHE_DIR)
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`)
    fs.writeFileSync(cachePath, JSON.stringify({
      imageUrl,
      metadata,
      cachedAt: new Date().toISOString()
    }, null, 2), 'utf-8')
  } catch (error) {
    console.error('Error caching image:', error)
  }
}

// 图片管理系统函数

// 加载图片元数据
function loadImagesMetadata() {
  try {
    if (fs.existsSync(IMAGES_METADATA_FILE)) {
      const data = fs.readFileSync(IMAGES_METADATA_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error('Error loading images metadata:', error)
  }
  return []
}

// 保存图片元数据
function saveImagesMetadata(metadata) {
  try {
    ensureDir(path.dirname(IMAGES_METADATA_FILE))
    fs.writeFileSync(IMAGES_METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8')
  } catch (error) {
    console.error('Error saving images metadata:', error)
  }
}

// 添加图片到管理系统
function addImageToLibrary(imageUrl, title, category, tags, provider) {
  const metadata = loadImagesMetadata()
  const imageId = Date.now().toString()
  
  const imageItem = {
    id: imageId,
    title,
    category,
    tags: Array.isArray(tags) ? tags : [],
    provider,
    imageUrl,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  
  metadata.unshift(imageItem)
  
  // 保留最近 500 张图片
  if (metadata.length > 500) {
    metadata.pop()
  }
  
  saveImagesMetadata(metadata)
  return imageItem
}

// 获取图片库
function getImageLibrary(category = null, tags = null) {
  const metadata = loadImagesMetadata()
  
  let filtered = metadata
  
  if (category) {
    filtered = filtered.filter(item => item.category === category)
  }
  
  if (tags && Array.isArray(tags) && tags.length > 0) {
    filtered = filtered.filter(item =>
      tags.some(tag => item.tags.includes(tag))
    )
  }
  
  return filtered
}

// 删除图片
function deleteImage(imageId) {
  const metadata = loadImagesMetadata()
  const filtered = metadata.filter(item => item.id !== imageId)
  saveImagesMetadata(filtered)
  return true
}

// 更新图片信息
function updateImageInfo(imageId, updates) {
  const metadata = loadImagesMetadata()
  const index = metadata.findIndex(item => item.id === imageId)
  
  if (index !== -1) {
    metadata[index] = {
      ...metadata[index],
      ...updates,
      updatedAt: new Date().toISOString()
    }
    saveImagesMetadata(metadata)
    return metadata[index]
  }
  
  return null
}

// OpenAI DALL-E 生成函数（apiKey 由调用方传入）
async function generateWithDallE(prompt, apiKey) {
  const key = apiKey || SERVER_AI_CONFIG.coverApiKey
  if (!key) {
    throw new Error('OpenAI API key not configured. 请前往「AI 配置」页面设置。')
  }
  
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/images/generations',
      {
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
        quality: 'hd',
        style: 'vivid'
      },
      {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        }
      }
    )
    
    if (response.data.data && response.data.data.length > 0) {
      return response.data.data[0].url
    } else {
      throw new Error('No image generated by DALL-E')
    }
  } catch (error) {
    console.error('OpenAI DALL-E error:', error.response?.data || error.message)
    throw error
  }
}

// 微信发布相关函数

// 加载发布历史
function loadPublishHistory() {
  try {
    if (fs.existsSync(PUBLISH_HISTORY_FILE)) {
      const data = fs.readFileSync(PUBLISH_HISTORY_FILE, 'utf-8')
      return JSON.parse(data)
    }
  } catch (error) {
    console.error('Error loading publish history:', error)
  }
  return []
}

// 保存发布历史
function savePublishHistory(history) {
  try {
    ensureDir(path.dirname(PUBLISH_HISTORY_FILE))
    fs.writeFileSync(PUBLISH_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8')
  } catch (error) {
    console.error('Error saving publish history:', error)
  }
}

// 生成草稿文件
function generateDraftFile(title, content, coverImage) {
  const draftId = Date.now().toString()
  const draftData = {
    id: draftId,
    title,
    content,
    coverImage,
    createdAt: new Date().toISOString(),
    status: 'draft'
  }

  try {
    ensureDir(PUBLISH_DIR)
    const draftPath = path.join(PUBLISH_DIR, `${draftId}.json`)
    fs.writeFileSync(draftPath, JSON.stringify(draftData, null, 2), 'utf-8')

    // 添加到发布历史
    const history = loadPublishHistory()
    history.unshift({
      id: draftId,
      title,
      createdAt: new Date().toISOString(),
      status: 'draft',
      filePath: draftPath
    })

    // 只保留最近 50 条记录
    if (history.length > 50) {
      history.pop()
    }
    savePublishHistory(history)

    return draftData
  } catch (error) {
    console.error('Error generating draft file:', error)
    throw error
  }
}

// 生成 AI 提示词
function generatePrompt(title, content, style, color) {
  const stylePrompts = {
    modern: 'modern minimalist design, clean typography, geometric shapes, professional',
    minimalist: 'minimalist design, white space, simple elegant, monochrome with accent color',
    gradient: 'gradient background, vibrant colors, smooth transitions, modern aesthetic',
    illustration: 'hand-drawn illustration style, artistic, colorful, creative',
    photography: 'professional photography, high quality, cinematic lighting, composition',
    abstract: 'abstract art, geometric patterns, modern, artistic composition'
  }

  const colorNames = {
    matcha: 'matcha green',
    slushie: 'cyan blue',
    lemon: 'golden yellow',
    ube: 'deep purple',
    pomegranate: 'coral red',
    blueberry: 'navy blue'
  }

  const styleDesc = stylePrompts[style] || stylePrompts.modern
  const colorDesc = colorNames[color] || 'vibrant colors'
  const contentPreview = content.substring(0, 100).replace(/[#*\[\]]/g, '')

  return `Create a professional blog cover image for an article titled "${title}".
Style: ${styleDesc}.
Primary color: ${colorDesc}.
Content theme: ${contentPreview}.
Include the title text prominently.
High quality, 1200x630 pixels, suitable for WeChat public account.`
}

// 生成占位符封面
function generatePlaceholderCover(title, style, color) {
  const colorMap = {
    matcha: '#078a52',
    slushie: '#3bd3fd',
    lemon: '#fbbd41',
    ube: '#43089f',
    pomegranate: '#fc7981',
    blueberry: '#01418d'
  }

  const bgColor = colorMap[color] || '#078a52'
  const stylePatterns = {
    modern: '<rect x="0" y="0" width="1200" height="630" fill="' + bgColor + '"/><circle cx="600" cy="315" r="200" fill="rgba(255,255,255,0.1)"/>',
    minimalist: '<rect x="0" y="0" width="1200" height="630" fill="' + bgColor + '"/><line x1="100" y1="100" x2="1100" y2="100" stroke="white" stroke-width="2"/>',
    gradient: '<defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:' + bgColor + ';stop-opacity:1" /><stop offset="100%" style="stop-color:rgba(255,255,255,0.3);stop-opacity:1" /></linearGradient></defs><rect x="0" y="0" width="1200" height="630" fill="url(#grad)"/>',
    illustration: '<rect x="0" y="0" width="1200" height="630" fill="' + bgColor + '"/><circle cx="200" cy="200" r="80" fill="rgba(255,255,255,0.2)"/><circle cx="1000" cy="500" r="120" fill="rgba(255,255,255,0.15)"/>',
    photography: '<rect x="0" y="0" width="1200" height="630" fill="' + bgColor + '"/><rect x="50" y="50" width="1100" height="530" fill="none" stroke="white" stroke-width="3"/>',
    abstract: '<rect x="0" y="0" width="1200" height="630" fill="' + bgColor + '"/><polygon points="600,100 1100,400 600,630 100,400" fill="rgba(255,255,255,0.1)"/>'
  }

  const pattern = stylePatterns[style] || stylePatterns.modern
  const truncatedTitle = title.length > 30 ? title.substring(0, 27) + '...' : title

  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .title-text { font-family: 'Roobert', Arial, sans-serif; font-size: 48px; font-weight: 600; fill: white; text-anchor: middle; }
        .subtitle-text { font-family: 'Roobert', Arial, sans-serif; font-size: 24px; fill: rgba(255,255,255,0.8); text-anchor: middle; }
      </style>
    </defs>
    ${pattern}
    <text x="600" y="280" class="title-text">${truncatedTitle}</text>
  </svg>`
}

function getArticlePath(articleId, type) {
  // articleId 格式：
  // 1. YYYYMMDD（纯日期）
  // 2. YYYYMMDD-后缀（日期-后缀，后缀可能是标题或时间戳）
  // 3. YYYYMMDD-标题（目录名本身，需要在 DRAFTS_DIR 中查找）
  
  // 首先尝试直接在 DRAFTS_DIR 中查找这个目录（处理 YYYYMMDD-标题 的情况）
  const directPath = path.join(DRAFTS_DIR, articleId)
  if (fs.existsSync(directPath)) {
    // 这是一个完整的目录名，直接使用
    const paths = {
      task: path.join(directPath, 'prompt', 'task.md'),
      materials: path.join(directPath, 'prompt', 'materials.md'),
      article: path.join(directPath, 'raw', 'article_raw.md'),
      title: path.join(directPath, 'title.txt')
    }
    return paths[type]
  }
  
  // 否则，按照 YYYYMMDD-后缀 的格式处理
  const parts = articleId.split('-')
  const dateDir = parts[0]
  const suffix = parts.length > 1 ? `-${parts.slice(1).join('-')}` : ''
  
  const paths = {
    task: path.join(DRAFTS_DIR, dateDir, 'prompt', `task${suffix}.md`),
    materials: path.join(DRAFTS_DIR, dateDir, 'prompt', `materials${suffix}.md`),
    article: path.join(DRAFTS_DIR, dateDir, 'raw', `article_raw${suffix}.md`),
    title: path.join(DRAFTS_DIR, dateDir, `title${suffix}.txt`)
  }
  return paths[type]
}

// API 路由

// 获取文章列表
app.get('/api/articles', (req, res) => {
  try {
    if (!fs.existsSync(DRAFTS_DIR)) {
      return res.json([])
    }

    const articles = []
    const allDirs = fs.readdirSync(DRAFTS_DIR)
    
    // 支持两种目录格式：
    // 1. YYYYMMDD（纯日期）
    // 2. YYYYMMDD-标题（日期-标题）
    const dateDirs = allDirs
      .filter(f => /^\d{8}/.test(f))
      .sort((a, b) => {
        // 提取日期部分进行排序
        const dateA = a.substring(0, 8)
        const dateB = b.substring(0, 8)
        if (dateA !== dateB) {
          return dateB.localeCompare(dateA)
        }
        // 如果日期相同，按目录名排序
        return b.localeCompare(a)
      })
    
    console.log('[API] Found directories:', dateDirs)

    for (const dateDir of dateDirs) {
      const promptDir = path.join(DRAFTS_DIR, dateDir, 'prompt')
      const rawDir = path.join(DRAFTS_DIR, dateDir, 'raw')
      
      // 检查是否有 prompt 和 raw 目录（即使为空也算有效文章）
      const hasPromptDir = fs.existsSync(promptDir)
      const hasRawDir = fs.existsSync(rawDir)
      
      // 如果两个目录都不存在，跳过
      if (!hasPromptDir && !hasRawDir) {
        continue
      }
      
      // 查找所有 task 文件来确定有多少篇文章
      const taskFiles = []
      if (hasPromptDir) {
        taskFiles.push(...fs.readdirSync(promptDir)
          .filter(f => f.startsWith('task') && f.endsWith('.md')))
      }
      
      // 如果没有 task 文件，但有 prompt/raw 目录，创建一个默认文章条目
      if (taskFiles.length === 0) {
        const articleId = dateDir
        const titlePath = path.join(DRAFTS_DIR, dateDir, 'title.txt')
        
        let title = ''
        let status = 'draft'
        
        // 优先读取自定义标题
        if (fs.existsSync(titlePath)) {
          title = fs.readFileSync(titlePath, 'utf-8').trim()
        }

        // 再尝试从文章内容第一行取标题
        if (!title) {
          const defaultArticlePath = path.join(rawDir, 'article_raw.md')
          if (fs.existsSync(defaultArticlePath)) {
            const content = fs.readFileSync(defaultArticlePath, 'utf-8')
            const firstLine = content.split('\n')[0]?.replace(/^#+\s*/, '').trim()
            if (firstLine) title = firstLine
          }
        }
        
        if (!title) {
          title = `文章 ${articleId}`
        }
        
        articles.push({
          id: articleId,
          date: dateDir,
          title,
          status,
          createdAt: new Date().toISOString()
        })
        continue
      }

      // 为每个 task 文件创建一个文章条目
      for (const taskFile of taskFiles) {
        // 从文件名推导 articleId
        let articleId = dateDir
        if (taskFile !== 'task.md') {
          const suffix = taskFile.replace('task', '').replace('.md', '')
          articleId = `${dateDir}${suffix}`
        }

        const taskPath = path.join(promptDir, taskFile)
        const articlePath = path.join(rawDir, taskFile.replace('task', 'article_raw'))
        const titlePath = path.join(DRAFTS_DIR, dateDir, `title${taskFile.replace('task.md', '')}.txt`)
        
        let title = ''
        let status = 'draft'

        // 优先读取自定义标题
        if (fs.existsSync(titlePath)) {
          title = fs.readFileSync(titlePath, 'utf-8').trim()
        } else if (fs.existsSync(articlePath)) {
          // 从生成的文章内容取第一行（H1 标题），与编辑器页面逻辑一致
          const content = fs.readFileSync(articlePath, 'utf-8')
          const firstLine = content.split('\n')[0]?.replace(/^#+\s*/, '').trim()
          if (firstLine) title = firstLine
        } else if (fs.existsSync(taskPath)) {
          const content = fs.readFileSync(taskPath, 'utf-8')
          const match = content.match(/文章主题[：:]\s*(.+)/i)
          if (match) title = match[1].trim()
        }

        if (!title) {
          title = `文章 ${articleId}`
        }

        if (fs.existsSync(articlePath)) {
          status = 'generated'
        }

        articles.push({
          id: articleId,
          date: dateDir,
          title,
          status,
          createdAt: new Date().toISOString()
        })
      }
    }

    res.json(articles)
  } catch (error) {
    console.error('Error fetching articles:', error)
    res.status(500).json({ error: error.message })
  }
})

// 获取单篇文章
app.get('/api/articles/:articleId', (req, res) => {
  try {
    const { articleId } = req.params
    
    const taskPath = getArticlePath(articleId, 'task')
    const materialsPath = getArticlePath(articleId, 'materials')
    const articlePath = getArticlePath(articleId, 'article')
    const titlePath = getArticlePath(articleId, 'title')

    // 创建目录结构
    ensureDir(path.dirname(taskPath))
    ensureDir(path.dirname(materialsPath))
    ensureDir(path.dirname(articlePath))

    const task = fs.existsSync(taskPath) ? fs.readFileSync(taskPath, 'utf-8') : ''
    const materials = fs.existsSync(materialsPath) ? fs.readFileSync(materialsPath, 'utf-8') : ''
    const article = fs.existsSync(articlePath) ? fs.readFileSync(articlePath, 'utf-8') : ''
    const title = fs.existsSync(titlePath) ? fs.readFileSync(titlePath, 'utf-8') : ''

    res.json({ task, materials, article, title })
  } catch (error) {
    console.error('Error fetching article:', error)
    res.status(500).json({ error: error.message })
  }
})

// 保存文章
app.post('/api/articles/:articleId', (req, res) => {
  try {
    const { articleId } = req.params
    const { task, materials, article, title } = req.body

    const taskPath = getArticlePath(articleId, 'task')
    const materialsPath = getArticlePath(articleId, 'materials')
    const articlePath = getArticlePath(articleId, 'article')
    const titlePath = getArticlePath(articleId, 'title')

    ensureDir(path.dirname(taskPath))
    ensureDir(path.dirname(materialsPath))
    ensureDir(path.dirname(articlePath))

    if (task) fs.writeFileSync(taskPath, task, 'utf-8')
    if (materials) fs.writeFileSync(materialsPath, materials, 'utf-8')
    if (article) fs.writeFileSync(articlePath, article, 'utf-8')
    if (title) fs.writeFileSync(titlePath, title, 'utf-8')

    res.json({ success: true })
  } catch (error) {
    console.error('Error saving article:', error)
    res.status(500).json({ error: error.message })
  }
})

// 生成文章
app.post('/api/articles/:articleId/generate', async (req, res) => {
  try {
    const { articleId } = req.params
    // aiConfig 由前端 /settings 页面配置并传入，优先级高于服务端环境变量
    const { task, materials, aiConfig } = req.body

    if (!task || !materials) {
      return res.status(400).json({ error: '任务和素材不能为空' })
    }

    // 合并配置：前端传入 > 服务端环境变量
    const cfg = { ...SERVER_AI_CONFIG, ...(aiConfig || {}) }

    // 读取 AGENTS.md 写作规范
    let agentsContent = ''
    if (fs.existsSync(AGENTS_FILE)) {
      agentsContent = fs.readFileSync(AGENTS_FILE, 'utf-8')
    }

    // 构建提示词
    const userPrompt = `你是一个专业的内容创作助手。请严格按照以下要求完成文章写作任务。

# 写作规范（必须严格遵守）
${agentsContent}

# 本次任务要求
${task}

# 素材参考
${materials}

---

现在请根据以上规范和素材，直接输出完整的文章内容（纯 Markdown 格式，不要有任何其他说明）：`

    // 根据 provider 选择调用方式
    let requestHeaders = { 'Content-Type': 'application/json' }
    let requestUrl = ''
    let requestModel = ''

    if (cfg.articleProvider === 'maas') {
      requestUrl = `${cfg.maasBaseUrl}/chat/completions`
      requestModel = 'deepseek-v4-pro'
      requestHeaders['api-key'] = cfg.maasApiKey
      requestHeaders['x-maas-user-email'] = cfg.maasUserEmail
      requestHeaders['x-maas-app-id'] = 'qs-api'
    } else {
      // openai / openai-compat
      requestUrl = `${cfg.articleBaseUrl}/chat/completions`
      requestModel = cfg.articleModel || 'gpt-4o'
      requestHeaders['Authorization'] = `Bearer ${cfg.articleApiKey}`
    }

    if (!cfg.articleApiKey && cfg.articleProvider !== 'maas') {
      return res.status(400).json({
        error: '未配置 API Key，请前往「AI 配置」页面设置后重试'
      })
    }
    if (cfg.articleProvider === 'maas' && !cfg.maasApiKey) {
      return res.status(400).json({
        error: '未配置 MaaS API Key，请前往「AI 配置」页面设置后重试'
      })
    }

    const response = await axios.post(
      requestUrl,
      {
        model: requestModel,
        messages: [
          {
            role: 'system',
            content: '你是一个专业的内容创作助手，擅长按照规范和要求生成高质量的文章内容。'
          },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.9,
        max_tokens: 4096,
        stream: false
      },
      { headers: requestHeaders }
    )

    const article = response.data.choices[0].message.content

    // 保存文章到本地文件
    const articlePath = getArticlePath(articleId, 'article')
    ensureDir(path.dirname(articlePath))
    fs.writeFileSync(articlePath, article, 'utf-8')

    res.json({ article })
  } catch (error) {
    console.error('Error generating article:', error.response?.data || error.message)
    const msg = error.response?.data?.error?.message || error.message
    res.status(500).json({ error: msg })
  }
})

// 生成封面
app.post('/api/generate-cover', async (req, res) => {
  try {
    // aiConfig 由前端 CoverGenerator 传入（来自 /settings 配置）
    const { title, content, style, color, provider: reqProvider, aiConfig } = req.body

    if (!title) {
      return res.status(400).json({ error: '标题不能为空' })
    }

    // 合并配置：前端传入 > 服务端环境变量
    const cfg = { ...SERVER_AI_CONFIG, ...(aiConfig || {}) }
    // provider 优先取前端传的（允许覆盖），其次取 aiConfig.coverProvider，最后用 local
    const provider = reqProvider || cfg.coverProvider || 'local'
    const coverApiKey = cfg.coverApiKey || cfg.stabilityApiKey || ''

    // 生成缓存 key
    const cacheKey = generateCacheKey(title, style, color)
    
    // 检查缓存
    const cached = getCachedImage(cacheKey)
    if (cached) {
      const historyItem = addToHistory(title, style, color, provider, cached.imageUrl, cacheKey)
      return res.json({ imageUrl: cached.imageUrl, cached: true, historyId: historyItem.id })
    }

    // 本地 SVG 占位（免费）
    if (provider === 'local') {
      const svgContent = generatePlaceholderCover(title, style, color)
      const imageUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`
      cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
      const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
      return res.json({ imageUrl, historyId: historyItem.id })
    }

    // Stability AI
    if (provider === 'stability') {
      const stabilityKey = coverApiKey || SERVER_AI_CONFIG.stabilityApiKey
      try {
        const prompt = generatePrompt(title, content, style, color)
        const response = await axios.post(
          `${SERVER_AI_CONFIG.stabilityBaseUrl}/text-to-image/v1/engines/${process.env.STABILITY_ENGINE || 'stable-diffusion-3-large'}/text-to-image`,
          {
            text_prompts: [{ text: prompt, weight: 1 }],
            cfg_scale: 7,
            height: 640,
            width: 1216,
            samples: 1,
            steps: 30,
          },
          {
            headers: {
              'Authorization': `Bearer ${stabilityKey}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            }
          }
        )
        if (response.data.artifacts?.length > 0) {
          const imageUrl = `data:image/png;base64,${response.data.artifacts[0].base64}`
          cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'stability' })
          const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
          return res.json({ imageUrl, historyId: historyItem.id })
        }
        throw new Error('No image generated')
      } catch (error) {
        console.error('Stability AI error:', error.response?.data || error.message)
        // 降级到本地
        const svgContent = generatePlaceholderCover(title, style, color)
        const imageUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`
        cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
        const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
        return res.json({ imageUrl, historyId: historyItem.id, warning: 'Stability AI 生成失败，已使用本地模式' })
      }
    }

    // OpenAI DALL-E
    if (provider === 'openai') {
      try {
        const prompt = generatePrompt(title, content, style, color)
        const imageUrl = await generateWithDallE(prompt, coverApiKey)
        cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'openai' })
        const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
        addImageToLibrary(imageUrl, title, 'cover', [style, color], 'openai')
        return res.json({ imageUrl, historyId: historyItem.id })
      } catch (error) {
        console.error('OpenAI DALL-E error:', error.message)
        const svgContent = generatePlaceholderCover(title, style, color)
        const imageUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`
        cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
        const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
        return res.json({ imageUrl, historyId: historyItem.id, warning: `DALL-E 生成失败（${error.message}），已使用本地模式` })
      }
    }

    res.status(400).json({ error: '未知的图片生成服务商' })
  } catch (error) {
    console.error('Error generating cover:', error)
    res.status(500).json({ error: error.message })
  }
})

// 删除文章
app.delete('/api/articles/:articleId', (req, res) => {
  try {
    const { articleId } = req.params
    
    // 首先尝试直接在 DRAFTS_DIR 中查找这个目录（处理 YYYYMMDD-标题 的情况）
    const directPath = path.join(DRAFTS_DIR, articleId)
    if (fs.existsSync(directPath)) {
      // 这是一个完整的目录名，直接删除整个目录
      const promptDir = path.join(directPath, 'prompt')
      const rawDir = path.join(directPath, 'raw')
      const finalDir = path.join(directPath, 'final')
      
      // 删除子目录
      if (fs.existsSync(promptDir)) {
        fs.rmSync(promptDir, { recursive: true, force: true })
      }
      if (fs.existsSync(rawDir)) {
        fs.rmSync(rawDir, { recursive: true, force: true })
      }
      if (fs.existsSync(finalDir)) {
        fs.rmSync(finalDir, { recursive: true, force: true })
      }
      
      // 删除目录中的所有文件
      const files = fs.readdirSync(directPath)
      for (const file of files) {
        const filePath = path.join(directPath, file)
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath)
        }
      }
      
      // 删除目录本身
      if (fs.readdirSync(directPath).length === 0) {
        fs.rmdirSync(directPath)
      }
      
      return res.json({ success: true })
    }
    
    // 否则，按照 YYYYMMDD-后缀 的格式处理
    const parts = articleId.split('-')
    const dateDir = parts[0]
    const suffix = parts.length > 1 ? `-${parts.slice(1).join('-')}` : ''
    
    const promptDir = path.join(DRAFTS_DIR, dateDir, 'prompt')
    const rawDir = path.join(DRAFTS_DIR, dateDir, 'raw')
    
    // 删除相关文件
    const taskPath = path.join(promptDir, `task${suffix}.md`)
    const materialsPath = path.join(promptDir, `materials${suffix}.md`)
    const articlePath = path.join(rawDir, `article_raw${suffix}.md`)
    const titlePath = path.join(DRAFTS_DIR, dateDir, `title${suffix}.txt`)
    
    if (fs.existsSync(taskPath)) fs.unlinkSync(taskPath)
    if (fs.existsSync(materialsPath)) fs.unlinkSync(materialsPath)
    if (fs.existsSync(articlePath)) fs.unlinkSync(articlePath)
    if (fs.existsSync(titlePath)) fs.unlinkSync(titlePath)
    
    // 如果目录为空，删除目录
    if (fs.existsSync(promptDir) && fs.readdirSync(promptDir).length === 0) {
      fs.rmdirSync(promptDir)
    }
    if (fs.existsSync(rawDir) && fs.readdirSync(rawDir).length === 0) {
      fs.rmdirSync(rawDir)
    }
    if (fs.existsSync(path.join(DRAFTS_DIR, dateDir)) && fs.readdirSync(path.join(DRAFTS_DIR, dateDir)).length === 0) {
      fs.rmdirSync(path.join(DRAFTS_DIR, dateDir))
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting article:', error)
    res.status(500).json({ error: error.message })
  }
})

// 获取生成历史
app.get('/api/cover-history', (req, res) => {
  try {
    const history = loadHistory()
    res.json(history)
  } catch (error) {
    console.error('Error fetching history:', error)
    res.status(500).json({ error: error.message })
  }
})

// 删除历史记录
app.delete('/api/cover-history/:id', (req, res) => {
  try {
    const { id } = req.params
    let history = loadHistory()
    history = history.filter(item => item.id !== id)
    saveHistory(history)
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting history:', error)
    res.status(500).json({ error: error.message })
  }
})

// 清除所有历史记录
app.delete('/api/cover-history', (req, res) => {
  try {
    saveHistory([])
    res.json({ success: true })
  } catch (error) {
    console.error('Error clearing history:', error)
    res.status(500).json({ error: error.message })
  }
})

// 批量生成封面
app.post('/api/generate-covers-batch', async (req, res) => {
  try {
    const { covers, provider } = req.body

    if (!Array.isArray(covers) || covers.length === 0) {
      return res.status(400).json({ error: '封面列表不能为空' })
    }

    if (covers.length > 10) {
      return res.status(400).json({ error: '单次最多生成 10 个封面' })
    }

    const results = []
    const errors = []

    for (let i = 0; i < covers.length; i++) {
      try {
        const { title, content, style, color } = covers[i]

        if (!title) {
          errors.push({ index: i, error: '标题不能为空' })
          continue
        }

        // 生成缓存 key
        const cacheKey = generateCacheKey(title, style, color)
        
        // 检查缓存
        const cached = getCachedImage(cacheKey)
        if (cached) {
          const historyItem = addToHistory(title, style, color, provider, cached.imageUrl, cacheKey)
          results.push({
            index: i,
            title,
            imageUrl: cached.imageUrl,
            cached: true,
            historyId: historyItem.id
          })
          continue
        }

        // 使用本地演示模式
        if (provider === 'local') {
          const svgContent = generatePlaceholderCover(title, style, color)
          const imageUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`
          cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
          const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
          results.push({
            index: i,
            title,
            imageUrl,
            cached: false,
            historyId: historyItem.id
          })
          continue
        }

        // 使用 Stability AI
        if (provider === 'stability') {
          try {
            const prompt = generatePrompt(title, content || '', style, color)
            
            const response = await axios.post(
              `${STABILITY_CONFIG.baseUrl}/image-to-image`,
              {
                prompt: prompt,
                negative_prompt: 'blurry, low quality, distorted',
                steps: 30,
                guidance_scale: 7.5,
                width: 1200,
                height: 630,
                samples: 1,
                seed: Math.floor(Math.random() * 1000000)
              },
              {
                headers: {
                  'Authorization': `Bearer ${STABILITY_CONFIG.apiKey}`,
                  'Content-Type': 'application/json'
                }
              }
            )

            if (response.data.artifacts && response.data.artifacts.length > 0) {
              const imageBase64 = response.data.artifacts[0].base64
              const imageUrl = `data:image/png;base64,${imageBase64}`
              cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'stability' })
              const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
              results.push({
                index: i,
                title,
                imageUrl,
                cached: false,
                historyId: historyItem.id
              })
            } else {
              throw new Error('No image generated')
            }
          } catch (error) {
            console.error(`Stability AI error for ${title}:`, error.message)
            // 降级到本地模式
            const svgContent = generatePlaceholderCover(title, style, color)
            const imageUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`
            cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
            const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
            results.push({
              index: i,
              title,
              imageUrl,
              cached: false,
              historyId: historyItem.id,
              warning: 'Stability AI 生成失败，已使用本地模式'
            })
          }
       }
       
       // OpenAI DALL-E
       if (provider === 'openai') {
         try {
           const prompt = generatePrompt(title, content || '', style, color)
           const imageUrl = await generateWithDallE(prompt)
           
           cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'openai' })
           const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
           
           // 添加到图片库
           addImageToLibrary(imageUrl, title, 'cover', [style, color], 'openai')
           
           results.push({
             index: i,
             title,
             imageUrl,
             cached: false,
             historyId: historyItem.id
           })
         } catch (error) {
           console.error(`OpenAI DALL-E error for ${title}:`, error.message)
           // 降级到本地模式
           const svgContent = generatePlaceholderCover(title, style, color)
           const imageUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`
           cacheImage(cacheKey, imageUrl, { title, style, color, provider: 'local' })
           const historyItem = addToHistory(title, style, color, provider, imageUrl, cacheKey)
           results.push({
             index: i,
             title,
             imageUrl,
             cached: false,
             historyId: historyItem.id,
             warning: 'OpenAI DALL-E 生成失败，已使用本地模式'
           })
         }
       }
      } catch (error) {
        errors.push({ index: i, error: error.message })
      }
    }

    res.json({
      success: true,
      results,
      errors: errors.length > 0 ? errors : undefined,
      total: covers.length,
      succeeded: results.length,
      failed: errors.length
    })
  } catch (error) {
    console.error('Error in batch generation:', error)
    res.status(500).json({ error: error.message })
  }
})

// 获取缓存统计
app.get('/api/cache-stats', (req, res) => {
  try {
    const history = loadHistory()
    const cacheCount = fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR).length : 0
    
    res.json({
      historyCount: history.length,
      cacheCount,
      cacheSize: cacheCount > 0 ? `${(cacheCount * 0.05).toFixed(2)} MB` : '0 MB'
    })
  } catch (error) {
    console.error('Error getting cache stats:', error)
    res.status(500).json({ error: error.message })
  }
})

// 微信发布 API

// 发布到草稿箱
app.post('/api/publish/draft', (req, res) => {
  try {
    const { title, content, coverImage } = req.body

    if (!title || !content) {
      return res.status(400).json({ error: '标题和内容不能为空' })
    }

    const draft = generateDraftFile(title, content, coverImage)

    res.json({
      success: true,
      draftId: draft.id,
      message: '草稿已生成，请在微信编辑器中继续编辑'
    })
  } catch (error) {
    console.error('Error publishing draft:', error)
    res.status(500).json({ error: error.message })
  }
})

// 获取发布历史
app.get('/api/publish/history', (req, res) => {
  try {
    const history = loadPublishHistory()
    res.json(history)
  } catch (error) {
    console.error('Error fetching publish history:', error)
    res.status(500).json({ error: error.message })
  }
})

// 删除发布历史记录
app.delete('/api/publish/history/:id', (req, res) => {
  try {
    const { id } = req.params
    let history = loadPublishHistory()
    history = history.filter(item => item.id !== id)
    savePublishHistory(history)
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting publish history:', error)
    res.status(500).json({ error: error.message })
  }
})

// 图片管理系统 API

// 获取图片库
app.get('/api/images', (req, res) => {
  try {
    const { category, tags } = req.query
    const tagArray = tags ? tags.split(',') : null
    const images = getImageLibrary(category, tagArray)
    res.json(images)
  } catch (error) {
    console.error('Error fetching images:', error)
    res.status(500).json({ error: error.message })
  }
})

// 获取图片分类
app.get('/api/images/categories', (req, res) => {
  try {
    const metadata = loadImagesMetadata()
    const categories = [...new Set(metadata.map(item => item.category))]
    res.json(categories)
  } catch (error) {
    console.error('Error fetching categories:', error)
    res.status(500).json({ error: error.message })
  }
})

// 获取所有标签
app.get('/api/images/tags', (req, res) => {
  try {
    const metadata = loadImagesMetadata()
    const tags = [...new Set(metadata.flatMap(item => item.tags))]
    res.json(tags)
  } catch (error) {
    console.error('Error fetching tags:', error)
    res.status(500).json({ error: error.message })
  }
})

// 删除图片
app.delete('/api/images/:id', (req, res) => {
  try {
    const { id } = req.params
    deleteImage(id)
    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting image:', error)
    res.status(500).json({ error: error.message })
  }
})

// 更新图片信息
app.patch('/api/images/:id', (req, res) => {
  try {
    const { id } = req.params
    const { title, category, tags } = req.body
    const updated = updateImageInfo(id, { title, category, tags })
    
    if (updated) {
      res.json(updated)
    } else {
      res.status(404).json({ error: '图片不存在' })
    }
  } catch (error) {
    console.error('Error updating image:', error)
    res.status(500).json({ error: error.message })
  }
})

// 获取图片库统计
app.get('/api/images/stats', (req, res) => {
  try {
    const metadata = loadImagesMetadata()
    const categories = [...new Set(metadata.map(item => item.category))]
    const providers = [...new Set(metadata.map(item => item.provider))]
    
    res.json({
      totalImages: metadata.length,
      categories: categories.length,
      providers: providers.length,
      categoryBreakdown: categories.map(cat => ({
        category: cat,
        count: metadata.filter(item => item.category === cat).length
      })),
      providerBreakdown: providers.map(prov => ({
        provider: prov,
        count: metadata.filter(item => item.provider === prov).length
      }))
    })
  } catch (error) {
    console.error('Error getting image stats:', error)
    res.status(500).json({ error: error.message })
  }
})

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

// 服务端配置状态查询（只暴露「是否已配置」，不返回 Key 明文）
app.get('/api/config/status', (req, res) => {
  const hasMaasKey  = !!SERVER_AI_CONFIG.maasApiKey
  const hasOpenaiKey = !!SERVER_AI_CONFIG.articleApiKey
  const hasCoverKey = !!SERVER_AI_CONFIG.coverApiKey
  const hasStabilityKey = !!SERVER_AI_CONFIG.stabilityApiKey

  // 推断服务端默认的文章 provider
  let serverArticleProvider = SERVER_AI_CONFIG.articleProvider
  if (!serverArticleProvider || serverArticleProvider === 'openai') {
    // 如果配置了 MaaS Key，优先展示 maas
    if (hasMaasKey) serverArticleProvider = 'maas'
    else if (hasOpenaiKey) serverArticleProvider = 'openai'
    else serverArticleProvider = null
  }

  res.json({
    // 文章生成
    articleProvider: serverArticleProvider,
    articleReady: hasMaasKey || hasOpenaiKey,
    maasReady: hasMaasKey,
    maasEmail: hasMaasKey ? SERVER_AI_CONFIG.maasUserEmail : null,
    openaiReady: hasOpenaiKey,
    // 封面生成
    coverProvider: SERVER_AI_CONFIG.coverProvider || 'local',
    coverReady: hasCoverKey || hasStabilityKey || SERVER_AI_CONFIG.coverProvider === 'local',
    dalleReady: hasCoverKey,
    stabilityReady: hasStabilityKey,
  })
})

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`)
  console.log(`📁 Project root: ${PROJECT_ROOT}`)
  console.log(`📝 Drafts directory: ${DRAFTS_DIR}`)
  console.log(`💾 Cache directory: ${CACHE_DIR}`)
})
