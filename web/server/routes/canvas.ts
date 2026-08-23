import { Router } from "express"
import { authMiddleware } from "../authMiddleware.ts"
import { SERVER_AI_CONFIG } from "../config.ts"
import { recordTokenUsage } from "../db.ts"
import { logger } from "../logger.ts"
import type { AIConfig, AuthedRequest } from "../types.ts"
import { buildLLMRequest, callLLMWithRetry } from "../utils/index.ts"
import { parseCanvasDocument } from "../../shared/canvasDsl.ts"

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
- 节点按数组顺序从底到顶绘制，最多 40 个。
- 画布宽度建议 750，高度 750-1800。
- 多图海报使用 2-5 个 image 节点；没有用户图片 URL 时可以省略图片节点，不得编造 URL。
- 只用纯色，确保文字与背景对比清晰。
- 不输出任意 SVG、HTML、脚本、CSS、事件或外部字体。
- 文本忠于用户提供的信息，不虚构数据、姓名和结论。`

function extractJson(output: string): unknown {
  const cleaned = output
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
  const json = cleaned.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error("AI 未返回有效画布 JSON")
  return JSON.parse(json)
}

router.post("/generate", async (req: AuthedRequest, res) => {
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

  try {
    const { url, model, headers } = buildLLMRequest(aiConfig)
    const response = await callLLMWithRetry(url, {
      model,
      messages: [
        { role: "system", content: CANVAS_SYSTEM_PROMPT },
        {
          role: "user",
          content: `${prompt}${currentDocument ? `\n\n在当前画布基础上修改：\n${currentDocument}` : ""}`,
        },
      ],
      temperature: 0.65,
      max_tokens: 4000,
      stream: false,
    }, headers)

    const data = response.data as typeof response.data & {
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
      }
    }
    const output = data.choices[0]?.message?.content ?? ""
    const document = parseCanvasDocument(extractJson(output))
    if (data.usage) {
      recordTokenUsage({
        userId: req.user?.id,
        operation: "generate",
        model,
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      })
    }
    res.json({ document })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "AI 生成画布失败"
    logger.error("CANVAS", "AI 生成画布失败", { error: message, userId: req.user?.id })
    res.status(500).json({ error: message })
  }
})

export default router
