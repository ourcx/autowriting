import { Router } from "express"
import { authMiddleware } from "../authMiddleware.ts"
import { SERVER_AI_CONFIG } from "../config.ts"
import { recordTokenUsage } from "../db.ts"
import { logger } from "../logger.ts"
import type { AIConfig, AuthedRequest } from "../types.ts"
import { buildLLMRequest, callLLMWithRetry } from "../utils/index.ts"
import { parseCanvasDocument } from "../../shared/canvasDsl.ts"
import type { CanvasDocument } from "../../shared/canvasDsl.ts"
import {
  hydrateCanvasDocument,
  parseCanvasSources,
} from "../../shared/canvasArticle.ts"
import type { CanvasSource } from "../../shared/canvasArticle.ts"
import {
  hydrateWechatBlockDocument,
  parseWechatBlockDocument,
} from "../../shared/wechatBlockDsl.ts"
import type { WechatBlockDocument } from "../../shared/wechatBlockDsl.ts"
import {
  buildCanvasDesignBrief,
  normalizeCanvasDesignTemplateId,
} from "../../shared/canvasDesignTemplates.ts"
import type { CanvasDesignTemplateId } from "../../shared/canvasDesignTemplates.ts"

const router = Router()
router.use(authMiddleware)

const PROMPT_MAX_LENGTH = 3000

const CANVAS_SYSTEM_PROMPT = `你是公众号长图排版引擎。文章内容由系统提供，你只能安排版式，绝对不能创作、改写、概括或省略正文。

画布 DSL：
{
  "version": 1,
  "name": "画布名称",
  "width": 750,
  "height": 1000,
  "background": "#fffaf0",
  "nodes": []
}

新生成节点仅允许四种：
1. text: {"id":"","sourceId":"source-0","type":"text","x":50,"y":0,"width":650,"height":100,"rotation":0,"opacity":1,"variant":"plain|banner|card|quote|sticky","fill":"#0a0a0a","background":"transparent","borderColor":"transparent","borderWidth":0,"radius":0,"padding":0,"fontSize":30,"fontWeight":400,"lineHeight":1.7,"align":"left"}
2. image: {"id":"","sourceId":"source-3","type":"image","x":0,"y":0,"width":650,"height":420,"rotation":0,"opacity":1,"fit":"cover","radius":8}
3. shape: {"id":"","type":"shape","x":0,"y":0,"width":300,"height":100,"rotation":0,"opacity":1,"shape":"rect|ellipse","fill":"#ffffff","stroke":"#000000","strokeWidth":0,"radius":8}
4. path: {"id":"","type":"path","x":0,"y":0,"width":180,"height":120,"rotation":0,"opacity":1,"d":"M 10 60 C 40 10 120 10 170 60","fill":"transparent","stroke":"#e8b94a","strokeWidth":5}

规则：
- 响应首字符必须是 {，末字符必须是 }，只输出一个完整 JSON 对象。
- 不得输出 Markdown 代码围栏、解释文字、注释、省略号或未闭合 JSON。
- 每个内容源必须且只能出现一次，text/image 节点必须填写对应 sourceId。
- text 节点不得输出 text，image 节点不得输出 src；系统会根据 sourceId 回填原文和图片。
- 节点按数组顺序从底到顶绘制；装饰节点不得遮挡正文。
- 这是可编辑的公众号自由画板，不是封面海报：默认宽度 750；模板明确要求数据看板时可使用 1280；高度按内容计算，可为 640-30000。
- 使用 12 栏网格组织内容。允许多卡片、双栏和对比布局，但所有内容必须位于画布边界内。
- 正文字号 14-28，标题 24-60；文本节点高度必须覆盖全部换行内容。
- 标题、章节、正文、引用、列表和图片必须完整出现。服务端会重新计算文字高度并移动发生物理碰撞的内容节点。
- 优先生成手帐采访风：奶油底色、浅蓝与浅橙内容面板、深灰细描边；章节用 banner，引用用 quote，列表用 card/sticky。
- 所有装饰必须由你根据文章主题原创为 path 节点，不得依赖预设图标名；可以组合多个 path 形成插画。
- path.d 只能使用标准 SVG 路径命令和数字，坐标必须落在节点 width/height 内，不得遮挡文字。
- 只用纯色，确保文字与背景对比清晰。
- 不输出 SVG 标签、HTML、脚本、CSS、事件或外部字体。
- 不得生成“在这里填写”“示例”“______”等占位内容。`

const BLOCK_SYSTEM_PROMPT = `你是微信公众号 HTML 内容块排版引擎。文章内容由系统提供，你只能设计样式和局部 SVG 装饰，绝对不能创作、改写、概括、合并、拆分或省略正文。

块文档 DSL：
{
  "version": 1,
  "name": "排版名称",
  "width": 677,
  "background": "#ffffff",
  "pageBackground": "#f4f1e8",
  "font": "system|serif|rounded",
  "blocks": []
}

blocks 仅允许三种：
1. content: {"id":"","type":"content","sourceId":"source-0","variant":"plain|title|banner|card|quote|highlight|image","background":"transparent","color":"#262626","accentColor":"#2f6f62","borderColor":"transparent","borderWidth":0,"radius":0,"padding":0,"marginTop":0,"marginBottom":22,"fontSize":17,"fontWeight":400,"lineHeight":1.9,"align":"left","imageFit":"cover|contain","imageRadius":6}
2. decoration: {"id":"","type":"decoration","anchorSourceId":"source-0","placement":"before|after","d":"M 0 20 C 60 0 120 40 180 20","viewBoxWidth":180,"viewBoxHeight":40,"width":150,"height":36,"align":"left|center|right","fill":"transparent","stroke":"#2f6f62","strokeWidth":3,"marginTop":4,"marginBottom":16}
3. section: {"id":"","type":"section","sourceIds":["source-1","source-2"],"layout":"stack|two-column|comparison|feature","background":"#ffffff","color":"#262626","accentColor":"#5263a5","borderColor":"#dee0e3","borderWidth":1,"radius":8,"padding":20,"gap":16,"marginTop":8,"marginBottom":24,"divider":true}

规则：
- 响应首字符必须是 {，末字符必须是 }，只输出一个完整 JSON 对象。
- 不得输出 Markdown 代码围栏、解释、注释、HTML、CSS、SVG 标签或外部资源地址。
- 每个内容源必须且只能出现一次：可以由 content.sourceId 单独引用，或由一个 section.sourceIds 组合引用，但不能同时出现。
- content 不得输出 text、src 或 alt；系统会从 sourceId 回填原文与图片。
- content 和 section 必须严格保持内容源原顺序，不得交换段落；section 只能组合 2-8 个连续 sourceId。
- 图片内容源只能使用 image 版式，其他内容源不得使用 image。
- 这是公众号长文，不是海报：保持连续纵向阅读、清晰层级、17-18px 正文、1.7-2.0 行高和克制留白。
- 必须使用 2-8 个 section 形成明显区别于 Markdown 的组合布局。短段落、对比主体或图片与说明优先使用 two-column/comparison/feature，长正文使用 stack。
- 卡片、标题条、引用、强调色需要围绕文章主题形成统一视觉语言，不要每段都做成独立卡片。
- 可以生成 2-8 个局部 decoration。装饰必须由你根据主题原创为 path，不得依赖预设图标名。
- decoration 必须通过 anchorSourceId 和 placement 锚定到正文附近，不得遮挡正文。
- path.d 只能使用标准 SVG Path 命令和数字，坐标必须在 viewBox 范围内。
- 只使用高对比纯色；不使用渐变、外部字体、脚本、事件和 URL。
- 不得生成“在这里填写”“示例”“______”等占位内容。`

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

function parseBlockFromCompletion(data: CanvasCompletionData): WechatBlockDocument {
  for (const candidate of completionCandidates(data)) {
    for (const value of balancedJsonObjects(candidate)) {
      const record = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
      for (const documentValue of [record.document, record.blocksDocument, value]) {
        try {
          const parsed = parseWechatBlockDocument(documentValue)
          if (parsed.blocks.length > 0) return parsed
        } catch {
          // 尝试同一响应中的下一个候选对象。
        }
      }
    }
  }
  throw new Error("AI 未返回可解析的公众号块 DSL")
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
  articleTitle: string
  sources: CanvasSource[]
  onRepair?: () => void
  onAttempt?: (_completion: CanvasCompletionData, _attempt: number) => void
}): Promise<{
  document: CanvasDocument
  completion: CanvasCompletionData
  attempts: CanvasCompletionData[]
  repaired: boolean
}> {
  const sourceManifest = JSON.stringify(input.sources.map(source => ({
    id: source.id,
    kind: source.kind,
    text: source.kind === "image" ? undefined : source.text,
    alt: source.kind === "image" ? source.alt : undefined,
  })))
  const messages = [
    { role: "system", content: CANVAS_SYSTEM_PROMPT },
    {
      role: "user",
      content: `排版偏好：${input.prompt}\n\n必须完整排版以下内容源，节点只能引用这些 sourceId：\n${sourceManifest}`,
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
      document: hydrateCanvasDocument(
        parseCanvasFromCompletion(first),
        input.sources,
        input.articleTitle,
        { layoutMode: "freeform" },
      ),
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
            : `上一轮没有返回可用正文。请根据排版偏好和内容源重新生成：\n偏好：${input.prompt}\n内容源：${sourceManifest}`,
        },
      ],
      temperature: 0,
      max_tokens: 8000,
      stream: false,
    }, input.headers, 2)
    input.onAttempt?.(repair, 2)
    return {
      document: hydrateCanvasDocument(
        parseCanvasFromCompletion(repair),
        input.sources,
        input.articleTitle,
        { layoutMode: "freeform" },
      ),
      completion: repair,
      attempts: [first, repair],
      repaired: true,
    }
  }
}

async function generateBlockWithRepair(input: {
  url: string
  model: string
  headers: Record<string, string>
  prompt: string
  articleTitle: string
  sources: CanvasSource[]
  templateId: CanvasDesignTemplateId
  onRepair?: () => void
}): Promise<{
  document: WechatBlockDocument
  attempts: CanvasCompletionData[]
}> {
  const sourceManifest = JSON.stringify(input.sources.map(source => ({
    id: source.id,
    kind: source.kind,
    text: source.kind === "image" ? undefined : source.text,
    alt: source.kind === "image" ? source.alt : undefined,
  })))
  const messages = [
    { role: "system", content: BLOCK_SYSTEM_PROMPT },
    {
      role: "user",
      content: `受控设计规范：${input.prompt}\n\n必须完整排版以下内容源，content 或 section 只能引用这些 sourceId：\n${sourceManifest}`,
    },
  ]
  const first = await callStructuredCanvas(input.url, {
    model: input.model,
    messages,
    temperature: 0.2,
    max_tokens: 8000,
    stream: false,
  }, input.headers)

  try {
    return {
      document: hydrateWechatBlockDocument(
        parseBlockFromCompletion(first),
        input.sources,
        input.articleTitle,
        { templateId: input.templateId },
      ),
      attempts: [first],
    }
  } catch {
    input.onRepair?.()
    const malformed = completionCandidates(first).join("\n").slice(0, 20000)
    const repair = await callStructuredCanvas(input.url, {
      model: input.model,
      messages: [
        {
          role: "system",
          content: `${BLOCK_SYSTEM_PROMPT}\n\n你现在是 JSON 修复器。只输出一个完整 JSON 对象，不要解释。`,
        },
        {
          role: "user",
          content: malformed
            ? `把下面的模型输出修复成合法公众号块 DSL：\n${malformed}`
            : `请根据排版偏好和内容源重新生成：\n偏好：${input.prompt}\n内容源：${sourceManifest}`,
        },
      ],
      temperature: 0,
      max_tokens: 8000,
      stream: false,
    }, input.headers, 2)
    return {
      document: hydrateWechatBlockDocument(
        parseBlockFromCompletion(repair),
        input.sources,
        input.articleTitle,
        { templateId: input.templateId },
      ),
      attempts: [first, repair],
    }
  }
}

router.post("/generate", async (req: AuthedRequest, res) => {
  const debugStartedAt = Date.now()
  const debugTraceId = `canvas-${debugStartedAt}-${Math.random().toString(36).slice(2, 8)}`
  const prompt = buildCanvasDesignBrief({
    templateId: req.body?.templateId,
    userPrompt: String(req.body?.prompt || "排版为清晰耐读的公众号长图").slice(0, PROMPT_MAX_LENGTH),
    designReference: req.body?.designReference,
  })
  const sources = parseCanvasSources(req.body?.sources)
  // #region debug-point A:request-entry
  if (process.env.DEBUG_SERVER_URL) void fetch(process.env.DEBUG_SERVER_URL, { method: "POST", body: JSON.stringify({ sessionId: "canvas-gateway-timeout", runId: process.env.DEBUG_RUN_ID || "pre-fix", hypothesisId: "A", traceId: debugTraceId, location: "server/routes/canvas.ts:request-entry", msg: "[DEBUG] Canvas request entered Node route", data: { promptLength: prompt.length, sourceCount: sources.length }, ts: Date.now() }) }).catch(() => {})
  // #endregion
  if (sources.length === 0) {
    res.status(400).json({ error: "请先选择一篇包含正文的公众号文章" })
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

  const articleTitle = sources.find(source => source.kind === "title")?.text || "公众号长图"

  try {
    const { url, model, headers } = buildLLMRequest(aiConfig)
    // #region debug-point BCD:before-upstream
    if (process.env.DEBUG_SERVER_URL) void fetch(process.env.DEBUG_SERVER_URL, { method: "POST", body: JSON.stringify({ sessionId: "canvas-gateway-timeout", runId: process.env.DEBUG_RUN_ID || "pre-fix", hypothesisId: "B,C,D", traceId: debugTraceId, location: "server/routes/canvas.ts:before-upstream", msg: "[DEBUG] Canvas upstream request starting", data: { elapsedMs: Date.now() - debugStartedAt, provider: aiConfig.articleProvider, model, sourceCount: sources.length, maxTokens: 8000 }, ts: Date.now() }) }).catch(() => {})
    // #endregion
    const generated = await generateCanvasWithRepair({
      url,
      model,
      headers,
      prompt,
      articleTitle,
      sources,
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
  const prompt = buildCanvasDesignBrief({
    templateId: req.body?.templateId,
    userPrompt: String(req.body?.prompt || "排版为清晰耐读的公众号长图").slice(0, PROMPT_MAX_LENGTH),
    designReference: req.body?.designReference,
  })
  const sources = parseCanvasSources(req.body?.sources)
  if (sources.length === 0) {
    res.status(400).json({ error: "请先选择一篇包含正文的公众号文章" })
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

  const articleTitle = sources.find(source => source.kind === "title")?.text || "公众号长图"

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
  if (process.env.DEBUG_SERVER_URL) void fetch(process.env.DEBUG_SERVER_URL, { method: "POST", body: JSON.stringify({ sessionId: "canvas-gateway-timeout", runId: process.env.DEBUG_RUN_ID || "post-fix", hypothesisId: "B", traceId: debugTraceId, location: "server/routes/canvas.ts:stream-open", msg: "[DEBUG] Canvas SSE stream opened", data: { elapsedMs: Date.now() - debugStartedAt, promptLength: prompt.length, sourceCount: sources.length }, ts: Date.now() }) }).catch(() => {})
  // #endregion

  try {
    const { url, model, headers } = buildLLMRequest(aiConfig)
    const generated = await generateCanvasWithRepair({
      url,
      model,
      headers,
      prompt,
      articleTitle,
      sources,
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

router.post("/generate-block/stream", async (req: AuthedRequest, res) => {
  const startedAt = Date.now()
  const templateId = normalizeCanvasDesignTemplateId(req.body?.templateId)
  const prompt = buildCanvasDesignBrief({
    templateId,
    userPrompt: String(req.body?.prompt || "排版为清晰耐读的公众号文章").slice(0, PROMPT_MAX_LENGTH),
    designReference: req.body?.designReference,
  })
  const sources = parseCanvasSources(req.body?.sources)
  if (sources.length === 0) {
    res.status(400).json({ error: "请先选择一篇包含正文的公众号文章" })
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

  const articleTitle = sources.find(source => source.kind === "title")?.text || "公众号块排版"
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.setHeader("X-Accel-Buffering", "no")
  res.flushHeaders()

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  send("progress", { message: "正在生成 HTML 块结构..." })
  const heartbeat = setInterval(() => send("heartbeat", { elapsedMs: Date.now() - startedAt }), 15000)

  try {
    const { url, model, headers } = buildLLMRequest(aiConfig)
    const generated = await generateBlockWithRepair({
      url,
      model,
      headers,
      prompt,
      articleTitle,
      sources,
      templateId,
      onRepair: () => send("progress", { message: "正在修复块排版结构..." }),
    })
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
    send("result", { document: generated.document })
    send("done", {})
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "AI 生成块排版失败"
    send("error", { message })
    logger.error("CANVAS", "AI 流式生成块排版失败", {
      error: message,
      userId: req.user?.id,
    })
  } finally {
    clearInterval(heartbeat)
    if (!res.writableEnded) res.end()
  }
})

export default router
