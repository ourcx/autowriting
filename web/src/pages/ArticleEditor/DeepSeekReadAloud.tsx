import { useEffect, useRef, useState } from "react"
import { Volume2 } from "lucide-react"
import { deepSeekRequest, extractErrorMessage } from "../../utils/apiHelpers"

interface DeepSeekReadAloudProps {
  content: string
}

export default function DeepSeekReadAloud({ content }: DeepSeekReadAloudProps) {
  const [audio, setAudio] = useState<{ url: string; content: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [content])
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio.url) }, [audio])

  async function read() {
    if (busy || !window.confirm("将当前公众号正文发送给 DeepSeek 生成朗读音频，并按字符计费。继续吗？")) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError("")
    setAudio(undefined)
    try {
      const audio = await deepSeekRequest("tts", { text: content, confirmedCost: true }, controller.signal)
      if (!controller.signal.aborted) setAudio({ url: URL.createObjectURL(audio), content })
    } catch (error) {
      if (!controller.signal.aborted) setError(extractErrorMessage(error, "DeepSeek 朗读失败"))
    } finally {
      if (request.current === controller) {
        request.current = null
        setBusy(false)
      }
    }
  }

  return <div className="deepseek-read-aloud">
    <button type="button" className="materials-refine-btn" disabled={busy} onClick={() => void read()}>
      <Volume2 size={14} />{busy ? "正在生成音频…" : "DeepSeek 朗读公众号正文"}
    </button>
    {audio?.content === content && <audio controls src={audio.url} aria-label="公众号正文朗读" />}
    {error && <p role="alert">{error}</p>}
  </div>
}
