/** Official DeepSeek application APIs. No automatic retries: tools may already be billed. */
import { assertPublicHttpUrl } from './networkPolicy.ts'

export interface DeepSeekConfig {
  enabled: boolean
  apiKey: string
}
export type DeepSeekFilePurpose = 'user_data' | 'text_recognition' | 'rich_layout_recognition'
export interface DeepSeekFile {
  name: string
  bytes: Uint8Array
  mimeType?: string
}
export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{ type: 'text'; text: string } | { type: 'file'; file_id: string }>
  server_tool_calls?: unknown[]
}
export interface DeepSeekChatOptions {
  messages: DeepSeekMessage[]
  thinking?: boolean
  webSearch?: boolean
  readUrl?: boolean
}
export interface DeepSeekCitation {
  type: 'url_citation'
  url_citation: { url: string; title: string; start_index: number; end_index: number }
}
export interface DeepSeekChatResult {
  content: string
  reasoningContent: string
  annotations: DeepSeekCitation[]
  serverToolCalls: unknown[]
  usage: Record<string, unknown>
}
export class DeepSeekError extends Error {
  readonly status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'DeepSeekError'
    this.status = status
  }
}
export class DeepSeekOutputLengthError extends DeepSeekError {}

export const DEEPSEEK_ORIGIN = 'https://api.deepseek.com'
export const DEEPSEEK_MODEL = 'deepseek-flash'

export function isDeepSeekReady(config: DeepSeekConfig): boolean {
  return config.enabled && Boolean(config.apiKey.trim())
}
const MiB = 1024 * 1024
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function string(value: unknown): string { return typeof value === 'string' ? value : '' }
function requireText(value: string, maximum: number, label: string): void {
  if (typeof value !== 'string' || !value.trim() || [...value].length > maximum) {
    throw new DeepSeekError(`${label}必须为 1–${maximum} 个字符`, 400)
  }
}
function validateFile(file: DeepSeekFile, maximum: number): void {
  if (!file.bytes.length || file.bytes.length > maximum || !file.name || /[\r\n\0/\\]/.test(file.name)) {
    throw new DeepSeekError('文件为空、过大或文件名不合法', 400)
  }
}
function fileForm(file: DeepSeekFile, purpose?: DeepSeekFilePurpose): FormData {
  const form = new FormData()
  // DeepSeek requires purpose BEFORE file in multipart bodies.
  if (purpose) form.append('purpose', purpose)
  form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.mimeType || 'application/octet-stream' }), file.name)
  return form
}
function validatePurpose(file: DeepSeekFile, purpose: DeepSeekFilePurpose): void {
  if (!['user_data', 'text_recognition', 'rich_layout_recognition'].includes(purpose)) {
    throw new DeepSeekError('文件解析方式不合法', 400)
  }
  validateFile(file, purpose === 'user_data' ? 32 * MiB : 100 * MiB)
}

export function createDeepSeekClient(config: DeepSeekConfig, transport: typeof fetch = fetch) {
  function enabled(): void {
    if (!config.enabled) throw new DeepSeekError('DeepSeek 应用能力尚未启用', 503)
    if (!config.apiKey.trim()) throw new DeepSeekError('请在当前浏览器的 AI 配置中填写 DeepSeek Key', 503)
  }
  async function request(endpoint: string, body: Record<string, unknown> | FormData, signal?: AbortSignal, timeoutMs = 120_000): Promise<Response> {
    enabled()
    const multipart = body instanceof FormData
    let response: Response
    try {
      response = await transport(`${DEEPSEEK_ORIGIN}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
        body: multipart ? body : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      })
    } catch {
      // Never include request headers, upstream text, or a credential-bearing transport error.
      throw new DeepSeekError('DeepSeek 请求失败或超时；未自动重试，以避免重复计费')
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new DeepSeekError(`DeepSeek 请求失败（HTTP ${response.status}）`, response.status === 429 ? 429 : 502)
    }
    return response
  }
  async function json(endpoint: string, body: Record<string, unknown> | FormData, signal?: AbortSignal, timeoutMs?: number): Promise<Record<string, unknown>> {
    const response = await request(endpoint, body, signal, timeoutMs)
    let data: Record<string, unknown>
    try { data = object(await response.json()) } catch { throw new DeepSeekError('DeepSeek 返回了无效 JSON') }
    if (data.error) throw new DeepSeekError('DeepSeek 未能完成请求；未自动重试，以避免重复计费')
    return data
  }
  async function complete(body: Record<string, unknown>, signal?: AbortSignal, timeoutMs?: number) {
    // 审核在模型生成结束后才完成，调用方只接收审核通过的完整正文。
    const data = await json('/chat/completions', {
      messages: body.messages,
      temperature: body.temperature,
      ...(Array.isArray(body.tools) && body.tools.length ? { tools: body.tools } : {}),
      model: DEEPSEEK_MODEL,
      thinking: { type: body.thinking === true ? 'enabled' : 'disabled' },
      safety_check: { level: 'high' },
      stream: false,
    }, signal, timeoutMs)
    const choice = object(Array.isArray(data.choices) ? data.choices[0] : undefined)
    if (choice.finish_reason === 'content_filter') throw new DeepSeekError('内容未通过 DeepSeek 安全检查', 422)
    if (choice.finish_reason === 'length') throw new DeepSeekOutputLengthError('DeepSeek 返回了长度截断，可能达到输出额度或上下文限制。')
    if (choice.finish_reason !== 'stop') throw new DeepSeekError('DeepSeek 未返回完整结果。')
    const message = object(choice.message)
    if (typeof message.content !== 'string' || !message.content.trim()) throw new DeepSeekError('DeepSeek 未返回文本回答')
    return { message, content: message.content, usage: object(data.usage) }
  }

  return {
    complete,
    async chat(options: DeepSeekChatOptions): Promise<DeepSeekChatResult> {
      if (!options.messages.length || options.messages.length > 100) throw new DeepSeekError('消息数量必须为 1–100', 400)
      let fileCount = 0
      let textBytes = 0
      for (const message of options.messages) {
        if (!['system', 'user', 'assistant'].includes(message.role)) throw new DeepSeekError('消息角色不合法', 400)
        if (typeof message.content === 'string') textBytes += Buffer.byteLength(message.content)
        else for (const part of message.content) {
          if (part.type === 'file') {
            if (message.role !== 'user' || !/^file-[\w-]+$/.test(part.file_id)) throw new DeepSeekError('文件引用不合法', 400)
            fileCount++
          } else if (part.type === 'text') textBytes += Buffer.byteLength(part.text)
          else throw new DeepSeekError('消息内容类型不合法', 400)
        }
      }
      if (fileCount > 20 || textBytes > 8 * MiB) throw new DeepSeekError('最多 20 个文件、8 MiB 文本', 400)
      const tools = [
        ...(options.webSearch ? [{ type: 'deepseek_web_search' }] : []),
        ...(options.readUrl ? [{ type: 'deepseek_read_url' }] : []),
      ]
      const { message, content, usage } = await complete({
        messages: options.messages, thinking: options.thinking, tools,
      })
      const annotations: DeepSeekCitation[] = []
      for (const raw of Array.isArray(message.annotations) ? message.annotations : []) {
        const annotation = object(raw)
        const citation = object(annotation.url_citation)
        const url = string(citation.url)
        if (annotation.type !== 'url_citation' || !/^https?:\/\//i.test(url)) continue
        if (typeof citation.start_index !== 'number' || typeof citation.end_index !== 'number') continue
        annotations.push({ type: 'url_citation', url_citation: {
          url, title: string(citation.title), start_index: citation.start_index, end_index: citation.end_index,
        } })
      }
      return {
        content, reasoningContent: string(message.reasoning_content), annotations,
        serverToolCalls: Array.isArray(message.server_tool_calls) ? message.server_tool_calls : [],
        usage,
      }
    },
    async search(query: string, count = 10, signal?: AbortSignal) {
      requireText(query, 128, '搜索词')
      if (!Number.isInteger(count) || count < 1 || count > 50) throw new DeepSeekError('搜索结果数必须为 1–50', 400)
      const data = await json('/v1/tools/search', { query, count, need_content: false }, signal)
      if (!Array.isArray(data.results)) throw new DeepSeekError('DeepSeek 未返回搜索结果')
      return data.results.map((raw: unknown) => {
        const row = object(raw)
        return { title: string(row.title), url: string(row.url), snippet: string(row.snippet), summary: string(row.summary), content: string(row.content), siteName: string(row.site_name), datePublished: string(row.date) }
      }).filter(row => /^https?:\/\//i.test(row.url))
    },
    async fetchUrl(url: string, signal?: AbortSignal) {
      enabled()
      requireText(url, 8192, 'URL')
      await assertPublicHttpUrl(url)
      const data = await json('/v1/tools/fetch', { url }, signal)
      if (typeof data.content !== 'string' || !data.content.trim()) throw new DeepSeekError('DeepSeek 未返回网页正文')
      return { title: string(data.title), content: data.content }
    },
    async uploadFile(file: DeepSeekFile, purpose: DeepSeekFilePurpose = 'text_recognition') {
      validatePurpose(file, purpose)
      const data = await json('/files', fileForm(file, purpose))
      if (typeof data.id !== 'string' || !/^file-[\w-]+$/.test(data.id)) throw new DeepSeekError('DeepSeek 未返回文件 ID')
      return { id: data.id, purpose, filename: file.name }
    },
    async ocr(file: DeepSeekFile, purpose: Exclude<DeepSeekFilePurpose, 'user_data'> = 'text_recognition') {
      if (purpose !== 'text_recognition' && purpose !== 'rich_layout_recognition') throw new DeepSeekError('OCR 解析方式不合法', 400)
      validatePurpose(file, purpose)
      const data = await json('/v1/tools/ocr', fileForm(file, purpose))
      if (!Array.isArray(data.pages)) throw new DeepSeekError('DeepSeek 未返回 OCR 页面')
      const pages = data.pages.map((raw: unknown) => {
        const page = object(raw)
        if (page.finish_reason !== 'stop' || typeof page.text !== 'string') {
          throw new DeepSeekError('DeepSeek OCR 页面解析不完整，请减少文件页数')
        }
        return page.text
      })
      return { pages, content: pages.join('\n\n') }
    },
    async transcribe(file: DeepSeekFile) {
      validateFile(file, 8 * MiB)
      const signature = Buffer.from(file.bytes.subarray(0, 12)).toString('ascii')
      if (!(signature.startsWith('RIFF') && signature.endsWith('WAVE')) && !signature.startsWith('OggS')) {
        throw new DeepSeekError('语音仅支持 16-bit PCM WAV 或 Ogg Opus（最长 120 秒）', 400)
      }
      const data = await json('/v1/tools/asr', fileForm(file))
      if (typeof data.text !== 'string') throw new DeepSeekError('DeepSeek 未返回语音识别文本')
      return { text: data.text }
    },
    async speak(text: string, voice: 'stella' | 'tide' = 'stella') {
      requireText(text, 10000, '朗读文本')
      const billableCharacters = [...text].reduce((count, character) => count + (/\p{Script=Han}/u.test(character) ? 2 : 1), 0)
      if (billableCharacters > 10000 || Buffer.byteLength(text) > 64 * 1024) throw new DeepSeekError('朗读文本超过 10000 计费字符或 64 KiB', 400)
      if (!['stella', 'tide'].includes(voice)) throw new DeepSeekError('不支持该音色', 400)
      const response = await request('/v1/tools/tts', { text, voice_id: voice, format: 'wav', filter_markdown: true })
      if (!(response.headers.get('content-type') || '').startsWith('audio/')) {
        await response.body?.cancel()
        throw new DeepSeekError('DeepSeek 未返回音频')
      }
      return response
    },
  }
}
