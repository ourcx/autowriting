import cors, { type CorsOptions, type CorsOptionsDelegate } from "cors"
import helmet from "helmet"
import { ipKeyGenerator, rateLimit } from "express-rate-limit"
import type { ErrorRequestHandler, Request, RequestHandler } from "express"
import { logger } from "./logger.ts"

const DEFAULT_JSON_LIMIT = "1mb"
const LARGE_JSON_LIMIT = "30mb"
const URL_ENCODED_LIMIT = "1mb"
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_FAILURES = 5
const API_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const API_RATE_LIMIT_MAX = 300
const EXPENSIVE_RATE_LIMIT_MAX = 30

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function getAllowedOrigins(): Set<string> {
  const configured = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  const defaults = process.env.NODE_ENV === "production"
    ? []
    : ["http://localhost:5173", "http://127.0.0.1:5173"]

  return new Set([...defaults, ...configured].map(normalizeOrigin).filter((value): value is string => value !== null))
}

class CorsOriginError extends Error {
  readonly statusCode = 403

  constructor() {
    super("当前来源不允许访问此服务")
    this.name = "CorsOriginError"
  }
}

const allowedOrigins = getAllowedOrigins()
const corsOptionsDelegate: CorsOptionsDelegate<Request> = (req, callback) => {
  const origin = req.get("origin")
  const normalizedOrigin = origin ? normalizeOrigin(origin) : null
  const originHost = normalizedOrigin ? new URL(normalizedOrigin).host : null
  const isSameOrigin = originHost !== null && originHost === req.get("host")
  const isAllowed = !origin || isSameOrigin || (normalizedOrigin !== null && allowedOrigins.has(normalizedOrigin))

  const options: CorsOptions = {
    credentials: false,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    origin: isAllowed,
  }
  callback(isAllowed ? null : new CorsOriginError(), options)
}

export const corsMiddleware = cors(corsOptionsDelegate)

export const securityHeaders = [
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: process.env.NODE_ENV === "production"
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
  }),
  helmet.contentSecurityPolicy({
    reportOnly: true,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'", "https:", "http://127.0.0.1:*", "http://localhost:*"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
    },
  }),
  ((_req, res, next) => {
    res.removeHeader("Server")
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
    next()
  }) satisfies RequestHandler,
]

export const apiRateLimiter = rateLimit({
  windowMs: parsePositiveInteger(process.env.API_RATE_LIMIT_WINDOW_MS, API_RATE_LIMIT_WINDOW_MS),
  limit: parsePositiveInteger(process.env.API_RATE_LIMIT_MAX, API_RATE_LIMIT_MAX),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS",
  handler(_req, res) {
    res.status(429).json({ error: "请求过于频繁，请稍后再试" })
  },
})

const EXPENSIVE_OPERATION_PATHS = [
  /^\/articles\/[^/]+\/(?:generate|generate-candidates|candidates)/,
  /^\/canvas\/(?:generate|generate-blocks|regenerate)/,
  /^\/(?:generate-cover|generate-covers-batch)/,
  /^\/rag\/(?:index|search|candidates)/,
  /^\/(?:publish|toutiao|xiaohongshu)\//,
]

export const expensiveOperationRateLimiter = rateLimit({
  windowMs: parsePositiveInteger(process.env.EXPENSIVE_RATE_LIMIT_WINDOW_MS, API_RATE_LIMIT_WINDOW_MS),
  limit: parsePositiveInteger(process.env.EXPENSIVE_RATE_LIMIT_MAX, EXPENSIVE_RATE_LIMIT_MAX),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => req.method === "GET" || !EXPENSIVE_OPERATION_PATHS.some((pattern) => pattern.test(req.path)),
  handler(_req, res) {
    res.status(429).json({ error: "当前操作过于频繁，请稍后再试" })
  },
})

export const noStoreApiResponses: RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store")
  res.setHeader("Pragma", "no-cache")
  res.setHeader("Expires", "0")
  next()
}

export const loginRateLimiter = rateLimit({
  windowMs: parsePositiveInteger(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, LOGIN_WINDOW_MS),
  limit: parsePositiveInteger(process.env.LOGIN_RATE_LIMIT_MAX, LOGIN_MAX_FAILURES),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator(req) {
    const username = typeof req.body?.username === "string"
      ? req.body.username.trim().toLowerCase().slice(0, 64)
      : "<missing>"
    return `${ipKeyGenerator(req.ip || "unknown")}:${username}`
  },
  handler(_req, res) {
    res.status(429).json({ error: "登录尝试过于频繁，请稍后再试" })
  },
})

export const requestBodyLimits = {
  defaultJson: DEFAULT_JSON_LIMIT,
  largeJson: LARGE_JSON_LIMIT,
  urlEncoded: URL_ENCODED_LIMIT,
}

interface HttpError extends Error {
  status?: number
  statusCode?: number
  type?: string
  code?: string
}

export const errorHandler: ErrorRequestHandler = (error: HttpError, req, res, next) => {
  if (res.headersSent) {
    next(error)
    return
  }

  const isPayloadTooLarge = error.type === "entity.too.large" || error.code === "LIMIT_FILE_SIZE"
  const isInvalidJson = error instanceof SyntaxError && error.type === "entity.parse.failed"
  const status = isPayloadTooLarge
    ? 413
    : isInvalidJson
      ? 400
      : error.statusCode || error.status || 500
  const publicMessage = isPayloadTooLarge
    ? "请求内容过大"
    : isInvalidJson
      ? "JSON 格式不正确"
      : status >= 500
        ? "服务器内部错误"
        : error.message || "请求处理失败"

  logger.error("HTTP", "请求处理失败", {
    method: req.method,
    path: req.originalUrl,
    status,
    error: error.message,
  })
  res.status(status).json({ error: publicMessage })
}
