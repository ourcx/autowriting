import axios from 'axios'
import type { AIConfig } from '../types.ts'
import { resolveZhipuApiKey } from './providerKeys.ts'

export interface ZhipuKnowledgeResult {
  content: string
  source: string
  type: 'zhipu_knowledge'
  dir: string
  score: number
  sim: number
  kwScore: number
  finalScore: number
}

export function normalizeKnowledgeIds(value: AIConfig['zhipuKnowledgeIds']): string[] {
  const entries = Array.isArray(value) ? value : String(value || '').split(/[\s,，]+/)
  return [...new Set(entries.map(item => item.trim()).filter(Boolean))].slice(0, 20)
}

interface ZhipuKnowledgeRow {
  text?: string
  score?: number
  metadata?: {
    knowledge_id?: string
    doc_id?: string
    doc_name?: string
    doc_url?: string
    contextual_text?: string
  }
}

export function mapZhipuKnowledgeRows(rows: ZhipuKnowledgeRow[]): ZhipuKnowledgeResult[] {
  return rows.map((row) => {
    const score = Number(row.score || 0)
    const metadata = row.metadata || {}
    return {
      // 开启上下文增强后优先使用平台返回的 contextual_text，避免只注入孤立切片。
      content: String(metadata.contextual_text || row.text || ''),
      source: metadata.doc_url || metadata.doc_name || metadata.doc_id || '智谱云知识库',
      type: 'zhipu_knowledge' as const,
      dir: metadata.knowledge_id || 'zhipu-cloud',
      score: parseFloat((1 - score).toFixed(4)),
      sim: parseFloat((score * 100).toFixed(1)),
      kwScore: 0,
      finalScore: parseFloat((score * 100).toFixed(1)),
    }
  }).filter((row) => row.content.trim())
}

export function hasZhipuKnowledge(config: AIConfig): boolean {
  return config.zhipuKnowledgeMode !== 'off'
    && normalizeKnowledgeIds(config.zhipuKnowledgeIds).length > 0
    && Boolean(resolveZhipuApiKey(config))
}

export async function retrieveZhipuKnowledge(
  query: string,
  config: AIConfig,
  topK = 6,
): Promise<ZhipuKnowledgeResult[]> {
  const apiKey = resolveZhipuApiKey(config)
  const knowledgeIds = normalizeKnowledgeIds(config.zhipuKnowledgeIds)
  if (!apiKey || knowledgeIds.length === 0) return []

  const response = await axios.post(
    'https://open.bigmodel.cn/api/llm-application/open/knowledge/retrieve',
    {
      query: query.slice(0, 1000),
      knowledge_ids: knowledgeIds,
      top_k: Math.min(Math.max(topK, 1), 20),
      top_n: Math.min(Math.max(topK * 3, 10), 100),
      recall_method: config.zhipuKnowledgeRecallMethod || 'mixed',
      recall_ratio: 80,
      rerank_status: config.zhipuKnowledgeRerank === false ? 0 : 1,
      ...(config.zhipuKnowledgeRerank === false ? {} : { rerank_model: 'rerank' }),
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    },
  )

  const rows = Array.isArray(response.data?.data) ? response.data.data : []
  return mapZhipuKnowledgeRows(rows)
}
