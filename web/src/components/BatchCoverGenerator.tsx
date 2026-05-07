import React, { useState } from 'react'
import { X, Plus, Trash2, Zap } from 'lucide-react'
import axios from 'axios'
import './BatchCoverGenerator.css'

interface CoverConfig {
  id: string
  title: string
  content: string
  style: string
  color: string
}

interface BatchCoverGeneratorProps {
  onClose: () => void
  onSuccess?: (results: any[]) => void
}

const STYLES = ['modern', 'minimalist', 'gradient', 'illustration', 'photography', 'abstract']
const COLORS = ['matcha', 'slushie', 'lemon', 'ube', 'pomegranate', 'blueberry']

const STYLE_LABELS: Record<string, string> = {
  modern: '现代风格',
  minimalist: '极简风格',
  gradient: '渐变风格',
  illustration: '插画风格',
  photography: '摄影风格',
  abstract: '抽象风格'
}

const COLOR_LABELS: Record<string, string> = {
  matcha: '抹茶绿',
  slushie: '冰沙蓝',
  lemon: '柠檬黄',
  ube: '紫薯紫',
  pomegranate: '石榴红',
  blueberry: '蓝莓蓝'
}

const COLOR_MAP: Record<string, string> = {
  matcha: '#078a52',
  slushie: '#3bd3fd',
  lemon: '#fbbd41',
  ube: '#43089f',
  pomegranate: '#fc7981',
  blueberry: '#01418d'
}

export const BatchCoverGenerator: React.FC<BatchCoverGeneratorProps> = ({
  onClose,
  onSuccess
}) => {
  const [covers, setCover] = useState<CoverConfig[]>([
    {
      id: '1',
      title: '',
      content: '',
      style: 'modern',
      color: 'matcha'
    }
  ])
  const [provider, setProvider] = useState<'local' | 'stability'>('local')
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<any[]>([])
  const [showResults, setShowResults] = useState(false)

  const addCover = () => {
    const newId = (Math.max(...covers.map(c => parseInt(c.id))) + 1).toString()
    setCover([
      ...covers,
      {
        id: newId,
        title: '',
        content: '',
        style: 'modern',
        color: 'matcha'
      }
    ])
  }

  const removeCover = (id: string) => {
    if (covers.length > 1) {
      setCover(covers.filter(c => c.id !== id))
    }
  }

  const updateCover = (id: string, field: string, value: string) => {
    setCover(covers.map(c => (c.id === id ? { ...c, [field]: value } : c)))
  }

  const handleGenerate = async () => {
    const validCovers = covers.filter(c => c.title.trim())
    if (validCovers.length === 0) {
      alert('请至少输入一个标题')
      return
    }

    if (validCovers.length > 10) {
      alert('单次最多生成 10 个封面')
      return
    }

    try {
      setGenerating(true)
      setProgress(0)
      setResults([])

      const response = await axios.post('/api/generate-covers-batch', {
        covers: validCovers,
        provider
      })

      setResults(response.data.results)
      setShowResults(true)
      onSuccess?.(response.data.results)
    } catch (error) {
      console.error('Batch generation error:', error)
      alert('批量生成失败，请重试')
    } finally {
      setGenerating(false)
    }
  }

  if (showResults) {
    return (
      <div className="batch-modal-overlay" onClick={onClose}>
        <div className="batch-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>✨ 生成结果</h2>
            <button className="btn-close" onClick={onClose}>
              <X size={24} />
            </button>
          </div>

          <div className="results-container">
            {results.map((result) => (
              <div key={result.index} className="result-item">
                <img src={result.imageUrl} alt={result.title} />
                <div className="result-info">
                  <h4>{result.title}</h4>
                  {result.cached && <span className="cached-badge">缓存</span>}
                  {result.warning && <p className="warning">{result.warning}</p>}
                </div>
              </div>
            ))}
          </div>

          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="batch-modal-overlay" onClick={onClose}>
      <div className="batch-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🎨 批量生成封面</h2>
          <button className="btn-close" onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <div className="modal-content">
          {/* API 提供商选择 */}
          <div className="form-section">
            <label className="form-label">API 提供商</label>
            <div className="provider-options">
              <label className="radio-option">
                <input
                  type="radio"
                  value="local"
                  checked={provider === 'local'}
                  onChange={(e) => setProvider(e.target.value as any)}
                />
                <span>本地生成（演示）</span>
              </label>
              <label className="radio-option">
                <input
                  type="radio"
                  value="stability"
                  checked={provider === 'stability'}
                  onChange={(e) => setProvider(e.target.value as any)}
                />
                <span>Stability AI（已配置）✅</span>
              </label>
            </div>
          </div>

          {/* 封面列表 */}
          <div className="form-section">
            <div className="section-header">
              <label className="form-label">封面配置</label>
              <span className="count-badge">{covers.length}</span>
            </div>

            <div className="covers-list">
              {covers.map((cover, index) => (
                <div key={cover.id} className="cover-config">
                  <div className="config-number">{index + 1}</div>

                  <div className="config-fields">
                    <div className="field-group">
                      <label>标题 *</label>
                      <input
                        type="text"
                        value={cover.title}
                        onChange={(e) => updateCover(cover.id, 'title', e.target.value)}
                        placeholder="输入文章标题"
                        className="input-field"
                      />
                    </div>

                    <div className="field-group">
                      <label>内容（可选）</label>
                      <textarea
                        value={cover.content}
                        onChange={(e) => updateCover(cover.id, 'content', e.target.value)}
                        placeholder="输入文章内容摘要（用于生成更准确的封面）"
                        className="textarea-field"
                        rows={2}
                      />
                    </div>

                    <div className="field-row">
                      <div className="field-group">
                        <label>风格</label>
                        <select
                          value={cover.style}
                          onChange={(e) => updateCover(cover.id, 'style', e.target.value)}
                          className="select-field"
                        >
                          {STYLES.map((style) => (
                            <option key={style} value={style}>
                              {STYLE_LABELS[style]}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="field-group">
                        <label>颜色</label>
                        <select
                          value={cover.color}
                          onChange={(e) => updateCover(cover.id, 'color', e.target.value)}
                          className="select-field"
                        >
                          {COLORS.map((color) => (
                            <option key={color} value={color}>
                              {COLOR_LABELS[color]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {covers.length > 1 && (
                    <button
                      className="btn-remove"
                      onClick={() => removeCover(cover.id)}
                      title="删除"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {covers.length < 10 && (
              <button className="btn-add-cover" onClick={addCover}>
                <Plus size={18} />
                添加更多封面
              </button>
            )}
          </div>

          {/* 进度条 */}
          {generating && (
            <div className="progress-section">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }}></div>
              </div>
              <p className="progress-text">生成中... {progress}%</p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={generating}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={generating || covers.every(c => !c.title.trim())}
          >
            <Zap size={18} />
            {generating ? '生成中...' : '开始生成'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default BatchCoverGenerator
