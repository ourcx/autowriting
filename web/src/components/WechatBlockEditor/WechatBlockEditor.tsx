import type { CSSProperties, RefObject } from "react"
import {
  ArrowDown,
  ArrowUp,
  Columns,
  Image as ImageIcon,
  Palette,
  Quote,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react"
import type { CanvasSource } from "../../../shared/canvasArticle"
import { createWechatContentBlock } from "../../../shared/wechatBlockDsl"
import type {
  WechatBlock,
  WechatBlockDocument,
  WechatContentBlock,
  WechatDecorationBlock,
  WechatSectionBlock,
  WechatTextStyleOverride,
} from "../../../shared/wechatBlockDsl"
import "./WechatBlockEditor.css"

interface WechatBlockEditorProps {
  document: WechatBlockDocument
  sources: CanvasSource[]
  selectedId: string | null
  contentRef: RefObject<HTMLElement>
  onSelect: (id: string | null) => void
  onChange: (document: WechatBlockDocument) => void
}

const FONT_STACKS: Record<WechatBlockDocument["font"], string> = {
  system: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  serif: "'Songti SC', SimSun, serif",
  rounded: "'PingFang SC', 'Microsoft YaHei', sans-serif",
  friendly: "Fredoka, Poppins, -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
}

function blockLabel(block: WechatBlock, source?: CanvasSource): string {
  if (block.type === "decoration") return "AI SVG 装饰"
  if (block.type === "section") return `${block.layout} · ${block.sourceIds.length} 项`
  if (source?.kind === "image") return source.alt || "文章图片"
  return source?.text?.split("\n")[0] || "内容块"
}

function sectionContentBlock(
  source: CanvasSource,
  section: WechatSectionBlock,
): WechatContentBlock {
  const fallback = createWechatContentBlock(source)
  const sectionDefault: WechatContentBlock = {
    ...fallback,
    background: "transparent",
    color: section.color,
    accentColor: section.accentColor,
    borderColor: "transparent",
    borderWidth: 0,
    radius: 0,
    padding: source.kind === "heading" ? 8 : 0,
    marginTop: 0,
    marginBottom: source.kind === "title" || source.kind === "heading" ? 14 : 12,
    fontSize: source.kind === "title"
      ? Math.min(30, fallback.fontSize)
      : source.kind === "heading"
        ? Math.min(22, fallback.fontSize)
        : fallback.fontSize,
  }
  return {
    ...sectionDefault,
    ...(section.itemStyles[source.id] || {}),
  }
}

function SectionContent({
  block,
  sources,
  selectedId,
  onSelect,
}: {
  block: WechatSectionBlock
  sources: CanvasSource[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const renderSource = (source: CanvasSource) => {
    const selectionId = `${block.id}::${source.id}`
    return (
      <div
        key={source.id}
        className={`wbe-section-item${selectedId === selectionId ? " is-selected" : ""}`}
        data-section-source-id={source.id}
        onClick={event => {
          event.stopPropagation()
          onSelect(selectionId)
        }}
      >
        <SourceContent
          block={sectionContentBlock(source, block)}
          source={source}
        />
      </div>
    )
  }
  const wrapperStyle: CSSProperties = {
    margin: `${block.marginTop}px 0 ${block.marginBottom}px`,
    padding: block.padding,
    border: `${block.borderWidth}px solid ${block.borderColor}`,
    borderRadius: block.radius,
    background: block.background,
    color: block.color,
  }
  if (block.layout === "stack") {
    return <section style={wrapperStyle}>{sources.map(renderSource)}</section>
  }

  const featureSource = block.layout === "feature" ? sources[0] : null
  const columnSources = featureSource ? sources.slice(1) : sources
  const splitAt = Math.ceil(columnSources.length / 2)
  const columns = [
    columnSources.slice(0, splitAt),
    columnSources.slice(splitAt),
  ]
  return (
    <section style={wrapperStyle}>
      {featureSource ? renderSource(featureSource) : null}
      <table
        role="presentation"
        style={{
          width: "100%",
          tableLayout: "fixed",
          borderCollapse: "separate",
          borderSpacing: 0,
        }}
      >
        <tbody>
          <tr>
            {columns.map((column, index) => (
              <td
                key={`${block.id}-column-${index}`}
                style={{
                  width: "50%",
                  padding: index === 0 ? `0 ${block.gap}px 0 0` : `0 0 0 ${block.gap}px`,
                  borderLeft: index === 1 && block.divider
                    ? `1px dashed ${block.borderColor}`
                    : "0",
                  verticalAlign: "top",
                }}
              >
                {column.map(renderSource)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  )
}

function contentStyle(block: WechatContentBlock): CSSProperties {
  const style: CSSProperties = {
    margin: `${block.marginTop}px 0 ${block.marginBottom}px`,
    padding: block.padding,
    border: `${block.borderWidth}px solid ${block.borderColor}`,
    borderRadius: block.radius,
    background: block.background,
    color: block.color,
    fontSize: block.fontSize,
    fontWeight: block.fontWeight,
    fontStyle: block.fontStyle,
    textDecoration: block.textDecoration,
    letterSpacing: block.letterSpacing,
    lineHeight: block.lineHeight,
    textAlign: block.align,
    overflowWrap: "break-word",
  }
  if (block.variant === "quote") {
    style.borderLeft = `5px solid ${block.accentColor}`
  }
  if (block.variant === "highlight") {
    style.boxShadow = `inset 0 -0.55em 0 ${block.accentColor}33`
  }
  return style
}

function SourceContent({
  block,
  source,
}: {
  block: WechatContentBlock
  source: CanvasSource
}) {
  if (source.kind === "image") {
    return (
      <figure style={contentStyle(block)}>
        <img
          src={source.src}
          alt={source.alt || ""}
          style={{
            display: "block",
            width: "100%",
            maxWidth: "100%",
            height: block.imageFit === "cover" ? 360 : "auto",
            objectFit: block.imageFit,
            borderRadius: block.imageRadius,
          }}
        />
        {source.alt ? (
          <figcaption style={{ marginTop: 8, color: block.color, fontSize: 13, lineHeight: 1.5, textAlign: "center" }}>
            {source.alt}
          </figcaption>
        ) : null}
      </figure>
    )
  }

  const text = source.text || ""
  const style = contentStyle(block)
  if (source.kind === "title") return <h1 style={style}>{text}</h1>
  if (source.kind === "heading") {
    return (
      <h2 style={style}>
        {block.variant === "banner" ? (
          <span style={{ display: "inline-block", width: 5, height: "1.15em", marginRight: 10, verticalAlign: "-0.15em", background: block.accentColor }} />
        ) : null}
        {text}
      </h2>
    )
  }
  if (source.kind === "quote") return <blockquote style={style}>{text}</blockquote>
  if (source.kind === "list") {
    return (
      <section style={style}>
        {text.split("\n").map((item, index) => (
          <p key={`${block.id}-${index}`} style={{ margin: index === 0 ? 0 : "8px 0 0" }}>
            {item}
          </p>
        ))}
      </section>
    )
  }
  return <p style={{ ...style, whiteSpace: "pre-wrap" }}>{text}</p>
}

function Decoration({ block }: { block: WechatDecorationBlock }) {
  const justifyContent = block.align === "left"
    ? "flex-start"
    : block.align === "right"
      ? "flex-end"
      : "center"
  return (
    <section
      style={{
        display: "flex",
        justifyContent,
        margin: `${block.marginTop}px 0 ${block.marginBottom}px`,
        lineHeight: 0,
      }}
    >
      <svg
        viewBox={`0 0 ${block.viewBoxWidth} ${block.viewBoxHeight}`}
        width={block.width}
        height={block.height}
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: "block", maxWidth: "100%" }}
      >
        <path
          d={block.d}
          fill={block.fill}
          stroke={block.stroke}
          strokeWidth={block.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </section>
  )
}

export function WechatBlockRenderer({
  document,
  sources,
  selectedId,
  contentRef,
  onSelect,
}: Pick<
  WechatBlockEditorProps,
  "document" | "sources" | "selectedId" | "contentRef" | "onSelect"
>) {
  const sourceMap = new Map(sources.map(source => [source.id, source]))
  return (
    <section
      ref={contentRef}
      className="wbe-document"
      style={{
        width: document.width,
        maxWidth: "100%",
        padding: "42px 40px 56px",
        background: document.background,
        fontFamily: FONT_STACKS[document.font],
      }}
      onClick={event => {
        if (event.target === event.currentTarget) onSelect(null)
      }}
    >
      {document.blocks.map(block => {
        const source = block.type === "content" ? sourceMap.get(block.sourceId) : undefined
        if (block.type === "content" && !source) return null
        const sectionSources = block.type === "section"
          ? block.sourceIds.flatMap(sourceId => {
            const sectionSource = sourceMap.get(sourceId)
            return sectionSource ? [sectionSource] : []
          })
          : []
        if (block.type === "section" && sectionSources.length !== block.sourceIds.length) return null
        return (
          <div
            key={block.id}
            className={`wbe-rendered-block${selectedId === block.id ? " is-selected" : ""}`}
            data-block-id={block.id}
            onClick={event => {
              event.stopPropagation()
              onSelect(block.id)
            }}
          >
            {block.type === "decoration"
              ? <Decoration block={block} />
              : block.type === "section"
                ? (
                  <SectionContent
                    block={block}
                    sources={sectionSources}
                    selectedId={selectedId}
                    onSelect={onSelect}
                  />
                )
                : <SourceContent block={block} source={source as CanvasSource} />}
          </div>
        )
      })}
    </section>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
      />
    </label>
  )
}

function ColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string
  value: string
  fallback: string
  onChange: (value: string) => void
}) {
  return (
    <label>
      <span>{label}</span>
      <div className="wbe-color-field">
        <input
          type="color"
          value={value === "transparent" ? fallback : value}
          onChange={event => onChange(event.target.value)}
        />
        <button
          type="button"
          className={value === "transparent" ? "active" : ""}
          onClick={() => onChange("transparent")}
        >
          透明
        </button>
      </div>
    </label>
  )
}

export default function WechatBlockEditor({
  document,
  sources,
  selectedId,
  contentRef,
  onSelect,
  onChange,
}: WechatBlockEditorProps) {
  const sourceMap = new Map(sources.map(source => [source.id, source]))
  const selectedBlock = document.blocks.find(block => block.id === selectedId) ?? null
  const [selectedSectionId, selectedSectionSourceId] = selectedId?.split("::") || []
  const selectedSection = document.blocks.find((block): block is WechatSectionBlock => (
    block.type === "section" && block.id === selectedSectionId
  )) ?? null
  const selectedSectionSource = selectedSectionSourceId
    ? sourceMap.get(selectedSectionSourceId) ?? null
    : null
  const selectedSectionText = selectedSection && selectedSectionSource
    ? sectionContentBlock(selectedSectionSource, selectedSection)
    : null

  const updateDocument = (patch: Partial<WechatBlockDocument>) => {
    onChange({ ...document, ...patch })
  }
  const updateBlock = (patch: Partial<WechatBlock>) => {
    if (!selectedBlock) return
    onChange({
      ...document,
      blocks: document.blocks.map(block => (
        block.id === selectedBlock.id ? { ...block, ...patch } as WechatBlock : block
      )),
    })
  }
  const updateSectionItemStyle = (patch: WechatTextStyleOverride) => {
    if (!selectedSection || !selectedSectionSourceId) return
    onChange({
      ...document,
      blocks: document.blocks.map(block => block.id === selectedSection.id && block.type === "section" ? {
        ...block,
        itemStyles: {
          ...block.itemStyles,
          [selectedSectionSourceId]: {
            ...(block.itemStyles[selectedSectionSourceId] || {}),
            ...patch,
          },
        },
      } : block),
    })
  }
  const moveDecoration = (direction: -1 | 1) => {
    if (!selectedBlock || selectedBlock.type !== "decoration") return
    const index = document.blocks.findIndex(block => block.id === selectedBlock.id)
    const target = index + direction
    if (target < 0 || target >= document.blocks.length) return
    const blocks = [...document.blocks]
    ;[blocks[index], blocks[target]] = [blocks[target], blocks[index]]
    const previousContent = blocks
      .slice(0, target)
      .reverse()
      .find((block): block is WechatContentBlock => block.type === "content")
    const nextContent = blocks
      .slice(target + 1)
      .find((block): block is WechatContentBlock => block.type === "content")
    blocks[target] = {
      ...selectedBlock,
      anchorSourceId: previousContent?.sourceId || nextContent?.sourceId || selectedBlock.anchorSourceId,
      placement: previousContent ? "after" : "before",
    }
    onChange({ ...document, blocks })
  }
  const deleteDecoration = () => {
    if (!selectedBlock || selectedBlock.type !== "decoration") return
    onChange({
      ...document,
      blocks: document.blocks.filter(block => block.id !== selectedBlock.id),
    })
    onSelect(null)
  }

  return (
    <main className="wbe-workspace">
      <aside className="wbe-outline">
        <div className="wbe-panel-row">
          <strong>文章结构</strong>
          <span>{sources.length} 个内容块</span>
        </div>
        <div className="wbe-block-list">
          {document.blocks.map(block => {
            const source = block.type === "content" ? sourceMap.get(block.sourceId) : undefined
            return (
              <div className="wbe-block-group" key={block.id}>
                <button
                  className={selectedId === block.id ? "active" : ""}
                  onClick={() => onSelect(block.id)}
                >
                  <span className={`wbe-block-icon wbe-block-icon--${block.type}`}>
                    {block.type === "decoration"
                      ? <Sparkles size={14} />
                      : block.type === "section"
                        ? <Columns size={14} />
                        : source?.kind === "image"
                          ? <ImageIcon size={14} />
                          : source?.kind === "quote"
                            ? <Quote size={14} />
                            : <Type size={14} />}
                  </span>
                  <span>{blockLabel(block, source)}</span>
                </button>
                {block.type === "section" ? (
                  <div className="wbe-section-children">
                    {block.sourceIds.map(sourceId => {
                      const childSource = sourceMap.get(sourceId)
                      const childSelectionId = `${block.id}::${sourceId}`
                      return (
                        <button
                          key={sourceId}
                          className={selectedId === childSelectionId ? "active" : ""}
                          onClick={() => onSelect(childSelectionId)}
                        >
                          {childSource?.kind === "image" ? <ImageIcon size={13} /> : <Type size={13} />}
                          <span>{childSource?.text?.split("\n")[0] || childSource?.alt || "内容"}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
        <div className="wbe-outline-actions">
          <button
            title="上移 SVG 装饰"
            disabled={selectedBlock?.type !== "decoration"}
            onClick={() => moveDecoration(-1)}
          >
            <ArrowUp size={15} />
          </button>
          <button
            title="下移 SVG 装饰"
            disabled={selectedBlock?.type !== "decoration"}
            onClick={() => moveDecoration(1)}
          >
            <ArrowDown size={15} />
          </button>
          <button
            title="删除 SVG 装饰"
            disabled={selectedBlock?.type !== "decoration"}
            onClick={deleteDecoration}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </aside>

      <section className="wbe-stage" style={{ background: document.pageBackground }}>
        <div className="wbe-stage-meta">
          <strong>{document.name}</strong>
          <span>微信正文宽度 {document.width}px · 高度随内容增长</span>
        </div>
        <div className="wbe-paper">
          <WechatBlockRenderer
            document={document}
            sources={sources}
            selectedId={selectedId}
            contentRef={contentRef}
            onSelect={onSelect}
          />
        </div>
      </section>

      <aside className="wbe-inspector">
        <div className="wbe-inspector-title">
          <Palette size={15} />
          样式属性
        </div>
        <div className="wbe-properties">
          <label>
            <span>排版名称</span>
            <input value={document.name} onChange={event => updateDocument({ name: event.target.value })} />
          </label>
          <label>
            <span>字体</span>
            <select
              value={document.font}
              onChange={event => updateDocument({ font: event.target.value as WechatBlockDocument["font"] })}
            >
              <option value="system">系统黑体</option>
              <option value="serif">宋体</option>
              <option value="rounded">圆润黑体</option>
              <option value="friendly">设计文件字体</option>
            </select>
          </label>
          <div className="wbe-property-grid">
            <ColorField label="正文背景" value={document.background} fallback="#ffffff" onChange={background => updateDocument({ background })} />
            <ColorField label="工作区背景" value={document.pageBackground} fallback="#f4f1e8" onChange={pageBackground => updateDocument({ pageBackground })} />
          </div>

          {selectedBlock?.type === "content" ? (
            <>
              <div className="wbe-property-heading">{blockLabel(selectedBlock, sourceMap.get(selectedBlock.sourceId))}</div>
              <label>
                <span>内容版式</span>
                <select
                  value={selectedBlock.variant}
                  disabled={sourceMap.get(selectedBlock.sourceId)?.kind === "image"}
                  onChange={event => updateBlock({ variant: event.target.value as WechatContentBlock["variant"] })}
                >
                  <option value="plain">正文</option>
                  <option value="title">大标题</option>
                  <option value="banner">章节条</option>
                  <option value="card">内容卡片</option>
                  <option value="quote">引用面板</option>
                  <option value="highlight">文字高亮</option>
                  <option value="image">图片</option>
                </select>
              </label>
              <div className="wbe-property-grid">
                <ColorField label="文字" value={selectedBlock.color} fallback="#262626" onChange={color => updateBlock({ color })} />
                <ColorField label="背景" value={selectedBlock.background} fallback="#ffffff" onChange={background => updateBlock({ background })} />
                <ColorField label="强调色" value={selectedBlock.accentColor} fallback="#2f6f62" onChange={accentColor => updateBlock({ accentColor })} />
                <ColorField label="边框" value={selectedBlock.borderColor} fallback="#dddddd" onChange={borderColor => updateBlock({ borderColor })} />
              </div>
              <div className="wbe-property-grid">
                <NumberField label="字号" value={selectedBlock.fontSize} min={12} max={48} onChange={fontSize => updateBlock({ fontSize })} />
                <NumberField label="字重" value={selectedBlock.fontWeight} min={300} max={900} step={100} onChange={fontWeight => updateBlock({ fontWeight })} />
                <NumberField label="字距" value={selectedBlock.letterSpacing} min={0} max={8} step={0.5} onChange={letterSpacing => updateBlock({ letterSpacing })} />
                <NumberField label="行高" value={selectedBlock.lineHeight} min={1} max={2.6} step={0.1} onChange={lineHeight => updateBlock({ lineHeight })} />
                <NumberField label="内边距" value={selectedBlock.padding} min={0} max={48} onChange={padding => updateBlock({ padding })} />
                <NumberField label="圆角" value={selectedBlock.radius} min={0} max={32} onChange={radius => updateBlock({ radius })} />
                <NumberField label="边框" value={selectedBlock.borderWidth} min={0} max={8} onChange={borderWidth => updateBlock({ borderWidth })} />
                <NumberField label="上间距" value={selectedBlock.marginTop} min={0} max={80} onChange={marginTop => updateBlock({ marginTop })} />
                <NumberField label="下间距" value={selectedBlock.marginBottom} min={0} max={80} onChange={marginBottom => updateBlock({ marginBottom })} />
              </div>
              <label>
                <span>对齐</span>
                <select value={selectedBlock.align} onChange={event => updateBlock({ align: event.target.value as WechatContentBlock["align"] })}>
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </select>
              </label>
              <div className="wbe-text-format" role="group" aria-label="文字格式">
                <button
                  className={selectedBlock.fontWeight >= 700 ? "active" : ""}
                  title="粗体"
                  onClick={() => updateBlock({ fontWeight: selectedBlock.fontWeight >= 700 ? 400 : 700 })}
                >
                  B
                </button>
                <button
                  className={selectedBlock.fontStyle === "italic" ? "active" : ""}
                  title="斜体"
                  onClick={() => updateBlock({ fontStyle: selectedBlock.fontStyle === "italic" ? "normal" : "italic" })}
                >
                  I
                </button>
                <button
                  className={selectedBlock.textDecoration === "underline" ? "active" : ""}
                  title="下划线"
                  onClick={() => updateBlock({ textDecoration: selectedBlock.textDecoration === "underline" ? "none" : "underline" })}
                >
                  U
                </button>
              </div>
            </>
          ) : null}

          {selectedBlock?.type === "decoration" ? (
            <>
              <div className="wbe-property-heading">AI SVG 装饰</div>
              <label>
                <span>SVG Path</span>
                <textarea value={selectedBlock.d} rows={7} onChange={event => updateBlock({ d: event.target.value })} />
              </label>
              <div className="wbe-property-grid">
                <ColorField label="填充" value={selectedBlock.fill} fallback="#ffffff" onChange={fill => updateBlock({ fill })} />
                <ColorField label="描边" value={selectedBlock.stroke} fallback="#2f6f62" onChange={stroke => updateBlock({ stroke })} />
                <NumberField label="宽度" value={selectedBlock.width} min={16} max={677} onChange={width => updateBlock({ width })} />
                <NumberField label="高度" value={selectedBlock.height} min={16} max={320} onChange={height => updateBlock({ height })} />
                <NumberField label="线宽" value={selectedBlock.strokeWidth} min={0} max={20} onChange={strokeWidth => updateBlock({ strokeWidth })} />
                <NumberField label="下间距" value={selectedBlock.marginBottom} min={0} max={64} onChange={marginBottom => updateBlock({ marginBottom })} />
              </div>
            </>
          ) : null}

          {selectedBlock?.type === "section" ? (
            <>
              <div className="wbe-property-heading">组合区域 · {selectedBlock.sourceIds.length} 项</div>
              <label>
                <span>布局</span>
                <select
                  value={selectedBlock.layout}
                  onChange={event => updateBlock({ layout: event.target.value as WechatSectionBlock["layout"] })}
                >
                  <option value="stack">纵向组合</option>
                  <option value="two-column">左右双栏</option>
                  <option value="comparison">主体对比</option>
                  <option value="feature">重点 + 双栏</option>
                </select>
              </label>
              <div className="wbe-property-grid">
                <ColorField label="文字" value={selectedBlock.color} fallback="#262626" onChange={color => updateBlock({ color })} />
                <ColorField label="背景" value={selectedBlock.background} fallback="#ffffff" onChange={background => updateBlock({ background })} />
                <ColorField label="强调色" value={selectedBlock.accentColor} fallback="#5263a5" onChange={accentColor => updateBlock({ accentColor })} />
                <ColorField label="边框" value={selectedBlock.borderColor} fallback="#dee0e3" onChange={borderColor => updateBlock({ borderColor })} />
                <NumberField label="内边距" value={selectedBlock.padding} min={0} max={48} onChange={padding => updateBlock({ padding })} />
                <NumberField label="栏间距" value={selectedBlock.gap} min={0} max={40} onChange={gap => updateBlock({ gap })} />
                <NumberField label="圆角" value={selectedBlock.radius} min={0} max={32} onChange={radius => updateBlock({ radius })} />
                <NumberField label="边框" value={selectedBlock.borderWidth} min={0} max={8} onChange={borderWidth => updateBlock({ borderWidth })} />
                <NumberField label="上间距" value={selectedBlock.marginTop} min={0} max={80} onChange={marginTop => updateBlock({ marginTop })} />
                <NumberField label="下间距" value={selectedBlock.marginBottom} min={0} max={80} onChange={marginBottom => updateBlock({ marginBottom })} />
              </div>
              <label className="wbe-checkbox-field">
                <input
                  type="checkbox"
                  checked={selectedBlock.divider}
                  onChange={event => updateBlock({ divider: event.target.checked })}
                />
                <span>显示双栏虚线分割</span>
              </label>
            </>
          ) : null}

          {selectedSection && selectedSectionSource && selectedSectionText ? (
            <>
              <div className="wbe-property-heading">
                文字 · {selectedSectionSource.text?.slice(0, 28) || selectedSectionSource.alt || "图片"}
              </div>
              {selectedSectionSource.kind === "image" ? (
                <div className="wbe-empty-selection">图片样式由组合区域控制</div>
              ) : (
                <>
                  <label>
                    <span>文字版式</span>
                    <select
                      value={selectedSectionText.variant}
                      onChange={event => updateSectionItemStyle({
                        variant: event.target.value as Exclude<WechatContentBlock["variant"], "image">,
                      })}
                    >
                      <option value="plain">正文</option>
                      <option value="title">大标题</option>
                      <option value="banner">章节条</option>
                      <option value="card">内容卡片</option>
                      <option value="quote">引用面板</option>
                      <option value="highlight">文字高亮</option>
                    </select>
                  </label>
                  <div className="wbe-property-grid">
                    <ColorField label="文字" value={selectedSectionText.color} fallback="#262626" onChange={color => updateSectionItemStyle({ color })} />
                    <ColorField label="背景" value={selectedSectionText.background} fallback="#ffffff" onChange={background => updateSectionItemStyle({ background })} />
                    <ColorField label="强调色" value={selectedSectionText.accentColor} fallback="#5263a5" onChange={accentColor => updateSectionItemStyle({ accentColor })} />
                    <NumberField label="字号" value={selectedSectionText.fontSize} min={12} max={48} onChange={fontSize => updateSectionItemStyle({ fontSize })} />
                    <NumberField label="字重" value={selectedSectionText.fontWeight} min={300} max={900} step={100} onChange={fontWeight => updateSectionItemStyle({ fontWeight })} />
                    <NumberField label="字距" value={selectedSectionText.letterSpacing} min={0} max={8} step={0.5} onChange={letterSpacing => updateSectionItemStyle({ letterSpacing })} />
                    <NumberField label="行高" value={selectedSectionText.lineHeight} min={1} max={2.6} step={0.1} onChange={lineHeight => updateSectionItemStyle({ lineHeight })} />
                  </div>
                  <label>
                    <span>对齐</span>
                    <select
                      value={selectedSectionText.align}
                      onChange={event => updateSectionItemStyle({ align: event.target.value as WechatContentBlock["align"] })}
                    >
                      <option value="left">左对齐</option>
                      <option value="center">居中</option>
                      <option value="right">右对齐</option>
                    </select>
                  </label>
                  <div className="wbe-text-format" role="group" aria-label="文字格式">
                    <button
                      className={selectedSectionText.fontWeight >= 700 ? "active" : ""}
                      title="粗体"
                      onClick={() => updateSectionItemStyle({ fontWeight: selectedSectionText.fontWeight >= 700 ? 400 : 700 })}
                    >
                      B
                    </button>
                    <button
                      className={selectedSectionText.fontStyle === "italic" ? "active" : ""}
                      title="斜体"
                      onClick={() => updateSectionItemStyle({ fontStyle: selectedSectionText.fontStyle === "italic" ? "normal" : "italic" })}
                    >
                      I
                    </button>
                    <button
                      className={selectedSectionText.textDecoration === "underline" ? "active" : ""}
                      title="下划线"
                      onClick={() => updateSectionItemStyle({ textDecoration: selectedSectionText.textDecoration === "underline" ? "none" : "underline" })}
                    >
                      U
                    </button>
                  </div>
                </>
              )}
            </>
          ) : null}

          {!selectedBlock && !selectedSection ? <div className="wbe-empty-selection">选择正文块后调整样式</div> : null}
        </div>
      </aside>
    </main>
  )
}
