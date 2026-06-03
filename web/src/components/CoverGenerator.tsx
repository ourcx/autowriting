import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadAIConfig } from '../utils/aiConfig'
import { toast } from './Toast'
import './CoverGenerator.css'

interface CoverGeneratorProps {
  title: string
  content: string
  onCoverGenerated?: (imageUrl: string) => void
}

interface StyleOption {
  id: string
  name: string
  desc: string
}

interface ColorOption {
  id: string
  name: string
  hex: string
}

interface ProviderOption {
  id: string
  name: string
  desc: string
  /** 哪个 key 字段必须非空 */
  requiresKey: 'siliconflowApiKey' | 'coverApiKey' | null
  /** 配置页的描述 */
  keyLabel: string
}

const COVER_STYLES: StyleOption[] = [
  { id: 'modern',       name: '现代',   desc: '扁平几何，强版面' },
  { id: 'minimalist',   name: '极简',   desc: '留白为主，单色调' },
  { id: 'gradient',     name: '渐变',   desc: '双色渐变，当代感' },
  { id: 'illustration', name: '插画',   desc: '扁平插图，编辑风' },
  { id: 'photography',  name: '摄影',   desc: '电影感，杂志封面' },
  { id: 'abstract',     name: '抽象',   desc: '几何形体，动感构成' },
]

const COVER_COLORS: ColorOption[] = [
  { id: 'matcha',      name: '抹茶绿', hex: '#078a52' },
  { id: 'slushie',     name: '冰沙蓝', hex: '#3bd3fd' },
  { id: 'lemon',       name: '柠檬黄', hex: '#fbbd41' },
  { id: 'ube',         name: '紫薯紫', hex: '#43089f' },
  { id: 'pomegranate', name: '石榴红', hex: '#fc7981' },
  { id: 'blueberry',   name: '蓝莓蓝', hex: '#01418d' },
]

const PROVIDERS: ProviderOption[] = [
  {
    id: 'local',
    name: 'SVG 占位',
    desc: '免费，秒出',
    requiresKey: null,
    keyLabel: '',
  },
  {
    id: 'siliconflow',
    name: 'Kolors 可图',
    desc: '文生图，性价比高',
    requiresKey: 'siliconflowApiKey',
    keyLabel: 'SiliconFlow API Key',
  },
  {
    id: 'z-image',
    name: 'Z-Image 造相',
    desc: '高质量，复杂提示词',
    requiresKey: 'siliconflowApiKey',
    keyLabel: 'SiliconFlow API Key',
  },
  {
    id: 'qwen-edit',
    name: 'Qwen 图片编辑',
    desc: '对已有封面 AI 精修',
    requiresKey: 'siliconflowApiKey',
    keyLabel: 'SiliconFlow API Key',
  },
  {
    id: 'openai',
    name: 'DALL-E 3',
    desc: 'OpenAI 旗舰图模型',
    requiresKey: 'coverApiKey',
    keyLabel: 'OpenAI API Key',
  },
  {
    id: 'stability',
    name: 'Stability AI',
    desc: 'SD 系列',
    requiresKey: 'coverApiKey',
    keyLabel: 'Stability API Key',
  },
]

export const CoverGenerator: React.FC<CoverGeneratorProps> = ({
  title,
  content,
  onCoverGenerated,
}) => {
  const navigate = useNavigate()

  const [selectedStyle,  setSelectedStyle]  = useState('modern')
  const [selectedColor,  setSelectedColor]  = useState('matcha')
  const [provider,       setProvider]       = useState('siliconflow')
  const [customPrompt,   setCustomPrompt]   = useState('')
  const [isGenerating,   setIsGenerating]   = useState(false)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [error,          setError]          = useState<string | null>(null)
  const [missingKey,     setMissingKey]     = useState<string | null>(null)
  const [isSavingToLibrary, setIsSavingToLibrary] = useState(false)

  // provider 切换时检查 key
  useEffect(() => {
    const cfg  = loadAIConfig()
    const prov = PROVIDERS.find(p => p.id === provider)
    if (!prov || !prov.requiresKey) {
      setMissingKey(null)
      return
    }
    const keyVal = (cfg[prov.requiresKey] as string | undefined) || ''
    setMissingKey(keyVal.trim() ? null : prov.keyLabel)
  }, [provider])

  const handleGenerate = async () => {
    if (!title.trim()) {
      setError('文章标题为空，无法生成封面')
      return
    }
    setIsGenerating(true)
    setError(null)

    try {
      const aiConfig = loadAIConfig()

      // ── 诊断日志（browser console）────────────────────────────────────────
      console.group('[CoverGenerator] 发起生成请求')
      console.log('provider         :', provider)
      console.log('siliconflowApiKey:', aiConfig.siliconflowApiKey
        ? `sk-...${aiConfig.siliconflowApiKey.slice(-6)} (len=${aiConfig.siliconflowApiKey.length})`
        : '❌ 空')
      console.log('siliconflowModel :', aiConfig.siliconflowModel)
      console.log('coverApiKey      :', aiConfig.coverApiKey
        ? `sk-...${aiConfig.coverApiKey.slice(-6)}`
        : '❌ 空')
      console.log('localStorage raw :', localStorage.getItem('wx-ai-config-v1')?.slice(0, 200))
      console.groupEnd()
      // ──────────────────────────────────────────────────────────────────────

      const body: Record<string, unknown> = {
        title,
        content: content.substring(0, 500),
        style: selectedStyle,
        color: selectedColor,
        provider,
        customPrompt: customPrompt.trim() || undefined,
        aiConfig: {
          siliconflowApiKey: aiConfig.siliconflowApiKey,
          siliconflowModel:  aiConfig.siliconflowModel,
          coverApiKey:       aiConfig.coverApiKey,
          articleApiKey:     aiConfig.articleApiKey,
        },
      }
      // Qwen-Edit：带入当前封面作为基图
      if (provider === 'qwen-edit' && generatedImage) {
        body.baseImageUrl = generatedImage
      }

      const res = await fetch('/api/generate-cover', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })

      const data = await res.json().catch(() => ({})) as Record<string, string>

      // ── 响应诊断日志 ──────────────────────────────────────────────────────
      console.group('[CoverGenerator] 服务端响应')
      console.log('status     :', res.status)
      console.log('imageUrl前80:', data.imageUrl?.slice(0, 80))
      console.log('是SVG兜底   :', data.imageUrl?.startsWith('data:image/svg'))
      if (data.warning) console.warn('warning:', data.warning)
      if (data.error)   console.error('error:', data.error)
      console.groupEnd()
      // ──────────────────────────────────────────────────────────────────────

      if (!res.ok) {
        throw new Error(data.error || `请求失败 (${res.status})`)
      }
      if (!data.imageUrl) {
        throw new Error('服务端未返回图片 URL')
      }

      setGeneratedImage(data.imageUrl)
      onCoverGenerated?.(data.imageUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成封面失败，请重试')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleDownload = () => {
    if (!generatedImage) return
    const a = document.createElement('a')
    a.href = generatedImage
    a.download = `cover-${Date.now()}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleSaveToLibrary = async () => {
    if (!generatedImage) return
    setIsSavingToLibrary(true)
    try {
      const response = await fetch('/api/images/upload-base64', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: generatedImage,
          mimeType: 'image/png',
          originalName: `cover-${title}-${Date.now()}.png`,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '保存失败')
      }
      toast.success('已保存到图片库')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存到图片库失败')
    } finally {
      setIsSavingToLibrary(false)
    }
  }

  const currentProvider = PROVIDERS.find(p => p.id === provider)

  return (
    <div className="cg-root">

      {/* ── 左列：配置面板 ── */}
      <div className="cg-config">

        {/* 文章标题 */}
        <div className="cg-field">
          <span className="cg-label">文章标题</span>
          <div className="cg-title-chip">{title || '（未填写标题）'}</div>
        </div>

        {/* 模型选择 */}
        <div className="cg-field">
          <span className="cg-label">生成模型</span>
          <div className="cg-provider-grid">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                className={`cg-provider-card ${provider === p.id ? 'active' : ''}`}
                onClick={() => setProvider(p.id)}
              >
                <span className="cg-provider-name">{p.name}</span>
                <span className="cg-provider-desc">{p.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Key 缺失提示 */}
        {missingKey && (
          <div className="cg-notice cg-notice--warn">
            <span>
              {currentProvider?.keyLabel} 未配置，无法调用此模型。
            </span>
            <button
              className="cg-notice-link"
              onClick={() => navigate('/settings')}
            >
              前往配置 →
            </button>
          </div>
        )}

        {/* Qwen-Edit 状态提示 */}
        {provider === 'qwen-edit' && !missingKey && (
          <div className={`cg-notice ${generatedImage ? 'cg-notice--ok' : 'cg-notice--info'}`}>
            {generatedImage
              ? '将对当前封面进行 AI 精修，可在下方输入编辑指令'
              : '请先用其他模型生成一张基础封面，再切换到此模式精修'}
          </div>
        )}

        {/* 画面风格 */}
        <div className="cg-field">
          <span className="cg-label">画面风格</span>
          <div className="cg-style-grid">
            {COVER_STYLES.map(s => (
              <button
                key={s.id}
                className={`cg-style-card ${selectedStyle === s.id ? 'active' : ''}`}
                onClick={() => setSelectedStyle(s.id)}
              >
                <span className="cg-style-name">{s.name}</span>
                <span className="cg-style-desc">{s.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 主色调 */}
        <div className="cg-field">
          <span className="cg-label">主色调</span>
          <div className="cg-color-row">
            {COVER_COLORS.map(c => (
              <button
                key={c.id}
                className={`cg-color-swatch ${selectedColor === c.id ? 'active' : ''}`}
                style={{ backgroundColor: c.hex }}
                onClick={() => setSelectedColor(c.id)}
                title={c.name}
              >
                {selectedColor === c.id && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 7l4 4 6-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 自定义 Prompt */}
        <div className="cg-field">
          <span className="cg-label">
            自定义描述
            <span className="cg-label-opt">可选</span>
          </span>
          <textarea
            className="cg-prompt-input"
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            placeholder={
              provider === 'qwen-edit'
                ? '描述你想如何修改这张封面，例如：换成蓝色调，加入科技感元素'
                : '描述你想要的画面，留空则根据标题和风格自动生成'
            }
            rows={3}
          />
        </div>

        {/* 错误信息 */}
        {error && (
          <div className="cg-notice cg-notice--error">
            {error}
          </div>
        )}

        {/* 生成按钮 */}
        <button
          className="cg-generate-btn"
          onClick={handleGenerate}
          disabled={isGenerating || !title.trim() || !!missingKey}
        >
          {isGenerating
            ? <><span className="cg-spinner" /> 生成中…</>
            : provider === 'qwen-edit' && generatedImage
              ? '精修封面'
              : '生成封面'
          }
        </button>

      </div>

      {/* ── 右列：预览 ── */}
      <div className="cg-preview">
        {generatedImage ? (
          <>
            <div className="cg-preview-frame">
              <img src={generatedImage} alt="封面预览" className="cg-preview-img" />
            </div>
            <div className="cg-preview-actions">
              <button className="cg-action-btn cg-action-btn--primary" onClick={handleDownload}>
                下载封面
              </button>
              <button
                className="cg-action-btn"
                onClick={handleSaveToLibrary}
                disabled={isSavingToLibrary}
              >
                {isSavingToLibrary ? '保存中...' : '保存到图片库'}
              </button>
              <button
                className="cg-action-btn"
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                重新生成
              </button>
            </div>
          </>
        ) : (
          <div className="cg-preview-empty">
            <div className="cg-empty-inner">
              <p className="cg-empty-title">配置左侧选项后点击「生成封面」</p>
              <p className="cg-empty-hint">公众号推荐比例 2.35:1 · 1024×576px</p>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

export default CoverGenerator
