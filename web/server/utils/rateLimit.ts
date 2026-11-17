export function shouldSkipApiRateLimit(method: string, requestPath: string): boolean {
  if (method === "OPTIONS") return true
  // 回传片段走已登录用户的独立限流，连续生成不会耗尽普通 API 配额。
  if (method === "POST" && /^\/browser-model\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(requestPath)) return true
  if (method !== "GET") return false
  return requestPath === "/wechat/proxy-img" || requestPath.startsWith("/images/uploads/")
}
