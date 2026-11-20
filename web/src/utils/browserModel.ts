import {
  BROWSER_MODEL_CHUNK, BROWSER_MODEL_HEADER, BROWSER_MODEL_PATH,
  browserArticleEndpoint, browserEmbeddingEndpoint, isStabilityCoverEndpoint, OPENAI_IMAGE_ENDPOINT, type BrowserModelJob,
} from "../../shared/browserModel"

type BrowserModelConfig = Record<string, unknown>
type BrowserModelHeaders = Record<string, string>
type BrowserEndpoint = { matches: (_url: string) => boolean; key: string; extraHeaders?: HeadersInit }

export function browserArticleModel(config: BrowserModelConfig): BrowserEndpoint[] {
  const url = browserArticleEndpoint(config.articleProvider, config.articleBaseUrl)
  const key = textKey(config.articleApiKey)
  const embedding = browserEmbeddingModel(config)
  return [...(url && key ? [{ matches: (target: string) => target === url, key }] : []), ...embedding]
}

function textKey(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function browserEmbeddingModel(config: BrowserModelConfig): BrowserEndpoint[] {
  const url = browserEmbeddingEndpoint(config)
  const key = textKey(config.embeddingApiKey) || textKey(config.articleApiKey) || textKey(config.coverApiKey)
  let extraHeaders: HeadersInit | undefined
  if (typeof config.embeddingExtraHeaders === "string" && config.embeddingExtraHeaders) {
    try { extraHeaders = new Headers(JSON.parse(config.embeddingExtraHeaders)) }
    catch { /* 与服务端相同，忽略无效的附加请求头。 */ }
  }
  return url && key ? [{ matches: target => target === url, key, extraHeaders }] : []
}

export function browserCoverModel(provider: unknown, config: BrowserModelConfig): BrowserEndpoint[] {
  const coverKey = textKey(config.coverApiKey)
  if (provider === "openai" || provider === "gpt-image") {
    const officialArticle = browserArticleEndpoint(config.articleProvider, config.articleBaseUrl) === "https://api.openai.com/v1/chat/completions"
    const key = provider === "gpt-image" && officialArticle && !["openai", "gpt-image"].includes(String(config.coverProvider))
      ? textKey(config.articleApiKey) : coverKey || textKey(config.articleApiKey)
    if (key) return [{ matches: target => target === OPENAI_IMAGE_ENDPOINT, key }]
  }
  if (provider === "stability" && coverKey) {
    return [{ matches: isStabilityCoverEndpoint, key: coverKey, extraHeaders: { Accept: "application/json" } }]
  }
  return []
}

const pending: Array<() => void> = []
let activeSessions = 0

function waitForBrowserModelSlot(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (activeSessions < 2) {
    activeSessions++
    return Promise.resolve()
  }
  // HTTP/1.1 下每个任务占两个长连接，给回传模型片段和页面操作留出连接。
  return new Promise((resolve, reject) => {
    const ready = () => {
      signal?.removeEventListener("abort", abort)
      resolve()
    }
    const abort = () => {
      const index = pending.indexOf(ready)
      if (index !== -1) pending.splice(index, 1)
      reject(signal?.reason)
    }
    pending.push(ready)
    signal?.addEventListener("abort", abort, { once: true })
  })
}

export async function withBrowserModel<T>(
  endpoints: BrowserEndpoint[], signal: AbortSignal | undefined, run: (headers: BrowserModelHeaders) => Promise<T>,
): Promise<T> {
  if (!endpoints.length) return run({})
  await waitForBrowserModelSlot(signal)
  try {
    return await runBrowserModel(endpoints, signal, run)
  } finally {
    const next = pending.shift()
    if (next) next()
    else activeSessions--
  }
}

async function runBrowserModel<T>(
  endpoints: BrowserEndpoint[], signal: AbortSignal | undefined, run: (headers: BrowserModelHeaders) => Promise<T>,
): Promise<T> {
  const token = localStorage.getItem("auth_token")
  if (!token) throw new Error("请登录后使用浏览器模型")
  const controller = new AbortController()
  const active = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const auth = { Authorization: `Bearer ${token}` }
  const response = await fetch(`${BROWSER_MODEL_PATH}/open`, {
    method: "POST", headers: auth, signal: active,
  })
  if (!response.ok || !response.body) {
    throw new Error(`无法打开浏览器模型连接（HTTP ${response.status}）`)
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  const readMessage = async (): Promise<unknown> => {
    while (true) {
      const boundary = buffer.indexOf("\n\n")
      if (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        if (block.startsWith("data: ")) return JSON.parse(block.slice(6)) as unknown
        continue
      }
      const { value, done } = await reader.read()
      if (done) return null
      buffer += value
    }
  }

  try {
    const ready = await readMessage() as { sessionId?: string } | null
    if (!ready?.sessionId) throw new Error("浏览器模型连接初始化失败")
    const relayPath = `${BROWSER_MODEL_PATH}/${encodeURIComponent(ready.sessionId)}`
    const relay = async () => {
      while (!active.aborted) {
        const job = await readMessage() as BrowserModelJob | null
        if (!job) break
        void forwardBrowserModel(endpoints, job, relayPath, auth, active)
      }
    }
    // 生成工作流自己接收服务端的中断错误，避免覆盖已经落盘的候选稿状态。
    void relay().catch(() => controller.abort())
    return await run({ [BROWSER_MODEL_HEADER]: ready.sessionId })
  } finally {
    controller.abort()
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function forwardBrowserModel(
  endpoints: BrowserEndpoint[], job: BrowserModelJob, relayPath: string, auth: BrowserModelHeaders, session: AbortSignal,
): Promise<void> {
  const send = async (frame: Record<string, unknown>) => {
    const response = await fetch(`${relayPath}/${encodeURIComponent(job.id)}`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(frame), signal: session,
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  }
  const deadline = AbortSignal.timeout(job.timeout)
  try {
    // 服务端只能提交消息和模型参数。凭据只发给浏览器配置中已确定的目标。
    const endpoint = endpoints.find(candidate => candidate.matches(job.url))
    if (!endpoint) throw new Error("模型地址不匹配")
    const headers = new Headers({ Authorization: `Bearer ${endpoint.key}`, "Content-Type": "application/json" })
    new Headers(endpoint.extraHeaders).forEach((value, header) => headers.set(header, value))
    const response = await fetch(job.url, {
      method: "POST", credentials: "omit", redirect: "error",
      headers,
      body: JSON.stringify(job.body), signal: AbortSignal.any([session, deadline]),
    })
    await send({ type: "status", status: response.status })
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      return
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ""
    let lastSent = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        buffer += value || ""
        if (done || buffer.length >= BROWSER_MODEL_CHUNK || Date.now() - lastSent >= 1000) {
          while (buffer) {
            let end = Math.min(buffer.length, BROWSER_MODEL_CHUNK)
            const tail = buffer.charCodeAt(end - 1)
            if (end < buffer.length && tail >= 0xd800 && tail <= 0xdbff) end--
            await send({ type: "chunk", chunk: buffer.slice(0, end) })
            buffer = buffer.slice(end)
          }
          lastSent = Date.now()
        }
        if (done) break
      }
      await send({ type: "end" })
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } catch {
    if (!session.aborted) await send({ type: deadline.aborted ? "timeout" : "failed" }).catch(() => {})
  }
}
