import assert from "node:assert/strict"
import { chromium } from "playwright"
import { executeWritingVerificationAction, isWritingVerificationText, parseWritingVerificationAction } from "../server/writingTools.ts"
import { isPublicBrowserVerificationRequest, publicBrowserResponseHeaders } from "../server/utils/publicPageBrowser.ts"

assert.equal(isWritingVerificationText("安全验证：请拖动滑块完成拼图"), true)
assert.equal(isWritingVerificationText("这是一篇正常公开文章，正文连续完整，没有访问限制。"), false)
assert.deepEqual(parseWritingVerificationAction("```json\n{\"action\":\"press\",\"key\":\"Enter\"}\n```"),
  { action: "press", key: "Enter" })
assert.deepEqual(parseWritingVerificationAction("请执行：{\"action\":\"scroll\",\"direction\":\"down\",\"amount\":500}"),
  { action: "scroll", direction: "down", amount: 500 })
assert.throws(() => parseWritingVerificationAction('{"action":"press","key":"Control+A"}'))

const source = new URL("https://news.example.com/article")
assert.equal(isPublicBrowserVerificationRequest(new URL("https://newassets.hcaptcha.com/c/opaque"), source, "POST", true), true)
assert.equal(isPublicBrowserVerificationRequest(new URL("https://client-api.arkoselabs.com/fc/gt2/public_key/x"), source, "POST", true), true)
assert.equal(isPublicBrowserVerificationRequest(new URL("https://news.example.com/api/captcha/check"), source, "POST", false), true)
assert.equal(isPublicBrowserVerificationRequest(new URL("https://news.example.com/api/comments"), source, "POST", true), false)
assert.equal(isPublicBrowserVerificationRequest(new URL("https://unrelated.example.org/api/captcha"), source, "POST", true), false)
assert.equal(isPublicBrowserVerificationRequest(new URL("https://www.google.com/opaque"), source, "POST", true), false)
assert.deepEqual(publicBrowserResponseHeaders(new Response("ok", { headers: {
  "Access-Control-Allow-Origin": "https://news.example.com",
  "Access-Control-Allow-Credentials": "true",
  "Content-Encoding": "gzip",
} }), ["challenge=passed; Secure; HttpOnly"]), {
  "access-control-allow-origin": "https://news.example.com",
  "access-control-allow-credentials": "true",
  "set-cookie": "challenge=passed; Secure; HttpOnly",
})

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.setContent(`<button id="confirm" onclick="document.body.dataset.clicked='yes'">确认</button>
    <input data-writing-verification-id="C0-0" oninput="document.body.dataset.value=this.value">
    <div style="height:1600px"></div><button id="below">底部</button>`)
  const frames = page.frames()
  const fields = new Map([["C0-0", { frame: 0 }]])
  const button = await page.locator("#confirm").boundingBox()
  assert.ok(button)
  await executeWritingVerificationAction(page, frames, fields, {
    action: "click", points: [{ x: button.x + button.width / 2, y: button.y + button.height / 2 }],
  })
  assert.equal(await page.locator("body").getAttribute("data-clicked"), "yes")
  await executeWritingVerificationAction(page, frames, fields, { action: "fill", id: "C0-0", text: "AB12" })
  assert.equal(await page.locator("body").getAttribute("data-value"), "AB12")
  await page.evaluate(() => {
    const slider = document.createElement("div")
    slider.id = "slider"
    slider.style.cssText = "position:absolute;left:20px;top:100px;width:80px;height:40px;background:#ccc"
    document.onpointerup = () => { document.body.dataset.dragged = "yes" }
    document.body.append(slider)
  })
  await executeWritingVerificationAction(page, frames, fields, {
    action: "drag", from: { x: 40, y: 120 }, to: { x: 320, y: 120 },
  })
  assert.equal(await page.locator("body").getAttribute("data-dragged"), "yes")
  await executeWritingVerificationAction(page, frames, fields, { action: "press", key: "Tab" })
  await executeWritingVerificationAction(page, frames, fields, { action: "scroll", direction: "down", amount: 500 })
  assert.ok(await page.evaluate(() => window.scrollY > 0))
} finally {
  await browser.close()
}

process.stdout.write("writing verification tests passed\n")
process.exit(0)
