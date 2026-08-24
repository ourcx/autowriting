import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  ArrowDown,
  ArrowUp,
  Braces,
  Copy,
  Download,
  Image,
  LayoutTemplate,
  FileText,
  PanelLeft,
  MoveVertical,
  PenTool,
  Send,
  Shapes,
  Sparkles,
  Square,
  Trash2,
  Type,
} from "lucide-react"
import PageHeader from "../../components/PageHeader/PageHeader"
import CanvasRenderer from "../../components/CanvasRenderer/CanvasRenderer"
import CanvasDesignInput from "../../components/CanvasDesignInput/CanvasDesignInput"
import WechatBlockEditor from "../../components/WechatBlockEditor/WechatBlockEditor"
import { toast } from "../../components/Toast/Toast"
import {
  fetchArticle,
  fetchArticleList,
  fetchUploadedArticleImages,
  generateCanvasDocument,
  generateWechatBlockDocument,
  pushWechatDraft,
  uploadWechatThumb,
} from "../../utils/apiHelpers"
import { getWechatHeaders, loadWechatCredentials } from "../../utils/accountBindings"
import { loadAIConfig } from "../../utils/aiConfig"
import {
  buildWechatBlockHtml,
  copyWechatBlockHtml,
} from "../../utils/wechatBlockExport"
import {
  createEmptyArticleData,
  loadLocalArticleData,
  normalizeArticleData,
} from "../../utils/articleData"
import type { ArticleData } from "../../utils/articleData"
import {
  CanvasDocument,
  CanvasNode,
  DEFAULT_CANVAS_DOCUMENT,
  parseCanvasDocument,
} from "../../../shared/canvasDsl"
import {
  createArticleCanvas,
  extractCanvasSources,
} from "../../../shared/canvasArticle"
import type { CanvasSource } from "../../../shared/canvasArticle"
import {
  createWechatBlockDocument,
  hydrateWechatBlockDocument,
  parseWechatBlockDocument,
} from "../../../shared/wechatBlockDsl"
import type { WechatBlockDocument } from "../../../shared/wechatBlockDsl"
import {
  DEFAULT_CANVAS_DESIGN_TEMPLATE_ID,
  type CanvasDesignTemplateId,
} from "../../../shared/canvasDesignTemplates"
import "./CanvasStudio.css"

const STORAGE_KEY = "visual-article-canvas-v2"
const BLOCK_STORAGE_KEY = "visual-article-blocks-v1"

type InspectorTab = "properties" | "dsl"
type StudioMode = "blocks" | "svg"

function cloneDefaultDocument(): CanvasDocument {
  return JSON.parse(JSON.stringify(DEFAULT_CANVAS_DOCUMENT)) as CanvasDocument
}

function loadDocument(articleId: string): CanvasDocument | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${articleId}`)
    return raw ? parseCanvasDocument(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function loadBlockDocument(
  articleId: string,
  sources: CanvasSource[],
  name: string,
): WechatBlockDocument | null {
  try {
    const raw = localStorage.getItem(`${BLOCK_STORAGE_KEY}:${articleId}`)
    return raw
      ? hydrateWechatBlockDocument(parseWechatBlockDocument(JSON.parse(raw)), sources, name)
      : null
  } catch {
    return null
  }
}

function nodeLabel(node: CanvasNode): string {
  if (node.type === "text") return node.text.split("\n")[0] || "文本"
  if (node.type === "image") return "图片"
  if (node.type === "shape") return node.shape === "ellipse" ? "椭圆" : "矩形"
  if (node.type === "path") return "AI SVG 路径"
  return `SVG · ${node.motif}`
}

function makeNode(type: CanvasNode["type"], index: number): CanvasNode {
  const base = {
    id: `${type}-${Date.now()}`,
    x: 80 + index * 12,
    y: 100 + index * 12,
    width: 300,
    height: 140,
    rotation: 0,
    opacity: 1,
  }
  if (type === "text") {
    return {
      ...base,
      type,
      text: "输入文字",
      variant: "card",
      fill: "#0a0a0a",
      background: "#ffffff",
      borderColor: "#333333",
      borderWidth: 2,
      radius: 8,
      padding: 20,
      fontSize: 34,
      fontWeight: 600,
      lineHeight: 1.3,
      align: "left",
    }
  }
  if (type === "image") {
    return { ...base, type, src: "", fit: "cover", radius: 8, height: 240 }
  }
  if (type === "shape") {
    return { ...base, type, shape: "rect", fill: "#b8a4ed", stroke: "transparent", strokeWidth: 0, radius: 8 }
  }
  if (type === "path") {
    return {
      ...base,
      type,
      d: "M 10 70 C 70 10 220 10 290 70",
      fill: "transparent",
      stroke: "#e0745d",
      strokeWidth: 6,
    }
  }
  return { ...base, type, motif: "wave", fill: "#e8b94a", stroke: "#e8b94a", strokeWidth: 8, height: 80 }
}

export default function CanvasStudio() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const articleId = searchParams.get("articleId") || ""
  const mode: StudioMode = searchParams.get("mode") === "svg" ? "svg" : "blocks"
  const svgRef = useRef<SVGSVGElement>(null)
  const blockContentRef = useRef<HTMLElement>(null)
  const [document, setDocument] = useState<CanvasDocument>(cloneDefaultDocument)
  const [blockDocument, setBlockDocument] = useState<WechatBlockDocument>(() => (
    createWechatBlockDocument("公众号块排版", [])
  ))
  const [selectedId, setSelectedId] = useState<string | null>(document.nodes[document.nodes.length - 1]?.id ?? null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties")
  const [dslDraft, setDslDraft] = useState(() => JSON.stringify(document, null, 2))
  const [aiPrompt, setAiPrompt] = useState("")
  const [designTemplateId, setDesignTemplateId] = useState<CanvasDesignTemplateId>(
    DEFAULT_CANVAS_DESIGN_TEMPLATE_ID,
  )
  const [designReference, setDesignReference] = useState("")
  const [designFileName, setDesignFileName] = useState("")
  const [generating, setGenerating] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [generationMessage, setGenerationMessage] = useState("")
  const [articles, setArticles] = useState<Array<{ id: string; title: string; status: string }>>([])
  const [articleData, setArticleData] = useState<ArticleData>(createEmptyArticleData)
  const [sources, setSources] = useState<CanvasSource[]>([])
  const [articleLoading, setArticleLoading] = useState(false)
  const [loadedArticleId, setLoadedArticleId] = useState("")

  const selectedNode = useMemo(
    () => document.nodes.find(node => node.id === selectedId) ?? null,
    [document.nodes, selectedId],
  )

  useEffect(() => {
    let cancelled = false
    fetchArticleList()
      .then(items => {
        if (cancelled) return
        setArticles(items)
        if (!articleId && items.length > 0) {
          setSearchParams(current => {
            const next = new URLSearchParams(current)
            next.set("articleId", items[0].id)
            return next
          }, { replace: true })
        }
      })
      .catch(() => {
        if (!cancelled) toast.error("文章列表加载失败")
      })
    return () => {
      cancelled = true
    }
  }, [articleId, setSearchParams])

  useEffect(() => {
    if (!articleId) {
      setArticleData(createEmptyArticleData())
      setSources([])
      setLoadedArticleId("")
      return
    }
    let cancelled = false
    setArticleLoading(true)
    setSources([])
    setLoadedArticleId("")
    const loadArticle = async () => {
      try {
        const data = articleId.startsWith("local:")
          ? loadLocalArticleData(articleId)
          : normalizeArticleData(await fetchArticle(articleId))
        const uploaded = articleId.startsWith("local:")
          ? []
          : await fetchUploadedArticleImages(articleId).catch(() => [])
        const cover = localStorage.getItem(`cover_image_${articleId}`)
        const extraImages = [
          ...(cover ? [{ src: cover, alt: "文章封面" }] : []),
          ...uploaded,
        ]
        const nextSources = extractCanvasSources({
          title: data.title || data.article.split("\n")[0]?.replace(/^#+\s*/, "") || "未命名文章",
          article: data.article,
          materials: data.materials,
          extraImages,
        })
        if (cancelled) return
        setArticleData(data)
        setSources(nextSources)
        setLoadedArticleId(articleId)
        const nextDocument = loadDocument(articleId)
          || createArticleCanvas(data.title || "公众号长图", nextSources)
        const nextBlockDocument = loadBlockDocument(
          articleId,
          nextSources,
          data.title || "公众号块排版",
        ) || createWechatBlockDocument(data.title || "公众号块排版", nextSources)
        setDocument(nextDocument)
        setBlockDocument(nextBlockDocument)
        setSelectedId(nextDocument.nodes[nextDocument.nodes.length - 1]?.id ?? null)
        setSelectedBlockId(nextBlockDocument.blocks[0]?.id ?? null)
      } catch {
        if (!cancelled) toast.error("公众号文章加载失败")
      } finally {
        if (!cancelled) setArticleLoading(false)
      }
    }
    void loadArticle()
    return () => {
      cancelled = true
    }
  }, [articleId])

  useEffect(() => {
    if (articleId && loadedArticleId === articleId && sources.length > 0) {
      localStorage.setItem(`${STORAGE_KEY}:${articleId}`, JSON.stringify(document))
    }
    setDslDraft(JSON.stringify(document, null, 2))
  }, [articleId, document, loadedArticleId, sources.length])

  useEffect(() => {
    if (articleId && loadedArticleId === articleId && sources.length > 0) {
      localStorage.setItem(`${BLOCK_STORAGE_KEY}:${articleId}`, JSON.stringify(blockDocument))
    }
  }, [articleId, blockDocument, loadedArticleId, sources.length])

  const updateNode = (id: string, patch: Partial<CanvasNode>) => {
    setDocument(current => ({
      ...current,
      nodes: current.nodes.map(node => node.id === id ? { ...node, ...patch } as CanvasNode : node),
    }))
  }

  const addNode = (type: CanvasNode["type"]) => {
    const node = makeNode(type, document.nodes.length)
    setDocument(current => ({ ...current, nodes: [...current.nodes, node] }))
    setSelectedId(node.id)
  }

  const deleteSelected = () => {
    if (!selectedId) return
    setDocument(current => ({ ...current, nodes: current.nodes.filter(node => node.id !== selectedId) }))
    setSelectedId(null)
  }

  const moveLayer = (direction: -1 | 1) => {
    if (!selectedId) return
    setDocument(current => {
      const index = current.nodes.findIndex(node => node.id === selectedId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.nodes.length) return current
      const nodes = [...current.nodes]
      ;[nodes[index], nodes[target]] = [nodes[target], nodes[index]]
      return { ...current, nodes }
    })
  }

  const setCanvasHeight = (height: number) => {
    const nextHeight = Math.min(32000, Math.max(320, Math.round(height || 320)))
    setDocument(current => ({ ...current, height: nextHeight }))
  }

  const fitCanvasHeight = () => {
    const contentBottom = document.nodes.reduce(
      (bottom, node) => Math.max(bottom, node.y + node.height),
      0,
    )
    setCanvasHeight(contentBottom + 60)
  }

  const applyDsl = () => {
    try {
      const nextDocument = parseCanvasDocument(JSON.parse(dslDraft))
      setDocument(nextDocument)
      setSelectedId(nextDocument.nodes[nextDocument.nodes.length - 1]?.id ?? null)
      toast.success("画布 DSL 已应用")
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "画布 DSL 格式错误")
    }
  }

  const handleGenerate = async () => {
    if (sources.length === 0 || !articleData.article.trim()) {
      toast.warn("请先选择一篇已生成正文的公众号文章")
      return
    }
    setGenerating(true)
    setGenerationMessage("正在连接 AI...")
    try {
      if (mode === "blocks") {
        const nextDocument = await generateWechatBlockDocument(
          aiPrompt.trim(),
          sources,
          loadAIConfig(),
          setGenerationMessage,
          {
            templateId: designTemplateId,
            designReference,
          },
        )
        setBlockDocument(nextDocument)
        setSelectedBlockId(nextDocument.blocks[0]?.id ?? null)
        toast.success("AI 块排版已生成")
        return
      }
      const nextDocument = await generateCanvasDocument(
        aiPrompt.trim(),
        sources,
        loadAIConfig(),
        setGenerationMessage,
        {
          templateId: designTemplateId,
          designReference,
        },
      )
      setDocument(nextDocument)
      setSelectedId(nextDocument.nodes[nextDocument.nodes.length - 1]?.id ?? null)
      toast.success("AI 画布已生成")
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "AI 画布生成失败")
    } finally {
      setGenerating(false)
      setGenerationMessage("")
    }
  }

  const serializeSvg = (): string | null => {
    const svg = svgRef.current
    if (!svg) return null
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
    clone.setAttribute("width", String(document.width))
    clone.setAttribute("height", String(document.height))
    clone.querySelectorAll(".canvas-renderer__selection").forEach(node => node.remove())
    clone.querySelectorAll(".canvas-renderer__node").forEach(node => node.removeAttribute("class"))
    return new XMLSerializer().serializeToString(clone)
  }

  const downloadSvg = () => {
    const svg = serializeSvg()
    if (!svg) return
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }))
    const anchor = window.document.createElement("a")
    anchor.href = url
    anchor.download = `${document.name || "canvas"}.svg`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const renderPngSegments = async (segmentHeight = 6000): Promise<Blob[]> => {
    const svg = serializeSvg()
    if (!svg) throw new Error("画板尚未渲染")
    const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }))
    try {
      const image = new window.Image()
      image.crossOrigin = "anonymous"
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error("画布中的图片无法加载"))
        image.src = svgUrl
      })

      const segmentCount = Math.ceil(document.height / segmentHeight)
      const blobs: Blob[] = []
      for (let index = 0; index < segmentCount; index += 1) {
        const sourceY = index * segmentHeight
        const height = Math.min(segmentHeight, document.height - sourceY)
        const canvas = window.document.createElement("canvas")
        canvas.width = document.width
        canvas.height = height
        const context = canvas.getContext("2d")
        if (!context) throw new Error("浏览器无法创建 PNG 画布")
        context.drawImage(image, 0, sourceY, document.width, height, 0, 0, document.width, height)
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(value => value ? resolve(value) : reject(new Error("PNG 编码失败")), "image/png")
        })
        blobs.push(blob)
      }
      return blobs
    } finally {
      URL.revokeObjectURL(svgUrl)
    }
  }

  const downloadPng = async () => {
    try {
      const blobs = await renderPngSegments()
      for (let index = 0; index < blobs.length; index += 1) {
        const url = URL.createObjectURL(blobs[index])
        const anchor = window.document.createElement("a")
        anchor.href = url
        anchor.download = `${document.name || "article"}${blobs.length > 1 ? `-${index + 1}` : ""}.png`
        anchor.click()
        URL.revokeObjectURL(url)
      }
      toast.success(blobs.length > 1 ? `已导出 ${blobs.length} 张公众号长图` : "公众号长图已导出")
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "PNG 导出失败")
    }
  }

  const copyDsl = async () => {
    await navigator.clipboard.writeText(JSON.stringify(document, null, 2))
    toast.success("已复制画布 DSL")
  }

  const copyBlockContent = async () => {
    const source = blockContentRef.current
    if (!source) return
    try {
      await copyWechatBlockHtml(source)
      toast.success("已复制公众号富文本，可直接粘贴到编辑器")
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "复制公众号内容失败")
    }
  }

  const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("图片编码失败"))
    reader.onerror = () => reject(new Error("图片读取失败"))
    reader.readAsDataURL(blob)
  })

  const submitWechatHtml = async (
    html: string,
    coverUrl: string,
    successMessage: string,
  ) => {
    const articleTitle = articleData.title.trim()
      || sources.find(item => item.kind === "title")?.text?.trim()
      || ""
    if (!html || !articleTitle) {
      toast.warn("当前文章没有可推送的标题或内容")
      return false
    }
    if (!loadWechatCredentials()) {
      toast.warn("请先绑定公众号", {
        action: { label: "去绑定", onClick: () => navigate("/account") },
      })
      return false
    }
    const headers = getWechatHeaders()
    let thumbMediaId: string | undefined
    if (coverUrl) {
      try {
        thumbMediaId = await uploadWechatThumb(coverUrl, headers)
      } catch {
        toast.warn("封面上传失败，将使用公众号默认封面继续推送")
      }
    }
    const result = await pushWechatDraft({
      title: articleTitle,
      content: html,
      digest: articleData.article.replace(/\s+/g, " ").slice(0, 120),
      thumbMediaId,
    }, headers)
    if (result.failed_images?.length) {
      toast.warn(`草稿已推送，但有 ${result.failed_images.length} 张图片未能转存`, { duration: 5000 })
    } else {
      toast.success(successMessage, {
        duration: 0,
        action: {
          label: "去发布",
          onClick: () => window.open("https://mp.weixin.qq.com", "_blank"),
        },
      })
    }
    return true
  }

  const pushBlockToWechat = async () => {
    const source = blockContentRef.current
    if (!source) return
    setPushing(true)
    try {
      const coverUrl = sources.find(item => item.kind === "image")?.src
        || localStorage.getItem(`cover_image_${articleId}`)
        || ""
      await submitWechatHtml(
        buildWechatBlockHtml(source),
        coverUrl,
        "块排版已推送到微信公众号草稿箱",
      )
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "公众号草稿推送失败")
    } finally {
      setPushing(false)
    }
  }

  const pushCanvasToWechat = async () => {
    if (!loadWechatCredentials()) {
      toast.warn("请先绑定公众号", {
        action: { label: "去绑定", onClick: () => navigate("/account") },
      })
      return
    }
    setPushing(true)
    try {
      const blobs = await renderPngSegments(2400)
      const totalBytes = blobs.reduce((total, blob) => total + blob.size, 0)
      if (totalBytes > 32 * 1024 * 1024) {
        throw new Error("画板 PNG 超过 32MB，请缩短画布或分段后再推送")
      }
      const dataUrls = await Promise.all(blobs.map(blobToDataUrl))
      const html = `<section style="margin:0;padding:0;width:100%;background:#ffffff;">${dataUrls.map(url => (
        `<p style="margin:0;padding:0;line-height:0;"><img src="${url}" style="display:block;width:100%;max-width:100%;height:auto;margin:0;" /></p>`
      )).join("")}</section>`
      await submitWechatHtml(
        html,
        dataUrls[0] || "",
        `自由画板已作为 ${dataUrls.length} 张图片推送到微信公众号草稿箱`,
      )
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "自由画板推送失败")
    } finally {
      setPushing(false)
    }
  }

  const setMode = (nextMode: StudioMode) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current)
      if (nextMode === "svg") next.set("mode", "svg")
      else next.delete("mode")
      return next
    }, { replace: true })
  }

  return (
    <div className="cs-root">
      <PageHeader
        title="公众号视觉排版"
        icon={mode === "blocks" ? <PanelLeft size={16} /> : <Shapes size={16} />}
        subtitle={articleId
          ? `${articleData.title || "当前文章"} · ${sources.filter(source => source.kind !== "image").length} 个内容块 · ${sources.filter(source => source.kind === "image").length} 张图片`
          : "选择公众号文章后由 AI 负责排版"}
        onBack={() => navigate("/")}
        actions={(
          <>
            <button className="cs-header-btn" onClick={() => navigate("/styles")}>
              <LayoutTemplate size={14} />
              Markdown 样式
            </button>
            {mode === "blocks" ? (
              <>
                <button className="cs-header-btn" onClick={() => void copyBlockContent()}>
                  <Copy size={14} />
                  复制公众号内容
                </button>
                <button
                  className="cs-header-btn cs-header-btn--primary"
                  disabled={pushing}
                  onClick={() => void pushBlockToWechat()}
                >
                  <Send size={14} />
                  {pushing ? "推送中..." : "推送公众号"}
                </button>
              </>
            ) : (
              <>
                <button className="cs-header-btn" onClick={copyDsl}>
                  <Copy size={14} />
                  复制 DSL
                </button>
                <button className="cs-header-btn" onClick={downloadSvg}>
                  <Download size={14} />
                  SVG 源文件
                </button>
                <button className="cs-header-btn cs-header-btn--primary" onClick={downloadPng}>
                  <Image size={14} />
                  下载公众号长图
                </button>
                <button
                  className="cs-header-btn cs-header-btn--primary"
                  disabled={pushing}
                  onClick={() => void pushCanvasToWechat()}
                >
                  <Send size={14} />
                  {pushing ? "推送中..." : "推送公众号"}
                </button>
              </>
            )}
          </>
        )}
      />

      <div className="cs-toolbar">
        <div className="cs-mode-switch" role="group" aria-label="排版模式">
          <button className={mode === "blocks" ? "active" : ""} onClick={() => setMode("blocks")}>
            <PanelLeft size={15} />
            HTML 块排版
          </button>
          <button className={mode === "svg" ? "active" : ""} onClick={() => setMode("svg")}>
            <Shapes size={15} />
            自由画板
          </button>
        </div>
        <label className="cs-article-select">
          <FileText size={15} />
          <select
            value={articleId}
            onChange={event => {
              const nextArticleId = event.target.value
              setSearchParams(current => {
                const next = new URLSearchParams(current)
                if (nextArticleId) next.set("articleId", nextArticleId)
                else next.delete("articleId")
                return next
              }, { replace: true })
            }}
            aria-label="选择公众号文章"
          >
            <option value="">选择公众号文章</option>
            {articleId && !articles.some(article => article.id === articleId) ? (
              <option value={articleId}>{articleData.title || articleId}</option>
            ) : null}
            {articles.map(article => (
              <option key={article.id} value={article.id}>
                {article.title || article.id}
              </option>
            ))}
          </select>
        </label>
        <textarea
          value={aiPrompt}
          onChange={event => setAiPrompt(event.target.value)}
          placeholder={mode === "blocks"
            ? "补充偏好（不可信输入）：模板会负责结构、视觉 Token 和防重叠约束"
            : "补充画板偏好（不可信输入）：模板会负责结构、视觉 Token 和防重叠约束"}
          rows={2}
        />
        <button
          className="cs-generate"
          disabled={generating || articleLoading || sources.length === 0}
          onClick={handleGenerate}
        >
          <Sparkles size={15} />
          {generating
            ? generationMessage || "生成中..."
            : mode === "blocks"
              ? "AI 生成块排版"
              : "AI 生成画板"}
        </button>
      </div>

      <CanvasDesignInput
        templateId={designTemplateId}
        fileName={designFileName}
        onTemplateChange={setDesignTemplateId}
        onDesignReferenceChange={(content, fileName) => {
          setDesignReference(content)
          setDesignFileName(fileName)
          if (content) setDesignTemplateId("design-reference")
        }}
        onError={message => toast.error(message)}
      />

      {mode === "blocks" ? (
        <WechatBlockEditor
          document={blockDocument}
          sources={sources}
          selectedId={selectedBlockId}
          contentRef={blockContentRef}
          onSelect={setSelectedBlockId}
          onChange={setBlockDocument}
        />
      ) : (
        <main className="cs-workspace">
        <aside className="cs-layers">
          <div className="cs-panel-title">添加元素</div>
          <div className="cs-add-grid">
            <button onClick={() => addNode("text")}><Type size={16} />文本</button>
            <button onClick={() => addNode("image")}><Image size={16} />图片</button>
            <button onClick={() => addNode("shape")}><Square size={16} />形状</button>
            <button onClick={() => addNode("path")}><PenTool size={16} />SVG 路径</button>
          </div>

          <div className="cs-panel-row">
            <div className="cs-panel-title">图层</div>
            <span>{document.nodes.length}</span>
          </div>
          <div className="cs-layer-list">
            {[...document.nodes].reverse().map(node => (
              <button
                key={node.id}
                className={selectedId === node.id ? "active" : ""}
                onClick={() => setSelectedId(node.id)}
              >
                <span className={`cs-layer-type cs-layer-type--${node.type}`}>{node.type.slice(0, 1).toUpperCase()}</span>
                <span>{nodeLabel(node)}</span>
              </button>
            ))}
          </div>
          <div className="cs-layer-actions">
            <button title="上移一层" onClick={() => moveLayer(1)}><ArrowUp size={15} /></button>
            <button title="下移一层" onClick={() => moveLayer(-1)}><ArrowDown size={15} /></button>
            <button title="删除节点" onClick={deleteSelected}><Trash2 size={15} /></button>
          </div>
        </aside>

        <section className="cs-stage">
          <div className="cs-stage-meta">
            <strong>{document.name}</strong>
            <div className="cs-height-control">
              <span>{document.width} ×</span>
              <input
                type="number"
                min="320"
                max="32000"
                step="100"
                value={document.height}
                onChange={event => setCanvasHeight(Number(event.target.value))}
                aria-label="画布高度"
              />
              <span>px</span>
              <button title="适应内容高度" onClick={fitCanvasHeight}>
                <MoveVertical size={14} />
              </button>
            </div>
          </div>
          <div className="cs-canvas-shell">
            <CanvasRenderer
              document={document}
              selectedId={selectedId}
              interactive
              svgRef={svgRef}
              onSelect={setSelectedId}
              onMove={(id, x, y) => updateNode(id, { x, y })}
            />
          </div>
        </section>

        <aside className="cs-inspector">
          <div className="cs-inspector-tabs">
            <button className={inspectorTab === "properties" ? "active" : ""} onClick={() => setInspectorTab("properties")}>
              属性
            </button>
            <button className={inspectorTab === "dsl" ? "active" : ""} onClick={() => setInspectorTab("dsl")}>
              <Braces size={14} />
              DSL
            </button>
          </div>

          {inspectorTab === "properties" ? (
            <div className="cs-properties">
              <label>
                <span>画布名称</span>
                <input value={document.name} onChange={event => setDocument(current => ({ ...current, name: event.target.value }))} />
              </label>
              <label>
                <span>背景</span>
                <input type="color" value={document.background} onChange={event => setDocument(current => ({ ...current, background: event.target.value }))} />
              </label>
              <div className="cs-property-grid">
                <label>
                  <span>画板宽度</span>
                  <input value={`${document.width} px`} disabled />
                </label>
                <label>
                  <span>画布高度</span>
                  <input
                    type="number"
                    min="320"
                    max="32000"
                    step="100"
                    value={document.height}
                    onChange={event => setCanvasHeight(Number(event.target.value))}
                  />
                </label>
              </div>
              <button className="cs-fit-height" onClick={fitCanvasHeight}>
                <MoveVertical size={14} />
                适应内容高度
              </button>
              {selectedNode ? (
                <>
                  <div className="cs-property-heading">{nodeLabel(selectedNode)}</div>
                  <div className="cs-property-grid">
                    {(["x", "y", "width", "height"] as const).map(key => (
                      <label key={key}>
                        <span>{key.toUpperCase()}</span>
                        <input type="number" value={selectedNode[key]} onChange={event => updateNode(selectedNode.id, { [key]: Number(event.target.value) })} />
                      </label>
                    ))}
                  </div>
                  <label>
                    <span>旋转</span>
                    <input type="range" min="-180" max="180" value={selectedNode.rotation} onChange={event => updateNode(selectedNode.id, { rotation: Number(event.target.value) })} />
                  </label>
                  {selectedNode.type === "text" ? (
                    <>
                      <label>
                        <span>内容版式</span>
                        <select
                          value={selectedNode.variant}
                          onChange={event => updateNode(selectedNode.id, {
                            variant: event.target.value as typeof selectedNode.variant,
                          })}
                        >
                          <option value="plain">正文</option>
                          <option value="banner">章节条</option>
                          <option value="card">内容卡片</option>
                          <option value="quote">引用面板</option>
                          <option value="sticky">便签</option>
                        </select>
                      </label>
                      <label>
                        <span>文字</span>
                        <textarea value={selectedNode.text} rows={5} onChange={event => updateNode(selectedNode.id, { text: event.target.value })} />
                      </label>
                      <div className="cs-property-grid">
                        <label><span>字号</span><input type="number" value={selectedNode.fontSize} onChange={event => updateNode(selectedNode.id, { fontSize: Number(event.target.value) })} /></label>
                        <label><span>颜色</span><input type="color" value={selectedNode.fill} onChange={event => updateNode(selectedNode.id, { fill: event.target.value })} /></label>
                        <label><span>背景</span><input type="color" value={selectedNode.background === "transparent" ? "#ffffff" : selectedNode.background} onChange={event => updateNode(selectedNode.id, { background: event.target.value })} /></label>
                        <label><span>描边</span><input type="color" value={selectedNode.borderColor === "transparent" ? "#333333" : selectedNode.borderColor} onChange={event => updateNode(selectedNode.id, { borderColor: event.target.value, borderWidth: Math.max(1, selectedNode.borderWidth) })} /></label>
                      </div>
                    </>
                  ) : null}
                  {selectedNode.type === "image" ? (
                    <label>
                      <span>图片 URL</span>
                      <textarea value={selectedNode.src} rows={5} onChange={event => updateNode(selectedNode.id, { src: event.target.value })} />
                    </label>
                  ) : null}
                  {selectedNode.type === "path" ? (
                    <label>
                      <span>SVG Path</span>
                      <textarea value={selectedNode.d} rows={6} onChange={event => updateNode(selectedNode.id, { d: event.target.value })} />
                    </label>
                  ) : null}
                  {selectedNode.type === "shape" || selectedNode.type === "motif" || selectedNode.type === "path" ? (
                    <div className="cs-property-grid">
                      <label><span>填充</span><input type="color" value={selectedNode.fill === "transparent" ? "#ffffff" : selectedNode.fill} onChange={event => updateNode(selectedNode.id, { fill: event.target.value })} /></label>
                      <label><span>描边</span><input type="color" value={selectedNode.stroke === "transparent" ? "#000000" : selectedNode.stroke} onChange={event => updateNode(selectedNode.id, { stroke: event.target.value })} /></label>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="cs-empty-selection">选择画布元素后编辑属性</div>
              )}
            </div>
          ) : (
            <div className="cs-dsl-editor">
              <textarea value={dslDraft} onChange={event => setDslDraft(event.target.value)} spellCheck={false} />
              <button onClick={applyDsl}>应用 DSL</button>
            </div>
          )}
        </aside>
        </main>
      )}
    </div>
  )
}
