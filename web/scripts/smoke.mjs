#!/usr/bin/env node
/**
 * smoke.mjs —— 启动后端 → 跑关键接口 → 验证鉴权 + 路由可用性
 *
 * 适用：改了 API 契约 / 鉴权 / 关键路由后跑一次
 *
 * 退出码：
 *   0 = 全部通过
 *   1 = 有 case 失败
 */

import { spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(__dirname, '..')

const PORT = process.env.SMOKE_PORT || '3000'
const BASE = `http://127.0.0.1:${PORT}`
const SMOKE_AGENT_API_KEY = 'smoke-agent-api-key'

let serverProc = null
let killed = false

function fail(msg) {
  console.error(`❌ [smoke] ${msg}`)
}

async function waitHealthy(timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`)
      if (r.ok) return true
    } catch {
      // 还没起来
    }
    await new Promise((res) => setTimeout(res, 500))
  }
  return false
}

function startServer() {
  console.log(`[smoke] 启动后端 (port ${PORT}) ...`)
  serverProc = spawn('npx', ['tsx', 'server.ts'], {
    cwd: WEB_ROOT,
    env: {
      ...process.env,
      PORT,
      LOG_LEVEL: 'WARN',
      AGENT_API_KEY: SMOKE_AGENT_API_KEY,
      AGENT_USERNAME: 'admin',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProc.stdout.on('data', () => {})
  serverProc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))
  serverProc.on('exit', (code) => {
    if (!killed) fail(`server 异常退出 code=${code}`)
  })
}

function stopServer() {
  if (serverProc && !killed) {
    killed = true
    serverProc.kill('SIGTERM')
  }
}

process.on('SIGINT', stopServer)
process.on('SIGTERM', stopServer)
process.on('exit', stopServer)

const cases = []

cases.push({
  name: 'GET /health 应返回 200',
  run: async () => {
    const r = await fetch(`${BASE}/health`)
    if (!r.ok) throw new Error(`status=${r.status}`)
  },
})

cases.push({
  name: '未授权访问 /api/articles 应被拒（401/403）',
  run: async () => {
    const r = await fetch(`${BASE}/api/articles`)
    if (r.status !== 401 && r.status !== 403) {
      throw new Error(`期望 401/403，实际 ${r.status}`)
    }
  },
})

cases.push({
  name: '未授权访问 /api/admin/users 应被拒（401/403）',
  run: async () => {
    const r = await fetch(`${BASE}/api/admin/users`)
    if (r.status !== 401 && r.status !== 403) {
      throw new Error(`期望 401/403，实际 ${r.status}`)
    }
  },
})
cases.push({
  name: '错误 Agent API Key 应被拒绝',
  run: async () => {
    const r = await fetch(`${BASE}/api/agent/status`, {
      headers: { 'X-Agent-API-Key': 'wrong-key' },
    })
    if (r.status !== 401) throw new Error(`期望 401，实际 ${r.status}`)
  },
})
cases.push({
  name: 'Agent API Key 应可发现能力',
  run: async () => {
    const r = await fetch(`${BASE}/api/agent/status`, {
      headers: { 'X-Agent-API-Key': SMOKE_AGENT_API_KEY },
    })
    if (!r.ok) throw new Error(`status=${r.status}`)
    const data = await r.json()
    if (data.user?.username !== 'admin') throw new Error('Agent 未绑定到 admin 用户')
    if (!Array.isArray(data.capabilities?.articles)) throw new Error('响应中缺少文章能力')
  },
})
cases.push({
  name: 'Agent API Key 不得访问管理员接口',
  run: async () => {
    const r = await fetch(`${BASE}/api/admin/users`, {
      headers: { 'X-Agent-API-Key': SMOKE_AGENT_API_KEY },
    })
    if (r.status !== 403) throw new Error(`期望 403，实际 ${r.status}`)
  },
})
cases.push({
  name: 'Agent API Key 不得访问白名单外接口',
  run: async () => {
    const r = await fetch(`${BASE}/api/settings`, {
      headers: { 'X-Agent-API-Key': SMOKE_AGENT_API_KEY },
    })
    if (r.status !== 403) throw new Error(`期望 403，实际 ${r.status}`)
  },
})
cases.push({
  name: 'Agent API Key 应可写入和读取文章',
  run: async () => {
    const articleId = `20260805-agent-smoke-${Date.now()}`
    const headers = {
      'Content-Type': 'application/json',
      'X-Agent-API-Key': SMOKE_AGENT_API_KEY,
    }
    const saveResponse = await fetch(`${BASE}/api/articles/${articleId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: 'Agent Smoke',
        task: 'Agent 写作任务',
        materials: 'Agent 写作素材',
      }),
    })
    if (!saveResponse.ok) throw new Error(`保存失败 status=${saveResponse.status}`)

    const readResponse = await fetch(`${BASE}/api/articles/${articleId}`, {
      headers: { 'X-Agent-API-Key': SMOKE_AGENT_API_KEY },
    })
    if (!readResponse.ok) throw new Error(`读取失败 status=${readResponse.status}`)
    const article = await readResponse.json()
    if (article.title !== 'Agent Smoke') throw new Error('Agent 读取内容与写入内容不一致')

    const deleteResponse = await fetch(`${BASE}/api/articles/${articleId}`, {
      method: 'DELETE',
      headers: { 'X-Agent-API-Key': SMOKE_AGENT_API_KEY },
    })
    if (!deleteResponse.ok) throw new Error(`清理失败 status=${deleteResponse.status}`)
  },
})
let token = null
const smokeUser = {
  username: `smoke_${Date.now()}`,
  password: 'smoke_pw_8888',
}
cases.push({
  name: '注册新账号',
  run: async () => {
    const r = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(smokeUser),
    })
    if (!r.ok) {
      const t = await r.text()
      throw new Error(`status=${r.status} body=${t.slice(0, 200)}`)
    }
  },
})
cases.push({
  name: '登录拿 token',
  run: async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(smokeUser),
    })
    if (!r.ok) throw new Error(`status=${r.status}`)
    const j = await r.json()
    token = j.token
    if (!token) throw new Error('响应中没有 token')
  },
})
cases.push({
  name: '用 token 访问 /api/articles 应通过',
  run: async () => {
    const r = await fetch(`${BASE}/api/articles`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) throw new Error(`status=${r.status}`)
  },
})
cases.push({
  name: '小红书标题超过 20 字仍应通过长度校验',
  run: async () => {
    const r = await fetch(`${BASE}/api/xiaohongshu/article-metadata`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: '这是一个明确超过二十个汉字但仍应通过标题长度校验的小红书标题',
        content: 'Smoke 正文',
      }),
    })
    if (r.status !== 400) throw new Error(`期望缺少 API Key 的 400，实际 ${r.status}`)
    const body = await r.json()
    if (!String(body.error || '').includes('API Key')) {
      throw new Error(`标题未越过长度校验：${JSON.stringify(body)}`)
    }
  },
})
cases.push({
  name: '小红书异常超长标题应被拒绝',
  run: async () => {
    const r = await fetch(`${BASE}/api/xiaohongshu/article-metadata`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: '长'.repeat(501),
        content: 'Smoke 正文',
      }),
    })
    if (r.status !== 400) throw new Error(`期望 400，实际 ${r.status}`)
    const body = await r.json()
    if (!String(body.error || '').includes('最多 500 个字')) {
      throw new Error(`错误信息不正确：${JSON.stringify(body)}`)
    }
  },
})
cases.push({
  name: '合法中文文章 ID 应可保存和读取',
  run: async () => {
    const articleId = `20260805-smoke-中文标题-${Date.now()}`
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
    const saveResponse = await fetch(`${BASE}/api/articles/${encodeURIComponent(articleId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Smoke 中文标题', task: 'Smoke 测试任务', materials: 'Smoke 测试素材' }),
    })
    if (!saveResponse.ok) throw new Error(`保存失败 status=${saveResponse.status}`)

    const readResponse = await fetch(`${BASE}/api/articles/${encodeURIComponent(articleId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!readResponse.ok) throw new Error(`读取失败 status=${readResponse.status}`)
    const article = await readResponse.json()
    if (article.title !== 'Smoke 中文标题') throw new Error('读取内容与保存内容不一致')

    const deleteResponse = await fetch(`${BASE}/api/articles/${encodeURIComponent(articleId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!deleteResponse.ok) throw new Error(`清理失败 status=${deleteResponse.status}`)
  },
})
cases.push({
  name: '目录逃逸文章 ID 应被拒绝',
  run: async () => {
    const r = await fetch(`${BASE}/api/articles/%2e%2e%2foutside`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (r.status !== 400) throw new Error(`期望 400，实际 ${r.status}`)
  },
})

;(async () => {
  startServer()
  if (!(await waitHealthy())) {
    fail('30s 内 /health 未就绪')
    stopServer()
    process.exit(1)
  }

  let pass = 0
  let failCount = 0
  for (const c of cases) {
    try {
      await c.run()
      console.log(`  ✅ ${c.name}`)
      pass++
    } catch (e) {
      console.error(`  ❌ ${c.name} — ${e.message}`)
      failCount++
    }
  }

  console.log(`\nsmoke: ${pass} pass / ${failCount} fail`)
  stopServer()
  process.exit(failCount === 0 ? 0 : 1)
})()
