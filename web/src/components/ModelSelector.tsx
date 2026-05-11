import React from 'react'
import './ModelSelector.css'

interface Model {
  id: string
  name: string
  provider: string
  description: string
  icon: string
  available: boolean
}

interface ModelSelectorProps {
  selectedModel: string
  onModelChange: (modelId: string) => void
}

const AVAILABLE_MODELS: Model[] = [
  {
    id: 'local',
    name: '本地模式',
    provider: 'local',
    description: '快速生成，无需 API 密钥',
    icon: '⚡',
    available: true
  },
  {
    id: 'stability',
    name: 'Stability AI',
    provider: 'stability',
    description: '高质量图片生成，支持多种风格',
    icon: '🎨',
    available: true
  },
  {
    id: 'openai',
    name: 'OpenAI DALL-E 3',
    provider: 'openai',
    description: '最先进的图片生成模型，需要 API 密钥',
    icon: '✨',
    available: true
  },
  {
    id: 'siliconflow',
    name: 'Kolors（可图）',
    provider: 'siliconflow',
    description: '快手可图大模型，性价比高，国内速度快',
    icon: '🖌️',
    available: true
  }
]

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModel,
  onModelChange
}) => {
  return (
    <div className="model-selector">
      <div className="selector-header">
        <h3>选择 AI 模型</h3>
        <p className="selector-subtitle">选择不同的 AI 模型生成封面</p>
      </div>

      <div className="models-grid">
        {AVAILABLE_MODELS.map((model) => (
          <div
            key={model.id}
            className={`model-card ${selectedModel === model.id ? 'active' : ''} ${
              !model.available ? 'disabled' : ''
            }`}
            onClick={() => model.available && onModelChange(model.id)}
          >
            <div className="model-icon">{model.icon}</div>
            <div className="model-info">
              <h4>{model.name}</h4>
              <p className="model-provider">{model.provider}</p>
              <p className="model-description">{model.description}</p>
            </div>
            {selectedModel === model.id && (
              <div className="model-checkmark">✓</div>
            )}
            {!model.available && (
              <div className="model-badge">即将推出</div>
            )}
          </div>
        ))}
      </div>

      <div className="model-tips">
        <div className="tip-item">
          <span className="tip-icon">💡</span>
          <div>
            <strong>本地模式</strong>：快速生成占位符封面，适合快速预览
          </div>
        </div>
        <div className="tip-item">
          <span className="tip-icon">🔑</span>
          <div>
            <strong>API 模式</strong>：需要配置相应的 API 密钥，生成质量更高
          </div>
        </div>
        <div className="tip-item">
          <span className="tip-icon">⚙️</span>
          <div>
            <strong>自动降级</strong>：API 失败时自动降级到本地模式
          </div>
        </div>
      </div>
    </div>
  )
}

export default ModelSelector
