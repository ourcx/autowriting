import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// 内存接口验证真实页面，不写入用户模板或调用收费模型。
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'style-editor-'))
const browser = await chromium.launch({ headless: true })
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
 const errors = []
 page.on('pageerror', e => errors.push(e.message))
 await page.addInitScript(() => localStorage.setItem('auth_token', 'style-test-token'))
 const templates = []
 let rejectSave = false, emptyResult = false
 const generated = '#wemd { color: #345678; background: #fff4ef; } #wemd h2 { color: #345678; }'
 await page.route('**/api/**', async route => {
  const url = new URL(route.request().url())
  if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: { id: 'fixture', username: 'local', role: 'admin' } } })
  if (url.pathname === '/api/templates') {
   assert.equal(route.request().headers().authorization, 'Bearer style-test-token')
   if (route.request().method() === 'POST') {
    if (rejectSave) return route.fulfill({ status: 500, json: { error: '模板保存测试失败' } })
    const item = route.request().postDataJSON()
    const index = templates.findIndex(t => t.id === item.id)
    if (index >= 0) templates[index] = item
    else templates.push(item)
    return route.fulfill({ json: item })
   }
   return route.fulfill({ json: templates })
  }
  if (url.pathname === '/api/generate-style') {
   assert.equal(route.request().headers().authorization, 'Bearer style-test-token')
   assert.equal(route.request().postDataJSON().aiConfig, undefined, '空配置不能覆盖服务端配置')
   return route.fulfill({ json: { css: emptyResult ? '' : generated } })
  }
  return route.fulfill({ json: {} })
 })
 await page.goto('http://127.0.0.1:5173/styles')
 await page.locator('#wemd h1').waitFor()
 for (const name of ['青苔手记', '奶油来信', '蓝调专栏', '玫瑰刊物']) {
  await page.locator('.se-tmpl-item').filter({ hasText: name }).click()
  const colors = { '青苔手记': 'rgb(56, 68, 59)', '奶油来信': 'rgb(85, 75, 64)', '蓝调专栏': 'rgb(57, 70, 82)', '玫瑰刊物': 'rgb(89, 71, 78)' }
  await page.waitForFunction(color => getComputedStyle(document.querySelector('#wemd')).color === color, colors[name])
  await page.screenshot({ path: path.join(output, `${name}.png`) })
  const size = await page.locator('#wemd').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }))
  assert.ok(size.scroll <= size.width + 1, name + '正文不能横向溢出')
 }
 await page.getByRole('button', { name: 'AI 生成样式' }).click()
 await page.locator('.se-ai-input').fill('蓝绿色，清爽阅读')
 await page.getByRole('button', { name: '生成 CSS', exact: true }).click()
 await page.getByRole('button', { name: '另存为我的模板', exact: true }).waitFor()
 assert.equal(await page.locator('#wemd').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 244, 239)')
 assert.equal(templates.length, 0)
 await page.getByRole('button', { name: '取消预览', exact: true }).click()
 assert.notEqual(await page.locator('#wemd').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 244, 239)')
 await page.getByRole('button', { name: '生成 CSS', exact: true }).click()
 await page.getByRole('button', { name: '另存为我的模板', exact: true }).click()
 await page.locator('.se-tmpl-item.active').filter({ hasText: '· AI' }).waitFor()
 assert.equal(templates[0].css, generated)
 await page.reload()
 await page.locator('.se-tmpl-item').filter({ hasText: '· AI' }).click()
 await page.waitForFunction(css => document.querySelector('.se-css-textarea')?.value === css, generated)
 assert.equal(await page.locator('.se-css-textarea').inputValue(), generated)
 rejectSave = true
 await page.locator('.se-css-textarea').fill(generated + '\n#wemd p { color: #123456; }')
 await page.getByRole('button', { name: '保存', exact: true }).click()
 await page.getByText('模板保存测试失败', { exact: true }).waitFor()
 assert.equal(templates[0].css, generated)
 assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isEnabled(), true)
 await page.getByRole('button', { name: 'AI 生成样式' }).click()
 await page.locator('.se-ai-input').fill('测试空结果')
 emptyResult = true
 await page.getByRole('button', { name: '生成 CSS', exact: true }).click()
 await page.getByText('AI 未返回有效样式，请换一种描述重试', { exact: true }).waitFor()
 assert.deepEqual(errors, [])
 console.log('样式模板、预览、取消、保存重载、失败保护通过', output)
} finally { await browser.close() }
