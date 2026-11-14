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
    const duplicate = await stream(rows[0])
    assert.equal(duplicate.status, 409)
    for (const response of [first, second, third]) assert.match(await response.text(), /event: done/)
    assert.equal(maxActive, 3)
    maxActive = 0
    const pairedRows = await json(`${root}/candidates`, 'POST', { ...input, platform: 'both', count: 3 })
    assert.equal(pairedRows.length, 6)
    const pairedResponses = await Promise.all(pairedRows.map(stream))
    const [overflowCandidate] = await json(`${root}/candidates`, 'POST', { ...input, count: 1 })
    const overflow = await stream(overflowCandidate)
    assert.equal(overflow.status, 429)
    for (const response of pairedResponses) assert.match(await response.text(), /event: done/)
    assert.equal(maxActive, 6, '三组公众号与头条候选稿应全部并行生成')
    assert.equal((await json(root)).article, '# 原稿\n\n原稿不能被候选覆盖。')
    const [fourth] = await json(`${root}/candidates`, 'POST', { ...input, count: 1 })
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
    assert.equal(stored.find(row => row.id === overflowCandidate.id)?.status, 'queued')
    assert.ok(stored.filter(row => row.id !== overflowCandidate.id).every(row => row.status === 'complete'))
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
    assert.equal((await json(`${root}/candidates`)).length, 11)
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


export async function smokeWritingAgent(base, token) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  const id = `20261114-writing-agent-${Date.now()}`
  const history = `20261113-history-${Date.now()}`
  const root = `${base}/api/articles/${id}`
  const modelBodies = []
  let stopReason = 'length'
  let continuation = false
  const draft = '# 校舍建设进展\n\n目前能确定的只有一件事：5 月 10 日已公示设计招标。开工时间仍未知。'
  const rewritten = '# 校舍建设进展\n\n学校于 5 月 10 日公示设计招标，开工日期尚未公布。'
  const rewrites = []
  const model = createServer(async (request, response) => {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const input = JSON.parse(raw)
    modelBodies.push(input)
    if (input.stream) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const content = continuation ? '开工时间仍未知。' : draft.replace('开工时间仍未知。', '')
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: stopReason }] })}\n\n`)
      return
    }
    const [system, user] = input.messages.map(message => message.content)
    let content
    if (system.includes('独立审稿 Agent')) {
      assert.equal(user, draft)
      content = JSON.stringify({ issues: [{ excerpt: '目前能确定的只有一件事', action: '直接写公告发布日期' }] })
    } else if (system.includes('独立优化 Agent')) {
      const revision = JSON.parse(user)
      rewrites.push(revision)
      assert.equal(revision.draft, draft)
      assert.match(revision.notes[0], /直接写公告发布日期/)
      content = rewrites.length === 1 ? rewritten.replace('10 日', '11 日') : rewritten
    } else if (system.includes('调研 Agent')) {
      assert.deepEqual(input.messages.map(({ role }) => role), ['system', 'user'])
      assert.match(user, /校舍建设/)
      content = '{"action":"finish","plan":{"angle":"公开招标进展"}}'
    } else {
      assert.match(system, /写作准备/)
      assert.deepEqual(input.messages.map(({ role }) => role), ['system', 'user', 'assistant', 'user'])
      assert.equal(JSON.parse(input.messages[2].content).action, 'finish')
      assert.match(input.messages[3].content, /公开招标进展/)
      content = '先讲已经公示的招标，再说明开工时间未知。'
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }))
  })
  async function json(url, body) {
    const res = await fetch(url, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) })
    assert.ok(res.ok, `${res.status} ${url}`)
    return res.json()
  }
  try {
    await new Promise(resolve => model.listen(0, '127.0.0.1', resolve))
    const original = '# 已有正文\n\n用于确认生成不会覆盖原稿。'
    await json(root, { task: '校舍建设', materials: '现有公告只写了设计招标', article: original })
    await json(`${base}/api/articles/${history}`, {
      title: '往期校舍建设', article: `# 往期校舍建设\n\n${'校舍建设先看公告，再去找执行单位和施工日期。'.repeat(13)}`,
    })
    const [candidate] = await json(`${root}/candidates`, {
      task: '校舍建设', materials: '现有公告只写了设计招标', platform: 'wechat', count: 1, writingAgent: true,
    })
    const aiConfig = {
      articleProvider: 'openai', articleBaseUrl: `http://127.0.0.1:${model.address().port}/v1`,
      articleApiKey: 'smoke-article-agent', articleModel: 'fixture', searchProvider: 'deepseek',
    }
    const run = async () => (await fetch(`${root}/candidates/${candidate.id}/stream`, {
      method: 'POST', headers, body: JSON.stringify({ aiConfig }),
    })).text()
    const interrupted = await run()
    assert.match(interrupted, /正在检索作者的历史文章/)
    assert.match(interrupted, /正在整理可引用证据和写作提纲/)
    assert.match(interrupted, /正在按作者语气写正文/)
    assert.match(interrupted, /event: error/)
    assert.match(interrupted, /event: trace/)
    assert.deepEqual(modelBodies.map(body => Boolean(body.stream)), [false, false, true])
    const context = modelBodies.at(-1).messages.at(-1).content
    assert.match(context, /先看公告，再去找执行单位/)
    assert.match(context, /说明开工时间未知/)
    assert.match(context, /短例子（虚构/)
    const [partial] = await json(`${root}/candidates`)
    assert.equal(partial.status, 'interrupted')
    assert.equal(partial.trace.find(step => step.kind === 'search')?.status, 'skipped')
    assert.equal(partial.trace.at(-1).status, 'failed')
    continuation = true
    stopReason = 'stop'
    assert.match(await run(), /event: done/)
    assert.deepEqual(modelBodies.map(body => Boolean(body.stream)), [false, false, true, true, false, false, false])
    assert.equal(modelBodies.at(-4).messages.at(-2).content, partial.content)
    assert.deepEqual(modelBodies.at(-1).messages.map(({ role }) => role), ['system', 'user'])
    assert.equal(rewrites.length, 2)
    assert.match(rewrites[1].corrections[0], /须保留：10；去除新增：11/)
    const [stored] = await json(`${root}/candidates`)
    assert.equal(stored.content, rewritten)
    assert.equal(stored.trace.find(step => step.kind === 'review')?.status, 'changes_requested')
    assert.deepEqual(stored.trace.filter(step => step.kind === 'verify').map(step => step.status), ['changes_requested', 'done'])
    assert.ok(!Object.hasOwn(stored, 'draftComplete'))
    assert.ok(stored.referenceArticleIds.includes(history))
    assert.deepEqual(stored.trace.filter(step => step.kind === 'write').map(step => [step.attempt, step.status]), [[1, 'failed'], [2, 'done']])
    assert.equal(stored.trace.filter(step => step.kind === 'history').length, 1)
    assert.equal(stored.trace.find(step => step.kind === 'history').sources[0].articleId, history)
    assert.ok(!Object.hasOwn(stored, 'writingBrief'))
    assert.equal((await json(root)).article, original)
    const saved = await json(root, { article: stored.content, selectedCandidateId: stored.id })
    assert.ok(saved.workflow.generationContext.referenceArticleIds.includes(history))
  } finally {
    model.closeAllConnections()
    await new Promise(resolve => model.close(resolve))
  }
}
