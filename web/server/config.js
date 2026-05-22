/**
 * 服务端配置中心
 * 负责 dotenv 加载、路径常量、AI 配置
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// web/ 目录（server/ 的上一级）
const WEB_DIR = path.join(__dirname, '..')

// 依次尝试：web/.env → 项目根目录 .env
const envInWebDir = path.join(WEB_DIR, '.env')
const envInRoot   = path.join(WEB_DIR, '..', '.env')

if (fs.existsSync(envInWebDir)) {
  dotenv.config({ path: envInWebDir })
} else if (fs.existsSync(envInRoot)) {
  dotenv.config({ path: envInRoot })
  // 根目录 .env 里的相对路径以项目根目录为基准展开
  const root = path.join(WEB_DIR, '..')
  const expandIfRelative = (key) => {
    if (process.env[key] && !path.isAbsolute(process.env[key])) {
      process.env[key] = path.join(root, process.env[key])
    }
  }
  expandIfRelative('DRAFTS_DIR')
  expandIfRelative('AGENTS_FILE')
  expandIfRelative('DATA_DIR')
  expandIfRelative('CACHE_DIR')
} else {
  dotenv.config()
}

// ── 路径常量 ─────────────────────────────────────────────────────────────────

export const PROJECT_ROOT = process.env.PROJECT_ROOT || path.join(WEB_DIR, '..')
export const DRAFTS_DIR   = process.env.DRAFTS_DIR   || path.join(PROJECT_ROOT, '公众号写作', 'drafts')
export const AGENTS_FILE  = process.env.AGENTS_FILE  || path.join(PROJECT_ROOT, 'AGENTS.md')
export const DATA_DIR     = process.env.DATA_DIR     || path.join(PROJECT_ROOT, '.cache')
export const CACHE_DIR    = path.join(DATA_DIR, 'covers')
export const HISTORY_FILE = path.join(DATA_DIR, 'cover_history.json')

export const IMAGES_DIR           = path.join(DATA_DIR, 'images')
export const IMAGES_METADATA_FILE = path.join(DATA_DIR, 'images_metadata.json')

export const PUBLISH_DIR          = path.join(DATA_DIR, 'publish')
export const PUBLISH_HISTORY_FILE = path.join(DATA_DIR, 'publish_history.json')

export const PORT = process.env.PORT || 3000

// ── AGENTS.md 内容缓存 ────────────────────────────────────────────────────────

let _agentsCache = null

/**
 * 读取 AGENTS.md 写作规范，带内存缓存。
 * 文件发生变化时自动清除缓存，下次调用时重新读取。
 */
export function getAgentsContent() {
  if (_agentsCache !== null) return _agentsCache
  if (!fs.existsSync(AGENTS_FILE)) {
    _agentsCache = ''
    return ''
  }
  _agentsCache = fs.readFileSync(AGENTS_FILE, 'utf-8')
  // 监听文件变动，自动失效缓存（只注册一次）
  fs.watchFile(AGENTS_FILE, { interval: 5000 }, () => {
    console.log('[Config] AGENTS.md 已变化，清除写作规范缓存')
    _agentsCache = null
  })
  return _agentsCache
}

// ── 服务端 AI 配置 ───────────────────────────────────────────────────────────

export const SERVER_AI_CONFIG = {
  // 文章生成
  articleProvider: process.env.ARTICLE_PROVIDER || 'openai',
  articleApiKey:   process.env.OPENAI_API_KEY || process.env.ARTICLE_API_KEY || '',
  articleBaseUrl:  process.env.ARTICLE_BASE_URL || 'https://api.openai.com/v1',
  articleModel:    process.env.ARTICLE_MODEL || 'gpt-4o',
  // MaaS（内部）
  maasApiKey:      process.env.MAAS_API_KEY || '',
  maasBaseUrl:     process.env.MAAS_BASE_URL || 'https://maas.devops.xiaohongshu.com/v1',
  maasUserEmail:   process.env.MAAS_USER_EMAIL || '',
  // 封面
  coverProvider:      process.env.COVER_PROVIDER || 'local',
  coverApiKey:        process.env.COVER_API_KEY || process.env.OPENAI_API_KEY || '',
  // Stability（保留兼容）
  stabilityApiKey:    process.env.STABILITY_API_KEY || '',
  stabilityBaseUrl:   process.env.STABILITY_BASE_URL || 'https://api.stability.ai/v1',
  // SiliconFlow / Kolors
  siliconflowApiKey:  process.env.SILICONFLOW_API_KEY || '',
  siliconflowBaseUrl: process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1',
  siliconflowModel:   process.env.SILICONFLOW_MODEL || 'Kwai-Kolors/Kolors',

  // Imgur 图床
  imgurClientId: process.env.IMGUR_CLIENT_ID || '',
}
