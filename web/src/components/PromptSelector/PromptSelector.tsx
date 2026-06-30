import { useState, useEffect } from 'react'
import { Search, Copy, X, Zap, ChevronRight } from 'lucide-react'
import './PromptSelector.css'

interface Prompt {
  id: string
  name: string
  category: string
  description: string
  content: string
  version: number
  tags: string[]
  isBuiltin: boolean
  usageCount: number
  createdAt: string
  updatedAt: string
  replacesId?: string | null
}

interface PromptSelectorProps {
  onSelect: (prompt: Prompt) => void
  onClose: () => void
  category?: string // 可选：限制显示的分类
}

export default function PromptSelector({ onSelect, onClose, category }: PromptSelectorProps) {
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [loading, setLoading] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>(category || 'all')
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  async function fetchPrompts() {
    try {
      setLoading(true)
      const res = await fetch('/api/prompts/list')
      const data = await res.json()
      if (data.success) {
        setPrompts(data.data)
      }
    } catch (e) {
      console.error('获取提示词失败:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPrompts()
  }, [])

  const filteredPrompts = prompts.filter(p => {
    const matchCategory = selectedCategory === 'all' || p.category === selectedCategory
    const matchSearch = p.name.toLowerCase().includes(searchText.toLowerCase()) || 
                       p.description.toLowerCase().includes(searchText.toLowerCase())
    return matchCategory && matchSearch
  })

  const categories = ['all', ...new Set(prompts.map(p => p.category))]

  const handleSelectPrompt = (prompt: Prompt) => {
    onSelect(prompt)
    onClose()
  }

  return (
    <div className="ps-overlay" onClick={onClose}>
      <div className="ps-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ps-header">
          <div className="ps-header-content">
            <Zap size={20} className="ps-header-icon" />
            <div>
              <h2>选择提示词</h2>
              <p>快速选择预设提示词或自定义提示词</p>
            </div>
          </div>
          <button className="ps-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="ps-search-bar">
          <Search size={16} />
          <input
            type="text"
            placeholder="搜索提示词..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="ps-search-input"
            autoFocus
          />
        </div>

        {/* Categories */}
        <div className="ps-categories">
          {categories.map((cat) => (
            <button
              key={cat}
              className={`ps-category-btn ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat === 'all' ? '全部' : cat}
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div className="ps-content">
          {loading ? (
            <div className="ps-loading">
              <div className="ps-spinner" />
              <p>加载提示词中...</p>
            </div>
          ) : filteredPrompts.length === 0 ? (
            <div className="ps-empty">
              <p>没有找到匹配的提示词</p>
            </div>
          ) : (
            <div className="ps-list">
              {filteredPrompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className={`ps-item ${selectedPrompt?.id === prompt.id ? 'selected' : ''}`}
                  onClick={() => setSelectedPrompt(prompt)}
                >
                  <div className="ps-item-main">
                    <div className="ps-item-header">
                      <h3>{prompt.name}</h3>
                      {prompt.isBuiltin && <span className="ps-badge-builtin">内置</span>}
                    </div>
                    <p className="ps-item-desc">{prompt.description}</p>
                    <div className="ps-item-footer">
                      <span className="ps-category-tag">{prompt.category}</span>
                      <span className="ps-usage-count">使用 {prompt.usageCount} 次</span>
                    </div>
                  </div>
                  <ChevronRight size={18} className="ps-item-arrow" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview & Actions */}
        {selectedPrompt && (
          <div className="ps-preview-section">
            <div className="ps-preview-header">
              <h3>{selectedPrompt.name}</h3>
              <button
                className="ps-preview-toggle"
                onClick={() => setShowPreview(!showPreview)}
              >
                {showPreview ? '隐藏' : '显示'}预览
              </button>
            </div>
            {showPreview && (
              <div className="ps-preview-content">
                {selectedPrompt.content}
              </div>
            )}
            <div className="ps-preview-actions">
              <button
                className="ps-copy-btn"
                onClick={() => {
                  navigator.clipboard.writeText(selectedPrompt.content)
                  alert('已复制到剪贴板')
                }}
              >
                <Copy size={14} />
                复制内容
              </button>
              <button
                className="ps-use-btn"
                onClick={() => handleSelectPrompt(selectedPrompt)}
              >
                使用此提示词
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
