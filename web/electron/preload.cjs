/**
 * Electron Preload 脚本（CommonJS 格式）
 *
 * 在隔离沙箱中运行，通过 contextBridge 安全地暴露主进程能力
 * 给渲染进程（React 应用）使用。
 */

'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 获取应用信息（版本、路径等）
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),

  // 用系统文件管理器打开指定文件夹
  openFolder: (folderPath) => ipcRenderer.invoke('app:openFolder', folderPath),

  // 弹出目录选择对话框，返回所选路径或 null
  selectDirectory: () => ipcRenderer.invoke('app:selectDirectory'),

  // 标识当前运行在 Electron 环境中
  isElectron: true,
})
