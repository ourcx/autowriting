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
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(__dirname, '..')

const PORT = process.env.SMOKE_PORT || '3000'
const BASE = `http://127.0.0.1:${PORT}`
const SMOKE_AGENT_API_KEY = 'smoke-agent-api-key'
const SMOKE_DATA_ROOT = mkdtempSync(join(tmpdir(), 'autowriting-smoke-'))
const SMOKE_STATIC_ROOT = join(SMOKE_DATA_ROOT, 'dist')
const SMOKE_INDEX_MARKER = `autowriting-smoke-index-${Date.now()}`

mkdirSync(SMOKE_STATIC_ROOT, { recursive: true })
writeFileSync(
  join(SMOKE_STATIC_ROOT, 'index.html'),
  `<!doctype html><html><body>${SMOKE_INDEX_MARKER}</body></html>`,
)

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
      NODE_ENV: 'production',
      DATA_DIR: join(SMOKE_DATA_ROOT, 'data'),
      DRAFTS_DIR: join(SMOKE_DATA_ROOT, 'drafts'),
      LOG_DIR: join(SMOKE_DATA_ROOT, 'logs'),
      STATIC_DIR: SMOKE_STATIC_ROOT,
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
  rmSync(SMOKE_DATA_ROOT, { recursive: true, force: true })
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
  name: '生产模式首页应返回前端 index.html',
  run: async () => {
    const r = await fetch(`${BASE}/`)
    if (!r.ok) throw new Error(`status=${r.status}`)
    const body = await r.text()
    if (!body.includes(SMOKE_INDEX_MARKER)) throw new Error('首页未返回前端构建产物')
  },
})

cases.push({
  name: '生产模式前端路由应回退到 index.html',
  run: async () => {
    const r = await fetch(`${BASE}/articles/example`)
    if (!r.ok) throw new Error(`status=${r.status}`)
    const body = await r.text()
    if (!body.includes(SMOKE_INDEX_MARKER)) throw new Error('SPA 路由未回退到 index.html')
  },
})

cases.push({
  name: '未知 API 应返回 JSON 404，不得回退前端页面',
  run: async () => {
    const r = await fetch(`${BASE}/api/does-not-exist`)
    if (r.status !== 404) throw new Error(`期望 404，实际 ${r.status}`)
    const contentType = r.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) throw new Error(`响应不是 JSON: ${contentType}`)
    const body = await r.json()
    if (body.error !== '接口不存在') throw new Error(`错误信息不正确：${JSON.stringify(body)}`)
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
  name: '未授权生成视觉画布应被拒（401/403）',
  run: async () => {
    const r = await fetch(`${BASE}/api/canvas/generate/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '测试画布' }),
    })
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
let smokeUserId = null
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
    smokeUserId = j.user?.id
    if (!token) throw new Error('响应中没有 token')
    if (!smokeUserId) throw new Error('响应中没有用户 ID')
  },
})
cases.push({
  name: '画布生成接口应校验 prompt',
  run: async () => {
    const r = await fetch(`${BASE}/api/canvas/generate/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ prompt: '' }),
    })
    if (r.status !== 400) throw new Error(`期望 400，实际 ${r.status}`)
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
  name: '已有公众号正文不得被空内容覆盖',
  run: async () => {
    const articleId = `20260805-protect-content-${Date.now()}`
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
    const original = '# 不能丢失的公众号正文\n\n这是一段必须被保护的内容。'
    const createResponse = await fetch(`${BASE}/api/articles/${articleId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ article: original, title: '正文保护测试' }),
    })
    if (!createResponse.ok) throw new Error(`创建失败 status=${createResponse.status}`)

    const clearResponse = await fetch(`${BASE}/api/articles/${articleId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ article: '' }),
    })
    if (clearResponse.status !== 409) {
      throw new Error(`空覆盖应返回 409，实际 ${clearResponse.status}`)
    }

    const readResponse = await fetch(`${BASE}/api/articles/${articleId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const article = await readResponse.json()
    if (article.article !== original) throw new Error('空覆盖后原正文未被保留')

    const updated = `${original}\n\n新增内容。`
    const updateResponse = await fetch(`${BASE}/api/articles/${articleId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ article: updated }),
    })
    if (!updateResponse.ok) throw new Error(`正常更新失败 status=${updateResponse.status}`)

    const updatedResponse = await fetch(`${BASE}/api/articles/${articleId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const updatedArticle = await updatedResponse.json()
    if (updatedArticle.article !== updated) throw new Error('正常正文更新未保存')

    const backupDir = join(SMOKE_DATA_ROOT, 'data', 'article-backups', smokeUserId, articleId)
    const backupFiles = readdirSync(backupDir)
    if (backupFiles.length === 0) throw new Error('正常更新前未保存正文备份')
    const backupContents = backupFiles.map((filename) => readFileSync(join(backupDir, filename), 'utf8'))
    if (!backupContents.includes(original)) throw new Error('正文备份内容不正确')

    const deleteResponse = await fetch(`${BASE}/api/articles/${articleId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!deleteResponse.ok) throw new Error(`清理失败 status=${deleteResponse.status}`)
  },
})
cases.push({
  name: '带后缀文章的小红书标题不得覆盖公众号正文',
  run: async () => {
    const articleId = `20260805-带标题后缀-${Date.now()}`
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
    const original = '# 带后缀文章正文\n\n保存空的小红书标题时，这段正文不能消失。'
    const saveResponse = await fetch(`${BASE}/api/articles/${encodeURIComponent(articleId)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        article: original,
        xiaohongshuTitle: '',
        title: '侧车路径保护测试',
      }),
    })
    if (!saveResponse.ok) throw new Error(`保存失败 status=${saveResponse.status}`)

    const readResponse = await fetch(`${BASE}/api/articles/${encodeURIComponent(articleId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!readResponse.ok) throw new Error(`读取失败 status=${readResponse.status}`)
    const article = await readResponse.json()
    if (article.article !== original) throw new Error('小红书标题覆盖了公众号正文')
    if (article.xiaohongshuTitle !== '') throw new Error('小红书标题读取结果不正确')

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
