import { useRef, useState } from "react"
import type { CanvasSource } from "../../../shared/canvasArticle"
import type { WechatBlockDocument } from "../../../shared/wechatBlockDsl"
import { WechatBlockRenderer } from "../../components/WechatBlockEditor/WechatBlockEditor"
import { extractErrorMessage, fetchXiumiReference, generateWechatBlockDocument } from "../../utils/apiHelpers"
import { loadAIConfig } from "../../utils/aiConfig"

interface CanvasLinkImportProps {
  sources: CanvasSource[]
  disabled: boolean
  onBusy: (busy: boolean) => void
  onApply: (document: WechatBlockDocument, reference: string, title: string) => void
}

export default function CanvasLinkImport({sources, disabled, onBusy, onApply}: CanvasLinkImportProps) {
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  // 预览是尚未应用的候选稿，不能共用画布历史，否则失败或取消也会改掉正文排版。
  const [preview, setPreview] = useState<{document: WechatBlockDocument; reference: string; title: string} | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const generate = async () => {
    setLoading(true); onBusy(true); setError(""); setPreview(null); setMessage("正在读取秀米样式…")
    try {
      const reference = await fetchXiumiReference(url.trim())
      setMessage(`已读取 ${reference.styleCount} 组样式，正在生成可编辑预览…`)
      const document = await generateWechatBlockDocument(
        "参考分享页的配色、字号与容器组合，为当前文章生成排版。保留当前文章全部内容；不要复制原模板的文字或图片。",
        sources, loadAIConfig(), setMessage,
        {templateId: "design-reference", designReference: reference.reference})
      setPreview({document, reference: reference.reference, title: reference.title})
      setMessage(`参考：${reference.title}。检查后应用到画布，可继续编辑和撤销。`)
    } catch (caught) {
      setError(extractErrorMessage(caught, "读取或生成失败，请重试"))
    } finally { setLoading(false); onBusy(false) }
  }
  return <section className="cs-link-import">
    <label htmlFor="xiumi-template-url">从秀米公开分享链接生成</label>
    <div className="cs-link-import-input">
      <input id="xiumi-template-url" type="url" placeholder="https://v.xiumi.us/board/v5/…" value={url}
        disabled={loading} onChange={event => {setUrl(event.target.value); setPreview(null)}} />
      <button type="button" disabled={disabled || loading || !sources.length || !url.trim()} onClick={() => void generate()}>生成模板预览</button>
    </div>
    <small>使用当前文章内容；仅支持公开分享页，需要已配置 AI。复杂动画和插画可能简化。</small>
    {loading ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {preview ? <>
      <p>{message}</p>
      <div className="cs-link-preview">
        <WechatBlockRenderer document={preview.document} sources={sources} selectedId={null} contentRef={previewRef} onSelect={() => {}} />
      </div>
      <button type="button" disabled={disabled} onClick={() => {onApply(preview.document, preview.reference, preview.title); setPreview(null)}}>应用此预览</button>
      <button type="button" onClick={() => setPreview(null)}>取消预览</button>
    </> : null}
  </section>
}
