import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { chromium, type Browser, type Page } from "playwright"
import {
  configureWechatEditor,
  enableWechatAllAds,
  openWechatPublishDialog,
  setWechatLabeledSwitch,
  submitWechatPublishOnce,
} from "../server/utils/wechatPublishBrowser.ts"

// 这些页面夹具只验证选择器、状态读取和单次提交，不连接微信，也不会创建或发表草稿。
let browser: Browser
before(async () => { browser = await chromium.launch({ headless: true }) })
after(async () => { await browser?.close() })

async function withPage(html: string, run: (page: Page) => Promise<void>): Promise<void> {
  const page = await browser.newPage()
  await page.route("**/*", (route) => route.request().url().startsWith("http://wechat.test/")
    ? route.fulfill({ contentType: "text/html; charset=utf-8", body: html })
    : route.abort())
  try {
    await page.goto("http://wechat.test/editor")
    await run(page)
  } finally {
    await page.close()
  }
}

test("按标签切换微信设置时只修改对应开关", async () => {
  await withPage(`
    <div class="setting-row"><span>留言</span><input id="comment" type="checkbox"></div>
    <div class="setting-row"><span>仅关注后可留言</span><input id="fans" type="checkbox" checked></div>
  `, async (page) => {
    await setWechatLabeledSwitch(page, ["留言"], true)
    await setWechatLabeledSwitch(page, ["仅关注后可留言"], false)
    assert.equal(await page.locator("#comment").isChecked(), true)
    assert.equal(await page.locator("#fans").isChecked(), false)
  })
})

test("流量主设置必须选中打开全部广告并保存", async () => {
  await withPage(`
    <button id="ad-entry">广告设置</button>
    <div role="dialog" id="ad-dialog" hidden>
      <h2>流量主广告</h2>
      <label><input id="all-ads" type="radio" name="ads">打开全部广告</label>
      <label><input type="radio" name="ads" checked>不展示广告</label>
      <button id="ad-confirm">确定</button>
    </div>
    <script>
      document.querySelector("#ad-entry").onclick=()=>document.querySelector("#ad-dialog").hidden=false;
      document.querySelector("#ad-confirm").onclick=()=>{
        document.body.dataset.ads=String(document.querySelector("#all-ads").checked);
        document.querySelector("#ad-dialog").hidden=true;
      };
    </script>
  `, async (page) => {
    await enableWechatAllAds(page)
    assert.equal(await page.locator("body").getAttribute("data-ads"), "true")
    assert.equal(await page.locator("#ad-dialog").isVisible(), false)
  })
})

test("原创、留言范围和全部广告会在进入发表前完成", async () => {
  await withPage(`
    <div class="setting-row"><span>原创声明</span><input id="original" type="checkbox"></div>
    <div class="setting-row"><span>留言</span><input id="comment" type="checkbox"></div>
    <div class="setting-row"><span>仅关注后可留言</span><input id="fans" type="checkbox"></div>
    <button id="ad-entry">广告设置</button>
    <div role="dialog" id="ad-dialog" hidden>
      <h2>广告</h2>
      <label><input id="all-ads" type="checkbox">打开全部广告</label>
      <button id="ad-confirm">保存</button>
    </div>
    <script>
      document.querySelector("#ad-entry").onclick=()=>document.querySelector("#ad-dialog").hidden=false;
      document.querySelector("#ad-confirm").onclick=()=>document.querySelector("#ad-dialog").hidden=true;
    </script>
  `, async (page) => {
    await configureWechatEditor(page, {
      declareOriginal: true,
      commentMode: "fans",
      enableAllAds: true,
    })
    assert.equal(await page.locator("#original").isChecked(), true)
    assert.equal(await page.locator("#comment").isChecked(), true)
    assert.equal(await page.locator("#fans").isChecked(), true)
    assert.equal(await page.locator("#all-ads").isChecked(), true)
  })
})

test("发表设置强制关闭群发通知，最终按钮只点击一次", async () => {
  await withPage(`
    <div id="js_send"><button>发表</button></div>
    <div role="dialog" id="publish-dialog" hidden>
      <h2>发表设置</h2>
      <div class="setting-row"><span>群发通知</span><input id="notify" type="checkbox" checked></div>
      <button id="publish">发表</button>
    </div>
    <script>
      document.querySelector("#js_send button").onclick=()=>document.querySelector("#publish-dialog").hidden=false;
      document.querySelector("#publish").onclick=()=>{
        document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);
        const success=document.createElement("p");success.textContent="发表成功";document.body.append(success);
      };
    </script>
  `, async (page) => {
    const dialog = await openWechatPublishDialog(page)
    assert.equal(await page.locator("#notify").isChecked(), false)
    assert.equal(await submitWechatPublishOnce(page, dialog, 1000), "published")
    assert.equal(await page.locator("body").getAttribute("data-clicks"), "1")
  })
})

test("发表结果不明时不重复点击", async () => {
  await withPage(`
    <div role="dialog" id="publish-dialog">
      <h2>发表设置</h2>
      <button id="publish">发表</button>
    </div>
    <script>
      document.querySelector("#publish").onclick=()=>{
        document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);
      };
    </script>
  `, async (page) => {
    const dialog = page.locator("#publish-dialog")
    await assert.rejects(
      submitWechatPublishOnce(page, dialog, 200),
      /勿重复发布/,
    )
    assert.equal(await page.locator("body").getAttribute("data-clicks"), "1")
  })
})
