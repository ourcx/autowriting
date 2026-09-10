import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const browser = await chromium.launch({ headless: true })
const baseUrl = process.env.WORKBENCH_URL || 'http://127.0.0.1:5173'
const screenshots = await mkdtemp(join(tmpdir(), 'article-workbench-'))
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const workflowEvents = []
  let savedProfile = null
  let saveFails = false
  let listFails = false
  let savedArticle = null
  let emptyToutiao = false
  const unexpectedWrites = []
  const pageErrors = []
  const requestedModules = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', request => requestedModules.push(new URL(request.url()).pathname))
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'workbench-test-token')
    localStorage.setItem('onboarding-completed', 'true')
  })
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/auth/me') {
      return route.fulfill({ json: { user: { id: 'fixture', username: 'local', role: 'admin' } } })
    }
    if (url.pathname === '/api/config/status') return route.fulfill({ json: { articleReady: true } })
    if (url.pathname === '/api/articles') return listFails
      ? route.fulfill({ status: 500, json: { error: 'fixture list failure' } })
      : route.fulfill({ json: [
        { id: 'workbench-test', title: '工作台验收文章', date: '20260909', status: 'review' },
        { id: 'ready-test', title: '待发布文章', date: '20260910', status: 'ready' },
        { id: 'empty-test', title: '新文章', date: '20260910', status: 'brief' },
      ] })
    if (url.pathname === '/api/articles/workflow-metrics') return route.abort()
    if (url.pathname === '/api/toutiao/status') return route.fulfill({ json: { ready: true } })
    if (url.pathname === '/api/templates') return route.fulfill({ json: [] })
    if (url.pathname === '/api/creator-profile') {
      if (request.method() === 'PUT') {
        savedProfile = request.postDataJSON()
        return route.fulfill({ json: savedProfile })
      }
      return route.fulfill({ json: {
        audience: '', stance: '', tone: '', bannedPhrases: [], preferredStructure: '',
        defaultPlatforms: ['wechat'], visualStyle: '',
      } })
    }
    if (url.pathname === '/api/articles/production-insights') return route.fulfill({ json: {
      sampleSize: 2,
      topArticles: [{ articleId: 'top-1', title: '高表现文章', platform: 'wechat', composite: 88, views: 12000, characters: 1500, templateId: 'seasalt', promptIds: ['prompt-article-generate'], referenceArticleIds: ['older-1'] }],
      patterns: { bestPlatform: { platform: 'wechat', average: 82 }, averageTitleCharacters: 16, averageArticleCharacters: 1500 },
      generationUsesPerformanceExamples: true,
    } })
    if (url.pathname === '/api/articles/workbench-test/analyses') return route.fulfill({ json: [] })
    if (url.pathname === '/api/articles/workbench-test/workflow') {
      const event = request.postDataJSON().event
      workflowEvents.push(event)
      return route.fulfill({ json: {
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:10:00.000Z',
        currentStage: 'review',
        firstGeneratedAt: '2026-09-09T00:05:00.000Z',
        ...(event === 'wechat_draft_opened' ? { wechatDraftOpenedAt: '2026-09-09T00:10:00.000Z' } : {}),
      } })
    }
    if (['/api/articles/workbench-test', '/api/articles/ready-test', '/api/articles/empty-test'].includes(url.pathname)) {
      if (request.method() === 'POST') {
        if (saveFails) return route.fulfill({ status: 500, json: { error: 'fixture save failure' } })
        savedArticle = request.postDataJSON()
        return route.fulfill({ json: { success: true } })
      }
      const fixture = {
        title: '工作台验收文章',
        task: '目标字数：1200-1800 字。禁止第一人称，不要提到评论区，不要生成 emoji。',
        materials: '[学校通知](https://example.edu/notice) 显示，2026 年共有 120 人参加。这是足够长的测试素材。',
        article: '# 工作台验收文章\n\n我在正文里错误使用了第一人称。\n\n## 第一节\n\n这段正文提到了评论区，用来验证任务要求可以覆盖通用写作偏好。\n\n2026 年共有 120 人参加，预计 2027 年增长到 150 人。\n\n补充足够长的正文内容，确保文章处于待审核阶段并覆盖工作台主要功能。',
        articleToutiao: emptyToutiao ? '' : '# 头条版本\n\n2026 年共有 120 人参加。',
        xiaohongshuTitle: '小红书独立标题',
        workflow: {
          createdAt: '2026-09-09T00:00:00.000Z',
          updatedAt: '2026-09-09T00:05:00.000Z',
          currentStage: 'review',
          firstGeneratedAt: '2026-09-09T00:05:00.000Z',
        },
      }
      if (url.pathname.endsWith('ready-test')) fixture.workflow.lastReviewedAt = '2026-09-09T00:08:00.000Z'
      if (url.pathname.endsWith('empty-test')) {
        fixture.task = ''
        fixture.materials = ''
        fixture.article = ''
        fixture.articleToutiao = ''
        fixture.workflow = {}
      }
      return route.fulfill({ json: fixture })
    }
    if (request.method() !== 'GET') unexpectedWrites.push(url.pathname)
    return route.fulfill({ json: {} })
  })

  await page.goto(`${baseUrl}/`)
  await page.getByRole('heading', { name: '创作工作台' }).waitFor()
  await page.getByRole('button', { name: '继续编辑：工作台验收文章' }).waitFor()
  assert.equal(requestedModules.some(path => /\/pages\/ArticleEditor\/|\/assets\/ArticleEditor-/.test(path)), false, 'home must not eagerly load the editor')
  for (const label of ['微信草稿', '知识库', '提示词', '定时任务', '文章评分', '素材库', '样式', '画布', 'AI 配置']) {
    assert.equal(await page.getByRole('navigation', { name: '工作台导航' }).getByRole('button', { name: label, exact: true }).isVisible(), true, `${label} must remain directly visible`)
  }
  assert.equal(await page.locator('.dp-nav details').count(), 0)
  assert.equal(await page.evaluate(() => {
    const surfaces = ['.dp-root .page-header', '.dash-sidebar', '.dash-main'].map(selector => getComputedStyle(document.querySelector(selector)).backgroundColor)
    return new Set(surfaces).size === 1
  }), true, 'home surfaces must share one background')
  assert.equal(await page.locator('.dash-filters button').evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height <= 36)), true)
  assert.equal(await page.locator('.dp-nav-btn').evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height <= 36)), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.getByRole('button', { name: '继续处理', exact: true }).click()
  await page.getByRole('heading', { name: '公众号预览与推送' }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/editor/ready-test')
  await page.goto(`${baseUrl}/`)
  await page.getByRole('textbox', { name: '搜索文章' }).fill('无匹配')
  await page.getByText('没有匹配的文章', { exact: true }).waitFor()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await page.getByRole('button', { name: '待推送', exact: false }).click()
  assert.equal(await page.locator('.dash-article-item').count(), 1)
  await page.getByRole('button', { name: '全部', exact: false }).click()
  await page.screenshot({ path: join(screenshots, 'dashboard-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: '今日头条：工作台验收文章', exact: true }).click()
  await page.getByRole('heading', { name: '今日头条预览与发布' }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: '今日头条预览与发布' }).waitFor()

  await page.goto(`${baseUrl}/editor/workbench-test`)
  await page.locator('.flow-step').first().waitFor()
  assert.equal(await page.locator('.flow-step[aria-current="step"] .flow-step-label').innerText(), '审核')
  await page.locator('.flow-step').filter({ hasText: '审核' }).click()
  await page.getByText('任务要求：禁止第一人称', { exact: false }).waitFor()
  await page.getByText('正文出现了「我」', { exact: false }).waitFor()
  await page.getByText('任务要求：不出现「评论区」', { exact: false }).waitFor()
  await page.getByText('任务要求：不使用 emoji', { exact: false }).waitFor()
  await page.getByText('需增加到 1200 字以上', { exact: false }).waitFor()
  await page.getByText('1 条待核对', { exact: true }).waitFor()
  await page.getByText('高表现文章', { exact: true }).waitFor()
  await page.getByText('已有平台改写', { exact: true }).waitFor()

  saveFails = true
  await page.getByRole('button', { name: '预览并推送', exact: true }).click()
  await page.getByText('保存失败，请重试', { exact: true }).waitFor()
  assert.equal(await page.locator('.flow-step[aria-current="step"] .flow-step-label').innerText(), '审核')
  assert.deepEqual(workflowEvents, [])
  saveFails = false
  await page.getByRole('button', { name: '预览并推送', exact: true }).click()
  await page.getByRole('heading', { name: '公众号预览与推送' }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/editor/workbench-test')
  assert.deepEqual(workflowEvents, ['wechat_draft_opened'])
  assert.equal(savedArticle.title, '工作台验收文章')
  for (const label of ['任务', '素材', '写作', '审核', '发布']) {
    assert.equal(await page.locator('.flow-step').filter({ hasText: label }).count(), 1)
  }
  assert.equal(await page.locator('.publish-platform').evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height <= 36)), true)
  assert.equal(await page.locator('.flow-step').evaluateAll(buttons => buttons.every(button => button.getBoundingClientRect().height <= 36)), true)
  await page.locator('.toast-error .toast-close').first().click()
  await page.locator('.toast-error .toast-close').first().click()
  await page.locator('.toast-success').waitFor({ state: 'hidden' })
  await page.locator('.wr-article-card').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
  await page.screenshot({ path: join(screenshots, 'publish-desktop.png'), fullPage: true })
  await page.getByRole('group', { name: '发布平台' }).getByRole('button', { name: '小红书', exact: false }).click()
  await page.getByRole('heading', { name: '小红书预览与发布' }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/editor/workbench-test')
  assert.equal(new URL(page.url()).searchParams.get('platform'), 'xiaohongshu')
  assert.equal(await page.locator('input').evaluateAll(inputs => inputs.some(input => input.value === '小红书独立标题')), true)
  await page.getByRole('button', { name: '打开独立预览', exact: true }).click()
  await page.waitForURL('**/preview/workbench-test?platform=xiaohongshu')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('heading', { name: '小红书预览与发布' }).waitFor()
  emptyToutiao = true
  await page.goto(`${baseUrl}/editor/workbench-test?tab=publish&platform=toutiao`)
  await page.getByRole('heading', { name: '今日头条版本尚未生成' }).waitFor()
  assert.equal(await page.locator('.wr-root').count(), 0)
  emptyToutiao = false

  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`${baseUrl}/`)
    await page.getByRole('button', { name: '小红书：工作台验收文章', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.getByRole('group', { name: '设计', exact: true }).getByRole('button', { name: '样式', exact: true }).isVisible(), true)
    await page.screenshot({ path: join(screenshots, `dashboard-${width}.png`), fullPage: true })
    await page.getByRole('button', { name: '小红书：工作台验收文章', exact: true }).click()
    await page.getByRole('heading', { name: '小红书预览与发布' }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.evaluate(() => {
      const header = document.querySelector('.editor > .page-header')?.getBoundingClientRect()
      const flow = document.querySelector('.editor-flow-bar')?.getBoundingClientRect()
      return Boolean(header && flow && header.bottom <= flow.top)
    }), true, 'header must not overlap workflow')
    await page.screenshot({ path: join(screenshots, `publish-xhs-${width}.png`), fullPage: true })
    await page.getByRole('group', { name: '发布平台' }).getByRole('button', { name: '公众号', exact: false }).click()
    await page.getByRole('heading', { name: '公众号预览与推送' }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.locator('.wr-article-card').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
    await page.screenshot({ path: join(screenshots, `publish-wechat-${width}.png`), fullPage: true })
  }
  await page.goto(`${baseUrl}/editor/empty-test`)
  await page.locator('.flow-step').first().waitFor()
  assert.equal(await page.locator('.flow-step[aria-current="step"] .flow-step-label').innerText(), '任务')
  assert.equal(await page.locator('.flow-step').filter({ hasText: '发布' }).isDisabled(), true)
  listFails = true
  await page.goto(`${baseUrl}/`)
  await page.getByText('文章列表加载失败', { exact: true }).waitFor()
  listFails = false
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await page.getByRole('button', { name: '继续编辑：工作台验收文章' }).waitFor()
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(`${baseUrl}/editor/workbench-test`)
  await page.locator('.flow-step').first().waitFor()

  await page.getByRole('button', { name: '写作档案', exact: true }).click()
  await page.getByLabel('账号写作档案').waitFor()
  await page.getByText('目标读者', { exact: true }).locator('..').locator('input').fill('校园内容读者')
  await page.getByRole('button', { name: '保存写作档案', exact: true }).click()
  await page.waitForFunction(() => document.body.textContent?.includes('账号写作档案'))
  assert.equal(savedProfile.audience, '校园内容读者')
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(unexpectedWrites, [])
  console.log(`截图：${screenshots}`)
  console.log('文章工作台、创作反馈、来源边界与账号写作档案通过')
} finally {
  await browser.close()
}
