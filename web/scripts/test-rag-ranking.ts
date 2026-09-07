import assert from "node:assert/strict"
import {
  aggregateArticleCandidates,
  buildCandidateSearchQuery,
  cosineDistanceToSimilarity,
} from "../server/rag.ts"
import type { SearchResult } from "../server/types.ts"

// HNSWLib 的 cosine 距离应直接用 1 - distance 转成相似度，不能再按 L2 平方。
assert.equal(cosineDistanceToSimilarity(0.08), 0.92)
assert.equal(cosineDistanceToSimilarity(0.4), 0.6)
assert.equal(cosineDistanceToSimilarity(-0.01), 1)
assert.equal(cosineDistanceToSimilarity(1.2), 0)

const sharedTask = "请写一篇公众号文章，要求观点明确"
const queryA = buildCandidateSearchQuery(sharedTask, "广州大学秋招与互联网企业就业数据")
const queryB = buildCandidateSearchQuery(sharedTask, "大学生恋爱关系中的沟通与边界")
assert.notEqual(queryA, queryB)
assert.match(queryA, /秋招|就业/)
assert.match(queryB, /恋爱|沟通/)

const results: SearchResult[] = [
  {
    content: "通用开场",
    source: "a.md",
    type: "article",
    dir: "20260101",
    score: 0.05,
    sim: 95,
    kwScore: 0,
    finalScore: 71.3,
  },
  {
    content: "主题关键词完整命中的正文",
    source: "b.md",
    type: "article",
    dir: "20260102",
    score: 0.2,
    sim: 80,
    kwScore: 0.8,
    finalScore: 80,
  },
  {
    content: "同目录的第二段正文",
    source: "b-2.md",
    type: "article",
    dir: "20260102",
    score: 0.1,
    sim: 90,
    kwScore: 0,
    finalScore: 67.5,
  },
  {
    content: "任务模板不应出现在文章候选里",
    source: "task.md",
    type: "task",
    dir: "20260103",
    score: 0.01,
    sim: 99,
    finalScore: 99,
  },
]

const candidates = aggregateArticleCandidates(results)
assert.deepEqual(candidates.map((candidate) => candidate.dir), ["20260102", "20260101"])
assert.equal(candidates[0].finalScore, 80)
assert.equal(candidates[0].snippets.length, 2)

console.log("RAG 排名回归测试通过")
process.exit(0)
