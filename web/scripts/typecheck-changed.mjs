#!/usr/bin/env node
/**
 * typecheck-changed.mjs —— 只对改动文件做 tsc 检查
 *
 * 增量约束策略：
 *   - 全量 tsc 会因为 12 个存量 TS6133 报错而误伤新代码
 *   - 这里只检查 git 中 staged + unstaged 的 .ts/.tsx 文件
 *   - 在 CI 上可用 `--base origin/main` 比对分支
 */

import { execSync, spawnSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(__dirname, '..')

function listChanged() {
  const args = process.argv.slice(2)
  const baseIdx = args.indexOf('--base')
  const base = baseIdx >= 0 ? args[baseIdx + 1] : null

  let raw = ''
  try {
    if (base) {
      raw = execSync(`git diff --name-only --diff-filter=ACMRTUXB ${base}...HEAD`, {
        cwd: WEB_ROOT,
        encoding: 'utf8',
      })
    } else {
      const a = execSync('git diff --name-only --cached --diff-filter=ACMRTUXB', { cwd: WEB_ROOT, encoding: 'utf8' })
      const b = execSync('git diff --name-only --diff-filter=ACMRTUXB', { cwd: WEB_ROOT, encoding: 'utf8' })
      raw = a + '\n' + b
    }
  } catch {
    return []
  }

  return [...new Set(raw.split('\n').map((s) => s.trim()).filter(Boolean))]
    .filter((p) => /^web\/src\/.+\.(ts|tsx)$/.test(p))
    .map((p) => p.replace(/^web\//, ''))
}

const changed = listChanged()
if (changed.length === 0) {
  console.log('✅ typecheck:changed: 没有 TS 文件改动')
  process.exit(0)
}

console.log(`🔍 typecheck:changed: ${changed.length} 个文件`)
changed.forEach((f) => console.log(`   - web/${f}`))

const r = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
  cwd: WEB_ROOT,
  encoding: 'utf8',
})

const errLines = (r.stdout || '').split('\n').filter(Boolean)
const changedSet = new Set(changed)
const matched = errLines.filter((line) => {
  const m = line.match(/^([^(]+)\(/)
  return m && changedSet.has(m[1])
})

if (matched.length === 0) {
  console.log('✅ typecheck:changed: 改动文件 0 个 TS 错误')
  process.exit(0)
}

console.error('\n❌ typecheck:changed: 改动文件存在 TS 错误：\n')
matched.forEach((l) => console.error('   ' + l))
console.error('\n📖 FIX 指引：')
console.error('   - 不要用 any、@ts-ignore、@ts-expect-error 糊过去')
console.error('   - 用 unknown + 类型守卫，或精确补全类型')
console.error('   - 详见 docs/agents/conventions.md')
process.exit(1)
