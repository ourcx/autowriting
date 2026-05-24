import React from 'react'
import ReactDOM from 'react-dom/client'
import axios from 'axios'
import App from './App'
import './index.css'

// ── Electron 生产模式：前端通过 file:// 加载，需要手动指定 API baseURL ────────
// 开发模式下 Vite proxy 处理 /api/*，不需要额外配置
if (window.location.protocol === 'file:') {
  axios.defaults.baseURL = 'http://localhost:3000'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
