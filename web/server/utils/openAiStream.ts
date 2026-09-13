import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'

interface OpenAiStreamChunk {
  error?: { message?: string }
  choices?: Array<{
    delta?: { content?: string }
    finish_reason?: string | null
  }>
}

/**
 * 按 UTF-8 字符边界解析 OpenAI 兼容 SSE，并在流结束时消费没有换行的尾段。
 * 网络分片不保证落在字符或 SSE 行边界，不能对每个 Buffer 单独调用 toString。
 */
export function consumeOpenAiContentStream(
  stream: Readable,
  onContent: (_content: string) => void,
  options: { requireCompletion?: boolean; idleMs?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8')
    let buffer = ''
    let fullContent = ''
    let completed = false
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        reject(error)
        stream.destroy()
      } else resolve(fullContent)
    }
    const resetTimer = () => {
      clearTimeout(timer)
      timer = setTimeout(() => finish(new Error('模型长时间没有响应，已保留生成内容，请重试')), options.idleMs || 120000)
      timer.unref()
    }

    const consumeLine = (line: string) => {
      if (settled) return
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return
      if (trimmed === 'data: [DONE]') { completed = true; return }
      let payload: OpenAiStreamChunk
      try {
        payload = JSON.parse(trimmed.slice(5).trim()) as OpenAiStreamChunk
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid stream payload')
      } catch {
        finish(new Error('模型返回的数据不完整，已保留生成内容'))
        return
      }
      if (payload.error) { finish(new Error('模型服务返回错误，请检查模型配置后重试')); return }
      const choice = payload.choices?.[0]
      const content = choice?.delta?.content
      if (typeof content === 'string' && content) {
        fullContent += content
        try { onContent(content) } catch (error) {
          finish(error instanceof Error ? error : new Error('保存生成内容失败'))
        }
      }
      if (choice?.finish_reason === 'length') {
        finish(new Error('输出达到模型长度上限，可继续生成余下内容'))
      } else if (choice?.finish_reason === 'stop') completed = true
      else if (choice?.finish_reason) finish(new Error(`模型提前结束（${choice.finish_reason}），请检查已生成内容`))
    }

    const consumeCompleteLines = () => {
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      lines.forEach(consumeLine)
    }

    stream.on('data', chunk => {
      if (settled) return
      resetTimer()
      buffer += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      consumeCompleteLines()
    })
    stream.once('end', () => {
      buffer += decoder.end()
      consumeCompleteLines()
      if (buffer.trim()) consumeLine(buffer)
      if (!fullContent.trim()) finish(new Error('模型未返回正文，请重试或更换模型'))
      else if (options.requireCompletion && !completed) finish(new Error('连接结束但模型未确认完成，可继续生成'))
      else finish()
    })
    stream.once('error', error => finish(error))
    stream.once('close', () => {
      if (!settled) finish(new Error('模型连接中断，已保留生成内容'))
    })
    resetTimer()
  })
}
