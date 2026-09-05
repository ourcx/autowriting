import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'

// 通过真实生成路由与空闲超时代理回归；模型只在本机模拟，文章由 smoke 的临时目录隔离。
export async function smokeArticleStream(base, token) {
  const delay = Number(process.env.SMOKE_STREAM_DELAY_MS || 16_000)
  assert.ok(Number.isFinite(delay) && delay >= 16_000 && delay <= 90_000)
  let calls = 0
  let proxyTimedOut = false
  const content = '# 流式生成回归\n\n这是隔离环境中的测试正文，用于确认公众号和今日头条在模型长时间没有输出时仍能完成生成。'
  const timers = new Set()
  const model = createServer((req, res) => {
    req.resume()
    const call = ++calls
    const timer = setTimeout(() => {
      timers.delete(timer)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const splitAt = content.indexOf('用于确认')
      const firstContent = content.slice(0, splitAt)
      const finalContent = content.slice(splitAt)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: firstContent } }] })}\n\n`)
      const finalEvent = Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: finalContent } }] })}`)
      const chineseStart = finalEvent.indexOf(Buffer.from('用'))
      // 故意把一个三字节中文字符拆到两个网络分片，并让最后一个 SSE 事件没有换行。
      res.write(finalEvent.subarray(0, chineseStart + 1))
      setImmediate(() => res.end(finalEvent.subarray(chineseStart + 1)))
    }, call === 1 ? delay : 16_000)
    timers.add(timer)
  })
  // 代理空闲 20 秒就断连，比线上的约 60 秒更严格；收到心跳应不断重置空闲计时。
  const proxy = createServer((req, res) => {
    const upstream = request(new URL(req.url, base), { method: req.method, headers: req.headers }, incoming => {
      res.writeHead(incoming.statusCode, incoming.headers)
      incoming.pipe(res)
    })
    upstream.setTimeout(20_000, () => {
      proxyTimedOut = true
      upstream.destroy(new Error('proxy idle timeout'))
    })
    upstream.on('error', () => res.destroy())
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  })
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await listen(model)
    await listen(proxy)
    const articleId = `20260905-stream-smoke-${Date.now()}`
    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/api/articles/${articleId}/generate/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        task: '验证长时间思考后生成文章', materials: '仅用于本地隔离验收的测试素材',
        selectedRagContext: '本地测试上下文', platforms: 'both',
        aiConfig: { articleProvider: 'openai-compat', articleApiKey: 'smoke-only', articleModel: 'smoke-model', articleBaseUrl: `http://127.0.0.1:${model.address().port}/v1` },
      }),
      signal: AbortSignal.timeout(delay + 40_000),
    })
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.equal(proxyTimedOut, false, '生成期间代理不应因空闲而断连')
    assert.equal(calls, 2, '公众号和头条应各调用一次模型')
    assert.ok((text.match(/: heartbeat/g) || []).length >= 3, '等待两平台正文时应持续收到心跳')
    const done = text.split('\n\n').filter(event => event.startsWith('event: done\n')).map(event => JSON.parse(event.split('\ndata: ')[1]))
    assert.deepEqual(done.map(event => event.platform), ['wechat', 'toutiao'])
    assert.ok(done.every(event => event.article === content), '心跳不能进入正文，也不能丢失正文')
    const saved = await fetch(`${base}/api/articles/${articleId}`, { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(saved.status, 200)
    const article = await saved.json()
    assert.equal(article.article, content)
    assert.equal(article.articleToutiao, content)
  } finally {
    timers.forEach(clearTimeout)
    for (const server of [proxy, model]) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  }
}
