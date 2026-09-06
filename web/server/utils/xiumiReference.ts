import { request } from 'node:https'
import { resolve4 } from 'node:dns/promises'
import { BlockList } from 'node:net'
import { gunzipSync } from 'node:zlib'

const blocked = new BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) blocked.addSubnet(address, prefix)

export function validateXiumiUrl(value: unknown, data = false): URL {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('请输入秀米公开分享链接')
  const url = new URL(value)
  const allowed = data
    ? /^sd\.(xiumi\.us|xiumius\.cn)$/.test(url.hostname) && /^\/xmi\/pd\/[a-zA-Z0-9/_-]+\.json$/.test(url.pathname)
    : /^[a-z]\.(xiumi\.us|xiumius\.cn)$/.test(url.hostname) && /^\/board\/v5\/[a-zA-Z0-9_-]+\/\d+$/.test(url.pathname)
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password) throw new Error('仅支持 HTTPS 秀米公开分享链接（board/v5），不支持编辑器或登录页面')
  url.hash = ''
  if (!data) url.search = ''
  return url
}

// DNS 校验后固定连接 IP；重定向逐跳重新验证，不携带用户 Cookie 或密钥。
async function readPublic(url: URL, data: boolean, redirects = 0): Promise<string> {
  const addresses = await resolve4(url.hostname)
  if (!addresses.length || addresses.some(address => blocked.check(address))) throw new Error('链接解析到了不允许访问的地址')
  return new Promise((resolve, reject) => {
    const req = request(url, { family: 4, autoSelectFamily: false,
      lookup: (_hostname, _options, callback) => callback(null, addresses[0], 4),
      headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'Autowriting-Template-Preview/1.0' } }, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        response.resume()
        try {
          if (redirects >= 3 || !response.headers.location) throw new Error('分享链接重定向异常')
          const next = validateXiumiUrl(new URL(response.headers.location, url).href, data)
          readPublic(next, data, redirects + 1).then(resolve, reject)
        } catch (error) { reject(error) }
        return
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error('分享页不可访问，可能已过期或需要登录')); return }
      const chunks: Buffer[] = []
      let bytes = 0
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 2 * 1024 * 1024) { req.destroy(new Error('模板数据过大')); return }
        chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks)
          resolve((buffer[0] === 31 && buffer[1] === 139 ? gunzipSync(buffer, { maxOutputLength: 4 * 1024 * 1024 }) : buffer).toString('utf8'))
        } catch { reject(new Error('模板数据无法解析')) }
      })
    })
    const timeout = setTimeout(() => req.destroy(new Error('读取秀米链接超时，请稍后重试')), 12000)
    req.on('close', () => clearTimeout(timeout))
    req.on('error', reject)
    req.end()
  })
}

export function extractXiumiStyles(value: unknown): Record<string, string>[] {
  const styles: Record<string, string>[] = []
  let visited = 0
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 24 || ++visited > 5000 || styles.length >= 100) return
    const record = node as Record<string, unknown>
    const candidates: Record<string, unknown>[] = []
    if (record.style && typeof record.style === 'object') candidates.push(record.style as Record<string, unknown>)
    // 部分公开页把设计保存在 HTML 缓存中，只读取 style 属性，不执行 HTML。
    if (typeof record._$raHTML === 'string') {
      for (const match of record._$raHTML.slice(0, 500000).matchAll(/style="([^"<>]*)"/g)) {
        candidates.push(Object.fromEntries(match[1].split(';').flatMap(declaration => {
          const colon = declaration.indexOf(':')
          if (colon < 0) return []
          const key = declaration.slice(0, colon).trim().replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
          return [[key, declaration.slice(colon + 1).trim()]]
        })))
        if (candidates.length >= 500) break
      }
    }
    for (const raw of candidates) {
      const style = Object.fromEntries(Object.entries(raw).filter(([key, val]) =>
        /^(backgroundColor|color|fontSize|fontWeight|lineHeight|letterSpacing|padding|margin|borderRadius|borderWidth|borderColor|textAlign|width|display|flexDirection)$/.test(key)
        && typeof val === 'string' && val.length < 100 && !/[<>"'\\]|url\s*\(/i.test(val)))
      if (Object.keys(style).length && !styles.some(item => JSON.stringify(item) === JSON.stringify(style))) styles.push(style)
      if (styles.length >= 100) break
    }
    // 只读取结构化样式，不执行脚本，也不传递原文、图片地址或嵌入 HTML。
    for (const [key, child] of Object.entries(record)) if (!key.startsWith('_$') && typeof child === 'object') walk(child, depth + 1)
  }
  walk(value, 0)
  return styles
}

export async function readXiumiReference(value: unknown) {
  const url = validateXiumiUrl(value)
  const html = await readPublic(url, false)
  const encoded = html.match(/injectedData\.showInfo\s*=\s*JSON\.parse\(decodeURIComponent\("([^"\n]+)"\)\)/)?.[1]
  if (!encoded) throw new Error('未找到公开排版数据，请使用已发布的分享链接')
  const info = JSON.parse(decodeURIComponent(encoded)) as Record<string, unknown>
  if (info.is_release !== true) throw new Error('暂不支持临时预览，请使用公开分享链接')
  const dataUrl = validateXiumiUrl(new URL(String(info.show_data_url), url).href, true)
  const styles = extractXiumiStyles(JSON.parse(await readPublic(dataUrl, true)))
  if (!styles.length) throw new Error('没有可转换的样式数据，暂不支持此模板结构')
  return { title: typeof info.title === 'string' ? info.title.slice(0, 100) : '秀米模板',
    reference: JSON.stringify({ source: url.href, styles, instruction: '仅参考这些容器、字体与配色，将当前文章组成可编辑 DSL；不复用原文或远程图片。' }),
    styleCount: styles.length }
}
