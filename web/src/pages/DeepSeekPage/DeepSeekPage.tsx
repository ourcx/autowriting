import { useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import PageHeader from "../../components/PageHeader/PageHeader"
import { appendArticleMaterials, deepSeekRequest, fetchArticleList, formatDeepSeekResearch, type DeepSeekChatResponse, type DeepSeekOperation } from "../../utils/apiHelpers"
import { articleEditorUrl } from "../../utils/articleNavigation"
import "./DeepSeekPage.css"

const modes: Array<[DeepSeekOperation, string]> = [["chat", "思考与文件问答"], ["search", "联网搜索"], ["fetch", "阅读链接"], ["ocr", "文档 OCR"], ["asr", "语音转文字"], ["tts", "文字朗读"]]
export default function DeepSeekPage() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [mode, setMode] = useState<DeepSeekOperation>("chat")
  const [text, setText] = useState("")
  const [file, setFile] = useState<File>()
  const [purpose, setPurpose] = useState("text_recognition")
  const [thinking, setThinking] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [readUrl, setReadUrl] = useState(false)
  const [voice, setVoice] = useState("stella")
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<Record<string, unknown>>()
  const [resultUrl, setResultUrl] = useState("")
  const [audio, setAudio] = useState("")
  const [articles, setArticles] = useState<Array<{ id: string; title: string }>>([])
  const [articleId, setArticleId] = useState("")
  const [saving, setSaving] = useState(false)
  const [savedArticleId, setSavedArticleId] = useState("")
  const [articleError, setArticleError] = useState("")
  const controller = useRef<AbortController>()
  const locked = useRef(false)
  useEffect(() => {
    const abort = new AbortController()
    deepSeekRequest("status", undefined, abort.signal).then(value => {
      if (!(value instanceof Blob)) { setReady(value.enabled === true && value.configured === true); setLoaded(true) }
    }).catch(reason => { if (!abort.signal.aborted) { setError(String(reason)); setLoaded(true) } })
    return () => { abort.abort(); controller.current?.abort() }
  }, [])
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio) }, [audio])
  useEffect(() => {
    let active = true
    fetchArticleList().then(list => { if (active) setArticles(list) })
      .catch(() => { if (active) setArticleError("文章列表加载失败，请刷新后重试") })
    return () => { active = false }
  }, [])
  function cancel() { controller.current?.abort(); locked.current = false; setBusy(false) }
  async function run() {
    if (locked.current || saving || !ready || !consent) return
    locked.current = true; setSavedArticleId(""); setBusy(true); setError(""); setResult(undefined); setAudio("")
    const abort = new AbortController(); controller.current = abort
    try {
      const fields: Record<string, unknown> = { confirmedCost: true }
      if (mode === "chat") Object.assign(fields, { prompt: text, thinking, webSearch, readUrl, ...(file ? { purpose } : {}) })
      if (mode === "search") fields.query = text
      if (mode === "fetch") fields.url = text
      if (mode === "tts") Object.assign(fields, { text, voice })
      if (mode === "ocr") fields.purpose = purpose
      let body: Record<string, unknown> | FormData = fields
      if ((mode === "chat" && file) || mode === "ocr" || mode === "asr") {
        if (!file) throw new Error("请先选择文件")
        if (!file.size || file.size > (mode === "asr" ? 8 : 32) * 1024 * 1024) throw new Error(mode === "asr" ? "音频必须为 1 字节至 8 MiB" : "文件必须为 1 字节至 32 MiB")
        if (mode === "asr" && !/\.(wav|ogg)$/i.test(file.name)) throw new Error("语音仅支持 .wav 或 .ogg 文件")
        const form = new FormData()
        Object.entries(fields).forEach(([key, value]) => form.append(key, String(value)))
        form.append("file", file); body = form
      }
      const value = await deepSeekRequest(mode, body, abort.signal)
      if (abort.signal.aborted) return
      if (value instanceof Blob) setAudio(URL.createObjectURL(value)); else { setResult(value); setResultUrl(mode === "fetch" ? text.trim() : "") }
    } catch (reason) { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (controller.current === abort) { locked.current = false; setBusy(false) } }
  }
  const output = result ? String(result.content ?? result.text ?? "") : ""
  const citations = result && Array.isArray(result.annotations) ? result.annotations : []
  const results = result && Array.isArray(result.results) ? result.results : []
  const savedArticle = articles.find(article => article.id === savedArticleId)
  const canSave = Boolean(output.trim() || results.length)
  async function saveResult() {
    if (!articleId || !canSave || saving || savedArticleId) return
    setSaving(true)
    setArticleError("")
    try {
      const sources = results.flatMap(item => {
        const row = item as { url?: string; title?: string; snippet?: string; summary?: string }
        return row.url && /^https?:\/\//i.test(row.url)
          ? [`#### ${row.title || row.url}\n${row.url}\n\n${row.snippet || row.summary || ""}`] : []
      })
      const content = output ? formatDeepSeekResearch(output, citations as DeepSeekChatResponse["annotations"]) : sources.join("\n\n")
      if (!content.trim()) throw new Error("没有可保存的素材")
      const sourceUrl = resultUrl ? `\n> ${resultUrl}` : ""
      await appendArticleMaterials(articleId, `### DeepSeek · ${modes.find(([id]) => id === mode)?.[1]}${sourceUrl}\n\n${content}`)
      setSavedArticleId(articleId)
    } catch (reason) {
      setArticleError(reason instanceof Error ? reason.message : "追加素材失败")
    } finally {
      setSaving(false)
    }
  }
  function links(items: unknown[]) {
    return items.map((item, index) => {
      if (!item || typeof item !== "object") return null
      const row = item as Record<string, unknown>
      const data = (row.url_citation || row) as Record<string, unknown>
      const url = String(data.url || "")
      return /^https?:\/\//i.test(url) ? <li key={index}><a href={url} target="_blank" rel="noopener noreferrer">{String(data.title || url)}</a><p>{String(data.snippet || data.summary || "")}</p></li> : null
    })
  }
  return <main className="deepseek-page">
    <PageHeader title="DeepSeek 工作台" subtitle="搜索、阅读、文件与语音，为写作准备素材" onBack={() => navigate("/settings")} />
    <section className="ds-notice">Token 与搜索、文件解析、语音等工具分别计费，单轮可能多次调用。具体费用以 DeepSeek 账单为准。取消等待不保证取消上游任务或免除费用。搜索结果和文本可手动追加到文章素材库。</section>
    {!ready && <p role="status">{loaded ? "功能未开启或未配置。请管理员在服务端设置 DEEPSEEK_APP_ENABLED=true 和 DEEPSEEK_API_KEY；不要在浏览器填写密钥。" : "正在检查服务状态…"}</p>}
    <label className="ds-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />我同意本次页面会话的操作将所填文字、链接及所选文件发送给 DeepSeek，并产生相应费用。</label>
    <fieldset disabled={busy || saving}>
      <label>功能<select value={mode} onChange={e => { setMode(e.target.value as DeepSeekOperation); setSavedArticleId(""); setPurpose("text_recognition"); setFile(undefined); setResult(undefined); setAudio(""); setError("") }}>{modes.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
      {mode !== "ocr" && mode !== "asr" && <label>{mode === "fetch" ? "公开网页 URL" : mode === "search" ? "搜索词（最多 128 字符）" : mode === "tts" ? "朗读文本" : "问题或写作要求"}<textarea value={text} onChange={e => setText(e.target.value)} rows={7} /></label>}
      {mode === "chat" && <div className="ds-options">{([[thinking, setThinking, "深度思考"], [webSearch, setWebSearch, "联网搜索"], [readUrl, setReadUrl, "阅读链接"]] as const).map(([value, set, title]) => <label key={title}><input type="checkbox" checked={value} onChange={e => set(e.target.checked)} />{title}</label>)}</div>}
      {(["chat", "ocr", "asr"].includes(mode)) && <label>{mode === "asr" ? "16-bit PCM WAV / Ogg Opus，≤8 MiB、120 秒（不支持 WebM）" : "文档或图片（≤32 MiB）"}<input key={mode} type="file" accept={mode === "asr" ? ".wav,.ogg" : ".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,.txt,.md,.csv,.xls,.xlsx"} onChange={e => setFile(e.target.files?.[0])} /></label>}
      {(mode === "chat" || mode === "ocr") && <label>解析方式<select value={purpose} onChange={e => setPurpose(e.target.value)}><option value="text_recognition">提取文本</option><option value="rich_layout_recognition">图文混排</option>{mode === "chat" && <option value="user_data">纯文本 / 表格</option>}</select></label>}
      {mode === "tts" && <label>音色<select value={voice} onChange={e => setVoice(e.target.value)}><option value="stella">Stella</option><option value="tide">Tide</option></select></label>}
    </fieldset>
    <button disabled={!ready || !consent || busy || saving} onClick={run}>{busy ? "处理中…" : "执行（产生 DeepSeek 费用）"}</button> {busy && <button onClick={cancel}>取消等待</button>}
    {error && <p role="alert">{error}</p>}
    {output && <section><h2>结果</h2><pre>{output}</pre></section>}
    {!!results.length && <ul>{links(results)}</ul>}{!!citations.length && <section><h2>引用来源</h2><ul>{links(citations)}</ul></section>}
    {canSave && <section className="ds-save">
      {articles.length ? <>
        <label>目标文章<select value={articleId} disabled={saving} onChange={event => { setArticleId(event.target.value); setSavedArticleId("") }}>
          <option value="">选择要追加素材的文章</option>
          {articles.map(article => <option key={article.id} value={article.id}>{article.title || article.id}</option>)}
        </select></label>
        <button disabled={!articleId || saving || Boolean(savedArticleId)} onClick={() => void saveResult()}>{saving ? "正在追加…" : "追加到素材库"}</button>
      </> : <p>创建文章后即可追加素材。</p>}
      {savedArticle && <p role="status">已追加到「{savedArticle.title || savedArticle.id}」。 <Link to={`${articleEditorUrl(savedArticle.id, { title: savedArticle.title })}?tab=materials`}>打开文章素材库</Link></p>}
      {articleError && <p role="alert">{articleError}</p>}
    </section>}
    {audio && <audio controls src={audio} />}
    {!!result?.usage && <details><summary>本次 Token / 工具用量（非金额）</summary><pre>{JSON.stringify(result.usage, null, 2)}</pre></details>}
  </main>
}
