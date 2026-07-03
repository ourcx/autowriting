/**
 * JWT 认证中间件
 * - authMiddleware：验证 token，把 user 信息挂到 req.user
 * - adminMiddleware：在 authMiddleware 基础上要求 role === 'admin'
 * - requireAdmin：同 adminMiddleware，用于 CommonJS 模块
 */
import jwt from "jsonwebtoken"
import type { Response, NextFunction } from "express"
import { JWT_SECRET } from "./routes/auth.ts"
import type { AuthedRequest } from "./types.ts"

export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "未登录，请先登录" })
    return
  }

  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id: string; username: string; role: "admin" | "user" }
    req.user = { id: payload.id, username: payload.username, role: payload.role }
    next()
  } catch {
    res.status(401).json({ error: "Token 无效或已过期，请重新登录" })
  }
}

export function adminMiddleware(req: AuthedRequest, res: Response, next: NextFunction): void {
  authMiddleware(req, res, () => {
    if (req.user?.role !== "admin") {
      res.status(403).json({ error: "无管理员权限" })
      return
    }
    next()
  })
}

// 导出为 CommonJS 兼容的函数
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  adminMiddleware(req, res, next)
}