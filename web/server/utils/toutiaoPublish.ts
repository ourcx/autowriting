import type { Page, Request } from 'playwright'

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

export function assertToutiaoPublishConfirmed(confirmed: boolean): asserts confirmed {
  if (!confirmed) {
    throw new Error('未收到今日头条的发布成功确认，文章可能仍在编辑页或草稿箱，请到头条号后台核对后重试')
  }
}

export function isToutiaoPublishEndpoint(url: string, method = "POST"): boolean {
  if (method.toUpperCase() !== "POST") return false
  try {
    const { origin, pathname } = new URL(url)
    if (origin !== "https://mp.toutiao.com") return false
    const route = pathname.replace(/\/+$/, "")
    return route === "/mp/article/publish"
      || route === "/api/pc/article/publish"
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

/**
 * 通过编辑器提交，等待头条的发布接口回执。跳转到作品列表或点击按钮都不等于提交成功。
 */
export async function submitToutiaoArticle(page: Page) {
  const isPublishRequest = (request: Request) => isToutiaoPublishEndpoint(request.url(), request.method())
  let requestStarted = false
  const observeRequest = (request: Request) => {
    if (isPublishRequest(request)) requestStarted = true
  }
  page.on('request', observeRequest)
  const response = page.waitForResponse(item => isPublishRequest(item.request()), {
    timeout: 35000,
  }).catch(() => null)

  try {
    const preview = page.getByRole('button', { name: '预览并发布', exact: true })
    await preview.click({ timeout: 5000 })

    const confirm = page.getByRole('button', { name: /^(确认发布|确定发布|立即发布|确认并发布)$/ })
      .or(page.locator('.byte-modal, .byte-dialog, [role="dialog"]').getByRole('button', { name: '发布', exact: true }))
      .filter({ visible: true }).first()
    const next = await Promise.race([
      response.then(item => item ? 'response' : 'timeout'),
      confirm.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'confirm').catch(() => 'missing'),
    ])
    // 有的版本点击预览就会发送发布请求，等待其回执，避免再次触发提交。
    if (next === 'confirm' && !requestStarted) {
      await confirm.click({ timeout: 5000 }).catch(error => {
        if (!requestStarted) throw error
      })
    }
    const receipt = await response
    assertToutiaoPublishConfirmed(receipt !== null)
    const evidence = verifyToutiaoPublishResponse(receipt.url(), receipt.status(), await receipt.text())
    if (!evidence.confirmed) throw new Error(`头条未确认发布：${evidence.detail}。请到头条号后台核对后再重试`)
  } finally {
    page.off('request', observeRequest)
  }
}
