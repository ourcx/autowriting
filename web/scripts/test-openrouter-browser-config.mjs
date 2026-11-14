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
    return new Response(JSON.stringify({ value: { coverProvider: 'openrouter', openrouterApiKey: 'stale-server-key', deepseekApiKey: 'stale-deepseek', zhipuApiKey: 'stale-glm' } }), { status: 200 })
  }
  throw new Error(`意外请求：${url}`)
}

saveAIConfig({ ...DEFAULT_CONFIG, coverProvider: 'openrouter', openrouterApiKey: 'browser-key', deepseekApiKey: 'local-deepseek', zhipuApiKey: 'local-glm', embeddingExtraHeaders: '{"Authorization":"local-emb"}' })
assert.equal(loadAIConfig().openrouterApiKey, 'browser-key')
assert.equal(savedOnServer.openrouterApiKey, undefined, 'OpenRouter Key 不能写入服务端设置')

assert.doesNotMatch(JSON.stringify(savedOnServer), /local-deepseek|local-glm|local-emb/)
await syncAIConfigFromServer()
assert.equal(loadAIConfig().deepseekApiKey, 'local-deepseek')
assert.equal(loadAIConfig().zhipuApiKey, 'local-glm')
assert.equal(loadAIConfig().openrouterApiKey, 'browser-key', '服务端配置同步不能覆盖浏览器 Key')

console.log('OpenRouter Key 浏览器存储测试通过')

const { loadGenCliPairingCode, saveGenCliPairingCode } = await import('../src/utils/aiConfig.ts')
saveGenCliPairingCode('fixture-pairing')
saveAIConfig({ ...loadAIConfig(), coverProvider: 'gencli' })
assert.equal(loadAIConfig().coverProvider, 'gencli')
assert.equal(savedOnServer.coverProvider, 'openrouter', 'Gen CLI 仅覆盖当前浏览器的封面选择')
assert.doesNotMatch(JSON.stringify({ ...savedOnServer, ...loadAIConfig() }), /fixture-pairing/)
await syncAIConfigFromServer()
assert.equal(loadGenCliPairingCode(), 'fixture-pairing')
assert.equal(loadAIConfig().coverProvider, 'gencli')
saveAIConfig({ ...loadAIConfig(), coverProvider: 'local' })
assert.equal(loadAIConfig().coverProvider, 'local')
assert.equal(savedOnServer.coverProvider, 'local')
console.log('Gen CLI 本机封面选择与配对码隔离通过')
