import React, { useState, useEffect } from 'react'
import { Trash2, RefreshCw, Download, Copy } from 'lucide-react'
import axios from 'axios'
import { toast, showConfirm } from '../Toast/Toast'
import './CoverHistory.css'

interface HistoryItem {
  id: string
  title: string
  style: string
  color: string
  provider: string
  imageUrl: string
  cacheKey: string
  createdAt: string
  cached: boolean
}

export const CoverHistory: React.FC = () => {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [stats, setStats] = useState({ historyCount: 0, cacheCount: 0, cacheSize: '0 MB' })

  useEffect(() => {
    fetchHistory()
    fetchStats()
  }, [])

  const fetchHistory = async () => {
    try {
      setLoading(true)
      const response = await axios.get('/api/cover-history')
      setHistory(response.data)
    } catch (error) {
      console.error('Failed to fetch history:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const response = await axios.get('/api/cache-stats')
      setStats(response.data)
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    }
  }

  const handleDelete = (id: string) => {
    showConfirm({
      message: '确定要删除这条记录吗？',
      confirmText: '删除',
      danger: true,
      onConfirm: async () => {
        try {
          await axios.delete(`/api/cover-history/${id}`)
          fetchHistory()
          fetchStats()
        } catch (error) {
          console.error('Failed to delete history:', error)
        }
      },
    })
  }

  const handleClearAll = () => {
    showConfirm({
      message: '确定要清除所有历史记录吗？',
      detail: '这个操作无法撤销。',
      confirmText: '清除全部',
      danger: true,
      onConfirm: async () => {
        try {
          await axios.delete('/api/cover-history')
          setHistory([])
          fetchStats()
        } catch (error) {
          console.error('Failed to clear history:', error)
        }
      },
    })
  }

  const handleDownload = (imageUrl: string, title: string) => {
    const link = document.createElement('a')
    link.href = imageUrl
    link.download = `cover-${title}-${Date.now()}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleCopyUrl = (imageUrl: string) => {
    navigator.clipboard.writeText(imageUrl)
    toast.info('图片 URL 已复制到剪贴板')
  }

  const getStyleLabel = (style: string) => {
    const labels: Record<string, string> = {
      modern: '现代风格',
      minimalist: '极简风格',
      gradient: '渐变风格',
      illustration: '插画风格',
      photography: '摄影风格',
      abstract: '抽象风格'
    }
    return labels[style] || style
  }

  const getColorLabel = (color: string) => {
    const labels: Record<string, string> = {
      matcha: '抹茶绿',
      slushie: '冰沙蓝',
      lemon: '柠檬黄',
      ube: '紫薯紫',
      pomegranate: '石榴红',
      blueberry: '蓝莓蓝'
    }
    return labels[color] || color
  }

  return (
    <div className="cover-history">
      <div className="history-header">
        <h3>📜 生成历史</h3>
        <div className="header-actions">
          <button className="btn-icon" onClick={fetchHistory} title="刷新">
            <RefreshCw size={18} />
          </button>
          {history.length > 0 && (
            <button className="btn-icon danger" onClick={handleClearAll} title="清除所有">
              <Trash2 size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="history-stats">
        <div className="stat-item">
          <span className="stat-label">历史记录</span>
          <span className="stat-value">{stats.historyCount}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">缓存数量</span>
          <span className="stat-value">{stats.cacheCount}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">缓存大小</span>
          <span className="stat-value">{stats.cacheSize}</span>
        </div>
      </div>

      {loading ? (
        <div className="history-loading">加载中...</div>
      ) : history.length === 0 ? (
        <div className="history-empty">
          <p>还没有生成历史</p>
          <p className="empty-hint">生成封面后会显示在这里</p>
        </div>
      ) : (
        <div className="history-list">
          {history.map((item) => (
            <div
              key={item.id}
              className={`history-item ${selectedId === item.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(item.id)}
            >
              <div className="item-preview">
                <img src={item.imageUrl} alt={item.title} />
                {item.cached && <span className="cached-badge">缓存</span>}
              </div>
              <div className="item-info">
                <h4>{item.title}</h4>
                <div className="item-meta">
                  <span className="meta-tag">{getStyleLabel(item.style)}</span>
                  <span className="meta-tag" style={{ backgroundColor: item.color }}>
                    {getColorLabel(item.color)}
                  </span>
                  <span className="meta-tag">{item.provider}</span>
                </div>
                <p className="item-time">
                  {new Date(item.createdAt).toLocaleString('zh-CN')}
                </p>
              </div>
              <div className="item-actions">
                <button
                  className="btn-action"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDownload(item.imageUrl, item.title)
                  }}
                  title="下载"
                >
                  <Download size={16} />
                </button>
                <button
                  className="btn-action"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCopyUrl(item.imageUrl)
                  }}
                  title="复制 URL"
                >
                  <Copy size={16} />
                </button>
                <button
                  className="btn-action danger"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(item.id)
                  }}
                  title="删除"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default CoverHistory
