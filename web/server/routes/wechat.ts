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
import zlib from 'zlib'

const router = Router()

// ── Token 缓存（按 appId 隔离，进程重启后重新获取）──────────────────────────
// Map<appId, { token: string, exp: number }>
const _tokenCache = new Map()

/**
 * 从请求 Header 中提取凭据
 * 返回 { appId, appSecret } 或 null
 */
function getCredentials(req) {
  const appId     = (req.headers['x-wx-appid'] || '').trim()
  const appSecret = (req.headers['x-wx-appsecret'] || '').trim()
  if (!appId || !appSecret) return null
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
    throw new Error(`微信 Token 获取失败: [${resp.data.errcode}] ${resp.data.errmsg}`)
  }

  const now       = Math.floor(Date.now() / 1000)
  const token     = resp.data.access_token
  const expiresIn = resp.data.expires_in || 7200
  const exp       = now + expiresIn

  _tokenCache.set(appId, { token, exp })
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

// ── GET /api/wechat/status ───────────────────────────────────────────────────
// 检查 Header 中的凭据是否已提供（不主动向微信验证，避免消耗调用次数）
router.get('/status', (req, res) => {
  const creds = getCredentials(req)
  res.json({
    bound: !!creds,
    appId: creds?.appId || null,
  })
})

// ── GET /api/wechat/account ──────────────────────────────────────────────────
router.get('/account', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据（X-Wx-AppId / X-Wx-AppSecret）' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)

    let basicInfo = null
    let limited   = false

    const basicResp = await axios.get('https://api.weixin.qq.com/cgi-bin/account/getaccountbasicinfo', {
      params:  { access_token: token },
      timeout: 8000,
    })

    if (basicResp.data.errcode && basicResp.data.errcode !== 0) {
      if (basicResp.data.errcode === 48001) {
        limited = true
      } else {
        throw new Error(`[${basicResp.data.errcode}] ${basicResp.data.errmsg}`)
      }
    } else {
      basicInfo = basicResp.data
    }

    let fansCount   = null
    let fansLimited = false
    try {
      const uResp = await axios.get('https://api.weixin.qq.com/cgi-bin/user/get', {
        params:  { access_token: token, next_openid: '' },
        timeout: 8000,
      })
      if (uResp.data.errcode === 48001) {
        fansLimited = true
      } else if (!uResp.data.errcode || uResp.data.errcode === 0) {
        fansCount = uResp.data.total ?? uResp.data.count ?? 0
      }
    } catch {
      // 拿不到粉丝数也没关系
    }

    const headImg      = basicInfo?.head_img || basicInfo?.headimgurl || null
    const cleanHeadImg = headImg && headImg.trim() !== '' ? headImg : null

    res.json({
      nickname:     basicInfo?.nick_name  || basicInfo?.nickname || creds.appId,
      headimgurl:   cleanHeadImg,
      fans_count:   fansCount,
      fans_limited: fansLimited,
      account_type: basicInfo?.service_type_info?.id === 2 ? 'service' : 'subscription',
      verify_type:  basicInfo?.verify_type_info?.id ?? -1,
      qrcode_url:   basicInfo?.qrcode_url || null,
      principal:    basicInfo?.principal_name || null,
      limited,
    })
  } catch (err) {
    console.error('[Wechat/account]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/wechat/drafts ───────────────────────────────────────────────────
router.get('/drafts', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token  = await getAccessToken(creds.appId, creds.appSecret)
    const offset = parseInt(req.query.offset ?? '0', 10)
    const count  = Math.min(parseInt(req.query.count ?? '10', 10), 20)

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/draft/batchget',
      { offset, count, no_content: 0 },
      { params: { access_token: token }, timeout: 10000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    const items = (resp.data.item ?? []).map(item => {
      const first = item.content?.news_item?.[0] ?? {}
      return {
        media_id:    item.media_id,
        update_time: item.update_time,
        title:       first.title   ?? '（无标题）',
        digest:      first.digest  ?? '',
        thumb_url:   first.thumb_url ?? null,
        url:         first.url     ?? null,
        count:       item.content?.news_item?.length ?? 1,
      }
    })

    res.json({
      total_count: resp.data.total_count ?? 0,
      item_count:  resp.data.item_count  ?? items.length,
      items,
    })
  } catch (err) {
    console.error('[Wechat/drafts]', err.message)
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
    const tBuf  = Buffer.from(type, 'ascii')
    const tData = Buffer.concat([tBuf, data])
    const len   = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crc   = Buffer.alloc(4); crc.writeUInt32BE(crc32(tData))
    return Buffer.concat([len, tData, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width,  0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2
  const row     = Buffer.alloc(1 + width * 3, 0xFF)
  row[0]        = 0x00
  const rawData = Buffer.concat(Array.from({ length: height }, () => row))
  const idat    = zlib.deflateSync(rawData)
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
      params:  { access_token: token, type: 'image' },
      headers: form.getHeaders(),
      timeout: 15000,
    },
  )

  if (upResp.data.errcode && upResp.data.errcode !== 0) {
    throw new Error(`[${upResp.data.errcode}] ${upResp.data.errmsg}`)
  }
  return upResp.data.media_id
}

/**
 * 获取默认封面 media_id（按 appId 内存缓存，服务重启后重新上传）
 */
const _defaultThumbCache = new Map()  // Map<appId, media_id>

async function getDefaultThumbMediaId(appId, token) {
  const cached = _defaultThumbCache.get(appId)
  if (cached) return cached

  const buf     = createWhitePng()
  const mediaId = await uploadBufferToWechat(token, buf, 'blank_thumb.png', 'image/png')
  _defaultThumbCache.set(appId, mediaId)
  console.log('[Wechat] 默认封面素材已上传，appId:', appId, 'media_id:', mediaId)
  return mediaId
}

// ── POST /api/wechat/upload-thumb ───────────────────────────────────────────
router.post('/upload-thumb', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  const { url } = req.body
  if (!url) return res.status(400).json({ error: '缺少 url 参数' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)

    const imgResp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      maxContentLength: 2 * 1024 * 1024,
    })

    const contentType = imgResp.headers['content-type'] || 'image/jpeg'
    const ext = contentType.includes('png')  ? 'png'
              : contentType.includes('gif')  ? 'gif'
              : contentType.includes('webp') ? 'webp'
              : 'jpg'

    const mediaId = await uploadBufferToWechat(
      token,
      Buffer.from(imgResp.data),
      `thumb.${ext}`,
      contentType,
    )

    res.json({ media_id: mediaId })
  } catch (err) {
    console.error('[Wechat/upload-thumb]', err.message)
    res.status(500).json({ error: `封面图片上传失败: ${err.message}` })
  }
})

// ── POST /api/wechat/draft ───────────────────────────────────────────────────
router.post('/draft', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  const { title, content, digest, thumb_media_id,need_open_comment=1,only_fans_can_comment=1 } = req.body
  if (!title || !content) {
    return res.status(400).json({ error: '标题和内容不能为空' })
  }

  const submitDraft = async (token) => {
    let finalThumbId = thumb_media_id
    if (!finalThumbId) {
      try {
        finalThumbId = await getDefaultThumbMediaId(creds.appId, token)
      } catch (thumbErr) {
        console.warn('[Wechat/draft] 默认封面上传失败，尝试无封面推送:', thumbErr.message)
      }
    }

    const article = {
      title:                 title.slice(0, 64),
      content,
      need_open_comment,
      only_fans_can_comment,
    }
    if (digest)        article.digest         = digest.slice(0, 120)
    if (finalThumbId)  article.thumb_media_id = finalThumbId

    return axios.post(
      'https://api.weixin.qq.com/cgi-bin/draft/add',
      { articles: [article] },
      { params: { access_token: token }, timeout: 15000 },
    )
  }

  try {
    let token = await getAccessToken(creds.appId, creds.appSecret)
    let resp  = await submitDraft(token)

    if (resp.data.errcode === 40001) {
      console.warn('[Wechat/draft] 收到 40001，强制刷新 token 后重试...')
      invalidateToken(creds.appId)
      token = await getAccessToken(creds.appId, creds.appSecret, { forceRefresh: true })
      resp  = await submitDraft(token)
    }

    if (resp.data.errcode && resp.data.errcode !== 0) {
      return res.status(400).json({
        error:   `推送失败: [${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    res.json({ success: true, media_id: resp.data.media_id })
  } catch (err) {
    console.error('[Wechat/draft]', err.message)
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
    return res.status(403).json({ error: 'Domain not allowed' })
  }

  try {
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
    console.error('[Wechat/proxy-img]', err.message)
    res.status(502).json({ error: '图片代理失败' })
  }
})

// ── GET /api/wechat/token（调试用）───────────────────────────────────────────
router.get('/token', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)
    const now   = Math.floor(Date.now() / 1000)
    const cached = _tokenCache.get(creds.appId)
    res.json({ token: token.slice(0, 16) + '...', expires_in: (cached?.exp ?? 0) - now })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/wechat/draft/:mediaId ───────────────────────────────────────────
router.get('/draft/:mediaId', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token   = await getAccessToken(creds.appId, creds.appSecret)
    const { mediaId } = req.params

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/draft/get',
      { media_id: mediaId },
      { params: { access_token: token }, timeout: 10000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    const first = resp.data.news_item?.[0] ?? {}
    res.json({
      title:     first.title   ?? '',
      content:   first.content ?? '',
      digest:    first.digest  ?? '',
      thumb_url: first.thumb_url ?? null,
    })
  } catch (err) {
    console.error('[Wechat/draft/get]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /api/wechat/draft/:mediaId ────────────────────────────────────────
router.delete('/draft/:mediaId', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token   = await getAccessToken(creds.appId, creds.appSecret)
    const { mediaId } = req.params

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/draft/delete',
      { media_id: mediaId },
      { params: { access_token: token }, timeout: 10000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    res.json({ success: true })
  } catch (err) {
    console.error('[Wechat/draft/delete]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/wechat/draft/:mediaId/publish ──────────────────────────────────
router.post('/draft/:mediaId/publish', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token   = await getAccessToken(creds.appId, creds.appSecret)
    const { mediaId } = req.params

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/freepublish/submit',
      { media_id: mediaId },
      { params: { access_token: token }, timeout: 15000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    res.json({ success: true, publish_id: resp.data.publish_id })
  } catch (err) {
    console.error('[Wechat/draft/publish]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/wechat/published ─────────────────────────────────────────────────
router.get('/published', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token  = await getAccessToken(creds.appId, creds.appSecret)
    const offset = parseInt(req.query.offset ?? '0', 10)
    const count  = Math.min(parseInt(req.query.count ?? '10', 10), 20)

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/freepublish/batchget',
      { offset, count, no_content: 1 },
      { params: { access_token: token }, timeout: 10000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    const items = (resp.data.item ?? []).map(item => {
      const first = item.content?.news_item?.[0] ?? {}
      return {
        article_id:  item.article_id,
        update_time: item.update_time,
        title:       first.title   ?? '（无标题）',
        digest:      first.digest  ?? '',
        thumb_url:   first.thumb_url ?? null,
        url:         first.url     ?? null,
        count:       item.content?.news_item?.length ?? 1,
      }
    })

    res.json({
      total_count: resp.data.total_count ?? 0,
      item_count:  resp.data.item_count  ?? items.length,
      items,
    })
  } catch (err) {
    console.error('[Wechat/published]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/wechat/materials ─────────────────────────────────────────────────
router.get('/materials', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token  = await getAccessToken(creds.appId, creds.appSecret)
    const type   = req.query.type ?? 'image'
    const offset = parseInt(req.query.offset ?? '0', 10)
    const count  = Math.min(parseInt(req.query.count ?? '20', 10), 20)

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/material/batchget_material',
      { type, offset, count },
      { params: { access_token: token }, timeout: 10000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    res.json({
      total_count: resp.data.total_count ?? 0,
      item_count:  resp.data.item_count  ?? 0,
      items:       resp.data.item ?? [],
    })
  } catch (err) {
    console.error('[Wechat/materials]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /api/wechat/material/:mediaId ─────────────────────────────────────
router.delete('/material/:mediaId', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token   = await getAccessToken(creds.appId, creds.appSecret)
    const { mediaId } = req.params

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/material/del_material',
      { media_id: mediaId },
      { params: { access_token: token }, timeout: 10000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
      return res.status(400).json({
        error: `[${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    res.json({ success: true })
  } catch (err) {
    console.error('[Wechat/material/delete]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/wechat/article-stats ────────────────────────────────────────────
router.get('/article-stats', async (req, res) => {
  const creds = getCredentials(req)
  if (!creds) return res.status(401).json({ error: '未提供公众号凭据' })

  try {
    const token = await getAccessToken(creds.appId, creds.appSecret)

    const now    = new Date()
    const endD   = req.query.end_date   ?? now.toISOString().slice(0, 10)
    const startD = req.query.begin_date ?? (() => {
      const d = new Date(now); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10)
    })()

    const resp = await axios.post(
      'https://api.weixin.qq.com/datacube/getarticleread',
      { begin_date: startD, end_date: endD },
      { params: { access_token: token }, timeout: 10000 },
    )

    if (resp.data.errcode && resp.data.errcode !== 0) {
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
          title:     row.title    ?? '',
          url:       row.ori_url  ?? null,
          read_num:  0,
          share_num: 0,
          date:      row.ref_date ?? '',
        }
      }
      byArticle[key].read_num  += row.int_page_read_count  ?? 0
      byArticle[key].share_num += row.share_count          ?? 0
    }

    res.json({
      begin_date: startD,
      end_date:   endD,
      list:       resp.data.list ?? [],
      articles:   Object.values(byArticle).sort((a, b) => b.read_num - a.read_num),
    })
  } catch (err) {
    console.error('[Wechat/article-stats]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router
