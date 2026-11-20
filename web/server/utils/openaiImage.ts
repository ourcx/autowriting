import sharp from "sharp"
import { browserModelJson, inBrowserModelSession } from "../browserModel.ts"
import { OPENAI_IMAGE_ENDPOINT } from "../../shared/browserModel.ts"
import type { AIConfig } from "../types.ts"

/** 官方图片请求由正在生成文章的浏览器执行，沿用现有浏览器模型连接。 */
export async function generateOfficialImage(prompt: string, config: AIConfig, signal?: AbortSignal, cover = false): Promise<Buffer> {
  if (!inBrowserModelSession()) throw new Error("官方 GPT Image 需要保持生成页面打开，并配置浏览器中的 OpenAI Key")
  const model = String(config.openaiImageModel || "gpt-image-2").trim()
  if (!/^gpt-image-[a-z0-9.-]+$/i.test(model)) throw new Error("请填写官方 GPT Image 模型 ID")
  const data = await browserModelJson<{ data?: Array<{ b64_json?: string }>; error?: { message?: string } }>(
    OPENAI_IMAGE_ENDPOINT,
    { model, prompt, n: 1, size: "1536x1024", quality: "medium", output_format: "jpeg" },
    240_000, signal,
  )
  const encoded = data.data?.[0]?.b64_json
  if (!encoded) throw new Error("OpenAI 官方图片接口未返回图片")
  signal?.throwIfAborted()
  const image = sharp(Buffer.from(encoded, "base64"), { limitInputPixels: 40_000_000 })
  return (cover ? image.resize(1410, 600, { fit: "cover" }) : image.resize({ width: 1600, withoutEnlargement: true }))
    .jpeg({ quality: 90 }).toBuffer()
}
