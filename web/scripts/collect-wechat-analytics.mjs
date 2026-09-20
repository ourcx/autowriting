/**
 * Export sanitized metrics with a browser-exported Cookie JSON file.
 *
 * node --import tsx scripts/collect-wechat-analytics.mjs \
 *   /path/to/wechat-cookies.json /tmp/wechat-analysis.json
 */
import { readFile, writeFile } from "node:fs/promises"
import { readWechatAnalyticsFromCookies } from "../server/wechatAnalyticsCollector.ts"

const cookieFile = process.argv[2]
const output = process.argv[3]
if (!cookieFile || !output) throw new Error("请提供 Cookie JSON 文件和输出 JSON 文件路径")

try {
  const cookies = await readFile(cookieFile, "utf8")
  const snapshot = await readWechatAnalyticsFromCookies(cookies)
  await writeFile(output, JSON.stringify(snapshot, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" })
  console.log(`已采集 ${snapshot.articles.length} 篇文章和 ${snapshot.dashboard.daily.length} 天看板数据，${snapshot.period.start} 至 ${snapshot.period.end}。`)
} catch {
  throw new Error("采集失败。请确认 Cookie JSON 来自当前已登录的微信公众平台。")
}
