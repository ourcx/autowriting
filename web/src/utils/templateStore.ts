/**
 * WeChat CSS Template Store
 * 内置模板 + localStorage 自定义模板 CRUD
 */

export interface TemplateItem {
  id: string
  name: string
  desc: string
  accentColor: string
  css: string
  isBuiltin: boolean
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'wx-style-templates-v1'

// ── 内置模板 CSS ─────────────────────────────────────────────────────────────

export const CSS_DEFAULT = `/* ====== 经典蓝 ====== */
#wemd {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  color: #333333;
  line-height: 1.75;
  word-break: break-word;
  padding: 24px 24px 40px;
}
#wemd p {
  margin: 16px 0;
  line-height: 1.75;
  text-align: justify;
}
#wemd h1 {
  margin: 32px 0 24px;
  text-align: center;
  font-size: 22px;
  font-weight: bold;
  color: #111111;
}
#wemd h2 {
  margin: 28px 0 16px;
  font-size: 18px;
  font-weight: bold;
  color: #1e6bb8;
  border-left: 4px solid #1e6bb8;
  padding-left: 10px;
}
#wemd h3 {
  margin: 22px 0 12px;
  font-size: 16px;
  font-weight: bold;
  color: #444444;
}
#wemd h4 {
  margin: 18px 0 10px;
  font-size: 15px;
  font-weight: bold;
  color: #555555;
}
#wemd ul, #wemd ol {
  margin: 12px 0;
  padding-left: 24px;
}
#wemd li {
  margin: 6px 0;
  line-height: 1.75;
}
#wemd blockquote {
  margin: 16px 0;
  padding: 14px 18px;
  background: #f5f5f5;
  border-left: 4px solid #d1d5db;
  border-radius: 4px;
  color: #666666;
}
#wemd blockquote p {
  margin: 0;
  font-size: 15px;
  line-height: 1.7;
}
#wemd strong {
  font-weight: bold;
  color: #111111;
}
#wemd em {
  font-style: italic;
}
#wemd code {
  color: #e83e8c;
  background: #f8f9fa;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 14px;
  font-family: "Courier New", Courier, monospace;
}
#wemd pre {
  margin: 16px 0;
  padding: 16px;
  background: #282c34;
  border-radius: 8px;
  overflow-x: auto;
}
#wemd pre code {
  color: #abb2bf;
  font-size: 13px;
  line-height: 1.6;
  background: transparent;
  padding: 0;
  font-family: "Courier New", Consolas, Monaco, monospace;
}
#wemd a {
  color: #1e6bb8;
  text-decoration: none;
  border-bottom: 1px solid #1e6bb8;
}
#wemd hr {
  margin: 28px 0;
  border: none;
  border-top: 1px solid #e5e7eb;
}
#wemd img {
  display: block;
  max-width: 100%;
  margin: 16px auto;
  border-radius: 4px;
}
#wemd table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 14px;
}
#wemd th {
  background: #f3f4f6;
  color: #374151;
  font-weight: bold;
  border: 1px solid #e5e7eb;
  padding: 10px 12px;
  text-align: left;
}
#wemd td {
  border: 1px solid #e5e7eb;
  padding: 10px 12px;
  color: #374151;
}
#wemd tr:nth-child(even) td {
  background: #fafafa;
}`

export const CSS_MORANDI = `/* ====== 莫兰迪 ====== */
#wemd {
  font-family: "Georgia", "PingFang SC", "Microsoft YaHei", serif;
  color: #3A4D39;
  line-height: 2.0;
  word-break: break-word;
  padding: 24px 24px 40px;
}
#wemd p {
  margin: 16px 0;
  line-height: 2.0;
  text-align: justify;
  letter-spacing: 0.3px;
}
#wemd h1 {
  margin: 32px 0 24px;
  text-align: center;
  font-size: 22px;
  font-weight: normal;
  color: #1A261D;
  letter-spacing: 2px;
}
#wemd h2 {
  margin: 28px 0 16px;
  font-size: 18px;
  font-weight: bold;
  color: #4F6F52;
  border-left: 5px solid #4F6F52;
  padding-left: 12px;
  border-bottom: 1px solid #E8EBE9;
  padding-bottom: 8px;
}
#wemd h3 {
  margin: 22px 0 12px;
  font-size: 16px;
  font-weight: bold;
  color: #739072;
}
#wemd h4 {
  margin: 18px 0 10px;
  font-size: 15px;
  color: #739072;
}
#wemd ul, #wemd ol {
  margin: 12px 0;
  padding-left: 24px;
}
#wemd li {
  margin: 6px 0;
  line-height: 2.0;
  color: #3A4D39;
}
#wemd blockquote {
  margin: 16px 0;
  padding: 14px 18px;
  background: #F6F8F6;
  border: 1px dashed #739072;
  border-radius: 6px;
  color: #556B58;
}
#wemd blockquote p {
  margin: 0;
  font-size: 15px;
  line-height: 1.8;
}
#wemd strong {
  font-weight: bold;
  color: #1A261D;
}
#wemd em {
  font-style: italic;
  color: #4F6F52;
}
#wemd code {
  color: #4F6F52;
  background: #F0F4F0;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 14px;
  font-family: "Courier New", Courier, monospace;
}
#wemd pre {
  margin: 16px 0;
  padding: 16px;
  background: #2f3e32;
  border-radius: 8px;
  overflow-x: auto;
}
#wemd pre code {
  color: #a8c5a0;
  font-size: 13px;
  line-height: 1.6;
  background: transparent;
  padding: 0;
  font-family: "Courier New", Consolas, Monaco, monospace;
}
#wemd a {
  color: #4F6F52;
  text-decoration: none;
  border-bottom: 1px solid #4F6F52;
}
#wemd hr {
  margin: 28px 0;
  border: none;
  border-top: 1px dashed #b0c4b1;
}
#wemd img {
  display: block;
  max-width: 100%;
  margin: 16px auto;
  border-radius: 4px;
}
#wemd table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 14px;
}
#wemd th {
  background: #e8ede8;
  color: #2f3e32;
  font-weight: bold;
  border: 1px solid #c8d5c9;
  padding: 10px 12px;
  text-align: left;
}
#wemd td {
  border: 1px solid #c8d5c9;
  padding: 10px 12px;
  color: #3A4D39;
}
#wemd tr:nth-child(even) td {
  background: #f4f7f4;
}`

export const CSS_MINIMAL = `/* ====== 极简黑 ====== */
#wemd {
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  color: #1a1a1a;
  line-height: 1.8;
  word-break: break-word;
  padding: 24px 24px 40px;
}
#wemd p {
  margin: 16px 0;
  line-height: 1.8;
  text-align: justify;
}
#wemd h1 {
  margin: 32px 0 24px;
  text-align: center;
  font-size: 24px;
  font-weight: 900;
  color: #000000;
  letter-spacing: -0.5px;
  border-bottom: 3px solid #000000;
  padding-bottom: 12px;
}
#wemd h2 {
  margin: 28px 0 16px;
  font-size: 18px;
  font-weight: 800;
  color: #000000;
  border-bottom: 2px solid #000000;
  padding-bottom: 8px;
}
#wemd h3 {
  margin: 22px 0 12px;
  font-size: 16px;
  font-weight: 700;
  color: #333333;
}
#wemd h4 {
  margin: 18px 0 10px;
  font-size: 15px;
  font-weight: 600;
  color: #444444;
}
#wemd ul, #wemd ol {
  margin: 12px 0;
  padding-left: 24px;
}
#wemd li {
  margin: 6px 0;
  line-height: 1.8;
}
#wemd blockquote {
  margin: 16px 0;
  padding: 12px 16px;
  background: #f9f9f9;
  border-left: 3px solid #000000;
  color: #555555;
}
#wemd blockquote p {
  margin: 0;
  font-size: 15px;
}
#wemd strong {
  font-weight: bold;
  color: #000000;
  background: #f0f0f0;
  padding: 0 3px;
  border-radius: 2px;
}
#wemd em {
  font-style: italic;
}
#wemd code {
  color: #000000;
  background: #f0f0f0;
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 14px;
  font-family: "Courier New", Courier, monospace;
}
#wemd pre {
  margin: 16px 0;
  padding: 16px;
  background: #111111;
  border-radius: 4px;
  overflow-x: auto;
}
#wemd pre code {
  color: #f0f0f0;
  font-size: 13px;
  line-height: 1.6;
  background: transparent;
  padding: 0;
  font-family: "Courier New", Consolas, Monaco, monospace;
}
#wemd a {
  color: #000000;
  text-decoration: none;
  border-bottom: 1px solid #000000;
  font-weight: 600;
}
#wemd hr {
  margin: 28px 0;
  border: none;
  border-top: 2px solid #000000;
}
#wemd img {
  display: block;
  max-width: 100%;
  margin: 16px auto;
}
#wemd table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 14px;
}
#wemd th {
  background: #000000;
  color: #ffffff;
  font-weight: bold;
  border: 1px solid #000000;
  padding: 10px 12px;
  text-align: left;
}
#wemd td {
  border: 1px solid #333333;
  padding: 10px 12px;
}
#wemd tr:nth-child(even) td {
  background: #f9f9f9;
}`

export const CSS_SUNSET = `/* ====== 夕阳橙 ====== */
#wemd {
  font-family: "Georgia", "STSong", "SimSun", serif;
  color: #3d2b1f;
  line-height: 1.9;
  word-break: break-word;
  padding: 24px 24px 40px;
}
#wemd p {
  margin: 16px 0;
  line-height: 1.9;
  text-align: justify;
  letter-spacing: 0.2px;
}
#wemd h1 {
  margin: 32px 0 24px;
  text-align: center;
  font-size: 22px;
  font-weight: bold;
  color: #8b3a0f;
  letter-spacing: 2px;
}
#wemd h2 {
  margin: 28px 0 16px;
  font-size: 18px;
  font-weight: bold;
  color: #8b3a0f;
  border-left: 4px solid #c8602a;
  padding-left: 10px;
  font-style: italic;
}
#wemd h3 {
  margin: 22px 0 12px;
  font-size: 16px;
  font-weight: bold;
  color: #b25220;
}
#wemd h4 {
  margin: 18px 0 10px;
  font-size: 15px;
  color: #b25220;
}
#wemd ul, #wemd ol {
  margin: 12px 0;
  padding-left: 24px;
}
#wemd li {
  margin: 6px 0;
  line-height: 1.9;
  color: #3d2b1f;
}
#wemd blockquote {
  margin: 16px 0;
  padding: 14px 18px;
  background: #fdf6ee;
  border-left: 4px solid #c8602a;
  border-radius: 0 6px 6px 0;
  color: #6b4c36;
}
#wemd blockquote p {
  margin: 0;
  font-size: 15px;
  line-height: 1.8;
}
#wemd strong {
  font-weight: bold;
  color: #6b1d0a;
}
#wemd em {
  font-style: italic;
  color: #b25220;
}
#wemd code {
  color: #c8602a;
  background: #fdf0e6;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 14px;
  font-family: "Courier New", Courier, monospace;
}
#wemd pre {
  margin: 16px 0;
  padding: 16px;
  background: #2a1a0f;
  border-radius: 6px;
  overflow-x: auto;
}
#wemd pre code {
  color: #f4c87a;
  font-size: 13px;
  line-height: 1.6;
  background: transparent;
  padding: 0;
  font-family: "Courier New", Consolas, Monaco, monospace;
}
#wemd a {
  color: #c8602a;
  text-decoration: none;
  border-bottom: 1px solid #c8602a;
}
#wemd hr {
  margin: 28px 0;
  border: none;
  border-top: 1px solid #e5c9a0;
}
#wemd img {
  display: block;
  max-width: 100%;
  margin: 16px auto;
  border-radius: 4px;
}
#wemd table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 14px;
}
#wemd th {
  background: #fdf0e6;
  color: #6b1d0a;
  font-weight: bold;
  border: 1px solid #e5c9a0;
  padding: 10px 12px;
  text-align: left;
}
#wemd td {
  border: 1px solid #e5c9a0;
  padding: 10px 12px;
  color: #3d2b1f;
}
#wemd tr:nth-child(even) td {
  background: #fdf6ee;
}`

export const CSS_AURORA = `/* ====== 极光紫 ====== */
#wemd {
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  color: #334155;
  line-height: 1.8;
  word-break: break-word;
  padding: 24px 24px 40px;
}
#wemd p {
  margin: 16px 0;
  line-height: 1.8;
  text-align: justify;
}
#wemd h1 {
  margin: 32px 0 24px;
  text-align: center;
  font-size: 22px;
  font-weight: bold;
  color: #0f172a;
}
#wemd h2 {
  margin: 28px 0 16px;
  font-size: 18px;
  font-weight: bold;
  color: #4c1d95;
  border-left: 4px solid #7c3aed;
  padding: 6px 6px 6px 14px;
  background: linear-gradient(90deg, rgba(124,58,237,0.07), transparent);
  border-radius: 0 8px 8px 0;
}
#wemd h3 {
  margin: 22px 0 12px;
  font-size: 16px;
  font-weight: bold;
  color: #5b21b6;
}
#wemd h4 {
  margin: 18px 0 10px;
  font-size: 15px;
  color: #6d28d9;
}
#wemd ul, #wemd ol {
  margin: 12px 0;
  padding-left: 24px;
}
#wemd li {
  margin: 6px 0;
  line-height: 1.8;
  color: #334155;
}
#wemd blockquote {
  margin: 16px 0;
  padding: 14px 18px;
  background: rgba(102,126,234,0.06);
  border-left: 4px solid #7c3aed;
  border-radius: 0 8px 8px 0;
  color: #4c1d95;
}
#wemd blockquote p {
  margin: 0;
  font-size: 15px;
  line-height: 1.8;
}
#wemd strong {
  font-weight: bold;
  color: #4c1d95;
}
#wemd em {
  font-style: italic;
  color: #5b21b6;
}
#wemd code {
  color: #7c3aed;
  background: rgba(124,58,237,0.08);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 14px;
  font-family: "Courier New", Courier, monospace;
}
#wemd pre {
  margin: 16px 0;
  padding: 16px;
  background: #0f172a;
  border-radius: 10px;
  overflow-x: auto;
}
#wemd pre code {
  color: #b8a4ed;
  font-size: 13px;
  line-height: 1.6;
  background: transparent;
  padding: 0;
  font-family: "Courier New", Consolas, Monaco, monospace;
}
#wemd a {
  color: #7c3aed;
  text-decoration: none;
  border-bottom: 1px solid #7c3aed;
}
#wemd hr {
  margin: 28px 0;
  border: none;
  border-top: 1px solid rgba(124,58,237,0.2);
}
#wemd img {
  display: block;
  max-width: 100%;
  margin: 16px auto;
  border-radius: 8px;
}
#wemd table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 14px;
}
#wemd th {
  background: rgba(124,58,237,0.1);
  color: #4c1d95;
  font-weight: bold;
  border: 1px solid rgba(124,58,237,0.2);
  padding: 10px 12px;
  text-align: left;
}
#wemd td {
  border: 1px solid rgba(124,58,237,0.15);
  padding: 10px 12px;
  color: #334155;
}
#wemd tr:nth-child(even) td {
  background: rgba(124,58,237,0.03);
}`

// ── 内置模板列表 ─────────────────────────────────────────────────────────────

export const BUILTIN_TEMPLATES: TemplateItem[] = [
  { id: 'default', name: '经典蓝', desc: '清爽专业，适合大多数文章', accentColor: '#1e6bb8', css: CSS_DEFAULT, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'morandi', name: '莫兰迪', desc: '低饱和自然色调，文艺感强', accentColor: '#4F6F52', css: CSS_MORANDI, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'minimal', name: '极简黑', desc: '干净有力，排版纯粹', accentColor: '#111111', css: CSS_MINIMAL, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'sunset', name: '夕阳橙', desc: '暖色复古胶片，有温度感', accentColor: '#c8602a', css: CSS_SUNSET, isBuiltin: true, createdAt: 0, updatedAt: 0 },
  { id: 'aurora', name: '极光紫', desc: '渐变紫调，年轻现代', accentColor: '#7c3aed', css: CSS_AURORA, isBuiltin: true, createdAt: 0, updatedAt: 0 },
]

// ── localStorage CRUD ────────────────────────────────────────────────────────

export function loadCustomTemplates(): TemplateItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as TemplateItem[]) : []
  } catch {
    return []
  }
}

export function loadAllTemplates(): TemplateItem[] {
  return [...BUILTIN_TEMPLATES, ...loadCustomTemplates()]
}

export function saveCustomTemplate(t: TemplateItem): void {
  const customs = loadCustomTemplates()
  const idx = customs.findIndex(c => c.id === t.id)
  const updated = { ...t, updatedAt: Date.now() }
  if (idx >= 0) customs[idx] = updated
  else customs.push(updated)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customs))
  // 触发 storage 事件（同页面内跨组件同步用）
  window.dispatchEvent(new CustomEvent('wxtemplates-updated'))
}

export function deleteCustomTemplate(id: string): void {
  const customs = loadCustomTemplates().filter(c => c.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(customs))
  window.dispatchEvent(new CustomEvent('wxtemplates-updated'))
}

export function createNewTemplate(base?: Partial<TemplateItem>): TemplateItem {
  const now = Date.now()
  return {
    id: `custom-${now}`,
    name: base?.name ?? '新模板',
    desc: base?.desc ?? '',
    accentColor: base?.accentColor ?? '#6366f1',
    css: base?.css ?? CSS_DEFAULT.replace('/* ====== 经典蓝 ====== */', '/* ====== 自定义模板 ====== */'),
    isBuiltin: false,
    createdAt: now,
    updatedAt: now,
  }
}

/** 用于预览的示例 Markdown，覆盖所有元素 */
export const PREVIEW_MARKDOWN = `# 一级标题样式

这是**正文段落**，包含*斜体*文字和\`行内代码\`示例。点击[这是链接](#)查看效果。段落文字随模板自动调整行高和间距。

## 二级标题

> 这是引用块，适合强调重要内容或引用他人观点。可以包含**加粗**文字。

### 三级标题

- 无序列表项 A
- 无序列表项 B
- 支持 **加粗** 和 *斜体* 混排

1. 有序列表一
2. 有序列表二
3. 有序列表三

#### 四级标题

---

\`\`\`javascript
// 代码块样式预览
function greet(name) {
  return \`Hello, \${name}!\`
}
\`\`\`

| 表头 A | 表头 B | 表头 C |
|--------|--------|--------|
| 数据 1 | 数据 2 | 数据 3 |
| 数据 4 | 数据 5 | 数据 6 |
`
