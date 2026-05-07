import { useState } from 'react'
import { Zap, Clock, Send, Save, CheckCircle } from 'lucide-react'
import axios from 'axios'
import './AutomationPanel.css'

interface AutomationPanelProps {
  dateDir: string
  title: string
  task: string
  materials: string
  article: string
  onGenerate: () => Promise<void>
  onSave: () => Promise<void>
  onPublish: () => void
}

export default function AutomationPanel({
  dateDir,
  title,
  task,
  materials,
  article,
  onGenerate,
  onSave,
  onPublish
}: AutomationPanelProps) {
  const [autoSave, setAutoSave] = useState(true)
  const [autoSaveInterval, setAutoSaveInterval] = useState(5) // 分钟
  const [lastSaveTime, setLastSaveTime] = useState<Date | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [showScheduler, setShowScheduler] = useState(false)
  const [scheduledTime, setScheduledTime] = useState('')

  // 自动保存逻辑
  const handleAutoSave = async () => {
    if (!autoSave) return
    
    try {
      setIsSaving(true)
      await onSave()
      setLastSaveTime(new Date())
    } catch (error) {
      console.error('Auto save failed:', error)
    } finally {
      setIsSaving(false)
    }
  }

  // 快速生成流程
  const handleQuickGenerate = async () => {
    if (!task || !materials) {
      alert('请先填写任务和素材')
      return
    }
    
    try {
      await onGenerate()
      // 自动保存
      await handleAutoSave()
    } catch (error) {
      console.error('Quick generate failed:', error)
    }
  }

  // 一键发布流程
  const handleQuickPublish = async () => {
    if (!article) {
      alert('请先生成文章内容')
      return
    }

    try {
      // 先保存
      await onSave()
      // 再发布
      onPublish()
    } catch (error) {
      console.error('Quick publish failed:', error)
    }
  }

  // 定时发布
  const handleSchedulePublish = async () => {
    if (!scheduledTime) {
      alert('请选择发布时间')
      return
    }

    const publishTime = new Date(scheduledTime)
    const now = new Date()

    if (publishTime <= now) {
      alert('请选择未来的时间')
      return
    }

    const delay = publishTime.getTime() - now.getTime()
    
    // 保存定时任务到 localStorage
    const scheduledTasks = JSON.parse(localStorage.getItem('scheduledTasks') || '[]')
    scheduledTasks.push({
      id: Date.now(),
      dateDir,
      title,
      publishTime: publishTime.toISOString(),
      delay
    })
    localStorage.setItem('scheduledTasks', JSON.stringify(scheduledTasks))

    alert(`文章已安排在 ${publishTime.toLocaleString()} 发布`)
    setShowScheduler(false)
    setScheduledTime('')
  }

  const formatLastSaveTime = () => {
    if (!lastSaveTime) return '未保存'
    const now = new Date()
    const diff = Math.floor((now.getTime() - lastSaveTime.getTime()) / 1000)
    
    if (diff < 60) return '刚刚'
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
    return `${Math.floor(diff / 3600)} 小时前`
  }

  return (
    <div className="automation-panel">
      <div className="automation-header">
        <h3>⚡ 自动化操作</h3>
        <p>快速完成文章生成、保存和发布</p>
      </div>

      <div className="automation-content">
        {/* 快速操作按钮 */}
        <div className="quick-actions">
          <button
            className="action-btn action-generate"
            onClick={handleQuickGenerate}
            disabled={!task || !materials}
            title="快速生成文章（需要任务和素材）"
          >
            <Zap size={20} />
            <span>快速生成</span>
          </button>

          <button
            className="action-btn action-save"
            onClick={handleAutoSave}
            disabled={isSaving}
            title="立即保存所有内容"
          >
            <Save size={20} />
            <span>{isSaving ? '保存中...' : '立即保存'}</span>
          </button>

          <button
            className="action-btn action-publish"
            onClick={handleQuickPublish}
            disabled={!article}
            title="一键发布到微信（需要文章内容）"
          >
            <Send size={20} />
            <span>一键发布</span>
          </button>

          <button
            className="action-btn action-schedule"
            onClick={() => setShowScheduler(!showScheduler)}
            title="定时发布文章"
          >
            <Clock size={20} />
            <span>定时发布</span>
          </button>
        </div>

        {/* 自动保存设置 */}
        <div className="auto-save-section">
          <div className="setting-item">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={autoSave}
                onChange={(e) => setAutoSave(e.target.checked)}
              />
              <span>启用自动保存</span>
            </label>
            {autoSave && (
              <div className="interval-control">
                <label>间隔时间：</label>
                <select
                  value={autoSaveInterval}
                  onChange={(e) => setAutoSaveInterval(Number(e.target.value))}
                  className="interval-select"
                >
                  <option value={1}>1 分钟</option>
                  <option value={3}>3 分钟</option>
                  <option value={5}>5 分钟</option>
                  <option value={10}>10 分钟</option>
                </select>
              </div>
            )}
          </div>

          <div className="save-status">
            <CheckCircle size={16} className="status-icon" />
            <span>最后保存：{formatLastSaveTime()}</span>
          </div>
        </div>

        {/* 定时发布面板 */}
        {showScheduler && (
          <div className="scheduler-panel">
            <h4>定时发布</h4>
            <div className="scheduler-form">
              <div className="form-group">
                <label>发布时间</label>
                <input
                  type="datetime-local"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  className="datetime-input"
                />
              </div>
              <div className="scheduler-actions">
                <button
                  className="btn btn-primary"
                  onClick={handleSchedulePublish}
                  disabled={!scheduledTime}
                >
                  确认安排
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowScheduler(false)}
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 快捷键提示 */}
        <div className="shortcuts-hint">
          <p>💡 快捷键提示：</p>
          <ul>
            <li><kbd>Ctrl</kbd> + <kbd>S</kbd> 保存</li>
            <li><kbd>Ctrl</kbd> + <kbd>G</kbd> 生成</li>
            <li><kbd>Ctrl</kbd> + <kbd>P</kbd> 发布</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
