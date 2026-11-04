import assert from "node:assert/strict"
import { parseCreatorPersonaAnalysis } from "../shared/contentProduction.ts"

const persona = parseCreatorPersonaAnalysis(`\`\`\`json
{
  "accountName": "工程手记",
  "accountInfo": "记录真实项目中的工程决策",
  "personalExperiences": "参与过内容工作台建设",
  "historicalArticles": "长期发布工程实践与复盘",
  "speakingStyle": "先给判断，再交代证据",
  "expertise": "内容生产工具",
  "values": "区分事实、推测与目标",
  "audienceRelationship": "与同行分享可复用经验",
  "otherNotes": "不使用导师口吻"
}
\`\`\``, {
  accountName: "备用名称",
  sourceArticleCount: 5,
  sourceArticleTitles: ["一次真实项目复盘"],
}, "2026-11-04T00:00:00.000Z")

assert.equal(persona.enabled, true)
assert.equal(persona.accountName, "工程手记")
assert.equal(persona.sourceArticleCount, 5)
assert.deepEqual(persona.sourceArticleTitles, ["一次真实项目复盘"])
assert.equal(persona.analyzedAt, "2026-11-04T00:00:00.000Z")
assert.throws(
  () => parseCreatorPersonaAnalysis("不是 JSON", {
    accountName: "",
    sourceArticleCount: 0,
    sourceArticleTitles: [],
  }),
  /格式不正确/,
)

console.log("账号人设分析结果解析通过")
