// @ts-nocheck
/**
 * 监控和日志管理 API
 * 仅管理员可访问
 */

import express from 'express'
import { logger, getLogContent, getLogStats } from '../logger.js'
import { getMetrics, resetMetrics } from '../performanceMonitor.js'
import { adminMiddleware } from '../authMiddleware.js'

const router = express.Router()

/**
 * GET /api/monitoring/logs
 * 获取日志内容
 * 查询参数: lines=100 (默认 100 行)
 */
router.get('/logs', adminMiddleware, (req, res) => {
  try {
    const lines = parseInt(req.query.lines) || 100
    const logs = getLogContent(lines)

    res.json({
      success: true,
      data: {
        logs,
        count: logs.length,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error) {
    logger.error('MONITORING', '获取日志失败', { error: error.message })
    res.status(500).json({
      success: false,
      error: '获取日志失败',
    })
  }
})

/**
 * GET /api/monitoring/logs/stats
 * 获取日志统计信息
 */
router.get('/logs/stats', adminMiddleware, (req, res) => {
  try {
    const stats = getLogStats()

    res.json({
      success: true,
      data: {
        ...stats,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error) {
    logger.error('MONITORING', '获取日志统计失败', { error: error.message })
    res.status(500).json({
      success: false,
      error: '获取日志统计失败',
    })
  }
})

/**
 * GET /api/monitoring/metrics
 * 获取性能指标
 */
router.get('/metrics', adminMiddleware, (req, res) => {
  try {
    const metrics = getMetrics()

    res.json({
      success: true,
      data: metrics,
    })
  } catch (error) {
    logger.error('MONITORING', '获取性能指标失败', { error: error.message })
    res.status(500).json({
      success: false,
      error: '获取性能指标失败',
    })
  }
})

/**
 * POST /api/monitoring/metrics/reset
 * 重置性能指标
 */
router.post('/metrics/reset', adminMiddleware, (req, res) => {
  try {
    resetMetrics()
    logger.info('MONITORING', '性能指标已重置', { admin: req.user.username })

    res.json({
      success: true,
      message: '性能指标已重置',
    })
  } catch (error) {
    logger.error('MONITORING', '重置性能指标失败', { error: error.message })
    res.status(500).json({
      success: false,
      error: '重置性能指标失败',
    })
  }
})

/**
 * GET /api/monitoring/health
 * 系统健康检查
 */
router.get('/health', adminMiddleware, (req, res) => {
  try {
    const memUsage = process.memoryUsage()
    const uptime = process.uptime()

    const health = {
      status: 'healthy',
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      memory: {
        heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
        external: `${(memUsage.external / 1024 / 1024).toFixed(2)}MB`,
      },
      timestamp: new Date().toISOString(),
    }

    res.json({
      success: true,
      data: health,
    })
  } catch (error) {
    logger.error('MONITORING', '健康检查失败', { error: error.message })
    res.status(500).json({
      success: false,
      error: '健康检查失败',
    })
  }
})

/**
 * GET /api/monitoring/alerts
 * 获取告警信息（错误率高、慢查询等）
 */
router.get('/alerts', adminMiddleware, (req, res) => {
  try {
    const metrics = getMetrics()
    const stats = getLogStats()

    const alerts = []

    // 检查错误率
    const errorRate = parseFloat(metrics.summary.errorRate)
    if (errorRate > 5) {
      alerts.push({
        level: 'warning',
        type: 'high_error_rate',
        message: `错误率过高: ${errorRate}%`,
        timestamp: new Date().toISOString(),
      })
    }

    // 检查错误日志
    if (stats.byLevel.ERROR > 10) {
      alerts.push({
        level: 'warning',
        type: 'many_errors',
        message: `最近有 ${stats.byLevel.ERROR} 条错误日志`,
        timestamp: new Date().toISOString(),
      })
    }

    // 检查慢查询
    if (metrics.slowQueries.length > 5) {
      alerts.push({
        level: 'info',
        type: 'slow_queries',
        message: `检测到 ${metrics.slowQueries.length} 个慢查询`,
        timestamp: new Date().toISOString(),
      })
    }

    // 检查内存使用
    const memUsage = process.memoryUsage()
    const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal * 100).toFixed(2)
    if (heapUsagePercent > 80) {
      alerts.push({
        level: 'warning',
        type: 'high_memory_usage',
        message: `内存使用率过高: ${heapUsagePercent}%`,
        timestamp: new Date().toISOString(),
      })
    }

    res.json({
      success: true,
      data: {
        alerts,
        count: alerts.length,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error) {
    logger.error('MONITORING', '获取告警信息失败', { error: error.message })
    res.status(500).json({
      success: false,
      error: '获取告警信息失败',
    })
  }
})

export default router
