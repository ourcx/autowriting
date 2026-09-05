import { chromium } from "playwright"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { createWechatBlockDocument } from "../shared/wechatBlockDsl.ts"
import { finalizeCanvasDesign } from "../shared/canvasDesignSystem.ts"

// 仅模拟文章读取和 AI 流式返回，验证真实页面、模板编译和导出；不访问数据库或线上服务。
const artifactDir = process.env.CANVAS_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), "canvas-studio-"))
fs.mkdirSync(artifactDir, { recursive: true })
const baseUrl = process.env.CANVAS_STUDIO_URL || "http://127.0.0.1:5173"

;(async () => {
 const browser = await chromium.launch({headless:true});
 try {
 const context = await browser.newContext({viewport:{width:1440,height:1080}});
 const page = await context.newPage();
 let holdGeneration = false
 let releaseGeneration
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const article={title:'把 AI 用进日常工作，从一个小任务开始', article:`很多人第一次打开 AI，都会问同一个问题：它到底能帮我做什么？试了几次聊天、写作和总结之后，新鲜感过去了，工作方式却没有改变。

问题往往不在工具本身，而在于我们给了它一个太大的期待，却没有一个足够具体的任务。

## 01 先找到一个反复出现的小麻烦

每周整理一次会议纪要、把零散反馈归成几类、为一封难写的邮件列出提纲。这些任务有共同点：频繁发生、边界明确，也容易判断结果好坏。

与其让 AI 帮你提升工作效率，不如先让它把这周的十条反馈，按产品问题、使用疑问和功能建议整理成三组。

> 好的起点，是一个你能亲自判断结果的小任务。

## 02 把标准讲清楚，给它一个例子

告诉 AI 你希望保留哪些信息、输出多长、读者是谁。再补上一份你认可的样例，让抽象要求变成可以参照的表达。

例如整理会议纪要时，要求只列已确认的决策、负责人和截止时间。没有确认的事项单独列出，不要补全原文没有的信息。

## 03 留下反馈，才有下一次进步

第一次输出不够好很正常。指出具体哪里不对，比简单地说重新写更有效。把修改后的版本留下来，下次就有了更好的起点。

当一个小任务稳定下来，再把相邻的步骤接进来。真正的改变，通常是许多次小小的改进累积起来的。

> 不必一次改变所有工作，先让明天的一件事变得更轻松。`,materials:'',task:''};
 await context.addInitScript(()=>localStorage.setItem('auth_token','local-browser-fixture'));
 await page.route('**/api/auth/me',r=>r.fulfill({json:{user:{id:'fixture',username:'local',role:'admin'}}}));
 await page.route('**/api/articles',r=>r.fulfill({json:[{id:'canvas-fixture',title:article.title,status:'generated'},{id:'canvas-second',title:'第二篇文章',status:'generated'}]}));
 await page.route('**/api/articles/canvas-fixture',r=>r.fulfill({json:article}));
 await page.route('**/api/articles/canvas-second', r=>r.fulfill({json:{...article,title:'第二篇文章'}}))
 await page.route('**/api/images/uploaded?*',r=>r.fulfill({json:[]}));
 await page.route('**/api/canvas/generate-block/stream', async route => {
  const input = route.request().postDataJSON()
  assert.equal(input.templateId, "editorial-story")
  const result = finalizeCanvasDesign(createWechatBlockDocument(article.title, input.sources), input.sources, input.templateId)
  assert.equal(result.report.passed, true)
  if (holdGeneration) await new Promise(resolve => { releaseGeneration = resolve })
  await route.fulfill({contentType:"text/event-stream",body:`event: result\ndata: ${JSON.stringify({document:result.document})}\n\n`})
 })
 await page.goto(`${baseUrl}/canvas?articleId=canvas-fixture`);
 await page.locator('.wbe-paper h1').waitFor();
 await page.screenshot({path:path.join(artifactDir, 'editor.png')});
 const paper=page.locator('.wbe-paper');
 assert.equal(Math.round((await paper.boundingBox()).width),375);
 const before=await paper.innerText();
 await page.getByRole('button',{name:'阅读预览',exact:true}).click();
 await page.screenshot({path:path.join(artifactDir, 'reading.png')});
 const report=await page.locator('.cs-reading-paper').evaluate(root=>({
  overflow:[root,...root.querySelectorAll('*')].filter(el=>el.scrollWidth>el.clientWidth+2 && el.clientWidth>0).map(el=>el.tagName),
  headings:[...root.querySelectorAll('h2')].map(el=>({size:getComputedStyle(el).fontSize,text:el.textContent})),
  text:root.innerText,
  quotes:[...root.querySelectorAll('blockquote')].map(el=>({border:getComputedStyle(el).borderLeftWidth, background:getComputedStyle(el).backgroundColor})),
  titleBorder:getComputedStyle(root.querySelector('h1')).borderBottomWidth,
 }));
 assert.deepEqual(report.overflow,[]);
 assert.ok(report.quotes.length > 0);
 assert.ok(report.quotes.every(quote=>quote.border === '0px' && quote.background === 'rgba(0, 0, 0, 0)'));
 assert.equal(report.titleBorder, '0px');
 assert.equal(report.text,before);
 assert.ok(report.headings.every(h=>parseFloat(h.size)>=20));
 await page.getByRole('button',{name:'返回编辑',exact:true}).click();
 await page.getByRole('button',{name:/采访手记 人物故事/}).click();
 await page.getByRole('button',{name:'应用模板',exact:true}).click();
 const after=await paper.locator('.wbe-document').getAttribute('style');
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 assert.notEqual(await paper.locator('.wbe-document').getAttribute('style'),after);
 await page.getByRole('button',{name:'重做',exact:true}).click();
 assert.equal(await paper.locator('.wbe-document').getAttribute('style'),after);
 await page.getByRole('button',{name:'撤销',exact:true}).click();
 await page.locator('.wbe-section-children button').filter({hasText:'01 先找到'}).click();
 await page.screenshot({path:path.join(artifactDir, 'selected.png')});
 assert.ok(await page.locator('.wbe-section-item.is-selected').count());
 await page.getByLabel('字号', {exact:true}).fill('24')
 assert.equal(await page.locator('.wbe-section-item.is-selected h2').evaluate(el=>getComputedStyle(el).fontSize), '24px')
 await page.getByRole('button',{name:'撤销',exact:true}).click()
 assert.equal(await page.locator('.wbe-section-item.is-selected h2').evaluate(el=>getComputedStyle(el).fontSize), '22px')
 await page.getByRole('combobox',{name:'预览宽度'}).selectOption('414');
 assert.equal(Math.round((await paper.boundingBox()).width),414);
 const stored=await page.locator('.wbe-paper').evaluate(root=>[...root.querySelectorAll('h1,h2,p,blockquote')].map(el=>({text:el.textContent,style:el.getAttribute('style')})));
 await page.reload();await page.locator('.wbe-paper h1').waitFor();
 assert.deepEqual(await page.locator('.wbe-paper').evaluate(root=>[...root.querySelectorAll('h1,h2,p,blockquote')].map(el=>({text:el.textContent,style:el.getAttribute('style')}))),stored);
 assert.ok(await page.getByRole('button',{name:'撤销',exact:true}).isDisabled());

 // 实际点击复制，并检查剪贴板 HTML 中不带编辑器控件或选中态。
 await context.grantPermissions(['clipboard-read', 'clipboard-write'])
 await page.getByRole('button', {name:'复制公众号内容',exact:true}).click()
 await page.getByText('已复制公众号富文本，可直接粘贴到编辑器', {exact:true}).waitFor()
 const copied = await page.evaluate(async () => {
  const items = await navigator.clipboard.read()
  const item = items.find(value => value.types.includes('text/html'))
  return item ? (await item.getType('text/html')).text() : ''
 })
 fs.writeFileSync(path.join(artifactDir, 'article.html'), copied)
 assert.ok(copied.includes(article.title))
 assert.ok(copied.includes('font-size: 22px'))
 assert.ok(!copied.includes('data-block-id'))
 assert.ok(!copied.includes('<button'))
 fs.writeFileSync(path.join(artifactDir, 'article.html'), copied)
 await page.getByRole('button', {name:/杂志叙事 知识分享/}).click()
 await page.getByRole('button', {name:'AI 设计排版',exact:true}).click()
 await page.getByRole('button', {name:'AI 设计排版',exact:true}).waitFor()
 assert.ok(await page.getByRole('button', {name:'撤销',exact:true}).isEnabled())
 assert.equal(await paper.innerText(), before)
 await page.getByRole('button', {name:'阅读预览',exact:true}).click()
 const exportPage = await context.newPage()
 await exportPage.setViewportSize({width:375,height:900})
 await exportPage.setContent(copied)
 await exportPage.addStyleTag({content:'body { margin: 0; }'})
 assert.equal(await exportPage.locator('body').evaluate(el=>el.scrollWidth > 375), false)
 await exportPage.screenshot({path:path.join(artifactDir,'article.png'),fullPage:true})
 await exportPage.close()
 // 切换文章时，让旧请求延迟返回，验证结果不会写进新文章。
 holdGeneration = true
 await Promise.all([page.waitForRequest('**/api/canvas/generate-block/stream'), page.getByRole('button', {name:'AI 设计排版',exact:true}).click()])
 await page.getByRole('combobox', {name:'选择公众号文章'}).selectOption('canvas-second')
 await page.locator('.cs-reading-paper h1').filter({hasText:'第二篇文章'}).waitFor()
 assert.ok(releaseGeneration)
 releaseGeneration()
 await page.getByRole('button', {name:'AI 设计排版',exact:true}).waitFor()
 assert.equal(await page.locator('.cs-reading-paper h1').innerText(), '第二篇文章')
 assert.ok(await page.getByRole('button',{name:'撤销',exact:true}).isDisabled())
 fs.writeFileSync(path.join(artifactDir, 'report.json'),JSON.stringify({errors,checks:['375px/414px 预览','无横向溢出','章节字号','模板切换','撤销重做','段落选择及字号修改','刷新保留排版','实际剪贴板 HTML','AI 流式响应模拟','跨文章请求隔离']},null,2))
 assert.deepEqual(errors,[]);
 await context.clearCookies();
 console.log(`Browser checks passed · ${artifactDir}`);
 } finally { await browser.close() }
})().catch(e=>{console.error(e);process.exit(1)});
