// 原创素材只通过白名单 ID 引用，DSL 不接受任意 URL，也不依赖临时在线生图。
export const CANVAS_MATERIALS = [
  { id: "lantern-pair", name: "双灯笼", category: "节庆装饰", src: "/canvas-materials/lantern-pair.svg", ratio: "8 / 3" },
  { id: "gift-box", name: "心意礼盒", category: "节庆装饰", src: "/canvas-materials/gift-box.svg", ratio: "8 / 3" },
  { id: "birthday-cake", name: "生日小蛋糕", category: "节庆装饰", src: "/canvas-materials/birthday-cake.svg", ratio: "8 / 3" },
  { id: "firework-stars", name: "烟花星点", category: "节庆装饰", src: "/canvas-materials/firework-stars.svg", ratio: "8 / 3" },
  { id: "book-stack", name: "书与书签", category: "阅读装饰", src: "/canvas-materials/book-stack.svg", ratio: "8 / 3" },
  { id: "reading-glasses", name: "阅读眼镜", category: "阅读装饰", src: "/canvas-materials/reading-glasses.svg", ratio: "8 / 3" },
  { id: "ink-quill", name: "羽毛笔", category: "阅读装饰", src: "/canvas-materials/ink-quill.svg", ratio: "8 / 3" },
  { id: "bookmark-ribbon", name: "书签分隔", category: "章节装饰", src: "/canvas-materials/bookmark-ribbon.svg", ratio: "8 / 3" },
  { id: "mountain-sun", name: "山间日出", category: "旅行装饰", src: "/canvas-materials/mountain-sun.svg", ratio: "8 / 3" },
  { id: "travel-suitcase", name: "旅行手提箱", category: "旅行装饰", src: "/canvas-materials/travel-suitcase.svg", ratio: "8 / 3" },
  { id: "heart-ending", name: "爱心结尾线", category: "结尾装饰", src: "/canvas-materials/heart-ending.svg", ratio: "8 / 3" },
  { id: "petal-ending", name: "花瓣留白线", category: "结尾装饰", src: "/canvas-materials/petal-ending.svg", ratio: "8 / 3" },

  { id: "olive-divider", name: "橄榄枝分隔", category: "自然装饰", src: "/canvas-materials/olive-divider.svg", ratio: "8 / 3" },
  { id: "daisy-divider", name: "雏菊花边", category: "自然装饰", src: "/canvas-materials/daisy-divider.svg", ratio: "8 / 3" },
  { id: "tulip-garden", name: "春日郁金香", category: "自然装饰", src: "/canvas-materials/tulip-garden.svg", ratio: "8 / 3" },
  { id: "open-book", name: "翻开的书页", category: "校园装饰", src: "/canvas-materials/open-book.svg", ratio: "8 / 3" },
  { id: "pencil-note", name: "铅笔与便签", category: "校园装饰", src: "/canvas-materials/pencil-note.svg", ratio: "8 / 3" },
  { id: "envelope-heart", name: "心意信封", category: "手账装饰", src: "/canvas-materials/envelope-heart.svg", ratio: "8 / 3" },
  { id: "washi-tape", name: "双色和纸胶带", category: "手账装饰", src: "/canvas-materials/washi-tape.svg", ratio: "8 / 3" },
  { id: "coffee-break", name: "咖啡小憩", category: "生活装饰", src: "/canvas-materials/coffee-break.svg", ratio: "8 / 3" },
  { id: "little-camera", name: "复古相机", category: "生活装饰", src: "/canvas-materials/little-camera.svg", ratio: "8 / 3" },
  { id: "star-divider", name: "星光分隔线", category: "章节装饰", src: "/canvas-materials/star-divider.svg", ratio: "8 / 3" },
  { id: "ribbon-banner", name: "庆祝缎带", category: "节庆装饰", src: "/canvas-materials/ribbon-banner.svg", ratio: "8 / 3" },
  { id: "moon-cloud", name: "月亮与云", category: "章节装饰", src: "/canvas-materials/moon-cloud.svg", ratio: "8 / 3" },

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
