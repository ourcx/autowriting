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
 */
import { Router } from 'express'
import { listImages, deleteImage, updateImage, addUploadedImage, listUploadedImages, deleteUploadedImage } from '../db.js'
import { DATA_DIR } from '../config.js'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

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
