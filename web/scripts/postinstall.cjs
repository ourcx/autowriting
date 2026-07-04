/**
 * postinstall.cjs
 *
 * pnpm install 后自动为当前系统 Node.js 版本编译原生模块。
 * 1. better-sqlite3 — SQLite 驱动
 * 2. sharp — @xenova/transformers 的图像处理依赖（Linux 上常缺预编译二进制）
 *
 * 解决 pnpm 全局 store 恢复时丢失编译产物的问题。
 */

'use strict'

const { execSync } = require('child_process')
const { existsSync } = require('fs')
const path = require('path')

// ── better-sqlite3 ────────────────────────────────────────────────────────────

let bsDir
try {
  bsDir = path.dirname(require.resolve('better-sqlite3/package.json'))
} catch {
  console.log('[postinstall] better-sqlite3 未安装，跳过')
}

if (bsDir) {
  const nodeFile = path.join(bsDir, 'build', 'Release', 'better_sqlite3.node')

  if (existsSync(nodeFile)) {
    console.log('[postinstall] ✓ better-sqlite3 已编译:', nodeFile)
  } else {
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
  }
}

// ── sharp（@xenova/transformers 依赖）─────────────────────────────────────────
// sharp 在 Linux 上经常缺少预编译二进制，导致 @xenova/transformers import 失败。
// 这里检测并重建 sharp，确保本地向量模型可用。

let sharpDir
try {
  sharpDir = path.dirname(require.resolve('sharp/package.json'))
} catch {
  // sharp 可能是 @xenova/transformers 的可选依赖，未安装时跳过
  console.log('[postinstall] sharp 未安装，跳过（本地向量模型功能可能不可用）')
}

if (sharpDir) {
  const platform = process.platform
  const arch = process.arch
  // sharp 的原生二进制文件名格式：sharp-{platform}-{arch}.node
  const sharpNativeFile = path.join(sharpDir, 'build', 'Release', `sharp-${platform}-${arch}.node`)

  if (existsSync(sharpNativeFile)) {
    console.log(`[postinstall] ✓ sharp 原生二进制已就绪 (${platform}-${arch})`)
  } else {
    console.log(`[postinstall] sharp 原生二进制缺失 (${platform}-${arch})，尝试重建...`)

    try {
      // 优先用 npm rebuild（从预编译包安装）
      execSync('npm rebuild sharp', {
        cwd: sharpDir,
        stdio: 'inherit',
        env: { ...process.env, npm_config_build_from_source: 'false' },
      })
      console.log('[postinstall] ✓ sharp 重建完成')
    } catch {
      console.warn('[postinstall] ⚠ sharp npm rebuild 失败，尝试从源码编译...')

      try {
        execSync('npx --yes node-gyp rebuild', {
          cwd: sharpDir,
          stdio: 'inherit',
          env: { ...process.env },
        })
        console.log('[postinstall] ✓ sharp 从源码编译完成')
      } catch (e2) {
        console.error('[postinstall] ✗ sharp 编译失败:', e2.message)
        console.error('[postinstall] 本地向量模型（@xenova/transformers）将不可用。')
        console.error('[postinstall] 解决方法：')
        console.error('[postinstall]   npm install --platform=' + platform + ' --arch=' + arch + ' sharp')
        console.error('[postinstall] 或切换到远端 Embedding API（无需本地 sharp）')
        // 不 exit(1)，允许仅使用远端 Embedding
      }
    }
  }
}