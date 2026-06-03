/**
 * 图片库路由（存储已迁移至 SQLite）
 * GET    /api/images
 * GET    /api/images/categories
 * GET    /api/images/tags
 * GET    /api/images/stats
 * DELETE /api/images/:id
 * PATCH  /api/images/:id
 *
 * 图片上传（本地文件存储）：
 * POST   /api/images/upload          上传图片，返回可访问 URL
 * GET    /api/images/uploads/:filename 提供上传图片的静态访问
 * DELETE /api/images/uploads/:id      删除上传的图片
 *
 * 图床上传（Imgur CDN）：
 * POST   /api/images/upload-imgur    上传图片到 Imgur，返回 CDN URL
 */
import { Router } from 'express'
import { listImages, deleteImage, updateImage, addUploadedImage, listUploadedImages, deleteUploadedImage, addImageToLibrary } from '../db.js'
import { DATA_DIR } from '../config.js'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import https from 'https'

const router = Router()

// 上传目录
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// multer 配置：保存到本地
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png'
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`)
  },
})
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('只允许上传图片文件'))
  },
})

// ── 上传图片 ──────────────────────────────────────────────────────────────────

// POST /api/images/upload  (multipart/form-data, field: image)
router.post('/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未收到图片文件' })
    const id = randomUUID()
    const record = addUploadedImage({
      id,
      filename:     req.file.filename,
      originalName: req.file.originalname,
      mimeType:     req.file.mimetype,
      size:         req.file.size,
      articleId:    req.body.articleId || null,
    })
    const url = `/api/images/uploads/${req.file.filename}`
    res.json({ ...record, url })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// POST /api/images/upload-base64  (JSON body: { data, mimeType, originalName, articleId })
router.post('/upload-base64', (req, res) => {
  try {
    const { data, mimeType = 'image/png', originalName = 'image.png', articleId } = req.body
    if (!data) return res.status(400).json({ error: '缺少 base64 数据' })

    const base64Data = data.replace(/^data:image\/\w+;base64,/, '')
    const buf = Buffer.from(base64Data, 'base64')

    if (buf.length > 20 * 1024 * 1024) return res.status(400).json({ error: '图片超过 20MB 限制' })

    const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
    const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf)

    const id = randomUUID()
    const record = addUploadedImage({ id, filename, originalName, mimeType, size: buf.length, articleId: articleId || null })
    const url = `/api/images/uploads/${filename}`
    
    // 同时添加到图片库
    const title = originalName.replace(/\.[^.]+$/, '') // 移除扩展名作为标题
    addImageToLibrary(url, title, 'cover', [], 'upload')
    
    res.json({ ...record, url })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/images/uploads/:filename  静态图片访问
router.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(UPLOAD_DIR, path.basename(req.params.filename))
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '图片不存在' })
  res.sendFile(filePath)
})

// GET /api/images/uploaded?articleId=xxx  查询已上传图片列表
router.get('/uploaded', (req, res) => {
  try {
    const { articleId } = req.query
    const list = listUploadedImages(articleId ? { articleId } : {})
    res.json(list.map(r => ({ ...r, url: `/api/images/uploads/${r.filename}` })))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// DELETE /api/images/uploaded/:id
router.delete('/uploaded/:id', (req, res) => {
  try {
    const filename = deleteUploadedImage(req.params.id)
    if (filename) {
      const filePath = path.join(UPLOAD_DIR, filename)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ── Imgur 图床上传 ────────────────────────────────────────────────────────────

/**
 * 用 Node 原生 https 模块向 Imgur API 上传图片（base64），避免额外依赖。
 * @param {string} base64Data  纯 base64 字符串（不含 data: 前缀）
 * @param {string} clientId    Imgur Client ID
 * @returns {Promise<string>}  图片的直链 URL
 */
function uploadToImgur(base64Data, clientId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ image: base64Data, type: 'base64' })
    const options = {
      hostname: 'api.imgur.com',
      path: '/3/image',
      method: 'POST',
      headers: {
        Authorization: `Client-ID ${clientId}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (parsed.success && parsed.data?.link) {
            resolve(parsed.data.link)
          } else {
            reject(new Error(parsed.data?.error || 'Imgur 上传失败'))
          }
        } catch {
          reject(new Error('Imgur 响应解析失败'))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// POST /api/images/upload-imgur  (multipart/form-data, field: image)
// 优先从请求头 x-imgur-client-id 读取 Client ID，其次从请求体 clientId 字段
const uploadImgur = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // Imgur 免费限制 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('只允许上传图片文件'))
  },
})

router.post('/upload-imgur', uploadImgur.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未收到图片文件' })

    const clientId = (req.headers['x-imgur-client-id'] || req.body.clientId || '').trim()
    if (!clientId) {
      return res.status(400).json({ error: '缺少 Imgur Client ID，请在「AI 配置 → 图床」中填写' })
    }

    const base64Data = req.file.buffer.toString('base64')
    const link = await uploadToImgur(base64Data, clientId)
    res.json({ url: link })
  } catch (error) {
    console.error('[imgur] upload error:', error.message)
    res.status(500).json({ error: error.message || 'Imgur 上传失败' })
  }
})

// ── GitHub + jsDelivr 图床上传 ────────────────────────────────────────────────

/**
 * 通过 GitHub Contents API 上传图片，返回 jsDelivr CDN URL。
 * jsDelivr URL 格式：https://cdn.jsdelivr.net/gh/{owner}/{repo}@{branch}/{path}
 */
function uploadToGitHub({ base64Data, filename, token, repo, branch, dirPath }) {
  return new Promise((resolve, reject) => {
    const filePath = `${dirPath}${filename}`
    const bodyObj = {
      message: `upload image ${filename}`,
      content: base64Data,
      branch,
    }
    const body = JSON.stringify(bodyObj)
    const [owner, repoName] = repo.split('/')
    if (!owner || !repoName) {
      return reject(new Error('GitHub 仓库格式错误，应为 username/repo'))
    }

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repoName}/contents/${filePath}`,
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'autowriting-app',
        Accept: 'application/vnd.github.v3+json',
      },
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode === 201 || res.statusCode === 200) {
          // jsDelivr CDN URL，国内加速访问
          const cdnUrl = `https://cdn.jsdelivr.net/gh/${owner}/${repoName}@${branch}/${filePath}`
          resolve(cdnUrl)
        } else {
          try {
            const parsed = JSON.parse(data)
            reject(new Error(parsed.message || `GitHub API 错误 ${res.statusCode}`))
          } catch {
            reject(new Error(`GitHub API 错误 ${res.statusCode}`))
          }
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// POST /api/images/upload-github  (multipart/form-data, field: image)
// Headers: x-github-token / x-github-repo / x-github-branch / x-github-path
const uploadGithub = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('只允许上传图片文件'))
  },
})

router.post('/upload-github', uploadGithub.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未收到图片文件' })

    const token  = (req.headers['x-github-token'] || '').trim()
    const repo   = (req.headers['x-github-repo'] || '').trim()
    const branch = (req.headers['x-github-branch'] || 'main').trim()
    const rawPath = (req.headers['x-github-path'] || 'images/').trim()
    // 确保目录以 / 结尾
    const dirPath = rawPath.endsWith('/') ? rawPath : `${rawPath}/`

    if (!token) return res.status(400).json({ error: '缺少 GitHub Token，请在「AI 配置 → 图床」中填写' })
    if (!repo)  return res.status(400).json({ error: '缺少 GitHub 仓库，请在「AI 配置 → 图床」中填写' })

    // 生成唯一文件名，避免覆盖
    const ext = path.extname(req.file.originalname) || '.png'
    const filename = `${Date.now()}-${randomUUID().slice(0, 6)}${ext}`
    const base64Data = req.file.buffer.toString('base64')

    const cdnUrl = await uploadToGitHub({ base64Data, filename, token, repo, branch, dirPath })
    res.json({ url: cdnUrl })
  } catch (error) {
    console.error('[github-cdn] upload error:', error.message)
    res.status(500).json({ error: error.message || 'GitHub 上传失败' })
  }
})

// ── 图片库（原有接口）────────────────────────────────────────────────────────

// GET /api/images
router.get('/', (req, res) => {
  try {
    const { category, tags } = req.query
    const tagArray = tags ? tags.split(',').filter(Boolean) : null
    res.json(listImages({ category, tags: tagArray }))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/images/categories
router.get('/categories', (req, res) => {
  try {
    const images = listImages()
    res.json([...new Set(images.map(i => i.category).filter(Boolean))])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/images/tags
router.get('/tags', (req, res) => {
  try {
    const images = listImages()
    res.json([...new Set(images.flatMap(i => i.tags))])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/images/stats
router.get('/stats', (req, res) => {
  try {
    const images    = listImages()
    const categories = [...new Set(images.map(i => i.category).filter(Boolean))]
    const providers  = [...new Set(images.map(i => i.provider).filter(Boolean))]
    res.json({
      totalImages:       images.length,
      categories:        categories.length,
      providers:         providers.length,
      categoryBreakdown: categories.map(cat => ({ category: cat, count: images.filter(i => i.category === cat).length })),
      providerBreakdown: providers.map(p => ({ provider: p, count: images.filter(i => i.provider === p).length })),
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// DELETE /api/images/:id
router.delete('/:id', (req, res) => {
  try {
    deleteImage(req.params.id)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// PATCH /api/images/:id
router.patch('/:id', (req, res) => {
  try {
    const { title, category, tags } = req.body
    const updated = updateImage(req.params.id, { title, category, tags })
    if (!updated) return res.status(404).json({ error: '图片不存在' })
    res.json(updated)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router
