import assert from 'node:assert/strict'
import { createDeepSeekClient } from '../server/utils/deepseek.ts'

const requests: Array<{ url: string; init: RequestInit }> = []
let responseBody: unknown = {}
let responseStatus = 200
const transport: typeof fetch = async (input, init = {}) => {
  requests.push({ url: String(input), init })
  return new Response(JSON.stringify(responseBody), { status: responseStatus, headers: { 'content-type': 'application/json' } })
}
const client = createDeepSeekClient({ enabled: true, apiKey: 'test-placeholder-not-a-secret' }, transport)
const disabled = createDeepSeekClient({ enabled: false, apiKey: '' }, transport)
await assert.rejects(() => disabled.search('test'), /尚未启用/)
assert.equal(requests.length, 0)
await assert.rejects(() => client.search('x'.repeat(129)), /搜索词/)
await assert.rejects(() => client.search('test', 51), /结果数/)
await assert.rejects(() => client.fetchUrl('http://127.0.0.1/private'), /内网/)
assert.equal(requests.length, 0)
responseBody = { results: [{ title: 'Example', url: 'https://example.com', snippet: 'Example result' }, { url: 'javascript:alert(1)' }] }
assert.equal((await client.search('新闻', 3)).length, 1)
assert.equal(requests.at(-1)?.url, 'https://api.deepseek.com/v1/tools/search')
assert.deepEqual(JSON.parse(String(requests.at(-1)?.init.body)), { query: '新闻', count: 3, need_content: false })
assert.equal(requests.at(-1)?.init.redirect, 'error')

const signedTool = { id: 'tool-1', signature: 'opaque-test-signature' }
const citation = { type: 'url_citation', url_citation: { url: 'https://example.com', title: 'Example', start_index: 0, end_index: 2 } }
responseBody = { choices: [{ finish_reason: 'stop', message: { content: '正文', annotations: [citation], server_tool_calls: [signedTool] } }], usage: { server_tool_use: { tool_search: 2 } } }
const chat = await client.chat({ messages: [{ role: 'user', content: '查资料' }], thinking: true, webSearch: true, readUrl: true })
assert.deepEqual(chat.annotations, [citation])
assert.deepEqual(chat.serverToolCalls, [signedTool])
assert.deepEqual(chat.usage, { server_tool_use: { tool_search: 2 } })
const body = JSON.parse(String(requests.at(-1)?.init.body))
assert.equal(body.model, 'deepseek-flash')
assert.deepEqual(body.thinking, { type: 'enabled' })
assert.deepEqual(body.safety_check, { level: 'high' })
assert.deepEqual(body.tools, [{ type: 'deepseek_web_search' }, { type: 'deepseek_read_url' }])
assert.equal(body.stream, false)
assert.equal(body.response_format, undefined)
responseBody = { choices: [{ finish_reason: 'content_filter', message: { content: 'must never be returned' } }] }
await assert.rejects(() => client.chat({ messages: [{ role: 'user', content: 'test' }] }), /安全检查/)
responseBody = { choices: [{ finish_reason: 'length', message: { content: 'incomplete' } }] }
await assert.rejects(() => client.chat({ messages: [{ role: 'user', content: 'test' }] }), /未完整/)
responseBody = { error: { message: 'secret upstream details' } }
await assert.rejects(() => client.search('test'), error => error instanceof Error && !error.message.includes('secret'))
responseStatus = 429
const before = requests.length
await assert.rejects(() => client.search('test'), /429/)
assert.equal(requests.length, before + 1, 'Paid calls must never retry automatically')
responseStatus = 200

const file = { name: 'example.pdf', bytes: new Uint8Array([37, 80, 68, 70]), mimeType: 'application/pdf' }
responseBody = { id: 'file-api-example' }
assert.equal((await client.uploadFile(file)).id, 'file-api-example')
const form = requests.at(-1)?.init.body
assert.ok(form instanceof FormData)
assert.deepEqual([...form.keys()], ['purpose', 'file'])
assert.equal(form.get('purpose'), 'text_recognition')
assert.equal((requests.at(-1)?.init.headers as Record<string, string>)['Content-Type'], undefined)
responseBody = { pages: [{ text: '第一页', finish_reason: 'stop' }, { text: '第二页', finish_reason: 'stop' }] }
assert.equal((await client.ocr(file)).content, '第一页\n\n第二页')
assert.equal(requests.at(-1)?.url, 'https://api.deepseek.com/v1/tools/ocr')
responseBody = { pages: [{ text: 'partial', finish_reason: 'length' }] }
await assert.rejects(() => client.ocr(file), /不完整/)
await assert.rejects(() => client.uploadFile({ ...file, name: '../example.pdf' }), /文件名/)
await assert.rejects(() => client.transcribe(file), /WAV/)
responseBody = { text: '识别文本' }
assert.equal((await client.transcribe({ name: 'sample.wav', bytes: new Uint8Array(Buffer.from('RIFFxxxxWAVE')) })).text, '识别文本')
assert.equal(requests.at(-1)?.url, 'https://api.deepseek.com/v1/tools/asr')
assert.deepEqual([...(requests.at(-1)?.init.body as FormData).keys()], ['file'])
await assert.rejects(() => client.speak('中'.repeat(5001)), /计费字符/)
await assert.rejects(() => client.speak('test'), /未返回音频/)
const audioClient = createDeepSeekClient({ enabled: true, apiKey: 'test-placeholder' }, async (_input, init) => {
  assert.deepEqual(JSON.parse(String(init?.body)), { text: '正文', voice_id: 'tide', format: 'wav', filter_markdown: true })
  return new Response('RIFFxxxxWAVE', { headers: { 'content-type': 'audio/wav' } })
})
assert.equal((await audioClient.speak('正文', 'tide')).headers.get('content-type'), 'audio/wav')
console.log('DeepSeek mocked API contract, safety, input limits and no-retry tests passed')
