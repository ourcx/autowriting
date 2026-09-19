import { Router } from "express"
import path from "path"
import { chromium, type Cookie } from "playwright"
import { randomUUID } from "crypto"
import { UPLOAD_DIR } from "../config.ts"
import {
  ARTICLE_EDITOR,
  findFirstVisible,
  waitForAnySelector,
  fillText,
  prepareLongArticle,
  openFinalArticleForm,
  fillFinalArticleMetadata,
  submitXiaohongshuOnce,
} from "../utils/xiaohongshuBrowser.ts"
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

const XIAOHONGSHU_PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video"
const TITLE_SAFETY_MAX_LENGTH = 500
const CONTENT_MAX_LENGTH = 1000
const ARTICLE_CONTENT_MAX_LENGTH = 10000
const MAX_IMAGES = 9
// 同一 tab 会同时渲染埋点覆盖层（button-hp-installed）和真实 Vue 节点。
// 覆盖层带 aria-hidden，真正的可点击节点带 data-hp-bound。
const IMAGE_NOTE_TAB = ".creator-tab[data-hp-bound]:has-text('上传图文')"
const ARTICLE_TAB_SELECTORS = [
  ".creator-tab[data-hp-bound]:has-text('写长文')",
  ".creator-tab:not([aria-hidden='true']):has-text('写长文')",
  "[role='tab']:has-text('写长文')",
]
const KEEP_XIAOHONGSHU_BROWSER_OPEN_ON_FAILURE = process.env.XIAOHONGSHU_KEEP_BROWSER_OPEN !== "false"
const XIAOHONGSHU_HEADLESS = process.env.XIAOHONGSHU_HEADLESS !== "false"

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
    title: normalizeText(data.title, TITLE_SAFETY_MAX_LENGTH),
    summary: normalizeText(data.summary, 60),
    topics: parseTopics(data.topics),
  }
}

function isTitleOverSafetyLimit(value: string): boolean {
  return Array.from(value).length > TITLE_SAFETY_MAX_LENGTH
}

function getLocalImagePaths(imageUrls: unknown): string[] {
  if (!Array.isArray(imageUrls)) return []
  return imageUrls
    .filter((imageUrl): imageUrl is string => typeof imageUrl === "string")
    .filter((imageUrl) => imageUrl.startsWith("/api/images/uploads/"))
    .slice(0, MAX_IMAGES)
    .map((imageUrl) => path.join(UPLOAD_DIR, path.basename(imageUrl)))
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

async function enterLongArticleEditor(page: import("playwright").Page): Promise<void> {
  if (await waitForAnySelector(page, [ARTICLE_EDITOR], 1500)) {
    logger.info("XIAOHONGSHU", "已直达小红书新长文编辑器")
    return
  }

  const articleTab = await findFirstVisible(page, ARTICLE_TAB_SELECTORS)
  if (!articleTab) {
    await logPageState(page, "统一发布页未找到写长文入口")
    await captureFailureArtifacts(page, "统一发布页未找到写长文入口")
    throw new Error("未找到小红书“写长文”入口，平台页面可能已更新")
  }

  logger.info("XIAOHONGSHU", "从统一发布页切换到写长文", { url: page.url() })
  await articleTab.click()

  if (await waitForAnySelector(page, [ARTICLE_EDITOR], 5000)) {
    logger.info("XIAOHONGSHU", "写长文入口已打开编辑器")
    return
  }

  const newCreation = await findFirstVisible(page, [
    'button.ce-btn.bg-red:has-text("新的创作")',
    'button.new-btn:has-text("新的创作")',
    'button:has-text("新的创作")',
    'button:has-text("新建创作")',
    '[role="button"]:has-text("新的创作")',
    '[role="button"]:has-text("新建创作")',
  ])
  if (!newCreation) {
    await logPageState(page, "写长文首页未找到新的创作")
    await captureFailureArtifacts(page, "写长文首页未找到新的创作")
    throw new Error("已进入小红书长文首页，但未找到“新的创作”按钮，请检查平台页面状态")
  }

  await newCreation.click()
  if (!await waitForAnySelector(page, [ARTICLE_EDITOR], 30000)) {
    await logPageState(page, "新的创作后未进入编辑器")
    await captureFailureArtifacts(page, "新的创作后无编辑器")
    throw new Error("点击“新的创作”后未进入长文编辑器，请检查平台页面状态")
  }
  logger.info("XIAOHONGSHU", "新的创作已打开长文编辑器")
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
  logger.info("XIAOHONGSHU", "启动浏览器发布流程", {
    headless: XIAOHONGSHU_HEADLESS,
    viewport: "1440x960",
  })
  const browser = await chromium.launch({
    headless: XIAOHONGSHU_HEADLESS,
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
      await enterLongArticleEditor(page)

      await prepareLongArticle(page, {
        title: input.title,
        content: input.content,
        ...input.articleOptions,
      })
      await logPageState(page, "长文正文与封面配置完成")
      await openFinalArticleForm(page)
      await fillFinalArticleMetadata(page, {
        title: input.articleOptions.finalTitle || input.title,
        summary: input.articleOptions.summary,
        topics: input.articleOptions.topics,
        original: input.articleOptions.original,
      })
      const result = await submitXiaohongshuOnce(page)
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
      const tab = await findFirstVisible(page, [
        selectedTab,
        `${selectedTab.replace("[data-hp-bound]", "")}:not([aria-hidden="true"])`,
      ])
      if (!tab) throw new Error("未找到小红书“上传图文”入口，平台页面可能已更新")
      await tab.click()
      await page.waitForTimeout(600)
    }

    if (input.contentType === "image_note") {
      // 文件 input 通常被上传按钮隐藏，setInputFiles 只要求节点已挂载。
      const imageInput = page.locator([
        'input.upload-input[type="file"][accept*=".png"]',
        'input.upload-input[type="file"][accept*="image"]',
        'input[type="file"][accept*="image"]',
      ].join(", ")).first()
      await imageInput.waitFor({ state: "attached", timeout: 15000 })
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

    const result = await submitXiaohongshuOnce(page)
    completed = true
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
    if (!completed && !XIAOHONGSHU_HEADLESS && KEEP_XIAOHONGSHU_BROWSER_OPEN_ON_FAILURE) {
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
  if (isTitleOverSafetyLimit(title)) {
    return res.status(400).json({ error: `标题异常过长，最多 ${TITLE_SAFETY_MAX_LENGTH} 个字` })
  }
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
  if (isTitleOverSafetyLimit(rawTitle) || isTitleOverSafetyLimit(rawFinalTitle)) {
    return res.status(400).json({ error: `标题异常过长，最多 ${TITLE_SAFETY_MAX_LENGTH} 个字` })
  }

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
