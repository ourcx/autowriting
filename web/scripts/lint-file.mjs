#!/usr/bin/env node
/**
 * lint-file.mjs —— 对单个文件（或一组文件）跑 ESLint
 *
 * 用途：Claude Code PostToolUse hook 调它，做"编辑时立刻反馈"。
 *
 * 用法：
 *   node scripts/lint-file.mjs path/to/file.ts [more...]
 *
 * 设计原则：
 *   - 仅对 web/ 范围内的 .ts/.tsx/.js 跑
 *   - 自动跳过 dist / node_modules / electron / scripts
 *   - 退出码非 0 时，输出已经包含 FIX 指引（来自 ESLint 规则的 message）
 */

import { spawnSync } from 'node:child_process'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(WEB_ROOT, '..')

const targets = process.argv.slice(2)
if (targets.length === 0) {
  console.log('用法: lint-file.mjs <file> [file...]')
  process.exit(0)
}

// 归一化路径：可能是绝对路径、相对仓库根、或相对 web/
const eligible = []
for (const raw of targets) {
  const abs = resolve(process.cwd(), raw)
  const relRepo = relative(REPO_ROOT, abs)
  const relWeb = relative(WEB_ROOT, abs)

  if (relRepo.startsWith('..')) continue // 仓库外
  if (!/\.(ts|tsx|js|mjs|cjs)$/.test(abs)) continue
  if (/(^|\/)(node_modules|dist|dist-electron|\.cache|electron|scripts)\//.test(relRepo)) continue
  if (!relRepo.startsWith('web/')) continue
  eligible.push(relWeb)
}

if (eligible.length === 0) {
  console.log('lint-file: 没有可 lint 的目标')
  process.exit(0)
}

const r = spawnSync('npx', ['eslint', '--no-warn-ignored', ...eligible], {
  cwd: WEB_ROOT,
  stdio: 'inherit',
})
process.exit(r.status ?? 0)
