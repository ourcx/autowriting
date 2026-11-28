import http from 'node:http'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const numberFromEnv = (name, fallback, minimum, maximum) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.trunc(value))) : fallback
}

export const createWatchdogState = () => ({ failures: 0, lastRestartAt: 0, restarting: false })

export function probeHealth(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, response => {
      response.resume()
      if (response.statusCode === 200) resolve()
      else reject(new Error(`health status ${response.statusCode || 0}`))
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error('health timeout')))
    request.once('error', reject)
  })
}

export async function watchdogTick(state, options) {
  if (state.restarting) return 'busy'
  try {
    await options.probe()
    if (state.failures > 0) options.report(`health recovered after ${state.failures} failure(s)`)
    state.failures = 0
    return 'healthy'
  } catch (error) {
    state.failures++
    const message = error instanceof Error ? error.message : String(error)
    options.report(`health failure ${state.failures}/${options.threshold}: ${message}`)
    if (state.failures < options.threshold) return 'failed'
    if (options.now() - state.lastRestartAt < options.cooldownMs) return 'cooldown'
    state.restarting = true
    try {
      await options.restart()
      state.lastRestartAt = options.now()
      state.failures = 0
      options.report('restarted autowriting after consecutive health failures')
      return 'restarted'
    } finally {
      state.restarting = false
    }
  }
}

function restartApp() {
  return new Promise((resolve, reject) => {
    execFile('pm2', ['restart', 'autowriting'], { timeout: 30_000 }, error => error ? reject(error) : resolve())
  })
}

export function startHealthWatchdog() {
  const healthUrl = process.env.WATCHDOG_HEALTH_URL || 'http://127.0.0.1:3000/health'
  const intervalMs = numberFromEnv('WATCHDOG_INTERVAL_MS', 15_000, 5_000, 60_000)
  const timeoutMs = numberFromEnv('WATCHDOG_TIMEOUT_MS', 5_000, 1_000, 15_000)
  const threshold = numberFromEnv('WATCHDOG_FAILURE_THRESHOLD', 4, 2, 10)
  const cooldownMs = numberFromEnv('WATCHDOG_RESTART_COOLDOWN_MS', 300_000, 60_000, 3_600_000)
  const state = createWatchdogState()
  const tick = () => watchdogTick(state, {
    probe: () => probeHealth(healthUrl, timeoutMs),
    restart: restartApp,
    report: message => process.stdout.write(`[watchdog] ${new Date().toISOString()} ${message}\n`),
    now: Date.now,
    threshold,
    cooldownMs,
  }).catch(error => process.stderr.write(`[watchdog] ${new Date().toISOString()} ${error instanceof Error ? error.message : String(error)}\n`))
  const timer = setInterval(tick, intervalMs)
  void tick()
  return () => clearInterval(timer)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) startHealthWatchdog()
