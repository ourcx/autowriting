import React, { useState } from 'react'
import ModelSelector from './ModelSelector'
import './CoverGenerator.css'

interface CoverGeneratorProps {
  title: string
  content: string
  onCoverGenerated?: (imageUrl: string) => void
}

interface CoverStyle {
  id: string
  name: string
  description: string
  icon: string
}

interface CoverColor {
  id: string
  name: string
  hex: string
}

const COVER_STYLES: CoverStyle[] = [
  {
    id: 'modern',
    name: '现代风格',
    description: '简洁现代的设计风格',
    icon: '🎨'
  },
  {
    id: 'minimalist',
    name: '极简风格',
    description: '极简主义设计',
    icon: '⚪'
  },
  {
    id: 'gradient',
    name: '渐变风格',
    description: '彩色渐变背景',
    icon: '🌈'
  },
  {
    id: 'illustration',
    name: '插画风格',
    description: '手绘插画风格',
    icon: '🎭'
  },
  {
    id: 'photography',
    name: '摄影风格',
    description: '高质量摄影背景',
    icon: '📸'
  },
  {
    id: 'abstract',
    name: '抽象风格',
    description: '抽象艺术设计',
    icon: '🌀'
  }
]

const COVER_COLORS: CoverColor[] = [
  { id: 'matcha', name: '抹茶绿', hex: '#078a52' },
  { id: 'slushie', name: '冰沙蓝', hex: '#3bd3fd' },
  { id: 'lemon', name: '柠檬黄', hex: '#fbbd41' },
  { id: 'ube', name: '紫薯紫', hex: '#43089f' },
  { id: 'pomegranate', name: '石榴红', hex: '#fc7981' },
  { id: 'blueberry', name: '蓝莓蓝', hex: '#01418d' }
]

export const CoverGenerator: React.FC<CoverGeneratorProps> = ({
  title,
  content,
  onCoverGenerated
}) => {
  const [selectedStyle, setSelectedStyle] = useState<string>('modern')
  const [selectedColor, setSelectedColor] = useState<string>('matcha')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [apiProvider, setApiProvider] = useState<'stability' | 'openai' | 'local'>('local')

  const handleGenerateCover = async () => {
    if (!title.trim()) {
      setError('请输入文章标题')
      return
    }

    setIsGenerating(true)
    setError(null)

    try {
      const response = await fetch('/api/generate-cover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title,
          content: content.substring(0, 500), // 只发送前 500 字
          style: selectedStyle,
          color: selectedColor,
          provider: apiProvider
        })
      })

      if (!response.ok) {
        throw new Error('生成封面失败')
      }

      const data = await response.json()
      setGeneratedImage(data.imageUrl)
      onCoverGenerated?.(data.imageUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成封面失败，请重试')
      console.error('Cover generation error:', err)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleDownloadCover = () => {
    if (!generatedImage) return

    const link = document.createElement('a')
    link.href = generatedImage
    link.download = `cover-${Date.now()}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="cover-generator">
      <div className="generator-header">
        <h3>🖼️ AI 生成封面</h3>
        <p className="generator-subtitle">根据文章内容智能生成高质量封面</p>
      </div>

      {/* 模型选择器 */}
      <div className="model-selector-section">
        <ModelSelector
          selectedModel={apiProvider}
          onModelChange={(model) => setApiProvider(model as 'local' | 'stability' | 'openai')}
        />
      </div>

      <div className="generator-content">
        {/* 左侧：配置面板 */}
        <div className="config-panel">
          {/* 标题预览 */}
          <div className="config-section">
            <label className="config-label">文章标题</label>
            <div className="title-preview">{title || '输入标题以生成封面'}</div>
          </div>

          {/* 风格选择 */}
          <div className="config-section">
            <label className="config-label">设计风格</label>
            <div className="style-grid">
              {COVER_STYLES.map((style) => (
                <button
                  key={style.id}
                  className={`style-option ${selectedStyle === style.id ? 'active' : ''}`}
                  onClick={() => setSelectedStyle(style.id)}
                  title={style.description}
                >
                  <span className="style-icon">{style.icon}</span>
                  <span className="style-name">{style.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 颜色选择 */}
          <div className="config-section">
            <label className="config-label">主色调</label>
            <div className="color-grid">
              {COVER_COLORS.map((color) => (
                <button
                  key={color.id}
                  className={`color-option ${selectedColor === color.id ? 'active' : ''}`}
                  onClick={() => setSelectedColor(color.id)}
                  style={{ backgroundColor: color.hex }}
                  title={color.name}
                >
                  {selectedColor === color.id && <span className="checkmark">✓</span>}
                </button>
              ))}
            </div>
          </div>

          {/* 生成按钮 */}
          <div className="config-section">
            <button
              className="generate-button"
              onClick={handleGenerateCover}
              disabled={isGenerating || !title.trim()}
            >
              {isGenerating ? (
                <>
                  <span className="spinner"></span>
                  生成中...
                </>
              ) : (
                '✨ 生成封面'
              )}
            </button>
          </div>

          {/* 错误提示 */}
          {error && <div className="error-message">{error}</div>}
        </div>

        {/* 右侧：预览面板 */}
        <div className="preview-panel">
          {generatedImage ? (
            <div className="preview-container">
              <img src={generatedImage} alt="生成的封面" className="preview-image" />
              <div className="preview-actions">
                <button className="action-button download" onClick={handleDownloadCover}>
                  ⬇️ 下载
                </button>
                <button
                  className="action-button regenerate"
                  onClick={handleGenerateCover}
                  disabled={isGenerating}
                >
                  🔄 重新生成
                </button>
              </div>
            </div>
          ) : (
            <div className="preview-empty">
              <div className="empty-icon">🖼️</div>
              <p>选择风格和颜色，点击生成按钮创建封面</p>
            </div>
          )}
        </div>
      </div>

      {/* 提示信息 */}
      <div className="generator-tips">
        <p>
          ✅ <strong>已配置：</strong> Stability AI API 已启用，可以生成真实的 AI 图片。
          {apiProvider === 'local' && '当前使用本地演示模式，切换到 Stability AI 获得更好效果。'}
        </p>
      </div>
    </div>
  )
}

export default CoverGenerator
