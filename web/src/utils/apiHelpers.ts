/* ============================================================
 * apiHelpers.ts — 前端 API 请求公共工具函数
 * ============================================================ */

import axios, { AxiosError } from 'axios'
import { AIConfig } from './aiConfig'
import { CanvasDocument, parseCanvasDocument } from '../../shared/canvasDsl'

export interface WechatAccount {
  nickname: string
  headimgurl: string | null
  fans_count: number | null
  fans_limited: boolean
  account_type: 'service' | 'subscription'
  verify_type: number
  principal: string | null
  limited: boolean
}

export interface ToutiaoAccount {
  nickname: string
  avatar_url: string | null
  description: string | null
  followers_count: number | null
  total_reads: number | null
  total_income: number | null
  data_note: string | null
  cached: boolean
  cached_at: string
}

export interface XiaohongshuPublishRecord {
  id: string
  title: string
  content: string
  contentType: "image_note" | "article"
  imageCount: number
  status: "publishing" | "published" | "failed"
  noteUrl: string | null
  errorMessage: string | null
  createdAt: string
  publishedAt: string | null
}

// ── 从 axios/fetch 错误中提取可读的错误信息 ──
export function extractErrorMessage(err: unknown, fallback = '请求失败，请稍后重试'): string {
  if (err instanceof AxiosError) {
    return err.response?.data?.error
      || err.response?.data?.message
      || err.message
      || fallback
  }
  if (err instanceof Error) return err.message
  return fallback
}

// ── 判断用户本地配置是否已填写 API Key ──
export function isLocalApiKeyConfigured(cfg: AIConfig): boolean {
  if (cfg.articleProvider === 'maas') return !!cfg.maasApiKey
  return !!cfg.articleApiKey
}

// ── 判断本地封面 Key 是否已配置 ──
export function isLocalCoverKeyConfigured(cfg: AIConfig): boolean {
  if (cfg.coverProvider === 'local') return true
  return !!cfg.coverApiKey
}

// ── 保存文章到后端 ──
export async function saveArticle(articleId: string, data: {
  task?: string
  materials?: string
  article?: string
  title?: string
  articleToutiao?: string
  xiaohongshuTitle?: string
}): Promise<void> {
  await axios.post(`/api/articles/${articleId}`, data)
}

// ── 生成文章 ──
export async function generateArticle(
  articleId: string,
  task: string,
  materials: string,
  aiConfig: AIConfig,
): Promise<string> {
  const res = await axios.post(`/api/articles/${articleId}/generate`, {
    task,
    materials,
    aiConfig,
  })
  return res.data.article as string
}

// ── 获取单篇文章 ──
export async function fetchArticle(articleId: string) {
  const res = await axios.get(`/api/articles/${articleId}`)
  return res.data as {
    task: string
    materials: string
    article: string
    title: string
    articleToutiao: string
    xiaohongshuTitle: string
  }
}

// ── 获取文章列表 ──
export async function fetchArticleList() {
  const res = await axios.get('/api/articles')
  return res.data as Array<{
    id: string
    date: string
    title: string
    status: 'draft' | 'generated' | 'published'
    createdAt: string
  }>
}

export async function generateCanvasDocument(
  prompt: string,
  document: CanvasDocument,
  aiConfig: AIConfig,
  onProgress?: (message: string) => void,
): Promise<CanvasDocument> {
  const token = localStorage.getItem('auth_token')
  const response = await fetch('/api/canvas/generate/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ prompt, document, aiConfig }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(error.error || `HTTP ${response.status}`)
  }
  if (!response.body) throw new Error('浏览器不支持流式响应')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: CanvasDocument | null = null

  const consumeBlock = (block: string) => {
    const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim()
    const dataText = block.match(/^data:\s*(.+)$/m)?.[1]?.trim()
    if (!event || !dataText) return
    const data = JSON.parse(dataText) as { message?: string; document?: unknown }
    if (event === 'progress' && data.message) onProgress?.(data.message)
    if (event === 'heartbeat') onProgress?.('AI 正在编排画布...')
    if (event === 'error') throw new Error(data.message || 'AI 画布生成失败')
    if (event === 'result') result = parseCanvasDocument(data.document)
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      consumeBlock(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
    }
    if (done) break
  }
  if (buffer.trim()) consumeBlock(buffer)
  if (!result) throw new Error('画布生成结束，但没有收到有效结果')
  return result
}

// ── 删除文章 ──
export async function deleteArticle(articleId: string): Promise<void> {
  await axios.delete(`/api/articles/${articleId}`)
}

export async function fetchWechatAccount(headers: Record<string, string>): Promise<WechatAccount> {
  const response = await axios.get('/api/wechat/account', { headers })
  return response.data as WechatAccount
}

export async function fetchToutiaoAccount(cookies: string, forceRefresh = false): Promise<ToutiaoAccount> {
  const response = await axios.post('/api/toutiao/account', { cookies, force_refresh: forceRefresh })
  return response.data as ToutiaoAccount
}

export async function publishXiaohongshuNote(input: {
  cookies: string
  contentType: "image_note" | "article"
  title: string
  content: string
  imageUrls: string[]
  articleOptions?: {
    summary: string
    templateName: string
    coverType: "with_image" | "without_image"
    showAuthor: boolean
    showReadingTime: boolean
    showSummary: boolean
    finalTitle: string
    topics: string[]
    original: boolean
  }
}): Promise<{ success: boolean; recordId: string; noteUrl: string | null }> {
  const response = await axios.post("/api/xiaohongshu/publish", input)
  return response.data as { success: boolean; recordId: string; noteUrl: string | null }
}

export async function generateXiaohongshuArticleMetadata(input: {
  title: string
  content: string
  aiConfig: AIConfig
}): Promise<{ title: string; summary: string; topics: string[] }> {
  const response = await axios.post("/api/xiaohongshu/article-metadata", input)
  return response.data as { title: string; summary: string; topics: string[] }
}

export async function fetchXiaohongshuPublishRecords(): Promise<XiaohongshuPublishRecord[]> {
  const response = await axios.get("/api/xiaohongshu/records")
  return (response.data as { records: XiaohongshuPublishRecord[] }).records
}

export async function uploadLocalImage(file: File): Promise<{
  id: string
  url: string
  originalName: string
}> {
  const formData = new FormData()
  formData.append("image", file)
  const response = await axios.post("/api/images/upload", formData)
  return response.data as { id: string; url: string; originalName: string }
}

// ── 通用 JSON 请求（给 fetch 场景收口错误处理） ──
export async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = (data as any)?.error || (data as any)?.message || `HTTP ${response.status}`
    throw new Error(message)
  }
  return data as T
}

// ── 通用 Blob 请求（给文件预览 / 下载场景收口错误处理） ──
export async function fetchBlob(url: string, init?: RequestInit): Promise<Blob> {
  const response = await fetch(url, init)
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const data = await response.json()
      message = data?.error || data?.message || message
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message)
  }
  return response.blob()
}

// ── 连通性测试（发 max_tokens=1 的最小请求） ──
export async function testAIConnection(cfg: AIConfig): Promise<{ ok: boolean; msg: string }> {
  const isMaas = cfg.articleProvider === 'maas'
  const baseUrl = isMaas ? cfg.maasBaseUrl : cfg.articleBaseUrl
  const apiKey  = isMaas ? cfg.maasApiKey  : cfg.articleApiKey
  const model   = isMaas ? 'deepseek-v4-pro' : (cfg.articleModel || 'gpt-4o-mini')

  if (!baseUrl || !apiKey) {
    return { ok: false, msg: '请先填写 API 地址和 Key' }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (isMaas) {
    headers['api-key'] = apiKey
    headers['x-maas-user-email'] = cfg.maasUserEmail
    headers['x-maas-app-id'] = 'qs-api'
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
    })
    if (res.ok) {
      return { ok: true, msg: '连接成功，API Key 有效' }
    }
    const data = await res.json().catch(() => ({}))
    const errMsg = (data as any)?.error?.message || (data as any)?.message || `HTTP ${res.status}`
    return { ok: false, msg: errMsg }
  } catch (e: unknown) {
    return { ok: false, msg: e instanceof Error ? e.message : '网络连接失败，请检查 Base URL' }
  }
}
