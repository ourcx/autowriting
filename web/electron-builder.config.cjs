/**
 * electron-builder 打包配置
 *
 * 打包策略：
 *   - 前端 React 编译产物（dist/）内嵌到应用包内
 *   - 后端 Express 服务器（server.js + server/）随 app.asar 打包
 *   - 原生模块（better-sqlite3, hnswlib-node）解包在 app.asar.unpacked/
 */

'use strict'
const { execSync } = require('child_process')
const path = require('path')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.autowriting.app',
  productName: 'AutoWriting',
  copyright: 'Copyright © 2025',

  // 打包的文件范围（相对于 web/ 目录）
  files: [
    'dist/**/*',
    'electron/**/*',
    'server/**/*',
    'server.js',
    'node_modules/**/*',
    '!node_modules/.cache',
    '!node_modules/.pnpm-store',
    '!node_modules/.modules.yaml',
    '!**/*.map',
    '!**/*.md',
  ],

  // 额外资源：AGENTS.md 示例文件复制到 resources/
  extraResources: [
    {
      from: '../AGENTS.md',
      to: 'AGENTS.md',
    },
  ],

  // asar 压缩（排除原生模块，避免加载失败）
  asar: true,
  asarUnpack: [
    '**/better-sqlite3/**',
    '**/hnswlib-node/**',
    '**/*.node',
  ],

  // 目录配置
  directories: {
    output: 'dist-electron',
    buildResources: 'electron/assets',
  },

  // macOS 配置
  mac: {
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    category: 'public.app-category.productivity',
    icon: 'electron/assets/icon.icns',
    darkModeSupport: true,
    // 未签名时跳过公证（本地构建）
    notarize: false,
  },

  // dmg 安装包配置
  dmg: {
    title: 'AutoWriting ${version}',
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
    window: { width: 540, height: 380 },
  },

  // Windows 配置
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ],
    icon: 'electron/assets/icon.ico',
  },

  // Windows 安装向导配置
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'electron/assets/icon.ico',
    uninstallerIcon: 'electron/assets/icon.ico',
    shortcutName: 'AutoWriting',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },

  // 在打包开始前重新编译原生模块（适配当前 Electron 版本的 Node ABI）
  beforeBuild: async (context) => {
    console.log('[electron-builder] 重新编译原生模块...')
    try {
      execSync(
        `npx @electron/rebuild --parallel`,
        { cwd: path.join(__dirname), stdio: 'inherit' }
      )
    } catch (e) {
      console.warn('[electron-builder] rebuild 警告:', e.message)
    }
  },
}
