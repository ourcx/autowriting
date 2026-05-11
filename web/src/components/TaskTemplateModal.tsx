import { useState } from 'react'
import { X, Save } from 'lucide-react'
import {
  TaskTemplate,
  createNewTaskTemplate,
  saveCustomTaskTemplate,
} from '../utils/taskTemplateStore'
import './TaskTemplateModal.css'

interface Props {
  /** 传入则为编辑模式，不传则为新建 */
  initial?: TaskTemplate
  onClose: () => void
  onSaved: (t: TaskTemplate) => void
}

export default function TaskTemplateModal({ initial, onClose, onSaved }: Props) {
  const [tmpl, setTmpl] = useState<TaskTemplate>(() =>
    initial ? { ...initial } : createNewTaskTemplate()
  )

  const set = (patch: Partial<TaskTemplate>) =>
    setTmpl(prev => ({ ...prev, ...patch }))

  const handleSave = () => {
    if (!tmpl.name.trim()) return
    const saved = { ...tmpl, updatedAt: Date.now() }
    saveCustomTaskTemplate(saved)
    onSaved(saved)
    onClose()
  }

  return (
    <div className="ttm-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ttm-dialog">
        {/* Header */}
        <div className="ttm-header">
          <span className="ttm-title">{initial ? '编辑模板' : '新建写作模板'}</span>
          <button className="ttm-close" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="ttm-body">
          <div className="ttm-field-row">
            <div className="ttm-field ttm-field--name">
              <label className="ttm-label">模板名称</label>
              <input
                className="ttm-input"
                value={tmpl.name}
                onChange={e => set({ name: e.target.value })}
                placeholder="例：工具测评"
                maxLength={20}
              />
            </div>
            <div className="ttm-field ttm-field--desc">
              <label className="ttm-label">简介 <span className="ttm-opt">选填</span></label>
              <input
                className="ttm-input"
                value={tmpl.desc}
                onChange={e => set({ desc: e.target.value })}
                placeholder="一句话描述这个模板的适用场景"
                maxLength={40}
              />
            </div>
          </div>

          <div className="ttm-field">
            <label className="ttm-label">模板内容</label>
            <p className="ttm-hint">写成 Markdown 格式，应用后会直接填入「写作任务要求」输入框</p>
            <textarea
              className="ttm-textarea"
              value={tmpl.content}
              onChange={e => set({ content: e.target.value })}
              placeholder="# 写作任务要求&#10;&#10;## 基本信息&#10;- 文章主题：&#10;- 目标字数："
              spellCheck={false}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="ttm-footer">
          <button className="ttm-btn-cancel" onClick={onClose}>取消</button>
          <button
            className="ttm-btn-save"
            onClick={handleSave}
            disabled={!tmpl.name.trim()}
          >
            <Save size={14} />
            保存模板
          </button>
        </div>
      </div>
    </div>
  )
}
