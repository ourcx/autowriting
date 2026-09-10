import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'

const root = await mkdtemp(join(tmpdir(), 'autowriting-utilities-'))
Object.assign(process.env, {
  DATA_DIR: join(root, 'data'),
  DRAFTS_DIR: join(root, 'drafts'),
  LOG_DIR: join(root, 'logs'),
  LOG_LEVEL: 'ERROR',
})

let requests = 0
let mode = 'retry'
const server = createServer((request, response) => {
  request.resume()
  requests += 1
  response.setHeader('content-type', 'application/json')
  if (mode === 'unauthorized' || (mode === 'retry' && requests === 1)) {
    response.statusCode = mode === 'unauthorized' ? 401 : 500
    response.end(JSON.stringify({ error: 'fixture error' }))
    return
  }
  response.end(JSON.stringify({
    choices: [{ message: { content: mode === 'invalid-plan' ? 'not-json' : 'fixture article' } }],
  }))
})
let database
try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const { buildLLMRequest, callLLMWithRetry, generatePrompt, saveHistory } = await import('../server/utils/public.ts')
  database = (await import('../server/db.ts')).db
  const { generateSearchPlan } = await import('../server/utils/search.ts')

  const openai = buildLLMRequest({ articleBaseUrl: baseUrl, articleModel: 'fixture-model' })
  assert.equal(openai.url, `${baseUrl}/chat/completions`)
  assert.equal(openai.model, 'fixture-model')
  const maas = buildLLMRequest({ articleProvider: 'maas', maasBaseUrl: baseUrl })
  assert.equal(maas.url, `${baseUrl}/chat/completions`)
  assert.equal(maas.model, 'deepseek-v4-pro')
  assert.equal(maas.headers['x-maas-app-id'], 'qs-api')

  const result = await callLLMWithRetry(openai.url, {}, {}, 2, 2000)
  assert.equal(result.data.choices[0].message.content, 'fixture article')
  assert.equal(requests, 2, '5xx should retry')

  mode = 'unauthorized'
  requests = 0
  await assert.rejects(callLLMWithRetry(openai.url, {}, {}, 3, 2000), error => error.response?.status === 401)
  assert.equal(requests, 1, '4xx must not retry')

  mode = 'invalid-plan'
  await assert.rejects(generateSearchPlan('fixture topic', { articleBaseUrl: baseUrl }), error => {
    assert.ok(error.cause instanceof SyntaxError)
    assert.match(error.message, /生成搜索计划失败/)
    return true
  })
  assert.match(generatePrompt('fixture', '# **[sample]** `body`', 'modern', 'matcha'), /Article topic: sample body\./)
  assert.equal(saveHistory([]), undefined)
  console.log('Server utility request construction, retries, error cause and prompt cleanup passed')
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  database?.close()
  await rm(root, { recursive: true, force: true })
}

// The imported logger starts a daily cleanup timer; all test resources are closed above.
process.exit(0)
