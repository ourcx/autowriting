import { createHash, randomUUID } from 'crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'fs/promises'
import path from 'path'
import axios from 'axios'

const ALLOWED_WECHAT_IMAGE_HOSTS = ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn', 'wx.qlogo.cn']
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_TTL_JITTER_RATIO = 0.2
const DEFAULT_MEMORY_LIMIT = 100
const DEFAULT_MAX_DISK_BYTES = 1024 * 1024 * 1024
const DEFAULT_CLEANUP_MIN_INTERVAL_MS = 60 * 60 * 1000
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const CACHE_KEY_PATTERN = /^[a-f0-9]{64}$/

export type WechatImageCacheStatus = 'MEMORY' | 'DISK' | 'MISS'

export interface WechatImageResult {
  data: Buffer
  contentType: string
  cacheStatus: WechatImageCacheStatus
}

interface CacheMetadata {
  contentType: string
  storedAt: number
  expiresAt?: number
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
  ttlJitterRatio?: number
  memoryLimit?: number
  maxDiskBytes?: number
  cleanupMinIntervalMs?: number
  now?: () => number
  random?: () => number
  fetcher?: (_url: string) => Promise<FetchResult>
  onCacheError?: (_operation: 'read' | 'write' | 'cleanup', _error: unknown, _cacheKey: string) => void
}

interface DiskCacheEntry {
  key: string
  dataPath: string
  metadataPath: string
  storedAt: number
  expiresAt: number
  totalBytes: number
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
  const ttlJitterRatio = Math.min(0.9, Math.max(0, options.ttlJitterRatio ?? DEFAULT_TTL_JITTER_RATIO))
  const memoryLimit = options.memoryLimit ?? DEFAULT_MEMORY_LIMIT
  const maxDiskBytes = options.maxDiskBytes ?? DEFAULT_MAX_DISK_BYTES
  const cleanupMinIntervalMs = options.cleanupMinIntervalMs ?? DEFAULT_CLEANUP_MIN_INTERVAL_MS
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const fetcher = options.fetcher ?? fetchWechatImage
  const onCacheError = options.onCacheError ?? (() => undefined)
  const memoryCache = new Map<string, MemoryEntry>()
  const inFlight = new Map<string, Promise<WechatImageResult>>()
  let lastCleanupAt = Number.NEGATIVE_INFINITY
  let cleanupPromise: Promise<void> | null = null

  const resolveExpiresAt = (metadata: CacheMetadata) => (
    typeof metadata.expiresAt === 'number' ? metadata.expiresAt : metadata.storedAt + ttlMs
  )

  const createExpiresAt = (storedAt: number) => {
    const normalizedRandom = Math.min(1, Math.max(0, random()))
    const ttlFactor = 1 - ttlJitterRatio + normalizedRandom * ttlJitterRatio * 2
    return storedAt + Math.round(ttlMs * ttlFactor)
  }

  const removeDiskEntry = async (entry: Pick<DiskCacheEntry, 'key' | 'dataPath' | 'metadataPath'>) => {
    const results = await Promise.allSettled([
      unlink(entry.dataPath),
      unlink(entry.metadataPath),
    ])
    for (const result of results) {
      if (result.status === 'rejected') {
        const code = result.reason instanceof Error && 'code' in result.reason
          ? String(result.reason.code)
          : ''
        if (code !== 'ENOENT') onCacheError('cleanup', result.reason, entry.key)
      }
    }
    memoryCache.delete(entry.key)
  }

  const runCleanup = async () => {
    let files
    try {
      files = await readdir(cacheDir, { withFileTypes: true })
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : ''
      if (code !== 'ENOENT') onCacheError('cleanup', error, '')
      return
    }

    const entries: DiskCacheEntry[] = []
    const metadataKeys = new Set<string>()
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.json')) continue
      const key = file.name.slice(0, -5)
      if (!CACHE_KEY_PATTERN.test(key)) continue
      metadataKeys.add(key)

      const metadataPath = path.join(cacheDir, file.name)
      const dataPath = path.join(cacheDir, `${key}.bin`)
      try {
        const [metadataRaw, dataStats, metadataStats] = await Promise.all([
          readFile(metadataPath, 'utf8'),
          stat(dataPath),
          stat(metadataPath),
        ])
        const metadata = JSON.parse(metadataRaw) as CacheMetadata
        const expiresAt = resolveExpiresAt(metadata)
        if (
          typeof metadata.storedAt !== 'number'
          || typeof metadata.contentType !== 'string'
          || !metadata.contentType.startsWith('image/')
          || !Number.isFinite(expiresAt)
        ) {
          await removeDiskEntry({ key, dataPath, metadataPath })
          continue
        }
        const entry = {
          key,
          dataPath,
          metadataPath,
          storedAt: metadata.storedAt,
          expiresAt,
          totalBytes: dataStats.size + metadataStats.size,
        }
        if (expiresAt <= now() && !inFlight.has(key)) {
          await removeDiskEntry(entry)
          continue
        }
        entries.push(entry)
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? String(error.code) : ''
        if (code !== 'ENOENT') onCacheError('cleanup', error, key)
        if (!inFlight.has(key)) await removeDiskEntry({ key, dataPath, metadataPath })
      }
    }

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.bin')) continue
      const key = file.name.slice(0, -4)
      if (!CACHE_KEY_PATTERN.test(key) || metadataKeys.has(key) || inFlight.has(key)) continue
      await removeDiskEntry({
        key,
        dataPath: path.join(cacheDir, file.name),
        metadataPath: path.join(cacheDir, `${key}.json`),
      })
    }

    let totalBytes = entries.reduce((sum, entry) => sum + entry.totalBytes, 0)
    if (totalBytes <= maxDiskBytes) return

    entries.sort((left, right) => left.storedAt - right.storedAt)
    for (const entry of entries) {
      if (totalBytes <= maxDiskBytes) break
      if (inFlight.has(entry.key)) continue
      await removeDiskEntry(entry)
      totalBytes -= entry.totalBytes
    }
  }

  const scheduleCleanup = () => {
    const currentTime = now()
    if (cleanupPromise || currentTime - lastCleanupAt < cleanupMinIntervalMs) return
    lastCleanupAt = currentTime
    cleanupPromise = runCleanup()
      .catch(error => onCacheError('cleanup', error, ''))
      .finally(() => {
        cleanupPromise = null
      })
  }

  const cleanup = async () => {
    if (cleanupPromise) await cleanupPromise
    await runCleanup()
  }

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
      const expiresAt = resolveExpiresAt(metadata)
      if (
        typeof metadata.storedAt !== 'number'
        || typeof metadata.contentType !== 'string'
        || !metadata.contentType.startsWith('image/')
        || !Number.isFinite(expiresAt)
        || expiresAt <= now()
      ) {
        return null
      }
      remember(key, {
        data,
        contentType: metadata.contentType,
        expiresAt,
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

  const writeDisk = async (key: string, result: FetchResult, storedAt: number, expiresAt: number) => {
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
        expiresAt,
      } satisfies CacheMetadata)),
    ])
    await rename(tempDataPath, dataPath)
    await rename(tempMetadataPath, metadataPath)
  }

  const load = async (url: string): Promise<WechatImageResult> => {
    scheduleCleanup()
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
      const expiresAt = createExpiresAt(storedAt)
      remember(key, {
        data: fetched.data,
        contentType: fetched.contentType,
        expiresAt,
      })
      try {
        await writeDisk(key, fetched, storedAt, expiresAt)
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
      scheduleCleanup()
    }
  }

  return { load, cleanup }
}
