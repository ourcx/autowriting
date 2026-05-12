/* ============================================================
 * useAuth.ts — 用户认证全局状态管理
 * 存储 JWT token 到 localStorage，提供 login/logout/user/isAdmin
 * ============================================================ */

import { useSyncExternalStore } from 'react'
import axios from 'axios'

export interface AuthUser {
  id: string
  username: string
  role: 'admin' | 'user'
  disabled?: boolean
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  /** 首次初始化（从 localStorage 恢复并验证 token）是否完成 */
  initialized: boolean
}

const TOKEN_KEY = 'auth_token'

// ── 内部状态 ──
let state: AuthState = {
  token: null,
  user: null,
  initialized: false,
}

const listeners = new Set<() => void>()

function notify() {
  listeners.forEach(fn => fn())
}

function setState(patch: Partial<AuthState>) {
  state = { ...state, ...patch }
  notify()
}

// ── Axios 请求拦截器：自动注入 Authorization header ──
axios.interceptors.request.use(config => {
  const token = state.token || localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers = config.headers ?? {}
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// ── Axios 响应拦截器：401 时自动登出 ──
axios.interceptors.response.use(
  res => res,
  err => {
    if (err?.response?.status === 401 && state.token) {
      logout()
    }
    return Promise.reject(err)
  }
)

// ── 登录（拿到 token 后存 state + localStorage） ──
export async function login(username: string, password: string): Promise<void> {
  const res = await axios.post('/api/auth/login', { username, password })
  const { token, user } = res.data as { token: string; user: AuthUser }
  localStorage.setItem(TOKEN_KEY, token)
  setState({ token, user })
}

// ── 注册 ──
export async function register(username: string, password: string): Promise<void> {
  const res = await axios.post('/api/auth/register', { username, password })
  const { token, user } = res.data as { token: string; user: AuthUser }
  localStorage.setItem(TOKEN_KEY, token)
  setState({ token, user })
}

// ── 登出 ──
export function logout() {
  localStorage.removeItem(TOKEN_KEY)
  setState({ token: null, user: null })
}

// ── 应用启动时从 localStorage 恢复 token，并验证有效性 ──
export async function initAuth(): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY)
  if (!token) {
    setState({ initialized: true })
    return
  }
  // 先预填 token，让拦截器能带上
  setState({ token, initialized: false })
  try {
    const res = await axios.get('/api/auth/me')
    // /api/auth/me 返回 { user: AuthUser }
    const user = (res.data.user ?? res.data) as AuthUser
    setState({ user, initialized: true })
  } catch {
    // token 无效，清除
    localStorage.removeItem(TOKEN_KEY)
    setState({ token: null, user: null, initialized: true })
  }
}

// ── useSyncExternalStore 接口 ──
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): AuthState {
  return state
}

// ── React Hook ──
export function useAuth() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    token: s.token,
    user: s.user,
    initialized: s.initialized,
    isLoggedIn: !!s.token && !!s.user,
    isAdmin: s.user?.role === 'admin',
  }
}
