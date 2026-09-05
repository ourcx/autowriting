import { StringDecoder } from 'node:string_decoder'
import type { Readable } from 'node:stream'

interface OpenAiStreamChunk {
  choices?: Array<{
    delta?: { content?: string }
  }>
}

/**
 * 按 UTF-8 字符边界解析 OpenAI 兼容 SSE，并在流结束时消费没有换行的尾段。
 * 网络分片不保证落在字符或 SSE 行边界，不能对每个 Buffer 单独调用 toString。
 */
export function consumeOpenAiContentStream(
  stream: Readable,
  onContent: (_content: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8')
    let buffer = ''
    let fullContent = ''

    const consumeLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:') || trimmed === 'data: [DONE]') return
      try {
        const payload = JSON.parse(trimmed.slice(5).trim()) as OpenAiStreamChunk
        const content = payload.choices?.[0]?.delta?.content
        if (!content) return
        fullContent += content
        onContent(content)
      } catch {
        // OpenAI 兼容服务可能夹带非 JSON 状态行，忽略它并继续读取正文。
      }
    }

    const consumeCompleteLines = () => {
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      lines.forEach(consumeLine)
    }

    stream.on('data', chunk => {
      buffer += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      consumeCompleteLines()
    })
    stream.once('end', () => {
      buffer += decoder.end()
      consumeCompleteLines()
      if (buffer.trim()) consumeLine(buffer)
      resolve(fullContent)
    })
    stream.once('error', reject)
  })
}
