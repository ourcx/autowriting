import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import { PassThrough } from "node:stream"
import { text } from "node:stream/consumers"
import type { NextFunction, Response } from "express"
import { AxiosError } from "axios"
import { BROWSER_MODEL_CHUNK, BROWSER_MODEL_HEADER, BROWSER_MODEL_RESPONSE_LIMIT, type BrowserModelJob } from "../shared/browserModel.ts"
import { startSseHeartbeat } from "./sseHeartbeat.ts"
import type { AuthedRequest } from "./types.ts"

type Job = (_frame: unknown) => boolean
interface Session {
  userId: string
  response: Response
  jobs: Map<string, Job>
  claimed: boolean
}
const sessions = new Map<string, Session>()
const scope = new AsyncLocalStorage<Session>()

export function openBrowserModelSession(userId: string, response: Response): void {
  if (sessions.size >= 64 || [...sessions.values()].filter(session => session.userId === userId).length >= 8) {
    response.status(429).json({ error: "当前生成任务过多，请稍后再试" })
    return
  }
  const id = randomUUID()
  const session = { userId, response, jobs: new Map<string, Job>(), claimed: false }
  sessions.set(id, session)
  const timer = setTimeout(() => response.end(), 12 * 60_000)
  response.once("close", () => {
    clearTimeout(timer)
    sessions.delete(id)
    for (const job of session.jobs.values()) job({ type: "disconnected" })
  })
  response.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  })
  response.flushHeaders()
  startSseHeartbeat(response)
  response.write(`data: ${JSON.stringify({ sessionId: id })}\n\n`)
}

export function bindBrowserModelSession(req: AuthedRequest, res: Response, next: NextFunction): void {
  const id = req.get(BROWSER_MODEL_HEADER)
  if (!id) { next(); return }
  const session = sessions.get(id)
  if (!session || session.userId !== req.user.id || (session.claimed && scope.getStore() !== session)) {
    res.status(409).json({ error: "浏览器模型连接已失效，请重试" })
    return
  }
  if (!session.claimed) {
    session.claimed = true
    res.once("close", () => session.response.end())
  }
  scope.run(session, next)
}

export function acceptBrowserModelFrame(userId: string, sessionId: string, jobId: string, frame: unknown): boolean {
  const session = sessions.get(sessionId)
  return Boolean(session?.userId === userId && session.jobs.get(jobId)?.(frame))
}

export function inBrowserModelSession(): boolean {
  return Boolean(scope.getStore())
}

export class BrowserModelError extends Error {}

export async function browserModelJson<T>(url: string, body: Record<string, unknown>, timeout: number, signal?: AbortSignal): Promise<T> {
  const stream = await requestBrowserModel(url, body, timeout, signal)
  try { return JSON.parse(await text(stream)) as T }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new BrowserModelError("浏览器收到的模型响应不是有效 JSON")
  }
}

export function requestBrowserModel(url: string, body: Record<string, unknown>, timeout: number, signal?: AbortSignal): Promise<PassThrough> {
  const session = scope.getStore()
  if (!session || session.response.writableEnded || session.response.destroyed || session.jobs.size >= 4) {
    return Promise.reject(new BrowserModelError("浏览器模型连接已断开，请重试"))
  }
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    let stream: PassThrough | undefined
    let received = 0
    const job: BrowserModelJob = { id, url, body, timeout }
    const finish = (error?: Error) => {
      session.jobs.delete(id)
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      if (stream) {
        if (error) stream.destroy(error)
        else stream.end()
      } else reject(error || new BrowserModelError("浏览器未收到模型响应"))
    }
    const abort = () => finish(new BrowserModelError("浏览器模型请求已取消"))
    const timer = setTimeout(() => finish(new BrowserModelError("浏览器访问模型超时")), timeout + 2000)
    signal?.addEventListener("abort", abort, { once: true })
    session.jobs.set(id, frame => {
      if (!frame || typeof frame !== "object") return false
      const { type, status, chunk } = frame as { type: unknown; status?: unknown; chunk?: unknown }
      if (type === "timeout") {
        finish(new BrowserModelError("浏览器访问模型超时"))
      } else if (type === "disconnected" || type === "failed") {
        finish(new BrowserModelError(type === "failed"
          ? "浏览器无法读取模型响应，请检查浏览器网络或模型地址"
          : "浏览器模型连接已断开，请重试"))
      } else if (type === "status" && !stream && typeof status === "number" && Number.isInteger(status) && status >= 200 && status <= 599) {
        if (status >= 300) {
          const error = new AxiosError(`浏览器模型请求失败（HTTP ${status}）`)
          error.response = { status } as NonNullable<AxiosError["response"]>
          finish(error)
        } else {
          stream = new PassThrough()
          // 在消费者开始读取前断线时，保留流的错误状态以供消费者读取。
          stream.on("error", () => {})
          resolve(stream)
        }
      } else if (type === "chunk" && stream && typeof chunk === "string" && chunk.length <= BROWSER_MODEL_CHUNK) {
        received += Buffer.byteLength(chunk)
        if (received > BROWSER_MODEL_RESPONSE_LIMIT) finish(new BrowserModelError("浏览器模型响应过大"))
        else stream.write(chunk)
      } else if (type === "end" && stream) finish()
      else return false
      return true
    })
    session.response.write(`data: ${JSON.stringify(job)}\n\n`)
  })
}
