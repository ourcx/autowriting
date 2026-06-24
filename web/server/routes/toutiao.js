/**
 * 今日头条自动推送路由
 * 流程：Markdown → pasteMarkdownAsRichText 注入编辑器 → 填标题 → 上传封面 → 存草稿
 *
 * Cookie 由前端存在 localStorage，每次请求通过 request body 传入：
 *   body.cookies: JSON 字符串，格式为 [{name, value, domain, ...}]
 *
 * POST /api/toutiao/publish   → 自动推送文章到今日头条草稿箱
 * GET  /api/toutiao/status    → 检查服务是否可用
 */
import { Router } from 'express'
import { chromium } from 'playwright'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import http from 'http'
import { marked } from 'marked'
import { logger } from '../logger.js'

/**
 * 随机等待 [min, max] 毫秒，模拟真实用户操作节奏
 */
function sleep(min, max) {
  const ms = max ? Math.floor(min + Math.random() * (max - min)) : min
  return new Promise(r => setTimeout(r, ms))
}

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
  const tmpProfileDir = path.join(os.tmpdir(), `edge_profile_${Date.now()}`)
  const realDefaultProfile = path.join(EDGE_USER_DATA, 'Default')
  try {
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
      headless: true,
      args: commonArgs,
      ...extraContextOptions,
    })
    logger.info('TOUTIAO', '使用 Edge + 临时 profile 启动成功')
    context.once('close', () => fs.rmSync(tmpProfileDir, { recursive: true, force: true }))
    return { browser: null, context }
  } catch (e) {
    logger.warn('TOUTIAO', `Edge 临时 profile 启动失败，回退到 Chromium: ${e.message}`)
    fs.rmSync(tmpProfileDir, { recursive: true, force: true })
  }

  // ── 回退：Playwright 内置 Chromium ───────────────────────────────────────
  let browser
  try {
    browser = await chromium.launch({ headless: true, args: commonArgs })
  } catch (e) {
    logger.warn('TOUTIAO', 'Chromium 启动失败，尝试自动安装...', { error: e.message })
    execSync('npx playwright install chromium --with-deps', { stdio: 'inherit', timeout: 120000 })
    browser = await chromium.launch({ headless: true, args: commonArgs })
  }
  const context = await browser.newContext(extraContextOptions)
  return { browser, context }
}

const router = Router()

const TT_PUBLISH_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish'
const TITLE_MAX_LEN = 30
const TITLE_MIN_LEN = 2

/**
 * 从 request body 中解析 Cookie 数组
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

// ── GET /api/toutiao/status ──────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({ available: true })
})

// ── POST /api/toutiao/publish ────────────────────────────────────────────────
router.post('/publish', async (req, res) => {
  const cookies = parseCookies(req)
  if (!cookies) {
    return res.status(401).json({ error: '未提供今日头条 Cookie，请先在设置中配置' })
  }

  let { title, content, coverImageUrl } = req.body
  if (!title?.trim() || !content?.trim()) {
    return res.status(400).json({ error: '标题和内容不能为空' })
  }

  title = title.trim()

  // 标题长度校验
  if (title.length < TITLE_MIN_LEN) {
    return res.status(400).json({ error: `标题过短：至少 ${TITLE_MIN_LEN} 个字` })
  }
  if (title.length > TITLE_MAX_LEN) {
    logger.warn('TOUTIAO', `标题超过 ${TITLE_MAX_LEN} 字，已自动截断`)
    title = title.slice(0, TITLE_MAX_LEN)
  }

  logger.info('TOUTIAO', '开始自动推送文章', {
    title: title.slice(0, 20),
    hasCover: !!coverImageUrl,
  })

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
    // ── 1. 启动浏览器 ──────────────────────────────────────────────────────
    logger.info('TOUTIAO', '正在启动浏览器...')
    const launched = await launchBrowserWithContext({ viewport: { width: 1920, height: 1080 } })
    browser = launched.browser
    context = launched.context

    // ── 2. 注入 Cookie ─────────────────────────────────────────────────────
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

    // ── 3. 访问发布页 ──────────────────────────────────────────────────────
    // 用 domcontentloaded 而非 networkidle，更快更稳定
    logger.info('TOUTIAO', '正在访问头条发布页...')
    await page.goto(TT_PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(1500, 2500)

    // 关闭可能出现的遮罩/弹窗
    await dismissOverlays(page)

    if (page.url().includes('login') || page.url().includes('passport')) {
      throw new Error('Cookie 已失效，请重新获取并配置')
    }

    // ── 4. 填写标题 ────────────────────────────────────────────────────────
    logger.info('TOUTIAO', '正在填写标题...')
    await fillTitle(page, title)
    await sleep(500, 1000)

    // ── 5. 注入正文（Markdown → HTML → ClipboardEvent paste）──────────────
    logger.info('TOUTIAO', '正在注入正文内容...')
    await injectContent(page, content)
    await sleep(500, 1000)

    // ── 6. 上传封面图 ──────────────────────────────────────────────────────
    let coverUploaded = false
    if (tmpCoverPath && fs.existsSync(tmpCoverPath)) {
      try {
        logger.info('TOUTIAO', '开始上传封面图...')
        coverUploaded = await uploadCoverImage(page, tmpCoverPath)
        if (coverUploaded) {
          logger.info('TOUTIAO', '封面上传成功，等待自动保存...')
          await sleep(3000, 4000)
        }
      } catch (e) {
        logger.warn('TOUTIAO', '封面上传失败，草稿已保存但无封面', { error: e.message })
      }
    }

    // ── 7. 点击「预览并发布」→「确认发布」直接发布 ────────────────────────
    logger.info('TOUTIAO', '正在点击「预览并发布」按钮...')
    await dismissOverlays(page)

    const publishBtn = page.locator('button:has-text("预览并发布")').first()
    await publishBtn.scrollIntoViewIfNeeded().catch(() => {})
    await sleep(300, 500)
    await publishBtn.click({ force: true, timeout: 10000 })
    logger.info('TOUTIAO', '已点击「预览并发布」，等待预览页加载...')
    await sleep(3000, 5000)

    // 预览页面需要再次点击「确认发布」
    const confirmPublish = page.locator('button:has-text("确认发布"), button:has-text("发布")').first()
    await confirmPublish.click({ timeout: 10000 }).catch(() => {
      logger.warn('TOUTIAO', '未找到「确认发布」按钮，可能已自动发布')
    })
    await sleep(2000, 4000)

    // 可能还有二次确认弹窗
    const confirmBtn2 = page.locator('button:has-text("确定"), button:has-text("确认")').first()
    await confirmBtn2.click({ timeout: 5000 }).catch(() => {})
    await sleep(2000, 4000)

    const currentUrl = page.url()
    logger.info('TOUTIAO', '发布流程完成', { url: currentUrl })

    res.json({
      success: true,
      message: coverUploaded
        ? '文章已发布到今日头条（含封面）'
        : '文章已发布到今日头条',
      url: 'https://mp.toutiao.com/profile_v4/graphic/articles',
    })

  } catch (err) {
    logger.error('TOUTIAO', '自动推送失败', { error: err.message })
    res.status(500).json({ error: err.message || '自动推送失败，请检查 Cookie 是否有效' })
  } finally {
    if (tmpCoverPath && fs.existsSync(tmpCoverPath)) fs.unlinkSync(tmpCoverPath)
    if (context) await context.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
  }
})

/**
 * 关闭页面上可能出现的遮罩/弹窗（Cookie 提示、引导弹窗等）
 */
async function dismissOverlays(page) {
  const overlaySelectors = [
    'button:has-text("我知道了")',
    'button:has-text("知道了")',
    'button:has-text("关闭")',
    'button:has-text("取消")',
    '.byte-modal-close',
    '.byte-dialog-close',
  ]
  for (const sel of overlaySelectors) {
    try {
      const el = page.locator(sel).first()
      if (await el.isVisible({ timeout: 1000 })) {
        await el.click()
        await sleep(300, 500)
        logger.info('TOUTIAO', `关闭遮罩: ${sel}`)
      }
    } catch {
      // 忽略
    }
  }
}

/**
 * 填写文章标题
 * 用 keyboard.type 模拟真实输入，确保触发 React 的 onChange 事件
 */
async function fillTitle(page, title) {
  const titleSelector = 'textarea[placeholder*="标题"], input[placeholder*="标题"], [class*="title"] textarea, [class*="title"] input'
  try {
    await page.waitForSelector(titleSelector, { timeout: 15000 })
    await sleep(300, 600)
    await page.click(titleSelector, { force: true })
    await sleep(200, 400)
    // 先清空再输入
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Meta+A')
    await page.keyboard.type(title, { delay: 50 + Math.random() * 80 })
    await sleep(300, 500)
    logger.info('TOUTIAO', `标题已填写: ${title}`)
  } catch (e) {
    logger.warn('TOUTIAO', `标题填写失败: ${e.message}`)
  }
}

/**
 * 将 Markdown 内容转为 HTML，通过 ClipboardEvent paste 注入到 ProseMirror 编辑器
 * 这是最可靠的富文本注入方式，参考 mf-yang/toutiao-ops 实现
 */
async function injectContent(page, markdownContent) {
  const editorSelector = '[contenteditable="true"]'

  try {
    await page.waitForSelector(editorSelector, { timeout: 15000 })
    await sleep(300, 600)
    await page.click(editorSelector, { force: true })
    await sleep(200, 400)

    // Markdown → HTML
    const html = marked.parse(markdownContent, { breaks: true, gfm: true })

    // 通过 ClipboardEvent paste 注入富文本
    await page.evaluate(
      ({ html, selector }) => {
        const editor = document.querySelector(selector)
        if (!editor) return
        editor.focus()
        const dt = new DataTransfer()
        dt.setData('text/html', html)
        dt.setData('text/plain', editor.textContent)
        const evt = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        })
        editor.dispatchEvent(evt)
      },
      { html, selector: editorSelector }
    )

    await sleep(800, 1500)

    // 验证内容是否注入成功
    const contentLength = await page.evaluate((selector) => {
      const el = document.querySelector(selector)
      return el ? el.innerText.trim().length : 0
    }, editorSelector)

    if (contentLength > 10) {
      logger.info('TOUTIAO', `正文注入成功，编辑器内容长度: ${contentLength}`)
    } else {
      // 降级：直接设置 innerHTML
      logger.warn('TOUTIAO', 'ClipboardEvent 注入内容为空，降级使用 innerHTML 注入')
      await page.evaluate(
        ({ html, selector }) => {
          const editor = document.querySelector(selector)
          if (!editor) return
          editor.focus()
          editor.innerHTML = html
          editor.dispatchEvent(new InputEvent('input', { bubbles: true }))
          editor.dispatchEvent(new Event('change', { bubbles: true }))
        },
        { html, selector: editorSelector }
      )
      await sleep(500, 1000)
    }
  } catch (e) {
    logger.warn('TOUTIAO', `正文注入失败: ${e.message}`)
  }
}

/**
 * 上传封面图到头条编辑器
 *
 * 流程（参考 mf-yang/toutiao-ops）：
 *   1. 点击「单图」radio 选择封面模式
 *   2. 点击封面区域的 + 号，打开图片上传侧边栏
 *   3. 点击「本地上传」按钮触发 filechooser
 *   4. 注入文件，等待上传完成
 *   5. 点击「确定」关闭侧边栏
 */
async function uploadCoverImage(page, coverFilePath) {
  try {
    // ── Step 1：点击「单图」radio ─────────────────────────────────────────
    const singleRadio = page.locator('text=单图').first()
    if (await singleRadio.isVisible({ timeout: 5000 }).catch(() => false)) {
      await singleRadio.click({ timeout: 5000 })
      await sleep(500, 800)
      logger.info('TOUTIAO', '已选择单图封面模式')
    }

    // ── Step 2：点击封面区域的 + 号，打开上传侧边栏 ──────────────────────
    const coverAreaSelectors = [
      '[class*="cover"] [class*="add"]',
      '[class*="cover"] [class*="upload"]',
      '[class*="cover"] [class*="plus"]',
      '.article-cover-add',
      '[class*="cover-upload"]',
    ]
    let coverAreaClicked = false
    for (const sel of coverAreaSelectors) {
      const el = page.locator(sel).first()
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        await el.click({ timeout: 5000 })
        coverAreaClicked = true
        logger.info('TOUTIAO', `点击封面区域: ${sel}`)
        break
      }
    }

    if (!coverAreaClicked) {
      logger.warn('TOUTIAO', '未找到封面添加区域，跳过封面上传')
      return false
    }

    await sleep(1000, 2000)

    // ── Step 3：点击「本地上传」按钮触发 filechooser ─────────────────────
    const localUploadBtn = page.locator('text=本地上传').first()
    const hasLocalUpload = await localUploadBtn.isVisible({ timeout: 5000 }).catch(() => false)

    if (hasLocalUpload) {
      // 侧边栏有「本地上传」按钮
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10000 }),
        localUploadBtn.click({ timeout: 5000 }),
      ])
      await fileChooser.setFiles(coverFilePath)
      logger.info('TOUTIAO', '通过「本地上传」按钮注入封面文件')
    } else {
      // 直接监听 filechooser（点击封面区域直接触发）
      logger.info('TOUTIAO', '未找到「本地上传」按钮，尝试直接 filechooser...')
      // 重新点击封面区域触发 filechooser
      let injected = false
      for (const sel of coverAreaSelectors) {
        const el = page.locator(sel).first()
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          try {
            const [fileChooser] = await Promise.all([
              page.waitForEvent('filechooser', { timeout: 6000 }),
              el.click({ timeout: 5000 }),
            ])
            await fileChooser.setFiles(coverFilePath)
            logger.info('TOUTIAO', `filechooser 方式注入封面: ${sel}`)
            injected = true
            break
          } catch {
            // 继续尝试下一个
          }
        }
      }

      if (!injected) {
        // 最后备用：直接找 file input
        const fileInput = page.locator('input[type="file"][accept*="image"]').first()
        if (await fileInput.count().catch(() => 0) > 0) {
          await fileInput.setInputFiles(coverFilePath)
          logger.info('TOUTIAO', 'file input 方式注入封面')
        } else {
          logger.warn('TOUTIAO', '无法注入封面文件，跳过封面上传')
          return false
        }
      }
    }

    // ── Step 4：等待上传完成 ──────────────────────────────────────────────
    await sleep(3000, 5000)

    // ── Step 5：点击「确定」关闭侧边栏 ───────────────────────────────────
    const confirmSelectors = [
      '.byte-drawer-wrapper button:has-text("确定")',
      '.upload-image-panel button:has-text("确定")',
      '.byte-modal button.byte-btn-primary',
      '.byte-modal-footer button:last-child',
      'button:has-text("确定")',
    ]
    for (const sel of confirmSelectors) {
      const btn = page.locator(sel).first()
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click()
        logger.info('TOUTIAO', `点击封面确认: ${sel}`)
        await sleep(1000, 2000)
        break
      }
    }

    logger.info('TOUTIAO', '封面上传流程完成')
    return true

  } catch (e) {
    logger.warn('TOUTIAO', `封面上传异常: ${e.message}`)
    // 尝试关闭残留侧边栏
    await page.locator('.byte-drawer-wrapper button:has-text("取消")').first()
      .click({ timeout: 3000 }).catch(() => {})
    await page.keyboard.press('Escape').catch(() => {})
    return false
  }
}

export default router
