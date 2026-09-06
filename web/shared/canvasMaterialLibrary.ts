// 原创素材只通过白名单 ID 引用，DSL 不接受任意 URL，也不依赖临时在线生图。
export const CANVAS_MATERIALS = [
  { id: "svg-bunting", name: "矢量彩旗", category: "节庆装饰", src: "/canvas-materials/svg-bunting.svg", ratio: "32 / 9" },
  { id: "svg-rings", name: "矢量活页环", category: "纸张边饰", src: "/canvas-materials/svg-rings.svg", ratio: "160 / 27" },
  { id: "svg-plane", name: "矢量纸飞机", category: "校园装饰", src: "/canvas-materials/svg-plane.svg", ratio: "12 / 5" },
  { id: "svg-leaf", name: "矢量枝叶", category: "自然装饰", src: "/canvas-materials/svg-leaf.svg", ratio: "8 / 3" },
  { id: "watercolor-bunting", name: "水彩彩旗与纸飞机", category: "章节装饰", src: "/canvas-materials/watercolor-bunting.png", ratio: "2 / 1" },
  { id: "watercolor-rings", name: "手绘活页环", category: "纸张边饰", src: "/canvas-materials/watercolor-rings.png", ratio: "3 / 1" },
  { id: "watercolor-clip", name: "心形夹板", category: "照片装饰", src: "/canvas-materials/watercolor-clip.png", ratio: "1 / 1" },
] as const

export type CanvasMaterialId = typeof CANVAS_MATERIALS[number]["id"]

export function getCanvasMaterial(id: unknown) {
  return CANVAS_MATERIALS.find(material => material.id === id)
}

export interface CanvasLibraryImage {
  url: string
  title: string
}

// 照片来自已有图库；只允许 HTTPS 或项目上传资源，不接受脚本、任意本地路径及内嵌文档。
export function parseCanvasLibraryImage(value: unknown): CanvasLibraryImage | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (typeof record.url !== "string" || record.url.length > 2048) return undefined
  const url = record.url.trim()
  const uploaded = /^\/api\/images\/uploads\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i.test(url)
  if (!uploaded) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return undefined
    } catch { return undefined }
  }
  return { url, title: typeof record.title === "string" ? record.title.slice(0, 160) : "图库图片" }
}
