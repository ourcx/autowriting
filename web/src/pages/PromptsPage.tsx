import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Edit2, Trash2, Copy, History, Eye, EyeOff, ArrowLeft } from 'lucide-react'
import '../styles/PromptsPage.css'

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

interface PromptVersion {
  id: string
  promptId: string
  version: number
  content: string
  changeNote: string
  createdAt: string
}

export default function PromptsPage() {
  const navigate = useNavigate()
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [searchText, setSearchText] = useState('')
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [editingPrompt, setEditingPrompt] = useState<Partial<Prompt> | null>(null)
  const [changeNote, setChangeNote] = useState('')
  const [showPreview, setShowPreview] = useState(true)
  const [stats, setStats] = useState<any>(null)
  const [showReplacementModal, setShowReplacementModal] = useState(false)
  const [replacementTarget, setReplacementTarget] = useState<Prompt | null>(null)

  // 获取所有提示词
  const fetchPrompts = async () => {
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

  // 获取统计信息
  const fetchStats = async () => {
    try {
      const res = await fetch('/api/prompts/stats/summary')
      const data = await res.json()
      if (data.success) {
        setStats(data.data)
      }
    } catch (e) {
      console.error('获取统计失败:', e)
    }
  }

  // 获取版本历史
  const fetchVersions = async (promptId: string) => {
    try {
      const res = await fetch(`/api/prompts/${promptId}/versions`)
      const data = await res.json()
      if (data.success) {
        setVersions(data.data)
      }
    } catch (e) {
      console.error('获取版本历史失败:', e)
    }
  }

  useEffect(() => {
    fetchPrompts()
    fetchStats()
  }, [])

  // 过滤提示词
  const filteredPrompts = prompts.filter(p => {
    const matchCategory = selectedCategory === 'all' || p.category === selectedCategory
    const matchSearch = p.name.includes(searchText) || p.description.includes(searchText)
    return matchCategory && matchSearch
  })

  // 获取分类列表
  const categories = ['all', ...new Set(prompts.map(p => p.category))]

  // 处理选择提示词
  const handleSelectPrompt = (prompt: Prompt) => {
    setSelectedPrompt(prompt)
    setEditingPrompt(null)
    setShowEditor(false)
    setShowVersions(false)
  }

  // 处理编辑
  const handleEdit = (prompt: Prompt) => {
    setEditingPrompt({ ...prompt })
    setShowEditor(true)
    setChangeNote('')
  }

  // 处理保存
  const handleSave = async () => {
    if (!editingPrompt || !selectedPrompt) return

    try {
      const res = await fetch(`/api/prompts/${selectedPrompt.id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: editingPrompt.content,
          changeNote,
        }),
      })

      const data = await res.json()
      if (data.success) {
        setSelectedPrompt(data.data)
        setEditingPrompt(null)
        setShowEditor(false)
        setChangeNote('')
        fetchPrompts()
        fetchStats()
      }
    } catch (e) {
      console.error('保存失败:', e)
    }
  }

  // 处理删除
  const handleDelete = async (promptId: string) => {
    if (!confirm('确定要删除这个提示词吗？')) return

    try {
      const res = await fetch(`/api/prompts/${promptId}/delete`, {
        method: 'POST',
      })

      const data = await res.json()
      if (data.success) {
        setSelectedPrompt(null)
        fetchPrompts()
        fetchStats()
      }
    } catch (e) {
      console.error('删除失败:', e)
    }
  }

  // 处理复制
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    alert('已复制到剪贴板')
  }

  // 处理版本恢复
  const handleRestoreVersion = async (version: number) => {
    if (!selectedPrompt) return
    if (!confirm(`确定要恢复到版本 ${version} 吗？`)) return

    try {
      const res = await fetch(`/api/prompts/${selectedPrompt.id}/restore/${version}`, {
        method: 'POST',
      })

      const data = await res.json()
      if (data.success) {
        setSelectedPrompt(data.data)
        fetchPrompts()
        fetchStats()
        setShowVersions(false)
      }
    } catch (e) {
      console.error('恢复失败:', e)
    }
  }

  // 处理设置为替换
  const handleSetAsReplacement = async (targetPrompt: Prompt) => {
    if (!selectedPrompt) return
    if (selectedPrompt.isBuiltin) {
      alert('内置提示词不能作为替换')
      return
    }

    try {
      const res = await fetch(`/api/prompts/${selectedPrompt.id}/set-as-replacement/${targetPrompt.id}`, {
        method: 'POST',
      })

      const data = await res.json()
      if (data.success) {
        setSelectedPrompt(data.data)
        fetchPrompts()
        setShowReplacementModal(false)
        setReplacementTarget(null)
      }
    } catch (e) {
      console.error('设置替换失败:', e)
    }
  }

  // 处理取消替换
  const handleUnsetReplacement = async () => {
    if (!selectedPrompt) return

    try {
      const res = await fetch(`/api/prompts/${selectedPrompt.id}/unset-replacement`, {
        method: 'POST',
      })

      const data = await res.json()
      if (data.success) {
        setSelectedPrompt(data.data)
        fetchPrompts()
      }
    } catch (e) {
      console.error('取消替换失败:', e)
    }
  }

  // 处理创建新提示词
  const handleCreateNew = () => {
    setEditingPrompt({
      name: '',
      category: 'article',
      description: '',
      content: '',
      tags: [],
    })
    setSelectedPrompt(null)
    setShowEditor(true)
  }

  // 处理保存新提示词
  const handleSaveNew = async () => {
    if (!editingPrompt || !editingPrompt.name || !editingPrompt.category || !editingPrompt.content) {
      alert('请填写必要字段：名称、分类、内容')
      return
    }

    try {
      const res = await fetch('/api/prompts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingPrompt.name,
          category: editingPrompt.category,
          description: editingPrompt.description,
          content: editingPrompt.content,
          tags: editingPrompt.tags || [],
        }),
      })

      const data = await res.json()
      if (data.success) {
        setEditingPrompt(null)
        setShowEditor(false)
        fetchPrompts()
        fetchStats()
      }
    } catch (e) {
      console.error('创建失败:', e)
    }
  }

  if (loading) {
    return <div className="prompts-page loading">加载中...</div>
  }

  return (
    <div className="prompts-page">
      {/* 返回按钮 */}
      <div className="prompts-header">
        <button className="wd-back-btn" onClick={() => navigate('/')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-left"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg>
          返回
        </button>
      </div>

      <div className="prompts-container">
        {/* 左侧列表 */}
        <div className="prompts-list-panel">
          <div className="list-header">
            <h2>提示词库</h2>
            <button className="btn-create" onClick={handleCreateNew}>
              <Plus size={18} /> 新建
            </button>
          </div>

          {/* 搜索和过滤 */}
          <div className="list-controls">
            <input
              type="text"
              placeholder="搜索提示词..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="search-input"
            />
            <div className="category-tabs">
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={`tab ${selectedCategory === cat ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat === 'all' ? '全部' : cat}
                </button>
              ))}
            </div>
          </div>

          {/* 提示词列表 */}
          <div className="prompts-list">
            {filteredPrompts.length === 0 ? (
              <div className="empty-state">没有找到提示词</div>
            ) : (
              filteredPrompts.map((prompt) => (
                <div
                  key={prompt.id}
                  className={`prompt-item ${selectedPrompt?.id === prompt.id ? 'active' : ''}`}
                  onClick={() => handleSelectPrompt(prompt)}
                >
                  <div className="prompt-item-header">
                    <h3>{prompt.name}</h3>
                    {prompt.isBuiltin && <span className="badge-builtin">内置</span>}
                  </div>
                  <p className="prompt-item-desc">{prompt.description}</p>
                  <div className="prompt-item-meta">
                    <span className="meta-tag">{prompt.category}</span>
                    <span className="meta-usage">使用 {prompt.usageCount} 次</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右侧详情 */}
        <div className="prompts-detail-panel">
          {!selectedPrompt && !showEditor ? (
            <div className="empty-detail">
              <p>选择一个提示词查看详情</p>
            </div>
          ) : showEditor && editingPrompt ? (
            <div className="editor-panel">
              <div className="editor-header">
                <h2>{selectedPrompt ? '编辑提示词' : '新建提示词'}</h2>
                <button className="btn-close" onClick={() => setShowEditor(false)}>
                  ✕
                </button>
              </div>

              <div className="editor-form">
                {!selectedPrompt && (
                  <>
                    <div className="form-group">
                      <label>名称 *</label>
                      <input
                        type="text"
                        value={editingPrompt.name || ''}
                        onChange={(e) => setEditingPrompt({ ...editingPrompt, name: e.target.value })}
                        placeholder="提示词名称"
                      />
                    </div>

                    <div className="form-group">
                      <label>分类 *</label>
                      <select
                        value={editingPrompt.category || 'article'}
                        onChange={(e) => setEditingPrompt({ ...editingPrompt, category: e.target.value })}
                      >
                        <option value="article">文章生成</option>
                        <option value="analysis">文章分析</option>
                        <option value="edit">内联编辑</option>
                        <option value="outline">大纲生成</option>
                        <option value="materials">素材整理</option>
                        <option value="style">样式生成</option>
                        <option value="cover">封面生成</option>
                        <option value="other">其他</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>描述</label>
                      <input
                        type="text"
                        value={editingPrompt.description || ''}
                        onChange={(e) => setEditingPrompt({ ...editingPrompt, description: e.target.value })}
                        placeholder="提示词描述"
                      />
                    </div>
                  </>
                )}

                {selectedPrompt && (
                  <div className="form-group">
                    <label>变更说明</label>
                    <input
                      type="text"
                      value={changeNote}
                      onChange={(e) => setChangeNote(e.target.value)}
                      placeholder="描述这次修改的内容"
                    />
                  </div>
                )}

                <div className="form-group">
                  <label>内容 *</label>
                  <div className="editor-wrapper">
                    <textarea
                      value={editingPrompt.content || ''}
                      onChange={(e) => setEditingPrompt({ ...editingPrompt, content: e.target.value })}
                      placeholder="输入提示词内容"
                      className="editor-textarea"
                    />
                    {showPreview && (
                      <div className="editor-preview">
                        <div className="preview-header">预览</div>
                        <div className="preview-content">{editingPrompt.content}</div>
                      </div>
                    )}
                  </div>
                  <button
                    className="btn-toggle-preview"
                    onClick={() => setShowPreview(!showPreview)}
                  >
                    {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}
                    {showPreview ? '隐藏预览' : '显示预览'}
                  </button>
                </div>

                <div className="editor-actions">
                  <button className="btn-save" onClick={selectedPrompt ? handleSave : handleSaveNew}>
                    保存
                  </button>
                  <button className="btn-cancel" onClick={() => setShowEditor(false)}>
                    取消
                  </button>
                </div>
              </div>
            </div>
          ) : selectedPrompt ? (
            <div className="detail-panel">
              <div className="detail-header">
                <div>
                  <h2>{selectedPrompt.name}</h2>
                  <p className="detail-meta">
                    <span className="badge">{selectedPrompt.category}</span>
                    <span className="version">v{selectedPrompt.version}</span>
                    <span className="usage">使用 {selectedPrompt.usageCount} 次</span>
                  </p>
                </div>
                {!selectedPrompt.isBuiltin && (
                  <div className="detail-actions">
                    <button className="btn-icon" onClick={() => handleEdit(selectedPrompt)} title="编辑">
                      <Edit2 size={18} />
                    </button>
                    <button className="btn-icon" onClick={() => handleCopy(selectedPrompt.content)} title="复制">
                      <Copy size={18} />
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => {
                        setShowVersions(!showVersions)
                        if (!showVersions) fetchVersions(selectedPrompt.id)
                      }}
                      title="版本历史"
                    >
                      <History size={18} />
                    </button>
                    <button
                      className="btn-icon btn-delete"
                      onClick={() => handleDelete(selectedPrompt.id)}
                      title="删除"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                )}
              </div>

              {selectedPrompt.description && (
                <div className="detail-section">
                  <h3>描述</h3>
                  <p>{selectedPrompt.description}</p>
                </div>
              )}

              {!selectedPrompt.isBuiltin && (
                <div className="detail-section replacement-section">
                  <h3>替换设置</h3>
                  {selectedPrompt.replacesId ? (
                    <div className="replacement-info">
                      <p className="replacement-status">
                        ✓ 此提示词替换了内置提示词 <strong>{prompts.find(p => p.id === selectedPrompt.replacesId)?.name}</strong>
                      </p>
                      <button className="btn-unset-replacement" onClick={handleUnsetReplacement}>
                        取消替换
                      </button>
                    </div>
                  ) : (
                    <div className="replacement-empty">
                      <p>此提示词未设置为替换</p>
                      <button
                        className="btn-set-replacement"
                        onClick={() => setShowReplacementModal(true)}
                      >
                        设为替换
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="detail-section">
                <div className="section-header">
                  <h3>内容</h3>
                  <button className="btn-copy-small" onClick={() => handleCopy(selectedPrompt.content)}>
                    复制
                  </button>
                </div>
                <div className="content-box">
                  <pre>{selectedPrompt.content}</pre>
                </div>
              </div>

              {selectedPrompt.tags.length > 0 && (
                <div className="detail-section">
                  <h3>标签</h3>
                  <div className="tags-list">
                    {selectedPrompt.tags.map((tag) => (
                      <span key={tag} className="tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="detail-section">
                <h3>信息</h3>
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">创建时间</span>
                    <span className="info-value">{new Date(selectedPrompt.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">更新时间</span>
                    <span className="info-value">{new Date(selectedPrompt.updatedAt).toLocaleString()}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">版本</span>
                    <span className="info-value">v{selectedPrompt.version}</span>
                  </div>
                  <div className="info-item">
                    <span className="info-label">使用次数</span>
                    <span className="info-value">{selectedPrompt.usageCount}</span>
                  </div>
                </div>
              </div>

              {showVersions && versions.length > 0 && (
                <div className="detail-section versions-section">
                  <h3>版本历史</h3>
                  <div className="versions-list">
                    {versions.map((v) => (
                      <div key={v.id} className="version-item">
                        <div className="version-header">
                          <span className="version-num">v{v.version}</span>
                          <span className="version-date">{new Date(v.createdAt).toLocaleString()}</span>
                          {v.changeNote && <span className="version-note">{v.changeNote}</span>}
                        </div>
                        <button
                          className="btn-restore"
                          onClick={() => handleRestoreVersion(v.version)}
                        >
                          恢复此版本
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* 替换选择模态框 */}
      {showReplacementModal && (
        <div className="modal-overlay" onClick={() => setShowReplacementModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>选择要替换的内置提示词</h2>
              <button className="btn-close" onClick={() => setShowReplacementModal(false)}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="builtin-prompts-list">
                {prompts
                  .filter((p) => p.isBuiltin)
                  .map((prompt) => (
                    <div
                      key={prompt.id}
                      className={`builtin-prompt-item ${replacementTarget?.id === prompt.id ? 'selected' : ''}`}
                      onClick={() => setReplacementTarget(prompt)}
                    >
                      <div className="item-header">
                        <h4>{prompt.name}</h4>
                        <span className="badge-builtin">内置</span>
                      </div>
                      <p className="item-desc">{prompt.description}</p>
                      <span className="item-category">{prompt.category}</span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn-confirm"
                disabled={!replacementTarget}
                onClick={() => replacementTarget && handleSetAsReplacement(replacementTarget)}
              >
                确认替换
              </button>
              <button className="btn-cancel" onClick={() => setShowReplacementModal(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
