/* ============================================================
 * aiConfig.ts — 用户 AI 配置，存储在 localStorage
 * ============================================================ */

const STORAGE_KEY = 'wx-ai-config-v1'

export type ArticleProvider = 'maas' | 'openai' | 'openai-compat'
export type CoverProvider = 'local' | 'openai' | 'stability'

export interface AIConfig {
  // 文章生成
  articleProvider: ArticleProvider
  articleModel: string
  articleApiKey: string
  articleBaseUrl: string   // openai-compat 自定义 endpoint

  // 封面生成
  coverProvider: CoverProvider
  coverApiKey: string

  // MaaS 专用（内部用，外部用户不填）
  maasApiKey: string
  maasBaseUrl: string
  maasUserEmail: string
}

export const DEFAULT_CONFIG: AIConfig = {
  articleProvider: 'openai',
  articleModel: 'gpt-4o',
  articleApiKey: '',
  articleBaseUrl: 'https://api.openai.com/v1',

  coverProvider: 'local',
  coverApiKey: '',

  maasApiKey: '',
  maasBaseUrl: 'https://maas.devops.xiaohongshu.com/v1',
  maasUserEmail: '',
}

export function loadAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG }
}

export function saveAIConfig(config: AIConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    // 通知其他组件配置已更新
    window.dispatchEvent(new CustomEvent('ai-config-updated'))
  } catch { /* ignore */ }
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
  { id: 'local' as CoverProvider, name: 'SVG 占位（免费）', desc: '无需 API，直接生成矢量占位图' },
  { id: 'openai' as CoverProvider, name: 'DALL-E 3（OpenAI）', desc: '需要 OpenAI API Key' },
  { id: 'stability' as CoverProvider, name: 'Stability AI', desc: '需要 Stability API Key' },
]
