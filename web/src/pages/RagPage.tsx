/**
 * RAG 管理页  /rag
 * - 索引状态卡片
 * - 一键重建索引
 * - 相似度搜索测试
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Database, RefreshCw, Search, FileText, Layers, BookOpen, AlertCircle, CheckCircle } from 'lucide-react'
import { toast } from '../components/Toast'
import './RagPage.css'

interface IndexStatus {
  indexed:   boolean
  size?:     number
  updatedAt?: string
  indexDir?:  string
}

interface RagDoc {
  content: string
  source:  string
  type:    string
  dir:     string
  score:   number
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  article:  { label: '往期文章', color: 'peach',    icon: <FileText  size={13} /> },
  task:     { label: '任务参考', color: 'lavender', icon: <Layers    size={13} /> },
  materials:{ label: '素材参考', color: 'ochre',    icon: <BookOpen  size={13} /> },
  task_sub: { label: '任务参考', color: 'lavender', icon: <Layers    size={13} /> },
}

function fmtSize(bytes: number) {
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`
}

export default function RagPage() {
  const navigate = useNavigate()

  const [status,    setStatus]    = useState<IndexStatus | null>(null)
  const [building,  setBuilding]  = useState(false)
  const [buildLog,  setBuildLog]  = useState<string | null>(null)

  const [query,     setQuery]     = useState('')
  const [searching, setSearching] = useState(false)
  const [results,   setResults]   = useState<RagDoc[] | null>(null)

  useEffect(() => { fetchStatus() }, [])

  async function fetchStatus() {
    try {
      const res = await fetch('/api/rag/status')
      const data = await res.json()
      setStatus(data)
    } catch {
      setStatus({ indexed: false })
    }
  }

  async function handleBuild() {
    setBuilding(true)
    setBuildLog(null)
    try {
      const res  = await fetch('/api/rag/index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setBuildLog(`成功索引 ${data.indexed} 篇文档，切分为 ${data.chunks} 个片段`)
      toast.success('索引构建完成')
      fetchStatus()
    } catch (e: unknown) {
      const msg = (e as Error).message
      setBuildLog(`失败：${msg}`)
      toast.error('索引构建失败：' + msg)
    } finally {
      setBuilding(false)
    }
  }

  async function handleSearch() {
    if (!query.trim()) return
    setSearching(true)
    setResults(null)
    try {
      const res  = await fetch('/api/rag/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: query.trim(), topK: 6 }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setResults(data.results)
    } catch (e: unknown) {
      toast.error('搜索失败：' + (e as Error).message)
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="rp-root">

      {/* ── Header ── */}
      <header className="rp-header">
        <button className="rp-back" onClick={() => navigate('/')}>
          <ArrowLeft size={16} />
          返回
        </button>
        <div className="rp-header-title">
          <Database size={17} />
          向量索引管理
        </div>
        <div style={{ width: 80 }} />
      </header>

      <div className="rp-body">

        {/* ── 索引状态卡片 ── */}
        <section className="rp-section">
          <div className="rp-section-label">索引状态</div>
          <div className="rp-status-card">
            <div className="rp-status-left">
              {status === null ? (
                <span className="rp-dot rp-dot-loading" />
              ) : status.indexed ? (
                <CheckCircle size={20} className="rp-icon-ok" />
              ) : (
                <AlertCircle size={20} className="rp-icon-warn" />
              )}
              <div>
                <div className="rp-status-title">
                  {status === null  && '加载中...'}
                  {status?.indexed  === false && '尚未建立索引'}
                  {status?.indexed  === true  && '索引已就绪'}
                </div>
                {status?.indexed && (
                  <div className="rp-status-meta">
                    {status.size && <span>{fmtSize(status.size)}</span>}
                    {status.updatedAt && <span>更新于 {new Date(status.updatedAt).toLocaleString('zh-CN')}</span>}
                    {status.indexDir && <span className="rp-mono">{status.indexDir}</span>}
                  </div>
                )}
                {!status?.indexed && status !== null && (
                  <div className="rp-status-meta">点击右侧按钮扫描草稿目录并建立向量索引（需要 OpenAI Embedding API Key）</div>
                )}
              </div>
            </div>
            <button
              className={`rp-btn-primary ${building ? 'rp-btn-loading' : ''}`}
              onClick={handleBuild}
              disabled={building}
            >
              <RefreshCw size={14} className={building ? 'rp-spin' : ''} />
              {building ? '构建中...' : status?.indexed ? '重新构建' : '立即构建'}
            </button>
          </div>

          {buildLog && (
            <div className={`rp-build-log ${buildLog.startsWith('失败') ? 'rp-build-log--error' : ''}`}>
              {buildLog}
            </div>
          )}
        </section>

        {/* ── 搜索测试区 ── */}
        <section className="rp-section">
          <div className="rp-section-label">相似度搜索测试</div>
          <div className="rp-search-row">
            <input
              className="rp-input"
              placeholder="输入任意文本，测试向量检索效果..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
              disabled={!status?.indexed}
            />
            <button
              className="rp-btn-primary"
              onClick={handleSearch}
              disabled={searching || !status?.indexed || !query.trim()}
            >
              <Search size={14} />
              {searching ? '检索中...' : '搜索'}
            </button>
          </div>

          {!status?.indexed && (
            <p className="rp-hint">请先构建索引后再测试搜索</p>
          )}

          {/* 结果列表 */}
          {results !== null && (
            <div className="rp-results">
              {results.length === 0 ? (
                <div className="rp-no-result">没有找到相关内容（相似度过低）</div>
              ) : (
                <>
                  <div className="rp-results-summary">找到 {results.length} 段相关内容</div>
                  <div className="rp-result-grid">
                    {results.map((doc, i) => {
                      const cfg = TYPE_CONFIG[doc.type] || { label: doc.type, color: 'cream', icon: <FileText size={13} /> }
                      return (
                        <div key={i} className={`rp-result-card rp-result-card--${cfg.color}`}>
                          <div className="rp-result-header">
                            <span className="rp-result-badge">
                              {cfg.icon}
                              {cfg.label}
                            </span>
                            <span className="rp-result-dir">{doc.dir}</span>
                            <span className="rp-result-sim">
                              {Math.round((1 - doc.score) * 100)}% 相似
                            </span>
                          </div>
                          <p className="rp-result-content">{doc.content}</p>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        {/* ── 使用说明 ── */}
        <section className="rp-section">
          <div className="rp-section-label">使用说明</div>
          <div className="rp-guide-grid">
            <div className="rp-guide-card rp-guide-card--teal">
              <div className="rp-guide-step">01</div>
              <div className="rp-guide-title">构建索引</div>
              <p>扫描所有草稿目录下的 <code>article_raw.md</code>、<code>task.md</code>、<code>materials.md</code>，切片后用 OpenAI Embedding 向量化并存入本地 HNSWLib。</p>
            </div>
            <div className="rp-guide-card rp-guide-card--peach">
              <div className="rp-guide-step">02</div>
              <div className="rp-guide-title">自动召回</div>
              <p>生成文章时，系统自动用当前任务描述检索 top-4 相关片段，注入 prompt「往期参考」区域，让 AI 保持风格一致。</p>
            </div>
            <div className="rp-guide-card rp-guide-card--lavender">
              <div className="rp-guide-step">03</div>
              <div className="rp-guide-title">定期重建</div>
              <p>每次写完新文章后，点「重新构建」刷新索引，把最新内容也纳入参考。索引存在 <code>.cache/rag_index/</code>。</p>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
