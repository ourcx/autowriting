import { Router } from "express"
import { authMiddleware } from "../authMiddleware.ts"
import { SERVER_AI_CONFIG } from "../config.ts"
import { recordTokenUsage } from "../db.ts"
import { logger } from "../logger.ts"
import type { AIConfig, AuthedRequest } from "../types.ts"
import { buildLLMRequest, callLLMWithRetry } from "../utils/index.ts"
import { parseCanvasDocument } from "../../shared/canvasDsl.ts"
import type { CanvasDocument } from "../../shared/canvasDsl.ts"

const router = Router()
router.use(authMiddleware)

const PROMPT_MAX_LENGTH = 3000
const DOCUMENT_MAX_LENGTH = 30000

const CANVAS_SYSTEM_PROMPT = `你是公众号视觉画布设计师。请把用户需求转换成严格 JSON，不要输出 Markdown、解释或代码围栏。

画布 DSL：
{
  "version": 1,
  "name": "画布名称",
  "width": 750,
  "height": 1000,
  "background": "#fffaf0",
  "nodes": []
}

节点仅允许四种：
1. text: {"id":"","type":"text","x":0,"y":0,"width":300,"height":100,"rotation":0,"opacity":1,"text":"","fill":"#0a0a0a","fontSize":32,"fontWeight":600,"lineHeight":1.3,"align":"left"}
2. image: {"id":"","type":"image","x":0,"y":0,"width":300,"height":240,"rotation":0,"opacity":1,"src":"https://...","fit":"cover","radius":8}
3. shape: {"id":"","type":"shape","x":0,"y":0,"width":300,"height":100,"rotation":0,"opacity":1,"shape":"rect|ellipse","fill":"#ffffff","stroke":"#000000","strokeWidth":0,"radius":8}
4. motif: {"id":"","type":"motif","x":0,"y":0,"width":300,"height":100,"rotation":0,"opacity":1,"motif":"wave|dots|arch|spark|frame","fill":"#e8b94a","stroke":"#e8b94a","strokeWidth":4}

规则：
- 响应首字符必须是 {，末字符必须是 }，只输出一个完整 JSON 对象。
- 不得输出 Markdown 代码围栏、解释文字、注释、省略号或未闭合 JSON。
- nodes 至少包含 1 个节点，每个节点必须包含对应类型列出的全部字段。
- 节点按数组顺序从底到顶绘制，最多 40 个。
- 画布宽度建议 750，高度 750-1800。
- 多图海报使用 2-5 个 image 节点；没有用户图片 URL 时可以省略图片节点，不得编造 URL。
- 只用纯色，确保文字与背景对比清晰。
- 不输出任意 SVG、HTML、脚本、CSS、事件或外部字体。
- 文本忠于用户提供的信息，不虚构数据、姓名和结论。`

interface CanvasCompletionData {
  choices?: Array<{
    finish_reason?: string
    message?: {
      content?: unknown
      reasoning_content?: unknown
      tool_calls?: Array<{ function?: { arguments?: unknown } }>
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content.map(part => {
    if (typeof part === "string") return part
    if (!part || typeof part !== "object") return ""
    const record = part as Record<string, unknown>
    return typeof record.text === "string"
      ? record.text
      : typeof record.content === "string"
        ? record.content
        : ""
  }).join("")
}

function completionCandidates(data: CanvasCompletionData): string[] {
  const message = data.choices?.[0]?.message
  if (!message) return []
  const candidates = [
    textFromContent(message.content),
    ...(message.tool_calls || []).map(call => textFromContent(call.function?.arguments)),
    textFromContent(message.reasoning_content),
  ]
  return [...new Set(candidates.map(value => value.trim()).filter(Boolean))]
}

function balancedJsonObjects(text: string): unknown[] {
  const values: unknown[] = []
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue
    let depth = 0
    let quoted = false
    let escaped = false
    for (let index = start; index < text.length; index += 1) {
      const character = text[index]
      if (quoted) {
        if (escaped) escaped = false
        else if (character === "\\") escaped = true
        else if (character === "\"") quoted = false
        continue
      }
      if (character === "\"") quoted = true
      else if (character === "{") depth += 1
      else if (character === "}") {
        depth -= 1
        if (depth === 0) {
          try {
            values.push(JSON.parse(text.slice(start, index + 1)))
          } catch {
            // 继续寻找后续完整对象，避免一段坏 JSON 阻断整个响应。
          }
          break
        }
      }
    }
  }
  return values
}

function parseCanvasFromCompletion(data: CanvasCompletionData): CanvasDocument {
  for (const candidate of completionCandidates(data)) {
    for (const value of balancedJsonObjects(candidate)) {
      const record = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
      for (const documentValue of [record.document, record.canvas, value]) {
        try {
          return parseCanvasDocument(documentValue)
        } catch {
          // 尝试同一响应中的下一个候选对象。
        }
      }
    }
  }
  throw new Error("AI 未返回可解析的画布 DSL")
}

function completionShape(data: CanvasCompletionData) {
  const message = data.choices?.[0]?.message
  return {
    finishReason: data.choices?.[0]?.finish_reason || "",
    messageKeys: message ? Object.keys(message).sort() : [],
    contentType: Array.isArray(message?.content) ? "array" : typeof message?.content,
    contentLength: textFromContent(message?.content).length,
    reasoningLength: textFromContent(message?.reasoning_content).length,
    toolCallCount: message?.tool_calls?.length || 0,
  }
}

async function callStructuredCanvas(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  maxRetries = 3,
): Promise<CanvasCompletionData> {
  try {
    const response = await callLLMWithRetry(url, {
      ...body,
      response_format: { type: "json_object" },
    }, headers, maxRetries)
    return response.data as CanvasCompletionData
  } catch (error: unknown) {
    const status = (error as { response?: { status?: number } }).response?.status
    if (status !== 400 && status !== 422) throw error
    const response = await callLLMWithRetry(url, body, headers, maxRetries)
    return response.data as CanvasCompletionData
  }
}

async function generateCanvasWithRepair(input: {
  url: string
  model: string
  headers: Record<string, string>
  prompt: string
  currentDocument: string
  onRepair?: () => void
  onAttempt?: (completion: CanvasCompletionData, attempt: number) => void
}): Promise<{
  document: CanvasDocument
  completion: CanvasCompletionData
  attempts: CanvasCompletionData[]
  repaired: boolean
}> {
  const messages = [
    { role: "system", content: CANVAS_SYSTEM_PROMPT },
    {
      role: "user",
      content: `${input.prompt}${input.currentDocument ? `\n\n在当前画布基础上修改：\n${input.currentDocument}` : ""}`,
    },
  ]
  const first = await callStructuredCanvas(input.url, {
    model: input.model,
    messages,
    temperature: 0.2,
    max_tokens: 8000,
    stream: false,
  }, input.headers)
  input.onAttempt?.(first, 1)

  try {
    return {
      document: parseCanvasFromCompletion(first),
      completion: first,
      attempts: [first],
      repaired: false,
    }
  } catch {
    input.onRepair?.()
    const malformed = completionCandidates(first).join("\n").slice(0, 20000)
    const repair = await callStructuredCanvas(input.url, {
      model: input.model,
      messages: [
        {
          role: "system",
          content: `${CANVAS_SYSTEM_PROMPT}\n\n你现在是 JSON 修复器。只输出一个完整 JSON 对象，首字符必须是 {，末字符必须是 }。不要解释，不要使用代码围栏。`,
        },
        {
          role: "user",
          content: malformed
            ? `把下面的模型输出修复成合法画布 DSL：\n${malformed}`
            : `上一轮没有返回可用正文。请直接根据需求重新生成画布 DSL：\n${input.prompt}${input.currentDocument ? `\n当前画布：${input.currentDocument}` : ""}`,
        },
      ],
      temperature: 0,
      max_tokens: 8000,
      stream: false,
    }, input.headers, 2)
    input.onAttempt?.(repair, 2)
    return {
      document: parseCanvasFromCompletion(repair),
      completion: repair,
      attempts: [first, repair],
      repaired: true,
    }
  }
}

router.post("/generate", async (req: AuthedRequest, res) => {
  const debugStartedAt = Date.now()
  const debugTraceId = `canvas-${debugStartedAt}-${Math.random().toString(36).slice(2, 8)}`
  const prompt = String(req.body?.prompt || "").trim().slice(0, PROMPT_MAX_LENGTH)
  // #region debug-point A:request-entry
  if (process.env.DEBUG_SERVER_URL) void fetch(process.env.DEBUG_SERVER_URL, { method: "POST", body: JSON.stringify({ sessionId: "canvas-gateway-timeout", runId: process.env.DEBUG_RUN_ID || "pre-fix", hypothesisId: "A", traceId: debugTraceId, location: "server/routes/canvas.ts:request-entry", msg: "[DEBUG] Canvas request entered Node route", data: { promptLength: prompt.length, hasDocument: Boolean(req.body?.document) }, ts: Date.now() }) }).catch(() => {})
  // #endregion
  if (!prompt) {
    res.status(400).json({ error: "请输入画布需求" })
    return
  }

  const clientAiConfig = req.body?.aiConfig && typeof req.body.aiConfig === "object"
    ? req.body.aiConfig as AIConfig
    : {}
  const aiConfig: AIConfig = { ...SERVER_AI_CONFIG, ...clientAiConfig }
  if (!aiConfig.articleApiKey && aiConfig.articleProvider !== "maas") {
    res.status(400).json({ error: "请先在 AI 配置中填写文章模型的 API Key" })
    return
  }
  if (aiConfig.articleProvider === "maas" && !aiConfig.maasApiKey) {
    res.status(400).json({ error: "请先在 AI 配置中填写 MaaS API Key" })
    return
  }

  let currentDocument = ""
  if (req.body?.document) {
    try {
      currentDocument = JSON.stringify(parseCanvasDocument(req.body.document)).slice(0, DOCUMENT_MAX_LENGTH)
    } catch {
      currentDocument = ""
    }
  }

  try {
    const { url, model, headers } = buildLLMRequest(aiConfig)
    // #region debug-point BCD:before-upstream
    if (process.env.DEBUG_SERVER_URL) void fetch(process.env.DEBUG_SERVER_URL, { method: "POST", body: JSON.stringify({ sessionId: "canvas-gateway-timeout", runId: process.env.DEBUG_RUN_ID || "pre-fix", hypothesisId: "B,C,D", traceId: debugTraceId, location: "server/routes/canvas.ts:before-upstream", msg: "[DEBUG] Canvas upstream request starting", data: { elapsedMs: Date.now() - debugStartedAt, provider: aiConfig.articleProvider, model, documentLength: currentDocument.length, maxTokens: 8000 }, ts: Date.now() }) }).catch(() => {})
    // #endregion
    const generated = await generateCanvasWithRepair({
      url,
      model,
      headers,
      prompt,
      currentDocument,
    })
    const { document } = generated
    // #region debug-point BCD:upstream-complete
    if (process.env.DEBUG_SERVER_URL) void fetch(process.env.DEBUG_SERVER_URL, { method: "POST", body: JSON.stringify({ sessionId: "canvas-gateway-timeout", runId: process.env.DEBUG_RUN_ID || "pre-fix", hypothesisId: "B,C,D", traceId: debugTraceId, location: "server/routes/canvas.ts:upstream-complete", msg: "[DEBUG] Canvas upstream request completed", data: { elapsedMs: Date.now() - debugStartedAt, repaired: generated.repaired, attempts: generated.attempts.map(completionShape), nodeCount: document.nodes.length }, ts: Date.now() }) }).catch(() => {})
    // #endregion
    for (const attempt of generated.attempts) {
      if (!attempt.usage) continue
      recordTokenUsage({
        userId: req.user?.id,
        operation: "generate",
        model,
        inputTokens: attempt.usage.prompt_tokens,
        outputTokens: attempt.usage.completion_tokens,
        totalTokens: attempt.usage.total_tokens,
      })
    }
    res.json({ document })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "AI 生成画布失败"
    // #region debug-point BCE:error
    if (process.env.DEBUG_SERVER_URL) void fetch(process.env.DEBUG_SERVER_URL, { method: "POST", body: JSON.stringify({ sessionId: "canvas-gateway-timeout", runId: process.env.DEBUG_RUN_ID || "pre-fix", hypothesisId: "B,C,E", traceId: debugTraceId, location: "server/routes/canvas.ts:error", msg: "[DEBUG] Canvas generation failed", data: { elapsedMs: Date.now() - debugStartedAt, errorName: error instanceof Error ? error.name : "unknown", message }, ts: Date.now() }) }).catch(() => {})
    // #endregion
    logger.error("CANVAS", "AI 生成画布失败", { error: message, userId: req.user?.id })
    res.status(500).json({ error: message })
  }
})

router.post("/generate/stream", async (req: AuthedRequest, res) => {
  const debugStartedAt = Date.now()
  const debugTraceId = `canvas-stream-${debugStartedAt}-${Math.random().toString(36).slice(2, 8)}`
  const prompt = String(req.body?.prompt || "").trim().slice(0, PROMPT_MAX_LENGTH)
  if (!prompt) {
    res.status(400).json({ error: "请输入画布需求" })
    return
  }

  const clientAiConfig = req.body?.aiConfig && typeof req.body.aiConfig === "object"
    ? req.body.aiConfig as AIConfig
    : {}
  const aiConfig: AIConfig = { ...SERVER_AI_CONFIG, ...clientAiConfig }
  if (!aiConfig.articleApiKey && aiConfig.articleProvider !== "maas") {
    res.status(400).json({ error: "请先在 AI 配置中填写文章模型的 API Key" })
    return
  }
  if (aiConfig.articleProvider === "maas" && !aiConfig.maasApiKey) {
    res.status(400).json({ error: "请先在 AI 配置中填写 MaaS API Key" })
    return
  }

  let currentDocument = ""
  if (req.body?.document) {
    try {
      currentDocument = JSON.stringify(parseCanvasDocument(req.body.document)).slice(0, DOCUMENT_MAX_LENGTH)
    } catch {
      currentDocument = ""
    }
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.setHeader("X-Accel-Buffering", "no")
  res.flushHeaders()

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  send("progress", { message: "正在生成画布结构..." })
  const heartbeat = setInterval(() => send("heartbeat", { elapsedMs: Date.now() - debugStartedAt }), 15000)

  // #region debug-point B:stream-open
  if (process.env.DEBUG_SERVER_URL) void fetch(process.env.DEBUG_SERVER_URL, { method: "POST", body: JSON.stringify({ sessionId: "canvas-gateway-timeout", runId: process.env.DEBUG_RUN_ID || "post-fix", hypothesisId: "B", traceId: debugTraceId, location: "server/routes/canvas.ts:stream-open", msg: "[DEBUG] Canvas SSE stream opened", data: { elapsedMs: Date.now() - debugStartedAt, promptLength: prompt.length, documentLength: currentDocument.length }, ts: Date.now() }) }).catch(() => {})
  // #endregion

  try {
    const { url, model, headers } = buildLLMRequest(aiConfig)
    const generated = await generateCanvasWithRepair({
      url,
      model,
      headers,
      prompt,
      currentDocument,
      onRepair: () => send("progress", { message: "正在修复模型输出..." }),
      onAttempt: (completion, attempt) => {
        // #region debug-point F:completion-shape
        if (process.env.DEBUG_SERVER_URL) void fetch(process.env.DEBUG_SERVER_URL, { method: "POST", body: JSON.stringify({ sessionId: "canvas-gateway-timeout", runId: process.env.DEBUG_RUN_ID || "post-fix", hypothesisId: "F", traceId: debugTraceId, location: "server/routes/canvas.ts:completion-shape", msg: "[DEBUG] Canvas completion structure received", data: { elapsedMs: Date.now() - debugStartedAt, attempt, ...completionShape(completion) }, ts: Date.now() }) }).catch(() => {})
        // #endregion
      },
    })
    const { document } = generated
    for (const attempt of generated.attempts) {
      if (!attempt.usage) continue
      recordTokenUsage({
        userId: req.user?.id,
        operation: "generate",
        model,
        inputTokens: attempt.usage.prompt_tokens,
        outputTokens: attempt.usage.completion_tokens,
        totalTokens: attempt.usage.total_tokens,
      })
    }
    send("result", { document })
    // #region debug-point B:stream-complete
    if (process.env.DEBUG_SERVER_URL) void fetch(process.env.DEBUG_SERVER_URL, { method: "POST", body: JSON.stringify({ sessionId: "canvas-gateway-timeout", runId: process.env.DEBUG_RUN_ID || "post-fix", hypothesisId: "B,F", traceId: debugTraceId, location: "server/routes/canvas.ts:stream-complete", msg: "[DEBUG] Canvas SSE result sent", data: { elapsedMs: Date.now() - debugStartedAt, repaired: generated.repaired, nodeCount: document.nodes.length }, ts: Date.now() }) }).catch(() => {})
    // #endregion
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "AI 生成画布失败"
    send("error", { message })
    // #region debug-point BC:stream-error
    if (process.env.DEBUG_SERVER_URL) void fetch(process.env.DEBUG_SERVER_URL, { method: "POST", body: JSON.stringify({ sessionId: "canvas-gateway-timeout", runId: process.env.DEBUG_RUN_ID || "post-fix", hypothesisId: "B,C", traceId: debugTraceId, location: "server/routes/canvas.ts:stream-error", msg: "[DEBUG] Canvas SSE generation failed", data: { elapsedMs: Date.now() - debugStartedAt, errorName: error instanceof Error ? error.name : "unknown", message }, ts: Date.now() }) }).catch(() => {})
    // #endregion
    logger.error("CANVAS", "AI 流式生成画布失败", { error: message, userId: req.user?.id })
  } finally {
    clearInterval(heartbeat)
    if (!res.writableEnded) res.end()
  }
})

export default router
