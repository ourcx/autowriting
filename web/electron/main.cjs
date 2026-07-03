/**
 * Electron 主进程（CommonJS 格式）
 *
 * 开发模式：Express 由外部 `npx tsx server.ts` 单独运行，Electron 不重复启动
 * 生产模式：Electron 主进程内嵌用系统 Node 以子进程方式启动 Express
 *
 * 为什么用系统 Node 而非 Electron 内置 Node？
 *   better-sqlite3 等原生模块与 Electron 42 的 V8 API 不兼容，
 *   无法用 @electron/rebuild 为 Electron 重编译。
 *   用系统 Node 运行 server，原生模块只需为系统 Node 编译一次（postinstall 自动完成）。
 */

'use strict'

const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron')
const path = require('path')
const { spawn } = require('child_process')

// ── 判断运行模式 ─────────────────────────────────────────────────────────────
const isDev = !app.isPackaged

// ── 找系统 Node 路径（生产包内 PATH 不完整，需穷举常见位置） ────────────────────
function findNodeBin() {
  const { existsSync } = require('fs')
  const candidates = [
    // 用户通过 nvm/fnm 安装
    process.env.HOME + '/.nvm/versions/node/current/bin/node',
    // Homebrew arm64
    '/opt/homebrew/bin/node',
    // Homebrew x64
    '/usr/local/bin/node',
    // macOS 系统自带
    '/usr/bin/node',
    // Windows
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
  ]
  // 还可以从 PATH 里找
  const pathDirs = (process.env.PATH || '').split(path.delimiter)
  for (const dir of pathDirs) {
    candidates.unshift(path.join(dir, 'node'))
  }
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  // 最后兜底：直接用 'node'，依赖系统 PATH
  return 'node'
}

// ── 用户数据目录（必须在 app.ready 前取到） ───────────────────────────────────
// Mac: ~/Library/Application Support/AutoWriting
// Win: %APPDATA%/AutoWriting
const USER_DATA_DIR = app.getPath('userData')
const DOCUMENTS_DIR = app.getPath('documents')

// 注入给 server/config.js 使用
process.env.ELECTRON_USER_DATA = USER_DATA_DIR
process.env.ELECTRON_DOCUMENTS = DOCUMENTS_DIR
process.env.ELECTRON_APP = 'true'

// ── 端口 ─────────────────────────────────────────────────────────────────────
const SERVER_PORT = 3000

// ── 生产模式：用子进程方式启动 Express ───────────────────────────────────────
// 子进程方式的优点：
//   1. Node 运行时与 Electron 主进程隔离，原生模块 ABI 无需重编译
//   2. 服务崩溃不会拖垮 Electron 进程
//   3. 可以独立重启
let serverProcess = null

function startServerProcess() {
  return new Promise((resolve, reject) => {
    if (isDev) {
      // 开发模式由外部 `npx tsx server.ts` 负责，Electron 不再启动
      console.log('[Electron] 开发模式：使用外部 Express（http://localhost:' + SERVER_PORT + '）')
      resolve()
      return
    }

    // 生产模式：server.ts 打包在 app.asar 内，用系统 node + tsx 运行
    // process.resourcesPath = .../AutoWriting.app/Contents/Resources
    const serverScript = path.join(process.resourcesPath, 'app.asar', 'server.ts')
    const tsxBin = path.join(process.resourcesPath, 'app.asar', 'node_modules', '.bin', 'tsx')

    // 找系统 node 路径（打包应用里没有 PATH，需要手动指定常见位置）
    const nodeBin = findNodeBin()

    serverProcess = spawn(
      nodeBin,
      [tsxBin, serverScript],
      {
        env: {
          ...process.env,
          ELECTRON_USER_DATA: USER_DATA_DIR,
          ELECTRON_DOCUMENTS: DOCUMENTS_DIR,
          ELECTRON_APP: 'true',
          PORT: String(SERVER_PORT),
          NODE_ENV: 'production',
          // 清除 Electron 相关环境变量，避免子进程行为异常
          ELECTRON_RUN_AS_NODE: undefined,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )

    serverProcess.stdout.on('data', (d) => {
      const line = d.toString().trim()
      console.log('[Server]', line)
      // 检测服务就绪信号
      if (line.includes('Server running') || line.includes('服务启动成功')) {
        resolve()
      }
    })

    serverProcess.stderr.on('data', (d) => {
      console.error('[Server ERR]', d.toString().trim())
    })

    serverProcess.on('error', (err) => {
      console.error('[Electron] server 进程启动失败:', err)
      reject(err)
    })

    serverProcess.on('exit', (code) => {
      console.log('[Electron] server 进程退出，code:', code)
      serverProcess = null
    })

    // 最多等 15 秒，超时后仍然开窗口（用户会看到 API 错误提示）
    setTimeout(() => resolve(), 15000)
  })
}

// ── 创建主窗口 ────────────────────────────────────────────────────────────────
let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  })

  // CSP：允许渲染进程访问本地 Express API
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ` +
          `http://localhost:${SERVER_PORT} ws://localhost:*`,
        ],
      },
    })
  })

  // 加载页面
  const startUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '..', 'dist', 'index.html')}`

  mainWindow.loadURL(startUrl).catch((err) => {
    console.error('[Electron] 页面加载失败:', err.message)
    setTimeout(() => mainWindow && mainWindow.loadURL(startUrl).catch(() => {}), 2000)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (isDev) {
      mainWindow.webContents.openDevTools()
    }
  })

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.includes('localhost')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── IPC 处理 ─────────────────────────────────────────────────────────────────

ipcMain.handle('app:getInfo', () => ({
  version: app.getVersion(),
  userData: USER_DATA_DIR,
  documents: DOCUMENTS_DIR,
  isDev,
}))

ipcMain.handle('app:openFolder', async (_, folderPath) => {
  await shell.openPath(folderPath)
})

ipcMain.handle('app:selectDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

// ── 应用生命周期 ──────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // 启动 Express（失败也不阻塞，窗口始终会弹出）
  try {
    await startServerProcess()
  } catch (err) {
    console.error('[Electron] 后端启动失败（窗口仍会打开）:', err.message)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // 关闭应用时也终止后端子进程
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
})

// 安全策略：阻止导航到外部 URL
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url)
      const allowed = ['localhost', '127.0.0.1']
      if (!allowed.includes(parsed.hostname) && parsed.protocol !== 'file:') {
        event.preventDefault()
      }
    } catch {
      event.preventDefault()
    }
  })
})
