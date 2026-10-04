import assert from "node:assert/strict"
import {
  hasArticleApiKey,
  resolveArticleApiKey,
  resolveEmbeddingApiKey,
  resolveZhipuApiKey,
} from "../server/utils/providerKeys.ts"
import {
  hasZhipuKnowledge,
  mapZhipuKnowledgeRows,
  normalizeKnowledgeIds,
} from "../server/utils/zhipuKnowledge.ts"

const shared = "zhipu-shared"

assert.equal(resolveZhipuApiKey({ zhipuApiKey: shared }), shared)
assert.equal(resolveZhipuApiKey({ zhipuApiKey: shared }, "search-override"), "search-override")
assert.equal(resolveArticleApiKey({ articleProvider: "zhipu", zhipuApiKey: shared }), shared)
assert.equal(resolveArticleApiKey({ articleProvider: "openai", zhipuApiKey: shared }), "")
assert.equal(resolveArticleApiKey({ articleProvider: "openai", articleApiKey: "openai-key", zhipuApiKey: shared }), "openai-key")
assert.equal(resolveEmbeddingApiKey({
  embeddingBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  embeddingModel: "embedding-3",
  zhipuApiKey: shared,
}), shared)
assert.equal(resolveEmbeddingApiKey({
  embeddingBaseUrl: "https://api.openai.com/v1",
  embeddingModel: "text-embedding-3-small",
  zhipuApiKey: shared,
}), "")
assert.equal(hasArticleApiKey({ articleProvider: "zhipu", zhipuApiKey: shared }), true)
assert.equal(hasZhipuKnowledge({
  zhipuApiKey: shared,
  zhipuKnowledgeMode: "hybrid",
  zhipuKnowledgeIds: "knowledge-a, knowledge-b",
}), true)
assert.equal(hasZhipuKnowledge({
  articleProvider: "openai",
  articleApiKey: "openai-key",
  zhipuKnowledgeMode: "remote",
  zhipuKnowledgeIds: "knowledge-a",
}), false)
assert.deepEqual(normalizeKnowledgeIds(" knowledge-a,knowledge-b\nknowledge-a "), ["knowledge-a", "knowledge-b"])
assert.deepEqual(mapZhipuKnowledgeRows([{
  text: "召回片段",
  score: 0.87,
  metadata: { knowledge_id: "knowledge-a", doc_name: "资料.pdf" },
}]), [{
  content: "召回片段",
  source: "资料.pdf",
  type: "zhipu_knowledge",
  dir: "knowledge-a",
  score: 0.13,
  sim: 87,
  kwScore: 0,
  finalScore: 87,
}])

console.log("服务商公共 Key 解析测试通过")
