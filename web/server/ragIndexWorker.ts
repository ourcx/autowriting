import { randomUUID } from "node:crypto"
import { Worker } from "node:worker_threads"
import type { AIConfig } from "./types.ts"

export interface RagIndexBuildResult {
  indexed: number
  chunks: number
  dimensions?: number | string
  model?: string
  embedMode?: string
}

interface WorkerResponse {
  id: string
  result?: RagIndexBuildResult
  error?: string
}

interface PendingBuild {
  resolve: (_result: RagIndexBuildResult) => void
  reject: (_error: Error) => void
}

let worker: Worker | null = null
const pending = new Map<string, PendingBuild>()

function rejectPending(message: string): void {
  for (const request of pending.values()) request.reject(new Error(message))
  pending.clear()
}

function getWorker(): Worker {
  if (worker) return worker

  const nextWorker = new Worker(new URL("./workers/ragIndexWorker.ts", import.meta.url), {
    execArgv: process.execArgv,
  })
  nextWorker.on("message", (message: WorkerResponse) => {
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error))
    else if (message.result) request.resolve(message.result)
    else request.reject(new Error("RAG 索引 worker 返回了空结果"))
    if (pending.size === 0) nextWorker.unref()
  })
  nextWorker.on("error", (error) => {
    rejectPending(`RAG 索引 worker 异常：${error instanceof Error ? error.message : String(error)}`)
  })
  nextWorker.on("exit", (code) => {
    if (worker === nextWorker) worker = null
    if (code !== 0) rejectPending(`RAG 索引 worker 已退出（code ${code}）`)
  })
  nextWorker.unref()
  worker = nextWorker
  return nextWorker
}

export function buildIndexInWorker(aiConfig: AIConfig, userId?: string): Promise<RagIndexBuildResult> {
  const id = randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try {
      const current = getWorker()
      current.ref()
      current.postMessage({ id, aiConfig, userId })
    } catch (error) {
      pending.delete(id)
      reject(error)
    }
  })
}

export async function closeRagIndexWorker(): Promise<void> {
  const current = worker
  worker = null
  if (!current) return
  rejectPending("RAG 索引 worker 已关闭")
  await current.terminate()
}
