/**
 * AI 样式生成路由
 * POST /api/generate-style
 */
import { Router } from 'express'
import axios from 'axios'
import { SERVER_AI_CONFIG } from '../config.js'

const router = Router()

router.post('/generate-style', async (req, res) => {
  try {
    const { prompt, baseCSS, aiConfig: clientAiConfig } = req.body
    if (!prompt) return res.status(400).json({ error: '缺少 prompt 参数' })

    const aiConfig = { ...SERVER_AI_CONFIG, ...clientAiConfig }
    const isMaas   = aiConfig.articleProvider === 'maas' && aiConfig.maasApiKey
    const apiKey   = isMaas ? aiConfig.maasApiKey : (aiConfig.articleApiKey || aiConfig.openaiApiKey)
    const baseUrl  = isMaas ? (aiConfig.maasBaseUrl || SERVER_AI_CONFIG.maasBaseUrl) : (aiConfig.articleBaseUrl || 'https://api.openai.com/v1')
    const model    = isMaas ? (aiConfig.maasModel || 'deepseek-v3') : (aiConfig.articleModel || 'gpt-4o')

    if (!apiKey) return res.status(400).json({ error: '未配置 AI API Key' })

    const systemPrompt = `你是一名专业的微信公众号 CSS 设计师，专门为微信公众号文章设计高质量排版样式。

## 微信渲染器兼容约束（必须严格遵守）

**禁止使用**（微信不支持或会被处理掉）：
- CSS 变量（--color-xxx 等）：微信渲染器不支持，不要使用
- 外部字体（@import、@font-face）：只用系统字体
- rgba() 透明色：用实色代替，微信会按阈值忽略低透明度颜色
- linear-gradient() 渐变背景：微信会将渐变色混合为纯色，用实色背景代替
- CSS Grid：兼容性差，用 Flexbox 或传统布局

**可以使用**：
- ::before 和 ::after 伪元素（微信支持，可用于标题装饰、装饰线、图标等）
- position: relative / absolute（配合伪元素做装饰）
- border、border-radius、box-shadow（谨慎用 shadow，不影响主体就行）
- 实色 hex 颜色（#rrggbb 格式）

## CSS 选择器规范

所有选择器必须以 \`#wemd\` 开头，覆盖以下所有元素：

\`\`\`
#wemd             根容器
#wemd p           段落
#wemd h1~h4       四级标题
#wemd ul/ol/li    列表
#wemd blockquote  引用块
#wemd blockquote p 引用内段落
#wemd strong/em   加粗斜体
#wemd code        行内代码
#wemd pre         代码块容器
#wemd pre code    代码块文字
#wemd a           链接
#wemd hr          分割线
#wemd img         图片
#wemd table/th/td 表格
#wemd tr:nth-child(even) td  表格斑马纹
\`\`\`

伪元素写法示例：
\`\`\`css
#wemd h2 { position: relative; padding-left: 16px; }
#wemd h2::before { content: ""; display: block; position: absolute; left: 0; top: 4px; bottom: 4px; width: 4px; background: #accent; border-radius: 2px; }
\`\`\`

## 设计原则

1. **可读性**：正文字号 15px，行高 1.75~2.0，text-align: justify
2. **层级感**：h1 居中+底部装饰线，h2 左侧色块或带背景，h3 小图标前缀
3. **视觉统一**：整套颜色体系由 1~2 个主色衍生，深色/中色/浅色三档
4. **伪元素装饰**：h1::after 做底部横线，h2::before 做左侧竖线，h3::before 做小图标
5. **代码块**：深色背景（#1a1a2e 或类似），浅色代码文字，pre 内 code 无背景无内边距

## 输出要求

只输出纯 CSS 代码，无任何解释、无 markdown 代码块标记、无注释，直接以 \`#wemd {\` 开头，以最后一个 \`}\` 结尾。`

    const userPrompt = `请根据以下风格要求生成微信公众号文章的 CSS 样式：

**风格描述**：${prompt}

${baseCSS ? `**参考已有样式**（理解其颜色体系，按新风格重新生成，不要照抄）：
\`\`\`css
${baseCSS.slice(0, 2000)}
\`\`\`` : ''}

生成要求：
1. 颜色方案严格贴合风格描述，主色只用 hex 实色，不用 rgba/渐变
2. h1 居中，::after 伪元素做底部短横线装饰
3. h2 左侧竖线（::before 绝对定位）+ 轻度背景色块，color/background 都用实色
4. h3 用 ::before 放小符号（◆ ▎ ✦ ◈ 等）做前缀，padding-left 留位置
5. blockquote 背景色 + 左侧边框，和正文有明显区分
6. code 行内浅色背景，pre 深色背景，pre 内 code 无背景无内边距
7. 表格用斑马纹，th 有背景色
8. 只输出 CSS 代码，从 \`#wemd {\` 开始`

    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
    if (isMaas && aiConfig.maasUserEmail) headers['X-User-Email'] = aiConfig.maasUserEmail

    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 3000,
      },
      { headers, timeout: 60000 }
    )

    const css = response.data.choices?.[0]?.message?.content?.trim() || ''
    const cleanCss = css
      .replace(/^```css\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim()

    res.json({ css: cleanCss })
  } catch (err) {
    console.error('样式生成失败', err?.response?.data || err.message)
    res.status(500).json({ error: err?.response?.data?.error?.message || err.message || '生成失败' })
  }
})

export default router
