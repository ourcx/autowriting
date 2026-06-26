/* ============================================================
 * apiHelpers.ts — 前端 API 请求公共工具函数
 * ============================================================ */

import axios, { AxiosError } from 'axios'
import { AIConfig } from './aiConfig'

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
  return res.data as { task: string; materials: string; article: string; title: string; articleToutiao: string }
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

// ── 删除文章 ──
export async function deleteArticle(articleId: string): Promise<void> {
  await axios.delete(`/api/articles/${articleId}`)
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
