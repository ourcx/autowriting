/**
 * Cron 定时任务管理路由
 *
 * GET    /api/cron/jobs              - 获取任务列表
 * POST   /api/cron/jobs              - 创建任务
 * GET    /api/cron/jobs/:id          - 获取单个任务
 * PUT    /api/cron/jobs/:id          - 更新任务
 * DELETE /api/cron/jobs/:id          - 删除任务
 * POST   /api/cron/jobs/:id/enable   - 启用任务
 * POST   /api/cron/jobs/:id/disable  - 禁用任务
 * POST   /api/cron/jobs/:id/run      - 立即执行
 * GET    /api/cron/jobs/:id/logs     - 获取执行日志
 * GET    /api/cron/logs              - 获取所有日志
 */
import { Router } from 'express'
import cron from 'node-cron'
import {
  listCronJobs, getCronJob, createCronJob, updateCronJob, deleteCronJob,
  listCronLogs, listAllCronLogs,
} from '../db.js'
import { authMiddleware } from '../authMiddleware.js'
import { scheduleJob, unscheduleJob, runCronJob } from '../cronEngine.js'

const router = Router()
router.use(authMiddleware)

// ── GET /api/cron/jobs ────────────────────────────────────────────────────────

router.get('/jobs', (req, res) => {
  try {
    const jobs = listCronJobs(req.user.id)
    res.json(jobs)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/cron/jobs ───────────────────────────────────────────────────────

router.post('/jobs', (req, res) => {
  try {
    const { name, cronExpr, topic, stylePrompt, coverPrompt, aiConfig, wxAppId, wxAppSecret } = req.body

    if (!name || !name.trim()) return res.status(400).json({ error: '任务名称不能为空' })
    if (!cronExpr) return res.status(400).json({ error: 'cron 表达式不能为空' })
    if (!cron.validate(cronExpr)) return res.status(400).json({ error: `无效的 cron 表达式: ${cronExpr}` })

    const id = `cj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const job = createCronJob({
      id,
      userId: req.user.id,
      name: name.trim(),
      cronExpr,
      enabled: true,
      topic: topic || '',
      stylePrompt: stylePrompt || '',
      coverPrompt: coverPrompt || '',
      aiConfig: aiConfig || {},
      wxAppId: wxAppId || '',
      wxAppSecret: wxAppSecret || '',
    })

    // 立即调度
    scheduleJob(job)

    res.json(job)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/cron/jobs/:id ────────────────────────────────────────────────────

router.get('/jobs/:id', (req, res) => {
  try {
    const job = getCronJob(req.params.id)
    if (!job) return res.status(404).json({ error: '任务不存在' })
    if (job.userId !== req.user.id) return res.status(403).json({ error: '无权访问' })
    res.json(job)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── PUT /api/cron/jobs/:id ────────────────────────────────────────────────────

router.put('/jobs/:id', (req, res) => {
  try {
    const job = getCronJob(req.params.id)
    if (!job) return res.status(404).json({ error: '任务不存在' })
    if (job.userId !== req.user.id) return res.status(403).json({ error: '无权访问' })

    const { name, cronExpr, topic, stylePrompt, coverPrompt, aiConfig, wxAppId, wxAppSecret } = req.body

    if (cronExpr && !cron.validate(cronExpr)) {
      return res.status(400).json({ error: `无效的 cron 表达式: ${cronExpr}` })
    }

    const updated = updateCronJob(req.params.id, {
      name, cronExpr, topic, stylePrompt, coverPrompt, aiConfig, wxAppId, wxAppSecret,
    })

    // 重新调度
    if (updated.enabled) {
      scheduleJob(updated)
    } else {
      unscheduleJob(updated.id)
    }

    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── DELETE /api/cron/jobs/:id ─────────────────────────────────────────────────

router.delete('/jobs/:id', (req, res) => {
  try {
    const job = getCronJob(req.params.id)
    if (!job) return res.status(404).json({ error: '任务不存在' })
    if (job.userId !== req.user.id) return res.status(403).json({ error: '无权访问' })

    unscheduleJob(req.params.id)
    deleteCronJob(req.params.id)
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/cron/jobs/:id/enable ───────────────────────────────────────────

router.post('/jobs/:id/enable', (req, res) => {
  try {
    const job = getCronJob(req.params.id)
    if (!job) return res.status(404).json({ error: '任务不存在' })
    if (job.userId !== req.user.id) return res.status(403).json({ error: '无权访问' })

    const updated = updateCronJob(req.params.id, { enabled: true })
    scheduleJob(updated)
    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/cron/jobs/:id/disable ──────────────────────────────────────────

router.post('/jobs/:id/disable', (req, res) => {
  try {
    const job = getCronJob(req.params.id)
    if (!job) return res.status(404).json({ error: '任务不存在' })
    if (job.userId !== req.user.id) return res.status(403).json({ error: '无权访问' })

    unscheduleJob(req.params.id)
    const updated = updateCronJob(req.params.id, { enabled: false })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/cron/jobs/:id/run （立即执行）───────────────────────────────────

router.post('/jobs/:id/run', async (req, res) => {
  try {
    const job = getCronJob(req.params.id)
    if (!job) return res.status(404).json({ error: '任务不存在' })
    if (job.userId !== req.user.id) return res.status(403).json({ error: '无权访问' })

    // 异步执行，立即返回任务启动确认
    res.json({ success: true, message: '任务已开始执行，请稍后查看日志' })

    // 后台执行（不阻塞响应）
    runCronJob(req.params.id).catch(e => {
      console.error(`[Cron] 手动触发执行失败 (${req.params.id}):`, e.message)
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/cron/jobs/:id/logs ───────────────────────────────────────────────

router.get('/jobs/:id/logs', (req, res) => {
  try {
    const job = getCronJob(req.params.id)
    if (!job) return res.status(404).json({ error: '任务不存在' })
    if (job.userId !== req.user.id) return res.status(403).json({ error: '无权访问' })

    const limit = Math.min(parseInt(req.query.limit || '20'), 100)
    const logs = listCronLogs(req.params.id, limit)
    res.json(logs)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/cron/logs （所有日志）────────────────────────────────────────────

router.get('/logs', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50'), 200)
    const logs = listAllCronLogs(req.user.id, limit)
    res.json(logs)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── GET /api/cron/validate-expr ───────────────────────────────────────────────

router.get('/validate-expr', (req, res) => {
  const { expr } = req.query
  if (!expr) return res.status(400).json({ error: '缺少 expr 参数' })
  const valid = cron.validate(expr)
  res.json({ valid })
})

export default router
