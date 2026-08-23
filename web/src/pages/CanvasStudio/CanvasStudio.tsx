import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ArrowDown,
  ArrowUp,
  Braces,
  Copy,
  Download,
  Image,
  LayoutTemplate,
  Shapes,
  Sparkles,
  Square,
  Trash2,
  Type,
} from "lucide-react"
import PageHeader from "../../components/PageHeader/PageHeader"
import CanvasRenderer from "../../components/CanvasRenderer/CanvasRenderer"
import { toast } from "../../components/Toast/Toast"
import { generateCanvasDocument } from "../../utils/apiHelpers"
import { loadAIConfig } from "../../utils/aiConfig"
import {
  CanvasDocument,
  CanvasNode,
  DEFAULT_CANVAS_DOCUMENT,
  parseCanvasDocument,
} from "../../../shared/canvasDsl"
import "./CanvasStudio.css"

const STORAGE_KEY = "visual-canvas-document-v1"
const SAMPLE_IMAGE = "https://copilot-cn.bytedance.net/api/ide/v1/text_to_image?prompt=editorial%20still%20life%20with%20printed%20magazine%20pages%2C%20camera%2C%20notebook%20and%20flowers%20on%20a%20bright%20studio%20table%2C%20realistic%20photography%2C%20warm%20natural%20light%2C%20high%20detail&image_size=landscape_4_3"

type InspectorTab = "properties" | "dsl"

function cloneDefaultDocument(): CanvasDocument {
  return JSON.parse(JSON.stringify(DEFAULT_CANVAS_DOCUMENT)) as CanvasDocument
}

function loadDocument(): CanvasDocument {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? parseCanvasDocument(JSON.parse(raw)) : cloneDefaultDocument()
  } catch {
    return cloneDefaultDocument()
  }
}

function nodeLabel(node: CanvasNode): string {
  if (node.type === "text") return node.text.split("\n")[0] || "文本"
  if (node.type === "image") return "图片"
  if (node.type === "shape") return node.shape === "ellipse" ? "椭圆" : "矩形"
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
    return { ...base, type, text: "输入文字", fill: "#0a0a0a", fontSize: 34, fontWeight: 600, lineHeight: 1.3, align: "left" }
  }
  if (type === "image") {
    return { ...base, type, src: SAMPLE_IMAGE, fit: "cover", radius: 8, height: 240 }
  }
  if (type === "shape") {
    return { ...base, type, shape: "rect", fill: "#b8a4ed", stroke: "transparent", strokeWidth: 0, radius: 8 }
  }
  return { ...base, type, motif: "wave", fill: "#e8b94a", stroke: "#e8b94a", strokeWidth: 8, height: 80 }
}

export default function CanvasStudio() {
  const navigate = useNavigate()
  const svgRef = useRef<SVGSVGElement>(null)
  const [document, setDocument] = useState<CanvasDocument>(loadDocument)
  const [selectedId, setSelectedId] = useState<string | null>(document.nodes[document.nodes.length - 1]?.id ?? null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("properties")
  const [dslDraft, setDslDraft] = useState(() => JSON.stringify(document, null, 2))
  const [aiPrompt, setAiPrompt] = useState("")
  const [generating, setGenerating] = useState(false)
  const [generationMessage, setGenerationMessage] = useState("")

  const selectedNode = useMemo(
    () => document.nodes.find(node => node.id === selectedId) ?? null,
    [document.nodes, selectedId],
  )

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(document))
    setDslDraft(JSON.stringify(document, null, 2))
  }, [document])

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
    if (!aiPrompt.trim()) {
      toast.warn("请先描述要生成的画布")
      return
    }
    setGenerating(true)
    setGenerationMessage("正在连接 AI...")
    try {
      const nextDocument = await generateCanvasDocument(
        aiPrompt.trim(),
        document,
        loadAIConfig(),
        setGenerationMessage,
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

  const copyDsl = async () => {
    await navigator.clipboard.writeText(JSON.stringify(document, null, 2))
    toast.success("已复制画布 DSL")
  }

  return (
    <div className="cs-root">
      <PageHeader
        title="视觉画布"
        icon={<Shapes size={16} />}
        subtitle="AI 生成受约束的 SVG 多图文布局"
        onBack={() => navigate("/")}
        actions={(
          <>
            <button className="cs-header-btn" onClick={() => navigate("/styles")}>
              <LayoutTemplate size={14} />
              Markdown 样式
            </button>
            <button className="cs-header-btn" onClick={copyDsl}>
              <Copy size={14} />
              复制 DSL
            </button>
            <button className="cs-header-btn cs-header-btn--primary" onClick={downloadSvg}>
              <Download size={14} />
              下载 SVG
            </button>
          </>
        )}
      />

      <div className="cs-toolbar">
        <textarea
          value={aiPrompt}
          onChange={event => setAiPrompt(event.target.value)}
          placeholder="例如：做一张人物访谈长图，使用三张图片、杂志式留白、暖红标题和黑色引语块"
          rows={2}
        />
        <button className="cs-generate" disabled={generating} onClick={handleGenerate}>
          <Sparkles size={15} />
          {generating ? generationMessage || "生成中..." : "AI 生成画布"}
        </button>
      </div>

      <main className="cs-workspace">
        <aside className="cs-layers">
          <div className="cs-panel-title">添加元素</div>
          <div className="cs-add-grid">
            <button onClick={() => addNode("text")}><Type size={16} />文本</button>
            <button onClick={() => addNode("image")}><Image size={16} />图片</button>
            <button onClick={() => addNode("shape")}><Square size={16} />形状</button>
            <button onClick={() => addNode("motif")}><Sparkles size={16} />SVG</button>
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
            <span>{document.width} × {document.height}</span>
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
                        <span>文字</span>
                        <textarea value={selectedNode.text} rows={5} onChange={event => updateNode(selectedNode.id, { text: event.target.value })} />
                      </label>
                      <div className="cs-property-grid">
                        <label><span>字号</span><input type="number" value={selectedNode.fontSize} onChange={event => updateNode(selectedNode.id, { fontSize: Number(event.target.value) })} /></label>
                        <label><span>颜色</span><input type="color" value={selectedNode.fill} onChange={event => updateNode(selectedNode.id, { fill: event.target.value })} /></label>
                      </div>
                    </>
                  ) : null}
                  {selectedNode.type === "image" ? (
                    <label>
                      <span>图片 URL</span>
                      <textarea value={selectedNode.src} rows={5} onChange={event => updateNode(selectedNode.id, { src: event.target.value })} />
                    </label>
                  ) : null}
                  {selectedNode.type === "shape" || selectedNode.type === "motif" ? (
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
    </div>
  )
}
