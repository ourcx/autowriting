import { parentPort } from "node:worker_threads"
import { buildIndex } from "../rag.ts"
import type { AIConfig } from "../types.ts"

interface BuildRequest {
  id: string
  aiConfig: AIConfig
  userId?: string
}

const port = parentPort
if (!port) throw new Error("RAG 索引 worker 必须由主线程启动")

let queue = Promise.resolve()
port.on("message", (request: BuildRequest) => {
  queue = queue.then(async () => {
    try {
      const result = await buildIndex(request.aiConfig, request.userId, { atomic: true })
      port.postMessage({ id: request.id, result })
    } catch (error) {
      port.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
})
