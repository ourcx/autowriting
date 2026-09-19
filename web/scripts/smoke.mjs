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
import { smokeArticleStream } from './smoke-article-stream.mjs'
import { smokeCandidates } from './smoke-candidates.mjs'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(__dirname, '..')

const PORT = process.env.SMOKE_PORT || '3000'
const BASE = `http://127.0.0.1:${PORT}`
const SMOKE_AGENT_API_KEY = 'smoke-agent-api-key'
const SMOKE_ALLOWED_ORIGIN = 'https://allowed.example.test'
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
      CORS_ALLOWED_ORIGINS: SMOKE_ALLOWED_ORIGIN,
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
    if (r.headers.has('x-powered-by') || r.headers.has('server')) throw new Error('响应泄露了服务端技术栈')
    if (r.headers.get('x-frame-options') !== 'SAMEORIGIN') throw new Error('缺少 SAMEORIGIN 点击劫持保护')
    if (r.headers.get('x-content-type-options') !== 'nosniff') throw new Error('缺少 nosniff')
    if (!r.headers.has('content-security-policy-report-only')) throw new Error('缺少 Report-Only CSP')
    if (!r.headers.get('strict-transport-security')?.includes('max-age=31536000')) throw new Error('缺少 HSTS')
  },
})

cases.push({
  name: 'CORS 白名单只允许明确配置的来源',
  run: async () => {
    const allowed = await fetch(`${BASE}/health`, { headers: { Origin: SMOKE_ALLOWED_ORIGIN } })
    if (allowed.headers.get('access-control-allow-origin') !== SMOKE_ALLOWED_ORIGIN) {
      throw new Error('白名单来源未收到正确的 CORS 响应头')
    }

    const denied = await fetch(`${BASE}/health`, { headers: { Origin: 'https://denied.example.test' } })
    if (denied.status !== 403) throw new Error(`非白名单来源期望 403，实际 ${denied.status}`)
    if (denied.headers.has('access-control-allow-origin')) throw new Error('非白名单来源不应收到 CORS 允许头')
  },
})

cases.push({
  name: '普通 JSON 请求超过 1MB 应返回 413',
  run: async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'oversized', password: 'x'.repeat(1024 * 1024) }),
    })
    if (r.status !== 413) throw new Error(`期望 413，实际 ${r.status}`)
    const body = await r.json()
    if (body.error !== '请求内容过大') throw new Error(`错误信息不正确：${JSON.stringify(body)}`)
  },
})

cases.push({
  name: '文章接口应允许超过 1MB 的正文请求',
  run: async () => {
    const r = await fetch(`${BASE}/api/articles/payload-limit-smoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ article: '文'.repeat(1024 * 1024 + 1) }),
    })
    if (r.status === 413) throw new Error('文章接口仍被普通 1MB 上限拦截')
    if (![401, 403].includes(r.status)) throw new Error(`期望鉴权拒绝，实际 ${r.status}`)
  },
})

cases.push({
  name: '今日头条发布应允许超过 1MB 的正文请求',
  run: async () => {
    const r = await fetch(`${BASE}/api/toutiao/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '头条大正文测试', content: '文'.repeat(1024 * 1024 + 1), cookies: '[]' }),
    })
    if (r.status === 413) throw new Error('今日头条发布仍被普通 1MB 上限拦截')
    if (![401, 403].includes(r.status)) throw new Error(`期望鉴权拒绝，实际 ${r.status}`)
  },
})

cases.push({
  name: '非法 JSON 返回安全的 400 响应',
  run: async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid',
    })
    if (r.status !== 400) throw new Error(`期望 400，实际 ${r.status}`)
    const text = await r.text()
    if (!text.includes('JSON 格式不正确')) throw new Error(`错误信息不正确：${text}`)
    if (/SyntaxError|server\.ts|node_modules/.test(text)) throw new Error('响应泄露了内部错误信息')
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
  name: '未登录不得读取秀米模板',
  run: async () => {
    const r = await fetch(`${BASE}/api/canvas/xiumi-reference`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://v.xiumi.us/board/v5/test/123'})})
    if (![401,403].includes(r.status)) throw new Error(`status=${r.status}`)
  },
})
cases.push({
  name: '未登录不得调用公众号采集',
  run: async () => {
    const r = await fetch(`${BASE}/api/materials/wechat-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'tikhub', query: '测试' }),
    })
    if (![401, 403].includes(r.status)) throw new Error(`status=${r.status}`)
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
    if (r.headers.get('cache-control') !== 'no-store') throw new Error('API 响应缺少 no-store')
    if (r.headers.get('pragma') !== 'no-cache') throw new Error('API 响应缺少 Pragma: no-cache')
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
  name: '历史公共业务路由现在必须登录',
  run: async () => {
    for (const path of ['/api/images', '/api/prompts/list', '/api/templates', '/api/publish/history', '/api/cover-history', '/api/wechat/status']) {
      const r = await fetch(`${BASE}${path}`)
      if (![401, 403].includes(r.status)) throw new Error(`${path} 期望 401/403，实际 ${r.status}`)
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
  name: '未授权生成公众号块排版应被拒（401/403）',
  run: async () => {
    const r = await fetch(`${BASE}/api/canvas/generate-block/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '测试块排版' }),
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
    if (article.workflow?.currentStage !== 'brief') throw new Error('新文章应从任务阶段开始')

    const workflowResponse = await fetch(`${BASE}/api/articles/${articleId}/workflow`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event: 'wechat_draft_opened' }),
    })
    if (!workflowResponse.ok) throw new Error(`记录工作流失败 status=${workflowResponse.status}`)
    const workflow = await workflowResponse.json()
    if (!workflow.wechatDraftOpenedAt) throw new Error('工作流未记录公众号预览时间')

    const pushedResponse = await fetch(`${BASE}/api/articles/${articleId}/workflow`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ event: 'wechat_draft_pushed' }),
    })
    if (!pushedResponse.ok) throw new Error(`记录微信草稿失败 status=${pushedResponse.status}`)
    const pushedWorkflow = await pushedResponse.json()
    if (pushedWorkflow.currentStage !== 'wechat_draft') throw new Error('推送后文章应进入微信草稿阶段')

    const metricsResponse = await fetch(`${BASE}/api/articles/workflow-metrics`, {
      headers: { 'X-Agent-API-Key': SMOKE_AGENT_API_KEY },
    })
    if (!metricsResponse.ok) throw new Error(`读取工作流指标失败 status=${metricsResponse.status}`)
    const metrics = await metricsResponse.json()
    if (metrics.sampleSize < 1 || metrics.medianMinutes === null) throw new Error('工作流指标未纳入完成样本')

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
  name: '认证接口应拒绝额外字段',
  run: async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...smokeUser, unexpected: true }),
    })
    if (r.status !== 400) throw new Error(`期望 400，实际 ${r.status}`)
  },
})
cases.push({
  name: '同一用户名连续登录失败应触发限流',
  run: async () => {
    const username = `missing_${Date.now()}`
    for (let attempt = 1; attempt <= 6; attempt++) {
      const r = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: 'wrong-password' }),
      })
      if (attempt <= 5 && r.status !== 401) throw new Error(`第 ${attempt} 次期望 401，实际 ${r.status}`)
      if (attempt === 6) {
        if (r.status !== 429) throw new Error(`第 6 次期望 429，实际 ${r.status}`)
        if (!r.headers.has('retry-after')) throw new Error('429 响应缺少 Retry-After')
      }
    }
  },
})
cases.push({
  name: '公众号采集应拒绝未知服务商',
  run: async () => {
    const r = await fetch(`${BASE}/api/materials/wechat-search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'unknown', query: '测试' }),
    })
    if (r.status !== 400) throw new Error(`期望 400，实际 ${r.status}`)
  },
})
cases.push({
  name: '自定义搜索服务不得指向内网地址',
  run: async () => {
    const r = await fetch(`${BASE}/api/materials/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', provider: 'searxng', searxngUrl: 'http://127.0.0.1' }),
    })
    if (r.status !== 400) throw new Error(`期望 400，实际 status=${r.status}`)
    const body = await r.json()
    if (!body.error?.includes('不允许访问')) throw new Error(`安全拦截信息不正确：${JSON.stringify(body)}`)
  },
})
cases.push({
  name: '账号写作档案应按当前用户读写',
  run: async () => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const profile = {
      audience: 'Smoke 读者',
      stance: '区分事实与观点',
      tone: '直接',
      bannedPhrases: ['赋能'],
      preferredStructure: '结论先行',
      defaultPlatforms: ['wechat', 'toutiao'],
      visualStyle: '少装饰',
    }
    const saveResponse = await fetch(`${BASE}/api/creator-profile`, {
      method: 'PUT', headers, body: JSON.stringify(profile),
    })
    if (!saveResponse.ok) throw new Error(`保存失败 status=${saveResponse.status}`)
    const readResponse = await fetch(`${BASE}/api/creator-profile`, { headers })
    if (!readResponse.ok) throw new Error(`读取失败 status=${readResponse.status}`)
    const stored = await readResponse.json()
    if (stored.audience !== profile.audience || stored.defaultPlatforms.length !== 2) {
      throw new Error('写作档案读写内容不一致')
    }

    const otherUser = { username: `smoke_profile_other_${Date.now()}`, password: 'smoke_pw_9999' }
    await fetch(`${BASE}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(otherUser),
    })
    const loginResponse = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(otherUser),
    })
    const otherToken = (await loginResponse.json()).token
    const otherProfile = await (await fetch(`${BASE}/api/creator-profile`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    })).json()
    if (otherProfile.audience) throw new Error('写作档案跨用户泄漏')
  },
})
cases.push({
  name: '创作反馈接口应返回可解释统计结构',
  run: async () => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const scoreResponse = await fetch(`${BASE}/api/scores/feedback-smoke`, {
      method: 'POST', headers, body: JSON.stringify({ title: '高表现 Smoke 文章', platform: 'wechat', views: 12000, composite: 88 }),
    })
    if (!scoreResponse.ok) throw new Error(`评分保存失败 status=${scoreResponse.status}`)
    const response = await fetch(`${BASE}/api/articles/production-insights`, {
      headers,
    })
    if (!response.ok) throw new Error(`status=${response.status}`)
    const data = await response.json()
    if (!Array.isArray(data.topArticles) || typeof data.patterns !== 'object' || data.topArticles[0]?.title !== '高表现 Smoke 文章') {
      throw new Error('创作反馈结构不完整')
    }
    await fetch(`${BASE}/api/scores/feedback-smoke/wechat`, { method: 'DELETE', headers })
  },
})
cases.push({
  name: '秀米导入拒绝任意主机与编辑器链接',
  run: async () => {
    for (const url of ['http://127.0.0.1/', 'https://v.xiumi.us.evil.test/board/v5/x/123', 'https://xiumi.us/studio/v5']) {
      const r = await fetch(`${BASE}/api/canvas/xiumi-reference`, {method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({url})})
      if (r.status !== 400) throw new Error(`status=${r.status}`)
    }
  },
})
cases.push({
  name: '画布生成接口应要求文章内容源',
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
  name: 'RAG 候选接口应接受任务与素材组合查询',
  run: async () => {
    const r = await fetch(`${BASE}/api/rag/candidates`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: '固定写作模板',
        materials: '本篇文章独有的主题素材',
        topK: 8,
      }),
    })
    if (!r.ok) throw new Error(`status=${r.status}`)
    const body = await r.json()
    if (!Array.isArray(body.candidates)) throw new Error('响应中缺少 candidates 数组')
  },
})
cases.push({
  name: '小红书发布必须登录，缺少平台 Cookie 时不创建发布记录',
  run: async () => {
    const anonymous = await fetch(`${BASE}/api/xiaohongshu/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: 'article', title: 'smoke', content: 'smoke' }),
    })
    if (anonymous.status !== 401) throw new Error(`未登录期望 401，实际 ${anonymous.status}`)
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const before = await (await fetch(`${BASE}/api/xiaohongshu/records`, { headers })).json()
    const missingCookie = await fetch(`${BASE}/api/xiaohongshu/publish`, {
      method: 'POST', headers,
      body: JSON.stringify({ contentType: 'article', title: 'smoke', content: 'smoke' }),
    })
    const body = await missingCookie.json()
    if (missingCookie.status !== 401 || !String(body.error).includes('Cookie')) {
      throw new Error(`平台凭据错误响应不正确：${JSON.stringify(body)}`)
    }
    const after = await (await fetch(`${BASE}/api/xiaohongshu/records`, { headers })).json()
    if (!Array.isArray(after.records) || JSON.stringify(before.records) !== JSON.stringify(after.records)) {
      throw new Error('校验失败的请求不应创建发布记录')
    }
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

cases.push({
  name: '普通文章双平台生成在模型静默期间应持续保活并保存完整正文',
  run: () => smokeArticleStream(BASE, token),
})
cases.push({
  name: '候选稿并发上限、断点续写、原文保护与用户隔离',
  run: () => smokeCandidates(BASE, token),
})
cases.push({
  name: '修改密码后原 Token 应立即失效',
  run: async () => {
    const newPassword = 'smoke_pw_changed_9999'
    const changeResponse = await fetch(`${BASE}/api/auth/change-password`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: smokeUser.password, newPassword }),
    })
    if (!changeResponse.ok) throw new Error(`修改密码失败 status=${changeResponse.status}`)

    const staleResponse = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
    if (staleResponse.status !== 401) throw new Error(`修改密码后旧 Token 期望 401，实际 ${staleResponse.status}`)

    const loginResponse = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: smokeUser.username, password: newPassword }),
    })
    if (!loginResponse.ok) throw new Error(`新密码登录失败 status=${loginResponse.status}`)
    token = (await loginResponse.json()).token
  },
})
cases.push({
  name: '登出后原 Token 应立即失效',
  run: async () => {
    const logoutResponse = await fetch(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!logoutResponse.ok) throw new Error(`登出失败 status=${logoutResponse.status}`)

    const meResponse = await fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (meResponse.status !== 401) throw new Error(`登出后期望 401，实际 ${meResponse.status}`)
  },
})
cases.push({
  name: '高成本写接口应使用独立限流',
  run: async () => {
    let limited = false
    for (let attempt = 1; attempt <= 31; attempt++) {
      const r = await fetch(`${BASE}/api/generate-cover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'rate-limit-smoke' }),
      })
      if (r.status === 429) {
        if (!r.headers.has('retry-after')) throw new Error('高成本接口 429 响应缺少 Retry-After')
        limited = true
        break
      }
      if (r.status !== 401) throw new Error(`限流前期望 401，实际 ${r.status}`)
    }
    if (!limited) throw new Error('31 次请求内未触发高成本接口限流')
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
