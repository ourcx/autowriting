/**
 * Export sanitized metrics from a locally connected, logged-in browser.
 * Cookies and token-bearing URLs remain in the browser process.
 *
 * WECHAT_ANALYTICS_CDP_URL=http://127.0.0.1:9222 \
 *   node --import tsx scripts/collect-wechat-analytics.mjs /tmp/wechat-analysis.json
 */
import { writeFile } from "node:fs/promises"
import { readWechatAnalyticsFromBrowser } from "../server/wechatAnalyticsCollector.ts"

const output = process.argv[2]
if (!output) throw new Error("请提供输出 JSON 文件路径")

try {
  const snapshot = await readWechatAnalyticsFromBrowser()
  await writeFile(output, JSON.stringify(snapshot, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" })
  console.log(`已采集 ${snapshot.articles.length} 篇文章，${snapshot.period.start} 至 ${snapshot.period.end}。`)
} catch {
  throw new Error("采集失败。请确认本机浏览器已启用调试端口，并且只打开一个已登录的微信内容分析页。")
}
