import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const workflowEvents = []
  let savedProfile = null
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('auth_token', 'workbench-test-token'))
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/auth/me') {
      return route.fulfill({ json: { user: { id: 'fixture', username: 'local', role: 'admin' } } })
    }
    if (url.pathname === '/api/status') return route.fulfill({ json: { articleReady: true } })
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
    if (url.pathname === '/api/articles/workbench-test') {
      if (request.method() === 'POST') return route.fulfill({ json: { success: true } })
      return route.fulfill({ json: {
        title: '工作台验收文章',
        task: '目标字数：1200-1800 字。禁止第一人称，不要提到评论区，不要生成 emoji。',
        materials: '[学校通知](https://example.edu/notice) 显示，2026 年共有 120 人参加。这是足够长的测试素材。',
        article: '# 工作台验收文章\n\n我在正文里错误使用了第一人称。\n\n## 第一节\n\n这段正文提到了评论区，用来验证任务要求可以覆盖通用写作偏好。\n\n2026 年共有 120 人参加，预计 2027 年增长到 150 人。\n\n补充足够长的正文内容，确保文章处于待审核阶段并覆盖工作台主要功能。',
        articleToutiao: '# 头条版本\n\n2026 年共有 120 人参加。',
        xiaohongshuTitle: '',
        workflow: {
          createdAt: '2026-09-09T00:00:00.000Z',
          updatedAt: '2026-09-09T00:05:00.000Z',
          currentStage: 'review',
          firstGeneratedAt: '2026-09-09T00:05:00.000Z',
        },
      } })
    }
    return route.fulfill({ json: {} })
  })

  await page.goto('http://127.0.0.1:5173/editor/workbench-test')
  await page.locator('.flow-step').first().waitFor()
  await page.locator('.flow-step').filter({ hasText: '审核' }).click()
  await page.getByText('任务要求：禁止第一人称', { exact: false }).waitFor()
  await page.getByText('正文出现了「我」', { exact: false }).waitFor()
  await page.getByText('任务要求：不出现「评论区」', { exact: false }).waitFor()
  await page.getByText('任务要求：不使用 emoji', { exact: false }).waitFor()
  await page.getByText('需增加到 1200 字以上', { exact: false }).waitFor()
  await page.getByText('1 条待核对', { exact: true }).waitFor()
  await page.getByText('高表现文章', { exact: true }).waitFor()
  await page.getByText('已有平台改写', { exact: true }).waitFor()

  await page.getByRole('button', { name: '预览并推送', exact: true }).click()
  await page.getByRole('heading', { name: '公众号预览与推送' }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/editor/workbench-test')
  assert.deepEqual(workflowEvents, ['wechat_draft_opened'])
  for (const label of ['任务', '素材', '写作', '审核', '发布']) {
    assert.equal(await page.locator('.flow-step').filter({ hasText: label }).count(), 1)
  }

  await page.getByRole('button', { name: '写作档案', exact: true }).click()
  await page.getByLabel('账号写作档案').waitFor()
  await page.getByText('目标读者', { exact: true }).locator('..').locator('input').fill('校园内容读者')
  await page.getByRole('button', { name: '保存写作档案', exact: true }).click()
  await page.waitForFunction(() => document.body.textContent?.includes('账号写作档案'))
  assert.equal(savedProfile.audience, '校园内容读者')
  assert.deepEqual(pageErrors, [])
  console.log('文章工作台、创作反馈、来源边界与账号写作档案通过')
} finally {
  await browser.close()
}
