import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Edit2, Trash2, Copy, History, Eye, EyeOff,
  ArrowLeft, RotateCcw, CheckCircle, Zap, Search,
} from 'lucide-react'
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

const CATEGORY_LABELS: Record<string, string> = {
  article: '文章生成',
  analysis: '文章分析',
  edit: '内联编辑',
  outline: '大纲生成',
  materials: '素材整理',
  style: '样式生成',
  cover: '封面生成',
  other: '其他',
}

const PROMPT_USAGE_TIPS: Record<string, string> = {
  'prompt-article-generate': '点击「生成文章」时作为公众号文章的角色和输出约束注入到 prompt 前段',
  'prompt-article-generate-toutiao': '点击「生成文章」时同步生成今日头条版本，使用此提示词；风格偏热点、情感、故事，标题要有吸引力',
  'prompt-article-analyze': '点击「AI 分析」时作为角色描述注入',
  'prompt-article-deai': '在「写作分析」面板点击「去 AI 味」按钮时使用，对全文进行流式改写',
  'prompt-edit-polish': '内联编辑选择「润色」时使用',
  'prompt-edit-shorten': '内联编辑选择「精简」时使用',
  'prompt-edit-expand': '内联编辑选择「扩写」时使用',
  'prompt-edit-rewrite-lead': '内联编辑选择「重写开头」时使用',
  'prompt-outline-generate': '点击「生成大纲」时作为角色描述注入',
  'prompt-materials-organize': '点击「整理素材」时作为角色描述注入',
  'prompt-style-generate': '点击「生成样式」时作为 system prompt 使用（完整替换）',
  'prompt-cover-generate': '封面生成时使用',
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
  const [editingContent, setEditingContent] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [showPreview, setShowPreview] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newPrompt, setNewPrompt] = useState<Partial<Prompt>>({
    name: '', category: 'article', description: '', content: '', tags: [],
  })

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  const fetchPrompts = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/prompts/list')
      const data = await res.json()
      if (data.success) setPrompts(data.data)
    } catch (e) {
      console.error('获取提示词失败:', e)
    } finally {
      setLoading(false)
    }
  }

  const fetchVersions = async (promptId: string) => {
    try {
      const res = await fetch(`/api/prompts/${promptId}/versions`)
      const data = await res.json()
      if (data.success) setVersions(data.data)
    } catch (e) {
      console.error('获取版本历史失败:', e)
    }
  }

  useEffect(() => { fetchPrompts() }, [])

  const filteredPrompts = prompts.filter(p => {
    const matchCategory = selectedCategory === 'all' || p.category === selectedCategory
    const matchSearch = p.name.includes(searchText) || p.description.includes(searchText)
    return matchCategory && matchSearch
  })

  const categories = ['all', ...new Set(prompts.map(p => p.category))]

  const findOverride = (builtinId: string) =>
    prompts.find(p => p.replacesId === builtinId)

  const handleSelectPrompt = (prompt: Prompt) => {
    setSelectedPrompt(prompt)
    setShowEditor(false)
    setIsCreating(false)
    setShowVersions(false)
  }

  const handleEdit = (prompt: Prompt) => {
    if (prompt.isBuiltin) {
      const override = findOverride(prompt.id)
      setEditingContent(override ? override.content : prompt.content)
    } else {
      setEditingContent(prompt.content)
    }
    setShowEditor(true)
    setIsCreating(false)
    setChangeNote('')
  }

  const handleSave = async () => {
    if (!selectedPrompt) return
    setSaving(true)
    try {
      const endpoint = selectedPrompt.isBuiltin
        ? `/api/prompts/${selectedPrompt.id}/override`
        : `/api/prompts/${selectedPrompt.id}/update`

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editingContent, changeNote }),
      })
      const data = await res.json()
      if (data.success) {
        setShowEditor(false)
        setChangeNote('')
        await fetchPrompts()
        showToast('保存成功，系统下次调用时将使用新版本')
      } else {
        showToast(data.error || '保存失败', 'error')
      }
    } catch {
      showToast('保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleResetOverride = async (builtinId: string) => {
    if (!confirm('确定要重置为内置默认版本吗？自定义修改将被删除。')) return
    try {
      const res = await fetch(`/api/prompts/${builtinId}/reset-override`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        await fetchPrompts()
        showToast('已重置为内置默认版本')
      } else {
        showToast(data.error || '重置失败', 'error')
      }
    } catch {
      showToast('重置失败', 'error')
    }
  }

  const handleDelete = async (promptId: string) => {
    if (!confirm('确定要删除这个提示词吗？')) return
    try {
      const res = await fetch(`/api/prompts/${promptId}/delete`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setSelectedPrompt(null)
        await fetchPrompts()
        showToast('已删除')
      }
    } catch {
      showToast('删除失败', 'error')
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    showToast('已复制到剪贴板')
  }

  const handleRestoreVersion = async (version: number) => {
    if (!selectedPrompt) return
    if (!confirm(`确定要恢复到版本 ${version} 吗？`)) return
    try {
      const res = await fetch(`/api/prompts/${selectedPrompt.id}/restore/${version}`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setSelectedPrompt(data.data)
        await fetchPrompts()
        setShowVersions(false)
        showToast(`已恢复到版本 ${version}`)
      }
    } catch {
      showToast('恢复失败', 'error')
    }
  }

  const handleCreateNew = () => {
    setIsCreating(true)
    setShowEditor(false)
    setSelectedPrompt(null)
    setNewPrompt({ name: '', category: 'article', description: '', content: '', tags: [] })
  }

  const handleSaveNew = async () => {
    if (!newPrompt.name || !newPrompt.category || !newPrompt.content) {
      showToast('请填写必要字段：名称、分类、内容', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/prompts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newPrompt.name,
          category: newPrompt.category,
          description: newPrompt.description,
          content: newPrompt.content,
          tags: newPrompt.tags || [],
        }),
      })
      const data = await res.json()
      if (data.success) {
        setIsCreating(false)
        await fetchPrompts()
        showToast('创建成功')
      } else {
        showToast(data.error || '创建失败', 'error')
      }
    } catch {
      showToast('创建失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="pp-root pp-loading">
        <div className="pp-loading-dot" />
        <span>加载中...</span>
      </div>
    )
  }

  /* ── 右侧内容决策 ── */
  const rightContent = (() => {
    /* 新建 */
    if (isCreating) return (
      <div className="pp-editor">
        <div className="pp-editor-head">
          <span className="pp-editor-title">新建提示词</span>
          <button className="pp-icon-btn" onClick={() => setIsCreating(false)}>✕</button>
        </div>
        <div className="pp-editor-body">
          <div className="pp-field">
            <label>名称 <em>*</em></label>
            <input
              type="text"
              value={newPrompt.name || ''}
              onChange={e => setNewPrompt({ ...newPrompt, name: e.target.value })}
              placeholder="提示词名称"
            />
          </div>
          <div className="pp-field">
            <label>分类 <em>*</em></label>
            <select
              value={newPrompt.category || 'article'}
              onChange={e => setNewPrompt({ ...newPrompt, category: e.target.value })}
            >
              {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div className="pp-field">
            <label>描述</label>
            <input
              type="text"
              value={newPrompt.description || ''}
              onChange={e => setNewPrompt({ ...newPrompt, description: e.target.value })}
              placeholder="简要说明用途"
            />
          </div>
          <div className="pp-field pp-field--grow">
            <label>内容 <em>*</em></label>
            <textarea
              value={newPrompt.content || ''}
              onChange={e => setNewPrompt({ ...newPrompt, content: e.target.value })}
              placeholder="输入提示词内容"
              className="pp-textarea"
            />
          </div>
          <div className="pp-editor-actions">
            <button className="pp-btn-primary" onClick={handleSaveNew} disabled={saving}>
              {saving ? '创建中...' : '创建'}
            </button>
            <button className="pp-btn-secondary" onClick={() => setIsCreating(false)}>取消</button>
          </div>
        </div>
      </div>
    )

    /* 编辑 */
    if (showEditor && selectedPrompt) return (
      <div className="pp-editor">
        <div className="pp-editor-head">
          <div>
            <span className="pp-editor-title">编辑提示词</span>
            {selectedPrompt.isBuiltin && (
              <span className="pp-editor-hint">内置提示词将创建自定义覆盖版本</span>
            )}
          </div>
          <button className="pp-icon-btn" onClick={() => setShowEditor(false)}>✕</button>
        </div>
        <div className="pp-editor-body">
          <div className="pp-field">
            <label>变更说明（可选）</label>
            <input
              type="text"
              value={changeNote}
              onChange={e => setChangeNote(e.target.value)}
              placeholder="描述本次修改内容"
            />
          </div>
          <div className="pp-field pp-field--grow">
            <div className="pp-field-row">
              <label>内容 <em>*</em></label>
              <button className="pp-toggle-preview" onClick={() => setShowPreview(!showPreview)}>
                {showPreview ? <EyeOff size={13} /> : <Eye size={13} />}
                {showPreview ? '隐藏预览' : '显示预览'}
              </button>
            </div>
            <div className="pp-editor-split">
              <textarea
                value={editingContent}
                onChange={e => setEditingContent(e.target.value)}
                placeholder="输入提示词内容"
                className="pp-textarea"
              />
              {showPreview && (
                <div className="pp-preview">
                  <div className="pp-preview-label">预览</div>
                  <div className="pp-preview-body">{editingContent}</div>
                </div>
              )}
            </div>
          </div>
          <div className="pp-editor-actions">
            <button className="pp-btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
            <button className="pp-btn-secondary" onClick={() => setShowEditor(false)}>取消</button>
          </div>
        </div>
      </div>
    )

    /* 详情 */
    if (selectedPrompt) {
      const override = selectedPrompt.isBuiltin ? findOverride(selectedPrompt.id) : null
      const activeContent = override ? override.content : selectedPrompt.content
      return (
        <div className="pp-detail">
          {/* 详情 Header */}
          <div className="pp-detail-head">
            <div className="pp-detail-title-row">
              <h2 className="pp-detail-name">{selectedPrompt.name}</h2>
              <div className="pp-detail-badges">
                {selectedPrompt.isBuiltin && <span className="pp-badge pp-badge--builtin">内置</span>}
                {override && <span className="pp-badge pp-badge--override">已覆盖</span>}
                <span className="pp-badge pp-badge--cat">{CATEGORY_LABELS[selectedPrompt.category] || selectedPrompt.category}</span>
              </div>
            </div>
            <div className="pp-detail-actions">
              <button className="pp-icon-btn" onClick={() => handleEdit(selectedPrompt)} title="编辑">
                <Edit2 size={15} />
              </button>
              <button className="pp-icon-btn" onClick={() => handleCopy(activeContent)} title="复制内容">
                <Copy size={15} />
              </button>
              {!selectedPrompt.isBuiltin && (
                <>
                  <button
                    className="pp-icon-btn"
                    onClick={() => { setShowVersions(!showVersions); if (!showVersions) fetchVersions(selectedPrompt.id) }}
                    title="版本历史"
                  >
                    <History size={15} />
                  </button>
                  <button
                    className="pp-icon-btn pp-icon-btn--danger"
                    onClick={() => handleDelete(selectedPrompt.id)}
                    title="删除"
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
              {selectedPrompt.isBuiltin && override && (
                <button
                  className="pp-icon-btn pp-icon-btn--warn"
                  onClick={() => handleResetOverride(selectedPrompt.id)}
                  title="重置为内置默认"
                >
                  <RotateCcw size={15} />
                </button>
              )}
            </div>
          </div>

          <div className="pp-detail-body">
            {/* 使用场景提示 */}
            {PROMPT_USAGE_TIPS[selectedPrompt.id] && (
              <div className="pp-usage-tip">
                <Zap size={13} />
                <span>{PROMPT_USAGE_TIPS[selectedPrompt.id]}</span>
              </div>
            )}

            {/* 覆盖状态（内置提示词） */}
            {selectedPrompt.isBuiltin && (
              <div className="pp-override-bar">
                {override ? (
                  <div className="pp-override-bar--active">
                    <CheckCircle size={13} />
                    <span>自定义版本生效中</span>
                    <span className="pp-override-date">
                      最后修改 {new Date(override.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                ) : (
                  <div className="pp-override-bar--default">
                    <span>使用内置默认版本</span>
                    <span className="pp-override-hint">点击编辑可创建自定义版本</span>
                  </div>
                )}
              </div>
            )}

            {/* 描述 */}
            {selectedPrompt.description && (
              <p className="pp-desc">{selectedPrompt.description}</p>
            )}

            {/* 内容 */}
            <div className="pp-content-section">
              <div className="pp-content-label-row">
                <span className="pp-section-label">
                  {selectedPrompt.isBuiltin
                    ? (override ? '自定义内容（生效中）' : '内置内容')
                    : '内容'}
                </span>
                <button className="pp-copy-btn" onClick={() => handleCopy(activeContent)}>复制</button>
              </div>
              <div className="pp-content-box">
                <pre>{activeContent}</pre>
              </div>

              {selectedPrompt.isBuiltin && override && (
                <>
                  <div className="pp-content-label-row" style={{ marginTop: 12 }}>
                    <span className="pp-section-label pp-section-label--dim">内置原始内容（参考）</span>
                    <button className="pp-copy-btn" onClick={() => handleCopy(selectedPrompt.content)}>复制</button>
                  </div>
                  <div className="pp-content-box pp-content-box--dim">
                    <pre>{selectedPrompt.content}</pre>
                  </div>
                </>
              )}
            </div>

            {/* 标签 */}
            {selectedPrompt.tags.length > 0 && (
              <div className="pp-tags">
                {selectedPrompt.tags.map(t => (
                  <span key={t} className="pp-tag">{t}</span>
                ))}
              </div>
            )}

            {/* 信息网格 */}
            <div className="pp-info-grid">
              <div className="pp-info-item">
                <span className="pp-info-label">版本</span>
                <span className="pp-info-val">v{selectedPrompt.version}</span>
              </div>
              <div className="pp-info-item">
                <span className="pp-info-label">创建时间</span>
                <span className="pp-info-val">{new Date(selectedPrompt.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="pp-info-item">
                <span className="pp-info-label">更新时间</span>
                <span className="pp-info-val">{new Date(selectedPrompt.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>

            {/* 版本历史 */}
            {showVersions && versions.length > 0 && (
              <div className="pp-versions">
                <span className="pp-section-label">版本历史</span>
                {versions.map(v => (
                  <div key={v.id} className="pp-version-item">
                    <div className="pp-version-meta">
                      <span className="pp-version-num">v{v.version}</span>
                      <span className="pp-version-date">{new Date(v.createdAt).toLocaleDateString()}</span>
                      {v.changeNote && <span className="pp-version-note">{v.changeNote}</span>}
                    </div>
                    <button className="pp-restore-btn" onClick={() => handleRestoreVersion(v.version)}>
                      恢复
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )
    }

    /* 空状态 */
    return (
      <div className="pp-empty">
        <Zap size={32} strokeWidth={1.5} />
        <p>选择提示词查看详情</p>
        <span>内置提示词支持直接编辑，系统优先使用自定义版本</span>
      </div>
    )
  })()

  return (
    <div className="pp-root">
      {/* Toast */}
      {toast && (
        <div className={`pp-toast pp-toast--${toast.type}`}>{toast.msg}</div>
      )}

      {/* Header */}
      <header className="pp-header">
        <button className="wd-back-btn" onClick={() => navigate(-1)}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-left"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg>
          返回
        </button>
        <div className="pp-header-title">
          <Zap size={15} />
          提示词管理
        </div>
        <button className="pp-create-btn" onClick={handleCreateNew}>
          <Plus size={14} />
          新建
        </button>
      </header>

      <div className="pp-body">
        {/* 左侧列表 */}
        <aside className="pp-sidebar">
          {/* 搜索 */}
          <div className="pp-search-wrap">
            <Search size={13} className="pp-search-icon" />
            <input
              type="text"
              className="pp-search"
              placeholder="搜索提示词..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
          </div>

          {/* 分类标签 */}
          <div className="pp-tabs">
            {categories.map(cat => (
              <button
                key={cat}
                className={`pp-tab ${selectedCategory === cat ? 'pp-tab--active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat === 'all' ? '全部' : (CATEGORY_LABELS[cat] || cat)}
              </button>
            ))}
          </div>

          {/* 列表 */}
          <div className="pp-list">
            {filteredPrompts.length === 0 ? (
              <div className="pp-list-empty">没有找到提示词</div>
            ) : (
              filteredPrompts.map(prompt => {
                const hasOverride = prompt.isBuiltin && !!findOverride(prompt.id)
                const isActive = selectedPrompt?.id === prompt.id
                return (
                  <div
                    key={prompt.id}
                    className={`pp-item ${isActive ? 'pp-item--active' : ''}`}
                    onClick={() => handleSelectPrompt(prompt)}
                  >
                    <div className="pp-item-top">
                      <span className="pp-item-name">{prompt.name}</span>
                      <div className="pp-item-badges">
                        {prompt.isBuiltin && <span className="pp-badge pp-badge--builtin">内置</span>}
                        {hasOverride && <span className="pp-badge pp-badge--override">已覆盖</span>}
                      </div>
                    </div>
                    <p className="pp-item-desc">{prompt.description}</p>
                    <div className="pp-item-foot">
                      <span className="pp-item-cat">{CATEGORY_LABELS[prompt.category] || prompt.category}</span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </aside>

        {/* 右侧内容 */}
        <main className="pp-main">
          {rightContent}
        </main>
      </div>
    </div>
  )
}
