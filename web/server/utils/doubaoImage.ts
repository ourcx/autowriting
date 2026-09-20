import axios from "axios"
import { SERVER_AI_CONFIG } from "../config.js"

interface DoubaoImageResponse {
  data?: Array<{
    url?: string
    b64_json?: string
    output_format?: string
  }>
}

export function buildDoubaoImageRequest(prompt: string, model: string) {
  return {
    model,
    prompt,
    size: "2048x1152",
    response_format: "b64_json",
  }
}

export function parseDoubaoImageResponse(data: DoubaoImageResponse): string {
  const image = data.data?.[0]
  if (image?.b64_json) {
    const format = image.output_format === "jpeg" ? "jpeg" : "png"
    return `data:image/${format};base64,${image.b64_json}`
  }
  if (image?.url) return image.url
  throw new Error("豆包图片生成接口未返回图片")
}

export async function generateWithDoubao(
  prompt: string,
  apiKey: string,
  model: string,
  baseUrl: string,
): Promise<string> {
  const key = apiKey || (SERVER_AI_CONFIG.doubaoApiKey as string)
  const modelId = model || (SERVER_AI_CONFIG.doubaoModel as string)
  const endpoint = (baseUrl || SERVER_AI_CONFIG.doubaoBaseUrl as string).replace(/\/+$/, "")
  if (!key) throw new Error("豆包方舟 API Key 未配置。请前往「AI 配置」页面设置。")
  if (!modelId) throw new Error("豆包图片模型或推理接入点 ID 未配置。请前往「AI 配置」页面设置。")

  const response = await axios.post<DoubaoImageResponse>(
    `${endpoint}/images/generations`,
    buildDoubaoImageRequest(prompt, modelId),
    {
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      timeout: 120000,
    },
  )
  return parseDoubaoImageResponse(response.data)
}
