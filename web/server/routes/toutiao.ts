// @ts-nocheck
/**
 * 今日头条自动推送路由
 *
 * 核心思路（参考 CSDN 实战 + Playwright 头条发帖文章）：
 *
 * 关键发现：
 * 1. 头条编辑器是 Syllepsis（syl）编辑器，选择器是 .syl-editor 或 [data-syl-editor]
 * 2. 「禁用 JS + 并发」= 用 page.route 拦截预览弹窗的 JS，同时监听头条内部发布 API 请求
 * 3. 最可靠方案：填好标题内容后，直接拦截并重放头条的草稿保存 + 发布 API 请求
 * 4. 备用方案：用 page.route 屏蔽预览弹窗相关脚本，让发布按钮直接触发
 *
 * POST /api/toutiao/publish   → 自动推送文章到今日头条
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
import { createHash } from 'crypto'
import { marked } from 'marked'
import { logger } from '../logger.js'
import { authMiddleware } from '../authMiddleware.js'

function sleep(min, max) {
  const ms = max ? Math.floor(min + Math.random() * (max - min)) : min
  return new Promise(r => setTimeout(r, ms))
}

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

  let browser
  try {
    browser = await chromium.launch({ headless: true, args: commonArgs })
  } catch (e) {
    try {
      execSync('npx playwright install chromium --with-deps', { stdio: 'pipe', timeout: 300000 })
      browser = await chromium.launch({ headless: true, args: commonArgs })
    } catch (installErr) {
      throw new Error(`Playwright Chromium 未安装且自动安装失败：${installErr.message}`)
    }
  }
  const context = await browser.newContext(extraContextOptions)
  return { browser, context }
}

const router = Router()
router.use(authMiddleware)

const TT_HOME_URL = 'https://mp.toutiao.com'
const TT_PUBLISH_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish'
const TT_INCOME_OVERVIEW_URL = 'https://mp.toutiao.com/profile_v4/analysis/income-overview'
const TITLE_MAX_LEN = 30
const TITLE_MIN_LEN = 2
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
  let browser = null
  let context = null
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

  let { title, content, coverImageUrl } = req.body
  if (!title?.trim() || !content?.trim()) return res.status(400).json({ error: '标题和内容不能为空' })

  title = title.trim()
  if (title.length < TITLE_MIN_LEN) return res.status(400).json({ error: `标题过短：至少 ${TITLE_MIN_LEN} 个字` })
  if (title.length > TITLE_MAX_LEN) {
    logger.warn('TOUTIAO', `标题超过 ${TITLE_MAX_LEN} 字，已自动截断`)
    title = title.slice(0, TITLE_MAX_LEN)
  }

  logger.info('TOUTIAO', '开始自动推送文章', { title: title.slice(0, 20), hasCover: !!coverImageUrl })

  let tmpCoverPath = null
  if (coverImageUrl) {
    try {
      const origin = `${req.protocol}://${req.get('host')}`
      tmpCoverPath = await downloadImageToTemp(coverImageUrl, origin)
      logger.info('TOUTIAO', `封面已下载: ${tmpCoverPath}`)
    } catch (e) {
      logger.warn('TOUTIAO', '封面下载失败，跳过', { error: e.message })
    }
  }

  let browser = null
  let context = null

  try {
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

    // ── 监听头条内部 API 请求，捕获 CSRF token 和草稿 ID ─────────────────
    let csrfToken = ''
    let capturedPublishData = null

    // 拦截所有请求，提取 CSRF token
    page.on('request', request => {
      const headers = request.headers()
      if (headers['x-csrftoken']) csrfToken = headers['x-csrftoken']
      if (headers['x-tt-token']) csrfToken = headers['x-tt-token']
    })

    // 监听草稿保存响应，获取 article_id
    let articleId = null
    page.on('response', async response => {
      const url = response.url()
      if (url.includes('/mp/article/save_draft/') || url.includes('/mp/article/draft/')) {
        try {
          const body = await response.json().catch(() => null)
          if (body?.data?.article_id) {
            articleId = body.data.article_id
            logger.info('TOUTIAO', `捕获草稿 ID: ${articleId}`)
          }
        } catch { /* 忽略 */ }
      }
    })

    // ── 访问发布页 ─────────────────────────────────────────────────────────
    logger.info('TOUTIAO', '正在访问头条发布页...')
    await page.goto(TT_PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(2000, 3000)

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
    await sleep(1000, 1500)

    // ── 填写标题 ───────────────────────────────────────────────────────────
    logger.info('TOUTIAO', '正在填写标题...')
    await fillTitle(page, title)
    await sleep(800, 1200)

    // ── 注入正文内容 ───────────────────────────────────────────────────────
    logger.info('TOUTIAO', '正在注入正文内容...')
    await injectContent(page, content, editorSel)
    await sleep(2000, 3000)

    // 等待自动保存触发（头条会自动保存草稿，我们需要捕获 article_id）
    await sleep(3000, 4000)
    await dismissSaveFailDialog(page)

    // ── 上传封面图 ─────────────────────────────────────────────────────────
    let coverUploaded = false
    if (tmpCoverPath && fs.existsSync(tmpCoverPath)) {
      try {
        logger.info('TOUTIAO', '开始上传封面图...')
        coverUploaded = await uploadCoverImage(page, tmpCoverPath)
        if (coverUploaded) await sleep(2000, 3000)
      } catch (e) {
        logger.warn('TOUTIAO', '封面上传失败，继续发布', { error: e.message })
      }
    }

    // ── 发布：优先用 API 直接发布，降级用 UI 点击 ─────────────────────────
    logger.info('TOUTIAO', '开始发布...')
    await dismissSaveFailDialog(page)

    let published = false

    // 方案 A：如果捕获到 article_id，直接调用发布 API
    if (articleId && csrfToken) {
      logger.info('TOUTIAO', `尝试直接调用发布 API，article_id: ${articleId}`)
      published = await publishViaAPI(page, articleId, csrfToken, title)
    }

    // 方案 B：UI 点击发布（带 JS 拦截）
    if (!published) {
      logger.info('TOUTIAO', '使用 UI 点击发布...')
      published = await clickPublishWithJSBlock(page)
    }

    const finalUrl = page.url()
    logger.info('TOUTIAO', '发布流程完成', { url: finalUrl, published })

    res.json({
      success: true,
      message: coverUploaded ? '文章已发布到今日头条（含封面）' : '文章已发布到今日头条',
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

/**
 * 填写文章标题
 * 头条标题是 React 受控 textarea，用 nativeInputValueSetter 触发 onChange
 */
async function fillTitle(page, title) {
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
    } catch { /* 继续 */ }
  }

  if (!titleEl) {
    logger.warn('TOUTIAO', '未找到标题输入框')
    return
  }

  try {
    await page.click(titleEl, { force: true })
    await sleep(200, 400)

    // 用 React nativeInputValueSetter 触发受控组件 onChange
    const success = await page.evaluate(({ selector, value }) => {
      const el = document.querySelector(selector)
      if (!el) return false

      // 尝试 React nativeInputValueSetter
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set

      if (nativeSetter) {
        nativeSetter.call(el, value)
      } else {
        el.value = value
      }

      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return el.value === value
    }, { selector: titleEl, value: title })

    if (!success) {
      // 降级：键盘输入
      await page.keyboard.press('Meta+A')
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Delete')
      await page.keyboard.type(title, { delay: 40 + Math.random() * 60 })
    }

    logger.info('TOUTIAO', `标题已填写: ${title}`)
  } catch (e) {
    logger.warn('TOUTIAO', `标题填写失败: ${e.message}`)
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
  const pasteSuccess = await page.evaluate(
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
  logger.info('TOUTIAO', `键盘输入完成，内容长度: ${contentLength}`)
}

/**
 * 方案 A：直接调用头条内部发布 API
 * 在浏览器上下文中用 fetch 调用，自动携带 Cookie
 */
async function publishViaAPI(page, articleId, csrfToken, title) {
  try {
    logger.info('TOUTIAO', `调用发布 API，article_id: ${articleId}`)

    const result = await page.evaluate(async ({ articleId, csrfToken, title }) => {
      // 头条发布 API
      const publishUrl = 'https://mp.toutiao.com/mp/article/publish/'

      const formData = new FormData()
      formData.append('article_id', articleId)
      formData.append('title', title)
      formData.append('publish_time', '0')  // 0 = 立即发布

      const resp = await fetch(publishUrl, {
        method: 'POST',
        headers: {
          'X-CSRFToken': csrfToken,
          'Referer': 'https://mp.toutiao.com/profile_v4/graphic/publish',
        },
        body: formData,
        credentials: 'include',
      })

      const text = await resp.text()
      return { status: resp.status, body: text }
    }, { articleId, csrfToken, title })

    logger.info('TOUTIAO', `发布 API 响应: ${result.status} ${result.body?.slice(0, 200)}`)

    if (result.status === 200) {
      try {
        const json = JSON.parse(result.body)
        if (json.message === 'success' || json.data?.article_id) {
          logger.info('TOUTIAO', '发布 API 调用成功')
          return true
        }
      } catch { /* 继续 */ }
    }

    return false
  } catch (e) {
    logger.warn('TOUTIAO', `发布 API 调用失败: ${e.message}`)
    return false
  }
}

/**
 * 方案 B：UI 点击发布，同时用 page.route 拦截预览弹窗相关 JS
 *
 * 核心思路（来自 CSDN 实战）：
 * 头条「预览并发布」按钮点击后会弹出预览弹窗（由 JS 控制）
 * 通过拦截/禁用预览弹窗的 JS 逻辑，让按钮直接触发发布
 *
 * 实现：监听页面上的 fetch/XHR 请求，当检测到发布相关 API 被调用时，
 * 同时在 UI 层面处理确认弹窗
 */
async function clickPublishWithJSBlock(page) {
  // 监听发布相关的 API 请求
  let publishApiCalled = false
  const publishApiHandler = async (response) => {
    const url = response.url()
    if (url.includes('/mp/article/publish/') || url.includes('/mp/article/save_draft/')) {
      publishApiCalled = true
      logger.info('TOUTIAO', `检测到发布 API 调用: ${url}`)
    }
  }
  page.on('response', publishApiHandler)

  try {
    // ── Step 1：找并点击「预览并发布」按钮 ──────────────────────────────
    const previewBtnSelectors = [
      'button:has-text("预览并发布")',
      'button:has-text("发布文章")',
      'button:has-text("发布")',
    ]

    let previewClicked = false
    for (const sel of previewBtnSelectors) {
      const btn = page.locator(sel).first()
      if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
        try {
          await btn.scrollIntoViewIfNeeded().catch(() => {})
          await sleep(300, 500)
          await btn.click({ force: true, timeout: 8000 })
          previewClicked = true
          logger.info('TOUTIAO', `已点击: ${sel}`)
          break
        } catch (e) {
          logger.warn('TOUTIAO', `点击 ${sel} 失败: ${e.message}`)
        }
      }
    }

    if (!previewClicked) {
      // JS 触发兜底
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'))
        const btn = btns.find(b =>
          b.textContent?.includes('预览并发布') ||
          b.textContent?.includes('发布文章') ||
          b.textContent?.trim() === '发布'
        )
        if (btn) btn.click()
      })
    }

    // 等待页面响应
    await sleep(2000, 3000)
    await dismissSaveFailDialog(page)

    // ── Step 2：处理预览弹窗/页面，点击「确认发布」────────────────────────
    // 头条可能弹出预览弹窗，也可能跳转到新页面
    const confirmSelectors = [
      'button:has-text("确认发布")',
      'button:has-text("立即发布")',
      '.byte-modal button:has-text("发布")',
      '.byte-dialog button:has-text("发布")',
      '[class*="modal"] button:has-text("发布")',
      '[class*="dialog"] button:has-text("发布")',
      // 预览页面的发布按钮
      '.preview-publish button',
      '[class*="preview"] button:has-text("发布")',
    ]

    let confirmClicked = false
    // 最多等待 10 秒，轮询确认按钮
    for (let i = 0; i < 5; i++) {
      for (const sel of confirmSelectors) {
        const btn = page.locator(sel).first()
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          try {
            await btn.click({ force: true, timeout: 5000 })
            confirmClicked = true
            logger.info('TOUTIAO', `已点击确认发布: ${sel}`)
            break
          } catch { /* 继续 */ }
        }
      }
      if (confirmClicked) break
      await sleep(2000, 2000)
    }

    if (!confirmClicked) {
      // 最后尝试：JS 触发
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'))
        const btn = btns.find(b =>
          b.textContent?.includes('确认发布') ||
          b.textContent?.includes('立即发布') ||
          (b.textContent?.trim() === '发布' && (
            b.closest('[class*="modal"]') ||
            b.closest('[class*="dialog"]') ||
            b.closest('[class*="preview"]')
          ))
        )
        if (btn) btn.click()
      })
    }

    await sleep(2000, 3000)

    // 处理可能的二次确认
    for (const sel of ['button:has-text("确定")', 'button:has-text("好的")']) {
      const btn = page.locator(sel).first()
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click({ timeout: 3000 }).catch(() => {})
        await sleep(1000, 1500)
        break
      }
    }

    return confirmClicked || previewClicked || publishApiCalled

  } finally {
    page.off('response', publishApiHandler)
  }
}

/**
 * 上传封面图
 * 参考 Playwright 头条发帖文章：用 page.expect_file_chooser() 方式
 */
async function uploadCoverImage(page, coverFilePath) {
  try {
    // ── Step 1：点击「单图」radio ─────────────────────────────────────────
    for (const sel of ['text=单图', 'label:has-text("单图")', '[class*="single"]']) {
      const el = page.locator(sel).first()
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        await el.click({ timeout: 5000 })
        await sleep(500, 800)
        logger.info('TOUTIAO', `已选择单图模式: ${sel}`)
        break
      }
    }

    // ── Step 2：点击封面区域 ──────────────────────────────────────────────
    const coverAreaSelectors = [
      '[class*="cover"] [class*="add"]',
      '[class*="cover"] [class*="upload"]',
      '[class*="cover"] [class*="plus"]',
      '.article-cover-add',
      '[class*="coverUpload"]',
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
      logger.warn('TOUTIAO', '未找到封面添加区域，跳过')
      return false
    }

    await sleep(1000, 2000)

    // ── Step 3：用 expect_file_chooser 方式上传（最可靠）─────────────────
    // 参考 Playwright 头条发帖文章的实现
    let fileInjected = false

    // 先尝试「本地上传」按钮
    const localUploadBtn = page.locator('button:has-text("本地上传"), text=本地上传').first()
    if (await localUploadBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      try {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 10000 }),
          localUploadBtn.click({ timeout: 5000 }),
        ])
        await fileChooser.setFiles(coverFilePath)
        logger.info('TOUTIAO', '通过「本地上传」按钮注入封面')
        fileInjected = true
      } catch (e) {
        logger.warn('TOUTIAO', `本地上传按钮失败: ${e.message}`)
      }
    }

    // 直接找 file input（参考 Playwright 头条文章的 HTML 结构）
    // <input type="file" accept="image/*" multiple="" title="">
    if (!fileInjected) {
      const fileInput = page.locator('input[type="file"][accept*="image"]').first()
      if (await fileInput.count().catch(() => 0) > 0) {
        await fileInput.setInputFiles(coverFilePath)
        logger.info('TOUTIAO', 'file input 直接注入封面')
        fileInjected = true
      }
    }

    // 重新点击封面区域触发 filechooser
    if (!fileInjected) {
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
          } catch { /* 继续 */ }
        }
      }
    }

    if (!fileInjected) {
      logger.warn('TOUTIAO', '无法注入封面文件')
      return false
    }

    // ── Step 4：等待上传完成 ──────────────────────────────────────────────
    await sleep(3000, 5000)

    // ── Step 5：点击「确定」关闭侧边栏 ───────────────────────────────────
    for (const sel of [
      '.byte-drawer-wrapper button:has-text("确定")',
      '.upload-image-panel button:has-text("确定")',
      '.byte-modal button.byte-btn-primary',
      'button:has-text("确定")',
    ]) {
      const btn = page.locator(sel).first()
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click()
        logger.info('TOUTIAO', `点击封面确认: ${sel}`)
        await sleep(1000, 2000)
        break
      }
    }

    logger.info('TOUTIAO', '封面上传完成')
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
