import { Collapse, SelectField, Textarea } from "../../components/FormControls/FormControls"
import { useEffect, useMemo, useRef, useState } from "react"
import type { ClipboardEvent } from "react"
import { Copy, ExternalLink, Eye, LayoutTemplate, Send } from "lucide-react"
import Button from "../../components/Button/Button"
import { toast } from "../../components/Toast/Toast"
import { renderWechatMarkdown } from "../../utils/wechatMarkdown"
import { buildWechatStyledHtml, copyWechatHtml } from "../../utils/wechatBlockExport"
import { BUILTIN_TEMPLATES } from "../../utils/templateStore"
import { sanitizeHtml } from "../../utils/sanitizeHtml"
import { localizeXiumiHtml } from "../../utils/xiumiHtml"

const XIUMI_ORIGIN = "https://xiumi.us"
const XIUMI_EDITOR_URL = `${XIUMI_ORIGIN}/studio/v5#/paper`

interface XiumiEditorProps {
  articleId: string
  article: string
  title: string
  pushing: boolean
  onPush: (html: string) => Promise<void>
}

export default function XiumiEditor({ articleId, article, title, pushing, onPush }: XiumiEditorProps) {
  // 官方插件没有正文写入或回读接口：秀米负责编辑，本机只保存回传的排版。
  const storageKey = `xiumi-article-html-v1:${articleId}`
  const [html, setHtml] = useState(() => {
    try { return sanitizeHtml(localStorage.getItem(storageKey) || "") }
    catch { return "" }
  })
  const [view, setView] = useState<"editor" | "saved" | "template">(html ? "saved" : "editor")
  const [templateId, setTemplateId] = useState("lime-gazette")
  const [pendingHtml, setPendingHtml] = useState("")
  const [importing, setImporting] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const importRef = useRef(false)
  const mountedRef = useRef(true)
  const imageCache = useRef(new Map<string, string>())
  const receiverRef = useRef<(content: string) => void>(() => {})
  const template = BUILTIN_TEMPLATES.find(item => item.id === templateId)
  const sourceHtml = useMemo(() => {
    const rendered = renderWechatMarkdown(article)
    return !title || /^<h1[\s>]/i.test(rendered.trim())
      ? rendered : `${renderWechatMarkdown(`# ${title}`)}${rendered}`
  }, [article, title])
  const buildTemplateHtml = () => buildWechatStyledHtml(sourceHtml, template?.css || "")

  const receiveHtml = async (content: string) => {
    if (importRef.current || pushing) return
    if (content.length > 5_242_880 || !/<[a-z][\s\S]*>/i.test(content)) {
      toast.warn("请从秀米复制排版后的图文内容")
      return
    }
    const cleanHtml = sanitizeHtml(content)
    if (!cleanHtml.trim()) return
    importRef.current = true
    setImporting(true)
    setPendingHtml(cleanHtml)
    try {
      const localized = await localizeXiumiHtml(cleanHtml, imageCache.current)
      if (!mountedRef.current) return
      // 转存和保存都成功后才替换旧排版，正文及旧画布数据不受影响。
      localStorage.setItem(storageKey, localized)
      setHtml(localized)
      setPendingHtml("")
      setView("saved")
      toast.success("秀米排版已保存到本机")
    } catch {
      if (mountedRef.current) toast.error("图片转存或本机保存失败，请重试；上一次排版已保留")
    } finally {
      importRef.current = false
      if (mountedRef.current) setImporting(false)
    }
  }

  useEffect(() => {
    receiverRef.current = content => { void receiveHtml(content) }
  })

  useEffect(() => {
    mountedRef.current = true
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== XIUMI_ORIGIN || event.source !== iframeRef.current?.contentWindow
        || typeof event.data !== "string" || !event.data.trim().startsWith("<")) return
      receiverRef.current(event.data)
    }
    window.addEventListener("message", onMessage)
    return () => {
      mountedRef.current = false
      window.removeEventListener("message", onMessage)
    }
  }, [])

  const copyContent = async (content: string) => {
    try {
      const text = new DOMParser().parseFromString(content, "text/html").body.textContent || ""
      await copyWechatHtml(content, text)
      toast.success("已复制，可粘贴到秀米或公众号编辑器")
    } catch {
      toast.error("复制失败，请允许浏览器访问剪贴板后重试")
    }
  }

  const pasteContent = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    receiverRef.current(event.clipboardData.getData("text/html")
      || event.clipboardData.getData("text/plain"))
  }

  return (
    <section className="cs-xiumi">
      <div className="cs-xiumi-templates">
        <label>
          <LayoutTemplate size={15} />
          <span>默认模板</span>
          <SelectField aria-label="选择秀米画布默认模板" value={templateId}
            disabled={importing || pushing} onChange={event => {
              setTemplateId(event.target.value)
              setView("template")
            }}>
            <option value="">不套模板</option>
            {BUILTIN_TEMPLATES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </SelectField>
        </label>
        <Button variant="secondary" disabled={!article || importing || pushing} onClick={() => setView("template")}>
          <Eye size={14} />预览模板
        </Button>
        <Button variant="secondary" disabled={!article || importing || pushing}
          onClick={() => void receiveHtml(buildTemplateHtml())}>
          <LayoutTemplate size={14} />用正文生成排版
        </Button>
        <span>{template?.desc || "保留正文结构，不添加模板装饰"}</span>
      </div>
      <div className="cs-edit-bar">
        <div className="cs-edit-actions">
          <Button variant="secondary" disabled={!article || importing || pushing}
            onClick={() => void copyContent(buildTemplateHtml())}>
            <Copy size={14} />复制模板正文到秀米
          </Button>
          <a className="cs-xiumi-link" href={XIUMI_EDITOR_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} />新窗口打开秀米
          </a>
        </div>
        <div className="cs-edit-actions">
          {(html || view === "template") && <Button variant="secondary" disabled={importing || pushing}
            onClick={() => setView(view === "editor" && html ? "saved" : "editor")}>
            <Eye size={14} />{view === "editor" ? "查看已保存排版" : "返回秀米编辑"}
          </Button>}
          <Button variant="secondary" disabled={!html || importing || pushing || !!pendingHtml} onClick={() => void copyContent(html)}>
            <Copy size={14} />复制已保存排版
          </Button>
          <Button variant="primary" disabled={!html || importing || pushing || !!pendingHtml} onClick={() => void onPush(html)}>
            <Send size={14} />{pushing ? "推送中..." : "推送已保存排版"}
          </Button>
        </div>
      </div>
      <div className="cs-xiumi-help">
        <p>选择模板后，可用当前正文生成排版并保存，也可复制到秀米继续编辑。秀米编辑完成后，点击顶部对勾传回。</p>
        <Collapse label={<>登录或回传遇到问题？新窗口排版后粘贴到这里</>}>
          <p>请通过 HTTPS 访问平台，并允许秀米登录所需的第三方 Cookie。新窗口排版完成后，点击秀米对勾复制，再粘贴到下方。</p>
          <Textarea aria-label="粘贴秀米排版" placeholder="在此粘贴秀米图文，自动保存排版与图片"
            readOnly disabled={importing || pushing} onPaste={pasteContent} />
        </Collapse>
        <div role="status">
          {importing ? "正在转存图片并保存排版，请暂勿切换文章或离开页面…" : pendingHtml ? (
            <Button variant="secondary" disabled={pushing} onClick={() => void receiveHtml(pendingHtml)}>重试保存秀米排版</Button>
          ) : html ? "已保存到本机；推送使用最近一次传回的排版。" : "排版完成后传回，即可保存并推送微信草稿。"}
        </div>
      </div>
      <iframe ref={iframeRef} className="cs-xiumi-frame" title="秀米图文编辑器" hidden={view !== "editor"}
          src={XIUMI_EDITOR_URL} allow="clipboard-read; clipboard-write"
          onLoad={() => iframeRef.current?.contentWindow?.postMessage("XIUMI:3rdEditor:Connect", XIUMI_ORIGIN)} />
      {view === "template" && (
        <iframe className="cs-xiumi-frame cs-xiumi-preview" title="默认模板预览" sandbox=""
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{max-width:677px;margin:0 auto;background:#fff}img{max-width:100%}${template?.css || ""}</style></head><body><section id="wemd">${sourceHtml}</section></body></html>`} />
      )}
      {view === "saved" && (
        <iframe className="cs-xiumi-frame cs-xiumi-preview" title="已保存的秀米排版" sandbox=""
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{max-width:677px;margin:24px auto;padding:0 16px;overflow-wrap:break-word}img{max-width:100%}</style></head><body>${html}</body></html>`} />
      )}
    </section>
  )
}
