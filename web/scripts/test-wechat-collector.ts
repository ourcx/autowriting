import assert from "node:assert/strict"
import { wechatCollectorTestUtils } from "../server/utils/wechatCollector.ts"

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

console.log("wechat collector parser tests passed")
process.exit(0)
