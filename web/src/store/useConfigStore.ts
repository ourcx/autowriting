/* ============================================================
 * useConfigStore.ts — AI 配置全局状态管理
 * 不依赖 Zustand，使用 useSyncExternalStore 实现轻量 store
 * ============================================================ */

import { useSyncExternalStore } from 'react'
import { loadAIConfig, saveAIConfig, AIConfig } from '../utils/aiConfig'

// ── 服务端配置状态（从 /api/config/status 拉取）──
export interface ServerConfigStatus {
  articleProvider: 'maas' | 'openai' | 'openai-compat' | null
  articleReady: boolean
  maasReady: boolean
  maasEmail: string | null
  openaiReady: boolean
  coverProvider: 'local' | 'openai' | 'stability'
  coverReady: boolean
  dalleReady: boolean
  stabilityReady: boolean
}

// ── Store 状态 ──
interface ConfigState {
  /** 用户在浏览器本地保存的 AI 配置 */
  localConfig: AIConfig
  /** 服务端环境变量配置状态（只含是否已配置，不含 Key 明文） */
  serverStatus: ServerConfigStatus | null
  /** 服务端状态是否正在加载 */
  serverStatusLoading: boolean
}

// ── 内部状态 ──
let state: ConfigState = {
  localConfig: loadAIConfig(),
  serverStatus: null,
  serverStatusLoading: false,
}

// ── 订阅者列表 ──
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach(fn => fn())
}

// ── 更新本地配置 ──
export function updateLocalConfig(patch: Partial<AIConfig>) {
  const next = { ...state.localConfig, ...patch }
  saveAIConfig(next)
  state = { ...state, localConfig: next }
  notify()
}

// ── 覆盖本地配置（整体替换） ──
export function setLocalConfig(cfg: AIConfig) {
  saveAIConfig(cfg)
  state = { ...state, localConfig: cfg }
  notify()
}

// ── 从服务端拉取配置状态 ──
export async function fetchServerStatus() {
  if (state.serverStatusLoading) return
  state = { ...state, serverStatusLoading: true }
  notify()
  try {
    const res = await fetch('/api/config/status')
    if (res.ok) {
      const data: ServerConfigStatus = await res.json()
      state = { ...state, serverStatus: data, serverStatusLoading: false }
    } else {
      state = { ...state, serverStatusLoading: false }
    }
  } catch {
    state = { ...state, serverStatusLoading: false }
  }
  notify()
}

// ── 计算「是否可用」——本地配置 OR 服务端已配置任意一种 ──
export function isArticleReady(s: ConfigState): boolean {
  const { localConfig, serverStatus } = s
  // 本地有 Key
  const localReady = localConfig.articleProvider === 'maas'
    ? !!localConfig.maasApiKey
    : !!localConfig.articleApiKey
  if (localReady) return true
  // 服务端已配置
  return serverStatus?.articleReady ?? false
}

export function isCoverReady(s: ConfigState): boolean {
  const { localConfig, serverStatus } = s
  if (localConfig.coverProvider === 'local') return true
  const localReady = !!localConfig.coverApiKey
  if (localReady) return true
  return serverStatus?.coverReady ?? false
}

// ── store 订阅函数（供 useSyncExternalStore 使用） ──
function subscribe(listener: () => void) {
  listeners.add(listener)
  // 同时监听 settings 页保存事件
  const onUpdate = () => {
    state = { ...state, localConfig: loadAIConfig() }
    notify()
  }
  window.addEventListener('ai-config-updated', onUpdate)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('ai-config-updated', onUpdate)
  }
}

function getSnapshot(): ConfigState {
  return state
}

// ── React Hook ──
export function useConfigStore() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// ── 便捷 hook：直接返回常用派生值 ──
export function useAIReadiness() {
  const s = useConfigStore()
  return {
    localConfig: s.localConfig,
    serverStatus: s.serverStatus,
    serverStatusLoading: s.serverStatusLoading,
    articleReady: isArticleReady(s),
    coverReady: isCoverReady(s),
  }
}
