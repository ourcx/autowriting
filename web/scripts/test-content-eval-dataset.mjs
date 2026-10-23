import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const datasetUrl = new URL("../evals/content-generation/dataset.v1.jsonl", import.meta.url)
const source = await readFile(datasetUrl, "utf8")
const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean)

assert.ok(lines.length >= 30 && lines.length <= 50, `评测集应包含 30—50 条样本，当前为 ${lines.length} 条`)

const allowedCategories = new Set([
  "factuality",
  "conflict_resolution",
  "style_alignment",
  "audience_structure",
  "rag_boundary",
  "platform_adaptation",
  "publishability",
  "robustness",
])
const allowedPlatforms = new Set(["wechat", "toutiao", "both"])
const ids = new Set()
const categoryCounts = new Map()

for (const [index, line] of lines.entries()) {
  let sample
  try {
    sample = JSON.parse(line)
  } catch (error) {
    throw new Error(`第 ${index + 1} 行不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }

  assert.equal(typeof sample.id, "string", `第 ${index + 1} 行缺少 id`)
  assert.match(sample.id, /^cg-[a-z]+-\d{3}$/, `${sample.id} 的格式不正确`)
  assert.equal(ids.has(sample.id), false, `样本 ID 重复：${sample.id}`)
  ids.add(sample.id)

  assert.ok(allowedCategories.has(sample.category), `${sample.id} 的 category 不受支持`)
  assert.ok(allowedPlatforms.has(sample.platform), `${sample.id} 的 platform 不受支持`)
  assert.equal(typeof sample.title, "string", `${sample.id} 缺少 title`)
  assert.equal(typeof sample.task, "string", `${sample.id} 缺少 task`)
  assert.equal(typeof sample.materials, "string", `${sample.id} 缺少 materials`)
  assert.ok(sample.task.trim(), `${sample.id} 的 task 不能为空`)
  assert.ok(sample.materials.trim(), `${sample.id} 的 materials 不能为空`)

  assert.ok(sample.context && typeof sample.context === "object" && !Array.isArray(sample.context), `${sample.id} 缺少 context`)
  for (const key of ["creator_profile", "long_term_memory", "retrieved_context", "source_article"]) {
    assert.equal(typeof sample.context[key], "string", `${sample.id} 的 context.${key} 必须是字符串`)
  }

  assert.ok(sample.expected && typeof sample.expected === "object" && !Array.isArray(sample.expected), `${sample.id} 缺少 expected`)
  const arrayFields = [
    "required_facts",
    "must_include",
    "must_not_include",
    "style_rules",
    "structure_rules",
    "publish_rules",
    "review_focus",
  ]
  for (const key of arrayFields) {
    assert.ok(Array.isArray(sample.expected[key]), `${sample.id} 的 expected.${key} 必须是数组`)
  }
  assert.ok(sample.expected.required_facts.length > 0, `${sample.id} 至少需要一条 required_fact`)
  assert.ok(sample.expected.review_focus.length > 0, `${sample.id} 至少需要一个人工复核重点`)
  for (const fact of sample.expected.required_facts) {
    assert.ok(fact && typeof fact === "object" && !Array.isArray(fact), `${sample.id} 的 required_fact 格式不正确`)
    assert.equal(typeof fact.claim, "string", `${sample.id} 的 required_fact.claim 必须是字符串`)
    assert.ok(["materials", "long_term_memory", "retrieved_context", "source_article"].includes(fact.evidence), `${sample.id} 的 required_fact.evidence 不受支持`)
  }

  categoryCounts.set(sample.category, (categoryCounts.get(sample.category) || 0) + 1)
}

assert.deepEqual(
  [...categoryCounts.keys()].sort(),
  [...allowedCategories].sort(),
  "评测集必须覆盖全部分类",
)
for (const [category, count] of categoryCounts) {
  assert.ok(count >= 4, `${category} 至少需要 4 条样本，当前为 ${count} 条`)
}

process.stdout.write(`内容生成评测集静态校验通过：${lines.length} 条，${categoryCounts.size} 个分类\n`)
