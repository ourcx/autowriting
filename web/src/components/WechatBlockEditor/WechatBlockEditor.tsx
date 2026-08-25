import type { CSSProperties, RefObject } from "react"
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Columns,
  Image as ImageIcon,
  Lightbulb,
  Mic,
  Palette,
  Quote,
  Sparkles,
  TrendingUp,
  Trash2,
  Type,
} from "lucide-react"
import type { CanvasSource } from "../../../shared/canvasArticle"
import { createWechatContentBlock } from "../../../shared/wechatBlockDsl"
import type {
  WechatBlock,
  WechatBlockDocument,
  WechatBlockTheme,
  WechatAssetBlock,
  WechatContentBlock,
  WechatDecorationBlock,
  WechatDividerBlock,
  WechatIconName,
  WechatSectionBlock,
  WechatSectionIcon,
  WechatSurfaceKind,
  WechatSurfaceStyle,
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
  editorial: "'Work Sans', -apple-system, 'Segoe UI', Helvetica, 'PingFang SC', sans-serif",
}

const EDITORIAL_DISPLAY_FONT = "'Archivo Black', Impact, 'Arial Black', 'PingFang SC', sans-serif"
const GENERATED_IMAGE_ENDPOINT = "https://copilot-cn.bytedance.net/api/ide/v1/text_to_image"

function colorWithOpacity(color: string, opacity: number): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i)?.[1]
  const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  const red = hex ? Number.parseInt(hex.slice(0, 2), 16) : Number(rgb?.[1])
  const green = hex ? Number.parseInt(hex.slice(2, 4), 16) : Number(rgb?.[2])
  const blue = hex ? Number.parseInt(hex.slice(4, 6), 16) : Number(rgb?.[3])
  if (![red, green, blue].every(Number.isFinite)) return color
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`
}

function hasVisibleFill(color: string): boolean {
  if (color.toLowerCase() === "transparent") return false
  const rgba = color.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)$/i)
  return !rgba || Number(rgba[1]) > 0
}

function surfaceCss(
  surface: WechatSurfaceStyle | undefined,
  fallback: string,
): CSSProperties {
  if (!surface || surface.kind === "none") return { background: fallback }
  const primary = surface.colors[0] || fallback
  const secondary = surface.colors[1] || primary
  const pattern = colorWithOpacity(surface.patternColor, surface.opacity)
  if (surface.kind === "generated") {
    if (!surface.prompt.trim()) return { background: primary }
    const overlay = colorWithOpacity(surface.overlayColor, surface.overlayOpacity)
    const imageUrl = generatedImageUrl(
      surface.prompt,
      surface.imageSize,
      surface.fit === "tile"
        ? "Seamless repeatable editorial background texture."
        : "Editorial background with a calm center area reserved for readable article text.",
    )
    return {
      backgroundColor: primary,
      backgroundImage: `linear-gradient(${overlay}, ${overlay}), url("${imageUrl}")`,
      backgroundSize: surface.fit === "tile"
        ? `${surface.size * 8}px auto`
        : surface.fit,
      backgroundRepeat: surface.fit === "tile" ? "repeat" : "no-repeat",
      backgroundPosition: "center",
    }
  }
  if (surface.kind === "solid") return { background: primary }
  if (surface.kind === "linear") {
    return {
      backgroundColor: primary,
      backgroundImage: `linear-gradient(${surface.angle}deg, ${primary}, ${secondary})`,
    }
  }
  if (surface.kind === "stripes") {
    const stripe = Math.max(2, Math.round(surface.size / 2))
    return {
      backgroundColor: primary,
      backgroundImage: `repeating-linear-gradient(${surface.angle}deg, ${pattern} 0, ${pattern} ${stripe}px, transparent ${stripe}px, transparent ${surface.size}px)`,
    }
  }
  if (surface.kind === "dots") {
    return {
      backgroundColor: primary,
      backgroundImage: `radial-gradient(circle, ${pattern} 1.2px, transparent 1.5px)`,
      backgroundSize: `${surface.size}px ${surface.size}px`,
    }
  }
  if (surface.kind === "grid") {
    return {
      backgroundColor: primary,
      backgroundImage: `linear-gradient(${pattern} 1px, transparent 1px), linear-gradient(90deg, ${pattern} 1px, transparent 1px)`,
      backgroundSize: `${surface.size}px ${surface.size}px`,
    }
  }
  return {
    backgroundColor: primary,
    backgroundImage: `repeating-linear-gradient(0deg, transparent 0, transparent ${surface.size - 1}px, ${pattern} ${surface.size - 1}px, ${pattern} ${surface.size}px)`,
    backgroundSize: `100% ${surface.size}px`,
  }
}

function generatedImageUrl(
  prompt: string,
  imageSize: WechatAssetBlock["imageSize"],
  purpose: string,
): string {
  const normalizedPrompt = [
    prompt,
    purpose,
    "No embedded text, no logo, no watermark.",
  ].join(" ")
  return `${GENERATED_IMAGE_ENDPOINT}?prompt=${encodeURIComponent(normalizedPrompt)}&image_size=${imageSize}`
}

function generatedAssetUrl(block: WechatAssetBlock): string {
  const prompt = [
    block.prompt,
    "Clean web editorial asset suitable for a WeChat article.",
  ].join(" ")
  return generatedImageUrl(prompt, block.imageSize, "Concrete editorial illustration with a clear composition.")
}

function generatedAssetRatio(block: WechatAssetBlock): string {
  if (block.imageSize === "landscape_16_9") return "16 / 9"
  if (block.imageSize === "landscape_4_3") return "4 / 3"
  if (block.imageSize === "portrait_16_9") return "9 / 16"
  if (block.imageSize === "portrait_4_3") return "3 / 4"
  return "1 / 1"
}

function SectionIcon({ icon }: { icon: WechatSectionIcon }) {
  const props = {
    size: icon.size,
    color: icon.color,
    strokeWidth: 2,
    "aria-hidden": true,
  }
  if (icon.kind === "path" && icon.d) {
    return (
      <svg
        data-wechat-icon="true"
        width={icon.size}
        height={icon.size}
        viewBox={`0 0 ${icon.size} ${icon.size}`}
        aria-hidden="true"
      >
        <path
          d={icon.d}
          fill="none"
          stroke={icon.color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (icon.name === "book-open") return <BookOpen {...props} data-wechat-icon="true" />
  if (icon.name === "quote") return <Quote {...props} data-wechat-icon="true" />
  if (icon.name === "lightbulb") return <Lightbulb {...props} data-wechat-icon="true" />
  if (icon.name === "mic") return <Mic {...props} data-wechat-icon="true" />
  if (icon.name === "trending-up") return <TrendingUp {...props} data-wechat-icon="true" />
  if (icon.name === "check-circle") return <CheckCircle2 {...props} data-wechat-icon="true" />
  if (icon.name === "arrow-right") return <ArrowRight {...props} data-wechat-icon="true" />
  if (icon.name === "bar-chart") return <BarChart3 {...props} data-wechat-icon="true" />
  return <Sparkles {...props} data-wechat-icon="true" />
}

function blockLabel(block: WechatBlock, source?: CanvasSource): string {
  if (block.type === "decoration") return "AI SVG 装饰"
  if (block.type === "asset") return "AI 图片素材"
  if (block.type === "divider") return "分隔线"
  if (block.type === "section") return `${block.layout} · ${block.sourceIds.length} 项`
  if (source?.kind === "image") return source.alt || "文章图片"
  return source?.text?.split("\n")[0] || "内容块"
}

function isAuxiliaryBlock(
  block: WechatBlock,
): block is WechatDecorationBlock | WechatAssetBlock | WechatDividerBlock {
  return block.type === "decoration" || block.type === "asset" || block.type === "divider"
}

function sectionContentBlock(
  source: CanvasSource,
  section: WechatSectionBlock,
  theme: WechatBlockTheme,
): WechatContentBlock {
  const fallback = createWechatContentBlock(source, theme)
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
  const roleOverride: WechatTextStyleOverride = source.id === section.leadSourceId
    ? { variant: "lede" }
    : source.id === section.overlineSourceId
      ? { variant: "overline" }
      : {}
  return {
    ...sectionDefault,
    ...roleOverride,
    ...(section.itemStyles[source.id] || {}),
  }
}

function SectionContent({
  block,
  sources,
  selectedId,
  onSelect,
  fontTheme,
  theme,
}: {
  block: WechatSectionBlock
  sources: CanvasSource[]
  selectedId: string | null
  onSelect: (id: string) => void
  fontTheme: WechatBlockDocument["font"]
  theme: WechatBlockTheme
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
          block={sectionContentBlock(source, block, theme)}
          source={source}
          fontTheme={fontTheme}
        />
      </div>
    )
  }
  const wrapperStyle: CSSProperties = {
    margin: `${block.marginTop}px 0 ${block.marginBottom}px`,
    padding: block.padding,
    border: `${block.borderWidth}px solid ${block.borderColor}`,
    borderRadius: block.radius,
    ...surfaceCss(block.surfaceStyle, block.background),
    color: block.color,
    boxShadow: block.shadow === "soft" ? "0 4px 6px -1px rgba(0, 0, 0, 0.1)" : undefined,
    overflow: "hidden",
  }
  if (block.accentStyle === "left") wrapperStyle.borderLeft = `4px solid ${block.accentColor}`
  if (block.accentStyle === "bottom") wrapperStyle.borderBottom = `4px solid ${block.accentColor}`
  const accentRail = block.accentStyle === "tri-color" ? (
    <div
      aria-hidden="true"
      className="wbe-learning-rail"
      style={{
        display: "flex",
        height: 5,
        margin: `${-block.padding}px ${-block.padding}px ${Math.max(16, block.gap)}px`,
        lineHeight: 0,
      }}
    >
      <span style={{ flex: 2, background: block.accentColor }} />
      <span style={{ flex: 1, background: "#3b82f6" }} />
      <span style={{ flex: 1, background: "#22c55e" }} />
    </div>
  ) : block.accentStyle === "top" ? (
    <div
      aria-hidden="true"
      className="wbe-editorial-rail"
      style={{
        height: 4,
        margin: `${-block.padding}px ${-block.padding}px ${Math.max(16, block.gap)}px`,
        background: block.accentColor,
        lineHeight: 0,
      }}
    />
  ) : null
  const sectionIcon = block.icon ? (
    <div
      className="wbe-section-icon"
      style={{
        display: "flex",
        justifyContent: block.icon.position === "top-right" ? "flex-end" : "flex-start",
        marginBottom: block.icon.position === "inline" ? 8 : 14,
      }}
    >
      <SectionIcon icon={block.icon} />
    </div>
  ) : null
  if (block.layout === "stack") {
    return <section style={wrapperStyle}>{accentRail}{sectionIcon}{sources.map(renderSource)}</section>
  }

  if (block.layout === "timeline" || block.layout === "steps") {
    const markerSize = block.layout === "steps" ? 30 : 12
    return (
      <section style={wrapperStyle}>
        {accentRail}
        {sectionIcon}
        <table
          role="presentation"
          style={{
            width: "100%",
            tableLayout: "fixed",
            borderCollapse: "collapse",
            borderSpacing: 0,
          }}
        >
          <tbody>
            {sources.map((source, index) => (
              <tr key={`${block.id}-${source.id}`}>
                <td
                  style={{
                    width: block.layout === "steps" ? 46 : 30,
                    padding: `3px ${block.gap}px 0 0`,
                    borderRight: block.layout === "timeline" && index < sources.length - 1
                      ? `2px solid ${block.borderColor}`
                      : "0",
                    verticalAlign: "top",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      width: markerSize,
                      height: markerSize,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 999,
                      background: block.accentColor,
                      color: "#ffffff",
                      fontSize: 13,
                      fontWeight: 700,
                      lineHeight: 1,
                    }}
                  >
                    {block.layout === "steps" ? index + 1 : ""}
                  </span>
                </td>
                <td
                  style={{
                    padding: index < sources.length - 1 ? `0 0 ${block.gap}px ${block.gap}px` : `0 0 0 ${block.gap}px`,
                    verticalAlign: "top",
                  }}
                >
                  {renderSource(source)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    )
  }

  if (block.layout === "media-text") {
    const mediaSource = sources[0]
    const detailSources = sources.slice(1)
    const mediaWidth = block.columnRatio === "1:2"
      ? "33.333%"
      : block.columnRatio === "2:1"
        ? "66.667%"
        : "50%"
    const detailWidth = block.columnRatio === "1:2"
      ? "66.667%"
      : block.columnRatio === "2:1"
        ? "33.333%"
        : "50%"
    return (
      <section style={wrapperStyle}>
        {accentRail}
        {sectionIcon}
        <table
          role="presentation"
          style={{
            width: "100%",
            tableLayout: "fixed",
            borderCollapse: "separate",
            borderSpacing: 0,
            direction: block.mediaPosition === "right" ? "rtl" : "ltr",
          }}
        >
          <tbody>
            <tr>
              <td
                style={{
                  width: mediaWidth,
                  padding: block.mediaPosition === "right" ? `0 0 0 ${block.gap}px` : `0 ${block.gap}px 0 0`,
                  verticalAlign: "top",
                  direction: "ltr",
                }}
              >
                {mediaSource ? renderSource(mediaSource) : null}
              </td>
              <td
                style={{
                  width: detailWidth,
                  padding: block.mediaPosition === "right" ? `0 ${block.gap}px 0 0` : `0 0 0 ${block.gap}px`,
                  borderLeft: block.divider && block.mediaPosition === "left"
                    ? `1px dashed ${block.borderColor}`
                    : "0",
                  borderRight: block.divider && block.mediaPosition === "right"
                    ? `1px dashed ${block.borderColor}`
                    : "0",
                  verticalAlign: "top",
                  direction: "ltr",
                }}
              >
                {detailSources.map(renderSource)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    )
  }

  if (block.layout === "grid") {
    const rows = Array.from(
      { length: Math.ceil(sources.length / block.columns) },
      (_, rowIndex) => sources.slice(rowIndex * block.columns, (rowIndex + 1) * block.columns),
    )
    return (
      <section style={wrapperStyle}>
        {accentRail}
        {sectionIcon}
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
            {rows.map((row, rowIndex) => (
              <tr key={`${block.id}-row-${rowIndex}`}>
                {Array.from({ length: block.columns }, (_, columnIndex) => {
                  const source = row[columnIndex]
                  return (
                    <td
                      key={`${block.id}-cell-${rowIndex}-${columnIndex}`}
                      style={{
                        width: `${100 / block.columns}%`,
                        paddingRight: columnIndex < block.columns - 1 ? block.gap : 0,
                        paddingBottom: rowIndex < rows.length - 1 ? block.gap : 0,
                        verticalAlign: "top",
                      }}
                    >
                      {source ? renderSource(source) : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    )
  }

  const featureSource = block.layout === "feature" || block.layout === "editorial"
    ? sources[0]
    : null
  const columnSources = featureSource ? sources.slice(1) : sources
  const splitAt = Math.ceil(columnSources.length / 2)
  const columns = [
    columnSources.slice(0, splitAt),
    columnSources.slice(splitAt),
  ]
  const columnWidths = block.columnRatio === "1:2"
    ? ["33.333%", "66.667%"]
    : block.columnRatio === "2:1"
      ? ["66.667%", "33.333%"]
      : ["50%", "50%"]
  return (
    <section style={wrapperStyle}>
      {accentRail}
      {sectionIcon}
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
                  width: columnWidths[index],
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
    textIndent: block.textIndent,
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
  fontTheme,
}: {
  block: WechatContentBlock
  source: CanvasSource
  fontTheme: WechatBlockDocument["font"]
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
  const style: CSSProperties = {
    ...contentStyle(block),
    fontFamily: fontTheme === "editorial"
      && (source.kind === "title" || source.kind === "heading" || ["title", "banner", "metric"].includes(block.variant))
      ? EDITORIAL_DISPLAY_FONT
      : undefined,
    textTransform: block.variant === "overline" ? "uppercase" : undefined,
    fontVariantNumeric: block.variant === "metric" ? "tabular-nums" : undefined,
  }
  if (fontTheme === "editorial" && (source.kind === "title" || block.variant === "title")) {
    style.paddingBottom = Math.max(14, block.padding)
    style.borderBottom = `3px solid ${block.accentColor}`
  }
  if (fontTheme === "editorial" && block.variant === "quote") {
    style.borderLeft = `4px solid ${block.accentColor}`
  }
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
  if (block.variant === "dropcap" && text.length > 0) {
    return (
      <p style={{ ...style, textIndent: 0, whiteSpace: "pre-wrap" }}>
        <span
          style={{
            float: "left",
            margin: "0.08em 0.16em 0 0",
            color: block.accentColor,
            fontSize: "3.2em",
            fontWeight: 800,
            lineHeight: 0.82,
          }}
        >
          {text.slice(0, 1)}
        </span>
        {text.slice(1)}
      </p>
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

function GeneratedAsset({ block }: { block: WechatAssetBlock }) {
  const marginLeft = block.align === "right" ? "auto" : block.align === "center" ? "auto" : 0
  const marginRight = block.align === "left" ? "auto" : block.align === "center" ? "auto" : 0
  return (
    <figure
      data-wechat-material-wrapper="true"
      style={{
        width: block.width,
        maxWidth: "100%",
        aspectRatio: generatedAssetRatio(block),
        marginTop: block.marginTop,
        marginBottom: block.marginBottom,
        marginLeft,
        marginRight,
      }}
    >
      <img
        data-wechat-material="true"
        src={generatedAssetUrl(block)}
        alt=""
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          borderRadius: block.radius,
        }}
      />
    </figure>
  )
}

function Divider({ block }: { block: WechatDividerBlock }) {
  const marginLeft = block.align === "right" || block.align === "center" ? "auto" : 0
  const marginRight = block.align === "left" || block.align === "center" ? "auto" : 0
  const style: CSSProperties = {
    width: block.width,
    maxWidth: "100%",
    height: block.style === "double" ? block.thickness * 3 : block.thickness,
    marginTop: block.marginTop,
    marginBottom: block.marginBottom,
    marginLeft,
    marginRight,
    lineHeight: 0,
  }
  if (block.style === "gradient") {
    style.background = `linear-gradient(90deg, transparent, ${block.color}, ${block.secondaryColor}, transparent)`
  } else {
    style.borderTop = `${block.thickness}px ${block.style} ${block.color}`
    if (block.style === "double") style.borderBottom = `${block.thickness}px double ${block.secondaryColor}`
  }
  return <section style={style} aria-hidden="true" />
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
      data-wechat-side-padding={document.sidePadding}
      style={{
        width: document.width,
        maxWidth: "100%",
        padding: `42px ${document.sidePadding}px 56px`,
        ...surfaceCss(document.theme.canvasStyle, document.background),
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
              : block.type === "asset"
                ? <GeneratedAsset block={block} />
                : block.type === "divider"
                  ? <Divider block={block} />
                : block.type === "section"
                ? (
                  <SectionContent
                    block={block}
                    sources={sectionSources}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    fontTheme={document.font}
                    theme={document.theme}
                  />
                )
                : (
                  <SourceContent
                    block={block}
                    source={source as CanvasSource}
                    fontTheme={document.font}
                  />
                )}
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

function SurfaceFields({
  value,
  fallback,
  onChange,
}: {
  value?: WechatSurfaceStyle
  fallback: string
  onChange: (value: WechatSurfaceStyle) => void
}) {
  const surface: WechatSurfaceStyle = value || {
    kind: "none",
    colors: [fallback],
    patternColor: "#d1d5db",
    angle: 135,
    size: 20,
    opacity: 0.12,
    prompt: "",
    imageSize: "landscape_16_9",
    fit: "cover",
    overlayColor: "#ffffff",
    overlayOpacity: 0.12,
  }
  const updateColor = (index: number, color: string) => {
    const colors = [...surface.colors]
    colors[index] = color
    onChange({ ...surface, colors })
  }
  return (
    <>
      <label>
        <span>背景效果</span>
        <select
          value={surface.kind}
          onChange={event => onChange({
            ...surface,
            kind: event.target.value as WechatSurfaceKind,
          })}
        >
          <option value="none">纯背景</option>
          <option value="solid">纯色填充</option>
          <option value="linear">线性渐变</option>
          <option value="stripes">斜向条纹</option>
          <option value="dots">点阵</option>
          <option value="grid">网格</option>
          <option value="ruled-paper">横线稿纸</option>
          <option value="generated">AI 生成背景</option>
        </select>
      </label>
      {surface.kind === "generated" ? (
        <>
          <label>
            <span>背景生成提示词</span>
            <textarea
              rows={6}
              value={surface.prompt}
              onChange={event => onChange({ ...surface, prompt: event.target.value })}
            />
          </label>
          <div className="wbe-property-grid">
            <label>
              <span>图片比例</span>
              <select
                value={surface.imageSize}
                onChange={event => onChange({
                  ...surface,
                  imageSize: event.target.value as WechatSurfaceStyle["imageSize"],
                })}
              >
                <option value="landscape_16_9">横图 16:9</option>
                <option value="landscape_4_3">横图 4:3</option>
                <option value="square_hd">高清方图</option>
                <option value="square">方图</option>
                <option value="portrait_4_3">竖图 4:3</option>
                <option value="portrait_16_9">竖图 16:9</option>
              </select>
            </label>
            <label>
              <span>铺设方式</span>
              <select
                value={surface.fit}
                onChange={event => onChange({
                  ...surface,
                  fit: event.target.value as WechatSurfaceStyle["fit"],
                })}
              >
                <option value="cover">覆盖</option>
                <option value="contain">完整显示</option>
                <option value="tile">平铺纹理</option>
              </select>
            </label>
            <ColorField
              label="遮罩颜色"
              value={surface.overlayColor}
              fallback="#ffffff"
              onChange={overlayColor => onChange({ ...surface, overlayColor })}
            />
            <NumberField
              label="遮罩透明度"
              value={surface.overlayOpacity}
              min={0}
              max={0.8}
              step={0.05}
              onChange={overlayOpacity => onChange({ ...surface, overlayOpacity })}
            />
          </div>
        </>
      ) : null}
      {surface.kind !== "none" ? (
        <div className="wbe-property-grid">
          <ColorField
            label="底色"
            value={surface.colors[0] || fallback}
            fallback={fallback}
            onChange={color => updateColor(0, color)}
          />
          {surface.kind === "linear" ? (
            <ColorField
              label="渐变色"
              value={surface.colors[1] || surface.colors[0] || fallback}
              fallback={fallback}
              onChange={color => updateColor(1, color)}
            />
          ) : null}
          {["stripes", "dots", "grid", "ruled-paper"].includes(surface.kind) ? (
            <ColorField
              label="纹理色"
              value={surface.patternColor}
              fallback="#d1d5db"
              onChange={patternColor => onChange({ ...surface, patternColor })}
            />
          ) : null}
          {surface.kind !== "solid" && surface.kind !== "generated" ? (
            <>
              <NumberField
                label="纹理尺寸"
                value={surface.size}
                min={6}
                max={80}
                onChange={size => onChange({ ...surface, size })}
              />
              <NumberField
                label="纹理透明度"
                value={surface.opacity}
                min={0.02}
                max={0.5}
                step={0.02}
                onChange={opacity => onChange({ ...surface, opacity })}
              />
            </>
          ) : null}
          {surface.kind === "linear" || surface.kind === "stripes" ? (
            <NumberField
              label="角度"
              value={surface.angle}
              min={0}
              max={360}
              onChange={angle => onChange({ ...surface, angle })}
            />
          ) : null}
        </div>
      ) : null}
    </>
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
    ? sectionContentBlock(selectedSectionSource, selectedSection, document.theme)
    : null

  const updateDocument = (patch: Partial<WechatBlockDocument>) => {
    onChange({ ...document, ...patch })
  }
  const updateBlock = (patch: Partial<WechatBlock>) => {
    if (!selectedBlock) return
    onChange({
      ...document,
      blocks: document.blocks.map(block => {
        if (block.id !== selectedBlock.id) return block
        const next = { ...block, ...patch } as WechatBlock
        if (
          (next.type === "content" || next.type === "section")
          && next.padding < 12
          && (
            next.borderWidth > 0
            || hasVisibleFill(next.background)
            || (next.type === "section" && Boolean(next.surfaceStyle && next.surfaceStyle.kind !== "none"))
          )
        ) {
          return { ...next, padding: 12 } as WechatBlock
        }
        return next
      }),
    })
  }
  const updateSectionItemStyle = (patch: WechatTextStyleOverride) => {
    if (!selectedSection || !selectedSectionSourceId) return
    const current = selectedSection.itemStyles[selectedSectionSourceId] || {}
    const nextStyle = { ...current, ...patch }
    if (
      (nextStyle.padding ?? selectedSectionText?.padding ?? 0) < 12
      && (
        (nextStyle.borderWidth ?? selectedSectionText?.borderWidth ?? 0) > 0
        || hasVisibleFill(nextStyle.background ?? selectedSectionText?.background ?? "transparent")
      )
    ) {
      nextStyle.padding = 12
    }
    onChange({
      ...document,
      blocks: document.blocks.map(block => block.id === selectedSection.id && block.type === "section" ? {
        ...block,
        itemStyles: {
          ...block.itemStyles,
          [selectedSectionSourceId]: nextStyle,
        },
      } : block),
    })
  }
  const moveAuxiliary = (direction: -1 | 1) => {
    if (!selectedBlock || !isAuxiliaryBlock(selectedBlock)) return
    const index = document.blocks.findIndex(block => block.id === selectedBlock.id)
    const target = index + direction
    if (target < 0 || target >= document.blocks.length) return
    const blocks = [...document.blocks]
    ;[blocks[index], blocks[target]] = [blocks[target], blocks[index]]
    const previousAnchor = blocks
      .slice(0, target)
      .reverse()
      .find(block => block.type === "content" || block.type === "section")
    const nextAnchor = blocks
      .slice(target + 1)
      .find(block => block.type === "content" || block.type === "section")
    const previousSourceId = previousAnchor?.type === "content"
      ? previousAnchor.sourceId
      : previousAnchor?.type === "section"
        ? previousAnchor.sourceIds[previousAnchor.sourceIds.length - 1]
        : ""
    const nextSourceId = nextAnchor?.type === "content"
      ? nextAnchor.sourceId
      : nextAnchor?.type === "section"
        ? nextAnchor.sourceIds[0]
        : ""
    blocks[target] = {
      ...selectedBlock,
      anchorSourceId: previousSourceId || nextSourceId || selectedBlock.anchorSourceId,
      placement: previousSourceId ? "after" : "before",
    }
    onChange({ ...document, blocks })
  }
  const deleteAuxiliary = () => {
    if (!selectedBlock || !isAuxiliaryBlock(selectedBlock)) return
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
                      : block.type === "asset"
                        ? <ImageIcon size={14} />
                        : block.type === "divider"
                          ? <ArrowRight size={14} />
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
            title="上移装饰或素材"
            disabled={!selectedBlock || !isAuxiliaryBlock(selectedBlock)}
            onClick={() => moveAuxiliary(-1)}
          >
            <ArrowUp size={15} />
          </button>
          <button
            title="下移装饰或素材"
            disabled={!selectedBlock || !isAuxiliaryBlock(selectedBlock)}
            onClick={() => moveAuxiliary(1)}
          >
            <ArrowDown size={15} />
          </button>
          <button
            title="删除装饰或素材"
            disabled={!selectedBlock || !isAuxiliaryBlock(selectedBlock)}
            onClick={deleteAuxiliary}
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
              <option value="editorial">杂志编辑字体</option>
            </select>
          </label>
          <div className="wbe-property-grid">
            <ColorField label="正文背景" value={document.background} fallback="#ffffff" onChange={background => updateDocument({ background })} />
            <ColorField label="工作区背景" value={document.pageBackground} fallback="#f4f1e8" onChange={pageBackground => updateDocument({ pageBackground })} />
            <NumberField
              label="两侧留白"
              value={document.sidePadding}
              min={0}
              max={48}
              onChange={sidePadding => updateDocument({ sidePadding })}
            />
          </div>
          <SurfaceFields
            value={document.theme.canvasStyle}
            fallback={document.background}
            onChange={canvasStyle => updateDocument({
              theme: { ...document.theme, canvasStyle },
            })}
          />

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
                  <option value="lede">杂志导语</option>
                  <option value="overline">眉题</option>
                  <option value="metric">数据强调</option>
                  <option value="dropcap">首字下沉</option>
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
                <NumberField label="首行缩进" value={selectedBlock.textIndent} min={0} max={64} onChange={textIndent => updateBlock({ textIndent })} />
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

          {selectedBlock?.type === "asset" ? (
            <>
              <div className="wbe-property-heading">AI 图片素材</div>
              <label>
                <span>图片生成提示词</span>
                <textarea
                  value={selectedBlock.prompt}
                  rows={7}
                  onChange={event => updateBlock({ prompt: event.target.value })}
                />
              </label>
              <label>
                <span>图片比例</span>
                <select
                  value={selectedBlock.imageSize}
                  onChange={event => updateBlock({
                    imageSize: event.target.value as WechatAssetBlock["imageSize"],
                  })}
                >
                  <option value="landscape_16_9">横图 16:9</option>
                  <option value="landscape_4_3">横图 4:3</option>
                  <option value="square_hd">高清方图</option>
                  <option value="square">方图</option>
                  <option value="portrait_4_3">竖图 4:3</option>
                  <option value="portrait_16_9">竖图 16:9</option>
                </select>
              </label>
              <div className="wbe-property-grid">
                <NumberField label="宽度" value={selectedBlock.width} min={80} max={677} onChange={width => updateBlock({ width })} />
                <NumberField label="圆角" value={selectedBlock.radius} min={0} max={32} onChange={radius => updateBlock({ radius })} />
                <NumberField label="上间距" value={selectedBlock.marginTop} min={0} max={80} onChange={marginTop => updateBlock({ marginTop })} />
                <NumberField label="下间距" value={selectedBlock.marginBottom} min={0} max={80} onChange={marginBottom => updateBlock({ marginBottom })} />
              </div>
              <label>
                <span>对齐</span>
                <select
                  value={selectedBlock.align}
                  onChange={event => updateBlock({
                    align: event.target.value as WechatAssetBlock["align"],
                  })}
                >
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </select>
              </label>
            </>
          ) : null}

          {selectedBlock?.type === "divider" ? (
            <>
              <div className="wbe-property-heading">分隔线组件</div>
              <label>
                <span>线型</span>
                <select
                  value={selectedBlock.style}
                  onChange={event => updateBlock({
                    style: event.target.value as WechatDividerBlock["style"],
                  })}
                >
                  <option value="solid">实线</option>
                  <option value="dashed">虚线</option>
                  <option value="dotted">点线</option>
                  <option value="double">双线</option>
                  <option value="gradient">渐变线</option>
                </select>
              </label>
              <div className="wbe-property-grid">
                <ColorField label="主色" value={selectedBlock.color} fallback="#5263a5" onChange={color => updateBlock({ color })} />
                <ColorField label="辅色" value={selectedBlock.secondaryColor} fallback="#e8b94a" onChange={secondaryColor => updateBlock({ secondaryColor })} />
                <NumberField label="宽度" value={selectedBlock.width} min={24} max={677} onChange={width => updateBlock({ width })} />
                <NumberField label="线宽" value={selectedBlock.thickness} min={1} max={8} onChange={thickness => updateBlock({ thickness })} />
                <NumberField label="上间距" value={selectedBlock.marginTop} min={0} max={80} onChange={marginTop => updateBlock({ marginTop })} />
                <NumberField label="下间距" value={selectedBlock.marginBottom} min={0} max={80} onChange={marginBottom => updateBlock({ marginBottom })} />
              </div>
              <label>
                <span>对齐</span>
                <select
                  value={selectedBlock.align}
                  onChange={event => updateBlock({
                    align: event.target.value as WechatDividerBlock["align"],
                  })}
                >
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </select>
              </label>
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
                  <option value="editorial">杂志编排</option>
                  <option value="timeline">时间线</option>
                  <option value="steps">步骤流</option>
                  <option value="media-text">媒体 + 文字</option>
                  <option value="grid">内容网格</option>
                </select>
              </label>
              {["two-column", "comparison", "feature", "editorial", "media-text"].includes(selectedBlock.layout) ? (
                <label>
                  <span>双栏比例</span>
                  <select
                    value={selectedBlock.columnRatio}
                    onChange={event => updateBlock({
                      columnRatio: event.target.value as WechatSectionBlock["columnRatio"],
                    })}
                  >
                    <option value="1:1">1 : 1</option>
                    <option value="1:2">1 : 2</option>
                    <option value="2:1">2 : 1</option>
                  </select>
                </label>
              ) : null}
              {selectedBlock.layout === "media-text" ? (
                <label>
                  <span>媒体位置</span>
                  <select
                    value={selectedBlock.mediaPosition}
                    onChange={event => updateBlock({
                      mediaPosition: event.target.value as WechatSectionBlock["mediaPosition"],
                    })}
                  >
                    <option value="left">左侧</option>
                    <option value="right">右侧</option>
                  </select>
                </label>
              ) : null}
              {selectedBlock.layout === "grid" ? (
                <label>
                  <span>网格列数</span>
                  <select
                    value={selectedBlock.columns}
                    onChange={event => updateBlock({
                      columns: Number(event.target.value) as WechatSectionBlock["columns"],
                    })}
                  >
                    <option value={2}>两列</option>
                    <option value={3}>三列</option>
                  </select>
                </label>
              ) : null}
              <div className="wbe-property-grid">
                <label>
                  <span>视觉预设</span>
                  <select
                    value={selectedBlock.preset}
                    onChange={event => updateBlock({
                      preset: event.target.value as WechatSectionBlock["preset"],
                    })}
                  >
                    <option value="plain">无框留白</option>
                    <option value="soft">柔和底色</option>
                    <option value="feature">重点区域</option>
                    <option value="editorial">杂志卡片</option>
                    <option value="callout">提示区域</option>
                  </select>
                </label>
                <label>
                  <span>强调边</span>
                  <select
                    value={selectedBlock.accentStyle}
                    onChange={event => updateBlock({
                      accentStyle: event.target.value as WechatSectionBlock["accentStyle"],
                    })}
                  >
                    <option value="none">无</option>
                    <option value="top">顶部</option>
                    <option value="left">左侧</option>
                    <option value="bottom">底部</option>
                    <option value="tri-color">三色轨道</option>
                  </select>
                </label>
                <label>
                  <span>阴影</span>
                  <select
                    value={selectedBlock.shadow}
                    onChange={event => updateBlock({
                      shadow: event.target.value as WechatSectionBlock["shadow"],
                    })}
                  >
                    <option value="none">无阴影</option>
                    <option value="soft">柔和阴影</option>
                  </select>
                </label>
              </div>
              <label>
                <span>语义图标</span>
                <select
                  value={selectedBlock.icon?.kind === "lucide" ? selectedBlock.icon.name : "none"}
                  onChange={event => {
                    const name = event.target.value
                    updateBlock({
                      icon: name === "none" ? undefined : {
                        kind: "lucide",
                        name: name as WechatIconName,
                        color: selectedBlock.icon?.color || selectedBlock.accentColor,
                        size: selectedBlock.icon?.size || 24,
                        position: selectedBlock.icon?.position || "top-left",
                      },
                    })
                  }}
                >
                  <option value="none">无图标</option>
                  <option value="book-open">书本</option>
                  <option value="quote">引用</option>
                  <option value="lightbulb">灵感</option>
                  <option value="sparkles">亮点</option>
                  <option value="mic">采访</option>
                  <option value="trending-up">趋势</option>
                  <option value="check-circle">完成</option>
                  <option value="arrow-right">下一步</option>
                  <option value="bar-chart">数据</option>
                </select>
              </label>
              {selectedBlock.icon ? (
                <div className="wbe-property-grid">
                  <ColorField
                    label="图标颜色"
                    value={selectedBlock.icon.color}
                    fallback={selectedBlock.accentColor}
                    onChange={color => updateBlock({
                      icon: selectedBlock.icon ? { ...selectedBlock.icon, color } : undefined,
                    })}
                  />
                  <NumberField
                    label="图标大小"
                    value={selectedBlock.icon.size}
                    min={14}
                    max={64}
                    onChange={size => updateBlock({
                      icon: selectedBlock.icon ? { ...selectedBlock.icon, size } : undefined,
                    })}
                  />
                </div>
              ) : null}
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
              <SurfaceFields
                value={selectedBlock.surfaceStyle}
                fallback={selectedBlock.background}
                onChange={surfaceStyle => updateBlock({ surfaceStyle })}
              />
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
                      <option value="lede">杂志导语</option>
                      <option value="overline">眉题</option>
                      <option value="metric">数据强调</option>
                      <option value="dropcap">首字下沉</option>
                    </select>
                  </label>
                  <div className="wbe-property-grid">
                    <ColorField label="文字" value={selectedSectionText.color} fallback="#262626" onChange={color => updateSectionItemStyle({ color })} />
                    <ColorField label="背景" value={selectedSectionText.background} fallback="#ffffff" onChange={background => updateSectionItemStyle({ background })} />
                    <ColorField label="强调色" value={selectedSectionText.accentColor} fallback="#5263a5" onChange={accentColor => updateSectionItemStyle({ accentColor })} />
                    <ColorField label="边框" value={selectedSectionText.borderColor} fallback="#dee0e3" onChange={borderColor => updateSectionItemStyle({ borderColor })} />
                    <NumberField label="字号" value={selectedSectionText.fontSize} min={12} max={48} onChange={fontSize => updateSectionItemStyle({ fontSize })} />
                    <NumberField label="字重" value={selectedSectionText.fontWeight} min={300} max={900} step={100} onChange={fontWeight => updateSectionItemStyle({ fontWeight })} />
                    <NumberField label="字距" value={selectedSectionText.letterSpacing} min={0} max={8} step={0.5} onChange={letterSpacing => updateSectionItemStyle({ letterSpacing })} />
                    <NumberField label="行高" value={selectedSectionText.lineHeight} min={1} max={2.6} step={0.1} onChange={lineHeight => updateSectionItemStyle({ lineHeight })} />
                    <NumberField label="首行缩进" value={selectedSectionText.textIndent} min={0} max={64} onChange={textIndent => updateSectionItemStyle({ textIndent })} />
                    <NumberField label="内边距" value={selectedSectionText.padding} min={0} max={48} onChange={padding => updateSectionItemStyle({ padding })} />
                    <NumberField label="圆角" value={selectedSectionText.radius} min={0} max={32} onChange={radius => updateSectionItemStyle({ radius })} />
                    <NumberField label="边框" value={selectedSectionText.borderWidth} min={0} max={8} onChange={borderWidth => updateSectionItemStyle({ borderWidth })} />
                    <NumberField label="上间距" value={selectedSectionText.marginTop} min={0} max={80} onChange={marginTop => updateSectionItemStyle({ marginTop })} />
                    <NumberField label="下间距" value={selectedSectionText.marginBottom} min={0} max={80} onChange={marginBottom => updateSectionItemStyle({ marginBottom })} />
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
