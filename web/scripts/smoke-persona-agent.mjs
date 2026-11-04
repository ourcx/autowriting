import assert from "node:assert/strict"
import { createServer } from "node:http"

export async function smokePersonaAgent(base, token) {
  let modelRequest = null
  const model = createServer((req, res) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", chunk => { body += chunk })
    req.on("end", () => {
      modelRequest = JSON.parse(body)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              accountName: "Smoke 作者",
              accountInfo: "记录自动化回归实践",
              personalExperiences: "参与过本地隔离回归",
              historicalArticles: "持续发布工程回归记录",
              speakingStyle: "直接说明证据和结果",
              expertise: "自动化测试",
              values: "不把目标写成结果",
              audienceRelationship: "同行实践者",
              otherNotes: "",
            }),
          },
        }],
      }))
    })
  })

  await new Promise(resolve => model.listen(0, "127.0.0.1", resolve))
  try {
    const port = model.address().port
    const sourceArticle = [
      "# 人设分析历史文章",
      "",
      "我参与过一个内容工作台的建设，负责把素材、写作、审核和发布串成一条可以恢复的流程。",
      "项目里最重要的判断不是增加多少功能，而是让每一步状态可见，让失败能够恢复，并保护已有文章和账号数据。",
      "我习惯先说明观察到的事实，再给判断和取舍。没有运行证据时，我会把风险和已证实的根因分开表达。",
      "这篇文章用于隔离回归测试，内容只描述明确提供的经历，不允许模型补造年龄、学历或任职公司。",
    ].join("\n\n")
    const saveSource = await fetch(`${base}/api/articles/20261104-persona-smoke`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "人设分析历史文章",
        task: "总结一次内容工作台建设经历",
        materials: "隔离 smoke 测试素材，用于验证人设分析来源读取。",
        article: sourceArticle,
      }),
    })
    assert.equal(saveSource.status, 200)

    const response = await fetch(`${base}/api/creator-profile/persona/analyze`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        aiConfig: {
          articleProvider: "openai-compat",
          articleApiKey: "smoke-only",
          articleModel: "smoke-persona-model",
          articleBaseUrl: `http://127.0.0.1:${port}/v1`,
        },
        accountInfo: {
          name: "Smoke 账号",
          description: "隔离回归账号",
          principal: "测试主体",
        },
        publishedArticles: [{
          title: "已发布回归记录",
          digest: "用于确认已发布摘要会进入分析上下文",
          publishedAt: "2026-11-04T00:00:00.000Z",
        }],
      }),
    })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.persona.enabled, true)
    assert.equal(result.persona.accountName, "Smoke 作者")
    assert.ok(result.persona.sourceArticleCount >= 2)
    assert.equal(result.sources.publishedArticleCount, 1)
    assert.ok(result.sources.localArticleCount >= 1)
    assert.match(modelRequest.messages[1].content, /人设分析历史文章/)
    assert.match(modelRequest.messages[1].content, /已发布回归记录/)
  } finally {
    model.closeAllConnections()
    await new Promise(resolve => model.close(resolve))
  }
}
