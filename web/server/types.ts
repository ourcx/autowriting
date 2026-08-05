/**
 * 服务端共享类型定义
 */

import type { Request } from "express"

// Express Request 扩展
export interface AuthedRequest extends Request {
  authType?: "jwt" | "agent"
  user?: {
    id: string
    username: string
    role: "admin" | "user"
  }
}

// 用户类型
export interface User {
  id: string
  username: string
  password_hash: string
  role: "admin" | "user"
  disabled: number
  created_at: string
}

export interface UserPublic {
  id: string
  username: string
  role: "admin" | "user"
  disabled: number
  created_at: string
}

// AI 配置类型
export interface AIConfig {
  articleProvider?: string
  articleApiKey?: string
  articleBaseUrl?: string
  articleModel?: string
  maasApiKey?: string
  maasBaseUrl?: string
  maasUserEmail?: string
  maasModel?: string
  coverProvider?: string
  coverApiKey?: string
  stabilityApiKey?: string
  stabilityBaseUrl?: string
  siliconflowApiKey?: string
  siliconflowBaseUrl?: string
  siliconflowModel?: string
  imgurClientId?: string
  embeddingApiKey?: string
  embeddingBaseUrl?: string
  embeddingModel?: string
  embeddingDimensions?: number
  embeddingInstruction?: string
  embeddingExtraHeaders?: string | Record<string, string>
  embeddingBatchSize?: number
  embeddingBatchDelayMs?: number
  localEmbeddingModel?: string
  [key: string]: unknown
}

// 封面缓存
export interface CoverCache {
  imageUrl: string
  metadata: Record<string, unknown>
  cachedAt: string
}

// 封面历史
export interface CoverHistoryItem {
  id: string
  title: string
  style: string
  color: string
  provider: string
  imageUrl: string
  cacheKey: string
  createdAt: string
}

// 图片库
export interface ImageItem {
  id: string
  title: string
  category: string
  tags: string[]
  provider: string
  imageUrl: string
  createdAt: string
  updatedAt: string
}

// 发布历史
export interface PublishItem {
  id: string
  title: string
  content: string
  coverImage: string
  status: string
  createdAt: string
}

// 分析结果
export interface AnalysisResult {
  id?: number
  articleId: string
  createdAt: string
  scores: Record<string, number>
  strengths: string[]
  issues: unknown[]
  styleMatch: Record<string, unknown>
  topSuggestion: string
  ragCount: number
}

// CSS 模板
export interface StyleTemplate {
  id: string
  name: string
  desc?: string
  accentColor?: string
  css: string
  isBuiltin: boolean
  createdAt: number
  updatedAt: number
}

// 提示词
export interface Prompt {
  id: string
  name: string
  category: string
  description: string
  content: string
  version: number
  tags: string[]
  isBuiltin: boolean
  usageCount: number
  replacesId: string | null
  createdAt: string
  updatedAt: string
}

// Prompt 版本
export interface PromptVersion {
  id: string
  promptId: string
  version: number
  content: string
  changeNote: string | null
  createdAt: string
}

// Token 使用记录
export interface TokenUsageRecord {
  articleId?: string
  userId?: string
  operation: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

// Cron 任务
export interface CronJob {
  id: string
  userId: string
  name: string
  cronExpr: string
  enabled: boolean
  topic: string | null
  stylePrompt: string | null
  coverPrompt: string | null
  aiConfig: Record<string, unknown>
  wxAppId: string | null
  wxAppSecret: string | null
  lastRunAt: string | null
  nextRunAt: string | null
  runCount: number
  createdAt: string
  updatedAt: string
  enableMaterialsCollection?: boolean
  bingApiKey?: string
  jinaApiKey?: string
}

// Cron 执行日志
export interface CronLog {
  id: number
  jobId: string
  userId: string
  status: "running" | "success" | "error"
  topic: string | null
  articleTitle: string | null
  articleId: string | null
  mediaId: string | null
  steps: CronStep[]
  errorMsg: string | null
  startedAt: string
  finishedAt: string | null
}

export interface CronStep {
  step: string
  status: string
  msg: string
  time: string
  [key: string]: unknown
}

// 文章评分
export interface ArticleScore {
  id: number
  userId: string
  articleId: string
  title: string
  platform: "wechat" | "toutiao"
  views: number | null
  shares: number | null
  likes: number | null
  comments: number | null
  composite: number | null
  note: string | null
  scoredAt: string
  createdAt: string
}

// RAG 相关
export interface RAGDocument {
  content: string
  metadata: {
    source: string
    dir: string
    type: "article" | "task" | "materials" | "task_sub"
  }
}

export interface SearchResult {
  content: string
  source: string
  type: string
  dir: string
  score: number
  sim?: number
  kwScore?: number
  finalScore?: number
}

// 搜索相关
export interface SearchPlan {
  search_queries: string[]
  crawl_targets: CrawlTarget[]
  clean_scripts: string[]
  max_results: number
  priority: "timeliness" | "authority" | "diversity"
}

export interface CrawlTarget {
  url: string
  reason: string
  extract_hint: string
}

export interface SearchItem {
  title: string
  snippet: string
  url: string
  source: string
  datePublished: string | null
  extracted_data?: string[]
  content?: string
}

export interface CrawlResult {
  url: string
  reason: string
  extract_hint: string
  content: string
  ok: boolean
  error?: string
}

export interface MaterialsDataset {
  topic: string
  generatedAt: string
  plan: SearchPlan
  searchResults: SearchItem[]
  crawledContents: CrawlResult[]
  summary: {
    totalItems: number
    searchQueries: number
    crawledUrls: number
  }
}

// 性能监控
export interface PerformanceMetric {
  timestamp: string
  endpoint: string
  method: string
  path: string
  statusCode: number
  duration: number
  memory: number
  userId: string
}

export interface EndpointMetric {
  count: number
  totalDuration: number
  avgDuration: number
  minDuration: number
  maxDuration: number
  errors: number
}

export interface PerformanceSummary {
  totalRequests: number
  recentRequests: number
  recentErrors: number
  avgDuration: string
  errorRate: string
  timestamp: string
}

// DB 行类型映射
export interface DbUserRow {
  id: string
  username: string
  password_hash: string
  role: string
  disabled: number
  created_at: string
}

export interface DbCoverCacheRow {
  image_url: string
  metadata: string
  cached_at: string
}

export interface DbCoverHistoryRow {
  id: string
  user_id?: string
  title: string
  style: string
  color: string
  provider: string
  image_url: string
  cache_key: string
  created_at: string
}

export interface DbImageRow {
  id: string
  user_id?: string
  title: string
  category: string
  tags: string
  provider: string
  image_url: string
  created_at: string
  updated_at: string
}

export interface DbPublishRow {
  id: string
  title: string
  content: string | null
  cover_image: string | null
  status: string
  created_at: string
}

export interface DbAnalysisRow {
  id: number
  user_id?: string
  article_id: string
  created_at: string
  scores: string
  strengths: string
  issues: string
  style_match: string
  top_suggestion: string | null
  rag_count: number
}

export interface DbTemplateRow {
  id: string
  name: string
  description: string | null
  accent_color: string | null
  css: string
  is_builtin: number
  created_at: number
  updated_at: number
}

export interface DbPromptRow {
  id: string
  name: string
  category: string
  description: string | null
  content: string
  version: number
  tags: string
  is_builtin: number
  usage_count: number
  replaces_id: string | null
  created_at: string
  updated_at: string
}

export interface DbPromptVersionRow {
  id: string
  prompt_id: string
  version: number
  content: string
  change_note: string | null
  created_at: string
}

export interface DbTokenUsageRow {
  id: number
  article_id: string | null
  user_id: string | null
  operation: string
  model: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  created_at: string
}

export interface DbCronJobRow {
  id: string
  user_id: string
  name: string
  cron_expr: string
  enabled: number
  topic: string | null
  style_prompt: string | null
  cover_prompt: string | null
  ai_config: string
  wx_app_id: string | null
  wx_app_secret: string | null
  last_run_at: string | null
  next_run_at: string | null
  run_count: number
  created_at: string
  updated_at: string
}

export interface DbCronLogRow {
  id: number
  job_id: string
  user_id: string
  status: string
  topic: string | null
  article_title: string | null
  article_id: string | null
  media_id: string | null
  steps: string
  error_msg: string | null
  started_at: string
  finished_at: string | null
}

export interface DbArticleScoreRow {
  id: number
  user_id: string
  article_id: string
  title: string
  platform: string
  views: number | null
  shares: number | null
  likes: number | null
  comments: number | null
  composite: number | null
  note: string | null
  scored_at: string
  created_at: string
}
