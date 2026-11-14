import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import express from 'express'
import jwt from 'jsonwebtoken'
import { createDeepSeekClient } from '../server/utils/deepseek.ts'

const root = mkdtempSync(path.join(tmpdir(), 'autowriting-deepseek-test-'))
process.env.DATA_DIR = path.join(root, 'data')
process.env.LOG_DIR = path.join(root, 'logs')
process.env.DRAFTS_DIR = path.join(root, 'drafts')
process.env.LEGACY_DATA_DIR = ''
process.env.JWT_SECRET = 'deepseek-test-local-only'
const { createDeepSeekRouter } = await import('../server/routes/deepseek.ts')
const { default: settingsRouter } = await import('../server/routes/settings.ts')
const { db, migrateBrowserOnlyAIKeys, createCronJob, createUser, findUserByUsername, getSetting, setSetting } = await import('../server/db.ts')
const user = findUserByUsername('admin')!
const token = jwt.sign({ id: user.id, tokenVersion: 0 }, process.env.JWT_SECRET)
const authHeaders = { Authorization: `Bearer ${token}` }
const keyHeaders = { ...authHeaders, 'x-deepseek-api-key': 'test-placeholder' }
const headers = { ...keyHeaders, 'Content-Type': 'application/json' }
let calls = 0
let toolResult: unknown = { results: [{ title: 'Fixture', url: 'https://example.com', snippet: 'Mock result' }] }
const config = { enabled: true, apiKey: 'test-placeholder' }
let upstreamAuthorization = ''
const clientFactory = (effective: typeof config) => createDeepSeekClient(effective, async (input, init) => {
  calls++
  upstreamAuthorization = new Headers(init?.headers).get('Authorization') || ''
  if (String(input).endsWith('/tts')) return new Response('RIFFxxxxWAVE', { headers: { 'content-type': 'audio/wav' } })
  const result = String(input).endsWith('/files') ? { id: 'file-api-current-request' } : toolResult
  return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } })
})
const app = express()
app.use(express.json())
app.use('/api/settings', settingsRouter)
app.use('/api/deepseek', createDeepSeekRouter(clientFactory))
app.use('/disabled', createDeepSeekRouter(clientFactory))
let releaseCall: () => void = () => {}
let markStarted: () => void = () => {}
const started = new Promise<void>(resolve => { markStarted = resolve })
const held = new Promise<void>(resolve => { releaseCall = resolve })
const heldClient = createDeepSeekClient(config, async () => {
  markStarted(); await held
  return new Response(JSON.stringify({ results: [] }), { headers: { 'content-type': 'application/json' } })
})
app.use('/concurrency', createDeepSeekRouter(() => heldClient))
const server = app.listen(0, '127.0.0.1')
await new Promise<void>(resolve => server.once('listening', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const base = `http://127.0.0.1:${address.port}`
async function post(endpoint: string, body: unknown, requestHeaders: HeadersInit = headers) {
  return fetch(`${base}${endpoint}`, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) })
}
try {
  for (const endpoint of ['status', 'chat', 'search', 'fetch', 'ocr', 'asr', 'tts']) {
    const response = await fetch(`${base}/api/deepseek/${endpoint}`, { method: endpoint === 'status' ? 'GET' : 'POST' })
    assert.equal(response.status, 401, endpoint)
  }
  assert.equal(calls, 0)
  const disabled = await post('/disabled/search', { query: 'test', confirmedCost: true }, { ...authHeaders, 'Content-Type': 'application/json' })
  assert.equal(disabled.status, 503)
  const status = await fetch(`${base}/api/deepseek/status`, { headers })
  assert.deepEqual(await status.json(), { enabled: true, configured: true })
  assert.equal(status.headers.get('cache-control'), 'private, no-store')
  assert.equal((await post('/api/deepseek/search', { query: 'test' })).status, 400)
  assert.equal((await post('/api/deepseek/search', { query: 'test', confirmedCost: true, apiKey: 'bad' })).status, 400)
  assert.equal((await post('/api/deepseek/chat', { prompt: 'test', confirmedCost: true, file_id: 'file-other-user' })).status, 400)
  assert.equal(calls, 0, 'Invalid/unauthorized requests must not call paid APIs')
  const search = await post('/api/deepseek/search', { query: 'test', confirmedCost: true })
  assert.equal(search.status, 200)
  assert.equal(calls, 1)
  toolResult = { choices: [{ finish_reason: 'content_filter', message: { content: 'never publish this' } }] }
  const filtered = await post('/api/deepseek/chat', { prompt: 'test', confirmedCost: true })
  assert.equal(filtered.status, 422)
  assert.ok(!(await filtered.text()).includes('never publish'))
  const upload = new FormData()
  upload.append('confirmedCost', 'true')
  upload.append('file', new Blob(['not audio']), 'bad.webm')
  assert.equal((await fetch(`${base}/api/deepseek/asr`, { method: 'POST', headers: keyHeaders, body: upload })).status, 400)
  const missing = new FormData()
  missing.append('confirmedCost', 'true')
  assert.equal((await fetch(`${base}/api/deepseek/ocr`, { method: 'POST', headers: keyHeaders, body: missing })).status, 400)
  assert.equal(calls, 2)
  const wav = Buffer.alloc(44 + 320)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(320, 40)
  const validAudio = new FormData()
  validAudio.append('confirmedCost', 'true'); validAudio.append('file', new Blob([wav]), 'valid.wav')
  toolResult = { text: 'mock transcription' }
  const transcribed = await fetch(`${base}/api/deepseek/asr`, { method: 'POST', headers: keyHeaders, body: validAudio })
  assert.equal(transcribed.status, 200)
  assert.deepEqual(await transcribed.json(), { text: 'mock transcription' })
  const validDocument = new FormData()
  validDocument.append('confirmedCost', 'true'); validDocument.append('purpose', 'text_recognition')
  validDocument.append('file', new Blob(['%PDF-1.0']), 'document.pdf')
  toolResult = { pages: [{ text: 'mock OCR', finish_reason: 'stop' }] }
  assert.equal((await fetch(`${base}/api/deepseek/ocr`, { method: 'POST', headers: keyHeaders, body: validDocument })).status, 200)
  validDocument.append('prompt', 'Summarize'); validDocument.append('thinking', 'true'); validDocument.append('webSearch', 'false'); validDocument.append('readUrl', 'false')
  toolResult = { choices: [{ finish_reason: 'stop', message: { content: 'mock answer' } }] }
  const fileChat = await fetch(`${base}/api/deepseek/chat`, { method: 'POST', headers: keyHeaders, body: validDocument })
  assert.equal(fileChat.status, 200)
  assert.equal((await fileChat.json()).content, 'mock answer')
  const audioResponse = await post('/api/deepseek/tts', { text: '正文', voice: 'tide', confirmedCost: true })
  assert.equal(audioResponse.status, 200)
  assert.ok(audioResponse.headers.get('content-type')?.startsWith('audio/wav'))
  assert.equal(await audioResponse.text(), 'RIFFxxxxWAVE')
  assert.equal(calls, 7)
  const first = post('/concurrency/search', { query: 'test', confirmedCost: true })
  await started
  assert.equal((await post('/concurrency/search', { query: 'test', confirmedCost: true })).status, 429)
  releaseCall()
  assert.equal((await first).status, 200)
  assert.equal((await post('/concurrency/search', { query: 'test', confirmedCost: true })).status, 200)
  for (let i = 0; i < 21; i++) await post('/api/deepseek/search', { query: 'test' })
  assert.equal((await post('/api/deepseek/search', { query: 'test', confirmedCost: true })).status, 429)
  assert.equal(calls, 7)
  const otherId = 'route-test-other'
  createUser(otherId, 'other', 'fixture-password-hash')
  const otherHeaders = { ...headers, 'x-deepseek-api-key': '', Authorization: `Bearer ${jwt.sign({ id: otherId, tokenVersion: 0 }, process.env.JWT_SECRET)}` }
  const accountKey = 'fixture-private-deepseek'
  const update = (auth = headers) => fetch(`${base}/disabled/key`, {
    method: 'PUT', headers: auth, body: JSON.stringify({ apiKey: accountKey }),
  })
  assert.equal((await update({ ...headers, Authorization: '' })).status, 401)
  assert.equal((await update()).status, 410)
  const otherStatus = await fetch(`${base}/disabled/status`, { headers: otherHeaders })
  assert.deepEqual(await otherStatus.json(), { enabled: false, configured: false })

  const privateKey = `deepseek_api_key:${user.id}`
  const privateKeyPath = `/api/settings/${encodeURIComponent(privateKey)}`
  toolResult = { results: [] }
  assert.equal((await post('/disabled/search', { query: 'test', confirmedCost: true }, { ...headers, 'x-deepseek-api-key': accountKey })).status, 200)
  assert.equal(upstreamAuthorization, `Bearer ${accountKey}`)
  assert.equal((await post('/disabled/search', { query: 'test', confirmedCost: true }, { ...headers, 'x-deepseek-api-key': '' })).status, 503, 'the key cannot outlive its request')
  assert.equal(getSetting(privateKey), null)

  const settingsPath = `${base}/api/settings/ai-config`
  const input = { articleProvider: 'deepseek', articleModel: 'deepseek-flash', deepseekApiKey: accountKey, glmApiKey: 'fixture-glm', githubToken: 'fixture-gh', embeddingExtraHeaders: '{"Authorization":"fixture-auth"}' }
  const safe = { articleProvider: 'deepseek', articleModel: 'deepseek-flash' }
  const put = await fetch(settingsPath, { method: 'PUT', headers, body: JSON.stringify({ value: input }) })
  assert.deepEqual((await put.json()).value, safe)
  assert.deepEqual(getSetting('ai-config'), safe)
  assert.equal((await post('/api/settings', { 'ai-config': { ...input, coverApiKey: 'fixture-cover' } })).status, 200)
  assert.deepEqual(getSetting('ai-config'), safe)
  assert.throws(() => setSetting(privateKey, accountKey), /只保存在当前浏览器/)
  const job = createCronJob({ id: 'legacy', userId: user.id, name: 'fixture-job', cronExpr: '0 0 * * *', aiConfig: input })
  assert.deepEqual(job?.aiConfig, safe)
  // 绕过新写入保护，模拟升级之前留下的记录。
  db.prepare("INSERT INTO settings (key,value,updated_at) VALUES (?, ?, ?)").run(privateKey, JSON.stringify(accountKey), new Date().toISOString())
  db.prepare("UPDATE settings SET value = ? WHERE key = 'ai-config'").run(JSON.stringify(input))
  db.prepare("UPDATE cron_jobs SET ai_config = ? WHERE id = 'legacy'").run(JSON.stringify(input))
  migrateBrowserOnlyAIKeys()
  assert.equal(getSetting(privateKey), null)
  assert.deepEqual(getSetting('ai-config'), safe)
  assert.equal((db.prepare("SELECT ai_config FROM cron_jobs WHERE id = 'legacy'").get() as { ai_config: string }).ai_config, JSON.stringify(safe))
  for (const auth of [headers, otherHeaders]) {
    const list = await fetch(`${base}/api/settings`, { headers: auth })
    assert.doesNotMatch(await list.text(), /fixture-private-deepseek|deepseek_api_key|fixture-glm/)
    assert.equal((await fetch(`${base}${privateKeyPath}`, { headers: auth })).status, 403)
    assert.equal((await fetch(`${base}${privateKeyPath}`, { method: 'PUT', headers: auth, body: JSON.stringify({ value: '' }) })).status, 403)
  }
  console.log('DeepSeek route auth, disabled state, consent, isolation, validation, safety and rate limit tests passed')
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  db.close()
  rmSync(root, { recursive: true, force: true })
}

// Existing logger owns a recurring cleanup timer; all test resources are closed above.
process.exit(0)
