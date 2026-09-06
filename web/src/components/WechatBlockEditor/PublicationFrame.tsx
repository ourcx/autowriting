import type { ReactNode } from "react"
import { getCanvasMaterial, type CanvasMaterialId } from "../../../shared/canvasMaterialLibrary"

export function PublicationMaterial({ id, width = "100%", height }: {
  id: CanvasMaterialId
  width?: number | string
  height?: number
}) {
  const material = getCanvasMaterial(id)
  if (!material) return null
  return <img src={material.src} alt="" aria-hidden="true" data-publication-material={id} data-wechat-material="true"
    style={{ display: "block", width, maxWidth: "100%", height: height || "auto", objectFit: id === "watercolor-rings" ? "fill" : "contain", margin: "0 auto" }} />
}

// 用正常文档流承载文字，装饰只占边缘空间；复制富文本后不依赖应用 CSS 或绝对定位。
export function PublicationFrame({ kind, border, children }: {
  kind: "notebook" | "photo" | "collage"
  border: string
  children: ReactNode
}) {
  return <section data-publication-frame={kind} style={{ margin: "28px 0 36px" }}>
    <section style={{ position: "relative", marginBottom: kind === "notebook" ? -24 : -32, lineHeight: 0 }}>
      <PublicationMaterial id={kind === "notebook" ? "watercolor-rings" : "watercolor-clip"}
        width={kind === "notebook" ? "94%" : 106} height={kind === "notebook" ? 62 : 92} />
    </section>
    <section style={{ background: "#ffffff", border: `1px solid ${border}`, padding: "38px 18px 12px", boxSizing: "border-box" }}>
      {children}
    </section>
  </section>
}
