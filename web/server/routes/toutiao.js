/**
 * 今日头条自动推送路由
 *
 * 核心修复（参考 wechatsync/Wechatsync + CSDN 实战经验）：
 * 1. 内容注入：直接设置 innerHTML + 触发 React input/change 事件，放弃 execCommand
 * 2. 发布流程：头条是「预览 → 确认发布」两步，需要等待预览页完全加载后再点确认
 * 3. Cookie 注入：先访问 mp.toutiao.com 主页，注入 Cookie 后再跳转发布页
 * 4. 标题输入：用 nativeInputValueSetter 触发 React 受控组件的 onChange
 * 5. 禁用 JS 拦截：对发布按钮用 dispatchEvent 绕过可能的 JS 拦截
 *
 * POST /api/toutiao/publish   → 自动推送文章到今日头条（直接发布）
 * GET  /api/toutiao/status    → 检查服务是否可用
 */
import { Router } from 'express'
import { chromium } from 'playwright'
import { spawn, execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import http from 'http'
import { marked } from 'marked'
import { logger } from '../logger.js'

/**
 * 随机等待 [min, max] 毫秒
 */
function sleep(min, max) {
  const ms = max ? Math.floor(min + Math.random() * (max - min)) : min
  return new Promise(r => setTimeout(r, ms))
}

/**
 * 将图片 URL 下载到本地临时文件
 */
async function downloadImageToTemp(imageUrl, baseOrigin) {
  const tmpPath = path.join(os.tmpdir(), `tt_cover_${Date.now()}.jpg`)
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

let chromiumStatus = 'checking'
let chromiumStatusMsg = '正在检测浏览器环境...'

async function ensureChromiumInstalled() {
  const tryInstall = (args) => new Promise((resolve) => {
    const label = `npx playwright install ${args.join(' ')}`
    logger.info('TOUTIAO', `执行: ${label}`)

    const proc = spawn('npx', ['playwright', 'install', ...args], {
      stdio: 'pipe',
      detached: false,
      env: { ...process.env },
    })

    let output = ''
    const onData = (chunk) => {
      const line = chunk.toString().trimEnd()
      if (line) {
        output += line + '\n'
        logger.info('TOUTIAO', `[install] ${line}`)
      }
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)

    proc.on('close', code => {
      logger.info('TOUTIAO', `${label} 退出码: ${code}`)
      resolve({ code, output })
    })
    proc.on('error', err => {
      logger.warn('TOUTIAO', `spawn 失败: ${err.message}`)
      resolve({ code: -1, output: err.message })
    })
  })

  try {
    const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
    await b.close()
    chromiumStatus = 'ready'
    chromiumStatusMsg = 'Chromium 已就绪'
    logger.info('TOUTIAO', 'Playwright Chromium 已就绪，无需安装')
    return
  } catch (e) {
    logger.info('TOUTIAO', `Chromium 未就绪（${e.message.split('\n')[0]}），开始安装...`)
  }

  chromiumStatus = 'installing'
  chromiumStatusMsg = '正在后台安装 Chromium（约 1-2 分钟）...'

  const r1 = await tryInstall(['chromium'])
  if (r1.code === 0) {
    chromiumStatus = 'ready'
    chromiumStatusMsg = 'Chromium 安装完成，发布功能已就绪'
    return
  }

  const r2 = await tryInstall(['chromium', '--with-deps'])
  if (r2.code === 0) {
    chromiumStatus = 'ready'
    chromiumStatusMsg = 'Chromium 安装完成，发布功能已就绪'
  } else {
    chromiumStatus = 'failed'
    chromiumStatusMsg = 'Chromium 安装失败，请查看服务日志了解详情'
    const lastLines = r2.output.trim().split('\n').slice(-20).join('\n')
    logger.warn('TOUTIAO', lastLines || '（无输出）')
  }
}

ensureChromiumInstalled()

/**
 * 启动浏览器并返回 { browser, context }
 * macOS 优先用 Edge + 临时 profile，Linux 用 Playwright Chromium
 */
async function launchBrowserWithContext(extraContextOptions = {}) {
  const commonArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1440,900',
    // 禁用自动化检测特征
    '--disable-blink-features=AutomationControlled',
  ]

  if (fs.existsSync(EDGE_PATH)) {
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
  }

  let browser
  try {
    browser = await chromium.launch({ headless: true, args: commonArgs })
  } catch (e) {
    logger.warn('TOUTIAO', 'Chromium 启动失败，尝试安装...', { error: e.message })
    try {
      execSync('npx playwright install chromium --with-deps', {
        stdio: 'pipe',
        timeout: 300000,
      })
      browser = await chromium.launch({ headless: true, args: commonArgs })
    } catch (installErr) {
      throw new Error(
        `Playwright Chromium 未安装且自动安装失败：${installErr.message}。` +
        '请在服务器上手动运行：npx playwright install chromium --with-deps'
      )
    }
  }
  const context = await browser.newContext(extraContextOptions)
  return { browser, context }
}

const router = Router()

const TT_HOME_URL = 'https://mp.toutiao.com'
const TT_PUBLISH_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish'
const TITLE_MAX_LEN = 30
const TITLE_MIN_LEN = 2

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
  res.json({
    available: chromiumStatus === 'ready',
    status: chromiumStatus,
    message: chromiumStatusMsg,
  })
})

// ── GET /api/toutiao/install-logs ────────────────────────────────────────────
router.get('/install-logs', (req, res) => {
  try {
    const logDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'logs')
    const today = new Date().toISOString().split('T')[0]
    const logFile = path.join(logDir, `app-${today}.log`)

    if (!fs.existsSync(logFile)) {
      return res.json({ lines: [] })
    }

    const raw = fs.readFileSync(logFile, 'utf8')
    const lines = raw
      .split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter(l => l && l.module === 'TOUTIAO')
      .slice(-100)
      .map(l => `[${l.timestamp}] [${l.level}] ${l.message}`)

    res.json({ lines, status: chromiumStatus, message: chromiumStatusMsg })
  } catch (e) {
    res.json({ lines: [`读取日志失败: ${e.message}`], status: chromiumStatus, message: chromiumStatusMsg })
  }
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
    const launched = await launchBrowserWithContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
    browser = launched.browser
    context = launched.context

    // ── 2. 先访问主页，再注入 Cookie（确保 domain 匹配）─────────────────
    const page = await context.newPage()

    // 屏蔽不必要的资源，加快加载速度
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,eot}', route => route.abort())

    logger.info('TOUTIAO', '正在访问头条主页以建立 Cookie 域...')
    await page.goto(TT_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(500, 1000)

    // 注入 Cookie
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
    logger.info('TOUTIAO', `已注入 ${normalizedCookies.length} 个 Cookie`)

    // ── 3. 访问发布页 ──────────────────────────────────────────────────────
    logger.info('TOUTIAO', '正在访问头条发布页...')
    await page.goto(TT_PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(2000, 3000)

    // 关闭遮罩
    await dismissOverlays(page)

    // 检查登录状态
    const currentUrl = page.url()
    if (currentUrl.includes('login') || currentUrl.includes('passport') || currentUrl.includes('sso')) {
      throw new Error('Cookie 已失效，请重新获取并配置')
    }

    logger.info('TOUTIAO', `发布页加载完成: ${currentUrl}`)

    // ── 4. 等待编辑器完全加载 ──────────────────────────────────────────────
    logger.info('TOUTIAO', '等待编辑器加载...')
    await waitForEditor(page)
    await sleep(1000, 1500)

    // ── 5. 填写标题 ────────────────────────────────────────────────────────
    logger.info('TOUTIAO', '正在填写标题...')
    await fillTitle(page, title)
    await sleep(800, 1200)

    // ── 6. 注入正文内容 ────────────────────────────────────────────────────
    logger.info('TOUTIAO', '正在注入正文内容...')
    await injectContent(page, content)
    await sleep(2000, 3000)

    // 处理可能出现的保存失败弹窗
    await dismissSaveFailDialog(page)

    // ── 7. 上传封面图 ──────────────────────────────────────────────────────
    let coverUploaded = false
    if (tmpCoverPath && fs.existsSync(tmpCoverPath)) {
      try {
        logger.info('TOUTIAO', '开始上传封面图...')
        coverUploaded = await uploadCoverImage(page, tmpCoverPath)
        if (coverUploaded) {
          logger.info('TOUTIAO', '封面上传成功')
          await sleep(2000, 3000)
        }
      } catch (e) {
        logger.warn('TOUTIAO', '封面上传失败，继续发布流程', { error: e.message })
      }
    }

    // ── 8. 点击「预览并发布」→ 等待预览页 → 点击「确认发布」────────────
    logger.info('TOUTIAO', '开始发布流程...')
    await dismissSaveFailDialog(page)
    await dismissOverlays(page)

    const published = await clickPublish(page)

    const finalUrl = page.url()
    logger.info('TOUTIAO', '发布流程完成', { url: finalUrl, published })

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
 * 等待编辑器加载完成
 */
async function waitForEditor(page) {
  const editorSelectors = [
    '.ProseMirror',
    '[contenteditable="true"]',
    '.article-editor',
  ]
  for (const sel of editorSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 15000 })
      logger.info('TOUTIAO', `编辑器已加载: ${sel}`)
      return sel
    } catch {
      // 继续尝试
    }
  }
  logger.warn('TOUTIAO', '编辑器加载超时，继续执行')
  return null
}

/**
 * 关闭页面上可能出现的遮罩/弹窗
 */
async function dismissOverlays(page) {
  const overlaySelectors = [
    'button:has-text("我知道了")',
    'button:has-text("知道了")',
    'button:has-text("关闭")',
    '.byte-modal-close',
    '.byte-dialog-close',
    '[class*="modal-close"]',
    '[class*="dialog-close"]',
  ]
  for (const sel of overlaySelectors) {
    try {
      const el = page.locator(sel).first()
      if (await el.isVisible({ timeout: 800 })) {
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
 * 处理「保存失败」弹窗
 */
async function dismissSaveFailDialog(page) {
  try {
    const hasFailText = await page.locator('text=保存失败, text=保存出错, text=网络异常').first()
      .isVisible({ timeout: 1500 }).catch(() => false)
    if (!hasFailText) return

    logger.warn('TOUTIAO', '检测到「保存失败」弹窗，尝试关闭...')
    const saveFailSelectors = [
      'button:has-text("重试")',
      'button:has-text("忽略")',
      'button:has-text("我知道了")',
      'button:has-text("确定")',
    ]
    for (const sel of saveFailSelectors) {
      const btn = page.locator(sel).first()
      if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
        await btn.click()
        logger.info('TOUTIAO', `关闭保存失败弹窗: ${sel}`)
        await sleep(500, 800)
        return
      }
    }
    await page.keyboard.press('Escape')
    await sleep(300, 500)
  } catch {
    // 忽略
  }
}

/**
 * 填写文章标题
 *
 * 头条标题是 React 受控 textarea，需要用 nativeInputValueSetter 触发 onChange
 */
async function fillTitle(page, title) {
  // 头条标题输入框的 placeholder 是「请输入文章标题」
  const titleSelectors = [
    'textarea[placeholder*="请输入文章标题"]',
    'textarea[placeholder*="标题"]',
    'input[placeholder*="标题"]',
    '[class*="title"] textarea',
    '[class*="title"] input',
  ]

  let titleEl = null
  for (const sel of titleSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 })
      titleEl = sel
      break
    } catch {
      // 继续
    }
  }

  if (!titleEl) {
    logger.warn('TOUTIAO', '未找到标题输入框，跳过标题填写')
    return
  }

  try {
    // 点击聚焦
    await page.click(titleEl, { force: true })
    await sleep(200, 400)

    // 全选清空
    await page.keyboard.press('Meta+A')
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Delete')
    await sleep(100, 200)

    // 用 React nativeInputValueSetter 触发受控组件 onChange
    await page.evaluate(({ selector, value }) => {
      const el = document.querySelector(selector)
      if (!el) return

      // 触发 React 受控组件的 onChange
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      } else {
        el.value = value
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }, { selector: titleEl, value: title })

    await sleep(300, 500)

    // 验证是否填写成功
    const actualValue = await page.$eval(titleEl, el => el.value).catch(() => '')
    if (!actualValue || actualValue.length < 2) {
      // 降级：键盘逐字输入
      logger.warn('TOUTIAO', 'React 事件注入标题失败，降级为键盘输入')
      await page.click(titleEl, { force: true })
      await sleep(200, 300)
      await page.keyboard.type(title, { delay: 40 + Math.random() * 60 })
    }

    logger.info('TOUTIAO', `标题已填写: ${title}`)
  } catch (e) {
    logger.warn('TOUTIAO', `标题填写失败: ${e.message}`)
  }
}

/**
 * 将 Markdown 内容注入到头条 ProseMirror 编辑器
 *
 * 策略（按可靠性排序）：
 * 1. innerHTML 直接设置 + 触发 React mutation（最可靠）
 * 2. Clipboard paste 事件（富文本）
 * 3. keyboard.type 逐字符输入（纯文本兜底）
 */
async function injectContent(page, markdownContent) {
  // 预处理：移除图片（头条不接受外部图片 URL）
  const cleanedMarkdown = markdownContent
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\n{3,}/g, '\n\n')

  // Markdown → HTML
  const html = marked.parse(cleanedMarkdown, { breaks: true, gfm: true })

  // 找编辑器（排除标题区域）
  const editorSelectors = [
    '.ProseMirror',
    '.article-editor [contenteditable="true"]',
    '[contenteditable="true"]:not([placeholder*="标题"]):not([placeholder*="title"])',
    '[contenteditable="true"]',
  ]

  let editorSel = null
  for (const sel of editorSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 })
      // 确认不是标题框
      const placeholder = await page.$eval(sel, el => el.getAttribute('placeholder') || '').catch(() => '')
      if (placeholder.includes('标题') || placeholder.includes('title')) continue
      editorSel = sel
      break
    } catch {
      // 继续
    }
  }

  if (!editorSel) {
    logger.warn('TOUTIAO', '未找到正文编辑器，跳过内容注入')
    return
  }

  logger.info('TOUTIAO', `使用编辑器选择器: ${editorSel}`)

  // 点击聚焦编辑器
  await page.click(editorSel, { force: true })
  await sleep(300, 500)

  // ── 方案 1：innerHTML 直接设置 + 触发 MutationObserver ──────────────────
  logger.info('TOUTIAO', '尝试 innerHTML 直接注入...')
  const injected = await page.evaluate(
    ({ html, selector }) => {
      const editor = document.querySelector(selector)
      if (!editor) return false

      editor.focus()

      // 全选清空
      const range = document.createRange()
      range.selectNodeContents(editor)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      document.execCommand('delete', false, null)

      // 直接设置 innerHTML
      editor.innerHTML = html

      // 触发 ProseMirror 的 input 事件（让编辑器感知内容变化）
      editor.dispatchEvent(new Event('input', { bubbles: true }))
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
      }))

      // 将光标移到末尾（触发编辑器状态更新）
      const endRange = document.createRange()
      endRange.selectNodeContents(editor)
      endRange.collapse(false)
      sel.removeAllRanges()
      sel.addRange(endRange)

      return editor.innerText.trim().length > 0
    },
    { html, selector: editorSel }
  )

  await sleep(1000, 1500)

  let contentLength = await page.evaluate((selector) => {
    const el = document.querySelector(selector)
    return el ? el.innerText.trim().length : 0
  }, editorSel)

  if (contentLength > 10) {
    logger.info('TOUTIAO', `innerHTML 注入成功，内容长度: ${contentLength}`)
    return
  }

  // ── 方案 2：ClipboardEvent paste（富文本）────────────────────────────────
  logger.warn('TOUTIAO', 'innerHTML 注入失败，尝试 ClipboardEvent paste...')
  await page.evaluate(
    ({ html, selector }) => {
      const editor = document.querySelector(selector)
      if (!editor) return
      editor.focus()

      // 清空
      editor.innerHTML = ''

      const dt = new DataTransfer()
      dt.setData('text/html', html)
      dt.setData('text/plain', editor.textContent || '')
      editor.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }))
    },
    { html, selector: editorSel }
  )
  await sleep(1000, 1500)

  contentLength = await page.evaluate((selector) => {
    const el = document.querySelector(selector)
    return el ? el.innerText.trim().length : 0
  }, editorSel)

  if (contentLength > 10) {
    logger.info('TOUTIAO', `ClipboardEvent 注入成功，内容长度: ${contentLength}`)
    return
  }

  // ── 方案 3：keyboard.type 逐字符输入（纯文本兜底）────────────────────────
  logger.warn('TOUTIAO', 'ClipboardEvent 注入失败，降级为键盘逐字符输入...')
  await page.click(editorSel, { force: true })
  await sleep(200, 300)
  await page.keyboard.press('Meta+A')
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await sleep(200, 300)

  const plainText = cleanedMarkdown
  const chunks = plainText.match(/.{1,500}/gs) || [plainText]
  for (const chunk of chunks) {
    await page.keyboard.type(chunk, { delay: 5 })
    await sleep(100, 200)
  }

  contentLength = await page.evaluate((selector) => {
    const el = document.querySelector(selector)
    return el ? el.innerText.trim().length : 0
  }, editorSel)
  logger.info('TOUTIAO', `键盘输入完成，内容长度: ${contentLength}`)
}

/**
 * 执行发布流程：点击「预览并发布」→ 等待预览页 → 点击「确认发布」
 *
 * 头条发布是两步流程：
 * 1. 编辑页点「预览并发布」→ 跳转到预览页
 * 2. 预览页点「确认发布」→ 发布成功
 *
 * 关键：用 Promise.all 并发等待页面跳转 + 点击按钮，避免时序问题
 */
async function clickPublish(page) {
  // ── Step 1：找并点击「预览并发布」按钮 ────────────────────────────────
  const previewBtnSelectors = [
    'button:has-text("预览并发布")',
    'button:has-text("发布文章")',
    '[class*="publish"] button',
    'button[class*="publish"]',
  ]

  let previewClicked = false
  for (const sel of previewBtnSelectors) {
    const btn = page.locator(sel).first()
    if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
      try {
        await btn.scrollIntoViewIfNeeded().catch(() => {})
        await sleep(300, 500)

        // 并发等待导航 + 点击（处理页面跳转场景）
        await Promise.race([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
          btn.click({ force: true, timeout: 8000 }),
        ])

        previewClicked = true
        logger.info('TOUTIAO', `已点击发布按钮: ${sel}`)
        break
      } catch (e) {
        logger.warn('TOUTIAO', `点击 ${sel} 失败: ${e.message}`)
      }
    }
  }

  if (!previewClicked) {
    // 最后尝试：用 JS 直接触发点击事件
    logger.warn('TOUTIAO', '常规点击失败，尝试 JS 触发点击...')
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      const publishBtn = btns.find(b =>
        b.textContent?.includes('预览并发布') ||
        b.textContent?.includes('发布文章') ||
        b.textContent?.includes('发布')
      )
      if (publishBtn) {
        publishBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }
    })
  }

  // 等待页面响应
  await sleep(3000, 5000)
  await dismissSaveFailDialog(page)
  await dismissOverlays(page)

  const urlAfterPreview = page.url()
  logger.info('TOUTIAO', `点击预览后 URL: ${urlAfterPreview}`)

  // ── Step 2：在预览页点击「确认发布」────────────────────────────────────
  // 预览页可能是新 tab 或当前页面变化
  const confirmSelectors = [
    'button:has-text("确认发布")',
    'button:has-text("立即发布")',
    'button:has-text("发布")',
    '[class*="confirm"] button',
    '.byte-btn-primary:has-text("发布")',
  ]

  let confirmClicked = false
  for (const sel of confirmSelectors) {
    const btn = page.locator(sel).first()
    if (await btn.isVisible({ timeout: 8000 }).catch(() => false)) {
      try {
        await btn.click({ force: true, timeout: 8000 })
        confirmClicked = true
        logger.info('TOUTIAO', `已点击确认发布: ${sel}`)
        break
      } catch (e) {
        logger.warn('TOUTIAO', `点击确认发布 ${sel} 失败: ${e.message}`)
      }
    }
  }

  if (!confirmClicked) {
    // JS 触发兜底
    logger.warn('TOUTIAO', '未找到确认发布按钮，尝试 JS 触发...')
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      const confirmBtn = btns.find(b =>
        b.textContent?.includes('确认发布') ||
        b.textContent?.includes('立即发布') ||
        (b.textContent?.trim() === '发布' && b.className?.includes('primary'))
      )
      if (confirmBtn) {
        confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }
    })
  }

  await sleep(2000, 4000)

  // 可能还有二次确认弹窗
  const secondConfirmSelectors = [
    'button:has-text("确定")',
    'button:has-text("确认")',
    'button:has-text("好的")',
  ]
  for (const sel of secondConfirmSelectors) {
    const btn = page.locator(sel).first()
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click({ timeout: 5000 }).catch(() => {})
      logger.info('TOUTIAO', `关闭二次确认弹窗: ${sel}`)
      await sleep(1000, 2000)
      break
    }
  }

  return confirmClicked || previewClicked
}

/**
 * 上传封面图到头条编辑器
 */
async function uploadCoverImage(page, coverFilePath) {
  try {
    // ── Step 1：点击「单图」radio ─────────────────────────────────────────
    const singleRadioSelectors = [
      'text=单图',
      '[class*="cover"] [class*="single"]',
      'label:has-text("单图")',
    ]
    for (const sel of singleRadioSelectors) {
      const el = page.locator(sel).first()
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        await el.click({ timeout: 5000 })
        await sleep(500, 800)
        logger.info('TOUTIAO', `已选择单图封面模式: ${sel}`)
        break
      }
    }

    // ── Step 2：点击封面区域的 + 号，打开上传侧边栏 ──────────────────────
    const coverAreaSelectors = [
      '[class*="cover"] [class*="add"]',
      '[class*="cover"] [class*="upload"]',
      '[class*="cover"] [class*="plus"]',
      '.article-cover-add',
      '[class*="cover-upload"]',
      '[class*="coverUpload"]',
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
    const localUploadSelectors = [
      'text=本地上传',
      'button:has-text("本地上传")',
      '[class*="local"] button',
    ]

    let fileInjected = false

    for (const sel of localUploadSelectors) {
      const btn = page.locator(sel).first()
      if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
        try {
          const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 10000 }),
            btn.click({ timeout: 5000 }),
          ])
          await fileChooser.setFiles(coverFilePath)
          logger.info('TOUTIAO', '通过「本地上传」按钮注入封面文件')
          fileInjected = true
          break
        } catch (e) {
          logger.warn('TOUTIAO', `本地上传按钮点击失败: ${e.message}`)
        }
      }
    }

    if (!fileInjected) {
      // 直接找 file input
      const fileInput = page.locator('input[type="file"][accept*="image"]').first()
      if (await fileInput.count().catch(() => 0) > 0) {
        await fileInput.setInputFiles(coverFilePath)
        logger.info('TOUTIAO', 'file input 方式注入封面')
        fileInjected = true
      }
    }

    if (!fileInjected) {
      // 重新点击封面区域触发 filechooser
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
            fileInjected = true
            break
          } catch {
            // 继续
          }
        }
      }
    }

    if (!fileInjected) {
      logger.warn('TOUTIAO', '无法注入封面文件，跳过封面上传')
      return false
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
    await page.locator('.byte-drawer-wrapper button:has-text("取消")').first()
      .click({ timeout: 3000 }).catch(() => {})
    await page.keyboard.press('Escape').catch(() => {})
    return false
  }
}

export default router
