import fs from "node:fs"
import path from "node:path"
import { chromium, type Locator, type Page } from "playwright"
import { WECHAT_PUBLISH_DEBUG_DIR } from "../config.ts"
import {
  DEFAULT_WECHAT_BROWSER_PUBLISH_OPTIONS,
  wechatBrowserPublishOptionsSchema,
  type WechatBrowserPublishOptions,
} from "../../shared/wechatPublish.ts"
import { parseWechatCookieJson } from "./platformCookies.ts"

const WECHAT_HOME = "https://mp.weixin.qq.com/"
const WECHAT_DRAFT_CARD_SELECTORS = [
  ".publish_card",
  ".appmsg_card",
  ".media_appmsg_item",
  ".card_appmsg_item",
]
const WECHAT_EDITOR_TITLE_SELECTORS = ["#title", 'input[name="title"]', 'textarea[name="title"]']
const WECHAT_HEADLESS = process.env.WECHAT_PUBLISH_HEADLESS !== "false"

interface WechatPublishTarget {
  title: string
  index: number
}

export interface WechatBrowserPublishResult {
  status: "published" | "reviewing"
  title: string
  evidence: string[]
}

export class WechatPublishOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WechatPublishOutcomeUnknownError"
  }
}

function safeArtifactName(value: string): string {
  return value.replace(/[^\w\u4e00-\u9fa5-]+/g, "-").slice(0, 40)
}

async function captureEvidence(page: Page, step: string): Promise<string> {
  fs.mkdirSync(WECHAT_PUBLISH_DEBUG_DIR, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const filename = `${timestamp}-${safeArtifactName(step)}.png`
  const screenshotPath = path.join(WECHAT_PUBLISH_DEBUG_DIR, filename)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  return filename
}

export async function findFirstVisible(page: Page, selectors: string[], timeout = 5000): Promise<Locator | null> {
  const locator = page.locator(selectors.map((selector) => `:is(${selector}):visible`).join(", ")).first()
  return locator.waitFor({ state: "visible", timeout }).then(() => locator).catch(() => null)
}

async function readSwitchState(control: Locator): Promise<boolean | null> {
  const input = control.locator('input[type="checkbox"]').first()
  if (await input.count()) return input.isChecked()
  if (await control.evaluate((element) => element instanceof HTMLInputElement && element.type === "checkbox")) {
    return control.isChecked()
  }
  const ariaChecked = await control.getAttribute("aria-checked")
  if (ariaChecked === "true") return true
  if (ariaChecked === "false") return false
  const className = await control.getAttribute("class") || ""
  if (/(?:^|[_\s-])(checked|selected|on)(?:$|[_\s-])/.test(className)) return true
  if (/(?:^|[_\s-])(unchecked|off)(?:$|[_\s-])/.test(className)) return false
  return null
}

async function optionControl(root: Page | Locator, labels: string[]): Promise<{ label: Locator; control: Locator } | null> {
  for (const text of labels) {
    const label = root.getByText(text, { exact: true }).filter({ visible: true }).last()
    if (!await label.count()) continue
    const row = label.locator(
      'xpath=ancestor-or-self::*['
      + 'count(.//input[@type="checkbox"] | .//*[@role="switch"] | .//*[contains(@class,"switch__box")])=1'
      + '][1]',
    )
    if (!await row.count()) continue
    const control = row.locator('input[type="checkbox"], [role="switch"], [class*="switch__box"]').first()
    if (await control.count()) return { label, control }
  }
  return null
}

export async function setWechatLabeledSwitch(
  root: Page | Locator,
  labels: string[],
  enabled: boolean,
): Promise<void> {
  const option = await optionControl(root, labels)
  if (!option) throw new Error(`未找到微信后台“${labels[0]}”设置，页面可能已更新或账号未开通该能力`)
  const current = await readSwitchState(option.control)
  if (current === enabled) return
  if (current === null) throw new Error(`无法确认微信后台“${labels[0]}”当前状态，已停止发布`)

  const input = option.control.locator('input[type="checkbox"]').first()
  if (await input.count() && await input.isEnabled()) {
    if (await input.isVisible()) {
      await input.setChecked(enabled)
    } else {
      const switchRoot = input.locator('xpath=ancestor::*[contains(@class,"switch")][1]')
      if (await switchRoot.count()) await switchRoot.click()
      else await option.label.click()
    }
  } else {
    if (!await option.control.isEnabled()) throw new Error(`微信后台当前不允许修改“${labels[0]}”`)
    await option.control.click()
  }

  if (await readSwitchState(option.control) !== enabled) {
    throw new Error(`微信后台“${labels[0]}”未设置成功，已停止发布`)
  }
}

async function visibleWechatDialog(page: Page, text: RegExp, timeout = 5000): Promise<Locator | null> {
  const dialog = page.locator('[role="dialog"]:visible, .weui-desktop-dialog:visible, .dialog_wrp:visible')
    .filter({ hasText: text })
    .last()
  return dialog.waitFor({ state: "visible", timeout }).then(() => dialog).catch(() => null)
}

async function confirmDialog(dialog: Locator, labels: RegExp): Promise<void> {
  const button = dialog.getByRole("button", { name: labels }).filter({ visible: true }).last()
  if (!await button.count()) throw new Error("微信后台设置弹窗缺少确认按钮，已停止发布")
  await button.click()
  await dialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {
    throw new Error("微信后台设置未保存，已停止发布")
  })
}

export async function enableWechatAllAds(page: Page): Promise<void> {
  const entry = page.getByText(/^(广告|广告设置|文中广告)$/).filter({ visible: true }).last()
  if (!await entry.count()) throw new Error("未找到微信流量主广告设置，请确认公众号已开通流量主")
  await entry.scrollIntoViewIfNeeded()
  await entry.click()

  const dialog = await visibleWechatDialog(page, /广告/)
  if (!dialog) throw new Error("微信流量主广告设置没有打开，已停止发布")
  const allAds = dialog.getByText(/^(打开全部广告|全部广告)$/).filter({ visible: true }).last()
  if (!await allAds.count()) throw new Error("未找到“打开全部广告”选项，微信页面可能已更新")

  const row = allAds.locator(
    'xpath=ancestor-or-self::*['
    + 'count(.//input[@type="checkbox"] | .//input[@type="radio"] | .//*[@role="checkbox"] | .//*[@role="radio"])=1'
    + '][1]',
  )
  const control = row.locator('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]').first()
  if (await control.count()) {
    const checked = await control.evaluate((element) => (
      element instanceof HTMLInputElement
        ? element.checked
        : element.getAttribute("aria-checked") === "true"
    ))
    if (!checked) {
      if (await control.isVisible()) await control.click()
      else await allAds.click()
    }
    const verified = await control.evaluate((element) => (
      element instanceof HTMLInputElement
        ? element.checked
        : element.getAttribute("aria-checked") === "true"
    ))
    if (!verified) throw new Error("“打开全部广告”没有选中，已停止发布")
  } else {
    await allAds.click()
    const selected = await allAds.getAttribute("class") || ""
    const ariaChecked = await allAds.getAttribute("aria-checked")
    if (!/(?:selected|checked|active)/.test(selected) && ariaChecked !== "true") {
      throw new Error("无法确认“打开全部广告”的选择状态，已停止发布")
    }
  }
  await confirmDialog(dialog, /^(确定|完成|保存)$/)
}

async function confirmOriginalDeclaration(page: Page): Promise<void> {
  const dialog = await visibleWechatDialog(page, /原创/, 1500)
  if (!dialog) return
  const consent = dialog.getByText(/我已阅读并同意/).filter({ visible: true }).first()
  if (await consent.count()) {
    const row = consent.locator('xpath=ancestor-or-self::*[.//input[@type="checkbox"]][1]')
    const checkbox = row.locator('input[type="checkbox"]').first()
    if (!await checkbox.count()) throw new Error("原创声明弹窗缺少协议确认项")
    if (!await checkbox.isChecked()) {
      if (await checkbox.isVisible()) await checkbox.check()
      else await consent.click()
    }
    if (!await checkbox.isChecked()) throw new Error("原创声明协议未确认")
  }
  await confirmDialog(dialog, /^(声明原创|确定|确认)$/)
}

export async function configureWechatEditor(
  page: Page,
  options: WechatBrowserPublishOptions,
): Promise<void> {
  if (options.declareOriginal) {
    await setWechatLabeledSwitch(page, ["原创声明", "声明原创"], true)
    await confirmOriginalDeclaration(page)
  }
  if (options.commentMode !== "keep") {
    const open = options.commentMode !== "off"
    await setWechatLabeledSwitch(page, ["留言", "评论"], open)
    if (open) {
      await setWechatLabeledSwitch(
        page,
        ["仅关注后可留言", "仅关注用户可留言", "仅关注者可留言", "仅粉丝可留言"],
        options.commentMode === "fans",
      )
    }
  }
  if (options.enableAllAds) await enableWechatAllAds(page)
}

async function resolveWechatToken(page: Page): Promise<string> {
  await page.goto(WECHAT_HOME, { waitUntil: "domcontentloaded", timeout: 20000 })
  if (/login|cgi-bin\/login/i.test(page.url())) throw new Error("公众号后台 Cookie 已失效，请重新绑定")
  const direct = new URL(page.url()).searchParams.get("token")
  if (direct) return direct
  const href = await page.locator('a[href*="token="]').first().getAttribute("href").catch(() => null)
  const token = href ? new URL(href, WECHAT_HOME).searchParams.get("token") : null
  if (!token) throw new Error("未能从公众号后台登录态取得 token，请重新绑定 Cookie")
  return token
}

async function openTargetDraft(page: Page, token: string, target: WechatPublishTarget): Promise<Page> {
  const listUrl = new URL("https://mp.weixin.qq.com/cgi-bin/appmsg")
  listUrl.searchParams.set("begin", String(target.index))
  listUrl.searchParams.set("count", "10")
  listUrl.searchParams.set("type", "77")
  listUrl.searchParams.set("action", "list_card")
  listUrl.searchParams.set("token", token)
  listUrl.searchParams.set("lang", "zh_CN")
  await page.goto(listUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30000 })
  const title = page.getByText(target.title, { exact: true }).filter({ visible: true }).first()
  await title.waitFor({ state: "visible", timeout: 15000 }).catch(() => {
    throw new Error(`微信草稿箱未找到“${target.title}”，请刷新草稿列表后重试`)
  })
  let card = title.locator(
    `xpath=ancestor::*[${WECHAT_DRAFT_CARD_SELECTORS
      .map((selector) => `contains(concat(" ", normalize-space(@class), " "), " ${selector.slice(1)} ")`)
      .join(" or ")}][1]`,
  )
  if (!await card.count()) {
    card = title.locator('xpath=ancestor::*[.//a[contains(@href,"appmsg_edit") or contains(@href,"action=edit")]][1]')
  }
  if (!await card.count()) throw new Error("无法定位微信草稿卡片，页面结构可能已更新")

  await card.hover()
  const editLink = card.locator('a[href*="appmsg_edit"], a[href*="action=edit"]').filter({ visible: true }).first()
  if (await editLink.count()) {
    const href = await editLink.getAttribute("href")
    if (href) {
      await page.goto(new URL(href, WECHAT_HOME).toString(), { waitUntil: "domcontentloaded", timeout: 30000 })
      return page
    }
  }

  const editButton = card.getByRole("button", { name: /编辑/ }).filter({ visible: true }).first()
  const editAnchor = card.getByRole("link", { name: /编辑/ }).filter({ visible: true }).first()
  const trigger = await editButton.count() ? editButton : editAnchor
  if (!await trigger.count()) throw new Error("微信草稿卡片没有可用的编辑入口，页面结构可能已更新")
  const opened = page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null)
  await trigger.click()
  const nextPage = await opened || page
  await nextPage.waitForLoadState("domcontentloaded")
  return nextPage
}

async function verifyEditorTitle(page: Page, expectedTitle: string): Promise<void> {
  const title = await findFirstVisible(page, WECHAT_EDITOR_TITLE_SELECTORS, 15000)
  if (!title) throw new Error("未进入微信草稿编辑页，已停止发布")
  const actual = await title.inputValue()
  if (actual.trim() !== expectedTitle.trim()) {
    throw new Error(`微信编辑页标题不匹配：预期“${expectedTitle}”，实际“${actual.trim()}”`)
  }
}

export async function openWechatPublishDialog(page: Page): Promise<Locator> {
  const button = await findFirstVisible(page, [
    '#js_send button:enabled',
    '#js_send:enabled',
    'button:has-text("发表"):enabled',
  ], 10000)
  if (!button) throw new Error("未找到微信“发表”按钮，已停止发布")
  await button.scrollIntoViewIfNeeded()
  await button.click()
  const dialog = await visibleWechatDialog(page, /群发通知|定时发表|发表/)
  if (!dialog) throw new Error("微信发表设置没有打开，已停止发布")
  const notifyOption = await optionControl(dialog, ["群发通知"])
  if (notifyOption) {
    await setWechatLabeledSwitch(dialog, ["群发通知"], false)
  } else {
    const text = (await dialog.innerText()).replace(/\s+/g, "")
    if (!text.includes("未开启群发通知")) {
      throw new Error("无法确认群发通知已关闭，已停止发布")
    }
  }
  return dialog
}

export async function submitWechatPublishOnce(
  page: Page,
  dialog: Locator,
  timeout = 12000,
): Promise<"published" | "reviewing"> {
  const finalButton = dialog.getByRole("button", { name: /^(发表|发布)$/ })
    .filter({ visible: true })
    .last()
  if (!await finalButton.count() || !await finalButton.isEnabled()) {
    throw new Error("微信最终发表按钮不可用，尚未提交")
  }
  try {
    await finalButton.click({ timeout: 5000 })
  } catch {
    throw new WechatPublishOutcomeUnknownError("微信发表点击未能确认，请先到公众号后台核对，勿重复发布")
  }

  const immediateSuccess = page.getByText(/^(发表成功|发布成功|已提交审核)$/)
    .filter({ visible: true })
    .first()
  const successVisible = await immediateSuccess.waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false)
  if (successVisible) return /审核/.test(await immediateSuccess.innerText()) ? "reviewing" : "published"

  const verification = await visibleWechatDialog(page, /微信验证|管理员验证|扫码|继续发表|继续群发/, 1000)
  if (verification) {
    const text = (await verification.innerText()).replace(/\s+/g, " ").trim().slice(0, 160)
    throw new WechatPublishOutcomeUnknownError(`微信要求人工确认：${text}。请到公众号后台处理，勿重复发布`)
  }

  throw new WechatPublishOutcomeUnknownError("微信已收到发表操作，但未出现明确成功状态，请先到发表记录核对，勿重复发布")
}

export async function publishWechatDraftInBrowser(input: {
  cookies: unknown
  target: WechatPublishTarget
  options?: unknown
}): Promise<WechatBrowserPublishResult> {
  const cookies = parseWechatCookieJson(input.cookies)
  const parsedOptions = wechatBrowserPublishOptionsSchema.safeParse(
    input.options ?? DEFAULT_WECHAT_BROWSER_PUBLISH_OPTIONS,
  )
  if (!parsedOptions.success) throw new Error(parsedOptions.error.issues[0]?.message || "微信发布配置不正确")
  const title = input.target.title.trim()
  if (!title || title.length > 128) throw new Error("微信草稿标题不正确")
  if (!Number.isSafeInteger(input.target.index) || input.target.index < 0 || input.target.index > 499) {
    throw new Error("微信草稿位置不正确，请刷新草稿列表后重试")
  }

  const browser = await chromium.launch({
    headless: WECHAT_HEADLESS,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const evidence: string[] = []
  let page = await context.newPage()
  try {
    await context.addCookies(cookies)
    const token = await resolveWechatToken(page)
    page = await openTargetDraft(page, token, input.target)
    await verifyEditorTitle(page, title)
    evidence.push(await captureEvidence(page, "draft-before-settings"))
    await configureWechatEditor(page, parsedOptions.data)
    evidence.push(await captureEvidence(page, "draft-after-settings"))
    const dialog = await openWechatPublishDialog(page)
    evidence.push(await captureEvidence(page, "publish-confirmation"))
    const status = await submitWechatPublishOnce(page, dialog)
    evidence.push(await captureEvidence(page, `publish-${status}`))
    return { status, title, evidence }
  } catch (error) {
    try {
      evidence.push(await captureEvidence(page, "publish-failed"))
    } catch { /* 保留原始发布错误 */ }
    throw error
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}
