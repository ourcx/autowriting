import { useState, useEffect } from 'react'
import { AlertCircle, Activity, Zap, TrendingUp, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import axios, { AxiosError } from 'axios'
import PageHeader from '../../components/PageHeader/PageHeader'
import './MonitoringPage.css'

interface LogEntry {
  timestamp: string
  level: string
  module: string
  message: string
  data?: any
}

interface Alert {
  level: string
  type: string
  message: string
  timestamp: string
}

export default function MonitoringPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'logs' | 'metrics' | 'alerts' | 'health'>('metrics')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [metrics, setMetrics] = useState<any>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [health, setHealth] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [logFilter, setLogFilter] = useState<'ALL' | 'ERROR' | 'WARN' | 'INFO'>('ALL')
  // 401 后停掉自动刷新，避免每 10s 一次的噪声请求
  const [authFailed, setAuthFailed] = useState(false)

  // 401 检测：未登录或 token 失效时不再继续轮询
  const handleError = (error: unknown, label: string) => {
    if (error instanceof AxiosError && error.response?.status === 401) {
      setAuthFailed(true)
    }
    console.error(`${label}失败:`, error)
  }

  // 获取日志（依赖全局 axios 拦截器自动注入 Authorization）
  const fetchLogs = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/monitoring/logs?lines=100')
      setLogs(response.data.data.logs)
    } catch (error) {
      handleError(error, '获取日志')
    }
    setLoading(false)
  }

  // 获取性能指标
  const fetchMetrics = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/monitoring/metrics')
      setMetrics(response.data.data)
    } catch (error) {
      handleError(error, '获取性能指标')
    }
    setLoading(false)
  }

  // 获取告警
  const fetchAlerts = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/monitoring/alerts')
      setAlerts(response.data.data.alerts)
    } catch (error) {
      handleError(error, '获取告警')
    }
    setLoading(false)
  }

  // 获取健康状态
  const fetchHealth = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/monitoring/health')
      setHealth(response.data.data)
    } catch (error) {
      handleError(error, '获取健康状态')
    }
    setLoading(false)
  }

  // 重置指标
  const resetMetrics = async () => {
    if (!window.confirm('确定要重置性能指标吗？')) return
    try {
      await axios.post('/api/monitoring/metrics/reset', {})
      fetchMetrics()
    } catch (error) {
      handleError(error, '重置指标')
    }
  }

  // 初始加载和定时刷新（401 后不再轮询）
  useEffect(() => {
    if (authFailed) return

    const tick = () => {
      if (activeTab === 'logs') fetchLogs()
      else if (activeTab === 'metrics') fetchMetrics()
      else if (activeTab === 'alerts') fetchAlerts()
      else if (activeTab === 'health') fetchHealth()
    }

    tick()
    const interval = setInterval(tick, 10000)
    return () => clearInterval(interval)
  }, [activeTab, authFailed])

  const filteredLogs = logs.filter(log => {
    if (logFilter === 'ALL') return true
    return log.level === logFilter
  })

  return (
    <div className="monitoring-page">
      <PageHeader
        title="系统监控"
        icon={<Activity size={16} />}
        subtitle="实时查看系统性能、日志和告警信息"
        onBack={() => navigate('/admin')}
      />
      <div className="monitoring-container">
        {/* 页面标题 */}
        <div className="monitoring-header">
          <h1 className="monitoring-title">系统监控</h1>
          <p className="monitoring-subtitle">实时查看系统性能、日志和告警信息</p>
          {authFailed && (
            <div style={{
              marginTop: 12,
              padding: '10px 14px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 10,
              color: '#b91c1c',
              fontSize: 13,
            }}>
              未登录或登录已失效，已停止自动刷新。请重新登录后再访问监控面板。
            </div>
          )}
        </div>

        {/* 标签页导航 */}
        <div className="monitoring-tabs">
          {[
            { id: 'metrics', label: '性能指标', icon: TrendingUp },
            { id: 'logs', label: '日志', icon: Activity },
            { id: 'alerts', label: '告警', icon: AlertCircle },
            { id: 'health', label: '健康检查', icon: Zap },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`monitoring-tab ${activeTab === tab.id ? 'active' : ''}`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* 加载状态 */}
        {loading && (
          <div className="monitoring-loading">
            <RefreshCw size={32} />
          </div>
        )}

        {/* 性能指标标签页 */}
        {activeTab === 'metrics' && metrics && !loading && (
          <div className="monitoring-section">
            {/* 摘要卡片 */}
            <div className="monitoring-summary-grid">
              <div className="monitoring-summary-card">
                <div className="monitoring-summary-label">总请求数</div>
                <p className="monitoring-summary-value">{metrics.summary.totalRequests}</p>
              </div>
              <div className="monitoring-summary-card">
                <div className="monitoring-summary-label">最近 1 小时</div>
                <p className="monitoring-summary-value">{metrics.summary.recentRequests}</p>
              </div>
              <div className="monitoring-summary-card">
                <div className="monitoring-summary-label">平均响应时间</div>
                <p className="monitoring-summary-value">{metrics.summary.avgDuration}ms</p>
              </div>
              <div className="monitoring-summary-card">
                <div className="monitoring-summary-label">错误率</div>
                <p className={`monitoring-summary-value ${
                  parseFloat(metrics.summary.errorRate) > 5 ? 'error' : 'success'
                }`}>
                  {metrics.summary.errorRate}%
                </p>
              </div>
            </div>

            {/* 端点统计 */}
            <div className="monitoring-card">
              <h2 className="monitoring-card-title">端点统计</h2>
              <div className="monitoring-endpoints-grid">
                {Object.entries(metrics.byEndpoint).map(([endpoint, data]: any) => (
                  <div key={endpoint} className="monitoring-endpoint-item">
                    <div className="monitoring-endpoint-header">
                      <span className="monitoring-endpoint-name">{endpoint}</span>
                      {data.errors > 0 && (
                        <span className="monitoring-endpoint-error-badge">{data.errors} 错误</span>
                      )}
                    </div>
                    <div className="monitoring-endpoint-stats">
                      <div className="monitoring-endpoint-stat">
                        <span className="monitoring-stat-label">请求数</span>
                        <span className="monitoring-stat-value">{data.count}</span>
                      </div>
                      <div className="monitoring-endpoint-stat">
                        <span className="monitoring-stat-label">平均时间</span>
                        <span className="monitoring-stat-value">{data.avgDuration}ms</span>
                      </div>
                      <div className="monitoring-endpoint-stat">
                        <span className="monitoring-stat-label">最小/最大</span>
                        <span className="monitoring-stat-value">{data.minDuration}ms / {data.maxDuration}ms</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 慢查询 */}
            {metrics.slowQueries.length > 0 && (
              <div className="monitoring-card">
                <h2 className="monitoring-card-title">慢查询（&gt;1s）</h2>
                <div className="monitoring-section">
                  {metrics.slowQueries.map((query: any, idx: number) => (
                    <div key={idx} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 16px',
                      background: '#fffbeb',
                      border: '1px solid #f59e0b',
                      borderRadius: '12px'
                    }}>
                      <span className="monitoring-table-endpoint">{query.endpoint}</span>
                      <span className="monitoring-table-error">{query.duration}ms</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 重置按钮 */}
            <button onClick={resetMetrics} className="monitoring-btn">
              <RefreshCw size={16} />
              重置指标
            </button>
          </div>
        )}

        {/* 日志标签页 */}
        {activeTab === 'logs' && !loading && (
          <div className="monitoring-section">
            {/* 日志过滤 */}
            <div className="monitoring-filters">
              {['ALL', 'ERROR', 'WARN', 'INFO'].map(level => (
                <button
                  key={level}
                  onClick={() => setLogFilter(level as any)}
                  className={`monitoring-filter-btn ${logFilter === level ? 'active' : ''}`}
                >
                  {level}
                </button>
              ))}
            </div>

            {/* 日志列表 */}
            <div className="monitoring-card">
              <div className="monitoring-logs-container">
                {filteredLogs.map((log, idx) => (
                  <div
                    key={idx}
                    className={`monitoring-log-item ${log.level.toLowerCase()}`}
                  >
                    <div className="monitoring-log-header">
                      <span className="monitoring-log-timestamp">{log.timestamp}</span>
                      <span className={`monitoring-log-level ${log.level.toLowerCase()}`}>
                        {log.level}
                      </span>
                    </div>
                    <div className="monitoring-log-message">
                      <span className="monitoring-log-module">[{log.module}]</span> {log.message}
                    </div>
                    {log.data && (
                      <pre className="monitoring-log-data">
                        {JSON.stringify(log.data, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 告警标签页 */}
        {activeTab === 'alerts' && !loading && (
          <div className="monitoring-section">
            {alerts.length === 0 ? (
              <div className="monitoring-alert-empty">
                ✓ 系统运行正常，无告警
              </div>
            ) : (
              <div className="monitoring-alerts-container">
                {alerts.map((alert, idx) => (
                  <div
                    key={idx}
                    className={`monitoring-alert-item ${alert.level}`}
                  >
                    <div className="monitoring-alert-icon">
                      <AlertCircle size={20} />
                    </div>
                    <div className="monitoring-alert-content">
                      <div className="monitoring-alert-message">{alert.message}</div>
                      <div className="monitoring-alert-timestamp">{alert.timestamp}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 健康检查标签页 */}
        {activeTab === 'health' && health && !loading && (
          <div className="monitoring-section">
            <div className="monitoring-card">
              <h2 className="monitoring-card-title">系统状态</h2>
              <div className="monitoring-health-grid">
                <div className="monitoring-health-item">
                  <span className="monitoring-health-label">运行时间</span>
                  <span className="monitoring-health-value">{health.uptime}</span>
                </div>
                <div className="monitoring-health-item">
                  <span className="monitoring-health-label">状态</span>
                  <span className="monitoring-health-value" style={{ color: '#22c55e' }}>
                    ✓ {health.status}
                  </span>
                </div>
              </div>
            </div>

            <div className="monitoring-card">
              <h2 className="monitoring-card-title">内存使用</h2>
              <div className="monitoring-health-grid">
                {Object.entries(health.memory).map(([key, value]: any) => (
                  <div key={key} className="monitoring-health-item">
                    <span className="monitoring-health-label">{key}</span>
                    <span className="monitoring-health-value">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
