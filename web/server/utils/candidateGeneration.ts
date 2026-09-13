import axios from "axios"
import type { Response } from "express"
import { SERVER_AI_CONFIG, getWritingGuideContent } from "../config.ts"
import { getEffectivePrompt, getSetting, recordTokenUsage } from "../db.ts"
import { formatCreatorProfileForPrompt, normalizeCreatorWritingProfile } from "../../shared/contentProduction.ts"
import { acquireCandidate, CandidateError, publicCandidate, readCandidate, saveCandidate } from "../generationCandidates.ts"
import { buildLLMRequest } from "./public.ts"
import { consumeOpenAiContentStream } from "./openAiStream.ts"
import { startSseHeartbeat } from "../sseHeartbeat.ts"
import { logger } from "../logger.ts"
import type { AIConfig } from "../types.ts"
import { formatExampleContext } from "../rag.ts"

export async function streamCandidate(userId: string, articleId: string, id: string, rawConfig: unknown, response: Response): Promise<void> {
  const candidate = readCandidate(userId, articleId, id)
  if (candidate.status === "complete") throw new CandidateError("候选稿已完成，无需重复生成", 409)
  if (rawConfig !== undefined && (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig))) throw new CandidateError("AI 配置不正确")
  const config: AIConfig = { ...SERVER_AI_CONFIG, ...rawConfig as AIConfig }
  if (!(config.articleProvider === "maas" ? config.maasApiKey : config.articleApiKey)) throw new CandidateError("请先配置 AI API Key")
  const release = acquireCandidate(userId, id)
  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), 600000)
  const disconnected = () => { if (!response.writableEnded) controller.abort() }
  response.once("close", disconnected)
  const send = (event: string, data: object) => {
    if (!response.destroyed && !response.writableEnded) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  let lastSaved = 0
  const initialLength = candidate.content.length
  const checkpoint = () => {
    candidate.updatedAt = new Date().toISOString()
    saveCandidate(userId, articleId, candidate)
    lastSaved = Date.now()
  }
  try {
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8")
    response.setHeader("Cache-Control", "no-cache")
    response.setHeader("Connection", "keep-alive")
    response.setHeader("X-Accel-Buffering", "no")
    response.flushHeaders()
    startSseHeartbeat(response)
    candidate.status = "generating"
    delete candidate.finishedAt
    candidate.message = candidate.content ? "继续生成" : "等待模型输出"
    checkpoint()
    send("candidate", { candidate: publicCandidate(candidate) })
    const { input } = candidate
    const profile = formatCreatorProfileForPrompt(normalizeCreatorWritingProfile(getSetting(`creator_writing_profile:${userId}`)))
    const examples = await formatExampleContext(userId).catch(() => "")
    const memory = getSetting("global_memory")
    const promptId = input.platform === "wechat" ? "prompt-article-generate" : "prompt-article-generate-toutiao"
    const instruction = getEffectivePrompt(promptId)?.content || "你是专业的文章创作者。"
    const prompt = `${getWritingGuideContent()}\n${profile}\n${examples}
${typeof memory === "string" && memory ? `# 全局背景信息\n${memory}` : ""}
# 本次任务
${input.task}
# 素材
${input.materials}
# 往期风格参考
${input.selectedRagContext}
${input.platform === "toutiao" ? `# 公众号事实与观点母稿\n${input.sourceArticle}` : ""}
# 写作要求
当前日期：${new Date().toISOString().slice(0, 10)}。
${candidate.label}，独立组织开头和结构，严格依据素材，不新增未经支持的事实。
直接输出完整 Markdown 文章，只有一个 H1。不要 emoji、表情包或装饰性表情符号。正文必须有完整结尾。
${input.platform === "toutiao" ? "按今日头条阅读节奏改写母稿，不改变事实。" : ""}`
    const { url, model, headers } = buildLLMRequest(config)
    candidate.model = model
    const messages = [
      { role: "system", content: instruction + "\n本次任务优先：不要 emoji 或表情包。" },
      { role: "user", content: prompt },
      ...(candidate.content ? [
        { role: "assistant", content: candidate.content },
        { role: "user", content: "上次输出中断。只从最后一个字符之后续写剩余正文，不重复已有内容，不重写标题，不加续写说明，完成结尾。" },
      ] : []),
    ]
    const upstream = await axios.post(url, { model, messages, temperature: 0.85, max_tokens: 8192, stream: true }, {
      headers, responseType: "stream", timeout: 120000, signal: controller.signal,
    })
    await consumeOpenAiContentStream(upstream.data, text => {
      if (candidate.content.length + text.length > 100000) throw new Error("候选稿超过长度限制，请缩短任务")
      candidate.firstChunkAt ||= new Date().toISOString()
      candidate.content += text
      if (Date.now() - lastSaved >= 1000) checkpoint()
      send("chunk", { text })
    }, { requireCompletion: true })
    candidate.status = "complete"
    candidate.message = "生成完成"
    candidate.finishedAt = new Date().toISOString()
    checkpoint()
    send("done", { candidate: publicCandidate(candidate) })
  } catch (error) {
    candidate.status = "interrupted"
    candidate.finishedAt = new Date().toISOString()
    candidate.message = controller.signal.aborted ? "生成已停止，已保留内容，可继续生成"
      : axios.isAxiosError(error) ? `模型请求失败${error.response?.status ? `（HTTP ${error.response.status}）` : "或连接超时"}，已保留内容`
        : error instanceof Error ? error.message : "生成失败，已保留内容"
    try { checkpoint() } catch {
      candidate.message += "；候选稿保存失败，请先复制正文"
    }
    logger.warn("GENERATION", "候选稿中断", { articleId, candidateId: id, characters: candidate.content.length })
    send("error", { candidate: publicCandidate(candidate), message: candidate.message })
  } finally {
    if (candidate.content.length > initialLength && candidate.model) {
      try {
        recordTokenUsage({ articleId, userId, operation: "generate", model: candidate.model, outputTokens: Math.ceil((candidate.content.length - initialLength) / 1.5) })
      } catch { logger.warn("GENERATION", "候选稿用量记录失败", { articleId, candidateId: id }) }
    }
    clearTimeout(deadline)
    response.off("close", disconnected)
    release()
    response.end()
  }
}
