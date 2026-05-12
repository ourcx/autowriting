/**
 * 管理员路由（仅 admin 角色可访问）
 * GET    /api/admin/users                    → 用户列表（含文章数）
 * POST   /api/admin/users                    → 创建用户
 * PATCH  /api/admin/users/:id/disable        → 禁用/启用用户
 * PATCH  /api/admin/users/:id/reset-password → 重置用户密码
 * DELETE /api/admin/users/:id                → 删除用户
 * GET    /api/admin/users/:id/articles       → 查看某用户的文章列表
 */
import { Router } from 'express'
import path from 'path'
import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import fs from 'fs'
import { DRAFTS_DIR } from '../config.js'
import { adminMiddleware } from '../authMiddleware.js'
import {
  listUsers, setUserDisabled, findUserById,
  createUser, findUserByUsername, updateUserPassword, deleteUser,
} from '../db.js'

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

router.get('/users', (_req, res) => {
  try {
    const users = listUsers()
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

// ── POST /api/admin/users（创建用户）─────────────────────────────────────────

router.post('/users', async (req, res) => {
  try {
    const { username, password, role = 'user' } = req.body
    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' })
    }
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: '用户名长度需在 3-20 个字符之间' })
    }
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username)) {
      return res.status(400).json({ error: '用户名只能包含字母、数字、下划线或中文' })
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码长度至少 6 位' })
    }
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: '角色必须为 user 或 admin' })
    }
    const existing = findUserByUsername(username)
    if (existing) return res.status(409).json({ error: '用户名已存在' })

    const id = randomUUID()
    const hash = await bcrypt.hash(password, 10)
    createUser(id, username, hash, role)
    res.json({ success: true, id, username, role })
  } catch (error) {
    console.error('[Admin] 创建用户失败:', error)
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

// ── PATCH /api/admin/users/:id/reset-password（重置密码）─────────────────────

router.patch('/users/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params
    const { password } = req.body
    if (!password || password.length < 6) {
      return res.status(400).json({ error: '新密码至少 6 位' })
    }
    const user = findUserById(id)
    if (!user) return res.status(404).json({ error: '用户不存在' })

    const hash = await bcrypt.hash(password, 10)
    updateUserPassword(id, hash)
    res.json({ success: true })
  } catch (error) {
    console.error('[Admin] 重置密码失败:', error)
    res.status(500).json({ error: error.message })
  }
})

// ── DELETE /api/admin/users/:id（删除用户）───────────────────────────────────

router.delete('/users/:id', (req, res) => {
  try {
    const { id } = req.params
    if (id === req.user.id) {
      return res.status(400).json({ error: '不能删除自己的账号' })
    }
    const user = findUserById(id)
    if (!user) return res.status(404).json({ error: '用户不存在' })

    deleteUser(id)
    res.json({ success: true })
  } catch (error) {
    console.error('[Admin] 删除用户失败:', error)
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
