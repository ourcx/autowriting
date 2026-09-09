import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const workflowEvents = []
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
        materials: '这是足够长的测试素材，用于验证文章工作台能够判断素材已经准备完成，并继续进入写作阶段。',
        article: '# 工作台验收文章\n\n我在正文里错误使用了第一人称。\n\n## 第一节\n\n这段正文提到了评论区，用来验证任务要求可以覆盖通用写作偏好。'.repeat(3),
        articleToutiao: '',
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

  await page.getByRole('button', { name: '预览并推送', exact: true }).click()
  await page.getByRole('heading', { name: '公众号预览与推送' }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/editor/workbench-test')
  assert.deepEqual(workflowEvents, ['wechat_draft_opened'])
  for (const label of ['任务', '素材', '写作', '审核', '发布']) {
    assert.equal(await page.locator('.flow-step').filter({ hasText: label }).count(), 1)
  }
  assert.deepEqual(pageErrors, [])
  console.log('文章五阶段、任务感知审核与原页发布工作台通过')
} finally {
  await browser.close()
}
