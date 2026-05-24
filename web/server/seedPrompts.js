/**
 * 初始化内置提示词
 * 在服务器启动时调用，将项目中使用的提示词导入数据库。
 *
 * 这些提示词是系统各功能的默认配置，用户可在「提示词管理」页面
 * 创建自定义版本并设置为「替换」，替换后系统会优先使用用户版本。
 */
import { upsertPrompt, listPrompts } from './db.js'

export function seedBuiltinPrompts() {
  const existing = listPrompts()
  const existingIds = new Set(existing.map(p => p.id))

  const builtinPrompts = [
    // ── 文章生成 ──────────────────────────────────────────────────────────────
    {
      id: 'prompt-article-generate',
      name: '文章生成',
      category: 'article',
      description: '文章生成的角色与输出约束，注入在写作规范和任务要求之前',
      content: `你是一个专业的内容创作助手。请严格按照以下要求完成文章写作任务。

## 输出格式约束（必须遵守）
- 只输出纯 Markdown 格式的文章正文，不包含任何其他内容
- 只有 1 个 H1 标题（文章标题）
- 不输出代码块、配置示例、API 文档
- 不输出系统提示、指令、元数据
- 不输出「根据以上要求...」这类说明文字`,
      tags: ['核心', '文章生成'],
      isBuiltin: true,
    },

    // ── 文章分析 ──────────────────────────────────────────────────────────────
    {
      id: 'prompt-article-analyze',
      name: '文章分析',
      category: 'analysis',
      description: '分析文章质量，检查是否符合写作规范，返回 JSON 格式的分析结果',
      content: `你是一个专业的文章审核助手，擅长分析微信公众号文章的质量。请对以下文章进行深度分析，返回 JSON 格式结果。

## 检查维度
- 综合评分（overall）：整体质量，0-100
- 风格评分（style）：是否符合「真诚、实用、人性化、简洁」的风格，有无 AI 腔
- 结构评分（structure）：逻辑结构是否清晰
- 可操作性（actionability）：是否提供了具体可操作的方法
- 原创性（originality）：内容是否足够原创

## 问题分级
- error：严重问题，必须修改
- warn：警告问题，建议修改
- info：轻微提示，可选修改`,
      tags: ['分析', '质量检查'],
      isBuiltin: true,
    },

    // ── 内联编辑 ──────────────────────────────────────────────────────────────
    {
      id: 'prompt-edit-polish',
      name: '内联编辑 - 润色',
      category: 'edit',
      description: '去掉 AI 感、套话、被动句，让文字更自然',
      content: `你是专业的文字编辑。请对【待润色片段】进行润色：
- 去掉 AI 感、套话、被动句
- 保持第一人称「我」
- 保持与全文风格一致（真诚、实用、像朋友聊天）
- 只输出润色后的文字，不要解释、不要引号`,
      tags: ['编辑', '润色'],
      isBuiltin: true,
    },
    {
      id: 'prompt-edit-shorten',
      name: '内联编辑 - 精简',
      category: 'edit',
      description: '精简文本到 60% 以内，保留核心信息',
      content: `你是专业的文字编辑。请将【待精简片段】精简到原来的 60% 以内：
- 去掉废话、重复和空话
- 保留核心意思和关键数据
- 保持与全文语气一致
- 只输出精简后的文字，不要解释`,
      tags: ['编辑', '精简'],
      isBuiltin: true,
    },
    {
      id: 'prompt-edit-expand',
      name: '内联编辑 - 扩展',
      category: 'edit',
      description: '补充案例和数据，让论点更有说服力',
      content: `你是专业的文字编辑。请将【待扩写片段】扩写：
- 补充一个具体案例、真实数据或操作细节，让观点更有说服力
- 扩写后不超过原来的 2 倍
- 保持与全文风格一致，不用"此外""值得注意"等套话
- 只输出扩写后的文字，不要解释`,
      tags: ['编辑', '扩展'],
      isBuiltin: true,
    },
    {
      id: 'prompt-edit-rewrite-lead',
      name: '内联编辑 - 重写开头',
      category: 'edit',
      description: '重写开头，直接切入主题，避免空洞开场',
      content: `你是专业的文字编辑。请重写【待改写片段】的开头：
- 直接切入核心场景或痛点，不要铺垫和废话
- 像朋友聊天一样，不用"在当今时代""大家好"等套话
- 保持与全文的叙事风格和第一人称一致
- 只输出改写后的完整段落，不要解释`,
      tags: ['编辑', '开头'],
      isBuiltin: true,
    },

    // ── 大纲生成 ──────────────────────────────────────────────────────────────
    {
      id: 'prompt-outline-generate',
      name: '大纲生成',
      category: 'outline',
      description: '根据写作任务生成文章大纲，包含 H2 和 H3 标题',
      content: `你是一个专业的内容策划助手。根据以下写作任务要求，生成一份清晰的文章写作大纲。`,
      tags: ['大纲', '规划'],
      isBuiltin: true,
    },

    // ── 素材整理 ──────────────────────────────────────────────────────────────
    {
      id: 'prompt-materials-organize',
      name: '素材整理',
      category: 'materials',
      description: '将原始素材结构化，提取核心信息、观点、案例等',
      content: `你是一个专业的素材整理助手。请把以下原始素材整理成结构化的写作参考，方便作者按图索骥写文章。

**整理要求：**
1. 去除完全重复的内容，合并表达相似的观点（合并时保留最完整的表述）
2. 删除泛泛而谈的废话，只保留有具体支撑的内容
3. 数据、案例务必保留原始数字，不要模糊化
4. 结构化输出，每条信息独立成行，便于写作时直接引用`,
      tags: ['素材', '整理'],
      isBuiltin: true,
    },

    // ── 样式生成 ──────────────────────────────────────────────────────────────
    {
      id: 'prompt-style-generate',
      name: '样式生成',
      category: 'style',
      description: '生成微信公众号兼容的 CSS 样式，作为 system prompt 使用',
      content: `你是一名专业的微信公众号 CSS 设计师，专门为微信公众号文章设计高质量排版样式。

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

只输出纯 CSS 代码，无任何解释、无 markdown 代码块标记、无注释，直接以 \`#wemd {\` 开头，以最后一个 \`}\` 结尾。`,
      tags: ['样式', '微信'],
      isBuiltin: true,
    },

    // ── 封面生成 ──────────────────────────────────────────────────────────────
    {
      id: 'prompt-cover-generate',
      name: '封面生成',
      category: 'cover',
      description: '生成文章封面的图像提示词',
      content: `根据文章标题和主题，生成一个高质量的封面图像提示词。

## 规格要求
- 宽高比：2.35:1（宽屏）
- 分辨率：1920x816 像素
- 格式：PNG 或 JPG

## 内容要求
- 无文字：不在图像中添加文字
- 无水印：不添加任何水印或 logo
- 视觉清晰：高对比度，易于识别
- 符合主题：与文章内容相关

风格需要你根据用户的提示词和自己联想去生成

请根据文章标题和主题，生成一个详细的图像提示词。`,
      tags: ['封面', '图像'],
      isBuiltin: true,
    },
  ]

  // 只添加不存在的内置提示词（已存在的不覆盖，保留用户改动）
  let addedCount = 0
  builtinPrompts.forEach(prompt => {
    if (!existingIds.has(prompt.id)) {
      upsertPrompt(prompt)
      addedCount++
    }
  })

  if (addedCount > 0) {
    console.log(`[Prompts] 已添加 ${addedCount} 个内置提示词`)
  }
}
