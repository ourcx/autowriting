import { Router } from "express"
import path from "path"
import { chromium, type Cookie } from "playwright"
import { randomUUID } from "crypto"
import { marked } from "marked"
import { UPLOAD_DIR } from "../config.ts"
import {
  buildLLMRequest,
  callLLMWithRetry,
  createXiaohongshuPublishLock,
  removeXiaohongshuPublishLock,
  saveXiaohongshuDebugArtifacts,
} from "../utils/index.ts"
import {
  completeXiaohongshuPublishRecord,
  createXiaohongshuPublishRecord,
  failXiaohongshuPublishRecord,
  listXiaohongshuPublishRecords,
} from "../db.ts"
import { logger } from "../logger.ts"
import { authMiddleware } from "../authMiddleware.ts"

const router = Router()
router.use(authMiddleware)

const XIAOHONGSHU_PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
const CONTENT_MAX_LENGTH = 1000
const ARTICLE_CONTENT_MAX_LENGTH = 10000
const MAX_IMAGES = 9
// 同一 tab 会同时渲染埋点覆盖层（button-hp-installed）和真实 Vue 节点。
// 覆盖层带 aria-hidden，真正的可点击节点带 data-hp-bound。
const IMAGE_NOTE_TAB = ".creator-tab[data-hp-bound]:has-text('上传图文')"
const ARTICLE_EDITOR = ".tiptap.ProseMirror[contenteditable='true']"
const ARTICLE_TITLE = ".rich-editor-title textarea.d-text:not(.d-textarea-shadow)"
const ARTICLE_SUMMARY = "[data-dom-type='summary']"
const ARTICLE_FINAL_TITLE = 'input[placeholder*="填写标题"]'
const KEEP_XIAOHONGSHU_BROWSER_OPEN_ON_FAILURE = process.env.XIAOHONGSHU_KEEP_BROWSER_OPEN !== "false"

function parseCookies(rawCookies: unknown): Cookie[] | null {
  try {
    const cookies = typeof rawCookies === "string" ? JSON.parse(rawCookies) : rawCookies
    if (!Array.isArray(cookies) || cookies.length === 0) return null
    return cookies.map((cookie) => ({
      name: String(cookie.name || ""),
      value: String(cookie.value || ""),
      domain: String(cookie.domain || ".xiaohongshu.com"),
      path: String(cookie.path || "/"),
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
      sameSite: ["Strict", "Lax", "None"].includes(cookie.sameSite) ? cookie.sameSite : "Lax",
    })).filter((cookie) => cookie.name && cookie.value)
  } catch {
    return null
  }
}

function normalizeText(value: unknown, limit: number): string {
  return String(value || "").trim().slice(0, limit)
}

function parseContentType(value: unknown): "image_note" | "article" | null {
  return value === "image_note" || value === "article" ? value : null
}

function parseTopics(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((topic): topic is string => typeof topic === "string")
    .map((topic) => topic.replace(/^#/, "").trim())
    .filter(Boolean)
    .slice(0, 5)
}

function parseXiaohongshuMetadata(value: string): {
  title: string
  summary: string
  topics: string[]
} {
  const json = value.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error("AI 未返回可解析的发布信息")
  const parsed: unknown = JSON.parse(json)
  if (!parsed || typeof parsed !== "object") throw new Error("AI 发布信息格式不正确")
  const data = parsed as Record<string, unknown>
  return {
    title: String(data.title || "").trim(),
    summary: normalizeText(data.summary, 60),
    topics: parseTopics(data.topics),
  }
}

function getLocalImagePaths(imageUrls: unknown): string[] {
  if (!Array.isArray(imageUrls)) return []
  return imageUrls
    .filter((imageUrl): imageUrl is string => typeof imageUrl === "string")
    .filter((imageUrl) => imageUrl.startsWith("/api/images/uploads/"))
    .slice(0, MAX_IMAGES)
    .map((imageUrl) => path.join(UPLOAD_DIR, path.basename(imageUrl)))
}

async function findFirstVisible(page: import("playwright").Page, selectors: string[]): Promise<import("playwright").Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first()
    if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) return locator
  }
  return null
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function getPageDiagnostics(page: import("playwright").Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 1200),
    contenteditables: Array.from(document.querySelectorAll('[contenteditable="true"]'))
      .slice(0, 12)
      .map((element) => ({
        className: element.className,
        role: element.getAttribute("role"),
        text: (element.textContent || "").trim().slice(0, 100),
      })),
    creationButtons: Array.from(document.querySelectorAll("button, [role='button']"))
      .filter((element) => /新的创作|新建创作|写长文/.test(element.textContent || ""))
      .slice(0, 12)
      .map((element) => ({
        text: (element.textContent || "").trim(),
        className: element.className,
        ariaHidden: element.getAttribute("aria-hidden"),
      })),
    footerButtons: Array.from(document.querySelectorAll(".footer-new button, button"))
      .filter((element) => /一键排版|下一步|暂存离开|发布/.test(element.textContent || ""))
      .slice(0, 12)
      .map((element) => ({
        text: (element.textContent || "").trim(),
        className: element.className,
        disabled: (element as HTMLButtonElement).disabled,
        outerHtml: element.outerHTML.slice(0, 600),
      })),
    finalPublishButtons: Array.from(document.querySelectorAll("xhs-publish-btn, .publish-btn button, .publish-page-publish-btn button"))
      .slice(0, 6)
      .map((element) => ({
        text: (element.textContent || "").trim(),
        className: element.className,
        disabled: (element as HTMLButtonElement).disabled,
        ariaBusy: element.getAttribute("aria-busy"),
        ariaDisabled: element.getAttribute("aria-disabled"),
      })),
    processingHints: (document.body.innerText || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => /图片.*(生成|上传)|笔记图片|正在处理|处理中|生成中|上传中/.test(line))
      .slice(0, 20),
  }))
}

async function logPageState(page: import("playwright").Page, step: string): Promise<void> {
  try {
    logger.info("XIAOHONGSHU", `页面状态：${step}`, await getPageDiagnostics(page))
  } catch (error) {
    logger.warn("XIAOHONGSHU", `采集页面状态失败：${step}`, { error: summarizeError(error) })
  }
}

async function captureFailureArtifacts(page: import("playwright").Page, step: string): Promise<void> {
  try {
    const { screenshotPath, htmlPath } = saveXiaohongshuDebugArtifacts({
      step,
      screenshot: await page.screenshot({ fullPage: true }),
      html: await page.content(),
    })
    logger.warn("XIAOHONGSHU", `已保存失败页面快照：${step}`, { screenshotPath, htmlPath })
  } catch (error) {
    logger.warn("XIAOHONGSHU", `保存失败页面快照失败：${step}`, { error: summarizeError(error) })
  }
}

async function waitForAnySelector(
  page: import("playwright").Page,
  selectors: string[],
  timeout = 15000,
): Promise<boolean> {
  const results = await Promise.all(
    selectors.map((selector) => page.locator(selector).first()
      .waitFor({ state: "visible", timeout })
      .then(() => true)
      .catch(() => false)),
  )
  return results.some(Boolean)
}

async function fillText(locator: import("playwright").Locator, text: string): Promise<void> {
  await locator.click()
  await locator.fill(text).catch(async () => {
    await locator.evaluate((element, value) => {
      element.textContent = value as string
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value as string }))
      element.dispatchEvent(new Event("change", { bubbles: true }))
    }, text)
  })
}

async function fillContentEditable(locator: import("playwright").Locator, text: string): Promise<void> {
  await locator.click()
  await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
  await locator.press("Backspace")
  await locator.pressSequentially(text, { delay: 1 })
}

async function fillLongArticleBody(locator: import("playwright").Locator, markdown: string): Promise<void> {
  const html = marked.parse(markdown, { async: false, breaks: true, gfm: true })
  const inserted = await locator.evaluate((element, value) => {
    element.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)
    const success = document.execCommand("insertHTML", false, value)
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertFromPaste",
      data: null,
    }))
    return success
  }, html)

  if (!inserted) await fillContentEditable(locator, markdown)
}

function removeDuplicateArticleTitle(markdown: string, title: string): string {
  const normalizedTitle = title.trim()
  const lines = markdown.split(/\r?\n/)
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0)
  if (firstContentIndex === -1) return markdown

  const firstLine = lines[firstContentIndex].replace(/^#\s+/, "").trim()
  if (firstLine !== normalizedTitle) return markdown

  lines.splice(firstContentIndex, 1)
  if (lines[firstContentIndex]?.trim() === "") lines.splice(firstContentIndex, 1)
  return lines.join("\n")
}

async function fillLongArticleCoverField(
  page: import("playwright").Page,
  containerSelector: string,
  text: string,
): Promise<boolean> {
  const editable = await findFirstVisible(page, [
    `${containerSelector} [contenteditable='true']`,
    `${containerSelector} input`,
    `${containerSelector} textarea`,
  ])
  if (editable) {
    await fillText(editable, text)
    return true
  }

  const container = await findFirstVisible(page, [containerSelector])
  if (!container) return false
  await container.click()
  await page.waitForTimeout(250)

  const activatedField = await findFirstVisible(page, [
    `${containerSelector} [contenteditable='true']`,
    `${containerSelector} input`,
    `${containerSelector} textarea`,
    '[contenteditable="true"][data-dom-type="editable-text"]',
  ])
  if (activatedField) {
    await fillText(activatedField, text)
    return true
  }

  // 小红书标题节点本身是 contenteditable=false；点击后由页面接管键盘输入。
  // 这里不再把标题写进正文，而是直接向已激活的标题节点输入。
  const activeElement = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null
    return {
      tagName: element?.tagName || "",
      className: element?.className || "",
      contentEditable: element?.getAttribute("contenteditable"),
    }
  })
  if (activeElement.tagName === "BODY") return false

  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
  await page.keyboard.press("Backspace")
  await page.keyboard.insertText(text)
  await page.waitForTimeout(150)
  return true
}

async function fillLongArticle(page: import("playwright").Page, input: {
  title: string
  content: string
  summary: string
  templateName: string
  coverType: "with_image" | "without_image"
  showAuthor: boolean
  showReadingTime: boolean
  showSummary: boolean
}): Promise<void> {
  const editor = await findFirstVisible(page, [ARTICLE_EDITOR])
  if (!editor) throw new Error("未找到小红书长文编辑器，平台页面可能已更新")

  const titleInput = await findFirstVisible(page, [
    ARTICLE_TITLE,
    '.rich-editor-title textarea[placeholder="输入标题"]',
    'textarea[placeholder="输入标题"]',
  ])
  const coverTitleFilled = titleInput
    ? await fillText(titleInput, input.title).then(() => true)
    : await fillLongArticleCoverField(page, ARTICLE_TITLE, input.title)
  if (!coverTitleFilled) {
    logger.warn("XIAOHONGSHU", "未定位到长文封面标题字段，将在下一步发布页填写标题", {
      ...(await getPageDiagnostics(page)),
      label: "标题",
    })
  } else {
    logger.info("XIAOHONGSHU", "长文标题已填入", {
      value: await titleInput?.inputValue().catch(() => input.title) ?? input.title,
    })
  }

  await fillLongArticleBody(editor, removeDuplicateArticleTitle(input.content, input.title))

  if (input.summary) {
    const coverSummaryFilled = await fillLongArticleCoverField(page, ARTICLE_SUMMARY, input.summary)
    if (!coverSummaryFilled) {
      logger.warn("XIAOHONGSHU", "未定位到长文封面摘要字段，继续使用平台默认摘要展示", {
        ...(await getPageDiagnostics(page)),
        label: "摘要",
      })
    }
  }

  const templateCard = page.locator(".template-card-new, .template-card")
    .filter({ hasText: input.templateName })
    .first()
  if (await templateCard.isVisible({ timeout: 1500 }).catch(() => false)) {
    await templateCard.click()
    await page.waitForTimeout(350)
  } else {
    logger.warn("XIAOHONGSHU", "未找到指定长文模板，保留平台默认模板", { templateName: input.templateName })
  }

  const coverSettingsTab = page.getByText("封面设置", { exact: true }).first()
  if (await coverSettingsTab.isVisible({ timeout: 1500 }).catch(() => false)) {
    await coverSettingsTab.click()
    const coverName = input.coverType === "with_image" ? "有图封面" : "无图封面"
    const coverItem = page.locator(".cover-item").filter({ hasText: coverName }).first()
    if (await coverItem.isVisible({ timeout: 1500 }).catch(() => false)) await coverItem.click()

    await setCoverSetting(page, "作者", input.showAuthor)
    await setCoverSetting(page, "字数和时长", input.showReadingTime)
    await setCoverSetting(page, "摘要", input.showSummary)
  }

  await page.waitForTimeout(1200)
}

async function setCoverSetting(page: import("playwright").Page, label: string, enabled: boolean): Promise<void> {
  const setting = page.locator(".setting-item").filter({ hasText: label }).first()
  const checkbox = setting.locator('input[type="checkbox"]').first()
  if (!await checkbox.isVisible({ timeout: 900 }).catch(() => false)) return
  const checked = await checkbox.isChecked().catch(() => enabled)
  if (checked !== enabled) await checkbox.click()
}

async function applyLongArticleLayout(page: import("playwright").Page): Promise<void> {
  const nextStepSelectors = [
    '.footer-new button.submit:has-text("下一步")',
    '.new-ui-footer button.next-btn:has-text("下一步")',
  ]
  const nextStepReady = await waitForEnabledSelector(page, nextStepSelectors, 1200)
  if (nextStepReady) return

  await logPageState(page, "准备一键排版")
  const layoutButton = await findFirstVisible(page, [
    '.new-ui-footer button.next-btn:has-text("一键排版")',
    '.footer.new-ui-footer button.next-btn',
    'button.next-btn:has-text("一键排版")',
    '.footer-new button:has-text("一键排版")',
    'button:has-text("一键排版")',
  ])
  if (!layoutButton) {
    await logPageState(page, "未找到一键排版或下一步")
    await captureFailureArtifacts(page, "未找到一键排版")
    throw new Error("未找到小红书“一键排版”按钮，无法将正文转换为长文卡片")
  }

  logger.info("XIAOHONGSHU", "开始一键排版长文")
  await layoutButton.click({ force: true })
  await page.waitForTimeout(800)
  await logPageState(page, "点击一键排版后")
  const layoutCompleted = await waitForEnabledSelector(page, nextStepSelectors, 60000)
  if (!layoutCompleted) {
    await logPageState(page, "一键排版后未出现下一步")
    await captureFailureArtifacts(page, "一键排版失败")
    throw new Error("小红书一键排版后未出现“下一步”按钮，请检查平台页面状态")
  }
  logger.info("XIAOHONGSHU", "一键排版完成，下一步已就绪")
}

async function waitForEnabledSelector(
  page: import("playwright").Page,
  selectors: string[],
  timeout: number,
): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first()
      const enabled = await locator.isVisible({ timeout: 300 }).catch(() => false)
        && await locator.isEnabled().catch(() => false)
      if (enabled) return true
    }
    await page.waitForTimeout(500)
  }
  return false
}

async function waitForFinalPublishReady(page: import("playwright").Page, timeout = 15000): Promise<import("playwright").Locator | null> {
  const shadowHostSelector = 'xhs-publish-btn[is-publish="true"][submit-text="发布"]'
  const publishSelectors = [
    ".publish-btn button.ce-btn.bg-red",
    ".publish-btn button.bg-red",
    ".publish-page-publish-btn button.ce-btn.bg-red",
    ".publish-page-publish-btn button.bg-red",
  ]
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const state = await page.evaluate((selectors) => {
      const host = document.querySelector('xhs-publish-btn[is-publish="true"][submit-text="发布"]')
      const button = selectors
        .map((selector) => document.querySelector(selector) as HTMLButtonElement | null)
        .find(Boolean) ?? null
      return {
        shadowHostPresent: !!host,
        hostSubmitDisabled: host?.getAttribute("submit-disabled") ?? "",
        hostSubmitLoading: host?.getAttribute("submit-loading") ?? "",
        buttonPresent: !!button,
        buttonDisabled: button?.disabled ?? true,
        ariaBusy: button?.getAttribute("aria-busy") ?? "",
        ariaDisabled: button?.getAttribute("aria-disabled") ?? "",
        className: button?.className ?? "",
      }
    }, publishSelectors)

    const hostReady = state.shadowHostPresent
      && state.hostSubmitDisabled !== "true"
      && state.hostSubmitLoading !== "true"
    const directButtonReady = state.buttonPresent
      && !state.buttonDisabled
      && state.ariaBusy !== "true"
      && state.ariaDisabled !== "true"
    if (hostReady) {
      const host = page.locator(shadowHostSelector).first()
      if (await host.isVisible({ timeout: 500 }).catch(() => false)) {
        logger.info("XIAOHONGSHU", "最终发布 Shadow DOM 宿主已就绪", {
          submitDisabled: state.hostSubmitDisabled,
          submitLoading: state.hostSubmitLoading,
        })
        return host
      }
    }
    if (directButtonReady) {
      for (const selector of publishSelectors) {
        const button = page.locator(selector).first()
        if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
          logger.info("XIAOHONGSHU", "最终发布按钮已就绪", {
            selector,
            className: state.className,
            ariaBusy: state.ariaBusy,
            ariaDisabled: state.ariaDisabled,
          })
          return button
        }
      }
    }
    await page.waitForTimeout(1000)
  }

  await logPageState(page, "等待最终发布图片就绪超时")
  await captureFailureArtifacts(page, "最终发布图片就绪超时")
  return null
}

async function clickFinalPublishWithRetries(page: import("playwright").Page): Promise<void> {
  const maxAttempts = 4

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const button = await waitForFinalPublishReady(page, 5000)
    if (!button) {
      logger.warn("XIAOHONGSHU", "最终发布按钮本轮未就绪，准备重试", { attempt, maxAttempts })
      await page.waitForTimeout(1500)
      continue
    }

    try {
      await button.scrollIntoViewIfNeeded()
      logger.info("XIAOHONGSHU", "尝试点击最终发布按钮", { attempt, maxAttempts })
      const tagName = await button.evaluate((element) => element.tagName.toLowerCase())
      if (tagName === "xhs-publish-btn") {
        const box = await button.boundingBox()
        if (!box) throw new Error("最终发布 Shadow DOM 宿主无法获取位置")
        // closed Shadow DOM 无法直接用 selector 定位内部按钮。宿主内部固定为
        // “暂存离开 + 24px 间隔 + 发布”两颗 120px 按钮，红色发布按钮在右侧。
        const publishButtonCenterX = box.x + box.width / 2 + 72
        const publishButtonCenterY = box.y + box.height / 2
        logger.info("XIAOHONGSHU", "通过 Shadow DOM 宿主坐标点击发布", {
          host: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
          click: { x: Math.round(publishButtonCenterX), y: Math.round(publishButtonCenterY) },
        })
        await page.mouse.click(publishButtonCenterX, publishButtonCenterY)
      } else {
        await button.click({ force: true })
      }

      const published = await Promise.race([
        page.waitForURL(/(published|note|home|manage)/i, { timeout: 8000 }).then(() => true).catch(() => false),
        page.getByText(/发布成功|已发布/).first().waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false),
      ])
      if (published) {
        logger.info("XIAOHONGSHU", "最终发布按钮点击成功", { attempt })
        return
      }
      logger.warn("XIAOHONGSHU", "点击发布后未确认成功，准备重试", { attempt, maxAttempts })
    } catch (error) {
      logger.warn("XIAOHONGSHU", "点击最终发布按钮失败，准备重试", {
        attempt,
        maxAttempts,
        error: summarizeError(error),
      })
    }
    await page.waitForTimeout(1500)
  }

  await logPageState(page, "最终发布多次点击仍未成功")
  await captureFailureArtifacts(page, "最终发布多次点击失败")
  throw new Error("多次尝试点击小红书最终发布按钮仍未成功")
}

async function fillFinalArticleMetadata(page: import("playwright").Page, input: {
  title: string
  summary: string
  topics: string[]
  original: boolean
}): Promise<void> {
  const title = await findFirstVisible(page, [
    ARTICLE_FINAL_TITLE,
    '.publish-page-content-base input[placeholder*="填写标题"]',
  ])
  if (!title) throw new Error("未找到小红书最终发布标题输入框，平台页面可能已更新")
  await fillText(title, input.title)

  if (input.summary) {
    const description = await findFirstVisible(page, [
      '.publish-page-content-base textarea[placeholder*="简介"]',
      '.publish-page-content-base textarea[placeholder*="摘要"]',
      '.publish-page-content-base textarea[placeholder*="描述"]',
      '.publish-page-content-base [contenteditable="true"][data-placeholder*="简介"]',
      '.publish-page-content-base [contenteditable="true"][data-placeholder*="摘要"]',
    ])
    if (description) {
      await fillText(description, input.summary)
      logger.info("XIAOHONGSHU", "最终发布页简介已填入", { length: input.summary.length })
    } else {
      logger.warn("XIAOHONGSHU", "最终发布页未定位到简介字段，跳过简介填入", await getPageDiagnostics(page))
    }
  }

  const topicButton = page.locator("#topicBtn").first()
  if (await topicButton.isVisible({ timeout: 1500 }).catch(() => false)) {
    for (const topic of input.topics) {
      await topicButton.click()
      const topicInput = await findFirstVisible(page, [
        'input[placeholder*="话题"]',
        'input[placeholder*="搜索"]',
        'input[type="text"]',
      ])
      if (!topicInput) break
      await fillText(topicInput, topic)
      await page.keyboard.press("Enter")
      await page.waitForTimeout(150)
    }
  }

  const originalSetting = page.getByText("原创声明", { exact: true }).first()
  if (await originalSetting.isVisible({ timeout: 1000 }).catch(() => false)) {
    const checkbox = originalSetting.locator('input[type="checkbox"]').first()
    if (await checkbox.isVisible({ timeout: 600 }).catch(() => false)) {
      const checked = await checkbox.isChecked().catch(() => input.original)
      if (checked !== input.original) await checkbox.click()
    }
  }
}

async function finishLongArticlePublish(page: import("playwright").Page, finalOptions: {
  title: string
  summary: string
  topics: string[]
  original: boolean
}): Promise<string | null> {
  await applyLongArticleLayout(page)
  const nextStep = await findFirstVisible(page, [
    '.footer-new button.submit:has-text("下一步")',
    '.new-ui-footer button.next-btn:has-text("下一步")',
    'button.next-btn:has-text("下一步")',
    'button:has-text("下一步")',
    '[role="button"]:has-text("下一步")',
  ])
  if (!nextStep) {
    throw new Error("未找到长文“下一步”按钮，平台页面可能已更新")
  }
  await nextStep.click()
  const finalFormReady = await waitForAnySelector(page, [
    ".publish-page-content-base",
    ARTICLE_FINAL_TITLE,
    ".publish-page-publish-btn",
    ".publish-btn",
    'xhs-publish-btn[is-publish="true"]',
  ], 30000)
  if (!finalFormReady) {
    await logPageState(page, "进入最终发布页超时")
    await captureFailureArtifacts(page, "最终发布页未加载")
    throw new Error("点击下一步后未进入小红书最终发布页")
  }
  await page.waitForTimeout(500)
  await fillFinalArticleMetadata(page, finalOptions)

  logger.info("XIAOHONGSHU", "开始多次尝试最终发布")
  await clickFinalPublishWithRetries(page)

  const result = await Promise.race([
    page.waitForURL(/(published|note|home|manage)/i, { timeout: 15000 }).then(() => page.url()).catch(() => null),
    page.getByText(/发布成功|已发布/).first().waitFor({ state: "visible", timeout: 15000 }).then(() => page.url()).catch(() => null),
  ])
  if (!result) throw new Error("未确认长文发布成功，请在小红书创作服务平台检查发布状态")
  return result
}

async function publishNote(input: {
  cookies: Cookie[]
  contentType: "image_note" | "article"
  title: string
  content: string
  imagePaths: string[]
  articleOptions: {
    summary: string
    templateName: string
    coverType: "with_image" | "without_image"
    showAuthor: boolean
    showReadingTime: boolean
    showSummary: boolean
    finalTitle: string
    topics: string[]
    original: boolean
  }
}): Promise<string | null> {
  logger.info("XIAOHONGSHU", "启动可见浏览器调试发布流程", {
    headless: true,
    viewport: "1440x960",
  })
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1440,960",
    ],
  })
  let browserDisconnected = false
  browser.once("disconnected", () => {
    browserDisconnected = true
    removeXiaohongshuPublishLock()
    logger.info("XIAOHONGSHU", "调试浏览器已关闭，发布锁已释放")
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
  let page: import("playwright").Page | null = null
  let completed = false

  try {
    createXiaohongshuPublishLock()
    await context.grantPermissions(["geolocation"], {
      origin: "https://creator.xiaohongshu.com",
    })
    logger.info("XIAOHONGSHU", "已授权创作平台地理位置权限")
    await context.addCookies(input.cookies)
    logger.info("XIAOHONGSHU", "Cookie 注入完成", { cookieCount: input.cookies.length })
    page = await context.newPage()
    page.on("console", (message) => {
      if (message.type() === "error") {
        logger.warn("XIAOHONGSHU", "页面 Console Error", { text: message.text().slice(0, 500) })
      }
    })
    page.on("pageerror", (error) => {
      logger.warn("XIAOHONGSHU", "页面脚本异常", { error: error.message.slice(0, 500) })
    })
    page.on("requestfailed", (request) => {
      logger.warn("XIAOHONGSHU", "页面请求失败", {
        url: request.url().slice(0, 500),
        failure: request.failure()?.errorText || "unknown",
      })
    })

    logger.info("XIAOHONGSHU", "开始访问发布页", { url: XIAOHONGSHU_PUBLISH_URL })
    await page.goto(XIAOHONGSHU_PUBLISH_URL, { waitUntil: "domcontentloaded", timeout: 30000 })
    await page.waitForTimeout(2500)
    await logPageState(page, "发布页初始加载完成")

    if (/login|passport/i.test(page.url())) {
      await captureFailureArtifacts(page, "登录态失效")
      throw new Error("小红书登录态已失效，请重新导出 Cookie 后绑定")
    }

    if (input.contentType === "article") {
      const directEditorReady = await waitForAnySelector(page, [ARTICLE_EDITOR], 4000)
      if (!directEditorReady) {
        logger.info("XIAOHONGSHU", "直达长文页落在首页，准备进入新的创作")
        const newCreation = await findFirstVisible(page, [
          'button.ce-btn.bg-red:has-text("新的创作")',
          'button.new-btn:has-text("新的创作")',
          'button:has-text("新的创作")',
          'button:has-text("新建创作")',
          '[role="button"]:has-text("新的创作")',
          '[role="button"]:has-text("新建创作")',
        ])
        if (!newCreation) {
          await logPageState(page, "长文首页未找到新的创作")
          await captureFailureArtifacts(page, "长文首页未找到新的创作")
          throw new Error("已进入小红书长文首页，但未找到“新的创作”按钮，请检查平台页面状态")
        }
        await newCreation.click({ force: true })
        const editorAfterCreation = await waitForAnySelector(page, [ARTICLE_EDITOR], 30000)
        if (!editorAfterCreation) {
          await logPageState(page, "新的创作后未进入编辑器")
          await captureFailureArtifacts(page, "新的创作后无编辑器")
          throw new Error("点击“新的创作”后未进入长文编辑器，请检查平台页面状态")
        }
        logger.info("XIAOHONGSHU", "新的创作已打开长文编辑器")
      } else {
        logger.info("XIAOHONGSHU", "已直达小红书新长文编辑器")
      }

      await fillLongArticle(page, {
        title: input.title,
        content: input.content,
        ...input.articleOptions,
      })
      await logPageState(page, "长文正文与封面配置完成")
      const result = await finishLongArticlePublish(page, {
        title: input.articleOptions.finalTitle || input.title,
        summary: input.articleOptions.summary,
        topics: input.articleOptions.topics,
        original: input.articleOptions.original,
      })
      completed = true
      return result
    } else {
      const selectedTab = IMAGE_NOTE_TAB
      logger.info("XIAOHONGSHU", "等待发布类型入口", { contentType: input.contentType, selector: selectedTab })
      const tabReady = await waitForAnySelector(page, [
        selectedTab,
        `${selectedTab.replace("[data-hp-bound]", "")}:not([aria-hidden="true"])`,
      ], 15000)
      if (!tabReady) {
        await logPageState(page, "等待发布类型入口超时")
        await captureFailureArtifacts(page, "发布类型入口超时")
        throw new Error("等待小红书“上传图文”入口超时")
      }
      const tab = await findFirstVisible(page, [selectedTab])
      if (!tab) throw new Error("未找到小红书“上传图文”入口，平台页面可能已更新")
      await tab.click({ force: true })
      await page.waitForTimeout(600)
    }

    if (input.contentType === "image_note") {
      const imageInput = await findFirstVisible(page, [
        'input.upload-input[type="file"][accept*=".png"]',
        'input.upload-input[type="file"][accept*="image"]',
        'input[type="file"][accept*="image"]',
      ])
      if (!imageInput) throw new Error("未找到小红书图文图片上传控件，平台页面可能已更新")
      await imageInput.setInputFiles(input.imagePaths)
      await page.waitForTimeout(1500)
    }

    const titleInput = await findFirstVisible(page, [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      '[contenteditable="true"][data-placeholder*="标题"]',
    ])
    if (!titleInput) throw new Error("未找到小红书标题输入框，平台页面可能已更新")
    await fillText(titleInput, input.title)

    const contentInput = await findFirstVisible(page, [
      'div[contenteditable="true"][data-placeholder*="正文"]',
      'div[contenteditable="true"][placeholder*="正文"]',
      'textarea[placeholder*="正文"]',
      'div[contenteditable="true"]',
    ])
    if (!contentInput) throw new Error("未找到小红书正文输入框，平台页面可能已更新")
    await fillText(contentInput, input.content)

    const publishButton = await findFirstVisible(page, [
      'button:has-text("发布")',
      '[role="button"]:has-text("发布")',
    ])
    if (!publishButton) throw new Error("未找到小红书发布按钮，平台页面可能已更新")
    await publishButton.click()

    const result = await Promise.race([
      page.waitForURL(/(published|note|home)/i, { timeout: 15000 }).then(() => page.url()).catch(() => null),
      page.getByText(/发布成功|已发布/).first().waitFor({ state: "visible", timeout: 15000 }).then(() => page.url()).catch(() => null),
    ])
    if (!result) throw new Error("未确认发布成功，请在小红书创作服务平台检查草稿或发布状态")
    return result
  } catch (error) {
    logger.error("XIAOHONGSHU", "浏览器发布流程异常", {
      error: summarizeError(error),
      url: page?.url(),
    })
    if (page) {
      await logPageState(page, "发布流程异常")
      await captureFailureArtifacts(page, "发布流程异常")
    }
    throw error
  } finally {
    if (!completed && KEEP_XIAOHONGSHU_BROWSER_OPEN_ON_FAILURE) {
      logger.warn("XIAOHONGSHU", "发布失败，保留可见浏览器窗口供人工检查", {
        closeHint: "关闭 Chromium 窗口后可继续下一次发布；如需失败后自动关闭，设置 XIAOHONGSHU_KEEP_BROWSER_OPEN=false",
      })
    } else {
      await context.close().catch(() => {})
      await browser.close().catch(() => {})
    }
    if (browserDisconnected) removeXiaohongshuPublishLock()
  }
}

router.get("/records", (req, res) => {
  res.json({ records: listXiaohongshuPublishRecords(req.user!.id) })
})

router.post("/article-metadata", async (req, res) => {
  const title = String(req.body?.title || "").trim()
  const content = normalizeText(req.body?.content, ARTICLE_CONTENT_MAX_LENGTH)
  const aiConfig = req.body?.aiConfig ?? {}
  if (!title || !content) return res.status(400).json({ error: "标题和正文不能为空" })
  if (!aiConfig.articleApiKey && aiConfig.articleProvider !== "maas") {
    return res.status(400).json({ error: "请先在 AI 配置中填写文章模型的 API Key" })
  }
  if (aiConfig.articleProvider === "maas" && !aiConfig.maasApiKey) {
    return res.status(400).json({ error: "请先在 AI 配置中填写 MaaS API Key" })
  }

  try {
    const { url, model, headers } = buildLLMRequest(aiConfig)
    const response = await callLLMWithRetry(url, {
      model,
      messages: [
        {
          role: "system",
          content: "你是小红书长文发布助手。只输出 JSON，不要 Markdown 或解释。",
        },
        {
          role: "user",
          content: `基于这篇长文，生成小红书最终发布信息。要求：标题准确、有吸引力；摘要不超过60字；topics 生成3到5个高相关中文话题词，不带#，不要虚构事实。\n\n标题：${title}\n\n正文：${content}\n\n返回格式：{"title":"", "summary":"", "topics":[""]}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 500,
      stream: false,
    }, headers)
    const output = response.data.choices[0]?.message?.content ?? ""
    const metadata = parseXiaohongshuMetadata(output)
    if (!metadata.title) metadata.title = title
    res.json(metadata)
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 生成发布信息失败"
    logger.error("XIAOHONGSHU", "AI 生成发布信息失败", { error: message })
    res.status(500).json({ error: message })
  }
})

router.post("/publish", async (req, res) => {
  const cookies = parseCookies(req.body?.cookies)
  if (!cookies) return res.status(401).json({ error: "未提供小红书 Cookie，请先在用户页绑定账号" })

  const contentType = parseContentType(req.body?.contentType)
  if (!contentType) return res.status(400).json({ error: "仅支持图文笔记或长文" })

  const rawTitle = String(req.body?.title || "").trim()
  const rawFinalTitle = String(req.body?.articleOptions?.finalTitle || "").trim()

  const title = rawTitle
  const content = normalizeText(req.body?.content, contentType === "image_note" ? CONTENT_MAX_LENGTH : ARTICLE_CONTENT_MAX_LENGTH)
  const articleOptions = {
    summary: normalizeText(req.body?.articleOptions?.summary, 60),
    templateName: normalizeText(req.body?.articleOptions?.templateName, 24) || "清晰明朗",
    coverType: req.body?.articleOptions?.coverType === "without_image" ? "without_image" as const : "with_image" as const,
    showAuthor: req.body?.articleOptions?.showAuthor !== false,
    showReadingTime: req.body?.articleOptions?.showReadingTime === true,
    showSummary: req.body?.articleOptions?.showSummary !== false,
    finalTitle: rawFinalTitle,
    topics: parseTopics(req.body?.articleOptions?.topics),
    original: req.body?.articleOptions?.original !== false,
  }
  const imagePaths = getLocalImagePaths(req.body?.imageUrls)
  if (title.length < 2) return res.status(400).json({ error: "标题至少需要 2 个字" })
  if (!content) return res.status(400).json({ error: "正文不能为空" })
  if (contentType === "image_note" && imagePaths.length === 0) return res.status(400).json({ error: "图文笔记请至少上传 1 张本地图片" })

  let recordId: string | null = null
  try {
    const record = createXiaohongshuPublishRecord({
      id: randomUUID(),
      userId: req.user!.id,
      title,
      content,
      contentType,
      imageCount: imagePaths.length,
    })
    recordId = record.id
    logger.info("XIAOHONGSHU", "开始发布内容", { recordId: record.id, contentType, imageCount: imagePaths.length })
    const noteUrl = await publishNote({ cookies, contentType, title, content, imagePaths, articleOptions })
    completeXiaohongshuPublishRecord(record.id, noteUrl)
    logger.info("XIAOHONGSHU", "内容发布成功", { recordId: record.id, contentType })
    res.json({ success: true, recordId: record.id, noteUrl })
  } catch (error) {
    const message = error instanceof Error ? error.message : "小红书发布失败"
    if (recordId) failXiaohongshuPublishRecord(recordId, message)
    logger.error("XIAOHONGSHU", "内容发布失败", { recordId, error: message })
    res.status(500).json({ error: message, recordId })
  }
})

export default router
