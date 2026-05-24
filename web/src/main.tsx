import React from 'react'
import ReactDOM from 'react-dom/client'
import axios from 'axios'
import App from './App'
import './index.css'

// ── Electron 生产模式：file:// 协议下 /api/* 需要重定向到本地 Express ─────────
// axios：直接设置 baseURL
// fetch：monkey-patch，让 /api 开头的相对路径自动补全
if (window.location.protocol === 'file:') {
  const API_BASE = 'http://localhost:3000'

  // axios 全局 baseURL
  axios.defaults.baseURL = API_BASE

  // fetch monkey-patch：将 /api/... 重写为 http://localhost:3000/api/...
  const _nativeFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      input = API_BASE + input
    } else if (input instanceof Request && input.url.startsWith('/')) {
      input = new Request(API_BASE + input.url, input)
    }
    return _nativeFetch(input, init)
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
