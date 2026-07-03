// @ts-nocheck
/**
 * 认证路由
 * POST /api/auth/register  → 注册新用户
 * POST /api/auth/login     → 登录，返回 JWT
 * GET  /api/auth/me        → 获取当前用户信息（需 token）
 * POST /api/auth/change-password → 修改当前用户密码（需 token）
 */
import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { findUserByUsername, findUserById, createUser } from '../db.js'
import { authMiddleware } from '../authMiddleware.js'

export const JWT_SECRET = process.env.JWT_SECRET || 'autowriting-jwt-secret-change-me'
const JWT_EXPIRES = '30d'

const router = Router()

// ── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', (req, res) => {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' })
  }
  if (username.length < 2 || username.length > 32) {
    return res.status(400).json({ error: '用户名长度需 2-32 位' })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少 6 位' })
  }
  if (!/^[\w\u4e00-\u9fff-]+$/.test(username)) {
    return res.status(400).json({ error: '用户名只能含字母、数字、汉字、下划线、连字符' })
  }

  const existing = findUserByUsername(username)
  if (existing) {
    return res.status(409).json({ error: '用户名已被使用' })
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const hash = bcrypt.hashSync(password, 10)
  createUser(id, username, hash)

  const token = jwt.sign({ id, username, role: 'user' }, JWT_SECRET, { expiresIn: JWT_EXPIRES })
  res.json({ token, user: { id, username, role: 'user' } })
})

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' })
  }

  const user = findUserByUsername(username)
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  if (user.disabled) {
    return res.status(403).json({ error: '账号已被禁用，请联系管理员' })
  }
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' })
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES },
  )
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } })
})

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authMiddleware, (req, res) => {
  const user = findUserById(req.user.id)
  if (!user) return res.status(404).json({ error: '用户不存在' })
  if (user.disabled) return res.status(403).json({ error: '账号已被禁用' })
  res.json({ user })
})

// ── POST /api/auth/change-password ───────────────────────────────────────────
router.post('/change-password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: '原密码和新密码不能为空' })
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: '新密码至少 6 位' })
  }

  const user = findUserByUsername(req.user.username)
  if (!user || !bcrypt.compareSync(oldPassword, user.password_hash)) {
    return res.status(401).json({ error: '原密码错误' })
  }

  const hash = bcrypt.hashSync(newPassword, 10)
  import('../db.js').then(({ updateUserPassword }) => {
    updateUserPassword(user.id, hash)
    res.json({ success: true })
  })
})

export default router
