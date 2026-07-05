/**
 * 数据库备份脚本
 *
 * 功能:
 *   1. 将 SQLite 数据库备份到指定目录（默认 web/data/backups/）
 *   2. 同时备份文章草稿目录（公众号写作/drafts/）
 *   3. 自动清理超过保留期的旧备份
 *   4. 支持手动运行和定时任务（cron）两种模式
 *
 * 用法:
 *   npx tsx scripts/backup-db.ts                  # 单次备份
 *   npx tsx scripts/backup-db.ts --cron            # 启动定时备份（每 6 小时）
 *   npx tsx scripts/backup-db.ts --keep 14         # 备份并保留最近 14 天
 *   npx tsx scripts/backup-db.ts --keep 14 --cron  # 定时备份，保留 14 天
 *
 * 定时模式会作为守护进程运行，默认每 6 小时备份一次。
 * 建议配合 PM2 或 systemd 管理定时备份进程。
 */

import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const WEB_DIR = path.join(__dirname, "..")

// ── 配置 ──────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(WEB_DIR, "data")
const BACKUP_DIR = path.join(DATA_DIR, "backups")
const DB_PATH = path.join(DATA_DIR, "app.db")
const DRAFTS_DIR = path.join(WEB_DIR, "..", "公众号写作", "drafts")

// 默认保留天数
const DEFAULT_KEEP_DAYS = 30

// 定时备份间隔（毫秒），默认 6 小时
const CRON_INTERVAL_MS = 6 * 60 * 60 * 1000

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function timestamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    console.log(`[Backup] 创建目录: ${dir}`)
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function now(): string {
  return new Date().toISOString().replace("T", " ").substring(0, 19)
}

// ── 数据库备份 ────────────────────────────────────────────────────────────────

function backupDatabase(ts: string): { path: string; size: number } | null {
  if (!fs.existsSync(DB_PATH)) {
    console.warn(`[Backup] 数据库文件不存在，跳过: ${DB_PATH}`)
    return null
  }

  const backupPath = path.join(BACKUP_DIR, `db_${ts}.sqlite`)
  try {
    fs.copyFileSync(DB_PATH, backupPath)
    const stat = fs.statSync(backupPath)
    console.log(`[Backup] 数据库备份完成: ${backupPath} (${formatSize(stat.size)})`)
    return { path: backupPath, size: stat.size }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Backup] 数据库备份失败: ${msg}`)
    return null
  }
}

// 使用 sqlite3 的 .backup 命令做 VACUUM INTO（更可靠，但需要 sqlite3 CLI）
function backupDatabaseWithVacuum(ts: string): { path: string; size: number } | null {
  if (!fs.existsSync(DB_PATH)) {
    console.warn(`[Backup] 数据库文件不存在，跳过: ${DB_PATH}`)
    return null
  }

  const backupPath = path.join(BACKUP_DIR, `db_${ts}.sqlite`)
  try {
    // 先检查 sqlite3 CLI 是否可用
    execSync(`sqlite3 "${DB_PATH}" ".backup '${backupPath}'"`, { stdio: "pipe" })
    const stat = fs.statSync(backupPath)
    console.log(`[Backup] 数据库备份完成 (vacuum): ${backupPath} (${formatSize(stat.size)})`)
    return { path: backupPath, size: stat.size }
  } catch {
    // 如果 sqlite3 CLI 不可用，回退到直接文件复制
    console.log(`[Backup] sqlite3 CLI 不可用，使用文件复制方式`)
    return backupDatabase(ts)
  }
}

// ── 草稿备份 ──────────────────────────────────────────────────────────────────

function backupDrafts(ts: string): { path: string; size: number } | null {
  if (!fs.existsSync(DRAFTS_DIR)) {
    console.warn(`[Backup] 草稿目录不存在，跳过: ${DRAFTS_DIR}`)
    return null
  }

  const backupPath = path.join(BACKUP_DIR, `drafts_${ts}.tar.gz`)
  try {
    const draftsParent = path.dirname(DRAFTS_DIR)
    const draftsDirName = path.basename(DRAFTS_DIR)

    // Windows 使用 tar 命令
    if (process.platform === "win32") {
      execSync(`tar -czf "${backupPath}" -C "${draftsParent}" "${draftsDirName}"`, { stdio: "pipe" })
    } else {
      execSync(`tar -czf "${backupPath}" -C "${draftsParent}" "${draftsDirName}"`, { stdio: "pipe" })
    }

    const stat = fs.statSync(backupPath)
    console.log(`[Backup] 草稿备份完成: ${backupPath} (${formatSize(stat.size)})`)
    return { path: backupPath, size: stat.size }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Backup] 草稿备份失败: ${msg}`)
    return null
  }
}

// ── 清理旧备份 ────────────────────────────────────────────────────────────────

function cleanupOldBackups(keepDays: number): void {
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".sqlite") || f.endsWith(".tar.gz"))
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000

  let deleted = 0
  for (const file of files) {
    const filePath = path.join(BACKUP_DIR, file)
    const stat = fs.statSync(filePath)
    if (stat.mtime.getTime() < cutoff) {
      fs.unlinkSync(filePath)
      deleted++
      console.log(`[Backup] 删除旧备份: ${file} (${(stat.mtime.toISOString().split("T")[0])})`)
    }
  }

  if (deleted > 0) {
    console.log(`[Backup] 清理完成，删除了 ${deleted} 个超过 ${keepDays} 天的旧备份`)
  }
}

// ── 执行完整备份 ──────────────────────────────────────────────────────────────

function runBackup(keepDays: number): boolean {
  const ts = timestamp()
  console.log(`\n[Backup] ===== 开始备份 (${now()}) =====`)

  ensureDir(BACKUP_DIR)

  const dbResult = backupDatabaseWithVacuum(ts)
  const draftsResult = backupDrafts(ts)

  cleanupOldBackups(keepDays)

  if (dbResult || draftsResult) {
    console.log(`[Backup] ✅ 备份完成 (${now()})`)
    return true
  }

  console.error(`[Backup] ❌ 备份失败：数据库和草稿均不存在`)
  return false
}

// ── 定时备份模式 ──────────────────────────────────────────────────────────────

function runCron(keepDays: number): void {
  console.log(`[Backup] 定时备份已启动，间隔: ${CRON_INTERVAL_MS / 3600000} 小时，保留: ${keepDays} 天`)
  console.log(`[Backup] 数据目录: ${DATA_DIR}`)
  console.log(`[Backup] 备份目录: ${BACKUP_DIR}`)

  // 启动时立即执行一次
  runBackup(keepDays)

  // 定时执行
  setInterval(() => {
    runBackup(keepDays)
  }, CRON_INTERVAL_MS)
}

// ── 入口 ──────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2)

  let keepDays = DEFAULT_KEEP_DAYS
  let isCron = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--keep" && args[i + 1]) {
      keepDays = parseInt(args[i + 1], 10)
      if (isNaN(keepDays) || keepDays < 1) {
        console.error("错误: --keep 参数必须是正整数")
        process.exit(1)
      }
      i++
    } else if (args[i] === "--cron") {
      isCron = true
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
用法: npx tsx scripts/backup-db.ts [选项]

选项:
  --cron        启动定时备份模式（每 6 小时备份一次）
  --keep <天>   保留最近 N 天的备份（默认: ${DEFAULT_KEEP_DAYS}）
  --help, -h    显示帮助信息

示例:
  npx tsx scripts/backup-db.ts                  # 单次备份，保留 30 天
  npx tsx scripts/backup-db.ts --keep 14        # 单次备份，保留 14 天
  npx tsx scripts/backup-db.ts --cron           # 定时备份，每 6 小时
  npx tsx scripts/backup-db.ts --keep 7 --cron  # 定时备份，保留 7 天
      `.trim())
      process.exit(0)
    }
  }

  if (isCron) {
    runCron(keepDays)
  } else {
    runBackup(keepDays)
  }
}

main()