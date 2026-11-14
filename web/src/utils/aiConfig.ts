import { aiPreferences, DEEPSEEK_KEY_HEADER, isDeepSeekApiKey } from '../../shared/aiPreferences'

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

export type ArticleProvider = 'maas' | 'openai' | 'openai-compat' | 'zhipu' | 'deepseek'
export type CoverProvider = 'local' | 'openai' | 'openrouter' | 'gencli' | 'stability' | 'siliconflow' | 'z-image' | 'qwen-edit' | 'doubao' | 'zhipu'

export interface AIConfig {
  // 服务商公共 Key（工具自己的 Key 非空时仍优先使用工具 Key）
  zhipuApiKey: string
  deepseekApiKey: string

  // 文章生成
  articleProvider: ArticleProvider
  articleModel: string
  articleApiKey: string
  articleBaseUrl: string   // openai-compat 自定义 endpoint

  // 封面生成
  coverProvider: CoverProvider
  coverApiKey: string
  openrouterApiKey: string
  zhipuImageApiKey: string

  // SiliconFlow / Kolors
  siliconflowApiKey: string
  siliconflowModel: string

  // 火山方舟 / 豆包 Seedream
  doubaoApiKey: string
  doubaoBaseUrl: string
  doubaoModel: string

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
  embeddingExtraHeaders: string  // 可选，JSON 格式额外请求头
  localEmbeddingModel:   string  // 可选，本地向量模型 ID（无 API Key 时使用）
  embeddingBatchSize:    string  // 可选，每批并发数，默认 "16"（遇到 429 可调小）
  embeddingBatchDelayMs: string  // 可选，批次间延迟 ms，默认 "200"

  // 智谱云知识库（与本地索引可独立或混合使用）
  zhipuKnowledgeMode: 'off' | 'remote' | 'hybrid'
  zhipuKnowledgeIds: string
  zhipuKnowledgeRecallMethod: 'embedding' | 'keyword' | 'mixed'
  zhipuKnowledgeRerank: boolean

  // 素材搜索
  searchProvider: 'serper' | 'bing' | 'searxng' | 'zhipu' | 'deepseek'  // 搜索引擎服务商（zhipu 可复用 GLM_API_KEY）
  searchApiKey:   string                          // 搜索 API Key（serper 需要单独的 Key；zhipu 复用 articleApiKey 时可不填）
  searchEngine:   string                          // serper engine：google / baidu / bing
  searxngUrl:     string                          // SearXNG 实例地址（可选，默认公共实例）
  glmApiKey:      string                          // 智谱 API Key（搜索复用，与 articleApiKey 一致时可留空）

  // 网页抓取（优先 Jina Reader，降级内置 WebFetcher）
  jinaApiKey:     string                          // Jina Reader API Key（可选，有 key 时优先使用）

  // 图床
  cdnProvider:   'none' | 'imgur' | 'github'  // 选择图床方案
  imgurClientId: string                        // Imgur Client ID
  githubToken:   string                        // GitHub Personal Access Token（需要 repo 权限）
  githubRepo:    string                        // 仓库，格式：username/repo
  githubBranch:  string                        // 分支，默认 main
  githubPath:    string                        // 存储目录，默认 images/
}

export const DEFAULT_CONFIG: AIConfig = {
  zhipuApiKey: '',
  deepseekApiKey: '',
  articleProvider: 'openai',
  articleModel: 'gpt-4o',
  articleApiKey: '',
  articleBaseUrl: 'https://api.openai.com/v1',

  coverProvider: 'siliconflow',
  coverApiKey: '',
  openrouterApiKey: '',
  zhipuImageApiKey: '',

  siliconflowApiKey: '',
  siliconflowModel: 'Kwai-Kolors/Kolors',

  doubaoApiKey: '',
  doubaoBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  doubaoModel: '',

  maasApiKey: '',
  maasBaseUrl: 'https://maas.devops.xiaohongshu.com/v1',
  maasUserEmail: '',

  embeddingApiKey:       '',
  embeddingBaseUrl:      'https://api.openai.com/v1',
  embeddingModel:        'text-embedding-3-small',
  embeddingDimensions:   '',
  embeddingInstruction:  '',
  embeddingExtraHeaders:  '',
  localEmbeddingModel:    '',
  embeddingBatchSize:     '1',
  embeddingBatchDelayMs:  '3000',

  zhipuKnowledgeMode: 'off',
  zhipuKnowledgeIds: '',
  zhipuKnowledgeRecallMethod: 'mixed',
  zhipuKnowledgeRerank: true,

  searchProvider: 'serper',
  searchApiKey:   '',
  searchEngine:   'google',
  searxngUrl:     '',
  glmApiKey:       '',
  jinaApiKey:     '',

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
  const config = loadStoredAIConfig()
  try {
    if (localStorage.getItem(GENCLI_COVER_KEY) === 'on') return { ...config, coverProvider: 'gencli' }
  } catch { /* ignore */ }
  return config
}

function loadStoredAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG }
}

const GENCLI_PAIRING_KEY = 'dashy-gencli-pairing'
const GENCLI_COVER_KEY = 'dashy-gencli-cover'

export function loadGenCliPairingCode(): string {
  try { return localStorage.getItem(GENCLI_PAIRING_KEY) || '' }
  catch { return '' }
}

export function saveGenCliPairingCode(code: string): void {
  localStorage.setItem(GENCLI_PAIRING_KEY, code.trim())
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
    const merged = { ...loadStoredAIConfig(), ...aiPreferences(serverConfig) }
    // 写回 localStorage 保证后续同步读取拿到最新值
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    window.dispatchEvent(new CustomEvent('ai-config-updated'))
    return loadAIConfig()
  } catch {
    return null
  }
}

/** 保存配置：同步写 localStorage + 异步写服务端 */
export function saveAIConfig(config: AIConfig): void {
  // 保留服务器封面选择供定时任务使用。本机选择和配对码各自只保存在浏览器。
  const browserGenCli = config.coverProvider === 'gencli'
  const persisted = browserGenCli ? { ...config, coverProvider: loadStoredAIConfig().coverProvider } : config
  try {
    localStorage.setItem(GENCLI_COVER_KEY, browserGenCli ? 'on' : '')
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    window.dispatchEvent(new CustomEvent('ai-config-updated'))
  } catch { /* ignore */ }

  const serverConfig = aiPreferences(persisted)
  void authFetch('/api/settings', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ 'ai-config': serverConfig }),
  }).catch(() => { /* 网络失败静默，localStorage 已保存 */ })
}

export function deepSeekKeyHeaders(key = loadAIConfig().deepseekApiKey): Record<string, string> {
  const cleaned = typeof key === "string" ? key.trim() : ""
  return isDeepSeekApiKey(cleaned) ? { [DEEPSEEK_KEY_HEADER]: cleaned } : {}
}

// 临时请求可以带其他模型参数。DeepSeek 凭据单独走请求头，避免混入可保存的配置对象。
export function aiRequestConfig<T extends Record<string, unknown> | AIConfig>(config: T): Omit<T, 'deepseekApiKey'> {
  const { deepseekApiKey: _key, ...payload } = config
  return payload
}

export function getEffectiveArticleConfig(config: AIConfig) {
  switch (config.articleProvider) {
    case 'deepseek':
      return { baseUrl: 'https://api.deepseek.com', apiKey: config.deepseekApiKey, model: 'deepseek-flash', headers: {} }
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
    case 'zhipu': {
      const apiKey = config.articleApiKey || config.zhipuApiKey
      return {
        baseUrl: config.articleBaseUrl || 'https://open.bigmodel.cn/api/paas/v4',
        apiKey,
        model: config.articleModel || 'glm-5.3',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        }
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
  tip: string
  url: string
}> = [
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    desc: 'V4.1 Flash，用于大纲、素材整理和文章生成',
    defaultBaseUrl: 'https://api.deepseek.com',
    models: ['deepseek-flash'],
    tip: '复用「公共 Key」中的 DeepSeek Key',
    url: 'https://platform.deepseek.com/'
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    desc: '智谱官方 OpenAI 兼容接口',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.3', 'glm-5.3-flash'],
    tip: '可复用“公共 Key”中的智谱 Key',
    url: 'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    desc: '官方 ChatGPT API',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    tip: '默认模型：gpt-4o，支持更多模型请参考官方文档',
    url: 'https://platform.openai.com/docs/models/gpt-4o'
  },
  {
    id: 'openai-compat',
    name: '自定义（OpenAI 兼容）',
    desc: 'Claude / DeepSeek / Gemini / 本地模型等',
    defaultBaseUrl: '',
    models: ['claude-opus-4-5', 'deepseek-chat', 'gemini-pro'],
    tip: 'OPENAI 兼容模型，一般使用deepseek-v4',
    url: 'https://deepseek.com'
  },
  {
    id: 'maas',
    name: 'MaaS（内部）',
    desc: '小红书内部 MaaS 服务',
    defaultBaseUrl: 'https://maas.devops.xiaohongshu.com/v1',
    models: ['deepseek-v4-pro'],
    tip: '小红书内部使用ALLINAI平台提供的api key，无需额外申请',
    url: 'https://cowork.xiaohongshu.com/app'
  },
]

export const COVER_PROVIDER_PRESETS = [
  { id: 'local'       as CoverProvider, name: 'SVG 占位',      desc: '无需 API，免费即时生成' },
  { id: 'doubao'      as CoverProvider, name: '豆包 Seedream', desc: '火山方舟，中文提示词友好' },
  { id: 'zhipu'       as CoverProvider, name: '智谱 GLM-Image', desc: '文字与复杂版式表现更好' },
  { id: 'siliconflow' as CoverProvider, name: 'Kolors 可图',   desc: 'SiliconFlow，性价比高' },
  { id: 'z-image'     as CoverProvider, name: 'Z-Image 造相',  desc: 'SiliconFlow，支持复杂提示词' },
  { id: 'qwen-edit'   as CoverProvider, name: 'Qwen 图片编辑', desc: 'SiliconFlow，对已有封面精修' },
  { id: 'openai'      as CoverProvider, name: 'DALL-E 3',      desc: '需要 OpenAI API Key' },
  { id: 'openrouter'  as CoverProvider, name: 'GPT Image 2',   desc: 'OpenRouter Key 保存在当前浏览器' },
  { id: 'gencli'     as CoverProvider, name: 'Gen CLI',      desc: '从当前电脑调用 GPT Image 2' },
  { id: 'stability'   as CoverProvider, name: 'Stability AI',  desc: '需要 Stability API Key' },
]
