/**
 * 服务端配置中心
 * 负责 dotenv 加载、路径常量、AI 配置
 *
 * 运行环境：
 *   - 普通 Node.js（web 模式）：从 web/.env 或根目录 .env 加载
 *   - Electron 桌面应用：ELECTRON_APP=true，数据目录改用系统 userData 路径
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// web/ 目录（server/ 的上一级）
const WEB_DIR = path.join(__dirname, '..')

// ── Electron 环境检测 ─────────────────────────────────────────────────────────
const IS_ELECTRON = process.env.ELECTRON_APP === 'true'
// Electron 主进程在 app.whenReady 之前设置这两个环境变量
const ELECTRON_USER_DATA = process.env.ELECTRON_USER_DATA || ''
const ELECTRON_DOCUMENTS = process.env.ELECTRON_DOCUMENTS || ''

// ── dotenv 加载（Electron 打包模式下跳过，配置已通过 settings 表管理）────────

if (!IS_ELECTRON || ELECTRON_USER_DATA === '') {
  // 依次尝试：web/.env → 项目根目录 .env
  const envInWebDir = path.join(WEB_DIR, '.env')
  const envInRoot = path.join(WEB_DIR, '..', '.env')

  if (fs.existsSync(envInWebDir)) {
    dotenv.config({ path: envInWebDir })
  } else if (fs.existsSync(envInRoot)) {
    dotenv.config({ path: envInRoot })
    // 根目录 .env 里的相对路径以项目根目录为基准展开
    const root = path.join(WEB_DIR, '..')
    const expandIfRelative = (key: string) => {
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
}

// ── 路径常量 ─────────────────────────────────────────────────────────────────

let PROJECT_ROOT_DEFAULT, DATA_DIR_DEFAULT, DRAFTS_DIR_DEFAULT, AGENTS_FILE_DEFAULT, WRITING_GUIDE_FILE_DEFAULT

if (IS_ELECTRON && ELECTRON_USER_DATA) {
  // Electron 模式：数据存放在系统 userData 目录
  // Mac: ~/Library/Application Support/autowriting
  // Win: %APPDATA%/autowriting
  PROJECT_ROOT_DEFAULT = ELECTRON_USER_DATA
  DATA_DIR_DEFAULT = path.join(ELECTRON_USER_DATA, 'data')
  DRAFTS_DIR_DEFAULT = path.join(ELECTRON_DOCUMENTS, 'autowriting', 'drafts')
  AGENTS_FILE_DEFAULT = path.join(ELECTRON_USER_DATA, 'AGENTS.md')
  WRITING_GUIDE_FILE_DEFAULT = path.join(ELECTRON_USER_DATA, '写作规范.md')
} else {
  // 普通 Web 模式：路径相对于项目根目录
  PROJECT_ROOT_DEFAULT = path.join(WEB_DIR, '..')
  DATA_DIR_DEFAULT = path.join(PROJECT_ROOT_DEFAULT, '.cache')
  DRAFTS_DIR_DEFAULT = path.join(PROJECT_ROOT_DEFAULT, '公众号写作', 'drafts')
  AGENTS_FILE_DEFAULT = path.join(PROJECT_ROOT_DEFAULT, 'AGENTS.md')
  WRITING_GUIDE_FILE_DEFAULT = path.join(PROJECT_ROOT_DEFAULT, '写作参考', '写作规范.md')
}

export const PROJECT_ROOT = process.env.PROJECT_ROOT || PROJECT_ROOT_DEFAULT
export const DRAFTS_DIR = process.env.DRAFTS_DIR || DRAFTS_DIR_DEFAULT
export const AGENTS_FILE = process.env.AGENTS_FILE || AGENTS_FILE_DEFAULT
export const WRITING_GUIDE_FILE = process.env.WRITING_GUIDE_FILE || WRITING_GUIDE_FILE_DEFAULT
export const DATA_DIR = process.env.DATA_DIR || DATA_DIR_DEFAULT
export const CACHE_DIR = path.join(DATA_DIR, 'covers')
export const HISTORY_FILE = path.join(DATA_DIR, 'cover_history.json')

export const IMAGES_DIR = path.join(DATA_DIR, 'images')
export const IMAGES_METADATA_FILE = path.join(DATA_DIR, 'images_metadata.json')

export const PUBLISH_DIR = path.join(DATA_DIR, 'publish')
export const PUBLISH_HISTORY_FILE = path.join(DATA_DIR, 'publish_history.json')

export const PORT = process.env.PORT || 3000

// ── AGENTS.md 内容缓存 ────────────────────────────────────────────────────────

let _agentsCache: string | null = null

/**
 * 读取 AGENTS.md 内容（项目级 AI 编码助手索引），带内存缓存。
 * 文件发生变化时自动清除缓存，下次调用时重新读取。
 *
 * 注意：AGENTS.md 是给 AI 编码助手用的项目规范，不要在文章生成 / 分析 / 大纲
 * 等 LLM 调用里注入，否则会浪费大量 token 并且可能干扰输出（ESLint 规则、
 * commit 规范跟"写公众号文章"完全无关）。写作类提示词请使用
 * getWritingGuideContent()。
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
    console.log('[Config] AGENTS.md 已变化，清除缓存')
    _agentsCache = null
  })
  return _agentsCache
}

// ── 写作规范文件缓存 ─────────────────────────────────────────────────────────

let _writingGuideCache: string | null = null

/**
 * 读取专门的「公众号写作规范」文件，供文章生成 / 分析 / 大纲提示词使用。
 * 文件不存在时返回空串，调用方应根据空串跳过整段「# 写作规范」拼接，
 * 避免给 LLM 输入无意义的标题占位。
 *
 * 默认路径：`写作参考/写作规范.md`，可通过环境变量 WRITING_GUIDE_FILE 覆盖。
 */
export function getWritingGuideContent() {
  if (_writingGuideCache !== null) return _writingGuideCache
  if (!fs.existsSync(WRITING_GUIDE_FILE)) {
    _writingGuideCache = ''
    return ''
  }
  _writingGuideCache = fs.readFileSync(WRITING_GUIDE_FILE, 'utf-8')
  fs.watchFile(WRITING_GUIDE_FILE, { interval: 5000 }, () => {
    console.log('[Config] 写作规范.md 已变化，清除缓存')
    _writingGuideCache = null
  })
  return _writingGuideCache
}

// ── 服务端 AI 配置 ───────────────────────────────────────────────────────────

export const SERVER_AI_CONFIG = {
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
  // SiliconFlow / Kolors
  siliconflowApiKey: process.env.SILICONFLOW_API_KEY || '',
  siliconflowBaseUrl: process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1',
  siliconflowModel: process.env.SILICONFLOW_MODEL || 'Kwai-Kolors/Kolors',

  // Imgur 图床
  imgurClientId: process.env.IMGUR_CLIENT_ID || '',

  // 搜索
  glmApiKey: process.env.GLM_API_KEY || process.env.OPENAI_API_KEY || '',
  searchProvider: process.env.SEARCH_PROVIDER || '',
  searchApiKey: process.env.SEARCH_API_KEY || process.env.SERPER_API_KEY || process.env.SERPAPI_KEY || '',
  searchEngine: process.env.SEARCH_ENGINE || 'bing',
  searxngUrl: process.env.SEARXNG_URL || '',
  jinaApiKey: process.env.JINA_API_KEY || '',
}
