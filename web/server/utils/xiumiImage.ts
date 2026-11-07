import axios from 'axios'
import sharp from 'sharp'
import { assertPublicHttpUrl } from './networkPolicy.ts'

export function parseXiumiImageUrl(value: unknown): URL {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('秀米图片地址无效')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.port || url.username || url.password
    || !/(^|\.)(xiumi\.us|xiumius\.cn)$/.test(url.hostname)) {
    throw new Error('仅支持 HTTPS 秀米图片地址')
  }
  return url
}

// 只下载秀米图片，不携带登录信息、不跟随跳转；保存复用现有图片上传接口。
export async function readXiumiImage(url: URL) {
  await assertPublicHttpUrl(url.href)
  const response = await axios.get<ArrayBuffer>(url.href, {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxContentLength: 20_971_520,
    maxRedirects: 0,
  })
  const data = Buffer.from(response.data)
  const { format } = await sharp(data, { limitInputPixels: 40_000_000 }).metadata()
  if (!format || !['jpeg', 'png', 'gif', 'webp', 'avif'].includes(format)) {
    throw new Error('秀米素材不是支持的图片格式')
  }
  return { data, contentType: `image/${format}` }
}
