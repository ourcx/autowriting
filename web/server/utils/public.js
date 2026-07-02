/**
 * 公共工具函数
 * 存储层已迁移至 SQLite（db.js），本文件保留图片生成、工具函数
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import axios from 'axios'
import { SERVER_AI_CONFIG } from '../config.js'
import {
  getCoverCache, setCoverCache,
  addCoverHistory, listCoverHistory,
  addImageToLibrary as dbAddImage,
  addPublishHistory,
} from '../db.js'

// ── LLM 请求构建（统一入口）────────────────────────────────────────────────────

/**
 * 根据 cfg 构造 LLM 请求所需的 url、model、headers
 * 支持 maas / openai / openai-compat 三种 provider
 */
export function buildLLMRequest(cfg) {
  const headers = { 'Content-Type': 'application/json' }
  let url = '', model = ''

  if (cfg.articleProvider === 'maas') {
    url   = `${cfg.maasBaseUrl}/chat/completions`
    model = cfg.maasModel || 'deepseek-v4-pro'
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

/**
 * 带指数退避重试的 LLM 调用（非流式）
 * 只重试网络错误和 5xx，4xx 直接抛出
 */
export async function callLLMWithRetry(url, body, headers, maxRetries = 3) {
  let lastErr
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await axios.post(url, body, { headers, timeout: 90000 })
    } catch (err) {
      lastErr = err
      const status = err.response?.status
      // 4xx 客户端错误（如鉴权失败、参数错误）不重试
      if (status && status >= 400 && status < 500) throw err
      if (i < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 8000)
        console.warn(`[LLM] 第 ${i + 1} 次请求失败，${delay}ms 后重试:`, err.message)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastErr
}

/**
 * 日志脱敏：将对象中的 apiKey / api_key / key 字段打码
 */
export function maskApiKey(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const result = {}
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase()
    if ((lk.includes('key') || lk.includes('api') || lk.includes('secret')) &&
        typeof v === 'string' && v.length > 8) {
      result[k] = `sk-...${v.slice(-6)}`
    } else if (v && typeof v === 'object') {
      result[k] = maskApiKey(v)
    } else {
      result[k] = v
    }
  }
  return result
}

// ── 文件系统工具 ──────────────────────────────────────────────────────────────

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// ── 封面缓存（SQLite） ────────────────────────────────────────────────────────

export function generateCacheKey(title, style, color) {
  return crypto.createHash('md5').update(`${title}|${style}|${color}`).digest('hex')
}

export function getCachedImage(cacheKey) {
  return getCoverCache(cacheKey)
}

export function cacheImage(cacheKey, imageUrl, metadata) {
  setCoverCache(cacheKey, imageUrl, metadata)
}

// ── 封面历史（SQLite） ────────────────────────────────────────────────────────

export function loadHistory() {
  return listCoverHistory()
}

export function saveHistory(_history) {
  // 已由 SQLite 管理，保留签名兼容旧调用
}

export function addToHistory(title, style, color, provider, imageUrl, cacheKey) {
  return addCoverHistory(title, style, color, provider, imageUrl, cacheKey)
}

// ── 图片元数据（SQLite） ──────────────────────────────────────────────────────

export function addImageToLibrary(imageUrl, title, category, tags, provider) {
  return dbAddImage(imageUrl, title, category, tags, provider)
}

// ── 封面图生成辅助 ────────────────────────────────────────────────────────────

export function generatePrompt(title, content, style, color) {
  const stylePrompts = {
    modern:       'modern flat design with bold geometric shapes, clean sans-serif typography, strong visual hierarchy, minimalist color blocking, professional and contemporary',
    minimalist:   'minimalist design with generous white space, single bold accent color, thin elegant lines, premium typography, sophisticated and clean',
    gradient:     'smooth gradient background with vibrant two-tone color wash, soft light rays and depth, contemporary aesthetic with subtle texture',
    illustration: 'flat vector illustration style with friendly characters or abstract icons, warm color palette, editorial and approachable feel',
    photography:  'cinematic background photography with shallow depth of field, dramatic directional lighting, magazine cover quality, professional and polished',
    abstract:     'bold abstract geometric shapes with dynamic composition, overlapping forms creating depth, artistic and eye-catching, modern art style',
  }
  const colorNames = {
    matcha: 'matcha green (#078a52) with white accents',
    slushie: 'cyan blue (#3bd3fd) with light backgrounds',
    lemon: 'golden yellow (#fbbd41) with dark text contrast',
    ube: 'deep purple (#43089f) with bright highlights',
    pomegranate: 'coral red (#fc7981) with soft shadows',
    blueberry: 'navy blue (#01418d) with light accents',
  }
  const styleDesc = stylePrompts[style] || stylePrompts.modern
  const colorDesc = colorNames[color]   || 'vibrant accent color'
  const preview   = (content || '').substring(0, 80).replace(/[#*\[\]`]/g, '').trim()
  const themeHint = preview ? `Article topic: ${preview}. ` : ''
  return `Create a high-quality WeChat public account article cover image.

Specifications:
- Aspect ratio: 2.35:1 (landscape, 1024×576 pixels minimum)
- Article title: "${title}"
- ${themeHint}

Visual Direction:
- Style: ${styleDesc}
- Color scheme: ${colorDesc}
- Composition: Balanced, professional, eye-catching
- Quality: High resolution, sharp details, vibrant colors

Requirements:
- NO text or typography in the image
- NO watermarks, logos, or borders
- Focus on visual impact that matches the article topic
- Suitable for social media and blog headers
- Professional quality suitable for publication
- Ensure good contrast and readability when used as a banner`
}

export function generatePlaceholderCover(title, style, color) {
  const colorMap = {
    matcha: '#078a52', slushie: '#3bd3fd', lemon: '#fbbd41',
    ube: '#43089f', pomegranate: '#fc7981', blueberry: '#01418d',
  }
  const bgColor = colorMap[color] || '#078a52'
  const stylePatterns = {
    modern:       `<rect x="0" y="0" width="1200" height="630" fill="${bgColor}"/><circle cx="600" cy="315" r="200" fill="rgba(255,255,255,0.1)"/>`,
    minimalist:   `<rect x="0" y="0" width="1200" height="630" fill="${bgColor}"/><line x1="100" y1="100" x2="1100" y2="100" stroke="white" stroke-width="2"/>`,
    gradient:     `<defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:${bgColor};stop-opacity:1" /><stop offset="100%" style="stop-color:rgba(255,255,255,0.3);stop-opacity:1" /></linearGradient></defs><rect x="0" y="0" width="1200" height="630" fill="url(#grad)"/>`,
    illustration: `<rect x="0" y="0" width="1200" height="630" fill="${bgColor}"/><circle cx="200" cy="200" r="80" fill="rgba(255,255,255,0.2)"/><circle cx="1000" cy="500" r="120" fill="rgba(255,255,255,0.15)"/>`,
    photography:  `<rect x="0" y="0" width="1200" height="630" fill="${bgColor}"/><rect x="50" y="50" width="1100" height="530" fill="none" stroke="white" stroke-width="3"/>`,
    abstract:     `<rect x="0" y="0" width="1200" height="630" fill="${bgColor}"/><polygon points="600,100 1100,400 600,630 100,400" fill="rgba(255,255,255,0.1)"/>`,
  }
  const pattern = stylePatterns[style] || stylePatterns.modern
  const truncated = title.length > 30 ? title.substring(0, 27) + '...' : title
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs><style>.tt{font-family:'Roobert',Arial,sans-serif;font-size:48px;font-weight:600;fill:white;text-anchor:middle}</style></defs>
    ${pattern}
    <text x="600" y="280" class="tt">${truncated}</text>
  </svg>`
}

export async function generateWithDallE(prompt, apiKey) {
  const key = apiKey || SERVER_AI_CONFIG.coverApiKey
  if (!key) throw new Error('OpenAI API key not configured. 请前往「AI 配置」页面设置。')
  const response = await axios.post(
    'https://api.openai.com/v1/images/generations',
    { model: 'dall-e-3', prompt, n: 1, size: '1024x1024', quality: 'hd', style: 'vivid' },
    { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } },
  )
  if (response.data.data?.length > 0) return response.data.data[0].url
  throw new Error('No image generated by DALL-E')
}

export async function generateWithSiliconFlow(prompt, apiKey, model) {
  const key = apiKey || SERVER_AI_CONFIG.siliconflowApiKey
  if (!key) throw new Error('SiliconFlow API key not configured. 请前往「AI 配置」页面设置。')
  const baseUrl = SERVER_AI_CONFIG.siliconflowBaseUrl
  const modelId = model || SERVER_AI_CONFIG.siliconflowModel
  const response = await axios.post(
    `${baseUrl}/images/generations`,
    {
      model: modelId,
      prompt,
      image_size: '1024x576',
      batch_size: 1,
      // 优化：提高推理步数从 20 到 30，提升图片质量
      // 更多步数 = 更精细的细节和更好的色彩准确度
      num_inference_steps: 30,
      // 优化：提高引导尺度从 7.5 到 8.5，增强提示词遵循度
      // 更高的值 = 更严格地遵循提示词，减少偏离
      guidance_scale: 8.5,
    },
    { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } },
  )
  // SiliconFlow 返回格式：{ images: [{ url: '...' }] }
  if (response.data.images?.length > 0) return response.data.images[0].url
  throw new Error('No image generated by SiliconFlow')
}

export async function generateWithQwenEdit(prompt, apiKey, baseImageBuffer, baseImageType) {
  const key = apiKey || SERVER_AI_CONFIG.siliconflowApiKey
  if (!key) throw new Error('SiliconFlow API key not configured. 请前往「AI 配置」页面设置。')

  const formData = new FormData()
  formData.append('model', 'Qwen/Qwen-Image-Edit-2509')
  formData.append('prompt', prompt)
  formData.append('size', '1024x1024')
  formData.append('n', '1')

  if (baseImageBuffer) {
    const blob = new Blob([baseImageBuffer], { type: baseImageType || 'image/png' })
    formData.append('image', blob, 'base.png')
  }

  const response = await fetch(
    `${SERVER_AI_CONFIG.siliconflowBaseUrl}/images/edits`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: formData,
    },
  )

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Qwen Image Edit error: ${response.status}`)
  }

  const data = await response.json()
  if (data.data?.[0]?.url)    return data.data[0].url
  if (data.images?.[0]?.url)  return data.images[0].url
  throw new Error('No image returned by Qwen Image Edit')
}

// ── 发布草稿（存储改走 SQLite） ───────────────────────────────────────────────

export function generateDraftFile(title, content, coverImage) {
  return addPublishHistory(title, content, coverImage)
}
