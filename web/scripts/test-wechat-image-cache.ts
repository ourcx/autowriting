import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createWechatImageCache,
  parseWechatImageUrl,
  WechatImageUrlError,
} from '../server/utils/wechatImageCache.ts'

test('微信图片缓存合并并发请求并支持内存和磁盘命中', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'autowriting-wechat-image-cache-'))
  const sourceUrl = 'https://mmbiz.qpic.cn/test/image.png'
  const sourceData = Buffer.from('test-image')
  let fetchCount = 0

  try {
    const cache = createWechatImageCache({
      cacheDir,
      fetcher: async () => {
        fetchCount += 1
        await new Promise(resolve => setTimeout(resolve, 10))
        return { data: sourceData, contentType: 'image/png' }
      },
    })

    const concurrent = await Promise.all([
      cache.load(sourceUrl),
      cache.load(sourceUrl),
      cache.load(sourceUrl),
    ])
    assert.equal(fetchCount, 1)
    assert.deepEqual(concurrent.map(result => result.cacheStatus), ['MISS', 'MISS', 'MISS'])
    assert.deepEqual(concurrent[0].data, sourceData)

    const memoryHit = await cache.load(sourceUrl)
    assert.equal(memoryHit.cacheStatus, 'MEMORY')
    assert.equal(fetchCount, 1)

    const restartedCache = createWechatImageCache({
      cacheDir,
      fetcher: async () => {
        throw new Error('磁盘命中时不应回源')
      },
    })
    const diskHit = await restartedCache.load(sourceUrl)
    assert.equal(diskHit.cacheStatus, 'DISK')
    assert.deepEqual(diskHit.data, sourceData)
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
})

test('微信图片地址仅允许 HTTPS 微信图片域名', () => {
  assert.equal(
    parseWechatImageUrl('https://mmbiz.qpic.cn/test/image.png').hostname,
    'mmbiz.qpic.cn',
  )
  assert.throws(
    () => parseWechatImageUrl('https://example.com/image.png'),
    (error: unknown) => error instanceof WechatImageUrlError && error.status === 403,
  )
  assert.throws(
    () => parseWechatImageUrl('http://mmbiz.qpic.cn/image.png'),
    (error: unknown) => error instanceof WechatImageUrlError && error.status === 403,
  )
})

test('微信图片缓存使用随机过期时间并清理过期文件', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'autowriting-wechat-image-expiry-'))
  let currentTime = 10_000
  let fetchCount = 0

  try {
    const cache = createWechatImageCache({
      cacheDir,
      ttlMs: 1_000,
      ttlJitterRatio: 0.2,
      now: () => currentTime,
      random: () => 1,
      cleanupMinIntervalMs: Number.POSITIVE_INFINITY,
      fetcher: async () => {
        fetchCount += 1
        return { data: Buffer.from(`image-${fetchCount}`), contentType: 'image/png' }
      },
    })

    await cache.load('https://mmbiz.qpic.cn/test/expiring.png')
    const metadataFile = (await readdir(cacheDir)).find(name => name.endsWith('.json'))
    assert.ok(metadataFile)
    const metadata = JSON.parse(await readFile(path.join(cacheDir, metadataFile), 'utf8'))
    assert.equal(metadata.expiresAt, 11_200)

    currentTime = 11_201
    await cache.cleanup()
    assert.deepEqual(await readdir(cacheDir), [])

    const refreshed = await cache.load('https://mmbiz.qpic.cn/test/expiring.png')
    assert.equal(refreshed.cacheStatus, 'MISS')
    assert.equal(fetchCount, 2)
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
})

test('微信图片磁盘缓存超限时优先淘汰最旧条目', async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'autowriting-wechat-image-capacity-'))
  let currentTime = 20_000

  try {
    const cache = createWechatImageCache({
      cacheDir,
      maxDiskBytes: 1_300,
      now: () => currentTime,
      random: () => 0.5,
      cleanupMinIntervalMs: Number.POSITIVE_INFINITY,
      fetcher: async url => ({
        data: Buffer.alloc(1_000, url.endsWith('old.png') ? 1 : 2),
        contentType: 'image/png',
      }),
    })

    await cache.load('https://mmbiz.qpic.cn/test/old.png')
    currentTime += 1
    await cache.load('https://mmbiz.qpic.cn/test/new.png')
    const orphanKey = 'f'.repeat(64)
    await writeFile(path.join(cacheDir, `${orphanKey}.bin`), Buffer.alloc(2_000))
    await cache.cleanup()

    const files = await readdir(cacheDir)
    assert.equal(files.filter(name => name.endsWith('.bin')).length, 1)
    assert.equal(files.includes(`${orphanKey}.bin`), false)
    const restartedCache = createWechatImageCache({
      cacheDir,
      now: () => currentTime,
      fetcher: async () => {
        throw new Error('最新缓存应保留在磁盘中')
      },
    })
    const newest = await restartedCache.load('https://mmbiz.qpic.cn/test/new.png')
    assert.equal(newest.cacheStatus, 'DISK')
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
})
