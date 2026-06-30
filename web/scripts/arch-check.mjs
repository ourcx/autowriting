#!/usr/bin/env node
/**
 * arch-check.mjs —— Harness 结构约束
 *
 * 配合 ESLint 一起强制项目分层规则。ESLint 检查"代码内"违规，
 * 本脚本检查"路由/组件级"宏观违规（缺鉴权、缺 layer 隔离等）。
 *
 * 退出码：
 *   0 = OK
 *   1 = 检测到违规（阻断 commit）
 *
 * 增量约束、存量豁免：
 *   - scripts/arch-baseline.json 中列出已知违规，不阻断
 *   - 新文件 / 改动文件出现新违规 → 阻断
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(WEB_ROOT, '..')

const BASELINE_FILE = join(__dirname, 'arch-baseline.json')
const baseline = existsSync(BASELINE_FILE)
  ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
  : { violations: [] }
const baselineSet = new Set(baseline.violations || [])

const violations = []

function record(file, rule, msg) {
  const rel = relative(REPO_ROOT, file)
  const key = `${rel}::${rule}`
  if (baselineSet.has(key)) return
  violations.push({ file: rel, rule, msg })
}

function walk(dir, exts, cb) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'dist-electron') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, exts, cb)
    else if (exts.some((e) => full.endsWith(e))) cb(full)
  }
}

// 规则 1：server/routes/**.js 必须挂 authMiddleware（豁免 auth.js）
const ROUTES_DIR = join(WEB_ROOT, 'server', 'routes')
if (existsSync(ROUTES_DIR)) {
  for (const f of readdirSync(ROUTES_DIR)) {
    if (!f.endsWith('.js') || f === 'auth.js') continue
    const full = join(ROUTES_DIR, f)
    const src = readFileSync(full, 'utf8')
    if (!/router\.use\(\s*authMiddleware\s*\)/.test(src)) {
      record(full, 'route-auth-missing', [
        `❌ ${f} 顶部未挂 router.use(authMiddleware)`,
        `✅ FIX：在 import 之后、第一个路由之前加 router.use(authMiddleware)`,
        `📖 See: docs/agents/structure.md#强约束`,
      ].join('\n   '))
    }
  }
}

// 规则 2：路由内禁直连 sqlite
if (existsSync(ROUTES_DIR)) {
  for (const f of readdirSync(ROUTES_DIR)) {
    if (!f.endsWith('.js')) continue
    const full = join(ROUTES_DIR, f)
    const src = readFileSync(full, 'utf8')
    if (/require\(['"]better-sqlite3['"]\)/.test(src) || /new\s+Database\s*\(/.test(src)) {
      record(full, 'route-direct-db', [
        `❌ 路由内直接使用 better-sqlite3 / new Database()`,
        `✅ FIX：所有 SQLite 操作必须经 web/server/db.js 暴露的函数`,
        `📖 See: docs/agents/structure.md#强约束`,
      ].join('\n   '))
    }
  }
}

// 规则 3：components/ 不引 store / pages
const COMP_DIR = join(WEB_ROOT, 'src', 'components')
if (existsSync(COMP_DIR)) {
  walk(COMP_DIR, ['.ts', '.tsx'], (full) => {
    const src = readFileSync(full, 'utf8')
    if (/from\s+['"][^'"]*\/store\/[^'"]+['"]/.test(src)) {
      record(full, 'component-import-store', [
        `❌ components/ 内禁止 import store/*`,
        `✅ FIX：状态由父级 page 通过 props 注入；UI 组件保持纯展示`,
        `📖 See: docs/agents/structure.md#强约束`,
      ].join('\n   '))
    }
    if (/from\s+['"][^'"]*\/pages\/[^'"]+['"]/.test(src)) {
      record(full, 'component-import-page', [
        `❌ components/ 内禁止 import pages/*（反向依赖）`,
        `✅ FIX：抽公共逻辑到 utils/ 或新组件`,
        `📖 See: docs/agents/structure.md#强约束`,
      ].join('\n   '))
    }
  })
}

// 规则 4：pages/ + components/ 禁裸 fetch
for (const dir of [join(WEB_ROOT, 'src', 'pages'), join(WEB_ROOT, 'src', 'components')]) {
  if (!existsSync(dir)) continue
  walk(dir, ['.ts', '.tsx'], (full) => {
    const src = readFileSync(full, 'utf8')
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (/^\s*(\/\/|\*|import )/.test(line)) continue
      if (/(^|[^.\w])(await\s+)?fetch\s*\(/.test(line) && !line.includes('apiFetch')) {
        record(full, 'page-bare-fetch', [
          `❌ ${relative(REPO_ROOT, full)}:${i + 1} 使用了裸 fetch()`,
          `✅ FIX：走 src/utils/apiHelpers.ts 的 apiFetch / apiPost 包装（统一鉴权头、错误处理）`,
          `📖 See: docs/agents/structure.md#强约束`,
        ].join('\n   '))
        break
      }
    }
  })
}

// 规则 5：路由文件超 800 行 → 拆分提示
if (existsSync(ROUTES_DIR)) {
  for (const f of readdirSync(ROUTES_DIR)) {
    if (!f.endsWith('.js')) continue
    const full = join(ROUTES_DIR, f)
    const lines = readFileSync(full, 'utf8').split('\n').length
    if (lines > 800) {
      record(full, 'route-too-big', [
        `⚠️ ${f} 已有 ${lines} 行，建议把业务工具抽到 server/utils.js 或拆子模块`,
        `✅ FIX：搜索本文件内 function/const 形式的辅助函数 → 移到 utils.js`,
        `📖 See: docs/agents/structure.md#强约束`,
      ].join('\n   '))
    }
  }
}

if (violations.length === 0) {
  console.log('✅ arch-check: 0 个新增违规')
  process.exit(0)
}
console.error(`\n❌ arch-check: 发现 ${violations.length} 个违规（baseline 之外）\n`)
for (const v of violations) {
  console.error(`[${v.rule}] ${v.file}`)
  console.error(`   ${v.msg}\n`)
}
console.error(
  '提示：如确为存量代码且暂不修复，可在 web/scripts/arch-baseline.json 的 violations 数组追加 "<相对路径>::<rule>"（仅限存量），禁止给新文件加豁免。'
)
process.exit(1)
