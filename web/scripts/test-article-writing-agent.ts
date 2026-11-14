import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const directory = mkdtempSync(join(tmpdir(), "article-writing-agent-"))
process.env.DATA_DIR = join(directory, "data")
process.env.DRAFTS_DIR = join(directory, "drafts")
process.env.LOG_DIR = join(directory, "logs")
const { prepareArticleWriting } = await import("../server/articleWritingAgent.ts")
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

  const prompts: string[] = []
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
    complete: async (_system, user) => { prompts.push(user); return steps.shift() || "" },
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
  assert.match(prompts[1], /预览声称已经开工/)
  assert.match(prompts[2], /公告没有给出开工日期/)
  assert.doesNotMatch(prompts.at(-1)!, /预览声称已经开工/)
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
  const malformed = await prepareArticleWriting({ ...base, complete: async system => system.includes("调研 Agent") ? "无效动作" : "根据现有素材写作" })
  assert.match(malformed.prompt, /根据现有素材写作/)
  const fallbackCalls: string[] = []
  const fallback = await prepareArticleWriting({
    ...base, task: "查公开项目的最新进展",
    complete: async system => system.includes("仅输出一行") ? "公开项目 最新 官方进展"
      : system.includes("调研 Agent") ? '{"action":"finish","plan":{}}' : "页面没有写开工日期。",
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
    complete: async system => system.includes("调研 Agent") ? '{"action":"search_web","query":"校舍建设 官方公告"}' : "只采用已有素材",
    startStep: kind => result => failedTrace.push({ kind, ...result }),
    web: { search: async () => { throw new Error("timeout") }, read: async () => "" },
  })
  assert.match(failedWeb.prompt, /本次没有成功完成联网搜索/)
  assert.ok(failedTrace.some(step => step.kind === "search" && step.status === "failed"))
  await assert.rejects(() => prepareArticleWriting({ ...base, materials: "", complete: async () => '{"action":"finish","plan":{}}' }), /没有可用素材/)
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(() => prepareArticleWriting({ ...base, signal: abort.signal, complete: async () => { throw new Error("不应调用模型") } }), { name: "AbortError" })
} finally {
  db.close()
  rmSync(directory, { recursive: true, force: true })
}
console.log("文章 Agent 多轮决策、作者风格、来源边界与无索引历史检索通过")
process.exit(0)
