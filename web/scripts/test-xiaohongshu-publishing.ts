import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { chromium, type Browser, type Page } from "playwright"
import {
  dismissKnownGuide,
  fillFinalArticleMetadata,
  fillText,
  findFirstVisible,
  openFinalArticleForm,
  prepareLongArticle,
  setLabeledCheckbox,
  submitXiaohongshuOnce,
  waitForAnySelector,
} from "../server/utils/xiaohongshuBrowser.ts"

// 这些 fixture 复现已观察的 DOM 和页面阶段，不连接小红书、不创建真实草稿。
// 话题候选与实体仅是兼容性假设，不能用这个 fixture 宣称平台实测通过。
let browser: Browser
before(async () => { browser = await chromium.launch({ headless: true }) })
after(async () => { await browser?.close() })

async function withPage(html: string, run: (page: Page) => Promise<void>): Promise<void> {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.route("**/*", (route) => route.request().url().startsWith("http://xhs.test/")
    ? route.fulfill({ contentType: "text/html; charset=utf-8", body: html })
    : route.abort())
  try {
    await page.goto("http://xhs.test/publish")
    await run(page)
    assert.deepEqual(errors, [])
  } catch (error) {
    console.error("本地测试页失败状态：", await page.locator("body").innerText())
    throw error
  } finally {
    await page.close()
  }
}

const finalForm = `
  <div class="publish-page-content-base">
    <input type="text" placeholder="填写标题" maxlength="64">
    <div class="tiptap ProseMirror" role="textbox" contenteditable="true"></div>
    <button id="topicBtn">话题</button>
    <div class="topicTemplate"></div>
    <label><input id="original" type="checkbox">原创声明</label>
  </div>
  <div role="dialog" style="position:fixed;inset:0;background:white">
    图片可以编辑啦
    <button onclick="this.parentElement.remove()">关闭新功能引导</button>
  </div>
  <div class="publish-btn"><button onclick="document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1)">发布</button></div>`

test("等待任一可见节点时忽略隐藏副本，已出现的候选不等待缺失候选超时", async () => {
  await withPage(`
    <button class="target" hidden>隐藏副本</button>
    <script>setTimeout(() => {
      const button = document.createElement("button");
      button.className = "target"; button.textContent = "真正入口"; document.body.append(button);
    }, 80)</script>`, async (page) => {
    const locator = await findFirstVisible(page, [".missing", ".target"], 1000)
    assert.ok(locator)
    assert.equal(await locator.innerText(), "真正入口")
    // 这里测的是函数是否及时返回，不是把 timeout 参数当作正确性断言。
    await Promise.race([
      waitForAnySelector(page, [".target", ".never"], 3000).then((ready) => assert.equal(ready, true)),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("存在候选却仍等待缺失候选")), 1000)
        timer.unref()
      }),
    ])
  })
})

test("标题 maxlength 按 UTF-16 检查，超限时不覆盖原值，平台截断时停止", async () => {
  await withPage('<textarea maxlength="64">原始标题</textarea>', async (page) => {
    const title = page.locator("textarea")
    await assert.rejects(fillText(title, "😀".repeat(33)), /最多允许 64/)
    assert.equal(await title.inputValue(), "原始标题")
    await fillText(title, "😀".repeat(32))
    assert.equal(await title.inputValue(), "😀".repeat(32))
    await title.evaluate((element) => element.addEventListener("input", () => {
      if (element instanceof HTMLTextAreaElement) element.value = element.value.slice(0, 3)
    }))
    await assert.rejects(fillText(title, "被平台截断的标题"), /与预期不一致/)
  })
})

test("同一设置容器中的复选框分别生效，禁用状态不被强制更改", async () => {
  await withPage(`<div class="setting-item">
    <div><input id="author" type="checkbox" checked><span>作者</span></div>
    <div><input id="time" type="checkbox" disabled><span>字数和时长</span></div>
    <label><input id="summary" type="checkbox" style="display:none" checked><span>摘要</span></label>
  </div>`, async (page) => {
    await setLabeledCheckbox(page, "摘要", false)
    assert.equal(await page.locator("#author").isChecked(), true)
    assert.equal(await page.locator("#summary").isChecked(), false)
    await setLabeledCheckbox(page, "字数和时长", false)
    await assert.rejects(setLabeledCheckbox(page, "字数和时长", true), /不允许更改/)
    await setLabeledCheckbox(page, "作者", false)
    assert.equal(await page.locator("#author").isChecked(), false)
  })
})

test("长文按编辑→排版→模板封面→最终表单顺序执行，下一步之前不提交", async () => {
  await withPage(`
    <section id="editing">
      <div class="rich-editor-title"><textarea class="d-text d-textarea-shadow" hidden></textarea><textarea class="d-text" maxlength="64"></textarea></div>
      <div class="tiptap ProseMirror" contenteditable="true">旧正文</div>
      <button id="layout">一键排版</button>
    </section>
    <section id="cover" hidden>
      <div class="template-card-new" onclick="document.body.dataset.template='清晰明朗'">清晰明朗</div>
      <button onclick="document.querySelector('#settings').hidden=false">封面设置</button>
      <div id="settings" hidden>
        <div class="cover-item" onclick="document.body.dataset.cover='without_image'">无图封面</div>
        <div class="setting-item">
          <div><input id="author" type="checkbox" checked><span>作者</span></div>
          <div><input id="time" type="checkbox"><span>字数和时长</span></div>
          <div><input id="summary" type="checkbox" checked><span>摘要</span></div>
        </div>
        <div data-dom-type="summary" onclick="this.contentEditable='true'">默认摘要</div>
      </div>
      <div class="footer-new"><button class="submit" id="next">下一步</button></div>
    </section>
    <section id="final" hidden>${finalForm}</section>
    <script>
      document.querySelector("#layout").onclick=()=>{
        document.body.dataset.body=document.querySelector(".ProseMirror").innerHTML;
        document.querySelector("#editing").hidden=true;
        setTimeout(()=>document.querySelector("#cover").hidden=false, 60);
      };
      document.querySelector("#next").onclick=()=>{
        document.querySelector("#cover").hidden=true;
        document.querySelector("#final").hidden=false;
      };
    </script>`, async (page) => {
    await prepareLongArticle(page, {
      title: "回归测试标题", content: "# 回归测试标题\n\n## 分节\n\n正文 **重点**。",
      summary: "指定封面摘要", templateName: "清晰明朗", coverType: "without_image",
      showAuthor: false, showReadingTime: true, showSummary: true,
    })
    assert.equal(await page.locator("body").getAttribute("data-template"), "清晰明朗")
    assert.equal(await page.locator("body").getAttribute("data-cover"), "without_image")
    assert.equal(await page.locator("#author").isChecked(), false)
    assert.equal(await page.locator("#time").isChecked(), true)
    assert.equal(await page.locator('[data-dom-type="summary"]').innerText(), "指定封面摘要")
    const body = await page.locator("body").getAttribute("data-body")
    assert.match(body || "", /<h2>分节<\/h2>/)
    assert.match(body || "", /<strong>重点<\/strong>/)
    assert.doesNotMatch(body || "", /回归测试标题|旧正文/)
    await openFinalArticleForm(page)
    await fillFinalArticleMetadata(page, { title: "最终标题", summary: "最终简介", topics: [], original: true })
    assert.equal(await page.locator('input[placeholder="填写标题"]').inputValue(), "最终标题")
    assert.equal(await page.locator('#final [role="textbox"]').innerText(), "最终简介")
    assert.equal(await page.locator("#original").isChecked(), true)
    assert.equal(await page.locator("body").getAttribute("data-clicks"), null)
  })
})

test("只关闭已知引导，未知验证弹窗保持原样", async () => {
  await withPage('<div role="dialog">请完成验证<button>我知道了</button></div>', async (page) => {
    await dismissKnownGuide(page)
    assert.equal(await page.getByRole("dialog").isVisible(), true)
  })
})

test("缺少话题候选时停止，不改标题、不点击发布", async () => {
  await withPage(finalForm, async (page) => {
    await assert.rejects(fillFinalArticleMetadata(page, {
      title: "不能被话题覆盖", summary: "保留简介", topics: ["编程"], original: true,
    }), /话题“编程”已关联/)
    assert.equal(await page.locator('input[type="text"]').inputValue(), "不能被话题覆盖")
    assert.match(await page.locator('[contenteditable="true"]').innerText(), /^保留简介/)
    assert.equal(await page.locator("body").getAttribute("data-clicks"), null)
  })
})

test("精确选择话题后检查实体，话题文本不会覆盖标题或前面的简介", async () => {
  await withPage(`${finalForm}<script>
    const editor=document.querySelector('[role="textbox"]');
    const candidates=document.querySelector(".topicTemplate");
    editor.oninput=()=>{
      // Chromium 会把 contenteditable 末尾空格转成 NBSP，候选查询按空白字符分隔。
      const query=editor.textContent.match(/\\s#([^#\\s]+)$/)?.[1];
      candidates.replaceChildren();
      if(!query) return;
      for(const name of [query+"相关", query]){
        const option=document.createElement("div"); option.textContent=name;
        option.onclick=()=>{
          const last=editor.lastChild;
          if(last?.nodeType===Node.TEXT_NODE) last.textContent=last.textContent.replace(/\\s#[^#\\s]+$/, "");
          const entity=document.createElement("span"); entity.contentEditable="false"; entity.textContent="#"+name;
          editor.append(entity, document.createTextNode(" ")); candidates.replaceChildren();
        };
        candidates.append(option);
      }
    };
  </script>`, async (page) => {
    await fillFinalArticleMetadata(page, { title: "精确话题", summary: "保留简介", topics: ["编程", "阅读"], original: false })
    assert.equal(await page.locator('input[type="text"]').inputValue(), "精确话题")
    const editor = page.locator('[contenteditable="true"]')
    assert.match(await editor.innerText(), /^保留简介/)
    assert.deepEqual(await editor.locator('[contenteditable="false"]').allTextContents(), ["#编程", "#阅读"])
  })
})

test("成功延迟超过旧的 8 秒重试窗口，也只提交一次", async () => {
  await withPage(`<button id="publish">发布</button><p>已发布</p><script>
    document.querySelector("#publish").onclick=()=>{
      document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);
      setTimeout(()=>{const message=document.createElement("p");message.textContent="发布成功";document.body.append(message)}, 8500);
    };
  </script>`, async (page) => {
    assert.equal(await submitXiaohongshuOnce(page, 12000), "http://xhs.test/publish")
    assert.equal(await page.locator("body").getAttribute("data-clicks"), "1")
  })
})

test("已发布标签与跳转管理页不算成功，结果不明时不重试", async () => {
  await withPage(`<p>已发布</p><button onclick="document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);history.pushState({},'', '/manage')">发布</button>`, async (page) => {
    await assert.rejects(submitXiaohongshuOnce(page, 500), /勿重复发布/)
    assert.equal(await page.locator("body").getAttribute("data-clicks"), "1")
  })
})

test("已有成功提示时不触发新提交", async () => {
  await withPage('<p>发布成功</p><button onclick="document.body.dataset.clicked=true">发布</button>', async (page) => {
    await assert.rejects(submitXiaohongshuOnce(page, 500), /已有发布成功提示/)
    assert.equal(await page.locator("body").getAttribute("data-clicked"), null)
  })
})

test("发布按钮被未知弹窗遮挡时不强点，也不重试", async () => {
  await withPage(`<button onclick="document.body.dataset.clicked=true">发布</button>
    <div role="dialog" style="position:fixed;inset:0;background:white;z-index:10">请完成验证</div>`, async (page) => {
    await assert.rejects(submitXiaohongshuOnce(page, 1000), /勿重复发布/)
    assert.equal(await page.locator("body").getAttribute("data-clicked"), null)
    assert.equal(await page.getByRole("dialog").isVisible(), true)
  })
})

test("短暂成功提示只确认一次，不因提示消失而再等待或重发", async () => {
  await withPage(`<button aria-busy="true" id="submit">发布</button>
    <script>
      const button=document.querySelector("#submit");
      setTimeout(()=>button.setAttribute("aria-busy", "false"), 200);
      button.onclick=()=>{
        document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);
        const message=document.createElement("p");message.textContent="发布成功";document.body.append(message);
        setTimeout(()=>message.remove(), 400);
      };
    </script>`, async (page) => {
    assert.equal(await submitXiaohongshuOnce(page, 2000), "http://xhs.test/publish")
    assert.equal(await page.locator("body").getAttribute("data-clicks"), "1")
  })
})

test("closed Shadow DOM 等待图片就绪，只点击右侧发布，不点击暂存", async () => {
  await withPage(`<xhs-publish-btn is-publish="true" is-save-draft="true" submit-text="发布" save-text="暂存离开" submit-disabled="true" submit-loading="true" style="display:block;width:772px;height:90px"></xhs-publish-btn>
    <script>
      const host=document.querySelector("xhs-publish-btn");
      const root=host.attachShadow({mode:"closed"});
      root.innerHTML='<div style="display:flex;justify-content:center;align-items:center;height:90px;gap:24px"><button style="width:120px">暂存离开</button><button style="width:120px">发布</button></div>';
      root.querySelectorAll("button")[0].onclick=()=>document.body.dataset.saved="true";
      root.querySelectorAll("button")[1].onclick=()=>{
        document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);
        const message=document.createElement("p");message.textContent="发布成功";document.body.append(message);
      };
      setTimeout(()=>{host.setAttribute("submit-disabled","false");host.setAttribute("submit-loading","false")}, 200);
    </script>`, async (page) => {
    assert.equal(await submitXiaohongshuOnce(page, 2000), "http://xhs.test/publish")
    assert.equal(await page.locator("body").getAttribute("data-clicks"), "1")
    assert.equal(await page.locator("body").getAttribute("data-saved"), null)
  })
})
