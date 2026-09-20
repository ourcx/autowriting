import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const browser = await chromium.launch({ headless: true })
const baseUrl = process.env.WORKBENCH_URL || 'http://localhost:5173'
const screenshots = await mkdtemp(join(tmpdir(), 'wechat-drafts-ui-'))

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const pageErrors = []
  let publishPayload = null
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'wechat-ui-token')
    localStorage.setItem('wechat_credentials', JSON.stringify({
      appId: 'wx-fixture',
      appSecret: 'secret-fixture',
    }))
    localStorage.setItem('wechat_analytics_cookies:fixture', JSON.stringify([
      { name: 'slave_sid', value: 'fixture', domain: '.mp.weixin.qq.com' },
    ]))
  })
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/auth/me') {
      return route.fulfill({ json: { user: { id: 'fixture', username: 'local', role: 'admin' } } })
    }
    if (url.pathname === '/api/wechat/drafts') {
      return route.fulfill({ json: {
        items: [{
          media_id: 'wechat-draft-fixture',
          update_time: 1789872000,
          title: '待发布微信草稿',
          digest: '待发布微信草稿',
          thumb_url: null,
          url: null,
          count: 1,
        }],
        total_count: 1,
        item_count: 1,
      } })
    }
    if (url.pathname === '/api/wechat/draft/wechat-draft-fixture/publish') {
      publishPayload = request.postDataJSON()
      return route.fulfill({ json: {
        success: true,
        status: 'published',
        title: '待发布微信草稿',
        evidence_count: 4,
      } })
    }
    return route.fulfill({ json: {} })
  })

  await page.goto(`${baseUrl}/drafts`)
  await page.getByText('待发布微信草稿', { exact: true }).first().waitFor()
  const refreshButton = page.getByTitle('刷新')
  const refreshBox = await refreshButton.boundingBox()
  await refreshButton.hover()
  await page.getByRole('tooltip').getByText('刷新', { exact: true }).waitFor()
  assert.equal(await page.getByRole('tooltip').isVisible(), true)
  const tooltipBox = await page.getByRole('tooltip').boundingBox()
  assert.ok(refreshBox && tooltipBox)
  assert.ok(Math.abs((refreshBox.x + refreshBox.width / 2) - (tooltipBox.x + tooltipBox.width / 2)) < 8)
  await page.screenshot({ path: join(screenshots, 'icon-tooltip-desktop.png'), fullPage: true })
  await page.mouse.move(700, 700)
  await page.getByRole('tooltip').waitFor({ state: 'hidden' })
  await refreshButton.focus()
  await page.getByRole('tooltip').getByText('刷新', { exact: true }).waitFor()
  await page.keyboard.press('Tab')
  await page.getByRole('tooltip').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '发布', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '待发布微信草稿' })
  await dialog.waitFor()
  await page.locator('.wd-publish-setting--ads input[type="checkbox"]').check()
  await page.getByRole('group', { name: '留言范围' }).getByRole('button', { name: '仅关注者' }).click()
  assert.equal(await page.getByText('群发通知', { exact: true }).isVisible(), true)
  assert.equal(await page.getByText('固定关闭，只发表到公众号主页，不占用群发次数', { exact: true }).isVisible(), true)
  await page.screenshot({ path: join(screenshots, 'publish-settings-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: '确认发表', exact: true }).click()
  await page.getByText('「待发布微信草稿」已确认发表', { exact: true }).waitFor()
  assert.equal(publishPayload.index, 0)
  assert.equal(publishPayload.options.enableAllAds, true)
  assert.equal(publishPayload.options.commentMode, 'fans')
  assert.equal(JSON.parse(publishPayload.cookies)[0].name, 'slave_sid')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '发布', exact: true }).click()
  await dialog.waitFor()
  const box = await dialog.boundingBox()
  assert.ok(box && box.x >= 0 && box.width <= 390)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(screenshots, 'publish-settings-mobile.png'), fullPage: true })
  assert.deepEqual(pageErrors, [])
  console.log(`微信草稿发布设置回归通过。截图：${screenshots}`)
} finally {
  await browser.close()
}
