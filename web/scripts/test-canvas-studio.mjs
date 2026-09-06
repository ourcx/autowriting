import { chromium } from "playwright"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import assert from "node:assert/strict"

// 仅模拟文章读取，禁止排版流程调用 AI，验证真实页面、模板编译和导出；不访问数据库或线上服务。
const artifactDir = process.env.CANVAS_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), "canvas-studio-"))
fs.mkdirSync(artifactDir, { recursive: true })
const baseUrl = process.env.CANVAS_STUDIO_URL || "http://127.0.0.1:5173"

;(async () => {
 const browser = await chromium.launch({headless:true});
 try {
 const context = await browser.newContext({viewport:{width:1440,height:1080}});
 const page = await context.newPage();
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
 await context.addInitScript(()=>{
  localStorage.setItem('auth_token','local-browser-fixture')
  localStorage.setItem('cover_image_canvas-fixture','http://127.0.0.1:5173/api/images/uploads/current-cover.png')
 });
 await page.route('**/api/auth/me',r=>r.fulfill({json:{user:{id:'fixture',username:'local',role:'admin'}}}));
 await page.route('**/api/articles',r=>r.fulfill({json:[{id:'canvas-fixture',title:article.title,status:'generated'},{id:'canvas-second',title:'第二篇文章',status:'generated'}]}));
 await page.route('**/api/articles/canvas-fixture',r=>r.fulfill({json:article}));
 await page.route('**/api/articles/canvas-second', r=>r.fulfill({json:{...article,title:'第二篇文章'}}))
 await page.route('**/api/images/uploaded?*',r=>r.fulfill({json:r.request().url().includes('articleId=canvas-fixture') ? [
  {url:'/api/images/uploads/current-cover.png',originalName:'当前封面.png'},
  {url:'/api/images/uploads/old-cover.png',originalName:'cover-paste-1788684907747.png'},
 ] : []}));
 await page.route('**/api/images',r=>r.fulfill({json:[{imageUrl:'/api/images/uploads/library-fixture.png',title:'图库照片测试'}]}))
 await page.route('**/api/images/uploads/library-fixture.png',r=>r.fulfill({contentType:'image/png',body:fs.readFileSync(new URL('../public/canvas-materials/watercolor-bunting.png',import.meta.url))}))
 const aiRequests = []
 await page.route('**/api/canvas/**', route => {
  aiRequests.push(route.request().url())
  return route.abort()
 })
 await page.goto(`${baseUrl}/canvas?articleId=canvas-fixture`);
 await page.locator('.wbe-paper h1').waitFor();
 await page.screenshot({path:path.join(artifactDir, 'editor.png')});
 const paper=page.locator('.wbe-paper');
 assert.equal(Math.round((await paper.boundingBox()).width),375);
 // 在常见笔记本高度下，默认控件不能把编辑器挤出首屏。
 await page.setViewportSize({width:1366,height:768})
 const editorArea = await page.locator('.wbe-workspace').boundingBox()
 assert.ok(editorArea.y < 280 && editorArea.height > 450, JSON.stringify(editorArea))
 await page.setViewportSize({width:1440,height:1080})
 assert.equal(await paper.locator('img').count(),0,'当前与历史封面不得自动追加到正文')
 assert.ok(!(await paper.innerText()).includes('cover-paste-'))
 const before=await paper.innerText();
 // 默认模板是唯一排版入口；不再提供秀米导入或 AI 生成。
 assert.equal(await page.getByRole('button', {name:'AI 设计排版',exact:true}).count(), 0)
 await page.getByText('主题与模板',{exact:true}).click()
 assert.equal(await page.getByLabel('从秀米公开分享链接生成').count(), 0)
 assert.equal(await page.locator('.cs-template-card').count(), 7)
 assert.ok((await page.locator('.cs-template-thumb').first().boundingBox()).width >= 80, '模板缩略图应清晰可辨')
 await page.screenshot({path:path.join(artifactDir, 'template-shelf.png')})
 await page.getByText('主题与模板',{exact:true}).click()
 for (const name of ['自然手记','节庆邀请','影像画册']) {
  await page.getByText('主题与模板',{exact:true}).click()
  await page.getByRole('button',{name:new RegExp(name)}).click()
  await page.getByRole('button',{name:'应用模板',exact:true}).click()
  assert.ok(await paper.locator('[data-publication-frame]').count())
  await page.screenshot({path:path.join(artifactDir,`${name}.png`)})
  await page.getByRole('button',{name:'阅读预览',exact:true}).click()
  assert.equal(await page.locator('.cs-reading-paper').evaluate(root=>root.scrollWidth>root.clientWidth+2),false,`${name} 不得溢出`)
  await page.getByRole('button',{name:'返回编辑',exact:true}).click()
  await page.getByRole('button',{name:'撤销',exact:true}).click()
 }
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
 await page.getByText('主题与模板',{exact:true}).click();
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
 assert.ok(!copied.includes('old-cover.png') && !copied.includes('current-cover.png') && !copied.includes('cover-paste-'), '导出不得包含自动追加的封面')
 assert.ok(copied.includes('font-size: 22px'))
 assert.ok(!copied.includes('data-block-id'))
 assert.ok(!copied.includes('<button'))
 fs.writeFileSync(path.join(artifactDir, 'article.html'), copied)
 await page.getByText('主题与模板',{exact:true}).click()
 await page.getByRole('button', {name:/杂志叙事 知识分享/}).click()
 await page.getByRole('button', {name:'应用模板',exact:true}).click()
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
 // 切换文章后，模板和历史仍按文章隔离。
 await page.getByRole('combobox', {name:'选择公众号文章'}).selectOption('canvas-second')
 await page.locator('.cs-reading-paper h1').filter({hasText:'第二篇文章'}).waitFor()
 assert.equal(await page.locator('.cs-reading-paper h1').innerText(), '第二篇文章')
 assert.ok(await page.getByRole('button',{name:'撤销',exact:true}).isDisabled())
 // 新主题使用真实静态素材；验收插入、刷新、导出，不调用在线图片服务。
 await page.getByRole('button',{name:'返回编辑',exact:true}).click()
 await page.getByText('主题与模板',{exact:true}).click()
 await page.getByRole('button',{name:/手绘纸笺 水彩彩旗/}).click()
 await page.getByRole('button',{name:'应用模板',exact:true}).click()
 await page.locator('.wbe-paper [data-publication-frame="notebook"]').first().waitFor()
 // 在真实编辑器中验证纸张与时间线独立组合，刷新和导出不能退回 stack。
 await page.locator('.wbe-paper [data-publication-frame="notebook"]').first().click({position:{x:5,y:5}})
 await page.getByRole('combobox',{name:'纸张结构'}).selectOption('letter')
 await page.getByRole('combobox',{name:'章节布局'}).selectOption('timeline')
 assert.ok(await paper.locator('[data-publication-frame="letter"] table').count())
 const scrapbookText = await paper.innerText()
 await page.getByText('素材库',{exact:true}).click()
 await page.locator('.cs-material-shelf summary').filter({hasText:'装饰素材库'}).click()
 await page.getByRole('button',{name:'心形夹板 照片装饰',exact:true}).click()
 assert.equal(await page.getByRole('combobox',{name:'素材来源'}).inputValue(), 'watercolor-clip')
 await page.getByRole('button',{name:'矢量纸飞机 校园装饰',exact:true}).click()
 assert.equal(await page.getByRole('combobox',{name:'素材来源'}).inputValue(), 'svg-plane')
 await page.getByText('照片与插画库',{exact:false}).click()
 await page.getByRole('textbox',{name:'筛选图库图片'}).fill('图库照片')
 await page.getByRole('button',{name:'图库照片测试 插入照片',exact:true}).click()
 assert.equal(await page.getByRole('combobox',{name:'素材来源'}).inputValue(), 'library')
 await page.getByText('素材库',{exact:true}).click()
 // 阅读态去掉编辑器原有的外扩 3px 选中框，检查实际交付内容是否溢出。
 await page.getByRole('button',{name:'阅读预览',exact:true}).click()
 for (const width of ['375','414','677']) {
  await page.getByRole('combobox',{name:'预览宽度'}).selectOption(width)
  assert.deepEqual(await page.locator('.cs-reading-paper').evaluate(root=>[root,...root.querySelectorAll('*')].filter(el=>el.clientWidth>0 && el.scrollWidth>el.clientWidth+2).map(el=>({tag:el.tagName,cls:el.className,w:el.clientWidth,scroll:el.scrollWidth}))), [], `手绘主题 ${width}px 溢出`)
 }
 await page.getByRole('combobox',{name:'预览宽度'}).selectOption('375')
 await page.getByRole('button',{name:'返回编辑',exact:true}).click()
 await page.reload();await page.locator('.wbe-paper [data-publication-frame="notebook"]').first().waitFor()
 assert.equal(await paper.innerText(), scrapbookText)
 assert.ok(await paper.locator('[data-publication-frame="letter"] table').count())
 await page.waitForFunction(()=>[...document.querySelectorAll('.wbe-paper img')].every(img=>img.complete && img.naturalWidth>0))
 await page.screenshot({path:path.join(artifactDir,'scrapbook-editor.png'),fullPage:true})
 await page.getByRole('button',{name:'复制公众号内容',exact:true}).click()
 await page.getByText('已复制公众号富文本，可直接粘贴到编辑器',{exact:true}).waitFor()
 const themedHtml = await page.evaluate(async()=>{const items=await navigator.clipboard.read();return (await items.find(item=>item.types.includes('text/html')).getType('text/html')).text()})
 assert.ok(themedHtml.includes('data:image/png;base64,'))
 assert.ok(!themedHtml.includes('/canvas-materials/'))
 assert.ok(!themedHtml.includes('/api/images/uploads/'))
 assert.ok(!themedHtml.includes('data-block-id'))
 // 独立验证自由 SVG 曲线的形状、尺寸和同容器文字均未被导出器删除。
 const vectorExport = await page.evaluate(async () => {
  const { buildWechatBlockHtml, copyWechatBlockHtml } = await import('/src/utils/wechatBlockExport.ts')
  const source = document.createElement('section')
  source.innerHTML = '<section><span>必须保留的相邻文字</span><svg xmlns="http://www.w3.org/2000/svg" width="180" height="40" viewBox="0 0 180 40"><path d="M0 20Q90 0 180 20" fill="none" stroke="#b63f68"/></svg></section>'
  document.body.append(source)
  try {
   const html = buildWechatBlockHtml(source)
   await copyWechatBlockHtml(source)
   return html
  } finally { source.remove() }
 })
 assert.ok(vectorExport.includes('必须保留的相邻文字'))
 assert.ok(vectorExport.includes(encodeURIComponent('M0 20Q90 0 180 20')))
 assert.ok(vectorExport.includes('width: 180px'))
 const vectorClipboard = await page.evaluate(async()=>{const items=await navigator.clipboard.read();return (await items.find(item=>item.types.includes('text/html')).getType('text/html')).text()})
 assert.ok(vectorClipboard.includes('data:image/png;base64,'))
 assert.ok(!vectorClipboard.includes('data:image/svg+xml'))
 assert.ok(vectorClipboard.includes('必须保留的相邻文字'))
 fs.writeFileSync(path.join(artifactDir,'scrapbook.html'),themedHtml)
 const themedPage=await context.newPage()
 await themedPage.setViewportSize({width:375,height:900})
 await themedPage.setContent(themedHtml)
 await themedPage.addStyleTag({content:'body { margin: 0; }'})
 assert.equal(await themedPage.locator('body').evaluate(el=>el.scrollWidth>375),false)
 // 时间线保留窄标记列，导出后的文字列至少占行宽的七成。
 const timelineColumns = await themedPage.locator('td').evaluateAll(cells => cells
  .filter(cell => cell.style.width === '30px')
  .map(cell => ({marker:cell.getBoundingClientRect().width,body:cell.nextElementSibling.getBoundingClientRect().width,row:cell.parentElement.getBoundingClientRect().width})))
 assert.ok(timelineColumns.length > 0)
 assert.ok(timelineColumns.every(column=>column.body / column.row > 0.7), JSON.stringify(timelineColumns))
 await themedPage.screenshot({path:path.join(artifactDir,'scrapbook-export.png'),fullPage:true})
 await themedPage.close()
 assert.deepEqual(aiRequests, [], '应用模板、编辑和导出不应发起 AI 请求')
 fs.writeFileSync(path.join(artifactDir, 'report.json'),JSON.stringify({errors,checks:['375px/414px 预览','无横向溢出','章节字号','模板切换','撤销重做','段落选择及字号修改','刷新保留排版','实际剪贴板 HTML','默认模板不调用 AI','跨文章历史隔离','手绘纸笺与装饰、照片筛选插入','375/414/677px 新主题无溢出','新主题刷新与内嵌素材导出','信纸与时间线组合及导出列宽','自由 SVG 形状、相邻文字与 PNG 剪贴板']},null,2))
 assert.deepEqual(errors,[]);
 await context.clearCookies();
 console.log(`Browser checks passed · ${artifactDir}`);
 } finally { await browser.close() }
})().catch(e=>{console.error(e);process.exit(1)});
