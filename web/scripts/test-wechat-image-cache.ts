import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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
