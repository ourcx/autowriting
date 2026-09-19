export interface ToutiaoPublishEvidence {
  confirmed: boolean
  detail: string
}

interface ToutiaoLocator {
  first(): ToutiaoLocator
  isVisible(options?: { timeout?: number }): Promise<boolean>
  click(options?: { timeout?: number }): Promise<void>
}

interface ToutiaoPage {
  locator(selector: string): ToutiaoLocator
}

export const TOUTIAO_NO_COVER_SELECTORS = [
  'label:has-text("无封面")',
  '[role="radio"]:has-text("无封面")',
  '[class*="radio"]:has-text("无封面")',
  'text=无封面',
  'label:has-text("无图")',
  '[role="radio"]:has-text("无图")',
  '[class*="radio"]:has-text("无图")',
  'text=无图',
] as const

export async function chooseToutiaoNoCover(page: ToutiaoPage): Promise<string | null> {
  for (const selector of TOUTIAO_NO_COVER_SELECTORS) {
    const option = page.locator(selector).first()
    if (!await option.isVisible({ timeout: 1200 }).catch(() => false)) continue
    const clicked = await option.click({ timeout: 5000 }).then(() => true).catch(() => false)
    if (clicked) return selector
  }
  return null
}

export function assertToutiaoPublishConfirmed(confirmed: boolean): void {
  if (!confirmed) {
    throw new Error('未收到今日头条的发布成功确认，文章可能仍在编辑页或草稿箱，请到头条号后台核对后重试')
  }
}

export function isToutiaoPublishEndpoint(url: string, method = "POST"): boolean {
  if (method.toUpperCase() !== "POST") return false
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "")
    return pathname === "/mp/article/publish"
      || pathname === "/api/pc/article/publish"
  } catch {
    return false
  }
}

export function verifyToutiaoPublishResponse(url: string, status: number, body: string): ToutiaoPublishEvidence {
  if (!isToutiaoPublishEndpoint(url)) return { confirmed: false, detail: "不是发布接口" }
  if (status < 200 || status >= 300) return { confirmed: false, detail: `HTTP ${status}` }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return { confirmed: false, detail: "发布接口未返回 JSON" }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { confirmed: false, detail: "发布接口响应格式异常" }
  }

  const result = payload as Record<string, unknown>
  const rawCode = [result.code, result.err_no, result.errno].find(value => (
    typeof value === "number" || (typeof value === "string" && /^-?\d+$/.test(value))
  ))
  const explicitCode = rawCode === undefined ? undefined : Number(rawCode)
  const message = typeof result.message === "string" ? result.message.trim().toLowerCase() : ""
  const confirmed = result.success !== false && (explicitCode === 0
    || (explicitCode === undefined && result.success === true)
    || (explicitCode === undefined && result.success === undefined && message === "success"))

  if (confirmed) return { confirmed: true, detail: "发布接口明确返回成功" }
  return {
    confirmed: false,
    detail: typeof result.message === "string" && result.message.trim()
      ? result.message.trim().slice(0, 200)
      : "发布接口未返回成功状态",
  }
}
