export function shouldSkipApiRateLimit(method: string, requestPath: string): boolean {
  if (method === "OPTIONS") return true
  if (method !== "GET") return false
  return requestPath === "/wechat/proxy-img" || requestPath.startsWith("/images/uploads/")
}
