/**
 * JWT 认证中间件
 * - authMiddleware：验证 token，把 user 信息挂到 req.user
 * - adminMiddleware：在 authMiddleware 基础上要求 role === 'admin'
 */
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from './routes/auth.js'

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录，请先登录' })
  }

  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = { id: payload.id, username: payload.username, role: payload.role }
    next()
  } catch {
    return res.status(401).json({ error: 'Token 无效或已过期，请重新登录' })
  }
}

export function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: '无管理员权限' })
    }
    next()
  })
}
