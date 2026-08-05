/**
 * JWT 认证中间件
 * - authMiddleware：验证 token，把 user 信息挂到 req.user
 * - adminMiddleware：在 authMiddleware 基础上要求 role === 'admin'
 * - requireAdmin：同 adminMiddleware，用于 CommonJS 模块
 */
import jwt from "jsonwebtoken"
import { timingSafeEqual } from "node:crypto"
import type { Response, NextFunction } from "express"
import { AGENT_API_KEY, AGENT_USERNAME } from "./config.ts"
import { findUserByUsername } from "./db.ts"
import { logger } from "./logger.ts"
import { JWT_SECRET } from "./routes/auth.ts"
import type { AuthedRequest } from "./types.ts"

function hasValidAgentApiKey(candidate: string): boolean {
  if (!AGENT_API_KEY || !candidate) return false
  const expected = Buffer.from(AGENT_API_KEY)
  const received = Buffer.from(candidate)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

function authenticateAgent(req: AuthedRequest, res: Response, next: NextFunction): boolean {
  const candidate = req.header("x-agent-api-key") || ""
  if (!candidate) return false
  if (!AGENT_API_KEY) {
    res.status(503).json({ error: "远程 Agent API 未启用" })
    return true
  }
  if (!hasValidAgentApiKey(candidate)) {
    res.status(401).json({ error: "Agent API Key 无效" })
    return true
  }

  const user = findUserByUsername(AGENT_USERNAME)
  if (!user || user.disabled) {
    logger.warn("AUTH", "远程 Agent 绑定用户不可用", { username: AGENT_USERNAME })
    res.status(503).json({ error: "远程 Agent 绑定用户不可用" })
    return true
  }
  req.user = { id: user.id, username: user.username, role: user.role }
  next()
  return true
}

export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (authenticateAgent(req, res, next)) return

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
