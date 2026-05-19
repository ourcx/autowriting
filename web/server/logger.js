/**
 * 结构化日志系统
 * 支持日志级别、持久化、性能监控
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 日志级别定义
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

// 当前日志级别（从环境变量读取，默认 INFO）
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'INFO']

// 日志文件路径
const LOG_DIR = path.join(__dirname, '..', '..', 'logs')
const LOG_FILE = path.join(LOG_DIR, `app-${new Date().toISOString().split('T')[0]}.log`)

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

/**
 * 格式化日志时间戳
 */
function formatTimestamp() {
  return new Date().toISOString()
}

/**
 * 格式化日志消息
 */
function formatLog(level, module, message, data = null) {
  const timestamp = formatTimestamp()
  const logEntry = {
    timestamp,
    level,
    module,
    message,
    ...(data && { data }),
  }
  return logEntry
}

/**
 * 将日志写入文件
 */
function writeToFile(logEntry) {
  try {
    const logLine = JSON.stringify(logEntry) + '\n'
    fs.appendFileSync(LOG_FILE, logLine, 'utf8')
  } catch (e) {
    console.error('[Logger] 写入日志文件失败:', e.message)
  }
}

/**
 * 输出日志到控制台
 */
function logToConsole(level, module, message, data = null) {
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
function log(level, module, message, data = null) {
  // 检查日志级别
  if (LOG_LEVELS[level] < CURRENT_LEVEL) {
    return
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
  debug: (module, message, data) => log('DEBUG', module, message, data),
  info: (module, message, data) => log('INFO', module, message, data),
  warn: (module, message, data) => log('WARN', module, message, data),
  error: (module, message, data) => log('ERROR', module, message, data),
}

/**
 * 性能监控装饰器
 * 用法: const result = await monitor('article-generation', async () => { ... })
 */
export async function monitor(operationName, fn, module = 'PERF') {
  const startTime = Date.now()
  const startMemory = process.memoryUsage().heapUsed

  try {
    const result = await fn()
    const duration = Date.now() - startTime
    const memoryDelta = process.memoryUsage().heapUsed - startMemory

    const perfData = {
      operation: operationName,
      duration: `${duration}ms`,
      memory: `${(memoryDelta / 1024 / 1024).toFixed(2)}MB`,
      status: 'success',
    }

    logger.info(module, `✓ ${operationName} 完成`, perfData)
    return result
  } catch (error) {
    const duration = Date.now() - startTime
    const perfData = {
      operation: operationName,
      duration: `${duration}ms`,
      error: error.message,
      status: 'failed',
    }

    logger.error(module, `✗ ${operationName} 失败`, perfData)
    throw error
  }
}

/**
 * 获取日志文件内容（用于管理员面板）
 */
export function getLogContent(lines = 100) {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8')
    const logLines = content.trim().split('\n')
    return logLines.slice(-lines).map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return { raw: line }
      }
    })
  } catch (e) {
    return []
  }
}

/**
 * 获取日志统计信息
 */
export function getLogStats() {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8')
    const logLines = content.trim().split('\n')

    const stats = {
      total: logLines.length,
      byLevel: { DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0 },
      byModule: {},
      errors: [],
    }

    logLines.forEach(line => {
      try {
        const entry = JSON.parse(line)
        stats.byLevel[entry.level] = (stats.byLevel[entry.level] || 0) + 1
        stats.byModule[entry.module] = (stats.byModule[entry.module] || 0) + 1

        if (entry.level === 'ERROR') {
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
  } catch (e) {
    return { total: 0, byLevel: {}, byModule: {}, errors: [] }
  }
}

/**
 * 清理旧日志文件（保留最近 30 天）
 */
export function cleanupOldLogs(daysToKeep = 30) {
  try {
    const files = fs.readdirSync(LOG_DIR)
    const now = Date.now()
    const maxAge = daysToKeep * 24 * 60 * 60 * 1000

    files.forEach(file => {
      if (file.startsWith('app-') && file.endsWith('.log')) {
        const filePath = path.join(LOG_DIR, file)
        const stat = fs.statSync(filePath)
        if (now - stat.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath)
          logger.info('LOGGER', `删除旧日志文件: ${file}`)
        }
      }
    })
  } catch (e) {
    logger.error('LOGGER', '清理旧日志失败', { error: e.message })
  }
}

/**
 * 定时清理旧日志（每天凌晨 3 点）
 */
export function scheduleLogCleanup() {
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
