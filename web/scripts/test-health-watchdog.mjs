import assert from 'node:assert/strict'
import { createWatchdogState, watchdogTick } from './health-watchdog.mjs'

const state = createWatchdogState()
let restarts = 0
let now = 600_000
const reports = []
const options = {
  probe: async () => { throw new Error('fixture timeout') },
  restart: async () => { restarts++ },
  report: message => reports.push(message),
  now: () => now,
  threshold: 3,
  cooldownMs: 300_000,
}

assert.equal(await watchdogTick(state, options), 'failed')
assert.equal(await watchdogTick(state, options), 'failed')
assert.equal(await watchdogTick(state, options), 'restarted')
assert.equal(restarts, 1)
assert.equal(state.failures, 0)

now += 10_000
assert.equal(await watchdogTick(state, options), 'failed')
assert.equal(await watchdogTick(state, options), 'failed')
assert.equal(await watchdogTick(state, options), 'cooldown')
assert.equal(restarts, 1)

options.probe = async () => {}
assert.equal(await watchdogTick(state, options), 'healthy')
assert.equal(state.failures, 0)
assert.ok(reports.some(message => message.includes('restarted autowriting')))
process.stdout.write('health watchdog tests passed\n')
