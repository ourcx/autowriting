import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { Page } from "playwright"
import { WRITING_TERMINAL_IMAGE } from "./config.ts"
import { fetchPublicUrl } from "./utils/networkPolicy.ts"
import { publicSourceUrl } from "./writingResearch.ts"
import { usablePageText } from "./utils/search/webFetcher.ts"
import { extractXiaohongshuArticle, isXiaohongshuArticle } from "./utils/search/xiaohongshuArticleContent.ts"
import { assessPageText, extractReadablePage } from "./utils/search/pageContent.ts"
import { PublicPageBrowserError, PublicPageBrowserSession } from "./utils/publicPageBrowser.ts"

export interface WritingPageImage {
  id: string
  url: string
  alt: string
  sourceUrl: string
  pageTitle: string
  width?: number
  height?: number
  screenshot?: Buffer
}

export interface WritingPageSnapshot {
  url: string
  title: string
  text: string
  links: Array<{ id: string; text: string; url?: string }>
  images: WritingPageImage[]
  selector?: string
}

export class WritingToolError extends Error {}

export interface WritingVerificationChallenge {
  screenshot: string
  instructions: string
  attempt: number
}

const verificationActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("click"), points: z.array(z.object({ x: z.number().min(0).max(1279), y: z.number().min(0).max(899) })).min(1).max(9) }),
  z.object({ action: z.literal("fill"), id: z.string().regex(/^C\d+-\d+$/), text: z.string().min(1).max(80) }),
  z.object({ action: z.literal("drag"), from: z.object({ x: z.number().min(0).max(1279), y: z.number().min(0).max(899) }),
    to: z.object({ x: z.number().min(0).max(1279), y: z.number().min(0).max(899) }) }),
  z.object({ action: z.literal("wait") }),
  z.object({ action: z.literal("stop") }),
])

const VERIFICATION_MARKER = /captcha|verify you are human|verifying you are human|human verification|checking your browser|安全验证|人机验证|验证码|拖动滑块|完成拼图|请选择.*(?:图片|图中)|访问过于频繁/i

export function isWritingVerificationText(text: string): boolean {
  return text.length < 1800 && VERIFICATION_MARKER.test(text)
}

let activeTerminals = 0

export async function readPublicBytes(response: Response, limit: number, allowErrorPage = false): Promise<Buffer> {
  if ((!response.ok && !allowErrorPage) || !response.body) {
    await response.body?.cancel()
    throw new WritingToolError("公开资源暂时无法读取")
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) throw new WritingToolError("公开资源超过读取大小限制")
      chunks.push(value)
    }
    return Buffer.concat(chunks, bytes)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function decodeAttribute(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
}

/** 浏览器被关闭或未安装时，仍可从公开 HTML 中取得实际存在的图片地址。 */
export function imagesInHtml(html: string, sourceUrl: string, pageTitle: string): Omit<WritingPageImage, "id">[] {
  const images: Omit<WritingPageImage, "id">[] = []
  for (const tag of html.match(/<(?:img|meta)\b[^>]*>/gi) || []) {
    const attributes = new Map<string, string>()
    for (const match of tag.matchAll(/([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      attributes.set(match[1].toLowerCase(), decodeAttribute(match[2] ?? match[3] ?? match[4] ?? ""))
    }
    const meta = /^<meta/i.test(tag)
    if (meta && !/^(?:og:image|twitter:image)$/.test(attributes.get("property") || attributes.get("name") || "")) continue
    const raw = meta ? attributes.get("content") : attributes.get("data-original") || attributes.get("data-src")
      || (attributes.get("data-srcset") || attributes.get("srcset"))?.split(",").pop()?.trim().split(/\s/)[0] || attributes.get("src")
    if (!raw || /^(?:data|blob|javascript):/i.test(raw)) continue
    let url = ""
    try { url = publicSourceUrl(new URL(raw, sourceUrl).href) } catch { continue }
    if (!url || images.some(image => image.url === url)) continue
    const width = Number(attributes.get("width")) || undefined
    const height = Number(attributes.get("height")) || undefined
    if ((width && width < 240) || (height && height < 120)) continue
    images.push({ url, sourceUrl, pageTitle, alt: (attributes.get("alt") || attributes.get("title") || "").slice(0, 220), width, height })
    if (images.length >= 30) break
  }
  return images
}

/** 每篇候选稿独占匿名浏览器和临时终端；取消请求时一起回收。 */
export class WritingToolSession {
  readonly images: WritingPageImage[] = []
  private browser?: PublicPageBrowserSession
  private page?: Page
  private container?: string
  private terminalReserved = false
  private disposed = false
  private disposing?: Promise<void>
  private savedFiles = new Map<string, string>()
  private exportedFiles = new Set<string>()
  private clickIds = new Set<string>()
  private screenshotCount = 0
  private verificationActive = false
  private verificationAttempts = 0
  private readonly abort = () => { void this.dispose() }

  constructor(readonly browserEnabled: boolean, readonly terminalEnabled: boolean, private signal: AbortSignal,
    private verification?: {
      solve: (_challenge: WritingVerificationChallenge) => Promise<string>
      report: (_status: "running" | "done" | "failed", _message: string) => void
    }) {
    signal.addEventListener("abort", this.abort, { once: true })
  }

  private available() {
    this.signal.throwIfAborted()
    if (this.disposed) throw new WritingToolError("本次工具会话已结束")
  }

  addImages(rows: Omit<WritingPageImage, "id">[]): WritingPageImage[] {
    return rows.flatMap(row => {
      const existing = this.images.find(image => image.url === row.url)
      if (existing) return [existing]
      if (this.images.length >= 120) return []
      const image = { ...row, id: `I${this.images.length + 1}` }
      this.images.push(image)
      return [image]
    })
  }

  async collectImages(url: string, title: string): Promise<WritingPageImage[]> {
    this.available()
    const source = publicSourceUrl(url)
    if (!source) throw new WritingToolError("图片来源链接不适合公开读取")
    const response = await fetchPublicUrl(source, {
      signal: AbortSignal.any([this.signal, AbortSignal.timeout(15_000)]),
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0", "Accept-Language": "zh-CN,zh;q=0.9" },
    })
    if (!/text\/html|application\/xhtml/i.test(response.headers.get("content-type") || "")) {
      await response.body?.cancel()
      return []
    }
    const html = (await readPublicBytes(response, 6 * 1024 * 1024)).toString("utf8")
    this.savedFiles.set(`page-${this.savedFiles.size + 1}.html`, html)
    return this.addImages(imagesInHtml(html, publicSourceUrl(response.url) || source, title))
  }

  async open(url: string): Promise<WritingPageSnapshot> {
    this.available()
    if (!this.browserEnabled) throw new WritingToolError("本次未开启浏览器工具")
    const target = publicSourceUrl(url)
    if (!target) throw new WritingToolError("浏览器只接受无凭据的公开网页链接")
    if (!this.browser) {
      this.browser = new PublicPageBrowserSession(this.signal, {
        verificationActive: () => this.verificationActive,
      })
    }
    try { this.page = await this.browser.open(target) }
    catch (error) {
      this.available()
      if (error instanceof PublicPageBrowserError && error.code === "busy") {
        throw new WritingToolError("浏览器正在处理其他文章，请使用网页读取工具")
      }
      if (error instanceof PublicPageBrowserError && error.code === "launch") {
        await this.browser.dispose().catch(() => {})
        this.browser = undefined
        throw new WritingToolError("浏览器未能启动，请安装 Playwright Chromium")
      }
      throw new WritingToolError("浏览器未能打开这个公开网页")
    }
    const page = this.page
    // 公众号只等待文章正文，不能把“环境异常”等提示当成已加载正文。
    await page.waitForFunction(() => {
      const root = location.hostname === "mp.weixin.qq.com" ? document.querySelector("#js_content")
        : document.querySelector("#vsb_content,.v_news_content,[itemprop=articleBody],#text_content,#wza_content,.article-content,.article_content,.post-content,.entry-content,.news-content,.detail-content,.content-detail,.dy-article,article,main,[role=main]")
      return Boolean(root && ((root.textContent?.replace(/\s/g, "").length || 0) >= 80 || root.querySelector("img")))
    }, undefined, { timeout: 8000 }).catch(() => {})
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {})
    await this.handleVerification()
    return this.snapshot()
  }

  async click(id: string): Promise<WritingPageSnapshot> {
    this.available()
    if (!this.page || !this.clickIds.has(id)) throw new WritingToolError("请使用最近一次页面返回的 E 编号")
    const element = this.page.locator(`[data-writing-tool-id="${id}"]`)
    const href = await element.getAttribute("href")
    if (href && !href.startsWith("#")) return this.open(new URL(href, this.page.url()).href)
    await element.click({ timeout: 5000 })
    await this.handleVerification()
    return this.snapshot()
  }

  async scroll(direction: "down" | "up"): Promise<WritingPageSnapshot> {
    this.available()
    if (!this.page) throw new WritingToolError("请先打开网页")
    await this.page.evaluate(value => window.scrollBy(0, value === "down" ? 800 : -800), direction)
    await this.handleVerification()
    return this.snapshot()
  }

  async snapshot(): Promise<WritingPageSnapshot> {
    this.available()
    if (!this.page) throw new WritingToolError("请先打开网页")
    const url = publicSourceUrl(this.page.url()) || this.browser?.sourceUrl
    if (!url) throw new WritingToolError("当前页面不是可读取的公开网页")
    const data = await this.page.evaluate(() => {
      const root = location.hostname === "mp.weixin.qq.com" ? document.querySelector<HTMLElement>("#js_content")
        : document.querySelector<HTMLElement>("#vsb_content,.v_news_content,[itemprop=articleBody],#text_content,#wza_content,.article-content,.article_content,.post-content,.entry-content,.news-content,.detail-content,.content-detail,.dy-article,article,main,[role=main]")
      const links = [...document.querySelectorAll<HTMLElement>("a[href],button:not([type=submit]),summary,[role=button]")]
        .filter(element => element.getClientRects().length && !element.closest("form")).slice(0, 50).map((element, index) => {
          const id = `E${index + 1}`
          element.setAttribute("data-writing-tool-id", id)
          return { id, text: (element.innerText || element.getAttribute("aria-label") || "").trim().slice(0, 100),
            url: element instanceof HTMLAnchorElement ? element.href : undefined }
        })
      const images = [...(root?.querySelectorAll<HTMLImageElement>("img") || [])].map(image => ({
        url: image.getAttribute("data-original") || image.getAttribute("data-src") || image.currentSrc || image.src,
        alt: (image.alt || image.closest("figure")?.querySelector("figcaption")?.textContent || "").trim().slice(0, 220),
        width: image.naturalWidth || undefined, height: image.naturalHeight || undefined,
      })).filter(image => image.url && (!image.width || image.width >= 240) && (!image.height || image.height >= 120)).slice(0, 30)
      return { title: document.title.slice(0, 180), text: "", links, images }
    })
    if (await this.verificationVisible()) throw new WritingToolError("人机验证尚未通过，这个页面不能当作已读正文")
    const html = await this.page.content()
    let selector = "xiaohongshu-data"
    let quality: ReturnType<typeof assessPageText>
    if (isXiaohongshuArticle(url)) {
      data.text = extractXiaohongshuArticle(html, url)
      quality = assessPageText(data.text)
    } else {
      const readable = extractReadablePage(html, url)
      data.text = readable.text
      selector = readable.selector
      quality = readable.quality
    }
    if (!usablePageText(data.text)) {
      throw new WritingToolError(`网页未返回可读正文：${quality.reason || "当前可能是登录、验证或不可访问页面"}。`)
    }
    this.clickIds = new Set(data.links.map(link => link.id))
    this.savedFiles.set(`page-${this.savedFiles.size + 1}.txt`, `${url}\n${data.title}\n\n${data.text}`)
    this.savedFiles.set(`page-${this.savedFiles.size + 1}.html`, html.slice(0, 2_000_000))
    const images = this.addImages(data.images.flatMap(image => {
      let imageUrl: string
      try { imageUrl = publicSourceUrl(new URL(image.url, url).href) } catch { return [] }
      return imageUrl ? [{ ...image, url: imageUrl, sourceUrl: url, pageTitle: data.title }] : []
    }))
    return { ...data, url, selector, links: data.links.map(link => ({ ...link, url: link.url ? publicSourceUrl(link.url) || undefined : undefined })), images }
  }

  async screenshot(): Promise<WritingPageImage> {
    this.available()
    if (!this.page || this.screenshotCount >= 2) throw new WritingToolError("先打开网页，每篇最多截取两张真实页面画面")
    if (await this.verificationVisible()) throw new WritingToolError("验证码画面不能用作正文配图")
    if (new URL(this.page.url()).hostname === "mp.weixin.qq.com") await this.snapshot()
    const url = publicSourceUrl(this.page.url())
    if (!url) throw new WritingToolError("当前页面不能截图")
    const title = (await this.page.title()).slice(0, 180)
    const screenshot = await this.page.screenshot({ type: "jpeg", quality: 90, animations: "disabled", timeout: 8000 })
    this.screenshotCount++
    const image = this.addImages([{ url: `${url}#writing-screenshot-${this.screenshotCount}`, sourceUrl: url,
      pageTitle: title, alt: `${title}页面实录`, screenshot, width: 1280, height: 900 }])[0]
    if (!image) throw new WritingToolError("本篇已达到图片候选数量上限")
    return image
  }

  private async verificationVisible(): Promise<boolean> {
    if (!this.page) return false
    const completed = await this.page.locator('textarea[name="g-recaptcha-response"],textarea[name="h-captcha-response"],input[name="cf-turnstile-response"]')
      .evaluateAll(elements => elements.some(element => (element as HTMLInputElement).value?.length > 20)).catch(() => false)
    if (completed) return false
    for (const frame of this.page.frames()) {
      if (frame !== this.page.mainFrame()) {
        const box = await frame.frameElement().then(element => element.boundingBox()).catch(() => null)
        if (!box || box.width < 50 || box.height < 25) continue
      }
      const state = await frame.evaluate(() => {
        const widget = [...document.querySelectorAll<HTMLElement>('[class*="captcha"],[id*="captcha"],[class*="verify"],iframe[title*="challenge"],iframe[title*="验证"]')]
          .some(element => {
            if (String(element.className).includes("success") || element.getAttribute("aria-checked") === "true") return false
            const rect = element.getBoundingClientRect()
            return rect.width > 50 && rect.height > 25
          })
        const article = document.querySelector<HTMLElement>("#js_content,article,main")?.innerText?.trim() || ""
        return { text: `${document.title}\n${document.body?.innerText || ""}`.slice(0, 1800), widget, hasArticle: article.length > 300 }
      }).catch(() => null)
      if (state && (state.widget || (!state.hasArticle && VERIFICATION_MARKER.test(state.text)))) return true
    }
    return false
  }

  private async handleVerification() {
    this.available()
    if (!this.page || !await this.verificationVisible()) return
    if (!this.verification) throw new WritingToolError("网页出现人机验证，当前模型没有验证码处理连接")
    this.verificationActive = true
    this.verification.report("running", "网页出现人机验证，正在让模型识别页面并处理")
    try {
      while (this.verificationAttempts < 8) {
        this.available()
        if (!await this.verificationVisible()) {
          this.verification.report("done", "人机验证已通过，继续读取原网页")
          return
        }
        const frames = this.page.frames()
        const fields = new Map<string, { frame: number }>()
        const instructions: string[] = []
        await this.page.locator('[class*="captcha"],[id*="captcha"],iframe[title*="challenge"],iframe[title*="验证"]')
          .filter({ visible: true }).first().scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {})
        for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
          const info = await frames[frameIndex].evaluate(index => {
            const inputs = [...document.querySelectorAll<HTMLInputElement>('input:not([type=password]):not([type=email]):not([type=hidden]):not([type=tel])')]
              .filter(input => input.getClientRects().length && input.autocomplete !== "one-time-code").slice(0, 10)
              .map((input, fieldIndex) => {
                const id = `C${index}-${fieldIndex}`
                input.setAttribute("data-writing-verification-id", id)
                return { id, label: input.placeholder || input.getAttribute("aria-label") || input.name }
              })
            return { text: document.body?.innerText?.slice(0, 1200) || "", inputs }
          }, frameIndex).catch(() => null)
          if (!info) continue
          for (const input of info.inputs) fields.set(input.id, { frame: frameIndex })
          instructions.push(JSON.stringify({ text: info.text, inputs: info.inputs }))
        }
        this.verificationAttempts++
        const screenshot = (await this.page.screenshot({ type: "jpeg", quality: 85, animations: "disabled", timeout: 8000 })).toString("base64")
        const raw = await this.verification.solve({ screenshot, instructions: instructions.join("\n").slice(0, 6000), attempt: this.verificationAttempts })
        const action = verificationActionSchema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")))
        if (action.action === "stop") break
        if (action.action === "click") {
          for (const point of action.points) await this.page.mouse.click(point.x, point.y)
        } else if (action.action === "fill") {
          const field = fields.get(action.id)
          if (!field) throw new WritingToolError("验证码输入框已变化")
          await frames[field.frame].locator(`[data-writing-verification-id="${action.id}"]`).fill(action.text)
        } else if (action.action === "drag") {
          await this.page.mouse.move(action.from.x, action.from.y)
          await this.page.mouse.down()
          try { await this.page.mouse.move(action.to.x, action.to.y, { steps: 24 }) }
          finally { await this.page.mouse.up() }
        }
        await this.page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {})
      }
      if (!await this.verificationVisible()) {
        this.verification.report("done", "人机验证已通过，继续读取原网页")
        return
      }
      throw new WritingToolError("模型未能通过这个网页的人机验证，已保留失败记录")
    } catch (error) {
      this.signal.throwIfAborted()
      const reason = error instanceof WritingToolError ? error.message : "当前模型未能识别或完成网页验证码"
      this.verification.report("failed", reason)
      throw new WritingToolError(reason)
    } finally { this.verificationActive = false }
  }

  private docker(args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] })
      let output = ""
      let tooLarge = false
      const kill = () => { process.kill("SIGKILL") }
      this.signal.addEventListener("abort", kill, { once: true })
      process.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8")
        if (output.length > 24_000) { tooLarge = true; kill() }
      })
      // Docker 的错误可能含主机路径，不把原始诊断或宿主信息交给模型。
      process.stderr.resume()
      process.on("error", () => {
        this.signal.removeEventListener("abort", kill)
        reject(new WritingToolError("终端不可用，请启动 Docker 并准备终端镜像"))
      })
      process.on("close", code => {
        this.signal.removeEventListener("abort", kill)
        if (this.signal.aborted && args[0] !== "rm") reject(this.signal.reason)
        else if (tooLarge) reject(new WritingToolError("终端输出过多，请缩小命令处理范围"))
        else if (code !== 0) reject(new WritingToolError(`终端命令执行失败（退出码 ${code ?? "未知"}）${args[0] === "exec" && output.trim() ? `：\n${output.slice(0, 4000)}` : ""}`))
        else resolve(output.slice(0, 16_000))
      })
      process.stdin.on("error", () => {})
      process.stdin.end(input)
    })
  }

  async terminal(command: string): Promise<string> {
    this.available()
    if (!this.terminalEnabled) throw new WritingToolError("本次未开启终端工具")
    if (!this.container) {
      if (activeTerminals >= 3) throw new WritingToolError("终端正在处理其他文章")
      this.container = `writing-${randomUUID()}`
      const container = this.container
      activeTerminals++
      this.terminalReserved = true
      try {
        // 不挂载宿主目录、Cookie、密钥或 Docker socket；网络只通过公开网页工具读取。
        await this.docker(["run", "-d", "--rm", "--pull=never", "--name", container,
          "--label", "autowriting.tool=writing", "--network", "none", "--read-only", "--user", "65534:65534",
          "--cpus", "1", "--memory", "256m", "--pids-limit", "64", "--cap-drop", "ALL",
          "--security-opt", "no-new-privileges", "--tmpfs", "/work:rw,size=64m,uid=65534,gid=65534,mode=700",
          "--tmpfs", "/tmp:rw,size=32m,uid=65534,gid=65534,mode=700", "--workdir", "/work",
          "--entrypoint", "python3", WRITING_TERMINAL_IMAGE, "-c", "import threading; threading.Event().wait()"])
        if (this.disposed || this.signal.aborted) {
          await this.docker(["rm", "-f", container]).catch(() => {})
          this.available()
        }
      } catch (error) {
        // 取消时 docker 客户端可能先退出，按本次生成的名字再回收一次。
        await this.docker(["rm", "-f", container]).catch(() => {})
        await this.closeTerminal()
        throw error
      }
    }
    this.available()
    try {
      for (const [name, content] of this.savedFiles) {
        if (this.exportedFiles.has(name)) continue
        await this.docker(["exec", "-i", this.container!, "python3", "-c",
          "import pathlib,sys; pathlib.Path(sys.argv[1]).write_text(sys.stdin.read(),encoding='utf-8')", `/work/${name}`], content)
        this.exportedFiles.add(name)
      }
      // argv 直接传给 docker，只有容器内的 shell 会解释模型命令。
      return await this.docker(["exec", this.container!, "/bin/sh", "-lc", `(${command}\n) 2>&1`])
    } catch (error) {
      await this.closeTerminal()
      throw error
    }
  }

  private async closeTerminal() {
    const container = this.container
    this.container = undefined
    if (container) await this.docker(["rm", "-f", container]).catch(() => {})
    if (this.terminalReserved) {
      this.terminalReserved = false
      activeTerminals--
    }
    this.exportedFiles.clear()
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing
    this.disposed = true
    this.signal.removeEventListener("abort", this.abort)
    const browser = this.browser
    this.browser = undefined
    this.disposing = (async () => {
      await browser?.dispose().catch(() => {})
      await this.closeTerminal()
    })()
    return this.disposing
  }
}
