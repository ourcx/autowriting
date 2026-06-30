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
  serverProc = spawn('node', ['server.js'], {
    cwd: WEB_ROOT,
    env: { ...process.env, PORT, LOG_LEVEL: 'WARN' },
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
