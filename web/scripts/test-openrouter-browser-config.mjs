import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, loadAIConfig, saveAIConfig, syncAIConfigFromServer } from '../src/utils/aiConfig.ts'

const storage = new Map([['auth_token', 'test-token']])
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => { storage.set(key, value) },
}
globalThis.window = { dispatchEvent: () => {} }

let savedOnServer
globalThis.fetch = async (url, init) => {
  if (url === '/api/settings') {
    savedOnServer = JSON.parse(init.body)['ai-config']
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }
  if (url === '/api/settings/ai-config') {
    return new Response(JSON.stringify({ value: { coverProvider: 'openrouter', openrouterApiKey: 'stale-server-key' } }), { status: 200 })
  }
  throw new Error(`意外请求：${url}`)
}

saveAIConfig({ ...DEFAULT_CONFIG, coverProvider: 'openrouter', openrouterApiKey: 'browser-key' })
assert.equal(loadAIConfig().openrouterApiKey, 'browser-key')
assert.equal(savedOnServer.openrouterApiKey, undefined, 'OpenRouter Key 不能写入服务端设置')

await syncAIConfigFromServer()
assert.equal(loadAIConfig().openrouterApiKey, 'browser-key', '服务端配置同步不能覆盖浏览器 Key')

console.log('OpenRouter Key 浏览器存储测试通过')
