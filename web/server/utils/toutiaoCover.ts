import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"
import { UPLOAD_DIR } from "../config.ts"
import { fetchPublicUrl } from "./networkPolicy.ts"

const MAX_COVER_BYTES = 20 * 1024 * 1024

export async function readToutiaoCoverImage(imageUrl: string, baseOrigin: string): Promise<Buffer> {
  if (imageUrl.startsWith("data:image/")) {
    const matched = imageUrl.match(/^data:image\/[\w.+-]+;base64,([\s\S]+)$/)
    if (!matched) throw new Error("封面 Data URL 格式不正确")
    const buffer = Buffer.from(matched[1], "base64")
    if (buffer.length > MAX_COVER_BYTES) throw new Error("封面图片超过 20MB 限制")
    return buffer
  }

  const url = new URL(imageUrl, baseOrigin)
  const baseUrl = new URL(baseOrigin)
  if (url.origin === baseUrl.origin && url.pathname.startsWith("/api/images/uploads/")) {
    const buffer = fs.readFileSync(path.join(UPLOAD_DIR, path.basename(url.pathname)))
    if (buffer.length > MAX_COVER_BYTES) throw new Error("封面图片超过 20MB 限制")
    return buffer
  }

  const response = await fetchPublicUrl(url.toString(), { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`下载封面失败: HTTP ${response.status}`)
  const declaredLength = Number(response.headers.get("content-length") || 0)
  if (declaredLength > MAX_COVER_BYTES) throw new Error("封面图片超过 20MB 限制")
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_COVER_BYTES) throw new Error("封面图片超过 20MB 限制")
  return buffer
}

export async function prepareToutiaoCoverFile(imageUrl: string, baseOrigin: string): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `tt_cover_${Date.now()}.jpg`)
  const source = await readToutiaoCoverImage(imageUrl, baseOrigin)
  await sharp(source).rotate().jpeg({ quality: 90 }).toFile(tmpPath)
  return tmpPath
}
