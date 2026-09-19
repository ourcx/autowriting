import { chmod, mkdir } from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"
import { DATA_DIR } from "../server/config.ts"

const profileDirectory = path.join(DATA_DIR, "wechat-analytics-browser")
await mkdir(profileDirectory, { recursive: true, mode: 0o700 })
await chmod(profileDirectory, 0o700)

const context = await chromium.launchPersistentContext(profileDirectory, {
  headless: false,
  args: [
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9222",
  ],
})
const page = context.pages()[0] || await context.newPage()
await page.goto("https://mp.weixin.qq.com", { waitUntil: "domcontentloaded" })
console.log("浏览器已打开。首次使用请登录公众号，再进入“数据分析 > 内容分析”。关闭浏览器即可结束。")
await new Promise(resolve => context.once("close", resolve))
