import assert from "node:assert/strict"
import { PassThrough } from "node:stream"
import { consumeOpenAiContentStream } from "../server/utils/openAiStream.ts"

const frame = (content: string, finish_reason?: string) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\n\n`
{
  const stream = new PassThrough()
  let received = ""
  const result = consumeOpenAiContentStream(stream, text => { received += text }, { requireCompletion: true })
  const bytes = Buffer.from(frame("中文正文", "stop"))
  for (const byte of bytes) stream.write(Buffer.from([byte]))
  stream.end()
  assert.equal(await result, "中文正文")
  assert.equal(received, "中文正文")
}
for (const reason of ["length", "content_filter"]) {
  const stream = new PassThrough()
  const result = consumeOpenAiContentStream(stream, () => {}, { requireCompletion: true })
  stream.end(frame("未完成正文", reason))
  await assert.rejects(result)
}
{
  const stream = new PassThrough()
  const result = consumeOpenAiContentStream(stream, () => {}, { requireCompletion: true })
  stream.end(frame("缺失终止事件"))
  await assert.rejects(result, /未确认完成/)
}
{
  const stream = new PassThrough()
  const result = consumeOpenAiContentStream(stream, () => {}, { idleMs: 20 })
  const keepAlive = setTimeout(() => {}, 50)
  await assert.rejects(result, /长时间没有响应/)
  clearTimeout(keepAlive)
}
{
  const stream = new PassThrough()
  const result = consumeOpenAiContentStream(stream, () => {})
  stream.write(frame("部分正文"))
  stream.destroy()
  await assert.rejects(result, /连接中断/)
}
{
  const stream = new PassThrough()
  const result = consumeOpenAiContentStream(stream, () => { throw new Error("checkpoint failed") })
  stream.end(frame("正文", "stop"))
  await assert.rejects(result, /checkpoint failed/)
}
{
  const stream = new PassThrough()
  const result = consumeOpenAiContentStream(stream, () => {})
  stream.end("data: null\n\n")
  await assert.rejects(result, /数据不完整/)
}
console.log("Generation stream completion, truncation, timeout, close and UTF-8 tests passed")
