import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mapWithConcurrency } from "../server/utils/concurrency.ts"
import { replaceDirectoryAtomically } from "../server/utils/atomicDirectory.ts"
import { buildIndexInWorker, closeRagIndexWorker } from "../server/ragIndexWorker.ts"

let active = 0
let maxActive = 0
const order = await mapWithConcurrency([40, 10, 25, 5], 3, async (delay, index) => {
  active += 1
  maxActive = Math.max(maxActive, active)
  await new Promise(resolve => setTimeout(resolve, delay))
  active -= 1
  return index
})
assert.equal(maxActive, 3)
assert.deepEqual(order, [0, 1, 2, 3])

const directory = await mkdtemp(join(tmpdir(), "rag-index-swap-"))
const current = join(directory, "current")
const staging = join(directory, "staging")
await mkdir(current)
await mkdir(staging)
await writeFile(join(current, "version.txt"), "old")
await writeFile(join(staging, "version.txt"), "new")
replaceDirectoryAtomically(staging, current)
assert.equal(await readFile(join(current, "version.txt"), "utf8"), "new")
assert.throws(() => replaceDirectoryAtomically(join(directory, "missing"), current))
assert.equal(await readFile(join(current, "version.txt"), "utf8"), "new")
await rm(directory, { recursive: true, force: true })

const workerRoot = await mkdtemp(join(tmpdir(), "rag-worker-"))
const workerUserId = "worker-smoke"
const articleDirectory = join(workerRoot, "drafts", workerUserId, "20260917-worker", "raw")
await mkdir(articleDirectory, { recursive: true })
await writeFile(join(articleDirectory, "article_raw.md"), "# Worker 测试文章\n\n这是一段用于验证索引在独立线程内构建的正文。".repeat(8))
process.env.DRAFTS_DIR = join(workerRoot, "drafts")
process.env.DATA_DIR = join(workerRoot, "data")

const embeddingServer = createServer((request, response) => {
  request.resume()
  response.writeHead(200, { "Content-Type": "application/json" })
  response.end(JSON.stringify({ data: [{ embedding: [1, 0, 0] }] }))
})
await new Promise<void>(resolve => embeddingServer.listen(0, "127.0.0.1", resolve))
const address = embeddingServer.address()
if (!address || typeof address === "string") throw new Error("Embedding 测试服务启动失败")
try {
  const result = await buildIndexInWorker({
    embeddingApiKey: "worker-test",
    embeddingBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    embeddingModel: "fixture",
    embeddingBatchSize: 3,
    embeddingBatchDelayMs: 0,
  }, workerUserId)
  assert.equal(result.indexed, 1)
  assert.ok(result.chunks > 0)
  assert.equal(await readFile(join(workerRoot, "data", "rag_index_users", workerUserId, "index_meta.json"), "utf8").then(Boolean), true)
} finally {
  await closeRagIndexWorker()
  embeddingServer.closeAllConnections()
  await new Promise<void>(resolve => embeddingServer.close(() => resolve()))
  await rm(workerRoot, { recursive: true, force: true })
}

console.log("RAG worker 与受控并发测试通过")
