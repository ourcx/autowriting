import assert from "node:assert/strict"
import { chromium } from "playwright"
import { wechatCollectorTestUtils } from "../server/utils/wechatCollector.ts"
import { parseYuanbaoStream, readYuanbaoStream } from "../server/utils/yuanbaoSearch.ts"

const tikhubItems = wechatCollectorTestUtils.collectArticleItems({
  items: [{
    title: "<em>广州大学</em>发布人工智能行动计划",
    desc: "学校发布最新行动计划。",
    doc_url: "https://mp.weixin.qq.com/s/example-a",
    source: { title: "广州大学" },
    date: 1_789_000_000,
  }],
}, "tikhub")

assert.equal(tikhubItems.length, 1)
assert.equal(tikhubItems[0].title, "广州大学发布人工智能行动计划")
assert.equal(tikhubItems[0].source, "广州大学")
assert.equal(tikhubItems[0].provider, "tikhub")

const dajialaItems = wechatCollectorTestUtils.collectArticleItems([
  {
    items: [
      {
        title: "校园开放日",
        desc: "开放日活动安排。",
        doc_url: "https://mp.weixin.qq.com/s/example-b",
        source: { title: "广州大学招生办" },
        date: 1_789_000_100,
      },
      {
        title: "重复结果",
        doc_url: "https://mp.weixin.qq.com/s/example-b",
      },
    ],
  },
], "dajiala")

assert.equal(dajialaItems.length, 1)
assert.equal(dajialaItems[0].source, "广州大学招生办")

const article = wechatCollectorTestUtils.articleContentFromPayload({
  code: 200,
  data: {
    content: {
      title: "文章标题",
      nick_name: "测试公众号",
      create_time: "2026-09-16 08:30",
      content_noencode: "<p>第一段</p><p>第二段</p>",
    },
  },
}, "https://mp.weixin.qq.com/s/example-c")

assert.equal(article.title, "文章标题")
assert.equal(article.source, "测试公众号")
assert.equal(article.content, "第一段\n第二段")

const stream = (frames: unknown[]) => frames.map(frame => `data: ${JSON.stringify(frame)}\r\n\r\n`).join("")
const citations = {
  search_info: { search_results: [
    { url: "http://mp.weixin.qq.com/s/sample#rd", title: "索引原理", site_name: "数据库笔记" },
    { url: "https://mp.weixin.qq.com/s/sample", title: "重复引用" },
    { url: "https://mp.weixin.qq.com/s?src=11&signature=sample", title: "带签名的文章" },
    { url: "https://mp.weixin.qq.com.example.test/s/sample", title: "伪装域名" },
    { url: "https://mp.weixin.qq.com/s", title: "缺少文章信息" },
    { url: "https://example.test/article", title: "其他平台" },
  ] },
}
const answerPart = { choices: [{ delta: { content: "参考公众号文章。https://mp.weixin.qq.com/s/model-only" } }] }
const finished = { choices: [{ finish_reason: "stop", delta: { content: "以上为原文。" } }] }
const yuanbao = parseYuanbaoStream(stream([citations, answerPart, finished]))
assert.equal(yuanbao.answer, "参考公众号文章。https://mp.weixin.qq.com/s/model-only以上为原文。")
assert.deepEqual(yuanbao.articles.map(item => [item.url, item.title]), [
  ["https://mp.weixin.qq.com/s/sample", "索引原理"],
  ["https://mp.weixin.qq.com/s?src=11&signature=sample", "带签名的文章"],
])
assert.throws(() => parseYuanbaoStream(stream([citations, answerPart])), /未返回完整回答/)
assert.throws(() => parseYuanbaoStream(stream([{ data_type: "anti_crawl", data: { status: "reject" } }])), /未接受/)

const now = Date.parse("2026-11-12T12:00:00+08:00")
const ranked = parseYuanbaoStream(stream([{
  search_info: { search_results: [
    { url: "https://mp.weixin.qq.com/s/unknown", time: "2026-02-30" },
    ...Array.from({ length: 10 }, (_, index) => ({ url: `https://mp.weixin.qq.com/s/older-${index}`, time: "2026-09-01" })),
    { url: "https://mp.weixin.qq.com/s/month", time: "2026-11-05" },
    { url: "https://mp.weixin.qq.com/s/week-first", publish_time_ts: Date.parse("2026-11-10T09:00:00+08:00") },
    { url: "https://mp.weixin.qq.com/s/week-second", publish_time_ts: Date.parse("2026-11-11T16:30:00Z") / 1000 },
  ] },
}, answerPart, finished]), now)
assert.equal(ranked.articles.length, 10)
assert.deepEqual(ranked.articles.slice(0, 4).map(item => [new URL(item.url).pathname, item.publishedOn]), [
  ["/s/week-first", "2026-11-10"],
  ["/s/week-second", "2026-11-12"],
  ["/s/month", "2026-11-05"],
  ["/s/older-0", "2026-09-01"],
])

// Chromium 读取没有 charset 的元宝 SSE 时，回答和引用必须保留原始中文。
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const pageUrl = "https://so.qq.com/iaimode/search"
  const searchUrl = "https://lizhiassistant.search.qq.com/browser_aimode/aimode/query_get"
  await page.route(pageUrl, route => route.fulfill({
    contentType: "text/html",
    body: `<script>fetch(${JSON.stringify(searchUrl)}, { method: 'POST' }).then(response => response.text())</script>`,
  }))
  await page.route(searchUrl, route => route.fulfill({
    headers: { "content-type": "text/event-stream", "access-control-allow-origin": "https://so.qq.com" },
    body: Buffer.from(stream([citations, answerPart, finished]), "utf8"),
  }))

  const result = await readYuanbaoStream(page, pageUrl, AbortSignal.timeout(10000))
  assert.equal(result.answer, yuanbao.answer)
  assert.deepEqual(result.articles, yuanbao.articles)
} finally {
  await browser.close()
}

console.log("wechat collector parser tests passed")
process.exit(0)
