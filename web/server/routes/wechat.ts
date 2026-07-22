// @ts-nocheck
/**
 * 微信公众号路由
 * 凭据（appId/appSecret）由前端存在浏览器 localStorage，
 * 每次请求通过 Header 传入：X-Wx-AppId / X-Wx-AppSecret。
 * 服务端不持久化凭据，只做 access_token 内存缓存（按 appId 隔离）。
 *
 * GET  /api/wechat/status       → 验证 Header 中的凭据是否有效
 * GET  /api/wechat/account      → 账号基础信息
 * GET  /api/wechat/token        → 返回当前有效 token（内部调试用）
 * GET  /api/wechat/drafts       → 获取草稿箱列表（分页，?offset=0&count=10）
 * POST /api/wechat/draft        → 新增草稿
 * POST /api/wechat/upload-thumb → 从 URL 下载图片并上传为微信永久素材
 */
import { Router } from 'express'
import axios from 'axios'
import FormData from 'form-data'
import multer from 'multer'
import sharp from 'sharp'
import zlib from 'zlib'
import { logger } from '../logger.js'

const router = Router()
const WECHAT = 'WECHAT'
const wechatUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } })
const WECHAT_MATERIAL_TYPES = new Set(['image', 'voice', 'video', 'news'])
const WECHAT_UPLOAD_MATERIAL_TYPES = new Set(['image', 'voice', 'video', 'thumb'])
// ── Token 缓存（按 appId 隔离，进程重启后重新获取）──────────────────────────
// Map<appId, { token: string, exp: number }>
const _tokenCache = new Map()

/**
 * 从请求 Header 中提取凭据
 * 返回 { appId, appSecret } 或 null
 */
function getCredentials(req) {
  const appId = (req.headers['x-wx-appid'] || '').trim()
  const appSecret = (req.headers['x-wx-appsecret'] || '').trim()
  if (!appId || !appSecret) {
    logger.warn(WECHAT, '缺少公众号凭据', { hasAppId: !!appId, hasAppSecret: !!appSecret })
    return null
  }
  return { appId, appSecret }
}

/**
 * 向微信拉取新 token，写入内存缓存后返回。
 */
async function fetchFreshToken(appId, appSecret) {
  const resp = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
    params: { grant_type: 'client_credential', appid: appId, secret: appSecret },
    timeout: 8000,
  })

  if (resp.data.errcode) {
    logger.error(WECHAT, '微信 Token 获取失败', { errcode: resp.data.errcode, errmsg: resp.data.errmsg })
    throw new Error(`微信 Token 获取失败: [${resp.data.errcode}] ${resp.data.errmsg}`)
  }

  const now = Math.floor(Date.now() / 1000)
  const token = resp.data.access_token
  const expiresIn = resp.data.expires_in || 7200
  const exp = now + expiresIn

  _tokenCache.set(appId, { token, exp })
  logger.info(WECHAT, '获取新 access_token 成功', { appId, expiresIn })
  return token
}

/**
 * 获取有效的 access_token（内存缓存，剩余 < 5 分钟时强制刷新）
 */
async function getAccessToken(appId, appSecret, { forceRefresh = false } = {}) {
  const now = Math.floor(Date.now() / 1000)

  if (!forceRefresh) {
    const cached = _tokenCache.get(appId)
    if (cached && cached.exp - now > 300) {
      return cached.token
    }
  }

  return fetchFreshToken(appId, appSecret)
}

/**
 * 清除指定 appId 的 token 缓存
 */
function invalidateToken(appId) {
  _tokenCache.delete(appId)
}

function truncateWechatText(value, maxChars) {
  if (typeof value !== 'string') return ''
  return Array.from(value.trim()).slice(0, maxChars).join('')
}

function normalizeWechatFlag(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue
  if (value === true || value === 'true') return 1
  if (value === false || value === 'false') return 0
  const num = Number(value)
  return num === 1 ? 1 : 0
}

function normalizeWechatArticleType(value) {
  return value === 'newspic' ? 'newspic' : 'news'
}

function normalizeWechatMaterialType(value, { allowThumb = false } = {}) {
  const allowed = allowThumb ? WECHAT_UPLOAD_MATERIAL_TYPES : WECHAT_MATERIAL_TYPES
  return allowed.has(value) ? value : 'image'
}

function pickWechatAuthorName(basicInfo, fallback) {
  const candidate = basicInfo?.nick_name || basicInfo?.nickname || basicInfo?.user_name || fallback || ''
  return truncateWechatText(candidate, 16)
}

async function fetchWechatAccountBasicInfo(token) {
  const basicResp = await axios.get('https://api.weixin.qq.com/cgi-bin/account/getaccountbasicinfo', {
    params: { access_token: token },
    timeout: 8000,
  })

  if (basicResp.data.errcode && basicResp.data.errcode !== 0) {
    if (basicResp.data.errcode === 48001) {
      return { basicInfo: null, limited: true }
    }
    logger.error(WECHAT, '账户基础信息获取失败', { errcode: basicResp.data.errcode, errmsg: basicResp.data.errmsg })
    throw new Error(`[${basicResp.data.errcode}] ${basicResp.data.errmsg}`)
  }

  return { basicInfo: basicResp.data, limited: false }
}

function isWechatHostedImage(url) {
  try {
    const hostname = new URL(url).hostname
    return ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn', 'wx.qlogo.cn'].some(h => hostname === h || hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}

async function fetchRemoteBuffer(url, { maxBytes = 10 * 1024 * 1024 } = {}) {
  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxContentLength: maxBytes,
  })
  return {
    buffer: Buffer.from(resp.data),
    contentType: resp.headers['content-type'] || 'application/octet-stream',
  }
}

function buildSafeWechatFilename(originalName, fallbackBase, ext = '') {
  const safeBase = String(originalName || fallbackBase || 'wechat')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || fallbackBase
  return safeBase.includes('.') ? safeBase : `${safeBase}${ext}`
}

async function prepareWechatArticleImage(buf, contentType = 'image/jpeg') {
  const normalizedType = String(contentType).toLowerCase()
  const isPng = normalizedType.includes('png')
  const fallbackName = isPng ? 'content.png' : 'content.jpg'

  try {
    let width = 1600
    let quality = 82
    let outBuf = Buffer.alloc(0)

    for (let i = 0; i < 4; i++) {
      let pipeline = sharp(buf, { animated: false }).rotate()
      pipeline = pipeline.resize({ width, withoutEnlargement: true })
      outBuf = isPng
        ? await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer()
        : await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer()
      if (outBuf.length <= 1024 * 1024) {
        return {
          buffer: outBuf,
          contentType: isPng ? 'image/png' : 'image/jpeg',
          filename: fallbackName,
        }
      }
      width = Math.max(960, width - 240)
      quality = Math.max(56, quality - 10)
    }

    const jpegBuf = await sharp(buf, { animated: false })
      .rotate()
      .resize({ width: 960, withoutEnlargement: true })
      .jpeg({ quality: 52, mozjpeg: true })
      .toBuffer()

    return {
      buffer: jpegBuf,
      contentType: 'image/jpeg',
      filename: 'content.jpg',
    }
  } catch (err) {
    if (buf.length <= 1024 * 1024 && /image\/(png|jpe?g)/i.test(contentType)) {
      return {
        buffer: buf,
        contentType,
        filename: fallbackName,
      }
    }
    throw new Error(`正文图片处理失败: ${err.message}`)
  }
}

async function uploadBufferToWechatContentImage(token, buf, filename, contentType) {
  const form = new FormData()
  form.append('media', buf, { filename, contentType })

  const resp = await axios.post(
    'https://api.weixin.qq.com/cgi-bin/media/uploadimg',
    form,
    {
      params: { access_token: token },
      headers: form.getHeaders(),
      timeout: 15000,
    },
  )

  if (resp.data.errcode && resp.data.errcode !== 0) {
    logger.error(WECHAT, '上传正文图片失败', { errcode: resp.data.errcode, errmsg: resp.data.errmsg })
    throw new Error(`[${resp.data.errcode}] ${resp.data.errmsg}`)
  }
  if (!resp.data.url) throw new Error('微信未返回正文图片 URL')
  return resp.data.url
}

async function rewriteWechatContentImages(token, html) {
  if (typeof html !== 'string' || !html.includes('<img')) return { html, rewritten: 0, failed: [] }

  const matches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
  const uniqueUrls = [...new Set(matches.map(match => match[1]).filter(Boolean))]
  if (uniqueUrls.length === 0) return { html, rewritten: 0, failed: [] }

  let nextHtml = html
  let rewritten = 0
  const failed = []

  for (const imageUrl of uniqueUrls) {
    if (!/^https?:\/\//i.test(imageUrl) || isWechatHostedImage(imageUrl)) continue
    try {
      const remote = await fetchRemoteBuffer(imageUrl)
      const prepared = await prepareWechatArticleImage(remote.buffer, remote.contentType)
      const wechatUrl = await uploadBufferToWechatContentImage(token, prepared.buffer, prepared.filename, prepared.contentType)
      nextHtml = nextHtml.split(imageUrl).join(wechatUrl)
      rewritten += 1
    } catch (err) {
      failed.push({ url: imageUrl, error: err.message })
      logger.warn(WECHAT, '正文图片上传失败，保留原始 URL', { url: imageUrl.slice(0, 120), error: err.message })
    }
  }

  return { html: nextHtml, rewritten, failed }
}

// ── GET /api/wechat/status ───────────────────────────────────────────────────
// 检查 Header 中的凭据是否已提供（不主动向微信验证，避免消耗调用次数）
router.get('/status', (req, res) => {
  const creds = getCredentials(req)
  const bound = !!creds
  logger.info(WECHAT, '状态查询', { bound, appId: creds?.appId || null })
  res.json({
    bound,
    appId: creds?.appId || null,
  })
})

// ── GET /api/wechat/account ──────────────────────────────────────────────────
router.get('/account', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据（X-Wx-AppId / X-Wx-AppSecret）' })

  try {
    logger.info(WECHAT, '获取账户信息', { appId: creds.appId })
    const token = await getAccessToken(creds.appId, creds.appSecret)
    const { basicInfo, limited } = await fetchWechatAccountBasicInfo(token)
    if (limited) logger.warn(WECHAT, '账户接口权限不足 (48001)，标记为 limited', { appId: creds.appId })

    let fansCount = null
    let fansLimited = false
    try {
      const uResp = await axios.get('https://api.weixin.qq.com/cgi-bin/user/get', {
        params: { access_token: token, next_openid: '' },
        timeout: 8000,
      })
      if (uResp.data.errcode === 48001) {
        fansLimited = true
        logger.warn(WECHAT, '粉丝接口权限不足 (48001)', { appId: creds.appId })
      } else if (!uResp.data.errcode || uResp.data.errcode === 0) {
        fansCount = uResp.data.total ?? uResp.data.count ?? 0
      }
    } catch (error) {
      logger.warn(WECHAT, '获取粉丝数失败（不影响主流程）', { error: error.message })
    }

    const headImg = basicInfo?.head_img || basicInfo?.headimgurl || null
    const cleanHeadImg = headImg && headImg.trim() !== '' ? headImg : null

    logger.info(WECHAT, '账户信息获取成功', { appId: creds.appId, fansCount, limited })

    res.json({
      nickname: basicInfo?.nick_name || basicInfo?.nickname || creds.appId,
      headimgurl: cleanHeadImg,
      fans_count: fansCount,
      fans_limited: fansLimited,
      account_type: basicInfo?.service_type_info?.id === 2 ? 'service' : 'subscription',
      verify_type: basicInfo?.verify_type_info?.id ?? -1,
      qrcode_url: basicInfo?.qrcode_url || null,
      principal: basicInfo?.principal_name || null,
      limited,
    })
  } catch (err) {
    logger.error(WECHAT, '获取账户信息失败', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/wechat/drafts ───────────────────────────────────────────────────
router.get('/drafts', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)
    const offset = parseInt(req.query.offset ?? '0', 10)
    const count = Math.min(parseInt(req.query.count ?? '10', 10), 20)

    logger.info(WECHAT, '获取草稿列表', { appId: creds.appId, offset, count })

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/draft/batchget',
      { offset, count, no_content: 0 },
      { params: { access_token: token }, timeout: 10000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      logger.warn(WECHAT, '微信草稿列表接口返回错误', { errcode: resp.data.errcode, errmsg: resp.data.errmsg })
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    const items = (resp.data.item ?? []).map(item => {
      const first = item.content?.news_item?.[0] ?? {}
      return {
        media_id: item.media_id,
        update_time: item.update_time,
        title: first.title ?? '（无标题）',
        digest: first.digest ?? '',
        thumb_url: first.thumb_url ?? null,
        url: first.url ?? null,
        count: item.content?.news_item?.length ?? 1,
      }
    })

    logger.info(WECHAT, '草稿列表获取成功', { total: resp.data.total_count ?? 0, returned: items.length })
    res.json({
      total_count: resp.data.total_count ?? 0,
      item_count: resp.data.item_count ?? items.length,
      items,
    })
  } catch (err) {
    logger.error(WECHAT, '获取草稿列表失败', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── 运行时生成白色 PNG（无外部依赖）────────────────────────────────────────────
function createWhitePng(width = 900, height = 383) {
  const crcTable = (() => {
    const t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      t[i] = c >>> 0
    }
    return t
  })()
  const crc32 = (buf) => {
    let c = 0xFFFFFFFF
    for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8)
    return (c ^ 0xFFFFFFFF) >>> 0
  }
  const chunk = (type, data) => {
    const tBuf = Buffer.from(type, 'ascii')
    const tData = Buffer.concat([tBuf, data])
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tData))
    return Buffer.concat([len, tData, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.alloc(1 + width * 3, 0xFF)
  row[0] = 0x00
  const rawData = Buffer.concat(Array.from({ length: height }, () => row))
  const idat = zlib.deflateSync(rawData)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 把图片 Buffer 上传为微信永久素材，返回 media_id。
 */
async function uploadBufferToWechat(token, buf, filename, contentType) {
  const form = new FormData()
  form.append('media', buf, { filename, contentType })

  const upResp = await axios.post(
    'https://api.weixin.qq.com/cgi-bin/material/add_material',
    form,
    {
      params: { access_token: token, type: 'image' },
      headers: form.getHeaders(),
      timeout: 15000,
    },
  )

  if (upResp.data.errcode && upResp.data.errcode !== 0) {
    logger.error(WECHAT, '上传永久素材失败', { errcode: upResp.data.errcode, errmsg: upResp.data.errmsg })
    throw new Error(`[${upResp.data.errcode}] ${upResp.data.errmsg}`)
  }
  logger.debug(WECHAT, '永久素材上传成功', { filename, mediaId: upResp.data.media_id })
  return upResp.data.media_id
}

/**
 * 获取默认封面 media_id（按 appId 内存缓存，服务重启后重新上传）
 */
const _defaultThumbCache = new Map()  // Map<appId, media_id>

async function getDefaultThumbMediaId(appId, token) {
  const cached = _defaultThumbCache.get(appId)
  if (cached) return cached

  logger.info(WECHAT, '上传默认封面素材', { appId })
  const buf = createWhitePng()
  const mediaId = await uploadBufferToWechat(token, buf, 'blank_thumb.png', 'image/png')
  _defaultThumbCache.set(appId, mediaId)
  logger.info(WECHAT, '默认封面素材已上传', { appId, mediaId })
  return mediaId
}

// ── POST /api/wechat/upload-thumb ───────────────────────────────────────────
router.post('/upload-thumb', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  const { url } = req.body
  if (!url) return res.status(400).json({ error: '缺少 url 参数' })

  try {
    logger.info(WECHAT, '上传封面图', { appId: creds.appId, url: url.slice(0, 80) })
    const token = await getAccessToken(creds.appId, creds.appSecret)

    const imgResp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      maxContentLength: 2 * 1024 * 1024,
    })

    const contentType = imgResp.headers['content-type'] || 'image/jpeg'
    const ext = contentType.includes('png') ? 'png'
      : contentType.includes('gif') ? 'gif'
        : contentType.includes('webp') ? 'webp'
          : 'jpg'

    const mediaId = await uploadBufferToWechat(
      token,
      Buffer.from(imgResp.data),
      `thumb.${ext}`,
      contentType,
    )

    logger.info(WECHAT, '封面图上传成功', { mediaId, contentType })
    res.json({ media_id: mediaId })
  } catch (err) {
    logger.error(WECHAT, '封面图上传失败', { error: err.message })
    res.status(500).json({ error: `封面图片上传失败: ${err.message}` })
  }
})

// ── POST /api/wechat/draft ───────────────────────────────────────────────────
router.post('/draft', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  const {
    article_type,
    title,
    author,
    digest,
    content,
    content_source_url,
    thumb_media_id,
    need_open_comment = 1,
    only_fans_can_comment = 0,
    pic_crop_235_1,
    pic_crop_1_1,
    image_info,
    cover_info,
    product_info,
  } = req.body ?? {}

  const normalizedArticleType = normalizeWechatArticleType(article_type)
  const normalizedTitle = truncateWechatText(title, 32)
  const rawContent = typeof content === 'string' ? content : ''
  const normalizedContent = rawContent.trim()
  const normalizedDigest = truncateWechatText(digest || normalizedTitle, 120)
  const normalizedSourceUrl = truncateWechatText(content_source_url, 1024)
  const normalizedNeedOpenComment = normalizeWechatFlag(need_open_comment, 1)
  const normalizedOnlyFansCanComment = normalizedNeedOpenComment
    ? normalizeWechatFlag(only_fans_can_comment, 0)
    : 0
  const normalizedCrop235 = truncateWechatText(pic_crop_235_1, 64)
  const normalizedCrop11 = truncateWechatText(pic_crop_1_1, 64)

  if (!normalizedTitle || !normalizedContent) {
    logger.warn(WECHAT, '新增草稿参数缺失', { hasTitle: !!normalizedTitle, hasContent: !!normalizedContent })
    return res.status(400).json({ error: '标题和内容不能为空' })
  }

  const submitDraft = async (token) => {
    let finalThumbId = thumb_media_id
    if (normalizedArticleType === 'news' && !finalThumbId) {
      try {
        finalThumbId = await getDefaultThumbMediaId(creds.appId, token)
      } catch (thumbErr) {
        logger.warn(WECHAT, '默认封面上传失败，尝试无封面推送', { error: thumbErr.message })
      }
    }

    let currentAccountName = truncateWechatText(author, 16)
    if (!currentAccountName) {
      try {
        const { basicInfo, limited } = await fetchWechatAccountBasicInfo(token)
        currentAccountName = pickWechatAuthorName(basicInfo, creds.appId)
        if (limited) {
          logger.warn(WECHAT, '草稿默认作者回退为 appId，账户信息接口权限不足', { appId: creds.appId })
        }
      } catch (accountErr) {
        currentAccountName = pickWechatAuthorName(null, creds.appId)
        logger.warn(WECHAT, '获取公众号昵称失败，草稿作者回退为 appId', { appId: creds.appId, error: accountErr.message })
      }
    }

    const rewrittenContent = normalizedArticleType === 'news'
      ? await rewriteWechatContentImages(token, rawContent)
      : { html: rawContent, rewritten: 0, failed: [] }

    const article = {
      article_type: normalizedArticleType,
      title: normalizedTitle,
      author: currentAccountName,
      content: rewrittenContent.html,
      need_open_comment: normalizedNeedOpenComment,
      only_fans_can_comment: normalizedOnlyFansCanComment,
    }

    if (normalizedArticleType === 'news') {
      article.digest = normalizedDigest
      if (normalizedSourceUrl) article.content_source_url = normalizedSourceUrl
      if (finalThumbId) article.thumb_media_id = finalThumbId
      if (normalizedCrop235) article.pic_crop_235_1 = normalizedCrop235
      if (normalizedCrop11) article.pic_crop_1_1 = normalizedCrop11
    }

    if (normalizedArticleType === 'newspic') {
      article.image_info = image_info
      if (cover_info) article.cover_info = cover_info
      if (product_info) article.product_info = product_info
    }

    return axios.post(
      'https://api.weixin.qq.com/cgi-bin/draft/add',
      { articles: [article] },
      { params: { access_token: token }, timeout: 15000 },
    )
  }

  try {
    logger.info(WECHAT, '新增草稿', {
      appId: creds.appId,
      articleType: normalizedArticleType,
      title: normalizedTitle.slice(0, 20),
      hasThumb: !!thumb_media_id,
      openComment: !!normalizedNeedOpenComment,
      fansOnlyComment: !!normalizedOnlyFansCanComment,
    })
    let token = await getAccessToken(creds.appId, creds.appSecret)
    let resp = await submitDraft(token)

    if (resp.data.errcode === 40001) {
      logger.warn(WECHAT, '收到 40001，强制刷新 token 后重试', { appId: creds.appId })
      invalidateToken(creds.appId)
      token = await getAccessToken(creds.appId, creds.appSecret, { forceRefresh: true })
      resp = await submitDraft(token)
    }

    if (resp.data.errcode && resp.data.errcode !== 0) {
      logger.error(WECHAT, '推送草稿失败', { errcode: resp.data.errcode, errmsg: resp.data.errmsg })
      return res.status(400).json({
        error: `推送失败: [${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    logger.info(WECHAT, '草稿新增成功', { mediaId: resp.data.media_id })
    res.json({ success: true, media_id: resp.data.media_id })
  } catch (err) {
    logger.error(WECHAT, '新增草稿失败', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/wechat/proxy-img  服务端代理微信图片（绕过防盗链）────────────────
router.get('/proxy-img', async (req, res) => {
  const url = req.query.url
  if (!url) return res.status(400).json({ error: 'Missing url' })

  let parsed
  try { parsed = new URL(url) } catch { return res.status(400).json({ error: 'Invalid url' }) }
  const allowed = ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn', 'wx.qlogo.cn']
  if (!allowed.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
    logger.warn(WECHAT, '图片代理域名被拒', { hostname: parsed.hostname })
    return res.status(403).json({ error: 'Domain not allowed' })
  }

  try {
    logger.debug(WECHAT, '代理图片请求', { url: String(url).slice(0, 80) })
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 8000,
      headers: {
        Referer: 'https://mp.weixin.qq.com/',
        'User-Agent': 'Mozilla/5.0 (compatible; WechatProxy/1.0)',
      },
    })
    const ct = resp.headers['content-type'] ?? 'image/jpeg'
    res.setHeader('Content-Type', ct)
    res.setHeader('Cache-Control', 'public, max-age=86400')
    res.send(resp.data)
  } catch (err) {
    logger.error(WECHAT, '图片代理失败', { url: String(url).slice(0, 80), error: err.message })
    res.status(502).json({ error: '图片代理失败' })
  }
})

// ── GET /api/wechat/token（调试用）───────────────────────────────────────────
router.get('/token', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)
    const now = Math.floor(Date.now() / 1000)
    const cached = _tokenCache.get(creds.appId)
    logger.debug(WECHAT, '调试 token 查询', { appId: creds.appId, expiresIn: (cached?.exp ?? 0) - now })
    res.json({ token: token.slice(0, 16) + '...', expires_in: (cached?.exp ?? 0) - now })
  } catch (err) {
    logger.error(WECHAT, '调试 token 查询失败', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/wechat/draft/:mediaId ───────────────────────────────────────────
router.get('/draft/:mediaId', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)
    const { mediaId } = req.params

    logger.info(WECHAT, '获取草稿详情', { appId: creds.appId, mediaId })

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/draft/get',
      { media_id: mediaId },
      { params: { access_token: token }, timeout: 10000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      logger.warn(WECHAT, '获取草稿详情失败', { errcode: resp.data.errcode, errmsg: resp.data.errmsg })
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    const first = resp.data.news_item?.[0] ?? {}
    logger.info(WECHAT, '草稿详情获取成功', { mediaId, title: first.title ?? '' })
    res.json({
      title: first.title ?? '',
      content: first.content ?? '',
      digest: first.digest ?? '',
      thumb_url: first.thumb_url ?? null,
    })
  } catch (err) {
    logger.error(WECHAT, '获取草稿详情失败', { mediaId: req.params.mediaId, error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /api/wechat/draft/:mediaId ────────────────────────────────────────
router.delete('/draft/:mediaId', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)
    const { mediaId } = req.params

    logger.info(WECHAT, '删除草稿', { appId: creds.appId, mediaId })

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/draft/delete',
      { media_id: mediaId },
      { params: { access_token: token }, timeout: 10000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      logger.warn(WECHAT, '删除草稿失败', { errcode: resp.data.errcode, errmsg: resp.data.errmsg })
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    logger.info(WECHAT, '草稿删除成功', { mediaId })
    res.json({ success: true })
  } catch (err) {
    logger.error(WECHAT, '删除草稿失败', { mediaId: req.params.mediaId, error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/wechat/draft/:mediaId/publish ──────────────────────────────────
router.post('/draft/:mediaId/publish', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)
    const { mediaId } = req.params

    logger.info(WECHAT, '发布草稿', { appId: creds.appId, mediaId })

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/freepublish/submit',
      { media_id: mediaId },
      { params: { access_token: token }, timeout: 15000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      logger.error(WECHAT, '发布草稿失败', { errcode: resp.data.errcode, errmsg: resp.data.errmsg })
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    logger.info(WECHAT, '草稿发布成功', { mediaId, publishId: resp.data.publish_id })
    res.json({ success: true, publish_id: resp.data.publish_id })
  } catch (err) {
    logger.error(WECHAT, '发布草稿失败', { mediaId: req.params.mediaId, error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/wechat/published ─────────────────────────────────────────────────
router.get('/published', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)
    const offset = parseInt(req.query.offset ?? '0', 10)
    const count = Math.min(parseInt(req.query.count ?? '10', 10), 20)

    logger.info(WECHAT, '获取已发布列表', { appId: creds.appId, offset, count })

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/freepublish/batchget',
      { offset, count, no_content: 1 },
      { params: { access_token: token }, timeout: 10000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      logger.warn(WECHAT, '获取已发布列表失败', { errcode: resp.data.errcode, errmsg: resp.data.errmsg })
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    const items = (resp.data.item ?? []).map(item => {
      const first = item.content?.news_item?.[0] ?? {}
      return {
        article_id: item.article_id,
        update_time: item.update_time,
        title: first.title ?? '（无标题）',
        digest: first.digest ?? '',
        thumb_url: first.thumb_url ?? null,
        url: first.url ?? null,
        count: item.content?.news_item?.length ?? 1,
      }
    })

    logger.info(WECHAT, '已发布列表获取成功', { total: resp.data.total_count ?? 0, returned: items.length })
    res.json({
      total_count: resp.data.total_count ?? 0,
      item_count: resp.data.item_count ?? items.length,
      items,
    })
  } catch (err) {
    logger.error(WECHAT, '获取已发布列表失败', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/wechat/materials ─────────────────────────────────────────────────
router.get('/materials', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)
    const type = normalizeWechatMaterialType(req.query.type)
    const offset = parseInt(req.query.offset ?? '0', 10)
    const count = Math.min(parseInt(req.query.count ?? '20', 10), 20)

    logger.info(WECHAT, '获取素材列表', { appId: creds.appId, type, offset, count })

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/material/batchget_material',
      { type, offset, count },
      { params: { access_token: token }, timeout: 10000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      logger.warn(WECHAT, '获取素材列表失败', { errcode: resp.data.errcode, errmsg: resp.data.errmsg })
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    logger.info(WECHAT, '素材列表获取成功', { type, total: resp.data.total_count ?? 0, returned: resp.data.item_count ?? 0 })
    res.json({
      total_count: resp.data.total_count ?? 0,
      item_count: resp.data.item_count ?? 0,
      items: resp.data.item ?? [],
    })
  } catch (err) {
    logger.error(WECHAT, '获取素材列表失败', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/wechat/material/:mediaId ─────────────────────────────────────────
router.get('/material/:mediaId', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)
    const type = normalizeWechatMaterialType(req.query.type)
    const { mediaId } = req.params

    logger.info(WECHAT, '获取素材详情', { appId: creds.appId, mediaId, type })

    const responseType = type === 'image' || type === 'voice' ? 'arraybuffer' : 'json'
    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/material/get_material',
      { media_id: mediaId },
      { params: { access_token: token }, timeout: 15000, responseType },
    )

    if (responseType === 'json') {
      if (resp.data.errcode && resp.data.errcode !== 0) {
        logger.warn(WECHAT, '获取素材详情失败', { errcode: resp.data.errcode, errmsg: resp.data.errmsg, mediaId, type })
        return res.status(400).json({
          error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
          errcode: resp.data.errcode,
        })
      }

      return res.json({
        media_id: mediaId,
        type,
        ...resp.data,
      })
    }

    const contentType = resp.headers['content-type'] || (type === 'voice' ? 'audio/mpeg' : 'image/jpeg')
    return res.json({
      media_id: mediaId,
      type,
      content_type: contentType,
      size: Buffer.byteLength(resp.data),
      file_url: `/api/wechat/material/${mediaId}/file?type=${type}`,
    })
  } catch (err) {
    logger.error(WECHAT, '获取素材详情失败', { mediaId: req.params.mediaId, error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/wechat/material/:mediaId/file ────────────────────────────────────
router.get('/material/:mediaId/file', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)
    const type = normalizeWechatMaterialType(req.query.type)
    const { mediaId } = req.params

    if (type !== 'image' && type !== 'voice') {
      return res.status(400).json({ error: '仅图片和音频素材支持文件直出' })
    }

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/material/get_material',
      { media_id: mediaId },
      { params: { access_token: token }, timeout: 15000, responseType: 'arraybuffer' },
    )

    res.setHeader('Content-Type', resp.headers['content-type'] || (type === 'voice' ? 'audio/mpeg' : 'image/jpeg'))
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(resp.data)
  } catch (err) {
    logger.error(WECHAT, '素材文件直出失败', { mediaId: req.params.mediaId, error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/wechat/material/upload ──────────────────────────────────────────
router.post('/material/upload', wechatUpload.single('media'), async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })
  if (!req.file) return res.status(400).json({ error: '未收到素材文件' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)
    const type = normalizeWechatMaterialType(req.body?.type, { allowThumb: true })
    const title = truncateWechatText(req.body?.title, 64)
    const introduction = truncateWechatText(req.body?.introduction, 120)

    const form = new FormData()
    form.append('media', req.file.buffer, {
      filename: buildSafeWechatFilename(req.file.originalname, `wechat_${type}`),
      contentType: req.file.mimetype || 'application/octet-stream',
    })
    if (type === 'video' && (title || introduction)) {
      form.append('description', JSON.stringify({ title, introduction }))
    }

    logger.info(WECHAT, '上传永久素材', { appId: creds.appId, type, filename: req.file.originalname, size: req.file.size })

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/material/add_material',
      form,
      {
        params: { access_token: token, type },
        headers: form.getHeaders(),
        timeout: 20000,
      },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      logger.warn(WECHAT, '上传永久素材失败', { errcode: resp.data.errcode, errmsg: resp.data.errmsg })
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    res.json({
      success: true,
      type,
      media_id: resp.data.media_id,
      url: resp.data.url || null,
      name: req.file.originalname,
    })
  } catch (err) {
    logger.error(WECHAT, '上传永久素材失败', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/wechat/content-image/upload ─────────────────────────────────────
router.post('/content-image/upload', wechatUpload.single('media'), async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })
  if (!req.file) return res.status(400).json({ error: '未收到图片文件' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)
    const prepared = await prepareWechatArticleImage(req.file.buffer, req.file.mimetype)
    const imageUrl = await uploadBufferToWechatContentImage(
      token,
      prepared.buffer,
      buildSafeWechatFilename(req.file.originalname, 'content_image', prepared.filename.endsWith('.png') ? '.png' : '.jpg'),
      prepared.contentType,
    )

    res.json({
      success: true,
      url: imageUrl,
    })
  } catch (err) {
    logger.error(WECHAT, '上传正文图片失败', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /api/wechat/material/:mediaId ─────────────────────────────────────
router.delete('/material/:mediaId', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)
    const { mediaId } = req.params

    logger.info(WECHAT, '删除素材', { appId: creds.appId, mediaId })

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/material/del_material',
      { media_id: mediaId },
      { params: { access_token: token }, timeout: 10000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      logger.warn(WECHAT, '删除素材失败', { errcode: resp.data.errcode, errmsg: resp.data.errmsg })
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    logger.info(WECHAT, '素材删除成功', { mediaId })
    res.json({ success: true })
  } catch (err) {
    logger.error(WECHAT, '删除素材失败', { mediaId: req.params.mediaId, error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/wechat/article-stats ────────────────────────────────────────────
router.get('/article-stats', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)

    const now = new Date()
    const endD = req.query.end_date ?? now.toISOString().slice(0, 10)
    const startD = req.query.begin_date ?? (() => {
      const d = new Date(now); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10)
    })()

    logger.info(WECHAT, '获取文章阅读统计', { appId: creds.appId, beginDate: startD, endDate: endD })

    const resp = await axios.post(
      'https://api.weixin.qq.com/datacube/getarticleread',
      { begin_date: startD, end_date: endD },
      { params: { access_token: token }, timeout: 10000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      logger.warn(WECHAT, '获取文章统计失败', { errcode: resp.data.errcode, errmsg: resp.data.errmsg })
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    const byArticle = {}
    for (const row of (resp.data.list ?? [])) {
      const key = row.msgid ?? row.title
      if (!byArticle[key]) {
        byArticle[key] = {
          title: row.title ?? '',
          url: row.ori_url ?? null,
          read_num: 0,
          share_num: 0,
          date: row.ref_date ?? '',
        }
      }
      byArticle[key].read_num += row.int_page_read_count ?? 0
      byArticle[key].share_num += row.share_count ?? 0
    }

    const articles = Object.values(byArticle).sort((a, b) => b.read_num - a.read_num)
    logger.info(WECHAT, '文章统计获取成功', { articlesCount: articles.length, beginDate: startD, endDate: endD })

    res.json({
      begin_date: startD,
      end_date: endD,
      list: resp.data.list ?? [],
      articles,
    })
  } catch (err) {
    logger.error(WECHAT, '获取文章统计失败', { error: err.message })
    res.status(500).json({ error: err.message })
  }
})

export default router