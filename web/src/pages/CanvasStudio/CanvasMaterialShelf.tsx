import { useState } from "react"
import { fetchCanvasLibraryImages } from "../../utils/apiHelpers"
import { CANVAS_MATERIALS, type CanvasMaterialId, type CanvasLibraryImage } from "../../../shared/canvasMaterialLibrary"

interface CanvasMaterialShelfProps {
  disabled: boolean
  onInsert: (id: CanvasMaterialId | undefined, image?: CanvasLibraryImage) => void
}

export default function CanvasMaterialShelf({ disabled, onInsert }: CanvasMaterialShelfProps) {
  // 原图源属于文章正文；图库加载状态单独保存，避免筛选结果改写正文源。
  const [images, setImages] = useState<CanvasLibraryImage[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const load = async () => {
    if (loading) return
    setLoading(true)
    setError("")
    try { setImages(await fetchCanvasLibraryImages()) }
    catch { setError("图库读取失败，请重试") }
    finally { setLoading(false) }
  }
  return <><details className="cs-material-shelf">
    <summary>装饰素材库 <span>原创水彩 · 插在选中内容之后</span></summary>
    <div className="cs-material-grid">
      {CANVAS_MATERIALS.map(material => <button key={material.id} disabled={disabled} onClick={() => onInsert(material.id)}>
        <img src={material.src} alt="" /><strong>{material.name}</strong><small>{material.category}</small>
      </button>)}
    </div>
  </details>
    <details className="cs-material-shelf" onToggle={event => {
      if (event.currentTarget.open && images === null && !loading) void load()
    }}>
      <summary>照片与插画库 <span>已有图片 · 按名称筛选</span></summary>
      <input aria-label="筛选图库图片" placeholder="搜索图片名称" value={query} onChange={event => setQuery(event.target.value)} />
      {loading ? <p role="status">正在读取图库…</p> : null}
      {error ? <p role="alert">{error} <button onClick={() => void load()}>重试</button></p> : null}
      {images?.length === 0 ? <p>图库中还没有可用图片；可以先在文章中上传图片。</p> : null}
      <div className="cs-material-grid">
        {images?.filter(image => image.title.toLowerCase().includes(query.trim().toLowerCase())).map(image =>
          <button key={image.url} disabled={disabled} onClick={() => onInsert(undefined, image)}>
            <img src={image.url} alt="" loading="lazy" /><strong>{image.title}</strong><small>插入照片</small>
          </button>)}
      </div>
    </details></>
}
