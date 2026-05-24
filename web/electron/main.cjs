/**
 * Electron 主进程（CommonJS 格式）
 *
 * 职责：
 * 1. 创建主窗口（开发模式加载 Vite Dev Server，生产模式加载 dist/index.html）
 * 2. 在同一进程中启动内嵌 Express 服务（server.js）
 * 3. 设置 CSP，允许渲染进程访问 localhost API
 * 4. 处理应用生命周期事件
 *
 * 注意：项目整体是 ESM（"type":"module"），但 Electron 主进程入口
 * 必须是 CJS（.cjs），因为 Electron 本身是 CJS 模块。
 * server.js 是 ESM，通过动态 import() 在主进程内加载。
 */

'use strict'

const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron')
const path = require('path')

// ── 判断是否是开发模式 ────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

// ── 设置用户数据目录 ──────────────────────────────────────────────────────────
// userData：Mac ~/Library/Application Support/AutoWriting
//           Win %APPDATA%/AutoWriting
const USER_DATA_DIR = app.getPath('userData')
const DOCUMENTS_DIR = app.getPath('documents')

// 注入给 server/config.js 使用
process.env.ELECTRON_USER_DATA = USER_DATA_DIR
process.env.ELECTRON_DOCUMENTS = DOCUMENTS_DIR
process.env.ELECTRON_APP = 'true'

// ── 内嵌 Express 服务端口 ─────────────────────────────────────────────────────
const SERVER_PORT = 3000

// ── 启动内嵌 Express 服务 ─────────────────────────────────────────────────────
let serverStarted = false

async function startServer() {
  if (serverStarted) return

  if (isDev) {
    // 开发模式：Express 服务由外部 `npm run server` 单独启动，
    // Electron 进程不重复启动，避免端口 3000 冲突
    serverStarted = true
    console.log('[Electron] 开发模式：使用外部 Express 服务 http://localhost:' + SERVER_PORT)
    return
  }

  // 生产模式：在 Electron 主进程内启动内嵌 Express
  try {
    const serverPath = path.join(__dirname, '..', 'server.js')
    await import(`file://${serverPath}`)
    serverStarted = true
    console.log('[Electron] 内嵌服务已启动，端口:', SERVER_PORT)
  } catch (err) {
    console.error('[Electron] 服务启动失败:', err)
    throw err
  }
}

// ── 创建主窗口 ─────────────────────────────────────────────────────────────────
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

  // CSP：允许渲染进程向 localhost Express 发请求
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http://localhost:${SERVER_PORT} ws://localhost:*`,
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

// ── IPC 处理 ──────────────────────────────────────────────────────────────────

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
  await startServer()

  // 稍等服务就绪再开窗口
  const delay = isDev ? 800 : 400
  await new Promise((r) => setTimeout(r, delay))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 安全策略：阻止导航到外部非白名单 URL
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
