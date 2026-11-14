import type { WritingAgentMessage } from "../server/articleWritingAgent.ts"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const directory = mkdtempSync(join(tmpdir(), "article-writing-agent-"))
process.env.DATA_DIR = join(directory, "data")
process.env.DRAFTS_DIR = join(directory, "drafts")
process.env.LOG_DIR = join(directory, "logs")
const { readArticlePage } = await import("../server/utils/search/readArticlePage.ts")
const { preservesDraftAnchors } = await import("../server/writingAgentPolicy.ts")
const { prepareArticleWriting, WritingAgentModelError } = await import("../server/articleWritingAgent.ts")
const { findWritingExamples } = await import("../server/rag.ts")
const { db, setSetting } = await import("../server/db.ts")
const { buildWritingContext } = await import("../server/writingContext.ts")

function draft(owner: string, id: string, sentence: string) {
  const raw = join(directory, "drafts", owner, id, "raw")
  mkdirSync(raw, { recursive: true })
  writeFileSync(join(raw, "article_raw.md"), `# ${id}\n\n${sentence.repeat(14)}`)
}

try {
  draft("author", "20261114-current", "这篇是当前母稿。")
  draft("author", "20261112-history", "调研校舍建设时，我先找公告，再确认是哪栋楼。")
  draft("other", "20261113-private", "调研校舍建设，这段是其他账号私有正文。")
  setSetting("creator_writing_profile:author", { persona: { enabled: true, speakingStyle: "先说我实际看到什么，再解释判断" } })
  const signal = AbortSignal.timeout(15000)
  const examples = await findWritingExamples("author", "20261114-current", "校舍建设", {}, signal)
  assert.deepEqual(examples.map(item => item.id), ["20261112-history"])
  assert.match(examples[0].excerpt, /我先找公告/)
  draft("author", "20261113-new", "校舍建设先看校方发布的施工日期。")
  assert.ok((await findWritingExamples("author", "20261114-current", "校舍建设", {}, signal)).some(item => item.id === "20261113-new"))
  const writingContext = await buildWritingContext("author", { compactForAgent: true, includeWritingGuide: false })
  assert.match(writingContext, /先说我实际看到什么/)

  const prompts: WritingAgentMessage[][] = []
  const actions: string[] = []
  const trace: { kind: string; status?: string; output?: string }[] = []
  const steps = [
    '{"action":"search_web","query":"校舍建设 官方公告"}',
    '{"action":"read_source","id":"W2"}',
    '{"action":"find_in_page","id":"W2","term":"11 月 10 日"}',
    '{"action":"find_in_materials","term":"作者素材"}',
    '{"action":"finish","plan":{"angle":"现有公告确认了什么","outline":["先讲已经确认的时间"]}}',
    "来自 W2 的事实：11 月 10 日公示了设计招标。施工日期仍未知。",
  ]
  const prepared = await prepareArticleWriting({
    task: "写一篇校舍建设进展", materials: "作者素材见 https://example.com/materials",
    platform: "wechat", sourceArticle: "", writingContext, examples, signal, progress: message => actions.push(message),
    startStep: kind => result => trace.push({ kind, ...result }),
    complete: async messages => { prompts.push(messages); return steps.shift() || "" },
    web: {
      search: async query => {
        assert.equal(query, "校舍建设 官方公告")
        return [
          { url: "javascript:bad", title: "无效结果", snippet: "", source: "" },
          { url: "https://example.com/notice", title: "校方公告", snippet: "预览声称已经开工", source: "学校官网" },
        ]
      },
      read: async url => {
        assert.equal(url, "https://example.com/notice")
        return "11 月 10 日公示了设计招标，公告没有给出开工日期。"
      },
    },
  })
  assert.equal(prompts.length, 6)
  assert.deepEqual(prompts[1].map(message => message.role), ["system", "user", "assistant", "user"])
  assert.deepEqual(JSON.parse(prompts[1][2].content), { action: "search_web", query: "校舍建设 官方公告" })
  assert.match(prompts[1][3].content, /搜索「校舍建设 官方公告」[\s\S]*W2 校方公告[\s\S]*预览声称已经开工/)
  assert.deepEqual(JSON.parse(prompts[2][4].content), { action: "read_source", id: "W2" })
  assert.match(prompts[2].at(-1)!.content, /公告没有给出开工日期/)
  assert.equal(prompts[2][1].content, prompts[3][1].content, "后续轮次保留同一篇原任务")
  assert.equal(prompts[2][3].content, prompts[3][3].content, "工具观察保留，网页快照不在历史中重复")
  const outlineMessages = prompts.at(-1)!
  assert.match(outlineMessages[0].content, /写作准备/)
  assert.match(outlineMessages[1].content, /写一篇校舍建设进展/)
  assert.deepEqual(outlineMessages.filter(message => message.role === "assistant").map(message => JSON.parse(message.content).action),
    ["search_web", "read_source", "find_in_page", "find_in_materials", "finish"])
  assert.match(outlineMessages.at(-1)!.content, /调研阶段的写作方向[\s\S]*现有公告确认了什么/)
  assert.doesNotMatch(outlineMessages.map(message => message.content).join("\n"), /预览声称已经开工/)
  assert.match(prepared.prompt, /先说我实际看到什么/)
  assert.match(prepared.prompt, /我先找公告/)
  assert.match(prepared.prompt, /短例子（虚构/)
  assert.match(prepared.prompt, /写作提纲/)
  assert.doesNotMatch(prepared.prompt, /预览声称已经开工|其他账号私有正文/)
  assert.deepEqual(prepared.sources, [{ url: "https://example.com/notice", title: "校方公告", publishedAt: undefined, read: true }])
  assert.deepEqual(prepared.referenceArticleIds, ["20261112-history"])
  assert.ok(actions.includes("正在读取原始来源"))
  assert.equal(trace.filter(step => step.kind === "find").length, 2)
  assert.match(trace.find(step => step.kind === "find")?.output || "", /11 月 10 日/)

  const base = {
    task: "写作任务", materials: "已有用户素材", platform: "wechat" as const, sourceArticle: "",
    writingContext: "", examples: [], signal, progress: () => {},
  }
  const malformed = await prepareArticleWriting({ ...base, complete: async (_messages, phase) => phase === "decision" ? "无效动作" : "根据现有素材写作" })
  assert.match(malformed.prompt, /根据现有素材写作/)
  const realFetch = globalThis.fetch
  const publicUrl = "https://1.1.1.1/fixture"
  try {
    globalThis.fetch = async input => {
      assert.equal(String(input), publicUrl)
      const page = new Response(
        `<body><nav>导航 ${"甲".repeat(180)}</nav><div id="js_content"><div><p>公众号嵌套容器中的第一段正文。</p></div><p>第二段也应读取。</p></div><footer>页脚</footer></body>`,
        { headers: { "Content-Type": "text/html" } },
      )
      Object.defineProperty(page, "url", { value: "https://mp.weixin.qq.com/s/fixture" })
      return page
    }
    const page = await readArticlePage(publicUrl, { sameOrigin: true })
    assert.equal(page.method, "webfetch")
    assert.match(page.content, /第一段正文[\s\S]*第二段/)
    assert.doesNotMatch(page.content, /导航|页脚/)
    await assert.rejects(readArticlePage("http://127.0.0.1/test"), /无法通过公网访问/)
    globalThis.fetch = async () => new Response(
      "<body><main>环境异常，请先完成验证</main>" + " ".repeat(220) + "</body>",
      { headers: { "Content-Type": "text/html" } },
    )
    const fallback = await readArticlePage(publicUrl, {
      fetchWithDeepSeek: async () => "[校方公告](https://example.com) 仅公示设计招标。",
    })
    assert.equal(fallback.method, "deepseek")
    assert.match(fallback.content, /^\[校方公告\]/)
  } finally { globalThis.fetch = realFetch }

  const originalDraft = "# 招标进展\n\n能确定的只有一件事：公告于 5 月 10 日发布。原文「设计招标」见[公告](https://example.com/a)。"
  const rewrite = "# 招标进展\n\n公告于 5 月 10 日发布，原文「设计招标」见[公告](https://example.com/a)。"
  assert.equal(preservesDraftAnchors(originalDraft, rewrite), true)
  assert.equal(preservesDraftAnchors(originalDraft, rewrite.replace("10 日", "11 日")), false)
  assert.equal(preservesDraftAnchors(originalDraft, rewrite.replace("设计招标", "正式开工")), false)
  assert.equal(preservesDraftAnchors(originalDraft, rewrite.replace("/a)", "/b)")), false)
  assert.equal(preservesDraftAnchors(originalDraft, rewrite + "据说投资 72 万。"), false)
  const unavailable = await prepareArticleWriting({
    ...base, complete: async () => { throw new Error("provider temporarily unavailable") },
  })
  assert.match(unavailable.prompt, /已有用户素材/)
  const fallbackCalls: string[] = []
  const fallback = await prepareArticleWriting({
    ...base, task: "查公开项目的最新进展",
    complete: async (_messages, phase) => phase === "query" ? "公开项目 最新 官方进展"
      : phase === "decision" ? '{"action":"finish","plan":{}}' : "页面没有写开工日期。",
    web: {
      search: async query => {
        fallbackCalls.push(query)
        return [{ url: "https://example.com/official", title: "官方网", snippet: "仅供预览", source: "官方" }]
      },
      read: async url => { fallbackCalls.push(url); return "页面没有写开工日期。" },
    },
  })
  assert.deepEqual(fallbackCalls, ["公开项目 最新 官方进展", "https://example.com/official"])
  assert.equal(fallback.sources.length, 1)
  const followupActions = [
    '{"action":"search_web","query":"产品 官方版本"}',
    '{"action":"read_source","id":"W1"}',
    '{"action":"finish","plan":{},"followup_query":"产品 版本更新日志"}',
    '{"action":"finish","plan":{}}',
    '{"action":"compare_sources","ids":["W1","W2"],"term":"正式版"}',
    '{"action":"finish","plan":{}}',
    "正式版以发布日志为准。",
  ]
  const compared: string[] = []
  const checked = await prepareArticleWriting({
    ...base, task: "查询产品当前版本",
    complete: async () => followupActions.shift() || "",
    startStep: (kind, title) => ({ output }) => { if (kind === "find" && title === "对照多个来源") compared.push(output || "") },
    web: {
      search: async query => [{ url: query.includes("日志") ? "https://example.com/releases" : "https://example.com/docs", title: query, snippet: "仅供预览", source: "官方" }],
      read: async url => url.endsWith("releases") ? "正式版 2.0 已发布。" : "正式版 1.0 的旧版文档。",
    },
  })
  assert.equal(checked.sources.length, 2)
  assert.match(compared[0], /正式版 1\.0[\s\S]*正式版 2\.0/)
  assert.match(checked.prompt, /正式版以发布日志为准/)
  const failedTrace: { kind: string; status?: string }[] = []
  const failedWeb = await prepareArticleWriting({
    ...base,
    complete: async (_messages, phase) => phase === "decision" ? '{"action":"search_web","query":"校舍建设 官方公告"}' : "只采用已有素材",
    startStep: kind => result => failedTrace.push({ kind, ...result }),
    web: { search: async () => { throw new Error("timeout") }, read: async () => "" },
  })
  assert.match(failedWeb.prompt, /本次没有成功完成联网搜索/)
  assert.ok(failedTrace.some(step => step.kind === "search" && step.status === "failed"))
  await assert.rejects(() => prepareArticleWriting({ ...base, materials: "", complete: async () => '{"action":"finish","plan":{}}' }), /没有可用素材/)
  const requestEvidence: string[] = []
  const failureReasons: string[] = []
  const recovered = await prepareArticleWriting({
    ...base,
    task: "核对公开项目进展",
    startStep: (_kind, _title) => result => { if (result.status === "failed") failureReasons.push(result.output || "") },
    complete: async (messages, phase) => {
      if (phase === "outline") {
        assert.match(messages.at(-1)!.content, /写作方向[\s\S]*按公告写项目边界/)
        throw new WritingAgentModelError("模型请求失败（HTTP 429）。")
      }
      const last = messages.at(-1)!.content
      if (!messages.some(message => message.role === "assistant")) return '{"action":"search_web","query":"公开项目公告"}'
      if (!last.includes("W1「无法访问的公告」读取失败") && !last.includes("W1 · 无法访问的公告 · 读取失败")) return '{"action":"read_source","id":"W1"}'
      requestEvidence.push(last)
      if (requestEvidence.length === 1) return "这不是 JSON：fixture-private-content"
      if (requestEvidence.length === 2) {
        assert.match(last, /模型回复不是有效 JSON/)
        assert.match(last, /W1 · 无法访问的公告 · 读取失败/)
        assert.doesNotMatch(messages.map(message => message.content).join("\n"), /fixture-private-content/)
        return '{"action":"read_source","id":"W2"}'
      }
      return '{"action":"finish","plan":{"angle":"按公告写项目边界","outline":["施工日期尚未公开"]}}'
    },
    web: {
      search: async () => [
        { url: "https://example.com/missing", title: "无法访问的公告", snippet: "仅供预览", source: "官方" },
        { url: "https://example.com/second", title: "后续公告", snippet: "仅供预览", source: "官方" },
      ],
      async read(url) {
        if (url.endsWith("missing")) throw new Error("模拟网页失败")
        return "施工日期尚未公开。"
      },
    },
  })
  assert.deepEqual(recovered.sources.map(source => source.title), ["后续公告"])
  assert.match(recovered.prompt, /写作提纲[\s\S]*按公告写项目边界/)
  assert.ok(failureReasons.includes("模型回复不是有效 JSON。"))
  assert.ok(failureReasons.some(reason => reason.includes("HTTP 429") && reason.includes("沿用调研")))
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(() => prepareArticleWriting({ ...base, signal: abort.signal, complete: async () => { throw new Error("不应调用模型") } }), { name: "AbortError" })
} finally {
  db.close()
  rmSync(directory, { recursive: true, force: true })
}
console.log("文章 Agent 多轮决策、作者风格、来源边界与无索引历史检索通过")
process.exit(0)
