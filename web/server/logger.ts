/**
 * 结构化日志系统
 * 支持日志级别、持久化、性能监控
 */

import fs from "fs"
import path from "path"
import { LOG_DIR } from "./config.ts"

// 日志级别定义
const LOG_LEVELS: Record<string, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

// 当前日志级别（从环境变量读取，默认 INFO）
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || "INFO"] ?? LOG_LEVELS.INFO

// 日志文件路径
const LOG_FILE = path.join(LOG_DIR, `app-${new Date().toISOString().split("T")[0]}.log`)

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

interface LogEntry {
  timestamp: string
  level: string
  module: string
  message: string
  data?: unknown
}

interface PerfData {
  operation: string
  duration: string
  memory?: string
  error?: string
  status: string
}

/**
 * 格式化日志时间戳
 */
function formatTimestamp(): string {
  return new Date().toISOString()
}

/**
 * 格式化日志消息
 */
function formatLog(level: string, module: string, message: string, data: unknown = null): LogEntry {
  const timestamp = formatTimestamp()
  const logEntry: LogEntry = {
    timestamp,
    level,
    module,
    message,
  }
  if (data) {
    logEntry.data = data
  }
  return logEntry
}

/**
 * 将日志写入文件
 */
function writeToFile(logEntry: LogEntry): void {
  try {
    const logLine = JSON.stringify(logEntry) + "\n"
    fs.appendFileSync(LOG_FILE, logLine, "utf8")
  } catch (e: unknown) {
    const err = e as Error
    console.error("[Logger] 写入日志文件失败:", err.message)
  }
}

/**
 * 输出日志到控制台
 */
function logToConsole(level: string, module: string, message: string, data: unknown = null): void {
  const timestamp = formatTimestamp()
  const prefix = `[${timestamp}] [${level}] [${module}]`

  if (data) {
    console.log(`${prefix} ${message}`, data)
  } else {
    console.log(`${prefix} ${message}`)
  }
}

/**
 * 核心日志函数
 */
function log(level: string, module: string, message: string, data: unknown = null): LogEntry {
  // 检查日志级别
  if ((LOG_LEVELS[level] ?? 0) < CURRENT_LEVEL) {
    return { timestamp: "", level, module, message } as LogEntry
  }

  const logEntry = formatLog(level, module, message, data)

  // 输出到控制台
  logToConsole(level, module, message, data)

  // 写入文件
  writeToFile(logEntry)

  // 返回日志条目（用于监控系统）
  return logEntry
}

/**
 * 日志 API
 */
export const logger = {
  debug: (module: string, message: string, data?: unknown) => log("DEBUG", module, message, data),
  info: (module: string, message: string, data?: unknown) => log("INFO", module, message, data),
  warn: (module: string, message: string, data?: unknown) => log("WARN", module, message, data),
  error: (module: string, message: string, data?: unknown) => log("ERROR", module, message, data),
}

/**
 * 性能监控装饰器
 * 用法: const result = await monitor('article-generation', async () => { ... })
 */
export async function monitor<T>(operationName: string, fn: () => Promise<T>, module = "PERF"): Promise<T> {
  const startTime = Date.now()
  const startMemory = process.memoryUsage().heapUsed

  try {
    const result = await fn()
    const duration = Date.now() - startTime
    const memoryDelta = process.memoryUsage().heapUsed - startMemory

    const perfData: PerfData = {
      operation: operationName,
      duration: `${duration}ms`,
      memory: `${(memoryDelta / 1024 / 1024).toFixed(2)}MB`,
      status: "success",
    }

    logger.info(module, `✓ ${operationName} 完成`, perfData)
    return result
  } catch (error: unknown) {
    const duration = Date.now() - startTime
    const err = error as Error
    const perfData: PerfData = {
      operation: operationName,
      duration: `${duration}ms`,
      error: err.message,
      status: "failed",
    }

    logger.error(module, `✗ ${operationName} 失败`, perfData)
    throw error
  }
}

/**
 * 获取日志文件内容（用于管理员面板）
 */
export function getLogContent(lines = 100): (LogEntry | { raw: string })[] {
  try {
    const content = fs.readFileSync(LOG_FILE, "utf8")
    const logLines = content.trim().split("\n")
    return logLines.slice(-lines).map((line) => {
      try {
        return JSON.parse(line) as LogEntry
      } catch {
        return { raw: line }
      }
    })
  } catch {
    return []
  }
}

interface LogStats {
  total: number
  byLevel: Record<string, number>
  byModule: Record<string, number>
  errors: Array<{ timestamp: string; module: string; message: string; data?: unknown }>
}

/**
 * 获取日志统计信息
 */
export function getLogStats(): LogStats {
  try {
    const content = fs.readFileSync(LOG_FILE, "utf8")
    const logLines = content.trim().split("\n")

    const stats: LogStats = {
      total: logLines.length,
      byLevel: { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0 },
      byModule: {},
      errors: [],
    }

    logLines.forEach((line) => {
      try {
        const entry = JSON.parse(line) as LogEntry
        stats.byLevel[entry.level] = (stats.byLevel[entry.level] || 0) + 1
        stats.byModule[entry.module] = (stats.byModule[entry.module] || 0) + 1

        if (entry.level === "ERROR") {
          stats.errors.push({
            timestamp: entry.timestamp,
            module: entry.module,
            message: entry.message,
            data: entry.data,
          })
        }
      } catch {
        // 忽略解析失败的行
      }
    })

    return stats
  } catch {
    return { total: 0, byLevel: {}, byModule: {}, errors: [] }
  }
}

/**
 * 清理旧日志文件（保留最近 30 天）
 */
export function cleanupOldLogs(daysToKeep = 30): void {
  try {
    const files = fs.readdirSync(LOG_DIR)
    const now = Date.now()
    const maxAge = daysToKeep * 24 * 60 * 60 * 1000

    files.forEach((file) => {
      if (file.startsWith("app-") && file.endsWith(".log")) {
        const filePath = path.join(LOG_DIR, file)
        const stat = fs.statSync(filePath)
        if (now - stat.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath)
          logger.info("LOGGER", `删除旧日志文件: ${file}`)
        }
      }
    })
  } catch (e: unknown) {
    const err = e as Error
    logger.error("LOGGER", "清理旧日志失败", { error: err.message })
  }
}

/**
 * 定时清理旧日志（每天凌晨 3 点）
 */
export function scheduleLogCleanup(): void {
  const now = new Date()
  const nextCleanup = new Date(now)
  nextCleanup.setHours(3, 0, 0, 0)

  if (nextCleanup <= now) {
    nextCleanup.setDate(nextCleanup.getDate() + 1)
  }

  const delay = nextCleanup.getTime() - now.getTime()

  setTimeout(() => {
    cleanupOldLogs()
    scheduleLogCleanup()
  }, delay)
}

// 启动日志清理任务
scheduleLogCleanup()

export { LOG_LEVELS }
