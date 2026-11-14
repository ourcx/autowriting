import { Textarea } from "../FormControls/FormControls"
import Button from "../Button/Button"
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { toast } from '../Toast/Toast'
import './CoverGenerator.css'
import { loadAIConfig, loadGenCliPairingCode, type CoverProvider } from '../../utils/aiConfig'
import { generateCoverImage, generateCoverWithLocalGenCli, generateOpenRouterCoverInBrowser, uploadBase64Image } from '../../utils/apiHelpers'

interface CoverGeneratorProps {
  title: string
  content: string
  articleId?: string
  onCoverGenerated?: (imageUrl: string) => void
}

interface ProviderOption {
  id: CoverProvider
  name: string
  desc: string
  /** 哪个 key 字段必须非空 */
  requiresKey: 'siliconflowApiKey' | 'coverApiKey' | 'doubaoApiKey' | 'zhipuApiKey' | 'openrouterApiKey' | null
  /** 配置页的描述 */
  keyLabel: string
}

const PROVIDERS: ProviderOption[] = [
  {
    id: 'openrouter',
    name: 'GPT Image 2',
    desc: 'OpenRouter，浏览器直连',
    requiresKey: 'openrouterApiKey',
    keyLabel: 'OpenRouter API Key',
  },
  {
    id: 'gencli',
    name: 'Gen CLI',
    desc: '本机调用 GPT Image 2',
    requiresKey: null,
    keyLabel: '本机配对码',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM-Image',
    desc: '中文文字与复杂版式',
    requiresKey: 'zhipuApiKey',
    keyLabel: '智谱公共 API Key',
  },
  {
    id: 'local',
    name: 'SVG 占位',
    desc: '免费，秒出',
    requiresKey: null,
    keyLabel: '',
  },
  {
    id: 'doubao',
    name: '豆包 Seedream',
    desc: '中文提示词，高清横图',
    requiresKey: 'doubaoApiKey',
    keyLabel: '豆包方舟 API Key 与模型 ID',
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

// localStorage key for persisting cover image per article
const coverStorageKey = (id?: string) =>
  id ? `cover_image_${id}` : null

function defaultCoverPrompt(title: string): string {
  return `生成一个微信公众号文章封面，画幅 2.35:1，简约、有设计感，不使用写实物体，不添加 Logo 或水印。文章标题是：${title.trim() || '公众号文章标题'}。`
}

export const CoverGenerator: React.FC<CoverGeneratorProps> = ({
  title,
  content,
  articleId,
  onCoverGenerated,
}) => {
  const navigate = useNavigate()

  const [provider,       setProvider]       = useState<CoverProvider>(() => loadAIConfig().coverProvider)
  const [customPrompt,   setCustomPrompt]   = useState(() => defaultCoverPrompt(title))
  const [isGenerating,   setIsGenerating]   = useState(false)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [error,          setError]          = useState<string | null>(null)
  const [missingKey,     setMissingKey]     = useState<string | null>(null)
  const [isSavingToLibrary, setIsSavingToLibrary] = useState(false)
  const [isDragOver,        setIsDragOver]        = useState(false)
  const pasteZoneRef = useRef<HTMLDivElement>(null)
  const previousDefaultPromptRef = useRef(defaultCoverPrompt(title))

  useEffect(() => {
    const nextDefaultPrompt = defaultCoverPrompt(title)
    setCustomPrompt(current => current === previousDefaultPromptRef.current ? nextDefaultPrompt : current)
    previousDefaultPromptRef.current = nextDefaultPrompt
  }, [title])

  // 挂载时从 localStorage 恢复封面（刷新后保持）
  useEffect(() => {
    const key = coverStorageKey(articleId)
    if (!key) return
    const saved = localStorage.getItem(key)
    if (saved) {
      setGeneratedImage(saved)
      onCoverGenerated?.(saved)
    }
  }, [articleId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cfg  = loadAIConfig()
    if (provider === 'gencli') {
      setMissingKey(loadGenCliPairingCode() ? null : '本机配对码')
      return
    }
    const prov = PROVIDERS.find(p => p.id === provider)
    if (!prov || !prov.requiresKey) {
      setMissingKey(null)
      return
    }
    const keyVal = provider === 'zhipu'
      ? cfg.zhipuImageApiKey || cfg.zhipuApiKey
      : (cfg[prov.requiresKey] as string | undefined) || ''
    const modelReady = provider !== 'doubao' || Boolean(cfg.doubaoModel.trim())
    setMissingKey(keyVal.trim() && modelReady ? null : prov.keyLabel)
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
      if (provider === 'gencli') {
        const { imageUrl } = await generateCoverWithLocalGenCli(customPrompt, loadGenCliPairingCode())
        setGeneratedImage(imageUrl)
        persistCover(imageUrl)
        return
      }

      const body: Record<string, unknown> = {
        title,
        content: content.substring(0, 500),
        style: 'prompt',
        color: 'auto',
        provider,
        customPrompt: customPrompt.trim(),
        aiConfig: {
          siliconflowApiKey: aiConfig.siliconflowApiKey,
          siliconflowModel:  aiConfig.siliconflowModel,
          doubaoApiKey:      aiConfig.doubaoApiKey,
          doubaoBaseUrl:     aiConfig.doubaoBaseUrl,
          doubaoModel:       aiConfig.doubaoModel,
          coverApiKey:       aiConfig.coverApiKey,
          articleApiKey:     aiConfig.articleApiKey,
          zhipuApiKey:       aiConfig.zhipuApiKey,
          zhipuImageApiKey:  aiConfig.zhipuImageApiKey,
          glmApiKey:         aiConfig.glmApiKey,
        },
      }
      // Qwen-Edit：带入当前封面作为基图
      if (provider === 'qwen-edit' && generatedImage) {
        body.baseImageUrl = generatedImage
      }

      let data: { imageUrl: string; warning?: string } = provider === 'openrouter'
        ? await generateOpenRouterCoverInBrowser(customPrompt, aiConfig.openrouterApiKey)
        : await generateCoverImage(body)

      if (provider === 'openrouter') {
        try {
          const uploaded = await uploadBase64Image({
            data: data.imageUrl,
            mimeType: 'image/png',
            originalName: `cover-${title}-${Date.now()}.png`,
            articleId,
          })
          data = {
            imageUrl: uploaded.url.startsWith('http')
              ? uploaded.url
              : `${window.location.origin}${uploaded.url}`,
          }
        } catch {
          toast.warn('封面已生成，但保存到图片库失败，请先下载备份')
        }
      }

      // ── 响应诊断日志 ──────────────────────────────────────────────────────
      console.group('[CoverGenerator] 服务端响应')
      console.log('imageUrl前80:', data.imageUrl?.slice(0, 80))
      console.log('是SVG兜底   :', data.imageUrl?.startsWith('data:image/svg'))
      if (data.warning) console.warn('warning:', data.warning)
      console.groupEnd()
      // ──────────────────────────────────────────────────────────────────────

      if (!data.imageUrl) {
        throw new Error('服务端未返回图片 URL')
      }

      setGeneratedImage(data.imageUrl)
      persistCover(data.imageUrl)
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
    a.download = `cover-${Date.now()}.${generatedImage.startsWith('data:image/jpeg;') ? 'jpg' : 'png'}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleSaveToLibrary = async () => {
    if (!generatedImage) return
    setIsSavingToLibrary(true)
    try {
      const jpeg = generatedImage.startsWith('data:image/jpeg;')
      await uploadBase64Image({
        data: generatedImage,
        mimeType: jpeg ? 'image/jpeg' : 'image/png',
        originalName: `cover-${title}-${Date.now()}.${jpeg ? 'jpg' : 'png'}`,
      })
      toast.success('已保存到图片库')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存到图片库失败')
    } finally {
      setIsSavingToLibrary(false)
    }
  }

  const currentProvider = PROVIDERS.find(p => p.id === provider)

  // 将封面图片 URL 持久化到 localStorage，供发布预览页读取
  const persistCover = useCallback((dataUrl: string) => {
    const key = coverStorageKey(articleId)
    if (key) {
      try { localStorage.setItem(key, dataUrl) } catch { /* quota exceeded */ }
    }
    onCoverGenerated?.(dataUrl)
  }, [articleId, onCoverGenerated])

  // 将 File 对象读成 base64 data URL，保存到本地图片库后设为当前封面。
  const applyImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('只支持图片文件')
      return
    }
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      // 先保存浏览器内的图片，再异步上传图片库。用户立即切到发布页时，
      // 首次草稿也能读取封面，不必等上传接口返回后再推第二次。
      setGeneratedImage(dataUrl)
      persistCover(dataUrl)
      try {
        const ext = file.type.split('/')[1] || 'png'
        const uploaded = await uploadBase64Image({
          data: dataUrl,
          mimeType: file.type,
          originalName: `cover-paste-${Date.now()}.${ext}`,
          articleId,
        })
        const serverUrl = uploaded.url.startsWith('http')
          ? uploaded.url
          : `${window.location.origin}${uploaded.url}`
        setGeneratedImage(serverUrl)
        persistCover(serverUrl)
        toast.success('封面已保存到本地图片库，发布预览页将自动使用')
      } catch {
        toast.warn('本地图片保存失败，暂时使用浏览器预览（发布时可能无法显示）')
      }
    }
    reader.readAsDataURL(file)
  }, [persistCover, articleId])

  // 全局 paste 监听（聚焦到粘贴区时生效）
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData.items)
    const imgItem = items.find(i => i.type.startsWith('image/'))
    if (imgItem) {
      e.preventDefault()
      const file = imgItem.getAsFile()
      if (file) applyImageFile(file)
    }
  }, [applyImageFile])

  // 拖拽
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])
  const handleDragLeave = useCallback(() => setIsDragOver(false), [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) applyImageFile(file)
  }, [applyImageFile])

  // 点击粘贴区 → 聚焦，让用户直接 Ctrl+V
  const handlePasteZoneClick = useCallback(() => {
    pasteZoneRef.current?.focus()
  }, [])

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
              <Button variant="plain"
                key={p.id}
                className={`cg-provider-card ${provider === p.id ? 'active' : ''}`}
                onClick={() => setProvider(p.id)}
              >
                <span className="cg-provider-name">{p.name}</span>
                <span className="cg-provider-desc">{p.desc}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* Key 缺失提示 */}
        {missingKey && (
          <div className="cg-notice cg-notice--warn">
            <span>
              {currentProvider?.keyLabel} 未配置，无法调用此模型。
            </span>
            <Button variant="plain"
              className="cg-notice-link"
              onClick={() => navigate('/settings')}
            >
              前往配置 →
            </Button>
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

        {provider === 'openrouter' && (
          <div className="cg-notice cg-notice--info">
            GPT Image 2 会从当前浏览器直接请求 OpenRouter。Key 在「AI 配置 → 封面生成」中保存，不经过部署服务器。
          </div>
        )}
        {provider === 'gencli' && (
          <div className="cg-notice cg-notice--info">由本机 Gen CLI 调用模型，生成后可在这里预览、下载或手动保存到图片库。</div>
        )}

        {/* 图像提示词 */}
        <div className="cg-field">
          <span className="cg-label">图像提示词</span>
          <Textarea
            className="cg-prompt-input"
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            placeholder="描述需要生成的画面"
            rows={5}
          />
        </div>

        {/* 错误信息 */}
        {error && (
          <div className="cg-notice cg-notice--error">
            {error}
          </div>
        )}

        {/* 生成按钮 */}
        <Button variant="plain"
          className="cg-generate-btn"
          onClick={handleGenerate}
          disabled={isGenerating || !title.trim() || !customPrompt.trim() || !!missingKey}
        >
          {isGenerating
            ? <><span className="cg-spinner" /> 生成中…</>
            : provider === 'qwen-edit' && generatedImage
              ? '精修封面'
              : '生成封面'
          }
        </Button>

      </div>

      {/* ── 右列：预览 ── */}
      <div className="cg-preview">
        {generatedImage ? (
          <>
            <div className="cg-preview-frame">
              <img src={generatedImage} alt={`《${title.trim() || '未命名文章'}》封面预览`} className="cg-preview-img" />
            </div>
            <div className="cg-preview-actions">
              <Button variant="plain" className="cg-action-btn cg-action-btn--primary" onClick={handleDownload}>
                下载封面
              </Button>
              <Button variant="plain"
                className="cg-action-btn"
                onClick={handleSaveToLibrary}
                disabled={isSavingToLibrary}
              >
                {isSavingToLibrary ? '保存中...' : '保存到图片库'}
              </Button>
              <Button variant="plain"
                className="cg-action-btn"
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                重新生成
              </Button>
            </div>
            {/* 已有封面时也保留粘贴区，方便替换 */}
            <div
              ref={pasteZoneRef}
              className={`cg-paste-zone cg-paste-zone--compact ${isDragOver ? 'drag-over' : ''}`}
              tabIndex={0}
              onClick={handlePasteZoneClick}
              onPaste={handlePaste}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              粘贴或拖入图片替换封面（Ctrl+V）
            </div>
          </>
        ) : (
          <>
            {/* 空状态：粘贴区作为主入口 */}
            <div
              ref={pasteZoneRef}
              className={`cg-paste-zone ${isDragOver ? 'drag-over' : ''}`}
              tabIndex={0}
              onClick={handlePasteZoneClick}
              onPaste={handlePaste}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="cg-paste-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="4" rx="1"/>
                  <path d="M9 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2h-3"/>
                  <path d="M12 11v6M9 14l3-3 3 3"/>
                </svg>
              </div>
              <p className="cg-paste-title">粘贴剪贴板图片</p>
              <p className="cg-paste-hint">点击此处后按 Ctrl+V，或直接拖入图片文件</p>
            </div>
            <div className="cg-preview-empty">
              <div className="cg-empty-inner">
                <p className="cg-empty-title">或配置左侧选项后点击「生成封面」</p>
                <p className="cg-empty-hint">公众号 / 今日头条推荐比例 2.35:1 · 小红书长文可复用此封面</p>
              </div>
            </div>
          </>
        )}
      </div>

    </div>
  )
}

export default CoverGenerator
