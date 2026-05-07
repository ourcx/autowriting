import React, { useState } from 'react'
import { Copy, Check, AlertCircle, Loader } from 'lucide-react'
import './WeChatPublisher.css'

interface WeChatPublisherProps {
  title: string
  content: string
  coverImage?: string
  onPublish?: () => void
}

interface PublishStep {
  id: string
  title: string
  description: string
  completed: boolean
  action?: () => void
}

export const WeChatPublisher: React.FC<WeChatPublisherProps> = ({
  title,
  content,
  coverImage,
  onPublish
}) => {
  const [publishMethod, setPublishMethod] = useState<'auto' | 'manual'>('auto')
  const [copied, setCopied] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishStatus, setPublishStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  // 转换 Markdown 为微信公众号格式
  const convertToWeChatFormat = (markdown: string): string => {
    let html = markdown
      // 标题
      .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
      .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
      .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
      // 加粗
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // 斜体
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // 代码块
      .replace(/```(.*?)```/gs, '<pre><code>$1</code></pre>')
      // 行内代码
      .replace(/`(.*?)`/g, '<code>$1</code>')
      // 列表
      .replace(/^- (.*?)$/gm, '<li>$1</li>')
      // 换行
      .replace(/\n/g, '<br/>')

    return html
  }

  // 复制到剪贴板
  const handleCopyContent = async () => {
    try {
      const weChatFormat = convertToWeChatFormat(content)
      await navigator.clipboard.writeText(weChatFormat)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  // 自动发布到草稿箱
  const handleAutoPublish = async () => {
    try {
      setPublishing(true)
      setPublishStatus('processing')
      setErrorMessage('')

      // 调用后端 API 生成草稿
      const response = await fetch('/api/publish/draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title,
          content: convertToWeChatFormat(content),
          coverImage,
          timestamp: new Date().toISOString()
        })
      })

      if (!response.ok) {
        throw new Error('发布失败，请重试')
      }

      const data = await response.json()
      setPublishStatus('success')
      onPublish?.()

      // 3 秒后自动打开微信公众号平台
      setTimeout(() => {
        window.open('https://mp.weixin.qq.com/', '_blank')
      }, 1500)
    } catch (error) {
      setPublishStatus('error')
      setErrorMessage(error instanceof Error ? error.message : '发布失败')
      console.error('Publish error:', error)
    } finally {
      setPublishing(false)
    }
  }

  // 手动发布步骤
  const manualSteps: PublishStep[] = [
    {
      id: 'copy',
      title: '复制文章内容',
      description: '点击下方按钮复制已格式化的文章内容',
      completed: copied,
      action: handleCopyContent
    },
    {
      id: 'open',
      title: '打开微信公众号后台',
      description: '点击按钮打开微信公众号编辑器',
      completed: false,
      action: () => window.open('https://mp.weixin.qq.com/', '_blank')
    },
    {
      id: 'paste',
      title: '粘贴内容',
      description: '在微信编辑器中粘贴文章内容（Ctrl+V 或 Cmd+V）',
      completed: false
    },
    {
      id: 'upload',
      title: '上传封面',
      description: '点击「上传图片」按钮上传文章封面',
      completed: false
    },
    {
      id: 'save',
      title: '保存为草稿',
      description: '点击「保存」按钮将文章保存为草稿',
      completed: false
    }
  ]

  return (
    <div className="wechat-publisher">
      <div className="publisher-header">
        <h3>📱 发布到微信公众号</h3>
        <p className="publisher-subtitle">选择发布方式将文章发送到微信草稿箱</p>
      </div>

      {/* 发布方式选择 */}
      <div className="publish-method-selector">
        <div className="method-options">
          <label className="method-option">
            <input
              type="radio"
              value="auto"
              checked={publishMethod === 'auto'}
              onChange={(e) => setPublishMethod(e.target.value as 'auto' | 'manual')}
            />
            <div className="method-info">
              <span className="method-title">🚀 自动发布</span>
              <span className="method-desc">一键发布到草稿箱，自动打开微信编辑器</span>
            </div>
          </label>
          <label className="method-option">
            <input
              type="radio"
              value="manual"
              checked={publishMethod === 'manual'}
              onChange={(e) => setPublishMethod(e.target.value as 'auto' | 'manual')}
            />
            <div className="method-info">
              <span className="method-title">📋 手动发布</span>
              <span className="method-desc">按步骤手动复制和粘贴内容</span>
            </div>
          </label>
        </div>
      </div>

      {/* 自动发布模式 */}
      {publishMethod === 'auto' && (
        <div className="auto-publish-section">
          <div className="publish-preview">
            <div className="preview-header">
              <h4>📄 文章预览</h4>
              <span className="preview-stats">
                {content.length} 字 · {Math.ceil(content.length / 300)} 分钟阅读
              </span>
            </div>
            <div className="preview-content">
              <h5>{title || '未命名文章'}</h5>
              {coverImage && (
                <img src={coverImage} alt="封面" className="preview-cover" />
              )}
              <p className="preview-text">{content.substring(0, 200)}...</p>
            </div>
          </div>

          {/* 发布状态 */}
          {publishStatus === 'success' && (
            <div className="publish-success">
              <Check size={24} />
              <h4>发布成功！</h4>
              <p>文章已生成草稿，微信编辑器即将打开</p>
              <p className="success-tip">💡 在微信编辑器中可以继续编辑和调整</p>
            </div>
          )}

          {publishStatus === 'error' && (
            <div className="publish-error">
              <AlertCircle size={24} />
              <h4>发布失败</h4>
              <p>{errorMessage}</p>
              <button
                className="btn btn-secondary"
                onClick={() => setPublishStatus('idle')}
              >
                重试
              </button>
            </div>
          )}

          {publishStatus === 'idle' && (
            <button
              className="btn btn-primary btn-large"
              onClick={handleAutoPublish}
              disabled={!title || !content}
            >
              <span>🚀 发布到草稿箱</span>
            </button>
          )}

          {publishStatus === 'processing' && (
            <div className="publish-processing">
              <Loader size={24} className="spinner" />
              <p>正在生成草稿...</p>
            </div>
          )}

          <div className="publish-tips">
            <div className="tip-item">
              <span className="tip-icon">✅</span>
              <div>
                <strong>自动格式化</strong>：文章内容会自动转换为微信公众号格式
              </div>
            </div>
            <div className="tip-item">
              <span className="tip-icon">📱</span>
              <div>
                <strong>自动打开编辑器</strong>：发布后自动打开微信公众号编辑器
              </div>
            </div>
            <div className="tip-item">
              <span className="tip-icon">💾</span>
              <div>
                <strong>保存为草稿</strong>：文章保存为草稿，可随时编辑和发布
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 手动发布模式 */}
      {publishMethod === 'manual' && (
        <div className="manual-publish-section">
          <div className="steps-container">
            {manualSteps.map((step, index) => (
              <div key={step.id} className="step-item">
                <div className="step-number">
                  {step.completed ? <Check size={20} /> : index + 1}
                </div>
                <div className="step-content">
                  <h4>{step.title}</h4>
                  <p>{step.description}</p>
                </div>
                {step.action && (
                  <button
                    className={`step-action ${step.completed ? 'completed' : ''}`}
                    onClick={step.action}
                  >
                    {step.id === 'copy' ? (
                      copied ? (
                        <>
                          <Check size={16} />
                          已复制
                        </>
                      ) : (
                        <>
                          <Copy size={16} />
                          复制
                        </>
                      )
                    ) : (
                      '打开'
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="manual-tips">
            <h4>💡 提示</h4>
            <ul>
              <li>确保文章标题和内容完整</li>
              <li>复制的内容已自动格式化为微信公众号格式</li>
              <li>在微信编辑器中可以进一步调整样式</li>
              <li>保存为草稿后可以随时发布</li>
            </ul>
          </div>
        </div>
      )}

      {/* 发布历史 */}
      <div className="publish-history">
        <h4>📜 发布历史</h4>
        <p className="history-placeholder">
          发布的文章会显示在这里
        </p>
      </div>
    </div>
  )
}

export default WeChatPublisher
