/**
 * 图片库路由（存储已迁移至 SQLite）
 * GET    /api/images
 * GET    /api/images/categories
 * GET    /api/images/tags
 * GET    /api/images/stats
 * DELETE /api/images/:id
 * PATCH  /api/images/:id
 */
import { Router } from 'express'
import { listImages, deleteImage, updateImage } from '../db.js'

const router = Router()

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
