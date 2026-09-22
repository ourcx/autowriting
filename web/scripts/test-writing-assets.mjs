import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "playwright"

const baseUrl = process.env.WORKBENCH_URL || "http://127.0.0.1:5173"
const screenshots = await mkdtemp(join(tmpdir(), "writing-assets-"))
const browser = await chromium.launch({ headless: true })

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const pageErrors = []
  let savedProfile = null
  let savedMemory = ""

  page.on("pageerror", error => pageErrors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem("auth_token", "writing-assets-test-token")
  })
  await page.route("**/api/**", async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === "/api/auth/me") {
      return route.fulfill({ json: { user: { id: "fixture", username: "local", role: "admin" } } })
    }
    if (url.pathname === "/api/config/status") return route.fulfill({ json: { articleReady: true } })
    if (url.pathname === "/api/settings") return route.fulfill({ json: {} })
    if (url.pathname === "/api/settings/global_memory") {
      if (request.method() === "PUT") {
        savedMemory = request.postDataJSON().value
        return route.fulfill({ json: { key: "global_memory", value: savedMemory } })
      }
      return route.fulfill({ json: { key: "global_memory", value: savedMemory } })
    }
    if (url.pathname === "/api/creator-profile/assets") {
      return route.fulfill({ json: {
        summary: {
          dnaLayersCompleted: savedProfile ? 6 : 2,
          memoryCharacters: savedMemory.length,
          promptCount: 11,
          materialArticleCount: 3,
          candidateCount: 4,
          completedCandidateCount: 3,
          confirmedChoiceCount: 1,
          highPerformanceCount: 2,
          lowPerformanceCount: 2,
        },
        recentConfirmedChoices: [{
          articleId: "writing-assets-test",
          layer: "structure",
          note: "删掉空泛开场，直接进入问题。",
          retainedExpressions: [],
          retainedParagraphs: 2,
          changedParagraphs: 3,
          updatedAt: "2026-09-20T10:00:00.000Z",
        }],
      } })
    }
    if (url.pathname === "/api/creator-profile") {
      if (request.method() === "PUT") {
        savedProfile = request.postDataJSON()
        return route.fulfill({ json: savedProfile })
      }
      return route.fulfill({ json: {
        audience: "校园内容读者",
        stance: "",
        tone: "直接",
        languageStyle: "",
        bannedPhrases: [],
        preferredStructure: "",
        anglePreference: "",
        materialPreference: "",
        defaultPlatforms: ["wechat"],
        visualStyle: "",
      } })
    }
    return route.fulfill({ json: {} })
  })

  await page.goto(`${baseUrl}/account?tab=writing`)
  await page.getByRole("region", { name: "写作资产", exact: true }).waitFor()
  await page.getByText("六层写作 DNA", { exact: true }).waitFor()
  assert.equal(await page.getByText("2/6", { exact: true }).isVisible(), true)

  await page.getByText("主要读者", { exact: true }).locator("..").locator("input").fill("校园内容读者和年轻教师")
  await page.getByText("句式与节奏", { exact: true }).locator("..").locator("textarea").fill("短句为主，不使用破折号")
  await page.getByText("切入视角规则", { exact: true }).locator("..").locator("textarea").fill("从具体问题切入")
  await page.getByText("素材选择规则", { exact: true }).locator("..").locator("textarea").fill("优先一手经历和可核对数据")
  await page.getByText("观点与判断规则", { exact: true }).locator("..").locator("textarea").fill("区分事实、推测和观点")
  await page.getByText("图文与视觉规则", { exact: true }).locator("..").locator("textarea").fill("图片只承担解释或证据作用")
  await page.getByRole("textbox", { name: "长期背景记忆", exact: true }).fill("长期关注校园内容")
  await page.getByRole("button", { name: "保存写作资产", exact: true }).click()
  await page.getByText("写作 DNA 与长期背景已保存", { exact: true }).waitFor()

  assert.equal(savedProfile.audience, "校园内容读者和年轻教师")
  assert.equal(savedProfile.languageStyle, "短句为主，不使用破折号")
  assert.equal(savedMemory, "长期关注校园内容")
  await page.locator(".toast-success .toast-close").click()
  await page.locator(".toast-success").waitFor({ state: "detached" })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(screenshots, "writing-assets-desktop.png"), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(screenshots, "writing-assets-mobile.png"), fullPage: true })

  assert.deepEqual(pageErrors, [])
  console.log(`写作资产页面回归通过，截图：${screenshots}`)
} finally {
  await browser.close()
}
