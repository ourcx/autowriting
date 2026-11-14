import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = process.env.WORKBENCH_URL || 'http://127.0.0.1:5174'
const screenshots = process.env.CANDIDATE_SCREENSHOTS || await mkdtemp(join(tmpdir(), 'candidate-ui-'))
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const errors = []
  const calls = []
  let active = 0
  let maxActive = 0
  let rows = []
  let article = '# 原有正文\n\n原文不应被候选稿替换。'
  let articleToutiao = ''
  let failSave = false
  let prematureEof = false
  let generatedInput
  let settingsWrites = 0
  let submittedResearch = false
  let collectedMaterials = ""
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('auth_token', 'candidate-ui-fixture'))
  await page.route('**/api/**', async route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture', username: 'fixture', role: 'admin' } } })
    if (pathname === '/api/config/status') return route.fulfill({ json: { articleReady: true, deepseekReady: false, wechatCollectorReady: { yuanbao: true, tikhub: true, dajiala: false } } })
    if (pathname === '/api/materials/yuanbao-search') {
      assert.equal(request.postDataJSON().query, "校方公告")
      return route.fulfill({ json: { answer: '元宝回答', articles: [
        { title: '只有摘要的公告', url: 'https://mp.weixin.qq.com/s/summary', snippet: '搜索摘要仅供参考', content: '', source: '校方' },
        { title: '只有原文链接的公告', url: 'https://mp.weixin.qq.com/s/link', snippet: '', content: '', source: '校方' },
      ] } })
    }
    if (pathname === '/api/materials/fixture/save') {
      collectedMaterials = request.postDataJSON().content
      return route.fulfill({ json: { success: true } })
    }
    assert.notEqual(pathname, '/api/deepseek/key', 'browser must never call the retired key storage endpoint')
    if (pathname === '/api/settings' && request.method() === 'POST') {
      settingsWrites++
      assert.doesNotMatch(request.postData(), /local-config-placeholder|deepseekApiKey/)
      assert.equal(request.headers()['x-deepseek-api-key'], undefined)
      return route.fulfill({ json: { success: true } })
    }
    if (pathname === '/api/deepseek/chat') {
      submittedResearch = true
      assert.equal(request.headers()['x-deepseek-api-key'], 'local-config-placeholder')
      assert.doesNotMatch(request.postData(), /local-config-placeholder/)
      return route.fulfill({ json: { content: '查到校方设计招标公告。', annotations: [] } })
    }
    if (pathname === '/api/materials/wechat-article') {
      const input = request.postDataJSON()
      assert.equal(input.provider, 'tikhub')
      assert.equal(input.url, 'https://mp.weixin.qq.com/s?__biz=Fixture%3D%3D&mid=2&idx=1&sn=fixture')
      return route.fulfill({ json: { title: '公众号原文解析结果', content: '这段是已提取的正文。', source: '校方' } })
    }
    if (pathname === '/api/articles/fixture/candidates') {
      if (request.method() === 'GET') return route.fulfill({ json: rows })
      const input = request.postDataJSON()
      generatedInput = input
      rows = input.platform === 'both'
        ? Array.from({ length: input.count }, (_, index) => ['wechat', 'toutiao'].map(platform => ({
          id: `pair-${index}-${platform}`, batchId: 'pair-batch', pairId: `pair-${index}`,
          label: `方案 ${index + 1} · ${platform === 'wechat' ? '公众号' : '头条'}`, platform,
          status: 'queued', content: '', message: '等待生成', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }))).flat()
        : Array.from({ length: input.count }, (_, index) => ({
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
      row.referenceArticleIds = ['20260901-campus', '20260820-career']
      row.researchSources = [{ title: '校方公告', url: 'https://example.com/notice', read: true }]
      const startedAt = new Date().toISOString()
      const step = {
        id: firstTry ? '1-1' : '2-1', attempt: firstTry ? 1 : 2, kind: 'search', title: '搜索公开网页',
        status: 'done', startedAt, finishedAt: startedAt, input: '校舍建设 官方公告', output: '返回 1 条结果',
        sources: row.researchSources,
      }
      const revision = row.status === 'complete' ? [
        { kind: 'write', title: '生成正文', status: 'done', output: '初稿已写完。' },
        { kind: 'review', title: '独立审稿', status: 'changes_requested', output: '删掉重复的开场句，直接写公告内容。' },
        { kind: 'edit', title: '优化文章表达', status: 'done', output: '收到改稿，等待复核。' },
        { kind: 'verify', title: '核对改稿', status: 'changes_requested', output: '改稿改动了原稿的发布日期。' },
        { kind: 'edit', title: '按复核意见返工', status: 'done', output: '已按原稿日期重改。' },
        { kind: 'verify', title: '核对改稿', status: 'done', output: '数字、引文和链接核对通过，已采用优化稿。' },
      ].map((stage, index) => ({ ...stage, id: `${step.attempt}-${index + 2}`, attempt: step.attempt,
        startedAt: new Date(Date.now() + (index + 1) * 500).toISOString(),
        finishedAt: new Date(Date.now() + (index + 2) * 500).toISOString(),
      })) : []
      row.trace = [...(row.trace || []), step, ...revision]
      row.message = row.status === 'complete' ? '生成完成' : '输出达到模型长度上限，可继续生成'
      active--
      // A final SSE event without a newline must still be consumed by the browser.
      return route.fulfill({ contentType: 'text/event-stream', body: `event: trace\ndata: ${JSON.stringify({ step })}\n\nevent: ${row.status === 'complete' ? 'done' : 'error'}\ndata: ${JSON.stringify({ candidate: row, message: row.message })}` })
    }
    if (pathname === '/api/articles/fixture') {
      if (request.method() === 'POST') {
        if (failSave) return route.fulfill({ status: 500, json: { error: 'fixture save failure' } })
        const body = request.postDataJSON()
        article = body.article
        articleToutiao = body.articleToutiao || ''
        return route.fulfill({ json: { success: true } })
      }
      return route.fulfill({ json: { title: '候选验收', task: '校园选题', materials: '本篇素材', article, articleToutiao, workflow: {} } })
    }
    if (pathname === '/api/rag/candidates' || pathname === '/api/rag/context') {
      throw new Error('文章生成应在服务端自动查找历史文章')
    }
    return route.fulfill({ json: {} })
  })
  await page.goto(`${base}/editor/fixture?tab=task`)
  assert.equal(await page.getByRole('button', { name: '下一步：填写素材', exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: '下一步：填写素材', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '下一步：进入写作', exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: '公众号采集', exact: true }).click()
  await page.getByPlaceholder('输入主题、机构或文章关键词').fill('校方公告')
  await page.getByRole('button', { name: '搜索公众号', exact: true }).click()
  const summaryOption = page.getByRole('checkbox', { name: /只有摘要的公告/ })
  await summaryOption.click()
  assert.equal(await summaryOption.getAttribute('aria-checked'), 'true')
  await page.getByRole('checkbox', { name: /只有原文链接的公告/ }).click()
  await page.getByRole('button', { name: '写入素材库（2）' }).click()
  assert.match(collectedMaterials, /元宝搜索摘要，原文未读/)
  assert.match(collectedMaterials, /仅保留原文链接，尚未读取正文/)
  await page.getByRole('button', { name: 'URL 解析', exact: true }).click()
  await page.getByRole('textbox', { name: '网页 URL' }).fill('http://mp.weixin.qq.com/s?__biz=Fixture%3D%3D&mid=2&idx=1&sn=fixture')
  await page.getByRole('combobox', { name: '链接读取服务' }).click()
  await page.getByRole('option', { name: 'TikHub 公众号解析（付费）' }).click()
  await page.getByRole('button', { name: '解析', exact: true }).click()
  await page.getByText('公众号原文解析结果', { exact: true }).waitFor()
  await page.getByRole('button', { name: '下一步：进入写作', exact: true }).click()
  assert.equal(await page.locator('.flow-step').count(), 5)
  await page.locator('.flow-step[aria-current="step"] .flow-step-label', { hasText: '写作' }).waitFor()
  assert.equal(await page.locator('.flow-step[aria-current="step"] .flow-step-label').innerText(), '写作')
  assert.equal(await page.getByRole('button', { name: '继续生成候选稿', exact: true }).isVisible(), true)
  assert.equal(await page.getByRole('button', { name: '下一步：审核定稿', exact: true }).isVisible(), true)
  await page.screenshot({ path: join(screenshots, 'editor-flow-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: '继续生成候选稿', exact: true }).click()
  await page.getByRole('dialog', { name: '生成候选稿' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '公众号 + 今日头条', exact: true }).isVisible(), true)
  await page.getByText(/先查历史文章和公开网页/).waitFor()
  assert.equal(await page.getByRole('button', { name: '检索往期文章' }).count(), 0)
  await page.getByRole('group', { name: '候选数量' }).getByRole('button', { name: '3', exact: true }).click()
  await page.getByRole('button', { name: '生成公众号母稿', exact: true }).click()
  await page.getByText('2 篇已完成', { exact: true }).waitFor()
  assert.equal(maxActive, 3)
  assert.equal(calls.length, 3)
  assert.equal(generatedInput.writingAgent, true)
  assert.deepEqual(generatedInput.referenceArticleIds, [])
  const tracePanel = page.getByRole('region', { name: '生成轨迹' })
  await tracePanel.waitFor()
  await tracePanel.getByRole('button', { name: '审稿', exact: true }).click()
  assert.equal(await tracePanel.getByText('删掉重复的开场句，直接写公告内容。').isVisible(), true)
  await tracePanel.getByRole('button', { name: '复核', exact: true }).click()
  await tracePanel.getByText('数字、引文和链接核对通过，已采用优化稿。', { exact: true }).waitFor()
  await page.screenshot({ path: join(screenshots, 'candidate-revision-desktop.png') })
  await tracePanel.getByRole('button', { name: /搜索公开网页 已完成/ }).click()
  assert.equal(await tracePanel.getByText('校舍建设 官方公告', { exact: true }).isVisible(), true)
  assert.equal(await tracePanel.getByRole('link', { name: '校方公告' }).getAttribute('href'), 'https://example.com/notice')
  await page.screenshot({ path: join(screenshots, 'candidate-trace-desktop.png') })
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await page.getByText('本次参考了 2 篇历史文章，读了 1 个网页', { exact: true }).click()
  await page.getByRole('link', { name: '校方公告' }).waitFor()
  assert.equal(article, '# 原有正文\n\n原文不应被候选稿替换。')
  await page.getByRole('button', { name: '对比全文', exact: true }).click()
  assert.equal(await page.locator('.gc-draft').count(), 3)
  assert.equal(await page.locator('.gc-paper h1').count(), 3, '正文和对比应渲染 Markdown 标题')
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
  assert.equal(await page.getByRole('group', { name: '生成平台' }).count(), 0)
  assert.equal(calls.length, 4, 'reopening must not regenerate completed candidates')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.getByRole('button', { name: '生成轨迹', exact: true }).click()
  await tracePanel.getByRole('button', { name: /搜索公开网页 已完成/ }).click()
  await tracePanel.getByText('校舍建设 官方公告', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(screenshots, 'candidates-mobile.png'), fullPage: true })
  prematureEof = true
  await page.getByRole('button', { name: '新建一批', exact: true }).click()
  await page.getByRole('button', { name: '生成公众号母稿', exact: true }).click()
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await page.getByText('生成连接中断，已收到的内容仍保留，请重新加载或继续生成', { exact: true }).waitFor()
  await page.getByText('这是断线前已收到的正文', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '选用此稿', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '关闭生成窗口' }).click()
  assert.equal(await page.getByRole('button', { name: '继续生成候选稿', exact: true }).isVisible(), true)
  assert.equal(await page.getByRole('button', { name: '下一步：审核定稿', exact: true }).isVisible(), true)
  await page.getByRole('button', { name: '继续生成候选稿', exact: true }).click()
  await page.getByRole('button', { name: '新建一批', exact: true }).click()
  await page.getByRole('button', { name: '公众号 + 今日头条', exact: true }).click()
  const pairedCallStart = calls.length
  maxActive = 0
  await page.getByRole('button', { name: '生成双平台版本', exact: true }).click()
  await page.getByText('2 篇已完成', { exact: true }).waitFor()
  assert.deepEqual(calls.slice(pairedCallStart), ['pair-0-wechat', 'pair-0-toutiao'])
  assert.equal(maxActive, 2, '公众号与头条候选稿应同时生成')
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await page.getByRole('button', { name: '选用这一组', exact: true }).first().click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.match(article, /方案 1 · 公众号标题/)
  assert.match(articleToutiao, /方案 1 · 头条标题/)
  if (await page.locator('.toast-success .toast-close').count()) {
    await page.locator('.toast-success .toast-close').first().click()
    await page.locator('.toast-success').waitFor({ state: 'detached' })
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(screenshots, 'editor-flow-mobile.png'), fullPage: true })
  await page.goto(`${base}/settings`)
  const settings = page.getByRole('navigation', { name: 'AI 配置分类' })
  await settings.getByRole('button', { name: '概览', exact: true }).waitFor()
  assert.equal(await page.locator('.as-service-row').count(), 3)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.getByRole('button', { name: '快速配置', exact: true }).click()
  await page.getByRole('heading', { name: '快速配置', exact: true }).waitFor()
  await settings.getByRole('button', { name: '联网', exact: true }).click()
  await page.getByRole('heading', { name: '联网与来源核查', exact: true }).waitFor()
  await page.getByText('元宝 AI 搜索', { exact: true }).waitFor()
  await page.getByText('服务端已启用，无需填写 Key', { exact: true }).waitFor()
  await settings.getByRole('button', { name: '更多', exact: true }).click()
  const deepseekKey = page.getByLabel('DeepSeek 公共 API Key')
  assert.equal(await deepseekKey.getAttribute('type'), 'password')
  await deepseekKey.fill('local-config-placeholder')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'DeepSeek Key 已保存' }).waitFor()
  assert.equal(await deepseekKey.inputValue(), 'local-config-placeholder')
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('local-config-placeholder')), true)
  assert.ok(settingsWrites > 0)
  await page.goto(`${base}/editor/fixture?tab=materials`)
  await page.getByRole('button', { name: 'DeepSeek 调研', exact: true }).click()
  const parsing = page.getByRole('combobox', { name: '附件解析方式' })
  await parsing.focus()
  await page.keyboard.press('Space')
  await page.getByRole('option', { name: '图文混排' }).click()
  assert.match(await parsing.innerText(), /图文混排/)
  const consent = page.getByRole('checkbox', { name: /同意将调研问题/ })
  await page.getByRole('textbox', { name: '调研问题', exact: true }).fill('核对设计招标公告')
  await consent.focus()
  await page.keyboard.press('Space')
  assert.equal(await consent.getAttribute('aria-checked'), 'true')
  const consentIcon = await consent.boundingBox()
  assert.ok(consentIcon && consentIcon.height === consentIcon.width, 'mobile touch styles must keep the checkbox indicator square')
  assert.equal(await page.getByRole('button', { name: '开始调研' }).isEnabled(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.getByRole('button', { name: '开始调研' }).click()
  await page.locator('.mc-item-title').filter({ hasText: '核对设计招标公告' }).waitFor()
  assert.equal(submittedResearch, true)
  await page.screenshot({ path: join(screenshots, 'research-mobile.png') })
  await page.goto(`${base}/settings`)
  await settings.getByRole('button', { name: '更多', exact: true }).click()
  const removeKey = page.getByRole('button', { name: '移除浏览器 Key', exact: true })
  await removeKey.click()
  await page.getByRole('status').filter({ hasText: '浏览器 Key 已移除' }).waitFor()
  await removeKey.waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('local-config-placeholder')), false)
  await page.getByRole('button', { name: '图片存储', exact: true }).click()
  await page.getByRole('heading', { name: '图床配置', exact: true }).waitFor()
  await page.setViewportSize({ width: 1440, height: 960 })
  await settings.getByRole('button', { name: '概览', exact: true }).click()
  await page.getByRole('button', { name: /^文章模型/ }).click()
  await page.getByRole('heading', { name: '文章生成', exact: true }).waitFor()
  assert.deepEqual(errors, [])
  console.log('Candidate concurrency, automatic research references, compare, recovery, apply failure, reopen and mobile passed.')
} finally { await browser.close(); if (!process.env.CANDIDATE_SCREENSHOTS) await rm(screenshots, { recursive: true, force: true }) }
