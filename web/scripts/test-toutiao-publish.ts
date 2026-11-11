import assert from "node:assert/strict"
import { chromium } from "playwright"
import { assertToutiaoPublishConfirmed, chooseToutiaoNoCover, isToutiaoPublishEndpoint, submitToutiaoArticle, verifyToutiaoPublishResponse } from "../server/utils/toutiaoPublish.ts"

assert.equal(isToutiaoPublishEndpoint("https://mp.toutiao.com/mp/article/publish/"), true)
assert.equal(isToutiaoPublishEndpoint("https://mp.toutiao.com/mp/article/save_draft/"), false)
assert.equal(isToutiaoPublishEndpoint("https://mp.toutiao.com/profile_v4/graphic/publish", "GET"), false)
assert.equal(isToutiaoPublishEndpoint("https://example.test/mp/article/publish/"), false)

assert.deepEqual(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 200, '{"code":0,"data":{"article_id":"1"}}'),
  { confirmed: true, detail: "发布接口明确返回成功" },
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 200, '{"code":1,"message":"审核参数缺失","data":{"article_id":"1"}}').confirmed,
  false,
  "响应中带 article_id 不能覆盖失败 code",
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 200, '{"code":1,"success":true}').confirmed,
  false,
  "明确失败 code 不能被 success 字段覆盖",
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 200, '{"success":false,"message":"success"}').confirmed,
  false,
  "明确 success=false 不能被成功文案覆盖",
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 200, '{"code":0,"success":false}').confirmed,
  false,
  "明确 success=false 不能被零错误码覆盖",
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 200, '{"code":"0"}').confirmed,
  true,
  "字符串零错误码也应识别为成功",
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/save_draft/", 200, '{"code":0,"message":"success"}').confirmed,
  false,
  "保存草稿不能算发布成功",
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 500, '{"code":0,"message":"success"}').confirmed,
  false,
  "非 2xx 响应不能算发布成功",
)
assert.equal(
  verifyToutiaoPublishResponse("https://mp.toutiao.com/mp/article/publish/", 200, "<html>login</html>").confirmed,
  false,
  "登录页或 HTML 响应不能算发布成功",
)
assert.throws(
  () => assertToutiaoPublishConfirmed(false),
  /未收到今日头条的发布成功确认/,
  "未确认发布时不得返回成功",
)
assert.doesNotThrow(() => assertToutiaoPublishConfirmed(true))

const attemptedSelectors: string[] = []
const selectedSelector = await chooseToutiaoNoCover({
  locator(selector: string) {
    attemptedSelectors.push(selector)
    return {
      first() { return this },
      async isVisible() { return selector === 'text=无封面' },
      async click() { assert.equal(selector, 'text=无封面') },
    }
  },
})
assert.equal(selectedSelector, 'text=无封面')
assert.equal(attemptedSelectors.includes('text=无封面'), true)

// 使用真实浏览器操作模拟编辑器，所有请求均由 Playwright 拦截。
const browser = await chromium.launch({ headless: true })
try {
  for (const { direct, code } of [{ direct: false, code: 0 }, { direct: true, code: 0 }, { direct: false, code: 1 }]) {
    const page = await browser.newPage()
    let submissions = 0
    try {
      await page.route("**/*", async route => {
        const url = route.request().url()
        if (url === "https://mp.toutiao.com/editor-fixture") {
          return route.fulfill({ contentType: "text/html; charset=utf-8", body: `
            <button id="preview">预览并发布</button>
            <button id="schedule">定时发布</button>
            <div role="dialog" hidden><button id="confirm">发布</button></div>
            <script>
              const dialog = document.querySelector('[role=dialog]');
              const send = () => fetch('/api/pc/article/publish', { method: 'POST' });
              document.querySelector('#preview').onclick = () => {
                if (${direct}) send();
                setTimeout(() => { dialog.hidden = false; }, 75);
              };
              document.querySelector('#confirm').onclick = send;
            </script>` })
        }
        if (isToutiaoPublishEndpoint(url, route.request().method())) {
          submissions++
          // 让预览弹窗先出现，覆盖已发送请求但回执还没返回的情况。
          if (direct) await new Promise(resolve => setTimeout(resolve, 300))
          return route.fulfill({ json: { code, message: code === 0 ? "success" : "封面未通过校验" } })
        }
        return route.abort()
      })
      await page.goto("https://mp.toutiao.com/editor-fixture")
      if (code === 0) await submitToutiaoArticle(page)
      else await assert.rejects(submitToutiaoArticle(page), /封面未通过校验/)
      assert.equal(submissions, 1, "每次编辑器操作只允许提交一次")
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}

process.stdout.write("toutiao publish evidence tests passed\n")
