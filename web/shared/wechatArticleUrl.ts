// 参数中含文章签名时保留原始顺序与编码，旧版分享链接可直接升级为 HTTPS。
export function normalizeWechatArticleUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (!["http:", "https:"].includes(url.protocol) || url.hostname !== "mp.weixin.qq.com"
      || url.username || url.password || url.port) return null
    if (!/^\/s\/[\w-]+\/?$/.test(url.pathname) && !(url.pathname === "/s"
      && ((url.searchParams.has("__biz") && url.searchParams.has("mid")) || url.searchParams.has("signature")))) return null
    url.protocol = "https:"
    url.hash = ""
    return url.href
  } catch { return null }
}
