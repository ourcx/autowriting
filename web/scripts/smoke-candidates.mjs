import assert from 'node:assert/strict'
import { createServer } from 'node:http'

export async function smokeCandidates(base, token) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const articleId = `20260913-candidates-${Date.now()}`
  const root = `${base}/api/articles/${articleId}`
  let active = 0
  let maxActive = 0
  let mode = 'normal'
  const prompts = []
  const model = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      prompts.push(JSON.parse(body))
      active++
      maxActive = Math.max(maxActive, active)
      response.on('close', () => { active-- })
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '# 候选正文 🎉\n\n保留内容。' } }] })}\n\n`)
      setTimeout(() => response.end(`data: ${JSON.stringify({
        choices: [{ delta: { content: '完整结尾✅。' }, finish_reason: mode === 'length' ? 'length' : 'stop' }],
      })}`), 300)
    })
  })
  const json = async (url, method = 'GET', body) => {
    const response = await fetch(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
    assert.ok(response.ok, `${method} ${url}: ${response.status}`)
    return response.json()
  }
  try {
    await new Promise(resolve => model.listen(0, '127.0.0.1', resolve))
    const aiConfig = { articleProvider: 'openai', articleBaseUrl: `http://127.0.0.1:${model.address().port}/v1`, articleApiKey: 'smoke-only', articleModel: 'fixture' }
    const input = { task: '候选稿验收任务', materials: '只使用给定事实', platform: 'wechat', count: 3, selectedRagContext: '', sourceArticle: '' }
    const unauthorized = await fetch(`${root}/candidates`)
    assert.equal(unauthorized.status, 401)
    const invalid = await fetch(`${root}/candidates`, { method: 'POST', headers, body: JSON.stringify({ ...input, count: 4 }) })
    assert.equal(invalid.status, 400)
    await json(root, 'POST', { article: '# 原稿\n\n原稿不能被候选覆盖。', task: input.task, materials: input.materials })
    const rows = await json(`${root}/candidates`, 'POST', input)
    assert.equal(rows.length, 3)
    assert.equal(new Set(rows.map(row => row.id)).size, 3)
    const stream = row => fetch(`${root}/candidates/${row.id}/stream`, { method: 'POST', headers, body: JSON.stringify({ aiConfig }) })
    const first = await stream(rows[0])
    const second = await stream(rows[1])
    const third = await stream(rows[2])
    const [fourth] = await json(`${root}/candidates`, 'POST', { ...input, count: 1 })
    const overflow = await stream(fourth)
    assert.equal(overflow.status, 429)
    const duplicate = await stream(rows[0])
    assert.equal(duplicate.status, 409)
    for (const response of [first, second, third]) assert.match(await response.text(), /event: done/)
    assert.equal(maxActive, 3)
    assert.equal((await json(root)).article, '# 原稿\n\n原稿不能被候选覆盖。')
    mode = 'length'
    assert.match(await (await stream(fourth)).text(), /event: error/)
    let stored = await json(`${root}/candidates`)
    const partial = stored.find(row => row.id === fourth.id)
    assert.equal(partial.status, 'interrupted')
    assert.ok(partial.content.includes('保留内容'))
    assert.doesNotMatch(partial.content, /\p{Extended_Pictographic}/u)
    mode = 'normal'
    assert.match(await (await stream(fourth)).text(), /event: done/)
    assert.equal(prompts.at(-1).messages.at(-2).content, partial.content)
    stored = await json(`${root}/candidates`)
    assert.ok(stored.every(row => row.status === 'complete'))
    assert.ok(stored.every(row => !/\p{Extended_Pictographic}/u.test(row.content)), '候选稿不得保存 emoji')
    assert.match(JSON.stringify(prompts[0]), /全文禁止使用 emoji/, '生成提示词应包含统一中文成文底线')
    assert.equal((await stream(rows[0])).status, 409, 'completed candidates must not rerun')
    assert.ok(!JSON.stringify(stored).includes('smoke-only'))
    const otherUser = { username: `candidate_other_${Date.now()}`, password: 'candidate-test-only' }
    await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(otherUser) })
    const otherToken = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(otherUser) })).json()).token
    const other = { 'Content-Type': 'application/json', Authorization: `Bearer ${otherToken}` }
    assert.deepEqual(await (await fetch(`${root}/candidates`, { headers: other })).json(), [])
    assert.equal((await fetch(`${root}/candidates/${rows[0].id}/stream`, { method: 'POST', headers: other, body: JSON.stringify({ aiConfig }) })).status, 404)
    assert.equal((await fetch(`${root}/candidates/%2e%2e%2fescape/stream`, { method: 'POST', headers, body: JSON.stringify({ aiConfig }) })).status, 404)
    const selected = stored[0]
    await json(root, 'POST', { article: selected.content })
    assert.equal((await json(root)).article, selected.content)
    assert.equal((await json(`${root}/candidates`)).length, 4)
    const [cancelled] = await json(`${root}/candidates`, 'POST', { ...input, count: 1 })
    const controller = new AbortController()
    const response = await fetch(`${root}/candidates/${cancelled.id}/stream`, {
      method: 'POST', headers, body: JSON.stringify({ aiConfig }), signal: controller.signal,
    })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let received = ''
    while (!received.includes('event: chunk')) {
      const { value, done } = await reader.read()
      assert.equal(done, false)
      received += decoder.decode(value, { stream: true })
    }
    controller.abort()
    await reader.cancel().catch(() => {})
    await new Promise(resolve => setTimeout(resolve, 150))
    const recovered = (await json(`${root}/candidates`)).find(row => row.id === cancelled.id)
    assert.equal(recovered.status, 'interrupted')
    assert.ok(recovered.content.includes('保留内容'))
    assert.equal((await json(root)).article, selected.content, 'cancellation must preserve the selected article')
    mode = 'length'
    const legacy = await fetch(`${root}/generate/stream`, {
      method: 'POST', headers, body: JSON.stringify({ ...input, platforms: 'wechat', aiConfig }),
    })
    const legacyEvents = await legacy.text()
    assert.match(legacyEvents, /event: error/)
    assert.doesNotMatch(legacyEvents, /event: done/)
    assert.equal((await json(root)).article, selected.content, 'legacy truncation must not overwrite the original')
  } finally {
    model.closeAllConnections()
    await new Promise(resolve => model.close(resolve))
  }
}
