/**
 * 性能监控中间件
 * 记录每个 API 请求的响应时间、吞吐量、错误率等
 */

import { logger } from './logger.js'

// 性能指标存储
const metrics = {
  requests: [],
  byEndpoint: {},
  errors: [],
}

/**
 * 性能监控中间件
 */
export function performanceMonitorMiddleware(req, res, next) {
  const startTime = Date.now()
  const startMemory = process.memoryUsage().heapUsed

  // 保存原始的 res.json 和 res.send
  const originalJson = res.json
  const originalSend = res.send

  // 拦截响应
  res.json = function (data) {
    recordMetric(req, res, startTime, startMemory, 'json', data)
    return originalJson.call(this, data)
  }

  res.send = function (data) {
    recordMetric(req, res, startTime, startMemory, 'send', data)
    return originalSend.call(this, data)
  }

  // 处理错误
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      recordError(req, res, startTime)
    }
  })

  next()
}

/**
 * 记录性能指标
 */
function recordMetric(req, res, startTime, startMemory, type, data) {
  const duration = Date.now() - startTime
  const memoryDelta = process.memoryUsage().heapUsed - startMemory
  const endpoint = `${req.method} ${req.path}`

  const metric = {
    timestamp: new Date().toISOString(),
    endpoint,
    method: req.method,
    path: req.path,
    statusCode: res.statusCode,
    duration,
    memory: Math.round(memoryDelta / 1024), // KB
    userId: req.user?.id || 'anonymous',
  }

  // 添加到全局指标
  metrics.requests.push(metric)

  // 按端点统计
  if (!metrics.byEndpoint[endpoint]) {
    metrics.byEndpoint[endpoint] = {
      count: 0,
      totalDuration: 0,
      avgDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
      errors: 0,
    }
  }

  const endpointMetric = metrics.byEndpoint[endpoint]
  endpointMetric.count++
  endpointMetric.totalDuration += duration
  endpointMetric.avgDuration = Math.round(endpointMetric.totalDuration / endpointMetric.count)
  endpointMetric.minDuration = Math.min(endpointMetric.minDuration, duration)
  endpointMetric.maxDuration = Math.max(endpointMetric.maxDuration, duration)

  // 记录慢查询（超过 1 秒）
  if (duration > 1000) {
    logger.warn('PERF', `慢查询: ${endpoint}`, {
      duration: `${duration}ms`,
      statusCode: res.statusCode,
    })
  }

  // 保留最近 1000 条记录
  if (metrics.requests.length > 1000) {
    metrics.requests.shift()
  }
}

/**
 * 记录错误
 */
function recordError(req, res, startTime) {
  const duration = Date.now() - startTime
  const endpoint = `${req.method} ${req.path}`

  const error = {
    timestamp: new Date().toISOString(),
    endpoint,
    statusCode: res.statusCode,
    duration,
    userId: req.user?.id || 'anonymous',
  }

  metrics.errors.push(error)

  // 更新端点错误计数
  if (metrics.byEndpoint[endpoint]) {
    metrics.byEndpoint[endpoint].errors++
  }

  // 保留最近 500 条错误记录
  if (metrics.errors.length > 500) {
    metrics.errors.shift()
  }

  logger.error('API', `请求失败: ${endpoint}`, {
    statusCode: res.statusCode,
    duration: `${duration}ms`,
  })
}

/**
 * 获取性能统计
 */
export function getMetrics() {
  const now = Date.now()
  const oneHourAgo = now - 60 * 60 * 1000

  // 计算最近 1 小时的统计
  const recentRequests = metrics.requests.filter(r => {
    const timestamp = new Date(r.timestamp).getTime()
    return timestamp > oneHourAgo
  })

  const recentErrors = metrics.errors.filter(e => {
    const timestamp = new Date(e.timestamp).getTime()
    return timestamp > oneHourAgo
  })

  const avgDuration = recentRequests.length > 0
    ? Math.round(recentRequests.reduce((sum, r) => sum + r.duration, 0) / recentRequests.length)
    : 0

  const errorRate = recentRequests.length > 0
    ? (recentErrors.length / recentRequests.length * 100).toFixed(2)
    : 0

  return {
    summary: {
      totalRequests: metrics.requests.length,
      recentRequests: recentRequests.length,
      recentErrors: recentErrors.length,
      avgDuration: `${avgDuration}ms`,
      errorRate: `${errorRate}%`,
      timestamp: new Date().toISOString(),
    },
    byEndpoint: metrics.byEndpoint,
    recentErrors: recentErrors.slice(-20),
    slowQueries: recentRequests
      .filter(r => r.duration > 1000)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10),
  }
}

/**
 * 重置指标
 */
export function resetMetrics() {
  metrics.requests = []
  metrics.byEndpoint = {}
  metrics.errors = []
}
