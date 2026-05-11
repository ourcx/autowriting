/**
 * 微信公众号路由
 * GET  /api/wechat/status       → 是否已绑定（不返回 secret）
 * POST /api/wechat/bind         → 保存 appId + appSecret 并立即验证
 * POST /api/wechat/unbind       → 清除绑定
 * GET  /api/wechat/account      → 账号基础信息（name / headimg / fans_count / account_type）
 * GET  /api/wechat/token        → 返回当前有效 token（内部调试用）
 * GET  /api/wechat/drafts       → 获取草稿箱列表（分页，?offset=0&count=10）
 * POST /api/wechat/draft        → 新增草稿（{ title, content, thumb_media_id? } HTML 格式）
 * POST /api/wechat/upload-thumb → 从 URL 下载图片并上传为微信永久素材，返回 { media_id }
 */
import { Router } from 'express'
import axios from 'axios'
import FormData from 'form-data'
import zlib from 'zlib'
import { getSetting, setSetting } from '../db.js'

const router = Router()

// ── Token 缓存（内存层，进程重启后从 DB 恢复）────────────────────────────────
let _cachedToken = null
let _tokenExp    = 0       // Unix 秒时间戳

/**
 * 获取有效的 access_token
 * 1. 内存有且未过期 → 直接返回
 * 2. DB 有且未过期  → 装填内存后返回
 * 3. 否则重新向微信换取
 */
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000)

  // 内存层
  if (_cachedToken && _tokenExp - now > 300) {
    return _cachedToken
  }

  // DB 层恢复
  const dbToken = getSetting('wechat_token')
  const dbExp   = parseInt(getSetting('wechat_token_exp') || '0', 10)
  if (dbToken && dbExp - now > 300) {
    _cachedToken = dbToken
    _tokenExp    = dbExp
    return dbToken
  }

  // 重新获取
  const appId     = getSetting('wechat_app_id')
  const appSecret = getSetting('wechat_app_secret')
  if (!appId || !appSecret) throw new Error('公众号未绑定，请先填写 AppID 和 AppSecret')

  const resp = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
    params: { grant_type: 'client_credential', appid: appId, secret: appSecret },
    timeout: 8000,
  })

  if (resp.data.errcode) {
    throw new Error(`微信 Token 获取失败: [${resp.data.errcode}] ${resp.data.errmsg}`)
  }

  const token      = resp.data.access_token
  const expiresIn  = resp.data.expires_in || 7200
  const expAt      = now + expiresIn

  // 写内存 + DB
  _cachedToken = token
  _tokenExp    = expAt
  setSetting('wechat_token',     token)
  setSetting('wechat_token_exp', String(expAt))

  return token
}

// ── GET /api/wechat/status ───────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const appId = getSetting('wechat_app_id')
  res.json({
    bound:  !!appId,
    appId:  appId || null,
  })
})

// ── POST /api/wechat/bind ────────────────────────────────────────────────────
router.post('/bind', async (req, res) => {
  const { appId, appSecret } = req.body
  if (!appId || !appSecret) {
    return res.status(400).json({ error: 'AppID 和 AppSecret 不能为空' })
  }

  try {
    // 先试着换一次 token，验证凭据有效
    const now = Math.floor(Date.now() / 1000)
    const resp = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
      params: { grant_type: 'client_credential', appid: appId, secret: appSecret },
      timeout: 8000,
    })

    if (resp.data.errcode) {
      return res.status(400).json({
        error: `验证失败: [${resp.data.errcode}] ${resp.data.errmsg}`,
        errcode: resp.data.errcode,
      })
    }

    const token     = resp.data.access_token
    const expiresIn = resp.data.expires_in || 7200
    const expAt     = now + expiresIn

    // 落库
    setSetting('wechat_app_id',    appId)
    setSetting('wechat_app_secret', appSecret)
    setSetting('wechat_token',     token)
    setSetting('wechat_token_exp', String(expAt))

    // 更新内存缓存
    _cachedToken = token
    _tokenExp    = expAt

    res.json({ success: true, appId })
  } catch (err) {
    const msg = err.response?.data?.errmsg || err.message
    res.status(500).json({ error: `绑定失败: ${msg}` })
  }
})

// ── POST /api/wechat/unbind ──────────────────────────────────────────────────
router.post('/unbind', (req, res) => {
  setSetting('wechat_app_id',          '')
  setSetting('wechat_app_secret',      '')
  setSetting('wechat_token',           '')
  setSetting('wechat_token_exp',       '')
  setSetting('wechat_default_thumb_id', '')  // 切换账号时清除封面缓存
  _cachedToken = null
  _tokenExp    = 0
  res.json({ success: true })
})

// ── GET /api/wechat/account ──────────────────────────────────────────────────
// 返回公众号基本信息：昵称 / 头像 / 关注人数 / 账号类型
// fans_count 需要单独调 /cgi-bin/user/get，基础信息接口不含此字段
router.get('/account', async (req, res) => {
  try {
    const token = await getAccessToken()

    // ── 1. 拉基础信息（订阅号可能返回 48001）──────────────────────────────
    let basicInfo = null
    let limited   = false

    const basicResp = await axios.get('https://api.weixin.qq.com/cgi-bin/account/getaccountbasicinfo', {
      params:  { access_token: token },
      timeout: 8000,
    })

    if (basicResp.data.errcode && basicResp.data.errcode !== 0) {
      if (basicResp.data.errcode === 48001) {
        // 订阅号无此权限，降级
        limited = true
      } else {
        throw new Error(`[${basicResp.data.errcode}] ${basicResp.data.errmsg}`)
      }
    } else {
      basicInfo = basicResp.data
    }

    // ── 2. 拉关注者列表（取 total = 总粉丝数；仅认证账号可调，未认证返回 48001）──
    let fansCount   = null   // null 表示无权限/未知，区别于 0
    let fansLimited = false
    try {
      const uResp = await axios.get('https://api.weixin.qq.com/cgi-bin/user/get', {
        params:  { access_token: token, next_openid: '' },
        timeout: 8000,
      })
      if (uResp.data.errcode === 48001) {
        // 未认证订阅号无此权限
        fansLimited = true
      } else if (!uResp.data.errcode || uResp.data.errcode === 0) {
        // total = 该账号关注总人数，count = 本次返回数量（最多 10000）
        fansCount = uResp.data.total ?? uResp.data.count ?? 0
      }
    } catch {
      // 拿不到粉丝数也没关系，继续返回其他信息
    }

    // head_img：未认证订阅号该字段可能是空字符串，统一转为 null
    const headImg = basicInfo?.head_img || basicInfo?.headimgurl || null
    const cleanHeadImg = headImg && headImg.trim() !== '' ? headImg : null

    // ── 3. 组装响应 ───────────────────────────────────────────────────────
    res.json({
      nickname:     basicInfo?.nick_name  || basicInfo?.nickname || getSetting('wechat_app_id'),
      headimgurl:   cleanHeadImg,
      fans_count:   fansCount,        // null = 无权限查询，number = 实际数量
      fans_limited: fansLimited,      // true = 账号未认证，无法查询粉丝数
      account_type: basicInfo?.service_type_info?.id === 2 ? 'service' : 'subscription',
      verify_type:  basicInfo?.verify_type_info?.id ?? -1,
      qrcode_url:   basicInfo?.qrcode_url || null,
      principal:    basicInfo?.principal_name || null,
      limited,
    })
  } catch (err) {
    const msg = err.message
    console.error('[Wechat/account]', msg)
    res.status(500).json({ error: msg })
  }
})

// ── GET /api/wechat/drafts ───────────────────────────────────────────────────
// 获取草稿箱列表，?offset=0&count=10
router.get('/drafts', async (req, res) => {
  try {
    const token  = await getAccessToken()
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

    // 把草稿列表精简后返回，content 字段只保留第一篇图文的 title/digest/thumb_url
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

// ── 运行时生成白色 PNG（使用 Node.js 内置 zlib，无需任何外部依赖）
// 微信封面要求可裁剪，尺寸至少需要可被裁剪，使用 900×383（公众号封面推荐比例）
// 纯白色图 DEFLATE 后极小，实际生成的 PNG 文件约 1KB
function createWhitePng(width = 900, height = 383) {
  // CRC32 查表法（PNG chunk 校验必须）
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

  // 构造 PNG chunk：[4字节长度][类型][数据][4字节CRC]
  const chunk = (type, data) => {
    const tBuf  = Buffer.from(type, 'ascii')
    const tData = Buffer.concat([tBuf, data])
    const len   = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const crc   = Buffer.alloc(4); crc.writeUInt32BE(crc32(tData))
    return Buffer.concat([len, tData, crc])
  }

  // IHDR：宽/高/位深=8/色彩=RGB(2)/压缩=0/滤镜=0/逐行=0
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width,  0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2  // bit depth=8, color type=RGB

  // 每行：滤镜字节(0=None) + width 个白色像素 RGB(0xFF,0xFF,0xFF)
  // 纯白色重复数据 DEFLATE 压缩率极高，整个 PNG 约 1KB
  const row = Buffer.alloc(1 + width * 3, 0xFF)
  row[0] = 0x00  // filter = None
  const rawData = Buffer.concat(Array.from({ length: height }, () => row))
  const idat = zlib.deflateSync(rawData)

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // PNG 签名
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 把一段图片 Buffer 上传到微信永久素材（type=image），返回 media_id。
 * 失败时抛出 Error。
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
 * 获取默认封面 media_id。
 * 优先从 DB 取缓存；若没有，则运行时生成一张 1×1 白色 PNG 上传并缓存。
 * 这样无论文章有没有图片，draft/add 都能带上合法的 thumb_media_id。
 */
async function getDefaultThumbMediaId(token) {
  const cached = getSetting('wechat_default_thumb_id')
  if (cached && cached.trim()) return cached   // 非空才用缓存

  const buf     = createWhitePng()
  const mediaId = await uploadBufferToWechat(token, buf, 'blank_thumb.png', 'image/png')
  setSetting('wechat_default_thumb_id', mediaId)
  console.log('[Wechat] 默认封面素材已上传，media_id:', mediaId)
  return mediaId
}

// ── POST /api/wechat/upload-thumb ───────────────────────────────────────────
// 从外部 URL 下载图片，上传为微信永久素材，返回 { media_id }
// body: { url: string }
router.post('/upload-thumb', async (req, res) => {
  const { url } = req.body
  if (!url) return res.status(400).json({ error: '缺少 url 参数' })

  try {
    const token = await getAccessToken()

    // 1. 下载图片（最大 2MB）
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

    // 2. 上传到微信永久素材
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
// 新增草稿
// body: { title: string, content: string (HTML), digest?: string, thumb_media_id?: string }
router.post('/draft', async (req, res) => {
  const { title, content, digest, thumb_media_id } = req.body
  if (!title || !content) {
    return res.status(400).json({ error: '标题和内容不能为空' })
  }

  try {
    const token = await getAccessToken()

    // 内联样式后 HTML 会膨胀，微信实际限制约 1MB（字节），不做字符数硬限制，
    // 由微信 API 自身报错（errcode: 45009 等）透传给前端。

    // thumb_media_id 是微信草稿必填字段；若前端没提供（文章无图/图片上传失败），
    // 用预置的默认白图兜底，避免 40007 错误。
    let finalThumbId = thumb_media_id
    if (!finalThumbId) {
      try {
        finalThumbId = await getDefaultThumbMediaId(token)
      } catch (thumbErr) {
        console.warn('[Wechat/draft] 默认封面上传失败，尝试无封面推送:', thumbErr.message)
      }
    }

    const article = {
      title:                 title.slice(0, 64),    // 最长 32 个汉字 ≈ 64 字节
      content,
      need_open_comment:     0,
      only_fans_can_comment: 0,
    }
    if (digest)        article.digest         = digest.slice(0, 120)
    if (finalThumbId)  article.thumb_media_id = finalThumbId

    const resp = await axios.post(
      'https://api.weixin.qq.com/cgi-bin/draft/add',
      { articles: [article] },
      { params: { access_token: token }, timeout: 15000 },
    )

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

// ── GET /api/wechat/token（调试用，不暴露 secret）────────────────────────────
router.get('/token', async (req, res) => {
  try {
    const token = await getAccessToken()
    const now   = Math.floor(Date.now() / 1000)
    res.json({ token: token.slice(0, 16) + '...', expires_in: _tokenExp - now })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
