/**
 * 管理员路由（仅 admin 角色可访问）
 * GET   /api/admin/users                    → 用户列表
 * PATCH /api/admin/users/:id/disable        → 禁用/启用用户
 * GET   /api/admin/users/:id/articles       → 查看某用户的文章列表
 */
import { Router } from 'express'
import path from 'path'
import { DRAFTS_DIR } from '../config.js'
import { adminMiddleware } from '../authMiddleware.js'
import { listUsers, setUserDisabled, findUserById } from '../db.js'

// 复用 articles.js 里的扫描逻辑（这里直接内联，避免循环依赖）
import fs from 'fs'

function getUserDraftsDir(userId) {
  return path.join(DRAFTS_DIR, userId)
}

function scanArticlesInDir(draftsDir) {
  if (!fs.existsSync(draftsDir)) return []
  const articleMap = new Map()
  const dateDirs = fs.readdirSync(draftsDir)
    .filter(f => /^\d{8}/.test(f))
    .sort((a, b) => {
      const dateA = a.substring(0, 8)
      const dateB = b.substring(0, 8)
      return dateA !== dateB ? dateB.localeCompare(dateA) : b.localeCompare(a)
    })

  for (const dateDir of dateDirs) {
    const promptDir = path.join(draftsDir, dateDir, 'prompt')
    const rawDir    = path.join(draftsDir, dateDir, 'raw')
    const hasPromptDir = fs.existsSync(promptDir)
    const hasRawDir    = fs.existsSync(rawDir)
    if (!hasPromptDir && !hasRawDir) continue

    const taskFiles = hasPromptDir
      ? fs.readdirSync(promptDir).filter(f => f.startsWith('task') && f.endsWith('.md'))
      : []

    if (taskFiles.length === 0) {
      const articleId = dateDir
      let title = ''
      const titlePath = path.join(draftsDir, dateDir, 'title.txt')
      if (fs.existsSync(titlePath)) title = fs.readFileSync(titlePath, 'utf-8').trim()
      if (!title) {
        const p = path.join(rawDir, 'article_raw.md')
        if (fs.existsSync(p)) {
          const firstLine = fs.readFileSync(p, 'utf-8').split('\n')[0]?.replace(/^#+\s*/, '').trim()
          if (firstLine) title = firstLine
        }
      }
      if (!title) title = `文章 ${articleId}`
      if (!articleMap.has(articleId)) {
        articleMap.set(articleId, { id: articleId, date: dateDir, title, status: 'draft', createdAt: new Date().toISOString() })
      }
      continue
    }

    for (const taskFile of taskFiles) {
      let articleId = dateDir
      if (taskFile !== 'task.md') {
        const suffix = taskFile.replace('task', '').replace('.md', '')
        articleId = `${dateDir}${suffix}`
      }
      const taskPath    = path.join(promptDir, taskFile)
      const articlePath = path.join(rawDir, taskFile.replace('task', 'article_raw'))
      const titlePath   = path.join(draftsDir, dateDir, `title${taskFile.replace('task.md', '')}.txt`)

      let title = ''
      let status = 'draft'
      if (fs.existsSync(titlePath)) {
        title = fs.readFileSync(titlePath, 'utf-8').trim()
      } else if (fs.existsSync(articlePath)) {
        const firstLine = fs.readFileSync(articlePath, 'utf-8').split('\n')[0]?.replace(/^#+\s*/, '').trim()
        if (firstLine) title = firstLine
      } else if (fs.existsSync(taskPath)) {
        const match = fs.readFileSync(taskPath, 'utf-8').match(/文章主题[：:]\s*(.+)/i)
        if (match) title = match[1].trim()
      }
      if (!title) title = `文章 ${articleId}`
      if (fs.existsSync(articlePath)) status = 'generated'
      if (!articleMap.has(articleId)) {
        articleMap.set(articleId, { id: articleId, date: dateDir, title, status, createdAt: new Date().toISOString() })
      }
    }
  }
  return [...articleMap.values()]
}

const router = Router()

// 所有 admin 路由需要管理员权限
router.use(adminMiddleware)

// ── GET /api/admin/users ──────────────────────────────────────────────────────

router.get('/users', (req, res) => {
  try {
    const users = listUsers()
    // 附带每个用户的文章数
    const result = users.map(u => ({
      ...u,
      articleCount: scanArticlesInDir(getUserDraftsDir(u.id)).length,
    }))
    res.json(result)
  } catch (error) {
    console.error('[Admin] 获取用户列表失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── PATCH /api/admin/users/:id/disable ───────────────────────────────────────

router.patch('/users/:id/disable', (req, res) => {
  try {
    const { id } = req.params
    const { disabled } = req.body

    if (typeof disabled !== 'boolean') {
      return res.status(400).json({ error: 'disabled 字段必须是 boolean' })
    }

    const user = findUserById(id)
    if (!user) return res.status(404).json({ error: '用户不存在' })

    // 不允许禁用自己（防止把唯一 admin 锁死）
    if (id === req.user.id) {
      return res.status(400).json({ error: '不能禁用自己的账号' })
    }

    setUserDisabled(id, disabled)
    res.json({ success: true, id, disabled })
  } catch (error) {
    console.error('[Admin] 修改用户状态失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── GET /api/admin/users/:id/articles ────────────────────────────────────────

router.get('/users/:id/articles', (req, res) => {
  try {
    const { id } = req.params
    const user = findUserById(id)
    if (!user) return res.status(404).json({ error: '用户不存在' })

    const articles = scanArticlesInDir(getUserDraftsDir(id))
    res.json(articles)
  } catch (error) {
    console.error('[Admin] 获取用户文章失败:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
