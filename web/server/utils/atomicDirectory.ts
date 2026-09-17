import crypto from "node:crypto"
import fs from "node:fs"

export function replaceDirectoryAtomically(stagingDir: string, targetDir: string): void {
  const backupDir = `${targetDir}.backup-${crypto.randomUUID()}`
  const hadPreviousDirectory = fs.existsSync(targetDir)
  try {
    if (hadPreviousDirectory) fs.renameSync(targetDir, backupDir)
    fs.renameSync(stagingDir, targetDir)
  } catch (error) {
    if (!fs.existsSync(targetDir) && fs.existsSync(backupDir)) fs.renameSync(backupDir, targetDir)
    throw error
  } finally {
    if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true })
  }
  if (hadPreviousDirectory) {
    try { fs.rmSync(backupDir, { recursive: true, force: true }) }
    catch { /* 新索引已经生效，残留备份可由运维清理，不回滚成功结果。 */ }
  }
}
