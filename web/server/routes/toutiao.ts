/**
 * 今日头条自动推送路由
 *
 * POST /api/toutiao/publish   → 自动推送文章到今日头条
 * GET  /api/toutiao/status    → 检查服务是否可用
 */
import { Router } from 'express'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createHash } from 'crypto'
import { marked } from 'marked'
import { logger } from '../logger.js'
import { authMiddleware } from '../authMiddleware.js'
import { prepareToutiaoCoverFile } from '../utils/toutiaoCover.ts'
import { chooseToutiaoNoCover, submitToutiaoArticle } from '../utils/toutiaoPublish.ts'

function sleep(min, max) {
  const ms = max ? Math.floor(min + Math.random() * (max - min)) : min
  return new Promise(r => setTimeout(r, ms))
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
      stdio: 'pipe', detached: false, env: { ...process.env },
    })
    let output = ''
    const onData = (chunk) => {
      const line = chunk.toString().trimEnd()
      if (line) { output += line + '\n'; logger.info('TOUTIAO', `[install] ${line}`) }
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.on('close', code => { logger.info('TOUTIAO', `${label} 退出码: ${code}`); resolve({ code, output }) })
    proc.on('error', err => { logger.warn('TOUTIAO', `spawn 失败: ${err.message}`); resolve({ code: -1, output: err.message }) })
  })

  try {
    const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
    await b.close()
    chromiumStatus = 'ready'
    chromiumStatusMsg = 'Chromium 已就绪'
    logger.info('TOUTIAO', 'Playwright Chromium 已就绪')
    return
  } catch (e) {
    logger.info('TOUTIAO', `Chromium 未就绪，开始安装...`)
  }

  chromiumStatus = 'installing'
  chromiumStatusMsg = '正在后台安装 Chromium（约 1-2 分钟）...'

  const r1 = await tryInstall(['chromium'])
  if (r1.code === 0) { chromiumStatus = 'ready'; chromiumStatusMsg = 'Chromium 安装完成'; return }

  const r2 = await tryInstall(['chromium', '--with-deps'])
  if (r2.code === 0) {
    chromiumStatus = 'ready'; chromiumStatusMsg = 'Chromium 安装完成'
  } else {
    chromiumStatus = 'failed'; chromiumStatusMsg = 'Chromium 安装失败'
    logger.warn('TOUTIAO', r2.output.trim().split('\n').slice(-20).join('\n') || '（无输出）')
  }
}

ensureChromiumInstalled()

async function launchBrowserWithContext(extraContextOptions = {}, { preferChromium = false } = {}) {
  const commonArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1440,900',
    '--disable-blink-features=AutomationControlled',
  ]

  if (!preferChromium && fs.existsSync(EDGE_PATH)) {
    const tmpProfileDir = path.join(os.tmpdir(), `edge_profile_${Date.now()}`)
    const realDefaultProfile = path.join(EDGE_USER_DATA, 'Default')
    try {
      fs.mkdirSync(path.join(tmpProfileDir, 'Default'), { recursive: true })
      for (const f of ['Cookies', 'Preferences', 'Local State']) {
        const src = f === 'Local State' ? path.join(EDGE_USER_DATA, f) : path.join(realDefaultProfile, f)
        const dst = f === 'Local State' ? path.join(tmpProfileDir, f) : path.join(tmpProfileDir, 'Default', f)
        if (fs.existsSync(src)) fs.copyFileSync(src, dst)
      }
      const context = await chromium.launchPersistentContext(tmpProfileDir, {
        executablePath: EDGE_PATH,
        headless: true,
        timeout: 15000,
        args: commonArgs,
        ...extraContextOptions,
      })
      logger.info('TOUTIAO', '使用 Edge + 临时 profile 启动成功')
      context.once('close', () => {
        try {
          fs.rmSync(tmpProfileDir, { recursive: true, force: true })
        } catch (error) {
          logger.warn('TOUTIAO', '清理 Edge 临时 profile 失败', { error: error.message })
        }
      })
      return { browser: null, context }
    } catch (e) {
      logger.warn('TOUTIAO', `Edge 启动失败，回退到 Chromium: ${e.message}`)
      fs.rmSync(tmpProfileDir, { recursive: true, force: true })
    }
  }

  // 启动时已有后台安装任务。发布期间同步安装会卡住整个 API 进程。
  const browser = await chromium.launch({ headless: true, args: commonArgs, timeout: 15000 })
  try {
    const context = await browser.newContext(extraContextOptions)
    return { browser, context }
  } catch (error) {
    await browser.close().catch(() => {})
    throw error
  }
}

const router = Router()
router.use(authMiddleware)

const TT_HOME_URL = 'https://mp.toutiao.com'
const TT_PUBLISH_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish'
const TT_INCOME_OVERVIEW_URL = 'https://mp.toutiao.com/profile_v4/analysis/income-overview'
const TITLE_MAX_LEN = 30
const TITLE_MIN_LEN = 2
const PUBLISH_PAGE_TIMEOUT_MS = 150000
// 生产 PM2 只有一个实例。这里限制整台主机的发布并发，保护其他 API。
let publishing = false
const ACCOUNT_CACHE_TTL_MS = 15 * 60 * 1000
const accountCache = new Map()
const accountRequests = new Map()

function parseCookies(req) {
  const raw = req.body?.cookies
  if (!raw) return null
  try {
    const cookies = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(cookies) || cookies.length === 0) return null
    return cookies
  } catch { return null }
}

function normalizeCookies(cookies) {
  return cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain || '.toutiao.com',
    path: c.path || '/',
    secure: c.secure ?? false,
    httpOnly: c.httpOnly ?? false,
    sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax',
  }))
}

function parseMetric(value, { integer = true } = {}) {
  const text = String(value ?? '').replace(/[\s,，]/g, '')
  const matched = text.match(/(\d+(?:\.\d+)?)\s*([万亿wW]?)/)
  if (!matched) return null
  const number = Number(matched[1])
  if (!Number.isFinite(number)) return null
  const unit = matched[2].toLowerCase()
  const scaled = unit === '万' || unit === 'w'
    ? number * 10000
    : unit === '亿'
      ? number * 100000000
      : number
  return integer ? Math.round(scaled) : scaled
}

function extractDashboardMetric(text, label, options = {}) {
  const index = text.indexOf(label)
  if (index === -1) return null

  // 指标值在头条仪表盘中位于标签之后的独立节点；限制范围可避开下方作品列表的阅读量。
  const metricText = text.slice(index + label.length, index + label.length + 80)
  const value = /(?:^|\s)([\d.,，]+(?:\s*[万亿wW])?)(?:\s|$)/.exec(metricText)?.[1]
  return parseMetric(value, options)
}

function extractIncomeOverviewMetric(text) {
  const index = text.indexOf('累计收益')
  if (index === -1) return null
  const metricText = text.slice(index + '累计收益'.length, index + '累计收益'.length + 120)
  const value = /(?:^|\s)([\d.,，]+(?:\s*[万亿wW])?)(?:元|\s|$)/.exec(metricText)?.[1]
  return parseMetric(value, { integer: false })
}

function getAccountCacheKey(cookies) {
  const fingerprint = cookies
    .map(cookie => `${cookie.domain || ''}:${cookie.name || ''}:${cookie.value || ''}`)
    .sort()
    .join('|')
  return createHash('sha256').update(fingerprint).digest('hex')
}

async function getToutiaoAccount(cookies) {
  let browser: Browser | null = null
  let context: BrowserContext | null = null
  try {
    const launched = await launchBrowserWithContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }, { preferChromium: true })
    browser = launched.browser
    context = launched.context
    await context.addCookies(normalizeCookies(cookies))

    const page = await context.newPage()
    await page.goto('https://mp.toutiao.com/profile_v4/index', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForFunction(
      () => {
        const text = document.body.innerText || ''
        return text.includes('粉丝数')
          && text.includes('总阅读(播放)量')
          && text.includes('累计收益')
      },
      { timeout: 10000 },
    ).catch(() => {})
    await sleep(600, 1000)

    const currentUrl = page.url()
    if (currentUrl.includes('login') || currentUrl.includes('passport') || currentUrl.includes('sso')) {
      throw new Error('Cookie 已失效，请重新获取并绑定')
    }

    const data = await page.evaluate(() => {
      const text = document.body.innerText || ''
      const nicknameCandidates = [
        '[class*="user"] [class*="name"]',
        '[class*="profile"] [class*="name"]',
        '[class*="author"] [class*="name"]',
      ]
      let nickname = ''
      for (const selector of nicknameCandidates) {
        const item = document.querySelector(selector)
        const value = item?.textContent?.trim()
        if (value && value.length < 50) {
          nickname = value
          break
        }
      }

      const avatarCandidates = Array.from(document.images)
        .map(image => {
          const rect = image.getBoundingClientRect()
          const width = rect.width || image.naturalWidth
          const height = rect.height || image.naturalHeight
          const isSquare = width > 0 && height > 0 && Math.abs(width - height) / Math.max(width, height) < 0.2
          const inCreatorHeader = rect.top >= 0
            && rect.top < 110
            && rect.left > window.innerWidth * 0.65
            && width >= 20
            && width <= 96
            && isSquare
          return {
            url: image.currentSrc || image.src,
            score: inCreatorHeader ? rect.left - rect.top : -Infinity,
          }
        })
        .filter(candidate => candidate.url && Number.isFinite(candidate.score))
        .sort((left, right) => right.score - left.score)

      return {
        text,
        nickname,
        avatarUrl: avatarCandidates[0]?.url || null,
      }
    })

    return {
      nickname: data.nickname || '今日头条账号',
      avatar_url: data.avatarUrl,
      description: null,
      followers_count: extractDashboardMetric(data.text, '粉丝数'),
      total_reads: extractDashboardMetric(data.text, '总阅读(播放)量'),
      total_income: await getToutiaoIncome(page),
      data_note: '粉丝数、总阅读(播放)量来自创作中心首页；累计收益来自收益总览。',
    }
  } finally {
    if (context) await context.close().catch(() => {})
    if (browser) await browser.close().catch(() => {})
  }
}

async function getToutiaoIncome(page) {
  await page.goto(TT_INCOME_OVERVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForFunction(
    () => (document.body.innerText || '').includes('累计收益'),
    { timeout: 10000 },
  ).catch(() => {})
  await sleep(600, 1000)

  const incomeText = await page.evaluate(() => document.body.innerText || '')
  const totalIncome = extractIncomeOverviewMetric(incomeText)
  if (totalIncome === null) {
    logger.warn('TOUTIAO', '收益总览页未识别到累计收益', { sample: incomeText.slice(0, 240) })
  }
  return totalIncome
}

async function getCachedToutiaoAccount(cookies, forceRefresh) {
  const cacheKey = getAccountCacheKey(cookies)
  const cached = accountCache.get(cacheKey)
  const now = Date.now()
  if (!forceRefresh && cached && now - cached.fetchedAt < ACCOUNT_CACHE_TTL_MS) {
    return { ...cached.account, cached: true, cached_at: new Date(cached.fetchedAt).toISOString() }
  }

  const pending = accountRequests.get(cacheKey)
  if (pending) return pending

  const request = getToutiaoAccount(cookies)
    .then(account => {
      const fetchedAt = Date.now()
      accountCache.set(cacheKey, { account, fetchedAt })
      return { ...account, cached: false, cached_at: new Date(fetchedAt).toISOString() }
    })
    .finally(() => accountRequests.delete(cacheKey))
  accountRequests.set(cacheKey, request)
  return request
}

// ── GET /api/toutiao/status ──────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({ available: chromiumStatus === 'ready', status: chromiumStatus, message: chromiumStatusMsg })
})

// ── POST /api/toutiao/account ────────────────────────────────────────────────
router.post('/account', async (req, res) => {
  const cookies = parseCookies(req)
  if (!cookies) return res.status(401).json({ error: '未提供今日头条 Cookie，请先绑定账号' })

  try {
    const forceRefresh = req.body?.force_refresh === true
    logger.info('TOUTIAO', '开始读取头条账号数据', { cookieCount: cookies.length, forceRefresh })
    const account = await getCachedToutiaoAccount(cookies, forceRefresh)
    logger.info('TOUTIAO', '头条账号数据读取成功', {
      followersCount: account.followers_count,
      totalReads: account.total_reads,
      totalIncome: account.total_income,
      cached: account.cached,
    })
    res.json(account)
  } catch (error) {
    logger.error('TOUTIAO', '头条账号数据读取失败', { error: error.message })
    res.status(500).json({ error: error.message || '读取今日头条账号数据失败' })
  }
})

// ── GET /api/toutiao/install-logs ────────────────────────────────────────────
router.get('/install-logs', (req, res) => {
  try {
    const logDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'logs')
    const today = new Date().toISOString().split('T')[0]
    const logFile = path.join(logDir, `app-${today}.log`)
    if (!fs.existsSync(logFile)) return res.json({ lines: [] })
    const raw = fs.readFileSync(logFile, 'utf8')
    const lines = raw.split('\n').filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter(l => l && l.module === 'TOUTIAO').slice(-100)
      .map(l => `[${l.timestamp}] [${l.level}] ${l.message}`)
    res.json({ lines, status: chromiumStatus, message: chromiumStatusMsg })
  } catch (e) {
    res.json({ lines: [`读取日志失败: ${e.message}`], status: chromiumStatus, message: chromiumStatusMsg })
  }
})

// ── POST /api/toutiao/publish ────────────────────────────────────────────────
router.post('/publish', async (req, res) => {
  const cookies = parseCookies(req)
  if (!cookies) return res.status(401).json({ error: '未提供今日头条 Cookie，请先在设置中配置' })

  let { title } = req.body
  const { content, coverImageUrl } = req.body
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: '标题和内容不能为空' })

  title = title.trim()
  if (title.length < TITLE_MIN_LEN) return res.status(400).json({ error: `标题过短：至少 ${TITLE_MIN_LEN} 个字` })
  if (title.length > TITLE_MAX_LEN) {
    logger.warn('TOUTIAO', `标题超过 ${TITLE_MAX_LEN} 字，已自动截断`)
    title = title.slice(0, TITLE_MAX_LEN)
  }

  if (publishing) {
    return res.status(503).json({ error: '已有头条发布正在处理，请先核对上一单的结果' })
  }
  publishing = true

  let tmpCoverPath: string | null = null
  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let deadline: ReturnType<typeof setTimeout> | undefined
  let submissionStarted = false
  let timedOut = false

  try {
    logger.info('TOUTIAO', '开始自动推送文章', { title: title.slice(0, 20), hasCover: !!coverImageUrl })
    if (coverImageUrl) {
      try {
        const origin = `${req.protocol}://${req.get('host')}`
        tmpCoverPath = await prepareToutiaoCoverFile(coverImageUrl, origin)
      } catch (error) {
        logger.warn('TOUTIAO', '封面下载失败，将尝试无封面发布', { error: error instanceof Error ? error.message : String(error) })
      }
    }
    if (res.destroyed) return

    logger.info('TOUTIAO', '正在启动浏览器...')
    const launched = await launchBrowserWithContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
    browser = launched.browser
    context = launched.context

    // ── 注入 Cookie ────────────────────────────────────────────────────────
    const normalizedCookies = normalizeCookies(cookies)
    await context.addCookies(normalizedCookies)
    logger.info('TOUTIAO', `已注入 ${normalizedCookies.length} 个 Cookie`)

    const page = await context.newPage()

    page.setDefaultTimeout(5000)
    deadline = setTimeout(() => {
      timedOut = true
      void page.close().catch(() => {})
    }, PUBLISH_PAGE_TIMEOUT_MS)

    // ── 访问发布页 ─────────────────────────────────────────────────────────
    logger.info('TOUTIAO', '正在访问头条发布页...')
    await page.goto(TT_PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // 检查登录状态
    const currentUrl = page.url()
    if (currentUrl.includes('login') || currentUrl.includes('passport') || currentUrl.includes('sso')) {
      throw new Error('Cookie 已失效，请重新获取并配置')
    }
    logger.info('TOUTIAO', `发布页加载完成: ${currentUrl}`)

    // 关闭遮罩
    await dismissOverlays(page)

    // ── 等待编辑器加载 ─────────────────────────────────────────────────────
    logger.info('TOUTIAO', '等待编辑器加载...')
    const editorSel = await waitForEditor(page)

    // ── 填写标题 ───────────────────────────────────────────────────────────
    logger.info('TOUTIAO', '正在填写标题...')
    await fillTitle(page, title)

    // ── 注入正文内容 ───────────────────────────────────────────────────────
    logger.info('TOUTIAO', '正在注入正文内容...')
    await injectContent(page, content, editorSel)
    await dismissSaveFailDialog(page)

    // ── 上传封面图 ─────────────────────────────────────────────────────────
    const coverUploaded = tmpCoverPath ? await uploadCoverImage(page, tmpCoverPath) : false
    if (!coverUploaded) await selectNoCoverMode(page)

    await dismissSaveFailDialog(page)
    // 代理或客户端已经断开时，不发起新的发布。若已提交则继续核对回执。
    if (res.destroyed) return
    submissionStarted = true
    await submitToutiaoArticle(page)
    logger.info('TOUTIAO', '头条已确认接收发布请求')
    if (res.destroyed) return

    res.json({
      success: true,
      message: coverUploaded ? '头条已接收发布请求（含封面），请查看作品状态' : '头条已接收发布请求（无封面），请查看作品状态',
      url: 'https://mp.toutiao.com/profile_v4/graphic/articles',
    })

  } catch (error) {
    const message = timedOut
      ? (submissionStarted ? '等待头条发布结果超时，请到头条号后台核对后再重试' : '准备头条文章超时，尚未提交发布')
      : (error instanceof Error && error.message ? error.message : '自动推送失败，请到头条号后台核对')
    logger.error('TOUTIAO', '自动推送失败', { error: message })
    if (!res.destroyed) res.status(500).json({ error: message })
  } finally {
    clearTimeout(deadline)
    try {
      if (context) await context.close().catch(() => {})
      if (browser) await browser.close().catch(() => {})
      if (tmpCoverPath) await fs.promises.rm(tmpCoverPath, { force: true }).catch(() => {})
    } finally {
      publishing = false
    }
  }
})

/**
 * 等待编辑器加载，返回可用的选择器
 * 头条编辑器是 Syllepsis（syl）编辑器
 */
async function waitForEditor(page) {
  // 头条编辑器选择器（按优先级排序）
  const editorSelectors = [
    '.syl-editor',
    '[data-syl-editor]',
    '.ProseMirror',
    '.article-editor [contenteditable="true"]',
    '[contenteditable="true"]',
  ]
  for (const sel of editorSelectors) {
    try {
      await page.waitForSelector(sel, { timeout: 10000 })
      logger.info('TOUTIAO', `编辑器已加载: ${sel}`)
      return sel
    } catch { /* 继续 */ }
  }
  logger.warn('TOUTIAO', '编辑器加载超时，使用默认选择器')
  return '[contenteditable="true"]'
}

/**
 * 关闭遮罩/弹窗
 */
async function dismissOverlays(page) {
  const overlaySelectors = [
    'button:has-text("我知道了")',
    'button:has-text("知道了")',
    'button:has-text("关闭")',
    '.byte-modal-close',
    '.byte-dialog-close',
    '[class*="modal-close"]',
  ]
  for (const sel of overlaySelectors) {
    try {
      const el = page.locator(sel).first()
      if (await el.isVisible({ timeout: 800 })) {
        await el.click()
        await sleep(300, 500)
        logger.info('TOUTIAO', `关闭遮罩: ${sel}`)
      }
    } catch { /* 忽略 */ }
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
    logger.warn('TOUTIAO', '检测到「保存失败」弹窗')
    for (const sel of ['button:has-text("重试")', 'button:has-text("忽略")', 'button:has-text("确定")']) {
      const btn = page.locator(sel).first()
      if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
        await btn.click()
        await sleep(500, 800)
        return
      }
    }
    await page.keyboard.press('Escape')
  } catch { /* 忽略 */ }
}

async function selectNoCoverMode(page) {
  const selector = await chooseToutiaoNoCover(page)
  if (selector) {
    logger.info('TOUTIAO', `已选择无封面模式: ${selector}`)
    await sleep(500, 800)
    return
  }
  throw new Error('未找到今日头条的“无封面”选项，无法完成发布；请为文章选择封面后重试')
}

/** 填写 React 受控标题，并确认编辑器保留了标题。 */
async function fillTitle(page: Page, title: string) {
  const input = page.locator(
    'textarea[placeholder*="标题"], input[placeholder*="标题"], [class*="title"] textarea, [class*="title"] input',
  ).filter({ visible: true }).first()
  try {
    await input.fill(title, { timeout: 8000 })
    if (await input.inputValue() !== title) throw new Error('编辑器中的标题和预期不一致')
  } catch (error) {
    logger.warn('TOUTIAO', '头条标题填写失败', { error: error instanceof Error ? error.message : String(error) })
    throw new Error('头条标题填写失败，尚未提交发布')
  }
}

/**
 * 将 Markdown 内容注入到头条 Syllepsis 编辑器
 *
 * 头条编辑器是 Syllepsis（syl），不是 ProseMirror
 * 正确的注入方式：
 * 1. 点击编辑器聚焦
 * 2. 全选 + 删除现有内容
 * 3. 用 Clipboard API 粘贴 HTML（Syllepsis 支持 paste 事件处理富文本）
 * 4. 降级：逐字符键盘输入
 */
async function injectContent(page, markdownContent, editorSel) {
  // 预处理：移除图片（头条不接受外部图片 URL）
  const cleanedMarkdown = markdownContent
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\n{3,}/g, '\n\n')

  // Markdown → HTML
  const html = marked.parse(cleanedMarkdown, { breaks: true, gfm: true })

  // 找编辑器（排除标题区域）
  const candidates = editorSel ? [editorSel] : [
    '.syl-editor',
    '[data-syl-editor]',
    '.ProseMirror',
    '[contenteditable="true"]',
  ]

  let finalSel = null
  for (const sel of candidates) {
    try {
      const el = await page.$(sel)
      if (!el) continue
      const placeholder = await el.getAttribute('placeholder').catch(() => '')
      if (placeholder?.includes('标题') || placeholder?.includes('title')) continue
      finalSel = sel
      break
    } catch { /* 继续 */ }
  }

  if (!finalSel) {
    logger.warn('TOUTIAO', '未找到正文编辑器')
    return
  }

  logger.info('TOUTIAO', `使用编辑器: ${finalSel}`)

  // 点击聚焦
  await page.click(finalSel, { force: true })
  await sleep(300, 500)

  // ── 方案 1：Clipboard paste（Syllepsis 编辑器支持富文本粘贴）────────────
  logger.info('TOUTIAO', '尝试 Clipboard paste 注入...')
  await page.evaluate(
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

      // 构造 DataTransfer 并触发 paste 事件
      const dt = new DataTransfer()
      dt.setData('text/html', html)
      dt.setData('text/plain', editor.innerText || '')

      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      })
      editor.dispatchEvent(pasteEvent)

      return true
    },
    { html, selector: finalSel }
  )

  await sleep(1500, 2000)

  let contentLength = await page.evaluate((selector) => {
    const el = document.querySelector(selector)
    return el ? el.innerText.trim().length : 0
  }, finalSel)

  if (contentLength > 10) {
    logger.info('TOUTIAO', `Clipboard paste 注入成功，内容长度: ${contentLength}`)
    return
  }

  // ── 方案 2：execCommand insertHTML ────────────────────────────────────────
  logger.warn('TOUTIAO', 'Clipboard paste 失败，尝试 execCommand insertHTML...')
  await page.evaluate(
    ({ html, selector }) => {
      const editor = document.querySelector(selector)
      if (!editor) return
      editor.focus()
      document.execCommand('selectAll', false, null)
      document.execCommand('delete', false, null)
      document.execCommand('insertHTML', false, html)
    },
    { html, selector: finalSel }
  )
  await sleep(1000, 1500)

  contentLength = await page.evaluate((selector) => {
    const el = document.querySelector(selector)
    return el ? el.innerText.trim().length : 0
  }, finalSel)

  if (contentLength > 10) {
    logger.info('TOUTIAO', `execCommand 注入成功，内容长度: ${contentLength}`)
    return
  }

  // ── 方案 3：keyboard.type 逐字符输入（纯文本兜底）────────────────────────
  logger.warn('TOUTIAO', '降级为键盘逐字符输入...')
  await page.click(finalSel, { force: true })
  await sleep(200, 300)
  await page.keyboard.press('Meta+A')
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await sleep(200, 300)

  const chunks = cleanedMarkdown.match(/.{1,500}/gs) || [cleanedMarkdown]
  for (const chunk of chunks) {
    await page.keyboard.type(chunk, { delay: 5 })
    await sleep(100, 200)
  }

  contentLength = await page.evaluate((selector) => {
    const el = document.querySelector(selector)
    return el ? el.innerText.trim().length : 0
  }, finalSel)
  if (contentLength === 0) throw new Error('头条正文未写入，尚未提交发布')
  logger.info('TOUTIAO', `键盘输入完成，内容长度: ${contentLength}`)
}

/**
 * 从头条封面面板上传文件，等到图片出现在文章封面区域。
 */
async function uploadCoverImage(page: Page, coverFilePath: string) {
  try {
    const cover = page.locator('.article-cover')
    const single = cover.locator('label.byte-radio').filter({ hasText: /^单图$/ })
    if (!await single.locator('input[type="radio"]').isChecked()) await single.click({ timeout: 3000 })

    const add = cover.locator('.article-cover-add')
    await add.click({ timeout: 5000 })
    const drawer = page.locator('.byte-drawer.mp-ic-img-drawer').filter({ visible: true })
    const fileInput = drawer.locator('.upload-image-panel input[type="file"][accept*="image/*"]')
    await fileInput.setInputFiles(coverFilePath, { timeout: 5000 })

    const confirm = drawer.getByRole('button', { name: '确定', exact: true })
      .or(page.locator('.byte-modal').getByRole('button', { name: '确定', exact: true }))
      .filter({ visible: true }).first()
    const attached = cover.locator('.article-cover-images img').first()
    await confirm.or(attached).first().waitFor({ state: 'visible', timeout: 12000 })
    if (!await attached.isVisible()) await confirm.click({ timeout: 5000 })

    // 选中文件并不表示文章已使用它，封面占位消失且出现图片才算完成。
    await attached.waitFor({ state: 'visible', timeout: 5000 })
    logger.info('TOUTIAO', '封面上传完成')
    return true

  } catch (error) {
    logger.warn('TOUTIAO', '封面上传异常', { error: error instanceof Error ? error.message : String(error) })
    const cancel = page.locator('.mp-ic-img-drawer .byte-drawer-close, .byte-drawer-wrapper button:has-text("取消")').filter({ visible: true }).first()
    if (await cancel.isVisible().catch(() => false)) await cancel.click({ timeout: 3000 }).catch(() => {})
    await page.keyboard.press('Escape').catch(() => {})
    return false
  }
}

export default router
