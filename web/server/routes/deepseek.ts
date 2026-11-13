import { Router, type ErrorRequestHandler, type RequestHandler, type Response, type NextFunction } from 'express'
import multer from 'multer'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { AuthedRequest } from '../types.ts'
import { authMiddleware } from '../authMiddleware.ts'
import { DEEPSEEK_APP_CONFIG } from '../config.ts'
import { createDeepSeekClient, DeepSeekError, type DeepSeekConfig, type DeepSeekFile } from '../utils/deepseek.ts'

const confirmation = z.union([z.literal(true), z.literal('true')])
const toggle = z.union([z.boolean(), z.enum(['true', 'false'])]).optional().transform(value => value === true || value === 'true')
const purpose = z.enum(['user_data', 'text_recognition', 'rich_layout_recognition']).default('text_recognition')
const chatSchema = z.object({
  confirmedCost: confirmation, prompt: z.string().trim().min(1).max(32000),
  thinking: toggle, webSearch: toggle, readUrl: toggle, purpose,
}).strict()
const searchSchema = z.object({ confirmedCost: confirmation, query: z.string().trim().min(1).max(256), count: z.number().int().min(1).max(50).default(10) }).strict()
const fetchSchema = z.object({ confirmedCost: confirmation, url: z.string().max(8192) }).strict()
const ocrSchema = z.object({ confirmedCost: confirmation, purpose: z.enum(['text_recognition', 'rich_layout_recognition']).default('text_recognition') }).strict()
const asrSchema = z.object({ confirmedCost: confirmation }).strict()
const ttsSchema = z.object({ confirmedCost: confirmation, text: z.string().min(1).max(20000), voice: z.enum(['stella', 'tide']).default('stella') }).strict()
const documentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 * 1024 * 1024, files: 1, fields: 8, fieldSize: 128 * 1024, parts: 9 } }).single('file')
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 1, parts: 3 } }).single('file')
const DOCUMENT_TYPES = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'])
const TEXT_TYPES = new Set(['txt', 'md', 'csv', 'json', 'html', 'xml', 'xls', 'xlsx'])

interface UploadFile { originalname: string; buffer: Buffer; mimetype: string }
type DeepSeekRequest = AuthedRequest & { file?: UploadFile }

function inputFile(file: UploadFile | undefined, mode: 'document' | 'text' | 'audio'): DeepSeekFile {
  if (!file) throw new DeepSeekError('请选择文件', 400)
  const extension = file.originalname.split('.').slice(-1)[0]?.toLowerCase() || ''
  const allowed = mode === 'audio' ? new Set(['wav', 'ogg']) : mode === 'text' ? TEXT_TYPES : DOCUMENT_TYPES
  if (!allowed.has(extension)) throw new DeepSeekError('文件格式与所选解析方式不匹配', 400)
  return { name: file.originalname, bytes: file.buffer, mimeType: file.mimetype }
}

const run = (handler: (_req: DeepSeekRequest, _res: Response, _next: NextFunction) => unknown): RequestHandler => (req, res, next) => {
  res.locals.deepseekProcessing = true
  Promise.resolve(handler(req, res, next)).catch(next).finally(() => res.locals.releaseDeepSeek?.())
}

/** Injectable client is only used by local tests; HTTP clients cannot override credentials or hosts. */
export function createDeepSeekRouter(config: DeepSeekConfig = DEEPSEEK_APP_CONFIG, client = createDeepSeekClient(config)) {
  const router = Router()
  router.use(authMiddleware)
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next() })
  router.get('/status', (_req, res) => res.json({ enabled: config.enabled, configured: Boolean(config.apiKey) }))
  router.use((req, res, next) => {
    if (!config.enabled || !config.apiKey) { res.status(503).json({ error: 'DeepSeek 尚未启用或未配置服务端密钥' }); return }
    if (req.method !== 'POST') { res.status(405).json({ error: '不支持该方法' }); return }
    next()
  })
  router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, keyGenerator: req => (req as AuthedRequest).user!.id,
    standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'DeepSeek 请求过于频繁，请稍后再试' } }))
  const busy = new Map<string, symbol>()
  router.use((req, res, next) => {
    const user = (req as AuthedRequest).user!.id
    if (busy.has(user) || busy.size >= 4) { res.status(429).json({ error: 'DeepSeek 正在处理请求，请稍后再试' }); return }
    const lease = Symbol(user)
    busy.set(user, lease)
    const release = () => { if (busy.get(user) === lease) busy.delete(user) }
    res.locals.releaseDeepSeek = release
    // Keep the lock for the whole upload + inference sequence, including after disconnect.
    // The async handler releases in finally; aborted uploads release before processing starts.
    res.once('finish', release)
    res.once('close', () => { if (!res.locals.deepseekProcessing) release() })
    req.setTimeout(30_000, () => { if (!res.locals.deepseekProcessing) req.destroy() })
    next()
  })
  router.post('/chat', documentUpload, run(async (req, res) => {
    const input = chatSchema.parse(req.body)
    const content: Array<{ type: 'text'; text: string } | { type: 'file'; file_id: string }> = [{ type: 'text', text: input.prompt }]
    if (req.file) {
      const file = inputFile(req.file, input.purpose === 'user_data' ? 'text' : 'document')
      const uploaded = await client.uploadFile(file, input.purpose)
      content.unshift({ type: 'file', file_id: uploaded.id })
    }
    // No externally supplied file IDs or history: each uploaded document belongs to this request.
    const result = await client.chat({ messages: [{ role: 'user', content }], thinking: input.thinking, webSearch: input.webSearch, readUrl: input.readUrl })
    res.json(result)
  }))
  router.post('/search', run(async (req, res) => {
    const input = searchSchema.parse(req.body)
    res.json({ results: await client.search(input.query, input.count) })
  }))
  router.post('/fetch', run(async (req, res) => {
    const input = fetchSchema.parse(req.body)
    res.json(await client.fetchUrl(input.url))
  }))
  router.post('/ocr', documentUpload, run(async (req, res) => {
    const input = ocrSchema.parse(req.body)
    res.json(await client.ocr(inputFile(req.file, 'document'), input.purpose))
  }))
  router.post('/asr', audioUpload, run(async (req, res) => {
    asrSchema.parse(req.body)
    res.json(await client.transcribe(inputFile(req.file, 'audio')))
  }))
  router.post('/tts', run(async (req, res) => {
    const input = ttsSchema.parse(req.body)
    const response = await client.speak(input.text, input.voice)
    const audio = Buffer.from(await response.arrayBuffer())
    if (!audio.length || audio.length > 32 * 1024 * 1024) throw new DeepSeekError('返回音频为空或过大')
    res.setHeader('Content-Type', 'audio/wav')
    res.setHeader('Content-Disposition', 'attachment; filename="deepseek-speech.wav"')
    res.send(audio)
  }))
  router.use(((error, _req, res, _next) => {
    void _next
    if (error instanceof z.ZodError) { res.status(400).json({ error: '请确认费用并检查输入参数（不接受文件 ID、密钥或自定义服务地址）' }); return }
    if (error instanceof multer.MulterError) { res.status(400).json({ error: '上传超出限制：文档 32 MiB、音频 8 MiB，每次一个文件' }); return }
    if (error instanceof DeepSeekError) { res.status(error.status).json({ error: error.message }); return }
    res.status(502).json({ error: 'DeepSeek 请求未完成；未自动重试，避免重复计费' })
  }) satisfies ErrorRequestHandler)
  return router
}

export default createDeepSeekRouter()
