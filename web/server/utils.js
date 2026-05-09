/**
 * 公共工具函数
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import axios from 'axios'
import {
  CACHE_DIR, HISTORY_FILE,
  IMAGES_METADATA_FILE,
  PUBLISH_DIR, PUBLISH_HISTORY_FILE,
  SERVER_AI_CONFIG,
} from './config.js'

// ── 文件系统 ──────────────────────────────────────────────────────────────────

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// ── 封面缓存 ──────────────────────────────────────────────────────────────────

export function generateCacheKey(title, style, color) {
  const data = `${title}|${style}|${color}`
  return crypto.createHash('md5').update(data).digest('hex')
}

export function getCachedImage(cacheKey) {
  try {
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`)
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
    }
  } catch (e) {
    console.error('Error reading cache:', e)
  }
  return null
}

export function cacheImage(cacheKey, imageUrl, metadata) {
  try {
    ensureDir(CACHE_DIR)
    const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`)
    fs.writeFileSync(cachePath, JSON.stringify({ imageUrl, metadata, cachedAt: new Date().toISOString() }, null, 2), 'utf-8')
  } catch (e) {
    console.error('Error caching image:', e)
  }
}

// ── 封面历史 ──────────────────────────────────────────────────────────────────

export function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'))
    }
  } catch (e) {
    console.error('Error loading history:', e)
  }
  return []
}

export function saveHistory(history) {
  try {
    ensureDir(path.dirname(HISTORY_FILE))
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8')
  } catch (e) {
    console.error('Error saving history:', e)
  }
}

export function addToHistory(title, style, color, provider, imageUrl, cacheKey) {
  const history = loadHistory()
  history.unshift({
    id: Date.now().toString(),
    title, style, color, provider, imageUrl, cacheKey,
    createdAt: new Date().toISOString(),
    cached: false,
  })
  if (history.length > 100) history.pop()
  saveHistory(history)
  return history[0]
}

// ── 图片元数据 ────────────────────────────────────────────────────────────────

export function loadImagesMetadata() {
  try {
    if (fs.existsSync(IMAGES_METADATA_FILE)) {
      return JSON.parse(fs.readFileSync(IMAGES_METADATA_FILE, 'utf-8'))
    }
  } catch (e) {
    console.error('Error loading images metadata:', e)
  }
  return []
}

export function saveImagesMetadata(metadata) {
  try {
    ensureDir(path.dirname(IMAGES_METADATA_FILE))
    fs.writeFileSync(IMAGES_METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8')
  } catch (e) {
    console.error('Error saving images metadata:', e)
  }
}

export function addImageToLibrary(imageUrl, title, category, tags, provider) {
  const metadata = loadImagesMetadata()
  const imageItem = {
    id: Date.now().toString(),
    title, category,
    tags: Array.isArray(tags) ? tags : [],
    provider, imageUrl,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  metadata.unshift(imageItem)
  if (metadata.length > 500) metadata.pop()
  saveImagesMetadata(metadata)
  return imageItem
}

// ── 发布历史 ──────────────────────────────────────────────────────────────────

export function loadPublishHistory() {
  try {
    if (fs.existsSync(PUBLISH_HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(PUBLISH_HISTORY_FILE, 'utf-8'))
    }
  } catch (e) {
    console.error('Error loading publish history:', e)
  }
  return []
}

export function savePublishHistory(history) {
  try {
    ensureDir(path.dirname(PUBLISH_HISTORY_FILE))
    fs.writeFileSync(PUBLISH_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8')
  } catch (e) {
    console.error('Error saving publish history:', e)
  }
}

export function generateDraftFile(title, content, coverImage) {
  const draftId = Date.now().toString()
  const draftData = { id: draftId, title, content, coverImage, createdAt: new Date().toISOString(), status: 'draft' }
  ensureDir(PUBLISH_DIR)
  const draftPath = path.join(PUBLISH_DIR, `${draftId}.json`)
  fs.writeFileSync(draftPath, JSON.stringify(draftData, null, 2), 'utf-8')
  const history = loadPublishHistory()
  history.unshift({ id: draftId, title, createdAt: new Date().toISOString(), status: 'draft', filePath: draftPath })
  if (history.length > 50) history.pop()
  savePublishHistory(history)
  return draftData
}

// ── 封面图生成辅助 ────────────────────────────────────────────────────────────

export function generatePrompt(title, content, style, color) {
  const stylePrompts = {
    modern: 'modern minimalist design, clean typography, geometric shapes, professional',
    minimalist: 'minimalist design, white space, simple elegant, monochrome with accent color',
    gradient: 'gradient background, vibrant colors, smooth transitions, modern aesthetic',
    illustration: 'hand-drawn illustration style, artistic, colorful, creative',
    photography: 'professional photography, high quality, cinematic lighting, composition',
    abstract: 'abstract art, geometric patterns, modern, artistic composition',
  }
  const colorNames = {
    matcha: 'matcha green', slushie: 'cyan blue', lemon: 'golden yellow',
    ube: 'deep purple', pomegranate: 'coral red', blueberry: 'navy blue',
  }
  const styleDesc = stylePrompts[style] || stylePrompts.modern
  const colorDesc = colorNames[color] || 'vibrant colors'
  const contentPreview = (content || '').substring(0, 100).replace(/[#*\[\]]/g, '')
  return `Create a professional blog cover image for an article titled "${title}".
Style: ${styleDesc}.
Primary color: ${colorDesc}.
Content theme: ${contentPreview}.
Include the title text prominently.
High quality, 1200x630 pixels, suitable for WeChat public account.`
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
  const truncatedTitle = title.length > 30 ? title.substring(0, 27) + '...' : title
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .title-text { font-family: 'Roobert', Arial, sans-serif; font-size: 48px; font-weight: 600; fill: white; text-anchor: middle; }
      </style>
    </defs>
    ${pattern}
    <text x="600" y="280" class="title-text">${truncatedTitle}</text>
  </svg>`
}

export async function generateWithDallE(prompt, apiKey) {
  const key = apiKey || SERVER_AI_CONFIG.coverApiKey
  if (!key) throw new Error('OpenAI API key not configured. 请前往「AI 配置」页面设置。')
  const response = await axios.post(
    'https://api.openai.com/v1/images/generations',
    { model: 'dall-e-3', prompt, n: 1, size: '1024x1024', quality: 'hd', style: 'vivid' },
    { headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' } }
  )
  if (response.data.data?.length > 0) return response.data.data[0].url
  throw new Error('No image generated by DALL-E')
}
