/**
 * 图片库路由
 * GET    /api/images
 * GET    /api/images/categories
 * GET    /api/images/tags
 * GET    /api/images/stats
 * DELETE /api/images/:id
 * PATCH  /api/images/:id
 */
import { Router } from 'express'
import { loadImagesMetadata, saveImagesMetadata } from '../utils.js'

const router = Router()

// GET /api/images
router.get('/', (req, res) => {
  try {
    const { category, tags } = req.query
    const tagArray = tags ? tags.split(',') : null
    let metadata = loadImagesMetadata()
    if (category) metadata = metadata.filter(item => item.category === category)
    if (tagArray?.length) metadata = metadata.filter(item => tagArray.some(t => item.tags.includes(t)))
    res.json(metadata)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/images/categories
router.get('/categories', (req, res) => {
  try {
    const metadata = loadImagesMetadata()
    res.json([...new Set(metadata.map(item => item.category))])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/images/tags
router.get('/tags', (req, res) => {
  try {
    const metadata = loadImagesMetadata()
    res.json([...new Set(metadata.flatMap(item => item.tags))])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/images/stats
router.get('/stats', (req, res) => {
  try {
    const metadata  = loadImagesMetadata()
    const categories = [...new Set(metadata.map(item => item.category))]
    const providers  = [...new Set(metadata.map(item => item.provider))]
    res.json({
      totalImages: metadata.length,
      categories:  categories.length,
      providers:   providers.length,
      categoryBreakdown: categories.map(cat => ({ category: cat, count: metadata.filter(i => i.category === cat).length })),
      providerBreakdown: providers.map(prov => ({ provider: prov, count: metadata.filter(i => i.provider === prov).length })),
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// DELETE /api/images/:id
router.delete('/:id', (req, res) => {
  try {
    const filtered = loadImagesMetadata().filter(item => item.id !== req.params.id)
    saveImagesMetadata(filtered)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// PATCH /api/images/:id
router.patch('/:id', (req, res) => {
  try {
    const metadata = loadImagesMetadata()
    const index    = metadata.findIndex(item => item.id === req.params.id)
    if (index === -1) return res.status(404).json({ error: '图片不存在' })
    const { title, category, tags } = req.body
    metadata[index] = { ...metadata[index], ...{ title, category, tags }, updatedAt: new Date().toISOString() }
    saveImagesMetadata(metadata)
    res.json(metadata[index])
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

export default router
