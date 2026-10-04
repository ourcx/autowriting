import assert from "node:assert/strict"
import {
  hasArticleApiKey,
  resolveArticleApiKey,
  resolveEmbeddingApiKey,
  resolveZhipuApiKey,
} from "../server/utils/providerKeys.ts"

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

console.log("服务商公共 Key 解析测试通过")
