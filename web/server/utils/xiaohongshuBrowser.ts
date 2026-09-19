import type { Locator, Page } from "playwright"
import { marked } from "marked"

export const ARTICLE_EDITOR = ".tiptap.ProseMirror[contenteditable='true']"
export const ARTICLE_TITLE = ".rich-editor-title textarea.d-text:not(.d-textarea-shadow)"
export const ARTICLE_FINAL_TITLE = 'input[placeholder*="填写标题"]'
const NEXT_STEP = [
  '.footer-new button.submit:has-text("下一步")',
  '.new-ui-footer button.next-btn:has-text("下一步")',
]

/** 先过滤可见节点，再取第一个，避免隐藏的埋点副本挡住真正的控件。 */
export async function findFirstVisible(page: Page, selectors: string[], timeout = 1500): Promise<Locator | null> {
  const locator = page.locator(selectors.map((selector) => `:is(${selector}):visible`).join(", ")).first()
  return locator.waitFor({ state: "visible", timeout }).then(() => locator).catch(() => null)
}

export async function waitForAnySelector(page: Page, selectors: string[], timeout = 15000): Promise<boolean> {
  return Boolean(await findFirstVisible(page, selectors, timeout))
}

/** DOM maxlength 使用 UTF-16 长度；不能按字数截断后继续发布。 */
export async function fillText(locator: Locator, text: string): Promise<void> {
  const maxLength = await locator.evaluate((element) =>
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.maxLength : -1)
  if (maxLength >= 0 && text.length > maxLength) {
    throw new Error(`小红书输入框最多允许 ${maxLength} 个字符，当前为 ${text.length}，请缩短后重试`)
  }
  await locator.click()
  await locator.fill(text)
  const actual = await locator.evaluate((element) =>
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value
      : element.textContent || "")
  if (actual !== text) throw new Error("小红书输入内容与预期不一致，已停止发布，请检查是否被平台截断")
}

/** 只处理现场确认过的新功能引导；未知弹窗和验证页面不自动关闭。 */
export async function dismissKnownGuide(page: Page): Promise<void> {
  const guide = page.getByRole("dialog").filter({ hasText: "图片可以编辑啦" })
  if (!await guide.isVisible()) return
  const close = guide.getByRole("button", { name: /^(关闭新功能引导|我知道了)$/ }).first()
  await close.click({ timeout: 3000 })
  await guide.waitFor({ state: "hidden", timeout: 3000 })
}

/** 平台把三项 checkbox 放在同一个 setting-item 中，必须从精确标签反查单个控件。 */
export async function setLabeledCheckbox(page: Page, label: string, enabled: boolean): Promise<void> {
  const accessible = page.getByRole("checkbox", { name: label, exact: true })
  const labelNode = page.getByText(label, { exact: true }).filter({ visible: true })
  const container = labelNode.locator('xpath=ancestor-or-self::*[count(.//input[@type="checkbox"])=1][1]')
  const checkbox = await accessible.count() === 1
    ? accessible
    : container.locator('input[type="checkbox"]')
  if (await checkbox.count() !== 1) throw new Error(`未能准确定位小红书“${label}”选项，已停止发布`)
  if (await checkbox.isChecked() === enabled) return
  if (!await checkbox.isEnabled()) throw new Error(`小红书当前不允许更改“${label}”选项，请调整配置后重试`)

  if (await checkbox.isVisible()) {
    await checkbox.setChecked(enabled)
  } else {
    // 小红书 d-switch 的 input 为 0 高度，旁边的 .label 只是说明文字。
    // 应点击该 input 所属的开关；普通 HTML label 仍保留原生切换方式。
    const toggle = checkbox.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " d-switch ")][1]')
    if (await toggle.count() === 1) {
      await toggle.click()
    } else {
      if (await labelNode.count() !== 1) throw new Error(`未能准确定位小红书“${label}”标签`)
      await labelNode.click()
    }
  }
  if (await checkbox.isChecked() !== enabled) throw new Error(`小红书“${label}”选项未设置成功`)
}

export interface LongArticleInput {
  title: string
  content: string
  summary: string
  templateName: string
  coverType: "with_image" | "without_image"
  showAuthor: boolean
  showReadingTime: boolean
  showSummary: boolean
}

async function fillArticleBody(editor: Locator, markdown: string, title: string): Promise<void> {
  const lines = markdown.split(/\r?\n/)
  const first = lines.findIndex((line) => line.trim())
  if (first >= 0 && lines[first].replace(/^#\s+/, "").trim() === title.trim()) {
    lines.splice(first, 1)
    if (lines[first]?.trim() === "") lines.splice(first, 1)
  }
  const body = lines.join("\n")
  const html = await marked.parse(body, { async: false, breaks: true, gfm: true })
  await editor.fill("")
  const inserted = await editor.evaluate((element, value) => {
    element.focus()
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return document.execCommand("insertHTML", false, value)
  }, html)
  if (!inserted) await fillText(editor, body)
}

async function fillCoverSummary(page: Page, summary: string): Promise<void> {
  const container = page.locator('[data-dom-type="summary"]:visible').first()
  await container.waitFor({ state: "visible", timeout: 5000 })
  await container.click()
  const editable = await findFirstVisible(page, [
    '[data-dom-type="summary"][contenteditable="true"]',
    '[data-dom-type="summary"] [contenteditable="true"]',
    '[data-dom-type="summary"] input',
    '[data-dom-type="summary"] textarea',
    '.editable-overlay textarea.editable-textarea',
    '[contenteditable="true"][data-dom-type="editable-text"]:focus',
  ], 3000)
  if (!editable) throw new Error("未找到小红书封面摘要编辑框，已停止发布")
  await fillText(editable, summary)
  await editable.press("Tab")
  const overlay = page.locator(".editable-overlay:visible")
  if (await overlay.count()) {
    // 实际平台把 textarea 挂在全屏遮罩中，Tab 不会关闭；点击遮罩空白处才保存。
    await overlay.click({ position: { x: 8, y: 8 } })
    await overlay.waitFor({ state: "hidden", timeout: 3000 })
  }
  if ((await container.innerText()).trim() !== summary.trim()) {
    throw new Error("小红书封面摘要未保存成功，已停止发布")
  }
}

/** 排版之后才有模板和封面设置；必须在点击下一步前完成这些配置。 */
export async function prepareLongArticle(page: Page, input: LongArticleInput): Promise<void> {
  const editor = await findFirstVisible(page, [ARTICLE_EDITOR], 15000)
  const title = await findFirstVisible(page, [ARTICLE_TITLE, 'textarea[placeholder="输入标题"]'])
  if (!editor || !title) throw new Error("未找到小红书长文标题或正文编辑器，平台页面可能已更新")
  await fillText(title, input.title)
  await fillArticleBody(editor, input.content, input.title)

  const layout = page.getByRole("button", { name: "一键排版", exact: true })
  await layout.click({ timeout: 15000 })
  if (!await waitForAnySelector(page, NEXT_STEP.map((selector) => `${selector}:enabled`), 60000)) {
    throw new Error("小红书一键排版后未出现可用的“下一步”按钮")
  }
  await configureLongArticleCover(page, input)
}

export async function configureLongArticleCover(page: Page, input: LongArticleInput): Promise<void> {
  await page.getByText("选择模板", { exact: true }).click({ timeout: 5000 })
  const template = page.locator(".template-card-new:visible, .template-card:visible")
    .filter({ hasText: input.templateName }).first()
  await template.click({ timeout: 5000 })
  await page.getByText("封面设置", { exact: true }).click({ timeout: 5000 })
  const coverName = input.coverType === "with_image" ? "有图封面" : "无图封面"
  await page.locator(".cover-item:visible").filter({ hasText: coverName }).click({ timeout: 5000 })
  await setLabeledCheckbox(page, "作者", input.showAuthor)
  await setLabeledCheckbox(page, "字数和时长", input.showReadingTime)
  await setLabeledCheckbox(page, "摘要", input.showSummary)
  if (input.showSummary && input.summary) await fillCoverSummary(page, input.summary)
}

async function addTopics(page: Page, editor: Locator, topics: string[]): Promise<void> {
  for (const topic of new Set(topics)) {
    // #topicBtn 把 # 插入当前富文本光标；这里直接在正文末尾输入，绝不猜测通用 input。
    // 选过话题后焦点在候选列表，macOS 的 Meta+End 不保证把新光标移到末尾。
    await editor.click()
    await editor.evaluate((element) => {
      element.focus()
      const range = document.createRange()
      range.selectNodeContents(element)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    await editor.pressSequentially(` #${topic}`, { delay: 30 })
    const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const candidate = page.getByRole("tooltip").locator(".item:not(:has(.newTopic)) .name")
      .filter({ hasText: new RegExp(`^#?\\s*${escaped}$`) }).first()
    try {
      await candidate.click({ timeout: 5000 })
      // 真实关联节点是带 data-topic 的链接，文本还包含隐藏的“[话题]#”标记。
      // 不把未选中的 suggestion 文本或“新建话题”当作已关联的现有话题。
      const entity = editor.locator("a.tiptap-topic[data-topic]")
        .filter({ hasText: new RegExp(`^#${escaped}(?:\\[话题\\]#)?\\s*$`) }).first()
      await entity.waitFor({ state: "visible", timeout: 3000 })
      const data: unknown = JSON.parse(await entity.getAttribute("data-topic") || "null")
      if (!data || typeof data !== "object" || !("name" in data) || data.name !== topic
        || !("id" in data) || typeof data.id !== "string" || !data.id || data.id === "newTopic_Id") {
        throw new Error("话题节点缺少匹配的名称或有效 ID")
      }
    } catch {
      throw new Error(`未能确认小红书话题“${topic}”已关联，已停止发布，请在平台检查话题`)
    }
  }
}

export interface FinalArticleInput {
  title: string
  summary: string
  topics: string[]
  original: boolean
}

/** 勾选原创声明后平台还会弹出须知确认，完成确认才允许提交。 */
export async function confirmOriginalDeclaration(page: Page): Promise<void> {
  const modal = page.locator(".d-modal:visible").filter({
    has: page.getByRole("heading", { name: "笔记完成原创声明后，将获得以下权益", exact: true }),
  })
  if (!await modal.count()) return
  const consent = modal.locator(".d-checkbox").filter({ hasText: "我已阅读并同意" })
  const checkbox = consent.locator('input[type="checkbox"]')
  if (await checkbox.count() !== 1) throw new Error("未找到小红书原创声明须知确认项")
  if (!await checkbox.isChecked()) await consent.click()
  if (!await checkbox.isChecked()) throw new Error("小红书原创声明须知未确认")
  await modal.getByRole("button", { name: "声明原创", exact: true }).click({ timeout: 5000 })
  await modal.waitFor({ state: "hidden", timeout: 5000 })
}

export async function fillFinalArticleMetadata(page: Page, input: FinalArticleInput): Promise<void> {
  const title = await findFirstVisible(page, [ARTICLE_FINAL_TITLE], 30000)
  if (!title) throw new Error("未找到小红书最终发布标题输入框")
  await dismissKnownGuide(page)
  await fillText(title, input.title)
  if (input.summary || input.topics.length) {
    const description = await findFirstVisible(page, [
      '.publish-page-content-base .tiptap.ProseMirror[contenteditable="true"][role="textbox"]',
      '.tiptap.ProseMirror[contenteditable="true"][role="textbox"]',
      '.publish-page-content-base textarea[placeholder*="简介"]',
      '.publish-page-content-base textarea[placeholder*="摘要"]',
    ])
    if (!description) throw new Error("未找到小红书最终发布简介输入框，已停止发布")
    await fillText(description, input.summary)
    await addTopics(page, description, input.topics)
  }
  await setLabeledCheckbox(page, "原创声明", input.original)
  if (input.original) await confirmOriginalDeclaration(page)
  if (await title.inputValue() !== input.title) throw new Error("小红书最终发布标题发生变化，已停止发布")
}

export async function openFinalArticleForm(page: Page): Promise<void> {
  const next = await findFirstVisible(page, NEXT_STEP.map((selector) => `${selector}:enabled`), 15000)
  if (!next) throw new Error("未找到长文“下一步”按钮")
  await next.click()
  if (!await waitForAnySelector(page, [ARTICLE_FINAL_TITLE], 30000)) {
    throw new Error("点击下一步后未进入小红书最终发布页")
  }
  await dismissKnownGuide(page)
}

/** 不以首页、管理页或“已发布”标签作为成功证据；这些内容可能在提交前就存在。 */
export async function submitXiaohongshuOnce(page: Page, timeout = 60000): Promise<string> {
  const success = page.getByText("发布成功", { exact: true }).filter({ visible: true }).first()
  if (await success.isVisible()) throw new Error("页面已有发布成功提示，无法确认当前稿件状态，请先到平台核对")
  const readyButton = 'button:enabled:not([aria-busy="true"]):not([aria-disabled="true"]):text-is("发布")'
  const button = await findFirstVisible(page, [
    `.publish-btn ${readyButton}`,
    `.publish-page-publish-btn ${readyButton}`,
    readyButton,
    '[role="button"]:not([aria-disabled="true"]):not([aria-busy="true"]):text-is("发布")',
    'xhs-publish-btn[is-publish="true"][is-save-draft="true"][submit-text="发布"][save-text="暂存离开"][submit-disabled="false"][submit-loading="false"]',
  ], timeout)
  if (!button) throw new Error("等待小红书发布按钮就绪超时，尚未提交")
  await button.scrollIntoViewIfNeeded()
  if (await success.isVisible()) throw new Error("页面已有发布成功提示，无法确认当前稿件状态，请先到平台核对")
  // 在点击前监听，捕获一闪而过的成功提示；只读取一次结果，不二次等待或重发。
  const confirmed = success.waitFor({ state: "visible", timeout }).then(() => page.url()).catch(() => null)
  try {
    if (await button.evaluate((element) => element.tagName.toLowerCase()) === "xhs-publish-btn") {
      const box = await button.boundingBox()
      if (!box || box.width < 264) throw new Error("发布控件尺寸与已知布局不符")
      // 兼容现场的 closed Shadow DOM：两颗 120px 按钮，间隔 24px，发布在右侧。
      // locator.click 保留遮挡/可点击检查；绝不 force 点击覆盖层。
      await button.click({ position: { x: box.width / 2 + 72, y: box.height / 2 }, timeout: 5000 })
    } else {
      await button.click({ timeout: 5000 })
    }
  } catch {
    // Playwright 可能已把点击发到页面；异常不能作为安全重发的依据。
    throw new Error("小红书发布点击未能确认，结果可能尚未返回。请先到平台核对，勿重复发布")
  }
  const result = await confirmed
  if (!result) throw new Error("小红书发布已点击，但未收到明确成功提示。请先到平台核对，勿重复发布")
  return result
}
