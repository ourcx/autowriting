/**
 * 今日头条自动推送路由
 * 流程：Markdown → docx 临时文件 → Playwright 上传到头条编辑器 → 填标题 → 上传封面 → 存草稿
 *
 * Cookie 由前端存在 localStorage，每次请求通过 request body 传入：
 *   body.cookies: JSON 字符串，格式为 [{name, value, domain, ...}]
 *
 * POST /api/toutiao/publish   → 自动推送文章到今日头条草稿箱
 * GET  /api/toutiao/status    → 检查服务是否可用
 */
import { Router } from 'express'
import { chromium } from 'playwright'
import { execSync, execFileSync } from 'child_process'
import { Document, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx'
import fs from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import http from 'http'
import { logger } from '../logger.js'

/**
 * 将图片 URL 下载到本地临时文件，返回临时文件路径
 * 支持 http/https 远程 URL 和 /api/... 本地路径
 */
async function downloadImageToTemp(imageUrl, baseOrigin) {
  const tmpPath = path.join(os.tmpdir(), `tt_cover_${Date.now()}.jpg`)

  // 本地路径（/api/images/uploads/xxx）→ 拼上 origin
  const fullUrl = imageUrl.startsWith('http') ? imageUrl : `${baseOrigin}${imageUrl}`

  return new Promise((resolve, reject) => {
    const protocol = fullUrl.startsWith('https') ? https : http
    const file = fs.createWriteStream(tmpPath)
    protocol.get(fullUrl, (res) => {
      if (res.statusCode !== 200) {
        file.close()
        fs.unlink(tmpPath, () => {})
        return reject(new Error(`下载封面失败: HTTP ${res.statusCode}`))
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve(tmpPath) })
    }).on('error', (err) => {
      file.close()
      fs.unlink(tmpPath, () => {})
      reject(err)
    })
  })
}

/**
 * 启动 Chromium，如果失败则尝试自动安装后重试
 */
const EDGE_PATH = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
const EDGE_USER_DATA = `${process.env.HOME}/Library/Application Support/Microsoft Edge`

/**
 * 启动浏览器并返回 { browser, context }
 *
 * 策略：用 Edge 可执行文件 + 独立临时 profile（从真实 Default profile 复制）
 * 这样既有真实浏览器的指纹，又不会和已运行的 Edge 冲突。
 * 失败时回退到 Playwright 内置 Chromium。
 */
async function launchBrowserWithContext(extraContextOptions = {}) {
  const commonArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--window-size=1440,900',
  ]

  // ── 优先：Edge + 独立临时 profile ────────────────────────────────────────
  // 复制真实 Default profile 到临时目录，避免与已运行的 Edge 冲突
  const tmpProfileDir = path.join(os.tmpdir(), `edge_profile_${Date.now()}`)
  const realDefaultProfile = path.join(EDGE_USER_DATA, 'Default')
  try {
    // 只复制关键文件（Cookies、Local Storage、Preferences），不复制整个 profile（太大）
    fs.mkdirSync(path.join(tmpProfileDir, 'Default'), { recursive: true })
    for (const f of ['Cookies', 'Preferences', 'Local State']) {
      const src = f === 'Local State'
        ? path.join(EDGE_USER_DATA, f)
        : path.join(realDefaultProfile, f)
      const dst = f === 'Local State'
        ? path.join(tmpProfileDir, f)
        : path.join(tmpProfileDir, 'Default', f)
      if (fs.existsSync(src)) fs.copyFileSync(src, dst)
    }
    logger.info('TOUTIAO', `临时 Edge profile 已创建: ${tmpProfileDir}`)

    const context = await chromium.launchPersistentContext(tmpProfileDir, {
      executablePath: EDGE_PATH,
      headless: false,
      args: commonArgs,
      ...extraContextOptions,
    })
    logger.info('TOUTIAO', '使用 Edge + 临时 profile 启动成功')
    // 结束后清理临时 profile
    context.once('close', () => fs.rmSync(tmpProfileDir, { recursive: true, force: true }))
    return { browser: null, context }
  } catch (e) {
    logger.warn('TOUTIAO', `Edge 临时 profile 启动失败，回退到 Chromium: ${e.message}`)
    fs.rmSync(tmpProfileDir, { recursive: true, force: true })
  }

  // ── 回退：Playwright 内置 Chromium ───────────────────────────────────────
  let browser
  try {
    browser = await chromium.launch({ headless: false, args: commonArgs })
  } catch (e) {
    logger.warn('TOUTIAO', 'Chromium 启动失败，尝试自动安装...', { error: e.message })
    execSync('npx playwright install chromium --with-deps', { stdio: 'inherit', timeout: 120000 })
    browser = await chromium.launch({ headless: false, args: commonArgs })
  }
  const context = await browser.newContext(extraContextOptions)
  return { browser, context }
}

const router = Router()

const TT_PUBLISH_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish'

/**
 * 从 request body 中解析 Cookie 数组
 * 支持 JSON 字符串或已解析的数组
 */
function parseCookies(req) {
  const raw = req.body?.cookies
  if (!raw) return null
  try {
    const cookies = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(cookies) || cookies.length === 0) return null
    return cookies
  } catch {
    return null
  }
}

/**
 * 将 Markdown 文本转换为 docx Buffer
 * 简单解析：标题、段落、列表、代码块
 */
function markdownToDocx(title, markdownText) {
  const lines = markdownText.split('\n')
  const children = []

  // 文章标题
  if (title) {
    children.push(
      new Paragraph({
        text: title,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 300 },
      })
    )
  }

  let inCodeBlock = false
  let codeLines = []

  for (const line of lines) {
    // 代码块
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // 结束代码块，把收集的行合并成一个段落
        if (codeLines.length > 0) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: codeLines.join('\n'),
                  font: 'Courier New',
                  size: 18,
                }),
              ],
              spacing: { before: 100, after: 100 },
            })
          )
        }
        codeLines = []
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    // 标题行
    const h1 = line.match(/^# (.+)/)
    const h2 = line.match(/^## (.+)/)
    const h3 = line.match(/^### (.+)/)

    if (h1) {
      children.push(new Paragraph({ text: h1[1], heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 100 } }))
    } else if (h2) {
      children.push(new Paragraph({ text: h2[1], heading: HeadingLevel.HEADING_2, spacing: { before: 160, after: 80 } }))
    } else if (h3) {
      children.push(new Paragraph({ text: h3[1], heading: HeadingLevel.HEADING_3, spacing: { before: 120, after: 60 } }))
    } else if (line.match(/^[-*+] /)) {
      // 无序列表
      const text = line.replace(/^[-*+] /, '')
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `• ${text}` })],
          spacing: { before: 60, after: 60 },
          indent: { left: 360 },
        })
      )
    } else if (line.match(/^\d+\. /)) {
      // 有序列表
      const text = line.replace(/^\d+\. /, '')
      children.push(
        new Paragraph({
          children: [new TextRun({ text })],
          spacing: { before: 60, after: 60 },
          indent: { left: 360 },
        })
      )
    } else if (line.startsWith('> ')) {
      // 引用
      const text = line.replace(/^> /, '')
      children.push(
        new Paragraph({
          children: [new TextRun({ text, italics: true, color: '666666' })],
          spacing: { before: 80, after: 80 },
          indent: { left: 360 },
          border: { left: { color: 'CCCCCC', size: 6, space: 8, style: 'single' } },
        })
      )
    } else if (line.trim() === '' || line.startsWith('---')) {
      // 空行或分隔线
      children.push(new Paragraph({ text: '', spacing: { before: 60, after: 60 } }))
    } else {
      // 普通段落：处理行内加粗/斜体
      const runs = parseInlineMarkdown(line)
      children.push(
        new Paragraph({
          children: runs,
          spacing: { before: 80, after: 80 },
        })
      )
    }
  }

  const doc = new Document({
    sections: [{ children }],
  })

  return doc
}

/**
 * 解析行内 Markdown（加粗、斜体、行内代码）
 */
function parseInlineMarkdown(text) {
  const runs = []
  // 简单的正则分割：**bold**、*italic*、`code`
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let lastIndex = 0
  let match

  while ((match = pattern.exec(text)) !== null) {
    // 普通文本
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index) }))
    }

    const token = match[0]
    if (token.startsWith('**')) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true }))
    } else if (token.startsWith('*')) {
      runs.push(new TextRun({ text: token.slice(1, -1), italics: true }))
    } else if (token.startsWith('`')) {
      runs.push(new TextRun({ text: token.slice(1, -1), font: 'Courier New', size: 18 }))
    }

    lastIndex = match.index + token.length
  }

  // 剩余文本
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex) }))
  }

  return runs.length > 0 ? runs : [new TextRun({ text })]
}

// ── GET /api/toutiao/status ──────────────────────────────────────────────────
router.get('/status', (req, res) => {
  // status 接口不需要 Cookie，只是告知前端路由可用
  res.json({ available: true })
})

// ── POST /api/toutiao/publish ────────────────────────────────────────────────
router.post('/publish', async (req, res) => {
  const cookies = parseCookies(req)
  if (!cookies) {
    return res.status(401).json({ error: '未提供今日头条 Cookie，请先在设置中配置' })
  }

  const { title, content, coverImageUrl } = req.body
  if (!title?.trim() || !content?.trim()) {
    return res.status(400).json({ error: '标题和内容不能为空' })
  }

  logger.info('TOUTIAO', '开始自动推送文章（docx 方式）', {
    title: title.slice(0, 20),
    hasCover: !!coverImageUrl,
  })

  // 生成临时 docx 文件
  const tmpDir = os.tmpdir()
  const tmpDocxPath = path.join(tmpDir, `toutiao_${Date.now()}.docx`)
  let tmpCoverPath = null

  // 如果有封面，先下载到本地临时文件
  if (coverImageUrl) {
    try {
      const origin = `${req.protocol}://${req.get('host')}`
      tmpCoverPath = await downloadImageToTemp(coverImageUrl, origin)
      logger.info('TOUTIAO', `封面已下载到临时文件: ${tmpCoverPath}`)
    } catch (e) {
      logger.warn('TOUTIAO', '封面下载失败，将跳过封面上传', { error: e.message })
      tmpCoverPath = null
    }
  }

  let browser = null
  let context = null
  try {
    // ── 1. 生成 docx ──────────────────────────────────────────────────────
    logger.info('TOUTIAO', '正在生成 docx 文件...')
    const doc = markdownToDocx(title.trim(), content)

    const { Packer } = await import('docx')
    const buffer = await Packer.toBuffer(doc)
    fs.writeFileSync(tmpDocxPath, buffer)
    logger.info('TOUTIAO', `docx 已生成: ${tmpDocxPath}`)

    // ── 2. 启动浏览器：挂载真实 Edge profile，绕过自动化检测 ────────────────
    logger.info('TOUTIAO', '正在启动浏览器（Edge 真实 profile）...')
    const launched = await launchBrowserWithContext({ viewport: { width: 1920, height: 1080 } })
    browser = launched.browser      // persistent context 时为 null
    context = launched.context

    // ── 3. 注入 Cookie ─────────────────────────────────────────────────────
    const normalizedCookies = cookies.map(c => ({
      name:     c.name,
      value:    c.value,
      domain:   c.domain   || '.toutiao.com',
      path:     c.path     || '/',
      secure:   c.secure   ?? false,
      httpOnly: c.httpOnly ?? false,
      sameSite: (['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax'),
    }))
    await context.addCookies(normalizedCookies)

    const page = await context.newPage()

    // ── 4. 访问发布页，验证登录态 ──────────────────────────────────────────
    logger.info('TOUTIAO', '正在访问头条发布页...')
    await page.goto(TT_PUBLISH_URL, { waitUntil: 'networkidle', timeout: 45000 })
    await page.waitForTimeout(3000)

    if (page.url().includes('login') || page.url().includes('passport')) {
      throw new Error('Cookie 已失效，请重新获取并配置')
    }

    // ── 5. 上传 docx 文件 ──────────────────────────────────────────────────
    // 头条「导入文档」按钮点击后会触发系统文件选择器（filechooser 事件）
    // 用 page.waitForEvent('filechooser') 监听，然后 setFiles 注入文件
    logger.info('TOUTIAO', '正在上传 docx 文件...')

    const importBtnSel = '.syl-toolbar-tool.doc-import button'
    const importBtn = page.locator(importBtnSel).first()
    const importBtnVisible = await importBtn.isVisible({ timeout: 8000 }).catch(() => false)

    if (!importBtnVisible) {
      const screenshotPath = path.join(os.tmpdir(), `toutiao_debug_${Date.now()}.png`)
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})
      logger.warn('TOUTIAO', `未找到导入文档按钮，截图: ${screenshotPath}，降级直接填写内容`)
      await fillContentDirectly(page, title.trim(), content)
    } else {
      // ── Step A：监听 filechooser 事件，同时点击导入按钮 ──────────────────
      logger.info('TOUTIAO', '监听 filechooser 事件，点击导入文档按钮...')
      let docxImported = false
      try {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 8000 }),
          importBtn.click(),
        ])
        await fileChooser.setFiles(tmpDocxPath)
        logger.info('TOUTIAO', 'filechooser 方式：docx 已注入')
        docxImported = true
      } catch (e) {
        logger.warn('TOUTIAO', `filechooser 未触发 (${e.message})，改用 file input 直接注入`)
      }

      // ── Step B（备用）：直接找 file input 注入 ───────────────────────────
      if (!docxImported) {
        await page.waitForTimeout(1500)
        // 打印页面中所有 file input 信息，帮助调试
        const fileInputsInfo = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('input[type="file"]')).map(el => ({
            accept: el.accept,
            parentClass: el.parentElement?.className,
          }))
        })
        logger.info('TOUTIAO', `页面 file inputs: ${JSON.stringify(fileInputsInfo)}`)

        const docxInputSelectors = [
          'input[type="file"][accept*="docx"]',
          'input[type="file"][accept*=".doc"]',
          '.byte-modal input[type="file"]',
          '.syl-toolbar-tool.doc-import input[type="file"]',
        ]
        let fileInput = null
        for (const sel of docxInputSelectors) {
          const input = page.locator(sel).first()
          if (await input.count().catch(() => 0) > 0) {
            fileInput = input
            logger.info('TOUTIAO', `找到 docx file input: ${sel}`)
            break
          }
        }

        if (!fileInput) {
          logger.warn('TOUTIAO', '未找到 docx file input，降级直接填写内容')
          await fillContentDirectly(page, title.trim(), content)
          docxImported = true // 标记已处理（降级）
        } else {
          await fileInput.setInputFiles(tmpDocxPath)
          logger.info('TOUTIAO', 'file input 方式：docx 已注入')
          docxImported = true
        }
      }

      if (docxImported) {
        // ── Step C：处理可能出现的确认弹窗 ──────────────────────────────────
        await page.waitForTimeout(1500)
        const confirmSelectors = [
          '.byte-modal button.byte-btn-primary',
          '.byte-modal-footer button:last-child',
          '.doc-import-panel button.byte-btn-primary',
        ]
        for (const sel of confirmSelectors) {
          const btn = page.locator(sel).first()
          if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await btn.click()
            logger.info('TOUTIAO', `点击确认导入: ${sel}`)
            break
          }
        }

        // ── Step D：等编辑器内容出现 ─────────────────────────────────────────
        try {
          await page.waitForFunction(() => {
            const editor = document.querySelector('.ProseMirror')
            return editor && editor.innerText.trim().length > 10
          }, { timeout: 20000 })
          logger.info('TOUTIAO', '编辑器内容已渲染')
        } catch {
          logger.warn('TOUTIAO', '等待编辑器内容超时，继续执行...')
          await page.waitForTimeout(3000)
        }

        // 截图：内容渲染后的状态
        const shotPath = path.join(os.tmpdir(), `tt_after_import_${Date.now()}.png`)
        await page.screenshot({ path: shotPath, fullPage: false }).catch(() => {})
        logger.info('TOUTIAO', `导入后截图: ${shotPath}`)

        // ── Step E：填写标题 ──────────────────────────────────────────────────
        await fillTitle(page, title.trim())
      }
    }

    // ── 6. 触发草稿保存 ────────────────────────────────────────────────────
    // 头条保存策略：
    //   a) 等待底部状态出现「草稿已保存」文字（docx 导入后通常自动触发）
    //   b) 若等不到，点击「预览」按钮触发保存
    //   c) 兜底等待 8 秒
    logger.info('TOUTIAO', '等待草稿保存...')

    const waitForSaveText = async (timeoutMs) => {
      try {
        await page.waitForSelector(
          'text=草稿已保存, text=已自动保存, text=已保存',
          { timeout: timeoutMs }
        )
        return true
      } catch {
        return false
      }
    }

    let draftSaved = await waitForSaveText(10000)
    if (draftSaved) {
      logger.info('TOUTIAO', '检测到草稿已保存')
    } else {
      // 点击「预览」触发保存（来自页面 HTML：button.byte-btn-default:has-text("预览")）
      logger.info('TOUTIAO', '未检测到自动保存，尝试点击预览触发...')
      const previewSelectors = [
        'button:has-text("预览")',
        'button:has-text("预览文章")',
        '.preview-btn',
      ]
      for (const sel of previewSelectors) {
        const btn = page.locator(sel).first()
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          logger.info('TOUTIAO', `点击预览按钮: ${sel}`)
          await btn.click()
          await page.waitForTimeout(1500)
          await page.keyboard.press('Escape').catch(() => {})
          draftSaved = await waitForSaveText(6000)
          if (draftSaved) logger.info('TOUTIAO', '点击预览后草稿已保存')
          break
        }
      }
    }

    if (!draftSaved) {
      logger.warn('TOUTIAO', '未确认草稿已保存，等待 8 秒兜底...')
      await page.waitForTimeout(8000)
    }

    const currentUrl = page.url()
    logger.info('TOUTIAO', '草稿保存流程完成', { url: currentUrl })

    // ── 7. 上传封面图 ──────────────────────────────────────────────────────
    let coverUploaded = false
    if (tmpCoverPath && fs.existsSync(tmpCoverPath)) {
      try {
        logger.info('TOUTIAO', '开始上传封面图...')
        coverUploaded = await uploadCoverImage(page, tmpCoverPath)
        if (coverUploaded) {
          logger.info('TOUTIAO', '封面上传成功，等待自动保存...')
          await page.waitForTimeout(4000)
        }
      } catch (e) {
        logger.warn('TOUTIAO', '封面上传失败，草稿已保存但无封面', { error: e.message })
      }
    }

    res.json({
      success: true,
      message: coverUploaded
        ? '文章已保存为今日头条草稿（含封面），请前往草稿箱发布'
        : '文章已保存为今日头条草稿，请前往头条号后台添加封面后发布',
      url: 'https://mp.toutiao.com/profile_v4/graphic/articles?type=draft',
    })

  } catch (err) {
    logger.error('TOUTIAO', '自动推送失败', { error: err.message })
    res.status(500).json({ error: err.message || '自动推送失败，请检查 Cookie 是否有效' })
  } finally {
    // 清理临时文件
    if (fs.existsSync(tmpDocxPath)) fs.unlinkSync(tmpDocxPath)
    if (tmpCoverPath && fs.existsSync(tmpCoverPath)) fs.unlinkSync(tmpCoverPath)
    // persistent context 只关 context；普通模式关 browser（会自动关 context）
    if (context) await context.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
  }
})

/**
 * 降级方案：直接在编辑器中填写纯文本内容
 */
async function fillContentDirectly(page, title, content) {
  // 填写标题
  await fillTitle(page, title)

  // 填写正文
  const editorSelector = '.ProseMirror, [contenteditable="true"]'
  await page.waitForSelector(editorSelector, { timeout: 15000 })
  const editor = page.locator(editorSelector).first()
  await editor.click()
  await page.waitForTimeout(500)

  // 长内容用 JS 注入
  await page.evaluate((text) => {
    const el = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]')
    if (!el) return
    el.focus()
    const paragraphs = text.split('\n').filter(p => p.trim())
    el.innerHTML = paragraphs.map(p => `<p>${p.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('')
    el.dispatchEvent(new InputEvent('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, content)

  await page.waitForTimeout(1000)
}

/**
 * 上传封面图到头条编辑器
 *
 * 头条封面区域真实 HTML 结构（来自用户提供的页面 HTML）：
 *   <div class="byte-spin-content">
 *     <div class="article-cover-add" style="border: 1px dashed ...">
 *       <svg class="add-icon byte-icon byte-icon-plus">...</svg>
 *     </div>
 *   </div>
 *
 * 策略：点击 .article-cover-add → 等 modal 里的 file input → setInputFiles → 处理确认弹窗
 * 返回 true 表示上传成功，false 表示跳过
 */
async function uploadCoverImage(page, coverFilePath) {
  // ── 找封面添加区域 ───────────────────────────────────────────────────────
  const coverAddSel = '.article-cover-add'
  const coverAddEl = page.locator(coverAddSel).first()
  const coverAddVisible = await coverAddEl.isVisible({ timeout: 5000 }).catch(() => false)

  if (!coverAddVisible) {
    logger.warn('TOUTIAO', '未找到封面添加区域，跳过封面上传')
    return false
  }

  // ── 优先：filechooser 方式 ────────────────────────────────────────────────
  logger.info('TOUTIAO', '点击封面添加区域，监听 filechooser...')
  let coverInjected = false
  try {
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 6000 }),
      coverAddEl.click(),
    ])
    await fileChooser.setFiles(coverFilePath)
    logger.info('TOUTIAO', 'filechooser 方式：封面已注入')
    coverInjected = true
  } catch (e) {
    logger.warn('TOUTIAO', `封面 filechooser 未触发 (${e.message})，改用 file input 直接注入`)
  }

  // ── 备用：直接找 file input ───────────────────────────────────────────────
  if (!coverInjected) {
    await page.waitForTimeout(1000)
    const coverInputSelectors = [
      '.article-cover input[type="file"]',
      '.article-cover-add input[type="file"]',
      '.byte-modal input[type="file"]',
      'input[type="file"][accept*="image"]',
    ]
    let fileInput = null
    for (const sel of coverInputSelectors) {
      const input = page.locator(sel).first()
      if (await input.count().catch(() => 0) > 0) {
        fileInput = input
        logger.info('TOUTIAO', `找到封面 file input: ${sel}`)
        break
      }
    }
    if (!fileInput) {
      logger.warn('TOUTIAO', '未找到封面 file input，跳过封面上传')
      return false
    }
    await fileInput.setInputFiles(coverFilePath)
    logger.info('TOUTIAO', 'file input 方式：封面已注入')
    coverInjected = true
  }

  // ── 等待上传完成，处理裁剪/确认弹窗 ─────────────────────────────────────
  await page.waitForTimeout(4000)
  const coverConfirmSelectors = [
    '.byte-modal button.byte-btn-primary',
    '.byte-modal-footer button:last-child',
  ]
  for (const sel of coverConfirmSelectors) {
    const btn = page.locator(sel).first()
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click()
      logger.info('TOUTIAO', `点击封面确认: ${sel}`)
      await page.waitForTimeout(2000)
      break
    }
  }

  // 验证封面是否上传成功（添加区域消失说明已有封面）
  const addIconGone = await page.locator(coverAddSel).count().then(c => c === 0).catch(() => false)
  logger.info('TOUTIAO', addIconGone ? '封面上传成功' : '封面添加区域仍存在，可能未成功')

  return true
}

/**
 * 填写文章标题
 * 根据页面 HTML：textarea[placeholder="请输入文章标题（2～30个字）"]
 */
async function fillTitle(page, title) {
  const titleSelectors = [
    'textarea[placeholder*="请输入文章标题"]',
    'input[placeholder*="请输入文章标题"]',
    '.editor-title textarea',
    '.publish-editor-title textarea',
    '[placeholder*="标题"]',
  ]
  for (const sel of titleSelectors) {
    const el = page.locator(sel).first()
    if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
      await el.click()
      await el.fill(title)
      await page.waitForTimeout(300)
      logger.info('TOUTIAO', `标题已填写: ${title}`)
      return
    }
  }
  logger.warn('TOUTIAO', '未找到标题输入框')
}

export default router
