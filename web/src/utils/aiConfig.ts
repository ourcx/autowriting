/* ============================================================
 * aiConfig.ts — 用户 AI 配置，存储在 localStorage
 * ============================================================ */

const STORAGE_KEY = 'wx-ai-config-v1'
const TOKEN_KEY   = 'auth_token'

/** 带 JWT Authorization header 的 fetch 封装 */
function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem(TOKEN_KEY)
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> ?? {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(url, { ...init, headers })
}

export type ArticleProvider = 'maas' | 'openai' | 'openai-compat'
export type CoverProvider = 'local' | 'openai' | 'stability' | 'siliconflow' | 'z-image' | 'qwen-edit'

export interface AIConfig {
  // 文章生成
  articleProvider: ArticleProvider
  articleModel: string
  articleApiKey: string
  articleBaseUrl: string   // openai-compat 自定义 endpoint

  // 封面生成
  coverProvider: CoverProvider
  coverApiKey: string

  // SiliconFlow / Kolors
  siliconflowApiKey: string
  siliconflowModel: string

  // MaaS 专用（内部用，外部用户不填）
  maasApiKey: string
  maasBaseUrl: string
  maasUserEmail: string

  // Embedding（向量索引）
  embeddingApiKey:      string  // 默认回落到 articleApiKey
  embeddingBaseUrl:     string  // 默认 https://api.openai.com/v1
  embeddingModel:       string  // 默认 text-embedding-3-small
  embeddingDimensions:  string  // 可选，输出向量维度，如 "1024"
  embeddingInstruction: string  // 可选，任务指令（部分模型支持）
  embeddingExtraHeaders:string  // 可选，JSON 格式额外请求头

  // 素材搜索
  searchProvider: 'serper' | 'bing'  // 搜索引擎服务商
  searchApiKey:   string             // 搜索 API Key
  searchEngine:   string             // serper engine：google / baidu / bing

  // 图床
  cdnProvider:   'none' | 'imgur' | 'github'  // 选择图床方案
  imgurClientId: string                        // Imgur Client ID
  githubToken:   string                        // GitHub Personal Access Token（需要 repo 权限）
  githubRepo:    string                        // 仓库，格式：username/repo
  githubBranch:  string                        // 分支，默认 main
  githubPath:    string                        // 存储目录，默认 images/
}

export const DEFAULT_CONFIG: AIConfig = {
  articleProvider: 'openai',
  articleModel: 'gpt-4o',
  articleApiKey: '',
  articleBaseUrl: 'https://api.openai.com/v1',

  coverProvider: 'siliconflow',
  coverApiKey: '',

  siliconflowApiKey: '',
  siliconflowModel: 'Kwai-Kolors/Kolors',

  maasApiKey: '',
  maasBaseUrl: 'https://maas.devops.xiaohongshu.com/v1',
  maasUserEmail: '',

  embeddingApiKey:       '',
  embeddingBaseUrl:      'https://api.openai.com/v1',
  embeddingModel:        'text-embedding-3-small',
  embeddingDimensions:   '',
  embeddingInstruction:  '',
  embeddingExtraHeaders: '',

  searchProvider: 'serper',
  searchApiKey:   '',
  searchEngine:   'google',

  cdnProvider:  'none',
  imgurClientId: '',
  githubToken:  '',
  githubRepo:   '',
  githubBranch: 'main',
  githubPath:   'images/',
}

// 快速预设方案（用户可一键应用）
export const CONFIG_PRESETS = [
  {
    id: 'openai-basic',
    name: 'OpenAI 基础方案',
    desc: '使用 OpenAI API，适合大多数用户',
    config: {
      articleProvider: 'openai',
      articleModel: 'gpt-4o-mini',
      coverProvider: 'openai',
    }
  },
  {
    id: 'openai-pro',
    name: 'OpenAI 专业方案',
    desc: '使用 GPT-4o + DALL-E 3，质量最高',
    config: {
      articleProvider: 'openai',
      articleModel: 'gpt-4o',
      coverProvider: 'openai',
    }
  },
  {
    id: 'siliconflow-budget',
    name: 'SiliconFlow 经济方案',
    desc: '使用开源模型，成本最低',
    config: {
      articleProvider: 'openai-compat',
      articleModel: 'deepseek-chat',
      coverProvider: 'siliconflow',
      siliconflowModel: 'Kwai-Kolors/Kolors',
    }
  },
  {
    id: 'maas-internal',
    name: '小红书 MaaS（内部）',
    desc: '使用内部 MaaS 服务',
    config: {
      articleProvider: 'maas',
      coverProvider: 'siliconflow',
    }
  },
]

/** 同步读取（优先 localStorage，保证组件渲染不阻塞） */
export function loadAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG }
}

/**
 * 从服务端拉取 AI 配置并写入 localStorage（异步，用于初始化同步）
 * 调用方：App 启动时 useEffect 中调用一次即可
 */
export async function syncAIConfigFromServer(): Promise<AIConfig | null> {
  try {
    const resp = await authFetch('/api/settings/ai-config')
    if (!resp.ok) return null
    const data = await resp.json() as { value?: string | Partial<AIConfig> | null }
    if (!data?.value) return null  // key 不存在时 value 为 null，直接降级到 localStorage
    // getSetting 已在服务端做了 JSON.parse，value 可能是对象也可能是字符串
    const serverConfig: Partial<AIConfig> =
      typeof data.value === 'string'
        ? (JSON.parse(data.value) as Partial<AIConfig>)
        : (data.value as Partial<AIConfig>)
    const merged = { ...DEFAULT_CONFIG, ...serverConfig }
    // 写回 localStorage 保证后续同步读取拿到最新值
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    window.dispatchEvent(new CustomEvent('ai-config-updated'))
    return merged
  } catch {
    return null
  }
}

/** 保存配置：同步写 localStorage + 异步写服务端 */
export function saveAIConfig(config: AIConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    window.dispatchEvent(new CustomEvent('ai-config-updated'))
  } catch { /* ignore */ }

  // 异步持久化到服务端 settings 表（setSetting 内部会做 JSON.stringify，直接传对象即可）
  authFetch('/api/settings', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ 'ai-config': config }),
  }).catch(() => { /* 网络失败静默，localStorage 已保存 */ })
}

export function getEffectiveArticleConfig(config: AIConfig) {
  switch (config.articleProvider) {
    case 'maas':
      return {
        baseUrl: config.maasBaseUrl,
        apiKey: config.maasApiKey,
        model: 'deepseek-v4-pro',
        headers: {
          'api-key': config.maasApiKey,
          'x-maas-user-email': config.maasUserEmail,
          'x-maas-app-id': 'qs-api',
        }
      }
    case 'openai':
    case 'openai-compat':
    default:
      return {
        baseUrl: config.articleBaseUrl || 'https://api.openai.com/v1',
        apiKey: config.articleApiKey,
        model: config.articleModel || 'gpt-4o',
        headers: {
          'Authorization': `Bearer ${config.articleApiKey}`,
          'Content-Type': 'application/json',
        }
      }
  }
}

// 常见可兼容 OpenAI 格式的服务商预设
export const PROVIDER_PRESETS: Array<{
  id: ArticleProvider
  name: string
  desc: string
  defaultBaseUrl: string
  models: string[]
}> = [
  {
    id: 'openai',
    name: 'OpenAI',
    desc: '官方 ChatGPT API',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  {
    id: 'openai-compat',
    name: '自定义（OpenAI 兼容）',
    desc: 'Claude / DeepSeek / Gemini / 本地模型等',
    defaultBaseUrl: '',
    models: ['claude-opus-4-5', 'deepseek-chat', 'gemini-pro'],
  },
  {
    id: 'maas',
    name: 'MaaS（内部）',
    desc: '小红书内部 MaaS 服务',
    defaultBaseUrl: 'https://maas.devops.xiaohongshu.com/v1',
    models: ['deepseek-v4-pro'],
  },
]

export const COVER_PROVIDER_PRESETS = [
  { id: 'local'       as CoverProvider, name: 'SVG 占位',      desc: '无需 API，免费即时生成' },
  { id: 'siliconflow' as CoverProvider, name: 'Kolors 可图',   desc: 'SiliconFlow，性价比高' },
  { id: 'z-image'     as CoverProvider, name: 'Z-Image 造相',  desc: 'SiliconFlow，支持复杂提示词' },
  { id: 'qwen-edit'   as CoverProvider, name: 'Qwen 图片编辑', desc: 'SiliconFlow，对已有封面精修' },
  { id: 'openai'      as CoverProvider, name: 'DALL-E 3',      desc: '需要 OpenAI API Key' },
  { id: 'stability'   as CoverProvider, name: 'Stability AI',  desc: '需要 Stability API Key' },
]
