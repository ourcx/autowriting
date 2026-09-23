import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.env.WORKBENCH_URL || 'http://127.0.0.1:5174'
const screenshots = await mkdtemp(join(tmpdir(), 'candidate-ui-'))
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const errors = []
  const calls = []
  let active = 0
  let maxActive = 0
  let rows = []
  let article = '# 原有正文\n\n原文不应被候选稿替换。'
  let failSave = false
  let prematureEof = false
  let referenceCalls = 0
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('auth_token', 'candidate-ui-fixture'))
  await page.route('**/api/**', async route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture', username: 'fixture', role: 'admin' } } })
    if (pathname === '/api/config/status') return route.fulfill({ json: { articleReady: true } })
    if (pathname === '/api/articles/fixture/candidates') {
      if (request.method() === 'GET') return route.fulfill({ json: rows })
      const input = request.postDataJSON()
      rows = Array.from({ length: input.count }, (_, index) => ({
        id: `candidate-${index}`, batchId: 'batch', label: `候选 ${index + 1}`, platform: input.platform,
        status: 'queued', content: '', message: '排队中', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }))
      return route.fulfill({ json: rows })
    }
    if (pathname.endsWith('/stream')) {
      const id = pathname.split('/').at(-2)
      calls.push(id)
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 150))
      const row = rows.find(candidate => candidate.id === id)
      const firstTry = calls.filter(call => call === id).length === 1
      if (prematureEof) {
        prematureEof = false
        active--
        return route.fulfill({ contentType: 'text/event-stream', body: `event: chunk\ndata: ${JSON.stringify({ text: '这是断线前已收到的正文' })}\n\n` })
      }
      row.content = `# ${row.label}标题\n\n${'这是候选正文。'.repeat(90)}`
      row.status = id === 'candidate-1' && firstTry ? 'interrupted' : 'complete'
      row.message = row.status === 'complete' ? '生成完成' : '输出达到模型长度上限，可继续生成'
      active--
      // A final SSE event without a newline must still be consumed by the browser.
      return route.fulfill({ contentType: 'text/event-stream', body: `event: ${row.status === 'complete' ? 'done' : 'error'}\ndata: ${JSON.stringify({ candidate: row, message: row.message })}` })
    }
    if (pathname === '/api/articles/fixture') {
      if (request.method() === 'POST') {
        if (failSave) return route.fulfill({ status: 500, json: { error: 'fixture save failure' } })
        article = request.postDataJSON().article
        return route.fulfill({ json: { success: true } })
      }
      return route.fulfill({ json: { title: '候选验收', task: '校园选题', materials: '本篇素材', article, articleToutiao: '', workflow: {} } })
    }
    if (pathname === '/api/rag/candidates') {
      referenceCalls++
      return route.fulfill({ json: { candidates: [
        { dir: '20260901-campus', title: '广州高校就业数据为什么突然受关注', snippet: '梳理近三年高校就业数据、行业变化和毕业生选择。', sim: 92, types: ['article'] },
        { dir: '20260820-career', title: '大学生求职真正卡住的环节', snippet: '从简历、实习和岗位匹配三个方面分析求职难点。', sim: 78, types: ['article'] },
        { dir: '20260718-data', title: '如何看懂一份就业质量报告', snippet: '解释就业率、升学率与统计口径之间的区别。', sim: 55, types: ['article'] },
      ] } })
    }
    return route.fulfill({ json: {} })
  })
  await page.goto(`${base}/editor/fixture?tab=task`)
  assert.equal(await page.getByRole('button', { name: '下一步：填写素材', exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: '下一步：填写素材', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '下一步：进入写作', exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: '下一步：进入写作', exact: true }).click()
  assert.equal(await page.locator('.flow-step').count(), 5)
  assert.equal(await page.locator('.flow-step[aria-current="step"] .flow-step-label').innerText(), '写作')
  assert.equal(await page.getByRole('button', { name: '继续生成候选稿', exact: true }).isVisible(), true)
  assert.equal(await page.getByRole('button', { name: '下一步：审核定稿', exact: true }).isVisible(), true)
  await page.screenshot({ path: join(screenshots, 'editor-flow-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: '继续生成候选稿', exact: true }).click()
  await page.getByRole('dialog', { name: '生成候选稿' }).waitFor()
  await page.getByText('更多设置', { exact: true }).click()
  const referenceSearch = page.getByRole('button', { name: '检索往期文章', exact: true })
  await referenceSearch.click()
  await page.getByText('3 篇相关', { exact: true }).waitFor()
  assert.equal(referenceCalls, 1)
  assert.equal(await page.locator('.gc-reference-card').count(), 3)
  assert.equal(await page.locator('.gc-reference-card[aria-pressed="true"]').count(), 2)
  assert.equal(await page.locator('.gc-references input[type="checkbox"]').count(), 0)
  const searchBox = await page.getByRole('button', { name: '重新检索', exact: true }).boundingBox()
  assert.ok(searchBox.height <= 34 && searchBox.width < 150)
  await page.screenshot({ path: join(screenshots, 'references-desktop.png'), fullPage: true })
  await page.getByRole('group', { name: '候选数量' }).getByRole('button', { name: '3', exact: true }).click()
  await page.getByRole('button', { name: '生成公众号母稿', exact: true }).click()
  await page.getByText('2 篇已完成', { exact: true }).waitFor()
  assert.equal(maxActive, 3)
  assert.equal(calls.length, 3)
  assert.equal(article, '# 原有正文\n\n原文不应被候选稿替换。')
  await page.getByRole('button', { name: '对比全文', exact: true }).click()
  assert.equal(await page.locator('.gc-draft').count(), 3)
  await page.screenshot({ path: join(screenshots, 'compare-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: '继续生成', exact: true }).click()
  await page.getByText('3 篇已完成', { exact: true }).waitFor()
  assert.deepEqual(calls, ['candidate-0', 'candidate-1', 'candidate-2', 'candidate-1'])
  failSave = true
  await page.getByRole('button', { name: '选用此稿', exact: true }).first().click()
  await page.getByRole('alert').filter({ hasText: 'fixture save failure' }).waitFor()
  assert.equal(await page.getByRole('dialog').count(), 1)
  assert.equal(article, '# 原有正文\n\n原文不应被候选稿替换。')
  failSave = false
  await page.getByRole('button', { name: '选用此稿', exact: true }).first().click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(article, rows[0].content)
  await page.getByRole('button', { name: '继续生成候选稿', exact: true }).click()
  await page.getByText('3 篇已完成', { exact: true }).waitFor()
  assert.equal(calls.length, 4, 'reopening must not regenerate completed candidates')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByText('更多设置', { exact: true }).click()
  await page.getByRole('button', { name: '检索往期文章', exact: true }).click()
  await page.getByText('3 篇相关', { exact: true }).waitFor()
  assert.equal(await page.locator('.gc-reference-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(screenshots, 'references-mobile.png'), fullPage: true })
  await page.getByText('更多设置', { exact: true }).click()
  await page.screenshot({ path: join(screenshots, 'candidates-mobile.png'), fullPage: true })
  prematureEof = true
  await page.getByRole('button', { name: '生成公众号母稿', exact: true }).click()
  await page.getByText('生成连接中断，已收到的内容仍保留，请重新加载或继续生成', { exact: true }).waitFor()
  await page.getByText('这是断线前已收到的正文', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '选用此稿', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '关闭生成窗口' }).click()
  assert.equal(await page.getByRole('button', { name: '继续生成候选稿', exact: true }).isVisible(), true)
  assert.equal(await page.getByRole('button', { name: '下一步：审核定稿', exact: true }).isVisible(), true)
  if (await page.locator('.toast-success .toast-close').count()) {
    await page.locator('.toast-success .toast-close').first().click()
    await page.locator('.toast-success').waitFor({ state: 'detached' })
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(screenshots, 'editor-flow-mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log(`Candidate concurrency, compare, recovery, apply failure, reopen and mobile passed. Screenshots: ${screenshots}`)
} finally { await browser.close() }
