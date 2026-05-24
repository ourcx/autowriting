/**
 * postinstall.cjs
 *
 * pnpm install 后自动为当前系统 Node.js 版本编译 better-sqlite3。
 * 解决 pnpm 全局 store 恢复时丢失编译产物的问题。
 */

'use strict'

const { execSync } = require('child_process')
const { existsSync } = require('fs')
const path = require('path')

// 找到 better-sqlite3 的实际安装目录
let bsDir
try {
  bsDir = path.dirname(require.resolve('better-sqlite3/package.json'))
} catch {
  console.log('[postinstall] better-sqlite3 未安装，跳过')
  process.exit(0)
}

const nodeFile = path.join(bsDir, 'build', 'Release', 'better_sqlite3.node')

if (existsSync(nodeFile)) {
  console.log('[postinstall] ✓ better-sqlite3 已编译:', nodeFile)
  process.exit(0)
}

console.log('[postinstall] better-sqlite3 未编译，开始编译（Node ' + process.version + '）...')

try {
  execSync('npx --yes node-gyp rebuild', {
    cwd: bsDir,
    stdio: 'inherit',
    env: { ...process.env },
  })
  console.log('[postinstall] ✓ better-sqlite3 编译完成')
} catch (e) {
  console.error('[postinstall] ✗ 编译失败:', e.message)
  console.error('[postinstall] 请手动运行: pnpm rebuild:native')
  // 不 exit(1)，避免 pnpm install 整体失败
}
