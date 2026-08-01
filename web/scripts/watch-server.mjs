import { spawn } from "node:child_process"
import { existsSync, watch } from "node:fs"
import { resolve } from "node:path"

const rootDir = resolve(import.meta.dirname, "..")
const lockFile = resolve(rootDir, "data", "xiaohongshu-publish.lock")
const watchTargets = [
  resolve(rootDir, "server"),
  resolve(rootDir, "server.ts"),
]

let serverProcess = null
let restartPending = false
let restartTimer = null

function startServer() {
  serverProcess = spawn("npx", ["tsx", "server.ts"], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  })
  serverProcess.on("exit", () => {
    serverProcess = null
    if (restartPending) restartServer()
  })
}

function restartServer() {
  if (restartTimer) {
    clearTimeout(restartTimer)
    restartTimer = null
  }
  if (existsSync(lockFile)) {
    console.log("[watch-server] 小红书发布进行中，延后后端热重启")
    restartTimer = setTimeout(restartServer, 1000)
    return
  }
  restartPending = false
  if (serverProcess) {
    serverProcess.kill("SIGTERM")
    return
  }
  startServer()
}

for (const target of watchTargets) {
  watch(target, { recursive: true }, () => {
    restartPending = true
    restartServer()
  })
}

process.on("SIGINT", () => {
  serverProcess?.kill("SIGTERM")
  process.exit(0)
})

process.on("SIGTERM", () => {
  serverProcess?.kill("SIGTERM")
  process.exit(0)
})

startServer()
