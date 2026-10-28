import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import path from 'path'
import axios from 'axios'

const ALLOWED_WECHAT_IMAGE_HOSTS = ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn', 'wx.qlogo.cn']
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_MEMORY_LIMIT = 100
const MAX_IMAGE_BYTES = 15 * 1024 * 1024

export type WechatImageCacheStatus = 'MEMORY' | 'DISK' | 'MISS'

export interface WechatImageResult {
  data: Buffer
  contentType: string
  cacheStatus: WechatImageCacheStatus
}

interface CacheMetadata {
  contentType: string
  storedAt: number
}

interface MemoryEntry {
  data: Buffer
  contentType: string
  expiresAt: number
}

interface FetchResult {
  data: Buffer
  contentType: string
}

interface CreateWechatImageCacheOptions {
  cacheDir: string
  ttlMs?: number
  memoryLimit?: number
  now?: () => number
  fetcher?: (_url: string) => Promise<FetchResult>
  onCacheError?: (_operation: 'read' | 'write', _error: unknown, _cacheKey: string) => void
}

export class WechatImageUrlError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'WechatImageUrlError'
    this.status = status
  }
}

export function parseWechatImageUrl(rawUrl: unknown): URL {
  if (typeof rawUrl !== 'string' || !rawUrl) {
    throw new WechatImageUrlError('Missing url', 400)
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new WechatImageUrlError('Invalid url', 400)
  }

  const allowedHost = ALLOWED_WECHAT_IMAGE_HOSTS.some(host => (
    parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
  ))
  if (parsed.protocol !== 'https:' || !allowedHost) {
    throw new WechatImageUrlError('Image source not allowed', 403)
  }
  return parsed
}

async function fetchWechatImage(url: string): Promise<FetchResult> {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 8000,
    maxRedirects: 0,
    maxContentLength: MAX_IMAGE_BYTES,
    maxBodyLength: MAX_IMAGE_BYTES,
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
      'User-Agent': 'Mozilla/5.0 (compatible; WechatProxy/1.0)',
    },
  })
  const contentType = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  if (!contentType.startsWith('image/')) {
    throw new Error(`Upstream did not return an image: ${contentType || 'unknown'}`)
  }
  return { data: Buffer.from(response.data), contentType }
}

export function createWechatImageCache(options: CreateWechatImageCacheOptions) {
  const cacheDir = options.cacheDir
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const memoryLimit = options.memoryLimit ?? DEFAULT_MEMORY_LIMIT
  const now = options.now ?? Date.now
  const fetcher = options.fetcher ?? fetchWechatImage
  const onCacheError = options.onCacheError ?? (() => undefined)
  const memoryCache = new Map<string, MemoryEntry>()
  const inFlight = new Map<string, Promise<WechatImageResult>>()

  const remember = (key: string, entry: MemoryEntry) => {
    memoryCache.delete(key)
    memoryCache.set(key, entry)
    while (memoryCache.size > memoryLimit) {
      const oldestKey = memoryCache.keys().next().value
      if (typeof oldestKey !== 'string') break
      memoryCache.delete(oldestKey)
    }
  }

  const readDisk = async (key: string): Promise<WechatImageResult | null> => {
    const metadataPath = path.join(cacheDir, `${key}.json`)
    const dataPath = path.join(cacheDir, `${key}.bin`)
    try {
      const [metadataRaw, data] = await Promise.all([
        readFile(metadataPath, 'utf8'),
        readFile(dataPath),
      ])
      const metadata = JSON.parse(metadataRaw) as CacheMetadata
      if (
        typeof metadata.storedAt !== 'number'
        || typeof metadata.contentType !== 'string'
        || !metadata.contentType.startsWith('image/')
        || now() - metadata.storedAt >= ttlMs
      ) {
        return null
      }
      remember(key, {
        data,
        contentType: metadata.contentType,
        expiresAt: metadata.storedAt + ttlMs,
      })
      return { data, contentType: metadata.contentType, cacheStatus: 'DISK' }
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : ''
      if (code !== 'ENOENT') {
        onCacheError('read', error, key)
      }
      return null
    }
  }

  const writeDisk = async (key: string, result: FetchResult, storedAt: number) => {
    await mkdir(cacheDir, { recursive: true })
    const suffix = `${process.pid}-${randomUUID()}`
    const dataPath = path.join(cacheDir, `${key}.bin`)
    const metadataPath = path.join(cacheDir, `${key}.json`)
    const tempDataPath = `${dataPath}.${suffix}.tmp`
    const tempMetadataPath = `${metadataPath}.${suffix}.tmp`
    await Promise.all([
      writeFile(tempDataPath, result.data),
      writeFile(tempMetadataPath, JSON.stringify({
        contentType: result.contentType,
        storedAt,
      } satisfies CacheMetadata)),
    ])
    await rename(tempDataPath, dataPath)
    await rename(tempMetadataPath, metadataPath)
  }

  const load = async (url: string): Promise<WechatImageResult> => {
    const key = createHash('sha256').update(url).digest('hex')
    const memoryEntry = memoryCache.get(key)
    if (memoryEntry && memoryEntry.expiresAt > now()) {
      remember(key, memoryEntry)
      return {
        data: memoryEntry.data,
        contentType: memoryEntry.contentType,
        cacheStatus: 'MEMORY',
      }
    }
    if (memoryEntry) memoryCache.delete(key)

    const pending = inFlight.get(key)
    if (pending) return pending

    const request = (async () => {
      const diskResult = await readDisk(key)
      if (diskResult) return diskResult

      const fetched = await fetcher(url)
      if (!fetched.contentType.startsWith('image/')) {
        throw new Error(`Upstream did not return an image: ${fetched.contentType || 'unknown'}`)
      }
      const storedAt = now()
      remember(key, {
        data: fetched.data,
        contentType: fetched.contentType,
        expiresAt: storedAt + ttlMs,
      })
      try {
        await writeDisk(key, fetched, storedAt)
      } catch (error) {
        onCacheError('write', error, key)
      }
      return { ...fetched, cacheStatus: 'MISS' as const }
    })()

    inFlight.set(key, request)
    try {
      return await request
    } finally {
      inFlight.delete(key)
    }
  }

  return { load }
}
