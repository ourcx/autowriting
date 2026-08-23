import { PointerEvent, RefObject, useRef } from "react"
import type {
  CanvasDocument,
  CanvasMotifNode,
  CanvasNode,
  CanvasTextNode,
} from "../../../shared/canvasDsl"
import "./CanvasRenderer.css"

interface CanvasRendererProps {
  document: CanvasDocument
  selectedId?: string | null
  interactive?: boolean
  svgRef?: RefObject<SVGSVGElement>
  onSelect?: (id: string | null) => void
  onMove?: (id: string, x: number, y: number) => void
}

interface DragState {
  id: string
  offsetX: number
  offsetY: number
}

function wrapText(node: CanvasTextNode): string[] {
  const maxCharacters = Math.max(1, Math.floor(node.width / (node.fontSize * 0.92)))
  return node.text.split("\n").flatMap(paragraph => {
    if (!paragraph) return [""]
    const lines: string[] = []
    for (let index = 0; index < paragraph.length; index += maxCharacters) {
      lines.push(paragraph.slice(index, index + maxCharacters))
    }
    return lines
  })
}

function renderMotif(node: CanvasMotifNode) {
  if (node.motif === "dots") {
    const circles = Array.from({ length: 24 }, (_, index) => {
      const column = index % 6
      const row = Math.floor(index / 6)
      return (
        <circle
          key={index}
          cx={(column + 0.5) * node.width / 6}
          cy={(row + 0.5) * node.height / 4}
          r={Math.max(2, Math.min(node.width / 30, node.height / 20))}
          fill={node.fill}
        />
      )
    })
    return <g>{circles}</g>
  }
  if (node.motif === "arch") {
    return (
      <path
        d={`M 0 ${node.height} V ${node.height * 0.48} A ${node.width / 2} ${node.height * 0.48} 0 0 1 ${node.width} ${node.height * 0.48} V ${node.height} Z`}
        fill={node.fill}
        stroke={node.stroke}
        strokeWidth={node.strokeWidth}
      />
    )
  }
  if (node.motif === "spark") {
    return (
      <path
        d={`M ${node.width / 2} 0 L ${node.width * 0.62} ${node.height * 0.38} L ${node.width} ${node.height / 2} L ${node.width * 0.62} ${node.height * 0.62} L ${node.width / 2} ${node.height} L ${node.width * 0.38} ${node.height * 0.62} L 0 ${node.height / 2} L ${node.width * 0.38} ${node.height * 0.38} Z`}
        fill={node.fill}
        stroke={node.stroke}
        strokeWidth={node.strokeWidth}
      />
    )
  }
  if (node.motif === "frame") {
    return (
      <rect
        x={node.strokeWidth / 2}
        y={node.strokeWidth / 2}
        width={Math.max(0, node.width - node.strokeWidth)}
        height={Math.max(0, node.height - node.strokeWidth)}
        fill="none"
        stroke={node.stroke}
        strokeWidth={node.strokeWidth}
      />
    )
  }
  return (
    <path
      d={`M 0 ${node.height / 2} Q ${node.width * 0.25} 0 ${node.width / 2} ${node.height / 2} T ${node.width} ${node.height / 2}`}
      fill="none"
      stroke={node.stroke}
      strokeWidth={node.strokeWidth}
      strokeLinecap="round"
    />
  )
}

function renderNode(node: CanvasNode) {
  if (node.type === "text") {
    const lines = wrapText(node)
    const anchor = node.align === "center" ? "middle" : node.align === "right" ? "end" : "start"
    const textX = node.align === "center" ? node.width / 2 : node.align === "right" ? node.width : 0
    return (
      <text
        x={textX}
        y={node.fontSize}
        fill={node.fill}
        fontFamily='Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
        fontSize={node.fontSize}
        fontWeight={node.fontWeight}
        textAnchor={anchor}
      >
        {lines.map((line, index) => (
          <tspan key={`${node.id}-${index}`} x={textX} dy={index === 0 ? 0 : node.fontSize * node.lineHeight}>
            {line || " "}
          </tspan>
        ))}
      </text>
    )
  }
  if (node.type === "image") {
    const clipId = `canvas-clip-${node.id}`
    return (
      <>
        <defs>
          <clipPath id={clipId}>
            <rect width={node.width} height={node.height} rx={node.radius} />
          </clipPath>
        </defs>
        {node.src ? (
          <image
            href={node.src}
            width={node.width}
            height={node.height}
            preserveAspectRatio={node.fit === "contain" ? "xMidYMid meet" : "xMidYMid slice"}
            clipPath={`url(#${clipId})`}
          />
        ) : (
          <rect width={node.width} height={node.height} rx={node.radius} fill="#ebe6d6" />
        )}
      </>
    )
  }
  if (node.type === "shape") {
    if (node.shape === "ellipse") {
      return (
        <ellipse
          cx={node.width / 2}
          cy={node.height / 2}
          rx={node.width / 2}
          ry={node.height / 2}
          fill={node.fill}
          stroke={node.stroke}
          strokeWidth={node.strokeWidth}
        />
      )
    }
    return (
      <rect
        width={node.width}
        height={node.height}
        rx={node.radius}
        fill={node.fill}
        stroke={node.stroke}
        strokeWidth={node.strokeWidth}
      />
    )
  }
  return renderMotif(node)
}

export default function CanvasRenderer({
  document,
  selectedId,
  interactive = false,
  svgRef,
  onSelect,
  onMove,
}: CanvasRendererProps) {
  const internalRef = useRef<SVGSVGElement>(null)
  const activeRef = svgRef ?? internalRef
  const dragRef = useRef<DragState | null>(null)

  const pointFromEvent = (event: { clientX: number; clientY: number }) => {
    const svg = activeRef.current
    if (!svg) return { x: 0, y: 0 }
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const matrix = svg.getScreenCTM()?.inverse()
    return matrix ? point.matrixTransform(matrix) : point
  }

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || !onMove) return
    const point = pointFromEvent(event)
    onMove(drag.id, Math.round(point.x - drag.offsetX), Math.round(point.y - drag.offsetY))
  }

  return (
    <svg
      ref={activeRef}
      className="canvas-renderer"
      viewBox={`0 0 ${document.width} ${document.height}`}
      role="img"
      aria-label={document.name}
      onPointerMove={handlePointerMove}
      onPointerUp={() => { dragRef.current = null }}
      onPointerCancel={() => { dragRef.current = null }}
      onPointerLeave={() => { dragRef.current = null }}
      onPointerDown={event => {
        if (event.target === event.currentTarget) onSelect?.(null)
      }}
    >
      <rect width={document.width} height={document.height} fill={document.background} />
      {document.nodes.map(node => (
        <g
          key={node.id}
          className={interactive ? "canvas-renderer__node" : undefined}
          opacity={node.opacity}
          transform={`translate(${node.x} ${node.y}) rotate(${node.rotation} ${node.width / 2} ${node.height / 2})`}
          onPointerDown={event => {
            if (!interactive) return
            event.stopPropagation()
            const point = pointFromEvent(event)
            dragRef.current = { id: node.id, offsetX: point.x - node.x, offsetY: point.y - node.y }
            onSelect?.(node.id)
          }}
        >
          {renderNode(node)}
          {interactive && selectedId === node.id ? (
            <rect
              className="canvas-renderer__selection"
              x={-5}
              y={-5}
              width={node.width + 10}
              height={node.height + 10}
              fill="none"
              stroke="#0a0a0a"
              strokeWidth={2}
              strokeDasharray="8 6"
              pointerEvents="none"
            />
          ) : null}
        </g>
      ))}
    </svg>
  )
}
